import { isTowerPaasInventoryExcludedVm } from '../../shared/harvesterTowerPaas';
import type { VmListSafeRead } from './vmSafeRead';

/** 虚拟机列表 rowKey / 批量操作主键：优先 `namespace/name` */
export function getVmInstanceId(r: any): string {
  if (r?.metadata?.name && r?.metadata?.namespace) {
    return `${r.metadata.namespace}/${r.metadata.name}`;
  }
  return String(r?.InstanceId || r?.id || '');
}

/** 是否处于回收站（finalizer 或 label 任一命中） */
export function isVmInRecycleBin(r: any): boolean {
  const finalizers = r?.metadata?.finalizers || [];
  const labels = r?.metadata?.labels || {};
  return (
    finalizers.includes('tower.io/recycle-bin') ||
    labels['tower.io/recycle-bin'] === 'true'
  );
}

export type TenantOrgCascaderOption = {
  value: string;
  label: string;
  children?: { value: string; label: string }[];
};

/** 组织 / 租户 Cascader 选项（与 VmSection 工具栏一致） */
export function buildTenantOrgFilterOptions(namespaces: any[]): TenantOrgCascaderOption[] {
  const orgMap = new Map<string, Set<string>>();
  (namespaces || []).forEach((ns: any) => {
    const annotations = ns?.metadata?.annotations || {};
    const org = annotations['tower.io/organization'];
    const tenant = annotations['tower.io/tenant'];
    if (org) {
      if (!orgMap.has(org)) orgMap.set(org, new Set());
      if (tenant) orgMap.get(org)!.add(tenant);
    }
  });

  const options: TenantOrgCascaderOption[] = [];
  orgMap.forEach((tenants, org) => {
    const children = Array.from(tenants).map((t) => ({ value: t, label: t }));
    options.push({
      value: org,
      label: org,
      children: children.length > 0 ? children : undefined,
    });
  });
  return options;
}

export type ActiveVmListFilterParams = {
  keyword: string;
  statusFilter: string;
  nsValue?: string;
  nodeValue?: string;
  tenantOrgPath?: string[];
  isTenant?: boolean;
  isPublicNamespace: (ns: string) => boolean;
  namespaces: any[];
  safeRead: VmListSafeRead;
};

function matchesTenantOrgPath(
  ns: string,
  tenantOrgPath: string[] | undefined,
  namespaces: any[],
): boolean {
  if (!tenantOrgPath || tenantOrgPath.length === 0) return true;
  const currentNsObj = (namespaces || []).find((n: any) => n?.metadata?.name === ns);
  const org = currentNsObj?.metadata?.annotations?.['tower.io/organization'];
  const tenant = currentNsObj?.metadata?.annotations?.['tower.io/tenant'];
  if (tenantOrgPath[0] && org !== tenantOrgPath[0]) return false;
  if (tenantOrgPath[1] && tenant !== tenantOrgPath[1]) return false;
  return true;
}

/** 主列表单行是否保留（不含回收站、PaaS 托管 VM） */
export function matchesActiveVmListRow(r: any, params: ActiveVmListFilterParams): boolean {
  if (isVmInRecycleBin(r)) return false;
  if (isTowerPaasInventoryExcludedVm(r)) return false;

  const SafeRead = params.safeRead;
  const iid = getVmInstanceId(r);
  const name = String(SafeRead.name(r)).toLowerCase();
  const ns =
    SafeRead.namespace(r) || (iid.includes('/') ? iid.split('/')[0] : '');
  const node = String(SafeRead.node(r));
  const sKey = String(SafeRead.status(r)).toLowerCase();

  const kw = params.keyword.trim().toLowerCase();
  const st = params.statusFilter.trim().toLowerCase();

  if (params.isTenant && params.isPublicNamespace(ns)) return false;
  if (params.isTenant) {
    const nsObj = (params.namespaces || []).find(
      (n: any) => (n?.metadata?.name || n?.name) === ns,
    );
    const sc = String(nsObj?.metadata?.labels?.['tower.io/scenario'] ?? '').toLowerCase();
    if (sc === 'public' || sc === 'admin') return false;
  }

  if (!matchesTenantOrgPath(ns, params.tenantOrgPath, params.namespaces)) {
    return false;
  }

  if (params.nsValue && ns !== params.nsValue) return false;
  if (params.nodeValue && node !== params.nodeValue) return false;
  if (kw && !(iid.toLowerCase().includes(kw) || name.includes(kw))) return false;
  if (st && sKey !== st) return false;
  return true;
}

export function sortVmRowsByCreationDesc(rows: any[]): any[] {
  return [...rows].sort((a: any, b: any) => {
    const ta = new Date(a?.metadata?.creationTimestamp || 0).getTime();
    const tb = new Date(b?.metadata?.creationTimestamp || 0).getTime();
    return tb - ta;
  });
}

/** 弹性计算主列表过滤 + 按创建时间倒序 */
export function filterActiveVmListRows(vms: any[], params: ActiveVmListFilterParams): any[] {
  const list = (vms || []).filter((r) => matchesActiveVmListRow(r, params));
  return sortVmRowsByCreationDesc(list);
}

/** 从全量 VM 中筛出回收站条目 */
export function selectRecycledVmRows(vms: any[]): any[] {
  return (vms || []).filter(isVmInRecycleBin);
}

export type RecycledVmListFilterParams = {
  keyword: string;
  namespaceFilter?: string;
  statusFilter?: string;
  safeRead: VmListSafeRead;
};

/** 回收站列表关键字 / 命名空间 / 状态筛选 */
export function filterRecycledVmListRows(
  vms: any[],
  params: RecycledVmListFilterParams,
): any[] {
  return (vms || []).filter((vm) => {
    if (params.keyword) {
      const searchText = params.keyword.toLowerCase();
      const name = params.safeRead.name(vm).toLowerCase();
      const vmId = params.safeRead.vmId(vm).toLowerCase();
      const namespace = params.safeRead.namespace(vm).toLowerCase();
      if (
        !name.includes(searchText) &&
        !vmId.includes(searchText) &&
        !namespace.includes(searchText)
      ) {
        return false;
      }
    }
    if (params.namespaceFilter && params.safeRead.namespace(vm) !== params.namespaceFilter) {
      return false;
    }
    if (params.statusFilter) {
      const vmStatus = String(params.safeRead.status(vm)).toLowerCase();
      if (vmStatus !== params.statusFilter) {
        return false;
      }
    }
    return true;
  });
}
