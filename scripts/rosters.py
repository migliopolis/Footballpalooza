#!/usr/bin/env python3
"""Build data/rosters.json for League Now > Rosters: every FBP roster with contracts, stats and honors.

Per player: salary and contract year, future salaries from the by-law escalators, how he joined his current team,
this season's points (every week he was on an FBP roster, started or benched), rank among rostered players at his
position, this week's MFL projection, FantasyPros rest-of-season rank (data/fantasypros/ros-ecr.json), NFL bye
(data/reference/byes-2026.json) and this season's award chips.

Contracts: MFL's contract year, except that a player picked up off waivers or as a free agent this season is on a new
3-year veteran deal (1/3), whatever MFL shows. Escalators: veteran +$3, +$6; rookie +$3, +$6, +$9, +$12; a rookie on
taxi in year 1 is shown on the 6-year path (salary frozen in year 2, then +$3, +$6, +$9, +$12).

Acquired: the latest way the player joined his current team, from MFL transactions (every season saved), auctions
and rookie drafts. MFL's own "drafted" note is only a fallback.

Per team: points by week against the league average, low and high, and the Face of the Franchise.
Run after refresh_mfl.py, league_now.py, build_reference.py and player_records.py: python scripts/rosters.py
"""
import json, os, re, sys, collections
from datetime import datetime, date, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from payroll import names_pos
from player_records import lineups

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
D = lambda *p: os.path.join(ROOT, 'data', *p)
load = lambda p, d=None: json.load(open(p, encoding='utf-8')) if os.path.exists(p) else d
as_list = lambda x: x if isinstance(x, list) else ([x] if x else [])
STEP = {3: [3, 6], 5: [3, 6, 9, 12], 6: [0, 3, 6, 9, 12]}
TM = {'GBP': 'GB', 'KCC': 'KC', 'NEP': 'NE', 'NOS': 'NO', 'SFO': 'SF', 'TBB': 'TB', 'LVR': 'LV', 'JAX': 'JAC', 'WSH': 'WAS', 'LA': 'LAR'}
P_AWARDS = {'mvp': ['MVP', 'gold'], 'rookie': ['RoY', 'good'], 'value': ['Best Value', 'good'], 'waiver': ['Top Waiver', 'good'],
            'high': ['High Game', 'good'], 'bench': ['Bench Points', 'meh'], 'contract': ['Worst Contract', 'meh']}


def future(sal, n, N, status):
    if status == 'TAXI_SQUAD' and N == 5 and n == 1:
        N = 6
    out, v = [], sal
    for k in range(n, N):
        v += STEP[N][k - 1]
        out.append(v)
    return out


def acquisitions(cur, abbr):
    """{player: [(timestamp, franchise, label, kind, season)]}"""
    ev = collections.defaultdict(list)
    stamp = lambda ts: datetime.fromtimestamp(ts, timezone.utc).strftime('%b %Y')
    for y in range(2019, cur + 1):
        tx = (load(D('mfl', 'transactions.json') if y == cur else D('history', str(y), 'transactions.json'), {}) or {}).get('transactions') or []
        for x in tx:
            ts = int(x.get('timestamp') or 0); d = stamp(ts)
            if x.get('type') == 'BBID_WAIVER':
                parts = (x.get('transaction', '') + '||').split('|')
                for p in filter(None, parts[0].split(',')):
                    ev[p].append((ts, x['franchise'], f'Waivers · {d}', 'waiver', y))
            elif x.get('type') == 'FREE_AGENT':
                for p in filter(None, x.get('transaction', '').split('|')[0].split(',')):
                    ev[p].append((ts, x['franchise'], f'Free agent · {d}', 'fa', y))
            elif x.get('type') == 'TRADE':
                f1, f2 = x['franchise'], x.get('franchise2')
                for gave, to, frm in (('franchise1_gave_up', f2, f1), ('franchise2_gave_up', f1, f2)):
                    for p in x.get(gave, '').split(','):
                        if p and not p.startswith(('FP_', 'DP_')):
                            ev[p].append((ts, to, f'Trade from {abbr(frm)} · {d}', 'trade', y))
    ref = load(D('reference.json'), {}) or {}
    for y, lst in (ref.get('auction_results') or {}).items():
        for a in lst:
            ts = int(a.get('timestamp') or datetime(int(y), 8, 25, tzinfo=timezone.utc).timestamp())
            ev[a['player_id']].append((ts, a['franchise'], f"Auction ${a['price']} · {y}", 'auction', int(y)))
    au = (((load(D('mfl', 'auctionResults.json'), {}) or {}).get('auctionResults') or {}).get('auctionUnit') or {}).get('auction')
    for a in as_list(au):
        ev[a['player']].append((int(a.get('lastBidTime') or 0), a['franchise'], f"Auction ${a['winningBid']} · {cur}", 'auction', cur))
    for y, lst in (ref.get('draft_classes') or {}).items():
        for a in lst:
            ts = int(datetime(int(y), 6, 20, tzinfo=timezone.utc).timestamp())
            ev[a['player_id']].append((ts, a['franchise'], f"Draft {int(a['round'])}.{a['pick']} · {y}", 'draft', int(y)))
    dr = (((load(D('mfl', 'draftResults.json'), {}) or {}).get('draftResults') or {}).get('draftUnit') or {}).get('draftPick')
    for a in as_list(dr):
        if a.get('player'):
            ev[a['player']].append((int(a.get('timestamp') or 0), a['franchise'], f"Draft {int(a['round'])}.{a['pick']} · {cur}", 'draft', cur))
    return ev


def honors_now(aw):
    """this season's chips: {player: [[label, color, title]]}"""
    H = collections.defaultdict(list)
    af = (aw or {}).get('allFbp') or {}
    for k, l, c in (('first', '1st Team', 'gold'), ('second', '2nd Team', 'silver')):
        for x in af.get(k, []):
            if x.get('player'):
                H[x['player']['id']].append([l, c, f'All-FBP {l}'])
    potw = collections.Counter()
    for a in (aw or {}).get('awards', []):
        if a.get('key') in P_AWARDS and a.get('list'):
            H[a['list'][0]['id']].append(P_AWARDS[a['key']] + [f"{a.get('title', '')}: {a.get('why', '')}"])
        if a.get('key') == 'trade' and (a.get('trade') or {}).get('winner'):
            W = a['trade']['winner']; later = W.get('later') or {}; cur = later.get('current')
            rows = [((r.get('pts') or {}).get(cur, 0), r['id']) for r in later.get('rows', [])]
            if rows and max(rows)[0] > 0:
                H[max(rows)[1]].append(['ToY', 'good', 'Trade of the Year'])
        if a.get('key') == 'week':
            for w, L in (a.get('weeks') or {}).items():
                if L:
                    potw[L[0]['id']] += 1
    for pid, n in potw.items():
        H[pid].append(['POTW' + (f' ×{n}' if n > 1 else ''), 'good', f'Player of the Week {n} time' + ('s' if n > 1 else '')])
    return H


def face_of_franchise(cur, rostered, names, pos, espn):
    """{franchise: {...}}: the current player with the most history with that team (starts, seasons, honors, titles)."""
    pr = load(D('player-records.json'), {}) or {}
    tf = pr.get('team_fields', [])
    rec = {}
    for row in pr.get('players', []):
        for t in row[-1]:
            rec[(row[0], t[0])] = dict(zip(tf, t))
    hon = collections.defaultdict(lambda: collections.Counter())
    for y in range(2019, cur + 1):
        aw = load(D('awards.json') if y == cur else D('awards', f'{y}.json'))
        if not aw:
            continue
        for k, l in (('first', '1st Team'), ('second', '2nd Team')):
            for x in (aw.get('allFbp') or {}).get(k, []):
                p = x.get('player') or {}
                if p.get('team'):
                    hon[(p['id'], p['team'])][l] += 1
        for a in aw.get('awards', []):
            if a.get('key') in ('mvp', 'rookie') and a.get('list'):
                p = a['list'][0]
                if p.get('team'):
                    hon[(p['id'], p['team'])][{'mvp': 'MVP', 'rookie': 'RoY'}[a['key']]] += 1
    # titles: started the championship game for the champion
    ref = load(D('reference.json'), {}) or {}
    L = lineups(cur)
    titles = collections.Counter()
    for y, c in (ref.get('championships') or {}).items():
        wk = (L.get(int(y)) or {}).get(int(c.get('week') or 0)) or {}
        for pid, _ in wk.get(c['champion'], []):
            titles[(pid, c['champion'])] += 1
    out = {}
    for f, pids in rostered.items():
        best = None
        for pid in pids:
            r = rec.get((pid, f), {})
            starts = sum(r.get(k, 0) for k in ('w', 'l', 't', 'pw', 'pl', 'pt'))
            seasons = len(r.get('years', []))
            h = hon[(pid, f)]; ti = titles[(pid, f)]
            score = starts + 4 * seasons + 12 * h['1st Team'] + 6 * h['2nd Team'] + 10 * h['MVP'] + 4 * h['RoY'] + 15 * ti
            if score and (not best or score > best[0]):
                yrs = r.get('years', [])
                best = (score, {'id': pid, 'name': names.get(pid, pid), 'pos': pos.get(pid, ''), 'espn': espn.get(pid, '') or '',
                                'seasons': seasons, 'first': min(yrs) if yrs else None, 'starts': starts,
                                'w': r.get('w', 0) + r.get('pw', 0), 'l': r.get('l', 0) + r.get('pl', 0), 't': r.get('t', 0) + r.get('pt', 0),
                                'honors': {k: v for k, v in h.items()}, 'titles': ti})
        if best:
            out[f] = best[1]
    return out


def main():
    ln = load(D('league-now.json'))
    played = int(ln['weeksPlayed'])
    cur = int((load(D('reference.json'), {}) or {}).get('meta', {}).get('current_year') or datetime.now().year)
    names, pos, espn = names_pos()
    league = ((load(D('mfl', 'league.json'), {}) or {}).get('league') or {})
    fr = {f['id']: f for f in as_list((league.get('franchises') or {}).get('franchise'))}
    teams = (load(D('teams.json'), {}) or {}).get('teams', {})
    abbr = lambda f: (teams.get(f) or {}).get('abbr', f)
    pl = load(D('mfl', 'players.json'), {}) or {}
    P = {k: dict(zip(pl.get('fields', []), v)) for k, v in (pl.get('players') or {}).items()}
    st = {s['id']: s for s in ln['standings']}
    wr = (load(D('mfl', 'weeklyResults.json'), {}) or {}).get('weeks', {})
    proj = load(D('mfl', 'projections.json'), {}) or {}
    pw = str(proj.get('week') or played + 1); PJ = (proj.get('players') or {}).get(pw, {})
    ecr = load(D('fantasypros', 'ros-ecr.json'), {}) or {}
    byes = (load(D('reference', 'byes-2026.json'), {}) or {}).get('byes', {})
    H = honors_now(load(D('awards.json'), {}))
    ev = acquisitions(cur, abbr)

    pts, wks = collections.defaultdict(float), {}
    for w, ft in wr.items():
        if int(w) > played:
            continue
        for f, t in ft.items():
            for pid, x in t.get('s', []):
                pts[pid] += x; wks.setdefault(pid, {})[w] = [x, 1, abbr(f)]
            for pid, x in t.get('n', []):
                pts[pid] += x; wks.setdefault(pid, {})[w] = [x, 0, abbr(f)]
    byPos = collections.defaultdict(list)
    for pid, v in pts.items():
        byPos[pos.get(pid)].append((v, pid))
    rk = {pid: i + 1 for lst in byPos.values() for i, (_, pid) in enumerate(sorted(lst, reverse=True))}
    today = date.today()

    def age(b):
        try:
            d = date.fromtimestamp(int(b)); return today.year - d.year - ((today.month, today.day) < (d.month, d.day))
        except (TypeError, ValueError):
            return None

    # team weeks
    games = {}
    for w, a, sa, b, sb in ln.get('games', []):
        games[(w, a)] = (b, sa, sb); games[(w, b)] = (a, sb, sa)
    team_weeks = collections.defaultdict(list)
    for w in range(1, played + 1):
        sc = {f: round(sum(x[1] for x in t.get('s', [])), 1) for f, t in (wr.get(str(w)) or {}).items()}
        if not sc:
            continue
        avg = sum(sc.values()) / len(sc)
        for f, v in sc.items():
            o = games.get((w, f))
            res = None if not o else 'W' if o[1] > o[2] else 'L' if o[1] < o[2] else 'T'
            team_weeks[f].append({'w': w, 'pts': v, 'avg': round(avg, 1), 'hi': max(sc.values()), 'lo': min(sc.values()),
                                  'res': res, 'opp': o[0] if o else None, 'oppPts': o[2] if o else None})

    rosters = ((load(D('mfl', 'rosters.json'), {}) or {}).get('rosters') or {}).get('franchise', [])
    out_t, fixed = {}, 0
    for f in rosters:
        rows = []
        for p in as_list(f.get('player')):
            pid = p['id']; i = P.get(pid, {}); s = float(p.get('salary') or 0)
            e = sorted(x for x in ev.get(pid, []) if x[1] == f['id'])
            a = e[-1] if e else None
            m = re.match(r'(\d+)/(\d+)', (p.get('contractYear') or '').strip())
            n, N = (int(m[1]), int(m[2])) if m else (None, None)
            new_deal = bool(a and a[3] in ('waiver', 'fa') and a[4] == cur)
            if new_deal:
                fixed += (n, N) != (1, 3)
                n, N = 1, 3
            nfl = i.get('team', '')
            ec = (ecr.get('players') or {}).get(pid)
            rows.append({'id': pid, 'name': names.get(pid, pid), 'pos': pos.get(pid, ''), 'nfl': nfl, 'age': age(i.get('birthdate')),
                         'espn': espn.get(pid, '') or '', 'st': p.get('status'), 'sal': s,
                         'cy': f'{n}/{N}' if N else '', 'newDeal': new_deal, 'fut': future(s, n, N, p.get('status')) if N else None,
                         'acq': a[2] if a else (p.get('drafted') or ''),
                         'pts': round(pts.get(pid, 0), 1), 'wks': wks.get(pid, {}), 'rk': rk.get(pid),
                         'ecr': ec[0] if ec else None, 'ecrPos': ec[1] if ec else None, 'bye': byes.get(TM.get(nfl, nfl)),
                         'proj': PJ.get(pid), 'hon': H.get(pid, [])})
        o = (fr.get(f['id'], {}).get('owner_name') or '').split()
        s = st.get(f['id'], {})
        W = team_weeks.get(f['id'], [])
        # first name and last initial; a two-word last name uses its first word (Collin Del Cuore -> Collin D.)
        out_t[f['id']] = {'name': fr.get(f['id'], {}).get('name', f['id']), 'owner': f"{o[0]} {o[1][0]}." if len(o) > 1 else (o[0] if o else ''),
                          'rec': [s.get('w', 0), s.get('l', 0), s.get('t', 0)], 'pf': s.get('pf', 0),
                          'paa': round(sum(x['pts'] - x['avg'] for x in W), 1), 'weeks': W, 'rows': rows}
    paa_order = sorted(out_t, key=lambda f: -out_t[f]['paa'])
    for f in out_t:
        out_t[f]['paaRank'] = paa_order.index(f) + 1
    face = face_of_franchise(cur, {f: [r['id'] for r in t['rows'] if r['pos'] != 'DEF'] for f, t in out_t.items()}, names, pos, espn)
    for f, v in face.items():
        out_t[f]['face'] = v
    out = {'built': datetime.now(timezone.utc).isoformat(timespec='seconds'), 'season': cur, 'through': played, 'projWeek': int(pw),
           'ecrUpdated': ecr.get('updated'), 'teams': out_t}
    with open(D('rosters.json'), 'w', encoding='utf-8') as fh:
        json.dump(out, fh, separators=(',', ':'), ensure_ascii=False)
        fh.write('\n')
    print(f'rosters: {sum(len(t["rows"]) for t in out_t.values())} players on {len(out_t)} teams, '
          f'{fixed} contracts set to 1/3 from this season\'s pickups, faces for {len(face)} teams')


if __name__ == '__main__':
    main()
