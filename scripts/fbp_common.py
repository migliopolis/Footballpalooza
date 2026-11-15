"""Constants and curves shared by the value scripts (ovr.py, trade_values.py, trading_floor.py, power.py), so a tune
in one place reaches all of them. Standard library only. Import with: from fbp_common import pv_of, market, ..."""
import math

# the age each position peaks: value fades after it (Trade Value aging, Sell high, the keeper model's age input)
PEAK = {'QB': 31, 'RB': 26, 'WR': 28, 'TE': 29}

# MFL team codes that differ from ESPN's
ESPN_TEAM = {'GBP': 'GB', 'JAC': 'JAX', 'KCC': 'KC', 'LVR': 'LV', 'NEP': 'NE', 'NOS': 'NO', 'SFO': 'SF', 'TBB': 'TB', 'WAS': 'WSH'}


def pv_of(rank):
    """Player Value (1-9999) for a FantasyPros rank: 9999 at 1, about 7,000 at 25, 3,500 at 100, 1,600 at 200."""
    return 9999 * math.exp(-((max(rank, 1) - 1) / 95) ** 0.8)


def market(pv):
    """What a player of that Player Value goes for at an FBP auction, in dollars."""
    return 80 * (pv / 9999) ** 1.8


def dynasty_scale(pv):
    """Player Value on the OVR's 58-99 scale (the dynasty half of the FBP OVR)."""
    return 58 + 41 * (pv / 9999) ** 0.9
