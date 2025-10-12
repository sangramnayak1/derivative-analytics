# app_api.py
import pandas as pd, os, json, requests, sys
import configparser, datetime as dt
import json
from flask import jsonify, request, current_app as app
from flask import Flask, jsonify, request
from flask_cors import CORS
from backend.fetcher import fetch_nse_json, normalize_nse_json
from backend.analytics import compute_vwap, compute_pcr, compute_max_pain, compute_skew, compute_window_bounds_from_spot, compute_pcr_change
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
    mode = request.args.get("mode", "FIXED")
    atm_window = int(request.args.get("atm_window", 3))
    try:
        j = fetch_nse_json()
        df = normalize_nse_json(j)

        # compute spot/atm/window bounds
        spot = float(df["underlyingPrice"].median()) if (df is not None and not df.empty) else None
        atm, low, high = compute_window_bounds_from_spot(
            spot, fixed=(mode == "FIXED"), atm_window_strikes=atm_window
        )

        # build window_df safely (if low/high None -> full df)
        if low is None or high is None:
            window_df = df.copy() if (df is not None) else pd.DataFrame()
        else:
            window_df = df[(df["strike"] >= low) & (df["strike"] <= high)].copy()

        # headline PCR (global sums across window)
        try:
            pcr_window = compute_pcr(window_df, mode="OI")
        except Exception:
            app.logger.exception("compute_pcr(window) failed")
            pcr_window = None

        # bucketed PCR (mirrors frontend grouping)
        def compute_pcr_buckets(window_df, atm):
            def make_bucket():
                return {"CE_OI": 0, "PE_OI": 0, "CE_vol": 0, "PE_vol": 0, "CE_strikes": [], "PE_strikes": []}

            buckets = {"ATM": make_bucket(), "ITM": make_bucket(), "OTM": make_bucket(), "TOTAL": make_bucket()}
            if window_df is None or window_df.empty:
                return {k: make_bucket() for k in buckets}

            for _, row in window_df.iterrows():
                st = float(row["strike"])
                opt = row.get("optionType")
                oi = int(row.get("OI", 0) or 0)
                vol = int(row.get("volume", 0) or 0)

                if opt == "CE":
                    buckets["TOTAL"]["CE_OI"] += oi
                    buckets["TOTAL"]["CE_vol"] += vol
                    buckets["TOTAL"]["CE_strikes"].append(st)
                else:
                    buckets["TOTAL"]["PE_OI"] += oi
                    buckets["TOTAL"]["PE_vol"] += vol
                    buckets["TOTAL"]["PE_strikes"].append(st)

                if atm is not None and st == atm:
                    if opt == "CE":
                        buckets["ATM"]["CE_OI"] += oi
                        buckets["ATM"]["CE_vol"] += vol
                        buckets["ATM"]["CE_strikes"].append(st)
                    else:
                        buckets["ATM"]["PE_OI"] += oi
                        buckets["ATM"]["PE_vol"] += vol
                        buckets["ATM"]["PE_strikes"].append(st)
                elif atm is not None and st < atm:
                    if opt == "CE":
                        buckets["ITM"]["CE_OI"] += oi
                        buckets["ITM"]["CE_vol"] += vol
                        buckets["ITM"]["CE_strikes"].append(st)
                    else:
                        buckets["OTM"]["PE_OI"] += oi
                        buckets["OTM"]["PE_vol"] += vol
                        buckets["OTM"]["PE_strikes"].append(st)
                elif atm is not None and st > atm:
                    if opt == "PE":
                        buckets["ITM"]["PE_OI"] += oi
                        buckets["ITM"]["PE_vol"] += vol
                        buckets["ITM"]["PE_strikes"].append(st)
                    else:
                        buckets["OTM"]["CE_OI"] += oi
                        buckets["OTM"]["CE_vol"] += vol
                        buckets["OTM"]["CE_strikes"].append(st)

            def finalize(obj):
                ce, pe, ceVol, peVol = obj["CE_OI"], obj["PE_OI"], obj["CE_vol"], obj["PE_vol"]
                ceRange = f"{int(min(obj['CE_strikes']))} — {int(max(obj['CE_strikes']))}" if obj["CE_strikes"] else "—"
                peRange = f"{int(min(obj['PE_strikes']))} — {int(max(obj['PE_strikes']))}" if obj["PE_strikes"] else "—"
                pcr = (pe / ce) if ce > 0 else None
                return dict(
                    CE_OI=ce, PE_OI=pe, CE_vol=ceVol, PE_vol=peVol,
                    CE_range=ceRange, PE_range=peRange, PCR=pcr
                )

            return {k: finalize(v) for k, v in buckets.items()}

        pcr_buckets = compute_pcr_buckets(window_df, atm)

        def _serialize_bucket(b):
            return {
                "CE_OI": int(b.get("CE_OI", 0) or 0),
                "PE_OI": int(b.get("PE_OI", 0) or 0),
                "CE_vol": int(b.get("CE_vol", 0) or 0),
                "PE_vol": int(b.get("PE_vol", 0) or 0),
                "CE_range": b.get("CE_range", "—"),
                "PE_range": b.get("PE_range", "—"),
                "PCR": float(b["PCR"]) if (b.get("PCR") is not None) else None,
            }

        pcr_buckets_serial = {k: _serialize_bucket(v) for k, v in pcr_buckets.items()}

        # pcr_window_details = both global and bucket totals
        global_ce = int(window_df.loc[window_df["optionType"] == "CE", "OI"].sum()) if not window_df.empty else 0
        global_pe = int(window_df.loc[window_df["optionType"] == "PE", "OI"].sum()) if not window_df.empty else 0

        pcr_window_details = {
            "global_CE_OI": global_ce,
            "global_PE_OI": global_pe,
            "bucket_TOTAL_CE_OI": pcr_buckets_serial["TOTAL"]["CE_OI"],
            "bucket_TOTAL_PE_OI": pcr_buckets_serial["TOTAL"]["PE_OI"],
        }

        # other stats
        pcr_overall = compute_pcr(df, mode="OI") if not df.empty else None
        vwap = compute_vwap(window_df)
        mp = compute_max_pain(window_df)
        skew = compute_skew(window_df)
        prev_close = float(df["underlyingPrice"].iloc[0]) if not df.empty else None

        # avg_val from candles (fallback)
        avg_val = None
        try:
            import json, os
            cf = "data/candles_1m.json"
            if os.path.exists(cf):
                with open(cf) as fh:
                    candles = json.load(fh)
                    if candles:
                        last = candles[-1]
                        H, L = last.get("high"), last.get("low")
                        if prev_close is not None and H is not None and L is not None:
                            avg_val = max(H - L, abs(H - prev_close), abs(L - prev_close))
        except Exception:
            avg_val = None

        snap = {
            "ts": datetime.utcnow().isoformat(),
            "underlyingPrice": spot,
            "volume_sum": int(df["volume"].sum()) if not df.empty else 0,
        }
        
        # compute window PCR (legacy) as before
        pcr_window = compute_pcr(window_df, mode='OI')

        # compute pcr change using the new helper
        try:
            pcr_window_ch, pcr_window_pe_ch, pcr_window_ce_ch = compute_pcr_change(window_df)
        except Exception:
            app.logger.exception("compute_pcr_change(window) failed")
            pcr_window_ch, pcr_window_pe_ch, pcr_window_ce_ch = None, 0, 0

        
        try:
            append_snapshot(snap)
            build_candles_from_snapshots()
        except Exception:
            app.logger.exception("snapshot append failed")

        # include these in the returned JSON
        return jsonify({
            'atm': atm, 'low': low, 'high': high,
            'pcr_window': pcr_window,
            "pcr_window_details": pcr_window_details,
            "pcr_buckets": pcr_buckets_serial,
            'pcr_window_ch': pcr_window_ch,
            'pcr_window_ch_details': {'PE_change': pcr_window_pe_ch, 'CE_change': pcr_window_ce_ch},
            'pcr_overall': pcr_overall,
            'vwap': vwap, 'max_pain': mp, 'skew': skew,
            'prev_close': prev_close, 'avg_val': avg_val
        })

    except Exception as e:
        app.logger.exception("window_stats failed")
        safe = {
            "atm": None, "low": None, "high": None,
            "pcr_window": None, "pcr_window_details": {}, "pcr_buckets": {},
            "pcr_overall": None, "vwap": {}, "max_pain": None,
            "skew": None, "prev_close": None, "avg_val": None,
            "error": str(e),
        }
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

    momentum = None
    avg_val = None
    if prev_close and high and low:
        momentum = max(high - low, abs(high - prev_close), abs(low - prev_close))
        avg_val = momentum/2

    close = None
    if prev_close and last:
        close = last - prev_close
        avg_strike = max(prev_close, high) - avg_val
    
    gap = None
    if prev_close and open_:
        gap = open_ - prev_close
        
    return jsonify({
        "indexName": "NIFTY 50",
        "last": last,
        "open": open_,
        "high": high,
        "low": low,
        "prev_close": prev_close,
        "avg_strike": avg_strike,
        "momentum": momentum,
        "avg_val": avg_val,
        "close": close,
        "gap": gap
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

# --- Configuration Reading Option Greeks ---
CONFIG_PATH = os.getenv("CONFIG_PATH", "/app/config.ini")
config = configparser.ConfigParser()
config.read(CONFIG_PATH)

# --- Read config (fail fast if critical values missing) ---
def read_config():
    try:
        api_url = config.get('API', 'url', fallback='https://api.upstox.com/v2/option/chain')
        bearer_token = config.get('API', 'bearer_token')
        instrument_key = config.get('NIFTY', 'instrument_key', fallback='NSE_INDEX|Nifty 50')
        expiry_date = config.get('NIFTY', 'expiry_date', fallback=None)
        atm_strike = config.getint('NIFTY', 'atm_strike', fallback=None)
    except configparser.Error as e:
        raise RuntimeError(f"Error reading config.ini: {e}")

    if not bearer_token or bearer_token in ('CONFIG_ERROR_TOKEN', 'YOUR_TOKEN_HERE'):
        raise RuntimeError("Missing/invalid BEARER_TOKEN. Refresh or set a valid access token.")

    return api_url, bearer_token, instrument_key, expiry_date, atm_strike

def next_thursday(date):
    # Upstox weekly index options typically expire on Thursday (adjust to market rules/holidays as needed)
    # Return the next Thursday >= today
    days_ahead = (3 - date.weekday()) % 7  # 3 = Thursday
    return date + dt.timedelta(days=days_ahead)

@app.route('/api/option-chain', methods=['GET'])
def get_option_chain():
    try:
        print(f"in backend...", flush=True)
        dynamic_atm_strike = request.args.get('atm_strike')
        if dynamic_atm_strike:
            try:
                # Convert to integer for use in logic, if valid
                ATM_STRIKE = int(dynamic_atm_strike)
                print(f"INFO: Using dynamic ATM strike from frontend: {ATM_STRIKE}", flush=True)
                UPSTOX_API_URL, BEARER_TOKEN, INSTRUMENT_KEY, EXPIRY_CFG, _ = read_config()
            except ValueError:
                print(f"WARNING: Invalid dynamic strike '{dynamic_atm_strike}'. Falling back to read static atmStrike from config.ini", flush=True)
                UPSTOX_API_URL, BEARER_TOKEN, INSTRUMENT_KEY, EXPIRY_CFG, ATM_STRIKE = read_config()
                print(f"in backend...", flush=True)
        else:
            print(f"INFO: Dynamic strike not provided or empty. Using default from config.ini", flush=True)
            UPSTOX_API_URL, BEARER_TOKEN, INSTRUMENT_KEY, EXPIRY_CFG, ATM_STRIKE = read_config()
    except RuntimeError as e:
        return jsonify({'status': 'error', 'message': str(e)}), 500

    # Allow frontend overrides via querystring: /api/option-chain?expiry_date=YYYY-MM-DD&instrument_key=...
    instrument_key = request.args.get('instrument_key', INSTRUMENT_KEY)
    expiry_date = request.args.get('expiry_date', EXPIRY_CFG)

    # If no expiry supplied anywhere, choose a sensible default (next Thursday)
    if not expiry_date:
        expiry_date = next_thursday(dt.date.today()).strftime('%Y-%m-%d')

    params = {
        'instrument_key': instrument_key,
        'expiry_date': expiry_date
    }
    headers = {
        'Content-Type': 'application/json', 
        'Accept': 'application/json', 
        'Authorization': f'Bearer {BEARER_TOKEN}' 
    }

    try:
        resp = requests.get(UPSTOX_API_URL, params=params, headers=headers, timeout=10)
        if resp.status_code == 401:
            return jsonify({
                'status': 'error',
                'message': 'Upstox auth failed (401). Your access token is missing/invalid/expired. '
                           'Generate a fresh token after 03:30 IST or use refresh_token.'
            }), 401

        # Bubble up other HTTP errors with details
        try:
            resp.raise_for_status()
        except requests.HTTPError:
            return jsonify({'status': 'error',
                            'message': f'Upstox error {resp.status_code}',
                            'details': resp.text}), resp.status_code

        data = resp.json()
        if data.get('status') == 'success' and 'data' in data:
            return jsonify({
                'status': 'success',
                'atm_strike': ATM_STRIKE,
                'data': data['data']
            })
        else:
            return jsonify({'status': 'error',
                            'message': 'Unexpected Upstox response format',
                            'details': data}), 502

    except requests.RequestException as e:
        return jsonify({'status': 'error', 'message': f'Network error talking to Upstox: {e}'}), 502
    except Exception as e:
        return jsonify({'status': 'error', 'message': f'Unexpected server error: {e}'}), 500
    
if __name__ == "__main__":
    os.makedirs('data', exist_ok=True)
    app.run(host='0.0.0.0', port=8000, debug=True)
