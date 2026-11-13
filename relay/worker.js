// FBP live scoreboard relay (Cloudflare Worker).
// Hands the hub site MFL's public exports for league 14482, which browsers can't read from MFL directly:
//   (default)  live scoring for every FBP lineup        ?w=9 for a given week
//   ?t=all     every player's points for the week, rostered or not (Game Day > Players)   ?t=all&w=9
//   ?t=fa      free agents' points only                 ?t=fa&w=9
// Only these can be requested, so it can't be used as an open proxy.
//
// It also starts the site's data refresh on time (GitHub's own schedule runs hours late). Cron Triggers call
// scheduled() below; it asks GitHub to run .github/workflows/refresh-data.yml when:
//   mornings, 9:00 to 10:30 AM Pacific: as soon as MFL shows the morning's waiver claims processed, or at 9:45 AM if
//     there were none, once a day;
//   Monday night, 10 PM Pacific on: once, after the late game.
// "Once" is checked against GitHub's own run list, so nothing needs to be stored here.
// Needs the secret GH_TOKEN: a fine-grained GitHub token for migliopolis/Footballpalooza with Actions: Read and write.
// Cron Triggers (UTC): */5 16-18 * * *   and   15 6,7 * * TUE  (Cloudflare counts weekdays from 1 = Sunday, so use the name)
const LEAGUE = 'https://www47.myfantasyleague.com/2026/export?L=14482&JSON=1';
const GH = 'https://api.github.com/repos/migliopolis/Footballpalooza/actions/workflows/refresh-data.yml';

export default {
  async fetch(request) {
    const url = new URL(request.url);
    const w = url.searchParams.get('w');
    const week = w && /^\d{1,2}$/.test(w) ? `&W=${w}` : '';   // default: MFL's current week
    const t = url.searchParams.get('t');
    const mfl = t === 'fa' ? `${LEAGUE}&TYPE=playerScores&STATUS=freeagent${week || '&W=YTD'}`
      : t === 'all' ? `${LEAGUE}&TYPE=playerScores${week || '&W=YTD'}`
      : `${LEAGUE}&TYPE=liveScoring&DETAILS=1${week}`;
    const r = await fetch(mfl, { headers: { 'User-Agent': 'FBP scoreboard relay' } });
    return new Response(r.body, {
      status: r.status,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Access-Control-Allow-Origin': 'https://migliopolis.github.io',
        'Cache-Control': 'no-store',
      },
    });
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(refresh(env).then(m => console.log(m), e => console.log('refresh check failed:', e && e.message)));
  },
};

// Pacific wall clock: { day: 'Mon', h, m } plus the epoch seconds of a Pacific time earlier today
function pacific(now) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', weekday: 'short', hour: 'numeric', minute: 'numeric', hourCycle: 'h23' })
    .formatToParts(now).map(x => [x.type, x.value]));
  const h = +p.hour, m = +p.minute;
  const at = (hh, mm) => Math.floor(now / 1000) - ((h - hh) * 3600 + (m - mm) * 60) - now.getUTCSeconds();
  return { day: p.weekday, h, m, at };
}

async function refresh(env) {
  if (!env.GH_TOKEN) return 'no GH_TOKEN secret: skipping';
  const now = new Date(), pt = pacific(now), mins = pt.h * 60 + pt.m;
  let since, why;
  if (pt.day === 'Mon' && mins >= 22 * 60) { since = pt.at(21, 30); why = 'Monday night'; }
  else if (mins >= 9 * 60 && mins <= 10 * 60 + 30) { since = pt.at(8, 55); why = 'morning'; }
  else return `outside the refresh windows (${pt.day} ${pt.h}:${String(pt.m).padStart(2, '0')} PT)`;

  const gh = (path, init = {}) => fetch(GH + path, Object.assign({}, init, { headers: {
    Authorization: `Bearer ${env.GH_TOKEN}`, Accept: 'application/vnd.github+json', 'User-Agent': 'FBP refresh trigger', 'X-GitHub-Api-Version': '2022-11-28' } }));
  // already ran (or is running) since the window opened? then nothing to do
  const runs = await (await gh('/runs?per_page=5')).json();
  if ((runs.workflow_runs || []).some(r => Date.parse(r.created_at) / 1000 >= since)) return `${why}: already refreshed`;

  if (why === 'morning') {
    // waiver claims processed this morning? MFL lists them as WAIVER / BBID_WAIVER transactions
    const j = await (await fetch(`${LEAGUE}&TYPE=transactions&DAYS=1`, { headers: { 'User-Agent': 'FBP refresh trigger' } })).json();
    let tx = (j.transactions || {}).transaction || [];
    if (!Array.isArray(tx)) tx = [tx];
    const claims = tx.some(t => /WAIVER/.test(t.type || '') && +t.timestamp >= since);
    if (!claims && mins < 9 * 60 + 45) return 'morning: waivers not in yet';
    why += claims ? ', waivers processed' : ', no waiver claims by 9:45';
  }
  const r = await gh('/dispatches', { method: 'POST', body: JSON.stringify({ ref: 'main' }) });
  return r.status === 204 ? `${why}: refresh started` : `${why}: GitHub said ${r.status} ${await r.text()}`;
}
