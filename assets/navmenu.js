/* Section menus in the top tabs. Sections with more than one page (Game Day, League Now, Rookie Draft, Reference)
   get a small ▾ beside their tab: tapping the name goes to the section's first page as always, tapping the ▾ opens a
   menu of its pages. The page-button rows that used to sit at the top of those pages (class pg-nav) are hidden; the
   page you're on shows beside the page title instead. Menus close when you pick a page, tap outside, scroll, press
   Escape or open another. On a computer, resting the mouse on a tab for a moment opens its menu.
   The first visit after this change shows a short note about where the buttons went (until "Don't show this again"). */
(function () {
  const MENUS = {
    scores: [['#scores', 'Scoreboard'], ['#scores/players', 'Players'], ['#scores/nfl', 'NFL Scores'], ['#scores/ticket', 'Ticket Helper']],
    // League Now reads down two columns (see COLS): Standings to Analytics on the left (six), My Team to The Docket on the right (five)
    now: [['#now', 'Standings'], ['#now/rosters', 'Rosters'], ['#now/rankings', 'Rankings'], ['#now/stats', 'Stats'], ['#now/power', 'Power Rankings'], ['#now/analytics', 'Analytics'],
      ['#now/team', 'My Team'], ['#now/matchups', 'Matchups'], ['#now/playoffs', 'Playoff Picture'], ['#now/hospital', 'Hospital'], ['#now/docket', 'The Docket']],
    draft: [['#draft', 'FBP Home'], ['#draft/mock', 'Mock Draft'], ['#draft/board', 'Big Board'], ['#draft/order', 'Full Order']],
    reference: [['#reference', 'Home'], ['#reference/franchises', 'Franchises'], ['#reference/seasons', 'Seasons'], ['#reference/records', 'Records'],
      ['#reference/players', 'Players'], ['#reference/payroll', 'Payroll'], ['#reference/hof', 'HOF']],
  };
  const COLS = { now: true };
  const tabs = document.querySelector('.tabs'), top = document.querySelector('.top');
  if (!tabs || !top) return;
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  // the menu item for the page you're on: the longest link the address starts with
  const currentHref = k => { const h = location.hash || '#'; let best = null;
    (MENUS[k] || []).forEach(([href]) => { if ((h === href || h.startsWith(href + '/')) && (!best || href.length > best.length)) best = href; }); return best; };

  // a ▾ after each tab that has pages
  Object.keys(MENUS).forEach(k => {
    const a = tabs.querySelector(`a[data-tab="${k}"]`); if (!a) return;
    a.classList.add('has-menu');
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'tab-caret'; b.dataset.menu = k; b.setAttribute('aria-expanded', 'false');
    b.setAttribute('aria-label', `${a.textContent.trim()} pages`); b.innerHTML = '<span aria-hidden="true">▾</span>';
    a.after(b);
  });
  const menu = document.createElement('div');
  menu.className = 'tab-menu'; menu.hidden = true; menu.setAttribute('role', 'menu');
  top.appendChild(menu);

  let open = null, hoverT = 0, leaveT = 0;
  function show(k) {
    open = k;
    const a = tabs.querySelector(`a[data-tab="${k}"]`), cur = currentHref(k);
    menu.setAttribute('aria-label', a ? a.textContent.trim() : k);
    menu.innerHTML = MENUS[k].map(([h, l]) => `<a role="menuitem" href="${h}"${h === cur ? ' aria-current="page"' : ''}${h === '#now/team' ? ' class="tm-mine"' : ''}>${esc(l)}</a>`).join('');
    // menus listed column by column fill down the left column first
    menu.classList.toggle('tm-cols', !!COLS[k]); menu.style.gridTemplateRows = COLS[k] ? `repeat(${Math.ceil(MENUS[k].length / 2)},auto)` : '';
    menu.style.top = (tabs.offsetTop + tabs.offsetHeight) + 'px';
    menu.hidden = false;
    // wider screens: a card under its tab instead of a full-width sheet
    if (innerWidth >= 700 && a) {
      const L = a.getBoundingClientRect().left - top.getBoundingClientRect().left;
      menu.style.left = Math.max(8, Math.min(L - 6, top.clientWidth - menu.offsetWidth - 8)) + 'px';
    } else menu.style.left = '';
    tabs.querySelectorAll('.tab-caret').forEach(c => c.setAttribute('aria-expanded', String(c.dataset.menu === k)));
  }
  function hide() {
    if (!open) return; open = null; menu.hidden = true;
    tabs.querySelectorAll('.tab-caret').forEach(c => c.setAttribute('aria-expanded', 'false'));
  }
  document.addEventListener('click', e => {
    if (!e.target.closest) return;
    const c = e.target.closest('.tab-caret');
    if (c) { e.preventDefault(); clearTimeout(hoverT); if (open === c.dataset.menu) hide(); else show(c.dataset.menu); return; }
    if (open && !e.target.closest('.tab-menu')) hide();   // a tap anywhere else closes it (a tab tap still navigates)
  });
  menu.addEventListener('click', e => { if (e.target.closest('a')) hide(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && open) { const k = open; hide(); const c = tabs.querySelector(`.tab-caret[data-menu="${k}"]`); if (c) c.focus(); } });
  window.addEventListener('scroll', () => { if (open) hide(); }, { passive: true });
  tabs.addEventListener('scroll', () => { if (open) hide(); }, { passive: true });
  window.addEventListener('hashchange', hide);
  window.addEventListener('resize', () => { if (open) menu.style.top = (tabs.offsetTop + tabs.offsetHeight) + 'px'; });
  // computer only: rest the mouse on a tab with pages to open its menu; move away for a moment to close
  const fine = () => window.matchMedia && matchMedia('(hover: hover) and (pointer: fine)').matches;
  const keyOf = el => { const a = el.closest('a.has-menu'), c = el.closest('.tab-caret'); return a ? a.dataset.tab : c ? c.dataset.menu : null; };
  tabs.addEventListener('mouseover', e => {
    if (!fine()) return; const k = keyOf(e.target); clearTimeout(leaveT); clearTimeout(hoverT);
    if (k && k !== open) hoverT = setTimeout(() => show(k), 220);
  });
  const leave = () => { if (!fine()) return; clearTimeout(hoverT); clearTimeout(leaveT); if (open) leaveT = setTimeout(hide, 300); };
  tabs.addEventListener('mouseleave', leave);
  menu.addEventListener('mouseleave', leave);
  menu.addEventListener('mouseenter', () => clearTimeout(leaveT));

  // the page you're on, beside the page title, now that the page buttons are gone
  const app = document.getElementById('app');
  function crumb() {
    const pn = app && app.querySelector('.pg-nav'); if (!pn) return;
    const cur = pn.querySelector('[aria-current="page"]'), head = app.querySelector('.pagehead');
    if (!cur || !head || head.querySelector('.pg-crumb')) return;
    const h1 = head.querySelector('h1'), label = (MENUS_LABEL(cur.getAttribute('href')) || cur.textContent).trim();
    if (!h1 || /home$/i.test(label) || h1.textContent.trim().toLowerCase() === label.toLowerCase()) return;
    const s = document.createElement('span'); s.className = 'pg-crumb'; s.textContent = label;
    const asof = head.querySelector(':scope > .asof');
    if (asof && !head.classList.contains('rf-head')) asof.prepend(s); else h1.after(s);
  }
  const MENUS_LABEL = href => { for (const k in MENUS) { const m = MENUS[k].find(x => x[0] === href); if (m) return m[1]; } return null; };
  if (app && window.MutationObserver) new MutationObserver(crumb).observe(app, { childList: true, subtree: true });

  // one-time note about where the buttons went
  let seen = false; try { seen = localStorage.getItem('fbp-nav-intro') === '1'; } catch (e) {}
  if (seen) return;
  const pulse = () => { tabs.classList.add('tab-pulse'); setTimeout(() => tabs.classList.remove('tab-pulse'), 2600); };
  function intro() {
    const d = document.createElement('div');
    d.className = 'nav-intro'; d.setAttribute('role', 'dialog'); d.setAttribute('aria-modal', 'true'); d.setAttribute('aria-labelledby', 'nav-intro-h');
    d.innerHTML = `<div class="nav-intro-card">
      <h2 id="nav-intro-h">The page buttons moved up top</h2>
      <p>Game Day, League Now, Rookie Draft and Reference now have a small <b class="nav-intro-caret">▾</b> beside their name in the tabs at the top.</p>
      <p>Tap the <b class="nav-intro-caret">▾</b> to see all of that section’s pages, like Rosters, Stats, Records or the Big Board. Tap the section’s name to go to its first page, same as before.</p>
      <label class="nav-intro-chk"><input type="checkbox" checked> Don’t show this again</label>
      <button type="button" class="nav-intro-ok">Got it</button></div>`;
    document.body.appendChild(d);
    const ok = d.querySelector('.nav-intro-ok');
    const close = () => {
      try { if (d.querySelector('input').checked) localStorage.setItem('fbp-nav-intro', '1'); } catch (e) {}
      d.remove(); document.removeEventListener('keydown', onKey); pulse();
    };
    const onKey = e => { if (e.key === 'Escape') close(); };
    ok.addEventListener('click', close);
    d.addEventListener('click', e => { if (e.target === d) close(); });
    document.addEventListener('keydown', onKey);
    setTimeout(() => ok.focus({ preventScroll: true }), 50);
  }
  if (document.readyState === 'complete') setTimeout(intro, 600); else window.addEventListener('load', () => setTimeout(intro, 600));
})();
