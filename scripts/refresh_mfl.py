#!/usr/bin/env python3
"""Fetch FBP league data from MyFantasyLeague and save it under data/mfl/.

Runs in the weekly GitHub Action (see .github/workflows/refresh-data.yml).
MFL blocks cross-site browser requests, so the site reads these saved files
instead of calling MFL directly.

Environment:
  MFL_APIKEY   optional; read from the repo secret. Never printed or saved.
  MFL_SEASON   season year in MFL's URL (default 2026).
  MFL_HOST     default www47.myfantasyleague.com
Standard library only.
"""
import json, os, sys, time, urllib.parse, urllib.request
from datetime import datetime, timezone, timedelta

LEAGUE = '14482'
SEASON = os.environ.get('MFL_SEASON', '2026')
HOST = os.environ.get('MFL_HOST', 'www47.myfantasyleague.com')
KEY = os.environ.get('MFL_APIKEY', '').strip()
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'data', 'mfl')

CORE = ['league', 'leagueStandings', 'schedule']           # must succeed
EXTRA = ['rosters', 'futureDraftPicks', 'auctionResults', 'draftResults']
PLAYER_POS = {'QB', 'RB', 'WR', 'TE', 'Def'}


def fetch(type_, extra=None, host=None):
    params = {'TYPE': type_, 'L': LEAGUE, 'JSON': '1'}
    if extra:
        params.update(extra)
    if KEY:
        params['APIKEY'] = KEY
    url = f'https://{host or HOST}/{SEASON}/export?' + urllib.parse.urlencode(params)
    last = None
    for attempt in range(2):
        try:
            req = urllib.request.Request(url, headers={'User-Agent': 'FBP-site-refresh/1.0'})
            with urllib.request.urlopen(req, timeout=60) as r:
                data = json.loads(r.read().decode('utf-8'))
            if isinstance(data, dict) and 'error' in data:
                raise RuntimeError(str(data['error'])[:200])
            return data
        except Exception as e:  # message never includes the URL, so the key stays private
            last = f'{type(e).__name__}: {str(e)[:200]}'
            time.sleep(3)
    raise RuntimeError(f'{type_} failed ({last})')


def save(name, data):
    with open(os.path.join(OUT, name + '.json'), 'w') as f:
        json.dump(data, f, indent=1, ensure_ascii=False, sort_keys=True)
        f.write('\n')


def players_stale(days=1):
    path = os.path.join(OUT, 'players.json')
    try:
        stamp = json.load(open(path)).get('fetched', '')
        return datetime.now(timezone.utc) - datetime.fromisoformat(stamp) > timedelta(days=days) - timedelta(hours=2)
    except Exception:
        return True


def main():
    os.makedirs(OUT, exist_ok=True)
    print(f'Season {SEASON}, league {LEAGUE}, API key {"set" if KEY else "not set"}')
    failed_core = []
    for t in CORE + EXTRA:
        try:
            save(t, fetch(t))
            print(f'  ok   {t}')
        except Exception as e:
            print(f'  FAIL {e}  (kept the previous file)')
            if t in CORE:
                failed_core.append(t)
        time.sleep(1.1)
    if players_stale():
        # MFL serves the player list only from api.myfantasyleague.com. DETAILS=1 adds the
        # ESPN id (player photos), the SportsData id, NFL draft slot, college and birthdate.
        try:
            raw = fetch('players', {'DETAILS': '1'}, host='api.myfantasyleague.com')
            plist = raw.get('players', {}).get('player', [])
            fields = ['name', 'position', 'team', 'espn_id', 'sportsdata_id', 'draft_year',
                      'draft_round', 'draft_pick', 'college', 'birthdate']
            compact = {p['id']: [p.get(f, '') for f in fields]
                       for p in plist if p.get('position') in PLAYER_POS}
            save('players', {'fetched': datetime.now(timezone.utc).isoformat(timespec='seconds'),
                             'fields': fields, 'players': compact})
            print(f'  ok   players ({len(compact)} kept, '
                  f'{sum(1 for v in compact.values() if v[3])} with ESPN ids)')
        except Exception as e:
            print(f'  FAIL {e}  (kept the previous file)')
    save('_meta', {'season': SEASON, 'league': LEAGUE,
                   'fetched': datetime.now(timezone.utc).isoformat(timespec='seconds')})
    if failed_core:
        sys.exit(f'Core data failed: {", ".join(failed_core)}')


if __name__ == '__main__':
    main()
