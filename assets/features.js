/* New-feature pop-ups: a one-time infographic card announcing a new page or tool.
   Add a feature to FEATURES (newest first). Each shows once per device, in order, until "Got it" with
   "Don't show this again" checked; "Take me there" goes to the page and counts as seen. A feature stops showing
   after its `until` date. It waits for the site's other one-time notes (the menu note) to close first, and never shows
   on the feature's own page (opening that page counts as seen).
   Styling: .fx-* in site.css, the FBP infographic look (dark, gold, Oswald headers, numbered tiles). */
(function () {
  const FEATURES = [
    {
      id: 'player-news', until: '2026-12-15', href: '#now/news',
      kicker: 'New in League Now', title: 'Player News',
      sub: 'Every update on every FBP player, in one feed.',
      demo: `<div class="fx-demo" aria-hidden="true">
          <div class="fx-dc fx-dc-new"><i class="fx-dnew">New</i><span class="fx-dph"></span><span class="fx-dl"><b></b><i></i></span><span class="fx-dt"><b></b><b></b><i></i></span></div>
          <div class="fx-dc"><span class="fx-dph"></span><span class="fx-dl"><b></b><i></i></span><span class="fx-dt"><b></b><b class="fx-s"></b><i></i></span><em>📺</em></div>
        </div>`,
      tiles: [
        ['📰', 'The latest, live', 'RotoWire’s updates on all 255 rostered players, plus ESPN’s NFL headlines, newest first.'],
        ['🎯', 'Filter it your way', 'FBP rosters or free agents, any team, any position, the last 24 hours, 3 days or week. Or search a name.'],
        ['🔴', 'See what’s new', 'Updates since your last visit get a red NEW badge, and the count tells you how many.'],
        ['📺', 'Videos marked', 'A TV icon flags ESPN video links, so you know before you tap.'],
      ],
      stats: [['255', 'players checked'], ['~4 sec', 'to load them all'], ['15 min', 'between refreshes']],
      where: 'League Now <b>▾</b> › <b>Player News</b>, right under My Team',
    },
  ];

  const KEY = id => 'fbp-feature-' + id;
  const seen = id => { try { return localStorage.getItem(KEY(id)) === '1'; } catch (e) { return true; } };
  const mark = id => { try { localStorage.setItem(KEY(id), '1'); } catch (e) {} };
  const today = new Date().toISOString().slice(0, 10);
  const onPage = f => (location.hash || '#') === f.href || (location.hash || '').startsWith(f.href + '/');

  function card(f) {
    return `<div class="fx-card">
      <div class="fx-top"><span class="fx-kick">${f.kicker}</span><h2 id="fx-h">${f.title}</h2><p class="fx-sub">${f.sub}</p></div>
      ${f.demo || ''}
      <ol class="fx-tiles">${f.tiles.map(([ic, h, p], i) => `<li><span class="fx-n">${i + 1}</span><span class="fx-ic" aria-hidden="true">${ic}</span><b>${h}</b><p>${p}</p></li>`).join('')}</ol>
      ${f.stats ? `<div class="fx-stats">${f.stats.map(([v, l]) => `<span><b>${v}</b><small>${l}</small></span>`).join('')}</div>` : ''}
      ${f.where ? `<p class="fx-where"><small>Find it</small>${f.where}</p>` : ''}
      <div class="fx-foot"><label class="fx-chk"><input type="checkbox" checked> Don’t show this again</label>
        <span class="fx-btns"><button type="button" class="fx-ok">Got it</button>${f.href ? `<a class="fx-go" href="${f.href}">Take me there</a>` : ''}</span></div>
    </div>`;
  }

  function show(list) {
    const f = list.shift(); if (!f) return;
    if (onPage(f)) { mark(f.id); return show(list); }
    const d = document.createElement('div');
    d.className = 'fx-wrap'; d.setAttribute('role', 'dialog'); d.setAttribute('aria-modal', 'true'); d.setAttribute('aria-labelledby', 'fx-h');
    d.innerHTML = card(f);
    document.body.appendChild(d);
    const close = (go) => {
      if (go || d.querySelector('.fx-chk input').checked) mark(f.id);
      d.remove(); document.removeEventListener('keydown', onKey);
      if (!go) setTimeout(() => show(list), 400);
    };
    const onKey = e => { if (e.key === 'Escape') close(false); };
    d.querySelector('.fx-ok').addEventListener('click', () => close(false));
    const go = d.querySelector('.fx-go'); if (go) go.addEventListener('click', () => close(true));
    d.addEventListener('click', e => { if (e.target === d) close(false); });
    document.addEventListener('keydown', onKey);
    setTimeout(() => d.querySelector('.fx-ok').focus({ preventScroll: true }), 50);
  }

  // after the page settles, and after any other one-time note (the menu note) has closed
  function start() {
    const list = FEATURES.filter(f => !seen(f.id) && (!f.until || today <= f.until));
    if (!list.length) return;
    const wait = () => document.querySelector('.nav-intro') ? setTimeout(wait, 800) : show(list);
    setTimeout(wait, 1400);
  }
  // opening a feature's page on your own counts as seeing it
  window.addEventListener('hashchange', () => FEATURES.forEach(f => { if (onPage(f)) mark(f.id); }));
  if (document.readyState === 'complete') start(); else window.addEventListener('load', start);
})();
