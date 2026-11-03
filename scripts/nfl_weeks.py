"""Which NFL weeks are over: every game of the week final on ESPN's scoreboard.

The refresh now runs daily (after MFL's morning waivers), so it can land in the middle of a week: after Thursday
night, or on a Sunday morning with the international game on. MFL can show a score for a matchup before the week
is over, so the scripts that count a week as played (refresh_mfl.py's weekly results, league_now.py's standings,
odds and eliminations) also require the NFL week to be over.

data/nfl-final-weeks.json caches the answer ({"season": "2026", "final": [1, 2, ...]}); a week is only checked
until it's final. If ESPN can't be reached, final_weeks() returns None and callers keep their old behavior.
"""
import json, os, urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CACHE = os.path.join(ROOT, 'data', 'nfl-final-weeks.json')
URL = 'https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?seasontype=2&week={w}&dates={y}'


def _week_over(season, w):
    req = urllib.request.Request(URL.format(w=w, y=season), headers={'User-Agent': 'FBP league site (weekly refresh)'})
    with urllib.request.urlopen(req, timeout=30) as r:
        events = json.load(r).get('events') or []
    return bool(events) and all(((e.get('status') or {}).get('type') or {}).get('state') == 'post' for e in events)


def cached(season):
    """The saved final weeks for this season (no network), or None."""
    try:
        c = json.load(open(CACHE))
        return set(c.get('final') or []) if str(c.get('season')) == str(season) else None
    except Exception:
        return None


def final_weeks(season, through):
    """Weeks 1..through whose NFL games are all final. None if ESPN couldn't be checked."""
    done = cached(season) or set()
    try:
        for w in range(1, int(through) + 1):
            if w not in done and _week_over(season, w):
                done.add(w)
    except Exception as e:
        print(f'  nfl_weeks: ESPN check failed ({type(e).__name__}); counting weeks by MFL scores alone')
        return None
    json.dump({'season': str(season), 'final': sorted(done)}, open(CACHE, 'w'))
    return done
