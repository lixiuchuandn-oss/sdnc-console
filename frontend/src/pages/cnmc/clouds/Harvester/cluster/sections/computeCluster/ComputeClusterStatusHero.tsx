/**
 * 计算配置 Hero（节点 / 故障域 / DRS / 迁移概览）。
 */
import React from 'react';
import { Col, Row, Skeleton, Typography } from 'antd';
import {
  ApartmentOutlined,
  CloudServerOutlined,
  ClusterOutlined,
  DeploymentUnitOutlined,
  SwapOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons';

export type ComputeClusterHeroStats = {
  nodeCount: number;
  failureDomainCount: number;
  deploymentSetCount: number;
  drsRuleCount: number;
  migrationCount: number;
  enabledDrsRuleCount?: number;
  runningMigrationCount?: number;
};

type ComputeClusterStatusHeroProps = {
  loading: boolean;
  stats: ComputeClusterHeroStats;
};

const statTileStyle: React.CSSProperties = {
  minWidth: 108,
  padding: '10px 14px',
  borderRadius: 10,
  background: 'rgba(255,255,255,0.14)',
  border: '1px solid rgba(255,255,255,0.22)',
  backdropFilter: 'blur(6px)',
};

const ComputeClusterStatusHero: React.FC<ComputeClusterStatusHeroProps> = ({ loading, stats }) => {
  if (loading) {
    return (
      <div className="compute-cluster-status-hero compute-cluster-status-hero--loading" style={{ marginBottom: 20 }}>
        <Skeleton active paragraph={{ rows: 2 }} />
      </div>
    );
  }

  return (
    <div
      className="compute-cluster-status-hero"
      style={{
        marginBottom: 20,
        borderRadius: 12,
        overflow: 'hidden',
        background: 'linear-gradient(135deg, #0f2d1f 0%, #237804 48%, #73d13d 100%)',
        boxShadow: '0 8px 24px rgba(35, 120, 4, 0.18)',
        position: 'relative',
      }}
    >
      <ClusterOutlined
        aria-hidden
        style={{
          position: 'absolute',
          right: 24,
          top: '50%',
          transform: 'translateY(-50%)',
          fontSize: 120,
          color: 'rgba(255,255,255,0.12)',
          pointerEvents: 'none',
        }}
      />
      <div style={{ padding: '22px 24px 20px', position: 'relative', zIndex: 1 }}>
        <Row gutter={[24, 20]} align="middle">
          <Col xs={24} xl={14}>
            <div style={{ maxWidth: 640 }}>
              <Typography.Text
                style={{
                  display: 'block',
                  color: '#b7eb8f',
                  fontSize: 12,
                  letterSpacing: '0.08em',
                  textTransform: 'uppercase',
                  marginBottom: 8,
                  fontWeight: 600,
                }}
              >
                Compute Cluster
              </Typography.Text>
              <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                <Typography.Title level={3} style={{ margin: 0, color: '#fff', fontWeight: 600 }}>
                  计算配置
                </Typography.Title>
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
                管理物理计算节点、故障域划分、虚拟机部署集、CDRS 调度规则与 DRS 触发的迁移记录。
              </Typography.Paragraph>
            </div>
          </Col>
          <Col xs={24} xl={10}>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
              <div style={statTileStyle}>
                <Typography.Text style={{ color: 'rgba(255,255,255,0.72)', fontSize: 12 }}>
                  计算节点
                </Typography.Text>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
                  <CloudServerOutlined style={{ color: '#fff', fontSize: 16, opacity: 0.85 }} />
                  <span style={{ color: '#fff', fontSize: 24, fontWeight: 600, lineHeight: 1 }}>
                    {stats.nodeCount}
                  </span>
                </div>
              </div>
              <div style={statTileStyle}>
                <Typography.Text style={{ color: 'rgba(255,255,255,0.72)', fontSize: 12 }}>
                  故障域
                </Typography.Text>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
                  <ApartmentOutlined style={{ color: '#fff', fontSize: 16, opacity: 0.85 }} />
                  <span style={{ color: '#fff', fontSize: 24, fontWeight: 600, lineHeight: 1 }}>
                    {stats.failureDomainCount}
                  </span>
                </div>
              </div>
              <div style={statTileStyle}>
                <Typography.Text style={{ color: 'rgba(255,255,255,0.72)', fontSize: 12 }}>
                  部署集
                </Typography.Text>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
                  <DeploymentUnitOutlined style={{ color: '#fff', fontSize: 16, opacity: 0.85 }} />
                  <span style={{ color: '#fff', fontSize: 24, fontWeight: 600, lineHeight: 1 }}>
                    {stats.deploymentSetCount}
                  </span>
                </div>
              </div>
              <div style={statTileStyle}>
                <Typography.Text style={{ color: 'rgba(255,255,255,0.72)', fontSize: 12 }}>
                  DRS 规则
                </Typography.Text>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
                  <ThunderboltOutlined style={{ color: '#fff', fontSize: 16, opacity: 0.85 }} />
                  <span style={{ color: '#fff', fontSize: 24, fontWeight: 600, lineHeight: 1 }}>
                    {stats.drsRuleCount}
                  </span>
                </div>
              </div>
              <div style={statTileStyle}>
                <Typography.Text style={{ color: 'rgba(255,255,255,0.72)', fontSize: 12 }}>
                  迁移记录
                </Typography.Text>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
                  <SwapOutlined style={{ color: '#fff', fontSize: 16, opacity: 0.85 }} />
                  <span style={{ color: '#fff', fontSize: 24, fontWeight: 600, lineHeight: 1 }}>
                    {stats.migrationCount}
                  </span>
                </div>
              </div>
            </div>
          </Col>
        </Row>
      </div>
    </div>
  );
};

export default ComputeClusterStatusHero;
