import pandas as pd, os, json, requests

# Set up a session so cookies persist
s = requests.Session()
headers = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                  "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept": "application/json, text/javascript, */*; q=0.01",
    "Referer": "https://www.nseindia.com",
    "Connection": "keep-alive"
}

# Step 1: hit homepage to get cookies
s.get("https://www.nseindia.com", headers=headers, timeout=10)

# Step 2: fetch index data
url = "https://www.nseindia.com/api/NextApi/apiClient?functionName=getIndexData&&type=All"
params = {"functionName": "getIndexData&&type=All"}
r = s.get(url, params=None, headers=headers, timeout=10)

print("Status:", r.status_code, "Content-Type:", r.headers.get("Content-Type"))
print("First 500 chars of response:\n", r.text[:500])

# Try parsing JSON if it looks valid
try:
    data = r.json()
    print("Parsed JSON keys:", list(data.keys()))
    # If it has nested dicts/lists, inspect structure
    print(json.dumps(data, indent=2)[:1000])
except Exception as e:
    print("Not JSON:", e)

