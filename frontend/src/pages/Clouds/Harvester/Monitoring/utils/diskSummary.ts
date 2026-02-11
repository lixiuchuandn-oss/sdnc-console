/**
 * 磁盘卡片：按主机维度统计 健康/告警/其他
 * 与参考项目 Compute.Tower-Monitoring 一致。
 */
export interface DiskSummary {
  healthy: number;
  warning: number;
  other: number;
  total: number;
}

function getList(res: any): any[] {
  if (Array.isArray(res)) return res;
  if (res && Array.isArray(res.data)) return res.data;
  return [];
}

function getNodeId(node: any): string {
  return node?.metadata?.name ?? node?.id ?? '';
}

function hostErrorCount(longhornNode: any, blockDevicesForNode: any[]): number {
  let errorCount = 0;
  const diskStatus = longhornNode?.status?.diskStatus;
  if (typeof diskStatus === 'object' && diskStatus !== null) {
    for (const key of Object.keys(diskStatus)) {
      const d = diskStatus[key];
      const conditions = d?.conditions || [];
      const ready = conditions.find((c: any) => c.type === 'Ready');
      const schedulable = conditions.find((c: any) => c.type === 'Schedulable');
      if (ready?.status !== 'True' || schedulable?.status !== 'True') errorCount++;
    }
  }
  const unProvisioned = blockDevicesForNode.filter(
    (bd: any) =>
      (bd?.spec?.provision || bd?.spec?.fileSystem?.provisioned) &&
      bd?.status?.provisionPhase !== 'Provisioned'
  );
  for (const bd of unProvisioned) {
    if (bd?.metadata?.state?.error === true) errorCount++;
  }
  return errorCount;
}

export function aggregateDiskSummaryByHost(
  nodesResponse: any,
  longhornNodesResponse: any,
  blockDevicesResponse: any
): DiskSummary {
  const nodes = getList(nodesResponse);
  const longhornList = getList(longhornNodesResponse);
  const blockList = getList(blockDevicesResponse);

  const longhornByNodeName: Record<string, any> = {};
  for (const ln of longhornList) {
    const name = ln?.metadata?.name ?? (typeof ln?.id === 'string' ? ln.id.replace(/^[^/]+\//, '') : '') ?? '';
    if (name) longhornByNodeName[name] = ln;
  }

  const blockByNodeName: Record<string, any[]> = {};
  for (const bd of blockList) {
    const nodeName = bd?.spec?.nodeName ?? '';
    if (nodeName) {
      if (!blockByNodeName[nodeName]) blockByNodeName[nodeName] = [];
      blockByNodeName[nodeName].push(bd);
    }
  }

  let healthy = 0;
  let warning = 0;
  let other = 0;

  for (const node of nodes) {
    const nodeId = getNodeId(node);
    if (!nodeId) {
      other++;
      continue;
    }
    const longhornNode = longhornByNodeName[nodeId];
    if (!longhornNode) {
      other++;
      continue;
    }
    const blockForNode = blockByNodeName[nodeId] ?? [];
    const err = hostErrorCount(longhornNode, blockForNode);
    if (err > 0) warning++;
    else healthy++;
  }

  return {
    healthy,
    warning,
    other,
    total: nodes.length,
  };
}
