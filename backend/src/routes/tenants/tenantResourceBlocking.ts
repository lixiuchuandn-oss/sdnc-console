import { AppDataSource } from '../../config/database';
import { In } from 'typeorm';
import { VRConfig } from '../../entities/vRouter/VRConfig';

export type TenantBlockingRow = { name: string; count: number };

export type TenantDeleteBlockingSnapshot = {
  rows: TenantBlockingRow[];
};

/** 删除组织（子树）前的资源占用汇总（SDNC：仅 VR 绑定） */
export async function collectOrganizationSubtreeBlockingRows(
  orgIds: string[],
): Promise<TenantBlockingRow[]> {
  if (!orgIds.length) return [];

  const vrConfigRepository = AppDataSource.getRepository(VRConfig);
  const vrConfigs = await vrConfigRepository.find({
    where: { organizationId: In(orgIds) },
  });
  if (vrConfigs.length > 0) {
    return [{ name: 'IBR', count: vrConfigs.length }];
  }
  return [];
}

/** 删除租户前的资源占用汇总（SDNC：仅 VR 绑定） */
export async function collectTenantDeleteBlockingSnapshot(
  _tenantId: string,
  orgIds: string[],
): Promise<TenantDeleteBlockingSnapshot> {
  const rows = await collectOrganizationSubtreeBlockingRows(orgIds);
  return { rows };
}
