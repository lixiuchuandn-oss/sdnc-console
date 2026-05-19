/**
 * 监控服务 - 概览（资源大盘）Tab 主体
 * 设计文档：plan/设计-监控服务-概览.md
 * 参考：Compute.Tower-Monitoring Dashboard 布局与交互
 *
 * 落位：`monitoring/sections/`（Harvester 域内 Tab 区块与 ecs/kube-ovn 等一致）
 */
import React from 'react';
import { Row, Col, Alert } from 'antd';
import { MonitoringOverviewLanesProvider } from '../MonitoringOverviewLanesContext';
import { AlertsCard } from '../components/AlertsCard';
import { CPUCard } from '../components/CPUCard';
import { MemoryCard } from '../components/MemoryCard';
import { StorageCard } from '../components/StorageCard';
import { HostsCard } from '../components/HostsCard';
import { DiskCard } from '../components/DiskCard';
import { VMCard } from '../components/VMCard';

/** 概览卡片之间横、纵间距统一（与 Ant Design Row gutter 一致） */
const CARD_GAP = 16;

/**
 * 两行按 60% / 40% 分配剩余视口高度（扣除顶栏/侧栏/Tab 等，与同资源总览内拓扑面板常用的 calc 对齐）。
 * minHeight 避免极小窗口下网格塌成 0。
 */
const OVERVIEW_GRID_STYLE: React.CSSProperties = {
  display: 'grid',
  gridTemplateRows: 'minmax(0, 3fr) minmax(0, 2fr)',
  gap: CARD_GAP,
  height: 'calc(100vh - 180px)',
  minHeight: 360,
  boxSizing: 'border-box',
};

const ROW_STRETCH_STYLE: React.CSSProperties = {
  alignItems: 'stretch',
  height: '100%',
  minHeight: 0,
};

const COL_FILL_STYLE: React.CSSProperties = {
  display: 'flex',
  minHeight: 0,
  height: '100%',
};

const CARD_COLUMN_FILL_STYLE: React.CSSProperties = {
  flex: 1,
  minHeight: 0,
  display: 'flex',
  flexDirection: 'column',
  width: '100%',
};

interface MonitoringOverviewSectionProps {
  cloudId: string;
}

const MonitoringOverviewSection: React.FC<MonitoringOverviewSectionProps> = ({ cloudId }) => {
  if (!cloudId) {
    return (
      <div>
        <Alert type="warning" message="缺少云资源 ID，无法加载概览" />
      </div>
    );
  }

  return (
    <MonitoringOverviewLanesProvider cloudId={cloudId}>
      <div style={OVERVIEW_GRID_STYLE}>
        <Row gutter={[CARD_GAP, CARD_GAP]} style={ROW_STRETCH_STYLE}>
          <Col xs={24} lg={10} style={COL_FILL_STYLE}>
            <div style={CARD_COLUMN_FILL_STYLE}>
              <AlertsCard />
            </div>
          </Col>
          <Col xs={24} lg={7} style={COL_FILL_STYLE}>
            <div style={{ ...CARD_COLUMN_FILL_STYLE, gap: CARD_GAP }}>
              <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
                <CPUCard />
              </div>
              <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
                <MemoryCard />
              </div>
            </div>
          </Col>
          <Col xs={24} lg={7} style={COL_FILL_STYLE}>
            <div style={CARD_COLUMN_FILL_STYLE}>
              <StorageCard />
            </div>
          </Col>
        </Row>

        <Row gutter={[CARD_GAP, CARD_GAP]} style={ROW_STRETCH_STYLE}>
          <Col xs={24} md={12} lg={8} style={COL_FILL_STYLE}>
            <div style={CARD_COLUMN_FILL_STYLE}>
              <HostsCard />
            </div>
          </Col>
          <Col xs={24} md={12} lg={8} style={COL_FILL_STYLE}>
            <div style={CARD_COLUMN_FILL_STYLE}>
              <DiskCard />
            </div>
          </Col>
          <Col xs={24} md={24} lg={8} style={COL_FILL_STYLE}>
            <div style={CARD_COLUMN_FILL_STYLE}>
              <VMCard />
            </div>
          </Col>
        </Row>
      </div>
    </MonitoringOverviewLanesProvider>
  );
};

export default MonitoringOverviewSection;
