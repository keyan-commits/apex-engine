import { describe, expect, it } from "vitest";
import * as webSearch from "../web-search";

// We re-export decodeEntities + unwrapDdgRedirect from web-search.ts for
// testing. They're module-internal; this test file imports the module
// namespace and reaches into the parsers via a tiny test-only escape
// hatch (see web-search.ts bottom for the __test exports).
type Internals = {
  decodeEntities: (s: string) => string;
  unwrapDdgRedirect: (href: string) => string;
};
const internals = (webSearch as unknown as { __test?: Internals }).__test;

describe("web-search internals (Wave 17c security patches)", () => {
  if (!internals) {
    it.skip("__test export not present", () => {});
    return;
  }
  const { decodeEntities, unwrapDdgRedirect } = internals;

  describe("decodeEntities — range guard", () => {
    it("decodes valid named entities", () => {
      expect(decodeEntities("a &amp; b")).toBe("a & b");
      expect(decodeEntities("&lt;tag&gt;")).toBe("<tag>");
      expect(decodeEntities("don&#39;t")).toBe("don't");
    });

    it("decodes valid numeric entities", () => {
      expect(decodeEntities("&#x1F600;")).toBe("😀");
      expect(decodeEntities("&#65;")).toBe("A");
    });

    it("does NOT throw RangeError on out-of-range numeric entity", () => {
      // Pre-Wave-17c this threw "Invalid code point 4294967295" and the
      // DDG fallback would die mid-parse, killing all results for the
      // query.
      expect(() => decodeEntities("evil&#xFFFFFFFF;tail")).not.toThrow();
      expect(decodeEntities("evil&#xFFFFFFFF;tail")).toBe("eviltail");
    });

    it("handles a string of malformed entities without throwing", () => {
      const adversarial = "&#x110000;&#999999999;&#x-1;&#-1;&#xZZZ;";
      expect(() => decodeEntities(adversarial)).not.toThrow();
    });
  });

  describe("unwrapDdgRedirect — scheme allowlist", () => {
    it("unwraps a normal https redirect", () => {
      const r = unwrapDdgRedirect(
        "//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fpath",
      );
      expect(r).toBe("https://example.com/path");
    });

    it("keeps a direct https URL untouched", () => {
      const r = unwrapDdgRedirect("https://example.com");
      expect(r).toBe("https://example.com/");
    });

    it("drops a javascript: redirect (case-insensitive)", () => {
      const r = unwrapDdgRedirect(
        "//duckduckgo.com/l/?uddg=javascript%3Aalert%281%29",
      );
      expect(r).toBe("");
      const upper = unwrapDdgRedirect(
        "//duckduckgo.com/l/?uddg=JavaScript%3Aalert%281%29",
      );
      expect(upper).toBe("");
    });

    it("drops a data: URL", () => {
      const r = unwrapDdgRedirect(
        "//duckduckgo.com/l/?uddg=data%3Atext%2Fhtml%2C%3Cscript%3E1%3C%2Fscript%3E",
      );
      expect(r).toBe("");
    });

    it("drops a file: URL", () => {
      const r = unwrapDdgRedirect(
        "//duckduckgo.com/l/?uddg=file%3A%2F%2F%2Fetc%2Fpasswd",
      );
      expect(r).toBe("");
    });

    it("drops a vbscript: URL", () => {
      const r = unwrapDdgRedirect(
        "//duckduckgo.com/l/?uddg=vbscript%3Amsgbox",
      );
      expect(r).toBe("");
    });

    it("does NOT double-decode %-containing URLs (URIError-safe)", () => {
      // URL with literal "%" that's already URL-decoded by URLSearchParams;
      // a second decodeURIComponent pass would throw URIError.
      const r = unwrapDdgRedirect(
        "//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fa%2520b",
      );
      expect(r).toBe("https://example.com/a%20b");
    });

    it("returns empty for an unparseable URL", () => {
      expect(unwrapDdgRedirect("not a url")).toBe("");
    });
  });
});
