import { AppDataSource } from '../../../config/database';
import { CloudDesktopUser } from '../../../entities/CloudDesktopUser';
import { GuacamoleInstance } from '../../../entities/GuacamoleInstance';
import {
  normalizeDesktopGuacamoleUsername,
  resolveUnifiedDesktopPassword,
} from './guacamoleDesktopConfig';
import { upsertGuacamoleRemoteUser } from './guacamoleUser';

export function sanitizeCloudDesktopUser(row: CloudDesktopUser) {
  return {
    id: row.id,
    username: row.username,
    fullName: row.fullName,
    email: row.email,
    status: row.status,
    guacamoleUsername: row.guacamoleUsername,
    instanceId: row.instanceId,
    syncStatus: row.syncStatus,
    lastSyncAt: row.lastSyncAt,
    lastSyncMessage: row.lastSyncMessage,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function resolveDefaultGuacamoleInstance(): Promise<GuacamoleInstance | null> {
  const repo = AppDataSource.getRepository(GuacamoleInstance);
  const def = await repo.findOne({ where: { isDefault: true } });
  if (def) return def;
  const all = await repo.find({ order: { createdAt: 'ASC' }, take: 1 });
  return all[0] || null;
}

export async function syncCloudDesktopUserToGuacamole(
  user: CloudDesktopUser,
  instance?: GuacamoleInstance | null,
): Promise<CloudDesktopUser> {
  const repo = AppDataSource.getRepository(CloudDesktopUser);
  const inst =
    instance ||
    (user.instanceId
      ? await AppDataSource.getRepository(GuacamoleInstance).findOne({
          where: { id: user.instanceId },
        })
      : await resolveDefaultGuacamoleInstance());

  if (!inst) {
    user.syncStatus = 'failed';
    user.lastSyncAt = new Date();
    user.lastSyncMessage = '未注册云桌面网关';
    return repo.save(user);
  }

  if (user.status !== 'active') {
    user.syncStatus = 'pending';
    user.lastSyncMessage = '用户未启用，不同步';
    user.instanceId = inst.id;
    return repo.save(user);
  }

  try {
    const password = resolveUnifiedDesktopPassword(inst);
    await upsertGuacamoleRemoteUser(inst, user.guacamoleUsername, password);
    user.instanceId = inst.id;
    user.syncStatus = 'synced';
    user.lastSyncAt = new Date();
    user.lastSyncMessage = '已同步到云桌面网关';
  } catch (e: unknown) {
    user.syncStatus = 'failed';
    user.lastSyncAt = new Date();
    user.lastSyncMessage = e instanceof Error ? e.message : '同步失败';
  }
  return repo.save(user);
}

export async function syncAllCloudDesktopUsers(
  instance?: GuacamoleInstance | null,
): Promise<{ synced: number; failed: number }> {
  const inst = instance || (await resolveDefaultGuacamoleInstance());
  if (!inst) {
    throw Object.assign(new Error('请先在系统设置注册云桌面网关'), { status: 400 });
  }
  const repo = AppDataSource.getRepository(CloudDesktopUser);
  const users = await repo.find({ where: { status: 'active' } });
  let synced = 0;
  let failed = 0;
  for (const u of users) {
    const saved = await syncCloudDesktopUserToGuacamole(u, inst);
    if (saved.syncStatus === 'synced') synced += 1;
    else failed += 1;
  }
  return { synced, failed };
}

export async function createCloudDesktopUser(input: {
  username: string;
  fullName: string;
  email?: string;
}): Promise<CloudDesktopUser> {
  const repo = AppDataSource.getRepository(CloudDesktopUser);
  const username = String(input.username || '').trim();
  if (!username) {
    throw Object.assign(new Error('请输入用户名'), { status: 400 });
  }
  const existed = await repo.findOne({ where: { username } });
  if (existed) {
    throw Object.assign(new Error('用户名已存在'), { status: 400 });
  }
  const guacamoleUsername = normalizeDesktopGuacamoleUsername(username);
  const user = repo.create({
    username,
    fullName: String(input.fullName || '').trim() || username,
    email: input.email ? String(input.email).trim() : undefined,
    status: 'active',
    guacamoleUsername,
    syncStatus: 'pending',
  });
  const saved = await repo.save(user);
  return syncCloudDesktopUserToGuacamole(saved);
}

export async function updateCloudDesktopUser(
  id: string,
  input: Partial<{ fullName: string; email: string; status: 'active' | 'inactive' }>,
): Promise<CloudDesktopUser> {
  const repo = AppDataSource.getRepository(CloudDesktopUser);
  const user = await repo.findOne({ where: { id } });
  if (!user) {
    throw Object.assign(new Error('云桌面用户不存在'), { status: 404 });
  }
  if (input.fullName?.trim()) user.fullName = input.fullName.trim();
  if (input.email !== undefined) user.email = input.email ? String(input.email).trim() : undefined;
  if (input.status) user.status = input.status;
  const saved = await repo.save(user);
  return syncCloudDesktopUserToGuacamole(saved);
}

export async function deleteCloudDesktopUser(id: string): Promise<void> {
  const repo = AppDataSource.getRepository(CloudDesktopUser);
  const user = await repo.findOne({ where: { id } });
  if (!user) {
    throw Object.assign(new Error('云桌面用户不存在'), { status: 404 });
  }
  await repo.remove(user);
}
