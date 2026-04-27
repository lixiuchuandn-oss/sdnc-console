import {
  fetchCloudProviderOvnDnatRules,
  fetchCloudProviderOvnSnatRules,
} from '../../../../../../services/harvesterApi';
import { TOWER_ALIAS_ANNOTATION } from './kubeOvnSubnetConstants';
import { isIpv4GatewayInCidr } from './flatSubnetExcludeIpValidation';

/**
 * 扁平子网删除前：若被 SNAT（spec.vpcSubnet）或 DNAT（内网 IP 落在子网 CIDR）引用则返回提示文案。
 */
export async function getFlatSubnetDeleteBlockedByNatMessage(
  cloudId: string,
  subnetName: string,
  subnetCidr: string,
): Promise<string | null> {
  const sn = String(subnetName ?? '').trim();
  const cidrRaw = String(subnetCidr ?? '').trim();
  const cidr = cidrRaw && cidrRaw !== '-' ? cidrRaw : '';
  if (!sn) return null;
  try {
    const [snatRes, dnatRes] = await Promise.all([
      fetchCloudProviderOvnSnatRules(cloudId, true, false, 'flat'),
      fetchCloudProviderOvnDnatRules(cloudId, true, false, 'flat'),
    ]);
    const snats: any[] = Array.isArray(snatRes?.data?.items) ? snatRes.data.items : [];
    const dnats: any[] = Array.isArray(dnatRes?.data?.items) ? dnatRes.data.items : [];
    const snHit = snats.find((r) => String(r?.spec?.vpcSubnet ?? '').trim() === sn);
    if (snHit) {
      const label =
        String(snHit?.metadata?.annotations?.[TOWER_ALIAS_ANNOTATION] ?? '').trim() ||
        String(snHit?.metadata?.name ?? '').trim() ||
        '—';
      return `该扁平子网已被 SNAT「${label}」使用，请先删除对应 SNAT 规则后再删除子网。`;
    }
    if (cidr) {
      for (const r of dnats) {
        const ip = String(r?.spec?.v4Ip ?? r?.spec?.internalIp ?? r?.status?.v4Ip ?? '').trim();
        if (!ip) continue;
        if (isIpv4GatewayInCidr(ip, cidr) === true) {
          const label =
            String(r?.metadata?.annotations?.[TOWER_ALIAS_ANNOTATION] ?? '').trim() ||
            String(r?.metadata?.name ?? '').trim() ||
            '—';
          return `该扁平子网已被 DNAT「${label}」使用（内网 IP ${ip}），请先删除对应 DNAT 规则后再删除子网。`;
        }
      }
    }
  } catch {
    return '无法校验 SNAT/DNAT 是否引用该子网，请检查网络后重试。';
  }
  return null;
}
