"""Player Value and Trade Value for every rostered player and rookie pick: data/values.json; and data/rankings.json
(League Now > Rankings: every ranked or rostered player, see rankings() below).

Player Value (PV, 1-9999): ability, potential and production, nothing about money. From FantasyPros' dynasty consensus
rank (data/fantasypros/dynasty-ecr.json, from the daily FantasyPros pull): 9999 for the top player, sliding down a curve
  PV = 9999 * exp(-((rank - 1) / 95) ** 0.8)
(rank 25 is about 7,000, rank 50 about 5,500, rank 100 about 3,500, rank 200 about 1,600). Unranked: rank 500.

Trade Value (TV, 1-9999): what he's worth in a trade between FBP owners. Talent leads and the contract adjusts it:
  TV = talent x contract, scaled so the best is 9999
  talent   = 9999 * (value / 9999) ** 1.5   stars count for more than the sum of lesser players (you don't trade
             a great player for two good ones, or for a bad one on a cheap deal), averaged over the seasons he's
             under control: this season on his value right now (now_values: half FBP points per game, half the
             FantasyPros rest-of-season rank), counted double because the playoff run is what a contender buys;
             next season half now, half dynasty; later seasons dynasty alone, except a player under his position's
             peak age: two thirds now for every later year when he's producing above his rank (a breakout); when
             he isn't, his dynasty value as a rookie and half now, half dynasty after that. So a player producing now on a deal
             that runs past this season is worth a lot; an expiring one is worth what he does the rest of this year
  contract = (0.55 + 0.45 * control) * (1 + 0.3 * surplus), between about 0.4 and 1.3
    control: how much of him you get, the rest of this season plus each year left on his deal (each later year
             10% less), as a share of three seasons; an expiring contract is mostly this season. A year his salary
             would run past what he'd fetch at auction is the year he gets let go, so the deal ends there: a
             three-year contract whose last year is too expensive counts as two
    surplus: over those same seasons, what he'd fetch at auction (market $ = 80 * (PV / 9999) ** 1.8, a little
             less each year past his position's peak age) against what he's paid, as a share of what he'd fetch,
             from -1 (paid far more than he's worth) to +1 (nearly free)
So a cheap deal lifts a player and a big or short one lowers him, but by at most a third either way: a star on a
fair contract stays well above a good young player on a cheap one.

Rookie picks: the rookie a pick usually lands (pick 1.01 about the 14th player in dynasty rankings, 1.12 about
the 100th, then 10 places a pick) on a 3-year rookie deal at the by-law rookie salary for the slot, 20% off for the
chance he misses. 2027 picks use the
draft order as it stands today; later years assume the middle of the round.

Also per team: position strength (the top 2 QBs, 4 RBs, 5 WRs, 2 TEs and all picks, by PV and by TV) and ranks,
average age of the active roster, and whether they still have their own 2027 1st. Standard library only.
"""
import json, math, os
from datetime import datetime, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
D = lambda *p: os.path.join(ROOT, 'data', *p)


def load(p, d=None):
    try:
        return json.load(open(p))
    except Exception:
        return d


PEAK = {'QB': 31, 'RB': 26, 'WR': 28, 'TE': 29, 'DEF': 99}
DROP = {'QB': .05, 'RB': .08, 'WR': .06, 'TE': .06, 'DEF': 0}
TOP = {'QB': 2, 'RB': 4, 'WR': 5, 'TE': 2}
ORD = {1: '1st', 2: '2nd', 3: '3rd', 4: '4th'}


def pv_of(rank):
    return 9999 * math.exp(-((max(rank, 1) - 1) / 95) ** 0.8)


def market(pv):
    return 80 * (pv / 9999) ** 1.8


def contract_tv(pv, val, cost, ctl, talent=None):
    """Talent times the contract: see the top of the file."""
    talent = 9999 * (pv / 9999) ** 1.5 if talent is None else talent
    control = min(1.0, ctl / 3.0)
    surplus = max(-1.0, min(1.0, (val - cost) / val)) if val > 0 else 0.0
    return talent * (0.55 + 0.45 * control) * (1 + 0.3 * surplus)


NOW_W = 2.0   # a week of this season counts double a week of a later one: the playoff run is what a contender is buying


def talent_of(pv):
    return 9999 * (pv / 9999) ** 1.5


def now_values(R):
    """Player Value for right now, by MFL id: half the FantasyPros rest-of-season rank, half FBP points per game
    (4+ games), each turned into an overall rank and then a 1-9999 value on the same curve as Player Value. A points
    per game rank at a position becomes the overall rank of the rest-of-season consensus player at that spot, so
    the 8th-best RB by points counts like the consensus RB8."""
    ROS = (load(D('fantasypros', 'ros-ecr.json'), {}) or {}).get('players') or {}
    ST = (load(D('stats.json'), {}) or {}).get('rows') or []
    by_pos = {}
    # the consensus overall rank of each position rank (RB8 -> its overall rank)
    pos_of = {r['id']: r['p'] for r in ST}
    for pid, v in ROS.items():
        if v and v[0] and v[1] and pos_of.get(pid):
            by_pos.setdefault(pos_of[pid], {})[v[1]] = v[0]
    def overall(pos, n):
        t = by_pos.get(pos) or {}
        if n in t:
            return t[n]
        ks = sorted(t)
        return (t[ks[-1]] + 6 * (n - ks[-1])) if ks and n > ks[-1] else 500
    ppg = {}
    for r in ST:
        w = [x for x in (r.get('w') or []) if x is not None]
        if len(w) >= 4 and r.get("p") in ("QB", "RB", "WR", "TE"):
            ppg[r['id']] = (r['p'], sum(w) / len(w))
    prod = {}
    for pos in ('QB', 'RB', 'WR', 'TE'):
        L = sorted((v[1], k) for k, v in ppg.items() if v[0] == pos)[::-1]
        for i, (_, k) in enumerate(L):
            prod[k] = overall(pos, i + 1)
    out = {}
    for pid in set(prod) | {k for k, v in ROS.items() if v and v[0]}:
        a = pv_of(ROS[pid][0]) if ROS.get(pid) and ROS[pid][0] else None
        b = pv_of(prod[pid]) if pid in prod else None
        out[pid] = (a + b) / 2 if a is not None and b is not None else (a if a is not None else b)
    return out


def pick_rank(n):   # overall pick number -> the dynasty rank of the rookie it usually lands
    return 14 + 8 * (n - 1) if n <= 12 else 102 + 10 * (n - 12)


PRICING = load(os.path.join(ROOT, 'rookie-pricer', 'pricing.json'), {}) or {}


def pick_salary(n):   # the by-law rookie salary for the slot, averaged over RB and WR (the usual early picks)
    P = PRICING.get('positions') or {}
    if n <= 24 and P.get('RB') and P.get('WR'):
        i = min(int(n) - 1, len(P['RB']['fbp']) - 1)
        return max(PRICING.get('minimumRounds1to2', 3), round((P['RB']['max'] * P['RB']['fbp'][i] + P['WR']['max'] * P['WR']['fbp'][i]) / 2))
    if n <= 24:
        return max(3, round(22 * (1 - (n - 1) / 26)))
    return 2 if n <= 36 else 1


def main():
    R = load(D('rosters.json'), {}) or {}
    E = (load(D('fantasypros', 'dynasty-ecr.json'), {}) or {}).get('players') or {}
    LN = load(D('league-now.json'), {}) or {}
    TF = load(D('trading-floor.json'), {}) or {}
    teams = load(D('teams.json'), {}) or {}
    teams = teams.get('teams', teams)
    season = int(R.get('season') or 2026)
    through = int(R.get('through') or 0)
    left = max(0, (14 - through + 2) / 17)   # rest of the regular season plus about two playoff weeks
    NOW = now_values(R)
    MP = load(D('mfl', 'players.json'), {}) or {}
    fi = (MP.get('fields') or []).index('draft_year') if 'draft_year' in (MP.get('fields') or []) else None
    DY = {k: int(v[fi]) for k, v in (MP.get('players') or {}).items() if fi is not None and str(v[fi]).isdigit()}   # NFL draft year
    rows, raw = {}, {}
    for f, t in (R.get('teams') or {}).items():
        for r in t.get('rows', []):
            pos = r.get('pos')
            rank = (E.get(str(r['id'])) or [500])[0]
            pv = pv_of(rank)
            m = market(pv)
            age = r.get('age') or 26
            # this season runs on what he's doing now (production and the rest-of-season consensus); next season is
            # half now, half dynasty; after that, dynasty alone
            nv = NOW.get(str(r['id']), pv)
            # a young player producing above his dynasty rank is breaking out: every later year of his deal leans two
            # thirds on what he's doing now, since the long-term consensus is slow to catch up. A rookie not producing
            # yet keeps his dynasty value for those years; after his rookie year, falling short counts half
            young = age < PEAK.get(pos, 28)
            rookie = DY.get(str(r['id'])) == season
            def pvs(k):
                if k < 0:
                    return nv
                if young and nv >= pv:
                    return (2 * nv + pv) / 3      # breaking out
                if young and rookie:
                    return pv                     # a rookie not producing yet keeps his dynasty value
                if young:
                    return (nv + pv) / 2          # past his rookie year, falling short counts against the years ahead
                return (nv + pv) / 2 if k == 0 else pv
            w0 = left * NOW_W
            val, cost, ctl = market(nv) * left, 0.0, left
            tw, tsum = w0, w0 * talent_of(nv)
            # an owner only keeps him while he's worth his salary: the first year his raise outruns what he'd fetch
            # at auction, he's let go, so that year and the rest of the deal don't count, for or against him
            for k, sal in enumerate(r.get('fut') or []):
                yrs_past = max(0, age + k + 1 - PEAK.get(pos, 28))
                # his auction price that year: the better of the long view and the blend with what he's doing now
                worth = market(max(pv, pvs(k))) * (1 - DROP.get(pos, .06)) ** yrs_past
                if worth < (sal or 0):
                    break
                val += 0.9 ** k * worth
                cost += 0.9 ** k * (sal or 0)
                ctl += 0.9 ** k
                tw += 0.9 ** k; tsum += 0.9 ** k * talent_of(pvs(k))
            tv = contract_tv(pv, val, cost + (r.get('sal') or 0) * left, ctl, talent=tsum / tw if tw else None)
            raw[r['id']] = tv
            rows[r['id']] = {'f': f, 'n': r['name'], 'pos': pos, 'age': r.get('age'), 'st': r.get('st'), 'sal': r.get('sal'),
                             'rank': rank if rank < 500 else None, 'pv': round(pv), 'mkt': round(m, 1),
                             'nv': round(nv), 'mkt27': round(market((nv + pv) / 2), 1)}
    # rookie picks
    order = {d['id']: d['pick'] for d in (LN.get('draftOrder') or [])}
    picks = []
    for f, t in (TF.get('teams') or {}).items():
        for p in t.get('picks') or []:
            slot = order.get(p['from'], 6.5) if p['y'] == season + 1 else 6.5
            n = (p['r'] - 1) * 12 + slot
            pv = pv_of(pick_rank(n))
            m = market(pv)
            s0 = pick_salary(round(n))
            # three rookie seasons from the draft after this one, 20% off for the chance the pick misses
            d0 = p['y'] - season - 1
            val = sum(0.9 ** (k + d0) * m for k in range(3)); cost = sum(0.9 ** (k + d0) * (s0 + [0, 3, 6][k]) for k in range(3))
            sur = 0.8 * contract_tv(pv, val, cost, sum(0.9 ** (k + d0) for k in range(3)))
            key = f"P{p['y']}-{p['r']}-{p['from']}"
            raw[key] = sur
            nm = (teams.get(p['from']) or {}).get('abbr', p['from'])
            picks.append({'id': key, 'f': f, 'y': p['y'], 'r': p['r'], 'from': p['from'],
                          'n': f"{p['y']} {ORD.get(p['r'], str(p['r']) + 'th')}{'' if p['from'] == f else ' (' + nm + ')'}",
                          'slot': None if slot == 6.5 else int(slot), 'pv': round(pv)})
    # the FBP OVR (scripts/ovr.py) for every player, and for a pick the OVR of the rookie its slot usually lands
    OV = (load(D('ovr.json'), {}) or {}).get('players') or {}
    for k, r in rows.items():
        r['o'] = (OV.get(k) or {}).get('o')
    for p in picks:
        p['o'] = min(85, round(58 + 41 * (p['pv'] / 9999) ** 0.9 - 2))
    top = max(raw.values()) if raw else 1
    scale = lambda v: max(1, round(9999 * v / top)) if v > 0 else 1
    for k, r in rows.items():
        r['tv'] = scale(raw[k])
    for p in picks:
        p['tv'] = scale(raw[p['id']])
    # team summaries
    T = {}
    for f, t in (R.get('teams') or {}).items():
        mine = [r for r in rows.values() if r['f'] == f]
        act = [r for r in mine if r['st'] == 'ROSTER' and r['pos'] != 'DEF' and r['age']]
        pk = [p for p in picks if p['f'] == f]
        pos = {}
        for P, n in TOP.items():
            L = [r for r in mine if r['pos'] == P]
            oo = sorted((r['o'] for r in L if r.get('o')), reverse=True)[:n]
            pos[P] = {'pv': sum(sorted((r['pv'] for r in L), reverse=True)[:n]), 'tv': sum(sorted((r['tv'] for r in L), reverse=True)[:n]),
                      'o': round(sum(oo + [50] * (n - len(oo))) / n, 1)}   # an empty spot counts as a 50
        po = sorted((p['o'] for p in pk), reverse=True)[:3]
        pos['PICK'] = {'pv': sum(p['pv'] for p in pk), 'tv': sum(p['tv'] for p in pk), 'o': round(sum(po + [50] * (3 - len(po))) / 3, 1)}
        T[f] = {'pos': pos, 'age': round(sum(r['age'] for r in act) / len(act), 1) if act else None,
                'own1': any(p['y'] == season + 1 and p['r'] == 1 and p['from'] == f for p in pk),
                'pv': sum(r['pv'] for r in mine) + pos['PICK']['pv'], 'tv': sum(r['tv'] for r in mine) + pos['PICK']['tv'],
                'o': round(sum(pos[P]['o'] * n for P, n in TOP.items()) / sum(TOP.values()), 1)}   # team OVR: its top 2 QBs, 4 RBs, 5 WRs, 2 TEs
    for P in list(TOP) + ['PICK']:
        for k in ('pv', 'tv', 'o'):
            s = sorted(T, key=lambda f: -T[f]['pos'][P][k])
            for i, f in enumerate(s):
                T[f]['pos'][P][k + 'R'] = i + 1
    for k in ('pv', 'tv', 'o'):
        for i, f in enumerate(sorted(T, key=lambda f: -T[f][k])):
            T[f][k + 'R'] = i + 1
    out = {'built': datetime.now(timezone.utc).isoformat(timespec='seconds'), 'season': season, 'through': through,
           'ecrUpdated': (load(D('fantasypros', 'dynasty-ecr.json'), {}) or {}).get('updated'),
           'players': rows, 'picks': sorted(picks, key=lambda p: -p['tv']), 'teams': T}
    with open(D('values.json'), 'w') as fh:
        json.dump(out, fh, separators=(',', ':'), ensure_ascii=False)
        fh.write('\n')
    rankings(rows, E, season)
    best = sorted(rows.values(), key=lambda r: -r['tv'])[:5]
    print(f"values: {len(rows)} players, {len(picks)} picks; top trade values: " + ', '.join(f"{r['n']} {r['tv']}" for r in best))


def ovr_move(v):
    """OVR now against the week before (ovr.json h), for the Rankings arrow; 0 when he didn't move or there's no prior week."""
    if not v or v.get('o') is None:
        return 0
    h = [x for x in (v.get('h') or [])[:-1] if x is not None]
    return v['o'] - h[-1] if h else 0


def rankings(rows, E, season):
    """data/rankings.json for League Now > Rankings: every player FantasyPros ranks (dynasty or rest of season) plus
    everyone on an FBP roster, with his FBP team and contract, Player Value (everyone ranked) and Trade Value
    (rostered players: a free agent has no FBP contract yet), the FBP OVR (scripts/ovr.py), Heat Check score and FBP points."""
    ROS = (load(D('fantasypros', 'ros-ecr.json'), {}) or {}).get('players') or {}
    RK = (load(D('fantasypros', 'rookies-ecr.json'), {}) or {}).get('players') or {}
    MP = load(D('mfl', 'players.json'), {}) or {}
    mf = {k: dict(zip(MP.get('fields') or [], v)) for k, v in (MP.get('players') or {}).items()}
    S = {r['id']: r for r in ((load(D('stats.json'), {}) or {}).get('rows') or [])}
    H = (load(D('analytics.json'), {}) or {}).get('heatPlayers') or {}
    OV = (load(D('ovr.json'), {}) or {}).get('players') or {}
    now = datetime.now(timezone.utc).timestamp()
    out = []
    for pid in set(E) | set(ROS) | set(rows) | set(RK):
        m = mf.get(pid) or {}
        if not m and pid not in rows:
            continue
        pos = {'Def': 'DEF', 'PK': 'K'}.get(m.get('position'), m.get('position')) or (rows.get(pid) or {}).get('pos')
        if pos not in ('QB', 'RB', 'WR', 'TE', 'DEF'):
            continue
        n = m.get('name') or (rows.get(pid) or {}).get('n') or pid
        if ', ' in n:
            last, first = n.split(', ', 1)
            n = f'{first} {last}' if pos != 'DEF' else f'{last} {first}'
        try:
            age = round((now - int(m['birthdate'])) / 31557600, 1) if m.get('birthdate') else None
        except ValueError:
            age = None
        st, r, h = S.get(pid) or {}, rows.get(pid), H.get(pid)
        w = [x for x in (st.get('w') or []) if x is not None]
        d = E.get(pid)
        out.append({'id': pid, 'n': n, 'pos': pos, 'nfl': m.get('team') or st.get('t') or '', 'age': age,
                    'dy': int(m['draft_year']) if (m.get('draft_year') or '').isdigit() else None, 'e': m.get('espn_id') or st.get('e') or '',
                    'f': r['f'] if r else st.get('f') or '', 'st': r['st'] if r else '', 'sal': r['sal'] if r else None, 'cy': st.get('cy') or '',
                    'd': d, 'r': ROS.get(pid), 'rk': RK.get(pid),
                    'pv': round(pv_of(d[0])) if d else (r['pv'] if r else None), 'tv': r['tv'] if r else None,
                    'o': (OV.get(pid) or {}).get('o'), 'od': ovr_move(OV.get(pid)), 'h': h['s'] if h else None, 'gp': len(w), 'pts': round(sum(w), 1), 'ppg': round(sum(w) / len(w), 1) if w else None,
                    'l3': round(sum(w[-3:]) / len(w[-3:]), 1) if w else None})
    out.sort(key=lambda x: ((x['d'] or [9999])[0], (x['r'] or [9999])[0]))
    with open(D('rankings.json'), 'w') as fh:
        json.dump({'built': datetime.now(timezone.utc).isoformat(timespec='seconds'), 'season': season,
                   'dynUpdated': (load(D('fantasypros', 'dynasty-ecr.json'), {}) or {}).get('updated'),
                   'rosUpdated': (load(D('fantasypros', 'ros-ecr.json'), {}) or {}).get('updated'),
                   'rookUpdated': (load(D('fantasypros', 'rookies-ecr.json'), {}) or {}).get('updated'),
                   'players': out}, fh, separators=(',', ':'), ensure_ascii=False)
        fh.write('\n')
    print(f'rankings: {len(out)} players')


if __name__ == '__main__':
    main()
