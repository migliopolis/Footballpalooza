/* League Now > Player News: the latest news on FBP players, newest first, filterable by roster, FBP team, position,
   time and name. All live from ESPN in the browser (nothing is stored in the repo):
   - every rostered player's fantasy news (ESPN's RotoWire feed, the same one as the News tab in his player box),
     fetched a few at a time, your team first; kept on this device for 15 minutes so moving around the site is quick
   - ESPN's NFL headlines, matched to any player in data/stats.json by the athletes ESPN tags (rostered or free agent)
   FBP team, slot, salary and the player list come from data/stats.json. */
window.FBPNews = (function () {
  let S = null, failed = false, loading = false, X = null;
  const NEWS = {};          // espn id -> [items] from his fantasy feed
  let HEAD = null;          // ESPN NFL headlines, matched to players
  let queue = null, done = 0, total = 0, started = false, lastDraw = 0, t0 = 0, pend = 0;
  let who = 'ro', team = '', pos = 'All', span = 3, q = '';
  const SPANS = [[1, '24 hours'], [3, '3 days'], [7, 'Week']];
  // NEW: anything published since your last visit to this page (remembered on the device). This visit's start is saved
  // right away, so the badges stay while you're here and clear on your next visit or a reload. First visit: no badges.
  let seenBefore = null, seenSet = false;
  const markVisit = () => { if (seenSet) return; seenSet = true;
    try { const v = +localStorage.getItem('fbp-news-seen'); seenBefore = v || null; localStorage.setItem('fbp-news-seen', String(Date.now())); } catch (_) {} };
  const isNew = n => seenBefore && Date.parse(n.t) > seenBefore;
  const KEY = 'fbp-news-v3', TTL = 15 * 60 * 1000, LIMIT = 6, CONC = 6;
  const FEED = id => `https://site.api.espn.com/apis/fantasy/v2/games/ffl/news/players?playerId=${id}&limit=${LIMIT}`;
  const NFL = 'https://site.api.espn.com/apis/site/v2/sports/football/nfl/news?limit=100';
  const strip = x => String(x || '').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
  const nflLogo = t => t ? `<img class="hs-nfl" src="https://a.espncdn.com/i/teamlogos/nfl/500/${FBPU.nflAbbr(t).toLowerCase()}.png" alt="${t}" loading="lazy">` : '';
  const redraw = (soft) => {
    if (!X || !X.rerender || !location.hash.startsWith('#now/news')) return;
    // while news streams in, redraw at most a bit more than once a second; a skipped redraw always runs a moment later
    if (soft && Date.now() - lastDraw < 700) { if (!pend) pend = setTimeout(() => { pend = 0; redraw(); }, 750); return; }
    if (pend) { clearTimeout(pend); pend = 0; }
    lastDraw = Date.now();
    const y = window.scrollY, f = document.activeElement && document.activeElement.classList.contains('nw-q');
    X.rerender(); window.scrollTo(0, y);
    if (f) { const i = document.querySelector('.nw-q'); if (i) { i.focus(); i.setSelectionRange(i.value.length, i.value.length); } }
  };

  // the device cache: { t, news: { espn: [items] } }
  const cacheGet = () => { try { const c = JSON.parse(sessionStorage.getItem(KEY) || 'null'); return c && Date.now() - c.t < TTL ? c : null; } catch (_) { return null; } };
  const cacheSet = () => { try { sessionStorage.setItem(KEY, JSON.stringify({ t: Date.now(), news: NEWS })); } catch (_) {} };

  // from a player's fantasy feed, only RotoWire's updates: each is about him alone. ESPN's stories and videos there are
  // roundups tagged with dozens of players; ESPN headlines come from the NFL news feed instead, once each
  const keep = (e, n) => n.type !== 'Rotowire' ? null
    : { k: 'f' + n.id, e, t: n.published || n.lastModified, h: strip(n.headline), b: strip(n.story), src: 'RotoWire', url: '' };

  function load() {
    if (S || loading || failed) return;
    loading = true;
    FBPU.json('data/stats.json').then(j => { if (j == null) throw 0; S = j; loading = false; start(); redraw(); })
      .catch(() => { failed = true; loading = false; redraw(); });
  }
  function start() {
    if (started) return; started = true; t0 = Date.now();
    const byE = {}; (S.rows || []).forEach(r => { if (r.e && r.p !== 'DEF') byE[String(r.e)] = r; });
    // ESPN headlines: one request, any player we know (rostered or free agent)
    fetch(NFL).then(r => r.ok ? r.json() : null).then(j => {
      HEAD = [];
      (j && j.articles || []).forEach(a => {
        // one card per story, under the first player ESPN tags that we know (an FBP-rostered one if there is one)
        const ids = [...new Set((a.categories || []).filter(c => c.type === 'athlete' && c.athleteId).map(c => String(c.athleteId)))].filter(id => byE[id]);
        if (!ids.length || ids.length > 3) return;
        const e = ids.find(id => byE[id].f) || ids[0], link = a.links && a.links.web && a.links.web.href;
        // videos: ESPN's Media items, or anything that links to an ESPN video page
        const vid = a.type === 'Media' || /espn\.com\/(video|watch)\b|\/video\/clip/.test(link || '');
        HEAD.push({ k: 'h' + a.id, e, t: a.published || a.lastModified, h: strip(a.headline), b: strip(a.description), src: vid ? 'ESPN video' : 'ESPN', url: link || '', vid });
      });
      redraw(true);
    }).catch(() => { HEAD = []; });
    // fantasy news: every rostered player, your team first; the device cache first if it's fresh
    const c = cacheGet();
    if (c) { Object.assign(NEWS, c.news); t0 = c.t; }
    const mine = X && X.myTeam;
    const list = (S.rows || []).filter(r => r.f && r.e && r.p !== 'DEF' && !NEWS[String(r.e)])
      .sort((a, b) => (b.f === mine) - (a.f === mine) || (a.sl === 'T') - (b.sl === 'T'));
    queue = list.map(r => String(r.e)); total = queue.length; done = 0;
    if (!total) return;
    const next = () => {
      const e = queue.shift(); if (!e) return;
      fetch(FEED(e)).then(r => r.ok ? r.json() : null).then(j => {
        NEWS[e] = (j && j.feed || []).map(n => keep(e, n)).filter(Boolean);
      }).catch(() => { NEWS[e] = NEWS[e] || []; }).then(() => {
        done++; if (done === total) { cacheSet(); redraw(); } else redraw(true);
        next();
      });
    };
    for (let i = 0; i < CONC; i++) next();
  }

  const when = iso => { const d = new Date(iso), m = (Date.now() - d) / 6e4;
    return m < 60 ? Math.max(1, Math.round(m)) + 'm ago' : m < 60 * 24 ? Math.round(m / 60) + 'h ago' : d.toLocaleDateString([], { month: 'short', day: 'numeric' }); };
  const dayOf = iso => { const d = new Date(iso), t = new Date(); t.setHours(0, 0, 0, 0);
    const x = new Date(d); x.setHours(0, 0, 0, 0); const n = Math.round((t - x) / 864e5);
    return n === 0 ? 'Today' : n === 1 ? 'Yesterday' : d.toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' }); };

  function items() {
    const byE = {}; (S.rows || []).forEach(r => { if (r.e) byE[String(r.e)] = r; });
    const seen = new Set(), out = [], cut = Date.now() - span * 864e5, qq = q.trim().toLowerCase();
    const all = [].concat(...Object.values(NEWS), HEAD || []);
    all.forEach(n => {
      const r = byE[n.e]; if (!r || !n.t) return;
      const key = n.k + ':' + n.e; if (seen.has(key)) return; seen.add(key);
      if (Date.parse(n.t) < cut) return;
      if (who === 'ro' && !r.f) return;
      if (who === 'fa' && r.f) return;
      if (team && r.f !== team) return;
      if (pos !== 'All' && r.p !== pos) return;
      if (qq && !r.n.toLowerCase().includes(qq)) return;
      out.push({ n, r });
    });
    return out.sort((a, b) => Date.parse(b.n.t) - Date.parse(a.n.t));
  }

  const med = r => (r.hon || []).some(h => h[0] === '1st Team') ? 'gold' : (r.hon || []).some(h => h[0] === '2nd Team') ? 'silver' : (r.hon || []).some(h => h[0] === 'Rookie Team') ? 'rook' : '';
  function card({ n, r }, ctx) {
    const esc = ctx.esc, t = ctx.teams[r.f] || {}, m = med(r), nw = isNew(n);
    const slot = r.sl === 'IR' ? '<i class="hs-slot">FBP IR</i>' : r.sl === 'T' ? '<i class="hs-slot">Taxi</i>' : '';
    const body = n.b && n.b !== n.h ? `<p class="nw-txt">${esc(n.b)}</p>` : '';   // the whole report, never clipped
    return `<article class="nw-card card${nw ? ' nw-new' : ''}">${nw ? '<span class="nw-badge">New</span>' : ''}
      <a class="nw-who" href="#now/player/${r.id}">
        <span class="hs-ph nw-ph${m ? '' : FBPU.tc(r.f) ? ' tcr' : ''}${m ? '' : FBPU.ovc(r.id)}"${m ? ` data-med="${m}"` : ''} style="background-image:url(${FBPU.headshot(r.e)}),var(--med,var(--ovg,var(--ov0)));${m ? '' : FBPU.tc(r.f)}">${r.f && t.logo ? `<img class="hs-fbp" src="${t.logo}" alt="${esc(t.abbr || '')}">` : ''}</span>
        <span class="hs-id"><b>${esc(r.n)}</b><small>${r.p} ${nflLogo(r.t) || 'FA'}${r.f ? ` · ${esc(t.abbr || '')}` : ' · Free agent'}${r.sal != null ? ` · $${r.sal}` : ''} ${slot}</small></span>
      </a>
      <div class="nw-body"><h3>${n.vid ? '<span class="nw-tv" role="img" aria-label="Video" title="Video">📺</span>' : ''}${n.url ? `<a href="${esc(n.url)}" target="_blank" rel="noopener">${esc(n.h)}</a>` : esc(n.h)}</h3>${body}
        <small class="nw-src">${n.src} · ${when(n.t)}</small></div>
    </article>`;
  }

  function render(ctx) {
    X = ctx; load();
    // a fresh check after 15 minutes on the page
    if (started && done >= total && Date.now() - t0 > TTL) { Object.keys(NEWS).forEach(k => delete NEWS[k]); HEAD = null; started = false; try { sessionStorage.removeItem(KEY); } catch (_) {} start(); }
    if (failed) return '<p class="error">Player news didn’t load.</p>';
    if (!S) return '<p class="loading">Loading players…</p>';
    markVisit();
    const esc = ctx.esc, L = items(), mine = ctx.myTeam;
    // your team first if you've set one, then everyone A-Z by team name (the site's usual order)
    const tn = f => (ctx.nameOf ? ctx.nameOf(f) : '') || (ctx.teams[f] || {}).abbr || f;
    const teams = Object.keys(ctx.teams).sort((a, b) => (b === mine) - (a === mine) || tn(a).localeCompare(tn(b)));
    const seg = (k, opts, cur) => `<div class="seg nw-seg">${opts.map(([v, l]) => `<button type="button" data-nw-${k}="${v}"${String(cur) === String(v) ? ' aria-pressed="true"' : ''}>${l}</button>`).join('')}</div>`;
    const chips = FBPU.divGrid(teams, f => { const t = ctx.teams[f] || {};
      return `<button type="button" class="hs-cb${team === f ? ' on' : ''}" data-nw-team="${f}" aria-pressed="${team === f}">${t.logo ? `<img src="${t.logo}" alt="">` : ''}<b>${esc(t.abbr || f)}</b></button>`; }, { mine, name: tn, cls: 'hs-cen nw-teams' });
    const prog = total && done < total ? `<p class="nw-prog"><span style="width:${Math.round(done / total * 100)}%"></span><small>Checking ESPN for ${total} FBP players · ${done} done${mine ? ' · your team first' : ''}</small></p>` : '';
    let last = '', list = '';
    L.forEach(x => { const d = dayOf(x.n.t); if (d !== last) { list += `${last ? '</div>' : ''}<h2 class="sec nw-day">${d}</h2><div class="nw-list">`; last = d; } list += card(x, ctx); });
    if (last) list += '</div>';
    const empty = done < total || HEAD == null ? '<p class="loading">Looking for news…</p>' : `<p class="nw-none">No news ${who === 'fa' ? 'on free agents ' : ''}in the last ${SPANS.find(s => s[0] === span)[1].toLowerCase()}${team || pos !== 'All' || q ? ' for these filters' : ''}.</p>`;
    return `<div class="nw-page">
      <div class="nw-bar">
        ${seg('who', [['ro', 'FBP rosters'], ['fa', 'Free agents'], ['all', 'All']], who)}
        ${seg('pos', ['All', 'QB', 'RB', 'WR', 'TE'].map(p => [p, p]), pos)}
        ${seg('span', SPANS, span)}
        <input type="search" class="nw-q" placeholder="Find a player" aria-label="Find a player" value="${esc(q)}" autocomplete="off">
      </div>
      ${who === 'fa' ? '' : chips}
      ${prog}
      <p class="nw-count">${L.length} update${L.length === 1 ? '' : 's'}${team ? ` for ${esc(tn(team))}` : ''}${(() => { const k = L.filter(x => isNew(x.n)).length; return k ? ` · <b class="nw-newc">${k} new since your last visit</b>` : ''; })()}</p>
      ${list || empty}
      <p class="rf-foot">News comes live from ESPN: RotoWire’s fantasy updates for every player on an FBP roster, plus ESPN’s NFL headlines about one to three players, shown once under the first player tagged. Free agents show up only when they make the headlines. Tap a player for his Player Page; ESPN headlines open the story on ESPN; 📺 marks a video. Checked again when you come back after 15 minutes.</p>
    </div>`;
  }

  document.addEventListener('click', e => {
    const b = e.target.closest && e.target.closest('[data-nw-who],[data-nw-pos],[data-nw-span],[data-nw-team],[data-nw-exp]'); if (!b || !document.querySelector('.nw-page')) return;
    const d = b.dataset;
    if (d.nwExp) { exp.has(d.nwExp) ? exp.delete(d.nwExp) : exp.add(d.nwExp); }
    else if (d.nwWho) { who = d.nwWho; if (who === 'fa') team = ''; }
    else if (d.nwPos) pos = d.nwPos;
    else if (d.nwSpan) span = +d.nwSpan;
    else if (d.nwTeam) { team = team === d.nwTeam ? '' : d.nwTeam; if (team) who = 'ro'; }
    redraw();
  });
  document.addEventListener('input', e => { if (e.target.matches && e.target.matches('.nw-q')) { q = e.target.value; redraw(); } });
  return { render };
})();
