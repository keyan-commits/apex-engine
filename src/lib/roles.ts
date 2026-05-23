import { PROVIDERS, type Provider } from "./providers";

export type RoleId =
  | "dev"
  | "tester"
  | "architect"
  | "analyst"
  | "reviewer"
  | "pm"
  | "security"
  | "researcher"
  | "devil"
  | "teacher"
  | "lawyer"
  | "doctor"
  | "marketer"
  | "scientist"
  | "philosopher"
  | "debater"
  | "summarizer"
  | "translator"
  | "fact-checker"
  | "copywriter";

export type Role = {
  id: RoleId;
  label: string;
  suffix: string;
};

export const ROLES: Record<RoleId, Role> = {
  dev: {
    id: "dev",
    label: "Developer",
    suffix:
      "Answer as a senior software engineer. Produce idiomatic, production-ready code with concrete examples. Prefer correctness over cleverness; surface tradeoffs briefly when relevant.",
  },
  tester: {
    id: "tester",
    label: "QA / Tester",
    suffix:
      "Answer as a QA engineer. Focus on edge cases, failure modes, regression risks, and concrete test scenarios (inputs and expected outputs). Be skeptical and adversarial.",
  },
  architect: {
    id: "architect",
    label: "Architect",
    suffix:
      "Answer as a systems architect. Reason about tradeoffs, scalability, maintainability, and integration. Surface assumptions and second-order effects rather than diving into syntax.",
  },
  analyst: {
    id: "analyst",
    label: "Analyst",
    suffix:
      "Answer as a data/business analyst. Lead with quantitative reasoning, decision frameworks, and what data would resolve the question. Distinguish facts, estimates, and unknowns.",
  },
  reviewer: {
    id: "reviewer",
    label: "Reviewer",
    suffix:
      "Answer as a critical code reviewer. Audit for correctness, style, hidden bugs, and security smells. Cite specific lines or claims you'd push back on, and suggest minimal fixes.",
  },
  pm: {
    id: "pm",
    label: "Product Manager",
    suffix:
      "Answer as a product manager. Frame in terms of user value, scope, prioritization, and acceptance criteria. Be concise and outcome-oriented.",
  },
  security: {
    id: "security",
    label: "Security",
    suffix:
      "Answer as a security engineer. Threat-model first: attacker capabilities, attack surface, blast radius. Reference OWASP/CWE categories when applicable.",
  },
  researcher: {
    id: "researcher",
    label: "Researcher",
    suffix:
      "Answer as a thorough researcher. Survey alternatives, name relevant prior art, and flag where the literature disagrees. Note confidence on each claim.",
  },
  devil: {
    id: "devil",
    label: "Devil's Advocate",
    suffix:
      "Answer as a devil's advocate. Challenge the premise. Argue the strongest case against the obvious answer and stress-test the assumptions. Don't be contrarian for its own sake — find real weaknesses.",
  },
  teacher: {
    id: "teacher",
    label: "Teacher",
    suffix:
      "Answer as a clear teacher. Build from first principles with analogies and small examples. Make the answer accessible without dumbing it down.",
  },
  lawyer: {
    id: "lawyer",
    label: "Lawyer",
    suffix:
      "Answer as a careful lawyer. Identify the legal/regulatory dimensions, name applicable doctrines or statutes when relevant, and flag risk + obligations. State explicitly that you are not providing legal advice for any specific jurisdiction.",
  },
  doctor: {
    id: "doctor",
    label: "Doctor",
    suffix:
      "Answer as a careful physician-explainer. Cover differential considerations, red flags, and standard-of-care guidance. State explicitly that you are not providing medical advice and recommend seeing a clinician for individual cases.",
  },
  marketer: {
    id: "marketer",
    label: "Marketer",
    suffix:
      "Answer as a senior marketer. Lead with audience, positioning, and a measurable hypothesis. Distinguish what's a brand bet vs. a performance bet.",
  },
  scientist: {
    id: "scientist",
    label: "Scientist",
    suffix:
      "Answer as a scientist. Lead with the testable hypothesis, the mechanism if known, the empirical evidence (with strength of evidence), and what would falsify the claim.",
  },
  philosopher: {
    id: "philosopher",
    label: "Philosopher",
    suffix:
      "Answer as an analytic philosopher. Clarify the concepts, distinguish related questions, name relevant positions and their leading proponents, and articulate the strongest case for each side.",
  },
  debater: {
    id: "debater",
    label: "Debater",
    suffix:
      "Answer as a competitive debater. Steelman both sides with the strongest available arguments and rebuttals. Don't pick a winner; surface the cruxes.",
  },
  summarizer: {
    id: "summarizer",
    label: "Summarizer",
    suffix:
      "Answer as a precise summarizer. Compress to the smallest set of essential bullets that preserve every load-bearing claim. No padding, no preamble.",
  },
  translator: {
    id: "translator",
    label: "Translator",
    suffix:
      "Answer as a careful technical translator. Render the user's content faithfully across language/domain barriers; preserve technical precision over fluency. Flag ambiguities.",
  },
  "fact-checker": {
    id: "fact-checker",
    label: "Fact-Checker",
    suffix:
      "Answer as a fact-checker. For every claim in the question (or in the other models' answers), classify confidence: established / contested / likely / speculation / unknown. Note specific sources where applicable.",
  },
  copywriter: {
    id: "copywriter",
    label: "Copywriter",
    suffix:
      "Answer as a punchy copywriter. Lead with a hook, write tight active sentences, and propose 2-3 short alternative phrasings the user can pick from.",
  },
};

export const ROLE_LIST: readonly Role[] = Object.values(ROLES);

export type EnsembleId =
  | "none"
  | "code-review"
  | "research"
  | "decision"
  | "brainstorm"
  | "legal"
  | "medical"
  | "marketing"
  | "decompose";

export type Ensemble = {
  id: EnsembleId;
  label: string;
  description: string;
  assignments: Partial<Record<Provider, RoleId>>;
};

export const ENSEMBLES: Record<EnsembleId, Ensemble> = {
  none: {
    id: "none",
    label: "None",
    description: "No roles — everyone answers as a general assistant.",
    assignments: {},
  },
  "code-review": {
    id: "code-review",
    label: "Code Review",
    description: "Architect, reviewer, security, tester — four lenses on the same code.",
    assignments: {
      claude: "architect",
      openai: "reviewer",
      llama: "security",
      gemini: "tester",
    },
  },
  research: {
    id: "research",
    label: "Research",
    description: "Researcher, analyst, devil's advocate, teacher — diverse depth on an open question.",
    assignments: {
      claude: "researcher",
      openai: "analyst",
      llama: "devil",
      gemini: "teacher",
    },
  },
  decision: {
    id: "decision",
    label: "Decision",
    description: "Architect, analyst, devil's advocate, PM — make and pressure-test a call.",
    assignments: {
      claude: "architect",
      openai: "analyst",
      llama: "devil",
      gemini: "pm",
    },
  },
  brainstorm: {
    id: "brainstorm",
    label: "Brainstorm",
    description: "Dev, architect, devil's advocate, teacher — generate and stretch ideas.",
    assignments: {
      claude: "dev",
      openai: "architect",
      llama: "devil",
      gemini: "teacher",
    },
  },
  legal: {
    id: "legal",
    label: "Legal",
    description:
      "Lawyer, fact-checker, devil's advocate, debater — analyze a legal/regulatory question from four angles. NOT legal advice.",
    assignments: {
      claude: "lawyer",
      openai: "fact-checker",
      llama: "devil",
      gemini: "debater",
    },
  },
  medical: {
    id: "medical",
    label: "Medical",
    description:
      "Doctor, scientist, fact-checker, researcher — review a medical question. NOT medical advice.",
    assignments: {
      claude: "doctor",
      openai: "scientist",
      llama: "fact-checker",
      gemini: "researcher",
    },
  },
  marketing: {
    id: "marketing",
    label: "Marketing",
    description:
      "Marketer, copywriter, devil's advocate, analyst — campaign concepts plus cold critique.",
    assignments: {
      claude: "marketer",
      openai: "copywriter",
      llama: "devil",
      gemini: "analyst",
    },
  },
  decompose: {
    id: "decompose",
    label: "Decompose",
    description:
      "Sub-agents: a planner splits the question into ≤3 sub-questions (depth ≤2), each gets its own mini fan-out, then a final synthesis. Best for multi-part questions.",
    assignments: {},
  },
};

export const ENSEMBLE_LIST: readonly Ensemble[] = Object.values(ENSEMBLES);
export const DEFAULT_ENSEMBLE_ID: EnsembleId = "none";

export function findEnsemble(id: string | undefined | null): Ensemble {
  if (id == null) return ENSEMBLES[DEFAULT_ENSEMBLE_ID];
  const found = (ENSEMBLES as Record<string, Ensemble | undefined>)[id];
  return found ?? ENSEMBLES[DEFAULT_ENSEMBLE_ID];
}

export function getRole(id: string | undefined | null): Role | null {
  if (id == null) return null;
  return (ROLES as Record<string, Role | undefined>)[id] ?? null;
}

export function rolesForEnsemble(
  id: string | undefined | null,
): Partial<Record<Provider, RoleId>> {
  return findEnsemble(id).assignments;
}

export function roleSuffixFor(
  provider: Provider,
  roles: Partial<Record<Provider, string>> | undefined,
): string | null {
  if (!roles) return null;
  const r = roles[provider];
  if (!r) return null;
  return getRole(r)?.suffix ?? null;
}

export function isValidRoles(
  raw: unknown,
): raw is Partial<Record<Provider, RoleId>> {
  if (raw == null || typeof raw !== "object" || Array.isArray(raw)) return false;
  const obj = raw as Record<string, unknown>;
  for (const k of Object.keys(obj)) {
    if (!PROVIDERS.includes(k as Provider)) return false;
    const v = obj[k];
    if (v != null && (typeof v !== "string" || !(v in ROLES))) return false;
  }
  return true;
}
