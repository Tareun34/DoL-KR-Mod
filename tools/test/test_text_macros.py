import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest

from tools import text_macros as tm
from tools import check_translation as ct

SCRIPT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "text_macros.py")


def rec(old_en, old_kr):
    return {"kind": "conflict", "old_en": old_en, "old_kr": old_kr, "new_en": ["x"], "context": ""}


class CandidatesTests(unittest.TestCase):
    def setUp(self):
        self.root = tempfile.mkdtemp()
        self.addCleanup(lambda: shutil.rmtree(self.root))
        d = os.path.join(self.root, "translation", "pending", "game")
        os.makedirs(d)
        with open(os.path.join(d, "a.twee.json"), "w", encoding="utf-8") as f:
            json.dump([
                rec(["<<He>> smiles and <<he>> waves at you."], ["<<he>>【이가】 웃으며 당신에게 손을 흔든다."]),
                rec(["<<if $a>>Hello there<<else>>Bye now<</if>>"], ["<<if $a>>안녕 거기<</if>>"]),
                rec(["<<person1>> looks at you."], ["<<person1>>【이가】 당신을 본다."]),
            ], f)

    def test_candidates_counts_differing_argless_macros(self):
        self.assertEqual(tm.candidates(self.root, min_records=1), [("he", 1, 1)])

    def test_cli_writes_list_readable_by_checker(self):
        out = os.path.join(self.root, "text-macros.txt")
        res = subprocess.run([sys.executable, SCRIPT, "--root", self.root, "--min-records", "1", "--out", out], capture_output=True, text=True)
        self.assertEqual(res.returncode, 0, res.stderr)
        self.assertEqual(ct.load_text_macros(out), {"he"})


if __name__ == "__main__":
    unittest.main()
