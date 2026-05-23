import { getHistoryEntry, listHistory, type HistoryEntry } from "@/lib/history";
import { PROVIDER_LABELS, type Provider } from "@/lib/providers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function entryAsMarkdown(e: HistoryEntry): string {
  const ts = new Date(e.createdAt).toISOString();
  const lines: string[] = [];
  lines.push(`# Apex Entry #${e.id}`);
  lines.push(`*${ts}*`);
  if (e.ensembleId) lines.push(`*Ensemble: ${e.ensembleId}*`);
  if (e.starred) lines.push(`*★ starred*`);
  if (e.tags.length) lines.push(`*Tags: ${e.tags.join(", ")}*`);
  lines.push("");
  lines.push("## Prompt");
  lines.push("");
  lines.push(e.prompt);
  lines.push("");
  if (e.attachments && e.attachments.length) {
    lines.push("### Attachments");
    for (const a of e.attachments) {
      lines.push(`- ${a.name} (${a.mime}, ${a.size} bytes)`);
    }
    lines.push("");
  }
  for (const p of Object.keys(e.answers) as Provider[]) {
    const a = e.answers[p];
    lines.push(`## ${PROVIDER_LABELS[p]} — ${a.model || "(skipped)"}`);
    if (a.role) lines.push(`*Role: ${a.role}*`);
    if (a.latencyMs != null) lines.push(`*Latency: ${a.latencyMs}ms*`);
    lines.push("");
    if (a.error) lines.push(`> Error: ${a.error}`);
    else lines.push(a.text || "*(empty)*");
    lines.push("");
  }
  if (e.synthText) {
    lines.push("## Synthesized best answer");
    if (e.synthesizerId) lines.push(`*Synthesizer: ${e.synthesizerId}*`);
    lines.push("");
    lines.push(e.synthText);
    lines.push("");
  } else if (e.synthError) {
    lines.push("## Synthesized best answer");
    lines.push(`> Error: ${e.synthError}`);
    lines.push("");
  }
  return lines.join("\n");
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const format = url.searchParams.get("format") === "md" ? "md" : "json";
  const idParam = url.searchParams.get("id");

  if (idParam) {
    const id = Number(idParam);
    if (!Number.isFinite(id)) {
      return new Response(JSON.stringify({ error: "bad id" }), { status: 400 });
    }
    const entry = getHistoryEntry(id);
    if (!entry) {
      return new Response(JSON.stringify({ error: "not found" }), { status: 404 });
    }
    if (format === "md") {
      return new Response(entryAsMarkdown(entry), {
        headers: {
          "Content-Type": "text/markdown; charset=utf-8",
          "Content-Disposition": `attachment; filename="apex-entry-${id}.md"`,
        },
      });
    }
    return new Response(JSON.stringify(entry, null, 2), {
      headers: {
        "Content-Type": "application/json",
        "Content-Disposition": `attachment; filename="apex-entry-${id}.json"`,
      },
    });
  }

  const entries = listHistory({ limit: 1000 });
  if (format === "md") {
    const body = entries.map(entryAsMarkdown).join("\n\n---\n\n");
    return new Response(body, {
      headers: {
        "Content-Type": "text/markdown; charset=utf-8",
        "Content-Disposition": `attachment; filename="apex-history.md"`,
      },
    });
  }
  return new Response(JSON.stringify(entries, null, 2), {
    headers: {
      "Content-Type": "application/json",
      "Content-Disposition": `attachment; filename="apex-history.json"`,
    },
  });
}
