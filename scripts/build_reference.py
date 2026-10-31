"""Build data/reference.json, the data behind the Reference tab (the FBP Reference almanac).

History through the last finished season is frozen in data/reference/history.json (moved over from
the migliopolis/fbpreference almanac). Each weekly refresh lays the current season on top, from the
files refresh_mfl.py saved (data/mfl/schedule.json, leagueStandings.json) and the ranks league_now.py
computed (data/league-now.json), then recomputes everything that depends on game scores: all-time
records, head-to-head, and the record tables.

    python scripts/build_reference.py           # write data/reference.json
    python scripts/build_reference.py --check   # recompute the frozen history and compare (no write)
"""
import json, sys, copy
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / 'data'


def load(p, default=None):
    try:
        return json.loads(Path(p).read_text())
    except Exception:
        if default is not None:
            return default
        raise


def f1(x):
    return round(float(x) + 1e-9, 1)


# ---------- current season from the MFL refresh ----------
def overlay_current(d):
    meta = load(DATA / 'mfl' / '_meta.json', {})
    year = int(meta.get('season') or d['meta']['current_year'])
    sched = load(DATA / 'mfl' / 'schedule.json', {})
    weeks = (sched.get('schedule') or {}).get('weeklySchedule') or []
    if isinstance(weeks, dict):
        weeks = [weeks]
    games, played = [], 0
    for wi, wk in enumerate(weeks):
        n = wk.get('week') or str(wi + 1)
        mus = wk.get('matchup') or []
        if isinstance(mus, dict):
            mus = [mus]
        any_score = False
        for mu in mus:
            fr = mu.get('franchise') or []
            if len(fr) != 2:
                continue
            a, b = fr
            sa, sb = a.get('score', ''), b.get('score', '')
            if sa not in ('', None) and sb not in ('', None) and (a.get('result') or b.get('result')):
                any_score = True
            else:
                sa = sb = ''
            games.append({'week': str(int(n)), 'franchiseA': a['id'], 'scoreA': sa, 'resultA': a.get('result') or 'T', 'isHomeA': a.get('isHome', '0'),
                          'franchiseB': b['id'], 'scoreB': sb, 'resultB': b.get('result') or 'T', 'isHomeB': b.get('isHome', '1')})
        if any_score:
            played = max(played, int(n))
    if not games:
        return d, year  # nothing new; keep the frozen copy
    y = str(year)
    d['schedules_by_year'][y] = games
    if year not in d['meta']['years_covered']:
        d['meta']['years_covered'].append(year)
    d['meta']['current_year'] = year
    d['meta']['current_week'] = played

    st = (load(DATA / 'mfl' / 'leagueStandings.json', {}).get('leagueStandings') or {}).get('franchise') or []
    if st:
        d['standings_by_year'][y] = [dict({'franchise': r['id']}, **{k: v for k, v in r.items() if k != 'id'}) for r in st]
    now = load(DATA / 'league-now.json', {})
    rank = {s['id']: i + 1 for i, s in enumerate(now.get('standings') or [])}
    names = {s['id']: s.get('name') for s in now.get('standings') or []}
    for r in st:
        fr = r['id']
        w, l, t = (int(r.get(k) or 0) for k in ('h2hw', 'h2hl', 'h2ht'))
        row = {'year': year, 'rank': rank.get(fr, 0), 'name': names.get(fr) or d['franchises'].get(fr, fr), 'w': w, 'l': l, 't': t,
               'pf': f1(r.get('pf') or 0), 'pa': f1(r.get('pa') or 0), 'avgpf': f1(r.get('avgpf') or 0), 'avgpa': f1(r.get('avgpa') or 0),
               'all_play': r.get('all_play_wlt'), 'all_play_pct': r.get('all_play_pct'), 'streak': r.get('strk')}
        seasons = [s for s in d['franchise_seasons'].get(fr, []) if s['year'] != year] + [row]
        d['franchise_seasons'][fr] = sorted(seasons, key=lambda s: s['year'])
    bracket_from_scores(d, y, now.get('seeds') or [])
    if not rank:  # no computed ranks: fall back to MFL's order
        for i, r in enumerate(st):
            for s in d['franchise_seasons'][r['id']]:
                if s['year'] == year:
                    s['rank'] = i + 1
    return d, year


def bracket_from_scores(d, y, seeds):
    """This season's bracket and champion, once playoff scores are in: seeds 1-2 sit out round 1,
    the bracket follows the round-1 and semifinal winners, and the final game decides the title."""
    wks = d['playoff_weeks_by_year'].get(y)
    if not wks or len(seeds) < 6:
        return
    r1w, sw, cw = wks
    final = lambda g: g['scoreA'] not in ('', None) and g['scoreB'] not in ('', None)
    game = lambda g: {'franchiseA': g['franchiseA'], 'scoreA': f1(g['scoreA']), 'resultA': g['resultA'],
                      'franchiseB': g['franchiseB'], 'scoreB': f1(g['scoreB']), 'resultB': g['resultB']}
    winner = lambda g: g['franchiseA'] if float(g['scoreA']) > float(g['scoreB']) else g['franchiseB']
    wk = lambda n: [g for g in d['schedules_by_year'][y] if int(g['week']) == n and final(g)]
    ids = [s['id'] for s in sorted(seeds, key=lambda s: s['seed'])]
    byes, field = ids[:2], set(ids[2:6])
    r1 = [g for g in wk(r1w) if {g['franchiseA'], g['franchiseB']} <= field]
    if not r1:
        return
    alive = set(byes) | {winner(g) for g in r1}
    semis = [g for g in wk(sw) if {g['franchiseA'], g['franchiseB']} <= alive]
    fin = [g for g in wk(cw) if semis and {g['franchiseA'], g['franchiseB']} <= {winner(s) for s in semis}]
    d['playoff_brackets'][y] = {'round1_week': r1w, 'semi_week': sw, 'championship_week': cw, 'byes': byes,
                                'round1_games': [game(g) for g in r1], 'semifinal_games': [game(g) for g in semis],
                                'championship_game': game(fin[0]) if fin else None}
    if fin:
        g = fin[0]; w = winner(g); l = g['franchiseB'] if w == g['franchiseA'] else g['franchiseA']
        sc = sorted([f1(g['scoreA']), f1(g['scoreB'])], reverse=True)
        d['championships'][y] = {'champion': w, 'runnerup': l, 'score': f'{sc[0]}-{sc[1]}', 'week': cw, 'margin': f1(sc[0] - sc[1])}


# ---------- everything that follows from game scores ----------
def games(d):
    out = []
    for y, gs in d['schedules_by_year'].items():
        po0 = d['playoff_weeks_by_year'].get(y, [99])[0]
        for g in gs:
            if g['scoreA'] in ('', None) or g['scoreB'] in ('', None):
                continue
            wk = int(g['week'])
            out.append((int(y), wk, wk >= po0, g))
    return out


def derive(d):
    cur = d['meta']['current_year']
    G = games(d)
    name_in = lambda fr, y: next((s['name'] for s in d['franchise_seasons'].get(fr, []) if s['year'] == y), d['franchises'].get(fr, fr))
    champs = d['championships']

    # all-time: regular-season record; points are the season standings totals
    rec = defaultdict(lambda: [0, 0, 0])
    for y, wk, po, g in G:
        if po:
            continue
        for s in 'AB':
            rec[g['franchise' + s]]['WLT'.index(g['result' + s])] += 1
    at = {}
    for fr, nm in d['franchises'].items():
        w, l, t = rec[fr]
        seasons = d['franchise_seasons'].get(fr, [])
        at[fr] = {'current_name': nm, 'w': w, 'l': l, 't': t, 'win_pct': round(w / (w + l + t), 3) if w + l + t else 0,
                  'total_pf': f1(sum(s['pf'] for s in seasons)), 'seasons_played': sum(1 for s in seasons if s['year'] < cur or str(s['year']) in champs),
                  'championships': sorted(int(y) for y, c in champs.items() if c['champion'] == fr),
                  'runnerups': sorted(int(y) for y, c in champs.items() if c['runnerup'] == fr)}
    d['franchise_alltime'] = at

    # head-to-head counts every game, playoffs included
    h = defaultdict(lambda: defaultdict(lambda: [0, 0, 0]))
    for y, wk, po, g in G:
        for a, b in (('A', 'B'), ('B', 'A')):
            h[g['franchise' + a]][g['franchise' + b]]['WLT'.index(g['result' + a])] += 1
    d['head_to_head'] = {fr: {o: dict(zip('wlt', v)) for o, v in opp.items()} for fr, opp in h.items()}

    # record tables
    sides = []
    for y, wk, po, g in G:
        for a, b in (('A', 'B'), ('B', 'A')):
            sides.append({'year': y, 'week': wk, 'po': po, 'franchise': g['franchise' + a], 'score': f1(g['score' + a]),
                          'opp': g['franchise' + b], 'opp_score': f1(g['score' + b]), 'result': g['result' + a]})
    row = lambda s: {'year': s['year'], 'week': s['week'], 'franchise': s['franchise'], 'name': name_in(s['franchise'], s['year']), 'score': s['score'],
                     'opp': s['opp'], 'opp_name': name_in(s['opp'], s['year']), 'result': s['result']}
    L = {}
    L['top_single_game_scores'] = [row(s) for s in sorted(sides, key=lambda s: (-s['score'], s['year'], s['week']))[:15]]
    L['low_single_game_scores'] = [row(s) for s in sorted(sides, key=lambda s: (s['score'], s['year'], s['week']))[:10]]
    wins = [s for s in sides if s['result'] == 'W']
    mrow = lambda s: {'year': s['year'], 'week': s['week'], 'winner': s['franchise'], 'winner_name': name_in(s['franchise'], s['year']), 'winner_score': s['score'],
                      'loser': s['opp'], 'loser_name': name_in(s['opp'], s['year']), 'loser_score': s['opp_score'], 'margin': f1(s['score'] - s['opp_score'])}
    L['biggest_blowouts'] = [mrow(s) for s in sorted(wins, key=lambda s: (-(s['score'] - s['opp_score']), s['year'], s['week']))[:10]]
    L['closest_games'] = [mrow(s) for s in sorted(wins, key=lambda s: (s['score'] - s['opp_score'], s['year'], s['week']))[:10]]

    reg = [s for s in sides if not s['po']]
    car = defaultdict(lambda: {'games': 0, 'pts': 0.0, 'w': 0, 'l': 0, 't': 0})
    for s in reg:
        c = car[s['franchise']]; c['games'] += 1; c['pts'] += s['score']; c['wlt'[('WLT').index(s['result'])]] += 1
    L['career_ppg'] = sorted(({'franchise': fr, 'name': d['franchises'][fr], 'games': c['games'], 'total_points': f1(c['pts']), 'ppg': round(c['pts'] / c['games'], 2),
                               'record': f"{c['w']}-{c['l']}-{c['t']}"} for fr, c in car.items()), key=lambda r: -r['ppg'])

    def per_season(rows):
        acc = defaultdict(lambda: {'n': 0, 'pts': 0.0, 'w': 0, 'l': 0})
        for s in rows:
            a = acc[(s['year'], s['franchise'])]; a['n'] += 1; a['pts'] += s['score']
            if s['result'] == 'W': a['w'] += 1
            elif s['result'] == 'L': a['l'] += 1
        return acc
    is_champ = lambda y, fr: (champs.get(str(y)) or {}).get('champion') == fr
    ss = per_season(reg)
    # full seasons only: a hot first month shouldn't top the list
    top = sorted(((k, a) for k, a in ss.items() if k[0] < cur or str(k[0]) in champs), key=lambda kv: -kv[1]['pts'] / kv[1]['n'])[:25]
    L['season_ppg_top25'] = [{'rank': i + 1, 'year': y, 'franchise': fr, 'team': name_in(fr, y), 'ppg': round(a['pts'] / a['n'], 2), 'record': f"{a['n']}gp",
                              'total_pts': f1(a['pts']), 'champion': is_champ(y, fr)} for i, ((y, fr), a) in enumerate(top)]
    ps = per_season([s for s in sides if s['po']])
    top = sorted(((k, a) for k, a in ps.items() if a['n'] >= 2), key=lambda kv: -kv[1]['pts'] / kv[1]['n'])[:15]   # two playoff games or more
    L['playoff_ppg_top15'] = [{'rank': i + 1, 'year': y, 'franchise': fr, 'team': name_in(fr, y), 'ppg': round(a['pts'] / a['n'], 2), 'record': f"{a['w']}-{a['l']}",
                               'total_pts': f1(a['pts']), 'champion': is_champ(y, fr)} for i, ((y, fr), a) in enumerate(top)]
    by = defaultdict(dict)
    for s in sides:
        by[(s['year'], s['franchise'])][s['week']] = s['score']
    two = []
    for (y, fr), wks in by.items():
        ks = sorted(wks)   # back-to-back games played, so a playoff bye doesn't break a stretch
        for a, b in zip(ks, ks[1:]):
            two.append({'total': f1(wks[a] + wks[b]), 'year': y, 'franchise': fr, 'name': name_in(fr, y), 'week_a': a, 'score_a': wks[a], 'week_b': b, 'score_b': wks[b]})
    L['top_two_game_stretches'] = sorted(two, key=lambda r: (-r['total'], r['year'], r['week_a']))[:20]
    d['leaderboards'] = L
    return d


def check():
    base = load(DATA / 'reference' / 'history.json')
    got = derive(copy.deepcopy(base))
    bad = 0
    for k in ('franchise_alltime', 'head_to_head'):
        if got[k] != base[k]:
            bad += 1; print('differs:', k)
            for fr in base[k]:
                if got[k].get(fr) != base[k][fr]:
                    print('  ', fr, got[k].get(fr), base[k][fr]); break
    for k, v in base['leaderboards'].items():
        g = got['leaderboards'][k]
        if g != v:
            bad += 1; print('differs: leaderboards.' + k)
            for i, (x, y) in enumerate(zip(g, v)):
                if x != y:
                    print('   row', i, '\n   got ', x, '\n   want', y); break
    print('OK' if not bad else f'{bad} differences')
    return bad


def main():
    if '--check' in sys.argv:
        sys.exit(1 if check() else 0)
    d = load(DATA / 'reference' / 'history.json')
    d, year = overlay_current(d)
    d = derive(d)
    from pick_tenure import apply as pick_tenure   # what each rookie pick gave the team that drafted it
    d = pick_tenure(d)
    from datetime import datetime, timezone
    d['meta']['built'] = datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')
    (DATA / 'reference.json').write_text(json.dumps(d, separators=(',', ':'), ensure_ascii=False))
    print(f"reference.json: {year} through week {d['meta']['current_week']}")


if __name__ == '__main__':
    main()
