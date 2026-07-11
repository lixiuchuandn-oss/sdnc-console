import { Router } from 'express';
import { listVrInstancesByTenant } from '../../services/sdnc/northboundVrInstances';

export const sdncNorthboundV1Routes = Router();

/**
 * SDNC 北向 API（定稿）：仅 VR 按租户查询，供 Tower 主平台代调。
 * 租户「SDN 资产」页只展示 IRD（Tower 本地）；IBR 能力经页面嵌套访问 SDNC。
 */
sdncNorthboundV1Routes.get('/vr-instances', async (req, res) => {
  try {
    const tenantId = String(req.query.tenant_id || req.query.tenantId || '').trim();
    const organizationId =
      String(req.query.organization_id || req.query.organizationId || '').trim() || undefined;

    if (!tenantId) {
      return res.status(400).json({ code: 400, message: 'tenant_id is required' });
    }

    const list = await listVrInstancesByTenant({ tenantId, organizationId });
    return res.json({
      code: 200,
      data: {
        total: list.length,
        list,
      },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'internal error';
    return res.status(500).json({ code: 500, message });
  }
});
