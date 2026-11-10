"""Source-level regression guards for the Herm feature gating.

The game JS cannot run outside SugarCube, so these tests pin the gating text
that keeps non-herm builds behaving like the plain translation: the herm
chance settings must not be randomised, imported, exported, or named in the
preset preview unless `setup.features?.herm` is set.

Structure follows English 0.5.13.8, where settings import/export/randomise
are explicit code in save.js (applyGameplaySettings, settingsToExportObject,
randomiseEncounterSettings, settingNameFromVarName).
"""
import os
import re
import unittest

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


def read(rel):
    with open(os.path.join(REPO, rel), encoding="utf-8") as f:
        return f.read()


def function_body(source, header):
    """Text of the top-level function starting with `header` up to its closing brace."""
    start = source.index(header)
    depth = 0
    for i in range(start, len(source)):
        if source[i] == "{":
            depth += 1
        elif source[i] == "}":
            depth -= 1
            if depth == 0:
                return source[start:i + 1]
    raise AssertionError("unterminated function: " + header)


def herm_gated_block(body):
    """The `if (setup.features?.herm) { ... }` block inside body."""
    m = re.search(r"if \(setup\.features\?\.herm\) \{(.*?)\n\t\}", body, re.S)
    assert m, "no herm-gated block in:\n" + body[:300]
    return m.group(1)


class HermGatingTests(unittest.TestCase):
    def test_herm_chances_randomize_only_in_herm_builds(self):
        body = function_body(read("game/03-JavaScript/save.js"), "function randomiseEncounterSettings()")
        gated = herm_gated_block(body)
        for key in ("femaleNPCHermChance", "maleNPCHermChance"):
            self.assertIn("V.settings.%s = random(0, 100);" % key, gated, key)
            self.assertEqual(len(re.findall(r"\b%s\b" % key, body)), 1, key + " must appear only inside the gated block")

    def test_import_applies_herm_chances_only_in_herm_builds(self):
        body = function_body(read("game/03-JavaScript/save.js"), "function applyGameplaySettings(settings)")
        gated = herm_gated_block(body)
        for key in ("femaleNPCHermChance", "maleNPCHermChance"):
            self.assertIn("V.settings.%s = settings.%s ?? V.settings.%s;" % (key, key, key), gated, key)
            self.assertEqual(len(re.findall(r"\b%s\b" % key, body)), 3, key + " must appear only inside the gated block")

    def test_export_includes_herm_chances_only_in_herm_builds(self):
        body = function_body(read("game/03-JavaScript/save.js"), "function settingsToExportObject()")
        self.assertRegex(body, re.compile(
            r"\.\.\.\(setup\.features\?\.herm\s*\?\s*\{\s*femaleNPCHermChance: V\.settings\.femaleNPCHermChance,"
            r"\s*maleNPCHermChance: V\.settings\.maleNPCHermChance,?\s*\}\s*:\s*\{\}\)", re.S))

    def test_preset_preview_names_herm_chances_only_in_herm_builds(self):
        save = read("game/03-JavaScript/save.js")
        body = function_body(save, "window.settingNameFromVarName = function (varName)")
        for key in ("femaleNPCHermChance", "maleNPCHermChance"):
            self.assertRegex(body, re.compile(r'case "%s":\s*return setup\.features\?\.herm \? "[^"]+" : varName;' % key))

    def test_preset_preview_skips_herm_chances_outside_herm_builds(self):
        presets = read("game/04-Variables/presets.twee")
        widget = presets[presets.index('<<widget "settingsPreviewGroup">>'):]
        widget = widget[:widget.index("<</widget>>")]
        self.assertIn('<<if !setup.features?.herm and (_key is "femaleNPCHermChance" or _key is "maleNPCHermChance")>><<continue>><</if>>', widget)

    def test_settings_ui_sliders_are_gated(self):
        settings = read("game/base-system/settings.twee")
        for key in ("femaleNPCHermChance", "maleNPCHermChance"):
            i = settings.index('<<numberslider "$settings.%s"' % key)
            before = settings[:i]
            self.assertLess(before.rfind("<<if setup.features?.herm>>"), i)
            self.assertGreater(before.rfind("<<if setup.features?.herm>>"), before.rfind("<</if>>"), key)
        self.assertIn(
            '<<if $debug or setup.features?.herm or $NPCName[_npcId].gender is "h">>'
            '| <label><<radiovar "$NPCName[_npcId].gender" "h">><<nnpcGenderSetByHand _npcId>><</radiovar>> 양성</label><</if>>',
            settings,
        )

    def test_new_game_defaults_herm_chances_to_zero(self):
        start = read("game/04-Variables/variables-start.twee")
        self.assertIn("<<set $settings.femaleNPCHermChance to 0>>", start)
        self.assertIn("<<set $settings.maleNPCHermChance to 0>>", start)

    def test_version_update_resets_outside_herm_builds(self):
        vu = read("game/04-Variables/variables-versionUpdate.twee")
        block = vu[vu.index("<<if setup.features?.herm>>"):]
        block = block[:block.index("<</if>>")]
        self.assertIn("<<set $settings.femaleNPCHermChance ??= 0>>", block)
        self.assertIn("<<else>>", block)
        self.assertIn("<<set $settings.femaleNPCHermChance to 0>>", block)
        self.assertIn("<<set $settings.maleNPCHermChance to 0>>", block)


if __name__ == "__main__":
    unittest.main()
