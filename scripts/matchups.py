#!/usr/bin/env python3
"""This week's matchups with a head-to-head breakdown -> data/matchups.json

Reads data/league-now.json (standings, results, the upcoming schedule and the playoff
simulation) and data/reference.json (every game since 2019, playoffs included).

For each game in the next unplayed week:
  - tale of the tape: record, seed, points, average, last three weeks, streak, high/low
  - win chance from the playoff simulation
  - stakes: each team's playoff and bye odds after a win and after a loss
  - the series since 2019: overall record, playoff meetings, current streak,
    average score, biggest win each way, and the most recent meetings
The game with the biggest combined playoff swing is tagged game of the week.
"""
import json, os
from datetime import datetime, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
J = lambda p: json.load(open(os.path.join(ROOT, 'data', p)))


def main():
    now, ref = J('league-now.json'), J('reference.json')
    week = now['weeksPlayed'] + 1
    if week > now['lastRegularSeasonWeek']:
        json.dump({'season': now['season'], 'week': None, 'games': []}, open(os.path.join(ROOT, 'data', 'matchups.json'), 'w'))
        return
    cur = int(ref['meta']['current_year'])
    by = {t['id']: t for t in now['standings']}
    odds = (now.get('odds') or {}).get('teams', {})

    # every played game since 2019, tagged regular season or playoff round
    games = []
    for y, rows in ref['schedules_by_year'].items():
        y = int(y)
        br = ref['playoff_brackets'].get(str(y)) or {}
        pw = ref['playoff_weeks_by_year'].get(str(y)) or []
        kinds = {}
        def tag(g, k):
            kinds[frozenset((g['franchiseA'], g['franchiseB']))] = k
        for g in br.get('round1_games', []): tag(g, 'Playoffs · Round 1')
        for g in br.get('semifinal_games', []): tag(g, 'Playoffs · Semifinal')
        if br.get('championship_game'): tag(br['championship_game'], 'Championship')
        for g in rows:
            wk = int(g['week'])
            sa, sb = float(g['scoreA'] or 0), float(g['scoreB'] or 0)
            if y == cur and wk > now['weeksPlayed']: continue
            if sa == 0 and sb == 0: continue
            kind = 'Regular season'
            if wk in pw:
                kind = kinds.get(frozenset((g['franchiseA'], g['franchiseB'])), '3rd-place game') if wk == pw[-1] else \
                    kinds.get(frozenset((g['franchiseA'], g['franchiseB'])), 'Playoffs')
            games.append(dict(y=y, w=wk, a=g['franchiseA'], b=g['franchiseB'], sa=sa, sb=sb, kind=kind))
    games.sort(key=lambda g: (g['y'], g['w']))

    # this season's weekly scores for averages, last three, highs and lows
    mine = {}
    for wk, a, sa, b, sb in now['games']:
        mine.setdefault(a, []).append((wk, sa)); mine.setdefault(b, []).append((wk, sb))
    pf_rank = {t['id']: i + 1 for i, t in enumerate(sorted(now['standings'], key=lambda t: -t['pf']))}

    def tape(tid, opp):
        t, s = by[tid], sorted(mine.get(tid, []))
        sc = [x for _, x in s]
        o = odds.get(tid) or {}
        g = next((x for x in o.get('ownGames', []) if x['week'] == week and x['opp'] == opp), None)
        return dict(
            id=tid, w=t['w'], l=t['l'], t=t['t'], seed=t.get('seed'), division=t['divisionName'],
            pf=t['pf'], pfRank=pf_rank[tid], avg=round(sum(sc) / len(sc), 1) if sc else None,
            last3=round(sum(sc[-3:]) / len(sc[-3:]), 1) if sc else None, streak=t.get('streak'),
            high=max(sc) if sc else None, low=min(sc) if sc else None,
            allPlay=f"{t['allPlayW']}-{t['allPlayL']}" + (f"-{t['allPlayT']}" if t.get('allPlayT') else ''),
            winProb=g['winProb'] if g else None,
            playoff=o.get('playoff'), bye=o.get('bye'),
            ifWin=g['ifWin'][:2] if g else None, ifLoss=g['ifLoss'][:2] if g else None,
        )

    def series(a, b):
        ms = [g for g in games if {g['a'], g['b']} == {a, b}]
        rec = {a: 0, b: 0, 'tie': 0}; pts = {a: [], b: []}; big = {a: None, b: None}; po = []
        out = []
        for g in ms:
            s = {g['a']: g['sa'], g['b']: g['sb']}
            pts[a].append(s[a]); pts[b].append(s[b])
            win = a if s[a] > s[b] else b if s[b] > s[a] else None
            rec[win or 'tie'] += 1
            if win:
                m = round(abs(s[a] - s[b]), 1)
                if not big[win] or m > big[win]['margin']:
                    big[win] = dict(y=g['y'], w=g['w'], margin=m, score=f"{s[win]:.1f}-{s[b if win == a else a]:.1f}")
            row = dict(y=g['y'], w=g['w'], sa=s[a], sb=s[b], win=win, kind=g['kind'])
            out.append(row)
            if g['kind'] != 'Regular season': po.append(row)
        streak = None
        for r in reversed(out):
            if r['win'] is None: break
            if streak is None: streak = [r['win'], 1]
            elif r['win'] == streak[0]: streak[1] += 1
            else: break
        return dict(
            games=len(out), w={a: rec[a], b: rec[b]}, t=rec['tie'],
            avg={a: round(sum(pts[a]) / len(pts[a]), 1) if pts[a] else None, b: round(sum(pts[b]) / len(pts[b]), 1) if pts[b] else None},
            streak=dict(id=streak[0], n=streak[1]) if streak else None,
            biggest=big, playoff=list(reversed(po)), recent=list(reversed(out))[:5],
            divisionGame=by[a]['division'] == by[b]['division'],
        )

    out = []
    for wk, a, b in now['upcoming']:
        if wk != week: continue
        A, B = tape(a, b), tape(b, a)
        swing = sum((x['ifWin'][0] - x['ifLoss'][0]) for x in (A, B) if x['ifWin'])
        out.append(dict(away=a, home=b, teams={a: A, b: B}, series=series(a, b), swing=round(swing, 1)))
    if out:
        max(out, key=lambda g: g['swing'])['gotw'] = True
    out.sort(key=lambda g: -g['swing'])

    json.dump(dict(season=now['season'], week=week, through=now['weeksPlayed'], since=min(g['y'] for g in games),
                   generated=datetime.now(timezone.utc).isoformat(timespec='seconds'), games=out),
              open(os.path.join(ROOT, 'data', 'matchups.json'), 'w'), indent=1)


if __name__ == '__main__':
    main()
