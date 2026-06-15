/**
 * 统一存储 Addon 状态 Hero（运行状态、统计与部署进度）。
 */
import React, { useMemo } from 'react';
import { Col, Progress, Row, Skeleton, Tag, Typography } from 'antd';
import {
  CheckCircleOutlined,
  ClockCircleOutlined,
  CloseCircleOutlined,
  CloudServerOutlined,
  ClusterOutlined,
  DatabaseOutlined,
  ExclamationCircleOutlined,
  HddOutlined,
  NodeIndexOutlined,
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

type PhaseVisual = {
  tagColor: string;
  tagLabel: string;
  icon: React.ReactNode;
  heroGradient: string;
  accent: string;
  watermarkColor: string;
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

function phaseVisual(
  phase: CephHarvesterAddonStatusResponse['phase'] | undefined,
  isRunningCluster: boolean,
): PhaseVisual {
  switch (phase) {
    case 'success':
      return {
        tagColor: 'success',
        tagLabel: isRunningCluster ? '运行中' : '已就绪',
        icon: <CheckCircleOutlined />,
        heroGradient: 'linear-gradient(135deg, #0b3d5c 0%, #1677ff 52%, #69b1ff 100%)',
        accent: '#bae0ff',
        watermarkColor: 'rgba(255,255,255,0.12)',
      };
    case 'progress':
      return {
        tagColor: 'processing',
        tagLabel: '部署中',
        icon: <ClockCircleOutlined />,
        heroGradient: 'linear-gradient(135deg, #102a43 0%, #1677ff 48%, #4096ff 100%)',
        accent: '#91caff',
        watermarkColor: 'rgba(255,255,255,0.1)',
      };
    case 'failed':
      return {
        tagColor: 'error',
        tagLabel: '部署失败',
        icon: <CloseCircleOutlined />,
        heroGradient: 'linear-gradient(135deg, #3b1414 0%, #cf1322 55%, #ff7875 100%)',
        accent: '#ffccc7',
        watermarkColor: 'rgba(255,255,255,0.1)',
      };
    case 'not_installed':
      return {
        tagColor: 'warning',
        tagLabel: '未开启',
        icon: <ExclamationCircleOutlined />,
        heroGradient: 'linear-gradient(135deg, #2b2111 0%, #d48806 52%, #ffd666 100%)',
        accent: '#ffe58f',
        watermarkColor: 'rgba(255,255,255,0.12)',
      };
    case 'disabled':
      return {
        tagColor: 'warning',
        tagLabel: '已停用',
        icon: <ExclamationCircleOutlined />,
        heroGradient: 'linear-gradient(135deg, #1f1f1f 0%, #595959 55%, #8c8c8c 100%)',
        accent: '#d9d9d9',
        watermarkColor: 'rgba(255,255,255,0.08)',
      };
    default:
      return {
        tagColor: 'default',
        tagLabel: '未知',
        icon: <ExclamationCircleOutlined />,
        heroGradient: 'linear-gradient(135deg, #141414 0%, #434343 55%, #737373 100%)',
        accent: '#bfbfbf',
        watermarkColor: 'rgba(255,255,255,0.08)',
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

const statTileStyle: React.CSSProperties = {
  minWidth: 108,
  padding: '10px 14px',
  borderRadius: 10,
  background: 'rgba(255,255,255,0.14)',
  border: '1px solid rgba(255,255,255,0.22)',
  backdropFilter: 'blur(6px)',
};

type HeroStatTileProps = {
  label: string;
  value: React.ReactNode;
  icon: React.ReactNode;
  valueFontSize?: number;
};

const HeroStatTile: React.FC<HeroStatTileProps> = ({
  label,
  value,
  icon,
  valueFontSize = 24,
}) => (
  <div style={statTileStyle}>
    <Typography.Text style={{ color: 'rgba(255,255,255,0.72)', fontSize: 12 }}>{label}</Typography.Text>
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
      {icon}
      <span style={{ color: '#fff', fontSize: valueFontSize, fontWeight: 600, lineHeight: 1 }}>{value}</span>
    </div>
  </div>
);

const AddonStatusOverview: React.FC<AddonStatusOverviewProps> = ({
  status,
  loading,
  isRunningCluster,
}) => {
  const showLiveStats = isRunningCluster;
  const stats = useMemo(() => countConfigStats(status?.config), [status?.config]);
  const visual = phaseVisual(status?.phase, isRunningCluster);
  const message = resolveStatusMessage(status, loading, isRunningCluster);
  const lockedNodes = baselineNodeNameSet(status?.config ?? null).size;
  const lockedDisks = baselineNodeDeviceKeySet(status?.config ?? null).size;
  const nodeCount = showLiveStats ? stats.nodeCount || lockedNodes || 0 : 0;
  const diskCount = showLiveStats ? stats.diskCount || lockedDisks || 0 : 0;
  const replicaSize = showLiveStats ? status?.config?.replicaSize ?? 0 : 0;
  const monCount = showLiveStats ? status?.config?.cephCluster?.monCount ?? 0 : 0;
  const mgrCount = showLiveStats ? status?.config?.cephCluster?.mgrCount ?? 0 : 0;

  if (loading && !status) {
    return (
      <div
        className="ceph-addon-status-hero ceph-addon-status-hero--loading"
        style={{ marginBottom: 20 }}
      >
        <Skeleton active paragraph={{ rows: 2 }} />
      </div>
    );
  }

  return (
    <div
      className="ceph-addon-status-hero"
      style={{
        marginBottom: 20,
        borderRadius: 12,
        overflow: 'hidden',
        background: visual.heroGradient,
        boxShadow: '0 8px 24px rgba(22, 119, 255, 0.18)',
        position: 'relative',
      }}
    >
      <DatabaseOutlined
        aria-hidden
        style={{
          position: 'absolute',
          right: 24,
          top: '50%',
          transform: 'translateY(-50%)',
          fontSize: 120,
          color: visual.watermarkColor,
          pointerEvents: 'none',
        }}
      />
      <div style={{ padding: '22px 24px 20px', position: 'relative', zIndex: 1 }}>
        <Row gutter={[24, 20]} align="middle">
          <Col xs={24} xl={showLiveStats ? 14 : 24}>
            <div style={{ maxWidth: 640 }}>
              <Typography.Text
                style={{
                  display: 'block',
                  color: visual.accent,
                  fontSize: 12,
                  letterSpacing: '0.08em',
                  textTransform: 'uppercase',
                  marginBottom: 8,
                  fontWeight: 600,
                }}
              >
                Unified Storage
              </Typography.Text>
              <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                <Typography.Title level={3} style={{ margin: 0, color: '#fff', fontWeight: 600 }}>
                  统一存储
                </Typography.Title>
                <Tag icon={visual.icon} color={visual.tagColor} style={{ margin: 0, border: 'none' }}>
                  {visual.tagLabel}
                </Tag>
                {status?.deployStatus ? (
                  <Tag style={{ margin: 0, background: 'rgba(255,255,255,0.18)', color: '#fff', border: 'none' }}>
                    {status.deployStatus}
                  </Tag>
                ) : null}
              </div>
              <Typography.Paragraph
                style={{
                  margin: 0,
                  color: 'rgba(255,255,255,0.88)',
                  fontSize: 14,
                  lineHeight: 1.65,
                  maxWidth: 560,
                }}
              >
                {message}
              </Typography.Paragraph>
            </div>
          </Col>
          {showLiveStats ? (
            <Col xs={24} xl={10}>
              <div
                style={{
                  display: 'flex',
                  flexWrap: 'wrap',
                  gap: 12,
                  justifyContent: 'flex-start',
                }}
              >
                <HeroStatTile
                  label="存储节点"
                  value={nodeCount}
                  icon={<CloudServerOutlined style={{ color: '#fff', fontSize: 16, opacity: 0.85 }} />}
                />
                <HeroStatTile
                  label="数据盘"
                  value={diskCount}
                  icon={<HddOutlined style={{ color: '#fff', fontSize: 16, opacity: 0.85 }} />}
                />
                <HeroStatTile
                  label="数据副本"
                  value={replicaSize}
                  icon={<DatabaseOutlined style={{ color: '#fff', fontSize: 16, opacity: 0.85 }} />}
                />
                <HeroStatTile
                  label="MON 节点"
                  value={monCount}
                  icon={<ClusterOutlined style={{ color: '#fff', fontSize: 16, opacity: 0.85 }} />}
                />
                <HeroStatTile
                  label="MGR 服务"
                  value={mgrCount}
                  icon={<NodeIndexOutlined style={{ color: '#fff', fontSize: 16, opacity: 0.85 }} />}
                />
              </div>
            </Col>
          ) : null}
        </Row>
        {status?.phase === 'progress' ? (
          <Progress
            percent={99}
            status="active"
            showInfo={false}
            strokeColor={{ from: '#ffffff', to: 'rgba(255,255,255,0.65)' }}
            trailColor="rgba(255,255,255,0.18)"
            style={{ marginTop: 18, marginBottom: 0 }}
          />
        ) : null}
      </div>
    </div>
  );
};

export default AddonStatusOverview;
