/**
 * 统一存储 Addon 状态概览（运行状态、统计与部署进度）。
 */
import React, { useMemo } from 'react';
import { Badge, Card, Col, Progress, Row, Skeleton, Space, Statistic, Tag, Typography } from 'antd';
import {
  CheckCircleOutlined,
  ClockCircleOutlined,
  CloseCircleOutlined,
  CloudServerOutlined,
  DatabaseOutlined,
  ExclamationCircleOutlined,
  HddOutlined,
} from '@ant-design/icons';
import type { CephHarvesterAddonStatusResponse } from '../../../../../../../services/cephApi';
import {
  baselineNodeDeviceKeySet,
  baselineNodeNameSet,
  listConfiguredNodeDevices,
  type CephHarvesterAddonValuesConfig,
} from '../../lib/cephHarvesterAddon';

type AddonStatusOverviewProps = {
  status: CephHarvesterAddonStatusResponse | null;
  loading: boolean;
  isRunningCluster: boolean;
};

function countConfigStats(config: CephHarvesterAddonValuesConfig | null | undefined): {
  nodeCount: number;
  diskCount: number;
} {
  const rows = listConfiguredNodeDevices(config);
  return {
    nodeCount: new Set(rows.map((r) => r.nodeName)).size,
    diskCount: rows.length,
  };
}

function phaseMeta(
  phase: CephHarvesterAddonStatusResponse['phase'] | undefined,
  isRunningCluster: boolean,
): {
  badge: 'success' | 'processing' | 'error' | 'warning' | 'default';
  tagColor: string;
  tagLabel: string;
  icon: React.ReactNode;
} {
  switch (phase) {
    case 'success':
      return {
        badge: 'success',
        tagColor: 'success',
        tagLabel: isRunningCluster ? '运行中' : '已就绪',
        icon: <CheckCircleOutlined />,
      };
    case 'progress':
      return {
        badge: 'processing',
        tagColor: 'processing',
        tagLabel: '部署中',
        icon: <ClockCircleOutlined />,
      };
    case 'failed':
      return {
        badge: 'error',
        tagColor: 'error',
        tagLabel: '部署失败',
        icon: <CloseCircleOutlined />,
      };
    case 'not_installed':
      return {
        badge: 'warning',
        tagColor: 'warning',
        tagLabel: '未开启',
        icon: <ExclamationCircleOutlined />,
      };
    case 'disabled':
      return {
        badge: 'warning',
        tagColor: 'warning',
        tagLabel: '已停用',
        icon: <ExclamationCircleOutlined />,
      };
    default:
      return {
        badge: 'default',
        tagColor: 'default',
        tagLabel: '未知',
        icon: <ExclamationCircleOutlined />,
      };
  }
}

function resolveStatusMessage(
  status: CephHarvesterAddonStatusResponse | null,
  loading: boolean,
  isRunningCluster: boolean,
): string {
  if (loading && !status) return '正在获取统一存储状态…';
  if (!status) return '无法读取统一存储状态，请刷新后重试';
  if (status.phase === 'progress') {
    return status.message || '正在部署统一存储，通常需要数分钟，页面将自动刷新进度';
  }
  if (status.phase === 'failed') {
    return status.message || '部署失败，请检查集群事件或修正配置后重试';
  }
  if (status.phase === 'success') {
    return isRunningCluster
      ? '统一存储已就绪。集群级参数已锁定，可在下方扩容新增节点或数据盘。'
      : status.message || '统一存储已就绪';
  }
  if (status.phase === 'disabled') {
    return (
      status.message ||
      '统一存储已停用。若集群内存储已卸载，请在本页按向导重新开启；必要时可在集群侧清理后全新部署。'
    );
  }
  if (status.phase === 'not_installed') {
    return status.message || '尚未开启统一存储，请按向导完成配置并提交';
  }
  return status.message || '统一存储状态未知';
}

const AddonStatusOverview: React.FC<AddonStatusOverviewProps> = ({
  status,
  loading,
  isRunningCluster,
}) => {
  /** 仅「运行中」展示 Addon values 内历史配置；停用/未安装等不计入（避免误导为当前集群规模） */
  const showLiveStats = isRunningCluster;
  const stats = useMemo(() => countConfigStats(status?.config), [status?.config]);
  const meta = phaseMeta(status?.phase, isRunningCluster);
  const message = resolveStatusMessage(status, loading, isRunningCluster);
  const lockedNodes = baselineNodeNameSet(status?.config ?? null).size;
  const lockedDisks = baselineNodeDeviceKeySet(status?.config ?? null).size;
  const nodeCount = showLiveStats ? stats.nodeCount || lockedNodes || 0 : 0;
  const diskCount = showLiveStats ? stats.diskCount || lockedDisks || 0 : 0;
  const replicaSize = showLiveStats ? status?.config?.replicaSize ?? 0 : 0;

  if (loading && !status) {
    return (
      <Card size="small" style={{ marginBottom: 20 }}>
        <Skeleton active paragraph={{ rows: 2 }} />
      </Card>
    );
  }

  return (
    <Card size="small" style={{ marginBottom: 20 }} styles={{ body: { padding: '16px 20px' } }}>
      <Row gutter={[24, 16]} align="middle">
        <Col xs={24} lg={14}>
          <Space align="start" size={12}>
            <Badge status={meta.badge} />
            <div>
              <Space wrap size={8} style={{ marginBottom: 4 }}>
                <Typography.Title level={5} style={{ margin: 0 }}>
                  统一存储
                </Typography.Title>
                <Tag icon={meta.icon} color={meta.tagColor} style={{ margin: 0 }}>
                  {meta.tagLabel}
                </Tag>
                {status?.deployStatus ? (
                  <Tag style={{ margin: 0 }}>{status.deployStatus}</Tag>
                ) : null}
              </Space>
              <Typography.Text type="secondary" style={{ display: 'block', lineHeight: 1.6 }}>
                {message}
              </Typography.Text>
            </div>
          </Space>
        </Col>
        <Col xs={24} lg={10}>
          <Row gutter={16} justify={{ xs: 'start', lg: 'end' }}>
            <Col>
              <Statistic
                title="存储节点"
                value={nodeCount}
                prefix={<CloudServerOutlined style={{ fontSize: 14, opacity: 0.45 }} />}
                valueStyle={{ fontSize: 20 }}
              />
            </Col>
            <Col>
              <Statistic
                title="数据盘"
                value={diskCount}
                prefix={<HddOutlined style={{ fontSize: 14, opacity: 0.45 }} />}
                valueStyle={{ fontSize: 20 }}
              />
            </Col>
            <Col>
              <Statistic
                title="数据副本"
                value={replicaSize}
                prefix={<DatabaseOutlined style={{ fontSize: 14, opacity: 0.45 }} />}
                valueStyle={{ fontSize: 20 }}
              />
            </Col>
          </Row>
        </Col>
      </Row>
      {status?.phase === 'progress' ? (
        <Progress
          percent={99}
          status="active"
          showInfo={false}
          strokeColor={{ from: '#1677ff', to: '#69b1ff' }}
          style={{ marginTop: 16, marginBottom: 0 }}
        />
      ) : null}
    </Card>
  );
};

export default AddonStatusOverview;
