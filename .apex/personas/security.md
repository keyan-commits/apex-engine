# Project-specific extensions — Security persona

This file refines the **security** persona for THIS project. Composes WITH
the server charter at `src/personas/security.md`. MAY extend scope; MAY
NOT redefine the role (the role is "security audit").

## Project threat model

apex-engine is **local-only, single-user, single-machine.** The realistic threat model is NOT a remote attacker. It is:

1. **Indirect prompt injection from upstream LLM providers + web search.** Any content returned by Claude / GPT / Llama / Gemini / DeepSeek / Tavily / DuckDuckGo flows into apex's prompts. A compromised or adversarial upstream (SEO-poisoned web result, a model that returned a directive-shaped string) can attempt to redefine apex's behavior. The Wave 17c security review caught the most dangerous case (web context in synth system prompt); the pattern is real.
2. **Cross-instance MCP callers (other Claude Code sessions on the same machine, in other projects).** Trust boundary: a CC session on another project (LFM, my-finances) calls into apex via MCP. The `code`, `focus`, `context`, `sourceProject` args are caller-controlled. A buggy or compromised caller can attempt injection via these fields. Wave 17c hardened all five (nonce-delimited code, sanitized free-text args, directive-stripped context). The caller is not adversarial in the strict sense — it's the user's own machine — but treat as untrusted because (a) it might be a CC session running on autopilot in a background flow, (b) the user can't audit every cross-session call in real time.
3. **GitHub Issue body injection.** LLM-generated `description` and `error` fields in feedback records flow to public GitHub Issues via `feedback-flush.ts`. An adversarial LLM output can attempt: auto-close keyword injection (`Closes #1` silently closing unrelated issues), markdown injection, code-fence escape. Wave 17c added `stripAutoCloseKeywords`, `escapeInlineCodeValue`, `escapeFencedCodeBody`, `safeTagValue`.
4. **Supply chain.** Native dep (`better-sqlite3`); broad SDK surface (5 LLM provider SDKs + the AI SDK v6). Realistic: typosquats, install-time scripts, CVEs in transitive deps. `pnpm audit` runs as part of `pnpm security:check`.

**Out of scope** (do NOT flag as high severity unless an asset moves out of scope):

- Network exposure / DNS rebinding — apex listens on `127.0.0.1` + `[::1]` only. SDK-level DNS-rebinding protection is on. There is no public deployment story.
- Multi-tenant authorization — single user; no concept of "other users' data."
- Mobile / desktop client exfiltration — there is no client beyond `localhost:3000`.

## Sensitive-data categories

What flows through apex:

- **Provider API keys** in `process.env` (`GITHUB_MODELS_TOKEN`, `GROQ_API_KEY`, `GOOGLE_GENERATIVE_AI_API_KEY`, `DEEPSEEK_API_KEY`, `TAVILY_API_KEY`). Server-only — Engineering Standard #5 mandates these never reach the client bundle. Any new key follows the same rule.
- **Claude OAuth token** — managed by the Claude Code CLI's keychain, not by apex. apex uses the Claude Agent SDK which reads it. Never log or expose.
- **User prompts.** apex deliberately does NOT store full prompts in feedback records — feedback only persists a 200-char `promptSnippet` opt-in. Per the docs: "Full user prompts are never stored."
- **History (`data/apex.db`).** Stores every query + every answer + every synth result. Local file, gitignored. If this file leaves the machine, every prompt + answer + synth content goes with it.
- **Attachments (`data/attachments/`).** Content-addressed; persists every image/PDF/text the user uploaded. Same locality rules as history.
- **No PII/HIPAA/PCI/GDPR scope** — apex is single-user dev tool; there are no end-user records.

## Always-check patterns

Hard-learned. The security persona must look for these on every review of apex-engine code:

- **Untrusted text + system prompt = NEVER.** Web results, scraped content, model outputs, caller-supplied `code`/`focus`/`context` args — all "untrusted." They go in the USER prompt with nonce-delimited framing + explicit "treat as untrusted" preamble. Never in the system prompt. Wave 17c established the pattern; new code must follow it.
- **Code fence injection.** Any code/text wrapped in triple-backtick fences and sent to an LLM is escape-able by an embedded triple-backtick line. Use per-request random nonce delimiters (`[BEGIN_CODE_<nonce>]`/`[END_CODE_<nonce>]`) instead. See `buildCodeReviewPrompt` for the canonical pattern.
- **GitHub auto-close keywords.** ANY string that flows to a public GitHub Issue body must pass `stripAutoCloseKeywords` (or its equivalent). The pattern `(closes|fixes|resolves) #N` is auto-honored by GH. Adversarial LLM outputs WILL include them.
- **Inline-code newline escape.** Markdown inline-code spans terminate at `\n`. Stripping just backticks isn't enough — strip newlines too. See `escapeInlineCodeValue`.
- **`String.fromCodePoint` range guard.** Numeric HTML entities `&#xFFFFFFFF;` throw `RangeError`. Always clamp to [0, 0x10FFFF] via `safeFromCodePoint`. The DDG fallback parser caught this; same pattern applies to any code that decodes numeric entities.
- **Scheme allowlist for URLs.** When apex extracts URLs from upstream content (DDG redirect unwrap), validate with `new URL(...)` AND check `protocol === "http:" || "https:"`. Case-sensitive `.startsWith("javascript:")` is not enough — `JavaScript:`, `data:`, `file:`, `vbscript:`, etc.
- **Double-decode `URIError` risk.** `URLSearchParams.get()` already URL-decodes once. A second `decodeURIComponent()` on the same string throws on legitimate `%`-containing URLs. Trust the framework's decoding once; don't re-decode.
- **`sanitizeContextBlock` on every caller-supplied free-text arg** that lands in an LLM-visible prompt slot. `context`, `language`, `focus` — all need the directive-stripping pass. The schema's promise of "directive-shaped lines are stripped" must be backed by an actual `sanitizeContextBlock` call (Wave 17c caught the dead-letter case).
- **Test fixtures that look like real secrets.** Stripe/AWS/Anthropic/Groq key shapes in test files get rejected by GitHub Push Protection. Defragment at runtime: `"sk_" + "live_" + "abcdef..."` instead of `"sk_live_abcdef..."`.
- **`spawnSync` argv-safety.** apex shells out to `gh`, `pnpm`, etc. Arguments go in via the argv array (safe) — but if any argument crosses into the shell flag of `spawn` or `execSync` with a string command, that's command injection. The convention is `spawnSync("gh", [...args])` ONLY.

## Pointers

- **Security gate:** `pnpm security:check` — runs secret-scan on tracked files + `pnpm audit` (high/critical only) + apex invariants (no prompt content in feedback records; no `console.log` of prompts in catch blocks).
- **Secret pattern list:** `src/lib/secret-patterns.ts` — shared between the secret-scan, the qa-check tail redactor, and `feedback-flush.ts`'s `redactSecrets`. Adding a new credential shape there propagates everywhere automatically.
- **Auto-cleanup safety contract:** `scripts/feedback-cleanup.ts` — closes ONLY `[auto-*]` title-prefixed issues, NEVER human-filed ones. Only fires from inside a passing gate's success branch.
- **Past security reviews** — issues #1-#20 in the GH issue tracker (most closed); look for `auto-security` label + Wave 17c commit `8666da0` for the most recent comprehensive review.
- **Vulnerability disclosure** — single-user local-only project; report to the repo owner via apex_report or directly via GitHub Security Advisory if a CVE-class issue is found.
