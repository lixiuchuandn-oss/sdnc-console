import React from 'react';
import { Card, Col, theme } from 'antd';
import type { MaasDashTwoToneIcon } from '../lib/maasDashboardStatIcons';
import { maasStatPrefix } from '../lib/maasDashboardStatTheme';
import {
  MAAS_OVERVIEW_CARD_BODY_STYLES,
  MAAS_OVERVIEW_CARD_HEADER_STYLES,
  MAAS_OVERVIEW_CARD_SHADOW,
  MAAS_OVERVIEW_TITLE_ICON_STYLE,
  MAAS_OVERVIEW_TITLE_TEXT_STYLE,
} from '../lib/maasOverviewCardStyles';
import '../../../dashboard/Dashboard.css';

type Props = {
  title: string;
  /** 概览统计卡双色图标（与 titleIcon 二选一） */
  icon?: MaasDashTwoToneIcon;
  /** 自定义标题区图标（Region 配置等） */
  titleIcon?: React.ReactNode;
  value: number | string;
  /** 显示为「值 / 总量」，与集群总览 KPI 一致 */
  total?: number | string;
  footer?: React.ReactNode;
  connected?: boolean;
  /** 覆盖 KPI 数值颜色（如连接状态） */
  valueColor?: string;
  onClick?: () => void;
};

const MaasOverviewMetricCard: React.FC<Props> = ({
  title,
  icon,
  titleIcon,
  value,
  total,
  footer,
  connected = true,
  valueColor: valueColorProp,
  onClick,
}) => {
  const { token } = theme.useToken();
  const valueColor =
    valueColorProp ?? (connected ? '#1677ff' : token.colorTextQuaternary);
  const clickable = connected && !!onClick;

  const body = (
    <>
      <div className="kpi-value-section-v2">
        <span className="kpi-value-v2" style={{ color: valueColor }}>
          {value}
        </span>
        {total != null && total !== '' ? (
          <>
            <span className="kpi-divider-v2">/</span>
            <span className="kpi-total-v2">{total}</span>
          </>
        ) : null}
      </div>
      <div
        style={{
          marginTop: 8,
          fontSize: 12,
          color: token.colorTextSecondary,
          minHeight: 40,
          lineHeight: '20px',
        }}
      >
        {footer ?? '\u00A0'}
      </div>
    </>
  );

  return (
    <Col xs={24} sm={12} lg={6} style={{ display: 'flex' }}>
      <Card
        size="small"
        className="dashboard-overview-metric-card"
        title={
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            <span style={MAAS_OVERVIEW_TITLE_ICON_STYLE}>
              {titleIcon ??
                (icon ? maasStatPrefix(token, icon, connected) : null)}
            </span>
            <span style={MAAS_OVERVIEW_TITLE_TEXT_STYLE}>{title}</span>
          </span>
        }
        styles={{
          header: MAAS_OVERVIEW_CARD_HEADER_STYLES,
          body: MAAS_OVERVIEW_CARD_BODY_STYLES,
        }}
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          boxShadow: MAAS_OVERVIEW_CARD_SHADOW,
          cursor: clickable ? 'pointer' : undefined,
        }}
        onClick={clickable ? onClick : undefined}
        onKeyDown={
          clickable
            ? (e) => {
                if (e.key === 'Enter') onClick?.();
              }
            : undefined
        }
        tabIndex={clickable ? 0 : undefined}
        role={clickable ? 'button' : undefined}
      >
        {body}
      </Card>
    </Col>
  );
};

export default MaasOverviewMetricCard;
