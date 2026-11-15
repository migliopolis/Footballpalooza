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
  const ord = n => n == null || n === '' ? '' : n + (['th', 'st', 'nd', 'rd'][(n % 100 > 10 && n % 100 < 14) ? 0 : n % 10] || 'th');
  // site data loads once per visit and every page shares it; a file that isn't there resolves null, a network
  // failure rejects (and is forgotten, so the next page can try again)
  const cache = {};
  const json = url => (cache[url] = cache[url] || fetch(url, { cache: 'no-cache' }).then(r => r.ok ? r.json() : null)
    .catch(e => { delete cache[url]; throw e; }));
  return { ESPN, nflAbbr, nflLogo, headshot, ord, json };
})();
