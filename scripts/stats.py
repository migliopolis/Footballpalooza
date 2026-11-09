#!/usr/bin/env python3
"""Build data/stats.json for League Now > Stats: every player's FBP points by week this season.

One row per player who has scored in any week (data/mfl/weeklyScores.json), with his NFL team, bye week, ESPN id,
and, if he's on an FBP roster, the franchise, roster slot, salary and contract year (data/rosters.json). The page
does the filtering, week ranges, sorting and averages.
Run after refresh_mfl.py and rosters.py: python scripts/stats.py
"""
import json, os
from datetime import datetime, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
D = lambda *p: os.path.join(ROOT, 'data', *p)
load = lambda p, d=None: json.load(open(p, encoding='utf-8')) if os.path.exists(p) else d
TO_FP = {'GBP': 'GB', 'KCC': 'KC', 'NEP': 'NE', 'NOS': 'NO', 'SFO': 'SF', 'TBB': 'TB', 'LVR': 'LV', 'JAC': 'JAX', 'WAS': 'WAS', 'LA': 'LAR'}
SLOT = {'ROSTER': '', 'TAXI_SQUAD': 'T', 'INJURED_RESERVE': 'IR'}


def main():
    ws = (load(D('mfl', 'weeklyScores.json'), {}) or {}).get('weeks', {})
    MP = load(D('mfl', 'players.json'), {}) or {}
    F = MP.get('fields', [])
    P = {k: dict(zip(F, v)) for k, v in (MP.get('players') or {}).items()}
    R = load(D('rosters.json'), {}) or {}
    byes = (load(D('reference', 'byes-2026.json'), {}) or {}).get('byes', {})
    weeks = sorted((int(w) for w in ws), key=int)
    on = {}
    for fid, t in (R.get('teams') or {}).items():
        for r in t['rows']:
            on[r['id']] = (fid, r)
    rows = []
    ids = {pid for w in ws.values() for pid in w} | set(on)
    for pid in ids:
        p = P.get(pid)
        if not p or p.get('position') not in ('QB', 'RB', 'WR', 'TE', 'Def'):
            continue
        sc = [ws.get(str(w), {}).get(pid) for w in weeks]
        if not any(s not in (None, 0) for s in sc) and pid not in on:
            continue
        last, _, first = p['name'].partition(', ')
        team = p.get('team') or ''
        fid, r = on.get(pid, (None, None))
        rows.append({
            'id': pid, 'n': (first + ' ' + last).strip() if p.get('position') != 'Def' else last + ' D',
            'p': 'DEF' if p['position'] == 'Def' else p['position'], 't': team if team != 'FA' else '', 'e': p.get('espn_id') or '',
            'bye': byes.get(TO_FP.get(team, team)), 'f': fid, 'sl': SLOT.get(r['st'], '') if r else None,
            'sal': r['sal'] if r else None, 'cy': r['cy'] if r else None, 'hon': [h[:2] for h in r.get('hon', [])] if r else [],
            'w': [None if s is None else round(float(s), 1) for s in sc],
        })
    json.dump({'built': datetime.now(timezone.utc).isoformat(timespec='seconds'), 'season': R.get('season'),
               'weeks': weeks, 'rows': rows}, open(D('stats.json'), 'w', encoding='utf-8'), separators=(',', ':'))
    print('stats.json:', len(rows), 'players, weeks', weeks[:1], '-', weeks[-1:])


if __name__ == '__main__':
    main()
