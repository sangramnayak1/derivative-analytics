# app_api.py
import pandas as pd, os, json, requests
from flask import jsonify, request, current_app as app
from flask import Flask, jsonify, request
from flask_cors import CORS
from backend.fetcher import fetch_nse_json, normalize_nse_json
from backend.analytics import compute_vwap, compute_pcr, compute_max_pain, compute_skew, compute_window_bounds_from_spot
from backend.candles import append_snapshot, build_candles_from_snapshots
from datetime import datetime

app = Flask(__name__)
CORS(app)

@app.route("/api/nifty/optionchain")
def optionchain():
    try:
        j = fetch_nse_json()
        df = normalize_nse_json(j)
        return jsonify(df.to_dict(orient='records'))
    except Exception as e:
        app.logger.exception("Failed to fetch/normalize optionchain")
        return jsonify({"error":"fetch_failed","message":str(e)}), 500

@app.route("/api/nifty/window_stats")
def window_stats():
    mode = request.args.get('mode','FIXED')
    atm_window = int(request.args.get('atm_window', 3))
    try:
        j = fetch_nse_json()
        df = normalize_nse_json(j)

        # compute spot/atm/window bounds
        spot = float(df['underlyingPrice'].median()) if (df is not None and not df.empty) else None
        atm, low, high = compute_window_bounds_from_spot(spot, fixed=(mode == 'FIXED'), atm_window_strikes=atm_window)

        # build window_df safely (if low/high None -> full df)
        if low is None or high is None:
            window_df = df.copy() if (df is not None) else pd.DataFrame()
        else:
            window_df = df[(df['strike'] >= low) & (df['strike'] <= high)].copy()

        # compute pcr_window with per-strike exclusion so it matches frontend behavior
        try:
            pcr_window = compute_pcr(window_df, mode='OI', exclude_zero=True, strike_min=low, strike_max=high)
        except Exception:
            app.logger.exception("compute_pcr(window) failed")
            pcr_window = None

        # compute detailed CE/PE totals for the same window (for verification/debug)
        def _compute_window_totals(df_window):
            if df_window is None or df_window.empty:
                return {"CE_OI": 0, "PE_OI": 0, "CE_vol": 0, "PE_vol": 0}
            pivot_oi = df_window.pivot_table(index='strike', columns='optionType', values='OI', aggfunc='sum').fillna(0)
            pivot_vol = df_window.pivot_table(index='strike', columns='optionType', values='volume', aggfunc='sum').fillna(0)
            if 'CE' not in pivot_oi.columns:
                pivot_oi['CE'] = 0
            if 'PE' not in pivot_oi.columns:
                pivot_oi['PE'] = 0
            if 'CE' not in pivot_vol.columns:
                pivot_vol['CE'] = 0
            if 'PE' not in pivot_vol.columns:
                pivot_vol['PE'] = 0

            # apply same exclusion rule used by compute_pcr(exclude_zero=True): keep strikes where both CE>0 and PE>0
            keep = (pivot_oi['CE'] > 0) & (pivot_oi['PE'] > 0)
            pivot_oi_kept = pivot_oi[keep]
            pivot_vol_kept = pivot_vol[keep]

            ce_oi_total = int(pivot_oi_kept['CE'].sum())
            pe_oi_total = int(pivot_oi_kept['PE'].sum())
            ce_vol_total = int(pivot_vol_kept['CE'].sum())
            pe_vol_total = int(pivot_vol_kept['PE'].sum())

            return {
                "CE_OI": ce_oi_total,
                "PE_OI": pe_oi_total,
                "CE_vol": ce_vol_total,
                "PE_vol": pe_vol_total
            }

        pcr_window_details = _compute_window_totals(window_df)

        # compute overall PCR as before (legacy/global-sum)
        try:
            pcr_overall = compute_pcr(df, mode='OI', exclude_zero=False)
        except Exception:
            app.logger.exception("compute_pcr(overall) failed")
            pcr_overall = None

        # VWAP, Max Pain, Skew, Prev Close & avg_val calculation (unchanged)
        vwap = compute_vwap(window_df)
        mp = compute_max_pain(window_df)
        skew = compute_skew(window_df)
        prev_close = float(df['underlyingPrice'].iloc[0]) if (df is not None and not df.empty) else None

        # compute Avg (H-L, H-Pc, Pc-L) using latest candles/fallback
        avg_val = None
        try:
            import json, os
            cf = "data/candles_1m.json"
            if os.path.exists(cf):
                with open(cf) as fh:
                    candles = json.load(fh)
                    if candles:
                        last = candles[-1]
                        H = last.get('high')
                        L = last.get('low')
                        if prev_close is not None and H is not None and L is not None:
                            avg_val = max(H - L, abs(H - prev_close), abs(L - prev_close))
        except Exception:
            avg_val = None

        snap = {'ts': datetime.utcnow().isoformat(), 'underlyingPrice': spot, 'volume_sum': int(df['volume'].sum()) if (df is not None and not df.empty) else 0}
        try:
            append_snapshot(snap)
            build_candles_from_snapshots()
        except Exception:
            app.logger.exception("snapshot append failed")

        # return JSON including pcr_window_details for verification
        return jsonify({
            'atm': atm, 'low': low, 'high': high,
            'pcr_window': pcr_window, 'pcr_window_details': pcr_window_details, 'pcr_overall': pcr_overall,
            'vwap': vwap, 'max_pain': mp, 'skew': skew, 'prev_close': prev_close,
            'avg_val': avg_val
        })

    except Exception as e:
        app.logger.exception("window_stats failed")
        safe = {'atm': None, 'low': None, 'high': None, 'pcr_window': None, 'pcr_window_details': {"CE_OI":0,"PE_OI":0,"CE_vol":0,"PE_vol":0}, 'pcr_overall': None, 'vwap': {}, 'max_pain': None, 'skew': None, 'prev_close': None, 'avg_val': None, 'error': str(e)}
        return jsonify(safe), 200

@app.route("/api/nifty/candles")
def get_candles():
    f = "data/candles_1m.json"
    if not os.path.exists(f): return jsonify([])
    with open(f) as fh: return jsonify(json.load(fh))

# helper: simple requests get with browser headers
session = requests.Session()

headers = {
    #"User-Agent": "Mozilla/5.0", "Accept-Language": "en-US,en;q=0.9"
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                    "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept": "application/json, text/javascript, */*; q=0.01",
    "Accept-Language": "en-US,en;q=0.9"
}

def nse_fetch_json(url, params=None):
    try:
        # load homepage once to set cookies if not already
        if not session.cookies:
            session.get("https://www.nseindia.com", headers=headers, timeout=10)
        resp = session.get(url, params=params, headers=headers, timeout=10)
        resp.raise_for_status()
        return resp.json()
    except Exception as e:
        app.logger.exception("nse_fetch_json failed for %s", url)
        return None

# endpoint: index OHLC for NIFTY 50
@app.route("/api/nifty/index_ohlc")
def index_ohlc():
    url = "https://www.nseindia.com/api/NextApi/apiClient?functionName=getIndexData"
    params = {"functionName": "getIndexData"}
    j = nse_fetch_json(url, params=None)
    if not j:
        return jsonify({"error": "no_data"}), 200

    # same parsing logic as before...
    def find_index_entries(obj):
        if isinstance(obj, list):
            for it in obj:
                if isinstance(it, dict) and it.get("indexName") == "NIFTY 50":
                    return it
                res = find_index_entries(it)
                if res: return res
        elif isinstance(obj, dict):
            if obj.get("indexName") == "NIFTY 50":
                return obj
            for v in obj.values():
                res = find_index_entries(v)
                if res: return res
        return None

    found = find_index_entries(j)
    if not found:
        return jsonify({"error": "nifty_not_found", "raw": j}), 200

    last = float(found.get("last") or 0)
    open_ = float(found.get("open") or 0)
    high = float(found.get("high") or 0)
    low = float(found.get("low") or 0)
    prev_close = float(found.get("previousClose") or found.get("prevClose") or 0)

    avg_val = None
    if prev_close and high and low:
        momentum = max(high - low, abs(high - prev_close), abs(low - prev_close))
        avg_val = momentum/2

    return jsonify({
        "indexName": "NIFTY 50",
        "last": last,
        "open": open_,
        "high": high,
        "low": low,
        "prev_close": prev_close,
        "momentum": momentum,
        "avg_val": avg_val
    })

# endpoint: market statistics (advance/decline)
@app.route("/api/nifty/market_stats")
def market_stats():
    src = "https://www.nseindia.com/api/NextApi/apiClient?"
    params = {
        "functionName": "getMarketStatistics"
    }
    j = nse_fetch_json(src, params=params)
    if not j:
        return jsonify({"error": "no_data"}), 200

    # Search for advance/decline metrics
    # The structure of response may vary; try to get advance/decline counts, e.g. "advance" or "advances" keys
    def find_adv_dec(obj):
        if isinstance(obj, dict):
            if "advance" in obj or "advances" in obj or "decline" in obj or "declines" in obj:
                return obj
            for v in obj.values():
                res = find_adv_dec(v)
                if res:
                    return res
        elif isinstance(obj, list):
            for it in obj:
                res = find_adv_dec(it)
                if res:
                    return res
        return None

    found = find_adv_dec(j)
    # Build safe response:
    adv = None
    dec = None
    try:
        if isinstance(found, dict):
            # try common fields
            adv = found.get("advances") or found.get("advance") or found.get("adv")
            dec = found.get("declines") or found.get("decline") or found.get("dec")
        # fallback search for numeric fields anywhere
        if adv is None or dec is None:
            # do simple scan
            def scan_for_nums(obj):
                if isinstance(obj, dict):
                    for k,v in obj.items():
                        if k.lower().find("advance")>=0 or k.lower().find("adv")>=0:
                            return ("adv", v)
                        if k.lower().find("decline")>=0 or k.lower().find("dec")>=0:
                            return ("dec", v)
                    for v in obj.values():
                        res = scan_for_nums(v)
                        if res:
                            return res
                elif isinstance(obj, list):
                    for it in obj:
                        res = scan_for_nums(it)
                        if res:
                            return res
                return None
            res = scan_for_nums(j)
            if res:
                if res[0]=="adv":
                    adv = res[1]
                elif res[0]=="dec":
                    dec = res[1]
    except Exception:
        pass

    return jsonify({"advance": adv, "decline": dec, "raw": j}), 200
    
if __name__ == "__main__":
    os.makedirs('data', exist_ok=True)
    app.run(host='0.0.0.0', port=8000, debug=True)
