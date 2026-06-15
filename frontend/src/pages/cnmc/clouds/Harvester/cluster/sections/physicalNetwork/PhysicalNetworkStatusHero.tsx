/**
 * 物理网络 Hero（交换机 / Provider / 公共子网 / VLAN 概览）。
 */
import React from 'react';
import { Col, Row, Skeleton, Typography } from 'antd';
import { ApartmentOutlined, GlobalOutlined, PartitionOutlined } from '@ant-design/icons';

export type PhysicalNetworkHeroStats = {
  providerNetworkCount: number;
  publicSubnetCount: number;
  vlanCount: number;
};

type PhysicalNetworkStatusHeroProps = {
  loading: boolean;
  stats: PhysicalNetworkHeroStats;
};

const statTileStyle: React.CSSProperties = {
  minWidth: 108,
  padding: '10px 14px',
  borderRadius: 10,
  background: 'rgba(255,255,255,0.14)',
  border: '1px solid rgba(255,255,255,0.22)',
  backdropFilter: 'blur(6px)',
};

const PhysicalNetworkStatusHero: React.FC<PhysicalNetworkStatusHeroProps> = ({ loading, stats }) => {
  if (loading) {
    return (
      <div className="physical-network-status-hero physical-network-status-hero--loading" style={{ marginBottom: 20 }}>
        <Skeleton active paragraph={{ rows: 2 }} />
      </div>
    );
  }

  return (
    <div
      className="physical-network-status-hero"
      style={{
        marginBottom: 20,
        borderRadius: 12,
        overflow: 'hidden',
        background: 'linear-gradient(135deg, #0f1f3d 0%, #1677ff 48%, #69b1ff 100%)',
        boxShadow: '0 8px 24px rgba(22, 119, 255, 0.18)',
        position: 'relative',
      }}
    >
      <GlobalOutlined
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
                  color: '#bae0ff',
                  fontSize: 12,
                  letterSpacing: '0.08em',
                  textTransform: 'uppercase',
                  marginBottom: 8,
                  fontWeight: 600,
                }}
              >
                Underlay Network
              </Typography.Text>
              <Typography.Title level={3} style={{ margin: '0 0 10px', color: '#fff', fontWeight: 600 }}>
                物理网络
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
                管理物理接入交换机、Kube-OVN Provider 网络、公共子网与 VLAN，为集群底层网络提供统一入口。
              </Typography.Paragraph>
            </div>
          </Col>
          <Col xs={24} xl={10}>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
              <div style={statTileStyle}>
                <Typography.Text style={{ color: 'rgba(255,255,255,0.72)', fontSize: 12 }}>
                  物理网络
                </Typography.Text>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
                  <GlobalOutlined style={{ color: '#fff', fontSize: 16, opacity: 0.85 }} />
                  <span style={{ color: '#fff', fontSize: 24, fontWeight: 600, lineHeight: 1 }}>
                    {stats.providerNetworkCount}
                  </span>
                </div>
              </div>
              <div style={statTileStyle}>
                <Typography.Text style={{ color: 'rgba(255,255,255,0.72)', fontSize: 12 }}>
                  公共子网
                </Typography.Text>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
                  <ApartmentOutlined style={{ color: '#fff', fontSize: 16, opacity: 0.85 }} />
                  <span style={{ color: '#fff', fontSize: 24, fontWeight: 600, lineHeight: 1 }}>
                    {stats.publicSubnetCount}
                  </span>
                </div>
              </div>
              <div style={statTileStyle}>
                <Typography.Text style={{ color: 'rgba(255,255,255,0.72)', fontSize: 12 }}>
                  VLAN
                </Typography.Text>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
                  <PartitionOutlined style={{ color: '#fff', fontSize: 16, opacity: 0.85 }} />
                  <span style={{ color: '#fff', fontSize: 24, fontWeight: 600, lineHeight: 1 }}>
                    {stats.vlanCount}
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

export default PhysicalNetworkStatusHero;
