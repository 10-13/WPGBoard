"""The four distributable pages; everything generated temporarily lives in .local."""
from pathlib import Path
import json
import re

ROOT = Path(__file__).resolve().parents[1]
WORKSPACE = ROOT.parent.parent
LOCAL = WORKSPACE / '.local'
OUTPUTS = WORKSPACE / 'outputs'
RELEASE_DATA = ROOT / 'releases'
RELEASES = json.loads((ROOT / 'releases.json').read_text())
DATA = re.compile(r'(<script id="atlas-data" type="application/json">)(.*?)(</script>)', re.S)


def party_data(html):
    matches = list(DATA.finditer(html))
    if len(matches) != 1:
        raise ValueError('Expected exactly one embedded party.')
    raw = matches[0][2]
    validate_party(raw)
    return raw


def validate_party(raw):
    party = json.loads(raw)
    if not (party.get('saveKey') or party.get('saveId')):
        raise ValueError('Party must have an autosave key.')


def embed_party(template, raw):
    party_data(template)
    validate_party(raw)
    return DATA.sub(lambda match: match[1] + raw + match[3], template)


def write_changed(path, content):
    if not path.exists() or path.read_text() != content:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content)


def update_releases(template, output_dir=OUTPUTS, data_dir=RELEASE_DATA, replace_data=False):
    """Validate all inputs before writing; ordinary UI updates preserve raw JSON."""
    expected = {release['file'] for release in RELEASES}
    extras = set(path.name for path in output_dir.iterdir()) - expected if output_dir.exists() else set()
    if extras:
        raise ValueError('Move non-release files into .local first: ' + ', '.join(sorted(extras)))
    prepared = []
    for release in RELEASES:
        target = output_dir / release['file']
        raw = (data_dir / target.with_suffix('.json').name).read_text().replace('<', r'\u003c')
        if target.exists() and not replace_data and party_data(target.read_text()) != raw:
            raise ValueError(f'{target.name}: HTML and release JSON differ. Reconcile them explicitly with --party-data.')
        prepared.append((target, embed_party(template, raw)))
    for target, html in prepared:
        write_changed(target, html)
    return [path for path, _ in prepared]
