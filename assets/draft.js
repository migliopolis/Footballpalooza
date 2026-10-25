/* Rookie Draft mock: the hub's #draft tab.
   Draft order and pick owners come from data/league-now.json (draftRounds); rookies, projected NFL
   picks and the salary formula come from the Rookie Pricer (rookie-pricer/players.json, pricing.json).
   Exposes window.FBPDraft.render(ctx) and .click(e, ctx); site.js routes to it. */
(() => {
  const KEY = 'fbp-mock-2027';
  const S = { cfg: null, data: null, loading: false, err: null, mode: 'mine', my: '', picks: [], custom: [],
              cur: 0, pos: 'ALL', sort: 'adp', round: null, sig: '', note: '' };
  try { const m = localStorage.getItem('fbp-myteam'); if (m) S.my = m; } catch (e) {}

  /* ---- price formula (same as the Rookie Pricer) ---- */
  const interp = (a, p) => {
    if (p <= a[0][0]) return a[0][1];
    if (p >= a[a.length - 1][0]) return a[a.length - 1][1];
    for (let i = 0; i < a.length - 1; i++) { const [p0, f0] = a[i], [p1, f1] = a[i + 1]; if (p <= p1) return f0 + (f1 - f0) * (p - p0) / (p1 - p0); }
  };
  function price(pl, slot) {   // slot 0..47 (1.01 = 0)
    const C = S.cfg, round = Math.floor(slot / 12) + 1;
    if (round > 2) return C.flatSalaryByRound[String(round)] ?? 1;
    const c = C.positions[pl.pos];
    if (!c) return C.minimumRounds1to2;
    const raw = c.max * interp(c.nfl, pl.nflPick || C.undraftedPick) * c.fbp[slot];
    return Math.max(C.minimumRounds1to2, Math.floor(raw + 0.5));
  }
  const slotLabel = s => `${Math.floor(s / 12) + 1}.${String(s % 12 + 1).padStart(2, '0')}`;
  const nflLabel = p => !p || p >= S.cfg.undraftedPick ? 'UDFA' : `${Math.ceil(p / 32)}.${String((p - 1) % 32 + 1).padStart(2, '0')}`;

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
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify({ sig: S.sig, mode: S.mode, picks: S.picks.map(p => p ? p.name : null), custom: S.custom })); } catch (e) {}
  }
  function restore(ord) {
    S.sig = ord.map(o => o.owner).join(',');
    S.picks = ord.map(() => null); S.cur = 0;
    try {
      const sv = JSON.parse(localStorage.getItem(KEY) || 'null');
      if (sv && sv.picks) {
        S.custom = sv.custom || [];
        if (sv.sig !== S.sig) { S.note = 'The draft order changed since your last mock (new standings or a pick trade), so it was reset.'; }
        else {
          const by = new Map(pool().map(p => [p.name, p]));
          S.picks = sv.picks.map(n => n == null ? null : (by.get(n) || { name: n, pos: '', unranked: true }));
          S.mode = sv.mode || S.mode;
          S.cur = S.picks.findIndex(p => !p); if (S.cur < 0) S.cur = S.picks.length;
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
  function draft(ord, player) { S.picks[S.cur] = player; S.cur++; if (S.mode !== 'all') advance(ord); save(); }

  /* ---- loading ---- */
  function load(rerender) {
    if (S.loading || S.cfg) return;
    S.loading = true;
    Promise.all(['rookie-pricer/pricing.json', 'rookie-pricer/players.json'].map(u => fetch(u, { cache: 'no-cache' }).then(r => { if (!r.ok) throw new Error(u); return r.json(); })))
      .then(([c, d]) => { S.cfg = c; S.data = d; S.loading = false; rerender(); })
      .catch(e => { S.err = String(e); S.loading = false; rerender(); });
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
    if (S.mode === 'auto' && S.cur < ord.length) { advance(ord, false); save(); }
    if (S.mode === 'mine' && S.cur < ord.length && !isMine(ord, S.cur)) { advance(ord); save(); }
    const done = S.cur >= ord.length;
    const cur = ord[S.cur];
    const ids = Object.keys(teams).sort((a, b) => nameOf(a).localeCompare(nameOf(b)));

    const modes = [['mine', 'Pick for my team'], ['all', 'I pick for everyone'], ['auto', 'Auto-mock the league']]
      .map(([m, l]) => `<button type="button" data-dr-mode="${m}" aria-pressed="${S.mode === m}">${l}</button>`).join('');
    const teamSel = `<label class="dr-team"${S.mode === 'mine' ? '' : ' hidden'}><span>My team</span>
      <select id="dr-my">${ids.map(id => `<option value="${id}"${id === S.my ? ' selected' : ''}>${esc(nameOf(id))}</option>`).join('')}</select></label>`;

    // on the clock
    let clock;
    if (done) {
      clock = `<div class="dr-clock-h"><b>Draft complete</b><span>${ord.length} picks</span></div>
        <div class="dr-actions"><button type="button" class="btn" data-dr="restart">${S.mode === 'auto' ? 'Run another mock' : 'Start over'}</button><button type="button" class="btn ghost" data-dr="undo">Undo last pick</button></div>`;
    } else {
      const via = cur.owner !== cur.orig ? `<span class="dr-via">via ${esc(nameOf(cur.orig))}</span>` : '';
      const yours = isMine(ord, S.cur);
      clock = `<div class="dr-clock-h"><span class="dr-pk">${slotLabel(cur.slot)}</span>${chip(cur.owner)}${via}</div>
        <p class="dr-status">${yours ? (S.mode === 'mine' ? 'You’re on the clock. Pick a rookie below.' : 'Pick a rookie for this team below, or let the computer pick.') : 'Auto-picking…'}</p>
        <div class="dr-actions">
          <button type="button" class="btn" data-dr="auto1">Auto-pick this one</button>
          ${S.mode === 'all' ? '<button type="button" class="btn ghost" data-dr="simend">Auto-pick the rest</button>' : ''}
          <button type="button" class="btn ghost" data-dr="undo"${S.cur ? '' : ' disabled'}>Undo</button>
          <button type="button" class="btn ghost" data-dr="restart">Start over</button>
        </div>`;
    }

    // available players
    const av = available();
    const slot = done ? null : cur.slot;
    const list = av.filter(p => S.pos === 'ALL' || p.pos === S.pos)
      .map(p => ({ p, $: slot == null ? null : price(p, slot) }))
      .sort((a, b) => S.sort === 'price' && slot != null ? (b.$ - a.$) || (a.p.adp - b.p.adp) : (a.p.adp - b.p.adp));
    const canPick = !done && isMine(ord, S.cur);
    const posBtns = ['ALL', 'QB', 'RB', 'WR', 'TE'].map(x => `<button type="button" data-dr-pos="${x}" aria-pressed="${S.pos === x}">${x === 'ALL' ? 'All' : x}</button>`).join('');
    const rows = list.map(({ p, $ }) => `<li>
        <span class="dr-adp" title="Average rookie-draft position">${p.adp != null ? p.adp.toFixed(1) : '—'}</span>
        <span class="dr-nm"><b>${esc(p.name)}</b><small><span class="pos ${p.pos}">${p.pos}</span>${p.school ? ' ' + esc(p.school) : ''}${p.nflPick ? ` · proj NFL ${nflLabel(p.nflPick)}` : ''}${p.custom ? ' · added by you' : ''}</small></span>
        ${$ != null ? `<span class="dr-price" title="Salary if taken at ${slotLabel(slot)}">$${$}</span>` : ''}
        ${canPick ? `<button type="button" class="dr-go" data-dr-pick="${esc(p.name)}">Draft</button>` : ''}</li>`).join('');
    const addForm = canPick ? `<details class="dr-add"><summary>Add a rookie who isn’t listed</summary>
        <div class="dr-add-f"><input id="dr-add-name" placeholder="Name" autocomplete="off">
        <select id="dr-add-pos"><option>RB</option><option>WR</option><option>QB</option><option>TE</option></select>
        <input id="dr-add-nfl" type="number" min="1" max="260" placeholder="Proj. NFL pick (overall)" inputmode="numeric">
        <button type="button" class="btn" data-dr="add">Add and draft</button></div></details>` : '';

    // board: every pick, top to bottom, grouped by round
    const board = ['1', '2', '3', '4'].map(r => {
      const R = ord.filter(o => Math.floor(o.slot / 12) + 1 === +r);
      return `<li class="dr-rh">Round ${r}${r > 2 ? ` <small>$${S.cfg.flatSalaryByRound[r]} each</small>` : ''}</li>` + R.map(o => {
        const i = ord.indexOf(o), p = S.picks[i], now_ = i === S.cur;
        return `<li class="${now_ ? 'now' : ''}${p ? '' : ' empty'}"><span class="pk">${slotLabel(o.slot)}</span>
          <span class="dr-b">${chip(o.owner)}${p ? `<span class="dr-sel"><b>${esc(p.name)}</b>${posPill(p)} · $${price(p, o.slot)}</span>` : `<span class="dr-sel muted">${now_ ? 'On the clock' : '—'}</span>`}${o.owner !== o.orig ? `<small class="dr-via">via ${esc(nameOf(o.orig))}</small>` : ''}</span></li>`;
      }).join('');
    }).join('');

    // team hauls
    const haul = {};
    ord.forEach((o, i) => { const p = S.picks[i]; if (!p) return; (haul[o.owner] = haul[o.owner] || []).push({ o, p, $: price(p, o.slot) }); });
    const hauls = ids.filter(id => haul[id]).sort((a, b) => (a === S.my ? -1 : b === S.my ? 1 : 0) || nameOf(a).localeCompare(nameOf(b)))
      .map(id => { const h = haul[id], tot = h.reduce((s, x) => s + x.$, 0);
        return `<div class="dr-haul${id === S.my && S.mode === 'mine' ? ' mine' : ''}"><div class="dr-haul-h">${chip(id)}<span>${h.length} pick${h.length > 1 ? 's' : ''} · <b>$${tot}</b></span></div>
          <ul>${h.map(x => `<li><span class="pk">${slotLabel(x.o.slot)}</span>${esc(x.p.name)}${posPill(x.p)}<span class="dr-hp">$${x.$}</span></li>`).join('')}</ul></div>`; }).join('');

    const d = S.data;
    return `<div class="pagehead"><h1>Rookie Draft</h1><span class="asof">${d.season} mock · order from Week ${now.weeksPlayed} standings · NFL picks ${d.mode === 'final' ? 'final' : 'projected'} (${esc(d.asOf)})</span></div>
      ${S.note ? `<p class="dr-note">${esc(S.note)}</p>` : ''}
      <div class="dr-controls"><div class="seg dr-modes" role="group" aria-label="Mock draft mode">${modes}</div>${teamSel}</div>
      <div class="dr-grid">
        <section class="card dr-clock">${clock}
          <div class="dr-filters"><div class="seg" role="group" aria-label="Position">${posBtns}</div>
            <div class="seg" role="group" aria-label="Sort"><button type="button" data-dr-sort="adp" aria-pressed="${S.sort === 'adp'}">Rank</button><button type="button" data-dr-sort="price" aria-pressed="${S.sort === 'price'}"${slot == null ? ' disabled' : ''}>Price</button></div></div>
          <ol class="dr-list">${rows || '<li class="muted">No ranked rookies left at this position.</li>'}</ol>${addForm}
          <p class="dr-foot">${av.length} of ${pool().length} ranked rookies left. Prices use the Rookie Pricer formula (${Object.entries(S.cfg.positions).map(([k, v]) => `${k} max $${v.max}`).join(', ')}; rounds 3–4 $${S.cfg.flatSalaryByRound['3']}/$${S.cfg.flatSalaryByRound['4']}). <a href="rookie-pricer/">Open the Rookie Pricer</a></p>
        </section>
        <section class="dr-boardwrap"><h2 class="sec">Draft board <small>${done ? 'final' : `pick ${S.cur + 1} of ${ord.length}`}</small></h2><ol class="card dr-board" id="dr-board">${board}</ol></section>
      </div>
      ${hauls ? `<section><h2 class="sec">Team hauls <small>rookie salaries from this mock</small></h2><div class="dr-hauls">${hauls}</div></section>` : ''}`;
  }

  /* ---- events ---- */
  function click(e, ctx) {
    const el = e.target.closest('[data-dr],[data-dr-mode],[data-dr-pos],[data-dr-sort],[data-dr-round],[data-dr-pick]');
    if (!el || !S.cfg) return false;
    const ord = order(ctx.now);
    if (el.dataset.drMode) { S.mode = el.dataset.drMode; S.round = null; save(); }
    else if (el.dataset.drPos) S.pos = el.dataset.drPos;
    else if (el.dataset.drSort) S.sort = el.dataset.drSort;
    else if (el.dataset.drRound) S.round = el.dataset.drRound;
    else if (el.dataset.drPick) { const p = available().find(x => x.name === el.dataset.drPick); if (p) { draft(ord, p); S.round = null; } }
    else {
      const a = el.dataset.dr;
      if (a === 'auto1' && S.cur < ord.length) { draft(ord, autoPick(ord, S.cur)); S.round = null; }
      else if (a === 'simend') { advance(ord, false); save(); S.round = null; }
      else if (a === 'undo') {
        // step back to the previous pick that was yours (or the previous pick in "everyone" mode)
        do { S.cur = Math.max(0, S.cur - 1); S.picks[S.cur] = null; } while (S.cur > 0 && S.mode === 'mine' && !isMine(ord, S.cur));
        if (S.mode === 'auto') S.mode = 'all';
        S.round = null; save();
      }
      else if (a === 'restart') { S.picks = ord.map(() => null); S.cur = 0; S.note = ''; S.round = null; save(); }
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
    if (e.target.id !== 'dr-my') return false;
    S.my = e.target.value; try { localStorage.setItem('fbp-myteam', S.my); } catch (x) {}
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
