"""Build the actual UI foundation in isolation: no game code, map or party data."""
from pathlib import Path
import sys
sys.dont_write_bytecode = True
from release_layout import LOCAL, write_changed
ROOT = Path(__file__).resolve().parents[1]
files = ['packages/ui/controls.js', 'packages/ui/color-scale-model.js',
         'packages/ui/color-scale.js', 'packages/ui/data-view.js',
         'packages/ui/components.js', 'tools/components-preview.js']
code = '\n;\n'.join((ROOT / f).read_text() for f in files)
styles = '\n'.join((ROOT / f).read_text() for f in
                   ['style.css', 'packages/ui/data-view.css', 'packages/ui/color-scale.css'])
styles += '''
body { overflow:auto; background:#17262e }
#components { padding:16px; max-width:1280px; margin:auto }
.component-grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(min(280px,100%),1fr)); gap:16px; margin-top:16px; align-items:start }
.component-grid>.atlas-data-group { min-width:0 }
.component-grid .data-children { min-width:0 }
'''
html = f'''<!doctype html><html lang="ru"><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>АТЛАС — базовые компоненты интерфейса</title><style>{styles}</style>
<main id="components" class="atlas-data-scope"></main><script>{code}</script></html>'''
target = LOCAL / 'previews/ui-components-preview.html'
write_changed(target, html)
print(f'Built {target}: {len(html.encode()):,} bytes')
