/* Beta > The Docket: fantasy-relevant NFL players with legal trouble, from data/legal.json (kept by hand, each case written
   from the reporting linked under it). Each card: where it stands, a timeline, the charges in plain English, what's at stake
   in court and with the NFL, a statement from the FBP team that rosters him (written for the Press Box), and sources.
   The FBP team comes from data/rosters.json, so a statement follows the player when he changes hands. */
window.FBPLegal = (function () {
  let L = null, R = null, failed = false, loading = false, X = null, show = 'open';
  const esc = s => (X && X.esc ? X.esc(s) : String(s == null ? '' : s));
  const NFLE = { GBP: 'gb', KCC: 'kc', NEP: 'ne', NOS: 'no', SFO: 'sf', TBB: 'tb', LVR: 'lv', JAC: 'jax', WAS: 'wsh', LA: 'lar', LAR: 'lar' };
  const nflLogo = t => t && t !== 'FA' ? `<img class="lg-nfl" src="https://a.espncdn.com/i/teamlogos/nfl/500/${NFLE[t] || t.toLowerCase()}.png" alt="${esc(t)}" loading="lazy">` : '<span class="lg-fa">Free agent</span>';
  const head = e => `https://a.espncdn.com/i/headshots/nfl/players/full/${e}.png`;
  const redraw = () => { const y = window.scrollY; if (X && X.rerender) { X.rerender(); window.scrollTo(0, y); } };
  function load() {
    if (L || loading || failed) return;
    loading = true;
    Promise.all([fetch('data/legal.json', { cache: 'no-cache' }).then(r => r.ok ? r.json() : Promise.reject()),
      fetch('data/rosters.json', { cache: 'no-cache' }).then(r => r.ok ? r.json() : null).catch(() => null)])
      .then(([l, r]) => { L = l; R = r; loading = false; redraw(); }, () => { failed = true; loading = false; redraw(); });
  }
  // which FBP team has him now
  const owner = id => { if (!R) return null; for (const [f, t] of Object.entries(R.teams || {})) if ((t.rows || []).some(r => String(r.id) === String(id))) return f; return null; };

  function card(c) {
    const f = owner(c.id), t = f ? (X.teams[f] || {}) : null, nm = f ? (X.nameOf ? X.nameOf(f) : t.abbr || f) : '';
    // "The {team}" when the team's own name already starts with The (The Fist of the Magi) drops the extra The
    const stmt = f ? esc(c.statement).replace(/\bThe \{team\}/g, /^the /i.test(nm) ? '{team}' : 'The {team}').replace(/\{team\}/g, `<b>${esc(nm)}</b>`) : '';
    return `<article class="card lg-card ${c.tone}">
      <header class="lg-top">
        <img class="lg-hs" src="${head(c.espn)}" alt="" loading="lazy" onerror="this.style.visibility='hidden'">
        <div class="lg-id"><h3>${f ? `<a href="#now/rosters/${f}/${c.id}">${esc(c.name)}</a>` : esc(c.name)}</h3>
          <div class="lg-sub">${esc(c.pos)} ${nflLogo(c.nfl)}${t ? `<span class="lg-own">${t.logo ? `<img src="${t.logo}" alt="">` : ''}${esc(t.abbr || f)}</span>` : '<span class="lg-own">Not on an FBP roster</span>'}</div></div>
        <span class="lg-status ${c.tone}">${esc(c.status)}</span>
      </header>
      <p class="lg-head">${esc(c.headline)}</p>
      ${f ? `<blockquote class="lg-pr"><span class="lg-prh">Statement · ${esc(nm)} front office</span><p>${stmt}</p></blockquote>` : ''}
      <details class="lg-more"><summary>The case</summary>
        <ol class="lg-tl">${c.timeline.map(([d, x]) => `<li><b>${esc(d)}</b><span>${esc(x)}</span></li>`).join('')}</ol>
        <h4>The charges, explained</h4>
        <dl class="lg-ch">${c.charges.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>
        <div class="lg-stakes"><div><h4>⚖️ In court</h4><p>${esc(c.court)}</p></div><div><h4>🏈 With the NFL</h4><p>${esc(c.nfl)}</p></div></div>
        <p class="lg-src">Sources: ${c.sources.map(([l, u]) => `<a href="${esc(u)}" target="_blank" rel="noopener">${esc(l)}</a>`).join(' · ')}</p>
      </details>
    </article>`;
  }

  function render(ctx) {
    X = ctx; load();
    if (failed) return '<p class="error">The Docket didn’t load.</p>';
    if (!L) return '<p class="loading">Loading the Docket…</p>';
    const open = L.cases.filter(c => c.tone !== 'closed'), closed = L.cases.filter(c => c.tone === 'closed');
    const list = show === 'closed' ? closed : open;
    return `<section class="lg-page">
      <h2 class="sec">The Docket <small>Updated ${esc(L.updated)}</small></h2>
      <p class="lg-intro">Fantasy-relevant players with legal trouble: where each case stands, what the charges mean, and what’s at stake in court and with the NFL. Each one carries a statement from the FBP team that rosters him, for the Press Box. Allegations in lawsuits and police reports are just that until a court says otherwise.</p>
      <div class="seg lg-seg" role="tablist">${[['open', `Active (${open.length})`], ['closed', `Closed (${closed.length})`]].map(([k, l]) =>
        `<button type="button" role="tab" data-lg="${k}" aria-selected="${show === k}">${l}</button>`).join('')}</div>
      <div class="lg-list">${list.map(card).join('') || '<p class="lg-none">Nothing here.</p>'}</div>
      <p class="rf-foot">Written from the news reports linked on each case; sentences and penalties describe what the law allows, not predictions. Team statements are FBP front-office statements for the Press Box, not from the NFL clubs. Headshots: ESPN.</p>
    </section>`;
  }
  document.addEventListener('click', e => {
    const b = e.target.closest && e.target.closest('[data-lg]'); if (!b) return;
    show = b.dataset.lg; redraw();
  });
  return { render };
})();
