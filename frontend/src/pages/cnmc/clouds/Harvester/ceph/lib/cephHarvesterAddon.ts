/** Harvester rook-ceph Addon 状态、结构化配置与块设备/节点表单辅助 */

export type CephHarvesterAddonPhase = 'not_installed' | 'success' | 'progress' | 'failed' | 'unknown';

export type CephHarvesterAddonNodeDevice = {
  nodeName: string;
  deviceName: string;
  metadataDevice?: string;
  /** 每盘 BlueStore DB 容量（MB）；与 hms-ceph values `databaseSizeMB` 对齐 */
  databaseSizeMB?: number;
};

/** 向导表单：每行一个节点，数据盘多选 */
export type CephHarvesterAddonNodeFormRow = {
  nodeName: string;
  deviceNames: string[];
  metadataDevice?: string;
  databaseSizeMB?: number;
};

export function defaultNodeDeviceFormRows(): CephHarvesterAddonNodeFormRow[] {
  return [{ nodeName: '', deviceNames: [], metadataDevice: '' }];
}

export function normalizeDeviceNames(value: unknown): string[] {
  if (value == null) return [];
  if (Array.isArray(value)) {
    return value.map((v) => String(v ?? '').trim()).filter(Boolean);
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed ? [trimmed] : [];
  }
  return [];
}

/** 解析 `databaseSizeMB`；兼容存量 values 中的 `blockDbSize`（如 `30Gi` → 30720 MB） */
export function parseDatabaseSizeMB(raw: unknown): number | undefined {
  if (raw == null || raw === '') return undefined;
  if (typeof raw === 'number' && Number.isFinite(raw) && raw > 0) {
    return Math.trunc(raw);
  }
  const s = String(raw).trim();
  if (!s) return undefined;
  const gi = s.match(/^(\d+(?:\.\d+)?)\s*(?:GiB?|G)?$/i);
  if (gi) {
    const n = Number(gi[1]);
    if (Number.isFinite(n) && n > 0) return Math.trunc(n * 1024);
  }
  const plain = Number(s);
  if (Number.isFinite(plain) && plain > 0) return Math.trunc(plain);
  return undefined;
}

/** 表单 InputNumber 归一化为 MB 整数 */
export function normalizeDatabaseSizeMBInput(value: unknown): number | undefined {
  return parseDatabaseSizeMB(value);
}

export function groupNodeDevicesForForm(
  nodes: CephHarvesterAddonNodeDevice[],
): CephHarvesterAddonNodeFormRow[] {
  const byNode = new Map<string, CephHarvesterAddonNodeFormRow>();
  for (const row of nodes) {
    const nodeName = String(row?.nodeName || '').trim();
    if (!nodeName) continue;
    if (!byNode.has(nodeName)) {
      byNode.set(nodeName, {
        nodeName,
        deviceNames: [],
        metadataDevice: row.metadataDevice ?? '',
        databaseSizeMB: parseDatabaseSizeMB(
          row.databaseSizeMB ?? (row as { blockDbSize?: unknown }).blockDbSize,
        ),
      });
    }
    const entry = byNode.get(nodeName)!;
    const deviceName = String(row?.deviceName || '').trim();
    if (deviceName && !entry.deviceNames.includes(deviceName)) {
      entry.deviceNames.push(deviceName);
    }
    if (row.metadataDevice != null && String(row.metadataDevice).trim()) {
      entry.metadataDevice = String(row.metadataDevice);
    }
    const dbMb = parseDatabaseSizeMB(
      row.databaseSizeMB ?? (row as { blockDbSize?: unknown }).blockDbSize,
    );
    if (dbMb != null) entry.databaseSizeMB = dbMb;
  }
  const grouped = Array.from(byNode.values());
  return grouped.length > 0 ? grouped : defaultNodeDeviceFormRows();
}

export function flattenNodeDevicesFromForm(
  rows: CephHarvesterAddonNodeFormRow[] | undefined,
): CephHarvesterAddonNodeDevice[] {
  const out: CephHarvesterAddonNodeDevice[] = [];
  for (const row of rows || []) {
    const nodeName = String(row?.nodeName || '').trim();
    if (!nodeName) continue;
    const metadataDevice = String(row.metadataDevice ?? '').trim();
    const databaseSizeMB = parseDatabaseSizeMB(
      row.databaseSizeMB ?? (row as { blockDbSize?: unknown }).blockDbSize,
    );
    let deviceNames = normalizeDeviceNames(row.deviceNames);
    if (deviceNames.length === 0) {
      const legacy = String((row as { deviceName?: string }).deviceName ?? '').trim();
      if (legacy) deviceNames = [legacy];
    }
    for (const deviceName of deviceNames) {
      out.push({
        nodeName,
        deviceName,
        metadataDevice,
        ...(databaseSizeMB != null ? { databaseSizeMB } : {}),
      });
    }
  }
  return out;
}

/** 向导 Form 值（节点行含 deviceNames 多选） */
export type CephHarvesterAddonFormValues = Omit<CephHarvesterAddonValuesConfig, 'cephCluster'> & {
  cephCluster: Omit<CephHarvesterAddonValuesConfig['cephCluster'], 'nodes'> & {
    nodes: CephHarvesterAddonNodeFormRow[];
  };
};

export type CephHarvesterAddonValuesConfig = {
  replicaSize: number;
  requireSafeReplicaSize: boolean;
  compressionMode: string;
  storageClass: {
    jobImage: string;
    reclaimPolicy: 'Delete' | 'Retain';
    allowVolumeExpansion: boolean;
    volumeBindingMode: 'Immediate' | 'WaitForFirstConsumer';
  };
  cephtools: {
    replicas: number;
    image: string;
  };
  cephCluster: {
    cephVersionImage: string;
    allowUnsupported: boolean;
    monCount: number;
    allowMultipleMonPerNode: boolean;
    mgrCount: number;
    dashboardEnabled: boolean;
    useAllNodes: boolean;
    useAllDevices: boolean;
    nodes: CephHarvesterAddonNodeDevice[];
    osdsPerDevice: string;
    osdObjectstore: string;
    metadataDevice: string;
  };
  operator: {
    replicas: number;
    image: string;
  };
};

export type CephHarvesterAddonStatus = {
  exists: boolean;
  enabled: boolean;
  deployStatus: string;
  phase: CephHarvesterAddonPhase;
  message: string;
  valuesContent?: string | null;
  config?: CephHarvesterAddonValuesConfig | null;
};

export type CephHarvesterAddonApplyPayload = {
  config?: CephHarvesterAddonValuesConfig;
  replicaSize?: number;
  nodes?: CephHarvesterAddonNodeDevice[];
  valuesContent?: string;
};

export const CEPH_HARVESTER_DEFAULT_CEPH_IMAGE = 'quay.io/ceph/ceph:v19.2.3';
export const CEPH_HARVESTER_DEFAULT_ROOK_OPERATOR_IMAGE = 'docker.io/rook/ceph:v1.19.3';

export function defaultCephHarvesterAddonValuesConfig(
  replicaSize = 3,
): CephHarvesterAddonValuesConfig {
  const size = Math.max(1, Math.min(7, Math.trunc(replicaSize) || 3));
  const monMgr = Math.min(3, size);
  return {
    replicaSize: size,
    requireSafeReplicaSize: false,
    compressionMode: 'none',
    storageClass: {
      jobImage: 'docker.io/rancher/shell:v0.5.0',
      reclaimPolicy: 'Delete',
      allowVolumeExpansion: true,
      volumeBindingMode: 'Immediate',
    },
    cephtools: {
      replicas: monMgr,
      image: CEPH_HARVESTER_DEFAULT_CEPH_IMAGE,
    },
    cephCluster: {
      cephVersionImage: CEPH_HARVESTER_DEFAULT_CEPH_IMAGE,
      allowUnsupported: false,
      monCount: monMgr,
      allowMultipleMonPerNode: false,
      mgrCount: monMgr,
      dashboardEnabled: true,
      useAllNodes: false,
      useAllDevices: false,
      nodes: [{ nodeName: '', deviceName: '', metadataDevice: '' }],
      osdsPerDevice: '1',
      osdObjectstore: 'bluestore',
      metadataDevice: '',
    },
    operator: {
      replicas: 1,
      image: CEPH_HARVESTER_DEFAULT_ROOK_OPERATOR_IMAGE,
    },
  };
}

/** 将 API 返回的 config 转为 Ant Design Form 初始值 */
export function configToFormValues(
  config: CephHarvesterAddonValuesConfig | null | undefined,
): CephHarvesterAddonValuesConfig {
  const defaults = defaultCephHarvesterAddonValuesConfig();
  if (!config) return defaults;
  const nodes =
    Array.isArray(config.cephCluster.nodes) && config.cephCluster.nodes.length > 0
      ? config.cephCluster.nodes.map((n) => ({
          nodeName: n.nodeName || '',
          deviceName: n.deviceName || '',
          metadataDevice: n.metadataDevice ?? '',
          databaseSizeMB: parseDatabaseSizeMB(
            n.databaseSizeMB ?? (n as { blockDbSize?: unknown }).blockDbSize,
          ),
        }))
      : defaults.cephCluster.nodes;
  return {
    ...defaults,
    ...config,
    storageClass: { ...defaults.storageClass, ...config.storageClass },
    cephtools: { ...defaults.cephtools, ...config.cephtools },
    cephCluster: { ...defaults.cephCluster, ...config.cephCluster, nodes },
    operator: { ...defaults.operator, ...config.operator },
  };
}

export type CephHarvesterAddonFormValuesWithOverride = CephHarvesterAddonFormValues & {
  valuesContentOverride?: string;
};

/** 向导空表单（未安装 / 等待拉取状态前） */
export function buildDefaultHarvesterAddonFormValues(): CephHarvesterAddonFormValuesWithOverride {
  const defaults = defaultCephHarvesterAddonValuesConfig();
  return {
    ...defaults,
    cephCluster: {
      ...defaults.cephCluster,
      nodes: defaultNodeDeviceFormRows(),
    },
    valuesContentOverride: '',
  };
}

function configNodesToFormRows(
  nodes: CephHarvesterAddonNodeDevice[] | undefined,
): CephHarvesterAddonNodeFormRow[] {
  const grouped = groupNodeDevicesForForm(nodes || []);
  if (grouped.length === 0) return defaultNodeDeviceFormRows();
  return grouped.map((row) => ({
    ...row,
    deviceNames: normalizeDeviceNames(row.deviceNames),
  }));
}

/** 从 Addon 状态（结构化 config 或 valuesContent）生成向导 Form 值 */
export function buildHarvesterAddonFormValuesFromStatus(
  res: Pick<CephHarvesterAddonStatus, 'config' | 'valuesContent'>,
): CephHarvesterAddonFormValuesWithOverride {
  if (res.config) {
    const cfg = configToFormValues(res.config);
    return {
      ...cfg,
      cephCluster: {
        ...cfg.cephCluster,
        nodes: configNodesToFormRows(cfg.cephCluster.nodes),
      },
      valuesContentOverride: '',
    };
  }
  if (res.valuesContent) {
    const defaults = buildDefaultHarvesterAddonFormValues();
    return {
      ...defaults,
      valuesContentOverride: res.valuesContent,
    };
  }
  return buildDefaultHarvesterAddonFormValues();
}

export function formValuesToApplyConfig(
  values: CephHarvesterAddonFormValues,
): CephHarvesterAddonValuesConfig {
  const nodes = flattenNodeDevicesFromForm(values.cephCluster.nodes);

  return {
    ...values,
    replicaSize: Math.max(1, Math.min(7, Number(values.replicaSize) || 3)),
    cephCluster: {
      ...values.cephCluster,
      nodes,
      useAllNodes: false,
      useAllDevices: false,
    },
  };
}

export function validateAddonConfig(config: CephHarvesterAddonValuesConfig): string | null {
  const nodes = config.cephCluster.nodes || [];
  if (nodes.length === 0) {
    return '请至少为一台节点指定数据盘';
  }
  const keys = nodes.map((r) => `${r.nodeName}/${r.deviceName}`);
  const seen = new Set<string>();
  for (const key of keys) {
    if (seen.has(key)) return '存在重复的节点与磁盘组合，请调整后再提交';
    seen.add(key);
  }
  return null;
}

export function listConfiguredNodeDevices(
  config: CephHarvesterAddonValuesConfig | null | undefined,
): CephHarvesterAddonNodeDevice[] {
  const nodes = config?.cephCluster?.nodes || [];
  return nodes
    .map((r) => ({
      nodeName: String(r?.nodeName || '').trim(),
      deviceName: String(r?.deviceName || '').trim(),
      metadataDevice: r?.metadataDevice ?? '',
      databaseSizeMB: parseDatabaseSizeMB(
        r?.databaseSizeMB ?? (r as { blockDbSize?: unknown }).blockDbSize,
      ),
    }))
    .filter((r) => r.nodeName && r.deviceName);
}

function nodeDeviceKey(nodeName: string, deviceName: string): string {
  return `${nodeName}/${deviceName}`;
}

/** 已部署 OSD 节点/盘集合（用于 UI 锁定，禁止取消勾选或删行） */
export function baselineNodeDeviceKeySet(
  config: CephHarvesterAddonValuesConfig | null | undefined,
): Set<string> {
  return new Set(
    listConfiguredNodeDevices(config).map((r) => nodeDeviceKey(r.nodeName, r.deviceName)),
  );
}

export function baselineNodeNameSet(
  config: CephHarvesterAddonValuesConfig | null | undefined,
): Set<string> {
  return new Set(listConfiguredNodeDevices(config).map((r) => r.nodeName));
}

function nodeLayoutByNode(
  config: CephHarvesterAddonValuesConfig,
): Map<string, { devices: Set<string>; metadataDevice: string; databaseSizeMB?: number }> {
  const byNode = new Map<
    string,
    { devices: Set<string>; metadataDevice: string; databaseSizeMB?: number }
  >();
  for (const row of listConfiguredNodeDevices(config)) {
    if (!byNode.has(row.nodeName)) {
      byNode.set(row.nodeName, {
        devices: new Set(),
        metadataDevice: String(row.metadataDevice ?? ''),
        databaseSizeMB: parseDatabaseSizeMB(
          row.databaseSizeMB ?? (row as { blockDbSize?: unknown }).blockDbSize,
        ),
      });
    }
    const entry = byNode.get(row.nodeName)!;
    entry.devices.add(row.deviceName);
    if (String(row.metadataDevice ?? '').trim()) {
      entry.metadataDevice = String(row.metadataDevice);
    }
    const dbMb = parseDatabaseSizeMB(
      row.databaseSizeMB ?? (row as { blockDbSize?: unknown }).blockDbSize,
    );
    if (dbMb != null) entry.databaseSizeMB = dbMb;
  }
  return byNode;
}

/**
 * 已运行统一存储：仅允许「只增不减」的扩容（新节点 / 新数据盘）。
 * 禁止移除 OSD、改副本/服务规模、换镜像等高风险改配。
 */
export function validateRunningClusterConfigChange(
  before: CephHarvesterAddonValuesConfig,
  after: CephHarvesterAddonValuesConfig,
): string | null {
  const afterKeys = new Set(
    listConfiguredNodeDevices(after).map((r) => nodeDeviceKey(r.nodeName, r.deviceName)),
  );
  for (const row of listConfiguredNodeDevices(before)) {
    const key = nodeDeviceKey(row.nodeName, row.deviceName);
    if (!afterKeys.has(key)) {
      return `不可移除已有 OSD：${row.nodeName} / ${row.deviceName}。扩容请仅新增节点或数据盘。`;
    }
  }

  const beforeByNode = nodeLayoutByNode(before);
  const afterByNode = nodeLayoutByNode(after);
  for (const [nodeName, prev] of beforeByNode) {
    const next = afterByNode.get(nodeName);
    if (!next) {
      return `不可移除已有存储节点 ${nodeName}。`;
    }
    if (prev.metadataDevice !== next.metadataDevice) {
      return `不可修改节点 ${nodeName} 的元数据盘。`;
    }
    if (prev.databaseSizeMB !== next.databaseSizeMB) {
      return `不可修改节点 ${nodeName} 的每盘缓存区大小。`;
    }
  }

  if (before.replicaSize !== after.replicaSize) {
    return '已运行集群不可在此修改数据副本数。';
  }
  if (before.compressionMode !== after.compressionMode) {
    return '已运行集群不可在此修改数据压缩策略。';
  }
  if (before.requireSafeReplicaSize !== after.requireSafeReplicaSize) {
    return '已运行集群不可在此修改严格副本数校验。';
  }
  if (before.cephCluster.monCount !== after.cephCluster.monCount) {
    return '已运行集群不可在此修改管理节点数量。';
  }
  if (before.cephCluster.mgrCount !== after.cephCluster.mgrCount) {
    return '已运行集群不可在此修改调度服务数量。';
  }
  if (before.cephCluster.dashboardEnabled !== after.cephCluster.dashboardEnabled) {
    return '已运行集群不可在此修改内置监控面板开关。';
  }
  if (before.cephCluster.cephVersionImage !== after.cephCluster.cephVersionImage) {
    return '已运行集群不可在此更换存储引擎版本。';
  }
  if (before.cephCluster.allowUnsupported !== after.cephCluster.allowUnsupported) {
    return '已运行集群不可在此修改「允许非官方支持版本」。';
  }
  if (before.cephCluster.osdsPerDevice !== after.cephCluster.osdsPerDevice) {
    return '已运行集群不可在此修改每盘存储进程数。';
  }
  if (before.cephCluster.osdObjectstore !== after.cephCluster.osdObjectstore) {
    return '已运行集群不可在此修改磁盘存储引擎。';
  }
  if (before.cephCluster.metadataDevice !== after.cephCluster.metadataDevice) {
    return '已运行集群不可在此修改集群级元数据盘。';
  }
  if (before.cephCluster.allowMultipleMonPerNode !== after.cephCluster.allowMultipleMonPerNode) {
    return '已运行集群不可在此修改管理节点部署策略。';
  }
  if (
    before.cephtools.replicas !== after.cephtools.replicas ||
    before.cephtools.image !== after.cephtools.image ||
    before.operator.replicas !== after.operator.replicas ||
    before.operator.image !== after.operator.image
  ) {
    return '已运行集群不可在此更换运维工具或存储控制器配置。';
  }
  if (JSON.stringify(before.storageClass) !== JSON.stringify(after.storageClass)) {
    return '已运行集群不可在此修改云硬盘默认策略。';
  }

  const beforeCount = listConfiguredNodeDevices(before).length;
  const afterCount = listConfiguredNodeDevices(after).length;
  if (afterCount <= beforeCount) {
    return '已运行集群提交时须新增至少一块数据盘或一个新节点上的 OSD。';
  }

  return null;
}

function steveList(data: unknown): unknown[] {
  if (Array.isArray(data)) return data;
  if (data && typeof data === 'object') {
    const o = data as Record<string, unknown>;
    if (Array.isArray(o.data)) return o.data;
    if (Array.isArray(o.items)) return o.items;
  }
  return [];
}

export function parseNodeNameOptions(nodeResources: unknown): { label: string; value: string }[] {
  const names = new Set<string>();
  for (const item of steveList(nodeResources)) {
    const o = item as Record<string, unknown>;
    const md = (o.metadata || {}) as Record<string, unknown>;
    const name = String(md.name ?? o.name ?? o.id ?? '').trim();
    if (name) names.add(name);
  }
  return Array.from(names)
    .sort((a, b) => a.localeCompare(b, 'zh-CN'))
    .map((value) => ({ value, label: value }));
}

/** Harvester BlockDevice → 向导可选盘（含物理识别信息） */
export type CephBlockDeviceOption = {
  /** BlockDevice CR metadata.name，用于 UI 唯一 key */
  blockDeviceCrName: string;
  /** 写入 Ceph/Rook 配置的设备名（如 sdd、nvme0n1） */
  value: string;
  nodeName: string;
  /** 主展示文案 */
  label: string;
  devPath: string;
  sizeLabel: string;
  model: string;
  serialNumber: string;
  driveType: string;
  wwn: string;
  busPath: string;
  provisionPhase: string;
};

export function formatBlockDeviceSizeBytes(bytes: unknown): string {
  const n = Number(bytes);
  if (!Number.isFinite(n) || n <= 0) return '';
  const tb = n / 1e12;
  const gb = n / 1e9;
  if (tb >= 1) return `${tb.toFixed(tb >= 10 ? 0 : 1)} TB`;
  if (gb >= 1) return `${gb.toFixed(gb >= 100 ? 0 : 1)} GB`;
  return `${Math.max(1, Math.round(n / 1e6))} MB`;
}

function basenameDevPath(path: string): string {
  const trimmed = String(path || '').trim();
  if (!trimmed) return '';
  const stripped = trimmed.replace(/^\/dev\//, '');
  const parts = stripped.split('/').filter(Boolean);
  return parts[parts.length - 1] || stripped;
}

function looksLikeOpaqueBlockDeviceId(name: string): boolean {
  const s = name.trim();
  if (!s) return false;
  if (/^[0-9a-f]{32}$/i.test(s)) return true;
  if (/^[0-9a-f-]{36}$/i.test(s)) return true;
  return s.length >= 24 && /^[0-9a-f-]+$/i.test(s);
}

/** Rook OSD 应使用整盘；排除 RBD 映射盘、loop、软 RAID 成员等虚拟/非候选设备 */
const CEPH_OSD_VIRTUAL_DEVICE_NAME = /^(?:rbd\d+|loop\d+|sr\d+|dm-\d+|md\d+|nbd\d+|zram\d+|ram\d+|fd\d+)$/i;

export function isCephOsdCandidateDeviceName(name: string): boolean {
  const base = basenameDevPath(name);
  if (!base) return false;
  return !CEPH_OSD_VIRTUAL_DEVICE_NAME.test(base);
}

function blockDeviceOptionRank(opt: CephBlockDeviceOption): number {
  let score = 0;
  if (opt.provisionPhase === 'Provisioned') score += 100;
  if (opt.serialNumber && opt.serialNumber.toLowerCase() !== 'unknown') score += 20;
  if (opt.model && opt.model.toLowerCase() !== 'unknown') score += 10;
  if (opt.wwn) score += 5;
  const size = Number(String(opt.sizeLabel).replace(/[^\d.]/g, ''));
  if (Number.isFinite(size)) score += Math.min(size / 1000, 50);
  return score;
}

function dedupeBlockDeviceOptionsByValue(options: CephBlockDeviceOption[]): CephBlockDeviceOption[] {
  const byValue = new Map<string, CephBlockDeviceOption>();
  for (const opt of options) {
    const prev = byValue.get(opt.value);
    if (!prev || blockDeviceOptionRank(opt) > blockDeviceOptionRank(prev)) {
      byValue.set(opt.value, opt);
    }
  }
  return Array.from(byValue.values());
}

function readBlockDeviceStatus(status: Record<string, unknown>) {
  const ds = (status.deviceStatus || {}) as Record<string, unknown>;
  const capacity = (ds.capacity || {}) as Record<string, unknown>;
  const details = (ds.details || {}) as Record<string, unknown>;
  return {
    devPath: String(ds.devicePath ?? '').trim(),
    sizeBytes: capacity.sizeBytes,
    model: String(details.model ?? '').trim(),
    serialNumber: String(details.serialNumber ?? '').trim(),
    driveType: String(details.driveType ?? '').trim(),
    wwn: String(details.wwn ?? '').trim(),
    busPath: String(details.busPath ?? '').trim(),
  };
}

function resolveCephDeviceName(
  spec: Record<string, unknown>,
  status: Record<string, unknown>,
  md: Record<string, unknown>,
): string {
  const fromSpec = basenameDevPath(String(spec.devPath ?? spec.devicePath ?? '').trim());
  if (fromSpec) return fromSpec;
  const st = readBlockDeviceStatus(status);
  const fromStatus = basenameDevPath(st.devPath);
  if (fromStatus) return fromStatus;
  const crName = String(md.name ?? '').trim();
  if (crName && !looksLikeOpaqueBlockDeviceId(crName)) return crName;
  return crName;
}

export function formatBlockDeviceOptionSummary(opt: CephBlockDeviceOption): string {
  const head = opt.devPath || (opt.value ? `/dev/${opt.value}` : opt.label);
  const meta = [
    opt.sizeLabel,
    opt.driveType,
    opt.model,
    opt.serialNumber ? `SN ${opt.serialNumber}` : '',
  ].filter(Boolean);
  return meta.length > 0 ? `${head} · ${meta.join(' · ')}` : head;
}

export function blockDeviceOptionTooltip(opt: CephBlockDeviceOption): string {
  return [
    opt.blockDeviceCrName ? `BlockDevice：${opt.blockDeviceCrName}` : null,
    opt.devPath ? `设备路径：${opt.devPath}` : null,
    opt.value ? `配置标识：${opt.value}` : null,
    opt.sizeLabel ? `容量：${opt.sizeLabel}` : null,
    opt.driveType ? `类型：${opt.driveType}` : null,
    opt.model ? `型号：${opt.model}` : null,
    opt.serialNumber ? `序列号：${opt.serialNumber}` : null,
    opt.wwn ? `WWN：${opt.wwn}` : null,
    opt.busPath ? `总线路径：${opt.busPath}` : null,
    opt.provisionPhase ? `纳管状态：${opt.provisionPhase}` : null,
  ]
    .filter(Boolean)
    .join('\n');
}

export function describeSelectedBlockDevices(
  blockDevices: unknown,
  nodeName: string,
  deviceNames: string[] | undefined,
): string {
  const opts = parseBlockDeviceOptions(blockDevices, nodeName);
  const byValue = new Map(opts.map((o) => [o.value, o]));
  return normalizeDeviceNames(deviceNames)
    .map((value) => {
      const opt = byValue.get(value);
      return opt ? formatBlockDeviceOptionSummary(opt) : value;
    })
    .join('；');
}

export function parseBlockDeviceOptions(
  blockDevices: unknown,
  nodeName?: string,
): CephBlockDeviceOption[] {
  const out: CephBlockDeviceOption[] = [];
  for (const item of steveList(blockDevices)) {
    const o = item as Record<string, unknown>;
    const md = (o.metadata || {}) as Record<string, unknown>;
    const spec = (o.spec || {}) as Record<string, unknown>;
    const status = (o.status || {}) as Record<string, unknown>;
    const node = String(spec.nodeName ?? md.nodeName ?? '').trim();
    if (nodeName && node !== nodeName) continue;

    const st = readBlockDeviceStatus(status);
    const devPath = String(spec.devPath ?? spec.devicePath ?? st.devPath ?? '').trim();
    const value = resolveCephDeviceName(spec, status, md);
    if (!value) continue;
    if (!isCephOsdCandidateDeviceName(value) && !isCephOsdCandidateDeviceName(devPath)) continue;

    const blockDeviceCrName = String(md.name ?? '').trim();
    const sizeLabel = formatBlockDeviceSizeBytes(st.sizeBytes);
    const provisionPhase = String(status.provisionPhase ?? '').trim();
    const label = formatBlockDeviceOptionSummary({
      blockDeviceCrName,
      value,
      nodeName: node || value,
      label: '',
      devPath,
      sizeLabel,
      model: st.model,
      serialNumber: st.serialNumber,
      driveType: st.driveType,
      wwn: st.wwn,
      busPath: st.busPath,
      provisionPhase,
    });

    out.push({
      blockDeviceCrName,
      value,
      nodeName: node || value,
      label,
      devPath,
      sizeLabel,
      model: st.model,
      serialNumber: st.serialNumber,
      driveType: st.driveType,
      wwn: st.wwn,
      busPath: st.busPath,
      provisionPhase,
    });
  }
  out.sort((a, b) => a.label.localeCompare(b.label, 'zh-CN'));
  return dedupeBlockDeviceOptionsByValue(out);
}

/** 将 Addon 已保存的设备名并入可选列表，便于已部署集群回显（即使当前 BlockDevice 列表未包含） */
export function mergeConfiguredBlockDeviceOptions(
  options: CephBlockDeviceOption[],
  configuredNames: string[] | undefined,
  nodeName: string,
): CephBlockDeviceOption[] {
  const merged = new Map(options.map((o) => [o.value, o]));
  for (const value of normalizeDeviceNames(configuredNames)) {
    if (merged.has(value)) continue;
    merged.set(value, {
      blockDeviceCrName: `configured:${nodeName}:${value}`,
      value,
      nodeName,
      label: value,
      devPath: value.includes('/') ? value : `/dev/${value}`,
      sizeLabel: '',
      model: '',
      serialNumber: '',
      driveType: '',
      wwn: '',
      busPath: '',
      provisionPhase: 'Configured',
    });
  }
  return Array.from(merged.values()).sort((a, b) => a.label.localeCompare(b.label, 'zh-CN'));
}

function isMetadataDeviceCandidate(opt: CephBlockDeviceOption): boolean {
  const driveType = String(opt.driveType ?? '').trim().toLowerCase();
  if (driveType === 'hdd') return false;

  const base = basenameDevPath(opt.value || opt.devPath).toLowerCase();
  if (base.startsWith('nvme')) return true;
  if (driveType === 'ssd') return true;

  if (!driveType || driveType === 'unknown') {
    const model = String(opt.model ?? '').toLowerCase();
    if (model.includes('ssd') || model.includes('nvme') || model.includes('solid state')) return true;
    if (model.includes('hdd') || model.includes('hard disk')) return false;
    return false;
  }

  return true;
}

/** 节点「元数据盘」下拉：BlockDevice 列表，排除 HDD 与已选数据盘，并回显已保存配置 */
export function buildMetadataDeviceSelectOptions(
  blockDevicesRaw: unknown,
  nodeName: string,
  configuredMetadataDevice: string | undefined,
  dataDeviceNames: string[] | undefined,
): { value: string; label: string }[] {
  const dataSet = new Set(normalizeDeviceNames(dataDeviceNames));
  const configured = String(configuredMetadataDevice ?? '').trim();
  const opts = mergeConfiguredBlockDeviceOptions(
    parseBlockDeviceOptions(blockDevicesRaw, nodeName),
    configured ? [configured] : [],
    nodeName,
  ).filter((o) => !dataSet.has(o.value) && isMetadataDeviceCandidate(o));
  return opts.map((o) => ({
    value: o.value,
    label: formatBlockDeviceOptionSummary(o),
  }));
}

export function addonPhaseTagColor(phase: CephHarvesterAddonPhase): string {
  switch (phase) {
    case 'success':
      return 'success';
    case 'progress':
      return 'processing';
    case 'failed':
      return 'error';
    case 'not_installed':
      return 'default';
    default:
      return 'warning';
  }
}

export function addonPhaseLabel(phase: CephHarvesterAddonPhase): string {
  switch (phase) {
    case 'success':
      return '已就绪';
    case 'progress':
      return '部署中';
    case 'failed':
      return '失败';
    case 'not_installed':
      return '未安装';
    default:
      return '未知';
  }
}
