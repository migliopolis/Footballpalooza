/* Game Day > NFL Scoreboard: every week of the NFL regular season from ESPN's public scoreboard.
   Week buttons like the FBP Scoreboard (current NFL week by default). Finished games show final scores, games in
   progress show the score and clock (refreshing every 30 seconds while any are on), upcoming games show the kickoff
   in the viewer's time and the network chips from the Sunday Ticket Helper. Teams on bye are listed for each week. */
(function () {
  const ESPN = 'https://site.api.espn.com/apis/site/v2/sports/football/nfl/';
  const WEEKS = 18, LIVE_MS = 30000;
  let X = null, current = null, view = null, failed = false, timer = null;
  const weeks = {};   // week -> {games, byes, at}

  const logo = ab => `<img class="nf-lg" src="https://a.espncdn.com/i/teamlogos/nfl/500/${String(ab).toLowerCase()}.png" alt="" loading="lazy" onerror="this.remove()">`;
  const day = iso => new Date(iso).toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' });
  const time = iso => new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', timeZoneName: 'short' });
  const onPage = () => location.hash.startsWith('#scores/nfl');

  function load(w) {
    const url = w ? `scoreboard?seasontype=2&week=${w}&dates=${X.season}` : 'scoreboard';
    return fetch(ESPN + url, { cache: 'no-cache' }).then(r => r.ok ? r.json() : Promise.reject()).then(sb => {
      const wk = w || ((sb.week || {}).number) || 1;
      if (!w) current = wk;
      weeks[wk] = {
        at: Date.now(),
        byes: ((sb.week || {}).teamsOnBye || []).map(t => t.abbreviation).sort(),
        games: (sb.events || []).map(ev => {
          const c = ev.competitions[0], st = ev.status || {}, t = st.type || {};
          const side = ha => { const x = c.competitors.find(k => k.homeAway === ha) || {}; const tm = x.team || {}; return { ab: tm.abbreviation || '', name: tm.shortDisplayName || tm.name || '', score: x.score != null ? x.score : '', win: !!x.winner, rec: ((x.records || [])[0] || {}).summary || '' }; };
          return { id: ev.id, date: ev.date, state: t.state, detail: t.shortDetail || '', away: side('away'), home: side('home'),
                   net: (c.broadcasts || []).flatMap(b => b.names || []).join('/'), venue: ((c.venue || {}).fullName) || '' };
        }).sort((a, b) => Date.parse(a.date) - Date.parse(b.date)),
      };
      return wk;
    });
  }
  function poll() {
    clearTimeout(timer);
    const W = weeks[view || current];
    if (!W || !W.games.some(g => g.state === 'in')) return;
    timer = setTimeout(() => { if (onPage() && !document.hidden) load(view && view !== current ? view : 0).then(paint, paint); else poll(); }, LIVE_MS);
  }
  function paint() { const el = document.getElementById('nf-root'); if (el) el.innerHTML = body(); else if (X && onPage()) X.rerender(); poll(); }
  function show(w) {
    view = w === current ? null : w;
    if (!weeks[w]) { paint(); load(w).then(paint, () => { paint(); }); } else paint();
  }

  function body() {
    if (failed) return '<p class="error">The NFL scoreboard didn’t load. Refresh the page to try again.</p>';
    if (!current) return '<p class="loading">Loading the NFL schedule…</p>';
    const esc = X.esc, w = view || current, nets = (window.FBPMultiview && FBPMultiview.nets) || (s => esc(s || ''));
    const picker = `<div class="lv-weeks" role="group" aria-label="NFL week">${Array.from({ length: WEEKS }, (_, i) => i + 1).map(k =>
      `<button type="button" data-nf-week="${k}" aria-pressed="${k === w}"${k === current ? ' title="This week"' : ''}>${k}</button>`).join('')}</div>`;
    const W = weeks[w];
    if (!W) return picker + `<p class="loading">Loading week ${w}…</p>`;
    const row = g => {
      const pre = g.state === 'pre', live = g.state === 'in';
      const team = (s, other) => `<div class="nf-t${!pre && s.win ? ' win' : ''}${!pre && !s.win && other.win ? ' lose' : ''}">${logo(s.ab)}<span class="nf-nm"><b>${esc(s.ab)}</b><small>${esc(s.name)}${s.rec ? ` · ${esc(s.rec)}` : ''}</small></span>${pre ? '' : `<span class="nf-sc">${esc(s.score)}</span>`}</div>`;
      return `<div class="card nf-g${live ? ' live' : ''}"><div class="nf-teams">${team(g.away, g.home)}${team(g.home, g.away)}</div>
        <div class="nf-st">${pre ? `<b>${time(g.date)}</b>` : live ? `<b class="nf-live">${esc(g.detail)}</b>` : `<b>${esc(g.detail || 'Final')}</b>`}<span class="mv-nets">${nets(g.net)}</span></div></div>`;
    };
    // games grouped by day
    const days = [];
    W.games.forEach(g => { const d = day(g.date); let D = days.find(x => x.d === d); if (!D) days.push(D = { d, games: [] }); D.games.push(g); });
    const done = W.games.length && W.games.every(g => g.state === 'post'), any = W.games.some(g => g.state === 'in');
    const status = done ? `Week ${w} is final.` : any ? 'Games in progress · scores refresh every 30 seconds' : W.games.some(g => g.state === 'post') ? `Week ${w} so far` : `Week ${w} schedule · times in your time zone`;
    return picker + `<div class="lv-bar"><span>${status}</span></div>` +
      days.map(D => `<h3 class="nf-day">${D.d}</h3><div class="nf-grid">${D.games.map(row).join('')}</div>`).join('') +
      `<p class="nf-bye"><b>On bye:</b> ${W.byes.length ? W.byes.map(ab => `<span class="nf-byet">${logo(ab)}${esc(ab)}</span>`).join('') : 'nobody this week'}</p>`;
  }

  function render(ctx) {
    X = ctx;
    if (!current && !failed) load(0).then(paint).catch(() => { failed = true; paint(); });
    else poll();
    return `<div class="pagehead"><h1>NFL Scoreboard</h1><span class="asof">Every week of the ${X.season} NFL season · pick a week</span></div>${X.nav || ''}<div id="nf-root">${body()}</div>`;
  }

  document.addEventListener('click', e => {
    const b = e.target.closest('[data-nf-week]'); if (b && current) show(+b.dataset.nfWeek);
  });
  window.FBPNfl = { render };
})();
