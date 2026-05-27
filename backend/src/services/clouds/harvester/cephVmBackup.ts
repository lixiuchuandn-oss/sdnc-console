import { HarvesterTestParams } from './types';
import { getHarvesterVM } from './vm';
import {
  classifyVmImageStorageKindByClassName,
  classifyVmImageStorageKindFromProvisioner,
  getHarvesterImage,
  listHarvesterPVCRaw,
  type VmImageStorageKind,
} from './storage';
import { getJsonOnce, requestJson } from './utils';
import { logger } from '../../../utils/logger';

const cephBackupLog = logger.child('Harvester-CephVmBackup');

/** Ceph 备份/快照与恢复均走 hms.rivercloud.com CR；备份与快照共用 CephVmBackup，由 spec.type 区分。 */
const CEPH_VM_BACKUP_API = 'hms.rivercloud.com/v1';
const CEPH_VM_BACKUP_KIND = 'CephVmBackup';
const CEPH_VM_RESTORE_API = 'hms.rivercloud.com/v1';
const CEPH_VM_RESTORE_KIND = 'CephVmRestore';

function harvesterOrigin(endpoint: string): string {
  const base = (endpoint || '').replace(/\/+$/, '');
  try {
    const u = new URL(base);
    return `${u.protocol}//${u.host}`;
  } catch {
    return base.replace(/\/v[0-9].*$/, '');
  }
}

function parseImageIdRef(
  imageId: string,
  defaultNamespace: string,
): { namespace: string; name: string } | null {
  const raw = String(imageId || '').trim();
  if (!raw) return null;
  if (raw.includes('/')) {
    const idx = raw.indexOf('/');
    const ns = raw.slice(0, idx).trim();
    const name = raw.slice(idx + 1).trim();
    if (ns && name) return { namespace: ns, name };
  }
  const name = raw.trim();
  if (name && defaultNamespace) return { namespace: defaultNamespace, name };
  return null;
}

function storageClassNameFromPvc(pvc: any): string {
  return String(
    pvc?.spec?.storageClassName ||
      pvc?.status?.storageClassName ||
      pvc?.metadata?.annotations?.['volume.beta.kubernetes.io/storage-class'] ||
      '',
  ).trim();
}

async function storageKindFromClassName(
  params: HarvesterTestParams,
  storageClassName: string,
): Promise<VmImageStorageKind> {
  const sc = String(storageClassName || '').trim();
  if (!sc) return 'unknown';
  return classifyVmImageStorageKindByClassName(params, sc);
}

/** Harvester 拒绝 rook-ceph 等第三方存储走 VirtualMachineBackup 时，改走 CephVmBackup */
export function shouldFallbackToCephVmBackup(error: any): boolean {
  const parts: string[] = [];
  if (error?.message) parts.push(String(error.message));
  if (error?.body != null) {
    parts.push(typeof error.body === 'string' ? error.body : JSON.stringify(error.body));
  }
  const text = parts.join(' ').toLowerCase();
  if (!text.includes('not supported for type backup')) return false;
  return (
    text.includes('rook-ceph') ||
    text.includes('rbd.csi.ceph.com') ||
    text.includes('cephfs.csi.ceph.com') ||
    text.includes('provisioner') && text.includes('ceph')
  );
}

async function listVmBoundPvcs(
  params: HarvesterTestParams,
  vmNamespace: string,
  vmName: string,
): Promise<any[]> {
  let items: any[] = [];
  try {
    items = await listHarvesterPVCRaw(params);
  } catch (e: any) {
    cephBackupLog.debug('list PVC failed', e?.message || e);
    return [];
  }
  return items.filter((pvc) => {
    const ns = pvc?.metadata?.namespace || '';
    if (ns && ns !== vmNamespace) return false;
    const labels = pvc?.metadata?.labels || {};
    if (labels['harvesterhci.io/vmName'] === vmName) return true;
    if (labels['kubevirt.io/vm'] === vmName) return true;
    const owners = Array.isArray(pvc?.metadata?.ownerReferences) ? pvc.metadata.ownerReferences : [];
    if (owners.some((o: any) => o?.kind === 'VirtualMachine' && o?.name === vmName)) return true;
    const claim = String(pvc?.metadata?.name || '');
    return claim === vmName || claim.startsWith(`${vmName}-`);
  });
}

async function vmUsesCephFromDisks(
  params: HarvesterTestParams,
  vm: any,
  vmNamespace: string,
  vmName: string,
): Promise<boolean> {
  const vcts = Array.isArray(vm?.spec?.volumeClaimTemplates) ? vm.spec.volumeClaimTemplates : [];
  for (const vct of vcts) {
    const sc = String(vct?.spec?.storageClassName || '').trim();
    if (sc && (await storageKindFromClassName(params, sc)) === 'ceph') return true;
  }

  const vols = Array.isArray(vm?.spec?.template?.spec?.volumes) ? vm.spec.template.spec.volumes : [];
  const claimNames = new Set<string>();
  for (const vol of vols) {
    const claim = String(vol?.persistentVolumeClaim?.claimName || '').trim();
    if (claim) claimNames.add(claim);
  }

  const pvcs = await listVmBoundPvcs(params, vmNamespace, vmName);
  for (const pvc of pvcs) {
    const claim = String(pvc?.metadata?.name || '').trim();
    if (claim) claimNames.add(claim);
  }

  for (const claimName of claimNames) {
    const pvc =
      pvcs.find((p) => p?.metadata?.name === claimName) ||
      (await fetchPvcByName(params, vmNamespace, claimName));
    if (!pvc) continue;
    const sc = storageClassNameFromPvc(pvc);
    if (sc && (await storageKindFromClassName(params, sc)) === 'ceph') return true;
    const prov = String(pvc?.metadata?.annotations?.['volume.kubernetes.io/storage-provisioner'] || '');
    if (classifyVmImageStorageKindFromProvisioner(prov) === 'ceph') return true;
  }
  return false;
}

async function fetchPvcByName(
  params: HarvesterTestParams,
  namespace: string,
  name: string,
): Promise<any | null> {
  const origin = harvesterOrigin(params.endpoint || '');
  const url = `${origin}/api/v1/namespaces/${encodeURIComponent(namespace)}/persistentvolumeclaims/${encodeURIComponent(name)}`;
  try {
    return await getJsonOnce(url, params.token || '', params.insecure ?? false, true);
  } catch {
    return null;
  }
}

async function imageStorageKind(
  params: HarvesterTestParams,
  imageNamespace: string,
  imageName: string,
): Promise<VmImageStorageKind> {
  try {
    const img = await getHarvesterImage(params, imageNamespace, imageName);
    if (String(img?.spec?.backend || '').toLowerCase() === 'cdi') return 'ceph';
    const sc =
      String(img?.spec?.targetStorageClassName || '').trim() ||
      String(img?.status?.storageClassName || '').trim() ||
      String(img?.metadata?.annotations?.['harvesterhci.io/storageClassName'] || '').trim();
    if (sc) return await classifyVmImageStorageKindByClassName(params, sc);
  } catch {
    /* ignore */
  }
  return 'unknown';
}

/**
 * 判断虚拟机是否应走 CephVmBackup/CephVmRestore（hms.rivercloud.com），
 * 而非 Harvester VirtualMachineBackup/VirtualMachineRestore。
 * 适用于创建备份、创建快照及对应恢复；依据 VM/磁盘关联镜像或 PVC 为 Ceph/CDI 存储。
 */
export async function vmShouldUseCephVmBackup(
  params: HarvesterTestParams,
  vmNamespace: string,
  vmName: string,
): Promise<boolean> {
  const vm = await getHarvesterVM(params, vmNamespace, vmName);
  const checked = new Set<string>();

  const considerImageId = async (imageId: string | undefined): Promise<boolean> => {
    const ref = parseImageIdRef(String(imageId || ''), vmNamespace);
    if (!ref) return false;
    const key = `${ref.namespace}/${ref.name}`;
    if (checked.has(key)) return false;
    checked.add(key);
    const kind = await imageStorageKind(params, ref.namespace, ref.name);
    return kind === 'ceph';
  };

  if (await considerImageId(vm?.metadata?.annotations?.['harvesterhci.io/imageId'])) return true;
  if (await considerImageId(vm?.spec?.template?.metadata?.annotations?.['harvesterhci.io/imageId'])) {
    return true;
  }

  const vols = Array.isArray(vm?.spec?.template?.spec?.volumes)
    ? vm.spec.template.spec.volumes
    : [];
  for (const vol of vols) {
    if (await considerImageId(vol?.metadata?.annotations?.['harvesterhci.io/imageId'])) return true;
  }

  if (await vmUsesCephFromDisks(params, vm, vmNamespace, vmName)) return true;

  return false;
}

function toCephBackupResourceName(alias: string, kind: 'backup' | 'snapshot' = 'backup'): string {
  const slug = String(alias || '')
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50);
  if (slug && /^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/.test(slug)) return slug;
  const prefix = kind === 'snapshot' ? 'ceph-vms' : 'ceph-vmb';
  return `${prefix}-${Math.random().toString(36).slice(2, 14)}`;
}

/**
 * 将 CephVmBackup 规范化为与 VirtualMachineBackup 相近的结构，供 Tower 列表/详情复用。
 */
export function normalizeCephVmBackupForInventory(item: any): any {
  const srcVm = String(item?.spec?.sourceVm || '').trim();
  const alias = item?.metadata?.annotations?.['tower.io/alias'];
  return {
    ...item,
    apiVersion: item?.apiVersion || CEPH_VM_BACKUP_API,
    kind: CEPH_VM_BACKUP_KIND,
    metadata: {
      ...(item?.metadata || {}),
      annotations: {
        ...(item?.metadata?.annotations || {}),
        'tower.io/backupBackend': 'ceph',
        ...(alias ? { 'tower.io/alias': alias } : {}),
      },
    },
    spec: {
      type: item?.spec?.type || 'backup',
      source: {
        apiGroup: 'kubevirt.io',
        kind: 'VirtualMachine',
        name: srcVm,
      },
      sourceVm: srcVm,
    },
    status: {
      ...(item?.status || {}),
      readyToUse: cephVmBackupReady(item),
      [CEPH_VM_BACKUP_MANAGER_STATUS_KEY]: cephVmBackupManagerStatusValue(item) || undefined,
    },
  };
}

/**
 * CephVmBackup 控制器写入的就绪标记（与 Harvester 控制台一致）。
 * 仅当该键值为 finished（不区分大小写）时，Tower 列表展示「就绪」并允许恢复。
 */
export const CEPH_VM_BACKUP_MANAGER_STATUS_KEY = 'hci.manager.system/vmbackup';

/** 读取 CephVmBackup 上 hci.manager.system/vmbackup 的原始状态值 */
export function cephVmBackupManagerStatusValue(item: any): string {
  if (!item) return '';
  const meta = item.metadata || {};
  const fromAnn = String(meta.annotations?.[CEPH_VM_BACKUP_MANAGER_STATUS_KEY] || '').trim();
  if (fromAnn) return fromAnn;
  const fromLabel = String(meta.labels?.[CEPH_VM_BACKUP_MANAGER_STATUS_KEY] || '').trim();
  if (fromLabel) return fromLabel;

  const st = item.status || {};
  if (st[CEPH_VM_BACKUP_MANAGER_STATUS_KEY] != null) {
    return String(st[CEPH_VM_BACKUP_MANAGER_STATUS_KEY]).trim();
  }

  const conds = Array.isArray(st.conditions) ? st.conditions : [];
  const hit = conds.find(
    (c: any) => String(c?.type || '').trim() === CEPH_VM_BACKUP_MANAGER_STATUS_KEY,
  );
  if (hit) {
    const reason = String(hit?.reason || '').trim();
    if (reason) return reason;
    const status = String(hit?.status || '').trim();
    if (status === 'True') return 'finished';
    return status;
  }
  return '';
}

export function cephVmBackupReady(item: any): boolean {
  return cephVmBackupManagerStatusValue(item).toLowerCase() === 'finished';
}

export function isCephVmBackupResource(item: any): boolean {
  if (!item) return false;
  const kind = String(item?.kind || '').toLowerCase();
  if (kind === 'cephvmbackup') return true;
  if (kind === 'virtualmachinebackup') return false;
  return String(item?.metadata?.annotations?.['tower.io/backupBackend'] || '') === 'ceph';
}

export function isCephVmRestoreResource(item: any): boolean {
  const kind = String(item?.kind || '').toLowerCase();
  const api = String(item?.apiVersion || '').toLowerCase();
  return kind === 'cephvmrestore' || String(item?.metadata?.annotations?.['tower.io/restoreBackend'] || '') === 'ceph';
}

/** VirtualMachineRestore 因找不到 VirtualMachineBackup 失败时，改走 CephVmRestore */
export function shouldFallbackToCephVmRestore(error: any): boolean {
  const parts: string[] = [];
  if (error?.message) parts.push(String(error.message));
  if (error?.body != null) {
    parts.push(typeof error.body === 'string' ? error.body : JSON.stringify(error.body));
  }
  const text = parts.join(' ').toLowerCase();
  return (
    text.includes('virtualmachinebackups') &&
    (text.includes('not found') || text.includes("can't get vmbackup"))
  );
}

function toCephRestoreResourceName(alias: string): string {
  const slug = String(alias || '')
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50);
  if (slug && /^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/.test(slug)) return slug;
  return `ceph-vmr-${Math.random().toString(36).slice(2, 14)}`;
}

/**
 * 与 Longhorn 恢复弹窗一致：新建 → create，替换 → replace。
 * 优先读 tower.io/restoreMode（new/replace），再读 spec.newVM，最后用 target 与 sourceVm 是否同名推断。
 */
export function resolveCephVmRestoreType(
  towerPayload: any,
  sourceVm: string,
): 'create' | 'replace' {
  const mode = String(towerPayload?.metadata?.annotations?.['tower.io/restoreMode'] || '')
    .trim()
    .toLowerCase();
  if (mode === 'new') return 'create';
  if (mode === 'replace') return 'replace';

  const spec = towerPayload?.spec || {};
  if (spec.newVM === true || spec.newVM === 'true') return 'create';
  if (spec.newVM === false || spec.newVM === 'false') return 'replace';

  const target = String(spec?.target?.name || '').trim();
  const src = String(sourceVm || '').trim();
  if (target && src && target === src) return 'replace';
  return 'create';
}

/**
 * 将 Tower 提交的 VirtualMachineRestore 表单载荷转为 CephVmRestore CR（与 vm-restore CRD 对齐）。
 */
export function buildHarvesterCephVmRestoreBody(
  towerPayload: any,
  ctx: {
    sourceVm: string;
    backupName: string;
    backupNamespace: string;
    resourceType: 'backup' | 'snapshot';
  },
): Record<string, unknown> {
  const spec = towerPayload?.spec || {};
  const meta = towerPayload?.metadata || {};
  const restoreNs = String(meta.namespace || ctx.backupNamespace || 'default').trim();
  const targetVmName = String(spec?.target?.name || '').trim();
  const restoreType = resolveCephVmRestoreType(towerPayload, ctx.sourceVm);
  const keepMac = spec.keepMacAddress === true;

  const restoreMetaName = toCephRestoreResourceName(
    String(meta.name || `restore-${ctx.backupName}`),
  );

  const towerAnn =
    typeof meta.annotations === 'object' && meta.annotations ? { ...meta.annotations } : {};
  const targetDisplay = String(towerAnn['tower.io/restoreTargetDisplayName'] || '').trim();
  if (targetDisplay && restoreType === 'create') {
    towerAnn['tower.io/targetVmAlias'] = targetDisplay;
  }

  return {
    apiVersion: CEPH_VM_RESTORE_API,
    kind: CEPH_VM_RESTORE_KIND,
    metadata: {
      name: restoreMetaName,
      namespace: restoreNs,
      annotations: {
        ...towerAnn,
        'tower.io/restoreTask': 'true',
        'tower.io/restoreBackend': 'ceph',
        'tower.io/restoreSource': `${ctx.backupNamespace}/${ctx.backupName}`,
      },
    },
    spec: {
      sourceVm: ctx.sourceVm,
      backupName: ctx.backupName,
      restoreType,
      type: ctx.resourceType === 'snapshot' ? 'snapshot' : 'backup',
      targetNamespace: restoreNs,
      targetVmName,
      retainMac: keepMac,
    },
  };
}

export async function findCephVmBackupByName(
  params: HarvesterTestParams,
  namespace: string,
  name: string,
): Promise<any | null> {
  const items = await listHarvesterCephVmBackupsRaw(params);
  return (
    items.find((b) => b?.metadata?.namespace === namespace && b?.metadata?.name === name) || null
  );
}

export function resolveCephBackupSourceVm(backupRecord: any, cephRaw?: any): string {
  const raw = cephRaw || backupRecord?.rawData || backupRecord;
  return String(
    backupRecord?.sourceVm ||
      raw?.spec?.sourceVm ||
      raw?.spec?.source?.name ||
      '',
  ).trim();
}

export async function listHarvesterCephVmBackupsRaw({
  endpoint,
  token,
  insecure = false,
}: HarvesterTestParams): Promise<any[]> {
  const origin = harvesterOrigin(endpoint || '');
  const candidates = [
    `${origin}/apis/${CEPH_VM_BACKUP_API}/cephvmbackups`,
    `${origin}/v1/hms.rivercloud.com.cephvmbackups`,
  ];
  for (const url of candidates) {
    try {
      const json = await getJsonOnce(url, token, insecure, true);
      const items = Array.isArray(json?.items)
        ? json.items
        : Array.isArray(json?.data)
          ? json.data
          : [];
      if (items.length >= 0) return items;
    } catch (e: any) {
      if (Number(e?.status) === 404) continue;
    }
  }
  return [];
}

export async function createHarvesterCephVmBackup(
  params: HarvesterTestParams,
  namespace: string,
  payload: {
    name: string;
    vmName: string;
    type: 'backup' | 'snapshot';
    alias?: string;
  },
): Promise<any> {
  const origin = harvesterOrigin(params.endpoint || '');
  const backupKind = payload.type === 'snapshot' ? 'snapshot' : 'backup';
  const resourceName = toCephBackupResourceName(
    payload.name || payload.alias || (backupKind === 'snapshot' ? 'ceph-snapshot' : 'ceph-backup'),
    backupKind,
  );
  const body = {
    apiVersion: CEPH_VM_BACKUP_API,
    kind: CEPH_VM_BACKUP_KIND,
    metadata: {
      name: resourceName,
      namespace,
      annotations: {
        'tower.io/alias': payload.alias || payload.name,
        'tower.io/backupBackend': 'ceph',
      },
    },
    spec: {
      sourceVm: payload.vmName,
      type: backupKind,
    },
  };

  const candidates = [
    `${origin}/apis/${CEPH_VM_BACKUP_API}/namespaces/${encodeURIComponent(namespace)}/cephvmbackups`,
    `${origin}/v1/hms.rivercloud.com.cephvmbackups/${encodeURIComponent(namespace)}`,
  ];
  let lastErr: any = null;
  for (const url of candidates) {
    try {
      return await requestJson('POST', url, params.token || '', params.insecure ?? false, body);
    } catch (e: any) {
      lastErr = e;
      if (Number(e?.status) === 404) continue;
    }
  }
  throw lastErr || new Error('创建 CephVmBackup 失败：集群未安装 hms.rivercloud.com CephVmBackup CRD');
}

export async function deleteHarvesterCephVmBackup(
  params: HarvesterTestParams,
  namespace: string,
  name: string,
): Promise<any> {
  const origin = harvesterOrigin(params.endpoint || '');
  const candidates = [
    `${origin}/apis/${CEPH_VM_BACKUP_API}/namespaces/${encodeURIComponent(namespace)}/cephvmbackups/${encodeURIComponent(name)}`,
    `${origin}/v1/hms.rivercloud.com.cephvmbackups/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}`,
  ];
  let lastErr: any = null;
  for (const url of candidates) {
    try {
      return await requestJson('DELETE', url, params.token || '', params.insecure ?? false);
    } catch (e: any) {
      lastErr = e;
      if (Number(e?.status) === 404) continue;
    }
  }
  throw lastErr || new Error(`删除 CephVmBackup ${namespace}/${name} 失败`);
}

export async function listHarvesterCephVmRestoresRaw({
  endpoint,
  token,
  insecure = false,
}: HarvesterTestParams): Promise<any[]> {
  const origin = harvesterOrigin(endpoint || '');
  const candidates = [
    `${origin}/apis/${CEPH_VM_RESTORE_API}/cephvmrestores`,
    `${origin}/v1/hms.rivercloud.com.cephvmrestores`,
  ];
  for (const url of candidates) {
    try {
      const json = await getJsonOnce(url, token, insecure, true);
      const items = Array.isArray(json?.items)
        ? json.items
        : Array.isArray(json?.data)
          ? json.data
          : [];
      if (items.length >= 0) return items;
    } catch (e: any) {
      if (Number(e?.status) === 404) continue;
    }
  }
  return [];
}

export async function deleteHarvesterCephVmRestore(
  params: HarvesterTestParams,
  namespace: string,
  name: string,
): Promise<any> {
  const origin = harvesterOrigin(params.endpoint || '');
  const candidates = [
    `${origin}/apis/${CEPH_VM_RESTORE_API}/namespaces/${encodeURIComponent(namespace)}/cephvmrestores/${encodeURIComponent(name)}`,
    `${origin}/v1/hms.rivercloud.com.cephvmrestores/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}`,
  ];
  let lastErr: any = null;
  for (const url of candidates) {
    try {
      return await requestJson('DELETE', url, params.token || '', params.insecure ?? false);
    } catch (e: any) {
      lastErr = e;
      if (Number(e?.status) === 404) continue;
    }
  }
  throw lastErr || new Error(`删除 CephVmRestore ${namespace}/${name} 失败`);
}

export async function createHarvesterCephVmRestore(
  params: HarvesterTestParams,
  namespace: string,
  body: Record<string, unknown>,
): Promise<any> {
  const origin = harvesterOrigin(params.endpoint || '');
  const ns = String((body as any)?.metadata?.namespace || namespace);
  const candidates = [
    `${origin}/apis/${CEPH_VM_RESTORE_API}/namespaces/${encodeURIComponent(ns)}/cephvmrestores`,
    `${origin}/v1/hms.rivercloud.com.cephvmrestores/${encodeURIComponent(ns)}`,
  ];
  let lastErr: any = null;
  for (const url of candidates) {
    try {
      return await requestJson('POST', url, params.token || '', params.insecure ?? false, body);
    } catch (e: any) {
      lastErr = e;
      if (Number(e?.status) === 404) continue;
    }
  }
  throw lastErr || new Error('创建 CephVmRestore 失败：集群未安装 hms.rivercloud.com CephVmRestore CRD');
}
