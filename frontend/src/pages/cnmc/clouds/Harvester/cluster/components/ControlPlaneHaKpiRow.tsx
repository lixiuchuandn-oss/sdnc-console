import React from 'react';
import { Card, Col, Row, Statistic } from 'antd';
import type { ControlPlaneHaSummary } from '../lib/controlPlaneHaFromNodes';

function clusterReadyLabel(allReady: boolean, memberCount: number): string {
  if (memberCount <= 0) return '-';
  return allReady ? 'Ready' : 'NotReady';
}

export type ControlPlaneHaKpiRowProps = {
  summary: ControlPlaneHaSummary;
  etcdActiveAlertCount?: number;
  etcdAlertsLoading?: boolean;
};

/** 5 列 KPI：大屏 flex 等分铺满一行，避免 lg={4} 留右侧空档 */
const KPI_COL = { xs: 24, sm: 12, md: 8, lg: { flex: '1 1 0' } } as const;

/** 与 DRS 等集群页 KPI 一致：`Row` + `Card size="small"` + `Statistic` */
const ControlPlaneHaKpiRow: React.FC<ControlPlaneHaKpiRowProps> = ({
  summary,
  etcdActiveAlertCount = 0,
  etcdAlertsLoading = false,
}) => (
  <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
    <Col {...KPI_COL} style={{ minWidth: 0 }}>
      <Card size="small">
        <Statistic title="控制面节点" value={summary.controlPlaneCount} />
      </Card>
    </Col>
    <Col {...KPI_COL} style={{ minWidth: 0 }}>
      <Card size="small">
        <Statistic title="etcd 节点" value={summary.etcdCount} />
      </Card>
    </Col>
    <Col {...KPI_COL} style={{ minWidth: 0 }}>
      <Card size="small">
        <Statistic
          title="控制面状态"
          value={clusterReadyLabel(summary.controlPlaneAllReady, summary.controlPlaneCount)}
        />
      </Card>
    </Col>
    <Col {...KPI_COL} style={{ minWidth: 0 }}>
      <Card size="small">
        <Statistic
          title="etcd 状态"
          value={clusterReadyLabel(summary.etcdAllReady, summary.etcdCount)}
        />
      </Card>
    </Col>
    <Col {...KPI_COL} style={{ minWidth: 0 }}>
      <Card size="small">
        <Statistic
          title="etcd 活跃告警"
          value={etcdActiveAlertCount}
          loading={etcdAlertsLoading}
        />
      </Card>
    </Col>
  </Row>
);

export default ControlPlaneHaKpiRow;
