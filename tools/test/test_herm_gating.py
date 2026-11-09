"""Source-level regression guards for the Herm feature gating.

The game JS cannot run outside SugarCube, so these tests pin the gating text
that keeps non-herm builds behaving like the plain translation: the herm
chance settings must not be randomised, imported, or shown in the preset
preview unless `setup.features?.herm` is set.
"""
import os
import re
import unittest

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


def read(rel):
    with open(os.path.join(REPO, rel), encoding="utf-8") as f:
        return f.read()


class HermGatingTests(unittest.TestCase):
    def test_herm_chances_randomize_only_in_herm_builds(self):
        save = read("game/03-JavaScript/save.js")
        for key in ("femaleNPCHermChance", "maleNPCHermChance"):
            line = next(l for l in save.splitlines() if l.strip().startswith(key + ":"))
            self.assertIn('randomize: setup.features?.herm ? "encounter" : undefined', line, key)

    def test_import_drops_herm_chances_outside_herm_builds(self):
        save = read("game/03-JavaScript/save.js")
        body = save[save.index("function importSettingsData("):save.index("function exportSettings", save.index("function importSettingsData("))] \
            if "function exportSettings" in save else save[save.index("function importSettingsData("):]
        self.assertIn("!setup.features?.herm", body)
        self.assertIn("delete overrides.general.settings.femaleNPCHermChance", body)
        self.assertIn("delete overrides.general.settings.maleNPCHermChance", body)

    def test_preset_preview_hides_herm_chances_outside_herm_builds(self):
        presets = read("game/04-Variables/presets.twee")
        self.assertRegex(
            presets,
            re.compile(r'\$_label is "femaleNPCHermChance" or \$_label is "maleNPCHermChance"\) and !setup\.features\?\.herm'),
        )

    def test_settings_ui_sliders_are_gated(self):
        settings = read("game/base-system/settings.twee")
        for key in ("femaleNPCHermChance", "maleNPCHermChance"):
            i = settings.index('<<numberslider "$settings.%s"' % key)
            before = settings[:i]
            self.assertLess(before.rfind("<<if setup.features?.herm>>"), i)
            self.assertGreater(before.rfind("<<if setup.features?.herm>>"), before.rfind("<</if>>"), key)
        self.assertIn('<<if $debug is 1 or setup.features?.herm>>| <label><<radiobutton "$NPCName[_npcId].gender" "h"', settings)

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
