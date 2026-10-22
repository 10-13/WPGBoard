"""Build four standalone releases without regenerating their authored game data."""
from pathlib import Path
import argparse
import base64
import json
import sys

sys.dont_write_bytecode = True
from tools.release_layout import ROOT, LOCAL, RELEASES, RELEASE_DATA, update_releases, write_changed

FILES = [
    'packages/core/metadata.js',
    'packages/core/overlays.js',
    'packages/core/province-topology.js',
    'packages/core/index.js',
    'packages/statistics/basic.js',
    'packages/ui/tree-menu.js',
    'packages/ui/region-clicks.js',
    'packages/ui/region-selection.js',
    'packages/ui/controls.js',
    'packages/ui/color-scale-model.js',
    'packages/ui/color-scale.js',
    'packages/ui/windows.js',
    'packages/ui/overlays.js',
    'packages/ui/simple-overlay.js',
    'packages/ui/map-view.js',
    'packages/ui/data-view.js',
    'packages/ui/components.js',
    'packages/ui/overlay-scope.js',
    'packages/ui/extensions.js',
    'packages/ui/index.js',
    'packages/platform/browser.js',
    'extensions/nation-relations.js',
    'extensions/nations-model.js',
    'extensions/nation-borders.js',
    'extensions/territorial-control-model.js',
    'extensions/territorial-control.js',
    'extensions/nations.js',
    'extensions/regions-model.js',
    'extensions/region-geometry.js',
    'extensions/region-overlay.js',
    'extensions/regions.js',
    'extensions/history.js',
    'extensions/files.js',
    'extensions/metadata.js',
    'extensions/resource-flow.js',
    'extensions/resources-model.js',
    'extensions/resource-catalog-data.js',
    'extensions/resource-colors.js',
    'extensions/resource-catalog.js',
    'extensions/resource-catalog-ui.js',
    'extensions/resource-richness.js',
    'extensions/resource-markers.js',
    'extensions/resource-overlay.js',
    'extensions/resource-bonuses.js',
    'extensions/resource-bonus-overlay.js',
    'extensions/resources.js',
    'extensions/geography-data.js',
    'extensions/geography-model.js',
    'extensions/geography-ui.js',
    'extensions/geography-time-ui.js',
    'extensions/geography.js',
    'app.js',
]


def build_template():
    html = (ROOT / 'page.html').read_text()
    code = '\n;\n'.join((ROOT / f).read_text() for f in FILES)
    if '</script' in code.lower():
        raise ValueError('Application code must not close its script element.')
    data = json.loads((ROOT / 'default-project.json').read_text())
    if not data.get('originalImage'):
        original = ROOT / 'assets/original-map.png'
        data['originalImage'] = 'data:image/png;base64,' + base64.b64encode(original.read_bytes()).decode()
    styles = '\n'.join((ROOT / f).read_text() for f in
                       ['style.css', 'packages/ui/data-view.css', 'packages/ui/color-scale.css'])
    seed = (ROOT / 'assets/environment-geography.json').read_text().replace('<', r'\u003c')
    raw = json.dumps(data, ensure_ascii=False, separators=(',', ':')).replace('<', r'\u003c')
    return (html.replace('/*__GEOGRAPHY_DATA__*/', seed).replace('/*__CSS__*/', styles)
                .replace('/*__DATA__*/', raw).replace('/*__JS__*/', code))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--template-only', action='store_true', help='Build only .local/build/index.html')
    parser.add_argument('--party-data', type=Path,
                        help='Explicitly replace release parties from four JSON files in this directory')
    args = parser.parse_args()
    if args.template_only and args.party_data:
        parser.error('--party-data cannot be used with --template-only')
    template = build_template()
    paths = [] if args.template_only else update_releases(
        template, data_dir=args.party_data or RELEASE_DATA, replace_data=args.party_data is not None)
    if args.party_data is not None:
        for release in RELEASES:
            name = Path(release['file']).with_suffix('.json').name
            write_changed(RELEASE_DATA / name, (args.party_data / name).read_text())
    write_changed(LOCAL / 'build/index.html', template)
    for path in paths:
        print(f'Built {path.name}: {path.stat().st_size:,} bytes')
    print('Temporary template: .local/build/index.html')


if __name__ == '__main__':
    main()
