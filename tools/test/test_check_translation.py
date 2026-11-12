import os
import shutil
import subprocess
import sys
import tempfile
import unittest

from tools import check_translation as ct

SCRIPT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "check_translation.py")
TM = {"he", "his", "him", "person1", "girl"}


class SkeletonTweeTests(unittest.TestCase):
    def test_prose_is_dropped_and_structure_kept(self):
        a = ct.skeleton_twee('<<if $x is 1>>Hello <<he>> there<<else>>Bye<</if>>', TM)
        b = ct.skeleton_twee('<<if $x is 1>>안녕 <<he>>【은는】 거기<<else>>잘 가<</if>>', TM)
        self.assertEqual(a, b)
        self.assertEqual(a, ['<<if $x is 1>>', '<<else>>', '<</if>>'])

    def test_link_label_may_change_target_may_not(self):
        base = '<<link [[Next|Forest Cabin]]>><<endevent>><</link>>'
        self.assertEqual(ct.skeleton_twee(base, TM), ct.skeleton_twee('<<link [[다음|Forest Cabin]]>><<endevent>><</link>>', TM))
        self.assertNotEqual(ct.skeleton_twee(base, TM), ct.skeleton_twee('<<link [[다음|Forest Cabin2]]>><<endevent>><</link>>', TM))
        self.assertEqual(ct.skeleton_twee('[[Next->Shop]]', TM), ct.skeleton_twee('[[다음->Shop]]', TM))

    def test_text_macro_dropped_ok_structural_macro_dropped_fails(self):
        base = '<<He>> smiles. <<he>> waves.<<endevent>>'
        self.assertEqual(ct.skeleton_twee(base, TM), ct.skeleton_twee('<<he>>【이가】 웃으며 손을 흔든다.<<endevent>>', TM))
        self.assertNotEqual(ct.skeleton_twee(base, TM), ct.skeleton_twee('<<he>>【이가】 웃으며 손을 흔든다.', TM))
        self.assertNotEqual(ct.skeleton_twee('<<if $a>>x<<else>>y<</if>>', TM), ct.skeleton_twee('<<if $a>>x<</if>>', TM))

    def test_macro_string_args_are_prose(self):
        self.assertEqual(ct.skeleton_twee('<<link "Next" "Shop">>', TM), ct.skeleton_twee('<<link "다음" "Shop">>', TM))
        self.assertEqual(ct.skeleton_twee('<<set $x to "m">>', TM), ct.skeleton_twee('<<set $x to "남">>', TM))  # known limit

    def test_backtick_template_strings_are_prose(self):
        base = '<<= $r gte 1 ? `"Fuck...!" <<he>> hisses` : `<<He>> curses`>>'
        self.assertEqual(ct.skeleton_twee(base, TM),
                         ct.skeleton_twee('<<= $r gte 1 ? `"젠장...!" <<he>>【이가】 쉭 소리를 낸다` : `<<He>>【이가】 욕한다`>>', TM))
        self.assertNotEqual(ct.skeleton_twee(base, TM), ct.skeleton_twee('<<= $r gte 1 ? `"젠장...!"` : `욕한다`>>', TM))

    def test_html_tags_keep_name_and_attr_names(self):
        self.assertEqual(ct.skeleton_twee('<span class="gold">Money:</span>', TM), ct.skeleton_twee('<span class="gold">돈:</span>', TM))
        self.assertNotEqual(ct.skeleton_twee('<span class="gold">x</span>', TM), ct.skeleton_twee('<span class="red">x</span>', TM))

    def test_variables_in_prose_are_kept(self):
        self.assertNotEqual(ct.skeleton_twee('You have $money coins', TM), ct.skeleton_twee('동전이 있다', TM))
        self.assertEqual(ct.skeleton_twee('You have $money coins', TM), ct.skeleton_twee('$money개의 동전이 있다', TM))


class SkeletonJsTests(unittest.TestCase):
    def test_strings_and_comments_blanked(self):
        self.assertEqual(ct.skeleton_js('x = "Hello"; // hi\n'), ct.skeleton_js('x = "안녕"; // 안녕\n'))
        self.assertEqual(ct.skeleton_js("y = 'a\\'b'; /* c */ z = `t ${v} u`;"), ct.skeleton_js("y = '가'; z = `티 ${v} 유`;"))
        self.assertNotEqual(ct.skeleton_js('x = 1;'), ct.skeleton_js('x = 2;'))

    def test_js_allows_counter_property_only(self):
        base = 'a: {\n\tname: "apple",\n\tprice: 1,\n},\n'
        self.assertEqual(ct.skeleton_js(base), ct.skeleton_js('a: {\n\tname: "사과",\n\tcounter: "개",\n\tprice: 1,\n},\n'))
        self.assertNotEqual(ct.skeleton_js(base), ct.skeleton_js('a: {\n\tname: "사과",\n\tunit: "개",\n\tprice: 1,\n},\n'))


class JosaTests(unittest.TestCase):
    def test_josa_checked_on_changed_lines_only(self):
        before = "옛 줄【의】 그대로\nHello there\n"
        after = "옛 줄【의】 그대로\n안녕【은는】 거기【에게】\n"
        self.assertEqual(ct.josa_violations(before, after), [(2, "【에게】")])
        self.assertEqual(ct.josa_violations(before, before), [])


class CheckFileTests(unittest.TestCase):
    def test_ok_and_fail_results(self):
        r = ct.check_file("a.twee", "<<if $a>>Hi<</if>>", "<<if $a>>안녕<</if>>", TM)
        self.assertTrue(r.ok)
        self.assertEqual(r.remaining_prose, 0)
        r = ct.check_file("a.twee", "<<if $a>>Hi there<</if>>", "<<if $a>>Hi there", TM)
        self.assertFalse(r.ok)
        self.assertIn("<</if>>", r.reason)
        self.assertEqual(r.remaining_prose, 1)
        r = ct.check_file("s.css", "a{}", "a{ }", TM)
        self.assertFalse(r.ok)

    def test_load_text_macros(self):
        d = tempfile.mkdtemp()
        self.addCleanup(lambda: shutil.rmtree(d))
        p = os.path.join(d, "tm.txt")
        with open(p, "w", encoding="utf-8") as f:
            f.write("# comment\nHe\n\nperson1\n")
        self.assertEqual(ct.load_text_macros(p), {"he", "person1"})


class CliTests(unittest.TestCase):
    def setUp(self):
        self.repo = tempfile.mkdtemp()
        self.addCleanup(lambda: shutil.rmtree(self.repo))
        env = {"GIT_AUTHOR_NAME": "t", "GIT_AUTHOR_EMAIL": "t@t", "GIT_COMMITTER_NAME": "t", "GIT_COMMITTER_EMAIL": "t@t", "PATH": os.environ["PATH"], "HOME": self.repo}
        self.env = env
        subprocess.run(["git", "init", "-q"], cwd=self.repo, check=True, env=env)
        with open(os.path.join(self.repo, "a.twee"), "w", encoding="utf-8") as f:
            f.write("<<if $a>>Hello there<</if>>\n")
        subprocess.run(["git", "add", "a.twee"], cwd=self.repo, check=True, env=env)
        subprocess.run(["git", "commit", "-q", "-m", "x"], cwd=self.repo, check=True, env=env)
        self.tm = os.path.join(self.repo, "tm.txt")
        with open(self.tm, "w", encoding="utf-8") as f:
            f.write("he\n")

    def run_cli(self, *files):
        return subprocess.run([sys.executable, SCRIPT, *files, "--text-macros", self.tm], cwd=self.repo, capture_output=True, text=True, env=self.env)

    def test_cli_against_git_head(self):
        with open(os.path.join(self.repo, "a.twee"), "w", encoding="utf-8") as f:
            f.write("<<if $a>>안녕 거기<</if>>\n")
        res = self.run_cli("a.twee")
        self.assertEqual(res.returncode, 0, res.stdout + res.stderr)
        self.assertIn("ok a.twee", res.stdout)
        with open(os.path.join(self.repo, "a.twee"), "w", encoding="utf-8") as f:
            f.write("<<if $a>>안녕 거기\n")
        res = self.run_cli("a.twee")
        self.assertEqual(res.returncode, 1)
        self.assertIn("FAIL a.twee", res.stdout)
        with open(os.path.join(self.repo, "b.twee"), "w", encoding="utf-8") as f:
            f.write("Brand new passage text\n")
        res = self.run_cli("b.twee")
        self.assertEqual(res.returncode, 0, res.stdout + res.stderr)
        self.assertIn("ok b.twee (english lines left: 1)", res.stdout)


if __name__ == "__main__":
    unittest.main()
