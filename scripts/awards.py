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
import json, math, os, re
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


def build(season, weeks, pinfo, links, owner, salary, contract, tx, standings, slots, flex_ok, rostered_only):
    """Every award for one season. weeks: {week: {franchise: {'s': [[id, pts]], 'n': [...]}}}, regular season only."""
    out = {'season': season}
    tot, starts, by_team, games = defaultdict(float), defaultdict(int), defaultdict(float), []
    wk_nums = sorted(int(w) for w in weeks)
    for w in wk_nums:
        for fr, t in weeks[str(w)].items():
            for pid, pts in t.get('s', []):
                tot[pid] += pts; starts[pid] += 1; by_team[(pid, fr)] += pts
                games.append((pts, w, pid, fr))
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
    trades = []
    for t in tx:
        if t.get('type') != 'TRADE':
            continue
        a, b = t.get('franchise'), t.get('franchise2')
        gave_a = [x for x in (t.get('franchise1_gave_up') or '').split(',') if x.strip()]
        gave_b = [x for x in (t.get('franchise2_gave_up') or '').split(',') if x.strip()]
        if not (gave_a or gave_b) or not (a and b):
            continue
        side = lambda fr, got: {'team': fr, 'players': [player(x, by_team[(x, fr)], fr) for x in got if x.isdigit()],
                                'picks': [x for x in got if not x.isdigit()], 'pts': round(sum(by_team[(x, fr)] for x in got if x.isdigit()), 1)}
        sa, sb = side(a, gave_b), side(b, gave_a)
        if sa['pts'] < sb['pts']:
            sa, sb = sb, sa
        trades.append({'winner': sa, 'loser': sb, 'margin': round(sa['pts'] - sb['pts'], 1), 'ts': int(t.get('timestamp') or 0)})
    trades.sort(key=lambda x: -x['margin'])
    if trades and trades[0]['margin'] > 0:
        A.append({'key': 'trade', 'title': 'Trade of the Year', 'why': 'Biggest edge in starter points from what each side received', 'trade': trades[0],
                  'more': [t for t in trades[1:3] if t['margin'] > 0]})

    # team awards from the standings
    eff = sorted((s for s in standings if s.get('pp')), key=lambda s: -s['pf'] / s['pp'])
    if eff:
        A.append({'key': 'manager', 'title': 'Manager of the Year', 'why': 'Best lineup calls: actual points over the most the roster could have scored',
                  'teams': [{'team': s['id'], 'stat': f"{100 * s['pf'] / s['pp']:.1f}%", 'sub': f"{s['pf']:.1f} of {s['pp']:.1f} possible"} for s in eff[:3]]})

    def ap(s):
        g = s['allPlayW'] + s['allPlayL'] + s['allPlayT']
        return (s['allPlayW'] + s['allPlayT'] / 2) / g if g else 0
    luck = sorted(standings, key=lambda s: -(s['pct'] - ap(s)))
    if luck:
        lk = lambda s: {'team': s['id'], 'stat': f"{'+' if s['pct'] - ap(s) >= 0 else ''}{(s['pct'] - ap(s)) * 100:.0f}% win", 'sub': f"{s['w']}-{s['l']}{'-' + str(s['t']) if s['t'] else ''} record, {s['allPlayW']}-{s['allPlayL']} all-play"}
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
    out = build(season, weeks, pinfo, links, owner, salary, contract, tx, st, slots, flex_ok, rostered_only=True)
    out['generated'] = stamp
    return out


def standings_from_reference(rows):
    out = []
    for r in rows or []:
        try:
            w, l, t = (int(x) for x in r['h2hwlt'].split('-'))
            aw, al, at = (int(x) for x in r['all_play_wlt'].split('-'))
            g = w + l + t
            out.append({'id': r['franchise'], 'w': w, 'l': l, 't': t, 'pct': (w + t / 2) / g if g else 0,
                        'pf': float(r['pf']), 'pp': float(r.get('pp') or 0), 'allPlayW': aw, 'allPlayL': al, 'allPlayT': at})
        except Exception:
            continue
    return out


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
    out = build(year, weeks, pinfo, links, owner, salary, contract, tx, st, slots, flex_ok, rostered_only=False)
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
    tally, mvps = defaultdict(lambda: [0, 0]), defaultdict(list)
    for y, a in sorted(seasons, key=lambda x: x[0]):
        if not a.get('ready'):
            continue
        for i, team in enumerate((a['allFbp']['first'], a['allFbp']['second'])):
            for e in team:
                tally[e['player']['id']][i] += 1
        mvp = next((x for x in a['awards'] if x['key'] == 'mvp'), None)
        if mvp and a.get('final') and mvp['list']:
            mvps[mvp['list'][0]['id']].append(y)
            mvp['list'][0]['mvp'] = True          # this season's MVP
        for p in players_in(a):
            if p['id'] in mvps:
                p['mvps'] = list(mvps[p['id']])
        for team in (a['allFbp']['first'], a['allFbp']['second']):
            for e in team:
                f, s2 = tally[e['player']['id']]
                e['player']['honors'] = {'first': f, 'second': s2}
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
        for tier, team in ((1, a['allFbp']['first']), (2, a['allFbp']['second'])):
            for e in team:
                p = e['player']
                r = by[p['team']].setdefault(p['id'], {k: p[k] for k in ('id', 'name', 'pos', 'nfl', 'espn')} | {'years': []})
                r['name'], r['nfl'] = p['name'], p['nfl'] or r['nfl']   # latest spelling and team
                r['years'].append({'year': y, 'tier': tier, 'pts': p.get('teamPts', p['pts']), 'starts': p.get('teamStarts', p['starts']), 'champ': p.get('champTeam') == p['team'], 'mvp': bool(p.get('mvp'))})   # title with this franchise; MVP that season
    out = {}
    for fr, players in by.items():
        rows = []
        for r in players.values():
            ys = r['years']
            r['first'] = sum(1 for x in ys if x['tier'] == 1)
            r['second'] = sum(1 for x in ys if x['tier'] == 2)
            r['champs'] = sum(1 for x in ys if x['champ'])
            r['mvps'] = sum(1 for x in ys if x['mvp'])
            r['pts'] = round(sum(x['pts'] for x in ys), 1)
            r['starts'] = sum(x['starts'] for x in ys)
            r['ppg'] = round(r['pts'] / r['starts'], 1) if r['starts'] else 0
            rows.append(r)
        rows.sort(key=lambda r: (-r['first'], -r['mvps'], -r['second'], -r['pts']))
        out[fr] = rows
    return {'seasons': [y for y, _ in sorted(seasons)], 'franchises': out}


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
            a = past(y, links, ref, fallback)
            if a and a.get('ready') and y != cur.get('season'):
                built.append((y, a))
    add_honors(built + [(cur.get('season', '9999'), cur)])
    os.makedirs(D('awards'), exist_ok=True)
    for y, a in built:
        json.dump(a, open(D('awards', f'{y}.json'), 'w'), indent=1, ensure_ascii=False)
    json.dump(franchise_all_fbp(built), open(D('awards', 'all-fbp.json'), 'w'), indent=1, ensure_ascii=False)
    years = [y for y, _ in sorted(built, reverse=True)]
    cur['pastSeasons'] = years
    cur['honorsFrom'] = built[0][0] if built else cur.get('season')
    json.dump(cur, open(D('awards.json'), 'w'), indent=1, ensure_ascii=False)
    print(f"awards.json: {'through week ' + str(cur.get('throughWeek')) if cur.get('ready') else 'no weekly results yet'}, "
          f"{len(cur.get('awards', []))} awards; past seasons: {' '.join(years) or 'none'}")


if __name__ == '__main__':
    main()
