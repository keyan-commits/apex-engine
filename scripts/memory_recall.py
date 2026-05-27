#!/usr/bin/env python3
"""memory_recall.py — active search over the file-based memory store.

Zero dependencies (stdlib only). Lets the agent pull *specific* facts by type or
keyword instead of the all-or-nothing of "read MEMORY.md" vs "read every note".
Searches the committed `memory/` mirror by default.

Examples:
  python3 scripts/memory_recall.py --type feedback          # all feedback notes
  python3 scripts/memory_recall.py corp separation          # keyword search
  python3 scripts/memory_recall.py --type project beta      # project notes mentioning "beta"
  python3 scripts/memory_recall.py --list                   # one line per note

Matching: --type filters on the note's type; positional words are AND-matched
(case-insensitive) against name + description + body. Output is name, type,
description, and path — enough to decide which note to open in full.
"""
import argparse, os, re, subprocess, sys

SKIP = {"README.md", "MEMORY.md"}


def repo_root():
    try:
        return subprocess.run(["git", "rev-parse", "--show-toplevel"],
                              capture_output=True, text=True, check=True).stdout.strip()
    except Exception:
        return os.getcwd()


def frontmatter(text):
    m = re.match(r"^---\s*\n(.*?)\n---\s*(\n|$)", text, flags=re.S)
    return (m.group(1), text[m.end():]) if m else ("", text)


def fm_value(fm, key):
    m = re.search(r"(?m)^\s*%s:\s*(.+?)\s*$" % re.escape(key), fm)
    return m.group(1).strip().strip('"').strip("'") if m else ""


def fm_type(fm):
    m = re.search(r"(?m)^\s*type:\s*(\S+)", fm)
    return m.group(1) if m else ""


def main():
    ap = argparse.ArgumentParser(description="Search the memory store.")
    ap.add_argument("words", nargs="*", help="keywords (AND-matched, case-insensitive)")
    ap.add_argument("--type", help="filter by type (user/feedback/project/reference)")
    ap.add_argument("--dir", default=None, help="memory dir (default: <repo>/memory)")
    ap.add_argument("--list", action="store_true", help="one terse line per match")
    ap.add_argument("--limit", type=int, default=25, help="max results (default 25)")
    args = ap.parse_args()

    mem = args.dir or os.path.join(repo_root(), "memory")
    if not os.path.isdir(mem):
        print(f"memory_recall: no memory dir at {mem}", file=sys.stderr)
        return 1

    needles = [w.lower() for w in args.words]
    hits = []
    for f in sorted(os.listdir(mem)):
        if not f.endswith(".md") or f in SKIP:
            continue
        text = open(os.path.join(mem, f), encoding="utf-8").read()
        fm, body = frontmatter(text)
        t = fm_type(fm)
        if args.type and t != args.type:
            continue
        hay = (fm_value(fm, "name") + " " + fm_value(fm, "description") + " " + body).lower()
        if needles and not all(n in hay for n in needles):
            continue
        hits.append((f, fm_value(fm, "name") or f[:-3], t, fm_value(fm, "description")))

    if not hits:
        print("(no matching memory notes)")
        return 0

    for f, name, t, desc in hits[:args.limit]:
        if args.list:
            print(f"[{t or '?':9}] {f}")
        else:
            print(f"● {name}  [{t or '?'}]")
            if desc:
                print(f"   {desc}")
            print(f"   memory/{f}\n")
    if len(hits) > args.limit:
        print(f"… {len(hits) - args.limit} more (raise --limit)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
