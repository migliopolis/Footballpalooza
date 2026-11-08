#!/usr/bin/env python3
"""Build data/power.json for League Now > Power Rankings: the FBP Power Score.

Four parts, each scored against the league (the page does the scoring so keep/drop flips recalculate):
  Strength now (35%)  this season's points per week and all-play record, plus the best legal lineup on the roster for
                      the rest of the season (each player's projected points a game).
  Keepers (30%)       what the players a team would keep for next season are worth at auction.
  Auction cash (20%)  what's left to spend: the team's auction budget, minus kept salaries, minus $1 per open spot on
                      the 20-man active roster (the by-law cap rule; taxi players count at their salary, not as spots).
  Draft picks (15%)   the 2027 and 2028 rookie picks a team owns, valued by what each draft slot has scored.

Player value: his projected points a game blends this season's per-game average (steadied by his FBP career points
per start, or the position average for a newcomer, so a short or injured season doesn't sink him) with what his FantasyPros rest-of-season rank has been worth this year. Next year's
figure adjusts for age by position. Points above replacement (the first player past the league's starters at the
position) turn into auction dollars: the league's auction pot is split by position the way FBP auctions have spent it
over the last five years (RBs draw most of the money, defenses very little), then spread over those points.

Suggested keep: a player under contract for next season whose auction value beats his next-year salary, with at most
two veteran QBs (by-law). It's only a suggestion; the page lets anyone flip it on their own device.
Run after rosters.py and league_now.py: python scripts/power.py
"""
import json, os, statistics as st
from datetime import datetime, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
D = lambda *p: os.path.join(ROOT, 'data', *p)
load = lambda p, d=None: json.load(open(p, encoding='utf-8')) if os.path.exists(p) else d

TEAMS = 12
STARTERS = {'QB': 1, 'RB': 2.5, 'WR': 2.5, 'TE': 1.25, 'DEF': 1}   # per team, FLEX split across RB/WR/TE
GAMES = 13          # FBP regular-season games a year (weeks 1-14 less a bye)
ROSTER = 20         # active roster, for open spots
SHRINK = 3          # games of the position average mixed into a player's per-game figure


def age_factor(pos, age):
    if not age:
        return 1.0
    if pos == 'RB':
        return 1.05 if age <= 24 else 1.0 if age <= 26 else .88 if age <= 28 else .75
    if pos == 'WR':
        return 1.05 if age <= 24 else 1.0 if age <= 29 else .9 if age <= 31 else .8
    if pos == 'TE':
        return 1.05 if age <= 25 else 1.0 if age <= 30 else .9 if age <= 32 else .8
    if pos == 'QB':
        return 1.0 if age <= 34 else .9 if age <= 37 else .8
    return 1.0


def main():
    R = load(D('rosters.json'))
    N = load(D('league-now.json'), {})
    B = load(D('budgets.json'), {'default': 200, 'trades': [], 'adjustments': []})
    REF = load(D('reference.json'), {})
    FDP = load(D('mfl', 'futureDraftPicks.json'), {})
    season = R['season']

    rows = [(fid, r) for fid, t in R['teams'].items() for r in t['rows']]
    # position averages and the per-game figure
    by = {}
    for _, r in rows:
        if r['gp']:
            by.setdefault(r['pos'], []).append(r['pts'] / r['gp'])
    pmean = {p: st.mean(v) for p, v in by.items()}
    # a track record: his FBP career points per start (5 starts or more), which steadies a short or injured season
    PR = load(D('player-records.json'), {})
    F = PR.get('fields', [])
    career = {}
    for a in PR.get('players', []):
        p = dict(zip(F, a)); n = p['w'] + p['l'] + p['t']
        if n >= 5:
            career[p['id']] = (p['pts'] / n, min(n, 26))
    def ppg(r):
        if r['id'] in career:
            c, n = career[r['id']]
            k = SHRINK + n / 4          # up to 6.5 games' worth of history beside this season
            return (r['pts'] + k * c) / ((r['gp'] or 0) + k)
        m = pmean.get(r['pos'], 0)
        return (r['pts'] + SHRINK * m) / ((r['gp'] or 0) + SHRINK)
    curve = {}
    for p in by:
        curve[p] = sorted((ppg(r) for _, r in rows if r['pos'] == p), reverse=True)
    def proj(r):
        own = ppg(r)
        c, k = curve.get(r['pos'], []), r.get('ecrPos')
        if k and c:
            return (own + c[min(len(c), k) - 1]) / 2
        return own
    # replacement level and dollars per point above replacement
    repl = {}
    for p, n in STARTERS.items():
        c = sorted((proj(r) for _, r in rows if r['pos'] == p), reverse=True)
        i = int(round(n * TEAMS))
        repl[p] = c[i] if len(c) > i else (c[-1] if c else 0)
    par = lambda pos, g: max(0.0, (g - repl.get(pos, 0)) * GAMES)
    pot = TEAMS * (B.get('default', 200) - ROSTER)               # auction dollars beyond $1 a roster spot
    # this league's own prices: the share of auction dollars each position has drawn over the last five auctions
    spend = {}
    for yr, lst in (REF.get('auction_results') or {}).items():
        if int(yr) >= season - 4:
            for a in lst:
                p = {'Def': 'DEF'}.get(a.get('player_pos'), a.get('player_pos'))
                if p in STARTERS:
                    spend[p] = spend.get(p, 0) + a['price']
    tot = sum(spend.values()) or 1
    share = {p: spend.get(p, 0) / tot for p in STARTERS}
    dpp = {}
    for p in STARTERS:
        tp = sum(par(p, proj(r)) for _, r in rows if r['pos'] == p)
        dpp[p] = pot * share[p] / tp if tp else 0

    budget = {f: float(B.get('default', 200)) for f in R['teams']}
    for tr in B.get('trades', []) + B.get('adjustments', []):
        for f, v in (tr.get('cash') or {}).items():
            budget[f] = budget.get(f, 200) + v

    # pick values: average points a season in a pick's first three seasons, by overall slot, smoothed by round
    slots = {}
    for yr, picks in (REF.get('draft_classes') or {}).items():
        for p in picks:
            ov = (int(p['round']) - 1) * TEAMS + int(p['pick'])
            pts = [s['points'] or 0 for s in (p.get('points_by_season') or []) if s['year'] <= int(yr) + 2]
            yrs = min(3, season - int(yr))
            if yrs > 0:
                slots.setdefault(ov, []).append(sum(pts) / yrs)
    def slot_val(ov):
        near = [v for k, vs in slots.items() if abs(k - ov) <= 2 for v in vs]
        return round(st.mean(near), 1) if near else 0.0
    picks = {f: [] for f in R['teams']}
    order = N.get('draftRounds') or {}
    for rd, lst in order.items():
        for p in lst:
            ov = (int(rd) - 1) * TEAMS + p['pick']
            picks.setdefault(p['owner'], []).append({'y': int(N.get('draftYear', season + 1)), 'r': int(rd), 's': p['pick'], 'from': p['id'], 'v': slot_val(ov)})
    for f in (FDP.get('futureDraftPicks') or {}).get('franchise', []):
        for p in f.get('futureDraftPick', []) if isinstance(f.get('futureDraftPick'), list) else [f.get('futureDraftPick')] if f.get('futureDraftPick') else []:
            if int(p['year']) == int(N.get('draftYear', season + 1)):
                continue
            ov = (int(p['round']) - 1) * TEAMS + 6.5
            picks.setdefault(f['id'], []).append({'y': int(p['year']), 'r': int(p['round']), 's': None, 'from': p['originalPickFor'], 'v': round(slot_val(ov) * .85, 1)})

    std = {s['id']: s for s in N.get('standings', [])}
    out = {}
    for fid, t in R['teams'].items():
        s = std.get(fid, {})
        games = s.get('w', 0) + s.get('l', 0) + s.get('t', 0)
        apg = s.get('allPlayW', 0) + s.get('allPlayL', 0) + s.get('allPlayT', 0)
        # best legal lineup for the rest of the season from the active roster
        act = sorted((r for r in t['rows'] if r['st'] == 'ROSTER'), key=lambda r: -proj(r))
        need, used, lineup = {'QB': 1, 'RB': 2, 'WR': 2, 'TE': 1, 'DEF': 1}, set(), []
        for r in act:
            if need.get(r['pos'], 0) > 0:
                need[r['pos']] -= 1; used.add(r['id']); lineup.append(r)
        flex = next((r for r in act if r['id'] not in used and r['pos'] in ('RB', 'WR', 'TE')), None)
        if flex:
            lineup.append(flex)
        players = []
        for r in t['rows']:
            nxt = (r.get('fut') or [None])[0]
            v27 = proj(r) * age_factor(r['pos'], r.get('age'))
            val = round(1 + par(r['pos'], v27) * dpp.get(r['pos'], 0), 1) if nxt is not None else 0
            players.append({'id': r['id'], 'name': r['name'], 'pos': r['pos'], 'age': r.get('age'), 'st': r['st'],
                            'sal': r['sal'], 'next': nxt, 'yrs': len(r.get('fut') or []), 'val': val, 'ppg': round(proj(r), 1)})
        # suggested keeps: value beats salary, two veteran QBs at most
        keep = [p for p in players if p['next'] is not None and p['val'] > p['next']]
        qbs = sorted((p for p in keep if p['pos'] == 'QB'), key=lambda p: p['next'] - p['val'])[2:]
        for p in players:
            p['keep'] = p in keep and p not in qbs
        out[fid] = {'pf': round(s.get('pf', 0) / games, 2) if games else 0, 'ap': round(s.get('allPlayW', 0) / apg, 3) if apg else 0,
                    'rec': [s.get('w', 0), s.get('l', 0), s.get('t', 0)], 'mfl': s.get('pwrRank'),
                    'ros': round(sum(proj(r) for r in lineup), 1), 'lineup': [r['id'] for r in lineup],
                    'budget': budget.get(fid, 200), 'players': sorted(players, key=lambda p: -p['val']), 'picks': sorted(picks.get(fid, []), key=lambda p: (p['y'], p['r'], p['s'] or 99))}
    json.dump({'built': datetime.now(timezone.utc).isoformat(timespec='seconds'), 'season': season, 'through': R.get('through'),
               'next': season + 1, 'roster': ROSTER, 'dpp': {p: round(v, 3) for p, v in dpp.items()}, 'share': {p: round(v, 3) for p, v in share.items()}, 'repl': {p: round(v, 1) for p, v in repl.items()},
               'weights': {'now': 35, 'keep': 30, 'cash': 20, 'picks': 15}, 'teams': out},
              open(D('power.json'), 'w', encoding='utf-8'), separators=(',', ':'))
    print('power.json:', len(out), 'teams', {p: round(v, 2) for p, v in dpp.items()})


if __name__ == '__main__':
    main()
