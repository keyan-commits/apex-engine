import { extractText, getDocumentProxy } from "unpdf";
import { readAttachment, readAttachmentText, type AttachmentMeta } from "./attachments";

async function extractPdfText(bytes: Uint8Array): Promise<string> {
  try {
    const pdf = await getDocumentProxy(bytes);
    const { text } = await extractText(pdf, { mergePages: true });
    if (Array.isArray(text)) return text.join("\n\n");
    return text;
  } catch (err) {
    return `(PDF extraction failed: ${err instanceof Error ? err.message : "unknown"})`;
  }
}

export type UserMessagePart =
  | { type: "text"; text: string }
  | { type: "image"; image: Uint8Array; mediaType: string };

export type ResolvedAttachment = {
  meta: AttachmentMeta;
  bytes?: Uint8Array;
  text?: string;
};

export async function resolveAttachments(
  metas: AttachmentMeta[],
): Promise<ResolvedAttachment[]> {
  const out: ResolvedAttachment[] = [];
  for (const meta of metas) {
    if (meta.kind === "image") {
      const bytes = await readAttachment(meta.sha256);
      if (bytes) out.push({ meta, bytes });
    } else if (meta.kind === "text") {
      const text = await readAttachmentText(meta.sha256);
      if (text != null) out.push({ meta, text });
    } else if (meta.kind === "pdf") {
      const bytes = await readAttachment(meta.sha256);
      if (bytes) {
        const text = await extractPdfText(bytes);
        out.push({ meta, text });
      }
    }
  }
  return out;
}

// Build content parts for Vercel AI SDK message form.
// Image-capable providers (openai/google + GPT-4o-mini via github-models) accept this.
export function buildAiSdkContent(
  prompt: string,
  resolved: ResolvedAttachment[],
  includeImages: boolean,
): Array<UserMessagePart> {
  const parts: UserMessagePart[] = [];
  // Text attachments first, so the user prompt comes after with full context.
  for (const r of resolved) {
    if (r.text) {
      parts.push({
        type: "text",
        text: `### Attached file: ${r.meta.name}\n\n${r.text.trim()}`,
      });
    }
  }
  if (includeImages) {
    for (const r of resolved) {
      if (r.bytes && r.meta.kind === "image") {
        parts.push({ type: "image", image: r.bytes, mediaType: r.meta.mime });
      }
    }
  }
  parts.push({ type: "text", text: prompt });
  return parts;
}

// Build a flat text prompt for text-only models. Image attachments become
// a description placeholder (filled in by describe-pass at call site).
export function buildTextOnlyPrompt(
  prompt: string,
  resolved: ResolvedAttachment[],
  imageDescriptions: Map<string, string>,
): string {
  const blocks: string[] = [];
  for (const r of resolved) {
    if (r.text) {
      blocks.push(`### Attached file: ${r.meta.name}\n\n${r.text.trim()}`);
    } else if (r.bytes && r.meta.kind === "image") {
      const desc = imageDescriptions.get(r.meta.sha256);
      blocks.push(
        `### Attached image: ${r.meta.name}\n\n${desc ?? "(image attached; no description available)"}`,
      );
    }
  }
  blocks.push(prompt);
  return blocks.join("\n\n");
}

// Format for the Claude Agent SDK's async-iterable prompt form.
export type ClaudeContentBlock =
  | { type: "text"; text: string }
  | {
      type: "image";
      source: { type: "base64"; media_type: string; data: string };
    };

export function buildClaudeContent(
  prompt: string,
  resolved: ResolvedAttachment[],
): ClaudeContentBlock[] {
  const blocks: ClaudeContentBlock[] = [];
  for (const r of resolved) {
    if (r.text) {
      blocks.push({
        type: "text",
        text: `### Attached file: ${r.meta.name}\n\n${r.text.trim()}`,
      });
    } else if (r.bytes && r.meta.kind === "image") {
      blocks.push({
        type: "image",
        source: {
          type: "base64",
          media_type: r.meta.mime,
          data: Buffer.from(r.bytes).toString("base64"),
        },
      });
    }
  }
  blocks.push({ type: "text", text: prompt });
  return blocks;
}
