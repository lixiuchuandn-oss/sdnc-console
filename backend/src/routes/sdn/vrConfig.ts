import { Router } from 'express';
import { AppDataSource } from '../../config/database';
import { VRConfig } from '../../entities/vRouter/VRConfig';
import { VRCacheExtended } from '../../entities/vRouter/VRCacheExtended';
import { vrController } from '../../services/vrouter/vrController';
import { vrManagementService } from '../../services/vrouter/vrManagementService';
import { logger } from '../../utils/logger';

const vrConfigLog = logger.child('VR-Config');

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export const vrConfigRoutes = Router();

// Get Cached VR Config (from DB)
vrConfigRoutes.get('/:uuid/cached', async (req, res) => {
  try {
    const { uuid } = req.params;
    if (!uuid) return res.status(400).json({ message: 'UUID required' });

    const repo = AppDataSource.getRepository(VRConfig);
    const record = await repo.findOne({ where: { uuid } });

    if (!record) {
      return res.status(404).json({ message: 'Cached VR config not found', code: 404 });
    }

    let configData = {};
    try {
      configData = JSON.parse(record.config_json);
    } catch (e) {
      configData = { error: 'Invalid JSON in DB', raw: record.config_json };
    }

    return res.json({
      code: 200,
      msg: 'ok',
      data: configData,
      meta: {
        updatedAt: record.updated_at,
        role: record.role,
      },
    });
  } catch (err: any) {
    console.error('[VR-CONFIG] get cached error', err);
    return res.status(500).json({ message: err?.message || '内部错误' });
  }
});

function getTenantContext(req: any) {
  const user = req.user;
  if (user && (user as any).tenantId) {
    return {
      tenantId: String((user as any).tenantId),
      organizationId: (user as any).organizationId
        ? String((user as any).organizationId)
        : undefined,
    };
  }
  return null;
}

// Bind VR to Tenant
vrConfigRoutes.post('/bind', async (req, res) => {
  try {
    const ctx = getTenantContext(req as any);
    const { vm_id, vr_uuid, tenant_id, org_id, device_fingerprint, display_name, vr_type } =
      req.body || {};

    let resolvedTenantId = tenant_id as string | undefined;
    let resolvedOrgId = org_id as string | undefined;

    if (ctx) {
      resolvedTenantId = ctx.tenantId;
      resolvedOrgId = ctx.organizationId || resolvedOrgId;
    }

    // Call shared service
    const result = await vrManagementService.bindVRToTenant({
      vr_uuid,
      tenant_id: resolvedTenantId || '', // Service will validate emptiness
      org_id: resolvedOrgId,
      vm_id,
      device_fingerprint,
      display_name,
      vr_type,
    });

    return res.json(result);
  } catch (err: any) {
    vrConfigLog.error('bind error', errMsg(err));
    if (err.message && err.message.includes('VR已绑定')) {
      return res.status(409).json({ message: err.message, ...err.details });
    }
    if (err.message && (err.message.includes('缺少') || err.message.includes('不支持'))) {
      return res.status(400).json({ message: err.message });
    }
    return res.status(500).json({ message: err?.message || '内部错误' });
  }
});

// List VRs (from database)
vrConfigRoutes.get('/list', async (req, res) => {
  try {
    const ctx = getTenantContext(req as any);
    const repository = AppDataSource.getRepository(VRConfig);

    const where: any = {};

    if (ctx) {
      where.tenantId = ctx.tenantId;
      if (ctx.organizationId) {
        where.organizationId = ctx.organizationId;
      }
    } else {
      const tenantId = req.query.tenantId as string | undefined;
      const organizationId = req.query.organizationId as string | undefined;
      if (tenantId) where.tenantId = tenantId;
      if (organizationId) where.organizationId = organizationId;
    }

    const list = Object.keys(where).length
      ? await repository.find({ where, order: { created_at: 'DESC' } })
      : await repository.find({ order: { created_at: 'DESC' } });

    // Fetch extended info for enriching the list
    const extendedRepo = AppDataSource.getRepository(VRCacheExtended);
    const extendedRows = await extendedRepo.find();
    const extendedMap: Record<string, any> = {};
    extendedRows.forEach((row) => {
      try {
        extendedMap[row.uuid] = JSON.parse(row.data);
      } catch (e) {
        // ignore
      }
    });

    // 2. Fetch live list from CSM to mark deleted ones
    let liveUuids: Set<string> | null = null;
    try {
      // Fetch a large page to cover most VRs.
      // TODO: If VR count > 2000, we need pagination loop or a better API.
      // Assuming for now < 2000 VRs is typical for this tenant context or global.
      const liveData = await vrController.getVRList(2000, 1);

      let items: any[] = [];
      if (Array.isArray(liveData)) items = liveData;
      else if (Array.isArray(liveData?.page)) items = liveData.page;
      else if (Array.isArray(liveData?.items)) items = liveData.items;
      else if (Array.isArray(liveData?.data)) items = liveData.data;

      if (items.length > 0) {
        liveUuids = new Set(
          items.map((it: any) => String(it.uuid || it.vr_unique_id || it.id || '').trim()),
        );
      }
    } catch (e) {
      vrConfigLog.warn('Failed to fetch live VR list for sync check:', errMsg(e));
      // If failed, we assume we can't determine, so we don't mark as deleted (or mark all as unknown?)
      // We leave liveUuids as null.
    }

    const data = list.map((item) => {
      const uid = String(item.uuid).trim();
      // If liveUuids is null (fetch failed), we don't mark as deleted.
      // If liveUuids is set, and uid is not in it, it's deleted.
      const isDeleted = liveUuids ? !liveUuids.has(uid) : false;

      const extendedData = extendedMap[uid] || {};

      return {
        vr_unique_id: item.uuid,
        uuid: item.uuid,
        name: item.name || item.uuid,
        tenant_id: item.tenantId,
        org_id: item.organizationId,
        role: item.role,
        bind_status: item.bindStatus,
        created_at: item.created_at,
        updated_at: item.updated_at,
        is_deleted: isDeleted,
        // Extended properties
        resourceIndicators: extendedData.resourceIndicators,
        interfaces: extendedData.interfaces,
      };
    });

    return res.json({ items: data });
  } catch (err: any) {
    vrConfigLog.error('list error', errMsg(err));
    return res.status(500).json({ message: err?.message || '内部错误' });
  }
});

// Delete VR Config (Unbind/Remove from DB)
vrConfigRoutes.delete('/:uuid', async (req, res) => {
  try {
    const { uuid } = req.params;
    if (!uuid) return res.status(400).json({ message: 'UUID required' });

    const repo = AppDataSource.getRepository(VRConfig);
    const result = await repo.delete({ uuid });

    if (result.affected === 0) {
      return res.status(404).json({ message: 'VR config not found' });
    }

    return res.json({ message: 'ok', uuid });
  } catch (err: any) {
    vrConfigLog.error('delete error', errMsg(err));
    return res.status(500).json({ message: err?.message || '内部错误' });
  }
});

// Get real-time VR list from controller (csmctl)
vrConfigRoutes.get('/pagelist', async (req, res) => {
  try {
    {
      const role = (req as any).user?.role;
      const perms: string[] = Array.isArray((req as any).user?.permissions)
        ? (req as any).user?.permissions
        : [];
      if (
        !(
          role === 'super_admin' ||
          perms.includes('networks.vr-config:read') ||
          perms.includes('networks.vr-config:write')
        )
      ) {
        return res.status(403).json({ message: '权限不足：需要读取权限 networks.vr-config:read' });
      }
    }
    const pageNum = Number(req.query.page_num || 1);
    const pageSize = Number(req.query.page_size || 50);

    const data = await vrController.getVRList(pageSize, pageNum);
    vrConfigLog.debug('getVRList result:', JSON.stringify(data).slice(0, 500));
    return res.json({ code: 200, msg: 'ok', data });
  } catch (err: any) {
    vrConfigLog.error('pagelist error', errMsg(err));
    return res.status(500).json({ code: 500, msg: err?.message || 'internal error' });
  }
});

// Upsert VR config by uuid
vrConfigRoutes.post('/upsert', async (req, res) => {
  try {
    {
      const role = (req as any).user?.role;
      const perms: string[] = Array.isArray((req as any).user?.permissions)
        ? (req as any).user?.permissions
        : [];
      if (!(role === 'super_admin' || perms.includes('networks.vr-config:write'))) {
        return res.status(403).json({ message: '权限不足：需要写入权限 networks.vr-config:write' });
      }
    }
    const { uuid, config, cloudId, cloudName, vmId } = req.body || {};
    if (!uuid) {
      return res.status(400).json({ code: 400, msg: '缺少必要参数: uuid' });
    }
    if (typeof config === 'undefined') {
      return res.status(400).json({ code: 400, msg: '缺少必要参数: config' });
    }

    const repo = AppDataSource.getRepository(VRConfig);
    let record = await repo.findOne({ where: { uuid } });
    const jsonStr = typeof config === 'string' ? config : JSON.stringify(config);

    const { assertSrv6VrConfigUpsertAllowed } = await import('./srv6.vrLock');
    try {
      await assertSrv6VrConfigUpsertAllowed(uuid, jsonStr);
    } catch (lockErr: any) {
      if (lockErr?.statusCode === 400 || lockErr?.statusCode === 409) {
        return res.status(lockErr.statusCode).json({
          code: lockErr.statusCode,
          msg: lockErr.message,
          message: lockErr.message,
        });
      }
      throw lockErr;
    }

    const { findSrv6TunnelsReferencingVr } = await import('./srv6.references');
    const { listAliveContributionsForVr } = await import('./srv6.sync');
    const { persistSrv6VrEffectiveConfig } = await import('./srv6.sync');
    const srv6Refs = await findSrv6TunnelsReferencingVr(uuid);
    const hasSrv6Baseline = Boolean(record?.srv6BaselineJson?.trim());

    if (record) {
      if (cloudId !== undefined) record.cloudId = cloudId;
      if (cloudName !== undefined) record.cloudName = cloudName;
      if (vmId !== undefined) record.vmId = vmId;

      // P2：有存活隧道引用时，生效配置仅由 baseline+Σcontrib 推导
      if (hasSrv6Baseline && srv6Refs.length > 0) {
        await persistSrv6VrEffectiveConfig(uuid);
        const fresh = await repo.findOne({ where: { uuid } });
        if (fresh) {
          if (cloudId !== undefined) fresh.cloudId = cloudId;
          if (cloudName !== undefined) fresh.cloudName = cloudName;
          if (vmId !== undefined) fresh.vmId = vmId;
          await repo.save(fresh);
          record = fresh;
        }
      } else if (hasSrv6Baseline && srv6Refs.length === 0) {
        // 无存活隧道：允许向导更新，并刷新基线（P4 前过渡）
        record.config_json = jsonStr;
        record.srv6BaselineJson = jsonStr;
        record.srv6BaselineAt = new Date();
        record.srv6BaselineTunnelId = null;
        await repo.save(record);
      } else {
        record.config_json = jsonStr;
        await repo.save(record);
      }
    } else {
      record = repo.create({
        uuid,
        config_json: jsonStr,
        cloudId: cloudId || undefined,
        cloudName: cloudName || undefined,
        vmId: vmId || undefined,
      });
      await repo.save(record);
    }

    const recomputed =
      Boolean(record?.srv6BaselineJson?.trim()) &&
      (await listAliveContributionsForVr(uuid)).length > 0;

    return res.json({
      code: 200,
      msg: 'ok',
      data: { uuid, srv6Recomputed: recomputed },
    });
  } catch (err: any) {
    vrConfigLog.error('upsert error', errMsg(err));
    return res.status(500).json({ code: 500, msg: err?.message || 'internal error' });
  }
});

// Set VR role (PE/CE)
vrConfigRoutes.post('/set-role', async (req, res) => {
  try {
    {
      const role = (req as any).user?.role;
      const perms: string[] = Array.isArray((req as any).user?.permissions)
        ? (req as any).user?.permissions
        : [];
      if (!(role === 'super_admin' || perms.includes('networks.vr-config:write'))) {
        return res.status(403).json({ message: '权限不足：需要写入权限 networks.vr-config:write' });
      }
    }
    const { uuid, role } = req.body || {};
    if (!uuid) {
      return res.status(400).json({ code: 400, msg: '缺少必要参数: uuid' });
    }
    const normalized = String(role || '').toUpperCase();
    // 允许 PE, CE, SASE, 标准
    if (!['PE', 'CE', 'SASE', '标准'].includes(normalized)) {
      return res.status(400).json({ code: 400, msg: '角色仅支持 PE, CE, SASE 或 标准' });
    }

    const repo = AppDataSource.getRepository(VRConfig);
    let record = await repo.findOne({ where: { uuid } });
    const { assertSrv6VrSetRoleAllowed } = await import('./srv6.vrLock');
    try {
      await assertSrv6VrSetRoleAllowed(uuid, normalized);
    } catch (lockErr: any) {
      if (lockErr?.statusCode === 409) {
        return res.status(409).json({ code: 409, msg: lockErr.message, message: lockErr.message });
      }
      throw lockErr;
    }
    if (record) {
      record.role = normalized;
      await repo.save(record);
    } else {
      record = repo.create({ uuid, config_json: '{}', role: normalized });
      await repo.save(record);
    }

    return res.json({ code: 200, msg: 'ok', data: { uuid, role: normalized } });
  } catch (err: any) {
    vrConfigLog.error('set-role error', errMsg(err));
    return res.status(500).json({ code: 500, msg: err?.message || 'internal error' });
  }
});

// Get roles by uuids (optional); returns mapping { uuid: role }
vrConfigRoutes.get('/roles', async (req, res) => {
  try {
    {
      const role = (req as any).user?.role;
      const perms: string[] = Array.isArray((req as any).user?.permissions)
        ? (req as any).user?.permissions
        : [];
      if (
        !(
          role === 'super_admin' ||
          perms.includes('networks.vr-config:read') ||
          perms.includes('networks.vr-config:write')
        )
      ) {
        return res.status(403).json({ message: '权限不足：需要读取权限 networks.vr-config:read' });
      }
    }
    const uuidsParam = String(req.query.uuids || '').trim();
    const uuids = uuidsParam
      ? uuidsParam
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
      : undefined;

    const repo = AppDataSource.getRepository(VRConfig);
    let records: VRConfig[];
    if (uuids && uuids.length) {
      records = await repo.find({ where: uuids.map((u) => ({ uuid: u })) });
    } else {
      records = await repo.find();
    }

    const roles: Record<string, string> = {};
    for (const r of records) {
      if (r.role) roles[r.uuid] = r.role;
    }
    return res.json({ code: 200, msg: 'ok', data: { roles } });
  } catch (err: any) {
    vrConfigLog.error('roles error', errMsg(err));
    return res.status(500).json({ code: 500, msg: err?.message || 'internal error' });
  }
});

// Get VR config by uuid
vrConfigRoutes.get('/:uuid', async (req, res) => {
  try {
    {
      const role = (req as any).user?.role;
      const perms: string[] = Array.isArray((req as any).user?.permissions)
        ? (req as any).user?.permissions
        : [];
      if (
        !(
          role === 'super_admin' ||
          perms.includes('networks.vr-config:read') ||
          perms.includes('networks.vr-config:write')
        )
      ) {
        return res.status(403).json({ message: '权限不足：需要读取权限 networks.vr-config:read' });
      }
    }
    const { uuid } = req.params;
    const repo = AppDataSource.getRepository(VRConfig);
    const record = await repo.findOne({ where: { uuid } });
    if (!record) {
      return res.status(404).json({ code: 404, msg: '未找到VR配置', data: null });
    }
    let data: any;
    try {
      data = JSON.parse(record.config_json);
    } catch {
      data = record.config_json;
    }

    // Mix in metadata fields
    if (typeof data === 'object' && data !== null) {
      if (record.cloudId) data.cloudId = record.cloudId;
      if (record.cloudName) data.cloudName = record.cloudName;
      if (record.vmId) data.vmId = record.vmId;
    }

    return res.json({ code: 200, msg: 'ok', data });
  } catch (err: any) {
    vrConfigLog.error('get error', errMsg(err));
    return res.status(500).json({ code: 500, msg: err?.message || 'internal error' });
  }
});

// Get Real-time VR config from CSMCTL
vrConfigRoutes.get('/:uuid/realtime', async (req, res) => {
  try {
    {
      const role = (req as any).user?.role;
      const perms: string[] = Array.isArray((req as any).user?.permissions)
        ? (req as any).user?.permissions
        : [];
      if (
        !(
          role === 'super_admin' ||
          perms.includes('networks.vr-config:read') ||
          perms.includes('networks.vr-config:write')
        )
      ) {
        return res.status(403).json({ message: '权限不足：需要读取权限 networks.vr-config:read' });
      }
    }
    const { uuid } = req.params;

    // Call controller to get raw config from CSMCTL
    const data = await vrController.getVRConfig(uuid);

    // Return raw data directly
    return res.json({ code: 200, msg: 'ok', data });
  } catch (err: any) {
    vrConfigLog.error('realtime error', errMsg(err));
    // Forward upstream error details if available
    return res.status(500).json({ code: 500, msg: err?.message || 'internal error' });
  }
});

// Delete VR config by uuid
vrConfigRoutes.delete('/:uuid', async (req, res) => {
  try {
    {
      const role = (req as any).user?.role;
      const perms: string[] = Array.isArray((req as any).user?.permissions)
        ? (req as any).user?.permissions
        : [];
      if (!(role === 'super_admin' || perms.includes('networks.vr-config:write'))) {
        return res.status(403).json({ message: '权限不足：需要写入权限 networks.vr-config:write' });
      }
    }
    const { uuid } = req.params;
    const repo = AppDataSource.getRepository(VRConfig);
    const result = await repo.delete({ uuid });

    if (result.affected === 0) {
      return res.status(404).json({ code: 404, msg: '未找到VR配置或删除失败' });
    }

    return res.json({ code: 200, msg: 'ok', data: { uuid } });
  } catch (err: any) {
    vrConfigLog.error('delete error', errMsg(err));
    return res.status(500).json({ code: 500, msg: err?.message || 'internal error' });
  }
});
