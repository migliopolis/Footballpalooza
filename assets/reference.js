/* Reference tab: the FBP Reference almanac (franchises, seasons, records), folded into the hub.
   Data: data/reference.json, rebuilt each week by scripts/build_reference.py from the frozen
   history (data/reference/history.json) plus the current season from the MFL refresh.
   Routes: #reference, #reference/franchises, #reference/f-0001, #reference/seasons,
           #reference/s-2025[/draft|auction|results[/wk]], #reference/records[/<board>]          */
window.FBPRef = (() => {
  let D = null, loading = null, failed = false;
  const load = rerender => {
    if (D || loading) return;
    loading = fetch('data/reference.json', { cache: 'no-cache' }).then(r => { if (!r.ok) throw 0; return r.json(); })
      .then(d => { D = d; rerender(); }).catch(() => { failed = true; rerender(); });
  };

  let X;   // context from site.js: teams, chip, esc
  const esc = s => X.esc(s == null ? '' : s);
  const n1 = v => v == null || v === '' ? '—' : Number(v).toFixed(1);
  const n0 = v => v == null ? '—' : Math.round(Number(v)).toLocaleString();
  const rec = (w, l, t) => t ? `${w}-${l}-${t}` : `${w}-${l}`;
  const pct = v => (v * 100).toFixed(1) + '%';
  const nm = (fr, y) => { const s = y && (D.franchise_seasons[fr] || []).find(x => x.year === y); return s ? s.name : D.franchises[fr] || fr; };
  const person = n => { n = (n || '').trim(); const i = n.indexOf(','); return i > 0 ? `${n.slice(i + 1).trim()} ${n.slice(0, i).trim()}` : n; };
  const logo = fr => { const t = X.teams[fr]; return t && t.logo ? `<img src="${t.logo}" alt="" loading="lazy">` : ''; };
  // a team, linked to its franchise page, under the name it used that season
  const tl = (fr, y, label) => `<a class="rf-tm" href="#reference/f-${fr}">${X.chip(fr, { name: label || nm(fr, y) })}</a>`;
  const lgCell = fr => `<td class="lg">${logo(fr)}</td>`;
  const nameCell = (fr, y, label) => `<td class="t"><a class="rf-nm" href="#reference/f-${fr}">${esc(label || nm(fr, y))}</a></td>`;
  const champOf = y => D.championships[y] || D.championships[String(y)];
  const badge = (fr, y) => { const c = champOf(y); return c && c.champion === fr ? '<span class="rf-badge gold" title="Champion">🏆</span>' : c && c.runnerup === fr ? '<span class="rf-badge">2nd</span>' : ''; };
  const lastDone = () => Math.max(...Object.keys(D.championships).map(Number));
  const years = () => D.meta.years_covered.slice().sort((a, b) => a - b);
  const sub = (items, cur) => `<nav class="rf-sub">${items.map(([h, l]) => `<a href="${h}"${h === cur ? ' aria-current="page"' : ''}>${l}</a>`).join('')}</nav>`;
  const lum = h => { h = (h || '#888').replace('#', ''); const [r, g, b] = [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16)); return (0.299 * r + 0.587 * g + 0.114 * b) / 255; };

  function nav(top) {
    return sub([['#reference', 'Home'], ['#reference/franchises', 'Franchises'], ['#reference/seasons', 'Seasons'], ['#reference/records', 'Records']], top);
  }
  function head(title, extra = '') {
    const m = D.meta;
    return `<div class="pagehead"><h1>${title}</h1><span class="asof">FBP history 2019–${m.current_year}${m.current_week ? ` · ${m.current_year} through week ${m.current_week}` : ''}</span></div>${extra}`;
  }

  /* ---------- home ---------- */
  function pageHome(ppr) {
    const y = lastDone();
    const rows = Object.keys(D.franchises).map(fr => (D.franchise_seasons[fr] || []).find(s => s.year === y) && Object.assign({ fr }, D.franchise_seasons[fr].find(s => s.year === y))).filter(Boolean).sort((a, b) => a.rank - b.rank);
    const at = Object.entries(D.franchise_alltime);
    const titles = at.map(([fr, a]) => [fr, a.championships.length]).sort((a, b) => b[1] - a[1]);
    const most = titles.filter(t => t[1] === titles[0][1]);
    const best = at.slice().sort((a, b) => b[1].win_pct - a[1].win_pct)[0];
    const hi = D.leaderboards.top_single_game_scores[0];
    const champs = Object.keys(D.championships).sort((a, b) => b - a);
    const ids = Object.keys(D.franchises).sort((a, b) => D.franchises[a].localeCompare(D.franchises[b]));
    return head('Reference') + nav('#reference') +
      (ppr ? `<p class="rf-note">P-PPR is on, but no pre-2019 seasons are loaded yet. They’ll show up here once the old league-history spreadsheets are added.</p>` : '') +
      `<section class="rf-tiles">
        <div class="card rf-tile"><span>Seasons</span><b>${years().length}</b><small>2019–${D.meta.current_year}</small></div>
        <div class="card rf-tile"><span>Most titles</span><b>${titles[0][1]}</b><small>${most.map(t => esc(D.franchises[t[0]])).join(', ')}</small></div>
        <div class="card rf-tile"><span>Best all-time win%</span><b>${pct(best[1].win_pct)}</b><small>${esc(D.franchises[best[0]])}</small></div>
        <div class="card rf-tile"><span>Highest score</span><b>${n1(hi.score)}</b><small>${esc(hi.name)}, ${hi.year} wk ${hi.week}</small></div>
      </section>
      <div class="grid2">
        <section><h2 class="sec">${y} final standings <small><a href="#reference/s-${y}">Full season</a></small></h2>
          <div class="card tbl-wrap"><table class="tbl rf-t"><thead><tr><th class="lg"><span class="sr">Logo</span></th><th class="t">Team</th><th>W-L-T</th><th>PF</th><th>All-play</th><th>Fin</th></tr></thead><tbody>
          ${rows.map(s => `<tr>${lgCell(s.fr)}${nameCell(s.fr, y, s.name)}<td>${rec(s.w, s.l, s.t)}</td><td>${n1(s.pf)}</td><td>${esc(s.all_play || '—')}</td><td>${badge(s.fr, y) || s.rank}</td></tr>`).join('')}
          </tbody></table></div></section>
        <section><h2 class="sec">Champions</h2><div class="card rf-champs">
          ${champs.map(cy => { const c = D.championships[cy]; return `<a class="rf-champ" href="#reference/s-${cy}"><span class="yr">${cy}</span>${X.chip(c.champion, { name: nm(c.champion, +cy) })}<span class="sc">def. ${esc(nm(c.runnerup, +cy))}<br>${esc(c.score)}</span></a>`; }).join('')}
        </div></section>
      </div>
      <section><h2 class="sec">Franchises</h2><div class="rf-teams">
        ${ids.map(fr => { const a = D.franchise_alltime[fr]; return `<a class="card rf-team" href="#reference/f-${fr}">${logo(fr)}<span><b>${esc(D.franchises[fr])}</b><small>${rec(a.w, a.l, a.t)}${a.championships.length ? ` · 🏆 ${a.championships.length}` : ''}</small></span></a>`; }).join('')}
      </div></section>`;
  }

  /* ---------- franchises ---------- */
  function pageFranchises() {
    const ids = Object.keys(D.franchises).sort((a, b) => D.franchise_alltime[b].win_pct - D.franchise_alltime[a].win_pct);
    return head('Franchises') + nav('#reference/franchises') +
      `<section><h2 class="sec">All-time <small>regular season, ranked by win%</small></h2>
      <div class="card tbl-wrap"><table class="tbl rf-t"><thead><tr><th class="lg"><span class="sr">Logo</span></th><th class="t">Franchise</th><th>W-L-T</th><th>Win%</th><th>Titles</th><th>2nd</th><th>Points</th><th>Seasons</th></tr></thead><tbody>
      ${ids.map(fr => { const a = D.franchise_alltime[fr]; return `<tr>${lgCell(fr)}${nameCell(fr)}<td>${rec(a.w, a.l, a.t)}</td><td>${pct(a.win_pct)}</td><td>${a.championships.length ? '🏆 ' + a.championships.length : '—'}</td><td>${a.runnerups.length || '—'}</td><td>${n0(a.total_pf)}</td><td>${a.seasons_played}</td></tr>`; }).join('')}
      </tbody></table></div></section>`;
  }

  function pageFranchise(fr) {
    if (!D.franchises[fr]) return pageFranchises();
    const a = D.franchise_alltime[fr], tm = X.teams[fr] || {};
    let bg = tm.primary || '#555', ac = tm.secondary || '#fff';
    if (lum(bg) > 0.85) [bg, ac] = [ac, bg];
    const fg = lum(bg) > 0.6 ? '#121519' : '#ffffff';
    const seasons = (D.franchise_seasons[fr] || []).slice().sort((x, y) => y.year - x.year);
    const names = [...new Set(seasons.map(s => s.name))].filter(n => n !== D.franchises[fr]);
    const h2h = Object.entries(D.head_to_head[fr] || {}).sort((x, y) => D.franchises[x[0]].localeCompare(D.franchises[y[0]]));
    const ids = Object.keys(D.franchises).sort((x, y) => D.franchises[x].localeCompare(D.franchises[y]));
    return head('Franchises') + nav('#reference/franchises') +
      `<nav class="rf-switch" aria-label="Franchise">${ids.map(id => `<a href="#reference/f-${id}" title="${esc(D.franchises[id])}"${id === fr ? ' aria-current="page"' : ''}>${logo(id) || esc((X.teams[id] || {}).abbr || id)}</a>`).join('')}</nav>
      <section class="rf-band" style="background:${bg};color:${fg};border-bottom-color:${ac}">
        ${tm.logo ? `<img src="${tm.logo}" alt="">` : ''}
        <div><h2>${esc(D.franchises[fr])}</h2>
        <p>${rec(a.w, a.l, a.t)} all-time (${pct(a.win_pct)}) · ${a.championships.length ? `🏆 ${a.championships.join(', ')}` : 'No titles yet'}${a.runnerups.length ? ` · 2nd ${a.runnerups.join(', ')}` : ''}</p>
        ${names.length ? `<p class="aka">Also played as ${names.map(esc).join(', ')}</p>` : ''}</div>
      </section>
      <section><h2 class="sec">Year by year</h2>
      <div class="card tbl-wrap"><table class="tbl rf-t"><thead><tr><th>Year</th><th class="t">Team name</th><th>Fin</th><th>W-L-T</th><th>PF</th><th>PA</th><th>All-play</th></tr></thead><tbody>
      ${seasons.map(s => `<tr><td><a class="rf-nm" href="#reference/s-${s.year}">${s.year}</a></td><td class="t">${esc(s.name)}</td><td>${badge(fr, s.year) || (s.rank ? s.rank + (s.year === D.meta.current_year && !champOf(s.year) ? '*' : '') : '—')}</td><td>${rec(s.w, s.l, s.t)}</td><td>${n1(s.pf)}</td><td>${n1(s.pa)}</td><td>${esc(s.all_play || '—')}</td></tr>`).join('')}
      </tbody></table></div>${seasons.some(s => s.year === D.meta.current_year && !champOf(s.year)) ? `<p class="rf-foot">* ${D.meta.current_year} is in progress; that’s the current standing.</p>` : ''}</section>
      <section><h2 class="sec">Head-to-head <small>every game, playoffs included</small></h2>
      <div class="card rf-h2h">${h2h.map(([o, r]) => { const g = r.w + r.l + r.t, p = g ? (r.w + r.t / 2) / g : 0; return `<a href="#reference/f-${o}" class="rf-h2hrow">${X.chip(o, { name: D.franchises[o] })}<span class="bar"><i style="width:${(p * 100).toFixed(0)}%"></i></span><b>${rec(r.w, r.l, r.t)}</b></a>`; }).join('')}</div></section>
      <section><h2 class="sec">Rookie draft history</h2>${picksTable(D.franchise_draft_picks[fr] || [], false)}</section>`;
  }

  /* rookie picks with fantasy points by season */
  function picksTable(picks, byFranchise, year) {
    if (!picks.length) return `<p class="rf-note">${byFranchise ? 'Round-based rookie drafts started in 2021; earlier rookies came through the startup auctions.' : 'No rookie picks on record.'}</p>`;
    const ys = [...new Set(picks.flatMap(p => (p.points_by_season || []).map(x => x.year)))].sort();
    const moved = picks.some(p => p.kept_by_drafting_team === false);
    return `<div class="card tbl-wrap"><table class="tbl rf-t"><thead><tr><th>Pick</th>${byFranchise ? '<th class="lg"><span class="sr">Logo</span></th>' : ''}<th class="t">Player</th><th>Pos</th><th>$</th>${ys.map(y => `<th>${y}</th>`).join('')}${ys.length ? '<th>Total</th><th>Avg</th>' : ''}</tr></thead><tbody>
      ${picks.map(p => { const yr = p.year || year; return `<tr><td>${byFranchise ? '' : yr + ' · '}${+p.round}.${String(+p.pick).padStart(2, '0')}</td>${byFranchise ? lgCell(p.franchise) : ''}<td class="t">${esc(person(p.player_name) || 'Player #' + p.player_id)}${byFranchise ? `<small class="rf-by">${esc(nm(p.franchise, yr))}</small>` : ''}</td><td>${esc(p.player_pos || '')}</td><td>${p.drafted_price != null ? '$' + p.drafted_price + (p.kept_by_drafting_team === false ? '†' : '') : '—'}</td>${ys.map(y => { if (y < yr) return '<td></td>'; const s = (p.points_by_season || []).find(x => x.year === y); return `<td>${s && s.points != null ? n1(s.points) : '—'}</td>`; }).join('')}${ys.length ? `<td>${n1(p.total_points)}</td><td>${n1(p.avg_points_per_season)}</td>` : ''}</tr>`; }).join('')}
      </tbody></table></div>${!ys.length && picks.length ? '<p class="rf-foot">Points by season fill in once the season is done.</p>' : ''}${moved ? '<p class="rf-foot">† Left the drafting team before the end of his rookie season (traded or dropped), so later points may be for another team.</p>' : ''}`;
  }

  /* ---------- seasons ---------- */
  function pageSeasons() {
    return head('Seasons') + nav('#reference/seasons') + `<section class="rf-seasons">${years().reverse().map(y => {
      const c = champOf(y);
      return `<a class="card rf-season" href="#reference/s-${y}"><b>${y}</b>${c ? `${X.chip(c.champion, { name: nm(c.champion, y) })}<small>def. ${esc(nm(c.runnerup, y))} ${esc(c.score)}</small>` : `<small>In progress${y === D.meta.current_year && D.meta.current_week ? ` · through week ${D.meta.current_week}` : ''}</small>`}</a>`;
    }).join('')}</section>`;
  }

  function game(g, y, lbl) {
    const fin = g.scoreA != null && g.scoreA !== '';
    const aw = fin && +g.scoreA > +g.scoreB, bw = fin && +g.scoreB > +g.scoreA;
    const row = (fr, sc, w) => `<div class="row${w ? ' win' : ''}">${tl(fr, y)}<span class="meta">${fin ? n1(sc) : ''}</span></div>`;
    return `<div class="game">${lbl ? `<div class="lbl">${lbl}</div>` : ''}${row(g.franchiseA, g.scoreA, aw)}${row(g.franchiseB, g.scoreB, bw)}</div>`;
  }

  function pageSeason(y, tab, wk) {
    const ys = years(); if (!ys.includes(y)) return pageSeasons();
    const i = ys.indexOf(y), c = champOf(y), br = D.playoff_brackets[y] || D.playoff_brackets[String(y)];
    const rows = Object.keys(D.franchises).map(fr => { const s = (D.franchise_seasons[fr] || []).find(x => x.year === y); return s && Object.assign({ fr }, s); }).filter(Boolean).sort((a, b) => a.rank - b.rank);
    const live = y === D.meta.current_year && !c;
    tab = tab || 'results';
    const base = `#reference/s-${y}`;
    let body;
    if (tab === 'draft') body = picksTable((D.draft_classes[y] || D.draft_classes[String(y)] || []), true, y);
    else if (tab === 'auction') body = auctionTable(y);
    else body = resultsHtml(y, wk);
    return head('Seasons') + nav('#reference/seasons') +
      `<div class="rf-yrnav">${i > 0 ? `<a href="#reference/s-${ys[i - 1]}">← ${ys[i - 1]}</a>` : '<span></span>'}<h2>${y}${c ? ` · <span>${esc(nm(c.champion, y))} 🏆</span>` : live ? ' · <span>in progress</span>' : ''}</h2>${i < ys.length - 1 ? `<a href="#reference/s-${ys[i + 1]}">${ys[i + 1]} →</a>` : '<span></span>'}</div>
      <section><h2 class="sec">${live ? 'Standings' : 'Final standings'}${live && D.meta.current_week ? ` <small>through week ${D.meta.current_week}</small>` : ''}</h2>
        <div class="card tbl-wrap"><table class="tbl rf-t"><thead><tr><th>#</th><th class="lg"><span class="sr">Logo</span></th><th class="t">Team</th><th>W-L-T</th><th>PF</th><th>PA</th><th>All-play</th></tr></thead><tbody>
        ${rows.map(s => `<tr><td>${s.rank || '—'}</td>${lgCell(s.fr)}<td class="t"><a class="rf-nm" href="#reference/f-${s.fr}">${esc(s.name)}</a>${badge(s.fr, y)}</td><td>${rec(s.w, s.l, s.t)}</td><td>${n1(s.pf)}</td><td>${n1(s.pa)}</td><td>${esc(s.all_play || '—')}</td></tr>`).join('')}
        </tbody></table></div></section>
      <section><h2 class="sec">Playoffs</h2>${br ? `<div class="card bracket rf-bracket">
        <div class="round"><h3>Round 1 · week ${br.round1_week}</h3>${br.round1_games.map(g => game(g, y)).join('')}<p class="rf-foot">Byes: ${br.byes.map(b => esc(nm(b, y))).join(', ')}</p></div>
        <div class="round"><h3>Semifinals · week ${br.semi_week}</h3>${br.semifinal_games.length ? br.semifinal_games.map(g => game(g, y)).join('') : '<p class="rf-foot">To be played.</p>'}</div>
        <div class="round"><h3>Championship · week ${br.championship_week}</h3>${br.championship_game ? game(br.championship_game, y) : '<p class="rf-foot">To be played.</p>'}</div>
      </div>` : `<div class="card rf-pad"><p class="rf-note">${live ? 'The bracket fills in here once the playoffs start. The live picture is on <a href="#now">League Now</a>.' : 'No bracket on record for this season.'}</p></div>`}</section>
      <section>${sub([[base, 'Weekly results'], [base + '/draft', 'Rookie draft'], [base + '/auction', 'Auction']], tab === 'results' ? base : base + '/' + tab)}<div class="rf-body">${body}</div></section>`;
  }

  function resultsHtml(y, wk) {
    const gs = (D.schedules_by_year[y] || D.schedules_by_year[String(y)] || []);
    const weeks = [...new Set(gs.map(g => +g.week))].sort((a, b) => a - b);
    const played = weeks.filter(w => gs.some(g => +g.week === w && g.scoreA !== ''));
    if (!played.length) return '<p class="rf-note">No games played yet.</p>';
    const w = weeks.includes(wk) ? wk : played[played.length - 1];
    const po = (D.playoff_weeks_by_year[y] || D.playoff_weeks_by_year[String(y)] || [99])[0];
    const these = gs.filter(g => +g.week === w);
    return `<nav class="rf-weeks" aria-label="Week">${weeks.map(n => `<a href="#reference/s-${y}/results/${n}"${n === w ? ' aria-current="page"' : ''}${played.includes(n) ? '' : ' class="dim"'}>${n >= po ? 'P' + (n - po + 1) : n}</a>`).join('')}</nav>
      <h3 class="rf-wkh">Week ${w}${w >= po ? ' · playoffs and consolation' : ''}</h3>
      <div class="rf-games">${these.map(g => game(g, y)).join('')}</div>`;
  }

  function auctionTable(y) {
    const list = D.auction_results[y] || D.auction_results[String(y)] || [];
    if (!list.length) return '<p class="rf-note">No auction on record for this season.</p>';
    const total = list.reduce((s, p) => s + (p.price || 0), 0);
    return `<p class="rf-foot" style="margin:0 0 8px">${list.length} players won · $${total} spent · $${(total / list.length).toFixed(2)} average</p>
      <div class="card tbl-wrap"><table class="tbl rf-t"><thead><tr><th>#</th><th class="lg"><span class="sr">Logo</span></th><th class="t">Player</th><th>Pos</th><th>$</th></tr></thead><tbody>
      ${list.map((p, i) => `<tr><td>${i + 1}</td>${lgCell(p.franchise)}<td class="t">${esc(person(p.player_name) || 'Player #' + p.player_id)}<small class="rf-by">${esc(nm(p.franchise, y))}</small></td><td>${esc(p.player_pos || '')}</td><td>$${p.price != null ? p.price : '—'}</td></tr>`).join('')}
      </tbody></table></div>`;
  }

  /* ---------- records ---------- */
  const BOARDS = [['career', 'Career PPG'], ['season', 'Season PPG'], ['playoff', 'Playoff PPG'], ['games', 'Single games'], ['margins', 'Blowouts & nail-biters'], ['stretch', 'Two-game stretches']];
  function tbl(cols, rows) {
    return `<div class="card tbl-wrap"><table class="tbl rf-t"><thead><tr>${cols.map(c => c === 'lg' ? '<th class="lg"><span class="sr">Logo</span></th>' : c[0] === '!' ? `<th class="t">${c.slice(1)}</th>` : `<th>${c}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table></div>`;
  }
  function pageRecords(b) {
    const L = D.leaderboards;
    b = BOARDS.some(x => x[0] === b) ? b : 'career';
    const yw = r => `<a class="rf-nm" href="#reference/s-${r.year}/results/${r.week}">${r.year} wk ${r.week}</a>`;
    let body = '';
    if (b === 'career') body = `<h2 class="sec">Career points per game <small>regular season</small></h2>` + tbl(['#', 'lg', '!Franchise', 'PPG', 'GP', 'Points', 'W-L-T'],
      L.career_ppg.map((r, i) => `<tr><td>${i + 1}</td>${lgCell(r.franchise)}${nameCell(r.franchise, null, r.name)}<td><b>${r.ppg.toFixed(2)}</b></td><td>${r.games}</td><td>${n0(r.total_points)}</td><td>${esc(r.record)}</td></tr>`));
    else if (b === 'season') body = `<h2 class="sec">Best seasons <small>regular-season points per game, full seasons</small></h2>` + tbl(['#', 'lg', '!Team', 'Year', 'PPG', 'GP', 'Points'],
      L.season_ppg_top25.map(r => `<tr><td>${r.rank}</td>${lgCell(r.franchise)}<td class="t">${r.franchise ? `<a class="rf-nm" href="#reference/f-${r.franchise}">${esc(r.team)}</a>` : esc(r.team)}${r.champion ? ' <span class="rf-badge gold">🏆</span>' : ''}</td><td><a class="rf-nm" href="#reference/s-${r.year}">${r.year}</a></td><td><b>${r.ppg.toFixed(2)}</b></td><td>${parseInt(r.record)}</td><td>${n1(r.total_pts)}</td></tr>`));
    else if (b === 'playoff') body = `<h2 class="sec">Best playoff runs <small>points per game, two playoff games or more</small></h2>` + tbl(['#', 'lg', '!Team', 'Year', 'PPG', 'W-L', 'Points'],
      L.playoff_ppg_top15.map(r => `<tr><td>${r.rank}</td>${lgCell(r.franchise)}<td class="t">${r.franchise ? `<a class="rf-nm" href="#reference/f-${r.franchise}">${esc(r.team)}</a>` : esc(r.team)}${r.champion ? ' <span class="rf-badge gold">🏆</span>' : ''}</td><td><a class="rf-nm" href="#reference/s-${r.year}">${r.year}</a></td><td><b>${r.ppg.toFixed(2)}</b></td><td>${esc(r.record)}</td><td>${n1(r.total_pts)}</td></tr>`));
    else if (b === 'games') {
      const g = (title, list) => `<h2 class="sec">${title}</h2>` + tbl(['#', 'lg', '!Team', 'Score', 'When', '!Opponent', ''],
        list.map((r, i) => `<tr><td>${i + 1}</td>${lgCell(r.franchise)}${nameCell(r.franchise, null, r.name)}<td><b>${n1(r.score)}</b></td><td>${yw(r)}</td><td class="t">${esc(r.opp_name)}</td><td>${r.result}</td></tr>`));
      body = g('Highest scores', L.top_single_game_scores) + '<div style="height:18px"></div>' + g('Lowest scores', L.low_single_game_scores);
    } else if (b === 'margins') {
      const m = (title, list) => `<h2 class="sec">${title}</h2>` + tbl(['#', 'lg', '!Winner', 'Margin', 'Score', '!Loser', 'When'],
        list.map((r, i) => `<tr><td>${i + 1}</td>${lgCell(r.winner)}${nameCell(r.winner, null, r.winner_name)}<td><b>${n1(r.margin)}</b></td><td>${n1(r.winner_score)}–${n1(r.loser_score)}</td><td class="t">${esc(r.loser_name)}</td><td>${yw(r)}</td></tr>`));
      body = m('Biggest blowouts', L.biggest_blowouts) + '<div style="height:18px"></div>' + m('Closest finishes', L.closest_games);
    } else body = `<h2 class="sec">Best two-game stretches <small>back-to-back games, any week</small></h2>` + tbl(['#', 'lg', '!Team', 'Total', 'Year', 'Games'],
      L.top_two_game_stretches.map((r, i) => `<tr><td>${i + 1}</td>${lgCell(r.franchise)}${nameCell(r.franchise, null, r.name)}<td><b>${n1(r.total)}</b></td><td><a class="rf-nm" href="#reference/s-${r.year}">${r.year}</a></td><td>wk ${r.week_a} ${n1(r.score_a)} + wk ${r.week_b} ${n1(r.score_b)}</td></tr>`));
    return head('Records') + nav('#reference/records') + sub(BOARDS.map(([k, l]) => [`#reference/records/${k}`, l]), `#reference/records/${b}`) + `<section>${body}</section>`;
  }

  /* ---------- entry ---------- */
  function render(ctx, path) {
    X = ctx;
    if (failed) return '<p class="error">History didn’t load. Refresh the page to try again.</p>';
    if (!D) { load(ctx.rerender); return '<p class="loading">Loading league history…</p>'; }
    const [p, a, b] = path;
    if (!p) return pageHome(ctx.ppr);
    if (p === 'franchises') return pageFranchises();
    if (p.startsWith('f-')) return pageFranchise(p.slice(2));
    if (p === 'seasons') return pageSeasons();
    if (p.startsWith('s-')) return pageSeason(+p.slice(2), a, b ? +b : null);
    if (p === 'records') return pageRecords(a);
    return pageHome(ctx.ppr);
  }
  // which page a path is, so moving between sub-tabs keeps your place but a new page starts at the top
  const pageKey = path => path[0] || '';
  return { render, pageKey };
})();
