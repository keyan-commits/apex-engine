import { describe, expect, it } from "vitest";
import { saveAttachment } from "../attachments";

const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPEG_BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);

describe("saveAttachment", () => {
  it("rejects files over 10MB", async () => {
    const big = new Uint8Array(11 * 1024 * 1024);
    const r = await saveAttachment({
      filename: "x.png",
      declaredMime: "image/png",
      bytes: big,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/MB/);
  });

  it("rejects when declared mime mismatches magic bytes", async () => {
    const r = await saveAttachment({
      filename: "x.png",
      declaredMime: "image/png",
      bytes: JPEG_BYTES,
    });
    expect(r.ok).toBe(false);
  });

  it("rejects unrecognized files", async () => {
    const r = await saveAttachment({
      filename: "x.bin",
      declaredMime: "application/octet-stream",
      bytes: new Uint8Array([1, 2, 3, 4]),
    });
    expect(r.ok).toBe(false);
  });

  it("rejects text declared as text/plain but containing NUL bytes", async () => {
    const bytes = new Uint8Array([97, 0, 98, 99]);
    const r = await saveAttachment({
      filename: "x.txt",
      declaredMime: "text/plain",
      bytes,
    });
    expect(r.ok).toBe(false);
  });

  it("accepts a valid PNG and yields metadata", async () => {
    const r = await saveAttachment({
      filename: "../../../../etc/passwd",
      declaredMime: "image/png",
      bytes: PNG_BYTES,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      // Filename is sanitized: no path components.
      expect(r.meta.name).not.toContain("/");
      expect(r.meta.mime).toBe("image/png");
      expect(r.meta.size).toBe(PNG_BYTES.length);
      expect(r.meta.sha256).toMatch(/^[a-f0-9]{64}$/);
      expect(r.meta.kind).toBe("image");
    }
  });

  it("accepts a valid markdown file", async () => {
    const text = new TextEncoder().encode("# Hello\n");
    const r = await saveAttachment({
      filename: "notes.md",
      declaredMime: "text/markdown",
      bytes: text,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.meta.kind).toBe("text");
    }
  });
});
