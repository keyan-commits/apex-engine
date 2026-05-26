import type { Provider, Tier } from "./providers";
import type { RoleId } from "./roles";

export type SseEvent =
  | {
      type: "open";
      provider: Provider;
      tier: Tier;
      model: string;
      role?: RoleId | null;
      cached?: boolean;
    }
  | { type: "delta"; provider: Provider; text: string }
  | {
      // Wave 20b — emitted ONCE per provider when web grounding was
      // active for the request. `grounded` reflects the provider's
      // self-reported answer to "did you use the web-context block?":
      // true if it emitted `[grounded]` at start, false if `[ungrounded]`.
      // null when the provider didn't emit the ack token at all (older
      // model that ignored the instruction). UI shows a small badge
      // next to the provider label; synth uses the flags to detect
      // silently-ignoring-the-context failures.
      type: "grounded-ack";
      provider: Provider;
      grounded: boolean | null;
    }
  | {
      // Wave 20c — emitted when the openai slot was rejected by
      // Azure's content management policy and apex retried via the
      // configured fallback model (openai/gpt-oss-120b via Groq).
      // UI tags the panel with "GPT · substituted: <model>". Synth
      // sees the substitution in [PROVIDER STATUS] and attributes the
      // answer to the substitute model's perspective (not GPT's).
      type: "substituted";
      provider: Provider;
      substituteModel: string;
      reason: string;
    }
  | { type: "done"; provider: Provider; latencyMs?: number }
  | { type: "error"; provider: Provider | "synthesizer"; message: string }
  | { type: "warning"; message: string }
  | { type: "cancelled" }
  | { type: "synth-open" }
  | { type: "synth-delta"; text: string }
  | { type: "synth-done"; latencyMs?: number }
  | { type: "history-saved"; id: number }
  | {
      type: "classified";
      complexity: "simple" | "medium" | "complex";
      ambiguity: number;
      // When true, only one provider (Llama by default) was run and the
      // synth was skipped. UI should render the other panels as
      // "Skipped — simple query" with an override affordance.
      soloMode: boolean;
      signals: string[];
    }
  | {
      // Wave 14 — server auto-detected a follow-up to a prior history
      // entry and threaded its context in. UI renders an "Auto-threaded
      // from #<id>" chip with an undo affordance.
      type: "follow-up-detected";
      parentId: number;
      parentPromptSnippet: string;
      confidence: "high" | "medium";
      signals: string[];
    }
  | {
      // Wave 17b — server ran apex_web_search and prepended the results
      // to every fan-out provider's prompt. UI renders a 🌐 grounded
      // badge on the synth panel.
      type: "web-grounded";
      provider: "tavily" | "ddg";
      query: string;
      resultCount: number;
      reason: string;
    }
  | {
      type: "subagent-plan";
      nodes: Array<{
        id: number;
        text: string;
        dependsOn: number[];
        status: string;
        answer: string;
        error?: string;
      }>;
    }
  | {
      type: "subagent-update";
      id: number;
      status: string;
      answer?: string;
      error?: string;
    };

export function encodeSse(event: SseEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

export async function* parseSse(res: Response): AsyncGenerator<SseEvent> {
  if (!res.body) throw new Error("response has no body");
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buffer.indexOf("\n\n")) !== -1) {
      const block = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      const line = block.split("\n").find((l) => l.startsWith("data: "));
      if (!line) continue;
      try {
        yield JSON.parse(line.slice(6)) as SseEvent;
      } catch {
        // skip malformed
      }
    }
  }
}
