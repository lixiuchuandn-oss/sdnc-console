import { Router } from 'express';
import { registerTenantCrudRoutes } from './tenantCrudRoutes';
import { registerTenantOrganizationRoutes } from './tenantOrganizationRoutes';
import { registerTenantResourcePoolRoutes } from './tenantResourcePoolRoutes';
import { registerTenantUserRoutes } from './tenantUserRoutes';

/**
 * 租户与组织 / 租户用户 / 资源池分配路由聚合。
 * 各 register 内部已保证字面量路径（如 available-resource-pools）先于参数路由注册。
 */
const router = Router();

registerTenantCrudRoutes(router);
registerTenantOrganizationRoutes(router);
registerTenantUserRoutes(router);
registerTenantResourcePoolRoutes(router);

export { router as tenantRoutes };
