import { createHash } from "node:crypto";
import { existsSync, mkdirSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { basename } from "node:path";
import { join } from "node:path";

const DATA_DIR = join(process.cwd(), "data");
const ATTACH_DIR = join(DATA_DIR, "attachments");

export const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10 MB
export const MAX_FILES = 5;

export type AttachmentKind = "image" | "text" | "pdf";

export type AttachmentMeta = {
  name: string;
  mime: string;
  size: number;
  sha256: string;
  kind: AttachmentKind;
};

const IMAGE_MIMES = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
]);
const TEXT_MIMES = new Set([
  "text/plain",
  "text/markdown",
  "text/x-markdown",
  "application/json",
]);
const PDF_MIME = "application/pdf";

// Magic-number signatures (first bytes).
const MAGIC: Array<{ mime: string; signature: number[]; offset?: number }> = [
  { mime: "image/png", signature: [0x89, 0x50, 0x4e, 0x47] },
  { mime: "image/jpeg", signature: [0xff, 0xd8, 0xff] },
  { mime: "image/gif", signature: [0x47, 0x49, 0x46, 0x38] },
  { mime: "image/webp", signature: [0x52, 0x49, 0x46, 0x46] }, // RIFF; full check needs WEBP at offset 8
  { mime: "application/pdf", signature: [0x25, 0x50, 0x44, 0x46] },
];

function ensureDir() {
  if (!existsSync(ATTACH_DIR)) {
    mkdirSync(ATTACH_DIR, { recursive: true });
  }
}

function sniffMagicMime(bytes: Uint8Array): string | null {
  for (const m of MAGIC) {
    const o = m.offset ?? 0;
    if (bytes.length < o + m.signature.length) continue;
    let matches = true;
    for (let i = 0; i < m.signature.length; i++) {
      if (bytes[o + i] !== m.signature[i]) {
        matches = false;
        break;
      }
    }
    if (matches) {
      // Extra check for WEBP: bytes 8..12 should be 'WEBP'
      if (m.mime === "image/webp") {
        const tag = String.fromCharCode(...bytes.slice(8, 12));
        if (tag !== "WEBP") continue;
      }
      return m.mime;
    }
  }
  return null;
}

function classify(mime: string): AttachmentKind | null {
  if (IMAGE_MIMES.has(mime)) return "image";
  if (TEXT_MIMES.has(mime)) return "text";
  if (mime === PDF_MIME) return "pdf";
  return null;
}

function sanitizeFilename(name: string): string {
  // Strip directories, control chars, and excessive length.
  const b = basename(name).replace(/[\x00-\x1f\x7f]/g, "").trim();
  return b.length > 120 ? b.slice(0, 120) : b || "file";
}

function isLikelyText(bytes: Uint8Array): boolean {
  // Very cheap check: no NULs in the first 4 KB.
  const sample = bytes.subarray(0, Math.min(4096, bytes.length));
  for (const b of sample) if (b === 0) return false;
  return true;
}

export type SaveInput = {
  filename: string;
  declaredMime: string;
  bytes: Uint8Array;
};

export type SaveResult =
  | { ok: true; meta: AttachmentMeta }
  | { ok: false; reason: string };

export async function saveAttachment(input: SaveInput): Promise<SaveResult> {
  if (input.bytes.byteLength > MAX_FILE_BYTES) {
    return { ok: false, reason: `File exceeds ${MAX_FILE_BYTES / 1024 / 1024} MB` };
  }
  const name = sanitizeFilename(input.filename);

  // For text/markdown, magic-number doesn't exist; just verify it's not binary.
  const isTextDeclared = TEXT_MIMES.has(input.declaredMime);
  if (isTextDeclared) {
    if (!isLikelyText(input.bytes)) {
      return { ok: false, reason: "Declared text but contains binary bytes" };
    }
  } else {
    const sniffed = sniffMagicMime(input.bytes);
    if (!sniffed) {
      return { ok: false, reason: "Unrecognized file type (magic-number sniff failed)" };
    }
    if (sniffed !== input.declaredMime) {
      return {
        ok: false,
        reason: `Declared ${input.declaredMime} but bytes look like ${sniffed}`,
      };
    }
  }
  const kind = classify(input.declaredMime);
  if (!kind) {
    return { ok: false, reason: `Unsupported MIME: ${input.declaredMime}` };
  }
  const sha256 = createHash("sha256").update(input.bytes).digest("hex");

  ensureDir();
  const path = join(ATTACH_DIR, sha256.slice(0, 32));
  if (!existsSync(path)) {
    await writeFile(path, input.bytes);
  }

  return {
    ok: true,
    meta: {
      name,
      mime: input.declaredMime,
      size: input.bytes.byteLength,
      sha256,
      kind,
    },
  };
}

export async function readAttachment(sha256: string): Promise<Uint8Array | null> {
  const path = join(ATTACH_DIR, sha256.slice(0, 32));
  if (!existsSync(path)) return null;
  const buf = await readFile(path);
  return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
}

export async function readAttachmentText(sha256: string): Promise<string | null> {
  const bytes = await readAttachment(sha256);
  if (!bytes) return null;
  return new TextDecoder("utf-8").decode(bytes);
}
