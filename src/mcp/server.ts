import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { fanOut, type FanOutItem } from "@/lib/engine";
import { saveHistory, type HistoryAnswer } from "@/lib/history";
import { PROVIDERS, PROVIDER_LABELS, type Provider } from "@/lib/providers";
import { findEnsemble } from "@/lib/roles";
import {
  decompose,
  executeSubagents,
  nodesToBriefing,
} from "@/lib/subagents";
import { synthesize, type FanOutAnswer } from "@/lib/synthesize";

// MCP servers communicate over stdio with JSON-RPC. Anything written to stdout
// outside the framed protocol will corrupt the stream. Redirect console.log → stderr.
const _origLog = console.log;
console.log = (...args: unknown[]) => console.error(...args);
void _origLog;

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
  opts: { includeClaude: boolean; ensembleId?: string },
): Promise<CollectedAnswer[]> {
  const ensemble = opts.ensembleId ? findEnsemble(opts.ensembleId) : undefined;
  const items = fanOut(prompt, {
    roles: ensemble?.assignments,
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

const server = new McpServer({
  name: "apex-engine",
  version: "0.1.0",
});

server.tool(
  "apex_fanout",
  "Fan out a prompt to multiple LLMs in parallel and return each model's individual answer. Models: GPT-4o-mini (via GitHub Models), Llama 3.3 70B (via Groq), Gemini 2.5 Flash (via AI Studio). Optionally include Claude via Claude Agent SDK (default off — avoids recursion when invoked from Claude Code). Optionally pass an ensembleId to assign roles (code-review / research / decision / brainstorm / legal / medical / marketing). Returns each model's response labeled by provider, separated by --- . Use when you want to compare how different LLMs answer the same question — cross-checking facts, diverse perspectives, research.",
  {
    prompt: z.string().describe("The question to ask all models."),
    includeClaude: z
      .boolean()
      .default(false)
      .describe(
        "Include the Claude slot via Claude Agent SDK. Default: false to avoid recursion when invoked from Claude Code itself.",
      ),
    ensembleId: z
      .string()
      .optional()
      .describe(
        "Optional ensemble id (code-review / research / decision / brainstorm / legal / medical / marketing). Assigns each model a distinct role.",
      ),
  },
  async ({ prompt, includeClaude, ensembleId }) => {
    const answers = await runFanOut(prompt, { includeClaude, ensembleId });
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
      content: [{ type: "text", text: formatAnswers(answers) }],
    };
  },
);

server.tool(
  "apex_synthesize",
  "Fan out a prompt to multiple LLMs and produce a single synthesized 'best answer' (Mixture-of-Agents pattern). Queries GPT / Llama / Gemini (and optionally Claude) in parallel, then sends all responses + original prompt to a synthesizer model (DeepSeek-R1-Distill 70B via Groq by default) which combines the strongest insights, resolves contradictions, and produces one polished answer. Returns the synthesized answer followed by each individual response for transparency. Use when you want the highest-quality consolidated answer from multiple models.",
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
  },
  async ({ prompt, includeClaude, synthesizerId }) => {
    const answers = await runFanOut(prompt, { includeClaude });
    // Note: ensembleId not exposed here — synthesizer flow is the same regardless.
    const synthInput: FanOutAnswer[] = answers.map((a) => ({
      provider: a.provider,
      text: a.text,
      error: a.error ?? undefined,
    }));

    const synthStart = Date.now();
    let synthText = "";
    let synthError: string | null = null;
    try {
      for await (const chunk of synthesize(prompt, synthInput, {
        synthesizerId,
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
          text: `${synthSection}\n\n---\n\n# Individual Responses\n\n${formatAnswers(answers)}`,
        },
      ],
    };
  },
);

server.tool(
  "apex_decompose",
  "Decompose a complex prompt into ≤3 sub-questions, answer each via a mini fan-out (gpt-4o-mini + Llama 3.3 70B + a mini-synth via gpt-oss-120b), then return a structured tree of sub-questions and their answers. Best for multi-part questions where pure parallel fan-out would lose structure.",
  {
    prompt: z.string().describe("The complex prompt to decompose."),
  },
  async ({ prompt }) => {
    const plan = await decompose(prompt);
    if (!plan.ok) {
      return {
        content: [
          { type: "text", text: `Planner failed: ${plan.reason}` },
        ],
      };
    }
    await executeSubagents(plan.nodes, () => {});
    const briefing = nodesToBriefing(plan.nodes);
    return {
      content: [{ type: "text", text: briefing }],
    };
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
console.error("[mcp] apex-engine MCP server connected on stdio");
