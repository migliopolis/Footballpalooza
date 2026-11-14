#!/usr/bin/env python3
"""Build data/transactions.json: every season's moves for League Now > Transactions.

Waiver and free-agent adds and drops from MFL's transaction logs (data/history/<year>/transactions.json, this season
data/mfl/transactions.json); trades from data/trading-floor.json (picks and auction cash spelled out); this season's
IR and taxi squad moves from data/mfl/transactions-moves.json; auctions won from data/mfl/auctionResults.json (this
season, with times) and data/auction-bids.json (past seasons, in auction order). Waiver requests and trade offers
aren't public, so they're left out.
Run after trading_floor.py: python scripts/transactions_log.py
"""
import json, os, sys
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from payroll import names_pos

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
D = lambda *p: os.path.join(ROOT, 'data', *p)
load = lambda p, d=None: json.load(open(p, encoding='utf-8')) if os.path.exists(p) else d
ids = lambda s: [x for x in (s or '').split(',') if x]


def as_list(x):
    x = x.get('transaction') if isinstance(x, dict) else x
    return x if isinstance(x, list) else ([x] if x else [])


def main():
    names, pos, _ = names_pos()
    meta = load(D('mfl', '_meta.json'), {}) or {}
    cur = int(meta.get('season') or 2026)
    current = set(((load(D('mfl', 'players.json'), {}) or {}).get('players') or {}).keys())
    used = set()
    years = {}
    TF = load(D('trading-floor.json'), {}) or {}
    bids = load(D('auction-bids.json'), {}) or {}
    for y in range(2019, cur + 1):
        out = []
        tx = (load(D('mfl', 'transactions.json') if y == cur else D('history', str(y), 'transactions.json'), {}) or {}).get('transactions')
        for x in as_list(tx):
            ty, f, ts = x.get('type'), x.get('franchise'), int(x.get('timestamp') or 0)
            if ty not in ('BBID_WAIVER', 'WAIVER', 'FREE_AGENT'):
                continue
            p = (x.get('transaction', '') + '||').split('|')
            if ty == 'BBID_WAIVER':
                add, drop = ids(p[0]), ids(p[2])
                try:
                    b = round(float(p[1]), 2)
                except ValueError:
                    b = None
            else:
                add, drop, b = ids(p[0]), ids(p[1]), None
            if not add and not drop:
                continue
            e = {'ts': ts, 'k': 'F' if ty == 'FREE_AGENT' else 'W', 'f': f, 'a': add, 'd': drop}
            if b is not None:
                e['b'] = b
            out.append(e); used.update(add + drop)
        for t in TF.get('trades') or []:
            if t.get('season') != y:
                continue
            side = lambda L: [x['id'] if x.get('k') == 'p' else {'t': x.get('t', '')} for x in L]
            out.append({'ts': t['ts'], 'k': 'T', 'f': t['a'], 'f2': t['b'], 'g1': side(t['aGave']), 'g2': side(t['bGave'])})
            used.update(x['id'] for x in t['aGave'] + t['bGave'] if x.get('k') == 'p')
        if y == cur:
            for x in as_list((load(D('mfl', 'transactions-moves.json'), {}) or {}).get('transactions')):
                ty, f, ts = x.get('type'), x.get('franchise'), int(x.get('timestamp') or 0)
                if ty == 'IR':
                    e = {'ts': ts, 'k': 'I', 'f': f, 'on': ids(x.get('deactivated')), 'off': ids(x.get('activated'))}
                    used.update(e['on'] + e['off'])
                elif ty == 'TAXI':
                    e = {'ts': ts, 'k': 'X', 'f': f, 'on': ids(x.get('demoted')), 'off': ids(x.get('promoted'))}
                    used.update(e['on'] + e['off'])
                else:
                    continue
                if e['on'] or e['off']:
                    out.append(e)
            A = (((load(D('mfl', 'auctionResults.json'), {}) or {}).get('auctionResults') or {}).get('auctionUnit') or {}).get('auction')
            for a in (A if isinstance(A, list) else [A] if A else []):
                if a.get('player') and a.get('franchise'):
                    out.append({'ts': int(a.get('lastBidTime') or a.get('timeStarted') or 0), 'k': 'A', 'f': a['franchise'], 'a': [a['player']], 'b': float(a.get('winningBid') or 0)})
                    used.add(a['player'])
        else:
            for i, line in enumerate(x for x in (bids.get(str(y)) or '').split(';') if x):
                p = line.split(':')
                if len(p) >= 4 and p[2] not in ('', '0'):
                    out.append({'ts': None, 'n': i, 'k': 'A', 'f': p[2].zfill(4), 'a': [p[0]], 'b': float(p[3] or 0)})
                    used.add(p[0])
        out.sort(key=lambda e: (-(e['ts'] or 0), -e.get('n', 0)))
        years[str(y)] = out
    P = {pid: [names.get(pid) or ('Player ' + pid), pos.get(pid) or '', 1 if pid in current else 0] for pid in sorted(used)}
    res = {'built': datetime.now(timezone.utc).isoformat(timespec='seconds'), 'season': cur,
           'note': 'Each player is [name, position, on MFL this season]. k: W waiver, F free agent, T trade, I IR, X taxi squad, A auction. '
                   'IR and taxi: on = moved there, off = moved back to the active roster.',
           'players': P, 'years': years}
    with open(D('transactions.json'), 'w', encoding='utf-8') as fh:
        json.dump(res, fh, separators=(',', ':'), ensure_ascii=False)
        fh.write('\n')
    print('transactions:', ', '.join(f'{y} {len(v)}' for y, v in years.items()))


if __name__ == '__main__':
    main()
