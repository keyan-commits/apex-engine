// Wave 21c — ack-token strip extracted from /api/ask's chunk loop.
//
// Background: Wave 20b added a `[grounded]` / `[ungrounded]` ack-token
// instruction to user prompts when web grounding fires. The server-side
// chunk loop strips the leading token before forwarding the stream to
// the client and emits a `grounded-ack` SSE event with the parsed flag.
//
// Wave 21c reason for extraction: the openai content-filter substitution
// path (Wave 20c) runs a SEPARATE for-await loop on a substitute stream,
// and that loop did NOT carry the ack-strip logic. Under web-grounding +
// Azure-content-filter combo, the substitute stream's literal `[grounded]`
// leaked through to the user AND the grounded-ack event never fired,
// desynchronizing the UI badge. Extracting the logic into reusable
// helpers lets both the primary stream and the substitute stream share
// the same machinery.

import type { Provider } from "./providers";
import type { SseEvent } from "./sse";

export type AckState = {
  stripped: boolean;
  buffer: string;
  emitted: boolean;
};

export const ACK_BUFFER_CAP = 256;
const ACK_TOKEN_RE = /^\s*\[(grounded|ungrounded)\]\s*\n?/i;

export function createAckState(): AckState {
  return { stripped: false, buffer: "", emitted: false };
}

type AckAcc = { text: string };

/**
 * Process a single streamed chunk through the ack-strip pipeline.
 *
 * Mutates `acc.text` (appends pre-strip, then overwrites with the post-
 * strip remainder if the buffer overflows / a newline is hit). Mutates
 * `state` (buffer / stripped / emitted). Calls `send` with a
 * `grounded-ack` event when the ack is detected or definitively missed,
 * and with `delta` events for any text that should be forwarded to the
 * client.
 *
 * Caller passes `ackActive=false` to bypass the strip entirely (web
 * grounding off → no ack instruction was injected → don't try to parse).
 */
export function applyAckChunk(opts: {
  chunk: string;
  acc: AckAcc;
  state: AckState;
  provider: Provider;
  send: (event: SseEvent) => void;
  ackActive: boolean;
}): void {
  const { chunk, acc, state, provider, send, ackActive } = opts;
  if (!ackActive) {
    acc.text += chunk;
    if (chunk) send({ type: "delta", provider, text: chunk });
    return;
  }
  acc.text += chunk;
  let toSend = chunk;
  if (!state.stripped) {
    state.buffer += chunk;
    const newlineIdx = state.buffer.indexOf("\n");
    const overCap = state.buffer.length >= ACK_BUFFER_CAP;
    if (newlineIdx !== -1 || overCap) {
      const m = ACK_TOKEN_RE.exec(state.buffer);
      let flag: boolean | null;
      let remainder: string;
      if (m) {
        flag = m[1].toLowerCase() === "grounded";
        remainder = state.buffer.slice(m[0].length);
      } else {
        // No ack token found in the first chunk(s) up to the newline /
        // buffer cap. The provider ignored the instruction — likely an
        // older or smaller model. Emit a null-flag ack so UI shows
        // "no-ack" and forward the buffered text unchanged.
        flag = null;
        remainder = state.buffer;
      }
      send({ type: "grounded-ack", provider, grounded: flag });
      state.emitted = true;
      state.stripped = true;
      state.buffer = "";
      acc.text = remainder;
      toSend = remainder;
    } else {
      // Still buffering — emit nothing yet.
      toSend = "";
    }
  }
  if (toSend) {
    send({ type: "delta", provider, text: toSend });
  }
}

/**
 * Called when the stream ends without ever having flushed the ack
 * buffer — happens when the provider's full response was < ACK_BUFFER_CAP
 * chars AND contained no newline. Drains the buffered text to the
 * client as a single delta event plus emits a null-flag ack.
 */
export function applyAckFlush(opts: {
  acc: AckAcc;
  state: AckState;
  provider: Provider;
  send: (event: SseEvent) => void;
  ackActive: boolean;
}): void {
  if (!opts.ackActive) return;
  if (opts.state.stripped || !opts.state.buffer) return;
  opts.send({ type: "grounded-ack", provider: opts.provider, grounded: null });
  opts.send({ type: "delta", provider: opts.provider, text: opts.state.buffer });
  opts.acc.text = opts.state.buffer;
  opts.state.stripped = true;
}
