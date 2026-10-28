"""Build data/payroll.json: what players have been paid in FBP, 2019 to now (Reference > Payroll).

A player's pay for a season is his auction price that year, or the salary he carried on a roster
(keepers, rookie deals, trades). Waiver-claim contracts don't count unless they were kept into the
next season, since waivers are sometimes overpaid just to get the player.
Salaries come from end-of-season rosters, so a kept player cut mid-season isn't counted that year.
Value numbers use starter points (any team) and start in 2021, the first season with weekly lineups saved.
Run: python scripts/payroll.py
"""
import json, os, re, glob, collections
from datetime import datetime, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
D = lambda *p: os.path.join(ROOT, 'data', *p)
load = lambda p, d=None: json.load(open(p)) if os.path.exists(p) else d
FIRST, CUR = 2019, int((load(D('mfl', '_meta.json'), {}) or {}).get('season', 2026))
YEARS = range(FIRST, CUR + 1)
POS = {'Def': 'DEF'}


def names_pos():
    names, pos, espn = {}, {}, {}
    links = (load(D('player-links.json'), {}) or {}).get('links', {})
    files = [D('mfl', 'players.json')] + sorted(glob.glob(D('history', '*', 'players.json')), reverse=True)
    for f in files:
        P = load(f, {}) or {}
        if 'fields' in P:
            fl = P['fields']
            for k, v in P['players'].items():
                r = dict(zip(fl, v)); names.setdefault(k, r.get('name')); pos.setdefault(k, r.get('position')); espn.setdefault(k, r.get('espn_id') or '')
        else:
            for p in (P.get('players') or {}).get('player', []):
                names.setdefault(p['id'], p.get('name')); pos.setdefault(p['id'], p.get('position'))
    for k, l in links.items():
        if l and l[0]: espn[k] = l[0]
        if len(l) > 2 and l[2]: names[k] = l[2]
    def nice(n):
        n = n or ''
        if ', ' in n: last, first = n.split(', ', 1); return f'{first} {last}'
        return n
    return {k: nice(v) for k, v in names.items()}, {k: POS.get(v, v) for k, v in pos.items()}, espn


def main():
    names, pos, espn = names_pos()
    ref = load(D('reference.json'), {})
    auc = {y: {p['player_id']: p for p in ref['auction_results'].get(str(y), [])} for y in YEARS}
    ros = {}
    for y in YEARS:
        f = D('mfl', 'rosters.json') if y == CUR else D('history', str(y), 'rosters.json')
        ros[y] = {p['id']: (fr['id'], p) for fr in (load(f, {}) or {}).get('rosters', {}).get('franchise', []) for p in fr.get('player') or []}
    # contracts paid each season
    rows, excluded = [], []
    for y in YEARS:
        for pid, a in auc[y].items():
            rows.append(dict(y=y, pid=pid, fr=a['franchise'], sal=float(a['price'] or 0), how='Auction'))
        for pid, (fr, p) in ros[y].items():
            if pid in auc[y]: continue                       # re-signed at auction this year; the auction price is the deal
            sal = float(p.get('salary') or 0)
            if sal <= 0: continue
            d = p.get('drafted') or ''; cy = p.get('contractYear') or ''
            m = re.search(r'\((\d{4})\)', d); origin = int(m.group(1)) if m else y
            first = cy.split('/')[0] if cy else ''
            # a fresh 1/x contract that didn't come from this year's auction is a waiver claim, whatever the stale 'drafted' note says
            fresh_waiver = first == '1' and origin < y and not cy.endswith(('/5', '/6'))
            if (d.startswith('BB') and origin == y) or fresh_waiver:
                nxt = ros.get(y + 1, {}).get(pid)
                kept = (first not in ('', '1')) or bool(nxt and nxt[0] == fr and (nxt[1].get('contractYear') or '').startswith('2/'))
                if not kept:
                    excluded.append(dict(y=y, pid=pid, fr=fr, sal=sal)); continue
            how = ('Waiver (kept)' if fresh_waiver or (d.startswith('BB') and origin == y) else 'Rookie deal' if ('Draft' in d or re.match(r'\d\.\d\d', d))
                   else 'Keeper' if origin < y else 'Trade' if d.startswith('Trade') else 'Keeper')
            rows.append(dict(y=y, pid=pid, fr=fr, sal=sal, how=how, taxi=p.get('status') == 'TAXI_SQUAD'))
    # starter points by player-season (any team), 2021 on
    pts, games = collections.Counter(), collections.Counter()
    for y in YEARS:
        if y < 2021: continue
        f = D('mfl', 'weeklyResults.json') if y == CUR else D('history', str(y), 'weeklyResults.json')
        W = (load(f, {}) or {}).get('weeks', {})
        last = (load(f, {}) or {}).get('lastRegularSeasonWeek') or 14
        for wk, teams in W.items():
            if int(wk) > last: continue
            for t in teams.values():
                for pid, p in t.get('s', []): pts[(y, pid)] += p; games[(y, pid)] += 1
    for r in rows: r['pts'] = round(pts[(r['y'], r['pid'])], 1) if r['y'] >= 2021 else None
    P = lambda pid: dict(id=pid, name=names.get(pid, pid), pos=pos.get(pid, ''), espn=espn.get(pid, ''))
    # career board
    car = collections.defaultdict(lambda: dict(total=0.0, yrs=set(), teams=[], peak=(0, 0), vs=0.0, vp=0.0))
    for r in rows:
        c = car[r['pid']]; c['total'] += r['sal']; c['yrs'].add(r['y'])
        if r['fr'] not in c['teams']: c['teams'].append(r['fr'])
        if r['sal'] > c['peak'][0]: c['peak'] = (r['sal'], r['y'])
        if r['y'] >= 2021 and r['y'] < CUR: c['vs'] += r['sal']; c['vp'] += r['pts'] or 0
    career = sorted(car.items(), key=lambda x: -x[1]['total'])
    board = [P(pid) | dict(total=round(c['total']), seasons=len(c['yrs']), first=min(c['yrs']), last=max(c['yrs']), teams=c['teams'],
             peak=round(c['peak'][0]), peakYear=c['peak'][1], ptsPerDollar=round(c['vp'] / c['vs'], 1) if c['vs'] >= 40 else None)
             for pid, c in career[:30]]
    # by season
    seasons = []
    for y in YEARS:
        R = [r for r in rows if r['y'] == y]
        share = collections.Counter()
        for r in R: share[pos.get(r['pid'], '?')] += r['sal']
        tot = sum(share.values()) or 1
        top = sorted(R, key=lambda r: -r['sal'])[:8]
        aucs = sorted((r['sal'] for r in R if r['how'] == 'Auction'), reverse=True)
        seasons.append(dict(year=y, total=round(tot), contracts=len(R), share={k: round(v / tot * 100, 1) for k, v in share.items() if k in ('QB', 'RB', 'WR', 'TE', 'DEF')},
                            top=[P(r['pid']) | dict(fr=r['fr'], sal=round(r['sal']), how=r['how'], pts=r['pts']) for r in top],
                            auctionTop12=round(sum(aucs[:12]) / max(1, len(aucs[:12])), 1), over40=sum(1 for r in R if r['sal'] >= 40)))
    # value, 2021 to last complete season, $20+
    val = [r for r in rows if 2021 <= r['y'] < CUR and r['sal'] >= 20 and not r.get('taxi')]   # taxi stashes aren't meant to play
    vrow = lambda r: P(r['pid']) | dict(year=r['y'], fr=r['fr'], sal=round(r['sal']), pts=r['pts'], per=round((r['pts'] or 0) / r['sal'], 1), how=r['how'])
    bargains = [vrow(r) for r in sorted(val, key=lambda r: -(r['pts'] or 0) / r['sal'])[:10]]
    busts = [vrow(r) for r in sorted([r for r in val if r['sal'] >= 30], key=lambda r: (r['pts'] or 0) / r['sal'])[:10]]
    travelers = [P(pid) | dict(teams=c['teams'], total=round(c['total']), seasons=len(c['yrs'])) for pid, c in sorted(car.items(), key=lambda x: (-len(x[1]['teams']), -x[1]['total'])) if pos.get(pid) != 'DEF'][:8]
    bypos = {}
    for ps in ('QB', 'RB', 'WR', 'TE'):
        bypos[ps] = [b for b in (P(pid) | dict(total=round(c['total']), seasons=len(c['yrs'])) for pid, c in career) if b['pos'] == ps][:5]
    out = dict(generated=datetime.now(timezone.utc).isoformat(timespec='seconds'), first=FIRST, current=CUR,
               totals=dict(paid=round(sum(r['sal'] for r in rows)), contracts=len(rows), players=len(car),
                           excludedWaivers=len(excluded), excludedDollars=round(sum(e['sal'] for e in excluded)),
                           biggest=max(([P(r['pid']) | dict(sal=round(r['sal']), year=r['y'], fr=r['fr']) for r in rows]), key=lambda x: x['sal'])),
               career=board, seasons=seasons, bargains=bargains, busts=busts, travelers=travelers, byPosition=bypos,
               biggestWaivers=[P(e['pid']) | dict(year=e['y'], fr=e['fr'], sal=round(e['sal'])) for e in sorted(excluded, key=lambda e: -e['sal'])[:5]])
    json.dump(out, open(D('payroll.json'), 'w'), indent=1, ensure_ascii=False)
    print(f"payroll.json: ${out['totals']['paid']:,} across {len(rows)} contracts, {len(car)} players; {len(excluded)} waiver deals left out")


if __name__ == '__main__':
    main()
