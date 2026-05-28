import React from 'react';
import { Space } from 'antd';

export type WizardFooterProps = {
  left?: React.ReactNode;
  children: React.ReactNode;
};

const WizardFooter: React.FC<WizardFooterProps> = ({ left, children }) => (
  <div
    style={{
      marginTop: 8,
      padding: '16px 0 0',
      borderTop: '1px solid rgba(0,0,0,.06)',
      display: 'flex',
      justifyContent: 'space-between',
      flexWrap: 'wrap',
      gap: 12,
    }}
  >
    <Space wrap>{left}</Space>
    <Space wrap>{children}</Space>
  </div>
);

export default WizardFooter;
