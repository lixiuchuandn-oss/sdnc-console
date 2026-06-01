import React from 'react';
import { Tooltip } from 'antd';

export const CbrEllipsisTooltip: React.FC<{
  text: string;
  mono?: boolean;
  icon?: React.ReactNode;
}> = ({ text, mono, icon }) => (
  <span style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0, width: '100%' }}>
    {icon ? <span style={{ flexShrink: 0 }}>{icon}</span> : null}
    <Tooltip placement="topLeft" title={text}>
      <span
        className={mono ? 'table-mono-uuid' : undefined}
        style={{
          flex: 1,
          minWidth: 0,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {text}
      </span>
    </Tooltip>
  </span>
);
