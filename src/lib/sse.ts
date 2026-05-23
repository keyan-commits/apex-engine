import type { Provider, Tier } from "./providers";

export type SseEvent =
  | { type: "open"; provider: Provider; tier: Tier; model: string }
  | { type: "delta"; provider: Provider; text: string }
  | { type: "done"; provider: Provider }
  | { type: "error"; provider: Provider | "synthesizer"; message: string }
  | { type: "synth-open" }
  | { type: "synth-delta"; text: string }
  | { type: "synth-done" };

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
