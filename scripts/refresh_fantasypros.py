#!/usr/bin/env python3
"""Fetch FantasyPros consensus rankings and save what the site uses under data/fantasypros/.

Runs in the daily GitHub Action. Needs the repo secret FANTASYPROS_APIKEY (a FantasyPros HOF key: full lists;
the free key only returns 10 players). The key is sent as the x-api-key header and is never printed or saved.
Docs: https://api.fantasypros.com/public/v2/docs

FantasyPros' terms don't allow redistributing their raw data, and this repo is public, so the raw responses are
not saved. What is saved is each list as ranks keyed by MFL player id, which is all the site needs:
  dynasty-ecr.json  dynasty overall (PPR): {mfl_id: [overall rank, position rank, tier]}   Player Value, Rankings
  ros-ecr.json      rest of season overall (PPR): same shape                          Rosters ECR column, Trend
  rookies-ecr.json  next year's rookie class: same shape                              (rookie pricing, Big Board)
FantasyPros ids are matched to MFL ids with their own player list (external_ids=mfl). A list that fails or comes
back short keeps the previous file, noted in _meta.json; the script never fails the workflow. Standard library only.
"""
import json, os, re, time, urllib.error, urllib.parse, urllib.request
from datetime import datetime, timezone

KEY = os.environ.get('FANTASYPROS_APIKEY', '').strip()
SEASON = int(os.environ.get('MFL_SEASON', '2026'))
BASE = 'https://api.fantasypros.com/public/v2/json'
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'data', 'fantasypros')

# file -> (path, params, note)
LISTS = {
    'dynasty-ecr': (f'/nfl/{SEASON}/consensus-rankings', {'position': 'ALL', 'type': 'DYNASTY', 'scoring': 'PPR'},
                    'FantasyPros dynasty consensus rankings (overall, PPR)'),
    'ros-ecr': (f'/nfl/{SEASON}/consensus-rankings', {'position': 'ALL', 'type': 'ROS', 'scoring': 'PPR'},
                'FantasyPros rest-of-season consensus rankings (overall, PPR)'),
    'rookies-ecr': (f'/nfl/{SEASON + 1}/consensus-rankings', {'position': 'ALL', 'type': 'ROOKIES', 'scoring': 'PPR'},
                    f'FantasyPros {SEASON + 1} rookie consensus rankings (PPR)'),
}


def fetch(path, params):
    url = BASE + path + ('?' + urllib.parse.urlencode(params) if params else '')
    req = urllib.request.Request(url, headers={'x-api-key': KEY, 'Accept': 'application/json', 'User-Agent': 'FBP-site-refresh/1.0'})
    with urllib.request.urlopen(req, timeout=90) as r:
        return json.loads(r.read().decode('utf-8'))


def main():
    os.makedirs(OUT, exist_ok=True)
    meta_path = os.path.join(OUT, '_meta.json')
    meta = {'run': datetime.now(timezone.utc).isoformat(timespec='seconds'), 'results': {}}
    if not KEY:
        print('FANTASYPROS_APIKEY not set; skipping')
        meta['note'] = 'API key not set'
        json.dump(meta, open(meta_path, 'w'), indent=1)
        return
    try:
        pl = fetch('/nfl/players', {'external_ids': 'mfl'}).get('players') or []
        ids = {str(p['player_id']): str(p['mfl_id']) for p in pl if p.get('mfl_id')}
        meta['results']['players'] = {'ok': True, 'matched': len(ids)}
        print(f'  ok   players: {len(ids)} with MFL ids')
    except Exception as e:  # the message never includes the key
        print(f'  FAIL players: {type(e).__name__}: {str(e)[:200]}')
        meta['results']['players'] = {'ok': False, 'error': f'{type(e).__name__}: {str(e)[:200]}'}
        json.dump(meta, open(meta_path, 'w'), indent=1)
        return
    for name, (path, params, note) in LISTS.items():
        time.sleep(1.1)
        try:
            d = fetch(path, params)
            rows = d.get('players') or []
            out = {}
            for p in rows:
                m = ids.get(str(p.get('player_id')))
                if m and p.get('rank_ecr'):
                    pr = re.sub(r'\D', '', str(p.get('pos_rank') or ''))
                    out[m] = [int(p['rank_ecr']), int(pr) if pr else None, p.get('tier')]
            if len(rows) < 50:   # the free key's 10-row lists, or a bad answer: keep what we had
                raise ValueError(f'only {len(rows)} players came back')
            upd = d.get('last_updated') or ''
            mm, dd = (upd.split('/') + [''])[:2]
            when = f'{SEASON if int(mm or 1) >= 3 else SEASON + 1}-{int(mm):02d}-{int(dd):02d}' if mm and dd else meta['run'][:10]
            json.dump({'note': f'{note}, matched to MFL ids: [overall rank, position rank, tier]. From the FantasyPros API (data © FantasyPros).',
                       'updated': when, 'experts': d.get('total_experts'), 'players': dict(sorted(out.items(), key=lambda x: x[1][0]))},
                      open(os.path.join(OUT, name + '.json'), 'w'), separators=(',', ':'), ensure_ascii=False)
            meta['results'][name] = {'ok': True, 'players': len(rows), 'matched': len(out), 'updated': when}
            print(f'  ok   {name}: {len(rows)} ranked, {len(out)} matched to MFL')
        except Exception as e:
            meta['results'][name] = {'ok': False, 'error': f'{type(e).__name__}: {str(e)[:200]}'}
            print(f'  FAIL {name}: {meta["results"][name]["error"]}')
    json.dump(meta, open(meta_path, 'w'), indent=1)


if __name__ == '__main__':
    main()
