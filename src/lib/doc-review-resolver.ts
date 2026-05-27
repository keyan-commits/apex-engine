// Wave 22c — Resolution Report for apex_doc_review.
//
// Cheap mechanical pre-pass over the doc body that extracts every
// path-style reference and checks if the target exists. The result
// is prepended to the panel's input prompt as a "Resolution Report"
// block so the `freshness` reviewer can cite hard evidence
// (`engine.ts:streamMultimodal → NOT FOUND`) instead of hallucinating
// "looks fresh" judgments.
//
// MoA verdict 2026-05-27 confidence 85: option B — tool resolves
// before fan-out. Option A (trust personas) was rejected as brittle;
// option C (skip) leaves the staleness + cross-refs persona blind.
//
// Scope:
//   - Only filesystem refs (no URL/network resolution; that's brittle).
//   - Detects `path/to/file` and `path/to/file:symbol` patterns.
//   - File EXISTS check via fs.existsSync.
//   - Symbol check via a grep-style scan of the file content (cheap,
//     no language-aware parsing — false-positives accepted).
//   - Caps the report at a fixed number of refs to avoid runaway.

import { existsSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";

const MAX_REFS_RESOLVED = 50;
const REF_PATTERN =
  // Matches:
  //   src/lib/engine.ts
  //   src/lib/engine.ts:streamMultimodal
  //   ./docs/foo.md
  //   ../web-fetch.ts
  // Must have a / and an extension to avoid matching prose words.
  /(?<![\w/])(\.{0,2}\/?[\w-]+(?:\/[\w.-]+)+\.[a-z]{1,5})(?::([a-zA-Z_][a-zA-Z0-9_]*))?/g;

export type ResolutionEntry = {
  ref: string;
  status: "EXISTS" | "FILE NOT FOUND" | "SYMBOL NOT FOUND" | "ERROR";
  detail?: string;
};

export type ResolutionReport = {
  entries: ResolutionEntry[];
  totalFound: number;
  truncated: boolean;
};

export function extractRefs(body: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const m of body.matchAll(REF_PATTERN)) {
    const path = m[1];
    const symbol = m[2];
    if (!path) continue;
    const full = symbol ? `${path}:${symbol}` : path;
    if (seen.has(full)) continue;
    seen.add(full);
    out.push(full);
  }
  return out;
}

export function resolveRefs(
  projectRoot: string,
  refs: string[],
): ResolutionReport {
  const entries: ResolutionEntry[] = [];
  const totalFound = refs.length;
  const limit = Math.min(refs.length, MAX_REFS_RESOLVED);
  for (let i = 0; i < limit; i++) {
    const ref = refs[i];
    if (typeof ref !== "string") continue;
    const [pathPart, symbol] = ref.includes(":")
      ? [ref.slice(0, ref.indexOf(":")), ref.slice(ref.indexOf(":") + 1)]
      : [ref, undefined];
    if (!pathPart) {
      entries.push({ ref, status: "ERROR", detail: "empty path part" });
      continue;
    }
    try {
      const abs = resolve(projectRoot, pathPart);
      if (!existsSync(abs)) {
        entries.push({ ref, status: "FILE NOT FOUND" });
        continue;
      }
      const st = statSync(abs);
      if (!st.isFile()) {
        // Directory or other. We treat "exists" as a file-only check
        // for staleness purposes; a directory existing is a separate
        // problem the reviewer handles.
        entries.push({ ref, status: "EXISTS", detail: "(directory)" });
        continue;
      }
      if (!symbol) {
        entries.push({ ref, status: "EXISTS" });
        continue;
      }
      // Symbol check: cheap content scan. We look for the symbol as a
      // whole-word match in the file body. False positives are fine
      // (e.g. matches in comments); the panel reviewer can dismiss.
      // False negatives (symbol exists but not visible in source —
      // e.g. re-exported via barrel) are an acceptable trade-off.
      const content = readFileSync(abs, "utf8");
      const symbolRe = new RegExp(`\\b${escapeRegex(symbol)}\\b`);
      if (symbolRe.test(content)) {
        entries.push({ ref, status: "EXISTS" });
      } else {
        entries.push({
          ref,
          status: "SYMBOL NOT FOUND",
          detail: `file exists; symbol \`${symbol}\` not present in source`,
        });
      }
    } catch (err) {
      entries.push({
        ref,
        status: "ERROR",
        detail: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return {
    entries,
    totalFound,
    truncated: totalFound > MAX_REFS_RESOLVED,
  };
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function formatResolutionReport(report: ResolutionReport): string {
  if (report.entries.length === 0) {
    return `## Resolution Report\n\n_(no path-style references detected in the doc)_`;
  }
  const lines = [
    "## Resolution Report",
    "",
    `Mechanical pre-resolution of file/symbol references found in the doc. The \`freshness\` reviewer should cite this directly. Refs marked \`EXISTS\` should not be flagged as stale unless other evidence suggests they're conceptually outdated. ${report.truncated ? `(Showing first ${MAX_REFS_RESOLVED} of ${report.totalFound}.)` : `(${report.totalFound} ref${report.totalFound === 1 ? "" : "s"} resolved.)`}`,
    "",
  ];
  for (const e of report.entries) {
    const detail = e.detail ? ` — ${e.detail}` : "";
    lines.push(`- \`${e.ref}\` → **${e.status}**${detail}`);
  }
  return lines.join("\n");
}

export const DOC_REVIEW_RESOLVER_CONSTANTS = {
  MAX_REFS_RESOLVED,
} as const;
