import React from 'react';
import { Modal } from 'antd';

/** 数据库管理控制台嵌入地址 */
export const RDS_DATABASE_CONSOLE_URL = 'http://192.168.2.19:5173/';

type Props = {
  open: boolean;
  onClose: () => void;
};

/**
 * 大模态框内 iframe 嵌套外部数据库管理页（不下钻路由）。
 */
const RdsDatabaseConsoleModal: React.FC<Props> = ({ open, onClose }) => {
  return (
    <Modal
      title={null}
      open={open}
      onCancel={onClose}
      footer={null}
      width="98vw"
      centered
      /** 不要右上角 ×：其绝对定位会压在 iframe 上；可用点击遮罩或 Esc 关闭（keyboard 默认开启） */
      closable={false}
      styles={{
        content: {
          padding: 16,
          height: '95vh',
          maxHeight: '95vh',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          boxSizing: 'border-box',
        },
        body: {
          flex: 1,
          minHeight: 0,
          padding: 0,
          overflow: 'hidden',
        },
      }}
      destroyOnHidden
      maskClosable
    >
      <iframe
        title="数据库管理"
        src={RDS_DATABASE_CONSOLE_URL}
        style={{
          width: '100%',
          height: '100%',
          border: 'none',
          display: 'block',
        }}
      />
    </Modal>
  );
};

export default RdsDatabaseConsoleModal;
