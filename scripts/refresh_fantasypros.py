#!/usr/bin/env python3
"""Fetch FantasyPros consensus rankings and save them under data/fantasypros/.

Runs in the weekly GitHub Action after the MFL refresh. Needs the repo secret
FANTASYPROS_APIKEY (sent as the x-api-key header; never printed or saved).
Each request is independent: a failure keeps the previous file and is noted in
data/fantasypros/_meta.json, and the script never fails the workflow.
Standard library only.

Docs: https://api.fantasypros.com/public/v2/docs
Superflex rankings use position=OP. Ranking types used: DYNASTY, ROOKIES, ROS.
"""
import json, os, time, urllib.error, urllib.parse, urllib.request
from datetime import datetime, timezone

KEY = os.environ.get('FANTASYPROS_APIKEY', '').strip()
SEASON = int(os.environ.get('MFL_SEASON', '2026'))
BASE = 'https://api.fantasypros.com/public/v2/json'
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'data', 'fantasypros')

# name -> (path, params)
REQUESTS = {
    'dynasty-superflex': (f'/nfl/{SEASON}/consensus-rankings', {'position': 'OP', 'type': 'DYNASTY', 'scoring': 'PPR'}),
    'dynasty-overall':   (f'/nfl/{SEASON}/consensus-rankings', {'position': 'ALL', 'type': 'DYNASTY', 'scoring': 'PPR'}),
    'rookies':           (f'/nfl/{SEASON + 1}/consensus-rankings', {'position': 'ALL', 'type': 'ROOKIES', 'scoring': 'PPR'}),
    'rookies-superflex': (f'/nfl/{SEASON + 1}/consensus-rankings', {'position': 'OP', 'type': 'ROOKIES', 'scoring': 'PPR'}),
    'ros-superflex':     (f'/nfl/{SEASON}/consensus-rankings', {'position': 'OP', 'type': 'ROS', 'scoring': 'PPR'}),
}


def fetch(path, params):
    url = BASE + path + '?' + urllib.parse.urlencode(params)
    req = urllib.request.Request(url, headers={'x-api-key': KEY, 'Accept': 'application/json',
                                               'User-Agent': 'FBP-site-refresh/1.0'})
    with urllib.request.urlopen(req, timeout=60) as r:
        return r.status, json.loads(r.read().decode('utf-8'))


def summarize(data):
    """Row count and the first few names, so the log shows what came back without dumping it."""
    rows = data.get('players') if isinstance(data, dict) else None
    if isinstance(rows, list):
        return {'players': len(rows), 'sample': [p.get('player_name') or p.get('name') for p in rows[:3]]}
    return {'keys': sorted(data)[:12] if isinstance(data, dict) else type(data).__name__}


def main():
    os.makedirs(OUT, exist_ok=True)
    meta_path = os.path.join(OUT, '_meta.json')
    try:
        meta = json.load(open(meta_path))
    except Exception:
        meta = {}
    meta['run'] = datetime.now(timezone.utc).isoformat(timespec='seconds')
    meta.setdefault('results', {})
    if not KEY:
        print('FANTASYPROS_APIKEY not set; skipping')
        meta['note'] = 'API key not set'
        json.dump(meta, open(meta_path, 'w'), indent=1); return
    for name, (path, params) in REQUESTS.items():
        try:
            status, data = fetch(path, params)
            with open(os.path.join(OUT, name + '.json'), 'w') as f:
                json.dump(data, f, ensure_ascii=False, separators=(',', ':'))
            info = {'ok': True, 'status': status, 'fetched': meta['run'], **summarize(data)}
            print(f'  ok   {name}: {info}')
        except urllib.error.HTTPError as e:
            body = e.read().decode('utf-8', 'replace')[:300]
            info = {'ok': False, 'status': e.code, 'error': body, 'tried': meta['run']}
            print(f'  FAIL {name}: HTTP {e.code} {body}')
        except Exception as e:  # message never includes the key
            info = {'ok': False, 'error': f'{type(e).__name__}: {str(e)[:200]}', 'tried': meta['run']}
            print(f'  FAIL {name}: {info["error"]}')
        info['request'] = {'path': path, **params}
        meta['results'][name] = info
        time.sleep(1.1)
    json.dump(meta, open(meta_path, 'w'), indent=1)


if __name__ == '__main__':
    main()
