import { normalizeDeviceNames } from '../lib/harvesterAddonFormUtils';
import type { CephHarvesterAddonFormValues, CephHarvesterAddonNodeFormRow } from '../lib/cephHarvesterAddon';

export type HarvesterAddonFormValues = CephHarvesterAddonFormValues & {
  valuesContentOverride?: string;
};

export function summarizeNodeDevices(nodes: CephHarvesterAddonNodeFormRow[] | undefined): {
  diskCount: number;
  nodeCount: number;
  duplicateNodeNames: string[];
} {
  const rows = (nodes || []).filter(
    (r) => r?.nodeName && normalizeDeviceNames(r.deviceNames).length > 0,
  );
  const nodeNames = (nodes || []).map((r) => r?.nodeName).filter(Boolean) as string[];
  const duplicateNodeNames = [
    ...new Set(nodeNames.filter((name, index) => nodeNames.indexOf(name) !== index)),
  ];
  return {
    diskCount: rows.reduce((sum, r) => sum + normalizeDeviceNames(r.deviceNames).length, 0),
    nodeCount: rows.length,
    duplicateNodeNames,
  };
}
