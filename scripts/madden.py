#!/usr/bin/env python3
"""Each player's Madden fantasy score, week by week, for the FBP OVR (scripts/ovr.py).

From EA's published Madden NFL ratings (ea.com/games/madden-nfl/ratings), the latest weekly roster update: for every
QB, RB, WR and TE, half his Madden overall and half a fantasy-weighted mix of his attributes, plus a touch for
durability. Blocking counts for nothing.
  QB  throw accuracy 35%, throw power 30%, mobility (speed, agility) 20%, poise (under pressure, on the run, awareness) 15%
  RB  speed 25%, vision 20%, elusiveness 20%, hands 20%, agility 15%
  WR  hands 35%, route running 30%, speed 25%, agility 5%, jumping 5%
  TE  hands 40%, route running 30%, speed 20%, agility 10%
Only the derived score is saved (data/madden.json: {weeks: {"9": {mfl_id: score}}, latest}), never EA's ratings
themselves. Matched to MFL ids by name and position (DynastyProcess's id table, plus our rankings). Keeps the
previous file if EA can't be reached. Run before ovr.py: python scripts/madden.py
"""
import csv, io, json, os, re, sys, time, unicodedata, urllib.request
from datetime import datetime, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
D = lambda *p: os.path.join(ROOT, 'data', *p)
BASE = 'https://www.ea.com/games/madden-nfl/ratings/positions-ratings/{}?page={}'
PATHS = [('quarterback/QB', 'QB'), ('halfback/HB', 'RB'), ('wide-receiver/WR', 'WR'), ('tight-end/TE', 'TE')]
IDS = 'https://raw.githubusercontent.com/dynastyprocess/data/master/files/db_playerids.csv'
NICK = {'kenny': 'kenneth', 'nick': 'nicholas', 'matt': 'matthew', 'mike': 'michael', 'chris': 'christopher', 'josh': 'joshua',
        'zach': 'zachary', 'chig': 'chigoziem', 'gabe': 'gabriel', 'tony': 'anthony', 'bam': 'kendall', 'hollywood': 'marquise', 'dj': 'd j', 'cj': 'c j',
        'aj': 'a j', 'tj': 't j', 'jk': 'j k', 'jj': 'j j', 'pj': 'p j', 'kc': 'k c'}


def norm(s):
    s = unicodedata.normalize('NFD', s or '').encode('ascii', 'ignore').decode().lower()
    s = re.sub(r"[.'’\-]", '', s)
    s = re.sub(r'\b(jr|sr|ii|iii|iv|v)\b', '', s)
    return ' '.join(s.split())


def keys(name):
    n = norm(name)
    out = {n}
    p = n.split(' ', 1)
    if len(p) == 2 and p[0] in NICK:
        out.add(NICK[p[0]] + ' ' + p[1])
    if len(p) == 2:
        for k, v in NICK.items():
            if p[0] == v:
                out.add(k + ' ' + p[1])
    return out


def score(x, pos):
    S = lambda k: ((x.get('stats') or {}).get(k) or {}).get('value') or 0
    av = lambda ks: sum(S(k) for k in ks) / len(ks)
    o, spd = x.get('overallRating') or 0, S('speed')
    agl, dur = av(['acceleration', 'agility', 'changeOfDirection']), av(['injury', 'toughness'])
    hands, routes = av(['catching', 'catchInTraffic', 'spectacularCatch']), av(['shortRouteRunning', 'mediumRouteRunning', 'deepRouteRunning', 'release'])
    if pos == 'QB':
        c = .30 * S('throwPower') + .35 * av(['throwAccuracyShort', 'throwAccuracyMid', 'throwAccuracyDeep']) + .15 * av(['throwUnderPressure', 'throwOnTheRun', 'awareness']) + .20 * (spd + agl) / 2
    elif pos == 'RB':
        c = .25 * spd + .15 * agl + .20 * av(['bCVision', 'carrying']) + .20 * av(['breakTackle', 'jukeMove', 'spinMove', 'stiffArm', 'trucking']) + .20 * av(['catching', 'shortRouteRunning'])
    elif pos == 'WR':
        c = .35 * hands + .30 * routes + .25 * spd + .05 * agl + .05 * S('jumping')
    else:
        c = .40 * hands + .30 * routes + .20 * spd + .10 * agl
    return round(.5 * o + .5 * c + (dur - 80) * .04, 1)


def matcher():
    """name+position -> MFL id, from DynastyProcess's id table and our own rankings."""
    M = {}
    try:
        with urllib.request.urlopen(urllib.request.Request(IDS, headers={'User-Agent': 'Footballpalooza'}), timeout=60) as r:
            for row in csv.DictReader(io.StringIO(r.read().decode('utf-8'))):
                if row.get('mfl_id') not in ('', 'NA') and row.get('position') in ('QB', 'RB', 'WR', 'TE'):
                    for k in keys(row['name']):
                        M.setdefault((k, row['position']), row['mfl_id'])
    except Exception as e:
        print('  note: DynastyProcess ids unavailable:', e)
    for p in (json.load(open(D('rankings.json'), encoding='utf-8')).get('players') or []):
        for k in keys(p.get('n')):
            M[(k, p.get('pos'))] = p['id']
    return lambda name, pos: next((M[(k, pos)] for k in keys(name) if (k, pos) in M), None)


def fetch():
    out, wk = [], None
    for path, pos in PATHS:
        for pg in range(1, 8):
            req = urllib.request.Request(BASE.format(path, pg), headers={'User-Agent': 'Mozilla/5.0 (Footballpalooza league site)'})
            with urllib.request.urlopen(req, timeout=60) as r:
                h = r.read().decode('utf-8')
            m = re.search(r'<script id="__NEXT_DATA__"[^>]*>(.*?)</script>', h, re.S)
            items = json.loads(m.group(1))['props']['pageProps']['ratingsEntries']['items'] if m else []
            for x in items:
                wk = wk or (x.get('iteration') or {}).get('id')
                out.append((f"{x.get('firstName', '')} {x.get('lastName', '')}", pos, score(x, pos), x.get('overallRating') or 0))
            time.sleep(0.5)
            if len(items) < 100:
                break
    return wk, out


def main():
    prev = (json.load(open(D('madden.json'), encoding='utf-8')) if os.path.exists(D('madden.json')) else {}) or {}
    try:
        it, rows = fetch()
    except Exception as e:
        print('  FAIL Madden ratings:', e, '(kept the previous file)')
        return
    m = re.search(r'week-(\d+)', it or '')
    if not m or not rows:
        print('  FAIL Madden ratings: no weekly ratings found (kept the previous file)')
        return
    wk, find = m.group(1), matcher()
    got = {}
    for name, pos, sc, ovr in rows:
        pid = find(name, pos)
        if pid and ovr >= 55:
            got[pid] = sc
    weeks = prev.get('weeks') or {}
    weeks[wk] = got
    res = {'note': 'Madden fantasy score per player (derived from EA SPORTS Madden NFL ratings; see scripts/madden.py). Not EA\'s ratings.',
           'built': datetime.now(timezone.utc).isoformat(timespec='seconds'), 'latest': wk, 'weeks': weeks}
    with open(D('madden.json'), 'w', encoding='utf-8') as fh:
        json.dump(res, fh, separators=(',', ':'))
        fh.write('\n')
    print(f'  ok   Madden week {wk}: {len(got)} of {len(rows)} players matched')


if __name__ == '__main__':
    main()
