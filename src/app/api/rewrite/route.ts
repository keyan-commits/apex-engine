import { classify } from "@/lib/classify";
import { logger } from "@/lib/log";
import { rewritePrompt, REWRITER_AMBIGUITY_THRESHOLD } from "@/lib/rewriter";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const log = logger("api/rewrite");

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as
    | { prompt?: unknown }
    | null;
  const prompt =
    typeof body?.prompt === "string" ? body.prompt.trim() : "";
  if (!prompt) {
    return Response.json({ error: "missing prompt" }, { status: 400 });
  }

  // Gate: skip the LLM call when the classifier is confident the prompt is
  // specific. The threshold is a tunable knob — start at 0.4.
  const classification = classify(prompt);
  if (classification.ambiguity < REWRITER_AMBIGUITY_THRESHOLD) {
    return Response.json({
      rewritten: prompt,
      reasoning: "",
      needed: false,
      ambiguity: classification.ambiguity,
      skipped: "low-ambiguity",
    });
  }

  const result = await rewritePrompt(prompt, req.signal);
  log.info(
    `rewrite: needed=${result.needed} ambiguity=${classification.ambiguity}`,
  );
  return Response.json({
    ...result,
    ambiguity: classification.ambiguity,
  });
}
