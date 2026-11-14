/* League Now > Stats: every player's FBP points by week this season, from data/stats.json (scripts/stats.py).
   Filters in one row: how many to show, position, week range and whose players; tap any header to sort.
   Week cells carry the Heat Check label (Nuclear, Hot, Cold, Bust, Witness Protection) as a tint when he earned one.
   The upcoming week's NFL opponent comes from ESPN's scoreboard. Tap a team logo up top to highlight its players. */
window.FBPStats = (function () {
  let S = null, A = null, failed = false, loading = false, X = null, opp = null, oppWk = 0;
  const F = { top: 50, pos: '', from: 1, to: 0, who: [], st: false };   // who: any of 'fa', 'ro', 'team', each turned on and off on its own; none = everyone   // st: Starters, only weeks he was in an FBP starting lineup
  let hl = '', hlSeed = null;   // hlSeed: the default team last applied, so a new default re-highlights   // the team whose players are highlighted (tap a logo; tap again to clear)
  let sort = ['pts', -1];
  let q = '';   // the player search; not saved, and it looks past the Top limit
  const fold = v => String(v || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/-/g, ' ').replace(/[^a-z0-9 ]/g, '');
  try { Object.assign(F, JSON.parse(localStorage.getItem('fbp-stats') || '{}')); } catch (e) {}
  F.who = (Array.isArray(F.who) ? F.who : F.who ? [F.who] : []).filter(v => ['fa', 'ro', 'team'].includes(v));
  F.st = !!F.st;
  const save = () => { try { localStorage.setItem('fbp-stats', JSON.stringify(F)); } catch (e) {} };
  const NFLE = { GBP: 'gb', KCC: 'kc', NEP: 'ne', NOS: 'no', SFO: 'sf', TBB: 'tb', LVR: 'lv', JAC: 'jax', WAS: 'wsh', LA: 'lar' };
  const ab = t => NFLE[t] || (t || '').toLowerCase();
  const logo = t => t ? `<img class="st-nfl" src="https://a.espncdn.com/i/teamlogos/nfl/500/${ab(t)}.png" alt="" loading="lazy">` : '';
  const HC = { N: 'nuke', H: 'hot', C: 'cold', B: 'bust', W: 'wp' };
  const SHORT = { '1st Team': '1st', '2nd Team': '2nd', 'Top Waiver': 'Waiver', 'High Game': 'High', 'Worst Contract': 'Worst $', 'Best Value': 'Value', 'Bench Points': 'Bench' };
  const redraw = () => { const y = window.scrollY; if (X && X.rerender) { X.rerender(); window.scrollTo(0, y); } };
  function load() {
    if (S || loading || failed) return;
    loading = true;
    Promise.all([fetch('data/stats.json', { cache: 'no-cache' }).then(r => r.ok ? r.json() : Promise.reject()),
      fetch('data/analytics.json', { cache: 'no-cache' }).then(r => r.ok ? r.json() : null).catch(() => null)])
      .then(([s, a]) => { S = s; A = a; loading = false; loadOpp(); redraw(); }, () => { failed = true; loading = false; redraw(); });
  }
  // the next week's NFL opponents
  function loadOpp() {
    oppWk = (S.weeks[S.weeks.length - 1] || 0) + 1;
    fetch(`https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?seasontype=2&week=${oppWk}&dates=${S.season}`)
      .then(r => r.ok ? r.json() : null).then(j => { if (!j) return; opp = {};
        (j.events || []).forEach(ev => { const cs = ((ev.competitions || [])[0] || {}).competitors || [];
          cs.forEach(c => { const o = cs.find(x => x !== c); if (o) opp[c.team.abbreviation.toLowerCase()] = { t: o.team.abbreviation, home: c.homeAway === 'home' }; }); });
        redraw(); }).catch(() => {});
  }

  function render(ctx) {
    X = ctx; load();
    if (failed) return '<p class="error">Stats didn’t load.</p>';
    if (!S) return '<p class="loading">Loading stats…</p>';
    if ((ctx.myTeam || '') !== hlSeed) { hlSeed = ctx.myTeam || ''; hl = hlSeed; }
    const esc = ctx.esc, W = S.weeks, last = W[W.length - 1] || 0;
    const to = Math.min(F.to || last, last), from = Math.min(F.from || 1, to);
    const wi = W.map((w, i) => [w, i]).filter(([w]) => w >= from && w <= to);
    const HP = (A && A.heatPlayers) || {}, HW = (A && A.heatWeeks) || [];
    const HV = { N: 3, H: 1, C: -1, B: -2, W: -3 };
    const team = f => ctx.teams[f] || {};
    let rows = S.rows.filter(r => !F.pos || (F.pos === 'FLEX' ? ['RB', 'WR', 'TE'].includes(r.p) : r.p === F.pos))
      .filter(r => !F.who.length || F.who.some(w => w === 'ro' ? r.f : w === 'fa' ? !r.f : !hl || r.f === hl))   // shown if it matches any button that's on
      .filter(r => { const t = fold(q).split(' ').filter(Boolean); if (!t.length) return true; const n = fold(r.n); return t.every(x => n.includes(x)); })
      .map(r => { const on = i => (r.s || '')[i] === '1';
        const sc = wi.map(([, i]) => F.st && !on(i) ? null : r.w[i]), gs = wi.filter(([, i]) => on(i)).length;
        const pts = sc.reduce((a, v) => a + (v || 0), 0), gp = sc.filter(v => v != null).length;   // a traded player can carry his new team's bye over a week he played
        const h = HP[r.id], heat = h ? wi.reduce((a, [w]) => { const c = h.w[HW.indexOf(w)]; return a + (HV[c] || 0); }, 0) : 0;
        return Object.assign({}, r, { pts, avg: gp ? pts / gp : 0, gp, gs, heat }); })
      .filter(r => !F.st || r.gs);
    const key = { pts: r => r.pts, gs: r => r.gs, avg: r => r.avg, heat: r => r.heat, name: r => r.n, sal: r => r.sal == null ? -1 : r.sal, bye: r => r.bye || 0,
      own: r => r.f ? (team(r.f).abbr || r.f) : 'zz', nfl: r => r.t || 'zz' };
    const kf = sort[0].startsWith('w') ? (r => { const k = W.indexOf(+sort[0].slice(1)); const v = F.st && (r.s || '')[k] !== '1' ? null : r.w[k]; return v == null ? -99 : v; }) : key[sort[0]] || key.pts;
    rows.sort((a, b) => { const x = kf(a), y = kf(b); return (typeof x === 'string' ? x.localeCompare(y) : x - y) * sort[1] || b.pts - a.pts; });
    const shown = F.top && !q.trim() ? rows.slice(0, F.top) : rows;
    const th = (k, l, cls) => `<th class="${cls || ''}${sort[0] === k ? ' on' : ''}" data-st-sort="${k}">${l}${sort[0] === k ? (sort[1] < 0 ? ' ▾' : ' ▴') : ''}</th>`;
    const sel = (k, opts, cur = F[k]) => `<select data-st-f="${k}" aria-label="${k}">${opts.map(([v, l]) => `<option value="${v}"${String(cur) === String(v) ? ' selected' : ''}>${l}</option>`).join('')}</select>`;
    const wkOpts = W.map(w => [w, w]);
    const filters = `<div class="st-f">
      <input class="pr-q st-q" type="search" placeholder="Find a player" aria-label="Find a player" autocomplete="off" value="${esc(q)}">
      <label>Top ${sel('top', [[25, 25], [50, 50], [100, 100], [0, 'All']])}</label>
      ${sel('pos', [['', 'All positions'], ['QB', 'QB'], ['RB', 'RB'], ['WR', 'WR'], ['TE', 'TE'], ['FLEX', 'RB/WR/TE'], ['DEF', 'DEF']])}
      <label>Weeks ${sel('from', wkOpts, from)} to ${sel('to', wkOpts, to)}</label>
    </div>
    <div class="st-row2"><div class="seg pl-show st-who" role="tablist" aria-label="Which players">${[['', 'All players'], ['fa', 'Free agents'], ['ro', 'Rostered'], ['team', hl ? (team(hl).abbr || hl) : 'Selected team']].map(([v, l]) =>
      `<button type="button" role="tab" data-st-who="${v}" aria-selected="${v ? F.who.includes(v) : !F.who.length}"${v === 'team' ? ` title="${hl ? esc(team(hl).name || hl) + '’s players' : 'Pick a team from the logos above'}"` : ''}>${v === 'team' && hl && team(hl).logo ? `<img class="st-wl" src="${team(hl).logo}" alt="">` : ''}${esc(l)}</button>`).join('')}</div>
    <button type="button" class="st-stb" data-st-starts aria-pressed="${F.st}" title="Count only the weeks he was in an FBP starting lineup">Starters</button></div>`;
    const me = hl;
    const picker = `<div class="st-pick" role="group" aria-label="Highlight a team’s players">${Object.keys(ctx.teams).sort((a, b) => (team(a).abbr || '').localeCompare(team(b).abbr || '')).map(f =>
      `<button type="button" data-st-hl="${f}" aria-pressed="${f === hl}" title="${esc(team(f).name || f)}">${team(f).logo ? `<img src="${team(f).logo}" alt="${esc(team(f).abbr || f)}">` : `<span>${esc(team(f).abbr || f)}</span>`}</button>`).join('')}</div>`;
    const body = shown.map((r, i) => {
      const t = r.f ? team(r.f) : null, h = HP[r.id];
      const cells = wi.map(([w, k]) => { const v = r.w[k], bench = F.st && v != null && (r.s || '')[k] !== '1', hk = h && HW.indexOf(w) >= 0 ? HC[h.w[HW.indexOf(w)]] : '';
        return w === r.bye && v == null ? '<td class="st-w st-bye">B</td>' : bench ? '<td class="st-w st-nos" title="Not in a starting lineup"></td>' : `<td class="st-w${hk ? ' ' + hk : ''}">${v == null ? '' : v.toFixed(1)}</td>`; }).join('');
      const o = opp && r.t ? opp[ab(r.t)] : null;
      const nm = `<a href="${r.f ? `#now/team/${r.f}/${r.id}` : `#now/player/${r.id}`}">${esc(r.n)}</a>`;
      return `<tr class="${r.f && r.f === me ? 'st-me' : ''}"><td class="st-n">${i + 1}</td>
        <td class="st-pl"><span class="st-nm">${nm}</span><small>${t ? `${t.logo ? `<img class="st-fl" src="${t.logo}" alt="${esc(t.abbr || r.f)}" title="${esc(t.name || r.f)}">` : `<b>${esc(t.abbr || r.f)}</b>`}${r.sl ? `<i>${r.sl}</i>` : ''}` : '<b class="st-fa">FA</b>'}<span class="st-dot">·</span>${r.p}${r.t ? logo(r.t) : ''}${(r.hon || []).map(([l, c]) => `<span class="ro-chip ${c} st-ch" title="${esc(l)}"><span class="lg-only">${esc(l)}</span><span class="sm-only">${esc(SHORT[l] || l)}</span></span>`).join('')}</small></td>
        <td class="n st-pts"><b>${r.pts.toFixed(1)}</b></td><td class="n st-avg">${r.avg.toFixed(2)}</td><td class="n st-gs">${r.gs || ''}</td>
        <td class="n st-heat"><b class="${r.heat > 0 ? 'hc-pos' : r.heat < 0 ? 'hc-neg' : ''}">${r.heat > 0 ? '+' : ''}${r.heat}</b></td>${cells}
        <td class="st-op">${!r.t ? '' : o ? `<span class="st-opu"><span>${o.home ? 'vs' : '@'}</span>${logo(o.t)}</span>` : opp ? '<span class="st-byew">BYE</span>' : ''}</td>
        <td class="n">${r.bye || ''}</td><td class="n">${r.sal != null ? '$' + Math.round(r.sal) : ''}</td><td class="n">${r.cy || ''}</td></tr>`; }).join('');
    return `<section><h2 class="sec">Stats <small>FBP points by week, ${S.season}</small></h2>
      ${picker}${filters}
      <div class="card tbl-wrap st-wrap"><table class="st-t"><thead>
        <tr><th class="st-n"></th><th class="st-pl"></th><th></th><th></th><th></th><th></th><th class="st-grp" colspan="${wi.length}">${F.st ? 'Weekly points in starts' : 'Weekly points'}</th><th colspan="4"></th></tr>
        <tr><th class="st-n">#</th>${th('name', 'Player', 'st-pl')}${th('pts', 'Pts', 'n st-pts')}${th('avg', 'Avg', 'n st-avg')}${th('gs', 'Starts', 'n st-gs')}${th('heat', 'Heat', 'n st-heat')}${wi.map(([w]) => th('w' + w, w, 'n st-w')).join('')}
        ${th('nfl', `Wk ${oppWk}`, 'st-op')}${th('bye', 'Bye', 'n')}${th('sal', 'Salary', 'n')}<th class="n">Contract</th></tr></thead>
        <tbody>${body || `<tr><td colspan="${wi.length + 10}" class="st-none">No players match.</td></tr>`}</tbody></table></div>
      <p class="rf-foot st-foot">Showing ${shown.length} of ${rows.length}${q.trim() ? ' matching “' + esc(q.trim()) + '”' : ''}. Through week ${last}; a week joins once MFL closes it. Avg counts games played (byes left out). Starts: weeks in an FBP starting lineup. With Starters on, Pts, Avg and the weekly points count only those starts. A hatched week: he scored but sat on the bench. B: bye. Heat: the Heat Check score for the weeks shown (Nuclear +3, Hot +1, Cold −1, Bust −2, Witness Protection −3). Tinted weeks are Heat Check labels: <span class="st-k nuke">Nuclear</span> <span class="st-k hot">Hot</span> <span class="st-k cold">Cold</span> <span class="st-k bust">Bust</span> <span class="st-k wp">Witness Protection</span>. T: taxi squad, IR: injured reserve. Tap a team’s logo to highlight its players; tap it again to clear. Searching shows every match, past the Top limit.</p>
    </section>`;
  }

  document.addEventListener('click', e => {
    const wb = e.target.closest && e.target.closest('[data-st-who]');
    if (wb) { const v = wb.dataset.stWho; F.who = !v ? [] : F.who.includes(v) ? F.who.filter(x => x !== v) : F.who.concat(v); save(); return redraw(); }
    if (e.target.closest && e.target.closest('[data-st-starts]')) { F.st = !F.st; save(); return redraw(); }
    const b = e.target.closest && e.target.closest('[data-st-hl]');
    if (b) { hl = hl === b.dataset.stHl ? '' : b.dataset.stHl; return redraw(); }
    const h = e.target.closest && e.target.closest('[data-st-sort]'); if (!h) return;
    const k = h.dataset.stSort; sort = sort[0] === k ? [k, -sort[1]] : [k, k === 'name' || k === 'own' || k === 'nfl' ? 1 : -1]; redraw();
  });
  // typing swaps only the table and its count, so the search box keeps focus and the keyboard stays up
  document.addEventListener('input', e => {
    if (!(e.target.matches && e.target.matches('.st-q'))) return;
    q = e.target.value;
    const tmp = document.createElement('div'); tmp.innerHTML = render0(X);
    [['.st-wrap'], ['.st-foot']].forEach(([c]) => { const a = document.querySelector(c), b = tmp.querySelector(c); if (a && b) a.replaceWith(b); });
    requestAnimationFrame(syncFloat);
  });
  document.addEventListener('change', e => {
    const s = e.target.closest && e.target.closest('[data-st-f]'); if (!s) return;
    const k = s.dataset.stF; F[k] = ['top', 'from', 'to'].includes(k) ? +s.value : s.value;
    if (k === 'from' && F.to && F.from > F.to) F.to = F.from;
    if (k === 'to' && F.from > F.to) F.from = F.to;
    save(); redraw();
  });
  // the header row stays pinned under the site's menu while you scroll down the table: a copy of the header, fixed in
  // place, matched to the table's column widths and kept in step with its sideways scroll
  let floatEl = null, floatFor = null;
  function syncFloat() {
    const wrap = document.querySelector('.st-wrap');
    if (!wrap) { if (floatEl) { floatEl.remove(); floatEl = null; floatFor = null; } return; }
    const tbl = wrap.querySelector('table'), head = tbl && tbl.tHead; if (!head) return;
    const bar = document.querySelector('.top'), top = bar ? Math.max(0, bar.getBoundingClientRect().bottom) : 0;
    const r = wrap.getBoundingClientRect(), hh = head.getBoundingClientRect().height;
    if (!(r.top < top && r.bottom > top + hh * 2)) { if (floatEl) floatEl.style.display = 'none'; return; }
    if (!floatEl || floatFor !== tbl) {
      if (floatEl) floatEl.remove();
      floatEl = document.createElement('div'); floatEl.className = 'st-float'; floatEl.setAttribute('aria-hidden', 'true');
      const t = document.createElement('table'); t.className = tbl.className; t.style.width = tbl.offsetWidth + 'px';
      const c = head.cloneNode(true); t.appendChild(c);
      const a = head.querySelectorAll('th'), b = c.querySelectorAll('th');
      a.forEach((th, i) => { const w = th.getBoundingClientRect().width + 'px'; Object.assign(b[i].style, { width: w, minWidth: w, maxWidth: w, boxSizing: 'border-box' }); });
      floatEl.appendChild(t); document.body.appendChild(floatEl); floatFor = tbl;
    }
    Object.assign(floatEl.style, { display: '', top: top + 'px', left: r.left + 'px', width: wrap.clientWidth + 'px' });
    floatEl.scrollLeft = wrap.scrollLeft;
  }
  document.addEventListener('scroll', syncFloat, { passive: true, capture: true });
  window.addEventListener('resize', () => { if (floatEl) { floatEl.remove(); floatEl = null; floatFor = null; } syncFloat(); });
  window.addEventListener('hashchange', () => setTimeout(syncFloat, 50));
  const render0 = render;
  return { render: ctx => { const html = render0(ctx); requestAnimationFrame(syncFloat); return html; } };
})();
