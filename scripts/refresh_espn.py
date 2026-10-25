#!/usr/bin/env python3
"""Fetch NFL reference data from ESPN's public (undocumented) feeds into data/espn/.

Runs in the weekly GitHub Action. No key needed. Every feed is independent: a
failure keeps the previous file, is noted in data/espn/_meta.json, and never
fails the workflow. Standard library only.

Saved files
  teams.json     NFL teams: ESPN id, names, colors, logo URLs (light and dark)
  athletes.json  every player on an NFL roster: name, position, team, jersey, age,
                 experience, status, and whether ESPN has a headshot
  injuries.json  current injury list keyed by ESPN athlete id
  news.json      latest league headlines

Player photos: https://a.espncdn.com/i/headshots/nfl/players/full/<espn id>.png
MFL players carry their ESPN id in data/mfl/players.json (field espn_id).
Endpoint list: https://gist.github.com/nntrn/ee26cb2a0716de0947a0a4e9a157bc1c
Live scores are deliberately not fetched (Paul paused the live scoreboard).
"""
import json, os, re, time, urllib.request
from datetime import datetime, timezone

SITE = 'https://site.api.espn.com/apis/site/v2/sports/football/nfl'
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'data', 'espn')


def get(url):
    req = urllib.request.Request(url, headers={'User-Agent': 'FBP-site-refresh/1.0', 'Accept': 'application/json'})
    last = None
    for _ in range(2):
        try:
            with urllib.request.urlopen(req, timeout=45) as r:
                return json.loads(r.read().decode('utf-8'))
        except Exception as e:
            last = e
            time.sleep(2)
    raise RuntimeError(f'{type(last).__name__}: {str(last)[:160]}')


def save(name, data):
    with open(os.path.join(OUT, name + '.json'), 'w') as f:
        json.dump(data, f, ensure_ascii=False, separators=(',', ':'), sort_keys=True)
        f.write('\n')


def teams_feed():
    raw = get(SITE + '/teams')
    out = {}
    for t in (x['team'] for x in raw['sports'][0]['leagues'][0]['teams']):
        logos = [l.get('href', '').split('?')[0] for l in t.get('logos', [])]
        dark = next((l for l in logos if '500-dark' in l), '')
        out[t['abbreviation']] = {'id': t['id'], 'name': t.get('displayName'), 'short': t.get('shortDisplayName'),
                                  'nickname': t.get('name'), 'color': '#' + t.get('color', '000000'),
                                  'alt': '#' + t.get('alternateColor', 'ffffff'),
                                  'logo': logos[0] if logos else '', 'logoDark': dark}
    return out


def athletes_feed(teams):
    out = {}
    for abbr, t in teams.items():
        raw = get(f"{SITE}/teams/{t['id']}/roster")
        for group in raw.get('athletes', []):
            for a in group.get('items', []):
                pos = (a.get('position') or {}).get('abbreviation', '')
                inj = (a.get('injuries') or [{}])[0] if a.get('injuries') else {}
                out[a['id']] = {'name': a.get('fullName') or a.get('displayName'), 'pos': pos, 'team': abbr,
                                'jersey': a.get('jersey', ''), 'age': a.get('age'),
                                'exp': (a.get('experience') or {}).get('years'),
                                'group': group.get('position', ''),
                                'status': ((a.get('status') or {}).get('type') or ''),
                                'injury': inj.get('status', '') if isinstance(inj, dict) else '',
                                'headshot': bool(a.get('headshot'))}
        time.sleep(0.4)
    return out


def injuries_feed():
    raw = get(SITE + '/injuries')
    out = {}
    for team in raw.get('injuries', []):
        for i in team.get('injuries', []):
            ath = i.get('athlete') or {}
            aid = ath.get('id')
            if not aid:  # injury entries link to the player page: .../player/_/id/<espn id>/<slug>
                for l in ath.get('links', []):
                    m = re.search(r'/id/(\d+)', l.get('href', ''))
                    if m:
                        aid = m.group(1); break
            key = aid or ath.get('displayName')
            if not key:
                continue
            out[str(key)] = {'name': ath.get('displayName'), 'team': team.get('displayName'),
                             'status': i.get('status'), 'short': i.get('shortComment', ''),
                             'date': i.get('date'),
                             'type': ((i.get('details') or {}).get('type') or ''),
                             'return': ((i.get('details') or {}).get('returnDate') or '')}
    return out


def news_feed():
    raw = get(SITE + '/news?limit=40')
    out = []
    for a in raw.get('articles', []):
        out.append({'headline': a.get('headline'), 'description': a.get('description', ''),
                    'published': a.get('published'), 'link': ((a.get('links') or {}).get('web') or {}).get('href', ''),
                    'athletes': [str(c.get('athleteId') or c.get('id')) for c in a.get('categories', [])
                                 if c.get('type') == 'athlete'],
                    'image': ((a.get('images') or [{}])[0] or {}).get('url', '')})
    return out


def main():
    os.makedirs(OUT, exist_ok=True)
    meta_path = os.path.join(OUT, '_meta.json')
    try:
        meta = json.load(open(meta_path))
    except Exception:
        meta = {}
    run = datetime.now(timezone.utc).isoformat(timespec='seconds')
    meta['run'] = run
    meta.setdefault('feeds', {})
    teams = None
    steps = [('teams', teams_feed), ('athletes', None), ('injuries', injuries_feed), ('news', news_feed)]
    for name, fn in steps:
        try:
            if name == 'athletes':
                if not teams:
                    teams = json.load(open(os.path.join(OUT, 'teams.json')))
                data = athletes_feed(teams)
            else:
                data = fn()
            if name == 'teams':
                teams = data
            if not data:
                raise RuntimeError('empty response')
            save(name, data)
            meta['feeds'][name] = {'ok': True, 'fetched': run, 'count': len(data)}
            print(f'  ok   {name} ({len(data)})')
        except Exception as e:
            meta['feeds'][name] = {**meta['feeds'].get(name, {}), 'ok': False, 'error': str(e)[:200], 'tried': run}
            print(f'  FAIL {name}: {e}  (kept the previous file)')
    with open(meta_path, 'w') as f:
        json.dump(meta, f, indent=1)
        f.write('\n')


if __name__ == '__main__':
    main()
