#!/usr/bin/env python3
"""Compare two compiled Degrees of Lewdity HTML builds passage by passage.

Usage: verify_build.py A.html B.html [--allow NAME ...] [--max-script-diff N]

Exit code 0 when: no passage exists on one side only, every changed passage
is in --allow, and the non-passage part (scripts, styles, story data)
differs by at most N added/removed lines (default 0).
"""
import argparse
import difflib
import html as htmlmod
import re
import sys
from dataclasses import dataclass, field

PASSAGE_RE = re.compile(r'<tw-passagedata [^>]*name="([^"]*)"[^>]*>(.*?)</tw-passagedata>', re.S)


def passages(html):
    """Return {name: body} with HTML entities decoded and bodies stripped."""
    return {htmlmod.unescape(name): htmlmod.unescape(body).strip() for name, body in PASSAGE_RE.findall(html)}


def script_part(html):
    """Everything outside passages, with Windows path separators normalised."""
    return PASSAGE_RE.sub("", html).replace("\\\\", "/")


@dataclass
class Report:
    only_a: list = field(default_factory=list)
    only_b: list = field(default_factory=list)
    changed: list = field(default_factory=list)
    script_equal: bool = True
    script_diff: list = field(default_factory=list)

    def script_diff_lines(self):
        return [l for l in self.script_diff if l[:1] in "+-" and not l.startswith(("+++", "---"))]


def compare(a, b):
    pa, pb = passages(a), passages(b)
    report = Report(
        only_a=sorted(set(pa) - set(pb)),
        only_b=sorted(set(pb) - set(pa)),
        changed=[n for n in pa if n in pb and pa[n] != pb[n]],
    )
    sa, sb = script_part(a), script_part(b)
    report.script_equal = sa == sb
    if not report.script_equal:
        report.script_diff = list(difflib.unified_diff(sa.splitlines(), sb.splitlines(), "A", "B", lineterm="", n=0))
    return report


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("a")
    parser.add_argument("b")
    parser.add_argument("--allow", nargs="*", default=[], help="passages that may differ")
    parser.add_argument("--max-script-diff", type=int, default=0, help="allowed +/- lines outside passages")
    parser.add_argument("--show", type=int, default=40, help="script diff lines to print")
    args = parser.parse_args(argv)

    with open(args.a, encoding="utf-8", newline="") as f:
        a = f.read()
    with open(args.b, encoding="utf-8", newline="") as f:
        b = f.read()
    r = compare(a, b)

    allow = set(args.allow)
    unexpected = [n for n in r.changed if n not in allow]
    diff_lines = r.script_diff_lines()
    ok = not r.only_a and not r.only_b and not unexpected and len(diff_lines) <= args.max_script_diff

    print("passages: A=%d B=%d only_a=%d only_b=%d changed=%d (unexpected %d); script diff lines=%d (max %d) -> %s"
          % (len(passages(a)), len(passages(b)), len(r.only_a), len(r.only_b), len(r.changed), len(unexpected),
             len(diff_lines), args.max_script_diff, "OK" if ok else "FAIL"))
    for n in r.only_a:
        print("  only in A: %s" % n)
    for n in r.only_b:
        print("  only in B: %s" % n)
    for n in r.changed:
        print("  changed%s: %s" % ("" if n in allow else " (unexpected)", n))
    for l in r.script_diff[: args.show]:
        print("  " + l[:200])
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
