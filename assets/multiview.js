/* Sunday Ticket Helper (multiview planner): which three NFL games to put on screen (YouTube TV / Sunday Ticket multiview) so an FBP matchup
   has the most of its starters in view, window by window, with NFL RedZone as the fourth screen.
   For the week being played (or the next one, once the weekly update has the current week final):
     - each team's starters come from MFL's live scoring through the relay (LIVE_URL), so lineup changes show up
     - the NFL schedule (kickoffs, networks, byes) comes from ESPN's public scoreboard
   Sunday games are grouped into windows by Eastern kickoff time: international morning, early (1 PM ET),
   late (4 PM ET); Thursday, Saturday, Sunday night and Monday games stand alone.
   For each window the planner tries every set of three games and keeps the one that shows the most of the
   matchup's starters, then the one that's fairest to the weaker-covered side, then the one with more starters
   from around the league. Whoever isn't on those three screens is listed under RedZone. */
(function () {
  const LIVE_URL = 'https://fbp-live.pmiglio-gchat.workers.dev/';
  const ESPN = 'https://site.api.espn.com/apis/site/v2/sports/football/nfl/';
  const TEAM = { GBP: 'GB', KCC: 'KC', NEP: 'NE', NOS: 'NO', SFO: 'SF', TBB: 'TB', LVR: 'LV', JAC: 'JAX', WAS: 'WSH', LA: 'LAR' };
  const SCREENS = 3;
  let X = null, plan = null, failed = false, loading = false, players = null, links = null;
  let pick = '';   // matchup shown: '' = all, else "a-b"

  const getJSON = (u, o) => fetch(u, o).then(r => r.ok ? r.json() : Promise.reject(new Error(u)));
  const et = iso => {   // weekday and hour in US Eastern time
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'short', hour: 'numeric', hour12: false }).formatToParts(new Date(iso));
    const g = t => (parts.find(p => p.type === t) || {}).value;
    return { day: g('weekday'), hour: +g('hour') % 24 };
  };
  // network badges in each network's colors (text, not the networks' logos)
  const NET = [[/prime/i, 'Prime Video', 'pv'], [/nfl ?net/i, 'NFL Network', 'nfln'], [/espn/i, 'ESPN', 'espn'], [/abc/i, 'ABC', 'abc'], [/fox/i, 'FOX', 'fox'],
               [/cbs/i, 'CBS', 'cbs'], [/nbc|peacock/i, 'NBC', 'nbc'], [/netflix/i, 'Netflix', 'nflx'], [/youtube/i, 'YouTube', 'yt']];
  const nets = s => { const out = []; String(s || '').split('/').forEach(x => { const m = NET.find(([re]) => re.test(x)); const k = m ? m[2] : 'other';
    if (!out.some(o => o[0] === k)) out.push([k, m ? m[1] : x.trim()]); }); return out.filter(o => o[1]).map(([k, l]) => `<span class="mv-net ${k}">${l}</span>`).join(''); };
  const local = iso => { const d = new Date(iso); return d.toLocaleDateString([], { weekday: 'short' }) + ' ' + d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }); };

  function load() {
    if (loading) return; loading = true;
    const pl = players ? Promise.resolve(players) : getJSON('data/mfl/players.json').then(p => (players = Object.fromEntries(Object.entries(p.players).map(([k, v]) => [k, Object.fromEntries(p.fields.map((f, i) => [f, v[i]]))]))));
    const lk = links ? Promise.resolve(links) : getJSON('data/player-links.json').then(j => (links = j.links || {})).catch(() => (links = {}));
    getJSON(LIVE_URL, { cache: 'no-cache' }).then(cur => {
      const live = +cur.liveScoring.week, week = live <= (X.weeksPlayed || 0) ? live + 1 : live;
      return Promise.all([
        week === live ? cur : getJSON(`${LIVE_URL}?w=${week}`, { cache: 'no-cache' }),
        getJSON(ESPN + `scoreboard?seasontype=2&week=${week}&dates=${X.season}`),
        pl, lk,
      ]).then(([ls, sb]) => { plan = build(week, ls.liveScoring, sb); });
    }).catch(() => { failed = !plan; }).then(() => { loading = false; if (location.hash.startsWith('#scores/ticket')) X.rerender(); });
  }

  // the week's NFL games, the windows they fall in, and every FBP starter's game
  function build(week, ls, sb) {
    const games = (sb.events || []).map(ev => {
      const cs = ev.competitions[0].competitors, h = cs.find(c => c.homeAway === 'home'), a = cs.find(c => c.homeAway === 'away');
      const t = et(ev.date), net = ((ev.competitions[0].broadcasts || []).flatMap(b => b.names || [])).join('/');
      let win;
      if (t.day === 'Sun' && t.hour < 12) win = 'intl';
      else if (t.day === 'Sun' && t.hour < 16) win = 'early';
      else if (t.day === 'Sun' && t.hour < 19) win = 'late';
      else win = 'solo:' + ev.id;
      return { id: ev.id, date: ev.date, away: a.team.abbreviation, home: h.team.abbreviation, net, win, state: (ev.status && ev.status.type || {}).state };
    });
    const byTeam = {}; games.forEach(g => { byTeam[g.away] = g; byTeam[g.home] = g; });
    const byes = ((sb.week || {}).teamsOnBye || []).map(t => t.abbreviation);
    const matchups = (ls.matchup || []).map(m => m.franchise.slice().sort((a, b) => (+a.isHome) - (+b.isHome)).map(f => ({
      id: f.id, starters: ((f.players || {}).player || []).filter(p => p.status === 'starter').map(p => {
        const i = players[p.id] || {}, nfl = TEAM[i.team] || i.team || '';
        return { id: p.id, name: i.name || p.id, pos: i.position === 'Def' ? 'DEF' : (i.position || ''), nfl, game: byTeam[nfl] || null, bye: byes.includes(nfl) };
      }),
    })));
    return { week, games, byes, matchups };
  }

  // the best screens for a window: up to three games, most starters (of these FBP teams) first
  function best(win, sides, P) {
    const gs = P.games.filter(g => g.win === win);
    const count = (g, side) => side.starters.filter(s => s.game === g).length;
    const all = P.matchups.flat();
    const combos = [];
    const k = Math.min(SCREENS, gs.length);
    const rec = (start, cur) => { if (cur.length === k) { combos.push(cur.slice()); return; } for (let i = start; i < gs.length; i++) { cur.push(gs[i]); rec(i + 1, cur); cur.pop(); } };
    rec(0, []);
    const score = c => {
      const per = sides.map(sd => c.reduce((t, g) => t + count(g, sd), 0));
      const lg = c.reduce((t, g) => t + all.reduce((u, sd) => u + count(g, sd), 0), 0);
      return [per.reduce((a, b) => a + b, 0), sides.length > 1 ? Math.min(...per) : 0, lg, -c.reduce((t, g) => t + Date.parse(g.date), 0)];
    };
    const cmp = (a, b) => { for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return b[i] - a[i]; return 0; };
    combos.sort((a, b) => cmp(score(a), score(b)));
    const pickG = (combos[0] || []).slice().sort((a, b) => Date.parse(a.date) - Date.parse(b.date) || a.away.localeCompare(b.away));
    const inWin = sides.map(sd => sd.starters.filter(s => s.game && s.game.win === win));
    const redzone = inWin.map(l => l.filter(s => !pickG.includes(s.game)));
    return { games: pickG, inWin, redzone, total: gs.length };
  }

  function render(ctx) {
    X = ctx;
    const esc = X.esc;
    const head = `<div class="pagehead mv-head"><img class="mv-logo" src="assets/sunday-ticket.png" alt="NFL Sunday Ticket"><div><h1>Sunday Ticket Helper</h1><span class="asof">The three games to put on your multiview for each matchup, window by window. The fourth screen: NFL RedZone.</span></div></div>${X.nav || ''}`;
    if (failed) return head + '<p class="error">The Sunday Ticket Helper didn’t load. Refresh the page to try again.</p>';
    if (!plan) { load(); return head + '<p class="loading">Lining up the games…</p>'; }
    const P = plan, tm = id => X.teams[id] || {};
    const logo = id => tm(id).logo ? `<img class="mv-lg" src="${tm(id).logo}" alt="">` : '';
    const short = s => { const [last, first] = s.name.split(',').map(x => x.trim()); return s.pos === 'DEF' ? `${(first || last)} D` : first ? `${first[0]}. ${last}` : s.name; };
    const nfl = s => s.nfl ? `<img class="mv-nfl" src="https://a.espncdn.com/i/teamlogos/nfl/500/${s.nfl.toLowerCase()}.png" alt="${esc(s.nfl)}" title="${esc(s.nfl)}" loading="lazy" onerror="this.remove()">` : '';
    const who = (l, cls) => l.length ? `<ul class="mv-who ${cls}">${l.map(s => { const ps = `<span class="pos ${s.pos === 'DEF' ? '' : s.pos}">${s.pos}</span>`, nm = `<span class="mv-nm">${esc(short(s))}</span>`;
      return `<li>${cls === 'b' ? nfl(s) + nm + ps : ps + nm + nfl(s)}</li>`; }).join('')}</ul>` : `<ul class="mv-who ${cls} none"><li>—</li></ul>`;
    // every window in kickoff order: Thursday first, then Sunday's windows, Sunday night, Monday
    const soloName = g => { const t = et(g.date); return t.day === 'Thu' ? 'Thursday night' : t.day === 'Mon' ? 'Monday night' : t.day === 'Sun' ? 'Sunday night' : t.day === 'Sat' ? 'Saturday' : t.day; };
    const NAMES = { intl: 'International', early: 'Early games', late: 'Late games' };
    const wins = [...new Set(P.games.map(g => g.win))].map(w => ({ w, first: P.games.filter(g => g.win === w).sort((a, b) => Date.parse(a.date) - Date.parse(b.date))[0] }))
      .sort((a, b) => Date.parse(a.first.date) - Date.parse(b.first.date));
    const tile = (g, sides) => {
      const lists = sides.map(sd => sd.starters.filter(s => s.game === g));
      return `<div class="mv-tile${lists.some(l => l.length) ? '' : ' quiet'}"><div class="mv-g"><b>${g.away} @ ${g.home}</b><span class="mv-nets">${nets(g.net)}</span></div>
        ${sides.length === 2 ? `<div class="mv-sides">${who(lists[0], 'a')}${who(lists[1], 'b')}</div>` : `<div class="mv-cnt">${lists.flat().length} FBP starters</div>`}</div>`;
    };

    const block = sides => {
      const W = wins.map(({ w, first }) => {
        const solo = w.startsWith('solo:');
        const r = best(w, sides, P);
        const n = r.inWin.reduce((t, l) => t + l.length, 0);
        if (!n) return '';
        if (solo) return `<div class="mv-win"><h4>${soloName(first)} <small>${local(first.date)} · on its own</small></h4><div class="mv-tiles">${tile(first, sides)}</div></div>`;
        const rz = r.redzone.flat(), covered = n - rz.length;
        return `<div class="mv-win"><h4>${NAMES[w]} <small>${local(first.date)} · ${covered} of ${n} starters on screen${r.total > SCREENS ? ` · ${r.total} games in this window` : ''}</small></h4>
          <div class="mv-tiles">${r.games.map(g => tile(g, sides)).join('')}<div class="mv-tile rz"><div class="mv-g"><b>NFL RedZone</b><small>4th screen</small></div>
            ${sides.length === 2 ? (rz.length ? `<div class="mv-sides">${who(r.redzone[0], 'a')}${who(r.redzone[1], 'b')}</div><p class="mv-rzn">Not on the three screens</p>` : '<p class="mv-rzn">Everybody else is on screen</p>')
              : `<div class="mv-cnt">${rz.length ? `${rz.length} FBP starters elsewhere` : 'Everybody else is on screen'}</div>`}</div></div></div>`;
      }).join('');
      const bye = sides.flatMap(sd => sd.starters.filter(s => s.bye || !s.game).map(s => `${esc(short(s))} (${s.bye ? 'bye' : 'no game'})`));
      return W + (bye.length ? `<p class="mv-bye">Not playing: ${bye.join(', ')}</p>` : '');
    };

    const sel = `<label class="mv-sel">Matchup <select id="mv-pick"><option value="">All six games</option>${P.matchups.map(([a, b]) => `<option value="${a.id}-${b.id}"${pick === `${a.id}-${b.id}` ? ' selected' : ''}>${esc(X.nameOf(a.id))} vs ${esc(X.nameOf(b.id))}</option>`).join('')}</select></label>`;
    const cards = P.matchups.filter(([a, b]) => !pick || pick === `${a.id}-${b.id}`).map(([a, b]) => `<section class="card mv-m">
        <div class="mv-mh"><span class="mv-t">${logo(a.id)}<b>${esc(X.nameOf(a.id))}</b></span><span class="mv-vs">vs</span><span class="mv-t b"><b>${esc(X.nameOf(b.id))}</b>${logo(b.id)}</span></div>
        ${block([a, b])}</section>`).join('');
    return head + `<div class="mv-bar"><span>Week ${P.week} · lineups as set in MFL right now · times are yours</span>${sel}</div>${cards}
      <p class="rf-foot">Each window tries every set of three games and keeps the one with the most of the matchup's starters, then the one fairest to both teams, then the one with the most FBP starters overall. NFL schedule and networks from ESPN.</p>`;
  }

  document.addEventListener('change', e => {
    if (e.target && e.target.id === 'mv-pick') { pick = e.target.value; if (X) X.rerender(); }
  });
  window.FBPMultiview = { render };
})();
