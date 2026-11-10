#!/usr/bin/env python3
"""Build the `sugarcube-2-remote` story format from the bundled SugarCube.

The game's save storage (`idb` module) lives inside the story format, not in
the twee sources. This tool decodes `devTools/tweego/storyFormats/sugarcube-2/
format.js` (a `window.storyFormat({...})` JSON wrapper), swaps the idb
module's storage layer for `tools/remote-idb.js`, and writes the result as a
second story format that tweego selects with `-f sugarcube-2-remote`.

Usage: make_remote_format.py [--check] [--src FILE] [--fragment FILE] [--out FILE]

`--check` exits 0 when the committed output already matches what this tool
would generate from the current inputs, 1 (with "stale: <out>") otherwise.

Patch rules below are carried over unchanged from the retired HTML patcher
(dol-remote-save/patch/patch.py); every anchor must match exactly once.
"""
import argparse
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(HERE)
FORMATS = os.path.join(REPO, "devTools", "tweego", "storyFormats")
DEFAULT_SRC = os.path.join(FORMATS, "sugarcube-2", "format.js")
DEFAULT_OUT = os.path.join(FORMATS, "sugarcube-2-remote", "format.js")
DEFAULT_FRAGMENT = os.path.join(HERE, "remote-idb.js")

FORMAT_PREFIX = "window.storyFormat("

MODULE_START = "const idb=(()=>{"
MODULE_END = "window.idb=idb;"
SECTION_MARKER = "// === section: "
SECTION_NAMES = ("settings", "storage")
STORAGE_FUNCTIONS = (
    "function makePromise(",
    "async function getItem(",
    "async function setItem(",
    "async function deleteItem(",
    "async function loadState(",
    "async function saveState(",
    "async function getSaveDetails(",
    "async function clearAll(",
)

# (name, start, end, end_inclusive, replacement)
# `end` None means `start` is the whole anchor. `replacement` None means "use
# the fragment section named `name`".
REPLACEMENTS = (
    (
        "guard",
        "if(null==window.indexedDB)return Object.freeze({lock:!0,init:()=>!1,",
        "set footerHTML(_){return!1}});",
        True,
        "",
    ),
    ("idb-open", "function dbUpgrade(ev){", "function updateSettings(setting,value){", False, ""),
    ("settings", "function updateSettings(setting,value){", "const baddies=[];", False, None),
    ("storage", "async function importFromLocalStorage(){", "function savesAllowed(){", False, None),
    (
        "getAllSaves",
        'getAllSaves:{value:async function(){const db=await openDB(),saves=db.transaction(["saves"],"readonly")'
        '.objectStore("saves").getAll(),result=await makePromise(saves);return db.close(),result}}',
        None,
        False,
        "getAllSaves:{value:getAllSaves}",
    ),
    (
        "active",
        "active:{get:()=>_active,set(val){_active=Boolean(val)}}",
        None,
        False,
        "active:{get:()=>_active,set(val){_active=Boolean(val)||!(window.V&&V.ironmanmode)}}",
    ),
    ("init", "init:{value:dbName=>openDB(dbName)}", None, False, "init:{value:init}"),
    (
        "footer",
        "footerHTML:{get:()=>footerHTML,set(val){footerHTML=val}}",
        None,
        False,
        "footerHTML:{get:()=>footerHTML,set(val){footerHTML=val+'<li>원격 저장: '+location.host+'</li>'}}",
    ),
    (
        "legacy-button",
        'const idbtoggle=document.createElement("button");',
        "li.appendChild(idbtoggle),ul.appendChild(li),list.appendChild(ul),",
        True,
        "",
    ),
)


class PatchError(Exception):
    """Raised when an anchor is missing or ambiguous, or the input is not a story format."""


def _find_once(text, needle, name):
    count = text.count(needle)
    if count == 0:
        raise PatchError("missing anchor: %s" % name)
    if count > 1:
        raise PatchError("ambiguous anchor: %s (%d)" % (name, count))
    return text.index(needle)


def load_sections(fragment):
    """Split remote-idb.js into its named sections."""
    sections = {}
    pos = 0
    while True:
        start = fragment.find(SECTION_MARKER, pos)
        if start < 0:
            break
        name_end = fragment.index("\n", start)
        name = fragment[start + len(SECTION_MARKER):name_end].strip()
        nxt = fragment.find(SECTION_MARKER, name_end)
        sections[name] = fragment[name_end + 1:nxt if nxt >= 0 else len(fragment)]
        pos = name_end
    for name in SECTION_NAMES:
        if name not in sections:
            raise PatchError("missing fragment section: %s" % name)
    return sections


def _apply(block, name, start, end, end_inclusive, replacement):
    s = _find_once(block, start, name)
    if end is None:
        e = s + len(start)
    else:
        e = _find_once(block[s:], end, name) + s
        if end_inclusive:
            e += len(end)
    return block[:s] + replacement + block[e:], block[s:e]


def patch_html(html, fragment):
    """Return `html` with the idb module's storage layer replaced by the fragment."""
    sections = load_sections(fragment)
    ms = _find_once(html, MODULE_START, "module")
    me = _find_once(html, MODULE_END, "module")
    if me < ms:
        raise PatchError("missing anchor: module")
    block = html[ms:me]
    for name, start, end, end_inclusive, replacement in REPLACEMENTS:
        if replacement is None:
            replacement = "\n" + sections[name] + "\n"
        block, removed = _apply(block, name, start, end, end_inclusive, replacement)
        if name == "storage":
            for fn in STORAGE_FUNCTIONS:
                fn_name = fn.split("function ")[1].rstrip("(")
                if removed.count(fn) != 1:
                    raise PatchError("missing anchor: storage/%s" % fn_name)
    return html[:ms] + block + html[me:]


def decode_format(text):
    """Parse a `window.storyFormat({...});` file into its metadata dict."""
    body = text.strip()
    if not body.startswith(FORMAT_PREFIX):
        raise PatchError("not a story format")
    body = body[len(FORMAT_PREFIX):].rstrip()
    if body.endswith(";"):
        body = body[:-1].rstrip()
    if not body.endswith(")"):
        raise PatchError("not a story format")
    try:
        meta = json.loads(body[:-1])
    except ValueError as err:
        raise PatchError("not a story format: %s" % err)
    if not isinstance(meta, dict) or "source" not in meta:
        raise PatchError("not a story format: no source")
    return meta


def encode_format(meta):
    """Serialise metadata back to a `window.storyFormat(...)` file (semantic, not byte, round trip)."""
    return FORMAT_PREFIX + json.dumps(meta, ensure_ascii=False) + ");"


def make_remote_format(format_text, fragment):
    """Return the remote-save story format built from the original format file."""
    meta = decode_format(format_text)
    meta["source"] = patch_html(meta["source"], fragment)
    return encode_format(meta)


def _read(path):
    with open(path, encoding="utf-8", newline="") as f:
        return f.read()


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--src", default=DEFAULT_SRC, help="original story format (format.js)")
    parser.add_argument("--fragment", default=DEFAULT_FRAGMENT, help="remote-idb.js")
    parser.add_argument("--out", default=DEFAULT_OUT, help="generated remote story format")
    parser.add_argument("--check", action="store_true", help="verify the generated file is up to date")
    args = parser.parse_args(argv)

    try:
        meta = decode_format(_read(args.src))
        expected_source = patch_html(meta["source"], _read(args.fragment))
    except OSError as err:
        print("cannot read %s: %s" % (err.filename, err.strerror), file=sys.stderr)
        return 1
    except PatchError as err:
        print(str(err), file=sys.stderr)
        return 1

    if args.check:
        try:
            current = decode_format(_read(args.out))["source"]
        except (OSError, PatchError):
            current = None
        if current == expected_source:
            print("check ok: %s" % args.out)
            return 0
        print("stale: %s (run: python3 tools/make_remote_format.py)" % args.out, file=sys.stderr)
        return 1

    meta["source"] = expected_source
    os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)
    tmp = args.out + ".tmp"
    with open(tmp, "w", encoding="utf-8", newline="") as f:
        f.write(encode_format(meta))
    os.replace(tmp, args.out)
    print("wrote %s" % args.out)
    return 0


if __name__ == "__main__":
    sys.exit(main())
