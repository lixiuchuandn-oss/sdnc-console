/**
 * 监控大盘工具栏：时间范围 + 手动刷新 + 自动刷新（与告警中心概览同款交互）。
 * 顶层 MonitoringOpsDashboard 与各 Section 复用。
 */
import React, { useCallback, useMemo } from 'react';
import { DownOutlined, ReloadOutlined } from '@ant-design/icons';
import { Button, Dropdown, Space } from 'antd';
import type { MenuProps } from 'antd';
import MonitoringTooltip from './MonitoringTooltip';
import {
  OPS_DASHBOARD_TIME_RANGE_OPTIONS,
  type DashboardTimeRangeOption,
} from '../hooks/useDashboardTimeRange';
import {
  OPS_DASHBOARD_AUTO_REFRESH_OPTIONS,
  type AutoRefreshOption,
} from '../hooks/useAutoRefresh';

export interface DashboardToolbarProps {
  rangeSeconds?: number;
  onRangeChange?: (s: number) => void;
  autoRefreshMs: number | null;
  onAutoRefreshChange: (v: number | null) => void;
  loading?: boolean;
  onManualRefresh: () => void;
  /** 是否展示时间范围（运维告警概览仅刷新 + 自动刷新） */
  showTimeRange?: boolean;
  /** 自定义时间范围选项；不传用默认 */
  rangeOptions?: DashboardTimeRangeOption[];
  /** 自定义自动刷新选项 */
  autoRefreshOptions?: AutoRefreshOption[];
  manualRefreshTooltip?: string;
}

const DashboardToolbar: React.FC<DashboardToolbarProps> = ({
  rangeSeconds = 0,
  onRangeChange,
  autoRefreshMs,
  onAutoRefreshChange,
  loading,
  onManualRefresh,
  showTimeRange = true,
  rangeOptions = OPS_DASHBOARD_TIME_RANGE_OPTIONS,
  autoRefreshOptions = OPS_DASHBOARD_AUTO_REFRESH_OPTIONS,
  manualRefreshTooltip = '立即刷新当前大盘',
}) => {
  const rangeMenu: MenuProps = useMemo(
    () => ({
      items: rangeOptions.map((it) => ({ key: String(it.value), label: it.label })),
      selectable: true,
      selectedKeys: [String(rangeSeconds)],
      onClick: ({ key }) => onRangeChange?.(Number(key)),
    }),
    [rangeOptions, rangeSeconds, onRangeChange],
  );

  const autoMenu: MenuProps = useMemo(
    () => ({
      items: autoRefreshOptions.map((it) => ({
        key: it.value === null ? 'off' : String(it.value),
        label: it.label,
      })),
      selectable: true,
      selectedKeys: [autoRefreshMs === null ? 'off' : String(autoRefreshMs)],
      onClick: ({ key }) => onAutoRefreshChange(key === 'off' ? null : Number(key)),
    }),
    [autoRefreshOptions, autoRefreshMs, onAutoRefreshChange],
  );

  const rangeLabel = useMemo(() => {
    return rangeOptions.find((it) => it.value === rangeSeconds)?.label ?? `${rangeSeconds}s`;
  }, [rangeOptions, rangeSeconds]);

  const autoLabel = useMemo(() => {
    return autoRefreshOptions.find((it) => it.value === autoRefreshMs)?.label ?? '自定义';
  }, [autoRefreshOptions, autoRefreshMs]);

  const handleRefresh = useCallback(() => {
    onManualRefresh();
  }, [onManualRefresh]);

  return (
    <Space size={8}>
      {showTimeRange ? (
        <Dropdown menu={rangeMenu} trigger={['click']}>
          <MonitoringTooltip title={`时间范围：最近 ${rangeLabel}`}>
            <Button>
              {`最近 ${rangeLabel}`}
              <DownOutlined />
            </Button>
          </MonitoringTooltip>
        </Dropdown>
      ) : null}
      <MonitoringTooltip title={manualRefreshTooltip}>
        <Button icon={<ReloadOutlined />} onClick={handleRefresh} loading={loading} />
      </MonitoringTooltip>
      <Dropdown menu={autoMenu} trigger={['click']}>
        <MonitoringTooltip
          title={autoRefreshMs === null ? '自动刷新已关闭' : `自动刷新间隔：${autoLabel}`}
        >
          <Button>
            {autoLabel}
            <DownOutlined />
          </Button>
        </MonitoringTooltip>
      </Dropdown>
    </Space>
  );
};

export default DashboardToolbar;
