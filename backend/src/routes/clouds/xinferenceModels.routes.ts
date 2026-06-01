import { Router, Response, type RequestHandler } from 'express';
import { AppDataSource } from '../../config/database';
import { Cloud } from '../../entities/Cloud';
import { AuthRequest } from '../../middleware/auth';
import { logger } from '../../utils/logger';
import {
  getXinferenceContext,
  normalizeModelInstances,
  normalizeModelRegistrations,
  normalizeModelReplicas,
  normalizeRunningModels,
  xinferenceDelete,
  xinferenceGet,
  xinferencePost,
} from '../../services/clouds/xinference/xinferenceClient';

const log = logger.child('XinferenceModels');

async function fetchXinferenceCloudOr404(id: string, res: Response): Promise<Cloud | null> {
  const cloud = await AppDataSource.getRepository(Cloud).findOne({ where: { id } });
  if (!cloud) {
    res.status(404).json({ message: '云资源不存在' });
    return null;
  }
  const provider = String(cloud.config?.provider || '').toLowerCase();
  if (provider !== 'xinference') {
    res.status(400).json({ message: '仅 Xinference 资源池支持该接口' });
    return null;
  }
  return cloud;
}

function xinferenceCtxOr400(cloud: Cloud, res: Response) {
  const ctx = getXinferenceContext(cloud);
  if (!ctx) {
    res.status(400).json({ message: '缺少 Xinference 服务地址' });
    return null;
  }
  return ctx;
}

/**
 * Xinference 模型：运行列表、注册表、启动、停止。
 */
export function attachXinferenceModelsRoutes(router: Router, perm: RequestHandler): void {
  router.get('/:id/xinference/models', perm, async (req: AuthRequest, res: Response) => {
    try {
      const cloud = await fetchXinferenceCloudOr404(req.params.id, res);
      if (!cloud) return;
      const ctx = xinferenceCtxOr400(cloud, res);
      if (!ctx) return;

      const r = await xinferenceGet(ctx, '/v1/models', { timeout: 15_000 });
      if (!r.ok) {
        if (r.status === 401) {
          res.status(401).json({ message: r.message || 'Xinference 认证失败' });
          return;
        }
        res.json({
          models: [],
          degraded: true,
          message: r.message || '运行模型列表暂时不可用（集群可能正在加载模型），请稍后刷新',
        });
        return;
      }
      res.json({ models: normalizeRunningModels(r.data) });
    } catch (error: any) {
      log.error('list models failed', error?.message ?? String(error));
      res.status(500).json({ message: error?.message || '拉取运行中模型失败' });
    }
  });

  router.get('/:id/xinference/models/instances', perm, async (req: AuthRequest, res: Response) => {
    try {
      const cloud = await fetchXinferenceCloudOr404(req.params.id, res);
      if (!cloud) return;
      const ctx = xinferenceCtxOr400(cloud, res);
      if (!ctx) return;

      const r = await xinferenceGet(ctx, '/v1/models/instances', { timeout: 15_000 });
      if (!r.ok) {
        if (r.status === 404) {
          res.json({
            instances: [],
            degraded: true,
            message: '当前 Xinference 版本不支持 /v1/models/instances',
          });
          return;
        }
        if (r.status === 401) {
          res.status(401).json({ message: r.message || 'Xinference 认证失败' });
          return;
        }
        res.status(r.status >= 400 && r.status < 600 ? r.status : 502).json({
          message: r.message || '拉取模型实例列表失败',
        });
        return;
      }
      res.json({ instances: normalizeModelInstances(r.data) });
    } catch (error: any) {
      log.error('list model instances failed', error?.message ?? String(error));
      res.status(500).json({ message: error?.message || '拉取模型实例列表失败' });
    }
  });

  /**
   * DELETE /v1/models/instances/{model_uid}
   * 清理 status_guard 中的僵尸实例元数据（ERROR/CREATING 等，且未在运行列表中）。
   * 仍在跑的模型须先 DELETE /v1/models/{model_uid}（terminate）。
   */
  router.delete(
    '/:id/xinference/models/instances/:modelUid',
    perm,
    async (req: AuthRequest, res: Response) => {
      try {
        const cloud = await fetchXinferenceCloudOr404(req.params.id, res);
        if (!cloud) return;
        const ctx = xinferenceCtxOr400(cloud, res);
        if (!ctx) return;

        const modelUid = String(req.params.modelUid || '').trim();
        if (!modelUid) {
          res.status(400).json({ message: '缺少 modelUid' });
          return;
        }

        const r = await xinferenceDelete(
          ctx,
          `/v1/models/instances/${encodeURIComponent(modelUid)}`,
          { timeout: 120000 },
        );
        if (!r.ok) {
          const detail = String(r.message || '').trim();
          const stillRunning = /still registered as running|still running/i.test(detail);
          const notFound = /no instance metadata found/i.test(detail);
          if (r.status === 404 || notFound) {
            res.status(404).json({
              message: detail || '未找到该 model_uid 的实例元数据',
              hint: '请核对 UID 或刷新列表确认是否已清理',
            });
            return;
          }
          if (r.status === 400 && stillRunning) {
            res.status(400).json({
              message: detail || '模型仍在运行',
              hint: '请先在运行模型列表点击「终止」，再清理实例记录',
            });
            return;
          }
          res.status(r.status >= 400 && r.status < 600 ? r.status : 502).json({
            message: detail || '清理实例元数据失败',
          });
          return;
        }
        const removed = r.data?.removed === true;
        res.json({
          ok: true,
          modelUid: String(r.data?.model_uid ?? modelUid),
          removed,
          raw: r.data,
        });
      } catch (error: any) {
        log.error('remove instance metadata failed', error?.message ?? String(error));
        res.status(500).json({ message: error?.message || '清理实例元数据失败' });
      }
    },
  );

  router.get(
    '/:id/xinference/models/:modelUid/replicas',
    perm,
    async (req: AuthRequest, res: Response) => {
      try {
        const cloud = await fetchXinferenceCloudOr404(req.params.id, res);
        if (!cloud) return;
        const ctx = xinferenceCtxOr400(cloud, res);
        if (!ctx) return;

        const modelUid = String(req.params.modelUid || '').trim();
        if (!modelUid) {
          res.status(400).json({ message: '缺少 modelUid' });
          return;
        }

        const r = await xinferenceGet(ctx, `/v1/models/${encodeURIComponent(modelUid)}/replicas`, {
          timeout: 15_000,
        });
        if (!r.ok) {
          res.status(r.status >= 400 && r.status < 600 ? r.status : 502).json({
            message: r.message || '拉取副本状态失败',
          });
          return;
        }
        res.json({ replicas: normalizeModelReplicas(r.data) });
      } catch (error: any) {
        log.error('list model replicas failed', error?.message ?? String(error));
        res.status(500).json({ message: error?.message || '拉取副本状态失败' });
      }
    },
  );

  router.get(
    '/:id/xinference/model-registrations',
    perm,
    async (req: AuthRequest, res: Response) => {
      try {
        const cloud = await fetchXinferenceCloudOr404(req.params.id, res);
        if (!cloud) return;
        const ctx = xinferenceCtxOr400(cloud, res);
        if (!ctx) return;

        const modelType = String(req.query.modelType || 'LLM').trim() || 'LLM';
        const detailed = String(req.query.detailed || '').toLowerCase() === 'true';
        const q = detailed ? '?detailed=true' : '';
        const r = await xinferenceGet(
          ctx,
          `/v1/model_registrations/${encodeURIComponent(modelType)}${q}`,
          {
            // detailed 会拉取完整规格，LLM 注册表在冷启动或模型多时可能超过 30s
            timeout: detailed ? 180_000 : 45_000,
          },
        );
        if (!r.ok) {
          const isTimeout =
            r.status === 0 &&
            String(r.message || '')
              .toLowerCase()
              .includes('timeout');
          res.status(r.status === 401 ? 401 : isTimeout ? 504 : 502).json({
            message: isTimeout
              ? '拉取模型注册表超时：Xinference 仍在扫描模型列表，请稍后点击「更新」重试'
              : r.message || '拉取可启动模型列表失败',
          });
          return;
        }
        res.json({
          modelType,
          registrations: normalizeModelRegistrations(r.data),
          raw: r.data,
        });
      } catch (error: any) {
        log.error('list registrations failed', error?.message ?? String(error));
        res.status(500).json({ message: error?.message || '拉取可启动模型列表失败' });
      }
    },
  );

  router.post(
    '/:id/xinference/model-registrations/:modelType',
    perm,
    async (req: AuthRequest, res: Response) => {
      try {
        const cloud = await fetchXinferenceCloudOr404(req.params.id, res);
        if (!cloud) return;
        const ctx = xinferenceCtxOr400(cloud, res);
        if (!ctx) return;

        const modelType = String(req.params.modelType || 'LLM').trim() || 'LLM';
        const body = req.body && typeof req.body === 'object' ? req.body : {};
        const persist = body.persist === true || body.persist === 'true';
        const workerIp =
          body.worker_ip != null && String(body.worker_ip).trim()
            ? String(body.worker_ip).trim()
            : body.workerIp != null && String(body.workerIp).trim()
              ? String(body.workerIp).trim()
              : undefined;

        let modelStr: string;
        if (typeof body.model === 'string') {
          modelStr = body.model.trim();
        } else if (body.model != null && typeof body.model === 'object') {
          modelStr = JSON.stringify(body.model);
        } else {
          res.status(400).json({ message: '请提供 model（JSON 对象或 JSON 字符串）' });
          return;
        }
        if (!modelStr) {
          res.status(400).json({ message: 'model 不能为空' });
          return;
        }
        try {
          JSON.parse(modelStr);
        } catch {
          res.status(400).json({ message: 'model 须为合法 JSON' });
          return;
        }

        const payload: Record<string, unknown> = { model: modelStr, persist };
        if (workerIp) payload.worker_ip = workerIp;

        const r = await xinferencePost(
          ctx,
          `/v1/model_registrations/${encodeURIComponent(modelType)}`,
          payload,
          { timeout: 120000 },
        );
        if (!r.ok) {
          res.status(r.status >= 400 && r.status < 600 ? r.status : 502).json({
            message: r.message || '注册模型失败',
          });
          return;
        }
        res.json({ ok: true, raw: r.data ?? null });
      } catch (error: any) {
        log.error('register model failed', error?.message ?? String(error));
        res.status(500).json({ message: error?.message || '注册模型失败' });
      }
    },
  );

  router.get(
    '/:id/xinference/model-registrations/:modelType/:modelName',
    perm,
    async (req: AuthRequest, res: Response) => {
      try {
        const cloud = await fetchXinferenceCloudOr404(req.params.id, res);
        if (!cloud) return;
        const ctx = xinferenceCtxOr400(cloud, res);
        if (!ctx) return;

        const modelType = String(req.params.modelType || 'LLM');
        const modelName = String(req.params.modelName || '');
        const r = await xinferenceGet(
          ctx,
          `/v1/model_registrations/${encodeURIComponent(modelType)}/${encodeURIComponent(modelName)}`,
        );
        if (!r.ok) {
          res.status(r.status === 401 ? 401 : 502).json({
            message: r.message || '拉取模型规格失败',
          });
          return;
        }
        res.json(r.data);
      } catch (error: any) {
        log.error('get registration failed', error?.message ?? String(error));
        res.status(500).json({ message: error?.message || '拉取模型规格失败' });
      }
    },
  );

  router.get(
    '/:id/xinference/engines/:modelType/:modelName',
    perm,
    async (req: AuthRequest, res: Response) => {
      try {
        const cloud = await fetchXinferenceCloudOr404(req.params.id, res);
        if (!cloud) return;
        const ctx = xinferenceCtxOr400(cloud, res);
        if (!ctx) return;

        const modelType = String(req.params.modelType || 'LLM').trim() || 'LLM';
        const modelName = String(req.params.modelName || '').trim();
        if (!modelName) {
          res.status(400).json({ message: '缺少 modelName' });
          return;
        }

        const r = await xinferenceGet(
          ctx,
          `/v1/engines/${encodeURIComponent(modelType)}/${encodeURIComponent(modelName)}`,
          { timeout: 60_000 },
        );
        if (!r.ok) {
          res.status(r.status >= 400 && r.status < 600 ? r.status : 502).json({
            message: r.message || '拉取模型引擎组合失败',
          });
          return;
        }
        res.json(r.data ?? {});
      } catch (error: any) {
        log.error('get engines failed', error?.message ?? String(error));
        res.status(500).json({ message: error?.message || '拉取模型引擎组合失败' });
      }
    },
  );

  router.get('/:id/xinference/cache/models', perm, async (req: AuthRequest, res: Response) => {
    try {
      const cloud = await fetchXinferenceCloudOr404(req.params.id, res);
      if (!cloud) return;
      const ctx = xinferenceCtxOr400(cloud, res);
      if (!ctx) return;

      const modelName = String(req.query.model_name || req.query.modelName || '').trim();
      const q = modelName ? `?model_name=${encodeURIComponent(modelName)}` : '';
      const r = await xinferenceGet(ctx, `/v1/cache/models${q}`, { timeout: 45_000 });
      if (!r.ok) {
        if (r.status === 404) {
          res.json({
            models: [],
            degraded: true,
            message: '当前 Xinference 版本不支持 cache/models',
          });
          return;
        }
        res.status(r.status >= 400 && r.status < 600 ? r.status : 502).json({
          message: r.message || '拉取模型缓存列表失败',
        });
        return;
      }
      res.json(r.data ?? { models: [] });
    } catch (error: any) {
      log.error('list cache models failed', error?.message ?? String(error));
      res.status(500).json({ message: error?.message || '拉取模型缓存列表失败' });
    }
  });

  router.post('/:id/xinference/models', perm, async (req: AuthRequest, res: Response) => {
    try {
      const cloud = await fetchXinferenceCloudOr404(req.params.id, res);
      if (!cloud) return;
      const ctx = xinferenceCtxOr400(cloud, res);
      if (!ctx) return;

      const body = req.body && typeof req.body === 'object' ? req.body : {};
      const modelName = String(body.model_name || body.modelName || '').trim();
      if (!modelName) {
        res.status(400).json({ message: '请指定 model_name' });
        return;
      }

      const payload: Record<string, unknown> = { ...body, model_name: modelName };
      delete payload.modelName;
      delete payload.wait_ready;
      delete payload.waitReady;

      const modelType = String(payload.model_type || 'LLM');
      const modelEngine = payload.model_engine;
      if (modelType === 'LLM' && !modelEngine) {
        res.status(400).json({ message: 'LLM 模型须指定 model_engine（如 vllm、transformers）' });
        return;
      }

      const waitReady = body.wait_ready === true || body.waitReady === true;
      const launchPath = `/v1/models?wait_ready=${waitReady ? 'true' : 'false'}`;
      const r = await xinferencePost(ctx, launchPath, payload, {
        timeout: waitReady ? 300000 : 120000,
      });
      if (!r.ok) {
        res.status(r.status >= 400 && r.status < 600 ? r.status : 502).json({
          message: r.message || '启动模型失败',
        });
        return;
      }
      const modelUid =
        r.data?.model_uid != null ? String(r.data.model_uid) : String(r.data?.modelUid || '');
      res.json({ modelUid, waitReady, raw: r.data });
    } catch (error: any) {
      log.error('launch model failed', error?.message ?? String(error));
      res.status(500).json({ message: error?.message || '启动模型失败' });
    }
  });

  router.get(
    '/:id/xinference/models/:modelUid/launch-progress',
    perm,
    async (req: AuthRequest, res: Response) => {
      try {
        const cloud = await fetchXinferenceCloudOr404(req.params.id, res);
        if (!cloud) return;
        const ctx = xinferenceCtxOr400(cloud, res);
        if (!ctx) return;

        const modelUid = String(req.params.modelUid || '').trim();
        if (!modelUid) {
          res.status(400).json({ message: '缺少 modelUid' });
          return;
        }

        const r = await xinferenceGet(ctx, `/v1/models/${encodeURIComponent(modelUid)}/progress`);
        if (!r.ok) {
          res.status(r.status >= 400 && r.status < 600 ? r.status : 502).json({
            message: r.message || '获取启动进度失败',
          });
          return;
        }
        const progressRaw = r.data?.progress;
        const progress =
          typeof progressRaw === 'number' && Number.isFinite(progressRaw) ? progressRaw : 0;
        res.json({ progress });
      } catch (error: any) {
        log.error('launch progress failed', error?.message ?? String(error));
        res.status(500).json({ message: error?.message || '获取启动进度失败' });
      }
    },
  );

  router.post(
    '/:id/xinference/models/:modelUid/cancel-launch',
    perm,
    async (req: AuthRequest, res: Response) => {
      try {
        const cloud = await fetchXinferenceCloudOr404(req.params.id, res);
        if (!cloud) return;
        const ctx = xinferenceCtxOr400(cloud, res);
        if (!ctx) return;

        const modelUid = String(req.params.modelUid || '').trim();
        if (!modelUid) {
          res.status(400).json({ message: '缺少 modelUid' });
          return;
        }

        const r = await xinferencePost(
          ctx,
          `/v1/models/${encodeURIComponent(modelUid)}/cancel`,
          {},
          { timeout: 60000 },
        );
        if (!r.ok) {
          res.status(r.status >= 400 && r.status < 600 ? r.status : 502).json({
            message: r.message || '取消启动失败',
            hint: '若 Xinference 日志仍在下载，请勿重复取消；请在集群节点执行 stop.sh / start.sh 彻底停止。',
          });
          return;
        }
        res.json({ ok: true, modelUid });
      } catch (error: any) {
        log.error('cancel launch failed', error?.message ?? String(error));
        res.status(500).json({ message: error?.message || '取消启动失败' });
      }
    },
  );

  router.delete(
    '/:id/xinference/models/:modelUid',
    perm,
    async (req: AuthRequest, res: Response) => {
      try {
        const cloud = await fetchXinferenceCloudOr404(req.params.id, res);
        if (!cloud) return;
        const ctx = xinferenceCtxOr400(cloud, res);
        if (!ctx) return;

        const modelUid = String(req.params.modelUid || '').trim();
        if (!modelUid) {
          res.status(400).json({ message: '缺少 modelUid' });
          return;
        }

        const r = await xinferenceDelete(ctx, `/v1/models/${encodeURIComponent(modelUid)}`, {
          timeout: 120000,
        });
        if (!r.ok) {
          res.status(r.status >= 400 && r.status < 600 ? r.status : 502).json({
            message: r.message || '停止模型失败',
          });
          return;
        }
        res.json({ ok: true, modelUid });
      } catch (error: any) {
        log.error('terminate model failed', error?.message ?? String(error));
        res.status(500).json({ message: error?.message || '停止模型失败' });
      }
    },
  );
}
