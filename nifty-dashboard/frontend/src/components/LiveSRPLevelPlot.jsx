// --- Price Level Plot Component ---
import { 
  ResponsiveContainer, 
  AreaChart, 
  ReferenceLine, 
  XAxis, 
  YAxis, 
  Line 
} from "recharts";

// Helper component to visualize the Spot vs. SRP Levels
export default function LiveSRPLevelPlot ({ spot, r2, r1, s1, s2 }) {
  // We use a dummy data array to force Recharts to render. The Y-values come from ReferenceLines.
  const data = [{ x: 1, value: spot }];
  
  // Calculate the buffer (extra space above max and below min)
  const allValues = [spot, r2, r1, s1, s2].filter(v => v !== null);
  if (allValues.length === 0) return <p className="text-gray-500 text-center">No plot data.</p>;

  const minVal = Math.min(...allValues);
  const maxVal = Math.max(...allValues);
  const range = maxVal - minVal;
  const buffer = range * 0.1; // 10% buffer for padding

  const yDomain = [minVal - buffer, maxVal + buffer];

  // Colors and line properties
  const spotColor = '#3B82F6'; // '#f07e14ff' '#10B981'; // Tailwind green-500
  const resistanceColor = '#EF4444'; // Tailwind red-500
  const supportColor = '#10B981'; // '#12be4bff' '#3B82F6'; // Tailwind blue-500

  // --- Custom Spot Label Component (The new square box) ---
  const CustomSpotLabel = (props) => {
    const { viewBox, value } = props;
    const spotPrice = typeof value === 'number' ? value.toFixed(2) : value;

    // Calculate coordinates to place the box in the center of the chart area.
    const width = 100;
    const height = 24;
    
    // Calculate the horizontal center of the plot area
    // viewBox.x is the left padding (now 10), viewBox.width is the total width.
    // The center is calculated as: (chart_width / 2) - (box_width / 2)
    const xCenter = (viewBox.width / 2) - (width / 2);
    const y = viewBox.y; 

    const bgColor = '#3B82F6'; // Green-500
    const textColor = '#FFFFFF';

    return (
      <g>
        {/* Rectangular box for background */}
        <rect 
          x={xCenter} 
          y={y - height / 2} // Center the rect vertically on the Y axis
          width={width} 
          height={height} 
          rx={5} // Rounded corners
          fill={bgColor} 
          stroke="#171818ff" // Darker green border
          strokeWidth={2}
        />
        {/* Text element to display the price */}
        <text
          x={xCenter + width / 2} // Center text horizontally
          y={y + 5} // Position text vertically
          textAnchor="middle" // Anchor text in the middle
          fill={textColor}
          fontSize={14}
          fontWeight="bold"
        >
          {spotPrice}
        </text>
      </g>
    );
  };

  const labelConfig = (value, label, color) => ({ 
      value: `${label}: ${value}`, 
      position: 'right', 
      fill: color, 
      fontSize: 12, 
      dx: 10,
  });
  
  // --- Unified Custom Label Component (Renders Price and Label conditionally) ---
  const FullLevelLabel = (props) => {
    const { viewBox, value, label, color } = props;
    const price = typeof value === 'number' ? value.toFixed(2) : value;
    
    // Check if the label starts with 'R' (Resistance)
    const isResistance = label.startsWith('R'); 

    const y = viewBox.y - 5; 
    let xPrice;
    let priceAnchor;

    if (isResistance) {
      // For Resistance (R1, R2): Price on the right, grouped with label.
      // **SHIFTED:** Offset changed from -50px to -15px to move price closer to the right line end.
      xPrice = viewBox.x + viewBox.width - 10; 
      priceAnchor = "end"; // Text ends at xPrice
    } else {
      // For Support (S1, S2): Price on the left, near the start of the line.
      xPrice = viewBox.x + 10; 
      priceAnchor = "start"; // Text starts at xPrice
    }
    
    // Position Label: Far Right Aligned (always the same, outside the chart area)
    // This is offset +20px from the chart's right edge (viewBox.x + viewBox.width)
    const xLabel = viewBox.x + viewBox.width + 20; 

    return (
      <g>
        {/* Price Text (Conditional Left/Right Alignment) */}
        <text
          x={xPrice}
          y={y}
          textAnchor={priceAnchor} // Conditional alignment
          fill={color} 
          fontSize={14}
          fontWeight="bold"
          opacity={0.8}
        >
          {price}
        </text>
        
        {/* Label Text (Far Right Aligned, outside the chart area) */}
        <text
          x={xLabel} 
          y={y}
          textAnchor="start" 
          fill={color} 
          fontSize={14}
          fontWeight="bold"
        >
          {label}
        </text>
      </g>
    );
  };

  return (
    <div className="bg-white p-4 rounded-xl shadow-lg w-full max-w-sm border border-gray-300">
      <h3 className="text-xl font-bold mb-3 border-b pb-2 text-gray-700">SRP Level Visualization</h3>
      <div style={{ width: '100%', height: 250 }}>
        <ResponsiveContainer width="100%" height="100%">
          {/* Right margin increased to 80 to make space for both the price and the label text on the right side */}
          <AreaChart data={data} margin={{ top: 10, right: 80, left: 10, bottom: 10 }}> 
            <XAxis dataKey="x" hide />
            <YAxis domain={yDomain} hide />
            
            {/* --- Resistance Lines (Red) --- */}
            <ReferenceLine 
              y={r2} 
              stroke={resistanceColor} 
              strokeDasharray="3 3" 
              strokeWidth={2} 
              label={<FullLevelLabel value={r2} label="R2" color={resistanceColor} />}
            />
            <ReferenceLine 
              y={r1} 
              stroke={resistanceColor} 
              strokeDasharray="3 3" 
              strokeWidth={2} 
              label={<FullLevelLabel value={r1} label="R1" color={resistanceColor} />}
            />

            {/* --- Spot Price Custom Label (Green) --- */}
            <ReferenceLine 
                y={spot} 
                stroke={spotColor}
                strokeDasharray="3 3"
                strokeWidth={2}
                label={<CustomSpotLabel value={spot} />} // Renders the custom box in the center
                content={null} 
            />
            
            {/* --- Support Lines (Blue) --- */}
            <ReferenceLine 
              y={s1} 
              stroke={supportColor} 
              strokeDasharray="3 3" 
              strokeWidth={2} 
              label={<FullLevelLabel value={s1} label="S1" color={supportColor} />}
            />
            <ReferenceLine 
              y={s2} 
              stroke={supportColor} 
              strokeDasharray="3 3" 
              strokeWidth={2} 
              label={<FullLevelLabel value={s2} label="S2" color={supportColor} />}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
      <p className="text-center text-xs text-gray-500 mt-2">Green: Spot | Red: Resistance | Blue: Support</p>
    </div>
  );
};
