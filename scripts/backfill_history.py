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
  MFL_APIKEY        repo secret; never printed or saved
  MFL_APIKEY_<year> optional per-season keys (MFL issues keys per season)
  YEARS        default "2019 2020 2021 2022 2023 2024 2025"
Standard library only.
"""
import json, os, time, urllib.error, urllib.parse, urllib.request
from datetime import datetime, timezone

LEAGUE = '14482'
HOST = os.environ.get('MFL_HOST', 'www47.myfantasyleague.com')
KEY = os.environ.get('MFL_APIKEY', '').strip()
YEARS = os.environ.get('YEARS', '2019 2020 2021 2022 2023 2024 2025').split()
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
as_list = lambda x: x if isinstance(x, list) else ([x] if x else [])
KEEP_TX = {'TRADE', 'BBID_WAIVER', 'WAIVER', 'FREE_AGENT'}
PAUSE = 3.0          # seconds between calls; MFL answers 429 (too many requests) when called faster
LOG = {}


def key_for(year):
    """MFL API keys are issued per season: MFL_APIKEY_<year> if that secret exists, else this season's key."""
    return os.environ.get(f'MFL_APIKEY_{year}', '').strip() or KEY


def fetch(year, type_, extra=None, host=None):
    """Try without a key first (most past-season data is public), then with the season's key.
    A 429 waits a minute and tries again."""
    errors = []
    k = key_for(year)
    for h in ([host] if host else [HOST, 'api.myfantasyleague.com']):
        for use_key in ([False, True] if k else [False]):
            params = {'TYPE': type_, 'L': LEAGUE, 'JSON': '1'}
            if extra:
                params.update(extra)
            if use_key:
                params['APIKEY'] = k
            url = f'https://{h}/{year}/export?' + urllib.parse.urlencode(params)
            for attempt in range(3):
                time.sleep(PAUSE)
                try:
                    req = urllib.request.Request(url, headers={'User-Agent': 'FBP-site-backfill/1.0'})
                    with urllib.request.urlopen(req, timeout=60) as r:
                        data = json.loads(r.read().decode('utf-8'))
                    if isinstance(data, dict) and 'error' in data:
                        raise RuntimeError(str(data['error'])[:200])
                    return data
                except urllib.error.HTTPError as e:   # the message never includes the URL, so the key stays private
                    errors.append(f'{h} {"key" if use_key else "no key"}: HTTP {e.code}')
                    if e.code == 429:
                        time.sleep(60)
                        continue
                    break
                except Exception as e:
                    errors.append(f'{h} {"key" if use_key else "no key"}: {type(e).__name__}: {str(e)[:160]}')
                    break
    raise RuntimeError(f'{type_}: ' + ' | '.join(errors[-4:]))


def path(year, name):
    return os.path.join(ROOT, 'data', 'history', year, name + '.json')


def saved(year, name):
    try:
        return json.load(open(path(year, name)))
    except Exception:
        return None


def save(year, name, data):
    os.makedirs(os.path.dirname(path(year, name)), exist_ok=True)
    with open(path(year, name), 'w') as f:
        json.dump(data, f, indent=1, ensure_ascii=False, sort_keys=True)
        f.write('\n')


def part(year, name, fn):
    """Run one piece; a failure is logged and the rest of the season still runs."""
    try:
        msg = fn()
        LOG.setdefault(year, {})[name] = msg or 'ok'
        print(f'  ok   {year} {name} {msg or ""}')
    except Exception as e:
        LOG.setdefault(year, {})[name] = str(e)[:400]
        print(f'  FAIL {year} {name} {str(e)[:300]}')


def season(year):
    """Resumable: pieces already saved are kept, and only missing weeks are fetched."""
    stamp = datetime.now(timezone.utc).isoformat(timespec='seconds')

    def league():
        if not saved(year, 'league'):
            save(year, 'league', {'fetched': stamp, 'league': fetch(year, 'league').get('league', {})})
    part(year, 'league', league)
    lg = (saved(year, 'league') or {}).get('league', {})
    reg = int(lg.get('lastRegularSeasonWeek') or 14)

    def weekly():
        wr = saved(year, 'weeklyResults') or {}
        weeks = wr.get('weeks') or {}
        missing = []
        for w in range(1, reg + 4):   # regular season plus a 3-week playoff
            if str(w) in weeks:
                continue
            try:
                raw = fetch(year, 'weeklyResults', {'W': str(w)}).get('weeklyResults', {})
            except Exception as e:
                missing.append(f'{w} ({str(e)[:120]})')
                continue
            teams = [f for m in as_list(raw.get('matchup')) for f in as_list(m.get('franchise'))] + as_list(raw.get('franchise'))
            wk = {}
            for f in teams:
                st, bn = [], []
                for pl in as_list(f.get('player')):
                    sc = pl.get('score')
                    pts = float(sc) if sc not in (None, '') else 0.0
                    (st if pl.get('status') == 'starter' else bn).append([pl.get('id'), round(pts, 2)])
                wk[f['id']] = {'s': st, 'n': bn, 'opt': f.get('opt_pts'), 'score': f.get('score')}
            if wk:
                weeks[str(w)] = wk
            else:
                missing.append(f'{w} (empty)')
        save(year, 'weeklyResults', {'fetched': stamp, 'lastRegularSeasonWeek': reg, 'weeks': weeks})
        if missing:
            raise RuntimeError(f'{len(weeks)} weeks saved; missing ' + '; '.join(missing)[:300])
        return f'({len(weeks)} weeks)'
    part(year, 'weeklyResults', weekly)

    def transactions():
        if saved(year, 'transactions'):
            return 'kept'
        tx = [t for t in as_list(fetch(year, 'transactions').get('transactions', {}).get('transaction')) if t.get('type') in KEEP_TX]
        save(year, 'transactions', {'fetched': stamp, 'transactions': tx})
        return f'({len(tx)})'
    part(year, 'transactions', transactions)

    def rosters():
        if saved(year, 'rosters'):
            return 'kept'
        save(year, 'rosters', {'fetched': stamp, 'rosters': fetch(year, 'rosters').get('rosters', {})})
    part(year, 'rosters', rosters)

    def players():
        ids = set()
        for w in ((saved(year, 'weeklyResults') or {}).get('weeks') or {}).values():
            for t in w.values():
                ids.update(p for p, _ in t['s'] + t['n'])
        for t in (saved(year, 'transactions') or {}).get('transactions', []):
            for k in ('transaction', 'franchise1_gave_up', 'franchise2_gave_up'):
                ids.update(x for x in (t.get(k) or '').replace('|', ',').split(',') if x.strip().isdigit())
        for f in as_list(((saved(year, 'rosters') or {}).get('rosters') or {}).get('franchise')):
            ids.update(p['id'] for p in as_list(f.get('player')))
        have = (saved(year, 'players') or {}).get('players') or {}
        if ids and ids <= set(have):
            return 'kept'
        plist = fetch(year, 'players', {'DETAILS': '1'}, host='api.myfantasyleague.com').get('players', {}).get('player', [])
        fields = ['name', 'position', 'team', 'draft_year', 'espn_id']
        keep = {p['id']: [p.get(f, '') for f in fields] for p in plist if p['id'] in ids}
        save(year, 'players', {'fetched': stamp, 'fields': fields, 'players': keep})
        return f'({len(keep)} of {len(ids)} ids)'
    part(year, 'players', players)


def main():
    print(f'Seasons {" ".join(YEARS)}, league {LEAGUE}, API key {"set" if KEY else "not set"}')
    for y in YEARS:
        season(y)
    os.makedirs(os.path.join(ROOT, 'data', 'history'), exist_ok=True)
    with open(os.path.join(ROOT, 'data', 'history', '_log.json'), 'w') as f:   # so a run can be checked from the repo
        json.dump({'ran': datetime.now(timezone.utc).isoformat(timespec='seconds'), 'seasons': LOG}, f, indent=1)


if __name__ == '__main__':
    main()
