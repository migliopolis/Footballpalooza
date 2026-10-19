#!/usr/bin/env python3
"""Build players.json for the FBP Rookie Pricer from sources.json.

Usage:  python3 build_players.py            (run from the rookie-pricer folder)

Method
- Rookie-draft order (adp): the average of a player's pick number across every
  rookie mock in sources.json. A player missing from a mock counts as
  settings.missingRookieMockPick (30). For a mock that lists "alsoConsidered"
  players (e.g. a round-1-only mock), those players count as
  settings.alsoConsideredPick (18) instead.
- Projected NFL pick (nflPick): the average of one value per NFL mock plus the
  big-board rank. In each NFL mock the player's own slot is used; if he is not
  in that mock, his big-board rank is used, but never earlier than
  settings.missingNflMockFloor (33, i.e. a first-round mock that omits him
  implies he went after round 1). A player missing from the big board counts
  as settings.missingBigBoardRank (120).
- Every player who appears in at least one rookie mock is included.

After the NFL draft: set each player's real overall pick in players.json
(or add an "actualNflPicks" map here and rerun) and set mode to "final".
"""
import json, os

here = os.path.dirname(os.path.abspath(__file__))
src = json.load(open(os.path.join(here, 'sources.json')))
cfg = src['settings']

players = set()
for m in src['rookieMocks']:
    players.update(m['picks'])

def rookie_adp(name):
    vals = []
    for m in src['rookieMocks']:
        if name in m['picks']:
            vals.append(m['picks'].index(name) + 1)
        elif name in m.get('alsoConsidered', []):
            vals.append(cfg['alsoConsideredPick'])
        else:
            vals.append(cfg['missingRookieMockPick'])
    return sum(vals) / len(vals)

def nfl_pick(name):
    actual = src.get('actualNflPicks', {})
    if name in actual:
        return actual[name]
    board = src['bigBoard']['ranks'].get(name, cfg['missingBigBoardRank'])
    vals = [m['picks'].get(name, max(cfg['missingNflMockFloor'], board)) for m in src['nflMocks']]
    vals.append(board)
    return round(sum(vals) / len(vals))

out = []
for name in sorted(players, key=lambda n: (rookie_adp(n), n)):
    out.append({
        'name': name,
        'pos': src['positions'][name],
        'school': src['schools'].get(name, ''),
        'adp': round(rookie_adp(name), 1),
        'nflPick': nfl_pick(name),
    })

note = ('NFL picks are projections averaged from ' + ', '.join(m['name'] for m in src['nflMocks'])
        + ' plus the ' + src['bigBoard']['name'] + '. Rookie-draft order (adp) is averaged from '
        + ', '.join(m['name'] for m in src['rookieMocks']) + '.')
data = {'season': src['season'], 'mode': src['mode'], 'asOf': src['asOf'], 'note': note, 'players': out}
json.dump(data, open(os.path.join(here, 'players.json'), 'w'), indent=1, ensure_ascii=False)
print(f'Wrote {len(out)} players to players.json')
