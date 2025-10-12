import React from 'react';

/**
 * Renders a single row in the options chain table. 
 * This component handles the coloring (ITM/OTM/ATM) and data display for one strike price.
 */
const OptionGreeksRow = React.memo(({ row, getStrikeClass }) => {
    // getStrikeClass is passed down from the parent to determine the ATM/ITM/OTM colors
    const classes = getStrikeClass(row.strike_price);
    const cellClass = "px-2 py-3 whitespace-nowrap text-sm text-center";
    const boundaryClass = "border-l border-r border-indigo-100";

    // START CUSTOM OPTIONS LOGIC RENDERING (LTP, LTP_CH, MAX_LTP)
    // Helper to determine text color for Greeks/RsCH
    const getGreekColor = (valueStr) => {
        const value = parseFloat(valueStr.replace('%', ''));
        if (isNaN(value) || value === 0) return 'text-gray-700 dark:text-gray-300';
        return value >= 0 ? 'text-green-700 dark:text-green-300' : 'text-red-700 dark:text-red-300';
    };

    // Background colors for the key columns
    const ltpBgClass = "bg-gray-100 dark:bg-gray-800";
    const ltpChBgClass = "bg-cyan-100 dark:bg-cyan-900";
    const maxLtpBgClass = "bg-yellow-100 dark:bg-yellow-800";
    // END CUSTOM OPTIONS LOGIC RENDERING (LTP, LTP_CH, MAX_LTP)

    return (
        <tr key={row.strike_price} className={classes.row}>
            {/* CE DATA (5 columns: OI, IV, LTP, Theta, Delta) */}
            <td className={`${cellClass} text-indigo-700 font-semibold ${classes.ceData}`}>{row.ce.oi}</td>
            <td className={`${cellClass} text-orange-600 ${classes.ceData}`}>{row.ce.iv}</td>
            {/*<td className={`${cellClass} text-gray-700 ${classes.ceData}`}>{row.ce.ltp}</td>*/}
            {/* // START CUSTOM OPTIONS LOGIC RENDERING (LTP, LTP_CH, MAX_LTP) */}
            {/* 1. LTP COLUMN - Gray Background */}
            <td className={`${cellClass} ${getGreekColor(row.ce.ltp)} ${ltpBgClass}`}>{row.ce.ltp}</td>
            {/* 2. LTP_CH COLUMN - Cyan Background */}
            <td className={`${cellClass} ${getGreekColor(row.ce.ltpCh)} font-bold ${ltpChBgClass}`}>{row.ce.ltpCh}</td>
            {/* 3. MAX_LTP COLUMN - Yellow Background */}
            <td className={`${cellClass} ${getGreekColor(row.ce.maxLtp)} font-extrabold ${maxLtpBgClass}`}>{row.ce.maxLtp}</td>
            {/* // END CUSTOM OPTIONS LOGIC RENDERING (LTP, LTP_CH, MAX_LTP) */}

            <td className={`${cellClass} text-gray-800 ${classes.ceData}`}>{row.ce.theta}</td>
            <td className={`${cellClass} text-gray-800 ${boundaryClass} ${classes.ceData}`}>{row.ce.delta}</td>

            {/* STRIKE PRICE */}
            <td className={`px-4 py-3 whitespace-nowrap text-base font-extrabold text-center ${classes.strikeCell}`}>
                {row.strike_price.toLocaleString()}
            </td>

            {/* PE DATA (5 columns: Delta, Theta, LTP, IV, OI) */}
            <td className={`${cellClass} text-gray-800 ${boundaryClass} ${classes.peData}`}>{row.pe.delta}</td>
            <td className={`${cellClass} text-gray-800 ${classes.peData}`}>{row.pe.theta}</td> 
            {/*<td className={`${cellClass} text-gray-700 ${classes.peData}`}>{row.pe.ltp}</td> */}
            {/* START CUSTOM OPTIONS LOGIC RENDERING (LTP, LTP_CH, MAX_LTP) */}
            {/* 3. MAX_LTP COLUMN - Yellow Background */}
            <td className={`${cellClass} ${getGreekColor(row.pe.maxLtp)} font-extrabold ${maxLtpBgClass}`}>{row.pe.maxLtp}</td>
            {/* 2. LTP_CH COLUMN - Cyan Background */}
            <td className={`${cellClass} ${getGreekColor(row.pe.ltpCh)} font-bold ${ltpChBgClass}`}>{row.pe.ltpCh}</td>
            {/* 1. LTP COLUMN - Gray Background */}
            <td className={`${cellClass} ${getGreekColor(row.pe.ltp)} ${ltpBgClass}`}>{row.pe.ltp}</td>
            {/* END CUSTOM OPTIONS LOGIC RENDERING (LTP, LTP_CH, MAX_LTP) */}

            <td className={`${cellClass} text-orange-600 ${classes.peData}`}>{row.pe.iv}</td>
            <td className={`${cellClass} text-indigo-700 font-semibold ${classes.peData}`}>{row.pe.oi}</td>
        </tr>
    );
});

export default OptionGreeksRow;
