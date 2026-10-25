#!/usr/bin/env python3
"""Save Tankathon's projected 2027 NFL draft order (all rounds, traded picks) to data/nfl-draft-order.json.

The Rookie Draft page uses it for each rookie's projected landing spot: the NFL team holding the
overall pick he's projected to go at. Team codes match ESPN's (data/espn/teams.json).
Runs in the weekly GitHub Action; on any failure it keeps the previous file. Standard library only.
"""
import json, os, re, urllib.request
from datetime import datetime, timezone

URL = 'https://www.tankathon.com/nfl/full-draft'
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'data', 'nfl-draft-order.json')
LOGO = re.compile(r'/nfl/([a-z]{2,3})\.svg')


def parse(html):
    """Each pick row: <td class="pick-number">N</td> ... owner logo .../nfl/xxx.svg ... optional <div class="trade"> ... from logo."""
    picks, rnd = [], 0
    for chunk in re.split(r'(?=class="round-title")|(?=<tr)', html):
        if 'class="round-title"' in chunk[:40]:
            rnd += 1
            continue
        m = re.search(r'class="pick-number">\s*(\d+)', chunk)
        if not m:
            continue
        before, _, trade = chunk.partition('class="trade"')
        own = LOGO.search(before)
        frm = LOGO.search(trade) if trade else None
        if own:
            picks.append({'pick': int(m.group(1)), 'round': max(rnd, 1), 'team': own.group(1).upper(),
                          'from': frm.group(1).upper() if frm else ''})
    return picks


def main():
    try:
        req = urllib.request.Request(URL, headers={'User-Agent': 'Mozilla/5.0 (FBP site refresh; weekly)', 'Accept': 'text/html'})
        with urllib.request.urlopen(req, timeout=45) as r:
            html = r.read().decode('utf-8', 'replace')
        picks = parse(html)
        nums = [p['pick'] for p in picks]
        if len(picks) < 224 or nums != list(range(1, len(picks) + 1)):
            raise RuntimeError(f'unexpected page shape ({len(picks)} picks)')
        old = {}
        try:
            old = json.load(open(OUT))
        except Exception:
            pass
        data = {'season': old.get('season', 2027), 'source': 'Tankathon full 2027 NFL draft order', 'url': URL,
                'fetched': datetime.now(timezone.utc).isoformat(timespec='seconds'),
                'note': 'Projected order from current NFL standings, with traded picks. Team codes match ESPN.',
                'picks': picks}
        with open(OUT, 'w') as f:
            json.dump(data, f, separators=(',', ':'))
        print(f'  ok   tankathon ({len(picks)} picks)')
    except Exception as e:
        print(f'  FAIL tankathon: {type(e).__name__}: {str(e)[:200]}  (kept the previous file)')


if __name__ == '__main__':
    main()
