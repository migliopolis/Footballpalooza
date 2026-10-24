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
assert rank['0003'] == 2 and rank['0010'] == 3, 'Hauk Tua beat Hold Timers head-to-head (week 4)'
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
r2 = {x['id']: x['owner'] for x in d['draftOrderRound2']}
assert r2['0001'] == '0012' and r2['0002'] == '0007', r2
cen = {t['id']: t for t in d['standings']}
assert cen['0003']['gb'] == 1.0 and cen['0003']['divRecord'] == '1-1-0', cen['0003']
print('trade and division checks passed')
