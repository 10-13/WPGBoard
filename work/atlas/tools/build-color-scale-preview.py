"""A standalone preview made from the actual shared UI sources, without game data."""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
files = [
    'packages/core/metadata.js', 'packages/core/overlays.js',
    'packages/core/province-topology.js', 'packages/core/index.js',
    'packages/ui/tree-menu.js', 'packages/ui/controls.js',
    'packages/ui/color-scale-model.js', 'packages/ui/color-scale.js',
    'packages/ui/data-view.js', 'packages/ui/windows.js',
    'tools/color-scale-preview.js',
]
styles = '\n'.join((ROOT / f).read_text() for f in [
    'style.css', 'packages/ui/data-view.css', 'packages/ui/color-scale.css',
])
styles += '''
#workspace { position:absolute; inset:16px 0 0; overflow:hidden; background:#17262e }
#menubar { height:16px; display:flex }
.scale-preview-content { display:grid; gap:16px; min-width:0 }
.scale-preview-point { display:grid; grid-template-columns:minmax(0,1fr) 32px 60px 16px; gap:4px; min-height:16px }
.scale-preview-point input[type=color] { width:32px }
.scale-preview-json { margin:0; white-space:pre-wrap; overflow-wrap:anywhere }
.scale-preview-content .form-error:empty { display:none }
'''
code = '\n;\n'.join((ROOT / f).read_text() for f in files)
html = f'''<!doctype html><html lang="ru"><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>АТЛАС — цветовые шкалы</title><style>{styles}</style>
<nav id="menubar" class="shell-menubar"></nav><main id="workspace"></main>
<script>{code}</script></html>'''
target = ROOT.parent.parent / 'outputs/color-scales-preview.html'
target.write_text(html)
(ROOT / 'dist/color-scales-preview.html').write_text(html)
print(f'Built {target.name}: {len(html.encode()):,} bytes')
