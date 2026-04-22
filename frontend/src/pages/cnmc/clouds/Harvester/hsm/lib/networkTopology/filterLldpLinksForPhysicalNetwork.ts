import type { HsmLldpPhysicalLink } from '../buildHsmLldpPhysicalLinks';
import type { PnNicTopologyShape } from '../../../kube-ovn/lib/providerNetworkNodeInterface';
import type { ProviderNetworkOriginNicsParse } from '../../../kube-ovn/lib/providerNetworkOriginNics';
import { resolveNodeInterface } from '../../../kube-ovn/lib/providerNetworkNodeInterface';

function norm(s: string): string {
  return String(s ?? '').trim();
}

/**
 * 只保留：LLDP 本端网口与「当前物理网络」相关的上联。
 * - 有 Bond（HCI 注解且列出成员）：本端名须为成员口之一，否则不画交换机上联。
 * - 否则：本端名须与 spec 上该节点的逻辑口（default/custom）一致。
 * 无 topology 时返回空，避免无关交换机在一张物理网络里误显示。
 */
export function filterLldpLinksForPhysicalNetwork(
  links: HsmLldpPhysicalLink[] | null | undefined,
  topology: PnNicTopologyShape | null,
  originNics: ProviderNetworkOriginNicsParse | null,
): HsmLldpPhysicalLink[] {
  if (!Array.isArray(links) || links.length === 0) return links ?? [];
  if (!topology) return [];

  return links.filter((link) => {
    const node = norm(link.nodeName);
    const localIf = norm(link.localIf);
    if (!node || !localIf) return false;

    if (originNics?.bondFromAnnotation) {
      const members = originNics.byNode[node] || [];
      if (members.length > 0) {
        const set = new Set(members.map((m) => norm(m)).filter(Boolean));
        return set.has(localIf);
      }
    }

    const { iface: logical } = resolveNodeInterface(node, topology);
    const log = norm(logical);
    if (!log || log === '—') return false;
    return localIf === log;
  });
}
