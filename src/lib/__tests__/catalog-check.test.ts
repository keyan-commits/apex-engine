// Wave 23 — catalog-check tests.

import { describe, expect, it } from "vitest";
import {
  type CatalogModel,
  findAllUpdates,
  findNewerInFamily,
  formatUpdateReport,
  runCatalogCheck,
  TRACKED_MODELS,
  type TrackedModel,
} from "../catalog-check";

function groqCatalog(ids: string[]): CatalogModel[] {
  return ids.map((id) => ({ id, provider: "groq" as const }));
}

function googleCatalog(ids: string[]): CatalogModel[] {
  return ids.map((id) => ({ id, provider: "google" as const }));
}

function findTrackedByCurrent(current: string): TrackedModel {
  const t = TRACKED_MODELS.find((m) => m.current === current);
  if (!t) throw new Error(`tracked model ${current} not in TRACKED_MODELS`);
  return t;
}

describe("Wave 23 — catalog-check family matching", () => {
  describe("Llama 3.x 70B versatile family", () => {
    const tracked = findTrackedByCurrent("llama-3.3-70b-versatile");

    it("flags llama-3.4-70b-versatile as newer than 3.3", () => {
      const cat = groqCatalog(["llama-3.3-70b-versatile", "llama-3.4-70b-versatile"]);
      expect(findNewerInFamily(tracked, cat)).toBe("llama-3.4-70b-versatile");
    });

    it("returns null when only the current 3.3 is in catalog", () => {
      const cat = groqCatalog(["llama-3.3-70b-versatile"]);
      expect(findNewerInFamily(tracked, cat)).toBeNull();
    });

    it("ignores a Llama 4 model (different architecture family, not in family pattern)", () => {
      const cat = groqCatalog([
        "llama-3.3-70b-versatile",
        "meta-llama/llama-4-scout-17b-16e-instruct",
      ]);
      expect(findNewerInFamily(tracked, cat)).toBeNull();
    });

    it("ignores a Llama 3.1 8B (different size class)", () => {
      const cat = groqCatalog([
        "llama-3.3-70b-versatile",
        "llama-3.1-8b-instant",
      ]);
      expect(findNewerInFamily(tracked, cat)).toBeNull();
    });

    it("picks the newest among multiple newer candidates", () => {
      const cat = groqCatalog([
        "llama-3.3-70b-versatile",
        "llama-3.4-70b-versatile",
        "llama-3.5-70b-versatile",
      ]);
      expect(findNewerInFamily(tracked, cat)).toBe("llama-3.5-70b-versatile");
    });
  });

  describe("Llama 3.x 8B instant family (Wave 22a/f Gemini substitute)", () => {
    const tracked = findTrackedByCurrent("llama-3.1-8b-instant");

    it("flags 3.2-8b-instant as newer than 3.1", () => {
      const cat = groqCatalog(["llama-3.1-8b-instant", "llama-3.2-8b-instant"]);
      expect(findNewerInFamily(tracked, cat)).toBe("llama-3.2-8b-instant");
    });

    it("ignores the 70B-versatile (different size class)", () => {
      const cat = groqCatalog([
        "llama-3.1-8b-instant",
        "llama-3.3-70b-versatile",
      ]);
      expect(findNewerInFamily(tracked, cat)).toBeNull();
    });
  });

  describe("GPT-OSS ≥120B family (synth default + Wave 20c openai substitute)", () => {
    const tracked = findTrackedByCurrent("openai/gpt-oss-120b");

    it("flags gpt-oss-240b as newer than 120b", () => {
      const cat = groqCatalog(["openai/gpt-oss-120b", "openai/gpt-oss-240b"]);
      expect(findNewerInFamily(tracked, cat)).toBe("openai/gpt-oss-240b");
    });

    it("ignores the smaller 20b sibling (handled by a separate tracked entry)", () => {
      const cat = groqCatalog(["openai/gpt-oss-120b", "openai/gpt-oss-20b"]);
      expect(findNewerInFamily(tracked, cat)).toBeNull();
    });
  });

  describe("GPT-OSS small family (~20B)", () => {
    const tracked = findTrackedByCurrent("openai/gpt-oss-20b");

    it("flags a gpt-oss-40b as newer than 20b in the small-class window", () => {
      const cat = groqCatalog(["openai/gpt-oss-20b", "openai/gpt-oss-40b"]);
      expect(findNewerInFamily(tracked, cat)).toBe("openai/gpt-oss-40b");
    });

    it("ignores the 120b flagship (out of small-class window)", () => {
      const cat = groqCatalog(["openai/gpt-oss-20b", "openai/gpt-oss-120b"]);
      expect(findNewerInFamily(tracked, cat)).toBeNull();
    });
  });

  describe("Gemini Flash stable-alias family", () => {
    const tracked = findTrackedByCurrent("gemini-2.5-flash");

    it("flags gemini-3.0-flash as newer than 2.5", () => {
      const cat = googleCatalog(["gemini-2.5-flash", "gemini-3.0-flash"]);
      expect(findNewerInFamily(tracked, cat)).toBe("gemini-3.0-flash");
    });

    it("flags gemini-2.6-flash as newer than 2.5", () => {
      const cat = googleCatalog(["gemini-2.5-flash", "gemini-2.6-flash"]);
      expect(findNewerInFamily(tracked, cat)).toBe("gemini-2.6-flash");
    });

    it("ignores the pinned version (`gemini-2.5-flash-001`) — only the unpinned alias is a member", () => {
      const cat = googleCatalog([
        "gemini-2.5-flash",
        "gemini-2.5-flash-001",
        "gemini-2.5-flash-002",
      ]);
      // Even though `-002` exists, it's pinned (not the stable alias),
      // so we don't surface it. The unpinned `gemini-2.5-flash` alias
      // tracks whatever the latest pinned version is on the provider's
      // side, automatically.
      expect(findNewerInFamily(tracked, cat)).toBeNull();
    });

    it("ignores cross-provider Groq entries (different provider scope)", () => {
      // Building a malformed catalog with a Google-style id but Groq
      // provider tag to ensure provider scoping works.
      const cat: CatalogModel[] = [
        { id: "gemini-3.0-flash", provider: "groq" },
      ];
      expect(findNewerInFamily(tracked, cat)).toBeNull();
    });
  });
});

describe("Wave 23 — findAllUpdates aggregates across providers", () => {
  it("returns one update per tracked model with a newer candidate", () => {
    const groq = groqCatalog([
      "llama-3.3-70b-versatile",
      "llama-3.4-70b-versatile",
      "openai/gpt-oss-120b",
      "openai/gpt-oss-240b",
    ]);
    const google = googleCatalog([
      "gemini-2.5-flash",
      "gemini-3.0-flash",
    ]);
    const updates = findAllUpdates(TRACKED_MODELS, { groq, google });
    const targets = updates.map((u) => `${u.tracked.current}→${u.candidate}`);
    expect(targets).toContain("llama-3.3-70b-versatile→llama-3.4-70b-versatile");
    expect(targets).toContain("openai/gpt-oss-120b→openai/gpt-oss-240b");
    expect(targets).toContain("gemini-2.5-flash→gemini-3.0-flash");
  });

  it("returns empty when no catalogs have newer candidates", () => {
    const groq = groqCatalog([
      "llama-3.3-70b-versatile",
      "llama-3.1-8b-instant",
      "openai/gpt-oss-120b",
      "openai/gpt-oss-20b",
    ]);
    const google = googleCatalog(["gemini-2.5-flash"]);
    const updates = findAllUpdates(TRACKED_MODELS, { groq, google });
    expect(updates).toEqual([]);
  });

  it("skips tracked entries whose provider catalog is missing", () => {
    // Only google catalog provided; groq tracked entries are skipped silently.
    const updates = findAllUpdates(TRACKED_MODELS, {
      google: googleCatalog(["gemini-2.5-flash", "gemini-3.0-flash"]),
    });
    expect(updates.length).toBe(1);
    expect(updates[0]?.tracked.current).toBe("gemini-2.5-flash");
  });
});

describe("Wave 23 — formatUpdateReport content", () => {
  it("includes both the current and candidate model ids in the title", () => {
    const tracked = findTrackedByCurrent("llama-3.3-70b-versatile");
    const { title } = formatUpdateReport({
      tracked,
      candidate: "llama-3.4-70b-versatile",
    });
    expect(title).toContain("llama-3.3-70b-versatile");
    expect(title).toContain("llama-3.4-70b-versatile");
    expect(title).toContain("[catalog]");
  });

  it("description includes the verification steps + Production-tier warning", () => {
    const tracked = findTrackedByCurrent("llama-3.3-70b-versatile");
    const { description } = formatUpdateReport({
      tracked,
      candidate: "llama-3.4-70b-versatile",
    });
    expect(description).toContain("Production-tier");
    expect(description).toContain("console.groq.com/docs/models");
    expect(description).toContain("apex does NOT auto-update");
    expect(description).toContain("TRACKED_MODELS");
    expect(description).toContain(tracked.source);
  });

  it("Gemini report points at the Google catalog docs", () => {
    const tracked = findTrackedByCurrent("gemini-2.5-flash");
    const { description } = formatUpdateReport({
      tracked,
      candidate: "gemini-3.0-flash",
    });
    expect(description).toContain("ai.google.dev/gemini-api/docs/models");
  });
});

describe("Wave 23 — runCatalogCheck with catalogOverride (no network)", () => {
  it("returns updates without emitting when emit=false", async () => {
    const result = await runCatalogCheck({
      catalogOverride: {
        groq: groqCatalog([
          "llama-3.3-70b-versatile",
          "llama-3.4-70b-versatile",
        ]),
      },
      emit: false,
    });
    expect(result.probed).toEqual(["groq"]);
    expect(result.updates.length).toBe(1);
    expect(result.updates[0]?.candidate).toBe("llama-3.4-70b-versatile");
  });

  it("reports an error for each missing provider key (no override) but does not throw", async () => {
    // Force-empty the env so probe attempts hit the "key not set" branch.
    const originalGroq = process.env.GROQ_API_KEY;
    const originalGoogle = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
    delete process.env.GROQ_API_KEY;
    delete process.env.GOOGLE_GENERATIVE_AI_API_KEY;
    try {
      const result = await runCatalogCheck({ emit: false });
      expect(result.probed).toEqual([]);
      expect(result.updates).toEqual([]);
      expect(result.errors.length).toBe(2);
      const providers = result.errors.map((e) => e.provider).sort();
      expect(providers).toEqual(["google", "groq"]);
      for (const e of result.errors) {
        expect(e.reason).toContain("not set");
      }
    } finally {
      if (originalGroq !== undefined) process.env.GROQ_API_KEY = originalGroq;
      if (originalGoogle !== undefined) process.env.GOOGLE_GENERATIVE_AI_API_KEY = originalGoogle;
    }
  });

  it("trackedOverride lets tests scope to a single tracked entry", async () => {
    const onlyLlama = TRACKED_MODELS.filter(
      (t) => t.current === "llama-3.3-70b-versatile",
    );
    const result = await runCatalogCheck({
      trackedOverride: onlyLlama,
      catalogOverride: {
        groq: groqCatalog([
          "llama-3.3-70b-versatile",
          "llama-3.4-70b-versatile",
          "openai/gpt-oss-240b", // irrelevant to this scoped run
        ]),
      },
      emit: false,
    });
    expect(result.updates.length).toBe(1);
    expect(result.updates[0]?.tracked.current).toBe("llama-3.3-70b-versatile");
  });
});

describe("Wave 23 — TRACKED_MODELS sanity", () => {
  it("has at least one entry per provider we probe", () => {
    const providers = new Set(TRACKED_MODELS.map((t) => t.provider));
    expect(providers.has("groq")).toBe(true);
    expect(providers.has("google")).toBe(true);
  });

  it("every entry's current id is a member of its own family (sanity check on the regex)", () => {
    for (const t of TRACKED_MODELS) {
      expect(t.family.isMember(t.current)).toBe(true);
    }
  });

  it("no entry's current id is 'newer than itself' (comparator sanity)", () => {
    for (const t of TRACKED_MODELS) {
      expect(t.family.isNewer(t.current, t.current)).toBe(false);
    }
  });
});
