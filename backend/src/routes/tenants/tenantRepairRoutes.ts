import { Router } from 'express';
import { AuthRequest } from '../../middleware/auth';
import { repairTenantDataFromCloud } from '../../services/iam/iamCrdRepair';
import { tenantLog } from './tenantRouteLogger';

/** 租户 IAM CRD 数据修复（须在 /:id 之前注册） */
export function registerTenantRepairRoutes(router: Router): void {
  router.post('/repair-from-crd', async (req: AuthRequest, res) => {
    try {
      const cloudId = String(req.body?.cloudId || '').trim();
      if (!cloudId) {
        return res.status(400).json({ message: '请选择要恢复数据来源的资源池（cloudId）' });
      }

      tenantLog.info(`租户数据修复开始，来源资源池: ${cloudId}`);
      const result = await repairTenantDataFromCloud(cloudId);

      const parts = [
        `租户 ${result.tenants.created + result.tenants.updated}`,
        `组织 ${result.organizations.created + result.organizations.updated}`,
        `资源空间 ${result.userSpaces.created + result.userSpaces.updated}`,
      ];

      res.json({
        message: `已从资源池「${result.cloudName}」恢复：${parts.join('、')}`,
        result,
      });
    } catch (error) {
      const status = (error as { status?: number })?.status ?? 500;
      const detail = error instanceof Error ? error.message : String(error);
      tenantLog.error('租户数据修复失败:', detail);
      res.status(status).json({
        message: status === 502 || status === 404 ? detail : '租户数据修复失败',
        error: detail,
      });
    }
  });
}
