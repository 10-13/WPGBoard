"""Check the Pages publication boundary and project-relative download links."""
from html.parser import HTMLParser
from pathlib import Path
import json
import sys
import tempfile
import unittest

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'tools'))
from release_layout import LOCAL, RELEASES
from pages_site import build_site


class Links(HTMLParser):
    def __init__(self, html):
        super().__init__()
        self.links = []
        self.feed(html)

    def handle_starttag(self, tag, attrs):
        if tag == 'a':
            self.links.append(dict(attrs)['href'])


class PagesTest(unittest.TestCase):
    def setUp(self):
        parent = LOCAL / 'tests'
        parent.mkdir(parents=True, exist_ok=True)
        self.temp = tempfile.TemporaryDirectory(dir=parent)
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.source = self.root / 'outputs'
        self.data = self.root / 'data'
        self.site = self.root / 'site'
        self.source.mkdir()
        self.data.mkdir()
        for release in RELEASES:
            raw = json.dumps({'saveKey': release['id'], 'history': {'note': '<test>'}})
            (self.data / Path(release['file']).with_suffix('.json')).write_text(raw)
            escaped = raw.replace('<', r'\u003c')
            (self.source / release['file']).write_text(
                '<script id="atlas-data" type="application/json">' + escaped + '</script>')

    def test_only_four_html_and_json_are_published(self):
        (self.source / '_qa.html').write_text('private test party')
        build_site(self.source, self.data, self.site)
        expected = {'index.html', '.nojekyll'}
        for release in RELEASES:
            expected.add(release['file'])
            json_name = Path(release['file']).with_suffix('.json').name
            expected.add(json_name)
            self.assertEqual((self.site / release['file']).read_bytes(),
                             (self.source / release['file']).read_bytes())
            self.assertEqual((self.site / json_name).read_bytes(), (self.data / json_name).read_bytes())
        self.assertEqual({p.name for p in self.site.iterdir()}, expected)

    def test_links_work_below_a_project_url(self):
        build_site(self.source, self.data, self.site)
        index = (self.site / 'index.html').read_text()
        self.assertNotIn('/*__CSS__*/', index)
        self.assertNotIn('<!--__RELEASES__-->', index)
        links = [href for href in Links(index).links if not href.startswith('https://')]
        self.assertEqual(len(links), 12)
        for href in links:
            self.assertFalse(href.startswith('/'))
            self.assertTrue((self.site / href).is_file())
        for release in RELEASES:
            self.assertIn(release['title'], index)

    def test_invalid_party_keeps_the_previous_site(self):
        self.site.mkdir()
        (self.site / 'index.html').write_text('previous site')
        (self.data / Path(RELEASES[-1]['file']).with_suffix('.json')).write_text('{"saveKey":"changed"}')
        with self.assertRaises(ValueError):
            build_site(self.source, self.data, self.site)
        self.assertEqual((self.site / 'index.html').read_text(), 'previous site')

    def test_rebuild_removes_stale_staged_files(self):
        self.site.mkdir()
        (self.site / 'old-party.json').write_text('stale')
        build_site(self.source, self.data, self.site)
        self.assertFalse((self.site / 'old-party.json').exists())


if __name__ == '__main__':
    unittest.main(verbosity=2)
