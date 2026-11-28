/* Off-Season tab: next year's sandbox, rebuilt from the 2026 Keeper Builder workbook (index_2026.html) on the site's own data.
   Data: data/offseason.json (scripts/offseason.py), which reads rosters.json (contracts and future salaries), power.json
   (the keeper model's keep chances and projected keepers, each team's auction budget from budgets.json, draft picks),
   values.json (Player Value, Trade Value) and auction-bids.json (the auction price curve).
   Lives in Beta for now (#beta/offseason; ctx.base sets the prefix, so it can move to the Off-Season tab as is).
   Views: Keeper Builder (<base>), All Keepers (<base>/all), Auction Pool (<base>/pool), Trade Builder
   (<base>/trade), Contracts (<base>/contracts). A shared plan opens at <base>/plan/<team>/<id.id.id>.
   Keeper picks are the same on-device picks as Beta > Power Rankings ('fbp-power-keep'), so both pages agree.
   Saved plans live in this browser ('fbp-os-plans'). Nothing here is official: keepers are declared with the commissioner. */
window.FBPOffseason = (function () {
  let D = null, loading = false, failed = false, X = null;
  let team = '', posF = 'ALL', poolMine = false, share = null, msg = '';
  let tA = '', tB = '', tr = { a: new Set(), b: new Set(), cash: 0 };   // trade builder: ids going out from each side, cash A to B
  const FK = 'fbp-power-keep', PK = 'fbp-os-plans';
  const rd = (k, d) => { try { return JSON.parse(localStorage.getItem(k) || '') || d; } catch (e) { return d; } };
  const wr = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} };
  let flips = rd(FK, {}), plans = rd(PK, []);
  const B = () => (X && X.base) || '#offseason';
  const redraw = () => { const y = window.scrollY; if (X && X.rerender) { X.rerender(); window.scrollTo(0, y); } };
  function load() {
    if (D || loading) return;
    loading = true;
    FBPU.json('data/offseason.json').then(j => j == null ? Promise.reject() : j)
      .then(j => { D = j; loading = false; redraw(); }).catch(() => { failed = true; loading = false; redraw(); });
  }
  const $ = v => (v < 0 ? '−$' : '$') + Math.abs(Math.round(v));
  const POS = ['QB', 'RB', 'WR', 'TE', 'DEF'];
  const abbr = f => (X.teams[f] || {}).abbr || f;
  const logo = (f, c) => (X.teams[f] || {}).logo ? `<img class="${c || 'os-lg'}" src="${X.teams[f].logo}" alt="" loading="lazy">` : '';
  const taxi = p => p.st === 'TAXI_SQUAD';
  const keepable = p => p.next != null;
  // the working plan: the model's projection, with anything you flipped on this device (shared with Power Rankings)
  const isKept = p => keepable(p) && (share && share.f === p.f ? share.ids.has(p.id) : (p.id in flips ? flips[p.id] : p.keep));
  const setKept = (p, on) => {
    if (share && share.f === p.f) { on ? share.ids.add(p.id) : share.ids.delete(p.id); return; }
    if (on === p.keep) delete flips[p.id]; else flips[p.id] = on; wr(FK, flips);
  };
  const byId = id => { let r = null; Object.values(D.teams).some(t => (r = t.players.find(p => p.id === id))); return r; };

  // the by-laws math for one team's keepers: keepers plus $1 for every open active spot must fit the budget;
  // at most two veteran QBs, plus one QB who spent his rookie season on taxi
  function cap(f, K, budget) {
    const act = K.filter(p => !taxi(p)).length, open = Math.max(0, D.roster - act), sal = K.reduce((s, p) => s + p.next, 0);
    const qbs = K.filter(p => p.pos === 'QB'), qx = qbs.find(taxi), vq = qbs.filter(p => p !== qx).length;
    const need = sal + open, left = budget - need, max = open ? budget - sal - (open - 1) : 0;
    const warn = [];
    if (left < 0) warn.push(`Over the budget by ${$(-left)}: keepers ${$(sal)} plus ${$(open)} for ${open} open spot${open === 1 ? '' : 's'}.`);
    if (vq > D.qbVets) warn.push(`${vq} veteran QBs kept: the limit is ${D.qbVets}${qx ? ` (${qx.n} counts as the taxi QB)` : ''}.`);
    if (act > D.roster) warn.push(`${act} active keepers: the active roster holds ${D.roster}.`);
    if (K.filter(taxi).length > D.taxi) warn.push(`${K.filter(taxi).length} taxi keepers: the taxi squad holds ${D.taxi}.`);
    return { n: K.length, act, open, sal, need, left, max, warn, vq };
  }
  const teamCap = f => { const t = D.teams[f]; t.players.forEach(p => { p.f = f; }); return cap(f, t.players.filter(isKept), t.budget); };

  const nav = v => `<nav class="rf-sub seg now-sub${B() === '#offseason' ? ' pg-nav' : ''} os-nav">${[['', '<span class="lg-only">Keeper Builder</span><span class="sm-only">Keepers</span>'], ['all', '<span class="lg-only">All Keepers</span><span class="sm-only">League</span>'], ['pool', '<span class="lg-only">Auction Pool</span><span class="sm-only">Auction</span>'], ['trade', '<span class="lg-only">Trade Builder</span><span class="sm-only">Trade</span>'], ['contracts', 'Contracts']]
    .map(([k, l]) => `<a href="${B()}${k ? '/' + k : ''}"${v === k ? ' aria-current="page"' : ''}>${l}</a>`).join('')}</nav>`;
  const picker = (cur, attr) => FBPU.divGrid(Object.keys(D.teams), f => { const c = teamCap(f);
    return `<button type="button" class="hs-cb os-cb${cur === f ? ' on' : ''}" ${attr}="${f}">${logo(f, '')}<b>${X.esc(abbr(f))}</b><small>${c.n} kept · ${$(c.left)} left</small></button>`; },
    { mine: X.myTeam, name: f => X.nameOf(f), cls: 'hs-cen os-cen' });
  const nm = p => `<a href="#now/player/${p.id}">${X.esc(p.n)}</a>`;
  const kp = p => `<span class="os-kp${p.kp >= .5 ? ' hi' : ''}" title="Keeper model: chance he's kept">${Math.round(p.kp * 100)}%</span>`;
  const sum = c => `<div class="os-sum">
      <span><b>${$(c.budget)}</b>${D.next} budget</span><span><b>${$(c.sal)}</b>${c.n} keeper${c.n === 1 ? '' : 's'}</span>
      <span><b>${$(c.open)}</b>${c.open} open spot${c.open === 1 ? '' : 's'} at $1</span>
      <span class="${c.left < 0 ? 'bad' : ''}"><b>${$(c.left)}</b>left to spend</span><span><b>${c.open ? $(c.max) : '—'}</b>max bid</span></div>
    ${c.warn.length ? `<ul class="os-warn">${c.warn.map(w => `<li>${w}</li>`).join('')}</ul>` : ''}`;
  const pickTxt = p => `${p.y} R${p.r}${p.s ? ' #' + p.s : ''}${p.from && p.from !== team ? ` <small>via ${X.esc(abbr(p.from))}</small>` : ''}`;

  /* ---------- Keeper Builder ---------- */
  function builder() {
    const esc = X.esc, t = D.teams[team], K = t.players.filter(isKept), c = Object.assign(cap(team, K, t.budget), { budget: t.budget });
    const flipped = t.players.some(p => p.id in flips), mine = plans.filter(p => p.f === team);
    const rows = POS.map(pos => { const L = t.players.filter(p => p.pos === pos).sort((a, b) => (b.next != null) - (a.next != null) || b.kp - a.kp || (b.pv || 0) - (a.pv || 0));
      if (!L.length) return '';
      return `<tr class="os-grp"><th colspan="6">${pos}</th></tr>` + L.map(p => { const k = isKept(p);
        return `<tr class="${k ? 'on' : ''}${keepable(p) ? '' : ' off'}"><td class="l"><label class="os-k"><input type="checkbox" data-os-keep="${p.id}"${k ? ' checked' : ''}${keepable(p) ? '' : ' disabled'}>
          <span><b>${nm(p)}</b><small>${p.nfl || ''}${p.age ? ' · ' + p.age : ''}${taxi(p) ? ' · <i class="os-tx">Taxi</i>' : p.st === 'INJURED_RESERVE' ? ' · IR' : ''}${p.keep ? ' · <i class="os-mod" title="The keeper model projects him kept">Projected</i>' : ''}</small></span></label></td>
          <td>${$(p.sal)}</td><td><b>${keepable(p) ? $(p.next) : '<small>Expires</small>'}</b></td><td><small>${p.cy || ''}</small></td><td>${keepable(p) ? kp(p) : ''}</td><td class="os-tv">${p.tv != null ? Math.round(p.tv) : ''}</td></tr>`; }).join(''); }).join('');
    const banner = share && share.f === team ? `<div class="os-share card"><b>Shared plan</b> You’re looking at a plan from a link. Change it here, then keep it or let it go.
        <button type="button" data-os-act="share-keep">Use this plan</button><button type="button" class="os-ghost" data-os-act="share-drop">Discard</button></div>` : '';
    return `${picker(team, 'data-os-team')}${banner}
      <div class="card os-head"><div class="os-tm">${logo(team, 'os-big')}<div><h3>${esc(X.nameOf(team))}</h3><small>${D.next} keepers · ${K.length} picked</small></div></div>${sum(c)}
        <div class="os-btns"><button type="button" data-os-act="model">Start from the model</button><button type="button" data-os-act="clear">Clear all</button>
          <button type="button" data-os-act="link">Share link</button></div>
        ${msg ? `<p class="os-msg">${msg}</p>` : ''}</div>
      <div class="card tbl-wrap"><table class="tbl os-tbl"><thead><tr><th class="l">Keep</th><th title="${D.season} salary">${D.season}</th><th title="${D.next} salary if kept">${D.next}</th><th title="Contract year">Yr</th><th title="Keeper model">Keep %</th><th class="os-tv" title="Trade Value">Trade Value</th></tr></thead>
        <tbody>${rows}</tbody></table></div>
      <div class="card os-plans"><h4>Saved plans <small>in this browser</small></h4>
        <div class="os-save"><input type="text" id="os-name" maxlength="40" placeholder="Name this plan"><button type="button" data-os-act="save">Save</button></div>
        ${mine.length ? `<ul>${mine.map(p => `<li><b>${esc(p.name)}</b><small>${p.ids.length} keepers · ${new Date(p.at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</small>
          <button type="button" data-os-load="${plans.indexOf(p)}">Load</button><button type="button" class="os-ghost" data-os-del="${plans.indexOf(p)}">Delete</button></li>`).join('')}</ul>` : '<p class="os-none">No saved plans for this team yet.</p>'}</div>
      ${t.picks.length ? `<div class="card os-picks"><h4>Draft picks</h4><p>${t.picks.filter(p => p.y === D.next).map(pickTxt).join(' · ') || 'None in ' + D.next}</p></div>` : ''}
      <p class="rf-foot">Keepers plus $1 for every open active spot (${D.roster} active, ${D.taxi} taxi) must fit the ${D.next} budget: $${D.cap} plus or minus auction cash traded. At most ${D.qbVets} veteran QBs, plus one QB who spent his rookie season on taxi. Max bid leaves $1 for every other open spot. ${D.next} salaries include the by-law raises. <b>Projected</b> and Keep % come from the keeper model, the same one behind Power Rankings, and your picks here show up there too${flipped ? ' (you’ve changed this team’s projection on this device)' : ''}. A look-ahead only: keepers are declared with the commissioner.</p>`;
  }

  /* ---------- All Keepers ---------- */
  function all() {
    const esc = X.esc, ids = Object.keys(D.teams).sort((a, b) => (b === X.myTeam) - (a === X.myTeam) || X.nameOf(a).localeCompare(X.nameOf(b)));
    const any = Object.keys(flips).length;
    return `<p class="os-intro">Every team’s ${D.next} keepers as projected by the keeper model${any ? ', with the picks you’ve changed on this device' : ''}. Open a team in the Keeper Builder to change them.</p>
      <div class="os-all">${ids.map(f => { const t = D.teams[f], c = Object.assign(teamCap(f), { budget: t.budget }), K = t.players.filter(isKept).sort((a, b) => b.next - a.next);
        return `<div class="card os-ak"><a class="os-tm" href="${B()}" data-os-go="${f}">${logo(f, 'os-big')}<div><h3>${esc(X.nameOf(f))}</h3><small>${c.n} kept · ${$(c.sal)} · ${$(c.left)} left · max bid ${c.open ? $(c.max) : '—'}</small></div></a>
          ${c.warn.length ? `<ul class="os-warn">${c.warn.map(w => `<li>${w}</li>`).join('')}</ul>` : ''}
          <ol>${K.map(p => `<li><span>${nm(p)} <small>${p.pos}${taxi(p) ? ' · Taxi' : ''}</small></span><b>${$(p.next)}</b></li>`).join('') || '<li class="os-none">No keepers</li>'}</ol></div>`; }).join('')}</div>`;
  }

  /* ---------- Auction Pool ---------- */
  // everyone on an FBP roster who isn't kept in the working plans, ranked by Player Value; the k-th best gets the
  // average k-th highest price of the last five auctions, so the whole pool adds up to what the league really spends
  function pool() {
    const esc = X.esc, P = [];
    Object.entries(D.teams).forEach(([f, t]) => t.players.forEach(p => { p.f = f; if (!isKept(p) && (p.pv || 0) > 0) P.push(p); }));
    P.sort((a, b) => (b.pv || 0) - (a.pv || 0));
    P.forEach((p, k) => { p.price = D.curve[k] != null ? D.curve[k] : 1; });
    const my = X.myTeam && D.teams[X.myTeam] ? Object.assign(teamCap(X.myTeam), { budget: D.teams[X.myTeam].budget }) : null;
    const L = P.filter(p => posF === 'ALL' || p.pos === posF).filter(p => !poolMine || !my || p.price <= my.max).slice(0, 100);
    const spend = Object.keys(D.teams).reduce((s, f) => s + Math.max(0, teamCap(f).left), 0);
    return `<p class="os-intro">Who’s likely to reach the ${D.next} auction, with a predicted price. Prices come from the last ${D.curveYears.length} auctions (${D.curveYears[0]}–${D.curveYears[D.curveYears.length - 1]}): the best player available gets the average top price, the second best the average second-highest, and so on. Teams have about ${$(spend)} to spend after keepers.</p>
      <div class="os-ctl"><div class="seg">${['ALL'].concat(POS).map(k => `<button type="button" data-os-pos="${k}" aria-pressed="${posF === k}">${k === 'ALL' ? 'All' : k}</button>`).join('')}</div>
        ${my ? `<label class="os-chk"><input type="checkbox" data-os-mine${poolMine ? ' checked' : ''}> Only what ${esc(abbr(X.myTeam))} can afford (max bid ${my.open ? $(my.max) : '—'})</label>` : ''}</div>
      <div class="card tbl-wrap"><table class="tbl os-tbl os-pool"><thead><tr><th>#</th><th class="l">Player</th><th title="Released by">From</th><th title="Predicted auction price">Price</th><th title="${D.next} salary if his team kept him">Keeper $</th><th class="os-tv" title="Keeper model">Keep %</th></tr></thead>
        <tbody>${L.map(p => `<tr><td>${P.indexOf(p) + 1}</td><td class="l"><b>${nm(p)}</b><small>${p.pos} · ${p.nfl || ''}${p.age ? ' · ' + p.age : ''}</small></td><td>${logo(p.f)}</td><td><b>${$(p.price)}</b></td><td>${p.next != null ? $(p.next) : '<small>Expires</small>'}</td><td class="os-tv">${kp(p)}</td></tr>`).join('')}</tbody></table></div>
      <p class="rf-foot">FBP rosters only: free agents and the ${D.next} rookie class aren’t in the pool. Change a team’s keepers in the Keeper Builder and the pool and prices follow. ${D.curveYears.map((y, i) => `${y}: ${D.curveSizes[i]} sold`).join(' · ')}.</p>`;
  }

  /* ---------- Trade Builder ---------- */
  function trade() {
    const esc = X.esc, ids = Object.keys(D.teams);
    if (!tA) tA = team;
    if (!tB || tB === tA) tB = ids.find(f => f !== tA);
    const opt = cur => ids.slice().sort((a, b) => X.nameOf(a).localeCompare(X.nameOf(b))).map(f => `<option value="${f}"${f === cur ? ' selected' : ''}>${esc(X.nameOf(f))}</option>`).join('');
    const side = (f, s, other, cash) => { const t = D.teams[f], o = D.teams[other];
      const out = t.players.filter(p => tr[s].has(p.id)), inn = o.players.filter(p => tr[s === 'a' ? 'b' : 'a'].has(p.id));
      // after the trade: his keepers minus who leaves, plus who arrives (kept if he has a contract for next year)
      const K = t.players.filter(p => isKept(p) && !tr[s].has(p.id)).concat(inn.filter(keepable));
      const before = Object.assign(cap(f, t.players.filter(isKept), t.budget), { budget: t.budget }), bud = t.budget + cash;
      const after = Object.assign(cap(f, K, bud), { budget: bud });
      const tv = L => L.reduce((a, p) => a + (p.tv || 0), 0);
      return `<div class="card os-side"><div class="os-tm">${logo(f, 'os-big')}<div><select data-os-side="${s}">${opt(f)}</select></div></div>
        <h4>Sends <small>tap to add</small></h4><ul class="os-tl">${t.players.slice().sort((a, b) => (b.tv || 0) - (a.tv || 0)).map(p => `<li class="${tr[s].has(p.id) ? 'on' : ''}"><label><input type="checkbox" data-os-tr="${s}:${p.id}"${tr[s].has(p.id) ? ' checked' : ''}>
          <span>${esc(p.n)} <small>${p.pos} · ${keepable(p) ? $(p.next) + ' in ' + D.next : 'expires'}</small></span><b>${p.tv != null ? Math.round(p.tv) : ''}</b></label></li>`).join('')}</ul>
        <div class="os-tsum"><span>Gives <b>${Math.round(tv(out))}</b> Trade Value, gets <b>${Math.round(tv(inn))}</b></span>
          <span>${D.next} budget ${$(before.budget)} → <b>${$(bud)}</b></span><span>Left after keepers ${$(before.left)} → <b class="${after.left < 0 ? 'bad' : ''}">${$(after.left)}</b></span></div>
        ${after.warn.length ? `<ul class="os-warn">${after.warn.map(w => `<li>${w}</li>`).join('')}</ul>` : ''}</div>`; };
    return `<p class="os-intro">Try a trade and see where both teams land for ${D.next}: Trade Value each way, auction cash and what’s left after keepers. Players who arrive count as keepers if they’re under contract for ${D.next}. A sketch only: real trades go through MFL.</p>
      <div class="os-cash card"><label>${D.next} auction cash <input type="number" step="1" min="-100" max="100" value="${tr.cash}" data-os-cash></label>
        <small>${tr.cash ? `${esc(abbr(tr.cash > 0 ? tA : tB))} sends ${$(Math.abs(tr.cash))} to ${esc(abbr(tr.cash > 0 ? tB : tA))}` : `Positive: ${esc(abbr(tA))} sends cash. Negative: ${esc(abbr(tB))} does.`}</small>
        <button type="button" class="os-ghost" data-os-act="tr-clear">Clear</button></div>
      <div class="os-trade">${side(tA, 'a', tB, -tr.cash)}${side(tB, 'b', tA, tr.cash)}</div>
      <p class="rf-foot">Trade Value is the site’s trade number (League Now › Trading Floor). Draft picks aren’t in the builder yet; see each team’s picks in the Keeper Builder.</p>`;
  }

  /* ---------- Contracts ---------- */
  function contracts() {
    const esc = X.esc, t = D.teams[team], yrs = [D.season]; for (let y = D.next; y <= D.season + 5; y++) yrs.push(y);
    const sal = (p, i) => i === 0 ? p.sal : p.fut[i - 1];
    const L = t.players.slice().sort((a, b) => b.fut.length - a.fut.length || (b.next || 0) - (a.next || 0));
    const tot = yrs.map((y, i) => L.reduce((s, p) => s + (sal(p, i) || 0), 0));
    return `${picker(team, 'data-os-team')}
      <p class="os-intro">Every contract on the roster and what it costs each year if he’s kept, with the by-law raises (veterans +$3, then +$6; rookies +$3, +$6, +$9, +$12; taxi rookies frozen through year two). A blank year means the deal is up.</p>
      <div class="card tbl-wrap"><table class="tbl os-tbl os-con"><thead><tr><th class="l">Player</th>${yrs.map(y => `<th>${y}</th>`).join('')}</tr></thead>
        <tbody>${L.map(p => `<tr class="${isKept(p) ? 'on' : ''}"><td class="l"><b>${nm(p)}</b><small>${p.pos} · ${p.cy || ''}${taxi(p) ? ' · Taxi' : ''}</small></td>${yrs.map((y, i) => { const v = sal(p, i);
          return `<td>${v != null ? $(v) : ''}</td>`; }).join('')}</tr>`).join('')}</tbody>
        <tfoot><tr><th class="l">If everyone’s kept</th>${tot.map(v => `<th>${$(v)}</th>`).join('')}</tr></tfoot></table></div>
      <p class="rf-foot">Highlighted rows are keepers in your working plan. Contracts come from MFL (League Now › Rosters).</p>`;
  }

  function render(ctx, parts) {
    X = ctx; load(); flips = rd(FK, {}); plans = rd(PK, []);
    if (failed) return '<p class="error">The Off-Season data didn’t load. Refresh the page to try again.</p>';
    if (!D) return '<p class="loading">Loading the off-season…</p>';
    let v = parts[1] || '';
    if (v !== 'plan') share = null;   // a shared plan is a preview on its own link only
    if (v === 'plan' && D.teams[parts[2]]) {   // a shared plan: preview it without touching your own picks
      if (!share || share.key !== parts.slice(2).join('/')) share = { key: parts.slice(2).join('/'), f: parts[2], ids: new Set((parts[3] || '').split('.').filter(id => D.teams[parts[2]].players.some(p => p.id === id))) };
      team = parts[2]; v = '';
    }
    if (!team || !D.teams[team]) team = ctx.myTeam && D.teams[ctx.myTeam] ? ctx.myTeam : Object.keys(D.teams).sort((a, b) => ctx.nameOf(a).localeCompare(ctx.nameOf(b)))[0];
    Object.entries(D.teams).forEach(([f, t]) => t.players.forEach(p => { p.f = f; }));
    const body = v === 'all' ? all() : v === 'pool' ? pool() : v === 'trade' ? trade() : v === 'contracts' ? contracts() : builder();
    const asOf = D.through ? ` · keepers as of week ${D.through}` : '';
    return `<section class="os"><h2 class="sec">Off-Season <small>${D.next} look-ahead${asOf}</small></h2>${nav(v)}${body}
      <p class="os-more">More for the off-season: <a href="#now/rankings">Rankings</a> · <a href="#draft">Rookie Draft</a> · <a href="#now/trade">Trading Floor</a> · <a href="#now/analytics">Analytics</a> · <a href="#bylaws">By-Laws</a></p></section>`;
  }

  const team0 = () => D.teams[team];
  document.addEventListener('click', e => {
    const t = e.target.closest ? e.target : null; if (!t || !D || !t.closest('.os')) return;
    const tb = t.closest('[data-os-team]'); if (tb) { team = tb.dataset.osTeam; msg = ''; return redraw(); }
    const go = t.closest('[data-os-go]'); if (go) { team = go.dataset.osGo; msg = ''; return; }   // the link goes to the Keeper Builder
    const ps = t.closest('[data-os-pos]'); if (ps) { posF = ps.dataset.osPos; return redraw(); }
    const ld = t.closest('[data-os-load]'); if (ld) { const p = plans[+ld.dataset.osLoad]; if (!p) return;
      team0().players.forEach(x => { if (keepable(x)) setKept(x, p.ids.includes(x.id)); }); msg = `Loaded “${X.esc(p.name)}”.`; return redraw(); }
    const dl = t.closest('[data-os-del]'); if (dl) { const p = plans[+dl.dataset.osDel]; if (!p) return;
      plans.splice(+dl.dataset.osDel, 1); wr(PK, plans); msg = `Deleted “${X.esc(p.name)}”.`; return redraw(); }
    const a = t.closest('[data-os-act]'); if (!a) return;
    const act = a.dataset.osAct, T = team0();
    if (act === 'model') { if (share && share.f === team) share.ids = new Set(T.players.filter(p => p.keep).map(p => p.id)); else T.players.forEach(p => { delete flips[p.id]; }); wr(FK, flips); msg = 'Back to the keeper model’s projection.'; }
    else if (act === 'clear') { T.players.forEach(p => { if (keepable(p)) setKept(p, false); }); msg = 'Cleared. Tick the players you’d keep.'; }
    else if (act === 'save') { const inp = document.getElementById('os-name'), name = ((inp && inp.value) || '').trim() || `${abbr(team)} plan ${plans.filter(p => p.f === team).length + 1}`;
      plans.push({ name, f: team, ids: T.players.filter(isKept).map(p => p.id), at: Date.now() }); wr(PK, plans); msg = `Saved “${X.esc(name)}”.`; }
    else if (act === 'link') {
      const url = location.href.split('#')[0] + B() + '/plan/' + team + '/' + T.players.filter(isKept).map(p => p.id).join('.');
      const done = () => { msg = 'Link copied. Anyone who opens it sees this plan without changing their own.'; redraw(); };
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(url).then(done, () => { msg = `Copy this link: <input class="os-url" readonly value="${X.esc(url)}">`; redraw(); });
      else { msg = `Copy this link: <input class="os-url" readonly value="${X.esc(url)}">`; }
      return redraw();
    }
    else if (act === 'share-keep') { const ids = share.ids; share = null; T.players.forEach(p => { if (keepable(p)) setKept(p, ids.has(p.id)); }); msg = 'This plan is now your working plan for this team.'; location.replace(B()); return; }
    else if (act === 'share-drop') { share = null; msg = ''; location.replace(B()); return; }
    else if (act === 'tr-clear') { tr = { a: new Set(), b: new Set(), cash: 0 }; }
    redraw();
  });
  document.addEventListener('change', e => {
    const c = e.target; if (!c.closest || !D || !c.closest('.os')) return;
    if (c.matches('[data-os-keep]')) { const p = byId(c.dataset.osKeep); if (p) { setKept(p, c.checked); msg = ''; redraw(); } return; }
    if (c.matches('[data-os-mine]')) { poolMine = c.checked; return redraw(); }
    if (c.matches('[data-os-tr]')) { const [s, id] = c.dataset.osTr.split(':'); c.checked ? tr[s].add(id) : tr[s].delete(id); return redraw(); }
    if (c.matches('[data-os-side]')) { const f = c.value; if (c.dataset.osSide === 'a') { if (f === tB) tB = tA; tA = f; } else { if (f === tA) tA = tB; tB = f; } tr = { a: new Set(), b: new Set(), cash: 0 }; return redraw(); }
    if (c.matches('[data-os-cash]')) { tr.cash = Math.max(-100, Math.min(100, Math.round(+c.value || 0))); return redraw(); }
  });
  return { render };
})();
