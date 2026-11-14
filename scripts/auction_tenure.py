"""What each auction buy gave the team that won him (Reference > Franchises > Auction history).

For every auction win in d['auction_results'], the stint runs from the auction season through each following season in
which he still scored for that team, and ends at the first season he didn't (or the season that team bought him again). Points are his regular-season points for
that team, bench and taxi included from 2021 on (MFL's weekly results); 2019 and 2020 have starters only on record.
Starts count the weeks he was in that team's lineup.

build_reference.py calls apply(d), which adds
  franchise_auction_buys: {franchise: [{year, player_id, player_name, player_pos, price,
      team_points_by_season: [{year, points, starts}], team_total, starts, on_team_now}]}
"""
import json
from pathlib import Path

DATA = Path(__file__).resolve().parent.parent / 'data'


def _load(p):
    try:
        return json.loads(Path(p).read_text())
    except Exception:
        return None


def weekly(current, po):
    """{year: {franchise: {pid: [points, starts]}}}, regular season only."""
    out = {}
    old = (_load(DATA / 'reference' / 'starters-2019-2020.json') or {}).get('seasons', {})
    for y in range(2019, current + 1):
        last = min(po.get(str(y)) or [15]) - 1
        if str(y) in old:
            wks = {int(w): {f: {'s': L} for f, L in fr.items()} for w, fr in old[str(y)].items()}
        else:
            wr = _load(DATA / 'mfl' / 'weeklyResults.json' if y == current else DATA / 'history' / str(y) / 'weeklyResults.json') or {}
            wks = {int(w): fr for w, fr in (wr.get('weeks') or {}).items()}
        T = out.setdefault(y, {})
        for w, fr in wks.items():
            if w > last:
                continue
            for f, t in fr.items():
                M = T.setdefault(f, {})
                for k in ('s', 'n'):
                    for pid, pts in t.get(k) or []:
                        r = M.setdefault(str(pid), [0.0, 0])
                        r[0] += float(pts or 0)
                        r[1] += k == 's'
    return out


def apply(d):
    current = int(d['meta']['current_year'])
    W = weekly(current, d.get('playoff_weeks_by_year') or {})
    ro = ((_load(DATA / 'mfl' / 'rosters.json') or {}).get('rosters') or {}).get('franchise') or []
    now = {(f.get('id'), str(p.get('id'))) for f in ro for p in (f.get('player') if isinstance(f.get('player'), list) else [f.get('player')] if f.get('player') else [])}
    try:
        import sys; sys.path.insert(0, str(Path(__file__).resolve().parent))
        from payroll import names_pos
        NM, POS, _ = names_pos()
    except Exception:
        NM, POS = {}, {}
    out = {}
    again = {}   # a later auction buy by the same team starts a new contract, so it ends the earlier stint
    for y, buys in (d.get('auction_results') or {}).items():
        for b in buys:
            again.setdefault((b.get('franchise'), str(b.get('player_id') or '')), set()).add(int(y))
    for y, buys in (d.get('auction_results') or {}).items():
        y = int(y)
        for b in buys:
            fr, pid = b.get('franchise'), str(b.get('player_id') or '')
            if not (fr and pid):
                continue
            seasons, yy = [], y
            while yy <= current:
                got = (W.get(yy) or {}).get(fr, {}).get(pid)
                if yy > y and (not got or yy in again[(fr, pid)]):
                    break
                seasons.append({'year': yy, 'points': round(got[0], 1) if got else 0.0, 'starts': got[1] if got else 0})
                yy += 1
            out.setdefault(fr, []).append({
                'year': y, 'player_id': pid, 'player_name': b.get('player_name') or NM.get(pid), 'player_pos': b.get('player_pos') or POS.get(pid),
                'price': b.get('price'), 'team_points_by_season': seasons,
                'team_total': round(sum(s['points'] for s in seasons), 1), 'starts': sum(s['starts'] for s in seasons),
                'on_team_now': (fr, pid) in now and seasons[-1]['year'] == current})
    for fr in out:
        out[fr].sort(key=lambda b: (-b['year'], -(b['price'] or 0)))
    d['franchise_auction_buys'] = out
    return d


if __name__ == '__main__':   # patch data/reference.json in place
    p = DATA / 'reference.json'
    d = apply(json.loads(p.read_text()))
    print({f: len(v) for f, v in sorted(d['franchise_auction_buys'].items())})
