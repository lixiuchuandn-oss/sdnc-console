import { In } from 'typeorm';
import { AppDataSource } from '../../../config/database';
import { CloudDesktopUser } from '../../../entities/CloudDesktopUser';
import { GuacamoleConnectionMap } from '../../../entities/GuacamoleConnectionMap';
import { GuacamoleDesktopAssignment } from '../../../entities/GuacamoleDesktopAssignment';
import { GuacamoleInstance } from '../../../entities/GuacamoleInstance';
import { syncCloudDesktopUserToGuacamole } from './cloudDesktopUser';
import { deleteGuacamoleConnection } from './guacamoleConnection';
import { grantConnectionRead, revokeConnectionRead } from './guacamoleUser';
import { ensureVmGuacamoleConnection } from './guacamoleVmConnection';
import { buildVmResourceKey } from './resolveVmDesktop';

export type AssignVmDesktopInput = {
  cloudId: string;
  namespace: string;
  resourceId: string;
  desktopUserIds: string[];
  protocol?: string;
  guestUsername?: string;
  guestPassword?: string;
  assignedByUserId?: string;
};

export async function assignVmToDesktopUsers(input: AssignVmDesktopInput): Promise<{
  connectionId: string;
  assigned: string[];
  removed: string[];
}> {
  const ids = Array.from(
    new Set((input.desktopUserIds || []).map((x) => String(x).trim()).filter(Boolean)),
  );
  const conn = await ensureVmGuacamoleConnection({
    cloudId: input.cloudId,
    namespace: input.namespace,
    vmName: input.resourceId,
    protocol: input.protocol,
    guestUsername: input.guestUsername,
    guestPassword: input.guestPassword,
  });

  const resourceKey = buildVmResourceKey(input.namespace, input.resourceId);
  const assignRepo = AppDataSource.getRepository(GuacamoleDesktopAssignment);
  const userRepo = AppDataSource.getRepository(CloudDesktopUser);

  const existing = await assignRepo.find({
    where: {
      cloudId: input.cloudId,
      resourceType: 'vm',
      resourceKey,
    },
  });

  const existingByUser = new Map(existing.map((a) => [a.desktopUserId, a]));
  const targetSet = new Set(ids);

  const removed: string[] = [];
  for (const row of existing) {
    if (!targetSet.has(row.desktopUserId)) {
      const user = await userRepo.findOne({ where: { id: row.desktopUserId } });
      if (user) {
        try {
          await revokeConnectionRead(conn.instance, user.guacamoleUsername, row.guacConnectionId);
        } catch {
          /* ignore revoke errors */
        }
      }
      await assignRepo.remove(row);
      removed.push(row.desktopUserId);
    }
  }

  const assigned: string[] = [];
  if (ids.length) {
    const users = await userRepo.find({ where: { id: In(ids), status: 'active' } });
    if (users.length !== ids.length) {
      throw Object.assign(new Error('部分云桌面用户不存在或未启用'), { status: 400 });
    }

    for (const user of users) {
      const synced = await syncCloudDesktopUserToGuacamole(user, conn.instance);
      if (synced.syncStatus !== 'synced') {
        throw Object.assign(
          new Error(`云桌面用户 ${user.username} 同步失败: ${synced.lastSyncMessage || ''}`),
          { status: 400 },
        );
      }
      await grantConnectionRead(conn.instance, user.guacamoleUsername, conn.connectionId);

      let row = existingByUser.get(user.id);
      if (!row) {
        row = assignRepo.create({
          desktopUserId: user.id,
          instanceId: conn.instance.id,
          cloudId: input.cloudId,
          resourceType: 'vm',
          resourceKey,
          guacConnectionId: conn.connectionId,
          assignedByUserId: input.assignedByUserId,
        });
      } else {
        row.guacConnectionId = conn.connectionId;
        row.instanceId = conn.instance.id;
        row.assignedByUserId = input.assignedByUserId;
      }
      await assignRepo.save(row);
      assigned.push(user.id);
    }
  }

  return {
    connectionId: conn.connectionId,
    assigned,
    removed,
  };
}

export async function listVmDesktopAssignments(
  cloudId: string,
  namespace: string,
  resourceId: string,
): Promise<Array<{ assignmentId: string; desktopUser: CloudDesktopUser }>> {
  const resourceKey = buildVmResourceKey(namespace, resourceId);
  const assignRepo = AppDataSource.getRepository(GuacamoleDesktopAssignment);
  const userRepo = AppDataSource.getRepository(CloudDesktopUser);
  const rows = await assignRepo.find({
    where: { cloudId, resourceType: 'vm', resourceKey },
    order: { createdAt: 'ASC' },
  });
  if (!rows.length) return [];
  const users = await userRepo.find({ where: { id: In(rows.map((r) => r.desktopUserId)) } });
  const userMap = new Map(users.map((u) => [u.id, u]));
  return rows
    .map((r) => {
      const desktopUser = userMap.get(r.desktopUserId);
      if (!desktopUser) return null;
      return { assignmentId: r.id, desktopUser };
    })
    .filter(Boolean) as Array<{ assignmentId: string; desktopUser: CloudDesktopUser }>;
}

function parseResolvedVmId(resolvedVmId: string): { namespace: string; vmName: string } | null {
  const raw = String(resolvedVmId || '').trim();
  if (!raw) return null;
  const sep = raw.includes('/') ? '/' : raw.includes(':') ? ':' : '';
  if (!sep) return null;
  const idx = raw.indexOf(sep);
  const namespace = raw.slice(0, idx).trim();
  const vmName = raw.slice(idx + 1).trim();
  if (!namespace || !vmName) return null;
  return { namespace, vmName };
}

/** VM 删除 / 强制删除时：撤销 READ、删 Connection、清理 assignment 与本地映射（幂等） */
export async function cleanupVmDesktopResources(
  cloudId: string,
  resolvedVmId: string,
): Promise<void> {
  const parsed = parseResolvedVmId(resolvedVmId);
  if (!parsed) return;

  const resourceKey = buildVmResourceKey(parsed.namespace, parsed.vmName);
  const assignRepo = AppDataSource.getRepository(GuacamoleDesktopAssignment);
  const mapRepo = AppDataSource.getRepository(GuacamoleConnectionMap);
  const userRepo = AppDataSource.getRepository(CloudDesktopUser);
  const instanceRepo = AppDataSource.getRepository(GuacamoleInstance);

  const assignments = await assignRepo.find({
    where: { cloudId, resourceType: 'vm', resourceKey },
  });
  const map = await mapRepo.findOne({
    where: { cloudId, resourceType: 'vm', resourceKey },
  });
  if (!assignments.length && !map) return;

  const instanceId = map?.instanceId || assignments[0]?.instanceId;
  const connectionId = map?.guacConnectionId || assignments[0]?.guacConnectionId;
  let instance: GuacamoleInstance | null = null;
  if (instanceId) {
    instance = await instanceRepo.findOne({ where: { id: instanceId } });
  }

  if (instance && assignments.length) {
    const users = await userRepo.find({
      where: { id: In(assignments.map((a) => a.desktopUserId)) },
    });
    for (const user of users) {
      const connId =
        assignments.find((a) => a.desktopUserId === user.id)?.guacConnectionId || connectionId;
      if (!connId) continue;
      try {
        await revokeConnectionRead(instance, user.guacamoleUsername, connId);
      } catch {
        /* ignore revoke errors */
      }
    }
  }

  if (assignments.length) {
    await assignRepo.remove(assignments);
  }

  if (instance && connectionId) {
    try {
      await deleteGuacamoleConnection(instance, connectionId);
    } catch {
      /* ignore if connection already removed */
    }
  }

  if (map) {
    await mapRepo.remove(map);
  }
}
