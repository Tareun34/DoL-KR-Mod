import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from unittest import mock

from tools import make_remote_format as mrf

HERE = os.path.dirname(os.path.abspath(__file__))
TOOLS = os.path.dirname(HERE)
REPO = os.path.dirname(TOOLS)
SCRIPT = os.path.join(TOOLS, "make_remote_format.py")
REAL_FORMAT = os.path.join(REPO, "devTools", "tweego", "storyFormats", "sugarcube-2", "format.js")

with open(os.path.join(HERE, "fixtures", "idb-module.js"), encoding="utf-8") as f:
    MODULE = f.read()
with open(os.path.join(TOOLS, "remote-idb.js"), encoding="utf-8") as f:
    FRAGMENT = f.read()


def html_with(module):
    return "<html><script>" + module + "window.idb=idb;</script><p>x</p></html>"


HTML = html_with(MODULE)
META = {"name": "SugarCube", "version": "2.36.1", "description": 'a "quoted" <b>desc</b>', "source": HTML}
FORMAT = "window.storyFormat(" + json.dumps(META, ensure_ascii=False) + ");"


class PatchHtmlTests(unittest.TestCase):
    def test_patch_removes_indexeddb_and_installs_fragment(self):
        out = mrf.patch_html(HTML, FRAGMENT)
        for gone in ("indexedDB.open", "dbUpgrade", "saves-idb-toggle", "null==window.indexedDB"):
            self.assertNotIn(gone, out)
        for kept in ("getAllSaves:{value:getAllSaves}", "init:{value:init}", "API_BASE", "원격 저장",
                     "function generateSaveRow(", "<p>x</p>", "V.ironmanmode"):
            self.assertIn(kept, out)

    def test_patching_twice_fails(self):
        once = mrf.patch_html(HTML, FRAGMENT)
        with self.assertRaises(mrf.PatchError):
            mrf.patch_html(once, FRAGMENT)

    def test_missing_anchor_names_it(self):
        broken = HTML.replace("init:{value:dbName=>openDB(dbName)}", "init:{value:dbName=>openDB(dbName) }")
        with self.assertRaises(mrf.PatchError) as cm:
            mrf.patch_html(broken, FRAGMENT)
        self.assertIn("init", str(cm.exception))

    def test_ambiguous_module_fails(self):
        with self.assertRaises(mrf.PatchError) as cm:
            mrf.patch_html(HTML + HTML, FRAGMENT)
        self.assertIn("module", str(cm.exception))

    def test_storage_span_checks_function_names(self):
        broken = HTML.replace("async function clearAll(", "async function clearAll2(")
        with self.assertRaises(mrf.PatchError) as cm:
            mrf.patch_html(broken, FRAGMENT)
        self.assertIn("storage/clearAll", str(cm.exception))

    def _module_js(self, out):
        return out[out.index("const idb=(()=>{"):out.index("window.idb=idb;")]

    def test_patched_module_is_valid_js(self):
        if shutil.which("node") is None:
            self.skipTest("node not on PATH")
        out = mrf.patch_html(HTML, FRAGMENT)
        with tempfile.TemporaryDirectory() as d:
            js = os.path.join(d, "patched.js")
            with open(js, "w", encoding="utf-8") as f:
                f.write(self._module_js(out))
            result = subprocess.run(["node", "--check", js], capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_footer_setter_appends_remote_line(self):
        if shutil.which("node") is None:
            self.skipTest("node not on PATH")
        out = mrf.patch_html(HTML, FRAGMENT)
        stubs = (
            "globalThis.window=globalThis;globalThis.V={};"
            "globalThis.localStorage={getItem:()=>null,setItem(){}};"
            "globalThis.location={host:'srv',origin:'http://srv'};"
            "globalThis.document={body:{}};globalThis.Dialog={close(){}};"
        )
        script = stubs + self._module_js(out) + "console.log(JSON.stringify((idb.footerHTML='<li>x</li>', idb.footerHTML)));"
        with tempfile.TemporaryDirectory() as d:
            js = os.path.join(d, "footer.js")
            with open(js, "w", encoding="utf-8") as f:
                f.write(script)
            result = subprocess.run(["node", js], capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout.strip(), '"<li>x</li><li>원격 저장: srv</li>"')
        self.assertIn("footerHTML:{get:()=>footerHTML,set(val){footerHTML=val+", out)


class FormatTests(unittest.TestCase):
    def test_decode_encode_round_trip(self):
        meta = mrf.decode_format(FORMAT)
        self.assertEqual(meta, META)
        self.assertEqual(mrf.decode_format(mrf.encode_format(meta)), META)
        self.assertTrue(mrf.encode_format(meta).startswith("window.storyFormat("))

    def test_decode_rejects_non_format(self):
        with self.assertRaises(mrf.PatchError):
            mrf.decode_format("<html>not a format</html>")

    def test_make_remote_format_patches_source(self):
        out = mrf.make_remote_format(FORMAT, FRAGMENT)
        meta = mrf.decode_format(out)
        self.assertEqual(meta["name"], "SugarCube")
        self.assertEqual(meta["description"], META["description"])
        self.assertIn("const API_BASE = location.origin", meta["source"])
        self.assertNotIn("null==window.indexedDB", meta["source"])
        self.assertIn("<p>x</p>", meta["source"])

    def test_real_format_js_patches(self):
        with open(REAL_FORMAT, encoding="utf-8", newline="") as f:
            real = f.read()
        out = mrf.make_remote_format(real, FRAGMENT)
        source = mrf.decode_format(out)["source"]
        self.assertEqual(source.count(mrf.MODULE_START), 1)
        self.assertIn("const API_BASE = location.origin", source)


class CliTests(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.mkdtemp()
        self.src = os.path.join(self.dir, "format.js")
        self.out = os.path.join(self.dir, "remote", "format.js")
        self.fragment = os.path.join(self.dir, "remote-idb.js")
        with open(self.src, "w", encoding="utf-8") as f:
            f.write(FORMAT)
        with open(self.fragment, "w", encoding="utf-8") as f:
            f.write(FRAGMENT)

    def tearDown(self):
        shutil.rmtree(self.dir)

    def run_cli(self, *args):
        return subprocess.run(
            [sys.executable, SCRIPT, "--src", self.src, "--fragment", self.fragment, "--out", self.out, *args],
            capture_output=True, text=True, cwd=REPO,
        )

    def test_check_detects_stale_output(self):
        res = self.run_cli("--check")
        self.assertEqual(res.returncode, 1)
        self.assertIn("stale", res.stdout + res.stderr)
        os.makedirs(os.path.dirname(self.out))
        with open(self.out, "w", encoding="utf-8") as f:
            f.write("window.storyFormat({\"name\":\"x\",\"source\":\"old\"});")
        res = self.run_cli("--check")
        self.assertEqual(res.returncode, 1)
        self.assertIn("stale", res.stdout + res.stderr)

    def test_check_passes_after_generate(self):
        res = self.run_cli()
        self.assertEqual(res.returncode, 0, res.stderr)
        self.assertTrue(os.path.exists(self.out))
        with open(self.src, encoding="utf-8") as f:
            self.assertEqual(f.read(), FORMAT)
        res = self.run_cli("--check")
        self.assertEqual(res.returncode, 0, res.stdout + res.stderr)

    def test_missing_src_reports_without_traceback(self):
        os.remove(self.src)
        res = self.run_cli()
        self.assertEqual(res.returncode, 1)
        self.assertNotIn("Traceback", res.stderr)
        self.assertIn(self.src, res.stderr)

    def test_missing_fragment_reports_without_traceback(self):
        os.remove(self.fragment)
        res = self.run_cli("--check")
        self.assertEqual(res.returncode, 1)
        self.assertNotIn("Traceback", res.stderr)
        self.assertIn(self.fragment, res.stderr)

    def test_main_reads_src_once(self):
        calls = []
        orig = mrf._read

        def counting(path):
            calls.append(path)
            return orig(path)

        with mock.patch.object(mrf, "_read", counting), mock.patch("sys.stdout"):
            rc = mrf.main(["--src", self.src, "--fragment", self.fragment, "--out", self.out])
        self.assertEqual(rc, 0)
        self.assertEqual(calls.count(self.src), 1, calls)


if __name__ == "__main__":
    unittest.main()
