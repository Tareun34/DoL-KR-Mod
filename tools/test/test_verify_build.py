import os
import subprocess
import sys
import tempfile
import unittest

from tools import verify_build

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


def passage(name, body, pid=1):
    return '<tw-passagedata pid="%d" name="%s" tags="">%s</tw-passagedata>' % (pid, name, body)


def html(passages, head='<script>/* "game/x.css" */ var a = 1;</script>', tail="</html>"):
    return head + "<tw-storydata>" + "".join(passages) + "</tw-storydata>" + tail


class PassagesTests(unittest.TestCase):
    def test_passage_names_are_unescaped(self):
        doc = html([passage("Bailey&#39;s Office", "a &lt;b&gt; &amp; c\n")])
        got = verify_build.passages(doc)
        self.assertEqual(got, {"Bailey's Office": "a <b> & c"})


class CompareTests(unittest.TestCase):
    def test_identical_html_reports_clean(self):
        doc = html([passage("A", "one"), passage("B", "two", 2)])
        r = verify_build.compare(doc, doc)
        self.assertEqual((r.only_a, r.only_b, r.changed), ([], [], []))
        self.assertTrue(r.script_equal)
        self.assertEqual(r.script_diff, [])

    def test_changed_passage_listed(self):
        a = html([passage("A", "one"), passage("B", "two", 2)])
        b = html([passage("A", "one"), passage("B", "TWO", 2)])
        r = verify_build.compare(a, b)
        self.assertEqual(r.changed, ["B"])
        self.assertEqual((r.only_a, r.only_b), ([], []))

    def test_only_in_one_side(self):
        a = html([passage("A", "one"), passage("Gone", "x", 2)])
        b = html([passage("A", "one"), passage("New", "y", 2)])
        r = verify_build.compare(a, b)
        self.assertEqual(r.only_a, ["Gone"])
        self.assertEqual(r.only_b, ["New"])

    def test_script_path_separator_normalised(self):
        a = html([passage("A", "one")], head='<script>/* "game\\\\x.css" */</script>')
        b = html([passage("A", "one")], head='<script>/* "game/x.css" */</script>')
        r = verify_build.compare(a, b)
        self.assertTrue(r.script_equal)

    def test_script_difference_reported(self):
        a = html([passage("A", "one")], head="<script>var a = 1;</script>")
        b = html([passage("A", "one")], head="<script>var a = 1;\nvar b = 2;</script>")
        r = verify_build.compare(a, b)
        self.assertFalse(r.script_equal)
        self.assertTrue(any(l.startswith("+") and "var b = 2" in l for l in r.script_diff))


class CliTests(unittest.TestCase):
    def run_cli(self, a, b, *extra):
        with tempfile.TemporaryDirectory() as d:
            pa, pb = os.path.join(d, "a.html"), os.path.join(d, "b.html")
            open(pa, "w", encoding="utf-8").write(a)
            open(pb, "w", encoding="utf-8").write(b)
            return subprocess.run(
                [sys.executable, os.path.join(REPO, "tools", "verify_build.py"), pa, pb, *extra],
                capture_output=True, text=True, cwd=REPO,
            )

    def test_cli_exit_codes(self):
        a = html([passage("A", "one"), passage("B", "two", 2)])
        b = html([passage("A", "one"), passage("B", "TWO", 2)])
        res = self.run_cli(a, b)
        self.assertEqual(res.returncode, 1, res.stdout + res.stderr)
        self.assertIn("B", res.stdout)
        res = self.run_cli(a, b, "--allow", "B")
        self.assertEqual(res.returncode, 0, res.stdout + res.stderr)

    def test_cli_script_diff_budget(self):
        a = html([passage("A", "one")], head="<script>\nvar a = 1;\n</script>")
        b = html([passage("A", "one")], head="<script>\nvar a = 1;\nvar b = 2;\n</script>")
        self.assertEqual(self.run_cli(a, b).returncode, 1)
        self.assertEqual(self.run_cli(a, b, "--max-script-diff", "1").returncode, 0)


if __name__ == "__main__":
    unittest.main()
