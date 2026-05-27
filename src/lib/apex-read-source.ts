// Wave 22b — `apex_read_source` MCP tool (LFM #31).
//
// Lets a remote LFM/agent or another Claude session read files /
// list directories from a target project's working tree, for
// grounding. Symmetric to apex_query_source (#13) but for source
// files rather than declared SQLite/CSV data sources.
//
// Path traversal: same realpathSync(resolve(...)) + isInside(rootAbs,
// candidateAbs) discipline as `review-file-loader.ts`. Symlinks
// resolve to their target, and the target MUST stay inside
// projectRoot.
//
// Denylist (hardcoded, not config-driven for v1): node_modules, .git,
// .next, build, dist, out, coverage, .vercel, .turbo, data, and any
// path segment that starts with `.env`. We reject the FULL resolved
// path containing any of these as a segment — not just substring —
// to avoid false-positives like a legit `src/data.ts` file.
//
// Caps:
//   read mode:    20,000 chars (reuse review-file-loader's cap)
//   list mode:    200 entries, sorted (dirs first), truncation footer
//   tree mode:    200 entries, default depth 2, hard cap 4
//   total:        30,000 chars across all modes — hard ceiling
//
// MoA verdict 2026-05-27, confidence 80:
//   - one tool with `mode` enum (Claude + Llama; GPT minority for 3 tools)
//   - hardcoded denylist (Claude's YAGNI; defer .apex config to a
//     follow-up if anyone asks)
//   - 30k total response cap (compromise: Claude 30k, GPT 50k, Llama 10k)

import { readdirSync, realpathSync, statSync } from "node:fs";
import { resolve, sep } from "node:path";
import { loadReviewFile } from "./review-file-loader";

const LIST_ENTRY_CAP = 200;
const TREE_DEFAULT_DEPTH = 2;
const TREE_MAX_DEPTH = 4;
const TOTAL_RESPONSE_CAP = 30_000;

// Denylist matched as a path SEGMENT, not substring. A segment is any
// `name` between `sep` characters (or at path boundaries). So `data`
// matches `/x/y/data/z.ts` but NOT `/x/y/datasheet.ts`. `.env` matches
// `/x/y/.env` AND `/x/y/.env.local` because we also check
// startsWith(".env") as a special case.
const DENY_SEGMENTS = [
  "node_modules",
  ".git",
  ".next",
  ".turbo",
  ".vercel",
  "build",
  "dist",
  "out",
  "coverage",
  "data",
] as const;

export type ReadSourceMode = "read" | "list" | "tree";

export type ReadSourceResult =
  | { ok: true; text: string }
  | { ok: false; reason: string };

function isInside(parent: string, child: string): boolean {
  const parentNorm = parent.endsWith(sep) ? parent : `${parent}${sep}`;
  return child === parent || child.startsWith(parentNorm);
}

function hasDenylistedSegment(absPath: string, rootAbs: string): string | null {
  // Only check the path UNDER rootAbs (don't reject because some
  // ancestor of the project root contains `data` or `dist`).
  const rel = absPath.startsWith(rootAbs + sep)
    ? absPath.slice(rootAbs.length + 1)
    : absPath === rootAbs
      ? ""
      : absPath;
  if (!rel) return null;
  const segments = rel.split(sep).filter(Boolean);
  for (const seg of segments) {
    if (seg.startsWith(".env")) return seg;
    if ((DENY_SEGMENTS as readonly string[]).includes(seg)) return seg;
  }
  return null;
}

function resolveCandidate(
  projectRoot: string,
  targetPath: string,
): { ok: true; rootAbs: string; candidateAbs: string } | { ok: false; reason: string } {
  if (typeof projectRoot !== "string" || !projectRoot) {
    return {
      ok: false,
      reason: "projectRoot is required (absolute path to your project's root)",
    };
  }
  if (typeof targetPath !== "string" || !targetPath) {
    return { ok: false, reason: "path is required (relative to projectRoot)" };
  }
  if (targetPath.includes("\0")) {
    return { ok: false, reason: "path contains a null byte" };
  }

  let rootAbs: string;
  try {
    rootAbs = realpathSync(resolve(projectRoot));
  } catch (err) {
    return {
      ok: false,
      reason: `projectRoot is not a real directory: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  let candidateAbs: string;
  try {
    candidateAbs = realpathSync(resolve(rootAbs, targetPath));
  } catch {
    return {
      ok: false,
      reason: `path does not resolve to a real entry inside projectRoot (resolved candidate did not exist or symlinked outside)`,
    };
  }

  if (!isInside(rootAbs, candidateAbs)) {
    return {
      ok: false,
      reason: `path escapes projectRoot (resolved to ${candidateAbs} which is outside ${rootAbs})`,
    };
  }

  const denied = hasDenylistedSegment(candidateAbs, rootAbs);
  if (denied) {
    return {
      ok: false,
      reason: `path traverses a denylisted segment (\`${denied}\`). Denylist: ${DENY_SEGMENTS.join(", ")}, plus any segment starting with \`.env\`. If you need this file, copy it under a non-denied path or use apex_query_source for declared data sources.`,
    };
  }

  return { ok: true, rootAbs, candidateAbs };
}

function enforceTotalCap(text: string): string {
  if (text.length <= TOTAL_RESPONSE_CAP) return text;
  const cut = text.slice(0, TOTAL_RESPONSE_CAP);
  return `${cut}\n... output truncated at ${TOTAL_RESPONSE_CAP} chars total response cap (use a deeper path or read mode to narrow)`;
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function readSourceFile(
  projectRoot: string,
  targetPath: string,
): ReadSourceResult {
  // Guard up front. loadReviewFile ALSO guards, but we want consistent
  // error messages + the denylist enforcement before we read.
  const r = resolveCandidate(projectRoot, targetPath);
  if (!r.ok) return r;

  try {
    if (!statSync(r.candidateAbs).isFile()) {
      return { ok: false, reason: "path resolved to a directory, not a file (use mode=\"list\" or mode=\"tree\")" };
    }
  } catch {
    return { ok: false, reason: "path resolved to something that is not a regular file" };
  }

  // Delegate the actual read + line-number prefix + 20k cap to the
  // existing helper so we don't double-implement the truncation logic.
  const loaded = loadReviewFile(r.rootAbs, targetPath);
  if (!loaded.ok) return { ok: false, reason: loaded.reason };
  const header = `**${loaded.relativePath}** (${formatBytes(loaded.originalChars)}${loaded.truncated ? ", truncated" : ""})\n\n\`\`\`\n${loaded.content}\n\`\`\``;
  return { ok: true, text: enforceTotalCap(header) };
}

type Entry = { name: string; isDir: boolean; size: number };

function readEntries(absDir: string, rootAbs: string): Entry[] {
  const raw = readdirSync(absDir);
  const out: Entry[] = [];
  for (const name of raw) {
    const full = resolve(absDir, name);
    // Skip denylisted CHILDREN (we already passed the parent itself).
    // hasDenylistedSegment checks the path UNDER rootAbs, so passing
    // the child's absolute path against rootAbs catches e.g.
    // `node_modules` directly under projectRoot.
    if (hasDenylistedSegment(full, rootAbs)) continue;
    try {
      const st = statSync(full);
      out.push({
        name,
        isDir: st.isDirectory(),
        size: st.isFile() ? st.size : 0,
      });
    } catch {
      // Symlink dangling, permissions etc. — skip silently. Listing
      // shouldn't fail loudly on a single bad entry.
    }
  }
  // Directories first, then alphabetical within each group.
  out.sort((a, b) => {
    if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  return out;
}

export function listSourceDir(
  projectRoot: string,
  targetPath: string,
): ReadSourceResult {
  const r = resolveCandidate(projectRoot, targetPath);
  if (!r.ok) return r;

  try {
    if (!statSync(r.candidateAbs).isDirectory()) {
      return { ok: false, reason: "path resolved to a file, not a directory (use mode=\"read\")" };
    }
  } catch {
    return { ok: false, reason: "path resolved to something that is not a directory" };
  }

  const entries = readEntries(r.candidateAbs, r.rootAbs);
  const shown = entries.slice(0, LIST_ENTRY_CAP);
  const relRoot = r.candidateAbs === r.rootAbs
    ? "."
    : r.candidateAbs.slice(r.rootAbs.length + 1);
  const lines: string[] = [`**${relRoot}/** — ${entries.length} entr${entries.length === 1 ? "y" : "ies"}${entries.length > LIST_ENTRY_CAP ? ` (showing first ${LIST_ENTRY_CAP})` : ""}`, ""];
  for (const e of shown) {
    if (e.isDir) lines.push(`- 📁 ${e.name}/`);
    else lines.push(`- 📄 ${e.name} (${formatBytes(e.size)})`);
  }
  if (entries.length > LIST_ENTRY_CAP) {
    lines.push("", `... ${entries.length - LIST_ENTRY_CAP} more entries omitted (denylisted entries already filtered)`);
  }
  return { ok: true, text: enforceTotalCap(lines.join("\n")) };
}

export function treeSourceDir(
  projectRoot: string,
  targetPath: string,
  maxDepth: number = TREE_DEFAULT_DEPTH,
): ReadSourceResult {
  const r = resolveCandidate(projectRoot, targetPath);
  if (!r.ok) return r;

  try {
    if (!statSync(r.candidateAbs).isDirectory()) {
      return { ok: false, reason: "path resolved to a file, not a directory (use mode=\"read\")" };
    }
  } catch {
    return { ok: false, reason: "path resolved to something that is not a directory" };
  }

  // Cap defensively. zod schema clamps in the public API but lib
  // callers can pass arbitrary numbers — keep them safe too.
  const depth = Math.min(Math.max(1, Math.floor(maxDepth) || 1), TREE_MAX_DEPTH);
  const relRoot = r.candidateAbs === r.rootAbs
    ? "."
    : r.candidateAbs.slice(r.rootAbs.length + 1);
  const lines: string[] = [`**${relRoot}/** — depth ${depth}`, ""];
  let totalShown = 0;
  let truncatedAtCap = false;

  const walk = (absDir: string, indent: number): void => {
    if (truncatedAtCap) return;
    if (indent >= depth) return;
    const entries = readEntries(absDir, r.rootAbs);
    for (const e of entries) {
      if (totalShown >= LIST_ENTRY_CAP) {
        truncatedAtCap = true;
        return;
      }
      const pad = "  ".repeat(indent);
      if (e.isDir) {
        lines.push(`${pad}📁 ${e.name}/`);
        totalShown++;
        walk(resolve(absDir, e.name), indent + 1);
      } else {
        lines.push(`${pad}📄 ${e.name} (${formatBytes(e.size)})`);
        totalShown++;
      }
    }
  };
  walk(r.candidateAbs, 0);

  if (truncatedAtCap) {
    lines.push("", `... entry cap (${LIST_ENTRY_CAP}) hit — tree truncated. Narrow with a deeper \`path\` or smaller \`maxDepth\`.`);
  }
  return { ok: true, text: enforceTotalCap(lines.join("\n")) };
}

export const APEX_READ_SOURCE_CONSTANTS = {
  LIST_ENTRY_CAP,
  TREE_DEFAULT_DEPTH,
  TREE_MAX_DEPTH,
  TOTAL_RESPONSE_CAP,
  DENY_SEGMENTS,
} as const;
