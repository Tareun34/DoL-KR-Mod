import json
import os
import shutil
import tempfile
import unittest

from tools import translation_status as ts


def make_tree(case, files):
    root = tempfile.mkdtemp()
    case.addCleanup(lambda: shutil.rmtree(root, ignore_errors=True))
    for rel, body in files.items():
        path = os.path.join(root, rel)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w", encoding="utf-8") as f:
            f.write(body)
    return root


def rec(kind, new_en=(), old_kr=(), old_en=()):
    return {"kind": kind, "new_en": list(new_en), "old_kr": list(old_kr), "old_en": list(old_en), "context": ""}


class IsDoneTests(unittest.TestCase):
    def test_pending_while_new_en_still_present(self):
        self.assertFalse(ts.is_done(rec("conflict", ["  Hello", "World"]), ["x", "Hello", "World  ", "y"]))

    def test_done_when_new_en_translated_away(self):
        self.assertTrue(ts.is_done(rec("conflict", ["Hello", "World"]), ["x", "안녕", "World", "y"]))

    def test_conflict_with_empty_new_en_is_done(self):
        self.assertTrue(ts.is_done(rec("conflict", [], ["나"], ["b"]), ["a"]))

    def test_new_file_and_deleted_never_done(self):
        self.assertFalse(ts.is_done(rec("new-file"), ["Hello"]))
        self.assertFalse(ts.is_done(rec("deleted-translated", [], ["x"], ["y"]), None))

    def test_missing_file_counts_as_done(self):
        self.assertTrue(ts.is_done(rec("merged-new-text", ["Hi"]), None))


class SummarizeRenderTests(unittest.TestCase):
    def test_summary_groups_by_two_level_dir_and_counts_done(self):
        root = make_tree(self, {
            "game/base-combat/a.twee": "Hello\n번역됨\n",
            "translation/pending/game/base-combat/a.twee.json": json.dumps([rec("conflict", ["Hello"]), rec("merged-new-text", ["Bye"])]),
            "translation/pending/game/overworld-town/n.twee.json": json.dumps([rec("new-file")]),
        })
        s = ts.summarize(root)
        self.assertEqual(s["game/base-combat"], {"conflict": 1, "conflict_done": 0, "merged-new-text": 1, "merged-new-text_done": 1,
                                                 "new-file": 0, "deleted-translated": 0})
        self.assertEqual(s["game/overworld-town"]["new-file"], 1)
        md = ts.render(s, "0.5.13.8", "2026-11-10 12:00")
        self.assertIn("대상: 영문 0.5.13.8", md)
        self.assertIn("| game/base-combat | 0/1 | 1/1 | 0 | 0 |", md)

    def test_render_has_totals_line(self):
        s = {"game/x": {"conflict": 2, "conflict_done": 1, "merged-new-text": 3, "merged-new-text_done": 0, "new-file": 1, "deleted-translated": 0},
             "game/y": {"conflict": 1, "conflict_done": 1, "merged-new-text": 0, "merged-new-text_done": 0, "new-file": 0, "deleted-translated": 1}}
        md = ts.render(s, "0.5.13.8", "now")
        self.assertIn("| 합계 | 2/3 | 0/3 | 1 | 1 |", md)


if __name__ == "__main__":
    unittest.main()
