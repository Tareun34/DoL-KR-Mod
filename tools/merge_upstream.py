#!/usr/bin/env python3
"""Merge an English upstream release into the Korean source tree, file by file.

    merge_upstream.py --base BASE --new NEW --ours OURS [--report-json PATH]

BASE is the English release the Korean tree was translated from, NEW the
English release to adopt, OURS this repository. Text files are merged
three-way with `git merge-file`; conflicts take the NEW side and every place
where translation was displaced or new English text arrived is recorded in
OURS/translation/pending/<path>.json for the translation stage.
"""
import argparse
import difflib
import json
import os
import re
import subprocess
import sys
import tempfile
from dataclasses import asdict, dataclass, field

MARKER = 31
_OURS_MARK = "<" * MARKER + " OURS"
_BASE_MARK = "|" * MARKER + " BASE"
_SEP_MARK = "=" * MARKER
_NEW_MARK = ">" * MARKER + " NEW"


class MergeError(Exception):
    pass


@dataclass
class Pending:
    kind: str
    old_en: list = field(default_factory=list)
    old_kr: list = field(default_factory=list)
    new_en: list = field(default_factory=list)
    context: str = ""

    def to_dict(self):
        return asdict(self)


def _strip_nl(line):
    return line.rstrip("\r\n")


def _git_merge_file(ours, base, new):
    with tempfile.TemporaryDirectory() as d:
        paths = []
        for name, text in (("ours", ours), ("base", base), ("new", new)):
            p = os.path.join(d, name)
            with open(p, "w", encoding="utf-8", newline="") as f:
                f.write(text)
            paths.append(p)
        res = subprocess.run(
            ["git", "merge-file", "-p", "--diff3", "--marker-size=%d" % MARKER,
             "-L", "OURS", "-L", "BASE", "-L", "NEW", *paths],
            capture_output=True,
        )
    if res.returncode < 0 or res.returncode > 127:
        raise MergeError("git merge-file failed: %s" % res.stderr.decode("utf-8", "replace").strip())
    return res.stdout.decode("utf-8")


def _resolve_conflicts(merged):
    """Replace each diff3 conflict block with its NEW side.

    Returns (result_lines (keepends), records, conflict_ranges) where
    conflict_ranges are (start, end) indices into result_lines.
    """
    lines = merged.splitlines(keepends=True)
    result, records, ranges = [], [], []
    i = 0
    while i < len(lines):
        if _strip_nl(lines[i]) == _OURS_MARK:
            sections = {"ours": [], "base": [], "new": []}
            cur = "ours"
            i += 1
            while i < len(lines):
                s = _strip_nl(lines[i])
                if s == _BASE_MARK:
                    cur = "base"
                elif s == _SEP_MARK:
                    cur = "new"
                elif s == _NEW_MARK:
                    break
                else:
                    sections[cur].append(lines[i])
                i += 1
            else:
                raise MergeError("unterminated conflict block")
            i += 1  # skip the NEW marker
            context = _strip_nl(result[-1]) if result else ""
            start = len(result)
            result.extend(sections["new"])
            ranges.append((start, len(result)))
            records.append(Pending("conflict",
                                   old_en=[_strip_nl(l) for l in sections["base"]],
                                   old_kr=[_strip_nl(l) for l in sections["ours"]],
                                   new_en=[_strip_nl(l) for l in sections["new"]],
                                   context=context))
        else:
            result.append(lines[i])
            i += 1
    return result, records, ranges


def _find_subsequence(haystack, needle, ranges, start=0):
    """Index of `needle` in `haystack` at or after `start`, outside `ranges`; -1 if none."""
    n = len(needle)
    for k in range(start, len(haystack) - n + 1):
        if haystack[k:k + n] == needle and not any(a < k + n and k < b for a, b in ranges):
            return k
    return -1


def _new_text_records(base, new, result_lines, ranges):
    base_lines, new_lines = base.splitlines(), new.splitlines()
    result_stripped = [_strip_nl(l) for l in result_lines]
    records = []
    cursor = 0
    sm = difflib.SequenceMatcher(None, base_lines, new_lines, autojunk=False)
    for tag, i1, i2, j1, j2 in sm.get_opcodes():
        if tag not in ("insert", "replace"):
            continue
        seg = new_lines[j1:j2]
        pos = _find_subsequence(result_stripped, seg, ranges, cursor)
        if pos < 0:
            continue
        cursor = pos + len(seg)
        context = result_stripped[pos - 1] if pos > 0 else ""
        records.append(Pending("merged-new-text", old_en=base_lines[i1:i2], old_kr=[], new_en=seg, context=context))
    return records


def merge_text(ours, base, new):
    """Three-way merge; conflicts take NEW. Returns (merged_text, [Pending])."""
    if ours == base:
        merged = new
    elif base == new:
        merged = ours
    else:
        merged = _git_merge_file(ours, base, new)
    result_lines, conflicts, ranges = _resolve_conflicts(merged)
    if ours == base or base == new:
        return "".join(result_lines), []
    new_text = _new_text_records(base, new, result_lines, ranges)
    # keep records in file order: conflicts and new-text interleaved by position is not
    # needed by consumers; conflicts first, then new text, each in file order.
    return "".join(result_lines), conflicts + new_text


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--base", required=True)
    parser.add_argument("--new", required=True)
    parser.add_argument("--ours", required=True)
    parser.add_argument("--report-json")
    args = parser.parse_args(argv)
    raise SystemExit("tree merge not implemented yet")


if __name__ == "__main__":
    sys.exit(main())
