/**
 * HMS Switch CR 详情抽屉：展示声明式配置 + HSM 探测的运行状态。
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Button, Descriptions, Drawer, Flex, Spin, Tabs, Tag, Typography } from 'antd';
import type { HmsSwitchCr } from 'services/harvester/cluster';
import {
  fetchAswCtlSwitchesSummary,
  syncAswCtlSwitchesToInventory,
} from 'services/harvester/cluster';
import type {
  AswCtlSwitchProbeRecord,
  AswCtlSwitchesSummaryResponse,
} from 'services/harvester/types/aswProbe';
import { formatHmsDeviceProfileLabel } from '../lib/hmsSwitchCrForm';
import PhysicalSwitchProbeTabs from '../components/PhysicalSwitchProbeTabs';
import {
  hmsSwitchCrManagementHost,
  matchAswProbeRecordByCr,
  parseSwitchDisplayNameFromInfoLines,
  parseSwitchProductModelFromInfoLines,
} from '../lib/physicalSwitchRecordUtils';

export type HmsSwitchDetailDrawerProps = {
  open: boolean;
  cr: HmsSwitchCr | null;
  cloudId: string;
  onClose: () => void;
  /** 写权限时可触发实时探测并写库 */
  canSync?: boolean;
};

const DESCR_COL1 = {
  bordered: true as const,
  size: 'small' as const,
  column: 1 as const,
  styles: { label: { width: 200 } },
};

function commandCountLabel(list?: string[]): string {
  if (!Array.isArray(list) || list.length === 0) return '默认';
  return `${list.length} 条`;
}

const HmsSwitchDetailDrawer: React.FC<HmsSwitchDetailDrawerProps> = ({
  open,
  cr,
  cloudId,
  onClose,
  canSync = false,
}) => {
  const [probeRecord, setProbeRecord] = useState<AswCtlSwitchProbeRecord | null>(null);
  const [probeLoading, setProbeLoading] = useState(false);
  const [probeError, setProbeError] = useState<string | null>(null);
  const [cacheSyncedAt, setCacheSyncedAt] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'config' | 'runtime'>('config');

  const loadProbe = useCallback(
    async (live: boolean) => {
      if (!cloudId || !cr) return;
      const configName = String(cr.metadata?.name || '').trim();
      setProbeLoading(true);
      setProbeError(null);
      try {
        const res = (await (live && canSync && configName
          ? syncAswCtlSwitchesToInventory(cloudId, { name: configName })
          : fetchAswCtlSwitchesSummary(cloudId))) as AswCtlSwitchesSummaryResponse;
        const items = Array.isArray(res?.items) ? res.items : [];
        setProbeRecord(matchAswProbeRecordByCr(items, cr));
        setCacheSyncedAt(res?.cacheSyncedAt ? String(res.cacheSyncedAt) : null);
        if (!res?.configured && res?.message) {
          setProbeError(String(res.message));
        }
      } catch (e: unknown) {
        setProbeRecord(null);
        const err = e as { response?: { data?: { message?: string } }; message?: string };
        setProbeError(err?.response?.data?.message || err?.message || '加载运行状态失败');
      } finally {
        setProbeLoading(false);
      }
    },
    [canSync, cloudId, cr],
  );

  useEffect(() => {
    if (!open || !cr) {
      setProbeRecord(null);
      setProbeError(null);
      setCacheSyncedAt(null);
      setActiveTab('config');
      return;
    }
    void loadProbe(false);
  }, [open, cr, loadProbe]);

  const configName = String(cr?.metadata?.name || '').trim();
  const managementHost = cr ? hmsSwitchCrManagementHost(cr) : '';
  const backupHosts = useMemo(() => {
    if (!cr?.spec?.hosts) return [];
    const primary = managementHost;
    return cr.spec.hosts.map(String).filter((h) => h && h !== primary);
  }, [cr, managementHost]);

  const runtimeTitle = useMemo(() => {
    if (!probeRecord) return '';
    return (
      parseSwitchDisplayNameFromInfoLines(probeRecord.info?.lines) ||
      parseSwitchProductModelFromInfoLines(probeRecord.info?.lines, { vendor: cr?.spec?.vendor }) ||
      ''
    );
  }, [probeRecord]);

  const tabItems = useMemo(() => {
    if (!cr) return [];

    const spec = cr.spec || {};

    return [
      {
        key: 'config',
        label: '配置',
        children: (
          <Descriptions {...DESCR_COL1}>
            <Descriptions.Item label="配置名称">{configName || '—'}</Descriptions.Item>
            <Descriptions.Item label="管理地址">
              {managementHost ? (
                <Typography.Text copyable={{ text: managementHost }} code>
                  {managementHost}
                </Typography.Text>
              ) : (
                '—'
              )}
            </Descriptions.Item>
            <Descriptions.Item label="备用地址">
              {backupHosts.length > 0 ? backupHosts.join('、') : '—'}
            </Descriptions.Item>
            <Descriptions.Item label="厂商">{spec.vendor || '—'}</Descriptions.Item>
            <Descriptions.Item label="设备模板">
              {formatHmsDeviceProfileLabel(spec.deviceProfile)}
            </Descriptions.Item>
            <Descriptions.Item label="SSH 用户">{spec.user || 'root'}</Descriptions.Item>
            <Descriptions.Item label="SSH 端口">{spec.port ?? 22}</Descriptions.Item>
            <Descriptions.Item label="密码">
              {spec.passwordConfigured ? <Tag color="success">已配置</Tag> : '—'}
            </Descriptions.Item>
            <Descriptions.Item label="连接超时">
              {spec.dialTimeout != null ? `${spec.dialTimeout} 秒` : '15 秒'}
            </Descriptions.Item>
            <Descriptions.Item label="命令超时">
              {spec.execTimeout != null ? `${spec.execTimeout} 秒` : '15 秒'}
            </Descriptions.Item>
            <Descriptions.Item label="基本信息命令">
              {commandCountLabel(spec.infoCommands)}
            </Descriptions.Item>
            <Descriptions.Item label="接口命令">
              {commandCountLabel(spec.interfaceCommands)}
            </Descriptions.Item>
            <Descriptions.Item label="性能命令">
              {commandCountLabel(spec.performanceCommands)}
            </Descriptions.Item>
            <Descriptions.Item label="VLAN 命令">
              {commandCountLabel(spec.vlanCommands)}
            </Descriptions.Item>
            <Descriptions.Item label="CORS 来源">
              {Array.isArray(spec.corsAllowedOrigins) && spec.corsAllowedOrigins.length > 0
                ? spec.corsAllowedOrigins.join('、')
                : '*'}
            </Descriptions.Item>
            {cr.metadata?.resourceVersion ? (
              <Descriptions.Item label="resourceVersion">
                {cr.metadata.resourceVersion}
              </Descriptions.Item>
            ) : null}
          </Descriptions>
        ),
      },
      {
        key: 'runtime',
        label: '运行状态',
        children: (
          <Flex vertical gap="middle">
            {probeLoading ? (
              <Flex justify="center" style={{ padding: 48 }}>
                <Spin tip="加载运行状态…" />
              </Flex>
            ) : probeError ? (
              <Alert type="warning" showIcon message="无法加载运行状态" description={probeError} />
            ) : null}

            {!probeLoading && !probeRecord ? (
              <Alert
                type="info"
                showIcon
                message="暂无与该管理地址匹配的探测数据"
                description={
                  <>
                    <div>
                      HSM 需先读取 Switch CR 并完成探测后，此处才会展示型号、接口与 CLI 回显。
                      {cacheSyncedAt ? (
                        <>
                          <br />
                          末次入库时间：{cacheSyncedAt}
                        </>
                      ) : null}
                    </div>
                    {canSync ? (
                      <Button
                        type="link"
                        size="small"
                        style={{ paddingLeft: 0, marginTop: 8 }}
                        loading={probeLoading}
                        onClick={() => void loadProbe(true)}
                      >
                        立即探测
                      </Button>
                    ) : null}
                  </>
                }
              />
            ) : null}

            {!probeLoading && probeRecord ? (
              <>
                {runtimeTitle ? (
                  <Typography.Text type="secondary">
                    设备标识：{runtimeTitle}
                  </Typography.Text>
                ) : null}
                <PhysicalSwitchProbeTabs record={probeRecord} />
              </>
            ) : null}
          </Flex>
        ),
      },
    ];
  }, [
    backupHosts,
    cacheSyncedAt,
    canSync,
    configName,
    cr,
    loadProbe,
    managementHost,
    probeError,
    probeLoading,
    probeRecord,
    runtimeTitle,
  ]);

  return (
    <Drawer
      title={configName ? `交换机详情 · ${configName}` : '交换机详情'}
      placement="right"
      width="min(1000px, 96vw)"
      open={open && !!cr}
      onClose={onClose}
      destroyOnHidden
      extra={
        <Button
          size="small"
          loading={probeLoading}
          onClick={() => void loadProbe(!!canSync)}
        >
          {canSync ? '探测刷新' : '刷新'}
        </Button>
      }
    >
      {cr ? (
        <Tabs activeKey={activeTab} onChange={(k) => setActiveTab(k as typeof activeTab)} items={tabItems} />
      ) : null}
    </Drawer>
  );
};

export default HmsSwitchDetailDrawer;
