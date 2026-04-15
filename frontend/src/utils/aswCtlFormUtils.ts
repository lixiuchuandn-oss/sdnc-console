/**
 * 资源池 config.aswCtl 与「临时配置」表单之间的转换。
 * 每资源池仅一台 ASW-CTL；编辑时 apiKey 留空表示保留原值。
 */

export type AswCtlModalFields = {
  name: string;
  baseUrl: string;
  apiKey: string;
};

/** 与后端 normalizeAswCtlApiKeySecret 对齐，避免引号/BOM/整行 env 粘贴导致 401 */
export function normalizeAswCtlApiKeyInput(raw: unknown): string | undefined {
  if (raw == null) return undefined;
  let s = String(raw)
    .replace(/^\uFEFF/, '')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .trim();
  if (!s) return undefined;
  const stripQuotes = (t: string) => {
    if (t.length >= 2) {
      const a = t[0];
      const b = t[t.length - 1];
      if ((a === '"' && b === '"') || (a === "'" && b === "'") || (a === '\u201c' && b === '\u201d')) {
        return t.slice(1, -1).trim();
      }
    }
    return t;
  };
  s = stripQuotes(s);
  if (!s) return undefined;
  const lineMatch = s.match(/^\s*ASW_CTL_API_KEY\s*=\s*(.+?)\s*$/im);
  if (lineMatch) {
    s = stripQuotes(lineMatch[1].trim());
  }
  return s || undefined;
}

/** 从已有 config.aswCtl 生成弹窗初始值（不预填 apiKey） */
export function aswCtlModalDefaults(cfg: unknown): AswCtlModalFields {
  if (!cfg || typeof cfg !== 'object') {
    return { name: '', baseUrl: '', apiKey: '' };
  }
  const c = cfg as Record<string, unknown>;
  const eps = c.endpoints;
  if (Array.isArray(eps) && eps.length > 0) {
    const raw = eps[0];
    if (raw && typeof raw === 'object') {
      const e = raw as Record<string, unknown>;
      return {
        name: String(e.name ?? ''),
        baseUrl: String(e.baseUrl ?? e.url ?? ''),
        apiKey: '',
      };
    }
  }
  return {
    name: String(c.name ?? ''),
    baseUrl: String(c.baseUrl ?? c.url ?? ''),
    apiKey: '',
  };
}

/**
 * 「测试连接」用：密码框留空时沿用资源池已保存的 apiKey（与 {@link buildAswCtlConfig} 一致）。
 */
export function getEffectiveAswCtlApiKey(
  prev: unknown,
  typedFromForm: string,
): string | undefined {
  const typed = normalizeAswCtlApiKeyInput(typedFromForm);
  if (typed) return typed;
  const p = prev && typeof prev === 'object' ? (prev as Record<string, unknown>) : null;
  const prevEp0 =
    Array.isArray(p?.endpoints) && p!.endpoints[0] && typeof p!.endpoints[0] === 'object'
      ? (p!.endpoints[0] as Record<string, unknown>)
      : null;
  return (
    normalizeAswCtlApiKeyInput(prevEp0?.apiKey) ||
    normalizeAswCtlApiKeyInput(p?.apiKey) ||
    undefined
  );
}

/**
 * 将弹窗字段合并为写入后端的 aswCtl（扁平单实例）；全空 baseUrl 则返回 undefined。
 */
export function buildAswCtlConfig(
  prev: unknown,
  row: AswCtlModalFields,
  insecureTls: boolean,
): Record<string, unknown> | undefined {
  const baseUrl = String(row?.baseUrl || '')
    .trim()
    .replace(/\/+$/, '');
  if (!baseUrl) return undefined;

  const typed = normalizeAswCtlApiKeyInput(row?.apiKey);
  const p = prev && typeof prev === 'object' ? (prev as Record<string, unknown>) : null;
  const prevEp0 =
    Array.isArray(p?.endpoints) && p!.endpoints[0] && typeof p!.endpoints[0] === 'object'
      ? (p!.endpoints[0] as Record<string, unknown>)
      : null;
  const apiKey =
    typed ||
    normalizeAswCtlApiKeyInput(prevEp0?.apiKey) ||
    normalizeAswCtlApiKeyInput(p?.apiKey) ||
    undefined;

  const out: Record<string, unknown> = { insecureTls, baseUrl };
  const name = String(row?.name || '').trim();
  if (name) out.name = name;
  if (apiKey) out.apiKey = apiKey;
  return out;
}
