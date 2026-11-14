#!/usr/bin/env python3
"""NFL box-score stats by week for League Now > Stats (the "Show" menu): targets, carries, air yards and the rest.

Source: nflverse's weekly player stats (github.com/nflverse/nflverse-data, CC-BY 4.0), matched to MFL ids through
DynastyProcess's player id table (github.com/dynastyprocess/data). Only the players on the Stats page are kept, and
only the stats the page shows. Writes data/stats-detail.json:
  {season, weeks: [...], src, players: {mfl_id: {stat: [value per week, null when he didn't play]}}}
Keeps the previous file if either download fails. Run after stats.py: python scripts/refresh_nflverse.py
"""
import csv, io, json, os, urllib.request
from datetime import datetime, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
D = lambda *p: os.path.join(ROOT, 'data', *p)
WEEKLY = 'https://github.com/nflverse/nflverse-data/releases/download/stats_player/stats_player_week_{}.csv'
IDS = 'https://raw.githubusercontent.com/dynastyprocess/data/master/files/db_playerids.csv'

# page key: nflverse column (shares are fractions; the page shows them as percents)
STATS = {
    'att': 'attempts', 'cmp': 'completions', 'pyd': 'passing_yards', 'ptd': 'passing_tds', 'int': 'passing_interceptions',
    'pay': 'passing_air_yards', 'sk': 'sacks_suffered',
    'car': 'carries', 'ryd': 'rushing_yards', 'rtd': 'rushing_tds',
    'tgt': 'targets', 'rec': 'receptions', 'yd': 'receiving_yards', 'td': 'receiving_tds', 'ay': 'receiving_air_yards',
    'yac': 'receiving_yards_after_catch', 'ts': 'target_share', 'ays': 'air_yards_share',
    'fl': 'fumbles_lost_total',
}


def get(url):
    req = urllib.request.Request(url, headers={'User-Agent': 'Footballpalooza stats'})
    with urllib.request.urlopen(req, timeout=60) as r:
        return r.read().decode('utf-8')


def main():
    st = json.load(open(D('stats.json'), encoding='utf-8'))
    season, want = int(st['season']), {r['id'] for r in st['rows'] if r.get('p') in ('QB', 'RB', 'WR', 'TE')}
    try:
        rows = list(csv.DictReader(io.StringIO(get(WEEKLY.format(season)))))
        ids = list(csv.DictReader(io.StringIO(get(IDS))))
    except Exception as e:
        print('  FAIL nflverse:', e, '(kept the previous file)')
        return
    g2m = {r['gsis_id']: r['mfl_id'] for r in ids if r.get('gsis_id') not in ('', 'NA') and r.get('mfl_id') not in ('', 'NA')}
    rows = [r for r in rows if r.get('season_type') == 'REG' and g2m.get(r['player_id']) in want]
    weeks = sorted({int(r['week']) for r in rows})
    out = {}
    for r in rows:
        mid, i = g2m[r['player_id']], weeks.index(int(r['week']))
        P = out.setdefault(mid, {k: [None] * len(weeks) for k in STATS})
        for k, col in STATS.items():
            v = r.get(col)
            if v in (None, '', 'NA'):
                continue
            v = float(v)
            P[k][i] = round(v * 100, 1) if k in ('ts', 'ays') else (int(v) if v == int(v) else round(v, 1))
    for P in out.values():   # drop stats he never recorded, to keep the file small
        for k in [k for k, L in P.items() if not any(L)]:
            del P[k]
    res = {'season': season, 'weeks': weeks, 'built': datetime.now(timezone.utc).isoformat(timespec='seconds'),
           'src': 'nflverse (nflverse-data, CC-BY 4.0) via DynastyProcess player ids', 'players': out}
    with open(D('stats-detail.json'), 'w', encoding='utf-8') as fh:
        json.dump(res, fh, separators=(',', ':'))
        fh.write('\n')
    print(f'  ok   stats detail: {len(out)} of {len(want)} players, weeks {weeks[0] if weeks else "-"}-{weeks[-1] if weeks else "-"}')


if __name__ == '__main__':
    main()
