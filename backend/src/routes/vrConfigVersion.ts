import express from 'express';
import { AppDataSource } from '../config/database';
import { VRConfigVersion } from '../entities/VRConfigVersion';

export const vrConfigVersionRoutes = express.Router();

// 列出某个VR在某个角色下的配置版本（最多返回5个，按时间倒序）
vrConfigVersionRoutes.get('/list', async (req, res, next) => {
  try {
    {
      const role = (req as any).user?.role;
      const perms: string[] = Array.isArray((req as any).user?.permissions) ? (req as any).user?.permissions : [];
      if (!(role === 'super_admin' || perms.includes('networks.vr-config:read') || perms.includes('networks.vr-config:write'))) {
        return res.status(403).json({ message: '权限不足：需要读取权限 networks.vr-config:read' });
      }
    }
    const { uuid, role } = req.query as { uuid?: string; role?: string };
    if (!uuid || !role) {
      return res.status(400).json({ message: '缺少参数 uuid 或 role' });
    }
    const repo = AppDataSource.getRepository(VRConfigVersion);
    const list = await repo.find({
      where: { uuid, role: (role || '').toUpperCase() },
      order: { created_at: 'DESC' },
      take: 5,
    });
    res.json({ versions: list });
  } catch (err) {
    next(err);
  }
});

// 获取指定版本配置
vrConfigVersionRoutes.get('/get/:id', async (req, res, next) => {
  try {
    {
      const role = (req as any).user?.role;
      const perms: string[] = Array.isArray((req as any).user?.permissions) ? (req as any).user?.permissions : [];
      if (!(role === 'super_admin' || perms.includes('networks.vr-config:read') || perms.includes('networks.vr-config:write'))) {
        return res.status(403).json({ message: '权限不足：需要读取权限 networks.vr-config:read' });
      }
    }
    const id = Number(req.params.id);
    if (!id) {
      return res.status(400).json({ message: '参数 id 不合法' });
    }
    const repo = AppDataSource.getRepository(VRConfigVersion);
    const found = await repo.findOne({ where: { id } });
    if (!found) {
      return res.status(404).json({ message: '未找到该版本配置' });
    }
    res.json({ version: found });
  } catch (err) {
    next(err);
  }
});

// 保存一个新版本（超过5个则删除最旧的）
vrConfigVersionRoutes.post('/save', async (req, res, next) => {
  try {
    {
      const role = (req as any).user?.role;
      const perms: string[] = Array.isArray((req as any).user?.permissions) ? (req as any).user?.permissions : [];
      if (!(role === 'super_admin' || perms.includes('networks.vr-config:write'))) {
        return res.status(403).json({ message: '权限不足：需要写入权限 networks.vr-config:write' });
      }
    }
    const { uuid, role, config_json } = req.body as { uuid?: string; role?: string; config_json?: string };
    if (!uuid || !role || !config_json) {
      return res.status(400).json({ message: '缺少参数 uuid、role 或 config_json' });
    }
    const repo = AppDataSource.getRepository(VRConfigVersion);
    const entity = repo.create({ uuid, role: role.toUpperCase(), config_json });
    const saved = await repo.save(entity);

    // 保持最多5个版本
    const all = await repo.find({ where: { uuid, role: role.toUpperCase() }, order: { created_at: 'DESC' } });
    if (all.length > 5) {
      const toDelete = all.slice(5); // 第6个及以后
      if (toDelete.length) {
        await repo.remove(toDelete);
      }
    }

    res.json({ version: saved });
  } catch (err) {
    next(err);
  }
});