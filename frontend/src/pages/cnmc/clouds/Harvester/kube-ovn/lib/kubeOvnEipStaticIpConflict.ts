import { ovnDisplayName } from './ovnResourceDisplay';

export function ovnEipV4Ip(eip: any): string {
  return String(eip?.spec?.v4Ip ?? eip?.status?.v4Ip ?? '').trim();
}

export function findOvnEipByV4Ip(eips: any[] | undefined, v4Ip: string): any | null {
  const target = String(v4Ip ?? '').trim();
  if (!target) return null;
  for (const ex of eips || []) {
    const ip = ovnEipV4Ip(ex);
    if (ip && ip === target) return ex;
  }
  return null;
}

export type OvnEipStaticIpConflict = {
  owner: any;
  networkLabel: string;
};

export function ovnEipNetworkScopeLabels(scope: 'flat' | 'vpc' | undefined): {
  local: string;
  peer: string;
} {
  if (scope === 'flat') return { local: '扁平网络', peer: 'VPC网络' };
  if (scope === 'vpc') return { local: 'VPC网络', peer: '扁平网络' };
  return { local: '当前网络', peer: '其它网络' };
}

/** 在当前域与对端域 EIP 列表中查找静态 v4Ip 冲突 */
export function findOvnEipStaticIpConflict(
  v4Ip: string,
  localEips: any[] | undefined,
  peerEips: any[] | undefined,
  localNetworkLabel: string,
  peerNetworkLabel: string,
): OvnEipStaticIpConflict | null {
  const localHit = findOvnEipByV4Ip(localEips, v4Ip);
  if (localHit) return { owner: localHit, networkLabel: localNetworkLabel };
  const peerHit = findOvnEipByV4Ip(peerEips, v4Ip);
  if (peerHit) return { owner: peerHit, networkLabel: peerNetworkLabel };
  return null;
}

export function formatOvnEipStaticIpConflictMessage(conflict: OvnEipStaticIpConflict): string {
  const disp = ovnDisplayName(conflict.owner);
  return `该公网 IP 已被${conflict.networkLabel}下的弹性公网 IP「${disp}」占用，请更换其它地址或留空由系统分配`;
}
