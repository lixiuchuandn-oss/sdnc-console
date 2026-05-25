/** 集群网络拓扑：节点筛选与上行网口解析（无 React Flow 依赖，可单测） */

export function clusterNetworkTopologyLabel(metaName: string): string {
  const n = String(metaName || '').trim();
  return n || '集群网络';
}

function clusterNodeNames(nodes: any[]): string[] {
  return nodes
    .map((n) => String(n?.metadata?.name || '').trim())
    .filter(Boolean)
    .sort();
}

function nodeNamesForVlanConfig(vc: any, allNodes: any[]): string[] {
  const sel = vc?.spec?.nodeSelector;
  if (!sel || typeof sel !== 'object' || Array.isArray(sel)) {
    return clusterNodeNames(allNodes);
  }
  const keys = Object.keys(sel as object);
  if (keys.length === 0) {
    return clusterNodeNames(allNodes);
  }
  const out: string[] = [];
  for (const n of allNodes) {
    const labels = (n?.metadata?.labels || {}) as Record<string, string>;
    const ok = keys.every((k) => String(labels[k] ?? '') === String((sel as Record<string, string>)[k]));
    if (ok) out.push(String(n.metadata.name));
  }
  return out.sort();
}

export function nodeNamesForClusterNetwork(cn: any, allNodes: any[]): string[] {
  const configs = Array.isArray(cn?.vlanConfigs) ? cn.vlanConfigs : [];
  if (configs.length === 0) {
    return clusterNodeNames(allNodes);
  }
  const set = new Set<string>();
  for (const vc of configs) {
    for (const nm of nodeNamesForVlanConfig(vc, allNodes)) {
      set.add(nm);
    }
  }
  return Array.from(set).sort();
}

export function uplinkNicsListForClusterNetworkOnNode(
  cn: any,
  nodeName: string,
  allNodes: any[],
): string[] {
  const set = new Set<string>();
  const configs = Array.isArray(cn?.vlanConfigs) ? cn.vlanConfigs : [];
  if (configs.length > 0) {
    for (const vc of configs) {
      if (!nodeNamesForVlanConfig(vc, allNodes).includes(nodeName)) continue;
      for (const raw of vc?.spec?.uplink?.nics || []) {
        const t = String(raw || '').trim();
        if (t) set.add(t);
      }
    }
  } else {
    const upl = cn?.uplinks || cn?.rawData?.uplinks;
    for (const raw of Array.isArray(upl?.nics) ? upl.nics : []) {
      const t = String(raw || '').trim();
      if (t) set.add(t);
    }
  }
  return Array.from(set).sort();
}
