import { Router, Response, type RequestHandler } from 'express';
import { AppDataSource } from '../../config/database';
import { Cloud } from '../../entities/Cloud';
import { AuthRequest } from '../../middleware/auth';
import { logger } from '../../utils/logger';
import {
  getXinferenceContext,
  normalizeModelRegistrations,
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

      const r = await xinferenceGet(ctx, '/v1/models');
      if (!r.ok) {
        res.status(r.status === 401 ? 401 : 502).json({ message: r.message || '拉取运行中模型失败' });
        return;
      }
      res.json({ models: normalizeRunningModels(r.data) });
    } catch (error: any) {
      log.error('list models failed', error?.message ?? String(error));
      res.status(500).json({ message: error?.message || '拉取运行中模型失败' });
    }
  });

  router.get('/:id/xinference/model-registrations', perm, async (req: AuthRequest, res: Response) => {
    try {
      const cloud = await fetchXinferenceCloudOr404(req.params.id, res);
      if (!cloud) return;
      const ctx = xinferenceCtxOr400(cloud, res);
      if (!ctx) return;

      const modelType = String(req.query.modelType || 'LLM').trim() || 'LLM';
      const detailed = String(req.query.detailed || '').toLowerCase() === 'true';
      const q = detailed ? '?detailed=true' : '';
      const r = await xinferenceGet(ctx, `/v1/model_registrations/${encodeURIComponent(modelType)}${q}`);
      if (!r.ok) {
        res.status(r.status === 401 ? 401 : 502).json({
          message: r.message || '拉取可启动模型列表失败',
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
  });

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

      const modelType = String(payload.model_type || 'LLM');
      const modelEngine = payload.model_engine;
      if (modelType === 'LLM' && !modelEngine) {
        res.status(400).json({ message: 'LLM 模型须指定 model_engine（如 vllm、transformers）' });
        return;
      }

      const r = await xinferencePost(ctx, '/v1/models', payload, { timeout: 300000 });
      if (!r.ok) {
        res.status(r.status >= 400 && r.status < 600 ? r.status : 502).json({
          message: r.message || '启动模型失败',
        });
        return;
      }
      const modelUid =
        r.data?.model_uid != null ? String(r.data.model_uid) : String(r.data?.modelUid || '');
      res.json({ modelUid, raw: r.data });
    } catch (error: any) {
      log.error('launch model failed', error?.message ?? String(error));
      res.status(500).json({ message: error?.message || '启动模型失败' });
    }
  });

  router.delete('/:id/xinference/models/:modelUid', perm, async (req: AuthRequest, res: Response) => {
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
        `/v1/models/${encodeURIComponent(modelUid)}`,
        { timeout: 120000 },
      );
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
  });
}
