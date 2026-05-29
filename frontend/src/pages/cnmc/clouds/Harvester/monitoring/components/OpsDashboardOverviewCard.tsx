/**
 * 运维监控大盘 · 概览卡片统一外壳（集群 CPU/内存/磁盘、云主机分布）
 */
import React from 'react';
import { Card, Spin } from 'antd';
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
  loading?: boolean;
  height?: number;
  children: React.ReactNode;
}

const OpsDashboardOverviewCard: React.FC<OpsDashboardOverviewCardProps> = ({
  title,
  icon,
  extra,
  loading = false,
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
    <Spin spinning={loading} style={{ width: '100%', flex: 1, minHeight: 0 }}>
      {children}
    </Spin>
  </Card>
);

export default OpsDashboardOverviewCard;
