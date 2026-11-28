"""Off-Season data: everything the Off-Season tab needs, in one file (data/offseason.json).

It reads the site's own sources and adds nothing new of its own except the auction price curve:
  - rosters.json   contracts: this year's salary, the years left and each future salary (the by-law escalators)
  - power.json     the keeper model: keep chance, the projected keepers (two-veteran-QB limit and budget applied),
                   each team's 2027 auction budget (budgets.json: $200 plus or minus auction cash traded) and draft picks
  - values.json    Player Value and Trade Value
  - auction-bids.json  every auction since 2019: the price curve below

Auction price curve: the average price of the k-th most expensive player at the last five auctions. The Auction Pool
ranks the players likely to be available by Player Value and gives the k-th best the k-th price, so the predictions
add up to what the league actually spends (no $70+ players, because nobody has ever paid that).
"""
import json, os
from datetime import datetime, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
D = lambda *p: os.path.join(ROOT, 'data', *p)
load = lambda n: json.load(open(D(n), encoding='utf-8'))


def price_curve(bids, years):
    rows = []
    for y in years:
        p = sorted((int(r.split(':')[3]) for r in (bids.get(str(y)) or '').split(';') if r.count(':') >= 4), reverse=True)
        if p:
            rows.append(p)
    n = max(len(p) for p in rows)
    # missing ranks in a smaller auction count as $1, the minimum bid
    return [round(sum((p[k] if k < len(p) else 1) for p in rows) / len(rows), 1) for k in range(n)], [len(p) for p in rows]


def main():
    R, P, V = load('rosters.json'), load('power.json'), load('values.json')
    bids = load('auction-bids.json')
    season = int(P['season'])
    years = [y for y in range(season - 4, season + 1) if str(y) in bids]
    curve, sizes = price_curve(bids, years)
    VP = V.get('players', {})
    teams, pool = {}, []
    for fid, t in P['teams'].items():
        rows = {r['id']: r for r in R['teams'][fid]['rows']}
        players = []
        for p in t['players']:
            r, v = rows.get(p['id'], {}), VP.get(p['id'], {})
            players.append({'id': p['id'], 'n': p['name'], 'pos': p['pos'], 'nfl': r.get('nfl'), 'age': p.get('age'), 'st': p['st'],
                            'sal': p['sal'], 'next': p['next'], 'fut': r.get('fut') or [], 'cy': r.get('cy'),
                            'kp': p.get('kp', 0), 'keep': bool(p.get('keep')), 'ppg': p.get('ppg'),
                            'pv': v.get('pv'), 'tv': v.get('tv'), 'o': v.get('o'), 'espn': r.get('espn')})
            if not p.get('keep'):
                pool.append({'id': p['id'], 'n': p['name'], 'pos': p['pos'], 'nfl': r.get('nfl'), 'age': p.get('age'), 'f': fid,
                             'next': p['next'], 'kp': p.get('kp', 0), 'pv': v.get('pv') or 0, 'o': v.get('o'), 'espn': r.get('espn')})
        teams[fid] = {'budget': t['budget'], 'players': players, 'picks': t.get('picks', [])}
    pool.sort(key=lambda p: -p['pv'])
    for k, p in enumerate(pool):
        p['price'] = curve[k] if k < len(curve) else 1.0
    pool = [p for p in pool if p['pv'] > 0][:120]
    out = {'built': datetime.now(timezone.utc).isoformat(timespec='seconds'), 'season': season, 'next': season + 1,
           'through': P.get('through'), 'roster': P.get('roster', 20), 'taxi': 5, 'cap': 200, 'qbVets': 2,
           'curve': curve[:80], 'curveYears': years, 'curveSizes': sizes, 'teams': teams, 'pool': pool}
    json.dump(out, open(D('offseason.json'), 'w', encoding='utf-8'), separators=(',', ':'), ensure_ascii=False)
    kept = {f: sum(1 for p in t['players'] if p['keep']) for f, t in teams.items()}
    print('offseason.json:', len(teams), 'teams, pool', len(pool), 'top prices', curve[:6], 'projected keepers', kept)


if __name__ == '__main__':
    main()
