#!/usr/bin/env python3
"""Compute standings, the playoff picture and the projected rookie draft order.

Reads data/mfl/{league,leagueStandings,schedule}.json (or another folder given
as the first argument) and writes data/league-now.json.

Rules implemented (FBP 2027 by-laws draft):
- 6 playoff teams. The three division winners are seeds 1-3, the next two best
  records are seeds 4-5, and seed 6 is the remaining team with the most
  all-play wins.
- Division title: head-to-head among the tied teams (restart with the
  survivors if one team drops out) -> total points -> all-play wins -> coin flip.
- Seeding division winners and wild cards 4-5: record -> total points ->
  all-play wins -> coin flip.
- Seed 6: all-play wins -> total points -> record -> coin flip.
- Rookie picks 1-6 (non-playoff teams): lowest potential points -> lowest
  total points -> lowest all-play wins -> coin flip.
- Picks 7-12 during the regular season are projected by seed, assuming higher
  seeds win: seeds 6, 5 (round-1 losers, worse seed first), 4 (4th place),
  3 (3rd place), 2 (runner-up), 1 (champion).
Ties that reach a coin flip are flagged and ordered by franchise id.
MFL's own standings sort is win % then points, so these tiebreaks are ours.
"""
import json, os, sys
from datetime import datetime, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def load(folder, name):
    with open(os.path.join(folder, name + '.json')) as f:
        return json.load(f)


def as_list(x):
    return x if isinstance(x, list) else ([x] if x else [])


def pick_best(group, ladder, restart_on=()):
    """Return (winner, rule that decided it). ladder: [(name, fn, higher_is_better)]."""
    group = sorted(group)
    while True:
        if len(group) == 1:
            return group[0], None
        restarted = False
        cur = list(group)
        for step, (name, fn, high) in enumerate(ladder):
            vals = {t: (fn(t, set(cur)) if name in restart_on else fn(t)) for t in cur}
            best = max(vals.values()) if high else min(vals.values())
            top = [t for t in cur if vals[t] == best]
            if len(top) == 1:
                # the first rule is the normal sort, not a tiebreak
                return top[0], (name if step > 0 else None)
            if name in restart_on and len(top) < len(cur):
                group, restarted = top, True
                break
            cur = top
        if not restarted:
            return sorted(cur)[0], 'coin flip'

def order(group, ladder):
    out, rest = [], list(group)
    while rest:
        t, rule = pick_best(rest, ladder)
        out.append((t, rule))
        rest.remove(t)
    return out


# Division tiebreak: 2026 breaks a tied division record on total points; the 2027 by-laws put
# head-to-head first. build() sets this from the season year in MFL's league name.
DIV_HEAD_TO_HEAD = True


def seed_league(teams, games, divisions):
    """Seeds 1-6 under the 2027 rules. teams: id -> {pct, pf, allPlayW, division}; games: (week, a, sa, b, sb).
    Returns (seeds, winners {division: (id, rule)}, division rank {id: n})."""
    def h2h_pct(tid, group):
        w = l = tie = 0
        for _, a, sa, b, sb in games:
            if {a, b} <= group and tid in (a, b):
                mine, theirs = (sa, sb) if a == tid else (sb, sa)
                w += mine > theirs; l += mine < theirs; tie += mine == theirs
        n = w + l + tie
        return (w + 0.5 * tie) / n if n else 0.5

    pct = lambda t: teams[t]['pct']
    pf = lambda t: teams[t]['pf']
    apw = lambda t: teams[t]['allPlayW']

    # division winners
    if DIV_HEAD_TO_HEAD:
        div_ladder = [('record', lambda t: pct(t), True), ('head-to-head', h2h_pct, True),
                      ('total points', lambda t: pf(t), True), ('all-play wins', lambda t: apw(t), True)]
    else:   # 2026 rules
        div_ladder = [('record', lambda t: pct(t), True), ('total points', lambda t: pf(t), True),
                      ('all-play wins', lambda t: apw(t), True)]
    winners, div_rank = {}, {}
    for d in divisions:
        members = [t for t in teams if teams[t]['division'] == d['id']]
        # record first, then the by-law ladder among teams tied on record
        ranked = []
        rest = list(members)
        while rest:
            t, rule = pick_best(rest, div_ladder, restart_on=('head-to-head',))
            ranked.append((t, rule))
            rest.remove(t)
        for i, (t, rule) in enumerate(ranked, 1):
            div_rank[t] = i
        winners[d['id']] = ranked[0]

    seed_ladder = [('record', lambda t: pct(t), True), ('total points', lambda t: pf(t), True),
                   ('all-play wins', lambda t: apw(t), True)]
    seeds = []
    for t, rule in order([w for w, _ in winners.values()], seed_ladder):
        seeds.append({'id': t, 'via': 'division', 'tiebreak': rule,
                      'divisionTiebreak': winners[teams[t]['division']][1]})
    rest = [t for t in teams if t not in {s['id'] for s in seeds}]
    for t, rule in order(rest, seed_ladder)[:2]:
        seeds.append({'id': t, 'via': 'wild card', 'tiebreak': rule})
    rest = [t for t in rest if t not in {s['id'] for s in seeds}]
    six_ladder = [('all-play wins', lambda t: apw(t), True), ('total points', lambda t: pf(t), True),
                  ('record', lambda t: pct(t), True)]
    t, rule = pick_best(rest, six_ladder)
    seeds.append({'id': t, 'via': 'all-play wins', 'tiebreak': rule})
    for i, s in enumerate(seeds, 1):
        s['seed'] = i

    return seeds, winners, div_rank


def simulate(teams, games, remaining, divisions, n_sims=20000, seed=2027, spread_scale=2.0):
    """Play out the rest of the regular season n_sims times and tally where everyone finishes.

    Scoring model: each team's weekly score is normal around its true average with the league's
    week-to-week spread. A team's true average is uncertain, so it is drawn fresh each run from an
    estimate that pulls its season average toward the league average (more pull early in the year).
    spread_scale widens the estimated spread of true team strength; 2.0 scored best in a backtest of
    2021-2025 (from weeks 4-12, judged under the 2027 playoff rules), where 1.0 made favorites too timid.
    remaining: [(week, a, b)] unplayed regular-season games.
    """
    import random, statistics
    rng = random.Random(seed)
    ids = sorted(teams)
    played = {t: [] for t in ids}
    for _, a, sa, b, sb in games:
        played[a].append(sa); played[b].append(sb)
    allv = [v for t in ids for v in played[t]]
    if len(allv) >= 2 * len(ids):
        lg = statistics.mean(allv)
        within = statistics.mean([statistics.variance(played[t]) for t in ids if len(played[t]) > 1])
        n_avg = statistics.mean(len(played[t]) for t in ids)
        between = statistics.variance([statistics.mean(played[t]) for t in ids]) - within / n_avg
        true_var = max(between, within / 30) * spread_scale
    else:  # too early: everyone looks the same
        lg, within, true_var = (statistics.mean(allv) if allv else 110.0), 600.0, 100.0
    post = {}
    for t in ids:
        prec = len(played[t]) / within + 1 / true_var
        post[t] = ((sum(played[t]) / within + lg / true_var) / prec, (1 / prec) ** 0.5)
    sd_week = within ** 0.5

    weeks = sorted({w for w, _, _ in remaining})
    seed_ct = {t: [0] * 7 for t in ids}          # seeds 1-6, then missed
    div_ct = {t: 0 for t in ids}
    wins_sum = {t: 0.0 for t in ids}
    metrics = ('playoff', 'bye', 'seed1')
    # per remaining game: how often the first-listed team won, and each team's results split by that outcome
    g_awin = [0] * len(remaining)
    g_hits = [[{t: [0, 0, 0] for t in ids}, {t: [0, 0, 0] for t in ids}] for _ in remaining]
    g_n = [[0, 0] for _ in remaining]
    by_week = {w: [(i, a, b) for i, (wk, a, b) in enumerate(remaining) if wk == w] for w in weeks}

    for _ in range(n_sims):
        mu = {t: rng.gauss(*post[t]) for t in ids}
        T = {t: {'w': teams[t]['w'], 'l': teams[t]['l'], 't': teams[t]['t'], 'pf': teams[t]['pf'],
                 'allPlayW': teams[t]['allPlayW'], 'division': teams[t]['division']} for t in ids}
        G = list(games)
        outcome = [0] * len(remaining)
        for w in weeks:
            sc = {t: round(rng.gauss(mu[t], sd_week), 2) for t in ids}
            ordered = sorted(sc.values())
            for t in ids:  # all-play: beat every team that scored less this week
                T[t]['allPlayW'] += sum(1 for v in ordered if v < sc[t])
            for i, a, b in by_week[w]:
                sa, sb = sc[a], sc[b]
                G.append((w, a, sa, b, sb))
                T[a]['pf'] += sa; T[b]['pf'] += sb
                if sa > sb: T[a]['w'] += 1; T[b]['l'] += 1; outcome[i] = 0
                elif sb > sa: T[b]['w'] += 1; T[a]['l'] += 1; outcome[i] = 1
                else: T[a]['t'] += 1; T[b]['t'] += 1; outcome[i] = 0
        for t in ids:
            g = T[t]['w'] + T[t]['l'] + T[t]['t']
            T[t]['pct'] = (T[t]['w'] + 0.5 * T[t]['t']) / g if g else 0.0
            wins_sum[t] += T[t]['w']
        seeds, winners, _ = seed_league(T, G, divisions)
        seed_of = {s['id']: s['seed'] for s in seeds}
        for d, (wid, _) in winners.items():
            div_ct[wid] += 1
        res = {}
        for t in ids:
            sd = seed_of.get(t)
            seed_ct[t][(sd or 7) - 1] += 1
            res[t] = (1 if sd else 0, 1 if sd and sd <= 2 else 0, 1 if sd == 1 else 0)
        for i, o in enumerate(outcome):
            g_n[i][o] += 1
            if o == 0: g_awin[i] += 1
            hits = g_hits[i][o]
            for t in ids:
                h, r = hits[t], res[t]
                h[0] += r[0]; h[1] += r[1]; h[2] += r[2]

    pc = lambda x: round(100.0 * x / n_sims, 1)
    opp_strength = {}
    for t in ids:
        opps = [b if a == t else a for _, a, b in remaining if t in (a, b)]
        opp_strength[t] = statistics.mean(post[o][0] for o in opps) if opps else None
    ranked = sorted([t for t in ids if opp_strength[t] is not None], key=lambda t: -opp_strength[t])
    out = {}
    for t in ids:
        cond = lambda i, o, m: (g_hits[i][o][t][m] / g_n[i][o]) if g_n[i][o] else None
        own, watch = [], {m: [] for m in metrics}
        for i, (w, a, b) in enumerate(remaining):
            if not (g_n[i][0] and g_n[i][1]):
                continue
            if t in (a, b):
                me, them = (0, 1) if t == a else (1, 0)
                pwin = g_awin[i] / n_sims if t == a else 1 - g_awin[i] / n_sims
                own.append({'week': w, 'opp': b if t == a else a, 'winProb': round(100 * pwin),
                            'ifWin': [round(100 * cond(i, me, m), 1) for m in range(3)],
                            'ifLoss': [round(100 * cond(i, them, m), 1) for m in range(3)]})
            else:
                for m, key in enumerate(metrics):
                    diff = cond(i, 0, m) - cond(i, 1, m)
                    watch[key].append({'week': w, 'rootFor': a if diff > 0 else b, 'against': b if diff > 0 else a,
                                       'swing': round(100 * abs(diff), 1)})
        for key in metrics:
            watch[key] = sorted([x for x in sorted(watch[key], key=lambda x: -x['swing']) if x['swing'] >= 2.5][:3],
                                key=lambda x: x['week'])
        out[t] = {
            'playoff': pc(sum(seed_ct[t][:6])), 'bye': pc(sum(seed_ct[t][:2])), 'seed1': pc(seed_ct[t][0]),
            'division': pc(div_ct[t]), 'seeds': [pc(c) for c in seed_ct[t]],
            'projW': round(wins_sum[t] / n_sims, 1),
            'sosRank': ranked.index(t) + 1 if t in ranked else None,
            'ownGames': sorted(own, key=lambda x: x['week']),
            'watch': watch,
        }
    model = {'metrics': list(metrics), 'sims': n_sims, 'leagueAvg': round(lg, 1), 'weeklySpread': round(sd_week, 1),
             'note': 'Each run plays out the remaining regular season with scores drawn around each team\'s '
                     'estimated true average (season average pulled toward the league average) and applies the '
                     'same seeding and tiebreak rules as the standings.'}
    return {'model': model, 'teams': out}


def build(folder):
    global DIV_HEAD_TO_HEAD
    league = load(folder, 'league')['league']
    yr_txt = ''.join(ch for ch in league.get('name', '') if ch.isdigit())[-4:]
    DIV_HEAD_TO_HEAD = not (yr_txt and int(yr_txt) < 2027)
    stand = load(folder, 'leagueStandings')['leagueStandings']
    sched = load(folder, 'schedule')['schedule']
    last_reg = int(league.get('lastRegularSeasonWeek', 14))
    divisions = [{'id': d['id'], 'name': d['name']} for d in as_list(league['divisions']['division'])]
    div_name = {d['id']: d['name'] for d in divisions}

    teams = {}
    for f in as_list(league['franchises']['franchise']):
        teams[f['id']] = {'id': f['id'], 'name': f['name'].strip(), 'division': f.get('division', '')}
    for s in as_list(stand['franchise']):
        t = teams[s['id']]
        w, l, tie = int(s.get('h2hw', 0)), int(s.get('h2hl', 0)), int(s.get('h2ht', 0))
        apw, apl, apt = (int(x) for x in s.get('all_play_wlt', '0-0-0').split('-'))
        gp = w + l + tie
        t.update({'w': w, 'l': l, 't': tie, 'pct': round((w + 0.5 * tie) / gp, 3) if gp else 0.0,
                  'pf': float(s.get('pf', 0)), 'pa': float(s.get('pa', 0)), 'pp': float(s.get('pp', 0)),
                  'allPlayW': apw, 'allPlayL': apl, 'allPlayT': apt, 'streak': s.get('strk', ''),
                  'pwr': float(s.get('pwr') or 0)})   # MFL's power rating (Power Rankings tab, for now)

    # head-to-head results from scored regular-season games
    games, remaining, weeks_played = [], [], 0
    for wk in as_list(sched.get('weeklySchedule')):
        week = int(wk['week'])
        if week > last_reg:
            continue
        for m in as_list(wk.get('matchup')):
            fs = as_list(m.get('franchise'))
            if len(fs) == 2 and all(f.get('score') not in (None, '') for f in fs):
                a, b = fs
                games.append((week, a['id'], float(a['score']), b['id'], float(b['score'])))
                weeks_played = max(weeks_played, week)
            elif len(fs) == 2:
                remaining.append((week, fs[0]['id'], fs[1]['id']))

    seeds, winners, div_rank = seed_league(teams, games, divisions)

    # home weeks per team, so schedules can say "vs" (home) or "@" (away)
    home_weeks = {t: [] for t in teams}
    for wk in as_list(sched.get('weeklySchedule')):
        if int(wk['week']) > last_reg:
            continue
        for m in as_list(wk.get('matchup')):
            for f in as_list(m.get('franchise')):
                if f.get('isHome') == '1' and f.get('id') in home_weeks:
                    home_weeks[f['id']].append(int(wk['week']))

    # projected rookie draft order
    pf = lambda t: teams[t]['pf']
    apw = lambda t: teams[t]['allPlayW']
    in_po = {s['id'] for s in seeds}
    lottery_ladder = [('potential points', lambda t: teams[t]['pp'], False),
                      ('total points', lambda t: pf(t), False),
                      ('all-play wins', lambda t: apw(t), False)]
    draft = []
    for t, rule in order([t for t in teams if t not in in_po], lottery_ladder):
        draft.append({'id': t, 'basis': 'lowest potential points', 'tiebreak': rule})
    labels = {6: 'round-1 loser (worse seed)', 5: 'round-1 loser', 4: '4th place', 3: '3rd place',
              2: 'runner-up', 1: 'champion'}
    for sd in (6, 5, 4, 3, 2, 1):
        draft.append({'id': seeds[sd - 1]['id'], 'basis': f'seed {sd}, projected {labels[sd]}', 'tiebreak': None})
    for i, d in enumerate(draft, 1):
        d['pick'] = i

    # division record and games back of the division leader
    div_rec = {t: [0, 0, 0] for t in teams}
    for _, a, sa, b, sb in games:
        if teams[a]['division'] and teams[a]['division'] == teams[b]['division']:
            for me, mine, theirs in ((a, sa, sb), (b, sb, sa)):
                div_rec[me][0 if mine > theirs else 1 if mine < theirs else 2] += 1
    leader = {d['id']: teams[winners[d['id']][0]] for d in divisions}
    for t in teams.values():
        L = leader[t['division']]
        t['divRecord'] = '-'.join(str(x) for x in div_rec[t['id']])
        t['gb'] = ((L['w'] - t['w']) + (t['l'] - L['l'])) / 2
        gp = t['w'] + t['l'] + t['t']
        t['avgPf'] = round(t['pf'] / gp, 1) if gp else 0.0

    # current owners of next year's picks (trades), from MFL futureDraftPicks
    draft_year = None
    yr = ''.join(ch for ch in league.get('name', '') if ch.isdigit())[-4:]
    if yr:
        draft_year = str(int(yr) + 1)
    owners = {}
    fdp_path = os.path.join(folder, 'futureDraftPicks.json')
    if draft_year and os.path.exists(fdp_path):
        fdp = load(folder, 'futureDraftPicks').get('futureDraftPicks', {})
        for f in as_list(fdp.get('franchise')):
            for p in as_list(f.get('futureDraftPick')):
                if p.get('year') == draft_year:
                    owners[(int(p['round']), p['originalPickFor'])] = f['id']
    for d in draft:
        d['owner'] = owners.get((1, d['id']), d['id'])
    rounds = {str(r): [{'pick': d['pick'], 'id': d['id'], 'owner': owners.get((r, d['id']), d['id'])} for d in draft]
              for r in (1, 2, 3, 4)}

    # strength of remaining schedule: average win% of the opponents still to play (regular season)
    left = [g for g in remaining if g[0] > weeks_played]
    for t in teams.values():
        opps = [b if a == t['id'] else a for _, a, b in left if t['id'] in (a, b)]
        t['gamesLeft'] = len(opps)
        t['sos'] = round(sum(teams[o]['pct'] for o in opps) / len(opps), 3) if opps else None

    seed_of = {s['id']: s['seed'] for s in seeds}
    table = []
    for t in teams.values():
        table.append(dict(t, divisionName=div_name.get(t['division'], ''), divisionRank=div_rank.get(t['id']),
                          seed=seed_of.get(t['id'])))
    table.sort(key=lambda r: (-r['pct'], -r['pf']))
    for i, r in enumerate(sorted(table, key=lambda r: -r['pwr']), 1):
        r['pwrRank'] = i

    return {
        'season': league.get('name', ''),
        'generated': datetime.now(timezone.utc).isoformat(timespec='seconds'),
        'weeksPlayed': weeks_played,
        'lastRegularSeasonWeek': last_reg,
        'divisions': divisions,
        'standings': table,
        'seeds': seeds,
        'draftYear': draft_year,
        'draftOrder': draft,
        'draftRounds': rounds,
        'pickOwnersKnown': bool(owners),
        'odds': simulate(teams, games, [g for g in remaining if g[0] > weeks_played], divisions) if remaining else None,
        # every regular-season game: played [week, a, scoreA, b, scoreB] and still to play [week, a, b]
        'games': [list(g) for g in games],
        'upcoming': [list(g) for g in remaining if g[0] > weeks_played],
        'homeWeeks': home_weeks,
        'notes': ['Division ties: 2026 uses total points; from 2027, head-to-head comes first.' if not DIV_HEAD_TO_HEAD
                  else 'Tiebreaks follow the 2027 by-laws and are computed here, not by MFL.',
                  'Picks 7-12 are projected by seed until the playoffs are played.'],
    }


def snapshot(data):
    """What each team looked like this week: playoff odds, seed, standings place and power rank."""
    odds = (data.get('odds') or {}).get('teams') or {}
    seed = {x['id']: x['seed'] for x in data['seeds']}
    out = {}
    for i, t in enumerate(data['standings'], 1):
        o = odds.get(t['id']) or {}
        out[t['id']] = {'rank': i, 'seed': seed.get(t['id']), 'pwrRank': t.get('pwrRank'), 'allPlayW': t['allPlayW'],
                        'playoff': o.get('playoff'), 'bye': o.get('bye'), 'division': o.get('division'),
                        'seed1': o.get('seed1'), 'seed6': (o.get('seeds') or [None] * 7)[5]}
    return out


def main():
    folder = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, 'data', 'mfl')
    out = sys.argv[2] if len(sys.argv) > 2 else os.path.join(ROOT, 'data', 'league-now.json')
    data = build(folder)
    # week-by-week draft order, so the Rookie Draft page can show movement since last week
    hist_path = os.path.join(os.path.dirname(out), 'draft-order-history.json')
    hist = json.load(open(hist_path)) if os.path.exists(hist_path) else {'weeks': {}}
    wk = data['weeksPlayed']
    hist['weeks'][str(wk)] = [d['id'] for d in data['draftOrder']]
    prev = [int(w) for w in hist['weeks'] if int(w) < wk]
    data['prevDraftOrder'] = {'week': max(prev), 'order': hist['weeks'][str(max(prev))]} if prev else None
    with open(hist_path, 'w') as f:
        json.dump(hist, f, indent=1)
        f.write('\n')
    # week-by-week snapshot of odds, seeds and power ranks, so pages can show what moved since last week
    snap_path = os.path.join(os.path.dirname(out), 'league-now-history.json')
    snaps = json.load(open(snap_path)) if os.path.exists(snap_path) else {'weeks': {}}
    snaps['weeks'][str(wk)] = snapshot(data)
    earlier = [int(w) for w in snaps['weeks'] if int(w) < wk]
    data['prev'] = {'week': max(earlier), 'teams': snaps['weeks'][str(max(earlier))]} if earlier else None
    with open(snap_path, 'w') as f:
        json.dump(snaps, f, indent=1)
        f.write('\n')
    meta_path = os.path.join(folder, '_meta.json')
    if os.path.exists(meta_path):
        data['fetched'] = json.load(open(meta_path)).get('fetched')
    with open(out, 'w') as f:
        json.dump(data, f, indent=1, ensure_ascii=False)
        f.write('\n')
    print(f"Wrote {out}: through week {data['weeksPlayed']}, seeds " +
          ', '.join(f"{s['seed']}:{s['id']}" for s in data['seeds']))


if __name__ == '__main__':
    main()
