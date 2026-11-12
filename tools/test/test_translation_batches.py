import json
import os
import shutil
import tempfile
import unittest

from tools import translation_batches as tb


def rec(kind, new_en, old_kr=()):
    return {"kind": kind, "old_en": ["x"] if old_kr else [], "old_kr": list(old_kr), "new_en": list(new_en), "context": ""}


def prose(n, tag):
    return ["Line number %d of %s text here" % (i, tag) for i in range(n)]


class BatchTests(unittest.TestCase):
    def setUp(self):
        self.root = tempfile.mkdtemp()
        self.addCleanup(lambda: shutil.rmtree(self.root))
        files = {
            "game/base-combat/a.twee": [rec("conflict", prose(10, "a"), ["옛"])],
            "game/base-system/b.twee": [rec("conflict", prose(3, "b"), ["옛"]), rec("merged-new-text", prose(2, "bb"))],
            "game/overworld-town/c.twee": [rec("merged-new-text", prose(4, "c"))],
            "game/overworld-town/loc-bus/thug.twee": [rec("new-file", [])],
        }
        for rel, records in files.items():
            src = os.path.join(self.root, rel)
            os.makedirs(os.path.dirname(src), exist_ok=True)
            lines = [l for r in records for l in r["new_en"]] or ["Thug text one here", "<<set $x to 1>>", "Thug text two here"]
            with open(src, "w", encoding="utf-8") as f:
                f.write("\n".join(lines) + "\n")
            pj = os.path.join(self.root, "translation", "pending", rel + ".json")
            os.makedirs(os.path.dirname(pj), exist_ok=True)
            with open(pj, "w", encoding="utf-8") as f:
                json.dump(records, f)

    def test_file_work_pass_and_lines(self):
        w = tb.file_work(self.root)
        self.assertEqual(w["game/base-combat/a.twee"], {"pass": 1, "lines": 10, "records": 1})
        self.assertEqual(w["game/base-system/b.twee"], {"pass": 1, "lines": 5, "records": 2})
        self.assertEqual(w["game/overworld-town/c.twee"], {"pass": 2, "lines": 4, "records": 1})
        self.assertEqual(w["game/overworld-town/loc-bus/thug.twee"], {"pass": 3, "lines": 2, "records": 1})

    def test_make_batches_orders_and_splits(self):
        batches = tb.make_batches(tb.file_work(self.root), max_lines=12)
        self.assertEqual([(b["id"], b["pass"], b["files"], b["lines"]) for b in batches], [
            ("P1-01", 1, ["game/base-system/b.twee"], 5),
            ("P1-02", 1, ["game/base-combat/a.twee"], 10),
            ("P2-01", 2, ["game/overworld-town/c.twee"], 4),
            ("P3-01", 3, ["game/overworld-town/loc-bus/thug.twee"], 2),
        ])

    def test_render_log_table(self):
        md = tb.render_log(tb.make_batches(tb.file_work(self.root), max_lines=12))
        self.assertIn("| P1-01 | 1 | game/base-system/b.twee | 5 | 대기 |  |", md)


if __name__ == "__main__":
    unittest.main()
