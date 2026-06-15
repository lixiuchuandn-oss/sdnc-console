import { Cloud } from '../../entities/Cloud';

/** Cloudmap/Harvester 计算池（K8s + iam.tower.io CRD）。CSM（cloudmap.csm）走 CSM OpenAPI，不在此集合。 */
const IAM_CRD_CLOUD_PROVIDERS = new Set([
  'cloudmap.private',
  'cloudmap.edge',
  'cloudmap',
  'harvester',
]);

export function isIamCrdTargetProvider(provider: unknown): boolean {
  return IAM_CRD_CLOUD_PROVIDERS.has(
    String(provider || '')
      .trim()
      .toLowerCase(),
  );
}

export function isIamCrdTargetCloud(cloud: Pick<Cloud, 'config'>): boolean {
  return isIamCrdTargetProvider(cloud.config?.provider);
}

/** 绑定 Cloudmap/Harvester 资源池时，校验该池可作为 IAM CRD 写入目标。 */
export function assertIamCrdTargetCloud(cloud: Cloud): void {
  if (!isIamCrdTargetCloud(cloud)) {
    throw Object.assign(new Error(`资源池 ${cloud.name} 不支持 IAM CRD 同步`), { status: 400 });
  }
  if (!String(cloud.endpoint || '').trim()) {
    throw Object.assign(new Error(`资源池 ${cloud.name} 缺少 endpoint，无法同步 IAM CRD`), {
      status: 502,
    });
  }
}
