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

  // All-FBP players by franchise (data/awards/all-fbp.json, built by scripts/awards.py); loads with the first franchise page
  let AF = null, afLoading = false;
  const loadAF = rerender => {
    if (AF || afLoading) return; afLoading = true;
    fetch('data/awards/all-fbp.json', { cache: 'no-cache' }).then(r => { if (!r.ok) throw 0; return r.json(); })
      .then(d => { AF = d; rerender(); }).catch(() => { AF = { franchises: {}, failed: true }; rerender(); });
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
  // a stat tile's team: its logo, big and pushed off the bottom-right corner so only the top-left quarter shows
  // per-logo tweaks [size, how far off the corner]: wide logos with lots of empty space need more showing
  const TILE_FIT = { '0009': [1, 0.2, 0.4], '0008': [1, 0.25, 0.3] };   // [size, off the right edge, off the bottom edge]
  const tileLogo = fr => { const t = fr && X.teams[fr], f = TILE_FIT[fr]; return t && t.logo ? `<img class="rf-tlogo" src="${t.logo}" alt="" loading="lazy"${f ? ` style="--tl:${f[0]};--tlx:${f[1]};--tly:${f[2]}"` : ''}>` : ''; };
  // the tile in the team's colors (same rule as the franchise banner: very light primaries swap with the secondary)
  const tileStyle = fr => {
    const t = fr && X.teams[fr]; if (!t || !t.primary) return '';
    let bg = t.primary, ac = t.secondary || '#fff';
    if (lum(bg) > 0.85) [bg, ac] = [ac, bg];
    const fg = lum(bg) > 0.6 ? '#121519' : '#ffffff';
    const num = Math.abs(lum(ac) - lum(bg)) > 0.35 ? ac : fg;
    return ` style="--tile-bg:${bg};--tile-fg:${fg};--tile-num:${num}"`;
  };
  const frByName = n => Object.keys(D.franchises).find(f => D.franchises[f] === n);
  const lgCell = fr => `<td class="lg">${logo(fr)}</td>`;
  const nameCell = (fr, y, label) => `<td class="t"><a class="rf-nm" href="#reference/f-${fr}">${esc(label || nm(fr, y))}</a></td>`;
  const champOf = y => D.championships[y] || D.championships[String(y)];
  const badge = (fr, y) => { const c = champOf(y); return c && c.champion === fr ? '<span class="rf-badge gold" title="Champion">🏆</span>' : c && c.runnerup === fr ? '<span class="rf-badge">2nd</span>' : ''; };
  const ord = n => n + (['th', 'st', 'nd', 'rd'][(n % 100 > 10 && n % 100 < 14) ? 0 : n % 10] || 'th');
  const isChamp = (fr, y) => { const c = champOf(y); return !!c && c.champion === fr; };
  // how a season ended in the playoffs, from the bracket
  function playoffOut(fr, y) {
    const c = champOf(y), b = D.playoff_brackets[y] || D.playoff_brackets[String(y)];
    if (c && c.champion === fr) return '<span class="rf-po champ">Champion</span>';
    if (c && c.runnerup === fr) return '<span class="rf-po final">Lost final</span>';
    if (b) {
      const lost = games => (games || []).some(g => (g.franchiseA === fr && g.resultA === 'L') || (g.franchiseB === fr && g.resultB === 'L'));
      if (lost(b.semifinal_games)) {
        // the two semifinal losers play for 3rd in the title-game week
        const other = b.semifinal_games.map(g => g.resultA === 'L' ? g.franchiseA : g.franchiseB).find(f => f !== fr);
        const g = (D.schedules_by_year[y] || D.schedules_by_year[String(y)] || []).find(g => +g.week === +b.championship_week &&
          ((g.franchiseA === fr && g.franchiseB === other) || (g.franchiseB === fr && g.franchiseA === other)));
        if (g) {
          const won = (g.franchiseA === fr ? +g.scoreA > +g.scoreB : +g.scoreB > +g.scoreA);
          return `<span class="rf-po${won ? ' third' : ''}" title="Lost in the semifinals, then ${won ? 'won' : 'lost'} the 3rd-place game">${won ? '3rd place' : '4th place'}</span>`;
        }
        return '<span class="rf-po">Lost semis</span>';
      }
      if (lost(b.round1_games)) return '<span class="rf-po">Lost round 1</span>';
    }
    return '<span class="rf-po out">Missed</span>';
  }
  const lastDone = () => Math.max(...Object.keys(D.championships).map(Number));
  const years = () => D.meta.years_covered.slice().sort((a, b) => a - b);
  const sub = (items, cur, seg) => `<nav class="rf-sub${seg ? ' seg' : ''}">${items.map(([h, l]) => `<a href="${h}"${h === cur ? ' aria-current="page"' : ''}>${l}</a>`).join('')}</nav>`;
  const lum = h => { h = (h || '#888').replace('#', ''); const [r, g, b] = [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16)); return (0.299 * r + 0.587 * g + 0.114 * b) / 255; };

  /* P-PPR (Settings): adds the pre-2019, non-PPR seasons. Only finishes exist for those years so far,
     so records and all-time stats stay 2019 on; titles and finishes count them. */
  let PPR = false;
  const PRE = () => (PPR && D.pre2019 ? D.pre2019.seasons : []);
  const NP = '<span class="rf-np" title="Non-PPR season, before the league moved to MFL">non-PPR</span>';
  const preName = t => t.franchise ? `<a class="rf-nm" href="#reference/f-${t.franchise}">${esc(t.name)}</a>` : esc(t.name);
  const preRec = fr => { const r = { w: 0, l: 0, t: 0 }; PRE().forEach(x => (x.standings || []).forEach(s => { if (s.franchise === fr) { r.w += s.w; r.l += s.l; r.t += s.t; } })); return r; };
  const preYears = () => PRE().map(x => x.year);
  const preSeason = y => PRE().find(x => x.year === y);
  const preTeam = t => `${t.franchise ? logo(t.franchise) : ''}${t.franchise ? `<a class="rf-nm" href="#reference/f-${t.franchise}">${esc(t.name)}</a>` : esc(t.name)}`;
  const preFin = (fr, k) => PRE().filter(x => x[k].franchise === fr).map(x => x.year);
  const titlesOf = fr => preFin(fr, 'champion').concat(D.franchise_alltime[fr].championships).sort((a, b) => a - b);
  const secondsOf = fr => preFin(fr, 'runnerup').concat(D.franchise_alltime[fr].runnerups).sort((a, b) => a - b);
  const firstYear = () => (PRE().length ? Math.min(...PRE().map(x => x.year)) : 2019);

  function nav(top) {
    return sub([['#reference', 'Home'], ['#reference/franchises', 'Franchises'], ['#reference/seasons', 'Seasons'], ['#reference/records', 'Records']], top, true);
  }
  function head(title, extra = '') {
    const m = D.meta;
    // P-PPR toggle (saved per device; the click is handled in site.js by data-ppr)
    const tog = `<div class="rf-ppr" title="Pre-PPR: add the 2011–2018 non-PPR seasons"><span>P-PPR</span><div class="seg" role="group" aria-label="P-PPR">${['off', 'on'].map(v => `<button type="button" data-ppr="${v}" aria-pressed="${PPR === (v === 'on')}">${v === 'on' ? 'On' : 'Off'}</button>`).join('')}</div></div>`;
    return `<div class="pagehead rf-head"><h1>${title}</h1>${tog}<span class="asof">FBP history ${firstYear()}–${m.current_year}${m.current_week ? ` · ${m.current_year} through week ${m.current_week}` : ''}</span></div>${extra}`;
  }

  /* ---------- home ---------- */
  function pageHome(ppr) {
    const at = Object.entries(D.franchise_alltime);
    // overall regular-season records for the period shown: 2019 on, plus 2011-16 when P-PPR is on
    const rows = at.map(([fr, a]) => { const p = preRec(fr), w = a.w + p.w, l = a.l + p.l, t = a.t + p.t, g = w + l + t;
      return { fr, w, l, t, pct: g ? w / g : 0, titles: titlesOf(fr).length, seconds: secondsOf(fr).length }; })
      .sort((a, b) => b.pct - a.pct || b.titles - a.titles);
    // titles by franchise, plus pre-2019 champions whose team didn't carry into the MFL era (by name)
    const tc = {}; at.forEach(([fr]) => { tc[D.franchises[fr]] = titlesOf(fr).length; });
    PRE().forEach(x => { if (!x.champion.franchise) tc[x.champion.name] = (tc[x.champion.name] || 0) + 1; });
    const titles = Object.entries(tc).sort((a, b) => b[1] - a[1]);
    const most = titles.filter(t => t[1] === titles[0][1]);
    const best = rows[0];
    const hi = D.leaderboards.top_single_game_scores[0];
    const champs = Object.keys(D.championships).sort((a, b) => b - a);
    const ids = Object.keys(D.franchises).sort((a, b) => D.franchises[a].localeCompare(D.franchises[b]));
    return head('Reference') + nav('#reference') +
      (PRE().length ? `<p class="rf-note">P-PPR is on: seasons, titles and finishes include ${firstYear()}–2018 (non-PPR). Game scores and records stay 2019 on; see the blind spots at the bottom.</p>` : '') +
      `<section class="rf-tiles">
        <div class="card rf-tile"><span>Seasons</span><b>${years().length + PRE().length}</b><small>${firstYear()}–${D.meta.current_year}</small></div>
        <div class="card rf-tile${most.length === 1 ? ' lg tm' : ''}"${most.length === 1 ? tileStyle(frByName(most[0][0])) : ''}>${most.length === 1 ? tileLogo(frByName(most[0][0])) : ''}<span>Most titles</span><b>${titles[0][1]}</b><small>${most.map(t => esc(t[0])).join(', ')}</small></div>
        <div class="card rf-tile lg tm"${tileStyle(best.fr)}>${tileLogo(best.fr)}<span>Best all-time win%</span><b>${pct(best.pct)}</b><small>${esc(D.franchises[best.fr])}</small></div>
        <div class="card rf-tile lg tm"${tileStyle(hi.franchise)}>${tileLogo(hi.franchise)}<span>Highest score</span><b>${n1(hi.score)}</b><small>${esc(hi.name)}, ${hi.year} wk ${hi.week}</small></div>
      </section>
      <div class="grid2">
        <section><h2 class="sec">Overall records <small>${firstYear()}–${D.meta.current_year}, regular season</small></h2>
          <div class="card tbl-wrap"><table class="tbl rf-t"><thead><tr><th class="lg"><span class="sr">Logo</span></th><th class="t">Team</th><th>W-L-T</th><th>Win%</th><th>Titles</th><th>2nd</th></tr></thead><tbody>
          ${rows.map(r => `<tr>${lgCell(r.fr)}${nameCell(r.fr)}<td>${rec(r.w, r.l, r.t)}</td><td>${pct(r.pct)}</td><td>${r.titles ? '🏆 ' + r.titles : '—'}</td><td>${r.seconds || '—'}</td></tr>`).join('')}
          </tbody></table></div>${PRE().length ? '<p class="rf-foot">Records skip 2017–2018 (not on record). Titles and 2nds count every year.</p>' : ''}</section>
        <section><h2 class="sec">Champions</h2><div class="card rf-champs">
          ${champs.map(cy => { const c = D.championships[cy]; return `<a class="rf-champ" href="#reference/s-${cy}"><span class="yr">${cy}</span>${logo(c.champion) || '<i></i>'}<span class="who"><b>${esc(nm(c.champion, +cy))}</b><small>def. ${esc(nm(c.runnerup, +cy))} · ${esc(c.score)}</small></span></a>`; }).join('')}
          ${PRE().map(x => `<div class="rf-champ"><a class="yr" href="#reference/s-${x.year}">${x.year}</a>${x.champion.franchise ? logo(x.champion.franchise) : '<i></i>'}<span class="who"><b>${x.champion.franchise ? `<a class="rf-nm" href="#reference/f-${x.champion.franchise}">${esc(x.champion.name)}</a>` : esc(x.champion.name)} ${NP}</b><small>${x.title_game ? `def. ${esc(x.runnerup.name)} · ${esc(x.title_game.score)}` : `2nd ${esc(x.runnerup.name)} · 3rd ${esc(x.third.name)}`}</small></span></div>`).join('')}
        </div></section>
      </div>
      <section><h2 class="sec">Franchises</h2><div class="rf-teams">
        ${ids.map(fr => { const a = D.franchise_alltime[fr]; return `<a class="card rf-team" href="#reference/f-${fr}">${logo(fr)}<span><b>${esc(D.franchises[fr])}</b><small>${rec(a.w, a.l, a.t)}${titlesOf(fr).length ? ` · 🏆 ${titlesOf(fr).length}` : ''}</small></span></a>`; }).join('')}
      </div></section>
      ${blindSpots()}`;
  }

  // what the pre-2019 (P-PPR) history is missing
  function blindSpots() {
    return `<section><h2 class="sec">P-PPR blind spots <small>what we don’t have for 2011–2018</small></h2><div class="card rf-blind"><ul>
      <li><b>2017 and 2018 standings.</b> Only the top three are known; records and finishes for everyone else are missing.</li>
      <li><b>The 2018 title game.</b> No score or lineups.</li>
      <li><b>Points for and against.</b> No season totals for any pre-2019 year, so no PPG, all-play or points tiebreaks.</li>
      <li><b>Weekly games.</b> No regular-season or playoff scores, so no brackets, head-to-head, or single-game and blowout records before 2019.</li>
      <li><b>Auctions and rosters.</b> No player-by-player auction results or rosters before 2019 (rookie drafts started in 2021).</li>
      <li><b>Owners who left.</b> Teams run by owners no longer in the league show by name only, not under a current franchise.</li>
      <li><b>Different scoring.</b> Those seasons were non-PPR with kickers and defenses, so their scores don’t compare with today’s.</li>
    </ul><p class="rf-foot">Have any of this? Send it over and it goes in.</p></div></section>`;
  }

  /* ---------- franchises ---------- */
  // team buttons; pick one to open its page
  const teamSwitch = cur => `<nav class="rf-switch" aria-label="Franchise">${Object.keys(D.franchises).sort((x, y) => D.franchises[x].localeCompare(D.franchises[y])).map(id => `<a href="#reference/f-${id}" title="${esc(D.franchises[id])}"${id === cur ? ' aria-current="page"' : ''}>${logo(id) || esc((X.teams[id] || {}).abbr || id)}</a>`).join('')}</nav>`;
  function pageFranchises() {
    return head('Franchises') + nav('#reference/franchises') + teamSwitch('') +
      '<p class="rf-note">Pick a team to see its year-by-year history, head-to-head and draft picks. Overall records are on the <a href="#reference">Reference home</a>.</p>';
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
      teamSwitch(fr) + `
      <section class="rf-band" style="background:${bg};color:${fg};border-bottom-color:${ac}">
        ${tm.logo ? `<img src="${tm.logo}" alt="">` : ''}
        <div><h2>${esc(D.franchises[fr])}</h2>
        <p>${(() => { const p = preRec(fr), w = a.w + p.w, l = a.l + p.l, t = a.t + p.t, g = w + l + t; return `${rec(w, l, t)} since ${firstYear()} (${pct(g ? w / g : 0)})`; })()} · ${titlesOf(fr).length ? `🏆 ${titlesOf(fr).join(', ')}` : 'No titles yet'}${secondsOf(fr).length ? ` · 2nd ${secondsOf(fr).join(', ')}` : ''}</p>
        ${preNote(fr)}
        ${names.length ? `<p class="aka">Also played as ${names.map(esc).join(', ')}</p>` : ''}</div>
      </section>
      <section><h2 class="sec">Year by year</h2>
      <div class="card tbl-wrap"><table class="tbl rf-t"><thead><tr><th>Year</th><th class="t">Team name</th><th title="Place in the regular-season standings">Reg. finish</th><th class="t">Playoffs</th><th>W-L-T</th><th>PF</th><th>PA</th><th>All-play</th></tr></thead><tbody>
      ${seasons.map(s => { const live = s.year === D.meta.current_year && !champOf(s.year); return `<tr><td><a class="rf-nm" href="#reference/s-${s.year}">${s.year}</a></td><td class="t">${esc(s.name)}${isChamp(fr, s.year) ? ' <span class="rf-cup" title="Champion">🏆</span>' : ''}</td><td>${s.rank ? ord(s.rank) + (live ? '*' : '') : '—'}</td><td class="t">${live ? '<span class="rf-po">In progress</span>' : playoffOut(fr, s.year)}</td><td>${rec(s.w, s.l, s.t)}</td><td>${n1(s.pf)}</td><td>${n1(s.pa)}</td><td>${esc(s.all_play || '—')}</td></tr>`; }).join('')}
      ${preRows(fr)}
      </tbody></table></div>${seasons.some(s => s.year === D.meta.current_year && !champOf(s.year)) ? `<p class="rf-foot">* ${D.meta.current_year} is in progress; that’s the current standing.</p>` : ''}
      ${rankChart(fr, seasons)}</section>
      ${allFbp(fr)}
      <section><h2 class="sec">Head-to-head <small>every game, playoffs included</small></h2>
      <div class="card rf-h2h">${h2h.map(([o, r]) => { const g = r.w + r.l + r.t, p = g ? (r.w + r.t / 2) / g : 0; return `<a href="#reference/f-${o}" class="rf-h2hrow">${X.chip(o, { name: D.franchises[o] })}<span class="bar"><i style="width:${(p * 100).toFixed(0)}%"></i></span><b>${rec(r.w, r.l, r.t)}</b></a>`; }).join('')}</div></section>
      <section><h2 class="sec">Rookie draft history</h2>${picksTable(D.franchise_draft_picks[fr] || [], false)}</section>`;
  }

  // All-FBP players who earned it with this team: most 1st Teams first, then 2nd Teams, then points
  function allFbp(fr) {
    const head = `<h2 class="sec">All-FBP players <small>starter points for this team in their All-FBP seasons</small></h2>`;
    if (!AF) { loadAF(X.rerender); return `<section>${head}<p class="loading">Loading…</p></section>`; }
    if (AF.failed) return '';
    const rows = AF.franchises[fr] || [];
    const span = AF.seasons && AF.seasons.length ? `${AF.seasons[0]}–${AF.seasons[AF.seasons.length - 1]}` : '';
    if (!rows.length) return `<section>${head}<p class="rf-note">No All-FBP players with this team${span ? ' in ' + span : ''} yet.</p></section>`;
    const m = window.FBP && FBP.media;
    const ph = r => {
      const src = r.pos === 'DEF' ? (m ? m.nflLogo(r.nfl) : '') : (r.espn && m ? m.headshot(r.espn) : '');
      const fb = (X.teams[fr] || {}).logo || '';
      return `<span class="aw-ph sm${r.pos === 'DEF' ? ' def' : ''}">${src ? `<img src="${src}" alt="" loading="lazy" onerror="this.onerror=null;${fb ? `this.src='${fb}';this.parentNode.classList.add('fb')` : 'this.remove()'}">` : (fb ? `<img src="${fb}" alt="" class="fbimg">` : '')}${r.champs ? `<span class="aw-trophy" role="img" aria-label="Champion" title="Won the title with this team in an All-FBP season">🏆</span>` : ''}</span>`;
    };
    const yr = y => `<span class="rf-afy t${y.tier}"${y.champ || y.mvp ? ` title="${[y.mvp ? 'FBP MVP' : '', y.champ ? 'won the title' : ''].filter(Boolean).join(', ')} that season"` : ''}>${y.year} · ${y.tier === 1 ? '1st' : '2nd'}${y.mvp ? ' · MVP' : ''}${y.champ ? ' 🏆' : ''}</span>`;
    const tally = r => [r.mvps ? `${r.mvps}× MVP` : '', r.first ? `${r.first}× 1st Team` : '', r.second ? `${r.second}× 2nd Team` : ''].filter(Boolean).map(t => `<span>${t}</span>`).join('');
    return `<section>${head}<div class="card rf-af">${rows.map(r => `<div class="rf-afrow">${ph(r)}
      <div class="rf-afmain"><span class="rf-afnm"><b>${esc(r.name)}</b> <span class="pos ${r.pos}">${esc(r.pos)}</span></span><span class="rf-aftally">${tally(r)}</span>
        <span class="rf-afyears">${r.years.map(yr).join('')}</span></div>
      <div class="rf-afnum"><span><b>${n1(r.pts)}</b>pts</span><span><b>${n1(r.ppg)}</b>per start</span></div></div>`).join('')}</div>
      <p class="rf-foot">All-FBP teams start with ${esc(AF.seasons ? AF.seasons[0] : '')}. A player is listed with the team he scored the most starter points for that season. 🏆 = won the title with this team that season. MVP = FBP MVP that season.</p></section>`;
  }

  // regular-season finish by year: 1st at the top, the playoff cut marked, title years ringed in gold.
  // With P-PPR on, 2011-16 are added, ranked by win-loss record (ties keep the old final order).
  function preFinishes(fr) {
    return PRE().filter(x => x.standings && x.standings.some(r => r.franchise === fr)).map(x => {
      const pc = r => { const g = r.w + r.l + r.t; return g ? (r.w + r.t / 2) / g : 0; };
      const order = x.standings.slice().sort((a, b) => pc(b) - pc(a) || a.place - b.place);
      const me = order.find(r => r.franchise === fr);
      return { year: x.year, rank: order.indexOf(me) + 1, w: me.w, l: me.l, t: me.t, pre: true, champ: x.champion.franchise === fr, teams: order.length };
    }).sort((a, b) => a.year - b.year);
  }
  function rankChart(fr, seasons) {
    const pre = preFinishes(fr);
    const pts = pre.concat(seasons.filter(s => s.rank).map(s => ({ year: s.year, rank: s.rank, w: s.w, l: s.l, t: s.t, champ: isChamp(fr, s.year) })))
      .sort((a, b) => a.year - b.year);
    if (pts.length < 2) return '';
    const n = Math.max(12, ...pts.map(s => s.rank));
    const W = window.innerWidth > 900 ? 900 : 480, H = 210, L = 36, R = 10, T = 18, B = 26;   // wider drawing on desktop keeps text the same size
    const y0 = pts[0].year, y1 = pts[pts.length - 1].year;
    const x = yr => L + (W - L - R) * (y1 === y0 ? 0.5 : (yr - y0) / (y1 - y0));   // by year, so missing seasons leave a gap
    const y = r => T + (H - T - B) * (r - 1) / (n - 1);
    const b = D.playoff_brackets[String(D.meta.current_year - 1)] || Object.values(D.playoff_brackets).slice(-1)[0] || {};
    const cut = ((b.byes || []).length + 2 * (b.round1_games || []).length) || 6;   // teams that make the playoffs now
    // line color: the team color that reads on the page (darker one on light, lighter one on dark)
    const tm = X.teams[fr] || {}, cs = [tm.primary, tm.secondary].filter(Boolean);
    const dark = cs.slice().sort((a, b) => lum(a) - lum(b))[0] || '#555', light = cs.slice().sort((a, b) => lum(b) - lum(a))[0] || '#ccc';
    const onLight = lum(dark) < 0.55 ? dark : '#3b4654', onDark = lum(light) > 0.35 ? light : '#c9d2dc';
    const live = s => s.year === D.meta.current_year && !champOf(s.year);
    const xy = s => `${x(s.year).toFixed(1)},${y(s.rank).toFixed(1)}`;
    // line pieces: consecutive years only; non-PPR and in-progress pieces drawn dashed
    const segs = [];
    pts.forEach((s, i) => { const p = pts[i - 1]; if (p && s.year - p.year === 1) segs.push(`<line class="ln${s.pre ? ' pre' : ''}${live(s) ? ' live' : ''}" x1="${x(p.year)}" y1="${y(p.rank)}" x2="${x(s.year)}" y2="${y(s.rank)}"/>`); });
    const grid = [1, cut, n].map(r => `<line class="g" x1="${L}" x2="${W - R}" y1="${y(r)}" y2="${y(r)}"/><text class="ax" x="${L - 8}" y="${y(r) + 4}" text-anchor="end">${ord(r)}</text>`).join('');
    const cutY = (y(cut) + y(cut + 1)) / 2;
    const short = pts.length > 8 || (y1 - y0) > 8;
    const dots = pts.map(s => {
      const tip = `${s.year}: ${ord(s.rank)}${s.pre ? ' by record' : ''}${live(s) ? ' so far' : ''} · ${rec(s.w, s.l, s.t)}${s.champ ? ' · Champion' : ''}${s.pre ? ' · non-PPR' : ''}`;
      const tw = Math.max(164, tip.length * 6.6), tx = Math.min(Math.max(x(s.year), L + tw / 2), W - R - tw / 2), ty = y(s.rank) < T + 40 ? y(s.rank) + 30 : y(s.rank) - 16;
      return `<g class="pt${live(s) ? ' live' : ''}${s.pre ? ' pre' : ''}" tabindex="0" aria-label="${esc(tip)}">
        <circle class="hit" cx="${x(s.year)}" cy="${y(s.rank)}" r="16"/>${s.champ ? `<circle class="ring" cx="${x(s.year)}" cy="${y(s.rank)}" r="9"/>` : ''}
        <circle class="dot" cx="${x(s.year)}" cy="${y(s.rank)}" r="5.5"/>
        <text class="yr" x="${x(s.year)}" y="${H - 8}" text-anchor="middle">${short ? "'" + String(s.year).slice(2) : s.year}</text>
        <g class="tip"><rect x="${tx - tw / 2}" y="${ty - 15}" width="${tw}" height="22" rx="5"/><text x="${tx}" y="${ty}" text-anchor="middle">${esc(tip)}</text></g></g>`;
    }).join('');
    return `<figure class="card rf-rank" style="--rk-l:${onLight};--rk-d:${onDark}" aria-label="Regular-season finish by year">
      <figcaption>Regular-season finish <small>1st at the top · dashed line = playoff cut · gold ring = champion · tap a point for the record</small></figcaption>
      <svg viewBox="0 0 ${W} ${H}">
        ${grid}
        <line class="cut" x1="${L}" x2="${W - R}" y1="${cutY}" y2="${cutY}"/>
        ${segs.join('')}
        ${dots}
      </svg>
      ${pre.length ? `<p class="rf-rknote">P-PPR years (${pre[0].year}–${pre[pre.length - 1].year}, gray) are estimates: ranked by win-loss record from final standings that included the playoffs, so ties may be off. No standings exist for 2017–18.</p>` : ''}
    </figure>`;
  }

  function preRows(fr) {
    return PRE().map(x => {
      const s = (x.standings || []).find(r => r.franchise === fr);
      const k = ['champion', 'runnerup', 'third'].find(k => x[k].franchise === fr);
      if (!s && !k) return '';
      const po = k === 'champion' ? '<span class="rf-po champ">Champion</span>' : k === 'runnerup' ? '<span class="rf-po final">Lost final</span>' : k === 'third' ? '<span class="rf-po">3rd place</span>' : '—';
      return `<tr class="rf-pre"><td><a class="rf-nm" href="#reference/s-${x.year}">${x.year}</a></td><td class="t">${esc((s || x[k]).name)}${k === 'champion' ? ' <span class="rf-cup" title="Champion">🏆</span>' : ''} ${NP}</td><td>—</td><td class="t">${po}</td><td>${s ? rec(s.w, s.l, s.t) : '—'}</td><td>—</td><td>—</td><td>—</td></tr>`;
    }).join('');
  }
  function preNote(fr) {
    const f = PRE().flatMap(x => ['champion', 'runnerup', 'third'].filter(k => x[k].franchise === fr).map(k => `${x.year} ${k === 'champion' ? 'champion' : k === 'runnerup' ? '2nd' : '3rd'}${x[k].name !== D.franchises[fr] ? ` (as ${esc(x[k].name)})` : ''}`));
    return f.length ? `<p class="aka">Before 2019 (non-PPR): ${f.join(', ')}</p>` : '';
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
    }).join('')}${PRE().map(x => `<a class="card rf-season pre" href="#reference/s-${x.year}"><b>${x.year} ${NP}</b><span class="rf-pre1">🏆 ${x.champion.franchise ? logo(x.champion.franchise) : ''}${esc(x.champion.name)}</span><small>${x.title_game ? `def. ${esc(x.runnerup.name)} ${esc(x.title_game.score)}` : `2nd ${esc(x.runnerup.name)} · 3rd ${esc(x.third.name)}`}</small></a>`).join('')}</section>`;
  }

  function game(g, y, lbl) {
    const fin = g.scoreA != null && g.scoreA !== '';
    const aw = fin && +g.scoreA > +g.scoreB, bw = fin && +g.scoreB > +g.scoreA;
    const row = (fr, sc, w) => `<div class="row${w ? ' win' : ''}">${tl(fr, y)}<span class="meta">${fin ? n1(sc) : ''}</span></div>`;
    return `<div class="game">${lbl ? `<div class="lbl">${lbl}</div>` : ''}${row(g.franchiseA, g.scoreA, aw)}${row(g.franchiseB, g.scoreB, bw)}</div>`;
  }

  function yearNav(y, mid) {
    const ys = preYears().concat(years()).sort((a, b) => a - b), i = ys.indexOf(y);
    return `<div class="rf-yrnav">${i > 0 ? `<a href="#reference/s-${ys[i - 1]}">← ${ys[i - 1]}</a>` : '<span></span>'}<h2>${y}${mid}</h2>${i < ys.length - 1 ? `<a href="#reference/s-${ys[i + 1]}">${ys[i + 1]} →</a>` : '<span></span>'}</div>`;
  }
  // a non-PPR season: standings (2011-16), title-game box score (2011-17), or just the top three
  function pagePre(x) {
    const y = x.year, c = x.champion;
    const tm = (t, extra = '') => `${t.franchise ? `<a class="rf-nm" href="#reference/f-${t.franchise}">${esc(t.name)}</a>` : esc(t.name)}${extra}<small class="rf-by">${esc(t.owner)}</small>`;
    const side = (o, win) => `<div class="card rf-box${win ? ' win' : ''}"><div class="rf-boxh">${o.franchise ? logo(o.franchise) : ''}<span>${tm(o)}</span><b>${n1(o.score)}</b></div>
      <table class="tbl rf-t"><tbody>${o.lineup.map(p => `<tr><td class="rf-pos"><span class="pos ${esc(p.pos).replace('/', '')}">${esc(p.pos)}</span></td><td class="t">${esc(p.player)}<small class="rf-by">${esc(p.nfl)} ${esc(p.opp)} · ${esc(p.result)}</small></td><td>${n1(p.pts)}</td></tr>`).join('')}</tbody></table></div>`;
    const top3 = ['champion', 'runnerup', 'third'].map((k, i) => `<div class="rf-top3row"><span class="n">${i + 1}</span>${x[k].franchise ? logo(x[k].franchise) : '<i></i>'}<span>${tm(x[k])}</span></div>`).join('');
    return head('Seasons') + nav('#reference/seasons') +
      yearNav(y, `<span class="ch" title="${esc(c.name)}, champions">${c.franchise ? logo(c.franchise) : esc(c.name)}🏆</span>${NP}`) +
      (x.standings ? `<section><h2 class="sec">Final standings <small>non-PPR · finish includes the playoffs</small></h2>
        <div class="card tbl-wrap rf-pre-st"><table class="tbl rf-t"><thead><tr><th>#</th><th class="lg"><span class="sr">Logo</span></th><th class="t">Team</th><th>W-L-T</th></tr></thead><tbody>
        ${x.standings.map(s => `<tr><td>${s.place}</td><td class="lg">${s.franchise ? logo(s.franchise) : ''}</td><td class="t">${tm(s, s.place === 1 ? ' <span class="rf-badge gold">🏆</span>' : s.place === 2 ? '<span class="rf-badge">2nd</span>' : '')}</td><td>${rec(s.w, s.l, s.t)}</td></tr>`).join('')}
        </tbody></table></div></section>`
        : `<section><h2 class="sec">Top three</h2><div class="card rf-top3">${top3}</div><p class="rf-foot">Full standings for ${y} aren’t on record.</p></section>`) +
      (x.title_game ? `<section><h2 class="sec">Championship <small>${esc(x.title_game.score)}</small></h2><div class="rf-boxes">${side(x.title_game.winner, true)}${side(x.title_game.loser, false)}</div></section>`
        : `<section><h2 class="sec">Championship</h2><p class="rf-note">No score or lineups on record for the ${y} title game.</p></section>`);
  }

  function pageSeason(y, tab, wk) {
    if (preSeason(y)) return pagePre(preSeason(y));
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
      yearNav(y, c ? `<span class="ch" title="${esc(nm(c.champion, y))}, champions">${logo(c.champion) || esc(nm(c.champion, y))}🏆</span>` : live ? '<small>in progress</small>' : '') + `
      <section><h2 class="sec">${live ? 'Standings' : 'Final standings'}${live && D.meta.current_week ? ` <small>through week ${D.meta.current_week}</small>` : ''}</h2>
        <div class="card tbl-wrap"><table class="tbl rf-t"><thead><tr><th>#</th><th class="lg"><span class="sr">Logo</span></th><th class="t">Team</th><th>W-L-T</th><th>PF</th><th>PA</th><th>All-play</th></tr></thead><tbody>
        ${rows.map(s => `<tr><td>${s.rank || '—'}</td>${lgCell(s.fr)}<td class="t"><a class="rf-nm" href="#reference/f-${s.fr}">${esc(s.name)}</a>${badge(s.fr, y)}</td><td>${rec(s.w, s.l, s.t)}</td><td>${n1(s.pf)}</td><td>${n1(s.pa)}</td><td>${esc(s.all_play || '—')}</td></tr>`).join('')}
        </tbody></table></div></section>
      <section><h2 class="sec">Playoffs</h2>${br ? `<div class="card bracket rf-bracket">
        <div class="round"><h3>Round 1 · week ${br.round1_week}</h3>${br.round1_games.map(g => game(g, y)).join('')}<p class="rf-foot">Byes: ${br.byes.map(b => esc(nm(b, y))).join(', ')}</p></div>
        <div class="round"><h3>Semifinals · week ${br.semi_week}</h3>${br.semifinal_games.length ? br.semifinal_games.map(g => game(g, y)).join('') : '<p class="rf-foot">To be played.</p>'}</div>
        <div class="round"><h3>Championship · week ${br.championship_week}</h3>${br.championship_game ? game(br.championship_game, y) : '<p class="rf-foot">To be played.</p>'}</div>
      </div>` : `<div class="card rf-pad"><p class="rf-note">${live ? 'The bracket fills in here once the playoffs start. The live picture is on <a href="#now">League Now</a>.' : 'No bracket on record for this season.'}</p></div>`}</section>
      <section>${sub([[base, 'Weekly results'], [base + '/draft', 'Rookie draft'], [base + '/auction', 'Auction']], tab === 'results' ? base : base + '/' + tab, true)}<div class="rf-body">${body}</div></section>`;
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
    return head('Records') + nav('#reference/records') + (PRE().length ? '<p class="rf-note">P-PPR is on, but there are no game scores before 2019, so records cover 2019 on. See the blind spots on the Reference home.</p>' : '') + sub(BOARDS.map(([k, l]) => [`#reference/records/${k}`, l]), `#reference/records/${b}`) + `<section>${body}</section>`;
  }

  /* ---------- entry ---------- */
  function render(ctx, path) {
    X = ctx; PPR = !!ctx.ppr;
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
