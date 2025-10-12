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
export const mapOptionData = (option) => ({
  delta: option?.option_greeks?.delta?.toFixed(4) || 'N/A', 
  theta: option?.option_greeks?.theta?.toFixed(2) || 'N/A',
  ltp: option?.market_data?.ltp?.toFixed(2) || 'N/A',
});


// --- MOCK/FALLBACK DATA GENERATION ---
// These are used if the live API call fails.
export const STEP_SIZE = 50;
export const DOWN_STEPS = 10;
export const UP_STEPS = 11;
export const INITIAL_ATM_STRIKE = 25250; 

export const MOCK_STRIKE_LIST = generateStrikeList(INITIAL_ATM_STRIKE, DOWN_STEPS, UP_STEPS, STEP_SIZE);

export const generateMockRow = (strike, ATM_STRIKE_MOCK, requiredStrikes) => {
    const MIN_STRIKE = requiredStrikes[0];
    const MAX_STRIKE = requiredStrikes[requiredStrikes.length - 1];
    
    // Simple linear interpolation for mock greeks/prices
    let ceDelta = 1 - ((strike - MIN_STRIKE) / (MAX_STRIKE - MIN_STRIKE));
    let peDelta = -1 + ((strike - MIN_STRIKE) / (MAX_STRIKE - MIN_STRIKE));
    let ceLTP = strike < ATM_STRIKE_MOCK ? 100 + (ATM_STRIKE_MOCK - strike) / 5 : Math.max(5, 50 - (strike - ATM_STRIKE_MOCK) / 10);
    let peLTP = strike > ATM_STRIKE_MOCK ? 100 + (strike - ATM_STRIKE_MOCK) / 5 : Math.max(5, 50 - (ATM_STRIKE_MOCK - strike) / 10);
    let thetaMagnitude = 12 * Math.exp(-0.0001 * Math.pow(strike - ATM_STRIKE_MOCK, 2));

    return {
        "expiry": '2025-10-14 (Mock)', 
        "strike_price": strike,
        "call_options": { 
            "option_greeks": { "delta": Math.max(0.001, ceDelta), "theta": -thetaMagnitude, "iv": 30 + Math.random() * 10 }, 
            "market_data": { "ltp": ceLTP + Math.random() * 5 } 
        },
        "put_options": { 
            "option_greeks": { "delta": Math.min(-0.001, peDelta), "theta": -thetaMagnitude, "iv": 30 + Math.random() * 10 }, 
            "market_data": { "ltp": peLTP + Math.random() * 5 } 
        }
    };
};
export const RAW_GREEKS_DATA = MOCK_STRIKE_LIST.map(strike => generateMockRow(strike, INITIAL_ATM_STRIKE, MOCK_STRIKE_LIST));
