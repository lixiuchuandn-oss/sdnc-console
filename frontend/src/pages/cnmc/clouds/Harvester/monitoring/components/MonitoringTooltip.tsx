import React from 'react';
import { Tooltip } from 'antd';
import type { TooltipProps } from 'antd';

const MONITORING_TOOLTIP_STYLES: TooltipProps['styles'] = {
  body: {
    background: '#fff',
    color: 'rgba(0,0,0,.88)',
    boxShadow:
      '0 6px 16px 0 rgba(0,0,0,.08), 0 3px 6px -4px rgba(0,0,0,.12), 0 9px 28px 8px rgba(0,0,0,.05)',
  },
};

const MonitoringTooltip: React.FC<TooltipProps> = ({ placement = 'topLeft', styles, ...props }) => (
  <Tooltip
    placement={placement}
    styles={{
      ...MONITORING_TOOLTIP_STYLES,
      ...styles,
      body: {
        ...MONITORING_TOOLTIP_STYLES.body,
        ...styles?.body,
      },
    }}
    {...props}
  />
);

export default MonitoringTooltip;
