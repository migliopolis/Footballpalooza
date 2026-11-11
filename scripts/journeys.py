"""FBP journeys: every player's path through the league, as stints with a team.

Writes data/journeys.json for the timeline on the Player Page, Reference > Players (Player Journey) and the
Trading Floor's "How it played out". Each stint is one stay with one team:
  how he arrived  A auction, D rookie draft, T trade, W waivers or free agency
  how it ended    released, traded, not kept at the keeper deadline, or still there
Moves come from MFL: auctions and rookie drafts from the start, waiver and free-agent moves and trades from 2019
(2019-20 were fetched once through the commissioner's browser; MFL's API no longer answers for them).
Trade details (what each side sent, picks and the players taken with them, auction cash) come from
data/trading-floor.json, so scripts/trading_floor.py runs first.

"Not kept" has no date on record: the keeper deadline isn't stored, so it shows as the season he wasn't kept for.
A rookie draft has no time on record before this season either, so it shows by year.
"""
import json, os, collections
from datetime import datetime, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
D = lambda *p: os.path.join(ROOT, 'data', *p)
load = lambda p, d=None: json.load(open(p)) if os.path.exists(p) else d


def as_list(x):
    return x if isinstance(x, list) else ([x] if x else [])


def year_of(ts):
    return datetime.fromtimestamp(ts, timezone.utc).year


def main():
    ref = load(D('reference.json'), {}) or {}
    meta = load(D('mfl', '_meta.json'), {}) or {}
    cur = int(meta.get('season') or ref.get('meta', {}).get('current_year') or 2026)
    teams = (load(D('teams.json'), {}) or {}).get('teams', {})
    abbr = lambda f: (teams.get(f) or {}).get('abbr', f)
    TF = load(D('trading-floor.json'), {}) or {}

    # names, positions, ESPN ids
    links = (load(D('player-links.json'), {}) or {}).get('links', {})
    info = {}
    for y in range(2019, cur):
        for pid, v in ((load(D('history', str(y), 'players.json'), {}) or {}).get('players') or {}).items():
            info[pid] = (v[0], v[1])
    for pid, v in ((load(D('mfl', 'players.json'), {}) or {}).get('players') or {}).items():
        info[pid] = (v[0], v[1])
    def name(pid):
        l = links.get(pid) or []
        if len(l) > 2 and l[2]:
            return l[2]
        n, pos = info.get(pid, ('', ''))
        if ', ' in n:
            last, first = n.split(', ', 1)
            n = f'{first} {last}'
        return n or ('Player ' + pid)

    # ---------- events: [ts, team, kind, text, approx] ----------
    ev = collections.defaultdict(list)
    for y in range(2019, cur + 1):
        tx = (load(D('mfl', 'transactions.json') if y == cur else D('history', str(y), 'transactions.json'), {}) or {}).get('transactions') or []
        for x in tx:
            ts, f, ty = int(x.get('timestamp') or 0), x.get('franchise'), x.get('type')
            if ty in ('BBID_WAIVER', 'FREE_AGENT'):
                parts = (x.get('transaction', '') + '||').split('|')
                adds = [p for p in parts[0].split(',') if p]
                drops = [p for p in (parts[2] if ty == 'BBID_WAIVER' else parts[1]).split(',') if p]
                bid = parts[1] if ty == 'BBID_WAIVER' else ''
                for p in adds:
                    try:
                        b = f' for ${float(bid):.0f}' if bid and float(bid) else ''
                    except ValueError:
                        b = ''
                    ev[p].append([ts, f, 'W', f'Claimed off waivers{b}' if ty == 'BBID_WAIVER' else 'Signed as a free agent', 0])
                for p in drops:
                    ev[p].append([ts, f, 'R', 'Released', 0])
            elif ty == 'TRADE':
                f2 = x.get('franchise2')
                for gave, to, frm in (('franchise1_gave_up', f2, f), ('franchise2_gave_up', f, f2)):
                    for p in (x.get(gave) or '').split(','):
                        if p and p[0].isdigit():
                            ev[p].append([ts, to, 'T', frm, 0])      # text filled in below
    for y, lst in (ref.get('auction_results') or {}).items():
        for a in lst:
            ts = a.get('timestamp')
            ev[a['player_id']].append([int(ts) if ts else int(datetime(int(y), 8, 25, tzinfo=timezone.utc).timestamp()), a['franchise'], 'A',
                                       f"Won at auction for ${a['price']}", 0 if ts else 1])
    au = (((load(D('mfl', 'auctionResults.json'), {}) or {}).get('auctionResults') or {}).get('auctionUnit') or {}).get('auction')
    for a in as_list(au):
        ev[a['player']].append([int(a.get('lastBidTime') or 0), a['franchise'], 'A', f"Won at auction for ${a['winningBid']}", 0])
    for y, lst in (ref.get('draft_classes') or {}).items():
        for a in lst:
            ev[a['player_id']].append([int(datetime(int(y), 6, 20, tzinfo=timezone.utc).timestamp()), a['franchise'], 'D',
                                       f"Drafted {int(a['round'])}.{int(a['pick']):02d} in the {y} rookie draft", 1])
    dr = (((load(D('mfl', 'draftResults.json'), {}) or {}).get('draftResults') or {}).get('draftUnit') or {}).get('draftPick')
    for a in as_list(dr):
        if a.get('player') and a.get('timestamp'):
            ev[a['player']].append([int(a['timestamp']), a['franchise'], 'D', f"Drafted {int(a['round'])}.{int(a['pick']):02d} in the {cur} rookie draft", 0])

    # trade details from the Trading Floor's history
    by_ts = collections.defaultdict(list)
    for t in TF.get('trades') or []:
        by_ts[t['ts']].append(t)
    lab = lambda x: x['t'] + (f" → {x['became']['n']}" if x.get('became') else '')
    def trade_text(ts, pid, to, frm):
        t = next((t for t in by_ts.get(ts, []) if {t['a'], t['b']} == {to, frm}), None)
        base = f'Traded from {abbr(frm)}'
        if not t:
            return base, None
        sent = t['aGave'] if t['a'] == to else t['bGave']             # what his new team sent
        came = [x for x in (t['bGave'] if t['a'] == to else t['aGave']) if x.get('id') != pid]
        s = base + '. ' + (f"{abbr(to)} gave {', '.join(lab(x) for x in sent)}." if sent else f'{abbr(to)} gave nothing on record.')
        if came:
            s += f" Came with {', '.join(lab(x) for x in came)}."
        s = s.replace('..', '.')
        return s, ts

    # who has him now (taxi and IR included)
    now = {}
    for f, t in ((load(D('rosters.json'), {}) or {}).get('teams') or {}).items():
        for r in t.get('rows') or []:
            now[r['id']] = f
    rost = {}
    for y in range(2019, cur):
        ro = ((load(D('history', str(y), 'rosters.json'), {}) or {}).get('rosters') or {}).get('franchise') or []
        rost[y] = {(fr.get('id'), str(p.get('id'))) for fr in ro for p in as_list(fr.get('player'))}

    out = {}
    for pid, lst in ev.items():
        seen, E = set(), []
        for e in sorted(lst, key=lambda e: (e[0], 'RTWAD'.index(e[2]))):
            k = (year_of(e[0]), e[1], e[2]) if e[2] in ('A', 'D') else (e[0] // 60, e[1], e[2])
            if k not in seen:
                seen.add(k)
                E.append(e)
        if not E:
            continue
        st = []          # [team, start, how, text, approx, end, endHow, endText, endApprox]
        open_ = None
        for ts, f, k, txt, ap in E:
            if k == 'R':
                if open_ and open_[0] == f:
                    open_[5:9] = [ts, 'R', 'Released', 0]
                    open_ = None
                continue
            if k == 'T':
                frm = txt
                txt, _ = trade_text(ts, pid, f, frm)
                if open_ and open_[0] == frm:
                    open_[5:9] = [ts, 'T', f'Traded to {abbr(f)}', 0]
                elif open_:
                    open_[5:9] = [ts, 'N', None, 1]
            elif open_ and k == 'A' and open_[2] == 'A' and ts - open_[1] < 3 * 86400:
                st.pop()          # the same auction run again (MFL shows both results); the later one stands
                open_ = None
            elif open_:
                # a new arrival with no recorded exit: he wasn't kept (an auction or a later season), or the move wasn't on record
                y = year_of(ts)
                if k == 'A' or y > year_of(open_[1]):
                    open_[5:9] = [ts, 'N', f'Not kept for {y}', 1]
                else:
                    open_[5:9] = [ts, 'N', None, 1]
            open_ = [f, ts, k, txt, ap, None, None, None, 0]
            st.append(open_)
        if open_ and now.get(pid) != open_[0]:
            # gone from that team with no recorded move: not kept for the first season he wasn't on its roster
            y0 = year_of(open_[1])
            gone = next((y for y in range(y0 + 1, cur) if (open_[0], pid) not in rost.get(y, set())), None)
            if gone is None and now.get(pid) != open_[0]:
                gone = cur if y0 < cur else None
            if gone:
                open_[5:9] = [int(datetime(gone, 7, 1, tzinfo=timezone.utc).timestamp()), 'N', f'Not kept for {gone}', 1]
            else:
                open_[5:9] = [None, 'N', 'Left the roster', 1]
        n, pos = name(pid), (info.get(pid, ('', ''))[1])
        l = links.get(pid) or []
        out[pid] = {'n': n, 'p': 'DEF' if pos == 'Def' else pos, 'e': l[0] if l and l[0] else None, 'now': now.get(pid), 'st': st}

    doc = {'built': datetime.now(timezone.utc).isoformat(timespec='seconds'), 'season': cur,
           'fields': ['team', 'start', 'how', 'text', 'approx', 'end', 'endHow', 'endText', 'endApprox'],
           'note': 'how: A auction, D draft, T trade, W waivers or free agency. endHow: R released, T traded, N not kept / no move on record. approx 1 = date not on record (shown by year).',
           'players': out}
    with open(D('journeys.json'), 'w') as fh:
        json.dump(doc, fh, separators=(',', ':'), ensure_ascii=False)
        fh.write('\n')
    print('journeys:', len(out), 'players,', sum(len(p['st']) for p in out.values()), 'stints')


if __name__ == '__main__':
    main()
