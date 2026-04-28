import {
  fetchCloudProviderOvnDnatRules,
  fetchCloudProviderOvnSnatRules,
} from '../../../../../../services/harvesterApi';
import { TOWER_ALIAS_ANNOTATION } from './kubeOvnSubnetConstants';
import { isIpv4AddressInCidr } from './flatSubnetExcludeIpValidation';

type OvnNatScope = 'flat' | 'vpc';

function subnetKindLabel(scope: OvnNatScope): string {
  return scope === 'vpc' ? 'VPC 子网' : '扁平子网';
}

/**
 * Kube-OVN 子网删除前：若被 SNAT（spec.vpcSubnet）或 DNAT（内网 IP 落在子网 CIDR）引用则返回提示文案。
 */
async function getKubeOvnSubnetDeleteBlockedByNatMessage(
  cloudId: string,
  subnetName: string,
  subnetCidr: string,
  scope: OvnNatScope,
): Promise<string | null> {
  const sn = String(subnetName ?? '').trim();
  const cidrRaw = String(subnetCidr ?? '').trim();
  const cidr = cidrRaw && cidrRaw !== '-' ? cidrRaw : '';
  if (!sn) return null;
  const kind = subnetKindLabel(scope);
  try {
    const [snatRes, dnatRes] = await Promise.all([
      fetchCloudProviderOvnSnatRules(cloudId, true, false, scope),
      fetchCloudProviderOvnDnatRules(cloudId, true, false, scope),
    ]);
    const snats: any[] = Array.isArray(snatRes?.data?.items) ? snatRes.data.items : [];
    const dnats: any[] = Array.isArray(dnatRes?.data?.items) ? dnatRes.data.items : [];
    const snHit = snats.find((r) => String(r?.spec?.vpcSubnet ?? '').trim() === sn);
    if (snHit) {
      const label =
        String(snHit?.metadata?.annotations?.[TOWER_ALIAS_ANNOTATION] ?? '').trim() ||
        String(snHit?.metadata?.name ?? '').trim() ||
        '—';
      return `该${kind}已被 SNAT「${label}」使用，请先删除对应 SNAT 规则后再删除子网。`;
    }
    if (cidr) {
      for (const r of dnats) {
        const ip = String(r?.spec?.v4Ip ?? r?.spec?.internalIp ?? r?.status?.v4Ip ?? '').trim();
        if (!ip) continue;
        if (isIpv4AddressInCidr(ip, cidr)) {
          const label =
            String(r?.metadata?.annotations?.[TOWER_ALIAS_ANNOTATION] ?? '').trim() ||
            String(r?.metadata?.name ?? '').trim() ||
            '—';
          return `该${kind}已被 DNAT「${label}」使用（内网 IP ${ip}），请先删除对应 DNAT 规则后再删除子网。`;
        }
      }
    }
  } catch {
    return `无法校验 SNAT/DNAT 是否引用该${kind}，请检查网络后重试。`;
  }
  return null;
}

/** 扁平子网删除前：若被 SNAT / DNAT 引用则不能删（与 vpc 共用逻辑，scope=flat） */
export async function getFlatSubnetDeleteBlockedByNatMessage(
  cloudId: string,
  subnetName: string,
  subnetCidr: string,
): Promise<string | null> {
  return getKubeOvnSubnetDeleteBlockedByNatMessage(cloudId, subnetName, subnetCidr, 'flat');
}

/** VPC 子网删除前：若被 SNAT / DNAT 引用则不能删（与扁平子网一致，scope=vpc） */
export async function getVpcSubnetDeleteBlockedByNatMessage(
  cloudId: string,
  subnetName: string,
  subnetCidr: string,
): Promise<string | null> {
  return getKubeOvnSubnetDeleteBlockedByNatMessage(cloudId, subnetName, subnetCidr, 'vpc');
}
