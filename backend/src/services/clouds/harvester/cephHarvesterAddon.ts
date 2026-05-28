/**
 * Harvester `Addon`（rook-ceph / hms-ceph）：探测与开启统一存储。
 */
import yaml from 'js-yaml';
import { prepareCephStorageNetworkForAddonDeploy } from './cephStorageNetwork';
import { getJsonOnce, requestJson, resolveHarvesterCloudKubeToken } from './utils';

function normalizeOrigin(endpoint: string): string {
  try {
    const u = new URL(endpoint);
    return `${u.protocol}//${u.host}`;
  } catch {
    return String(endpoint || '').replace(/\/+$/, '').replace(/\/v[0-9].*$/, '');
  }
}

export const ROOK_CEPH_ADDON_NAME = 'rook-ceph';
export const ROOK_CEPH_ADDON_NAMESPACE = 'rook-ceph';
const HMS_CEPH_CHART = 'hms-ceph';
const HMS_CEPH_REPO = 'http://harvester-cluster-repo.cattle-system.svc/charts';
const HMS_CEPH_VERSION = 'v1.19.3';
export const CEPH_HARVESTER_DEFAULT_CEPH_IMAGE = 'quay.io/ceph/ceph:v19.2.3';
export const CEPH_HARVESTER_DEFAULT_ROOK_OPERATOR_IMAGE = 'docker.io/rook/ceph:v1.19.3';
const CEPH_SHELL_JOB_IMAGE = 'docker.io/rancher/shell:v0.5.0';

export type CephHarvesterAddonNodeDevice = {
  nodeName: string;
  deviceName: string;
  /** 节点级 metadata 盘（同节点多盘时取首条非空） */
  metadataDevice?: string;
  /** 每盘 BlueStore DB 容量（MB）；hms-ceph values `databaseSizeMB` */
  databaseSizeMB?: number;
};

function parseNodeDatabaseSizeMB(nodeConfig: Record<string, unknown>): number | undefined {
  if (nodeConfig.databaseSizeMB != null && nodeConfig.databaseSizeMB !== '') {
    const n = Number(nodeConfig.databaseSizeMB);
    if (Number.isFinite(n) && n > 0) return Math.trunc(n);
  }
  const legacy = strOr(nodeConfig.blockDbSize, '').trim();
  if (!legacy) return undefined;
  const gi = legacy.match(/^(\d+(?:\.\d+)?)\s*(?:GiB?|G)?$/i);
  if (gi) {
    const g = Number(gi[1]);
    if (Number.isFinite(g) && g > 0) return Math.trunc(g * 1024);
  }
  const plain = Number(legacy);
  if (Number.isFinite(plain) && plain > 0) return Math.trunc(plain);
  return undefined;
}

function databaseSizeMBFromDeviceRow(
  row: CephHarvesterAddonNodeDevice & { blockDbSize?: unknown },
): number | undefined {
  if (row.databaseSizeMB != null && Number.isFinite(row.databaseSizeMB) && row.databaseSizeMB > 0) {
    return Math.trunc(row.databaseSizeMB);
  }
  return parseNodeDatabaseSizeMB({ blockDbSize: row.blockDbSize });
}

/** 与 hms-ceph Chart values / deployment/ceph.yaml 对齐的结构化配置 */
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

export type CephHarvesterAddonApplyInput = {
  /** 结构化配置（推荐） */
  config?: CephHarvesterAddonValuesConfig;
  /** @deprecated 兼容旧客户端 */
  replicaSize?: number;
  /** @deprecated 兼容旧客户端 */
  nodes?: CephHarvesterAddonNodeDevice[];
  /** 专家：直接提交完整 Helm values YAML（非空时忽略 config / 旧字段） */
  valuesContent?: string;
};

export type CephHarvesterAddonStatus = {
  exists: boolean;
  enabled: boolean;
  deployStatus: string;
  phase: 'not_installed' | 'success' | 'progress' | 'failed' | 'disabled' | 'unknown';
  message: string;
  valuesContent?: string | null;
  config?: CephHarvesterAddonValuesConfig | null;
  raw?: unknown;
};

function clampInt(n: unknown, min: number, max: number, fallback: number): number {
  const v = Number(n);
  if (!Number.isFinite(v)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(v)));
}

function strOr(v: unknown, fallback: string): string {
  if (v == null) return fallback;
  return String(v);
}

export function defaultCephHarvesterAddonValuesConfig(
  replicaSize = 3,
): CephHarvesterAddonValuesConfig {
  const size = clampInt(replicaSize, 1, 7, 3);
  const monMgr = Math.min(3, size);
  return {
    replicaSize: size,
    requireSafeReplicaSize: false,
    compressionMode: 'none',
    storageClass: {
      jobImage: CEPH_SHELL_JOB_IMAGE,
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
      nodes: [],
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

/** 从 Addon spec.valuesContent 解析为结构化配置；失败时返回 null */
export function parseRookCephAddonValuesContent(
  valuesContent: string | null | undefined,
): CephHarvesterAddonValuesConfig | null {
  const raw = String(valuesContent || '').trim();
  if (!raw) return null;
  try {
    const parsed = yaml.load(raw) as Record<string, unknown> | null;
    if (!parsed || typeof parsed !== 'object') return null;

    const defaults = defaultCephHarvesterAddonValuesConfig();
    const replicapool = (parsed.replicapool || {}) as Record<string, unknown>;
    const replicated = (replicapool.replicated || {}) as Record<string, unknown>;
    const parameters = (replicapool.parameters || {}) as Record<string, unknown>;
    const storageclass = (parsed.storageclass || {}) as Record<string, unknown>;
    const scJob = (storageclass.job || {}) as Record<string, unknown>;
    const cephtools = (parsed.cephtools || {}) as Record<string, unknown>;
    const cephcluster = (parsed.cephcluster || {}) as Record<string, unknown>;
    const cephVersion = (cephcluster.cephVersion || {}) as Record<string, unknown>;
    const mon = (cephcluster.mon || {}) as Record<string, unknown>;
    const mgr = (cephcluster.mgr || {}) as Record<string, unknown>;
    const dashboard = (cephcluster.dashboard || {}) as Record<string, unknown>;
    const storage = (cephcluster.storage || {}) as Record<string, unknown>;
    const clusterConfig = (cephcluster.config || {}) as Record<string, unknown>;
    const operator = (parsed.operator || {}) as Record<string, unknown>;

    const replicaSize = clampInt(replicated.size, 1, 7, defaults.replicaSize);

    const nodeRows: CephHarvesterAddonNodeDevice[] = [];
    const storageNodes = Array.isArray(storage.nodes) ? storage.nodes : [];
    for (const item of storageNodes) {
      if (!item || typeof item !== 'object') continue;
      const row = item as Record<string, unknown>;
      const nodeName = strOr(row.name, '').trim();
      if (!nodeName) continue;
      const nodeConfig = (row.config || {}) as Record<string, unknown>;
      const metaDev = strOr(nodeConfig.metadataDevice, '');
      const databaseSizeMB = parseNodeDatabaseSizeMB(nodeConfig);
      const devices = Array.isArray(row.devices) ? row.devices : [];
      const nodeBase = {
        nodeName,
        metadataDevice: metaDev,
        ...(databaseSizeMB != null ? { databaseSizeMB } : {}),
      };
      if (devices.length === 0) {
        nodeRows.push({ ...nodeBase, deviceName: '' });
        continue;
      }
      for (const dev of devices) {
        if (!dev || typeof dev !== 'object') continue;
        const d = dev as Record<string, unknown>;
        const deviceName = strOr(d.name, '').trim();
        nodeRows.push({ ...nodeBase, deviceName });
      }
    }

    const reclaimPolicyRaw = strOr(storageclass.reclaimPolicy, defaults.storageClass.reclaimPolicy);
    const volumeBindingRaw = strOr(
      storageclass.volumeBindingMode,
      defaults.storageClass.volumeBindingMode,
    );

    return {
      replicaSize,
      requireSafeReplicaSize: replicated.requireSafeReplicaSize === true,
      compressionMode: strOr(parameters.compression_mode, defaults.compressionMode),
      storageClass: {
        jobImage: strOr(scJob.image, defaults.storageClass.jobImage),
        reclaimPolicy: reclaimPolicyRaw === 'Retain' ? 'Retain' : 'Delete',
        allowVolumeExpansion: storageclass.allowVolumeExpansion !== false,
        volumeBindingMode:
          volumeBindingRaw === 'WaitForFirstConsumer' ? 'WaitForFirstConsumer' : 'Immediate',
      },
      cephtools: {
        replicas: clampInt(cephtools.replicas, 1, 7, defaults.cephtools.replicas),
        image: strOr(cephtools.image, defaults.cephtools.image),
      },
      cephCluster: {
        cephVersionImage: strOr(cephVersion.image, defaults.cephCluster.cephVersionImage),
        allowUnsupported: cephVersion.allowUnsupported === true,
        monCount: clampInt(mon.count, 1, 7, defaults.cephCluster.monCount),
        allowMultipleMonPerNode: mon.allowMultiplePerNode === true,
        mgrCount: clampInt(mgr.count, 1, 7, defaults.cephCluster.mgrCount),
        dashboardEnabled: dashboard.enabled !== false,
        useAllNodes: storage.useAllNodes === true,
        useAllDevices: storage.useAllDevices === true,
        nodes: nodeRows.filter((r) => r.nodeName),
        osdsPerDevice: strOr(clusterConfig.osdsPerDevice, defaults.cephCluster.osdsPerDevice),
        osdObjectstore: strOr(clusterConfig.osd_objectstore, defaults.cephCluster.osdObjectstore),
        metadataDevice: strOr(clusterConfig.metadataDevice, defaults.cephCluster.metadataDevice),
      },
      operator: {
        replicas: clampInt(operator.replicas, 1, 3, defaults.operator.replicas),
        image: strOr(operator.image, defaults.operator.image),
      },
    };
  } catch {
    return null;
  }
}

function groupNodesForValues(
  nodes: CephHarvesterAddonNodeDevice[],
): {
  name: string;
  devices: { name: string }[];
  config: { metadataDevice: string; databaseSizeMB?: number };
}[] {
  const byNode = new Map<
    string,
    {
      devices: Set<string>;
      metadataDevice: string;
      databaseSizeMB?: number;
    }
  >();

  for (const row of nodes) {
    const nodeName = String(row?.nodeName || '').trim();
    const deviceName = String(row?.deviceName || '').trim();
    if (!nodeName) continue;
    if (!byNode.has(nodeName)) {
      byNode.set(nodeName, {
        devices: new Set(),
        metadataDevice: String(row.metadataDevice ?? ''),
        databaseSizeMB: databaseSizeMBFromDeviceRow(row),
      });
    }
    const entry = byNode.get(nodeName)!;
    if (deviceName) entry.devices.add(deviceName);
    if (row.metadataDevice != null && String(row.metadataDevice).trim()) {
      entry.metadataDevice = String(row.metadataDevice);
    }
    const dbMb = databaseSizeMBFromDeviceRow(row);
    if (dbMb != null) entry.databaseSizeMB = dbMb;
  }

  return Array.from(byNode.entries()).map(([name, entry]) => ({
    name,
    devices: Array.from(entry.devices).map((deviceName) => ({ name: deviceName })),
    config: {
      metadataDevice: entry.metadataDevice,
      ...(entry.databaseSizeMB != null ? { databaseSizeMB: entry.databaseSizeMB } : {}),
    },
  }));
}

/** 由结构化配置生成 hms-ceph Helm values YAML */
export function buildRookCephAddonValuesFromConfig(
  input: CephHarvesterAddonValuesConfig,
): string {
  const defaults = defaultCephHarvesterAddonValuesConfig(input.replicaSize);
  const cfg: CephHarvesterAddonValuesConfig = {
    ...defaults,
    ...input,
    storageClass: { ...defaults.storageClass, ...input.storageClass },
    cephtools: { ...defaults.cephtools, ...input.cephtools },
    cephCluster: { ...defaults.cephCluster, ...input.cephCluster },
    operator: { ...defaults.operator, ...input.operator },
  };

  const replicaSize = clampInt(cfg.replicaSize, 1, 7, 3);
  const nodes = Array.isArray(cfg.cephCluster.nodes) ? cfg.cephCluster.nodes : [];
  const useAllNodes = cfg.cephCluster.useAllNodes;
  const useAllDevices = cfg.cephCluster.useAllDevices;
  const storageNodes = groupNodesForValues(nodes);
  const explicitNodes = !useAllNodes && storageNodes.length > 0;

  const values: Record<string, unknown> = {
    fullnameOverride: ROOK_CEPH_ADDON_NAME,
    replicapool: {
      replicated: {
        size: replicaSize,
        requireSafeReplicaSize: cfg.requireSafeReplicaSize,
      },
      parameters: {
        compression_mode: cfg.compressionMode,
      },
    },
    storageclass: {
      job: { image: cfg.storageClass.jobImage },
      reclaimPolicy: cfg.storageClass.reclaimPolicy,
      allowVolumeExpansion: cfg.storageClass.allowVolumeExpansion,
      volumeBindingMode: cfg.storageClass.volumeBindingMode,
    },
    cephtools: {
      replicas: clampInt(cfg.cephtools.replicas, 1, 7, Math.min(3, replicaSize)),
      image: cfg.cephtools.image,
    },
    cephcluster: {
      cephVersion: {
        image: cfg.cephCluster.cephVersionImage,
        allowUnsupported: cfg.cephCluster.allowUnsupported,
      },
      mon: {
        count: clampInt(cfg.cephCluster.monCount, 1, 7, Math.min(3, replicaSize)),
        allowMultiplePerNode: cfg.cephCluster.allowMultipleMonPerNode,
      },
      mgr: {
        count: clampInt(cfg.cephCluster.mgrCount, 1, 7, Math.min(3, replicaSize)),
      },
      dashboard: {
        enabled: cfg.cephCluster.dashboardEnabled,
      },
      storage: {
        useAllNodes: explicitNodes ? false : useAllNodes,
        useAllDevices: explicitNodes ? false : useAllDevices,
        ...(explicitNodes ? { nodes: storageNodes } : storageNodes.length > 0 ? { nodes: storageNodes } : {}),
      },
      config: {
        osdsPerDevice: cfg.cephCluster.osdsPerDevice,
        osd_objectstore: cfg.cephCluster.osdObjectstore,
        metadataDevice: cfg.cephCluster.metadataDevice,
      },
    },
    operator: {
      replicas: clampInt(cfg.operator.replicas, 1, 3, 1),
      image: cfg.operator.image,
    },
  };

  if (explicitNodes || (!useAllNodes && !useAllDevices && storageNodes.length > 0)) {
    const storage = values.cephcluster as Record<string, unknown>;
    const storageBlock = storage.storage as Record<string, unknown>;
    storageBlock.useAllNodes = false;
    storageBlock.useAllDevices = false;
    storageBlock.nodes = storageNodes;
  }

  return yaml.dump(values, { lineWidth: 120, noRefs: true }).trim();
}

function legacyInputToConfig(input: CephHarvesterAddonApplyInput): CephHarvesterAddonValuesConfig {
  const replicaSize = clampInt(input.replicaSize, 1, 7, 3);
  const cfg = defaultCephHarvesterAddonValuesConfig(replicaSize);
  const nodesInput = Array.isArray(input.nodes) ? input.nodes : [];
  if (nodesInput.length > 0) {
    cfg.cephCluster.useAllNodes = false;
    cfg.cephCluster.useAllDevices = false;
    cfg.cephCluster.nodes = nodesInput
      .map((r) => {
        const databaseSizeMB = databaseSizeMBFromDeviceRow(
          r as CephHarvesterAddonNodeDevice & { blockDbSize?: unknown },
        );
        return {
          nodeName: String(r?.nodeName || '').trim(),
          deviceName: String(r?.deviceName || '').trim(),
          metadataDevice: r?.metadataDevice != null ? String(r.metadataDevice) : '',
          ...(databaseSizeMB != null ? { databaseSizeMB } : {}),
        };
      })
      .filter((r) => r.nodeName && r.deviceName);
  }
  return cfg;
}

function listConfiguredNodeDevices(
  config: CephHarvesterAddonValuesConfig | null | undefined,
): CephHarvesterAddonNodeDevice[] {
  const nodes = config?.cephCluster?.nodes || [];
  return nodes
    .map((r) => {
      const databaseSizeMB = databaseSizeMBFromDeviceRow(
        r as CephHarvesterAddonNodeDevice & { blockDbSize?: unknown },
      );
      return {
        nodeName: String(r?.nodeName || '').trim(),
        deviceName: String(r?.deviceName || '').trim(),
        metadataDevice: r?.metadataDevice ?? '',
        ...(databaseSizeMB != null ? { databaseSizeMB } : {}),
      };
    })
    .filter((r) => r.nodeName && r.deviceName);
}

function nodeDeviceKey(nodeName: string, deviceName: string): string {
  return `${nodeName}/${deviceName}`;
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
        databaseSizeMB: databaseSizeMBFromDeviceRow(
          row as CephHarvesterAddonNodeDevice & { blockDbSize?: unknown },
        ),
      });
    }
    const entry = byNode.get(row.nodeName)!;
    entry.devices.add(row.deviceName);
    if (String(row.metadataDevice ?? '').trim()) {
      entry.metadataDevice = String(row.metadataDevice);
    }
    const dbMb = databaseSizeMBFromDeviceRow(
      row as CephHarvesterAddonNodeDevice & { blockDbSize?: unknown },
    );
    if (dbMb != null) entry.databaseSizeMB = dbMb;
  }
  return byNode;
}

/**
 * 已运行统一存储：仅允许「只增不减」扩容。
 * 规则须与 frontend/.../ceph/lib/cephHarvesterAddon.ts 中同名函数保持同步。
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
      return `不可移除已有数据盘：${row.nodeName} / ${row.deviceName}。扩容请仅新增节点或数据盘。`;
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
    return '已运行集群提交时须新增至少一块数据盘，或在新节点上至少勾选一块新盘。';
  }

  return null;
}

export function resolveApplyConfigFromInput(
  input: CephHarvesterAddonApplyInput,
): CephHarvesterAddonValuesConfig {
  if (input.config && typeof input.config === 'object') {
    return input.config;
  }
  return legacyInputToConfig(input);
}

/** 生成 Addon spec.valuesContent */
export function buildRookCephAddonValuesContent(input: CephHarvesterAddonApplyInput): string {
  if (input.valuesContent && String(input.valuesContent).trim()) {
    return String(input.valuesContent).trim();
  }
  if (input.config && typeof input.config === 'object') {
    return buildRookCephAddonValuesFromConfig(input.config);
  }
  return buildRookCephAddonValuesFromConfig(legacyInputToConfig(input));
}

export function extractAddonValuesContent(raw: unknown): string | null {
  if (!raw || typeof raw !== 'object') return null;
  const spec = ((raw as Record<string, unknown>).spec || {}) as Record<string, unknown>;
  const vc = spec.valuesContent;
  return vc != null ? String(vc) : null;
}

export function enrichHarvesterRookCephAddonStatus(
  status: CephHarvesterAddonStatus,
): CephHarvesterAddonStatus {
  const valuesContent = extractAddonValuesContent(status.raw) ?? status.valuesContent ?? null;
  const config = valuesContent ? parseRookCephAddonValuesContent(valuesContent) : null;
  return {
    ...status,
    valuesContent,
    config,
  };
}

function addonGetUrls(origin: string): string[] {
  const encNs = encodeURIComponent(ROOK_CEPH_ADDON_NAMESPACE);
  const encName = encodeURIComponent(ROOK_CEPH_ADDON_NAME);
  return [
    `${origin}/apis/harvesterhci.io/v1beta1/namespaces/${encNs}/addons/${encName}`,
    `${origin}/v1/harvester/harvesterhci.io.addons/${encName}`,
    `${origin}/v1/harvester/harvesterhci.io.addons/${encNs}/${encName}`,
  ];
}

function addonCollectionUrl(origin: string): string {
  const encNs = encodeURIComponent(ROOK_CEPH_ADDON_NAMESPACE);
  return `${origin}/apis/harvesterhci.io/v1beta1/namespaces/${encNs}/addons`;
}

function steveListItems(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload;
  if (payload && typeof payload === 'object') {
    const o = payload as Record<string, unknown>;
    if (Array.isArray(o.data)) return o.data;
    if (Array.isArray(o.items)) return o.items;
  }
  return [];
}

export function parseHarvesterRookCephAddonStatus(raw: unknown): CephHarvesterAddonStatus {
  if (!raw || typeof raw !== 'object') {
    return {
      exists: false,
      enabled: false,
      deployStatus: '',
      phase: 'not_installed',
      message: '尚未安装 rook-ceph Addon',
      valuesContent: null,
      config: null,
    };
  }
  const o = raw as Record<string, unknown>;
  const spec = (o.spec || {}) as Record<string, unknown>;
  const status = (o.status || {}) as Record<string, unknown>;
  const enabled = spec.enabled === true;
  const deployStatus = status.status != null ? String(status.status) : '';
  const conditions = Array.isArray(status.conditions) ? status.conditions : [];
  const condByType = new Map<string, Record<string, unknown>>();
  for (const c of conditions) {
    if (c && typeof c === 'object') {
      const row = c as Record<string, unknown>;
      const t = row.type != null ? String(row.type) : '';
      if (t) condByType.set(t, row);
    }
  }
  const failed = condByType.get('OperationFailed');
  const inProgress = condByType.get('InProgress');
  const completed = condByType.get('Completed');
  const deployStatusLower = deployStatus.toLowerCase();
  const wasDeployed =
    deployStatus === 'AddonDeploySuccessful' || completed?.status === 'True';
  const addonDisabled =
    !enabled ||
    deployStatusLower.includes('disabled') ||
    deployStatus === 'AddonDisabled';

  let phase: CephHarvesterAddonStatus['phase'] = 'unknown';
  let message = deployStatus || 'Addon 已存在';

  if (failed?.status === 'True' || deployStatusLower.includes('fail')) {
    phase = 'failed';
    message = deployStatus || 'Addon 部署失败';
  } else if (inProgress?.status === 'True' || deployStatusLower.includes('progress')) {
    phase = 'progress';
    message = 'Addon 部署进行中，请稍候…';
  } else if (addonDisabled && (wasDeployed || deployStatus)) {
    phase = 'disabled';
    message =
      deployStatus === 'AddonDisabled' || !enabled
        ? '统一存储 Addon 已停用；若集群内 Ceph 已卸载，请在本页重新提交以开启，或在 Harvester 中删除 rook-ceph Addon 后全新部署。'
        : `统一存储 Addon 已停用（${deployStatus}）`;
  } else if (wasDeployed && enabled) {
    phase = 'success';
    message = '统一存储 Addon 已部署成功';
  } else if (!enabled) {
    phase = 'disabled';
    message = 'Addon 已创建但未启用';
  }

  const base: CephHarvesterAddonStatus = {
    exists: true,
    enabled,
    deployStatus,
    phase,
    message,
    raw,
  };
  return enrichHarvesterRookCephAddonStatus(base);
}

function buildAddonBody(valuesContent: string): Record<string, unknown> {
  return {
    apiVersion: 'harvesterhci.io/v1beta1',
    kind: 'Addon',
    metadata: {
      name: ROOK_CEPH_ADDON_NAME,
      namespace: ROOK_CEPH_ADDON_NAMESPACE,
    },
    spec: {
      chart: HMS_CEPH_CHART,
      enabled: true,
      repo: HMS_CEPH_REPO,
      version: HMS_CEPH_VERSION,
      valuesContent,
    },
  };
}

export async function fetchHarvesterRookCephAddon(cloud: {
  endpoint?: string | null;
  secretKey?: string | null;
  config?: { ignoreTls?: boolean; apiToken?: string; token?: string } | null;
}): Promise<CephHarvesterAddonStatus> {
  const token = resolveHarvesterCloudKubeToken(cloud);
  const insecure = !!(cloud.config as any)?.ignoreTls;
  const origin = normalizeOrigin(cloud.endpoint || '');

  for (const url of addonGetUrls(origin)) {
    try {
      const raw = await getJsonOnce(url, token, insecure, true);
      const item =
        raw && typeof raw === 'object' && (raw as { data?: unknown }).data != null
          ? (raw as { data: unknown }).data
          : raw;
      if (item && typeof item === 'object') {
        return parseHarvesterRookCephAddonStatus(item);
      }
    } catch (e: any) {
      if (e?.status === 404) continue;
      throw e;
    }
  }

  try {
    const listUrl = `${origin}/v1/harvester/harvesterhci.io.addons`;
    const listRaw = await getJsonOnce(listUrl, token, insecure, true);
    const items = steveListItems(listRaw);
    const hit = items.find((it: any) => {
      const name = it?.metadata?.name ?? it?.name;
      const ns = it?.metadata?.namespace ?? it?.namespace;
      return String(name) === ROOK_CEPH_ADDON_NAME && String(ns) === ROOK_CEPH_ADDON_NAMESPACE;
    });
    if (hit) return parseHarvesterRookCephAddonStatus(hit);
  } catch (e: any) {
    if (e?.status !== 404) throw e;
  }

  return parseHarvesterRookCephAddonStatus(null);
}

export async function applyHarvesterRookCephAddon(
  cloud: {
    endpoint?: string | null;
    secretKey?: string | null;
    config?: { ignoreTls?: boolean; apiToken?: string; token?: string } | null;
  },
  input: CephHarvesterAddonApplyInput,
): Promise<{ status: CephHarvesterAddonStatus; applied: 'created' | 'updated' }> {
  const token = resolveHarvesterCloudKubeToken(cloud);
  const insecure = !!(cloud.config as any)?.ignoreTls;
  const origin = normalizeOrigin(cloud.endpoint || '');

  const current = await fetchHarvesterRookCephAddon(cloud);
  const runningConfig =
    current.phase === 'success' && current.enabled && current.config ? current.config : null;

  if (runningConfig) {
    if (input.valuesContent && String(input.valuesContent).trim()) {
      const err = new Error('已运行集群不支持通过专家 YAML 覆盖配置');
      (err as any).status = 400;
      throw err;
    }
    const nextConfig = resolveApplyConfigFromInput(input);
    const changeError = validateRunningClusterConfigChange(runningConfig, nextConfig);
    if (changeError) {
      const err = new Error(changeError);
      (err as any).status = 400;
      throw err;
    }
  }

  await prepareCephStorageNetworkForAddonDeploy(cloud);

  const valuesContent = buildRookCephAddonValuesContent(input);
  const body = buildAddonBody(valuesContent);

  if (current.exists && current.raw && typeof current.raw === 'object') {
    const existing = current.raw as Record<string, unknown>;
    const merged = {
      ...existing,
      spec: {
        ...((existing.spec || {}) as Record<string, unknown>),
        chart: HMS_CEPH_CHART,
        enabled: true,
        repo: HMS_CEPH_REPO,
        version: HMS_CEPH_VERSION,
        valuesContent,
      },
    };
    for (const url of addonGetUrls(origin)) {
      try {
        await requestJson('PUT', url, token, insecure, merged);
        const status = await fetchHarvesterRookCephAddon(cloud);
        return { status, applied: 'updated' };
      } catch (e: any) {
        if (e?.status === 404) continue;
        throw e;
      }
    }
  }

  const createUrl = addonCollectionUrl(origin);
  await requestJson('POST', createUrl, token, insecure, body);
  const status = await fetchHarvesterRookCephAddon(cloud);
  return { status, applied: 'created' };
}
