// Replace the entire file with this code
import React, { useEffect, useMemo, useState, useRef } from "react";
import axios from "axios";
import { saveAs } from "file-saver";
import Papa from "papaparse";
import {
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  ResponsiveContainer,
  AreaChart,
  Area
} from "recharts";
import Chart from "react-apexcharts";
import { DownloadCloud } from "lucide-react";
import PivotPcrTables from "./components/PivotPcrTables";

// Example prevIndexOhlc object (you should fill these with previous day's real values)
const prevIndexOhlc = {
  high: 25428.75,
  low: 25286.3,
  last: 25327.05,        // or previousClose
  previousClose: 25327.05
};

const POLL_OPTIONS = [
  { label: "Manual", value: 0 },
  { label: "30s", value: 30000 },
  { label: "1m", value: 60000 },
  { label: "5m", value: 300000 },
];

const safeNum = (val, digits = 3) =>
  val != null && isFinite(val) ? Number(val).toFixed(digits) : "—";
const fmt = (n) => {
  if (n == null) return "—";
  const abs = Math.abs(n);
  if (abs >= 1_00_000) return (n/1_00_000).toFixed(1) + "L"; // lakhs
  if (abs >= 1000) return (n/1000).toFixed(1) + "k";
  return String(n);
};

function roundToNearestStrike(spot, step = 50) {
  if (!spot && spot !== 0) return null;
  return Math.round(spot / step) * step;
}

function computeAvgFromOHLC(prevClose, H, L) {
  const A = Math.max(H - L, Math.abs(H - prevClose), Math.abs(L - prevClose));
  return A;
}

function downloadCSV(rows, filename = "nifty_optionchain.csv") {
  const csv = Papa.unparse(rows);
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  saveAs(blob, filename);
}

function heatColor(value, max) {
  if (!max || max <= 0 || value == null) return "#ffffff";
  const ratio = Math.min(1, value / max);
  const g = Math.floor(240 - 120 * ratio);
  const r = Math.floor(255 - 200 * ratio);
  const b = Math.floor(255 - 200 * ratio);
  return `rgb(${r},${g},${b})`;
}

export default function App() {
  const [rows, setRows] = useState([]);
  const [stats, setStats] = useState(null);
  const [candles, setCandles] = useState([]);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState(null);

  const [pollMs, setPollMs] = useState(0);
  const pollRef = useRef(null);

  const [expiryOptions, setExpiryOptions] = useState([]);
  const [selectedExpiry, setSelectedExpiry] = useState(null);

  const [strikeMin, setStrikeMin] = useState(null);
  const [strikeMax, setStrikeMax] = useState(null);
  const [manualOverride, setManualOverride] = useState(false);

  const [windowMode, setWindowMode] = useState("FIXED");
  const [atmWindow, setAtmWindow] = useState(3);
  const [lockMinMax, setLockMinMax] = useState(false);

  const [underlying, setUnderlying] = useState(null);
  const [atmStrike, setAtmStrike] = useState(null);

  const [pcrMode, setPcrMode] = useState("OI");
  const [excludeZeroSide, setExcludeZeroSide] = useState(true);

  const [suggestion, setSuggestion] = useState(null);

  async function fetchOptionChain() {
    try {
      const res = await axios.get("/api/nifty/optionchain");
      if (!Array.isArray(res.data)) throw new Error("optionchain response not array");
      const normalized = res.data.map((r) => ({
        ...r,
        strike: Number(r.strike),
        OI: Number(r.OI || 0),
        OI_change: Number(r.OI_change || r.OI_change || 0),
        volume: Number(r.volume || 0),
        lastPrice: Number(r.lastPrice || 0),
        impliedVolatility: Number(r.impliedVolatility || 0),
        bidQty: Number(r.bidQty || 0),
        bidPrice: Number(r.bidPrice || r.bidprice || 0),
        askQty: Number(r.askQty || 0),
        askPrice: Number(r.askPrice || r.askprice || 0),
        expiry: r.expiry || r.expiryDate || r.expiry_date,
      }));
      setRows(normalized);
      // when building expiry options
      const exps = Array.from(new Set(normalized.map((r) => r.expiry))).filter(Boolean)
        .map(e => ({ raw: e, ts: new Date(e).getTime() }))
        .sort((a,b) => a.ts - b.ts)
        .map(x => x.raw);
      setExpiryOptions(exps);
      if (!selectedExpiry && exps.length) {
        // pick nearest (first element after sort)
        setSelectedExpiry(exps[0]);
      }
      setExpiryOptions(exps);
      if (!selectedExpiry && exps.length) setSelectedExpiry(exps[0]);

      const underlyingVal = normalized.length ? normalized[0].underlyingPrice || normalized[0].underlying : null;
      setUnderlying(underlyingVal);
      if (underlyingVal) {
        const atm = roundToNearestStrike(underlyingVal, 50);
        setAtmStrike(atm);
      }
    } catch (e) {
      console.error(e);
      setErrorMsg(String(e));
    }
  }

  async function fetchWindowStats() {
    try {
      const mode = windowMode;
      const res = await axios.get("/api/nifty/window_stats", { params: { mode: mode, atm_window: atmWindow } });
      setStats(res.data);
    } catch (e) {
      console.error("window_stats", e);
    }
  }

  async function fetchCandles() {
    try {
      const res = await axios.get("/api/nifty/candles");
      const arr = Array.isArray(res.data) ? res.data : [];
      setCandles(arr);
    } catch (e) {
      console.error("candles", e);
    }
  }

  // new state
  const [indexOhlc, setIndexOhlc] = useState(null);

  // fetch index ohlc
  async function fetchIndexOhlc() {
    try {
      const res = await axios.get("/api/nifty/index_ohlc");
      if (res.data) {
        setIndexOhlc(res.data);
        // compute close - avg if available
        const close = res.data.last ?? res.data.close ?? null;
        const avgVal = res.data.avg_val ?? null;
        // update stats/closeMinusAvg etc. (you can push avg_val into stats)
        setStats((s) => ({ ...(s||{}), avg_val: avgVal, prev_close: res.data.prev_close ?? s?.prev_close }));
      }
    } catch (e) {
      console.error("fetchIndexOhlc", e);
    }
  }

  const [marketStats, setMarketStats] = useState(null);
  async function fetchMarketStats() {
    try {
      const r = await axios.get("/api/nifty/market_stats");
      setMarketStats(r.data);
    } catch (e) {
      console.error("market_stats", e);
    }
  }

  async function fetchAll() {
    setLoading(true);
    setErrorMsg(null);
    try {
      await Promise.all([fetchOptionChain(), fetchWindowStats(), fetchCandles(), fetchIndexOhlc(), fetchMarketStats()]);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchAll();
  }, []);

  useEffect(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    if (pollMs > 0) {
      pollRef.current = setInterval(fetchAll, pollMs);
    }
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
      pollRef.current = null;
    };
  }, [pollMs, windowMode, atmWindow]);

  const filtered = useMemo(() => {
    let d = rows.slice();
    if (selectedExpiry) d = d.filter((r) => String(r.expiry) === String(selectedExpiry));
    if (strikeMin != null) d = d.filter((r) => r.strike >= Number(strikeMin));
    if (strikeMax != null) d = d.filter((r) => r.strike <= Number(strikeMax));
    return d;
  }, [rows, selectedExpiry, strikeMin, strikeMax]);

  const strikeAgg = useMemo(() => {
    const map = {};
    for (const r of filtered) {
      const s = r.strike;
      if (!map[s]) map[s] = { strike: s, CE_OI: 0, PE_OI: 0, CE_vol: 0, PE_vol: 0, CE_OI_change: 0, PE_OI_change: 0, CE_last: 0, PE_last: 0, CE_count:0, PE_count:0 };
      if (r.optionType === "CE") {
        map[s].CE_OI += r.OI;
        map[s].CE_OI_change += r.OI_change; 
        map[s].CE_vol += r.volume;
        map[s].CE_last = r.lastPrice;
        map[s].CE_ltp_chng = r.LTP_change;
        map[s].CE_bidQty = r.bidQty;
        map[s].CE_bidPrice = r.bidPrice;
        map[s].CE_askQty = r.askQty;
        map[s].CE_askPrice = r.askPrice;
        map[s].CE_count++;
      } else if (r.optionType === "PE") {
        map[s].PE_OI += r.OI;
        map[s].PE_OI_change += r.OI_change;
        map[s].PE_vol += r.volume;
        map[s].PE_last = r.lastPrice;
        map[s].PE_ltp_chng = r.LTP_change;
        map[s].PE_bidQty = r.bidQty;
        map[s].PE_bidPrice = r.bidPrice;
        map[s].PE_askQty = r.askQty;
        map[s].PE_askPrice = r.askPrice;
        map[s].PE_count++;
      }
    }
    const arr = Object.values(map).sort((a, b) => a.strike - b.strike);
    arr.forEach((row) => {
      row.total_OI = (row.CE_OI || 0) + (row.PE_OI || 0);
      row.PCR = row.CE_OI ? (row.PE_OI / row.CE_OI) : (row.PE_OI ? Infinity : null);
    });
    return arr;
  }, [filtered]);

  const maxOI = useMemo(() => {
    if (!strikeAgg.length) return 0;
    return Math.max(...strikeAgg.map((r) => r.total_OI || 0));
  }, [strikeAgg]);

  useEffect(() => {
    if (manualOverride || lockMinMax) return;
    if (!underlying && !atmStrike) return;
    const atm = atmStrike ?? roundToNearestStrike(underlying, 50);
    if (!atm) return;
    if (windowMode === "FIXED") {
      const low = atm - 500;
      const high = atm + 550;
      setStrikeMin(low);
      setStrikeMax(high);
    } else {
      const low = atm - atmWindow * 50;
      const high = atm + atmWindow * 50;
      setStrikeMin(low);
      setStrikeMax(high);
    }
  }, [windowMode, atmWindow, underlying, atmStrike, manualOverride, lockMinMax]);

  useEffect(() => {
    const pcrWindow = stats?.pcr_window ?? null;
    if (pcrWindow == null) {
      setSuggestion(null);
    } else if (pcrWindow > 1.2) {
      setSuggestion({ side: "CE", text: "CE BUY (PCR > 1.2)", details: `PCR ${safeNum(pcrWindow,2)}` });
    } else if (pcrWindow < 0.8) {
      setSuggestion({ side: "PE", text: "PE BUY (PCR < 0.8)", details: `PCR ${safeNum(pcrWindow,2)}` });
    } else {
      setSuggestion(null);
    }
  }, [stats]);

  const prevClose = stats?.prev_close ?? null;
  const ohlc = useMemo(() => {
    if (candles && candles.length) {
      const last = candles[candles.length - 1];
      return { open: last.open, high: last.high, low: last.low, close: last.close };
    }
    return { open: null, high: null, low: null, close: null };
  }, [candles, stats]);

  const avgVal = useMemo(() => {
    if (!prevClose || !ohlc) return null;
    const H = ohlc.high ?? 0;
    const L = ohlc.low ?? 0;
    return computeAvgFromOHLC(prevClose, H, L);
  }, [prevClose, ohlc]);

  const oiProfileData = strikeAgg.map((r) => ({ strike: r.strike, CE_OI: r.CE_OI || 0, PE_OI: r.PE_OI || 0, total_OI: r.total_OI || 0 }));

  const expiryAreaData = useMemo(() => {
    const map = {};
    for (const r of rows) {
      const e = r.expiry || "unknown";
      map[e] = map[e] || { expiry: e, CE_OI: 0, PE_OI: 0 };
      if (r.optionType === "CE") map[e].CE_OI += r.OI || 0;
      if (r.optionType === "PE") map[e].PE_OI += r.OI || 0;
    }
    return Object.values(map).sort((a,b)=> new Date(a.expiry) - new Date(b.expiry));
  }, [rows]);



  // fetch once (or poll at interval) - adapt polling logic as needed
  useEffect(() => {
    let cancelled = false;
    async function fetchOhlc() {
      try {
        const res = await axios.get("/api/nifty/index_ohlc");
        if (!cancelled && res?.data && !res.data.error) {
          setIndexOhlc(res.data);
        }
      } catch (e) {
        console.error("fetchIndexOhlc", e);
      }
    }
    fetchOhlc();
    // if you want continuous polling uncomment:
    // const id = setInterval(fetchOhlc, 30 * 1000); // every 30s
    // return () => { cancelled = true; clearInterval(id); };
    return () => { cancelled = true; };
  }, []);

  // helper to parse timeVal or fallback to now
  function parseTimeVal(t) {
    if (!t) return new Date();
    // The API gives "19-Sep-2025 15:30" — try parse using Date.parse by converting to ISO-like string:
    // convert "19-Sep-2025 15:30" -> "19 Sep 2025 15:30:00"
    try {
      const s = t.replace(/-/g, " "); // "19 Sep 2025 15:30"
      // Some browsers parse "19 Sep 2025 15:30" ok; fallback to Date constructor
      const parsed = Date.parse(s);
      return Number.isFinite(parsed) ? new Date(parsed) : new Date();
    } catch {
      return new Date();
    }
  }

  // Build a tiny 2-point series using prev close + current snapshot
  const candleSeries = useMemo(() => {
    if (!indexOhlc) return [{ data: [] }];

    // defensive numeric extraction
    const open = Number(indexOhlc.open ?? indexOhlc.openValue ?? indexOhlc.o);
    const high = Number(indexOhlc.high ?? indexOhlc.highValue ?? indexOhlc.h);
    const low  = Number(indexOhlc.low  ?? indexOhlc.lowValue ?? indexOhlc.l);
    const close= Number(indexOhlc.last ?? indexOhlc.lastValue ?? indexOhlc.value);
    const prev = Number(indexOhlc.prev_close ?? indexOhlc.previousClose ?? indexOhlc.prev);

    // parse timestamp (use timeVal if present)
    const ts = parseTimeVal(indexOhlc.ts ?? indexOhlc.timeVal ?? indexOhlc.time ?? indexOhlc.timestamp);

    // previous candle timestamp: subtract one interval (e.g. 1 minute)
    const prevTs = new Date(ts.getTime() - 60 * 1000);

    // ensure numeric fallback and sensible ordering
    const valid = [open, high, low, close].every(v => Number.isFinite(v));
    if (!valid) return [{ data: [] }];

    const prevCloseVal = Number.isFinite(prev) ? prev : open; // fallback

    const prevCandle = { x: prevTs, y: [prevCloseVal, prevCloseVal, prevCloseVal, prevCloseVal] };
    const currCandle = { x: ts,       y: [open, high, low, close] };

    return [{ data: [prevCandle, currCandle] }];
  }, [indexOhlc]);

  // compute y-axis min/max and padding (handle identical min==max)
  const yMinMax = useMemo(() => {
    const pts = (candleSeries[0]?.data || []).flatMap(pt => pt.y).filter(Number.isFinite);
    if (!pts.length) return null;
    const min = Math.min(...pts), max = Math.max(...pts);
    if (min === max) {
      const padAbs = Math.max(1.0, Math.abs(min) * 0.001);
      return { min: min - padAbs, max: max + padAbs };
    }
    const pad = Math.max((max - min) * 0.003, 0.5);
    return { min: min - pad, max: max + pad };
  }, [candleSeries]);

  // compute explicit x-axis min/max so candles don't stretch too wide
  const xMinMax = useMemo(() => {
    const data = candleSeries?.[0]?.data ?? [];
    if (!data || data.length === 0) return null;
    // get epoch ms for first and last point
    const first = data[0].x instanceof Date ? data[0].x.getTime() : new Date(data[0].x).getTime();
    const last  = data[data.length - 1].x instanceof Date ? data[data.length - 1].x.getTime() : new Date(data[data.length - 1].x).getTime();
    if (!Number.isFinite(first) || !Number.isFinite(last)) return null;

    // interval between points (ms). If only one point, choose default interval 60000 (1min)
    const interval = (data.length > 1) ? Math.max(last - first, 1000) : 60000;

    // padding: a fraction of interval or a minimum (30s)
    const pad = Math.max(interval * 0.12, 90 * 1000); // tune 0.6 to make candles narrower/wider

    return { min: first - pad, max: last + pad };
  }, [candleSeries]);

  // If you already compute closeMinusAvg elsewhere, reuse it.
  // Otherwise compute simple close - avg from indexOhlc
  const closeMinusAvg = useMemo(() => {
    if (!indexOhlc) return null;
    const c = Number(indexOhlc.last ?? indexOhlc.lastValue ?? indexOhlc.value);
    const avg = Number(indexOhlc.avg_val ?? indexOhlc.avgValue ?? 0);
    if (!Number.isFinite(c) || !Number.isFinite(avg)) return null;
    return c - avg;
  }, [indexOhlc]);

  // chart options
  const candleOptions = useMemo(() => ({
    chart: { type: "candlestick", height: 360, animations: { enabled: false }, toolbar: { show: true } },
    title: { text: "Underlying Candles (snapshot)", align: "left" },
    xaxis: {
      type: "datetime",
      ...(xMinMax ? { min: xMinMax.min, max: xMinMax.max } : {})
    },
    yaxis: yMinMax ? { min: yMinMax.min, max: yMinMax.max } : undefined,
    plotOptions: {
      candlestick: {
        colors: {
          upward: closeMinusAvg != null ? (closeMinusAvg > 0 ? "#26a69a" : "#ef5350") : "#26a69a",
          downward: closeMinusAvg != null ? (closeMinusAvg > 0 ? "#ef5350" : "#26a69a") : "#ef5350"
        },
        wick: { useFillColor: true }
      }
    },
    tooltip: { enabled: true, shared: false }
  }), [yMinMax, xMinMax]);

  // inside component that has windowStats from API
  const { pcr_window, pcr_window_ch, pcr_window_ch_details, vwap } = stats || {};

  const pcrSuggestion = useMemo(() => {
    if (pcr_window == null) return null;

    if (pcr_window > 1.2) {
      return { side: "CE", text: `Suggest: CE BUY (PCR > 1.2) (PCR ${pcr_window.toFixed(3)})`, color: "#074" };
    }
    if (pcr_window < 0.8) {
      return { side: "PE", text: `Suggest: PE BUY (PCR < 0.8) (PCR ${pcr_window.toFixed(3)})`, color: "#a00" };
    }
    // Sideways case (between 0.8 and 1.2 inclusive)
    return { side: "SIDEWAYS", text: `Suggest: Sideways (PCR ${pcr_window.toFixed(3)})`, color: "#555" };
  }, [pcr_window]);


  function onExportCSV() {
    const flat = strikeAgg.map((r) => ({
      strike: r.strike,
      CE_OI: r.CE_OI,
      PE_OI: r.PE_OI,
      total_OI: r.total_OI,
      PCR: isFinite(r.PCR) ? r.PCR : null
    }));
    downloadCSV(flat);
  }

  return (
    <div style={{ padding: 18, background: "#f3f4f6", minHeight: "100vh" }}>
      <div
        style={{
          maxWidth: 1200,
          margin: "0 auto",
          background: "#fff",
          padding: 18,
          borderRadius: 8,
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <h1 style={{ margin: 0 }}>NIFTY OI Dashboard</h1>
          <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
            <select
              style={{ padding: "6px 10px" }}
              value={pollMs}
              onChange={(e) => setPollMs(Number(e.target.value))}
            >
              {POLL_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  Poll: {o.label}
                </option>
              ))}
            </select>
            <button
              onClick={fetchAll}
              className="px-3 py-1 bg-sky-600 text-white rounded"
              style={{ padding: "6px 10px" }}
            >
              Fetch
            </button>
            <button
              onClick={onExportCSV}
              className="px-3 py-1 bg-sky-600 text-white rounded"
              style={{ padding: "6px 10px" }}
            >
              <DownloadCloud size={16} /> Export CSV
            </button>
          </div>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "320px 1fr",
            gap: 16,
            marginTop: 16,
          }}
        >
          <div>
            <div
              style={{
                padding: 12,
                border: "1px solid #e5e7eb",
                borderRadius: 6,
                background: "#fff",
              }}
            >
              <div style={{ fontSize: 12, color: "#6b7280" }}>Underlying</div>
              <div style={{ fontSize: 24, fontWeight: 600 }}>
                {underlying ?? "-"}
              </div>
              <div style={{ marginTop: 8 }}>
                ATM: <strong>{atmStrike ?? "-"}</strong>
              </div>
              <div style={{ marginTop: 8 }}>
                Overall PCR: <strong>{safeNum(stats?.pcr_overall, 3)}</strong>
              </div>
              <div style={{ marginTop: 8 }}>
                Max Pain:{" "}
                <strong>{stats?.max_pain?.max_pain_strike ?? "-"}</strong>
              </div>
            </div>

            <div
              style={{
                marginTop: 12,
                padding: 12,
                border: "1px solid #e5e7eb",
                borderRadius: 6,
                background: "#fff",
              }}
            >
              <div style={{ fontWeight: 600, marginBottom: 6 }}>Expiry</div>
              <select
                value={selectedExpiry || ""}
                onChange={(e) => setSelectedExpiry(e.target.value)}
                style={{ width: "100%", padding: 6 }}
              >
                <option value="">-- select expiry --</option>
                {expiryOptions.map((e) => (
                  <option key={e} value={e}>
                    {new Date(e).toLocaleDateString()}
                  </option>
                ))}
              </select>

              {/* Strike filter */}
              <div style={{ marginTop: 12 }}>
                <div style={{ marginBottom: 6 }}>Strike filter</div>
                <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  <input
                    type="number"
                    placeholder="min"
                    value={strikeMin ?? ""}
                    onChange={(e) => {
                      setManualOverride(true);
                      setStrikeMin(
                        e.target.value ? Number(e.target.value) : null
                      );
                    }}
                    style={{ width: 110, padding: 6, height: 12 }}
                  />
                  <input
                    type="number"
                    placeholder="max"
                    value={strikeMax ?? ""}
                    onChange={(e) => {
                      setManualOverride(true);
                      setStrikeMax(
                        e.target.value ? Number(e.target.value) : null
                      );
                    }}
                    style={{ width: 110, padding: 6, height: 12 }}
                  />
                  <button
                    className="px-3 py-1 bg-sky-600 text-white rounded"
                    onClick={() => {
                      setStrikeMin(null);
                      setStrikeMax(null);
                    }}
                  >
                    Reset
                  </button>
                </div>
              </div>

              <div style={{ marginTop: 12 }}>
                <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  <button
                    onClick={() => {
                      setWindowMode("FIXED");
                      setManualOverride(false);
                    }}
                    style={{
                      padding: "6px 8px",
                      background:
                        windowMode === "FIXED" ? "#0369a1" : "#f3f4f6",
                      color: windowMode === "FIXED" ? "#fff" : "#000",
                    }}
                  >
                    Fixed (Spot±)
                  </button>
                  <button
                    onClick={() => {
                      setWindowMode("DYNAMIC");
                      setManualOverride(false);
                    }}
                    style={{
                      padding: "6px 8px",
                      background:
                        windowMode === "DYNAMIC" ? "#0369a1" : "#f3f4f6",
                      color: windowMode === "DYNAMIC" ? "#fff" : "#000",
                    }}
                  >
                    Dynamic (± strikes)
                  </button>
                  <label
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                      marginLeft: 8,
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={lockMinMax}
                      onChange={(e) => setLockMinMax(e.target.checked)}
                    />{" "}
                    Lock
                  </label>
                </div>

                <div style={{ marginTop: 8 }}>
                  <div style={{ fontSize: 12 }}>
                    ATM window (strikes each side)
                  </div>
                  <input
                    type="range"
                    min={1}
                    max={20}
                    value={atmWindow}
                    onChange={(e) => setAtmWindow(Number(e.target.value))}
                  />
                  <div style={{ fontSize: 12 }}>
                    {atmWindow} strikes each side
                  </div>
                </div>
              </div>

              <div style={{ marginTop: 12 }}>
                <div style={{ fontSize: 12 }}>PCR mode</div>
                <select
                  value={pcrMode}
                  onChange={(e) => setPcrMode(e.target.value)}
                >
                  <option value="OI">OI-based</option>
                  <option value="VOLUME">Volume-based</option>
                </select>
                <div style={{ marginTop: 6 }}>
                  <label>
                    <input
                      type="checkbox"
                      checked={excludeZeroSide}
                      onChange={(e) => setExcludeZeroSide(e.target.checked)}
                    />{" "}
                    Exclude strikes with zero CE/PE for overall PCR
                  </label>
                </div>
              </div>
            </div>
          </div>

          <div>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 360px",
                gap: 12,
              }}
            >
              <div
                style={{
                  padding: 12,
                  border: "1px solid #e5e7eb",
                  borderRadius: 6,
                  background: "#fff",
                }}
              >
                <h3 style={{ marginTop: 0 }}>OI Profile (CE vs PE)</h3>
                <div style={{ width: "100%", height: 320 }}>
                  <ResponsiveContainer>
                    <ComposedChart data={oiProfileData}>
                      <XAxis dataKey="strike" />
                      <YAxis />
                      <Tooltip formatter={(v) => fmt(v)} />
                      <Legend />
                      <Bar dataKey="CE_OI" name="CE OI" fill="#1f77b4" />{" "}
                      {/* blue for CE */}
                      <Bar dataKey="PE_OI" name="PE OI" fill="#ff7f0e" />{" "}
                      {/* orange for PE */}
                      <Line
                        dataKey="total_OI"
                        name="Total OI"
                        stroke="#111827"
                      />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
              </div>

              <div>
                <div
                  className="p-3 border rounded space-y-3 bg-white"
                  style={{
                    padding: 12,
                    border: "1px solid #e5e7eb",
                    borderRadius: 6,
                  }}
                >
                  <h3 className="font-medium">Window Summary</h3>
                  <div className="text-sm">
                    <div>
                      <strong>ATM:</strong> {stats?.atm ?? "-"}
                    </div>
                    <div>
                      <strong>Range:</strong> {stats?.low ?? "-"} —{" "}
                      {stats?.high ?? "-"}
                    </div>
                    <div>
                      <strong>Overall PCR:</strong>{" "}
                      {safeNum(stats?.pcr_overall, 3)}
                    </div>
                    <div>
                      <strong>Window PCR:</strong>{" "}
                      {safeNum(stats?.pcr_window, 3)}
                    </div>
                    <div style={{ marginBottom: 8 }}>
                      <strong>PCR Change (PE/CE):</strong>{" "}
                      {pcr_window_ch != null ? pcr_window_ch.toFixed(4) : "—"}
                      {pcr_window_ch_details && (
                        <span style={{ marginLeft: 12, color: "#666" }}>
                          (PE Δ:{" "}
                          {pcr_window_ch_details.PE_change ??
                            pcr_window_ch_details.PE_change ??
                            0}{" "}
                          / CE Δ:{" "}
                          {pcr_window_ch_details.CE_change ??
                            pcr_window_ch_details.CE_change ??
                            0}
                          )
                        </span>
                      )}
                    </div>
                    <div style={{ marginBottom: 8 }}>
                      <strong>VWAP (PE / CE):</strong>{" "}
                      {vwap?.PE ? vwap.PE.toFixed(3) : "—"} /{" "}
                      {vwap?.CE ? vwap.CE.toFixed(3) : "—"}
                    </div>

                    {pcrSuggestion && (
                      <div
                        style={{
                          background: pcrSuggestion.color + "18",
                          color: pcrSuggestion.color,
                          padding: "8px 10px",
                          borderRadius: 6,
                          display: "inline-block",
                        }}
                      >
                        {pcrSuggestion.text}
                      </div>
                    )}
                    <div>
                      <strong>Skew (med PE IV / med CE IV):</strong>{" "}
                      {safeNum(stats?.skew, 3)}
                    </div>
                    <div>
                      <strong>Max Pain:</strong>{" "}
                      {stats?.max_pain?.max_pain_strike ?? "-"}
                    </div>
                  </div>
                  <div className="text-sm">
                    <div>
                      <strong>Prev Close:</strong>{" "}
                      {indexOhlc?.prev_close ?? "-"}
                    </div>
                    <div>
                      <strong>Open:</strong> {indexOhlc?.open ?? "-"}
                    </div>
                    <div>
                      <strong> High:</strong> {indexOhlc?.high ?? "-"}
                    </div>
                    <div>
                      <strong> Low:</strong> {indexOhlc?.low ?? "-"}
                    </div>
                    <div>
                      <strong> Last:</strong> {indexOhlc?.last ?? "-"}
                    </div>
                    {/*<div><strong> Momentum:</strong> {indexOhlc?.momentum ?? "-"}</div>*/}
                    <div>
                      <strong> Momentum:</strong>{" "}
                      {safeNum(indexOhlc?.momentum ?? "-", 2)}
                    </div>
                    <div>
                      <strong>Avg:</strong>{" "}
                      {indexOhlc?.avg_val?.toFixed(2) ?? "-"}
                    </div>
                    <div>
                      <strong>Close - Avg:</strong>{" "}
                      {indexOhlc && indexOhlc.last && indexOhlc.avg_val
                        ? (indexOhlc.last - indexOhlc.avg_val).toFixed(2)
                        : "-"}
                    </div>
                    <div>
                      <strong>Trend:</strong>{" "}
                      {indexOhlc && indexOhlc.last && indexOhlc.avg_val ? (
                        <span
                          style={{
                            color:
                              indexOhlc.last > indexOhlc.avg_val
                                ? "green"
                                : "red",
                            fontWeight: 600,
                          }}
                        >
                          {indexOhlc.last > indexOhlc.avg_val
                            ? "Uptrend"
                            : "Downtrend"}
                        </span>
                      ) : (
                        "-"
                      )}
                    </div>
                  </div>
                  <div
                    className="text-xs text-gray-500"
                    style={{ marginTop: 8 }}
                  >
                    Polling: {pollMs ? `${pollMs / 1000}s` : "Manual"}
                  </div>
                  <div>
                    <strong>Advance:</strong> {marketStats?.advance ?? "-"}
                  </div>
                  <div>
                    <strong>Decline:</strong> {marketStats?.decline ?? "-"}
                  </div>
                </div>
              </div>
            </div>

            <div
              style={{
                marginTop: 12,
                padding: 12,
                border: "1px solid #e5e7eb",
                borderRadius: 6,
                background: "#fff",
              }}
            >
              <h3 style={{ marginTop: 0 }}>OI by Expiry (stacked area)</h3>
              <div style={{ width: "100%", height: 220 }}>
                <ResponsiveContainer>
                  <AreaChart data={expiryAreaData}>
                    <XAxis
                      dataKey="expiry"
                      tickFormatter={(v) => new Date(v).toLocaleDateString()}
                    />
                    <YAxis />
                    <Tooltip />
                    <Area
                      type="monotone"
                      dataKey="CE_OI"
                      stackId="1"
                      name="CE OI"
                    />
                    <Area
                      type="monotone"
                      dataKey="PE_OI"
                      stackId="1"
                      name="PE OI"
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div
              style={{
                marginTop: 12,
                padding: 12,
                border: "1px solid #e5e7eb",
                borderRadius: 6,
                background: "#fff",
              }}
            >
              <h3 style={{ marginTop: 0 }}>Underlying Candles</h3>
              <div>
                {/* optionally show the raw indexOhlc for debug */}
                {/*<pre style={{fontSize:12}}>{indexOhlc ? JSON.stringify(indexOhlc, null, 2) : "indexOhlc: loading..."}</pre>*/}
                <Chart
                  options={candleOptions}
                  series={candleSeries}
                  type="candlestick"
                  height={320}
                />
              </div>
            </div>
          </div>
        </div>

        <div
          style={{
            marginTop: 18,
            padding: 12,
            border: "1px solid #e5e7eb",
            borderRadius: 6,
            background: "#fff",
          }}
        >
          {/* show placeholder until indexOhlc is available */}
          {indexOhlc ? (
            <PivotPcrTables
              indexOhlc={indexOhlc}
              strikeAgg={strikeAgg}
              atmStrike={atmStrike}
              windowStats={stats}
            />
          ) : (
            <div style={{ padding: 12, color: "#666" }}>
              Loading pivot / PCR…
            </div>
          )}
        </div>

        <div
          style={{
            marginTop: 18,
            padding: 12,
            border: "1px solid #e5e7eb",
            borderRadius: 6,
            background: "#fff",
          }}
        >
          <h2>Strike Table</h2>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead style={{ background: "#f3f4f6" }}>
                <tr>
                  <th style={{ padding: 8, textAlign: "left" }}>CE OI</th>
                  <th style={{ padding: 8, textAlign: "left" }}>CE OI Chng</th>
                  <th style={{ padding: 8, textAlign: "left" }}>CE Vol</th>
                  <th style={{ padding: 8, textAlign: "left" }}>CE IV</th>
                  <th style={{ padding: 8, textAlign: "left" }}>CE Theta</th>
                  <th style={{ padding: 8, textAlign: "left" }}>CE Delta</th>
                  <th style={{ padding: 8, textAlign: "left" }}>CE Gamma</th>
                  <th style={{ padding: 8, textAlign: "left" }}>CE LTP</th>
                  <th style={{ padding: 8, textAlign: "left" }}>CE LTP Chng</th>
                  <th style={{ padding: 8, textAlign: "left" }}>CE Bid Qty</th>
                  <th style={{ padding: 8, textAlign: "left" }}>CE Bid</th>
                  <th style={{ padding: 8, textAlign: "left" }}>CE Ask</th>
                  <th style={{ padding: 8, textAlign: "left" }}>CE Ask Qty</th>

                  <th style={{ padding: 8, textAlign: "left" }}>Strike</th>

                  <th style={{ padding: 8, textAlign: "left" }}>PE OI</th>
                  <th style={{ padding: 8, textAlign: "left" }}>PE OI Chng</th>
                  <th style={{ padding: 8, textAlign: "left" }}>PE Vol</th>
                  <th style={{ padding: 8, textAlign: "left" }}>PE IV</th>
                  <th style={{ padding: 8, textAlign: "left" }}>PE Theta</th>
                  <th style={{ padding: 8, textAlign: "left" }}>PE Delta</th>
                  <th style={{ padding: 8, textAlign: "left" }}>PE Gamma</th>
                  <th style={{ padding: 8, textAlign: "left" }}>PE LTP</th>
                  <th style={{ padding: 8, textAlign: "left" }}>PE LTP Chng</th>
                  <th style={{ padding: 8, textAlign: "left" }}>PE Bid Qty</th>
                  <th style={{ padding: 8, textAlign: "left" }}>PE Bid</th>
                  <th style={{ padding: 8, textAlign: "left" }}>PE Ask</th>
                  <th style={{ padding: 8, textAlign: "left" }}>PE Ask Qty</th>
                </tr>
              </thead>

              <tbody>
                {strikeAgg.map((r) => {
                  const isAtm = r.strike === atmStrike;
                  const rowStyle = isAtm ? { background: "#fff7ed" } : {};
                  return (
                    <tr key={r.strike} style={rowStyle}>
                      <td
                        style={{
                          padding: 8,
                          background: heatColor(r.CE_OI, maxOI),
                        }}
                      >
                        {fmt(r.CE_OI)}
                      </td>
                      <td
                        style={{
                          padding: 8,
                          color:
                            r.CE_OI_change > 0
                              ? "green"
                              : r.CE_OI_change < 0
                              ? "red"
                              : "inherit",
                        }}
                      >
                        {fmt(r.CE_OI_change)}
                      </td>
                      <td style={{ padding: 8 }}>{fmt(r.CE_vol)}</td>
                      <td style={{ padding: 8 }}>
                        {safeNum(r.CE_iv ?? r.CE_impliedVol ?? null)}
                      </td>
                      <td style={{ padding: 8 }}>
                        {safeNum(r.CE_theta ?? null)}
                      </td>
                      <td style={{ padding: 8 }}>
                        {safeNum(r.CE_delta ?? null)}
                      </td>
                      <td style={{ padding: 8 }}>
                        {safeNum(r.CE_gamma ?? null)}
                      </td>
                      <td style={{ padding: 8 }}>
                        {safeNum(r.CE_last ?? null, 2)}
                      </td>
                      {/*<td style={{ padding: 8 }}>{safeNum(r.CE_ltp_chng ?? null,2)}</td>*/}
                      <td
                        style={{
                          padding: 8,
                          color:
                            r.CE_ltp_chng > 0
                              ? "green"
                              : r.CE_ltp_chng < 0
                              ? "red"
                              : "inherit",
                        }}
                      >
                        {safeNum(r.CE_ltp_chng ?? null, 2)}
                      </td>
                      <td style={{ padding: 8 }}>{fmt(r.CE_bidQty)}</td>
                      <td style={{ padding: 8 }}>
                        {safeNum(r.CE_bidPrice ?? null, 2)}
                      </td>
                      <td style={{ padding: 8 }}>
                        {safeNum(r.CE_askPrice ?? null, 2)}
                      </td>
                      <td style={{ padding: 8 }}>{fmt(r.CE_askQty)}</td>

                      <td style={{ padding: 8, background: "#fff7ed" }}>
                        {r.strike}
                      </td>

                      <td
                        style={{
                          padding: 8,
                          background: heatColor(r.PE_OI, maxOI),
                        }}
                      >
                        {fmt(r.PE_OI)}
                      </td>
                      <td
                        style={{
                          padding: 8,
                          color:
                            r.PE_OI_change > 0
                              ? "green"
                              : r.PE_OI_change < 0
                              ? "red"
                              : "inherit",
                        }}
                      >
                        {fmt(r.PE_OI_change)}
                      </td>
                      <td style={{ padding: 8 }}>{fmt(r.PE_vol)}</td>
                      <td style={{ padding: 8 }}>
                        {safeNum(r.PE_iv ?? r.PE_impliedVol ?? null)}
                      </td>
                      <td style={{ padding: 8 }}>
                        {safeNum(r.PE_theta ?? null)}
                      </td>
                      <td style={{ padding: 8 }}>
                        {safeNum(r.PE_delta ?? null)}
                      </td>
                      <td style={{ padding: 8 }}>
                        {safeNum(r.PE_gamma ?? null)}
                      </td>
                      <td style={{ padding: 8 }}>
                        {safeNum(r.PE_last ?? null, 2)}
                      </td>
                      {/*<td style={{ padding: 8 }}>{safeNum(r.PE_ltp_chng ?? null,2)}</td>*/}
                      <td
                        style={{
                          padding: 8,
                          color:
                            r.PE_ltp_chng > 0
                              ? "green"
                              : r.PE_ltp_chng < 0
                              ? "red"
                              : "inherit",
                        }}
                      >
                        {safeNum(r.PE_ltp_chng ?? null, 2)}
                      </td>
                      <td style={{ padding: 8 }}>{fmt(r.PE_bidQty)}</td>
                      <td style={{ padding: 8 }}>
                        {safeNum(r.PE_bidPrice ?? null, 2)}
                      </td>
                      <td style={{ padding: 8 }}>
                        {safeNum(r.PE_askPrice ?? null, 2)}
                      </td>
                      <td style={{ padding: 8 }}>{fmt(r.PE_askQty)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        <div style={{ marginTop: 12, color: "#6b7280" }}>
          Rows: {rows.length} • Filtered: {filtered.length}
          {errorMsg && (
            <div style={{ color: "crimson" }}>Error: {errorMsg}</div>
          )}
        </div>
      </div>
    </div>
  );
}
