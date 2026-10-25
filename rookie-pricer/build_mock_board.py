#!/usr/bin/env python3
"""Build mock-board.json: the rookie order the hub's Rookie Draft mock uses.

The mock ranks rookies by one chosen big board (BOARD below) instead of the
pricer's blended average. Projected NFL picks still come from sources.json,
computed exactly as build_players.py does, so prices match the Rookie Pricer.

Usage:  python3 build_mock_board.py     (run from the rookie-pricer folder)
To switch boards: replace SOURCE and BOARD and rerun.
"""
import json, os
from datetime import date

SOURCE = {'name': "Mike Kashuba's 2027 Rookie Draft Superflex Big Board 4.0 (Footballguys)",
          'url': 'https://www.footballguys.com/article/2027-dynasty-rookie-rankings-big-board-v4',
          'date': '2026-10-21'}
# rank order: name, position, school
BOARD = [
    ('Jeremiah Smith', 'WR', 'Ohio State'), ('Jadan Baugh', 'RB', 'Florida'), ('Charlie Becker', 'WR', 'Indiana'),
    ('Drew Mestemaker', 'QB', 'Oklahoma State'), ('Ahmad Hardy', 'RB', 'Missouri'), ('Darian Mensah', 'QB', 'Miami'),
    ('Kewan Lacy', 'RB', 'Ole Miss'), ('CJ Carr', 'QB', 'Notre Dame'), ('KJ Duff', 'WR', 'Rutgers'),
    ('Cam Coleman', 'WR', 'Texas'), ('Nick Marsh', 'WR', 'Indiana'), ('Nate Frazier', 'RB', 'Georgia'),
    ('Dante Moore', 'QB', 'Oregon'), ('Arch Manning', 'QB', 'Texas'), ("Trey'Dez Green", 'TE', 'LSU'),
    ('Ryan Wingo', 'WR', 'Texas'), ('Hollywood Smothers', 'RB', 'Texas'), ('Jamari Johnson', 'TE', 'Oregon'),
    ('Deuce Alexander', 'WR', 'Ole Miss'), ('Luke Reynolds', 'TE', 'Virginia Tech'), ('Ryan Coleman-Williams', 'WR', 'Alabama'),
    ('Mark Fletcher Jr.', 'RB', 'Miami'), ('Trinidad Chambliss', 'QB', 'Ole Miss'), ('Wyatt Young', 'WR', 'Oklahoma State'),
    ('Bryant Wesco Jr.', 'WR', 'Clemson'), ('Anthony Evans', 'WR', 'Mississippi State'), ('T.J. Moore', 'WR', 'Clemson'),
    ('Reed Harris', 'WR', 'Arizona State'), ('Raleek Brown', 'RB', 'Texas'), ('Austin Simmons', 'QB', 'Missouri'),
    ('Isaac Brown', 'RB', 'Louisville'), ('DJ Vonnahme', 'TE', 'Iowa'), ('Mario Craver', 'WR', 'Texas A&M'),
    ('LJ Martin', 'RB', 'BYU'), ('Duce Robinson', 'WR', 'Florida State'), ('Cam Cook', 'RB', 'West Virginia'),
    ('Drake Lindsey', 'QB', 'Minnesota'), ('LaNorris Sellers', 'QB', 'South Carolina'), ('Carlos Hernandez', 'WR', 'Wake Forest'),
    ('Deshaun Bishop', 'RB', 'Tennessee'), ("Que'Sean Brown", 'WR', 'Virginia Tech'), ('Antwan Raymond', 'RB', 'Rutgers'),
    ('Jayden Maiava', 'QB', 'USC'), ('Colin Dixon', 'WR', 'Illinois'), ('Julian Sayin', 'QB', 'Ohio State'),
    ('Terrance Carter Jr.', 'TE', 'Texas Tech'), ('Justice Haynes', 'RB', 'Georgia Tech'), ('Nyck Harbor', 'WR', 'South Carolina'),
    ('Byrum Brown', 'QB', 'Auburn'), ('Wayshawn Parker', 'RB', 'Utah'), ('Omarion Miller', 'WR', 'Arizona State'),
    ('Devin McCuin', 'WR', 'Ohio State'), ('Sam Leavitt', 'QB', 'LSU'), ('Brendan Sorsby', 'QB', ''),
]
# board spelling -> spelling used in sources.json
ALIAS = {'T.J. Moore': 'TJ Moore', 'Deshaun Bishop': 'DeSean Bishop'}

here = os.path.dirname(os.path.abspath(__file__))
src = json.load(open(os.path.join(here, 'sources.json')))
cfg = src['settings']
as_of = date.fromisoformat(src['asOf'])


def weight(s):
    age = (as_of - date.fromisoformat(s['date'])).days
    return 0.0 if age > cfg['windowDays'] else s.get('weight', 1) * 0.5 ** (max(age, 0) / cfg['halfLifeDays'])


def wavg(pairs):
    tot = sum(w for _, w in pairs)
    return sum(v * w for v, w in pairs) / tot


nfl = [(s, weight(s)) for s in src['nflSources']]
nfl = [(s, w) for s, w in nfl if w > 0]
boards = [(s, w) for s, w in nfl if s['type'] == 'board']
mocks = [(s, w) for s, w in nfl if s['type'] == 'mock']
known = {n for s, _ in nfl for n in s['picks']} | set(src.get('actualNflPicks', {}))


def nfl_pick(name):
    """Same as build_players.py; None when no NFL source mentions the player."""
    actual = src.get('actualNflPicks', {})
    if name in actual:
        return actual[name]
    if name not in known:
        return None
    board_vals = [(s['picks'].get(name, cfg['missingBigBoardRank']), w) for s, w in boards]
    board_est = wavg(board_vals) if board_vals else cfg['missingBigBoardRank']
    mock_vals = [(s['picks'].get(name, max(cfg['missingNflMockFloor'], board_est)), w) for s, w in mocks]
    return min(cfg['undraftedPick'], round(wavg(board_vals + mock_vals)))


out, missing = [], []
for rank, (name, pos, school) in enumerate(BOARD, 1):
    pick = nfl_pick(ALIAS.get(name, name))
    if pick is None:
        missing.append(name)
    out.append({'rank': rank, 'name': name, 'pos': pos, 'school': school, 'nflPick': pick})
data = {'season': src['season'], 'mode': src['mode'], 'asOf': src['asOf'], 'board': SOURCE,
        'note': f"Rookie order: {SOURCE['name']}. Projected NFL picks: the Rookie Pricer's sources (as of {src['asOf']}); "
                "players no NFL source mentions price as undrafted.",
        'players': out}
json.dump(data, open(os.path.join(here, 'mock-board.json'), 'w'), indent=1, ensure_ascii=False)
print(f'Wrote {len(out)} players to mock-board.json; no NFL projection for {len(missing)}: {", ".join(missing)}')
