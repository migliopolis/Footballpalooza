/* League Now > Rosters (#now/rosters, #now/rosters/<franchise>): every FBP roster, from data/rosters.json
   (scripts/rosters.py). Team logos up top pick the team. Tiles, points by week against the league average, and a
   roster table grouped by position (then taxi and IR) that sorts by any column. Tapping a player opens his box:
   News, Game log and Schedule load from ESPN when opened (news is ESPN's RotoWire feed); Analytics and Salary come
   from the site's own data. */
window.FBPRosters = (function () {
  let R = null, loading = false, failed = false, X = null;
  let sort = ['sal', -1];
  const open = new Set(), tabOf = {}, cache = {};
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
  const TABS = [['news', 'News'], ['log', 'Game log'], ['sched', 'Schedule'], ['an', 'Analytics'], ['sal', 'Salary']];
  const STEP = { 3: [3, 6], 5: [3, 6, 9, 12], 6: [0, 3, 6, 9, 12] };
  const NFL_ESPN = { GBP: 'gb', KCC: 'kc', NEP: 'ne', NOS: 'no', SFO: 'sf', TBB: 'tb', LVR: 'lv', JAC: 'jax', WAS: 'wsh', LA: 'lar' };
  const STAT = { QB: [['passing', ['CMP', 'ATT', 'YDS', 'TD', 'INT']], ['rushing', ['CAR', 'YDS', 'TD']]],
    RB: [['rushing', ['CAR', 'YDS', 'TD']], ['receiving', ['REC', 'YDS', 'TD']]],
    WR: [['receiving', ['REC', 'TGTS', 'YDS', 'TD']]], TE: [['receiving', ['REC', 'TGTS', 'YDS', 'TD']]] };
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

  // sortable columns: key, label, value (text sorts A to Z first; missing values sink)
  const cols = () => [
    ['name', 'Player', r => r.name],
    ['bye', 'Bye', r => r.bye],
    ['ecr', 'ECR', r => r.ecrPos == null ? null : -r.ecrPos],
    ['proj', `Wk ${R.projWeek} proj`, r => r.proj],
    ['pts', 'Pts', r => r.pts],
    ['ppw', 'Pts/wk', r => { const n = Object.keys(r.wks).length; return n ? r.pts / n : null; }],
    ['rk', 'Rank', r => r.rk == null ? null : -r.rk],
    ['sal', String(R.season), r => r.sal],
    ['cy', 'Yr', r => r.fut ? r.fut.length : -1],
    ...[0, 1, 2, 3, 4].map(k => ['y' + k, String(YEARS(k)), r => r.fut && r.fut[k] != null ? r.fut[k] : null]),
  ];

  function box(r, t, ctx) {
    const esc = ctx.esc, tab = tabOf[r.id] || 'news';
    const head = `<div class="ro-tabs" role="tablist">${TABS.map(([k, l]) => `<button type="button" role="tab" data-ro-tab="${r.id}|${k}" aria-selected="${k === tab}">${l}</button>`).join('')}</div>`;
    const wait = '<p class="ro-wait">Loading from ESPN…</p>', fail = '<p class="ro-wait">ESPN didn’t answer. Try again in a minute.</p>', noid = '<p class="ro-wait">No ESPN id for this player yet.</p>';
    const fpts = w => r.wks[String(w)];
    let body = '';
    if (r.pos === 'DEF' && (tab === 'news' || tab === 'log')) body = '<p class="ro-wait">Team defenses don’t have player news or a game log. See Schedule.</p>';
    else if (tab === 'news') {
      const j = r.espn && espn('n' + r.espn, `https://site.api.espn.com/apis/fantasy/v2/games/ffl/news/players?playerId=${r.espn}&limit=12`);
      body = !r.espn ? noid : !j ? wait : j.failed ? fail : !(j.feed || []).length ? '<p class="ro-wait">No recent news.</p>'
        : (() => { // RotoWire blurbs first; ESPN articles show just their summary, never the article body
            const strip = x => String(x || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
            const rw = j.feed.filter(n => n.type === 'Rotowire'), list = (rw.length ? rw : j.feed).slice(0, 4);
            return list.map(n => { const rot = n.type === 'Rotowire', txt = strip(rot ? n.story : n.description);
              return `<div class="ro-nw"><b>${esc(strip(n.headline))}</b>${txt && txt !== strip(n.headline) ? `<p>${esc(txt)}</p>` : ''}<small>${rot ? 'RotoWire' : 'ESPN'} · ${when(n.published)}</small></div>`; }).join(''); })();
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
        body = !evs.length ? '<p class="ro-wait">No games yet this season.</p>' : `<div class="tbl-wrap"><table class="ro-bt"><thead><tr><th class="l">Wk</th><th class="l">Opp</th><th class="l">Result</th>${C.map(([c, l]) =>
          `<th>${c === 'rushing' && r.pos !== 'RB' ? 'Ru ' : c === 'receiving' && r.pos === 'RB' ? 'Re ' : ''}${l}</th>`).join('')}<th>FBP pts</th></tr></thead><tbody>
          ${evs.map(([id, e]) => { const fp = fpts(e.week);
            return `<tr><td class="l">${e.week || ''}</td><td class="l">${e.atVs || ''} ${esc((e.opponent || {}).abbreviation || '')}</td><td class="l">${esc(e.gameResult || '')} ${esc(e.score || '')}</td>${C.map(([c, l]) => `<td>${esc(String(pick(byEv[id], c, l) || ''))}</td>`).join('')}<td><b>${fp ? fp[0].toFixed(1) : '—'}</b>${fp ? `<small>${fp[1] ? 'started' : 'bench'}${fp[2] !== t.abbr ? ' · ' + esc(fp[2]) : ''}</small>` : ''}</td></tr>`; }).join('')}</tbody></table></div>
          <p class="ro-bnote">FBP points are league scoring, for weeks he was on an FBP roster.</p>`;
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
          out.push(`<tr class="${done ? 'pst' : ''}"><td class="l">${w}</td><td class="l">${me.homeAway === 'home' ? 'vs' : '@'} ${esc(op.team ? op.team.abbreviation : '')}</td><td class="l">${sc}</td><td>${done && fp ? fp[0].toFixed(1) : ''}</td></tr>`); }
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
        ${tile('Season', r.pts.toFixed(1), `${r.rk ? r.pos + r.rk + ' on FBP rosters' : '—'} · ${W.length ? (r.pts / W.length).toFixed(1) : '0.0'} a week`)}
        ${tile('Started for ' + esc(t.abbr), `${S.length} of ${mine.length}`, `${sp.toFixed(1)} pts started · ${t.pf ? (100 * sp / t.pf).toFixed(1) : 0}% of the team’s points`)}
        ${tile('Left on the bench', benched.toFixed(1), `points scored while not in ${esc(t.abbr)}’s lineup`)}
        ${tile('Best week', best ? best.pts.toFixed(1) : '—', best ? `week ${best.w}` : 'no games yet')}
        ${tile(`${bar}+ point weeks`, `${W.filter(x => x.pts >= bar).length} of ${W.length}`, `under ${Math.round(bar / 3)}: ${W.filter(x => x.pts < bar / 3).length}`)}
        ${tile('Rest of season', r.ecrPos ? r.pos + r.ecrPos : '—', `${r.ecr ? 'FantasyPros #' + r.ecr + ' overall · ' : ''}week ${R.projWeek} projection ${fx(r.proj, 1)}`)}
      </div>`;
    } else if (tab === 'sal') {
      const m = /(\d+)\/(\d+)/.exec(r.cy || ''), n = m ? +m[1] : 0, N = m ? (r.st === 'TAXI_SQUAD' && +m[2] === 5 && n === 1 ? 6 : +m[2]) : 0;
      const yrs = [[R.season, r.sal, n ? `Year ${n} of ${N}` : 'No contract year']].concat((r.fut || []).map((v, k) => [YEARS(k), v, `Year ${n + k + 1} · +$${STEP[N] ? STEP[N][n + k - 1] : ''}`]));
      const owed = yrs.reduce((s, y) => s + y[1], 0);
      body = `<div class="ro-yrs">${yrs.map(y => `<div><small>${y[0]}</small><b>$${y[1]}</b><span>${y[2]}</span></div>`).join('')}${N ? `<div class="fy"><small>${YEARS((r.fut || []).length)}</small><b>FA</b><span>back to the auction</span></div>` : ''}</div>
        <p class="ro-bnote">Acquired: <b>${esc(r.acq || '—')}</b>${r.newDeal ? ' (a new 3-year veteran deal)' : ''}. ${N === 6 ? 'Taxi rookie: a full first season on taxi earns the 6th year with salary frozen in year 2. ' : ''}${N ? `Owed ${$(owed)} through ${R.season + (r.fut || []).length}, escalators included.` : ''}</p>`;
    }
    return `<div class="ro-box">${head}<div class="ro-bb">${body}</div></div>`;
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
    return `<section class="card ro-card"><h2>Points by week</h2><p class="ro-why">Bars are ${esc(t.name)}’s score each week, dark for a win and light for a loss. The dots are the league average; the thin line behind each bar runs from that week’s lowest score to its highest.</p>
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
    </section>`;
  }

  function render(ctx, sub) {
    X = ctx; load();
    if (failed) return '<p class="error">Rosters didn’t load. Refresh the page to try again.</p>';
    if (!R) return '<p class="loading">Loading rosters…</p>';
    const esc = ctx.esc, tmx = f => ctx.teams[f] || {};
    const ids = Object.keys(R.teams).sort((a, b) => R.teams[a].name.localeCompare(R.teams[b].name));
    const pickd = (sub && R.teams[sub]) ? sub : (ctx.myTeam && R.teams[ctx.myTeam]) ? ctx.myTeam : ids[0];
    const t = R.teams[pickd]; t.abbr = tmx(pickd).abbr || '';
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
      const chip = r.st === 'TAXI_SQUAD' ? '<span class="ro-chip t">TAXI</span>' : r.st === 'INJURED_RESERVE' ? '<span class="ro-chip i">IR</span>' : '';
      const aw = (r.hon || []).map(h => `<span class="ro-chip ${h[1]}" title="${esc(h[2])}">${esc(h[0])}</span>`).join('');
      const img = r.espn ? `style="background-image:url(https://a.espncdn.com/i/headshots/nfl/players/full/${r.espn}.png)"` : '';
      const n = Object.keys(r.wks).length, isOpen = open.has(r.id);
      return `<tr class="ro-p${r.st === 'TAXI_SQUAD' ? ' tx' : r.st === 'INJURED_RESERVE' ? ' ir' : ''}${isOpen ? ' on' : ''}" data-ro-p="${r.id}" aria-expanded="${isOpen}">
        <td class="ro-ph"><span ${img}></span></td>
        <td class="l ro-nm"><b>${esc(r.name)}</b>${chip}${aw}<small>${r.pos} · ${esc(r.nfl || 'FA')}${r.age ? ' · ' + r.age : ''}</small></td>
        <td>${r.bye || '—'}</td><td class="ro-m">${r.ecrPos ? r.pos + r.ecrPos : '—'}</td><td>${fx(r.proj, 1)}</td>
        <td>${r.pts ? r.pts.toFixed(1) : '—'}</td><td>${n ? (r.pts / n).toFixed(1) : '—'}</td><td class="ro-m">${r.rk ? r.pos + r.rk : ''}</td>
        <td class="gap ro-s">${$(r.sal)}</td><td class="ro-m">${r.cy || '—'}</td>${yrs}</tr>
        ${isOpen ? `<tr class="ro-det"><td colspan="${NC}">${box(r, t, ctx)}</td></tr>` : ''}`;
    };
    const grp = (label, list) => list.length ? `<tr class="ro-grp"><td colspan="${NC}">${label} · ${list.length} · ${$(list.reduce((s, r) => s + r.sal, 0))}</td></tr>` + sorted(list).map(row).join('') : '';
    const head = C.map(([k, l]) => { const on = sort[0] === k;
      return `<th class="ro-sort${k === 'name' ? ' l' : ''}${k === 'sal' ? ' gap' : ''}" data-ro-sort="${k}" aria-sort="${on ? (sort[1] < 0 ? 'descending' : 'ascending') : 'none'}">${l}${on ? (sort[1] < 0 ? ' ▼' : ' ▲') : ''}</th>`; }).join('');
    const top = rows.slice().sort((a, b) => b.sal - a.sal)[0];
    const F = t.face, n = (t.weeks || []).length;
    const faceLine = F ? [`${F.seasons} season${F.seasons === 1 ? '' : 's'}${F.first ? ' since ' + F.first : ''}`, `${F.starts} starts`,
      ...Object.entries(F.honors || {}).map(([k, v]) => `${v > 1 ? v + '× ' : ''}${k}`), F.titles ? `${F.titles > 1 ? F.titles + '× ' : ''}champion` : ''].filter(Boolean).join(' · ') : '';
    return `<div class="ro-pick" role="tablist" aria-label="Teams">${ids.map(f => `<a href="#now/rosters/${f}" role="tab" aria-selected="${f === pickd}" title="${esc(R.teams[f].name)}">${lg(f)}<b>${esc(tmx(f).abbr || '')}</b></a>`).join('')}</div>
      <div class="ro-th" style="--tc:${tmx(pickd).primary || 'var(--line)'}">${lg(pickd, 'ro-tl')}<div><h2>${esc(t.name)}</h2><p>${esc(t.owner)} · ${t.rec[0]}-${t.rec[1]}${t.rec[2] ? '-' + t.rec[2] : ''} · ${t.pf.toFixed(1)} points</p></div></div>
      <div class="ro-tiles">
        <div class="ro-tile"><small>${R.season} payroll</small><b>${$(pay)}</b><span>${act.length} active · ${tx.length} taxi · ${ir.length} IR</span></div>
        <div class="ro-tile"><small>Vs. league average</small><b>${sg(n ? t.paa / n : 0)}</b><span>points a week · ${ord(t.paaRank)} of 12</span></div>
        <div class="ro-tile ro-face">${F ? `<span class="ro-fph" ${F.espn ? `style="background-image:url(https://a.espncdn.com/i/headshots/nfl/players/full/${F.espn}.png)"` : ''}></span><div><small>Face of the Franchise</small><b>${esc(F.name)}</b><span>${esc(F.pos)} · ${esc(faceLine)}</span></div>` : '<div><small>Face of the Franchise</small><b>—</b></div>'}</div>
        <div class="ro-tile"><small>Top contract</small><b>${top ? $(top.sal) : '—'}</b><span>${top ? esc(top.name) : ''}</span></div>
      </div>
      ${weekly(t, esc, tmx)}
      <section class="card ro-card"><h2>Roster</h2><p class="ro-why">Tap a column to sort; players stay grouped by position. Tap a player to open his news, game log, schedule, analytics and salary. Slide the table for future salaries.</p>
        <div class="tbl-wrap ro-wrap"><table class="ro-t"><thead><tr><th class="ro-ph"></th>${head}</tr></thead>
        <tbody>${POS.map(p => grp(GRP[p], act.filter(r => r.pos === p))).join('')}${grp('Taxi squad', tx)}${grp('Injured reserve', ir)}</tbody>
        <tfoot><tr><td class="ro-ph"></td><td class="l">Total</td><td></td><td></td><td></td><td>${rows.reduce((s, r) => s + r.pts, 0).toFixed(1)}</td><td></td><td></td><td class="gap">${$(pay)}</td><td></td>${[0, 1, 2, 3, 4].map(k => `<td>${yr(k) ? $(yr(k)) : ''}</td>`).join('')}</tr></tfoot></table></div>
        <p class="ro-why ro-fn">ECR is FantasyPros’ rest-of-season consensus rank at the position${R.ecrUpdated ? ` (as of ${new Date(R.ecrUpdated + 'T12:00:00').toLocaleDateString([], { month: 'short', day: 'numeric' })})` : ''}. Week ${R.projWeek} projections are MFL’s. Points and rank count this season’s weeks on an FBP roster. Future salaries use the by-law escalators; a player picked up off waivers or as a free agent this season is on a new 3-year veteran deal, and a rookie on taxi is shown on the 6-year path.</p></section>
      <p class="rf-foot">Through week ${R.through}. Face of the Franchise: the current player with the most history on this team, counting starts, seasons, All-FBP teams, MVPs, Rookie of the Year and championships, across every stint.</p>`;
  }

  document.addEventListener('click', e => {
    const t = e.target.closest ? e.target : null; if (!t || !document.querySelector('.ro-t, .ro-pick')) return;
    const tb = t.closest('[data-ro-tab]'); if (tb) { const [id, k] = tb.dataset.roTab.split('|'); tabOf[id] = k; return redraw(); }
    if (t.closest('.ro-box')) return;
    const h = t.closest('[data-ro-sort]'); if (h) { const k = h.dataset.roSort; sort = sort[0] === k ? [k, -sort[1]] : [k, k === 'name' ? 1 : -1]; return redraw(); }
    const p = t.closest('[data-ro-p]'); if (p) { const id = p.dataset.roP; open.has(id) ? open.delete(id) : open.add(id); return redraw(); }
  });
  return { render };
})();
