"""What each rookie pick gave the team that drafted it, on his rookie deal.

The rookie-deal stint runs from the draft until the player first leaves the drafting team:
  traded         - a trade sent him away
  cut-in-season  - dropped during the season (a free-agent or waiver move)
  cut-offseason  - dropped between seasons
  cut-keeper     - not kept at the keeper deadline (no transaction; he just isn't on the next roster)
  contract-ended - his rookie contract ran out
A later return (re-acquired by trade, waivers or the auction) is a new contract and doesn't count.

Points are every regular-season point he scored in the stint, taxi squad and bench included:
it measures what the pick produced, not how often he started.

build_reference.py calls apply(d). For every pick in franchise_draft_picks it adds
  team_points_by_season: [{year, points, status}] from the draft year to the season he left
      status 'with' (on the team all that season), 'left' (left during that season)
  team_total, stint {reason, year, week} (None while he's still on the team), on_team_now

Scores come from MFL's weekly player scores:
  data/reference/pick-points.json  - frozen per-pick season totals inside each stint (finished seasons)
  data/mfl/playerScores.json       - this season's weekly scores for drafted players (weekly refresh)
"""
import json
from datetime import datetime, timezone
from pathlib import Path

DATA = Path(__file__).resolve().parent.parent / 'data'
# Thursday kickoff of week 1 (UTC dates). A move after the Tuesday of week n means he's gone from week n.
KICKOFF = {2019: '2019-09-05', 2020: '2020-09-10', 2021: '2021-09-09', 2022: '2022-09-08', 2023: '2023-09-07',
           2024: '2024-09-05', 2025: '2025-09-04', 2026: '2026-09-10', 2027: '2027-09-09'}
DAY = 86400


def _load(p):
    try:
        return json.loads(Path(p).read_text())
    except Exception:
        return None


def week_of(ts, year):
    """First week the player no longer counts for, after a move at unix time ts in season `year`
    (1 = before the season started, 99 = after it)."""
    k = datetime.fromisoformat(KICKOFF[year]).replace(tzinfo=timezone.utc).timestamp()
    tue = k - 2 * DAY
    if ts < tue:
        return 1
    return min(99, int((ts - tue) // (7 * DAY)) + 1)


def season_data(year, current):
    base = DATA / 'mfl' if year == current else DATA / 'history' / str(year)
    tx = (_load(base / 'transactions.json') or {}).get('transactions') or []
    ro = ((_load(base / 'rosters.json') or {}).get('rosters') or {}).get('franchise') or []
    return tx, ro


def gave_up(t, fr, pid):
    """How franchise fr let player pid go in transaction t, or None."""
    ty = t.get('type')
    if ty == 'TRADE':
        side = 'franchise1_gave_up' if t.get('franchise') == fr else 'franchise2_gave_up' if t.get('franchise2') == fr else None
        return 'traded' if side and pid in (t.get(side) or '').split(',') else None
    if t.get('franchise') != fr:
        return None
    dropped = (t.get('transaction') or '').split('|')[-1].split(',')
    return 'cut' if pid in dropped else None


def stint(fr, pid, y0, current, cache):
    """When and how the rookie-deal stint ended: {reason, year, week} or None if he's still there."""
    for y in range(y0, current + 1):
        if y not in cache:
            cache[y] = season_data(y, current)
        tx, ro = cache[y]
        moves = sorted((int(t['timestamp']), r) for t in tx for r in [gave_up(t, fr, pid)] if r)
        if moves:
            ts, r = moves[0]
            wk = week_of(ts, y)
            if r == 'traded':
                return {'reason': 'traded', 'year': y, 'week': wk}
            return {'reason': 'cut-offseason' if wk == 1 else 'cut-in-season', 'year': y, 'week': wk}
        mine = next((pl for f in ro if f.get('id') == fr for pl in (f.get('player') or []) if str(pl.get('id')) == pid), None)
        if mine is None and ro:
            # not on the roster and no move on record: let go at the keeper deadline before this season
            prev = cache.get(y - 1, ([], []))[1]
            last = next((pl for f in prev if f.get('id') == fr for pl in (f.get('player') or []) if str(pl.get('id')) == pid), None)
            cy = (last or {}).get('contractYear') or ''
            ended = '/' in cy and cy.split('/')[0] == cy.split('/')[1]
            return {'reason': 'contract-ended' if ended else 'cut-keeper', 'year': y, 'week': 1}
    return None


def apply(d):
    current = int(d['meta']['current_year'])
    frozen = _load(DATA / 'reference' / 'pick-points.json') or {}
    live = (_load(DATA / 'mfl' / 'playerScores.json') or {}).get('weeks') or {}
    po = d.get('playoff_weeks_by_year') or {}
    cache = {}
    for owner, picks in (d.get('franchise_draft_picks') or {}).items():
        for p in picks:
            fr, pid, y0 = p.get('franchise') or owner, str(p.get('player_id') or ''), int(p.get('year') or 0)
            if not (fr and pid and y0):
                continue
            st = stint(fr, pid, y0, current, cache)
            end_y = st['year'] if st else current
            got = frozen.get(f'{fr}|{y0}|{pid}', {})
            seasons, total = [], 0.0
            for y in range(y0, end_y + 1):
                if st and y == st['year'] and st['week'] == 1:
                    break   # gone before this season started
                last_reg = min(po.get(str(y)) or [15]) - 1
                stop = min(st['week'] - 1, last_reg) if st and y == st['year'] else last_reg
                if y == current and live:
                    pts = sum(float((live.get(str(w)) or {}).get(pid, 0)) for w in range(1, stop + 1))
                else:
                    pts = float(got.get(str(y), 0))
                seasons.append({'year': y, 'points': round(pts, 1),
                                'status': 'left' if st and y == st['year'] else 'with'})
                total += pts
            p['team_points_by_season'] = seasons
            p['team_total'] = round(total, 1)
            p['stint'] = st
            p['on_team_now'] = st is None
    return d


def windows(d):
    """Each pick's stint as [key, player, first season, last season, last week counted in that season] (for building pick-points.json)."""
    current = int(d['meta']['current_year'])
    po = d.get('playoff_weeks_by_year') or {}
    cache, out = {}, []
    for owner, picks in (d.get('franchise_draft_picks') or {}).items():
        for p in picks:
            fr, pid, y0 = p.get('franchise') or owner, str(p.get('player_id') or ''), int(p.get('year') or 0)
            if not (fr and pid and y0):
                continue
            st = stint(fr, pid, y0, current, cache)
            if st:
                ey, ew = (st['year'], st['week'] - 1) if st['week'] > 1 else (st['year'] - 1, 99)
            else:
                ey, ew = current, 99
            if ey < y0:
                continue
            last_reg = min(po.get(str(ey)) or [15]) - 1
            out.append([f'{fr}|{y0}|{pid}', pid, y0, ey, min(ew, last_reg)])
    return out
