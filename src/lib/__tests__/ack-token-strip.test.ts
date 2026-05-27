import { describe, expect, it, vi } from "vitest";
import {
  applyAckChunk,
  applyAckFlush,
  createAckState,
} from "../ack-token-strip";
import type { SseEvent } from "../sse";

function captureSend() {
  const events: SseEvent[] = [];
  const send = (e: SseEvent) => {
    events.push(e);
  };
  return { events, send };
}

describe("applyAckChunk + applyAckFlush — Wave 21c extraction", () => {
  it("when ackActive=false, appends chunk verbatim + emits delta", () => {
    const { events, send } = captureSend();
    const acc = { text: "" };
    const state = createAckState();
    applyAckChunk({
      chunk: "[grounded]\nhello",
      acc,
      state,
      provider: "openai",
      send,
      ackActive: false,
    });
    // Token NOT stripped because ackActive=false.
    expect(acc.text).toBe("[grounded]\nhello");
    expect(events).toEqual([
      { type: "delta", provider: "openai", text: "[grounded]\nhello" },
    ]);
  });

  it("strips [grounded] and emits grounded-ack with true on a single-chunk arrival", () => {
    const { events, send } = captureSend();
    const acc = { text: "" };
    const state = createAckState();
    applyAckChunk({
      chunk: "[grounded]\nThe answer is X.",
      acc,
      state,
      provider: "claude",
      send,
      ackActive: true,
    });
    expect(state.stripped).toBe(true);
    expect(acc.text).toBe("The answer is X.");
    expect(events).toEqual([
      { type: "grounded-ack", provider: "claude", grounded: true },
      { type: "delta", provider: "claude", text: "The answer is X." },
    ]);
  });

  it("strips [ungrounded] and emits grounded-ack with false", () => {
    const { events, send } = captureSend();
    const acc = { text: "" };
    const state = createAckState();
    applyAckChunk({
      chunk: "[ungrounded]\nNo web data.",
      acc,
      state,
      provider: "openai",
      send,
      ackActive: true,
    });
    expect(events[0]).toEqual({
      type: "grounded-ack",
      provider: "openai",
      grounded: false,
    });
    expect(acc.text).toBe("No web data.");
  });

  it("emits null grounded-ack when first line has no ack token", () => {
    const { events, send } = captureSend();
    const acc = { text: "" };
    const state = createAckState();
    applyAckChunk({
      chunk: "Hello world\nNo ack token here.",
      acc,
      state,
      provider: "llama",
      send,
      ackActive: true,
    });
    expect(events[0]).toEqual({
      type: "grounded-ack",
      provider: "llama",
      grounded: null,
    });
    expect(acc.text).toBe("Hello world\nNo ack token here.");
  });

  it("buffers across multiple chunks until newline arrives", () => {
    const { events, send } = captureSend();
    const acc = { text: "" };
    const state = createAckState();
    // First chunk: just "[grou"
    applyAckChunk({
      chunk: "[grou",
      acc,
      state,
      provider: "claude",
      send,
      ackActive: true,
    });
    expect(events).toEqual([]); // still buffering, nothing emitted yet
    expect(state.stripped).toBe(false);
    // Second chunk: "nded]\nrest"
    applyAckChunk({
      chunk: "nded]\nrest",
      acc,
      state,
      provider: "claude",
      send,
      ackActive: true,
    });
    expect(state.stripped).toBe(true);
    expect(acc.text).toBe("rest");
    expect(events).toEqual([
      { type: "grounded-ack", provider: "claude", grounded: true },
      { type: "delta", provider: "claude", text: "rest" },
    ]);
  });

  it("subsequent chunks after strip pass through unchanged", () => {
    const { events, send } = captureSend();
    const acc = { text: "" };
    const state = createAckState();
    applyAckChunk({
      chunk: "[grounded]\n",
      acc,
      state,
      provider: "claude",
      send,
      ackActive: true,
    });
    expect(state.stripped).toBe(true);
    // Reset captured events for clarity
    events.length = 0;
    applyAckChunk({
      chunk: "another chunk",
      acc,
      state,
      provider: "claude",
      send,
      ackActive: true,
    });
    expect(events).toEqual([
      { type: "delta", provider: "claude", text: "another chunk" },
    ]);
    expect(acc.text).toBe("another chunk");
  });

  it("flushes pending buffer when stream ends short (no newline, < cap)", () => {
    const { events, send } = captureSend();
    const acc = { text: "" };
    const state = createAckState();
    // Provider responded with a short blob, no newline.
    applyAckChunk({
      chunk: "yes",
      acc,
      state,
      provider: "deepseek",
      send,
      ackActive: true,
    });
    // Buffering; nothing emitted.
    expect(events).toEqual([]);
    expect(state.stripped).toBe(false);
    // Stream ends — caller invokes flush.
    applyAckFlush({
      acc,
      state,
      provider: "deepseek",
      send,
      ackActive: true,
    });
    expect(events).toEqual([
      { type: "grounded-ack", provider: "deepseek", grounded: null },
      { type: "delta", provider: "deepseek", text: "yes" },
    ]);
    expect(acc.text).toBe("yes");
    expect(state.stripped).toBe(true);
  });

  it("flush is a no-op when state already stripped", () => {
    const { events, send } = captureSend();
    const acc = { text: "x" };
    const state = createAckState();
    state.stripped = true; // simulate post-strip
    applyAckFlush({
      acc,
      state,
      provider: "openai",
      send,
      ackActive: true,
    });
    expect(events).toEqual([]);
  });

  it("flush is a no-op when ackActive=false", () => {
    const { events, send } = captureSend();
    const acc = { text: "" };
    const state = createAckState();
    state.buffer = "leftover"; // would otherwise flush
    applyAckFlush({
      acc,
      state,
      provider: "openai",
      send,
      ackActive: false,
    });
    expect(events).toEqual([]);
  });

  it("the substitute-stream regression: same machinery works on a SECOND stream sharing the state", () => {
    // Wave 21c root cause: substitute stream reused acc but NOT
    // ackState, so the substitute's [grounded] token leaked. This test
    // simulates the fixed behavior: primary errors before yielding;
    // substitute reuses the same fresh ack state.
    const { events, send } = captureSend();
    const acc = { text: "" };
    const state = createAckState(); // freshly initialized for the slot
    // Primary errored immediately (no chunks). State is unchanged.
    // Now the substitute stream's first chunk arrives:
    applyAckChunk({
      chunk: "[grounded]\nSubstituted answer.",
      acc,
      state,
      provider: "openai",
      send,
      ackActive: true,
    });
    // Substitute's token stripped; ack event fired under "openai" slot.
    expect(events).toContainEqual({
      type: "grounded-ack",
      provider: "openai",
      grounded: true,
    });
    expect(acc.text).toBe("Substituted answer.");
  });

  it("256-char buffer cap triggers a null ack when no newline arrives", () => {
    const { events, send } = captureSend();
    const acc = { text: "" };
    const state = createAckState();
    // 300 chars, no newline, no ack token.
    const long = "x".repeat(300);
    applyAckChunk({
      chunk: long,
      acc,
      state,
      provider: "gemini",
      send,
      ackActive: true,
    });
    // Cap reached → null ack emitted, full buffer forwarded.
    expect(events).toEqual([
      { type: "grounded-ack", provider: "gemini", grounded: null },
      { type: "delta", provider: "gemini", text: long },
    ]);
    expect(acc.text).toBe(long);
    expect(state.stripped).toBe(true);
  });
});
