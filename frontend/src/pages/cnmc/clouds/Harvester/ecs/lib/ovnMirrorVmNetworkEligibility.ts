import { initNicEditorSlice } from './vmNicManageLogic';
import { vmKubernetesNamespace, vmNicIpDisplay } from './ovnMirrorSectionUtils';

export function isOvnMirrorEligibleNetMode(netMode: string | undefined): boolean {
  return netMode === 'vpc' || netMode === 'flat_subnet';
}

function vmNetworkIfaceEntries(vm: unknown): Array<{ iface: unknown; net: unknown }> {
  const r = vm as {
    spec?: {
      template?: {
        spec?: {
          networks?: Array<{ name?: string; multus?: { networkName?: string }; pod?: unknown }>;
          domain?: { devices?: { interfaces?: Array<{ name?: string }> } };
        };
      };
    };
  };
  const networks = r?.spec?.template?.spec?.networks || [];
  const ifaces = r?.spec?.template?.spec?.domain?.devices?.interfaces || [];
  return ifaces.map((iface) => ({
    iface,
    net: networks.find((n) => n?.name === iface?.name),
  }));
}

/** 流量镜像可选网卡：仅 flat_subnet / vpc（复用 initNicEditorSlice 判定 netMode） */
export function vmNicOptionsForOvnMirror(
  vm: unknown,
  kubeSubnets: unknown[],
): Array<{ value: string; label: string; ip: string }> {
  if (!vm) return [];
  const ns = vmKubernetesNamespace(vm);
  const subnets = Array.isArray(kubeSubnets) ? kubeSubnets : [];
  const out: Array<{ value: string; label: string; ip: string }> = [];

  for (const { iface, net } of vmNetworkIfaceEntries(vm)) {
    const slice = initNicEditorSlice(vm, iface, net, subnets);
    if (!isOvnMirrorEligibleNetMode(slice.netMode)) continue;

    const multusName = String(
      (net as { multus?: { networkName?: string } } | undefined)?.multus?.networkName || '',
    ).trim();
    const networkNad = multusName || 'Management Network';
    const value =
      networkNad === 'Management Network'
        ? 'Management Network'
        : networkNad.includes('/')
          ? networkNad
          : `${ns}/${networkNad}`;

    const ip = String(slice.ipAddress || '').trim();
    out.push({ value, label: vmNicIpDisplay(ip), ip });
  }
  return out;
}

export function vmHasOvnMirrorEligibleNic(vm: unknown, kubeSubnets: unknown[]): boolean {
  return vmNicOptionsForOvnMirror(vm, kubeSubnets).length > 0;
}
