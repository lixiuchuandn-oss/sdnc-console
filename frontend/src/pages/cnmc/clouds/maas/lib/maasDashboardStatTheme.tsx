import React from 'react';
import type { GlobalToken } from 'antd/es/theme/interface';
import type { MaasDashTwoToneIcon } from './maasDashboardStatIcons';

import { MAAS_OVERVIEW_TITLE_ICON_STYLE } from './maasOverviewCardStyles';

/** 双色图标：已连接用 antd 默认 twoToneColor，未连接灰化（标题区 20px，与集群总览一致） */
export function maasStatPrefix(
  token: GlobalToken,
  Icon: MaasDashTwoToneIcon,
  active = true,
): React.ReactElement {
  const iconFontSize = MAAS_OVERVIEW_TITLE_ICON_STYLE.fontSize;
  if (active) {
    return <Icon style={{ fontSize: iconFontSize }} />;
  }
  return (
    <Icon
      style={{ fontSize: iconFontSize }}
      twoToneColor={[token.colorTextQuaternary, token.colorFillSecondary]}
    />
  );
}
