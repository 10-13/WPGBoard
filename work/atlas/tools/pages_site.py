"""Stage only the four map releases, their JSON and a small landing page."""
from pathlib import Path
from html import escape
import shutil

from release_layout import ROOT, LOCAL, OUTPUTS, RELEASE_DATA, RELEASES, party_data


def build_site(source_dir=OUTPUTS, data_dir=RELEASE_DATA, site_dir=LOCAL / 'pages/site'):
    site_dir = Path(site_dir)
    if site_dir.resolve() == LOCAL.resolve() or not site_dir.resolve().is_relative_to(LOCAL.resolve()):
        raise ValueError('Pages staging must be a subdirectory of .local.')
    prepared = []
    rows = []
    for release in RELEASES:
        filename = release['file']
        json_name = Path(filename).with_suffix('.json').name
        raw = (data_dir / json_name).read_text()
        html = (source_dir / filename).read_text()
        if party_data(html) != raw.replace('<', r'\u003c'):
            raise ValueError(f'{filename}: HTML and release JSON differ.')
        prepared.extend(((filename, html), (json_name, raw)))
        title = escape(release['title'])
        description = escape(release['description'])
        link = escape(filename, quote=True)
        json_link = escape(json_name, quote=True)
        rows.append(f'''<section aria-label="{title}">
  <h2 class="section-line"><span>{title}</span></h2>
  <p>{description}</p>
  <div class="form-actions">
    <a class="pages-button pages-open" href="{link}">Открыть</a>
    <a class="pages-button" href="{link}" download>Скачать HTML</a>
    <a class="pages-button" href="{json_link}" download>Скачать JSON</a>
  </div>
</section>''')
    template = (ROOT / 'pages/index.html').read_text()
    css = (ROOT / 'style.css').read_text()
    index = template.replace('/*__CSS__*/', css).replace('<!--__RELEASES__-->', '\n'.join(rows))
    # Validate every party before replacing the disposable staging directory.
    if site_dir.exists():
        shutil.rmtree(site_dir)
    site_dir.mkdir(parents=True)
    for filename, content in prepared + [('index.html', index), ('.nojekyll', '')]:
        (site_dir / filename).write_text(content)
    return site_dir
