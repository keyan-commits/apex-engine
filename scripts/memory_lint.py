#!/usr/bin/env python3
"""memory_lint.py — integrity check for the file-based memory store.

Zero dependencies (line-parses the controlled frontmatter — no PyYAML), to match
validate_index.py. Runs against the committed `memory/` mirror (the pre-commit
hook syncs the active ~/.claude store into it first), so what gets committed is
what gets checked.

ERRORS (exit 1 — the pre-commit hook blocks):
  1. a memory file has no `---` frontmatter block at all (unparseable)
  2. no resolvable `type:` (neither flat `type:` nor nested `metadata.type:`)
  3. `type:` is outside the allowed vocab
  4. MEMORY.md points at a `file.md` that doesn't exist (broken index pointer)

WARNINGS (printed, never block — these track *drift*, not breakage):
  - missing `name:` or `description:`
  - a memory file isn't listed in MEMORY.md (index drift)
  - a `[[wikilink]]` resolves to nothing. Dangling links are allowed by the
    memory convention (a forward-reference to a note not written yet), so this is
    a nudge, not an error.

Usage:  python3 scripts/memory_lint.py [--dir memory] [--quiet]
"""
import argparse, os, re, subprocess, sys

ALLOWED_TYPES = {"user", "feedback", "project", "reference"}
SKIP = {"README.md", "MEMORY.md"}


def repo_root():
    try:
        return subprocess.run(["git", "rev-parse", "--show-toplevel"],
                              capture_output=True, text=True, check=True).stdout.strip()
    except Exception:
        return os.getcwd()


def frontmatter(text):
    """Return the raw frontmatter block (between the first pair of --- lines), or None."""
    m = re.match(r"^---\s*\n(.*?)\n---\s*(\n|$)", text, flags=re.S)
    return m.group(1) if m else None


def fm_value(fm, key):
    m = re.search(r"(?m)^\s*%s:\s*(.+?)\s*$" % re.escape(key), fm)
    return m.group(1).strip().strip('"').strip("'") if m else None


def fm_type(fm):
    # Matches flat `type: feedback` and nested `  type: reference`; NOT `node_type:`.
    m = re.search(r"(?m)^\s*type:\s*(\S+)", fm)
    return m.group(1) if m else None


def slugify(s):
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dir", default=None, help="memory dir (default: <repo>/memory)")
    ap.add_argument("--quiet", action="store_true", help="suppress warnings; only errors")
    args = ap.parse_args()

    root = repo_root()
    mem = args.dir or os.path.join(root, "memory")
    if not os.path.isdir(mem):
        print(f"memory_lint: no memory dir at {mem} — skipping.")
        return 0

    files = sorted(f for f in os.listdir(mem) if f.endswith(".md") and f not in SKIP)
    errors, warnings = [], []

    # Build the wikilink target namespace: union of name slugs + filename stems
    # (both `_`- and `-`-separated), all lowercased, so links resolve leniently
    # across the store's mixed naming conventions.
    targets, metas = set(), {}
    for f in files:
        text = open(os.path.join(mem, f), encoding="utf-8").read()
        fm = frontmatter(text)
        metas[f] = (fm, text)
        stem = f[:-3]
        targets.add(stem.lower())
        targets.add(stem.replace("_", "-").lower())
        if fm:
            name = fm_value(fm, "name")
            if name:
                targets.add(slugify(name))

    # Per-file structural checks
    for f in files:
        fm, text = metas[f]
        if fm is None:
            errors.append(f"{f}: no frontmatter block (`---` … `---`)")
            continue
        t = fm_type(fm)
        if t is None:
            errors.append(f"{f}: no `type:` (flat or nested under metadata:)")
        elif t not in ALLOWED_TYPES:
            errors.append(f"{f}: type '{t}' not in {sorted(ALLOWED_TYPES)}")
        if not fm_value(fm, "name"):
            warnings.append(f"{f}: missing `name:`")
        if not fm_value(fm, "description"):
            warnings.append(f"{f}: missing `description:`")
        body = text[text.index(fm) + len(fm):] if fm else text
        for link in re.findall(r"\[\[([a-z0-9][a-z0-9-]*)\]\]", body):
            if link.lower() not in targets:
                warnings.append(f"{f}: dangling [[{link}]] (no matching memory note yet)")

    # MEMORY.md index <-> files cross-check
    idx = os.path.join(mem, "MEMORY.md")
    referenced = set()
    if os.path.isfile(idx):
        for line in open(idx, encoding="utf-8"):
            for ref in re.findall(r"\(([^)]+\.md)\)", line):
                referenced.add(os.path.basename(ref))
                if not os.path.isfile(os.path.join(mem, os.path.basename(ref))):
                    errors.append(f"MEMORY.md: references missing file '{ref}'")
        for f in files:
            if f not in referenced:
                warnings.append(f"{f}: not listed in MEMORY.md (index drift — add a pointer)")
    else:
        warnings.append("MEMORY.md not found — no index to cross-check")

    if warnings and not args.quiet:
        for w in warnings:
            print(f"  ⚠ {w}")
    for e in errors:
        print(f"  ✗ {e}", file=sys.stderr)

    n = len(files)
    if errors:
        print(f"memory_lint: {len(errors)} error(s), {len(warnings)} warning(s) across {n} notes.", file=sys.stderr)
        return 1
    print(f"✓ memory_lint OK — {n} notes, 0 errors, {len(warnings)} warning(s).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
