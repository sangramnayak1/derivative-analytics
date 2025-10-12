import React from 'react';

/**
 * Renders a single row in the options chain table. 
 * This component handles the coloring (ITM/OTM/ATM) and data display for one strike price.
 */
const OptionGreeksRow = ({ row, getStrikeClass }) => {
    // getStrikeClass is passed down from the parent to determine the ATM/ITM/OTM colors
    const classes = getStrikeClass(row.strike_price);

    return (
        <tr key={row.strike_price} className={classes.row}>
            {/* CE DATA */}
            <td className={`px-3 py-3 whitespace-nowrap text-sm text-center text-gray-700 ${classes.ceData}`}>{row.ce.ltp}</td>
            <td className={`px-3 py-3 whitespace-nowrap text-sm text-center text-gray-800 ${classes.ceData}`}>{row.ce.theta}</td>
            <td className={`px-3 py-3 whitespace-nowrap text-sm text-center text-gray-800 border-r border-indigo-100 ${classes.ceData}`}>{row.ce.delta}</td>

            {/* STRIKE PRICE */}
            <td className={`px-6 py-3 whitespace-nowrap text-base font-extrabold text-center ${classes.strikeCell}`}>
                {row.strike_price.toLocaleString()}
            </td>

            {/* PE DATA */}
            <td className={`px-3 py-3 whitespace-nowrap text-sm text-center text-gray-800 border-l border-indigo-100 ${classes.peData}`}>{row.pe.delta}</td>
            <td className={`px-3 py-3 whitespace-nowrap text-sm text-center text-gray-800 ${classes.peData}`}>{row.pe.theta}</td>
            <td className={`px-3 py-3 whitespace-nowrap text-sm text-center text-gray-700 ${classes.peData}`}>{row.pe.ltp}</td>
        </tr>
    );
};

export default OptionGreeksRow;
