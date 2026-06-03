import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Drawer, Flex, Spin, Typography } from 'antd';
import WebSshTerminal, { type WebSshConnectParams } from 'components/WebSshTerminal';
import type { HmsSwitchCr } from 'services/harvester/cluster';
import { fetchHmsSwitchSshConnect } from 'services/harvester/cluster';
import { formatHmsDeviceProfileLabel } from '../lib/hmsSwitchCrForm';
import { hmsSwitchCrManagementHost } from '../lib/physicalSwitchRecordUtils';

export type HmsSwitchSshDrawerProps = {
  open: boolean;
  cloudId: string;
  cr: HmsSwitchCr | null;
  onClose: () => void;
};

const HmsSwitchSshDrawer: React.FC<HmsSwitchSshDrawerProps> = ({ open, cloudId, cr, onClose }) => {
  const [drawerReady, setDrawerReady] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [connect, setConnect] = useState<WebSshConnectParams | null>(null);

  const configName = String(cr?.metadata?.name || '').trim();
  const hostLabel = cr ? hmsSwitchCrManagementHost(cr) : '';

  const subtitle = useMemo(() => {
    if (!cr?.spec) return hostLabel && hostLabel !== '—' ? hostLabel : undefined;
    const profile = formatHmsDeviceProfileLabel(cr.spec.deviceProfile);
    const vendor = String(cr.spec.vendor || '').trim();
    const parts = [hostLabel !== '—' ? hostLabel : '', vendor, profile !== '—' ? profile : '']
      .filter(Boolean)
      .join(' · ');
    return parts || undefined;
  }, [cr, hostLabel]);

  const footerHint =
    'H3C 示例：screen-length disable → display interface brief | include XGE';

  const loadConnect = useCallback(async () => {
    if (!cloudId || !configName) return;
    setLoading(true);
    setError(null);
    setConnect(null);
    try {
      const res = (await fetchHmsSwitchSshConnect(cloudId, configName)) as {
        data?: WebSshConnectParams;
        message?: string;
      };
      const data = res?.data;
      if (!data?.host || !data?.username || !data?.password) {
        throw new Error('未返回有效的 SSH 连接参数');
      }
      setConnect({
        host: data.host,
        port: data.port,
        username: data.username,
        password: data.password,
        bootstrap: data.bootstrap ?? 'none',
      });
    } catch (e: unknown) {
      const err = e as { response?: { data?: { message?: string } }; message?: string };
      setError(err?.response?.data?.message || err?.message || '获取 SSH 连接参数失败');
      setConnect(null);
    } finally {
      setLoading(false);
    }
  }, [cloudId, configName]);

  useEffect(() => {
    if (!open || !cr) {
      setConnect(null);
      setError(null);
      setLoading(false);
      return;
    }
    void loadConnect();
  }, [open, cr, loadConnect]);

  const showTerminal = drawerReady && open && !!cr && !loading && !error && !!connect;

  return (
    <Drawer
      className="hms-switch-ssh-drawer"
      afterOpenChange={(visible) => setDrawerReady(visible)}
      title={
        configName ? (
          <Flex vertical gap={0}>
            <span>SSH 终端</span>
            <Typography.Text type="secondary" style={{ fontSize: 12, fontWeight: 400 }}>
              {configName}
            </Typography.Text>
          </Flex>
        ) : (
          'SSH 终端'
        )
      }
      placement="right"
      width="min(960px, 96vw)"
      open={open && !!cr}
      onClose={onClose}
      destroyOnHidden
    >
      {!cr?.spec?.passwordConfigured && !loading && !error ? (
        <Alert
          type="warning"
          showIcon
          message="未配置 SSH 密码"
          description="请先在「编辑」中填写密码后再连接。"
          style={{ marginBottom: 12, flexShrink: 0 }}
        />
      ) : null}

      {error ? (
        <Alert
          type="error"
          showIcon
          message="无法打开 SSH"
          description={error}
          style={{ marginBottom: 12, flexShrink: 0 }}
        />
      ) : null}

      {loading ? (
        <Flex align="center" justify="center" style={{ flex: 1, minHeight: 320 }}>
          <Spin tip="正在读取交换机凭据…" size="large" />
        </Flex>
      ) : null}

      {showTerminal ? (
        <WebSshTerminal
          active
          fillParent
          connect={connect}
          title="交换机 CLI"
          subtitle={subtitle}
          footerHint={footerHint}
        />
      ) : null}

      {!loading && !error && !connect && open && cr ? (
        <Flex align="center" justify="center" style={{ flex: 1, minHeight: 200, color: '#888' }}>
          暂无可用连接
        </Flex>
      ) : null}
    </Drawer>
  );
};

export default HmsSwitchSshDrawer;
