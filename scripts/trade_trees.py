"""FBP trade trees: where everything in a trade ended up, for the Trading Floor's "How it played out".

For each side of each trade (2019 on), every asset that side received is followed forward:
  a player         his starter points for that team (regular season and real playoff games) until the team let him
                   go. Released or not kept ends the branch. Traded away, the branch carries on through whatever came
                   back in that trade (labeled with how many pieces went out with him: "1 of 4 pieces").
  a draft pick     used by the team: the player taken with it, followed as above. Traded on before it was used: the
                   branch carries on through what came back. Not used yet: "still to be drafted".
  auction cash     ends the branch: cash can't be traced to a player.
Points are credited in full to every branch they sit on; a piece that went out with others is labeled, not split.

Reads data/trading-floor.json (scripts/trading_floor.py) and data/journeys.json (scripts/journeys.py), so it runs
after both. Writes data/trade-trees.json: {built, trees: {"<ts>-<a>-<b>": {a: side, b: side}}}, where a side is
{nodes, total, po} and total/po add up every player on the tree.
"""
import json, os, sys
from datetime import datetime, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
D = lambda *p: os.path.join(ROOT, 'data', *p)
load = lambda p, d=None: json.load(open(p)) if os.path.exists(p) else d
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

DAY = 86400
MAX_DEPTH, MAX_NODES = 8, 80


def year_of(ts):
    return datetime.fromtimestamp(ts, timezone.utc).year


def main():
    import awards as AW
    F = AW.Followups()
    TF = load(D('trading-floor.json'), {}) or {}
    J = load(D('journeys.json'), {}) or {}
    fields = J.get('fields') or []
    stints = {pid: [dict(zip(fields, s)) for s in p.get('st', [])] for pid, p in (J.get('players') or {}).items()}
    trades = sorted(TF.get('trades') or [], key=lambda t: t['ts'])

    def sides(t, R):
        """(what R gave, what R got, the other team) in trade t."""
        return (t['aGave'], t['bGave'], t['b']) if t['a'] == R else (t['bGave'], t['aGave'], t['a'])

    def key(x):
        return ('p', str(x.get('id'))) if x.get('k') == 'p' else ('k', x.get('code')) if x.get('k') == 'pick' else None

    # (team, asset) -> trades where that team sent it away, by time
    sent = {}
    for t in trades:
        for R in (t['a'], t['b']):
            for x in sides(t, R)[0]:
                k = key(x)
                if k:
                    sent.setdefault((R, k), []).append(t)
                # a future pick's code changes once the draft order is set (FP_... becomes DP_...); the player taken
                # with it is the same either way
                if x.get('k') == 'pick' and x.get('became'):
                    sent.setdefault((R, ('b', str(x['became'].get('y')) + ':' + str(x['became'].get('slot')))), []).append(t)

    pts_cache = {}

    def points(R, pid, name, pos, since):
        ck = (R, pid, since)
        if ck not in pts_cache:
            _, later = F.side(R, [{'id': pid, 'name': name, 'pos': pos}], [], year_of(since), since, playoffs=True)
            row = (later or {}).get('rows', [{}])[0] if later and later.get('rows') else {}
            pts_cache[ck] = (row.get('pts') or {}, row.get('po') or {})
        return pts_cache[ck]

    def next_trade(R, k, after, near=None):
        L = [t for t in sent.get((R, k), []) if t['ts'] > after - DAY]
        if near is not None:
            L = [t for t in L if abs(t['ts'] - near) < 3 * DAY] or L
        return L[0] if L else None

    def expand(R, t2, gone_text, depth, budget):
        gave, got, other = sides(t2, R)
        # what the other team got in that deal and has scored with it (direct only, from trading-floor.json), so the
        # branch shows its cost; the totals don't change (that cost belongs to the later trade's own tree)
        out = t2.get('outB') if t2['a'] == R else t2.get('outA')
        rows = (out or {}).get('rows') or []
        named = {r.get('via') or r.get('n') for r in rows}
        they = [[r['n'], round(sum((r.get('pts') or {}).values()) + sum((r.get('po') or {}).values()), 1)] for r in rows]
        they += [[x.get('t'), None] for x in gave if x.get('t') not in named and (x.get('became') or {}).get('n') not in {r['n'] for r in rows}]
        node = {'ts': t2['ts'], 'to': other, 'pieces': len(gave), 'they': they,
                'with': [x.get('t') for x in gave if x.get('t') != gone_text],
                'kids': [n for n in (asset(R, x, t2['ts'], depth + 1, budget) for x in got) if n]}
        return node

    def player(R, pid, name, pos, since, depth, budget, via=None, drafted=False):
        budget[0] -= 1
        S = stints.get(pid) or []
        if drafted:
            st = next((s for s in S if s['team'] == R and s['how'] == 'D'), None)
        else:
            cand = [s for s in S if s['team'] == R and s['start'] <= since + 3 * DAY and (s['end'] is None or s['end'] >= since - DAY)]
            st = cand[-1] if cand else None
        start = st['start'] if st else since
        pts, po = points(R, pid, name, pos, start if drafted else since)
        n = {'k': 'p', 'id': pid, 'n': name, 'pos': pos, 'team': R, 'pts': pts, 'po': po}
        if via:
            n['via'] = via
        if not st or not st.get('endHow'):
            n['end'] = {'how': 'here'} if st else {'how': '?'}
        elif st['endHow'] == 'T':
            t2 = next_trade(R, ('p', pid), start, st['end'])
            if t2 and depth < MAX_DEPTH and budget[0] > 0:
                n['end'] = {'how': 'T'}
                n['trade'] = expand(R, t2, name, depth, budget)
            else:
                n['end'] = {'how': 'T', 'text': st.get('endText')}
        else:
            n['end'] = {'how': st['endHow'], 'text': st.get('endText'), 'ts': None if st.get('endApprox') else st.get('end')}
        return n

    def asset(R, x, ts, depth, budget):
        if budget[0] <= 0:
            return None
        k = x.get('k')
        if k == 'cash':
            budget[0] -= 1
            return {'k': 'cash', 't': x.get('t')}
        if k == 'p':
            return player(R, str(x['id']), x.get('t'), x.get('pos'), ts, depth, budget)
        if k == 'pick':
            b = x.get('became')
            t2 = next_trade(R, ('k', x.get('code')), ts) or (b and next_trade(R, ('b', str(b.get('y')) + ':' + str(b.get('slot'))), ts))
            if t2 and depth < MAX_DEPTH:
                budget[0] -= 1
                return {'k': 'pick', 't': x.get('t'), 'team': R, 'end': {'how': 'T'}, 'trade': expand(R, t2, x.get('t'), depth, budget),
                        'became': {'n': b['n'], 'by': b['by']} if b else None}
            if b and b.get('by') == R:
                return player(R, str(b['id']), b['n'], b['pos'], ts, depth, budget, via=x.get('t'), drafted=True)
            budget[0] -= 1
            return {'k': 'pick', 't': x.get('t'), 'team': R, 'end': {'how': 'pending' if not b else '?'}}
        return None

    def total(nodes):
        tot = po = 0.0
        for n in nodes:
            tot += sum((n.get('pts') or {}).values()) + sum((n.get('po') or {}).values())
            po += sum((n.get('po') or {}).values())
            if n.get('trade'):
                a, b = total(n['trade']['kids'])
                tot += a; po += b
        return tot, po

    out = {}
    for t in trades:
        tree = {}
        for side, R in (('a', t['a']), ('b', t['b'])):
            got = sides(t, R)[1]
            budget = [MAX_NODES]
            nodes = [n for n in (asset(R, x, t['ts'], 0, budget) for x in got) if n]
            tot, po = total(nodes)
            tree[side] = {'nodes': nodes, 'total': round(tot, 1), 'po': round(po, 1)}
        out[f"{t['ts']}-{t['a']}-{t['b']}"] = tree
    json.dump({'built': datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'), 'trees': out},
              open(D('trade-trees.json'), 'w'), separators=(',', ':'))
    print(f'trade trees: {len(out)} trades')


if __name__ == '__main__':
    main()
