"""Mathematical playoff elimination, one path at a time.

A team can reach the playoffs three ways (2027 by-laws, seeds 1-6):
  division  - win its division (seeds 1-3)
  wildCard  - one of the two best records among the teams that didn't win a division (seeds 4-5)
  allPlay   - most all-play wins among everyone not in seeds 1-5 (seed 6)

A path is closed only when no combination of remaining results can open it. Ties are never
treated as settled, because the tiebreaks fall to total points, which can't be bounded. So every
"eliminated" here is certain; a team can be out of contention a little before this says so.

eliminations(teams, games, schedule, last_week) -> {id: {path: week eliminated or None, 'all': week or None}}
  teams:    {id: division id}
  games:    played regular-season games [(week, a, score_a, b, score_b)]
  schedule: every regular-season game [(week, a, b)], played or not
It replays the season week by week, so each closed path carries the week it closed.
"""
PATHS = ('division', 'wildCard', 'allPlay')


def status_after(week, teams, games, schedule):
    """Which paths are closed for each team using results through `week`."""
    played = [g for g in games if g[0] <= week]
    left = {t: 0 for t in teams}
    left_weeks = sorted({w for w, _, _ in schedule if w > week})
    for w, a, b in schedule:
        if w > week:
            left[a] += 1; left[b] += 1
    # record as wins + half ties (every team plays the same number of games)
    rec = {t: 0.0 for t in teams}
    for _, a, sa, b, sb in played:
        if sa > sb: rec[a] += 1
        elif sb > sa: rec[b] += 1
        else: rec[a] += .5; rec[b] += .5
    # all-play wins: teams outscored each week
    by_week = {}
    for w, a, sa, b, sb in played:
        by_week.setdefault(w, {}).update({a: sa, b: sb})
    apw = {t: 0 for t in teams}
    for sc in by_week.values():
        for t, s in sc.items():
            apw[t] += sum(1 for o, x in sc.items() if o != t and s > x)
    n_other = len(teams) - 1
    best_rec = {t: rec[t] + left[t] for t in teams}                   # wins out
    best_apw = {t: apw[t] + n_other * len(left_weeks) for t in teams}  # top score every week left

    out = {}
    for t, div in teams.items():
        # division: a rival already has a better record than t's best possible
        div_out = any(teams[o] == div and rec[o] > best_rec[t] for o in teams if o != t)
        # wild card: teams sure to finish with a better record than t; at most one per division
        # among them can be a division winner, the rest are wild-card rivals that all finish ahead
        ahead = [o for o in teams if o != t and rec[o] > best_rec[t]]
        wc_out = len(ahead) - len({teams[o] for o in ahead}) >= 2
        out[t] = {'division': div_out, 'wildCard': wc_out}
    for t in teams:
        # seed 6: teams sure to finish with more all-play wins than t's best possible.
        # Six of them means at least one is outside seeds 1-5; so does one that can't reach seeds 1-5.
        ahead = [o for o in teams if o != t and apw[o] > best_apw[t]]
        out[t]['allPlay'] = len(ahead) >= 6 or any(out[o]['division'] and out[o]['wildCard'] for o in ahead)
    return out


def eliminations(teams, games, schedule, last_week):
    res = {t: {p: None for p in PATHS} for t in teams}
    for wk in range(1, last_week + 1):
        st = status_after(wk, teams, games, schedule)
        for t in teams:
            for p in PATHS:
                if st[t][p] and res[t][p] is None:
                    res[t][p] = wk
    for t in teams:
        ws = [res[t][p] for p in PATHS]
        res[t]['all'] = max(ws) if all(w is not None for w in ws) else None
    return res
