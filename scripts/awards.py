"""Build the Awards tab data: data/awards.json (this season) and data/awards/<year>.json (past seasons).

League awards count only points scored in an FBP starting lineup, regular season only.
This season, only players on an FBP roster now count. Past seasons count everyone who started.

This season's inputs (saved by the weekly refresh):
  data/mfl/weeklyResults.json, transactions.json, rosters.json, players.json, league.json
  data/player-links.json        MFL id -> ESPN id (photos) and display name
  data/league-now.json          standings: points, potential points, all-play
Past seasons (2019 on, saved once by scripts/backfill_history.py):
  data/history/<year>/weeklyResults.json, transactions.json, rosters.json, players.json, league.json
  data/reference/history.json   standings (points, potential points, all-play) for each year
Run: python scripts/awards.py
"""
import json, sys, math, os, re
from collections import defaultdict
from datetime import datetime, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
D = lambda *p: os.path.join(ROOT, 'data', *p)
as_list = lambda x: x if isinstance(x, list) else ([x] if x else [])
DEFAULT_SLOTS = ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'DEF']   # 2026 starting lineup
SLOT_ORDER = ['QB', 'RB', 'WR', 'TE']


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


def lineup_slots(league):
    """All-FBP spots from MFL's starter settings: each position's minimum, then FLEX spots for the rest."""
    st = (league or {}).get('starters') or {}
    try:
        count = int(st.get('count'))
        lim = {}
        for p in as_list(st.get('position')):
            lo, _, hi = str(p.get('limit', '0')).partition('-')
            lim['DEF' if p['name'] == 'Def' else p['name']] = (int(lo), int(hi or lo))
    except Exception:
        return DEFAULT_SLOTS, {'RB', 'WR', 'TE'}
    slots = [pos for pos in SLOT_ORDER for _ in range(lim.get(pos, (0, 0))[0])]
    flex_ok = {pos for pos, (lo, hi) in lim.items() if hi > lo and pos != 'DEF'}
    slots += ['FLEX'] * max(0, count - sum(lo for lo, _ in lim.values()))
    slots += ['DEF'] * lim.get('DEF', (0, 0))[0]
    return slots, flex_ok or {'RB', 'WR', 'TE'}


status = {}


def build(season, weeks, pinfo, links, owner, salary, contract, tx, standings, slots, flex_ok, rostered_only, rookie_pts=None, moy=None):
    """Every award for one season. weeks: {week: {franchise: {'s': [[id, pts]], 'n': [...]}}}, regular season only."""
    out = {'season': season}
    tot, starts, by_team, games = defaultdict(float), defaultdict(int), defaultdict(float), []
    bench, bench_wks = defaultdict(float), defaultdict(int)   # points left on an FBP bench, by (player, team)
    wk_nums = sorted(int(w) for w in weeks)
    for w in wk_nums:
        for fr, t in weeks[str(w)].items():
            for pid, pts in t.get('s', []):
                tot[pid] += pts; starts[pid] += 1; by_team[(pid, fr)] += pts
                games.append((pts, w, pid, fr))
            for pid, pts in t.get('n', []):   # bench = rostered but not started; free agents never appear here
                bench[(pid, fr)] += pts; bench_wks[(pid, fr)] += 1
    if not wk_nums:
        out['ready'] = False
        return out
    last_wk = wk_nums[-1]

    # the team shown with a player: his roster now this season; in past seasons the team he scored most for
    team_of = dict(owner)
    if not rostered_only:
        best = {}
        for (pid, fr), pts in by_team.items():
            if pts > best.get(pid, (-1, None))[0]:
                best[pid] = (pts, fr)
        team_of = {pid: fr for pid, (_, fr) in best.items()}

    def player(pid, pts=None, team=None):
        i = pinfo.get(pid, {})
        pos = i.get('position', '')
        pos = 'DEF' if pos == 'Def' else pos
        l = links.get(pid) or []
        espn = (l[0] if l else '') or i.get('espn_id', '')
        nm = (l[2] if len(l) > 2 and l[2] else '') or display(i.get('name', pid))
        return {'id': pid, 'name': nm, 'pos': pos, 'nfl': i.get('team', ''), 'espn': espn if pos != 'DEF' else '',
                'team': team or team_of.get(pid), 'pts': round(tot[pid] if pts is None else pts, 1), 'starts': starts[pid],
                'ppg': round(tot[pid] / starts[pid], 1) if starts[pid] else 0, 'salary': salary.get(pid),
                'contract': contract.get(pid, ''), 'rookie': str(i.get('draft_year')) == season}

    pos_of = lambda pid: ('DEF' if pinfo.get(pid, {}).get('position') == 'Def' else pinfo.get(pid, {}).get('position', ''))
    eligible = sorted((pid for pid in tot if (pid in owner or not rostered_only) and pos_of(pid)), key=lambda p: -tot[p])

    # All-FBP 1st and 2nd teams: best starter points at each lineup spot, FLEX = best RB/WR/TE left
    used, teams = set(), []
    for _ in range(2):
        team = []
        for slot in slots:
            ok = flex_ok if slot == 'FLEX' else {slot}
            pick = next((p for p in eligible if p not in used and pos_of(p) in ok), None)
            if pick:
                used.add(pick); team.append({'slot': slot, 'player': player(pick)})
        teams.append(team)
    out['allFbp'] = {'first': teams[0], 'second': teams[1]}

    # All-FBP Rookie Team: this season's rookies on an FBP roster, by every point they scored (started, benched or on the
    # taxi squad). rookie_pts: {player: season points}, from MFL's weekly player scores; current season only for now.
    if rookie_pts:
        rk_pool = sorted((p for p in rookie_pts if p in owner and str(pinfo.get(p, {}).get('draft_year')) == season
                          and pos_of(p) in ('QB', 'RB', 'WR', 'TE') and rookie_pts[p] > 0), key=lambda p: -rookie_pts[p])
        rused, rteam = set(), []
        for slot in slots:
            if slot == 'DEF':
                continue
            ok = flex_ok if slot == 'FLEX' else {slot}
            pick = next((p for p in rk_pool if p not in rused and pos_of(p) in ok), None)
            if pick:
                rused.add(pick)
                pl = player(pick, team=owner.get(pick))
                pl['allPts'] = round(rookie_pts[pick], 1)
                pl['status'] = status.get(pick, '') if status else ''
                pl['pick'] = rookie_pick(season, pick)
                rteam.append({'slot': slot, 'player': pl})
        if rteam:
            out['allFbp']['rookie'] = rteam

    A = []
    half = max(2, math.ceil(len(wk_nums) / 2))
    if eligible:
        A.append({'key': 'mvp', 'title': 'MVP', 'why': 'Most points in an FBP starting lineup',
                  'list': [player(p) for p in eligible[:3]]})
    # Best value: starter points per salary dollar, regular starters only, no defenses
    val = [p for p in eligible if starts[p] >= half and (salary.get(p) or 0) > 0 and pos_of(p) != 'DEF']
    val.sort(key=lambda p: -tot[p] / salary[p])
    if val:
        A.append({'key': 'value', 'title': 'Best Value', 'why': f'Most starter points per salary dollar (at least {half} starts; no defenses)',
                  'list': [dict(player(p), perDollar=round(tot[p] / salary[p], 1)) for p in val[:3]]})
    # Left on the Bench: most points scored while sitting on an FBP bench (one team's bench; waiver-wire points don't count)
    bl = sorted(((k, v) for k, v in bench.items() if v > 0 and pos_of(k[0])), key=lambda kv: -kv[1])[:3]
    if bl:
        A.append({'key': 'bench', 'title': 'Left on the Bench', 'why': 'Most points scored while sitting on an FBP bench',
                  'list': [dict(player(pid, pts=v, team=fr), benchWeeks=bench_wks[(pid, fr)], started=starts[pid]) for (pid, fr), v in bl]})
    # Rookie of the Year: every point a rookie scores counts (starting lineup, bench or taxi squad) when the weekly
    # player scores are there (this season); past seasons' saved results only have starters and bench
    if rookie_pts:
        rk = sorted((p for p in rookie_pts if p in owner and str(pinfo.get(p, {}).get('draft_year')) == season
                     and pos_of(p) and rookie_pts[p] > 0), key=lambda p: -rookie_pts[p])
        if rk:
            A.append({'key': 'rookie', 'title': 'Rookie of the Year', 'why': f'Top {season} rookie by every point scored: starting lineup, bench or taxi squad',
                      'list': [dict(player(p, pts=rookie_pts[p], team=owner.get(p)), starterPts=round(tot[p], 1)) for p in rk[:3]]})
    else:
        rk = [p for p in eligible if str(pinfo.get(p, {}).get('draft_year')) == season]
        if rk:
            A.append({'key': 'rookie', 'title': 'Rookie of the Year', 'why': f'Top {season} rookie by starter points',
                      'list': [player(p) for p in rk[:3]]})

    # pickups
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
    pick = sorted(((by_team[k], k, v) for k, v in claims.items() if by_team[k] > 0 and pos_of(k[0]) not in ('DEF', '')), key=lambda x: -x[0])
    if pick:
        A.append({'key': 'waiver', 'title': 'Waiver Claim of the Year', 'why': 'Most starter points for the team that picked him up (no defenses)',
                  'list': [dict(player(k[0], pts, k[1]), bid=v['bid'], how='FAAB' if v['type'] == 'BBID_WAIVER' else 'Free agent') for pts, k, v in pick[:3]]})

    # trades: what each side received, and its starter points for its new team that season
    tx = [t for t in apply_trade_fixes([dict(t) for t in tx]) if not (t.get('type') == 'TRADE' and is_bookkeeping(t))]
    trades = []
    last_got = {}   # (team, pick) -> when that team last received the pick (a pick moved twice is credited once)
    for t in tx:
        if t.get('type') == 'TRADE':
            for fr, gave in ((t.get('franchise'), t.get('franchise2_gave_up')), (t.get('franchise2'), t.get('franchise1_gave_up'))):
                for x in (gave or '').split(','):
                    if x.strip() and not x.isdigit():
                        last_got[(fr, x)] = max(last_got.get((fr, x), 0), int(t.get('timestamp') or 0))
    for t in tx:
        if t.get('type') != 'TRADE':
            continue
        a, b = t.get('franchise'), t.get('franchise2')
        gave_a = [x for x in (t.get('franchise1_gave_up') or '').split(',') if x.strip()]
        gave_b = [x for x in (t.get('franchise2_gave_up') or '').split(',') if x.strip()]
        if not (gave_a or gave_b) or not (a and b):
            continue
        ts = int(t.get('timestamp') or 0)
        def side(fr, got):
            # a pick used in this season's draft counts as the player taken with it: both sides scored that season
            picks = [x for x in got if not x.isdigit()]
            drafts = {k: v for k in picks for v in [drafted(k, season)] if v and str(v['year']) == str(season)
                      and v['by'] == fr and last_got.get((fr, k)) == ts}   # he made the pick, and this trade is how he got it
            pids = [x for x in got if x.isdigit()] + [v['id'] for v in drafts.values()]
            return {'team': fr, 'players': [player(x, by_team[(x, fr)], fr) for x in got if x.isdigit()],
                    'picks': picks, 'drafted': {k: dict(v, pts=round(by_team[(v['id'], fr)], 1)) for k, v in drafts.items()},
                    'pts': round(sum(by_team[(x, fr)] for x in pids), 1)}
        sa, sb = side(a, gave_b), side(b, gave_a)
        if sa['pts'] < sb['pts']:
            sa, sb = sb, sa
        trades.append({'winner': sa, 'loser': sb, 'margin': round(sa['pts'] - sb['pts'], 1), 'ts': int(t.get('timestamp') or 0)})
    trades.sort(key=lambda x: -x['margin'])
    if trades and trades[0]['margin'] > 0:
        A.append({'key': 'trade', 'title': 'Trade of the Year', 'why': 'Biggest edge in starter points from what each side received (a pick used in that season\'s draft counts as the player taken)', 'trade': trades[0],
                  'more': [t for t in trades[1:5] if t['margin'] > 0]})

    # team awards from the standings
    m = manager_award(standings, tx, weeks, wk_nums, slots, pinfo, by_team, moy)
    if m:
        A.append(m)

    def ap(s):
        g = s['allPlayW'] + s['allPlayL'] + s['allPlayT']
        return (s['allPlayW'] + s['allPlayT'] / 2) / g if g else 0
    luck = sorted(standings, key=lambda s: -(s['pct'] - ap(s)))
    if luck:
        def should_be(s):
            # the record the all-play rate points to over the same number of games
            g = s['w'] + s['l'] + s['t']
            w = round(g * ap(s))
            return f"{w}-{g - w}"
        lk = lambda s: {'team': s['id'], 'stat': f"{'+' if s['pct'] - ap(s) >= 0 else ''}{(s['pct'] - ap(s)) * 100:.0f}% win",
                        'sub': f"{s['w']}-{s['l']}{'-' + str(s['t']) if s['t'] else ''} record, should be about {should_be(s)} · {s['allPlayW']}-{s['allPlayL']} all-play"}
        A.append({'key': 'lucky', 'title': 'Luckiest Team', 'why': 'Record furthest above what its all-play record suggests', 'teams': [lk(s) for s in luck[:3]]})
        A.append({'key': 'unlucky', 'title': 'Unluckiest Team', 'why': 'Record furthest below its all-play record', 'teams': [lk(s) for s in luck[::-1][:3]]})

    # worst contract: big salaries with the fewest starter points per dollar, regular starters only
    big = [p for p in salary if (salary.get(p) or 0) >= 15 and pos_of(p) in {'QB', 'RB', 'WR', 'TE'} and starts[p] >= half
           and (p in owner or not rostered_only)]
    big.sort(key=lambda p: tot.get(p, 0) / salary[p])
    if big:
        A.append({'key': 'contract', 'title': 'Worst Contract', 'why': f'Fewest starter points per dollar among $15+ salaries (at least {half} starts)',
                  'list': [dict(player(p), perDollar=round(tot.get(p, 0) / salary[p], 1)) for p in big[:3]]})

    # Player of the Week for every week; the page opens on the latest and can step back
    by_week = {}
    for w in wk_nums:
        top = sorted((g for g in games if g[1] == w and pos_of(g[2])), key=lambda g: -g[0])[:3]
        if top:
            by_week[str(w)] = [dict(player(g[2], g[0], g[3]), week=g[1]) for g in top]
    if by_week:
        A.append({'key': 'week', 'title': 'Player of the Week', 'why': 'Top starter score each week',
                  'list': by_week[str(last_wk)], 'weeks': by_week, 'week': last_wk})
    hi = sorted((g for g in games if pos_of(g[2])), key=lambda g: -g[0])
    if hi:
        A.append({'key': 'high', 'title': 'Season-High Game', 'why': 'Best single-week starter score of the season',
                  'list': [dict(player(g[2], g[0], g[3]), week=g[1]) for g in hi[:3]]})

    out.update({'ready': True, 'throughWeek': last_wk, 'awards': A})
    return out


def roster_maps(rosters):
    owner, salary, contract = {}, {}, {}
    for f in as_list((rosters or {}).get('rosters', {}).get('franchise')):
        for pl in as_list(f.get('player')):
            owner[pl['id']] = f['id']
            try:
                s = float(pl.get('salary') or 0)
            except ValueError:
                s = 0.0
            if s > 0 or pl['id'] not in salary:
                salary[pl['id']] = s
            contract[pl['id']] = pl.get('contractYear', '')
    return owner, salary, contract


def player_info(path):
    P = load(path, {}) or {}
    fields = P.get('fields', [])
    return {pid: dict(zip(fields, row)) for pid, row in (P.get('players') or {}).items()}


def manager_award(standings, tx, weeks, wk_nums, slots, pinfo, by_team, moy):
    # Manager of the Year: beating expectations (last season's record and the preseason roster), winning, real strength
    # (all-play), lineup calls and staying active, less small penalties for empty lineup spots, bye-week starters and
    # going quiet on the wire. Only teams at .500 or better qualify.
    moy = moy or {}
    n_sl = len(slots)
    adds, acq_pts, last_move = defaultdict(int), defaultdict(float), defaultdict(int)
    for t in tx:
        ty, ts = t.get('type'), int(t.get('timestamp') or 0)
        if ty in ('BBID_WAIVER', 'WAIVER', 'FREE_AGENT'):
            got = [x for x in (t.get('transaction') or '').split('|')[0].split(',') if x.strip()]
            fr = t.get('franchise')
            if got and fr:
                adds[fr] += 1; last_move[fr] = max(last_move[fr], ts)
                for pid in got: acq_pts[fr] += by_team[(pid, fr)]
        elif ty == 'TRADE':
            for fr, got in ((t.get('franchise'), t.get('franchise2_gave_up')), (t.get('franchise2'), t.get('franchise1_gave_up'))):
                got = [x for x in (got or '').split(',') if x.strip()]
                if fr and got:
                    adds[fr] += 1; last_move[fr] = max(last_move[fr], ts)
                    for pid in got:
                        if pid.isdigit(): acq_pts[fr] += by_team[(pid, fr)]
    newest = max((int(t.get('timestamp') or 0) for t in tx), default=0)
    empty, byes_in = defaultdict(int), defaultdict(int)
    bye = moy.get('byes') or {}
    for w in wk_nums:
        for fr, t in weeks[str(w)].items():
            empty[fr] += max(0, n_sl - len(t.get('s', [])))
            for pid, pts in t.get('s', []):
                tm = pinfo.get(pid, {}).get('team', '')
                if bye and not pts and bye.get(moy['nfl'](tm)) == w:
                    byes_in[fr] += 1
    rows = []
    last, pre = moy.get('last') or {}, moy.get('pre') or {}
    ids = [x['id'] for x in standings]
    prank = {f: i for i, f in enumerate(sorted((f for f in ids if f in pre), key=lambda f: -pre[f]))}
    for x in standings:
        g = x['w'] + x['l'] + x['t']
        if not g:
            continue
        pct = (x['w'] + x['t'] / 2) / g
        parts = [0.5 + 0.5 * (last[x['id']] - 0.5)] if x['id'] in last else []
        if x['id'] in prank and len(prank) > 1:
            parts.append(0.75 - 0.5 * prank[x['id']] / (len(prank) - 1))
        exp = sum(parts) / len(parts) if parts else 0.5
        apg = x['allPlayW'] + x['allPlayL'] + x['allPlayT']
        quiet = bool(newest) and last_move[x['id']] < newest - 28 * 86400
        rows.append({'id': x['id'], 'rec': f"{x['w']}-{x['l']}{'-' + str(x['t']) if x['t'] else ''}", 'pct': pct, 'exp': exp, 'over': pct - exp,
                     'ap': (x['allPlayW'] + x['allPlayT'] / 2) / apg if apg else 0, 'eff': x['pf'] / x['pp'] if x.get('pp') else 0,
                     'acq': acq_pts[x['id']], 'moves': math.log1p(adds[x['id']]), 'n': adds[x['id']],
                     'empty': empty[x['id']], 'bye': byes_in[x['id']], 'quiet': quiet})
    if rows:
        def z(k):
            xs = [r[k] for r in rows]; m = sum(xs) / len(xs); sd = (sum((v - m) ** 2 for v in xs) / len(xs)) ** .5 or 1
            for r in rows: r['z' + k] = (r[k] - m) / sd
        for k in ('over', 'pct', 'ap', 'eff', 'acq', 'moves'): z(k)
        for r in rows:
            r['score'] = (.40 * r['zover'] + .25 * r['zpct'] + .10 * r['zap'] + .10 * r['zeff'] + .15 * (.6 * r['zacq'] + .4 * r['zmoves'])
                          - .20 * r['empty'] - .15 * r['bye'] - (.25 if r['quiet'] else 0))
        top = sorted((r for r in rows if r['pct'] >= .5), key=lambda r: -r['score'])[:3]
        def sub(r):
            bits = [f"{r['n']} move{'' if r['n'] == 1 else 's'}"]
            if r['empty']: bits.append(f"{r['empty']} empty lineup spot{'' if r['empty'] == 1 else 's'}")
            if r['bye']: bits.append(f"{r['bye']} bye-week starter{'' if r['bye'] == 1 else 's'}")
            return ' · '.join(bits)
        if top:
            return ({'key': 'manager', 'title': 'Manager of the Year',
                      'why': '',
                      'teams': [{'team': r['id'], 'stat': r['rec'], 'sub': ''} for r in top]})

    return None


NFL_BYE = {'GBP': 'GB', 'KCC': 'KC', 'NEP': 'NE', 'NOS': 'NO', 'SFO': 'SF', 'TBB': 'TB', 'LVR': 'LV', 'JAX': 'JAC', 'WSH': 'WAS', 'LA': 'LAR'}


def moy_context(season, weeks, pinfo, ref=None):
    """Manager of the Year inputs: last season's win %, the preseason roster's strength (best week-1 lineup by OVR,
    current season only) and this season's NFL bye weeks (when saved)."""
    ref = ref or load(D('reference.json'), {}) or {}
    last = {}
    for r in (ref.get('standings_by_year') or {}).get(str(int(season) - 1)) or []:
        try: last[r['franchise']] = float(r['h2hpct'])
        except (KeyError, ValueError): pass
    pre = {}
    ovr = (load(D('ovr.json'), {}) or {}).get('players') or {}
    wk1 = weeks.get('1') or {}
    if ovr and wk1 and str((load(D('ovr.json'), {}) or {}).get('season', season)) == str(season):
        pos = lambda p: (pinfo.get(p) or {}).get('position', '')
        for fr, t in wk1.items():
            v = sorted((((ovr.get(p) or {}).get('h') or [(ovr.get(p) or {}).get('o') or 0])[0] or 0, p) for p in [x for l in ('s', 'n') for x, _ in t.get(l, [])] if p in ovr)[::-1]
            used, tot = set(), 0
            for want, n in (('QB', 1), ('RB', 2), ('WR', 2), ('TE', 1), ('FLEX', 1)):
                for val, p in v:
                    if n and p not in used and (pos(p) == want or (want == 'FLEX' and pos(p) in ('RB', 'WR', 'TE'))):
                        used.add(p); tot += val; n -= 1
            pre[fr] = tot
    by = load(D('reference', f'byes-{season}.json'), {}) or {}
    return {'last': last, 'pre': pre, 'byes': by.get('byes') or {}, 'nfl': lambda t: NFL_BYE.get(t, t)}



def current(links):
    meta = load(D('mfl', '_meta.json'), {})
    season = str(meta.get('season') or '2026')
    wr = load(D('mfl', 'weeklyResults.json'), {}) or {}
    weeks = wr.get('weeks') or {}
    stamp = datetime.now(timezone.utc).isoformat(timespec='seconds')
    if not weeks:
        return {'generated': stamp, 'season': season, 'ready': False}
    league = (load(D('mfl', 'league.json'), {}) or {}).get('league', {})
    reg = int(league.get('lastRegularSeasonWeek') or 14)
    weeks = {w: v for w, v in weeks.items() if int(w) <= reg}
    pinfo = player_info(D('mfl', 'players.json'))
    owner, salary, contract = roster_maps(load(D('mfl', 'rosters.json'), {}))
    tx = (load(D('mfl', 'transactions.json'), {}) or {}).get('transactions', [])
    st = (load(D('league-now.json'), {}) or {}).get('standings') or []
    slots, flex_ok = lineup_slots(league)
    # every point each rostered rookie scored, any lineup spot (weeklyScores.json has every player, taxi squad included)
    ps = (load(D('mfl', 'weeklyScores.json'), {}) or {}).get('weeks') or {}
    rookie_pts = defaultdict(float)
    for w, sc in ps.items():
        if int(w) <= reg and w in weeks:
            for pid, v in sc.items():
                rookie_pts[pid] += float(v or 0)
    for f in as_list((load(D('mfl', 'rosters.json'), {}) or {}).get('rosters', {}).get('franchise')):
        for pl in as_list(f.get('player')):
            status[pl['id']] = pl.get('status', '')
    out = build(season, weeks, pinfo, links, owner, salary, contract, tx, st, slots, flex_ok, rostered_only=True, rookie_pts=rookie_pts,
                moy=moy_context(season, weeks, pinfo))
    for a in out.get('awards', []):
        if a['key'] == 'rookie' and 'every point' in a.get('why', ''):
            a['note'] = 'New this season: all points count, not just starter points.'
    out['generated'] = stamp
    return out


def apply_trade_fixes(tx):
    """Add what MFL's trade records leave out (data/reference/trade-fixes.json): 2021 rookie picks traded in 2020,
    before MFL carried picks, and picks the commissioner moved separately from their trade. Changes tx in place."""
    fx = load(D('reference', 'trade-fixes.json'), {}) or {}
    drop = {str(x['ts']) for x in fx.get('drop') or []}   # a trade entered twice: the copy goes
    tx[:] = [t for t in tx if not (isinstance(t, dict) and t.get('type') == 'TRADE' and str(t.get('timestamp')) in drop)]
    by_ts = {str(t.get('timestamp')): t for t in tx if isinstance(t, dict) and t.get('type') == 'TRADE'}
    for x in fx.get('picks') or []:
        t = by_ts.get(str(x['ts']))
        if not t:
            continue
        k = 'franchise1_gave_up' if t.get('franchise') == x['f'] else 'franchise2_gave_up'
        have = [c for c in (t.get(k) or '').split(',') if c.strip()]
        t[k] = ','.join(have + [c for c in x['codes'] if c not in have]) + ','
    return tx


def is_bookkeeping(t):
    """The commissioner moving picks one way with nothing back: carrying out a pick trade made earlier, not a new trade."""
    a = [x for x in (t.get('franchise1_gave_up') or '').split(',') if x.strip()]
    b = [x for x in (t.get('franchise2_gave_up') or '').split(',') if x.strip()]
    return str(t.get('by_commish')) == '1' and not (a and b) and all(not x.isdigit() for x in a + b)


def standings_from_reference(rows):
    out = []
    for r in rows or []:
        try:
            w, l, t = (int(x) for x in r['h2hwlt'].split('-'))
            aw, al, at = (int(x) for x in r['all_play_wlt'].split('-')) if r.get('all_play_wlt') else (0, 0, 0)
            g = w + l + t
            out.append({'id': r['franchise'], 'w': w, 'l': l, 't': t, 'pct': (w + t / 2) / g if g else 0,
                        'pf': float(r['pf'] or 0), 'pp': float(r.get('pp') or 0), 'allPlayW': aw, 'allPlayL': al, 'allPlayT': at})
        except Exception:
            continue
    return out


_PICKS = {}


def rookie_pick(year, pid):
    """The FBP rookie-draft pick a player was taken with that year ('1.03'), 'Undrafted' when the draft is on file and
    he isn't in it, or None when there was no rookie draft (FBP started its rookie draft in 2021)."""
    if not _PICKS:
        ref = load(D('reference.json'), {}) or {}
        for y, rows in (ref.get('draft_classes') or {}).items():
            _PICKS[str(y)] = {str(r['player_id']): f"{int(r['round'])}.{str(int(r['pick'])).zfill(2)}" for r in rows if r.get('player_id')}
    d = _PICKS.get(str(year))
    return None if d is None else d.get(str(pid), 'Undrafted')


def past_rookie_points(year):
    """Saved regular-season points for a past season's rookies (every lineup spot), from data/reference/rookie-points.json."""
    return {k: float(v) for k, v in ((load(D('reference', 'rookie-points.json'), {}) or {}).get('seasons', {}).get(str(year)) or {}).items()}


def partial_season(year, links, ref, fallback_info):
    """A season without saved weekly results (2019, 2020): the All-FBP Rookie Team, Rookie of the Year and Manager of
    the Year from the final standings, rosters and saved rookie points. The other awards need weekly lineups."""
    H = lambda n: D('history', year, n + '.json')
    rpts = past_rookie_points(year)
    st = standings_from_reference((ref.get('standings_by_year') or {}).get(year))
    if not rpts or not st:
        return None
    pinfo = dict(fallback_info)
    pinfo.update(player_info(H('players')))
    owner, salary, contract = roster_maps(load(H('rosters'), {}))
    for f in as_list((load(H('rosters'), {}) or {}).get('rosters', {}).get('franchise')):
        for pl in as_list(f.get('player')):
            status[pl['id']] = pl.get('status', '')
    league = (load(H('league'), {}) or {}).get('league', {})
    slots, flex_ok = lineup_slots(league)
    pos_of = lambda pid: ('DEF' if pinfo.get(pid, {}).get('position') == 'Def' else pinfo.get(pid, {}).get('position', ''))

    def player(pid):
        i = pinfo.get(pid, {}); l = links.get(pid) or []
        return {'id': pid, 'name': (l[2] if len(l) > 2 and l[2] else '') or display(i.get('name', pid)), 'pos': pos_of(pid),
                'nfl': i.get('team', ''), 'espn': (l[0] if l else '') or i.get('espn_id', ''), 'team': owner.get(pid),
                'pts': round(rpts.get(pid, 0), 1), 'allPts': round(rpts.get(pid, 0), 1), 'starts': None, 'ppg': 0,
                'salary': salary.get(pid), 'contract': contract.get(pid, ''), 'rookie': True, 'status': status.get(pid, ''), 'pick': rookie_pick(year, pid)}
    pool = sorted((p for p in rpts if p in owner and str(pinfo.get(p, {}).get('draft_year')) == str(year) and pos_of(p) in ('QB', 'RB', 'WR', 'TE')),
                  key=lambda p: -rpts[p])
    used, team = set(), []
    for slot in slots:
        if slot == 'DEF':
            continue
        ok = flex_ok if slot == 'FLEX' else {slot}
        pick = next((p for p in pool if p not in used and pos_of(p) in ok), None)
        if pick:
            used.add(pick); team.append({'slot': slot, 'player': player(pick)})
    A = []
    if pool:
        A.append({'key': 'rookie', 'title': 'Rookie of the Year', 'why': f'Top {year} rookie by every point scored: starting lineup, bench or taxi squad',
                  'list': [player(p) for p in pool[:3]]})
    ctx = moy_context(year, {}, pinfo, ref)
    m = manager_award(st, [], {}, [], slots, pinfo, defaultdict(float), ctx) if ctx['last'] else None   # needs last season's record
    if m:
        A.append(m)
    return {'season': year, 'ready': True, 'final': True, 'partial': True, 'allFbp': {'first': [], 'second': [], 'rookie': team}, 'awards': A}


def past(year, links, ref, fallback_info):
    H = lambda n: D('history', year, n + '.json')
    wr = load(H('weeklyResults'), {}) or {}
    if not wr.get('weeks'):
        return None
    league = (load(H('league'), {}) or {}).get('league', {})
    reg = int(wr.get('lastRegularSeasonWeek') or league.get('lastRegularSeasonWeek') or 14)
    weeks = {w: v for w, v in wr['weeks'].items() if int(w) <= reg}
    if any(str(w) not in weeks for w in range(1, reg + 1)):   # only complete seasons get awards
        return None
    pinfo = dict(fallback_info)
    pinfo.update(player_info(H('players')))
    owner, salary, contract = roster_maps(load(H('rosters'), {}))
    tx = (load(H('transactions'), {}) or {}).get('transactions', [])
    st = standings_from_reference((ref.get('standings_by_year') or {}).get(year))
    # MFL's standings left out potential points some years: add up each week's optimal lineup instead
    opt = defaultdict(float)
    for wk in weeks.values():
        for fr, t in wk.items():
            try: opt[fr] += float(t.get('opt') or 0)
            except ValueError: pass
    for s in st:
        if not s['pp'] and opt.get(s['id']):
            s['pp'] = round(opt[s['id']], 1)
    slots, flex_ok = lineup_slots(league)
    rpts = past_rookie_points(year)
    for f in as_list((load(H('rosters'), {}) or {}).get('rosters', {}).get('franchise')):
        for pl in as_list(f.get('player')):
            status[pl['id']] = pl.get('status', '')
    out = build(year, weeks, pinfo, links, owner, salary, contract, tx, st, slots, flex_ok, rostered_only=False, rookie_pts=rpts,
                moy=moy_context(year, weeks, pinfo, ref))
    out['final'] = True
    # title: an All-FBP player on the champion's roster (starting or bench) in the championship game
    c = (ref.get('championships') or {}).get(year) or {}
    title_wk = (wr['weeks'].get(str(c.get('week'))) or {}).get(c.get('champion')) or {}
    on_champ = {pid for pid, _ in title_wk.get('s', []) + title_wk.get('n', [])}
    # every player shown that season (cards, award winners, trades): did he win the title, with whichever team
    for p in players_in(out):
        p['champ'] = p['id'] in on_champ
        p['champTeam'] = c.get('champion') if p['champ'] else None
    # what each All-FBP player scored, and how often he started, for the team he's listed with
    for team in out.get('allFbp', {}).values():
        for e in team:
            p = e['player']
            pts = [x for wk in weeks.values() for x in (wk.get(p['team']) or {}).get('s', []) if x[0] == p['id']]
            p['teamPts'], p['teamStarts'] = round(sum(x[1] for x in pts), 1), len(pts)
    return out


def players_in(obj):
    """Every player dict anywhere in an awards structure."""
    if isinstance(obj, dict):
        if 'id' in obj and 'pos' in obj and 'pts' in obj:
            yield obj
        for v in obj.values():
            yield from players_in(v)
    elif isinstance(obj, list):
        for v in obj:
            yield from players_in(v)


def add_honors(seasons):
    """Honors to date on every player shown: All-FBP selections and MVPs, each season counting itself
    and the ones before it. MVPs count only finished seasons (this season's leader isn't MVP yet).
    seasons: [(year, awards dict)], any order. Only seasons with saved data count (2021 on for now)."""
    tally, mvps = defaultdict(lambda: [0, 0, 0]), defaultdict(list)
    for y, a in sorted(seasons, key=lambda x: x[0]):
        if not a.get('ready'):
            continue
        for i, team in enumerate((a['allFbp']['first'], a['allFbp']['second'], a['allFbp'].get('rookie') or [])):
            for e in team:
                tally[e['player']['id']][i] += 1
        mvp = next((x for x in a['awards'] if x['key'] == 'mvp'), None)
        if mvp and a.get('final') and mvp['list']:
            mvps[mvp['list'][0]['id']].append(y)
            mvp['list'][0]['mvp'] = True          # this season's MVP
        for p in players_in(a):
            if p['id'] in mvps:
                p['mvps'] = list(mvps[p['id']])
        for team in (a['allFbp']['first'], a['allFbp']['second'], a['allFbp'].get('rookie') or []):
            for e in team:
                f, s2, rk = tally[e['player']['id']]
                e['player']['honors'] = {'first': f, 'second': s2, 'rookie': rk}
                if 'mvp' in mvp_flags(a, e['player']['id']):
                    e['player']['mvp'] = True
    return seasons


def mvp_flags(a, pid):
    m = next((x for x in a['awards'] if x['key'] == 'mvp'), None)
    return {'mvp'} if m and a.get('final') and m['list'] and m['list'][0]['id'] == pid else set()


def franchise_all_fbp(seasons):
    """data/awards/all-fbp.json: each franchise's All-FBP players (completed seasons), most accomplished first."""
    by = defaultdict(dict)
    for y, a in sorted(seasons):
        for tier, team in ((1, a['allFbp']['first']), (2, a['allFbp']['second']), (3, a['allFbp'].get('rookie') or [])):
            for e in team:
                p = e['player']
                if not p.get('team'):
                    continue
                r = by[p['team']].setdefault(p['id'], {k: p[k] for k in ('id', 'name', 'pos', 'nfl', 'espn')} | {'years': []})
                r['name'], r['nfl'] = p['name'], p['nfl'] or r['nfl']   # latest spelling and team
                r['years'].append({'year': y, 'tier': tier, 'pts': p.get('allPts', 0) if tier == 3 else p.get('teamPts', p['pts']), 'starts': 0 if tier == 3 else (p.get('teamStarts', p['starts']) or 0), 'champ': p.get('champTeam') == p['team'], 'mvp': bool(p.get('mvp'))} | ({'pick': p['pick']} if tier == 3 and p.get('pick') else {}))   # title with this franchise; MVP that season
    out = {}
    for fr, players in by.items():
        rows = []
        for r in players.values():
            ys = r['years']
            r['first'] = sum(1 for x in ys if x['tier'] == 1)
            r['second'] = sum(1 for x in ys if x['tier'] == 2)
            r['rookie'] = sum(1 for x in ys if x['tier'] == 3)
            r['champs'] = sum(1 for x in ys if x['champ'])
            r['mvps'] = sum(1 for x in ys if x['mvp'])
            r['pts'] = round(sum(x['pts'] for x in ys if x['tier'] < 3), 1)   # starter points in 1st/2nd Team seasons
            r['starts'] = sum(x['starts'] for x in ys if x['tier'] < 3)
            r['ppg'] = round(r['pts'] / r['starts'], 1) if r['starts'] else 0
            rows.append(r)
        rows.sort(key=lambda r: (-r['first'], -r['mvps'], -r['second'], -r['pts'], -r['rookie']))
        out[fr] = rows
    # Manager of the Year winners, finished seasons only
    moy = defaultdict(list)
    for y, a in sorted(seasons):
        m = next((x for x in a.get('awards', []) if x['key'] == 'manager' and x.get('teams')), None)
        if m:
            moy[m['teams'][0]['team']].append({'year': y, 'rec': m['teams'][0]['stat']})
    return {'seasons': [y for y, _ in sorted(seasons)], 'franchises': out, 'managers': moy}


def snapshot(a):
    """Who held each All-FBP spot, to compare with next week's teams."""
    return {'throughWeek': a.get('throughWeek'),
            'teams': [[{'slot': e['slot'], 'id': e['player']['id'], 'name': e['player']['name']} for e in a['allFbp'][k]]
                      for k in ('first', 'second')]}


def mark_changes(cur, prev):
    """This season only: a line on each card whose spot changed since the last weekly update.
    The comparison point is last week's teams; reruns in the same week keep the same comparison."""
    if not cur.get('ready'):
        return
    if prev.get('ready') and prev.get('throughWeek') and prev['throughWeek'] < cur['throughWeek']:
        basis = snapshot(prev)
    else:
        basis = prev.get('basis')
    cur['basis'] = basis
    if not basis:
        return
    old_tier = {x['id']: t for t, team in enumerate(basis['teams']) for x in team}
    old_pos = {x['id']: x['slot'] for team in basis['teams'] for x in team}
    new_tier = {e['player']['id']: t for t, k in enumerate(('first', 'second')) for e in cur['allFbp'][k]}
    label = ['1st Team', '2nd Team']
    for t, k in enumerate(('first', 'second')):
        team = cur['allFbp'][k]
        # spot shuffles inside a team don't count; only who joined and who left
        joined = [e for e in team if old_tier.get(e['player']['id']) != t]
        left = [x for x in basis['teams'][t] if new_tier.get(x['id']) != t]
        for e in joined:   # pair each newcomer with someone who left, same position first
            pick = next((x for x in left if x['slot'] == e['slot']), None) or (left[0] if left else None)
            if pick:
                left.remove(pick)
            p = e['player']
            was = old_tier.get(p['id'])
            head, d = ('New this week', 'new') if was is None else ((f'Up from {label[was]}', 'up') if was > t else (f'Down from {label[was]}', 'down'))
            tail = ''
            if pick and d != 'down':
                now = new_tier.get(pick['id'])
                tail = f" · replaced {pick['name']} ({'off the list' if now is None else 'now ' + label[now]})"
            p['change'] = {'dir': d, 'text': head + tail, 'since': basis['throughWeek']}


_DRAFT = {}


def drafted(code, season):
    """The player taken with traded pick `code` (DP_r_p = that season's draft, FP_team_year_round = a future one), or None
    if it hasn't been used."""
    if not _DRAFT:
        ref = load(D('reference.json'), {}) or {}
        _DRAFT.update(classes=ref.get('draft_classes') or {}, slots=load(D('reference', 'draft-slots.json'), {}) or {},
                      links=(load(D('player-links.json'), {}) or {}).get('links', {}), pinfo=player_info(D('mfl', 'players.json')))
    classes, slots, links, pinfo = _DRAFT['classes'], _DRAFT['slots'], _DRAFT['links'], _DRAFT['pinfo']
    m = re.fullmatch(r'DP_(\d+)_(\d+)', code)
    if m:
        y, rnd, pk = int(season), int(m.group(1)) + 1, int(m.group(2)) + 1
    else:
        m = re.fullmatch(r'FP_(\d+)_(\d+)_(\d+)', code)
        if not m:
            return None
        y, rnd = int(m.group(2)), int(m.group(3))
        pk = (slots.get(str(y)) or {}).get(m.group(1))
        if not pk:
            return None
    row = next((r for r in classes.get(str(y)) or [] if int(r['round']) == rnd and int(r['pick']) == pk), None)
    if not row:
        return None
    l = links.get(row['player_id']) or []
    if not ((len(l) > 2 and l[2]) or row.get('player_name')):
        return None   # no record of who it was
    nm = (l[2] if len(l) > 2 and l[2] else '') or display(row.get('player_name'))
    pos = row.get('player_pos') or (pinfo.get(row['player_id']) or {}).get('position', '')
    return {'id': row['player_id'], 'name': nm, 'pos': 'DEF' if pos == 'Def' else pos, 'year': y,
            'slot': f"{rnd}.{pk:02d}", 'by': row.get('franchise')}


class Followups:
    """How a trade played out for one side: each traded pick that has been used becomes the player taken with it, and
    the side's received players (and pick-turned players) get their starter points for that team from the trade
    season on, this season so far included. A stint ends when the team lets him go; a later return doesn't count.
    Used by the Awards page (Trade of the Year) and the Trading Floor (scripts/trading_floor.py)."""

    def __init__(self):
        ref = load(D('reference.json'), {}) or {}
        self.po = ref.get('playoff_weeks_by_year') or {}
        self.brackets = ref.get('playoff_brackets') or {}
        self.pweekly = {}
        meta = load(D('mfl', '_meta.json'), {}) or {}
        self.cur_year = int(meta.get('season') or 2026)
        self.weekly, self.listed, self.tcache = {}, {}, {}
        sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
        import pick_tenure as PT
        self.PT = PT

    def _wr(self, y):
        wr = load(D('mfl', 'weeklyResults.json') if y == self.cur_year else D('history', str(y), 'weeklyResults.json'), {}) or {}
        if not wr.get('weeks'):
            # 2019-20: MFL no longer serves weekly results; the starters were saved once (data/reference/starters-2019-2020.json)
            S = ((load(D('reference', 'starters-2019-2020.json'), {}) or {}).get('seasons') or {}).get(str(y)) or {}
            wr = {'weeks': {w: {fr: {'s': rows} for fr, rows in frs.items()} for w, frs in S.items()}}
        return wr

    def season_pts(self, y):
        """(player, team) -> {week: starter points} for season y's regular season."""
        if y in self.weekly:
            return self.weekly[y]
        wr = self._wr(y)
        first_po = min(self.po.get(str(y)) or [99])
        out = defaultdict(dict)
        for w, frs in (wr.get('weeks') or {}).items():
            if int(w) >= first_po:
                continue
            for fr, t in frs.items():
                for pid, pts in t.get('s', []):
                    out[(pid, fr)][int(w)] = out[(pid, fr)].get(int(w), 0) + pts
        self.weekly[y] = out
        return out

    def playoff_pts(self, y):
        """(player, team) -> {week: starter points} in that team's real playoff games (round 1, semifinal, final;
        consolation games don't count). Empty until the season's bracket is in the reference data."""
        if y in self.pweekly:
            return self.pweekly[y]
        b = self.brackets.get(str(y)) or {}
        played = set()
        for wk, games in ((b.get('round1_week'), b.get('round1_games')), (b.get('semi_week'), b.get('semifinal_games')),
                          (b.get('championship_week'), [b.get('championship_game')])):
            for g in games or []:
                if wk and g:
                    played |= {(int(wk), g.get('franchiseA')), (int(wk), g.get('franchiseB'))}
        out = defaultdict(dict)
        for w, frs in (self._wr(y).get('weeks') or {}).items():
            for fr, t in frs.items():
                if (int(w), fr) not in played:
                    continue
                for pid, pts in t.get('s', []):
                    out[(pid, fr)][int(w)] = out[(pid, fr)].get(int(w), 0) + pts
        self.pweekly[y] = out
        return out

    def listed_with(self, y):
        """player -> {week: teams he was rostered on (started or benched)} in season y."""
        if y not in self.listed:
            out = defaultdict(lambda: defaultdict(set))
            for w, frs in (self._wr(y).get('weeks') or {}).items():
                for fr, t in frs.items():
                    for lst in ('s', 'n'):
                        for pid, _ in t.get(lst, []):
                            out[pid][int(w)].add(fr)
            self.listed[y] = out
        return self.listed[y]

    def gone(self, fr, pid, ts, y0):
        """(year, first week not counted) when fr first let pid go after time ts, or None if he's still there.
        A later return to the team is a new stint and doesn't count."""
        PT = self.PT
        for y in range(y0, self.cur_year + 1):
            if y not in self.tcache:
                self.tcache[y] = PT.season_data(y, self.cur_year)
            tx, ro = self.tcache[y]
            moves = sorted(int(t['timestamp']) for t in tx if int(t.get('timestamp') or 0) > ts and PT.gave_up(t, fr, pid))
            first = PT.week_of(ts, y) if y == y0 and ts else 1
            # on another team's roster (e.g. let go on keeper day and bought back at the auction by someone else)
            elsewhere = sorted(w for w, frs in self.listed_with(y).get(pid, {}).items() if w >= first and fr not in frs)
            ends = ([PT.week_of(moves[0], y)] if moves else []) + elsewhere[:1]
            if ends:
                return y, min(ends)
            if y > y0 and ro and not any(f.get('id') == fr and any(str(pl.get('id')) == pid for pl in (f.get('player') or [])) for f in ro):
                return y, 1   # not kept at the keeper deadline
        return None

    def side(self, fr, players, picks, season, ts, playoffs=False):
        """players: [{id, name, pos}] received; picks: traded pick codes received. Returns (became, later).
        With playoffs, each row also gets 'po' (starter points in that team's playoff games) and later 'poTotal'."""
        cur_year = self.cur_year
        became = {k: drafted(k, season) for k in picks or []}
        became = {k: v for k, v in became.items() if v}
        assets = [(p['id'], p['name'], p['pos'], None, int(season)) for p in players or []]
        assets += [(v['id'], v['name'], v['pos'], k, v['year']) for k, v in became.items()]
        years = list(range(int(season), cur_year + 1))
        years = sorted(set(years) | {v['year'] for v in became.values() if v['year'] <= cur_year})
        rows = []
        for pid, nm, pos, via, start in assets:
            end = self.gone(fr, pid, int(ts or 0), start)
            pts = {}
            for y in years:
                if y < start or (end and (y > end[0] or (y == end[0] and end[1] == 1))):
                    continue
                wk = self.season_pts(y).get((pid, fr), {})
                pts[str(y)] = round(sum(v for w, v in wk.items() if not (end and y == end[0] and w >= end[1])), 1)
            row = {'id': pid, 'name': nm, 'pos': pos, 'via': via, 'pts': pts}
            if playoffs:
                po = {}
                for y in years:
                    if str(y) not in pts:
                        continue
                    v = round(sum(v for w, v in self.playoff_pts(y).get((pid, fr), {}).items() if not (end and y == end[0] and w >= end[1])), 1)
                    if v:
                        po[str(y)] = v
                row['po'] = po
            rows.append(row)
        later = {'years': [str(y) for y in years], 'current': str(cur_year), 'rows': rows,
                 'total': round(sum(v for r in rows for v in r['pts'].values()), 1)} if years else None
        if later and playoffs:
            later['poTotal'] = round(sum(v for r in rows for v in r['po'].values()), 1)
        return became, later


def add_trade_followups(seasons):
    """Trade of the Year (and runners-up): a deeper look that doesn't change the award (see Followups)."""
    F = Followups()
    for season, a in seasons:
        for aw in a.get('awards') or []:
            if aw.get('key') != 'trade':
                continue
            for t in [aw['trade']] + (aw.get('more') or []):
                for s in (t['winner'], t['loser']):
                    became, later = F.side(s['team'], s.get('players'), s.get('picks'), season, t.get('ts'))
                    s['became'] = became
                    if later:
                        s['later'] = later


def add_record_paces(cur):
    """Best single season ever at each position (2019 on, finished seasons; scripts/all_time_team.py), and for this
    season's All-FBP players a projected regular-season total: points so far plus points per start for the weeks
    left (one fewer if he has started every week, since his bye is still ahead). Flags anyone on pace to beat the record."""
    try:
        sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
        from all_time_team import seasons
        ref = load(D('reference.json'), {}) or {}
        rows = seasons(ref) if ref else []
    except Exception as e:
        print(f'  record paces skipped: {e}')
        return
    links = (load(D('player-links.json'), {}) or {}).get('links', {})
    rec = {}
    for r in rows:
        if r['pos'] and r['pts'] > rec.get(r['pos'], {}).get('pts', -1):
            l = links.get(r['id']) or []
            nm = (l[2] if len(l) > 2 and l[2] else '') or display(r['name']) if r['pos'] != 'DEF' else ' '.join(reversed(r['name'].split(', ')))
            rec[r['pos']] = {'name': nm, 'year': r['year'], 'team': r['team'], 'pts': r['pts'], 'starts': r['starts']}
    cur['records'] = rec
    if not cur.get('ready') or cur.get('final'):
        return
    now = load(D('league-now.json'), {}) or {}
    reg = int(now.get('lastRegularSeasonWeek') or 14)
    wk = int(cur.get('throughWeek') or now.get('weeksPlayed') or 0)
    for team in [(cur.get('allFbp') or {}).get(k) or [] for k in ('first', 'second')]:
        for e in team:
            p = e['player']; r = rec.get(p.get('pos'))
            if not r or not p.get('starts'):
                continue
            left = max(0, reg - wk - (1 if p['starts'] >= wk else 0))
            proj = round(p['pts'] + p['ppg'] * left, 1)
            p['pace'] = {'proj': proj, 'record': proj > r['pts']}


def main():
    links = (load(D('player-links.json'), {}) or {}).get('links', {})
    prev = load(D('awards.json'), {}) or {}
    cur = current(links)
    mark_changes(cur, prev)
    # past seasons, built from saved history; listed so the page can offer a season picker
    ref = load(D('reference', 'history.json'), {}) or {}
    fallback = player_info(D('mfl', 'players.json'))
    built = []
    if os.path.isdir(D('history')):
        for y in sorted(y for y in os.listdir(D('history')) if re.fullmatch(r'\d{4}', y)):
            a = past(y, links, ref, fallback) or partial_season(y, links, ref, fallback)
            if a and a.get('ready') and y != cur.get('season'):
                built.append((y, a))
    add_honors(built + [(cur.get('season', '9999'), cur)])
    os.makedirs(D('awards'), exist_ok=True)

    json.dump(franchise_all_fbp(built), open(D('awards', 'all-fbp.json'), 'w'), indent=1, ensure_ascii=False)
    add_record_paces(cur)
    add_trade_followups(built + [(cur.get('season', '9999'), cur)])
    years = [y for y, _ in sorted(built, reverse=True)]
    cur['pastSeasons'] = years
    for y, a in built:
        json.dump(a, open(D('awards', f'{y}.json'), 'w'), indent=1, ensure_ascii=False)
    cur['honorsFrom'] = built[0][0] if built else cur.get('season')
    json.dump(cur, open(D('awards.json'), 'w'), indent=1, ensure_ascii=False)
    print(f"awards.json: {'through week ' + str(cur.get('throughWeek')) if cur.get('ready') else 'no weekly results yet'}, "
          f"{len(cur.get('awards', []))} awards; past seasons: {' '.join(years) or 'none'}")


if __name__ == '__main__':
    main()
