#!/usr/bin/env python3
"""Share pages: one tiny HTML page per hub page, so a shared link previews as that page.

The hub is one page with #hash routes, and link previews (iMessage, Slack, etc.) never see the hash, so every
shared link used to preview as plain "Footballpalooza". The header's Share button now shares
share/<key>.html instead: its title and description name the page (Playoff Picture, Week 9 Matchups, a column's
headline...), and opening it sends the browser straight on to the real page (#<route>, or ?to=<route> for a
deeper route under it).

Writes share/<key>.html for every route below plus share/pages.json (route -> key) for the Share button.
Run after league_now.py, matchups.py and build_columns.py (the weekly workflow does).
"""
import html, json, os, re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'share')
SITE = 'https://migliopolis.github.io/Footballpalooza/'
ICON = SITE + 'assets/apple-touch-icon.png'


def load(*p):
    try:
        return json.load(open(os.path.join(ROOT, *p), encoding='utf-8'))
    except Exception:
        return {}


def routes():
    now = load('data', 'league-now.json')
    mu = load('data', 'matchups.json')
    ref = load('data', 'reference.json')
    cols = load('data', 'columns.json')
    season = (re.search(r'\d{4}', str(now.get('season', ''))) or [''])[0]
    thru = now.get('weeksPlayed')
    wk = f' through Week {thru}' if thru else ''
    r = {
        'scores': ('Scoreboard', f'Live scores, lineups and stats for every {season} Footballpalooza game.'),
        'scores/nfl': ('NFL Scoreboard', f'Every week of the {season} NFL season: scores, schedule, networks and byes.'),
        'scores/ticket': ('Sunday Ticket Helper', 'The three games to put on your multiview for each FBP matchup, window by window.'),
        'now': ('Standings', f'{season} Footballpalooza standings{wk}.'),
        'now/matchups': (f"Week {mu.get('week')} Matchups" if mu.get('week') else 'Matchups', "This week's games, head to head."),
        'now/power': ('Power Rankings', f'{season} Footballpalooza power rankings{wk}.'),
        'now/playoffs': ('Playoff Picture', 'Seeds, the bracket and the 6-seed race' + (',' + wk if wk else '') + '.'),
        'awards': ('Awards', f'{season} Footballpalooza awards: All-FBP teams, MVP, Trade of the Year and more.'),
        'reference': ('FBP Reference', 'Footballpalooza history: franchises, seasons, records and the Hall of Fame.'),
        'reference/franchises': ('Franchises', 'Every Footballpalooza franchise, all time.'),
        'reference/seasons': ('Seasons', 'Every Footballpalooza season.'),
        'reference/records': ('Records', 'Footballpalooza record book.'),
        'reference/hof': ('Hall of Fame', 'The Footballpalooza Hall of Fame and the All-Time FBP Team.'),
        'reference/payroll': ('Payroll', 'Footballpalooza salaries and cap.'),
        'offseason': ('Off-Season', 'The Footballpalooza off-season workbook.'),
        'draft': ('Rookie Draft', f'The {int(season) + 1 if season else ""} Footballpalooza rookie draft.'.replace('  ', ' ')),
        'draft/mock': ('Mock Draft', 'Run a Footballpalooza rookie mock draft.'),
        'draft/board': ('Big Board', 'The rookie big board, with prices.'),
        'draft/order': ('Draft Order', 'The full rookie draft order, as the standings stand today.'),
        'bylaws': ('By-Laws', 'The Footballpalooza by-laws.'),
    }
    for fid, f in (ref.get('franchises') or {}).items():
        name = (f.get('name') if isinstance(f, dict) else f) or fid
        r[f'reference/f-{fid}'] = (f'{name} franchise page', f'{name}: Footballpalooza franchise history, seasons and records.')
    for y in sorted((ref.get('standings_by_year') or {}).keys()):
        r[f'reference/s-{y}'] = (f'{y} Season', f'The {y} Footballpalooza season.')
    for c in cols.get('columns') or []:
        who = ((cols.get('columnists') or {}).get(c.get('author')) or {}).get('name', '')
        r[f"now/column/{c['slug']}"] = (c['title'], (c.get('teaser') or '') + (f' By {who}.' if who else ''))
    return r


def page(route, title, desc):
    t, d = html.escape(f'{title} · Footballpalooza'), html.escape(desc)
    return f'''<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>{t}</title>
<meta name="description" content="{d}">
<meta property="og:site_name" content="Footballpalooza">
<meta property="og:title" content="{t}">
<meta property="og:description" content="{d}">
<meta property="og:image" content="{ICON}">
<meta property="og:type" content="website">
<meta name="twitter:card" content="summary">
<link rel="apple-touch-icon" href="../assets/apple-touch-icon.png">
<script>(function(){{var q=new URLSearchParams(location.search).get('to');var r={json.dumps(route)};
if(!q||(q!==r&&q.indexOf(r+'/')!==0))q=r;location.replace('../#'+q);}})();</script>
</head><body style="font-family:system-ui,sans-serif;padding:24px">
<p><a href="../#{html.escape(route)}">{html.escape(title)} on Footballpalooza</a></p>
</body></html>
'''


def main():
    os.makedirs(OUT, exist_ok=True)
    r = routes()
    keys = {}
    for route, (title, desc) in r.items():
        key = re.sub(r'[^a-z0-9-]+', '_', route.lower()).strip('_')
        keys[route] = key
        open(os.path.join(OUT, key + '.html'), 'w', encoding='utf-8').write(page(route, title, desc))
    keep = {k + '.html' for k in keys.values()} | {'pages.json'}
    for f in os.listdir(OUT):
        if f.endswith('.html') and f not in keep:
            os.remove(os.path.join(OUT, f))
    json.dump(keys, open(os.path.join(OUT, 'pages.json'), 'w'), indent=0, sort_keys=True)
    print(f'share pages: {len(keys)}')


if __name__ == '__main__':
    main()
