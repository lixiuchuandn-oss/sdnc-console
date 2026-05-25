import React, { useMemo } from 'react';
import { Alert, Empty, Modal } from 'antd';

const DEFAULT_CONSOLE_PORT = 3000;

/** 与 RdsManageDrawer readPrimaryIp 一致：Harvester VM / VMI 主网卡 IP */
export const readRdsVmPrimaryIp = (vm: any): string => {
  const interfaces = vm?.status?.interfaces || vm?.vmi?.status?.interfaces || [];
  const first = Array.isArray(interfaces) ? interfaces[0] : null;
  const raw = first?.ipAddress || first?.ip || '';
  const s = String(raw).trim();
  if (!s || s === '-') return '';
  return s;
};

export const buildRdsDatabaseConsoleUrl = (vm: any, port: number = DEFAULT_CONSOLE_PORT): string => {
  const ip = readRdsVmPrimaryIp(vm);
  if (!ip) return '';
  return `http://${ip}:${port}/`;
};

type Props = {
  open: boolean;
  onClose: () => void;
  /** 当前要打开管理台的虚拟机对象（列表行记录） */
  vm: any | null;
  /** 管理台 HTTP 端口，默认 3000 */
  port?: number;
  /** iframe 无障碍标题；云数据库默认「数据库管理」，虚拟路由器等可传入 */
  iframeTitle?: string;
};

/**
 * 大模态框内 iframe 嵌套外部数据库管理页（不下钻路由）。
 * 控制台地址由实例虚拟机主网卡 IP 与端口拼接。
 */
const RdsDatabaseConsoleModal: React.FC<Props> = ({
  open,
  onClose,
  vm,
  port = DEFAULT_CONSOLE_PORT,
  iframeTitle = '数据库管理',
}) => {
  const src = useMemo(() => (vm ? buildRdsDatabaseConsoleUrl(vm, port) : ''), [vm, port]);

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
      {src ? (
        <iframe
          title={iframeTitle}
          src={src}
          style={{
            width: '100%',
            height: '100%',
            border: 'none',
            display: 'block',
          }}
        />
      ) : (
        <div
          style={{
            height: '100%',
            minHeight: 280,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 12,
            padding: 24,
          }}
        >
          <Alert
            type="warning"
            showIcon
            message="暂无法打开管理台"
            description="当前实例在列表数据中还没有可用的虚拟机 IP（请确认实例已运行且网络已分配）。"
          />
          <Empty description="无 IP 时不加载 iframe" />
        </div>
      )}
    </Modal>
  );
};

export default RdsDatabaseConsoleModal;
