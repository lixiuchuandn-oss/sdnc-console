/** 向导里 CSM 使用 UI 类型 sdn_security_pool；创建/测试仍传后端 CloudType.security_pool */
export function poolTypeToApiType(raw: string): string {
  const t = String(raw || '').toLowerCase();
  return t === 'sdn_security_pool' ? 'security_pool' : t;
}

const OPEN_PROVIDER_IDS = [
  'aliyun',
  'huaweicloud',
  'cloudmap.private',
  'cloudmap.edge',
  'cloudmap.csm',
  'rancher',
  'xinference',
  'maas',
] as const;

export function isCloudWizardOpenProvider(id: string): boolean {
  return (OPEN_PROVIDER_IDS as readonly string[]).includes(id);
}

/** MAAS endpoint 须以 /MAAS 结尾 */
export function isValidMaasEndpoint(endpoint: string): boolean {
  const s = String(endpoint || '').trim().replace(/\/+$/, '');
  return !!s && /\/MAAS$/i.test(s);
}

/** MAAS apiKey：恰好 2 个冒号、三段非空 */
export function isValidMaasApiKey(apiKey: string): boolean {
  const t = String(apiKey || '').trim();
  if ((t.match(/:/g) || []).length !== 2) return false;
  const parts = t.split(':');
  return parts.length === 3 && parts.every((p) => p.trim().length > 0);
}

/** MAAS 测试/创建统一请求体：仅 config.endpoint + config.apiKey */
export function buildMaasConnectionPayload(values: Record<string, unknown>): {
  provider: 'maas';
  config: { endpoint: string; apiKey: string; ignoreTls: boolean };
} {
  const endpoint = String(values.endpoint ?? '').trim();
  const apiKey = String(values.apiKey ?? '').trim();
  return {
    provider: 'maas',
    config: {
      endpoint,
      apiKey,
      ignoreTls: values.ignoreTls !== false,
    },
  };
}
