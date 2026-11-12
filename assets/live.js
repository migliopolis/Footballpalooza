/* Scoreboard tab: this week's six games, live, plus any earlier week (week picker; defaults to the current week).
   Each game is one line (logo, score, vs, score, logo) that opens into both lineups, slot by slot.
   Data is MFL's liveScoring export. Browsers can't read MFL directly from this site, so it comes through a small
   Cloudflare Worker relay (LIVE_URL, code in relay/worker.js). With LIVE_URL empty the page shows a saved sample
   (data/live-sample.json).
   Player names, positions and NFL teams come from data/mfl/players.json. Stat lines, kickoff times and game clocks
   come from ESPN's public scoreboard and box scores (readable straight from the browser), matched by ESPN id
   (data/player-links.json), and so do injury designations (live, with data/espn/injuries.json as a fallback).
   Taxi squad and IR come from the weekly roster file (data/mfl/rosters.json); MFL's live scoring leaves them out.
   Polling: every 15 seconds while NFL games are on, every 5 minutes before kickoff, and not at all once the weekly
   league update has the week in the books. Earlier weeks come from the weekly results file (data/mfl/weeklyResults.json,
   final lineups and points) with ESPN's box scores for that week; they never refresh. */
(function () {
  const LIVE_URL = 'https://fbp-live.pmiglio-gchat.workers.dev/';   // Cloudflare Worker relay (relay/worker.js)
  const POLL_MS = 15000;
  const SLOTS = ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'DEF'];
  const SLOW_MS = 300000;
  let X = null, data = null, players = null, rosters = null, failed = false, loading = false, timer = null, stamp = null;
  let view = null;                  // the week being shown; null = MFL's current week (live)
  const hist = {};                  // earlier weeks, built from the weekly results file
  let weekly = null, sched = null;
  const open = new Set(), openBench = new Set();
  // this season's award holders, as chips by a name (data/awards.json, built by scripts/awards.py):
  // p: player id -> chips, t: franchise id -> chips, potw: week -> player of the week
  let honors = null;
  // MFL's projected points for each week, scored with FBP's settings (data/mfl/projections.json, saved daily)
  let proj = null;
  const projOf = (id, wk) => { const w = proj && proj[String(wk)]; return w && w[id] != null ? w[id] : null; };   // null: no projection
  // how a player is doing, shown on his photo. Top down: nuclear (over his position's line), hot (well ahead of his
  // projection), normal, cold (well behind it), bust (a big projection that collapsed), blank (0 points past halftime).
  // Only players whose NFL game has kicked off; byes and players yet to play stay normal.
  const NUKE = { QB: 35, RB: 30, WR: 30, TE: 25, DEF: 25 };
  // a player's photo with his tier on it (used by the Scoreboard and Players)
  // All-FBP 1st or 2nd Team this season: a gold or silver photo (FBP.medal styles, site.css)
  const medal = id => { const L = (honors && honors.p[id]) || []; return L.some(c => c.l === '1st Team') ? ' m-gold' : L.some(c => c.l === '2nd Team') ? ' m-silver' : ''; };
  function photoHtml(p, wk) {
    const tr = tier(p, wk), ph = photo(p.id), out = dnp(p);
    // inactive: the photo goes grey with a red DNP rubber stamp across it
    const extra = out ? '<i class="dnp-st">DNP</i>' : tr && tr.k === 'bust' ? '<i class="ice"></i><i class="xt a">❄</i><i class="xt b">❄</i><i class="xt c">✦</i>' : '';
    return `<span class="lv-ph${pos(p.id) === 'DEF' ? ' def' : ''}${medal(p.id)}${tr ? ' t-' + tr.k : ''}${out ? ' t-dnp' : ''}"${out ? ' title="Inactive: didn’t play"' : tr ? ` title="${tr.title}"` : ''}>${ph && !(tr && tr.k === 'blank') ? `<img src="${ph}" alt="" loading="lazy" onerror="this.remove()">` : ''}${extra}</span>`;
  }
  // a player who sat out: ESPN's game-day roster has him inactive (IR, a healthy scratch, ruled out) and he has no points.
  // A player who suited up and scored 0 still counts as having played.
  const dnp = p => { if (pos(p.id) === 'DEF' || +p.score) return false; const g = gameOf(p.id), e = espnId(p.id), S = EW().stats;
    return !!(g && e && S['ro' + g.id] && S['out:' + e]); };
  function tier(p, wk) {
    const g = gameOf(p.id), st = state(p);
    if (dnp(p)) return null;
    if (!(g ? g.state !== 'pre' : st === 'live') || p.score == null || p.score === '') return null;
    const sc = +p.score || 0, pj = projOf(p.id, wk) || 0, fin = g ? g.state === 'post' : st === 'final';
    const secs = +p.gameSecondsRemaining || 0, done = fin ? 1 : Math.max(0, Math.min(1, 1 - secs / 3600));
    const pastHalf = fin || done >= 0.5 || (g && /half/i.test(g.detail || '')), pace = done > 0 ? sc / done : 0;
    const line = NUKE[pos(p.id)];
    if (line && sc >= line) return { k: 'nuke', title: `Nuclear: ${n1(sc)} points, over the ${line}-point line for a ${pos(p.id)}` };
    // after the game, Hot marks a big game short of Nuclear: beat the projection by 5+ and reached 60% of the
    // position's Nuclear line (QB 21, RB/WR 18, TE/DEF 15)
    if (pj > 0 && (fin ? sc >= pj + 5 && sc >= (line || 25) * 0.6 : sc >= 10 && ((done >= 0.25 && pace >= pj * 1.5) || sc >= pj)))
      return { k: 'hot', title: `Hot: ${n1(sc)} points against a ${n1(pj)} projection` };
    if (sc === 0 && pastHalf) return { k: 'blank', title: fin ? 'No points this week' : 'No points through halftime' };
    if (fin && (sc < 0 || (pj >= 12 && sc <= pj * 0.25))) return { k: 'bust', title: `Bust: ${n1(sc)} points${pj ? ` against a ${n1(pj)} projection` : ''}` };
    if (pj >= 8 && pastHalf && (fin ? sc <= pj * 0.5 : pace <= pj * 0.5)) return { k: 'cold', title: `Cold: ${n1(sc)} points against a ${n1(pj)} projection` };
    return null;
  }
  // a lineup's projected total: final players count what they scored, players yet to play their projection,
  // players in a game what they have plus their projection for the time left
  const projTotal = (f, wk) => { if (!proj || !proj[String(wk)]) return null;
    return (f.players.player || []).filter(p => p.status === 'starter').reduce((t, p) => {
      const pj = projOf(p.id, wk), st = state(p), sc = +p.score || 0;
      return t + (st === 'pre' ? (pj || 0) : st === 'live' ? sc + (pj || 0) * Math.min(1, (+p.gameSecondsRemaining || 0) / 3600) : sc);
    }, 0); };
  const P_AWARDS = { mvp: ['MVP', 'gold'], rookie: ['RoY', 'good'], value: ['Best Value', 'good'], waiver: ['Top Waiver', 'good'],
    high: ['High Game', 'good'], bench: ['Bench Points', 'meh'], contract: ['Worst Contract', 'meh'] };
  const T_AWARDS = { manager: ['Top Manager', 'good'], lucky: ['Luckiest', 'meh'], unlucky: ['Unluckiest', 'meh'] };
  function readHonors(j) {
    const h = { p: {}, t: {}, potw: {} }, add = (m, id, c) => { if (id) (m[id] = m[id] || []).push(c); };
    const af = (j && j.allFbp) || {};
    [['first', '1st Team', 'gold'], ['second', '2nd Team', 'silver']].forEach(([k, l, c]) =>
      (af[k] || []).forEach(x => x.player && add(h.p, x.player.id, { l, c, title: `All-FBP ${l}` })));
    ((j && j.awards) || []).forEach(a => {
      if (P_AWARDS[a.key] && (a.list || [])[0]) add(h.p, a.list[0].id, { l: P_AWARDS[a.key][0], c: P_AWARDS[a.key][1], title: `${a.title}: ${a.why}` });
      if (T_AWARDS[a.key] && (a.teams || [])[0]) add(h.t, a.teams[0].team, { l: T_AWARDS[a.key][0], c: T_AWARDS[a.key][1], title: `${a.title}: ${a.teams[0].stat} · ${a.teams[0].sub}` });
      // Trade of the Year: the top producer this season on the winning side, while he's still on that team
      if (a.key === 'trade' && a.trade && a.trade.winner) {
        const W = a.trade.winner, cur = (W.later || {}).current, rows = ((W.later || {}).rows || []).map(r => ({ id: r.id, pts: (r.pts || {})[cur] || 0 }));
        const top = (rows.length ? rows : (W.players || []).map(x => ({ id: x.id, pts: x.pts || 0 }))).sort((x, y) => y.pts - x.pts)[0];
        if (top && top.pts > 0) add(h.p, top.id, { l: 'ToY', c: 'good', team: W.team, title: `Trade of the Year: ${a.why}` });
      }
      if (a.key === 'week') Object.entries(a.weeks || {}).forEach(([w, L]) => { if (L && L[0]) h.potw[w] = L[0].id; });
    });
    h.thru = j && j.throughWeek; h.season = j && j.season; h.final = !!(j && j.final);
    honors = h;
  }
  // award chips carry a short label too, for the compact view (1st Team → 1st)
  const CHIP_SHORT = { '1st Team': '1st', '2nd Team': '2nd', 'Top Waiver': 'Waiver', 'High Game': 'High', 'Worst Contract': 'Worst $', 'Best Value': 'Value', 'Bench Points': 'Bench' };
  const chips = list => (list || []).map(c => `<span class="lv-af ${c.c}" title="${c.title.replace(/"/g, '&quot;')}"><span class="cf">${c.l}</span><span class="cs">${CHIP_SHORT[c.l] || c.l}</span></span>`).join('');
  // compact view: a whole matchup on one phone screen (photo, name, short chip and points only), saved on this device
  let compact = false; try { compact = localStorage.getItem('fbp-sb-compact') === '1'; } catch (e) {}
  // compact view: just the All-FBP team chip (1st / 2nd), shown beside the photo
  const teamChip = (id, fid) => !honors ? '' : (honors.p[id] || []).filter(c => (!c.team || c.team === fid) && /^(1st|2nd) Team$/.test(c.l))
    .map(c => `<span class="lv-af lv-pchip ${c.c}" title="${c.title.replace(/"/g, '&quot;')}">${CHIP_SHORT[c.l]}</span>`).join('');
  const playerChips = (id, wk, fid) => !honors ? '' : chips((honors.p[id] || []).filter(c => !c.team || c.team === fid).concat(honors.potw[wk] === id ? [{ l: 'POTW', c: 'good', title: `Player of the Week, week ${wk}` }] : []));

  const onPage = () => /^#scores(\/players)?\/?$/.test(location.hash);   // the Scoreboard and Players, not the Ticket Helper or NFL
  const n1 = v => (Math.round(v * 10) / 10).toFixed(1);
  // the week to show live: the one after the last week the league update has counted. MFL's own current week can lag
  // a day behind (it still said week 9 on Monday night after week 9 was final), so ask for the next week by number.
  let askedW = -1;
  const nextW = () => X && X.weeksPlayed && X.weeksPlayed < 17 ? X.weeksPlayed + 1 : 0;
  function load() {
    if (loading) return;
    loading = true;
    const nw = nextW(); askedW = nw;
    const src = LIVE_URL ? LIVE_URL + (nw ? `?w=${nw}` : '') : 'data/live-sample.json';
    Promise.all([
      fetch(src, { cache: 'no-cache' }).then(r => r.ok ? r.json() : null),
      players ? Promise.resolve(players) : fetch('data/mfl/players.json').then(r => r.ok ? r.json() : null),
      loadEspn(),
      rosters ? Promise.resolve() : fetch('data/mfl/rosters.json').then(r => r.ok ? r.json() : null).then(j => {
        rosters = {};
        (((j || {}).rosters || {}).franchise || []).forEach(f => { rosters[f.id] = { taxi: [], ir: [] };
          (f.player || []).forEach(pl => { if (pl.status === 'TAXI_SQUAD') rosters[f.id].taxi.push(pl.id); else if (pl.status === 'INJURED_RESERVE') rosters[f.id].ir.push(pl.id); }); });
      }).catch(() => { rosters = {}; }),
      loadInjuries(),
      proj ? Promise.resolve() : fetch('data/mfl/projections.json', { cache: 'no-cache' }).then(r => r.ok ? r.json() : {}).then(j => { proj = (j && j.players) || {}; }).catch(() => { proj = {}; }),
      honors ? Promise.resolve() : fetch('data/awards.json', { cache: 'no-cache' }).then(r => r.ok ? r.json() : null).then(readHonors).catch(() => { honors = { p: {}, t: {}, potw: {} }; }),
    ]).then(([d, p]) => {
      loading = false;
      if (!d || !d.liveScoring) { failed = !data; return; }
      data = d; stamp = new Date();
      if (p && !players) players = p.fields ? Object.fromEntries(Object.entries(p.players).map(([k, v]) => [k, Object.fromEntries(p.fields.map((f, i) => [f, v[i]]))])) : p;
      paint();
    }).catch(() => { loading = false; failed = !data; paint(); });
  }
  // ESPN: kickoff times and clocks by NFL team, stat lines by ESPN athlete id
  const ESPN = 'https://site.api.espn.com/apis/site/v2/sports/football/nfl/';
  const TEAM = { GBP: 'GB', KCC: 'KC', NEP: 'NE', NOS: 'NO', SFO: 'SF', TBB: 'TB', LVR: 'LV', JAC: 'JAX', WAS: 'WSH', LA: 'LAR' };
  // per week: 'live' for the current week, else the week number
  const E = {}, EW = () => E[view || 'live'] || { games: {}, stats: {} };
  let links = null;
  function loadEspn(w) {
    const e = (E[w || 'live'] = E[w || 'live'] || { games: {}, stats: {}, at: 0 });
    if (w ? e.at : Date.now() - e.at < POLL_MS - 1000) return Promise.resolve();   // an earlier week loads once
    e.at = Date.now();
    const games = e.games, stats = e.stats;
    const lk = links ? Promise.resolve(links) : fetch('data/player-links.json').then(r => r.ok ? r.json() : null).then(j => (links = (j && j.links) || {}));
    const lw = w || (data ? +data.liveScoring.week : nextW());
    const url = lw ? `scoreboard?seasontype=2&week=${lw}&dates=${(X && X.season) || new Date().getFullYear()}` : 'scoreboard';
    return Promise.all([lk, fetch(ESPN + url).then(r => r.ok ? r.json() : null)]).then(([, sb]) => {
      if (!sb) return;
      const g = games;
      (sb.events || []).forEach(ev => {
        const st = ev.status || {}, t = st.type || {};
        const info = { id: ev.id, state: t.state, date: ev.date, detail: t.shortDetail, clock: st.displayClock, period: st.period, name: ev.shortName };
        const cs = ev.competitions[0].competitors;
        info.tids = cs.map(c => c.team.id);
        // weather (ESPN gives it before kickoff; indoor games say so), and who has the ball / red zone while live
        const comp = ev.competitions[0], wx = ev.weather || comp.weather || null, sit = comp.situation || {};
        info.wx = comp.venue && comp.venue.indoor ? { indoor: true } : wx ? { text: wx.displayValue || wx.conditionId || '', temp: wx.temperature != null ? wx.temperature : wx.highTemperature } : null;
        cs.forEach(c => { const o = cs.find(x => x !== c) || {};
          const hasBall = t.state === 'in' && sit.possession && String(sit.possession) === String(c.team.id);
          const oppBall = t.state === 'in' && sit.possession && String(sit.possession) === String((o.team || {}).id);
          g[c.team.abbreviation] = Object.assign({}, info, { pf: c.score, pa: o.score, opp: (o.team || {}).abbreviation, home: c.homeAway === 'home',
            ball: !!hasBall, rz: !!(sit.isRedZone && hasBall), defRz: !!(sit.isRedZone && oppBall) }); });
      });
      // box scores only for games that have started; finished ones only once
      // game-day rosters, once a game has kicked off (inactives are set before kickoff): who was ruled out
      const ros = [...new Map(Object.values(g).filter(x => x.state !== 'pre' && !stats['ro' + x.id]).map(x => [x.id, x])).values()];
      const core = 'https://sports.core.api.espn.com/v2/sports/football/leagues/nfl/events/';
      const rosters = Promise.all(ros.map(x => Promise.all((x.tids || []).map(t => fetch(`${core}${x.id}/competitions/${x.id}/competitors/${t}/roster?limit=200`)
        .then(r => r.ok ? r.json() : Promise.reject()))).then(rs => {
          rs.forEach(r => (r.entries || []).forEach(a => { if (a.valid === false || a.didNotPlay) stats['out:' + a.playerId] = 1; }));
          stats['ro' + x.id] = 1;
        }).catch(() => null)));
      const want = [...new Set(Object.values(g).filter(x => x.state === 'in' || (x.state === 'post' && !stats['ev' + x.id])).map(x => x.id))];
      return Promise.all(want.map(id => fetch(ESPN + 'summary?event=' + id).then(r => r.ok ? r.json() : null).then(j => {
        if (!j || !j.boxscore) return;
        stats['ev' + id] = 1;
        // a defense's day comes from the other team's numbers: sacks taken, interceptions thrown, fumbles lost
        const T = (j.boxscore.teams || []).map(t => ({ ab: t.team.abbreviation, v: Object.fromEntries((t.statistics || []).reverse().map(x => [x.name, x.displayValue])) }));
        T.forEach((t, i) => { const o = T[1 - i]; if (!o) return;
          stats['def:' + t.ab] = { sk: +String(o.v.sacksYardsLost || '0').split('-')[0] || 0, int: +o.v.interceptions || 0, fr: +o.v.fumblesLost || 0, td: +t.v.defensiveTouchdowns || 0, ya: +o.v.totalYards || 0 }; });
        (j.boxscore.players || []).forEach(tm => (tm.statistics || []).forEach(cat => (cat.athletes || []).forEach(a => {
          const row = (stats[a.athlete.id] = stats[a.athlete.id] || {});
          row[cat.name] = Object.fromEntries((cat.labels || []).map((l, i) => [l, a.stats[i]]));
        })));
      }).catch(() => null)).concat(rosters));
    }).catch(() => null);
  }
  // injury designations by ESPN id: live from ESPN, refreshed every 10 minutes; the saved weekly file if that fails
  let injuries = null, injAt = 0;
  const INJ = { 'Questionable': 'Q', 'Doubtful': 'D', 'Out': 'O', 'Injured Reserve': 'IR', 'Suspension': 'SUS', 'Day-To-Day': 'DTD', 'Physically Unable to Perform': 'PUP' };
  function loadInjuries() {
    if (injuries && Date.now() - injAt < 600000) return Promise.resolve();
    injAt = Date.now();
    return fetch(ESPN + 'injuries').then(r => r.ok ? r.json() : Promise.reject()).then(j => {
      const out = {};
      (j.injuries || []).forEach(t => (t.injuries || []).forEach(i => {
        const a = i.athlete || {}; let id = a.id;
        if (!id) (a.links || []).some(l => { const m = /\/id\/(\d+)/.exec(l.href || ''); if (m) id = m[1]; return !!m; });
        if (id) out[id] = { status: i.status, note: i.shortComment || '' };
      }));
      injuries = out;
      // fill in long-term injuries ESPN's live report leaves out, from the daily snapshot
      return fetch('data/espn/injuries.json').then(r => r.ok ? r.json() : {}).then(s => { Object.entries(s || {}).forEach(([k, v]) => { if (v && v.status && !out[k]) out[k] = { status: v.status, note: v.short || '' }; }); }).catch(() => {});
    }).catch(() => fetch('data/espn/injuries.json').then(r => r.ok ? r.json() : {}).then(j => {
      injuries = Object.fromEntries(Object.entries(j || {}).map(([k, v]) => [k, { status: v.status, note: v.short || '' }]));
    })).catch(() => { injuries = injuries || {}; });
  }
  const injTag = id => { if (view) return null; const i = injuries && injuries[espnId(id)]; const t = i && INJ[i.status]; return t ? { t, title: `${i.status}${i.note ? ': ' + i.note : ''}` } : null; };
  const espnId = id => ((links && links[id]) || [])[0];
  const photo = id => {
    if (pos(id) === 'DEF') { const t = TEAM[info(id).team] || info(id).team || ''; return t ? `https://a.espncdn.com/i/teamlogos/nfl/500/${t.toLowerCase()}.png` : ''; }
    return espnId(id) ? `https://a.espncdn.com/i/headshots/nfl/players/full/${espnId(id)}.png` : '';
  };
  // NFL logos (ESPN), and a weather icon for a game
  const esc = s => (X && X.esc ? X.esc(s) : String(s == null ? '' : s));
  const nflImg = (ab, label) => ab ? `<img class="lv-nfl" src="https://a.espncdn.com/i/teamlogos/nfl/500/${String(ab).toLowerCase()}.png" alt="${esc(label || ab)}" title="${esc(label || ab)}">` : '';
  const wxIcon = w => { if (!w) return '';
    if (w.indoor) return '<span class="lv-wx" title="Indoors">🏟️</span>';
    const t = String(w.text || '').toLowerCase(), deg = w.temp != null ? ` · ${Math.round(w.temp)}°` : '';
    const e = /snow|flurr|sleet/.test(t) ? '🌨️' : /thunder|storm/.test(t) ? '⛈️' : /rain|shower|drizzle/.test(t) ? '🌧️' : /fog|haze|mist/.test(t) ? '🌫️'
      : /wind/.test(t) ? '💨' : /partly|mostly sunny|few clouds|intermittent/.test(t) ? '⛅' : /cloud|overcast/.test(t) ? '☁️' : /sun|clear|fair/.test(t) ? '☀️' : '🌡️';
    return `<span class="lv-wx" title="${esc((w.text || 'Weather') + deg)}">${e}</span>`; };
  // your own game order: press and hold a game, then drag it. Saved on this device as a list of franchises, so it
  // carries over to other weeks (a game sorts by whichever of its two teams sits higher on the list).
  let sbOrder = []; try { sbOrder = JSON.parse(localStorage.getItem('fbp-sb-order') || '[]'); } catch (e) {}
  const ordered = ms => { if (!sbOrder.length) return ms;
    const rk = f => { const i = sbOrder.indexOf(f); return i < 0 ? 999 : i; };
    return ms.map((m, i) => [m, i]).sort((x, y) => (Math.min(...x[0].franchise.map(f => rk(f.id))) - Math.min(...y[0].franchise.map(f => rk(f.id)))) || x[1] - y[1]).map(x => x[0]); };
  (function dragGames() {
    let hold = null, drag = null, sx = 0, sy = 0, swallow = false;
    const pt = e => e.touches ? e.touches[0] : e;
    const start = e => {
      const sum = e.target.closest && e.target.closest('.lv-sum'); if (!sum || (e.button != null && e.button !== 0)) return;
      const card = sum.closest('.lv-g'), list = card && card.parentElement; if (!list || !list.classList.contains('lv-list')) return;
      const p = pt(e); sx = p.clientX; sy = p.clientY;
      hold = setTimeout(() => { hold = null;
        drag = { card, list, y0: p.clientY, off0: card.offsetTop };
        card.classList.add('lv-lift'); list.classList.add('lv-dragging');
        if (navigator.vibrate) try { navigator.vibrate(12); } catch (err) {} }, 420);
    };
    const move = e => {
      const p = pt(e);
      if (hold && (Math.abs(p.clientX - sx) > 8 || Math.abs(p.clientY - sy) > 8)) { clearTimeout(hold); hold = null; }
      if (!drag) return;
      if (e.cancelable) e.preventDefault();   // dragging, not scrolling
      const { card, list } = drag;
      // move past a neighbor's midpoint and it trades places
      const sibs = [...list.children].filter(c => c !== card);
      const before = sibs.find(c => { const r = c.getBoundingClientRect(); return p.clientY < r.top + r.height / 2; });
      if (before !== card.nextElementSibling) list.insertBefore(card, before || null);
      // stay under the finger: how far it's been dragged, less how far its slot in the list has moved
      card.style.transform = `translateY(${p.clientY - drag.y0 - (card.offsetTop - drag.off0)}px)`;
      // keep the page scrolling when you drag near the edges
      if (p.clientY < 90) window.scrollBy(0, -12); else if (p.clientY > window.innerHeight - 60) window.scrollBy(0, 12);
    };
    const end = () => {
      if (hold) { clearTimeout(hold); hold = null; }
      if (!drag) return;
      const { card, list } = drag; drag = null; swallow = true;
      card.style.transform = ''; card.classList.remove('lv-lift'); list.classList.remove('lv-dragging');
      sbOrder = [...list.querySelectorAll('.lv-g')].flatMap(c => (c.dataset.lvKey || '').split('-'));
      try { localStorage.setItem('fbp-sb-order', JSON.stringify(sbOrder)); } catch (err) {}
      setTimeout(() => { swallow = false; }, 350);
    };
    document.addEventListener('touchstart', start, { passive: true });
    document.addEventListener('touchmove', move, { passive: false });
    document.addEventListener('touchend', end); document.addEventListener('touchcancel', end);
    document.addEventListener('mousedown', start); document.addEventListener('mousemove', move); document.addEventListener('mouseup', end);
    document.addEventListener('click', e => { if (swallow && e.target.closest && e.target.closest('.lv-g')) { e.stopPropagation(); e.preventDefault(); } }, true);
    document.addEventListener('contextmenu', e => { if (drag || hold) e.preventDefault(); });
  })();
  const gameOf = id => EW().games[TEAM[info(id).team] || info(id).team];
  // the stat line: passing, rushing, receiving, whatever he did
  // keeps a stat together ("16 car") but lets it wrap after a comma
  const keep = x => x.replace(/(,?) /g, (m, c) => c ? ', ' : '\u00a0');
  function statLine(id) {
    if (pos(id) === 'DEF') {   // points allowed, sacks, takeaways, defensive scores
      const ab = TEAM[info(id).team] || info(id).team, d = EW().stats['def:' + ab], gm = gameOf(id);
      if (!d || !gm || gm.state === 'pre') return '';
      const pl = (k, one, many) => `${k} ${k === 1 ? one : many}`;
      return [`${gm.pa != null ? gm.pa : '?'} pts allowed`, d.sk && pl(d.sk, 'sack', 'sacks'), d.int && pl(d.int, 'INT', 'INT'), d.fr && pl(d.fr, 'fum rec', 'fum rec'), d.td && pl(d.td, 'TD', 'TD')].filter(Boolean).map(keep).join('\u00a0· ');
    }
    const r = EW().stats[espnId(id)]; if (!r) return '';
    const n = v => +String(v || 0).split('/')[0] || 0, out = [];
    const ps = r.passing, ru = r.rushing, re = r.receiving, k = r.kicking;
    if (ps) out.push(`${ps['C/ATT']}, ${ps.YDS} yds${n(ps.TD) ? `, ${ps.TD} TD` : ''}${n(ps.INT) ? `, ${ps.INT} INT` : ''}`);
    const rush = ru && (n(ru.CAR) || n(ru.YDS)) ? `${ru.CAR} car, ${ru.YDS} yds${n(ru.TD) ? `, ${ru.TD} TD` : ''}` : '';
    const rec = re && (n(re.REC) || n(re.TGTS)) ? `${re.REC} rec${re.TGTS ? ` (${re.TGTS} tgt)` : ''}, ${re.YDS} yds${n(re.TD) ? `, ${re.TD} TD` : ''}` : '';
    if (pos(id) === 'WR' || pos(id) === 'TE') { if (rec) out.push(rec); if (rush) out.push(rush); } else { if (rush) out.push(rush); if (rec) out.push(rec); }
    if (k) out.push(`FG ${k.FG}, XP ${k.XP}`);
    const fl = r.fumbles && n(r.fumbles.LOST);
    if (fl) out.push(`${fl} fum lost`);
    return out.map(keep).join('\u00a0· ');   // a line break never starts with a dot, or splits "4 sacks"
  }
  // a live estimate of FBP points from ESPN's box score, for players MFL's live feed doesn't cover (free agents, taxi
  // squad, IR): MFL only posts their points once a game is final. FBP scoring (MFL rules for league 14482):
  // pass yd .04, pass TD 4, INT -2; rush/rec yd .1, rush/rec TD 6, reception 1; return yd .05, return TD 6; fumble lost -2.
  // Defense: points allowed (0 → 5 … 36+ → 0) plus yards allowed (under 200 → 5 … 500+ → 0), sack 1, INT 2, fumble
  // recovery 1, TD 6. Two-point conversions, forced fumbles, blocks and safeties aren't in the box score, so they're missed.
  function estimate(id) {
    const n = v => +String(v || 0).split('/')[0] || 0;
    if (pos(id) === 'DEF') {
      const ab = TEAM[info(id).team] || info(id).team, d = EW().stats['def:' + ab], gm = gameOf(id);
      if (!d || !gm || gm.state === 'pre' || gm.pa == null) return null;
      const pa = +gm.pa, ya = d.ya;
      const paP = pa <= 5 ? 5 : pa <= 10 ? 4 : pa <= 20 ? 3 : pa <= 29 ? 2 : pa <= 35 ? 1 : 0;
      const yaP = ya < 200 ? 5 : ya < 300 ? 4 : ya < 400 ? 3 : ya < 450 ? 2 : ya < 500 ? 1 : 0;
      return paP + yaP + d.sk + 2 * d.int + d.fr + 6 * d.td;
    }
    const r = EW().stats[espnId(id)]; if (!r) return null;
    const ps = r.passing || {}, ru = r.rushing || {}, re = r.receiving || {}, kr = r.kickReturns || {}, pr = r.puntReturns || {}, fu = r.fumbles || {};
    const v = .04 * n(ps.YDS) + 4 * n(ps.TD) - 2 * n(ps.INT) + .1 * n(ru.YDS) + 6 * n(ru.TD) + .1 * n(re.YDS) + 6 * n(re.TD) + n(re.REC)
      + .05 * (n(kr.YDS) + n(pr.YDS)) + 6 * (n(kr.TD) + n(pr.TD)) - 2 * n(fu.LOST);
    return Math.round(v * 100) / 100;
  }
  // an earlier week, shaped like MFL's live scoring: final lineups and points from the weekly results file
  function loadHist(w) {
    const need = [];
    if (!weekly) need.push(fetch('data/mfl/weeklyResults.json').then(r => r.ok ? r.json() : {}).then(j => { weekly = j.weeks || {}; }));
    if (!sched) need.push(fetch('data/mfl/schedule.json').then(r => r.ok ? r.json() : {}).then(j => { sched = ((j.schedule || {}).weeklySchedule) || []; }));
    return Promise.all([...need, loadEspn(w)]).then(() => {
      const wr = weekly[String(w)] || {}, wk = sched.find(x => +x.week === +w);
      const fr = f => { const t = wr[f.id] || {}, s = t.s || [], n = t.n || [];
        return { id: f.id, isHome: f.isHome, score: String(s.reduce((a, x) => a + x[1], 0)), gameSecondsRemaining: '0', playersYetToPlay: '0', playersCurrentlyPlaying: '0',
                 players: { player: [...s.map(([id, v]) => ({ id, status: 'starter', score: String(v), gameSecondsRemaining: '0' })), ...n.map(([id, v]) => ({ id, status: 'nonstarter', score: String(v), gameSecondsRemaining: '0' }))] } }; };
      hist[w] = { liveScoring: { week: String(w), matchup: ((wk || {}).matchup || []).map(m => ({ franchise: m.franchise.map(fr) })) } };
    });
  }
  const cur = () => view ? hist[view] : data;
  function showWeek(w) {
    const live = data ? +data.liveScoring.week : 0;
    view = !w || +w === live ? null : +w;
    open.clear(); openBench.clear();
    if (view && !hist[view]) { paint(); loadHist(view).then(paint).catch(paint); } else paint();
  }
  // the week is in the books once the weekly league update has counted it
  const weekDone = () => !!(data && X && +data.liveScoring.week <= (X.weeksPlayed || 0));
  // fast while any NFL game is on (or about to start), slow before kickoff, stopped once the week is final
  function pace() {
    if (view || weekDone()) return 0;
    const gs = Object.values((E.live || {}).games || {});
    if (!gs.length || gs.some(g => g.state === 'in')) return POLL_MS;
    const next = Math.min(...gs.filter(g => g.state === 'pre').map(g => Date.parse(g.date)));
    return isFinite(next) && next - Date.now() < 20 * 60000 ? POLL_MS : SLOW_MS;
  }
  function poll() {
    clearTimeout(timer);
    if (!LIVE_URL) return;
    const ms = data ? pace() : POLL_MS;
    if (!ms) return;
    timer = setTimeout(() => { if (onPage() && !document.hidden) load(); poll(); }, ms);
  }
  // redraw just the scoreboard (keeps scroll position and which games are open)
  function paint() {
    if (document.querySelector('.lv-list.lv-dragging')) return setTimeout(paint, 800);   // don't redraw under a drag
    const el = document.getElementById('lv-root');
    if (el) el.innerHTML = body(); else if (X && onPage()) X.rerender();
    fitSoon();
    poll();
  }
  // a name too long for its column (narrow phone, big text) shrinks a little to fit on one line, down to 70%
  function fitNames(root) {
    (root || document).querySelectorAll('.lv-nmt').forEach(n => {
      n.style.fontSize = '';
      const td = n.closest('td'); if (!td || !td.offsetWidth) return;
      const cs = getComputedStyle(td), room = td.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
      if (n.scrollWidth > room) { const fs = parseFloat(getComputedStyle(n).fontSize); n.style.fontSize = Math.max(fs * 0.7, fs * room / n.scrollWidth - 0.2) + 'px'; }
    });
  }
  // compact view: the starters stretch to fill the screen under the score header, so the whole matchup is one screenshot
  function fitCompact(root) {
    const ls = (root || document).querySelector('.lv-list.lv-compact'); if (!ls) return;
    const top = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--hdr-h')) || 50;
    ls.querySelectorAll('.lv-g.open').forEach(g => {
      const t = g.querySelector('.lv-det > .lv-t'); if (!t) return;
      t.style.removeProperty('--rowh');
      const sum = g.querySelector('.lv-sum'), bn = g.querySelector('.lv-bench > summary');
      const avail = window.innerHeight - top - sum.offsetHeight - (bn ? bn.offsetHeight + 8 : 0) - 12;
      const h = Math.max(40, Math.min(96, Math.floor(avail / (t.rows.length || 9))));
      t.style.setProperty('--rowh', h + 'px');
      t.classList.toggle('lv-big', h >= 58);
    });
  }
  const fitSoon = () => requestAnimationFrame(() => { fitNames(document.getElementById('lv-root')); fitCompact(document.getElementById('lv-root')); });
  document.addEventListener('toggle', e => { if (e.target.closest && e.target.closest('#lv-root')) fitNames(e.target); }, true);
  window.addEventListener('resize', () => { if (onPage()) fitSoon(); });

  const info = id => (players && players[id]) || {};
  const pos = id => { const p = info(id).position || ''; return p === 'Def' ? 'DEF' : p; };
  const short = id => {
    const nm = info(id).name || id;
    if (pos(id) === 'DEF') return (nm.split(',')[0] || nm).trim() + '\u00a0D';   // Jaguars D (the city is on the line below)
    const [last, first] = nm.split(',').map(s => s.trim());
    return first ? `${first[0]}. ${last}` : nm;
  };
  // his NFL team has no game this week: ESPN's scoreboard for the week has loaded and his team isn't on it
  // (MFL reports a bye as 0 seconds left, the same as a finished game). Free agents (no team) aren't on a bye.
  const onBye = id => { const t = TEAM[info(id).team] || info(id).team, G = EW().games;
    return !!t && t !== 'FA' && Object.keys(G).length >= 10 && !G[t]; };
  // a player's game: not started, in progress, final, or no game (bye)
  const state = p => { if (onBye(p.id)) return 'bye'; const s = +p.gameSecondsRemaining; return s >= 3600 ? 'pre' : s > 0 ? 'live' : 'final'; };
  const kick = iso => { const d = new Date(iso); return d.toLocaleDateString([], { weekday: 'short' }) + ' ' + d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }); };
  const clock = p => {
    const s = +p.gameSecondsRemaining, g = gameOf(p.id);
    if (onBye(p.id)) return 'Bye';
    if (s >= 3600) return g && g.state === 'pre' ? kick(g.date) : 'Yet to play';
    if (s <= 0) return 'Final';
    const q = Math.min(4, Math.floor((3600 - s) / 900) + 1), left = s - (4 - q) * 900;
    return `Q${q} ${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
  };
  // starters in lineup order: QB, RB, RB, WR, WR, TE, FLEX, DEF
  // MFL lists starters in a changing order (by points), so slots are filled in a fixed order instead: highest
  // projection first (then player id), so the extra RB/WR/TE in FLEX stays put as scores change
  function lineup(f) {
    const wk = view || +((data || {}).liveScoring || {}).week;
    const st = (f.players.player || []).filter(p => p.status === 'starter')
      .sort((a, b) => ((projOf(b.id, wk) || 0) - (projOf(a.id, wk) || 0)) || (a.id < b.id ? -1 : 1));
    const left = st.slice(), out = [];
    for (const s of SLOTS) {
      const ok = s === 'FLEX' ? ['RB', 'WR', 'TE'] : [s];
      const i = left.findIndex(p => ok.includes(pos(p.id)));
      out.push({ slot: s, p: i >= 0 ? left.splice(i, 1)[0] : null });
    }
    left.forEach(p => out.push({ slot: pos(p.id), p }));
    return out;
  }
  const bench = f => (f.players.player || []).filter(p => p.status !== 'starter').sort((a, b) => b.score - a.score);
  // taxi squad and IR players aren't in MFL's live scoring: their game state comes from ESPN, no points
  const extra = (f, kind) => ((rosters || {})[f.id] || {})[kind] ? rosters[f.id][kind].filter(id => !(((f.players || {}).player) || []).some(x => x.id === id)).map(id => {
    const g = gameOf(id), secs = !g ? 0 : g.state === 'pre' ? 3600 : g.state === 'post' ? 0 : Math.max(1, (4 - Math.min(4, g.period || 1)) * 900 + (String(g.clock || '0:00').split(':').reduce((m, x) => m * 60 + (+x || 0), 0)));
    return { id, status: kind, score: null, gameSecondsRemaining: String(secs) };
  }) : [];
  const counts = f => ({ live: +f.playersCurrentlyPlaying || 0, pre: +f.playersYetToPlay || 0 });

  function body() {
    if (failed) return '<p class="error">The scoreboard didn’t load. Refresh the page to try again.</p>';
    if (!data) return '<p class="loading">Loading the scoreboard…</p>';
    const esc = X.esc, liveW = +data.liveScoring.week, shownW = view || liveW;
    // week picker: every week so far, the current week by default
    const maxW = Math.max(liveW, X.weeksPlayed || 0);
    const picker = `<div class="lv-weeks" role="group" aria-label="Week">${Array.from({ length: maxW }, (_, i) => i + 1).map(w =>
      `<button type="button" data-lv-week="${w}" aria-pressed="${w === shownW}"${w === liveW ? ' title="Current week"' : ''}>${w}</button>`).join('')}</div>`;
    if (view && !hist[view]) return picker + '<p class="loading">Loading week ' + view + '…</p>';
    const L = cur().liveScoring;
    if (X.mode === 'players') return picker + playersBody(L, shownW);
    const tm = id => X.teams[id] || {};
    const seedOf = id => ((X.seeds || []).find(x => x.id === id) || {}).seed;
    const seed = id => !view && seedOf(id) ? `<span class="lv-seed${seedOf(id) > 3 ? ' wc' : ''}" title="${seedOf(id)} seed if the season ended today">${seedOf(id)}</span>` : '';
    // record, place in the division and last-3 average (from the weekly league update)
    const ord = n => n + (['th', 'st', 'nd', 'rd'][(n % 100 > 10 && n % 100 < 14) ? 0 : (n % 10 < 4 ? n % 10 : 0)]);
    const stand = id => (X.standings || []).find(t => t.id === id);
    const upTo = g => !view || g[0] <= view;   // an earlier week shows the record and L3 as of that week
    const l3 = id => { const sc = (X.games || []).filter(g => upTo(g) && (g[1] === id || g[3] === id)).sort((x, y) => x[0] - y[0]).slice(-3).map(g => g[1] === id ? g[2] : g[4]);
      return sc.length ? n1(sc.reduce((x, y) => x + y, 0) / sc.length) : ''; };
    const recAt = id => { let w = 0, l = 0, t = 0; (X.games || []).filter(g => upTo(g) && (g[1] === id || g[3] === id)).forEach(g => {
      const me = g[1] === id ? g[2] : g[4], op = g[1] === id ? g[4] : g[2]; me > op ? w++ : me < op ? l++ : t++; }); return `${w}-${l}${t ? '-' + t : ''}`; };
    const meta = id => { if (view) return `${recAt(id)} after week ${view}${l3(id) ? ` · L3 ${l3(id)}` : ''}`;
      const t = stand(id); if (!t) return '';
      return `${t.w}-${t.l}${t.t ? '-' + t.t : ''} · ${ord(t.divisionRank)} ${esc(t.divisionName || '')}${l3(id) ? ` · L3 ${l3(id)}` : ''}`; };
    // the week's highest and lowest scores, live
    // 🥶 only goes to a team that has had someone play: a 0 because nobody's kicked off yet isn't a low score
    const kicked = f => (f.players.player || []).some(p => { if (p.status !== 'starter') return false; const g = gameOf(p.id); return g ? g.state !== 'pre' : state(p) === 'live'; });
    const all = L.matchup.flatMap(m => m.franchise.map(f => +f.score)), hi = Math.max(...all);
    const played = L.matchup.flatMap(m => m.franchise.filter(kicked).map(f => +f.score)), lo = played.length ? Math.min(...played) : -1;
    // (the frozen-man photo for the week's coldest starter is retired for now; assets/players/coldest.jpg is kept)
    const heat = f => +f.score === hi && hi > 0 ? '<span class="lv-heat" title="Highest score this week">🔥</span>' : +f.score === lo && hi > lo && kicked(f) ? '<span class="lv-heat" title="Lowest score this week">🥶</span>' : '';
    // a team's bar color: its primary, or its secondary when the primary is near white
    const lum = h => { h = String(h || '#888').replace('#', ''); return (0.299 * parseInt(h.slice(0, 2), 16) + 0.587 * parseInt(h.slice(2, 4), 16) + 0.114 * parseInt(h.slice(4, 6), 16)) / 255; };
    // of the team's two colors, the one closest to a mid tone, so it shows on light and dark backgrounds alike
    const barColor = id => { const t = tm(id), c = [t.primary, t.secondary].filter(x => /^#[0-9a-f]{6}$/i.test(x || ''));
      return c.length ? c.sort((x, y) => Math.abs(lum(x) - 0.5) - Math.abs(lum(y) - 0.5))[0] : 'var(--muted)'; };
    const logo = id => tm(id).logo ? `<img class="lv-lg" src="${tm(id).logo}" alt="">` : `<span class="lv-lg">${esc(tm(id).abbr || '')}</span>`;
    const game = (m, gi) => {
      const fs = m.franchise.slice().sort((a, b) => (+a.isHome) - (+b.isHome));   // away on the left
      const [a, b] = fs, sa = +a.score, sb = +b.score, ca = counts(a), cb = counts(b);
      const done = !ca.live && !ca.pre && !cb.live && !cb.pre;
      const lead = sa === sb ? '' : sa > sb ? 'a' : 'b';
      const live = ca.live + cb.live, pre = ca.pre + cb.pre;
      const mid = done ? 'Final' : [live ? `${live} playing` : '', pre ? `${pre} to play` : ''].filter(Boolean).join(' · ');
      const key = `${a.id}-${b.id}`, isOpen = open.has(key);
      // who's winning: the bar tips toward the leader, by how much he leads (a 50-point lead nearly fills it)
      const diff = sa - sb, share = sa + sb ? Math.max(6, Math.min(94, 50 + diff)) : 50;
      const tip = !sa && !sb ? 'Not started' : diff ? `${esc(X.nameOf(diff > 0 ? a.id : b.id))} ${done ? 'won' : 'leads'} by ${n1(Math.abs(diff))}` : 'Tied';
      const bar = `<span class="lv-tug" role="img" aria-label="${tip}" title="${tip}"><i class="${diff < 0 ? 'trail' : ''}" style="width:${share}%;background:${barColor(a.id)}"></i><i class="${diff > 0 ? 'trail' : ''}" style="width:${100 - share}%;background:${barColor(b.id)}"></i></span>`;
      const pa = projTotal(a, shownW), pb = projTotal(b, shownW), showProj = pa != null && pb != null && (!done || view);
      const projLine = v => showProj ? `<small class="lv-pjt" title="${view ? 'MFL’s projection before the games' : 'MFL’s projection: points so far plus the projection for what’s left'}">${n1(v)}</small>` : '';
      // the seed sits on the logo's inside bottom corner; the projection sits under the score
      const side = (f, cls) => `<span class="lv-side ${cls}${lead === cls ? ' lead' : ''}"><span class="lv-lgw">${logo(f.id)}${seed(f.id)}${heat(f)}</span><span class="lv-sc"><b>${n1(+f.score)}</b>${projLine(cls === 'a' ? pa : pb)}</span></span>`;
      const la = lineup(a), lb = lineup(b);
      // one player's two cells, mirrored on the right side: name | points  slot  points | name
      const cell = (p, cls, slot) => {
        if (!p) { const nm = `<td class="lv-p ${cls} empty">—</td>`, pt = `<td class="lv-pts ${cls}"></td>`; return cls === 'a' ? nm + pt : pt + nm; }
        // FBP's own IR counts even when ESPN no longer lists the injury
        const st = state(p), ph = photo(p.id), inj = (dnp(p) ? { t: 'IN', title: 'Inactive: didn’t play this game' } : null) || injTag(p.id) || (p.status === 'ir' ? { t: 'IR', title: 'On FBP injured reserve' } : null);
        const tag = playerChips(p.id, shownW, (cls === 'a' ? a : b).id) + (inj ? `<span class="lv-inj" title="${esc(inj.title)}">${inj.t}</span>` : '');
        const img = photoHtml(p, shownW);
        // bottom row: position (only when it isn't the slot's, as in FLEX or the bench), his NFL team's logo, the game clock, then the opponent (vs at home, @ away) and the
        // weather, toward the middle of the matchup
        const g = gameOf(p.id), myT = TEAM[info(p.id).team] || info(p.id).team;
        const wx = g && g.state !== 'post' ? wxIcon(g.wx) : '';
        // his team and the opponent sit together as one matchup (BUF @ MIA as logos), then the clock
        // his team first either way, weather on the inside: left side "BUF @ MIA ☀", right side "☀ BUF @ MIA"
        // once his game kicks off, each team's score sits by its logo (his team's score bold): "BUF 24 @ MIA 17"
        const vs = g && g.opp ? (g.home ? 'vs' : '@') : '', on = g && g.state !== 'pre' && g.pf != null;
        const me = myT ? nflImg(myT, info(p.id).team) + (on ? `<b class="lv-gs">${esc(String(g.pf))}</b>` : '') : '';
        const them = vs ? nflImg(g.opp) + (on ? `<span class="lv-gs">${esc(String(g.pa))}</span>` : '') : '';
        const mu = !myT ? '' : `<span class="lv-opp">${!vs ? me : cls === 'a' ? me + vs + them + wx : wx + me + vs + them}</span>`;
        const bottom = [slot === pos(p.id) ? '' : pos(p.id), mu, `<span class="lv-st ${st}">${clock(p)}</span>`].filter(Boolean);
        // the ball: a football beside his photo when his NFL team has it, RZ in the red zone; a defense on the field
        // gets ON D, and RZ when the other team is in the red zone
        const isD = pos(p.id) === 'DEF', live = g && g.state === 'in';
        const flags = !live ? '' : isD ? (g.ball ? '' : `${g.defRz ? '<span class="lv-rz">RZ</span>' : ''}<span class="lv-def" title="Defending">ON D</span>`)
          : g.ball ? `<span class="lv-ball" title="His team has the ball">🏈</span>${g.rz ? '<span class="lv-rz" title="In the red zone">RZ</span>' : ''}` : '';
        // in the red zone (his offense there, or his defense defending it): a red tint across his half of the row
        const rzOn = live && (isD ? !g.ball && g.defRz : g.ball && g.rz), rzc = rzOn ? ' lv-inrz' : '';
        const nm = `<td class="lv-p ${cls} ${st}${rzc}"><div class="lv-pc"><span class="lv-phw">${img}${teamChip(p.id, (cls === 'a' ? a : b).id)}${flags ? `<span class="lv-flags">${flags}</span>` : ''}</span><span class="lv-who"><span class="lv-nm"><span class="lv-nmt">${esc(short(p.id))}</span>${tag}</span><span class="lv-ext"><small class="lv-bot">${bottom.join('')}</small>${statLine(p.id) ? `<small class="lv-stat">${esc(statLine(p.id))}</small>` : ''}</span></span></div></td>`;
        const pj = projOf(p.id, shownW);
        // before kickoff the projection stands in, muted; once he plays, his points with the projection under them
        const pt = `<td class="lv-pts ${cls} ${st}${rzc}">${st === 'pre' || p.score == null ? (pj != null ? `<span class="lv-pre" title="MFL projection">${n1(pj)}</span><small class="lv-pj0">proj</small>` : '–')
          : n1(+p.score) + (pj != null && st !== 'bye' && (st !== 'final' || view) ? `<small class="lv-pj" title="MFL projection">${n1(pj)}</small>` : '')}</td>`;
        return cls === 'a' ? nm + pt : pt + nm;
      };
      const rows = la.map((r, i) => { const o = lb[i] || {}; return `<tr>${cell(r.p, 'a', r.slot)}<td class="lv-slot">${r.slot}</td>${cell(o.p, 'b', o.slot || r.slot)}</tr>`; }).join('');
      // bench, then taxi squad, then IR, each side listed in its own column
      const group = (xa, xb, lbl) => Array.from({ length: Math.max(xa.length, xb.length) }, (_, i) =>
        `<tr class="lv-r-${lbl.toLowerCase()}">${xa[i] ? cell(xa[i], 'a') : '<td></td><td></td>'}<td class="lv-slot">${lbl}</td>${xb[i] ? cell(xb[i], 'b') : '<td></td><td></td>'}</tr>`).join('');
      const benchRows = group(bench(a), bench(b), 'BN') + (view ? '' : group(extra(a, 'taxi'), extra(b, 'taxi'), 'TX') + group(extra(a, 'ir'), extra(b, 'ir'), 'IR'));
      const left = f => { const c = counts(f); return c.live || c.pre ? `${c.live ? `${c.live} playing` : ''}${c.live && c.pre ? ', ' : ''}${c.pre ? `${c.pre} to play` : ''}` : 'Done'; };
      return `<article class="card lv-g${isOpen ? ' open' : ''}" data-lv-key="${key}">
        <button type="button" class="lv-sum" data-lv="${key}" aria-expanded="${isOpen}">
          ${side(a, 'a')}<span class="lv-mid"><span class="lv-vs">vs</span>${bar}<small>${mid}</small></span>${side(b, 'b')}
          <span class="lv-metarow"><small>${meta(a.id)}</small><small>${meta(b.id)}</small></span>
        </button>
        <div class="lv-det"${isOpen ? '' : ' hidden'}>
          <div class="lv-names"><b>${seed(a.id)}${esc(X.nameOf(a.id))}${honors ? chips(honors.t[a.id]) : ''}</b><b>${honors ? chips(honors.t[b.id]) : ''}${esc(X.nameOf(b.id))}${seed(b.id)}</b></div>
          <div class="lv-names lv-left"><small>${left(a)}</small><small>${left(b)}</small></div>
          <table class="lv-t"><tbody>${rows}</tbody></table>
          ${benchRows ? `<details class="lv-bench"${openBench.has(key) ? ' open' : ''} data-lv-bench="${key}"><summary>${view ? 'Bench' : 'Bench, taxi squad and IR'}</summary><table class="lv-t"><tbody>${benchRows}</tbody></table></details>` : ''}
        </div></article>`;
    };
    const any = L.matchup.length;
    const t = stamp ? stamp.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' }) : '';
    const p = pace();
    const status = view ? `<b>Week ${view} final.</b>` : data.sample ? '<b>Sample data.</b> Live scores start once the relay is set up.'
      : !p ? `<b>Final.</b> Week ${esc(L.week)} is in the books.`
      : p === SLOW_MS ? `Updated ${t} · checks every 5 minutes until games start` : `Updated ${t} · refreshes every ${POLL_MS / 1000} seconds`;
    return `${picker}<div class="lv-bar"><span>${status}</span>
        <span class="lv-btns"><button type="button" class="lv-all lv-cmp" data-lv-cmp aria-pressed="${compact}">Compact</button><button type="button" class="lv-all" data-lv-all="${open.size === any ? 'close' : 'open'}">${open.size === any ? 'Collapse all' : 'Expand all'}</button></span></div>
      <div class="lv-list${compact ? ' lv-compact' : ''}">${ordered(L.matchup).map(game).join('')}</div>
      ${honors && honors.thru ? `<p class="rf-foot lv-foot">Award chips (1st Team, MVP, RoY, ToY and the rest) show who holds each <a href="#awards">award</a> through week ${honors.thru} of the ${esc(String(honors.season || ''))} season. The awards aren’t final until the regular season ends, so the chips can change from week to week.</p>` : ''}`;
  }

  // Game Day > Players: the week's top scorers at each position among every FBP-rostered player, starters and bench,
  // live. Only players whose NFL game has kicked off are ranked.
  // every player's points for a week, through the relay (?t=all): free agents, plus taxi squad and IR players,
  // who aren't in MFL's live scoring. A relay without ?t=all falls back to ?t=fa (free agents only).
  const fa = {}, faAt = {}; let faMissing = false, faAll = true;
  // the Rostered players only checkbox (off by default; remembered on this device)
  // who to show: All players, Free agents only, Rostered only, Starters only (remembered on this device)
  const PL_SHOW = [['all', 'All players'], ['fa', 'Free agents'], ['ro', 'Rostered'], ['st', 'Starters']];
  let plShow = 'all'; try { plShow = localStorage.getItem('fbp-players-show') || (localStorage.getItem('fbp-players-ro') === '1' ? 'ro' : 'all'); } catch (e) {}
  if (!PL_SHOW.some(x => x[0] === plShow)) plShow = 'all';
  document.addEventListener('click', e => { const b = e.target.closest && e.target.closest('[data-pl-show]'); if (!b) return;
    plShow = b.dataset.plShow; try { localStorage.setItem('fbp-players-show', plShow); } catch (err) {} paint(); });
  function loadFa(w) {
    if (!LIVE_URL || faMissing || (faAt[w] && Date.now() - faAt[w] < 60000)) return;
    faAt[w] = Date.now();
    fetch(`${LIVE_URL}?t=${faAll ? 'all' : 'fa'}&w=${w}`, { cache: 'no-cache' }).then(r => r.ok ? r.json() : null).then(j => {
      if (!j || !j.playerScores) { if (j && j.liveScoring) { if (faAll) { faAll = false; faAt[w] = 0; loadFa(w); } else faMissing = true; } return; }
      fa[w] = [].concat(j.playerScores.playerScore || []).filter(x => players && players[x.id]).map(x => ({ id: x.id, score: x.score, fa: !faAll || x.isAvailable === '1' }));
      if (X && X.mode === 'players') paint();
    }).catch(() => {});
  }
  // whose taxi squad or IR a player is on (today's rosters)
  const reserveOf = id => { for (const [f, r] of Object.entries(rosters || {})) { if (r.taxi.includes(id)) return [f, 'taxi']; if (r.ir.includes(id)) return [f, 'ir']; } return null; };
  // a free agent's game clock in MFL's terms (seconds left out of 3600), from ESPN's scoreboard
  const faSecs = id => { const g = gameOf(id); if (!g) return 0; if (g.state === 'post') return 0; if (g.state !== 'in') return 3600;
    const [m, sec] = String(g.clock || '0:00').split(':').map(Number); return Math.max(0, (4 - Math.min(4, +g.period || 1)) * 900 + (m || 0) * 60 + (sec || 0)); };
  const PL_POS = [['QB', 'Quarterbacks', 5], ['RB', 'Running backs', 8], ['WR', 'Wide receivers', 8], ['TE', 'Tight ends', 5], ['DEF', 'Defenses', 5]];
  const plMore = new Set();
  function playersBody(L, wk) {
    const esc = X.esc, tm = id => X.teams[id] || {};
    const flogo = id => tm(id).logo ? `<img class="pl-fbp" src="${tm(id).logo}" alt="" title="${esc(X.nameOf(id))}">` : `<span class="pl-fbp">${esc(tm(id).abbr || '')}</span>`;
    const nlogo = id => { const t = TEAM[info(id).team] || info(id).team; return t ? `<img class="pl-nfl" src="https://a.espncdn.com/i/teamlogos/nfl/500/${String(t).toLowerCase()}.png" alt="" onerror="this.remove()">` : ''; };
    const SLOT = { starter: ['S', 'Starter'], taxi: ['T', 'Taxi squad'], ir: ['IR', 'Injured reserve'] };
    const slot = st => { const [k, t] = SLOT[st] || ['B', 'Bench']; return `<span class="pl-sl ${k.toLowerCase()}" title="${t}">${k}</span>`; };
    const onField = p => { const g = gameOf(p.id); return (g ? g.state !== 'pre' : state(p) === 'live') && !dnp(p); };
    const all = [];
    L.matchup.forEach(m => m.franchise.forEach(f => (f.players.player || []).forEach(p => { if (onField(p)) all.push(Object.assign({ fid: f.id }, p)); })));
    loadFa(wk);
    const seen = new Set(all.map(p => p.id));
    (fa[wk] || []).forEach(x => { if (seen.has(x.id)) return;
      const rs = x.fa ? null : reserveOf(x.id);
      if (!x.fa && !rs) return;                       // rostered, but not in this week's lineups or on a taxi squad/IR
      const p = { id: x.id, score: x.score, status: rs ? rs[1] : 'fa', fid: rs ? rs[0] : null, gameSecondsRemaining: String(faSecs(x.id)) };
      if (onField(p)) all.push(p); });
    // games still going (or just ended): MFL hasn't posted free agents', taxi or IR players' points yet, so estimate them
    if (!view && players) {
      all.forEach(p => seen.add(p.id));
      Object.keys(players).forEach(id => {
        if (seen.has(id) || !PL_POS.some(x => x[0] === pos(id))) return;
        const g = gameOf(id); if (!g || g.state === 'pre') return;
        const sc = estimate(id); if (sc == null) return;
        const rs = reserveOf(id);
        const p = { id, score: String(sc), est: true, status: rs ? rs[1] : 'fa', fid: rs ? rs[0] : null, gameSecondsRemaining: String(faSecs(id)) };
        if (onField(p)) all.push(p);
      });
    }
    const keep = p => plShow === 'fa' ? !p.fid : plShow === 'ro' ? !!p.fid : plShow === 'st' ? p.status === 'starter' : true;
    const shown = all.filter(keep);
    const seg = `<div class="seg pl-show" role="tablist">${PL_SHOW.filter(([k]) => !(faMissing && k === 'fa')).map(([k, l]) => `<button type="button" role="tab" data-pl-show="${k}" aria-selected="${k === plShow}">${l}</button>`).join('')}</div>`;
    if (!all.length) return '<p class="loading">No one has played yet this week. The leaderboard fills in once games kick off.</p>';
    const sec = ([ps, title, n]) => {
      const list = shown.filter(p => pos(p.id) === ps).sort((a, b) => (+b.score || 0) - (+a.score || 0));
      if (!list.length) return '';
      const more = plMore.has(ps), show = list.slice(0, more ? 25 : n);
      return `<section class="card pl-sec"><h2 class="pl-h">${title}</h2><ol class="pl-list">${show.map((p, i) => {
        const tr = tier(p, wk), pj = projOf(p.id, wk), st = state(p);
        return `<li class="pl-r${tr ? ' t-' + tr.k : ''}${st === 'final' ? ' fin' : ''}"><span class="pl-rk">${i + 1}</span>${photoHtml(p, wk)}
          <span class="pl-who"><span class="pl-nm">${esc(short(p.id))}${tr && (tr.k === 'nuke' || tr.k === 'hot') ? `<span class="pl-tag ${tr.k}">${tr.k === 'nuke' ? 'Nuclear' : 'Hot'}</span>` : ''}</span>
            <small>${nlogo(p.id)}${esc(info(p.id).team || '')} · <span class="lv-st ${st}">${clock(p)}</span></small>
            <small class="pl-own">${p.fid ? `${flogo(p.fid)}${esc(tm(p.fid).abbr || X.nameOf(p.fid))}${slot(p.status)}` : '<span class="pl-fa">FA</span>Free agent'}</small></span>
          <span class="pl-pts"><b>${n1(+p.score || 0)}</b>${p.est ? '<small class="pl-est" title="Estimated from ESPN’s box score; MFL posts official points once his game is final">est.</small>' : ''}${pj != null ? `<small>proj ${n1(pj)}</small>` : ''}</span></li>`; }).join('')}</ol>
        ${list.length > n ? `<button type="button" class="pl-more" data-pl-more="${ps}">${more ? 'Show fewer' : `Show more (${Math.min(list.length, 25) - n})`}</button>` : ''}</section>`;
    };
    const live = all.some(p => state(p) === 'live');
    const what = { all: faMissing || !fa[wk] ? 'FBP-rostered players' : 'every player, rostered or free agent', fa: 'free agents only', ro: 'FBP-rostered players', st: 'FBP starters only' }[plShow];
    return `<div class="lv-bar"><span>${live ? 'Games in progress · updates with the scoreboard' : view ? `Week ${wk}` : 'Week ' + wk + ' so far'} · ${what}</span></div>${seg}
      <div class="pl-grid">${PL_POS.map(sec).join('')}</div>
      <p class="rf-foot lv-foot">Ranked by points this week among players who have taken the field this week. Nuclear: over 35 for a QB, 30 for a RB or WR, 25 for a TE or defense. Hot: well ahead of his MFL projection. S starter, B bench, T taxi squad, IR injured reserve. Free agents, taxi squad and IR players whose games are under way show an estimate (est.) worked out from ESPN’s box score with FBP scoring, until MFL posts their official points after the game.</p>`;
  }
  document.addEventListener('click', e => { const b = e.target.closest('[data-pl-more]'); if (!b) return; const k = b.dataset.plMore; plMore.has(k) ? plMore.delete(k) : plMore.add(k); paint(); });

  function render(ctx) {
    X = ctx;
    if ((!data && !failed) || (data && nextW() !== askedW && !loading)) load();
    poll();
    setTimeout(fitSoon, 0);
    if (X.mode === 'players') return `<div class="pagehead"><h1>Players</h1><span class="asof">The week’s top scorers at every position, live · pick a week</span></div>${X.nav || ''}<div id="lv-root">${body()}</div>`;
    return `<div class="pagehead"><h1>Scoreboard</h1><span class="asof">Pick a week · tap a game for both lineups and stats${(X.seeds || []).length ? ' · numbers by a team are playoff seeds if the season ended today' : ''}</span></div>${X.nav || ''}<div id="lv-root">${body()}</div>`;
  }

  document.addEventListener('toggle', e => {
    const d = e.target; if (!d.matches || !d.matches('[data-lv-bench]')) return;
    d.open ? openBench.add(d.dataset.lvBench) : openBench.delete(d.dataset.lvBench);
  }, true);
  document.addEventListener('click', e => {
    const wb = e.target.closest('[data-lv-week]');
    if (wb && data) { showWeek(+wb.dataset.lvWeek); return; }
    const cb = e.target.closest('[data-lv-cmp]');
    if (cb) { compact = !compact; try { localStorage.setItem('fbp-sb-compact', compact ? '1' : '0'); } catch (e2) {}
      cb.setAttribute('aria-pressed', compact); const ls = document.querySelector('.lv-list'); if (ls) ls.classList.toggle('lv-compact', compact); fitSoon(); return; }
    const all = e.target.closest('[data-lv-all]');
    if (all && data) {
      open.clear();
      if (all.dataset.lvAll === 'open') cur().liveScoring.matchup.forEach(m => { const fs = m.franchise.slice().sort((a, b) => (+a.isHome) - (+b.isHome)); open.add(`${fs[0].id}-${fs[1].id}`); });
      paint(); return;
    }
    const b = e.target.closest('[data-lv]'); if (!b) return;
    const key = b.dataset.lv, g = b.closest('.lv-g'), on = !open.has(key);
    on ? open.add(key) : open.delete(key);
    g.classList.toggle('open', on); b.setAttribute('aria-expanded', on); g.querySelector('.lv-det').hidden = !on;
    if (on) { fitNames(g); fitCompact(g.parentElement.parentElement); }
    const btn = document.querySelector('[data-lv-all]'), n = cur().liveScoring.matchup.length;
    if (btn) { btn.dataset.lvAll = open.size === n ? 'close' : 'open'; btn.textContent = open.size === n ? 'Collapse all' : 'Expand all'; }
  });

  window.FBPLive = { render };
})();
