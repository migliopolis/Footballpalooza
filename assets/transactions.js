/* League Now > Transactions (#now/transactions): every move of a season, newest first, from data/transactions.json
   (scripts/transactions_log.py). Show me: adds, drops and trades (the default), any one kind, or everything; involving
   any team or one; find a player. Waiver claims show the winning bid; trades show both sides, picks and auction cash
   included. IR and taxi moves are kept from 2026 on; past seasons' auctions run in auction order. */
window.FBPTransactions = (function () {
  let D = null, failed = false, loading = false, X = null;
  const S = { y: '', show: 'tx', f: '', q: '', shown: 150 };
  try { Object.assign(S, JSON.parse(localStorage.getItem('fbp-tx') || '{}'), { q: '', shown: 150 }); } catch (e) {}
  const save = () => { try { localStorage.setItem('fbp-tx', JSON.stringify({ show: S.show, f: S.f })); } catch (e) {} };
  const esc = s => (X && X.esc ? X.esc(s) : String(s == null ? '' : s));
  const redraw = () => { const y = window.scrollY; if (X && X.rerender) { X.rerender(); window.scrollTo(0, y); } };
  function load() {
    if (D || loading || failed) return;
    loading = true;
    fetch('data/transactions.json', { cache: 'no-cache' }).then(r => r.ok ? r.json() : Promise.reject())
      .then(j => { D = j; loading = false; redraw(); }, () => { failed = true; loading = false; redraw(); });
  }
  const KIND = { W: ['Waiver', 'w'], F: ['Free agent', 'f'], T: ['Trade', 't'], I: ['IR', 'i'], X: ['Taxi', 'x'], A: ['Auction', 'a'] };
  const SHOW = [['tx', 'Adds, drops and trades', 'WFT'], ['ad', 'All adds and drops', 'WF'], ['W', 'Waiver claims', 'W'], ['F', 'Free-agent pickups', 'F'],
    ['T', 'Trades', 'T'], ['I', 'IR moves', 'I'], ['X', 'Taxi squad moves', 'X'], ['A', 'Auctions won', 'A'], ['all', 'All transactions', 'WFTIXA']];
  const tm = f => (X && X.teams && X.teams[f]) || {};
  const logo = f => tm(f).logo ? `<img src="${tm(f).logo}" alt="" loading="lazy">` : '';
  const money = b => '$' + (Math.round(b * 100) / 100).toString();

  function pl(id, cls) {
    const p = D.players[id] || ['Player ' + id, '', 0];
    const n = esc(p[0]), tag = `<span class="tx-pos">${esc(p[1] || '')}</span>`;
    return `<span class="tx-pl ${cls || ''}">${p[2] ? `<a href="#now/player/${id}">${n}</a>` : n} ${tag}</span>`;
  }
  const list = (L, cls) => L.map(id => pl(id, cls)).join(' ');
  function body(e) {
    if (e.k === 'W' || e.k === 'F') return `${e.a.length ? `<span class="tx-l"><b class="tx-v add">Added</b>${list(e.a)}${e.k === 'W' && e.b != null ? `<span class="tx-bid">${money(e.b)}</span>` : ''}</span>` : ''}${e.d.length ? `<span class="tx-l"><b class="tx-v drop">Dropped</b>${list(e.d)}</span>` : ''}`;
    if (e.k === 'A') return `<span class="tx-l"><b class="tx-v add">Won</b>${list(e.a)}<span class="tx-bid">${money(e.b)}</span></span>`;
    if (e.k === 'I') return `${e.on.length ? `<span class="tx-l"><b class="tx-v drop">To IR</b>${list(e.on)}</span>` : ''}${e.off.length ? `<span class="tx-l"><b class="tx-v add">Off IR</b>${list(e.off)}</span>` : ''}`;
    if (e.k === 'X') return `${e.on.length ? `<span class="tx-l"><b class="tx-v drop">To taxi</b>${list(e.on)}</span>` : ''}${e.off.length ? `<span class="tx-l"><b class="tx-v add">Promoted</b>${list(e.off)}</span>` : ''}`;
    if (e.k === 'T') {
      const side = (f, G) => `<span class="tx-l tx-ts"><b class="tx-v">${logo(f)}${esc(tm(f).abbr || f)} got</b>${G.map(x => typeof x === 'string' ? pl(x) : `<span class="tx-pl tx-pk">${esc(x.t)}</span>`).join(' ') || '<span class="tx-mu">nothing</span>'}</span>`;
      return side(e.f, e.g2) + side(e.f2, e.g1);
    }
    return '';
  }
  const day = ts => ts ? new Date(ts * 1000).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }) : 'The auction';
  const time = ts => ts ? new Date(ts * 1000).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : '';

  function render(ctx) {
    X = ctx; load();
    if (failed) return '<p class="error">Transactions didn’t load. Refresh the page to try again.</p>';
    if (!D) return '<p class="loading">Loading transactions…</p>';
    const yrs = Object.keys(D.years).sort((a, b) => b - a);
    const y = D.years[S.y] ? S.y : String(D.season);
    const kinds = (SHOW.find(s => s[0] === S.show) || SHOW[0])[2];
    const q = S.q.trim().toLowerCase();
    const hit = id => ((D.players[id] || [''])[0] || '').toLowerCase().includes(q);
    const L = (D.years[y] || []).filter(e => kinds.includes(e.k))
      .filter(e => !S.f || e.f === S.f || e.f2 === S.f)
      .filter(e => !q || [].concat(e.a || [], e.d || [], e.on || [], e.off || [], (e.g1 || []).filter(x => typeof x === 'string'), (e.g2 || []).filter(x => typeof x === 'string')).some(hit));
    const teams = Object.keys(X.teams || {}).sort((a, b) => (X.nameOf ? X.nameOf(a) : a).localeCompare(X.nameOf ? X.nameOf(b) : b));
    const cnt = {}; L.forEach(e => { cnt[e.k] = (cnt[e.k] || 0) + 1; });
    let last = null;
    const rows = L.slice(0, S.shown).map(e => {
      const d = day(e.ts), head = d !== last ? (last = d, `<li class="tx-day">${d}</li>`) : '';
      return `${head}<li class="tx-r"><span class="tx-tm" title="${esc(X.nameOf ? X.nameOf(e.f) : e.f)}">${logo(e.f)}<b>${esc(tm(e.f).abbr || e.f)}</b>${e.k === 'T' ? `<i>⇄</i>${logo(e.f2)}<b>${esc(tm(e.f2).abbr || e.f2)}</b>` : ''}</span>
        <span class="tx-k ${KIND[e.k][1]}">${KIND[e.k][0]}</span><span class="tx-b">${body(e)}</span><span class="tx-t">${time(e.ts)}</span></li>`; }).join('');
    const none = +y < 2026 && /[IX]/.test(kinds) && !/[WFTA]/.test(kinds) ? 'IR and taxi squad moves are kept from 2026 on.' : 'Nothing matches.';
    return `<section class="tx-page">
      <div class="tx-ctl">
        <label>Show me <select class="tx-show">${SHOW.map(([k, l]) => `<option value="${k}"${k === S.show ? ' selected' : ''}>${l}</option>`).join('')}</select></label>
        <label>involving <select class="tx-team"><option value="">Any team</option>${teams.map(f => `<option value="${f}"${f === S.f ? ' selected' : ''}>${esc(X.nameOf ? X.nameOf(f) : f)}</option>`).join('')}</select></label>
        <label>in <select class="tx-year">${yrs.map(v => `<option value="${v}"${v === y ? ' selected' : ''}>${v}</option>`).join('')}</select></label>
        <input class="pr-q tx-q" type="search" placeholder="Find a player" aria-label="Find a player" value="${esc(S.q)}" autocomplete="off">
      </div>
      <p class="rk-sub">${L.length} ${L.length === 1 ? 'move' : 'moves'}${Object.keys(cnt).length > 1 ? ': ' + 'WFTIXA'.split('').filter(k => cnt[k]).map(k => `${cnt[k]} ${KIND[k][0].toLowerCase()}`).join(' · ') : ''}. Newest first.</p>
      ${L.length ? `<ul class="tx-list">${rows}</ul>` : `<p class="ro-wait">${none}</p>`}
      ${L.length > S.shown ? `<button type="button" class="ro-howb rk-more" data-tx-more>Show ${Math.min(150, L.length - S.shown)} more</button>` : ''}
      <p class="rf-foot">From MFL’s transaction log. Waiver claims show the winning blind bid. Trades show what each team got, picks and auction cash included. IR and taxi squad moves are kept from 2026 on. Past seasons’ auctions are listed in auction order. Waiver requests and trade offers aren’t public, so they aren’t here.</p>
    </section>`;
  }

  document.addEventListener('change', e => {
    const t = e.target; if (!t.matches) return;
    if (t.matches('.tx-show')) { S.show = t.value; S.shown = 150; save(); redraw(); }
    else if (t.matches('.tx-team')) { S.f = t.value; S.shown = 150; save(); redraw(); }
    else if (t.matches('.tx-year')) { S.y = t.value; S.shown = 150; redraw(); }
  });
  document.addEventListener('click', e => { if (e.target.closest && e.target.closest('[data-tx-more]')) { S.shown += 150; redraw(); } });
  document.addEventListener('input', e => {
    if (!(e.target.matches && e.target.matches('.tx-q'))) return;
    S.q = e.target.value; S.shown = 150; const pos = e.target.selectionStart; redraw();
    const n = document.querySelector('.tx-q'); if (n) { n.focus(); try { n.setSelectionRange(pos, pos); } catch (_) {} }
  });
  return { render };
})();
