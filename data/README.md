# Site data

Everything here is written by the weekly GitHub Action (`.github/workflows/refresh-data.yml`, Mondays 10 PM PST) unless noted. The site reads these files; it never calls MFL, ESPN or FantasyPros from the browser.

| Folder / file | Source | What it holds |
|---|---|---|
| `mfl/*.json` | MFL export API (`scripts/refresh_mfl.py`) | league, standings, schedule, rosters, future draft picks, auction and draft results |
| `mfl/players.json` | MFL `TYPE=players&DETAILS=1` via api.myfantasyleague.com | every QB/RB/WR/TE/DST: name, position, team, **espn_id**, sportsdata_id, NFL draft year/round/pick, college, birthdate |
| `espn/teams.json` | ESPN `site.api.espn.com/.../nfl/teams` (`scripts/refresh_espn.py`) | 32 NFL teams: ESPN id, names, colors, logo URLs (light and dark) |
| `espn/athletes.json` | ESPN team rosters | every rostered NFL player by ESPN id: name, position, team, jersey, age, experience, status, injury, has-headshot |
| `espn/injuries.json` | ESPN league injuries | current injuries by ESPN id: status, short note, date, type, expected return |
| `espn/news.json` | ESPN league news | latest 40 headlines with links and the ESPN ids they mention |
| `fantasypros/*.json` | FantasyPros API (`scripts/refresh_fantasypros.py`) | **off for now**: the free tier returns only the top 10 players per list |
| `league-now.json` | computed (`scripts/league_now.py`) | standings, seeds, tiebreaks, draft order, playoff odds |
| `teams.json`, `budgets.json` | hand-maintained | FBP team colors and logos; 2027 auction budgets and cash trades |
| `bylaws-2027.md` → `bylaws.json` | hand-maintained (`scripts/build_bylaws.py`) | the By-Laws tab |

Each fetch keeps the previous file if a request fails and records what happened in that folder's `_meta.json`.

## Using it on a page
`assets/site.js` exposes `window.FBP`:
- `FBP.media.headshotFor(mflPlayerId)` → ESPN photo URL (or `''`)
- `FBP.media.headshot(espnId)` → `https://a.espncdn.com/i/headshots/nfl/players/full/<id>.png`
- `FBP.media.nflLogo(mflTeamCode, dark)` → ESPN logo URL (handles MFL codes like `GBP`, `KCC`, `SFO`)
- `FBP.media.player(mflPlayerId)` → the `mfl/players.json` row as an object
- `FBP.media.img(url, cls, alt)` → `<img>` markup that removes itself if the image is missing
- `FBP.data('espn/injuries')` → any file in this folder (cached)

## More ESPN data
ESPN's feeds are public and undocumented, so they can change without notice. More endpoints (depth charts, player stats and game logs, transactions, the NFL draft) are listed in https://gist.github.com/nntrn/ee26cb2a0716de0947a0a4e9a157bc1c. Add a function to `scripts/refresh_espn.py` to save another one. Live scores are deliberately not fetched.
