#!/usr/bin/env python3
"""Build data/rosters.json for League Now > Rosters: every FBP roster with contracts, stats and honors.

Per player: salary and contract year, future salaries from the by-law escalators, how he joined his current team,
this season's points (every week he was on an FBP roster, started or benched), rank among rostered players at his
position, this week's MFL projection, FantasyPros rest-of-season rank (data/fantasypros/ros-ecr.json), NFL bye
(data/reference/byes-2026.json) and this season's award chips.

Contracts: MFL's contract year, except that a player picked up off waivers or as a free agent this season is on a new
3-year veteran deal (1/3), whatever MFL shows. Escalators: veteran +$3, +$6; rookie +$3, +$6, +$9, +$12; a rookie on
taxi in year 1 is shown on the 6-year path (salary frozen in year 2, then +$3, +$6, +$9, +$12).

Acquired: the latest way the player joined his current team, from MFL transactions (every season saved), auctions
and rookie drafts. MFL's own "drafted" note is only a fallback.

Per team: points by week against the league average, low and high, and the Face of the Franchise.
Run after refresh_mfl.py, league_now.py, build_reference.py and player_records.py: python scripts/rosters.py
"""
import json, os, re, sys, collections
from datetime import datetime, date, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from payroll import names_pos
from player_records import lineups

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
D = lambda *p: os.path.join(ROOT, 'data', *p)
load = lambda p, d=None: json.load(open(p, encoding='utf-8')) if os.path.exists(p) else d
as_list = lambda x: x if isinstance(x, list) else ([x] if x else [])
STEP = {3: [3, 6], 5: [3, 6, 9, 12], 6: [0, 3, 6, 9, 12]}
TM = {'GBP': 'GB', 'KCC': 'KC', 'NEP': 'NE', 'NOS': 'NO', 'SFO': 'SF', 'TBB': 'TB', 'LVR': 'LV', 'JAX': 'JAC', 'WSH': 'WAS', 'LA': 'LAR'}
P_AWARDS = {'mvp': ['MVP', 'gold'], 'rookie': ['RoY', 'good'], 'value': ['Best Value', 'good'], 'waiver': ['Top Waiver', 'good'],
            'high': ['High Game', 'good'], 'bench': ['Bench Points', 'meh'], 'contract': ['Worst Contract', 'meh']}


def future(sal, n, N, status):
    if status == 'TAXI_SQUAD' and N == 5 and n == 1:
        N = 6
    out, v = [], sal
    for k in range(n, N):
        v += STEP[N][k - 1]
        out.append(v)
    return out


def acquisitions(cur, abbr):
    """{player: [(timestamp, franchise, label, kind, season)]}"""
    ev = collections.defaultdict(list)
    stamp = lambda ts: datetime.fromtimestamp(ts, timezone.utc).strftime('%b %Y')
    for y in range(2019, cur + 1):
        tx = (load(D('mfl', 'transactions.json') if y == cur else D('history', str(y), 'transactions.json'), {}) or {}).get('transactions') or []
        for x in tx:
            ts = int(x.get('timestamp') or 0); d = stamp(ts)
            if x.get('type') == 'BBID_WAIVER':
                parts = (x.get('transaction', '') + '||').split('|')
                for p in filter(None, parts[0].split(',')):
                    ev[p].append((ts, x['franchise'], f'Waivers · {d}', 'waiver', y))
            elif x.get('type') == 'FREE_AGENT':
                for p in filter(None, x.get('transaction', '').split('|')[0].split(',')):
                    ev[p].append((ts, x['franchise'], f'Free agent · {d}', 'fa', y))
            elif x.get('type') == 'TRADE':
                f1, f2 = x['franchise'], x.get('franchise2')
                for gave, to, frm in (('franchise1_gave_up', f2, f1), ('franchise2_gave_up', f1, f2)):
                    for p in x.get(gave, '').split(','):
                        if p and not p.startswith(('FP_', 'DP_')):
                            ev[p].append((ts, to, f'Trade from {abbr(frm)} · {d}', 'trade', y))
    ref = load(D('reference.json'), {}) or {}
    for y, lst in (ref.get('auction_results') or {}).items():
        for a in lst:
            ts = int(a.get('timestamp') or datetime(int(y), 8, 25, tzinfo=timezone.utc).timestamp())
            ev[a['player_id']].append((ts, a['franchise'], f"Auction ${a['price']} · {y}", 'auction', int(y)))
    au = (((load(D('mfl', 'auctionResults.json'), {}) or {}).get('auctionResults') or {}).get('auctionUnit') or {}).get('auction')
    for a in as_list(au):
        ev[a['player']].append((int(a.get('lastBidTime') or 0), a['franchise'], f"Auction ${a['winningBid']} · {cur}", 'auction', cur))
    for y, lst in (ref.get('draft_classes') or {}).items():
        for a in lst:
            ts = int(datetime(int(y), 6, 20, tzinfo=timezone.utc).timestamp())
            ev[a['player_id']].append((ts, a['franchise'], f"Draft {int(a['round'])}.{a['pick']} · {y}", 'draft', int(y)))
    dr = (((load(D('mfl', 'draftResults.json'), {}) or {}).get('draftResults') or {}).get('draftUnit') or {}).get('draftPick')
    for a in as_list(dr):
        if a.get('player'):
            ev[a['player']].append((int(a.get('timestamp') or 0), a['franchise'], f"Draft {int(a['round'])}.{a['pick']} · {cur}", 'draft', cur))
    return ev


def honors_now(aw):
    """this season's chips: {player: [[label, color, title]]}"""
    H = collections.defaultdict(list)
    af = (aw or {}).get('allFbp') or {}
    for k, l, c in (('first', '1st Team', 'gold'), ('second', '2nd Team', 'silver')):
        for x in af.get(k, []):
            if x.get('player'):
                H[x['player']['id']].append([l, c, f'All-FBP {l}'])
    potw = collections.Counter()
    for a in (aw or {}).get('awards', []):
        if a.get('key') in P_AWARDS and a.get('list'):
            H[a['list'][0]['id']].append(P_AWARDS[a['key']] + [f"{a.get('title', '')}: {a.get('why', '')}"])
        if a.get('key') == 'trade' and (a.get('trade') or {}).get('winner'):
            W = a['trade']['winner']; later = W.get('later') or {}; cur = later.get('current')
            rows = [((r.get('pts') or {}).get(cur, 0), r['id']) for r in later.get('rows', [])]
            if rows and max(rows)[0] > 0:
                H[max(rows)[1]].append(['ToY', 'good', 'Trade of the Year'])
        if a.get('key') == 'week':
            for w, L in (a.get('weeks') or {}).items():
                if L:
                    potw[L[0]['id']] += 1
    for pid, n in potw.items():
        H[pid].append(['POTW' + (f' ×{n}' if n > 1 else ''), 'good', f'Player of the Week {n} time' + ('s' if n > 1 else '')])
    return H


def face_of_franchise(cur, rostered, names, pos, espn):
    """{franchise: {...}}: the current player with the most history with that team (starts, seasons, honors, titles)."""
    pr = load(D('player-records.json'), {}) or {}
    tf = pr.get('team_fields', [])
    rec = {}
    for row in pr.get('players', []):
        for t in row[-1]:
            rec[(row[0], t[0])] = dict(zip(tf, t))
    hon = collections.defaultdict(lambda: collections.Counter())
    for y in range(2019, cur + 1):
        aw = load(D('awards.json') if y == cur else D('awards', f'{y}.json'))
        if not aw:
            continue
        for k, l in (('first', '1st Team'), ('second', '2nd Team')):
            for x in (aw.get('allFbp') or {}).get(k, []):
                p = x.get('player') or {}
                if p.get('team'):
                    hon[(p['id'], p['team'])][l] += 1
        for a in aw.get('awards', []):
            if a.get('key') in ('mvp', 'rookie') and a.get('list'):
                p = a['list'][0]
                if p.get('team'):
                    hon[(p['id'], p['team'])][{'mvp': 'MVP', 'rookie': 'RoY'}[a['key']]] += 1
    # titles: started the championship game for the champion
    ref = load(D('reference.json'), {}) or {}
    L = lineups(cur)
    titles = collections.Counter()
    for y, c in (ref.get('championships') or {}).items():
        wk = (L.get(int(y)) or {}).get(int(c.get('week') or 0)) or {}
        for pid, _ in wk.get(c['champion'], []):
            titles[(pid, c['champion'])] += 1
    out = {}
    for f, pids in rostered.items():
        best = None
        for pid in pids:
            r = rec.get((pid, f), {})
            starts = sum(r.get(k, 0) for k in ('w', 'l', 't', 'pw', 'pl', 'pt'))
            seasons = len(r.get('years', []))
            h = hon[(pid, f)]; ti = titles[(pid, f)]
            score = starts + 4 * seasons + 12 * h['1st Team'] + 6 * h['2nd Team'] + 10 * h['MVP'] + 4 * h['RoY'] + 15 * ti
            if score and (not best or score > best[0]):
                yrs = r.get('years', [])
                best = (score, {'id': pid, 'name': names.get(pid, pid), 'pos': pos.get(pid, ''), 'espn': espn.get(pid, '') or '',
                                'seasons': seasons, 'first': min(yrs) if yrs else None, 'starts': starts,
                                'w': r.get('w', 0) + r.get('pw', 0), 'l': r.get('l', 0) + r.get('pl', 0), 't': r.get('t', 0) + r.get('pt', 0),
                                'honors': {k: v for k, v in h.items()}, 'titles': ti})
        if best:
            out[f] = best[1]
    return out


def ordinal(n):
    return f"{n}{'th' if 11 <= n % 100 <= 13 else {1: 'st', 2: 'nd', 3: 'rd'}.get(n % 10, 'th')}"


def season_note(f, t, s, std, mu, started, names, abbr_name):
    """State of the Team: a short paragraph on the season (facts, then a line or two of read on them) and, separately,
    the next game. Returns {'body': ..., 'next': ...}. The read comes from signals in the numbers (record vs. all-play,
    lineup efficiency, recent form, how much the lineup leans on one player, week-to-week swings), never put-downs."""
    W = t['weeks']
    if not W:
        return {}
    rec = f"{s['w']}-{s['l']}" + (f"-{s['t']}" if s.get('t') else '')
    pf_rank = sorted(std, key=lambda x: -x['pf']).index(s) + 1
    seed = s.get('seed')
    where = (f"{ordinal(s['divisionRank'])} in the {s['divisionName']}" if s.get('divisionName') else '')
    spot = f"the {seed} seed today" if seed else "outside the playoff picture today"
    out = [f"{t['name']} {'are' if t['name'].endswith('s') and not t['name'].endswith('ss') else 'is'} {rec}, {where} and {spot}, "
           f"with {s['pf']:,.1f} points ({ordinal(pf_rank)} in the league)."]
    st = s.get('streak') or ''
    last3 = W[-3:]; l3 = sum(x['pts'] for x in last3) / len(last3)
    if st[:1] in 'WL' and st[1:].isdigit() and int(st[1:]) >= 2:
        out.append(f"They've {'won' if st[0] == 'W' else 'lost'} {int(st[1:])} straight, averaging {l3:.1f} over the last three weeks.")
    else:
        lw = W[-1]
        out.append(f"They {'won' if lw['res'] == 'W' else 'lost' if lw['res'] == 'L' else 'tied'} in week {lw['w']}, {lw['pts']:.1f} to {lw['oppPts']:.1f} against {abbr_name(lw['opp'])}, "
                   f"and have averaged {l3:.1f} over the last three weeks.")
    top = sorted(started.items(), key=lambda kv: -kv[1])[:2]
    if top:
        out.append(f"{names.get(top[0][0], top[0][0])} leads the lineup with {top[0][1]:.1f} points started"
                   + (f", ahead of {names.get(top[1][0], top[1][0])} ({top[1][1]:.1f})." if len(top) > 1 else '.'))
    hi = max(W, key=lambda x: x['pts']); lo = min(W, key=lambda x: x['pts'])
    out.append(f"Their best week was {hi['pts']:.1f} in week {hi['w']}; their lowest, {lo['pts']:.1f} in week {lo['w']}.")
    # the read: score each signal by how far it sits from normal and keep the two strongest
    n = len(W); g = s['w'] + s['l'] + s.get('t', 0)
    ap_n = s['allPlayW'] + s['allPlayL'] + s.get('allPlayT', 0)
    xw = (s['allPlayW'] + s.get('allPlayT', 0) / 2) / ap_n * g if ap_n else s['w']
    luck = s['w'] + s.get('t', 0) / 2 - xw
    eff = s['pf'] / s['pp'] if s.get('pp') else None
    league_eff = sum(x['pf'] for x in std) / sum(x['pp'] for x in std if x.get('pp'))
    avg = s['pf'] / n
    sd = (sum((x['pts'] - avg) ** 2 for x in W) / n) ** .5
    top_share = top[0][1] / s['pf'] if top and s['pf'] else 0
    lead = names.get(top[0][0], '') if top else ''
    pick = lambda *v: v[int(f) % len(v)]   # two wordings per read, so teams with the same read don't sound alike
    reads = []
    if luck >= 1.2:
        reads.append((luck, pick("The record has run ahead of the scoring, so the close ones have broken their way; keeping that up means the points need to catch up to the wins.",
                                 "They've won more than the points alone would predict. That's a credit to timing, and the next step is scoring like the record says.")))
    elif luck <= -1.2:
        reads.append((-luck, pick("The scoring says this team is better than its record. Weeks like theirs tend to turn into wins over time, so the standings may still come around.",
                                  "They've drawn some tough matchups on good weeks; the scoring is there, and the wins usually follow it.")))
    if eff is not None and eff - league_eff >= .025:
        reads.append(((eff - league_eff) * 50, pick("The lineup calls have been sharp, with few points left sitting on the bench.",
                                                    "Start/sit has been a strength: the right guys are usually the ones in the lineup.")))
    elif eff is not None and league_eff - eff >= .025:
        reads.append(((league_eff - eff) * 50, pick("There have been points left on the bench, which is the good kind of problem: the depth is there, and tighter start/sit calls could swing a close week.",
                                                    "The bench has been outscoring some of the starters. The talent is on the roster; picking the right week for each player is the next gain.")))
    if n >= 4 and l3 - avg >= 10:
        reads.append(((l3 - avg) / 8, pick("The arrow is pointing up, with the last few weeks the best stretch of the year.", "They're playing their best football right now.")))
    elif n >= 4 and avg - l3 >= 10:
        reads.append(((avg - l3) / 8, pick("The last few weeks have been quieter than the start, so getting back to that early-season form is the job now.",
                                           "The early-season pace has cooled; a couple of strong weeks would get things back on track.")))
    if top_share >= .2:
        reads.append(((top_share - .15) * 20, pick(f"{lead} has carried a big share of the load, and the lineup goes as he goes.",
                                                   f"A lot runs through {lead}; more help around him would make this lineup harder to slow down.")))
    if sd >= 30:
        reads.append(((sd - 26) / 6, pick("Week to week this team can look like a contender or an underdog, and finding a steadier floor would go a long way.",
                                          "Few teams swing more from week to week: when it clicks it's among the league's best.")))
    elif sd <= 14 and n >= 4:
        reads.append(((17 - sd) / 4, pick("They've been one of the steadier teams in the league, rarely blowing up and rarely falling flat.",
                                          "Consistency is the calling card: you know roughly what you'll get each week.")))
    for _, line in sorted(reads, key=lambda r: -r[0])[:2]:
        out.append(line)
    nxt = ''
    if mu:
        opp = mu['opp']; p = mu['me']
        line = f"Up next: {abbr_name(opp)} in week {mu['week']}"
        if p.get('winProb') is not None:
            line += f", where the site gives them a {p['winProb']}% chance to win"
        if p.get('playoff') is not None and p.get('ifWin') and p.get('ifLoss') and 0.5 < p['playoff'] < 99.5:
            line += f". A win would move their playoff odds from {p['playoff']:.0f}% to {p['ifWin'][0]:.0f}%; a loss, to {p['ifLoss'][0]:.0f}%."
        else:
            line += '.'
        nxt = line
    return {'body': ' '.join(out), 'next': nxt}


NFL_NICK = {'Cardinals','Falcons','Ravens','Bills','Panthers','Bears','Bengals','Browns','Cowboys','Broncos','Lions','Packers','Texans','Colts','Jaguars','Chiefs','Raiders','Chargers','Rams','Dolphins','Vikings','Patriots','Saints','Giants','Jets','Eagles','Steelers','49ers','Seahawks','Buccaneers','Titans','Commanders'}


def week_news(f, t, played, wr, names, espn, inj, trades, team_name):
    """last week's game and the team's news (trades in the past week, injuries to regular starters)"""
    W = t['weeks']; last = W[-1] if W else None
    out = {}
    if last and last.get('opp'):
        st_ = sorted((wr.get(str(last['w'])) or {}).get(f, {}).get('s', []), key=lambda x: -x[1])
        def who(pid):
            n = names.get(pid, pid)
            if any(r['id'] == pid and r['pos'] == 'DEF' for r in t['rows']) or n.split(' ')[-1] in NFL_NICK:
                return f"the {n.split(' ')[-1]} defense's"
            return f"{n}'" + ('' if n.endswith('s') else 's')
        lead = f", led by {who(st_[0][0])} {st_[0][1]:.1f}" if st_ else ''
        verb = {'W': 'beat', 'L': 'lost to', 'T': 'tied'}.get(last['res'], 'played')
        out['last'] = f"Week {last['w']}: {verb} {team_name(last['opp'])} {last['pts']:.1f} to {last['oppPts']:.1f}{lead}."
    news = []
    for tr in trades:
        if f in (tr['a'], tr['b']):
            got, gave = (tr['toA'], tr['toB']) if f == tr['a'] else (tr['toB'], tr['toA'])
            other = tr['b'] if f == tr['a'] else tr['a']
            if got or gave:
                news.append(f"Traded with {team_name(other)}: got {', '.join(got) or 'picks'} for {', '.join(gave) or 'picks'}.")
    # injuries that matter: out, doubtful or on IR, for a regular starter (3+ starts for this team) or a player
    # FantasyPros ranks as a starter the rest of the way
    starts = collections.Counter(pid for w in range(1, played + 1) for pid, _ in ((wr.get(str(w)) or {}).get(f, {}).get('s', [])))
    big = {'QB': 15, 'TE': 12, 'RB': 30, 'WR': 36}
    hurt = []
    for r in t['rows']:
        i = inj.get(str(r.get('espn') or ''))
        if not i or i.get('status') not in ('Out', 'Doubtful', 'Injured Reserve'):
            continue
        if starts.get(r['id'], 0) < 3 and not (r.get('ecrPos') and r['ecrPos'] <= big.get(r['pos'], 0)):
            continue
        what = {'Out': 'is out', 'Doubtful': 'is doubtful', 'Injured Reserve': 'is on injured reserve'}[i['status']]
        hurt.append(f"{r['name']} {what}{' (' + i['type'].lower() + ')' if i.get('type') else ''}")
    if hurt:
        news.append('Injuries: ' + '; '.join(hurt) + '.')
    if news:
        out['news'] = ' '.join(news)
    return out


BIG = {'QB': 25, 'RB': 20, 'WR': 20, 'TE': 15}
DUD = {'QB': 10, 'RB': 5, 'WR': 5, 'TE': 3}
STARTER = {'QB': 16, 'RB': 10, 'WR': 10, 'TE': 7}


def profiles(rows_by_team, weekly, played, pos, wks_of):
    """scoring archetypes from every week's points: {player: [[label, why]]}, at most two per player.
    weekly: {week: {player: pts}} for all players (falls back to FBP-roster weeks when missing)."""
    top3 = {}
    for w, sc in weekly.items():
        byp = collections.defaultdict(list)
        for pid, v in sc.items():
            byp[pos.get(pid)].append(v)
        for p_, vals in byp.items():
            vals.sort(reverse=True)
            top3[(w, p_)] = vals[2] if len(vals) >= 3 else (vals[-1] if vals else 999)
    out = {}
    for f, rows in rows_by_team.items():
        for r in rows:
            p_ = r['pos']
            if p_ not in BIG:
                continue
            pts = [weekly[w][r['id']] for w in weekly if r['id'] in weekly[w]] if weekly else [v[0] for v in wks_of(r['id']).values()]
            n = len(pts)
            if n < 4:
                continue
            tot = sum(pts); mean = tot / n
            sd = (sum((x - mean) ** 2 for x in pts) / n) ** .5
            srt = sorted(pts); p25 = srt[max(0, int(n * .25) - (1 if n % 4 == 0 else 0))]
            bigs = sum(x >= BIG[p_] for x in pts); duds = sum(x < DUD[p_] for x in pts)
            tops = sum(1 for w in weekly if r['id'] in weekly[w] and weekly[w][r['id']] >= top3.get((w, p_), 999)) if weekly else 0
            bench_big = sum(1 for v in wks_of(r['id']).values() if not v[1] and v[0] >= BIG[p_])
            cand = []
            if bigs >= 2 and duds >= 2:
                cand.append((3, 'Boom or Bust', f'{bigs} weeks of {BIG[p_]}+ and {duds} under {DUD[p_]}'))
            if mean >= STARTER[p_] and duds == 0 and sd / mean <= .35:
                cand.append((3, 'Mr. Reliable', f'no week under {DUD[p_]}, and few swings either way'))
            elif p25 >= STARTER[p_]:
                cand.append((2, 'High Floor', f'even his bottom quarter of weeks is {p25:.1f}+'))
            if p25 < DUD[p_] and mean >= STARTER[p_] and not (bigs >= 2 and duds >= 2):
                cand.append((2, 'Low Floor', f'a quarter of his weeks are under {DUD[p_]}'))
            if tops >= 2:
                cand.append((3, 'Ceiling Chaser', f'top 3 at {p_} in {tops} weeks'))
            if n >= 5 and tot > 0 and max(pts) >= .4 * tot:
                cand.append((1, 'One-Week Wonder', f'{max(pts):.1f} of his {tot:.1f} points came in one week'))
            if bench_big >= 2:
                cand.append((2, 'Bench Bomb', f'{bench_big} weeks of {BIG[p_]}+ on an FBP bench'))
            cand.sort(key=lambda c: -c[0])
            if cand:
                out[r['id']] = [[c[1], c[2]] for c in cand[:2]]
    return out


def journeys(ids, cur, abbr, names):
    """every FBP move for each player: drafts, auctions, trades, waiver and free-agent pickups, releases
    (transactions from 2021 on; auctions and drafts from the start)"""
    ev = collections.defaultdict(list)
    for y in range(2019, cur + 1):
        tx = (load(D('mfl', 'transactions.json') if y == cur else D('history', str(y), 'transactions.json'), {}) or {}).get('transactions') or []
        for x in tx:
            ts = int(x.get('timestamp') or 0); f = x.get('franchise'); ty = x.get('type')
            if ty in ('BBID_WAIVER', 'FREE_AGENT'):
                parts = (x.get('transaction', '') + '||').split('|')
                adds = [p for p in parts[0].split(',') if p]
                drops = [p for p in (parts[2] if ty == 'BBID_WAIVER' else parts[1]).split(',') if p]
                bid = parts[1] if ty == 'BBID_WAIVER' else ''
                for p in adds:
                    if p in ids:
                        try: b = f' for ${float(bid):.0f}' if bid and float(bid) else ''
                        except ValueError: b = ''
                        ev[p].append([ts, f, 'waiver' if ty == 'BBID_WAIVER' else 'fa',
                                      f'Claimed off waivers{b}' if ty == 'BBID_WAIVER' else 'Signed as a free agent'])
                for p in drops:
                    if p in ids:
                        ev[p].append([ts, f, 'drop', 'Released'])
            elif ty == 'TRADE':
                f2 = x.get('franchise2')
                for gave, to, frm in (('franchise1_gave_up', f2, f), ('franchise2_gave_up', f, f2)):
                    for p in x.get(gave, '').split(','):
                        if p in ids:
                            ev[p].append([ts, to, 'trade', f'Traded from {abbr(frm)}'])
    ref = load(D('reference.json'), {}) or {}
    for y, lst in (ref.get('auction_results') or {}).items():
        for a in lst:
            if a['player_id'] in ids:
                ts = int(a.get('timestamp') or datetime(int(y), 8, 25, tzinfo=timezone.utc).timestamp())
                ev[a['player_id']].append([ts, a['franchise'], 'auction', f"Won at auction for ${a['price']}"])
    au = (((load(D('mfl', 'auctionResults.json'), {}) or {}).get('auctionResults') or {}).get('auctionUnit') or {}).get('auction')
    for a in as_list(au):
        if a['player'] in ids:
            ev[a['player']].append([int(a.get('lastBidTime') or 0), a['franchise'], 'auction', f"Won at auction for ${a['winningBid']}"])
    for y, lst in (ref.get('draft_classes') or {}).items():
        for a in lst:
            if a['player_id'] in ids:
                ev[a['player_id']].append([int(datetime(int(y), 6, 20, tzinfo=timezone.utc).timestamp()), a['franchise'], 'draft', f"Drafted {int(a['round'])}.{a['pick']} in the rookie draft"])
    dr = (((load(D('mfl', 'draftResults.json'), {}) or {}).get('draftResults') or {}).get('draftUnit') or {}).get('draftPick')
    for a in as_list(dr):
        if a.get('player') in ids:
            ev[a['player']].append([int(a.get('timestamp') or 0), a['franchise'], 'draft', f"Drafted {int(a['round'])}.{a['pick']} in the rookie draft"])
    out = {}
    for p, lst in ev.items():
        seen, uniq = set(), []
        for e in sorted(lst):
            yr = datetime.fromtimestamp(e[0], timezone.utc).year
            k = (yr, e[1], e[2]) if e[2] in ('auction', 'draft') else (e[0] // 60, e[1], e[2])
            if k not in seen:
                seen.add(k); uniq.append(e)
        out[p] = uniq
    return out


def main():
    ln = load(D('league-now.json'))
    played = int(ln['weeksPlayed'])
    cur = int((load(D('reference.json'), {}) or {}).get('meta', {}).get('current_year') or datetime.now().year)
    names, pos, espn = names_pos()
    league = ((load(D('mfl', 'league.json'), {}) or {}).get('league') or {})
    fr = {f['id']: f for f in as_list((league.get('franchises') or {}).get('franchise'))}
    teams = (load(D('teams.json'), {}) or {}).get('teams', {})
    abbr = lambda f: (teams.get(f) or {}).get('abbr', f)
    pl = load(D('mfl', 'players.json'), {}) or {}
    P = {k: dict(zip(pl.get('fields', []), v)) for k, v in (pl.get('players') or {}).items()}
    st = {s['id']: s for s in ln['standings']}
    wr = (load(D('mfl', 'weeklyResults.json'), {}) or {}).get('weeks', {})
    proj = load(D('mfl', 'projections.json'), {}) or {}
    pw = str(proj.get('week') or played + 1); PJ = (proj.get('players') or {}).get(pw, {})
    ecr = load(D('fantasypros', 'ros-ecr.json'), {}) or {}
    byes = (load(D('reference', 'byes-2026.json'), {}) or {}).get('byes', {})
    H = honors_now(load(D('awards.json'), {}))
    ev = acquisitions(cur, abbr)

    pts, wks = collections.defaultdict(float), {}
    for w, ft in wr.items():
        if int(w) > played:
            continue
        for f, t in ft.items():
            for pid, x in t.get('s', []):
                pts[pid] += x; wks.setdefault(pid, {})[w] = [x, 1, abbr(f)]
            for pid, x in t.get('n', []):
                pts[pid] += x; wks.setdefault(pid, {})[w] = [x, 0, abbr(f)]
    # season points and games for every player, rostered, taxi or free agent (MFL's weekly scores), with the FBP
    # lineup weeks filling any gap. Rank is this season's points among everyone at the position.
    wsc = collections.defaultdict(dict)
    for w, sc in ((load(D('mfl', 'weeklyScores.json'), {}) or {}).get('weeks') or {}).items():
        if int(w) <= played:
            for pid, v in sc.items():
                wsc[pid][w] = v
    for pid, ws in wks.items():
        for w, v in ws.items():
            wsc[pid].setdefault(w, v[0])
    pts = {pid: sum(ws.values()) for pid, ws in wsc.items()}
    byPos = collections.defaultdict(list)
    for pid, v in pts.items():
        byPos[pos.get(pid)].append((v, pid))
    rk = {pid: i + 1 for lst in byPos.values() for i, (_, pid) in enumerate(sorted(lst, reverse=True))}
    today = date.today()

    def age(b):
        try:
            d = date.fromtimestamp(int(b)); return today.year - d.year - ((today.month, today.day) < (d.month, d.day))
        except (TypeError, ValueError):
            return None

    # team weeks
    games = {}
    for w, a, sa, b, sb in ln.get('games', []):
        games[(w, a)] = (b, sa, sb); games[(w, b)] = (a, sb, sa)
    team_weeks = collections.defaultdict(list)
    for w in range(1, played + 1):
        sc = {f: round(sum(x[1] for x in t.get('s', [])), 1) for f, t in (wr.get(str(w)) or {}).items()}
        if not sc:
            continue
        avg = sum(sc.values()) / len(sc)
        for f, v in sc.items():
            o = games.get((w, f))
            res = None if not o else 'W' if o[1] > o[2] else 'L' if o[1] < o[2] else 'T'
            team_weeks[f].append({'w': w, 'pts': v, 'avg': round(avg, 1), 'hi': max(sc.values()), 'lo': min(sc.values()),
                                  'res': res, 'opp': o[0] if o else None, 'oppPts': o[2] if o else None})

    rosters = ((load(D('mfl', 'rosters.json'), {}) or {}).get('rosters') or {}).get('franchise', [])
    out_t, fixed = {}, 0
    for f in rosters:
        rows = []
        for p in as_list(f.get('player')):
            pid = p['id']; i = P.get(pid, {}); s = float(p.get('salary') or 0)
            e = sorted(x for x in ev.get(pid, []) if x[1] == f['id'])
            a = e[-1] if e else None
            m = re.match(r'(\d+)/(\d+)', (p.get('contractYear') or '').strip())
            n, N = (int(m[1]), int(m[2])) if m else (None, None)
            new_deal = bool(a and a[3] in ('waiver', 'fa') and a[4] == cur)
            if new_deal:
                fixed += (n, N) != (1, 3)
                n, N = 1, 3
            nfl = i.get('team', '')
            ec = (ecr.get('players') or {}).get(pid)
            rows.append({'id': pid, 'name': names.get(pid, pid), 'pos': pos.get(pid, ''), 'nfl': nfl, 'age': age(i.get('birthdate')),
                         'espn': espn.get(pid, '') or '', 'st': p.get('status'), 'sal': s,
                         'cy': f'{n}/{N}' if N else '', 'newDeal': new_deal, 'fut': future(s, n, N, p.get('status')) if N else None,
                         'acq': a[2] if a else (p.get('drafted') or ''),
                         'pts': round(pts.get(pid, 0), 1), 'gp': len(wsc.get(pid, {})), 'wsc': wsc.get(pid, {}), 'wks': wks.get(pid, {}), 'rk': rk.get(pid),
                         'ecr': ec[0] if ec else None, 'ecrPos': ec[1] if ec else None, 'bye': byes.get(TM.get(nfl, nfl)),
                         'proj': PJ.get(pid), 'hon': H.get(pid, [])})
        o = (fr.get(f['id'], {}).get('owner_name') or '').split()
        s = st.get(f['id'], {})
        W = team_weeks.get(f['id'], [])
        # first name and last initial; a two-word last name uses its first word (Collin Del Cuore -> Collin D.)
        out_t[f['id']] = {'name': fr.get(f['id'], {}).get('name', f['id']).strip(), 'owner': f"{o[0]} {o[1][0]}." if len(o) > 1 else (o[0] if o else ''),
                          'rec': [s.get('w', 0), s.get('l', 0), s.get('t', 0)], 'pf': s.get('pf', 0),
                          'paa': round(sum(x['pts'] - x['avg'] for x in W), 1), 'weeks': W, 'rows': rows}
    # season-so-far note for each team
    started_by = collections.defaultdict(lambda: collections.defaultdict(float))
    for w, ft in wr.items():
        if int(w) <= played:
            for f, t in ft.items():
                for pid, x in t.get('s', []):
                    started_by[f][pid] += x
    mj = load(D('matchups.json'), {}) or {}
    nxt = {}
    for g in mj.get('games', []):
        for me, opp in ((g['home'], g['away']), (g['away'], g['home'])):
            nxt[me] = {'week': mj.get('week'), 'opp': opp, 'me': (g.get('teams') or {}).get(me, {})}
    std = ln['standings']
    # written once a week: when a new week has been played. The daily refreshes keep that week's notes.
    prev = load(D('rosters.json'), {}) or {}
    tname = lambda x: (fr.get(x) or {}).get('name', x).strip()
    if prev.get('noteWeek') == played:
        for f, t in out_t.items():
            if (prev.get('teams') or {}).get(f, {}).get('note'):
                t['note'] = prev['teams'][f]['note']
    else:
        inj = load(D('espn', 'injuries.json'), {}) or {}
        since = datetime.now(timezone.utc).timestamp() - 8 * 86400
        trades = []
        for x in (load(D('mfl', 'transactions.json'), {}) or {}).get('transactions') or []:
            if x.get('type') == 'TRADE' and int(x.get('timestamp') or 0) >= since:
                pl_ = lambda v: [names.get(p, p) for p in v.split(',') if p and not p.startswith(('FP_', 'DP_'))]
                trades.append({'a': x['franchise'], 'b': x.get('franchise2'), 'toA': pl_(x.get('franchise2_gave_up', '')), 'toB': pl_(x.get('franchise1_gave_up', ''))})
        for f, t in out_t.items():
            if f in st:
                note = season_note(f, t, st[f], std, nxt.get(f), started_by[f], names, tname)
                if note:
                    note.update(week_news(f, t, played, wr, names, espn, inj, trades, tname))
                    t['note'] = note
    paa_order = sorted(out_t, key=lambda f: -out_t[f]['paa'])
    for f in out_t:
        out_t[f]['paaRank'] = paa_order.index(f) + 1
    # player profiles (scoring archetypes) and FBP journeys
    weekly = {w: v for w, v in ((load(D('mfl', 'weeklyScores.json'), {}) or {}).get('weeks') or {}).items() if int(w) <= played}
    prof = profiles({f: t['rows'] for f, t in out_t.items()}, weekly, played, pos, lambda pid: wks.get(pid, {}))
    jour = journeys({r['id'] for t in out_t.values() for r in t['rows']}, cur, abbr, names)
    for t in out_t.values():
        for r in t['rows']:
            if r['id'] in prof: r['prof'] = prof[r['id']]
            if r['id'] in jour: r['jour'] = jour[r['id']]
    face = face_of_franchise(cur, {f: [r['id'] for r in t['rows'] if r['pos'] != 'DEF'] for f, t in out_t.items()}, names, pos, espn)
    for f, v in face.items():
        out_t[f]['face'] = v
    out = {'built': datetime.now(timezone.utc).isoformat(timespec='seconds'), 'season': cur, 'through': played, 'projWeek': int(pw), 'noteWeek': played,
           'ecrUpdated': ecr.get('updated'), 'teams': out_t}
    with open(D('rosters.json'), 'w', encoding='utf-8') as fh:
        json.dump(out, fh, separators=(',', ':'), ensure_ascii=False)
        fh.write('\n')
    print(f'rosters: {sum(len(t["rows"]) for t in out_t.values())} players on {len(out_t)} teams, '
          f'{fixed} contracts set to 1/3 from this season\'s pickups, faces for {len(face)} teams')


if __name__ == '__main__':
    main()
