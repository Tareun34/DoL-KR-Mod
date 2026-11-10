import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest

from tools import merge_upstream as mu

SCRIPT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "merge_upstream.py")


class MergeTextTests(unittest.TestCase):
    def test_clean_merge_keeps_translation_and_takes_new_code(self):
        base = "a\nb\nc\nd\n"; ours = "가\nb\nc\nd\n"; new = "a\nb\nc\nD\n"
        out, recs = mu.merge_text(ours, base, new)
        self.assertEqual(out, "가\nb\nc\nD\n")
        self.assertEqual([(r.kind, r.old_en, r.new_en, r.context) for r in recs], [("merged-new-text", ["d"], ["D"], "c")])

    def test_conflict_takes_new_side_and_records_old_kr(self):
        base = "a\nb\nc\n"; ours = "a\n나\nc\n"; new = "a\nB2\nc\n"
        out, recs = mu.merge_text(ours, base, new)
        self.assertEqual(out, "a\nB2\nc\n")
        self.assertEqual(len(recs), 1)
        r = recs[0]
        self.assertEqual((r.kind, r.old_en, r.old_kr, r.new_en, r.context), ("conflict", ["b"], ["나"], ["B2"], "a"))

    def test_conflict_with_empty_new_side(self):
        base = "a\nb\nc\n"; ours = "a\n나\nc\n"; new = "a\nc\n"
        out, recs = mu.merge_text(ours, base, new)
        self.assertEqual(out, "a\nc\n")
        self.assertEqual([(r.kind, r.old_kr, r.new_en) for r in recs], [("conflict", ["나"], [])])

    def test_pure_insert_by_new_is_recorded_once(self):
        base = "a\nb\nc\nd\n"; ours = "가\nb\nc\n다\n"; new = "a\nb\nx\ny\nc\nd\n"
        out, recs = mu.merge_text(ours, base, new)
        self.assertEqual(out, "가\nb\nx\ny\nc\n다\n")
        self.assertEqual([(r.kind, r.new_en) for r in recs], [("merged-new-text", ["x", "y"])])

    def test_marker_like_content_line(self):
        base = "a\n=======\nb\n"; ours = "가\n=======\nb\n"; new = "A\n=======\nb\n"
        out, recs = mu.merge_text(ours, base, new)
        self.assertEqual(out, "A\n=======\nb\n")
        self.assertEqual([(r.kind, r.old_kr, r.new_en) for r in recs], [("conflict", ["가"], ["A"])])

    def test_no_trailing_newline_preserved(self):
        base = "a\nb\nc"; ours = "가\nb\nc"; new = "a\nb\nc2"
        out, _ = mu.merge_text(ours, base, new)
        self.assertEqual(out, "가\nb\nc2")

    def test_identical_inputs_produce_no_records(self):
        out, recs = mu.merge_text("x\n", "x\n", "x\n")
        self.assertEqual((out, recs), ("x\n", []))


if __name__ == "__main__":
    unittest.main()
