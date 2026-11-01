#!/usr/bin/env python3
"""Refresh NFL mock-draft data for the rookies on the board (weekly GitHub Action).

For every rookie in the Rookie Pricer's lists, reads his NFL Mock Draft Database page:
  - his pick and team in the 1-week consensus mock (round 1)
  - the picks he went at in mock drafts published in the last 14 days
  - the team he is most often mocked to
Then:
  1. rookie-pricer/sources.json: replaces the NFL Mock Draft Database mock source (consensus pick, or the
     median of 5+ recent mocks) and moves asOf to today; rebuilds players.json and mock-board.json, so
     projected NFL picks and rookie salaries follow the mocks.
  2. data/nfl-landing.json: each rookie's projected NFL team (consensus mock, else the team holding his
     median recent pick in Tankathon's order, else the team he's most often mocked to).
If the site can't be read (or too few pages parse), everything is left as it was. Standard library only.
"""
import json, os, re, statistics, subprocess, sys, time, urllib.request
from datetime import date, datetime, timedelta, timezone
from html.parser import HTMLParser

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PRICER = os.path.join(ROOT, 'rookie-pricer')
BASE = 'https://www.nflmockdraftdatabase.com'
SOURCE_NAME = 'NFL Mock Draft Database consensus mock (1 week) and recent mocks'
TEAMS = {'Cardinals': 'ARI', 'Falcons': 'ATL', 'Ravens': 'BAL', 'Bills': 'BUF', 'Panthers': 'CAR', 'Bears': 'CHI',
         'Bengals': 'CIN', 'Browns': 'CLE', 'Cowboys': 'DAL', 'Broncos': 'DEN', 'Lions': 'DET', 'Packers': 'GB',
         'Texans': 'HOU', 'Colts': 'IND', 'Jaguars': 'JAX', 'Chiefs': 'KC', 'Raiders': 'LV', 'Chargers': 'LAC',
         'Rams': 'LAR', 'Dolphins': 'MIA', 'Vikings': 'MIN', 'Patriots': 'NE', 'Saints': 'NO', 'Giants': 'NYG',
         'Jets': 'NYJ', 'Eagles': 'PHI', 'Steelers': 'PIT', '49ers': 'SF', 'Seahawks': 'SEA', 'Buccaneers': 'TB',
         'Titans': 'TEN', 'Commanders': 'WSH'}
CODE_FIX = {'JAC': 'JAX', 'WAS': 'WSH', 'LA': 'LAR', 'OAK': 'LV', 'SD': 'LAC'}


class Text(HTMLParser):
    def __init__(self):
        super().__init__(); self.out = []
    def handle_data(self, d):
        self.out.append(d)


def page_text(url):
    req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0 (FBP league site; weekly refresh)', 'Accept': 'text/html'})
    with urllib.request.urlopen(req, timeout=30) as r:
        html = r.read().decode('utf-8', 'replace')
    p = Text(); p.feed(html)
    return re.sub(r'\s+', ' ', ' '.join(p.out))


def slug(name):
    return re.sub(r'^-|-$', '', re.sub(r'[^a-z0-9]+', '-', re.sub(r"['.]", '', name.lower())))


def parse(t, today):
    most = (re.search(r'Most Mocked To ([A-Z]{2,3})', t) or [None, ''])[1]
    c = re.search(r'1 Week (\d+) ([A-Za-z0-9 .]+?) ([\d.]+)% of mocks', t)
    start = t.find('Team Mocks')
    end = t.find('Page 1 of', start)
    sect = t[start:end if end > 0 else None] if start >= 0 else ''
    picks = []
    for m in re.finditer(r'(?:^|\s)(\d{1,3}) [^\d]{3,60}? By [^\d]{2,40}? (\d{2})/(\d{2})/(\d{2})', sect):
        d = date(2000 + int(m.group(4)), int(m.group(2)), int(m.group(3)))
        if today - d <= timedelta(days=14):
            picks.append(int(m.group(1)))
    return {'most': CODE_FIX.get(most, most), 'cpick': int(c.group(1)) if c else None,
            'cteam': TEAMS.get(c.group(2).strip()) if c else None, 'picks': picks}


def main():
    today = datetime.now(timezone.utc).date()
    order_doc = json.load(open(os.path.join(ROOT, 'data', 'nfl-draft-order.json')))
    year, order = order_doc.get('season', today.year + 1), order_doc.get('picks', [])
    names = []
    for f in ('mock-board.json', 'players.json'):
        for p in json.load(open(os.path.join(PRICER, f)))['players']:
            if p['name'] not in names:
                names.append(p['name'])
    got, fails = {}, 0
    for n in names:
        try:
            got[n] = parse(page_text(f'{BASE}/players/{year}/{slug(n)}'), today)
        except Exception as e:
            fails += 1
            print(f'  miss {n}: {type(e).__name__}')
        time.sleep(1.5)
    useful = sum(1 for v in got.values() if v['cpick'] or v['picks'] or v['most'])
    print(f'Read {len(got)} of {len(names)} rookie pages ({useful} with mock data)')
    if useful < 8:
        sys.exit('Too little mock data; kept the previous files.')

    picks, land = {}, {}
    team_at = lambda k: order[k - 1]['team'] if 0 < k <= len(order) else None
    for n, v in got.items():
        cons = v['cpick'] and v['cteam'] and team_at(v['cpick']) == v['cteam']   # a stale or odd consensus line doesn't count
        med = round(statistics.median(v['picks'])) if len(v['picks']) >= 5 else None
        if cons:
            picks[n] = v['cpick']; land[n] = {'team': v['cteam'], 'pick': v['cpick'], 'basis': 'consensus'}
        elif med:
            picks[n] = med
            if team_at(med):
                land[n] = {'team': team_at(med), 'pick': med, 'basis': 'recent'}
        if n not in land and v['most']:
            land[n] = {'team': v['most'], 'pick': None, 'basis': 'most'}
        if n in land:
            land[n]['mocks'] = len(v['picks'])
            if v['most']:
                land[n]['mostMocked'] = v['most']

    # 1. the pricer's mock source, then rebuild prices
    sp = os.path.join(PRICER, 'sources.json')
    src = json.load(open(sp))
    entry = next((s for s in src['nflSources'] if s['name'] == SOURCE_NAME), None)
    if entry is None:
        entry = {'name': SOURCE_NAME, 'type': 'mock', 'weight': 3}
        src['nflSources'].insert(0, entry)
    entry.update({'date': today.isoformat(), 'url': f'{BASE}/mock-drafts/{year}/consensus-mock-draft-{year}',
                  'note': 'Round 1: the pick in the 1-week consensus mock. Others: median pick across mocks from the last 14 days (5+ mocks).',
                  'picks': dict(sorted(picks.items(), key=lambda x: x[1]))})
    src['asOf'] = today.isoformat()
    src['settings']['nflPickFromMocks'] = True
    json.dump(src, open(sp, 'w'), indent=1, ensure_ascii=False)
    for script in ('build_players.py', 'build_mock_board.py'):
        subprocess.run([sys.executable, script], cwd=PRICER, check=True)

    # 2. landing teams
    json.dump({'source': 'NFL Mock Draft Database', 'url': entry['url'], 'asOf': today.isoformat(),
               'note': 'Projected NFL landing spot per rookie. consensus = the team at his pick in the 1-week consensus mock (round 1); '
                       'recent = the team holding his median pick in mocks from the last two weeks (Tankathon order); '
                       'most = the team he is most often mocked to.',
               'players': land}, open(os.path.join(ROOT, 'data', 'nfl-landing.json'), 'w'), indent=1)
    print(f'Updated {len(picks)} mock picks and {len(land)} landing teams')


if __name__ == '__main__':
    main()
