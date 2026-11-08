/* League Now > Power Rankings: the FBP Power Score, from data/power.json (scripts/power.py).
   Four parts, each scored 0-100 against the league (50 is average; every 20 points is one standard deviation):
   Strength now 35%, Keepers 30%, Auction cash 20%, Draft picks 15%. Keepers and cash follow the keep/drop choices:
   the suggestions come from the data, and anyone can flip a player on their own device (saved in this browser) to see
   how dropping or keeping him changes his team and the league. MFL's own rating stays in its table below. */
window.FBPPower = (function () {
  let P = null, loading = false, failed = false, X = null;
  const open = new Set();
  let flips = {}; try { flips = JSON.parse(localStorage.getItem('fbp-power-keep') || '{}') || {}; } catch (e) { flips = {}; }
  const save = () => { try { localStorage.setItem('fbp-power-keep', JSON.stringify(flips)); } catch (e) {} };
  function load() {
    if (P || loading) return;
    loading = true;
    fetch('data/power.json', { cache: 'no-cache' }).then(r => r.ok ? r.json() : Promise.reject())
      .then(j => { P = j; loading = false; redraw(); }).catch(() => { failed = true; loading = false; redraw(); });
  }
  const redraw = () => { const y = window.scrollY; if (X && X.rerender) { X.rerender(); window.scrollTo(0, y); } };
  const kept = p => p.next != null && (p.id in flips ? flips[p.id] : p.keep);
  const $ = v => '$' + Math.round(v);
  const PARTS = [['now', 'Now'], ['keep', 'Keepers'], ['cash', 'Cash'], ['picks', 'Picks']];

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
    const parts = { now: z(nowRaw), keep: z(f => T[f].keepVal), cash: z(f => T[f].cash), picks: z(f => T[f].picks) };
    const sc = v => Math.max(0, Math.min(100, 50 + 20 * v));
    ids.forEach(f => { const s = T[f]; s.part = {};
      PARTS.forEach(([k]) => { s.part[k] = sc(parts[k](f)); });
      s.total = PARTS.reduce((a, [k]) => a + s.part[k] * P.weights[k], 0) / 100; });
    const order = ids.slice().sort((a, b) => T[b].total - T[a].total);
    order.forEach((f, i) => { T[f].rank = i + 1; });
    PARTS.forEach(([k]) => ids.slice().sort((a, b) => T[b].part[k] - T[a].part[k]).forEach((f, i) => { T[f]['r' + k] = i + 1; }));
    return { T, order };
  }

  function detail(f, s, esc) {
    const t = P.teams[f], nx = P.next;
    const lineup = new Set(t.lineup);
    const flipped = t.players.some(p => p.id in flips);
    const rows = t.players.filter(p => p.next != null).map(p => { const k = kept(p), sur = p.val - p.next, sug = p.keep;
      return `<tr class="${k ? 'on' : ''}"><td class="l"><label class="pw-k"><input type="checkbox" data-pw-keep="${p.id}"${k ? ' checked' : ''}><span><b>${esc(p.name)}</b><small>${p.pos}${p.age ? ' · ' + p.age : ''}${p.st === 'TAXI_SQUAD' ? ' · taxi' : p.st === 'INJURED_RESERVE' ? ' · IR' : ''}${p.why ? ` · ${esc(p.why)}` : ''}${p.id in flips ? ` · <i>suggested: ${sug ? 'keep' : 'drop'}</i>` : ''}</small></span></label></td>
        <td>${$(p.next)}</td><td>${$(p.val)}</td><td class="${sur >= 0 ? 'up' : 'dn'}">${sur >= 0 ? '+' : '−'}$${Math.round(Math.abs(sur))}</td><td>${p.yrs}</td></tr>`; }).join('');
    const gone = t.players.filter(p => p.next == null);
    const pk = t.picks.map(p => { const from = p.from !== f ? (X.teams[p.from] || {}).abbr || p.from : '';
      return `<li><b>${p.y} ${p.r}.${p.s ? String(p.s).padStart(2, '0') : '??'}</b>${from ? `<small>from ${esc(from)}</small>` : ''}<span>${p.v.toFixed(0)} pts/yr</span></li>`; }).join('');
    return `<div class="pw-det">
      <div class="pw-cols">
        <div><h4>Strength now <small>${s.part.now.toFixed(0)}</small></h4>
          <p>${t.pf.toFixed(1)} points a week · all-play ${(t.ap * 100).toFixed(0)}% · best lineup for the rest of the season projects ${t.ros.toFixed(1)} a week.</p></div>
        <div><h4>Draft picks <small>${s.part.picks.toFixed(0)}</small></h4>${pk ? `<ul class="pw-pk">${pk}</ul>` : '<p>No picks in the next two drafts.</p>'}
          <p class="pw-fn">Pts/yr: what that draft slot has scored a season, on average, in a pick’s first three years. 2028 slots aren’t set yet, so they count as mid-round.</p></div>
      </div>
      <h4>Keep or drop for ${nx} <small>tap to flip · only on this device</small>${flipped ? ` <button type="button" class="pw-reset" data-pw-reset="${f}">Back to suggestions</button>` : ''}</h4>
      <div class="pw-sum"><span><b>${$(s.keepVal)}</b>keepers’ auction value</span><span><b>${$(s.keepSal)}</b>kept salary · ${s.keepN} kept</span><span><b>${$(s.cash)}</b>to spend (${$(t.budget)} budget, $1 × ${s.open} open spots)</span></div>
      <div class="tbl-wrap"><table class="pw-kt"><thead><tr><th class="l">Under contract for ${nx}</th><th>${nx} salary</th><th>Value</th><th>Surplus</th><th>Yrs left</th></tr></thead><tbody>${rows}</tbody></table></div>
      ${gone.length ? `<p class="pw-fn">Contracts up after ${P.season} (back to the auction): ${gone.map(p => esc(p.name)).join(', ')}.</p>` : ''}
    </div>`;
  }

  function render(ctx) {
    X = ctx; load();
    if (failed) return '<p class="error">The FBP Power Score didn’t load.</p>';
    if (!P) return '<p class="loading">Loading the FBP Power Score…</p>';
    const esc = ctx.esc, { T, order } = score();
    const lg = f => (ctx.teams[f] || {}).logo ? `<img src="${ctx.teams[f].logo}" alt="" loading="lazy">` : '';
    const any = Object.keys(flips).length;
    const rows = order.map(f => { const s = T[f], t = P.teams[f], o = open.has(f), mfl = t.mfl;
      const d = mfl ? mfl - s.rank : 0;
      const cell = (k, sub) => `<td class="pw-p"><b>${s.part[k].toFixed(0)}</b><small>${sub}</small></td>`;
      return `<tr class="pw-r${o ? ' on' : ''}" data-pw="${f}" aria-expanded="${o}"><td class="pr-n">${s.rank}</td><td class="lg">${lg(f)}</td>
        <td class="t"><b>${esc((ctx.teams[f] || {}).abbr || f)}</b><small>${t.rec[0]}-${t.rec[1]}${t.rec[2] ? '-' + t.rec[2] : ''}${mfl ? ` · MFL #${mfl}${d ? ` <i class="${d > 0 ? 'up' : 'dn'}">${d > 0 ? '▲' : '▼'}${Math.abs(d)}</i>` : ''}` : ''}</small></td>
        <td class="pw-tot"><b>${s.total.toFixed(1)}</b></td>
        ${cell('now', `${t.pf.toFixed(0)}/wk`)}${cell('keep', $(s.keepVal))}${cell('cash', $(s.cash))}${cell('picks', `${t.picks.length} pick${t.picks.length === 1 ? '' : 's'}`)}</tr>
        ${o ? `<tr class="pw-dr"><td colspan="8">${detail(f, s, esc)}</td></tr>` : ''}`; }).join('');
    return `<section><h2 class="sec">FBP Power Score <small>now and next season, from rosters, contracts, cash and picks</small></h2>
      <p class="pw-beta"><b>Beta</b> The FBP Power Score is new and still being developed. The formula, the player values and the keep/drop suggestions will change as we tune it, so take the suggestions as a rough first pass, not advice.</p>
      <div class="card tbl-wrap"><table class="tbl pw-tbl"><thead><tr><th>#</th><th class="lg"><span class="sr">Logo</span></th><th class="t">Team</th><th>Score</th>
        <th title="Strength now: ${P.weights.now}%">Now<small>${P.weights.now}%</small></th><th title="Keepers: ${P.weights.keep}%">Keep<small>${P.weights.keep}%</small></th><th title="Auction cash: ${P.weights.cash}%">Cash<small>${P.weights.cash}%</small></th><th title="Draft picks: ${P.weights.picks}%">Picks<small>${P.weights.picks}%</small></th></tr></thead>
        <tbody>${rows}</tbody></table></div>
      ${any ? `<p class="pw-note">You’ve flipped ${any} keep/drop suggestion${any === 1 ? '' : 's'} on this device, and the scores reflect that. <button type="button" class="pw-reset" data-pw-reset="all">Back to all suggestions</button></p>` : ''}
      <p class="rf-foot">Each part is scored against the league: 50 is average and every 20 points is one standard deviation. <b>Now</b> (${P.weights.now}%) is points a week and all-play record, plus the best legal lineup on the roster for the rest of the season. <b>Keepers</b> (${P.weights.keep}%) is what the players a team would keep for ${P.next} are worth at auction. <b>Cash</b> (${P.weights.cash}%) is what’s left to spend: the auction budget, minus kept salaries, minus $1 for each open spot on the ${P.roster}-man active roster. <b>Picks</b> (${P.weights.picks}%) values the next two rookie drafts by what each slot has scored. A player’s value blends his points a game with his FantasyPros rest-of-season rank, adjusts for age, and turns points above replacement into dollars the way FBP auctions have spent by position. ${P.next} values are priced for SuperFlex: about 1.8 starting QBs a team, and QBs drawing a quarter of the auction money. Young players on rookie deals get a value floor from their NFL draft slot while they develop; QBs keep it longest, since they cost less and usually take longer to produce. Keep suggestions: worth more than next year’s salary, two veteran QBs at most. Tap a team to see them and flip any player.</p>
    </section>`;
  }

  document.addEventListener('click', e => {
    const t = e.target.closest ? e.target : null; if (!t || !document.querySelector('.pw-tbl')) return;
    const rs = t.closest('[data-pw-reset]'); if (rs) { const f = rs.dataset.pwReset;
      if (f === 'all') flips = {}; else P.teams[f].players.forEach(p => { delete flips[p.id]; });
      save(); return redraw(); }
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
