import { Router, Response } from 'express';
import { Repository } from 'typeorm';
import { AppDataSource } from '../../config/database';
import { Cloud } from '../../entities/Cloud';
import { GuacamoleInstance } from '../../entities/GuacamoleInstance';
import { AuthRequest } from '../../middleware/auth';
import { checkPermission } from '../../permissions';
import { encryptSecret } from '../../utils/secretCipher';
import {
  normalizeGuacamoleBaseInput,
  testGuacamoleInstance,
} from '../../services/remote/guacamole/guacamoleClient';
import {
  getPoolGatewayAccess,
} from '../../services/remote/guacamole/guacamoleSession';
import { syncAllCloudDesktopUsers, createCloudDesktopUser, updateCloudDesktopUser, deleteCloudDesktopUser, sanitizeCloudDesktopUser, resolveDefaultGuacamoleInstance } from '../../services/remote/guacamole/cloudDesktopUser';
import { assignVmToDesktopUsers, listVmDesktopAssignments } from '../../services/remote/guacamole/guacamoleAssignment';
import { CloudDesktopUser } from '../../entities/CloudDesktopUser';
import {
  checkTenantAccess,
  isNamespaceAllowed,
} from '../clouds/harvester/harvester.direct.helpers';
import { UserRole } from '../../entities/User';

const router = Router();

function userPerms(req: AuthRequest): string[] {
  return Array.isArray((req.user as any)?.permissions) ? (req.user as any).permissions : [];
}

function isSuperAdmin(req: AuthRequest): boolean {
  return (req.user as any)?.role === UserRole.SUPER_ADMIN;
}

function isTenantUser(req: AuthRequest): boolean {
  const role = String((req.user as any)?.role || '');
  return !!(req.user as any)?.isTenantUser || role === UserRole.TENANT || role === 'tenant';
}

function canReadDesktop(req: AuthRequest): boolean {
  if (isSuperAdmin(req)) return true;
  if (isTenantUser(req)) return false;
  const perms = userPerms(req);
  return (
    checkPermission(perms, 'clouds.desktop:read') || checkPermission(perms, 'clouds.desktop:write')
  );
}

function canWriteDesktop(req: AuthRequest): boolean {
  if (isSuperAdmin(req)) return true;
  if (isTenantUser(req)) return false;
  return checkPermission(userPerms(req), 'clouds.desktop:write');
}

function sanitizeInstance(row: GuacamoleInstance) {
  return {
    id: row.id,
    name: row.name,
    baseUrl: row.baseUrl,
    username: row.username,
    dataSource: row.dataSource,
    isDefault: row.isDefault,
    status: row.status,
    lastTestAt: row.lastTestAt,
    lastTestMessage: row.lastTestMessage,
    hasDesktopUserPassword: !!row.desktopUserPasswordEncrypted,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

async function clearOtherDefaults(repo: Repository<GuacamoleInstance>, exceptId?: string) {
  const qb = repo.createQueryBuilder().update(GuacamoleInstance).set({ isDefault: false });
  if (exceptId) qb.where('id != :id', { id: exceptId });
  await qb.execute();
}

/** GET /api/remote/guacamole/instances */
router.get('/instances', async (req: AuthRequest, res: Response) => {
  try {
    if (!canReadDesktop(req)) {
      return res.status(403).json({ message: '权限不足' });
    }
    const rows = await AppDataSource.getRepository(GuacamoleInstance).find({
      order: { isDefault: 'DESC', createdAt: 'ASC' },
    });
    res.json({ ok: true, data: rows.map(sanitizeInstance) });
  } catch (e: unknown) {
    res.status(500).json({ message: e instanceof Error ? e.message : '服务器错误' });
  }
});

/** POST /api/remote/guacamole/instances */
router.post('/instances', async (req: AuthRequest, res: Response) => {
  try {
    if (!canWriteDesktop(req)) {
      return res.status(403).json({ message: '权限不足' });
    }
    const { name, baseUrl, username, password, dataSource, isDefault, desktop_user_password } =
      req.body || {};
    if (!name?.trim() || !baseUrl?.trim() || !username?.trim() || !password?.trim()) {
      return res.status(400).json({ message: '缺少必填字段：name, baseUrl, username, password' });
    }
    const repo = AppDataSource.getRepository(GuacamoleInstance);
    const existing = await repo.findOne({ where: { name: String(name).trim() } });
    if (existing) {
      return res.status(400).json({ message: '网关名称已存在' });
    }
    const row = repo.create({
      name: String(name).trim(),
      baseUrl: normalizeGuacamoleBaseInput(String(baseUrl)),
      username: String(username).trim(),
      passwordEncrypted: encryptSecret(String(password)),
      ...(String(desktop_user_password || '').trim()
        ? { desktopUserPasswordEncrypted: encryptSecret(String(desktop_user_password).trim()) }
        : {}),
      dataSource: String(dataSource || 'postgresql').trim() || 'postgresql',
      isDefault: isDefault !== false,
      status: 'unknown',
    });
    if (row.isDefault) {
      await clearOtherDefaults(repo);
    }
    const saved = await repo.save(row);
    res.status(201).json({ ok: true, data: sanitizeInstance(saved) });
  } catch (e: unknown) {
    res.status(500).json({ message: e instanceof Error ? e.message : '服务器错误' });
  }
});

/** PUT /api/remote/guacamole/instances/:id */
router.put('/instances/:id', async (req: AuthRequest, res: Response) => {
  try {
    if (!canWriteDesktop(req)) {
      return res.status(403).json({ message: '权限不足' });
    }
    const repo = AppDataSource.getRepository(GuacamoleInstance);
    const row = await repo.findOne({ where: { id: req.params.id } });
    if (!row) return res.status(404).json({ message: '网关实例不存在' });

    const { name, baseUrl, username, password, dataSource, isDefault, desktop_user_password } =
      req.body || {};
    if (name?.trim()) row.name = String(name).trim();
    if (baseUrl?.trim()) row.baseUrl = normalizeGuacamoleBaseInput(String(baseUrl));
    if (username?.trim()) row.username = String(username).trim();
    if (password?.trim()) row.passwordEncrypted = encryptSecret(String(password));
    if (String(desktop_user_password || '').trim()) {
      row.desktopUserPasswordEncrypted = encryptSecret(String(desktop_user_password).trim());
    }
    if (dataSource?.trim()) row.dataSource = String(dataSource).trim();
    if (typeof isDefault === 'boolean') row.isDefault = isDefault;
    if (row.isDefault) {
      await clearOtherDefaults(repo, row.id);
    }
    const saved = await repo.save(row);
    if (String(desktop_user_password || '').trim()) {
      try {
        await syncAllCloudDesktopUsers(saved);
      } catch {
        /* 密码变更后同步失败不阻断保存 */
      }
    }
    res.json({ ok: true, data: sanitizeInstance(saved) });
  } catch (e: unknown) {
    res.status(500).json({ message: e instanceof Error ? e.message : '服务器错误' });
  }
});

/** POST /api/remote/guacamole/instances/:id/test */
router.post('/instances/:id/test', async (req: AuthRequest, res: Response) => {
  try {
    if (!canWriteDesktop(req)) {
      return res.status(403).json({ message: '权限不足' });
    }
    const repo = AppDataSource.getRepository(GuacamoleInstance);
    const row = await repo.findOne({ where: { id: req.params.id } });
    if (!row) return res.status(404).json({ message: '网关实例不存在' });

    const result = await testGuacamoleInstance(row);
    row.status = result.ok ? 'online' : 'offline';
    row.lastTestAt = new Date();
    row.lastTestMessage = result.message;
    await repo.save(row);
    res.json({ ok: result.ok, message: result.message, data: sanitizeInstance(row) });
  } catch (e: unknown) {
    res.status(500).json({ message: e instanceof Error ? e.message : '服务器错误' });
  }
});

/** GET /api/remote/guacamole/pools/:cloudId/access */
router.get('/pools/:cloudId/access', async (req: AuthRequest, res: Response) => {
  try {
    if (!canReadDesktop(req)) {
      return res.status(403).json({ message: '权限不足' });
    }
    const access = await getPoolGatewayAccess(req.params.cloudId);
    res.json({ ok: true, ...access });
  } catch (e: unknown) {
    res.status(500).json({ message: e instanceof Error ? e.message : '服务器错误' });
  }
});

/** PUT /api/remote/guacamole/pools/:cloudId/config */
router.put('/pools/:cloudId/config', async (req: AuthRequest, res: Response) => {
  try {
    if (!canWriteDesktop(req)) {
      return res.status(403).json({ message: '权限不足' });
    }
    const repo = AppDataSource.getRepository(Cloud);
    const cloud = await repo.findOne({ where: { id: req.params.cloudId } });
    if (!cloud) return res.status(404).json({ message: '资源池不存在' });

    const { enabled, instanceId } = req.body || {};
    const config = { ...(cloud.config || {}) };
    config.remoteDesktopGateway = {
      ...(config.remoteDesktopGateway || {}),
      ...(typeof enabled === 'boolean' ? { enabled } : {}),
      ...(instanceId !== undefined ? { instanceId: instanceId || undefined } : {}),
    };
    cloud.config = config;
    await repo.save(cloud);
    const access = await getPoolGatewayAccess(cloud.id);
    res.json({ ok: true, config: config.remoteDesktopGateway, ...access });
  } catch (e: unknown) {
    res.status(500).json({ message: e instanceof Error ? e.message : '服务器错误' });
  }
});

/** POST /api/remote/guacamole/users/sync — 同步全部云桌面用户 */
router.post('/users/sync', async (req: AuthRequest, res: Response) => {
  try {
    if (!canWriteDesktop(req)) {
      return res.status(403).json({ message: '权限不足' });
    }
    const instanceId = String(req.body?.instance_id || req.body?.instanceId || '').trim();
    const repo = AppDataSource.getRepository(GuacamoleInstance);
    let instance: GuacamoleInstance | null = null;
    if (instanceId) {
      instance = await repo.findOne({ where: { id: instanceId } });
    } else {
      instance = await resolveDefaultGuacamoleInstance();
    }
    if (!instance) {
      return res.status(400).json({ message: '请先在系统设置注册云桌面网关' });
    }

    const result = await syncAllCloudDesktopUsers(instance);
    res.json({
      ok: true,
      instance_id: instance.id,
      synced: result.synced,
      failed: result.failed,
      message:
        result.failed === 0
          ? `已同步 ${result.synced} 个云桌面用户`
          : `已同步 ${result.synced} 个，失败 ${result.failed} 个`,
    });
  } catch (e: any) {
    const status = e?.status || 500;
    res.status(status).json({ message: e?.message || '同步失败' });
  }
});

/** GET /api/remote/guacamole/desktop-users */
router.get('/desktop-users', async (req: AuthRequest, res: Response) => {
  try {
    if (!canReadDesktop(req)) {
      return res.status(403).json({ message: '权限不足' });
    }
    const repo = AppDataSource.getRepository(CloudDesktopUser);
    const rows = await repo.find({ order: { createdAt: 'DESC' } });
    res.json({ ok: true, data: rows.map(sanitizeCloudDesktopUser) });
  } catch (e: unknown) {
    res.status(500).json({ message: e instanceof Error ? e.message : '服务器错误' });
  }
});

/** POST /api/remote/guacamole/desktop-users */
router.post('/desktop-users', async (req: AuthRequest, res: Response) => {
  try {
    if (!canWriteDesktop(req)) {
      return res.status(403).json({ message: '权限不足' });
    }
    const { username, full_name, fullName, email } = req.body || {};
    const saved = await createCloudDesktopUser({
      username: String(username || ''),
      fullName: String(full_name || fullName || username || ''),
      email: email ? String(email) : undefined,
    });
    res.status(201).json({ ok: true, data: sanitizeCloudDesktopUser(saved) });
  } catch (e: any) {
    const status = e?.status || 500;
    res.status(status).json({ message: e?.message || '创建失败' });
  }
});

/** PUT /api/remote/guacamole/desktop-users/:id */
router.put('/desktop-users/:id', async (req: AuthRequest, res: Response) => {
  try {
    if (!canWriteDesktop(req)) {
      return res.status(403).json({ message: '权限不足' });
    }
    const { full_name, fullName, email, status } = req.body || {};
    const saved = await updateCloudDesktopUser(req.params.id, {
      fullName: full_name || fullName,
      email,
      status,
    });
    res.json({ ok: true, data: sanitizeCloudDesktopUser(saved) });
  } catch (e: any) {
    const status = e?.status || 500;
    res.status(status).json({ message: e?.message || '更新失败' });
  }
});

/** DELETE /api/remote/guacamole/desktop-users/:id */
router.delete('/desktop-users/:id', async (req: AuthRequest, res: Response) => {
  try {
    if (!canWriteDesktop(req)) {
      return res.status(403).json({ message: '权限不足' });
    }
    await deleteCloudDesktopUser(req.params.id);
    res.json({ ok: true });
  } catch (e: any) {
    const status = e?.status || 500;
    res.status(status).json({ message: e?.message || '删除失败' });
  }
});

/** GET /api/remote/guacamole/assignments */
router.get('/assignments', async (req: AuthRequest, res: Response) => {
  try {
    if (!canReadDesktop(req)) {
      return res.status(403).json({ message: '权限不足' });
    }
    const cloudId = String(req.query.cloud_id || '').trim();
    const namespace = String(req.query.namespace || '').trim();
    const resourceId = String(req.query.resource_id || '').trim();
    if (!cloudId || !namespace || !resourceId) {
      return res.status(400).json({ message: '缺少 cloud_id、namespace 或 resource_id' });
    }
    const { allowed, namespace: tenantNs, isTenant } = await checkTenantAccess(req, cloudId);
    if (!allowed) {
      return res.status(403).json({ message: '无权访问该资源池' });
    }
    if (isTenant && tenantNs && !isNamespaceAllowed(tenantNs, namespace)) {
      return res.status(403).json({ message: '无权访问该命名空间' });
    }
    const list = await listVmDesktopAssignments(cloudId, namespace, resourceId);
    res.json({
      ok: true,
      data: list.map((item) => ({
        assignment_id: item.assignmentId,
        desktop_user: sanitizeCloudDesktopUser(item.desktopUser),
      })),
    });
  } catch (e: unknown) {
    res.status(500).json({ message: e instanceof Error ? e.message : '服务器错误' });
  }
});

/** POST /api/remote/guacamole/assignments — 分配 VM 云桌面给用户 */
router.post('/assignments', async (req: AuthRequest, res: Response) => {
  try {
    if (!canWriteDesktop(req)) {
      return res.status(403).json({ message: '权限不足: 无云桌面管理权限' });
    }
    const {
      cloud_id: cloudId,
      namespace,
      resource_id: resourceId,
      desktop_user_ids: desktopUserIds,
      protocol,
      username,
      password,
    } = req.body || {};
    if (!cloudId || !namespace || !resourceId) {
      return res.status(400).json({ message: '缺少 cloud_id、namespace 或 resource_id' });
    }
    if (!Array.isArray(desktopUserIds)) {
      return res.status(400).json({ message: 'desktop_user_ids 须为数组' });
    }

    const { allowed, namespace: tenantNs, isTenant } = await checkTenantAccess(req, String(cloudId));
    if (!allowed) {
      return res.status(403).json({ message: '无权访问该资源池' });
    }
    const ns = String(namespace || '').trim();
    if (isTenant && tenantNs && !isNamespaceAllowed(tenantNs, ns)) {
      return res.status(403).json({ message: '无权访问该命名空间' });
    }

    const result = await assignVmToDesktopUsers({
      cloudId: String(cloudId),
      namespace: ns,
      resourceId: String(resourceId),
      desktopUserIds: desktopUserIds.map(String),
      protocol: protocol ? String(protocol) : undefined,
      guestUsername: username ? String(username) : undefined,
      guestPassword: password ? String(password) : undefined,
      assignedByUserId: req.user?.id,
    });

    res.json({ ok: true, ...result });
  } catch (e: any) {
    const status = e?.status || 500;
    res.status(status).json({ message: e?.message || '分配失败' });
  }
});

export { router as guacamoleRoutes };
