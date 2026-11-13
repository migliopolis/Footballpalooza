"""Role archetypes for every rostered QB, RB, WR and TE, read from his ESPN game log this regular season, so the
Rosters page can show their icons without loading a game log per player.

Same rules as role() in assets/rosters.js (the box and Player Page still work it out live when this hasn't run):
  QB  Volume King: 36+ pass attempts a game. Dual Threat: 30+ rushing yards a game.
  RB  Volume King: 18+ touches a game; else TD-Dependent: 0.6+ TDs a game on fewer than 13 touches.
      Pass-Catching Back: 3.5+ catches a game.
  WR  Volume King: 9+ targets a game (TE 7+); else TD-Dependent: 0.5+ TDs a game on fewer than 6 targets (TE 5).
Needs 3 games. Writes 'role': [[label, why]] onto each player row in data/rosters.json (scripts/rosters.py runs
first and rewrites that file, so this runs right after it). A player ESPN doesn't answer for keeps no role. Standard
library only; runs in the daily refresh.
"""
import json, os, urllib.request
from concurrent.futures import ThreadPoolExecutor

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PATH = os.path.join(ROOT, 'data', 'rosters.json')
EAPI = 'https://site.web.api.espn.com/apis/common/v3/sports/football/nfl/athletes/{}/gamelog'


def get(eid):
    try:
        req = urllib.request.Request(EAPI.format(eid), headers={'User-Agent': 'FBP-site-refresh/1.0', 'Accept': 'application/json'})
        with urllib.request.urlopen(req, timeout=20) as r:
            return json.load(r)
    except Exception:
        return None


def roles(pos, j):
    st = next((x for x in j.get('seasonTypes') or [] if 'Regular' in (x.get('displayName') or '')), None) or ((j.get('seasonTypes') or [None])[0])
    labels = j.get('labels') or []
    evs = [e.get('stats') or [] for c in ((st or {}).get('categories') or []) for e in (c.get('events') or [])]
    n = len(evs)
    if n < 3:
        return []

    def total(cat, lab):
        off = 0
        for c in j.get('categories') or []:
            if c.get('name') == cat:
                labs = labels[off:off + c.get('count', 0)]
                if lab not in labs:
                    return 0.0
                i = off + labs.index(lab)
                s = 0.0
                for e in evs:
                    try:
                        s += float(str(e[i]).replace(',', ''))
                    except (ValueError, IndexError):
                        pass
                return s
            off += c.get('count', 0)
        return 0.0

    g = lambda x: x / n
    out = []
    if pos == 'QB':
        if g(total('passing', 'ATT')) >= 36:
            out.append(['Volume King', f"{g(total('passing', 'ATT')):.0f} pass attempts a game"])
        if g(total('rushing', 'YDS')) >= 30:
            out.append(['Dual Threat', f"{g(total('rushing', 'YDS')):.0f} rushing yards a game"])
    elif pos == 'RB':
        tch = g(total('rushing', 'CAR') + total('receiving', 'REC'))
        td = g(total('rushing', 'TD') + total('receiving', 'TD'))
        if tch >= 18:
            out.append(['Volume King', f'{tch:.1f} touches a game'])
        elif td >= .6 and tch < 13:
            out.append(['TD-Dependent', f'{td:.1f} TDs a game on {tch:.1f} touches'])
        if g(total('receiving', 'REC')) >= 3.5:
            out.append(['Pass-Catching Back', f"{g(total('receiving', 'REC')):.1f} catches a game"])
    elif pos in ('WR', 'TE'):
        tg, td = g(total('receiving', 'TGTS')), g(total('receiving', 'TD'))
        if tg >= (7 if pos == 'TE' else 9):
            out.append(['Volume King', f'{tg:.1f} targets a game'])
        elif td >= .5 and tg < (5 if pos == 'TE' else 6):
            out.append(['TD-Dependent', f'{td:.1f} TDs a game on {tg:.1f} targets'])
    return out


def main():
    R = json.load(open(PATH))
    rows = [r for t in R['teams'].values() for r in t['rows'] if r.get('espn') and r.get('pos') in ('QB', 'RB', 'WR', 'TE')]
    ids = sorted({str(r['espn']) for r in rows})
    with ThreadPoolExecutor(8) as ex:
        logs = dict(zip(ids, ex.map(get, ids)))
    got = 0
    for r in rows:
        j = logs.get(str(r['espn']))
        if j is None:
            continue
        got += 1
        ro = roles(r['pos'], j)
        if ro:
            r['role'] = ro
        else:
            r.pop('role', None)
    if got:
        json.dump(R, open(PATH, 'w'), separators=(',', ':'), ensure_ascii=False)
    print(f'roles: {got} of {len(rows)} game logs, {sum(1 for r in rows if r.get("role"))} players with a role archetype')


if __name__ == '__main__':
    main()
