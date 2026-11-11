/* League Now > Rosters (#now/rosters, #now/rosters/<franchise>): every FBP roster, from data/rosters.json
   (scripts/rosters.py). Team logos up top pick the team. Tiles, points by week against the league average, and a
   roster table grouped by position (then taxi and IR) that sorts by any column. Tapping a player opens his box:
   News, Game log and Schedule load from ESPN when opened (news is ESPN's RotoWire feed); Analytics and Salary come
   from the site's own data. */
window.FBPRosters = (function () {
  let R = null, loading = false, failed = false, X = null;
  let sort = ['sal', -1];
  let pickX = null;
  let wkShut = false, noteShut = false;
  try { wkShut = localStorage.getItem('fbp-ro-wk') === 'shut'; noteShut = localStorage.getItem('fbp-ro-note') === 'shut'; } catch (e) {}   // where the team-logo row was scrolled, so picking a team doesn't send it back to the start
  const open = new Set(), tabOf = {}, cache = {};
  // player search across all 12 rosters: the results list redraws in place as you type, so the box keeps focus
  let findQ = '';
  const fold = v => String(v || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/-/g, ' ').replace(/[^a-z0-9 ]/g, '');
  function findHits() {
    const t = fold(findQ).split(' ').filter(Boolean); if (!R || !t.length) return null;
    const out = [];
    Object.entries(R.teams).forEach(([f, tm]) => tm.rows.forEach(r => { const n = fold(r.name);
      if (t.every(x => n.includes(x))) out.push({ r, f, lead: n.startsWith(t[0]) || n.split(' ').some(w => w.startsWith(t[0])) }); }));
    return out.sort((a, b) => (b.lead - a.lead) || b.r.sal - a.r.sal).slice(0, 8);
  }
  function findList() {
    const hits = findHits(); if (!hits) return '';
    const esc = X.esc, tmx = f => X.teams[f] || {};
    if (!hits.length) return '<div class="ro-res" role="listbox"><p class="ro-none">No rostered player matches. Free agents are on the Stats page.</p></div>';
    return `<div class="ro-res" role="listbox">${hits.map(({ r, f }, i) => {
      const img = r.pos === 'DEF' && r.nfl ? `class="ro-def" style="background-image:url(https://a.espncdn.com/i/teamlogos/nfl/500/${NFL_ESPN[r.nfl] || r.nfl.toLowerCase()}.png)"`
        : r.espn ? `style="background-image:url(https://a.espncdn.com/i/headshots/nfl/players/full/${r.espn}.png)"` : '';
      const st = r.st === 'TAXI_SQUAD' ? ' · taxi' : r.st === 'INJURED_RESERVE' ? ' · IR' : '';
      return `<a role="option" href="#now/rosters/${f}/${r.id}" data-ro-hit${i === 0 ? ' class="on"' : ''}><span class="ro-ph"><span ${img}></span></span>
        <span class="ro-rn"><b>${esc(r.name)}</b><small>${r.pos}${r.nfl ? ' · ' + esc(r.nfl) : ''} · ${$(r.sal)}${st}</small></span>
        <span class="ro-rt">${tmx(f).logo ? `<img src="${tmx(f).logo}" alt="">` : ''}<b>${esc(tmx(f).abbr || '')}</b></span></a>`; }).join('')}</div>`;
  }
  function findBox(esc) {
    return `<div class="ro-find"><input class="pr-q ro-q" type="search" placeholder="Find a player on any roster" aria-label="Find a player on any roster" autocomplete="off" value="${esc(findQ)}">${findList()}</div>`;
  }
  const findRedraw = () => { const box = document.querySelector('.ro-find'); if (!box) return;
    const old = box.querySelector('.ro-res'); if (old) old.remove(); box.insertAdjacentHTML('beforeend', findList()); };
  document.addEventListener('input', e => { if (e.target.matches && e.target.matches('.ro-q')) { findQ = e.target.value; findRedraw(); } });
  document.addEventListener('keydown', e => {
    if (!(e.target.matches && e.target.matches('.ro-q'))) return;
    const list = [...document.querySelectorAll('[data-ro-hit]')], i = list.findIndex(a => a.classList.contains('on'));
    if (e.key === 'Escape') { findQ = ''; e.target.value = ''; findRedraw(); return; }
    if (!list.length) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); const j = (i + (e.key === 'ArrowDown' ? 1 : -1) + list.length) % list.length;
      list.forEach((a, k) => a.classList.toggle('on', k === j)); list[j].scrollIntoView({ block: 'nearest' }); }
    if (e.key === 'Enter') { e.preventDefault(); findQ = ''; location.hash = list[Math.max(i, 0)].getAttribute('href').slice(1); }
  });
  function load() {
    if (R || loading) return;
    loading = true;
    fetch('data/rosters.json', { cache: 'no-cache' }).then(r => r.ok ? r.json() : Promise.reject())
      .then(j => { R = j; loading = false; redraw(); })
      .catch(() => { failed = true; loading = false; redraw(); });
  }
  const redraw = () => { const y = window.scrollY; if (X && X.rerender) { X.rerender(); window.scrollTo(0, y); } };
  const $ = n => '$' + Math.round(n);
  const fx = (v, d) => v == null ? '—' : (+v).toFixed(d);
  const sg = v => (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v).toFixed(1);
  const ord = n => n + (n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] || 'th');
  const POS = ['QB', 'RB', 'WR', 'TE', 'DEF'];
  const GRP = { QB: 'Quarterbacks', RB: 'Running backs', WR: 'Wide receivers', TE: 'Tight ends', DEF: 'Defense' };
  const YEARS = k => (R.season || 2026) + 1 + k;
  const TABS = [['news', 'News'], ['log', 'Game log'], ['sched', 'Schedule'], ['an', 'Analytics'], ['sal', 'Salary'], ['jour', 'Journey']];
  const STEP = { 3: [3, 6], 5: [3, 6, 9, 12], 6: [0, 3, 6, 9, 12] };
  const NFL_ESPN = { GBP: 'gb', KCC: 'kc', NEP: 'ne', NOS: 'no', SFO: 'sf', TBB: 'tb', LVR: 'lv', JAC: 'jax', WAS: 'wsh', LA: 'lar' };
  const STAT = { QB: [['passing', ['CMP', 'ATT', 'YDS', 'TD', 'INT']], ['rushing', ['CAR', 'YDS', 'TD']]],
    RB: [['rushing', ['CAR', 'YDS', 'TD']], ['receiving', ['REC', 'YDS', 'TD']]],
    WR: [['receiving', ['REC', 'TGTS', 'YDS', 'TD']]], TE: [['receiving', ['REC', 'TGTS', 'YDS', 'TD']]] };
  const nflLogo = ab => ab ? `<img class="ro-nfl" src="https://a.espncdn.com/i/teamlogos/nfl/500/${String(ab).toLowerCase()}.png" alt="" loading="lazy">` : '';
  const EAPI = 'https://site.web.api.espn.com/apis/common/v3/sports/football/nfl/athletes/';

  function espn(key, url) {
    if (cache[key]) return cache[key].data;
    cache[key] = { data: null };
    fetch(url).then(r => r.ok ? r.json() : Promise.reject()).then(j => { cache[key].data = j; redraw(); })
      .catch(() => { cache[key].data = { failed: true }; redraw(); });
    return null;
  }
  const when = iso => { const d = new Date(iso), h = (Date.now() - d) / 36e5;
    return h < 24 ? Math.max(1, Math.round(h)) + 'h ago' : h < 24 * 7 ? Math.round(h / 24) + 'd ago' : d.toLocaleDateString([], { month: 'short', day: 'numeric' }); };

  // each NFL team's opponent in a week, from ESPN's scoreboard for that week: { ab, home } or { bye: true }
  const SB = 'https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?seasontype=2&week=';
  function nflWeek(w) {
    const j = espn('sb' + w, SB + w + '&dates=' + R.season);
    if (!j || j.failed) return null;
    const m = {};
    (j.events || []).forEach(ev => { const cs = ((ev.competitions || [])[0] || {}).competitors || [];
      cs.forEach(c => { const o = cs.find(x => x !== c); if (o) m[c.team.abbreviation.toLowerCase()] = { ab: o.team.abbreviation.toLowerCase(), home: c.homeAway === 'home' }; }); });
    return m;
  }
  const oppOf = (r, w) => { if (!r.nfl) return null; const m = nflWeek(w); if (!m) return null;
    return m[NFL_ESPN[r.nfl] || r.nfl.toLowerCase()] || (r.bye === w ? { bye: true } : null); };
  const oppCell = (r, w) => { const o = oppOf(r, w); if (!r.nfl) return '<td class="ro-wo">—</td>';
    if (!o) return '<td class="ro-wo"></td>'; if (o.bye) return '<td class="ro-wo ro-bye">BYE</td>';
    return `<td class="ro-wo"><span class="ro-vs">${o.home ? 'vs' : '@'}</span>${nflLogo(o.ab)}</td>`; };
  // Heat Check for one player: his Nuclear / Hot / Cold / Bust / Witness Protection weeks and Heat Score (data/analytics.json)
  const HEATK = [['N', 'Nuclear', 'nuke'], ['H', 'Hot', 'hot'], ['C', 'Cold', 'cold'], ['B', 'Bust', 'bust'], ['W', 'Witness Protection', 'wp']];
  // the label he earned in a week (Nuclear, Hot, Cold, Bust, Witness Protection), as a small chip
  function heatChip(r, w) {
    const A = espn('AN', 'data/analytics.json'); if (!A || A.failed) return '';
    const h = (A.heatPlayers || {})[r.id], i = (A.heatWeeks || []).indexOf(+w); if (!h || i < 0) return '';
    const c = h.w[i], k = HEATK.find(x => x[0] === c); if (!k) return '';
    return `<span class="hc-chip ${k[2]}" title="${k[1]}">${c === 'W' ? 'WP' : c}</span>`;
  }
  function heatStrip(r) {
    const A = espn('AN', 'data/analytics.json');
    if (!A || A.failed) return '';
    const h = (A.heatPlayers || {})[r.id], wk = A.heatWeeks || [];
    if (!h) return `<p class="ro-bnote">Heat Check: no Nuclear, Hot, Cold, Bust or Witness Protection weeks${wk.length ? ` through week ${wk[wk.length - 1]}` : ''}.</p>`;
    const cnt = HEATK.map(([c, l, k], i) => h.c[i] ? `<span class="hc-n ${k}"><b>${h.c[i]}</b> ${l}</span>` : '').join('');
    const cells = wk.map((w, i) => { const c = h.w[i] || '-', k = (HEATK.find(x => x[0] === c) || [])[2];
      return `<span class="hc-w${k ? ' ' + k : c === '-' ? ' off' : ''}" title="Week ${w}: ${k ? HEATK.find(x => x[0] === c)[1] : c === '-' ? 'no game' : 'played'}"><small>${w}</small><i>${k ? c === 'W' ? 'WP' : c : ''}</i></span>`; }).join('');
    return `<div class="hc-p"><div class="hc-top"><b>Heat Check</b><span class="hc-s ${h.s > 0 ? 'up' : h.s < 0 ? 'dn' : ''}">${h.s > 0 ? '+' : ''}${h.s}</span><span class="hc-cnt">${cnt} <span class="hc-g">in ${h.g} games</span></span></div><div class="hc-wks">${cells}</div></div>`;
  }
  // current NFL injury designation (ESPN's injury report; the daily snapshot if ESPN can't be reached)
  const INJ = { 'Questionable': 'Q', 'Doubtful': 'D', 'Out': 'O', 'Injured Reserve': 'IR', 'Suspension': 'SUS', 'Day-To-Day': 'DTD', 'Physically Unable to Perform': 'PUP' };
  function injMap() {
    const j = espn('INJ', 'https://site.api.espn.com/apis/site/v2/sports/football/nfl/injuries');
    if (j && !j.failed) {
      if (!j._m) { j._m = {}; (j.injuries || []).forEach(t => (t.injuries || []).forEach(i => { const a = i.athlete || {}; let id = a.id;
        if (!id) (a.links || []).some(l => { const m = /\/id\/(\d+)/.exec(l.href || ''); if (m) id = m[1]; return !!m; });
        if (id) j._m[id] = { status: i.status, note: i.shortComment || '' }; })); }
      // ESPN's live report drops some long-term injuries; the daily snapshot (which adds them from team rosters) fills the gaps
      const k = espn('INJF', 'data/espn/injuries.json');
      if (k && !k.failed && !j._f) { j._f = true; Object.entries(k).forEach(([id, v]) => { if (id !== '_m' && v && v.status && !j._m[id]) j._m[id] = { status: v.status, note: v.short || '' }; }); }
      return j._m;
    }
    if (j && j.failed) { const k = espn('INJF', 'data/espn/injuries.json');
      if (k && !k.failed) { if (!k._m) k._m = Object.fromEntries(Object.entries(k).filter(([key]) => key !== '_m').map(([id, v]) => [id, { status: v.status, note: v.short || '' }])); return k._m; } }
    return {};
  }
  // All-FBP 1st or 2nd Team this season: a gold or silver photo
  const medalOf = r => (r.hon || []).some(h => h[0] === '1st Team') ? 'gold' : (r.hon || []).some(h => h[0] === '2nd Team') ? 'silver' : '';
  const injChip = r => { if (!r.espn) return ''; const i = injMap()[r.espn], t = i && INJ[i.status]; if (!t) return '';
    return `<span class="ro-inj" title="${X && X.esc ? X.esc(i.status + (i.note ? ': ' + i.note : '')) : i.status}">${t}</span>`; };
  // sortable columns: key, label, value (text sorts A to Z first; missing values sink)
  const cols = () => [
    ['name', 'Player', r => r.name],
    ['pts', 'Pts', r => r.pts],
    ['ppw', 'Pts/wk', r => r.gp ? r.pts / r.gp : null],
    ['ecr', 'ECR', r => r.ecrPos == null ? null : -r.ecrPos],
    ['rk', 'Rank', r => r.rk == null ? null : -r.rk],
    ['bye', 'Bye', r => r.bye],
    ['proj', `Wk ${R.projWeek} proj`, r => r.proj],
    ['o0', `Wk ${R.projWeek}`, r => (oppOf(r, R.projWeek) || {}).ab || null],
    ['o1', `Wk ${R.projWeek + 1}`, r => (oppOf(r, R.projWeek + 1) || {}).ab || null],
    ['sal', String(R.season), r => r.sal],
    ['cy', 'Yr', r => r.fut ? r.fut.length : -1],
    ...[0, 1, 2, 3, 4].map(k => ['y' + k, String(YEARS(k)), r => r.fut && r.fut[k] != null ? r.fut[k] : null]),
  ];

  // the player's profile: scoring archetypes from the weekly data, plus role labels read from his ESPN game log
  function role(r) {
    if (!r.espn || !['QB', 'RB', 'WR', 'TE'].includes(r.pos)) return [];
    const j = espn('g' + r.espn, EAPI + r.espn + '/gamelog');
    if (!j || j.failed) return [];
    const stt = (j.seasonTypes || []).find(x => /Regular/.test(x.displayName || '')) || (j.seasonTypes || [])[0];
    const labels = j.labels || [], evs = []; ((stt && stt.categories) || []).forEach(c => (c.events || []).forEach(e => evs.push(e.stats)));
    const n = evs.length; if (n < 3) return [];
    const sum = (cat, lab) => { let off = 0; for (const c of (j.categories || [])) { if (c.name === cat) { const i = labels.slice(off, off + c.count).indexOf(lab); return i < 0 ? 0 : evs.reduce((s, st) => s + (parseFloat(st[off + i]) || 0), 0); } off += c.count; } return 0; };
    const out = [], g = x => x / n;
    if (r.pos === 'QB') {
      if (g(sum('passing', 'ATT')) >= 36) out.push(['Volume King', `${g(sum('passing', 'ATT')).toFixed(0)} pass attempts a game`]);
      if (g(sum('rushing', 'YDS')) >= 30) out.push(['Dual Threat', `${g(sum('rushing', 'YDS')).toFixed(0)} rushing yards a game`]);
    } else if (r.pos === 'RB') {
      const tch = g(sum('rushing', 'CAR') + sum('receiving', 'REC')), td = g(sum('rushing', 'TD') + sum('receiving', 'TD'));
      if (tch >= 18) out.push(['Volume King', `${tch.toFixed(1)} touches a game`]);
      else if (td >= .6 && tch < 13) out.push(['TD-Dependent', `${td.toFixed(1)} TDs a game on ${tch.toFixed(1)} touches`]);
      if (g(sum('receiving', 'REC')) >= 3.5) out.push(['Pass-Catching Back', `${g(sum('receiving', 'REC')).toFixed(1)} catches a game`]);
    } else {
      const tg = g(sum('receiving', 'TGTS')), td = g(sum('receiving', 'TD'));
      if (tg >= (r.pos === 'TE' ? 7 : 9)) out.push(['Volume King', `${tg.toFixed(1)} targets a game`]);
      else if (td >= .5 && tg < (r.pos === 'TE' ? 5 : 6)) out.push(['TD-Dependent', `${td.toFixed(1)} TDs a game on ${tg.toFixed(1)} targets`]);
    }
    return out;
  }
  function profile(r, href) {
    const tags = (r.prof || []).map(p => [...p, 's']).concat(role(r).map(p => [...p, 'r']));
    if (!tags.length && !href) return '';
    return `<div class="ro-prof">${tags.map(([l, why, k]) => `<span class="ro-pt ${k}"><b>${l}</b><small>${why}</small></span>`).join('')}${href ? `<a class="ro-pp" href="${href}">Player Page<span aria-hidden="true"> ›</span></a>` : ''}</div>`;
  }
  // one tab's content; the Player Page shows them all at once (full: more news)
  function part(r, t, ctx, tab, full) {
    const esc = ctx.esc;
    const wait = '<p class="ro-wait">Loading from ESPN…</p>', fail = '<p class="ro-wait">ESPN didn’t answer. Try again in a minute.</p>', noid = '<p class="ro-wait">No ESPN id for this player yet.</p>';
    const fpts = w => r.wks[String(w)];
    const wv = w => { const v = (r.wsc || {})[String(w)]; return v == null ? null : v; };   // his points that week, wherever he was
    let body = '';
    if (r.pos === 'DEF' && (tab === 'news' || tab === 'log')) body = '<p class="ro-wait">Team defenses don’t have player news or a game log. See Schedule.</p>';
    else if (tab === 'news') {
      const j = r.espn && espn('n' + r.espn, `https://site.api.espn.com/apis/fantasy/v2/games/ffl/news/players?playerId=${r.espn}&limit=12`);
      body = !r.espn ? noid : !j ? wait : j.failed ? fail : !(j.feed || []).length ? '<p class="ro-wait">No recent news.</p>'
        : (() => { // RotoWire blurbs first; ESPN articles show just their summary, never the article body
            const strip = x => String(x || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
            const rw = j.feed.filter(n => n.type === 'Rotowire'), list = (rw.length ? rw : j.feed).slice(0, full ? 5 : 1);
            const item = n => { const rot = n.type === 'Rotowire', txt = strip(rot ? n.story : n.description);
              return `<div class="ro-nw"><b>${esc(strip(n.headline))}</b>${txt && txt !== strip(n.headline) ? `<p>${esc(txt)}</p>` : ''}<small>${rot ? 'RotoWire' : 'ESPN'} · ${when(n.published)}</small></div>`; };
            // the Player Page: the latest report up top, older ones folded underneath
            return item(list[0]) + (list.length > 1 ? `<details class="pp-more"><summary>More recent news (${list.length - 1})</summary>${list.slice(1).map(item).join('')}</details>` : ''); })();
    } else if (tab === 'log') {
      const j = r.espn && espn('g' + r.espn, EAPI + r.espn + '/gamelog');
      if (!r.espn) body = noid; else if (!j) body = wait; else if (j.failed) body = fail;
      else {
        const stt = (j.seasonTypes || []).find(x => /Regular/.test(x.displayName || '')) || (j.seasonTypes || [])[0];
        const labels = j.labels || [], byEv = {};
        ((stt && stt.categories) || []).forEach(c => (c.events || []).forEach(e => { (byEv[e.eventId] = byEv[e.eventId] || []).push(...e.stats); }));
        const pick = (stats, cat, lab) => { let off = 0;
          for (const c of (j.categories || [])) { if (c.name === cat) { const i = labels.slice(off, off + c.count).indexOf(lab); return i < 0 ? '' : stats[off + i]; } off += c.count; }
          return ''; };
        const C = (STAT[r.pos] || []).flatMap(([cat, labs]) => labs.map(l => [cat, l]));
        const evs = Object.entries(j.events || {}).filter(([id]) => byEv[id]).sort((a, b) => (a[1].week || 0) - (b[1].week || 0));
        body = !evs.length ? '<p class="ro-wait">No games yet this season.</p>' : `<div class="tbl-wrap"><table class="ro-bt"><thead><tr><th class="l">Wk</th><th class="l">Opp</th><th class="l">Result</th><th>FBP pts</th>${C.map(([c, l]) =>
          `<th>${c === 'rushing' && r.pos !== 'RB' ? 'Ru ' : c === 'receiving' && r.pos === 'RB' ? 'Re ' : ''}${l}</th>`).join('')}</tr></thead><tbody>
          ${evs.map(([id, e]) => { const fp = fpts(e.week);
            return `<tr><td class="l">${e.week || ''}</td><td class="l ro-op">${e.atVs || ''} ${nflLogo((e.opponent || {}).abbreviation)}${esc((e.opponent || {}).abbreviation || '')}</td><td class="l">${esc(e.gameResult || '')} ${esc(e.score || '')}</td><td><b>${fp ? fp[0].toFixed(1) : wv(e.week) != null ? wv(e.week).toFixed(1) : '—'}</b>${heatChip(r, e.week)}${fp ? `<small>${fp[1] ? 'started' : 'bench'}${fp[2] !== t.abbr ? ' · ' + esc(fp[2]) : ''}</small>` : wv(e.week) != null ? `<small>${r.st === 'TAXI_SQUAD' ? 'taxi' : 'off lineup'}</small>` : ''}</td>${C.map(([c, l]) => `<td>${esc(String(pick(byEv[id], c, l) || ''))}</td>`).join('')}</tr>`; }).join('')}</tbody></table></div>
          <p class="ro-bnote">FBP points are league scoring. Started or bench shows his FBP lineup that week.</p>`;
      }
    } else if (tab === 'sched') {
      const code = NFL_ESPN[r.nfl] || (r.nfl || '').toLowerCase(), j = code && espn('s' + code, `https://site.api.espn.com/apis/site/v2/sports/football/nfl/teams/${code}/schedule`);
      if (!code) body = '<p class="ro-wait">He isn’t on an NFL team right now.</p>'; else if (!j) body = wait; else if (j.failed) body = fail;
      else {
        const evs = j.events || [], wks = evs.map(e => e.week && e.week.number), out = [];
        for (let w = 1; w <= 18; w++) { const e = evs[wks.indexOf(w)];
          if (!e) { out.push(`<tr class="bye"><td class="l">${w}</td><td class="l" colspan="3">Bye</td></tr>`); continue; }
          const c = e.competitions[0], me = c.competitors.find(x => x.team.abbreviation.toLowerCase() === code) || c.competitors[0], op = c.competitors.find(x => x !== me) || {};
          const done = c.status && c.status.type && c.status.type.completed, fp = fpts(w);
          const sc = done ? `${me.winner ? 'W' : op.winner ? 'L' : 'T'} ${(me.score || {}).displayValue}-${(op.score || {}).displayValue}`
            : new Date(e.date).toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
          out.push(`<tr class="${done ? 'pst' : ''}"><td class="l">${w}</td><td class="l ro-op">${me.homeAway === 'home' ? 'vs' : '@'} ${nflLogo(op.team && op.team.abbreviation)}${esc(op.team ? op.team.abbreviation : '')}</td><td class="l">${sc}</td><td>${done && fp ? fp[0].toFixed(1) : done && wv(w) != null ? wv(w).toFixed(1) : ''}${done ? heatChip(r, w) : ''}</td></tr>`); }
        body = `<div class="tbl-wrap"><table class="ro-bt"><thead><tr><th class="l">Wk</th><th class="l">Opp</th><th class="l">Result or kickoff</th><th>FBP pts</th></tr></thead><tbody>${out.join('')}</tbody></table></div>`;
      }
    } else if (tab === 'an') {
      const W = Object.entries(r.wks).map(([w, v]) => ({ w: +w, pts: v[0], s: v[1], team: v[2] }));
      const mine = W.filter(x => x.team === t.abbr), S = mine.filter(x => x.s), sp = S.reduce((s, x) => s + x.pts, 0);
      const best = W.slice().sort((a, b) => b.pts - a.pts)[0];
      const bar = { QB: 20, RB: 15, WR: 15, TE: 10, DEF: 10 }[r.pos] || 15;
      const benched = mine.filter(x => !x.s).reduce((s, x) => s + x.pts, 0);
      const tile = (l, v, sub) => `<div><small>${l}</small><b>${v}</b><span>${sub}</span></div>`;
      body = `<div class="ro-g">
        ${tile('Season', r.pts.toFixed(1), `${r.rk ? r.pos + r.rk + ' at his position' : '—'} · ${r.gp ? (r.pts / r.gp).toFixed(1) : '0.0'} a game`)}
        ${tile('Started for ' + esc(t.abbr), `${S.length} of ${mine.length}`, `${sp.toFixed(1)} pts started · ${t.pf ? (100 * sp / t.pf).toFixed(1) : 0}% of the team’s points`)}
        ${tile('Left on the bench', benched.toFixed(1), `points scored while not in ${esc(t.abbr)}’s lineup`)}
        ${tile('Best week', best ? best.pts.toFixed(1) : '—', best ? `week ${best.w}` : 'no games yet')}
        ${tile(`${bar}+ point weeks`, `${W.filter(x => x.pts >= bar).length} of ${W.length}`, `under ${Math.round(bar / 3)}: ${W.filter(x => x.pts < bar / 3).length}`)}
        ${tile('Rest of season', r.ecrPos ? r.pos + r.ecrPos : '—', `${r.ecr ? 'FantasyPros #' + r.ecr + ' overall · ' : ''}week ${R.projWeek} projection ${fx(r.proj, 1)}`)}
      </div>`;
      body += heatStrip(r);
    } else if (tab === 'sal') {
      const m = /(\d+)\/(\d+)/.exec(r.cy || ''), n = m ? +m[1] : 0, N = m ? (r.st === 'TAXI_SQUAD' && +m[2] === 5 && n === 1 ? 6 : +m[2]) : 0;
      const yrs = [[R.season, r.sal, n ? `Year ${n} of ${N}` : 'No contract year']].concat((r.fut || []).map((v, k) => [YEARS(k), v, `Year ${n + k + 1} · +$${STEP[N] ? STEP[N][n + k - 1] : ''}`]));
      const owed = yrs.reduce((s, y) => s + y[1], 0);
      body = `<div class="ro-yrs">${yrs.map(y => `<div><small>${y[0]}</small><b>$${y[1]}</b><span>${y[2]}</span></div>`).join('')}${N ? `<div class="fy"><small>${YEARS((r.fut || []).length)}</small><b>FA</b><span>back to the auction</span></div>` : ''}</div>
        <p class="ro-bnote">Acquired: <b>${esc(r.acq || '—')}</b>${r.newDeal ? ' (a new 3-year veteran deal)' : ''}. ${N === 6 ? 'Taxi rookie: a full first season on taxi earns the 6th year with salary frozen in year 2. ' : ''}${N ? `Owed ${$(owed)} through ${R.season + (r.fut || []).length}, escalators included.` : ''}</p>`;
    }
    if (tab === 'jour') {
      const J = r.jour || [];
      body = !J.length ? '<p class="ro-wait">No FBP moves on record for him yet.</p>'
        : `<ol class="ro-jr">${J.slice().reverse().map(([ts, f, kind, what]) => { const tt = ctx.teams[f] || {};
            return `<li class="k-${kind}"><span class="ro-jd">${new Date(ts * 1000).toLocaleDateString([], { month: 'short', year: 'numeric' })}</span>${tt.logo ? `<img src="${tt.logo}" alt="" loading="lazy">` : '<i></i>'}<span><b>${esc(tt.abbr || f)}</b> ${esc(what)}</span></li>`; }).join('')}</ol>
          <p class="ro-bnote">Newest first. Trades and pickups are on record from 2021; auctions and rookie drafts go back to the start.</p>`;
    }
    return body;
  }
  function box(r, t, ctx) {
    const tab = tabOf[r.id] || 'news';
    const head = `<div class="ro-tabs" role="tablist">${TABS.map(([k, l]) => `<button type="button" role="tab" data-ro-tab="${r.id}|${k}" aria-selected="${k === tab}">${l}</button>`).join('')}</div>`;
    return `<div class="ro-box">${profile(r, `#now/rosters/${t.fid}/${r.id}`)}${head}<div class="ro-bb">${part(r, t, ctx, tab)}</div></div>`;
  }

  // the Player Page (#now/rosters/<franchise>/<player>): everything the site has on one player
  const CAREER = { QB: [['passing', ['GP', 'CMP', 'ATT', 'YDS', 'TD', 'INT', 'RTG']], ['rushing', ['CAR', 'YDS', 'TD']]],
    RB: [['rushing', ['GP', 'CAR', 'YDS', 'AVG', 'TD']], ['receiving', ['REC', 'YDS', 'TD']]],
    WR: [['receiving', ['GP', 'REC', 'TGTS', 'YDS', 'AVG', 'TD']], ['rushing', ['CAR', 'YDS']]],
    TE: [['receiving', ['GP', 'REC', 'TGTS', 'YDS', 'AVG', 'TD']]] };
  function careerStats(r, esc) {
    const j = espn('c' + r.espn, EAPI + r.espn + '/stats');
    if (!j) return '<p class="ro-wait">Loading from ESPN…</p>';
    if (j.failed) return '<p class="ro-wait">ESPN didn’t answer. Try again in a minute.</p>';
    const cats = Object.fromEntries((j.categories || []).map(c => [c.name, c]));
    const want = (CAREER[r.pos] || []).filter(([c]) => cats[c] && (cats[c].statistics || []).length);
    if (!want.length) return '<p class="ro-wait">No NFL stats on record.</p>';
    const key = x => x.season.year + '|' + (x.teamSlug || x.teamId), seasons = [];
    want.forEach(([c]) => cats[c].statistics.forEach(x => { if (!seasons.some(s => s.k === key(x))) seasons.push({ k: key(x), y: x.season.year, slug: x.teamSlug }); }));
    seasons.sort((a, b) => b.y - a.y);
    const val = (c, lab, x) => { const i = cats[c].labels.indexOf(lab); return i < 0 || !x ? '' : x.stats[i]; };
    const cols = want.flatMap(([c, labs], wi) => labs.filter(l => cats[c].labels.includes(l) && !(wi && l === 'GP')).map(l => [c, l]));
    const hdr = cols.map(([c, l], i) => `<th${i && cols[i - 1][0] !== c ? ' class="gap"' : ''}>${c === 'rushing' && r.pos !== 'RB' && l !== 'GP' ? 'Ru ' : c === 'receiving' && r.pos === 'RB' ? 'Re ' : ''}${l}</th>`).join('');
    const ab = slug => ((j.teams || {})[slug] || {}).abbreviation || '';
    const rows = seasons.map(S => `<tr><td class="l">${S.y}</td><td class="l ro-op">${nflLogo(NFL_ESPN[ab(S.slug)] || ab(S.slug))}${esc(ab(S.slug))}</td>${cols.map(([c, l], i) => {
      const x = cats[c].statistics.find(z => key(z) === S.k); return `<td${i && cols[i - 1][0] !== c ? ' class="gap"' : ''}>${esc(String(val(c, l, x) || ''))}</td>`; }).join('')}</tr>`).join('');
    const tot = `<tr class="pp-tot"><td class="l" colspan="2">Career</td>${cols.map(([c, l], i) => { const k = cats[c].labels.indexOf(l); return `<td${i && cols[i - 1][0] !== c ? ' class="gap"' : ''}>${esc(String((cats[c].totals || [])[k] || ''))}</td>`; }).join('')}</tr>`;
    return `<div class="tbl-wrap"><table class="ro-bt"><thead><tr><th class="l">Year</th><th class="l">Team</th>${hdr}</tr></thead><tbody>${rows}${tot}</tbody></table></div>`;
  }
  function weekBars(r, t) {
    const n = Math.max(R.through || 0, ...Object.keys(r.wsc || {}).map(Number));
    if (!n) return '';
    const W = Array.from({ length: n }, (_, i) => { const w = i + 1, v = (r.wsc || {})[String(w)], k = r.wks[String(w)];
      return { w, v, cls: v == null ? 'none' : k && k[2] === t.abbr ? (k[1] ? 'st' : 'bn') : k ? 'ot' : 'fa', who: k ? k[2] : '' }; });
    const top = Math.max(10, Math.ceil(Math.max(...W.map(d => d.v || 0)) / 10) * 10), w = 600, h = 180, pl = 32, pb = 24, pt = 8;
    const cw = (w - pl - 6) / n, bw = Math.min(30, cw * .6), y = v => pt + (h - pt - pb) * (1 - v / top), x = i => pl + cw * i + cw / 2;
    const grid = [0, top / 2, top].map(v => `<line x1="${pl}" x2="${w - 6}" y1="${y(v)}" y2="${y(v)}" class="g"/><text x="${pl - 5}" y="${y(v) + 4}" class="ax" text-anchor="end">${v}</text>`).join('');
    const bars = W.map((d, i) => `<g><title>Week ${d.w}: ${d.w === r.bye && d.v == null ? 'bye' : d.v == null ? 'no game' : d.v.toFixed(1) + (d.cls === 'st' ? ' · started' : d.cls === 'bn' ? ' · bench' : d.cls === 'ot' ? ' · with ' + d.who : ' · not on an FBP lineup')}</title>${d.w === r.bye && d.v == null ? `<text x="${x(i)}" y="${y(0) - 6}" class="ax" text-anchor="middle">bye</text>` : d.v != null ? `<rect x="${x(i) - bw / 2}" y="${y(d.v)}" width="${bw}" height="${Math.max(1, y(0) - y(d.v))}" rx="3" class="pb ${d.cls}"/>` : `<text x="${x(i)}" y="${y(0) - 4}" class="ax" text-anchor="middle">–</text>`}<text x="${x(i)}" y="${h - 7}" class="ax" text-anchor="middle">${d.w}</text></g>`).join('');
    const avg = r.gp ? r.pts / r.gp : 0;
    return `<svg class="ro-wk pp-wk" viewBox="0 0 ${w} ${h}" role="img" aria-label="FBP points by week">${grid}${avg ? `<line x1="${pl}" x2="${w - 6}" y1="${y(avg)}" y2="${y(avg)}" class="pp-avg"/>` : ''}${bars}</svg>
      <div class="ro-key"><span><i class="pk st"></i>Started</span><span><i class="pk bn"></i>Bench</span>${W.some(d => d.cls === 'ot') ? '<span><i class="pk ot"></i>Another FBP team</span>' : ''}${W.some(d => d.cls === 'fa') ? '<span><i class="pk fa"></i>Taxi or free agent</span>' : ''}<span><i class="pk av"></i>His average, ${avg.toFixed(1)}</span></div>`;
  }
  function fbpCareer(r, ctx) {
    const esc = ctx.esc, j = espn('PR', 'data/player-records.json');
    if (!j) return '<p class="ro-wait">Loading…</p>';
    if (j.failed) return '<p class="ro-wait">Career records didn’t load.</p>';
    const a = (j.players || []).find(p => p[0] === r.id);
    if (!a) return '<p class="ro-wait">He hasn’t started an FBP game yet.</p>';
    const P = {}; j.fields.forEach((k, i) => P[k] = a[i]);
    const T = P.teams.map(b => { const o = {}; j.team_fields.forEach((k, i) => o[k] = b[i]); return o; });
    const n = P.w + P.l + P.t, rec = (w, l, tt) => `${w}-${l}${tt ? '-' + tt : ''}`, pn = P.pw + P.pl + P.pt;
    const yrs = a2 => a2.length === 1 ? String(a2[0]) : `${a2[0]}–${String(a2[a2.length - 1]).slice(2)}`;
    return `<div class="ro-g">
        <div><small>Starts</small><b>${n}</b><span>${j.first}–${j.last}</span></div>
        <div><small>Record as a starter</small><b>${rec(P.w, P.l, P.t)}</b><span>${n ? ((P.w + P.t / 2) / n).toFixed(3).replace(/^0/, '') : '—'} win pct</span></div>
        <div><small>Points as a starter</small><b>${P.pts.toFixed(1)}</b><span>${n ? (P.pts / n).toFixed(1) : '—'} a start</span></div>
        <div><small>Playoffs</small><b>${pn ? rec(P.pw, P.pl, P.pt) : '—'}</b><span>${pn ? P.popts.toFixed(1) + ' playoff points' : 'no playoff starts'}</span></div>
      </div>
      <div class="tbl-wrap"><table class="ro-bt pp-ct"><thead><tr><th class="l">FBP team</th><th class="l">Seasons</th><th>Starts</th><th>Record</th><th>Playoffs</th></tr></thead><tbody>
        ${T.sort((x, z) => (z.w + z.l + z.t) - (x.w + x.l + x.t)).map(o => { const tt = ctx.teams[o.franchise] || {};
          return `<tr><td class="l ro-op">${tt.logo ? `<img class="pp-fl" src="${tt.logo}" alt="">` : ''}${esc(tt.abbr || o.franchise)}</td><td class="l">${yrs(o.years)}</td><td>${o.w + o.l + o.t}</td><td>${rec(o.w, o.l, o.t)}</td><td>${o.pw + o.pl + o.pt ? rec(o.pw, o.pl, o.pt) : '—'}</td></tr>`; }).join('')}</tbody></table></div>
      <p class="ro-bnote">Records count the weeks he was in the starting lineup, from ${j.first}.</p>`;
  }
  function honors(r, ctx) {
    const esc = ctx.esc, af = espn('AF', 'data/awards/all-fbp.json'), hf = espn('HOF', 'data/reference/hall-of-fame.json');
    if (!af || !hf) return '<p class="ro-wait">Loading…</p>';
    const items = [];
    (r.hon || []).forEach(h => items.push([R.season, `<span class="ro-chip ${h[1]}">${esc(h[0])}</span>`, esc(h[2]) + ' (so far this season)']));
    Object.entries((af && af.franchises) || {}).forEach(([f, list]) => (list || []).filter(p => p.id === r.id).forEach(p => (p.years || []).forEach(yy => {
      const tt = ctx.teams[f] || {}, team = esc(tt.abbr || f);
      items.push([+yy.year, `<span class="ro-chip ${yy.tier === 1 ? 'gold' : 'silver'}">${yy.tier === 1 ? '1st Team' : '2nd Team'}</span>`, `All-FBP ${yy.tier === 1 ? 'first' : 'second'} team with ${team} · ${(+yy.pts).toFixed(1)} pts in ${yy.starts} starts`]);
      if (yy.mvp) items.push([+yy.year, '<span class="ro-chip gold">MVP</span>', `FBP Most Valuable Player with ${team}`]);
      if (yy.champ) items.push([+yy.year, '<span class="ro-chip good">Champ</span>', `Won the FBP title with ${team}`]); })));
    const hof = ((hf && hf.inductees) || []).filter(x => x.player_id === r.id);
    const list = items.sort((a, b) => b[0] - a[0]).map(([y, chip, what]) => `<li><span class="ro-jd">${y}</span>${chip}<span>${what}</span></li>`).join('');
    return (hof.length ? hof.map(x => `<div class="pp-hof"><b>Hall of Fame · class of ${esc(String(x.class))}</b>${x.stat ? `<small>${esc(x.stat)}</small>` : ''}${x.blurb ? `<p>${esc(x.blurb)}</p>` : ''}</div>`).join('') : '')
      + (list ? `<ol class="pp-hon">${list}</ol>` : hof.length ? '' : '<p class="ro-wait">No FBP awards yet. All-FBP teams go back to 2021.</p>');
  }
  function playerPage(r, t, ctx) {
    const esc = ctx.esc, tm = ctx.teams[t.fid] || {}, def = r.pos === 'DEF';
    const code = NFL_ESPN[r.nfl] || (r.nfl || '').toLowerCase();
    const a = r.espn && !def ? espn('a' + r.espn, EAPI + r.espn) : null, at = (a && a.athlete) || {};
    const photo = def && code ? `<span class="pp-ph pp-def" style="background-image:url(https://a.espncdn.com/i/teamlogos/nfl/500/${code}.png)"></span>`
      : `<span class="pp-ph"${medalOf(r) ? ` data-med="${medalOf(r)}"` : ''}${r.espn ? ` style="background-image:url(https://a.espncdn.com/i/headshots/nfl/players/full/${r.espn}.png),var(--med,none)"` : ''}></span>`;
    // FBP IR slot chip, unless his NFL injury chip already says IR
    const nflIR = r.espn && (injMap()[r.espn] || {}).status === 'Injured Reserve';
    const chip = r.st === 'TAXI_SQUAD' ? '<span class="ro-chip t">TAXI</span>' : r.st === 'INJURED_RESERVE' && !nflIR ? '<span class="ro-chip i" title="In an FBP IR slot">IR</span>' : '';
    const aw = (r.hon || []).map(h => `<span class="ro-chip ${h[1]}" title="${esc(h[2])}">${esc(h[0])}</span>`).join('');
    const bio = [['Age', r.age || at.age], ['Size', [at.displayHeight, at.displayWeight].filter(Boolean).join(', ')], ['College', (at.college || {}).name],
      ['Drafted', at.displayDraft], ['Experience', at.displayExperience], ['From', at.displayBirthPlace]].filter(x => x[1]);
    const n = r.gp || 0;
    const tile = (l, v, sub) => `<div class="ro-tile"><small>${l}</small><b>${v}</b><span>${sub}</span></div>`;
    const sec = (title, body, cls) => body ? `<section class="card ro-card pp-sec${cls ? ' ' + cls : ''}"><h2>${title}</h2>${body}</section>` : '';
    return `<div class="pp">
      <a class="pp-back" href="#now/rosters/${t.fid}"><span aria-hidden="true">←</span> ${esc(t.name)} roster</a>
      <div class="pp-hero" style="--tc:${tm.primary || 'var(--line)'}">${photo}
        <div class="pp-id"><h2>${esc(r.name)}${injChip(r)}${chip}${aw}</h2>
          <p>${r.pos}${r.nfl ? ` · ${nflLogo(code)}${esc(r.nfl)}` : ' · NFL free agent'}${at.jersey ? ' · #' + esc(at.jersey) : ''}</p>
          <p class="pp-fbp">${tm.logo ? `<img src="${tm.logo}" alt="">` : ''}${esc(t.name)}${r.st === 'TAXI_SQUAD' ? ' · taxi squad' : r.st === 'INJURED_RESERVE' ? ' · injured reserve' : ''}</p></div></div>
      ${bio.length ? `<dl class="pp-bio">${bio.map(([k, v]) => `<div><dt>${k}</dt><dd>${esc(String(v))}</dd></div>`).join('')}</dl>` : ''}
      ${profile(r)}
      <div class="ro-tiles pp-tiles">
        ${tile(`${R.season} points`, r.gp ? r.pts.toFixed(1) : '—', r.rk ? `${r.pos}${r.rk} at his position` : 'no games yet')}
        ${tile('Per game', n ? (r.pts / n).toFixed(1) : '—', `${n} game${n === 1 ? '' : 's'}`)}
        ${tile('Rest of season', r.ecrPos ? r.pos + r.ecrPos : '—', r.ecr ? `FantasyPros #${r.ecr} overall` : 'FantasyPros consensus')}
        ${tile(`Week ${R.projWeek}`, fx(r.proj, 1), `MFL projection${r.bye ? ' · bye week ' + r.bye : ''}`)}
        ${tile('Salary', $(r.sal), `${r.cy ? 'contract year ' + r.cy : 'no contract year'}${r.fut && r.fut.length ? ' · ' + $(r.fut[0]) + ' next year' : ''}`)}
      </div>
      ${sec(`${R.season} FBP points by week`, weekBars(r, t))}
      ${def ? '' : sec('Latest news', part(r, t, ctx, 'news', true))}
      ${sec('Season analytics', part(r, t, ctx, 'an'))}
      ${def ? '' : sec(`${R.season} game log`, part(r, t, ctx, 'log'))}
      <div class="pp-two">${sec('Schedule', part(r, t, ctx, 'sched'))}${sec('Contract', part(r, t, ctx, 'sal'))}</div>
      ${sec('FBP career', fbpCareer(r, ctx))}
      ${sec('Awards and honors', honors(r, ctx))}
      ${def || !r.espn || !CAREER[r.pos] ? '' : sec('NFL career stats', careerStats(r, esc))}
      ${sec('FBP journey', part(r, t, ctx, 'jour'))}
      <p class="rf-foot">Through week ${R.through}. NFL stats, bio, news and schedules come from ESPN; points are FBP scoring.</p>
    </div>`;
  }

  // points by week, against the league average, low and high
  function weekly(t, esc, tm) {
    const W = t.weeks || [], n = W.length;
    if (!n) return '';
    const top = Math.ceil(Math.max(...W.map(x => x.hi)) / 20) * 20, w = 600, h = 220, padL = 40, padB = 26, padT = 10;
    const cw = (w - padL - 8) / n, bw = Math.min(34, cw * .5), y = v => padT + (h - padT - padB) * (1 - v / top), x = i => padL + cw * i + cw / 2;
    const grid = [0, top / 2, top].map(v => `<line x1="${padL}" x2="${w - 8}" y1="${y(v)}" y2="${y(v)}" class="g"/><text x="${padL - 6}" y="${y(v) + 4}" class="ax" text-anchor="end">${v}</text>`).join('');
    const marks = W.map((d, i) => `<g><title>Week ${d.w}: ${d.pts.toFixed(1)} (${d.res || ''}${d.opp ? ' vs ' + (tm(d.opp).abbr || '') : ''}) · league avg ${d.avg.toFixed(1)}, low ${d.lo.toFixed(1)}, high ${d.hi.toFixed(1)}</title>
        <line x1="${x(i)}" x2="${x(i)}" y1="${y(d.hi)}" y2="${y(d.lo)}" class="rng"/>
        <rect x="${x(i) - bw / 2}" y="${y(d.pts)}" width="${bw}" height="${Math.max(0, y(0) - y(d.pts))}" rx="3" class="bar ${d.res === 'W' ? 'w' : 'l'}"/>
        <text x="${x(i)}" y="${h - 8}" class="ax" text-anchor="middle">${d.w}</text></g>`).join('');
    const avg = `<polyline class="avg" points="${W.map((d, i) => `${x(i)},${y(d.avg)}`).join(' ')}"/>` + W.map((d, i) => `<circle cx="${x(i)}" cy="${y(d.avg)}" r="3.5" class="avgd"/>`).join('');
    const pa = d => d.pts - d.avg, mx = Math.max(...W.map(d => Math.abs(pa(d))), 5);
    const losses = W.filter(d => d.res === 'L'), wins = W.filter(d => d.res === 'W');
    const tough = losses.slice().sort((a, b) => pa(b) - pa(a))[0], lucky = wins.slice().sort((a, b) => pa(a) - pa(b))[0];
    const up = W.filter(d => pa(d) >= 0), dn = W.filter(d => pa(d) < 0), rec = L => `${L.filter(d => d.res === 'W').length}-${L.filter(d => d.res === 'L').length}`;
    const vs = d => `${d.pts.toFixed(1)} vs ${esc(tm(d.opp).abbr || '')} ${d.oppPts != null ? d.oppPts.toFixed(1) : ''}`;
    return `<section class="card ro-card ro-fold${wkShut ? ' shut' : ''}"><button type="button" class="ro-tog" data-ro-wk aria-expanded="${!wkShut}"><span class="ro-car" aria-hidden="true"></span><h2>Points by week</h2></button><div class="ro-fb"><p class="ro-why">Bars are ${esc(t.name)}’s score each week, dark for a win and light for a loss. The dots are the league average; the thin line behind each bar runs from that week’s lowest score to its highest.</p>
      <svg class="ro-wk" viewBox="0 0 ${w} ${h}" role="img" aria-label="Points by week">${grid}${marks}${avg}</svg>
      <div class="ro-key"><span><i class="kw"></i>Win</span><span><i class="kl"></i>Loss</span><span><i class="kd"></i>League average</span><span><i class="kr"></i>League low to high</span></div>
      <h3>Against the league average</h3><p class="ro-why">Points above or below the average team each week. A big week in a low-scoring week counts for more than the raw score shows.</p>
      <div class="tbl-wrap"><table class="ro-pa"><thead><tr><th class="l">Week</th>${W.map(d => `<th>${d.w}</th>`).join('')}<th>Season</th></tr></thead><tbody>
        <tr><td class="l">Points</td>${W.map(d => `<td>${d.pts.toFixed(1)}</td>`).join('')}<td><b>${t.pf.toFixed(1)}</b></td></tr>
        <tr><td class="l">League avg</td>${W.map(d => `<td class="ro-mu">${d.avg.toFixed(1)}</td>`).join('')}<td class="ro-mu">${(W.reduce((s, d) => s + d.avg, 0) / n).toFixed(1)}</td></tr>
        <tr><td class="l">vs avg</td>${W.map(d => { const v = pa(d); return `<td class="ro-hs ${v >= 0 ? 'up' : 'dn'}" style="--a:${Math.min(1, Math.abs(v) / mx).toFixed(2)}">${sg(v)}</td>`; }).join('')}<td><b>${sg(t.paa)}</b></td></tr>
        <tr><td class="l">Result</td>${W.map(d => `<td class="ro-res">${d.res || '—'}${d.opp ? `<small>${esc(tm(d.opp).abbr || '')}</small>` : ''}</td>`).join('')}<td>${t.rec[0]}-${t.rec[1]}${t.rec[2] ? '-' + t.rec[2] : ''}</td></tr>
      </tbody></table></div>
      <div class="ro-ins">${tough ? `<div><small>Toughest loss</small><b>Week ${tough.w}: ${sg(pa(tough))}</b><span>${vs(tough)}</span></div>` : ''}
        ${lucky ? `<div><small>Luckiest win</small><b>Week ${lucky.w}: ${sg(pa(lucky))}</b><span>${vs(lucky)}</span></div>` : ''}
        <div><small>Above-average weeks</small><b>${up.length} of ${n}</b><span>record ${rec(up)} in those weeks, ${rec(dn)} in the rest</span></div></div>
    </div></section>`;
  }

  let lastPid = '', rosterY = 0;
  function render(ctx, sub, pid) {
    X = ctx; load();
    if (R && pid !== lastPid) {   // the Player Page opens at the top; the back arrow returns to where you were on the roster
      if (pid && !lastPid) rosterY = window.scrollY;
      const y = pid ? 0 : rosterY; requestAnimationFrame(() => window.scrollTo(0, y)); lastPid = pid;
    }
    if (failed) return '<p class="error">Rosters didn’t load. Refresh the page to try again.</p>';
    if (!R) return '<p class="loading">Loading rosters…</p>';
    const esc = ctx.esc, tmx = f => ctx.teams[f] || {};
    const ids = Object.keys(R.teams).sort((a, b) => R.teams[a].name.localeCompare(R.teams[b].name));
    const pickd = (sub && R.teams[sub]) ? sub : (ctx.myTeam && R.teams[ctx.myTeam]) ? ctx.myTeam : ids[0];
    const t = R.teams[pickd]; t.abbr = tmx(pickd).abbr || ''; t.fid = pickd;
    if (pid) { const r = t.rows.find(x => x.id === pid); if (r) return playerPage(r, t, ctx); }
    const lg = (f, cls) => tmx(f).logo ? `<img class="${cls || ''}" src="${tmx(f).logo}" alt="" loading="lazy">` : '';
    const rows = t.rows, C = cols(), val = (r, k) => C.find(c => c[0] === k)[2](r);
    const act = rows.filter(r => r.st === 'ROSTER'), tx = rows.filter(r => r.st === 'TAXI_SQUAD'), ir = rows.filter(r => r.st === 'INJURED_RESERVE');
    const pay = rows.reduce((s, r) => s + r.sal, 0);
    const yr = k => rows.reduce((s, r) => s + (r.fut && r.fut[k] != null ? r.fut[k] : 0), 0);
    const sorted = list => list.slice().sort((a, b) => { const x = val(a, sort[0]), y = val(b, sort[0]);
      if (typeof x === 'string') return sort[1] * x.localeCompare(y);
      if (x == null && y == null) return b.sal - a.sal; if (x == null) return 1; if (y == null) return -1;
      return sort[1] * (x - y) || b.sal - a.sal; });
    const NC = C.length + 1;
    const row = r => {
      const yrs = [0, 1, 2, 3, 4].map(k => { const v = r.fut ? r.fut[k] : undefined;
        return `<td>${v != null ? $(v) : r.fut && k === r.fut.length ? '<span class="ro-fa">FA</span>' : ''}</td>`; }).join('');
      // the roster already groups him under Injured reserve, so his FBP IR slot gets no chip here; any NFL injury chip stays
      const chip = r.st === 'TAXI_SQUAD' ? '<span class="ro-chip t">TAXI</span>' : '';
      const aw = (r.hon || []).map(h => `<span class="ro-chip ${h[1]}" title="${esc(h[2])}">${esc(h[0])}</span>`).join('');
      // defenses get their NFL team's logo; players their ESPN headshot
      const img = r.pos === 'DEF' && r.nfl ? `class="ro-def" style="background-image:url(https://a.espncdn.com/i/teamlogos/nfl/500/${NFL_ESPN[r.nfl] || r.nfl.toLowerCase()}.png)"`
        : r.espn ? `style="background-image:url(https://a.espncdn.com/i/headshots/nfl/players/full/${r.espn}.png),var(--med,none)"` : '';
      const n = r.gp || 0, isOpen = open.has(r.id);
      return `<tr class="ro-p${r.st === 'TAXI_SQUAD' ? ' tx' : r.st === 'INJURED_RESERVE' ? ' ir' : ''}${isOpen ? ' on' : ''}" data-ro-p="${r.id}" aria-expanded="${isOpen}">
        <td class="ro-ph"><span ${img}${medalOf(r) ? ` data-med="${medalOf(r)}"` : ''}></span></td>
        <td class="l ro-nm"><b>${esc(r.name)}</b>${injChip(r)}${chip}${aw}<small>${r.pos} · ${r.nfl ? `<span class="ro-nflt" title="${esc(r.nfl)}">${nflLogo(NFL_ESPN[r.nfl] || r.nfl)}</span>` : 'FA'}${r.age ? ' · age ' + r.age : ''}</small></td>
        <td>${r.gp ? r.pts.toFixed(1) : '—'}</td><td>${n ? (r.pts / n).toFixed(1) : '—'}</td><td class="ro-m">${r.ecrPos ? r.pos + r.ecrPos : '—'}</td>
        <td class="ro-m">${r.rk ? r.pos + r.rk : ''}</td><td>${r.bye || '—'}</td><td class="c">${fx(r.proj, 1)}</td>${oppCell(r, R.projWeek)}${oppCell(r, R.projWeek + 1)}
        <td class="gap ro-s">${$(r.sal)}</td><td class="ro-m">${r.cy || '—'}</td>${yrs}</tr>
        ${isOpen ? `<tr class="ro-det"><td colspan="${NC}">${box(r, t, ctx)}</td></tr>` : ''}`;
    };
    const grp = (label, list) => list.length ? `<tr class="ro-grp"><td colspan="${NC}"><span>${label} · ${list.length} · ${$(list.reduce((s, r) => s + r.sal, 0))}</span></td></tr>` + sorted(list).map(row).join('') : '';
    const head = C.map(([k, l]) => { const on = sort[0] === k;
      return `<th class="ro-sort${k === 'name' ? ' l' : ''}${k === 'sal' ? ' gap' : ''}${k === 'proj' || k === 'o0' || k === 'o1' ? ' c' : ''}" data-ro-sort="${k}" aria-sort="${on ? (sort[1] < 0 ? 'descending' : 'ascending') : 'none'}">${l}${on ? (sort[1] < 0 ? ' ▼' : ' ▲') : ''}</th>`; }).join('');
    const top = rows.slice().sort((a, b) => b.sal - a.sal)[0];
    const F = t.face, n = (t.weeks || []).length;
    const faceLine = F ? [`${F.seasons} season${F.seasons === 1 ? '' : 's'}${F.first ? ' since ' + F.first : ''}`, `${F.starts} starts`,
      ...Object.entries(F.honors || {}).map(([k, v]) => `${v > 1 ? v + '× ' : ''}${k}`), F.titles ? `${F.titles > 1 ? F.titles + '× ' : ''}champion` : ''].filter(Boolean).join(' · ') : '';
    requestAnimationFrame(() => document.querySelectorAll('.ro-tabs').forEach(tl => { const on = tl.querySelector('[aria-selected="true"]');
      if (on && (on.offsetLeft + on.offsetWidth > tl.scrollLeft + tl.clientWidth || on.offsetLeft < tl.scrollLeft)) tl.scrollLeft = on.offsetLeft - 8; }));
    requestAnimationFrame(() => { const el = document.querySelector('.ro-pick'); if (!el) return;
      if (pickX != null) el.scrollLeft = pickX;
      else { const on = el.querySelector('[aria-selected="true"]'); if (on && on.offsetLeft + on.offsetWidth > el.clientWidth) el.scrollLeft = on.offsetLeft - (el.clientWidth - on.offsetWidth) / 2; } });
    return `<div class="ro-pick" role="tablist" aria-label="Teams">${ids.map(f => `<a href="#now/rosters/${f}" role="tab" aria-selected="${f === pickd}" title="${esc(R.teams[f].name)}">${lg(f)}<b>${esc(tmx(f).abbr || '')}</b></a>`).join('')}</div>
      ${findBox(esc)}
      <div class="ro-th" style="--tc:${tmx(pickd).primary || 'var(--line)'}">${lg(pickd, 'ro-tl')}<div><h2>${esc(t.name)}</h2><p>${esc(t.owner)} · ${t.rec[0]}-${t.rec[1]}${t.rec[2] ? '-' + t.rec[2] : ''}<br>${t.pf.toFixed(1)} points</p></div></div>
      <div class="ro-tiles">
        <div class="ro-tile"><small>${R.season} payroll</small><b>${$(pay)}</b><span>${act.length} active · ${tx.length} taxi · ${ir.length} IR</span></div>
        <div class="ro-tile"><small>Vs. league average</small><b>${sg(n ? t.paa / n : 0)}</b><span>points a week · ${ord(t.paaRank)} of 12</span></div>
        <div class="ro-tile ro-face">${F ? `<span class="ro-fph" ${F.espn ? `style="background-image:url(https://a.espncdn.com/i/headshots/nfl/players/full/${F.espn}.png)"` : ''}></span><div><small>Face of the Franchise</small><b>${esc(F.name)}</b><span>${esc(F.pos)} · ${esc(faceLine)}</span></div>` : '<div><small>Face of the Franchise</small><b>—</b></div>'}</div>
        <div class="ro-tile"><small>Top contract</small><b>${top ? $(top.sal) : '—'}</b><span>${top ? esc(top.name) : ''}</span></div>
      </div>
      ${t.note && t.note.body ? `<section class="card ro-card ro-note ro-fold${noteShut ? ' shut' : ''}"><button type="button" class="ro-tog" data-ro-fold="note" aria-expanded="${!noteShut}"><span class="ro-car" aria-hidden="true"></span><h2>State of the Team</h2></button>
        <div class="ro-fb"><p>${esc(t.note.body)}</p>${t.note.last || t.note.news ? `<hr>${t.note.last ? `<p><b>Last week.</b> ${esc(t.note.last.replace(/^Week \d+: /, '').replace(/^./, c => c.toUpperCase()))}</p>` : ''}${t.note.news ? `<p><b>Team news.</b> ${esc(t.note.news)}</p>` : ''}` : ''}${t.note.next ? `<hr><p>${esc(t.note.next)}</p>` : ''}<small>Through week ${R.through} · from the standings, scores and the playoff simulation</small></div></section>` : ''}
      ${weekly(t, esc, tmx)}
      <section class="card ro-card"><h2>Roster</h2><p class="ro-why">Tap a column to sort; players stay grouped by position. Tap a player to open his news, game log, schedule, analytics and salary. Slide the table for future salaries.</p>
        <div class="tbl-wrap ro-wrap"><table class="ro-t"><thead><tr><th class="ro-ph"></th>${head}</tr></thead>
        <tbody>${POS.map(p => grp(GRP[p], act.filter(r => r.pos === p))).join('')}${grp('Taxi squad', tx)}${grp('Injured reserve', ir)}</tbody>
        <tfoot><tr><td class="ro-ph"></td><td class="l">Total</td><td>${rows.reduce((s, r) => s + r.pts, 0).toFixed(1)}</td><td></td><td></td><td></td><td></td><td></td><td class="gap">${$(pay)}</td><td></td>${[0, 1, 2, 3, 4].map(k => `<td>${yr(k) ? $(yr(k)) : ''}</td>`).join('')}</tr></tfoot></table></div>
        <p class="ro-why ro-fn">ECR is FantasyPros’ rest-of-season consensus rank at the position${R.ecrUpdated ? ` (as of ${new Date(R.ecrUpdated + 'T12:00:00').toLocaleDateString([], { month: 'short', day: 'numeric' })})` : ''}. Week ${R.projWeek} projections are MFL’s. Points are his whole season in league scoring, wherever he was (taxi and free-agent weeks included); Pts/wk is per game, and Rank is his season points among every player at the position. Future salaries use the by-law escalators; a player picked up off waivers or as a free agent this season is on a new 3-year veteran deal, and a rookie on taxi is shown on the 6-year path.</p></section>
      <p class="rf-foot">Through week ${R.through}. Face of the Franchise: the current player with the most history on this team, counting starts, seasons, All-FBP teams, MVPs, Rookie of the Year and championships, across every stint.</p>`;
  }

  document.addEventListener('click', e => {
    const t = e.target.closest ? e.target : null; if (!t || !document.querySelector('.ro-t, .ro-pick')) return;
    const pk = t.closest('.ro-pick'); if (pk) { pickX = pk.scrollLeft; return; }
    if (t.closest('[data-ro-hit]')) { findQ = ''; return; }
    const nt = t.closest('[data-ro-fold="note"]'); if (nt) { noteShut = !noteShut; try { localStorage.setItem('fbp-ro-note', noteShut ? 'shut' : 'open'); } catch (err) {}
      nt.closest('.ro-fold').classList.toggle('shut', noteShut); nt.setAttribute('aria-expanded', String(!noteShut)); return; }
    const wt = t.closest('[data-ro-wk]'); if (wt) { wkShut = !wkShut; try { localStorage.setItem('fbp-ro-wk', wkShut ? 'shut' : 'open'); } catch (err) {}
      wt.closest('.ro-fold').classList.toggle('shut', wkShut); wt.setAttribute('aria-expanded', String(!wkShut)); return; }
    const tb = t.closest('[data-ro-tab]'); if (tb) { const [id, k] = tb.dataset.roTab.split('|'); tabOf[id] = k; return redraw(); }
    if (t.closest('.ro-box')) return;
    const h = t.closest('[data-ro-sort]'); if (h) { const k = h.dataset.roSort; sort = sort[0] === k ? [k, -sort[1]] : [k, k === 'name' ? 1 : -1]; return redraw(); }
    const p = t.closest('[data-ro-p]'); if (p) { const id = p.dataset.roP; open.has(id) ? open.delete(id) : open.add(id); return redraw(); }
  });
  return { render };
})();
