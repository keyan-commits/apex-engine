// Wave 28b — `apex_user_test` MCP tool: black-box user-testing validator.
//
// Derived from Factory.ai's Missions architecture: "[The user-testing
// validator] acts like a QA engineer. It spawns the application. It
// interacts with it through computer use or something similar to that.
// It fills out forms, you know, checks that pages render correctly,
// clicks buttons, and ensures that functional flows work holistically.
// Critically, neither validator has seen the code before. They're not
// invested in the implementation, and so validation is adversarial by
// design."
//
// For an MCP server, "interacting like a real user" = driving the tool
// through the MCP transport (HTTP). This module:
//   1. Loads scenario definitions from `.apex/user-tests/*.json`
//      (path-traversal safe; same realpathSync + isInside discipline
//      as review-file-loader.ts).
//   2. For each scenario, POSTs a JSON-RPC `tools/call` request to the
//      running MCP HTTP server (default http://127.0.0.1:31001/mcp).
//   3. Extracts the textual response and evaluates assertions
//      (contains / not-contains / matches).
//   4. Returns a markdown report (pass/fail per scenario, per assertion).
//
// **Deviation from the MoA verdict (apex_synthesize 2026-05-27, conf 70).**
// The panel picked YAML scenarios. Adopting that requires adding `yaml`
// or `js-yaml` as a runtime dependency — a Rule 9A trigger that needs
// separate confirmation. JSON is same-shape (committed, diff-friendly,
// reviewable) with zero new dep. Switching to YAML later is mechanical
// if a future wave brings the dep in.
//
// **Known limitation v1.** Scenarios that call tools writing to
// `apex.db` (history, quota, cache) DO write production rows during
// test runs — the verdict flagged this as `__userTest` flag work.
// Follow-up wave can add a per-request `X-Apex-User-Test: 1` header
// that history/quota writes skip; tracked in HANDOFF.

import { readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { resolve, sep } from "node:path";

const DEFAULT_MCP_URL = "http://127.0.0.1:31001/mcp";
const DEFAULT_SCENARIO_DIR = ".apex/user-tests";
const DEFAULT_TIMEOUT_MS = 60_000;
const MAX_SCENARIOS_PER_RUN = 100;
const MAX_ASSERTIONS_PER_SCENARIO = 50;

export type AssertionKind = "contains" | "not-contains" | "matches";

export type Assertion = {
  kind: AssertionKind;
  value: string;
};

export type Scenario = {
  /** Stable id used in the report (filename-friendly recommended). */
  name: string;
  /** MCP tool name to drive (e.g. "apex_synthesize"). */
  tool: string;
  /** Arguments passed to the tool. */
  args: Record<string, unknown>;
  /** Acceptance assertions evaluated against the tool's text response. */
  assertions: Assertion[];
  /** Optional human description for the report. */
  description?: string;
};

export type AssertionResult = {
  assertion: Assertion;
  passed: boolean;
  detail?: string;
};

export type ScenarioResult = {
  scenario: Scenario;
  sourcePath?: string;
  ok: true;
  response: string;
  assertions: AssertionResult[];
  passed: boolean;
  latencyMs: number;
} | {
  scenario: Scenario;
  sourcePath?: string;
  ok: false;
  reason: string;
  latencyMs: number;
};

/** Path-traversal helper — same shape as review-file-loader.ts. */
function isInside(parent: string, child: string): boolean {
  const parentNorm = parent.endsWith(sep) ? parent : `${parent}${sep}`;
  return child === parent || child.startsWith(parentNorm);
}

function resolveInsideRoot(
  projectRoot: string,
  relPath: string,
): { ok: true; absolutePath: string } | { ok: false; reason: string } {
  if (!projectRoot || typeof projectRoot !== "string") {
    return { ok: false, reason: "projectRoot is required" };
  }
  if (!relPath || typeof relPath !== "string") {
    return { ok: false, reason: "scenario path is required" };
  }
  if (relPath.includes("\0")) {
    return { ok: false, reason: "scenario path contains a null byte" };
  }
  let rootAbs: string;
  let candidate: string;
  try {
    rootAbs = realpathSync(resolve(projectRoot));
  } catch (err) {
    return {
      ok: false,
      reason: `projectRoot is not a real directory: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
  try {
    candidate = realpathSync(resolve(rootAbs, relPath));
  } catch {
    return { ok: false, reason: `scenario path does not resolve inside projectRoot` };
  }
  if (!isInside(rootAbs, candidate)) {
    return {
      ok: false,
      reason: `scenario path escapes projectRoot (resolved to ${candidate})`,
    };
  }
  return { ok: true, absolutePath: candidate };
}

export function validateScenario(raw: unknown, label: string): Scenario {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error(`${label}: scenario must be a JSON object`);
  }
  const obj = raw as Record<string, unknown>;
  if (typeof obj.name !== "string" || !obj.name) {
    throw new Error(`${label}: scenario.name (string) is required`);
  }
  if (typeof obj.tool !== "string" || !obj.tool) {
    throw new Error(`${label}: scenario.tool (string) is required`);
  }
  if (!obj.args || typeof obj.args !== "object" || Array.isArray(obj.args)) {
    throw new Error(`${label}: scenario.args (object) is required`);
  }
  if (!Array.isArray(obj.assertions)) {
    throw new Error(`${label}: scenario.assertions (array) is required`);
  }
  if (obj.assertions.length === 0) {
    throw new Error(`${label}: scenario.assertions must contain at least one assertion`);
  }
  if (obj.assertions.length > MAX_ASSERTIONS_PER_SCENARIO) {
    throw new Error(
      `${label}: scenario.assertions has ${obj.assertions.length} entries (max ${MAX_ASSERTIONS_PER_SCENARIO})`,
    );
  }
  const assertions: Assertion[] = [];
  for (let i = 0; i < obj.assertions.length; i++) {
    const a = obj.assertions[i] as Record<string, unknown>;
    if (!a || typeof a !== "object") {
      throw new Error(`${label}: assertion[${i}] must be an object`);
    }
    const kind = a.kind;
    if (kind !== "contains" && kind !== "not-contains" && kind !== "matches") {
      throw new Error(
        `${label}: assertion[${i}].kind must be one of "contains" | "not-contains" | "matches" (got ${JSON.stringify(kind)})`,
      );
    }
    if (typeof a.value !== "string" || !a.value) {
      throw new Error(`${label}: assertion[${i}].value (non-empty string) is required`);
    }
    assertions.push({ kind, value: a.value });
  }
  const scenario: Scenario = {
    name: obj.name,
    tool: obj.tool,
    args: obj.args as Record<string, unknown>,
    assertions,
  };
  if (typeof obj.description === "string") scenario.description = obj.description;
  return scenario;
}

export function loadScenarioFile(
  projectRoot: string,
  relPath: string,
): { ok: true; scenario: Scenario; absolutePath: string } | { ok: false; reason: string } {
  const r = resolveInsideRoot(projectRoot, relPath);
  if (!r.ok) return r;
  let raw: string;
  try {
    if (!statSync(r.absolutePath).isFile()) {
      return { ok: false, reason: `scenario path is not a regular file` };
    }
    raw = readFileSync(r.absolutePath, "utf8");
  } catch (err) {
    return { ok: false, reason: `failed to read scenario: ${err instanceof Error ? err.message : String(err)}` };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    return { ok: false, reason: `scenario JSON parse failed: ${err instanceof Error ? err.message : String(err)}` };
  }
  try {
    const scenario = validateScenario(parsed, relPath);
    return { ok: true, scenario, absolutePath: r.absolutePath };
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : String(err) };
  }
}

export function listScenariosInDir(
  projectRoot: string,
  subdir: string = DEFAULT_SCENARIO_DIR,
): { ok: true; files: string[]; absoluteDir: string } | { ok: false; reason: string } {
  const r = resolveInsideRoot(projectRoot, subdir);
  if (!r.ok) {
    if (r.reason.includes("does not resolve")) {
      return { ok: true, files: [], absoluteDir: resolve(projectRoot, subdir) };
    }
    return r;
  }
  let entries: string[];
  try {
    if (!statSync(r.absolutePath).isDirectory()) {
      return { ok: false, reason: `${subdir} is not a directory` };
    }
    entries = readdirSync(r.absolutePath);
  } catch (err) {
    return { ok: false, reason: `failed to list scenarios: ${err instanceof Error ? err.message : String(err)}` };
  }
  const files = entries
    .filter((e) => e.endsWith(".json"))
    .sort()
    .map((e) => `${subdir}/${e}`);
  return { ok: true, files, absoluteDir: r.absolutePath };
}

function extractResponseText(jsonRpcResponse: unknown): string {
  // MCP response shape: { jsonrpc, id, result: { content: [{type: "text", text}], ...} }
  if (!jsonRpcResponse || typeof jsonRpcResponse !== "object") return "";
  const r = jsonRpcResponse as Record<string, unknown>;
  // Surface JSON-RPC errors directly so assertions can match on them.
  if (r.error && typeof r.error === "object") {
    return `[JSON-RPC ERROR] ${JSON.stringify(r.error)}`;
  }
  const result = r.result as Record<string, unknown> | undefined;
  if (!result) return "";
  const content = result.content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((c) => c && typeof c === "object" && (c as { type?: string }).type === "text")
    .map((c) => String((c as { text?: unknown }).text ?? ""))
    .join("\n");
}

export function evaluateAssertion(
  assertion: Assertion,
  responseText: string,
): AssertionResult {
  switch (assertion.kind) {
    case "contains": {
      const passed = responseText.includes(assertion.value);
      return {
        assertion,
        passed,
        ...(passed ? {} : { detail: `response did not contain ${JSON.stringify(assertion.value)}` }),
      };
    }
    case "not-contains": {
      const present = responseText.includes(assertion.value);
      return {
        assertion,
        passed: !present,
        ...(present ? { detail: `response unexpectedly contained ${JSON.stringify(assertion.value)}` } : {}),
      };
    }
    case "matches": {
      try {
        const re = new RegExp(assertion.value);
        const passed = re.test(responseText);
        return {
          assertion,
          passed,
          ...(passed ? {} : { detail: `regex /${assertion.value}/ did not match` }),
        };
      } catch (err) {
        return {
          assertion,
          passed: false,
          detail: `invalid regex /${assertion.value}/: ${err instanceof Error ? err.message : String(err)}`,
        };
      }
    }
  }
}

export async function runScenario(
  scenario: Scenario,
  opts?: {
    baseUrl?: string;
    sourcePath?: string;
    timeoutMs?: number;
    fetchImpl?: typeof fetch;
  },
): Promise<ScenarioResult> {
  const baseUrl = opts?.baseUrl ?? DEFAULT_MCP_URL;
  const timeoutMs = opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const fetchImpl = opts?.fetchImpl ?? fetch;
  const start = Date.now();

  // JSON-RPC 2.0 envelope for MCP `tools/call`.
  const body = JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: { name: scenario.tool, arguments: scenario.args },
  });

  let resText: string;
  try {
    const signal = AbortSignal.timeout(timeoutMs);
    const res = await fetchImpl(baseUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
      },
      body,
      signal,
    });
    if (!res.ok) {
      return {
        scenario,
        ...(opts?.sourcePath ? { sourcePath: opts.sourcePath } : {}),
        ok: false,
        reason: `HTTP ${res.status} ${res.statusText}`,
        latencyMs: Date.now() - start,
      };
    }
    const ct = res.headers.get("content-type") ?? "";
    resText = await res.text();
    if (ct.includes("text/event-stream")) {
      // SSE response — extract the last `data: {...}` line, which carries
      // the JSON-RPC result envelope.
      const dataLines = resText
        .split("\n")
        .filter((l) => l.startsWith("data: "))
        .map((l) => l.slice(6));
      resText = dataLines[dataLines.length - 1] ?? "";
    }
  } catch (err) {
    return {
      scenario,
      ...(opts?.sourcePath ? { sourcePath: opts.sourcePath } : {}),
      ok: false,
      reason: `fetch failed: ${err instanceof Error ? err.message : String(err)}`,
      latencyMs: Date.now() - start,
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(resText);
  } catch (err) {
    return {
      scenario,
      ...(opts?.sourcePath ? { sourcePath: opts.sourcePath } : {}),
      ok: false,
      reason: `JSON-RPC response parse failed: ${err instanceof Error ? err.message : String(err)}`,
      latencyMs: Date.now() - start,
    };
  }

  const responseText = extractResponseText(parsed);
  const assertionResults = scenario.assertions.map((a) =>
    evaluateAssertion(a, responseText),
  );
  const passed = assertionResults.every((r) => r.passed);
  return {
    scenario,
    ...(opts?.sourcePath ? { sourcePath: opts.sourcePath } : {}),
    ok: true,
    response: responseText,
    assertions: assertionResults,
    passed,
    latencyMs: Date.now() - start,
  };
}

export function formatReport(
  results: ScenarioResult[],
  opts?: { baseUrl?: string },
): string {
  const baseUrl = opts?.baseUrl ?? DEFAULT_MCP_URL;
  const total = results.length;
  const passed = results.filter((r) => r.ok && r.passed).length;
  const failed = results.filter((r) => r.ok && !r.passed).length;
  const errored = results.filter((r) => !r.ok).length;
  const headerBanner =
    failed + errored === 0
      ? `# apex_user_test — ${passed}/${total} scenarios passed ✓`
      : `# apex_user_test — ${passed}/${total} scenarios passed (${failed} failed, ${errored} errored)`;
  const lines: string[] = [
    headerBanner,
    "",
    `Driving the MCP server at \`${baseUrl}\`.`,
    "",
  ];
  for (const r of results) {
    const status = !r.ok ? "ERRORED" : r.passed ? "PASSED" : "FAILED";
    const icon = status === "PASSED" ? "✓" : status === "FAILED" ? "✗" : "⚠";
    lines.push(`## ${icon} ${r.scenario.name} — ${status} (${r.latencyMs}ms)`);
    lines.push(`- **Tool**: \`${r.scenario.tool}\``);
    if (r.sourcePath) lines.push(`- **Source**: \`${r.sourcePath}\``);
    if (r.scenario.description) {
      lines.push(`- **Description**: ${r.scenario.description}`);
    }
    if (!r.ok) {
      lines.push(`- **Reason**: ${r.reason}`);
    } else {
      lines.push(`- **Assertions** (${r.assertions.filter((a) => a.passed).length}/${r.assertions.length}):`);
      for (const a of r.assertions) {
        const aIcon = a.passed ? "✓" : "✗";
        const detail = a.detail ? ` — ${a.detail}` : "";
        lines.push(`  - ${aIcon} \`${a.assertion.kind}\` ${JSON.stringify(a.assertion.value)}${detail}`);
      }
    }
    lines.push("");
  }
  return lines.join("\n");
}

export const APEX_USER_TEST_CONSTANTS = {
  DEFAULT_MCP_URL,
  DEFAULT_SCENARIO_DIR,
  DEFAULT_TIMEOUT_MS,
  MAX_SCENARIOS_PER_RUN,
  MAX_ASSERTIONS_PER_SCENARIO,
} as const;
