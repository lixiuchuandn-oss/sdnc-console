import type { CephHarvesterAddonFormValues, CephHarvesterAddonNodeFormRow } from '../lib/cephHarvesterAddon';

export type HarvesterAddonFormValues = CephHarvesterAddonFormValues & {
  valuesContentOverride?: string;
};

export function summarizeNodeDevices(nodes: CephHarvesterAddonNodeFormRow[] | undefined): {
  duplicateNodeNames: string[];
} {
  const nodeNames = (nodes || []).map((r) => r?.nodeName).filter(Boolean) as string[];
  const duplicateNodeNames = [
    ...new Set(nodeNames.filter((name, index) => nodeNames.indexOf(name) !== index)),
  ];
  return { duplicateNodeNames };
}
