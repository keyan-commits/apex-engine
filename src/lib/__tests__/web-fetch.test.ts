import { describe, expect, it } from "vitest";
import { __test } from "../web-fetch";

const { isSafePublicHost, htmlToText, extractTitle } = __test;

describe("isSafePublicHost — SSRF guard", () => {
  it("accepts normal public hostnames", () => {
    expect(isSafePublicHost("example.com")).toBe(true);
    expect(isSafePublicHost("www.anthropic.com")).toBe(true);
    expect(isSafePublicHost("api.github.com")).toBe(true);
    expect(isSafePublicHost("8.8.8.8")).toBe(true);
  });

  it("rejects localhost + .localhost suffix", () => {
    expect(isSafePublicHost("localhost")).toBe(false);
    expect(isSafePublicHost("LOCALHOST")).toBe(false); // case-insensitive
    expect(isSafePublicHost("app.localhost")).toBe(false);
  });

  it("rejects IPv4 loopback (127.0.0.0/8)", () => {
    expect(isSafePublicHost("127.0.0.1")).toBe(false);
    expect(isSafePublicHost("127.1.2.3")).toBe(false);
    expect(isSafePublicHost("127.255.255.255")).toBe(false);
  });

  it("rejects IPv4 private ranges (10/8, 172.16/12, 192.168/16)", () => {
    expect(isSafePublicHost("10.0.0.1")).toBe(false);
    expect(isSafePublicHost("10.255.255.255")).toBe(false);
    expect(isSafePublicHost("172.16.0.1")).toBe(false);
    expect(isSafePublicHost("172.20.0.1")).toBe(false);
    expect(isSafePublicHost("172.31.255.255")).toBe(false);
    expect(isSafePublicHost("192.168.1.1")).toBe(false);
    expect(isSafePublicHost("192.168.255.255")).toBe(false);
    // Adjacent non-private ranges should pass.
    expect(isSafePublicHost("172.15.0.1")).toBe(true);
    expect(isSafePublicHost("172.32.0.1")).toBe(true);
  });

  it("rejects link-local + AWS/GCP/Azure metadata (169.254.0.0/16)", () => {
    expect(isSafePublicHost("169.254.169.254")).toBe(false); // EC2 metadata
    expect(isSafePublicHost("169.254.0.1")).toBe(false);
    expect(isSafePublicHost("169.254.255.255")).toBe(false);
  });

  it("rejects 0.0.0.0 and IPv6 :: equivalents", () => {
    expect(isSafePublicHost("0.0.0.0")).toBe(false);
    expect(isSafePublicHost("::")).toBe(false);
    expect(isSafePublicHost("0:0:0:0:0:0:0:0")).toBe(false);
  });

  it("rejects IPv6 loopback (::1)", () => {
    expect(isSafePublicHost("::1")).toBe(false);
    expect(isSafePublicHost("[::1]")).toBe(false);
    expect(isSafePublicHost("0:0:0:0:0:0:0:1")).toBe(false);
  });

  it("rejects IPv6 link-local (fe80::/10)", () => {
    expect(isSafePublicHost("fe80::1")).toBe(false);
    expect(isSafePublicHost("[fe80::abcd:1234]")).toBe(false);
  });

  it("rejects IPv6 Unique Local Addresses (fc00::/7)", () => {
    expect(isSafePublicHost("fc00::1")).toBe(false);
    expect(isSafePublicHost("fd00::abcd")).toBe(false);
  });

  it("rejects empty / whitespace / malformed input", () => {
    expect(isSafePublicHost("")).toBe(false);
    expect(isSafePublicHost("host with space")).toBe(false);
  });

  describe("Wave 21c — IPv4-mapped IPv6 SSRF (C1, verified live by QA agent)", () => {
    it("rejects ::ffff: prefixed IPv6 forms that map to loopback IPv4", () => {
      // `http://[::ffff:127.0.0.1]/` normalizes through `new URL()` to
      // hostname `[::ffff:7f00:1]`. After bracket strip none of the
      // dot-decimal IPv4 regexes catch the `::ffff:` form.
      expect(isSafePublicHost("::ffff:7f00:1")).toBe(false);
      expect(isSafePublicHost("[::ffff:7f00:1]")).toBe(false);
    });

    it("rejects ::ffff: prefixed IPv6 forms mapping to RFC1918 (10/8, 172.16/12, 192.168/16)", () => {
      expect(isSafePublicHost("::ffff:a00:1")).toBe(false); // 10.0.0.1
      expect(isSafePublicHost("::ffff:ac10:1")).toBe(false); // 172.16.0.1
      expect(isSafePublicHost("::ffff:c0a8:101")).toBe(false); // 192.168.1.1
      expect(isSafePublicHost("[::ffff:c0a8:101]")).toBe(false);
    });

    it("rejects ::ffff: prefixed IPv6 mapping to link-local + AWS metadata", () => {
      expect(isSafePublicHost("::ffff:a9fe:a9fe")).toBe(false); // 169.254.169.254
    });

    it("rejects even ::ffff: forms that would map to PUBLIC IPv4 (blanket reject)", () => {
      // Legitimate public hosts arrive as plain dotted-decimal, never
      // as ::ffff:-mapped. Anyone using the mapped form is more likely
      // trying to bypass the guard than legitimately fetching.
      expect(isSafePublicHost("::ffff:8.8.8.8")).toBe(false);
      expect(isSafePublicHost("::ffff:808:808")).toBe(false);
    });

    it("is case-insensitive on ::FFFF: prefix", () => {
      expect(isSafePublicHost("::FFFF:7f00:1")).toBe(false);
      expect(isSafePublicHost("::FfFf:a00:1")).toBe(false);
    });
  });

  describe("Wave 21c — DNS cloud-metadata SSRF (H1)", () => {
    it("rejects metadata.google.internal", () => {
      expect(isSafePublicHost("metadata.google.internal")).toBe(false);
    });
    it("rejects metadata.azure.internal", () => {
      expect(isSafePublicHost("metadata.azure.internal")).toBe(false);
    });
    it("rejects instance-data.ec2.internal", () => {
      expect(isSafePublicHost("instance-data.ec2.internal")).toBe(false);
    });
    it("rejects bare `metadata` hostname", () => {
      expect(isSafePublicHost("metadata")).toBe(false);
    });
    it("is case-insensitive on metadata hosts", () => {
      expect(isSafePublicHost("Metadata.Google.Internal")).toBe(false);
    });
  });
});

describe("htmlToText", () => {
  it("strips simple HTML tags", () => {
    expect(htmlToText("<p>Hello <b>world</b></p>")).toBe("Hello world");
  });

  it("drops <script> contents entirely", () => {
    const html =
      "<p>visible</p><script>alert('bad')</script><p>also visible</p>";
    const out = htmlToText(html);
    expect(out).not.toContain("alert");
    expect(out).toContain("visible");
    expect(out).toContain("also visible");
  });

  it("drops <style> contents entirely", () => {
    const html = "<style>body { color: red }</style><p>real text</p>";
    const out = htmlToText(html);
    expect(out).not.toContain("color: red");
    expect(out).toContain("real text");
  });

  it("drops <noscript> + HTML comments", () => {
    const html =
      "<!-- secret comment --><noscript>no js</noscript><p>main</p>";
    const out = htmlToText(html);
    expect(out).not.toContain("secret comment");
    expect(out).not.toContain("no js");
    expect(out).toContain("main");
  });

  it("decodes HTML entities", () => {
    expect(htmlToText("<p>Tom &amp; Jerry &lt;3</p>")).toBe("Tom & Jerry <3");
    expect(htmlToText("<p>don&#39;t worry</p>")).toBe("don't worry");
    expect(htmlToText("<p>5 &#x3C; 10</p>")).toBe("5 < 10");
  });

  it("preserves paragraph breaks via newlines", () => {
    const html = "<p>first</p><p>second</p><p>third</p>";
    const out = htmlToText(html);
    expect(out.split("\n").length).toBeGreaterThanOrEqual(3);
    expect(out).toContain("first");
    expect(out).toContain("second");
    expect(out).toContain("third");
  });

  it("collapses runs of whitespace", () => {
    const html = "<p>too    many     spaces</p>";
    expect(htmlToText(html)).toBe("too many spaces");
  });

  it("survives malformed entities without throwing", () => {
    const evil = "<p>&#xFFFFFFFF; &#x110000; &#x-1; junk</p>";
    expect(() => htmlToText(evil)).not.toThrow();
  });
});

describe("extractTitle", () => {
  it("extracts the <title> contents", () => {
    expect(extractTitle("<html><head><title>Hello World</title></head>")).toBe(
      "Hello World",
    );
  });

  it("decodes entities in the title", () => {
    expect(extractTitle("<title>Tom &amp; Jerry</title>")).toBe("Tom & Jerry");
  });

  it("returns null when no title present", () => {
    expect(extractTitle("<html><body>no title</body></html>")).toBeNull();
  });

  it("caps long titles at 200 chars", () => {
    const long = "x".repeat(500);
    const out = extractTitle(`<title>${long}</title>`);
    expect(out!.length).toBeLessThanOrEqual(200);
  });

  it("collapses whitespace runs in the title", () => {
    expect(extractTitle("<title>  many   spaces  </title>")).toBe("many spaces");
  });
});
