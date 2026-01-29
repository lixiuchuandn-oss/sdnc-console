import { Router, Response } from 'express';
import axios from 'axios';
import https from 'https';
import { AppDataSource } from '../config/database';
import { Cloud } from '../entities/Cloud';
import { HarvesterNamespace } from '../entities/HarvesterNamespace';
import {
  listHarvesterVMsStandard,
  listHarvesterNADsStandard,
  listHarvesterVolumesStandard,
  listHarvesterAvailableVolumesStandard,
  listHarvesterImagesStandard,
  listHarvesterNodesStandard,
  listHarvesterSystemPodsStandard,
  listHarvesterGpuResources,
  listHarvesterUsbResources,
  listHarvesterStorageClassesStandard,
  harvesterHealthCheck,
  getHarvesterVM,
  createHarvesterVM,
  listKubeOvnVpcs,
  listKubeOvnSubnets,
  buildHarvesterVMManifest,
  harvesterStartVM,
  harvesterStopVM,
  harvesterRebootVM,
  harvesterDeleteVM,
  harvesterAddVolumeToVM,
  harvesterRemoveVolumeFromVM,
  deleteHarvesterLonghornVolume,
  createHarvesterPVCVolume,
  exportImageFromPVC,
  createVolumeSnapshot,
  updatePVCSpec,
  clonePVC,
  updateHarvesterVMSpec,
  getHarvesterVmVncUrl,
  harvesterAddVolumeToVMDirect,
} from '../services/harvester';
import { requestJson, getJsonOnce } from '../services/clouds/harvester/utils';

const fetchCloudOr404 = async (id: string, res: Response) => {
  const repo = AppDataSource.getRepository(Cloud);
  const cloud = await repo.findOne({ where: { id } });
  if (!cloud) {
    res.status(404).json({ message: '云资源不存在' });
    return null;
  }
  return cloud;
};

const ensureProvider = (cloud: any, provider: string, res: Response, msg: string, next?: any) => {
  const actual = String(cloud?.config?.provider || '')
    .toLowerCase()
    .trim();
  // Allow Harvester and Cloudmap Private/Edge (but not Security/CSM)
  const isHarvesterLike =
    actual === 'harvester' ||
    actual === 'cloudmap' ||
    actual === 'cloudmap.private' ||
    actual === 'cloudmap.edge';

  if (!isHarvesterLike) {
    if (next) {
      next();
      return false;
    }
    res.status(400).json({ message: msg });
    return false;
  }
  return true;
};

export const registerHarvesterRoutes = (router: Router, checkAdminPermission: any) => {
  router.get(
    '/:id/resources/vpcs',
    checkAdminPermission,
    async (req: any, res: Response, next: any) => {
      try {
        const { id } = req.params;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester 资源查询', next)) return;
        const insecure = !!(cloud.config as any)?.ignoreTls;
        const list = await listKubeOvnVpcs({
          endpoint: cloud.endpoint,
          token: cloud.secretKey || '',
          insecure,
        } as any);
        res.json({ message: '查询成功', data: { items: list } });
      } catch (error: any) {
        if (res.headersSent) return;
        res.status(500).json({ message: '查询VPC失败', error: error.message });
      }
    },
  );
  router.get(
    '/:id/resources/subnets',
    checkAdminPermission,
    async (req: any, res: Response, next: any) => {
      try {
        const { id } = req.params;
        const { vpcId } = req.query as any;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester 资源查询', next)) return;
        const insecure = !!(cloud.config as any)?.ignoreTls;
        const list = await listKubeOvnSubnets({
          endpoint: cloud.endpoint,
          token: cloud.secretKey || '',
          insecure,
        } as any);
        let items = list;
        if (vpcId) {
          items = list.filter((s: any) => String(s?.vpc || '').trim() === String(vpcId).trim());
        }
        res.json({ message: '查询成功', data: { items } });
      } catch (error: any) {
        if (res.headersSent) return;
        res.status(500).json({ message: '查询子网失败', error: error.message });
      }
    },
  );
  router.get(
    '/:id/resources/ecs',
    checkAdminPermission,
    async (req: any, res: Response, next: any) => {
      try {
        const { id } = req.params;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester 资源查询', next)) return;
        const insecure = !!(cloud.config as any)?.ignoreTls;
        const data = await listHarvesterVMsStandard({
          endpoint: cloud.endpoint,
          token: cloud.secretKey || '',
          insecure,
        } as any);
        const capabilities = {
          isHarvester: true,
          supportsInstanceType: false,
          supportsZone: false,
          supportsVpc: false,
          supportsNetworkFusion: true,
          supportsMultus: true,
        };
        res.json({ message: '查询成功', data, capabilities });
      } catch (error: any) {
        if (res.headersSent) return;
        res.status(500).json({ message: '查询ECS失败', error: error.message });
      }
    },
  );
  router.get(
    '/:id/resources/ecs/stream',
    checkAdminPermission,
    async (req: any, res: Response, next: any) => {
      try {
        const { id } = req.params;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        {
          const pv = String((cloud as any)?.config?.provider || '')
            .toLowerCase()
            .trim();
          if (!(pv === 'harvester' || pv === 'cloudmap' || pv.startsWith('cloudmap')))
            return next();
        }
        const insecure = !!(cloud.config as any)?.ignoreTls;
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.flushHeaders?.();
        let closed = false;
        let prev = new Map<string, any>();
        req.on('close', () => {
          closed = true;
        });
        const send = (event: string, payload: any) => {
          try {
            res.write(`event: ${event}\n`);
            res.write(`data: ${JSON.stringify(payload)}\n\n`);
          } catch {}
        };
        const tick = async () => {
          if (closed) return;
          try {
            const data = await listHarvesterVMsStandard({
              endpoint: cloud.endpoint,
              token: cloud.secretKey || '',
              insecure,
            } as any);
            const items: any[] = Array.isArray(data) ? data : [];
            const cur = new Map<string, any>();
            for (const r of items) {
              const iid = String(r?.InstanceId || r?.id || '');
              if (!iid) continue;
              cur.set(iid, r);
              const prevItem = prev.get(iid);
              const prevStatus = String(prevItem?.Status || prevItem?.status || '');
              const curStatus = String(r?.Status || r?.status || '');
              if (!prevItem) send('vm_created', { item: r });
              else if (prevStatus !== curStatus) send('vm_status', { iid, status: curStatus });
            }
            for (const [iid] of prev.entries()) {
              if (!cur.has(iid)) send('vm_deleted', { iid });
            }
            prev = cur;
            send('vms', { items });
          } catch (e: any) {
            send('error', { message: e?.message || '拉取失败' });
          } finally {
            if (!closed) setTimeout(tick, 3000);
          }
        };
        send('hello', { ok: true });
        tick();
      } catch (error: any) {
        try {
          res.status(500).end();
        } catch {}
      }
    },
  );
  router.post(
    '/:id/resources/ecs/:instanceId/start',
    checkAdminPermission,
    async (req: any, res: Response, next: any) => {
      try {
        const { id, instanceId } = req.params;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        {
          const pv = String((cloud as any)?.config?.provider || '')
            .toLowerCase()
            .trim();
          if (!(pv === 'harvester' || pv === 'cloudmap' || pv.startsWith('cloudmap')))
            return next();
        }
        const insecure = !!(cloud.config as any)?.ignoreTls;
        const data = await harvesterStartVM(
          { endpoint: cloud.endpoint, token: cloud.secretKey || '', insecure } as any,
          instanceId,
        );
        res.json({ message: '启动成功', data });
      } catch (error: any) {
        res.status(500).json({ message: '启动实例失败', error: error.message });
      }
    },
  );
  router.post(
    '/:id/resources/ecs/:instanceId/stop',
    checkAdminPermission,
    async (req: any, res: Response, next: any) => {
      try {
        const { id, instanceId } = req.params;
        const { force } = (req.body || {}) as any;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        {
          const pv = String((cloud as any)?.config?.provider || '')
            .toLowerCase()
            .trim();
          if (!(pv === 'harvester' || pv === 'cloudmap' || pv.startsWith('cloudmap')))
            return next();
        }
        const insecure = !!(cloud.config as any)?.ignoreTls;
        const data = await harvesterStopVM(
          { endpoint: cloud.endpoint, token: cloud.secretKey || '', insecure } as any,
          instanceId,
          !!force,
        );
        res.json({ message: '停止成功', data });
      } catch (error: any) {
        res.status(500).json({ message: '停止实例失败', error: error.message });
      }
    },
  );
  router.post(
    '/:id/resources/ecs/:instanceId/reboot',
    checkAdminPermission,
    async (req: any, res: Response, next: any) => {
      try {
        const { id, instanceId } = req.params;
        const { force } = (req.body || {}) as any;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        {
          const pv = String((cloud as any)?.config?.provider || '')
            .toLowerCase()
            .trim();
          if (!(pv === 'harvester' || pv === 'cloudmap' || pv.startsWith('cloudmap')))
            return next();
        }
        const insecure = !!(cloud.config as any)?.ignoreTls;
        const data = await harvesterRebootVM(
          { endpoint: cloud.endpoint, token: cloud.secretKey || '', insecure } as any,
          instanceId,
          !!force,
        );
        res.json({ message: '重启成功', data });
      } catch (error: any) {
        res.status(500).json({ message: '重启实例失败', error: error.message });
      }
    },
  );
  router.get(
    '/:id/resources/harvester/namespaces/:name',
    checkAdminPermission,
    async (req: any, res: Response) => {
      try {
        const { id, name } = req.params;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester 资源查询')) return;
        const insecure = !!(cloud.config as any)?.ignoreTls;
        const base = (cloud.endpoint || '').replace(/\/+$/, '');
        let origin = base;
        try {
          const u = new URL(base);
          origin = `${u.protocol}//${u.host}`;
        } catch {
          origin = base.replace(/\/v[0-9].*$/, '');
        }
        const candidates = [
          `${origin}/api/v1/namespaces/${name}`,
          `${origin}/v1/core.v1.namespaces/${name}`,
          `${origin}/v1/harvester/core.v1.namespaces/${name}`,
          `${origin}/k8s/clusters/local/api/v1/namespaces/${name}`,
        ];
        let json: any = null;
        let lastErr: any = null;
        for (const url of candidates) {
          try {
            json = await getJsonOnce(url, cloud.secretKey || '', insecure);
            if (json) break;
          } catch (e: any) {
            lastErr = e;
          }
        }
        if (!json && lastErr) {
             // 404 is valid if not found
             if (Number(lastErr?.status) === 404) {
                 return res.status(404).json({ message: '命名空间不存在' });
             }
             throw lastErr;
        }
        res.json({ message: '查询成功', data: json });
      } catch (error: any) {
        res.status(500).json({ message: '查询命名空间详情失败', error: error.message });
      }
    },
  );

  router.patch(
    '/:id/resources/harvester/namespaces/:name',
    checkAdminPermission,
    async (req: any, res: Response) => {
      try {
        const { id, name } = req.params;
        const { labels, annotations } = req.body;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester 资源修改')) return;
        const insecure = !!(cloud.config as any)?.ignoreTls;
        const base = (cloud.endpoint || '').replace(/\/+$/, '');
        let origin = base;
        try {
          const u = new URL(base);
          origin = `${u.protocol}//${u.host}`;
        } catch {
          origin = base.replace(/\/v[0-9].*$/, '');
        }
        const candidates = [
          `${origin}/api/v1/namespaces/${name}`,
          `${origin}/v1/core.v1.namespaces/${name}`,
        ];
        const body = {
          metadata: {
            labels: labels && typeof labels === 'object' ? labels : undefined,
            annotations: annotations && typeof annotations === 'object' ? annotations : undefined,
          },
        };
        let json: any = null;
        let lastErr: any = null;
        for (const url of candidates) {
          try {
            json = await requestJson('PATCH', url, cloud.secretKey || '', insecure, body, {
              'Content-Type': 'application/merge-patch+json',
            });
            if (json) break;
          } catch (e: any) {
            lastErr = e;
          }
        }
        if (!json && lastErr) {
          return res.status(500).json({ message: '修改命名空间失败', error: lastErr?.message });
        }
        res.json({ message: '修改成功', data: json });
      } catch (error: any) {
        res.status(500).json({ message: '修改命名空间失败', error: error.message });
      }
    },
  );

  router.delete(
    '/:id/resources/ecs/:instanceId',
    checkAdminPermission,
    async (req: any, res: Response, next: any) => {
      try {
        const { id, instanceId } = req.params;
        const { deleteImage } = req.query;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        {
          const pv = String((cloud as any)?.config?.provider || '')
            .toLowerCase()
            .trim();
          if (!(pv === 'harvester' || pv === 'cloudmap' || pv.startsWith('cloudmap')))
            return next();
        }
        const insecure = !!(cloud.config as any)?.ignoreTls;
        const data = await harvesterDeleteVM(
          { endpoint: cloud.endpoint, token: cloud.secretKey || '', insecure } as any,
          instanceId,
          String(deleteImage) === 'true',
        );
        res.json({ message: '删除成功', data });
      } catch (error: any) {
        res.status(500).json({ message: '删除实例失败', error: error.message });
      }
    },
  );
  router.get(
    '/:id/resources/harvester/nads',
    checkAdminPermission,
    async (req: any, res: Response) => {
      try {
        const { id } = req.params;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester 资源查询')) return;
        const insecure = !!(cloud.config as any)?.ignoreTls;
        const list = await listHarvesterNADsStandard({
          endpoint: cloud.endpoint,
          token: cloud.secretKey || '',
          insecure,
        } as any);
        res.json({ message: '查询成功', data: { items: list } });
      } catch (error: any) {
        res.status(500).json({ message: '查询网络附件定义失败', error: error.message });
      }
    },
  );

  router.get(
    '/:id/resources/harvester/namespaces',
    checkAdminPermission,
    async (req: any, res: Response) => {
      try {
        const { id } = req.params;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester 资源查询')) return;
        const insecure = !!(cloud.config as any)?.ignoreTls;
        const base = (cloud.endpoint || '').replace(/\/+$/, '');
        let origin = base;
        try {
          const u = new URL(base);
          origin = `${u.protocol}//${u.host}`;
        } catch {
          origin = base.replace(/\/v[0-9].*$/, '');
        }
        const candidates = [
          `${origin}/api/v1/namespaces`,
          `${origin}/v1/core.v1.namespaces`,
          `${origin}/v1/harvester/core.v1.namespaces`,
          `${origin}/k8s/clusters/local/api/v1/namespaces`,
        ];
        let json: any = null;
        let lastErr: any = null;
        for (const url of candidates) {
          try {
            json = await getJsonOnce(url, cloud.secretKey || '', insecure);
            if (json) break;
          } catch (e: any) {
            lastErr = e;
          }
        }
        if (!json && lastErr) throw lastErr;
        let items: any[] = Array.isArray(json?.data)
          ? json?.data
          : Array.isArray(json?.items)
            ? json?.items
            : [];
        
        // Enrich with local DB info
        try {
          const repo = AppDataSource.getRepository(HarvesterNamespace);
          const dbItems = await repo.find({ where: { cloudId: id } });
          const userNamespaces = new Set(dbItems.map(i => i.name));
          
          items = items.map(item => {
             const name = item?.metadata?.name || item?.name;
             const isUser = userNamespaces.has(name);
             return { ...item, type: isUser ? 'user' : 'system' };
          });
        } catch (e) {
           console.warn('Failed to fetch HarvesterNamespace records', e);
        }

        res.json({ message: '查询成功', data: { items } });
      } catch (error: any) {
        res.status(500).json({ message: '查询命名空间失败', error: error.message });
      }
    },
  );
  router.post(
    '/:id/resources/harvester/namespaces',
    checkAdminPermission,
    async (req: any, res: Response) => {
      try {
        const { id } = req.params;
        const { name, labels, annotations } = (req.body || {}) as any;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester 资源创建')) return;
        const nm = String(name || '').trim();
        const ok = /^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/.test(nm) && nm.length > 0 && nm.length <= 63;
        if (!ok) return res.status(400).json({ message: '非法的命名空间名称（DNS-1123）' });
        const insecure = !!(cloud.config as any)?.ignoreTls;
        const base = (cloud.endpoint || '').replace(/\/+$/, '');
        let origin = base;
        try {
          const u = new URL(base);
          origin = `${u.protocol}//${u.host}`;
        } catch {
          origin = base.replace(/\/v[0-9].*$/, '');
        }
        const candidates = [
          `${origin}/api/v1/namespaces`,
          `${origin}/v1/core.v1.namespaces`,
          `${origin}/v1/harvester/core.v1.namespaces`,
          `${origin}/k8s/clusters/local/api/v1/namespaces`,
        ];
        const body = {
          apiVersion: 'v1',
          kind: 'Namespace',
          metadata: {
            name: nm,
            labels: labels && typeof labels === 'object' ? labels : undefined,
            annotations: annotations && typeof annotations === 'object' ? annotations : undefined,
          },
        };
        let json: any = null;
        let lastErr: any = null;
        for (const url of candidates) {
          try {
            json = await requestJson('POST', url, cloud.secretKey || '', insecure, body);
            if (json) break;
          } catch (e: any) {
            lastErr = e;
          }
        }
        if (!json && lastErr) {
          const status = Number(lastErr?.status || 0);
          const lower = String(lastErr?.message || '').toLowerCase();
          let msg = '创建命名空间失败';
          if (status === 403 || lower.includes('forbidden')) msg = '创建失败：权限不足（403）';
          else if (status === 409 || lower.includes('already exists')) msg = '创建失败：命名空间已存在（409）';
          else if (status === 422 || lower.includes('invalid')) msg = '创建失败：参数非法（422）';
          return res.status(500).json({ message: msg, error: lastErr?.message });
        }
        res.json({ message: '创建成功', data: json });
      } catch (error: any) {
        res.status(500).json({ message: '创建命名空间失败', error: error.message });
      }
    },
  );

  router.delete(
    '/:id/resources/harvester/namespaces/:name',
    checkAdminPermission,
    async (req: any, res: Response) => {
      try {
        const { id, name } = req.params;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester 资源删除')) return;
        const insecure = !!(cloud.config as any)?.ignoreTls;
        const base = (cloud.endpoint || '').replace(/\/+$/, '');
        let origin = base;
        try {
          const u = new URL(base);
          origin = `${u.protocol}//${u.host}`;
        } catch {
          origin = base.replace(/\/v[0-9].*$/, '');
        }
        const candidates = [
          `${origin}/api/v1/namespaces/${name}`,
          `${origin}/v1/core.v1.namespaces/${name}`,
          `${origin}/v1/harvester/core.v1.namespaces/${name}`,
          `${origin}/k8s/clusters/local/api/v1/namespaces/${name}`,
        ];
        let json: any = null;
        let lastErr: any = null;
        let success = false;
        for (const url of candidates) {
          try {
            json = await requestJson('DELETE', url, cloud.secretKey || '', insecure);
            success = true;
            break; 
          } catch (e: any) {
            lastErr = e;
            // 404 means already deleted
            if (Number(e?.status) === 404) {
                success = true;
                break;
            }
          }
        }
        if (!success && lastErr) {
           return res.status(500).json({ message: '删除命名空间失败', error: lastErr?.message });
        }
        res.json({ message: '删除成功', data: json });
      } catch (error: any) {
        res.status(500).json({ message: '删除命名空间失败', error: error.message });
      }
    },
  );

  router.get(
    '/:id/resources/harvester/volumes',
    checkAdminPermission,
    async (req: any, res: Response) => {
      try {
        const { id } = req.params;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester 资源查询')) return;
        const insecure = !!(cloud.config as any)?.ignoreTls;
        const items = await listHarvesterVolumesStandard({
          endpoint: cloud.endpoint,
          token: cloud.secretKey || '',
          insecure,
        } as any);
        res.json({ message: '查询成功', data: { items } });
      } catch (error: any) {
        res.status(500).json({ message: '查询卷失败', error: error.message });
      }
    },
  );

  router.get(
    '/:id/resources/harvester/available-volumes',
    checkAdminPermission,
    async (req: any, res: Response) => {
      try {
        const { id } = req.params;
        const { namespace } = (req.query || {}) as any;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester 资源查询')) return;
        const insecure = !!(cloud.config as any)?.ignoreTls;
        const items = await listHarvesterAvailableVolumesStandard(
          { endpoint: cloud.endpoint, token: cloud.secretKey || '', insecure } as any,
          { namespace },
        );
        res.json({ message: '查询成功', data: { items } });
      } catch (error: any) {
        res.status(500).json({ message: '查询可用卷失败', error: error.message });
      }
    },
  );

  router.get(
    '/:id/resources/harvester/storage-classes',
    checkAdminPermission,
    async (req: any, res: Response) => {
      try {
        const { id } = req.params;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester 资源查询')) return;
        const insecure = !!(cloud.config as any)?.ignoreTls;
        const items = await listHarvesterStorageClassesStandard({
          endpoint: cloud.endpoint,
          token: cloud.secretKey || '',
          insecure,
        } as any);
        res.json({ message: '查询成功', data: { items } });
      } catch (error: any) {
        res.status(500).json({ message: '查询存储类失败', error: error.message });
      }
    },
  );

  router.post(
    '/:id/resources/harvester/vms/:instanceId/add-volume',
    checkAdminPermission,
    async (req: any, res: Response) => {
      try {
        const { id, instanceId } = req.params as any;
        const { name, bus, pvcNamespace, pvcName } = (req.body || {}) as any;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester 资源操作')) return;
        const insecure = !!(cloud.config as any)?.ignoreTls;
        const data = await harvesterAddVolumeToVM(
          { endpoint: cloud.endpoint, token: cloud.secretKey || '', insecure } as any,
          instanceId,
          { name, bus, pvcNamespace, pvcName },
        );
        res.json({ message: '挂载成功', data });
      } catch (error: any) {
        res.status(500).json({ message: '挂载卷失败', error: error.message });
      }
    },
  );

  router.post(
    '/:id/resources/harvester/vms/:namespace/:name/add-volume',
    checkAdminPermission,
    async (req: any, res: Response) => {
      try {
        const { id, namespace, name } = req.params as any;
        const { diskName, bus, pvcNamespace, pvcName, name: bodyName } = (req.body || {}) as any;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester 资源操作')) return;
        const insecure = !!(cloud.config as any)?.ignoreTls;
        const data = await harvesterAddVolumeToVMDirect(
          { endpoint: cloud.endpoint, token: cloud.secretKey || '', insecure } as any,
          namespace,
          name,
          { name: bodyName || diskName, bus, pvcNamespace, pvcName },
        );
        res.json({ message: '挂载成功', data });
      } catch (error: any) {
        res.status(500).json({ message: '挂载卷失败', error: error.message });
      }
    },
  );

  router.post(
    '/:id/resources/harvester/vms/:instanceId/remove-volume',
    checkAdminPermission,
    async (req: any, res: Response) => {
      try {
        const { id, instanceId } = req.params as any;
        const { name } = (req.body || {}) as any;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester 资源操作')) return;
        const insecure = !!(cloud.config as any)?.ignoreTls;
        const data = await harvesterRemoveVolumeFromVM(
          { endpoint: cloud.endpoint, token: cloud.secretKey || '', insecure } as any,
          instanceId,
          { name },
        );
        res.json({ message: '卸载成功', data });
      } catch (error: any) {
        res.status(500).json({ message: '卸载卷失败', error: error.message });
      }
    },
  );

  router.delete(
    '/:id/resources/harvester/volumes/:namespace/:name',
    checkAdminPermission,
    async (req: any, res: Response) => {
      try {
        const { id, namespace, name } = req.params as any;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester 资源删除')) return;
        const insecure = !!(cloud.config as any)?.ignoreTls;
        const data = await deleteHarvesterLonghornVolume(
          { endpoint: cloud.endpoint, token: cloud.secretKey || '', insecure } as any,
          namespace,
          name,
        );
        res.json({ message: '删除成功', data });
      } catch (error: any) {
        const status = Number(error?.status || 0);
        const body = String(error?.message || '');
        let msg = '删除卷失败';
        const lower = body.toLowerCase();
        if (status === 403 || lower.includes('permissiondenied')) {
          msg =
            '删除失败：权限不足或接口不支持删除（403）。请检查登录账号权限，或通过 Longhorn 卷 CRD 路径执行删除。';
        } else if (status === 404 || lower.includes('not found')) {
          msg = '删除失败：未找到该卷（404）。请确认命名空间与卷名是否正确。';
        } else if (status === 409 || lower.includes('conflict') || lower.includes('in use')) {
          msg = '删除失败：卷正在使用或已挂载（409）。请先卸载后再删除。';
        } else if (lower.includes('method delete not supported')) {
          msg = '删除失败：当前接口不支持删除操作。请使用 Longhorn CRD API 路径删除。';
        }
        res.status(500).json({ message: msg });
      }
    },
  );

  router.post(
    '/:id/resources/harvester/volumes/:namespace/:pvcName/export-image',
    checkAdminPermission,
    async (req: any, res: Response) => {
      try {
        const { id, namespace, pvcName } = req.params as any;
        const { displayName, targetStorageClassName } = (req.body || {}) as any;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester 资源操作')) return;
        const insecure = !!(cloud.config as any)?.ignoreTls;
        const data = await exportImageFromPVC(
          { endpoint: cloud.endpoint, token: cloud.secretKey || '', insecure } as any,
          namespace,
          pvcName,
          { displayName, targetStorageClassName },
        );
        res.json({ message: '创建镜像任务成功', data });
      } catch (error: any) {
        const status = Number(error?.status || 0);
        const body = String(error?.message || '');
        let msg = '导出镜像失败';
        const lower = body.toLowerCase();
        if (status === 403 || lower.includes('forbidden')) {
          msg = '失败：权限不足（403）。';
        } else if (status === 404 || lower.includes('not found')) {
          msg = '失败：PVC 未找到（404）。';
        }
        res.status(500).json({ message: msg });
      }
    },
  );

  router.post(
    '/:id/resources/harvester/volumes/:namespace/:pvcName/snapshots',
    checkAdminPermission,
    async (req: any, res: Response) => {
      try {
        const { id, namespace, pvcName } = req.params as any;
        const { name, snapshotClassName } = (req.body || {}) as any;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester 资源操作')) return;
        const insecure = !!(cloud.config as any)?.ignoreTls;
        const data = await createVolumeSnapshot(
          { endpoint: cloud.endpoint, token: cloud.secretKey || '', insecure } as any,
          namespace,
          pvcName,
          { name, snapshotClassName },
        );
        res.json({ message: '创建快照成功', data });
      } catch (error: any) {
        const status = Number(error?.status || 0);
        const body = String(error?.message || '');
        let msg = '创建快照失败';
        const lower = body.toLowerCase();
        if (status === 403 || lower.includes('forbidden')) {
          msg = '失败：权限不足（403）。';
        } else if (status === 404 || lower.includes('not found')) {
          msg = '失败：PVC 未找到（404）。';
        }
        res.status(500).json({ message: msg });
      }
    },
  );

  router.put(
    '/:id/resources/harvester/volumes/:namespace/:pvcName',
    checkAdminPermission,
    async (req: any, res: Response) => {
      try {
        const { id, namespace, pvcName } = req.params as any;
        const { sizeGi, size, accessModes, volumeMode, storageClassName, annotations, labels } =
          (req.body || {}) as any;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester 资源操作')) return;
        const insecure = !!(cloud.config as any)?.ignoreTls;
        const data = await updatePVCSpec(
          { endpoint: cloud.endpoint, token: cloud.secretKey || '', insecure } as any,
          namespace,
          pvcName,
          { sizeGi, size, accessModes, volumeMode, storageClassName, annotations, labels },
        );
        res.json({ message: '更新成功', data });
      } catch (error: any) {
        const status = Number(error?.status || 0);
        const body = String(error?.message || '');
        let msg = '更新卷失败';
        const lower = body.toLowerCase();
        if (status === 403 || lower.includes('forbidden')) {
          msg = '失败：权限不足（403）。';
        } else if (status === 404 || lower.includes('not found')) {
          msg = '失败：PVC 未找到（404）。';
        }
        res.status(500).json({ message: msg });
      }
    },
  );

  router.post(
    '/:id/resources/harvester/volumes/:namespace/:pvcName/clone',
    checkAdminPermission,
    async (req: any, res: Response) => {
      try {
        const { id, namespace, pvcName } = req.params as any;
        const {
          targetNamespace,
          newName,
          sizeGi,
          size,
          storageClassName,
          fromSnapshotName,
          accessModes,
          volumeMode,
        } = (req.body || {}) as any;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester 资源操作')) return;
        const insecure = !!(cloud.config as any)?.ignoreTls;
        const data = await clonePVC(
          { endpoint: cloud.endpoint, token: cloud.secretKey || '', insecure } as any,
          namespace,
          pvcName,
          {
            targetNamespace,
            newName,
            sizeGi,
            size,
            storageClassName,
            fromSnapshotName,
            accessModes,
            volumeMode,
          },
        );
        res.json({ message: '克隆创建成功', data });
      } catch (error: any) {
        const status = Number(error?.status || 0);
        const body = String(error?.message || '');
        let msg = '克隆卷失败';
        const lower = body.toLowerCase();
        if (status === 403 || lower.includes('forbidden')) {
          msg = '失败：权限不足（403）。';
        } else if (status === 409 || lower.includes('already exists')) {
          msg = '失败：同名PVC已存在（409）。';
        }
        res.status(500).json({ message: msg });
      }
    },
  );

  router.post(
    '/:id/resources/harvester/volumes',
    checkAdminPermission,
    async (req: any, res: Response) => {
      try {
        const { id } = req.params as any;
        const { namespace, name, sizeGi, size, accessModes, volumeMode, storageClassName } =
          (req.body || {}) as any;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester 资源操作')) return;
        if (!namespace || !name)
          return res.status(400).json({ message: '缺少必要参数：namespace、name' });
        const insecure = !!(cloud.config as any)?.ignoreTls;
        const data = await createHarvesterPVCVolume(
          { endpoint: cloud.endpoint, token: cloud.secretKey || '', insecure } as any,
          { namespace, name, sizeGi, size, accessModes, volumeMode, storageClassName },
        );
        res.json({ message: '创建成功', data });
      } catch (error: any) {
        const status = Number(error?.status || 0);
        const body = String(error?.message || '');
        let msg = '创建卷失败';
        const lower = body.toLowerCase();
        if (status === 403 || lower.includes('forbidden')) {
          msg = '创建失败：权限不足（403）。请检查登录账号的集群写权限。';
        } else if (status === 409 || lower.includes('already exists')) {
          msg = '创建失败：同名卷已存在（409）。请更换名称或删除后再试。';
        } else if (status === 404 || lower.includes('not found')) {
          msg = '创建失败：命名空间不存在（404）。请确认命名空间是否正确。';
        }
        res.status(500).json({ message: msg });
      }
    },
  );

  router.get(
    '/:id/resources/harvester/images',
    checkAdminPermission,
    async (req: any, res: Response) => {
      try {
        const { id } = req.params;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester 资源查询')) return;
        const insecure = !!(cloud.config as any)?.ignoreTls;
        const providerRaw = String((cloud as any)?.config?.provider || '');
        const provider = providerRaw.toLowerCase().trim();
        let version = String((cloud.config as any)?.harvesterVersion || '').trim();
        if (!version && (provider === 'cloudmap.private' || provider === 'cloudmap.edge')) {
          version = '1.6';
        }
        const list = await listHarvesterImagesStandard({
          endpoint: cloud.endpoint,
          token: cloud.secretKey || '',
          insecure,
          version,
        } as any);
        res.json({ message: '查询成功', data: { items: list } });
      } catch (error: any) {
        res.status(500).json({ message: '查询镜像失败', error: error.message });
      }
    },
  );

  router.delete(
    '/:id/resources/harvester/images/:namespace/:name',
    checkAdminPermission,
    async (req: any, res: Response) => {
      try {
        const { id, namespace, name } = req.params as any;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester 资源删除')) return;
        const insecure = !!(cloud.config as any)?.ignoreTls;
        const base = (cloud.endpoint || '').replace(/\/+$/, '');
        let origin = base;
        try {
          const u = new URL(base);
          origin = `${u.protocol}//${u.host}`;
        } catch {
          origin = base.replace(/\/v[0-9].*$/, '');
        }
        const url = `${origin}/v1/harvester/harvesterhci.io.virtualmachineimages/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}`;
        await requestJson('DELETE', url, cloud.secretKey || '', insecure, undefined);
        res.json({ message: '删除成功' });
      } catch (error: any) {
        res.status(500).json({ message: '删除镜像失败', error: error.message });
      }
    },
  );

  router.post(
    '/:id/resources/harvester/images',
    checkAdminPermission,
    async (req: any, res: Response) => {
      try {
        const { id } = req.params as any;
        const {
          namespace,
          name,
          displayName,
          sourceType,
          url,
          targetStorageClassName,
          storageClassParameters,
        } = (req.body || {}) as any;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester 资源创建')) return;
        if (!namespace || !(name || displayName))
          return res.status(400).json({ message: '缺少必填参数：namespace、name 或 displayName' });
        const insecure = !!(cloud.config as any)?.ignoreTls;
        const base = (cloud.endpoint || '').replace(/\/+$/, '');
        let origin = base;
        try {
          const u = new URL(base);
          origin = `${u.protocol}//${u.host}`;
        } catch {
          origin = base.replace(/\/v[0-9].*$/, '');
        }
        const urlPath = `${origin}/apis/harvesterhci.io/v1/namespaces/${encodeURIComponent(namespace)}/virtualmachineimages`;
        const body = {
          apiVersion: 'harvesterhci.io/v1beta1',
          kind: 'VirtualMachineImage',
          metadata: {
            name: name || undefined,
            generateName: name ? undefined : 'image-',
            namespace,
          },
          spec: {
            displayName: displayName || name || 'image',
            sourceType: sourceType || (url ? 'download' : 'upload'),
            url: url || '',
            targetStorageClassName: targetStorageClassName || 'longhorn',
            storageClassParameters: storageClassParameters || {},
          },
        };
        const json = await requestJson('POST', urlPath, cloud.secretKey || '', insecure, body);
        res.json({ message: '创建成功', data: json });
      } catch (error: any) {
        res.status(500).json({ message: '创建镜像失败', error: error.message });
      }
    },
  );

  router.put(
    '/:id/resources/harvester/images/:namespace/:name',
    checkAdminPermission,
    async (req: any, res: Response) => {
      try {
        const { id, namespace, name } = req.params as any;
        const { displayName, retry, targetStorageClassName, storageClassParameters } = (req.body ||
          {}) as any;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester 资源更新')) return;
        const insecure = !!(cloud.config as any)?.ignoreTls;
        const base = (cloud.endpoint || '').replace(/\/+$/, '');
        let origin = base;
        try {
          const u = new URL(base);
          origin = `${u.protocol}//${u.host}`;
        } catch {
          origin = base.replace(/\/v[0-9].*$/, '');
        }
        const getUrl = `${origin}/apis/harvesterhci.io/v1/namespaces/${encodeURIComponent(namespace)}/virtualmachineimages/${encodeURIComponent(name)}`;
        const current = await getJsonOnce(getUrl, cloud.secretKey || '', insecure);
        const next = {
          apiVersion: current?.apiVersion || 'harvesterhci.io/v1beta1',
          kind: current?.kind || 'VirtualMachineImage',
          metadata: { ...(current?.metadata || {}), name, namespace },
          spec: {
            ...(current?.spec || {}),
            ...(displayName ? { displayName } : {}),
            ...(typeof retry === 'number' ? { retry } : {}),
            ...(targetStorageClassName ? { targetStorageClassName } : {}),
            ...(storageClassParameters ? { storageClassParameters } : {}),
          },
        };
        const putUrl = getUrl;
        const json = await requestJson('PUT', putUrl, cloud.secretKey || '', insecure, next);
        res.json({ message: '更新成功', data: json });
      } catch (error: any) {
        res.status(500).json({ message: '更新镜像失败', error: error.message });
      }
    },
  );

  router.post(
    '/:id/resources/harvester/vms',
    checkAdminPermission,
    async (req: any, res: Response) => {
      try {
        const { id } = req.params;
        const {
          namespace,
          name,
          cpu,
          memory,
          image,
          networks,
          userData,
          systemDiskSize,
          storageClassName,
          nodeName,
          nodeSelector,
          diskBus,
          cloudInitAsCdrom,
          cloudInitBus,
          bootUseEfi,
          efiPersistent,
          efiSecureBoot,
          extraDisks,
          netIfaces,
          rootSourceType,
          rootImage,
          rootPvc,
          rootName,
          rootBus,
          rootSize,
          rootDeviceType,
          runStrategy,
          gpuMode,
          gpuResourceName,
          gpuCount,
          cpuSockets,
          cpuCores,
          cpuThreads,
          cpuModel,
          cpuModelCustom,
          dedicatedCPUPlacement,
          isolateEmulatorThread,
          cpuRequest,
          cpuLimit,
        } = (req.body || {}) as any;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!ensureProvider(cloud, 'harvester', res, '仅支持在 Harvester 创建虚拟机')) return;
        const insecure = !!(cloud.config as any)?.ignoreTls;
        if (!namespace || !name || !cpu || !memory)
          return res.status(400).json({ message: '缺少必填参数：namespace、name、cpu、memory' });
        const src = String(rootSourceType || 'image');
        if (src === 'existing' && !rootPvc)
          return res.status(400).json({ message: '系统盘为现有磁盘时需提供 PVC 名称' });
        if (src !== 'existing' && !(image || rootImage))
          return res.status(400).json({ message: '系统盘为镜像或ISO时需选择镜像' });
        const result = await createHarvesterVM(
          { endpoint: cloud.endpoint, token: cloud.secretKey || '', insecure } as any,
          {
            namespace,
            name,
            cpu: Number(cpu),
            memory: String(memory),
            image: String(image || rootImage || ''),
            networks: Array.isArray(networks) ? networks : [],
            userData: typeof userData === 'string' ? userData : undefined,
            systemDiskSize:
              rootSize || systemDiskSize ? String(rootSize || systemDiskSize) : undefined,
            storageClassName: storageClassName ? String(storageClassName) : undefined,
            nodeName: nodeName ? String(nodeName) : undefined,
            nodeSelector:
              nodeSelector && typeof nodeSelector === 'object' ? nodeSelector : undefined,
            diskBus: rootBus || diskBus ? String(rootBus || diskBus) : undefined,
            cloudInitAsCdrom: !!cloudInitAsCdrom,
            cloudInitBus: cloudInitBus ? String(cloudInitBus) : undefined,
            bootUseEfi: !!bootUseEfi,
            efiPersistent: !!efiPersistent,
            efiSecureBoot: !!efiSecureBoot,
            extraDisks: Array.isArray(extraDisks) ? extraDisks : undefined,
            netIfaces: Array.isArray(netIfaces) ? netIfaces : undefined,
            rootSourceType: src,
            rootImage: String(rootImage || image || ''),
            rootPvc: rootPvc ? String(rootPvc) : undefined,
            rootName: rootName ? String(rootName) : undefined,
            rootBus: rootBus || diskBus ? String(rootBus || diskBus) : undefined,
            rootSize: rootSize || systemDiskSize ? String(rootSize || systemDiskSize) : undefined,
            rootDeviceType: rootDeviceType ? String(rootDeviceType) : undefined,
            runStrategy: runStrategy ? String(runStrategy) : undefined,
            gpuMode: gpuMode ? String(gpuMode) : undefined,
            gpuResourceName: gpuResourceName ? String(gpuResourceName) : undefined,
            gpuCount: typeof gpuCount === 'number' ? gpuCount : undefined,
            cpuSockets: typeof cpuSockets === 'number' ? cpuSockets : undefined,
            cpuCores: typeof cpuCores === 'number' ? cpuCores : undefined,
            cpuThreads: typeof cpuThreads === 'number' ? cpuThreads : undefined,
            cpuModel: cpuModel ? String(cpuModel) : undefined,
            cpuModelCustom: cpuModelCustom ? String(cpuModelCustom) : undefined,
            dedicatedCPUPlacement: !!dedicatedCPUPlacement,
            isolateEmulatorThread: !!isolateEmulatorThread,
            cpuRequest: typeof cpuRequest === 'number' ? cpuRequest : undefined,
            cpuLimit: typeof cpuLimit === 'number' ? cpuLimit : undefined,
          } as any,
        );
        res.json({ message: '创建成功', data: result });
      } catch (error: any) {
        res.status(500).json({ message: '创建虚拟机失败', error: error.message });
      }
    },
  );

  router.post(
    '/:id/resources/harvester/vms/preview',
    checkAdminPermission,
    async (req: any, res: Response) => {
      try {
        const { id } = req.params;
        const {
          namespace,
          name,
          cpu,
          memory,
          image,
          networks,
          userData,
          systemDiskSize,
          storageClassName,
          nodeName,
          nodeSelector,
          diskBus,
          cloudInitAsCdrom,
          cloudInitBus,
          bootUseEfi,
          efiPersistent,
          efiSecureBoot,
          extraDisks,
          netIfaces,
          rootSourceType,
          rootImage,
          rootPvc,
          rootName,
          rootBus,
          rootSize,
          rootDeviceType,
          runStrategy,
          gpuMode,
          gpuResourceName,
          gpuCount,
          cpuSockets,
          cpuCores,
          cpuThreads,
          cpuModel,
          cpuModelCustom,
          dedicatedCPUPlacement,
          isolateEmulatorThread,
          cpuRequest,
          cpuLimit,
        } = (req.body || {}) as any;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!ensureProvider(cloud, 'harvester', res, '仅支持在 Harvester 创建虚拟机')) return;
        if (!namespace || !name || !cpu || !memory)
          return res.status(400).json({ message: '缺少必填参数：namespace、name、cpu、memory' });
        const src = String(rootSourceType || 'image');
        if (src === 'existing' && !rootPvc)
          return res.status(400).json({ message: '系统盘为现有磁盘时需提供 PVC 名称' });
        if (src !== 'existing' && !(image || rootImage))
          return res.status(400).json({ message: '系统盘为镜像或ISO时需选择镜像' });
        const payload = {
          namespace,
          name,
          cpu: Number(cpu),
          memory: String(memory),
          image: String(image || rootImage || ''),
          networks: Array.isArray(networks) ? networks : [],
          userData: typeof userData === 'string' ? userData : undefined,
          systemDiskSize:
            rootSize || systemDiskSize ? String(rootSize || systemDiskSize) : undefined,
          storageClassName: storageClassName ? String(storageClassName) : undefined,
          nodeName: nodeName ? String(nodeName) : undefined,
          nodeSelector: nodeSelector && typeof nodeSelector === 'object' ? nodeSelector : undefined,
          diskBus: rootBus || diskBus ? String(rootBus || diskBus) : undefined,
          cloudInitAsCdrom: !!cloudInitAsCdrom,
          cloudInitBus: cloudInitBus ? String(cloudInitBus) : undefined,
          bootUseEfi: !!bootUseEfi,
          efiPersistent: !!efiPersistent,
          efiSecureBoot: !!efiSecureBoot,
          extraDisks: Array.isArray(extraDisks) ? extraDisks : undefined,
          netIfaces: Array.isArray(netIfaces) ? netIfaces : undefined,
          rootSourceType: src,
          rootImage: String(rootImage || image || ''),
          rootPvc: rootPvc ? String(rootPvc) : undefined,
          rootName: rootName ? String(rootName) : undefined,
          rootBus: rootBus || diskBus ? String(rootBus || diskBus) : undefined,
          rootSize: rootSize || systemDiskSize ? String(rootSize || systemDiskSize) : undefined,
          rootDeviceType: rootDeviceType ? String(rootDeviceType) : undefined,
          runStrategy: runStrategy ? String(runStrategy) : undefined,
          gpuMode: gpuMode ? String(gpuMode) : undefined,
          gpuResourceName: gpuResourceName ? String(gpuResourceName) : undefined,
          gpuCount: typeof gpuCount === 'number' ? gpuCount : undefined,
          cpuSockets: typeof cpuSockets === 'number' ? cpuSockets : undefined,
          cpuCores: typeof cpuCores === 'number' ? cpuCores : undefined,
          cpuThreads: typeof cpuThreads === 'number' ? cpuThreads : undefined,
          cpuModel: cpuModel ? String(cpuModel) : undefined,
          cpuModelCustom: cpuModelCustom ? String(cpuModelCustom) : undefined,
          dedicatedCPUPlacement: !!dedicatedCPUPlacement,
          isolateEmulatorThread: !!isolateEmulatorThread,
          cpuRequest: typeof cpuRequest === 'number' ? cpuRequest : undefined,
          cpuLimit: typeof cpuLimit === 'number' ? cpuLimit : undefined,
        } as any;
        const vm = buildHarvesterVMManifest(payload);
        return res.json({ message: '预览成功', data: vm });
      } catch (error: any) {
        res.status(500).json({ message: '预览失败', error: error.message });
      }
    },
  );

  router.get(
    '/:id/resources/harvester/nodes',
    checkAdminPermission,
    async (req: any, res: Response) => {
      try {
        const { id } = req.params;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester 资源查询')) return;
        const insecure = !!(cloud.config as any)?.ignoreTls;
        const list = await listHarvesterNodesStandard({
          endpoint: cloud.endpoint,
          token: cloud.secretKey || '',
          insecure,
        } as any);
        res.json({ message: '查询成功', data: { items: list } });
      } catch (error: any) {
        const msg = String(error?.message || '').toLowerCase();
        if (msg.includes('401') || msg.includes('unauthorized'))
          return res.json({ message: '权限不足（nodes）', data: { items: [] } });
        if (msg.includes('404') || msg.includes('not found'))
          return res.json({ message: '未找到节点资源路径（404）', data: { items: [] } });
        res.status(500).json({ message: '查询节点失败', error: error.message });
      }
    },
  );

  router.get(
    '/:id/resources/harvester/health',
    checkAdminPermission,
    async (req: any, res: Response) => {
      try {
        const { id } = req.params;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester 资源查询')) return;
        const insecure = !!(cloud.config as any)?.ignoreTls;
        const report = await harvesterHealthCheck({
          endpoint: cloud.endpoint,
          token: cloud.secretKey || '',
          insecure,
        } as any);
        res.json({ message: '体检完成', data: report });
      } catch (error: any) {
        res.status(500).json({ message: '连接体检失败', error: error.message });
      }
    },
  );

  router.get(
    '/:id/resources/harvester/kubeovn/vpcs',
    checkAdminPermission,
    async (req: any, res: Response) => {
      try {
        const { id } = req.params;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester 资源查询')) return;
        const insecure = !!(cloud.config as any)?.ignoreTls;
        const list = await listKubeOvnVpcs({
          endpoint: cloud.endpoint,
          token: cloud.secretKey || '',
          insecure,
        } as any);
        res.json({ message: '查询成功', data: { items: list } });
      } catch (error: any) {
        const msg = String(error?.message || '').toLowerCase();
        if (msg.includes('401') || msg.includes('unauthorized'))
          return res.json({ message: '权限不足（kube-ovn vpcs）', data: { items: [] } });
        if (msg.includes('404') || msg.includes('not found'))
          return res.json({ message: '未找到 Kube-OVN VPC 资源路径（404）', data: { items: [] } });
        res.status(500).json({ message: '查询 Kube-OVN VPC 失败', error: error.message });
      }
    },
  );

  router.get(
    '/:id/resources/harvester/kubeovn/subnets',
    checkAdminPermission,
    async (req: any, res: Response) => {
      try {
        const { id } = req.params;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester 资源查询')) return;
        const insecure = !!(cloud.config as any)?.ignoreTls;
        const list = await listKubeOvnSubnets({
          endpoint: cloud.endpoint,
          token: cloud.secretKey || '',
          insecure,
        } as any);
        res.json({ message: '查询成功', data: { items: list } });
      } catch (error: any) {
        const msg = String(error?.message || '').toLowerCase();
        if (msg.includes('401') || msg.includes('unauthorized'))
          return res.json({ message: '权限不足（kube-ovn subnets）', data: { items: [] } });
        if (msg.includes('404') || msg.includes('not found'))
          return res.json({
            message: '未找到 Kube-OVN Subnet 资源路径（404）',
            data: { items: [] },
          });
        res.status(500).json({ message: '查询 Kube-OVN 子网失败', error: error.message });
      }
    },
  );

  router.get(
    '/:id/resources/harvester/gpu-resources',
    checkAdminPermission,
    async (req: any, res: Response) => {
      try {
        const { id } = req.params;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!ensureProvider(cloud, 'harvester', res, '仅支持在 Harvester 查询 GPU 资源')) return;
        const insecure = !!(cloud.config as any)?.ignoreTls;
        const items = await listHarvesterGpuResources({
          endpoint: cloud.endpoint,
          token: cloud.secretKey || '',
          insecure,
        } as any);
        res.json({ message: '查询成功', data: { items } });
      } catch (error: any) {
        res.status(500).json({ message: '查询 GPU 资源失败', error: error.message });
      }
    },
  );

  router.get(
    '/:id/resources/harvester/usb-resources',
    checkAdminPermission,
    async (req: any, res: Response) => {
      try {
        const { id } = req.params;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!ensureProvider(cloud, 'harvester', res, '仅支持在 Harvester 查询 USB 资源')) return;
        const insecure = !!(cloud.config as any)?.ignoreTls;
        const items = await listHarvesterUsbResources({
          endpoint: cloud.endpoint,
          token: cloud.secretKey || '',
          insecure,
        } as any);
        res.json({ message: '查询成功', data: { items } });
      } catch (error: any) {
        res.status(500).json({ message: '查询 USB 资源失败', error: error.message });
      }
    },
  );

  router.get(
    '/:id/resources/harvester/system-pods',
    checkAdminPermission,
    async (req: any, res: Response) => {
      try {
        const { id } = req.params;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester 资源查询')) return;
        const insecure = !!(cloud.config as any)?.ignoreTls;
        const list = await listHarvesterSystemPodsStandard({
          endpoint: cloud.endpoint,
          token: cloud.secretKey || '',
          insecure,
        } as any);
        res.json({ message: '查询成功', data: { items: list } });
      } catch (error: any) {
        res.status(500).json({ message: '查询系统组件失败', error: error.message });
      }
    },
  );

  router.get(
    '/:id/resources/harvester/storage-classes',
    checkAdminPermission,
    async (req: any, res: Response) => {
      try {
        const { id } = req.params;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester 资源查询')) return;
        const insecure = !!(cloud.config as any)?.ignoreTls;
        const list = await listHarvesterStorageClassesStandard({
          endpoint: cloud.endpoint,
          token: cloud.secretKey || '',
          insecure,
        } as any);
        res.json({ message: '查询成功', data: { items: list } });
      } catch (error: any) {
        res.status(500).json({ message: '查询存储类失败', error: error.message });
      }
    },
  );

  router.get(
    '/:id/resources/harvester/vms/:namespace/:name',
    checkAdminPermission,
    async (req: any, res: Response) => {
      try {
        const { id, namespace, name } = req.params as any;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester 资源查询')) return;
        const insecure = !!(cloud.config as any)?.ignoreTls;
        const vm = await getHarvesterVM(
          { endpoint: cloud.endpoint, token: cloud.secretKey || '', insecure } as any,
          namespace,
          name,
        );
        res.json({ message: '查询成功', data: vm });
      } catch (error: any) {
        res.status(500).json({ message: '查询VM详情失败', error: error.message });
      }
    },
  );

  router.get(
    '/:id/resources/harvester/vms/:namespace/:name/vnc-url',
    checkAdminPermission,
    async (req: any, res: Response) => {
      try {
        const { id, namespace, name } = req.params as any;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester 资源查询')) return;
        const insecure = !!(cloud.config as any)?.ignoreTls;
        const url = await getHarvesterVmVncUrl(
          { endpoint: cloud.endpoint, token: cloud.secretKey || '', insecure } as any,
          namespace,
          name,
        );
        res.json({ message: '查询成功', data: { VncUrl: url } });
      } catch (error: any) {
        res.status(500).json({ message: '查询VNC地址失败', error: error.message });
      }
    },
  );

  router.patch(
    '/:id/resources/harvester/vms/:namespace/:name/spec',
    checkAdminPermission,
    async (req: any, res: Response) => {
      try {
        const { id, namespace, name } = req.params as any;
        const payload = (req.body || {}) as any;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester 资源操作')) return;
        const insecure = !!(cloud.config as any)?.ignoreTls;
        const data = await updateHarvesterVMSpec(
          { endpoint: cloud.endpoint, token: cloud.secretKey || '', insecure } as any,
          namespace,
          name,
          payload,
        );
        res.json({ message: '更新成功', data });
      } catch (error: any) {
        res.status(500).json({ message: '更新实例规格失败', error: error.message });
      }
    },
  );
};
