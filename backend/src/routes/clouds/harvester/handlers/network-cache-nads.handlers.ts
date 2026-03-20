/**
 * Harvester NADs Handlers
 */

import { Request, Response } from 'express';
import { AppDataSource } from '../../../../config/database';
import { KubevirtNadInventory } from '../../../../entities/kubevirt/KubevirtNadInventory';
import { UserSpace } from '../../../../entities/UserSpace';
import { syncHarvesterNads } from '../../../../services/clouds/harvester/inventory';
import { requestJson, getJsonOnce } from '../../../../services/clouds/harvester/utils';

export async function harvesterNadListHandler(req: Request, res: Response) {
  try {
    const cloud = (req as any).cloud;
    const { id } = req.params;
    const insecure = !!(cloud.config as any)?.ignoreTls;
    const reqAny = req as any;

    const repo = AppDataSource.getRepository(KubevirtNadInventory);
    let whereCondition: any = { cloudId: id };
    
    const isTenantUser = reqAny.user?.tenantId && reqAny.user?.role !== 'sase_device';
    const isTenantRole = reqAny.user?.role === 'tenant';
    const isTenant = isTenantUser || isTenantRole;
    
    if (isTenant) {
      const userSpaceRepo = AppDataSource.getRepository(UserSpace);
      const where: any = {
        tenantId: reqAny.user.tenantId,
        cloudId: id,
        status: 'active',
      };
      if (reqAny.user.organizationId) {
        where.organizationId = reqAny.user.organizationId;
      }
      const us = await userSpaceRepo.findOne({ where });
      if (!us) return res.json({ message: '查询成功', data: { items: [] } });
      
      if (us.namespace) {
        const allowed = us.namespace.split(',').map((s) => s.trim()).filter(Boolean);
        
        if (reqAny.user.organizationId) {
          const orgNs = `ns-${reqAny.user.organizationId}`;
          if (!allowed.includes(orgNs)) {
            allowed.push(orgNs);
            us.namespace = allowed.join(',');
            try {
              await userSpaceRepo.save(us);
            } catch (e) {
              console.warn('Failed to auto-update UserSpace namespace', e);
            }
          }
        }
        
        whereCondition = [
          ...allowed.map((ns) => ({ cloudId: id, namespace: ns })),
          { cloudId: id, namespace: 'cloud-public' },
          { cloudId: id, namespace: 'Cloud-Public' },
          { cloudId: id, namespace: 'harvester-public' },
          { cloudId: id, namespace: 'default' },
        ];
      } else {
        whereCondition = [
          { cloudId: id, namespace: 'cloud-public' },
          { cloudId: id, namespace: 'Cloud-Public' },
          { cloudId: id, namespace: 'harvester-public' },
          { cloudId: id, namespace: 'default' },
        ];
      }
    }

    const { force, skipSync } = req.query;
    const count = await repo.count({ where: whereCondition });
    const shouldSync = count === 0 || (String(force) === 'true' && String(skipSync) !== 'true');
    
    if (shouldSync) {
      try {
        await syncHarvesterNads(cloud, insecure);
      } catch (e: any) {
        console.warn('Sync NADs failed, falling back to empty/stale', e);
        if (count === 0) throw e;
      }
    }

    const items = await repo.find({ where: whereCondition });
    const list = items.map((item: any) => {
      const v = item.rawData || {};
      const name = v?.metadata?.name || item.name || '';
      const namespace = v?.metadata?.namespace || item.namespace || '';
      const displayName = v?.spec?.displayName || item.displayName || name;
      return {
        ...v,
        name,
        namespace,
        displayName,
        raw: v,
      };
    });

    res.json({ message: '查询成功', data: { items: list } });
  } catch (error: any) {
    if (res.headersSent) return;
    res.status(500).json({ message: '查询网络附件定义失败', error: error.message });
  }
}

/**
 * GET /:id/resources/harvester/nads/:namespace/:name - 获取 NAD 详情
 */
export async function harvesterNadDetailHandler(req: Request, res: Response) {
  try {
    const cloud = (req as any).cloud;
    const { id, namespace, name } = req.params;
    const insecure = !!(cloud.config as any)?.ignoreTls;

    let path = `/apis/k8s.cni.cncf.io/v1/namespaces/${encodeURIComponent(
      namespace,
    )}/network-attachment-definitions/${encodeURIComponent(name)}`;

    try {
      const repo = AppDataSource.getRepository(KubevirtNadInventory);
      const item = await repo.findOne({ where: { cloudId: id, namespace, name } });
      if (item?.rawData?.links?.view) {
        const urlObj = new URL(item.rawData.links.view);
        path = urlObj.pathname;
      }
    } catch (e) {}

    const data = await requestJson(
      'GET',
      cloud.endpoint + path,
      cloud.secretKey || '',
      insecure,
    );

    res.json(data);
  } catch (error: any) {
    if (res.headersSent) return;
    res.status(500).json({ message: '获取网络附件定义详情失败', error: error.message });
  }
}

/**
 * POST /:id/resources/harvester/nads - 创建 NAD
 */
export async function harvesterNadCreateHandler(req: Request, res: Response) {
  try {
    const cloud = (req as any).cloud;
    const { id } = req.params;
    const namespace = req.body.namespace || req.body.metadata?.namespace;

    if (!namespace) {
      return res.status(400).json({ message: '缺少必要参数: namespace' });
    }

    const insecure = !!(cloud.config as any)?.ignoreTls;

    let endpoint = (cloud.endpoint || '').replace(/\/+$/, '');

    if (!endpoint.includes('/k8s/clusters/')) {
      endpoint = endpoint.replace(/\/v[0-9]+(\/harvester)?$/, '');
    }

    const nsEncoded = encodeURIComponent(namespace);

    // [Feature] 平台托管标记 (Platform Managed)
    // 添加 tower.io/managed Finalizer 和 tower.io/creator 标签，与虚拟机保持一致
    const nadPayload = JSON.parse(JSON.stringify(req.body)); // Clone to avoid side effects
    if (!nadPayload.metadata) nadPayload.metadata = {};
    if (!nadPayload.metadata.finalizers) nadPayload.metadata.finalizers = [];
    const managedFinalizer = 'tower.io/managed';
    if (!nadPayload.metadata.finalizers.includes(managedFinalizer)) {
      nadPayload.metadata.finalizers.push(managedFinalizer);
    }
    if (!nadPayload.metadata.labels) nadPayload.metadata.labels = {};
    nadPayload.metadata.labels['tower.io/creator'] = 'compute-tower';

    console.log(
      `[NAD Create] Payload for ${namespace}:`,
      JSON.stringify(nadPayload, null, 2),
    );

    const candidates = [
      `${endpoint}/apis/k8s.cni.cncf.io/v1/namespaces/${nsEncoded}/network-attachment-definitions`,
      `${endpoint}/apis/k8s.cni.cncf.io/v1/namespaces/${nsEncoded}/networkattachmentdefinitions`,
      `${endpoint}/v1/harvester/k8s.cni.cncf.io.network-attachment-definitions`,
      `${endpoint}/v1/harvester/k8s.cni.cncf.io.networkattachmentdefinitions`,
    ];

    let lastError: any = null;
    let success = false;

    // [多路径兼容] 尝试多种 API 路径创建 NAD
    // Harvester 版本差异可能导致 API 路径不同 (K8s 原生 vs Rancher 代理)。
    let createdData: any = null;
    for (const url of candidates) {
      try {
        const data = await requestJson(
          'POST',
          url,
          cloud.secretKey || '',
          insecure,
          nadPayload,
        );
        createdData = data;
        success = true;
        break;
      } catch (innerError: any) {
        const status = Number(innerError.status || 0);
        const msg = String(innerError.message || '');

        if (
          status === 404 ||
          status === 405 ||
          status === 422 ||
          status === 400 ||
          msg.includes('404')
        ) {
          lastError = innerError;
          continue;
        }
        throw innerError;
      }
    }

    if (!success) {
      console.error(
        `[NAD Create Error] All candidates failed. Namespace: ${namespace}. Last Error: ${lastError?.message}`,
      );
      const lastErrorDetail = lastError?.body
        ? ` Details: ${lastError.body}`
        : '';
      throw new Error(
        `Harvester API 404 Not Found. 无法找到有效的创建路径 (尝试了标准K8s API和Rancher API)。请检查命名空间 '${namespace}' 是否存在。${lastErrorDetail}`,
      );
    }

    // [数据同步] 创建成功后，直接使用返回的数据入库（标准做法：使用返回的数据，无需延迟和全量同步）
    if (createdData && createdData.metadata) {
      try {
        const repo = AppDataSource.getRepository(KubevirtNadInventory);
        const uid = createdData.metadata?.uid || createdData.id || '';
        const existing = await repo.findOne({ where: { cloudId: cloud.id, uid } });
        
        if (existing) {
          // 更新现有记录
          existing.name = createdData.metadata?.name || '';
          existing.namespace = createdData.metadata?.namespace || namespace;
          existing.links = createdData.links;
          existing.config = createdData.spec?.config;
          try {
            existing.type = JSON.parse(createdData.spec?.config || '{}').type;
          } catch {
            existing.type = undefined;
          }
          existing.labels = createdData.metadata?.labels;
          existing.annotations = createdData.metadata?.annotations;
          existing.rawData = createdData;
          await repo.save(existing);
          console.log(`[NAD-Create] 网络已更新，cloudId: ${cloud.id}, name: ${createdData.metadata?.name}`);
        } else {
          // 插入新记录
          const entity = repo.create({
            cloudId: cloud.id,
            uid: uid,
            name: createdData.metadata?.name || '',
            namespace: createdData.metadata?.namespace || namespace,
            links: createdData.links,
            config: createdData.spec?.config,
            type: (() => {
              try {
                return JSON.parse(createdData.spec?.config || '{}').type;
              } catch {
                return undefined;
              }
            })(),
            labels: createdData.metadata?.labels,
            annotations: createdData.metadata?.annotations,
            rawData: createdData,
          });
          await repo.save(entity);
          console.log(`[NAD-Create] 网络已入库，cloudId: ${cloud.id}, name: ${createdData.metadata?.name}`);
        }
      } catch (e: any) {
        console.error('[NAD-Create] 入库网络失败:', e?.message || e);
        // 入库失败不影响创建操作的成功返回
      }
    }

    res.json({ message: '创建成功', data: createdData });
  } catch (error: any) {
    if (res.headersSent) return;
    const rawError = error.body || error.message;
    res.status(500).json({ message: '创建网络附件定义失败', error: rawError });
  }
}

/**
 * DELETE /:id/resources/harvester/nads/:namespace/:name - 删除 NAD
 */
export async function harvesterNadDeleteHandler(req: Request, res: Response) {
  try {
    const cloud = (req as any).cloud;
    const { id, namespace, name } = req.params;
    const insecure = !!(cloud.config as any)?.ignoreTls;

    let endpoint = (cloud.endpoint || '').replace(/\/+$/, '');
    if (!endpoint.includes('/k8s/clusters/')) {
      endpoint = endpoint.replace(/\/v[0-9]+(\/harvester)?$/, '');
    }
    const nsEncoded = encodeURIComponent(namespace);

    const candidates = [
      `${endpoint}/apis/k8s.cni.cncf.io/v1/namespaces/${nsEncoded}/network-attachment-definitions/${name}`,
      `${endpoint}/apis/k8s.cni.cncf.io/v1/namespaces/${nsEncoded}/networkattachmentdefinitions/${name}`,
      `${endpoint}/v1/harvester/k8s.cni.cncf.io.network-attachment-definitions/${namespace}/${name}`,
      `${endpoint}/v1/harvester/k8s.cni.cncf.io.networkattachmentdefinitions/${namespace}/${name}`,
    ];

    const managedFinalizer = 'tower.io/managed';
    for (const url of candidates) {
      if (!url.includes('/apis/k8s.cni.cncf.io/')) continue;
      try {
        const current = await getJsonOnce(
          url,
          cloud.secretKey || '',
          insecure,
        );
        const finalizers = current?.metadata?.finalizers;
        if (!Array.isArray(finalizers) || !finalizers.includes(managedFinalizer)) {
          continue;
        }
        const indicesToRemove = finalizers
          .map((f: any, i: number) => (f === managedFinalizer ? i : -1))
          .filter((i: number) => i >= 0)
          .sort((a: number, b: number) => b - a);
        if (indicesToRemove.length > 0) {
          const patchOps = indicesToRemove.map((index: number) => ({
            op: 'remove',
            path: `/metadata/finalizers/${index}`,
          }));
          await requestJson(
            'PATCH',
            url,
            cloud.secretKey || '',
            insecure,
            patchOps,
            { 'Content-Type': 'application/json-patch+json' },
          );
        }
      } catch {}
    }

    let lastError: any = null;
    let success = false;

    // [多路径兼容] 尝试多种 API 路径删除 NAD
    // Harvester 版本差异可能导致 API 路径不同 (K8s 原生 vs Rancher 代理)。
    for (const url of candidates) {
      try {
        await requestJson('DELETE', url, cloud.secretKey || '', insecure);
        success = true;
        break;
      } catch (e: any) {
        lastError = e;
      }
    }

    if (success) {
      syncHarvesterNads(cloud, insecure).catch((e) =>
        console.error('Background sync failed', e),
      );
      return res.json({ message: '删除成功' });
    }

    const rawError = lastError?.body || lastError?.message || '未知错误';
    res.status(500).json({ message: '删除失败', error: rawError });
  } catch (error: any) {
    if (res.headersSent) return;
    res.status(500).json({ message: '删除失败', error: error.message });
  }
}
