import { generateObject } from "ai";
import { groq } from "@ai-sdk/groq";
import { z } from "zod";

// Cheap pre-flight rewriter — gpt-oss-20b on Groq (~300ms). Only call when
// the heuristic classifier flags the prompt as ambiguous (≥ 0.4). The user
// ALWAYS sees the diff and chooses original vs rewritten — never silently
// mutate (Claude review's hard rule from HANDOFF).
//
// Cost: free on Groq's RPD tier; effectively zero shadow cost otherwise.

// All zod object fields are required (no .default([])) to keep Groq's
// strict JSON schema validator happy — same fix as the apex_decompose bug.
const rewriteSchema = z.object({
  rewritten: z
    .string()
    .describe(
      "The clarified prompt. Preserves the user's intent exactly; resolves vague pronouns; adds concrete subject and outcome. ALWAYS include this field — if no rewrite is needed, repeat the original verbatim.",
    ),
  reasoning: z
    .string()
    .describe(
      "One short sentence explaining what was made clearer. Empty string when needed=false.",
    ),
  needed: z
    .boolean()
    .describe(
      "true when the rewrite materially clarifies the prompt; false when the original is already specific.",
    ),
});

export type RewriteResult = z.infer<typeof rewriteSchema>;

export async function rewritePrompt(
  prompt: string,
  signal?: AbortSignal,
): Promise<RewriteResult> {
  try {
    const { object } = await generateObject({
      model: groq("openai/gpt-oss-20b"),
      schema: rewriteSchema,
      abortSignal: signal,
      prompt: `You are a prompt-clarification assistant. The user typed a prompt that may be vague or under-specified. Your job is to rewrite it once into a clear, concrete prompt that another LLM can answer well — WITHOUT changing the user's intent.

Rules:
- ALWAYS return all three fields (rewritten, reasoning, needed). If the original is already specific, set needed=false, rewritten to the original verbatim, and reasoning to an empty string.
- Resolve vague pronouns ("it", "this", "that thing") to concrete nouns ONLY when you can infer them from the prompt itself. Never invent a subject.
- Keep the same tone, audience, and language as the original.
- Do not add new tasks, code samples, or constraints the user didn't imply.
- One rewrite. Do not enumerate options.
- Maximum 2× the length of the original.

User's prompt:

${prompt}`,
    });
    // Sanity: if the model returns needed=true but rewritten === prompt,
    // downgrade to needed=false. The UI would otherwise show a "no-op"
    // diff which is confusing.
    if (object.needed && object.rewritten.trim() === prompt.trim()) {
      return { ...object, needed: false };
    }
    return object;
  } catch {
    // On any failure (network, schema reject, abort), fall back to "not
    // needed" with the original prompt. Never block the user's submit on a
    // rewriter outage.
    return { rewritten: prompt, reasoning: "", needed: false };
  }
}

// Threshold for engaging the rewriter at all. Below this, classify() is
// confident the prompt is specific enough; the LLM call is skipped.
export const REWRITER_AMBIGUITY_THRESHOLD = 0.4;
