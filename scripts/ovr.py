#!/usr/bin/env python3
"""The FBP OVR: one Madden-style rating (40-99) for every QB, RB, WR and TE, and how it moved week by week.

  55%  Madden fantasy score (data/madden.json, scripts/madden.py): EA's ratings weighted for fantasy
  45%  dynasty value: FantasyPros' dynasty consensus rank on a 58-99 scale
  +/-  up to 2.5 for FBP points per game against the position's starters so far
then stretched a little and eased into a soft ceiling, so only the very best get near 99. Players Madden doesn't
rate yet go on dynasty value alone, capped at 85.

History: one OVR per week played, using that week's Madden ratings and production through that week. FantasyPros
keeps no past rankings, so a week before this script ran uses today's dynasty rank; from then on each week's dynasty
value is saved (dyn) and reused. Writes data/ovr.json: {weeks, players: {mfl_id: {o, h: [OVR by week]}}, dyn}.
Run after stats.py and madden.py, before trade_values.py: python scripts/ovr.py
"""
import json, math, os
from collections import defaultdict
from datetime import datetime, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
D = lambda *p: os.path.join(ROOT, 'data', *p)
load = lambda p, d=None: json.load(open(p, encoding='utf-8')) if os.path.exists(p) else d
TOP = {'QB': 24, 'RB': 36, 'WR': 48, 'TE': 18}


def pv_of(rank):
    return 9999 * math.exp(-((max(rank, 1) - 1) / 95) ** 0.8)


def finish(o):
    o = 60 + (o - 60) * 1.04
    if o > 94:
        o = 94 + 5.6 * (1 - math.exp(-(o - 94) / 5))   # soft ceiling: only the very top get near 99
    return max(40, min(99, round(o)))


def main():
    st = load(D('stats.json'), {}) or {}
    weeks = st.get('weeks') or []
    rows = {r['id']: r for r in st.get('rows') or []}
    md = (load(D('madden.json'), {}) or {}).get('weeks') or {}
    mwk = sorted(int(w) for w in md)
    dyn_ecr = (load(D('fantasypros', 'dynasty-ecr.json'), {}) or {}).get('players') or {}
    P = (load(D('mfl', 'players.json'), {}) or {}).get('players') or {}
    pos_of = lambda pid: ((P.get(pid) or [None, ''])[1] if isinstance(P.get(pid), list) else (P.get(pid) or {}).get('position', '')) or (rows.get(pid) or {}).get('p', '')
    prev = load(D('ovr.json'), {}) or {}
    dyn_hist = prev.get('dyn') or {}

    F_now = {pid: round(58 + 41 * (pv_of(v[0]) / 9999) ** 0.9, 1) for pid, v in dyn_ecr.items() if v and v[0]}
    ids = {pid for pid in set(F_now) | {p for w in md.values() for p in w} | {r for r in rows if rows[r].get('p') in TOP}
           if pos_of(pid) in TOP}

    def madden(pid, w):
        for k in sorted((x for x in mwk if x <= w), reverse=True):
            if pid in md[str(k)]:
                return md[str(k)][pid]
        for k in mwk:   # before his first rated week, his earliest rating
            if pid in md[str(k)]:
                return md[str(k)][pid]
        return None

    def ppg_through(pid, i):
        w = [v for v in ((rows.get(pid) or {}).get('w') or [])[:i + 1] if v is not None]
        return sum(w) / len(w) if len(w) >= 2 else None

    def nudges(i):
        vals = {pid: ppg_through(pid, i) for pid in ids}
        by = defaultdict(list)
        for pid, v in vals.items():
            if v is not None:
                by[pos_of(pid)].append(v)
        stats = {}
        for pos, L in by.items():
            L = sorted(L, reverse=True)[:TOP[pos]]
            mu = sum(L) / len(L)
            sd = (sum((a - mu) ** 2 for a in L) / len(L)) ** .5 or 1
            stats[pos] = (mu, sd)
        return {pid: max(-2.5, min(2.5, (v - stats[pos_of(pid)][0]) / stats[pos_of(pid)][1] * 1.2)) if v is not None and pos_of(pid) in stats else 0
                for pid, v in vals.items()}

    def ovr(pid, w, F, nd):
        m = madden(pid, w)
        if m is None:
            return min(85, finish(F - 2)) if F > 58 else None
        return finish(.55 * m + .45 * F + nd)

    out = {pid: {'o': None, 'h': []} for pid in ids}
    for i, w in enumerate(weeks):
        nd = nudges(i)
        Fw = dyn_hist.get(str(w)) or {}
        for pid in ids:
            out[pid]['h'].append(ovr(pid, w, Fw.get(pid, F_now.get(pid, 58.0)), nd.get(pid, 0)))
    last = weeks[-1] if weeks else (mwk[-1] if mwk else 1)
    nd = nudges(len(weeks) - 1) if weeks else {}
    for pid in ids:
        out[pid]['o'] = ovr(pid, mwk[-1] if mwk else last, F_now.get(pid, 58.0), nd.get(pid, 0))
    out = {pid: v for pid, v in out.items() if v['o'] is not None}
    if weeks:   # keep this week's dynasty values so later rebuilds of this week use them
        dyn_hist[str(last)] = {pid: F_now[pid] for pid in out if pid in F_now}
    # Awards > Biggest Riser / Biggest Faller: OVR now against his first rated week, for anyone 70+ at either end
    ro = ((load(D('mfl', 'rosters.json'), {}) or {}).get('rosters') or {}).get('franchise') or []
    fbp = {str(p['id']): f['id'] for f in ro for p in (f.get('player') if isinstance(f.get('player'), list) else [f.get('player')] if f.get('player') else [])}
    def who(pid):
        m = P.get(pid) or {}
        n = (m[0] if isinstance(m, list) else m.get('name', '')) or (rows.get(pid) or {}).get('n', pid)
        if ', ' in n:
            last, first = n.split(', ', 1); n = f'{first} {last}'
        r = rows.get(pid) or {}
        nfl = {'GBP': 'GB', 'KCC': 'KC', 'NEP': 'NE', 'NOS': 'NO', 'SFO': 'SF', 'TBB': 'TB', 'LVR': 'LV', 'JAC': 'JAX'}.get(r.get('t') or '', r.get('t') or '')
        return {'id': pid, 'name': n, 'pos': pos_of(pid), 'nfl': nfl, 'espn': r.get('e') or '', 'team': fbp.get(pid, '')}
    mv = []
    for pid, v in out.items():
        h = [(weeks[i], x) for i, x in enumerate(v['h']) if x is not None]
        if len(h) >= 2 and max(h[0][1], v['o']) >= 70:
            mv.append(dict(who(pid), **{'from': h[0][1], 'to': v['o'], 'since': h[0][0], 'd': v['o'] - h[0][1]}))
    movers = {'up': sorted([m for m in mv if m['d'] > 0], key=lambda m: (-m['d'], -m['to']))[:5],
              'down': sorted([m for m in mv if m['d'] < 0], key=lambda m: (m['d'], -m['from']))[:5]}
    res = {'built': datetime.now(timezone.utc).isoformat(timespec='seconds'), 'weeks': weeks, 'movers': movers,
           'note': 'FBP OVR: 55% Madden fantasy score (from EA SPORTS Madden NFL ratings), 45% dynasty value (FantasyPros dynasty consensus), '
                   'plus up to 2.5 for FBP production. h: OVR after each week. dyn: dynasty value saved each week.',
           'players': out, 'dyn': dyn_hist}
    with open(D('ovr.json'), 'w', encoding='utf-8') as fh:
        json.dump(res, fh, separators=(',', ':'))
        fh.write('\n')
    print(f'  ok   OVR for {len(out)} players, weeks {weeks[0] if weeks else "-"}-{last}')


if __name__ == '__main__':
    main()
