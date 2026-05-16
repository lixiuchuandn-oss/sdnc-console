/**
 * 物理交换机（ASW-CTL 单实例）侧滑详情 — 归属 Harvester/cluster/drawers。
 * 壳层与节点详情抽屉一致：antd Drawer / Tabs / Descriptions 等原生样式。
 * 端口前面板在 Cloudmap「资源总览 → 机房拓扑」机柜内嵌 `embeddedSwitchPortPanel`。
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Button,
  Collapse,
  Descriptions,
  Drawer,
  Flex,
  Tabs,
  Tag,
  Typography,
} from 'antd';
import AswCliOutputCollapse from '../components/AswCliOutputCollapse';
import {
  switchRecordManagementHost,
  switchRecordDeviceProfile,
  parseSwitchProductModelFromInfoLines,
} from '../lib/physicalSwitchRecordUtils';

export type PhysicalSwitchDetailDrawerProps = {
  open: boolean;
  record: any | null;
  onClose: () => void;
  /** 本次打开抽屉时默认选中的 Tab（仅在 open 由关→开时应用一次） */
  initialTab?: 'overview' | 'cli';
  /** 从集群重新拉取 ASW-CTL 列表/探测数据（由 Section 注入）；与云详情 `onRefresh(force)` 约定一致 */
  onRefreshFromCluster?: (force?: boolean) => void;
  refreshLoading?: boolean;
};

type KpiTone = 'ok' | 'warn' | 'err' | 'muted';

const DESCR_COL1 = {
  bordered: true as const,
  size: 'small' as const,
  column: 1 as const,
  styles: { label: { width: 200 } },
};

/** 状态 Tag：仅展示状态词（左侧 Descriptions 已有类别）；配色与 antd Tag 语义一致 */
function statusTag(state: string, tone: KpiTone): React.ReactNode {
  if (tone === 'err') return <Tag color="error">{state}</Tag>;
  if (tone === 'warn') return <Tag color="warning">{state}</Tag>;
  if (tone === 'ok') return <Tag color="success">{state}</Tag>;
  return <Tag>{state}</Tag>;
}

function probeStateText(
  record: any,
  opts: {
    errorKey: string;
    dataKey: string;
    naKey?: string;
    naLabel?: string;
  },
): string {
  if (record[opts.errorKey]) return '失败';
  const data = record[opts.dataKey];
  if (data && data.ok === false) return '失败';
  if (opts.naKey && record[opts.naKey]) return opts.naLabel || '未配置';
  if (data) return '正常';
  return '—';
}

/** ASW-CTL 北向服务探测（与交换机 CLI 查询区分） */
function aswCtlServiceHealthTag(record: any): React.ReactNode {
  if (record.healthError) {
    return statusTag('失败', 'err');
  }
  if (record.healthNotApplicable) {
    return statusTag('未提供', 'muted');
  }
  if (record.health != null) {
    return statusTag('正常', 'ok');
  }
  return statusTag('—', 'muted');
}

const PhysicalSwitchDetailDrawer: React.FC<PhysicalSwitchDetailDrawerProps> = ({
  open,
  record,
  onClose,
  initialTab = 'overview',
  onRefreshFromCluster,
  refreshLoading = false,
}) => {
  const [activeTab, setActiveTab] = useState<'overview' | 'cli'>('overview');
  const prevOpenRef = useRef(false);
  useEffect(() => {
    if (open && !prevOpenRef.current) {
      setActiveTab(initialTab ?? 'overview');
    }
    prevOpenRef.current = open;
  }, [open, initialTab]);

  const host = record ? switchRecordManagementHost(record) : '—';
  const productModel = useMemo(
    () => (record ? parseSwitchProductModelFromInfoLines(record.info?.lines) : ''),
    [record],
  );
  const profile = record ? switchRecordDeviceProfile(record) : '';

  const kpiInfoTone: KpiTone = !record
    ? 'muted'
    : record.infoError || (record.info && record.info.ok === false)
      ? 'err'
      : record.info
        ? 'ok'
        : 'muted';
  const kpiIfTone: KpiTone = !record
    ? 'muted'
    : record.interfacesError || (record.interfaces && record.interfaces.ok === false)
      ? 'err'
      : record.interfaces
        ? 'ok'
        : 'muted';
  const kpiPerfTone: KpiTone = !record
    ? 'muted'
    : record.performanceError
      ? 'err'
      : record.performanceNotApplicable
        ? 'warn'
        : record.performance && record.performance.ok === false
          ? 'err'
          : record.performance
            ? 'ok'
            : 'muted';
  const kpiProfileTone: KpiTone = !record
    ? 'muted'
    : record.deviceProfilesError
      ? 'err'
      : record.deviceProfiles
        ? 'ok'
        : 'muted';
  const kpiVlanTone: KpiTone = !record
    ? 'muted'
    : record.vlansError
      ? 'err'
      : record.vlansNotApplicable
        ? 'warn'
        : record.vlans && record.vlans.ok === false
          ? 'err'
          : record.vlans
            ? 'ok'
            : 'muted';

  const kpiInfoVal = record
    ? probeStateText(record, { errorKey: 'infoError', dataKey: 'info' })
    : '—';
  const kpiIfVal = record
    ? probeStateText(record, { errorKey: 'interfacesError', dataKey: 'interfaces' })
    : '—';
  const kpiPerfVal = record
    ? probeStateText(record, {
        errorKey: 'performanceError',
        dataKey: 'performance',
        naKey: 'performanceNotApplicable',
        naLabel: '未配置',
      })
    : '—';
  const kpiProfileVal = record
    ? probeStateText(record, { errorKey: 'deviceProfilesError', dataKey: 'deviceProfiles' })
    : '—';
  const kpiVlanVal = record
    ? probeStateText(record, {
        errorKey: 'vlansError',
        dataKey: 'vlans',
        naKey: 'vlansNotApplicable',
        naLabel: '未提供',
      })
    : '—';

  const tabItems = useMemo(() => {
    if (!record) return [];
    return [
      {
        key: 'overview',
        label: '概览',
        children: (
          <Descriptions {...DESCR_COL1}>
            <Descriptions.Item label="ASW-CTL 名称">
              {record.name != null && String(record.name).trim() ? record.name : '—'}
            </Descriptions.Item>
            <Descriptions.Item label="服务地址">
              {record.baseUrl ? (
                <Typography.Text copyable={{ text: record.baseUrl }} code>
                  {record.baseUrl}
                </Typography.Text>
              ) : (
                '—'
              )}
            </Descriptions.Item>
            <Descriptions.Item label="设备模板">{profile || '—'}</Descriptions.Item>
            <Descriptions.Item label="型号">{productModel || '—'}</Descriptions.Item>
            <Descriptions.Item label="管理地址">
              {host !== '—' ? (
                <Typography.Text copyable={{ text: host }} code>
                  {host}
                </Typography.Text>
              ) : (
                '—'
              )}
            </Descriptions.Item>
            <Descriptions.Item label="服务健康">{aswCtlServiceHealthTag(record)}</Descriptions.Item>
            <Descriptions.Item label="基本信息">{statusTag(kpiInfoVal, kpiInfoTone)}</Descriptions.Item>
            <Descriptions.Item label="接口状态">{statusTag(kpiIfVal, kpiIfTone)}</Descriptions.Item>
            <Descriptions.Item label="性能探测">{statusTag(kpiPerfVal, kpiPerfTone)}</Descriptions.Item>
            <Descriptions.Item label="设备 Profile">{statusTag(kpiProfileVal, kpiProfileTone)}</Descriptions.Item>
            <Descriptions.Item label="VLAN 查询">{statusTag(kpiVlanVal, kpiVlanTone)}</Descriptions.Item>
          </Descriptions>
        ),
      },
      {
        key: 'cli',
        label: '系统信息',
        children: (
          <Flex vertical gap="middle">
            {record.healthError ? (
              <Alert
                type="error"
                showIcon
                message={`服务健康探测失败${record.healthHttpStatus ? `（HTTP ${record.healthHttpStatus}）` : ''}`}
                description={`${record.healthPath ? `${record.healthPath}：` : ''}${record.healthError}`}
              />
            ) : null}
            {record.infoError ? (
              <Alert
                type="error"
                showIcon
                message={`基本信息探测失败${record.infoHttpStatus ? `（HTTP ${record.infoHttpStatus}）` : ''}`}
                description={record.infoError}
              />
            ) : null}
            {record.interfacesError ? (
              <Alert
                type="error"
                showIcon
                message={`接口探测失败${record.interfacesHttpStatus ? `（HTTP ${record.interfacesHttpStatus}）` : ''}`}
                description={record.interfacesError}
              />
            ) : null}
            {record.performanceError ? (
              <Alert
                type="error"
                showIcon
                message={`性能探测失败${record.performanceHttpStatus ? `（HTTP ${record.performanceHttpStatus}）` : ''}`}
                description={record.performanceError}
              />
            ) : null}
            {record.deviceProfilesError ? (
              <Alert
                type="error"
                showIcon
                message={`设备 Profile 失败${record.deviceProfilesHttpStatus ? `（HTTP ${record.deviceProfilesHttpStatus}）` : ''}`}
                description={record.deviceProfilesError}
              />
            ) : null}
            {record.vlansError ? (
              <Alert
                type="error"
                showIcon
                message={`VLAN 查询失败${record.vlansHttpStatus ? `（HTTP ${record.vlansHttpStatus}）` : ''}`}
                description={record.vlansError}
              />
            ) : null}

            {record.healthNotApplicable ? (
              <Alert type="info" showIcon message={record.healthNaMessage || '未提供标准健康路径'} />
            ) : record.health != null ? (
              <Collapse
                size="small"
                items={[
                  {
                    key: 'health',
                    label: `服务健康（${record.healthPath || 'ok'}）`,
                    children: (
                      <Typography.Paragraph
                        copyable
                        code
                        style={{ marginBottom: 0, maxHeight: 280, overflow: 'auto', whiteSpace: 'pre-wrap' }}
                      >
                        {typeof record.health === 'string'
                          ? record.health
                          : JSON.stringify(record.health, null, 2)}
                      </Typography.Paragraph>
                    ),
                  },
                ]}
              />
            ) : null}

            {record.infoError ? null : (
              <AswCliOutputCollapse title="基本信息" lines={record.info?.lines || []} />
            )}
            {record.interfacesError ? null : (
              <AswCliOutputCollapse title="接口状态" lines={record.interfaces?.lines || []} />
            )}
            {record.performanceError ? null : record.performanceNotApplicable ? (
              <Alert
                type="info"
                showIcon
                message={record.performanceNaMessage || '性能探测未配置（HTTP 503）'}
              />
            ) : (
              <AswCliOutputCollapse title="性能/健康" lines={record.performance?.lines || []} />
            )}

            {record.deviceProfilesError ? null : record.deviceProfiles != null ? (
              <Collapse
                size="small"
                items={[
                  {
                    key: 'profiles',
                    label: 'GET /v1/device/profiles 响应',
                    children: (
                      <Typography.Paragraph
                        copyable={{ text: JSON.stringify(record.deviceProfiles, null, 2) }}
                        code
                        style={{ marginBottom: 0, maxHeight: 360, overflow: 'auto', whiteSpace: 'pre-wrap' }}
                      >
                        {JSON.stringify(record.deviceProfiles, null, 2)}
                      </Typography.Paragraph>
                    ),
                  },
                ]}
              />
            ) : null}

            {record.vlansError ? null : record.vlansNotApplicable ? (
              <Alert
                type="info"
                showIcon
                message={
                  record.vlansNaMessage ||
                  'HTTP 404：当前服务上无 GET /v1/switch/vlans路由（多为未升级、路径或地址指错）。'
                }
              />
            ) : null}
            {record.vlansError || record.vlansNotApplicable ? null : (
              <AswCliOutputCollapse title="VLAN CLI 回显" lines={record.vlans?.lines || []} />
            )}
          </Flex>
        ),
      },
    ];
  }, [record, profile, productModel, host]);

  return (
    <Drawer
      title="交换机详情"
      extra={
        onRefreshFromCluster ? (
          <Button size="small" onClick={() => onRefreshFromCluster(true)} loading={refreshLoading}>
            刷新
          </Button>
        ) : null
      }
      placement="right"
      width="min(1000px, 96vw)"
      open={open && !!record}
      onClose={onClose}
      destroyOnHidden
    >
      {record ? (
        <Tabs activeKey={activeTab} onChange={(k) => setActiveTab(k as typeof activeTab)} items={tabItems} />
      ) : null}
    </Drawer>
  );
};

export default PhysicalSwitchDetailDrawer;
