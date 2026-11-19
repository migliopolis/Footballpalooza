/* League Now > Trading Floor (#now/trade; it started in Beta, and #beta/trade still lands here): a resource for owners thinking about a trade.
   Data: data/trading-floor.json, built by scripts/trading_floor.py on each refresh (MFL rosters, contracts, picks,
   trades since 2019 and Trade Bait; playoff odds from League Now; Trade Value leads, with the FBP OVR alongside).
   Facts only: nothing here grades a player, a contract or an owner.
   Exposes window.FBPTrade.render(ctx) and .after(); site.js routes #now/trade here. Players on the trade block
   carry a TRADE chip (FBPU.tbChip) here and everywhere else on the site. */
window.FBPTrade = (function () {
  let D = null, failed = false, loading = false, X = null;
  let view = 'block', kind = '', hsort = 'new', pos = 'ALL', withCont = false, q = '', season = '', teamSel = '', tick = null;
  const esc = s => (X && X.esc ? X.esc(s) : String(s == null ? '' : s));
  const redraw = () => { const y = window.scrollY; if (X && X.rerender) { X.rerender(); window.scrollTo(0, y); } };
  const nm = f => (X && X.nameOf ? X.nameOf(f) : (D && D.teams[f] ? D.teams[f].name : f));
  const fold = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

  function load() {
    if (D || loading || failed) return;
    loading = true;
    FBPU.json('data/trading-floor.json').then(j => j == null ? Promise.reject() : j)
      .then(d => { D = d; loading = false; redraw(); }, () => { failed = true; loading = false; redraw(); });
  }

  /* ---------- bits ---------- */
  const tier = o => o == null ? 'n' : o >= 90 ? 'h' : o >= 80 ? 'g' : o >= 70 ? 's' : 'b';
  const money = v => v == null ? '–' : '$' + Math.round(v);
  const OUT = { 'Contending': 'tf-con', 'In the mix': 'tf-mix', 'Building': 'tf-bld' };
  const outChip = f => { const t = D.teams[f]; return t && t.outlook ? `<span class="tf-out ${OUT[t.outlook]}" title="${t.playoff}% playoff odds">${t.outlook}</span>` : ''; };
  const logo = f => { const t = X && X.teams && X.teams[f]; return t && t.logo ? `<img class="tf-logo" src="${esc(t.logo)}" alt="" loading="lazy">` : ''; };
  const date = ts => new Date(ts * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'America/New_York' });
  function contract(p) {
    if (p.st === 'TAXI_SQUAD') return `${money(p.sal)} taxi${p.n27 != null ? ` → ${money(p.n27)} in 2027` : ''}`;
    if (p.exp) return `${money(p.sal)} · <b>expires after 2026</b>`;
    return `${money(p.sal)}${p.cy ? ` (${esc(p.cy)})` : ''} → <b>${money(p.n27)}</b> in 2027`;
  }
  // NFL team logo (MFL codes to ESPN's)
  const nflLg = t => t && t !== 'FA' ? `<img class="tf-nfl" src="https://a.espncdn.com/i/teamlogos/nfl/500/${FBPU.nflAbbr(t).toLowerCase()}.png" alt="${esc(t)}" title="${esc(t)}" loading="lazy" onerror="this.replaceWith(document.createTextNode('${esc(t)} · '))">` : '';
  function prow(p, extra) {
    const href = `#now/team/${p.f}/${p.id}`;
    return `<li class="tf-p"><span class="tf-lead">${p.e ? `<span class="tf-ph tcr${FBPU.ovc(p.id)}" style="background-image:url(${FBPU.headshot(p.e)}),var(--ovg,var(--ov0));${FBPU.tc(p.f)}"></span>` : ''}<span class="tf-tv" title="Trade Value"><small>Trade</small>${p.tv == null ? '–' : Number(p.tv).toLocaleString()}<small>Value</small></span></span>
      <div class="tf-pm"><a href="${href}"><b>${esc(p.n)}</b></a>${FBPU.tbChip(p.id)}${p.o != null ? ` <span class="tf-o tf-${tier(p.o)}" title="FBP OVR">${p.o}</span>` : ''} <span class="tf-sub">${p.p}${p.r ? p.r : ''}</span>
      <div class="tf-sub tf-bio">${nflLg(p.nfl)}${[p.age ? 'age ' + p.age : '', p.ppg != null ? p.ppg + ' ppg' : ''].filter(Boolean).join(' · ')}</div>
      <div class="tf-sub tf-tm">${logo(p.f)}${esc(nm(p.f))} ${outChip(p.f)}</div>
      <div class="tf-c">${contract(p)}${extra ? ' · ' + extra : ''}</div></div></li>`;
  }
  const ordN = FBPU.ord;
  const posOk = p => pos === 'ALL' || p.p === pos;
  const contOk = p => withCont || !(D.teams[p.f] || {}).seed;   // teams in a playoff spot are left out unless asked for
  const seg = (attr, cur, opts) => `<div class="seg tf-seg">${opts.map(([k, l]) => `<button type="button" data-${attr}="${k}" aria-pressed="${k === cur}">${l}</button>`).join('')}</div>`;
  const posSeg = () => seg('tfp', pos, [['ALL', 'All'], ['QB', 'QB'], ['RB', 'RB'], ['WR', 'WR'], ['TE', 'TE']]);
  const contToggle = () => `<label class="tf-chk"><input type="checkbox" data-tfc="1"${withCont ? ' checked' : ''}> Include playoff teams</label>`;

  /* ---------- deadline ---------- */
  function countdown() {
    const ms = Date.parse(D.deadline) - Date.now();
    if (ms <= 0) return 'In-season trading is closed. It reopens at the start of the new league year and runs up to keeper day.';
    const d = Math.floor(ms / 864e5), h = Math.floor(ms % 864e5 / 36e5), m = Math.floor(ms % 36e5 / 6e4);
    return `<b>${d ? d + 'd ' : ''}${h}h ${m}m</b> to the trade deadline, Thursday, Dec 3 at 12 PM EST`;
  }

  /* ---------- views ---------- */
  function vBlock() {
    if (!D.blockOn) return `<div class="tf-empty"><p>The trade block reads MFL’s <b>Trade Bait</b> list, which every owner can fill in from his team page in MFL. It switches on with the next data refresh.</p></div>`;
    if (!D.block.length) return `<div class="tf-empty"><p>Nobody’s on the block right now.</p><p class="tf-sub">To put a player or pick on the block, open your team in MFL and use <b>Trade Bait</b>. It shows up here on the next refresh.</p></div>`;
    return D.block.map(b => `<section class="tf-card"><h3>${logo(b.f)}${esc(nm(b.f))} ${outChip(b.f)}</h3>
      ${b.ts ? `<p class="tf-sub">Updated ${date(b.ts)}</p>` : ''}
      <ul class="tf-list">${b.items.map(x => (x.k === 'p' || x.id) && x.f ? prow(x) : `<li class="tf-p"><span class="tf-ovr tf-n">${x.k === 'pick' ? 'PK' : '–'}</span><div class="tf-pm"><b>${esc(x.t)}</b></div></li>`).join('')}</ul>
      ${b.wants ? `<p class="tf-wants"><span>Looking for</span> ${esc(b.wants)}</p>` : ''}</section>`).join('');
  }

  function vTargets() {
    const T = D.targets;
    const good = T.goodOnNonContenders.filter(posOk);
    const box = (T.outsideBox || []).filter(posOk);
    const ord = FBPU.ord;
    const whyTxt = (p, w) => w.k === 'depth' ? `<span class="tf-why-c">Depth</span> his team’s ${ord(w.rank)}-best ${p.p}`
      : w.k === 'qb' ? `<span class="tf-why-c">QB limit</span> one of ${w.n} veteran QBs for 2 keeper spots`
      : `<span class="tf-why-c">Cap</span> doesn’t fit the 2027 budget, ${money(w.over)} over`;
    const sellTxt = (p, w) => w.k === 'exp' ? `<span class="tf-why-c">Expiring</span> contract ends after this season`
      : w.k === 'cost' ? `<span class="tf-why-c">Cost</span> ${money(p.n27)} in 2027; he’d go for about ${money(w.mkt)} at auction`
      : w.k === 'hot' ? `<span class="tf-why-c">Sell high</span> producing well above his long-term value${p.ppg != null ? ` (${p.ppg} ppg)` : ''}`
      : `<span class="tf-why-c">Sell high</span> age ${p.age}; ${p.p}s peak around ${w.peak}`;
    const sellRow = p => prow(p).replace('</div></div></li>', `</div><div class="tf-whys">${(p.why || []).map(w => `<div>${sellTxt(p, w)}</div>`).join('')}</div></div></li>`);
    const boxRow = p => prow(p).replace('</div></div></li>', `</div><div class="tf-whys">${(p.why || []).map(w => `<div>${whyTxt(p, w)}</div>`).join('')}</div></div></li>`);
    const exp = T.expiring.filter(posOk).filter(contOk);
    const rai = T.raises.filter(posOk).filter(contOk);
    const list = (a, extra) => a.length ? `<ul class="tf-list">${a.map(p => prow(p, extra && extra(p))).join('')}</ul>` : '<p class="tf-sub">Nobody right now.</p>';
    const crunch = T.crunch.map(c => {
      const t = D.teams[c.f];
      const head = c.kind === 'cap'
        ? `Keeping all ${t.keepN} of its players rated 75+ would cost <b>${money(t.keepCost)}</b> in 2027 against a <b>${money(t.cap27)}</b> budget, <b>${money(c.over)} over</b>. Some of them will have to go.`
        : `<b>${c.n} veteran QBs</b> rated 70+ under contract for 2027, and only 2 can be kept. ${c.n - 2 === 1 ? 'One of them has to go.' : `${c.n - 2} of them have to go.`}${c.qbx ? ` ${esc(c.qbx)} spent his rookie season on taxi, so he can be kept as a 3rd QB and isn’t counted.` : ''}`;
      return `<li class="tf-cr"><h4>${logo(c.f)}${esc(nm(c.f))} ${outChip(c.f)} <span class="tf-tag">${c.kind === 'cap' ? 'Cap' : 'QB limit'}</span></h4><p>${head}</p>
        <p class="tf-sub">${c.kind === 'cap' ? 'Biggest 2027 salaries' : 'The QBs'}: ${c.list.map(p => `${esc(p.n)} <span class="tf-sub">${p.p}, Trade Value ${p.tv == null ? '–' : Number(p.tv).toLocaleString()}</span> ${money(p.n27)}`).join(' · ')}</p></li>`;
    }).join('');
    return `${posSeg()}
     <section class="tf-sec"><h3>Sell candidates</h3><p class="tf-why">Players on the teams out of a playoff spot that a rebuilding owner has a reason to move now instead of carrying into next season: an expiring contract, a 2027 salary over what he’d go for at auction, production well above his long-term value, or an age at or past his position’s peak while his Trade Value is still high. By Trade Value, which weighs what a player is doing now for the playoff run.</p>${good.length ? `<ul class="tf-list">${good.map(sellRow).join('')}</ul>` : '<p class="tf-sub">Nobody right now.</p>'}</section>
     <section class="tf-sec"><h3>Thinking outside the box</h3><p class="tf-why">Players on playoff teams with a reason their team might still move them: more good players at his spot than the team starts in 2027, a third keeper-worthy QB, or a 2027 keeper bill over budget where he’s one who doesn’t fit.</p>${box.length ? `<ul class="tf-list">${box.map(boxRow).join('')}</ul>` : '<p class="tf-sub">Nobody right now.</p>'}</section>
     <section class="tf-sec"><h3>Expiring deals</h3><p class="tf-why">Contracts that end after this season. A team that won’t keep him may rather get something for him now.</p>${contToggle()}${list(exp)}</section>
     <section class="tf-sec"><h3>Big 2027 raises</h3><p class="tf-why">2027 salary of $20 or more, up $5 or more from this year.</p>${contToggle()}${list(rai, p => `+${money(p.n27 - p.sal)}`)}</section>
     <section class="tf-sec"><h3>Keeper crunches</h3><p class="tf-why">Teams that can’t keep everyone worth keeping, by the $${D.cap} cap (keepers plus $1 per open roster spot, adjusted for auction cash traded) or the 2-QB keeper limit.</p>${crunch ? `<ul class="tf-crl">${crunch}</ul>` : '<p class="tf-sub">Nobody right now.</p>'}</section>`;
  }

  function vTeams() {
    const ids = Object.keys(D.teams).sort((a, b) => (D.teams[b].playoff || 0) - (D.teams[a].playoff || 0));
    return `<p class="tf-why">Sorted by playoff odds. Trade Value is the team’s total and league rank, and each position shows its Trade Value rank. <b>Good</b> counts players rated 80+ OVR; a team is deep with one more than its lineup needs and thin with fewer. Help for a need comes from teams deep there; two playoff teams are only matched when each is deep where the other is thin. 2027 shows what keeping every player rated 75+ would cost against the team’s budget (the $200 cap, adjusted for auction cash traded).</p>
     <div class="tf-teams">${ids.map(f => {
      const t = D.teams[f], h = D.habits[f] || {};
      // partners for a need: a team deep there. Two playoff teams only match when each is deep where the other is thin
      const po = g => !!D.teams[g].seed;
      const need = t.thin.map(p => {
        const who = ids.filter(g => g !== f && D.teams[g].deep.includes(p)).map(g => {
          if (!(po(f) && po(g))) return esc(nm(g));
          const back = D.teams[g].thin.filter(q => t.deep.includes(q));
          return back.length ? `${esc(nm(g))} <span class="tf-sub">(needs your ${back.join(', ')})</span>` : '';
        }).filter(Boolean);
        return `<li><b>Could use help at ${p}.</b> ${who.length ? 'Deep there: ' + who.join(', ') : 'No good match right now.'}</li>`; }).join('');
      const picks = (t.picks || []).filter(p => p.y <= 2028);
      const pyear = y => { const a = picks.filter(p => p.y === y); return a.length ? `<span><b>${y}</b> ${a.map(p => `${['', '1st', '2nd', '3rd', '4th'][p.r]}${p.from !== f ? `<small> (${esc(nm(p.from))})</small>` : ''}`).join(', ')}</span>` : `<span><b>${y}</b> none</span>`; };
      return `<section class="tf-card${f === (X && X.myTeam) ? ' tf-mine' : ''}"><h3>${logo(f)}${esc(nm(f))} ${outChip(f)}</h3>
       <p class="tf-sub">${(t.rec || []).slice(0, 2).join('–')} · ${t.playoff == null ? '' : t.playoff + '% playoff odds · '}${t.tv ? `Trade Value ${Number(t.tv).toLocaleString()} (${ordN(t.tvR)}) · ` : ''}${h.this || 0} trade${h.this === 1 ? '' : 's'} this season</p>
       <div class="tf-depth">${['QB', 'RB', 'WR', 'TE'].map(p => { const g = t.depth[p].good; const c = t.deep.includes(p) ? 'deep' : t.thin.includes(p) ? 'thin' : ''; return `<div class="tf-d ${c}"><span>${p}</span><b>${g}</b><em>${c === 'deep' ? 'deep' : c === 'thin' ? 'thin' : 'good'}</em>${(t.tvPos || {})[p] ? `<small title="Trade Value rank at ${p}">Value ${ordN(t.tvPos[p])}</small>` : ''}</div>`; }).join('')}</div>
       ${need ? `<ul class="tf-need">${need}</ul>` : ''}
       <div class="tf-money"><div><span>2026 payroll</span><b>${money(t.pay26)}</b></div><div><span>2027 keep cost</span><b>${money(t.keepCost)}</b></div><div><span>2027 budget</span><b>${money(t.cap27)}</b></div>
         <div class="${t.room27 < 0 ? 'neg' : 'pos'}"><span>${t.room27 < 0 ? 'Over by' : 'Room'}</span><b>${money(Math.abs(t.room27))}</b></div></div>
       <div class="tf-picks">${pyear(2027)}${pyear(2028)}</div></section>`; }).join('')}</div>`;
  }

  function vOwners() {
    const ids = Object.keys(D.teams).sort((a, b) => (D.habits[b].total - D.habits[a].total) || nm(a).localeCompare(nm(b)));
    const max = Math.max(1, ...ids.map(f => Math.max(...Object.values(D.habits[f].perSeason))));
    return `<p class="tf-why">Every MFL trade since 2019, counted per team. Auction cash is from the commissioner’s trade log (2022 on); FAAB isn’t recorded.</p>
     <div class="tf-teams">${ids.map(f => { const h = D.habits[f];
      const bars = Object.entries(h.perSeason).map(([y, n]) => `<div class="tf-bar"><i style="height:${n / max * 100}%"></i><b>${n}</b><span>${y.slice(2)}</span></div>`).join('');
      return `<section class="tf-card${f === (X && X.myTeam) ? ' tf-mine' : ''}"><h3>${logo(f)}${esc(nm(f))}</h3>
       <p class="tf-sub">${h.total} trade${h.total === 1 ? '' : 's'} since 2019${h.last ? ' · last on ' + date(h.last) : ''}</p>
       <div class="tf-bars" aria-label="Trades per season">${bars}</div>
       <dl class="tf-dl"><div><dt>Most often with</dt><dd>${h.partners.length ? h.partners.map(([p, n]) => `${esc(nm(p))} (${n})`).join(', ') : '–'}</dd></div>
        <div><dt>When</dt><dd>${h.inSeason} during the season, ${h.offSeason} in the off-season</dd></div>
        <div><dt>Players</dt><dd>${h.playersIn} in, ${h.playersOut} out</dd></div>
        <div><dt>Picks</dt><dd>${h.picksIn} in, ${h.picksOut} out</dd></div>
        <div><dt>Auction cash</dt><dd>${money(h.cashIn)} in, ${money(h.cashOut)} out</dd></div></dl></section>`; }).join('')}</div>`;
  }

  const KIND = [['', 'All'], ['picks', 'With picks'], ['cash', 'With cash'], ['players', 'Players only'], ['pickswap', 'Picks only']];
  const has = (t, k) => t.aGave.concat(t.bGave).some(x => x.k === k);
  const kindOk = t => !kind ? true : kind === 'picks' ? has(t, 'pick') : kind === 'cash' ? has(t, 'cash')
    : kind === 'players' ? !has(t, 'pick') && !has(t, 'cash') && has(t, 'p') : kind === 'pickswap' ? has(t, 'pick') && !has(t, 'p') : true;
  // trade trees (data/trade-trees.json, scripts/trade_trees.py): every asset followed through later trades until
  // the player is released or not kept. Totals there already include playoff points.
  let TT = null, ttAsked = false;
  const loadTrees = () => { if (ttAsked) return; ttAsked = true;
    FBPU.json('data/trade-trees.json').then(j => { TT = (j && j.trees) || {}; redraw(); }).catch(() => { TT = {}; }); };
  const tree = (t, s) => TT && TT[`${t.ts}-${t.a}-${t.b}`] ? TT[`${t.ts}-${t.a}-${t.b}`][s] : null;
  const all = o => o ? (o.total || 0) + (o.po || 0) : 0;
  const tot = (t, s) => { const tr = tree(t, s); return tr ? tr.total : all(s === 'a' ? t.outA : t.outB); };
  const swing = t => Math.abs(tot(t, 'a') - tot(t, 'b'));
  const n1 = v => (Math.round(v * 10) / 10).toFixed(1);
  // everyone in the trade, players taken with the picks included: their whole FBP careers (assets/journey.js)
  const jyIds = t => [...new Set(t.aGave.concat(t.bGave).map(x => x.k === 'p' ? x.id : x.became && x.became.id).filter(Boolean))];
  function fillJourneys() {
    if (!window.FBPJourney) return;
    document.querySelectorAll('.tf-later[open] .tf-jy').forEach(el => {
      if (el.dataset.done) return;
      if (!FBPJourney.ready()) { FBPJourney.load(fillJourneys); return; }
      el.dataset.done = '1';
      el.insertAdjacentHTML('beforeend', FBPJourney.html(el.dataset.tfJy.split(','), { teams: X.teams, nameOf: X.nameOf, esc, rerender: fillJourneys }));
    });
  }
  document.addEventListener('toggle', e => { if (e.target.matches && e.target.matches('.tf-later') && e.target.open) fillJourneys(); }, true);
  function vHistory() {
    loadTrees();
    const seasons = [...new Set(D.trades.map(t => t.season))];
    const qq = fold(q.trim());
    const words = t => [nm(t.a), nm(t.b)].concat(t.aGave.concat(t.bGave).map(x => x.t + (x.became ? ' ' + x.became.n : '')));
    let L = D.trades.filter(t => (!season || String(t.season) === season) && (!teamSel || t.a === teamSel || t.b === teamSel)
      && kindOk(t) && (!qq || fold(words(t).join(' ')).includes(qq)));
    if (hsort === 'swing') L = L.slice().sort((a, b) => swing(b) - swing(a));
    const tag = x => x.k === 'p' && x.pos ? `<span class="tf-pos">${esc(x.pos)}</span>` : x.k === 'pick' ? '<span class="tf-pos">PK</span>' : x.k === 'cash' ? '<span class="tf-pos tf-cash">$</span>' : '';
    const became = (x, f) => x.became ? ` <span class="tf-became">→ ${esc(x.became.n)} <small>${esc(x.became.pos || '')}${x.k === 'pick' && !/pick \d/.test(x.t) ? ` · ${x.became.y} ${x.became.slot}` : ''}${x.became.by && x.became.by !== f ? ` · taken by ${esc(nm(x.became.by))}` : ''}</small></span>` : '';
    const side = (f, got, out, tr) => `<div class="tf-side"><h4>${logo(f)}${esc(nm(f))} got${tr ? ` <span class="tf-tot">${n1(tr.total - tr.po)} pts${tr.po ? ` + ${n1(tr.po)} playoffs` : ''}</span>` : out ? ` <span class="tf-tot">${n1(out.total)} pts${out.po ? ` + ${n1(out.po)} playoffs` : ''}</span>` : ''}</h4><ul>${got.length ? got.map(x => `<li>${tag(x)}${esc(x.t)}${became(x, f)}</li>`).join('') : '<li class="tf-sub">Nothing recorded in MFL</li>'}</ul></div>`;
    // the tree: what each side got, and where it went from there
    const sum = o => Object.values(o || {}).reduce((x, v) => x + v, 0);
    const ending = e => !e ? '' : e.how === 'here' ? '<span class="tt-live">still on the roster</span>' : e.how === 'R' ? `<span class="tt-end">released${e.ts ? ' ' + date(e.ts) : ''}</span>`
      : e.how === 'N' ? `<span class="tt-end">${esc(e.text || 'not kept')}</span>` : e.how === 'pending' ? '<span class="tt-live">not drafted yet</span>' : '';
    const tnode = n => {
      if (n.k === 'cash') return `<li class="tt-n tt-cash"><span class="tf-pos tf-cash">$</span>${esc(n.t)} <small class="tt-end">auction cash, branch ends</small></li>`;
      const head = n.k === 'p'
        ? `<span class="tf-pos">${esc(n.pos || '')}</span><b>${esc(n.n)}</b>${n.via ? ` <small class="tf-via">via ${esc(n.via)}</small>` : ''}
           <span class="tt-pts" title="${esc(Object.entries(n.pts || {}).map(([y, v]) => `${y}: ${n1(v)}${(n.po || {})[y] ? ` + ${n1(n.po[y])} playoffs` : ''}`).join('\n'))}">${n1(sum(n.pts))} pts${sum(n.po) ? ` + ${n1(sum(n.po))} playoffs` : ''}</span>`
        : `<span class="tf-pos">PK</span><b>${esc(n.t)}</b>${n.became ? ` <small class="tf-via">${esc(n.became.n)} taken by ${esc(nm(n.became.by))}</small>` : ''}`;
      const tr = n.trade ? `<div class="tt-tr">↳ Traded ${date(n.trade.ts)} to ${esc(nm(n.trade.to))}${n.trade.pieces > 1 ? ` <span class="tt-pc">1 of ${n.trade.pieces} pieces</span>${n.trade.with.length ? ` <small>with ${esc(n.trade.with.join(', '))}</small>` : ''}` : ''}, for:</div>
        ${n.trade.they && n.trade.they.length ? `<div class="tt-they">${esc(nm(n.trade.to))} got ${n.trade.they.map(([w, v]) => `${esc(w)}${v != null ? ` <b>(${n1(v)})</b>` : ''}`).join(', ')}</div>` : ''}
        <ul class="tt">${n.trade.kids.map(tnode).join('') || '<li class="tt-n tf-sub">Nothing recorded in MFL</li>'}</ul>` : '';
      return `<li class="tt-n">${head} ${n.trade ? '' : ending(n.end)}${tr}</li>`;
    };
    const treeHtml = t => {
      const a = tot(t, 'a'), b = tot(t, 'b');
      const lead = a === b ? 'Even so far.' : `${esc(nm(a > b ? t.a : t.b))} by ${n1(Math.abs(a - b))} so far, playoffs included.`;
      const sd = (f, s) => { const tr = tree(t, s); return `<div class="tt-side"><h5>${logo(f)}${esc(nm(f))} <span class="tf-tot">${n1(tr.total - tr.po)} pts${tr.po ? ` + ${n1(tr.po)} playoffs` : ''}</span></h5>
        <ul class="tt tt-top">${tr.nodes.map(tnode).join('') || '<li class="tt-n tf-sub">Nothing recorded in MFL</li>'}</ul></div>`; };
      return `<details class="tf-later"><summary>How it played out <small>${lead}</small></summary>${sd(t.a, 'a')}${sd(t.b, 'b')}
        ${jyIds(t).length ? `<div class="tf-jy" data-tf-jy="${jyIds(t).join(',')}"><h5>Their FBP careers</h5></div>` : ''}
        <p class="tf-sub">Everything each team got, followed forward: a player’s starter points for that team until it let him go, a pick as the player taken with it, and anything traded on as what came back. Released or not kept ends a branch; so does auction cash. A piece that went out with others is labeled (“1 of 4 pieces”) and keeps its full points. Under each later trade is what the other team got in it and has scored with it since, for reference; that counts in that trade’s own tree, not this one. Playoff points count real playoff games only. Tap a point total for each season.</p></details>`;
    };
    const later = t => {
      if (tree(t, 'a') && tree(t, 'b')) return treeHtml(t);
      const S = [[t.a, t.outA], [t.b, t.outB]].filter(([, o]) => o && o.rows.length);
      if (!S.length) return '';
      const years = [...new Set(S.flatMap(([, o]) => o.years))].sort();
      const a = all(t.outA), b = all(t.outB), anyPo = S.some(([, o]) => o.po);
      const lead = a === b ? 'Even so far.' : `${esc(nm(a > b ? t.a : t.b))} by ${n1(Math.abs(a - b))} so far${anyPo ? ', playoffs included' : ''}.`;
      const tbl = ([f, o]) => `<div class="tf-lt"><h5>${logo(f)}${esc(nm(f))} <span class="tf-tot">${n1(o.total)} pts${o.po ? ` + ${n1(o.po)} playoffs` : ''}</span></h5><div class="tbl-wrap"><table class="tbl tf-ltbl"><thead><tr><th class="t">Player</th>${years.map(y => `<th>${y === String(D.season) ? y + '*' : y}</th>`).join('')}<th>Total</th>${anyPo ? '<th>Playoffs</th>' : ''}</tr></thead><tbody>
        ${o.rows.map(r => { const tot = Object.values(r.pts).reduce((x, v) => x + v, 0), pt = Object.values(r.po || {}).reduce((x, v) => x + v, 0);
          return `<tr><td class="t">${esc(r.n)} <small>${esc(r.pos || '')}</small>${r.via ? `<small class="tf-via">via ${esc(r.via)}</small>` : ''}</td>${years.map(y => `<td>${y in r.pts ? n1(r.pts[y]) : ''}${(r.po || {})[y] ? `<small class="tf-po">+${n1(r.po[y])} PO</small>` : ''}</td>`).join('')}<td><b>${n1(tot)}</b></td>${anyPo ? `<td>${pt ? `<b>${n1(pt)}</b>` : ''}</td>` : ''}</tr>`; }).join('')}
        </tbody></table></div></div>`;
      return `<details class="tf-later"><summary>How it played out <small>${lead}</small></summary>${S.map(tbl).join('')}
        ${jyIds(t).length ? `<div class="tf-jy" data-tf-jy="${jyIds(t).join(',')}"><h5>Their FBP careers</h5></div>` : ''}
        <p class="tf-sub">Points scored as a starter for the team that got him, from the trade season until that team let him go. Playoff points count real playoff games only (not consolation games); PO under a season is that season’s playoffs. A pick counts from the season the player was taken. * this season so far. Regular-season numbers match Awards &gt; Trade of the Year.</p></details>`;
    };
    return `<div class="tf-filters"><input type="search" class="tf-q" placeholder="Search a player or team" value="${esc(q)}" aria-label="Search trades">
      <select class="tf-season" aria-label="Season"><option value="">All seasons</option>${seasons.map(y => `<option${String(y) === season ? ' selected' : ''}>${y}</option>`).join('')}</select>
      <select class="tf-team" aria-label="Team"><option value="">All teams</option>${Object.keys(D.teams).sort((a, b) => nm(a).localeCompare(nm(b))).map(f => `<option value="${f}"${f === teamSel ? ' selected' : ''}>${esc(nm(f))}</option>`).join('')}</select>
      <select class="tf-sort" aria-label="Sort"><option value="new"${hsort === 'new' ? ' selected' : ''}>Newest first</option><option value="swing"${hsort === 'swing' ? ' selected' : ''}>Biggest swing</option></select></div>
     ${seg('tfk', kind, KIND)}
     <p class="tf-sub tf-count">${L.length} trade${L.length === 1 ? '' : 's'}. Tap “How it played out” on a trade for each side’s points since. Auction cash is from the commissioner’s trade log; FAAB isn’t recorded.</p>
     <div class="tf-hist">${L.slice(0, 150).map(t => `<article class="tf-tr"><p class="tf-date">${date(t.ts)}${hsort === 'swing' && (t.outA || t.outB) ? ` · swing ${n1(swing(t))} pts` : ''}</p><div class="tf-sides">${side(t.a, t.bGave, t.outA, tree(t, 'a'))}${side(t.b, t.aGave, t.outB, tree(t, 'b'))}</div>${later(t)}</article>`).join('') || '<p class="tf-sub">No trades match.</p>'}</div>`;
  }

  function render(ctx) {
    X = ctx;
    if (!D) { load(); return failed ? '<p class="error">The Trading Floor didn’t load. Refresh the page to try again.</p>' : '<p class="loading">Loading the Trading Floor…</p>'; }
    const V = { block: ['On the Block', vBlock], targets: ['Targets', vTargets], teams: ['Teams', vTeams], chart: ['Value Chart', () => window.FBPValues ? FBPValues.chart(X) : ''], owners: ['Trade Habits', vOwners], history: ['History', vHistory] };
    return `<section class="tf-page"><h2 class="bc-h">Trading Floor</h2>
     <p class="tf-dl-line" id="tf-clock">${countdown()}</p>
     <nav class="seg tf-tabs">${Object.entries(V).map(([k, [l]]) => `<button type="button" data-tfv="${k}" aria-pressed="${k === view}">${l}</button>`).join('')}</nav>
     <div class="tf-view">${V[view][1]()}</div>
     <p class="bc-foot">Players lead with Trade Value, with the FBP OVR beside the name. Outlook comes from the playoff odds: Contending 75%+, In the mix 25–75%, Building under 25%. Contracts, picks, trades and the block are from MFL; auction cash in trades is from the commissioner’s trade log.</p></section>`;
  }

  let wired = false;
  function after() {
    if (!document.querySelector('.tf-page')) return;
    clearInterval(tick); tick = setInterval(() => { const c = document.getElementById('tf-clock'); if (!c) { clearInterval(tick); return; } c.innerHTML = countdown(); }, 30000);
    const qi = document.querySelector('.tf-q');
    if (qi) qi.addEventListener('input', () => { q = qi.value; const pos0 = qi.selectionStart; redraw(); const n = document.querySelector('.tf-q'); if (n) { n.focus(); try { n.setSelectionRange(pos0, pos0); } catch (_) {} } });
    const se = document.querySelector('.tf-season'); if (se) se.addEventListener('change', () => { season = se.value; redraw(); });
    const so = document.querySelector('.tf-sort'); if (so) so.addEventListener('change', () => { hsort = so.value; redraw(); });
    const te = document.querySelector('.tf-team'); if (te) te.addEventListener('change', () => { teamSel = te.value; redraw(); });
    if (wired) return; wired = true;
    document.addEventListener('click', e => {
      if (!document.querySelector('.tf-page')) return;
      const b = e.target.closest('[data-tfv],[data-tfp],[data-tfk]');
      if (!b) return;
      if (b.dataset.tfv) view = b.dataset.tfv; else if (b.dataset.tfk !== undefined) kind = b.dataset.tfk; else pos = b.dataset.tfp;
      redraw();
    });
    document.addEventListener('change', e => {
      if (e.target.matches && e.target.matches('[data-tfc]')) { withCont = e.target.checked; redraw(); }
    });
  }
  return { render, after };
})();
