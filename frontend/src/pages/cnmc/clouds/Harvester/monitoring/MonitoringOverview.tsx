/**
 * 监控服务 - 概览（资源大盘）
 * 设计文档：plan/设计-监控服务-概览.md
 * 参考：Compute.Tower-Monitoring Dashboard 布局与交互
 */
import React from 'react';
import { Row, Col, Alert } from 'antd';
import { DashboardProviders } from './DashboardContext';
import { AlertsCard } from './components/AlertsCard';
import { CPUCard } from './components/CPUCard';
import { MemoryCard } from './components/MemoryCard';
import { StorageCard } from './components/StorageCard';
import { HostsCard } from './components/HostsCard';
import { DiskCard } from './components/DiskCard';
import { VMCard } from './components/VMCard';

const ROW1_HEIGHT = 380;
const ROW2_HEIGHT = 300;

interface MonitoringOverviewProps {
  cloudId: string;
}
 
const MonitoringOverview: React.FC<MonitoringOverviewProps> = ({ cloudId }) => {
  if (!cloudId) {
    return (
      <div>
        <Alert type="warning" message="缺少云资源 ID，无法加载概览" />
      </div>
    );
  }

  return (
    <div>
      <DashboardProviders cloudId={cloudId}>
        {/* 第一行：告警 | CPU+内存 | 储存空间 */}
        <Row gutter={[16, 16]} style={{ marginBottom: 20, alignItems: 'stretch' }}>
          <Col xs={24} lg={10} style={{ display: 'flex' }}>
            <div style={{ height: ROW1_HEIGHT, display: 'flex', flexDirection: 'column', width: '100%' }}>
              <AlertsCard />
            </div>
          </Col>
          <Col xs={24} lg={7} style={{ display: 'flex' }}>
            <div style={{ height: ROW1_HEIGHT, display: 'flex', flexDirection: 'column', gap: 12, width: '100%' }}>
              <div style={{ flex: '0 0 auto', minHeight: 0, display: 'flex', flexDirection: 'column', maxHeight: '52%' }}>
                <CPUCard />
              </div>
              <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
                <MemoryCard />
              </div>
            </div>
          </Col>
          <Col xs={24} lg={7} style={{ display: 'flex' }}>
            <div style={{ height: ROW1_HEIGHT, display: 'flex', flexDirection: 'column', width: '100%' }}>
              <StorageCard />
            </div>
          </Col>
        </Row>

        {/* 第二行：物理主机 | 磁盘 | 虚拟机 */}
        <Row gutter={[16, 16]} style={{ alignItems: 'stretch' }}>
          <Col xs={24} md={12} lg={8} style={{ display: 'flex' }}>
            <div style={{ height: ROW2_HEIGHT, display: 'flex', flexDirection: 'column', width: '100%' }}>
              <HostsCard />
            </div>
          </Col>
          <Col xs={24} md={12} lg={8} style={{ display: 'flex' }}>
            <div style={{ height: ROW2_HEIGHT, display: 'flex', flexDirection: 'column', width: '100%' }}>
              <DiskCard />
            </div>
          </Col>
          <Col xs={24} md={24} lg={8} style={{ display: 'flex' }}>
            <div style={{ height: ROW2_HEIGHT, display: 'flex', flexDirection: 'column', width: '100%' }}>
              <VMCard />
            </div>
          </Col>
        </Row>
      </DashboardProviders>
    </div>
  );
};

export default MonitoringOverview;
