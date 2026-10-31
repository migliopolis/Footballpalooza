"""Backtest scripts/eliminations.py on every completed 14-week season (2021-2025):
no team may be marked out of a playoff path that it went on to win under the 2027 seeding rules."""
import json, os, sys, collections
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'scripts'))
from eliminations import eliminations
import league_now as LN

ref = json.load(open(os.path.join(ROOT, 'data', 'reference.json')))
checked = 0
for y in ('2021', '2022', '2023', '2024', '2025'):
    games = [(int(g['week']), g['franchiseA'], float(g['scoreA']), g['franchiseB'], float(g['scoreB']))
             for g in ref['schedules_by_year'][y] if int(g['week']) <= 14]
    sched = [(w, a, b) for w, a, _, b, _ in games]
    met = collections.Counter(frozenset((a, b)) for _, a, b in sched)   # division rivals meet twice
    adj = collections.defaultdict(set)
    for k, v in met.items():
        if v >= 2:
            a, b = tuple(k); adj[a].add(b); adj[b].add(a)
    teams, n = {}, 0
    for t in sorted({x for _, a, b in sched for x in (a, b)}):
        if t not in teams:
            for m in {t} | adj[t]: teams[m] = str(n)
            n += 1
    el = eliminations(teams, games, sched, 14)
    T = {}
    for t in teams:
        w = l = ti = 0; pf = 0.0
        for _, a, sa, b, sb in games:
            if t in (a, b):
                m, o = (sa, sb) if a == t else (sb, sa); pf += m; w += m > o; l += m < o; ti += m == o
        T[t] = {'pct': (w + .5 * ti) / 14, 'pf': pf, 'division': teams[t]}
    wk = collections.defaultdict(dict)
    for w, a, sa, b, sb in games: wk[w][a] = sa; wk[w][b] = sb
    for t in T:
        T[t]['allPlayW'] = sum(sum(1 for o, x in sc.items() if o != t and sc[t] > x) for sc in wk.values())
    seeds, _, _ = LN.seed_league(T, games, [{'id': str(i)} for i in range(n)])
    path = {'division': 'division', 'wild card': 'wildCard', 'all-play wins': 'allPlay'}
    for s in seeds:
        assert el[s['id']][path[s['via']]] is None, (y, s, el[s['id']])
        assert el[s['id']]['all'] is None, (y, s)
        checked += 1
print(f'elimination checks passed ({checked} playoff teams, 2021-2025)')
