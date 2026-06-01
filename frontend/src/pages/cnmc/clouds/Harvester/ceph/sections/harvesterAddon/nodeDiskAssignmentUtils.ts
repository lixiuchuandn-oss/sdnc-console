import type { FormListOperation } from 'antd/es/form';
import type { CephHarvesterAddonNodeFormRow } from '../../lib/cephHarvesterAddon';

export function addHarvesterAddonNodeRow(
  add: FormListOperation['add'],
  nodeOptions: { label: string; value: string }[],
  watchedNodes: CephHarvesterAddonNodeFormRow[] | undefined,
): void {
  const usedNodes = new Set(
    (watchedNodes || []).map((r) => r?.nodeName).filter(Boolean) as string[],
  );
  const presetNode =
    nodeOptions.length === 1 && !usedNodes.has(nodeOptions[0].value) ? nodeOptions[0].value : '';
  add({
    nodeName: presetNode,
    deviceNames: [],
    metadataDevice: '',
  });
}
