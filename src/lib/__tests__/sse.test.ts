import { describe, expect, it } from "vitest";
import { encodeSse, parseSse, type SseEvent } from "../sse";

function bodyFromChunks(chunks: string[]): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      for (const c of chunks) controller.enqueue(encoder.encode(c));
      controller.close();
    },
  });
  return new Response(stream);
}

async function collect<T>(gen: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const x of gen) out.push(x);
  return out;
}

describe("encodeSse", () => {
  it("wraps JSON in data:...\\n\\n framing", () => {
    const ev: SseEvent = { type: "synth-done" };
    expect(encodeSse(ev)).toBe(`data: {"type":"synth-done"}\n\n`);
  });
});

describe("parseSse", () => {
  it("parses a single event", async () => {
    const res = bodyFromChunks([`data: {"type":"synth-open"}\n\n`]);
    const events = await collect(parseSse(res));
    expect(events).toEqual([{ type: "synth-open" }]);
  });

  it("parses multiple events in one chunk", async () => {
    const res = bodyFromChunks([
      `data: {"type":"synth-open"}\n\ndata: {"type":"synth-done"}\n\n`,
    ]);
    expect(await collect(parseSse(res))).toEqual([
      { type: "synth-open" },
      { type: "synth-done" },
    ]);
  });

  it("handles events split across chunks", async () => {
    const res = bodyFromChunks([
      `data: {"type":"synth-`,
      `open"}\n\ndata: {"type":"synth-done"}\n\n`,
    ]);
    expect(await collect(parseSse(res))).toEqual([
      { type: "synth-open" },
      { type: "synth-done" },
    ]);
  });

  it("skips malformed JSON without breaking the stream", async () => {
    const res = bodyFromChunks([
      `data: not-json\n\ndata: {"type":"synth-done"}\n\n`,
    ]);
    expect(await collect(parseSse(res))).toEqual([{ type: "synth-done" }]);
  });

  it("skips blocks without a data: line", async () => {
    const res = bodyFromChunks([
      `event: ping\n\ndata: {"type":"synth-done"}\n\n`,
    ]);
    expect(await collect(parseSse(res))).toEqual([{ type: "synth-done" }]);
  });

  it("throws when response has no body", async () => {
    const res = new Response(null);
    await expect(collect(parseSse(res))).rejects.toThrow(/no body/);
  });
});
