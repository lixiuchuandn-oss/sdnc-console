import type { VmListSafeRead } from './vmSafeRead';

export const VM_DELETION_PROTECTION_FINALIZER = 'tower.io/deletion-protection';
export const VM_IMPORTANT_LABEL = 'tower.io/important';
export const VM_ALIAS_ANNOTATION = 'tower.io/alias';

export type VmNsName = { ns: string; name: string };

/** 从 iid 或 record + SafeRead 解析 namespace / name */
export function resolveVmNsName(
  iid: string,
  record: any,
  safeRead: Pick<VmListSafeRead, 'namespace' | 'vmId'>,
): VmNsName {
  if (iid.includes('/')) {
    const [ns, name] = iid.split('/');
    return { ns: ns || '', name: name || '' };
  }
  return {
    ns: safeRead.namespace(record),
    name: safeRead.vmId(record),
  };
}

export function isVmDeletionProtected(record: any): boolean {
  const finalizers = record?.metadata?.finalizers || [];
  if (finalizers.includes(VM_DELETION_PROTECTION_FINALIZER)) return true;
  return record?.metadata?.labels?.[VM_IMPORTANT_LABEL] === 'true';
}

/** JSON Patch：切换重要实例 / 防删 finalizer */
export function buildVmImportantTogglePatch(record: any): any[] {
  const finalizers = record?.metadata?.finalizers || [];
  const isProtected = finalizers.includes(VM_DELETION_PROTECTION_FINALIZER);
  const patchBody: any[] = [];

  if (isProtected) {
    const indices: number[] = [];
    finalizers.forEach((f: string, i: number) => {
      if (f === VM_DELETION_PROTECTION_FINALIZER) indices.push(i);
    });
    indices.sort((a, b) => b - a).forEach((idx) => {
      patchBody.push({ op: 'remove', path: `/metadata/finalizers/${idx}` });
    });
    patchBody.push({ op: 'remove', path: '/metadata/labels/tower.io~1important' });
  } else if (!record?.metadata?.finalizers) {
    patchBody.push({
      op: 'add',
      path: '/metadata/finalizers',
      value: [VM_DELETION_PROTECTION_FINALIZER],
    });
    patchBody.push({
      op: 'add',
      path: '/metadata/labels/tower.io~1important',
      value: 'true',
    });
  } else {
    patchBody.push({
      op: 'add',
      path: '/metadata/finalizers/-',
      value: VM_DELETION_PROTECTION_FINALIZER,
    });
    patchBody.push({
      op: 'add',
      path: '/metadata/labels/tower.io~1important',
      value: 'true',
    });
  }

  return patchBody;
}

export type VmAliasPatchResult =
  | { kind: 'noop' }
  | { kind: 'patch'; patchBody: any[] }
  | { kind: 'error'; message: string };

/** JSON Patch：修改 tower.io/alias */
export function buildVmAliasPatch(record: any, nextAliasRaw?: string): VmAliasPatchResult {
  const next = String(nextAliasRaw || '').trim();
  const prev = String(record?.metadata?.annotations?.[VM_ALIAS_ANNOTATION] || '').trim();
  if (next === prev) return { kind: 'noop' };

  const hasAnnotations = !!record?.metadata?.annotations;
  const hasPrev = !!record?.metadata?.annotations?.[VM_ALIAS_ANNOTATION];
  const aliasPath = '/metadata/annotations/tower.io~1alias';
  const patchBody: any[] = [];

  if (!next) {
    if (hasPrev) patchBody.push({ op: 'remove', path: aliasPath });
  } else if (!hasAnnotations) {
    patchBody.push({
      op: 'add',
      path: '/metadata/annotations',
      value: { [VM_ALIAS_ANNOTATION]: next },
    });
  } else {
    patchBody.push({ op: 'add', path: aliasPath, value: next });
  }

  if (patchBody.length === 0) return { kind: 'noop' };
  return { kind: 'patch', patchBody };
}

/** 删除确认弹窗：关联 PVC 名称列表 */
export function listVmPvcClaimNames(record: any): string {
  const volumes = (record?.spec?.template?.spec?.volumes || []).filter(
    (v: any) => v.persistentVolumeClaim,
  );
  return volumes.map((v: any) => v.persistentVolumeClaim.claimName).join(', ');
}

export function partitionVmBatchRecycleTargets(targets: any[]): {
  protectedTargets: any[];
  deletableTargets: any[];
} {
  const protectedTargets = targets.filter(isVmDeletionProtected);
  const deletableTargets = targets.filter((r) => !protectedTargets.includes(r));
  return { protectedTargets, deletableTargets };
}

export type BatchVmOpResult = { ok: boolean; iid: string; err?: string; name?: string };

export async function mapBatchVmOperation(
  targets: any[],
  getInstanceId: (r: any) => string,
  op: (record: any, iid: string) => Promise<void>,
): Promise<BatchVmOpResult[]> {
  const results: BatchVmOpResult[] = [];
  for (const r of targets) {
    const iid = getInstanceId(r);
    try {
      await op(r, iid);
      results.push({ ok: true, iid });
    } catch (e: any) {
      results.push({ ok: false, iid, err: e?.message || String(e) });
    }
  }
  return results;
}

export function summarizeBatchRecycleMessage(
  results: BatchVmOpResult[],
  protectedTargets: any[],
  nameOf: (r: any) => string,
): { success?: string; error?: string } {
  const okResults = results.filter((x) => x.ok);
  const failResults = results.filter((x) => !x.ok);
  let success: string | undefined;
  let error: string | undefined;

  let summaryMsg = '';
  if (okResults.length > 0) {
    const okNames = okResults.map((r) => r.name || r.iid).join(', ');
    summaryMsg += `成功移入 ${okResults.length} 个（${okNames}）虚拟机到回收站，到期后自动删除`;
  }
  if (protectedTargets.length > 0) {
    const protectedNames = protectedTargets.map(nameOf).join(', ');
    if (summaryMsg) summaryMsg += '，';
    summaryMsg += `跳过 ${protectedTargets.length} 个（受防删保护）：${protectedNames}`;
  }
  if (summaryMsg) success = summaryMsg;
  if (failResults.length > 0) {
    const failNames = failResults.map((r) => r.name || r.iid).join(', ');
    error = `移入回收站失败 ${failResults.length} 台：${failNames}`;
  }
  return { success, error };
}

export function isVmHostnamePinned(nodeSelector: any, affinity: any): boolean {
  if (nodeSelector?.['kubernetes.io/hostname']) return true;
  if (
    affinity &&
    Array.isArray(affinity.nodeSelectorTerms) &&
    affinity.nodeSelectorTerms.some(
      (t: any) =>
        Array.isArray(t?.matchExpressions) &&
        t.matchExpressions.some(
          (e: any) =>
            String(e?.key) === 'kubernetes.io/hostname' &&
            String(e?.operator).toLowerCase() === 'in' &&
            Array.isArray(e?.values) &&
            e.values.length === 1,
        ),
    )
  ) {
    return true;
  }
  return false;
}

export function countMatchingHarvesterNodes(nodeSelector: Record<string, string>, nodes: any[]): number {
  const selectorKeys = Object.keys(nodeSelector || {});
  if (selectorKeys.length === 0) return nodes.length;
  return nodes.filter((n: any) => {
    const labels = n?.metadata?.labels || {};
    return selectorKeys.every(
      (k) => String(labels[k] || '') === String(nodeSelector[k] || ''),
    );
  }).length;
}

export function buildHarvesterNadTypeMap(nadItems: any[], vmNamespace?: string): Record<string, string> {
  const typeMap: Record<string, string> = {};
  nadItems.forEach((x: any) => {
    const name = x?.metadata?.name || x?.name;
    const ns = x?.metadata?.namespace || x?.namespace;
    let type = '';
    try {
      const cfg = JSON.parse(x?.spec?.config || '{}');
      type = String(cfg?.type || '').toLowerCase();
    } catch {
      /* ignore */
    }
    if (ns && name) {
      typeMap[`${ns}/${name}`] = type;
      if (vmNamespace && ns === vmNamespace) typeMap[name] = type;
    } else if (name) {
      typeMap[name] = type;
    }
  });
  return typeMap;
}

export function isVmMigrateNetworkBlocked(spec: any, nadTypeMap: Record<string, string>): boolean {
  const interfaces = spec?.domain?.devices?.interfaces || [];
  if (interfaces.some((i: any) => i?.sriov || i?.macvtap)) return true;
  const nets = Array.isArray(spec?.networks) ? spec.networks : [];
  const multusNames = nets.map((n: any) => n?.multus?.networkName).filter(Boolean);
  return multusNames.some((k: string) =>
    ['sriov', 'macvtap'].includes(String(nadTypeMap[k] || '').toLowerCase()),
  );
}

export type VmMigrateAssessment =
  | { allowed: true }
  | { allowed: false; reason: string };

type FetchHarvesterNodes = (cloudId: string, skipCache: boolean) => Promise<any>;
type FetchHarvesterNads = (cloudId: string, skipCache: boolean) => Promise<any>;

/** 热迁移前置检查（含按需拉取 nodes / NAD） */
export async function assessVmMigrateEligibility(
  record: any,
  cloudId: string,
  fetchNodes: FetchHarvesterNodes,
  fetchNads: FetchHarvesterNads,
): Promise<VmMigrateAssessment> {
  const statusStr = String(
    record?.status?.printableStatus || record?.status?.phase || '',
  ).toLowerCase();
  if (statusStr !== 'running') {
    return { allowed: false, reason: '只有运行中的实例才能进行热迁移' };
  }

  const spec = record?.spec?.template?.spec || {};
  const nodeSelector = spec?.nodeSelector || {};
  const affinity =
    spec?.affinity?.nodeAffinity?.requiredDuringSchedulingIgnoredDuringExecution || null;

  if (isVmHostnamePinned(nodeSelector, affinity)) {
    return { allowed: false, reason: '当前实例绑定了特定节点，不支持热迁移' };
  }

  const selectorKeys = Object.keys(nodeSelector || {});
  if (selectorKeys.length > 0) {
    try {
      const json = await fetchNodes(cloudId, false);
      const items: any[] = Array.isArray(json?.data?.items) ? json.data.items : [];
      if (countMatchingHarvesterNodes(nodeSelector, items) <= 1) {
        return { allowed: false, reason: '当前实例的节点标签约束导致无可迁移的目标节点' };
      }
    } catch {
      /* ignore fetch errors; skip this check */
    }
  }

  const vmNamespace = record?.metadata?.namespace || record?.namespace || '';
  let nadTypeMap: Record<string, string> = {};
  const nets = Array.isArray(spec?.networks) ? spec.networks : [];
  const multusNames = nets.map((n: any) => n?.multus?.networkName).filter(Boolean);
  const interfaces = spec?.domain?.devices?.interfaces || [];
  const needsNadLookup =
    interfaces.some((i: any) => i?.sriov || i?.macvtap) || multusNames.length > 0;

  if (needsNadLookup) {
    if (interfaces.some((i: any) => i?.sriov || i?.macvtap)) {
      return {
        allowed: false,
        reason: '当前实例使用了不支持热迁移的网络接口 (SR-IOV/Macvtap)',
      };
    }
    try {
      const nadJson = await fetchNads(cloudId, false);
      const nadItems: any[] = Array.isArray(nadJson?.data?.items)
        ? nadJson.data.items
        : Array.isArray(nadJson?.items)
          ? nadJson.items
          : [];
      nadTypeMap = buildHarvesterNadTypeMap(nadItems, vmNamespace);
    } catch {
      /* ignore */
    }
    if (isVmMigrateNetworkBlocked(spec, nadTypeMap)) {
      return {
        allowed: false,
        reason: '当前实例使用了不支持热迁移的网络接口 (SR-IOV/Macvtap)',
      };
    }
  }

  return { allowed: true };
}

/** 列表「创建时间 / 删除时间」格式化 */
export function formatVmListTimestamp(value: string | number | Date | undefined | null): string {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');
  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}
