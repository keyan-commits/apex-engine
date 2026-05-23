export type PromptTemplate = {
  id: string;
  label: string;
  description: string;
  body: string;
};

export const TEMPLATES: readonly PromptTemplate[] = [
  {
    id: "bug-report",
    label: "Bug report",
    description: "Triage a bug systematically.",
    body: `I'm seeing this bug: <describe the symptom>

Reproduction steps:
1.
2.
3.

Expected:
Actual:

Environment / version:
Relevant logs or error message:

What's the most likely root cause, and what would you check first?`,
  },
  {
    id: "decision-memo",
    label: "Decision memo",
    description: "Frame a decision with options + recommendation.",
    body: `I need to decide: <describe the decision>

Context:
- <constraint 1>
- <constraint 2>

Options I'm considering:
1.
2.
3.

What I care about (in order): <speed, cost, reversibility, risk, etc.>

Walk through tradeoffs and recommend one, with a one-line "if X changes, switch to Y" trigger.`,
  },
  {
    id: "code-review",
    label: "Code review",
    description: "Get a multi-lens review on a code snippet.",
    body: `Review this code for correctness, style, security, and maintainability.

\`\`\`
// paste code here
\`\`\`

Context (what it does, who calls it): <…>

Surface real issues only — no nits unless they hide a bug.`,
  },
  {
    id: "research-summary",
    label: "Research summary",
    description: "Synthesize what's known about a topic.",
    body: `Summarize the current state of: <topic>

Cover:
- Key claims with confidence levels
- Major disagreements
- Open questions
- Practical implications

Cite specific sources where possible.`,
  },
  {
    id: "explain-like-pro",
    label: "Explain to a pro",
    description: "Explain a concept assuming domain expertise.",
    body: `Explain <concept> to me. I'm experienced in <field> but new to this specific area. Skip the basics; cover the parts that actually matter for understanding it well.`,
  },
  {
    id: "compare",
    label: "Compare X vs Y",
    description: "Side-by-side comparison with a recommendation.",
    body: `Compare <X> and <Y> for <use case>.

Cover:
- How they differ on dimensions that matter
- When each wins
- A recommendation for my case
- Anything I should watch out for`,
  },
  {
    id: "plan",
    label: "Plan a project",
    description: "Generate a milestoned plan with risks.",
    body: `I want to build/ship: <goal>

Constraints: <time, team size, dependencies>

Generate a milestoned plan. For each milestone, name the deliverable, the highest-risk subtask, and how I'd know it's done.`,
  },
];

export function findTemplate(id: string): PromptTemplate | null {
  return TEMPLATES.find((t) => t.id === id) ?? null;
}
