#!/usr/bin/env python3
"""Track Korean-only definitions so an upstream merge cannot silently drop them.

    check_kr_symbols.py snapshot --ours OURS --base BASE --out translation/kr-symbols.json
    check_kr_symbols.py check --root ROOT --snapshot translation/kr-symbols.json

`snapshot` records every definition (widget, setup.*, window.*, window.KR.*,
top-level function) that exists under OURS/game but not under BASE/game.
`check` reports each recorded name that ROOT still references but no longer
defines, one `kind name path` line each, and exits 1 if any.
"""
import argparse
import json
import os
import re
import sys

WIDGET_DEF = re.compile(r'<<widget\s+"([^"]+)"')
WIDGET_REF = re.compile(r"<<([A-Za-z_]\w*)(?=[\s>])")
JS_DEF = re.compile(r"^\s*(?:setup|window)\.(KR\.)?([A-Za-z_]\w*)\s*=(?!=)", re.M)
FUNC_DEF = re.compile(r"^function\s+([A-Za-z_]\w*)\s*\(", re.M)


def _walk(root, exts):
    game = os.path.join(root, "game")
    for d, _, files in os.walk(game):
        for f in sorted(files):
            if f.endswith(exts):
                path = os.path.join(d, f)
                yield os.path.relpath(path, root).replace(os.sep, "/"), path


def _read(path):
    with open(path, encoding="utf-8", errors="replace") as f:
        return f.read()


def collect_defs(root):
    """Return {"widget": set(names), "js": set(names)} defined under root/game."""
    defs = {"widget": set(), "js": set()}
    for _, path in _walk(root, (".twee",)):
        defs["widget"].update(WIDGET_DEF.findall(_read(path)))
    for _, path in _walk(root, (".js",)):
        text = _read(path)
        defs["js"].update((kr or "") + name for kr, name in JS_DEF.findall(text))
        defs["js"].update(FUNC_DEF.findall(text))
    return defs


def kr_only_defs(ours, base):
    o, b = collect_defs(ours), collect_defs(base)
    return {kind: sorted(o[kind] - b[kind]) for kind in ("widget", "js")}


def _js_ref_pattern(name):
    if name.startswith("KR."):
        return re.compile(r"\bKR\." + re.escape(name[3:]) + r"\b")
    esc = re.escape(name)
    return re.compile(r"(?:\b(?:setup|window)\." + esc + r"\b|\b" + esc + r"\s*\()")


def find_undefined(root, names):
    """Return [(kind, name, relpath)] for recorded names referenced but not defined under root."""
    defs = collect_defs(root)
    missing = []
    widget_names = [n for n in names.get("widget", []) if n not in defs["widget"]]
    js_names = [n for n in names.get("js", []) if n not in defs["js"]]
    if widget_names:
        wanted = set(widget_names)
        for rel, path in _walk(root, (".twee",)):
            used = wanted & set(WIDGET_REF.findall(_read(path)))
            missing.extend(("widget", n, rel) for n in sorted(used))
    if js_names:
        patterns = [(n, _js_ref_pattern(n)) for n in js_names]
        for rel, path in _walk(root, (".twee", ".js")):
            text = _read(path)
            missing.extend(("js", n, rel) for n, pat in patterns if pat.search(text))
    return missing


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    sub = parser.add_subparsers(dest="cmd", required=True)
    snap = sub.add_parser("snapshot", help="record definitions present in OURS but not BASE")
    snap.add_argument("--ours", required=True)
    snap.add_argument("--base", required=True)
    snap.add_argument("--out", required=True)
    chk = sub.add_parser("check", help="report recorded names that ROOT references but no longer defines")
    chk.add_argument("--root", required=True)
    chk.add_argument("--snapshot", required=True)
    args = parser.parse_args(argv)

    if args.cmd == "snapshot":
        names = kr_only_defs(args.ours, args.base)
        os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)
        with open(args.out, "w", encoding="utf-8") as f:
            json.dump(names, f, ensure_ascii=False, indent=1)
            f.write("\n")
        print("snapshot: %d widgets, %d js names -> %s" % (len(names["widget"]), len(names["js"]), args.out))
        return 0

    with open(args.snapshot, encoding="utf-8") as f:
        names = json.load(f)
    missing = find_undefined(args.root, names)
    for kind, name, rel in missing:
        print("%s %s %s" % (kind, name, rel))
    if missing:
        print("%d undefined references" % len(missing), file=sys.stderr)
        return 1
    print("kr symbols ok (%d names)" % (len(names["widget"]) + len(names["js"])))
    return 0


if __name__ == "__main__":
    sys.exit(main())
