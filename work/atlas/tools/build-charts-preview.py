"""Build a local chart experiment in the real window manager, with isolated sample data."""
from pathlib import Path
import sys
sys.dont_write_bytecode = True
from release_layout import LOCAL, write_changed

ROOT = Path(__file__).resolve().parents[1]
files = ['packages/core/metadata.js', 'packages/core/overlays.js', 'packages/core/province-topology.js',
         'packages/core/index.js', 'packages/ui/controls.js',
         'packages/ui/color-scale-model.js', 'packages/ui/color-scale.js',
         'packages/ui/data-view.js', 'packages/ui/components.js',
         'packages/ui/windows.js', 'packages/ui/chart-model.js', 'packages/ui/chart-extra.js',
         'packages/ui/charts.js', 'packages/ui/table.js', 'tools/chart-gallery.js', 'tools/charts-preview.js']
code = '\n;\n'.join((ROOT / f).read_text() for f in files)
styles = '\n'.join((ROOT / f).read_text() for f in
                   ['style.css', 'packages/ui/data-view.css', 'packages/ui/color-scale.css',
                    'packages/ui/charts.css', 'packages/ui/table.css', 'tools/charts-preview.css'])
html = f'''<!doctype html><html lang="ru"><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>АТЛАС — диаграммы и таблица</title><style>{styles}</style>
<div class="charts-preview-shell">
<header id="chart-toolbar" class="charts-preview-toolbar"></header>
<main class="charts-preview-scroll"><div id="chart-desktop" class="charts-preview-desktop"></div></main>
<footer class="shell-footer"><span id="chart-status" class="status-text">Тестовые данные · 10 px / 16 px · Окна можно двигать, объединять и менять их размер</span></footer>
</div><script>{code}</script></html>'''
target = LOCAL / 'previews/charts-preview.html'
write_changed(target, html)
print(f'Built {target}: {len(html.encode()):,} bytes')
tree_html = html.replace('<html lang="ru">', '<html lang="ru" data-preview="tree">').replace(
    '<title>АТЛАС — диаграммы и таблица</title>', '<title>АТЛАС — дерево с таблицами и диаграммами</title>')
tree_target = LOCAL / 'previews/charts-tree-preview.html'
write_changed(tree_target, tree_html)
print(f'Built {tree_target}: {len(tree_html.encode()):,} bytes')
gallery_html = html.replace('<html lang="ru">', '<html lang="ru" data-preview="gallery">').replace(
    '<title>АТЛАС — диаграммы и таблица</title>', '<title>АТЛАС — восемь видов диаграмм</title>')
gallery_target = LOCAL / 'previews/charts-gallery-preview.html'
write_changed(gallery_target, gallery_html)
print(f'Built {gallery_target}: {len(gallery_html.encode()):,} bytes')
