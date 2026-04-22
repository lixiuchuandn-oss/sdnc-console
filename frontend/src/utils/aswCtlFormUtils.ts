/**
 * 资源池 config.aswCtl 与「连接设置」表单之间的转换。
 * HSM 访问地址固定为资源池 API Endpoint；此处仅可选 API Key、TLS。apiKey 留空表示保留原值。
 */

export type AswCtlModalFields = {
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

/** 从已有 config.aswCtl 生成弹窗初始值（不预填 apiKey；密钥沿用 getEffectiveAswCtlApiKey） */
export function aswCtlModalDefaults(_cfg?: unknown): AswCtlModalFields {
  return { apiKey: '' };
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
 * 将弹窗字段合并为写入后端的 aswCtl（不含 baseUrl；Tower 始终用资源池 endpoint 访问 `/v1/hms/*`）。
 */
export function buildAswCtlConfig(
  prev: unknown,
  row: AswCtlModalFields,
  insecureTls: boolean,
): Record<string, unknown> | undefined {
  const typed = normalizeAswCtlApiKeyInput(row?.apiKey);
  const p = prev && typeof prev === 'object' ? (prev as Record<string, unknown>) : null;
  const prevEp0 =
    Array.isArray(p?.endpoints) && p!.endpoints[0] && typeof p!.endpoints[0] === 'object'
      ? (p!.endpoints[0] as Record<string, unknown>)
      : null;
  const apiKeyFromPrev =
    normalizeAswCtlApiKeyInput(prevEp0?.apiKey) ||
    normalizeAswCtlApiKeyInput(p?.apiKey) ||
    undefined;

  const out: Record<string, unknown> = { insecureTls };
  if (typed) out.apiKey = typed;
  else if (apiKeyFromPrev) out.apiKey = apiKeyFromPrev;

  if (!out.apiKey && !insecureTls) return undefined;
  return out;
}
