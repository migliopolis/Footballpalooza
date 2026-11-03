// FBP live scoreboard relay (Cloudflare Worker).
// Fetches MFL's public live scoring for league 14482 and hands it to the hub site, which browsers can't read from MFL directly.
// Only this one export can be requested, so it can't be used as an open proxy. No keys or secrets needed.
export default {
  async fetch(request) {
    const url = new URL(request.url);
    const w = url.searchParams.get('w');
    const week = w && /^\d{1,2}$/.test(w) ? `&W=${w}` : '';   // default: MFL's current week
    const mfl = `https://www47.myfantasyleague.com/2026/export?TYPE=liveScoring&L=14482&DETAILS=1&JSON=1${week}`;
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
