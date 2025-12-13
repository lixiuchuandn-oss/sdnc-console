import React from 'react';
import { Drawer, Button } from 'antd';
import type { DrawerProps } from 'antd';

type StdSideDrawerProps = {
  open: boolean;
  title: React.ReactNode;
  width?: number;
  placement?: 'right' | 'left';
  onClose?: () => void;
  children?: React.ReactNode;
  onOk?: () => void;
  okText?: string;
  cancelText?: string;
  headerDivider?: boolean;
  styles?: DrawerProps['styles'];
};

const StdSideDrawer: React.FC<StdSideDrawerProps> = ({ open, title, width = 1200, placement = 'right', onClose, children, onOk, okText = '保存', cancelText = '取消', styles }) => {
  return (
    <Drawer
      title={typeof title === 'string' ? (<span style={{ fontWeight: 400 }}>{title}</span>) : title}
      placement={placement}
      open={open}
      onClose={onClose}
      destroyOnClose
      width={width}
      styles={{
        footer: { height: 60, padding: '0 16px', background: '#fff', display: 'flex', alignItems: 'center' },
        ...(styles || {})
      }}
      footer={(
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12, width: '100%' }}>
          <Button onClick={onClose}>{cancelText}</Button>
          <Button type="primary" onClick={onOk}>{okText}</Button>
        </div>
      )}
    >
      {children}
    </Drawer>
  );
};

export default StdSideDrawer;