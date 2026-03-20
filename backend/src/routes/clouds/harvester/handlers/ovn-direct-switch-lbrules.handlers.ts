/**
 * OVN Switch LB Rules Handlers (Direct Route)
 *
 * 从 harvester.direct.network.routes.ts 中提取的 Switch LB Rules 相关业务逻辑
 * 直连路由：直接查询 Kube-OVN SwitchLBRule CRD
 */

import { Response } from 'express';
import { getJsonOnce } from '../../../../services/clouds/harvester/utils';
import { checkTenantAccess, fetchCloudOr404, ensureProvider, isNamespaceAllowed } from '../harvester.direct.helpers';

/**
 * GET /:id/resources/switch-lbrules - 查询 Switch LB Rules 列表
 */
export async function harvesterSwitchLbRuleListHandler(
  req: any,
  res: Response,
  next: any,
) {
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
    const url = `${origin}/apis/kubeovn.io/v1/switch-lbrules`;

    const json = await getJsonOnce(url, cloud.secretKey || '', insecure);

    const rawItems = Array.isArray(json?.items)
      ? json?.items
      : Array.isArray(json?.data)
      ? json?.data
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
      items = items.filter((i: any) =>
        isNamespaceAllowed(tenantNamespace, i.metadata?.namespace),
      );
    }

    res.json({ message: '查询成功', data: { items } });
  } catch (error: any) {
    if (res.headersSent) return;
    res.status(500).json({
      message: '查询负载均衡规则失败',
      error: error.body || error.message,
    });
  }
}
