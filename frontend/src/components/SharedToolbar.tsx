import React from 'react';
import { Space } from 'antd';

type Props = {
  left?: React.ReactNode;
  right?: React.ReactNode;
  style?: React.CSSProperties;
  leftGap?: number;
  rightGap?: number;
};

/**
 * 形态约束：
 * - 左侧：放“筛选动作”（输入框、选择器、筛选开关等）
 * - 右侧：放“主要动作”和“辅助动作”（创建、批量、刷新等）
 * - 间距：左右默认 8；可用 leftGap/rightGap 调整
 */
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
