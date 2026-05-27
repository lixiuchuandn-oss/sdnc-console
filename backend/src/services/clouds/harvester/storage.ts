import { logger } from '../../../utils/logger';
import { HarvesterTestParams } from './types';
import { getJsonOnce, requestJson } from './utils';

const harvesterStorageLog = logger.child('Harvester-Storage');

/**
 * ==============================================================================
 * 模块名称: Harvester 存储与资源管理服务
 * 文件路径: backend/src/services/clouds/harvester/storage.ts
 * ==============================================================================
 *
 * [功能描述]
 * 提供对 Harvester/Kubernetes 存储资源及相关核心对象（镜像、快照、备份、命名空间等）
 * 的 CRUD 操作封装。支持标准化的资源列表获取、生命周期管理及复杂业务逻辑（如克隆、恢复）。
 *
 * [核心逻辑]
 * 1. [存储卷管理]: 支持 PVC 创建/扩容/删除、Longhorn 底层卷管理及可用卷筛选。
 * 2. [镜像管理]: 提供镜像列表的原始与标准化查询，支持从 PVC 导出镜像。
 * 3. [快照与备份]: 封装 VM 快照/备份、卷快照 (VolumeSnapshot) 及定时备份计划 (ScheduleVMBackup) 的完整生命周期。
 * 4. [命名空间]: 提供命名空间的创建与查询，支持多 API 路径兼容。
 * 5. [多版本兼容]: 针对 Harvester 不同版本 (v1alpha1/v1beta1) 自动适配 API 路径。
 *
 * [API 依赖]
 * - Harvester API (v1beta1/v1)
 * - Kubernetes Core API (v1)
 * - Snapshot Controller API (snapshot.storage.k8s.io)
 * - Longhorn API
 * ==============================================================================
 */

/**
 * [PVC 原始列表]
 * 获取 Harvester 原始 PVC (PersistentVolumeClaim) 列表。
 *
 * [核心逻辑]
 * 1. 尝试通过 K8s 原生 API 和 Harvester 代理 API 获取 PVC 列表。
 * 2. 返回原始 JSON 对象数组，不做额外字段映射。
 *
 * @param params 连接参数 (endpoint, token, insecure)
 * @returns Promise<any[]> 原始 PVC 对象数组
 */
export const listHarvesterPVCRaw = async ({
  endpoint,
  token,
  insecure = false,
}: HarvesterTestParams): Promise<any[]> => {
  const base = (endpoint || '').replace(/\/+$/, '');
  let origin = base;
  try {
    const u = new URL(base);
    origin = `${u.protocol}//${u.host}`;
  } catch {
    origin = base.replace(/\/v[0-9].*$/, '');
  }
  // [多路径兼容] Harvester 使用标准 K8s PVC，但也通过 Harvester API 暴露
  const candidates = [
    `${origin}/api/v1/persistentvolumeclaims`, // Cluster-wide list
    `${origin}/v1/harvester/core.v1.persistentvolumeclaims`,
  ];
  let json: any = null;
  let lastErr: any = null;
  for (const url of candidates) {
    try {
      json = await getJsonOnce(url, token, insecure);
      if (json) {
        // const count = Array.isArray(json?.items) ? json.items.length : (Array.isArray(json?.data) ? json.data.length : 0);
        break;
      }
    } catch (e: any) {
      harvesterStorageLog.debug(`存储卷候选 URL 失败: ${url}`, e?.message ?? String(e));
      lastErr = e;
    }
  }
  if (!json && lastErr) {
    throw lastErr;
  }
  return Array.isArray(json?.items) ? json.items : [];
};

/**
 * [PVC 标准列表]
 * 获取 Harvester 标准化卷列表（基于 PVC），包含前端所需的视图链接。
 *
 * [核心逻辑]
 * 1. 调用 listHarvesterPVCRaw 获取原始数据。
 * 2. [数据映射] 注入 `links.view` 字段，指向 Harvester UI 的 PVC 详情页。
 *
 * @param params 连接参数
 * @returns Promise<any[]> 标准化卷对象数组
 */
export const listHarvesterVolumesStandard = async (
  params: HarvesterTestParams
): Promise<any[]> => {
  const items = await listHarvesterPVCRaw(params);
  const base = (params.endpoint || '').replace(/\/+$/, '');
  let origin = base;
  try {
    const u = new URL(base);
    origin = `${u.protocol}//${u.host}`;
  } catch {
    origin = base.replace(/\/v[0-9].*$/, '');
  }

  return items.map((v: any) => {
    const name = v?.metadata?.name || v?.name || '';
    const ns = v?.metadata?.namespace || v?.namespace || '';
    const viewUrl = `${origin}/api/v1/namespaces/${ns}/persistentvolumeclaims/${name}`;
    
    return {
        ...v,
        links: {
            ...(v.links || {}),
            view: viewUrl
        }
    };
  });
};

/** 从 KubeVirt VM 列表构建「已被虚拟机引用」的 PVC 键集合（namespace/pvcName）。 */
export function buildUsedPvcSetFromKubevirtVms(allVms: any[]): Set<string> {
  const usedPvcSet = new Set<string>();
  for (const vm of allVms || []) {
    const vmNs = vm?.metadata?.namespace || '';
    const volumes = vm?.spec?.template?.spec?.volumes || [];
    for (const vol of volumes) {
      const claimName = vol?.persistentVolumeClaim?.claimName;
      if (claimName && vmNs) {
        usedPvcSet.add(`${vmNs}/${claimName}`);
      }
    }
  }
  return usedPvcSet;
}

/** 将 PVC 对象映射为 available-volumes 接口统一字段。 */
export function mapHarvesterPvcToAvailableVolumeItem(v: any): any {
  const name = v?.metadata?.name || v?.name || '';
  const ns = v?.metadata?.namespace || v?.namespace || '';
  const size =
    v?.status?.capacity?.storage ||
    v?.spec?.resources?.requests?.storage ||
    v?.spec?.size ||
    v?.size ||
    0;
  const state = String(v?.status?.phase || v?.phase || v?.status?.state || '').toLowerCase();
  const workloads = v?.status?.workloadsStatus || v?.status?.workloadStatus || [];
  const inUse =
    Array.isArray(workloads) &&
    workloads.some(
      (w: any) => String(w?.state || w?.podStatus || '').toLowerCase() === 'running',
    );
  const attached = state === 'attached' || inUse;
  const pvcName = v?.status?.kubernetesStatus?.pvcName || name;
  return {
    ...v,
    name,
    pvcName,
    namespace: ns,
    size,
    state,
    phase: state,
    attached,
  };
}

/**
 * 筛选可挂到虚拟机的卷：Bound/可用阶段、无运行中 workload、未被任何 VM 引用。
 */
export function filterHarvesterAvailableVolumeItems(
  items: any[],
  usedPvcSet: Set<string>,
): any[] {
  const blockedPhases = new Set(['lost', 'failed', 'terminating', 'pending', 'released']);
  const okPhases = new Set(['bound', 'available', 'detached', 'healthy']);

  return (items || [])
    .map((item) => {
      const pvcKey = `${item.namespace}/${item.pvcName || item.name}`;
      return { ...item, isUsedByVm: usedPvcSet.has(pvcKey) };
    })
    .filter((x: any) => {
      if (!x.pvcName || !x.namespace) return false;
      const st = String(x.state || '').toLowerCase();
      if (blockedPhases.has(st)) return false;
      if (st && !okPhases.has(st)) return false;
      if (x.attached) return false;
      if (x.isUsedByVm) return false;
      return true;
    });
}

/**
 * [可用卷列表]
 * 获取 Harvester 可用卷列表（Longhorn 卷），用于挂载到虚拟机。
 *
 * [业务规则]
 * 1. [数据源]: 仅列出 Longhorn 卷 (longhorn.io/volumes)。
 * 2. [状态过滤]: 排除已挂载 (attached) 或正在使用 (inUse) 的卷。
 * 3. [命名空间] 支持按命名空间筛选。
 *
 * @param params 连接参数
 * @param opts 过滤选项（如 namespace）
 * @returns Promise<any[]> 可用卷对象数组
 */
export const listHarvesterAvailableVolumesStandard = async (
  { endpoint, token, insecure = false }: HarvesterTestParams,
  opts: { namespace?: string } = {},
): Promise<any[]> => {
  const base = (endpoint || '').replace(/\/+$/, '');
  let origin = base;
  try {
    const u = new URL(base);
    origin = `${u.protocol}//${u.host}`;
  } catch {
    origin = base.replace(/\/v[0-9].*$/, '');
  }
  const candidates = [
    `${origin}/v1/longhorn.io.volumes`,
    `${origin}/v1/harvester/longhorn.io.volumes`,
    `${origin}/apis/longhorn.io/v1beta1/volumes`,
  ];
  let json: any = null;
  let lastErr: any = null;
  for (const url of candidates) {
    try {
      json = await getJsonOnce(url, token, insecure);
      if (json) {
        // const count = Array.isArray(json?.items) ? json.items.length : (Array.isArray(json?.data) ? json.data.length : 0);
        break;
      }
    } catch (e: any) {
      harvesterStorageLog.debug(`可用卷候选 URL 失败: ${url}`, e?.message ?? String(e));
      lastErr = e;
    }
  }
  if (!json && lastErr) {
    throw lastErr;
  }
  const items = Array.isArray(json?.data)
    ? json?.data
    : Array.isArray(json?.items)
      ? json?.items
      : [];
  const nsFilter = String(opts?.namespace || '').trim();
  return items
    .map((v: any) => {
      const name =
        v?.status?.kubernetesStatus?.volumeName || v?.name || v?.id || v?.metadata?.name || '';
      const ns =
        v?.status?.kubernetesStatus?.namespace || v?.metadata?.namespace || v?.namespace || '';
      const size = v?.spec?.size || v?.size || 0;
      const state = String(v?.status?.state || v?.state || '').toLowerCase();
      const workloads = v?.status?.workloadsStatus || v?.status?.workloadStatus || [];
      const inUse =
        Array.isArray(workloads) &&
        workloads.some(
          (w: any) => String(w?.state || w?.podStatus || '').toLowerCase() === 'running',
        );
      const attached = state === 'attached' || inUse;
      const pvcName = v?.status?.kubernetesStatus?.pvcName || '';
      return { 
        name, 
        pvcName, 
        namespace: ns, 
        size, 
        state, 
        attached,
        workloadsStatus: workloads, // [修复] 保留 workloadsStatus 信息，用于过滤回收站虚拟机的卷
      };
    })
    // [逻辑过滤] 仅保留未挂载且符合命名空间的卷
    .filter((x: any) => !x.attached)
    .filter((x: any) => !nsFilter || x.namespace === nsFilter);
};

/**
 * [存储类列表]
 * 获取 Harvester 存储类 (StorageClass) 列表。
 *
 * [核心逻辑]
 * 1. 尝试多条 API 路径获取 StorageClass。
 * 2. 映射 provisioner 字段，兼容不同的驱动命名。
 *
 * @param params 连接参数
 * @returns Promise<any[]> 存储类对象数组
 */
export const listHarvesterStorageClassesStandard = async ({
  endpoint,
  token,
  insecure = false,
}: HarvesterTestParams): Promise<any[]> => {
  const base = (endpoint || '').replace(/\/+$/, '');
  let origin = base;
  try {
    const u = new URL(base);
    origin = `${u.protocol}//${u.host}`;
  } catch {
    origin = base.replace(/\/v[0-9].*$/, '');
  }
  const candidates = [
    `${origin}/v1/storage.k8s.io.storageclasses`,
    `${origin}/v1/harvester/storage.k8s.io.storageclasses`,
    `${origin}/apis/storage.k8s.io/v1/storageclasses`,
  ];
  let json: any = null;
  let lastErr: any = null;
  for (const url of candidates) {
    try {
      json = await getJsonOnce(url, token, insecure);
      if (json) {
        // const count = Array.isArray(json?.items) ? json.items.length : (Array.isArray(json?.data) ? json.data.length : 0);
        break;
      }
    } catch (e: any) {
      harvesterStorageLog.debug(`存储类候选 URL 失败: ${url}`, e?.message ?? String(e));
      lastErr = e;
    }
  }
  if (!json && lastErr) {
    throw lastErr;
  }
  const items = Array.isArray(json?.data)
    ? json?.data
    : Array.isArray(json?.items)
      ? json?.items
      : [];
  return items
    .map((sc: any) => {
        const name = sc?.metadata?.name || sc?.name || '';
        return {
            name,
            provisioner: sc?.provisioner || sc?.driver || '',
            links: {
                view: `${origin}/apis/storage.k8s.io/v1/storageclasses/${name}`
            }
        };
    })
    .filter((x: any) => !!x.name);
};

/** 与前端 isSystemStorageClass 一致：镜像/VM 业务应使用用户可选存储池 */
function isSystemStorageClassName(name: string): boolean {
  const n = String(name || '').toLowerCase();
  if (['vmstate-persistence', 'longhorn-static', 'harvester-longhorn'].includes(n)) return true;
  if (n.startsWith('image-')) return true;
  if (n.startsWith('longhorn-image-')) return true;
  if (/^longhorn-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(n)) return true;
  if (n.startsWith('longhorn-') && /-[0-9]{13,}$/.test(n)) return true;
  return false;
}

function storageClassRecordName(sc: any): string {
  return String(sc?.metadata?.name ?? sc?.name ?? '').trim();
}

/** 是否被 K8s 标记为 default StorageClass */
export function isClusterDefaultStorageClassRecord(sc: any): boolean {
  const meta = sc?.metadata?.annotations || {};
  const top = sc?.annotations || {};
  const flag =
    meta['storageclass.kubernetes.io/is-default-class'] ??
    meta['storageclass.beta.kubernetes.io/is-default-class'] ??
    top['storageclass.kubernetes.io/is-default-class'] ??
    top['storageclass.beta.kubernetes.io/is-default-class'] ??
    sc?.isDefault;
  return String(flag || '').toLowerCase() === 'true';
}

/**
 * 从 StorageClass 列表解析默认存储池名称（与前端 pickDefaultStorageClassName 一致）。
 * 优先 is-default-class；排除系统/镜像专用类后取首项。
 */
export function pickDefaultStorageClassNameFromRecords(storageClasses: any[]): string | undefined {
  const list = Array.isArray(storageClasses) ? storageClasses : [];
  const usable = list.filter((sc) => !isSystemStorageClassName(storageClassRecordName(sc)));
  const pool = usable.length > 0 ? usable : list;
  const hit = pool.find(isClusterDefaultStorageClassRecord);
  return storageClassRecordName(hit) || storageClassRecordName(pool[0]) || undefined;
}

async function listHarvesterStorageClassRecordsRaw(
  params: HarvesterTestParams,
): Promise<any[]> {
  const base = (params.endpoint || '').replace(/\/+$/, '');
  let origin = base;
  try {
    const u = new URL(base);
    origin = `${u.protocol}//${u.host}`;
  } catch {
    origin = base.replace(/\/v[0-9].*$/, '');
  }
  const candidates = [
    `${origin}/v1/storage.k8s.io.storageclasses`,
    `${origin}/v1/harvester/storage.k8s.io.storageclasses`,
    `${origin}/apis/storage.k8s.io/v1/storageclasses`,
  ];
  let json: any = null;
  let lastErr: any = null;
  for (const url of candidates) {
    try {
      json = await getJsonOnce(url, params.token, params.insecure);
      if (json) break;
    } catch (e: any) {
      harvesterStorageLog.debug(`存储类候选 URL 失败: ${url}`, e?.message ?? String(e));
      lastErr = e;
    }
  }
  if (!json && lastErr) throw lastErr;
  return Array.isArray(json?.data)
    ? json.data
    : Array.isArray(json?.items)
      ? json.items
      : [];
}

/**
 * 解析集群当前默认存储池（StorageClass）；失败时回退 fallback（默认 longhorn）。
 */
export async function resolveHarvesterDefaultStorageClassName(
  params: HarvesterTestParams,
  fallback = 'longhorn',
): Promise<string> {
  try {
    const items = await listHarvesterStorageClassRecordsRaw(params);
    return pickDefaultStorageClassNameFromRecords(items) || fallback;
  } catch (e: any) {
    harvesterStorageLog.debug(
      '解析默认存储类失败，使用回退值',
      e?.message ?? String(e),
    );
    return fallback;
  }
}

/** Harvester 创建 VirtualMachineImage 时 Longhorn 存储类常用 parameters */
export const DEFAULT_VM_IMAGE_LONGHORN_STORAGE_CLASS_PARAMS: Record<string, string> = {
  dataLocality: 'disabled',
  migratable: 'true',
  numberOfReplicas: '3',
  staleReplicaTimeout: '30',
};

/** 非 Longhorn 存储池不传 parameters，由 StorageClass 自身定义决定 */
export async function vmImageStorageClassParametersForName(
  params: HarvesterTestParams,
  storageClassName: string,
): Promise<Record<string, string> | undefined> {
  try {
    const kind = await classifyVmImageStorageKindByClassName(params, storageClassName);
    if (kind === 'longhorn') {
      return { ...DEFAULT_VM_IMAGE_LONGHORN_STORAGE_CLASS_PARAMS };
    }
  } catch {
    /* ignore */
  }
  return undefined;
}

/** 镜像落盘存储大类（与 Harvester 控制台 / CDI / backingimage 分支一致） */
export type VmImageStorageKind = 'longhorn' | 'ceph' | 'unknown';

export function classifyVmImageStorageKindFromProvisioner(provisioner: string): VmImageStorageKind {
  const pl = String(provisioner || '').trim().toLowerCase();
  if (!pl) return 'unknown';
  if (pl.includes('longhorn') || pl.includes('driver.longhorn.io')) return 'longhorn';
  if (
    pl.includes('rook-ceph') ||
    pl.includes('rbd.csi.ceph.com') ||
    pl.includes('cephfs.csi.ceph.com') ||
    pl.includes('csi.ceph.com') ||
    pl.includes('ceph.csi')
  ) {
    return 'ceph';
  }
  return 'unknown';
}

export async function classifyVmImageStorageKindByClassName(
  params: HarvesterTestParams,
  storageClassName: string,
): Promise<VmImageStorageKind> {
  try {
    const items = await listHarvesterStorageClassRecordsRaw(params);
    const hit = items.find((sc) => storageClassRecordName(sc) === storageClassName);
    const prov = String(hit?.provisioner ?? hit?.spec?.provisioner ?? '');
    return classifyVmImageStorageKindFromProvisioner(prov);
  } catch {
    return 'unknown';
  }
}

/** Longhorn 卷快照类（与 Harvester 默认一致） */
export const LONGHORN_VOLUME_SNAPSHOT_CLASS = 'longhorn-snapshot';

/** Rook-Ceph RBD 卷快照类（Ceph 存储 PVC 须使用此类，不可用 longhorn-snapshot） */
export const CEPH_RBD_VOLUME_SNAPSHOT_CLASS = 'rook-ceph-rbd-snapshot';

function storageClassNameFromPvcRecord(pvc: any): string {
  return String(
    pvc?.spec?.storageClassName ||
      pvc?.status?.storageClassName ||
      pvc?.metadata?.annotations?.['volume.beta.kubernetes.io/storage-class'] ||
      '',
  ).trim();
}

function classifyStorageKindFromStorageClassNameHeuristic(storageClassName: string): VmImageStorageKind {
  const sc = String(storageClassName || '').trim().toLowerCase();
  if (!sc) return 'unknown';
  if (sc.includes('longhorn')) return 'longhorn';
  if (sc.includes('rook-ceph') || sc.includes('rook_ceph') || sc.includes('ceph') || sc.includes('rbd')) {
    return 'ceph';
  }
  return 'unknown';
}

/**
 * 按源 PVC 的 StorageClass / provisioner 解析 VolumeSnapshotClass。
 * Longhorn PVC → longhorn-snapshot；Ceph/Rook RBD PVC → rook-ceph-rbd-snapshot。
 */
export async function resolveVolumeSnapshotClassForPvc(
  params: HarvesterTestParams,
  namespace: string,
  pvcName: string,
): Promise<string> {
  const base = (params.endpoint || '').replace(/\/+$/, '');
  let origin = base;
  try {
    const u = new URL(base);
    origin = `${u.protocol}//${u.host}`;
  } catch {
    origin = base.replace(/\/v[0-9].*$/, '');
  }
  let kind: VmImageStorageKind = 'unknown';
  try {
    const getUrl = `${origin}/api/v1/namespaces/${encodeURIComponent(namespace)}/persistentvolumeclaims/${encodeURIComponent(pvcName)}`;
    const pvc = await getJsonOnce(getUrl, params.token || '', params.insecure ?? false, true);
    const sc = storageClassNameFromPvcRecord(pvc);
    if (sc) {
      kind = await classifyVmImageStorageKindByClassName(params, sc);
      if (kind === 'unknown') kind = classifyStorageKindFromStorageClassNameHeuristic(sc);
    }
    const prov = String(pvc?.metadata?.annotations?.['volume.kubernetes.io/storage-provisioner'] || '');
    if (kind === 'unknown' && prov) kind = classifyVmImageStorageKindFromProvisioner(prov);
  } catch (e: any) {
    harvesterStorageLog.debug(
      `resolveVolumeSnapshotClassForPvc: PVC ${namespace}/${pvcName} 读取失败，回退 longhorn-snapshot`,
      e?.message ?? String(e),
    );
  }
  if (kind === 'ceph') return CEPH_RBD_VOLUME_SNAPSHOT_CLASS;
  if (kind === 'longhorn') return LONGHORN_VOLUME_SNAPSHOT_CLASS;
  return LONGHORN_VOLUME_SNAPSHOT_CLASS;
}

export type VmImageStorageProfile = {
  storageClassName: string;
  kind: VmImageStorageKind;
  storageClassParameters?: Record<string, string>;
};

/** 解析目标存储池及驱动类型（创建/上传 VirtualMachineImage 用） */
export async function resolveVmImageStorageProfile(
  params: HarvesterTestParams,
  explicitTargetStorageClassName?: string,
  fallback = 'longhorn',
): Promise<VmImageStorageProfile> {
  const storageClassName =
    String(explicitTargetStorageClassName || '').trim() ||
    (await resolveHarvesterDefaultStorageClassName(params, fallback));
  const kind = await classifyVmImageStorageKindByClassName(params, storageClassName);
  const storageClassParameters =
    kind === 'longhorn'
      ? (await vmImageStorageClassParametersForName(params, storageClassName)) ??
        { ...DEFAULT_VM_IMAGE_LONGHORN_STORAGE_CLASS_PARAMS }
      : undefined;
  return {
    storageClassName,
    kind,
    ...(storageClassParameters && Object.keys(storageClassParameters).length > 0
      ? { storageClassParameters }
      : {}),
  };
}

/**
 * 组装 VirtualMachineImage.spec，按存储池类型对齐 Harvester 底层行为：
 * - Ceph/Rook：backend=cdi，无 storageClassParameters，空 pvc/checksum/url 等与控制台一致
 * - Longhorn：仅附带 Longhorn storageClassParameters，不写 backend（由控制器选 backingimage）
 */
export function buildHarvesterVmImageSpecFields(opts: {
  profile: VmImageStorageProfile;
  displayName: string;
  sourceType: string;
  url?: string;
  diskFormat?: string;
}): Record<string, unknown> {
  const { profile, displayName, sourceType } = opts;
  const url = opts.url ?? '';
  const diskFormat = opts.diskFormat ? String(opts.diskFormat) : undefined;

  const spec: Record<string, unknown> = {
    displayName,
    sourceType,
    targetStorageClassName: profile.storageClassName,
    url,
    checksum: '',
    pvcName: '',
    pvcNamespace: '',
    retry: 3,
  };

  if (profile.kind === 'ceph') {
    spec.backend = 'cdi';
    if (diskFormat) spec.diskFormat = diskFormat;
    return spec;
  }

  if (diskFormat) spec.diskFormat = diskFormat;
  if (
    profile.kind === 'longhorn' &&
    profile.storageClassParameters &&
    Object.keys(profile.storageClassParameters).length > 0
  ) {
    spec.storageClassParameters = profile.storageClassParameters;
  }
  return spec;
}

/** Ceph 镜像与 Harvester UI 一致的 metadata.annotations 补充项 */
export function vmImageCephHarvesterExtraAnnotations(): Record<string, string> {
  return { 'field.cattle.io/description': '' };
}

/**
 * [镜像原始列表]
 * 获取 Harvester 镜像原始列表（支持指定命名空间）。
 *
 * [多路径兼容]
 * - 优先尝试 v1beta1 API，降级尝试 v1 API。
 * - 支持全局查询或特定 Namespace 查询。
 *
 * @param params 连接参数及命名空间
 * @returns Promise<any[]> 原始镜像对象数组
 */
export const listHarvesterImagesRaw = async ({
  endpoint,
  token,
  insecure = false,
  namespace = '',
}: HarvesterTestParams & { namespace?: string }): Promise<any[]> => {
  const base = (endpoint || '').replace(/\/+$/, '');
  let origin = base;
  try {
    const u = new URL(base);
    origin = `${u.protocol}//${u.host}`;
  } catch {
    origin = base.replace(/\/v[0-9].*$/, '');
  }

  let candidates: string[] = [];
  if (namespace) {
      candidates = [
          `${origin}/apis/harvesterhci.io/v1beta1/namespaces/${namespace}/virtualmachineimages`,
          `${origin}/apis/harvesterhci.io/v1/namespaces/${namespace}/virtualmachineimages`,
      ];
  } else {
      candidates = [
          `${origin}/apis/harvesterhci.io/v1beta1/virtualmachineimages`,
          `${origin}/apis/harvesterhci.io/v1/virtualmachineimages`,
      ];
  }

  let json: any = null;
  let lastErr: any = null;
  for (const url of candidates) {
    try {
      json = await getJsonOnce(url, token, insecure);
      if (json) {
        break;
      }
    } catch (e: any) {
      harvesterStorageLog.debug(`镜像候选 URL 失败: ${url}`, e?.message ?? String(e));
      lastErr = e;
    }
  }

  if (!json && lastErr) {
    harvesterStorageLog.error(
      'listHarvesterImagesRaw 执行失败:',
      lastErr?.message ?? String(lastErr),
    );
    return [];
  }

  const items = Array.isArray(json?.data)
    ? json?.data
    : Array.isArray(json?.items)
      ? json?.items
      : [];
      
  return items;
};

/**
 * [镜像标准列表]
 * 获取 Harvester 标准化镜像列表，包含详细元数据和链接。
 *
 * [数据处理]
 * - 顶层补充 name、namespace、displayName、size、links；须保留完整 Kubernetes `status`（含 conditions、progress），供镜像列表 state 推断。
 * - 兼容 v1beta1/v1 等返回差异。
 *
 * @param params 连接参数
 * @returns Promise<any[]> 标准化镜像对象数组
 */
export const listHarvesterImagesStandard = async ({
  endpoint,
  token,
  insecure = false,
}: HarvesterTestParams): Promise<any[]> => {
  const base = (endpoint || '').replace(/\/+$/, '');
  let origin = base;
  try {
    const u = new URL(base);
    origin = `${u.protocol}//${u.host}`;
  } catch {
    origin = base.replace(/\/v[0-9].*$/, '');
  }
  const candidates = [
    `${origin}/apis/harvesterhci.io/v1beta1/virtualmachineimages`,
    `${origin}/v1/harvester/harvesterhci.io.virtualmachineimages`,
    `${origin}/apis/harvesterhci.io/v1/virtualmachineimages`,
  ];
  let json: any = null;
  let lastErr: any = null;
  // let hitUrl: string | null = null;
  for (const url of candidates) {
    try {
      json = await getJsonOnce(url, token, insecure, true);
      // hitUrl = url;
      if (json) break;
    } catch (e: any) {
      lastErr = e;
    }
  }
  if (!json && lastErr) {
    harvesterStorageLog.error(
      'listHarvesterImagesStandard 执行失败:',
      lastErr?.message ?? String(lastErr),
    );
    json = { items: [], data: [] };
  }
  const items = Array.isArray(json?.data)
    ? json?.data
    : Array.isArray(json?.items)
      ? json?.items
      : [];

  return items.map((img: any) => ({
    ...img,
    name: img?.metadata?.name || img?.name || '',
    namespace: img?.metadata?.namespace || img?.namespace || '',
    displayName: img?.spec?.displayName || img?.spec?.name || '',
    size: img?.status?.size || img?.spec?.size || img?.status?.downloadedBytes || 0,
    virtualSize: img?.status?.virtualSize || img?.status?.virtualsize || 0,
    storageClassName:
      img?.spec?.storageClassName ||
      img?.status?.storageClassName ||
      img?.spec?.pvcStorageClassName ||
      '',
    links: {
      download: img?.links?.download || '',
      view:
        img?.links?.view ||
        `${origin}/apis/harvesterhci.io/v1beta1/namespaces/${img?.metadata?.namespace || 'default'}/virtualmachineimages/${img?.metadata?.name || img?.name}`,
      remove: img?.links?.remove || '',
      self: img?.links?.self || '',
      update: img?.links?.update || '',
    },
  }));
};

/**
 * [删除底层卷]
 * 删除 Harvester Longhorn 卷（底层卷）。
 *
 * [危险操作]
 * 直接操作 Longhorn API 删除卷，通常用于清理残留数据。
 *
 * @param params 连接参数
 * @param namespace 命名空间
 * @param name 卷名称
 * @returns Promise<any> 操作结果
 */
export const deleteHarvesterLonghornVolume = async (
  { endpoint, token, insecure = false }: HarvesterTestParams,
  namespace: string,
  name: string,
): Promise<any> => {
  const base = (endpoint || '').replace(/\/+$/, '');
  let origin = base;
  try {
    const u = new URL(base);
    origin = `${u.protocol}//${u.host}`;
  } catch {
    origin = base.replace(/\/v[0-9].*$/, '');
  }
  const paths = [
    `${origin}/apis/longhorn.io/v1beta1/namespaces/${encodeURIComponent(namespace)}/volumes/${encodeURIComponent(name)}`,
    `${origin}/v1/harvester/longhorn.io.volumes/${encodeURIComponent(name)}`,
    `${origin}/v1/longhorn.io.volumes/${encodeURIComponent(name)}`,
  ];
  let lastErr: any = null;
  for (const p of paths) {
    try {
      const json = await requestJson('DELETE', p, token, insecure);
      return json;
    } catch (e: any) {
      lastErr = e;
    }
  }
  if (lastErr) throw lastErr;
  return {};
};

/**
 * [创建 PVC]
 * 创建 Harvester 数据卷 (PVC)，支持设置大小、模式、存储类及注解。
 *
 * [核心逻辑]
 * 1. [容量解析]: 自动处理数字或带单位字符串 (如 '10Gi') 的容量输入。
 * 2. [默认值]: 默认大小 10Gi，默认模式 ReadWriteOnce。
 * 3. [命名]: PVC metadata.name 始终由平台生成；payload.name 作为展示别名写入 tower.io/alias（调用方已在 annotations 中指定 tower.io/alias 时不覆盖）。
 * 4. [路径尝试]: 尝试通过标准 API 和 Harvester API 创建。
 *
 * @param params 连接参数
 * @param payload 创建参数（包含注解 annotations）
 * @returns Promise<any> 创建结果
 */
/** K8s DNS-1123 label：用于克隆等需合法资源名的路径 */
function isKubernetesDnsLabel(name: string): boolean {
  return !!name && name.length <= 63 && /^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/.test(name);
}

function generatePvcTechnicalName(): string {
  return `pvc-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`.slice(0, 63);
}

export const createHarvesterPVCVolume = async (
  { endpoint, token, insecure = false }: HarvesterTestParams,
  payload: {
    namespace: string;
    name: string;
    sizeGi?: number;
    size?: string;
    accessModes?: string[];
    volumeMode?: string;
    storageClassName?: string;
    annotations?: Record<string, string>;
  },
): Promise<any> => {
  const base = (endpoint || '').replace(/\/+$/, '');
  let origin = base;
  try {
    const u = new URL(base);
    origin = `${u.protocol}//${u.host}`;
  } catch {
    origin = base.replace(/\/v[0-9].*$/, '');
  }
  const ns = String(payload.namespace || 'default');
  const sizeStr = (function () {
    const raw =
      typeof (payload as any)?.size === 'number'
        ? String((payload as any).size)
        : String((payload as any)?.size || '').trim();
    if (raw) {
      const hasUnit = /[a-zA-Z]/.test(raw);
      if (hasUnit) return raw;
      const n = Number(raw);
      if (!isNaN(n) && n > 0) return `${Math.round(n)}Gi`;
    }
    const g = Number((payload as any)?.sizeGi || 0);
    return g > 0 ? `${g}Gi` : '10Gi';
  })();
  // [Feature] 平台托管标记 (Platform Managed)
  // 添加 tower.io/managed Finalizer 和 tower.io/creator 标签，与虚拟机保持一致
  const finalizers = ['tower.io/managed'];
  const labels: Record<string, string> = {
    'tower.io/creator': 'compute-tower',
  };

  const rawDisplayName = String(payload.name || '').trim();
  const pvcMetaName = rawDisplayName || generatePvcTechnicalName();
  const mergedAnnotations: Record<string, string> = { ...(payload.annotations || {}) };
  if (!mergedAnnotations['tower.io/alias']) {
    mergedAnnotations['tower.io/alias'] = (rawDisplayName || 'volume').slice(0, 512);
  }

  const body = {
    apiVersion: 'v1',
    kind: 'PersistentVolumeClaim',
    metadata: {
      name: pvcMetaName,
      namespace: ns,
      annotations: Object.keys(mergedAnnotations).length ? mergedAnnotations : undefined,
      finalizers,
      labels,
    },
    spec: {
      accessModes:
        Array.isArray(payload.accessModes) && payload.accessModes.length > 0
          ? payload.accessModes
          : ['ReadWriteOnce'],
      resources: { requests: { storage: sizeStr } },
      ...(payload.volumeMode ? { volumeMode: String(payload.volumeMode) } : {}),
      ...(payload.storageClassName ? { storageClassName: String(payload.storageClassName) } : {}),
    },
  } as any;
  const candidates = [
    `${origin}/api/v1/namespaces/${encodeURIComponent(ns)}/persistentvolumeclaims`,
    `${origin}/v1/harvester/core.v1.persistentvolumeclaims`,
    `${origin}/k8s/clusters/local/api/v1/namespaces/${encodeURIComponent(ns)}/persistentvolumeclaims`,
  ];
  let lastErr: any = null;
  for (const url of candidates) {
    try {
      const json = await requestJson('POST', url, token, insecure, body);
      return json;
    } catch (e: any) {
      lastErr = e;
    }
  }
  if (lastErr) throw lastErr;
  return {};
};

/**
 * [获取单个镜像]
 * 获取单个 Harvester 镜像详情。
 *
 * @param params 连接参数
 * @param namespace 命名空间
 * @param name 镜像名称
 * @returns Promise<any> 镜像对象
 */
export const getHarvesterImage = async (
  { endpoint, token, insecure = false }: HarvesterTestParams,
  namespace: string,
  name: string,
): Promise<any> => {
  const base = (endpoint || '').replace(/\/+$/, '');
  let origin = base;
  try {
    const u = new URL(base);
    origin = `${u.protocol}//${u.host}`;
  } catch {
    origin = base.replace(/\/v[0-9].*$/, '');
  }

  // Try v1beta1 first, then v1
  const candidates = [
    `${origin}/apis/harvesterhci.io/v1beta1/namespaces/${encodeURIComponent(namespace)}/virtualmachineimages/${encodeURIComponent(name)}`,
    `${origin}/apis/harvesterhci.io/v1/namespaces/${encodeURIComponent(namespace)}/virtualmachineimages/${encodeURIComponent(name)}`,
    // Global scope (Harvester images are often cluster-scoped or in 'default'/'harvester-public' namespace)
    // If namespace provided is the VM's namespace, but image is public, we might need to check other namespaces.
    // However, for getHarvesterImage(ns, name), we respect the provided namespace.
  ];

  let json: any = null;
  for (const url of candidates) {
    try {
      json = await getJsonOnce(url, token, insecure);
      if (json) break;
    } catch (e) {
      // ignore
    }
  }
  
  if (json) {
     return {
        name: json?.metadata?.name || json?.name || '',
        namespace: json?.metadata?.namespace || json?.namespace || '',
        displayName: json?.spec?.displayName || json?.spec?.name || '',
        metadata: json?.metadata,
        spec: json?.spec,
        status: json?.status
     };
  }
  return null;
};

/**
 * [导出镜像]
 * 从 PVC 导出为 Harvester 虚拟机镜像。
 *
 * [业务规则]
 * 1. 创建 VirtualMachineImage 资源。
 * 2. 设置 sourceType 为 'export-from-volume'。
 * 3. 关联源 PVC 的 namespace 和 name。
 *
 * @param params 连接参数
 * @param namespace 命名空间
 * @param pvcName PVC 名称
 * @param opts 导出选项（显示名称、目标存储类）
 * @returns Promise<any> 操作结果
 */
export const exportImageFromPVC = async (
  { endpoint, token, insecure = false }: HarvesterTestParams,
  namespace: string,
  pvcName: string,
  opts: { displayName?: string; targetStorageClassName?: string },
): Promise<any> => {
  const base = (endpoint || '').replace(/\/+$/, '');
  let origin = base;
  try {
    const u = new URL(base);
    origin = `${u.protocol}//${u.host}`;
  } catch {
    origin = base.replace(/\/v[0-9].*$/, '');
  }
  const body = {
    apiVersion: 'harvesterhci.io/v1beta1',
    kind: 'VirtualMachineImage',
    metadata: { generateName: 'image-', namespace },
    spec: {
      displayName: opts?.displayName || pvcName,
      sourceType: 'export-from-volume',
      pvcName,
      pvcNamespace: namespace,
      diskFormat: 'qcow2',
      ...(opts?.targetStorageClassName
        ? { targetStorageClassName: opts.targetStorageClassName }
        : {}),
    },
  } as any;
  const ns = encodeURIComponent(namespace);
  const candidates = [
    `${origin}/apis/harvesterhci.io/v1beta1/namespaces/${ns}/virtualmachineimages`,
    `${origin}/k8s/clusters/local/apis/harvesterhci.io/v1beta1/namespaces/${ns}/virtualmachineimages`,
    `${origin}/apis/harvesterhci.io/v1/namespaces/${ns}/virtualmachineimages`,
  ];
  let lastErr: any = null;
  for (const url of candidates) {
    try {
      const json = await requestJson('POST', url, token, insecure, body);
      return json;
    } catch (e: any) {
      lastErr = e;
    }
  }
  if (lastErr) throw lastErr;
  return {};
};

/**
 * [创建卷快照]
 * 创建 VolumeSnapshot 资源，用于备份 PVC 数据。
 *
 * [API 调用]
 * 使用 snapshot.storage.k8s.io/v1 API。
 *
 * @param params 连接参数
 * @param namespace 命名空间
 * @param pvcName 源 PVC 名称
 * @param opts 快照选项（名称、快照类）
 * @returns Promise<any> 创建结果
 */
export const createVolumeSnapshot = async (
  { endpoint, token, insecure = false }: HarvesterTestParams,
  namespace: string,
  pvcName: string,
  opts: { name?: string; snapshotClassName?: string; alias?: string },
): Promise<any> => {
  const base = (endpoint || '').replace(/\/+$/, '');
  let origin = base;
  try {
    const u = new URL(base);
    origin = `${u.protocol}//${u.host}`;
  } catch {
    origin = base.replace(/\/v[0-9].*$/, '');
  }
  const urlPath = `${origin}/apis/snapshot.storage.k8s.io/v1/namespaces/${encodeURIComponent(namespace)}/volumesnapshots`;
  
  const metadata: any = {
    ...(opts?.name ? { name: opts.name } : { generateName: `${pvcName}-snap-` }),
    namespace,
  };
  
  if (opts?.alias) {
      metadata.annotations = {
          'tower.io/alias': opts.alias
      };
  }

  const resolvedSnapshotClass = await resolveVolumeSnapshotClassForPvc(
    { endpoint, token, insecure },
    namespace,
    pvcName,
  );
  const volumeSnapshotClassName = resolvedSnapshotClass;

  const body = {
    apiVersion: 'snapshot.storage.k8s.io/v1',
    kind: 'VolumeSnapshot',
    metadata,
    spec: {
      source: { persistentVolumeClaimName: pvcName },
      volumeSnapshotClassName,
    },
  } as any;
  const json = await requestJson('POST', urlPath, token, insecure, body);
  return json;
};

/**
 * [更新 PVC 规格]
 * 更新 PVC 规格，如扩容、修改注解或标签。
 *
 * [核心逻辑]
 * 1. [获取当前状态]: 先 GET 获取现有 PVC。
 * 2. [合并修改]: 将新的 size/annotations/labels 合并到现有对象中。
 * 3. [提交更新]: 使用 PUT 方法提交完整对象。
 *
 * @param params 连接参数
 * @param namespace 命名空间
 * @param pvcName PVC 名称
 * @param payload 更新内容
 * @returns Promise<any> 更新结果
 */
export const updatePVCSpec = async (
  { endpoint, token, insecure = false }: HarvesterTestParams,
  namespace: string,
  pvcName: string,
  payload: {
    sizeGi?: number;
    size?: string;
    accessModes?: string[];
    volumeMode?: string;
    storageClassName?: string;
    annotations?: Record<string, string>;
    labels?: Record<string, string>;
  },
): Promise<any> => {
  const base = (endpoint || '').replace(/\/+$/, '');
  let origin = base;
  try {
    const u = new URL(base);
    origin = `${u.protocol}//${u.host}`;
  } catch {
    origin = base.replace(/\/v[0-9].*$/, '');
  }
  const getUrl = `${origin}/api/v1/namespaces/${encodeURIComponent(namespace)}/persistentvolumeclaims/${encodeURIComponent(pvcName)}`;
  const cur = await getJsonOnce(getUrl, token, insecure);
  const sizeStr = (function () {
    const raw =
      typeof (payload as any)?.size === 'number'
        ? String((payload as any).size)
        : String((payload as any)?.size || '').trim();
    if (raw) {
      const hasUnit = /[a-zA-Z]/.test(raw);
      if (hasUnit) return raw;
      const n = Number(raw);
      if (!isNaN(n) && n > 0) return `${Math.round(n)}Gi`;
    }
    const g = Number((payload as any)?.sizeGi || 0);
    return g > 0 ? `${g}Gi` : undefined;
  })();

  const next = {
    apiVersion: cur?.apiVersion || 'v1',
    kind: cur?.kind || 'PersistentVolumeClaim',
    metadata: {
      ...(cur?.metadata || {}),
      name: pvcName,
      namespace,
      ...(payload.annotations
        ? { annotations: { ...(cur?.metadata?.annotations || {}), ...(payload.annotations || {}) } }
        : {}),
      ...(payload.labels
        ? { labels: { ...(cur?.metadata?.labels || {}), ...(payload.labels || {}) } }
        : {}),
    },
    spec: {
      ...(cur?.spec || {}),
      ...(Array.isArray(payload.accessModes) && payload.accessModes.length > 0
        ? { accessModes: payload.accessModes }
        : {}),
      ...(payload.volumeMode ? { volumeMode: payload.volumeMode } : {}),
      ...(payload.storageClassName ? { storageClassName: payload.storageClassName } : {}),
      ...(sizeStr ? { resources: { requests: { storage: sizeStr } } } : {}),
    },
  } as any;
  const putUrl = getUrl;
  const json = await requestJson('PUT', putUrl, token, insecure, next);
  return json;
};

/**
 * [克隆 PVC]
 * 克隆 PVC（支持从快照或现有 PVC 克隆）。
 *
 * [核心逻辑]
 * 1. [数据源判断]: 若指定了 fromSnapshotName，则 dataSource 指向 VolumeSnapshot；否则指向 PersistentVolumeClaim。
 * 2. [资源配置]: 支持指定新的大小、模式和存储类。
 *
 * @param params 连接参数
 * @param namespace 源命名空间
 * @param pvcName 源 PVC 名称
 * @param opts 克隆选项
 * @returns Promise<any> 创建的新 PVC 对象
 */
export const clonePVC = async (
  { endpoint, token, insecure = false }: HarvesterTestParams,
  namespace: string,
  pvcName: string,
  opts: {
    targetNamespace?: string;
    newName: string;
    sizeGi?: number;
    size?: string;
    storageClassName?: string;
    fromSnapshotName?: string;
    accessModes?: string[];
    volumeMode?: string;
  },
): Promise<any> => {
  const base = (endpoint || '').replace(/\/+$/, '');
  let origin = base;
  try {
    const u = new URL(base);
    origin = `${u.protocol}//${u.host}`;
  } catch {
    origin = base.replace(/\/v[0-9].*$/, '');
  }
  const ns = String(opts?.targetNamespace || namespace);
  const rawNewName = String(opts?.newName || '').trim();
  let pvcCloneName = rawNewName;
  const cloneAnnotations: Record<string, string> = {};
  if (!isKubernetesDnsLabel(pvcCloneName)) {
    pvcCloneName = generatePvcTechnicalName();
    cloneAnnotations['tower.io/alias'] = (rawNewName || 'volume').slice(0, 512);
  }
  const sizeStr = (function () {
    const raw =
      typeof (opts as any)?.size === 'number'
        ? String((opts as any).size)
        : String((opts as any)?.size || '').trim();
    if (raw) {
      const hasUnit = /[a-zA-Z]/.test(raw);
      if (hasUnit) return raw;
      const n = Number(raw);
      if (!isNaN(n) && n > 0) return `${Math.round(n)}Gi`;
    }
    const g = Number((opts as any)?.sizeGi || 0);
    return g > 0 ? `${g}Gi` : undefined;
  })();
  const body: any = {
    apiVersion: 'v1',
    kind: 'PersistentVolumeClaim',
    metadata: {
      name: pvcCloneName,
      namespace: ns,
      ...(Object.keys(cloneAnnotations).length ? { annotations: cloneAnnotations } : {}),
    },
    spec: {
      accessModes:
        Array.isArray(opts?.accessModes) && opts?.accessModes?.length > 0
          ? opts?.accessModes
          : ['ReadWriteOnce'],
      ...(opts?.volumeMode ? { volumeMode: opts?.volumeMode } : {}),
      resources: { requests: { ...(sizeStr ? { storage: sizeStr } : {}) } },
      ...(opts?.storageClassName ? { storageClassName: opts.storageClassName } : {}),
      dataSource: opts?.fromSnapshotName
        ? {
            name: opts.fromSnapshotName,
            kind: 'VolumeSnapshot',
            apiGroup: 'snapshot.storage.k8s.io',
          }
        : { name: pvcName, kind: 'PersistentVolumeClaim' },
    },
  };
  const url = `${origin}/api/v1/namespaces/${encodeURIComponent(ns)}/persistentvolumeclaims`;
  const json = await requestJson('POST', url, token, insecure, body);
  return json;
};

/** 从 VolumeSnapshot 及其源 PVC 解析恢复用卷规格（卷模式与源盘一致，访问模式固定 RWX） */
async function resolveVolumeSnapshotRestoreSpec(
  params: HarvesterTestParams,
  origin: string,
  namespace: string,
  snapshotName: string,
): Promise<{
  volumeMode: 'Block' | 'Filesystem';
  accessModes: ['ReadWriteMany'];
  restoreSize?: string;
}> {
  const accessModes: ['ReadWriteMany'] = ['ReadWriteMany'];
  let volumeMode: 'Block' | 'Filesystem' = 'Block';
  let restoreSize: string | undefined;

  try {
    const snapUrl = `${origin}/apis/snapshot.storage.k8s.io/v1/namespaces/${encodeURIComponent(namespace)}/volumesnapshots/${encodeURIComponent(snapshotName)}`;
    const snap = await getJsonOnce(snapUrl, params.token || '', params.insecure ?? false, true);
    restoreSize = snap?.status?.restoreSize ? String(snap.status.restoreSize) : undefined;

    const sourcePvc = String(snap?.spec?.source?.persistentVolumeClaimName || '').trim();
    if (sourcePvc) {
      const pvcUrl = `${origin}/api/v1/namespaces/${encodeURIComponent(namespace)}/persistentvolumeclaims/${encodeURIComponent(sourcePvc)}`;
      const pvc = await getJsonOnce(pvcUrl, params.token || '', params.insecure ?? false, true);
      const mode = String(pvc?.spec?.volumeMode || '').trim();
      if (mode === 'Block' || mode === 'Filesystem') {
        volumeMode = mode;
      }
    }
  } catch (e) {
    harvesterStorageLog.debug(
      `resolveVolumeSnapshotRestoreSpec: snapshot ${namespace}/${snapshotName} 或源 PVC 读取失败，卷模式回退 Block`,
      e instanceof Error ? e.message : String(e),
    );
  }

  return { volumeMode, accessModes, restoreSize };
}

/**
 * [恢复快照]
 * 从快照恢复卷（创建新的 PVC）。
 *
 * [核心逻辑]
 * 1. 读取 VolumeSnapshot 与源 PVC：`volumeMode` 与源盘一致（Block/Filesystem 不擅自改写）。
 * 2. `accessModes` 固定为 `ReadWriteMany`（RWX）。
 * 3. 容量优先请求体 `size`，否则用快照 `status.restoreSize`。
 *
 * @param params 连接参数
 * @param namespace 命名空间
 * @param snapshotName 快照名称
 * @param opts 恢复选项（新名称、规格等）
 * @returns Promise<any> 创建的新 PVC 对象
 */
export const restoreVolumeSnapshot = async (
  { endpoint, token, insecure = false }: HarvesterTestParams,
  namespace: string,
  snapshotName: string,
  opts: {
    newName: string;
    storageClassName?: string;
    accessModes?: string[];
    volumeMode?: string;
    size?: string;
    /** 云盘展示名 → metadata.annotations['tower.io/alias']，可为中文 */
    alias?: string;
  },
): Promise<any> => {
  const base = (endpoint || '').replace(/\/+$/, '');
  let origin = base;
  try {
    const u = new URL(base);
    origin = `${u.protocol}//${u.host}`;
  } catch {
    origin = base.replace(/\/v[0-9].*$/, '');
  }

  const { volumeMode, accessModes, restoreSize } = await resolveVolumeSnapshotRestoreSpec(
    { endpoint, token, insecure },
    origin,
    namespace,
    snapshotName,
  );

  const body: any = {
    apiVersion: 'v1',
    kind: 'PersistentVolumeClaim',
    metadata: {
      name: String(opts.newName),
      namespace,
      ...(String(opts.alias ?? '').trim()
        ? {
            annotations: {
              'tower.io/alias': String(opts.alias).trim(),
            },
          }
        : {}),
    },
    spec: {
      accessModes: [...accessModes],
      volumeMode,
      ...(opts.storageClassName ? { storageClassName: opts.storageClassName } : {}),
      dataSource: {
        name: snapshotName,
        kind: 'VolumeSnapshot',
        apiGroup: 'snapshot.storage.k8s.io',
      },
      dataSourceRef: {
        name: snapshotName,
        kind: 'VolumeSnapshot',
        apiGroup: 'snapshot.storage.k8s.io',
      },
    },
  };

  const sizeStr = String(opts.size || '').trim() || restoreSize;
  if (sizeStr) {
    body.spec.resources = { requests: { storage: sizeStr } };
  }

  const url = `${origin}/api/v1/namespaces/${encodeURIComponent(namespace)}/persistentvolumeclaims`;
  const json = await requestJson('POST', url, token, insecure, body);
  return json;
};



/**
 * [创建命名空间]
 * 创建新的 Harvester 命名空间。
 *
 * @param params 连接参数
 * @param name 命名空间名称
 * @param annotations 注解
 * @returns Promise<any> 创建结果
 */
export const createHarvesterNamespace = async (
  { endpoint, token, insecure = false }: HarvesterTestParams,
  name: string,
  annotations?: Record<string, string>,
): Promise<any> => {
  const base = (endpoint || '').replace(/\/+$/, '');
  let origin = base;
  try {
    const u = new URL(base);
    origin = `${u.protocol}//${u.host}`;
  } catch {
    origin = base.replace(/\/v[0-9].*$/, '');
  }

  const urlPath = `${origin}/api/v1/namespaces`;

  const body = {
    apiVersion: 'v1',
    kind: 'Namespace',
    metadata: {
      name: name,
      labels: {
        'kubernetes.io/metadata.name': name,
      },
      annotations: annotations,
    },
  };

  const json = await requestJson('POST', urlPath, token, insecure, body);
  return json;
};

/**
 * [获取命名空间]
 * 获取单个 Harvester 命名空间的原始信息。
 *
 * @param params 连接参数
 * @param name 命名空间名称
 * @returns Promise<any> 命名空间对象
 */
export const getHarvesterNamespaceRaw = async (
  { endpoint, token, insecure = false }: HarvesterTestParams,
  name: string,
): Promise<any> => {
  const base = (endpoint || '').replace(/\/+$/, '');
  let origin = base;
  try {
    const u = new URL(base);
    origin = `${u.protocol}//${u.host}`;
  } catch {
    origin = base.replace(/\/v[0-9].*$/, '');
  }

  const url = `${origin}/api/v1/namespaces/${encodeURIComponent(name)}`;
  const json = await getJsonOnce(url, token, insecure);
  return json;
};

/**
 * [命名空间列表]
 * 获取 Harvester 所有命名空间的原始列表。
 *
 * [多路径兼容]
 * 尝试多种 API 路径以适配不同 Harvester 版本或网络环境。
 *
 * @param params 连接参数
 * @returns Promise<any[]> 命名空间对象数组
 */
export const listHarvesterNamespacesRaw = async ({
  endpoint,
  token,
  insecure = false,
}: HarvesterTestParams): Promise<any[]> => {
  const base = (endpoint || '').replace(/\/+$/, '');
  let origin = base;
  try {
    const u = new URL(base);
    origin = `${u.protocol}//${u.host}`;
  } catch {
    origin = base.replace(/\/v[0-9].*$/, '');
  }
  const candidates = [
    `${origin}/api/v1/namespaces`,
    `${origin}/v1/core.v1.namespaces`,
    `${origin}/v1/harvester/core.v1.namespaces`,
    `${origin}/k8s/clusters/local/api/v1/namespaces`,
  ];
  let json: any = null;
  let lastErr: any = null;
  for (const url of candidates) {
    try {
      json = await getJsonOnce(url, token, insecure);
      if (json) break;
    } catch (e: any) {
      lastErr = e;
    }
  }
  if (!json && lastErr) {
    throw lastErr;
  }
  const items = Array.isArray(json?.items) ? json.items : (Array.isArray(json?.data) ? json.data : []);
  
  return items.map((item: any) => {
    const name = item.metadata?.name || item.name;
    if (name) {
       item.links = item.links || {};
       item.links.view = `${origin}/api/v1/namespaces/${name}`;
    }
    return item;
  });
};

/**
 * [创建 VM 备份/快照]
 * 创建虚拟机备份或快照。
 *
 * [核心逻辑]
 * 1. [类型区分]: 根据 type 参数决定前缀 (id-vms- 或 id-vmb-)。
 * 2. [别名支持]: 将 payload.name 作为别名存入 annotations['tower.io/alias']。
 *
 * @param params 连接参数
 * @param namespace 命名空间
 * @param payload 创建参数（包含别名）
 * @returns Promise<any> 创建结果
 */
export const createHarvesterVirtualMachineBackup = async (
  { endpoint, token, insecure = false }: HarvesterTestParams,
  namespace: string,
  payload: {
    name: string;
    vmName: string;
    type: 'backup' | 'snapshot';
    alias?: string;
  }
): Promise<any> => {
  const base = (endpoint || '').replace(/\/+$/, '');
  let origin = base;
  try {
    const u = new URL(base);
    origin = `${u.protocol}//${u.host}`;
  } catch {
    origin = base.replace(/\/v[0-9].*$/, '');
  }
  const url = `${origin}/apis/harvesterhci.io/v1beta1/namespaces/${encodeURIComponent(namespace)}/virtualmachinebackups`;

  const prefix = payload.type === 'snapshot' ? 'id-vms-' : 'id-vmb-';
  const resourceName = `${prefix}${Math.random().toString(36).substring(2, 18)}`;

  const body = {
    apiVersion: 'harvesterhci.io/v1beta1',
    kind: 'VirtualMachineBackup',
    metadata: {
      name: resourceName,
      namespace: namespace,
      annotations: {
        'tower.io/alias': payload.name
      },
    },
    spec: {
      type: payload.type,
      source: {
        apiGroup: 'kubevirt.io',
        kind: 'VirtualMachine',
        name: payload.vmName,
      },
    }
  };

  return requestJson('POST', url, token, insecure, body);
};

/**
 * [创建 VM 恢复]
 * 创建虚拟机恢复任务（从备份恢复）。
 *
 * [核心逻辑]
 * 1. [版本适配]: 根据 payload.apiVersion 动态决定 API Group (默认 harvesterhci.io/v1beta1)。
 *
 * @param params 连接参数
 * @param namespace 命名空间
 * @param payload 恢复参数
 * @returns Promise<any> 创建结果
 */
export const createHarvesterVirtualMachineRestore = async (
  { endpoint, token, insecure = false }: HarvesterTestParams,
  namespace: string,
  payload: any
): Promise<any> => {
  const base = (endpoint || '').replace(/\/+$/, '');
  let origin = base;
  try {
    const u = new URL(base);
    origin = `${u.protocol}//${u.host}`;
  } catch {
    origin = base.replace(/\/v[0-9].*$/, '');
  }
  
  // Determine API Group from payload or default to harvesterhci.io
  let apiVersion = 'harvesterhci.io/v1beta1';
  if (payload?.apiVersion) {
    apiVersion = payload.apiVersion;
  }

  const url = `${origin}/apis/${apiVersion}/namespaces/${encodeURIComponent(namespace)}/virtualmachinerestores`;

  return requestJson('POST', url, token, insecure, payload);
};

/**
 * [VM 恢复列表]
 * 获取集群内 VirtualMachineRestore 列表（Longhorn / Harvester 原生）。
 */
export const listHarvesterVirtualMachineRestoresRaw = async ({
  endpoint,
  token,
  insecure = false,
}: HarvesterTestParams): Promise<any[]> => {
  const base = (endpoint || '').replace(/\/+$/, '');
  let origin = base;
  try {
    const u = new URL(base);
    origin = `${u.protocol}//${u.host}`;
  } catch {
    origin = base.replace(/\/v[0-9].*$/, '');
  }

  const candidates = [
    `${origin}/apis/harvesterhci.io/v1beta1/virtualmachinerestores`,
    `${origin}/apis/harvesterhci.io/v1alpha1/virtualmachinerestores`,
    `${origin}/v1/harvester/harvesterhci.io.virtualmachinerestores`,
  ];

  for (const url of candidates) {
    try {
      const json = await getJsonOnce(url, token, insecure, true);
      if (json && (Array.isArray(json.items) || Array.isArray(json.data))) {
        return json.items || json.data || [];
      }
    } catch (e: any) {
      if (Number(e?.status) !== 404 && !String(e?.message).includes('404')) {
        harvesterStorageLog.debug(`VM restore list candidate failed: ${url}`, e?.message ?? String(e));
      }
    }
  }

  return [];
};

/**
 * [删除 VM 备份]
 * 删除虚拟机备份。
 *
 * @param params 连接参数
 * @param namespace 命名空间
 * @param name 备份名称
 * @returns Promise<any> 操作结果
 */
export const deleteHarvesterVirtualMachineBackup = async (
  { endpoint, token, insecure = false }: HarvesterTestParams,
  namespace: string,
  name: string,
): Promise<any> => {
  const base = (endpoint || '').replace(/\/+$/, '');
  let origin = base;
  try {
    const u = new URL(base);
    origin = `${u.protocol}//${u.host}`;
  } catch {
    origin = base.replace(/\/v[0-9].*$/, '');
  }
  
  const url = `${origin}/apis/harvesterhci.io/v1beta1/namespaces/${encodeURIComponent(namespace)}/virtualmachinebackups/${encodeURIComponent(name)}`;
  return requestJson('DELETE', url, token, insecure);
};

/**
 * [删除 VM 快照]
 * 删除虚拟机快照。
 *
 * @param params 连接参数
 * @param namespace 命名空间
 * @param name 快照名称
 * @returns Promise<any> 操作结果
 */
export const deleteHarvesterVirtualMachineSnapshot = async (
  { endpoint, token, insecure = false }: HarvesterTestParams,
  namespace: string,
  name: string,
): Promise<any> => {
  const base = (endpoint || '').replace(/\/+$/, '');
  let origin = base;
  try {
    const u = new URL(base);
    origin = `${u.protocol}//${u.host}`;
  } catch {
    origin = base.replace(/\/v[0-9].*$/, '');
  }
  
  const url = `${origin}/apis/harvesterhci.io/v1beta1/namespaces/${encodeURIComponent(namespace)}/virtualmachinesnapshots/${encodeURIComponent(name)}`;
  return requestJson('DELETE', url, token, insecure);
};

/**
 * [删除 PVC]
 * 删除 Harvester 数据卷 (PVC)。
 *
 * @param params 连接参数
 * @param namespace 命名空间
 * @param name PVC 名称
 * @returns Promise<any> 操作结果
 */
export const deleteHarvesterPVC = async (
  { endpoint, token, insecure = false }: HarvesterTestParams,
  namespace: string,
  name: string,
): Promise<any> => {
  const base = (endpoint || '').replace(/\/+$/, '');
  let origin = base;
  try {
    const u = new URL(base);
    origin = `${u.protocol}//${u.host}`;
  } catch {
    origin = base.replace(/\/v[0-9].*$/, '');
  }
  const url = `${origin}/api/v1/namespaces/${encodeURIComponent(namespace)}/persistentvolumeclaims/${encodeURIComponent(name)}`;
  try {
    const current = await getJsonOnce(url, token, insecure);
    const finalizers = current?.metadata?.finalizers;
    const managedFinalizer = 'tower.io/managed';
    if (Array.isArray(finalizers) && finalizers.includes(managedFinalizer)) {
      const indicesToRemove = finalizers
        .map((f: any, i: number) => (f === managedFinalizer ? i : -1))
        .filter((i: number) => i >= 0)
        .sort((a: number, b: number) => b - a);
      if (indicesToRemove.length > 0) {
        const patchOps = indicesToRemove.map((index: number) => ({
          op: 'remove',
          path: `/metadata/finalizers/${index}`,
        }));
        await requestJson('PATCH', url, token, insecure, patchOps, {
          'Content-Type': 'application/json-patch+json',
        });
      }
    }
  } catch {}
  try {
    return await requestJson('DELETE', url, token, insecure);
  } catch (e: any) {
    const status = Number(e?.status || 0);
    const msg = String(e?.message || '').toLowerCase();
    const body = String(e?.body || '').toLowerCase();
    if (status === 404 || msg.includes('not found') || body.includes('not found')) {
      return { status: 'AlreadyDeleted' };
    }
    throw e;
  }
};

/**
 * [快照类列表]
 * 获取卷快照类 (VolumeSnapshotClass) 列表。
 *
 * @param params 连接参数
 * @returns Promise<any[]> 快照类对象数组
 */
export const listHarvesterSnapshotClassesRaw = async ({
  endpoint,
  token,
  insecure = false,
}: HarvesterTestParams): Promise<any[]> => {
  const base = (endpoint || '').replace(/\/+$/, '');
  let origin = base;
  try {
    const u = new URL(base);
    origin = `${u.protocol}//${u.host}`;
  } catch {
    origin = base.replace(/\/v[0-9].*$/, '');
  }
  const url = `${origin}/apis/snapshot.storage.k8s.io/v1/volumesnapshotclasses`;
  const json = await getJsonOnce(url, token, insecure);
  return Array.isArray(json?.items) ? json.items : [];
};

/**
 * [VM 快照列表]
 * 获取 Harvester 标准化虚拟机快照列表。
 *
 * [版本兼容]
 * 优先尝试 v1beta1，降级尝试 v1alpha1。
 *
 * @param params 连接参数
 * @returns Promise<any[]> 快照对象数组
 */
export const listHarvesterSnapshotsStandard = async ({
  endpoint,
  token,
  insecure = false,
}: HarvesterTestParams): Promise<any[]> => {
  const base = (endpoint || '').replace(/\/+$/, '');
  let origin = base;
  try {
    const u = new URL(base);
    origin = `${u.protocol}//${u.host}`;
  } catch {
    origin = base.replace(/\/v[0-9].*$/, '');
  }
  
  // [版本兼容] Try v1beta1 first, then fallback to v1alpha1
  const candidates = [
    `${origin}/apis/harvesterhci.io/v1beta1/virtualmachinesnapshots`,
    `${origin}/apis/harvesterhci.io/v1alpha1/virtualmachinesnapshots`,
    `${origin}/v1/harvester/harvesterhci.io.virtualmachinesnapshots`
  ];

  for (const url of candidates) {
    try {
      const json = await getJsonOnce(url, token, insecure, true);
      if (json && (Array.isArray(json.items) || Array.isArray(json.data))) {
        return json.items || json.data || [];
      }
    } catch (e: any) {
      // 404 means this version is not supported, continue to next
      if (Number(e?.status) !== 404 && !String(e?.message).includes('404')) {
         // Log non-404 errors as warnings but don't crash
         harvesterStorageLog.debug(`Snapshot list candidate failed: ${url}`, e?.message ?? String(e));
      }
    }
  }

  return [];
};

/**
 * [VM 备份列表]
 * 获取 Harvester 虚拟机备份列表。
 *
 * @param params 连接参数
 * @returns Promise<any[]> 备份对象数组
 */
export const listHarvesterBackupsStandard = async ({
  endpoint,
  token,
  insecure = false,
}: HarvesterTestParams): Promise<any[]> => {
  const base = (endpoint || '').replace(/\/+$/, '');
  let origin = base;
  try {
    const u = new URL(base);
    origin = `${u.protocol}//${u.host}`;
  } catch {
    origin = base.replace(/\/v[0-9].*$/, '');
  }
  const url = `${origin}/apis/harvesterhci.io/v1beta1/virtualmachinebackups`;
  const json = await getJsonOnce(url, token, insecure);
  return Array.isArray(json?.items) ? json.items : [];
};

/**
 * [SSH 密钥列表]
 * 获取 Harvester SSH 密钥对列表。
 *
 * @param params 连接参数
 * @returns Promise<any[]> 密钥对对象数组
 */
export const listHarvesterSshKeysStandard = async ({
  endpoint,
  token,
  insecure = false,
}: HarvesterTestParams): Promise<any[]> => {
  const base = (endpoint || '').replace(/\/+$/, '');
  let origin = base;
  try {
    const u = new URL(base);
    origin = `${u.protocol}//${u.host}`;
  } catch {
    origin = base.replace(/\/v[0-9].*$/, '');
  }
  const url = `${origin}/apis/harvesterhci.io/v1beta1/keypairs`;
  const json = await getJsonOnce(url, token, insecure);
  return Array.isArray(json?.items) ? json.items : [];
};

/**
 * [创建 SSH 密钥]
 * 创建 Harvester SSH 密钥对 (KeyPair)。
 *
 * @param params 连接参数
 * @param namespace 命名空间
 * @param payload 创建参数 (name, publicKey)
 * @returns Promise<any> 创建结果
 */
export const createHarvesterSshKey = async (
  { endpoint, token, insecure = false }: HarvesterTestParams,
  namespace: string,
  payload: {
    name: string;
    publicKey: string;
    annotations?: Record<string, string>;
  }
): Promise<any> => {
  const base = (endpoint || '').replace(/\/+$/, '');
  let origin = base;
  try {
    const u = new URL(base);
    origin = `${u.protocol}//${u.host}`;
  } catch {
    origin = base.replace(/\/v[0-9].*$/, '');
  }
  const url = `${origin}/apis/harvesterhci.io/v1beta1/namespaces/${encodeURIComponent(namespace)}/keypairs`;

  const body = {
    apiVersion: 'harvesterhci.io/v1beta1',
    kind: 'KeyPair',
    metadata: {
      name: payload.name,
      namespace: namespace,
      annotations: payload.annotations,
    },
    spec: {
      publicKey: payload.publicKey,
    }
  };

  return requestJson('POST', url, token, insecure, body);
};

export const deleteHarvesterSshKey = async (
  { endpoint, token, insecure = false }: HarvesterTestParams,
  namespace: string,
  name: string
): Promise<any> => {
  const base = (endpoint || '').replace(/\/+$/, '');
  let origin = base;
  try {
    const u = new URL(base);
    origin = `${u.protocol}//${u.host}`;
  } catch {
    origin = base.replace(/\/v[0-9].*$/, '');
  }

  const url = `${origin}/apis/harvesterhci.io/v1beta1/namespaces/${encodeURIComponent(namespace)}/keypairs/${encodeURIComponent(name)}`;
  return await requestJson('DELETE', url, token, insecure);
};

/**
 * [CloudInit 模板]
 * 获取 Harvester CloudInit 模板列表。
 *
 * @param params 连接参数
 * @returns Promise<any[]> 模板对象数组
 */
export const listHarvesterCloudInitsStandard = async ({
  endpoint,
  token,
  insecure = false,
}: HarvesterTestParams): Promise<any[]> => {
  const base = (endpoint || '').replace(/\/+$/, '');
  let origin = base;
  try {
    const u = new URL(base);
    origin = `${u.protocol}//${u.host}`;
  } catch {
    origin = base.replace(/\/v[0-9].*$/, '');
  }

  /**
   * CloudInitTemplate 在多数官方 Harvester 发行版中未作为独立 CRD 注册，直连 apiserver 常为 404。
   * 使用 silent 探测避免 Compute-Api 对「可选能力」打 error；成功路径与 Rancher 代理 URL 做兼容。
   */
  const candidates = [
    `${origin}/apis/harvesterhci.io/v1beta1/cloudinittemplates`,
    `${origin}/apis/harvesterhci.io/v1/cloudinittemplates`,
    `${origin}/k8s/clusters/local/apis/harvesterhci.io/v1beta1/cloudinittemplates`,
  ];

  let lastStatus: number | undefined;
  for (const url of candidates) {
    try {
      const json = await getJsonOnce(url, token, insecure, true);
      if (Array.isArray(json?.items)) return json.items;
      if (Array.isArray(json)) return json;
    } catch (e: any) {
      lastStatus = e?.status;
    }
  }

  if (lastStatus && lastStatus !== 404) {
    harvesterStorageLog.debug(
      '获取 CloudInitTemplates 失败（非 404，已返回空列表）',
      lastStatus,
    );
  } else {
    harvesterStorageLog.debug(
      'CloudInitTemplates API 不可用或为空（404 常见于集群未注册该资源；VM 仍可使用内联 CloudInit）',
    );
  }
  return [];
};

/**
 * [VM 模板原始列表]
 * 获取 Harvester 虚拟机模板原始列表。
 *
 * @param params 连接参数
 * @returns Promise<any[]> 原始模板对象数组
 */
export const listHarvesterTemplatesRaw = async ({
  endpoint,
  token,
  insecure = false,
}: HarvesterTestParams): Promise<any[]> => {
  const base = (endpoint || '').replace(/\/+$/, '');
  let origin = base;
  try {
    const u = new URL(base);
    origin = `${u.protocol}//${u.host}`;
  } catch {
    origin = base.replace(/\/v[0-9].*$/, '');
  }
  const url = `${origin}/apis/harvesterhci.io/v1beta1/virtualmachinetemplates`;
  const json = await getJsonOnce(url, token, insecure);
  return Array.isArray(json?.items) ? json.items : [];
};

/**
 * [VM 模板标准列表]
 * listHarvesterTemplatesRaw 的别名。
 */
export const listHarvesterTemplatesStandard = listHarvesterTemplatesRaw;

/**
 * [定时备份计划列表]
 * 获取 Harvester 定时备份计划 (ScheduleVMBackup) 列表。
 *
 * @param params 连接参数
 * @returns Promise<any[]> 定时备份计划对象数组
 */
export const listHarvesterScheduleVmBackupsStandard = async ({
  endpoint,
  token,
  insecure = false,
}: HarvesterTestParams): Promise<any[]> => {
  const base = (endpoint || '').replace(/\/+$/, '');
  let origin = base;
  try {
    const u = new URL(base);
    origin = `${u.protocol}//${u.host}`;
  } catch {
    origin = base.replace(/\/v[0-9].*$/, '');
  }
  const url = `${origin}/apis/harvesterhci.io/v1beta1/schedulevmbackups`;
  const json = await getJsonOnce(url, token, insecure);
  return Array.isArray(json?.items) ? json.items : [];
};

/**
 * [创建定时备份]
 * 创建 Harvester 定时备份计划。
 *
 * [核心逻辑]
 * 1. [自动命名]: 自动生成资源名称 (id-svmb-...)。
 * 2. [配置支持]: 支持 Cron 表达式、保留策略及失败重试配置。
 *
 * @param params 连接参数
 * @param namespace 命名空间
 * @param payload 创建参数
 * @returns Promise<any> 创建结果
 */
export const createHarvesterScheduleVmBackup = async (
  { endpoint, token, insecure = false }: HarvesterTestParams,
  namespace: string,
  payload: {
    name: string; // This is the ALIAS
    vmName: string;
    cron: string;
    retain: number;
    maxFailure: number;
    suspend: boolean;
    type?: 'backup' | 'snapshot';
  }
): Promise<any> => {
  const base = (endpoint || '').replace(/\/+$/, '');
  let origin = base;
  try {
    const u = new URL(base);
    origin = `${u.protocol}//${u.host}`;
  } catch {
    origin = base.replace(/\/v[0-9].*$/, '');
  }
  
  const resourceName = `id-svmb-${Math.random().toString(36).substring(2, 18)}`;
  const url = `${origin}/apis/harvesterhci.io/v1beta1/namespaces/${encodeURIComponent(namespace)}/schedulevmbackups`;

  const body = {
    apiVersion: 'harvesterhci.io/v1beta1',
    kind: 'ScheduleVMBackup',
    metadata: {
      name: resourceName,
      namespace: namespace,
      annotations: {
        'tower.io/alias': payload.name
      }
    },
    spec: {
      cron: payload.cron,
      maxFailure: payload.maxFailure,
      retain: payload.retain,
      suspend: payload.suspend,
      vmbackup: {
        source: {
          apiGroup: 'kubevirt.io',
          kind: 'VirtualMachine',
          name: payload.vmName
        },
        type: payload.type || 'backup'
      }
    }
  };

  return requestJson('POST', url, token, insecure, body);
};

/**
 * [更新定时备份]
 * 更新 Harvester 定时备份计划。
 *
 * [核心逻辑]
 * 1. [获取]: 获取现有计划对象。
 * 2. [合并]: 仅更新变更字段 (cron, retain, suspend 等)。
 * 3. [保存]: 提交更新后的对象。
 *
 * @param params 连接参数
 * @param namespace 命名空间
 * @param name 计划名称
 * @param payload 更新内容
 * @returns Promise<any> 更新结果
 */
export const updateHarvesterScheduleVmBackup = async (
  { endpoint, token, insecure = false }: HarvesterTestParams,
  namespace: string,
  name: string,
  payload: any
): Promise<any> => {
  const base = (endpoint || '').replace(/\/+$/, '');
  let origin = base;
  try {
    const u = new URL(base);
    origin = `${u.protocol}//${u.host}`;
  } catch {
    origin = base.replace(/\/v[0-9].*$/, '');
  }
  
  const url = `${origin}/apis/harvesterhci.io/v1beta1/namespaces/${encodeURIComponent(namespace)}/schedulevmbackups/${encodeURIComponent(name)}`;
  
  // 1. Get existing resource
  const existing = await getJsonOnce(url, token, insecure);
  if (!existing) throw new Error('ScheduleVmBackup not found');

  // 2. Merge changes
  const updated = { ...existing };
  if (!updated.spec) updated.spec = {};
  
  if (payload.cron !== undefined) updated.spec.cron = payload.cron;
  if (payload.retain !== undefined) updated.spec.retain = payload.retain;
  if (payload.maxFailure !== undefined) updated.spec.maxFailure = payload.maxFailure;
  if (payload.suspend !== undefined) updated.spec.suspend = payload.suspend;
  
  if (payload.annotations) {
    updated.metadata.annotations = {
      ...(updated.metadata.annotations || {}),
      ...payload.annotations
    };
  }

  // 3. PUT update
  return requestJson('PUT', url, token, insecure, updated);
};

/**
 * [删除定时备份]
 * 删除 Harvester 定时备份计划。
 *
 * @param params 连接参数
 * @param namespace 命名空间
 * @param name 计划名称
 * @returns Promise<any> 操作结果
 */
export const deleteHarvesterScheduleVmBackup = async (
  { endpoint, token, insecure = false }: HarvesterTestParams,
  namespace: string,
  name: string,
): Promise<any> => {
  const base = (endpoint || '').replace(/\/+$/, '');
  let origin = base;
  try {
    const u = new URL(base);
    origin = `${u.protocol}//${u.host}`;
  } catch {
    origin = base.replace(/\/v[0-9].*$/, '');
  }
  const url = `${origin}/apis/harvesterhci.io/v1beta1/namespaces/${encodeURIComponent(namespace)}/schedulevmbackups/${encodeURIComponent(name)}`;
  return requestJson('DELETE', url, token, insecure);
};

/**
 * [VM 快照列表别名]
 * listHarvesterSnapshotsStandard 的别名。
 */
export const listHarvesterVirtualMachineSnapshots = listHarvesterSnapshotsStandard;

/**
 * [卷快照列表]
 * 获取 Harvester 卷快照 (VolumeSnapshot) 列表。
 *
 * @param params 连接参数
 * @returns Promise<any[]> 卷快照对象数组
 */
export const listHarvesterVolumeSnapshots = async ({
  endpoint,
  token,
  insecure = false,
}: HarvesterTestParams): Promise<any[]> => {
  const base = (endpoint || '').replace(/\/+$/, '');
  let origin = base;
  try {
    const u = new URL(base);
    origin = `${u.protocol}//${u.host}`;
  } catch {
    origin = base.replace(/\/v[0-9].*$/, '');
  }
  const url = `${origin}/apis/snapshot.storage.k8s.io/v1/volumesnapshots`;
  const json = await getJsonOnce(url, token, insecure);
  return Array.isArray(json?.items) ? json.items : [];
};

/**
 * [删除卷快照]
 * 删除 Harvester 卷快照。
 *
 * @param params 连接参数
 * @param namespace 命名空间
 * @param name 快照名称
 * @returns Promise<any> 操作结果
 */
export const deleteHarvesterVolumeSnapshot = async (
  { endpoint, token, insecure = false }: HarvesterTestParams,
  namespace: string,
  name: string,
): Promise<any> => {
  const base = (endpoint || '').replace(/\/+$/, '');
  let origin = base;
  try {
    const u = new URL(base);
    origin = `${u.protocol}//${u.host}`;
  } catch {
    origin = base.replace(/\/v[0-9].*$/, '');
  }
  const url = `${origin}/apis/snapshot.storage.k8s.io/v1/namespaces/${encodeURIComponent(namespace)}/volumesnapshots/${encodeURIComponent(name)}`;
  return requestJson('DELETE', url, token, insecure);
};

/**
 * [创建 Secret]
 * 创建 Harvester Secret（加密字典）。
 *
 * @param params 连接参数
 * @param namespace 命名空间
 * @param payload Secret 内容
 * @returns Promise<any> 创建结果
 */
export const createHarvesterSecret = async (
  { endpoint, token, insecure = false }: HarvesterTestParams,
  namespace: string,
  payload: any,
): Promise<any> => {
  const base = (endpoint || '').replace(/\/+$/, '');
  let origin = base;
  try {
    const u = new URL(base);
    origin = `${u.protocol}//${u.host}`;
  } catch {
    origin = base.replace(/\/v[0-9].*$/, '');
  }
  const url = `${origin}/api/v1/namespaces/${encodeURIComponent(namespace)}/secrets`;
  return await requestJson('POST', url, token, insecure, payload);
};

/**
 * [删除 Secret]
 * 删除 Harvester Secret。
 *
 * @param params 连接参数
 * @param namespace 命名空间
 * @param name Secret 名称
 * @returns Promise<any> 操作结果
 */
export const deleteHarvesterSecret = async (
  { endpoint, token, insecure = false }: HarvesterTestParams,
  namespace: string,
  name: string,
): Promise<any> => {
  const base = (endpoint || '').replace(/\/+$/, '');
  let origin = base;
  try {
    const u = new URL(base);
    origin = `${u.protocol}//${u.host}`;
  } catch {
    origin = base.replace(/\/v[0-9].*$/, '');
  }
  const url = `${origin}/api/v1/namespaces/${encodeURIComponent(namespace)}/secrets/${encodeURIComponent(name)}`;
  return await requestJson('DELETE', url, token, insecure);
};
