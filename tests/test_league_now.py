#!/usr/bin/env python3
"""Checks the playoff and draft-order logic against real week-6 2026 data.
Run: python3 tests/test_league_now.py"""
import os, sys, copy, json
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..', 'scripts'))
import league_now as ln

FIX = os.path.join(HERE, 'fixtures', '2026-week6')
d = ln.build(FIX)
seeds = [s['id'] for s in d['seeds']]
assert seeds == ['0009', '0005', '0002', '0001', '0004', '0007'], seeds
rank = {t['id']: t['divisionRank'] for t in d['standings']}
assert rank['0010'] == 2 and rank['0003'] == 3, 'tied 3-3: 2026 breaks division ties on total points (Hold Timers 725.4, Hauk Tua 681.8)'
six = d['seeds'][5]
assert six['via'] == 'all-play wins' and six['tiebreak'] == 'total points', six
assert d['seeds'][1]['tiebreak'] == 'total points'
picks = [x['id'] for x in d['draftOrder']]
assert picks == ['0008', '0011', '0012', '0010', '0006', '0003', '0007', '0004', '0001', '0002', '0005', '0009'], picks
assert d['weeksPlayed'] == 6
print('all checks passed')

# traded picks (MFL futureDraftPicks, Oct 24 2026)
own = {x['id']: x['owner'] for x in d['draftOrder']}
assert own['0009'] == '0008' and own['0004'] == '0011', own
r2 = {x['id']: x['owner'] for x in d['draftRounds']['2']}
assert r2['0001'] == '0012' and r2['0002'] == '0007', r2
cen = {t['id']: t for t in d['standings']}
assert cen['0003']['gb'] == 1.0 and cen['0003']['divRecord'] == '1-1-0', cen['0003']
print('trade and division checks passed')

# playoff odds simulation: six spots, three division winners, everyone's seed odds add to 100
o = d['odds']
assert o and o['model']['sims'] >= 1000
T = o['teams']
assert abs(sum(T[t]['playoff'] for t in T) - 600) < 0.5, sum(T[t]['playoff'] for t in T)
assert abs(sum(T[t]['bye'] for t in T) - 200) < 0.5
assert abs(sum(T[t]['division'] for t in T) - 300) < 0.5
assert all(abs(sum(T[t]['seeds']) - 100) < 0.5 for t in T)
assert all(len(T[t]['ownGames']) == 8 for t in T)          # weeks 7-14 left in the fixture
assert all(g['ifWin'][0] >= g['ifLoss'][0] - 2 for t in T for g in T[t]['ownGames'])  # winning shouldn't hurt
print('odds checks passed')
