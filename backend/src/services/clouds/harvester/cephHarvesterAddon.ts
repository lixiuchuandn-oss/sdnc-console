/**
 * Harvester `Addon`（rook-ceph / hms-ceph）：探测与开启统一存储。
 */
import yaml from 'js-yaml';
import { getJsonOnce, requestJson, resolveHarvesterCloudKubeToken } from './utils';
import { normalizeOrigin } from '../../../routes/clouds/harvester/handlers/monitoring-helpers';

export const ROOK_CEPH_ADDON_NAME = 'rook-ceph';
export const ROOK_CEPH_ADDON_NAMESPACE = 'rook-ceph';
const HMS_CEPH_CHART = 'hms-ceph';
const HMS_CEPH_REPO = 'http://harvester-cluster-repo.cattle-system.svc/charts';
const HMS_CEPH_VERSION = 'v1.19.3';
const CEPH_IMAGE = 'quay.io/ceph/ceph:v19.2.3';
const ROOK_OPERATOR_IMAGE = 'docker.io/rook/ceph:v1.19.3';

export type CephHarvesterAddonNodeDevice = {
  nodeName: string;
  deviceName: string;
};

export type CephHarvesterAddonApplyInput = {
  replicaSize?: number;
  nodes?: CephHarvesterAddonNodeDevice[];
  /** 高级：直接提交完整 Helm values YAML（非空时忽略 replicaSize/nodes） */
  valuesContent?: string;
};

export type CephHarvesterAddonStatus = {
  exists: boolean;
  enabled: boolean;
  deployStatus: string;
  phase: 'not_installed' | 'success' | 'progress' | 'failed' | 'unknown';
  message: string;
  raw?: unknown;
};

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

  let phase: CephHarvesterAddonStatus['phase'] = 'unknown';
  let message = deployStatus || 'Addon 已存在';

  if (failed?.status === 'True' || deployStatus.toLowerCase().includes('fail')) {
    phase = 'failed';
    message = deployStatus || 'Addon 部署失败';
  } else if (
    deployStatus === 'AddonDeploySuccessful' ||
    completed?.status === 'True'
  ) {
    phase = 'success';
    message = enabled ? '统一存储 Addon 已部署成功' : 'Addon 已部署但未启用';
  } else if (inProgress?.status === 'True' || deployStatus.toLowerCase().includes('progress')) {
    phase = 'progress';
    message = 'Addon 部署进行中，请稍候…';
  } else if (!enabled) {
    phase = 'unknown';
    message = 'Addon 已创建但未启用';
  }

  return {
    exists: true,
    enabled,
    deployStatus,
    phase,
    message,
    raw,
  };
}

/** 按节点聚合 OSD 磁盘配置，生成 hms-ceph Helm values（与 Harvester UI / ceph.yaml 对齐） */
export function buildRookCephAddonValuesContent(input: CephHarvesterAddonApplyInput): string {
  if (input.valuesContent && String(input.valuesContent).trim()) {
    return String(input.valuesContent).trim();
  }

  const replicaSize = Math.max(1, Math.min(7, Number(input.replicaSize) || 3));
  const nodesInput = Array.isArray(input.nodes) ? input.nodes : [];
  const byNode = new Map<string, Set<string>>();
  for (const row of nodesInput) {
    const nodeName = String(row?.nodeName || '').trim();
    const deviceName = String(row?.deviceName || '').trim();
    if (!nodeName || !deviceName) continue;
    if (!byNode.has(nodeName)) byNode.set(nodeName, new Set());
    byNode.get(nodeName)!.add(deviceName);
  }

  const storageNodes =
    byNode.size > 0
      ? Array.from(byNode.entries()).map(([name, devices]) => ({
          name,
          devices: Array.from(devices).map((deviceName) => ({ name: deviceName })),
          config: {
            metadataDevice: '',
            blockDbSize: '',
          },
        }))
      : [];

  const values = {
    fullnameOverride: ROOK_CEPH_ADDON_NAME,
    replicapool: {
      replicated: {
        size: replicaSize,
        requireSafeReplicaSize: false,
      },
      parameters: {
        compression_mode: 'none',
      },
    },
    storageclass: {
      job: {
        image: 'docker.io/rancher/shell:v0.5.0',
      },
      reclaimPolicy: 'Delete',
      allowVolumeExpansion: true,
      volumeBindingMode: 'Immediate',
    },
    cephtools: {
      replicas: Math.min(3, replicaSize),
      image: CEPH_IMAGE,
    },
    cephcluster: {
      cephVersion: {
        image: CEPH_IMAGE,
        allowUnsupported: false,
      },
      mon: {
        count: Math.min(3, replicaSize),
        allowMultiplePerNode: false,
      },
      mgr: {
        count: Math.min(3, replicaSize),
      },
      dashboard: {
        enabled: true,
      },
      storage: {
        useAllNodes: storageNodes.length === 0,
        useAllDevices: storageNodes.length === 0,
        ...(storageNodes.length > 0 ? { nodes: storageNodes } : {}),
      },
      config: {
        osdsPerDevice: '1',
        osd_objectstore: 'bluestore',
        metadataDevice: '',
      },
    },
    operator: {
      replicas: 1,
      image: ROOK_OPERATOR_IMAGE,
    },
  };

  return yaml.dump(values, { lineWidth: 120, noRefs: true }).trim();
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

  // Steve 列表回退
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
  const valuesContent = buildRookCephAddonValuesContent(input);
  const body = buildAddonBody(valuesContent);

  const current = await fetchHarvesterRookCephAddon(cloud);

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
