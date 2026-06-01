/**
 * 运维监控大盘 · 概览卡片统一外壳（集群 CPU/内存/磁盘、云主机分布）
 * 加载态由内部 ECharts showLoading 负责，外层不叠加 Spin。
 */
import React from 'react';
import { Card } from 'antd';
import {
  OPS_OVERVIEW_CARD_BODY_STYLE,
  OPS_OVERVIEW_CARD_HEADER_STYLE,
  OPS_OVERVIEW_CARD_STYLE,
  OPS_OVERVIEW_EXTRA_FONT,
  OPS_OVERVIEW_TITLE_FONT,
} from '../lib/opsDashboardOverviewCardLayout';

export interface OpsDashboardOverviewCardProps {
  title: React.ReactNode;
  icon: React.ReactNode;
  extra?: React.ReactNode;
  /** 保留供子组件（ECharts）判断首次加载；本壳层不渲染 Spin */
  loading?: boolean;
  height?: number;
  children: React.ReactNode;
}

const OpsDashboardOverviewCard: React.FC<OpsDashboardOverviewCardProps> = ({
  title,
  icon,
  extra,
  height = 220,
  children,
}) => (
  <Card
    size="small"
    title={
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
        {icon}
        <span style={{ fontSize: OPS_OVERVIEW_TITLE_FONT }}>{title}</span>
      </span>
    }
    extra={extra != null ? <span style={{ fontSize: OPS_OVERVIEW_EXTRA_FONT, color: '#999' }}>{extra}</span> : undefined}
    styles={{
      header: OPS_OVERVIEW_CARD_HEADER_STYLE,
      body: OPS_OVERVIEW_CARD_BODY_STYLE,
    }}
    style={{ ...OPS_OVERVIEW_CARD_STYLE, height }}
  >
    {children}
  </Card>
);

export default OpsDashboardOverviewCard;
