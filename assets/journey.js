/* FBP Journey timelines: a player's path through the league, from data/journeys.json (scripts/journeys.py).
   One component, three places: the Player Page, Reference > Players (Player Journey, up to three players side by
   side) and Trading Floor > History (How it played out). Phones get a vertical timeline, wider screens a horizontal
   one with a lane per player; both are in the page and CSS shows the one that fits.
   A small chip on each logo says how he arrived: A auction, D draft, T trade, W waivers or free agency.
   "Show details" (remembered in this browser) adds what happened at each move.
   FBPJourney.html(ids, ctx) returns markup; ctx = {teams, nameOf, esc, rerender}. */
window.FBPJourney = (function () {
  let J = null, loading = false, failed = false;
  const waiting = new Set();
  let details = true; try { details = localStorage.getItem('fbp-journey-details') !== '0'; } catch (_) {}
  function load(rerender) {
    if (rerender) waiting.add(rerender);
    if (J || loading || failed) return;
    loading = true;
    fetch('data/journeys.json', { cache: 'no-cache' }).then(r => r.ok ? r.json() : Promise.reject())
      .then(d => { J = d; loading = false; const w = [...waiting]; waiting.clear(); w.forEach(f => f()); },
        () => { failed = true; loading = false; const w = [...waiting]; waiting.clear(); w.forEach(f => f()); });
  }
  const HOW = { A: 'Auction', D: 'Draft', T: 'Trade', W: 'Waivers' };
  const fmt = ts => new Date(ts * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  const mon = ts => new Date(ts * 1000).toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
  const yr = ts => new Date(ts * 1000).getUTCFullYear();
  const span = (a, b) => { const d = (b - a) / 86400; return d < 1 ? 'same day' : d < 45 ? `${Math.round(d)} day${Math.round(d) === 1 ? '' : 's'}` : d < 548 ? `${Math.round(d / 30.4)} months` : `${(d / 365.25).toFixed(1).replace(/\.0$/, '')} years`; };
  const now = () => Date.now() / 1000;

  function stints(id) {
    const p = J && J.players[id]; if (!p) return null;
    const F = J.fields;
    return Object.assign({}, p, { id, st: p.st.map(a => { const s = {}; F.forEach((k, i) => { s[k] = a[i]; }); return s; }) });
  }
  // trades that involve two or more of the players on show, by time
  function shared(P) {
    const m = {};
    P.forEach((p, i) => p.st.forEach(s => { if (s.how === 'T') (m[s.start] = m[s.start] || new Set()).add(i); }));
    return Object.fromEntries(Object.entries(m).filter(([, v]) => v.size > 1).map(([k, v]) => [k, [...v]]));
  }

  function vertical(P, ctx, link) {
    const esc = ctx.esc, multi = P.length > 1;
    return P.map((p, pi) => {
      let y0 = null;
      const rows = p.st.map((s, si) => {
        const t = (ctx.teams || {})[s.team] || {}, name = ctx.nameOf ? ctx.nameOf(s.team) : (t.abbr || s.team);
        const y = yr(s.start), yh = y !== y0 ? `<li class="jy-yr">${y}</li>` : ''; y0 = y;
        const end = s.end || now(), last = si === p.st.length - 1 && !s.endHow;
        const when = s.approx ? `${y}` : fmt(s.start);
        const range = `${s.approx ? y : mon(s.start)} – ${last ? 'now' : s.end && !s.endApprox ? mon(s.end) : (s.endText || '').replace('Not kept for ', 'until ') || '?'}${!s.approx && (s.end && !s.endApprox || last) ? ' · ' + span(s.start, end) : ''}`;
        const others = s.how === 'T' && link[s.start] ? link[s.start].filter(i => i !== pi).map(i => P[i].n) : [];
        return `${yh}<li class="jy-st" style="--c1:${esc(t.primary || '#556')};--c2:${esc(t.secondary || '#99a')}">
          <span class="jy-lg">${t.logo ? `<img src="${esc(t.logo)}" alt="" loading="lazy">` : `<b>${esc(t.abbr || '')}</b>`}<i class="jy-chip jy-${s.how}" title="${HOW[s.how]}">${s.how}</i></span>
          <div class="jy-sh"><b>${esc(name)}</b><span>${range}</span></div>
          <ul class="jy-ev"><li><span>${esc(s.text || '')}${others.length ? ` <em class="jy-link">↔ ${others.map(esc).join(', ')}</em>` : ''}</span><small>${when}</small></li>
          ${s.endHow && s.endText ? `<li class="jy-end jy-e${s.endHow}"><span>${esc(s.endText)}</span>${s.end && !s.endApprox ? `<small>${fmt(s.end)}</small>` : ''}</li>` : ''}</ul></li>`;
      }).join('');
      return `<div class="jy-vp">${multi ? `<h4 class="jy-who">${esc(p.n)} <small>${esc(p.p || '')}</small></h4>` : ''}<ol class="jy-vt">${rows}</ol></div>`;
    }).join('');
  }

  function lanes(P, ctx, link) {
    const esc = ctx.esc;
    const first = Math.min(...P.map(p => yr(p.st[0].start))), lastY = (J.season || new Date().getFullYear()) + 1;
    const t0 = Date.UTC(first, 0, 1) / 1000, t1 = Date.UTC(lastY, 0, 1) / 1000, pct = ts => Math.max(0, Math.min(100, (ts - t0) / (t1 - t0) * 100));
    const axis = Array.from({ length: lastY - first }, (_, i) => `<span style="left:${(Date.UTC(first + i, 0, 1) / 1000 - t0) / (t1 - t0) * 100}%">${first + i}</span>`).join('');
    const lane = (p, pi) => {
      let lastX = -99, up = false, lastTag = -99;
      const bars = p.st.map((s, si) => {
        const t = (ctx.teams || {})[s.team] || {}, a = pct(s.start), b = pct(s.end || now());
        up = a - lastX < 3.2 ? !up : false; lastX = a;
        const tag = s.how === 'A' ? (s.text.match(/\$\d+/) || [''])[0] : s.how === 'W' ? (s.text.match(/\$\d+/) ? 'W ' + s.text.match(/\$\d+/)[0] : 'W') : s.how;
        return `<div class="jy-bar" style="left:${a}%;width:${Math.max(.6, b - a)}%;--c1:${esc(t.primary || '#556')};--c2:${esc(t.secondary || '#99a')}"></div>
          <button type="button" class="jy-lc${up ? ' up' : ''}" style="left:${a}%;--c2:${esc(t.secondary || '#99a')}" data-jy-s="${pi}|${si}" aria-label="${esc((ctx.nameOf ? ctx.nameOf(s.team) : s.team) + ', ' + HOW[s.how])}">
            ${t.logo ? `<img src="${esc(t.logo)}" alt="" loading="lazy">` : `<b>${esc(t.abbr || '')}</b>`}<i class="jy-chip jy-${s.how}">${s.how}</i></button>
          ${a - lastTag >= 4.5 ? (lastTag = a, `<span class="jy-tag" style="left:${a}%">${esc(tag)}</span>`) : ''}
          ${s.endHow === 'R' || s.endHow === 'N' && s.endText && s.endText.startsWith('Not kept') ? `<span class="jy-x jy-e${s.endHow}" style="left:${b}%" title="${esc(s.endText)}">${s.endHow === 'R' ? '✕' : '–'}</span>` : ''}`;
      }).join('');
      return `<div class="jy-lane"><div class="jy-ln"><b>${esc(p.n)}</b><small>${esc(p.p || '')}</small></div><div class="jy-tr">${bars}</div></div>`;
    };
    const links = Object.entries(link).map(([ts, L]) => { const lo = Math.min(...L), hi = Math.max(...L);
      return `<div class="jy-link-v" style="--x:${pct(+ts)};--a:${lo};--b:${hi}" title="In the same trade, ${fmt(+ts)}"></div>`; }).join('');
    return `<div class="jy-h-in" style="--n:${P.length}"><div class="jy-ax">${axis}</div>${P.map(lane).join('')}${links}</div>`;
  }

  const store = {};   // key -> players on show, for the tap details
  function html(ids, ctx) {
    ids = (ids || []).filter(Boolean);
    if (!J) { load(ctx.rerender); return failed ? '<p class="error">Journeys didn’t load.</p>' : '<p class="loading">Loading the journey…</p>'; }
    const P = ids.map(stints).filter(Boolean);
    if (!P.length) return '<p class="jy-none">No FBP moves on record for him yet.</p>';
    const key = 'j' + Math.random().toString(36).slice(2, 8), link = shared(P);
    store[key] = { P, ctx };
    return `<div class="jy${details ? '' : ' jy-nodet'}" data-jy="${key}">
      <label class="jy-det"><input type="checkbox" data-jy-det${details ? ' checked' : ''}> Show details</label>
      <div class="jy-v">${vertical(P, ctx, link)}</div>
      <div class="jy-h">${lanes(P, ctx, link)}<p class="jy-tip">Tap a logo for that stop.</p></div>
      <p class="jy-key"><i class="jy-chip jy-A">A</i> Auction <i class="jy-chip jy-D">D</i> Draft <i class="jy-chip jy-T">T</i> Trade <i class="jy-chip jy-W">W</i> Waivers or free agent · ✕ released · – not kept${Object.keys(link).length ? ' · <span class="jy-lk"></span> in the same trade' : ''}</p></div>`;
  }
  // players the search can offer: everyone with a journey
  function list() { return J ? Object.entries(J.players).map(([id, p]) => ({ id, n: p.n, p: p.p, now: p.now, e: p.e })) : null; }

  document.addEventListener('change', e => {
    if (!e.target.matches || !e.target.matches('[data-jy-det]')) return;
    details = e.target.checked;
    try { localStorage.setItem('fbp-journey-details', details ? '1' : '0'); } catch (_) {}
    document.querySelectorAll('.jy').forEach(el => { el.classList.toggle('jy-nodet', !details); const c = el.querySelector('[data-jy-det]'); if (c) c.checked = details; });
  });
  document.addEventListener('click', e => {
    const b = e.target.closest && e.target.closest('[data-jy-s]'); if (!b) return;
    const box = b.closest('.jy'), S = store[box && box.dataset.jy]; if (!S) return;
    const [pi, si] = b.dataset.jyS.split('|').map(Number), p = S.P[pi], s = p.st[si], esc = S.ctx.esc;
    const name = S.ctx.nameOf ? S.ctx.nameOf(s.team) : s.team;
    box.querySelectorAll('.jy-lc.on').forEach(x => x.classList.remove('on')); b.classList.add('on');
    box.querySelector('.jy-tip').innerHTML = `<b>${esc(p.n)} · ${esc(name)}</b> ${s.approx ? yr(s.start) : fmt(s.start)} – ${s.endHow ? (s.end && !s.endApprox ? fmt(s.end) : esc((s.endText || '').replace('Not kept for ', 'not kept for '))) : 'now'}<br>${esc(s.text || '')}${s.endText ? `<br>${esc(s.endText)}${s.end && !s.endApprox ? ` <small>${fmt(s.end)}</small>` : ''}` : ''}`;
  });
  return { html, load, list, ready: () => !!J };
})();
