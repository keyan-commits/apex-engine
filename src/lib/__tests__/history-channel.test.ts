import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// We use a fresh CWD for each test so the better-sqlite3 file (under
// <cwd>/data/apex.db) is isolated. history.ts caches the DB handle in
// module scope; re-importing via vi.resetModules each test gives a
// fresh handle bound to the new tempdir's data/.
import { vi } from "vitest";

let tmpRoot: string;
let originalCwd: string;

beforeEach(async () => {
  tmpRoot = mkdtempSync(join(tmpdir(), "apex-hist-"));
  originalCwd = process.cwd();
  process.chdir(tmpRoot);
  vi.resetModules();
});

afterEach(() => {
  process.chdir(originalCwd);
  rmSync(tmpRoot, { recursive: true, force: true });
});

function emptyAnswers() {
  return {
    claude: { text: "", model: "", tier: "primary" as const, error: null },
    openai: { text: "", model: "", tier: "primary" as const, error: null },
    llama: { text: "", model: "", tier: "primary" as const, error: null },
    gemini: { text: "", model: "", tier: "primary" as const, error: null },
    deepseek: { text: "", model: "", tier: "primary" as const, error: null },
  };
}

describe("history.channel filter (Wave 20 hotfix)", () => {
  it("defaults to 'ui' when no channel is supplied", async () => {
    const { saveHistory, listHistory } = await import("../history");
    saveHistory({
      prompt: "test prompt",
      answers: emptyAnswers(),
      synthText: null,
      synthError: null,
      projectId: null,
    });
    const rows = listHistory({ limit: 1 });
    expect(rows[0].channel).toBe("ui");
  });

  it("persists the supplied channel verbatim", async () => {
    const { saveHistory, listHistory } = await import("../history");
    saveHistory({
      prompt: "ui call",
      answers: emptyAnswers(),
      synthText: null,
      synthError: null,
      projectId: null,
      channel: "ui",
    });
    saveHistory({
      prompt: "mcp call",
      answers: emptyAnswers(),
      synthText: null,
      synthError: null,
      projectId: null,
      channel: "mcp",
    });
    saveHistory({
      prompt: "api call",
      answers: emptyAnswers(),
      synthText: null,
      synthError: null,
      projectId: null,
      channel: "api",
    });
    const all = listHistory({ limit: 10 });
    const byPrompt = Object.fromEntries(all.map((r) => [r.prompt, r.channel]));
    expect(byPrompt["ui call"]).toBe("ui");
    expect(byPrompt["mcp call"]).toBe("mcp");
    expect(byPrompt["api call"]).toBe("api");
  });

  it("filters by channel='ui' — excludes MCP and API entries", async () => {
    const { saveHistory, listHistory } = await import("../history");
    saveHistory({
      prompt: "user-typed question",
      answers: emptyAnswers(),
      synthText: null,
      synthError: null,
      projectId: null,
      channel: "ui",
    });
    saveHistory({
      prompt: "internal mcp call",
      answers: emptyAnswers(),
      synthText: null,
      synthError: null,
      projectId: null,
      channel: "mcp",
    });
    const uiOnly = listHistory({ limit: 10, channel: "ui" });
    expect(uiOnly).toHaveLength(1);
    expect(uiOnly[0].prompt).toBe("user-typed question");
  });

  it("filters by channel='mcp' — excludes UI entries", async () => {
    const { saveHistory, listHistory } = await import("../history");
    saveHistory({
      prompt: "user-typed question",
      answers: emptyAnswers(),
      synthText: null,
      synthError: null,
      projectId: null,
      channel: "ui",
    });
    saveHistory({
      prompt: "internal mcp call",
      answers: emptyAnswers(),
      synthText: null,
      synthError: null,
      projectId: null,
      channel: "mcp",
    });
    const mcpOnly = listHistory({ limit: 10, channel: "mcp" });
    expect(mcpOnly).toHaveLength(1);
    expect(mcpOnly[0].prompt).toBe("internal mcp call");
  });

  it("the FOLLOW-UP-DETECTOR fix: most-recent UI entry, even if MCP was last", async () => {
    // This is the real-world failure: MCP entry inserted AFTER the
    // user's actual prior UI turn would become the auto-thread parent.
    // The fix is `channel: "ui"` on the listHistory call in /api/ask.
    const { saveHistory, listHistory } = await import("../history");
    saveHistory({
      prompt: "user's prior question about presentations",
      answers: emptyAnswers(),
      synthText: null,
      synthError: null,
      projectId: null,
      channel: "ui",
    });
    saveHistory({
      prompt: "apex_synthesize prompt about Wave 20 defects",
      answers: emptyAnswers(),
      synthText: null,
      synthError: null,
      projectId: null,
      channel: "mcp",
    });
    // Pre-fix: listHistory({ limit: 1 }) → the MCP entry.
    // Post-fix: listHistory({ limit: 1, channel: "ui" }) → the UI entry.
    const followUpView = listHistory({ limit: 1, channel: "ui" });
    expect(followUpView).toHaveLength(1);
    expect(followUpView[0].prompt).toBe("user's prior question about presentations");
  });
});
