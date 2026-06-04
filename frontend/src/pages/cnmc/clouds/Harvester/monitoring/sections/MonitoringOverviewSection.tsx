/**
 * 监控服务 - 概览（资源大盘）Tab 主体
 * 设计文档：plan/设计-监控服务-概览.md
 * 参考：Compute.Tower-Monitoring Dashboard 布局与交互
 */
import React, { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Row, Col, Alert } from 'antd';
import {
  CLUSTER_RESOURCES_VIEW,
  NODES_OVERVIEW_VIEW,
  VMS_OVERVIEW_VIEW,
  type OpsDashboardView,
} from '../lib/opsDashboardViews';
import { opsDashboardAlertsListPath } from '../lib/opsDashboardNavigation';
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

const CLICKABLE_CARD_SLOT_STYLE: React.CSSProperties = {
  flex: 1,
  minHeight: 0,
  display: 'flex',
  flexDirection: 'column',
  cursor: 'pointer',
};

interface MonitoringOverviewSectionProps {
  cloudId: string;
}

const MonitoringOverviewSection: React.FC<MonitoringOverviewSectionProps> = ({ cloudId }) => {
  const navigate = useNavigate();

  const goToOpsDashboardView = useCallback(
    (view: OpsDashboardView) => {
      if (!cloudId) return;
      navigate(opsDashboardAlertsListPath(cloudId, view));
    },
    [cloudId, navigate],
  );

  const handleOpsDashboardKeyDown = useCallback(
    (view: OpsDashboardView) => (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        goToOpsDashboardView(view);
      }
    },
    [goToOpsDashboardView],
  );

  if (!cloudId) {
    return (
      <div>
        <Alert type="warning" message="缺少资源池ID，无法加载概览" />
      </div>
    );
  }

  return (
    <MonitoringOverviewLanesProvider cloudId={cloudId}>
      <div style={OVERVIEW_GRID_STYLE}>
        <Row gutter={[CARD_GAP, CARD_GAP]} style={ROW_STRETCH_STYLE}>
          <Col xs={24} lg={10} style={COL_FILL_STYLE}>
            <div style={CARD_COLUMN_FILL_STYLE}>
              <AlertsCard cloudId={cloudId} />
            </div>
          </Col>
          <Col xs={24} lg={7} style={COL_FILL_STYLE}>
            <div style={{ ...CARD_COLUMN_FILL_STYLE, gap: CARD_GAP }}>
              <div
                role="button"
                tabIndex={0}
                style={CLICKABLE_CARD_SLOT_STYLE}
                onClick={() => goToOpsDashboardView(CLUSTER_RESOURCES_VIEW)}
                onKeyDown={handleOpsDashboardKeyDown(CLUSTER_RESOURCES_VIEW)}
              >
                <CPUCard />
              </div>
              <div
                role="button"
                tabIndex={0}
                style={CLICKABLE_CARD_SLOT_STYLE}
                onClick={() => goToOpsDashboardView(CLUSTER_RESOURCES_VIEW)}
                onKeyDown={handleOpsDashboardKeyDown(CLUSTER_RESOURCES_VIEW)}
              >
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
            <div
              role="button"
              tabIndex={0}
              style={CLICKABLE_CARD_SLOT_STYLE}
              onClick={() => goToOpsDashboardView(NODES_OVERVIEW_VIEW)}
              onKeyDown={handleOpsDashboardKeyDown(NODES_OVERVIEW_VIEW)}
            >
              <HostsCard />
            </div>
          </Col>
          <Col xs={24} md={12} lg={8} style={COL_FILL_STYLE}>
            <div style={CARD_COLUMN_FILL_STYLE}>
              <DiskCard />
            </div>
          </Col>
          <Col xs={24} md={24} lg={8} style={COL_FILL_STYLE}>
            <div
              role="button"
              tabIndex={0}
              style={CLICKABLE_CARD_SLOT_STYLE}
              onClick={() => goToOpsDashboardView(VMS_OVERVIEW_VIEW)}
              onKeyDown={handleOpsDashboardKeyDown(VMS_OVERVIEW_VIEW)}
            >
              <VMCard />
            </div>
          </Col>
        </Row>
      </div>
    </MonitoringOverviewLanesProvider>
  );
};

export default MonitoringOverviewSection;
