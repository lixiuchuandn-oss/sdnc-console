import { calculateTopology } from './graph';
import type { Cen, AppItem, SecurityDomainOption, SecurityServiceItem } from '../types';

export function buildTopologyData(params: {
  cen: Cen;
  attachedForTopo: any[];
  domainOfAttachment: (att: any) => SecurityDomainOption | undefined;
  filteredApps: AppItem[];
  filteredServices: SecurityServiceItem[];
  domainServiceChainMap: Record<string, boolean>;
  ecsIpMap: Record<string, string>;
}): {
  nodes: any[];
  edges: any[];
  topo: string;
  hubId?: string;
  doms: any[];
  vrCount: number;
  record: Cen;
} | null {
  const { cen, attachedForTopo, domainOfAttachment, filteredApps, filteredServices, domainServiceChainMap, ecsIpMap } = params;
  if (!cen) return null;
  const record = cen;
  const topo = record.topology || 'Mesh';
  const hubId = record.hubId;
  const domsRaw = attachedForTopo.map((att: any) => ({ att, dom: domainOfAttachment(att) })).filter((x: any) => !!x.dom);

  const doms = (() => {
    const d = domsRaw.slice();
    if (topo === 'Hub-Spoke') {
      const idx = hubId ? d.findIndex((it: any) => String(it.dom!.id) === String(hubId)) : 0;
      if (idx > -1 && idx < d.length) {
        const [hub] = d.splice(idx, 1);
        d.unshift(hub);
      }
    }
    return d;
  })();

  const vrCount = (() => {
    const keys = new Set<string>();
    doms.forEach((it: any) => {
      const key = it?.dom?.vrUuid || `vr-${it?.dom?.id}`;
      if (key) keys.add(String(key));
    });
    return keys.size;
  })();

  const { nodes, edges } = calculateTopology({
    doms,
    apps: filteredApps,
    services: filteredServices,
    domainServiceChainMap,
    ecsIpMap,
    topologyType: topo,
    hubId,
  });

  return { nodes, edges, topo, hubId, doms, vrCount, record };
}
