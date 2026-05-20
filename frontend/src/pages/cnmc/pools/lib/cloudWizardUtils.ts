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
] as const;

export function isCloudWizardOpenProvider(id: string): boolean {
  return (OPEN_PROVIDER_IDS as readonly string[]).includes(id);
}
