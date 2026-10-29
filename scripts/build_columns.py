"""Build data/columns.json from the weekly columns in data/columns/*.md (League Now > From the press box).

Each column is a markdown file with a short header between --- lines:
  title, kicker (e.g. "Week 8 preview"), author (key in data/columns/columnists.json),
  season, week, date (YYYY-MM-DD), teaser
Run after adding or editing a column: python scripts/build_columns.py  (needs `pip install markdown`)
"""
import json, os, re, glob, markdown

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DIR = os.path.join(ROOT, 'data', 'columns')


def parse(path):
    text = open(path, encoding='utf-8').read()
    m = re.match(r'^---\n(.*?)\n---\n(.*)$', text, re.S)
    meta, body = ({}, text) if not m else (dict(l.split(':', 1) for l in m.group(1).splitlines() if ':' in l), m.group(2))
    meta = {k.strip(): v.strip() for k, v in meta.items()}
    html = markdown.markdown(body, extensions=['tables', 'sane_lists'])
    html = html.replace('<table>', '<div class="card tbl-wrap"><table class="tbl col-t">').replace('</table>', '</table></div>')
    slug = os.path.splitext(os.path.basename(path))[0]
    words = len(re.findall(r'\w+', body))
    return dict(slug=slug, title=meta.get('title', slug), kicker=meta.get('kicker', ''), author=meta.get('author', ''),
                season=int(meta.get('season', 0) or 0), week=int(meta.get('week', 0) or 0), date=meta.get('date', ''),
                teaser=meta.get('teaser', ''), minutes=max(1, round(words / 230)), html=html)


def main():
    cols = sorted((parse(p) for p in glob.glob(os.path.join(DIR, '*.md'))), key=lambda c: (c['date'], c['slug']), reverse=True)
    people = json.load(open(os.path.join(DIR, 'columnists.json')))
    json.dump(dict(columnists=people, columns=cols), open(os.path.join(ROOT, 'data', 'columns.json'), 'w'), indent=1, ensure_ascii=False)
    print(f'columns.json: {len(cols)} column(s)')


if __name__ == '__main__':
    main()
