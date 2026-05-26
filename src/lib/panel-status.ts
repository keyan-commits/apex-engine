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

import { REVIEW_PANEL_ASSIGNMENTS } from "./personas";
import type { PersonaSlot } from "./project-context";
import type { Provider } from "./providers";

export type PanelStatusEntry = {
  slot: PersonaSlot;
  provider: Provider;
  ok: boolean;
  reason?: string;
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
      });
      continue;
    }
    const hasText = (a.text ?? "").trim().length > 0;
    if (a.error) {
      out.push({ slot, provider, ok: false, reason: a.error });
    } else if (!hasText) {
      out.push({
        slot,
        provider,
        ok: false,
        reason: "empty response (possible timeout pre-stream)",
      });
    } else {
      out.push({ slot, provider, ok: true });
    }
  }
  return out;
}

export function formatPanelStatusBlock(status: PanelStatusEntry[]): string {
  const lines: string[] = ["[PERSONA PANEL STATUS]"];
  for (const e of status) {
    if (e.ok) {
      lines.push(`- ${e.slot} (${e.provider}): ok`);
    } else {
      lines.push(`- ${e.slot} (${e.provider}): UNAVAILABLE — ${e.reason ?? "unknown"}`);
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
