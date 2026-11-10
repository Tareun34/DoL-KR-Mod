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


def _in_ranges(pos, ranges):
    return any(a <= pos < b for a, b in ranges)


def _new_text_records(ours, base, result_lines, ranges):
    """Records for text that the merge brought in from NEW outside conflict blocks.

    A result line that differs from OURS came from NEW (the merge only ever adds
    NEW's changes to OURS), so the insert/replace opcodes of OURS→result, minus
    the conflict blocks, are exactly the cleanly merged new text. old_en is the
    BASE text at the same place (BASE→result alignment).
    """
    ours_lines, base_lines = ours.splitlines(), base.splitlines()
    res = [_strip_nl(l) for l in result_lines]

    base_ops = difflib.SequenceMatcher(None, base_lines, res, autojunk=False).get_opcodes()

    def old_en_for(pos):
        for tag, i1, i2, j1, j2 in base_ops:
            if j1 <= pos < j2:
                return base_lines[i1:i2] if tag == "replace" else []
        return []

    records = []
    covered = set()
    for tag, i1, i2, j1, j2 in difflib.SequenceMatcher(None, ours_lines, res, autojunk=False).get_opcodes():
        if tag not in ("insert", "replace"):
            continue
        run = []

        def flush():
            if run:
                records.append(Pending("merged-new-text", old_en=old_en_for(run[0]), old_kr=[],
                                       new_en=[res[p] for p in run], context=res[run[0] - 1] if run[0] > 0 else ""))
                covered.update(run)

        for pos in range(j1, j2):
            if _in_ranges(pos, ranges):
                flush()
                run = []
                continue
            run.append(pos)
        flush()
    for a, b in ranges:
        covered.update(range(a, b))
    return records, covered


def _uncovered(ours, base, new, res, covered):
    """Diagnostic, expected 0: texts that NEW added/changed and the merge introduced into the result
    (more copies than OURS had) but that sit at no covered position."""
    from collections import Counter
    base_lines, new_lines = base.splitlines(), new.splitlines()
    introduced = Counter(res) - Counter(ours.splitlines())
    covered_texts = {res[p] for p in covered}
    changed_texts = set()
    for tag, i1, i2, j1, j2 in difflib.SequenceMatcher(None, base_lines, new_lines, autojunk=False).get_opcodes():
        if tag in ("insert", "replace"):
            changed_texts.update(new_lines[j1:j2])
    return sum(1 for t in changed_texts if introduced[t] > 0 and t not in covered_texts)


def merge_text_ex(ours, base, new):
    """Three-way merge; conflicts take NEW. Returns (merged_text, [Pending], uncovered_new_lines)."""
    if ours == base:
        merged = new
    elif base == new:
        merged = ours
    else:
        merged = _git_merge_file(ours, base, new)
    result_lines, conflicts, ranges = _resolve_conflicts(merged)
    if ours == base or base == new:
        return "".join(result_lines), [], 0
    new_text, covered = _new_text_records(ours, base, result_lines, ranges)
    uncovered = _uncovered(ours, base, new, [_strip_nl(l) for l in result_lines], covered)
    return "".join(result_lines), conflicts + new_text, uncovered


def uncovered_new_lines(ours, base, new):
    return merge_text_ex(ours, base, new)[2]


def merge_text(ours, base, new):
    """Three-way merge; conflicts take NEW. Returns (merged_text, [Pending])."""
    text, records, _ = merge_text_ex(ours, base, new)
    return text, records


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
    """Apply the file rules to one path; update OURS; return (rule, [Pending], uncovered_new_lines)."""
    b, n, o = (_read_bytes(os.path.join(root, rel)) for root in (base, new, ours))
    ours_path = os.path.join(ours, rel)
    rule = classify(b is not None, n is not None, o == b, b == n)
    records, uncovered = [], 0
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
            merged, recs, uncovered = merge_text_ex(o.decode("utf-8"), b.decode("utf-8"), n.decode("utf-8"))
            _write_bytes(ours_path, merged.encode("utf-8"))
            if record:
                records.extend(recs)
    return rule, records, uncovered


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


def _is_done(record, file_lines):
    try:
        from tools.translation_status import is_done
    except ImportError:  # run as a script from tools/
        from translation_status import is_done
    return is_done(record, file_lines)


def write_pending(ours, rel, records):
    """Write records for rel, keeping earlier records that are still pending against the merged file."""
    path = os.path.join(ours, PENDING_DIR, rel + ".json")
    new_dicts = [r.to_dict() for r in records]
    kept = []
    if os.path.isfile(path):
        with open(path, encoding="utf-8") as f:
            existing = json.load(f)
        src = os.path.join(ours, rel)
        file_lines = None
        if os.path.isfile(src):
            with open(src, encoding="utf-8", errors="replace") as f:
                file_lines = f.read().splitlines()
        seen = {(d["kind"], tuple(d["new_en"])) for d in new_dicts}
        kept = [d for d in existing if not _is_done(d, file_lines) and (d["kind"], tuple(d["new_en"])) not in seen]
    out = kept + new_dicts
    if not out:
        if os.path.isfile(path):
            _remove(path)
        return
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=1)
        f.write("\n")


def merge_tree(base, new, ours, skip_img=False):
    report = {"files": {k: 0 for k in ("new-file", "delete", "take-new", "keep-ours", "merge")},
              "single_files": {}, "conflict_files": 0, "conflict_hunks": 0, "merged_new_text": 0,
              "deleted_translated": 0, "unrecorded_new_lines": 0, "img": {}}
    rels = set()
    for top in TEXT_DIRS:
        rels |= _walk_files(base, top) | _walk_files(new, top)
    rels = {r for r in rels if not r.startswith(SKIP_PREFIXES)}
    for rel in sorted(rels):
        rule, records, uncovered = merge_file(rel, base, new, ours)
        report["files"][rule] += 1
        report["unrecorded_new_lines"] += uncovered
        conflicts = [r for r in records if r.kind == "conflict"]
        if conflicts:
            report["conflict_files"] += 1
            report["conflict_hunks"] += len(conflicts)
        report["merged_new_text"] += sum(1 for r in records if r.kind == "merged-new-text")
        report["deleted_translated"] += sum(1 for r in records if r.kind == "deleted-translated")
        write_pending(ours, rel, records)
    for rel in SINGLE_FILES:
        if os.path.isfile(os.path.join(base, rel)) or os.path.isfile(os.path.join(new, rel)):
            rule, _, _ = merge_file(rel, base, new, ours, record=False)
            report["single_files"][rule] = report["single_files"].get(rule, 0) + 1
    report["img"] = {} if skip_img else sync_images(new, ours)
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
    lines.append("unrecorded_new_lines %2d" % report["unrecorded_new_lines"])
    lines.append("img: added %d removed %d updated %d" % (report["img"].get("added", 0), report["img"].get("removed", 0), report["img"].get("updated", 0)))
    return "\n".join(lines)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--base", required=True)
    parser.add_argument("--new", required=True)
    parser.add_argument("--ours", required=True)
    parser.add_argument("--report-json")
    parser.add_argument("--skip-img", action="store_true", help="do not sync img/ (records-only runs)")
    args = parser.parse_args(argv)
    for name in ("base", "new", "ours"):
        if not os.path.isdir(getattr(args, name)):
            print("not a directory: %s" % getattr(args, name), file=sys.stderr)
            return 2
    report = merge_tree(args.base, args.new, args.ours, skip_img=args.skip_img)
    print(format_report(report))
    if args.report_json:
        with open(args.report_json, "w", encoding="utf-8") as f:
            json.dump(report, f, indent=1)
            f.write("\n")
    if report["unrecorded_new_lines"]:
        print("%d new lines could not be located for recording; translation/pending is incomplete" % report["unrecorded_new_lines"], file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
