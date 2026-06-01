/**
 * Addon 向导表单：节点行归并、默认值与 status → Form 映射。
 */

import { normalizeDeviceNames } from './harvesterAddonFormUtils';
import {
  CEPH_HARVESTER_DEFAULT_CEPH_IMAGE,
  CEPH_HARVESTER_DEFAULT_ROOK_OPERATOR_IMAGE,
  type CephHarvesterAddonFormValues,
  type CephHarvesterAddonFormValuesWithOverride,
  type CephHarvesterAddonNodeDevice,
  type CephHarvesterAddonNodeFormRow,
  type CephHarvesterAddonStatus,
  type CephHarvesterAddonValuesConfig,
} from './cephHarvesterAddonTypes';

export function defaultNodeDeviceFormRows(): CephHarvesterAddonNodeFormRow[] {
  return [{ nodeName: '', deviceNames: [], metadataDevice: '' }];
}

export function buildAllNodesEmptyDeviceRows(
  nodeOptions: { label: string; value: string }[],
): CephHarvesterAddonNodeFormRow[] {
  const names = nodeOptions.map((o) => String(o.value || '').trim()).filter(Boolean);
  if (names.length === 0) return defaultNodeDeviceFormRows();
  return names.map((nodeName) => ({
    nodeName,
    deviceNames: [],
    metadataDevice: '',
  }));
}

export function isDefaultEmptyWizardNodeRows(
  nodes: CephHarvesterAddonNodeFormRow[] | undefined,
): boolean {
  if (!Array.isArray(nodes) || nodes.length === 0) return true;
  if (nodes.length > 1) return false;
  const row = nodes[0];
  const hasNode = !!String(row?.nodeName ?? '').trim();
  const hasDisk = normalizeDeviceNames(row?.deviceNames).length > 0;
  return !hasNode && !hasDisk;
}

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

export function buildHarvesterAddonFormValuesFromStatus(
  res: Pick<CephHarvesterAddonStatus, 'config' | 'valuesContent'> & {
    phase?: CephHarvesterAddonStatus['phase'];
  },
): CephHarvesterAddonFormValuesWithOverride {
  if (res.phase === 'disabled') {
    return buildDefaultHarvesterAddonFormValues();
  }
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
