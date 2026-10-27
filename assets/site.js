/* Footballpalooza hub: hash router, P-PPR toggle and the League Now page.
   Data comes from files the weekly GitHub Action writes (data/league-now.json). */
(() => {
  // Site version shown in the header. Add 0.0001 with every push Paul approves (see claude/github-push-setup.md).
  const VERSION = '0.0042';
  window.FBP = Object.assign(window.FBP || {}, { version: VERSION });   // pages use it to reset saved state after an update
  const app = document.getElementById('app');
  const state = { now: null, teams: {}, ppr: false, budgets: null, round: '1', themeTeam: '', mode: 'auto', open: new Set(), bylaws: null, blOpen: new Set() };
  try { state.ppr = localStorage.getItem('fbp-ppr') === '1'; state.themeTeam = localStorage.getItem('fbp-theme-team') || ''; state.mode = localStorage.getItem('fbp-mode') || 'auto'; } catch (e) {}
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
    return `<div class="pagehead"><h1>Settings</h1><span class="asof">Saved on this device only</span></div>
      <section class="card set"><h2>Page colors</h2><p>Recolors the header, tabs and highlight numbers. Text stays neutral so everything stays readable.</p>
        <div class="swatches" role="group" aria-label="Page colors">${swatches}</div></section>
      <section class="card set"><h2>Light or dark</h2><p>Match device follows your phone or computer’s setting.</p>
        <div class="seg" role="group" aria-label="Light or dark">${seg}</div></section>`;
  }

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
    function fullSchedule(id, left, gameRow) {
      const played = (d.games || []).filter(g => g[1] === id || g[3] === id).map(g => {
        const me = g[1] === id, mine = me ? g[2] : g[4], theirs = me ? g[4] : g[2], opp = me ? g[3] : g[1];
        const r = mine > theirs ? 'W' : mine < theirs ? 'L' : 'T';
        return { week: g[0], html: `<li class="done"><div class="gl"><b class="wk">Wk ${g[0]}</b><span class="vs">vs</span>${chip(opp)}<span class="res ${r}">${r} ${pts(mine)}–${pts(theirs)}</span></div></li>` };
      });
      const rows = played.concat(left.map(g => ({ week: g.week, html: gameRow(g) }))).sort((a, b) => a.week - b.week);
      if (!rows.length) return '';
      return `<details class="all"><summary>Full schedule <small>${played.length} played · ${left.length} to go</small></summary><ul class="glist">${rows.map(r => r.html).join('')}</ul></details>`;
    }
    const tmWrap = (id, rowCls, inner, seed) => {
      const open = state.open.has(id);
      return `<div class="tm${open ? ' open' : ''}"><button type="button" class="${rowCls}" data-odds="${id}" aria-expanded="${open}">${inner}</button>${open ? oddsPanel(id, seed) : ''}</div>`;
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
          <span class="via">${gb <= 0 ? 'Tied for seed 5' : `${gb} GB of seed 5`} · ${apb <= 0 ? 'tied with seed 6 in all-play wins' : `${apb} all-play wins behind seed 6`} · ${pts(t.pf)} pts${rowOdds(t.id)}</span>`, null);
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
        <span class="via">${odds ? odds + ' · ' : ''}${gb <= 0 ? 'Tied for seed 5' : `${gb} GB of seed 5`} · ${apb <= 0 ? 'tied with seed 6 in all-play wins' : `${apb} all-play wins behind seed 6`}</span>
        <span class="pep">“${esc(q)}” <span class="who">— ${esc(who)}</span></span>`, null);
    }).join('');

    const divTables = d.divisions.map(dv => {
      const rows = d.standings.filter(t => t.division === dv.id).sort((a, b) => a.divisionRank - b.divisionRank);
      const gb = v => v <= 0 ? '—' : (Number.isInteger(v) ? v : v.toFixed(1));
      return `<div class="card"><h3 class="dvh">${esc(dv.name)}</h3><div class="tbl-wrap"><table class="tbl">
        <thead><tr><th class="lg"><span class="sr">Logo</span></th><th class="t">Team</th><th>W-L-T</th><th>GB</th><th class="hide-sm">Pct</th><th class="hide-sm" title="Division record">Div</th>
          <th>PF</th><th class="hide-sm">PA</th><th class="hide-sm" title="Points per game">Avg</th><th class="hide-sm" title="Potential points (best possible lineup)">PP</th>
          <th title="All-play record: results against every team, every week">All-play</th><th class="hide-sm">Strk</th>${state.budgets ? `<th title="${state.budgets.season} auction budget, after trades">${state.budgets.season} $</th>` : ''}</tr></thead><tbody>
        ${rows.map(t => `<tr><td class="lg">${(state.teams[t.id] || {}).logo ? `<img src="${state.teams[t.id].logo}" alt="" loading="lazy">` : ''}</td><td class="t">${chip(t.id, { noLogo: true, after: t.seed ? `<span class="pill${t.seed > 3 ? ' wc' : ''}" title="Current playoff seed">${t.seed}</span>` : '' })}</td>
          <td>${t.w}-${t.l}-${t.t}</td><td>${gb(t.gb)}</td><td class="hide-sm">${t.pct.toFixed(3).replace(/^0/, '')}</td><td class="hide-sm">${esc(t.divRecord || '')}</td>
          <td>${pts(t.pf)}</td><td class="hide-sm">${pts(t.pa)}</td><td class="hide-sm">${pts(t.avgPf)}</td><td class="hide-sm">${pts(t.pp)}</td>
          <td>${t.allPlayW}-${t.allPlayL}${t.allPlayT ? '-' + t.allPlayT : ''}</td><td class="hide-sm">${esc(t.streak)}</td>${state.budgets ? (() => { const bg = budget(t.id); const tip = bg.adj.length ? bg.adj.map(x => `${x.amount < 0 ? '−' : '+'}$${Math.abs(x.amount)} ${x.note}`).join('\n\n') : 'No adjustments yet'; return `<td class="bud${bg.total < (state.budgets.default || 200) ? ' chg' : bg.total > (state.budgets.default || 200) ? ' up' : ''}" title="${esc(tip)}">$${bg.total}</td>`; })() : ''}</tr>`).join('')}
        </tbody></table></div></div>`;
    }).join('');

    // the all-play 6 seed: best all-play record among teams that aren't division winners or wild cards
    const top5 = new Set(seeds.slice(0, 5).map(s => s.id));
    const sixRace = d.standings.filter(t => !top5.has(t.id)).sort((a, b) => b.allPlayW - a.allPlayW || b.pf - a.pf);
    const lead = sixRace[0];
    const sixRows = sixRace.slice(0, 5).map((t, i) => {
      const gap = lead.allPlayW - t.allPlayW, o = O && O[t.id];
      return `<div class="six${i === 0 ? ' hold' : ''}"><span class="n">${i === 0 ? '6' : ''}</span>${chip(t.id)}
        <span class="ap"><b>${t.allPlayW}-${t.allPlayL}${t.allPlayT ? '-' + t.allPlayT : ''}</b><small>${i === 0 ? 'holds the 6 seed' : gap ? `${gap} behind` : 'tied'}</small></span>
        <span class="sx">${o ? `<b>${fp(o.seeds[5])}</b>${dlt(t.id, 'seed6', o.seeds[5])}<small>chance at 6</small>` : ''}</span></div>`;
    }).join('');

    // Power Rankings: MFL's power rating for now (our own formula comes later)
    const pr = d.standings.slice().sort((a, b) => (a.pwrRank || 99) - (b.pwrRank || 99));
    const hasPwr = pr.some(t => t.pwr);
    const powerRows = pr.map((t, i) => `<tr><td class="pr-n">${t.pwrRank || i + 1}</td><td class="pr-mv">${rankMove(t.id, 'pwrRank', t.pwrRank)}</td>
      <td class="lg">${(state.teams[t.id] || {}).logo ? `<img src="${state.teams[t.id].logo}" alt="" loading="lazy">` : ''}</td><td class="t">${chip(t.id, { noLogo: true })}</td>
      <td><b>${t.pwr ? t.pwr.toFixed(2) : '—'}</b></td><td>${t.w}-${t.l}${t.t ? '-' + t.t : ''}</td><td>${pts(t.pf)}</td><td class="hide-sm">${t.allPlayW}-${t.allPlayL}${t.allPlayT ? '-' + t.allPlayT : ''}</td><td class="hide-sm">${esc(t.streak)}</td></tr>`).join('');

    const sub = (location.hash.split('/')[1] || '');
    const nav = `<nav class="rf-sub seg now-sub">${[['', 'Standings'], ['power', 'Power Rankings'], ['playoffs', 'Playoff Picture']].map(([k, l]) => `<a href="#now${k ? '/' + k : ''}"${k === sub ? ' aria-current="page"' : ''}>${l}</a>`).join('')}</nav>`;
    const headTxt = `<div class="pagehead"><h1>League Now</h1>
        <span class="asof">${esc(d.season.replace(/footballpalooza/i, '').trim() || '')} season · <b>through Week ${d.weeksPlayed}</b> of ${d.lastRegularSeasonWeek}${genTxt ? ` · updated ${genTxt}` : ''}${P ? ` · arrows show change since week ${pw}` : ''}</span></div>${nav}`;

    if (sub === 'power') return headTxt + `
      <section><h2 class="sec">Power Rankings <small>MFL’s power rating for now; our own formula is coming</small></h2>
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

    return headTxt + `
      <section><h2 class="sec">Standings <small>division order uses the by-law tiebreaks</small></h2><div class="divs">${divTables}</div></section>`;
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
  const draftCtx = () => ({ now: state.now, teams: state.teams, chip, esc, nameOf, rerender: () => { if (location.hash.startsWith('#draft') || location.hash === '#awards') route(); } });

  /* ---------- router ---------- */
  const TABS = ['now', 'awards', 'reference', 'offseason', 'draft', 'bylaws', 'settings'];
  const refCtx = () => ({ teams: state.teams, chip, esc, ppr: state.ppr, rerender: () => { if (location.hash.startsWith('#reference')) route(); } });
  let lastPage = '';
  function route() {
    const parts = location.hash.slice(1).split('/');
    const tab = TABS.includes(parts[0]) ? parts[0] : 'now';
    document.querySelectorAll('.tabs a').forEach(a => { if (a.dataset.tab === tab) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
    if (tab === 'now') app.innerHTML = state.now ? pageNow() : '<p class="error">League data didn’t load. Refresh the page to try again.</p>';
    else if (tab === 'settings') app.innerHTML = pageSettings();
    else if (tab === 'awards') app.innerHTML = window.FBPAwards ? FBPAwards.render(draftCtx()) : '<p class="error">Awards didn’t load.</p>';
    else if (tab === 'reference') {
      const path = parts.slice(1);
      app.innerHTML = window.FBPRef ? FBPRef.render(refCtx(), path) : '<p class="error">The Reference section didn’t load.</p>';
      // a new page starts at the top; switching sub-tabs (weeks, boards) keeps your place
      const page = 'reference/' + (window.FBPRef ? FBPRef.pageKey(path) : '');
      if (page !== lastPage && lastPage) window.scrollTo(0, 0);
      lastPage = page;
    }
    else if (tab === 'draft') {
      // sub-tabs: FBP Home (#draft), Mock Draft (#draft/mock), Big Board, Full Order
      const sub = parts[1] || '';
      if (sub === 'mock') { app.innerHTML = window.FBPDraft ? FBPDraft.render(draftCtx()) : '<p class="error">The draft tool didn’t load.</p>'; if (window.FBPDraft) FBPDraft.after(); }
      else app.innerHTML = window.FBPDraftHub ? FBPDraftHub.render(draftCtx(), sub) : '<p class="error">The Rookie Draft page didn’t load.</p>';
      const page = 'draft/' + sub;
      if (page !== lastPage && lastPage.startsWith('draft/')) window.scrollTo(0, 0);
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

  async function init() {
    try {
      const [now, teams] = await Promise.all([
        fetch('data/league-now.json', { cache: 'no-cache' }).then(r => { if (!r.ok) throw 0; return r.json(); }),
        fetch('data/teams.json').then(r => r.ok ? r.json() : { teams: {} }),
      ]);
      state.now = now; state.teams = teams.teams || {};
      try { state.budgets = await fetch('data/budgets.json', { cache: 'no-cache' }).then(r => r.ok ? r.json() : null); } catch (e) { state.budgets = null; }
      const yr = (now.season.match(/\d{4}/) || [''])[0];
      document.getElementById('season-label').textContent = (yr ? `${yr} season · League hub` : 'League hub') + ` · v ${VERSION}`;
    } catch (e) { state.now = null; }
    applyMode();
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { applyTheme(); if (location.hash === '#settings') route(); });
    window.addEventListener('hashchange', route);
    // sticky panels sit just under the header, whatever height it wraps to
    const hdr = () => document.documentElement.style.setProperty('--hdr-h', document.querySelector('.top').offsetHeight + 'px');
    hdr(); window.addEventListener('resize', hdr);
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
