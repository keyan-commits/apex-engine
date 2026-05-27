// Wave 28b — apex_user_test tests.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, sep } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  APEX_USER_TEST_CONSTANTS,
  evaluateAssertion,
  formatReport,
  listScenariosInDir,
  loadScenarioFile,
  runScenario,
  validateScenario,
  type Scenario,
} from "../apex-user-test";

const goodScenario = {
  name: "synth-fires-pre-flight",
  tool: "apex_synthesize",
  args: { prompt: "test", includeClaude: false },
  assertions: [
    { kind: "contains", value: "[PRE-FLIGHT STATUS]" },
    { kind: "not-contains", value: "ERROR" },
  ],
} as const;

describe("validateScenario (Wave 28b)", () => {
  it("accepts a valid minimal scenario", () => {
    const r = validateScenario(goodScenario, "test.json");
    expect(r.name).toBe("synth-fires-pre-flight");
    expect(r.assertions.length).toBe(2);
  });

  it("rejects non-object input", () => {
    expect(() => validateScenario("string", "x")).toThrow(/must be a JSON object/);
    expect(() => validateScenario([], "x")).toThrow(/must be a JSON object/);
    expect(() => validateScenario(null, "x")).toThrow(/must be a JSON object/);
  });

  it("rejects missing required fields", () => {
    expect(() => validateScenario({ tool: "x", args: {}, assertions: [] }, "f")).toThrow(/name/);
    expect(() => validateScenario({ name: "x", args: {}, assertions: [] }, "f")).toThrow(/tool/);
    expect(() => validateScenario({ name: "x", tool: "t", assertions: [] }, "f")).toThrow(/args/);
    expect(() => validateScenario({ name: "x", tool: "t", args: {} }, "f")).toThrow(/assertions/);
  });

  it("rejects empty assertions array", () => {
    expect(() =>
      validateScenario({ ...goodScenario, assertions: [] }, "f"),
    ).toThrow(/at least one/);
  });

  it("rejects invalid assertion kind", () => {
    expect(() =>
      validateScenario(
        { ...goodScenario, assertions: [{ kind: "equals", value: "x" }] },
        "f",
      ),
    ).toThrow(/contains.*not-contains.*matches/);
  });

  it("rejects empty assertion value", () => {
    expect(() =>
      validateScenario(
        { ...goodScenario, assertions: [{ kind: "contains", value: "" }] },
        "f",
      ),
    ).toThrow(/non-empty string/);
  });

  it("rejects more than the max assertions per scenario", () => {
    const tooMany = Array.from(
      { length: APEX_USER_TEST_CONSTANTS.MAX_ASSERTIONS_PER_SCENARIO + 1 },
      (_, i) => ({ kind: "contains" as const, value: `v${i}` }),
    );
    expect(() => validateScenario({ ...goodScenario, assertions: tooMany }, "f")).toThrow(/max/);
  });

  it("preserves the optional `description` field", () => {
    const r = validateScenario({ ...goodScenario, description: "hello" }, "f");
    expect(r.description).toBe("hello");
  });
});

describe("evaluateAssertion (Wave 28b)", () => {
  const probe = "abc [PRE-FLIGHT STATUS] xyz Running 3/5 providers";

  it("`contains` passes when substring present", () => {
    expect(evaluateAssertion({ kind: "contains", value: "PRE-FLIGHT" }, probe).passed).toBe(true);
  });

  it("`contains` fails with a detail when missing", () => {
    const r = evaluateAssertion({ kind: "contains", value: "MISSING" }, probe);
    expect(r.passed).toBe(false);
    expect(r.detail).toMatch(/did not contain/);
  });

  it("`not-contains` passes when absent", () => {
    expect(evaluateAssertion({ kind: "not-contains", value: "ERROR" }, probe).passed).toBe(true);
  });

  it("`not-contains` fails with a detail when present", () => {
    const r = evaluateAssertion({ kind: "not-contains", value: "PRE-FLIGHT" }, probe);
    expect(r.passed).toBe(false);
    expect(r.detail).toMatch(/unexpectedly contained/);
  });

  it("`matches` passes for valid regex hit", () => {
    expect(evaluateAssertion({ kind: "matches", value: "Running \\d+/\\d+" }, probe).passed).toBe(true);
  });

  it("`matches` fails for a non-matching regex", () => {
    const r = evaluateAssertion({ kind: "matches", value: "NO_SUCH_PATTERN" }, probe);
    expect(r.passed).toBe(false);
    expect(r.detail).toMatch(/did not match/);
  });

  it("`matches` reports a clear error on invalid regex syntax", () => {
    const r = evaluateAssertion({ kind: "matches", value: "[" }, probe);
    expect(r.passed).toBe(false);
    expect(r.detail).toMatch(/invalid regex/);
  });
});

describe("loadScenarioFile + listScenariosInDir (Wave 28b)", () => {
  let root: string;
  let outside: string;

  beforeEach(() => {
    root = mkdtempSync(resolve(tmpdir(), "apex-user-test-"));
    outside = mkdtempSync(resolve(tmpdir(), "apex-user-test-out-"));
    mkdirSync(resolve(root, ".apex/user-tests"), { recursive: true });
  });
  afterEach(() => {
    try { rmSync(root, { recursive: true, force: true }); } catch {}
    try { rmSync(outside, { recursive: true, force: true }); } catch {}
  });

  it("loads a valid scenario JSON", () => {
    const path = resolve(root, ".apex/user-tests/wave-22f.json");
    writeFileSync(path, JSON.stringify(goodScenario));
    const r = loadScenarioFile(root, ".apex/user-tests/wave-22f.json");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.scenario.tool).toBe("apex_synthesize");
  });

  it("rejects scenario file outside projectRoot via ../ traversal", () => {
    writeFileSync(resolve(outside, "evil.json"), JSON.stringify(goodScenario));
    const r = loadScenarioFile(root, `../${outside.split(sep).pop()}/evil.json`);
    expect(r.ok).toBe(false);
  });

  it("rejects null-byte in scenario path", () => {
    const r = loadScenarioFile(root, ".apex/user-tests/x\0.json");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/null byte/);
  });

  it("reports a parse error for malformed JSON", () => {
    writeFileSync(resolve(root, ".apex/user-tests/bad.json"), "{");
    const r = loadScenarioFile(root, ".apex/user-tests/bad.json");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/JSON parse failed/);
  });

  it("reports a schema validation error for an invalid scenario", () => {
    writeFileSync(
      resolve(root, ".apex/user-tests/missing.json"),
      JSON.stringify({ name: "x" }),
    );
    const r = loadScenarioFile(root, ".apex/user-tests/missing.json");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/tool/);
  });

  it("lists scenarios sorted alphabetically + .json-only", () => {
    writeFileSync(resolve(root, ".apex/user-tests/b.json"), "{}");
    writeFileSync(resolve(root, ".apex/user-tests/a.json"), "{}");
    writeFileSync(resolve(root, ".apex/user-tests/c.json"), "{}");
    writeFileSync(resolve(root, ".apex/user-tests/skip.md"), "not a scenario");
    const r = listScenariosInDir(root);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.files).toEqual([
        ".apex/user-tests/a.json",
        ".apex/user-tests/b.json",
        ".apex/user-tests/c.json",
      ]);
    }
  });

  it("returns empty list (not error) when scenarios dir doesn't exist", () => {
    // Use a fresh root without the user-tests dir.
    const fresh = mkdtempSync(resolve(tmpdir(), "apex-fresh-"));
    try {
      const r = listScenariosInDir(fresh);
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.files).toEqual([]);
    } finally {
      try { rmSync(fresh, { recursive: true, force: true }); } catch {}
    }
  });
});

describe("runScenario (Wave 28b — mocked fetch)", () => {
  function mockFetch(responseBody: unknown, status = 200, contentType = "application/json") {
    return vi.fn().mockResolvedValue({
      ok: status < 400,
      status,
      statusText: status < 400 ? "OK" : "Error",
      headers: { get: (_h: string) => contentType },
      text: async () => (typeof responseBody === "string" ? responseBody : JSON.stringify(responseBody)),
    } as unknown as Response);
  }

  const scenario: Scenario = {
    name: "test",
    tool: "apex_synthesize",
    args: { prompt: "p" },
    assertions: [
      { kind: "contains", value: "Running 3/5" },
      { kind: "not-contains", value: "ERROR" },
    ],
  };

  it("evaluates assertions against the MCP response text and reports passed=true on all hits", async () => {
    const fetchImpl = mockFetch({
      jsonrpc: "2.0",
      id: 1,
      result: {
        content: [{ type: "text", text: "[PRE-FLIGHT STATUS]\nRunning 3/5 providers cleanly." }],
      },
    });
    const r = await runScenario(scenario, { fetchImpl });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.passed).toBe(true);
      expect(r.assertions.every((a) => a.passed)).toBe(true);
    }
  });

  it("reports per-assertion failures with details when not all match", async () => {
    const fetchImpl = mockFetch({
      jsonrpc: "2.0",
      id: 1,
      result: { content: [{ type: "text", text: "Different content, no match" }] },
    });
    const r = await runScenario(scenario, { fetchImpl });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.passed).toBe(false);
      expect(r.assertions[0]?.passed).toBe(false);
      expect(r.assertions[0]?.detail).toMatch(/did not contain/);
    }
  });

  it("surfaces JSON-RPC errors so assertions can match on them", async () => {
    const fetchImpl = mockFetch({
      jsonrpc: "2.0",
      id: 1,
      error: { code: -32601, message: "Method not found" },
    });
    const r = await runScenario(scenario, { fetchImpl });
    expect(r.ok).toBe(true);
    if (r.ok) {
      // The mock body becomes the responseText prefixed with [JSON-RPC ERROR].
      expect(r.response).toContain("[JSON-RPC ERROR]");
      expect(r.response).toContain("Method not found");
    }
  });

  it("returns ok=false with a clear reason on HTTP non-2xx", async () => {
    const fetchImpl = mockFetch("Server error", 500, "text/plain");
    const r = await runScenario(scenario, { fetchImpl });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/HTTP 500/);
  });

  it("returns ok=false when fetch throws (server not running, network error)", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("ECONNREFUSED 127.0.0.1:31001"));
    const r = await runScenario(scenario, { fetchImpl });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/ECONNREFUSED/);
  });

  it("extracts text from an SSE response body (Streamable HTTP variant)", async () => {
    const sseBody =
      "event: message\n" +
      "data: " +
      JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        result: { content: [{ type: "text", text: "Running 3/5 providers" }] },
      }) +
      "\n\n";
    const fetchImpl = mockFetch(sseBody, 200, "text/event-stream");
    const r = await runScenario(scenario, { fetchImpl });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.assertions[0]?.passed).toBe(true);
  });
});

describe("formatReport (Wave 28b)", () => {
  const baseScenario: Scenario = {
    name: "n",
    tool: "apex_synthesize",
    args: {},
    assertions: [{ kind: "contains", value: "ok" }],
  };

  it("renders a clean all-passed banner", () => {
    const out = formatReport(
      [
        {
          scenario: baseScenario,
          ok: true,
          response: "ok",
          assertions: [{ assertion: baseScenario.assertions[0]!, passed: true }],
          passed: true,
          latencyMs: 100,
        },
      ],
    );
    expect(out).toMatch(/1\/1 scenarios passed/);
    expect(out).toContain("✓");
    expect(out).toContain("PASSED");
  });

  it("renders fail and error counts in the banner", () => {
    const out = formatReport([
      {
        scenario: baseScenario,
        ok: true,
        response: "missing",
        assertions: [{ assertion: baseScenario.assertions[0]!, passed: false, detail: "x" }],
        passed: false,
        latencyMs: 10,
      },
      {
        scenario: baseScenario,
        ok: false,
        reason: "ECONNREFUSED",
        latencyMs: 5,
      },
    ]);
    expect(out).toMatch(/0\/2 scenarios passed/);
    expect(out).toContain("1 failed");
    expect(out).toContain("1 errored");
    expect(out).toContain("✗");
    expect(out).toContain("⚠");
  });

  it("includes assertion details in each failing scenario", () => {
    const out = formatReport([
      {
        scenario: baseScenario,
        ok: true,
        response: "x",
        assertions: [
          { assertion: baseScenario.assertions[0]!, passed: false, detail: "did not contain \"ok\"" },
        ],
        passed: false,
        latencyMs: 1,
      },
    ]);
    expect(out).toContain('did not contain "ok"');
  });
});
