/* Footballpalooza hub: hash router, P-PPR toggle and the League Now page.
   Data comes from files the weekly GitHub Action writes (data/league-now.json). */
(() => {
  const app = document.getElementById('app');
  const state = { now: null, teams: {}, ppr: false, budgets: null, round: '1', themeTeam: '', mode: 'auto', open: new Set() };
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
      <section class="card set"><h2>P-PPR</h2><p>Pre-PPR seasons. Off shows FBP history from 2019 on, when the league became PPR. On adds the earlier non-PPR seasons to history and records in Reference.</p>
        <div class="seg" role="group" aria-label="P-PPR">${['off', 'on'].map(v => `<button type="button" data-ppr="${v}" aria-pressed="${state.ppr === (v === 'on')}">${v === 'on' ? 'On' : 'Off'}</button>`).join('')}</div></section>
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
    /* playoff odds panel, opened by tapping a team in Playoff picture or On the bubble */
    const O = d.odds && d.odds.teams;
    const race = new Set(seeds.map(s => s.id));
    d.standings.filter(t => !race.has(t.id)).sort((a, b) => b.pct - a.pct || b.allPlayW - a.allPlayW || b.pf - a.pf).slice(0, 3).forEach(t => race.add(t.id));
    const fp = v => v == null ? '–' : v >= 99.5 ? '>99%' : v > 0 && v < 0.5 ? '<1%' : v === 0 ? '<1%' : Math.round(v) + '%';
    const ord = n => n + (['th', 'st', 'nd', 'rd'][(n % 100 > 10 && n % 100 < 14) ? 0 : (n % 10 < 4 ? n % 10 : 0)]);
    function oddsPanel(id, seed) {
      const o = O && O[id];
      if (!o) return `<div class="odds"><p class="onote">Playoff odds appear once the season has games left to play.</p></div>`;
      const t = by[id];
      const head = seed === 1 ? ['Chance to keep the 1 seed', o.seed1] : seed === 2 ? ['Chance to take the 1 seed', o.seed1]
        : seed === 3 ? ['Chance to win the ' + t.divisionName, o.division] : ['Chance to make the playoffs', o.playoff];
      const P = ['Make playoffs', o.playoff], B = ['First-round bye', o.bye], D = ['Win ' + t.divisionName, o.division], S1 = ['1 seed', o.seed1];
      const stats = seed && seed <= 2 ? [B, D, P] : seed === 3 ? [P, B, S1] : [D, B, S1];
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
        <div class="ohead"><b>${fp(head[1])}</b><span>${esc(head[0])}</span></div>
        <div class="ostats">${stats.map(x => `<div><b>${fp(x[1])}</b><span>${esc(x[0])}</span></div>`).join('')}</div>
        <h4>Where they finish</h4><div class="dist">${dist}</div>
        <p class="onote">Projected record about ${o.projW.toFixed(1)}–${projL.toFixed(1)}${t.t ? `–${t.t}` : ''}${o.sosRank ? ` · remaining schedule is the ${o.sosRank === 1 ? 'toughest' : o.sosRank === 12 ? 'easiest' : ord(o.sosRank) + ' toughest'} in the league` : ''}</p>
        ${big.length ? `<h4>Biggest games <small>their ${stakeTxt} after a win or loss</small></h4><ul class="glist">${big.map(gameRow).join('')}</ul>` : ''}
        ${watch ? `<h4>Games to watch <small>other results that move their ${stakeTxt}</small></h4><ul class="wlist">${watch}</ul>` : ''}
        <p class="onote">From ${(d.odds.model.sims).toLocaleString()} simulated finishes of weeks ${d.weeksPlayed + 1}–${d.lastRegularSeasonWeek}, using each team’s scoring so far and the by-law tiebreaks.</p>
        ${games.length > big.length ? `<details class="all"><summary>All ${games.length} remaining games</summary><ul class="glist">${games.map(gameRow).join('')}</ul></details>` : ''}
      </div>`;
    }
    const tmWrap = (id, rowCls, inner, seed) => {
      const open = state.open.has(id);
      return `<div class="tm${open ? ' open' : ''}"><button type="button" class="${rowCls}" data-odds="${id}" aria-expanded="${open}">${inner}</button>${open ? oddsPanel(id, seed) : ''}</div>`;
    };
    const seedRows = seeds.map(s => {
      const t = by[s.id];
      return tmWrap(s.id, `seed${s.seed <= 2 ? ' bye' : ''}`, `<span class="n">${s.seed}</span>${chip(s.id)}<span class="rec">${rec(t)}<i class="car" aria-hidden="true"></i></span>
        <span class="via">${viaTxt(s)} · ${pts(t.pf)} pts</span>`, s.seed);
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
    const bubble = d.standings.filter(t => !inPo.has(t.id))
      .sort((a, b) => b.pct - a.pct || b.allPlayW - a.allPlayW || b.pf - a.pf).slice(0, 3)
      .map(t => {
        const gb = ((s5.w - t.w) + (t.l - s5.l)) / 2;
        const apb = s6.allPlayW - t.allPlayW;
        return tmWrap(t.id, 'seed bubrow', `${chip(t.id)}<span class="rec">${rec(t)}<i class="car" aria-hidden="true"></i></span>
          <span class="via">${gb <= 0 ? 'Tied for seed 5' : `${gb} GB of seed 5`} · ${apb <= 0 ? 'tied with seed 6 in all-play wins' : `${apb} all-play wins behind seed 6`} · ${pts(t.pf)} pts</span>`, null);
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

    const nm = id => (by[id] || {}).name || id;
    const basis = Object.fromEntries(d.draftOrder.map(p => [p.id, p]));
    const rounds = d.draftRounds || { 1: d.draftOrder.map(p => ({ pick: p.pick, id: p.id, owner: p.owner || p.id })) };
    const rnd = rounds[state.round] ? state.round : '1';
    const order = rounds[rnd].map(p => {
      const owner = p.owner || p.id, traded = owner !== p.id, b = basis[p.id] || {}, t = by[p.id];
      let why;
      if (rnd === '1') {
        why = p.pick <= 6 ? `Lowest potential points (${pts(t.pp)})${b.tiebreak ? ` · tiebreak on ${b.tiebreak}` : ''}`
                          : (b.basis || '').charAt(0).toUpperCase() + (b.basis || '').slice(1);
        if (traded) why = `Via ${nm(p.id)} · ${why.charAt(0).toLowerCase() + why.slice(1)}`;
      } else {
        why = traded ? `Via ${nm(p.id)}` : 'Own pick';
      }
      return `<li class="${p.pick > 6 ? 'po' : ''}${traded ? ' traded' : ''}"><span class="pk">${rnd}.${String(p.pick).padStart(2, '0')}</span>${chip(owner)}<span class="why">${esc(why)}</span></li>`;
    }).join('');
    const tradedCount = r => (rounds[r] || []).filter(p => p.owner !== p.id).length;
    const rtabs = Object.keys(rounds).map(r => `<button type="button" class="rtab" data-round="${r}" aria-pressed="${r === rnd}">Round ${r}${tradedCount(r) ? ` <span class="tc">${tradedCount(r)} traded</span>` : ''}</button>`).join('');
    const ownNote = d.pickOwnersKnown ? 'traded picks show their current owner' : 'pick trades not loaded yet';

    return `
      <div class="pagehead"><h1>League Now</h1>
        <span class="asof">${esc(d.season.replace(/footballpalooza/i, '').trim() || '')} season · <b>through Week ${d.weeksPlayed}</b> of ${d.lastRegularSeasonWeek}${genTxt ? ` · updated ${genTxt}` : ''}</span></div>
      <div class="grid2">
        <section><h2 class="sec">Playoff picture <small>if the season ended today${O ? ' · tap a team for its odds' : ''}</small></h2>
          <div class="card seeds">${seedRows}</div>
          <h2 class="sec" style="margin-top:16px">On the bubble</h2>
          <div class="card seeds">${bubble}</div>
        </section>
        <section><h2 class="sec">Bracket</h2><div class="card">${bracket}</div></section>
      </div>
      <section><h2 class="sec">Standings <small>division order uses the by-law tiebreaks</small></h2><div class="divs">${divTables}</div></section>
      <section><h2 class="sec">Projected ${esc(d.draftYear || '')} rookie draft order <small>order follows the standings; picks 7–12 assume higher seeds win · ${ownNote}</small></h2>
        <div class="rtabs" role="group" aria-label="Draft round">${rtabs}</div>
        <ol class="card order">${order}</ol></section>`;
  }

  /* ---------- placeholders ---------- */
  const SOON = {
    reference: ['Reference', 'The FBP Reference almanac moves in here: franchise pages, every season’s standings and brackets, records, head-to-head and draft and auction history.', ['Turn on P-PPR in Settings to include the pre-2019 non-PPR seasons.']],
    offseason: ['Off-Season', 'A sandbox for next year: rosters, cap space, keeper look-ahead, free agents, the incoming rookie class and auction price predictions tuned on 2026 results.', []],
    draft: ['Rookie Draft', 'A mock draft using the league’s actual draft order: auto-mock the whole league, make every pick yourself, or pick for your team while the rest auto-draft. Each rookie’s price shows as you go.', []],
    bylaws: ['By-Laws', 'The 2027 FBP by-laws, searchable and readable on a phone.', []],
  };
  const pageSoon = k => {
    const [h, p, extra] = SOON[k];
    return `<div class="card soon"><h2>${h}</h2><p>${p}</p>${extra.length ? `<ul>${extra.map(x => `<li>${x}</li>`).join('')}</ul>` : ''}<p>Coming soon.</p></div>`;
  };

  /* ---------- router ---------- */
  const TABS = ['now', 'reference', 'offseason', 'draft', 'bylaws', 'settings'];
  function route() {
    const tab = TABS.includes(location.hash.slice(1)) ? location.hash.slice(1) : 'now';
    document.querySelectorAll('.tabs a').forEach(a => { if (a.dataset.tab === tab) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
    if (tab === 'now') app.innerHTML = state.now ? pageNow() : '<p class="error">League data didn’t load. Refresh the page to try again.</p>';
    else if (tab === 'settings') app.innerHTML = pageSettings();
    else app.innerHTML = pageSoon(tab);
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
      document.getElementById('season-label').textContent = yr ? `${yr} season · League hub` : 'League hub';
    } catch (e) { state.now = null; }
    applyMode();
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { applyTheme(); if (location.hash === '#settings') route(); });
    window.addEventListener('hashchange', route);
    app.addEventListener('click', e => {
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
        if (again) { window.scrollBy(0, again.getBoundingClientRect().top - y); again.focus({ preventScroll: true }); }
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
