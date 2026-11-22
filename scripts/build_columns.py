"""Build data/columns.json from the weekly columns in data/columns/*.md (League Now > From the press box).

Each column is a markdown file with a short header between --- lines:
  title, kicker (e.g. "Week 8 preview"), author (key in data/columns/columnists.json),
  season, week, date (YYYY-MM-DD), teaser
  and optionally a lead photo: image (path, e.g. assets/columns/x.jpg), caption, credit
A line "@by <key>" starts a section by another columnist (multi-voice pieces like the trade desk).
FBP team names in game headers (### lines) and table cells get the team's logo in front (data/teams.json).
Run after adding or editing a column: python scripts/build_columns.py  (needs `pip install markdown`)
"""
import json, os, re, glob, markdown

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DIR = os.path.join(ROOT, 'data', 'columns')


def byline(key, people):
    # "@by <key>" on its own line: a small columnist byline at the top of that section
    a = people.get(key, {'name': key})
    ini = ''.join(w[0] for w in a.get('name', '?').split())[:2]
    av = f'<img class="col-av" src="{a["photo"]}" alt="">' if a.get('photo') else f'<span class="col-av" aria-hidden="true">{ini}</span>'
    return f'\n<div class="col-secby">{av}<span><b>{a.get("name", key)}</b><small>{a.get("title", "")}</small></span></div>\n'


def team_logos():
    # current team names -> logo path; markdown writes "&" as "&amp;", so match both
    teams = (json.load(open(os.path.join(ROOT, 'data', 'teams.json'))) or {}).get('teams', {})
    names = {s['id']: s['name'] for s in json.load(open(os.path.join(ROOT, 'data', 'league-now.json'))).get('standings', [])}
    out = {}
    for fid, n in names.items():
        if teams.get(fid, {}).get('logo'):
            out[n] = out[n.replace('&', '&amp;')] = teams[fid]['logo']
    return out


def add_logos(html, logos):
    if not logos:
        return html
    pat = re.compile('|'.join(re.escape(n) for n in sorted(logos, key=len, reverse=True)))
    tag = lambda m: f'<img class="col-tl" src="{logos[m.group(0)]}" alt="">{m.group(0)}'
    inner = lambda m: m.group(1) + pat.sub(tag, m.group(2)) + m.group(3)
    html = re.sub(r'(<h3>)(.*?)(</h3>)', inner, html)
    return re.sub(r'(<td>)(.*?)(</td>)', inner, html)


def parse(path, people={}, logos={}):
    text = open(path, encoding='utf-8').read()
    m = re.match(r'^---\n(.*?)\n---\n(.*)$', text, re.S)
    meta, body = ({}, text) if not m else (dict(l.split(':', 1) for l in m.group(1).splitlines() if ':' in l), m.group(2))
    meta = {k.strip(): v.strip() for k, v in meta.items()}
    body = re.sub(r'^@by (\w+)\s*$', lambda m: byline(m.group(1), people), body, flags=re.M)
    html = markdown.markdown(body, extensions=['tables', 'sane_lists'])
    html = add_logos(html, logos)
    html = html.replace('<table>', '<div class="card tbl-wrap"><table class="tbl col-t">').replace('</table>', '</table></div>')
    slug = os.path.splitext(os.path.basename(path))[0]
    words = len(re.findall(r'\w+', body))
    return dict(slug=slug, title=meta.get('title', slug), kicker=meta.get('kicker', ''), author=meta.get('author', ''),
                season=int(meta.get('season', 0) or 0), week=int(meta.get('week', 0) or 0), date=meta.get('date', ''),
                teaser=meta.get('teaser', ''), image=meta.get('image', ''), caption=meta.get('caption', ''),
                credit=meta.get('credit', ''), focus=meta.get('focus', ''), minutes=max(1, round(words / 230)), html=html)


def main():
    people = json.load(open(os.path.join(DIR, 'columnists.json')))
    logos = team_logos()
    cols = sorted((parse(p, people, logos) for p in glob.glob(os.path.join(DIR, '*.md'))), key=lambda c: (c['date'], c['slug']), reverse=True)
    json.dump(dict(columnists=people, columns=cols), open(os.path.join(ROOT, 'data', 'columns.json'), 'w'), indent=1, ensure_ascii=False)
    print(f'columns.json: {len(cols)} column(s)')


if __name__ == '__main__':
    main()
