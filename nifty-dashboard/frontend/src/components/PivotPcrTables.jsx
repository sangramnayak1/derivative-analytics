import React, { useMemo } from "react";

/**
 * PivotPcrTables
 *
 * Props:
 *  - indexOhlc: object { open, high, low, last, prev_close, avg_val, ... }
 *  - strikeAgg: array of strike aggregated rows (must contain: strike, CE_OI, PE_OI)
 *  - atmStrike: number (ATM strike)
 *  - windowStats: optional object returned from /api/nifty/window_stats (contains max_pain etc.)
 *
 * Usage:
 *  <PivotPcrTables indexOhlc={indexOhlc} strikeAgg={strikeAgg} atmStrike={atm} windowStats={windowStats} />
 */
export default function PivotPcrTables({ indexOhlc = {}, prevIndexOhlc = null, strikeAgg = [], atmStrike = null, windowStats = {} }) {
    // ---- helpers ----
    const fmtNum = (v, dp = 0) => {
        if (v === null || v === undefined || Number.isNaN(v)) return "—";
        const n = Number(v);
        if (!Number.isFinite(n)) return "—";
        if (Math.abs(n) >= 100000) return (n / 100000).toFixed(dp) + "L";
        if (Math.abs(n) >= 1000) return (n / 1000).toFixed(dp) + "k";
        return dp ? n.toFixed(dp) : n.toString();
    };
    const fmtFixed = (v, dp = 2) => (v == null ? "—" : Number(v).toFixed(dp));

    // ---- pivot calculations (classic pivot) ----
    // use prevIndexOhlc if provided, otherwise fallback to indexOhlc
    const pivotData = useMemo(() => {
        const source = prevIndexOhlc;   // strictly use previous day OHLC for pivots
        console.log("Pivot calc input:", { prevIndexOhlc, indexOhlc });
        if (!source) return null;

        const h = Number(source?.high ?? source?.h);
        const l = Number(source?.low ?? source?.l);
        const c = Number(source?.close ?? source?.c ?? source?.previousClose);

        if (![h, l, c].every(v => Number.isFinite(v))) return null;

        // Classic pivots from previous day
        const P  = (h + l + c) / 3.0;
        const R1 = (2 * P) - l;
        const S1 = (2 * P) - h;
        const R2 = P + (h - l);
        const S2 = P - (h - l);
        const R3 = h + 2 * (P - l);
        const S3 = l - 2 * (h - P);

        const momentum = R1 - S1;

        // Today’s price for difference
        const indexVal = Number(indexOhlc?.last ?? indexOhlc?.prev_close ?? NaN);
        const pd = (level) => (Number.isFinite(indexVal) ? (indexVal - level) : null);

        // Gap is relative distance from pivot
        const gap = {
            S3: S3 - P,
            S2: S2 - P,
            S1: S1 - P,
            CP: 0,
            R1: R1 - P,
            R2: R2 - P,
            R3: R3 - P,
        };

        return {
            P, R1, R2, R3, S1, S2, S3,
            indexVal,
            gap,
            pivotDiff: {
                S3: pd(S3), S2: pd(S2), S1: pd(S1),
                CP: pd(P),
                R1: pd(R1), R2: pd(R2), R3: pd(R3),
            },
            momentum
        };
        console.log("Pivot calc input:", { prevIndexOhlc, indexOhlc });
    }, [indexOhlc, prevIndexOhlc]);


    // ---- PCR breakdown (OTM / ATM / ITM / TOTAL / Max Pain) ----
    const pcrData = useMemo(() => {
        if (!Array.isArray(strikeAgg)) return null;

        const atm = Number(atmStrike);
        if (!Number.isFinite(atm)) return null;

        const makeBucket = () => ({
            CE_OI: 0, PE_OI: 0,
            CE_vol: 0, PE_vol: 0,
            CE_OI_change: 0, PE_OI_change: 0,   // NEW: track OI changes
            CE_strikes: [], PE_strikes: []      // arrays of strike values that contributed
        });

        const buckets = {
            ATM: makeBucket(),
            ITM: makeBucket(),
            OTM: makeBucket(),
            TOTAL: makeBucket()
        };

        for (const srow of strikeAgg) {
            const st = Number(srow.strike);
            if (!Number.isFinite(st)) continue;

            const ceOI = Number(srow.CE_OI || 0);
            const peOI = Number(srow.PE_OI || 0);
            const ceVol = Number(srow.CE_vol || 0);
            const peVol = Number(srow.PE_vol || 0);

            // read change fields (may be undefined on older data; default to 0)
            const ceOICh = Number(srow.CE_OI_change ?? srow.CE_OI_chng ?? 0);
            const peOICh = Number(srow.PE_OI_change ?? srow.PE_OI_chng ?? 0);

            // always to TOTAL
            buckets.TOTAL.CE_OI += ceOI;
            buckets.TOTAL.PE_OI += peOI;
            buckets.TOTAL.CE_vol += ceVol;
            buckets.TOTAL.PE_vol += peVol;
            buckets.TOTAL.CE_OI_change += ceOICh;   // NEW
            buckets.TOTAL.PE_OI_change += peOICh;   // NEW
            if (ceOI > 0) buckets.TOTAL.CE_strikes.push(st);
            if (peOI > 0) buckets.TOTAL.PE_strikes.push(st);

            if (st === atm) {
            buckets.ATM.CE_OI += ceOI;
            buckets.ATM.PE_OI += peOI;
            buckets.ATM.CE_vol += ceVol;
            buckets.ATM.PE_vol += peVol;
            buckets.ATM.CE_OI_change += ceOICh;   // NEW
            buckets.ATM.PE_OI_change += peOICh;   // NEW
            if (ceOI > 0) buckets.ATM.CE_strikes.push(st);
            if (peOI > 0) buckets.ATM.PE_strikes.push(st);
            } else if (st < atm) {
            // lower strikes: CE ITM, PE OTM
            buckets.ITM.CE_OI += ceOI;
            buckets.ITM.CE_vol += ceVol;
            buckets.ITM.CE_OI_change += ceOICh;   // NEW
            if (ceOI > 0) buckets.ITM.CE_strikes.push(st);

            buckets.OTM.PE_OI += peOI;
            buckets.OTM.PE_vol += peVol;
            buckets.OTM.PE_OI_change += peOICh;   // NEW
            if (peOI > 0) buckets.OTM.PE_strikes.push(st);
            } else { // st > atm
            // higher strikes: PE ITM, CE OTM
            buckets.ITM.PE_OI += peOI;
            buckets.ITM.PE_vol += peVol;
            buckets.ITM.PE_OI_change += peOICh;   // NEW
            if (peOI > 0) buckets.ITM.PE_strikes.push(st);

            buckets.OTM.CE_OI += ceOI;
            buckets.OTM.CE_vol += ceVol;
            buckets.OTM.CE_OI_change += ceOICh;   // NEW
            if (ceOI > 0) buckets.OTM.CE_strikes.push(st);
            }
        }

        const finalize = (obj) => {
            const ce = obj.CE_OI || 0;
            const pe = obj.PE_OI || 0;
            const ceVol = obj.CE_vol || 0;
            const peVol = obj.PE_vol || 0;

            const ceOICh = obj.CE_OI_change || 0; // NEW
            const peOICh = obj.PE_OI_change || 0; // NEW

            const ceRange = (obj.CE_strikes && obj.CE_strikes.length)
            ? `${Math.min(...obj.CE_strikes)} — ${Math.max(...obj.CE_strikes)}`
            : "—";
            const peRange = (obj.PE_strikes && obj.PE_strikes.length)
            ? `${Math.min(...obj.PE_strikes)} — ${Math.max(...obj.PE_strikes)}`
            : "—";

            return {
            CE_OI: ce,
            PE_OI: pe,
            CE_vol: ceVol,
            PE_vol: peVol,
            CE_OI_change: ceOICh,    // NEW: expose to UI
            PE_OI_change: peOICh,    // NEW: expose to UI
            CE_range: ceRange,
            PE_range: peRange,
            PCR: ce ? (pe / ce) : (pe ? Infinity : null)
            };
        };

        const ATM = finalize(buckets.ATM);
        const ITM = finalize(buckets.ITM);
        const OTM = finalize(buckets.OTM);
        const TOTAL = finalize(buckets.TOTAL);

        // Max pain selection (prefer windowStats if available)
        let maxPain = null;
        if (windowStats && windowStats.max_pain && windowStats.max_pain.max_pain_strike) {
            maxPain = windowStats.max_pain.max_pain_strike;
        } else if (windowStats && windowStats.max_pain && windowStats.max_pain.pain_map) {
            const pm = windowStats.max_pain.pain_map;
            let minVal = Number.POSITIVE_INFINITY, minStrike = null;
            for (const k of Object.keys(pm)) {
            const v = Number(pm[k]);
            if (Number.isFinite(v) && v < minVal) { minVal = v; minStrike = Number(k); }
            }
            maxPain = minStrike;
        } else {
            // fallback: pick strike with max total OI
            let best = null, bestVal = -1;
            for (const r of strikeAgg) {
            const total = (Number(r.CE_OI || 0) + Number(r.PE_OI || 0));
            if (total > bestVal) { bestVal = total; best = r.strike; }
            }
            maxPain = best;
        }

        return { ATM, ITM, OTM, TOTAL, maxPain };
    }, [strikeAgg, atmStrike, windowStats]);

    // Helper to convert camelCase keys (e.g., "previousClose") to Title Case ("Previous Close")
    const formatKey = (key) => {
        // 1. Insert space before all capital letters
        // 2. Trim whitespace
        // 3. Convert first letter to uppercase
        return key
        .replace(/([A-Z])/g, ' $1')
        .trim()
        .split(' ')
        .map(word => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ');
    };



  // ---- render ----
  return (
    <div style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
        {/* Pivot Table card */}
        <div style={{
            flex: "1 1 360px",
            border: "1px solid #eee",
            borderRadius: 8,
            padding: 12,
            background: "#fff"
        }}>
            <div className="bg-white p-4 rounded-xl shadow-lg w-full max-w-sm border border-gray-300">
                <h3 style={{ marginTop: 0 }} className="text-xl font-bold mb-3 pb-2 text-gray-700">Support - Resistance Table</h3>
                {pivotData ? (
                    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
                        <thead>
                        <tr>
                            <th style={{ textAlign: "left", padding: 6 }}>Zone</th>
                            <th style={{ textAlign: "left", padding: 6 }}>Index</th>
                            <th style={{ textAlign: "left", padding: 6 }}>Pivot Gap (Index − CP)</th>
                            <th style={{ textAlign: "left", padding: 6 }}>Pivot Difference (Last - Index)</th>
                        </tr>
                        </thead>
                        <tbody>
                            {/*{["S3","S2","S1","CP","R1","R2","R3"].map((z) => {*/}
                            {["R3","R2","R1","CP","S1","S2","S3"].map((z) => {
                                const level = pivotData[z === "CP" ? "P" : z];
                                const gap = pivotData?.gap?.[z];
                                const pd = pivotData?.pivotDiff?.[z];

                                // highlight CP row
                                const rowStyle = z === "CP"
                                ? { background: "#fff7ed", fontWeight: 600 } // light orange, bold
                                : {};

                                return (
                                    <tr key={z} style={rowStyle}>
                                        <td style={{ padding: 8, fontWeight: 600 }}>{z}</td>
                                        <td style={{ padding: 8 }}>{ level == null ? "—" : fmtFixed(level, 2) }</td>
                                        {/*<td style={{ padding: 8 }}>{ gap == null ? "—" : fmtNum(gap, 2) }</td>
                                        <td style={{ padding: 8 }}>{ pd == null ? "—" : fmtNum(pd, 2) }</td>*/}
                                        <td style={{ padding: 8 }}>{ gap == null ? "—" : gap.toFixed(2) }</td>
                                        <td style={{ padding: 8 }}>{ pd == null ? "—" : pd.toFixed(2) }</td>
                                    </tr>
                                );
                            })}

                            <tr>
                                <td style={{ padding: 8 }}>Momentum:</td>
                                <td style={{ padding: 8 }}>{pivotData?.momentum.toFixed(2) ?? "—"}</td>
                                <td style={{ padding: 8 }}></td>
                                <td style={{ padding: 8 }}></td>
                            </tr>
                        </tbody>
                    </table>
                ) : (
                    <div style={{ color: "#666" }}>Index OHLC required for pivot calculation</div>
                )}
            </div>
        </div>
        
        {/* <div><pre>{ JSON.stringify(prevIndexOhlc, null, 2) }</pre></div> */}
        
        <div style={{
            flex: "1 1 360px",
            border: "1px solid #eee",
            borderRadius: 8,
            padding: 12,
            background: "#fff"
        }}>
            <div className="bg-white p-6 rounded-xl shadow-lg w-full max-w-sm border border-gray-300">
                <h3 style={{ marginTop: 0 }} className="text-xl font-bold mb-3 border-b pb-2 text-gray-700">Previous Day Index Metrics</h3>
                <div className="space-y-2">
                    {Object.entries(prevIndexOhlc).map(([key, value]) => (
                        <div key={key} 
                            style={{ 
                                display: 'grid',
                                gridTemplateColumns: '1fr 1fr'
                            }} 
                            className="items-center text-sm font-medium border-b border-gray-50/50 pb-1 last:border-b-0 last:last:pb-0"
                        >
                            {/* Column 1: Key (Label) - Left Aligned */}
                            <span 
                                className="pr-2"
                                // FIX: Forcing text color inline to override external CSS rules.
                                style={{ color: '#6b7280' }} // Tailwind's gray-500 hex value
                            >
                                {formatKey(key)}:
                            </span>

                            {/* Column 2: Value (Data) - Right Aligned */}
                            <span 
                                className="text-gray-800 text-right"
                                // FIX: Forcing font-weight inline to override external CSS rules.
                                style={{ fontWeight: '600' }} 
                            >
                                {/*{key === 'close' && (
                                    <span style={{ color: 'green', marginRight: '4px' }}>&#x2713;</span>
                                )}*/}
                                {key === 'close' && (
                                    <span 
                                    style={{ 
                                        // Conditional color: red if close < previousClose, otherwise green
                                        color: prevIndexOhlc.close < prevIndexOhlc.previousClose ? 'red' : 'green', 
                                        marginLeft: '4px' 
                                    }}
                                    >
                                        &#x2713;
                                    </span>
                                )}
                                {
                                    // Format numbers to 2 decimal places, otherwise display as is
                                    typeof value === 'number' 
                                    ? value.toFixed(2) 
                                    : value
                                }
                                {/*
                                {key === 'close' && (
                                    <span style={{ color: 'green', marginLeft: '4px' }}>&#x2713;</span>
                                )}
                                */}
                            </span>
                        </div>
                    ))}
                </div>
            </div>
        </div>

        {/* PCR Table card */}
        <div style={{
            flex: "1 1 420px",
            border: "1px solid #eee",
            borderRadius: 8,
            padding: 12,
            background: "#fff"
            }}>
            <h3 style={{ marginTop: 0 }} className="text-xl font-bold mb-3 pb-2 text-gray-700">PCR Table</h3>

            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
                <thead>
                <tr>
                    <th style={{ textAlign: "left", padding: 6 }} className="px-2 py-2 text-s font-medium text-cyan-700 dark:text-cyan-300 uppercase tracking-wider font-extrabold bg-cyan-300 dark:bg-cyan-700">RANGE</th>
                    <th style={{ textAlign: "left", padding: 6 }} className="px-2 py-2 text-s font-medium text-green-700 dark:text-green-300 uppercase tracking-wider font-extrabold bg-green-300 dark:bg-green-700">CE Range</th>   {/* new */}
                    <th style={{ textAlign: "left", padding: 6 }} className="px-2 py-2 text-s font-medium text-red-700 dark:text-red-300 uppercase tracking-wider font-extrabold bg-red-300 dark:bg-red700">PE Range</th>   {/* new */}
                    <th style={{ textAlign: "right", padding: 6 }} className="px-2 py-2 text-s font-medium text-green-700 dark:text-green-300 uppercase tracking-wider font-extrabold bg-green-300 dark:bg-green-700">CE OI</th>
                    <th style={{ textAlign: "right", padding: 6 }} className="px-2 py-2 text-s font-medium text-red-700 dark:text-red-300 uppercase tracking-wider font-extrabold bg-red-300 dark:bg-red700">PE OI</th>
                    <th style={{ textAlign: "left", padding: 6 }} className="px-2 py-2 text-s font-medium text-green-700 dark:text-green-300 uppercase tracking-wider font-extrabold bg-green-300 dark:bg-green-700">CE OI Chng</th>
                    <th style={{ textAlign: "left", padding: 6 }} className="px-2 py-2 text-s font-medium text-red-700 dark:text-red-300 uppercase tracking-wider font-extrabold bg-red-300 dark:bg-red700">PE OI Chng</th>
                    <th style={{ textAlign: "right", padding: 6 }} className="px-2 py-2 text-s font-medium text-green-700 dark:text-green-300 uppercase tracking-wider font-extrabold bg-green-300 dark:bg-green-700">CE Vol</th>   {/* new */}
                    <th style={{ textAlign: "right", padding: 6 }} className="px-2 py-2 text-s font-medium text-red-700 dark:text-red-300 uppercase tracking-wider font-extrabold bg-red-300 dark:bg-red700">PE Vol</th>   {/* new */}
                    <th style={{ textAlign: "right", padding: 6 }} className="px-2 py-2 text-s font-medium text-yellow-700 dark:text-yellow-300 uppercase tracking-wider font-extrabold bg-yellow-300 dark:bg-yellow-700">PCR</th>
                </tr>
                </thead>
                <tbody>
                {pcrData ? (
                    <>
                    <tr>
                        <td style={{ padding: 8 }}>OTM</td>
                        <td style={{ padding: 8 }}>{pcrData.OTM.CE_range}</td>
                        <td style={{ padding: 8 }}>{pcrData.OTM.PE_range}</td>
                        <td style={{ padding: 8, textAlign: "right" }}>{pcrData.OTM.CE_OI}</td>
                        <td style={{ padding: 8, textAlign: "right" }}>{pcrData.OTM.PE_OI}</td>
                        <td style={{ textAlign: "right", color: pcrData.OTM.CE_OI_change > 0 ? "green" : pcrData.OTM.CE_OI_change < 0 ? "red" : "inherit" }}>
                            {pcrData.OTM.CE_OI_change == null ? "—" : pcrData.OTM.CE_OI_change}
                        </td>
                        <td style={{ textAlign: "right", color: pcrData.OTM.PE_OI_change > 0 ? "green" : pcrData.OTM.PE_OI_change < 0 ? "red" : "inherit" }}>
                            {pcrData.OTM.PE_OI_change == null ? "—" : pcrData.OTM.PE_OI_change}
                        </td>
                        <td style={{ padding: 8, textAlign: "right" }}>{pcrData.OTM.CE_vol}</td>
                        <td style={{ padding: 8, textAlign: "right" }}>{pcrData.OTM.PE_vol}</td>
                        <td style={{ padding: 8, textAlign: "right" }}>{pcrData.OTM.PCR == null ? "—" : Number(pcrData.OTM.PCR).toFixed(3)}</td>
                        { /* ensure numeric CE/PE OI used for PCR so UI always matches */ }
                        {/*{ (() => {
                            const ce = Number(pcrData.OTM.CE_OI || 0);
                            const pe = Number(pcrData.OTM.PE_OI || 0);
                            const pcr = ce === 0 ? (pe ? Infinity : null) : (pe / ce);
                            return (
                                <td style={{ padding: 8, textAlign: "right" }}>
                                    {pcr == null ? "—" : Number(pcr).toFixed(3)}
                                </td>
                            );
                        })() }*/}
                    </tr>

                    <tr>
                        <td style={{ padding: 8 }}>ATM</td>
                        <td style={{ padding: 8 }}>{pcrData.ATM.CE_range}</td>
                        <td style={{ padding: 8 }}>{pcrData.ATM.PE_range}</td>
                        <td style={{ padding: 8, textAlign: "right" }}>{pcrData.ATM.CE_OI}</td>
                        <td style={{ padding: 8, textAlign: "right" }}>{pcrData.ATM.PE_OI}</td>
                        <td style={{ textAlign: "right", color: pcrData.ATM.CE_OI_change > 0 ? "green" : pcrData.ATM.CE_OI_change < 0 ? "red" : "inherit" }}>
                            {pcrData.ATM.CE_OI_change == null ? "—" : pcrData.ATM.CE_OI_change}
                        </td>
                        <td style={{ textAlign: "right", color: pcrData.ATM.PE_OI_change > 0 ? "green" : pcrData.ATM.PE_OI_change < 0 ? "red" : "inherit" }}>
                            {pcrData.ATM.PE_OI_change == null ? "—" : pcrData.ATM.PE_OI_change}
                        </td>
                        <td style={{ padding: 8, textAlign: "right" }}>{pcrData.ATM.CE_vol}</td>
                        <td style={{ padding: 8, textAlign: "right" }}>{pcrData.ATM.PE_vol}</td>
                        <td style={{ padding: 8, textAlign: "right" }}>{pcrData.ATM.PCR == null ? "—" : Number(pcrData.ATM.PCR).toFixed(3)}</td>
                        { /* ensure numeric CE/PE OI used for PCR so UI always matches */ }
                        {/*{ (() => {
                            const ce = Number(pcrData.ATM.CE_OI || 0);
                            const pe = Number(pcrData.ATM.PE_OI || 0);
                            const pcr = ce === 0 ? (pe ? Infinity : null) : (pe / ce);
                            return (
                                <td style={{ padding: 8, textAlign: "right" }}>
                                    {pcr == null ? "—" : Number(pcr).toFixed(3)}
                                </td>
                            );
                        })() }*/}
                    </tr>

                    <tr>
                        <td style={{ padding: 8 }}>ITM</td>
                        <td style={{ padding: 8 }}>{pcrData.ITM.CE_range}</td>
                        <td style={{ padding: 8 }}>{pcrData.ITM.PE_range}</td>
                        <td style={{ padding: 8, textAlign: "right" }}>{pcrData.ITM.CE_OI}</td>
                        <td style={{ padding: 8, textAlign: "right" }}>{pcrData.ITM.PE_OI}</td>
                        <td style={{ textAlign: "right", color: pcrData.ITM.CE_OI_change > 0 ? "green" : pcrData.ITM.CE_OI_change < 0 ? "red" : "inherit" }}>
                            {pcrData.ITM.CE_OI_change == null ? "—" : pcrData.ITM.CE_OI_change}
                        </td>
                        <td style={{ textAlign: "right", color: pcrData.ITM.PE_OI_change > 0 ? "green" : pcrData.ITM.PE_OI_change < 0 ? "red" : "inherit" }}>
                            {pcrData.ITM.PE_OI_change == null ? "—" : pcrData.ITM.PE_OI_change}
                        </td>
                        <td style={{ padding: 8, textAlign: "right" }}>{pcrData.ITM.CE_vol}</td>
                        <td style={{ padding: 8, textAlign: "right" }}>{pcrData.ITM.PE_vol}</td>
                        <td style={{ padding: 8, textAlign: "right" }}>{pcrData.ITM.PCR == null ? "—" : Number(pcrData.ITM.PCR).toFixed(3)}</td>
                        { /* ensure numeric CE/PE OI used for PCR so UI always matches */ }
                        {/*{ (() => {
                            const ce = Number(pcrData.ITM.CE_OI || 0);
                            const pe = Number(pcrData.ITM.PE_OI || 0);
                            const pcr = ce === 0 ? (pe ? Infinity : null) : (pe / ce);
                            return (
                                <td style={{ padding: 8, textAlign: "right" }}>
                                    {pcr == null ? "—" : Number(pcr).toFixed(3)}
                                </td>
                            );
                        })() }*/}

                    </tr>

                    <tr style={{ borderTop: "1px dashed #ddd" }}>
                        <td style={{ padding: 8, fontWeight: 700 }}>TOTAL</td>
                        <td style={{ padding: 8 }}></td>
                        <td style={{ padding: 8 }}></td>
                        <td style={{ padding: 8, textAlign: "right", fontWeight: 700 }}>{pcrData.TOTAL.CE_OI}</td>
                        <td style={{ padding: 8, textAlign: "right", fontWeight: 700 }}>{pcrData.TOTAL.PE_OI}</td>
                        <td style={{ padding: 8, textAlign: "right", fontWeight: 700 }}>{pcrData.TOTAL.CE_OI_change}</td>
                        <td style={{ padding: 8, textAlign: "right", fontWeight: 700 }}>{pcrData.TOTAL.PE_OI_change}</td>
                        <td style={{ padding: 8, textAlign: "right", fontWeight: 700 }}>{pcrData.TOTAL.CE_vol}</td>
                        <td style={{ padding: 8, textAlign: "right", fontWeight: 700 }}>{pcrData.TOTAL.PE_vol}</td>
                        {/*<td style={{ padding: 8, textAlign: "right", fontWeight: 700 }}>
                        { (windowStats?.pcr_window ?? pcrData.TOTAL.PCR) == null
                            ? "—"
                            : Number(windowStats?.pcr_window ?? pcrData.TOTAL.PCR).toFixed(3)
                        }
                        </td>*/}
                        <td style={{ padding: 8, textAlign: "right", fontWeight: 700 }}>{pcrData.TOTAL.PCR == null ? "—" : Number(pcrData.TOTAL.PCR).toFixed(3)}</td>
                    </tr>

                    <tr>
                        <td style={{ padding: 8 }}>Max Pain</td>
                        <td style={{ padding: 8 }}>{pcrData.maxPain ?? "—"}</td>
                        <td style={{ padding: 8 }}></td>
                        <td style={{ padding: 8 }}></td>
                        <td style={{ padding: 8 }}></td>
                        <td style={{ padding: 8 }}></td>
                        <td style={{ padding: 8 }}></td>
                        <td style={{ padding: 8 }}></td>
                        <td style={{ padding: 8 }}></td>
                        <td style={{ padding: 8 }}></td>
                    </tr>
                    </>
                ) : (
                    <tr><td colSpan={8} style={{ padding: 8 }}>Strike data required</td></tr>
                )}
                </tbody>
            </table>
        </div>
    </div>
  );
}
