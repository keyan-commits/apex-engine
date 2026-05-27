#!/usr/bin/env python3
"""Validate INDEX.yaml against the repo. Zero dependencies (line-parses the
controlled INDEX.yaml format — no PyYAML needed).

ERRORS (exit 1 — the pre-commit hook blocks):
  1. an entry is missing a required key
  2. an entry `path` doesn't exist (file or directory)
  3. an entry leaks a money/amount figure (the index must describe, not reproduce)

WARNINGS (printed, never block):
  - a root-level *.md (except README/INDEX/HANDOFF) isn't indexed — coverage is a
    nudge here so adopting the pattern never blocks an existing repo's commits.
  - doc_type / authority_tier outside the known vocab.

Usage:  python3 scripts/validate_index.py   (from the repo root)
"""
import os, re, subprocess, sys

REQUIRED = {"path", "purpose", "topics", "doc_type", "authority_tier"}
DOC_TYPES = {"entry","specification","reference","analysis","planning","log","index","guide"}
TIERS = {"entry","authoritative","planning","meta","historical","archived","log","working","reference"}
PII = [re.compile(r"₱"), re.compile(r"\bPHP\s*\d"), re.compile(r"\$\s?\d"),
       re.compile(r"\b\d{1,3}(?:,\d{3})+(?:\.\d+)?\b")]
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__))) if os.path.basename(os.path.dirname(os.path.abspath(__file__)))=="scripts" else os.getcwd()
# When run from a repo (the normal case) resolve to the git toplevel:
try:
    ROOT = subprocess.run(["git","rev-parse","--show-toplevel"],capture_output=True,text=True,check=True).stdout.strip() or ROOT
except Exception:
    pass
INDEX = os.path.join(ROOT, "INDEX.yaml")


def parse(text):
    entries, cur = [], None
    for i, line in enumerate(text.splitlines(), 1):
        m = re.match(r"^\s*-\s+path:\s*(.+?)\s*$", line)
        if m:
            if cur: entries.append(cur)
            cur = {"path": m.group(1).strip(), "keys": {"path"}, "line": i, "body": [line]}
            continue
        if cur is not None:
            km = re.match(r"^\s+([a-z_]+):", line)
            if km: cur["keys"].add(km.group(1))
            cur["body"].append(line)
    if cur: entries.append(cur)
    return entries


def tracked_root_docs():
    try:
        out = subprocess.run(["git","ls-files"],cwd=ROOT,capture_output=True,text=True,check=True).stdout
    except Exception:
        return []
    docs=[]
    for p in out.splitlines():
        base=os.path.basename(p)
        if base in ("README.md","INDEX.md","HANDOFF.md"): continue
        if p.endswith(".md") and ("/" not in p or p.startswith("_archive/")):
            docs.append(p)
    return docs


def main():
    if not os.path.exists(INDEX):
        print(f"ERROR: {INDEX} not found"); return 1
    entries = parse(open(INDEX,encoding="utf-8").read())
    if not entries:
        print("ERROR: no entries parsed from INDEX.yaml"); return 1
    errors, warnings, idx = [], [], set()
    for e in entries:
        p, body = e["path"], "\n".join(e["body"]); idx.add(p.rstrip("/"))
        miss = REQUIRED - e["keys"]
        if miss: errors.append(f"entry '{p}' (line {e['line']}): missing {sorted(miss)}")
        if not os.path.exists(os.path.join(ROOT,p)): errors.append(f"entry '{p}' (line {e['line']}): path does not exist")
        for pat in PII:
            if pat.search(body): errors.append(f"entry '{p}' (line {e['line']}): looks like a money/amount figure — keep entries non-leaking"); break
        for key, allowed in (("doc_type",DOC_TYPES),("authority_tier",TIERS)):
            mv = re.search(rf"^\s+{key}:\s*(\S+)", body, re.M)
            if mv and mv.group(1) not in allowed: warnings.append(f"entry '{p}': {key}='{mv.group(1)}' not in {sorted(allowed)}")
    for f in tracked_root_docs():
        if f not in idx: warnings.append(f"root doc not indexed: {f} (add an INDEX.yaml entry, or ignore if intentional)")
    for w in warnings: print(f"WARN:  {w}")
    for er in errors: print(f"ERROR: {er}")
    if errors:
        print(f"\n✗ INDEX.yaml validation failed: {len(errors)} error(s)."); return 1
    print(f"✓ INDEX.yaml OK — {len(entries)} entries, all paths exist, no leaked figures."
          + (f" ({len(warnings)} warning(s))" if warnings else ""))
    return 0


if __name__ == "__main__":
    sys.exit(main())
