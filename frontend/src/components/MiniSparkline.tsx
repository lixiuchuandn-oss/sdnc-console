import React from 'react';

type MiniSparklineProps = {
  data: number[];
  width?: number;
  height?: number;
  color?: string;
  strokeWidth?: number;
  area?: boolean;
  ariaLabel?: string;
};

/**
 * Lightweight SVG sparkline (no external deps)
 * - Scales data to fit given width/height
 * - Optional area fill
 */
const MiniSparkline: React.FC<MiniSparklineProps> = ({
  data,
  width = 160,
  height = 36,
  color = 'var(--primary-hex)',
  strokeWidth = 2,
  area = true,
  ariaLabel = '趋势图',
}) => {
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const stepX = width / Math.max(1, data.length - 1);

  const points = data.map((d, i) => {
    const x = i * stepX;
    const y = height - ((d - min) / range) * height;
    return `${x},${y}`;
  }).join(' ');

  // Area path (polyline baseline to bottom)
  const areaPoints = `0,${height} ${points} ${width},${height}`;

  return (
    <svg width={width} height={height} role="img" aria-label={ariaLabel}>
      {area && (
        <polyline points={areaPoints} fill={`rgba(22,119,255,0.12)`} stroke="none" />
      )}
      <polyline points={points} fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" />
    </svg>
  );
};

export default MiniSparkline;