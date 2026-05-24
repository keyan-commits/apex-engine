import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Regression test for QA review RISK: REGISTERED_TOOL_NAMES in
// src/mcp/server.ts is hand-maintained. It's used by apex_self_check
// to surface the loaded tool list. Future tool additions will silently
// desync the array from the actual registrations unless this test
// catches the drift.

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const SERVER_PATH = join(REPO_ROOT, "src/mcp/server.ts");

describe("MCP tool registry stays in sync", () => {
  it("REGISTERED_TOOL_NAMES.length matches the number of server.tool() calls", () => {
    const source = readFileSync(SERVER_PATH, "utf8");

    // Extract the REGISTERED_TOOL_NAMES array members.
    const arrayMatch = source.match(
      /const REGISTERED_TOOL_NAMES\s*=\s*\[([\s\S]*?)\]/,
    );
    expect(arrayMatch, "REGISTERED_TOOL_NAMES array not found").toBeTruthy();
    const arrayBody = arrayMatch![1];
    const registered = Array.from(
      arrayBody.matchAll(/"([a-z_][a-z0-9_]*)"/gi),
    ).map((m) => m[1]);

    // Find every server.tool("name", ...) call.
    const calls = Array.from(
      source.matchAll(/server\.tool\(\s*"([a-z_][a-z0-9_]*)"/gi),
    ).map((m) => m[1]);

    expect(registered.sort()).toEqual(calls.sort());
  });
});
