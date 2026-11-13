import { In } from 'typeorm';
import { AppDataSource } from '../../config/database';
import { IbrHaGroup, type IbrHaGroupStatus } from '../../entities/vRouter/IbrHaGroup';
import { IbrHaGroupMember, type IbrHaGroupMemberRole } from '../../entities/vRouter/IbrHaGroupMember';
import { SRv6Tunnel } from '../../entities/vRouter/SRv6Tunnel';
import { VRCacheBasic } from '../../entities/vRouter/VRCacheBasic';
import { resolveVrRolesWithFallback } from './ibrVrRoleResolve';
import {
  memberPriorityFromIntent,
  normalizeHaGroupVrrpIntent,
  validateHaGroupVrrpIntent,
  type HaGroupVrrpIntent,
} from './haGroupVrrpIntent';
import {
  applyVrrpPatchToDeviceConfig,
  materializeHaGroupVrrpForMember,
  pickHaVrrpDeploySlice,
  stripHaGroupVrrpFromDeviceConfig,
  type HaMemberVrrpPatch,
} from './haGroupVrrpMaterialize';
import {
  getVRConfigFromDevice,
  pushVRConfig,
  VrConfigDeployError,
  type PushVRConfigResult,
} from './vrConfigDeploy';
import {
  assertHaMembersNotOppositeCesOnSameTunnel,
  collectHaMemberTunnelEndpointWarnings,
} from './haGroupTunnelGate';
import { detachSrv6TunnelsFromHaGroup } from './haGroupTunnelMetadata';

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

export type IbrHaGroupWriteResult = {
  group: IbrHaGroupView;
  /** 非阻断提示（如成员已是隧道标准端点） */
  warnings: string[];
};

async function assertHaMembersAgainstTunnels(primaryUuid: string, backupUuid: string): Promise<void> {
  try {
    await assertHaMembersNotOppositeCesOnSameTunnel(primaryUuid, backupUuid);
  } catch (e) {
    const statusCode =
      e && typeof e === 'object' && typeof (e as { statusCode?: unknown }).statusCode === 'number'
        ? (e as { statusCode: number }).statusCode
        : 409;
    throw new IbrHaGroupError(e instanceof Error ? e.message : String(e), statusCode);
  }
}

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

function parseVrrpIntent(
  raw: unknown,
  opts?: { primaryUuid?: string; backupUuid?: string },
): unknown | null {
  if (raw == null) return null;
  if (typeof raw === 'string') {
    const t = raw.trim();
    if (!t) return null;
    try {
      return validateHaGroupVrrpIntent(JSON.parse(t), opts);
    } catch (e) {
      throw new IbrHaGroupError(
        e instanceof Error ? e.message : 'vrrpIntent 不是合法 JSON',
      );
    }
  }
  if (typeof raw === 'object') {
    try {
      return validateHaGroupVrrpIntent(raw, opts);
    } catch (e) {
      throw new IbrHaGroupError(e instanceof Error ? e.message : 'vrrpIntent 格式无效');
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

async function requireDeployableGroup(id: string): Promise<{
  group: IbrHaGroup;
  intent: HaGroupVrrpIntent;
}> {
  const group = await groupRepo().findOne({ where: { id }, relations: ['members'] });
  if (!group) throw new IbrHaGroupError('HA 组不存在', 404);
  const primary = group.members?.find((m) => m.role === 'primary');
  const backup = group.members?.find((m) => m.role === 'backup');
  if (!primary || !backup) {
    throw new IbrHaGroupError('HA 组主备成员不完整，无法下发');
  }
  try {
    const intent = validateHaGroupVrrpIntent(parseStoredVrrpIntent(group.vrrpIntentJson), {
      primaryUuid: primary.vrUuid,
      backupUuid: backup.vrUuid,
    });
    return { group, intent };
  } catch (e) {
    throw new IbrHaGroupError(
      e instanceof Error ? e.message : 'vrrpIntent 无效，请先在向导中保存完整策略',
    );
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

function buildMemberInputs(
  primaryUuid: string,
  backupUuid: string,
  vrrpIntent?: unknown | null,
): IbrHaGroupMemberInput[] {
  const normalized = normalizeHaGroupVrrpIntent(vrrpIntent);
  const primaryPriority = memberPriorityFromIntent(normalized, 'primary') ?? 200;
  const backupPriority = memberPriorityFromIntent(normalized, 'backup') ?? 100;
  return [
    { role: 'primary', vrUuid: primaryUuid, vrrpPriority: primaryPriority },
    { role: 'backup', vrUuid: backupUuid, vrrpPriority: backupPriority },
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
  }): Promise<IbrHaGroupWriteResult> {
    const name = String(input.name ?? '').trim();
    if (!name) throw new IbrHaGroupError('组名称不能为空');

    const primaryUuid = normalizeUuid(input.primaryUuid);
    const backupUuid = normalizeUuid(input.backupUuid);
    const vrrpIntent = parseVrrpIntent(input.vrrpIntent, { primaryUuid, backupUuid });
    const members = buildMemberInputs(primaryUuid, backupUuid, vrrpIntent);
    validateDualMembers(members);
    await assertVrUuidsExist([primaryUuid, backupUuid]);
    await assertVrRolesEligibleForHaGroup([primaryUuid, backupUuid]);
    await assertMembersNotInOtherGroup([primaryUuid, backupUuid]);
    await assertHaMembersAgainstTunnels(primaryUuid, backupUuid);
    const warnings = await collectHaMemberTunnelEndpointWarnings(primaryUuid, backupUuid);

    const group = await AppDataSource.transaction(async (manager) => {
      const gRepo = manager.getRepository(IbrHaGroup);
      const mRepo = manager.getRepository(IbrHaGroupMember);

      const created = gRepo.create({
        name,
        description: String(input.description ?? '').trim() || null,
        mode: 'active-standby',
        status: 'draft',
        vrrpIntentJson: serializeVrrpIntent(vrrpIntent),
      });
      await gRepo.save(created);

      await mRepo.save(
        members.map((m, index) =>
          mRepo.create({
            groupId: created.id,
            vrUuid: m.vrUuid,
            role: m.role,
            vrrpPriority: m.vrrpPriority ?? null,
            sortOrder: index,
          }),
        ),
      );

      const saved = await gRepo.findOne({ where: { id: created.id }, relations: ['members'] });
      if (!saved) throw new IbrHaGroupError('创建失败', 500);
      return toView(saved);
    });
    return { group, warnings };
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
      const primary = group.members?.find((m) => m.role === 'primary');
      const backup = group.members?.find((m) => m.role === 'backup');
      const validated = parseVrrpIntent(input.vrrpIntent, {
        primaryUuid: primary?.vrUuid,
        backupUuid: backup?.vrUuid,
      });
      group.vrrpIntentJson = serializeVrrpIntent(validated);
      // 意图变更后须重新下发，避免界面仍显示「已配置」却未推新策略
      if (group.status === 'configured' || group.status === 'degraded') {
        group.status = 'draft';
      }
      if (validated && primary && backup) {
        const normalized = normalizeHaGroupVrrpIntent(validated);
        const pp = memberPriorityFromIntent(normalized, 'primary');
        const bp = memberPriorityFromIntent(normalized, 'backup');
        if (pp != null) primary.vrrpPriority = pp;
        if (bp != null) backup.vrrpPriority = bp;
        await memberRepo().save([primary, backup]);
      }
    }

    await groupRepo().save(group);
    return toView(group);
  },

  async replaceMembers(
    id: string,
    input: { primaryUuid: string; backupUuid: string },
  ): Promise<IbrHaGroupWriteResult> {
    const group = await groupRepo().findOne({ where: { id } });
    if (!group) throw new IbrHaGroupError('HA 组不存在', 404);

    const primaryUuid = normalizeUuid(input.primaryUuid);
    const backupUuid = normalizeUuid(input.backupUuid);
    const storedIntent = parseStoredVrrpIntent(group.vrrpIntentJson);
    const members = buildMemberInputs(primaryUuid, backupUuid, storedIntent);
    validateDualMembers(members);
    await assertVrUuidsExist([primaryUuid, backupUuid]);
    await assertVrRolesEligibleForHaGroup([primaryUuid, backupUuid]);
    await assertMembersNotInOtherGroup([primaryUuid, backupUuid], id);
    await assertHaMembersAgainstTunnels(primaryUuid, backupUuid);
    const warnings = await collectHaMemberTunnelEndpointWarnings(primaryUuid, backupUuid);

    const view = await AppDataSource.transaction(async (manager) => {
      const gRepo = manager.getRepository(IbrHaGroup);
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
      // 成员变更后须重新下发 VRRP
      if (group.status === 'configured' || group.status === 'degraded') {
        group.status = 'draft';
        await gRepo.save(group);
      }
      const refreshed = await gRepo.findOne({ where: { id }, relations: ['members'] });
      if (!refreshed) throw new IbrHaGroupError('HA 组不存在', 404);
      return toView(refreshed);
    });
    return { group: view, warnings };
  },

  async remove(id: string, options?: { revertDevice?: boolean }): Promise<{ detachedTunnelCount: number }> {
    const group = await groupRepo().findOne({ where: { id }, relations: ['members'] });
    if (!group) throw new IbrHaGroupError('HA 组不存在', 404);

    if (options?.revertDevice) {
      const primary = group.members?.find((m) => m.role === 'primary');
      const backup = group.members?.find((m) => m.role === 'backup');
      if (!primary || !backup) {
        throw new IbrHaGroupError('HA 组主备成员不完整，无法回退设备 VRRP');
      }
      let intent: HaGroupVrrpIntent;
      try {
        intent = validateHaGroupVrrpIntent(parseStoredVrrpIntent(group.vrrpIntentJson), {
          primaryUuid: primary.vrUuid,
          backupUuid: backup.vrUuid,
        });
      } catch (e) {
        throw new IbrHaGroupError(
          e instanceof Error ? e.message : 'vrrpIntent 无效，无法按意图回退设备，请先手工清理 VRRP 或补全向导',
        );
      }

      const stripRole = async (role: 'primary' | 'backup'): Promise<void> => {
        const patch = materializeHaGroupVrrpForMember(intent, role);
        try {
          const device = await getVRConfigFromDevice(patch.vrUuid);
          const stripped = stripHaGroupVrrpFromDeviceConfig(device, patch);
          await pushVRConfig({
            vrId: patch.vrUuid,
            domain: 'vrrp',
            preMergedConfig: stripped,
            skipDriftCheck: true,
          });
        } catch (e) {
          if (e instanceof VrConfigDeployError) {
            throw new IbrHaGroupError(
              `${role === 'primary' ? '主' : '备'}节点回退失败：${e.message}`,
              e.code === 'DEVICE_READ_FAILED' || e.code === 'DEVICE_EMPTY' ? 502 : 400,
            );
          }
          throw new IbrHaGroupError(
            `${role === 'primary' ? '主' : '备'}节点回退失败：${
              e instanceof Error ? e.message : String(e)
            }`,
            502,
          );
        }
      };

      const restoreRole = async (role: 'primary' | 'backup'): Promise<void> => {
        const patch = materializeHaGroupVrrpForMember(intent, role);
        const device = await getVRConfigFromDevice(patch.vrUuid);
        const restored = applyVrrpPatchToDeviceConfig(device, patch);
        await pushVRConfig({
          vrId: patch.vrUuid,
          domain: 'vrrp',
          preMergedConfig: restored,
          skipDriftCheck: true,
        });
      };

      await stripRole('primary');
      try {
        await stripRole('backup');
      } catch (backupErr) {
        try {
          await restoreRole('primary');
        } catch (restoreErr) {
          const backupMsg = backupErr instanceof Error ? backupErr.message : String(backupErr);
          const restoreMsg = restoreErr instanceof Error ? restoreErr.message : String(restoreErr);
          throw new IbrHaGroupError(
            `备节点回退失败且主节点补偿失败：${backupMsg}；补偿：${restoreMsg}`,
            502,
          );
        }
        throw backupErr;
      }
    }

    const detachedTunnelCount = await AppDataSource.transaction(async (manager) => {
      const txGroupRepo = manager.getRepository(IbrHaGroup);
      const txGroup = await txGroupRepo.findOne({ where: { id }, relations: ['members'] });
      if (!txGroup) throw new IbrHaGroupError('HA 组不存在', 404);

      const detached = await detachSrv6TunnelsFromHaGroup(manager.getRepository(SRv6Tunnel), id);
      await txGroupRepo.remove(txGroup);
      return detached;
    });
    return { detachedTunnelCount };
  },

  /**
   * 预览本组某节点将写入的 VRRP 片；mergeDevice 时读底稿合并。
   */
  async preview(
    id: string,
    role: 'primary' | 'backup',
    options?: { mergeDevice?: boolean },
  ): Promise<{
    role: 'primary' | 'backup';
    vrUuid: string;
    patch: { ifacePatches: HaMemberVrrpPatch['ifacePatches']; topVrrp: HaMemberVrrpPatch['topVrrp'] };
    slice: { interfaces: Array<{ name: string; vrrp?: unknown }>; vrrp: unknown };
    warning?: string;
  }> {
    const { intent } = await requireDeployableGroup(id);
    const patch = materializeHaGroupVrrpForMember(intent, role);
    const assembled = {
      interfaces: patch.ifacePatches.map((p) => ({
        name: p.interfaceName,
        vrrp: [p.ifaceVrrp],
      })),
      vrrp: patch.topVrrp,
    };
    const mergeDevice = options?.mergeDevice !== false;
    if (!mergeDevice) {
      return {
        role,
        vrUuid: patch.vrUuid,
        patch: { ifacePatches: patch.ifacePatches, topVrrp: patch.topVrrp },
        slice: assembled,
      };
    }
    try {
      const device = await getVRConfigFromDevice(patch.vrUuid);
      const merged = applyVrrpPatchToDeviceConfig(device, patch);
      return {
        role,
        vrUuid: patch.vrUuid,
        patch: { ifacePatches: patch.ifacePatches, topVrrp: patch.topVrrp },
        slice: pickHaVrrpDeploySlice(merged, patch),
      };
    } catch (e) {
      const warning =
        e instanceof Error ? `未能读取设备底稿：${e.message}` : '未能读取设备底稿';
      return {
        role,
        vrUuid: patch.vrUuid,
        patch: { ifacePatches: patch.ifacePatches, topVrrp: patch.topVrrp },
        slice: assembled,
        warning,
      };
    }
  },

  /**
   * 将 vrrpIntent 物化后经 pushVRConfig（preMerged）下发。
   * 不传 role 时主备连跑；传 role 时只推该节点（向导分步）。
   * 主成功、备失败时标记 degraded。
   */
  async deploy(
    id: string,
    options?: { role?: 'primary' | 'backup' },
  ): Promise<{
    group: IbrHaGroupView;
    primary?: PushVRConfigResult;
    backup?: PushVRConfigResult;
  }> {
    const { group, intent } = await requireDeployableGroup(id);
    const role = options?.role;

    const pushRole = async (target: 'primary' | 'backup'): Promise<PushVRConfigResult> => {
      const patch = materializeHaGroupVrrpForMember(intent, target);
      try {
        const device = await getVRConfigFromDevice(patch.vrUuid);
        const merged = applyVrrpPatchToDeviceConfig(device, patch);
        return await pushVRConfig({
          vrId: patch.vrUuid,
          domain: 'vrrp',
          preMergedConfig: merged,
          skipDriftCheck: true,
        });
      } catch (e) {
        if (e instanceof VrConfigDeployError) {
          throw new IbrHaGroupError(
            `${target === 'primary' ? '主' : '备'}节点下发失败：${e.message}`,
            e.code === 'DEVICE_READ_FAILED' || e.code === 'DEVICE_EMPTY' ? 502 : 400,
          );
        }
        throw new IbrHaGroupError(
          `${target === 'primary' ? '主' : '备'}节点下发失败：${
            e instanceof Error ? e.message : String(e)
          }`,
          502,
        );
      }
    };

    if (role) {
      try {
        const result = await pushRole(role);
        // 分步下发：仅当备节点成功才标 configured（向导顺序保证主已成功）
        if (role === 'backup') {
          group.status = 'configured';
          await groupRepo().save(group);
        }
        return {
          group: await toView(group),
          [role]: result,
        };
      } catch (e) {
        // 主或备任一步失败：若此前已配置/降级，统一标 degraded，避免假「已配置」
        if (group.status === 'configured' || group.status === 'degraded' || role === 'backup') {
          group.status = 'degraded';
          await groupRepo().save(group);
        }
        throw e;
      }
    }

    let primaryResult: PushVRConfigResult | undefined;
    try {
      primaryResult = await pushRole('primary');
      const backupResult = await pushRole('backup');
      group.status = 'configured';
      await groupRepo().save(group);
      return {
        group: await toView(group),
        primary: primaryResult,
        backup: backupResult,
      };
    } catch (e) {
      if (primaryResult) {
        group.status = 'degraded';
        await groupRepo().save(group);
      }
      throw e;
    }
  },
};
