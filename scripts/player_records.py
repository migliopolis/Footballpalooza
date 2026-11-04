#!/usr/bin/env python3
"""Build data/player-records.json: every player's record as an FBP starter (Reference > Players).

A start is a week a player was in an FBP starting lineup. His record is his team's result that week:
regular-season games from the schedule, playoff games (round 1, semis, final) from the brackets, kept
separately. Consolation games don't count. Points are what he scored in those starts.
Lineups: 2019-2020 from data/reference/starters-2019-2020.json, 2021-2025 from data/history/<year>,
this season from data/mfl/weeklyResults.json (finished weeks only).
Run after build_reference.py: python scripts/player_records.py
"""
import json, os, sys
from collections import defaultdict
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from payroll import names_pos   # same player names, positions and ESPN ids as Payroll

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
D = lambda *p: os.path.join(ROOT, 'data', *p)
load = lambda p, d=None: json.load(open(p, encoding='utf-8')) if os.path.exists(p) else d


def lineups(cur):
    """{year: {week: {franchise: [[pid, pts], ...]}}}"""
    out = {}
    old = (load(D('reference', 'starters-2019-2020.json'), {}) or {}).get('seasons', {})
    for y, wks in old.items():
        out[int(y)] = {int(w): fr for w, fr in wks.items()}
    for y in range(2021, cur):
        wr = load(D('history', str(y), 'weeklyResults.json'), {}) or {}
        if wr.get('weeks'):
            out[y] = {int(w): {f: t.get('s', []) for f, t in fr.items()} for w, fr in wr['weeks'].items()}
    wr = load(D('mfl', 'weeklyResults.json'), {}) or {}
    if wr.get('weeks'):
        out[cur] = {int(w): {f: t.get('s', []) for f, t in fr.items()} for w, fr in wr['weeks'].items()}
    return out


def results(ref):
    """{(year, week, franchise): ('W'|'L'|'T', is_playoff)}"""
    res = {}
    for y, gs in ref['schedules_by_year'].items():
        po0 = (ref['playoff_weeks_by_year'].get(y) or [99])[0]
        for g in gs:
            wk = int(g['week'])
            if wk >= po0:
                continue
            for s in 'AB':
                r = g.get('result' + s)
                if r in ('W', 'L', 'T'):
                    res[(int(y), wk, g['franchise' + s])] = (r, False)
    for y, b in ref['playoff_brackets'].items():
        rounds = [(b.get('round1_week'), b.get('round1_games') or []), (b.get('semi_week'), b.get('semifinal_games') or []),
                  (b.get('championship_week'), [b['championship_game']] if b.get('championship_game') else [])]
        for wk, gs in rounds:
            for g in gs:
                for s in 'AB':
                    r = g.get('result' + s)
                    if wk and r in ('W', 'L', 'T'):
                        res[(int(y), int(wk), g['franchise' + s])] = (r, True)
    return res


def main():
    ref = load(D('reference.json'))
    cur = int(ref['meta']['current_year'])
    names, pos, espn = names_pos()
    res = results(ref)
    WLT = 'WLT'
    P = defaultdict(lambda: {'reg': [0, 0, 0], 'pts': 0.0, 'po': [0, 0, 0], 'popts': 0.0, 'teams': {}})
    for y, wks in sorted(lineups(cur).items()):
        for wk, frs in sorted(wks.items()):
            for fr, st in frs.items():
                r = res.get((y, wk, fr))
                if not r:
                    continue
                code, po = r
                for pid, pts in st:
                    p = P[pid]
                    t = p['teams'].setdefault(fr, {'years': set(), 'reg': [0, 0, 0], 'po': [0, 0, 0]})
                    t['years'].add(y)
                    if po:
                        p['po'][WLT.index(code)] += 1; p['popts'] += pts; t['po'][WLT.index(code)] += 1
                    else:
                        p['reg'][WLT.index(code)] += 1; p['pts'] += pts; t['reg'][WLT.index(code)] += 1
    rows = []
    for pid, p in P.items():
        n = sum(p['reg'])
        if not n and not sum(p['po']):
            continue
        teams = sorted(p['teams'].items(), key=lambda kv: (-sum(kv[1]['reg']) - sum(kv[1]['po']), min(kv[1]['years'])))
        rows.append([pid, names.get(pid, pid), pos.get(pid, ''), espn.get(pid, '') or '', *p['reg'], round(p['pts'], 1), *p['po'], round(p['popts'], 1),
                     [[fr, sorted(t['years']), *t['reg'], *t['po']] for fr, t in teams]])
    rows.sort(key=lambda r: (-(r[4] + r[5] + r[6]), r[1]))
    yrs = sorted(lineups(cur))
    out = {'built': datetime.now(timezone.utc).isoformat(timespec='seconds'), 'first': yrs[0], 'last': yrs[-1],
           'fields': ['id', 'name', 'pos', 'espn', 'w', 'l', 't', 'pts', 'pw', 'pl', 'pt', 'popts', 'teams'],
           'team_fields': ['franchise', 'years', 'w', 'l', 't', 'pw', 'pl', 'pt'],
           'players': rows}
    with open(D('player-records.json'), 'w', encoding='utf-8') as f:
        json.dump(out, f, separators=(',', ':'), ensure_ascii=False)
        f.write('\n')
    print(f'player records: {len(rows)} players, {yrs[0]}-{yrs[-1]}')


if __name__ == '__main__':
    main()
