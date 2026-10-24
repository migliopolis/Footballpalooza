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


def build(folder):
    league = load(folder, 'league')['league']
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
                  'allPlayW': apw, 'allPlayL': apl, 'allPlayT': apt, 'streak': s.get('strk', '')})

    # head-to-head results from scored regular-season games
    games, weeks_played = [], 0
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

    # division winners
    div_ladder = [('record', lambda t: pct(t), True), ('head-to-head', h2h_pct, True),
                  ('total points', lambda t: pf(t), True), ('all-play wins', lambda t: apw(t), True)]
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

    # projected rookie draft order
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

    seed_of = {s['id']: s['seed'] for s in seeds}
    table = []
    for t in teams.values():
        table.append(dict(t, divisionName=div_name.get(t['division'], ''), divisionRank=div_rank.get(t['id']),
                          seed=seed_of.get(t['id'])))
    table.sort(key=lambda r: (-r['pct'], -r['pf']))

    return {
        'season': league.get('name', ''),
        'generated': datetime.now(timezone.utc).isoformat(timespec='seconds'),
        'weeksPlayed': weeks_played,
        'lastRegularSeasonWeek': last_reg,
        'divisions': divisions,
        'standings': table,
        'seeds': seeds,
        'draftOrder': draft,
        'notes': ['Tiebreaks follow the 2027 by-laws draft and are computed here, not by MFL.',
                  'Picks 7-12 are projected by seed until the playoffs are played.'],
    }


def main():
    folder = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, 'data', 'mfl')
    out = sys.argv[2] if len(sys.argv) > 2 else os.path.join(ROOT, 'data', 'league-now.json')
    data = build(folder)
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
