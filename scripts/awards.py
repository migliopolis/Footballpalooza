"""Build data/awards.json for the Awards tab.

League awards count only points scored in an FBP starting lineup, and only players on an FBP
roster. Inputs (all saved by the weekly refresh):
  data/mfl/weeklyResults.json   starters and bench by week (refresh_mfl.py)
  data/mfl/transactions.json    trades, waiver claims, free-agent pickups
  data/mfl/rosters.json         current rosters and salaries
  data/mfl/players.json         names, positions, NFL teams, draft year
  data/player-links.json        MFL id -> ESPN id (photos) and display name
  data/league-now.json          standings: points, potential points, all-play
Run: python scripts/awards.py
"""
import json, math, os, re
from collections import defaultdict
from datetime import datetime, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
D = lambda *p: os.path.join(ROOT, 'data', *p)
as_list = lambda x: x if isinstance(x, list) else ([x] if x else [])
SLOTS = ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'DEF']   # 2026 starting lineup
FLEX_OK = {'RB', 'WR', 'TE'}


def load(path, default=None):
    try:
        return json.load(open(path))
    except Exception:
        return default


def display(name):
    name = (name or '').strip()
    if ',' in name:
        last, first = [x.strip() for x in name.split(',', 1)]
        return f'{first} {last}'
    return name


def main():
    meta = load(D('mfl', '_meta.json'), {})
    season = str(meta.get('season') or '2026')
    wr = load(D('mfl', 'weeklyResults.json'), {}) or {}
    weeks = wr.get('weeks') or {}
    out = {'generated': datetime.now(timezone.utc).isoformat(timespec='seconds'), 'season': season}
    if not weeks:
        out['ready'] = False
        json.dump(out, open(D('awards.json'), 'w'), indent=1)
        print('awards.json: no weekly results yet')
        return

    P = load(D('mfl', 'players.json'), {}) or {}
    fields = P.get('fields', [])
    pinfo = {pid: dict(zip(fields, row)) for pid, row in (P.get('players') or {}).items()}
    links = (load(D('player-links.json'), {}) or {}).get('links', {})

    # current rosters: owner, salary, contract
    owner, salary, contract = {}, {}, {}
    for f in as_list((load(D('mfl', 'rosters.json'), {}) or {}).get('rosters', {}).get('franchise')):
        for pl in as_list(f.get('player')):
            owner[pl['id']] = f['id']
            try:
                salary[pl['id']] = float(pl.get('salary') or 0)
            except ValueError:
                salary[pl['id']] = 0.0
            contract[pl['id']] = pl.get('contractYear', '')

    # starter points: by player, by (player, franchise), and every single game
    tot, starts, by_team, games = defaultdict(float), defaultdict(int), defaultdict(float), []
    wk_nums = sorted(int(w) for w in weeks)
    for w in wk_nums:
        for fr, t in weeks[str(w)].items():
            for pid, pts in t.get('s', []):
                tot[pid] += pts; starts[pid] += 1; by_team[(pid, fr)] += pts
                games.append((pts, w, pid, fr))
    last_wk = wk_nums[-1]

    def player(pid, pts=None, team=None):
        i = pinfo.get(pid, {})
        pos = i.get('position', '')
        pos = 'DEF' if pos == 'Def' else pos
        l = links.get(pid) or []
        espn = (l[0] if l else '') or i.get('espn_id', '')
        nm = (l[2] if len(l) > 2 and l[2] else '') or display(i.get('name', pid))
        return {'id': pid, 'name': nm, 'pos': pos, 'nfl': i.get('team', ''), 'espn': espn if pos != 'DEF' else '',
                'team': team or owner.get(pid), 'pts': round(tot[pid] if pts is None else pts, 1), 'starts': starts[pid],
                'ppg': round(tot[pid] / starts[pid], 1) if starts[pid] else 0, 'salary': salary.get(pid),
                'contract': contract.get(pid, ''), 'rookie': i.get('draft_year') == season}

    pos_of = lambda pid: ('DEF' if pinfo.get(pid, {}).get('position') == 'Def' else pinfo.get(pid, {}).get('position', ''))
    eligible = sorted((pid for pid in tot if pid in owner), key=lambda p: -tot[p])   # rostered now

    # All-FBP 1st and 2nd teams: best starter points at each lineup spot, FLEX = best RB/WR/TE left
    used, teams = set(), []
    for _ in range(2):
        team = []
        for slot in SLOTS:
            ok = FLEX_OK if slot == 'FLEX' else {slot}
            pick = next((p for p in eligible if p not in used and pos_of(p) in ok), None)
            if pick:
                used.add(pick); team.append({'slot': slot, 'player': player(pick)})
        teams.append(team)
    out['allFbp'] = {'first': teams[0], 'second': teams[1]}

    A = []
    half = max(2, math.ceil(len(wk_nums) / 2))
    # MVP
    if eligible:
        A.append({'key': 'mvp', 'title': 'MVP', 'why': 'Most points in an FBP starting lineup',
                  'list': [player(p) for p in eligible[:3]]})
    # Best value: starter points per salary dollar, regular starters only
    val = [p for p in eligible if starts[p] >= half and (salary.get(p) or 0) > 0]
    val.sort(key=lambda p: -tot[p] / salary[p])
    if val:
        A.append({'key': 'value', 'title': 'Best Value', 'why': f'Most starter points per salary dollar (at least {half} starts)',
                  'list': [dict(player(p), perDollar=round(tot[p] / salary[p], 1)) for p in val[:3]]})
    # Rookie of the Year
    rk = [p for p in eligible if pinfo.get(p, {}).get('draft_year') == season]
    if rk:
        A.append({'key': 'rookie', 'title': 'Rookie of the Year', 'why': f'Top {season} rookie by starter points',
                  'list': [player(p) for p in rk[:3]]})

    # pickups and trades
    tx = (load(D('mfl', 'transactions.json'), {}) or {}).get('transactions', [])
    claims = {}
    for t in tx:
        if t.get('type') not in ('BBID_WAIVER', 'WAIVER', 'FREE_AGENT'):
            continue
        parts = (t.get('transaction') or '').split('|')
        added = [x for x in parts[0].split(',') if x.strip()]
        bid = 0.0
        if t['type'] == 'BBID_WAIVER' and len(parts) > 1:
            try: bid = float(parts[1])
            except ValueError: bid = 0.0
        for pid in added:
            claims[(pid, t.get('franchise'))] = {'bid': bid, 'type': t['type'], 'ts': int(t.get('timestamp') or 0)}
    pick = sorted(((by_team[k], k, v) for k, v in claims.items() if by_team[k] > 0), key=lambda x: -x[0])
    if pick:
        A.append({'key': 'waiver', 'title': 'Waiver Claim of the Year', 'why': 'Most starter points for the team that picked him up',
                  'list': [dict(player(k[0], pts, k[1]), bid=v['bid'], how='FAAB' if v['type'] == 'BBID_WAIVER' else 'Free agent') for pts, k, v in pick[:3]]})

    trades = []
    for t in tx:
        if t.get('type') != 'TRADE':
            continue
        a, b = t.get('franchise'), t.get('franchise2')
        gave_a = [x for x in (t.get('franchise1_gave_up') or '').split(',') if x.strip()]
        gave_b = [x for x in (t.get('franchise2_gave_up') or '').split(',') if x.strip()]
        side = lambda fr, got: {'team': fr, 'players': [player(x, by_team[(x, fr)], fr) for x in got if x.isdigit()],
                                'picks': [x for x in got if not x.isdigit()], 'pts': round(sum(by_team[(x, fr)] for x in got if x.isdigit()), 1)}
        sa, sb = side(a, gave_b), side(b, gave_a)   # what each team received
        if sa['pts'] < sb['pts']:
            sa, sb = sb, sa
        trades.append({'winner': sa, 'loser': sb, 'margin': round(sa['pts'] - sb['pts'], 1), 'ts': int(t.get('timestamp') or 0)})
    trades.sort(key=lambda x: -x['margin'])
    if trades and trades[0]['margin'] > 0:
        A.append({'key': 'trade', 'title': 'Trade of the Year', 'why': 'Biggest edge in starter points from what each side received', 'trade': trades[0]})

    # team awards from the standings
    now = load(D('league-now.json'), {}) or {}
    st = now.get('standings') or []
    eff = sorted((s for s in st if s.get('pp')), key=lambda s: -s['pf'] / s['pp'])
    if eff:
        A.append({'key': 'manager', 'title': 'Manager of the Year', 'why': 'Best lineup calls: actual points over the most the roster could have scored',
                  'teams': [{'team': s['id'], 'stat': f"{100 * s['pf'] / s['pp']:.1f}%", 'sub': f"{s['pf']:.1f} of {s['pp']:.1f} possible"} for s in eff[:3]]})
    def ap(s):
        g = s['allPlayW'] + s['allPlayL'] + s['allPlayT']
        return (s['allPlayW'] + s['allPlayT'] / 2) / g if g else 0
    luck = sorted(st, key=lambda s: -(s['pct'] - ap(s)))
    if luck:
        lk = lambda s: {'team': s['id'], 'stat': f"{'+' if s['pct'] - ap(s) >= 0 else ''}{(s['pct'] - ap(s)) * 100:.0f}% win", 'sub': f"{s['w']}-{s['l']}{'-' + str(s['t']) if s['t'] else ''} record, {s['allPlayW']}-{s['allPlayL']} all-play"}
        A.append({'key': 'lucky', 'title': 'Luckiest Team', 'why': 'Record furthest above what its all-play record suggests', 'teams': [lk(s) for s in luck[:3]]})
        A.append({'key': 'unlucky', 'title': 'Unluckiest Team', 'why': 'Record furthest below its all-play record', 'teams': [lk(s) for s in luck[::-1][:3]]})
    # worst contract: big salaries with the fewest starter points per dollar
    big = [p for p in owner if (salary.get(p) or 0) >= 15 and pos_of(p) in {'QB', 'RB', 'WR', 'TE'}]
    big.sort(key=lambda p: tot.get(p, 0) / salary[p])
    if big:
        A.append({'key': 'contract', 'title': 'Worst Contract', 'why': 'Fewest starter points per dollar among $15+ salaries',
                  'list': [dict(player(p), perDollar=round(tot.get(p, 0) / salary[p], 1)) for p in big[:3]]})
    # games
    wk_games = sorted((g for g in games if g[1] == last_wk), key=lambda g: -g[0])
    if wk_games:
        A.append({'key': 'week', 'title': f'Player of Week {last_wk}', 'why': 'Top starter score last week',
                  'list': [dict(player(g[2], g[0], g[3]), week=g[1]) for g in wk_games[:3]]})
    hi = sorted(games, key=lambda g: -g[0])
    if hi:
        A.append({'key': 'high', 'title': 'Season-High Game', 'why': 'Best single-week starter score this season',
                  'list': [dict(player(g[2], g[0], g[3]), week=g[1]) for g in hi[:3]]})

    out.update({'ready': True, 'throughWeek': last_wk, 'awards': A})
    json.dump(out, open(D('awards.json'), 'w'), indent=1, ensure_ascii=False)
    print(f'awards.json: through week {last_wk}, {len(A)} awards')


if __name__ == '__main__':
    main()
