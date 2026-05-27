/**
 * 等待新建/恢复后的 VM 在集群中出现，并写入 tower.io/alias（与云主机列表 SafeRead.name 一致）。
 */
import { fetchHarvesterVmDetail, patchHarvesterVm } from '../../../../../../services/harvesterApi';
import { VM_ALIAS_ANNOTATION } from './vmSectionActions';

export const HARVESTER_VM_ALIAS_APPLIED_EVENT = 'harvester:vm-alias-applied';

export type VmAliasAppliedDetail = {
  namespace: string;
  name: string;
  alias: string;
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export function vmAliasInventoryKey(namespace: string, vmName: string): string {
  return `${String(namespace || '').trim()}/${String(vmName || '').trim()}`;
}

/** 将 tower.io/alias 合并进单条 ECS 行（与列表 SafeRead.name / 详情展示一致） */
export function mergeTowerAliasIntoVmRow(
  row: any,
  namespace: string,
  vmName: string,
  alias: string,
): any {
  const trimmed = String(alias || '').trim();
  if (!trimmed) return row;
  const ns = String(row?.metadata?.namespace || row?.namespace || '').trim();
  const name = String(row?.metadata?.name || row?.name || '').trim();
  if (ns !== String(namespace || '').trim() || name !== String(vmName || '').trim()) return row;
  const prevAnn = { ...(row?.metadata?.annotations || {}) };
  if (String(prevAnn[VM_ALIAS_ANNOTATION] || '').trim() === trimmed) return row;
  return {
    ...row,
    metadata: {
      ...(row.metadata || {}),
      namespace: row.metadata?.namespace ?? ns,
      name: row.metadata?.name ?? name,
      annotations: { ...prevAnn, [VM_ALIAS_ANNOTATION]: trimmed },
    },
  };
}

export function mergeTowerAliasIntoVmList(
  list: any[],
  namespace: string,
  vmName: string,
  alias: string,
): any[] {
  const trimmed = String(alias || '').trim();
  if (!trimmed || !namespace || !vmName) return list;
  return (Array.isArray(list) ? list : []).map((row) =>
    mergeTowerAliasIntoVmRow(row, namespace, vmName, alias),
  );
}

/** 通知各页合并列表别名（恢复/克隆提交时即可派发，不必等 PATCH 完成） */
export function dispatchVmAliasApplied(detail: VmAliasAppliedDetail): void {
  const alias = String(detail?.alias || '').trim();
  const namespace = String(detail?.namespace || '').trim();
  const name = String(detail?.name || '').trim();
  if (!alias || !namespace || !name) return;
  window.dispatchEvent(
    new CustomEvent(HARVESTER_VM_ALIAS_APPLIED_EVENT, {
      detail: { namespace, name, alias },
    }),
  );
}

/** 新建恢复：VM 往往在任务完成时才创建，需比常规创建更长的等待窗口 */
export const RESTORE_VM_ALIAS_MAX_WAIT_MS = 3_600_000;

export type HarvesterRestoreTargetAlias = {
  namespace: string;
  vmName: string;
  alias: string;
};

/** 从 VirtualMachineRestore / CephVmRestore 解析「新建模式」目标 VM 与显示别名 */
export function parseHarvesterRestoreTargetAlias(restoreRaw: any): HarvesterRestoreTargetAlias | null {
  if (!restoreRaw) return null;
  const ann = (restoreRaw?.metadata?.annotations || {}) as Record<string, string>;
  const restoreMode = String(ann['tower.io/restoreMode'] || '').trim();
  if (restoreMode && restoreMode !== 'new') return null;

  const isCeph =
    String(restoreRaw?.kind || '').toLowerCase() === 'cephvmrestore' ||
    ann['tower.io/restoreBackend'] === 'ceph' ||
    String(restoreRaw?.apiVersion || '').includes('hms.rivercloud.com');

  if (!restoreMode && isCeph) {
    if (String(restoreRaw?.spec?.restoreType || '') === 'replace') return null;
  } else if (!restoreMode && restoreRaw?.spec?.newVM === false) {
    return null;
  }

  const alias = String(
    ann['tower.io/restoreTargetDisplayName'] || ann['tower.io/targetVmAlias'] || '',
  ).trim();
  if (!alias) return null;

  const restoreTarget = String(ann['tower.io/restoreTarget'] || '').trim();
  if (restoreTarget.includes('/')) {
    const slash = restoreTarget.indexOf('/');
    const ns = restoreTarget.slice(0, slash).trim();
    const vmName = restoreTarget.slice(slash + 1).trim();
    if (ns && vmName) return { namespace: ns, vmName, alias };
  }

  const vmName = isCeph
    ? String(restoreRaw?.spec?.targetVmName || '').trim()
    : String(restoreRaw?.spec?.target?.name || '').trim();
  const namespace = isCeph
    ? String(restoreRaw?.spec?.targetNamespace || restoreRaw?.metadata?.namespace || '').trim()
    : String(restoreRaw?.metadata?.namespace || '').trim();
  if (!namespace || !vmName) return null;
  return { namespace, vmName, alias };
}

/**
 * 恢复任务提交后或完成时：写入 tower.io/alias（VM 可能尚未创建，内部轮询直至可 PATCH）。
 * @returns 是否已成功写入集群
 */
export async function ensureHarvesterRestoreTargetVmAlias(
  cloudId: string,
  restoreRaw: any,
  options?: { maxWaitMs?: number },
): Promise<boolean> {
  const parsed = parseHarvesterRestoreTargetAlias(restoreRaw);
  if (!parsed) return true;
  const { namespace, vmName, alias } = parsed;
  dispatchVmAliasApplied({ namespace, name: vmName, alias });
  return applyVmTowerAliasWhenReady(cloudId, namespace, vmName, alias, {
    maxWaitMs: options?.maxWaitMs ?? RESTORE_VM_ALIAS_MAX_WAIT_MS,
  });
}

function buildAliasJsonPatch(vm: any, alias: string): object[] {
  const trimmed = String(alias || '').trim();
  const hasAnnotations = !!vm?.metadata?.annotations;
  const hasPrev = !!vm?.metadata?.annotations?.[VM_ALIAS_ANNOTATION];
  const aliasPath = '/metadata/annotations/tower.io~1alias';

  if (!trimmed) {
    if (!hasPrev) return [];
    return [{ op: 'remove', path: aliasPath }];
  }

  if (!hasAnnotations) {
    return [{ op: 'add', path: '/metadata/annotations', value: { [VM_ALIAS_ANNOTATION]: trimmed } }];
  }
  if (hasPrev) {
    return [{ op: 'replace', path: aliasPath, value: trimmed }];
  }
  return [{ op: 'add', path: aliasPath, value: trimmed }];
}

/** SSE vm_created / 全量列表拉取时，补上尚未写入集群但用户已填写的显示名 */
export function applyPendingAliasToVmRow(row: any, pending: Map<string, string>): any {
  const ns = String(row?.metadata?.namespace || row?.namespace || '').trim();
  const name = String(row?.metadata?.name || row?.name || '').trim();
  if (!ns || !name) return row;
  const alias = pending.get(vmAliasInventoryKey(ns, name));
  return alias ? mergeTowerAliasIntoVmRow(row, ns, name, alias) : row;
}

function isVmNotFoundError(e: any): boolean {
  const status = Number(e?.status ?? 0);
  const msg = String(e?.message || '').toLowerCase();
  return status === 404 || msg.includes('not found') || msg.includes('404');
}

/**
 * 轮询直至 VM 可 PATCH，写入显示名称别名。
 * @returns 是否已成功写入
 */
export async function applyVmTowerAliasWhenReady(
  cloudId: string,
  namespace: string,
  vmName: string,
  alias: string,
  options?: { maxWaitMs?: number; intervalMs?: number },
): Promise<boolean> {
  const trimmed = String(alias || '').trim();
  if (!trimmed || !namespace || !vmName) return true;

  const maxWaitMs = options?.maxWaitMs ?? 120_000;
  const intervalMs = options?.intervalMs ?? 3_000;
  const deadline = Date.now() + maxWaitMs;

  while (Date.now() < deadline) {
    try {
      const vm = await fetchHarvesterVmDetail(cloudId, namespace, vmName);
      if (vm) {
        const current = String(vm?.metadata?.annotations?.[VM_ALIAS_ANNOTATION] || '').trim();
        if (current === trimmed) {
          dispatchVmAliasApplied({ namespace, name: vmName, alias: trimmed });
          return true;
        }

        const patchBody = buildAliasJsonPatch(vm, trimmed);
        if (patchBody.length === 0) {
          dispatchVmAliasApplied({ namespace, name: vmName, alias: trimmed });
          return true;
        }

        await patchHarvesterVm(
          cloudId,
          namespace,
          vmName,
          patchBody,
          'application/json-patch+json',
        );
        dispatchVmAliasApplied({ namespace, name: vmName, alias: trimmed });
        return true;
      }
    } catch (e: any) {
      if (isVmNotFoundError(e)) {
        await sleep(intervalMs);
        continue;
      }
      throw e;
    }
    await sleep(intervalMs);
  }

  return false;
}
