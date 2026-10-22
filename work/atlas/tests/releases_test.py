"""Release builds preserve authored data and keep scratch files out of outputs."""
from pathlib import Path
import json
import sys
import tempfile
import unittest

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'tools'))
from release_layout import LOCAL, RELEASES, embed_party, party_data, update_releases

TEMPLATE = '<html><script id="atlas-data" type="application/json">{"saveKey":"template"}</script>new UI</html>'


class ReleasesTest(unittest.TestCase):
    def setUp(self):
        scratch = LOCAL / 'tests'
        scratch.mkdir(parents=True, exist_ok=True)
        self.temp = tempfile.TemporaryDirectory(dir=scratch)
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.data = self.root / 'data'
        self.outputs = self.root / 'outputs'
        self.data.mkdir()
        self.outputs.mkdir()
        for release in RELEASES:
            # Preserve deliberate whitespace, history and literal escape sequences.
            raw = json.dumps({'saveKey': release['id'], 'history': {'meta': '\\u2603'}} , indent=2)
            (self.data / Path(release['file']).with_suffix('.json')).write_text(raw)
            (self.outputs / release['file']).write_text(embed_party(TEMPLATE.replace('new UI', 'old UI'), raw))

    def test_refresh_preserves_raw_parties_and_is_idempotent(self):
        before = {p.name: party_data(p.read_text()) for p in self.outputs.iterdir()}
        update_releases(TEMPLATE, self.outputs, self.data)
        for file in self.outputs.iterdir():
            self.assertEqual(party_data(file.read_text()), before[file.name])
            self.assertIn('new UI', file.read_text())
        timestamps = {p.name: p.stat().st_mtime_ns for p in self.outputs.iterdir()}
        update_releases(TEMPLATE, self.outputs, self.data)
        self.assertEqual(timestamps, {p.name: p.stat().st_mtime_ns for p in self.outputs.iterdir()})

    def test_builds_all_four_from_json_without_existing_html(self):
        for file in self.outputs.iterdir():
            file.unlink()
        update_releases(TEMPLATE, self.outputs, self.data)
        self.assertEqual({p.name for p in self.outputs.iterdir()}, {r['file'] for r in RELEASES})

    def test_invalid_last_party_leaves_every_release_unchanged(self):
        before = {p.name: p.read_bytes() for p in self.outputs.iterdir()}
        (self.data / Path(RELEASES[-1]['file']).with_suffix('.json')).write_text('{"saveKey":null}')
        with self.assertRaises(ValueError):
            update_releases(TEMPLATE, self.outputs, self.data, replace_data=True)
        self.assertEqual(before, {p.name: p.read_bytes() for p in self.outputs.iterdir()})

    def test_mismatched_html_requires_explicit_replacement(self):
        file = self.outputs / RELEASES[0]['file']
        file.write_text(embed_party(TEMPLATE, '{"saveKey":"user-party"}'))
        with self.assertRaisesRegex(ValueError, 'HTML and release JSON differ'):
            update_releases(TEMPLATE, self.outputs, self.data)
        self.assertEqual(json.loads(party_data(file.read_text()))['saveKey'], 'user-party')
        update_releases(TEMPLATE, self.outputs, self.data, replace_data=True)
        self.assertEqual(json.loads(party_data(file.read_text()))['saveKey'], RELEASES[0]['id'])

    def test_extra_output_is_rejected_without_deletion(self):
        file = self.outputs / 'report.txt'
        file.write_text('local report')
        with self.assertRaisesRegex(ValueError, 'Move non-release files into .local'):
            update_releases(TEMPLATE, self.outputs, self.data)
        self.assertEqual(file.read_text(), 'local report')


if __name__ == '__main__':
    unittest.main(verbosity=2)
