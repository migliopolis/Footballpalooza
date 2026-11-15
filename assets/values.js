/* Player Value and Trade Value (data/values.json, scripts/trade_values.py).
   Player Value: ability, potential and production, from FantasyPros' dynasty consensus rank. Trade Value: the same
   player with his FBP contract counted: salary and years left. Both run 1-9999.
   FBPValues.chart(ctx)  Trading Floor > Value Chart: one column of value levels, and a column per position, each
                         player placed at his level so players of about the same value sit side by side.
   FBPValues.league(ctx) League Now > Rosters > Value: every team's players by value (dots or a positional radar),
                         position ranks, average age, own 1st, and a two-team comparison. */
window.FBPValues = (function () {
  let V = null, failed = false, loading = false, X = null;
  let muSt = false, mode = 'tv', picksOn = true, shape = 'dots', cmpA = '', cmpB = '', cmpAll = false, chartLow = 2000;
  try { muSt = localStorage.getItem('fbp-mu-st') === '1'; mode = localStorage.getItem('fbp-val-mode') || 'tv'; if (mode !== 'tv') mode = 'o'; shape = localStorage.getItem('fbp-val-shape') || 'dots'; } catch (e) {}
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
  const val = x => x[mode] || (mode === 'o' ? 50 : 0);
  const MODE = { tv: ['Trade Value', 'contract counted: salary and years left'], o: ['OVR', 'how good he is: Madden ratings weighted for fantasy, dynasty value and production'] };
  // each value's range on a chart: Trade Value 0-9,999; OVR mostly 50-99
  const LO = () => mode === 'o' ? 50 : 0, HI = () => mode === 'o' ? 100 : 10000, frac = v => Math.max(0, (v - LO()) / (HI() - LO()));
  const fmt = v => mode === 'o' ? String(Math.round(v)) : v.toLocaleString();
  const teamTot = L => mode === 'o' ? (L.length ? (L.reduce((s, r) => s + val(r), 0) / L.length).toFixed(1) : '—') : Math.round(L.reduce((s, r) => s + val(r), 0) / 1000) + 'k';
  const toggles = (withPicks) => `<div class="vl-ctl"><div class="seg vl-mode" role="tablist" aria-label="Value">${Object.entries(MODE).map(([k, [l, why]]) =>
    `<button type="button" role="tab" data-vl-mode="${k}" aria-selected="${mode === k}" title="${why}">${l}</button>`).join('')}</div>
    ${withPicks ? `<label class="tf-chk"><input type="checkbox" data-vl-picks${picksOn ? ' checked' : ''}> Include picks</label>` : ''}</div>`;
  const items = () => Object.entries(V.players).map(([id, r]) => Object.assign({ id }, r)).filter(r => r.pos !== 'DEF')
    .concat(picksOn ? V.picks.map(p => Object.assign({ pos: 'PICK' }, p)) : []);
  const link = r => r.pos === 'PICK' ? null : `#now/team/${r.f}/${r.id}`;
  const foot = () => `<p class="rf-foot">OVR is how good he is, 40–99: Madden’s ratings weighted for fantasy (hands, routes, speed, arm and accuracy count; blocking doesn’t), blended with FantasyPros’ dynasty consensus (data © FantasyPros, as of ${esc(V.ecrUpdated || '')}) and nudged by his FBP production. Only the very best reach 99. A pick’s OVR is the rookie its slot usually lands. Trade Value starts from talent, weighted so stars count for more than a pile of lesser players, then adjusts for the FBP contract: how many seasons you control him (the rest of this one plus each year left on his deal) and what he’d fetch at auction against what he’s paid. A cheap or long deal lifts a player, a big or expiring one lowers him, by at most about a third either way. Picks are the rookie a slot usually lands, on a rookie deal at the by-law salary, 20% off for misses; 2027 picks use today’s draft order.</p>`;

  /* ---------- Trading Floor > Value Chart ---------- */
  function chart(ctx) {
    X = ctx; load();
    if (failed) return '<p class="error">Values didn’t load.</p>';
    if (!V) return '<p class="loading">Loading values…</p>';
    const L = items(), step = mode === 'o' ? 1 : 250, top = Math.ceil(Math.max(...L.map(val)) / step) * step, low = mode === 'o' ? (chartLow ? 80 : 60) : chartLow;
    const rows = [];
    for (let hi = top; hi > low; hi -= step) {
      const cells = POS.map(p => L.filter(r => r.pos === p && val(r) <= hi && val(r) > hi - step).sort((a, b) => val(b) - val(a)));
      if (cells.some(c => c.length)) rows.push([hi, cells]);
    }
    const chip = r => { const h = link(r), t = tm(r.f);
      const inner = `<b>${esc(r.n)}</b><small>${t.logo ? `<img src="${t.logo}" alt="">` : ''}${esc(t.abbr || '')} · ${fmt(val(r))}${mode === 'tv' && r.sal != null ? ' · $' + Math.round(r.sal) : ''}</small>`;
      return h ? `<a class="vl-chip" href="${h}" style="--pc:${COL[r.pos]}">${inner}</a>` : `<span class="vl-chip" style="--pc:${COL[r.pos]}">${inner}</span>`; };
    return `<div class="vl-chart">${toggles(true)}
      <p class="tf-sub">${MODE[mode][0]}: ${MODE[mode][1]}. ${mode === 'o' ? 'Each row is one OVR point.' : 'Each row is a 250-point band; players in the same row are worth about the same.'} Tap a player for his page.</p>
      <div class="tbl-wrap"><table class="vl-ct"><thead><tr><th class="vl-v">${mode === 'o' ? 'OVR' : 'Value'}</th>${POS.map(p => `<th style="--pc:${COL[p]}">${PL[p]}</th>`).join('')}</tr></thead>
      <tbody>${rows.map(([hi, cells]) => `<tr><td class="vl-v">${fmt(hi)}</td>${cells.map(c => `<td>${c.map(chip).join('')}</td>`).join('')}</tr>`).join('')}</tbody></table></div>
      ${chartLow > 0 ? `<button type="button" class="ro-howb" data-vl-more>Show ${mode === 'o' ? 'OVRs' : 'values'} under ${fmt(low)}</button>` : ''}
      ${foot()}</div>`;
  }

  /* ---------- Rosters > Value ---------- */
  function dots(list) {
    const w = 420, h = 170, pl = 30, pb = 18, pt = 8, n = Math.max(30, list.length), x = i => pl + (w - pl - 8) * (i + 0.5) / n, y = v => pt + (h - pt - pb) * (1 - frac(v));
    const ax = [5, 10, 15, 20, 25, 30, 35].filter(k => k <= n).map(k => `<text x="${x(k - 1)}" y="${h - 4}" class="vl-ax" text-anchor="middle">${k}</text>`).join('');
    const gr = (mode === 'o' ? [60, 70, 80, 90] : [2500, 5000, 7500]).map(v => `<line x1="${pl}" x2="${w - 8}" y1="${y(v)}" y2="${y(v)}" class="vl-g"/><text x="${pl - 4}" y="${y(v) + 3}" class="vl-ax" text-anchor="end">${mode === 'o' ? v : v / 1000 + 'k'}</text>`).join('');
    return `<svg class="vl-dots" viewBox="0 0 ${w} ${h}" role="img" aria-label="Players by value">${gr}<line x1="${pl}" x2="${pl}" y1="${pt}" y2="${h - pb}" class="vl-axl"/><line x1="${pl}" x2="${w - 8}" y1="${h - pb}" y2="${h - pb}" class="vl-axl"/>${ax}
      ${list.map((r, i) => `<circle cx="${x(i)}" cy="${y(val(r))}" r="4.2" fill="${COL[r.pos] || COL.DEF}"><title>${esc(r.n)} (${r.pos === 'PICK' ? 'pick' : r.pos}): ${fmt(val(r))}</title></circle>`).join('')}</svg>`;
  }
  function radar(f) {
    const T = V.teams, s = 150, c = s / 2, R = 58, A = POS.map((p, i) => -Math.PI / 2 + i * 2 * Math.PI / POS.length);
    const mx = p => Math.max(...Object.values(T).map(t => t.pos[p][mode])) || 1;
    const v = POS.map(p => Math.max(0.04, mode === 'o' ? (T[f].pos[p].o - 50) / Math.max(1, mx(p) - 50) : T[f].pos[p][mode] / mx(p)));
    const pt = (r, a) => `${(c + r * Math.cos(a)).toFixed(1)},${(c + r * Math.sin(a)).toFixed(1)}`;
    const rings = [0.25, 0.5, 0.75, 1].map(k => `<polygon points="${A.map(a => pt(R * k, a)).join(' ')}" class="vl-ring"/>`).join('');
    const lab = POS.map((p, i) => { const [lx, ly] = pt(R + 14, A[i]).split(',');
      return `<text x="${lx}" y="${+ly + 3}" text-anchor="middle" class="vl-rl">${PL[p]}</text>`; }).join('');
    return `<svg class="vl-radar" viewBox="-18 0 ${s + 36} ${s}" role="img" aria-label="Positional strength">${rings}<polygon points="${v.map((k, i) => pt(R * k, A[i])).join(' ')}" class="vl-shape"/>${lab}</svg>`;
  }
  function teamList(f) { return items().filter(r => r.f === f).sort((a, b) => val(b) - val(a)); }
  function card(f, rank) {
    const t = V.teams[f], T = tm(f), list = teamList(f);
    return `<section class="card vl-card">
      <div class="vl-ch"><span class="vl-rk">${rank}</span><a href="#now/team/${f}">${T.logo ? `<img src="${T.logo}" alt="">` : ''}<b>${esc(X.nameOf ? X.nameOf(f) : T.abbr)}</b></a><span class="vl-tot" title="${mode === 'o' ? 'Team OVR: its top 2 QBs, 4 RBs, 5 WRs and 2 TEs' : 'Total Trade Value'}">${mode === 'o' ? t.o : teamTot(list)}</span></div>
      <div class="vl-pr">${POS.filter(p => picksOn || p !== 'PICK').map(p => `<span style="--pc:${COL[p]}">${PL[p]}: <b>${ord(t.pos[p][mode + 'R'])}</b></span>`).join('')}</div>
      <div class="vl-meta"><span>Avg. age <b>${t.age || '—'}</b></span><span class="${t.own1 ? 'ok' : 'no'}">${t.own1 ? '✓ Has own 2027 1st' : '✕ Traded own 2027 1st'}</span></div>
      ${shape === 'radar' ? radar(f) : dots(list)}</section>`;
  }
  // a team's line color: its primary, or its secondary when the primary would vanish (near white, or near black in dark
  // mode) or match the other team's
  const hex = c => { const m = /^#?([0-9a-f]{6})$/i.exec(c || ''); if (!m) return null; const n = parseInt(m[1], 16); return [n >> 16, (n >> 8) & 255, n & 255]; };
  const lum = c => { const v = hex(c); return v ? (0.299 * v[0] + 0.587 * v[1] + 0.114 * v[2]) / 255 : 0.5; };
  const dist = (p, q) => { const a = hex(p), b = hex(q); return a && b ? Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) : 999; };
  const darkMode = () => { try { return lum((getComputedStyle(document.body).backgroundColor.match(/\d+/g) || []).slice(0, 3).map(n => (+n).toString(16).padStart(2, '0')).join('')) < 0.4; } catch (e) { return false; } };
  function colors(fa, fb) {
    const dk = darkMode(), ok = c => c && lum(c) < 0.86 && (!dk || lum(c) > 0.16);
    const opts = f => [tm(f).primary, tm(f).secondary].filter(ok).concat([f === fa ? '#3b82c4' : '#c0504d']);
    const A = opts(fa), B = opts(fb), ca = A[0], cb = B.find(c => dist(c, ca) > 70) || (ca === '#c0504d' ? '#3b82c4' : '#c0504d');
    return [ca, cb];
  }
  // both rosters by value, best first, with gap bars underneath; lists: 'twirl' folds the players away (Matchups)
  function cmpBody(fa, fb, lists, only) {
    const pick = f => only ? teamList(f).filter(r => only[f].has(r.id)) : teamList(f);
    const A = pick(fa), B = pick(fb), n = Math.max(A.length, B.length, 1), [ca, cb] = colors(fa, fb);
    const w = 640, h = 230, pl = 10, pb = 70, y = v => 10 + (h - pb - 10) * (1 - frac(v)), x = i => pl + (w - 2 * pl) * (i + 0.5) / n;
    const line = (L, c) => `<polyline points="${L.map((r, i) => `${x(i)},${y(val(r))}`).join(' ')}" fill="none" stroke="${c}" stroke-opacity=".5" stroke-width="2"/>` + L.map((r, i) => `<circle cx="${x(i)}" cy="${y(val(r))}" r="3.6" fill="${c}"><title>${esc(r.n)}: ${fmt(val(r))}</title></circle>`).join('');
    const gaps = Array.from({ length: n }, (_, i) => { const a = A[i] ? val(A[i]) : LO(), b = B[i] ? val(B[i]) : LO(), d = a - b, hh = Math.min(44, Math.abs(d) / (mode === 'o' ? 0.5 : 60));
      return `<rect x="${x(i) - 4}" y="${h - 22 - hh}" width="8" height="${Math.max(1, hh)}" fill="${d >= 0 ? ca : cb}" opacity=".85"><title>#${i + 1}: ${d >= 0 ? '+' : '−'}${fmt(Math.abs(d))} ${esc(tm(d >= 0 ? fa : fb).abbr || '')}</title></rect><text x="${x(i)}" y="${h - pb + 14}" class="vl-ax" text-anchor="middle">${i + 1}</text>`; }).join('');
    const all = lists === 'twirl' || cmpAll;
    const lst = (L, c, f) => `<ol class="vl-ls" style="--pc:${c}">${lists === 'twirl' ? `<li class="vl-lh">${tm(f).logo ? `<img src="${tm(f).logo}" alt="">` : ''}<b>${esc(tm(f).abbr || f)}</b><span>${teamTot(L)}</span></li>` : ''}${(all ? L : L.slice(0, 10)).map((r, i) => { const hr = link(r);
      return `<li><span class="vl-n">${i + 1}</span>${hr ? `<a href="${hr}">${esc(r.n)}</a>` : `<span>${esc(r.n)}</span>`}<span class="vl-pos" style="--pc:${COL[r.pos]}">${r.pos === 'PICK' ? 'PICK' : r.pos}</span><b>${fmt(val(r))}</b></li>`; }).join('')}</ol>`;
    const two = `<div class="vl-two">${lst(A, ca, fa)}${lst(B, cb, fb)}</div>`;
    const svg = `<svg class="vl-cmpg" viewBox="0 0 ${w} ${h}" role="img" aria-label="Both rosters by value, best first">${line(B, cb)}${line(A, ca)}<line x1="${pl}" x2="${w - pl}" y1="${h - pb}" y2="${h - pb}" class="vl-axl"/>${gaps}</svg>`;
    return { ca, cb, svg, two, A, B };
  }
  function compare() {
    const ids = Object.keys(V.teams), my = X.myTeam && V.teams[X.myTeam] ? X.myTeam : ids[0];
    if (!cmpA || !V.teams[cmpA]) cmpA = my;
    if (!cmpB || !V.teams[cmpB] || cmpB === cmpA) cmpB = ids.filter(f => f !== cmpA).sort((a, b) => V.teams[a][mode + 'R'] - V.teams[b][mode + 'R'])[0];
    const C = cmpBody(cmpA, cmpB);
    const sel = (k, cur) => `<select class="vl-sel" data-vl-cmp="${k}">${ids.map(f => `<option value="${f}"${f === cur ? ' selected' : ''}>${esc(X.nameOf ? X.nameOf(f) : f)}</option>`).join('')}</select>`;
    return `<section class="card vl-cmp"><h2>Compare</h2><div class="vl-cs"><span style="--pc:${C.ca}">${sel('a', cmpA)}</span><span class="vl-vs">vs</span><span style="--pc:${C.cb}">${sel('b', cmpB)}</span></div>
      ${C.svg}
      <p class="tf-sub">Each team’s players and picks, best first. The bars underneath show who has the edge at each spot on the list, and by how much.</p>
      ${C.two}
      ${Math.max(C.A.length, C.B.length) > 10 ? `<button type="button" class="ro-howb" data-vl-all>${cmpAll ? 'Show the top 10' : 'Show everyone'}</button>` : ''}</section>`;
  }
  // League Now > Matchups: the two rosters' value chart for one game, players folded underneath
  function matchup(ctx, fa, fb, la, lb) {
    X = ctx; load();
    if (failed || !V) return failed ? '' : '<p class="tf-sub">Loading roster values…</p>';
    if (!V.teams[fa] || !V.teams[fb]) return '';
    const keep = mode; mode = 'o';   // OVR here, whatever the Value page is set to: talent, not contracts
    const set = la && la.length && lb && lb.length, st = muSt && set;
    const C = cmpBody(fa, fb, 'twirl', st ? { [fa]: new Set(la), [fb]: new Set(lb) } : null);
    const seg = `<div class="seg mu-vseg" role="tablist" aria-label="Which players">${[[0, 'Everyone'], [1, 'Projected starters']].map(([k, l]) => `<button type="button" role="tab" data-vl-st="${k}" aria-selected="${!!k === muSt}">${l}</button>`).join('')}</div>`;
    const key = f => `<span class="vl-key" style="--pc:${f === fa ? C.ca : C.cb}"><i></i>${esc(tm(f).abbr || f)} <b title="Average OVR">${teamTot(f === fa ? C.A : C.B)}</b></span>`;
    const html = `<div class="mu-val"><div class="mu-vh"><h4>Roster strength <small>${MODE[mode][0]}, ${st ? 'projected starters' : 'players and picks'}, best first</small></h4>${seg}</div>
      <p class="vl-keys">${key(fa)}${key(fb)}</p>${muSt && !set ? '<p class="tf-sub">No projections for this week yet, so this shows everyone.</p>' : ''}${C.svg}
      ${st ? '<p class="tf-sub">Our best guess at each lineup, not the one set in MFL: healthy players ranked by this week’s projection and recent starts, with anyone ruled out replaced by the next best. Defenses aren’t valued.</p>' : ''}
      <details class="all mu-vd"><summary>${st ? 'Projected starters' : 'Players'} on each side</summary>${C.two}</details></div>`;
    mode = keep;
    return html;
  }
  function league(ctx) {
    X = ctx; load();
    if (failed) return '<p class="error">Values didn’t load.</p>';
    if (!V) return '<p class="loading">Loading values…</p>';
    const tot = f => mode === 'o' ? V.teams[f].o : teamList(f).reduce((s, r) => s + val(r), 0);
    const order = Object.keys(V.teams).sort((a, b) => tot(b) - tot(a));
    return `${toggles(true)}
      ${compare()}
      <h2 class="sec vl-tbt">Team by team</h2>
      <div class="vl-shape-row"><div class="seg vl-shape-seg" role="tablist" aria-label="Chart on each team">${[['dots', 'Every player'], ['radar', 'By position']].map(([k, l]) => `<button type="button" role="tab" data-vl-shape="${k}" aria-selected="${shape === k}">${l}</button>`).join('')}</div>
        <p class="tf-sub">${shape === 'radar' ? 'Each team’s strength at QB, RB, WR, TE and picks against the rest of the league: the farther out, the stronger.' : 'Each team’s players as dots, best first, colored by position.'}</p></div>
      <div class="vl-grid">${order.map((f, i) => card(f, i + 1)).join('')}</div>
      <p class="rf-foot">Teams are ordered by ${mode === 'o' ? 'team OVR, the average of their top 2 QBs, 4 RBs, 5 WRs and 2 TEs' : 'their total Trade Value'}. Position ranks use the top 2 QBs, 4 RBs, 5 WRs, 2 TEs and every pick. Average age is the active roster’s, defenses left out. Dot colors: <span style="color:${COL.QB}">●</span> QB <span style="color:${COL.RB}">●</span> RB <span style="color:${COL.WR}">●</span> WR <span style="color:${COL.TE}">●</span> TE <span style="color:${COL.PICK}">●</span> pick.</p>${foot()}`;
  }

  document.addEventListener('click', e => {
    const t = e.target.closest ? e.target : null; if (!t || !document.querySelector('.vl-ctl, .mu-val')) return;
    const sb = t.closest('[data-vl-st]'); if (sb) { muSt = sb.dataset.vlSt === '1'; try { localStorage.setItem('fbp-mu-st', muSt ? '1' : '0'); } catch (err) {}
      // every game's chart changes height, so keep the pressed button where it was on screen, and keep open lists open
      const all = () => [...document.querySelectorAll('.mu-val')], i = all().indexOf(sb.closest('.mu-val')), top = sb.getBoundingClientRect().top;
      const open = all().map(v => !!(v.querySelector('details') || {}).open);
      if (X && X.rerender) X.rerender();
      all().forEach((v, k) => { const d = v.querySelector('details'); if (d && open[k]) d.open = true; });
      const nb = all()[i] && all()[i].querySelector('[data-vl-st]'); if (nb) window.scrollBy(0, nb.getBoundingClientRect().top - top);
      return; }
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
  return { chart, league, matchup };
})();
