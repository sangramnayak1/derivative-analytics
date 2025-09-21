# fetcher.py
import requests, time
import pandas as pd

NSE_OPTC_URL = "https://www.nseindia.com/api/option-chain-indices?symbol=NIFTY"
HEADERS = {
    "User-Agent": "Mozilla/5.0",
    "Accept": "application/json, text/plain, */*",
    "Referer": "https://www.nseindia.com/option-chain"
}

def fetch_nse_json(session=None, retries=3, pause=0.5):
    s = session or requests.Session()
    last = None
    for i in range(retries):
        try:
            s.get("https://www.nseindia.com", headers=HEADERS, timeout=5)
            r = s.get(NSE_OPTC_URL, headers=HEADERS, timeout=6)
            r.raise_for_status()
            return r.json()
        except Exception as e:
            last = e
            time.sleep(pause*(i+1))
    raise RuntimeError(f"Failed to fetch NSE option chain: {last}")

def normalize_nse_json(j):
    rows = []
    underlying = j.get('records', {}).get('underlyingValue', None)
    data = j.get('records', {}).get('data', [])
    for d in data:
        strike = float(d.get('strikePrice', 0))
        expiry = d.get('expiryDate')
        for t in ('CE', 'PE'):
            if t in d:
                o = d[t]
                rows.append({
                    'expiry': expiry,
                    'strike': strike,
                    'optionType': t,
                    'OI': int(o.get('openInterest') or 0),
                    'OI_change': int(o.get('changeinOpenInterest') or 0),
                    'volume': int(o.get('totalTradedVolume') or 0),
                    'lastPrice': float(o.get('lastPrice') or 0.0),
                    "LTP_change": float(o.get('change') or 0.0), 
                    'impliedVolatility': float(o.get('impliedVolatility') or 0.0),
                    'bidQty': int(o.get('bidQty') or 0),
                    'bidPrice': float(o.get('bidprice') or 0.0),
                    'askQty': int(o.get('askQty') or 0),
                    'askPrice': float(o.get('askPrice') or 0.0),
                    'underlyingPrice': float(o.get('underlyingValue') or 0.0)
                })
    df = pd.DataFrame(rows)
    df['expiry'] = pd.to_datetime(df['expiry'], dayfirst=True, errors='coerce')
    return df
