"""Trading Floor data (Beta): everything an owner thinking about a trade might want, in one file.

Reads what the refresh already saved and writes data/trading-floor.json:
  teams   outlook from the playoff odds, 2026 payroll, the cost of keeping everyone worth keeping in 2027,
          depth by position, QB count against the 2-QB keeper limit, rookie picks owned
  targets sell candidates on teams out of a playoff spot (expiring, costly to keep, at peak age), by Trade Value, a few on playoff teams who could still be had (outside the box),
          expiring contracts, big 2027 raises, keeper crunches
  trades  every MFL trade since 2019: players and picks from MFL, plus auction cash, which MFL doesn't record
          (data/trade-cash.json from the commissioner's trade log for 2022-26; data/budgets.json for new 2027 cash)
  habits  per team, plain counts from that history: trades a season, partners, timing, picks in and out
  block   MFL Trade Bait (owners add players from their team page in MFL), when the refresh has fetched it

Trade lists lead with Trade Value (data/values.json, scripts/trade_values.py) and sort by it; the FBP OVR
(data/ovr.json) is shown alongside and still drives the lineup and keeper math (depth, keepers, QB limit). Nothing here grades a player or an owner.
"""
import json, os, re, sys, collections
from datetime import datetime, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
D = lambda *p: os.path.join(ROOT, 'data', *p)
load = lambda p, d=None: json.load(open(p)) if os.path.exists(p) else d

DEADLINE = '2026-12-03T17:00:00Z'          # Dec 3, 12 PM EST: in-season trading ends before Week 13
CAP, ROSTER = 200, 20                       # keepers + $1 per open active-roster spot must stay under the $200 cap
GOOD, KEEP = 80, 75                         # OVR: a weekly starter; worth keeping (lineup and keeper math)
NEED = {'QB': 1, 'RB': 2, 'WR': 2, 'TE': 1} # 2026 lineup (Flex aside)
NEED27 = {'QB': 2, 'RB': 2, 'WR': 2, 'TE': 1}   # 2027 adds the SuperFlex, so a second QB becomes a starter for most teams
SELL_TV = 750                               # Trade Value worth getting something back for
from fbp_common import PEAK   # peak ages, shared with Trade Value
ORD = {1: '1st', 2: '2nd', 3: '3rd', 4: '4th'}


def private(s):
    # the site is public: never repeat an email address or phone number an owner typed into MFL
    s = re.sub(r'[\w.+-]+@[\w-]+(\.[\w-]+)+', '', s)
    s = re.sub(r'\(?\b\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b', '', s)
    return re.sub(r'\s{2,}', ' ', s).strip(' .,;')


def as_list(x):
    return x if isinstance(x, list) else ([x] if x else [])


def main():
    R = load(D('rosters.json'))
    LN = load(D('league-now.json'), {})
    cards = {c['id']: c for c in (load(D('beta-cards.json'), {}) or {}).get('cards', [])}
    ovr = {k: v.get('o') for k, v in ((load(D('ovr.json'), {}) or {}).get('players') or {}).items()}
    VP = (load(D('values.json'), {}) or {}).get('players') or {}
    tvs = {k: v.get('tv') for k, v in VP.items()}   # Trade Value (trade_values.py)
    mkt = {k: max(v.get('mkt') or 0, v.get('mkt27') or 0) for k, v in VP.items()}   # what he'd go for at a 2027 auction (trade_values.py)
    nowv = {k: (v.get('nv'), v.get('pv')) for k, v in VP.items()}   # value now (production, rest of season) and long-term
    odds = ((LN.get('odds') or {}).get('teams')) or {}
    seeds = {s['id']: s.get('seed') for s in (LN.get('seeds') or [])}   # teams in a playoff spot right now
    T = R['teams']
    name = {f: t['name'] for f, t in T.items()}
    # 2027 cap per team: the $200 default plus auction cash moved in trades and any adjustments (data/budgets.json)
    B = load(D('budgets.json'), {}) or {}
    cap = {f: B.get('default', CAP) for f in T}
    for x in (B.get('trades') or []) + (B.get('adjustments') or []):
        for f, v in (x.get('cash') or {}).items():
            if f in cap:
                cap[f] += v

    # ---------- players ----------
    P = {}
    for f, t in T.items():
        for r in t['rows']:
            if r['pos'] == 'DEF':
                continue
            c = cards.get(r['id'], {})
            fut = r.get('fut') or []
            P[r['id']] = {'id': r['id'], 'n': r['name'], 'p': r['pos'], 'nfl': r.get('nfl'), 'age': r.get('age'), 'e': r.get('espn'),
                          'f': f, 'st': r['st'], 'sal': r.get('sal'), 'cy': r.get('cy') or '', 'n27': fut[0] if fut else None,
                          'exp': not fut, 'o': ovr.get(r['id'], c.get('o')), 'tv': tvs.get(r['id']), 'r': c.get('r'), 'dev': c.get('dev'), 'ppg': round(r['pts'] / r['gp'], 1) if r.get('gp') else None}

    # ---------- teams ----------
    teams = {}
    for f, t in T.items():
        o = odds.get(f, {})
        po = o.get('playoff')
        out = None if po is None else 'Contending' if po >= 75 else 'In the mix' if po >= 25 else 'Building'
        mine = [p for p in P.values() if p['f'] == f]
        pay26 = round(sum(r.get('sal') or 0 for r in t['rows']), 1)
        keep = [p for p in mine if not p['exp'] and (p['o'] or 0) >= KEEP]
        active_keep = [p for p in keep if p['st'] != 'TAXI_SQUAD']
        keep_cost = round(sum(p['n27'] for p in keep) + max(0, ROSTER - len(active_keep)), 1)
        depth = {}
        for pos in NEED:
            g = sorted([p for p in mine if p['p'] == pos], key=lambda p: -(p['o'] or 0))
            depth[pos] = {'good': sum(1 for p in g if (p['o'] or 0) >= GOOD), 'top': [p['id'] for p in g[:4]]}
        qbs = [p for p in mine if p['p'] == 'QB' and not p['exp'] and (p['o'] or 0) >= 70]
        teams[f] = {'name': t['name'], 'owner': t.get('owner'), 'rec': t.get('rec'), 'pf': t.get('pf'), 'playoff': po, 'outlook': out, 'seed': seeds.get(f),
                    'pay26': pay26, 'cap27': cap[f], 'keepCost': keep_cost, 'keepN': len(keep), 'room27': round(cap[f] - keep_cost, 1),
                    'depth': depth, 'qb27': [p['id'] for p in sorted(qbs, key=lambda p: -(p['o'] or 0))]}

    VT = (load(D('values.json'), {}) or {}).get('teams') or {}
    for f in teams:   # Trade Value by team and position (trade_values.py), with ranks
        v = VT.get(f) or {}
        teams[f]['tv'], teams[f]['tvR'] = v.get('tv'), v.get('tvR')
        teams[f]['tvPos'] = {pos: (v.get('pos') or {}).get(pos, {}).get('tvR') for pos in list(NEED) + ['PICK']}

    def deep(f, pos):
        g = teams[f]['depth'][pos]['good']
        return g >= NEED[pos] + 1

    def thin(f, pos):
        return teams[f]['depth'][pos]['good'] < NEED[pos]

    for f in teams:
        teams[f]['deep'] = [pos for pos in NEED if deep(f, pos)]
        teams[f]['thin'] = [pos for pos in NEED if thin(f, pos)]

    # ---------- picks owned ----------
    fdp = (load(D('mfl', 'futureDraftPicks.json'), {}) or {}).get('futureDraftPicks', {})
    for fr in as_list(fdp.get('franchise')):
        picks = [{'y': int(p['year']), 'r': int(p['round']), 'from': p['originalPickFor']} for p in as_list(fr.get('futureDraftPick'))]
        if fr['id'] in teams:
            teams[fr['id']]['picks'] = sorted(picks, key=lambda p: (p['y'], p['r'], p['from'] != fr['id']))

    # ---------- targets ----------
    oc = lambda f: teams[f]['outlook']
    def row(p, why=None):
        x = {k: p[k] for k in ('id', 'n', 'p', 'nfl', 'age', 'e', 'f', 'st', 'sal', 'cy', 'n27', 'exp', 'o', 'tv', 'r', 'dev', 'ppg')}
        if why:
            x['why'] = why
        return x
    rated = [p for p in P.values() if p['o'] is not None]
    seeded = lambda f: bool(teams[f].get('seed'))
    TVK = lambda p: -(p['tv'] or 0)   # trade lists lead with Trade Value
    # Sell candidates: players on teams out of a playoff spot that a rebuilding owner has a reason to move now
    #   exp   contract ends after this season, so he's gone anyway
    #   cost  2027 salary at least $3 over what he'd go for at auction, so keeping him costs more than replacing him
    #   peak  at or past his position's peak age with real Trade Value now, which a rebuild would outlast,
    #         or producing well above his long-term value (a hot stretch to cash in), unless he's young and
    #         under contract past this season, or on the taxi squad: a rebuild keeps those
    sell = []
    for p in P.values():
        if seeded(p['f']) or ((p['tv'] or 0) < SELL_TV and (p['o'] or 0) < 75):
            continue
        why, m = [], mkt.get(p['id'])
        if p['exp']:
            why.append({'k': 'exp'})
        if p['n27'] is not None and m is not None and p['n27'] - m >= 3:
            why.append({'k': 'cost', 'mkt': round(m)})
        nv, lv = nowv.get(p['id'], (None, None))
        # a hot stretch is only worth cashing in on a player the rebuild won't be built around: an expiring deal, or a
        # veteran near or past his peak. A young player on a cheap deal who's just started producing is one to keep
        young_keeper = p['age'] and p['age'] < PEAK.get(p['p'], 99) - 1 and not p['exp']
        if nv and lv and nv >= 5000 and nv >= 1.25 * lv and not young_keeper and p['st'] != 'TAXI_SQUAD':
            why.append({'k': 'hot'})
        elif p['age'] and p['age'] >= PEAK.get(p['p'], 99) and (p['tv'] or 0) >= SELL_TV:
            why.append({'k': 'peak', 'peak': PEAK[p['p']]})
        if why:
            sell.append(row(p, why))
    good_bad = sorted(sell, key=lambda p: -(p['tv'] or 0))
    # Outside the box: players on playoff teams with a reason the team might still move them
    #   depth  more good players at his spot than the team starts (2027 lineup, with the SuperFlex)
    #   qb     a third QB worth keeping, with only 2 veteran QB keeper spots
    #   cap    over the 2027 budget: keeping the best first, he's one who doesn't fit
    odd = {}
    for f, t in teams.items():
        if not seeded(f) or t['keepCost'] <= t['cap27']:
            continue
        keep = sorted([p for p in P.values() if p['f'] == f and not p['exp'] and (p['o'] or 0) >= KEEP], key=lambda p: (-p['o'], p['n27'] or 0))
        cost, n = 0, 0
        for p in keep:
            act = p['st'] != 'TAXI_SQUAD'
            c2 = cost + (p['n27'] or 0)
            if c2 + max(0, ROSTER - n - act) <= t['cap27']:
                cost, n = c2, n + act
            else:
                odd[p['id']] = round(t['keepCost'] - t['cap27'], 1)
    box = []
    for p in rated:
        f = p['f']
        if not seeded(f) or p['o'] < KEEP or p['st'] == 'TAXI_SQUAD':
            continue
        t, why = teams[f], []
        same = sorted([q for q in P.values() if q['f'] == f and q['p'] == p['p']], key=lambda q: -(q['o'] or 0))
        rank = same.index(p) + 1
        if p['p'] in t['deep'] and rank > NEED27[p['p']]:
            why.append({'k': 'depth', 'rank': rank})
        if p['p'] == 'QB' and p['id'] in t['qb27'][2:]:
            why.append({'k': 'qb', 'n': len(t['qb27'])})
        if p['id'] in odd:
            why.append({'k': 'cap', 'over': odd[p['id']]})
        if why:
            box.append(row(p, why))
    box.sort(key=lambda p: -(p['tv'] or 0))
    expiring = sorted([p for p in rated if p['exp'] and p['st'] != 'TAXI_SQUAD' and p['o'] >= 65], key=TVK)
    raises = sorted([p for p in rated if p['n27'] is not None and p['sal'] is not None and p['n27'] >= 20 and p['n27'] - p['sal'] >= 5],
                    key=lambda p: -p['n27'])
    crunch = []
    for f, t in teams.items():
        if t['keepCost'] > t['cap27']:
            crunch.append({'f': f, 'kind': 'cap', 'over': round(t['keepCost'] - t['cap27'], 1),
                           'ids': [p['id'] for p in sorted([p for p in P.values() if p['f'] == f and not p['exp'] and (p['o'] or 0) >= KEEP], key=lambda p: -(p['n27'] or 0))[:6]]})
        if len(t['qb27']) > 2:
            crunch.append({'f': f, 'kind': 'qb', 'n': len(t['qb27']), 'ids': t['qb27']})
    for c in crunch:
        c['list'] = [{'id': i, 'n': P[i]['n'], 'p': P[i]['p'], 'n27': P[i]['n27'], 'o': P[i]['o'], 'tv': P[i]['tv']} for i in c.pop('ids')]
    targets = {'goodOnNonContenders': good_bad, 'outsideBox': box, 'expiring': [row(p) for p in expiring],
               'raises': [row(p) for p in raises], 'crunch': crunch}

    # ---------- trade history (MFL, 2021 on) ----------
    names = {}
    for y in range(2019, 2026):
        pj = load(D('history', str(y), 'players.json'), {}) or {}
        for pid, v in (pj.get('players') or {}).items():
            names.setdefault(pid, (v[0], v[1]))
    for pid, v in ((load(D('mfl', 'players.json'), {}) or {}).get('players') or {}).items():
        names[pid] = (v[0], v[1])
    def pname(pid):
        n, pos = names.get(pid, ('Player ' + pid, ''))
        if ', ' in n:
            last, first = n.split(', ', 1)
            n = f'{first} {last}'
        return n, ('DEF' if pos == 'Def' else pos)

    def item(tok, season):
        if tok.startswith('FP_'):
            _, orig, y, r = tok.split('_')
            return {'k': 'pick', 'code': tok, 'y': int(y), 'r': int(r), 'from': orig, 't': f"{y} {ORD.get(int(r), r + 'th')} ({name.get(orig, orig)})"}
        if tok.startswith('DP_'):
            _, r, p = tok.split('_')
            return {'k': 'pick', 'code': tok, 'y': season, 'r': int(r) + 1, 't': f'{season} pick {int(r) + 1}.{int(p) + 1:02d}'}
        if tok.startswith('BB_'):
            return {'k': 'faab', 't': f'${tok[3:]} FAAB'}
        n, pos = pname(tok)
        return {'k': 'p', 'id': tok, 't': n, 'pos': pos}

    trades = []
    for y in range(2019, 2027):
        tj = load(D('history', str(y), 'transactions.json') if y < 2026 else D('mfl', 'transactions.json'), {}) or {}
        tx = tj.get('transactions')
        tx = tx.get('transaction') if isinstance(tx, dict) else tx
        for t in as_list(tx):
            if t.get('type') != 'TRADE':
                continue
            ts = int(t['timestamp'])
            g1 = [item(x, y) for x in t.get('franchise1_gave_up', '').split(',') if x]
            g2 = [item(x, y) for x in t.get('franchise2_gave_up', '').split(',') if x]
            trades.append({'ts': ts, 'season': y, 'a': t['franchise'], 'b': t['franchise2'], 'aGave': g1, 'bGave': g2})
    trades.sort(key=lambda t: -t['ts'])

    # auction cash: MFL doesn't carry it, so add it from the trade log and the 2027 budgets file
    def add_cash(t, giver, amt, y):
        side = 'aGave' if giver == t['a'] else 'bGave'
        t[side].append({'k': 'cash', 'amt': amt, 'y': y, 't': f'${amt} of {y} auction cash'})
        t['cash'] = True
    by_ts = {t['ts']: t for t in trades}
    for c in (load(D('trade-cash.json'), {}) or {}).get('trades', []):
        t = by_ts.get(c['ts'])
        if t:
            for x in c['cash']:
                add_cash(t, x['f'], x['amt'], x['y'])
    B = load(D('budgets.json'), {}) or {}
    for bt in B.get('trades') or []:
        cash = bt.get('cash') or {}
        pair = set(cash)
        cands = [t for t in trades if t['season'] == B.get('season', 2027) - 1 and {t['a'], t['b']} == pair]
        if not cands or any(t.get('cash') for t in cands if len(cands) == 1):
            continue
        t = next((t for t in cands if not t.get('cash')), None)
        if t:
            for f, v in cash.items():
                if v < 0:
                    add_cash(t, f, -v, B.get('season', 2027))

    # ---------- how each trade played out (the same numbers as Awards > Trade of the Year) ----------
    # Each used pick becomes the player taken with it; each side's haul gets its starter points for that team from
    # the trade season on, until the team lets him go.
    try:
        sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
        import awards as AW
        F = AW.Followups()
        for t in trades:
            for me, got in (('a', t['bGave']), ('b', t['aGave'])):
                players = [{'id': x['id'], 'name': x['t'], 'pos': x.get('pos', '')} for x in got if x['k'] == 'p']
                picks = [x['code'] for x in got if x['k'] == 'pick']
                became, later = F.side(t[me], players, picks, t['season'], t['ts'], playoffs=True)
                for x in got:
                    b = became.get(x.get('code')) if x['k'] == 'pick' else None
                    if b:
                        x['became'] = {'id': b['id'], 'n': b['name'], 'pos': b['pos'], 'y': b['year'], 'slot': b['slot'], 'by': b.get('by')}
                if later:
                    via = {x['code']: x['t'] for x in got if x['k'] == 'pick'}
                    t['out' + me.upper()] = {'total': later['total'], 'po': later.get('poTotal', 0), 'years': later['years'],
                                             'rows': [{'n': r['name'], 'pos': r['pos'], 'via': via.get(r['via']) if r['via'] else None, 'pts': r['pts'], 'po': r.get('po') or {}} for r in later['rows']]}
    except Exception as e:   # the history still shows without it
        print('  trade follow-ups skipped:', type(e).__name__, str(e)[:200])

    # ---------- habits: plain counts ----------
    habits = {}
    for f in teams:
        mine = [t for t in trades if f in (t['a'], t['b'])]
        per = collections.Counter(t['season'] for t in mine)
        partners = collections.Counter(t['b'] if t['a'] == f else t['a'] for t in mine)
        gave = lambda t: t['aGave'] if t['a'] == f else t['bGave']
        got = lambda t: t['bGave'] if t['a'] == f else t['aGave']
        months = collections.Counter(datetime.fromtimestamp(t['ts'], timezone.utc).month for t in mine)
        inseason = sum(v for m, v in months.items() if m in (9, 10, 11, 12))
        habits[f] = {'total': len(mine), 'perSeason': {str(y): per.get(y, 0) for y in range(2019, 2027)},
                     'partners': [[p, n] for p, n in partners.most_common(3)],
                     'inSeason': inseason, 'offSeason': len(mine) - inseason,
                     'picksOut': sum(1 for t in mine for x in gave(t) if x['k'] == 'pick'),
                     'picksIn': sum(1 for t in mine for x in got(t) if x['k'] == 'pick'),
                     'playersOut': sum(1 for t in mine for x in gave(t) if x['k'] == 'p'),
                     'playersIn': sum(1 for t in mine for x in got(t) if x['k'] == 'p'),
                     'cashOut': sum(x['amt'] for t in mine for x in gave(t) if x['k'] == 'cash'),
                     'cashIn': sum(x['amt'] for t in mine for x in got(t) if x['k'] == 'cash'),
                     'last': mine[0]['ts'] if mine else None, 'this': per.get(2026, 0)}

    # ---------- the block (MFL Trade Bait) ----------
    block, block_fetched = [], None
    tb = load(D('mfl', 'tradeBait.json'))
    if tb:
        block_fetched = tb.get('fetched')
        for b in as_list(((tb.get('tradeBaits') or {}).get('tradeBait'))):
            f = b.get('franchise_id')
            items = [item(x, 2026) for x in (b.get('willGiveUp') or '').split(',') if x]
            for x in items:
                if x['k'] == 'p' and x['id'] in P:
                    x.update(row(P[x['id']]))
            if items or b.get('inExchangeFor'):
                block.append({'f': f, 'ts': int(b['timestamp']) if b.get('timestamp') else None, 'items': items,
                              'wants': private((b.get('inExchangeFor') or '').strip())})

    # ---------- the ticker's feed: latest moves (last 10 days) and the block, small enough to load on every page ----------
    abbr = {f: ((load(D('teams.json'), {}) or {}).get('teams', {}).get(f) or {}).get('abbr', f) for f in teams}
    tj = (load(D('mfl', 'transactions.json'), {}) or {}).get('transactions') or []
    tj = tj.get('transaction') if isinstance(tj, dict) else tj
    cutoff = datetime.now(timezone.utc).timestamp() - 10 * 86400
    moves = []
    for x in as_list(tj):
        ts = int(x.get('timestamp') or 0)
        if ts < cutoff:
            continue
        ty, f = x.get('type'), x.get('franchise')
        if ty in ('BBID_WAIVER', 'FREE_AGENT'):
            parts = (x.get('transaction', '') + '||').split('|')
            adds = [q for q in parts[0].split(',') if q]
            bid = parts[1] if ty == 'BBID_WAIVER' else ''
            for q in adds:
                n, pos = pname(q)
                try:
                    b = f' (${float(bid):.0f})' if bid and float(bid) else ''
                except ValueError:
                    b = ''
                moves.append({'ts': ts, 'k': 'W' if ty == 'BBID_WAIVER' else 'F', 'f': f, 'id': q, 't': f"{'claimed' if ty == 'BBID_WAIVER' else 'signed'} {n}{b}", 'pos': pos})
    for t in trades:
        if t['ts'] >= cutoff:
            moves.append({'ts': t['ts'], 'k': 'T', 'f': t['a'], 'f2': t['b'],
                          't': ' for '.join([' + '.join(x['t'] for x in t['aGave']) or 'nothing', ' + '.join(x['t'] for x in t['bGave']) or 'nothing'])})
    moves.sort(key=lambda m: -m['ts'])

    # ---------- every team's moves this season, for My Team's Transactions: adds and drops, then trades ----------
    def pl(q):
        n, pos = pname(q)
        return {'id': q, 't': n, 'pos': pos}
    log = {f: [] for f in teams}
    for x in as_list(tj):
        ty, f = x.get('type'), x.get('franchise')
        if ty not in ('BBID_WAIVER', 'FREE_AGENT') or f not in log:
            continue
        parts = (x.get('transaction', '') + '||').split('|')
        bid = ''
        if ty == 'BBID_WAIVER':
            try:
                bid = round(float(parts[1]), 2)
            except ValueError:
                bid = ''
        drops = parts[2] if ty == 'BBID_WAIVER' else parts[1]
        log[f].append({'ts': int(x.get('timestamp') or 0), 'k': 'W' if ty == 'BBID_WAIVER' else 'F', 'bid': bid,
                       'add': [pl(q) for q in parts[0].split(',') if q], 'drop': [pl(q) for q in drops.split(',') if q]})
    season = int((load(D('mfl', '_meta.json'), {}) or {}).get('season') or 2026)
    for t in trades:
        if t['season'] != season:
            continue
        for f, o, got, gave in ((t['a'], t['b'], t['bGave'], t['aGave']), (t['b'], t['a'], t['aGave'], t['bGave'])):
            if f in log:
                log[f].append({'ts': t['ts'], 'k': 'T', 'with': o, 'got': got, 'gave': gave})
    for L in log.values():
        L.sort(key=lambda m: -m['ts'])
    feed = {'built': datetime.now(timezone.utc).isoformat(timespec='seconds'), 'deadline': DEADLINE, 'moves': moves[:20],
            'block': [{'f': b['f'], 'items': [x.get('n') or x['t'] for x in b['items']]} for b in block],
            # every player on the block, for the TRADE chip beside his name across the site (FBPU.tbChip)
            'blockIds': sorted({x['id'] for b in block for x in b['items'] if x.get('k') == 'p' and x.get('id')})}
    with open(D('ticker.json'), 'w') as fh:
        json.dump(feed, fh, separators=(',', ':'), ensure_ascii=False)
        fh.write('\n')

    out = {'built': datetime.now(timezone.utc).isoformat(timespec='seconds'), 'season': int((load(D('mfl', '_meta.json'), {}) or {}).get('season') or 2026), 'deadline': DEADLINE, 'cap': CAP,
           'note': 'Ratings are the FBP OVR. seed: a playoff spot right now (Targets leave those teams out, but for Outside the box). Outlook: Contending 75%+ playoff odds, In the mix 25-75%, Building under 25%.',
           'teams': teams, 'targets': targets, 'trades': trades, 'habits': habits, 'moves': log,
           'block': block, 'blockFetched': block_fetched, 'blockOn': tb is not None}
    with open(D('trading-floor.json'), 'w') as fh:
        json.dump(out, fh, separators=(',', ':'), ensure_ascii=False)
        fh.write('\n')
    print('trading floor:', len(trades), 'trades,', len(good_bad), 'sell candidates on non-playoff teams,', len(expiring), 'expiring,',
          len(raises), 'raises,', len(crunch), 'crunches,', len(block), 'block entries')


if __name__ == '__main__':
    main()
