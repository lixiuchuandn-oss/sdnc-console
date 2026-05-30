/**
 * Grafana 仪表盘里的 PromQL 通常含 `$var` 形式占位（如 `$cluster`、`$node`、`$datasource`、`$__rate_interval`）。
 * 这里只做**字面替换**，把面板配置里出现的占位变量按对照表换成实际值；
 * 对应模板变量的下拉选择不在 Compute Tower 内做（我们不还原 Grafana 的 templating UI）。
 *
 * 注意：
 * - `$__rate_interval` 与 `$__interval`：按 step 推荐 5×step、最小 30s
 * - `$__range`：直接传入 `Xs` 字面值即可
 * - 我们不做正则白名单，调用方要保证 vars 的 key 与 panel YAML 一致
 */

export type PromVarMap = Record<string, string | number>;

/** 构造 Grafana `${var}` 占位字面量，供面板 PromQL 静态配置引用 */
export function promqlVar(name: string): string {
  return ['$', '{', name, '}'].join('');
}

/** 把 `$xxx` 或 `${xxx}` 替换为 `vars[xxx]`；未提供的变量保留原文，方便排查 */
export function expandPromql(expr: string, vars: PromVarMap = {}): string {
  if (!expr) return '';
  return expr
    .replace(/\$\{([a-zA-Z0-9_:]+)\}/g, (_m, name) => {
      const v = vars[name];
      return v === undefined || v === null ? `\${${name}}` : String(v);
    })
    .replace(/\$([a-zA-Z0-9_:]+)/g, (_m, name) => {
      const v = vars[name];
      return v === undefined || v === null ? `$${name}` : String(v);
    });
}

/**
 * 给定 range（秒）与目标点数，推荐：
 * - step：尽量让点数落在 [60, 360]，并向上取整为 5s 的整数倍
 * - rateInterval：4×step，且不小于 30s（Grafana 默认）
 */
export function recommendStep(rangeSeconds: number, targetPoints = 180): { step: number; rateInterval: string; intervalStr: string } {
  const raw = Math.max(1, Math.floor(rangeSeconds / targetPoints));
  const step = Math.max(5, Math.ceil(raw / 5) * 5);
  const rate = Math.max(30, step * 4);
  return {
    step,
    rateInterval: `${rate}s`,
    intervalStr: `${step}s`,
  };
}
