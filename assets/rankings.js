/* League Now > Rankings (#now/rankings): FantasyPros' consensus rankings with everything FBP knows about each player.
   Data: data/rankings.json (scripts/trade_values.py): dynasty and rest-of-season ranks (and next year's rookie class
   once FantasyPros posts it), FBP team and contract, Player Value, Trade Value, Player Card OVR, Heat Check, points.
   Lists: Dynasty, Rest of Season, Rookies (this year's class from the dynasty list, or next year's rookie rankings),
   FBP Trade Value. Filters: position, Free agents / Rostered / a team (each on or off, any mix), search. Any column
   sorts; dynasty lists are split into FantasyPros' tiers. */
window.FBPRankings = (function () {
  let D = null, failed = false, loading = false, X = null;
  const OP = new Set();   // players whose box is open (the same box as on Rosters)
  const S = { list: 'dyn', pos: '', who: [], q: '', sort: null, dir: 1, shown: 100, team: '' };
  try { Object.assign(S, JSON.parse(localStorage.getItem('fbp-rank') || '{}'), { q: '', shown: 100 }); } catch (e) {}
  if (!['dyn', 'ros', 'rook'].includes(S.list)) S.list = 'dyn';
  if (!Array.isArray(S.who)) S.who = [];
  const save = () => { try { localStorage.setItem('fbp-rank', JSON.stringify({ list: S.list, pos: S.pos, who: S.who, sort: S.sort, dir: S.dir, team: S.team })); } catch (e) {} };
  const esc = s => (X && X.esc ? X.esc(s) : String(s == null ? '' : s));
  const redraw = () => { const y = window.scrollY; if (X && X.rerender) { X.rerender(); window.scrollTo(0, y); } };
  function load() {
    if (D || loading || failed) return;
    loading = true;
    Promise.all([fetch('data/rankings.json', { cache: 'no-cache' }).then(r => r.ok ? r.json() : Promise.reject()),
      fetch('data/mfl/injuries.json', { cache: 'no-cache' }).then(r => r.ok ? r.json() : null).catch(() => null)])
      .then(([d, inj]) => { D = d; D.inj = {}; (((inj || {}).injuries || {}).injury || []).forEach(x => { D.inj[x.id] = x; }); loading = false; redraw(); },
        () => { failed = true; loading = false; redraw(); });
  }
  const tm = f => (X && X.teams && X.teams[f]) || {};
  const NFLE = { GBP: 'gb', KCC: 'kc', NEP: 'ne', NOS: 'no', SFO: 'sf', TBB: 'tb', LVR: 'lv', JAC: 'jax', WAS: 'wsh', LA: 'lar', LAR: 'lar' };
  const nflLogo = t => t && t !== 'FA' ? `<img class="rk-nfl" src="https://a.espncdn.com/i/teamlogos/nfl/500/${NFLE[t] || t.toLowerCase()}.png" alt="${esc(t)}" loading="lazy">` : '';
  const MINJ = { 'Questionable': 'Q', 'Doubtful': 'D', 'Out': 'O', 'IR': 'IR', 'IR-R': 'IR', 'IR-PUP': 'PUP', 'IR-NFI': 'IR', 'Suspended': 'SUS' };
  const LISTS = [['dyn', 'Dynasty'], ['ros', '<span class="lg-o">Rest of season</span><span class="sm-o">ROS</span>'], ['rook', 'Rookies']];
  const POSL = [['', 'All'], ['QB', 'QB'], ['RB', 'RB'], ['WR', 'WR'], ['TE', 'TE'], ['DEF', 'DEF']];
  const heatK = h => h == null ? '' : h >= 6 ? 'h3' : h >= 3 ? 'h2' : h > 0 ? 'h1' : h === 0 ? 'z' : h > -3 ? 'c1' : h > -6 ? 'c2' : 'c3';
  const ovrK = o => o == null ? '' : o >= 90 ? 'holo' : o >= 80 ? 'gold' : o >= 70 ? 'silver' : 'bronze';

  // the list's own rank for a player, and whether he belongs in it at all
  function rankOf(p) {
    if (S.list === 'dyn') return p.d ? p.d[0] : null;
    if (S.list === 'ros') return p.r ? p.r[0] : null;
    if (S.list === 'rook') return p.rk ? p.rk[0] : p.dy === D.season && p.d ? p.d[0] : null;
    if (S.list === 'tv') return p.tv;
    return null;
  }
  const nn = x => x == null ? null : x;
  const COLS = [
    ['rk', '#', p => p._rk], ['n', 'Player', p => p.n], ['f', 'FBP', p => p.f ? (tm(p.f).abbr || p.f) : 'zzz'],
    ['ep', 'ECR Pos', p => p.d ? nn(p.d[1]) : null], ['eo', 'ECR Ovr', p => p.d ? p.d[0] : null],
    ['pts', 'Pts', p => p.gp ? p.pts : null], ['ppg', 'Pts/g', p => p.ppg], ['l3', 'Pts/L3', p => p.l3], ['age', 'Age', p => p.age],
    ['sal', '$', p => p.sal], ['rp', 'ECR ROS', p => p.r ? nn(p.r[1]) : null], ['ro', 'ECR ROS Ovr', p => p.r ? p.r[0] : null],
    ['o', 'OVR', p => p.o], ['h', 'Heat', p => p.h], ['pv', 'Player Value', p => p.pv], ['tv', 'Trade Value', p => p.tv]];
  const ASC = ['n', 'f', 'age', 'ep', 'eo', 'rp', 'ro'];

  function render(ctx) {
    X = ctx; load();
    if (failed) return '<p class="error">The rankings didn’t load. Refresh the page to try again.</p>';
    if (!D) return '<p class="loading">Loading the rankings…</p>';
    const hl = S.team && X.teams[S.team] ? S.team : X.myTeam || '';
    const q = S.q.trim().toLowerCase();
    let L = D.players.map(p => Object.assign(p, { _rk: rankOf(p) })).filter(p => p._rk != null)
      .filter(p => !S.pos || p.pos === S.pos)
      .filter(p => !S.who.length || S.who.some(w => w === 'ro' ? p.f : w === 'fa' ? !p.f : p.f === hl))
      .filter(p => !q || p.n.toLowerCase().includes(q));
    const asc = S.list !== 'tv';   // ranks run 1 up; Trade Value runs high to low
    L.sort((a, b) => asc ? a._rk - b._rk : b._rk - a._rk);
    L.forEach((p, i) => { p._n = i + 1; });
    if (S.sort) { const c = COLS.find(c => c[0] === S.sort); if (c) L.sort((a, b) => { const x = c[2](a), y = c[2](b);
      if (x == null && y == null) return a._n - b._n; if (x == null) return 1; if (y == null) return -1;
      return (typeof x === 'string' ? x.localeCompare(y) : x - y) * S.dir || a._n - b._n; }); }
    const tiers = S.list === 'dyn' && !S.sort && !q;
    const th = (k, l, cls) => `<th class="${cls || ''}${k ? ' rk-s' : ''}"${k ? ` data-rk-sort="${k}" aria-sort="${S.sort === k ? (S.dir > 0 ? 'ascending' : 'descending') : 'none'}"` : ''}>${l}${S.sort === k ? (S.dir > 0 ? ' ▲' : ' ▼') : ''}</th>`;
    const vis = L.slice(0, S.shown);
    let lastT = null;
    const row = p => {
      const t = tm(p.f), inj = D.inj[p.id], ic = inj && MINJ[inj.status];
      const tier = tiers && p.d && p.d[2] != null && p.d[2] !== lastT ? (lastT = p.d[2], `<tr class="rk-tier"><td colspan="16">Tier ${p.d[2]}</td></tr>`) : '';
      const img = p.pos === 'DEF' ? `style="background-image:url(https://a.espncdn.com/i/teamlogos/nfl/500/${NFLE[p.nfl] || String(p.nfl).toLowerCase()}.png)" class="rk-def"` : p.e ? `style="background-image:url(https://a.espncdn.com/i/headshots/nfl/players/full/${p.e}.png)"` : '';
      const name = esc(p.n), on = OP.has(p.id);
      const tvW = p.tv ? Math.round(p.tv / 100) : 0;
      return `${tier}<tr class="rk-p${p.f === hl && hl ? ' rk-me' : ''}${on ? ' on' : ''}" data-rk-p="${p.id}" aria-expanded="${on}">
        <td class="rk-n">${S.list === 'tv' && !S.sort ? p._n : p._rk}</td>
        <td class="l rk-pl"><span class="rk-ph"><span ${img}></span></span><span class="rk-nm"><b>${name}</b>${ic ? `<span class="ro-inj" title="${esc(inj.status + (inj.details ? ': ' + inj.details : ''))}">${ic}</span>` : ''}${p.dy === D.season ? '<span class="rk-rook" title="Rookie">R</span>' : ''}
          <small><span class="rk-pr">${p.pos}</span>${nflLogo(p.nfl)}${p.nfl && p.nfl !== 'FA' ? '' : ' NFL FA'}</small></span></td>
        <td class="rk-f">${p.f ? `<span class="rk-ft" title="${esc(X.nameOf ? X.nameOf(p.f) : '')}">${t.logo ? `<img src="${t.logo}" alt="">` : ''}<b>${esc(t.abbr || '')}</b></span>${p.st === 'TAXI_SQUAD' ? '<small>taxi</small>' : p.st === 'INJURED_RESERVE' ? '<small>IR</small>' : ''}` : '<span class="rk-fa">FA</span>'}</td>
        <td class="rk-e">${p.d && p.d[1] ? p.pos + p.d[1] : '—'}</td><td class="rk-e">${p.d ? p.d[0] : '—'}</td>
        <td>${p.gp ? p.pts.toFixed(1) : '—'}</td><td>${p.ppg != null ? p.ppg.toFixed(1) : '—'}</td><td>${p.l3 != null ? p.l3.toFixed(1) : '—'}</td>
        <td>${p.age != null ? p.age.toFixed(1) : '—'}</td>
        <td class="rk-sal">${p.sal != null ? `$${Math.round(p.sal)}${p.cy ? `<small>${esc(p.cy)}</small>` : ''}` : '—'}</td>
        <td class="rk-e">${p.r && p.r[1] ? p.pos + p.r[1] : '—'}</td><td class="rk-e">${p.r ? p.r[0] : '—'}</td>
        <td class="c">${p.o != null ? `<span class="rk-ovr ${ovrK(p.o)}">${p.o}</span>` : '—'}</td>
        <td class="c">${p.h != null ? `<span class="hc-v ${heatK(p.h)}">${p.h > 0 ? '+' : ''}${p.h}</span>` : '—'}</td>
        <td class="rk-pv">${p.pv != null ? p.pv.toLocaleString() : '—'}</td>
        <td class="rk-tv">${p.tv != null ? `<b>${p.tv.toLocaleString()}</b><span class="rk-bar"><i style="width:${tvW}%"></i></span>` : '<span class="rk-mu" title="Free agents have no FBP contract yet">—</span>'}</td></tr>
        ${on ? `<tr class="rk-det"><td colspan="16">${window.FBPRosters ? FBPRosters.boxFor(X, p.id) : ''}</td></tr>` : ''}`; };
    const upd = S.list === 'ros' ? D.rosUpdated : S.list === 'rook' && D.rookUpdated ? D.rookUpdated : D.dynUpdated;
    const teams = Object.keys(X.teams || {}).sort((a, b) => (X.nameOf ? X.nameOf(a) : a).localeCompare(X.nameOf ? X.nameOf(b) : b));
    return `<section class="rk-page">
      <div class="seg rk-lists" role="tablist" aria-label="Rankings">${LISTS.map(([k, l]) => `<button type="button" role="tab" data-rk-list="${k}" aria-selected="${S.list === k}">${l}</button>`).join('')}</div>
      <div class="rk-ctl">
        <div class="seg rk-pos" role="tablist" aria-label="Position">${POSL.map(([k, l]) => `<button type="button" role="tab" data-rk-pos="${k}" aria-selected="${S.pos === k}">${l}</button>`).join('')}</div>
        <div class="seg rk-who" aria-label="Which players">${[['fa', 'Free agents'], ['ro', 'Rostered'], ['team', hl ? (tm(hl).abbr || 'Team') : 'Team']].map(([k, l]) =>
          `<button type="button" data-rk-who="${k}" aria-pressed="${S.who.includes(k)}">${k === 'team' && tm(hl).logo ? `<img src="${tm(hl).logo}" alt="">` : ''}${esc(l)}</button>`).join('')}</div>
        <select class="rk-team" aria-label="Team for the team button">${teams.map(f => `<option value="${f}"${f === hl ? ' selected' : ''}>${esc(X.nameOf ? X.nameOf(f) : f)}</option>`).join('')}</select>
        <input class="pr-q rk-q" type="search" placeholder="Find a player" aria-label="Find a player" value="${esc(S.q)}" autocomplete="off">
      </div>
      <p class="rk-sub">${S.list === 'tv' ? 'Every rostered player by FBP Trade Value: what he’s worth to an FBP owner, contract included.' : S.list === 'rook' ? (D.rookUpdated ? `FantasyPros’ ${D.season + 1} rookie rankings.` : `This year’s rookies in FantasyPros’ dynasty rankings (the ${D.season + 1} class shows here once FantasyPros posts it).`) : S.list === 'ros' ? 'FantasyPros’ rest-of-season consensus, PPR.' : 'FantasyPros’ dynasty consensus, PPR, split into their tiers.'} ${L.length} players${upd ? ` · rankings as of ${esc(upd)}` : ''}. Tap a column to sort.</p>
      <div class="tbl-wrap rk-wrap"><table class="rk-t"><thead><tr>${th('rk', '#', 'rk-n')}${th('n', 'Player', 'l rk-pl')}${th('f', 'FBP', 'rk-f')}${COLS.slice(3).map(c => th(c[0], c[1], ['ep', 'eo', 'rp', 'ro'].includes(c[0]) ? 'rk-e' : c[0] === 'o' || c[0] === 'h' ? 'c' : '')).join('')}</tr></thead>
        <tbody>${vis.map(row).join('') || '<tr><td colspan="16" class="rk-none">Nobody matches.</td></tr>'}</tbody></table></div>
      ${L.length > S.shown ? `<button type="button" class="ro-howb rk-more" data-rk-more>Show ${Math.min(100, L.length - S.shown)} more</button>` : ''}
      <p class="rf-foot">Rankings are FantasyPros’ expert consensus (data © FantasyPros), PPR, refreshed every morning. Player Value puts the dynasty rank on a 1–9,999 curve: ability, potential and production. Trade Value is talent first, with stars weighted up, adjusted for his FBP contract: seasons of control and salary against what he’d fetch at auction (Trading Floor &gt; Value Chart has the details). OVR is the Player Card rating, measured against his position. Heat is his Heat Check score (Nuclear +3, Hot +1, Cold −1, Bust −2, Witness Protection −3). ECR is FantasyPros’ expert consensus rank: dynasty by position and overall, then rest of season. Pts, Pts/g and Pts/L3 (average over his last three games) are this season in FBP scoring. R marks a rookie. Tap a player to open his box: news, game log, schedule and the rest, with a link to his Player Page.</p>
    </section>`;
  }

  document.addEventListener('click', e => {
    const t = e.target.closest ? e.target : null; if (!t || !document.querySelector('.rk-page')) return;
    const l = t.closest('[data-rk-list]'); if (l) { S.list = l.dataset.rkList; S.sort = null; S.shown = 100; save(); return redraw(); }
    const p = t.closest('[data-rk-pos]'); if (p) { S.pos = p.dataset.rkPos; S.shown = 100; save(); return redraw(); }
    const w = t.closest('[data-rk-who]'); if (w) { const v = w.dataset.rkWho; S.who = S.who.includes(v) ? S.who.filter(x => x !== v) : S.who.concat(v); S.shown = 100; save(); return redraw(); }
    const s = t.closest('[data-rk-sort]'); if (s) { const k = s.dataset.rkSort; if (S.sort === k) S.dir = -S.dir; else { S.sort = k === 'rk' ? null : k; S.dir = ASC.includes(k) ? 1 : -1; } save(); return redraw(); }
    if (t.closest('[data-rk-more]')) { S.shown += 100; return redraw(); }
    if (t.closest('.ro-box, a, .rk-det')) return;   // the box handles its own tabs and links
    const r = t.closest('[data-rk-p]'); if (r) { const id = r.dataset.rkP; OP.has(id) ? OP.delete(id) : OP.add(id); return redraw(); }
  });
  document.addEventListener('change', e => { if (e.target.matches && e.target.matches('.rk-team')) { S.team = e.target.value; save(); redraw(); } });
  document.addEventListener('input', e => {
    if (!(e.target.matches && e.target.matches('.rk-q'))) return;
    S.q = e.target.value; S.shown = 100; const pos = e.target.selectionStart; redraw();
    const n = document.querySelector('.rk-q'); if (n) { n.focus(); try { n.setSelectionRange(pos, pos); } catch (_) {} }
  });
  return { render };
})();
