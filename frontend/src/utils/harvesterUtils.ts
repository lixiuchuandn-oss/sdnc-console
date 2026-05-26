/**
 * @file harvesterUtils.ts
 * @description Harvester 相关的前端通用工具函数集合
 *
 * 功能分组（与下方代码块顺序一致）：
 * 1. 命名空间 / 存储类：isSystemNamespace、isPublicNamespace、namespaceSectionType、isTenantScenarioNamespace、isSystemStorageClass、
 *    isClusterDefaultStorageClass、pickDefaultStorageClassName
 * 2. VM 状态文案：VM_STATUS_MAP、cnVmStatus
 * 3. 集群实体 ID / CR metadata.name：generateHarvesterEntityId、HARVESTER_CR_METADATA_ENTITY、
 *    HarvesterCrMetadataNameKind、generateHarvesterCrMetadataName、generateVmWizardStyleDisplayName
 * 4. 克隆任务：getVmCloneTaskStatus
 * 5. 镜像类型：resolveVmImageKind
 */

// =============================================================================
// 1. 命名空间与存储类
// =============================================================================

/**
 * 判断命名空间是否为 Harvester 系统命名空间
 *
 * 用途：
 * - Harvester 命名空间列表过滤：隐藏或标记系统命名空间
 * - Volumes / Resources 等页面中，用于区分业务命名空间和系统命名空间
 */
export const isSystemNamespace = (name: string): boolean => {
  const n = String(name || '').toLowerCase();
  const prefixes = [
    'cattle',
    'fleet',
    'longhorn',
    'kube',
    'harvester',
    'cluster-fleet',
    'cluster',
    'local',
    'ingress',
    'rancher',
    'calico',
    'tigera',
    'cert-manager',
    'velero',
    'openebs',
    'rook',
    'istio',
    'knative',
    'cilium',
    'linkerd',
    'keda',
    'argocd',
    'vault',
    'sealed-secrets',
    'monitoring',
    'logging',
    'tracing',
  ];
  return prefixes.some((p) => n.startsWith(p));
};

/**
 * 判断是否为公共命名空间 (Public Namespace)
 * 公共命名空间对租户可见（只读），对管理员可见（读写）
 */
export const isPublicNamespace = (name: string): boolean => {
  const n = String(name || '').toLowerCase();
  return ['cloud-public', 'default', 'harvester-public'].includes(n);
};

/** 镜像列表项是否属于公共空间（仅信列表接口下发的 namespacePublicByScenario，与库存 label 一致） */
export function isImagePublicByScenario(r: any): boolean {
  return r?.namespacePublicByScenario === true;
}

/** 命名空间管理页「类型」：系统 / 公共 / 租户 / 管理员 / 未标注场景 */
export type NamespaceSectionKind =
  | 'system'
  | 'public'
  | 'tenant'
  | 'admin'
  /** 缺 tower.io/scenario 或非 public|tenant|admin；非租户项目 */
  | 'unlabeled';

/**
 * 租户项目：`metadata.labels['tower.io/scenario'] === 'tenant'`（平台租户分配创建路径写入）
 */
export function isTenantScenarioNamespace(record: unknown): boolean {
  const r = record as { metadata?: { labels?: Record<string, string> } };
  const sc = String(r?.metadata?.labels?.['tower.io/scenario'] || '').trim().toLowerCase();
  return sc === 'tenant';
}

/**
 * 解析命名空间在列表中的业务类型（与 cluster NamespacesSection 列、筛选一致）
 * - 系统：isSystemNamespace(名称)
 * - tenant：tower.io/scenario=tenant（租户项目的权威口径）
 * - public / admin：对应 scenario 或与公共名兜底（仍为公共展示）
 * - 其余无合法 scenario：unlabeled（非租户项目）
 */
export function namespaceSectionType(record: any): NamespaceSectionKind {
  const name = String(record?.metadata?.name || record?.name || '').trim();
  if (!name) return 'unlabeled';
  if (isSystemNamespace(name)) return 'system';
  const scenario = String(record?.metadata?.labels?.['tower.io/scenario'] || '').trim().toLowerCase();
  if (scenario === 'public') return 'public';
  if (scenario === 'tenant') return 'tenant';
  if (scenario === 'admin') return 'admin';
  if (isPublicNamespace(name)) return 'public';
  return 'unlabeled';
}

/**
 * 按列表/库存返回顺序，取第一个带指定 tower.io/scenario 的业务命名空间名（跳过系统命名空间前缀规则）
 */
export function pickFirstNamespaceRecordByScenario(
  records: any[] | undefined,
  scenario: 'tenant' | 'admin',
): string | undefined {
  for (const r of records || []) {
    const name = String(r?.metadata?.name || r?.name || '').trim();
    if (!name || isSystemNamespace(name)) continue;
    const sc = String(r?.metadata?.labels?.['tower.io/scenario'] || '').trim().toLowerCase();
    if (sc === scenario) return name;
  }
  return undefined;
}

/** 在「下拉可选名称」范围内，按 records 顺序取第一个匹配 scenario 的命名空间 */
export function pickFirstNamespaceRecordByScenarioForOptions(
  records: any[] | undefined,
  optionValues: string[],
  scenario: 'tenant' | 'admin',
): string | undefined {
  const allow = new Set(optionValues.map((s) => String(s).trim()).filter(Boolean));
  const filtered = (records || []).filter((r) => {
    const n = String(r?.metadata?.name || r?.name || '').trim();
    return n && allow.has(n);
  });
  return pickFirstNamespaceRecordByScenario(filtered, scenario);
}

/**
 * 判断存储类是否为 Harvester 系统 / 内部存储类
 *
 * 用途：
 * - 在存储类下拉框中隐藏系统存储类，降低误操作风险
 * - 在只面向业务的视图中过滤出“用户可选”的存储类
 *
 * 规则：
 * - 精确匹配：vmstate-persistence / longhorn-static / harvester-longhorn
 * - 前缀匹配：image- / longhorn-image-（镜像相关存储类）
 */
export const isSystemStorageClass = (name: string): boolean => {
  const n = String(name || '').toLowerCase();
  if (['vmstate-persistence', 'longhorn-static', 'harvester-longhorn'].includes(n)) return true;
  if (n.startsWith('image-')) return true;
  if (n.startsWith('longhorn-image-')) return true;
  if (/^longhorn-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(n)) return true;
  if (n.startsWith('longhorn-') && /-[0-9]{13,}$/.test(n)) return true;
  return false;
};

export type HarvesterVolumeStorageKind = 'longhorn' | 'ceph' | 'unknown';

export const HARVESTER_LONGHORN_VOLUME_SNAPSHOT_CLASS = 'longhorn-snapshot';
export const HARVESTER_CEPH_RBD_VOLUME_SNAPSHOT_CLASS = 'rook-ceph-rbd-snapshot';

/** 与后端 classifyVmImageStorageKindFromProvisioner 一致 */
export function classifyStorageKindFromProvisioner(provisioner: string): HarvesterVolumeStorageKind {
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

/** 根据 PVC 的 StorageClass 与存储类列表解析卷存储大类 */
export function classifyStorageKindFromStorageClassName(
  storageClassName: string,
  storageClasses?: any[],
): HarvesterVolumeStorageKind {
  const sc = String(storageClassName || '').trim();
  if (!sc) return 'unknown';
  const hit = (storageClasses || []).find((item: any) => {
    const n = String(item?.metadata?.name || item?.name || '').trim();
    return n === sc;
  });
  const prov = String(hit?.provisioner || hit?.spec?.provisioner || '');
  const fromProv = classifyStorageKindFromProvisioner(prov);
  if (fromProv !== 'unknown') return fromProv;
  const lower = sc.toLowerCase();
  if (lower.includes('longhorn')) return 'longhorn';
  if (lower.includes('rook-ceph') || lower.includes('ceph') || lower.includes('rbd')) return 'ceph';
  return 'unknown';
}

/** 创建 VolumeSnapshot 时按源卷存储类型选择快照类（Longhorn 不变，Ceph 用 rook-ceph-rbd-snapshot） */
export function resolveVolumeSnapshotClassName(
  storageClassName?: string,
  storageClasses?: any[],
): string {
  const kind = classifyStorageKindFromStorageClassName(storageClassName || '', storageClasses);
  if (kind === 'ceph') return HARVESTER_CEPH_RBD_VOLUME_SNAPSHOT_CLASS;
  return HARVESTER_LONGHORN_VOLUME_SNAPSHOT_CLASS;
}

/**
 * 判断存储类是否被集群标记为 default StorageClass（metadata/annotations 上的 is-default-class）
 */
export const isClusterDefaultStorageClass = (sc: any): boolean => {
  const meta = sc?.metadata?.annotations || {};
  const top = sc?.annotations || {};
  const flag =
    meta['storageclass.kubernetes.io/is-default-class'] ??
    meta['storageclass.beta.kubernetes.io/is-default-class'] ??
    top['storageclass.kubernetes.io/is-default-class'] ??
    top['storageclass.beta.kubernetes.io/is-default-class'] ??
    sc?.isDefault;
  return String(flag || '').toLowerCase() === 'true';
};

/**
 * 解析集群「默认」存储类名称：优先 is-default-class，否则取列表第一项（与创建向导 useHarvesterData 一致）
 */
export const pickDefaultStorageClassName = (storageClasses?: any[]): string | undefined => {
  const list: any[] = Array.isArray(storageClasses) ? storageClasses : [];
  const pickName = (sc: any) => sc?.metadata?.name || sc?.name;
  const hit = list.find(isClusterDefaultStorageClass);
  return pickName(hit) || pickName(list[0]) || undefined;
};

// =============================================================================
// 2. VM 状态文案
// =============================================================================

/**
 * Harvester / KubeVirt 可打印状态 → 中文；`cnVmStatus` 对其做 key 归一化后查表，未命中则回退原值或 `-`。
 */
export const VM_STATUS_MAP: Record<string, string> = {
  running: '运行中',
  starting: '启动中',
  stopping: '停止中',
  terminating: '删除中',
  stopped: '已停止',
  terminated: '已删除',
  pausing: '暂停中',
  paused: '已暂停',
  crashloopbackoff: '崩溃重启中',
  error: '错误',
  errorunschedulable: '调度失败',
  waitingforvolumebinding: '等待卷绑定',
  provisioning: '配置中',
  migrating: '迁移中',
  unknown: '未知',
};

export const cnVmStatus = (v?: string): string => {
  const k = String(v || '').toLowerCase();
  return VM_STATUS_MAP[k] || (v || '-');
};

// =============================================================================
// 3. 集群实体 ID / CR metadata.name / 展示名
// =============================================================================

/**
 * Tower 自管 K8s 资源的 metadata.name 约定：`id-{实体缩写}-{11 位 [0-9a-z]}`（如 id-vm-3k9z0x8af21）。
 *
 * - **日常业务**：只调 `generateHarvesterCrMetadataName(kind)`，实体缩写在 `HARVESTER_CR_METADATA_ENTITY` 登记。
 * - **底层 / 例外**：本函数供未登记缩写或少数扩展场景使用；随机来自 Math.random，不保证集群内绝对唯一。
 */
export const generateHarvesterEntityId = (entity: string): string => {
  const e = String(entity || '').toLowerCase();
  let rand = '';
  while (rand.length < 11) {
    rand += Math.random().toString(36).substring(2);
  }
  rand = rand.substring(0, 11);
  return `id-${e}-${rand}`;
};

/** 与 `generateHarvesterCrMetadataName` 的 kind 一一对应；新增 CR 类型时在此加一行。 */
export const HARVESTER_CR_METADATA_ENTITY = {
  /** VirtualMachine / vmName */
  vm: 'vm',
  /** Kube-OVN Subnet + NAD，业务 VPC 子网 */
  vpcSubnet: 'vpcsn',
  /** Kube-OVN Subnet + NAD，扁平/公共子网（历史沿用 sn） */
  subnetUnderlay: 'sn',
  kubeOvnEip: 'eip',
  kubeOvnSnat: 'snat',
  kubeOvnDnat: 'dnat',
  kubeOvnFip: 'fip',
  /** NetworkAttachmentDefinition（与 Subnet 同名） */
  nad: 'nad',
  /** 容器资源 - Deployment */
  deployment: 'dep',
  /** 容器资源 - StatefulSet */
  statefulset: 'sts',
  /** 容器资源 - DaemonSet */
  daemonset: 'ds',
  /** 容器资源 - Job */
  job: 'job',
  /** 容器资源 - CronJob */
  cronjob: 'cjob',
  /** 容器资源 - Service */
  service: 'svc',
  /** 容器资源 - Ingress */
  ingress: 'ing',
  /** 容器资源 - ConfigMap */
  configmap: 'cm',
  /** 容器资源 - Secret */
  secret: 'sec',
  /** 容器资源 - PodDisruptionBudget */
  pdb: 'pdb',
  /** 容器资源 - NetworkPolicy */
  networkpolicy: 'np',
  /** 容器资源 - ImagePullSecret（镜像仓库凭证） */
  imagepullsecret: 'imgsc',
} as const;

export type HarvesterCrMetadataNameKind = keyof typeof HARVESTER_CR_METADATA_ENTITY;

export const generateHarvesterCrMetadataName = (kind: HarvesterCrMetadataNameKind): string =>
  generateHarvesterEntityId(HARVESTER_CR_METADATA_ENTITY[kind]);

/**
 * 与云主机创建向导初始「虚拟机名称」一致的展示名：`{prefix}-{4 位随机 base36}-{Date.now() base36 尾部}`。
 * 用于 tower.io/alias 等展示字段（非 K8s metadata.name）。
 */
export const generateVmWizardStyleDisplayName = (prefix = 'vm'): string => {
  const raw = String(prefix || 'vm').replace(/[^a-zA-Z0-9_-]/g, '');
  const p = (raw || 'vm').slice(0, 32);
  return `${p}-${Math.random().toString(36).slice(2, 6)}-${Date.now().toString(36).slice(-4)}`;
};

// =============================================================================
// 4. 克隆任务
// =============================================================================

/**
 * 判断虚拟机标准克隆任务是否已结束（仅做结束状态判断，不做进度计算）
 *
 * 优先使用后端返回的 clonePvcsReady（克隆目标 VM 的磁盘 PVC 是否全部 Bound）：
 * - clonePvcsReady === true → 完成
 * - clonePvcsReady === false → 进行中
 *
 * 若无 clonePvcsReady（兼容旧数据），则依据 VM 是否已 Running 判断完成，其余均为进行中。
 * 不根据 VM 错误状态判「克隆失败」——VM 调度失败等不等于克隆失败，克隆只区分「卷就绪/未就绪」。
 */
export const getVmCloneTaskStatus = (
  vm: any,
): { phase: 'pending' | 'ready'; text: string } => {
  try {
    if (vm?.clonePvcsReady === true) {
      return { phase: 'ready', text: '完成' };
    }
    if (vm?.clonePvcsReady === false) {
      return { phase: 'pending', text: '进行中' };
    }

    const status = vm?.status;
    const ready = status?.ready === true;
    const conditions: any[] = Array.isArray(status?.conditions) ? status.conditions : [];
    const readyCond = conditions.find((c: any) => String(c?.type || '').toLowerCase() === 'ready');
    const readyByCond = readyCond && String(readyCond.status || '').toLowerCase() === 'true';
    const printable = String(status?.printableStatus || '').trim();
    if (ready || readyByCond || printable === 'Running') {
      return { phase: 'ready', text: '完成' };
    }

    return { phase: 'pending', text: '进行中' };
  } catch {
    return { phase: 'pending', text: '进行中' };
  }
};

// =============================================================================
// 5. 镜像
// =============================================================================

/**
 * 判断 VirtualMachineImage 是 ISO 光盘镜像还是磁盘镜像（qcow2/raw 等）。
 * 与 Harvester UI / 镜像列表（ImagesSection）使用同一套规则，避免各页面不一致。
 *
 * 优先级：metadata.labels[harvesterhci.io/image-type] → spec.diskFormat →
 * 卷导出语义 → 展示名/注解 image-name/URL 中的扩展名。
 */
export function resolveVmImageKind(img: any): 'iso' | 'disk' | 'unknown' {
  const labels = img?.metadata?.labels || {};
  const typeLabel = String(labels['harvesterhci.io/image-type'] || '').toLowerCase();
  if (typeLabel === 'iso') return 'iso';
  if (['raw_qcow2', 'qcow2', 'raw', 'disk', 'container'].includes(typeLabel)) return 'disk';

  const diskFormat = String(img?.spec?.diskFormat || img?.diskFormat || '').toLowerCase();
  if (diskFormat === 'iso') return 'iso';
  if (['qcow2', 'raw'].includes(diskFormat)) return 'disk';

  const sourceType = String(img?.spec?.sourceType || '').toLowerCase();
  if (sourceType === 'export-from-volume') return 'disk';
  if (img?.spec?.pvcName || img?.spec?.pvcNamespace) return 'disk';

  const ann = img?.metadata?.annotations || {};
  const disp = String(
    labels['harvesterhci.io/imageDisplayName'] ||
      img?.spec?.displayName ||
      ann['harvesterhci.io/image-name'] ||
      img?.metadata?.name ||
      img?.name ||
      '',
  ).toLowerCase();
  const url = String(img?.spec?.url || '').toLowerCase();

  if (sourceType === 'upload' || sourceType === 'download') {
    if (/\.iso$/i.test(disp) || /\.iso(\?|$|#)/i.test(url)) return 'iso';
    if (/\.(qcow2|img|raw)$/i.test(disp) || /\.(qcow2|img|raw)(\?|$|#)/i.test(url)) return 'disk';
    return 'unknown';
  }

  if (/\.iso$/i.test(disp)) return 'iso';
  if (/\.(qcow2|img|raw)$/i.test(disp)) return 'disk';
  return 'unknown';
}

/**
 * 列表/下拉筛选：与 ImagesSection.resolveImageListStateKey 语义一致（state / Imported / progress / phase）。
 */
function mapVmImageListStateRaw(raw: string): string {
  const k = String(raw || '').trim().toLowerCase();
  if (k === 'active') return 'ready';
  if (k === 'imported') return 'ready';
  if (k === 'failed') return 'failed';
  if (k === 'downloading') return 'downloading';
  if (k === 'unknown') return 'unknown';
  return k || 'unknown';
}

function vmImageConditionStatusIsTrue(v: unknown): boolean {
  return v === true || v === 'True' || v === 'true';
}

function vmImageConditionStatusIsFalse(v: unknown): boolean {
  return v === false || v === 'False' || v === 'false';
}

function getVmImageConditionsList(r: any): any[] {
  const fromStatus = r?.status?.conditions;
  const top = r?.conditions;
  if (Array.isArray(fromStatus) && fromStatus.length > 0) return fromStatus;
  if (Array.isArray(top) && top.length > 0) return top;
  if (Array.isArray(fromStatus)) return fromStatus;
  if (Array.isArray(top)) return top;
  return [];
}

export function resolveVmImageListStateKey(r: any): string {
  if (typeof r?.state === 'string' && r.state.trim() !== '') {
    const mapped = mapVmImageListStateRaw(r.state);
    if (mapped !== 'unknown') return mapped;
  }
  const conditions = getVmImageConditionsList(r);
  const imported = conditions.find((c: any) => c?.type === 'Imported');
  if (vmImageConditionStatusIsTrue(imported?.status)) return 'ready';
  if (vmImageConditionStatusIsFalse(imported?.status)) return 'failed';

  const progress = Number(r?.status?.progress ?? r?.progress);
  if (Number.isFinite(progress)) {
    if (progress >= 100) return 'ready';
    if (progress > 0 && progress < 100) return 'downloading';
  }

  if (typeof r?.status === 'string' && r.status.trim() !== '') return mapVmImageListStateRaw(r.status);
  const phase = r?.status?.phase ?? r?.status?.status;
  if (phase != null && String(phase).trim() !== '') return mapVmImageListStateRaw(String(phase));

  return 'unknown';
}

/** 创建虚拟机等场景：仅展示已就绪（可安全选用）的镜像 */
export function isHarvesterVmImageReady(img: any): boolean {
  return resolveVmImageListStateKey(img) === 'ready';
}

// =============================================================================
// 6. 系统资源保护
// =============================================================================

/**
 * 判断 Kubernetes 资源是否为系统内置资源（禁止删除）
 *
 * 判断规则：
 * 1. 命名空间是系统命名空间（kube-system, kube-public, harvester-system 等）
 * 2. 资源名称有系统前缀（kube-, coredns-, etcd- 等）
 * 3. 资源有特定的 label 标记（app.kubernetes.io/managed-by 等）
 * 4. Secret 的特定类型（kubernetes.io/service-account-token 等）
 * 5. 资源有 ownerReferences（被其他资源管理，如 Deployment 管理的 ReplicaSet）
 *
 * @param resource Kubernetes 资源对象
 * @param resourceType 资源类型（可选，用于特定类型判断，如 'secret'）
 * @returns true 表示是系统内置资源，禁止删除
 */
export function isSystemResource(resource: any, resourceType?: string): boolean {
  if (!resource) return false;

  const metadata = resource?.metadata || {};
  const name = String(metadata.name || '').toLowerCase();
  const namespace = String(metadata.namespace || '').toLowerCase();

  // 1. 系统命名空间（与后端 isSystemNamespaceName 一致）
  if (isSystemNamespace(namespace)) return true;

  // 2. Kubernetes 内置 Service（如 default 命名空间中的 kubernetes Service）
  if (namespace === 'default' && name === 'kubernetes') return true;

  // 3. 系统资源名称前缀（移除 default-，保留真正的系统组件前缀）
  const systemNamePrefixes = [
    'kube-',
    'coredns-',
    'etcd-',
    'kubelet-',
    'kube-proxy',
    'kube-apiserver',
    'kube-controller',
    'kube-scheduler',
    'rancher-',
    'cattle-',
    'fleet-',
    'longhorn-',
    'harvester-',
    'virt-',
    'cdi-',
    'ovn-',
    'ovs-',
    'network-policy-',
  ];
  if (systemNamePrefixes.some((p) => name.startsWith(p))) return true;

  // 4. ServiceAccount Token Secret（K8s 自动创建，不应删除）
  if (resourceType === 'secret' || resource?.type) {
    const secretType = String(resource?.type || '').toLowerCase();
    if (secretType === 'kubernetes.io/service-account-token') return true;
    if (secretType === 'helm.sh/release.v1') return true;
  }

  return false;
}

/**
 * 获取系统资源保护提示信息
 */
export function getSystemResourceProtectionHint(resource: any, resourceType?: string): string {
  if (!isSystemResource(resource, resourceType)) return '';

  const metadata = resource?.metadata || {};
  const name = metadata.name || '';
  const namespace = metadata.namespace || '';

  if (isSystemNamespace(namespace)) {
    return `系统命名空间 "${namespace}" 中的资源受保护，禁止删除`;
  }

  if (namespace === 'default' && name === 'kubernetes') {
    return 'Kubernetes API Server Service 是系统核心资源，禁止删除';
  }

  const labels = metadata.labels || {};
  if (labels['app.kubernetes.io/managed-by']) {
    return `由 ${labels['app.kubernetes.io/managed-by']} 管理的系统资源，禁止删除`;
  }

  if (resource?.type === 'kubernetes.io/service-account-token') {
    return 'ServiceAccount Token 是系统自动生成的，禁止删除';
  }

  if (resource?.type === 'helm.sh/release.v1') {
    return 'Helm Release 记录是系统资源，禁止删除';
  }

  return '系统内置资源，禁止删除';
}

/**
 * 查找仍引用指定 Harvester VirtualMachineImage（命名空间 + metadata.name）的虚拟机，供删除镜像前提示。
 * 以 dataVolumeTemplates[].spec.source.image 为主；不同 Harvester 版本如有遗漏可再扩展。
 */
export function findVmsReferencingHarvesterImage(
  imageNamespace: string,
  imageMetadataName: string,
  vms: any[],
): Array<{ ns: string; name: string; label: string }> {
  const imgNs = String(imageNamespace || '').trim();
  const imgName = String(imageMetadataName || '').trim();
  const out: Array<{ ns: string; name: string; label: string }> = [];
  if (!imgNs || !imgName || !Array.isArray(vms)) return out;
  const seen = new Set<string>();

  const pushVm = (vm: any) => {
    const vmNs = String(vm?.metadata?.namespace || vm?.namespace || '').trim();
    const vmName = String(vm?.metadata?.name || vm?.name || '').trim();
    if (!vmName) return;
    const k = `${vmNs}/${vmName}`;
    if (seen.has(k)) return;
    seen.add(k);
    const alias = String(vm?.metadata?.annotations?.['tower.io/alias'] || '').trim();
    const label = alias ? `${alias}（${vmNs}/${vmName}）` : `${vmNs}/${vmName}`;
    out.push({ ns: vmNs, name: vmName, label });
  };

  for (const vm of vms) {
    const templates = vm?.spec?.dataVolumeTemplates;
    if (Array.isArray(templates)) {
      for (const t of templates) {
        const srcImg = t?.spec?.source?.image;
        if (srcImg && typeof srcImg === 'object') {
          const iname = String(srcImg.name || '').trim();
          const ins = String(srcImg.namespace || '').trim();
          if (iname === imgName && (!ins || ins === imgNs)) {
            pushVm(vm);
            break;
          }
        }
      }
    }
  }
  return out;
}

/**
 * 翻译 Kubernetes API 错误信息为中文
 * 用于 Service、Ingress、Job 等资源创建/编辑时的错误提示
 */
export function translateK8sError(error: any): string {
  if (!error) return '操作失败';

  // 直接检查 error.body（后端 requestJson 返回的格式）
  if (error?.body?.reason === 'AlreadyExists') {
    const field = error.body?.details?.name || '';
    const kind = error.body?.details?.kind || '资源';
    if (field) {
      return `${kind} "${field}" 已存在，请使用其他名称`;
    }
    return '资源已存在，请使用其他名称';
  }

  // 检查 HTTP 状态码 409
  if (error?.status === 409 || error?.response?.status === 409) {
    const name = error?.body?.details?.name || error?.response?.data?.details?.name || '';
    const kind = error?.body?.details?.kind || error?.response?.data?.details?.kind || '资源';
    if (name) {
      return `${kind} "${name}" 已存在，请使用其他名称`;
    }
    return '资源已存在，请使用其他名称';
  }

  let errorMsg = '';
  if (typeof error === 'string') {
    errorMsg = error;
  } else if (error?.response?.data?.message) {
    errorMsg = error.response.data.message;
  } else if (error?.body && typeof error.body === 'string') {
    errorMsg = error.body;
  } else if (error?.body?.message) {
    errorMsg = error.body.message;
  } else if (error?.message) {
    errorMsg = error.message;
  } else {
    return '操作失败';
  }

  if (!errorMsg.includes('{"kind":"Status"')) {
    return errorMsg;
  }

  try {
    const statusMatch = errorMsg.match(/\{"kind":"Status".*\}/);
    if (!statusMatch) return errorMsg;

    const status = JSON.parse(statusMatch[0]);
    const reason = status?.reason || '';
    const message = status?.message || '';
    const causes = status?.details?.causes || [];

    const translations: Record<string, string> = {
      'spec.ports: Required value': '端口配置不能为空，请至少添加一个端口',
      'spec.selector: Invalid value': '选择器格式无效，只能包含字母、数字、连字符(-)、下划线(_)和点(.)，且必须以字母或数字开头和结尾',
      'metadata.labels: Invalid value': '标签格式无效，只能包含字母、数字、连字符(-)、下划线(_)和点(.)，且必须以字母或数字开头和结尾',
      'spec.ports[0].name: Invalid value': '端口名称格式无效，只能包含小写字母、数字和连字符(-)，且必须以字母或数字开头和结尾',
      'spec.ports[0].nodePort: Invalid value': 'NodePort 端口无效',
      'spec.ports[0].targetPort': '容器内部端口格式无效，必须为数字',
      'must be an empty string or consist of alphanumeric': '只能包含字母、数字、连字符(-)、下划线(_)和点(.)，且必须以字母或数字开头和结尾',
      'must start and end with an alphanumeric character': '必须以字母或数字开头和结尾',
    };

    for (const cause of causes) {
      const field = cause?.field || '';
      const causeMessage = cause?.message || '';

      if (field === 'spec.ports' && causeMessage === 'Required value') {
        return translations['spec.ports: Required value'];
      }

      if (field === 'spec.selector' && causeMessage.includes('Invalid value')) {
        return translations['spec.selector: Invalid value'];
      }

      if (field === 'metadata.labels' && causeMessage.includes('Invalid value')) {
        return translations['metadata.labels: Invalid value'];
      }

      if (field === 'spec.ports[0].name' && causeMessage.includes('Invalid value')) {
        return translations['spec.ports[0].name: Invalid value'];
      }

      if (field === 'spec.ports[0].nodePort') {
        if (causeMessage.includes('already allocated')) {
          const portMatch = causeMessage.match(/Invalid value: (\d+)/);
          const port = portMatch ? portMatch[1] : '';
          return `NodePort 端口 ${port} 已被占用，请选择其他端口（范围：30000-32767）`;
        }
        return translations['spec.ports[0].nodePort: Invalid value'];
      }

      if (causeMessage.includes('must be an empty string or consist of alphanumeric')) {
        const fieldName = field === 'metadata.labels' ? '标签' : 
                         field === 'spec.selector' ? '选择器' : '字段';
        return `${fieldName}格式无效，只能包含字母、数字、连字符(-)、下划线(_)和点(.)，且必须以字母或数字开头和结尾`;
      }

      if (causeMessage.includes('must start and end with an alphanumeric character')) {
        const fieldName = field === 'metadata.labels' ? '标签' : 
                         field === 'spec.selector' ? '选择器' : '字段';
        return `${fieldName}必须以字母或数字开头和结尾`;
      }
    }

    if (reason === 'BadRequest' && message.includes('cannot unmarshal array')) {
      return '容器内部端口格式无效，必须为数字';
    }

    if (reason === 'AlreadyExists') {
      const field = status?.details?.name || '';
      const kind = status?.details?.kind || '资源';
      if (field) {
        return `${kind} "${field}" 已存在，请使用其他名称`;
      }
      return '资源已存在，请使用其他名称';
    }

    if (message.includes('admission webhook') && message.includes('denied the request')) {
      if (message.includes('is already defined in ingress')) {
        const pathMatch = message.match(/path "([^"]+)"/);
        const hostMatch = message.match(/host "([^"]+)"/);
        const path = pathMatch ? pathMatch[1] : '';
        const host = hostMatch ? hostMatch[1] : '';
        if (host && path) {
          return `主机 "${host}" 下的路径 "${path}" 已被其他 Ingress 使用，请更换路径`;
        }
        return '该路径已被其他 Ingress 使用，请更换路径';
      }
      return message;
    }

    return message || reason || '操作失败';
  } catch (e) {
    console.error('解析 K8s 错误信息失败:', e);
    return errorMsg;
  }
}

/** 备份/快照条目关联的源 VM 名称（兼容 VirtualMachineBackup 与 CephVmBackup） */
export function harvesterBackupSourceVmName(item: any): string {
  const raw = item?.rawData || item;
  return String(
    raw?.spec?.source?.name || raw?.spec?.sourceVm || item?.targetVm || item?.sourceVm || '',
  ).trim();
}

/** 是否为 ScheduleCephVmBackup（hms.rivercloud.com） */
export function isHarvesterCephScheduleVmBackup(item: any): boolean {
  const raw = item?.rawData || item;
  const kind = String(raw?.kind || '').toLowerCase();
  if (kind === 'schedulecephvmbackup') return true;
  if (String(raw?.metadata?.annotations?.['tower.io/scheduleBackupBackend'] || '') === 'ceph') {
    return true;
  }
  const api = String(raw?.apiVersion || '').toLowerCase();
  return api.includes('hms.rivercloud.com') && kind.includes('schedule') && kind.includes('ceph');
}

/** ScheduleVmBackup / ScheduleCephVmBackup 关联的源虚拟机名 */
export function harvesterScheduleVmBackupSourceVmName(item: any): string {
  const raw = item?.rawData || item;
  if (isHarvesterCephScheduleVmBackup(item)) {
    return String(raw?.spec?.targetVm || raw?.spec?.vmbackup?.source?.name || item?.vmName || '').trim();
  }
  return String(raw?.spec?.vmbackup?.source?.name || item?.vmName || '').trim();
}

/** 是否为 CephVmBackup（hms.rivercloud.com） */
export function isHarvesterCephVmBackup(item: any): boolean {
  const raw = item?.rawData || item;
  const kind = String(raw?.kind || '').toLowerCase();
  if (kind === 'cephvmbackup') return true;
  if (String(raw?.metadata?.annotations?.['tower.io/backupBackend'] || '') === 'ceph') return true;
  const api = String(raw?.apiVersion || '').toLowerCase();
  return api.includes('hms.rivercloud.com') && kind !== 'cephvmrestore';
}

/** 是否为 CephVmRestore（hms.rivercloud.com） */
export function isHarvesterCephVmRestore(item: any): boolean {
  const raw = item?.rawData || item;
  const kind = String(raw?.kind || '').toLowerCase();
  if (kind === 'cephvmrestore') return true;
  if (String(raw?.metadata?.annotations?.['tower.io/restoreBackend'] || '') === 'ceph') return true;
  const api = String(raw?.apiVersion || '').toLowerCase();
  return api.includes('hms.rivercloud.com') && kind === 'cephvmrestore';
}
