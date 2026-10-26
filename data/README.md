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
| `player-links.json` | computed (`scripts/link_players.py`) | MFL player id → ESPN id, how it was linked, and the display name (ESPN's spelling, e.g. "Patrick Mahomes II") |
| `player-links-report.json` | computed | every name disagreement: MFL ids that point to someone else, players linked by name, ESPN ids not on a roster, and players not found (FBP-rostered first) |
| `player-overrides.json` | hand-maintained | corrections the linker applies first: `"<MFL id>": "<ESPN id>"`, or `null` to unlink |
| `fantasypros/*.json` | FantasyPros API (`scripts/refresh_fantasypros.py`) | **off for now**: the free tier returns only the top 10 players per list |
| `nfl-draft-order.json` | Tankathon full 2027 draft order (`scripts/refresh_tankathon.py`) | all 7 rounds (257 picks) with traded picks; the Rookie Draft uses it for each rookie's projected landing spot. Team codes match ESPN |
| `mfl/weeklyResults.json` | MFL `TYPE=weeklyResults` per played week (`scripts/refresh_mfl.py`) | each team's starters and bench with points, by week |
| `mfl/transactions.json` | MFL `TYPE=transactions` | this season's trades, waiver claims (with FAAB bids) and free-agent pickups |
| `awards.json` | computed (`scripts/awards.py`) | the Awards tab: All-FBP 1st and 2nd teams and season awards, from starter points of rostered players |
| `draft-order-history.json` | computed (`scripts/league_now.py`) | the round-1 order each week, for movement arrows on the Rookie Draft page |
| `league-now.json` | computed (`scripts/league_now.py`) | standings, seeds, tiebreaks, draft order, playoff odds |
| `reference/history.json` | hand-maintained (moved from the migliopolis/fbpreference almanac) | frozen league history 2019 on: seasons, schedules and scores, brackets, champions, rookie draft classes, auctions |
| `reference.json` | computed (`scripts/build_reference.py`) | the Reference tab: history plus this season's games from `mfl/`, with all-time records, head-to-head and record tables recomputed from the scores. `--check` compares against the frozen copy |
| `teams.json`, `budgets.json` | hand-maintained | FBP team colors and logos; 2027 auction budgets and cash trades |
| `bylaws-2027.md` → `bylaws.json` | hand-maintained (`scripts/build_bylaws.py`) | the By-Laws tab |

Each fetch keeps the previous file if a request fails and records what happened in that folder's `_meta.json`.

## Using it on a page
`assets/site.js` exposes `window.FBP`:
- `FBP.media.headshotFor(mflPlayerId)` → ESPN photo URL (or `''`), using the checked link
- `FBP.media.name(mflPlayerId)` → display name in ESPN's spelling (First Last, with Jr./II)
- `FBP.media.link(mflPlayerId)` → `{espn, how, name}`
- `FBP.media.headshot(espnId)` → `https://a.espncdn.com/i/headshots/nfl/players/full/<id>.png`
- `FBP.media.nflLogo(mflTeamCode, dark)` → ESPN logo URL (handles MFL codes like `GBP`, `KCC`, `SFO`)
- `FBP.media.player(mflPlayerId)` → the `mfl/players.json` row as an object
- `FBP.media.img(url, cls, alt)` → `<img>` markup that removes itself if the image is missing
- `FBP.data('espn/injuries')` → any file in this folder (cached)

## Player name matching
MFL and ESPN spell some names differently (Pat/Patrick, D.J./DJ, suffixes like Jr. or II, accents, "Last, First"). `scripts/link_players.py` links by MFL's ESPN id first, checks that the names agree, and falls back to a normalized-name match (suffixes, punctuation and accents ignored; common nicknames treated as the same first name; team breaks ties). Anything it can't settle is listed in `player-links-report.json`; fix those by adding a line to `player-overrides.json`.

## More ESPN data
ESPN's feeds are public and undocumented, so they can change without notice. More endpoints (depth charts, player stats and game logs, transactions, the NFL draft) are listed in https://gist.github.com/nntrn/ee26cb2a0716de0947a0a4e9a157bc1c. Add a function to `scripts/refresh_espn.py` to save another one. Live scores are deliberately not fetched.
