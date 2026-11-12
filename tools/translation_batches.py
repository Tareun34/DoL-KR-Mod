#!/usr/bin/env python3
"""Group the remaining translation work into agent-sized batches.

    translation_batches.py --root . [--max-lines 450] [--pass N]

Pass 1: files with conflict records (old Korean displaced) that still contain
the English; pass 2: files with only cleanly merged new English; pass 3: new
files. A file's work is all its English, so a file appears in one pass only.
"""
import argparse
import os
import sys

try:
    from tools.translation_status import has_prose, is_done, iter_pending
    from tools.check_translation import prose_lines
except ImportError:
    from translation_status import has_prose, is_done, iter_pending
    from check_translation import prose_lines

DIR_ORDER = ("base-system", "base-combat", "overworld-town", "overworld-plains", "overworld-forest",
             "overworld-underground", "04-Variables", "special-dance", "special-fishing", "special-masturbation",
             "base-clothing", "03-JavaScript")
PASS3_ORDER = ("loc-bus/thug.twee", "loc-mines/", "speech/reaction-", "speech/named-npcs-speech", ".js", "sky-testing")
STATUS_WAIT = "대기"


def _read_lines(path):
    if not os.path.isfile(path):
        return None
    with open(path, encoding="utf-8", errors="replace") as f:
        return f.read().splitlines()


def file_work(root):
    """{rel: {"pass": 1|2|3, "lines": prose line count, "records": n}}"""
    work = {}
    for rel, records in iter_pending(root):
        src = os.path.join(root, rel)
        if rel.endswith(".css") or not os.path.isfile(src):
            continue
        lines = _read_lines(src)
        p = None
        count = 0
        n = 0
        for r in records:
            kind = r.get("kind")
            if kind == "new-file":
                p, count, n = 3, prose_lines("\n".join(lines)), n + 1
                break
            if kind not in ("conflict", "merged-new-text") or not has_prose(r.get("new_en", [])) or is_done(r, lines):
                continue
            n += 1
            count += len(r["new_en"])
            if kind == "conflict" and r.get("old_kr"):
                p = 1
            elif p is None:
                p = 2
        if p is not None:
            work[rel] = {"pass": p, "lines": count, "records": n}
    return work


def _dir_rank(rel):
    parts = rel.split("/")
    d = parts[1] if len(parts) > 2 else parts[0]
    return (DIR_ORDER.index(d) if d in DIR_ORDER else len(DIR_ORDER), d)


def _pass3_rank(rel):
    for i, key in enumerate(PASS3_ORDER):
        if key in rel:
            return i
    return len(PASS3_ORDER)


def make_batches(work, max_lines=450):
    batches = []
    for p in (1, 2, 3):
        files = [rel for rel, w in work.items() if w["pass"] == p]
        if p == 3:
            files.sort(key=lambda r: (_pass3_rank(r), r))
        else:
            files.sort(key=lambda r: (_dir_rank(r), -work[r]["lines"], r))
        cur, cur_lines = [], 0
        def flush():
            if cur:
                batches.append({"id": "P%d-%02d" % (p, sum(1 for b in batches if b["pass"] == p) + 1), "pass": p, "files": list(cur), "lines": cur_lines})
        for rel in files:
            n = work[rel]["lines"]
            if cur and cur_lines + n > max_lines:
                flush()
                cur, cur_lines = [], 0
            cur.append(rel)
            cur_lines += n
            if n >= max_lines:
                flush()
                cur, cur_lines = [], 0
        flush()
    return batches


def render_log(batches):
    out = ["| 묶음 | 단계 | 파일 | 산문 줄 | 상태 | 메모 |", "|---|---|---|---|---|---|"]
    for b in batches:
        out.append("| %s | %d | %s | %d | %s |  |" % (b["id"], b["pass"], "<br>".join(b["files"]), b["lines"], STATUS_WAIT))
    return "\n".join(out) + "\n"


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--root", default=".")
    parser.add_argument("--max-lines", type=int, default=450)
    parser.add_argument("--pass", dest="only_pass", type=int)
    args = parser.parse_args(argv)
    batches = make_batches(file_work(args.root), args.max_lines)
    if args.only_pass:
        batches = [b for b in batches if b["pass"] == args.only_pass]
    sys.stdout.write(render_log(batches))
    return 0


if __name__ == "__main__":
    sys.exit(main())
