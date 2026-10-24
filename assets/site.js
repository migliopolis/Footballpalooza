/* Footballpalooza hub: hash router, P-PPR toggle and the League Now page.
   Data comes from files the weekly GitHub Action writes (data/league-now.json). */
(() => {
  const app = document.getElementById('app');
  const state = { now: null, teams: {}, ppr: false };
  try { state.ppr = localStorage.getItem('fbp-ppr') === '1'; } catch (e) {}

  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const rec = t => `${t.w}-${t.l}${t.t ? '-' + t.t : ''}`;
  const pts = v => Number(v).toFixed(1);

  function chip(id, opts = {}) {
    const tm = state.teams[id] || {}, row = (state.now && state.now.standings.find(s => s.id === id)) || {};
    const name = opts.name || row.name || id;
    const border = (tm.primary || '').toUpperCase() === '#FFFFFF' ? `;box-shadow:inset 0 0 0 1px ${tm.secondary}` : '';
    const abbr = tm.abbr ? `<span class="abbr" style="background:${tm.primary};color:${tm.secondary}${border}">${tm.abbr}</span>` : '';
    const logo = tm.logo ? `<img src="${tm.logo}" alt="" loading="lazy">` : '';
    return `<span class="team">${logo}<span class="nm">${esc(name)}</span>${opts.abbr ? abbr : ''}${opts.after || ''}</span>`;
  }

  /* ---------- League Now ---------- */
  function pageNow() {
    const d = state.now;
    const by = Object.fromEntries(d.standings.map(t => [t.id, t]));
    const seeds = d.seeds;
    const gen = new Date(d.fetched || d.generated);
    const genTxt = isNaN(gen) ? '' : gen.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

    const viaTxt = s => {
      const t = by[s.id];
      let base = s.via === 'division' ? `${t.divisionName} division leader` : s.via === 'wild card' ? 'Wild card' : `Most all-play wins (${t.allPlayW})`;
      const tb = s.via === 'division' ? (s.divisionTiebreak || s.tiebreak) : s.tiebreak;
      return base + (tb ? ` · <em>won tiebreak on ${tb}</em>` : '');
    };
    const seedRows = seeds.map(s => {
      const t = by[s.id];
      return `<div class="seed${s.seed <= 2 ? ' bye' : ''}"><span class="n">${s.seed}</span>${chip(s.id)}<span class="rec">${rec(t)}</span>
        <span class="via">${viaTxt(s)} · ${pts(t.pf)} pts</span></div>`;
    }).join('');

    const g = (a, b, lbl) => `<div class="game">${lbl ? `<div class="lbl">${lbl}</div>` : ''}${[a, b].map(x =>
      x ? `<div class="row" title="${esc((by[x.id] || {}).name || '')}"><span class="sd">${x.seed}</span>${chip(x.id, { name: (state.teams[x.id] || {}).abbr })}</div>` : `<div class="row"><span class="sd"></span><span class="tbd">Winner advances</span></div>`).join('')}</div>`;
    const S = n => seeds[n - 1];
    const bracket = `<div class="bracket">
      <div class="round"><h3>Week 15 · Round 1</h3>${g(S(3), S(6))}${g(S(4), S(5))}</div>
      <div class="round"><h3>Week 16 · Semifinals</h3>${g(S(1), null, 'vs lowest seed left')}${g(S(2), null, 'vs highest seed left')}</div>
      <div class="round"><h3>Week 17 · Finals</h3>${g(null, null, 'Championship')}${g(null, null, '3rd-place game')}</div>
    </div>`;

    const inPo = new Set(seeds.map(s => s.id));
    const s5 = by[S(5).id], s6 = by[S(6).id];
    const bubble = d.standings.filter(t => !inPo.has(t.id))
      .sort((a, b) => b.pct - a.pct || b.allPlayW - a.allPlayW || b.pf - a.pf).slice(0, 3)
      .map(t => {
        const gb = ((s5.w - t.w) + (t.l - s5.l)) / 2;
        const apb = s6.allPlayW - t.allPlayW;
        return `<div class="bub card">${chip(t.id)}<span class="gb">${rec(t)} · ${gb <= 0 ? 'tied for' : gb + ' GB of'} seed 5<br>${apb <= 0 ? 'tied' : apb + ' behind'} seed 6 in all-play wins</span></div>`;
      }).join('');

    const divTables = d.divisions.map(dv => {
      const rows = d.standings.filter(t => t.division === dv.id).sort((a, b) => a.divisionRank - b.divisionRank);
      return `<div class="card tbl-wrap"><table class="tbl"><caption>${esc(dv.name)}</caption>
        <thead><tr><th>Team</th><th>W-L-T</th><th>PF</th><th class="hide-sm">PA</th><th title="All-play wins">AP W</th><th class="hide-sm">Strk</th></tr></thead><tbody>
        ${rows.map(t => `<tr><td class="t">${chip(t.id, { after: t.seed ? `<span class="pill${t.seed > 3 ? ' wc' : ''}" title="Current playoff seed">${t.seed}</span>` : '' })}</td>
          <td>${t.w}-${t.l}-${t.t}</td><td>${pts(t.pf)}</td><td class="hide-sm">${pts(t.pa)}</td><td>${t.allPlayW}</td><td class="hide-sm">${esc(t.streak)}</td></tr>`).join('')}
        </tbody></table></div>`;
    }).join('');

    const order = d.draftOrder.map(p => {
      const t = by[p.id];
      const why = p.pick <= 6 ? `Lowest potential points (${pts(t.pp)})${p.tiebreak ? ` · tiebreak on ${p.tiebreak}` : ''}`
                              : p.basis.charAt(0).toUpperCase() + p.basis.slice(1);
      return `<li class="${p.pick > 6 ? 'po' : ''}"><span class="pk">1.${String(p.pick).padStart(2, '0')}</span>${chip(p.id)}<span class="why">${esc(why)}</span></li>`;
    }).join('');

    return `
      <div class="pagehead"><h1>League Now</h1>
        <span class="asof">${esc(d.season.replace(/footballpalooza/i, '').trim() || '')} season · <b>through Week ${d.weeksPlayed}</b> of ${d.lastRegularSeasonWeek}${genTxt ? ` · updated ${genTxt}` : ''}</span></div>
      <div class="grid2">
        <section><h2 class="sec">Playoff picture <small>if the season ended today</small></h2>
          <div class="card seeds">${seedRows}</div>
          <h2 class="sec" style="margin-top:16px">On the bubble</h2>
          <div class="bubble" style="margin-top:0">${bubble}</div>
        </section>
        <section><h2 class="sec">Bracket</h2><div class="card">${bracket}</div></section>
      </div>
      <section><h2 class="sec">Standings <small>division order uses the by-law tiebreaks</small></h2><div class="divs">${divTables}</div></section>
      <section><h2 class="sec">Projected rookie draft order <small>picks 7–12 assume higher seeds win</small></h2>
        <ol class="card order">${order}</ol></section>`;
  }

  /* ---------- placeholders ---------- */
  const SOON = {
    reference: ['Reference', 'The FBP Reference almanac moves in here: franchise pages, every season’s standings and brackets, records, head-to-head and draft and auction history.', ['Turn on P-PPR in the header to include the pre-2019 non-PPR seasons.']],
    offseason: ['Off-Season', 'A sandbox for next year: rosters, cap space, keeper look-ahead, free agents, the incoming rookie class and auction price predictions tuned on 2026 results.', []],
    draft: ['Rookie Draft', 'A mock draft using the league’s actual draft order: auto-mock the whole league, make every pick yourself, or pick for your team while the rest auto-draft. Each rookie’s price shows as you go.', []],
    bylaws: ['By-Laws', 'The 2027 FBP by-laws, searchable and readable on a phone.', []],
  };
  const pageSoon = k => {
    const [h, p, extra] = SOON[k];
    return `<div class="card soon"><h2>${h}</h2><p>${p}</p>${extra.length ? `<ul>${extra.map(x => `<li>${x}</li>`).join('')}</ul>` : ''}<p>Coming soon.</p></div>`;
  };

  /* ---------- router ---------- */
  const TABS = ['now', 'reference', 'offseason', 'draft', 'bylaws'];
  function route() {
    const tab = TABS.includes(location.hash.slice(1)) ? location.hash.slice(1) : 'now';
    document.querySelectorAll('.tabs a').forEach(a => { if (a.dataset.tab === tab) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
    if (tab === 'now') app.innerHTML = state.now ? pageNow() : '<p class="error">League data didn’t load. Refresh the page to try again.</p>';
    else app.innerHTML = pageSoon(tab);
    const active = document.querySelector('.tabs a[aria-current="page"]');
    if (active) active.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }

  async function init() {
    const t = document.getElementById('ppr-toggle');
    t.checked = state.ppr;
    t.addEventListener('change', () => { state.ppr = t.checked; try { localStorage.setItem('fbp-ppr', t.checked ? '1' : '0'); } catch (e) {} route(); });
    try {
      const [now, teams] = await Promise.all([
        fetch('data/league-now.json', { cache: 'no-cache' }).then(r => { if (!r.ok) throw 0; return r.json(); }),
        fetch('data/teams.json').then(r => r.ok ? r.json() : { teams: {} }),
      ]);
      state.now = now; state.teams = teams.teams || {};
      const yr = (now.season.match(/\d{4}/) || [''])[0];
      document.getElementById('season-label').textContent = yr ? `${yr} season · League hub` : 'League hub';
    } catch (e) { state.now = null; }
    window.addEventListener('hashchange', route);
    route();
  }
  init();
})();
