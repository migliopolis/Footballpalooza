/* Game Day > NFL Scoreboard: every week of the NFL regular season from ESPN's public scoreboard.
   Week buttons like the FBP Scoreboard (current NFL week by default). Finished games show final scores, games in
   progress show the score and clock (refreshing every 30 seconds while any are on), upcoming games show the kickoff
   in the viewer's time and the network chips from the Sunday Ticket Helper. Teams on bye are listed for each week. */
(function () {
  const ESPN = 'https://site.api.espn.com/apis/site/v2/sports/football/nfl/';
  const WEEKS = 18, LIVE_MS = 30000;
  let X = null, current = null, view = null, failed = false, timer = null;
  const weeks = {};   // week -> {games, byes, at}
  const LIVE_URL = 'https://fbp-live.pmiglio-gchat.workers.dev/';   // relay: every player's FBP points for a week (?t=all)
  const TEAM = { GBP: 'GB', KCC: 'KC', NEP: 'NE', NOS: 'NO', SFO: 'SF', TBB: 'TB', LVR: 'LV', JAC: 'JAX', WAS: 'WSH', LA: 'LAR' };
  const open = new Set(), sum = {}, fbp = {};   // open game ids; ESPN game summaries by id; FBP points by week
  let mfl = null, owners = null;

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
      const o = open.has(g.id);
      return `<div class="card nf-g${live ? ' live' : ''}${o ? ' open' : ''}"><button type="button" class="nf-sum" data-nf-g="${g.id}" aria-expanded="${o}"><div class="nf-teams">${team(g.away, g.home)}${team(g.home, g.away)}</div>
        <div class="nf-st">${pre ? `<b>${time(g.date)}</b>` : live ? `<b class="nf-live">${esc(g.detail)}</b>` : `<b>${esc(g.detail || 'Final')}</b>`}<span class="mv-nets">${nets(g.net)}</span></div></button>${o ? `<div class="nf-det">${detail(g, w)}</div>` : ''}</div>`;
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

  // the expanded game: line score, scoring plays, ESPN's game leaders, team stats and the game's best FBP scorers
  function loadSum(id, live) {
    const S = sum[id];
    if (S && (S.busy || (!live && S.d) || (live && Date.now() - S.at < LIVE_MS - 1000))) return;
    sum[id] = Object.assign(S || {}, { busy: true, at: Date.now() });
    fetch(ESPN + 'summary?event=' + id, { cache: 'no-cache' }).then(r => r.ok ? r.json() : Promise.reject()).then(d => { sum[id].d = d; }, () => { sum[id].err = !sum[id].d; })
      .then(() => { sum[id].busy = false; if (open.has(id)) paint(); });
  }
  function loadFbp(w) {
    const F = fbp[w];
    if (F && (F.busy || Date.now() - F.at < 60000)) return;
    fbp[w] = Object.assign(F || {}, { busy: true, at: Date.now() });
    Promise.all([
      mfl ? null : fetch('data/mfl/players.json').then(r => r.ok ? r.json() : null).then(p => { mfl = p ? Object.fromEntries(Object.entries(p.players).map(([k, v]) => [k, { name: v[0], pos: v[1], team: TEAM[v[2]] || v[2] }])) : {}; }),
      owners ? null : fetch('data/mfl/rosters.json').then(r => r.ok ? r.json() : null).then(j => { owners = {};
        (((j || {}).rosters || {}).franchise || []).forEach(f => (f.player || []).forEach(p => { owners[p.id] = f.id; })); }),
      fetch(`${LIVE_URL}?t=all&w=${w}`, { cache: 'no-cache' }).then(r => r.ok ? r.json() : null).then(j => { fbp[w].scores = j && j.playerScores ? [].concat(j.playerScores.playerScore || []) : null; }),
    ]).catch(() => {}).then(() => { fbp[w].busy = false; if (open.size) paint(); });
  }
  const short = n => { const [last, first] = String(n || '').split(', '); return first ? `${first[0]}. ${last}` : last; };
  function detail(g, w) {
    const esc = X.esc, live = g.state === 'in';
    if (g.state === 'pre') { loadSum(g.id, false); }
    else { loadSum(g.id, live); loadFbp(w); }
    const S = sum[g.id] || {}, d = S.d;
    if (!d) return S.err ? '<p class="error">The game details didn’t load.</p>' : '<p class="loading">Loading the game…</p>';
    const comp = ((d.header || {}).competitions || [])[0] || {}, cs = comp.competitors || [];
    const side = ha => cs.find(c => c.homeAway === ha) || {}, A = side('away'), H = side('home');
    const ab = c => (c.team || {}).abbreviation || '';
    const out = [];
    if (g.state === 'pre') {
      const gi = d.gameInfo || {}, v = gi.venue || {}, wx = gi.weather || {};
      const odds = ((d.pickcenter || [])[0]) || {};
      out.push(`<div class="nf-pre">${v.fullName ? `<p><b>${esc(v.fullName)}</b>${(v.address || {}).city ? ` · ${esc(v.address.city)}${v.address.state ? ', ' + esc(v.address.state) : ''}` : ''}</p>` : ''}
        ${wx.temperature != null ? `<p>Forecast: ${esc(String(wx.temperature))}° ${esc(wx.displayValue || '')}</p>` : ''}
        ${odds.details ? `<p>Line: ${esc(odds.details)}${odds.overUnder ? ` · O/U ${esc(String(odds.overUnder))}` : ''}</p>` : ''}</div>`);
    }
    // line score
    const qs = Math.max((A.linescores || []).length, (H.linescores || []).length);
    if (qs) {
      const cell = (c, i) => { const l = (c.linescores || [])[i]; return `<td>${l ? esc(String(l.displayValue != null ? l.displayValue : l.value)) : ''}</td>`; };
      const hd = Array.from({ length: qs }, (_, i) => `<th>${i < 4 ? i + 1 : i === 4 ? 'OT' : 'OT' + (i - 3)}</th>`).join('');
      out.push(`<table class="nf-ls"><thead><tr><th></th>${hd}<th>T</th></tr></thead><tbody>${[A, H].map(c => `<tr><th>${logo(ab(c))}${esc(ab(c))}</th>${Array.from({ length: qs }, (_, i) => cell(c, i)).join('')}<td><b>${esc(String(c.score || 0))}</b></td></tr>`).join('')}</tbody></table>`);
    }
    // the game's best FBP scorers
    const F = fbp[w] || {};
    if (g.state !== 'pre' && F.scores && mfl) {
      const teams = [g.away.ab, g.home.ab];
      const top = F.scores.filter(x => mfl[x.id] && teams.includes(mfl[x.id].team) && +x.score).sort((a, b) => +b.score - +a.score).slice(0, 6);
      if (top.length) out.push(`<section><h4 class="nf-h">Top FBP scorers</h4><ol class="nf-fp">${top.map(x => {
        const p = mfl[x.id], fid = owners && owners[x.id], t = fid && X.teams[fid];
        return `<li>${logo(p.team)}<span class="nf-fpn"><b>${esc(p.pos === 'Def' ? p.team + ' D/ST' : short(p.name))}</b><small>${esc(p.pos === 'Def' ? 'DEF' : p.pos)} · ${fid ? `${t && t.logo ? `<img class="nf-fbp" src="${t.logo}" alt="">` : ''}${esc((t && t.abbr) || X.nameOf(fid))}` : 'Free agent'}</small></span><b class="nf-fps">${(Math.round(+x.score * 10) / 10).toFixed(1)}</b></li>`; }).join('')}</ol></section>`);
    }
    // scoring plays
    const sp = d.scoringPlays || [];
    if (sp.length) out.push(`<section><h4 class="nf-h">Scoring plays</h4><ol class="nf-sp">${sp.map(p => `<li>${logo((p.team || {}).abbreviation)}<span class="nf-spt"><small>Q${(p.period || {}).number || ''} ${esc((p.clock || {}).displayValue || '')} · ${esc((p.type || {}).abbreviation || (p.type || {}).text || '')}</small>${esc(p.text || '')}</span><span class="nf-sps">${esc(String(p.awayScore))}–${esc(String(p.homeScore))}</span></li>`).join('')}</ol></section>`);
    // game leaders
    const ld = d.leaders || [];
    if (ld.length && g.state !== 'pre') {
      const cats = ['passingYards', 'rushingYards', 'receivingYards'];
      const rows = cats.map(k => { const per = ld.map(t => ((t.leaders || []).find(c => c.name === k) || {}));
        const nm = (per.find(c => c.displayName) || {}).displayName; if (!nm) return '';
        return `<tr><th>${esc(nm.replace(/ Yards$/, ''))}</th>${ld.map((t, i) => { const l = ((per[i] || {}).leaders || [])[0]; return `<td>${l ? `<b>${esc((l.athlete || {}).shortName || (l.athlete || {}).displayName || '')}</b><small>${esc(l.displayValue || '')}</small>` : ''}</td>`; }).join('')}</tr>`; }).join('');
      if (rows) out.push(`<section><h4 class="nf-h">Leaders</h4><table class="nf-ld"><thead><tr><th></th>${ld.map(t => `<th>${logo((t.team || {}).abbreviation)}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table></section>`);
    }
    // team stats
    const bt = (d.boxscore || {}).teams || [];
    if (bt.length === 2 && g.state !== 'pre') {
      const want = ['firstDowns', 'totalYards', 'netPassingYards', 'rushingYards', 'turnovers', 'totalPenaltiesYards', 'thirdDownEff', 'possessionTime'];
      const st = t => Object.fromEntries((t.statistics || []).map(x => [x.name, x]));
      const a = st(bt[0]), b = st(bt[1]);
      const rows = want.filter(k => a[k] || b[k]).map(k => `<tr><td>${esc((a[k] || {}).displayValue || '')}</td><th>${esc((a[k] || b[k]).label || k)}</th><td>${esc((b[k] || {}).displayValue || '')}</td></tr>`).join('');
      if (rows) out.push(`<section><h4 class="nf-h">Team stats</h4><table class="nf-ts"><thead><tr><th>${logo((bt[0].team || {}).abbreviation)}</th><th></th><th>${logo((bt[1].team || {}).abbreviation)}</th></tr></thead><tbody>${rows}</tbody></table></section>`);
    }
    if (out.length <= (qs ? 1 : 0) && g.state !== 'pre') out.push('<p class="muted">More details show up once the game gets going.</p>');
    out.push(`<p class="nf-more"><a href="https://www.espn.com/nfl/game/_/gameId/${g.id}" target="_blank" rel="noopener">Full box score on ESPN ↗</a></p>`);
    return out.join('');
  }

  function render(ctx) {
    X = ctx;
    if (!current && !failed) load(0).then(paint).catch(() => { failed = true; paint(); });
    else poll();
    return `<div class="pagehead"><h1>NFL Scoreboard</h1><span class="asof">Every week of the ${X.season} NFL season · pick a week</span></div>${X.nav || ''}<div id="nf-root">${body()}</div>`;
  }

  document.addEventListener('click', e => {
    const b = e.target.closest('[data-nf-week]'); if (b && current) { open.clear(); show(+b.dataset.nfWeek); return; }
    const g = e.target.closest('[data-nf-g]'); if (g) { const id = g.dataset.nfG; if (open.has(id)) open.delete(id); else open.add(id); paint(); }
  });
  window.FBPNfl = { render };
})();
