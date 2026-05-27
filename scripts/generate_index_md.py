#!/usr/bin/env python3
"""Render a human-browsable index INTO INDEX.md from INDEX.yaml (single source of
truth), between:
    <!-- BEGIN GENERATED INDEX -->
    <!-- END GENERATED INDEX -->
grouped by authority tier. Zero dependencies. The pre-commit hook runs this and
re-stages INDEX.md, so the human view never drifts and you only edit INDEX.yaml.
Usage:  python3 scripts/generate_index_md.py   (from the repo root)
"""
import os, re, subprocess, sys

try:
    ROOT = subprocess.run(["git","rev-parse","--show-toplevel"],capture_output=True,text=True,check=True).stdout.strip()
except Exception:
    ROOT = os.getcwd()
INDEX = os.path.join(ROOT,"INDEX.yaml"); TARGET = os.path.join(ROOT,"INDEX.md")
BEGIN="<!-- BEGIN GENERATED INDEX -->"; END="<!-- END GENERATED INDEX -->"
TIER_ORDER=[("entry","Entry"),("authoritative","Authoritative"),("reference","Reference"),
            ("working","Working / in-flight"),("planning","Planning"),("meta","Meta / doc-strategy"),
            ("historical","Historical"),("log","Logs"),("archived","Archived"),("","Other")]


def parse(text):
    entries, cur, lk = [], None, None
    for raw in text.splitlines():
        if re.match(r"^\s*-\s+path:", raw):
            if cur: entries.append(cur)
            cur={"path":raw.split("path:",1)[1].strip()}; lk=None; continue
        if cur is None: continue
        ms=re.match(r"^\s{4}([a-z_]+):\s*(.*)$",raw)
        if ms:
            k,v=ms.group(1),ms.group(2).strip()
            if v.startswith("[") and v.endswith("]"): cur[k]=[x.strip() for x in v[1:-1].split(",") if x.strip()]; lk=None
            elif v=="": cur[k]=[]; lk=k
            else: cur[k]=v; lk=None
            continue
        mi=re.match(r"^\s{6}-\s+(.*)$",raw)
        if mi and lk: cur[lk].append(mi.group(1).strip())
    if cur: entries.append(cur)
    return entries


def render(entries):
    known=[t for t,_ in TIER_ORDER if t]
    lines=[BEGIN,"<!-- Generated from INDEX.yaml by scripts/generate_index_md.py — do not edit by hand. -->",
           "","# Document index","",
           "_Generated from `INDEX.yaml` (the single source of truth). Edit that file to add/change "
           "a doc; this regenerates on commit._",""]
    for tier,heading in TIER_ORDER:
        grp=[e for e in entries if e.get("authority_tier")==tier] if tier else [e for e in entries if e.get("authority_tier") not in known]
        if not grp: continue
        lines+=[f"## {heading}","","| Doc | Purpose | Type |","|---|---|---|"]
        for e in sorted(grp,key=lambda x:x["path"]):
            purpose=e.get("purpose","").replace("|","\\|")
            lines.append(f"| [`{e['path']}`]({e['path']}) | {purpose} | {e.get('doc_type','?')} |")
        lines.append("")
    lines.append(END)
    return "\n".join(lines)


def main():
    if not os.path.exists(INDEX): print("ERROR: INDEX.yaml missing"); return 1
    block=render(parse(open(INDEX,encoding="utf-8").read()))
    doc=open(TARGET,encoding="utf-8").read() if os.path.exists(TARGET) else ""
    if BEGIN in doc and END in doc:
        new=re.sub(re.escape(BEGIN)+r".*?"+re.escape(END),block,doc,flags=re.S)
    else:
        new=(doc.rstrip()+"\n\n"+block+"\n") if doc.strip() else block+"\n"
    if new!=doc:
        open(TARGET,"w",encoding="utf-8").write(new); print("INDEX.md regenerated.")
    else:
        print("INDEX.md already up to date.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
