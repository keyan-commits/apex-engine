// Wave 19b — file-loader for apex_code_review / apex_security_review.
//
// Real failure (GH issue #25): the 8000-char snippet cap meant personas
// reviewed fragments. They flagged "missing bounds check" when the
// surrounding `while ((line = readNext()) != null)` handled it; flagged
// "SQL injection" when the JDBC binding was parameterized; flagged a
// "DELETE-then-INSERT bug" that was pre-existing/intentional/tested. The
// dissent-preserving synth then amplified those false-positives into P0s.
//
// Fix: caller passes `filePath` (relative to projectRoot). apex reads the
// full file, prepends line numbers, and uses that instead of the snippet
// `code` arg. Cap rises to FILE_MODE_MAX_CHARS (20000) so a typical
// 500-line file fits.
//
// Path security: `filePath` is resolved against `projectRoot` and the
// final path MUST stay inside the project root (no `..` escape). Symlinks
// resolve to their target but the target must also be inside projectRoot.

import { readFileSync, realpathSync, statSync } from "node:fs";
import { resolve, sep } from "node:path";

const FILE_MODE_MAX_CHARS = 20_000;
// Approx: ~500 lines × 80 chars + line-number prefixes.

export type LoadFileResult =
  | {
      ok: true;
      absolutePath: string;
      relativePath: string;
      content: string;
      truncated: boolean;
      originalChars: number;
    }
  | {
      ok: false;
      reason: string;
    };

function isInside(parent: string, child: string): boolean {
  // Both must already be absolute + realpath-resolved. parent must end
  // with separator OR exactly match child (file === root is silly but
  // not a security violation).
  const parentNorm = parent.endsWith(sep) ? parent : `${parent}${sep}`;
  return child === parent || child.startsWith(parentNorm);
}

/**
 * Load <projectRoot>/<filePath> and return its content with line numbers
 * prepended. Capped at FILE_MODE_MAX_CHARS; truncated with a marker.
 *
 * Returns ok=false on:
 *   - projectRoot or filePath missing/invalid
 *   - resolved path escapes projectRoot (traversal attempt)
 *   - file doesn't exist or isn't a regular file
 *   - read fails for any reason
 */
export function loadReviewFile(
  projectRoot: string | undefined | null,
  filePath: string | undefined | null,
): LoadFileResult {
  if (!projectRoot || typeof projectRoot !== "string") {
    return {
      ok: false,
      reason: "filePath requires projectRoot — pass the absolute path to your project's root",
    };
  }
  if (!filePath || typeof filePath !== "string") {
    return { ok: false, reason: "filePath must be a non-empty string" };
  }
  if (filePath.includes("\0")) {
    return { ok: false, reason: "filePath contains a null byte" };
  }

  let rootAbs: string;
  let candidateAbs: string;
  try {
    rootAbs = realpathSync(resolve(projectRoot));
  } catch (err) {
    return {
      ok: false,
      reason: `projectRoot is not a real directory: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
  try {
    // Resolve BEFORE realpath so we can attribute the traversal error to
    // the user-supplied input rather than the symlink resolver.
    const joined = resolve(rootAbs, filePath);
    candidateAbs = realpathSync(joined);
  } catch {
    return {
      ok: false,
      reason: `filePath does not resolve to a real file inside projectRoot (resolved candidate did not exist or symlinked outside)`,
    };
  }

  if (!isInside(rootAbs, candidateAbs)) {
    return {
      ok: false,
      reason: `filePath escapes projectRoot (resolved to ${candidateAbs} which is outside ${rootAbs})`,
    };
  }

  let isFile = false;
  try {
    isFile = statSync(candidateAbs).isFile();
  } catch {
    return { ok: false, reason: "filePath resolved to something that is not a regular file" };
  }
  if (!isFile) {
    return { ok: false, reason: "filePath resolved to a directory, not a file" };
  }

  let raw: string;
  try {
    raw = readFileSync(candidateAbs, "utf8");
  } catch (err) {
    return {
      ok: false,
      reason: `failed to read file: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  const originalChars = raw.length;
  let truncated = false;
  let body = raw;
  if (body.length > FILE_MODE_MAX_CHARS) {
    body = body.slice(0, FILE_MODE_MAX_CHARS);
    truncated = true;
  }

  // Prepend line numbers. Use the original (pre-truncation) line count
  // to pick the padding width.
  const totalLines = raw.split("\n").length;
  const padWidth = String(totalLines).length;
  const lines = body.split("\n");
  const numbered = lines
    .map((line, i) => `${String(i + 1).padStart(padWidth, " ")}: ${line}`)
    .join("\n");

  const tail = truncated
    ? `\n${" ".repeat(padWidth)}: …[truncated; ${originalChars - FILE_MODE_MAX_CHARS} more chars not shown — review per-function or per-section for the rest]`
    : "";

  // The relativePath is what we display to the model — caller's view.
  // We strip the projectRoot prefix from candidateAbs for display.
  const relativePath = candidateAbs.startsWith(rootAbs + sep)
    ? candidateAbs.slice(rootAbs.length + 1)
    : candidateAbs;

  return {
    ok: true,
    absolutePath: candidateAbs,
    relativePath,
    content: numbered + tail,
    truncated,
    originalChars,
  };
}

export const REVIEW_FILE_MODE_MAX_CHARS = FILE_MODE_MAX_CHARS;
