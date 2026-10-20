"""Apply the current standalone UI without regenerating parties or their save keys.

Run build.py first. The embedded JSON is copied byte-for-byte from each existing
HTML; the authored geography/economy generators are intentionally not invoked.
"""
from pathlib import Path
import json
import re

ROOT = Path(__file__).resolve().parents[1]
OUTPUTS = ROOT.parent.parent / 'outputs'
DATA = re.compile(r'(<script id="atlas-data" type="application/json">)(.*?)(</script>)', re.S)
PARTIES = ('workspace', 'campaign', 'atlas', 'atlas-1936', 'atlas-1936-import', 'atlas-1936-economy')


def main():
    template = (ROOT / 'dist/index.html').read_text()
    if len(DATA.findall(template)) != 1:
        raise ValueError('Standalone template must have one embedded party.')
    prepared = []
    for name in PARTIES:
        target = OUTPUTS / (name + '.html')
        matches = list(DATA.finditer(target.read_text()))
        if len(matches) != 1:
            raise ValueError(f'{name}: expected one embedded party.')
        data = matches[0].group(2)
        party = json.loads(data)
        save_key = party.get('saveKey') or party.get('saveId')
        if not save_key:
            raise ValueError(f'{name}: missing autosave key.')
        updated, count = DATA.subn(lambda match: match[1] + data + match[3], template)
        assert count == 1 and DATA.search(updated)[2] == data
        prepared.append((target, updated, save_key))
    for target, updated, save_key in prepared:
        target.write_text(updated)
        (ROOT / 'dist' / target.name).write_text(updated)
        print(f'Updated {target.name}; embedded data and saveKey preserved: {save_key}')


if __name__ == '__main__':
    main()
