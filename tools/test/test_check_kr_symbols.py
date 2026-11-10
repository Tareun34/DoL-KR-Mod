import json
import os
import subprocess
import sys
import tempfile
import unittest

from tools import check_kr_symbols

SCRIPT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "check_kr_symbols.py")


def make_tree(case, files):
    root = tempfile.mkdtemp()
    case.addCleanup(lambda: __import__("shutil").rmtree(root))
    for rel, body in files.items():
        path = os.path.join(root, rel)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w", encoding="utf-8") as f:
            f.write(body)
    return root


def run(argv):
    return subprocess.run([sys.executable, *argv], capture_output=True, text=True)


class CollectTests(unittest.TestCase):
    def test_collects_widget_and_js_definitions(self):
        root = make_tree(self, {
            "game/a.twee": ':: W [widget]\n<<widget "fooKr">>x<</widget>>\n',
            "game/b.js": "setup.bar = 1;\nwindow.baz = () => 0;\nwindow.KR.qux = 2;\nfunction top() {}\n  function inner() {}\n",
        })
        d = check_kr_symbols.collect_defs(root)
        self.assertEqual(d["widget"], {"fooKr"})
        self.assertEqual(d["js"], {"bar", "baz", "KR.qux", "top"})

    def test_kr_only_is_set_difference(self):
        base = make_tree(self, {"game/a.twee": '<<widget "shared">>', "game/b.js": "setup.shared = 1;\n"})
        ours = make_tree(self, {"game/a.twee": '<<widget "shared">><<widget "onlyKr">>',
                                "game/b.js": "setup.shared = 1;\nwindow.KR.only = 1;\n"})
        self.assertEqual(check_kr_symbols.kr_only_defs(ours, base), {"widget": ["onlyKr"], "js": ["KR.only"]})


class UndefinedTests(unittest.TestCase):
    def test_reports_used_but_undefined(self):
        root = make_tree(self, {"game/a.twee": "<<onlyKr>> <<other>>\n", "game/b.js": "window.KR.only(); setup.gone(1);\n"})
        names = {"widget": ["onlyKr", "other"], "js": ["KR.only", "gone", "unused"]}
        got = check_kr_symbols.find_undefined(root, names)
        self.assertEqual(sorted(got), [("js", "KR.only", "game/b.js"), ("js", "gone", "game/b.js"),
                                       ("widget", "onlyKr", "game/a.twee"), ("widget", "other", "game/a.twee")])

    def test_defined_names_are_not_reported(self):
        root = make_tree(self, {"game/a.twee": '<<widget "onlyKr">>x<</widget>>\n<<onlyKr>>\n',
                                "game/b.js": "window.KR.only = 1;\nwindow.KR.only();\n"})
        self.assertEqual(check_kr_symbols.find_undefined(root, {"widget": ["onlyKr"], "js": ["KR.only"]}), [])


class CliTests(unittest.TestCase):
    def test_snapshot_then_check(self):
        base = make_tree(self, {"game/a.twee": "", "game/b.js": ""})
        ours = make_tree(self, {"game/a.twee": '<<widget "onlyKr">>x<</widget>>\n<<onlyKr>>\n',
                                "game/b.js": "window.KR.only = 1;\nwindow.KR.only();\n"})
        snap = os.path.join(ours, "kr-symbols.json")
        res = run([SCRIPT, "snapshot", "--ours", ours, "--base", base, "--out", snap])
        self.assertEqual(res.returncode, 0, res.stderr)
        self.assertEqual(json.load(open(snap)), {"widget": ["onlyKr"], "js": ["KR.only"]})
        self.assertEqual(run([SCRIPT, "check", "--root", ours, "--snapshot", snap]).returncode, 0)
        broken = make_tree(self, {"game/a.twee": "<<onlyKr>>\n", "game/b.js": "window.KR.only();\n"})
        res = run([SCRIPT, "check", "--root", broken, "--snapshot", snap])
        self.assertEqual(res.returncode, 1)
        self.assertIn("widget onlyKr game/a.twee", res.stdout)
        self.assertIn("js KR.only game/b.js", res.stdout)


if __name__ == "__main__":
    unittest.main()
