# candles.py
import json, os
from datetime import datetime

SNAPSHOT_FILE = "data/snapshots.jsonl"
CANDLES_FILE = "data/candles_1m.json"

def append_snapshot(snapshot):
    os.makedirs('data', exist_ok=True)
    with open(SNAPSHOT_FILE, 'a') as f:
        f.write(json.dumps(snapshot, default=str) + "\n")

def build_candles_from_snapshots():
    rows = []
    if not os.path.exists(SNAPSHOT_FILE): return []
    with open(SNAPSHOT_FILE) as f:
        for line in f:
            rows.append(json.loads(line))
    buckets = {}
    for r in rows:
        ts = datetime.fromisoformat(r['ts'])
        key = ts.replace(second=0, microsecond=0)
        rec = buckets.setdefault(key.isoformat(), {'open':None,'high':-1e9,'low':1e9,'close':None,'volume':0})
        price = r.get('underlyingPrice', None)
        if price is None: continue
        if rec['open'] is None: rec['open'] = price
        rec['high'] = max(rec['high'], price)
        rec['low'] = min(rec['low'], price)
        rec['close'] = price
        rec['volume'] += r.get('volume_sum', 0)
    out = []
    for k in sorted(buckets.keys()):
        v = buckets[k]
        out.append({'ts': k, 'open': v['open'], 'high': v['high'], 'low': v['low'], 'close': v['close'], 'volume': v['volume']})
    with open(CANDLES_FILE, 'w') as f:
        json.dump(out, f, default=str)
    return out
