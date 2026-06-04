import { Router, Request, Response } from 'express';
import { In } from 'typeorm';
import { AppDataSource } from '../../config/database';
import { SRv6Tunnel, SRv6Status } from '../../entities/vRouter/SRv6Tunnel';
import { VRConfig } from '../../entities/vRouter/VRConfig';
import { vrController } from '../../services/vrouter/vrController';
import {
  buildEndpointFingerprintFromRows,
  mergeArchiveIntoTunnel,
  parseSrv6ArchiveFromBody,
  validateTunnelArchiveRequired,
} from './srv6.archive';
import { deleteSrv6TunnelWithRevert } from './srv6.delete';
import {
  hasSrv6EndpointConflict,
  hasSrv6NameConflict,
  normalizeSrv6TunnelPayload,
  validateSrv6VrEndpointsForCreate,
} from './srv6.validation';

export const srv6Routes = Router();
const repo = () => AppDataSource.getRepository(SRv6Tunnel);
const vrConfigRepo = () => AppDataSource.getRepository(VRConfig);

/** 与 IPsec deploy 一致：去掉包装字段后再下发 CSMctl */
const stripMeta = (obj: any) => {
  if (!obj || typeof obj !== 'object') return obj;
  const {
    msg: _msg,
    code: _code,
    report_config_status: _report_config_status,
    updateDate: _updateDate,
    createDate: _createDate,
    _id,
    requestId: _requestId,
    ...rest
  } = obj;
  return rest;
};

const sanitizeConfig = (config: any) => {
  if (!config) return config;
  if (config.ipv4_route) {
    if (!Array.isArray(config.ipv4_route) || config.ipv4_route.length === 0) {
      delete config.ipv4_route;
    } else {
      const validRoutes = config.ipv4_route.filter(
        (r: any) => r && typeof r.destination === 'string' && r.destination.trim() !== '',
      );
      if (validRoutes.length === 0) {
        delete config.ipv4_route;
      } else {
        config.ipv4_route = validRoutes.map((r: any) => {
          const dest = r.destination.trim();
          if (dest && !dest.includes('/') && /^(?:[0-9]{1,3}\.){3}[0-9]{1,3}$/.test(dest)) {
            return { ...r, destination: `${dest}/32` };
          }
          return r;
        });
      }
    }
  }
  return config;
};

const applyArchiveToTunnelEntity = (
  entity: SRv6Tunnel,
  body: unknown,
  vrRows: { uuid: string; role?: string | null; config_json?: string | null }[],
  endpoints: { peA: string; peB: string; ceA: string; ceB: string },
) => {
  const parsed = parseSrv6ArchiveFromBody(body);
  if (!parsed.ok) return parsed;

  let fingerprint = parsed.archive.endpointFingerprint;
  if (!fingerprint) {
    fingerprint = buildEndpointFingerprintFromRows(endpoints, vrRows, {
      peAInnerIf: parsed.archive.peAInnerIf || undefined,
      peBInnerIf: parsed.archive.peBInnerIf || undefined,
    });
  }
  mergeArchiveIntoTunnel(entity, {
    ...parsed.archive,
    endpointFingerprint: fingerprint ?? parsed.archive.endpointFingerprint,
  });
  return { ok: true as const };
};

// 列表：获取所有 SRv6 隧道
srv6Routes.get('/', async (req, res, next) => {
  try {
    {
      const role = (req as any).user?.role;
      const perms: string[] = Array.isArray((req as any).user?.permissions)
        ? (req as any).user?.permissions
        : [];
      if (
        !(
          role === 'super_admin' ||
          perms.includes('networks.srv6:read') ||
          perms.includes('networks.srv6:write')
        )
      ) {
        return res.status(403).json({ message: '权限不足：需要读取权限 networks.srv6:read' });
      }
    }
    const list = await repo().find({ order: { createdAt: 'DESC' } });
    res.json(list);
  } catch (e) {
    next(e);
  }
});

// 创建：新增 SRv6 隧道（初始状态为 creating）
srv6Routes.post('/', async (req, res, next) => {
  try {
    {
      const role = (req as any).user?.role;
      const perms: string[] = Array.isArray((req as any).user?.permissions)
        ? (req as any).user?.permissions
        : [];
      if (!(role === 'super_admin' || perms.includes('networks.srv6:write'))) {
        return res.status(403).json({ message: '权限不足：需要写入权限 networks.srv6:write' });
      }
    }
    const normalized = normalizeSrv6TunnelPayload(req.body);
    if (!normalized.ok) {
      res.status(400).json({ message: normalized.message });
      return;
    }

    const existing = await repo().find();
    if (hasSrv6NameConflict(existing, normalized.value.name)) {
      res.status(409).json({ message: `已存在同名 SRv6 隧道：${normalized.value.name}` });
      return;
    }
    if (hasSrv6EndpointConflict(existing, normalized.value)) {
      res.status(409).json({ message: '已存在相同 PE/CE 端点组合的 SRv6 隧道' });
      return;
    }

    const endpointIds = [
      normalized.value.peA,
      normalized.value.peB,
      normalized.value.ceA,
      normalized.value.ceB,
    ];
    const vrRows = await vrConfigRepo().find({ where: { uuid: In(endpointIds) } });
    const vrCheck = validateSrv6VrEndpointsForCreate(normalized.value, vrRows);
    if (!vrCheck.ok) {
      res.status(400).json({ message: vrCheck.message });
      return;
    }

    const item = repo().create({
      ...normalized.value,
      status: SRv6Status.CREATING,
    });
    const archiveApplied = applyArchiveToTunnelEntity(item, req.body, vrRows, normalized.value);
    if (!archiveApplied.ok) {
      res.status(400).json({ message: archiveApplied.message });
      return;
    }
    const archiveCheck = validateTunnelArchiveRequired(item);
    if (!archiveCheck.ok) {
      res.status(400).json({ message: archiveCheck.message });
      return;
    }

    const saved = await repo().save(item);
    // 模拟异步完成：短暂延迟后置为 available
    setTimeout(async () => {
      try {
        await repo().update({ id: saved.id }, { status: SRv6Status.AVAILABLE });
      } catch (e) {
        // ignore
      }
    }, 1000);
    res.status(201).json(saved);
  } catch (e) {
    next(e);
  }
});

// 更新：编辑 SRv6 隧道基础关系（不在此阶段做 PE/CE 配置完整性校验）
srv6Routes.put('/:id', async (req, res, next) => {
  try {
    {
      const role = (req as any).user?.role;
      const perms: string[] = Array.isArray((req as any).user?.permissions)
        ? (req as any).user?.permissions
        : [];
      if (!(role === 'super_admin' || perms.includes('networks.srv6:write'))) {
        return res.status(403).json({ message: '权限不足：需要写入权限 networks.srv6:write' });
      }
    }
    const id = String(req.params.id);
    const current = await repo().findOne({ where: { id } });
    if (!current) {
      res.status(404).json({ message: '未找到隧道' });
      return;
    }

    const normalized = normalizeSrv6TunnelPayload(req.body);
    if (!normalized.ok) {
      res.status(400).json({ message: normalized.message });
      return;
    }

    const existing = await repo().find();
    if (hasSrv6NameConflict(existing, normalized.value.name, id)) {
      res.status(409).json({ message: `已存在同名 SRv6 隧道：${normalized.value.name}` });
      return;
    }
    if (hasSrv6EndpointConflict(existing, normalized.value, id)) {
      res.status(409).json({ message: '已存在相同 PE/CE 端点组合的 SRv6 隧道' });
      return;
    }

    repo().merge(current, normalized.value);
    const vrRows = await vrConfigRepo().find({
      where: {
        uuid: In([
          normalized.value.peA,
          normalized.value.peB,
          normalized.value.ceA,
          normalized.value.ceB,
        ]),
      },
    });
    const archiveApplied = applyArchiveToTunnelEntity(
      current,
      req.body,
      vrRows,
      normalized.value,
    );
    if (!archiveApplied.ok) {
      res.status(400).json({ message: archiveApplied.message });
      return;
    }

    const archiveCheck = validateTunnelArchiveRequired(current);
    if (!archiveCheck.ok) {
      res.status(400).json({ message: archiveCheck.message });
      return;
    }

    const saved = await repo().save(current);
    res.json(saved);
  } catch (e) {
    next(e);
  }
});

/** 与 IPsec deploy/preview 一致：展示即将下发到设备的配置（库中 JSON 经 stripMeta + sanitize） */
srv6Routes.get('/deploy/preview', async (req: Request, res: Response) => {
  try {
    {
      const role = (req as any).user?.role;
      const perms: string[] = Array.isArray((req as any).user?.permissions)
        ? (req as any).user?.permissions
        : [];
      if (
        !(
          role === 'super_admin' ||
          perms.includes('networks.srv6:read') ||
          perms.includes('networks.srv6:write')
        )
      ) {
        return res.status(403).json({ message: '权限不足：需要读取权限 networks.srv6:read' });
      }
    }
    const vrId = typeof req.query.vrId === 'string' ? req.query.vrId : '';
    if (!vrId) {
      res.status(400).json({ error: 'Missing vrId' });
      return;
    }

    const record = await vrConfigRepo().findOne({ where: { uuid: vrId } });
    if (!record || !record.config_json) {
      res.status(404).json({ error: 'VR config not found in DB' });
      return;
    }

    const config = JSON.parse(record.config_json);
    const cleanConfig = sanitizeConfig(stripMeta(config));
    res.json({ config: cleanConfig });
  } catch (e: any) {
    console.error('[SRV6] deploy/preview failed', e);
    res.status(500).json({ error: e.message || String(e) });
  }
});

/**
 * 将平台库中的 VR 配置推送到 CSMctl（与 /api/networks/ipsec/deploy/push 同源路径：读 VRConfig → 清洗 → vrController.updateVRConfig）
 */
srv6Routes.post('/deploy/push', async (req: Request, res: Response) => {
  try {
    {
      const role = (req as any).user?.role;
      const perms: string[] = Array.isArray((req as any).user?.permissions)
        ? (req as any).user?.permissions
        : [];
      if (!(role === 'super_admin' || perms.includes('networks.srv6:write'))) {
        return res.status(403).json({ message: '权限不足：需要写入权限 networks.srv6:write' });
      }
    }
    const { vrId } = req.body || {};
    if (!vrId || typeof vrId !== 'string') {
      res.status(400).json({ error: 'Missing vrId' });
      return;
    }

    const record = await vrConfigRepo().findOne({ where: { uuid: vrId } });
    if (!record || !record.config_json) {
      res.status(404).json({ error: 'VR config not found in DB' });
      return;
    }

    const config = JSON.parse(record.config_json);
    const cleanConfig = sanitizeConfig(stripMeta(config));
    console.log(`[SRV6] Pushing VR config to CSMctl: ${vrId}`);

    const updateResp = await vrController.updateVRConfig(vrId, cleanConfig);
    const respData = updateResp.data || {};

    if (
      respData &&
      typeof respData.code !== 'undefined' &&
      respData.code != 0 &&
      respData.code != 200
    ) {
      throw new Error(
        `Device returned error: ${respData.msg || respData.message || JSON.stringify(respData)}`,
      );
    }

    res.json({ status: 200, data: respData });
  } catch (e: any) {
    console.error('[SRV6] deploy/push failed', e);
    res.status(500).json({ error: e.message || String(e) });
  }
});

// 获取单条：根据 ID 获取隧道详情
srv6Routes.get('/:id', async (req, res, next) => {
  try {
    {
      const role = (req as any).user?.role;
      const perms: string[] = Array.isArray((req as any).user?.permissions)
        ? (req as any).user?.permissions
        : [];
      if (
        !(
          role === 'super_admin' ||
          perms.includes('networks.srv6:read') ||
          perms.includes('networks.srv6:write')
        )
      ) {
        return res.status(403).json({ message: '权限不足：需要读取权限 networks.srv6:read' });
      }
    }
    const id = String(req.params.id);
    const item = await repo().findOne({ where: { id } });
    if (!item) {
      res.status(404).json({ message: '未找到隧道' });
      return;
    }
    res.json(item);
  } catch (e) {
    next(e);
  }
});

// 删除：默认回退平台库并 push 设备（revertPlatform=0 / revertDevice=0 可显式关闭）
srv6Routes.delete('/:id', async (req, res, next) => {
  try {
    {
      const role = (req as any).user?.role;
      const perms: string[] = Array.isArray((req as any).user?.permissions)
        ? (req as any).user?.permissions
        : [];
      if (!(role === 'super_admin' || perms.includes('networks.srv6:write'))) {
        return res.status(403).json({ message: '权限不足：需要写入权限 networks.srv6:write' });
      }
    }
    const id = String(req.params.id);
    const item = await repo().findOne({ where: { id } });
    if (!item) {
      res.status(404).json({ message: '未找到隧道' });
      return;
    }

    const q = req.query;
    const revertPlatform = q.revertPlatform !== '0' && q.revertPlatform !== 'false';
    const revertDevice = q.revertDevice !== '0' && q.revertDevice !== 'false';

    try {
      const result = await deleteSrv6TunnelWithRevert(item, { revertPlatform, revertDevice });
      res.json({ success: true, ...result });
    } catch (e: any) {
      const code = e?.statusCode === 400 || e?.statusCode === 409 ? e.statusCode : 500;
      res.status(code).json({
        message: e?.message || '删除失败',
        warnings: e?.warnings,
      });
    }
  } catch (e) {
    next(e);
  }
});

export default srv6Routes;
