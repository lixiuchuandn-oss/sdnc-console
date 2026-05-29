import React from 'react';
import type { GlobalToken } from 'antd/es/theme/interface';
import type { MaasDashStatIconComp } from './maasDashboardStatIcons';
import {
  OVERVIEW_COLORS,
  OVERVIEW_TITLE_ICON_SIZE,
} from '../../../../../components/overview';

/** 统计卡标题图标：已连接用主题蓝，未连接灰化（与全站概览标题图标一致，20px） */
export function maasStatPrefix(
  token: GlobalToken,
  Icon: MaasDashStatIconComp,
  active = true,
): React.ReactElement {
  const color = active ? OVERVIEW_COLORS.primary : token.colorTextQuaternary;
  return <Icon style={{ fontSize: OVERVIEW_TITLE_ICON_SIZE, color }} />;
}
