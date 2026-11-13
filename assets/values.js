/* Player Value and Trade Value (data/values.json, scripts/trade_values.py).
   Player Value: ability, potential and production, from FantasyPros' dynasty consensus rank. Trade Value: the same
   player with his FBP contract counted: salary and years left. Both run 1-9999.
   FBPValues.chart(ctx)  Trading Floor > Value Chart: one column of value levels, and a column per position, each
                         player placed at his level so players of about the same value sit side by side.
   FBPValues.league(ctx) League Now > Rosters > Value: every team's players by value (dots or a positional radar),
                         position ranks, average age, own 1st, and a two-team comparison. */
window.FBPValues = (function () {
  let V = null, failed = false, loading = false, X = null;
  let mode = 'tv', picksOn = true, shape = 'dots', cmpA = '', cmpB = '', cmpAll = false, chartLow = 2000;
  try { mode = localStorage.getItem('fbp-val-mode') || 'tv'; shape = localStorage.getItem('fbp-val-shape') || 'dots'; } catch (e) {}
  const esc = s => (X && X.esc ? X.esc(s) : String(s == null ? '' : s));
  const redraw = () => { const y = window.scrollY; if (X && X.rerender) { X.rerender(); window.scrollTo(0, y); } };
  function load() {
    if (V || loading || failed) return;
    loading = true;
    fetch('data/values.json', { cache: 'no-cache' }).then(r => r.ok ? r.json() : Promise.reject())
      .then(j => { V = j; loading = false; redraw(); }, () => { failed = true; loading = false; redraw(); });
  }
  const POS = ['QB', 'RB', 'WR', 'TE', 'PICK'];
  const PL = { QB: 'QB', RB: 'RB', WR: 'WR', TE: 'TE', PICK: 'Picks' };
  const COL = { QB: '#e06c75', RB: '#4f9fd8', WR: '#5cb67f', TE: '#a77fd6', PICK: '#d4b04f', DEF: '#9aa3ad' };
  const ord = n => n + (n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] || 'th');
  const tm = f => (X && X.teams && X.teams[f]) || {};
  const val = x => x[mode];
  const MODE = { tv: ['Trade Value', 'contract counted: salary and years left'], pv: ['Player Value', 'ability, potential and production only'] };
  const toggles = (withPicks) => `<div class="vl-ctl"><div class="seg vl-mode" role="tablist" aria-label="Value">${Object.entries(MODE).map(([k, [l, why]]) =>
    `<button type="button" role="tab" data-vl-mode="${k}" aria-selected="${mode === k}" title="${why}">${l}</button>`).join('')}</div>
    ${withPicks ? `<label class="tf-chk"><input type="checkbox" data-vl-picks${picksOn ? ' checked' : ''}> Include picks</label>` : ''}</div>`;
  const items = () => Object.entries(V.players).map(([id, r]) => Object.assign({ id }, r)).filter(r => r.pos !== 'DEF')
    .concat(picksOn ? V.picks.map(p => Object.assign({ pos: 'PICK' }, p)) : []);
  const link = r => r.pos === 'PICK' ? null : `#now/team/${r.f}/${r.id}`;
  const foot = () => `<p class="rf-foot">Player Value is ability, potential and production: FantasyPros’ dynasty consensus rank (data © FantasyPros, as of ${esc(V.ecrUpdated || '')}) on a 1–9,999 curve. Trade Value counts the FBP contract too: the rest of this season plus every year left on his deal, what he’d fetch at auction less his salary that year (never below zero, since an owner can let an overpaid player go). A cheap young player on a long deal can outrank a better player on a big or expiring one. Picks are the rookie a slot usually lands, on a rookie deal at the by-law salary, 20% off for misses; 2027 picks use today’s draft order.</p>`;

  /* ---------- Trading Floor > Value Chart ---------- */
  function chart(ctx) {
    X = ctx; load();
    if (failed) return '<p class="error">Values didn’t load.</p>';
    if (!V) return '<p class="loading">Loading values…</p>';
    const L = items(), step = 250, top = Math.ceil(Math.max(...L.map(val)) / step) * step;
    const rows = [];
    for (let hi = top; hi > chartLow; hi -= step) {
      const cells = POS.map(p => L.filter(r => r.pos === p && val(r) <= hi && val(r) > hi - step).sort((a, b) => val(b) - val(a)));
      if (cells.some(c => c.length)) rows.push([hi, cells]);
    }
    const chip = r => { const h = link(r), t = tm(r.f);
      const inner = `<b>${esc(r.n)}</b><small>${t.logo ? `<img src="${t.logo}" alt="">` : ''}${esc(t.abbr || '')} · ${val(r).toLocaleString()}${mode === 'tv' && r.sal != null ? ' · $' + Math.round(r.sal) : ''}</small>`;
      return h ? `<a class="vl-chip" href="${h}" style="--pc:${COL[r.pos]}">${inner}</a>` : `<span class="vl-chip" style="--pc:${COL[r.pos]}">${inner}</span>`; };
    return `<div class="vl-chart">${toggles(true)}
      <p class="tf-sub">${MODE[mode][0]}: ${MODE[mode][1]}. Each row is a 250-point band; players in the same row are worth about the same. Tap a player for his page.</p>
      <div class="tbl-wrap"><table class="vl-ct"><thead><tr><th class="vl-v">Value</th>${POS.map(p => `<th style="--pc:${COL[p]}">${PL[p]}</th>`).join('')}</tr></thead>
      <tbody>${rows.map(([hi, cells]) => `<tr><td class="vl-v">${hi.toLocaleString()}</td>${cells.map(c => `<td>${c.map(chip).join('')}</td>`).join('')}</tr>`).join('')}</tbody></table></div>
      ${chartLow > 0 ? `<button type="button" class="ro-howb" data-vl-more>Show values under ${chartLow.toLocaleString()}</button>` : ''}
      ${foot()}</div>`;
  }

  /* ---------- Rosters > Value ---------- */
  function dots(list) {
    const w = 420, h = 170, pl = 30, pb = 18, pt = 8, n = Math.max(30, list.length), x = i => pl + (w - pl - 8) * (i + 0.5) / n, y = v => pt + (h - pt - pb) * (1 - v / 10000);
    const ax = [5, 10, 15, 20, 25, 30, 35].filter(k => k <= n).map(k => `<text x="${x(k - 1)}" y="${h - 4}" class="vl-ax" text-anchor="middle">${k}</text>`).join('');
    const gr = [2500, 5000, 7500].map(v => `<line x1="${pl}" x2="${w - 8}" y1="${y(v)}" y2="${y(v)}" class="vl-g"/><text x="${pl - 4}" y="${y(v) + 3}" class="vl-ax" text-anchor="end">${v / 1000}k</text>`).join('');
    return `<svg class="vl-dots" viewBox="0 0 ${w} ${h}" role="img" aria-label="Players by value">${gr}<line x1="${pl}" x2="${pl}" y1="${pt}" y2="${h - pb}" class="vl-axl"/><line x1="${pl}" x2="${w - 8}" y1="${h - pb}" y2="${h - pb}" class="vl-axl"/>${ax}
      ${list.map((r, i) => `<circle cx="${x(i)}" cy="${y(val(r))}" r="4.2" fill="${COL[r.pos] || COL.DEF}"><title>${esc(r.n)} (${r.pos === 'PICK' ? 'pick' : r.pos}): ${val(r).toLocaleString()}</title></circle>`).join('')}</svg>`;
  }
  function radar(f) {
    const T = V.teams, s = 150, c = s / 2, R = 58, A = POS.map((p, i) => -Math.PI / 2 + i * 2 * Math.PI / POS.length);
    const mx = p => Math.max(...Object.values(T).map(t => t.pos[p][mode])) || 1;
    const v = POS.map(p => Math.max(0.04, T[f].pos[p][mode] / mx(p)));
    const pt = (r, a) => `${(c + r * Math.cos(a)).toFixed(1)},${(c + r * Math.sin(a)).toFixed(1)}`;
    const rings = [0.25, 0.5, 0.75, 1].map(k => `<polygon points="${A.map(a => pt(R * k, a)).join(' ')}" class="vl-ring"/>`).join('');
    const lab = POS.map((p, i) => { const [lx, ly] = pt(R + 14, A[i]).split(',');
      return `<text x="${lx}" y="${+ly + 3}" text-anchor="middle" class="vl-rl">${PL[p]}</text>`; }).join('');
    return `<svg class="vl-radar" viewBox="-18 0 ${s + 36} ${s}" role="img" aria-label="Positional strength">${rings}<polygon points="${v.map((k, i) => pt(R * k, A[i])).join(' ')}" class="vl-shape"/>${lab}</svg>`;
  }
  function teamList(f) { return items().filter(r => r.f === f).sort((a, b) => val(b) - val(a)); }
  function card(f, rank) {
    const t = V.teams[f], T = tm(f), list = teamList(f);
    const total = list.reduce((s, r) => s + val(r), 0);
    return `<section class="card vl-card">
      <div class="vl-ch"><span class="vl-rk">${rank}</span><a href="#now/team/${f}">${T.logo ? `<img src="${T.logo}" alt="">` : ''}<b>${esc(X.nameOf ? X.nameOf(f) : T.abbr)}</b></a><span class="vl-tot" title="Total ${MODE[mode][0]}">${Math.round(total / 1000)}k</span></div>
      <div class="vl-pr">${POS.filter(p => picksOn || p !== 'PICK').map(p => `<span style="--pc:${COL[p]}">${PL[p]}: <b>${ord(t.pos[p][mode + 'R'])}</b></span>`).join('')}</div>
      <div class="vl-meta"><span>Avg. age <b>${t.age || '—'}</b></span><span class="${t.own1 ? 'ok' : 'no'}">${t.own1 ? '✓ Has own 2027 1st' : '✕ Traded own 2027 1st'}</span></div>
      ${shape === 'radar' ? radar(f) : dots(list)}</section>`;
  }
  function compare() {
    const ids = Object.keys(V.teams), my = X.myTeam && V.teams[X.myTeam] ? X.myTeam : ids[0];
    if (!cmpA || !V.teams[cmpA]) cmpA = my;
    if (!cmpB || !V.teams[cmpB] || cmpB === cmpA) cmpB = ids.filter(f => f !== cmpA).sort((a, b) => V.teams[a][mode + 'R'] - V.teams[b][mode + 'R'])[0];
    const A = teamList(cmpA), B = teamList(cmpB), n = Math.max(A.length, B.length), ca = '#3b82c4', cb = '#c0504d';
    const w = 640, h = 230, pl = 10, pb = 70, y = v => 10 + (h - pb - 10) * (1 - v / 10000), x = i => pl + (w - 2 * pl) * (i + 0.5) / n;
    const line = (L, c) => `<polyline points="${L.map((r, i) => `${x(i)},${y(val(r))}`).join(' ')}" fill="none" stroke="${c}" stroke-opacity=".45" stroke-width="2"/>` + L.map((r, i) => `<circle cx="${x(i)}" cy="${y(val(r))}" r="3.6" fill="${c}"><title>${esc(r.n)}: ${val(r).toLocaleString()}</title></circle>`).join('');
    const gaps = Array.from({ length: n }, (_, i) => { const a = A[i] ? val(A[i]) : 0, b = B[i] ? val(B[i]) : 0, d = a - b, hh = Math.min(44, Math.abs(d) / 60);
      return `<rect x="${x(i) - 4}" y="${h - 22 - hh}" width="8" height="${Math.max(1, hh)}" fill="${d >= 0 ? ca : cb}" opacity=".85"><title>#${i + 1}: ${d >= 0 ? '+' : '−'}${Math.abs(d).toLocaleString()} ${esc(tm(d >= 0 ? cmpA : cmpB).abbr || '')}</title></rect><text x="${x(i)}" y="${h - pb + 14}" class="vl-ax" text-anchor="middle">${i + 1}</text>`; }).join('');
    const sel = (k, cur) => `<select class="vl-sel" data-vl-cmp="${k}">${ids.map(f => `<option value="${f}"${f === cur ? ' selected' : ''}>${esc(X.nameOf ? X.nameOf(f) : f)}</option>`).join('')}</select>`;
    const lst = (L, c) => `<ol class="vl-ls" style="--pc:${c}">${(cmpAll ? L : L.slice(0, 10)).map((r, i) => { const h = link(r);
      return `<li><span class="vl-n">${i + 1}</span>${h ? `<a href="${h}">${esc(r.n)}</a>` : `<span>${esc(r.n)}</span>`}<span class="vl-pos" style="--pc:${COL[r.pos]}">${r.pos === 'PICK' ? 'PICK' : r.pos}</span><b>${val(r).toLocaleString()}</b></li>`; }).join('')}</ol>`;
    return `<section class="card vl-cmp"><h2>Compare</h2><div class="vl-cs"><span style="--pc:${ca}">${sel('a', cmpA)}</span><span class="vl-vs">vs</span><span style="--pc:${cb}">${sel('b', cmpB)}</span></div>
      <svg class="vl-cmpg" viewBox="0 0 ${w} ${h}" role="img" aria-label="Both rosters by value, best first">${line(B, cb)}${line(A, ca)}<line x1="${pl}" x2="${w - pl}" y1="${h - pb}" y2="${h - pb}" class="vl-axl"/>${gaps}</svg>
      <p class="tf-sub">Each team’s players and picks, best first. The bars underneath show who has the edge at each spot on the list, and by how much.</p>
      <div class="vl-two">${lst(A, ca)}${lst(B, cb)}</div>
      ${Math.max(A.length, B.length) > 10 ? `<button type="button" class="ro-howb" data-vl-all>${cmpAll ? 'Show the top 10' : 'Show everyone'}</button>` : ''}</section>`;
  }
  function league(ctx) {
    X = ctx; load();
    if (failed) return '<p class="error">Values didn’t load.</p>';
    if (!V) return '<p class="loading">Loading values…</p>';
    const tot = f => teamList(f).reduce((s, r) => s + val(r), 0);
    const order = Object.keys(V.teams).sort((a, b) => tot(b) - tot(a));
    return `${toggles(true)}<div class="seg vl-shape-seg" role="tablist" aria-label="Chart">${[['dots', 'Players by value'], ['radar', 'Positional strength']].map(([k, l]) => `<button type="button" role="tab" data-vl-shape="${k}" aria-selected="${shape === k}">${l}</button>`).join('')}</div>
      ${compare()}
      <div class="vl-grid">${order.map((f, i) => card(f, i + 1)).join('')}</div>
      <p class="rf-foot">Teams are ordered by their total ${MODE[mode][0]}. Position ranks use the top 2 QBs, 4 RBs, 5 WRs, 2 TEs and every pick. Average age is the active roster’s, defenses left out. Dot colors: <span style="color:${COL.QB}">●</span> QB <span style="color:${COL.RB}">●</span> RB <span style="color:${COL.WR}">●</span> WR <span style="color:${COL.TE}">●</span> TE <span style="color:${COL.PICK}">●</span> pick.</p>${foot()}`;
  }

  document.addEventListener('click', e => {
    const t = e.target.closest ? e.target : null; if (!t || !document.querySelector('.vl-ctl')) return;
    const m = t.closest('[data-vl-mode]'); if (m) { mode = m.dataset.vlMode; try { localStorage.setItem('fbp-val-mode', mode); } catch (err) {} return redraw(); }
    const s = t.closest('[data-vl-shape]'); if (s) { shape = s.dataset.vlShape; try { localStorage.setItem('fbp-val-shape', shape); } catch (err) {} return redraw(); }
    if (t.closest('[data-vl-more]')) { chartLow = 0; return redraw(); }
    if (t.closest('[data-vl-all]')) { cmpAll = !cmpAll; return redraw(); }
  });
  document.addEventListener('change', e => {
    const t = e.target; if (!t.matches) return;
    if (t.matches('[data-vl-picks]')) { picksOn = t.checked; redraw(); }
    if (t.matches('[data-vl-cmp]')) { if (t.dataset.vlCmp === 'a') cmpA = t.value; else cmpB = t.value; redraw(); }
  });
  return { chart, league };
})();
