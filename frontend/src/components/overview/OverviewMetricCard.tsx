import React from 'react';
import { Col, Spin } from 'antd';
import OverviewCard from './OverviewCard';

type ColSpan = {
  xs?: number;
  sm?: number;
  md?: number;
  lg?: number;
  xl?: number;
};

type Props = {
  title: React.ReactNode;
  /** 标题区图标（已渲染节点） */
  icon?: React.ReactNode;
  value: React.ReactNode;
  /** 显示为「值 / 总量」 */
  total?: React.ReactNode;
  footer?: React.ReactNode;
  valueColor?: string;
  /** 首次加载时在数值区显示 Spin */
  loading?: boolean;
  onClick?: () => void;
  /** 栅格断点，默认 xs=24 sm=12 lg=6 */
  col?: ColSpan;
};

const DEFAULT_COL: ColSpan = { xs: 24, sm: 12, lg: 6 };

/** 通用 KPI 指标卡：值/总量 + 可点击下钻，全项目概览类界面复用 */
const OverviewMetricCard: React.FC<Props> = ({
  title,
  icon,
  value,
  total,
  footer,
  valueColor = '#1677ff',
  loading,
  onClick,
  col,
}) => (
  <Col {...{ ...DEFAULT_COL, ...col }} style={{ display: 'flex' }}>
    <OverviewCard
      title={title}
      icon={icon}
      className="overview-metric-card"
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
      }}
      bodyStyle={{
        flex: 1,
        minHeight: 0,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        padding: '8px 16px 16px',
      }}
      onClick={onClick}
    >
      <Spin spinning={!!loading}>
        <div className="overview-kpi-value-section">
          <span className="overview-kpi-value" style={{ color: valueColor }}>
            {value}
          </span>
          {total != null && total !== '' ? (
            <>
              <span className="overview-kpi-divider">/</span>
              <span className="overview-kpi-total">{total}</span>
            </>
          ) : null}
        </div>
      </Spin>
      <div className="overview-kpi-footer">{footer ?? '\u00A0'}</div>
    </OverviewCard>
  </Col>
);

export default OverviewMetricCard;
