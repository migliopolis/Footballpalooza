"""Trading Floor data (Beta): everything an owner thinking about a trade might want, in one file.

Reads what the refresh already saved and writes data/trading-floor.json:
  teams   outlook from the playoff odds, 2026 payroll, the cost of keeping everyone worth keeping in 2027,
          depth by position, QB count against the 2-QB keeper limit, rookie picks owned
  targets good players on teams outside the playoff race, expiring contracts, big 2027 raises, keeper crunches
  trades  every MFL trade since 2021: players and picks from MFL, plus auction cash, which MFL doesn't record
          (data/trade-cash.json from the commissioner's trade log for 2022-26; data/budgets.json for new 2027 cash)
  habits  per team, plain counts from that history: trades a season, partners, timing, picks in and out
  block   MFL Trade Bait (owners add players from their team page in MFL), when the refresh has fetched it

Player ratings come from data/beta-cards.json (the prototype ratings). Nothing here grades a player or an owner.
"""
import json, os, re, sys, collections
from datetime import datetime, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
D = lambda *p: os.path.join(ROOT, 'data', *p)
load = lambda p, d=None: json.load(open(p)) if os.path.exists(p) else d

DEADLINE = '2026-12-03T17:00:00Z'          # Dec 3, 12 PM EST: in-season trading ends before Week 13
CAP, ROSTER = 200, 20                       # keepers + $1 per open active-roster spot must stay under the $200 cap
GOOD, KEEP = 80, 75                         # OVR: a weekly starter; worth keeping
NEED = {'QB': 1, 'RB': 2, 'WR': 2, 'TE': 1} # 2026 lineup (Flex aside)
NEED27 = {'QB': 2, 'RB': 2, 'WR': 2, 'TE': 1}   # 2027 adds the SuperFlex, so a second QB becomes a starter for most teams
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
    odds = ((LN.get('odds') or {}).get('teams')) or {}
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
                          'exp': not fut, 'o': c.get('o'), 'r': c.get('r'), 'dev': c.get('dev'), 'ppg': round(r['pts'] / r['gp'], 1) if r.get('gp') else None}

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
        teams[f] = {'name': t['name'], 'owner': t.get('owner'), 'rec': t.get('rec'), 'pf': t.get('pf'), 'playoff': po, 'outlook': out,
                    'pay26': pay26, 'cap27': cap[f], 'keepCost': keep_cost, 'keepN': len(keep), 'room27': round(cap[f] - keep_cost, 1),
                    'depth': depth, 'qb27': [p['id'] for p in sorted(qbs, key=lambda p: -(p['o'] or 0))]}

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
        x = {k: p[k] for k in ('id', 'n', 'p', 'nfl', 'age', 'e', 'f', 'st', 'sal', 'cy', 'n27', 'exp', 'o', 'r', 'dev', 'ppg')}
        if why:
            x['why'] = why
        return x
    rated = [p for p in P.values() if p['o'] is not None]
    good_bad = sorted([p for p in rated if p['o'] >= GOOD and oc(p['f']) in ('In the mix', 'Building')], key=lambda p: -p['o'])
    expiring = sorted([p for p in rated if p['exp'] and p['st'] != 'TAXI_SQUAD' and p['o'] >= 65], key=lambda p: -p['o'])
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
        c['list'] = [{'id': i, 'n': P[i]['n'], 'p': P[i]['p'], 'n27': P[i]['n27'], 'o': P[i]['o']} for i in c.pop('ids')]
    targets = {'goodOnNonContenders': [row(p) for p in good_bad], 'expiring': [row(p) for p in expiring],
               'raises': [row(p) for p in raises], 'crunch': crunch}

    # ---------- trade history (MFL, 2021 on) ----------
    names = {}
    for y in range(2021, 2026):
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
    for y in range(2021, 2027):
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
                became, later = F.side(t[me], players, picks, t['season'], t['ts'])
                for x in got:
                    b = became.get(x.get('code')) if x['k'] == 'pick' else None
                    if b:
                        x['became'] = {'n': b['name'], 'pos': b['pos'], 'y': b['year'], 'slot': b['slot'], 'by': b.get('by')}
                if later:
                    via = {x['code']: x['t'] for x in got if x['k'] == 'pick'}
                    t['out' + me.upper()] = {'total': later['total'], 'years': later['years'],
                                             'rows': [{'n': r['name'], 'pos': r['pos'], 'via': via.get(r['via']) if r['via'] else None, 'pts': r['pts']} for r in later['rows']]}
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
        habits[f] = {'total': len(mine), 'perSeason': {str(y): per.get(y, 0) for y in range(2021, 2027)},
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

    out = {'built': datetime.now(timezone.utc).isoformat(timespec='seconds'), 'season': int((load(D('mfl', '_meta.json'), {}) or {}).get('season') or 2026), 'deadline': DEADLINE, 'cap': CAP,
           'note': 'Beta. Ratings are the prototype OVR. Outlook: Contending 75%+ playoff odds, In the mix 25-75%, Building under 25%.',
           'teams': teams, 'targets': targets, 'trades': trades, 'habits': habits,
           'block': block, 'blockFetched': block_fetched, 'blockOn': tb is not None}
    with open(D('trading-floor.json'), 'w') as fh:
        json.dump(out, fh, separators=(',', ':'), ensure_ascii=False)
        fh.write('\n')
    print('trading floor:', len(trades), 'trades,', len(good_bad), 'good players outside the race,', len(expiring), 'expiring,',
          len(raises), 'raises,', len(crunch), 'crunches,', len(block), 'block entries')


if __name__ == '__main__':
    main()
