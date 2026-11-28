/* Beta > Power Rankings: two rankings side by side, from data/power.json (scripts/power.py). No blend, so a contender
   isn't marked down for spending its future and a rebuilder isn't marked down for losing now.
   Now: points a week, all-play record and the best legal lineup for the rest of the season.
   Future: next season's projected keepers (auction value of who's kept, so a costly contract that won't be kept adds
   nothing), auction cash left after keepers, and rookie picks. Keepers come from the FBP keeper model (data/keeper-model.json,
   backtested on real keeper decisions); anyone can flip one on their own device (saved in this browser). */
window.FBPPower = (function () {
  let P = null, loading = false, failed = false, X = null;
  const open = new Set();
  let flips = {}; try { flips = JSON.parse(localStorage.getItem('fbp-power-keep') || '{}') || {}; } catch (e) { flips = {}; }
  const save = () => { try { localStorage.setItem('fbp-power-keep', JSON.stringify(flips)); } catch (e) {} };
  function load() {
    if (P || loading) return;
    loading = true;
    FBPU.json('data/power.json').then(j => j == null ? Promise.reject() : j)
      .then(j => { P = j; loading = false; redraw(); }).catch(() => { failed = true; loading = false; redraw(); });
  }
  const redraw = () => { const y = window.scrollY; if (X && X.rerender) { X.rerender(); window.scrollTo(0, y); } };
  const kept = p => p.next != null && (p.id in flips ? flips[p.id] : p.keep);
  const $ = v => '$' + Math.round(v);
  const PROFILE = (n, fu) => n >= 50 ? (fu >= 50 ? ['both', 'Built for both'] : ['now', 'Win now']) : (fu >= 50 ? ['future', 'Building'] : ['mid', 'Retooling']);
  let sortBy = 'now';

  function score() {
    const ids = Object.keys(P.teams), T = {};
    ids.forEach(f => { const t = P.teams[f], K = t.players.filter(kept);
      const act = K.filter(p => p.st !== 'TAXI_SQUAD').length, sal = K.reduce((s, p) => s + p.next, 0);
      T[f] = { keepVal: K.reduce((s, p) => s + p.val, 0), keepSal: sal, keepN: K.length, open: Math.max(0, P.roster - act),
        cash: t.budget - sal - Math.max(0, P.roster - act), picks: t.picks.reduce((s, p) => s + p.v, 0) }; });
    const z = get => { const v = ids.map(get), m = v.reduce((a, b) => a + b, 0) / v.length,
      sd = Math.sqrt(v.reduce((a, b) => a + (b - m) ** 2, 0) / v.length) || 1; return f => (get(f) - m) / sd; };
    const zp = z(f => P.teams[f].pf), za = z(f => P.teams[f].ap), zr = z(f => P.teams[f].ros);
    const nowRaw = f => .25 * zp(f) + .25 * za(f) + .5 * zr(f);
    const zk = z(f => T[f].keepVal + T[f].cash), zpk = z(f => T[f].picks);   // keepers' value plus cash left = next year's buying power
    const zn = z(nowRaw), zf = z(f => .75 * zk(f) + .25 * zpk(f));
    const sc = v => Math.max(0, Math.min(100, 50 + 20 * v));
    ids.forEach(f => { const s = T[f]; s.now = sc(zn(f)); s.fut = sc(zf(f)); s.prof = PROFILE(s.now, s.fut); });
    const rk = k => ids.slice().sort((a, b) => T[b][k] - T[a][k]).forEach((f, i) => { T[f]['r' + k] = i + 1; });
    rk('now'); rk('fut');
    const order = ids.slice().sort((a, b) => T[b][sortBy] - T[a][sortBy]);
    return { T, order };
  }

  function detail(f, s, esc) {
    const t = P.teams[f], nx = P.next;
    const lineup = new Set(t.lineup);
    const flipped = t.players.some(p => p.id in flips);
    const rows = t.players.filter(p => p.next != null).map(p => { const k = kept(p), sur = p.val - p.next, sug = p.keep;
      return `<tr class="${k ? 'on' : ''}"><td class="l"><label class="pw-k"><input type="checkbox" data-pw-keep="${p.id}"${k ? ' checked' : ''}><span><b>${esc(p.name)}</b><small>${p.pos}${p.age ? ' · ' + p.age : ''}${p.st === 'TAXI_SQUAD' ? ' · taxi' : p.st === 'INJURED_RESERVE' ? ' · IR' : ''}${p.why ? ` · ${esc(p.why)}` : ''}${p.kp != null ? ` · ${Math.round(p.kp * 100)}% likely kept` : ''}${p.id in flips ? ` · <i>projected: ${sug ? 'keep' : 'let go'}</i>` : ''}</small></span></label></td>
        <td>${$(p.next)}</td><td>${$(p.val)}</td><td class="${sur >= 0 ? 'up' : 'dn'}">${sur >= 0 ? '+' : '−'}$${Math.round(Math.abs(sur))}</td><td>${p.yrs}</td></tr>`; }).join('');
    const gone = t.players.filter(p => p.next == null);
    const pk = t.picks.map(p => { const from = p.from !== f ? (X.teams[p.from] || {}).abbr || p.from : '';
      return `<li><b>${p.y} ${p.r}.${p.s ? String(p.s).padStart(2, '0') : '??'}</b>${from ? `<small>from ${esc(from)}</small>` : ''}<span>${p.v.toFixed(0)} pts/yr</span></li>`; }).join('');
    return `<div class="pw-det">
      <div class="pw-cols">
        <div><h4>Now <small>${s.now.toFixed(0)}</small></h4>
          <p>${t.pf.toFixed(1)} points a week · all-play ${(t.ap * 100).toFixed(0)}% · best lineup for the rest of the season projects ${t.ros.toFixed(1)} a week.</p></div>
        <div><h4>Rookie picks</h4>${pk ? `<ul class="pw-pk">${pk}</ul>` : '<p>No picks in the next two drafts.</p>'}
          <p class="pw-fn">Pts/yr: what that draft slot has scored a season, on average, in a pick’s first three years. 2028 slots aren’t set yet, so they count as mid-round.</p></div>
      </div>
      <h4>Projected keepers for ${nx} <small>Future ${s.fut.toFixed(0)} · tap to flip, only on this device</small>${flipped ? ` <button type="button" class="pw-reset" data-pw-reset="${f}">Back to projections</button>` : ''}</h4>
      <div class="pw-sum"><span><b>${$(s.keepVal)}</b>keepers’ auction value</span><span><b>${$(s.keepSal)}</b>kept salary · ${s.keepN} kept</span><span><b>${$(s.cash)}</b>to spend (${$(t.budget)} budget, $1 × ${s.open} open spots)</span></div>
      <div class="tbl-wrap"><table class="pw-kt"><thead><tr><th class="l">Under contract for ${nx}</th><th>${nx} salary</th><th>Value</th><th>Surplus</th><th>Yrs left</th></tr></thead><tbody>${rows}</tbody></table></div>
      ${gone.length ? `<p class="pw-fn">Contracts up after ${P.season} (back to the auction): ${gone.map(p => esc(p.name)).join(', ')}.</p>` : ''}
    </div>`;
  }

  function chart(T, ctx) {
    // Future across, Now up; 50 is league average on both
    const W = 320, Hh = 260, P0 = 26, x = v => P0 + (W - 2 * P0) * v / 100, y = v => Hh - P0 - (Hh - 2 * P0) * v / 100;
    const dots = Object.keys(T).map(f => { const t = ctx.teams[f] || {}, s = T[f];
      return `<g class="pw-dot${f === ctx.myTeam ? ' me' : ''}"><title>${ctx.esc(t.name || f)}: Now ${s.now.toFixed(0)}, Future ${s.fut.toFixed(0)}</title>${t.logo
        ? `<image href="${t.logo}" x="${x(s.fut) - 11}" y="${y(s.now) - 11}" width="22" height="22"/>` : `<circle cx="${x(s.fut)}" cy="${y(s.now)}" r="6"/>`}</g>`; }).join('');
    const q = (tx, ty, l, a) => `<text x="${tx}" y="${ty}" text-anchor="${a}" class="pw-q">${l}</text>`;
    return `<svg class="pw-chart" viewBox="0 0 ${W} ${Hh}" role="img" aria-label="Teams by Now and Future">
      <rect x="${x(0)}" y="${y(100)}" width="${x(100) - x(0)}" height="${y(0) - y(100)}" class="pw-bg"/>
      <line x1="${x(50)}" y1="${y(0)}" x2="${x(50)}" y2="${y(100)}" class="pw-mid"/><line x1="${x(0)}" y1="${y(50)}" x2="${x(100)}" y2="${y(50)}" class="pw-mid"/>
      ${q(x(2), y(96), 'Win now', 'start')}${q(x(98), y(96), 'Built for both', 'end')}${q(x(2), y(3), 'Retooling', 'start')}${q(x(98), y(3), 'Building', 'end')}
      <text x="${W / 2}" y="${Hh - 6}" text-anchor="middle" class="pw-ax">Future →</text><text x="10" y="${Hh / 2}" text-anchor="middle" class="pw-ax" transform="rotate(-90 10 ${Hh / 2})">Now →</text>
      ${dots}</svg>`;
  }

  function render(ctx) {
    X = ctx; load();
    try { flips = JSON.parse(localStorage.getItem('fbp-power-keep') || '{}') || {}; } catch (e) { flips = {}; }   // shared with the Off-Season Keeper Builder
    if (failed) return '<p class="error">The Power Rankings didn’t load.</p>';
    if (!P) return '<p class="loading">Loading the Power Rankings…</p>';
    const esc = ctx.esc, { T, order } = score();
    const lg = f => (ctx.teams[f] || {}).logo ? `<img src="${ctx.teams[f].logo}" alt="" loading="lazy">` : '';
    const any = Object.keys(flips).length;
    const rows = order.map(f => { const s = T[f], t = P.teams[f], o = open.has(f);
      const cell = (k, sub) => `<td class="pw-p${sortBy === k ? ' cur' : ''}"><b>${s[k].toFixed(0)}</b><small>#${s['r' + k]} · ${sub}</small></td>`;
      return `<tr class="pw-r${o ? ' on' : ''}" data-pw="${f}" aria-expanded="${o}"><td class="pr-n">${s['r' + sortBy]}</td><td class="lg">${lg(f)}</td>
        <td class="t"><b>${esc((ctx.teams[f] || {}).abbr || f)}</b><small>${t.rec[0]}-${t.rec[1]}${t.rec[2] ? '-' + t.rec[2] : ''}</small><span class="pw-prof sm ${s.prof[0]}">${s.prof[1]}</span></td>
        ${cell('now', `${t.pf.toFixed(0)}/wk`)}${cell('fut', `${s.keepN} keep · ${$(s.cash)}`)}
        <td class="pw-pc"><span class="pw-prof ${s.prof[0]}">${s.prof[1]}</span></td></tr>
        ${o ? `<tr class="pw-dr"><td colspan="6">${detail(f, s, esc)}</td></tr>` : ''}`; }).join('');
    const bt = (P.keeperModel || {});
    return `<section><h2 class="sec">Power Rankings <small>now and next season, side by side</small></h2>
      <p class="pw-beta"><b>Beta</b> Two rankings, not one score: <b>Now</b> is who’s built to win this season, <b>Future</b> is who’s set up for ${P.next}. A contender spending its future and a rebuilder losing now are both doing their job, so neither is marked down for it.</p>
      <div class="pw-top"><div class="card pw-cc">${chart(T, ctx)}</div>
        <div class="pw-seg seg" role="group">${[['now', 'Rank by Now'], ['fut', 'Rank by Future']].map(([k, l]) => `<button type="button" aria-pressed="${sortBy === k}" data-pw-sort="${k}">${l}</button>`).join('')}</div></div>
      <div class="card tbl-wrap"><table class="tbl pw-tbl"><thead><tr><th>#</th><th class="lg"><span class="sr">Logo</span></th><th class="t">Team</th>
        <th title="This season">Now</th><th title="Next season: keepers, cash, picks">Future</th><th class="pw-pc">Profile</th></tr></thead>
        <tbody>${rows}</tbody></table></div>
      ${any ? `<p class="pw-note">You’ve flipped ${any} projected keeper${any === 1 ? '' : 's'} on this device, and Future reflects that. <button type="button" class="pw-reset" data-pw-reset="all">Back to all projections</button></p>` : ''}
      <p class="rf-foot">Scores are against the league: 50 is average and every 20 points is one standard deviation. <b>Now</b>: points a week and all-play record (half), and the best legal lineup on the roster for the rest of the season (half). <b>Future</b>: what the projected ${P.next} keepers are worth at auction plus the cash left after their salaries and $1 per open roster spot (three quarters), and rookie picks (a quarter). A costly contract that won’t be kept adds nothing to Future. Projected keepers come from the FBP keeper model, trained on this league’s real keeper decisions; tested on past deadlines it called 82% of decisions right and ordered the teams by keeper value almost exactly. It then applies the by-laws: two veteran QBs at most and the team’s budget. Tap a team to see and flip its keepers.</p>
    </section>`;
  }

  document.addEventListener('click', e => {
    const t = e.target.closest ? e.target : null; if (!t || !document.querySelector('.pw-tbl')) return;
    const rs = t.closest('[data-pw-reset]'); if (rs) { const f = rs.dataset.pwReset;
      if (f === 'all') flips = {}; else P.teams[f].players.forEach(p => { delete flips[p.id]; });
      save(); return redraw(); }
    const sb = t.closest('[data-pw-sort]'); if (sb) { sortBy = sb.dataset.pwSort; return redraw(); }
    if (t.closest('.pw-det')) return;
    const r = t.closest('[data-pw]'); if (r) { const f = r.dataset.pw; open.has(f) ? open.delete(f) : open.add(f); redraw(); }
  });
  document.addEventListener('change', e => {
    const c = e.target.closest && e.target.closest('[data-pw-keep]'); if (!c || !P) return;
    const id = c.dataset.pwKeep; let p = null;
    Object.values(P.teams).some(t => (p = t.players.find(x => x.id === id)));
    if (!p) return;
    if (c.checked === p.keep) delete flips[id]; else flips[id] = c.checked;
    save(); redraw();
  });
  return { render };
})();
