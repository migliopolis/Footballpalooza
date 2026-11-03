/* Scoreboard tab: this week's six games, live.
   Each game is one line (logo, score, vs, score, logo) that opens into both lineups, slot by slot.
   Data is MFL's liveScoring export. Browsers can't read MFL directly from this site, so it comes through a small
   Cloudflare Worker relay (LIVE_URL, code in relay/worker.js). With LIVE_URL empty the page shows a saved sample
   (data/live-sample.json).
   Player names, positions and NFL teams come from data/mfl/players.json. Stat lines, kickoff times and game clocks
   come from ESPN's public scoreboard and box scores (readable straight from the browser), matched by ESPN id
   (data/player-links.json). */
(function () {
  const LIVE_URL = 'https://fbp-live.pmiglio-gchat.workers.dev/';   // Cloudflare Worker relay (relay/worker.js)
  const POLL_MS = 15000;
  const SLOTS = ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'DEF'];
  let X = null, data = null, players = null, failed = false, loading = false, timer = null, stamp = null;
  const open = new Set();

  const n1 = v => (Math.round(v * 10) / 10).toFixed(1);
  function load() {
    if (loading) return;
    loading = true;
    const src = LIVE_URL || 'data/live-sample.json';
    Promise.all([
      fetch(src, { cache: 'no-cache' }).then(r => r.ok ? r.json() : null),
      players ? Promise.resolve(players) : fetch('data/mfl/players.json').then(r => r.ok ? r.json() : null),
      loadEspn(),
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
  const espnId = id => ((links && links[id]) || [])[0];
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
  function poll() {
    clearTimeout(timer);
    if (!LIVE_URL) return;
    timer = setTimeout(() => { if (location.hash.startsWith('#scores') && !document.hidden) load(); poll(); }, POLL_MS);
  }
  // redraw just the scoreboard (keeps scroll position and which games are open)
  function paint() {
    const el = document.getElementById('lv-root');
    if (el) el.innerHTML = body(); else if (X && location.hash.startsWith('#scores')) X.rerender();
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
  const counts = f => ({ live: +f.playersCurrentlyPlaying || 0, pre: +f.playersYetToPlay || 0 });

  function body() {
    if (failed) return '<p class="error">The scoreboard didn’t load. Refresh the page to try again.</p>';
    if (!data) return '<p class="loading">Loading the scoreboard…</p>';
    const L = data.liveScoring, esc = X.esc;
    const tm = id => X.teams[id] || {};
    const seedOf = id => ((X.seeds || []).find(x => x.id === id) || {}).seed;
    const seed = id => seedOf(id) ? `<span class="lv-seed" title="${seedOf(id)} seed if the season ended today">${seedOf(id)}</span>` : '';
    const logo = id => tm(id).logo ? `<img class="lv-lg" src="${tm(id).logo}" alt="">` : `<span class="lv-lg">${esc(tm(id).abbr || '')}</span>`;
    const game = (m, gi) => {
      const fs = m.franchise.slice().sort((a, b) => (+a.isHome) - (+b.isHome));   // away on the left
      const [a, b] = fs, sa = +a.score, sb = +b.score, ca = counts(a), cb = counts(b);
      const done = !ca.live && !ca.pre && !cb.live && !cb.pre;
      const lead = sa === sb ? '' : sa > sb ? 'a' : 'b';
      const live = ca.live + cb.live, pre = ca.pre + cb.pre;
      const mid = done ? 'Final' : [live ? `${live} playing` : '', pre ? `${pre} to play` : ''].filter(Boolean).join(' · ');
      const key = `${a.id}-${b.id}`, isOpen = open.has(key);
      const side = (f, cls) => `<span class="lv-side ${cls}${lead === cls ? ' lead' : ''}">${logo(f.id)}<span class="lv-sc"><b>${n1(+f.score)}</b><small>${seed(f.id)}${esc(tm(f.id).abbr || '')}</small></span></span>`;
      const la = lineup(a), lb = lineup(b);
      // one player's two cells, mirrored on the right side: name | points  slot  points | name
      const cell = (p, cls) => {
        if (!p) { const nm = `<td class="lv-p ${cls} empty">—</td>`, pt = `<td class="lv-pts ${cls}"></td>`; return cls === 'a' ? nm + pt : pt + nm; }
        const st = state(p);
        const nm = `<td class="lv-p ${cls} ${st}"><span class="lv-nm">${esc(short(p.id))}</span><small>${pos(p.id)} · ${esc(info(p.id).team || '')} · <span class="lv-st ${st}">${clock(p)}</span></small>${statLine(p.id) ? `<small class="lv-stat">${esc(statLine(p.id))}</small>` : ''}</td>`;
        const pt = `<td class="lv-pts ${cls} ${st}">${st === 'pre' ? '–' : n1(+p.score)}</td>`;
        return cls === 'a' ? nm + pt : pt + nm;
      };
      const rows = la.map((r, i) => { const o = lb[i] || {}; return `<tr>${cell(r.p, 'a')}<td class="lv-slot">${r.slot}</td>${cell(o.p, 'b')}</tr>`; }).join('');
      const ba = bench(a), bb = bench(b), bn = Math.max(ba.length, bb.length);
      const brow = i => `<tr>${ba[i] ? cell(ba[i], 'a') : '<td></td><td></td>'}<td class="lv-slot">BN</td>${bb[i] ? cell(bb[i], 'b') : '<td></td><td></td>'}</tr>`;
      const left = f => { const c = counts(f); return c.live || c.pre ? `${c.live ? `${c.live} playing` : ''}${c.live && c.pre ? ', ' : ''}${c.pre ? `${c.pre} to play` : ''}` : 'Done'; };
      return `<article class="card lv-g${isOpen ? ' open' : ''}" data-lv-key="${key}">
        <button type="button" class="lv-sum" data-lv="${key}" aria-expanded="${isOpen}">
          ${side(a, 'a')}<span class="lv-mid"><span class="lv-vs">vs</span><small>${mid}</small></span>${side(b, 'b')}
        </button>
        <div class="lv-det"${isOpen ? '' : ' hidden'}>
          <div class="lv-names"><b>${seed(a.id)}${esc(X.nameOf(a.id))}</b><b>${esc(X.nameOf(b.id))}${seed(b.id)}</b></div>
          <div class="lv-names lv-left"><small>${left(a)}</small><small>${left(b)}</small></div>
          <table class="lv-t"><tbody>${rows}</tbody></table>
          ${bn ? `<details class="lv-bench"><summary>Bench</summary><table class="lv-t"><tbody>${Array.from({ length: bn }, (_, i) => brow(i)).join('')}</tbody></table></details>` : ''}
        </div></article>`;
    };
    const any = L.matchup.length;
    const t = stamp ? stamp.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' }) : '';
    return `<div class="lv-bar"><span>${data.sample ? '<b>Sample data.</b> Live scores start once the relay is set up.' : `Updated ${t} · refreshes every ${POLL_MS / 1000} seconds`}</span>
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
