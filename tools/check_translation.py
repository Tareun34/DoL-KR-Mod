#!/usr/bin/env python3
"""Verify that a translation edit changed only prose, never code.

    check_translation.py FILE... [--text-macros translation/text-macros.txt] [--base-ref HEAD]

For each file the "before" text is `git show <ref>:<file>`; the working-tree
file is "after". A .twee file passes when both reduce to the same structure
skeleton (macros, variables, link targets, HTML tags; prose dropped; text
macros such as <<he>> ignored). A .js file passes when the code with string
contents and comments removed is identical (an allowed Korean-only property
such as `counter: "..."` may be added). A .css file must not change at all.
Josa markers on changed lines must be from the allowed set.
"""
import argparse
import difflib
import os
import re
import subprocess
import sys
from dataclasses import dataclass

try:
    from tools.translation_status import has_prose
except ImportError:  # run as a script from tools/
    from translation_status import has_prose

ALLOWED_JOSA = ("은는", "이가", "을를", "와과", "으로로", "아야", "이나나", "이", "이었였")
JOSA_RE = re.compile(r"【[^】]*】")
VAR_RE = re.compile(r"(?<![A-Za-z0-9_$])[$_][A-Za-z_][A-Za-z0-9_]*")
TAG_RE = re.compile(r"<(/?)([A-Za-z][\w-]*)((?:\s[^<>]*)?)(/?)>", re.S)
ATTR_RE = re.compile(r"([A-Za-z_@:][\w:.-]*)\s*=\s*(\"[^\"]*\"|'[^']*'|[^\s\"'<>]+)")
TRANSLATABLE_ATTRS = {"title", "alt", "placeholder", "aria-label", "data-tooltip", "tooltip"}
LINK_RE = re.compile(r"\[\[(.*?)\]\]", re.S)
MACRO_NAME_RE = re.compile(r"^\s*(/?)([A-Za-z_=][\w]*)")
WS_RE = re.compile(r"\s+")


def load_text_macros(path):
    names = set()
    if not path or not os.path.isfile(path):
        return names
    with open(path, encoding="utf-8") as f:
        for line in f:
            line = line.split("#", 1)[0].strip()
            if line:
                names.add(line.lower())
    return names


def _link_target(inner):
    setter = ""
    if "][" in inner:
        inner, setter = inner.split("][", 1)
        setter = "][" + setter
    label = ""
    if "->" in inner:
        label, target = inner.split("->", 1)
    elif "<-" in inner:
        target, label = inner.split("<-", 1)
    elif "|" in inner:
        label, target = inner.rsplit("|", 1)
    else:
        target = inner
    macros = "".join("<<" + _normalise_macro_body(m) + ">>" for m in re.findall(r"<<(.*?)>>", label, re.S))
    return "[[" + target.strip() + setter + "]]" + macros


def _macro_end(text, i):
    """Index of the closing '>>' of the macro starting at i, honouring quotes and backtick templates."""
    n = len(text)
    j = i + 2
    quote = None
    depth = 0
    while j < n:
        c = text[j]
        if quote:
            if c == "\\":
                j += 2
                continue
            if quote == "`" and text.startswith("<<", j):
                k = text.find(">>", j + 2)
                j = k + 2 if k >= 0 else n
                continue
            if c == quote:
                quote = None
            j += 1
        else:
            if c in "\"'`":
                quote = c
                j += 1
            elif text.startswith("<<", j):
                depth += 1
                j += 2
            elif text.startswith(">>", j):
                if depth == 0:
                    return j
                depth -= 1
                j += 2
            else:
                j += 1
    return -1


def _normalise_macro_body(body):
    """Blank quoted strings; keep only macros and variables inside backtick templates; collapse whitespace."""
    out = []
    n = len(body)
    j = 0
    quote = None
    while j < n:
        c = body[j]
        if quote in ("\"", "'"):
            if c == "\\":
                j += 2
                continue
            if c == quote:
                out.append(c)
                quote = None
            j += 1
        elif quote == "`":
            if c == "`":
                out.append("`")
                quote = None
                j += 1
            elif body.startswith("<<", j):
                k = body.find(">>", j + 2)
                k = n if k < 0 else k + 2
                out.append(" " + _normalise_macro_body(body[j + 2:k - 2]).join(("<<", ">>")) + " ")
                j = k
            else:
                m = VAR_RE.match(body, j)
                if m:
                    out.append(" " + m.group(0) + " ")
                    j = m.end()
                else:
                    j += 1
        else:
            if c in "\"'`":
                quote = c
                out.append(c)
            else:
                out.append(c)
            j += 1
    s = "".join(out)
    s = LINK_RE.sub(lambda m: _link_target(m.group(1)), s)
    return WS_RE.sub(" ", s).strip()


def _tokens_twee(text, text_macros):
    """[(token, line_no)] for the structural parts of a twee passage file."""
    tokens = []
    n = len(text)
    i = 0
    line = 1
    while i < n:
        if text.startswith("<<", i):
            end = _macro_end(text, i)
            if end < 0:
                break
            body = text[i + 2:end]
            m = MACRO_NAME_RE.match(body)
            if m:
                closer, name = m.group(1), m.group(2)
                args = body[m.end():]
                if not closer and name.lower() in text_macros and not args.strip():
                    pass  # text macro: prose
                else:
                    tokens.append(("<<" + _normalise_macro_body(body) + ">>", line))
            else:
                tokens.append(("<<" + _normalise_macro_body(body) + ">>", line))
            line += text.count("\n", i, end)
            i = end + 2
            continue
        if text.startswith("[[", i):
            end = text.find("]]", i + 2)
            if end < 0:
                break
            tokens.append((_link_target(text[i + 2:end]), line))
            line += text.count("\n", i, end)
            i = end + 2
            continue
        if text.startswith("<!--", i):
            end = text.find("-->", i + 4)
            end = n if end < 0 else end + 3
            line += text.count("\n", i, end)
            i = end
            continue
        if text.startswith("/*", i):
            end = text.find("*/", i + 2)
            end = n if end < 0 else end + 2
            line += text.count("\n", i, end)
            i = end
            continue
        if text[i] == "<":
            m = TAG_RE.match(text, i)
            if m:
                pairs = ATTR_RE.findall(m.group(3))
                button = m.group(2).lower() == "input" and any(a.lower() == "type" and v.strip("\"'").lower() in ("button", "submit") for a, v in pairs)
                attrs = ["%s=%s" % (a, "" if a.lower() in TRANSLATABLE_ATTRS or (button and a.lower() == "value") else v) for a, v in pairs]
                tokens.append(("<" + m.group(1) + m.group(2) + ("".join(" " + a for a in attrs)) + m.group(4) + ">", line))
                line += text.count("\n", i, m.end())
                i = m.end()
                continue
        if text[i] in "$_":
            m = VAR_RE.match(text, i)
            if m:
                tokens.append((m.group(0), line))
                i = m.end()
                continue
        if text[i] == "\n":
            line += 1
        i += 1
    return tokens


def skeleton_twee(text, text_macros):
    return [t for t, _ in _tokens_twee(text, text_macros)]


def skeleton_js(text, allowed_props=("counter",)):
    out = []
    n = len(text)
    i = 0
    while i < n:
        c = text[i]
        if text.startswith("//", i):
            end = text.find("\n", i)
            i = n if end < 0 else end
            continue
        if text.startswith("/*", i):
            end = text.find("*/", i + 2)
            i = n if end < 0 else end + 2
            continue
        if c in "\"'`":
            quote = c
            out.append(c)
            i += 1
            while i < n:
                d = text[i]
                if d == "\\":
                    i += 2
                    continue
                if d == quote:
                    break
                if quote != "`" and d == "\n":
                    break
                i += 1
            out.append(quote)
            i += 1
            continue
        out.append(c)
        i += 1
    allowed = re.compile(r"^\s*(?:%s)\s*:\s*(?:\"\"|'')\s*,?\s*$" % "|".join(re.escape(p) for p in allowed_props))
    lines = []
    for raw in "".join(out).splitlines():
        s = re.sub(r"[ \t]+", " ", raw).rstrip()
        if not s.strip() or allowed.match(s):
            continue
        lines.append(s)
    return "\n".join(lines)


def josa_violations(before, after):
    b, a = before.splitlines(), after.splitlines()
    found = []
    for tag, i1, i2, j1, j2 in difflib.SequenceMatcher(None, b, a, autojunk=False).get_opcodes():
        if tag not in ("insert", "replace"):
            continue
        for j in range(j1, j2):
            for marker in JOSA_RE.findall(a[j]):
                if marker[1:-1] not in ALLOWED_JOSA:
                    found.append((j + 1, marker))
    return found


def prose_lines(text):
    return sum(1 for l in text.splitlines() if has_prose([l]))


@dataclass
class Result:
    path: str
    ok: bool
    reason: str = ""
    line: int = None
    remaining_prose: int = 0


def _first_diff(a, b):
    k = 0
    while k < len(a) and k < len(b) and a[k] == b[k]:
        k += 1
    return k


def check_file(rel, base_text, new_text, text_macros):
    ext = os.path.splitext(rel)[1].lower()
    remaining = 0 if ext == ".css" else prose_lines(new_text)
    if base_text is not None:
        viol = josa_violations(base_text, new_text)
        if viol:
            return Result(rel, False, "josa: " + ", ".join(m for _, m in viol[:5]), viol[0][0], remaining)
        if ext == ".twee":
            ta, tb = _tokens_twee(base_text, text_macros), _tokens_twee(new_text, text_macros)
            a, b = [t for t, _ in ta], [t for t, _ in tb]
            if a != b:
                k = _first_diff(a, b)
                ctx = lambda toks: " ".join(toks[max(0, k - 3):k + 3])
                line = tb[k][1] if k < len(tb) else (tb[-1][1] if tb else None)
                return Result(rel, False, "structure differs at token %d: before [%s] | after [%s]" % (k, ctx(a), ctx(b)), line, remaining)
        elif ext == ".js":
            a, b = skeleton_js(base_text), skeleton_js(new_text)
            if a != b:
                la, lb = a.splitlines(), b.splitlines()
                k = _first_diff(la, lb)
                return Result(rel, False, "code differs: before %r | after %r" % (la[k] if k < len(la) else "", lb[k] if k < len(lb) else ""), k + 1, remaining)
        elif ext == ".css":
            if base_text != new_text:
                return Result(rel, False, "css files must not change", None, 0)
        else:
            if base_text != new_text:
                return Result(rel, False, "unknown file type changed", None, remaining)
    else:
        viol = [(i + 1, m) for i, l in enumerate(new_text.splitlines()) for m in JOSA_RE.findall(l) if m[1:-1] not in ALLOWED_JOSA]
        if viol:
            return Result(rel, False, "josa: " + ", ".join(m for _, m in viol[:5]), viol[0][0], remaining)
    return Result(rel, True, "", None, remaining)


def _git_show(ref, path):
    top = subprocess.run(["git", "rev-parse", "--show-toplevel"], capture_output=True, text=True).stdout.strip()
    rel = os.path.relpath(os.path.abspath(path), top).replace(os.sep, "/")
    res = subprocess.run(["git", "show", "%s:%s" % (ref, rel)], capture_output=True)
    if res.returncode != 0:
        return None
    return res.stdout.decode("utf-8", "replace")


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("files", nargs="+")
    parser.add_argument("--text-macros", default="translation/text-macros.txt")
    parser.add_argument("--base-ref", default="HEAD")
    args = parser.parse_args(argv)
    text_macros = load_text_macros(args.text_macros)
    failed = 0
    for path in args.files:
        with open(path, encoding="utf-8", errors="replace") as f:
            new_text = f.read()
        base_text = _git_show(args.base_ref, path)
        r = check_file(path, base_text, new_text, text_macros)
        if r.ok and path.endswith(".js"):
            node = subprocess.run(["node", "--check", path], capture_output=True, text=True)
            if node.returncode != 0:
                r = Result(path, False, "node --check: " + node.stderr.strip().splitlines()[-1][:200], None, r.remaining_prose)
        if r.ok:
            print("ok %s (english lines left: %d)%s" % (path, r.remaining_prose, "" if base_text is not None else " [new file]"))
        else:
            failed += 1
            print("FAIL %s: %s%s" % (path, r.reason, " (line %d)" % r.line if r.line else ""))
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
