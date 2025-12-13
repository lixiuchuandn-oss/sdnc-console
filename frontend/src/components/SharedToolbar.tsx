import React from 'react';
import { Space } from 'antd';

type Props = {
  left?: React.ReactNode;
  right?: React.ReactNode;
  style?: React.CSSProperties;
  leftGap?: number;
  rightGap?: number;
};

const SharedToolbar: React.FC<Props> = ({ left, right, style, leftGap = 8, rightGap = 8 }) => {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, ...style }}>
      <Space size={leftGap} wrap>
        {left}
      </Space>
      <Space size={rightGap} wrap>
        {right}
      </Space>
    </div>
  );
};

export default SharedToolbar;