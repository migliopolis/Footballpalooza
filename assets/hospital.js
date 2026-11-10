/* League Now > Hospital (beta): every injured player on an FBP roster, sorted into wards by expected length of stay.
   Injuries come from ESPN's live injury feed (status, body part, detail, side, estimated return, latest report), with the
   daily snapshot in data/espn/injuries.json as the fallback. FBP team, slot, salary and weekly points come from data/stats.json.
   Return dates are ESPN's estimates, mapped to the FBP week they land in. The injury notes are general football context. */
window.FBPHospital = (function () {
  let S = null, SNAP = null, LIVE = null, failed = false, loading = false, X = null;
  let who = 'ro', team = '';
  const open = new Set(), exp = new Set();   // open: injury notes shown; exp: card expanded (cards start collapsed)
  const NFLE = { GBP: 'gb', KCC: 'kc', NEP: 'ne', NOS: 'no', SFO: 'sf', TBB: 'tb', LVR: 'lv', JAC: 'jax', WAS: 'wsh', LA: 'lar' };
  const nflLogo = t => t ? `<img class="hs-nfl" src="https://a.espncdn.com/i/teamlogos/nfl/500/${NFLE[t] || t.toLowerCase()}.png" alt="${t}" loading="lazy">` : '';
  const head = e => `https://a.espncdn.com/i/headshots/nfl/players/full/${e}.png`;
  const redraw = () => { const y = window.scrollY; if (X && X.rerender) { X.rerender(); window.scrollTo(0, y); } };

  function load() {
    if (S || loading || failed) return;
    loading = true;
    Promise.all([fetch('data/stats.json', { cache: 'no-cache' }).then(r => r.ok ? r.json() : Promise.reject()),
      fetch('data/espn/injuries.json', { cache: 'no-cache' }).then(r => r.ok ? r.json() : {}).catch(() => ({}))])
      .then(([s, i]) => { S = s; SNAP = i; loading = false; redraw(); }, () => { failed = true; loading = false; redraw(); });
    fetch('https://site.api.espn.com/apis/site/v2/sports/football/nfl/injuries').then(r => r.ok ? r.json() : null).then(j => {
      if (!j) return; LIVE = {};
      (j.injuries || []).forEach(t => (t.injuries || []).forEach(i => { const a = i.athlete || {}; let id = a.id;
        if (!id) (a.links || []).some(l => { const m = /\/id\/(\d+)/.exec(l.href || ''); if (m) id = m[1]; return !!m; });
        const d = i.details || {};
        if (id) LIVE[id] = { status: i.status, type: [d.type, d.location && d.location !== d.type ? d.location : ''].filter(Boolean).join(' - '),
          detail: d.detail || '', side: d.side && d.side !== 'Not Specified' ? d.side : '', ret: d.returnDate || '',
          short: i.shortComment || '', long: i.longComment || '', date: i.date || '' }; }));
      redraw(); }).catch(() => {});
  }
  const inj = e => { const l = LIVE && LIVE[e], s = SNAP && SNAP[e];
    if (l) return l;
    return s ? { status: s.status, type: s.type, detail: '', side: '', ret: s.return, short: s.short, long: '', date: s.date } : null; };

  // ESPN's NFL weeks run Tuesday to Monday; week 1 of 2026 starts Tuesday, Sep 8
  const W1 = Date.UTC(2026, 8, 8);
  const fbpWeek = iso => { if (!iso) return null; const t = Date.parse(iso.slice(0, 10) + 'T12:00:00Z'); return isNaN(t) ? null : Math.floor((t - W1) / 6048e5) + 1; };
  const md = iso => { const t = new Date(iso.slice(0, 10) + 'T12:00:00Z'); return t.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }); };

  // wards, by expected stay
  const WARDS = [
    ['triage', 'Triage', 'Questionable: game-time decisions'],
    ['obs', 'Observation', 'Doubtful or out about a week: day to day'],
    ['ward', 'Ward', 'Out multiple weeks: week to week'],
    ['ltc', 'Long-term care', 'On NFL injured reserve'],
    ['season', 'Season-ending', 'Not expected back this season'],
  ];
  function ward(i, now) {
    const wk = fbpWeek(i.ret), text = (i.short + ' ' + i.long).toLowerCase();
    if (/for the (rest of the )?season|season-ending|out for the year/.test(text) || (wk && wk > 18)) return 'season';
    if (i.status === 'Injured Reserve') return 'ltc';
    if (i.status === 'Questionable') return 'triage';
    if (i.status === 'Doubtful' || !wk || wk <= now + 1) return 'obs';
    return 'ward';
  }

  // general notes by injury type: what it is, the usual treatment, the usual range, what to watch for
  const NOTES = {
    'Hamstring': ['A strain of the muscles along the back of the thigh, common in players who sprint.', 'Rest, then rehab that builds back to full-speed running.', 'Mild strains often cost 1–3 weeks; worse ones 4–8.', 'Re-aggravation is common, especially in the first few games back. Speed players can be limited at first.'],
    'Ankle': ['A sprain or other damage to the ankle. A "high" ankle sprain hurts the ligaments above the joint and heals slower than a regular one.', 'Rest, bracing and rehab; a tightrope surgery for some high sprains.', 'Regular sprains: days to 2 weeks. High sprains: 3–8 weeks.', 'Cutting and burst can lag behind the official return.'],
    'Knee': ['A catch-all for knee injuries: sprains of the MCL or other ligaments, bone bruises, tendon issues.', 'Depends on the structure: rest and rehab for most sprains, surgery for some tears.', 'MCL sprains: about 1–6 weeks by grade. Unspecified knee issues vary widely.', 'Watch the practice reports. Limited, then full, is the usual path back.'],
    'Knee - Meniscus': ['A tear of the cartilage that cushions the knee.', 'Often arthroscopic surgery: a trim, which is quicker, or a repair, which is slower.', 'Trim: about 3–6 weeks. Repair: several months.', 'Swelling after a return is the warning sign.'],
    'Knee - ACL': ['A tear of the main stabilizing ligament in the knee.', 'Reconstruction surgery and a long rehab.', 'Usually 9–12 months.', 'The first season back is often below the player\'s old level.'],
    'Achilles': ['An injury to the tendon at the back of the ankle; a full rupture is among the toughest in football.', 'Surgery for a rupture, then a long rehab.', 'A rupture usually ends the season; strains and tendinitis can be weeks.', 'Explosiveness often takes a full season or more to come back.'],
    'Concussion': ['A brain injury from a hit, managed under the NFL\'s concussion protocol.', 'A step-by-step return: rest, then light exercise, then football drills and contact, with an independent doctor\'s sign-off.', 'Many players miss 0–2 games; some much longer.', 'Each step is reported. "Cleared protocol" is the green light.'],
    'Groin': ['A strain of the inner-thigh muscles.', 'Rest and rehab.', 'Usually 1–4 weeks.', 'Like hamstrings, these can linger or recur.'],
    'Calf': ['A strain of the calf muscles.', 'Rest and rehab.', 'Usually 1–4 weeks.', 'Can recur, and can affect explosiveness.'],
    'Quadriceps': ['A strain or bruise of the muscles on the front of the thigh.', 'Rest and rehab.', 'Usually 1–4 weeks.', 'Can limit sprinting until it fully heals.'],
    'Shoulder': ['A sprain, separation or dislocation of the shoulder joint.', 'Rest and rehab, a harness for some, surgery for severe cases.', 'From days to the full season.', 'For QBs, watch throwing in practice. For others, contact.'],
    'Foot': ['A sprain, fracture or turf injury in the foot.', 'Rest and a boot; surgery for some fractures, such as a Lisfranc or Jones fracture.', 'From a week or two to the full season.', 'Lingering foot injuries can sap a player\'s speed for weeks.'],
    'Toe': ['Often "turf toe," a sprain at the base of the big toe.', 'Rest, taping or a stiff insert; surgery for severe cases.', 'Mild: 1–3 weeks. Severe: months.', 'Push-off and cutting can stay limited.'],
    'Heel': ['Bruising or plantar fascia trouble at the heel.', 'Rest, inserts and rehab.', 'Usually 1–4 weeks, but can drag on.', 'Tends to linger.'],
    'Back': ['Muscle spasms or strains, sometimes a disc issue.', 'Rest and treatment; rarely surgery.', 'Often day to day, sometimes longer.', 'Can flare up without warning.'],
    'Neck': ['A strain, stinger or, at worst, a fracture or disc issue.', 'Rest for strains; more serious cases can need surgery.', 'From days to the season.', 'Teams are cautious with any neck injury.'],
    'Hip': ['A strain, pointer or flexor issue around the hip.', 'Rest and rehab.', 'Usually 1–3 weeks.', 'Can limit a player\'s burst for a bit.'],
    'Thumb': ['A sprain, ligament tear or fracture in the thumb.', 'A splint or surgery, depending on the damage.', 'Skill players sometimes play through it with a cast; QBs rarely can.', 'For a QB, a throwing-hand thumb is the big one.'],
    'Finger': ['A sprain, dislocation or fracture in a finger.', 'Splinting or taping; surgery for some fractures.', 'Often little or no missed time, unless it\'s a QB\'s throwing hand.', 'Catching and ball security can suffer early.'],
    'Hand': ['A fracture or sprain in the hand.', 'A cast or surgery.', 'Often 2–6 weeks; some play in a club cast.', 'Catching and ball security can suffer early.'],
    'Wrist': ['A sprain or fracture in the wrist.', 'A brace, a cast or surgery.', 'From days to several weeks.', 'For a QB, watch his throws in practice.'],
    'Elbow': ['A sprain, bursitis or ligament issue in the elbow.', 'Rest, a brace, treatment.', 'Often day to day.', 'For a QB, watch his velocity and accuracy in practice.'],
    'Oblique': ['A strain of the muscles along the side of the torso.', 'Rest and treatment.', 'Usually 1–4 weeks.', 'Hurts throwing and twisting, so it matters most for QBs.'],
    'Abdomen': ['A muscle strain or core injury, sometimes a sports hernia.', 'Rest; surgery for some core injuries.', 'From a week or two to several weeks.', 'Core injuries can drag on.'],
    'Ribs': ['A bruise or fracture of the ribs.', 'Rest and padding.', 'Often 1–4 weeks; many play through it.', 'Hits to the ribs can knock him back out.'],
    'Lower Leg': ['An injury between the knee and ankle, such as a tibia or fibula fracture.', 'Surgery for many fractures.', 'Fractures usually cost months.', 'Bone injuries usually heal fully, but a long layoff means rust.'],
    'Illness': ['An illness, not an injury.', 'Rest.', 'Usually a game or less.', 'Check the Saturday reports.'],
    'Personal': ['Away from the team for personal reasons.', '', 'No timeline is usually given.', ''],
  };
  const noteFor = t => NOTES[t] || NOTES[(t || '').split(' - ')[0]] || null;

  function rows(now) {
    const out = [];
    (S.rows || []).forEach(r => {
      if (!r.e || r.p === 'DEF') return;
      if (who === 'ro' && !r.f) return;
      if (who === 'fa' && r.f) return;
      if (team && r.f !== team) return;
      const i = inj(r.e); if (!i || !i.status || i.status === 'Active') return;
      if (/coach'?s decision/i.test(i.type) || i.short === 'inactive' && !i.type) return;
      const pts = r.w.filter(v => v != null), played = pts.length;
      let missed = 0; for (let k = r.w.length - 1; k >= 0 && (r.w[k] == null || r.w[k] === 0); k--) missed++;
      const last3 = r.w.filter(v => v != null && v !== 0).slice(-3);
      const avg = played ? pts.reduce((a, b) => a + b, 0) / played : null;
      out.push({ r, i, wk: fbpWeek(i.ret), ward: ward(i, now), avg, played, missed,
        l3: last3.length ? last3.reduce((a, b) => a + b, 0) / last3.length : null });
    });
    return out;
  }

  function card(x, ctx) {
    const { r, i } = x, esc = ctx.esc, t = ctx.teams[r.f] || {}, o = open.has(r.id), ex = exp.has(r.id);
    const st = { 'Questionable': ['Q', 'q'], 'Doubtful': ['D', 'd'], 'Out': ['OUT', 'o'], 'Injured Reserve': ['IR', 'ir'] }[i.status] || [i.status, 'o'];
    const what = [i.side, i.type, i.detail].filter(Boolean).join(' ') || 'Undisclosed';
    const back = x.ward === 'season' ? '<b>Out for the season</b>' : x.wk ? `<b>Week ${x.wk}</b> <small>${md(i.ret)} · ESPN estimate</small>` : '<b>No timeline</b>';
    const rep = i.long || (i.short && !/^(out|ir|doubtful|inactive|questionable)$/i.test(i.short) ? i.short : '');
    const n = noteFor(i.type);
    const slot = r.sl === 'IR' ? '<i class="hs-slot">FBP IR</i>' : r.sl === 'T' ? '<i class="hs-slot">Taxi</i>' : '';
    return `<article class="hs-card card${ex ? ' hs-open' : ''}">
      <div class="hs-top" data-hs-ex="${r.id}" role="button" tabindex="0" aria-expanded="${ex}">
        <span class="hs-ph" style="background-image:url(${head(r.e)})">${r.f && t.logo ? `<img class="hs-fbp" src="${t.logo}" alt="${esc(t.abbr || '')}">` : ''}</span>
        <span class="hs-id"><b>${esc(r.n)}</b><small>${r.p} ${nflLogo(r.t) || 'FA'}${r.f ? '' : ' · Free agent'}${r.sal != null ? ` · $${r.sal}` : ''} ${slot}<span class="hs-what">· ${esc(i.type || 'Undisclosed')}</span></small></span>
        <span class="hs-st hs-${st[1]}">${st[0]}</span><span class="hs-car" aria-hidden="true">${ex ? '▴' : '▾'}</span>
      </div>
      ${ex ? `<div class="hs-body">
      <div class="hs-dx"><span><small>Injury</small><b>${esc(what)}</b></span><span><small>Expected back</small>${back}</span></div>
      <div class="hs-vit"><span><small>Season</small><b>${x.avg != null ? x.avg.toFixed(1) : '–'}</b><i>pts/gm</i></span><span><small>Last 3 played</small><b>${x.l3 != null ? x.l3.toFixed(1) : '–'}</b><i>pts/gm</i></span><span><small>Missed</small><b>${x.missed}</b><i>straight</i></span><span><small>Expect on return</small><b class="hs-tbd">Soon</b><i>from FBP history</i></span></div>
      ${rep ? `<p class="hs-rep">${esc(rep)}${i.date ? ` <small>${md(i.date)}</small>` : ''}</p>` : ''}
      ${n ? `<button type="button" class="hs-more" data-hs="${r.id}" aria-expanded="${o}">${i.type === 'Personal' ? 'About personal absences' : `About ${esc((i.type || '').toLowerCase())} injuries`} ${o ? '▴' : '▾'}</button>
        ${o ? `<dl class="hs-note"><dt>What it is</dt><dd>${n[0]}</dd>${n[1] ? `<dt>Treatment</dt><dd>${n[1]}</dd>` : ''}<dt>Usual range</dt><dd>${n[2]}</dd>${n[3] ? `<dt>Watch for</dt><dd>${n[3]}</dd>` : ''}</dl>` : ''}` : ''}
      </div>` : ''}
    </article>`;
  }

  function render(ctx) {
    X = ctx; load();
    if (failed) return '<p class="error">The hospital didn’t load.</p>';
    if (!S) return '<p class="loading">Checking in with the hospital…</p>';
    const esc = ctx.esc, now = S.weeks[S.weeks.length - 1] || 0;
    const all = rows(now);
    // census: every FBP team's injured players, points a game and salary on the shelf
    const keepWho = who, keepTeam = team; who = 'ro'; team = '';
    const ro = rows(now); who = keepWho; team = keepTeam;
    const cen = Object.keys(ctx.teams).map(f => { const L = ro.filter(x => x.r.f === f && x.r.sl !== 'T');
      return { f, n: L.length, pts: L.reduce((a, x) => a + (x.played >= 3 ? x.avg : 0), 0), sal: L.reduce((a, x) => a + (x.r.sal || 0), 0) }; })
      .sort((a, b) => b.pts - a.pts);
    const census = `<div class="hs-cen">${cen.map(c => { const t = ctx.teams[c.f] || {};
      return `<button type="button" class="hs-cb${team === c.f ? ' on' : ''}" data-hs-team="${c.f}">${t.logo ? `<img src="${t.logo}" alt="">` : ''}<b>${esc(t.abbr || c.f)}</b><span>${c.n} in</span><small>${c.pts.toFixed(0)} pts/gm · $${c.sal}</small></button>`; }).join('')}</div>`;
    const seg = `<div class="seg hs-who">${[['ro', 'FBP rosters'], ['fa', 'Free agents'], ['all', 'All']].map(([k, l]) => `<button type="button" data-hs-who="${k}"${who === k ? ' aria-pressed="true"' : ''}>${l}</button>`).join('')}</div>`;
    const wards = WARDS.map(([k, name, sub]) => { const L = all.filter(x => x.ward === k).sort((a, b) => (a.wk || 99) - (b.wk || 99) || (b.avg || 0) - (a.avg || 0));
      if (!L.length) return '';
      return `<section class="hs-ward hs-w-${k}"><h2 class="sec">${name} <span class="hs-cnt">${L.length}</span><small>${sub}</small></h2><div class="hs-grid">${L.map(x => card(x, ctx)).join('')}</div></section>`; }).join('');
    return `<div class="hs-page">
      <div class="hs-hero"><span class="hs-cross" aria-hidden="true"></span><div><h2>FBP General Hospital</h2><p>Beta · ${ro.length} FBP players admitted after Week ${now}${LIVE ? '' : ' · from the daily injury snapshot'}</p></div></div>
      <h2 class="sec">Census <small>FBP teams by points a game on the shelf (active and IR slots, 3+ games played) · tap a team to see only its patients</small></h2>
      ${census}
      ${seg}
      ${wards || '<p class="loading">No patients. A clean bill of health.</p>'}
      <section class="hs-ward"><h2 class="sec">Discharged <small>back this week, with his first game back</small></h2><div class="card hs-soon"><p>Comes with the daily injury history: players who left the list since last week, and how they did in their first game back.</p></div></section>
      <p class="rf-foot">Injury status, body part, estimated return dates and reports come from ESPN. Return dates are estimates and change often. The notes on each injury type are general football context, not medical advice and not about any one player.</p>
    </div>`;
  }

  document.addEventListener('click', e => {
    const t = e.target.closest && e.target.closest('[data-hs],[data-hs-ex],[data-hs-team],[data-hs-who]'); if (!t || !document.querySelector('.hs-page')) return;
    if (t.dataset.hsEx) { const id = t.dataset.hsEx; exp.has(id) ? exp.delete(id) : exp.add(id); }
    else if (t.dataset.hs) { const id = t.dataset.hs; open.has(id) ? open.delete(id) : open.add(id); }
    else if (t.dataset.hsTeam) { team = team === t.dataset.hsTeam ? '' : t.dataset.hsTeam; if (team) who = 'ro'; }
    else if (t.dataset.hsWho) { who = t.dataset.hsWho; if (who === 'fa') team = ''; }
    redraw();
  });
  document.addEventListener('keydown', e => { const t = e.target.closest && e.target.closest('[data-hs-ex]');
    if (t && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); t.click(); } });
  return { render };
})();
