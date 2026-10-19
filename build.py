from pathlib import Path
ROOT=Path(__file__).parent
html=(ROOT/'page.html').read_text()
code='\n;\n'.join((ROOT/f).read_text() for f in ['core.js','viewer.js','territory-painter.js','app.js'])
assert '</script' not in code.lower()
html=html.replace('/*__CSS__*/',(ROOT/'style.css').read_text()).replace('/*__DATA__*/',(ROOT/'default-project.json').read_text().replace('<','\\u003c')).replace('/*__JS__*/',code)
(ROOT/'dist'/'index.html').write_text(html)
print(f'Built standalone HTML: {len(html.encode()):,} bytes')
