/* Awards tab: All-FBP teams and season awards, from data/awards.json (scripts/awards.py).
   Points are starter points only (scored in an FBP starting lineup), rostered players only. */
window.FBPAwards = (() => {
  let A = null, loading = false, failed = false, X, potw = null;   // potw: week picked for Player of the Week
  let year = null;                                     // null = this season; else a past season's year
  const past = {}, pastLoading = {}, pastFailed = {};  // past seasons load on demand from data/awards/<year>.json
  const loadPast = (y, rerender) => {
    if (past[y] || pastLoading[y]) return; pastLoading[y] = true;
    fetch(`data/awards/${y}.json`, { cache: 'no-cache' }).then(r => { if (!r.ok) throw 0; return r.json(); })
      .then(d => { past[y] = d; pastLoading[y] = false; rerender(); }).catch(() => { pastFailed[y] = true; pastLoading[y] = false; rerender(); });
  };
  const esc = s => X.esc(s == null ? '' : s);
  const load = rerender => {
    if (A || loading) return; loading = true;
    fetch('data/awards.json', { cache: 'no-cache' }).then(r => { if (!r.ok) throw 0; return r.json(); })
      .then(d => { A = d; rerender(); }).catch(() => { failed = true; rerender(); });
  };
  const tlogo = (id, cls = '') => { const t = X.teams[id]; return t && t.logo ? `<img class="${cls}" src="${t.logo}" alt="" loading="lazy">` : ''; };
  const tname = id => X.nameOf(id);
  const media = () => window.FBP && FBP.media;
  // player photo from ESPN; defenses use their NFL logo; anything missing falls back to the FBP team logo
  function photo(p, size = 'lg') {
    const m = media();
    const src = p.pos === 'DEF' ? (m ? m.nflLogo(p.nfl) : '') : (p.espn && m ? m.headshot(p.espn) : '');
    const fb = (X.teams[p.team] || {}).logo || '';
    return `<span class="aw-ph ${size}${p.pos === 'DEF' ? ' def' : ''}">${src ? `<img src="${src}" alt="" loading="lazy" onerror="this.onerror=null;${fb ? `this.src='${fb}';this.parentNode.classList.add('fb')` : 'this.remove()'}">` : (fb ? `<img src="${fb}" alt="" class="fbimg">` : '')}${tlogo(p.team, 'aw-badge')}${p.champ ? trophy(p) : ''}</span>`;
  }
  // won the title that season: trophy opposite the team badge
  const trophy = p => `<span class="aw-trophy" role="img" aria-label="Champion" title="Won the ${esc((S || A).season)} title${p.champTeam && p.champTeam !== p.team ? ' with ' + esc(tname(p.champTeam)) : ''}">🏆</span>`;
  const n1 = v => v == null ? '—' : Number(v).toFixed(1);
  const sal = p => p.salary != null ? `$${Math.round(p.salary)}` : '—';
  const pos = p => p.pos ? `<span class="pos ${p.pos === 'DEF' ? 'DEF' : p.pos}">${p.pos}</span>` : '';

  // All-FBP selections to date (that season and the ones before it, from the first season with data)
  function honors(p) {
    const h = p.honors; if (!h) return '';
    const n = h.first + h.second;
    const txt = n === 1 ? 'First All-FBP selection' : [h.first ? `<span>${h.first}× 1st Team</span>` : '', h.second ? `<span>${h.second}× 2nd Team</span>` : ''].filter(Boolean).join('');
    return `${mvpTag(p, true)}<span class="aw-hon${n === 1 ? ' new' : ''}" title="All-FBP selections since ${esc(A.honorsFrom || '')}">${txt}</span>`;
  }
  // FBP MVPs to date (finished seasons only)
  const mvpTag = (p, block) => p.mvps && p.mvps.length ? `<span class="aw-mvp${block ? ' blk' : ''}" title="FBP MVP ${esc(p.mvps.join(', '))}">${p.mvps.length > 1 ? p.mvps.length + '× ' : ''}MVP${p.mvps.length === 1 ? ' ' + esc(p.mvps[0]) : ''}</span>` : '';
  const cup = p => p.champ ? ' <span class="aw-cup" role="img" aria-label="Champion" title="Won the title that season">🏆</span>' : '';
  // this season: what changed on this spot since the last weekly update
  const change = p => p.change && !S.final ? `<span class="aw-chg ${p.change.dir}" title="Since week ${esc(p.change.since)}">${{ up: '▲', down: '▼', new: '●' }[p.change.dir] || ''} ${esc(p.change.text)}</span>` : '';
  function card(slot, p, second) {
    return `<div class="card aw-card${second ? ' second' : ''}"><span class="aw-slot">${slot}</span>${photo(p, second ? 'md' : 'lg')}
      <b class="aw-nm">${esc(p.name)}</b><span class="aw-sub">${pos(p)} ${esc(p.nfl || '')}${p.rookie ? ' · <i>Rookie</i>' : ''}</span>
      <span class="aw-fbp">${tlogo(p.team)}${esc(tname(p.team))}</span>${honors(p)}${change(p)}
      <span class="aw-stats"><span><b>${n1(p.pts)}</b>pts</span><span><b>${n1(p.ppg)}</b>per start</span><span><b>${sal(p)}</b>salary</span></span></div>`;
  }
  // one award: the winner big, the next two below
  // MFL pick codes: FP_<team>_<year>_<round> is a future pick; DP_<round>_<pick> (zero-based) is this year's rookie draft
  const ord = n => n + (['th', 'st', 'nd', 'rd'][(n % 100 > 10 && n % 100 < 14) ? 0 : n % 10] || 'th');
  function pickName(k) {
    let m = /^FP_(\d+)_(\d+)_(\d+)$/.exec(k);
    if (m) return `${m[2]} ${ord(+m[3])}-round pick (${(X.teams[m[1]] || {}).abbr || m[1]})`;
    m = /^DP_(\d+)_(\d+)$/.exec(k);
    if (m) return `${S.season} rookie pick ${+m[1] + 1}.${String(+m[2] + 1).padStart(2, '0')}`;
    return k;
  }
  function award(a) {
    let body = '', picker = '';
    if (a.weeks) {   // Player of the Week: buttons for every week, latest first
      const ws = Object.keys(a.weeks).map(Number).sort((x, y) => x - y);
      const w = ws.includes(potw) ? potw : a.week;
      a = Object.assign({}, a, { list: a.weeks[w], title: `Player of Week ${w}` });
      picker = `<div class="aw-weeks" role="group" aria-label="Week">${ws.map(n => `<button type="button" data-aw-week="${n}" aria-pressed="${n === w}">${n}</button>`).join('')}</div>`;
    }
    if (a.list) {
      const [w, ...rest] = a.list;
      const extra = p => p.perDollar != null ? `${n1(p.perDollar)} pts per $` : p.bid != null ? `${p.how}${p.how === 'FAAB' ? ' $' + Math.round(p.bid) : ''}` : p.week ? `Week ${p.week}` : `${p.starts} starts`;
      body = `<div class="aw-win">${photo(w, 'md')}<div><b>${esc(w.name)}</b>${mvpTag(w)}<span class="aw-sub">${pos(w)} ${esc(w.nfl || '')} · ${tlogo(w.team, 'mini')}${esc(tname(w.team))}</span>
        <span class="aw-big">${n1(w.pts)} <small>pts${a.key === 'value' || a.key === 'contract' ? ` · ${sal(w)}` : ''}</small></span><span class="aw-sub">${extra(w)}</span></div></div>
        ${rest.length ? `<ol class="aw-rest" start="2">${rest.map(p => `<li>${tlogo(p.team, 'mini')}<span>${esc(p.name)} <small>${p.pos}</small>${cup(p)}${mvpTag(p)}</span><b>${n1(p.pts)}</b><small>${extra(p)}</small></li>`).join('')}</ol>` : ''}`;
    } else if (a.teams) {
      const [w, ...rest] = a.teams;
      body = `<div class="aw-win team">${tlogo(w.team, 'aw-tlogo')}<div><b>${esc(tname(w.team))}</b><span class="aw-big">${esc(w.stat)}</span><span class="aw-sub">${esc(w.sub)}</span></div></div>
        <ol class="aw-rest" start="2">${rest.map(t => `<li>${tlogo(t.team, 'mini')}<span>${esc(tname(t.team))}</span><b>${esc(t.stat)}</b><small>${esc(t.sub)}</small></li>`).join('')}</ol>`;
    } else if (a.trade) {
      const side = (s, won) => `<div class="aw-side${won ? ' won' : ''}"><div class="aw-sideh">${tlogo(s.team, 'mini')}<b>${esc(tname(s.team))}</b><span>${n1(s.pts)} pts</span></div>
        <ul>${s.players.map(p => `<li>${esc(p.name)}${cup(p)} <small>${p.pos} · ${n1(p.pts)}</small></li>`).join('')}${s.picks.map(k => `<li class="pk">${esc(pickName(k))}</li>`).join('')}</ul></div>`;
      const deal = t => `<div class="aw-trade">${side(t.winner, true)}${side(t.loser, false)}</div><p class="aw-sub">Edge: ${n1(t.margin)} pts to ${esc(tname(t.winner.team))}</p>`;
      body = `<p class="aw-sub">What each side received, and its starter points since:</p>${deal(a.trade)}` +
        (a.more && a.more.length ? a.more.map((t, i) => `<div class="aw-more"><span class="aw-rank">${i + 2}</span>${deal(t)}</div>`).join('') : '');
    }
    return `<section class="card aw-award"><h3>${esc(a.title)}</h3><p class="aw-why">${esc(a.why)}</p>${picker}${body}</section>`;
  }

  let S = null;   // the season on screen
  function render(ctx) {
    X = ctx;
    const seasons = A && A.pastSeasons && A.pastSeasons.length ? [A.season, ...A.pastSeasons] : [];
    const picker = seasons.length ? `<div class="aw-years" role="group" aria-label="Season">${seasons.map(y => `<button type="button" data-aw-year="${y}" aria-pressed="${(year || A.season) === y}">${y}</button>`).join('')}</div>` : '';
    const head = sub => `<div class="pagehead"><h1>Awards</h1><span class="asof">${sub}</span></div>${picker}`;
    if (failed) return head('') + '<p class="error">Awards didn’t load. Refresh the page to try again.</p>';
    if (!A) { load(ctx.rerender); return head('') + '<p class="loading">Loading awards…</p>'; }
    if (year && year !== A.season) {
      if (pastFailed[year]) return head(`${year} season`) + `<p class="error">The ${year} awards didn’t load. Refresh the page to try again.</p>`;
      if (!past[year]) { loadPast(year, ctx.rerender); return head(`${year} season`) + '<p class="loading">Loading awards…</p>'; }
      S = past[year];
    } else S = A;
    if (!S.ready) return head(`${S.season} season`) + '<div class="card soon"><h2>Awards are on the way</h2><p>They fill in after the next weekly refresh pulls player scores from MFL: All-FBP teams, MVP, Best Value, Rookie of the Year, Waiver Claim of the Year, Trade of the Year and more.</p></div>';
    const team = (t, second) => `<div class="aw-team">${t.map(e => card(e.slot, e.player, second)).join('')}</div>`;
    const sub = S.final ? `${S.season} regular season, final · starter points only` : `${S.season} season through week ${S.throughWeek} · starter points only, rostered players`;
    const foot = S.final
      ? `Only points scored in an FBP starting lineup during the ${S.season} regular season count. FLEX is the best remaining flex-eligible player. Salaries are from the end of that season. All-FBP counts start with ${esc(A.honorsFrom || S.season)}. Trades count only what each side scored for its new team that season. Team names are today’s.`
      : `Only points scored in an FBP starting lineup count. FLEX is the best remaining RB, WR or TE. Salaries are this season’s. All-FBP counts start with ${esc(A.honorsFrom || S.season)} and include this season’s spot so far. Updated every Monday night.`;
    return head(sub) +
      `<section><h2 class="sec">1st Team All-FBP</h2>${team(S.allFbp.first)}</section>
      <section><h2 class="sec">2nd Team All-FBP</h2>${team(S.allFbp.second, true)}</section>
      <section><h2 class="sec">Season awards</h2><div class="aw-awards">${S.awards.map(award).join('')}</div>
      <p class="rf-foot">${foot}</p></section>`;
  }
  // returns the selector of the button pressed, so the page can keep focus on it
  function click(e) {
    const y = e.target.closest('[data-aw-year]');
    if (y) { year = y.dataset.awYear; potw = null; return `[data-aw-year="${year}"]`; }
    const b = e.target.closest('[data-aw-week]');
    if (!b) return false;
    potw = +b.dataset.awWeek; return `[data-aw-week="${potw}"]`;
  }
  return { render, click };
})();
