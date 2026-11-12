import { Router } from 'express';
import {
  IbrHaGroupError,
  ibrHaGroupService,
} from '../../services/vrouter/ibrHaGroupService';

export const ibrHaGroupRoutes = Router();

/** HA 组挂在 IBR 配置权限下（与前端列表/RouteSpec 一致） */
function hasRead(req: import('express').Request) {
  const role = (req as any).user?.role;
  const perms: string[] = Array.isArray((req as any).user?.permissions)
    ? (req as any).user?.permissions
    : [];
  return (
    role === 'super_admin' ||
    perms.includes('networks.vr-config:read') ||
    perms.includes('networks.vr-config:write')
  );
}

function hasWrite(req: import('express').Request) {
  const role = (req as any).user?.role;
  const perms: string[] = Array.isArray((req as any).user?.permissions)
    ? (req as any).user?.permissions
    : [];
  return role === 'super_admin' || perms.includes('networks.vr-config:write');
}

function mapError(res: import('express').Response, err: unknown) {
  if (err instanceof IbrHaGroupError) {
    return res.status(err.statusCode).json({ code: err.statusCode, message: err.message });
  }
  const message = err instanceof Error ? err.message : String(err);
  return res.status(500).json({ code: 500, message });
}

ibrHaGroupRoutes.get('/', async (req, res) => {
  if (!hasRead(req)) {
    return res.status(403).json({ message: '权限不足：需要 networks.vr-config:read' });
  }
  try {
    const data = await ibrHaGroupService.list();
    return res.json({ code: 200, msg: 'ok', data });
  } catch (err) {
    return mapError(res, err);
  }
});

ibrHaGroupRoutes.post('/', async (req, res) => {
  if (!hasWrite(req)) {
    return res.status(403).json({ message: '权限不足：需要 networks.vr-config:write' });
  }
  try {
    const body = req.body ?? {};
    const result = await ibrHaGroupService.create({
      name: body.name,
      description: body.description,
      primaryUuid: body.primaryUuid,
      backupUuid: body.backupUuid,
      vrrpIntent: body.vrrpIntent,
    });
    return res.status(201).json({
      code: 201,
      msg: 'ok',
      data: result.group,
      warnings: result.warnings,
    });
  } catch (err) {
    return mapError(res, err);
  }
});

/** 预览某节点将写入的 VRRP 组装片（默认同设备底稿合并）；须挂在 /:id 之前 */
ibrHaGroupRoutes.get('/:id/deploy/preview', async (req, res) => {
  if (!hasRead(req)) {
    return res.status(403).json({ message: '权限不足：需要 networks.vr-config:read' });
  }
  try {
    const roleRaw = String(req.query.role || '').trim();
    if (roleRaw !== 'primary' && roleRaw !== 'backup') {
      return res.status(400).json({ code: 400, message: 'role 须为 primary 或 backup' });
    }
    const mergeRaw = String(req.query.merge ?? '1').trim().toLowerCase();
    const mergeDevice = mergeRaw !== '0' && mergeRaw !== 'false' && mergeRaw !== 'no';
    const data = await ibrHaGroupService.preview(String(req.params.id || '').trim(), roleRaw, {
      mergeDevice,
    });
    return res.json({ code: 200, msg: 'ok', data });
  } catch (err) {
    return mapError(res, err);
  }
});

/** 将 vrrpIntent 下发至主备 IBR（读设备 → 定点 merge → 全量 POST）；body.role 可只推一端 */
ibrHaGroupRoutes.post('/:id/deploy', async (req, res) => {
  if (!hasWrite(req)) {
    return res.status(403).json({ message: '权限不足：需要 networks.vr-config:write' });
  }
  try {
    const roleRaw = String(req.body?.role || '').trim();
    const role = roleRaw === 'primary' || roleRaw === 'backup' ? roleRaw : undefined;
    const data = await ibrHaGroupService.deploy(String(req.params.id || '').trim(), { role });
    return res.json({ code: 200, msg: 'ok', data });
  } catch (err) {
    return mapError(res, err);
  }
});

ibrHaGroupRoutes.get('/:id', async (req, res) => {
  if (!hasRead(req)) {
    return res.status(403).json({ message: '权限不足：需要 networks.vr-config:read' });
  }
  try {
    const data = await ibrHaGroupService.getById(String(req.params.id || '').trim());
    return res.json({ code: 200, msg: 'ok', data });
  } catch (err) {
    return mapError(res, err);
  }
});

ibrHaGroupRoutes.patch('/:id', async (req, res) => {
  if (!hasWrite(req)) {
    return res.status(403).json({ message: '权限不足：需要 networks.vr-config:write' });
  }
  try {
    const data = await ibrHaGroupService.update(String(req.params.id || '').trim(), {
      name: req.body?.name,
      description: req.body?.description,
      vrrpIntent: req.body?.vrrpIntent,
    });
    return res.json({ code: 200, msg: 'ok', data });
  } catch (err) {
    return mapError(res, err);
  }
});

ibrHaGroupRoutes.put('/:id/members', async (req, res) => {
  if (!hasWrite(req)) {
    return res.status(403).json({ message: '权限不足：需要 networks.vr-config:write' });
  }
  try {
    const result = await ibrHaGroupService.replaceMembers(String(req.params.id || '').trim(), {
      primaryUuid: req.body?.primaryUuid,
      backupUuid: req.body?.backupUuid,
    });
    return res.json({
      code: 200,
      msg: 'ok',
      data: result.group,
      warnings: result.warnings,
    });
  } catch (err) {
    return mapError(res, err);
  }
});

ibrHaGroupRoutes.delete('/:id', async (req, res) => {
  if (!hasWrite(req)) {
    return res.status(403).json({ message: '权限不足：需要 networks.vr-config:write' });
  }
  try {
    const revertRaw = String(req.query.revertDevice ?? '').trim().toLowerCase();
    const revertDevice = revertRaw === '1' || revertRaw === 'true' || revertRaw === 'yes';
    await ibrHaGroupService.remove(String(req.params.id || '').trim(), { revertDevice });
    return res.json({ code: 200, msg: 'ok' });
  } catch (err) {
    return mapError(res, err);
  }
});
