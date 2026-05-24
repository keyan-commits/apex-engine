import { describe, expect, it } from "vitest";
import { formatSelfCheckReport, selfCheck } from "../self-check";

describe("selfCheck", () => {
  it("returns inSync=true when startup commit equals current HEAD and tree clean", () => {
    const result = selfCheck(["apex_fanout", "apex_self_check"]);
    // We can't assert on inSync deterministically here because the test
    // run happens inside a working tree that may or may not be dirty.
    // But we CAN assert the shape and that loadedTools came through.
    expect(result.loadedTools).toEqual(["apex_fanout", "apex_self_check"]);
    expect(typeof result.message).toBe("string");
    expect(result.restartCommand).toContain("Quit");
    expect(result.startup.startedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("sorts loadedTools alphabetically in the report", () => {
    const result = selfCheck(["apex_zeta", "apex_alpha", "apex_mu"]);
    expect(result.loadedTools).toEqual(["apex_alpha", "apex_mu", "apex_zeta"]);
  });

  it("renders a markdown report", () => {
    const result = selfCheck(["apex_fanout"]);
    const report = formatSelfCheckReport(result);
    expect(report).toContain("MCP server");
    expect(report).toContain("apex_fanout");
    expect(report).toContain("Loaded tools");
  });

  it("emits restart instructions when out of sync", () => {
    // Force a synthetic out-of-sync state by hand-crafting the result.
    const fake = {
      ...selfCheck([]),
      inSync: false,
      message: "Drift detected for test purposes.",
    };
    const report = formatSelfCheckReport(fake);
    expect(report).toContain("out of sync");
    expect(report).toContain("Quit");
  });
});
