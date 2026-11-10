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


TEXT_DIRS = ("game", "modules", "types")
SKIP_PREFIXES = ("game/kr_js/",)
SINGLE_FILES = ("version", "DoL Changelog.txt", "package.json", "package-lock.json", ".eslintrc.cjs",
                "deprecated.twee-config.yml", "t3lt.twee-config.yml", "devTools/apkbuilder/config.xml",
                "DolSettingsExport.json", "DolSettingsExport.js")
PENDING_DIR = "translation/pending"


def classify(in_base, in_new, ours_eq_base, base_eq_new):
    """Design 3.3 rules 1-5, in order."""
    if not in_base and in_new:
        return "new-file"
    if in_base and not in_new:
        return "delete"
    if ours_eq_base:
        return "take-new"
    if base_eq_new:
        return "keep-ours"
    return "merge"


def is_text(data):
    try:
        data.decode("utf-8")
    except UnicodeDecodeError:
        return False
    return True


def _read_bytes(path):
    if path is None or not os.path.isfile(path):
        return None
    with open(path, "rb") as f:
        return f.read()


def _write_bytes(path, data):
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    with open(path, "wb") as f:
        f.write(data)


def _remove(path):
    os.remove(path)
    d = os.path.dirname(path)
    while d and not os.listdir(d):
        os.rmdir(d)
        d = os.path.dirname(d)


def _lines(data):
    return data.decode("utf-8").splitlines()


def merge_file(rel, base, new, ours, record=True):
    """Apply the file rules to one path; update OURS; return (rule, [Pending])."""
    b, n, o = (_read_bytes(os.path.join(root, rel)) for root in (base, new, ours))
    ours_path = os.path.join(ours, rel)
    rule = classify(b is not None, n is not None, o == b, b == n)
    records = []
    if rule == "new-file":
        _write_bytes(ours_path, n)
        if record:
            records.append(Pending("new-file"))
    elif rule == "delete":
        if o is not None:
            if record and o != b and is_text(o) and is_text(b):
                records.append(Pending("deleted-translated", old_en=_lines(b), old_kr=_lines(o)))
            _remove(ours_path)
    elif rule == "take-new":
        if o != n:
            _write_bytes(ours_path, n)
    elif rule == "keep-ours":
        pass
    else:  # merge
        if not (is_text(o) and is_text(b) and is_text(n)):
            _write_bytes(ours_path, n)
            rule = "take-new"
        else:
            merged, recs = merge_text(o.decode("utf-8"), b.decode("utf-8"), n.decode("utf-8"))
            _write_bytes(ours_path, merged.encode("utf-8"))
            if record:
                records.extend(recs)
    return rule, records


def _walk_files(root, top):
    base = os.path.join(root, top)
    if not os.path.isdir(base):
        return set()
    out = set()
    for d, _, files in os.walk(base):
        for f in files:
            out.add(os.path.relpath(os.path.join(d, f), root).replace(os.sep, "/"))
    return out


def sync_images(new, ours):
    """Make OURS/img identical to NEW/img. Returns {"added", "removed", "updated"} counts."""
    counts = {"added": 0, "removed": 0, "updated": 0}
    new_files, our_files = _walk_files(new, "img"), _walk_files(ours, "img")
    for rel in sorted(new_files - our_files):
        _write_bytes(os.path.join(ours, rel), _read_bytes(os.path.join(new, rel)))
        counts["added"] += 1
    for rel in sorted(our_files - new_files):
        _remove(os.path.join(ours, rel))
        counts["removed"] += 1
    for rel in sorted(new_files & our_files):
        n = _read_bytes(os.path.join(new, rel))
        if n != _read_bytes(os.path.join(ours, rel)):
            _write_bytes(os.path.join(ours, rel), n)
            counts["updated"] += 1
    return counts


def write_pending(ours, rel, records):
    if not records:
        return
    path = os.path.join(ours, PENDING_DIR, rel + ".json")
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump([r.to_dict() for r in records], f, ensure_ascii=False, indent=1)
        f.write("\n")


def merge_tree(base, new, ours):
    report = {"files": {k: 0 for k in ("new-file", "delete", "take-new", "keep-ours", "merge")},
              "single_files": {}, "conflict_files": 0, "conflict_hunks": 0, "merged_new_text": 0,
              "deleted_translated": 0, "img": {}}
    rels = set()
    for top in TEXT_DIRS:
        rels |= _walk_files(base, top) | _walk_files(new, top)
    rels = {r for r in rels if not r.startswith(SKIP_PREFIXES)}
    for rel in sorted(rels):
        rule, records = merge_file(rel, base, new, ours)
        report["files"][rule] += 1
        conflicts = [r for r in records if r.kind == "conflict"]
        if conflicts:
            report["conflict_files"] += 1
            report["conflict_hunks"] += len(conflicts)
        report["merged_new_text"] += sum(1 for r in records if r.kind == "merged-new-text")
        report["deleted_translated"] += sum(1 for r in records if r.kind == "deleted-translated")
        write_pending(ours, rel, records)
    for rel in SINGLE_FILES:
        if os.path.isfile(os.path.join(base, rel)) or os.path.isfile(os.path.join(new, rel)):
            rule, _ = merge_file(rel, base, new, ours, record=False)
            report["single_files"][rule] = report["single_files"].get(rule, 0) + 1
    report["img"] = sync_images(new, ours)
    return report


def format_report(report):
    lines = ["files:"]
    for k, v in report["files"].items():
        lines.append("  %-10s %6d" % (k, v))
    lines.append("single files: %s" % (", ".join("%s %d" % kv for kv in sorted(report["single_files"].items())) or "none"))
    lines.append("conflict_files   %6d" % report["conflict_files"])
    lines.append("conflict_hunks   %6d" % report["conflict_hunks"])
    lines.append("merged_new_text  %6d" % report["merged_new_text"])
    lines.append("deleted_translated %4d" % report["deleted_translated"])
    lines.append("img: added %d removed %d updated %d" % (report["img"].get("added", 0), report["img"].get("removed", 0), report["img"].get("updated", 0)))
    return "\n".join(lines)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--base", required=True)
    parser.add_argument("--new", required=True)
    parser.add_argument("--ours", required=True)
    parser.add_argument("--report-json")
    args = parser.parse_args(argv)
    for name in ("base", "new", "ours"):
        if not os.path.isdir(getattr(args, name)):
            print("not a directory: %s" % getattr(args, name), file=sys.stderr)
            return 2
    report = merge_tree(args.base, args.new, args.ours)
    print(format_report(report))
    if args.report_json:
        with open(args.report_json, "w", encoding="utf-8") as f:
            json.dump(report, f, indent=1)
            f.write("\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
