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
        saved = json.load(open(path))
        if 'espn_id' not in saved.get('fields', []):   # older format without ESPN ids: refetch now
            return True
        stamp = saved.get('fetched', '')
        return datetime.now(timezone.utc) - datetime.fromisoformat(stamp) > timedelta(days=days) - timedelta(hours=2)
    except Exception:
        return True


as_list = lambda x: x if isinstance(x, list) else ([x] if x else [])


def played_weeks():
    """Weeks with final scores, from the schedule just saved."""
    try:
        sched = json.load(open(os.path.join(OUT, 'schedule.json')))['schedule']
    except Exception:
        return []
    out = []
    for wk in as_list(sched.get('weeklySchedule')):
        fs = [f for m in as_list(wk.get('matchup')) for f in as_list(m.get('franchise'))]
        if fs and all(f.get('score') not in (None, '') for f in fs):
            out.append(int(wk['week']))
    return sorted(out)


def fetch_weekly():
    """Player scores for every played week, starters and bench, for the Awards page.
    Saved compactly: weeks -> franchise -> {s: [[player, points], ...] starters, n: bench}."""
    path = os.path.join(OUT, 'weeklyResults.json')
    try:
        saved = json.load(open(path))
    except Exception:
        saved = {'weeks': {}}
    weeks = played_weeks()
    for w in weeks:
        try:
            raw = fetch('weeklyResults', {'W': str(w)}).get('weeklyResults', {})
            teams = [f for m in as_list(raw.get('matchup')) for f in as_list(m.get('franchise'))] + as_list(raw.get('franchise'))
            wk = {}
            for f in teams:
                st, bn = [], []
                for pl in as_list(f.get('player')):
                    sc = pl.get('score')
                    pts = float(sc) if sc not in (None, '') else 0.0
                    (st if pl.get('status') == 'starter' else bn).append([pl.get('id'), round(pts, 2)])
                wk[f['id']] = {'s': st, 'n': bn, 'opt': f.get('opt_pts')}
            if wk:
                saved['weeks'][str(w)] = wk
            print(f'  ok   weeklyResults week {w} ({len(wk)} teams)')
        except Exception as e:
            print(f'  FAIL {e}  (kept week {w} from before, if any)')
        time.sleep(1.1)
    saved['fetched'] = datetime.now(timezone.utc).isoformat(timespec='seconds')
    save('weeklyResults', saved)


def fetch_player_scores():
    """Weekly scores for every player taken in an FBP rookie draft, taxi squad included (MFL's weekly
    results leave the taxi squad out). Feeds the franchise pages' rookie draft history (pick_tenure.py)."""
    try:
        ref = json.load(open(os.path.join(os.path.dirname(OUT), 'reference.json')))
        ids = sorted({str(p['player_id']) for v in ref.get('franchise_draft_picks', {}).values() for p in v if p.get('player_id')})
    except Exception:
        ids = []
    if not ids:
        print('  skip playerScores (no draft picks known yet)')
        return
    path = os.path.join(OUT, 'playerScores.json')
    try:
        saved = json.load(open(path))
    except Exception:
        saved = {'weeks': {}}
    for w in played_weeks():
        try:
            raw = fetch('playerScores', {'W': str(w), 'PLAYERS': ','.join(ids)}).get('playerScores', {})
            wk = {x['id']: float(x['score']) for x in as_list(raw.get('playerScore')) if x.get('score') not in (None, '') and float(x['score'])}
            saved['weeks'][str(w)] = wk
            print(f'  ok   playerScores week {w} ({len(wk)} drafted players scored)')
        except Exception as e:
            print(f'  FAIL {e}  (kept week {w} from before, if any)')
        time.sleep(1.1)
    saved['fetched'] = datetime.now(timezone.utc).isoformat(timespec='seconds')
    save('playerScores', saved)


def fetch_transactions():
    """This season's trades, waiver claims and free-agent pickups (Awards page)."""
    keep = {'TRADE', 'BBID_WAIVER', 'WAIVER', 'FREE_AGENT'}
    try:
        raw = fetch('transactions').get('transactions', {})
        tx = [t for t in as_list(raw.get('transaction')) if t.get('type') in keep]
        save('transactions', {'fetched': datetime.now(timezone.utc).isoformat(timespec='seconds'), 'transactions': tx})
        print(f'  ok   transactions ({len(tx)} trades and pickups)')
    except Exception as e:
        print(f'  FAIL {e}  (kept the previous file)')
    time.sleep(1.1)


def compact_auction_bids(init, bids, won):
    """Turn MFL's auction log into one line per auction for data/auction-bids.json:
    "player:nominator:winner:price:number of bids:last six bids (team-amount, oldest first)".
    Bids logged in the same second are put in order by amount."""
    rows = []
    for kind, lst in (('I', init), ('B', bids), ('W', won)):
        for t in lst:
            p, amt = (t.get('transaction', '') + '||').split('|')[:2]
            rows.append((int(t['timestamp']), 'IBW'.index(kind), kind, p, int(t['franchise']), int(amt or 0)))
    rows.sort(key=lambda r: (r[0], r[1]))
    open_, done = {}, []
    for ts, _, kind, p, fr, amt in rows:
        if kind == 'I':
            open_[p] = {'p': p, 'nom': fr, 'b': [(fr, amt)]}
        elif kind == 'B':
            open_.setdefault(p, {'p': p, 'nom': 0, 'b': []})['b'].append((fr, amt))
        else:
            o = open_.pop(p, {'p': p, 'nom': 0, 'b': []})
            o['win'] = (fr, amt)
            done.append(o)
    out = []
    for o in done:
        b = [x for _, x in sorted(enumerate(o['b']), key=lambda e: (e[1][1], e[0]))]
        last = ','.join(f'{f}-{a}' for f, a in b[-6:])
        out.append(':'.join(str(v) for v in (o['p'], o['nom'], o['win'][0], o['win'][1], len(b), last)))
    return out


def fetch_auction_bids():
    """This season's auction bid log (Reference > Seasons > Auction twirl-downs). Past seasons stay as saved."""
    path = os.path.join(ROOT, 'data', 'auction-bids.json')
    try:
        logs = {}
        for t in ('AUCTION_INIT', 'AUCTION_BID', 'AUCTION_WON'):
            logs[t] = as_list(fetch('transactions', {'TRANS_TYPE': t}).get('transactions', {}).get('transaction'))
            time.sleep(1.1)
        lines = compact_auction_bids(logs['AUCTION_INIT'], logs['AUCTION_BID'], logs['AUCTION_WON'])
        saved = json.load(open(path)) if os.path.exists(path) else {}
        before = len([x for x in saved.get(SEASON, '').split(';') if x])
        if len(lines) >= before and lines:
            saved[SEASON] = ';'.join(lines)
            with open(path, 'w') as f:
                json.dump(saved, f, separators=(',', ':'))
                f.write('\n')
            print(f'  ok   auction bids ({len(lines)} auctions)')
        else:
            print(f'  skip auction bids ({len(lines)} auctions found, {before} already saved)')
    except Exception as e:
        print(f'  FAIL {e}  (kept the previous file)')


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
    fetch_weekly()
    fetch_player_scores()
    fetch_transactions()
    fetch_auction_bids()
    save('_meta', {'season': SEASON, 'league': LEAGUE,
                   'fetched': datetime.now(timezone.utc).isoformat(timespec='seconds')})
    if failed_core:
        sys.exit(f'Core data failed: {", ".join(failed_core)}')


if __name__ == '__main__':
    main()
