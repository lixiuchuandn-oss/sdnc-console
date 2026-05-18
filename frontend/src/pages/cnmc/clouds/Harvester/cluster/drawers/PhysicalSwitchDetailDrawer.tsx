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
  parseSwitchProductModelFromInfoLines,
  switchRecordDeviceProfile,
  switchRecordManagementHost,
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

type SwitchDrawerModel = {
  record: any;
  host: string;
  profile: string;
  productModel: string;
  kpiInfoTone: KpiTone;
  kpiIfTone: KpiTone;
  kpiPerfTone: KpiTone;
  kpiProfileTone: KpiTone;
  kpiVlanTone: KpiTone;
  kpiInfoVal: string;
  kpiIfVal: string;
  kpiPerfVal: string;
  kpiProfileVal: string;
  kpiVlanVal: string;
};

function buildSwitchDrawerModel(record: any): SwitchDrawerModel {
  const host = switchRecordManagementHost(record);
  const profile = switchRecordDeviceProfile(record);
  const productModel = parseSwitchProductModelFromInfoLines(record.info?.lines);

  const kpiInfoTone: KpiTone =
    record.infoError || (record.info && record.info.ok === false) ? 'err' : record.info ? 'ok' : 'muted';
  const kpiIfTone: KpiTone =
    record.interfacesError || (record.interfaces && record.interfaces.ok === false)
      ? 'err'
      : record.interfaces
        ? 'ok'
        : 'muted';
  const kpiPerfTone: KpiTone = record.performanceError
    ? 'err'
    : record.performanceNotApplicable
      ? 'warn'
      : record.performance && record.performance.ok === false
        ? 'err'
        : record.performance
          ? 'ok'
          : 'muted';
  const kpiProfileTone: KpiTone = record.deviceProfilesError
    ? 'err'
    : record.deviceProfiles
      ? 'ok'
      : 'muted';
  const kpiVlanTone: KpiTone = record.vlansError
    ? 'err'
    : record.vlansNotApplicable
      ? 'warn'
      : record.vlans && record.vlans.ok === false
        ? 'err'
        : record.vlans
          ? 'ok'
          : 'muted';

  return {
    record,
    host,
    profile,
    productModel,
    kpiInfoTone,
    kpiIfTone,
    kpiPerfTone,
    kpiProfileTone,
    kpiVlanTone,
    kpiInfoVal: probeStateText(record, { errorKey: 'infoError', dataKey: 'info' }),
    kpiIfVal: probeStateText(record, { errorKey: 'interfacesError', dataKey: 'interfaces' }),
    kpiPerfVal: probeStateText(record, {
      errorKey: 'performanceError',
      dataKey: 'performance',
      naKey: 'performanceNotApplicable',
      naLabel: '未配置',
    }),
    kpiProfileVal: probeStateText(record, { errorKey: 'deviceProfilesError', dataKey: 'deviceProfiles' }),
    kpiVlanVal: probeStateText(record, {
      errorKey: 'vlansError',
      dataKey: 'vlans',
      naKey: 'vlansNotApplicable',
      naLabel: '未提供',
    }),
  };
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
      setActiveTab(initialTab);
    }
    prevOpenRef.current = open;
  }, [open, initialTab]);

  const drawerModel = useMemo(
    () => (record ? buildSwitchDrawerModel(record) : null),
    [record],
  );

  const tabItems = useMemo(() => {
    if (!drawerModel) return [];
    const r = drawerModel.record;
    const {
      host,
      profile,
      productModel,
      kpiInfoTone,
      kpiIfTone,
      kpiPerfTone,
      kpiProfileTone,
      kpiVlanTone,
      kpiInfoVal,
      kpiIfVal,
      kpiPerfVal,
      kpiProfileVal,
      kpiVlanVal,
    } = drawerModel;

    return [
      {
        key: 'overview',
        label: '概览',
        children: (
          <Descriptions {...DESCR_COL1}>
            <Descriptions.Item label="ASW-CTL 名称">
              {r.name != null && String(r.name).trim() ? r.name : '—'}
            </Descriptions.Item>
            <Descriptions.Item label="服务地址">
              {r.baseUrl ? (
                <Typography.Text copyable={{ text: r.baseUrl }} code>
                  {r.baseUrl}
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
            <Descriptions.Item label="服务健康">{aswCtlServiceHealthTag(r)}</Descriptions.Item>
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
            {r.healthError ? (
              <Alert
                type="error"
                showIcon
                message={`服务健康探测失败${r.healthHttpStatus ? `（HTTP ${r.healthHttpStatus}）` : ''}`}
                description={`${r.healthPath ? `${r.healthPath}：` : ''}${r.healthError}`}
              />
            ) : null}
            {r.infoError ? (
              <Alert
                type="error"
                showIcon
                message={`基本信息探测失败${r.infoHttpStatus ? `（HTTP ${r.infoHttpStatus}）` : ''}`}
                description={r.infoError}
              />
            ) : null}
            {r.interfacesError ? (
              <Alert
                type="error"
                showIcon
                message={`接口探测失败${r.interfacesHttpStatus ? `（HTTP ${r.interfacesHttpStatus}）` : ''}`}
                description={r.interfacesError}
              />
            ) : null}
            {r.performanceError ? (
              <Alert
                type="error"
                showIcon
                message={`性能探测失败${r.performanceHttpStatus ? `（HTTP ${r.performanceHttpStatus}）` : ''}`}
                description={r.performanceError}
              />
            ) : null}
            {r.deviceProfilesError ? (
              <Alert
                type="error"
                showIcon
                message={`设备 Profile 失败${r.deviceProfilesHttpStatus ? `（HTTP ${r.deviceProfilesHttpStatus}）` : ''}`}
                description={r.deviceProfilesError}
              />
            ) : null}
            {r.vlansError ? (
              <Alert
                type="error"
                showIcon
                message={`VLAN 查询失败${r.vlansHttpStatus ? `（HTTP ${r.vlansHttpStatus}）` : ''}`}
                description={r.vlansError}
              />
            ) : null}

            {r.healthNotApplicable ? (
              <Alert type="info" showIcon message={r.healthNaMessage || '未提供标准健康路径'} />
            ) : r.health != null ? (
              <Collapse
                size="small"
                items={[
                  {
                    key: 'health',
                    label: `服务健康（${r.healthPath || 'ok'}）`,
                    children: (
                      <Typography.Paragraph
                        copyable
                        code
                        style={{ marginBottom: 0, maxHeight: 280, overflow: 'auto', whiteSpace: 'pre-wrap' }}
                      >
                        {typeof r.health === 'string' ? r.health : JSON.stringify(r.health, null, 2)}
                      </Typography.Paragraph>
                    ),
                  },
                ]}
              />
            ) : null}

            {r.infoError ? null : (
              <AswCliOutputCollapse title="基本信息" lines={r.info?.lines || []} />
            )}
            {r.interfacesError ? null : (
              <AswCliOutputCollapse title="接口状态" lines={r.interfaces?.lines || []} />
            )}
            {r.performanceError ? null : r.performanceNotApplicable ? (
              <Alert
                type="info"
                showIcon
                message={r.performanceNaMessage || '性能探测未配置（HTTP 503）'}
              />
            ) : (
              <AswCliOutputCollapse title="性能/健康" lines={r.performance?.lines || []} />
            )}

            {r.deviceProfilesError ? null : r.deviceProfiles != null ? (
              <Collapse
                size="small"
                items={[
                  {
                    key: 'profiles',
                    label: 'GET /v1/device/profiles 响应',
                    children: (
                      <Typography.Paragraph
                        copyable={{ text: JSON.stringify(r.deviceProfiles, null, 2) }}
                        code
                        style={{ marginBottom: 0, maxHeight: 360, overflow: 'auto', whiteSpace: 'pre-wrap' }}
                      >
                        {JSON.stringify(r.deviceProfiles, null, 2)}
                      </Typography.Paragraph>
                    ),
                  },
                ]}
              />
            ) : null}

            {r.vlansError ? null : r.vlansNotApplicable ? (
              <Alert
                type="info"
                showIcon
                message={
                  r.vlansNaMessage ||
                  'HTTP 404：当前服务上无 GET /v1/switch/vlans路由（多为未升级、路径或地址指错）。'
                }
              />
            ) : null}
            {r.vlansError || r.vlansNotApplicable ? null : (
              <AswCliOutputCollapse title="VLAN CLI 回显" lines={r.vlans?.lines || []} />
            )}
          </Flex>
        ),
      },
    ];
  }, [drawerModel]);

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
