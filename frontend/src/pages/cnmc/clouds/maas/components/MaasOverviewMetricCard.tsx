import React from 'react';
import { theme } from 'antd';
import { OverviewMetricCard } from '../../../../../components/overview';
import type { MaasDashTwoToneIcon } from '../lib/maasDashboardStatIcons';
import { maasStatPrefix } from '../lib/maasDashboardStatTheme';

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

/** MAAS 概览 KPI 卡：基于全项目共享 OverviewMetricCard，叠加 MAAS 双色图标与未连接灰化 */
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
  const iconNode =
    titleIcon ?? (icon ? maasStatPrefix(token, icon, connected) : undefined);

  return (
    <OverviewMetricCard
      title={title}
      icon={iconNode}
      value={value}
      total={total}
      footer={footer}
      valueColor={valueColor}
      onClick={connected ? onClick : undefined}
    />
  );
};

export default MaasOverviewMetricCard;
