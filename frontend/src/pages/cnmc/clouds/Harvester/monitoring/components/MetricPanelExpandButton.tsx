/**
 * 监控面板标题栏「大图」展开按钮（对齐 Grafana panel 右上角 expand）。
 */
import React from 'react';
import { ExpandOutlined } from '@ant-design/icons';
import { MonitoringPopover } from './MonitoringPopover';

export interface MetricPanelExpandButtonProps {
  onClick: () => void;
}

const MetricPanelExpandButton: React.FC<MetricPanelExpandButtonProps> = ({ onClick }) => (
  <MonitoringPopover title="大图">
    <span
      role="button"
      tabIndex={0}
      aria-label="大图"
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick();
        }
      }}
      style={{
        color: 'rgba(0,0,0,.45)',
        fontSize: 14,
        cursor: 'pointer',
        display: 'inline-flex',
        alignItems: 'center',
        lineHeight: 1,
      }}
    >
      <ExpandOutlined />
    </span>
  </MonitoringPopover>
);

export default MetricPanelExpandButton;
