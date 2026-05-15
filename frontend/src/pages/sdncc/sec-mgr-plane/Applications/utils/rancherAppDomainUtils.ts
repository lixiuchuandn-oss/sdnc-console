/**
 * 容器类 / Rancher 安全域：cloudId=资源池，resourcePool=下游集群 ID（与 Wizard 中 tags 一致）
 */
export function isRancherLikeSecurityDomain(d: any): boolean {
  if (!d) return false;
  if (String(d.category || '').toLowerCase().startsWith('container:') || String(d.category || '').toLowerCase() === 'container') return true;
  if (String(d.tags || '').toLowerCase().includes('rancher')) return true;
  return false;
}

/** 通用安全域应用向导：不应选 Rancher/容器 类域，请走「Rancher 安全域」入口；编辑已绑定 Rancher 域的应用时仍显示该域 */
export function filterDomainsForGenericAppWizard(list: any[], editingApp: any | undefined): any[] {
  return (Array.isArray(list) ? list : []).filter((d) => {
    if (!isRancherLikeSecurityDomain(d)) return true;
    if (editingApp && String(editingApp.domainId) === String(d.id)) return true;
    return false;
  });
}

export function getRancherPoolAndCluster(d: any): { poolId: string; clusterId: string } | null {
  if (!d) return null;
  const poolId = String(d?.cloudId || '').trim();
  let clusterId = String(d?.resourcePool || '').trim();
  if (!clusterId) {
    const t = String(d?.tags || '');
    const m = t.match(/clusterId=([^,]+)/i);
    if (m) clusterId = m[1].trim();
  }
  if (!poolId || !clusterId) return null;
  return { poolId, clusterId };
}

/** 逻辑应用与 Rancher 工作负载锚定：稳定、可人工读，写入 service_catalog.instances JSON 数组 */
export function buildRancherWorkloadInstanceKey(
  kind: string,
  namespace: string,
  name: string,
): string {
  return `k8s:${String(kind).toLowerCase().trim()}:${String(namespace).trim()}:${String(name).trim()}`;
}
