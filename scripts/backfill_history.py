#!/usr/bin/env python3
"""One-time pull of past seasons from MFL for the Awards history (2019 on, the PPR era).

Saves, per season, under data/history/<year>/:
  weeklyResults.json  starters and bench with scores, every week (same compact format as data/mfl)
  transactions.json   trades (with what each side gave up), waiver claims, free-agent pickups
  rosters.json        end-of-season rosters: salary and contract for each player
  league.json         league settings (starting lineup for that year)
  players.json        name, position, NFL team, draft year for every player in the files above

Runs from the "Backfill history" GitHub Action (workflow_dispatch). Past seasons don't change,
so this only needs to run once; it is not part of the weekly refresh.

Environment:
  MFL_APIKEY   repo secret; never printed or saved
  YEARS        default "2019 2020 2021 2022 2023 2024 2025"
Standard library only.
"""
import json, os, time, urllib.parse, urllib.request
from datetime import datetime, timezone

LEAGUE = '14482'
HOST = os.environ.get('MFL_HOST', 'www47.myfantasyleague.com')
KEY = os.environ.get('MFL_APIKEY', '').strip()
YEARS = os.environ.get('YEARS', '2019 2020 2021 2022 2023 2024 2025').split()
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
as_list = lambda x: x if isinstance(x, list) else ([x] if x else [])
KEEP_TX = {'TRADE', 'BBID_WAIVER', 'WAIVER', 'FREE_AGENT'}


def fetch(year, type_, extra=None, host=None):
    """MFL API keys are issued per season, so a past season may refuse this year's key:
    try with the key, then without it (the league's past seasons are public), on two hosts."""
    errors = []
    for h in ([host] if host else ['api.myfantasyleague.com', HOST]):
        for use_key in ([True, False] if KEY else [False]):
            params = {'TYPE': type_, 'L': LEAGUE, 'JSON': '1'}
            if extra:
                params.update(extra)
            if use_key:
                params['APIKEY'] = KEY
            url = f'https://{h}/{year}/export?' + urllib.parse.urlencode(params)
            try:
                req = urllib.request.Request(url, headers={'User-Agent': 'FBP-site-backfill/1.0'})
                with urllib.request.urlopen(req, timeout=60) as r:
                    data = json.loads(r.read().decode('utf-8'))
                if isinstance(data, dict) and 'error' in data:
                    raise RuntimeError(str(data['error'])[:200])
                return data
            except Exception as e:  # the message never includes the URL, so the key stays private
                errors.append(f'{h} {"key" if use_key else "no key"}: {type(e).__name__}: {str(e)[:160]}')
                time.sleep(2)
    raise RuntimeError(f'{year} {type_} failed: ' + ' | '.join(errors))


def save(year, name, data):
    d = os.path.join(ROOT, 'data', 'history', year)
    os.makedirs(d, exist_ok=True)
    with open(os.path.join(d, name + '.json'), 'w') as f:
        json.dump(data, f, indent=1, ensure_ascii=False, sort_keys=True)
        f.write('\n')


def season(year):
    stamp = datetime.now(timezone.utc).isoformat(timespec='seconds')
    ids = set()
    league = fetch(year, 'league').get('league', {})
    save(year, 'league', {'fetched': stamp, 'league': league})
    last = int(league.get('lastRegularSeasonWeek') or 14) + 3   # regular season plus a 3-week playoff
    time.sleep(1.1)

    weeks = {}
    for w in range(1, last + 1):
        try:
            raw = fetch(year, 'weeklyResults', {'W': str(w)}).get('weeklyResults', {})
        except Exception as e:
            print(f'  FAIL {e}')
            time.sleep(1.1)
            continue
        teams = [f for m in as_list(raw.get('matchup')) for f in as_list(m.get('franchise'))] + as_list(raw.get('franchise'))
        wk = {}
        for f in teams:
            st, bn = [], []
            for pl in as_list(f.get('player')):
                sc = pl.get('score')
                pts = float(sc) if sc not in (None, '') else 0.0
                (st if pl.get('status') == 'starter' else bn).append([pl.get('id'), round(pts, 2)])
                ids.add(pl.get('id'))
            wk[f['id']] = {'s': st, 'n': bn, 'opt': f.get('opt_pts'), 'score': f.get('score')}
        if wk:
            weeks[str(w)] = wk
        time.sleep(1.1)
    save(year, 'weeklyResults', {'fetched': stamp, 'lastRegularSeasonWeek': last - 3, 'weeks': weeks})
    print(f'  ok   {year} weeklyResults ({len(weeks)} weeks)')

    tx = [t for t in as_list(fetch(year, 'transactions').get('transactions', {}).get('transaction')) if t.get('type') in KEEP_TX]
    for t in tx:
        for k in ('transaction', 'franchise1_gave_up', 'franchise2_gave_up'):
            ids.update(x for x in (t.get(k) or '').replace('|', ',').split(',') if x.strip().isdigit())
    save(year, 'transactions', {'fetched': stamp, 'transactions': tx})
    print(f'  ok   {year} transactions ({len(tx)})')
    time.sleep(1.1)

    rosters = fetch(year, 'rosters').get('rosters', {})
    for f in as_list(rosters.get('franchise')):
        ids.update(p['id'] for p in as_list(f.get('player')))
    save(year, 'rosters', {'fetched': stamp, 'rosters': rosters})
    print(f'  ok   {year} rosters')
    time.sleep(1.1)

    plist = fetch(year, 'players', {'DETAILS': '1'}, host='api.myfantasyleague.com').get('players', {}).get('player', [])
    fields = ['name', 'position', 'team', 'draft_year', 'espn_id']
    keep = {p['id']: [p.get(f, '') for f in fields] for p in plist if p['id'] in ids}
    save(year, 'players', {'fetched': stamp, 'fields': fields, 'players': keep})
    print(f'  ok   {year} players ({len(keep)} of {len(ids)} ids)')
    time.sleep(1.1)


def main():
    print(f'Seasons {" ".join(YEARS)}, league {LEAGUE}, API key {"set" if KEY else "not set"}')
    failed, log = [], {}
    for y in YEARS:
        try:
            season(y)
            log[y] = 'ok'
        except Exception as e:
            print(f'  FAIL {e}')
            failed.append(y)
            log[y] = str(e)[:600]
    os.makedirs(os.path.join(ROOT, 'data', 'history'), exist_ok=True)
    with open(os.path.join(ROOT, 'data', 'history', '_log.json'), 'w') as f:   # so a failed run can be read from the repo
        json.dump({'ran': datetime.now(timezone.utc).isoformat(timespec='seconds'), 'seasons': log}, f, indent=1)
    if failed:
        print('Seasons with errors:', ' '.join(failed))


if __name__ == '__main__':
    main()
