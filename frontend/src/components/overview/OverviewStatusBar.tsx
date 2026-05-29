import React from 'react';
import { Tooltip } from 'antd';
import './overview.css';

export type OverviewStatusSegment = {
  key: string;
  label: string;
  value: number;
  color: string;
  /** 提供后该图例/分段可点击（如下钻到列表过滤） */
  onClick?: () => void;
};

type Props = {
  segments: OverviewStatusSegment[];
  /** 总量；不传则取各分段之和 */
  total?: number;
  showLegend?: boolean;
  barHeight?: number;
};

/** 状态分布堆叠条 + 图例：一眼呈现集群/资源健康度，图例可下钻 */
const OverviewStatusBar: React.FC<Props> = ({
  segments,
  total,
  showLegend = true,
  barHeight = 10,
}) => {
  const sum =
    total != null
      ? total
      : segments.reduce((acc, s) => acc + (s.value || 0), 0);

  return (
    <div>
      <div className="overview-status-bar" style={{ height: barHeight }}>
        {sum > 0
          ? segments
              .filter((s) => s.value > 0)
              .map((s) => (
                <Tooltip key={s.key} title={`${s.label}: ${s.value}`}>
                  <div
                    className="overview-status-bar-seg"
                    style={{
                      width: `${(s.value / sum) * 100}%`,
                      background: s.color,
                      cursor: s.onClick ? 'pointer' : undefined,
                    }}
                    onClick={s.onClick}
                  />
                </Tooltip>
              ))
          : null}
      </div>
      {showLegend ? (
        <div className="overview-status-legend">
          {segments.map((s) => (
            <span
              key={s.key}
              className={`overview-status-legend-item${s.onClick ? ' clickable' : ''}`}
              onClick={s.onClick}
              role={s.onClick ? 'button' : undefined}
              tabIndex={s.onClick ? 0 : undefined}
              onKeyDown={
                s.onClick
                  ? (e) => {
                      if (e.key === 'Enter') s.onClick?.();
                    }
                  : undefined
              }
            >
              <span
                className="overview-status-legend-dot"
                style={{ background: s.color }}
              />
              {s.label}
              <span className="overview-status-legend-value">{s.value}</span>
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
};

export default OverviewStatusBar;
