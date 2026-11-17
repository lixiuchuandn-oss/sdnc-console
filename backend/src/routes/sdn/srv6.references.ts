import { AppDataSource } from '../../config/database';
import { SRv6Tunnel } from '../../entities/vRouter/SRv6Tunnel';
import type { Srv6EndpointSlot } from './srv6.archive.types';

const srv6Repo = () => AppDataSource.getRepository(SRv6Tunnel);

export type Srv6VrReference = {
  tunnelId: string;
  tunnelName: string;
  slot: Srv6EndpointSlot;
};

/** 查询引用某 VR uuid 的 SRv6 隧道（含端点角色槽位） */
export const findSrv6TunnelsReferencingVr = async (vrUuid: string): Promise<Srv6VrReference[]> => {
  const id = String(vrUuid || '').trim();
  if (!id) return [];
  const list = await srv6Repo().find();
  const out: Srv6VrReference[] = [];
  for (const t of list) {
    if (t.peA === id) out.push({ tunnelId: t.id, tunnelName: t.name, slot: 'peA' });
    if (t.peB === id) out.push({ tunnelId: t.id, tunnelName: t.name, slot: 'peB' });
    if (t.ceA === id) out.push({ tunnelId: t.id, tunnelName: t.name, slot: 'ceA' });
    if (t.ceB === id) out.push({ tunnelId: t.id, tunnelName: t.name, slot: 'ceB' });
  }
  return out;
};

export type Srv6HaGroupReference = {
  tunnelId: string;
  tunnelName: string;
  slot: 'ceA' | 'ceB';
};

/** 查询 fingerprint 绑定某 HA 组的存活 SRv6 隧道（CE-A / CE-B） */
export const findSrv6TunnelsReferencingHaGroup = async (
  haGroupId: string,
): Promise<Srv6HaGroupReference[]> => {
  const id = String(haGroupId || '').trim();
  if (!id) return [];
  const list = await srv6Repo().find();
  const out: Srv6HaGroupReference[] = [];
  for (const t of list) {
    const fp = t.endpointFingerprint;
    if (!fp || typeof fp !== 'object') continue;
    if (String(fp.ceA?.haGroupId || '').trim() === id) {
      out.push({ tunnelId: t.id, tunnelName: t.name, slot: 'ceA' });
    }
    if (String(fp.ceB?.haGroupId || '').trim() === id) {
      out.push({ tunnelId: t.id, tunnelName: t.name, slot: 'ceB' });
    }
  }
  return out;
};
