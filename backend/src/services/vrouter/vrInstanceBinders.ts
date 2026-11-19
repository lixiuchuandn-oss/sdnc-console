import { AppDataSource } from '../../config/database';
import { IbrHaGroup } from '../../entities/vRouter/IbrHaGroup';
import { IbrHaGroupMember } from '../../entities/vRouter/IbrHaGroupMember';
import { IPsecVPN } from '../../entities/vRouter/IPsecVPN';
import { findSrv6TunnelsReferencingVr } from '../../routes/sdn/srv6.references';

export type VrInstanceBinderType = 'srv6' | 'ha' | 'ipsec';

export type VrInstanceBinder = {
  type: VrInstanceBinderType;
  id: string;
  name: string;
  href: string;
  detail?: string;
};

const HREF = {
  srv6: '/admin/interconnect/srv6',
  ha: '/admin/interconnect/ha-groups',
  ipsec: '/admin/interconnect/ipsec',
} as const;

export async function listVrInstanceBinders(uuid: string): Promise<VrInstanceBinder[]> {
  const id = String(uuid || '').trim();
  if (!id) return [];
  const out: VrInstanceBinder[] = [];

  const srv6 = await findSrv6TunnelsReferencingVr(id);
  for (const ref of srv6) {
    out.push({
      type: 'srv6',
      id: ref.tunnelId,
      name: ref.tunnelName,
      href: HREF.srv6,
      detail: ref.slot,
    });
  }

  const members = await AppDataSource.getRepository(IbrHaGroupMember).find({ where: { vrUuid: id } });
  const groupRepo = AppDataSource.getRepository(IbrHaGroup);
  for (const member of members) {
    const group = await groupRepo.findOne({ where: { id: member.groupId } });
    out.push({
      type: 'ha',
      id: member.groupId,
      name: group?.name || member.groupId,
      href: HREF.ha,
      detail: member.role,
    });
  }

  const ipsecRows = await AppDataSource.getRepository(IPsecVPN).find({
    where: [{ localVrId: id }, { peerVrId: id }],
  });
  const seenIpsec = new Set<string>();
  for (const row of ipsecRows) {
    const local = String(row.localVrId || '').trim() === id;
    const peer = String(row.peerVrId || '').trim() === id;
    if (!local && !peer) continue;
    if (seenIpsec.has(row.id)) continue;
    seenIpsec.add(row.id);
    out.push({
      type: 'ipsec',
      id: row.id,
      name: row.name,
      href: `${HREF.ipsec}/${encodeURIComponent(row.id)}/edit`,
      detail: local ? 'local' : 'peer',
    });
  }

  return out;
}
