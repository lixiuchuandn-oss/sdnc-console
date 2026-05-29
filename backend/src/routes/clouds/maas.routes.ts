import { Router, Response, type RequestHandler } from 'express';
import { AppDataSource } from '../../config/database';
import { Cloud } from '../../entities/Cloud';
import { AuthRequest } from '../../middleware/auth';
import { buildMaasDashboard } from '../../services/clouds/maas/maasDashboard';
import {
  getMaasContext,
  getMaasMachine,
  getMaasMachineHardware,
  listMaasDiscoveries,
  listMaasEvents,
  listMaasMachines,
  listMaasSubnets,
  maasMachineOperation,
  maasDeleteMachine,
  maasCreateMachine,
  getMaasRegionStatus,
  type MaasMachineOp,
} from '../../services/clouds/maas/maasClient';
import {
  deleteMaasImageV2,
  getMaasImageV2,
  getMaasImagesSyncStatusV2,
  listMaasImagesV2,
  startMaasImagesSyncV2,
  stopMaasImagesSyncV2,
  type MaasImageGroup,
} from '../../services/clouds/maas/maasBootImages';

async function fetchMaasCloudOr404(id: string, res: Response): Promise<Cloud | null> {
  const cloud = await AppDataSource.getRepository(Cloud).findOne({ where: { id } });
  if (!cloud) {
    res.status(404).json({ message: '云资源不存在' });
    return null;
  }
  const provider = String(cloud.config?.provider || '').toLowerCase();
  if (provider !== 'maas') {
    res.status(400).json({ message: '仅 MAAS 裸金属资源池支持该接口' });
    return null;
  }
  return cloud;
}

function resolveMaasCtx(cloud: Cloud, res: Response) {
  const ctx = getMaasContext(cloud);
  if (!ctx) {
    res.status(400).json({ message: '缺少 MAAS Region 地址或 API Key' });
    return null;
  }
  return ctx;
}

const MACHINE_OPS: MaasMachineOp[] = [
  'commission',
  'deploy',
  'release',
  'power_on',
  'power_off',
  'power_cycle',
  'mark_broken',
  'mark_fixed',
  'abort',
];

export function attachMaasRoutes(router: Router, perm: RequestHandler): void {
  router.get('/:id/maas/dashboard', perm, async (req: AuthRequest, res: Response) => {
    try {
      const cloud = await fetchMaasCloudOr404(req.params.id, res);
      if (!cloud) return;
      const ctx = resolveMaasCtx(cloud, res);
      if (!ctx) return;
      const data = await buildMaasDashboard(ctx, {
        name: cloud.name || '',
        endpoint: String(cloud.endpoint || '').trim(),
      });
      if (!data.ok) {
        res.status(502).json({ message: data.message || '拉取概览失败', ...data });
        return;
      }
      const { ok: _ok, message, ...payload } = data;
      res.json({ ok: true, message, ...payload });
    } catch (err: unknown) {
      res.status(500).json({ message: err instanceof Error ? err.message : '服务器错误' });
    }
  });

  router.get('/:id/maas/machines', perm, async (req: AuthRequest, res: Response) => {
    try {
      const cloud = await fetchMaasCloudOr404(req.params.id, res);
      if (!cloud) return;
      const ctx = resolveMaasCtx(cloud, res);
      if (!ctx) return;
      const result = await listMaasMachines(ctx);
      if (!result.ok) {
        res.status(502).json({ message: result.message || '拉取机器列表失败' });
        return;
      }
      res.json({
        ok: true,
        apiVersion: 'v2',
        items: result.items,
        total: result.items.length,
      });
    } catch (err: unknown) {
      res.status(500).json({ message: err instanceof Error ? err.message : '服务器错误' });
    }
  });

  router.post('/:id/maas/machines', perm, async (req: AuthRequest, res: Response) => {
    try {
      const cloud = await fetchMaasCloudOr404(req.params.id, res);
      if (!cloud) return;
      const ctx = resolveMaasCtx(cloud, res);
      if (!ctx) return;
      const body = (req.body || {}) as Record<string, unknown>;
      const rawMacs = body.macAddresses ?? body.mac_addresses;
      const macAddresses = Array.isArray(rawMacs)
        ? rawMacs.map((m) => String(m))
        : String(rawMacs || '')
            .split(/[,\s]+/)
            .filter(Boolean);
      const powerParameters =
        body.powerParameters && typeof body.powerParameters === 'object'
          ? (body.powerParameters as Record<string, string>)
          : undefined;
      const result = await maasCreateMachine(ctx, {
        architecture: String(body.architecture || '').trim(),
        macAddresses,
        powerType: String(body.powerType || body.power_type || '').trim(),
        powerParameters,
        hostname: body.hostname != null ? String(body.hostname) : undefined,
        domain: body.domain != null ? String(body.domain) : undefined,
        zone: body.zone != null ? String(body.zone) : undefined,
        pool: body.pool != null ? String(body.pool) : undefined,
        commission: body.commission != null ? Boolean(body.commission) : undefined,
      });
      if (!result.ok) {
        res.status(result.message.includes('认证') ? 401 : 400).json({ message: result.message });
        return;
      }
      res.json({ ok: true, message: result.message, data: result.data });
    } catch (err: unknown) {
      res.status(500).json({ message: err instanceof Error ? err.message : '服务器错误' });
    }
  });

  router.get('/:id/maas/machines/:systemId', perm, async (req: AuthRequest, res: Response) => {
    try {
      const cloud = await fetchMaasCloudOr404(req.params.id, res);
      if (!cloud) return;
      const ctx = resolveMaasCtx(cloud, res);
      if (!ctx) return;
      const [detail, hw] = await Promise.all([
        getMaasMachine(ctx, req.params.systemId),
        getMaasMachineHardware(ctx, req.params.systemId),
      ]);
      if (!detail.ok) {
        res.status(502).json({ message: detail.message || '拉取机器详情失败' });
        return;
      }
      res.json({
        ok: true,
        machine: detail.machine,
        blockdevices: hw.blockdevices,
        interfaces: hw.interfaces,
      });
    } catch (err: unknown) {
      res.status(500).json({ message: err instanceof Error ? err.message : '服务器错误' });
    }
  });

  router.post('/:id/maas/machines/:systemId/:op', perm, async (req: AuthRequest, res: Response) => {
    try {
      const op = String(req.params.op || '').trim() as MaasMachineOp;
      if (!MACHINE_OPS.includes(op)) {
        res.status(400).json({ message: `不支持的操作：${op}` });
        return;
      }
      const cloud = await fetchMaasCloudOr404(req.params.id, res);
      if (!cloud) return;
      const ctx = resolveMaasCtx(cloud, res);
      if (!ctx) return;
      const body = (req.body || {}) as Record<string, unknown>;
      const form: Record<string, string> = {};
      for (const [k, v] of Object.entries(body)) {
        if (v != null && String(v).trim() !== '') {
          form[k] = String(v).trim();
        }
      }
      const result = await maasMachineOperation(ctx, req.params.systemId, op, form);
      if (!result.ok) {
        res.status(result.message.includes('认证') ? 401 : 409).json({ message: result.message });
        return;
      }
      res.json({ ok: true, message: result.message, data: result.data });
    } catch (err: unknown) {
      res.status(500).json({ message: err instanceof Error ? err.message : '服务器错误' });
    }
  });

  router.delete('/:id/maas/machines/:systemId', perm, async (req: AuthRequest, res: Response) => {
    try {
      const cloud = await fetchMaasCloudOr404(req.params.id, res);
      if (!cloud) return;
      const ctx = resolveMaasCtx(cloud, res);
      if (!ctx) return;
      const result = await maasDeleteMachine(ctx, req.params.systemId);
      if (!result.ok) {
        res.status(result.message.includes('认证') ? 401 : 409).json({ message: result.message });
        return;
      }
      res.json({ ok: true, message: result.message });
    } catch (err: unknown) {
      res.status(500).json({ message: err instanceof Error ? err.message : '服务器错误' });
    }
  });

  router.get('/:id/maas/discoveries', perm, async (req: AuthRequest, res: Response) => {
    try {
      const cloud = await fetchMaasCloudOr404(req.params.id, res);
      if (!cloud) return;
      const ctx = resolveMaasCtx(cloud, res);
      if (!ctx) return;
      const result = await listMaasDiscoveries(ctx);
      if (!result.ok) {
        res.status(502).json({ message: result.message || '拉取网络发现失败' });
        return;
      }
      res.json({
        ok: true,
        apiVersion: result.apiVersion,
        items: result.items,
        total: result.items.length,
      });
    } catch (err: unknown) {
      res.status(500).json({ message: err instanceof Error ? err.message : '服务器错误' });
    }
  });

  router.get('/:id/maas/events', perm, async (req: AuthRequest, res: Response) => {
    try {
      const cloud = await fetchMaasCloudOr404(req.params.id, res);
      if (!cloud) return;
      const ctx = resolveMaasCtx(cloud, res);
      if (!ctx) return;
      const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50));
      const result = await listMaasEvents(ctx, limit);
      if (!result.ok) {
        res.status(502).json({ message: result.message || '拉取事件失败' });
        return;
      }
      res.json({ ok: true, items: result.items, total: result.items.length });
    } catch (err: unknown) {
      res.status(500).json({ message: err instanceof Error ? err.message : '服务器错误' });
    }
  });

  router.get('/:id/maas/images/sync/status', perm, async (req: AuthRequest, res: Response) => {
    try {
      const cloud = await fetchMaasCloudOr404(req.params.id, res);
      if (!cloud) return;
      const ctx = resolveMaasCtx(cloud, res);
      if (!ctx) return;
      const result = await getMaasImagesSyncStatusV2(ctx);
      if (!result.ok) {
        res.status(502).json({ message: result.message || '查询同步状态失败' });
        return;
      }
      res.json({ ok: true, is_importing: result.is_importing });
    } catch (err: unknown) {
      res.status(500).json({ message: err instanceof Error ? err.message : '服务器错误' });
    }
  });

  router.post('/:id/maas/images/sync', perm, async (req: AuthRequest, res: Response) => {
    try {
      const cloud = await fetchMaasCloudOr404(req.params.id, res);
      if (!cloud) return;
      const ctx = resolveMaasCtx(cloud, res);
      if (!ctx) return;
      const result = await startMaasImagesSyncV2(ctx);
      if (!result.ok) {
        res.status(result.message.includes('已在运行') ? 409 : 502).json({ message: result.message });
        return;
      }
      res.json({ ok: true, message: result.message });
    } catch (err: unknown) {
      res.status(500).json({ message: err instanceof Error ? err.message : '服务器错误' });
    }
  });

  router.post('/:id/maas/images/sync/stop', perm, async (req: AuthRequest, res: Response) => {
    try {
      const cloud = await fetchMaasCloudOr404(req.params.id, res);
      if (!cloud) return;
      const ctx = resolveMaasCtx(cloud, res);
      if (!ctx) return;
      const result = await stopMaasImagesSyncV2(ctx);
      if (!result.ok) {
        res.status(502).json({ message: result.message });
        return;
      }
      res.json({ ok: true, message: result.message });
    } catch (err: unknown) {
      res.status(500).json({ message: err instanceof Error ? err.message : '服务器错误' });
    }
  });

  router.get('/:id/maas/images', perm, async (req: AuthRequest, res: Response) => {
    try {
      const cloud = await fetchMaasCloudOr404(req.params.id, res);
      if (!cloud) return;
      const ctx = resolveMaasCtx(cloud, res);
      if (!ctx) return;
      const deployable = String(req.query.deployable || '').toLowerCase() === 'true';
      const result = await listMaasImagesV2(ctx);
      if (!result.ok) {
        res.status(502).json({ message: result.message || '拉取镜像失败' });
        return;
      }
      let items: MaasImageGroup[] = result.items;
      if (deployable) {
        items = items.filter((i) => i.deployable);
      }
      res.json({ ok: true, items, total: items.length, apiVersion: 'v2', view: 'grouped' });
    } catch (err: unknown) {
      res.status(500).json({ message: err instanceof Error ? err.message : '服务器错误' });
    }
  });

  router.get('/:id/maas/images/:imageId', perm, async (req: AuthRequest, res: Response) => {
    try {
      const cloud = await fetchMaasCloudOr404(req.params.id, res);
      if (!cloud) return;
      const ctx = resolveMaasCtx(cloud, res);
      if (!ctx) return;
      const result = await getMaasImageV2(ctx, req.params.imageId);
      if (!result.ok) {
        res.status(502).json({ message: result.message || '拉取镜像详情失败' });
        return;
      }
      res.json({ ok: true, item: result.item });
    } catch (err: unknown) {
      res.status(500).json({ message: err instanceof Error ? err.message : '服务器错误' });
    }
  });

  router.delete('/:id/maas/images/:imageId', perm, async (req: AuthRequest, res: Response) => {
    try {
      const cloud = await fetchMaasCloudOr404(req.params.id, res);
      if (!cloud) return;
      const ctx = resolveMaasCtx(cloud, res);
      if (!ctx) return;
      const result = await deleteMaasImageV2(ctx, req.params.imageId);
      if (!result.ok) {
        res.status(result.message.includes('使用中') ? 409 : 502).json({ message: result.message });
        return;
      }
      res.json({ ok: true, message: result.message });
    } catch (err: unknown) {
      res.status(500).json({ message: err instanceof Error ? err.message : '服务器错误' });
    }
  });

  /** @deprecated 使用 GET /maas/images */
  router.get('/:id/maas/boot-resources', perm, async (req: AuthRequest, res: Response) => {
    try {
      const cloud = await fetchMaasCloudOr404(req.params.id, res);
      if (!cloud) return;
      const ctx = resolveMaasCtx(cloud, res);
      if (!ctx) return;
      const result = await listMaasImagesV2(ctx);
      if (!result.ok) {
        res.status(502).json({ message: result.message || '拉取镜像失败' });
        return;
      }
      res.json({ ok: true, items: result.items, total: result.items.length, apiVersion: 'v2' });
    } catch (err: unknown) {
      res.status(500).json({ message: err instanceof Error ? err.message : '服务器错误' });
    }
  });

  router.get('/:id/maas/region', perm, async (req: AuthRequest, res: Response) => {
    try {
      const cloud = await fetchMaasCloudOr404(req.params.id, res);
      if (!cloud) return;
      const ctx = resolveMaasCtx(cloud, res);
      if (!ctx) return;
      const data = await getMaasRegionStatus(ctx);
      if (!data.ok) {
        res.status(502).json({ message: data.message || '拉取 Region 状态失败' });
        return;
      }
      const { ok: _ok, message, partialErrors, ...payload } = data;
      res.json({ ok: true, message, partialErrors, ...payload });
    } catch (err: unknown) {
      res.status(500).json({ message: err instanceof Error ? err.message : '服务器错误' });
    }
  });

  router.get('/:id/maas/network', perm, async (req: AuthRequest, res: Response) => {
    try {
      const cloud = await fetchMaasCloudOr404(req.params.id, res);
      if (!cloud) return;
      const ctx = resolveMaasCtx(cloud, res);
      if (!ctx) return;
      const result = await listMaasSubnets(ctx);
      if (!result.ok) {
        res.status(502).json({ message: result.message || '拉取网络资源失败' });
        return;
      }
      res.json({
        ok: true,
        subnets: result.subnets,
        vlans: result.vlans,
      });
    } catch (err: unknown) {
      res.status(500).json({ message: err instanceof Error ? err.message : '服务器错误' });
    }
  });
}
