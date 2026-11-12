/* Beta > Navigation Lab: three ways the section buttons (Standings, Rosters, …) could move off the page and into the
   top header, tried on a pretend header so nothing about the real menu changes.
     menus   — a ▾ beside each tab: the name goes to the section, the ▾ opens its pages
     again   — tap a tab to go there; tap the tab you're already on to open its pages
     row     — a slim row of the section's pages under the tabs that stays put while you scroll
   Menus close when you pick a page, tap outside, scroll, press Escape or open another. On a computer the ▾ menus
   also open when you rest the mouse on a tab for a moment. FBPNavLab.render() returns markup; it repaints itself. */
window.FBPNavLab = (function () {
  const SECS = [
    ['scores', 'Game Day', ['Scoreboard', 'Players', 'NFL Scores', 'Ticket Helper']],
    ['now', 'League Now', ['Standings', 'Rosters', 'Stats', 'Matchups', 'Power', 'Playoffs', 'Analytics', 'Hospital']],
    ['awards', 'Awards', []],
    ['draft', 'Rookie Draft', ['FBP Home', 'Mock Draft', 'Big Board', 'Full Order']],
    ['reference', 'Reference', ['Home', 'Franchises', 'Seasons', 'Records', 'Players', 'Payroll', 'HOF']],
    ['offseason', 'Off-Season', []],
    ['press', 'Press Box', []],
    ['bylaws', 'By-Laws', []],
  ];
  const MODES = [['menus', '▾ Menus'], ['again', 'Tap again'], ['row', 'Second row']];
  const HELP = {
    menus: 'Tap a section’s name to go to its first page. Tap the small ▾ beside it to see all its pages. On a computer, resting the mouse on a tab opens it too.',
    again: 'Tap a section to go there. Tap the section you’re already in to open its pages. Nothing opens unless you tap the same tab twice.',
    row: 'Tap a section to go there. Its pages sit in a slim row under the tabs and stay in place while you scroll. Nothing to open or close.',
  };
  let mode = 'menus', cur = 'now', page = 'Standings', open = null, hoverT = 0, leaveT = 0;
  try { mode = localStorage.getItem('fbp-navlab') || 'menus'; } catch (e) {}
  if (!MODES.some(m => m[0] === mode)) mode = 'menus';
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const sec = k => SECS.find(s => s[0] === k);

  function tabs() {
    return SECS.map(([k, l, subs]) => {
      const on = k === cur, has = subs.length > 0;
      const caret = has && (mode === 'menus' || (mode === 'again' && on))
        ? `<button type="button" class="nl-caret" data-nl-caret="${k}" aria-label="${esc(l)} pages" aria-expanded="${open === k}">▾</button>` : '';
      return `<span class="nl-tab${on ? ' on' : ''}${open === k ? ' open' : ''}" data-nl-hover="${has && mode === 'menus' ? k : ''}"><button type="button" class="nl-name" data-nl-tab="${k}">${esc(l)}</button>${caret}</span>`;
    }).join('');
  }
  function menu() {
    const s = open && sec(open); if (!s) return '';
    return `<div class="nl-menu" role="menu" aria-label="${esc(s[1])}">${s[2].map(p => `<button type="button" role="menuitem" data-nl-go="${s[0]}|${esc(p)}"${s[0] === cur && p === page ? ' aria-current="page"' : ''}>${esc(p)}</button>`).join('')}</div>`;
  }
  function row() {
    const s = sec(cur); if (mode !== 'row' || !s[2].length) return '';
    return `<div class="nl-row">${s[2].map(p => `<button type="button" data-nl-go="${s[0]}|${esc(p)}"${p === page ? ' aria-current="page"' : ''}>${esc(p)}</button>`).join('')}</div>`;
  }
  function frame() {
    const s = sec(cur);
    const filler = Array.from({ length: 9 }, (_, i) => `<div class="nl-blk" style="height:${46 + (i * 37) % 60}px"></div>`).join('');
    return `<div class="nl-hd"><div class="nl-brand"><b>FootballPalooza</b><small>pretend header</small></div><div class="nl-tabs">${tabs()}</div>${row()}${menu()}</div>
      <div class="nl-body"><p class="nl-where">${esc(s[1])}${s[2].length ? ` <span>›</span> ${esc(page)}` : ''}</p>
        <p class="nl-note">${mode === 'row' ? 'Scroll this box: the row stays under the tabs.' : 'Scroll this box with a menu open: it closes.'} No page buttons down here.</p>${filler}</div>`;
  }
  function render() {
    return `<section class="nl-lab"><h2>Navigation Lab</h2>
      <p class="nl-intro">Three ways the page buttons could move into the top header. The header below is pretend: tap around in it, nothing else on the site changes.</p>
      <div class="seg nl-modes" role="group" aria-label="Style">${MODES.map(([k, l]) => `<button type="button" data-nl-mode="${k}" aria-pressed="${mode === k}">${l}</button>`).join('')}</div>
      <p class="nl-help" id="nl-help">${HELP[mode]}</p>
      <div class="nl-frame" id="nl-frame">${frame()}</div></section>`;
  }
  function paint() {
    const f = document.getElementById('nl-frame'); if (!f) return;
    const body = f.querySelector('.nl-body'), y = body ? body.scrollTop : 0, tx = (f.querySelector('.nl-tabs') || {}).scrollLeft || 0;
    f.innerHTML = frame();
    const b2 = f.querySelector('.nl-body'); if (b2) b2.scrollTop = y;
    const t2 = f.querySelector('.nl-tabs'); if (t2) t2.scrollLeft = tx;
    const h = document.getElementById('nl-help'); if (h) h.textContent = HELP[mode];
    document.querySelectorAll('[data-nl-mode]').forEach(x => x.setAttribute('aria-pressed', x.dataset.nlMode === mode));
  }
  const go = (k, p) => { cur = k; page = p || (sec(k)[2][0] || ''); open = null; paint(); };

  document.addEventListener('click', e => {
    if (!e.target.closest) return;
    const m = e.target.closest('[data-nl-mode]');
    if (m) { mode = m.dataset.nlMode; open = null; try { localStorage.setItem('fbp-navlab', mode); } catch (x) {} paint(); return; }
    if (!document.getElementById('nl-frame')) return;
    const c = e.target.closest('[data-nl-caret]');
    if (c) { open = open === c.dataset.nlCaret ? null : c.dataset.nlCaret; paint(); return; }
    const t = e.target.closest('[data-nl-tab]');
    if (t) {
      const k = t.dataset.nlTab;
      if (mode === 'again' && k === cur && sec(k)[2].length) { open = open === k ? null : k; paint(); return; }
      go(k); return;
    }
    const g = e.target.closest('[data-nl-go]');
    if (g) { const [k, p] = g.dataset.nlGo.split('|'); go(k, p); return; }
    if (open && !e.target.closest('.nl-menu')) { open = null; paint(); }   // a tap anywhere else closes it
  });
  // scrolling the pretend page closes an open menu (scroll doesn't bubble, so listen on the way down)
  document.addEventListener('scroll', e => { if (open && e.target.classList && e.target.classList.contains('nl-body')) { open = null; paint(); } }, true);
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && open) { open = null; paint(); } });
  // computer only: rest the mouse on a ▾ tab for a moment to open it; leave for a moment to close
  const fine = () => window.matchMedia && matchMedia('(hover: hover) and (pointer: fine)').matches;
  document.addEventListener('mouseover', e => {
    if (!fine() || mode !== 'menus' || !e.target.closest) return;
    const h = e.target.closest('[data-nl-hover]'), inMenu = e.target.closest('.nl-menu');
    if (h || inMenu) clearTimeout(leaveT);
    if (h && h.dataset.nlHover && open !== h.dataset.nlHover) { clearTimeout(hoverT); const k = h.dataset.nlHover; hoverT = setTimeout(() => { open = k; paint(); }, 220); }
  });
  document.addEventListener('mouseout', e => {
    if (!fine() || mode !== 'menus' || !e.target.closest) return;
    if (e.target.closest('[data-nl-hover]')) clearTimeout(hoverT);
    if (open && (e.target.closest('.nl-tab') || e.target.closest('.nl-menu'))) { clearTimeout(leaveT); leaveT = setTimeout(() => { open = null; paint(); }, 300); }
  });
  return { render, paint };
})();
