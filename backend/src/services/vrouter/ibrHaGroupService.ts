import { In } from 'typeorm';
import { AppDataSource } from '../../config/database';
import { IbrHaGroup, type IbrHaGroupStatus } from '../../entities/vRouter/IbrHaGroup';
import { IbrHaGroupMember, type IbrHaGroupMemberRole } from '../../entities/vRouter/IbrHaGroupMember';
import { VRCacheBasic } from '../../entities/vRouter/VRCacheBasic';
import { resolveVrRolesWithFallback } from './ibrVrRoleResolve';

const HA_GROUP_ELIGIBLE_ROLES = new Set(['CE', '标准']);

export class IbrHaGroupError extends Error {
  statusCode: number;

  constructor(message: string, statusCode = 400) {
    super(message);
    this.name = 'IbrHaGroupError';
    this.statusCode = statusCode;
  }
}

export type IbrHaGroupMemberInput = {
  role: IbrHaGroupMemberRole;
  vrUuid: string;
  vrrpPriority?: number;
};

export type IbrHaGroupMemberView = {
  role: IbrHaGroupMemberRole;
  vrUuid: string;
  name: string | null;
  managementIp: string | null;
  vrrpPriority: number | null;
};

export type IbrHaGroupView = {
  id: string;
  name: string;
  description: string | null;
  mode: string;
  status: IbrHaGroupStatus;
  vrrpIntent: unknown | null;
  members: IbrHaGroupMemberView[];
  createdAt: string;
  updatedAt: string;
};

function groupRepo() {
  return AppDataSource.getRepository(IbrHaGroup);
}

function memberRepo() {
  return AppDataSource.getRepository(IbrHaGroupMember);
}

function vrCacheBasicRepo() {
  return AppDataSource.getRepository(VRCacheBasic);
}

function parseVrCacheBasicData(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function readVrNameFromCache(data: Record<string, unknown>, uuid: string): string | null {
  const name = data.name ?? data.vm_name;
  if (name == null || String(name).trim() === '') return uuid;
  return String(name);
}

function readVrManagementIpFromCache(data: Record<string, unknown>): string | null {
  const ip = data.management_ip ?? data.managementIp;
  if (ip == null || String(ip).trim() === '') return null;
  return String(ip);
}

function normalizeUuid(value: unknown): string {
  return String(value ?? '').trim();
}

function parseVrrpIntent(raw: unknown): unknown | null {
  if (raw == null) return null;
  if (typeof raw === 'object') return raw;
  if (typeof raw === 'string') {
    const t = raw.trim();
    if (!t) return null;
    try {
      return JSON.parse(t);
    } catch {
      throw new IbrHaGroupError('vrrpIntent 不是合法 JSON');
    }
  }
  throw new IbrHaGroupError('vrrpIntent 格式无效');
}

function serializeVrrpIntent(intent: unknown | null | undefined): string | null {
  if (intent == null) return null;
  return JSON.stringify(intent);
}

function parseStoredVrrpIntent(json: string | null | undefined): unknown | null {
  if (!json?.trim()) return null;
  try {
    return JSON.parse(json);
  } catch {
    return null;
  }
}

function isHaGroupEligibleVrRole(role: unknown): boolean {
  return HA_GROUP_ELIGIBLE_ROLES.has(String(role ?? '').trim());
}

/** 仅 CE / 标准模式可编 HA 组；角色以 VR2 实时配置为准 */
async function assertVrRolesEligibleForHaGroup(uuids: string[]): Promise<void> {
  const unique = [...new Set(uuids.filter(Boolean))];
  if (unique.length === 0) return;
  const roles = await resolveVrRolesWithFallback(unique);
  const invalid = unique
    .filter((uuid) => !isHaGroupEligibleVrRole(roles.get(uuid)))
    .map((uuid) => {
      const role = roles.get(uuid);
      return role ? `${uuid}（VR2/平台角色：${role}）` : `${uuid}（VR2 未返回 role）`;
    });
  if (invalid.length > 0) {
    throw new IbrHaGroupError(
      `以下 IBR 实例不可加入高可用组（仅支持 CE / 标准模式，角色须从 VR2 回读）：${invalid.join('；')}`,
      400,
    );
  }
}

async function assertVrUuidsExist(uuids: string[]): Promise<void> {
  const unique = [...new Set(uuids.filter(Boolean))];
  if (unique.length === 0) return;
  const rows = await vrCacheBasicRepo().find({
    where: { uuid: In(unique) },
    select: ['uuid'],
  });
  const found = new Set(rows.map((r) => r.uuid));
  const missing = unique.filter((u) => !found.has(u));
  if (missing.length > 0) {
    throw new IbrHaGroupError(
      `以下 IBR 实例 ID 不在实例目录中（请先在 IBR 列表执行刷新同步）：${missing.join(', ')}`,
      404,
    );
  }
}

async function assertMembersNotInOtherGroup(
  uuids: string[],
  excludeGroupId?: string,
): Promise<void> {
  const unique = [...new Set(uuids.filter(Boolean))];
  if (unique.length === 0) return;
  const existing = await memberRepo().find({ where: { vrUuid: In(unique) } });
  const conflict = existing.find((m) => m.groupId !== excludeGroupId);
  if (conflict) {
    throw new IbrHaGroupError(
      `IBR 实例 ${conflict.vrUuid} 已属于 HA 组 ${conflict.groupId}`,
      409,
    );
  }
}

function validateDualMembers(members: IbrHaGroupMemberInput[]): void {
  if (members.length !== 2) {
    throw new IbrHaGroupError('一期仅支持双机主备：成员必须为 2 台');
  }
  const primary = members.filter((m) => m.role === 'primary');
  const backup = members.filter((m) => m.role === 'backup');
  if (primary.length !== 1 || backup.length !== 1) {
    throw new IbrHaGroupError('须指定 1 台 primary 与 1 台 backup');
  }
  const a = normalizeUuid(primary[0]!.vrUuid);
  const b = normalizeUuid(backup[0]!.vrUuid);
  if (!a || !b) {
    throw new IbrHaGroupError('primaryUuid 与 backupUuid 均不能为空');
  }
  if (a === b) {
    throw new IbrHaGroupError('primary 与 backup 不能为同一 IBR 实例');
  }
}

function buildMemberInputs(primaryUuid: string, backupUuid: string): IbrHaGroupMemberInput[] {
  return [
    { role: 'primary', vrUuid: primaryUuid, vrrpPriority: 200 },
    { role: 'backup', vrUuid: backupUuid, vrrpPriority: 100 },
  ];
}

async function enrichMembers(members: IbrHaGroupMember[]): Promise<IbrHaGroupMemberView[]> {
  const uuids = members.map((m) => m.vrUuid);
  const rows =
    uuids.length > 0
      ? await vrCacheBasicRepo().find({
          where: { uuid: In(uuids) },
          select: ['uuid', 'data'],
        })
      : [];
  const map = new Map(
    rows.map((r) => {
      const data = parseVrCacheBasicData(r.data);
      return [
        r.uuid,
        {
          name: readVrNameFromCache(data, r.uuid),
          managementIp: readVrManagementIpFromCache(data),
        },
      ] as const;
    }),
  );
  return [...members]
    .sort((a, b) => a.sortOrder - b.sortOrder || a.role.localeCompare(b.role))
    .map((m) => ({
      role: m.role,
      vrUuid: m.vrUuid,
      name: map.get(m.vrUuid)?.name ?? null,
      managementIp: map.get(m.vrUuid)?.managementIp ?? null,
      vrrpPriority: m.vrrpPriority ?? null,
    }));
}

async function toView(group: IbrHaGroup): Promise<IbrHaGroupView> {
  const members = group.members?.length
    ? group.members
    : await memberRepo().find({ where: { groupId: group.id } });
  return {
    id: group.id,
    name: group.name,
    description: group.description ?? null,
    mode: group.mode,
    status: group.status,
    vrrpIntent: parseStoredVrrpIntent(group.vrrpIntentJson),
    members: await enrichMembers(members),
    createdAt: group.createdAt.toISOString(),
    updatedAt: group.updatedAt.toISOString(),
  };
}

export const ibrHaGroupService = {
  async list(): Promise<IbrHaGroupView[]> {
    const groups = await groupRepo().find({ order: { updatedAt: 'DESC' } });
    return Promise.all(groups.map((g) => toView(g)));
  },

  async getById(id: string): Promise<IbrHaGroupView> {
    const group = await groupRepo().findOne({ where: { id }, relations: ['members'] });
    if (!group) throw new IbrHaGroupError('HA 组不存在', 404);
    return toView(group);
  },

  async create(input: {
    name: string;
    description?: string;
    primaryUuid: string;
    backupUuid: string;
    vrrpIntent?: unknown;
  }): Promise<IbrHaGroupView> {
    const name = String(input.name ?? '').trim();
    if (!name) throw new IbrHaGroupError('组名称不能为空');

    const primaryUuid = normalizeUuid(input.primaryUuid);
    const backupUuid = normalizeUuid(input.backupUuid);
    const members = buildMemberInputs(primaryUuid, backupUuid);
    validateDualMembers(members);
    await assertVrUuidsExist([primaryUuid, backupUuid]);
    await assertVrRolesEligibleForHaGroup([primaryUuid, backupUuid]);
    await assertMembersNotInOtherGroup([primaryUuid, backupUuid]);

    const vrrpIntent = parseVrrpIntent(input.vrrpIntent);

    return AppDataSource.transaction(async (manager) => {
      const gRepo = manager.getRepository(IbrHaGroup);
      const mRepo = manager.getRepository(IbrHaGroupMember);

      const group = gRepo.create({
        name,
        description: String(input.description ?? '').trim() || null,
        mode: 'active-standby',
        status: 'draft',
        vrrpIntentJson: serializeVrrpIntent(vrrpIntent),
      });
      await gRepo.save(group);

      await mRepo.save(
        members.map((m, index) =>
          mRepo.create({
            groupId: group.id,
            vrUuid: m.vrUuid,
            role: m.role,
            vrrpPriority: m.vrrpPriority ?? null,
            sortOrder: index,
          }),
        ),
      );

      const saved = await gRepo.findOne({ where: { id: group.id }, relations: ['members'] });
      if (!saved) throw new IbrHaGroupError('创建失败', 500);
      return toView(saved);
    });
  },

  async update(
    id: string,
    input: { name?: string; description?: string | null; vrrpIntent?: unknown },
  ): Promise<IbrHaGroupView> {
    const group = await groupRepo().findOne({ where: { id }, relations: ['members'] });
    if (!group) throw new IbrHaGroupError('HA 组不存在', 404);

    if (input.name !== undefined) {
      const name = String(input.name).trim();
      if (!name) throw new IbrHaGroupError('组名称不能为空');
      group.name = name;
    }
    if (input.description !== undefined) {
      const desc = input.description == null ? '' : String(input.description).trim();
      group.description = desc || null;
    }
    if (input.vrrpIntent !== undefined) {
      group.vrrpIntentJson = serializeVrrpIntent(parseVrrpIntent(input.vrrpIntent));
    }

    await groupRepo().save(group);
    return toView(group);
  },

  async replaceMembers(
    id: string,
    input: { primaryUuid: string; backupUuid: string },
  ): Promise<IbrHaGroupView> {
    const group = await groupRepo().findOne({ where: { id } });
    if (!group) throw new IbrHaGroupError('HA 组不存在', 404);

    const primaryUuid = normalizeUuid(input.primaryUuid);
    const backupUuid = normalizeUuid(input.backupUuid);
    const members = buildMemberInputs(primaryUuid, backupUuid);
    validateDualMembers(members);
    await assertVrUuidsExist([primaryUuid, backupUuid]);
    await assertVrRolesEligibleForHaGroup([primaryUuid, backupUuid]);
    await assertMembersNotInOtherGroup([primaryUuid, backupUuid], id);

    return AppDataSource.transaction(async (manager) => {
      const mRepo = manager.getRepository(IbrHaGroupMember);
      await mRepo.delete({ groupId: id });
      await mRepo.save(
        members.map((m, index) =>
          mRepo.create({
            groupId: id,
            vrUuid: m.vrUuid,
            role: m.role,
            vrrpPriority: m.vrrpPriority ?? null,
            sortOrder: index,
          }),
        ),
      );
      const refreshed = await groupRepo().findOne({ where: { id }, relations: ['members'] });
      if (!refreshed) throw new IbrHaGroupError('HA 组不存在', 404);
      return toView(refreshed);
    });
  },

  async remove(id: string): Promise<void> {
    const group = await groupRepo().findOne({ where: { id } });
    if (!group) throw new IbrHaGroupError('HA 组不存在', 404);
    await groupRepo().remove(group);
  },
};
