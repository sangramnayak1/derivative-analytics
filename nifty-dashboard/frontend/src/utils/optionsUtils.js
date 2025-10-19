/**
 * Generates the required list of strike prices centered around the ATM strike.
 */
export const generateStrikeList = (atm, downSteps, upSteps, stepSize) => {
  const strikes = new Set();
  
  for (let i = 0; i <= downSteps; i++) {
    strikes.add(atm - (i * stepSize));
  }
  
  for (let i = 1; i <= upSteps; i++) { 
    strikes.add(atm + (i * stepSize));
  }
  
  return Array.from(strikes).sort((a, b) => a - b);
};

/**
 * Helper function to extract and format relevant data fields from the raw API response.
 * Currently extracts Delta, Theta, and LTP.
 */
export const mapOptionData = (option, move) => {
  const md = option?.market_data ?? {};
  const og = option?.option_greeks ?? {};

  const toNum = (v) => {
    if (v === null || v === undefined) return null;
    const n = Number(v);
    return Number.isNaN(n) ? null : n;
  };
  const fmt2 = (v) => {
    const n = toNum(v);
    return n === null ? 'N/A' : n.toFixed(2);
  };

  const ltpCh = og.delta * move;
  const maxLtp = md.ltp + ltpCh;

  return {
    oi: toNum(md.oi) !== null ? toNum(md.oi).toLocaleString() : 'N/A',
    iv: toNum(og.iv) !== null ? `${toNum(og.iv).toFixed(2)}%` : 'N/A',
    ltp: fmt2(md.ltp),
    ltpCh: fmt2(ltpCh),     // ← handles number or "123.45"
    maxLtp: fmt2(maxLtp),   // ← handles number or "123.45"
    theta: fmt2(og.theta),
    delta: toNum(og.delta) !== null ? toNum(og.delta).toFixed(4) : 'N/A',
  };
};


// --- MOCK/FALLBACK DATA GENERATION ---
// These are used if the live API call fails.
// Expected index move
const DEFAULT_MOVE = 40;
export const STEP_SIZE = 50;
export const DOWN_STEPS = 10;
export const UP_STEPS = 11;
export const INITIAL_ATM_STRIKE = 25600; 

export const MOCK_STRIKE_LIST = generateStrikeList(INITIAL_ATM_STRIKE, DOWN_STEPS, UP_STEPS, STEP_SIZE);
// Target move is +100

export const generateMockRow = (strike, ATM_STRIKE_MOCK, requiredStrikes, DEFAULT_MOVE) => {
    const MIN_STRIKE = requiredStrikes[0];
    const MAX_STRIKE = requiredStrikes[requiredStrikes.length - 1];
    
    // Simple linear interpolation for mock greeks/prices
    let ceDelta = 1 - ((strike - MIN_STRIKE) / (MAX_STRIKE - MIN_STRIKE));
    let peDelta = -1 + ((strike - MIN_STRIKE) / (MAX_STRIKE - MIN_STRIKE));
    let ceLTP = strike < ATM_STRIKE_MOCK ? 100 + (ATM_STRIKE_MOCK - strike) / 5 : Math.max(5, 50 - (strike - ATM_STRIKE_MOCK) / 10);
    let peLTP = strike > ATM_STRIKE_MOCK ? 100 + (strike - ATM_STRIKE_MOCK) / 5 : Math.max(5, 50 - (ATM_STRIKE_MOCK - strike) / 10);
    let thetaMagnitude = 12 * Math.exp(-0.0001 * Math.pow(strike - ATM_STRIKE_MOCK, 2));
    let mockIV = 25 + 10 * Math.sin(strike / 1000); // Simple mock IV curve
    let mockOI = Math.floor(Math.random() * 500000 + 100000); // Mock OI

    // START CUSTOM OPTIONS LOGIC CALCULATION (LTP, LTP_CH, MAX_LTP)
    const finalCEDelta = Math.max(0.001, ceDelta);
    const finalPEDelta = Math.min(-0.001, peDelta);

    // 1. Calculate LTP_CH (Expected Premium Change) = move * delta
    const ltpChCe = DEFAULT_MOVE * finalCEDelta;
    const ltpChPe = DEFAULT_MOVE * finalPEDelta;

    // 2. Calculate MAX_LTP (Target Premium) = LTP_CH + LTP
    const maxLtpCe = ltpChCe + ceLTP;
    const maxLtpPe = ltpChPe + peLTP;
    // END CUSTOM OPTIONS LOGIC CALCULATION (LTP, LTP_CH, MAX_LTP)


    return {
        // START
        "expiry": '2025-10-14 (Mock)',
        "strike_price": strike,
        "call_options": {
            "option_greeks": { "delta": finalCEDelta, "theta": -thetaMagnitude - Math.random(), "iv": mockIV + Math.random() * 5 },
            "market_data": { "ltp": ceLTP, "oi": mockOI, "ltpCh": ltpChCe, "maxLtp": maxLtpCe } // Updated fields
        },
        "put_options": {
            "option_greeks": { "delta": finalPEDelta, "theta": -thetaMagnitude - Math.random(), "iv": mockIV + Math.random() * 5 },
            "market_data": { "ltp": peLTP, "oi": mockOI, "ltpCh": ltpChPe, "maxLtp": maxLtpPe } // Updated fields
        }
        // END
    };
};

export const RAW_GREEKS_DATA = MOCK_STRIKE_LIST.map(strike => generateMockRow(strike, INITIAL_ATM_STRIKE, MOCK_STRIKE_LIST, DEFAULT_MOVE));
