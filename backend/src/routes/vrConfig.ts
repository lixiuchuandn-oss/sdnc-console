import { Router } from 'express';
import { AppDataSource } from '../config/database';
import { VRConfig } from '../entities/VRConfig';

export const vrConfigRoutes = Router();

// Upsert VR config by uuid
vrConfigRoutes.post('/upsert', async (req, res) => {
  try {
    {
      const role = (req as any).user?.role;
      const perms: string[] = Array.isArray((req as any).user?.permissions) ? (req as any).user?.permissions : [];
      if (!(role === 'super_admin' || perms.includes('networks.vr-config:write'))) {
        return res.status(403).json({ message: '权限不足：需要写入权限 networks.vr-config:write' });
      }
    }
    const { uuid, config } = req.body || {};
    if (!uuid) {
      return res.status(400).json({ code: 400, msg: '缺少必要参数: uuid' });
    }
    if (typeof config === 'undefined') {
      return res.status(400).json({ code: 400, msg: '缺少必要参数: config' });
    }

    const repo = AppDataSource.getRepository(VRConfig);
    let record = await repo.findOne({ where: { uuid } });
    const jsonStr = typeof config === 'string' ? config : JSON.stringify(config);

    if (record) {
      record.config_json = jsonStr;
      await repo.save(record);
    } else {
      record = repo.create({ uuid, config_json: jsonStr });
      await repo.save(record);
    }

    return res.json({ code: 200, msg: 'ok', data: { uuid } });
  } catch (err: any) {
    console.error('[VR_CONFIG] upsert error', err);
    return res.status(500).json({ code: 500, msg: err?.message || 'internal error' });
  }
});

// Set VR role (PE/CE)
vrConfigRoutes.post('/set-role', async (req, res) => {
  try {
    {
      const role = (req as any).user?.role;
      const perms: string[] = Array.isArray((req as any).user?.permissions) ? (req as any).user?.permissions : [];
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
    if (record) {
      record.role = normalized;
      await repo.save(record);
    } else {
      record = repo.create({ uuid, config_json: '{}', role: normalized });
      await repo.save(record);
    }

    return res.json({ code: 200, msg: 'ok', data: { uuid, role: normalized } });
  } catch (err: any) {
    console.error('[VR_CONFIG] set-role error', err);
    return res.status(500).json({ code: 500, msg: err?.message || 'internal error' });
  }
});

// Get roles by uuids (optional); returns mapping { uuid: role }
vrConfigRoutes.get('/roles', async (req, res) => {
  try {
    {
      const role = (req as any).user?.role;
      const perms: string[] = Array.isArray((req as any).user?.permissions) ? (req as any).user?.permissions : [];
      if (!(role === 'super_admin' || perms.includes('networks.vr-config:read') || perms.includes('networks.vr-config:write'))) {
        return res.status(403).json({ message: '权限不足：需要读取权限 networks.vr-config:read' });
      }
    }
    const uuidsParam = String(req.query.uuids || '').trim();
    const uuids = uuidsParam ? uuidsParam.split(',').map(s => s.trim()).filter(Boolean) : undefined;

    const repo = AppDataSource.getRepository(VRConfig);
    let records: VRConfig[];
    if (uuids && uuids.length) {
      records = await repo.find({ where: uuids.map(u => ({ uuid: u })) });
    } else {
      records = await repo.find();
    }

    const roles: Record<string, string> = {};
    for (const r of records) {
      if (r.role) roles[r.uuid] = r.role;
    }
    return res.json({ code: 200, msg: 'ok', data: { roles } });
  } catch (err: any) {
    console.error('[VR_CONFIG] roles error', err);
    return res.status(500).json({ code: 500, msg: err?.message || 'internal error' });
  }
});

// Get VR config by uuid
vrConfigRoutes.get('/:uuid', async (req, res) => {
  try {
    {
      const role = (req as any).user?.role;
      const perms: string[] = Array.isArray((req as any).user?.permissions) ? (req as any).user?.permissions : [];
      if (!(role === 'super_admin' || perms.includes('networks.vr-config:read') || perms.includes('networks.vr-config:write'))) {
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
    return res.json({ code: 200, msg: 'ok', data });
  } catch (err: any) {
    console.error('[VR_CONFIG] get error', err);
    return res.status(500).json({ code: 500, msg: err?.message || 'internal error' });
  }
});
