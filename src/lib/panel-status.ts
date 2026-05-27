// Wave 19a — persona panel status reporting.
//
// Inspects each fan-out answer, finds the persona it was assigned to,
// and reports whether the slot returned a real review or errored /
// produced empty text. The synth uses this to enforce the "loud
// degrade" rule in CODE_REVIEW_SYNTH_SYSTEM_PROMPT — refuses to issue
// a clean verdict when business-logic (or any grounded persona) is
// missing.
//
// Real failure caught (GH issue #23): every panel review timed out the
// Claude slot, which is the business-logic persona. Without per-slot
// status reporting, the synth silently produced a confident verdict
// from context-blind models. The status block makes the gap loud.

import { classifyError, type ErrorKind } from "./errors";
import { REVIEW_PANEL_ASSIGNMENTS } from "./personas";
import type { PersonaSlot } from "./project-context";
import type { Provider } from "./providers";

export type PanelStatusEntry = {
  slot: PersonaSlot;
  provider: Provider;
  ok: boolean;
  reason?: string;
  // Wave 22d (#22 ask) — classified kind for the error so callers
  // can distinguish "timeout" vs "rate-limited" vs "quota-exhausted"
  // in the formatted output. LFM: "a per-slot soft-timeout note in
  // the output (vs a bare 'operation aborted') would make it clearer
  // the panel ran 4/5".
  errorKind?: ErrorKind | "missing" | "empty";
};

type AnswerLike = {
  provider: Provider;
  text: string;
  error: string | null;
};

export function buildPanelStatus(
  answers: AnswerLike[],
  includeClaude: boolean,
): PanelStatusEntry[] {
  const out: PanelStatusEntry[] = [];
  for (const [provider, slot] of Object.entries(REVIEW_PANEL_ASSIGNMENTS) as [
    Provider,
    PersonaSlot,
  ][]) {
    // Skip Claude when the caller opted out — it's not a "missing
    // persona," it's a deliberate skip; the synth shouldn't loud-degrade.
    if (provider === "claude" && !includeClaude) continue;
    const a = answers.find((x) => x.provider === provider);
    if (!a) {
      out.push({
        slot,
        provider,
        ok: false,
        reason: "provider not in fan-out (likely disabled or env-gated)",
        errorKind: "missing",
      });
      continue;
    }
    const hasText = (a.text ?? "").trim().length > 0;
    if (a.error) {
      // Wave 22d — classify the error so the formatter can emit
      // "(timeout)" / "(rate-limited)" / "(quota-exhausted)" instead
      // of leaving the raw message as the only signal.
      const classified = classifyError(new Error(a.error));
      out.push({
        slot,
        provider,
        ok: false,
        reason: a.error,
        errorKind: classified.kind,
      });
    } else if (!hasText) {
      out.push({
        slot,
        provider,
        ok: false,
        reason: "empty response (possible timeout pre-stream)",
        errorKind: "empty",
      });
    } else {
      out.push({ slot, provider, ok: true });
    }
  }
  return out;
}

// Wave 22d — short human-readable label for the entry's failure
// state, used by the formatter and by tests. Pulled out so we can
// unit-test the classification → label mapping without going through
// formatPanelStatusBlock's full output string.
export function panelStatusEntryLabel(entry: PanelStatusEntry): string {
  if (entry.ok) return "ok";
  switch (entry.errorKind) {
    case "timeout":
      return "timed out";
    case "rate-limited":
      return "rate-limited";
    case "gemini-quota-exhausted":
      return "quota-exhausted";
    case "content-filter":
      return "content-filtered";
    case "unauthorized":
      return "unauthorized (API key issue)";
    case "forbidden":
      return "forbidden";
    case "aborted":
      return "aborted";
    case "network":
      return "network error";
    case "server":
      return "provider server error";
    case "empty":
      return "empty response (possible timeout pre-stream)";
    case "missing":
      return "not in fan-out (disabled or env-gated)";
    default:
      return "error";
  }
}

export function formatPanelStatusBlock(status: PanelStatusEntry[]): string {
  const lines: string[] = ["[PERSONA PANEL STATUS]"];
  for (const e of status) {
    if (e.ok) {
      lines.push(`- ${e.slot} (${e.provider}): ok`);
    } else {
      // Wave 22d — when the entry carries a classified errorKind,
      // surface the human label up front so the reader sees
      // "(timed out)" / "(rate-limited)" / "(quota-exhausted)"
      // immediately rather than parsing the raw upstream message.
      // LFM-filed #22 minor ask: "a per-slot soft-timeout note in
      // the output (vs a bare 'operation aborted') would make it
      // clearer the panel ran 4/5". Falls back to the historical
      // "UNAVAILABLE — <reason>" shape when errorKind is absent so
      // hand-built test entries + callers that construct
      // PanelStatusEntry directly stay compatible.
      const rawReason = e.reason ?? "unknown";
      if (e.errorKind) {
        const label = panelStatusEntryLabel(e);
        const labelHead = label.toLowerCase().split(" ")[0] ?? "";
        const showRaw =
          label !== rawReason &&
          !rawReason.toLowerCase().includes(labelHead);
        lines.push(
          `- ${e.slot} (${e.provider}): UNAVAILABLE (${label})${showRaw ? ` — ${rawReason}` : ""}`,
        );
      } else {
        lines.push(`- ${e.slot} (${e.provider}): UNAVAILABLE — ${rawReason}`);
      }
    }
  }
  const missing = status.filter((e) => !e.ok);
  if (missing.length > 0) {
    const missingSlots = missing.map((e) => e.slot).join(", ");
    lines.push("");
    lines.push(
      `IMPORTANT: ${missingSlots} persona(s) did NOT return a review. Per synth Rule 1, surface a clearly-marked "Persona unavailable" banner in the Summary and follow the Overall Risk Rating rules for missing personas (P0 if business-logic is missing on a data/rule/identity artifact).`,
    );
  }
  lines.push("[END PERSONA PANEL STATUS]");
  return lines.join("\n");
}

// Wave 19a — auto-switch synthesizer for panel-mode reviews. The
// default synth (gpt-oss-120b on Groq) has an 8K TPM ceiling that the
// 5-persona fan-in regularly exceeds — real failure caught in GH issue
// #24. Switch to claude-sonnet when available (Claude Code subscription,
// 200K context). Fall back to gpt-4o-mini (128K, GitHub Models free)
// when Claude is disabled.
export function resolvePanelSynthesizerId(includeClaude: boolean): string {
  if (includeClaude) return "claude-sonnet";
  return "gpt-4o-mini";
}
