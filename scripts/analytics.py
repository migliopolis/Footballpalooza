#!/usr/bin/env python3
"""Build data/analytics.json for League Now > Analytics: this season's numbers behind the standings.

Lineups: points started vs. the best lineup each team could have started (MFL's optimal score).
Luck: wins vs. the wins the all-play record says a team's scoring deserves; close games (under 10 points).
Projections: starters' points vs. MFL's projection for them that week (data/mfl/projections.json).
Heat Check: every game this season labeled Nuclear, Hot, Cold, Bust or Witness Protection with the Scoreboard's
after-the-game rules, counted for each team's starters and for every player, plus a Heat Score. Projection accuracy:
each player's average miss against his weekly MFL projection (data/mfl/weeklyScores.json).
Lineup cost: the salary of each week's starting lineup. A player's salary is what he's paid on an FBP roster
now; a player since dropped uses his 2026 auction price or waiver bid. Players with no salary found are left out
of the dollar figures and counted in 'unpriced'.
Salary: points on FBP rosters this season against current salaries.
Playoff odds: each week's simulation, from data/league-now-history.json plus the latest run.
Run after league_now.py and refresh_mfl.py: python scripts/analytics.py
"""
import json, os, sys, collections
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from payroll import names_pos

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
D = lambda *p: os.path.join(ROOT, 'data', *p)
load = lambda p, d=None: json.load(open(p, encoding='utf-8')) if os.path.exists(p) else d
r1 = lambda x: round(x, 1)
SKILL = ('QB', 'RB', 'WR', 'TE')


def salaries():
    """{player: salary} — current rosters first, then this season's auction, then waiver bids."""
    sal = {}
    for f in ((load(D('mfl', 'rosters.json'), {}) or {}).get('rosters') or {}).get('franchise', []):
        for p in f.get('player', []):
            if p.get('salary') not in (None, ''):
                sal[p['id']] = float(p['salary'])
    au = (((load(D('mfl', 'auctionResults.json'), {}) or {}).get('auctionResults') or {}).get('auctionUnit') or {}).get('auction', [])
    for a in au if isinstance(au, list) else [au]:
        sal.setdefault(a['player'], float(a.get('winningBid') or 0))
    for t in (load(D('mfl', 'transactions.json'), {}) or {}).get('transactions', []):
        if t.get('type') == 'BBID_WAIVER':
            parts = t.get('transaction', '').split('|')
            if len(parts) > 1:
                for pid in filter(None, parts[0].split(',')):
                    try: sal.setdefault(pid, float(parts[1]))
                    except ValueError: pass
    return sal


def main():
    ln = load(D('league-now.json'))
    played = int(ln['weeksPlayed'])
    teams = (load(D('teams.json'), {}) or {}).get('teams', {})
    wr = (load(D('mfl', 'weeklyResults.json'), {}) or {}).get('weeks', {})
    proj = (load(D('mfl', 'projections.json'), {}) or {}).get('players', {})
    hist = (load(D('league-now-history.json'), {}) or {}).get('weeks', {})
    names, pos, espn = names_pos()
    sal = salaries()
    weeks = sorted((w for w in wr if int(w) <= played), key=int)
    st = {s['id']: s for s in ln['standings']}

    # lineups, projections, lineup cost
    left_weeks, onroster = [], collections.defaultdict(float)
    T = {f: {'proj': 0.0, 'projN': 0, 'cost': [], 'costPos': collections.defaultdict(float), 'unpriced': 0} for f in st}
    started = collections.defaultdict(lambda: {'n': 0, 'pts': 0.0, 'fr': collections.Counter()})
    wk_cost = {}
    for w in weeks:
        for f, t in wr[w].items():
            if f not in T:
                continue
            act = sum(x[1] for x in t.get('s', []))
            opt = float(t.get('opt') or 0)
            if opt:
                left_weeks.append([r1(opt - act), int(w), f, r1(act), r1(opt)])
            cost = 0.0
            for pid, pts in t.get('s', []):
                pj = (proj.get(w) or {}).get(pid)
                if pj is not None:
                    T[f]['proj'] += pts - pj; T[f]['projN'] += 1
                s = sal.get(pid)
                if s is None:
                    T[f]['unpriced'] += 1
                else:
                    cost += s; T[f]['costPos'][pos.get(pid, '?')] += s
                started[pid]['n'] += 1; started[pid]['pts'] += pts; started[pid]['fr'][f] += 1
            T[f]['cost'].append([int(w), cost, r1(act)])
            wk_cost[(int(w), f)] = (cost, act)
            for pid, pts in t.get('s', []) + t.get('n', []):
                onroster[pid] += pts
    left_weeks.sort(key=lambda x: -x[0])

    # did the pricier lineup win? (head-to-head games)
    pricier = [0, 0, 0]
    games = [g for g in ln.get('games', []) if g[0] <= played]
    close = collections.defaultdict(lambda: [0, 0, 0])
    cheap_wins, costly_losses = [], []
    for w, a, sa, b, sb in games:
        if abs(sa - sb) < 10:
            for me, mine, them in ((a, sa, sb), (b, sb, sa)):
                close[me][0 if mine > them else 1 if mine < them else 2] += 1
        ca, cb = wk_cost.get((w, a)), wk_cost.get((w, b))
        if not ca or not cb or ca[0] == cb[0]:
            continue
        hi, lo = (a, b) if ca[0] > cb[0] else (b, a)
        his, los = (sa, sb) if hi == a else (sb, sa)
        pricier[0 if his > los else 1 if his < los else 2] += 1
        if los > his:
            cheap_wins.append([w, lo, r1(wk_cost[(w, lo)][0]), r1(los), hi, r1(wk_cost[(w, hi)][0]), r1(his)])

    out_t = {}
    for f, s in st.items():
        g = s['w'] + s['l'] + s['t']
        ap_n = s['allPlayW'] + s['allPlayL'] + s['allPlayT']
        ap = (s['allPlayW'] + s['allPlayT'] / 2) / ap_n if ap_n else 0
        costs = T[f]['cost']
        spent = sum(c[1] for c in costs)
        out_t[f] = {
            'name': s['name'], 'w': s['w'], 'l': s['l'], 't': s['t'], 'pf': s['pf'], 'pp': s['pp'], 'pa': s['pa'],
            'eff': r1(100 * s['pf'] / s['pp']) if s['pp'] else None, 'left': r1(s['pp'] - s['pf']),
            'xw': r1(ap * g), 'luck': r1(s['w'] + s['t'] / 2 - ap * g), 'close': close[f],
            'proj': r1(T[f]['proj']), 'projN': T[f]['projN'],
            'lineupCost': r1(spent / len(costs)) if costs else None,
            'ptsPerDollar': round(sum(c[2] for c in costs) / spent, 2) if spent else None,
            'costPos': {k: r1(v / len(costs)) for k, v in sorted(T[f]['costPos'].items()) if costs},
            'costWeeks': [[w, r1(c), p] for w, c, p in costs], 'unpriced': T[f]['unpriced'],
            'odds': [],
        }
    # payroll now, by team
    for fr in ((load(D('mfl', 'rosters.json'), {}) or {}).get('rosters') or {}).get('franchise', []):
        if fr['id'] in out_t:
            pay = sum(float(p.get('salary') or 0) for p in fr.get('player', []))
            out_t[fr['id']]['payroll'] = pay
            out_t[fr['id']]['pfPerDollar'] = round(out_t[fr['id']]['pf'] / pay, 2) if pay else None
    # playoff odds by week
    runs = {int(w): v for w, v in hist.items()}
    cur = ((ln.get('odds') or {}).get('teams')) or {}
    if cur:
        runs.setdefault(played, {f: {'playoff': v.get('playoff')} for f, v in cur.items()})
    odds_weeks = sorted(runs)
    for f in out_t:
        out_t[f]['odds'] = [(runs[w].get(f) or {}).get('playoff') for w in odds_weeks]

    # players: started value and salary value
    def prow(pid, extra):
        return dict({'id': pid, 'name': names.get(pid, pid), 'pos': pos.get(pid, ''), 'espn': espn.get(pid, '') or ''}, **extra)
    on_now = {}
    for fr in ((load(D('mfl', 'rosters.json'), {}) or {}).get('rosters') or {}).get('franchise', []):
        for p in fr.get('player', []):
            on_now[p['id']] = fr['id']
    val = []
    for pid, pts in onroster.items():
        s = sal.get(pid)
        if pos.get(pid) in SKILL and s and pid in on_now and pts > 0:
            val.append(prow(pid, {'fr': on_now[pid], 'sal': s, 'pts': r1(pts), 'per': r1(pts / s)}))
    bargains = sorted([v for v in val if v['sal'] >= 5], key=lambda v: -v['per'])[:8]
    letdowns = sorted([v for v in val if v['sal'] >= 20], key=lambda v: v['per'])[:8]
    starters = []
    for pid, v in started.items():
        s = sal.get(pid)
        if pos.get(pid) in SKILL and s and v['n'] >= 3:
            starters.append(prow(pid, {'fr': v['fr'].most_common(1)[0][0], 'n': v['n'], 'sal': s, 'ppg': r1(v['pts'] / v['n']),
                                       'cpp': round(s / (v['pts'] / v['n']), 2) if v['pts'] > 0 else None}))
    # cheapest and priciest points from regular starters: salary per point per start
    cheap_starters = sorted([x for x in starters if x['cpp'] is not None and x['ppg'] >= 10], key=lambda x: x['cpp'])[:8]
    pricey_starters = sorted([x for x in starters if x['cpp'] is not None and x['sal'] >= 15], key=lambda x: -x['cpp'])[:8]

    # Heat Check: every game rescored with the Scoreboard's after-the-game labels (assets/live.js tier()):
    # Nuclear at or over the position's line; Hot: beat the projection by 5+ and reached 60% of the Nuclear line;
    # Witness Protection: no points; Bust: below zero, or a quarter of a 12+ projection or less; Cold: half of an 8+
    # projection or less. Heat Score: Nuclear +3, Hot +1, Cold -1, Bust -2, Witness Protection -3.
    NUKE = {'QB': 35, 'RB': 30, 'WR': 30, 'TE': 25, 'DEF': 25}
    HEAT = {'nuke': 3, 'hot': 1, 'cold': -1, 'bust': -2, 'wp': -3}
    def tier(p, sc, pj):
        line = NUKE.get(p)
        if line and sc >= line:
            return 'nuke'
        if pj > 0 and sc >= pj + 5 and sc >= (line or 25) * .6:
            return 'hot'
        if sc == 0:
            return 'wp'
        if sc < 0 or (pj >= 12 and sc <= pj * .25):
            return 'bust'
        if pj >= 8 and sc <= pj * .5:
            return 'cold'
        return None
    ws = (load(D('mfl', 'weeklyScores.json'), {}) or {}).get('weeks', {})
    hw = [w for w in weeks if w in ws]
    pj_of = lambda w, pid: float((proj.get(w) or {}).get(pid) or 0)
    heat_t = {f: {k: 0 for k in HEAT} | {'starts': 0} for f in st}
    for w in hw:
        for f, t in wr[w].items():
            if f not in heat_t:
                continue
            for pid, sc in t.get('s', []):
                heat_t[f]['starts'] += 1
                k = tier(pos.get(pid, ''), float(sc), pj_of(w, pid))
                if k:
                    heat_t[f][k] += 1
    for f, h in heat_t.items():
        h['score'] = sum(h[k] * v for k, v in HEAT.items())
    CODE = {'nuke': 'N', 'hot': 'H', 'cold': 'C', 'bust': 'B', 'wp': 'W', None: '.'}
    heat_p, acc = {}, []
    for pid in {p for w in hw for p in ws[w]}:
        p = pos.get(pid, '')
        if p not in NUKE:
            continue
        cnt, line, gp, games = {k: 0 for k in HEAT}, [], 0, []
        for w in hw:
            sc = ws[w].get(pid)
            pj = pj_of(w, pid)
            # a game counts when he scored, or MFL projected him for 3+ (a zero with no projection is a week off)
            if sc is None or (float(sc) == 0 and pj < 3):
                line.append('-'); continue
            sc = float(sc); gp += 1
            k = tier(p, sc, pj)
            if k:
                cnt[k] += 1
            line.append(CODE[k])
            if pj >= 3:
                games.append((sc, pj))
        if not gp or not any(cnt.values()) and len(games) < 5:
            continue
        heat_p[pid] = {'n': names.get(pid, pid), 'p': p, 'fr': on_now.get(pid), 'g': gp, 'c': [cnt[k] for k in HEAT],
                       's': sum(cnt[k] * v for k, v in HEAT.items()), 'w': ''.join(line), 'e': espn.get(pid, '') or ''}
        if len(games) >= 5:
            mp = sum(g[1] for g in games) / len(games)
            if mp >= 8:
                acc.append({'id': pid, 'name': names.get(pid, pid), 'pos': p, 'fr': on_now.get(pid), 'g': len(games),
                            'pj': r1(mp), 'sc': r1(sum(g[0] for g in games) / len(games)),
                            'mae': r1(sum(abs(g[0] - g[1]) for g in games) / len(games)),
                            'bias': r1(sum(g[0] - g[1] for g in games) / len(games)),
                            'hit': round(100 * sum(1 for g in games if abs(g[0] - g[1]) <= .25 * g[1]) / len(games))})

    cheap_wins.sort(key=lambda g: g[5] - g[2], reverse=True)
    out = {
        'built': datetime.now(timezone.utc).isoformat(timespec='seconds'), 'season': ln.get('season'), 'through': played,
        'teams': out_t, 'oddsWeeks': odds_weeks, 'leftWeeks': left_weeks[:8],
        'pricier': pricier, 'cheapWins': cheap_wins[:6],
        'bargains': bargains, 'letdowns': letdowns, 'cheapStarters': cheap_starters, 'priceyStarters': pricey_starters,
        'heatWeeks': [int(w) for w in hw], 'heatPts': HEAT, 'heatTeams': heat_t, 'heatPlayers': heat_p, 'acc': acc,
    }
    with open(D('analytics.json'), 'w', encoding='utf-8') as fh:
        json.dump(out, fh, separators=(',', ':'), ensure_ascii=False)
        fh.write('\n')
    print(f'analytics: through week {played}, {len(out_t)} teams, odds weeks {odds_weeks}, '
          f'unpriced starts {sum(t["unpriced"] for t in out_t.values())}')


if __name__ == '__main__':
    main()
