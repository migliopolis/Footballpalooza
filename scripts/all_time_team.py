"""The All-Time FBP team (Hall of Fame): the best single seasons ever, set in the All-FBP starting lineup.

Each season's regular-season starter points come from the saved weekly results (data/history/<year>,
finished seasons only; 2019-2020 from data/reference/season-starters-2019-2020.json). A player season qualifies with MIN_STARTS starts in an FBP lineup, and seasons
rank by total starter points, then points per start. A player can hold more than one spot with different
seasons: it recognizes the best seasons, period. One team: QB, RB, RB, WR, WR, TE, FLEX (best RB/WR/TE left), DEF.
Each season also notes every FBP team he started for (in order), whether he won the title that season
(on the champion's roster in the title game), FBP MVP (most starter points that season) and title-game
MVP (the champion's top scorer in the title game).

build_reference.py calls apply(d), which adds d['all_time_team'].
"""
import json
from collections import defaultdict
from pathlib import Path

DATA = Path(__file__).resolve().parent.parent / 'data'
SLOTS = ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'DEF']
FLEX = {'RB', 'WR', 'TE'}
MIN_STARTS = 10


def _load(p):
    try:
        return json.loads(Path(p).read_text())
    except Exception:
        return None


def seasons(d):
    po = d.get('playoff_weeks_by_year') or {}
    done = [int(y) for y in (d.get('championships') or {})]
    rows = []
    for y in sorted(done):
        wr = (_load(DATA / 'history' / str(y) / 'weeklyResults.json') or {}).get('weeks') or {}
        pl = (_load(DATA / 'history' / str(y) / 'players.json') or {}).get('players') or {}
        if isinstance(pl, list):
            pl = {p['id']: p for p in pl}
        first_po = min(po.get(str(y)) or [15])
        tot, st, byt, first = defaultdict(float), defaultdict(int), defaultdict(float), {}
        for w, frs in sorted(wr.items(), key=lambda x: int(x[0])):
            if int(w) >= first_po:
                continue
            for fr, t in frs.items():
                for pid, pts in t.get('s', []):
                    tot[pid] += pts; st[pid] += 1; byt[(pid, fr)] += pts
                    first.setdefault((pid, fr), int(w))
        mvp = max(tot, key=lambda p: tot[p]) if tot else None
        ch = (d.get('championships') or {}).get(str(y)) or {}
        cw = (wr.get(str(ch.get('week'))) or {}).get(ch.get('champion')) or {}
        champ_ids = {pid for lst in ('s', 'n') for pid, _ in cw.get(lst, [])}
        title_mvp = max(cw.get('s', []), key=lambda x: x[1])[0] if cw.get('s') else None
        for pid in tot:
            i = pl.get(pid) or {}
            if isinstance(i, list):
                i = {'name': i[0], 'position': i[1], 'team': i[2] if len(i) > 2 else ''}
            pos = 'DEF' if i.get('position') == 'Def' else i.get('position', '')
            team = max((v, fr) for (p, fr), v in byt.items() if p == pid)[1]
            teams = [fr for (p, fr), _ in sorted(((k, v) for k, v in first.items() if k[0] == pid), key=lambda x: x[1])]
            rows.append({'id': pid, 'name': i.get('name', pid), 'pos': pos, 'nfl': i.get('team', ''), 'year': y,
                         'team': team, 'teams': teams, 'pts': round(tot[pid], 1), 'starts': st[pid],
                         'ppg': round(tot[pid] / st[pid], 1), 'champ': pid in champ_ids,
                         'champTeam': ch.get('champion') if pid in champ_ids else None,
                         'mvp': pid == mvp, 'titleMvp': pid == title_mvp,
                         'titlePts': next((x[1] for x in cw.get('s', []) if x[0] == pid), None) if pid == title_mvp else None})
    # seasons before the saved weekly results (2019-2020): frozen starter totals
    have = {r['year'] for r in rows}
    old = (_load(DATA / 'reference' / 'season-starters-2019-2020.json') or {}).get('seasons') or {}
    for y, lst in old.items():
        if int(y) in have:
            continue
        ch = ((d.get('championships') or {}).get(y) or {}).get('champion')
        for r in lst:
            rows.append(dict(r, year=int(y), ppg=round(r['pts'] / r['starts'], 1), champTeam=ch if r['champ'] else None,
                             titleMvp=r.get('titlePts') is not None))
    return rows


def apply(d):
    links = (_load(DATA / 'player-links.json') or {}).get('links') or {}
    rows = [r for r in seasons(d) if r['starts'] >= MIN_STARTS and r['pos']]
    for r in rows:   # ESPN id (headshot) and display name when the player is linked
        l = links.get(r['id']) or []
        r['espn'] = (l[0] if l and r['pos'] != 'DEF' else '') or ''
        if len(l) > 2 and l[2]:
            r['name'] = l[2]
    rows.sort(key=lambda r: (-r['pts'], -r['ppg']))
    used, team = set(), []
    for slot in SLOTS:
        ok = FLEX if slot == 'FLEX' else {slot}
        r = next((r for r in rows if (r['id'], r['year']) not in used and r['pos'] in ok), None)
        if r:
            used.add((r['id'], r['year'])); team.append(dict(r, slot=slot))
    years = sorted({int(y) for y in (d.get('championships') or {})})
    d['all_time_team'] = {'team': team, 'minStarts': MIN_STARTS,
                          'years': [years[0], years[-1]] if years else [], 'inducted': 2026}
    return d
