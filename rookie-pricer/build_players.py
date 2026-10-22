#!/usr/bin/env python3
"""Build players.json for the FBP Rookie Pricer from sources.json.

Usage:  python3 build_players.py            (run from the rookie-pricer folder)

Every source has a date. Sources older than settings.windowDays (60) before
asOf are ignored. The rest are weighted by age with a half-life of
settings.halfLifeDays (30): a source 30 days old counts half as much as one
from today. A source can also carry a "weight" multiplier; consensus sources
that already average many mocks use 3.

Rookie-draft order (adp)
- Each rookie source is an ordered list of players.
- A player missing from a list counts as (list length + 6), i.e. a little
  below the last player that list included.
- adp is the weighted average across rookie sources.

Projected NFL pick (nflPick)
- NFL sources are either "board" (big-board rank) or "mock" (mock-draft slot).
- A player missing from a board counts as settings.missingBigBoardRank (120).
- A player missing from a mock counts as his board estimate, but never earlier
  than settings.missingNflMockFloor (33): a first-round mock that leaves him
  out implies he goes after round 1.
- nflPick is the weighted average, capped at settings.undraftedPick (260).

Players: everyone in at least one current rookie source, sorted by adp,
keeping the top settings.maxPlayers.

After the NFL draft: add an "actualNflPicks" map (player -> overall pick),
set "mode" to "final", and rerun.
"""
import json, os
from datetime import date

here = os.path.dirname(os.path.abspath(__file__))
src = json.load(open(os.path.join(here, 'sources.json')))
cfg = src['settings']
as_of = date.fromisoformat(src['asOf'])

def weight(s):
    age = (as_of - date.fromisoformat(s['date'])).days
    if age > cfg['windowDays']:
        return 0.0
    return s.get('weight', 1) * 0.5 ** (max(age, 0) / cfg['halfLifeDays'])

def wavg(pairs):
    tot = sum(w for _, w in pairs)
    return sum(v * w for v, w in pairs) / tot

rookie = [(s, weight(s)) for s in src['rookieSources']]
rookie = [(s, w) for s, w in rookie if w > 0]
nfl = [(s, weight(s)) for s in src['nflSources']]
nfl = [(s, w) for s, w in nfl if w > 0]
boards = [(s, w) for s, w in nfl if s['type'] == 'board']
mocks = [(s, w) for s, w in nfl if s['type'] == 'mock']

def rookie_adp(name):
    pairs = []
    for s, w in rookie:
        lst = s['picks']
        pairs.append(((lst.index(name) + 1) if name in lst else len(lst) + 6, w))
    return wavg(pairs)

def nfl_pick(name):
    actual = src.get('actualNflPicks', {})
    if name in actual:
        return actual[name]
    board_vals = [(s['picks'].get(name, cfg['missingBigBoardRank']), w) for s, w in boards]
    board_est = wavg(board_vals) if board_vals else cfg['missingBigBoardRank']
    mock_vals = [(s['picks'].get(name, max(cfg['missingNflMockFloor'], board_est)), w) for s, w in mocks]
    return min(cfg['undraftedPick'], round(wavg(board_vals + mock_vals)))

players = {n for s, _ in rookie for n in s['picks']}
ranked = sorted(players, key=lambda n: (rookie_adp(n), n))[:cfg['maxPlayers']]
out = [{'name': n, 'pos': src['positions'][n], 'school': src['schools'].get(n, ''),
        'adp': round(rookie_adp(n), 1), 'nflPick': nfl_pick(n)} for n in ranked]

note = ('NFL picks are projections from ' + '; '.join(s['name'] for s, _ in nfl)
        + '. Rookie-draft order (adp) is averaged from ' + '; '.join(s['name'] for s, _ in rookie)
        + '. Newer sources count more.')
data = {'season': src['season'], 'mode': src['mode'], 'asOf': src['asOf'], 'note': note, 'players': out}
json.dump(data, open(os.path.join(here, 'players.json'), 'w'), indent=1, ensure_ascii=False)
print(f'Wrote {len(out)} players to players.json')
print('Rookie sources used:', ', '.join(f"{s['name']} ({w:.2f})" for s, w in rookie))
print('NFL sources used:', ', '.join(f"{s['name']} ({w:.2f})" for s, w in nfl))
