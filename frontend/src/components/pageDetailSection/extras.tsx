import React from 'react';
import { Button, Dropdown, Switch } from 'antd';
import { EllipsisOutlined } from '@ant-design/icons';

export const LiveSwitch: React.FC<{
  checked?: boolean;
  onChange?: (v: boolean) => void;
  label?: React.ReactNode;
}> = ({ checked, onChange, label }) => (
  <span
    style={{
      display: 'inline-flex',
      alignItems: 'center',
      border: '1px solid #d9d9d9',
      borderRadius: 6,
      height: 32,
      padding: '0 10px',
    }}
  >
    <Switch size="small" checked={!!checked} onChange={() => onChange && onChange(!checked)} />
    <span style={{ marginLeft: 8, color: '#555' }}>{label ?? '实时刷新'}</span>
  </span>
);

export const RowActionsButton: React.FC<{
  items: any[];
  onClick?: (info: { key: string }) => void;
  buttonProps?: any;
}> = ({ items, onClick, buttonProps }) => (
  <Dropdown
    menu={{
      items,
      onClick: ({ key }) => {
        onClick?.({ key });
      },
    }}
  >
    <Button type="link" icon={<EllipsisOutlined />} {...buttonProps} />
  </Dropdown>
);
