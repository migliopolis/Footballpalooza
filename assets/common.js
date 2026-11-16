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
    return `<span class="ro-inj" title="${e(x.status + (x.details ? ': ' + x.details : ''))}">${t}</span>`; };
  return { ESPN, COL, nflColor, tc, ovLoad, ovTier, ovc, nflAbbr, nflLogo, headshot, ord, json, INJ, injMap, injChip };
})();
