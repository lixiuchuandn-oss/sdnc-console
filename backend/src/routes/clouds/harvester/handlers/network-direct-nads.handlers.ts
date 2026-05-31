/**
 * Network NADs Handlers (Direct Route)
 *
 * 从 harvester.direct.network.routes.ts 中提取的 NADs 直连查询相关业务逻辑
 * 直连路由：直接从 K8s API 查询 NetworkAttachmentDefinition
 */

import { Response } from 'express';
import { getJsonOnce, requestJson } from '../../../../services/clouds/harvester/utils';
import {
  checkTenantAccess,
  fetchCloudOr404,
  ensureProvider,
  isNamespaceAllowed,
} from '../harvester.direct.helpers';

/**
 * GET /:id/resources/nads - 获取 NAD 列表（直连查询）
 */
export async function harvesterNadDirectListHandler(req: any, res: Response, next: any) {
  try {
    const { id } = req.params;
    const { allowed, namespace: tenantNamespace, isTenant } = await checkTenantAccess(req, id);
    if (!allowed) {
      return res.status(403).json({ message: 'Access denied to this resource pool' });
    }

    const cloud = await fetchCloudOr404(id, res);
    if (!cloud) return;
    if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester 资源查询', next)) return;
    const insecure = !!(cloud.config as any)?.ignoreTls;

    const base = (cloud.endpoint || '').replace(/\/+$/, '');
    let origin = base;
    try {
      const u = new URL(base);
      origin = `${u.protocol}//${u.host}`;
    } catch {
      origin = base.replace(/\/v[0-9].*$/, '');
    }
    const url = `${origin}/v1/harvester/k8s.cni.cncf.io.network-attachment-definitions`;

    const json = await getJsonOnce(url, cloud.secretKey || '', insecure);

    const rawItems = Array.isArray(json?.data)
      ? json?.data
      : Array.isArray(json?.items)
        ? json?.items
        : [];
    let items = rawItems;
    if (isTenant) {
      if (tenantNamespace) {
        items = items.filter((i: any) =>
          isNamespaceAllowed(tenantNamespace, i.metadata?.namespace),
        );
      } else {
        items = [];
      }
    } else if (tenantNamespace) {
      items = items.filter((i: any) => isNamespaceAllowed(tenantNamespace, i.metadata?.namespace));
    }

    res.json({ message: '查询成功', data: { items } });
  } catch (error: any) {
    if (res.headersSent) return;
    res.status(500).json({
      message: '查询网络失败',
      error: error.body || error.message,
    });
  }
}

/**
 * GET /:id/resources/harvester/nads/:namespace/:name - 获取 NAD 详情（直连查询）
 */
export async function harvesterNadDirectDetailHandler(req: any, res: Response, next: any) {
  try {
    const { id, namespace, name } = req.params;
    const { allowed, namespace: tenantNamespace } = await checkTenantAccess(req, id);
    if (!allowed) {
      return res.status(403).json({ message: 'Access denied to this resource pool' });
    }

    if (tenantNamespace && !isNamespaceAllowed(tenantNamespace, namespace)) {
      return res.status(403).json({ message: 'Access denied to this namespace' });
    }

    const cloud = await fetchCloudOr404(id, res);
    if (!cloud) return;
    if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester 资源查询', next)) return;
    const insecure = !!(cloud.config as any)?.ignoreTls;

    const base = (cloud.endpoint || '').replace(/\/+$/, '');
    let origin = base;
    try {
      const u = new URL(base);
      origin = `${u.protocol}//${u.host}`;
    } catch {
      origin = base.replace(/\/v[0-9].*$/, '');
    }

    const url = `${origin}/apis/k8s.cni.cncf.io/v1/namespaces/${encodeURIComponent(
      namespace,
    )}/network-attachment-definitions/${encodeURIComponent(name)}`;
    const json = await requestJson('GET', url, cloud.secretKey || '', insecure);
    res.json({ message: '查询成功', data: json });
  } catch (error: any) {
    if (res.headersSent) return;
    res.status(500).json({
      message: '获取网络附件定义详情失败',
      error: error.body || error.message,
    });
  }
}
