import { Router } from 'express';
import { registerTenantCrudRoutes } from './tenantCrudRoutes';
import { registerTenantOrganizationRoutes } from './tenantOrganizationRoutes';
import { registerTenantUserRoutes } from './tenantUserRoutes';

/**
 * 租户与组织 / 租户用户（SDNC：供 VR 绑定下拉与系统设置维护）。
 */
const router = Router();

registerTenantCrudRoutes(router);
registerTenantOrganizationRoutes(router);
registerTenantUserRoutes(router);

export { router as tenantRoutes };
