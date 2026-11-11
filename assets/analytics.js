/* League Now > Analytics (#now/analytics): this season's numbers behind the standings, from data/analytics.json
   (scripts/analytics.py). Lineups, luck, projections, lineup cost, salary value and playoff odds week by week.
   Every table sorts by tapping a column header; every bar chart flips order with its sort button.
   Each section folds closed by tapping its title, and the Collapse all button folds them all; which ones are
   closed is remembered on this device. */
window.FBPAnalytics = (function () {
  let A = null, loading = false, failed = false, X = null;
  const accF = { teams: new Set(), pos: '' };
  let accSeed = null;   // the default team last applied to the filter   // Projection accuracy filters: FBP teams (none picked = all) and a position
  const sorts = {};             // table or chart id -> [column, direction]; direction -1 is high to low
  let closed = new Set();
  try { closed = new Set(JSON.parse(localStorage.getItem('fbp-an-closed') || '[]')); } catch (e) {}
  const saveClosed = () => { try { localStorage.setItem('fbp-an-closed', JSON.stringify([...closed])); } catch (e) {} };
  function load() {
    if (A || loading) return;
    loading = true;
    fetch('data/analytics.json', { cache: 'no-cache' }).then(r => r.ok ? r.json() : Promise.reject())
      .then(j => { A = j; loading = false; if (X && X.rerender) X.rerender(); })
      .catch(() => { failed = true; loading = false; if (X && X.rerender) X.rerender(); });
  }
  const f1 = x => x == null ? '—' : (+x).toFixed(1);
  const f2 = x => x == null ? '—' : (+x).toFixed(2);
  const sg = x => (x > 0 ? '+' : x < 0 ? '−' : '') + Math.abs(x).toFixed(1);
  const money = x => '$' + Math.round(x);
  const rec = t => `${t.w}-${t.l}${t.t ? '-' + t.t : ''}`;
  const SECS = [['lineups', 'Lineups'], ['luck', 'Luck'], ['heatteams', 'Heat Check'], ['proj', 'Projections'], ['acc', 'Accuracy'], ['cost', 'Lineup cost'], ['salary', 'Salary'], ['odds', 'Playoff odds']];
  const CARDS = ['lineups', 'sundays', 'luck', 'heatteams', 'heatplayers', 'proj', 'acc', 'cost', 'costpos', 'pricier', 'points', 'salary', 'bargains', 'odds'];

  // a sortable table. cols: [key, label, class, sortValue(row), cell(row)]; text columns sort A to Z first
  function table(id, cols, rows, def, extraCls, limit) {
    if (!sorts[id]) sorts[id] = def;
    const [k, d] = sorts[id];
    const c = cols.find(x => x[0] === k) || cols[0];
    const sorted = rows.slice().sort((a, b) => { const x = c[3](a), y = c[3](b);
      return typeof x === 'string' ? d * x.localeCompare(y) : d * ((x == null ? -1e9 : x) - (y == null ? -1e9 : y)); });
    const th = col => { const on = col[0] === k, txt = rows.length && typeof col[3](rows[0]) === 'string';
      return `<th class="${col[2] || ''} an-sort" data-an-sort="${id}|${col[0]}" data-an-first="${txt ? 1 : -1}" aria-sort="${on ? (d < 0 ? 'descending' : 'ascending') : 'none'}">${col[1]}${on ? (d < 0 ? ' ▼' : ' ▲') : ''}</th>`; };
    // a column with a logo (col[5]) gets it in its own cell pinned to the left, so it stays put when the table slides
    return `<div class="tbl-wrap"><table class="an-t${extraCls ? ' ' + extraCls : ''}"><thead><tr>${cols.map(col => (col[5] ? '<th class="an-lgc"></th>' : '') + th(col)).join('')}</tr></thead><tbody>
      ${(limit ? sorted.slice(0, limit) : sorted).map(r => `<tr>${cols.map(col => (col[5] ? `<td class="an-lgc">${col[5](r)}</td>` : '') + col[4](r)).join('')}</tr>`).join('')}</tbody></table></div>`;
  }

  function render(ctx) {
    X = ctx; load();
    if ((ctx.myTeam || '') !== accSeed) { accSeed = ctx.myTeam || ''; accF.teams = new Set(accSeed ? [accSeed] : []); }
    if (failed) return '<p class="error">Analytics didn’t load. Refresh the page to try again.</p>';
    if (!A) return '<p class="loading">Loading analytics…</p>';
    const esc = ctx.esc, T = A.teams, ids = Object.keys(T);
    const tm = f => ctx.teams[f] || {};
    const lg = f => tm(f).logo ? `<img class="an-lg" src="${tm(f).logo}" alt="" loading="lazy">` : '<span class="an-lg"></span>';
    const ab = f => esc(tm(f).abbr || T[f].name);
    const nm = f => esc(T[f].name);
    const teamCell = f => `<td class="an-tm">${nm(f)}</td>`;
    const abCell = f => `<td class="an-tm"><span class="an-ab">${ab(f)}</span></td>`;
    // bars from zero, and diverging bars around zero; each flips order with its sort button
    const order = (id, key, best) => { if (!sorts[id]) sorts[id] = [key, best]; const d = sorts[id][1];
      return ids.filter(f => T[f][key] != null).sort((a, b) => d * (T[a][key] - T[b][key])); };
    const flip = (id, key, best, hi, lo) => { const d = (sorts[id] || [key, best])[1];
      return `<button type="button" class="an-flip" data-an-sort="${id}|${key}" data-an-best="${best}">${d < 0 ? hi + ' ▼' : lo + ' ▲'}</button>`; };
    const bars = (id, key, fmt, sub, best) => { const s = order(id, key, best), mx = Math.max(...s.map(f => T[f][key])) || 1;
      return `<div class="an-rows">${s.map(f => `<div class="an-r" title="${nm(f)}">${lg(f)}<span class="an-ab">${ab(f)}</span>
        <span class="an-trk"><span class="an-b" style="left:0;width:${100 * T[f][key] / mx}%"></span></span><span class="an-v">${fmt(T[f][key])}<small>${sub(T[f])}</small></span></div>`).join('')}</div>`; };
    const div = (id, key, sub) => { const s = order(id, key, -1), mx = Math.max(...s.map(f => Math.abs(T[f][key]))) || 1;
      return `<div class="an-rows">${s.map(f => { const v = T[f][key], w = 50 * Math.abs(v) / mx;
        return `<div class="an-r" title="${nm(f)}">${lg(f)}<span class="an-ab">${ab(f)}</span>
        <span class="an-trk"><span class="an-mid"></span><span class="an-b ${v < 0 ? 'n' : 'p'}" style="left:${v < 0 ? 50 - w : 50}%;width:${w}%"></span></span><span class="an-v">${sg(v)}<small>${sub(T[f])}</small></span></div>`; }).join('')}</div>`; };
    const key = (p, n) => `<div class="an-key"><span><i class="p"></i>${p}</span><span><i class="n"></i>${n}</span></div>`;
    const card = (id, title, why, body, opts) => { opts = opts || {}; const shut = closed.has(id);
      return `<section class="card an-card${opts.wide ? ' wide' : ''}${shut ? ' an-shut' : ''}" id="an-${id}">
        <div class="an-hd"><button type="button" class="an-tog" data-an-tog="${id}" aria-expanded="${!shut}"><span class="an-car" aria-hidden="true"></span><h2>${title}</h2></button>${opts.tool || ''}</div>
        <div class="an-bd"><p class="an-why">${why}</p>${body}</div></section>`; };
    const plCell = r => `<td class="an-tm">${esc(r.name)} <span class="an-pos">${esc(r.pos)}</span></td>`;
    const num = (v, fmt, bold) => `<td class="n">${bold ? '<b>' : ''}${fmt(v)}${bold ? '</b>' : ''}</td>`;

    // where the lineup money goes, shaded by each position's share of the team's lineup
    const POS = ['QB', 'RB', 'WR', 'TE', 'DEF'];
    const share = (f, p) => ((T[f].costPos || {})[p] || 0) / (T[f].lineupCost || 1);
    const posTbl = table('costpos', [
      ['team', 'Team', '', f => T[f].name, abCell, lg],
      ...POS.map(p => [p, p, 'n', f => (T[f].costPos || {})[p] || 0,
        f => `<td class="n" style="--a:${Math.min(1, share(f, p) / 0.6).toFixed(2)}" title="${Math.round(100 * share(f, p))}% of the lineup’s salary">${money((T[f].costPos || {})[p] || 0)}</td>`]),
      ['tot', 'Total', 'n', f => T[f].lineupCost, f => num(T[f].lineupCost, money, true)],
    ], ids, ['tot', -1], 'an-heat');
    const pr = A.pricier || [0, 0, 0], prN = pr[0] + pr[1] + pr[2];

    const odW = A.oddsWeeks || [];
    const spark = o => { const pts = o.map((x, i) => x == null ? null : [(i * 84 / Math.max(1, o.length - 1) + 3), (23 - x * 20 / 100)]).filter(Boolean);
      if (pts.length < 2) return '';
      const last = pts[pts.length - 1];
      return `<svg class="an-spark" viewBox="0 0 90 26" aria-hidden="true"><line x1="3" x2="87" y1="23" y2="23"/><polyline points="${pts.map(p => p.map(n => n.toFixed(1)).join(',')).join(' ')}"/><circle cx="${last[0].toFixed(1)}" cy="${last[1].toFixed(1)}" r="3"/></svg>`; };
    const oNow = f => T[f].odds[T[f].odds.length - 1];
    const oChg = f => (oNow(f) || 0) - (T[f].odds[0] || 0);
    const cl = f => T[f].close, clPct = f => { const c = cl(f), n = c[0] + c[1] + c[2]; return n ? (c[0] + c[2] / 2) / n : null; };

    const NFLE = { GBP: 'gb', KCC: 'kc', NEP: 'ne', NOS: 'no', SFO: 'sf', TBB: 'tb', LVR: 'lv', JAC: 'jax', WAS: 'wsh', LA: 'lar' };
    const nflLg = t => t && t !== 'FA' ? `<img class="an-nfl" src="https://a.espncdn.com/i/teamlogos/nfl/500/${NFLE[t] || t.toLowerCase()}.png" alt="${esc(t)}" title="${esc(t)}" loading="lazy">` : '<span class="an-pos">FA</span>';
    const HT = A.heatTeams || {}, HP = A.heatPts || {}, HW = A.heatWeeks || [];
    const HK = [['nuke', 'Nuc'], ['hot', 'Hot'], ['cold', 'Cold'], ['bust', 'Bust'], ['wp', 'WP']];
    const hwTxt = HW.length ? `${HW[0]}–${HW[HW.length - 1]}` : '';
    const ACC_ALL = A.acc || [];
    const ACC = ACC_ALL.filter(r => (!accF.teams.size || accF.teams.has(r.fr)) && (!accF.pos || r.pos === accF.pos));
    const accFilters = `<div class="an-accf"><div class="st-pick an-accpick" role="group" aria-label="FBP teams">${ids.map(f => `<button type="button" data-an-accteam="${f}" aria-pressed="${accF.teams.has(f)}" title="${esc((T[f] || {}).name || f)}">${tm(f).logo ? `<img src="${tm(f).logo}" alt="${esc(tm(f).abbr || f)}">` : esc(f)}</button>`).join('')}</div>
      <div class="seg an-accpos" role="group" aria-label="Position">${['', 'QB', 'RB', 'WR', 'TE', 'DEF'].map(k => `<button type="button" data-an-accpos="${k}" aria-pressed="${accF.pos === k}">${k || 'All'}</button>`).join('')}</div>
      ${accF.teams.size || accF.pos ? `<p class="an-accn">${ACC.length} of ${ACC_ALL.length} players · <button type="button" class="an-accclr" data-an-accclr>Clear</button></p>` : ''}</div>`;
    const accCols = [['name', 'Player', '', r => r.name, plCell, r => r.fr ? lg(r.fr) : '<span class="an-lg an-fa">FA</span>'],
      ['g', 'G', 'n', r => r.g, r => num(r.g, String)], ['pj', 'Proj', 'n', r => r.pj, r => num(r.pj, f1)], ['sc', 'Actual', 'n', r => r.sc, r => num(r.sc, f1)],
      ['mae', 'Miss', 'n', r => r.mae, r => num(r.mae, f1, true)],
      ['bias', 'Vs. proj', 'n', r => r.bias, r => `<td class="n ${r.bias > 0 ? 'an-up' : r.bias < 0 ? 'an-dn' : ''}">${sg(r.bias)}</td>`],
      ['hit', 'Within 25%', 'n', r => r.hit, r => num(r.hit, x => x + '%')]];
    // average projection (x) against average actual (y), with the "as projected" diagonal
    const accChart = () => { if (!ACC.length) return accFilters + '<p class="loading">No players match these filters.</p>';
      const mx = Math.ceil(Math.max(...ACC_ALL.map(r => Math.max(r.pj, r.sc))) / 5) * 5, W = 560, H = 300, pl = 36, pb = 30, pt = 8, pr = 10;
      const x = v => pl + (W - pl - pr) * v / mx, y = v => pt + (H - pt - pb) * (1 - v / mx);
      const ticks = Array.from({ length: mx / 5 + 1 }, (_, i) => i * 5);
      const top = new Set(ACC.slice().sort((a, b) => Math.abs(b.bias) - Math.abs(a.bias)).slice(0, ACC.length <= 10 ? 10 : 4).map(r => r.id));
      return accFilters + `<svg class="an-sc" viewBox="0 0 ${W} ${H}" role="img" aria-label="Average projection against average points">
        ${ticks.map(t => `<line class="g" x1="${x(0)}" x2="${x(mx)}" y1="${y(t)}" y2="${y(t)}"/><text class="ax" x="${pl - 6}" y="${y(t) + 4}" text-anchor="end">${t}</text><text class="ax" x="${x(t)}" y="${H - 12}" text-anchor="middle">${t}</text>`).join('')}
        <line class="dg" x1="${x(0)}" y1="${y(0)}" x2="${x(mx)}" y2="${y(mx)}"/>
        <text class="ax" x="${(pl + W - pr) / 2}" y="${H - 1}" text-anchor="middle">average projection</text>
        ${ACC.map(r => `<circle class="${r.bias >= 0 ? 'p' : 'n'}" cx="${x(r.pj).toFixed(1)}" cy="${y(r.sc).toFixed(1)}" r="5"><title>${esc(r.name)} (${r.pos}): projected ${f1(r.pj)}, scored ${f1(r.sc)} a game · miss ${f1(r.mae)}</title></circle>`).join('')}
        ${ACC.filter(r => top.has(r.id)).map((r, i) => `<text class="lb" x="${(x(r.pj) + 7).toFixed(1)}" y="${(y(r.sc) + (i % 2 ? 12 : -4)).toFixed(1)}">${esc(r.name.split(' ').slice(-1)[0])}</text>`).join('')}
      </svg>${key('Beat his projections', 'Fell short')}`; };
    const playerTbl = (id, rows, def, cols) => table(id, [['name', 'Player', '', r => r.name, plCell, r => lg(r.fr)], ...cols], rows, def);

    const cards = [
      card('lineups', 'Points left on the bench', 'The gap between what each team started and the best lineup it could have started. Shorter is better.',
        bars('lineups', 'left', f1, t => f1(t.eff) + '% of best', 1), { tool: flip('lineups', 'left', 1, 'Most', 'Fewest') }),
      card('sundays', 'Costliest Sundays', 'The single weeks with the most points left on the bench.',
        table('sundays', [
          ['team', 'Team', '', r => T[r[2]].name, r => teamCell(r[2]), r => lg(r[2])],
          ['wk', 'Wk', 'n', r => r[1], r => num(r[1], String)],
          ['act', 'Started', 'n', r => r[3], r => num(r[3], f1)],
          ['opt', 'Best', 'n', r => r[4], r => num(r[4], f1)],
          ['left', 'Left', 'n', r => r[0], r => num(r[0], f1, true)],
        ], A.leftWeeks || [], ['left', -1])),
      card('luck', 'Luck: wins vs. expected', 'Actual wins minus the wins each team’s scoring would earn against an average schedule, from the all-play record.',
        div('luck', 'luck', t => rec(t) + ' · exp ' + f1(t.xw)) + key('More wins than the points deserve', 'Fewer'), { tool: flip('luck', 'luck', -1, 'Luckiest', 'Unluckiest') }),
      card('heatteams', 'Heat Check: teams', `How often each team’s starters went Nuclear, Hot, Cold, Bust or into Witness Protection (no points), weeks ${hwTxt}. Heat Score: Nuclear +${HP.nuke}, Hot +${HP.hot}, Cold ${HP.cold}, Bust ${HP.bust}, Witness Protection ${HP.wp}.`,
        table('heatteams', [
          ['team', 'Team', '', f => T[f].name, abCell, lg],
          ...HK.map(([k, l]) => [k, l, 'n', f => HT[f][k], f => `<td class="n hc-c ${k}">${HT[f][k] || '·'}</td>`]),
          ['score', 'Heat', 'n', f => HT[f].score, f => `<td class="n"><b class="${HT[f].score > 0 ? 'hc-pos' : HT[f].score < 0 ? 'hc-neg' : ''}">${HT[f].score > 0 ? '+' : ''}${HT[f].score}</b></td>`],
        ], ids.filter(f => HT[f]), ['score', -1])),
      card('heatplayers', 'Heat Check: players', 'Every player’s Nuclear, Hot, Cold, Bust and Witness Protection games this season, wherever he played, and his Heat Score. Tap a column to sort; the top 25 show.',
        table('heatplayers', [
          ['name', 'Player', '', r => r.n, r => `<td class="an-tm">${esc(r.n)} <span class="an-pos">${esc(r.p)}</span></td>`, r => r.fr ? lg(r.fr) : '<span class="an-lg an-fa">FA</span>'],
          ['g', 'G', 'n', r => r.g, r => num(r.g, String)],
          ['nfl', 'NFL', 'an-nflc', r => r.t || '', r => `<td class="an-nflc">${nflLg(r.t)}</td>`],
          ...HK.map(([k, l], i) => [k, l, 'n', r => r.c[i], r => `<td class="n hc-c ${k}">${r.c[i] || '·'}</td>`]),
          ['score', 'Heat', 'n', r => r.s, r => `<td class="n"><b class="${r.s > 0 ? 'hc-pos' : r.s < 0 ? 'hc-neg' : ''}">${r.s > 0 ? '+' : ''}${r.s}</b></td>`],
          ['wk', 'Weeks', 'an-hs', r => r.s, r => `<td class="an-hs"><span class="hc-row">${[...r.w].map((c, i) => `<i class="${({ N: 'nuke', H: 'hot', C: 'cold', B: 'bust', W: 'wp', '-': 'off' })[c] || ''}" title="Week ${HW[i]}"></i>`).join('')}</span></td>`],
        ], Object.values(A.heatPlayers || {}), ['score', -1], '', 25), { wide: true }),
      card('proj', 'Beating the projections', `Points from each team’s starters above or below what MFL projected for them, weeks 1–${A.through} combined.`,
        div('proj', 'proj', t => f1(t.pf) + ' pts') + key('Starters outscored their projections', 'Fell short'), { tool: flip('proj', 'proj', -1, 'Most', 'Least') }),
      card('acc', 'Projection accuracy', 'How close each player lands to his weekly MFL projection, for players projected for 8+ points a game on average with 5 or more games. Each dot is a player: above the line he’s beaten his projections, below he’s fallen short.',
        accChart() + `<h3>Closest to his projections</h3>` + table('accbest', accCols, ACC, ['mae', 1], '', 10) +
        `<h3>Least predictable</h3>` + table('accworst', accCols, ACC, ['mae', -1], '', 10) +
        `<p class="an-note">Miss: his average gap from the projection, either way. Vs. proj: on average above (+) or below (−) it. Within 25%: share of games he landed within a quarter of his projection.</p>`, { wide: true }),
      card('cost', 'Starting lineup cost', 'The average salary of each team’s starting lineup each week, and the points it returned per dollar.',
        bars('cost', 'lineupCost', money, t => f2(t.ptsPerDollar) + ' pts per $', -1), { tool: flip('cost', 'lineupCost', -1, 'Priciest', 'Cheapest') }),
      card('costpos', 'Where the lineup money goes', 'Average weekly salary started at each position. Darker cells are a bigger share of that team’s lineup.', posTbl),
      card('pricier', 'Does the pricier lineup win?', 'Every game this season, the team that started more salary against the team that started less.',
        `<div class="an-hero"><b>${pr[0]}-${pr[1]}${pr[2] ? '-' + pr[2] : ''}</b><span>record of the pricier lineup${prN ? ` · ${Math.round(100 * (pr[0] + pr[2] / 2) / prN)}%` : ''}</span></div>
        <h3>Biggest bargain wins</h3>` + table('cheapwins', [
          ['wk', 'Wk', '', r => r[0], r => `<td>${r[0]}</td>`],
          ['win', 'Winner', '', r => T[r[1]].name, r => `<td class="an-tm">${lg(r[1])}<span class="an-ab">${ab(r[1])}</span> ${f1(r[3])}</td>`],
          ['wc', 'Started', 'n', r => r[2], r => num(r[2], money)],
          ['lose', 'Loser', '', r => T[r[4]].name, r => `<td class="an-tm">${lg(r[4])}<span class="an-ab">${ab(r[4])}</span> ${f1(r[6])}</td>`],
          ['lc', 'Started', 'n', r => r[5], r => num(r[5], money)],
          ['gap', 'Gap', 'n', r => r[5] - r[2], r => num(r[5] - r[2], money, true)],
        ], A.cheapWins || [], ['gap', -1])),
      card('points', 'Cheapest and priciest points', 'Salary per point each time a player started, for players with 3 or more starts.',
        `<h3>Cheapest (10+ points a start)</h3>` + playerTbl('cheapst', A.cheapStarters || [], ['cpp', 1], [
          ['sal', 'Salary', 'n', r => r.sal, r => num(r.sal, money)], ['ppg', 'Pts/start', 'n', r => r.ppg, r => num(r.ppg, f1)],
          ['cpp', '$/pt', 'n', r => r.cpp, r => num(r.cpp, f2, true)]]) +
        `<h3>Priciest ($15+)</h3>` + playerTbl('pricest', A.priceyStarters || [], ['cpp', -1], [
          ['sal', 'Salary', 'n', r => r.sal, r => num(r.sal, money)], ['ppg', 'Pts/start', 'n', r => r.ppg, r => num(r.ppg, f1)],
          ['cpp', '$/pt', 'n', r => r.cpp, r => num(r.cpp, f2, true)]]) +
        `<p class="an-note">$/pt: dollars of salary per point per start. Lower is better.</p>`),
      card('salary', 'Points per payroll dollar', 'Points started this season for every dollar of each team’s current payroll.',
        bars('salary', 'pfPerDollar', f2, t => money(t.payroll || 0) + ' payroll', -1), { tool: flip('salary', 'pfPerDollar', -1, 'Most', 'Fewest') }),
      card('bargains', 'Bargains and letdowns', 'Points on FBP rosters this season per dollar of salary.',
        `<h3>Best bargains ($5+)</h3>` + playerTbl('barg', A.bargains || [], ['per', -1], [
          ['sal', 'Salary', 'n', r => r.sal, r => num(r.sal, money)], ['pts', 'Pts', 'n', r => r.pts, r => num(r.pts, f1)],
          ['per', 'Pts/$', 'n', r => r.per, r => num(r.per, f1, true)]]) +
        `<h3>Priciest letdowns ($20+)</h3>` + playerTbl('letd', A.letdowns || [], ['per', 1], [
          ['sal', 'Salary', 'n', r => r.sal, r => num(r.sal, money)], ['pts', 'Pts', 'n', r => r.pts, r => num(r.pts, f1)],
          ['per', 'Pts/$', 'n', r => r.per, r => num(r.per, f1, true)]])),
      card('odds', 'Playoff odds, week by week', `Each team’s chance to make the playoffs after every week${odW.length ? ` since week ${odW[0]}` : ''}, from the 20,000-run simulation. The lines grow as the season goes.`,
        table('odds', [
          ['team', 'Team', '', f => T[f].name, teamCell, lg],
          ['rec', 'Record', 'an-hs', f => T[f].w + T[f].t / 2, f => `<td class="an-hs">${rec(T[f])}</td>`],
          ['trend', 'Trend', '', oChg, f => `<td>${spark(T[f].odds)}</td>`],
          ['now', 'Now', 'n', oNow, f => num(oNow(f), x => f1(x) + '%', true)],
          ['chg', `Since wk ${odW[0] || ''}`, 'n', oChg, f => { const d = oChg(f); return `<td class="n ${d > 0 ? 'an-up' : d < 0 ? 'an-dn' : ''}">${d > 0 ? '▲' : d < 0 ? '▼' : ''} ${f1(Math.abs(d))}</td>`; }],
          ['close', 'Close', 'n', clPct, f => { const c = cl(f); return `<td class="n">${c[0]}-${c[1]}${c[2] ? '-' + c[2] : ''}</td>`; }],
        ], ids, ['now', -1]) + `<p class="an-note">Close: record in games decided by under 10 points.</p>`, { wide: true }),
    ];
    const allShut = CARDS.every(c => closed.has(c));
    return `<div class="an-jump"><button type="button" class="an-all" data-an-all="${allShut ? 'open' : 'close'}">${allShut ? 'Expand all' : 'Collapse all'}</button>
      ${SECS.map(([k, l]) => `<button type="button" data-an-jump="${k}">${l}</button>`).join('')}</div>
      <div class="an-grid">${cards.join('')}</div>
      <p class="rf-foot">Through week ${A.through}. Tap a column header to sort a table, and a section’s title to fold it. Best lineups are MFL’s optimal lineup each week. Salaries are what each player is paid on his FBP roster now; players since dropped use their 2026 auction price or waiver bid.</p>`;
  }

  const redraw = () => { const y = window.scrollY; if (X && X.rerender) { X.rerender(); window.scrollTo(0, y); } };
  document.addEventListener('click', e => {
    const t = e.target.closest ? e.target : null; if (!t) return;
    const s = t.closest('[data-an-sort]');
    if (s) { const [id, k] = s.dataset.anSort.split('|'), cur = sorts[id];
      if (s.dataset.anBest != null) sorts[id] = [k, -((cur || [k, +s.dataset.anBest])[1])];   // a chart's flip button
      else sorts[id] = cur && cur[0] === k ? [k, -cur[1]] : [k, +s.dataset.anFirst];
      return redraw(); }
    const at = t.closest('[data-an-accteam]');
    if (at) { const f = at.dataset.anAccteam; accF.teams.has(f) ? accF.teams.delete(f) : accF.teams.add(f); return redraw(); }
    const ap = t.closest('[data-an-accpos]');
    if (ap) { accF.pos = ap.dataset.anAccpos; return redraw(); }
    if (t.closest('[data-an-accclr]')) { accF.teams.clear(); accF.pos = ''; return redraw(); }
    const g = t.closest('[data-an-tog]');
    if (g) { const id = g.dataset.anTog, sec = g.closest('.an-card');
      if (closed.has(id)) closed.delete(id); else closed.add(id);
      saveClosed();
      sec.classList.toggle('an-shut', closed.has(id)); g.setAttribute('aria-expanded', String(!closed.has(id)));
      const all = document.querySelector('[data-an-all]');
      if (all) { const shut = CARDS.every(c => closed.has(c)); all.dataset.anAll = shut ? 'open' : 'close'; all.textContent = shut ? 'Expand all' : 'Collapse all'; }
      return; }
    const a = t.closest('[data-an-all]');
    if (a) { if (a.dataset.anAll === 'close') CARDS.forEach(c => closed.add(c)); else closed.clear(); saveClosed(); return redraw(); }
    const j = t.closest('[data-an-jump]');
    if (j) { const k = j.dataset.anJump, el = document.getElementById('an-' + k); if (!el) return;
      if (closed.has(k)) { closed.delete(k); saveClosed(); el.classList.remove('an-shut'); const b = el.querySelector('[data-an-tog]'); if (b) b.setAttribute('aria-expanded', 'true'); }
      const top = el.getBoundingClientRect().top + window.scrollY - (parseInt(getComputedStyle(document.documentElement).getPropertyValue('--hdr-h')) || 0) - 10;
      window.scrollTo({ top, behavior: 'smooth' }); }
  });
  return { render };
})();
