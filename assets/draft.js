/* Rookie Draft mock: the hub's #draft tab.
   Draft order and pick owners come from data/league-now.json (draftRounds); rookies, projected NFL
   picks and the salary formula come from the Rookie Pricer (rookie-pricer/players.json, pricing.json).
   Exposes window.FBPDraft.render(ctx) and .click(e, ctx); site.js routes to it. */
(() => {
  const KEY = 'fbp-mock-2027';
  const S = { cfg: null, data: null, loading: false, err: null, mode: 'mine', my: '', picks: [], custom: [],
              cur: 0, pos: 'ALL', sort: 'adp', round: null, sig: '', note: '', mtab: 'players', timer: null, simAll: false, started: false, openP: null, taxi: new Set() };
  const DELAY = 800;   // pause between computer picks (ms)
  try { const m = localStorage.getItem('fbp-myteam'); if (m) S.my = m; const t = localStorage.getItem('fbp-draft-tab'); if (t) S.mtab = t; } catch (e) {}

  /* ---- price formula (same as the Rookie Pricer) ---- */
  const interp = (a, p) => {
    if (p <= a[0][0]) return a[0][1];
    if (p >= a[a.length - 1][0]) return a[a.length - 1][1];
    for (let i = 0; i < a.length - 1; i++) { const [p0, f0] = a[i], [p1, f1] = a[i + 1]; if (p <= p1) return f0 + (f1 - f0) * (p - p0) / (p1 - p0); }
  };
  function price(pl, slot) {   // slot 0..47 (1.01 = 0)
    const C = S.cfg, round = Math.floor(slot / 12) + 1;   // nflPick null = no projection: priced as undrafted
    if (round > 2) return C.flatSalaryByRound[String(round)] ?? 1;
    const c = C.positions[pl.pos];
    if (!c) return C.minimumRounds1to2;
    const raw = c.max * interp(c.nfl, pl.nflPick || C.undraftedPick) * c.fbp[slot];
    return Math.max(C.minimumRounds1to2, Math.floor(raw + 0.5));
  }
  const slotLabel = s => `${Math.floor(s / 12) + 1}.${String(s % 12 + 1).padStart(2, '0')}`;
  // round.pick for an overall NFL pick; compensatory picks make rounds 3-7 longer than 32, so use the real order when loaded
  function nflLabel(p) {
    if (!p || p >= S.cfg.undraftedPick) return 'UDFA';
    p = Math.round(p);
    const O = S.nflOrder && S.nflOrder.picks;
    if (O && O[p - 1]) { const r = O[p - 1].round, first = O.find(x => x.round === r).pick; return `${r}.${String(p - first + 1).padStart(2, '0')}`; }
    return `${Math.ceil(p / 32)}.${String((p - 1) % 32 + 1).padStart(2, '0')}`;
  }

  /* ---- order and state ---- */
  function order(now) {
    const R = now.draftRounds || {};
    const out = [];
    for (const r of ['1', '2', '3', '4']) (R[r] || []).forEach(p => out.push({ slot: (+r - 1) * 12 + p.pick - 1, orig: p.id, owner: p.owner || p.id }));
    return out.sort((a, b) => a.slot - b.slot);
  }
  const pool = () => S.data.players.concat(S.custom);
  const taken = () => new Set(S.picks.filter(p => p && !p.unranked).map(p => p.name));
  const posPill = p => p.pos ? ` <span class="pos ${p.pos}">${p.pos}</span>` : '';
  const available = () => { const t = taken(); return pool().filter(p => !t.has(p.name)); };
  const siteVersion = () => (window.FBP && window.FBP.version) || '';
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify({ v: siteVersion(), sig: S.sig, mode: S.mode, started: S.started, picks: S.picks.map(p => p ? p.name : null), custom: S.custom })); } catch (e) {}
  }
  function restore(ord) {
    S.sig = ord.map(o => o.owner).join(',');
    S.picks = ord.map(() => null); S.cur = 0; S.started = false;
    try {
      const sv = JSON.parse(localStorage.getItem(KEY) || 'null');
      if (sv && sv.picks && sv.v !== siteVersion()) {
        // a new site version: start every mock fresh (keep only the mock type)
        S.mode = sv.mode || S.mode;
        localStorage.removeItem(KEY);
      } else if (sv && sv.picks) {
        S.custom = sv.custom || [];
        if (sv.sig !== S.sig) { S.note = 'The draft order changed since your last mock (new standings or a pick trade), so it was reset.'; }
        else {
          const by = new Map(pool().map(p => [p.name, p]));
          S.picks = sv.picks.map(n => n == null ? null : (by.get(n) || { name: n, pos: '', unranked: true }));
          S.mode = sv.mode || S.mode;
          S.cur = S.picks.findIndex(p => !p); if (S.cur < 0) S.cur = S.picks.length;
          S.started = !!sv.started || S.cur > 0;
        }
      }
    } catch (e) {}
  }

  /* ---- auto-pick: best available by rookie ADP, with some noise and a light QB cap ---- */
  function autoPick(ord, i) {
    const owner = ord[i].owner;
    const mine = S.picks.filter((p, k) => p && ord[k].owner === owner);
    const qbs = mine.filter(p => p.pos === 'QB').length;
    const av = available();
    if (!av.length) return { name: 'Best available (unranked)', pos: '', unranked: true, key: 'u' + i };
    let best = null, bestScore = Infinity;
    for (const p of av.slice(0, 10)) {
      const noise = (Math.random() + Math.random() + Math.random() - 1.5) * (1.2 + p.adp * 0.12);
      const score = p.adp + noise + (p.pos === 'QB' && qbs >= 2 ? 8 : 0) + (mine.some(m => m.pos === p.pos) ? 0.6 : 0);
      if (score < bestScore) { bestScore = score; best = p; }
    }
    return best;
  }
  function isMine(ord, i) { return S.mode === 'all' || (S.mode === 'mine' && ord[i] && ord[i].owner === S.my); }
  function advance(ord, stopAtMine = true) {
    while (S.cur < ord.length && !(stopAtMine && isMine(ord, S.cur))) { S.picks[S.cur] = autoPick(ord, S.cur); S.cur++; }
  }
  function draft(ord, player) { S.picks[S.cur] = player; S.cur++; save(); }
  // computer picks, one at a time with a short pause, until it's a person's turn
  function wantsAuto(ord) {
    if (!S.started || S.cur >= ord.length) return false;
    if (S.mode === 'auto') return true;
    if (S.mode === 'all') return S.simAll;
    return !isMine(ord, S.cur);
  }
  function stop() { clearTimeout(S.timer); S.timer = null; S.simAll = false; }
  function schedule(ctx) {
    if (S.timer || !S.cfg) return;
    if (!wantsAuto(order(ctx.now))) return;
    S.timer = setTimeout(() => {
      S.timer = null;
      if (location.hash !== '#draft') return;          // left the tab: pick up again on return
      const ord = order(ctx.now);
      if (!wantsAuto(ord)) return;
      S.picks[S.cur] = autoPick(ord, S.cur); S.cur++;
      if (S.cur >= ord.length) S.simAll = false;
      save(); ctx.rerender();
    }, DELAY);
  }

  /* ---- loading ---- */
  // projected landing spot: the NFL team holding the overall pick a rookie is projected to go at
  // (Tankathon's projected 2027 order with traded picks; logos from ESPN). Optional extras.
  function loadLanding(rerender) {
    Promise.all(['data/nfl-draft-order.json', 'data/espn/teams.json'].map(u => fetch(u, { cache: 'no-cache' }).then(r => r.ok ? r.json() : null).catch(() => null)))
      .then(([o, t]) => { S.nflOrder = o; S.nflTeams = t || {}; if (o) rerender(); });
  }
  function landing(p) {
    const O = S.nflOrder;
    if (!O || !p.nflPick || p.nflPick > O.picks.length) return null;
    const k = O.picks[Math.round(p.nflPick) - 1];
    if (!k) return null;
    const t = S.nflTeams[k.team] || {};
    return { team: k.team, name: t.name || k.team, logo: t.logo || `https://a.espncdn.com/i/teamlogos/nfl/500/${k.team.toLowerCase()}.png`, from: k.from };
  }
  const landHtml = p => {
    const l = landing(p);
    return l ? `<span class="dr-land" title="Projected landing spot: ${l.name} hold pick ${Math.round(p.nflPick)}${l.from ? ` (from ${l.from})` : ''} in Tankathon's projected order"><img src="${l.logo}" alt="" loading="lazy" onerror="this.remove()">${l.team}</span>` : '';
  };
  function load(rerender) {
    if (S.loading || S.cfg) return;
    S.loading = true;
    loadLanding(rerender);
    Promise.all(['rookie-pricer/pricing.json', 'rookie-pricer/mock-board.json'].map(u => fetch(u, { cache: 'no-cache' }).then(r => { if (!r.ok) throw new Error(u); return r.json(); })))
      .then(([c, d]) => { d.players.forEach(p => { p.adp = p.rank; }); S.cfg = c; S.data = d; S.loading = false; rerender(); })
      .catch(e => { S.err = String(e); S.loading = false; rerender(); });
  }

  const escH = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  /* ---- a rookie's price breakdown and contract (opened by tapping him) ---- */
  function breakdown(pl, slot) {
    const C = S.cfg, round = Math.floor(slot / 12) + 1;
    if (round > 2) return { flat: true, round, val: price(pl, slot) };
    const c = C.positions[pl.pos];
    if (!c) return { flat: true, round, val: price(pl, slot) };
    const np = pl.nflPick || C.undraftedPick, nf = interp(c.nfl, np), ff = c.fbp[slot], raw = c.max * nf * ff;
    return { max: c.max, nf, ff, np, raw, val: price(pl, slot), floored: Math.floor(raw + 0.5) < C.minimumRounds1to2 };
  }
  // 2027 by-laws: active rookie deal is 5 years, +$3/+$6/+$9/+$12 added year over year (+0/+3/+9/+18/+30 from base).
  // Full season on taxi: 6 years, year 1 counts at 2/3 (rounded up; none on $1-$2), year 2 frozen at the salary, then the same escalators.
  function contract(salary, taxi) {
    const esc_ = S.cfg.escalators || [3, 6, 9, 12];
    const years = [salary]; let v = salary; esc_.forEach(e => { v += e; years.push(v); });
    if (!taxi) return years.map((v, i) => ({ v, note: i === 0 ? 'Salary' : `+$${esc_[i - 1]}` }));
    const y1 = salary <= 2 ? salary : Math.ceil(salary * 2 / 3);
    return [{ v: y1, note: salary <= 2 ? 'No discount on $1–$2' : `⅔ counted, $${salary - y1} deferred`, taxi: true },
            { v: salary, note: 'Frozen' }].concat(years.slice(1).map((v, i) => ({ v, note: `+$${esc_[i]}` })));
  }
  function detail(pl, slot) {
    const b = breakdown(pl, slot), fx = n => n.toFixed(n < 1 ? 2 : 0), taxi = S.taxi.has(pl.name);
    const math = b.flat
      ? `<p class="dr-math">Round ${b.round} picks are a flat <b>$${b.val}</b>.</p>`
      : `<p class="dr-math"><span>$${b.max} ${pl.pos} max</span> × <span>${fx(b.nf)} NFL factor <small>(${pl.nflPick ? 'proj ' + nflLabel(b.np) : 'no projection, priced as undrafted'})</small></span>
          × <span>${fx(b.ff)} FBP factor <small>(${slotLabel(slot)})</small></span> = ${b.raw.toFixed(1)} → <b>$${b.val}</b>${b.floored ? ' <small>(the $3 minimum)</small>' : ''}</p>`;
    const yrs = contract(b.val, taxi);
    return `<div class="dr-detail">
      <h4>Price at ${slotLabel(slot)}</h4>${math}
      <label class="dr-taxi"><input type="checkbox" data-dr-taxi="${escH(pl.name)}"${taxi ? ' checked' : ''}> Full season on taxi squad</label>
      <h4>${taxi ? '6-year taxi contract' : '5-year rookie contract'}</h4>
      <div class="dr-years">${yrs.map((y, i) => `<div class="${y.taxi ? 'tx' : ''}"><small>Year ${i + 1}</small><b>$${y.v}</b><span>${y.note}</span></div>`).join('')}</div>
      <p class="dr-foot">Total over the deal: $${yrs.reduce((t, y) => t + y.v, 0)}${taxi ? ' (counting year 1 at ⅔)' : ''}.</p>
    </div>`;
  }

  /* ---- render ---- */
  function render(ctx) {
    const { now, chip, esc, nameOf, teams } = ctx;
    if (!now) return '<p class="error">League data didn’t load. Refresh the page to try again.</p>';
    if (S.err) return '<p class="error">The rookie list didn’t load. Refresh the page to try again.</p>';
    if (!S.cfg) { load(ctx.rerender); return '<p class="loading">Loading the rookie class…</p>'; }
    const ord = order(now);
    const sig = ord.map(o => o.owner).join(',');
    if (S.sig !== sig) restore(ord);
    if (!S.my || !teams[S.my]) S.my = ord.length ? ord[0].owner : Object.keys(teams)[0];
    setTimeout(() => schedule(ctx), 0);
    const done = S.cur >= ord.length;
    const cur = ord[S.cur];
    const ids = Object.keys(teams).sort((a, b) => nameOf(a).localeCompare(nameOf(b)));

    const modes = [['mine', 'Pick for my team'], ['all', 'I pick for everyone'], ['auto', 'Auto-mock the league']]
      .map(([m, l]) => `<option value="${m}"${S.mode === m ? ' selected' : ''}>${l}</option>`).join('');
    const teamSel = `<label class="dr-field"><span>My team</span>
      <select id="dr-my">${ids.map(id => `<option value="${id}"${id === S.my ? ' selected' : ''}>${esc(nameOf(id))}</option>`).join('')}</select></label>
      <label class="dr-field"><span>Mock type</span><select id="dr-mode">${modes}</select></label>`;

    // on the clock
    let clock;
    if (!S.started) {
      const how = S.mode === 'mine' ? `You pick for <b>${esc(nameOf(S.my))}</b>; every other team auto-picks.`
        : S.mode === 'all' ? 'You make every pick (or let the computer take any of them).'
        : 'The computer drafts for all 12 teams while you watch.';
      clock = `<div class="dr-clock-h"><b>Ready to draft</b><span class="dr-via">${ord.length} picks · 4 rounds</span></div>
        <p class="dr-status">${how} Choose your team and mock type above, then start.</p>
        <div class="dr-actions"><button type="button" class="btn dr-start" data-dr="start">Start draft</button></div>`;
    } else if (done) {
      clock = `<div class="dr-clock-h"><b>Draft complete</b><span>${ord.length} picks</span></div>
        <div class="dr-actions">${S.mode === 'auto' ? '<button type="button" class="btn" data-dr="rerun">Run another mock</button>' : ''}<button type="button" class="btn${S.mode === 'auto' ? ' ghost' : ''}" data-dr="restart">Start over</button><button type="button" class="btn ghost" data-dr="undo">Undo last pick</button></div>`;
    } else {
      const via = cur.owner !== cur.orig ? `<span class="dr-via">via ${esc(nameOf(cur.orig))}</span>` : '';
      const auto = wantsAuto(ord), yours = !auto && isMine(ord, S.cur);
      clock = `<div class="dr-clock-h"><span class="dr-pk">${slotLabel(cur.slot)}</span>${chip(cur.owner)}${via}</div>
        <p class="dr-status${auto ? ' busy' : ''}">${yours ? (S.mode === 'mine' ? 'You’re on the clock. Pick a rookie below.' : 'Pick a rookie for this team below, or let the computer pick.') : 'Computer is picking…'}</p>
        <div class="dr-actions">
          ${auto ? `<button type="button" class="btn" data-dr="skip">${S.mode === 'mine' ? 'Skip to my pick' : 'Skip to the end'}</button>${S.mode === 'all' ? '<button type="button" class="btn ghost" data-dr="pause">Pause</button>' : ''}`
                 : `<button type="button" class="btn" data-dr="auto1">Auto-pick this one</button>${S.mode === 'all' ? '<button type="button" class="btn ghost" data-dr="simend">Auto-pick the rest</button>' : ''}`}
          <button type="button" class="btn ghost" data-dr="undo"${S.cur ? '' : ' disabled'}>Undo</button>
          <button type="button" class="btn ghost" data-dr="restart">Start over</button>
        </div>`;
    }

    // available players
    const av = available();
    // which pick the prices are for: the pick on the clock when it's yours to make; in "my team" mode,
    // your next pick (so before the draft starts, or while others pick, you see your own prices)
    let slot = null, slotWhy = '';
    if (S.mode === 'mine') {
      const k = ord.findIndex((o, i) => i >= S.cur && o.owner === S.my);
      if (k >= 0) { slot = ord[k].slot; slotWhy = k === S.cur && S.started ? 'your pick' : 'your next pick'; }
      else if (!done) { slot = cur.slot; slotWhy = 'pick on the clock (you have no picks left)'; }
    } else if (!done) { slot = cur.slot; slotWhy = S.started ? 'pick on the clock' : 'first pick'; }
    const list = av.filter(p => S.pos === 'ALL' || p.pos === S.pos)
      .map(p => ({ p, $: slot == null ? null : price(p, slot) }))
      .sort((a, b) => S.sort === 'price' && slot != null ? (b.$ - a.$) || (a.p.adp - b.p.adp) : (a.p.adp - b.p.adp));
    const canPick = S.started && !done && isMine(ord, S.cur) && !wantsAuto(ord);
    const posBtns = ['ALL', 'QB', 'RB', 'WR', 'TE'].map(x => `<button type="button" data-dr-pos="${x}" aria-pressed="${S.pos === x}">${x === 'ALL' ? 'All' : x}</button>`).join('');
    const rows = list.map(({ p, $ }) => {
      const open = S.openP === p.name;
      return `<li class="${open ? 'open' : ''}">
        <button type="button" class="dr-row" data-dr-open="${esc(p.name)}" aria-expanded="${open}">
          <span class="dr-adp" title="Big-board rank">${p.rank || '—'}</span>
          <span class="dr-nm"><b>${esc(p.name)}</b><small><span class="pos ${p.pos}">${p.pos}</span>${p.school ? ' ' + esc(p.school) : ''}${p.nflPick ? ` · proj NFL ${nflLabel(p.nflPick)}` : (p.custom ? '' : ' · no NFL projection')}${landHtml(p)}${p.custom ? ' · added by you' : ''}</small></span>
          ${$ != null ? `<span class="dr-price" title="Salary if taken at ${slotLabel(slot)}">$${$}</span>` : ''}
        </button>
        ${canPick ? `<button type="button" class="dr-go" data-dr-pick="${esc(p.name)}">Draft</button>` : ''}
        ${open && slot != null ? detail(p, slot) : ''}</li>`;
    }).join('');
    const addForm = canPick ? `<details class="dr-add"><summary>Add a rookie who isn’t listed</summary>
        <div class="dr-add-f"><input id="dr-add-name" placeholder="Name" autocomplete="off">
        <select id="dr-add-pos"><option>RB</option><option>WR</option><option>QB</option><option>TE</option></select>
        <input id="dr-add-nfl" type="number" min="1" max="260" placeholder="Proj. NFL pick (overall)" inputmode="numeric">
        <button type="button" class="btn" data-dr="add">Add and draft</button></div></details>` : '';

    // board: every pick, top to bottom, grouped by round
    const board = ['1', '2', '3', '4'].map(r => {
      const R = ord.filter(o => Math.floor(o.slot / 12) + 1 === +r);
      return `<li class="dr-rh">Round ${r}${r > 2 ? ` <small>$${S.cfg.flatSalaryByRound[r]} each</small>` : ''}</li>` + R.map(o => {
        const i = ord.indexOf(o), p = S.picks[i], now_ = S.started && i === S.cur;
        return `<li class="${now_ ? 'now' : ''}${p ? '' : ' empty'}"><span class="pk">${slotLabel(o.slot)}</span>
          <span class="dr-b">${chip(o.owner)}${p ? `<span class="dr-sel"><b>${esc(p.name)}</b>${posPill(p)} · $${price(p, o.slot)}${landHtml(p)}</span>` : `<span class="dr-sel muted">${now_ ? 'On the clock' : '—'}</span>`}${o.owner !== o.orig ? `<small class="dr-via">via ${esc(nameOf(o.orig))}</small>` : ''}</span></li>`;
      }).join('');
    }).join('');

    // team hauls
    const haul = {};
    ord.forEach((o, i) => { const p = S.picks[i]; if (!p) return; (haul[o.owner] = haul[o.owner] || []).push({ o, p, $: price(p, o.slot) }); });
    const hauls = ids.filter(id => haul[id]).sort((a, b) => (a === S.my ? -1 : b === S.my ? 1 : 0) || nameOf(a).localeCompare(nameOf(b)))
      .map(id => { const h = haul[id], tot = h.reduce((s, x) => s + x.$, 0);
        return `<div class="dr-haul${id === S.my && S.mode === 'mine' ? ' mine' : ''}"><div class="dr-haul-h">${chip(id)}<span>${h.length} pick${h.length > 1 ? 's' : ''} · <b>$${tot}</b></span></div>
          <ul>${h.map(x => `<li><span class="pk">${slotLabel(x.o.slot)}</span>${esc(x.p.name)}${posPill(x.p)}${landHtml(x.p)}<span class="dr-hp">$${x.$}</span></li>`).join('')}</ul></div>`; }).join('');

    const myTot = (haul[S.my] || []).reduce((t, x) => t + x.$, 0);
    const mtabs = [['players', `Players <small>${av.length} left</small>`], ['board', `Draft board <small>${!S.started ? 'not started' : done ? 'final' : `${S.cur}/${ord.length}`}</small>`],
                   ['hauls', `Team hauls${S.mode === 'mine' && haul[S.my] ? ` <small>you $${myTot}</small>` : ''}`]]
      .map(([k, l]) => `<button type="button" role="tab" data-dr-mtab="${k}" aria-selected="${S.mtab === k}">${l}</button>`).join('');
    const d = S.data;
    return `<div class="pagehead"><h1>Rookie Draft</h1><span class="asof">${d.season} mock · order from Week ${now.weeksPlayed} standings · NFL picks ${d.mode === 'final' ? 'final' : 'projected'} (${esc(d.asOf)})</span></div>
      ${S.note ? `<p class="dr-note">${esc(S.note)}</p>` : ''}
      <div class="dr-controls">${teamSel}</div>
      <div class="dr-grid" data-mtab="${S.mtab}">
        <section class="dr-boardwrap" data-panel="board"><h2 class="sec">Draft board <small>${!S.started ? 'not started' : done ? 'final' : `pick ${S.cur + 1} of ${ord.length}`}</small></h2><ol class="card dr-board" id="dr-board">${board}</ol></section>
        <div class="dr-right">
          <section class="card dr-clock">${clock}</section>
          <div class="dr-mtabs" role="tablist" aria-label="Draft views">${mtabs}</div>
          <section class="card dr-players" data-panel="players">
            <div class="dr-filters"><div class="seg" role="group" aria-label="Position">${posBtns}</div>
              <div class="seg" role="group" aria-label="Sort"><button type="button" data-dr-sort="adp" aria-pressed="${S.sort === 'adp'}">Rank</button><button type="button" data-dr-sort="price" aria-pressed="${S.sort === 'price'}"${slot == null ? ' disabled' : ''}>Price</button></div></div>
            ${slot != null ? `<p class="dr-at">Prices at <b>${slotLabel(slot)}</b> · ${slotWhy}. Tap a rookie for the math and his contract.</p>` : ''}
            <ol class="dr-list">${rows || '<li class="muted">No ranked rookies left at this position.</li>'}</ol>${addForm}
            <p class="dr-foot">${av.length} of ${pool().length} rookies left. Ranks: <a href="${esc(S.data.board ? S.data.board.url : '#')}" target="_blank" rel="noopener">${esc(S.data.board ? S.data.board.name : 'rookie board')}</a>. ${S.nflOrder ? `Logos show each rookie’s projected landing spot from <a href="${esc(S.nflOrder.url)}" target="_blank" rel="noopener">Tankathon’s</a> projected NFL order. ` : ''}Prices use the Rookie Pricer formula (${Object.entries(S.cfg.positions).map(([k, v]) => `${k} max $${v.max}`).join(', ')}; rounds 3–4 $${S.cfg.flatSalaryByRound['3']}/$${S.cfg.flatSalaryByRound['4']}). <a href="rookie-pricer/">Open the Rookie Pricer</a></p>
          </section>
        </div>
        <section class="dr-haulsec" data-panel="hauls"><h2 class="sec">Team hauls <small>rookie salaries from this mock</small></h2>
          ${hauls ? `<div class="dr-hauls">${hauls}</div>` : '<p class="muted dr-empty">No picks yet. Hauls fill in as the draft goes.</p>'}</section>
      </div>`;
  }

  /* ---- events ---- */
  function click(e, ctx) {
    const el = e.target.closest('[data-dr],[data-dr-mode],[data-dr-pos],[data-dr-sort],[data-dr-round],[data-dr-pick],[data-dr-mtab],[data-dr-open],[data-dr-taxi]');
    if (!el || !S.cfg) return false;
    const ord = order(ctx.now);
    if (el.dataset.drOpen) { S.openP = S.openP === el.dataset.drOpen ? null : el.dataset.drOpen; return true; }
    if (el.dataset.drTaxi) { const n = el.dataset.drTaxi; S.taxi.has(n) ? S.taxi.delete(n) : S.taxi.add(n); return true; }
    if (el.dataset.drMtab) { S.mtab = el.dataset.drMtab; try { localStorage.setItem('fbp-draft-tab', S.mtab); } catch (x) {} return true; }
    if (el.dataset.drMode) { stop(); S.mode = el.dataset.drMode; S.round = null; save(); }
    else if (el.dataset.drPos) S.pos = el.dataset.drPos;
    else if (el.dataset.drSort) S.sort = el.dataset.drSort;
    else if (el.dataset.drRound) S.round = el.dataset.drRound;
    else if (el.dataset.drPick) { const p = available().find(x => x.name === el.dataset.drPick); if (p) { draft(ord, p); S.round = null; } }
    else {
      const a = el.dataset.dr;
      if (a === 'start') { S.started = true; S.round = null; save(); }
      else if (a === 'auto1' && S.cur < ord.length) { draft(ord, autoPick(ord, S.cur)); S.round = null; }
      else if (a === 'simend') { S.simAll = true; }
      else if (a === 'pause') { stop(); }
      else if (a === 'skip') { clearTimeout(S.timer); S.timer = null; advance(ord, S.mode === 'mine'); S.simAll = false; save(); }
      else if (a === 'undo') {
        stop();
        // step back to the previous pick that was yours (or the previous pick in "everyone" mode)
        do { S.cur = Math.max(0, S.cur - 1); S.picks[S.cur] = null; } while (S.cur > 0 && S.mode === 'mine' && !isMine(ord, S.cur));
        if (S.mode === 'auto') S.mode = 'all';
        S.round = null; save();
      }
      else if (a === 'rerun') { stop(); S.started = true; S.picks = ord.map(() => null); S.cur = 0; S.round = null; save(); }
      else if (a === 'restart') { stop(); S.started = false; S.picks = ord.map(() => null); S.cur = 0; S.note = ''; S.round = null; save(); }
      else if (a === 'add') {
        const nm = (document.getElementById('dr-add-name').value || '').trim();
        if (!nm || taken().has(nm) || pool().some(p => p.name === nm)) return true;
        const p = { name: nm, pos: document.getElementById('dr-add-pos').value, nflPick: +document.getElementById('dr-add-nfl').value || S.cfg.undraftedPick,
                    adp: 99, custom: true, school: '' };
        S.custom.push(p); draft(ord, p); S.round = null;
      }
    }
    return true;
  }
  function change(e) {
    if (e.target.id === 'dr-mode') { stop(); S.mode = e.target.value; S.round = null; save(); return true; }
    if (e.target.id !== 'dr-my') return false;
    stop(); S.started = false; S.my = e.target.value; try { localStorage.setItem('fbp-myteam', S.my); } catch (x) {}
    S.picks = S.picks.map(() => null); S.cur = 0; S.round = null; save();
    return true;
  }
  function after() {
    const box = document.getElementById('dr-board'), now = box && box.querySelector('li.now');
    if (!box || !now) return;
    const top = now.offsetTop - box.offsetTop, h = box.clientHeight;
    if (top < box.scrollTop + 40 || top > box.scrollTop + h - 80) box.scrollTop = Math.max(0, top - h / 3);
  }
  window.FBPDraft = { render, click, change, after };
})();
