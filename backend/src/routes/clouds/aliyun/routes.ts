import { Router } from 'express';
import { registerAliyunEcsRoutes } from './aliyun.ecs.routes';
import { registerAliyunNetworkRoutes } from './aliyun.network.routes';
import { registerAliyunRdsRoutes } from './aliyun.rds.routes';
import { registerAliyunMonitorRoutes } from './aliyun.monitor.routes';
import { registerAliyunStorageRoutes } from './aliyun.storage.routes';
import { registerAliyunEcsSupportRoutes } from './aliyun.ecs-support.routes';

export const registerAliyunRoutes = (router: Router, checkAdminPermission: any) => {
  registerAliyunEcsRoutes(router, checkAdminPermission);
  registerAliyunNetworkRoutes(router, checkAdminPermission);
  registerAliyunRdsRoutes(router, checkAdminPermission);
  registerAliyunMonitorRoutes(router, checkAdminPermission);
  registerAliyunStorageRoutes(router, checkAdminPermission);
  registerAliyunEcsSupportRoutes(router, checkAdminPermission);
};
