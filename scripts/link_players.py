#!/usr/bin/env python3
"""Link MFL players to ESPN athletes and record where their names disagree.

Reads  data/mfl/players.json   (MFL list, with espn_id where MFL has one)
       data/espn/athletes.json (every player on an NFL roster, by ESPN id)
       data/mfl/rosters.json   (to put FBP-rostered players first in the report)
       data/player-overrides.json (hand corrections, optional)
Writes data/player-links.json         {mfl id: [espn id, how, display name]}
       data/player-links-report.json  counts plus every mismatch and miss, rostered players first

How a player is linked, in order:
  1. override   a hand correction in data/player-overrides.json ({"mfl id": "espn id"}, or null to unlink)
  2. mfl        MFL's own espn_id (names are compared anyway; disagreements are reported)
  3. name       same normalized name and position (team breaks ties)
  4. last+team  same normalized last name, position and NFL team, when only one player fits
Name normalizing ignores case, accents, punctuation and suffixes (Jr., Sr., II, III, IV, V),
and treats common nicknames as the same first name (Pat/Patrick, Mike/Michael, ...).
The display name is ESPN's (e.g. "Patrick Mahomes II") when linked, else MFL's flipped to First Last.
Standard library only; never fails the workflow.
"""
import json, os, re, unicodedata
from collections import defaultdict

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
D = lambda *p: os.path.join(ROOT, 'data', *p)
SUFFIXES = {'jr', 'sr', 'ii', 'iii', 'iv', 'v'}
NICK = {}
for group in [
    ['pat', 'patrick'], ['mike', 'michael', 'mikey'], ['chris', 'christopher'], ['matt', 'matthew'],
    ['josh', 'joshua'], ['nick', 'nicholas', 'nicolas'], ['will', 'william', 'bill', 'billy', 'willie'],
    ['rob', 'robert', 'robbie', 'bob', 'bobby'], ['tony', 'anthony'], ['jon', 'jonathan', 'john', 'johnny'],
    ['jim', 'james', 'jimmy', 'jamie'], ['joe', 'joseph', 'joey'], ['dan', 'daniel', 'danny'],
    ['dave', 'david'], ['steve', 'steven', 'stephen'], ['ben', 'benjamin', 'benny'], ['sam', 'samuel', 'sammy'],
    ['zach', 'zachary', 'zack', 'zak'], ['alex', 'alexander'], ['andy', 'andrew', 'drew'], ['tom', 'thomas', 'tommy'],
    ['ken', 'kenneth', 'kenny'], ['greg', 'gregory'], ['jeff', 'jeffrey', 'jeffery'], ['tim', 'timothy'],
    ['ed', 'edward', 'eddie'], ['rich', 'richard', 'rick', 'ricky', 'dick'], ['ron', 'ronald', 'ronnie'],
    ['gabe', 'gabriel'], ['nate', 'nathan', 'nathaniel'], ['jake', 'jacob'], ['charlie', 'charles', 'chuck'],
    ['cam', 'cameron'], ['scotty', 'scott'], ['chig', 'chigoziem'], ['hollywood', 'marquise'],
]:   # generic nicknames only: a wrong guess here could link two different players
    canon = group[0]
    for n in group:
        NICK.setdefault(n, canon)


def norm_words(name):
    name = unicodedata.normalize('NFKD', name or '').encode('ascii', 'ignore').decode().lower()
    name = re.sub(r"[.'’`]", '', name)          # D.J. -> dj, Ja'Marr -> jamarr
    name = re.sub(r'[^a-z ]+', ' ', name)        # hyphens and the rest -> spaces
    words = [w for w in name.split() if w not in SUFFIXES]
    return words


def key(name):
    w = norm_words(name)
    if not w:
        return ''
    return ' '.join([NICK.get(w[0], w[0])] + w[1:])


def last_key(name):
    w = norm_words(name)
    return w[-1] if w else ''


def mfl_display(name):
    """MFL stores "Last, First" (sometimes with a trailing space)."""
    name = (name or '').strip()
    if ',' in name:
        last, first = [p.strip() for p in name.split(',', 1)]
        return f'{first} {last}'.strip()
    return name


ESPN_TEAM = {'GBP': 'GB', 'JAC': 'JAX', 'KCC': 'KC', 'LVR': 'LV', 'NEP': 'NE', 'NOS': 'NO', 'SFO': 'SF', 'TBB': 'TB', 'WAS': 'WSH'}
POS_OK = {'QB': {'QB'}, 'RB': {'RB', 'FB'}, 'WR': {'WR'}, 'TE': {'TE'}}


def load(path, default=None):
    try:
        return json.load(open(path))
    except Exception:
        return default


def main():
    mp = load(D('mfl', 'players.json'))
    ea = load(D('espn', 'athletes.json'))
    if not mp or not ea:
        print('link_players: missing MFL players or ESPN athletes; skipping'); return
    fields = mp.get('fields', [])
    col = {f: i for i, f in enumerate(fields)}
    ro = load(D('mfl', 'rosters.json'), {})
    rostered = {}
    for f in (ro.get('rosters', {}).get('franchise') or []):
        pl = f.get('player') or []
        for p in (pl if isinstance(pl, list) else [pl]):
            rostered[p['id']] = f['id']
    overrides = load(D('player-overrides.json'), {}) or {}
    overrides = {k: v for k, v in overrides.items() if not k.startswith('_')}

    by_key, by_last = defaultdict(list), defaultdict(list)
    for eid, a in ea.items():
        by_key[key(a['name'])].append(eid)
        by_last[(last_key(a['name']), a.get('team'))].append(eid)

    links, report = {}, {'mismatch': [], 'byName': [], 'unmatched': [], 'staleId': []}
    counts = defaultdict(int)
    for mid, row in mp.get('players', {}).items():
        get = lambda f: row[col[f]] if f in col and col[f] < len(row) else ''
        pos = get('position')
        if pos not in POS_OK:
            continue
        mname, mteam, mesp = mfl_display(get('name')), get('team'), str(get('espn_id') or '')
        eteam = ESPN_TEAM.get(mteam, mteam)
        entry = {'mfl': mid, 'mflName': mname, 'pos': pos, 'team': mteam, 'fbp': rostered.get(mid)}
        eid, how = None, None
        def by_name():
            cands = [e for e in by_key.get(key(mname), []) if ea[e].get('pos') in POS_OK[pos]]
            if len(cands) > 1:
                cands = [e for e in cands if ea[e].get('team') == eteam] or cands
            if len(cands) == 1:
                return cands[0], 'name'
            c2 = [e for e in by_last.get((last_key(mname), eteam), []) if ea[e].get('pos') in POS_OK[pos]]
            return (c2[0], 'last+team') if len(c2) == 1 else (None, None)

        bad_id = False
        if mid in overrides:
            eid, how = overrides[mid], 'override'
        elif mesp and mesp in ea and key(ea[mesp]['name']) != key(mname) and last_key(ea[mesp]['name']) != last_key(mname):
            # MFL's ESPN id names somebody else: try the name instead, and report it either way
            eid, how = by_name()
            report['mismatch'].append({**entry, 'espn': mesp, 'espnName': ea[mesp]['name'],
                                       'fixedTo': eid, 'fixedName': ea[eid]['name'] if eid else None,
                                       'note': 'MFL espn_id names a different player' + ('; linked by name instead' if eid else '; left unlinked')})
            bad_id = True
        elif mesp:
            eid, how = mesp, 'mfl'
            if mesp not in ea:
                report['staleId'].append({**entry, 'espn': mesp, 'note': 'ESPN id not on a current NFL roster (free agent, retired or practice squad elsewhere)'})
        if not eid and not bad_id and not mesp and mid not in overrides:   # MFL has no ESPN id: match by name
            eid, how = by_name()
            if eid:
                report['byName'].append({**entry, 'espn': eid, 'espnName': ea[eid]['name'], 'how': how})
        if eid:
            a = ea.get(eid)
            display = a['name'] if a else mname
            links[mid] = [eid, how, display]
            counts[how] += 1
            if a and how in ('mfl', 'override') and a['name'] != mname and key(a['name']) == key(mname):
                counts['spellingFixed'] += 1
        else:
            counts['unmatched'] += 1
            if mteam and mteam != 'FA':
                report['unmatched'].append(entry)
    order = lambda lst: sorted(lst, key=lambda x: (x.get('fbp') is None, x['pos'], x['mflName']))
    for k in report:
        report[k] = order(report[k])
    summary = {'linked': len(links), **counts,
               'rosteredLinked': sum(1 for m in rostered if m in links),
               'rosteredTotal': sum(1 for m in rostered if mp['players'].get(m, [''] * 2)[col.get('position', 1)] in POS_OK)}
    json.dump({'fields': ['espn_id', 'how', 'name'], 'links': links}, open(D('player-links.json'), 'w'),
              ensure_ascii=False, separators=(',', ':'), sort_keys=True)
    json.dump({'summary': summary, **report}, open(D('player-links-report.json'), 'w'), ensure_ascii=False, indent=1)
    print('link_players:', summary)


if __name__ == '__main__':
    main()
