/* Footballpalooza hub: hash router, P-PPR toggle and the League Now page.
   Data comes from files the weekly GitHub Action writes (data/league-now.json). */
(() => {
  // Site version shown in the header. Add 0.0001 with every push Paul approves (see claude/github-push-setup.md),
  // and update the matching ?v= stamps on the script and stylesheet links in index.html so phones fetch fresh files.
  const VERSION = '0.0177';
  window.FBP = Object.assign(window.FBP || {}, { version: VERSION });
  // Share button in the header: the phone's own share sheet (Web Share API) for the page you're on;
  // where there's no share sheet (most desktop browsers), copy the link instead
  (() => {
    const btn = document.getElementById('share-btn'); if (!btn) return;
    const toast = msg => { let t = document.getElementById('share-toast'); if (!t) { t = document.createElement('div'); t.id = 'share-toast'; t.className = 'share-toast'; t.setAttribute('role', 'status'); document.body.appendChild(t); }
      t.textContent = msg; t.classList.add('on'); clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove('on'), 1800); };
    // link previews never see the #route, so share the page's own preview page (share/<key>.html, built by
    // scripts/share_pages.py): it names the page you're on, then forwards to it
    let pages = {};
    fetch('share/pages.json', { cache: 'no-cache' }).then(r => r.ok ? r.json() : {}).then(j => { pages = j || {}; }).catch(() => {});
    const shareUrl = () => {
      const route = decodeURIComponent(location.hash.replace(/^#/, '')) || 'now';
      const parts = route.split('/');
      for (let n = parts.length; n > 0; n--) {
        const r = parts.slice(0, n).join('/'), key = pages[r];
        if (key) return new URL(`share/${key}.html${r === route ? '' : '?to=' + encodeURIComponent(route)}`, location.href.split('#')[0]).href;
      }
      return location.href;
    };
    btn.addEventListener('click', async () => {
      const h = document.querySelector('#app h1');
      const title = (h ? h.textContent.trim().replace(/\s+/g, ' ') + ' · ' : '') + 'Footballpalooza';
      const url = shareUrl();
      if (navigator.share) { try { await navigator.share({ title, url }); } catch (e) {} return; }
      try { await navigator.clipboard.writeText(url); toast('Link copied'); } catch (e) { toast(url); }
    });
  })();   // pages use it to reset saved state after an update
  const app = document.getElementById('app');
  const state = { now: null, teams: {}, ppr: false, budgets: null, round: '1', themeTeam: '', mode: 'auto', open: new Set(), bylaws: null, blOpen: new Set() };
  try { state.ppr = localStorage.getItem('fbp-ppr') === '1'; state.themeTeam = localStorage.getItem('fbp-theme-team') || ''; state.defTeam = localStorage.getItem('fbp-default-team') || ''; state.mode = localStorage.getItem('fbp-mode') || 'auto'; } catch (e) {}
  // the default team (Settings) opens team pickers on that team; with none set, the page-colors team stands in, as before
  const myTeam = () => state.defTeam || state.themeTeam;
  const nameOf = id => ((state.now && state.now.standings.find(s => s.id === id)) || {}).name || (state.teams[id] || {}).abbr || id;

  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const rec = t => `${t.w}-${t.l}${t.t ? '-' + t.t : ''}`;
  const pts = v => Number(v).toFixed(1);
  function budget(id) {
    const B = state.budgets; if (!B) return null;
    const adj = (B.adjustments || []).filter(x => x.team === id).map(x => ({ amount: Number(x.amount || 0), note: x.note || '' }));
    (B.trades || []).forEach(tr => { if (tr.cash && id in tr.cash) adj.push({ amount: Number(tr.cash[id]), note: 'Trade:\n' + (tr.terms || []).map(l => '• ' + l).join('\n') }); });
    return { total: (B.default || 200) + adj.reduce((s, x) => s + Number(x.amount || 0), 0), adj };
  }

  function chip(id, opts = {}) {
    const tm = state.teams[id] || {}, row = (state.now && state.now.standings.find(s => s.id === id)) || {};
    const name = opts.name || row.name || id;
    const border = (tm.primary || '').toUpperCase() === '#FFFFFF' ? `;box-shadow:inset 0 0 0 1px ${tm.secondary}` : '';
    const abbr = tm.abbr ? `<span class="abbr" style="background:${tm.primary};color:${tm.secondary}${border}">${tm.abbr}</span>` : '';
    const logo = tm.logo && !opts.noLogo ? `<img src="${tm.logo}" alt="" loading="lazy">` : '';
    return `<span class="team">${logo}<span class="nm">${esc(name)}</span>${opts.abbr ? abbr : ''}${opts.after || ''}</span>`;
  }

  /* ---------- media and reference data (for any page) ----------
     Player photos and NFL logos come from ESPN's image server; the ids and lists are saved by the
     weekly refresh (see data/README.md). Use from any page, e.g.
       FBP.media.headshotFor('15253').then(url => ...)   // MFL player id -> photo URL ('' if none)
       FBP.media.name('15253').then(n => ...)             // MFL player id -> ESPN-style display name
       FBP.media.nflLogo('KCC')                           // MFL team code -> logo URL
       FBP.data('espn/injuries').then(list => ...)        // any saved file under data/            */
  const MFL_TO_ESPN = { GBP: 'GB', JAC: 'JAX', KCC: 'KC', LVR: 'LV', NEP: 'NE', NOS: 'NO', SFO: 'SF', TBB: 'TB', WAS: 'WSH' };
  const dataCache = {};
  const loadData = name => (dataCache[name] = dataCache[name] ||
    fetch(`data/${name}.json`, { cache: 'no-cache' }).then(r => { if (!r.ok) throw new Error(name); return r.json(); }));
  let playersById = null;
  const displayName = n => { n = (n || '').trim(); const i = n.indexOf(','); return i > 0 ? `${n.slice(i + 1).trim()} ${n.slice(0, i).trim()}` : n; };
  const media = {
    headshot: espnId => espnId ? `https://a.espncdn.com/i/headshots/nfl/players/full/${espnId}.png` : '',
    nflAbbr: team => MFL_TO_ESPN[team] || team,
    nflLogo: (team, dark) => team ? `https://a.espncdn.com/i/teamlogos/nfl/500${dark ? '-dark' : ''}/${media.nflAbbr(team).toLowerCase()}.png` : '',
    async player(mflId) {   // MFL player id -> {name, position, team, espn_id, draft_year, ...}
      if (!playersById) {
        const d = await loadData('mfl/players');
        playersById = {};
        Object.entries(d.players || {}).forEach(([id, row]) => {
          const o = {}; (d.fields || []).forEach((f, i) => { o[f] = row[i]; }); playersById[id] = o;
        });
      }
      return playersById[mflId] || null;
    },
    // the checked MFL -> ESPN link (data/player-links.json), falling back to MFL's own espn_id
    async link(mflId) {
      const L = await loadData('player-links').catch(() => ({ links: {} }));
      const l = (L.links || {})[mflId];
      if (l) return { espn: l[0], how: l[1], name: l[2] };
      const p = await media.player(mflId).catch(() => null);
      return p ? { espn: p.espn_id || '', how: p.espn_id ? 'mfl' : '', name: displayName(p.name) } : null;
    },
    async headshotFor(mflId) { const l = await media.link(mflId); return l && l.espn ? media.headshot(l.espn) : ''; },
    async name(mflId) { const l = await media.link(mflId); return l ? l.name : ''; },   // "Patrick Mahomes II", not "Mahomes, Patrick" 
    // <img> markup that removes itself if ESPN has no photo
    img: (url, cls = 'ph', alt = '') => url ? `<img class="${cls}" src="${url}" alt="${esc(alt)}" loading="lazy" onerror="this.remove()">` : '',
  };
  window.FBP = Object.assign(window.FBP || {}, { media, data: loadData });

  /* ---------- page colors (Settings) ---------- */
  const FBP_DEFAULT = { bg: '#bde2fa', fg: '#121519', hdrAccent: '#c8211a', logo: '#c8211a' };
  const hex2rgb = h => { h = h.replace('#', ''); if (h.length === 3) h = h.split('').map(c => c + c).join(''); return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16)); };
  const rgb2hex = a => '#' + a.map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
  const lum = h => { const [r, g, b] = hex2rgb(h).map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
  const contrast = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };
  const mix = (a, b, t) => { const A = hex2rgb(a), B = hex2rgb(b); return rgb2hex(A.map((v, i) => v + (B[i] - v) * t)); };
  const INK = '#121519', WHITE = '#ffffff';
  // header colors for a team: primary field, readable text, an accent for the tab underline and switch
  function teamHeader(tm) {
    let bg = tm.primary, other = tm.secondary;
    if (lum(bg) > 0.8) { bg = tm.secondary; other = tm.primary; }          // white primaries use their secondary as the field
    const plain = contrast(WHITE, bg) >= contrast(INK, bg) ? WHITE : INK;
    const fg = contrast(other, bg) >= 4.5 ? other : plain;
    const hdrAccent = contrast(other, bg) >= 2 && other !== fg ? other : fg;
    const logo = contrast(other, bg) >= 3 ? other : fg;   // wordmark: the team's second color when it reads, else the text color
    return { bg, fg, hdrAccent, logo };
  }
  // accent for numbers on the page: the team color that reads best on the page background, nudged until it reads
  function teamAccent(tm, dark) {
    const page = dark ? '#161b22' : '#ffffff', toward = dark ? WHITE : INK;
    const sat = h => { const [r, g, b] = hex2rgb(h).map(v => v / 255), mx = Math.max(r, g, b), mn = Math.min(r, g, b); return mx === 0 ? 0 : (mx - mn) / mx; };
    // the more colorful of the two team colors; near-black, white and grays lose to any real color
    let c = [tm.primary, tm.secondary].sort((a, b) => sat(b) - sat(a))[0];
    if (sat(c) < 0.25) c = [tm.primary, tm.secondary].sort((a, b) => contrast(b, page) - contrast(a, page))[0];
    for (let t = 0.1; contrast(c, page) < 3.2 && t <= 1; t += 0.1) c = mix(c, toward, 0.1 / (1.1 - t));
    return c;
  }
  const isDark = () => {
    const m = document.documentElement.dataset.theme;
    return m ? m === 'dark' : window.matchMedia('(prefers-color-scheme: dark)').matches;
  };
  function themeVars(teamId) {
    const tm = state.teams[teamId];
    if (!tm) return null;
    const h = teamHeader(tm);
    return { '--hdr-bg': h.bg, '--hdr-fg': h.fg, '--hdr-accent': h.hdrAccent, '--hdr-logo': h.logo, light: teamAccent(tm, false), dark: teamAccent(tm, true) };
  }
  function applyTheme() {
    const root = document.documentElement.style;
    const v = state.themeTeam ? themeVars(state.themeTeam) : null;
    ['--hdr-bg', '--hdr-fg', '--hdr-accent', '--hdr-logo', '--accent'].forEach(k => root.removeProperty(k));
    if (v) { ['--hdr-bg', '--hdr-fg', '--hdr-accent', '--hdr-logo'].forEach(k => root.setProperty(k, v[k])); root.setProperty('--accent', isDark() ? v.dark : v.light); }
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = v ? v['--hdr-bg'] : FBP_DEFAULT.bg;
    try { localStorage.setItem('fbp-theme-cache', JSON.stringify(v || {})); } catch (e) {}
  }
  function applyMode() {
    if (state.mode === 'light' || state.mode === 'dark') document.documentElement.dataset.theme = state.mode;
    else delete document.documentElement.dataset.theme;
    applyTheme();
  }

  /* ---------- Settings ---------- */
  function pageSettings() {
    const ids = Object.keys(state.teams).sort((a, b) => (nameOf(a)).localeCompare(nameOf(b)));
    const sw = (id, label, h, logo, dot) => `<button type="button" class="swatch" data-team="${id}" aria-pressed="${(state.themeTeam || '') === id}">
        <span class="bar" style="background:${h.bg};color:${h.fg};border-bottom-color:${h.hdrAccent}">${logo ? `<img src="${logo}" alt="">` : ''}<b>${esc(label.short)}</b></span>
        <span class="lbl"><span>${esc(label.full)}</span>${dot ? `<i class="dot" style="background:${dot}"></i>` : ''}</span></button>`;
    const swatches = [sw('', { short: 'FBP', full: 'Footballpalooza (default)' }, FBP_DEFAULT, 'assets/icon-192.png', '#c8211a')]
      .concat(ids.map(id => { const tm = state.teams[id]; return sw(id, { short: tm.abbr, full: nameOf(id) }, teamHeader(tm), tm.logo, teamAccent(tm, isDark())); })).join('');
    const seg = ['auto', 'light', 'dark'].map(m => `<button type="button" data-mode="${m}" aria-pressed="${state.mode === m}">${m === 'auto' ? 'Match device' : m[0].toUpperCase() + m.slice(1)}</button>`).join('');
    const dt = ids.map(id => { const tm = state.teams[id];
      return `<button type="button" data-defteam="${id}" aria-pressed="${state.defTeam === id}" title="${esc(nameOf(id))}">${tm.logo ? `<img src="${tm.logo}" alt="${esc(tm.abbr || id)}">` : `<span>${esc(tm.abbr || id)}</span>`}</button>`; }).join('');
    return `<div class="pagehead"><h1>Settings</h1><span class="asof">Saved on this device only</span></div>
      ${setSec('team', 'Default team', `<p>Pages with a team picker open on this team: Rosters, Stats and Projection accuracy on League Now, the Mock Draft, and Franchises in Reference. You can still pick any team on those pages.${state.defTeam ? ` <b>${esc(nameOf(state.defTeam))}</b> is your default.` : ''}</p>
        <div class="st-pick dt-pick" role="group" aria-label="Default team">${dt}</div>
        <div class="seg dt-clear"><button type="button" data-defteam="" aria-pressed="${!state.defTeam}">No default team</button></div>`)}
      ${setSec('colors', 'Page colors', `<p>Recolors the header, tabs and highlight numbers. Text stays neutral so everything stays readable.</p>
        <div class="swatches" role="group" aria-label="Page colors">${swatches}</div>`)}
      ${setSec('ticker', 'Ticker', `<p>The scrolling strip of league news. It keeps running as you move between pages. Run one line or two, each at the top or pinned to the bottom, with its own speed, direction and sections. Saved on this device.</p>
        <div class="seg" role="group" aria-label="Ticker"><button type="button" data-ticker="on" aria-pressed="${state.ticker}">Show</button><button type="button" data-ticker="off" aria-pressed="${!state.ticker}">Hide</button></div>
        ${state.ticker ? `<p class="tk-cfg-h">Lines</p>
        <div class="seg" role="group" aria-label="Ticker lines"><button type="button" data-tk-lines="1" aria-pressed="${tkLines() === 1}">One line</button><button type="button" data-tk-lines="2" aria-pressed="${tkLines() === 2}">Two lines</button></div>
        ${[0, 1].slice(0, tkLines()).map(tkRowCfg).join('')}` : ''}`)}
      ${setSec('mode', 'Light or dark', `<p>Match device follows your phone or computer’s setting.</p>
        <div class="seg" role="group" aria-label="Light or dark">${seg}</div>`)}
      ${changelog()}`;
  }
  // Change log (data/changelog.json): one entry for every five site versions, newest first; the latest one starts open
  let CL = null, clLoading = false;
  function changelog() {
    if (!CL) {
      if (!clLoading) { clLoading = true; fetch('data/changelog.json', { cache: 'no-cache' }).then(r => r.ok ? r.json() : { entries: [] })
        .then(j => { CL = j; if (location.hash === '#settings') route(); }).catch(() => { CL = { entries: [] }; }); }
      return '';
    }
    if (!(CL.entries || []).length) return '';
    return setSec('changelog', 'Change log', `<p>What’s new on the site, five versions at a time. You’re on v${esc(VERSION)}.</p>
      ${CL.entries.map((e, i) => `<details class="cl-e"${i ? '' : ' open'}><summary><b>v${esc(e.from)}–v${esc(e.to)}</b><small>${esc(e.dates)}</small></summary>
        <ul>${e.items.map(x => `<li>${esc(x)}</li>`).join('')}</ul></details>`).join('')}`, 'cl');
  }
  // Settings sections open and close; they start closed, and the ones you open are remembered on this device
  const SET_KEY = 'fbp-settings-open';
  const setOpen = () => { try { return new Set(JSON.parse(localStorage.getItem(SET_KEY) || '[]')); } catch (e) { return new Set(); } };
  function setSec(key, title, body, cls) {
    return `<details class="card set set-sec${cls ? ' ' + cls : ''}" data-set-sec="${key}"${setOpen().has(key) ? ' open' : ''}><summary><h2>${title}</h2></summary><div class="set-body">${body}</div></details>`;
  }
  document.addEventListener('toggle', e => {
    const d = e.target; if (!d.matches || !d.matches('[data-set-sec]')) return;
    const c = setOpen(); d.open ? c.add(d.dataset.setSec) : c.delete(d.dataset.setSec);
    try { localStorage.setItem(SET_KEY, JSON.stringify([...c])); } catch (err) {}
  }, true);

  /* ---------- League Now ---------- */
  function pageNow() {
    const d = state.now;
    const by = Object.fromEntries(d.standings.map(t => [t.id, t]));
    const seeds = d.seeds;
    const gen = new Date(d.fetched || d.generated);
    const genTxt = isNaN(gen) ? '' : gen.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

    const viaTxt = s => {
      const t = by[s.id];
      let base = s.via === 'division' ? `${t.divisionName} division leader` : s.via === 'wild card' ? 'Wild card' : `Most all-play wins (${t.allPlayW})`;
      const tb = s.via === 'division' ? (s.divisionTiebreak || s.tiebreak) : s.tiebreak;
      return base + (tb ? ` · <em>won tiebreak on ${tb}</em>` : '');
    };
    /* playoff odds panel, opened by tapping a team in Playoff picture, On the bubble or Long shots */
    const O = d.odds && d.odds.teams;
    const race = new Set(seeds.map(s => s.id));
    d.standings.filter(t => !race.has(t.id)).sort((a, b) => b.pct - a.pct || b.allPlayW - a.allPlayW || b.pf - a.pf).slice(0, 3).forEach(t => race.add(t.id));
    const fp = v => v == null ? '–' : v >= 99.5 ? '>99%' : v > 0 && v < 0.5 ? '<1%' : v === 0 ? '<1%' : Math.round(v) + '%';
    // change since last week's update: ▲ green (better), ▼ red (worse); nothing if it barely moved
    const P = d.prev && d.prev.teams, pw = d.prev && d.prev.week;
    const dlt = (id, key, cur) => {
      const was = P && P[id] && P[id][key];
      if (was == null || cur == null) return '';
      const x = Math.round(cur - was);
      return x >= 1 ? `<span class="dl up" title="Up ${x} points since week ${pw}">▲${x}</span>` : x <= -1 ? `<span class="dl dn" title="Down ${-x} points since week ${pw}">▼${-x}</span>` : '';
    };
    const rankMove = (id, key, cur) => {
      const was = P && P[id] && P[id][key];
      if (was == null || cur == null || was === cur) return P ? '<span class="dl">–</span>' : '';
      return was > cur ? `<span class="dl up" title="Up from ${was} in week ${pw}">▲${was - cur}</span>` : `<span class="dl dn" title="Down from ${was} in week ${pw}">▼${cur - was}</span>`;
    };
    const oddsKey = { 'Make playoffs': 'playoff', 'First-round bye': 'bye', '1 seed': 'seed1' };
    const ord = n => n + (['th', 'st', 'nd', 'rd'][(n % 100 > 10 && n % 100 < 14) ? 0 : (n % 10 < 4 ? n % 10 : 0)]);
    function oddsPanel(id, seed) {
      const o = O && O[id];
      if (!o) return `<div class="odds"><p class="onote">Playoff odds appear once the season has games left to play.</p></div>`;
      const t = by[id];
      const head = seed === 1 ? ['Chance to keep the 1 seed', o.seed1] : seed === 2 ? ['Chance to take the 1 seed', o.seed1]
        : seed === 3 ? ['Chance to win the ' + t.divisionName, o.division] : ['Chance to make the playoffs', o.playoff];
      const headKey = seed === 1 || seed === 2 ? 'seed1' : seed === 3 ? 'division' : 'playoff';
      const Pl = ['Make playoffs', o.playoff], B = ['First-round bye', o.bye], Dv = ['Win ' + t.divisionName, o.division], S1 = ['1 seed', o.seed1];
      const stats = seed && seed <= 2 ? [B, Dv, Pl] : seed === 3 ? [Pl, B, S1] : [Dv, B, S1];
      const m = seed && seed <= 2 ? 1 : 0, stakeTxt = m ? 'bye chances' : 'playoff chances';
      const games = o.ownGames.map(g => ({ ...g, swing: g.ifWin[m] - g.ifLoss[m] }));
      const big = games.slice().sort((a, b) => b.swing - a.swing).slice(0, 3).sort((a, b) => a.week - b.week);
      const tags = opp => [by[opp] && by[opp].division === t.division ? '<span class="tag">Division</span>' : '', race.has(opp) ? '<span class="tag">Playoff race</span>' : ''].join('');
      const gameRow = g => `<li><div class="gl"><b class="wk">Wk ${g.week}</b><span class="vs">vs</span>${chip(g.opp)}<span class="wp">${g.winProb}% to win</span></div>
          <div class="gs"><span class="w">Win <b>${fp(g.ifWin[m])}</b></span><span class="l">Loss <b>${fp(g.ifLoss[m])}</b></span><span class="tags">${tags(g.opp)}</span></div></li>`;
      const watch = (o.watch[m ? 'bye' : 'playoff'] || []).map(w => `<li><b class="wk">Wk ${w.week}</b><span class="wt">Root for <span class="inl">${chip(w.rootFor)}</span> over ${esc(nameOf(w.against))}</span><span class="sw">${Math.round(w.swing)}-pt swing</span></li>`).join('');
      const labels = ['1', '2', '3', '4', '5', '6', 'Out'];
      const dist = o.seeds.map((v, i) => `<div class="sd${i === 6 ? ' out' : ''}" style="--p:${Math.min(1, v / 60)}"><span>${labels[i]}</span><b>${fp(v)}</b></div>`).join('');
      const games_left = t.w + t.l + t.t + o.ownGames.length;
      const projL = Math.max(0, games_left - o.projW - t.t);
      return `<div class="odds">
        <div class="ohead"><b>${fp(head[1])}</b>${dlt(id, headKey, head[1])}<span>${esc(head[0])}</span></div>
        ${elimTxt(id) ? `<p class="onote">${elimTxt(id).replace(/ · $/, '')}</p>` : ''}
        <div class="ostats">${stats.map(x => `<div><b>${fp(x[1])} ${dlt(id, oddsKey[x[0]] || 'division', x[1])}</b><span>${esc(x[0])}</span></div>`).join('')}</div>
        <h4>Where they finish</h4><div class="dist">${dist}</div>
        <p class="onote">Projected record about ${o.projW.toFixed(1)}–${projL.toFixed(1)}${t.t ? `–${t.t}` : ''}${o.sosRank ? ` · remaining schedule is the ${o.sosRank === 1 ? 'toughest' : o.sosRank === 12 ? 'easiest' : ord(o.sosRank) + ' toughest'} in the league` : ''}</p>
        ${big.length ? `<h4>Biggest games <small>their ${stakeTxt} after a win or loss</small></h4><ul class="glist">${big.map(gameRow).join('')}</ul>` : ''}
        ${watch ? `<h4>Games to watch <small>other results that move their ${stakeTxt}</small></h4><ul class="wlist">${watch}</ul>` : ''}
        <p class="onote">From ${(d.odds.model.sims).toLocaleString()} simulated finishes of weeks ${d.weeksPlayed + 1}–${d.lastRegularSeasonWeek}, using each team’s scoring so far and the by-law tiebreaks.</p>
        ${fullSchedule(id, games, gameRow)}
      </div>`;
    }
    // the team's whole regular season: results so far, then the games left (with what each one means)
    // opponent as just its logo (name on hover / for screen readers), so schedule rows stay one line on phones
    const logoOnly = id => { const tm = state.teams[id] || {}; return tm.logo ? `<img class="gl-lg" src="${tm.logo}" alt="${esc(nameOf(id))}" title="${esc(nameOf(id))}" loading="lazy">` : `<span class="team"><span class="nm">${esc(nameOf(id))}</span></span>`; };
    // home game "vs", road game "@" (from MFL's schedule; plain "vs" if unknown)
    const va = (id, wk) => { const h = d.homeWeeks && d.homeWeeks[id]; return !h || h.includes(+wk) ? 'vs' : '@'; };
    function fullSchedule(id, left, gameRow) {
      const played = (d.games || []).filter(g => g[1] === id || g[3] === id).map(g => {
        const me = g[1] === id, mine = me ? g[2] : g[4], theirs = me ? g[4] : g[2], opp = me ? g[3] : g[1];
        const r = mine > theirs ? 'W' : mine < theirs ? 'L' : 'T';
        return { week: g[0], html: `<li class="done"><div class="gl"><b class="wk">Wk ${g[0]}</b><span class="vs">${va(id, g[0])}</span>${logoOnly(opp)}<span class="res ${r}">${r} ${pts(mine)}–${pts(theirs)}</span></div></li>` };
      });
      // upcoming weeks: same row as Biggest games, with the opponent shown by logo only
      const rows = played.concat(left.map(g => ({ week: g.week, html: gameRow(g).replace(chip(g.opp), logoOnly(g.opp)).replace('<span class="vs">vs</span>', `<span class="vs">${va(id, g.week)}</span>`) }))).sort((a, b) => a.week - b.week);
      if (!rows.length) return '';
      return `<details class="all"><summary>Full schedule <small>${played.length} played · ${left.length} to go</small></summary><ul class="glist">${rows.map(r => r.html).join('')}</ul></details>`;
    }
    const tmWrap = (id, rowCls, inner, seed) => {
      const open = state.open.has(id);
      return `<div class="tm${open ? ' open' : ''}"><button type="button" class="${rowCls}" data-odds="${id}" aria-expanded="${open}">${inner}</button>${open ? oddsPanel(id, seed) : ''}</div>`;
    };
    // mathematically closed playoff paths (scripts/eliminations.py): {division, wildCard, allPlay: week or null, all}
    const PATHS = [['division', 'Div', 'the division title'], ['wildCard', 'WC', 'a wild card'], ['allPlay', '6', 'the all-play 6 seed']];
    const elimOf = id => (by[id] && by[id].eliminated) || {};
    const elimTag = id => {
      const e = elimOf(id);
      if (e.all) return `<span class="ex out" title="Eliminated from the playoffs in week ${e.all}">Out</span>`;
      const shut = PATHS.filter(([k]) => e[k]);
      return shut.length ? `<span class="ex" title="${shut.map(([k, , l]) => `Out of the race for ${l} (week ${e[k]})`).join('\n')}">${shut.map(([, s]) => '✕' + s).join(' ')}</span>` : '';
    };
    const elimTxt = id => {
      const e = elimOf(id);
      if (e.all) return `<span class="ext">Eliminated in week ${e.all}</span> · `;
      const shut = PATHS.filter(([k]) => e[k]);
      return shut.length ? `<span class="ext">Out of the race for ${shut.map(([k, , l]) => `${l} (wk ${e[k]})`).join(', ')}</span> · ` : '';
    };
    const rowOdds = id => O && O[id] ? ` · <span class="ro">${fp(O[id].playoff)} playoffs ${dlt(id, 'playoff', O[id].playoff)}</span>` : '';
    const seedRows = seeds.map(s => {
      const t = by[s.id];
      return tmWrap(s.id, `seed${s.seed <= 2 ? ' bye' : ''}`, `<span class="n">${s.seed}</span>${chip(s.id)}<span class="rec">${rec(t)}<i class="car" aria-hidden="true"></i></span>
        <span class="via">${viaTxt(s)} · ${pts(t.pf)} pts${rowOdds(s.id)}</span>`, s.seed);
    }).join('');

    const g = (a, b, lbl) => `<div class="game">${lbl ? `<div class="lbl">${lbl}</div>` : ''}${[a, b].map(x =>
      x ? `<div class="row"><span class="sd">${x.seed}</span>${chip(x.id)}<span class="meta">${rec(by[x.id])} · ${pts(by[x.id].pf)}</span></div>` : `<div class="row"><span class="sd"></span><span class="tbd">Winner advances</span></div>`).join('')}</div>`;
    const S = n => seeds[n - 1];
    const bracket = `<div class="bracket">
      <div class="round"><h3>Week 15 · Round 1</h3>${g(S(3), S(6))}${g(S(4), S(5))}</div>
      <div class="round"><h3>Week 16 · Semifinals</h3>${g(S(1), null, 'vs lowest seed left')}${g(S(2), null, 'vs highest seed left')}</div>
      <div class="round"><h3>Week 17 · Finals</h3>${g(null, null, 'Championship')}${g(null, null, '3rd-place game')}</div>
    </div>`;

    const inPo = new Set(seeds.map(s => s.id));
    const s5 = by[S(5).id], s6 = by[S(6).id];
    const outside = d.standings.filter(t => !inPo.has(t.id))
      .sort((a, b) => b.pct - a.pct || b.allPlayW - a.allPlayW || b.pf - a.pf);
    const bubble = outside.slice(0, 3)
      .map(t => {
        const gb = ((s5.w - t.w) + (t.l - s5.l)) / 2;
        const apb = s6.allPlayW - t.allPlayW;
        return tmWrap(t.id, 'seed bubrow', `${chip(t.id)}<span class="rec">${rec(t)}<i class="car" aria-hidden="true"></i></span>
          <span class="via">${elimTxt(t.id)}${gb <= 0 ? 'Tied for seed 5' : `${gb} GB of seed 5`} · ${apb <= 0 ? 'tied with seed 6 in all-play wins' : `${apb} all-play wins behind seed 6`} · ${pts(t.pf)} pts${rowOdds(t.id)}</span>`, null);
      }).join('');

    /* the last three teams: their odds plus a weekly pep talk */
    const PEP = [
      ['It ain’t over till it’s over.', 'Yogi Berra'],
      ['So you’re telling me there’s a chance!', 'Lloyd Christmas, Dumb and Dumber'],
      ['Fall seven times, stand up eight.', 'Japanese proverb'],
      ['Hope is a good thing, maybe the best of things.', 'Andy Dufresne, The Shawshank Redemption'],
      ['You miss 100% of the shots you don’t take.', 'Wayne Gretzky'],
      ['Just keep swimming.', 'Dory, Finding Nemo'],
      ['Tough times never last, but tough people do.', 'Robert H. Schuller'],
      ['The darkest hour is just before the dawn.', 'Proverb'],
      ['Playoffs? Don’t talk about — playoffs?!', 'Jim Mora'],
      ['Rome wasn’t built in a day.', 'Proverb'],
    ];
    const longshots = outside.slice(3, 6).map((t, i) => {
      const gb = ((s5.w - t.w) + (t.l - s5.l)) / 2;
      const apb = s6.allPlayW - t.allPlayW;
      const o = O && O[t.id];
      const [q, who] = PEP[(d.weeksPlayed * 3 + i) % PEP.length];
      const odds = o ? (o.playoff >= 0.5 ? `<b>${fp(o.playoff)}</b> playoff odds ${dlt(t.id, 'playoff', o.playoff)}` : '<b>&lt;1%</b> playoff odds · miracle territory') : '';
      return tmWrap(t.id, 'seed bubrow', `${chip(t.id)}<span class="rec">${rec(t)}<i class="car" aria-hidden="true"></i></span>
        <span class="via">${elimTxt(t.id)}${odds && !elimOf(t.id).all ? odds + ' · ' : ''}${gb <= 0 ? 'Tied for seed 5' : `${gb} GB of seed 5`} · ${apb <= 0 ? 'tied with seed 6 in all-play wins' : `${apb} all-play wins behind seed 6`}</span>
        <span class="pep">“${esc(q)}” <span class="who">— ${esc(who)}</span></span>`, null);
    }).join('');

    // scoring average over each team's last three games
    const l3 = id => { const sc = (d.games || []).filter(g => g[1] === id || g[3] === id).sort((x, y) => x[0] - y[0]).slice(-3).map(g => g[1] === id ? g[2] : g[4]);
      return sc.length ? pts(sc.reduce((a, b) => a + b, 0) / sc.length) : '—'; };
    const divTables = d.divisions.map(dv => {
      const rows = d.standings.filter(t => t.division === dv.id).sort((a, b) => a.divisionRank - b.divisionRank);
      const gb = v => v <= 0 ? '—' : (Number.isInteger(v) ? v : v.toFixed(1));
      // points back: total points behind the league's top scorer
      const top = Math.max(...d.standings.map(x => x.pf)), pb = t => t.pf >= top ? '—' : pts(top - t.pf);
      return `<div class="card"><h3 class="dvh">${esc(dv.name)}</h3><div class="tbl-wrap"><table class="tbl">
        <thead><tr><th class="lg"><span class="sr">Logo</span></th><th class="t">Team</th><th>W-L-T</th><th>GB</th><th class="hide-sm">Pct</th><th class="hide-sm" title="Division record">Div</th>
          <th>PF</th><th class="hide-sm">PA</th><th title="Points back: total points behind the league's top scorer">PB</th><th class="hide-sm" title="Points scored per game">PF Avg</th><th class="hide-sm" title="Points allowed per game">PA Avg</th><th title="Average points over the last three games">L3 Avg</th><th class="hide-sm" title="Potential points (best possible lineup)">PP</th>
          <th title="All-play record: results against every team, every week">All-play</th><th class="hide-sm">Strk</th>${state.budgets ? `<th title="${state.budgets.season} auction budget, after trades">${state.budgets.season} $</th>` : ''}</tr></thead><tbody>
        ${rows.map(t => `<tr class="st-go" data-go="#now/rosters/${t.id}" tabindex="0" title="${esc(t.name)} roster"><td class="lg">${(state.teams[t.id] || {}).logo ? `<img src="${state.teams[t.id].logo}" alt="" loading="lazy">` : ''}</td><td class="t">${chip(t.id, { noLogo: true, after: (t.seed ? `<span class="pill${t.seed > 3 ? ' wc' : ''}" title="Current playoff seed">${t.seed}</span>` : '') + elimTag(t.id) })}</td>
          <td>${t.w}-${t.l}-${t.t}</td><td>${gb(t.gb)}</td><td class="hide-sm">${t.pct.toFixed(3).replace(/^0/, '')}</td><td class="hide-sm">${esc(t.divRecord || '')}</td>
          <td>${pts(t.pf)}</td><td class="hide-sm">${pts(t.pa)}</td><td>${pb(t)}</td><td class="hide-sm">${pts(t.avgPf)}</td><td class="hide-sm">${(() => { const g = t.w + t.l + t.t; return g ? pts(t.pa / g) : '—'; })()}</td><td>${l3(t.id)}</td><td class="hide-sm">${pts(t.pp)}</td>
          <td>${t.allPlayW}-${t.allPlayL}${t.allPlayT ? '-' + t.allPlayT : ''}</td><td class="hide-sm">${esc(t.streak)}</td>${state.budgets ? (() => { const bg = budget(t.id); const tip = bg.adj.length ? bg.adj.map(x => `${x.amount < 0 ? '−' : '+'}$${Math.abs(x.amount)} ${x.note}`).join('\n\n') : 'No adjustments yet'; return `<td class="bud${bg.total < (state.budgets.default || 200) ? ' chg' : bg.total > (state.budgets.default || 200) ? ' up' : ''}" title="${esc(tip)}">$${bg.total}</td>`; })() : ''}</tr>`).join('')}
        </tbody></table></div></div>`;
    }).join('');

    // the all-play 6 seed: best all-play record among teams that aren't division winners or wild cards
    const top5 = new Set(seeds.slice(0, 5).map(s => s.id));
    const sixRace = d.standings.filter(t => !top5.has(t.id)).sort((a, b) => b.allPlayW - a.allPlayW || b.pf - a.pf);
    const lead = sixRace[0];
    const sixRows = sixRace.slice(0, 5).map((t, i) => {
      const gap = lead.allPlayW - t.allPlayW, o = O && O[t.id];
      return `<div class="six${i === 0 ? ' hold' : ''}"><span class="n">${i === 0 ? '6' : ''}</span>${chip(t.id, { after: elimTag(t.id) })}
        <span class="ap"><b>${t.allPlayW}-${t.allPlayL}${t.allPlayT ? '-' + t.allPlayT : ''}</b><small>${i === 0 ? 'holds the 6 seed' : gap ? `${gap} behind` : 'tied'}</small></span>
        <span class="sx">${o ? `<b>${fp(o.seeds[5])}</b>${dlt(t.id, 'seed6', o.seeds[5])}<small>chance at 6</small>` : ''}</span></div>`;
    }).join('');

    // Power Rankings: the FBP Power Score (assets/power.js), then MFL's power rating for comparison
    const pr = d.standings.slice().sort((a, b) => (a.pwrRank || 99) - (b.pwrRank || 99));
    const hasPwr = pr.some(t => t.pwr);
    const powerRows = pr.map((t, i) => `<tr><td class="pr-n">${t.pwrRank || i + 1}</td><td class="pr-mv">${rankMove(t.id, 'pwrRank', t.pwrRank)}</td>
      <td class="lg">${(state.teams[t.id] || {}).logo ? `<img src="${state.teams[t.id].logo}" alt="" loading="lazy">` : ''}</td><td class="t">${chip(t.id, { noLogo: true })}</td>
      <td><b>${t.pwr ? t.pwr.toFixed(2) : '—'}</b></td><td>${t.w}-${t.l}${t.t ? '-' + t.t : ''}</td><td>${pts(t.pf)}</td><td class="hide-sm">${t.allPlayW}-${t.allPlayL}${t.allPlayT ? '-' + t.allPlayT : ''}</td><td class="hide-sm">${esc(t.streak)}</td></tr>`).join('');

    const sub = (location.hash.split('/')[1] || '');
    const nav = `<nav class="rf-sub seg now-sub ln-sub pg-nav">${[['', 'Standings'], ['rosters', 'Rosters'], ['stats', 'Stats'], ['matchups', 'Matchups'], ['power', 'Power<span class="lg-only"> Rankings</span>'], ['playoffs', 'Playoff<span class="sm-only">s</span><span class="lg-only"> Picture</span>'], ['analytics', 'Analytics'], ['hospital', 'Hospital']].map(([k, l]) => `<a href="#now${k ? '/' + k : ''}"${k === sub ? ' aria-current="page"' : ''}>${l}</a>`).join('')}</nav>`;
    const headTxt = `<div class="pagehead"><h1>League Now</h1>
        <span class="asof"><b>Through Week ${d.weeksPlayed}</b> of ${d.lastRegularSeasonWeek}${state.meta && state.meta.fetched ? ` · <span id="ln-refresh">${esc(refreshText(true))}</span>` : genTxt ? ` · updated ${genTxt}` : ''}${P ? ` · arrows show change since week ${pw}` : ''}</span></div>${nav}`;

    // the FBP Power Score is in Beta (#beta/power) while projected keepers are being tuned
    if (sub === 'power') return headTxt + `
      <section><h2 class="sec">MFL Power Rating <small>MFL’s own formula · our FBP Power Score is being tuned in <a href="#beta/power">Beta</a></small></h2>
      ${hasPwr ? `<div class="card tbl-wrap"><table class="tbl pr-tbl"><thead><tr><th>#</th><th><span class="sr">Change</span></th><th class="lg"><span class="sr">Logo</span></th><th class="t">Team</th><th title="MFL power rating">Rating</th><th>Record</th><th>PF</th><th class="hide-sm">All-play</th><th class="hide-sm">Strk</th></tr></thead><tbody>${powerRows}</tbody></table></div>`
        : '<div class="card soon"><p>Power rankings fill in after the next weekly refresh.</p></div>'}
      ${P ? '' : '<p class="rf-foot">Movement arrows start with the second weekly refresh that has rankings saved.</p>'}</section>`;

    if (sub === 'playoffs') return headTxt + `
      <div class="grid2">
        <section><h2 class="sec">Playoff picture <small>if the season ended today${O ? ' · tap a team for its odds and schedule' : ''}</small></h2>
          <div class="card seeds">${seedRows}</div>
          <h2 class="sec" style="margin-top:16px">On the bubble</h2>
          <div class="card seeds">${bubble}</div>
          ${longshots ? `<h2 class="sec" style="margin-top:16px">Long shots <small>still breathing, technically</small></h2>
          <div class="card seeds">${longshots}</div>` : ''}
        </section>
        <section><h2 class="sec">Bracket</h2><div class="card">${bracket}</div>
          <h2 class="sec" style="margin-top:16px">All-play 6 seed race <small>most all-play wins among everyone not in seeds 1–5</small></h2>
          <div class="card sixrace">${sixRows}</div>
          <p class="rf-foot">All-play counts a win against every team you outscored that week. Ties on all-play wins go to total points, then record.</p></section>
      </div>`;

    if (sub === 'matchups') return headTxt + pageMatchups(fp);
    if (sub === 'stats') return headTxt + (window.FBPStats ? FBPStats.render({ teams: state.teams, esc, myTeam: myTeam(), rerender: () => { if (location.hash.startsWith('#now/stats')) route(); } }) : '');
    if (sub === 'rosters') return headTxt + (window.FBPRosters ? FBPRosters.render({ teams: state.teams, esc, nameOf, myTeam: myTeam(),
      rerender: () => { if (location.hash.startsWith('#now/rosters')) route(); } }, location.hash.split('/')[2] || '', location.hash.split('/')[3] || '') : '<p class="error">Rosters didn’t load.</p>');
    if (sub === 'analytics') return headTxt + (window.FBPAnalytics ? FBPAnalytics.render({ teams: state.teams, esc, myTeam: myTeam(), rerender: () => { if (location.hash.startsWith('#now/analytics')) route(); } }) : '<p class="error">Analytics didn’t load.</p>');
    if (sub === 'hospital') return headTxt + (window.FBPHospital ? FBPHospital.render({ teams: state.teams, esc, rerender: () => { if (location.hash.startsWith('#now/hospital')) route(); } }) : '<p class="error">The hospital didn’t load.</p>');
    if (sub === 'column') return pageColumn(location.hash.split('/')[2] || '');
    return headTxt + pressBox() + `
      <section><h2 class="sec">Standings <small>division order uses the by-law tiebreaks</small></h2><div class="divs">${divTables}</div>
      ${d.standings.some(t => t.eliminated && (t.eliminated.division || t.eliminated.wildCard || t.eliminated.allPlay)) ? `<p class="rf-foot"><span class="ex">✕Div</span> <span class="ex">✕WC</span> <span class="ex">✕6</span> that path to the playoffs is mathematically closed (division title, wild card, all-play 6 seed). <span class="ex out">Out</span> every path is closed. Tap or hover a tag for the week it happened.</p>` : ''}</section>`;
  }

  /* ---------- From the press box: the weekly column (data/columns.json, built by scripts/build_columns.py) ---------- */
  function loadColumns() {
    if (state.columns || state.columnsLoading) return;
    state.columnsLoading = true;
    fetch('data/columns.json', { cache: 'no-cache' }).then(r => r.ok ? r.json() : null).catch(() => null)
      .then(j => { state.columns = j || { columns: [], columnists: {} }; if (location.hash === '' || location.hash.startsWith('#now') || location.hash.startsWith('#press')) route(); ticker(); });
  }
  const colDate = d => { const t = new Date(d + 'T12:00:00'); return isNaN(t) ? d : t.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }); };
  function colAvatar(a, big) {
    const ini = (a.name || '?').split(' ').map(w => w[0]).join('').slice(0, 2);
    return a.photo ? `<img class="col-av${big ? ' big' : ''}" src="${a.photo}" alt="">` : `<span class="col-av${big ? ' big' : ''}" aria-hidden="true">${esc(ini)}</span>`;
  }
  // how long ago a column ran: Today, Yesterday, 3 days ago, then the date after a week
  const colAgo = d => {
    const t = new Date(d + 'T12:00:00'); if (isNaN(t)) return d;
    const n = new Date(); n.setHours(12, 0, 0, 0);
    const days = Math.round((n - t) / 864e5);
    return days <= 0 ? 'Today' : days === 1 ? 'Yesterday' : days < 7 ? `${days} days ago` : colDate(d);
  };
  // front page: the latest columns, newest first. The newest leads with its photo (about half the screen wide on a
  // phone); the next two sit underneath as compact one-line links.
  function pressBox() {
    if (!state.columns) { loadColumns(); return ''; }
    const C = state.columns.columns.slice(0, 3); if (!C.length) return '';
    const who = c => (state.columns.columnists[c.author] || { name: c.author }).name;
    return `<section class="col-heads"><h2 class="col-hk">From the press box</h2><ul>${C.map((c, i) => i === 0
      ? `<li class="col-feat"><a href="#now/column/${c.slug}">${c.image ? `<img class="col-fimg" src="${esc(c.image)}" alt="${esc(c.caption || '')}" loading="lazy">` : ''}<span class="col-ftxt"><span class="col-hkick">${esc(c.kicker)}</span><b>${esc(c.title)}</b>${c.teaser ? `<span class="col-ftz">${esc(c.teaser)}</span>` : ''}<span class="col-fby">${esc(who(c))} · ${colAgo(c.date)}</span></span></a></li>`
      : `<li><a href="#now/column/${c.slug}"><span class="col-hkick">${esc(c.kicker)}</span><b>${esc(c.title)}</b></a><span class="col-side"><span class="col-ago">${colAgo(c.date)}</span></span></li>`).join('')}</ul><a class="col-all" href="#press">All ${state.columns.columns.length} articles in the Press Box →</a></section>`;
  }
  function pageColumn(slug) {
    if (!state.columns) { loadColumns(); return '<p class="loading">Loading the column…</p>'; }
    const C = state.columns.columns, c = C.find(x => x.slug === slug) || C[0];
    if (!c) return '<p class="error">No column yet.</p>';
    const a = state.columns.columnists[c.author] || { name: c.author };
    const more = C.filter(x => x.slug !== c.slug).slice(0, 6);
    return `<article class="col-page">
      <a class="col-back" href="#press">← Press Box</a>
      <p class="col-kick">From the press box · ${esc(c.kicker)}</p>
      <h1 class="col-h1">${esc(c.title)}</h1>
      ${c.image ? `<figure class="col-hero"><img src="${esc(c.image)}" alt="${esc(c.caption || '')}">${c.caption || c.credit ? `<figcaption>${esc(c.caption || '')}${c.credit ? ` <span>${esc(c.credit)}</span>` : ''}</figcaption>` : ''}</figure>` : ''}
      <div class="col-byline">${colAvatar(a, true)}<span><b>${esc(a.name)}</b><small>${esc(a.title || '')} · ${colDate(c.date)} · ${c.minutes} min read</small></span></div>
      <div class="col-body">${c.html}</div>
      ${a.bio ? `<p class="col-bio">${colAvatar(a)}<span><b>${esc(a.name)}</b> ${esc(a.bio)}</span></p>` : ''}
      ${more.length ? `<h2 class="sec">More from the press box</h2><div class="card col-more">${more.map(x => `<a href="#now/column/${x.slug}"><b>${esc(x.title)}</b><small>${esc(x.kicker)} · ${colDate(x.date)}</small></a>`).join('')}</div><a class="col-all" href="#press">Every article in the Press Box →</a>` : ''}
    </article>`;
  }

  /* ---------- Press Box (#press): every column, newest first, grouped by week; tap a writer to filter ---------- */
  let pbWho = '';
  function pagePress() {
    if (!state.columns) { loadColumns(); return '<p class="loading">Loading the Press Box…</p>'; }
    const all = state.columns.columns, W = state.columns.columnists;
    if (!all.length) return '<div class="card soon"><h2>Press Box</h2><p>No columns yet.</p></div>';
    const who = [...new Set(all.map(c => c.author))];
    if (pbWho && !who.includes(pbWho)) pbWho = '';
    const C = pbWho ? all.filter(c => c.author === pbWho) : all;
    const person = k => W[k] || { name: k };
    const card = (c, lead) => { const a = person(c.author);
      return `<a class="pb-card${lead ? ' pb-lead' : ''}${c.image ? ' has-img' : ''}" href="#now/column/${c.slug}">
        ${c.image ? `<span class="pb-img"><img src="${esc(c.image)}" alt="" loading="lazy"></span>` : ''}
        <span class="pb-txt"><span class="col-hkick">${esc(c.kicker)}</span><b>${esc(c.title)}</b>${c.teaser ? `<span class="pb-teas">${esc(c.teaser)}</span>` : ''}
        <span class="pb-by">${colAvatar(a)}<span>${esc(a.name)} · ${colAgo(c.date)} · ${c.minutes} min read</span></span></span></a>`; };
    const weeks = []; C.forEach((c, i) => { if (i === 0 && !pbWho) return; const k = `${c.season}-${c.week}`; let g = weeks.find(x => x.k === k); if (!g) weeks.push(g = { k, w: c.week, list: [] }); g.list.push(c); });
    return `<section class="pb">
      <h1 class="pb-h1">Press Box</h1>
      <p class="pb-sub">Recaps, previews, the trade desk and the rumor mill, from the FBP press box.</p>
      <div class="pb-who" role="group" aria-label="Filter by writer"><button type="button" data-pb-who=""${pbWho ? '' : ' aria-pressed="true"'}>Everyone</button>${who.map(k => `<button type="button" data-pb-who="${esc(k)}"${pbWho === k ? ' aria-pressed="true"' : ''}>${colAvatar(person(k))}${esc(person(k).name)}</button>`).join('')}</div>
      ${pbWho ? '' : card(C[0], true)}
      ${weeks.map(g => `<h2 class="sec">Week ${g.w}</h2><div class="pb-list">${g.list.map(c => card(c)).join('')}</div>`).join('')}
    </section>`;
  }
  document.addEventListener('click', e => { const b = e.target.closest('[data-pb-who]'); if (!b) return; pbWho = b.dataset.pbWho; route(); });

  /* ---------- Matchups: this week's games with a head-to-head breakdown (data/matchups.json, built by scripts/matchups.py) ---------- */
  function loadMatchups() {
    if (state.mu || state.muLoading) return;
    state.muLoading = true;
    fetch('data/matchups.json', { cache: 'no-cache' }).then(r => r.ok ? r.json() : null).catch(() => null)
      .then(j => { state.mu = j || { games: [] }; if (location.hash.startsWith('#now/matchups')) route(); });
  }
  function pageMatchups(fp) {
    if (!state.mu) { loadMatchups(); return '<p class="loading">Loading the matchups…</p>'; }
    const M = state.mu;
    if (!M.week || !M.games.length) return '<div class="card soon"><p>Matchups return when the next regular-season week is set.</p></div>';
    const short = id => (state.teams[id] || {}).abbr || nameOf(id);
    const logo = (id, cls = 'mu-lg') => { const tm = state.teams[id] || {}; return tm.logo ? `<img class="${cls}" src="${tm.logo}" alt="" loading="lazy">` : ''; };
    const yw = r => `${r.y} · Wk ${r.w}`;
    const seedTxt = t => t.seed ? `${t.seed} seed` : 'out of the playoffs';
    // one tale-of-the-tape row: a value | label | b value, the better side in bold
    const row = (lbl, va, vb, better) => {
      const b = better === 'hi' ? (va > vb ? 'a' : vb > va ? 'b' : '') : better === 'lo' ? (va < vb ? 'a' : vb < va ? 'b' : '') : '';
      const f = v => v == null ? '–' : typeof v === 'number' ? pts(v) : esc(v);
      return `<div class="mu-r"><span class="${b === 'a' ? 'bt' : ''}">${f(va)}</span><small>${lbl}</small><span class="${b === 'b' ? 'bt' : ''}">${f(vb)}</span></div>`;
    };
    const card = g => {
      const a = g.teams[g.away], b = g.teams[g.home], s = g.series;
      const sw = s.w[g.away], sl = s.w[g.home];
      const lead = sw === sl ? `Series tied ${sw}-${sl}${s.t ? '-' + s.t : ''}` : `${esc(nameOf(sw > sl ? g.away : g.home))} leads ${Math.max(sw, sl)}-${Math.min(sw, sl)}${s.t ? '-' + s.t : ''}`;
      const strk = s.streak ? (s.streak.n >= 2 ? `${esc(nameOf(s.streak.id))} has won ${s.streak.n} straight` : `${esc(nameOf(s.streak.id))} won the last one`) : '';
      const big = [g.away, g.home].map(id => s.biggest[id] ? `<li>${logo(id, 'mu-ic')}<span><b>${esc(nameOf(id))}</b> by ${pts(s.biggest[id].margin)} <small>${s.biggest[id].score} · ${yw(s.biggest[id])}</small></span></li>` : '').join('');
      const po = s.playoff.length ? `<p class="mu-po">Playoff history: ${s.playoff.map(r => `${esc(r.kind.replace('Playoffs · ', ''))} ${r.y}, ${esc(short(r.win))} won ${pts(Math.max(r.sa, r.sb))}-${pts(Math.min(r.sa, r.sb))}`).join(' · ')}</p>` : '';
      const stRow = (id, t) => t.ifWin ? `<tr><td class="t">${logo(id, 'mu-ic')}<span>${esc(short(id))}</span></td><td class="w">${fp(t.ifWin[0])}</td><td class="l">${fp(t.ifLoss[0])}</td><td class="w">${fp(t.ifWin[1])}</td><td class="l">${fp(t.ifLoss[1])}</td></tr>` : '';
      const meet = s.recent.map(r => `<li><b class="wk">${yw(r)}</b>${r.kind !== 'Regular season' ? `<span class="tag">${esc(r.kind.replace('Playoffs · ', ''))}</span>` : ''}
          <span class="mu-sc"><span class="${r.win === g.away ? 'bt' : ''}">${esc(short(g.away))} ${pts(r.sa)}</span> – <span class="${r.win === g.home ? 'bt' : ''}">${pts(r.sb)} ${esc(short(g.home))}</span></span></li>`).join('');
      return `<article class="card mu">
        ${g.gotw || s.divisionGame ? `<div class="mu-tags">${g.gotw ? '<span class="mu-gotw">Game of the week</span>' : ''}${s.divisionGame ? '<span class="tag">Division</span>' : ''}</div>` : ''}
        <div class="mu-head">
          <div class="mu-t">${logo(g.away)}<b>${esc(nameOf(g.away))}</b><small>${rec(a)} · ${seedTxt(a)}</small></div>
          <div class="mu-at">at</div>
          <div class="mu-t">${logo(g.home)}<b>${esc(nameOf(g.home))}</b><small>${rec(b)} · ${seedTxt(b)}</small></div>
        </div>
        ${a.winProb != null ? `<div class="mu-wp"><span>${a.winProb}%</span><div class="mu-bar"><i style="width:${a.winProb}%"></i></div><span>${b.winProb}%</span></div><p class="mu-cap">Win chance</p>` : ''}
        <div class="mu-tape">
          ${a.proj != null && b.proj != null ? row('Projected this week', a.proj, b.proj, 'hi') : ''}
          ${row('Points', a.pf, b.pf, 'hi')}
          ${row('League rank', ord(a.pfRank), ord(b.pfRank))}
          ${row('Per week', a.avg, b.avg, 'hi')}
          ${row('Last 3 weeks', a.last3, b.last3, 'hi')}
          ${row('Best week', a.high, b.high, 'hi')}
          ${row('Worst week', a.low, b.low, 'hi')}
          ${row('All-play', a.allPlay, b.allPlay)}
          ${row('Streak', a.streak, b.streak)}
        </div>
        <div class="mu-ser"><h4>Head to head <small>since ${M.since}, playoffs included</small></h4>
          <p class="mu-lead"><b>${lead}</b>${strk ? ` · ${strk}` : ''}</p>
          <p class="mu-avg">Average score in the series: ${esc(short(g.away))} ${pts(s.avg[g.away])}, ${esc(short(g.home))} ${pts(s.avg[g.home])}</p>
          ${big ? `<p class="mu-bigh">Largest victory in the series</p><ul class="mu-big">${big}</ul>` : ''}${po}
        </div>
        ${a.ifWin || b.ifWin ? `<div class="mu-stakes"><h4>What's at stake</h4><table class="mu-stt"><thead><tr><th></th><th colspan="2">Playoffs</th><th colspan="2">Bye</th></tr>
          <tr><th></th><th>Win</th><th>Loss</th><th>Win</th><th>Loss</th></tr></thead><tbody>${stRow(g.away, a)}${stRow(g.home, b)}</tbody></table></div>` : ''}
        ${meet ? `<details class="all"><summary>All ${s.recent.length} meetings <small>newest first</small></summary><ul class="mu-meet">${meet}</ul></details>` : ''}
      </article>`;
    };
    const ord = n => n + (['th', 'st', 'nd', 'rd'][(n % 100 > 10 && n % 100 < 14) ? 0 : (n % 10 < 4 ? n % 10 : 0)]);
    return `<section><h2 class="sec">Week ${M.week} matchups <small>biggest playoff stakes first · win chances from the playoff simulation</small></h2>
      <div class="mu-grid">${M.games.map(card).join('')}</div></section>`;
  }

  /* ---------- By-Laws ---------- */
  // Our own disclosure blocks (not <details>): articles open into sections, sections into sub-parts.
  // Everything starts collapsed; closing a block closes everything inside it; each open block ends
  // with a bar that collapses it, so a long read doesn't mean scrolling back up.
  function pageBylaws() {
    const B = state.bylaws;
    if (!B) return '<p class="loading">Loading the by-laws…</p>';
    const tagHtml = tags => (tags || []).map(t => `<span class="bl-tag bl-${t}">${t[0].toUpperCase() + t.slice(1)}</span>`).join('');
    const node = (n, id) => {
      const open = state.blOpen.has(id);
      const label = n.num ? `Article ${n.num}` : n.title;
      const head = n.level === 1
        ? (n.num ? `<span class="bl-num">${n.num}</span><span class="bl-name">${esc(n.name)}</span>`
                 : `<span class="bl-num bl-star">2027</span><span class="bl-name">${esc(n.title)}</span>`)
          + (n.changes ? `<span class="bl-chg">${n.changes} change${n.changes > 1 ? 's' : ''}</span>` : '')
        : `<span class="bl-t">${esc(n.title)}</span>${tagHtml(n.tags)}`;
      return `<div class="bl bl${n.level}${open ? ' open' : ''}" data-bl="${id}">
        <button type="button" class="bl-sum" data-bltoggle="${id}" aria-expanded="${open}">${head}<i class="car" aria-hidden="true"></i></button>
        <div class="bl-body"${open ? '' : ' hidden'}>${n.html || ''}${n.children.map((c, k) => node(c, id + '.' + k)).join('')}
          <button type="button" class="bl-end" data-blclose="${id}"><i class="car up" aria-hidden="true"></i>Collapse ${esc(label)}</button></div></div>`;
    };
    return `<div class="pagehead"><h1>By-Laws</h1><span class="asof">${esc(B.title)} · <b>${esc(B.edition)}</b></span></div>
      <div class="bl-tools">
        <input type="search" id="bl-q" placeholder="Search the by-laws (taxi, tiebreak, QB…)" aria-label="Search the by-laws" autocomplete="off">
        <div class="seg" role="group" aria-label="Open or close everything"><button type="button" data-blall="open">Expand all</button><button type="button" data-blall="close">Collapse all</button></div>
      </div>
      <p class="bl-hit" id="bl-hit" hidden></p>
      <div class="card bl-list">${B.articles.map((a, k) => node(a, String(k))).join('')}</div>`;
  }
  function blSet(el, open, remember = true) {
    el.classList.toggle('open', open);
    el.querySelector(':scope > .bl-sum').setAttribute('aria-expanded', open);
    el.querySelector(':scope > .bl-body').hidden = !open;
    if (remember) open ? state.blOpen.add(el.dataset.bl) : state.blOpen.delete(el.dataset.bl);
    if (!open) el.querySelectorAll('.bl.open').forEach(c => blSet(c, false, remember));   // closing a block closes what's inside
  }
  // search in place: hide articles without a match, open the parts that hold one, mark the words
  function blSearch(q) {
    const list = document.querySelector('.bl-list'); if (!list) return;
    list.querySelectorAll('mark.bl-m').forEach(m => m.replaceWith(document.createTextNode(m.textContent)));
    list.normalize();
    const hit = document.getElementById('bl-hit');
    const arts = [...list.querySelectorAll('.bl1')];
    const all = [...list.querySelectorAll('.bl')];
    if (q.length < 2) {
      arts.forEach(a => { a.hidden = false; });
      all.forEach(b => blSet(b, state.blOpen.has(b.dataset.bl), false));
      all.forEach(b => { if (state.blOpen.has(b.dataset.bl)) blSet(b, true, false); });
      hit.hidden = true; return;
    }
    const rx = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
    let total = 0;
    arts.forEach(a => {
      blSet(a, false, false);
      const walker = document.createTreeWalker(a, NodeFilter.SHOW_TEXT, {   // titles count too
        acceptNode: t => t.parentElement.closest('.bl-end, .bl-chg, .bl-tag, .bl-num') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT });
      const hits = [];
      while (walker.nextNode()) { const t = walker.currentNode; rx.lastIndex = 0; if (rx.test(t.nodeValue)) hits.push(t); }
      a.hidden = !hits.length;
      hits.forEach(t => {
        const own = t.parentElement.closest('.bl'), inTitle = t.parentElement.closest('.bl-sum');
        for (let el = inTitle ? own.parentElement.closest('.bl') : own; el; el = el.parentElement.closest('.bl')) blSet(el, true, false);
        if (inTitle && own.classList.contains('bl1')) blSet(own, true, false);
        const frag = document.createDocumentFragment(); let last = 0, m; rx.lastIndex = 0;
        while ((m = rx.exec(t.nodeValue))) {
          frag.append(t.nodeValue.slice(last, m.index));
          const mk = document.createElement('mark'); mk.className = 'bl-m'; mk.textContent = m[0]; frag.append(mk);
          last = m.index + m[0].length; total++;
        }
        frag.append(t.nodeValue.slice(last)); t.replaceWith(frag);
      });
    });
    const n = arts.filter(a => !a.hidden).length;
    hit.hidden = false;
    hit.textContent = total ? `${total} match${total > 1 ? 'es' : ''} in ${n} article${n > 1 ? 's' : ''}` : 'No matches';
  }

  /* ---------- placeholders ---------- */
  const SOON = {
    offseason: ['Off-Season', 'A sandbox for next year: rosters, cap space, keeper look-ahead, free agents, the incoming rookie class and auction price predictions tuned on 2026 results.', []],
  };
  const pageSoon = k => {
    const [h, p, extra] = SOON[k];
    return `<div class="card soon"><h2>${h}</h2><p>${p}</p>${extra.length ? `<ul>${extra.map(x => `<li>${x}</li>`).join('')}</ul>` : ''}<p>Coming soon.</p></div>`;
  };

  // re-render without jumping: keep the page and any scrolling lists where they were
  function keepScroll(fn) {
    const y = window.scrollY, boxes = ['.dr-list', '#dr-board'].map(sel => { const el = document.querySelector(sel); return [sel, el ? el.scrollTop : 0]; });
    fn();
    boxes.forEach(([sel, t]) => { const el = document.querySelector(sel); if (el) el.scrollTop = t; });
    window.scrollTo(0, y);
    if (location.hash === '#draft/mock' && window.FBPDraft) FBPDraft.after();   // the board follows the pick on the clock
  }
  const draftCtx = () => ({ myTeam: myTeam(), now: state.now, teams: state.teams, chip, esc, nameOf, rerender: () => { if (location.hash.startsWith('#draft') || location.hash === '#awards') route(); } });

  /* ---------- router ---------- */
  const TABS = ['scores', 'multiview', 'now', 'awards', 'reference', 'offseason', 'press', 'draft', 'bylaws', 'settings', 'beta'];
  const refCtx = () => ({ teams: state.teams, chip, esc, nameOf, ppr: state.ppr, myTeam: myTeam(), rerender: () => { if (location.hash.startsWith('#reference')) route(); } });
  let lastPage = '';
  function route() {
    const parts = location.hash.slice(1).split('/');
    const tab = TABS.includes(parts[0]) ? parts[0] : 'now';
    document.querySelectorAll('.tabs a').forEach(a => { if (a.dataset.tab === tab) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
    // Game Day: the live Scoreboard (#scores) and the Sunday Ticket Helper (#scores/ticket)
    if (tab === 'multiview') { location.replace('#scores/ticket'); return; }
    if (tab === 'scores') {
      const ticket = parts[1] === 'ticket', season = +(String((state.now || {}).season || '').match(/\d{4}/) || [new Date().getFullYear()])[0];
      const nav = `<nav class="rf-sub seg now-sub pg-nav">${[['', 'Scoreboard'], ['players', 'Players'], ['nfl', 'NFL <span class="lg-only">Scoreboard</span><span class="sm-only">Scores</span>'], ['ticket', '<span class="lg-only">Sunday </span>Ticket Helper']].map(([k, l]) => `<a href="#scores${k ? '/' + k : ''}"${(parts[1] || '') === k ? ' aria-current="page"' : ''}>${l}</a>`).join('')}</nav>`;
      const base = { teams: state.teams, esc, nameOf, nav, weeksPlayed: (state.now || {}).weeksPlayed || 0, season };
      app.innerHTML = parts[1] === 'nfl'
        ? (window.FBPNfl ? FBPNfl.render(Object.assign({}, base, { rerender: () => { if (location.hash.startsWith('#scores/nfl')) route(); } })) : '<p class="error">The NFL scoreboard didn’t load.</p>')
        : ticket
        ? (window.FBPMultiview ? FBPMultiview.render(Object.assign({}, base, { abbr: id => (state.teams[id] || {}).abbr || nameOf(id), rerender: () => { if (location.hash.startsWith('#scores/ticket')) route(); } })) : '<p class="error">The Sunday Ticket Helper didn’t load.</p>')
        : (window.FBPLive ? FBPLive.render(Object.assign({}, base, { mode: parts[1] === 'players' ? 'players' : 'scores', seeds: (state.now || {}).seeds || [], standings: (state.now || {}).standings || [], games: (state.now || {}).games || [], rerender: () => { if (/^#scores(\/players)?\/?$/.test(location.hash)) route(); } })) : '<p class="error">The scoreboard didn’t load.</p>');
    }
    else if (tab === 'now') app.innerHTML = state.now ? pageNow() : '<p class="error">League data didn’t load. Refresh the page to try again.</p>';
    else if (tab === 'settings') app.innerHTML = pageSettings();
    else if (tab === 'press') app.innerHTML = pagePress();
    else if (tab === 'beta') { app.innerHTML = window.FBPBeta ? FBPBeta.render({ esc, nameOf, teams: state.teams, myTeam: myTeam(), rerender: () => { if (location.hash.startsWith('#beta')) route(); } }) : '<p class="error">The Beta page didn’t load.</p>'; if (window.FBPBeta) FBPBeta.after(); }
    else if (tab === 'awards') app.innerHTML = window.FBPAwards ? FBPAwards.render(draftCtx()) : '<p class="error">Awards didn’t load.</p>';
    else if (tab === 'reference') {
      const path = parts.slice(1);
      app.innerHTML = window.FBPRef ? FBPRef.render(refCtx(), path) : '<p class="error">The Reference section didn’t load.</p>';
      // a new page starts at the top; switching sub-tabs (weeks, boards) keeps your place
      const page = 'reference/' + (window.FBPRef ? FBPRef.pageKey(path) : '');
      if (page !== lastPage && lastPage) toTop();
      lastPage = page;
    }
    else if (tab === 'draft') {
      // sub-tabs: FBP Home (#draft), Mock Draft (#draft/mock), Big Board, Full Order
      const sub = parts[1] || '';
      if (sub === 'mock') { app.innerHTML = window.FBPDraft ? FBPDraft.render(draftCtx()) : '<p class="error">The draft tool didn’t load.</p>'; if (window.FBPDraft) FBPDraft.after(); }
      else { app.innerHTML = window.FBPDraftHub ? FBPDraftHub.render(draftCtx(), sub) : '<p class="error">The Rookie Draft page didn’t load.</p>'; if (window.FBPDraftHub && FBPDraftHub.fit) { FBPDraftHub.fit(); if (document.fonts) document.fonts.ready.then(() => FBPDraftHub.fit()); } }
      const page = 'draft/' + sub;
      if (page !== lastPage && lastPage.startsWith('draft/')) toTop();
      lastPage = page;
    }
    else if (tab === 'bylaws') {
      app.innerHTML = pageBylaws();
      if (!state.bylaws) fetch('data/bylaws.json', { cache: 'no-cache' }).then(r => r.json())
        .then(b => { state.bylaws = b; if (location.hash === '#bylaws') route(); })
        .catch(() => { app.innerHTML = '<p class="error">The by-laws didn’t load. Refresh the page to try again.</p>'; });
    }
    else app.innerHTML = pageSoon(tab);
    if (tab !== 'reference' && tab !== 'draft') lastPage = tab;
    const active = document.querySelector('.tabs a[aria-current="page"]');
    if (active && active.parentElement.scrollWidth > active.parentElement.clientWidth) active.parentElement.scrollLeft = active.offsetLeft - 10;
  }

  // phones: swipe left or right anywhere on the page to go to the next or previous main section.
  // Ignored when the swipe starts on something that scrolls sideways (tables, chip rows, the draft board),
  // on a form control, with two fingers, or when it's more up-and-down than sideways.
  // the logo row scrolls away and the section tabs stay pinned at the top. A new page starts at the top of its
  // content: with the logo row already scrolled away it stays away, and it only comes back when you scroll to the top.
  const brandH = () => { const b = document.querySelector('.top-in'); return b ? b.offsetHeight : 0; };
  let pinned = false;   // whether the logo row was scrolled away just before this navigation
  window.addEventListener('scroll', () => { pinned = window.scrollY >= brandH() - 1; }, { passive: true });
  function toTop() { window.scrollTo(0, pinned ? brandH() : 0); }
  let lastTab = (location.hash.slice(1).split('/')[0]) || 'now';

  // phones: pull down from the top of the page to reload it (the saved home-screen app has no pull-to-refresh of its own)
  function pullRefresh() {
    if (!('ontouchstart' in window)) return;
    const ind = document.createElement('div');
    ind.className = 'ptr'; ind.setAttribute('aria-hidden', 'true'); ind.innerHTML = '<span class="ptr-i">↓</span>';
    document.body.appendChild(ind);
    const NEED = 80;
    let y0 = null, x0 = 0, d = 0;
    const reset = () => { y0 = null; d = 0; ind.style.transform = ''; ind.classList.remove('on', 'go'); };
    document.addEventListener('touchstart', e => {
      if (e.touches.length !== 1 || window.scrollY > 0 || document.querySelector('.lv-dragging')) return;
      y0 = e.touches[0].clientY; x0 = e.touches[0].clientX; d = 0;
    }, { passive: true });
    document.addEventListener('touchmove', e => {
      if (y0 == null) return;
      const dy = e.touches[0].clientY - y0, dx = e.touches[0].clientX - x0;
      // scrolling up, a sideways swipe, or the page has scrolled: not a pull
      if (dy <= 0 || Math.abs(dx) > dy || window.scrollY > 0 || document.querySelector('.lv-dragging')) { reset(); return; }
      d = Math.min(140, dy * .55);
      ind.classList.add('on'); ind.classList.toggle('go', dy >= NEED * 1.6);
      ind.style.transform = `translate(-50%, ${d}px) rotate(${Math.min(180, dy * 1.2)}deg)`;
    }, { passive: true });
    const end = () => {
      if (y0 == null) return;
      if (ind.classList.contains('go')) { ind.classList.add('spin'); ind.firstChild.textContent = '↻'; ind.style.transform = 'translate(-50%, 60px)'; setTimeout(() => location.reload(), 150); return; }
      reset();
    };
    document.addEventListener('touchend', end, { passive: true });
    document.addEventListener('touchcancel', end, { passive: true });
  }
  function swipeTabs() {
    let x0 = 0, y0 = 0, x1 = 0, y1 = 0, t0 = 0, ok = false, why = '';
    const dbg = /[?&]swipe=debug/.test(location.search);
    const note = msg => { if (!dbg) return; let d = document.getElementById('sw-dbg');
      if (!d) { d = document.createElement('div'); d.id = 'sw-dbg'; d.style.cssText = 'position:fixed;left:8px;bottom:8px;z-index:99;background:#000c;color:#fff;font:12px/1.3 monospace;padding:6px 8px;border-radius:6px;max-width:90vw'; document.body.appendChild(d); }
      d.textContent = msg; };
    const sideScroller = el => { for (; el && el.nodeType === 1 && el !== document.body; el = el.parentElement) {
      if (el.matches('input,select,textarea,.tabs,[data-noswipe]')) return el.tagName.toLowerCase() + (el.className ? '.' + el.className : '');
      const cs = getComputedStyle(el);
      if (/(auto|scroll)/.test(cs.overflowX) && el.scrollWidth > el.clientWidth + 2) return el.tagName.toLowerCase() + '.' + el.className;
    } return ''; };
    document.addEventListener('touchstart', e => {
      const t = e.touches[0]; x0 = x1 = t.clientX; y0 = y1 = t.clientY; t0 = Date.now();
      why = e.touches.length > 1 ? 'two fingers' : sideScroller(e.target.nodeType === 1 ? e.target : e.target.parentElement);
      ok = !why;
    }, { passive: true });
    document.addEventListener('touchmove', e => { if (e.touches.length > 1) { ok = false; why = 'two fingers'; }
      const t = e.touches[0]; if (t) { x1 = t.clientX; y1 = t.clientY; } }, { passive: true });
    // iOS can end a swipe with touchcancel instead of touchend once it decides the page is scrolling; treat both the same
    const end = e => {
      const t = e.changedTouches && e.changedTouches[0];
      if (t && e.type === 'touchend') { x1 = t.clientX; y1 = t.clientY; }
      const dx = x1 - x0, dy = y1 - y0, ms = Date.now() - t0;
      if (!ok) return note(`${e.type}: skipped (${why})`);
      ok = false;
      if (ms > 1000 || Math.abs(dx) < 50 || Math.abs(dx) < 1.5 * Math.abs(dy)) return note(`${e.type}: dx ${Math.round(dx)} dy ${Math.round(dy)} ${ms}ms, not a swipe`);
      // pinch-zoomed in, the swipe is panning the page. Some iPhones report a scale above 1 at normal zoom, so go by
      // whether the visible area is actually narrower than the page
      const vv = window.visualViewport, cw = document.documentElement.clientWidth;
      if (vv && vv.width < cw * 0.9) return note(`zoomed in (showing ${Math.round(vv.width)} of ${cw}px, scale ${vv.scale.toFixed(2)})`);
      const tabs = [...document.querySelectorAll('.tabs a[data-tab]')].map(a => a.dataset.tab);
      const cur = tabs.indexOf(((document.querySelector('.tabs a[aria-current="page"]') || {}).dataset || {}).tab);
      const next = tabs[cur + (dx < 0 ? 1 : -1)];
      note(`${e.type}: dx ${Math.round(dx)} → ${next || 'none'} (tab ${cur})`);
      if (cur < 0 || !next) return;
      location.hash = '#' + next;
    };
    document.addEventListener('touchend', end, { passive: true });
    document.addEventListener('touchcancel', end, { passive: true });
  }

  // How current the data is: when the last refresh pulled from MFL, and who started it (the schedule or the commissioner).
  // Shown in the footer on every page and in the League Now header; times are in the viewer's own time zone.
  function refreshText(short) {
    const m = state.meta; if (!m || !m.fetched) return '';
    const t = new Date(m.fetched); if (isNaN(t)) return '';
    const mins = (Date.now() - t) / 6e4;
    const ago = mins < 1 ? 'just now' : mins < 60 ? `${Math.round(mins)} min ago` : mins < 48 * 60 ? `${Math.round(mins / 60)} hr ago` : `${Math.round(mins / 1440)} days ago`;
    const when = t.toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' });
    const who = m.trigger === 'commissioner' ? 'Commissioner refresh' : m.trigger === 'automatic' ? 'Automatic refresh' : 'Data refreshed';
    return short ? `${who.toLowerCase().replace('data refreshed', 'refreshed')} ${ago}` : `${who} ${when} (${ago})`;
  }
  function showRefresh() {
    const el = document.getElementById('foot-refresh'); if (!el) return;
    const txt = refreshText(); if (!txt) return;
    el.innerHTML = `<b>${esc(txt)}</b><br>Automatic refreshes run every morning after MFL’s waivers process (about 9:30 AM Pacific) and Monday nights after the game; GitHub sometimes starts them late. Rosters, scores and transactions are as of the last refresh; the live Scoreboard updates on its own during games.`;
    const h = document.getElementById('ln-refresh'); if (h) h.textContent = refreshText(true);
    else if (/^#now(\/)?$|^#?$/.test(location.hash) && state.now) route();   // League Now header was drawn before this loaded
  }
  /* ---------- Ticker: a strip under the tabs that scrolls league info like a stock ticker ----------
     It lives in the header, outside the page area, so moving between pages never restarts it; a reload picks up where
     it left off (its position is kept for this browser session). Press or hover to pause; swipe or drag it either way
     to catch something you missed. Tap a section label or an item to open that page. Settings > Ticker hides it, or runs
     a second line; each line can sit under the tabs or be pinned to the bottom, with its own speed and direction.
     Sections: MFL Power (rating, change since last week, a sparkline of the season so far) and Heat Check (each
     team's Heat Score, then the 12 hottest and 12 coldest rostered players). */
  state.ticker = true; try { state.ticker = localStorage.getItem('fbp-ticker') !== '0'; } catch (e) {}
  let TKH = null, TKA = null, TKF = null, tkLoading = false;
  function tkLoad() {
    if (tkLoading) return; tkLoading = true;
    const get = u => fetch(u, { cache: 'no-cache' }).then(r => r.ok ? r.json() : null).catch(() => null);
    Promise.all([get('data/league-now-history.json'), get('data/analytics.json'), get('data/ticker.json')])
      .then(([h, a, f]) => { TKH = h; TKA = a; TKF = f; ticker(); });
  }
  // the sections, in their default order; Settings > Ticker turns each on or off and drags them into any order
  const TK_SECS = [['deadline', 'Trade deadline countdown'], ['power', 'MFL Power Rating'], ['heat', 'Heat Check: teams'],
    ['hot', 'Hottest players'], ['cold', 'Coldest players'], ['odds', 'Playoff odds'], ['matchups', 'This week’s matchups'],
    ['scores', 'Last week’s scores'], ['block', 'Trade block'], ['moves', 'Latest moves'], ['press', 'Press Box: latest articles']];
  // one line or two (one, pinned to the bottom, to start); each line has its own sections, order, speed, direction and place (top under the tabs, or pinned
  // to the bottom of the screen). Line 2 starts with the game-week sections so it doesn't just repeat line 1.
  const TK_DEF = [{ order: [], off: [], speed: 45, dir: 'l', pos: 'bottom' },
    { order: [], off: ['deadline', 'power', 'heat', 'hot', 'cold', 'press'], speed: 45, dir: 'l', pos: 'top' }];
  const tkDef = i => JSON.parse(JSON.stringify(TK_DEF[i]));
  let tkCfg = { lines: 1, rows: [] };
  try { const sv = JSON.parse(localStorage.getItem('fbp-ticker-cfg') || 'null');
    if (sv && Array.isArray(sv.rows)) tkCfg = sv;
    else { const old = JSON.parse(localStorage.getItem('fbp-ticker-sections') || 'null');   // settings saved before v0.0177
      if (old) tkCfg.rows = [Object.assign(tkDef(0), { order: old.order || [], off: old.off || [] })]; } } catch (e) {}
  const tkRow = i => (tkCfg.rows[i] = Object.assign(tkDef(i), tkCfg.rows[i] || {}));
  const tkOrder = i => { const ids = TK_SECS.map(x => x[0]), o = (tkRow(i).order || []).filter(k => ids.includes(k)); return o.concat(ids.filter(k => !o.includes(k))); };
  const tkSave = () => { try { localStorage.setItem('fbp-ticker-cfg', JSON.stringify(tkCfg)); } catch (e) {} };
  const tkLines = () => tkCfg.lines === 2 ? 2 : 1;
  const tkSpeedLabel = v => `${(v / 45).toFixed(1).replace(/\.0$/, '')}×`;
  // Settings > Ticker, one line's block: place, direction, speed, then its sections (tick to show, drag ☰ or use the arrows)
  function tkRowCfg(i) {
    const R = tkRow(i), two = tkLines() === 2, sg = (key, opts, label) => `<div class="seg" role="group" aria-label="${label}">${opts.map(([v, t]) =>
      `<button type="button" data-tk-set="${i}|${key}|${v}" aria-pressed="${R[key] === v}">${t}</button>`).join('')}</div>`;
    return `<fieldset class="tk-line">${two ? `<legend>Line ${i + 1}</legend>` : ''}
      <div class="tk-opts">
        <div><small>Where</small>${sg('pos', [['top', 'Top, under the tabs'], ['bottom', 'Pinned to the bottom']], 'Where it sits')}</div>
        <div><small>Direction</small>${sg('dir', [['l', '← Scrolls left'], ['r', 'Scrolls right →']], 'Direction')}</div>
        <div><small>Speed <output data-tk-spv="${i}">${tkSpeedLabel(R.speed)}</output></small>
          <input type="range" class="tk-speed" min="15" max="135" step="5" value="${R.speed}" data-tk-speed="${i}" aria-label="Line ${i + 1} speed"></div>
      </div>
      <p class="tk-cfg-h">What it shows, in order. Tick the ones you want; drag <b>☰</b> (or use the arrows) to change the order.</p>
      <ol class="tk-cfg" data-tk-list="${i}">${tkOrder(i).map((k, j, a) => { const lab = (TK_SECS.find(x => x[0] === k) || [k, k])[1], on = !(R.off || []).includes(k);
        return `<li data-tk-k="${k}" class="${on ? '' : 'off'}"><span class="tk-grip" aria-hidden="true">☰</span><label><input type="checkbox" data-tk-on="${i}|${k}"${on ? ' checked' : ''}> ${lab}</label>
          <span class="tk-ar"><button type="button" data-tk-mv="${i}|${k}|-1"${j ? '' : ' disabled'} aria-label="Move ${lab} up">↑</button><button type="button" data-tk-mv="${i}|${k}|1"${j < a.length - 1 ? '' : ' disabled'} aria-label="Move ${lab} down">↓</button></span></li>`; }).join('')}</ol>
      <div class="seg"><button type="button" data-tk-reset="${i}">Back to the default sections and order</button></div></fieldset>`;
  }
  const spark = vals => {
    const v = vals.filter(x => x != null); if (v.length < 2) return '';
    const lo = Math.min(...v), hi = Math.max(...v), W = 34, H = 12, k = hi - lo || 1;
    const pts = v.map((x, i) => `${(i / (v.length - 1) * W).toFixed(1)},${(H - (x - lo) / k * H).toFixed(1)}`).join(' ');
    const up = v[v.length - 1] >= v[v.length - 2];
    return `<svg class="tk-sp ${up ? 'up' : 'dn'}" viewBox="-1 -1 ${W + 2} ${H + 2}" width="${W + 2}" height="${H + 2}" aria-hidden="true"><polyline points="${pts}"/></svg>`;
  };
  const short = n => { const p = String(n || '').split(' '); return p.length > 1 ? `${p[0][0]}. ${p.slice(1).join(' ').replace(/ (Jr\.|Sr\.|II|III|IV)$/, '')}` : n; };
  function tickerItems(row) {
    const d = state.now; if (!d || !d.standings) return [];
    const P = d.prev && d.prev.teams, A = TKA, F = TKF, O = d.odds && d.odds.teams, ab = f => esc((state.teams[f] || {}).abbr || f);
    const S = {};
    S.deadline = () => {
      const dl = Date.parse((F && F.deadline) || '2026-12-03T17:00:00Z'), ms = dl - Date.now(); if (!(ms > 0)) return [];
      const dd = Math.floor(ms / 864e5), hh = Math.floor(ms % 864e5 / 36e5);
      return [`<a class="tk-h tk-dl" href="#beta/trade">Trade deadline</a>`, `<a class="tk-i" href="#beta/trade"><b>${dd ? dd + 'd ' : ''}${hh}h</b><span class="tk-p">Thu, Dec 3 · 12 PM EST</span></a>`];
    };
    S.power = () => {
      const rows = d.standings.filter(t => t.pwr).sort((a, b) => (a.pwrRank || 99) - (b.pwrRank || 99)); if (!rows.length) return [];
      const W = TKH ? Object.keys(TKH.weeks).map(Number).sort((a, b) => a - b) : [];
      return [`<a class="tk-h" href="#now/power" title="MFL Power Rankings">MFL Power</a>`].concat(rows.map(t => {
        const was = P && P[t.id], wr = was && was.pwrRank, mv = wr && t.pwrRank ? wr - t.pwrRank : 0;
        const dp = was && was.pwr != null ? t.pwr - was.pwr : null, hist = W.map(w => ((TKH.weeks[w] || {})[t.id] || {}).pwr);
        return `<a class="tk-i" href="#now/power" title="${esc(nameOf(t.id))}: #${t.pwrRank}, rating ${t.pwr.toFixed(2)}${dp != null ? ` (${dp >= 0 ? '+' : ''}${dp.toFixed(2)} since week ${d.prev.week})` : ''}">
          <span class="tk-r">${t.pwrRank}${mv ? `<sup class="${mv > 0 ? 'up' : 'dn'}">${mv > 0 ? '↑' : '↓'}${Math.abs(mv)}</sup>` : ''}</span><b>${ab(t.id)}</b><span class="tk-v">${t.pwr.toFixed(2)}</span>
          ${dp != null ? `<span class="tk-d ${dp > 0.004 ? 'up' : dp < -0.004 ? 'dn' : 'eq'}">${dp > 0.004 ? '▲' : dp < -0.004 ? '▼' : '–'}${Math.abs(dp).toFixed(2)}</span>` : ''}${spark(hist)}</a>`; }));
    };
    const heatGo = 'href="#now/analytics" data-tk-jump="heatteams"';
    S.heat = () => !(A && A.heatTeams) ? [] : [`<a class="tk-h tk-heat" ${heatGo}>Heat Check</a>`].concat(Object.entries(A.heatTeams).sort((a, b) => b[1].score - a[1].score)
      .map(([f, h]) => `<a class="tk-i" ${heatGo} title="${esc(nameOf(f))}: Heat Score ${h.score}"><b>${ab(f)}</b><span class="tk-v ${h.score > 0 ? 'hot' : h.score < 0 ? 'cold' : ''}">${h.score > 0 ? '+' : ''}${h.score}</span></a>`));
    const pl = () => Object.entries((A && A.heatPlayers) || {}).filter(([, p]) => p.fr).map(([id, p]) => Object.assign({ id }, p));
    const pi = (p, cls) => `<a class="tk-i" href="#now/rosters/${p.fr}/${p.id}" title="${esc(p.n)} (${esc(p.p)}, ${esc(nameOf(p.fr))}): Heat Score ${p.s}"><b>${esc(short(p.n))}</b><span class="tk-p">${esc(p.p)} ${ab(p.fr)}</span><span class="tk-v ${cls}">${p.s > 0 ? '+' : ''}${p.s}</span></a>`;
    S.hot = () => !A ? [] : [`<a class="tk-h tk-hot" ${heatGo}>🔥 Hottest</a>`].concat(pl().sort((a, b) => b.s - a.s).slice(0, 12).map(p => pi(p, 'hot')));
    S.cold = () => !A ? [] : [`<a class="tk-h tk-cold" ${heatGo}>🧊 Coldest</a>`].concat(pl().sort((a, b) => a.s - b.s).slice(0, 12).map(p => pi(p, 'cold')));
    S.odds = () => !O ? [] : [`<a class="tk-h tk-odds" href="#now/playoffs">Playoff odds</a>`].concat(Object.entries(O).sort((a, b) => b[1].playoff - a[1].playoff).map(([f, o]) => {
      const was = P && P[f] && P[f].playoff, dv = was != null ? o.playoff - was : null, pc = v => v >= 99.5 ? '>99' : v > 0 && v < 0.5 ? '<1' : Math.round(v);
      return `<a class="tk-i" href="#now/playoffs" title="${esc(nameOf(f))}: ${o.playoff}% to make the playoffs"><b>${ab(f)}</b><span class="tk-v">${pc(o.playoff)}%</span>${dv != null && Math.abs(dv) >= 0.5 ? `<span class="tk-d ${dv > 0 ? 'up' : 'dn'}">${dv > 0 ? '▲' : '▼'}${Math.abs(Math.round(dv))}</span>` : ''}</a>`; }));
    S.matchups = () => {
      const up = d.upcoming || []; if (!up.length) return [];
      const wk = up[0][0], wp = (f, opp) => { const g = ((O || {})[f] || {}).ownGames || []; const x = g.find(z => z.week === wk && z.opp === opp); return x ? x.winProb : null; };
      return [`<a class="tk-h tk-mu" href="#now/matchups">Week ${wk}</a>`].concat(up.filter(g => g[0] === wk).map(([, a, b]) => { const pa = wp(a, b), pb = pa == null ? null : 100 - pa;
        return `<a class="tk-i" href="#now/matchups"><b>${ab(a)}</b>${pa != null ? `<span class="tk-v ${pa >= 50 ? 'fav' : ''}">${pa}%</span>` : ''}<span class="tk-p">vs</span><b>${ab(b)}</b>${pb != null ? `<span class="tk-v ${pb > 50 ? 'fav' : ''}">${pb}%</span>` : ''}</a>`; }));
    };
    S.scores = () => {
      const G = d.games || []; if (!G.length) return [];
      const wk = Math.max(...G.map(g => g[0]));
      return [`<a class="tk-h tk-sc" href="#now">Week ${wk} final</a>`].concat(G.filter(g => g[0] === wk).map(([, a, sa, b, sb]) => {
        const aw = sa > sb, bw = sb > sa;
        return `<a class="tk-i" href="#now"><b class="${aw ? '' : 'tk-l'}">${ab(a)}</b><span class="tk-v ${aw ? 'win' : ''}">${sa.toFixed(1)}</span><span class="tk-p">–</span><b class="${bw ? '' : 'tk-l'}">${ab(b)}</b><span class="tk-v ${bw ? 'win' : ''}">${sb.toFixed(1)}</span></a>`; }));
    };
    S.block = () => !(F && F.block && F.block.length) ? [] : [`<a class="tk-h tk-bl" href="#beta/trade">On the block</a>`].concat(F.block.map(b =>
      `<a class="tk-i" href="#beta/trade"><b>${ab(b.f)}</b><span class="tk-v">${esc(b.items.map(short).join(', '))}</span></a>`));
    S.moves = () => !(F && F.moves && F.moves.length) ? [] : [`<a class="tk-h tk-mv" href="#beta/trade">Latest moves</a>`].concat(F.moves.map(m =>
      m.k === 'T' ? `<a class="tk-i" href="#beta/trade"><span class="tk-p">⇄</span><b>${ab(m.f)}</b><span class="tk-p">&amp;</span><b>${ab(m.f2)}</b><span class="tk-v">${esc(m.t)}</span></a>`
        : `<a class="tk-i" href="#now/rosters/${m.f}/${m.id}"><b>${ab(m.f)}</b><span class="tk-v">${esc(m.t)}</span><span class="tk-p">${new Date(m.ts * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span></a>`));
    // the three newest Press Box columns: headline and writer
    S.press = () => { const C = state.columns && state.columns.columns; if (!C) { loadColumns(); return []; } if (!C.length) return [];
      return [`<a class="tk-h tk-pr" href="#press">Press Box</a>`].concat(C.slice(0, 3).map(c =>
        `<a class="tk-i" href="#now/column/${esc(c.slug)}"><b class="tk-hl">${esc(c.title)}</b><span class="tk-p">${esc((state.columns.columnists[c.author] || { name: c.author }).name)}</span></a>`)); };
    const off = new Set(tkRow(row).off || []);
    return tkOrder(row).filter(k => !off.has(k)).flatMap(k => S[k] ? S[k]() : []);
  }
  // the motion: each line's position drifts about 45 pixels a second (times its speed setting) in its direction;
  // dragging moves it, pressing or hovering holds it
  const TKS = [0, 1].map(i => ({ i, x: 0, w: 0, speed: 45, dir: 1, hold: false, drag: null, resume: 0, el: null, track: null, moved: false, fresh: true }));
  let tkLast = 0, tkRaf = 0, tkSaved = 0;
  const reduceMotion = () => window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  function tkFrame(t) {
    const dt = tkLast ? Math.min(0.1, (t - tkLast) / 1000) : 0; tkLast = t;
    TKS.forEach(T => {
      if (!T.track || !T.w) return;
      if (!T.hold && !T.drag && Date.now() > T.resume && !reduceMotion() && !document.hidden) T.x -= T.dir * T.speed * dt;
      while (T.x <= -T.w) T.x += T.w; while (T.x > 0) T.x -= T.w;
      T.track.style.transform = `translate3d(${T.x.toFixed(1)}px,0,0)`;
    });
    if (t - tkSaved > 1000) { tkSaved = t; try { sessionStorage.setItem('fbp-ticker-pos', JSON.stringify({ xs: TKS.map(T => T.x), at: Date.now() })); } catch (e) {} }
    tkRaf = requestAnimationFrame(tkFrame);
  }
  function tkWire(T) {
    const el = T.el;
    el.addEventListener('mouseenter', () => { T.hold = true; });
    el.addEventListener('mouseleave', () => { T.hold = false; });
    el.addEventListener('pointerdown', e => { T.drag = { x0: e.clientX, y0: e.clientY, start: T.x, id: e.pointerId }; T.moved = false; });
    el.addEventListener('pointermove', e => {
      const g = T.drag; if (!g || e.pointerId !== g.id) return;
      const dx = e.clientX - g.x0;
      if (!T.moved && Math.abs(dx) > 5 && Math.abs(dx) > Math.abs(e.clientY - g.y0)) { T.moved = true; try { el.setPointerCapture(g.id); } catch (x) {} }
      if (T.moved) T.x = g.start + dx;
    });
    const up = () => { if (!T.drag) return; T.drag = null; T.resume = Date.now() + (T.moved ? 1500 : 800); };
    el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
    el.addEventListener('click', e => {
      if (T.moved) { e.preventDefault(); e.stopPropagation(); T.moved = false; return; }
      const j = e.target.closest('[data-tk-jump]');
      if (j) setTimeout(() => { const b = document.querySelector(`[data-an-jump="${j.dataset.tkJump}"]`); if (b) b.click(); }, 350);
    }, true);
    el.addEventListener('dragstart', e => e.preventDefault());
  }
  function ticker() {
    const top = document.getElementById('ticker'); if (!top) return;
    let bot = document.getElementById('ticker-bot');
    if (!bot) { bot = document.createElement('div'); bot.id = 'ticker-bot'; bot.className = 'tk-dock tk-bot'; bot.hidden = true; document.body.appendChild(bot); }
    if (!TKH && !tkLoading && state.ticker) tkLoad();
    const n = state.ticker ? tkLines() : 0;
    let sv = null; try { sv = JSON.parse(sessionStorage.getItem('fbp-ticker-pos') || 'null'); } catch (e) {}
    const built = [];
    TKS.forEach(T => {
      const items = T.i < n ? tickerItems(T.i) : [];
      if (!items.length) { if (T.el) { T.el.remove(); T.el = null; T.track = null; } return; }
      const R = tkRow(T.i), dock = R.pos === 'bottom' ? bot : top;
      if (!T.el) { T.el = document.createElement('div'); T.el.className = 'ticker'; T.el.setAttribute('data-noswipe', ''); tkWire(T); }
      T.el.setAttribute('aria-label', n > 1 ? `League ticker, line ${T.i + 1}` : 'League ticker');
      if (T.i === 0) dock.insertBefore(T.el, dock.firstChild); else dock.appendChild(T.el);
      T.speed = Math.max(10, Math.min(150, +R.speed || 45)); T.dir = R.dir === 'r' ? -1 : 1;
      const run = items.join('<span class="tk-sep" aria-hidden="true">•</span>') + '<span class="tk-sep" aria-hidden="true">•</span>';
      T.el.innerHTML = `<div class="tk-track"><div class="tk-run">${run}</div><div class="tk-run" aria-hidden="true">${run}</div></div>`;
      T.track = T.el.querySelector('.tk-track'); built.push(T);
    });
    top.hidden = !top.children.length; bot.hidden = !bot.children.length;
    built.forEach(T => {
      T.w = T.el.querySelector('.tk-run').scrollWidth;
      if (T.fresh) {   // first build this page load: carry on from where this session left it
        T.fresh = false;
        const x = sv && sv.xs ? sv.xs[T.i] : sv && T.i === 0 ? sv.x : null;
        if (x != null) T.x = x - (reduceMotion() ? 0 : T.dir * T.speed * Math.min(600, (Date.now() - sv.at) / 1000));
      }
    });
    document.documentElement.style.setProperty('--tkb-h', bot.hidden ? '0px' : bot.offsetHeight + 'px');
    if (!tkRaf) tkRaf = requestAnimationFrame(tkFrame);
    window.dispatchEvent(new Event('resize'));   // the pinned header changed height
  }
  // Settings > Ticker: tick a section on or off, and drag ☰ to reorder (mouse or finger)
  // the speed slider moves the ticker as you slide it
  document.addEventListener('input', e => {
    const r = e.target.closest && e.target.closest('[data-tk-speed]'); if (!r) return;
    const i = +r.dataset.tkSpeed; tkRow(i).speed = +r.value; TKS[i].speed = +r.value; tkSave();
    const o = document.querySelector(`[data-tk-spv="${i}"]`); if (o) o.textContent = tkSpeedLabel(+r.value);
  });
  document.addEventListener('change', e => {
    const c = e.target.closest && e.target.closest('[data-tk-on]'); if (!c) return;
    const [i, k] = c.dataset.tkOn.split('|'), R = tkRow(+i), off = new Set(R.off || []); c.checked ? off.delete(k) : off.add(k);
    R.off = [...off]; tkSave(); ticker(); c.closest('li').classList.toggle('off', !c.checked);
  });
  (function dragTickerRows() {
    let drag = null;
    document.addEventListener('pointerdown', e => {
      const g = e.target.closest && e.target.closest('.tk-grip'); if (!g) return;
      const li = g.closest('li'), list = li.parentElement; e.preventDefault();
      drag = { li, list, y0: e.clientY, off0: li.offsetTop, id: e.pointerId };
      li.classList.add('lift'); list.classList.add('dragging');
      try { g.setPointerCapture(e.pointerId); } catch (x) {}
    });
    document.addEventListener('pointermove', e => {
      if (!drag || e.pointerId !== drag.id) return;
      const { li, list } = drag, sibs = [...list.children].filter(c => c !== li);
      const before = sibs.find(c => { const r = c.getBoundingClientRect(); return e.clientY < r.top + r.height / 2; });
      if (before !== li.nextElementSibling) list.insertBefore(li, before || null);
      li.style.transform = `translateY(${e.clientY - drag.y0 - (li.offsetTop - drag.off0)}px)`;
    });
    const end = e => {
      if (!drag || (e && e.pointerId !== drag.id)) return;
      const { li, list } = drag; drag = null;
      li.style.transform = ''; li.classList.remove('lift'); list.classList.remove('dragging');
      tkRow(+list.dataset.tkList).order = [...list.children].map(c => c.dataset.tkK); tkSave(); ticker();
      list.querySelectorAll('li').forEach((c, i, a) => { const [u, d] = c.querySelectorAll('[data-tk-mv]'); u.disabled = !i; d.disabled = i === a.length - 1; });
    };
    document.addEventListener('pointerup', end); document.addEventListener('pointercancel', end);
  })();
  async function init() {
    try {
      const [now, teams] = await Promise.all([
        fetch('data/league-now.json', { cache: 'no-cache' }).then(r => { if (!r.ok) throw 0; return r.json(); }),
        fetch('data/teams.json').then(r => r.ok ? r.json() : { teams: {} }),
      ]);
      state.now = now; state.teams = teams.teams || {};
      try { state.budgets = await fetch('data/budgets.json', { cache: 'no-cache' }).then(r => r.ok ? r.json() : null); } catch (e) { state.budgets = null; }
      fetch('data/mfl/_meta.json', { cache: 'no-cache' }).then(r => r.ok ? r.json() : null).then(m => { state.meta = m; showRefresh(); }).catch(() => {});
      const yr = (now.season.match(/\d{4}/) || [''])[0];
      // season on one line, the version under it
      ticker();
      document.getElementById('season-label').innerHTML = `<span class="sl-t">${yr ? `${yr} season` : 'League hub'}</span><span class="sl-v">v ${VERSION}</span>`;
    } catch (e) { state.now = null; }
    applyMode();
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { applyTheme(); if (location.hash === '#settings') route(); });
    // League Now > Standings: tap a team's row to open its roster (the elimination tags keep their own tap)
  document.addEventListener('click', e => { const r = e.target.closest && e.target.closest('tr.st-go[data-go]');
    if (r && !e.target.closest('.ex, a, button')) location.hash = r.dataset.go; });
  document.addEventListener('keydown', e => { const r = e.target.closest && e.target.closest('tr.st-go[data-go]');
    if (r && e.key === 'Enter') location.hash = r.dataset.go; });
  window.addEventListener('hashchange', () => { const tab = location.hash.slice(1).split('/')[0] || 'now';
      route(); if (tab !== lastTab) { lastTab = tab; toTop(); } });
    swipeTabs(); pullRefresh();
    // sticky panels sit just under the header, whatever height it wraps to
    // --hdr-h is the part that stays pinned (the tabs); --brand-h is the logo row that scrolls away
    const hdr = () => { const r = document.documentElement.style, top = document.querySelector('.top');
      r.setProperty('--brand-h', brandH() + 'px'); r.setProperty('--hdr-h', (top.offsetHeight - brandH()) + 'px'); };
    hdr(); window.addEventListener('resize', hdr); if (document.fonts) document.fonts.ready.then(hdr);
    app.addEventListener('input', e => { if (e.target.id === 'bl-q') blSearch(e.target.value.trim()); });
    app.addEventListener('change', e => { if (window.FBPDraft && FBPDraft.change(e)) keepScroll(route); });
    app.addEventListener('click', e => {
      if (location.hash.startsWith('#draft') && location.hash !== '#draft/mock' && window.FBPDraftHub && FBPDraftHub.click(e)) { keepScroll(route); return; }
      const awSel = location.hash === '#awards' && window.FBPAwards && FBPAwards.click(e);   // selector of the button pressed
      if (awSel) {
        keepScroll(route);
        if (e.detail === 0) { const again = document.querySelector(awSel); if (again) again.focus({ preventScroll: true }); }
        return;
      }
      if (location.hash === '#draft/mock' && window.FBPDraft && FBPDraft.click(e, draftCtx())) {
        const el = e.target.closest('button'), key = el && [...el.attributes].find(a => a.name.startsWith('data-dr'));
        keepScroll(route);
        if (key && e.detail === 0) { const again = document.querySelector(`[${key.name}="${CSS.escape(key.value)}"]`); if (again) again.focus({ preventScroll: true }); }
        return;
      }
      const tg = e.target.closest('[data-bltoggle]'), cl = e.target.closest('[data-blclose]'), all = e.target.closest('[data-blall]');
      if (tg || cl || all) {
        if (all) {
          const q = document.getElementById('bl-q'); if (q && q.value) { q.value = ''; blSearch(''); }
          document.querySelectorAll('.bl-list .bl').forEach(b => blSet(b, all.dataset.blall === 'open')); return;
        }
        const el = document.querySelector(`.bl[data-bl="${(tg || cl).dataset.bltoggle || (tg || cl).dataset.blclose}"]`);
        if (!el) return;
        const opening = tg ? !el.classList.contains('open') : false;
        blSet(el, opening);
        if (cl) {   // bring the collapsed header back into view, just under the sticky site header
          const top = el.getBoundingClientRect().top - document.querySelector('.top').offsetHeight - 8;
          if (top < 0) window.scrollBy(0, top);
          if (e.detail === 0) el.querySelector(':scope > .bl-sum').focus({ preventScroll: true });
        }
        return;
      }
      const dtb = e.target.closest('[data-defteam]');
      if (dtb) {
        state.defTeam = dtb.dataset.defteam; try { localStorage.setItem('fbp-default-team', state.defTeam); } catch (x) {}
        const y = window.scrollY; route(); window.scrollTo(0, y);
        const again = document.querySelector(`[data-defteam="${state.defTeam}"]`); if (again) again.focus({ preventScroll: true });
        return;
      }
      const tmv = e.target.closest('[data-tk-mv],[data-tk-reset],[data-tk-set],[data-tk-lines]');
      if (tmv) {
        const D = tmv.dataset;
        if (D.tkReset != null) { const i = +D.tkReset, R = tkRow(i); tkCfg.rows[i] = Object.assign(tkDef(i), { speed: R.speed, dir: R.dir, pos: R.pos }); }
        else if (D.tkLines) tkCfg.lines = +D.tkLines;
        else if (D.tkSet) { const [i, key, v] = D.tkSet.split('|'); tkRow(+i)[key] = v; }
        else { const [r, k, dir] = D.tkMv.split('|'), o = tkOrder(+r), i = o.indexOf(k), j = i + +dir;
          if (j >= 0 && j < o.length) { [o[i], o[j]] = [o[j], o[i]]; tkRow(+r).order = o; } }
        tkSave(); ticker(); const y = window.scrollY; route(); window.scrollTo(0, y);
        const sel = D.tkReset != null ? `[data-tk-reset="${D.tkReset}"]` : D.tkLines ? `[data-tk-lines="${D.tkLines}"]` : D.tkSet ? `[data-tk-set="${D.tkSet}"]` : `[data-tk-mv="${D.tkMv}"]`;
        const again = document.querySelector(sel); if (again && !again.disabled) again.focus({ preventScroll: true });
        return;
      }
      const tk = e.target.closest('[data-ticker]');
      if (tk) {
        state.ticker = tk.dataset.ticker === 'on'; try { localStorage.setItem('fbp-ticker', state.ticker ? '1' : '0'); } catch (x) {}
        ticker(); const y = window.scrollY; route(); window.scrollTo(0, y);
        const again = document.querySelector(`[data-ticker="${tk.dataset.ticker}"]`); if (again) again.focus({ preventScroll: true });
        return;
      }
      const sw = e.target.closest('.swatch'), md = e.target.closest('[data-mode]'), pp = e.target.closest('[data-ppr]');
      if (pp) {
        state.ppr = pp.dataset.ppr === 'on'; try { localStorage.setItem('fbp-ppr', state.ppr ? '1' : '0'); } catch (x) {}
        const y = window.scrollY; route(); window.scrollTo(0, y);
        const again = document.querySelector(`[data-ppr="${pp.dataset.ppr}"]`); if (again) again.focus({ preventScroll: true });
        return;
      }
      if (sw || md) {
        if (sw) { state.themeTeam = sw.dataset.team; try { localStorage.setItem('fbp-theme-team', state.themeTeam); } catch (x) {} }
        if (md) { state.mode = md.dataset.mode; try { localStorage.setItem('fbp-mode', state.mode); } catch (x) {} }
        applyMode(); const y = window.scrollY; route(); window.scrollTo(0, y);
        const again = document.querySelector(sw ? `.swatch[data-team="${state.themeTeam}"]` : `[data-mode="${state.mode}"]`); if (again) again.focus({ preventScroll: true });
        return;
      }
      const ob = e.target.closest('[data-odds]');
      if (ob) {
        const id = ob.dataset.odds;
        state.open.has(id) ? state.open.delete(id) : state.open.add(id);
        const y = ob.getBoundingClientRect().top; route();
        const again = document.querySelector(`[data-odds="${id}"]`);
        if (again) {
          window.scrollBy(0, again.getBoundingClientRect().top - y);
          if (e.detail === 0) again.focus({ preventScroll: true });   // keep keyboard focus; taps and clicks leave nothing highlighted
        }
        return;
      }
      const b = e.target.closest('.rtab'); if (!b) return;
      state.round = b.dataset.round;
      const sec = b.closest('section'), y = sec.getBoundingClientRect().top;
      route();
      const again = document.querySelector('.rtab[aria-pressed="true"]');
      if (again) { const s2 = again.closest('section'); window.scrollBy(0, s2.getBoundingClientRect().top - y); again.focus(); }
    });
    // tap a budget to see the trades behind it (phones have no hover)
    const tip = document.createElement('div'); tip.className = 'tip'; tip.hidden = true; document.body.appendChild(tip);
    document.addEventListener('click', e => {
      const td = e.target.closest('td.bud');
      if (!td || !td.title || (!tip.hidden && tip.dataset.for === td.title)) { tip.hidden = true; tip.dataset.for = ''; return; }
      tip.textContent = td.title; tip.dataset.for = td.title; tip.hidden = false;
      const r = td.getBoundingClientRect(), w = Math.min(340, window.innerWidth - 32);
      tip.style.width = w + 'px';
      tip.style.left = Math.max(16, Math.min(r.right - w, window.innerWidth - w - 16)) + 'px';
      const below = r.bottom + 6 + tip.offsetHeight < window.innerHeight;
      tip.style.top = (below ? r.bottom + 6 : Math.max(8, r.top - 6 - tip.offsetHeight)) + 'px';
    });
    window.addEventListener('scroll', () => { tip.hidden = true; }, { passive: true });
    route();
  }
  init();
})();
