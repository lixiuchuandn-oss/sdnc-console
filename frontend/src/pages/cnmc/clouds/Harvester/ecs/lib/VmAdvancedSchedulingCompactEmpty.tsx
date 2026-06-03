import React from 'react';

export const vmAdvancedSchedulingEmptyBarStyle: React.CSSProperties = {
  border: '1px dashed #d9d9d9',
  borderRadius: 6,
  padding: '8px 12px',
  background: '#fafafa',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 12,
  flexWrap: 'wrap',
};

export const vmAdvancedSchedulingEmptyBarTextStyle: React.CSSProperties = {
  color: '#8c8c8c',
  fontSize: 13,
  lineHeight: '22px',
};

type VmAdvancedSchedulingCompactEmptyProps = {
  description: string;
  actions: React.ReactNode;
};

/** 高级调度 · 紧凑空状态（节点标签 / 亲和性规则等） */
export const VmAdvancedSchedulingCompactEmpty: React.FC<VmAdvancedSchedulingCompactEmptyProps> = ({
  description,
  actions,
}) => (
  <div style={vmAdvancedSchedulingEmptyBarStyle}>
    <span style={vmAdvancedSchedulingEmptyBarTextStyle}>{description}</span>
    {actions}
  </div>
);
