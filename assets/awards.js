/* Awards tab: All-FBP teams and season awards, from data/awards.json (scripts/awards.py).
   Points are starter points only (scored in an FBP starting lineup), rostered players only. */
window.FBPAwards = (() => {
  let A = null, loading = false, failed = false, X;
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
    return `<span class="aw-ph ${size}${p.pos === 'DEF' ? ' def' : ''}">${src ? `<img src="${src}" alt="" loading="lazy" onerror="this.onerror=null;${fb ? `this.src='${fb}';this.parentNode.classList.add('fb')` : 'this.remove()'}">` : (fb ? `<img src="${fb}" alt="" class="fbimg">` : '')}${tlogo(p.team, 'aw-badge')}</span>`;
  }
  const n1 = v => v == null ? '—' : Number(v).toFixed(1);
  const sal = p => p.salary != null ? `$${Math.round(p.salary)}` : '—';
  const pos = p => p.pos ? `<span class="pos ${p.pos === 'DEF' ? 'DEF' : p.pos}">${p.pos}</span>` : '';

  function card(slot, p, second) {
    return `<div class="card aw-card${second ? ' second' : ''}"><span class="aw-slot">${slot}</span>${photo(p, second ? 'md' : 'lg')}
      <b class="aw-nm">${esc(p.name)}</b><span class="aw-sub">${pos(p)} ${esc(p.nfl || '')}${p.rookie ? ' · <i>Rookie</i>' : ''}</span>
      <span class="aw-fbp">${tlogo(p.team)}${esc(tname(p.team))}</span>
      <span class="aw-stats"><span><b>${n1(p.pts)}</b>pts</span><span><b>${n1(p.ppg)}</b>per start</span><span><b>${sal(p)}</b>salary</span></span></div>`;
  }
  // one award: the winner big, the next two below
  function award(a) {
    let body = '';
    if (a.list) {
      const [w, ...rest] = a.list;
      const extra = p => p.perDollar != null ? `${n1(p.perDollar)} pts per $` : p.bid != null ? `${p.how}${p.how === 'FAAB' ? ' $' + Math.round(p.bid) : ''}` : p.week ? `Week ${p.week}` : `${p.starts} starts`;
      body = `<div class="aw-win">${photo(w, 'md')}<div><b>${esc(w.name)}</b><span class="aw-sub">${pos(w)} ${esc(w.nfl || '')} · ${tlogo(w.team, 'mini')}${esc(tname(w.team))}</span>
        <span class="aw-big">${n1(w.pts)} <small>pts${a.key === 'value' || a.key === 'contract' ? ` · ${sal(w)}` : ''}</small></span><span class="aw-sub">${extra(w)}</span></div></div>
        ${rest.length ? `<ol class="aw-rest" start="2">${rest.map(p => `<li>${tlogo(p.team, 'mini')}<span>${esc(p.name)} <small>${p.pos}</small></span><b>${n1(p.pts)}</b><small>${extra(p)}</small></li>`).join('')}</ol>` : ''}`;
    } else if (a.teams) {
      const [w, ...rest] = a.teams;
      body = `<div class="aw-win team">${tlogo(w.team, 'aw-tlogo')}<div><b>${esc(tname(w.team))}</b><span class="aw-big">${esc(w.stat)}</span><span class="aw-sub">${esc(w.sub)}</span></div></div>
        <ol class="aw-rest" start="2">${rest.map(t => `<li>${tlogo(t.team, 'mini')}<span>${esc(tname(t.team))}</span><b>${esc(t.stat)}</b><small>${esc(t.sub)}</small></li>`).join('')}</ol>`;
    } else if (a.trade) {
      const side = (s, won) => `<div class="aw-side${won ? ' won' : ''}"><div class="aw-sideh">${tlogo(s.team, 'mini')}<b>${esc(tname(s.team))}</b><span>${n1(s.pts)} pts</span></div>
        <ul>${s.players.map(p => `<li>${esc(p.name)} <small>${p.pos} · ${n1(p.pts)}</small></li>`).join('')}${s.picks.map(k => `<li class="pk">${esc(k.replace(/^FP_\d+_(\d+)_(\d+)$/, '$1 round $2 pick'))}</li>`).join('')}</ul></div>`;
      body = `<p class="aw-sub">Received, and starter points since:</p><div class="aw-trade">${side(a.trade.winner, true)}${side(a.trade.loser, false)}</div><p class="aw-sub">Edge: ${n1(a.trade.margin)} pts</p>`;
    }
    return `<section class="card aw-award"><h3>${esc(a.title)}</h3><p class="aw-why">${esc(a.why)}</p>${body}</section>`;
  }

  function render(ctx) {
    X = ctx;
    const head = sub => `<div class="pagehead"><h1>Awards</h1><span class="asof">${sub}</span></div>`;
    if (failed) return head('') + '<p class="error">Awards didn’t load. Refresh the page to try again.</p>';
    if (!A) { load(ctx.rerender); return head('') + '<p class="loading">Loading awards…</p>'; }
    if (!A.ready) return head(`${A.season} season`) + '<div class="card soon"><h2>Awards are on the way</h2><p>They fill in after the next weekly refresh pulls player scores from MFL: All-FBP teams, MVP, Best Value, Rookie of the Year, Waiver Claim of the Year, Trade of the Year and more.</p></div>';
    const team = (t, second) => `<div class="aw-team">${t.map(e => card(e.slot, e.player, second)).join('')}</div>`;
    return head(`${A.season} season through week ${A.throughWeek} · starter points only, rostered players`) +
      `<section><h2 class="sec">1st Team All-FBP</h2>${team(A.allFbp.first)}</section>
      <section><h2 class="sec">2nd Team All-FBP</h2>${team(A.allFbp.second, true)}</section>
      <section><h2 class="sec">Season awards</h2><div class="aw-awards">${A.awards.map(award).join('')}</div>
      <p class="rf-foot">Only points scored in an FBP starting lineup count. FLEX is the best remaining RB, WR or TE. Salaries are this season’s. Updated every Monday night.</p></section>`;
  }
  return { render };
})();
