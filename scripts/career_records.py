#!/usr/bin/env python3
"""Build data/career-records.json: FBP player career records and best single games, counting starts only
(Reference > Records > Player careers, and the player list under Records > Single games).

A start is a week in an FBP starting lineup. Career boards count regular-season starts, the same as the
Players table (player-records.json), except Most playoff wins (round 1, semis, final). Best player games count
regular-season and playoff starts. Consolation games never count. Lineups and results come from player_records.py (2019 on).
Points are league scoring. Yards, touchdowns and the rest are NFL box scores for those same weeks, from
nflverse's weekly player stats (github.com/nflverse/nflverse-data, CC-BY 4.0), matched to MFL ids through
DynastyProcess's player id table (github.com/dynastyprocess/data).
Finished seasons' box-score totals are cached in data/reference/career-stats-cache.json, so a normal run only
downloads the current season; if a download fails the cached numbers are used.
Run after player_records.py: python scripts/career_records.py   (python scripts/career_records.py --all rebuilds the cache)
"""
import csv, io, json, os, sys, urllib.request
from collections import defaultdict
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from payroll import names_pos
from player_records import lineups, results

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
D = lambda *p: os.path.join(ROOT, 'data', *p)
load = lambda p, d=None: json.load(open(p, encoding='utf-8')) if os.path.exists(p) else d
WEEKLY = 'https://github.com/nflverse/nflverse-data/releases/download/stats_player/stats_player_week_{}.csv'
IDS = 'https://raw.githubusercontent.com/dynastyprocess/data/master/files/db_playerids.csv'
CACHE = D('reference', 'career-stats-cache.json')

# stat key: nflverse columns added together
STATS = {
    'pyd': ['passing_yards'], 'ptd': ['passing_tds'], 'int': ['passing_interceptions'],
    'ryd': ['rushing_yards'], 'rtd': ['rushing_tds'],
    'rec': ['receptions'], 'yd': ['receiving_yards'], 'td': ['receiving_tds'],
    'sttd': ['special_teams_tds'],
    'fl': ['sack_fumbles_lost', 'rushing_fumbles_lost', 'receiving_fumbles_lost'],
}
# the Scoreboard's "Nuclear" line by position (assets/live.js, scripts/analytics.py)
NUKE = {'QB': 35, 'RB': 30, 'WR': 30, 'TE': 25, 'DEF': 25}
MIN_RATE = 40   # starts needed for the win % and points-per-start boards


def get(url):
    req = urllib.request.Request(url, headers={'User-Agent': 'Footballpalooza records'})
    with urllib.request.urlopen(req, timeout=120) as r:
        return r.read().decode('utf-8')


def season_stats(year, starts, g2m):
    """{pid: {stat: total}} over the weeks each player started, from nflverse; None if the download fails."""
    try:
        rows = csv.DictReader(io.StringIO(get(WEEKLY.format(year))))
    except Exception as e:
        print(f'  FAIL nflverse {year}: {e}')
        return None
    want = starts.get(year, {})
    out = {}
    for r in rows:
        if r.get('season_type') != 'REG':
            continue
        mid = g2m.get(r.get('player_id'))
        if not mid or int(r['week']) not in want.get(mid, ()):
            continue
        t = out.setdefault(mid, {'g': 0})
        t['g'] += 1
        for k, cols in STATS.items():
            v = sum(float(r[c]) for c in cols if r.get(c) not in (None, '', 'NA'))
            if v:
                t[k] = t.get(k, 0) + v
    return {pid: {k: (int(v) if v == int(v) else round(v, 1)) for k, v in t.items()} for pid, t in out.items()}


def opponents(ref):
    """{(year, week, franchise): (opponent, playoff)} for regular-season and playoff games."""
    opp = {}
    for y, gs in ref['schedules_by_year'].items():
        po0 = (ref['playoff_weeks_by_year'].get(y) or [99])[0]
        for g in gs:
            wk = int(g['week'])
            if wk < po0:
                opp[(int(y), wk, g['franchiseA'])] = (g['franchiseB'], False)
                opp[(int(y), wk, g['franchiseB'])] = (g['franchiseA'], False)
    for y, b in ref['playoff_brackets'].items():
        for wk, gs in [(b.get('round1_week'), b.get('round1_games') or []), (b.get('semi_week'), b.get('semifinal_games') or []),
                       (b.get('championship_week'), [b['championship_game']] if b.get('championship_game') else [])]:
            for g in gs:
                if wk:
                    opp[(int(y), int(wk), g['franchiseA'])] = (g['franchiseB'], True)
                    opp[(int(y), int(wk), g['franchiseB'])] = (g['franchiseA'], True)
    return opp


def main():
    rebuild = '--all' in sys.argv
    ref = load(D('reference.json'))
    cur = int(ref['meta']['current_year'])
    names, pos, espn = names_pos()
    res, opp = results(ref), opponents(ref)
    L = lineups(cur)

    # every counted start: (year, week, franchise, pid, pts, result, playoff)
    starts, weeks_by = [], defaultdict(lambda: defaultdict(set))
    for y, wks in sorted(L.items()):
        for wk, frs in sorted(wks.items()):
            for fr, st in frs.items():
                r = res.get((y, wk, fr))
                if not r:
                    continue
                for pid, pts in st:
                    starts.append((y, wk, fr, pid, float(pts), r[0], r[1]))
                    if not r[1]:
                        weeks_by[y][pid].add(wk)

    # box-score totals per season: cached for finished seasons, downloaded for this one (and any missing)
    cache = load(CACHE, {}) or {}
    seasons = cache.get('seasons', {})
    need = [y for y in sorted(L) if rebuild or y == cur or str(y) not in seasons]
    if need:
        try:
            ids = list(csv.DictReader(io.StringIO(get(IDS))))
            g2m = {r['gsis_id']: r['mfl_id'] for r in ids if r.get('gsis_id') not in ('', 'NA') and r.get('mfl_id') not in ('', 'NA')}
        except Exception as e:
            print('  FAIL player ids:', e, '(using cached box scores)')
            g2m = None
        for y in need:
            got = season_stats(y, weeks_by, g2m) if g2m else None
            if got is not None:
                seasons[str(y)] = got
    cache = {'note': 'Box-score totals over regular-season FBP starts, by season and MFL id. Built by scripts/career_records.py.',
             'src': 'nflverse (nflverse-data, CC-BY 4.0) via DynastyProcess player ids', 'seasons': seasons}
    with open(CACHE, 'w', encoding='utf-8') as f:
        json.dump(cache, f, separators=(',', ':'))
        f.write('\n')

    # careers
    C = defaultdict(lambda: {'n': 0, 'w': 0, 'l': 0, 't': 0, 'pw': 0, 'pts': 0.0, 'nuke': 0, 'teams': defaultdict(int), 'yrs': set()})
    games = []
    for y, wk, fr, pid, pts, r, po in starts:
        o = opp.get((y, wk, fr), (None, po))
        games.append({'id': pid, 'pts': round(pts, 1), 'year': y, 'week': wk, 'fr': fr, 'opp': o[0], 'r': r, 'po': po})
        if po:   # playoff starts only count toward Most playoff wins
            if r == 'W':
                C[pid]['pw'] += 1
            continue
        c = C[pid]
        c['n'] += 1; c['pts'] += pts; c['teams'][fr] += 1; c['yrs'].add(y)
        c[{'W': 'w', 'L': 'l', 'T': 't'}[r]] += 1
        line = NUKE.get(pos.get(pid, ''))
        if line and pts >= line:
            c['nuke'] += 1
    # Player of the Week: the top starter score of each regular-season week (same as the Awards page),
    # rebuilt for every season from the lineups. A tie shares it.
    wk_best = defaultdict(list)
    for y, wk, fr, pid, pts, r, po in starts:
        if not po and pos.get(pid) in ('QB', 'RB', 'WR', 'TE', 'DEF'):
            wk_best[(y, wk)].append((pts, pid))
    for (y, wk), L2 in wk_best.items():
        top = max(p for p, _ in L2)
        for pid in sorted({pid for p, pid in L2 if p == top}):
            C[pid]['potw'] = C[pid].get('potw', 0) + 1
    for y, S in seasons.items():
        for pid, t in S.items():
            if pid in C:
                for k, v in t.items():
                    C[pid][k] = C[pid].get(k, 0) + v

    def who(pid):
        c = C[pid]
        team = max(c['teams'].items(), key=lambda kv: kv[1])[0] if c['teams'] else ''
        ys = sorted(c['yrs']) or [0]
        return {'id': pid, 'name': names.get(pid, pid), 'pos': pos.get(pid, ''), 'espn': espn.get(pid, '') or '',
                'fr': team, 'teams': sorted(c['teams'], key=lambda f: -c['teams'][f]), 'n': c['n'], 'yrs': [ys[0], ys[-1]],
                'rec': [c['w'], c['l'], c['t']]}

    def board(key, title, group, val, fmt='n', cond=lambda c: True, note='', rev=False, top=10):
        rows = [(pid, val(c)) for pid, c in C.items() if (c['n'] or key == 'pwins') and cond(c)]
        rows = [r for r in rows if r[1]]
        rows.sort(key=lambda r: (r[1] if rev else -r[1], -C[r[0]]['n'], names.get(r[0], r[0])))   # ties: more starts, then A-Z (same as the tiles)
        return {'key': key, 'title': title, 'group': group, 'fmt': fmt, 'note': note,
                'rows': [dict(who(pid), v=round(v, 3) if fmt == 'pct' else round(v, 1) if fmt == 'f1' else v) for pid, v in rows[:top]]}

    g = lambda k: (lambda c: c.get(k, 0))
    rate = lambda c: c['n'] >= MIN_RATE
    boards = [
        board('starts', 'Most starts', 'Winning', g('n')),
        board('wins', 'Most wins', 'Winning', g('w')),
        board('winpct', 'Best win %', 'Winning', lambda c: (c['w'] + c['t'] / 2) / c['n'], 'pct', rate, f'{MIN_RATE}+ starts'),
        board('pwins', 'Most playoff wins', 'Winning', g('pw')),
        board('pts', 'Most points', 'Scoring', g('pts'), 'f1'),
        board('ppg', 'Most points per start', 'Scoring', lambda c: c['pts'] / c['n'], 'f1', rate, f'{MIN_RATE}+ starts'),
        board('potw', 'Most Player of the Week honors', 'Scoring', g('potw'), note='top starter score of a regular-season week; ties share it'),
        board('nuke', 'Most Nuclear games', 'Scoring', g('nuke'), note='QB 35+, RB and WR 30+, TE and DEF 25+'),
        board('tds', 'Most touchdowns', 'Scoring', lambda c: c.get('rtd', 0) + c.get('td', 0) + c.get('sttd', 0), note='rushing, receiving and returns'),
        board('pyd', 'Most passing yards', 'Passing', g('pyd')),
        board('ptd', 'Most passing TDs', 'Passing', g('ptd')),
        board('ryd', 'Most rushing yards', 'Rushing', g('ryd')),
        board('rtd', 'Most rushing TDs', 'Rushing', g('rtd')),
        board('rec', 'Most receptions', 'Receiving', g('rec')),
        board('yd', 'Most receiving yards', 'Receiving', g('yd')),
        board('td', 'Most receiving TDs', 'Receiving', g('td')),
        board('scrim', 'Most yards from scrimmage', 'Receiving', lambda c: c.get('ryd', 0) + c.get('yd', 0), note='rushing plus receiving'),
        board('losses', 'Most losses', 'Dubious', g('l')),
        board('int', 'Most interceptions thrown', 'Dubious', g('int')),
        board('fl', 'Most fumbles lost', 'Dubious', g('fl')),
    ]

    games.sort(key=lambda x: (-x['pts'], x['year'], x['week']))
    for x in games:
        x['name'], x['pos'], x['espn'] = names.get(x['id'], x['id']), pos.get(x['id'], ''), espn.get(x['id'], '') or ''
    by_pos = {p: [x for x in games if x['pos'] == p][:5] for p in ('QB', 'RB', 'WR', 'TE', 'DEF')}
    yrs = sorted(L)
    out = {'built': datetime.now(timezone.utc).isoformat(timespec='seconds'), 'first': yrs[0], 'last': yrs[-1],
           'minRate': MIN_RATE, 'statYears': sorted(int(y) for y in seasons),
           'src': cache['src'], 'boards': boards, 'games': games[:25], 'gamesByPos': by_pos}
    with open(D('career-records.json'), 'w', encoding='utf-8') as f:
        json.dump(out, f, separators=(',', ':'), ensure_ascii=False)
        f.write('\n')
    have = sum(1 for s in starts if str(s[0]) in seasons and s[3] in seasons[str(s[0])])
    print(f'career records: {len(C)} players, {len(starts)} starts {yrs[0]}-{yrs[-1]}, box scores for {have} '
          f'(defenses have none), seasons {out["statYears"]}')


if __name__ == '__main__':
    main()
