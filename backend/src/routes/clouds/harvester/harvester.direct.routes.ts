import { Router, Response } from 'express';
import { registerHarvesterDirectStorageRoutes } from './harvester.direct.storage.routes';
import { registerHarvesterDirectVmRoutes } from './harvester.direct.vm.routes';
import { registerHarvesterDirectNetworkRoutes } from './harvester.direct.network.routes';
import { checkTenantAccess } from './harvester.direct.helpers';

export const registerHarvesterDirectRoutes = (
  router: Router,
  checkAdminPermission: any,
) => {
  registerHarvesterDirectStorageRoutes(router, checkAdminPermission);
  registerHarvesterDirectVmRoutes(router, checkAdminPermission);
  registerHarvesterDirectNetworkRoutes(router, checkAdminPermission);

  router.get(
    '/:id/debug-access',
    async (req: any, res: Response) => {
      try {
        const { id } = req.params;
        const access = await checkTenantAccess(req, id);
        res.json({
          user: {
            id: req.user?.id,
            username: req.user?.username,
            role: req.user?.role,
            tenantId: req.user?.tenantId,
            organizationId: req.user?.organizationId,
          },
          access,
          query: {
            cloudId: id,
          },
        });
      } catch (e: any) {
        res.status(500).json({ error: e.message });
      }
    },
  );
};
