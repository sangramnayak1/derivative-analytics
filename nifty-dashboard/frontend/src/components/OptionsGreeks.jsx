import React, { useState, useMemo, useEffect } from 'react';
import { 
  generateStrikeList,
  mapOptionData,
  INITIAL_ATM_STRIKE,
  DOWN_STEPS,
  UP_STEPS,
  STEP_SIZE,
  RAW_GREEKS_DATA
} from '../utils/optionsUtils.js'; 
import OptionGreeksRow from './OptionGreeksRow.jsx';
import { RefreshCw, Zap, ArrowDown, ArrowUp, Loader2 } from 'lucide-react';

// --- Configuration Parameters ---
// This is the endpoint for your Python Flask server, now running on port 8000
const LOCAL_API_URL = 'http://localhost:8000/api/option-chain';

// --- Main OptionGreeks Component ---
// Accepts initialAtmStrike from a parent component (App.jsx)
const OptionGreeks = ({ initialAtmStrike, expMove }) => {
  console.log("initialAtmStrike = " + initialAtmStrike);

  const [optionsData, setOptionsData] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  //const [atmStrike, setAtmStrike] = useState(initialAtmStrike ? Number(initialAtmStrike) : INITIAL_ATM_STRIKE);
  const initialValue = initialAtmStrike ? Number(initialAtmStrike) : INITIAL_ATM_STRIKE;
  console.log("initialAtmStrike = " + initialValue)
  const safeAtmStrike = isNaN(initialValue) ? INITIAL_ATM_STRIKE : initialValue;
  const [atmStrike, setAtmStrike] = useState(initialAtmStrike ? Number(safeAtmStrike) : INITIAL_ATM_STRIKE);
  console.log("atmStrike = " + atmStrike)

  const { requiredStrikes } = useMemo(() => {
    const rs = generateStrikeList(atmStrike, DOWN_STEPS, UP_STEPS, STEP_SIZE);
    return {
      requiredStrikes: rs,
    };
  }, [atmStrike]);

  // --- Logic: Determine ITM/OTM/ATM classification and assign classes ---
  const getStrikeClass = (strike) => {
    const ITM_COLOR = 'bg-blue-100'; 
    const OTM_COLOR = 'bg-gray-100'; 
    const ATM_COLOR = 'bg-yellow-200';

    if (strike === atmStrike) {
      return {
        row: `${ATM_COLOR} font-bold hover:bg-yellow-300`,
        strikeCell: 'bg-yellow-400 text-yellow-900',
        ceData: ATM_COLOR,
        peData: ATM_COLOR,
      };
    } else if (strike < atmStrike) {
      // CE ITM (Strikes below ATM), PE OTM
      return {
        row: 'hover:bg-gray-200', 
        strikeCell: 'bg-blue-600 text-white font-semibold', 
        ceData: ITM_COLOR, // ITM
        peData: OTM_COLOR, // OTM
      };
    } else { // strike > ATM_STRIKE
      // CE OTM, PE ITM (Strikes above ATM)
      return {
        row: 'hover:bg-gray-200', 
        strikeCell: 'bg-blue-600 text-white font-semibold', 
        ceData: OTM_COLOR, // OTM
        peData: ITM_COLOR, // ITM
      };
    }
  };

  // --- Data Fetching Logic (Calls Python Backend) ---
  useEffect(() => {
    
    const fetchData = async () => {
      let finalData = null;
      let lastError = null;
      const MAX_RETRIES = 3;

      for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
        try {
          const response = await fetch(`${LOCAL_API_URL}?atm_strike=${atmStrike}`, {
            method: 'GET',
            headers: { 'Content-Type': 'application/json' },
          });

          console.log("GET response = " + response)
          if (!response.ok) {
            const errorBody = await response.json().catch(() => ({ message: 'Failed to parse error body.' }));
            throw new Error(`HTTP Error ${response.status}: ${errorBody.message || response.statusText}`);
          }

          const json = await response.json();

          if (json.status === 'success' && json.data) {
            finalData = json.data;
            setAtmStrike(json.atm_strike); 
            break; 
          } else {
            throw new Error(`API returned failure status: ${JSON.stringify(json)}`);
          }

        } catch (err) {
          lastError = err;
          console.error(`Attempt ${attempt + 1} failed:`, err.message);
          if (attempt < MAX_RETRIES - 1) {
            const delay = Math.pow(2, attempt) * 1000;
            await new Promise(resolve => setTimeout(resolve, delay));
          }
        }
      }

      if (finalData) {
        setOptionsData(finalData);
        setError(null);
      } else {
        console.warn("Local API fetch failed after retries. Falling back to local mock data.");
        setOptionsData(RAW_GREEKS_DATA);
        setError(`Failed to fetch data from local Python server (http://localhost:8000) after ${MAX_RETRIES} attempts. Displaying mock data. Last error: ${lastError ? lastError.message : 'Unknown error'}`);
      }
      setIsLoading(false);
    };

    fetchData();
  }, []); 

  // useMemo to handle data filtering and grouping
  const groupedData = useMemo(() => {
    if (!optionsData || optionsData.length === 0) return [];

    const filtered = optionsData.filter(item =>
      requiredStrikes.includes(item.strike_price)
    );

    filtered.sort((a, b) => a.strike_price - b.strike_price);

    return filtered.map(item => {
      const ce = mapOptionData(item.call_options, expMove);
      const pe = mapOptionData(item.put_options, expMove);

      return {
        strike_price: item.strike_price,
        expiry: item.expiry,
        ce: ce,
        pe: pe,
      };
    });
  }, [optionsData, requiredStrikes]);


  // --- Rendering UI States (Loading / Error) ---
  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-50">
        <div className="flex flex-col items-center p-6 bg-white rounded-xl shadow-lg">
          <svg className="animate-spin h-8 w-8 text-indigo-600" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
          </svg>
          <p className="mt-4 text-lg font-medium text-gray-700">Connecting to Python Backend (http://localhost:8000)...</p>
        </div>
      </div>
    );
  }

  const isMockData = optionsData === RAW_GREEKS_DATA;
  const dataSourceStatus = isMockData ? 'Local Mock Data (Python Backend connection failed)' : 'Python Backend (Upstox API)';
  const displayExpiry = groupedData.length > 0 ? groupedData[0].expiry : 'N/A';
  
  if (error) {
    return (
      <div className="p-6 text-center bg-red-100 border-2 border-red-300 text-red-700 rounded-xl shadow-lg max-w-4xl mx-auto mt-10">
        <h3 className="text-xl font-bold mb-2">Data Source Warning: Failed to Connect</h3>
        <p className="text-sm break-words whitespace-pre-wrap">⚠️ {error}</p>
        <p className="text-xs mt-2 text-red-500">The application has loaded the **fallback mock data** to preserve the table structure.</p>
        <p className="text-xs mt-1 text-gray-700">Ensure your Python Flask server is running on port 8000 and has a valid `config.ini`.</p>
      </div>
    );
  }

  // --- Main Table Render ---
  return (
    <div className="p-4 sm:p-6 bg-gray-50 min-h-screen">
      <div className="max-w-4xl mx-auto bg-white p-6 rounded-xl shadow-2xl">
        <h1 className="text-2xl font-extrabold text-indigo-700 mb-2">Nifty 50 Options Chain Greeks</h1>
        <p className="text-sm text-gray-500 mb-4">
          Data Source: 
          <span className={`font-bold ${isMockData ? 'text-red-500' : 'text-green-600'}`}>
            {dataSourceStatus}
          </span>
          (Expiry: {displayExpiry} | Strikes: <span className="font-semibold text-gray-800">{groupedData.length}</span> / {requiredStrikes.length} | ATM: {atmStrike.toLocaleString()} | Initial Prop: {initialAtmStrike ? initialAtmStrike.toLocaleString() : 'null'})
        </p>

        {/* --- SCROLLABLE CONTAINER FOR THE TABLE --- */}
        {/* uncomment below 2 div */}
        <div className="overflow-x-auto rounded-lg border border-gray-200 shadow-sm">
          {/* <div className="max-h-128 overflow-y-scroll"> */}
          <table className="min-w-full divide-y divide-gray-200">
            {/* <thead className="bg-indigo-50 sticky top-0 z-10"> */}
            <thead className="bg-indigo-50">
              <tr>
                {/* CE HEADERS: 7 columns */}
                <th colSpan="7" className="px-2 py-3 text-xs font-bold uppercase tracking-wider text-center text-indigo-800 dark:text-indigo-300 border-r-2 border-indigo-300 dark:border-indigo-700">CALLS (CE) <ArrowUp className="inline w-3 h-3 ml-1" /></th>

                {/* STRIKE HEADER */}
                <th rowSpan={2} className="px-4 py-3 text-sm font-bold uppercase tracking-wider text-center text-gray-900 dark:text-gray-100 bg-indigo-300 dark:bg-indigo-700">STRIKE</th>

                {/* PE HEADERS: 7 columns */}
                <th colSpan="7" className="px-2 py-3 text-xs font-bold uppercase tracking-wider text-center text-indigo-800 dark:text-indigo-300 border-l-2 border-indigo-300 dark:border-indigo-700">PUTS (PE) <ArrowDown className="inline w-3 h-3 ml-1" /></th>
              </tr>
              <tr>
                  {/* CE SUB HEADERS: OI, IV, LTP (Gray), LTP_CH (Cyan), MAX_LTP (Yellow), Theta, Delta */}
                  <th className="px-2 py-2 text-xs font-medium text-gray-600 dark:text-gray-400 uppercase tracking-wider">OI</th>
                  <th className="px-2 py-2 text-xs font-medium text-gray-600 dark:text-gray-400 uppercase tracking-wider">IV</th>
                  <th className="px-2 py-2 text-xs font-medium text-gray-800 dark:text-gray-200 uppercase tracking-wider bg-gray-200 dark:bg-gray-700">LTP</th>
                  <th className="px-2 py-2 text-xs font-medium text-cyan-700 dark:text-cyan-300 uppercase tracking-wider font-semibold bg-cyan-200 dark:bg-cyan-800">LTP_CH</th>
                  <th className="px-2 py-2 text-xs font-medium text-yellow-700 dark:text-yellow-300 uppercase tracking-wider font-extrabold bg-yellow-300 dark:bg-yellow-700">MAX_LTP</th>
                  <th className="px-2 py-2 text-xs font-medium text-gray-600 dark:text-gray-400 uppercase tracking-wider">Theta</th>
                  <th className="px-2 py-2 text-xs font-medium text-gray-600 dark:text-gray-400 uppercase tracking-wider border-r border-indigo-200 dark:border-indigo-700">Delta</th>

                  {/* PE SUB HEADERS: Delta, Theta, MAX_LTP (Yellow), LTP_CH (Cyan), LTP (Gray), IV, OI */}
                  <th className="px-2 py-2 text-xs font-medium text-gray-600 dark:text-gray-400 uppercase tracking-wider border-l border-indigo-200 dark:border-indigo-700">Delta</th>
                  <th className="px-2 py-2 text-xs font-medium text-gray-600 dark:text-gray-400 uppercase tracking-wider">Theta</th>
                  <th className="px-2 py-2 text-xs font-medium text-yellow-700 dark:text-yellow-300 uppercase tracking-wider font-extrabold bg-yellow-300 dark:bg-yellow-700">MAX_LTP</th>
                  <th className="px-2 py-2 text-xs font-medium text-cyan-700 dark:text-cyan-300 uppercase tracking-wider font-semibold bg-cyan-200 dark:bg-cyan-800">LTP_CH</th>
                  <th className="px-2 py-2 text-xs font-medium text-gray-800 dark:text-gray-200 uppercase tracking-wider bg-gray-200 dark:bg-gray-700">LTP</th>
                  <th className="px-2 py-2 text-xs font-medium text-gray-600 dark:text-gray-400 uppercase tracking-wider">IV</th>
                  <th className="px-2 py-2 text-xs font-medium text-gray-600 dark:text-gray-400 uppercase tracking-wider">OI</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-100">
              {groupedData.map((row) => (
                <OptionGreeksRow
                  key={row.strike_price}
                  row={row}
                  getStrikeClass={getStrikeClass}
                />
              ))}
            </tbody>
          </table>
        </div>
        {groupedData.length !== requiredStrikes.length && (
          <p className="mt-4 text-center text-red-600 font-medium">Warning: Displaying {groupedData.length} out of {requiredStrikes.length} expected strikes due to missing data in the result set.</p>
        )}
      </div>
    </div>
  );
};

export default OptionGreeks;
