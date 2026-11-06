/* League Now > Analytics (#now/analytics): this season's numbers behind the standings, from data/analytics.json
   (scripts/analytics.py). Lineups, luck, projections, lineup cost, salary value and playoff odds week by week. */
window.FBPAnalytics = (function () {
  let A = null, loading = false, failed = false, X = null;
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
  const SECS = [['lineups', 'Lineups'], ['luck', 'Luck'], ['proj', 'Projections'], ['cost', 'Lineup cost'], ['salary', 'Salary'], ['odds', 'Playoff odds']];

  function render(ctx) {
    X = ctx; load();
    if (failed) return '<p class="error">Analytics didn’t load. Refresh the page to try again.</p>';
    if (!A) return '<p class="loading">Loading analytics…</p>';
    const esc = ctx.esc, T = A.teams, ids = Object.keys(T);
    const tm = f => ctx.teams[f] || {};
    const lg = f => tm(f).logo ? `<img class="an-lg" src="${tm(f).logo}" alt="" loading="lazy">` : '<span class="an-lg"></span>';
    const ab = f => esc(tm(f).abbr || T[f].name);
    const nm = f => esc(T[f].name);
    // bars from zero, sorted; diverging bars around zero
    const bars = (key, fmt, sub, asc) => { const s = ids.filter(f => T[f][key] != null).sort((a, b) => asc ? T[a][key] - T[b][key] : T[b][key] - T[a][key]);
      const mx = Math.max(...s.map(f => T[f][key])) || 1;
      return `<div class="an-rows">${s.map(f => `<div class="an-r" title="${nm(f)}">${lg(f)}<span class="an-ab">${ab(f)}</span>
        <span class="an-trk"><span class="an-b" style="left:0;width:${100 * T[f][key] / mx}%"></span></span><span class="an-v">${fmt(T[f][key])}<small>${sub(T[f])}</small></span></div>`).join('')}</div>`; };
    const div = (key, sub) => { const s = ids.slice().sort((a, b) => T[b][key] - T[a][key]);
      const mx = Math.max(...s.map(f => Math.abs(T[f][key]))) || 1;
      return `<div class="an-rows">${s.map(f => { const v = T[f][key], w = 50 * Math.abs(v) / mx;
        return `<div class="an-r" title="${nm(f)}">${lg(f)}<span class="an-ab">${ab(f)}</span>
        <span class="an-trk"><span class="an-mid"></span><span class="an-b ${v < 0 ? 'n' : 'p'}" style="left:${v < 0 ? 50 - w : 50}%;width:${w}%"></span></span><span class="an-v">${sg(v)}<small>${sub(T[f])}</small></span></div>`; }).join('')}</div>`; };
    const key = (p, n) => `<div class="an-key"><span><i class="p"></i>${p}</span><span><i class="n"></i>${n}</span></div>`;
    const card = (id, title, why, body, wide) => `<section class="card an-card${wide ? ' wide' : ''}"${id ? ` id="an-${id}"` : ''}><h2>${title}</h2><p class="an-why">${why}</p>${body}</section>`;
    const pl = (r, extra) => `<td>${lg(r.fr)}${esc(r.name)} <span class="an-pos">${esc(r.pos)}</span></td>${extra}`;

    // lineup cost: where each team's starting dollars go, shaded by share of its lineup
    const POS = ['QB', 'RB', 'WR', 'TE', 'DEF'];
    const posTbl = `<div class="tbl-wrap"><table class="an-t an-heat"><thead><tr><th>Team</th>${POS.map(p => `<th class="n">${p}</th>`).join('')}<th class="n">Total</th></tr></thead><tbody>
      ${ids.slice().sort((a, b) => T[b].lineupCost - T[a].lineupCost).map(f => { const c = T[f].costPos || {}, tot = T[f].lineupCost || 1;
        return `<tr><td>${lg(f)}<span class="an-ab">${ab(f)}</span></td>${POS.map(p => { const v = c[p] || 0, sh = v / tot;
          return `<td class="n" style="--a:${Math.min(1, sh / 0.6).toFixed(2)}" title="${Math.round(100 * sh)}% of the lineup’s salary">${money(v)}</td>`; }).join('')}<td class="n"><b>${money(tot)}</b></td></tr>`; }).join('')}</tbody></table></div>`;
    const pr = A.pricier || [0, 0, 0], prN = pr[0] + pr[1] + pr[2];

    const odW = A.oddsWeeks || [];
    const spark = o => { const v = o.map(x => x == null ? null : x); const pts = v.map((x, i) => x == null ? null : [(i * 84 / Math.max(1, v.length - 1) + 3), (23 - x * 20 / 100)]).filter(Boolean);
      if (pts.length < 2) return '';
      const last = pts[pts.length - 1];
      return `<svg class="an-spark" viewBox="0 0 90 26" aria-hidden="true"><line x1="3" x2="87" y1="23" y2="23"/><polyline points="${pts.map(p => p.map(n => n.toFixed(1)).join(',')).join(' ')}"/><circle cx="${last[0].toFixed(1)}" cy="${last[1].toFixed(1)}" r="3"/></svg>`; };

    const cards = [
      card('lineups', 'Points left on the bench', 'The gap between what each team started and the best lineup it could have started. Shorter is better.',
        bars('left', f1, t => f1(t.eff) + '% of best', true)),
      card('', 'Costliest Sundays', 'The single weeks with the most points left on the bench.',
        `<div class="tbl-wrap"><table class="an-t"><thead><tr><th>Team</th><th class="n">Wk</th><th class="n">Started</th><th class="n">Best</th><th class="n">Left</th></tr></thead><tbody>
        ${(A.leftWeeks || []).map(([d, w, f, a, o]) => `<tr><td>${lg(f)}${nm(f)}</td><td class="n">${w}</td><td class="n">${f1(a)}</td><td class="n">${f1(o)}</td><td class="n"><b>${f1(d)}</b></td></tr>`).join('')}</tbody></table></div>`),
      card('luck', 'Luck: wins vs. expected', 'Actual wins minus the wins each team’s scoring would earn against an average schedule, from the all-play record.',
        div('luck', t => rec(t) + ' · exp ' + f1(t.xw)) + key('More wins than the points deserve', 'Fewer')),
      card('proj', 'Beating the projections', `Points from each team’s starters above or below what MFL projected for them, weeks 1–${A.through} combined.`,
        div('proj', t => f1(t.pf) + ' pts') + key('Starters outscored their projections', 'Fell short')),
      card('cost', 'Starting lineup cost', 'The average salary of each team’s starting lineup each week, and the points it returned per dollar.',
        bars('lineupCost', money, t => f2(t.ptsPerDollar) + ' pts per $', false)),
      card('', 'Where the lineup money goes', 'Average weekly salary started at each position. Darker cells are a bigger share of that team’s lineup.', posTbl),
      card('', 'Does the pricier lineup win?', 'Every game this season, the team that started more salary against the team that started less.',
        `<div class="an-hero"><b>${pr[0]}-${pr[1]}${pr[2] ? '-' + pr[2] : ''}</b><span>record of the pricier lineup${prN ? ` · ${Math.round(100 * (pr[0] + pr[2] / 2) / prN)}%` : ''}</span></div>
        <h3>Biggest bargain wins</h3><div class="tbl-wrap"><table class="an-t"><thead><tr><th>Wk</th><th>Winner</th><th class="n">Started</th><th>Loser</th><th class="n">Started</th></tr></thead><tbody>
        ${(A.cheapWins || []).map(([w, lo, lc, lp, hi, hc, hp]) => `<tr><td>${w}</td><td>${lg(lo)}<span class="an-ab">${ab(lo)}</span> ${f1(lp)}</td><td class="n">${money(lc)}</td><td>${lg(hi)}<span class="an-ab">${ab(hi)}</span> ${f1(hp)}</td><td class="n">${money(hc)}</td></tr>`).join('')}</tbody></table></div>`),
      card('', 'Cheapest and priciest points', 'Salary per point each time a player started, for players with 3 or more starts.',
        `<div class="an-two"><div><h3>Cheapest (10+ points a start)</h3><table class="an-t"><tbody>${(A.cheapStarters || []).map(r => `<tr>${pl(r, `<td class="n">${money(r.sal)}</td><td class="n">${f1(r.ppg)}/g</td><td class="n"><b>${f2(r.cpp)}</b></td>`)}</tr>`).join('')}</tbody></table></div>
        <div><h3>Priciest ($15+)</h3><table class="an-t"><tbody>${(A.priceyStarters || []).map(r => `<tr>${pl(r, `<td class="n">${money(r.sal)}</td><td class="n">${f1(r.ppg)}/g</td><td class="n"><b>${f2(r.cpp)}</b></td>`)}</tr>`).join('')}</tbody></table></div></div>
        <p class="an-note">Last column: dollars of salary per point per start. Lower is better.</p>`),
      card('salary', 'Points per payroll dollar', 'Points started this season for every dollar of each team’s current payroll.',
        bars('pfPerDollar', f2, t => money(t.payroll || 0) + ' payroll', false)),
      card('', 'Bargains and letdowns', 'Points on FBP rosters this season per dollar of salary.',
        `<div class="an-two"><div><h3>Best bargains ($5+)</h3><table class="an-t"><tbody>${(A.bargains || []).map(r => `<tr>${pl(r, `<td class="n">${money(r.sal)}</td><td class="n">${f1(r.pts)}</td><td class="n"><b>${f1(r.per)}</b>/$</td>`)}</tr>`).join('')}</tbody></table></div>
        <div><h3>Priciest letdowns ($20+)</h3><table class="an-t"><tbody>${(A.letdowns || []).map(r => `<tr>${pl(r, `<td class="n">${money(r.sal)}</td><td class="n">${f1(r.pts)}</td><td class="n"><b>${f1(r.per)}</b>/$</td>`)}</tr>`).join('')}</tbody></table></div></div>`),
      card('odds', 'Playoff odds, week by week', `Each team’s chance to make the playoffs after every week${odW.length ? ` since week ${odW[0]}` : ''}, from the 20,000-run simulation. The lines grow as the season goes.`,
        `<div class="tbl-wrap"><table class="an-t"><thead><tr><th>Team</th><th class="an-hs">Record</th><th>Trend</th><th class="n">Now</th><th class="n">Since wk ${odW[0] || ''}</th><th class="n">Close</th></tr></thead><tbody>
        ${ids.slice().sort((a, b) => (T[b].odds.slice(-1)[0] || 0) - (T[a].odds.slice(-1)[0] || 0)).map(f => { const o = T[f].odds, now = o[o.length - 1], d = (now || 0) - (o[0] || 0), c = T[f].close;
          return `<tr><td>${lg(f)}${nm(f)}</td><td class="an-hs">${rec(T[f])}</td><td>${spark(o)}</td><td class="n"><b>${f1(now)}%</b></td><td class="n ${d > 0 ? 'an-up' : d < 0 ? 'an-dn' : ''}">${d > 0 ? '▲' : d < 0 ? '▼' : ''} ${f1(Math.abs(d))}</td><td class="n">${c[0]}-${c[1]}${c[2] ? '-' + c[2] : ''}</td></tr>`; }).join('')}</tbody></table></div>
        <p class="an-note">Close: record in games decided by under 10 points.</p>`, true),
    ];
    return `<div class="an-jump">${SECS.map(([k, l]) => `<button type="button" data-an-jump="${k}">${l}</button>`).join('')}</div>
      <div class="an-grid">${cards.join('')}</div>
      <p class="rf-foot">Through week ${A.through}. Best lineups are MFL’s optimal lineup each week. Salaries are what each player is paid on his FBP roster now; players since dropped use their 2026 auction price or waiver bid.</p>`;
  }
  document.addEventListener('click', e => { const b = e.target.closest && e.target.closest('[data-an-jump]'); if (!b) return;
    const el = document.getElementById('an-' + b.dataset.anJump); if (!el) return;
    const top = el.getBoundingClientRect().top + window.scrollY - (parseInt(getComputedStyle(document.documentElement).getPropertyValue('--hdr-h')) || 0) - 10;
    window.scrollTo({ top, behavior: 'smooth' }); });
  return { render };
})();
