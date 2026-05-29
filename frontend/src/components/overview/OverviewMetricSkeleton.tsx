import React from 'react';
import { Card, Col, Row, Skeleton } from 'antd';
import './overview.css';

type ColSpan = {
  xs?: number;
  sm?: number;
  md?: number;
  lg?: number;
  xl?: number;
};

type Props = {
  /** 骨架卡数量，默认 4 */
  count?: number;
  col?: ColSpan;
};

const DEFAULT_COL: ColSpan = { xs: 24, sm: 12, lg: 6 };

/** 概览 KPI 行的首屏骨架；仅用于「尚无数据的首次加载」，刷新时不应使用 */
const OverviewMetricSkeleton: React.FC<Props> = ({ count = 4, col }) => (
  <Row gutter={[16, 16]}>
    {Array.from({ length: count }).map((_, i) => (
      <Col key={i} {...{ ...DEFAULT_COL, ...col }} style={{ display: 'flex' }}>
        <Card
          size="small"
          className="overview-card"
          style={{ width: '100%' }}
          styles={{ body: { padding: '16px 16px 18px' } }}
        >
          <Skeleton.Button
            active
            size="small"
            style={{ width: 92, height: 14 }}
          />
          <div style={{ marginTop: 14 }}>
            <Skeleton.Button
              active
              size="large"
              style={{ width: 72, height: 32 }}
            />
          </div>
        </Card>
      </Col>
    ))}
  </Row>
);

export default OverviewMetricSkeleton;
