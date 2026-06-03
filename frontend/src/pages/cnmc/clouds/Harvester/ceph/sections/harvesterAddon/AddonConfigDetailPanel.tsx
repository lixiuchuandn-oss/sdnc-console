/**
 * 已部署集群 ·「配置详情」Tab：只读展示当前生效的存储配置。
 */
import React, { useMemo } from 'react';
import {
  CloudServerOutlined,
  ClusterOutlined,
  DatabaseOutlined,
  HddOutlined,
  GlobalOutlined,
} from '@ant-design/icons';
import { Card, Col, Empty, Row, Space, Tag, Typography } from 'antd';
import type { CephStorageNetworkResponse } from '../../../../../../../services/cephApi';
import {
  blockDeviceDriveKindLabel,
  blockDeviceDriveKindTagColor,
  mergeConfiguredBlockDeviceOptions,
  normalizeDeviceNames,
  parseBlockDeviceOptions,
  resolveBlockDeviceDriveKind,
  type CephHarvesterAddonFormValues,
} from '../../lib/cephHarvesterAddon';
import {
  storageNetworkModeLabel,
  storageNetworkModeTagColor,
} from '../../lib/cephStorageNetwork';
import {
  ADDON_CONFIG_DETAIL_CARD_STYLES,
  ADDON_CONFIG_DETAIL_FIELD_GRID_STYLE,
  ADDON_CONFIG_DETAIL_METRIC_CARD_BODY_STYLE,
  ADDON_CONFIG_DETAIL_METRIC_CARD_STYLE,
  ADDON_CONFIG_DETAIL_METRIC_COL_STYLE,
  ADDON_CONFIG_DETAIL_NODE_CARD_STYLE,
  ADDON_CONFIG_DETAIL_NODE_COL_PROPS,
  formatBindingLabel,
  formatCompressionLabel,
  formatOsdStoreLabel,
  formatReclaimLabel,
} from './addonUiConstants';

export type AddonConfigDetailPanelProps = {
  values: CephHarvesterAddonFormValues;
  blockDevicesRaw: unknown;
  storageNetwork?: CephStorageNetworkResponse | null;
};

type ConfigFieldItem = {
  label: string;
  value: React.ReactNode;
};

type ConfigFieldGridProps = {
  items: ConfigFieldItem[];
};

const ConfigFieldGrid: React.FC<ConfigFieldGridProps> = ({ items }) => (
  <div style={ADDON_CONFIG_DETAIL_FIELD_GRID_STYLE}>
    {items.map((item) => (
      <div key={item.label}>
        <Typography.Text type="secondary" style={{ display: 'block', fontSize: 13, marginBottom: 4 }}>
          {item.label}
        </Typography.Text>
        <div style={{ fontSize: 14, color: 'rgba(0,0,0,.88)', lineHeight: 1.5 }}>{item.value}</div>
      </div>
    ))}
  </div>
);

type ConfigDetailMetricCardProps = {
  icon: React.ReactNode;
  title: string;
  extra?: React.ReactNode;
  items: ConfigFieldItem[];
};

const ConfigDetailMetricCard: React.FC<ConfigDetailMetricCardProps> = ({
  icon,
  title,
  extra,
  items,
}) => (
  <Card
    size="small"
    title={
      <Space size={8}>
        {icon}
        <span>{title}</span>
      </Space>
    }
    extra={extra}
    style={ADDON_CONFIG_DETAIL_METRIC_CARD_STYLE}
    styles={{
      ...ADDON_CONFIG_DETAIL_CARD_STYLES,
      body: {
        ...ADDON_CONFIG_DETAIL_CARD_STYLES.body,
        ...ADDON_CONFIG_DETAIL_METRIC_CARD_BODY_STYLE,
      },
    }}
  >
    <ConfigFieldGrid items={items} />
  </Card>
);

function boolTag(enabled: boolean, onLabel = '启用', offLabel = '关闭') {
  return (
    <Tag color={enabled ? 'success' : 'default'} style={{ margin: 0 }}>
      {enabled ? onLabel : offLabel}
    </Tag>
  );
}

function clusterLevelExtra() {
  return (
    <Tag color="blue" style={{ margin: 0 }}>
      集群级
    </Tag>
  );
}

const AddonConfigDetailPanel: React.FC<AddonConfigDetailPanelProps> = ({
  values,
  blockDevicesRaw,
  storageNetwork,
}) => {
  const nodeRows = useMemo(() => {
    return (values?.cephCluster?.nodes || [])
      .filter((r) => r?.nodeName && normalizeDeviceNames(r.deviceNames).length > 0)
      .map((r) => {
        const deviceNames = normalizeDeviceNames(r.deviceNames);
        const options = mergeConfiguredBlockDeviceOptions(
          parseBlockDeviceOptions(blockDevicesRaw, r.nodeName),
          deviceNames,
          r.nodeName,
        ).filter((opt) => deviceNames.includes(opt.value));
        return { nodeName: r.nodeName!, devices: options };
      });
  }, [values?.cephCluster?.nodes, blockDevicesRaw]);

  const totalDisks = nodeRows.reduce((sum, row) => sum + row.devices.length, 0);

  const clusterServiceItems = useMemo<ConfigFieldItem[]>(
    () => [
      { label: '管理节点 (MON)', value: values?.cephCluster?.monCount ?? '—' },
      { label: '调度服务 (MGR)', value: values?.cephCluster?.mgrCount ?? '—' },
      {
        label: '内置监控面板',
        value: boolTag(!!values?.cephCluster?.dashboardEnabled),
      },
      { label: '严格副本数校验', value: boolTag(!!values?.requireSafeReplicaSize) },
    ],
    [values?.cephCluster, values?.requireSafeReplicaSize],
  );

  const capacityItems = useMemo<ConfigFieldItem[]>(
    () => [
      { label: '数据副本数', value: values?.replicaSize ?? '—' },
      { label: '数据压缩', value: formatCompressionLabel(values?.compressionMode) },
      {
        label: '磁盘存储引擎',
        value: formatOsdStoreLabel(values?.cephCluster?.osdObjectstore),
      },
      { label: '每盘存储进程数', value: values?.cephCluster?.osdsPerDevice ?? '—' },
    ],
    [values?.replicaSize, values?.compressionMode, values?.cephCluster],
  );

  const volumeBehaviorItems = useMemo<ConfigFieldItem[]>(
    () => [
      { label: '删除云硬盘时', value: formatReclaimLabel(values?.storageClass?.reclaimPolicy) },
      {
        label: '存储空间分配',
        value: formatBindingLabel(values?.storageClass?.volumeBindingMode),
      },
      {
        label: '在线扩容',
        value: boolTag(!!values?.storageClass?.allowVolumeExpansion, '允许', '禁止'),
      },
    ],
    [values?.storageClass],
  );

  const storageNetworkItems = useMemo<ConfigFieldItem[]>(() => {
    if (storageNetwork === undefined) return [];
    const mode = storageNetwork?.mode ?? 'mgmt';
    const config = storageNetwork?.config;
    if (mode !== 'configured' || !config) {
      return [
        {
          label: '网络模式',
          value: (
            <Tag color={storageNetworkModeTagColor('mgmt')} style={{ margin: 0 }}>
              {storageNetworkModeLabel('mgmt')}
            </Tag>
          ),
        },
        { label: 'VLAN', value: '—' },
        { label: '集群网络', value: 'mgmt' },
        { label: 'IP 段', value: '—' },
      ];
    }
    return [
      {
        label: '网络模式',
        value: (
          <Tag color={storageNetworkModeTagColor('configured')} style={{ margin: 0 }}>
            {storageNetworkModeLabel('configured')}
          </Tag>
        ),
      },
      { label: 'VLAN', value: config.vlan },
      { label: '集群网络', value: config.clusterNetwork },
      { label: 'IP 段', value: config.range },
    ];
  }, [storageNetwork]);

  return (
    <div className="harvester-addon-config-detail">
      <Row gutter={[16, 16]}>
        <Col span={24}>
          <Card
            size="small"
            title={
              <Space size={8}>
                <CloudServerOutlined style={{ color: '#1677ff' }} />
                <span>存储拓扑</span>
                {nodeRows.length > 0 ? (
                  <Typography.Text type="secondary" style={{ fontSize: 13, fontWeight: 400 }}>
                    {nodeRows.length} 个节点 · {totalDisks} 块数据盘
                  </Typography.Text>
                ) : null}
              </Space>
            }
            styles={ADDON_CONFIG_DETAIL_CARD_STYLES}
          >
            {nodeRows.length === 0 ? (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="尚未配置存储节点与数据盘" />
            ) : (
              <Row gutter={[12, 12]}>
                {nodeRows.map((row) => (
                  <Col key={row.nodeName} {...ADDON_CONFIG_DETAIL_NODE_COL_PROPS}>
                    <div style={{ ...ADDON_CONFIG_DETAIL_NODE_CARD_STYLE, height: '100%' }}>
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                        padding: '10px 14px',
                        borderBottom: '1px solid #e5e6eb',
                        background: '#f7f8fa',
                      }}
                    >
                      <CloudServerOutlined style={{ color: '#1677ff' }} />
                      <Typography.Text strong style={{ fontSize: 14 }}>
                        {row.nodeName}
                      </Typography.Text>
                      <Tag style={{ margin: 0, marginLeft: 'auto' }}>{row.devices.length} 盘</Tag>
                    </div>
                    <div style={{ padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                      {row.devices.map((opt) => {
                        const pathLabel = opt.devPath || (opt.value ? `/dev/${opt.value}` : opt.value);
                        const driveKind = resolveBlockDeviceDriveKind(opt);
                        const meta = [opt.sizeLabel, opt.model].filter(Boolean).join(' · ');
                        return (
                          <div
                            key={opt.blockDeviceCrName || `${row.nodeName}:${opt.value}`}
                            style={{
                              display: 'flex',
                              alignItems: 'flex-start',
                              gap: 8,
                              padding: '8px 10px',
                              borderRadius: 8,
                              background: '#fafafa',
                              border: '1px solid #eef0f3',
                            }}
                          >
                            <HddOutlined
                              style={{ color: 'rgba(0,0,0,.45)', marginTop: 3, flexShrink: 0 }}
                            />
                            <div style={{ minWidth: 0, flex: 1 }}>
                              <div
                                style={{
                                  display: 'flex',
                                  flexWrap: 'wrap',
                                  alignItems: 'center',
                                  gap: 6,
                                }}
                              >
                                <Typography.Text strong style={{ fontSize: 13 }}>
                                  {pathLabel}
                                </Typography.Text>
                                {driveKind !== 'unknown' ? (
                                  <Tag
                                    color={blockDeviceDriveKindTagColor(driveKind)}
                                    style={{ margin: 0, fontSize: 11, lineHeight: '18px' }}
                                  >
                                    {blockDeviceDriveKindLabel(driveKind)}
                                  </Tag>
                                ) : null}
                              </div>
                              {meta ? (
                                <Typography.Text
                                  type="secondary"
                                  style={{ fontSize: 12, display: 'block', marginTop: 2 }}
                                >
                                  {meta}
                                </Typography.Text>
                              ) : null}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                    </div>
                  </Col>
                ))}
              </Row>
            )}
          </Card>
        </Col>

        <Col xs={24} lg={12} style={ADDON_CONFIG_DETAIL_METRIC_COL_STYLE}>
          <ConfigDetailMetricCard
            icon={<ClusterOutlined style={{ color: '#1677ff' }} />}
            title="集群服务"
            extra={clusterLevelExtra()}
            items={clusterServiceItems}
          />
        </Col>

        <Col xs={24} lg={12} style={ADDON_CONFIG_DETAIL_METRIC_COL_STYLE}>
          <ConfigDetailMetricCard
            icon={<DatabaseOutlined style={{ color: '#1677ff' }} />}
            title="容量与策略"
            extra={clusterLevelExtra()}
            items={capacityItems}
          />
        </Col>

        <Col xs={24} lg={12} style={ADDON_CONFIG_DETAIL_METRIC_COL_STYLE}>
          <ConfigDetailMetricCard
            icon={<HddOutlined style={{ color: '#1677ff' }} />}
            title="云硬盘行为"
            items={volumeBehaviorItems}
          />
        </Col>

        {storageNetwork !== undefined ? (
          <Col xs={24} lg={12} style={ADDON_CONFIG_DETAIL_METRIC_COL_STYLE}>
            <ConfigDetailMetricCard
              icon={<GlobalOutlined style={{ color: '#1677ff' }} />}
              title="专用存储网"
              items={storageNetworkItems}
            />
          </Col>
        ) : null}
      </Row>
    </div>
  );
};

export default AddonConfigDetailPanel;
