#!/usr/bin/env python3
"""Share pages for Player Pages: share/p/<player>.html plus a preview picture share/p/img/<player>.png.

A Player Page lives at #now/team/<team>/<player> (or #now/player/<player> for a free agent), and link previews
never see the #route, so a shared Player Page used to preview as "My Team". The Share button now shares
share/p/<player>.html instead (route player/<id> in share/pages.json): its title is the player's name, and its
picture is his photo the way the site draws it -- on his All-FBP metal (1st Team gold, 2nd Team silver, Rookie Team
emerald) or his Player Card OVR color (holo, gold, silver, bronze), ringed, on his FBP team's color. A defense gets
its NFL logo on the team-color circle, as on the scoreboard.

Pictures are only redrawn when what's in them changes (share/p/manifest.json keeps a signature per player), and a
photo ESPN won't serve is retried on the next run. Run after rosters.py and ovr.py; share_pages.py merges the routes
into share/pages.json, so run it after this.
"""
import hashlib, html, io, json, os, re, sys, urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'share', 'p')
IMG = os.path.join(OUT, 'img')
SITE = 'https://migliopolis.github.io/Footballpalooza/'
HEAD = 'https://a.espncdn.com/i/headshots/nfl/players/full/{}.png'
LOGO = 'https://a.espncdn.com/i/teamlogos/nfl/500/{}.png'
S = 600   # the picture is square

# the site's colors (assets/site.css): All-FBP metals and rings, OVR tiers, the defense circle
MED = {'gold': (['#fff6c9', '#f3d36b', '#c99a2e', '#8a6416'], '#d4a72c', '#8a6416'),
       'silver': (['#ffffff', '#e3e7ec', '#aab2bc', '#6f7883'], '#b9c0c8', '#6f7883'),
       'rook': (['#effff4', '#9fe3b4', '#3fae6a', '#1d6b3d'], '#3fb26c', '#1d6b3d')}
OVR = {'holo': ['#f6d365', '#a8edea', '#fbc2eb'], 'gold': ['#f0c94a'], 'silver': ['#cfd4da'], 'bronze': ['#d7a37a']}
DEFBG = {'ARI': '#000000', 'ATL': '#A71930', 'BAL': '#FFFFFF', 'BUF': '#FFFFFF', 'CAR': '#101820', 'CHI': '#0B162A', 'CIN': '#FFFFFF',
         'CLE': '#311D00', 'DAL': '#041E42', 'DEN': '#002244', 'DET': '#B0B7BC', 'GB': '#203731', 'HOU': '#FFFFFF', 'IND': '#FFFFFF',
         'JAX': '#101820', 'KC': '#E31837', 'LV': '#000000', 'LAC': '#002A5E', 'LAR': '#FFD100', 'MIA': '#FFFFFF', 'MIN': '#4F2683',
         'NE': '#FFFFFF', 'NO': '#101820', 'NYG': '#FFFFFF', 'NYJ': '#FFFFFF', 'PHI': '#A5ACAF', 'PIT': '#FFFFFF', 'SF': '#B3995D',
         'SEA': '#69BE28', 'TB': '#34302B', 'TEN': '#FFFFFF', 'WSH': '#FFB612'}
NFLFIX = {'JAC': 'JAX', 'KCC': 'KC', 'GBP': 'GB', 'NEP': 'NE', 'NOS': 'NO', 'SFO': 'SF', 'TBB': 'TB', 'LVR': 'LV', 'OAK': 'LV', 'WAS': 'WSH', 'LA': 'LAR', 'SD': 'LAC'}


def load(*p):
    try:
        return json.load(open(os.path.join(ROOT, *p), encoding='utf-8'))
    except Exception:
        return {}


def rgb(h):
    h = h.lstrip('#'); return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


def lum(h):
    r, g, b = rgb(h); return (0.299 * r + 0.587 * g + 0.114 * b) / 255


def tier(o):
    return '' if o is None else 'holo' if o >= 90 else 'gold' if o >= 80 else 'silver' if o >= 70 else 'bronze'


def fetch(url):
    try:
        req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0 (Footballpalooza share previews)'})
        return urllib.request.urlopen(req, timeout=20).read()
    except Exception:
        return None


def draw(p, team, raw):
    """the preview picture: his photo in a circle on his metal or OVR color, ringed, on his FBP team's color"""
    from PIL import Image, ImageDraw
    prim = (team or {}).get('primary') or '#1b2733'
    sec = (team or {}).get('secondary') or '#ffffff'
    # the background is the darker of his team's two colors (white-primary teams like COOK and HOLD go on their
    # second color), the ring the lighter one
    bg, rc = (prim, sec) if lum(prim) <= lum(sec) else (sec, prim)
    im = Image.new('RGB', (S, S), rgb(bg))
    d = ImageDraw.Draw(im)
    R = 236; c0 = (S // 2 - R, S // 2 - R, S // 2 + R, S // 2 + R)
    # the circle's fill: a radial metal (lit from the upper left) or the OVR color (holo is a diagonal blend)
    fill = Image.new('RGB', (2 * R, 2 * R), (227, 232, 238))
    if p['med'] in MED or p['tier'] in OVR or p['def']:
        stops = MED[p['med']][0] if p['med'] in MED else OVR.get(p['tier']) or [p['defbg']]
        stops = [rgb(x) for x in stops]
        n = 2 * R // 4; small = Image.new('RGB', (n, n)); px = small.load()
        for y in range(n):
            for x in range(n):
                if p['med'] in MED:
                    t = min(1, (((x - .3 * n) ** 2 + (y - .25 * n) ** 2) ** .5) / (.725 * n))
                elif len(stops) > 1:
                    t = (x + y) / (2 * n)
                else:
                    t = 0
                k = t * (len(stops) - 1); i = min(int(k), len(stops) - 2) if len(stops) > 1 else 0
                f = k - i if len(stops) > 1 else 0
                a, b = stops[i], stops[min(i + 1, len(stops) - 1)]
                px[x, y] = tuple(int(a[j] + (b[j] - a[j]) * f) for j in range(3))
        fill = small.resize((2 * R, 2 * R), Image.BICUBIC)
    mask = Image.new('L', (2 * R, 2 * R), 0); ImageDraw.Draw(mask).ellipse((0, 0, 2 * R - 1, 2 * R - 1), fill=255)
    # the photo: cover the circle, anchored at the top (as the site draws it); a defense's logo sits centered at 76%
    if raw:
        try:
            ph = Image.open(io.BytesIO(raw)).convert('RGBA')
            if p['def']:
                w = int(2 * R * .76); ph.thumbnail((w, w)); fill.paste(ph, ((2 * R - ph.width) // 2, (2 * R - ph.height) // 2), ph)
            else:
                sc = max(2 * R / ph.width, 2 * R / ph.height); ph = ph.resize((round(ph.width * sc), round(ph.height * sc)), Image.LANCZOS)
                fill.paste(ph, ((2 * R - ph.width) // 2, 0), ph)
        except Exception:
            raw = None
    # rings: his metal's ring, else his FBP team's second color, with a white gap so it reads on the team color
    if p['med'] in MED:
        r1, r2 = MED[p['med']][1], MED[p['med']][2]
    else:
        r1 = r2 = rc
    d.ellipse((c0[0] - 26, c0[1] - 26, c0[2] + 26, c0[3] + 26), fill=rgb(r2))
    d.ellipse((c0[0] - 18, c0[1] - 18, c0[2] + 18, c0[3] + 18), fill=rgb(r1))
    if lum(r1) < .9:   # a white gap between a colored ring and the photo
        d.ellipse((c0[0] - 8, c0[1] - 8, c0[2] + 8, c0[3] + 8), fill=(255, 255, 255))
    im.paste(fill, (c0[0], c0[1]), mask)
    return im, bool(raw)


def page(pid, route, title, desc, img):
    t, d = html.escape(f'{title} · Footballpalooza'), html.escape(desc)
    return f'''<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>{t}</title>
<meta name="description" content="{d}">
<meta property="og:site_name" content="Footballpalooza">
<meta property="og:title" content="{t}">
<meta property="og:description" content="{d}">
<meta property="og:image" content="{html.escape(img)}">
<meta property="og:image:width" content="{S}">
<meta property="og:image:height" content="{S}">
<meta property="og:type" content="profile">
<meta name="twitter:card" content="summary_large_image">
<link rel="apple-touch-icon" href="../../assets/apple-touch-icon.png">
<script>(function(){{var q=new URLSearchParams(location.search).get('to');var r={json.dumps(route)};
if(!q||!/^now\\/(team\\/[^/]+|player)\\/{pid}$/.test(q))q=r;location.replace('../../#'+q);}})();</script>
</head><body style="font-family:system-ui,sans-serif;padding:24px">
<p><a href="../../#{html.escape(route)}">{html.escape(title)} on Footballpalooza</a></p>
</body></html>
'''


def main():
    R = load('data', 'rosters.json')
    teams = (load('data', 'teams.json').get('teams') or {})
    ovr = (load('data', 'ovr.json').get('players') or {})
    season = R.get('season') or ''
    os.makedirs(IMG, exist_ok=True)
    man_p = os.path.join(OUT, 'manifest.json')
    man = load('share', 'p', 'manifest.json')
    routes, keep, drawn, missed = {}, set(), 0, 0
    try:
        import PIL  # noqa: F401
        can_draw = True
    except ImportError:
        can_draw = False
        print('share players: Pillow is not installed, so no new pictures', file=sys.stderr)
    for fid, t in (R.get('teams') or {}).items():
        tm = teams.get(fid) or {}
        for r in t.get('rows') or []:
            pid = str(r.get('id') or ''); name = r.get('name') or ''
            if not pid or not name:
                continue
            pos = r.get('pos') or ''; d = pos == 'DEF'
            nfl = NFLFIX.get(r.get('nfl') or '', r.get('nfl') or '')
            hon = [h[0] for h in r.get('hon') or []]
            med = 'gold' if '1st Team' in hon else 'silver' if '2nd Team' in hon else 'rook' if 'Rookie Team' in hon else ''
            o = (ovr.get(pid) or {}).get('o')
            p = {'def': d, 'med': '' if d else med, 'tier': '' if d or med else tier(o if isinstance(o, (int, float)) else None),
                 'defbg': DEFBG.get(nfl, '#e3e8ee')}
            src = LOGO.format(nfl.lower()) if d and nfl else HEAD.format(r['espn']) if r.get('espn') else ''
            sig = hashlib.sha1(json.dumps([src, p, tm.get('primary'), tm.get('secondary'), 3]).encode()).hexdigest()[:10]
            png = os.path.join(IMG, pid + '.png')
            if can_draw and (man.get(pid) != sig or not os.path.exists(png)):
                raw = fetch(src) if src else None
                im, ok = draw(p, tm, raw)
                im.save(png, optimize=True)
                drawn += 1
                if ok or not src:
                    man[pid] = sig
                else:
                    man.pop(pid, None); missed += 1   # no photo this time: try again next run
            if not os.path.exists(png):
                continue
            # the description: position, NFL team, FBP team, OVR, this season's FBP points
            bits = [pos + (f' · {r.get("nfl")}' if r.get('nfl') and not d else ''), t.get('name') or tm.get('abbr') or '']
            if not d and isinstance(o, (int, float)):
                bits.append(f'OVR {o}')
            if r.get('gp'):
                bits.append(f'{r.get("pts", 0):.1f} FBP points in {season} ({r["gp"]} game{"s" if r["gp"] != 1 else ""})')
            if med:
                bits.append({'gold': 'All-FBP 1st Team', 'silver': 'All-FBP 2nd Team', 'rook': 'All-FBP Rookie Team'}[med])
            route = f'now/team/{fid}/{pid}'
            img = f'{SITE}share/p/img/{pid}.png?v={man.get(pid) or sig}'
            open(os.path.join(OUT, pid + '.html'), 'w', encoding='utf-8').write(page(pid, route, name, ' · '.join(b for b in bits if b) + '.', img))
            routes[f'player/{pid}'] = f'p/{pid}'
            keep.add(pid)
    # players no longer on an FBP roster: their pages and pictures go
    for f in os.listdir(OUT):
        if f.endswith('.html') and f[:-5] not in keep:
            os.remove(os.path.join(OUT, f))
    for f in os.listdir(IMG):
        if f.endswith('.png') and f[:-4] not in keep:
            os.remove(os.path.join(IMG, f)); man.pop(f[:-4], None)
    json.dump({k: man[k] for k in sorted(man) if k in keep}, open(man_p, 'w'), indent=0)
    json.dump(routes, open(os.path.join(OUT, 'routes.json'), 'w'), indent=0, sort_keys=True)
    print(f'share players: {len(routes)} pages, {drawn} pictures drawn' + (f', {missed} without a photo (retried next run)' if missed else ''))


if __name__ == '__main__':
    main()
