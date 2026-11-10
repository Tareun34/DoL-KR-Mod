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


def make_tree(case, files):
    root = tempfile.mkdtemp()
    case.addCleanup(lambda: shutil.rmtree(root, ignore_errors=True))
    for rel, body in files.items():
        path = os.path.join(root, rel)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        mode = "wb" if isinstance(body, bytes) else "w"
        with open(path, mode, **({} if isinstance(body, bytes) else {"encoding": "utf-8", "newline": ""})) as f:
            f.write(body)
    return root


class ClassifyTests(unittest.TestCase):
    def test_rules_in_order(self):
        c = mu.classify
        self.assertEqual(c(False, True, False, False), "new-file")
        self.assertEqual(c(True, False, True, False), "delete")
        self.assertEqual(c(True, True, True, False), "take-new")
        self.assertEqual(c(True, True, False, True), "keep-ours")
        self.assertEqual(c(True, True, False, False), "merge")
        self.assertEqual(c(True, True, True, True), "take-new")


class TreeTests(unittest.TestCase):
    def setUp(self):
        self.base = make_tree(self, {"game/a.twee": "a\nb\nc\n", "game/b.twee": "x\n", "game/gone.twee": "g\n", "game/same.twee": "s\n",
                                     "game/kr_js/k.js": "k\n", "game/fonts/f.ttf": b"\xff\xfe\x00bin", "modules/css/m.css": "m\n",
                                     "img/old.png": b"o", "img/keep.png": b"k", "version": "0.5.12.13\n", "DolSettingsExport.json": "{}\n"})
        self.new = make_tree(self, {"game/a.twee": "a\nb\nC\n", "game/b.twee": "x\n", "game/same.twee": "s\n", "game/added.twee": "n\n",
                                    "game/kr_js/k.js": "K2\n", "game/fonts/f.ttf": b"\xff\xfe\x00bin2", "modules/css/m.css": "M\n",
                                    "img/new.png": b"n", "img/keep.png": b"k", "version": "0.5.13.8\n", "DolSettingsExport.js": "x\n"})
        self.ours = make_tree(self, {"game/a.twee": "가\nb\nc\n", "game/b.twee": "x\n", "game/gone.twee": "간\n", "game/same.twee": "ㅅ\n",
                                     "game/kr_js/k.js": "k-kr\n", "game/fonts/f.ttf": b"\xff\xfe\x00bin", "modules/css/m.css": "m\n",
                                     "img/old.png": b"o", "img/keep.png": b"k", "version": "0.5.12.13\n", "DolSettingsExport.json": "{}\n",
                                     "README.md": "ours\n"})

    def read(self, rel):
        with open(os.path.join(self.ours, rel), encoding="utf-8") as f:
            return f.read()

    def test_merge_tree_applies_rules(self):
        rep = mu.merge_tree(self.base, self.new, self.ours)
        self.assertEqual(self.read("game/a.twee"), "가\nb\nC\n")
        self.assertEqual(self.read("game/added.twee"), "n\n")
        self.assertFalse(os.path.exists(os.path.join(self.ours, "game/gone.twee")))
        self.assertEqual(self.read("game/same.twee"), "ㅅ\n")
        self.assertEqual(self.read("game/kr_js/k.js"), "k-kr\n")
        self.assertEqual(self.read("modules/css/m.css"), "M\n")
        self.assertEqual(self.read("version"), "0.5.13.8\n")
        self.assertFalse(os.path.exists(os.path.join(self.ours, "DolSettingsExport.json")))
        self.assertEqual(self.read("DolSettingsExport.js"), "x\n")
        self.assertEqual(self.read("README.md"), "ours\n")
        self.assertEqual(rep["files"]["merge"], 1)
        self.assertEqual(rep["deleted_translated"], 1)

    def test_binary_file_is_copied_not_merged(self):
        mu.merge_tree(self.base, self.new, self.ours)
        with open(os.path.join(self.ours, "game/fonts/f.ttf"), "rb") as f:
            self.assertEqual(f.read(), b"\xff\xfe\x00bin2")

    def test_img_sync_add_remove_keep(self):
        rep = mu.merge_tree(self.base, self.new, self.ours)
        self.assertEqual(rep["img"], {"added": 1, "removed": 1, "updated": 0})
        self.assertTrue(os.path.exists(os.path.join(self.ours, "img/new.png")))
        self.assertFalse(os.path.exists(os.path.join(self.ours, "img/old.png")))

    def test_pending_files_written_only_where_needed(self):
        mu.merge_tree(self.base, self.new, self.ours)
        p = os.path.join(self.ours, "translation/pending")
        self.assertTrue(os.path.exists(os.path.join(p, "game/a.twee.json")))
        self.assertTrue(os.path.exists(os.path.join(p, "game/added.twee.json")))
        self.assertTrue(os.path.exists(os.path.join(p, "game/gone.twee.json")))
        self.assertFalse(os.path.exists(os.path.join(p, "game/b.twee.json")))
        self.assertFalse(os.path.exists(os.path.join(p, "modules/css/m.css.json")))
        self.assertFalse(os.path.exists(os.path.join(p, "DolSettingsExport.js.json")))
        with open(os.path.join(p, "game/a.twee.json"), encoding="utf-8") as f:
            rec = json.load(f)
        self.assertEqual(rec, [{"kind": "merged-new-text", "old_en": ["c"], "old_kr": [], "new_en": ["C"], "context": "b"}])


class CliTreeTests(TreeTests):
    def test_cli_prints_report_and_writes_json(self):
        out_json = os.path.join(self.ours, "report.json")
        res = subprocess.run([sys.executable, SCRIPT, "--base", self.base, "--new", self.new, "--ours", self.ours, "--report-json", out_json],
                             capture_output=True, text=True)
        self.assertEqual(res.returncode, 0, res.stderr)
        self.assertIn("conflict_hunks", res.stdout)
        with open(out_json, encoding="utf-8") as f:
            rep = json.load(f)
        self.assertEqual(rep["files"]["new-file"], 1)
        self.assertEqual(rep["single_files"], {"take-new": 1, "delete": 1, "new-file": 1})


if __name__ == "__main__":
    unittest.main()
