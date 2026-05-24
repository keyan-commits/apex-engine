import { spawnSync } from "node:child_process";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { fanOut, type FanOutItem } from "@/lib/engine";
import { createReport } from "@/lib/feedback";
import { formatFlushNotice } from "@/lib/feedback-flush";
import { listHistory, saveHistory, type HistoryAnswer, type HistoryEntry } from "@/lib/history";
import { PROVIDERS, PROVIDER_LABELS, type Provider } from "@/lib/providers";
import { exhaustedNonClaudeCount } from "@/lib/quota";
import { findEnsemble } from "@/lib/roles";
import { formatSelfCheckReport, selfCheck } from "@/lib/self-check";
import {
  decompose,
  executeSubagents,
  nodesToBriefing,
} from "@/lib/subagents";
import { synthesize, type FanOutAnswer } from "@/lib/synthesize";

// Shared MCP tool registration — called by BOTH the stdio entry point
// (src/mcp/server.ts) and the HTTP entry point (src/mcp/http-server.ts).
// Keeping tool definitions in one place avoids transport-specific drift.
//
// Each tool's text response is wrapped in withFlushNotice() so a backlog
// of unflushed feedback records nags the user on every invocation —
// silently noop when auto-flush is succeeding.

export const REGISTERED_TOOL_NAMES = [
  "apex_fanout",
  "apex_synthesize",
  "apex_decompose",
  "apex_report",
  "apex_self_check",
  "apex_qa_review",
  "apex_security_review",
  "apex_history_search",
];

type CollectedAnswer = {
  provider: Provider;
  tier: string;
  model: string;
  text: string;
  error: string | null;
};

async function collectStream(item: FanOutItem): Promise<CollectedAnswer> {
  let text = "";
  let error: string | null = null;
  try {
    for await (const chunk of item.stream) text += chunk;
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
  }
  return {
    provider: item.provider,
    tier: item.tier,
    model: item.model,
    text,
    error,
  };
}

async function runFanOut(
  prompt: string,
  opts: { includeClaude: boolean; ensembleId?: string; context?: string },
): Promise<CollectedAnswer[]> {
  const ensemble = opts.ensembleId ? findEnsemble(opts.ensembleId) : undefined;
  const items = fanOut(prompt, {
    roles: ensemble?.assignments,
    context: opts.context,
  });
  const filtered = opts.includeClaude
    ? items
    : items.filter((i) => i.provider !== "claude");
  return Promise.all(filtered.map(collectStream));
}

function formatAnswers(answers: CollectedAnswer[]): string {
  return answers
    .map((a) => {
      const label = PROVIDER_LABELS[a.provider] ?? a.provider;
      const tierNote = a.tier === "fallback" ? `, ${a.tier}` : "";
      const header = `## ${label} — ${a.model}${tierNote}`;
      if (a.error) return `${header}\n\n_Error: ${a.error}_`;
      return `${header}\n\n${a.text.trim()}`;
    })
    .join("\n\n---\n\n");
}

function buildHistoryMap(
  prompt: string,
  answers: CollectedAnswer[],
): Record<Provider, HistoryAnswer> {
  const map = {} as Record<Provider, HistoryAnswer>;
  for (const p of PROVIDERS) {
    const a = answers.find((x) => x.provider === p);
    map[p] = a
      ? {
          text: a.text,
          model: a.model,
          tier: a.tier as HistoryAnswer["tier"],
          error: a.error,
        }
      : {
          text: "",
          model: "(skipped via MCP)",
          tier: "primary",
          error: "skipped",
        };
  }
  void prompt;
  return map;
}

function runScript(name: string, args: string[]): {
  ok: boolean;
  stdout: string;
  stderr: string;
  exitCode: number | null;
} {
  const r = spawnSync("pnpm", [name, ...args], {
    cwd: process.cwd(),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env: process.env,
  });
  return {
    ok: r.status === 0,
    stdout: r.stdout ?? "",
    stderr: r.stderr ?? "",
    exitCode: r.status,
  };
}

function withFlushNotice(text: string): string {
  const notice = formatFlushNotice();
  return notice ? `${notice}\n\n---\n\n${text}` : text;
}

export function registerAllTools(server: McpServer): void {
  server.tool(
    "apex_fanout",
    "Fan out a prompt to multiple LLMs in parallel and return each model's individual answer. Models: GPT-4o-mini (via GitHub Models), Llama 3.3 70B (via Groq), Gemini 2.5 Flash (via AI Studio). Optionally include Claude via Claude Agent SDK (default off — avoids recursion when invoked from Claude Code, EXCEPT when 2+ of the other providers are quota-exhausted, in which case Claude is auto-included to keep the fan-out useful). Optionally pass an ensembleId to assign roles (code-review / research / decision / brainstorm / legal / medical / marketing). Returns each model's response labeled by provider, separated by --- . Use when you want to compare how different LLMs answer the same question — cross-checking facts, diverse perspectives, research.\n\n**STRONGLY RECOMMENDED: pass `context`** whenever the prompt contains acronyms / project names / domain-specific terms that an outside model might misinterpret. Real failure caught: a call from a project using \"MCP\" (Model Context Protocol) produced sub-agents that interpreted MCP as a generic enterprise meeting-capture platform. The fix is one sentence of context.",
    {
      prompt: z.string().describe("The question to ask all models."),
      includeClaude: z
        .boolean()
        .default(false)
        .describe(
          "Include the Claude slot via Claude Agent SDK. Default: false to avoid recursion when invoked from Claude Code itself. When 2+ non-Claude providers are exhausted, Claude is auto-included regardless of this flag (the alternative is an empty fan-out).",
        ),
      ensembleId: z
        .string()
        .optional()
        .describe(
          "Optional ensemble id (code-review / research / decision / brainstorm / legal / medical / marketing). Assigns each model a distinct role.",
        ),
      context: z
        .string()
        .optional()
        .describe(
          "Disambiguation context from YOUR (caller's) session — a short glossary or project description that apex-engine prepends to each sub-agent's system prompt. Use it whenever the prompt contains acronyms, project names, version numbers, or domain-specific terms an outside model might misinterpret. Example: \"transcribe-meeting is an MCP server. MCP = Model Context Protocol (Anthropic's protocol for LLM tool calls), NOT a meeting platform. v0.3.0 was released last week.\" Capped at 2000 chars; lines that look like system-prompt directives are stripped.",
        ),
    },
    async ({ prompt, includeClaude, ensembleId, context }) => {
      // Wave 11 recursion-guard adjustment: when 2+ non-Claude providers
      // are exhausted, ignore the default-off behavior and bring Claude
      // into the fan-out anyway. Without this the user gets a fan-out
      // with 0-1 valid answers and a useless synth.
      const effectiveIncludeClaude =
        includeClaude || exhaustedNonClaudeCount() >= 2;
      const answers = await runFanOut(prompt, {
        includeClaude: effectiveIncludeClaude,
        ensembleId,
        context,
      });
      try {
        saveHistory({
          prompt,
          answers: buildHistoryMap(prompt, answers),
          synthText: null,
          synthError: null,
          projectId: null,
        });
      } catch (err) {
        console.error("[mcp] history save failed:", err);
      }
      return {
        content: [{ type: "text", text: withFlushNotice(formatAnswers(answers)) }],
      };
    },
  );

  server.tool(
    "apex_synthesize",
    "Fan out a prompt to multiple LLMs and produce a single synthesized 'best answer' (Mixture-of-Agents pattern). Queries GPT / Llama / Gemini (and optionally Claude) in parallel, then sends all responses + original prompt to a synthesizer model (DeepSeek-R1-Distill 70B via Groq by default) which combines the strongest insights, resolves contradictions, and produces one polished answer. Returns the synthesized answer followed by each individual response for transparency. Use when you want the highest-quality consolidated answer from multiple models.\n\n**STRONGLY RECOMMENDED: pass `context`** whenever the prompt contains acronyms / project names / domain-specific terms. Same rationale as apex_fanout — outside models drift without it.",
    {
      prompt: z.string().describe("The question to ask all models."),
      includeClaude: z
        .boolean()
        .default(false)
        .describe(
          "Include the Claude slot via Claude Agent SDK. Default: false.",
        ),
      synthesizerId: z
        .string()
        .optional()
        .describe(
          "Synthesizer model id. Options: deepseek-r1-distill (default), claude-sonnet, gpt-4o-mini, gemini-flash. See src/lib/synthesizer-options.ts.",
        ),
      context: z
        .string()
        .optional()
        .describe(
          "Disambiguation context from your session — see apex_fanout's context param for guidance.",
        ),
    },
    async ({ prompt, includeClaude, synthesizerId, context }) => {
      const answers = await runFanOut(prompt, { includeClaude, context });
      const synthInput: FanOutAnswer[] = answers.map((a) => ({
        provider: a.provider,
        text: a.text,
        error: a.error ?? undefined,
      }));

      const synthStart = Date.now();
      let synthText = "";
      let synthError: string | null = null;
      try {
        // Compose caller-supplied context into the synth's systemPrompt
        // so the synthesizer sees the same disambiguation block the
        // base fan-out received.
        const synthSystemPrompt = context && context.trim()
          ? `[Context from calling session]\n${context.trim()}\n[End context]`
          : undefined;
        for await (const chunk of synthesize(prompt, synthInput, {
          synthesizerId,
          ...(synthSystemPrompt ? { systemPrompt: synthSystemPrompt } : {}),
        })) {
          synthText += chunk;
        }
      } catch (err) {
        synthError = err instanceof Error ? err.message : String(err);
      }

      try {
        saveHistory({
          prompt,
          answers: buildHistoryMap(prompt, answers),
          synthText: synthError ? null : synthText,
          synthError,
          projectId: null,
          synthesizerId: synthesizerId ?? null,
          totalLatencyMs: Date.now() - synthStart,
        });
      } catch (err) {
        console.error("[mcp] history save failed:", err);
      }

      const synthSection = synthError
        ? `# Synthesizer\n\n_Error: ${synthError}_`
        : `# Synthesized Best Answer\n\n${synthText.trim()}`;

      return {
        content: [
          {
            type: "text",
            text: withFlushNotice(
              `${synthSection}\n\n---\n\n# Individual Responses\n\n${formatAnswers(answers)}`,
            ),
          },
        ],
      };
    },
  );

  server.tool(
    "apex_decompose",
    "Decompose a complex prompt into ≤3 sub-questions, answer each via a mini fan-out (gpt-4o-mini + Llama 3.3 70B + a mini-synth via gpt-oss-120b), then return a structured tree of sub-questions and their answers. Best for multi-part questions where pure parallel fan-out would lose structure.\n\n**STRONGLY RECOMMENDED: pass `context`** whenever the prompt has acronyms or project-specific terms. apex_decompose is THE highest-risk tool for context drift — the planner generates sub-questions that are FURTHER from the original prompt, and each sub-question goes to its own mini fan-out. A real failure: a call from a transcribe-meeting/MCP project produced sub-questions about \"enterprise meeting capture platform\" because the planner had no glossary saying MCP = Model Context Protocol. One sentence of context prevents this.",
    {
      prompt: z.string().describe("The complex prompt to decompose."),
      context: z
        .string()
        .optional()
        .describe(
          "Disambiguation context from YOUR (caller's) session — fed to BOTH the planner AND each mini fan-out. Even more important here than in apex_fanout/synthesize because sub-questions land further from the original. Example: \"transcribe-meeting is an MCP server. MCP = Model Context Protocol (Anthropic, NOT a meeting platform). Current version 0.3.0 adds Whisper integration.\" Capped at 2000 chars.",
        ),
    },
    async ({ prompt, context }) => {
      const plan = await decompose(prompt, undefined, context);
      if (!plan.ok) {
        return {
          content: [
            { type: "text", text: withFlushNotice(`Planner failed: ${plan.reason}`) },
          ],
        };
      }
      await executeSubagents(plan.nodes, () => {}, undefined, context);
      const briefing = nodesToBriefing(plan.nodes);
      return {
        content: [{ type: "text", text: withFlushNotice(briefing) }],
      };
    },
  );

  server.tool(
    "apex_report",
    "**MANDATORY whenever you discover a bug or have a concrete improvement idea about apex-engine.** Record a bug report or improvement suggestion. Reports are written to the local apex-engine repo's data/feedback/outbox/ as structured JSON; auto-flush every 30 min publishes them as GitHub Issues on the upstream apex-engine repository.\n\n**CALL THIS TOOL. Do NOT just verbally note an issue in your response text** — a chat acknowledgement (\"I'll flag this for you to fix later\") is not a substitute for calling apex_report. The human cannot triage what isn't recorded; verbal flags vanish at end of conversation.\n\nWhen to call:\n- You notice an apex-engine bug while working on ANY project (apex-engine itself or a downstream project that uses apex-engine MCP)\n- You spot a concrete improvement that would save the user time\n- A gate fails in a way the user should know about\n- Anything you'd otherwise just \"mention to the user for later\" — file it instead\n\n**Pass `sourceProject`** with the name (or basename) of the project you're currently working in — e.g. \"my-finances\" if the user is in /Users/.../my-finances, \"apex-engine\" if you're inside this repo. This lets the human verify cross-instance reporting is working end-to-end. Default is auto-detected from cwd / env but the caller should set it explicitly when known.",
    {
      kind: z
        .enum(["bug", "improvement", "praise", "question"])
        .describe(
          "Report type. bug=defect; improvement=feature suggestion; praise=positive feedback; question=clarification.",
        ),
      title: z
        .string()
        .min(3)
        .describe("Short, specific title — under ~100 chars."),
      description: z
        .string()
        .describe(
          "Markdown body. Include repro steps for bugs, motivation/use-case for improvements.",
        ),
      sourceProject: z
        .string()
        .optional()
        .describe(
          "The project this report came from — basename of the Claude Code session's working directory (e.g. \"my-finances\", \"apex-engine\"). Sanitized to [a-zA-Z0-9._/-] and capped at 80 chars before storage. Auto-detected if omitted.",
        ),
      promptSnippet: z
        .string()
        .optional()
        .describe(
          "Optional excerpt of the user prompt that triggered this. First 200 chars only — full prompts and attachments are never stored.",
        ),
      errorText: z
        .string()
        .optional()
        .describe("Optional stack trace or error message."),
    },
    async ({ kind, title, description, sourceProject, promptSnippet, errorText }) => {
      try {
        const { record, path } = createReport({
          kind,
          title,
          description,
          channel: "mcp",
          sourceProject,
          context: {
            ...(promptSnippet ? { promptSnippet } : {}),
            ...(errorText ? { error: errorText } : {}),
          },
        });
        return {
          content: [
            {
              type: "text",
              text: withFlushNotice(
                `Feedback recorded as ${record.id} (kind=${record.kind}, source=${record.sourceProject ?? "(unknown)"}).\nWritten to: ${path}\n\nApex-engine will auto-flush this to a GitHub Issue on the next interval. If you want to publish it immediately, run \`pnpm feedback:flush\` in the apex-engine repo.`,
              ),
            },
          ],
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return {
          content: [
            { type: "text", text: withFlushNotice(`Failed to record feedback: ${msg}`) },
          ],
        };
      }
    },
  );

  server.tool(
    "apex_self_check",
    "Report whether this MCP server is running the latest apex-engine code. Captures git HEAD at server startup and compares to the current HEAD on disk. Use this when you suspect a recently-added tool or bug fix isn't being picked up — under HTTP transport (the default after Wave 9), tsx watch should respawn the server automatically; under stdio, a Claude Code restart is required.",
    {},
    async () => {
      const result = selfCheck(REGISTERED_TOOL_NAMES);
      return {
        content: [{ type: "text", text: withFlushNotice(formatSelfCheckReport(result)) }],
      };
    },
  );

  server.tool(
    "apex_qa_review",
    "Run the apex-engine QA suite on demand: type-check + tests (build skipped by default for latency). Streams the pass/fail summary back. On failure, writes an auto-feedback bug record to data/feedback/outbox/ so the regression converges with all other feedback. Use this from any Claude Code session whenever you want to verify apex-engine code is healthy without waiting for the post-commit hook.",
    {
      includeBuild: z
        .boolean()
        .default(false)
        .describe(
          "If true, also run `pnpm build`. Default false because the build adds ~10s. Set true before publishing or after dep changes.",
        ),
    },
    async ({ includeBuild }) => {
      const env = { ...process.env };
      if (!includeBuild) env.APEX_QA_SKIP_BUILD = "1";
      const r = spawnSync("pnpm", ["qa:check"], {
        cwd: process.cwd(),
        encoding: "utf8",
        env,
      });
      const tail = `${r.stdout ?? ""}\n${r.stderr ?? ""}`
        .split("\n")
        .slice(-60)
        .join("\n");
      const status =
        r.status === 0 ? "✓ all checks passed" : `✗ exit code ${r.status}`;
      return {
        content: [
          {
            type: "text",
            text: withFlushNotice(`${status}\n\n\`\`\`\n${tail}\n\`\`\``),
          },
        ],
      };
    },
  );

  server.tool(
    "apex_security_review",
    "Run the apex-engine security checker: secret-scan over tracked files, pnpm audit for dep vulnerabilities (high/critical), and apex-specific invariants (no prompt content can land in feedback records, no console.log of prompts in catch blocks). On failure, writes an auto-feedback bug record with severity. Use alongside apex_qa_review whenever code or dependencies change.",
    {},
    async () => {
      const r = runScript("security:check", []);
      const tail = `${r.stdout}\n${r.stderr}`.split("\n").slice(-60).join("\n");
      const status = r.ok ? "✓ all security checks passed" : `✗ exit code ${r.exitCode}`;
      return {
        content: [
          {
            type: "text",
            text: withFlushNotice(`${status}\n\n\`\`\`\n${tail}\n\`\`\``),
          },
        ],
      };
    },
  );

  server.tool(
    "apex_history_search",
    "Search apex-engine's persistent conversation history via FTS5 (bm25-ranked). Use this when you want to find prior Q+A on a topic, recall what apex-engine answered before, or check if a similar question was already asked. Searches every column the FTS index covers (prompt + synth answer). Returns the matching entries with their id, age, prompt, the best answer (synth → claude → openai → llama → gemini fallback chain), and any tags. Most useful: \"have we asked about X before?\", \"what did the synth conclude about Y?\", or \"show me starred entries containing Z\".",
    {
      query: z
        .string()
        .min(1)
        .describe(
          "FTS5 search query. Whitespace-separated tokens are OR-combined with prefix matching. Examples: \"iPhone microscope\", \"rust async runtime\", \"MCP transport\".",
        ),
      limit: z
        .number()
        .int()
        .min(1)
        .max(50)
        .default(10)
        .describe("Max results (1-50). Default 10."),
      starredOnly: z
        .boolean()
        .default(false)
        .describe("If true, restrict to entries the user has starred."),
      ageDays: z
        .number()
        .int()
        .min(1)
        .optional()
        .describe(
          "If set, only return entries from the last N days. Useful for recent-context recall.",
        ),
    },
    async ({ query, limit, starredOnly, ageDays }) => {
      const fromMs =
        typeof ageDays === "number"
          ? Date.now() - ageDays * 24 * 60 * 60 * 1000
          : undefined;
      let results: HistoryEntry[];
      try {
        results = listHistory({
          q: query,
          limit,
          starred: starredOnly,
          ...(fromMs !== undefined ? { fromMs } : {}),
        });
      } catch (err) {
        return {
          content: [
            {
              type: "text",
              text: withFlushNotice(
                `apex_history_search failed: ${err instanceof Error ? err.message : String(err)}`,
              ),
            },
          ],
        };
      }
      if (results.length === 0) {
        return {
          content: [
            {
              type: "text",
              text: withFlushNotice(
                `No history entries match "${query}"${starredOnly ? " (starred only)" : ""}${ageDays ? ` in the last ${ageDays} days` : ""}.`,
              ),
            },
          ],
        };
      }
      const lines = [
        `# Found ${results.length} match${results.length === 1 ? "" : "es"} for "${query}"`,
        "",
      ];
      for (const e of results) {
        const ageMs = Date.now() - e.createdAt;
        const ageHours = Math.round(ageMs / (60 * 60_000));
        const age =
          ageHours < 24
            ? `${ageHours}h ago`
            : `${Math.round(ageHours / 24)}d ago`;
        const best =
          e.synthText ??
          e.answers.claude?.text ??
          e.answers.openai?.text ??
          e.answers.llama?.text ??
          e.answers.gemini?.text ??
          "(no answer)";
        const bestSnippet =
          best.length > 600 ? `${best.slice(0, 597).trimEnd()}…` : best;
        const star = e.starred ? "★ " : "";
        const tagLabel = e.tags.length > 0 ? ` [${e.tags.join(", ")}]` : "";
        lines.push(`## ${star}#${e.id} · ${age}${tagLabel}`);
        lines.push(`**Q:** ${e.prompt}`);
        lines.push("");
        lines.push(`**Best answer:**`);
        lines.push(bestSnippet);
        lines.push("");
        lines.push("---");
        lines.push("");
      }
      return {
        content: [
          { type: "text", text: withFlushNotice(lines.join("\n")) },
        ],
      };
    },
  );
}

// Auto-flush feedback records → GitHub Issues. Called by both transport
// entry points after they're ready to serve requests. Errors are swallowed
// inside flushAll's exponential backoff. Set APEX_NO_AUTO_FLUSH=1 to
// disable.
export function startAutoFlush(opts: { logTag: string } = { logTag: "mcp" }): () => void {
  if (process.env.APEX_NO_AUTO_FLUSH === "1") {
    return () => {};
  }
  const FLUSH_INTERVAL_MS = (() => {
    const raw = process.env.APEX_FLUSH_INTERVAL_MS;
    if (!raw) return 30 * 60_000;
    const n = Number(raw);
    return Number.isFinite(n) && n >= 10_000 ? n : 30 * 60_000;
  })();
  const tickFlush = async () => {
    try {
      const { flushAll } = await import("@/lib/feedback-flush");
      const s = flushAll();
      if (s.attempted > 0 || s.failed > 0) {
        console.error(
          `[${opts.logTag}] auto-flush: attempted=${s.attempted} succeeded=${s.succeeded} failed=${s.failed} skipped=${s.skipped} reason=${s.reason}`,
        );
      }
    } catch (err) {
      console.error(
        `[${opts.logTag}] auto-flush threw (suppressed): ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  };
  const bootHandle = setTimeout(tickFlush, 5_000);
  const intervalHandle = setInterval(tickFlush, FLUSH_INTERVAL_MS);
  intervalHandle.unref();
  return () => {
    clearTimeout(bootHandle);
    clearInterval(intervalHandle);
  };
}
