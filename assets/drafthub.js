/* Rookie Draft tab, laid out like Tankathon's NFL pages: four sub-tabs.
     #draft        FBP Home: round-1 order (worst first) with movement, record, win%, GB, SOS, streak
                   and what the projected rookie at each pick would cost
     #draft/mock   Mock Draft (assets/draft.js)
     #draft/board  Big Board: the incoming rookie class in depth
     #draft/order  Full Order: all four rounds with traded picks
   Order, records, SOS and movement come from data/league-now.json (scripts/league_now.py); rookies,
   NFL landing spots and prices come from the Rookie Pricer files through FBPDraft.lib. */
window.FBPDraftHub = (() => {
  const H = { pos: 'ALL', adp: null };
  let X;
  const L = () => window.FBPDraft && FBPDraft.lib;
  const esc = s => X.esc(s == null ? '' : s);
  const logo = id => { const t = X.teams[id]; return t && t.logo ? `<img src="${t.logo}" alt="" loading="lazy">` : ''; };
  const abbr = id => (X.teams[id] || {}).abbr || id;
  const pct3 = v => v == null ? '—' : (v >= 1 ? '1.000' : v.toFixed(3).replace(/^0/, ''));
  const streak = s => { const m = /^([WLT])(\d+)$/.exec(s || ''); return m ? `${{ W: 'Won', L: 'Lost', T: 'Tied' }[m[1]]} ${m[2]}` : (s || '—'); };
  const posPill = p => p ? `<span class="pos ${p}">${p}</span>` : '';

  function nav(cur) {
    const items = [['', 'FBP Home'], ['mock', 'Mock Draft'], ['board', 'Big Board'], ['order', 'Full Order']];
    return `<nav class="rf-sub seg dh-nav" aria-label="Rookie Draft">${items.map(([k, l]) => `<a href="#draft${k ? '/' + k : ''}"${k === cur ? ' aria-current="page"' : ''}>${l}</a>`).join('')}</nav>`;
  }
  function head(cur, sub) {
    const now = X.now;
    return `<div class="pagehead"><h1>Rookie Draft</h1><span class="asof">${now.draftYear || ''} rookie draft · order from Week ${now.weeksPlayed} standings${sub ? ' · ' + sub : ''}</span></div>${nav(cur)}`;
  }
  // the rookies in board order, and the consensus ADP from the Rookie Pricer when it has one
  const board = () => L().data().players.slice().sort((a, b) => a.rank - b.rank);
  function loadAdp(rerender) {
    if (H.adp) return;
    H.adp = {};
    fetch('rookie-pricer/players.json', { cache: 'no-cache' }).then(r => r.ok ? r.json() : null)
      .then(d => { (d && d.players || []).forEach(p => { H.adp[p.name] = p.adp; }); rerender(); }).catch(() => {});
  }
  const landing = p => {
    const l = L().landing(p);
    return l ? `<span class="dr-land" title="Projected landing spot: ${esc(l.name)}"><img src="${l.logo}" alt="" loading="lazy" onerror="this.remove()">${esc(l.team)}</span>` : '';
  };

  /* ---------- FBP Home ---------- */
  function pageHome() {
    const now = X.now, lib = L();
    const st = {}; now.standings.forEach(s => { st[s.id] = s; });
    const prev = now.prevDraftOrder, was = {};
    if (prev) prev.order.forEach((id, i) => { was[id] = i + 1; });
    // games back of the worst record (the team furthest from the playoff race)
    const worst = now.standings.slice().sort((a, b) => a.pct - b.pct || a.pf - b.pf)[0];
    const gb = s => { const g = ((s.w - worst.w) + (worst.l - s.l)) / 2; return g ? g.toFixed(1).replace('.0', '') : '—'; };
    const players = board();
    const move = (id, pick) => {
      if (!prev) return '';   // arrows only when a pick moved; no placeholder taking up room
      const d = (was[id] || pick) - pick;   // positive: moved up toward pick 1
      return d > 0 ? `<span class="dh-mv up" title="Up ${d} since week ${prev.week}: a better pick">▲${d}</span>` : d < 0 ? `<span class="dh-mv dn" title="Down ${-d} since week ${prev.week}: a worse pick">▼${-d}</span>` : '';
    };
    const row = d => {
      const s = st[d.id] || {}, slot = d.pick - 1, p = players[slot];
      const traded = d.owner && d.owner !== d.id;
      return `<tr>
        <td class="dh-pk"><b>${d.pick}</b><span class="dh-lg">${logo(d.id)}</span>${move(d.id, d.pick)}</td>
        <td class="t"><span class="dh-tm">${esc(s.name || abbr(d.id))}</span>${traded ? `<small class="dh-trade" title="Traded to ${esc(X.nameOf(d.owner))}">→ ${logo(d.owner)}${esc(abbr(d.owner))}</small>` : ''}</td>
        <td>${s.w}-${s.l}${s.t ? '-' + s.t : ''}</td><td>${pct3(s.pct)}</td><td>${gb(s)}</td><td>${pct3(s.sos)}</td><td>${Number(s.pp || 0).toFixed(1)}</td><td class="dh-stk ${/^L/.test(s.streak || '') ? 'good' : /^W/.test(s.streak || '') ? 'bad' : ''}">${streak(s.streak)}</td>
        <td class="dh-sal">${p ? `<b>$${lib.price(p, slot)}</b><small>${esc(p.name)} ${posPill(p.pos)}</small>` : '—'}</td></tr>`;
    };
    const div = (label, sub) => `<tr class="dh-div"><td colspan="9"><span class="dh-divl">${label}${sub ? `<small>${sub}</small>` : ''}</span></td></tr>`;
    const ord = now.draftOrder || [];
    const non = ord.filter(d => d.basis === 'lowest potential points'), po = ord.filter(d => d.basis !== 'lowest potential points');
    return head('', prev ? `movement since week ${prev.week}` : '') +
      `<section><h2 class="sec">${now.draftYear || ''} rookie draft order <small>round 1; rounds 2–4 repeat it</small></h2>
      <div class="card tbl-wrap"><table class="tbl dh-tbl dh-home"><thead><tr><th class="dh-pk">Pick</th><th class="t">Team</th><th>Record</th><th>Win%</th><th>GB</th><th title="Average win% of the opponents still to play">SOS</th><th title="Potential points: decides picks 1–6">Pot. pts</th><th>Streak</th><th class="dh-sal">Salary</th></tr></thead><tbody>
      ${div('Non-playoff teams', 'lowest potential points picks first')}${non.map(row).join('')}
      ${div('Playoff teams', 'projected finish; champion picks last')}${po.map(row).join('')}
      </tbody></table></div>
      <p class="rf-foot">Salary is what the projected rookie at that pick would cost: the board’s next-best player (<a href="${esc(lib.data().board ? lib.data().board.url : '#')}" target="_blank" rel="noopener">${esc(lib.data().board ? lib.data().board.name : 'rookie board')}</a>), priced with his projected NFL landing spot. GB is games back of the worst record. SOS is the average win% of the opponents still to play. Colors are from the draft’s point of view: green is good for a team’s pick (moving up, losing streaks), red is bad. ${prev ? '' : 'Movement arrows start after Monday night’s refresh, the first week with a saved order to compare against.'}</p></section>
      <div class="grid2">
      <section><h2 class="sec">How the order works</h2><div class="card dh-rules"><ol>
        <li>Picks 1–6 go to the six non-playoff teams, lowest potential points first. Ties: lower total points, then fewer all-play wins.</li>
        <li>Picks 7–12 go to the playoff teams by finish: round-1 losers (worse seed first), 4th, 3rd, runner-up, then the champion at 12.</li>
        <li>Until the playoffs are played, picks 7–12 are projected by seed.</li>
        <li>Rounds 2–4 use the same order. Traded picks stay where the original team’s finish puts them.</li>
      </ol><p class="rf-foot">Full rules on the <a href="#bylaws">By-Laws</a> tab.</p></div></section>
      <section><h2 class="sec">Top of the board <small><a href="#draft/board">Big Board</a></small></h2><div class="card dh-top">
        ${players.slice(0, 6).map(p => `<div class="dh-toprow"><span class="n">${p.rank}</span><span><b>${esc(p.name)}</b> ${posPill(p.pos)}<small>${esc(p.school || '')}</small></span>${landing(p)}</div>`).join('')}
      </div></section></div>`;
  }

  /* ---------- Big Board ---------- */
  function pageBoard() {
    const lib = L(), C = lib.cfg(), all = board();
    const posRank = {}, seen = {};
    all.forEach(p => { seen[p.pos] = (seen[p.pos] || 0) + 1; posRank[p.name] = p.pos + seen[p.pos]; });
    const list = all.filter(p => H.pos === 'ALL' || p.pos === H.pos);
    const groups = [[1, 12, 'Projected round 1'], [13, 24, 'Projected round 2'], [25, 36, 'Projected round 3'], [37, 48, 'Projected round 4'], [49, 999, 'Beyond pick 48']];
    const row = p => {
      const slot = p.rank - 1, at = slot < 48 ? lib.slotLabel(slot) : '—';
      const adp = H.adp && H.adp[p.name];
      return `<tr><td class="dh-rk">${p.rank}</td><td class="t"><b>${esc(p.name)}</b> ${posPill(p.pos)}<small class="rf-by">${esc(p.school || '')} · ${posRank[p.name]}</small></td>
        <td>${adp != null ? adp.toFixed(1) : '—'}</td>
        <td><span class="dh-nfl">${lib.nflLabel(p.nflPick)}${landing(p)}</span></td>
        <td>${at}</td><td><b>${slot < 48 ? '$' + lib.price(p, slot) : '—'}</b></td><td>$${lib.price(p, 0)}</td></tr>`;
    };
    const body = groups.map(([a, b, label]) => { const g = list.filter(p => p.rank >= a && p.rank <= b); return g.length ? `<tr class="dh-div"><td colspan="7">${label}<small>${a <= 48 ? `board ranks ${a}–${Math.min(b, all.length)}` : 'priced as a late pick'}</small></td></tr>${g.map(row).join('')}` : ''; }).join('');
    const posBtns = ['ALL', 'QB', 'RB', 'WR', 'TE'].map(k => `<button type="button" data-dh-pos="${k}" aria-pressed="${H.pos === k}">${k === 'ALL' ? 'All' : k}</button>`).join('');
    const counts = ['QB', 'RB', 'WR', 'TE'].map(k => `${all.filter(p => p.pos === k).length} ${k}`).join(' · ');
    return head('board', `${all.length} rookies`) +
      `<section><div class="dh-bar"><div class="seg" role="group" aria-label="Position">${posBtns}</div><span class="rf-foot">${counts}</span></div>
      <div class="card tbl-wrap"><table class="tbl rf-t dh-tbl"><thead><tr><th>#</th><th class="t">Rookie</th><th title="Average draft position across the Rookie Pricer’s boards">ADP</th><th title="Projected NFL pick and landing team">NFL</th><th title="Where he goes if the draft follows the board">FBP pick</th><th title="His salary at that FBP pick">Salary</th><th title="His salary if taken 1.01">At 1.01</th></tr></thead>
      <tbody>${body || '<tr><td colspan="7" class="muted">No rookies at this position.</td></tr>'}</tbody></table></div>
      <p class="rf-foot">Order: <a href="${esc(lib.data().board ? lib.data().board.url : '#')}" target="_blank" rel="noopener">${esc(lib.data().board ? lib.data().board.name : 'rookie board')}</a>. ADP is the Rookie Pricer’s blend of rookie boards. NFL picks and landing spots: the Rookie Pricer’s mock-draft sources and ${lib.nflOrder() ? `<a href="${esc(lib.nflOrder().url)}" target="_blank" rel="noopener">Tankathon’s</a> projected order` : 'Tankathon’s projected order'}. Salaries use the 2027 formula (${Object.entries(C.positions).map(([k, v]) => `${k} max $${v.max}`).join(', ')}; $${C.minimumRounds1to2} minimum in rounds 1–2; rounds 3–4 $${C.flatSalaryByRound['3']}/$${C.flatSalaryByRound['4']}).</p></section>`;
  }

  /* ---------- Full Order ---------- */
  function pageOrder() {
    const now = X.now, R = now.draftRounds || {};
    const name = id => X.nameOf(id);
    const rounds = ['1', '2', '3', '4'].map(r => `<section class="card dh-round"><h3>Round ${r}</h3><ol>${(R[r] || []).map(p => {
      const traded = p.owner !== p.id;
      return `<li class="${traded ? 'traded' : ''}"><span class="pk">${r}.${String(p.pick).padStart(2, '0')}</span>${logo(p.owner)}<span class="who"><b>${esc(name(p.owner))}</b>${traded ? `<small>via ${logo(p.id)}${esc(name(p.id))}</small>` : ''}</span>${traded ? '<span class="dh-tr">Traded</span>' : ''}</li>`;
    }).join('')}</ol></section>`).join('');
    const by = {};
    ['1', '2', '3', '4'].forEach(r => (R[r] || []).forEach(p => { (by[p.owner] = by[p.owner] || []).push(`${r}.${String(p.pick).padStart(2, '0')}`); }));
    const ids = Object.keys(X.teams).sort((a, b) => (by[b] || []).length - (by[a] || []).length || name(a).localeCompare(name(b)));
    const tradedN = ['1', '2', '3', '4'].reduce((n, r) => n + (R[r] || []).filter(p => p.owner !== p.id).length, 0);
    return head('order', `${tradedN} traded pick${tradedN === 1 ? '' : 's'}`) +
      `<div class="dh-rounds">${rounds}</div>
      <section><h2 class="sec">Picks by team</h2><div class="card tbl-wrap"><table class="tbl dh-tbl"><thead><tr><th class="lg"><span class="sr">Logo</span></th><th class="t">Team</th><th>Picks</th><th class="t">Which</th></tr></thead><tbody>
      ${ids.map(id => `<tr><td class="lg">${logo(id)}</td><td class="t">${esc(name(id))}</td><td>${(by[id] || []).length}</td><td class="t dh-which">${(by[id] || []).join(' · ') || '—'}</td></tr>`).join('')}
      </tbody></table></div><p class="rf-foot">Pick owners come from MFL’s future draft picks, refreshed weekly. Picks 7–12 in each round are projected by playoff seed until the playoffs are played.</p></section>`;
  }

  function render(ctx, sub) {
    X = ctx;
    if (!ctx.now) return '<p class="error">League data didn’t load. Refresh the page to try again.</p>';
    if (!L()) return '<p class="error">The draft tools didn’t load.</p>';
    if (L().failed()) return '<p class="error">The rookie list didn’t load. Refresh the page to try again.</p>';
    if (!L().ready()) { L().load(ctx.rerender); return head(sub || '') + '<p class="loading">Loading the rookie class…</p>'; }
    if (sub === 'board') { loadAdp(ctx.rerender); return pageBoard(); }
    if (sub === 'order') return pageOrder();
    return pageHome();
  }
  function click(e) {
    const b = e.target.closest('[data-dh-pos]');
    if (!b) return false;
    H.pos = b.dataset.dhPos; return true;
  }
  return { render, nav, click };
})();
