import React from 'react';
import { Card, Skeleton } from 'antd';
import { OverviewMetricSkeleton } from '../../../../../../components/overview';

/** MAAS 概览首屏骨架（仅首次加载、尚无数据时使用；刷新时保留旧数据不显示骨架） */
const MaasDashboardSkeleton: React.FC = () => (
  <>
    <Card
      size="small"
      className="overview-card"
      style={{ marginBottom: 16 }}
      styles={{ body: { padding: '14px 16px' } }}
    >
      <Skeleton.Button active style={{ width: 320, height: 22 }} />
    </Card>
    <OverviewMetricSkeleton count={8} />
    <Card
      size="small"
      className="overview-card"
      style={{ marginTop: 16 }}
      styles={{ body: { padding: '16px 20px 20px' } }}
    >
      <Skeleton active paragraph={{ rows: 2 }} title={{ width: '30%' }} />
    </Card>
  </>
);

export default MaasDashboardSkeleton;
