/**
 * 监控大盘单位格式化：
 * - bytes / bytesRate：自适应 B、KiB、MiB、GiB、TiB（速率追加 /s）
 * - percent01：0-1 比例 → 百分比
 * - percent：0-100 直接百分比
 * - short：紧凑大数（K、M、G）
 * - duration：秒 → 秒/分/时/天
 * - pps / iops / reqps：原样保留
 * 对应 Grafana 仪表盘里的 unit：`bytes`、`percentunit`、`s`、`pps`、`short` 等。
 */
export type UnitKind =
  | 'bytes'
  | 'bytesRate'
  | 'bitsRate'
  | 'percent01'
  | 'percent'
  | 'short'
  | 'duration'
  | 'pps'
  | 'iops'
  | 'reqps'
  | 'count'
  | 'none';

export interface FormattedValue {
  /** 缩放后数值（用于绘图） */
  value: number;
  /** 展示文本（含单位） */
  text: string;
  /** 单位字符串（用于 Y 轴格式化） */
  unit: string;
}

const BYTE_STEPS = [
  { div: 1024 ** 5, unit: 'PiB' },
  { div: 1024 ** 4, unit: 'TiB' },
  { div: 1024 ** 3, unit: 'GiB' },
  { div: 1024 ** 2, unit: 'MiB' },
  { div: 1024, unit: 'KiB' },
  { div: 1, unit: 'B' },
];

const BIT_STEPS = [
  { div: 1000 ** 4, unit: 'Tb' },
  { div: 1000 ** 3, unit: 'Gb' },
  { div: 1000 ** 2, unit: 'Mb' },
  { div: 1000, unit: 'Kb' },
  { div: 1, unit: 'b' },
];

const SHORT_STEPS = [
  { div: 1000 ** 4, unit: 'T' },
  { div: 1000 ** 3, unit: 'G' },
  { div: 1000 ** 2, unit: 'M' },
  { div: 1000, unit: 'K' },
  { div: 1, unit: '' },
];

function pickStep(value: number, steps: { div: number; unit: string }[]): { div: number; unit: string } {
  const abs = Math.abs(value);
  for (const s of steps) {
    if (abs >= s.div) return s;
  }
  return steps[steps.length - 1];
}

function fixed(value: number, digits = 2): string {
  if (!Number.isFinite(value)) return '0';
  if (Math.abs(value) >= 100) return value.toFixed(0);
  if (Math.abs(value) >= 10) return value.toFixed(1);
  return value.toFixed(digits);
}

export function formatValue(rawValue: number, kind: UnitKind = 'short'): FormattedValue {
  const v = Number(rawValue);
  if (!Number.isFinite(v)) return { value: 0, text: '-', unit: '' };

  switch (kind) {
    case 'bytes': {
      const step = pickStep(v, BYTE_STEPS);
      const scaled = v / step.div;
      return { value: scaled, text: `${fixed(scaled)} ${step.unit}`, unit: step.unit };
    }
    case 'bytesRate': {
      const step = pickStep(v, BYTE_STEPS);
      const scaled = v / step.div;
      const unit = `${step.unit}/s`;
      return { value: scaled, text: `${fixed(scaled)} ${unit}`, unit };
    }
    case 'bitsRate': {
      const step = pickStep(v, BIT_STEPS);
      const scaled = v / step.div;
      const unit = `${step.unit}/s`;
      return { value: scaled, text: `${fixed(scaled)} ${unit}`, unit };
    }
    case 'percent01': {
      const pct = v * 100;
      return { value: pct, text: `${fixed(pct, 1)}%`, unit: '%' };
    }
    case 'percent': {
      return { value: v, text: `${fixed(v, 1)}%`, unit: '%' };
    }
    case 'duration': {
      const abs = Math.abs(v);
      if (abs >= 86400) return { value: v / 86400, text: `${fixed(v / 86400, 1)}d`, unit: 'd' };
      if (abs >= 3600) return { value: v / 3600, text: `${fixed(v / 3600, 1)}h`, unit: 'h' };
      if (abs >= 60) return { value: v / 60, text: `${fixed(v / 60, 1)}m`, unit: 'm' };
      return { value: v, text: `${fixed(v, 1)}s`, unit: 's' };
    }
    case 'pps':
      return { value: v, text: `${fixed(v)} pps`, unit: 'pps' };
    case 'iops':
      return { value: v, text: `${fixed(v)} io/s`, unit: 'io/s' };
    case 'reqps':
      return { value: v, text: `${fixed(v)} req/s`, unit: 'req/s' };
    case 'count':
      return { value: v, text: `${Math.round(v)}`, unit: '' };
    case 'short':
    default: {
      const step = pickStep(v, SHORT_STEPS);
      const scaled = v / step.div;
      return { value: scaled, text: `${fixed(scaled)}${step.unit}`, unit: step.unit };
    }
  }
}

/**
 * 为一组时间序列选定**统一**的单位（按最大值），保证一张图 Y 轴/Tooltip 单位一致。
 * 返回 `{ unit, divider, formatTick }`，绘图时把每个点除以 `divider`、Y 轴用 `formatTick`。
 */
export function pickSeriesScale(values: number[], kind: UnitKind): { unit: string; divider: number; formatTick: (v: number) => string } {
  const max = values.reduce((acc, v) => (Number.isFinite(v) && v > acc ? v : acc), 0);
  const sample = formatValue(max || 0, kind);
  let divider = 1;
  switch (kind) {
    case 'bytes':
    case 'bytesRate': {
      const step = pickStep(max, BYTE_STEPS);
      divider = step.div;
      break;
    }
    case 'bitsRate': {
      const step = pickStep(max, BIT_STEPS);
      divider = step.div;
      break;
    }
    case 'short': {
      const step = pickStep(max, SHORT_STEPS);
      divider = step.div;
      break;
    }
    case 'percent01':
      divider = 0.01;
      break;
    default:
      divider = 1;
  }
  const unit = sample.unit;
  return {
    unit,
    divider,
    formatTick: (v: number) => `${fixed(v, 1)}${unit ? ` ${unit}` : ''}`,
  };
}
