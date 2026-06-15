/**
 * 集群网络 Hero（ClusterNetwork / NAD / LB / IP 池概览）。
 */
import React from 'react';
import { Col, Row, Skeleton, Typography } from 'antd';
import {
  ApiOutlined,
  ClusterOutlined,
  DeploymentUnitOutlined,
  PartitionOutlined,
} from '@ant-design/icons';

export type PlatformNetworkHeroStats = {
  clusterNetworkCount: number;
  nadCount: number;
  loadBalancerCount: number;
  ipPoolCount: number;
};

type PlatformNetworkStatusHeroProps = {
  loading: boolean;
  stats: PlatformNetworkHeroStats;
};

const statTileStyle: React.CSSProperties = {
  minWidth: 108,
  padding: '10px 14px',
  borderRadius: 10,
  background: 'rgba(255,255,255,0.14)',
  border: '1px solid rgba(255,255,255,0.22)',
  backdropFilter: 'blur(6px)',
};

const PlatformNetworkStatusHero: React.FC<PlatformNetworkStatusHeroProps> = ({ loading, stats }) => {
  if (loading) {
    return (
      <div className="platform-network-status-hero platform-network-status-hero--loading" style={{ marginBottom: 20 }}>
        <Skeleton active paragraph={{ rows: 2 }} />
      </div>
    );
  }

  return (
    <div
      className="platform-network-status-hero"
      style={{
        marginBottom: 20,
        borderRadius: 12,
        overflow: 'hidden',
        background: 'linear-gradient(135deg, #1a1033 0%, #531dab 48%, #b37feb 100%)',
        boxShadow: '0 8px 24px rgba(83, 29, 171, 0.18)',
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
                  color: '#efdbff',
                  fontSize: 12,
                  letterSpacing: '0.08em',
                  textTransform: 'uppercase',
                  marginBottom: 8,
                  fontWeight: 600,
                }}
              >
                Platform Network
              </Typography.Text>
              <Typography.Title level={3} style={{ margin: '0 0 10px', color: '#fff', fontWeight: 600 }}>
                集群网络
              </Typography.Title>
              <Typography.Paragraph
                style={{
                  margin: 0,
                  color: 'rgba(255,255,255,0.88)',
                  fontSize: 14,
                  lineHeight: 1.65,
                  maxWidth: 560,
                }}
              >
                管理 Harvester 集群网络、NAD 附件、负载均衡与 IP 地址池，支撑虚拟机与容器网络编排。
              </Typography.Paragraph>
            </div>
          </Col>
          <Col xs={24} xl={10}>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
              <div style={statTileStyle}>
                <Typography.Text style={{ color: 'rgba(255,255,255,0.72)', fontSize: 12 }}>
                  集群网络
                </Typography.Text>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
                  <ClusterOutlined style={{ color: '#fff', fontSize: 16, opacity: 0.85 }} />
                  <span style={{ color: '#fff', fontSize: 24, fontWeight: 600, lineHeight: 1 }}>
                    {stats.clusterNetworkCount}
                  </span>
                </div>
              </div>
              <div style={statTileStyle}>
                <Typography.Text style={{ color: 'rgba(255,255,255,0.72)', fontSize: 12 }}>
                  NAD 网络
                </Typography.Text>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
                  <DeploymentUnitOutlined style={{ color: '#fff', fontSize: 16, opacity: 0.85 }} />
                  <span style={{ color: '#fff', fontSize: 24, fontWeight: 600, lineHeight: 1 }}>
                    {stats.nadCount}
                  </span>
                </div>
              </div>
              <div style={statTileStyle}>
                <Typography.Text style={{ color: 'rgba(255,255,255,0.72)', fontSize: 12 }}>
                  负载均衡
                </Typography.Text>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
                  <ApiOutlined style={{ color: '#fff', fontSize: 16, opacity: 0.85 }} />
                  <span style={{ color: '#fff', fontSize: 24, fontWeight: 600, lineHeight: 1 }}>
                    {stats.loadBalancerCount}
                  </span>
                </div>
              </div>
              <div style={statTileStyle}>
                <Typography.Text style={{ color: 'rgba(255,255,255,0.72)', fontSize: 12 }}>
                  IP 地址池
                </Typography.Text>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
                  <PartitionOutlined style={{ color: '#fff', fontSize: 16, opacity: 0.85 }} />
                  <span style={{ color: '#fff', fontSize: 24, fontWeight: 600, lineHeight: 1 }}>
                    {stats.ipPoolCount}
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

export default PlatformNetworkStatusHero;
