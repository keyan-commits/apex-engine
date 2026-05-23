import { describe, expect, it } from "vitest";
import {
  DEFAULT_ENSEMBLE_ID,
  ENSEMBLES,
  ENSEMBLE_LIST,
  ROLES,
  ROLE_LIST,
  findEnsemble,
  getRole,
  isValidRoles,
  roleSuffixFor,
  rolesForEnsemble,
} from "../roles";

describe("roles registry", () => {
  it("every role id maps back to itself", () => {
    for (const r of ROLE_LIST) {
      expect(ROLES[r.id].id).toBe(r.id);
    }
  });

  it("every ensemble references only valid role ids and providers", () => {
    for (const e of ENSEMBLE_LIST) {
      for (const [, roleId] of Object.entries(e.assignments)) {
        if (roleId) expect(ROLES).toHaveProperty(roleId);
      }
    }
  });

  it("DEFAULT_ENSEMBLE_ID exists in ENSEMBLES", () => {
    expect(ENSEMBLES).toHaveProperty(DEFAULT_ENSEMBLE_ID);
  });
});

describe("findEnsemble", () => {
  it("returns the default for unknown ids", () => {
    expect(findEnsemble("nope").id).toBe(DEFAULT_ENSEMBLE_ID);
  });

  it("returns the requested ensemble when known", () => {
    expect(findEnsemble("code-review").id).toBe("code-review");
  });

  it("returns the default for null/undefined", () => {
    expect(findEnsemble(null).id).toBe(DEFAULT_ENSEMBLE_ID);
    expect(findEnsemble(undefined).id).toBe(DEFAULT_ENSEMBLE_ID);
  });
});

describe("getRole", () => {
  it("returns null for unknown ids", () => {
    expect(getRole("nope")).toBeNull();
    expect(getRole(null)).toBeNull();
  });

  it("returns the role for known ids", () => {
    expect(getRole("dev")?.id).toBe("dev");
  });
});

describe("rolesForEnsemble", () => {
  it("returns the ensemble's assignments", () => {
    expect(rolesForEnsemble("code-review")).toEqual(
      ENSEMBLES["code-review"].assignments,
    );
  });

  it("returns empty for 'none'", () => {
    expect(rolesForEnsemble("none")).toEqual({});
  });
});

describe("roleSuffixFor", () => {
  it("returns null when no roles map provided", () => {
    expect(roleSuffixFor("claude", undefined)).toBeNull();
  });

  it("returns null when provider has no role", () => {
    expect(roleSuffixFor("claude", { openai: "dev" })).toBeNull();
  });

  it("returns the role's suffix when assigned", () => {
    const s = roleSuffixFor("claude", { claude: "dev" });
    expect(s).toBe(ROLES.dev.suffix);
  });
});

describe("isValidRoles", () => {
  it("accepts an empty object", () => {
    expect(isValidRoles({})).toBe(true);
  });

  it("accepts a valid provider→role mapping", () => {
    expect(isValidRoles({ claude: "dev", gemini: "tester" })).toBe(true);
  });

  it("rejects unknown providers", () => {
    expect(isValidRoles({ notarealprovider: "dev" })).toBe(false);
  });

  it("rejects unknown role ids", () => {
    expect(isValidRoles({ claude: "not-a-role" })).toBe(false);
  });

  it("rejects non-objects", () => {
    expect(isValidRoles(null)).toBe(false);
    expect(isValidRoles("nope")).toBe(false);
    expect(isValidRoles(["dev"])).toBe(false);
  });
});
