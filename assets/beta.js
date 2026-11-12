/* Beta > Player Cards: trading-card versions of the prototype player ratings, for testing.
   Data: data/beta-cards.json (ratings prototype; season lines and combine data from nflverse, CC BY 4.0).
   NFL team colours and logos: data/espn/teams.json. FBP team logos: data/teams.json (via ctx.teams).
   Special fronts: 1st and 2nd Team All-FBP to date (data/awards.json) get their own backgrounds, and anyone who scored
   30+ FBP points in the latest week played (data/stats.json) is on fire.
   Exposes window.FBPBeta.render(ctx) and .after(); site.js routes #beta to it. */
window.FBPBeta = (function () {
  let D = null, T = null, AW = null, ST = null, failed = false, loading = false, X = null;
  let pos = 'ALL', who = 'fbp', team = '', shown = 24, seeded = false, view = 'stack', at = 0;
  const gone = [];                  // stack: which way each swiped card left (-1 left, 1 right), so Back returns it from that side
  const PAGE = 24, NUKE = 30;       // NUKE: FBP points in a week that counts as going nuclear
  const esc = s => (X && X.esc ? X.esc(s) : String(s == null ? '' : s));
  const redraw = () => { const y = window.scrollY; if (X && X.rerender) { X.rerender(); window.scrollTo(0, y); } };
  let honor = {}, fire = {}, fid = {}, fireWk = null;   // by MFL id: 'first' | 'second'; {pts}; FBP franchise id

  function load() {
    if (D || loading || failed) return;
    loading = true;
    const opt = u => fetch(u, { cache: 'no-cache' }).then(r => r.ok ? r.json() : null).catch(() => null);
    Promise.all([fetch('data/beta-cards.json', { cache: 'no-cache' }).then(r => r.ok ? r.json() : Promise.reject()),
      opt('data/espn/teams.json'), opt('data/awards.json'), opt('data/stats.json')])
      .then(([d, t, a, st]) => { D = d; T = t || {}; AW = a; ST = st; index(); loading = false; redraw(); }, () => { failed = true; loading = false; redraw(); });
  }
  function index() {
    const af = (AW && AW.allFbp) || {};
    (af.second || []).forEach(e => { if (e.player) honor[e.player.id] = 'second'; });
    (af.first || []).forEach(e => { if (e.player) honor[e.player.id] = 'first'; });
    const rows = (ST && ST.rows) || [], W = (ST && ST.weeks) || [];
    let k = -1; for (let i = W.length - 1; i >= 0 && k < 0; i--) if (rows.some(r => r.w[i] != null)) k = i;
    if (k >= 0) fireWk = W[k];
    rows.forEach(r => { fid[r.id] = r.f || ''; if (k >= 0 && r.w[k] != null && r.w[k] >= NUKE) fire[r.id] = r.w[k]; });
  }

  /* ---------- the card ---------- */
  const tier = o => o >= 90 ? 'holo' : o >= 80 ? 'gold' : o >= 70 ? 'silver' : 'bronze';
  const KEY = { RB: ['SPD', 'ELU', 'REC', 'USG'], WR: ['SPD', 'SEP', 'HND', 'BIG'], TE: ['SPD', 'SEP', 'YAC', 'HND'], QB: ['ACC', 'ARM', 'RUN', 'TD'] };
  const val = (c, k) => k in (c.ph || {}) ? c.ph[k] : (c.sk || {})[k];
  const head = e => `https://a.espncdn.com/i/headshots/nfl/players/full/${e}.png`;
  const ht = h => { const i = +h; return i ? `${Math.floor(i / 12)}'${i % 12}"` : '–'; };
  const n = v => v == null ? '–' : Math.round(v);
  const fbpTeam = c => { const id = fid[c.id]; return id && X && X.teams ? Object.assign({ id }, X.teams[id] || {}) : null; };
  function table(c) {
    const ys = Object.keys(c.L || {}).sort();
    const g = (y, i) => c.L[y][i];   // fields: g pass_yds pass_td int car rush_yds rush_td tgt rec rec_yds rec_td ppg team
    const row = (y, cells) => [y.slice(2), g(y, 12)].concat(cells, [g(y, 11).toFixed(1)]);
    let h, r;
    if (c.p === 'QB') { h = ['YR', 'TM', 'G', 'PASS', 'TD', 'INT', 'RUSH', 'PPG']; r = ys.map(y => row(y, [g(y, 0), n(g(y, 1)), g(y, 2), g(y, 3), n(g(y, 5))])); }
    else if (c.p === 'RB') { h = ['YR', 'TM', 'G', 'CAR', 'RUSH', 'REC', 'YDS', 'TD', 'PPG']; r = ys.map(y => row(y, [g(y, 0), g(y, 4), n(g(y, 5)), g(y, 8), n(g(y, 9)), g(y, 6) + g(y, 10)])); }
    else { h = ['YR', 'TM', 'G', 'TGT', 'REC', 'YDS', 'TD', 'PPG']; r = ys.map(y => row(y, [g(y, 0), g(y, 7), g(y, 8), n(g(y, 9)), g(y, 10)])); }
    if (!r.length) return '<p class="bc-none">No NFL games yet.</p>';
    return `<table class="bc-tbl"><thead><tr>${h.map(x => `<th>${x}</th>`).join('')}</tr></thead><tbody>${r.map(x => `<tr>${x.map(v => `<td>${esc(v)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
  }
  function card(c) {
    const t = tier(c.o), tm = (T && T[c.tm]) || {}, logo = tm.logo || '', color = tm.color || '#3a4350';
    const parts = c.n.split(' '), first = parts[0], last = parts.slice(1).join(' ');
    const ft = fbpTeam(c), fname = ft ? (X.nameOf ? X.nameOf(ft.id) : c.f) : 'Free agent';
    const hon = honor[c.id], hot = fire[c.id];
    const dr = c.dr && c.dr[1] ? `Rd ${c.dr[0]}, #${c.dr[1]}` : 'Undrafted';
    const bar = (k, v) => `<div class="bc-bar"><span>${k}</span><i><u style="width:${v || 0}%"></u></i><em>${v == null ? '–' : v}</em></div>`;
    const sk = Object.keys(c.sk || {});
    const flames = hot != null ? `<div class="bc-fire" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i></div>` : '';
    const ribbon = hon ? `<div class="bc-rib">${hon === 'first' ? '1st' : '2nd'} Team All-FBP</div>` : '';
    const heat = hot != null ? `<div class="bc-heat">🔥 ${hot.toFixed(1)} in Wk ${fireWk}</div>` : '';
    const cls = ['bc-tilt', 'bc-' + t, hon ? 'bc-' + hon : '', hot != null ? 'bc-hot' : ''].filter(Boolean).join(' ');
    const label = [c.n, `${c.o} overall`, hon ? `${hon === 'first' ? 'First' : 'Second'} Team All-FBP` : '', hot != null ? `${hot.toFixed(1)} points in week ${fireWk}` : ''].filter(Boolean).join(', ');
    return `<div class="bc-slot"><div class="${cls}" style="--tc:${esc(color)}" tabindex="0" role="button" aria-label="${esc(label)}. Tap to flip." data-e="${esc(c.e)}">
  <div class="bc-flip">
   <div class="bc-face bc-front"><div class="bc-art">
     <div class="bc-pat" aria-hidden="true"></div>
     ${logo ? `<img class="bc-logobg" src="${esc(logo)}" alt="" loading="lazy">` : ''}
     ${flames}
     <img class="bc-head" src="${head(c.e)}" alt="" loading="lazy">
     <div class="bc-shine"></div>
     <div class="bc-ovr"><b>${c.o}</b><span>${c.p}</span></div>
     <div class="bc-tr">${c.j ? `<div class="bc-num">${esc(c.j)}</div>` : ''}${ft && ft.logo ? `<img class="bc-fbp" src="${esc(ft.logo)}" alt="${esc(fname)}" title="${esc(fname)}" loading="lazy">` : ''}</div>
     <div class="bc-plate">${ribbon || heat ? `<div class="bc-badges">${ribbon}${heat}</div>` : ''}<div class="bc-nm">${logo ? `<img src="${esc(logo)}" alt="${esc(c.tm)}" loading="lazy">` : ''}<div><span class="bc-first">${esc(first)}</span><span class="bc-last">${esc(last)}</span></div></div>
       <div class="bc-tag"><span>${esc(c.dev || '')}</span><span>${c.p}${c.r || ''} · ${esc(fname)}</span></div>
       <div class="bc-attrs">${(KEY[c.p] || []).map(k => `<span>${k}<b>${n(val(c, k))}</b></span>`).join('')}</div></div>
     <div class="bc-glare"></div></div></div>
   <div class="bc-face bc-back">
     <div class="bc-bh">${c.j ? `<span class="bc-bn">${esc(c.j)}</span>` : ''}<div><b>${esc(c.n)}</b><small>${c.p} · ${esc(tm.name || c.tm || '')}</small><small>FBP: ${esc(fname)}${ft && c.sal != null ? ' · $' + Math.round(c.sal) : ''}</small></div>${ft && ft.logo ? `<img class="bc-bfbp" src="${esc(ft.logo)}" alt="" loading="lazy">` : ''}</div>
     <div class="bc-bio"><div>Ht <b>${ht(c.ht)}</b></div><div>Wt <b>${esc(c.wt || '–')}</b></div><div>Age <b>${c.age == null ? '–' : Math.floor(c.age)}</b></div>
       <div>40 <b>${esc(c.fo || '–')}</b></div><div class="bc-span">${dr}${c.col ? ' · ' + esc(String(c.col).split(';')[0]) : ''}</div></div>
     <div class="bc-body"><div class="bc-sec">Season by season</div>${table(c)}
     <div class="bc-sec">Physical</div><div class="bc-bars">${['SPD', 'EXP', 'AGI'].map(k => bar(k, (c.ph || {})[k])).join('')}</div>
     <div class="bc-sec">Skills</div><div class="bc-bars">${sk.map(k => bar(k, c.sk[k])).join('')}</div>
     <div class="bc-sec">Production</div><div class="bc-bars">${['PRD', 'CEI', 'CON', 'DUR'].map(k => bar(k, (c.sub || {})[k])).join('')}</div></div>
     <div class="bc-bf"><span>${esc(c.dev || '')}${hon ? ` · ${hon === 'first' ? '1st' : '2nd'} Team All-FBP` : ''}</span><span class="bc-pot">POT ${c.pot == null ? '–' : c.pot}</span></div>
     <div class="bc-pc">Headshot: ESPN · Data: nflverse</div>
   </div>
  </div></div></div>`;
  }

  /* ---------- page ---------- */
  const own = c => fid[c.id] || '';
  function list() {
    return D.cards.filter(c => (pos === 'ALL' || c.p === pos) && (who === 'all' || (who === 'fa' ? !own(c) : !!own(c))) && (!team || who === 'fa' || own(c) === team))
      .sort((a, b) => (b.o - a.o) || ((a.r || 999) - (b.r || 999)));
  }
  /* ---------- Beta landing: a button per experiment ---------- */
  const sub = () => location.hash.slice(1).split('/')[1] || '';
  const BETA = [['cards', 'Player Cards', 'A trading card for every player, built on the prototype ratings.'],
    ['trade', 'Trading Floor', 'The trade block, trade targets, team needs, trade habits and every trade since 2019.'],
    ['power', 'Power Rankings', 'The FBP Power Score: strength now, projected keepers, auction cash and picks. Still being tuned.'],
    ['nav', 'Navigation Lab', 'Try three ways the page buttons could move up into the top header.']];
  function betaHead(cur) {
    return `<div class="pagehead"><h1>Beta</h1><span class="asof">Testing ground for things that aren’t finished</span></div>
<nav class="seg bt-sub">${[['', 'All'], ...BETA.map(([k, l]) => [k, l])].map(([k, l]) => `<a href="#beta${k ? '/' + k : ''}"${cur === k ? ' aria-current="page"' : ''}>${l}</a>`).join('')}</nav>`;
  }
  function render(ctx) {
    X = ctx;
    const s0 = sub();
    if (s0 === 'trade') return betaHead('trade') + (window.FBPTrade ? FBPTrade.render(ctx) : '<p class="error">The Trading Floor didn’t load.</p>');
    if (s0 === 'nav') return betaHead('nav') + (window.FBPNavLab ? FBPNavLab.render() : '<p class="error">The Navigation Lab didn’t load.</p>');
    if (s0 === 'power') return betaHead('power') + (window.FBPPower ? FBPPower.render(ctx) : '<p class="error">The Power Rankings didn’t load.</p>');
    if (s0 !== 'cards') return betaHead('') + `<div class="bt-grid">${BETA.map(([k, l, d]) => `<a class="bt-btn" href="#beta/${k}"><b>${l}</b><span>${d}</span></a>`).join('')}</div>`;
    return betaHead('cards') + renderCards(ctx);
  }
  function renderCards(ctx) {
    if (!D) { load(); return failed ? '<p class="error">The player cards didn’t load. Refresh the page to try again.</p>' : '<p class="loading">Loading player cards…</p>'; }
    if (!seeded) { seeded = true; if (ctx.myTeam && D.cards.some(c => own(c) === ctx.myTeam)) team = ctx.myTeam; }
    const teams = [...new Set(D.cards.map(own).filter(Boolean))].map(id => [id, ctx.nameOf ? ctx.nameOf(id) : id]).sort((a, b) => a[1].localeCompare(b[1]));
    const L = list(), vis = L.slice(0, shown);
    if (view === 'stack' && at > L.length) at = L.length;
    const seg = (attr, cur, opts) => opts.map(([k, l]) => `<button type="button" data-${attr}="${k}" aria-pressed="${k === cur}">${l}</button>`).join('');
    return `<section class="bc-page">
 <h2 class="bc-h">Player Cards</h2>
 <p class="bc-intro">A trading card for every player, built on the prototype player ratings. Tap a card to flip it; move your mouse over it, or tilt your phone, to catch the foil. The big number is <b>OVR</b>, one rating for how good he is as a fantasy player: <b>90+</b> holo, <b>80s</b> gold, <b>70s</b> silver, under 70 bronze. Special fronts: <b>1st</b> and <b>2nd Team All-FBP</b> so far this season get their own backgrounds, and anyone who scored 30+ FBP points last week is <b>on fire</b>.</p>
 <div class="bc-bar-row seg">${seg('bv', view, [['stack', 'Stack'], ['grid', 'Grid']])}</div>
 <div class="bc-bar-row seg">${seg('bp', pos, [['ALL', 'All'], ['QB', 'QB'], ['RB', 'RB'], ['WR', 'WR'], ['TE', 'TE']])}</div>
 <div class="bc-bar-row seg">${seg('bw', who, [['fbp', 'FBP rosters'], ['fa', 'Free agents'], ['all', 'Everyone']])}
  ${who !== 'fa' ? `<select class="bc-team" aria-label="FBP team"><option value="">All FBP teams</option>${teams.map(([id, nm]) => `<option value="${esc(id)}"${id === team ? ' selected' : ''}>${esc(nm)}</option>`).join('')}</select>` : ''}</div>
 <button type="button" class="bc-tiltbtn" hidden>📱 Turn on phone tilt</button>
 <p class="bc-count">${L.length} player${L.length === 1 ? '' : 's'}, best first${view === 'stack' && L.length ? '. Swipe a card away to see the next one; Back brings it back.' : ''}</p>
 ${view === 'stack' ? (L.length ? `<div class="bc-stackwrap"><div class="bc-deck" data-noswipe></div>
  <div class="bc-deckbar"><button type="button" class="bc-undo" data-bundo="1">↶ Back</button><span class="bc-pos" aria-live="polite"></span></div></div>` : '<p class="bc-none">Nobody here.</p>') : `<div class="bc-grid">${vis.map(card).join('') || '<p class="bc-none">Nobody here.</p>'}</div>`}
 ${view === 'grid' && L.length > shown ? `<button type="button" class="bc-more" data-bmore="1">Show ${Math.min(PAGE, L.length - shown)} more</button>` : ''}
 <p class="bc-foot">Ratings are a prototype and will change. Season lines and combine data: <a href="https://github.com/nflverse" target="_blank" rel="noopener">nflverse</a> (CC BY 4.0); 2026 points are FBP’s own scoring. Headshots: ESPN.</p>
</section>`;
  }

  /* ---------- behaviour, wired after each render ---------- */
  const reduce = () => window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  let orientOn = false, wired = false;
  // Phone tilt. Measured against a resting position that slowly follows how you're holding the phone, so any grip
  // works and the card settles back flat when you hold still. One update per frame, only for cards on screen.
  let base = null, last = null, frame = 0;
  const seen = new Set();
  function orient(e) {
    if (e.beta == null || e.gamma == null) return;
    if (!base) base = { b: e.beta, g: e.gamma };
    base.b += (e.beta - base.b) * .03; base.g += (e.gamma - base.g) * .03;
    last = { b: e.beta - base.b, g: e.gamma - base.g };
    if (!frame) frame = requestAnimationFrame(paint);
  }
  function paint() {
    frame = 0; if (!last) return;
    const g = Math.max(-20, Math.min(20, last.g)), b = Math.max(-20, Math.min(20, last.b));
    seen.forEach(el => { if (!el.isConnected) { seen.delete(el); return; }
      el.style.setProperty('--ry', (g * 1.1) + 'deg'); el.style.setProperty('--rx', (-b * .9) + 'deg');
      el.style.setProperty('--gx', (50 + g * 2.5) + '%'); el.style.setProperty('--gy', (40 + b * 2.5) + '%'); el.classList.add('moving'); });
  }
  function flip(t) { t.classList.toggle('flipped'); t.classList.add('turning'); clearTimeout(t._turn); t._turn = setTimeout(() => t.classList.remove('turning'), 650); }
  function startTilt() { if (orientOn) return; orientOn = true; base = null; addEventListener('deviceorientation', orient); }
  let vio = null;
  function wireCard(el) {
    if (vio) vio.observe(el);
    el.addEventListener('pointermove', e => {
      if (reduce() || e.pointerType === 'touch') return;
      const r = el.getBoundingClientRect(), x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height;
      el.style.setProperty('--ry', ((x - .5) * 22) + 'deg'); el.style.setProperty('--rx', ((.5 - y) * 18) + 'deg');
      el.style.setProperty('--gx', (x * 100) + '%'); el.style.setProperty('--gy', (y * 100) + '%'); el.classList.add('moving');
    });
    el.addEventListener('pointerleave', () => { el.style.setProperty('--ry', '0deg'); el.style.setProperty('--rx', '0deg'); el.classList.remove('moving'); });
  }

  /* ---------- the stack: top card plus two peeking out underneath ---------- */
  const DEPTH = 3;
  let deck = null, deckL = [], drag = null;
  function mk(i) {
    const w = document.createElement('div'); w.className = 'bc-item'; w.dataset.i = i;
    w.innerHTML = card(deckL[i]); wireCard(w.querySelector('.bc-tilt')); return w;
  }
  function restack() {
    deck.querySelectorAll('.bc-item:not(.bc-out)').forEach(w => {
      const d = +w.dataset.i - at;
      w.style.setProperty('--d', d); w.style.zIndex = 50 - d; w.classList.toggle('bc-top', d === 0);
      if (d) w.setAttribute('aria-hidden', 'true'); else w.removeAttribute('aria-hidden');
      const t = w.querySelector('.bc-tilt'); if (t) t.tabIndex = d ? -1 : 0;
    });
    let end = deck.querySelector('.bc-end');
    if (at >= deckL.length && !end) { end = document.createElement('div'); end.className = 'bc-end';
      end.innerHTML = `<b>That’s everybody.</b><button type="button" data-brestart="1">Start over</button>`; deck.appendChild(end); }
    else if (at < deckL.length && end) end.remove();
    const pos = document.querySelector('.bc-pos'); if (pos) pos.textContent = `${Math.min(at + 1, deckL.length)} of ${deckL.length}`;
    const u = document.querySelector('.bc-undo'); if (u) u.disabled = at === 0;
  }
  function buildDeck() {
    deck.innerHTML = '';
    for (let i = at; i < Math.min(at + DEPTH, deckL.length); i++) deck.appendChild(mk(i));
    restack();
  }
  function advance(dir) {
    const top = deck.querySelector('.bc-item.bc-top'); if (!top) return;
    gone[at] = dir; top.classList.add('bc-out'); top.classList.remove('bc-top');
    top.style.transition = 'transform .35s ease-in, opacity .35s ease-in';
    top.style.transform = `translate(${dir * 130}%, 4%) rotate(${dir * 24}deg)`; top.style.opacity = '0';
    setTimeout(() => top.remove(), 400);
    at++;
    if (at + DEPTH - 1 < deckL.length) deck.appendChild(mk(at + DEPTH - 1));
    restack();
    const nt = deck.querySelector('.bc-top .bc-tilt'); if (nt && document.activeElement && document.activeElement.closest('.bc-deck')) nt.focus({ preventScroll: true });
  }
  function undo() {
    if (at <= 0) return;
    at--;
    const w = mk(at), dir = gone[at] || -1;
    w.style.transition = 'none'; w.style.transform = `translate(${dir * 130}%, 4%) rotate(${dir * 24}deg)`; w.style.opacity = '0';
    deck.appendChild(w);
    deck.querySelectorAll('.bc-item:not(.bc-out)').forEach(x => { if (+x.dataset.i >= at + DEPTH) x.remove(); });
    restack();
    void w.offsetWidth;
    w.style.transition = ''; w.style.transform = ''; w.style.opacity = '';
  }
  function wireDeck() {
    deck.addEventListener('pointerdown', e => {
      const w = e.target.closest('.bc-item.bc-top'); if (!w || e.button > 0) return;
      drag = { w, x: e.clientX, y: e.clientY, t: Date.now(), dx: 0, dy: 0, moved: false, id: e.pointerId, link: !!e.target.closest('a') };
    });
    deck.addEventListener('pointermove', e => {
      if (!drag || e.pointerId !== drag.id) return;
      drag.dx = e.clientX - drag.x; drag.dy = e.clientY - drag.y;
      if (!drag.moved && Math.abs(drag.dx) > 8 && Math.abs(drag.dx) > Math.abs(drag.dy)) {
        drag.moved = true; drag.t = Date.now();
        try { drag.w.setPointerCapture(drag.id); } catch (_) {}
        drag.w.style.transition = 'none';
      }
      if (drag.moved) drag.w.style.transform = `translate(${drag.dx}px, ${drag.dy * .15}px) rotate(${drag.dx * .05}deg)`;
    });
    const release = e => {
      if (!drag || e.pointerId !== drag.id) return;
      const d = drag; drag = null;
      if (!d.moved) {
        if (e.type === 'pointerup' && Math.abs(d.dx) < 10 && Math.abs(d.dy) < 10 && !d.link) flip(d.w.querySelector('.bc-tilt'));
        return;
      }
      const v = Math.abs(d.dx) / Math.max(1, Date.now() - d.t);
      if (e.type === 'pointerup' && (Math.abs(d.dx) > Math.min(110, d.w.offsetWidth * .35) || (Math.abs(d.dx) > 40 && v > .45))) advance(d.dx > 0 ? 1 : -1);
      else { d.w.style.transition = ''; d.w.style.transform = ''; }
    };
    deck.addEventListener('pointerup', release);
    deck.addEventListener('pointercancel', release);
    deck.addEventListener('keydown', e => {
      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { e.preventDefault(); advance(e.key === 'ArrowRight' ? 1 : -1); }
      else if (e.key === 'Backspace') { e.preventDefault(); undo(); }
    });
  }

  function after() {
    if (sub() === 'trade') { if (window.FBPTrade) FBPTrade.after(); return; }
    const page = document.querySelector('.bc-page'); if (!page || !D) return;
    if (vio) vio.disconnect();
    seen.clear();
    vio = 'IntersectionObserver' in window ? new IntersectionObserver(ents => ents.forEach(en => { if (en.isIntersecting) seen.add(en.target); else seen.delete(en.target); })) : null;
    page.querySelectorAll('.bc-grid .bc-tilt').forEach(wireCard);
    deck = page.querySelector('.bc-deck');
    if (deck) { deckL = list(); wireDeck(); buildDeck(); }
    const sel = page.querySelector('.bc-team');
    if (sel) sel.addEventListener('change', () => { team = sel.value; shown = PAGE; at = 0; redraw(); });
    // phone tilt: iPhones ask permission first (the button near the top); other phones just start
    if (!orientOn && window.DeviceOrientationEvent && matchMedia('(pointer: coarse)').matches) {
      if (typeof DeviceOrientationEvent.requestPermission === 'function') {
        const b = page.querySelector('.bc-tiltbtn'); b.hidden = false;
        b.onclick = () => DeviceOrientationEvent.requestPermission().then(st => { if (st === 'granted') { startTilt(); b.hidden = true; } else b.textContent = 'Tilt is blocked in Settings > Safari > Motion & Orientation Access'; }).catch(() => {});
      } else if (!reduce()) startTilt();
    }
    if (!wired) {   // one delegated click/key handler for the whole page
      wired = true;
      document.addEventListener('click', e => {
        if (!document.querySelector('.bc-page')) return;
        if (e.target.closest('[data-bundo]')) { undo(); return; }
        if (e.target.closest('[data-brestart]')) { at = 0; buildDeck(); return; }
        const b = e.target.closest('[data-bp],[data-bw],[data-bv],[data-bmore]');
        if (b) { if (b.dataset.bp) { pos = b.dataset.bp; shown = PAGE; at = 0; } else if (b.dataset.bw) { who = b.dataset.bw; shown = PAGE; at = 0; }
          else if (b.dataset.bv) view = b.dataset.bv; else shown += PAGE; redraw(); return; }
        if (e.target.closest('a') || e.target.closest('.bc-deck')) return;   // the stack flips on its own tap handling
        const t = e.target.closest('.bc-tilt'); if (t) flip(t);
      });
      document.addEventListener('keydown', e => {
        const t = e.target.closest && e.target.closest('.bc-tilt');
        if (t && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); flip(t); }
      });
    }
  }

  return { render, after };
})();
