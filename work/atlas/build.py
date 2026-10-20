from pathlib import Path
import json, base64
ROOT=Path(__file__).parent
html=(ROOT/'page.html').read_text()
files=['packages/core/metadata.js','packages/core/overlays.js','packages/core/province-topology.js','packages/core/index.js','packages/statistics/basic.js','packages/ui/tree-menu.js','packages/ui/region-clicks.js','packages/ui/region-selection.js','packages/ui/controls.js','packages/ui/windows.js','packages/ui/overlays.js','packages/ui/map-view.js','packages/ui/data-view.js','packages/ui/index.js','packages/platform/browser.js','extensions/nation-relations.js','extensions/nations-model.js','extensions/nation-borders.js','extensions/nations.js','extensions/regions-model.js','extensions/region-geometry.js','extensions/region-overlay.js','extensions/regions.js','extensions/history.js','extensions/files.js','extensions/metadata.js','extensions/resource-flow.js','extensions/resources-model.js','extensions/resource-catalog-data.js','extensions/resource-colors.js','extensions/resource-catalog.js','extensions/resource-catalog-ui.js','extensions/resource-richness.js','extensions/resource-markers.js','extensions/resource-overlay.js','extensions/resources.js','app.js']
code='\n;\n'.join((ROOT/f).read_text() for f in files)
assert '</script' not in code.lower()
data=json.loads((ROOT/'default-project.json').read_text())
original=ROOT/'assets'/'original-map.png'
if not data.get('originalImage') and original.exists(): data['originalImage']='data:image/png;base64,'+base64.b64encode(original.read_bytes()).decode()
elif not data.get('originalImage'): raise FileNotFoundError('Add originalImage to default-project.json.')
styles='\n'.join((ROOT/f).read_text() for f in ['style.css','packages/ui/data-view.css'])
html=html.replace('/*__CSS__*/',styles).replace('/*__DATA__*/',json.dumps(data,ensure_ascii=False,separators=(',',':')).replace('<','\\u003c')).replace('/*__JS__*/',code)
(ROOT/'dist'/'index.html').write_text(html)
print(f'Built standalone HTML: {len(html.encode()):,} bytes')
