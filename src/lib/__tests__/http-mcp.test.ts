import { describe, expect, it } from "vitest";
import { isOriginAllowed } from "@/mcp/http-server";

describe("isOriginAllowed", () => {
  it("accepts requests with no Origin header (CC MCP HTTP client)", () => {
    expect(isOriginAllowed(undefined)).toBe(true);
  });

  it('accepts the literal string "null" (file:// pages)', () => {
    expect(isOriginAllowed("null")).toBe(true);
  });

  it("accepts loopback origins on the Next.js dev port", () => {
    expect(isOriginAllowed("http://localhost:3000")).toBe(true);
    expect(isOriginAllowed("http://127.0.0.1:3000")).toBe(true);
    expect(isOriginAllowed("http://[::1]:3000")).toBe(true);
  });

  it("accepts loopback origins on the MCP HTTP port", () => {
    expect(isOriginAllowed("http://localhost:31001")).toBe(true);
    expect(isOriginAllowed("http://127.0.0.1:31001")).toBe(true);
    expect(isOriginAllowed("http://[::1]:31001")).toBe(true);
  });

  it("rejects any non-loopback origin", () => {
    expect(isOriginAllowed("https://example.com")).toBe(false);
    expect(isOriginAllowed("http://attacker.local")).toBe(false);
    expect(isOriginAllowed("http://192.168.1.50:3000")).toBe(false);
  });

  it("rejects loopback origins on unexpected ports (defense in depth)", () => {
    expect(isOriginAllowed("http://localhost:8080")).toBe(false);
    expect(isOriginAllowed("http://127.0.0.1:80")).toBe(false);
  });
});
