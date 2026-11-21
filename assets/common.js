/* Shared helpers for every page, loaded first (before any other script). One place for things that were copied
   across files: NFL team codes and logos, ESPN headshots, ordinals, and data loading.
     FBPU.json('data/ovr.json')   the parsed file, fetched once per visit and shared by every page (null if missing)
     FBPU.nflAbbr('KCC') -> 'KC'   FBPU.nflLogo('KCC')   FBPU.headshot(espnId)   FBPU.ord(3) -> '3rd'   */
window.FBPU = (function () {
  // MFL team codes that differ from ESPN's
  const ESPN = { GBP: 'GB', JAC: 'JAX', KCC: 'KC', LVR: 'LV', NEP: 'NE', NOS: 'NO', SFO: 'SF', TBB: 'TB', WAS: 'WSH', LA: 'LAR' };
  const nflAbbr = t => ESPN[t] || t;
  const nflLogo = (t, dark) => t && t !== 'FA' ? `https://a.espncdn.com/i/teamlogos/nfl/500${dark ? '-dark' : ''}/${String(nflAbbr(t)).toLowerCase()}.png` : '';
  const headshot = e => e ? `https://a.espncdn.com/i/headshots/nfl/players/full/${encodeURIComponent(e)}.png` : '';
  // NFL team primary colors (ESPN codes), for the thin ring around a plain player photo
  const COL = { ARI: '#97233F', ATL: '#A71930', BAL: '#241773', BUF: '#00338D', CAR: '#0085CA', CHI: '#0B162A', CIN: '#FB4F14', CLE: '#311D00',
    DAL: '#003594', DEN: '#FB4F14', DET: '#0076B6', GB: '#203731', HOU: '#03202F', IND: '#002C5F', JAX: '#006778', KC: '#E31837',
    LV: '#A5ACAF', LAC: '#0080C6', LAR: '#003594', MIA: '#008E97', MIN: '#4F2683', NE: '#002244', NO: '#D3BC8D', NYG: '#0B2265',
    NYJ: '#125740', PHI: '#004C54', PIT: '#FFB612', SF: '#AA0000', SEA: '#69BE28', TB: '#D50A0A', TEN: '#4B92DB', WSH: '#5A1414' };
  // the circle behind a defense's logo: one of the team's own colors that its logo sits well on
  const DEFBG = { ARI: '#000000', ATL: '#A71930', BAL: '#FFFFFF', BUF: '#FFFFFF', CAR: '#101820', CHI: '#0B162A', CIN: '#FFFFFF', CLE: '#311D00',
    DAL: '#041E42', DEN: '#002244', DET: '#B0B7BC', GB: '#203731', HOU: '#FFFFFF', IND: '#FFFFFF', JAX: '#101820', KC: '#E31837',
    LV: '#000000', LAC: '#002A5E', LAR: '#FFD100', MIA: '#FFFFFF', MIN: '#4F2683', NE: '#FFFFFF', NO: '#101820', NYG: '#FFFFFF',
    NYJ: '#FFFFFF', PHI: '#A5ACAF', PIT: '#FFFFFF', SF: '#B3995D', SEA: '#69BE28', TB: '#34302B', TEN: '#FFFFFF', WSH: '#FFB612' };
  const defBg = t => t ? DEFBG[nflAbbr(t)] || '' : '';
  // a defense from its team name ("Baltimore Ravens", "Washington Football Team"): NFL abbreviation by nickname
  const NICK = { Cardinals: 'ARI', Falcons: 'ATL', Ravens: 'BAL', Bills: 'BUF', Panthers: 'CAR', Bears: 'CHI', Bengals: 'CIN', Browns: 'CLE',
    Cowboys: 'DAL', Broncos: 'DEN', Lions: 'DET', Packers: 'GB', Texans: 'HOU', Colts: 'IND', Jaguars: 'JAX', Chiefs: 'KC', Raiders: 'LV',
    Chargers: 'LAC', Rams: 'LAR', Dolphins: 'MIA', Vikings: 'MIN', Patriots: 'NE', Saints: 'NO', Giants: 'NYG', Jets: 'NYJ', Eagles: 'PHI',
    Steelers: 'PIT', '49ers': 'SF', Seahawks: 'SEA', Buccaneers: 'TB', Titans: 'TEN', Commanders: 'WSH', Redskins: 'WSH', Team: 'WSH' };
  const defAbbr = name => NICK[String(name || '').trim().split(/\s+/).pop()] || '';
  // a defense's face, the same look as the scoreboard: its NFL logo on a circle of one of the team's colors
  const defFace = (name, cls = 'py-face') => { const a = defAbbr(name); if (!a) return `<i class="${cls}"></i>`;
    return `<span class="${cls} def-face" style="--dc:${DEFBG[a] || '#e3e8ee'}"><img src="https://a.espncdn.com/i/teamlogos/nfl/500/${a.toLowerCase()}.png" alt="" loading="lazy"></span>`; };
  const nflColor = t => t ? COL[nflAbbr(t)] || '' : '';
  // ' --tc:#xxxxxx;' for a style attribute: his FBP team's color (its primary, or its second color when the primary is
  // near-white); empty for a free agent. The CSS draws a thin ring around a plain photo in it.
  const lum = h => { const m = /^#?([0-9a-f]{6})$/i.exec(h || ''); if (!m) return 0; const n = parseInt(m[1], 16);
    return (0.299 * (n >> 16) + 0.587 * (n >> 8 & 255) + 0.114 * (n & 255)) / 255; };
  const tc = fid => { const T = window.FBP && FBP.teams ? FBP.teams() : {}, t = (fid && T[fid]) || null; if (!t) return '';
    let c = t.primary; if (c && lum(c) > 0.85 && t.secondary) c = t.secondary; return c ? ` --tc:${c};` : ''; };
  // FBP OVR (data/ovr.json) for photo backgrounds: a plain photo takes his OVR chip's color (90+ holo, 80s gold, 70s
  // silver, under 70 bronze). site.js loads it at startup and redraws the page once it's in; until then, no color.
  let OVR = null;
  const ovLoad = () => json('data/ovr.json').then(d => (OVR = (d && d.players) || {}), () => (OVR = {}));
  const ovTier = id => { const o = OVR && id != null && OVR[id] && OVR[id].o; return o == null || o === false ? '' : o >= 90 ? 'holo' : o >= 80 ? 'gold' : o >= 70 ? 'silver' : 'bronze'; };
  const ovc = id => { const t = ovTier(id); return t ? ' ovbg ov-' + t : ''; };
  const ord = n => n == null || n === '' ? '' : n + (['th', 'st', 'nd', 'rd'][(n % 100 > 10 && n % 100 < 14) ? 0 : n % 10] || 'th');
  // site data loads once per visit and every page shares it; a file that isn't there resolves null, a network
  // failure rejects (and is forgotten, so the next page can try again)
  const cache = {};
  const json = url => (cache[url] = cache[url] || fetch(url, { cache: 'no-cache' }).then(r => r.ok ? r.json() : null)
    .catch(e => { delete cache[url]; throw e; }));
  // MFL injury designations (data/mfl/injuries.json) as the short tags the site shows beside a name
  const INJ = { 'Questionable': 'Q', 'Doubtful': 'D', 'Out': 'O', 'IR': 'IR', 'IR-R': 'IR', 'IR-PUP': 'PUP', 'IR-NFI': 'IR', 'Suspended': 'SUS' };
  const injMap = j => { const m = {}; (((j || {}).injuries || {}).injury || []).forEach(x => { m[x.id] = x; }); return m; };
  const injChip = (x, esc) => { const t = x && INJ[x.status]; if (!t) return '';
    const e = esc || (s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])));
    return `<span class="ro-inj" data-inj="${e(x.id || '')}" role="link" tabindex="0" title="${e(x.status + (x.details ? ': ' + x.details : ''))}">${t}</span>`; };
  // the trade block (MFL Trade Bait, data/ticker.json from scripts/trading_floor.py): a TRADE chip beside any player on it,
  // on every page that shows him (Scoreboard, Rosters, My Team, Player Page, Stats, Rankings, the Trading Floor).
  // site.js loads it at startup and redraws once it's in; until then, no chips.
  let TB = null;
  const tbLoad = () => json('data/ticker.json').then(d => { TB = new Set(((d && d.blockIds) || []).map(String)); }, () => { TB = new Set(); });
  const onBlock = id => !!(TB && id != null && TB.has(String(id)));
  const tbChip = id => onBlock(id) ? '<span class="tb-chip" title="On the trade block (League Now › Trading Floor)">TRADE</span>' : '';
  // team pickers (two rows of six): three boxes of four, one per division, West, Central, East from left to right, each
  // titled in a break in its outline. Your default team sits first (top left) in its division; the rest A-Z by name.
  //   FBPU.divGrid(ids, item, { mine, name, cls })  item(id) -> one button/link's HTML
  // Falls back to one plain grid (the same class) when the division list hasn't loaded.
  const divGrid = (ids, item, o) => {
    o = o || {}; const now = window.FBP && FBP.now ? FBP.now() : null, nm = o.name || (id => id), cls = o.cls || '';
    const by = (a, b) => (b === o.mine) - (a === o.mine) || String(nm(a)).localeCompare(String(nm(b)));
    const divs = now && now.divisions, of = {}; ((now && now.standings) || []).forEach(s => { of[s.id] = s.division; });
    if (!divs || !divs.length || ids.some(id => !of[id])) return `<div class="${cls}">${ids.slice().sort(by).map(item).join('')}</div>`;
    return `<div class="dvg ${cls}">${divs.map(dv => { const L = ids.filter(id => of[id] === dv.id).sort(by);
      return L.length ? `<fieldset class="dvg-box"><legend>${dv.name}</legend><div class="dvg-in">${L.map(item).join('')}</div></fieldset>` : ''; }).join('')}</div>`;
  };
  return { ESPN, COL, nflColor, defBg, defAbbr, defFace, tc, ovLoad, ovTier, ovc, nflAbbr, nflLogo, headshot, ord, json, INJ, injMap, injChip, divGrid, tbLoad, onBlock, tbChip };
})();
