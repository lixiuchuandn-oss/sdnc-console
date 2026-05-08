import type { VmReconfigureMenuInitCtx } from '../vmReconfigureMenuInitContext';

export function initChangeNodeSchedulingMenu(ctx: VmReconfigureMenuInitCtx): void {
  const { form, activeRecord, record, nodes, reloadNodes } = ctx;
  if (!nodes || nodes.length === 0) {
    reloadNodes();
  }

  const spec = activeRecord?.spec?.template?.spec || record?.spec?.template?.spec;
  const nodeSelector = spec?.nodeSelector || {};

  let currentNode = nodeSelector['kubernetes.io/hostname'] || null;
  if (!currentNode) {
    const currentRunningNode =
      activeRecord?.status?.nodeName ||
      record?.status?.nodeName ||
      activeRecord?.nodeName ||
      record?.nodeName ||
      null;
    if (currentRunningNode) {
      currentNode = currentRunningNode;
    }
  }

  const labelPairs: Array<{ key: string; value: string }> = [];
  Object.entries(nodeSelector).forEach(([key, value]) => {
    if (key !== 'kubernetes.io/hostname') {
      labelPairs.push({ key, value: String(value) });
    }
  });

  let mode: 'auto' | 'fixed' | 'label' = 'auto';
  if (currentNode) {
    mode = 'fixed';
  } else if (labelPairs.length > 0) {
    mode = 'label';
  }

  form.setFieldsValue({
    nodeSchedulingMode: mode,
    fixedNode: currentNode || undefined,
    nodeSelectorPairs: labelPairs.length > 0 ? labelPairs : undefined,
  });
}
