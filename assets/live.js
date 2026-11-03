/* Scoreboard tab: this week's six games, live.
   Each game is one line (logo, score, vs, score, logo) that opens into both lineups, slot by slot.
   Data is MFL's liveScoring export. Browsers can't read MFL directly from this site, so it comes through a small
   Cloudflare Worker relay (LIVE_URL, code in relay/worker.js). With LIVE_URL empty the page shows a saved sample
   (data/live-sample.json).
   Player names, positions and NFL teams come from data/mfl/players.json. Stat lines, kickoff times and game clocks
   come from ESPN's public scoreboard and box scores (readable straight from the browser), matched by ESPN id
   (data/player-links.json), and so do injury designations (live, with data/espn/injuries.json as a fallback).
   Taxi squad and IR come from the weekly roster file (data/mfl/rosters.json); MFL's live scoring leaves them out.
   Polling: every 15 seconds while NFL games are on, every 5 minutes before kickoff, and not at all once the weekly
   league update has the week in the books. */
(function () {
  const LIVE_URL = 'https://fbp-live.pmiglio-gchat.workers.dev/';   // Cloudflare Worker relay (relay/worker.js)
  const POLL_MS = 15000;
  const SLOTS = ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'DEF'];
  const SLOW_MS = 300000;
  let X = null, data = null, players = null, rosters = null, failed = false, loading = false, timer = null, stamp = null;
  const open = new Set(), openBench = new Set();

  const n1 = v => (Math.round(v * 10) / 10).toFixed(1);
  function load() {
    if (loading) return;
    loading = true;
    const src = LIVE_URL || 'data/live-sample.json';
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
  let games = {}, stats = {}, links = null, espnAt = 0;
  function loadEspn() {
    if (Date.now() - espnAt < POLL_MS - 1000) return Promise.resolve();
    espnAt = Date.now();
    const lk = links ? Promise.resolve(links) : fetch('data/player-links.json').then(r => r.ok ? r.json() : null).then(j => (links = (j && j.links) || {}));
    return Promise.all([lk, fetch(ESPN + 'scoreboard').then(r => r.ok ? r.json() : null)]).then(([, sb]) => {
      if (!sb) return;
      const g = {};
      (sb.events || []).forEach(ev => {
        const st = ev.status || {}, t = st.type || {};
        const info = { id: ev.id, state: t.state, date: ev.date, detail: t.shortDetail, clock: st.displayClock, period: st.period, name: ev.shortName };
        ev.competitions[0].competitors.forEach(c => { g[c.team.abbreviation] = info; });
      });
      games = g;
      // box scores only for games that have started; finished ones only once
      const want = [...new Set(Object.values(g).filter(x => x.state === 'in' || (x.state === 'post' && !stats['ev' + x.id])).map(x => x.id))];
      return Promise.all(want.map(id => fetch(ESPN + 'summary?event=' + id).then(r => r.ok ? r.json() : null).then(j => {
        if (!j || !j.boxscore) return;
        stats['ev' + id] = 1;
        (j.boxscore.players || []).forEach(tm => (tm.statistics || []).forEach(cat => (cat.athletes || []).forEach(a => {
          const row = (stats[a.athlete.id] = stats[a.athlete.id] || {});
          row[cat.name] = Object.fromEntries((cat.labels || []).map((l, i) => [l, a.stats[i]]));
        })));
      }).catch(() => null)));
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
    }).catch(() => fetch('data/espn/injuries.json').then(r => r.ok ? r.json() : {}).then(j => {
      injuries = Object.fromEntries(Object.entries(j || {}).map(([k, v]) => [k, { status: v.status, note: v.short || '' }]));
    })).catch(() => { injuries = injuries || {}; });
  }
  const injTag = id => { const i = injuries && injuries[espnId(id)]; const t = i && INJ[i.status]; return t ? { t, title: `${i.status}${i.note ? ': ' + i.note : ''}` } : null; };
  const espnId = id => ((links && links[id]) || [])[0];
  const photo = id => {
    if (pos(id) === 'DEF') { const t = TEAM[info(id).team] || info(id).team || ''; return t ? `https://a.espncdn.com/i/teamlogos/nfl/500/${t.toLowerCase()}.png` : ''; }
    return espnId(id) ? `https://a.espncdn.com/i/headshots/nfl/players/full/${espnId(id)}.png` : '';
  };
  const gameOf = id => games[TEAM[info(id).team] || info(id).team];
  // the stat line: passing, rushing, receiving, whatever he did
  function statLine(id) {
    const r = stats[espnId(id)]; if (!r) return '';
    const n = v => +String(v || 0).split('/')[0] || 0, out = [];
    const ps = r.passing, ru = r.rushing, re = r.receiving, k = r.kicking;
    if (ps) out.push(`${ps['C/ATT']}, ${ps.YDS} yds${n(ps.TD) ? `, ${ps.TD} TD` : ''}${n(ps.INT) ? `, ${ps.INT} INT` : ''}`);
    const rush = ru && (n(ru.CAR) || n(ru.YDS)) ? `${ru.CAR} car, ${ru.YDS} yds${n(ru.TD) ? `, ${ru.TD} TD` : ''}` : '';
    const rec = re && (n(re.REC) || n(re.TGTS)) ? `${re.REC} rec${re.TGTS ? ` (${re.TGTS} tgt)` : ''}, ${re.YDS} yds${n(re.TD) ? `, ${re.TD} TD` : ''}` : '';
    if (pos(id) === 'WR' || pos(id) === 'TE') { if (rec) out.push(rec); if (rush) out.push(rush); } else { if (rush) out.push(rush); if (rec) out.push(rec); }
    if (k) out.push(`FG ${k.FG}, XP ${k.XP}`);
    const fl = r.fumbles && n(r.fumbles.LOST);
    if (fl) out.push(`${fl} fum lost`);
    return out.join(' · ');
  }
  // the week is in the books once the weekly league update has counted it
  const weekDone = () => !!(data && X && +data.liveScoring.week <= (X.weeksPlayed || 0));
  // fast while any NFL game is on (or about to start), slow before kickoff, stopped once the week is final
  function pace() {
    if (weekDone()) return 0;
    const gs = Object.values(games);
    if (!gs.length || gs.some(g => g.state === 'in')) return POLL_MS;
    const next = Math.min(...gs.filter(g => g.state === 'pre').map(g => Date.parse(g.date)));
    return isFinite(next) && next - Date.now() < 20 * 60000 ? POLL_MS : SLOW_MS;
  }
  function poll() {
    clearTimeout(timer);
    if (!LIVE_URL) return;
    const ms = data ? pace() : POLL_MS;
    if (!ms) return;
    timer = setTimeout(() => { if (location.hash.startsWith('#scores') && !document.hidden) load(); poll(); }, ms);
  }
  // redraw just the scoreboard (keeps scroll position and which games are open)
  function paint() {
    const el = document.getElementById('lv-root');
    if (el) el.innerHTML = body(); else if (X && location.hash.startsWith('#scores')) X.rerender();
    poll();
  }

  const info = id => (players && players[id]) || {};
  const pos = id => { const p = info(id).position || ''; return p === 'Def' ? 'DEF' : p; };
  const short = id => {
    const nm = info(id).name || id;
    if (pos(id) === 'DEF') return (nm.split(',')[1] || nm).trim() + ' D';
    const [last, first] = nm.split(',').map(s => s.trim());
    return first ? `${first[0]}. ${last}` : nm;
  };
  // a player's game: not started, in progress, or final
  const state = p => { const s = +p.gameSecondsRemaining; return s >= 3600 ? 'pre' : s > 0 ? 'live' : 'final'; };
  const kick = iso => { const d = new Date(iso); return d.toLocaleDateString([], { weekday: 'short' }) + ' ' + d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }); };
  const clock = p => {
    const s = +p.gameSecondsRemaining, g = gameOf(p.id);
    if (s >= 3600) return g && g.state === 'pre' ? kick(g.date) : 'Yet to play';
    if (s <= 0) return 'Final';
    const q = Math.min(4, Math.floor((3600 - s) / 900) + 1), left = s - (4 - q) * 900;
    return `Q${q} ${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
  };
  // starters in lineup order: QB, RB, RB, WR, WR, TE, FLEX, DEF
  function lineup(f) {
    const st = (f.players.player || []).filter(p => p.status === 'starter');
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
  const extra = (f, kind) => ((rosters || {})[f.id] || {})[kind] ? rosters[f.id][kind].map(id => {
    const g = gameOf(id), secs = !g ? 0 : g.state === 'pre' ? 3600 : g.state === 'post' ? 0 : Math.max(1, (4 - Math.min(4, g.period || 1)) * 900 + (String(g.clock || '0:00').split(':').reduce((m, x) => m * 60 + (+x || 0), 0)));
    return { id, status: kind, score: null, gameSecondsRemaining: String(secs) };
  }) : [];
  const counts = f => ({ live: +f.playersCurrentlyPlaying || 0, pre: +f.playersYetToPlay || 0 });

  function body() {
    if (failed) return '<p class="error">The scoreboard didn’t load. Refresh the page to try again.</p>';
    if (!data) return '<p class="loading">Loading the scoreboard…</p>';
    const L = data.liveScoring, esc = X.esc;
    const tm = id => X.teams[id] || {};
    const seedOf = id => ((X.seeds || []).find(x => x.id === id) || {}).seed;
    const seed = id => seedOf(id) ? `<span class="lv-seed${seedOf(id) > 3 ? ' wc' : ''}" title="${seedOf(id)} seed if the season ended today">${seedOf(id)}</span>` : '';
    // record, place in the division and last-3 average (from the weekly league update)
    const ord = n => n + (['th', 'st', 'nd', 'rd'][(n % 100 > 10 && n % 100 < 14) ? 0 : (n % 10 < 4 ? n % 10 : 0)]);
    const stand = id => (X.standings || []).find(t => t.id === id);
    const l3 = id => { const sc = (X.games || []).filter(g => g[1] === id || g[3] === id).sort((x, y) => x[0] - y[0]).slice(-3).map(g => g[1] === id ? g[2] : g[4]);
      return sc.length ? n1(sc.reduce((x, y) => x + y, 0) / sc.length) : ''; };
    const meta = id => { const t = stand(id); if (!t) return '';
      return `${t.w}-${t.l}${t.t ? '-' + t.t : ''} · ${ord(t.divisionRank)} ${esc(t.divisionName || '')}${l3(id) ? ` · L3 ${l3(id)}` : ''}`; };
    // the week's highest and lowest scores, live
    const all = L.matchup.flatMap(m => m.franchise.map(f => +f.score)), hi = Math.max(...all), lo = Math.min(...all);
    const heat = f => +f.score === hi && hi > 0 ? '<span class="lv-heat" title="Highest score this week">🔥</span>' : +f.score === lo && hi > lo ? '<span class="lv-heat" title="Lowest score this week">🥶</span>' : '';
    const logo = id => tm(id).logo ? `<img class="lv-lg" src="${tm(id).logo}" alt="">` : `<span class="lv-lg">${esc(tm(id).abbr || '')}</span>`;
    const game = (m, gi) => {
      const fs = m.franchise.slice().sort((a, b) => (+a.isHome) - (+b.isHome));   // away on the left
      const [a, b] = fs, sa = +a.score, sb = +b.score, ca = counts(a), cb = counts(b);
      const done = !ca.live && !ca.pre && !cb.live && !cb.pre;
      const lead = sa === sb ? '' : sa > sb ? 'a' : 'b';
      const live = ca.live + cb.live, pre = ca.pre + cb.pre;
      const mid = done ? 'Final' : [live ? `${live} playing` : '', pre ? `${pre} to play` : ''].filter(Boolean).join(' · ');
      const key = `${a.id}-${b.id}`, isOpen = open.has(key);
      const side = (f, cls) => `<span class="lv-side ${cls}${lead === cls ? ' lead' : ''}">${logo(f.id)}<span class="lv-sc"><b>${cls === 'b' ? heat(f) : ''}${n1(+f.score)}${cls === 'a' ? heat(f) : ''}</b><small>${seed(f.id)}${esc(tm(f.id).abbr || '')}</small></span></span>`;
      const la = lineup(a), lb = lineup(b);
      // one player's two cells, mirrored on the right side: name | points  slot  points | name
      const cell = (p, cls) => {
        if (!p) { const nm = `<td class="lv-p ${cls} empty">—</td>`, pt = `<td class="lv-pts ${cls}"></td>`; return cls === 'a' ? nm + pt : pt + nm; }
        const st = state(p), ph = photo(p.id), inj = injTag(p.id);
        const tag = inj ? `<span class="lv-inj" title="${esc(inj.title)}">${inj.t}</span>` : '';
        const img = `<span class="lv-ph${pos(p.id) === 'DEF' ? ' def' : ''}">${ph ? `<img src="${ph}" alt="" loading="lazy" onerror="this.remove()">` : ''}</span>`;
        const nm = `<td class="lv-p ${cls} ${st}"><div class="lv-pc">${img}<span class="lv-who"><span class="lv-nm">${cls === 'b' ? tag : ''}${esc(short(p.id))}${cls === 'a' ? tag : ''}</span><small>${pos(p.id)} · ${esc(info(p.id).team || '')} · <span class="lv-st ${st}">${clock(p)}</span></small>${statLine(p.id) ? `<small class="lv-stat">${esc(statLine(p.id))}</small>` : ''}</span></div></td>`;
        const pt = `<td class="lv-pts ${cls} ${st}">${st === 'pre' || p.score == null ? '–' : n1(+p.score)}</td>`;
        return cls === 'a' ? nm + pt : pt + nm;
      };
      const rows = la.map((r, i) => { const o = lb[i] || {}; return `<tr>${cell(r.p, 'a')}<td class="lv-slot">${r.slot}</td>${cell(o.p, 'b')}</tr>`; }).join('');
      // bench, then taxi squad, then IR, each side listed in its own column
      const group = (xa, xb, lbl) => Array.from({ length: Math.max(xa.length, xb.length) }, (_, i) =>
        `<tr>${xa[i] ? cell(xa[i], 'a') : '<td></td><td></td>'}<td class="lv-slot">${lbl}</td>${xb[i] ? cell(xb[i], 'b') : '<td></td><td></td>'}</tr>`).join('');
      const benchRows = group(bench(a), bench(b), 'BN') + group(extra(a, 'taxi'), extra(b, 'taxi'), 'TX') + group(extra(a, 'ir'), extra(b, 'ir'), 'IR');
      const left = f => { const c = counts(f); return c.live || c.pre ? `${c.live ? `${c.live} playing` : ''}${c.live && c.pre ? ', ' : ''}${c.pre ? `${c.pre} to play` : ''}` : 'Done'; };
      return `<article class="card lv-g${isOpen ? ' open' : ''}" data-lv-key="${key}">
        <button type="button" class="lv-sum" data-lv="${key}" aria-expanded="${isOpen}">
          ${side(a, 'a')}<span class="lv-mid"><span class="lv-vs">vs</span><small>${mid}</small></span>${side(b, 'b')}
          <span class="lv-metarow"><small>${meta(a.id)}</small><small>${meta(b.id)}</small></span>
        </button>
        <div class="lv-det"${isOpen ? '' : ' hidden'}>
          <div class="lv-names"><b>${seed(a.id)}${esc(X.nameOf(a.id))}</b><b>${esc(X.nameOf(b.id))}${seed(b.id)}</b></div>
          <div class="lv-names lv-left"><small>${left(a)}</small><small>${left(b)}</small></div>
          <table class="lv-t"><tbody>${rows}</tbody></table>
          ${benchRows ? `<details class="lv-bench"${openBench.has(key) ? ' open' : ''} data-lv-bench="${key}"><summary>Bench, taxi squad and IR</summary><table class="lv-t"><tbody>${benchRows}</tbody></table></details>` : ''}
        </div></article>`;
    };
    const any = L.matchup.length;
    const t = stamp ? stamp.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' }) : '';
    const p = pace();
    const status = data.sample ? '<b>Sample data.</b> Live scores start once the relay is set up.'
      : !p ? `<b>Final.</b> Week ${esc(L.week)} is in the books.`
      : p === SLOW_MS ? `Updated ${t} · checks every 5 minutes until games start` : `Updated ${t} · refreshes every ${POLL_MS / 1000} seconds`;
    return `<div class="lv-bar"><span>${status}</span>
        <button type="button" class="lv-all" data-lv-all="${open.size === any ? 'close' : 'open'}">${open.size === any ? 'Collapse all' : 'Expand all'}</button></div>
      <div class="lv-list">${L.matchup.map(game).join('')}</div>`;
  }

  function render(ctx) {
    X = ctx;
    if (!data && !failed) load();
    poll();
    const wk = data ? data.liveScoring.week : '';
    return `<div class="pagehead"><h1>Scoreboard</h1><span class="asof">${wk ? `Week ${X.esc(wk)} · ` : ''}tap a game for both lineups and stats${(X.seeds || []).length ? ' · numbers by a team are playoff seeds if the season ended today' : ''}</span></div><div id="lv-root">${body()}</div>`;
  }

  document.addEventListener('toggle', e => {
    const d = e.target; if (!d.matches || !d.matches('[data-lv-bench]')) return;
    d.open ? openBench.add(d.dataset.lvBench) : openBench.delete(d.dataset.lvBench);
  }, true);
  document.addEventListener('click', e => {
    const all = e.target.closest('[data-lv-all]');
    if (all && data) {
      open.clear();
      if (all.dataset.lvAll === 'open') data.liveScoring.matchup.forEach(m => { const fs = m.franchise.slice().sort((a, b) => (+a.isHome) - (+b.isHome)); open.add(`${fs[0].id}-${fs[1].id}`); });
      paint(); return;
    }
    const b = e.target.closest('[data-lv]'); if (!b) return;
    const key = b.dataset.lv, g = b.closest('.lv-g'), on = !open.has(key);
    on ? open.add(key) : open.delete(key);
    g.classList.toggle('open', on); b.setAttribute('aria-expanded', on); g.querySelector('.lv-det').hidden = !on;
    const btn = document.querySelector('[data-lv-all]'), n = data.liveScoring.matchup.length;
    if (btn) { btn.dataset.lvAll = open.size === n ? 'close' : 'open'; btn.textContent = open.size === n ? 'Collapse all' : 'Expand all'; }
  });

  window.FBPLive = { render };
})();
