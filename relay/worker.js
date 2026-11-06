// FBP live scoreboard relay (Cloudflare Worker).
// Hands the hub site two of MFL's public exports for league 14482, which browsers can't read from MFL directly:
//   (default)  live scoring for every FBP lineup        ?w=9 for a given week
//   ?t=fa      free agents' points for the week (Game Day > Players)   ?t=fa&w=9
// Only these two can be requested, so it can't be used as an open proxy. No keys or secrets needed.
export default {
  async fetch(request) {
    const url = new URL(request.url);
    const w = url.searchParams.get('w');
    const week = w && /^\d{1,2}$/.test(w) ? `&W=${w}` : '';   // default: MFL's current week
    const base = 'https://www47.myfantasyleague.com/2026/export?L=14482&JSON=1';
    const mfl = url.searchParams.get('t') === 'fa'
      ? `${base}&TYPE=playerScores&STATUS=freeagent${week || '&W=YTD'}`
      : `${base}&TYPE=liveScoring&DETAILS=1${week}`;
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
};
