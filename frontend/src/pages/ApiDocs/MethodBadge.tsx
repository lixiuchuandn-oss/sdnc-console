import React from 'react';

export interface MethodBadgeProps {
  method: string;
  style?: React.CSSProperties;
}

export const MethodBadge: React.FC<MethodBadgeProps> = ({ method, style }) => {
  const normalizedMethod = (method || '').toUpperCase();
  
  const colors: Record<string, string> = {
    GET: '#0CBB52',    // Green
    POST: '#FFB400',   // Yellow/Orange
    PUT: '#097BED',    // Blue
    DELETE: '#EB2013', // Red
    PATCH: '#7658F8',  // Purple
    HEAD: '#0CBB52',   // Green (same as GET usually)
    OPTIONS: '#FF00DD',// Pink/Magenta
  };

  const color = colors[normalizedMethod] || '#333';

  return (
    <span style={{ 
      color: color, 
      fontWeight: 'bold', 
      fontSize: '12px',
      fontFamily: 'Menlo, Monaco, Consolas, "Courier New", monospace',
      marginRight: '8px',
      ...style 
    }}>
      {normalizedMethod}
    </span>
  );
};
