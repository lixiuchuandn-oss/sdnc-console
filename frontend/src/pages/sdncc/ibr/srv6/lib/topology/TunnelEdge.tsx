/**
 * SRv6 隧道自定义边（react-flow-renderer v10）。
 * - 同节点对多条隧道：二次贝塞尔平行偏移，避免重叠
 * - 无箭头（隧道双向）；当前入口隧道加粗 + 动画
 * - attach 类型：PE–CE 接入细灰线
 */
import React, { memo } from 'react';
import type { EdgeProps } from 'react-flow-renderer';

export type TunnelEdgeData = {
  kind: 'tunnel' | 'attach';
  label?: string;
  subLabel?: string;
  focus?: boolean;
  groupIndex?: number;
  groupSize?: number;
  /** 配置态 / 运行态颜色（P1-c 对账接入前为 undefined） */
  stroke?: string;
  dashed?: boolean;
  /** 悬停说明（流量口径 / 接入边 BGP） */
  tip?: string;
  /** 副标题标红（Bad Δ>0） */
  subWarn?: boolean;
};

export const PARALLEL_GAP = 28;

export function parallelOffset(index = 0, size = 1): number {
  return (index - (size - 1) / 2) * PARALLEL_GAP;
}

/** 返回二次贝塞尔路径与中点（标签锚点） */
export function offsetQuadPath(sx: number, sy: number, tx: number, ty: number, offset: number) {
  const mx = (sx + tx) / 2;
  const my = (sy + ty) / 2;
  const dx = tx - sx;
  const dy = ty - sy;
  const len = Math.hypot(dx, dy) || 1;
  // 法向量；控制点偏移 2×offset，使曲线中点恰好偏移 offset
  const nx = -dy / len;
  const ny = dx / len;
  const cx = mx + nx * offset * 2;
  const cy = my + ny * offset * 2;
  return {
    path: `M ${sx},${sy} Q ${cx},${cy} ${tx},${ty}`,
    labelX: mx + nx * offset,
    labelY: my + ny * offset,
  };
}

const TunnelEdge: React.FC<EdgeProps<TunnelEdgeData>> = ({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  data,
}) => {
  const kind = data?.kind || 'tunnel';
  const focus = !!data?.focus;
  const { path, labelX, labelY } = offsetQuadPath(
    sourceX,
    sourceY,
    targetX,
    targetY,
    kind === 'tunnel' ? parallelOffset(data?.groupIndex, data?.groupSize) : 0,
  );
  const stroke =
    data?.stroke || (kind === 'attach' ? '#c9cdd4' : focus ? '#1677ff' : '#86909c');
  const width = kind === 'attach' ? 1.25 : focus ? 2.5 : 1.75;
  const label = data?.label || '';
  const sub = data?.subLabel || '';
  const textW = Math.max(label.length, sub.length) * 6.6 + 14;
  const boxH = sub ? 32 : 18;

  return (
    <g className={`srv6-topo-edge srv6-topo-edge--${kind}${focus ? ' is-focus' : ''}`}>
      {data?.tip ? <title>{data.tip}</title> : null}
      <path
        id={id}
        d={path}
        fill="none"
        className={`react-flow__edge-path${focus && kind === 'tunnel' ? ' srv6-topo-edge-flow' : ''}`}
        style={{
          stroke,
          strokeWidth: width,
          strokeDasharray: data?.dashed ? '6 4' : undefined,
        }}
      />
      {/* 加宽透明命中区 */}
      <path d={path} fill="none" stroke="transparent" strokeWidth={14} />
      {label ? (
        <g transform={`translate(${labelX}, ${labelY})`} className="srv6-topo-edge-label">
          <rect
            x={-textW / 2}
            y={-boxH / 2}
            width={textW}
            height={boxH}
            rx={4}
            fill="#fff"
            fillOpacity={0.94}
            stroke={kind === 'tunnel' ? '#e5e6eb' : 'none'}
          />
          <text
            textAnchor="middle"
            y={sub ? -3 : 4}
            fontSize={11}
            fontWeight={focus ? 600 : 500}
            fill={focus ? '#1677ff' : '#4e5969'}
          >
            {label}
          </text>
          {sub ? (
            <text
              textAnchor="middle"
              y={11}
              fontSize={10}
              fill={data?.subWarn ? '#f53f3f' : '#86909c'}
              className="is-mono"
            >
              {sub}
            </text>
          ) : null}
        </g>
      ) : null}
    </g>
  );
};

export default memo(TunnelEdge);
