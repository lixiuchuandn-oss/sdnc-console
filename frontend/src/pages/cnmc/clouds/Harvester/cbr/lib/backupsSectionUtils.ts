import {
  harvesterBackupSourceVmName,
  isSystemNamespace,
} from '../../../../../../utils/harvesterUtils';
import { findHarvesterVmDisplayAlias } from './vmBackupDisplay';

export type BackupListType = 'backup' | 'snapshot';

export interface BackupListRow {
  key: string;
  name: string;
  itemType: string;
  namespace: string;
  targetVmAlias: string;
  readyToUse?: boolean;
  creationTimestamp?: string;
  alias: string;
  raw: unknown;
}

export type NormalizeBackupListParams = {
  backups: unknown[] | undefined;
  type: BackupListType;
  vms?: unknown[];
  vmId?: string;
  targetVmPredicate?: (namespace: string, vmName: string) => boolean;
};

export function normalizeBackupList(params: NormalizeBackupListParams): BackupListRow[] {
  const { backups, type, vms, vmId, targetVmPredicate } = params;
  return (backups || [])
    .filter((b: unknown) => {
      const item = b as Record<string, unknown> & { rawData?: Record<string, unknown>; namespace?: string };
      const raw = (item.rawData || item) as Record<string, unknown> & {
        spec?: { type?: string };
        metadata?: { namespace?: string };
      };
      const itemType = raw.spec?.type || 'backup';
      if (itemType !== type) return false;
      if (vmId) {
        const target = harvesterBackupSourceVmName(b);
        if (target !== vmId) return false;
      }
      if (targetVmPredicate) {
        const ns = raw.metadata?.namespace || item.namespace || '';
        const targetName = harvesterBackupSourceVmName(b);
        if (!targetName || !targetVmPredicate(String(ns), targetName)) return false;
      }
      return true;
    })
    .map((b: unknown) => {
      const item = b as Record<string, unknown> & {
        rawData?: Record<string, unknown>;
        id?: string;
        name?: string;
        namespace?: string;
        createdAt?: string;
      };
      const raw = (item.rawData || item) as Record<string, unknown> & {
        spec?: { type?: string };
        metadata?: {
          uid?: string;
          name?: string;
          namespace?: string;
          creationTimestamp?: string;
          annotations?: Record<string, string>;
        };
        status?: { readyToUse?: boolean };
      };
      const itemType = raw.spec?.type || 'backup';
      const ns = raw.metadata?.namespace || item.namespace || '';
      const targetName = harvesterBackupSourceVmName(b);
      const targetAlias = targetName
        ? findHarvesterVmDisplayAlias(vms as any[], String(ns), targetName)
        : '-';

      return {
        key: raw.metadata?.uid || item.id || `${ns}-${raw.metadata?.name || item.name}`,
        name: String(raw.metadata?.name || item.name || ''),
        itemType: String(itemType),
        namespace: String(ns),
        targetVmAlias: targetAlias,
        readyToUse: raw.status?.readyToUse,
        creationTimestamp: raw.metadata?.creationTimestamp || item.createdAt,
        alias: raw.metadata?.annotations?.['tower.io/alias'] || '-',
        raw,
      };
    });
}

export type BackupFilterParams = {
  keyword: string;
  statusFilter?: string;
  namespaceFilter?: string;
  isTenant?: boolean;
  isPublicNamespace: (ns: string) => boolean;
};

export function filterBackupsForTable(
  dataSource: BackupListRow[],
  params: BackupFilterParams,
): BackupListRow[] {
  let d = dataSource;
  if (params.isTenant) {
    d = d.filter((x) => {
      const ns = (x.namespace || '').toLowerCase();
      return !params.isPublicNamespace(ns) && !isSystemNamespace(ns);
    });
  }
  if (params.statusFilter === 'ready' || params.statusFilter === 'not_ready') {
    const isReady = params.statusFilter === 'ready';
    d = d.filter((x) => !!x.readyToUse === isReady);
  }
  if (params.namespaceFilter) {
    d = d.filter((x) => x.namespace === params.namespaceFilter);
  }
  if (params.keyword) {
    const k = params.keyword.toLowerCase();
    d = d.filter(
      (x) =>
        x.name.toLowerCase().includes(k) ||
        x.namespace.toLowerCase().includes(k) ||
        (x.alias && x.alias !== '-' && x.alias.toLowerCase().includes(k)),
    );
  }
  return d;
}

export function buildBackupNamespaceOptions(
  dataSource: BackupListRow[],
  params: Pick<BackupFilterParams, 'isTenant' | 'isPublicNamespace'>,
): Array<{ label: string; value: string }> {
  const set = new Set<string>();
  dataSource.forEach((x) => {
    const ns = String(x.namespace || '');
    if (!ns) return;
    if (isSystemNamespace(ns)) return;
    if (params.isTenant && params.isPublicNamespace(ns)) return;
    set.add(ns);
  });
  return Array.from(set)
    .sort()
    .map((ns) => ({ label: ns, value: ns }));
}

export function backupDisplayLabel(row: BackupListRow): string {
  return row.alias !== '-' ? row.alias : row.name;
}
