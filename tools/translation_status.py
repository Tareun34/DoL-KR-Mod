#!/usr/bin/env python3
"""Summarise the translation work list left by merge_upstream.py.

    translation_status.py --root . --tag 0.5.13.8 [--out translation/STATUS.md]

Reads translation/pending/**/*.json, checks each record against the current
file, and renders a per-directory table. A record is done when its new_en
text no longer appears verbatim in the file (see is_done).
"""
import argparse
import json
import os
import sys
from datetime import datetime

PENDING_DIR = "translation/pending"
KINDS = ("conflict", "merged-new-text", "new-file", "deleted-translated")


def is_done(record, file_lines):
    kind = record.get("kind")
    if kind in ("new-file", "deleted-translated"):
        return False
    needle = [l.strip() for l in record.get("new_en", [])]
    if not needle:
        return True
    if file_lines is None:
        return True
    hay = [l.strip() for l in file_lines]
    n = len(needle)
    return not any(hay[i:i + n] == needle for i in range(len(hay) - n + 1))


def _empty():
    return {"conflict": 0, "conflict_done": 0, "merged-new-text": 0, "merged-new-text_done": 0, "new-file": 0, "deleted-translated": 0}


def _group(rel):
    parts = rel.split("/")
    return "/".join(parts[:2]) if len(parts) > 2 else parts[0]


def iter_pending(root):
    """Yield (source_rel, records) for every pending JSON under root."""
    base = os.path.join(root, PENDING_DIR)
    for d, _, files in os.walk(base):
        for f in sorted(files):
            if not f.endswith(".json"):
                continue
            path = os.path.join(d, f)
            rel = os.path.relpath(path, base).replace(os.sep, "/")[:-len(".json")]
            with open(path, encoding="utf-8") as fh:
                yield rel, json.load(fh)


def summarize(root):
    summary = {}
    for rel, records in iter_pending(root):
        src = os.path.join(root, rel)
        lines = None
        if os.path.isfile(src):
            with open(src, encoding="utf-8", errors="replace") as f:
                lines = f.read().splitlines()
        row = summary.setdefault(_group(rel), _empty())
        for r in records:
            kind = r.get("kind")
            if kind not in KINDS:
                continue
            row[kind] += 1
            if kind in ("conflict", "merged-new-text") and is_done(r, lines):
                row[kind + "_done"] += 1
    return summary


def render(summary, tag, now):
    total = _empty()
    for row in summary.values():
        for k in total:
            total[k] += row[k]
    out = ["# 번역 상태", "", "생성: %s · 대상: 영문 %s" % (now, tag), "",
           "`translation/pending/`의 기록을 현재 파일과 대조한 결과. 충돌·새 영문은 해당 영문이 파일에서 사라지면 완료로 센다. 새 파일과 삭제된 번역은 2단계가 판정한다.", "",
           "| 디렉터리 | 충돌(완료/전체) | 새 영문(완료/전체) | 새 파일 | 삭제된 번역 |", "|---|---|---|---|---|"]

    def line(name, row):
        return "| %s | %d/%d | %d/%d | %d | %d |" % (name, row["conflict_done"], row["conflict"], row["merged-new-text_done"],
                                                    row["merged-new-text"], row["new-file"], row["deleted-translated"])

    out.append(line("합계", total))
    for name in sorted(summary):
        out.append(line(name, summary[name]))
    return "\n".join(out) + "\n"


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--root", default=".")
    parser.add_argument("--tag", required=True)
    parser.add_argument("--out")
    args = parser.parse_args(argv)
    text = render(summarize(args.root), args.tag, datetime.now().strftime("%Y-%m-%d %H:%M"))
    if args.out:
        with open(args.out, "w", encoding="utf-8") as f:
            f.write(text)
        print("wrote %s" % args.out)
    else:
        sys.stdout.write(text)
    return 0


if __name__ == "__main__":
    sys.exit(main())
