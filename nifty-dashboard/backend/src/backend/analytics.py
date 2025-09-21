# analytics.py
import numpy as np
import pandas as pd

STRIKE_STEP = 50

def round_to_nearest_strike(spot, step=STRIKE_STEP):
    return int(round(spot / step) * step) if spot is not None else None

def compute_vwap(df):
    if df.empty: return {}
    df = df.copy()
    df['pv'] = df['lastPrice'] * df['volume']
    g = df.groupby('optionType').agg({'pv':'sum','volume':'sum'})
    g['VWAP'] = g['pv'] / g['volume'].replace(0, np.nan)
    return g['VWAP'].to_dict()

def compute_pcr(df, mode='OI', exclude_zero=False, strike_min=None, strike_max=None):
    """
    Compute PCR from DataFrame df.

    Parameters
    ----------
    df : pandas.DataFrame
        Expected columns: 'strike', 'optionType' ('CE'/'PE'), 'OI', 'volume'
    mode : str
        'OI' (default) or 'VOLUME'
    exclude_zero : bool
        If True, perform per-strike aggregation and exclude strikes where
        either CE or PE side is zero (keeps only strikes where both CE>0 AND PE>0).
        This matches the frontend "exclude zero strikes" behaviour.
        If False, performs the legacy global-sum behavior (sums CE and PE across df).
    strike_min : numeric or None
        If provided, inclusive lower bound for strike to include.
    strike_max : numeric or None
        If provided, inclusive upper bound for strike to include.

    Returns
    -------
    float or None
        PE / CE ratio, or None if CE total is zero or no data available.
    """
    if df is None or df.empty:
        return None

    d = df.copy()

    # apply strike bounds if provided
    if strike_min is not None:
        d = d[d['strike'] >= strike_min]
    if strike_max is not None:
        d = d[d['strike'] <= strike_max]
    if d.empty:
        return None

    # legacy/global-sum behaviour (backwards compatible)
    if not exclude_zero:
        if mode == 'VOLUME':
            ce = d.loc[d['optionType'] == 'CE', 'volume'].sum()
            pe = d.loc[d['optionType'] == 'PE', 'volume'].sum()
        else:
            ce = d.loc[d['optionType'] == 'CE', 'OI'].sum()
            pe = d.loc[d['optionType'] == 'PE', 'OI'].sum()
        return (pe / ce) if ce > 0 else None

    # per-strike aggregation + exclusion when exclude_zero == True
    # build pivot: index=strike, columns=optionType, values=OI or volume
    val_col = 'volume' if mode == 'VOLUME' else 'OI'
    pivot = d.pivot_table(index='strike', columns='optionType', values=val_col, aggfunc='sum').fillna(0)

    # ensure columns exist
    if 'CE' not in pivot.columns:
        pivot['CE'] = 0
    if 'PE' not in pivot.columns:
        pivot['PE'] = 0

    # keep only strikes where both CE and PE are > 0
    pivot = pivot[(pivot['CE'] > 0) & (pivot['PE'] > 0)]

    total_ce = float(pivot['CE'].sum())
    total_pe = float(pivot['PE'].sum())

    if total_ce == 0:
        return None
    return total_pe / total_ce

def compute_window_bounds_from_spot(spot, fixed=True, atm_window_strikes=3, step=STRIKE_STEP):
    atm = round_to_nearest_strike(spot, step)
    if atm is None: return None, None, None
    if fixed:
        low = atm - 500
        high = atm + 550
    else:
        low = atm - atm_window_strikes * step
        high = atm + atm_window_strikes * step
    return atm, low, high

def compute_max_pain(df):
    strikes = sorted(df['strike'].unique())
    if not strikes: return None
    pivot = df.pivot_table(index='strike', columns='optionType', values='OI', aggfunc='sum').fillna(0)
    pain_map = {}
    for s0 in strikes:
        total = 0
        for s in strikes:
            ce = pivot.loc[s,'CE'] if 'CE' in pivot.columns else 0
            pe = pivot.loc[s,'PE'] if 'PE' in pivot.columns else 0
            total += max(0, s0 - s) * ce + max(0, s - s0) * pe
        pain_map[s0] = total
    mp = min(pain_map, key=pain_map.get)
    return {'max_pain_strike': int(mp), 'pain_map': pain_map}

def compute_skew(df):
    if df.empty: return None
    med_iv = df.groupby('optionType')['impliedVolatility'].median().to_dict()
    ce_iv = med_iv.get('CE', np.nan)
    pe_iv = med_iv.get('PE', np.nan)
    return (pe_iv/ce_iv) if (ce_iv and not np.isnan(ce_iv)) else None

# analytics.py (add near other helpers)

def _sum_col_for_type(df, col_candidates, opt_type):
    """Return integer sum of the first found column in col_candidates for opt_type rows."""
    for c in col_candidates:
        if c in df.columns:
            # coerce to numeric safely and sum
            s = pd.to_numeric(df.loc[df['optionType'] == opt_type, c], errors='coerce').fillna(0).sum()
            return int(s)
    return 0

def compute_pcr_change(df):
    """
    Compute PCR change for a df as (sum PE OI_change) / (sum CE OI_change).
    Returns tuple (pcr_change, pe_change_total, ce_change_total) where pcr_change is None
    if CE change total is zero.
    """
    if df is None or df.empty:
        return None, 0, 0

    # common column name candidates for oi-change values
    candidates = ['OI_change', 'oi_change', 'oiChange', 'change', 'change_in_OI', 'LTP_change']

    ce_ch = _sum_col_for_type(df, candidates, 'CE')
    pe_ch = _sum_col_for_type(df, candidates, 'PE')

    if ce_ch == 0:
        pcr_ch = None
    else:
        pcr_ch = (pe_ch / ce_ch)

    return pcr_ch, pe_ch, ce_ch
