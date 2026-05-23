import { generateObject, generateText } from "ai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { groq } from "@ai-sdk/groq";
import { z } from "zod";

const githubModels = createOpenAICompatible({
  name: "github-models",
  baseURL: "https://models.github.ai/inference",
  apiKey: process.env.GITHUB_MODELS_TOKEN,
});

export const MAX_SUBQUESTIONS = 3;
export const MAX_DEPTH = 2;

const planSchema = z.object({
  subquestions: z
    .array(
      z.object({
        id: z.number().int().min(1),
        text: z.string().min(3),
        depends_on: z.array(z.number().int().min(1)).default([]),
      }),
    )
    .min(1)
    .max(MAX_SUBQUESTIONS),
});

export type SubagentNode = {
  id: number;
  text: string;
  dependsOn: number[];
  status: "pending" | "running" | "done" | "error";
  answer: string;
  error?: string;
};

export type DecomposeResult =
  | { ok: true; nodes: SubagentNode[] }
  | { ok: false; reason: string };

export async function decompose(
  prompt: string,
  signal?: AbortSignal,
): Promise<DecomposeResult> {
  try {
    const { object } = await generateObject({
      model: groq("openai/gpt-oss-120b"),
      schema: planSchema,
      abortSignal: signal,
      prompt: `Decompose the following user request into AT MOST ${MAX_SUBQUESTIONS} self-contained sub-questions whose answers, taken together, would let a synthesizer produce the best final answer.

Rules:
- Prefer independent sub-questions (depends_on: []). Only set depends_on when one truly cannot be answered without another.
- Use small integer ids starting at 1.
- depends_on must reference smaller ids only — never your own id, never a forward reference, no cycles.
- If the prompt is already a single tight question, return exactly one sub-question equal to the prompt.

User request:

${prompt}`,
    });
    const validation = validateDag(object.subquestions);
    if (!validation.ok) return validation;

    const nodes: SubagentNode[] = object.subquestions.map((q) => ({
      id: q.id,
      text: q.text,
      dependsOn: q.depends_on ?? [],
      status: "pending",
      answer: "",
    }));
    return { ok: true, nodes };
  } catch (err) {
    return {
      ok: false,
      reason: err instanceof Error ? err.message : "planner failed",
    };
  }
}

export function validateDag(
  qs: Array<{ id: number; text: string; depends_on: number[] }>,
):
  | { ok: true }
  | { ok: false; reason: string } {
  const ids = new Set(qs.map((q) => q.id));
  for (const q of qs) {
    if (q.depends_on.includes(q.id)) {
      return { ok: false, reason: `self-dep on ${q.id}` };
    }
    for (const d of q.depends_on) {
      if (!ids.has(d)) return { ok: false, reason: `unknown dep ${d}` };
      if (d >= q.id) return { ok: false, reason: `forward/cycle dep ${q.id}→${d}` };
    }
  }
  if (depthOf(qs) > MAX_DEPTH) {
    return { ok: false, reason: `depth exceeds ${MAX_DEPTH}` };
  }
  return { ok: true };
}

function depthOf(
  qs: Array<{ id: number; depends_on: number[] }>,
): number {
  const depthById = new Map<number, number>();
  for (const q of qs) {
    if (q.depends_on.length === 0) {
      depthById.set(q.id, 0);
    } else {
      const parentDepth = Math.max(
        ...q.depends_on.map((d) => depthById.get(d) ?? 0),
      );
      depthById.set(q.id, parentDepth + 1);
    }
  }
  return Math.max(0, ...depthById.values());
}

export type SubagentProgress = (node: SubagentNode) => void;

async function runMiniFanout(
  question: string,
  contextBlocks: string,
  signal?: AbortSignal,
): Promise<string> {
  const promptWithContext = contextBlocks
    ? `${contextBlocks}\n\n---\n\n### Question\n\n${question}`
    : question;
  const calls = await Promise.allSettled([
    generateText({
      model: githubModels("openai/gpt-4o-mini"),
      prompt: promptWithContext,
      abortSignal: signal,
    }),
    generateText({
      model: groq("llama-3.3-70b-versatile"),
      prompt: promptWithContext,
      abortSignal: signal,
    }),
  ]);
  const answers = calls
    .filter((r) => r.status === "fulfilled")
    .map((r) => (r as PromiseFulfilledResult<{ text: string }>).value.text.trim())
    .filter((t) => t.length > 0);
  if (answers.length === 0) {
    const reason = calls
      .filter((r): r is PromiseRejectedResult => r.status === "rejected")
      .map((r) => (r.reason instanceof Error ? r.reason.message : String(r.reason)))
      .join("; ");
    throw new Error(`mini-fanout failed: ${reason || "no answers"}`);
  }
  if (answers.length === 1) return answers[0];

  // Mini-synth via gpt-oss-120b.
  const { text } = await generateText({
    model: groq("openai/gpt-oss-120b"),
    abortSignal: signal,
    prompt: `Two AI models answered the same question. Produce a single consolidated answer drawing on the strongest parts of each. No preamble.

## Question
${question}

## Model A
${answers[0]}

## Model B
${answers[1]}

## Best consolidated answer`,
  });
  return text.trim();
}

export async function executeSubagents(
  nodes: SubagentNode[],
  onProgress: SubagentProgress,
  signal?: AbortSignal,
): Promise<void> {
  // Group by level (max-depth of dependencies).
  const levels = new Map<number, SubagentNode[]>();
  const depthOf = (n: SubagentNode, memo: Map<number, number>): number => {
    if (memo.has(n.id)) return memo.get(n.id)!;
    if (n.dependsOn.length === 0) {
      memo.set(n.id, 0);
      return 0;
    }
    const d = 1 + Math.max(
      ...n.dependsOn.map((id) => {
        const dep = nodes.find((x) => x.id === id);
        return dep ? depthOf(dep, memo) : 0;
      }),
    );
    memo.set(n.id, d);
    return d;
  };
  const memo = new Map<number, number>();
  for (const n of nodes) {
    const lvl = depthOf(n, memo);
    if (!levels.has(lvl)) levels.set(lvl, []);
    levels.get(lvl)!.push(n);
  }

  const sortedLevels = [...levels.keys()].sort((a, b) => a - b);
  for (const lvl of sortedLevels) {
    if (signal?.aborted) break;
    const batch = levels.get(lvl)!;
    await Promise.all(
      batch.map(async (n) => {
        if (signal?.aborted) {
          n.status = "error";
          n.error = "cancelled";
          onProgress(n);
          return;
        }
        n.status = "running";
        onProgress(n);
        const ctx = n.dependsOn
          .map((id) => {
            const parent = nodes.find((x) => x.id === id);
            if (!parent) return "";
            return `### Earlier sub-question (#${id}): ${parent.text}\n\n${parent.answer}`;
          })
          .filter(Boolean)
          .join("\n\n");
        try {
          n.answer = await runMiniFanout(n.text, ctx, signal);
          n.status = "done";
        } catch (err) {
          n.status = "error";
          n.error = err instanceof Error ? err.message : String(err);
        }
        onProgress(n);
      }),
    );
  }
}

export function nodesToBriefing(nodes: SubagentNode[]): string {
  return nodes
    .map((n) => {
      const status = n.status === "done" ? n.answer : n.error ?? "(no answer)";
      return `### Sub-question #${n.id}: ${n.text}\n\n${status}`;
    })
    .join("\n\n---\n\n");
}
