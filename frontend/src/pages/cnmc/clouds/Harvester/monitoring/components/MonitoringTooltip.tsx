import React from 'react';
import { Popover, Tooltip } from 'antd';
import type { PopoverProps, TooltipProps } from 'antd';

const MONITORING_TOOLTIP_STYLES: TooltipProps['styles'] = {
  body: {
    background: '#fff',
    color: 'rgba(0,0,0,.88)',
    boxShadow:
      '0 6px 16px 0 rgba(0,0,0,.08), 0 3px 6px -4px rgba(0,0,0,.12), 0 9px 28px 8px rgba(0,0,0,.05)',
  },
};

/** 云监控说明气泡卡片（Popover）统一样式 */
const MONITORING_POPOVER_STYLES: PopoverProps['styles'] = {
  body: {
    padding: '8px 12px',
    maxWidth: 320,
    color: 'rgba(0,0,0,.88)',
    fontSize: 14,
    lineHeight: '22px',
    boxShadow:
      '0 6px 16px 0 rgba(0,0,0,.08), 0 3px 6px -4px rgba(0,0,0,.12), 0 9px 28px 8px rgba(0,0,0,.05)',
  },
};

type MonitoringPopoverProps = Omit<PopoverProps, 'content'> & {
  /** 与 Tooltip title 对齐的简写，写入 Popover content */
  title?: React.ReactNode;
  content?: React.ReactNode;
};

/** 说明类交互优先使用 Popover 气泡卡片（逐步替换 Tooltip） */
export const MonitoringPopover: React.FC<MonitoringPopoverProps> = ({
  placement = 'topLeft',
  trigger = 'hover',
  title,
  content,
  styles,
  children,
  ...props
}) => (
  <Popover
    placement={placement}
    trigger={trigger}
    content={content ?? title}
    styles={{
      ...MONITORING_POPOVER_STYLES,
      ...styles,
      body: {
        ...MONITORING_POPOVER_STYLES.body,
        ...styles?.body,
      },
    }}
    {...props}
  >
    {children}
  </Popover>
);

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
