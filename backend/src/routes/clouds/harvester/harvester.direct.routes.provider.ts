/**
 * Harvester 直连路由注册（策略模式+中间件）
 * 使用 provider-router 中间件统一处理不同供应商的路由分发
 * 
 * 从 harvester.direct.vm.routes.ts 中迁移的 VM 操作路由
 */

import { Router, RequestHandler } from 'express';
import { json } from 'express';
import { createProviderRouter } from '../middleware/provider-router';
import {
  harvesterEcsStreamHandler,
  harvesterEcsVncUrlHandler,
  harvesterEcsAddVolumeHandler,
  harvesterEcsRemoveVolumeHandler,
  harvesterEcsMigrateHandler,
  harvesterEcsAbortMigrationHandler,
  harvesterGpuResourcesHandler,
  harvesterUsbResourcesHandler,
  harvesterMigrationsDirectHandler,
  harvesterEcsAggregatedHandler,
  harvesterVmActionHandler,
} from './handlers/ecs-direct-operations.handlers';
import {
  harvesterEcsStartHandler,
  harvesterEcsStopHandler,
  harvesterEcsRebootHandler,
  harvesterEcsSoftRebootHandler,
  harvesterEcsPauseHandler,
  harvesterEcsUnpauseHandler,
  harvesterEcsDeleteHandler,
  harvesterEcsRestoreHandler,
  harvesterEcsForceDeleteHandler,
  harvesterVmStartByNamespaceHandler,
  harvesterVmStopByNamespaceHandler,
} from './handlers/ecs-direct-lifecycle.handlers';
import {
  harvesterEcsCreateHandler,
  harvesterEcsUpdateHandler,
  harvesterVmUpdateSpecHandler,
  harvesterVmPatchHandler,
  harvesterEcsCreateFromTemplateHandler,
  harvesterEcsSaveAsTemplateHandler,
} from './handlers/ecs-direct-crud.handlers';
import {
  harvesterSubnetDirectListHandler,
  harvesterSubnetDirectCreateHandler,
  harvesterSubnetDirectUpdateHandler,
  harvesterSubnetDirectDeleteHandler,
} from './handlers/ovn-direct-subnets.handlers';
import {
  kubeOvnSecurityGroupListHandler,
  kubeOvnSecurityGroupCreateHandler,
  kubeOvnSecurityGroupDetailHandler,
  kubeOvnSecurityGroupReplaceRulesHandler,
  kubeOvnSecurityGroupUpdateHandler,
  kubeOvnSecurityGroupDeleteHandler,
  kubeOvnSecurityGroupAddMembersHandler,
  kubeOvnSecurityGroupRemoveMemberHandler,
} from './handlers/kube-ovn-security-groups.handlers';
import {
  harvesterProviderNetworkListHandler,
  harvesterProviderNetworkCreateHandler,
  harvesterProviderNetworkDeleteHandler,
} from './handlers/ovn-direct-provider-networks.handlers';
import {
  harvesterVlanListHandler,
  harvesterVlanCreateHandler,
  harvesterVlanDeleteHandler,
} from './handlers/ovn-direct-vlans.handlers';
import { harvesterSwitchLbRuleListHandler } from './handlers/ovn-direct-switch-lbrules.handlers';
import {
  harvesterNadDirectListHandler,
  harvesterNadDirectDetailHandler,
} from './handlers/network-direct-nads.handlers';
import {
  harvesterOvnEipListHandler,
  harvesterOvnEipCreateHandler,
  harvesterOvnFipListHandler,
  harvesterOvnFipCreateHandler,
  harvesterOvnSnatCreateHandler,
  harvesterOvnSnatListHandler,
  harvesterOvnDnatCreateHandler,
  harvesterOvnDnatListHandler,
} from './handlers/ovn-direct-eip-fip-nat.handlers';
import {
  harvesterLbListHandler,
  harvesterLbCreateHandler,
  harvesterServiceDirectListHandler,
  harvesterLbDeleteHandler,
  harvesterIpPoolListHandler,
  harvesterIpPoolCreateHandler,
  harvesterIpPoolDeleteHandler,
} from './handlers/network-direct-lb-ippool.handlers';
import {
  harvesterVolumeDirectListHandler,
  harvesterVolumeDirectDetailHandler,
  harvesterAvailableVolumesDirectHandler,
  harvesterVolumeDirectCreateHandler,
  harvesterVolumeDirectDeleteHandler,
  harvesterVolumeDirectUpdateHandler,
} from './handlers/storage-direct-volumes.handlers';
import {
  harvesterSnapshotRestoreHandler,
  harvesterVolumeSnapshotCreateHandler,
  harvesterVolumeSnapshotLegacyHandler,
  harvesterSnapshotClassesListHandler,
} from './handlers/storage-direct-snapshots.handlers';
import {
  harvesterVolumeExportImageHandler,
  harvesterVolumeCloneHandler,
  harvesterVolumeExportImageLegacyHandler,
  harvesterVolumeCloneLegacyHandler,
} from './handlers/storage-direct-volume-ops.handlers';
import {
  harvesterCapabilitiesDirectHandler,
  harvesterStorageClassDetailHandler,
} from './handlers/storage-direct-capabilities.handlers';

export function registerHarvesterDirectRoutesProvider(
  router: Router,
  checkAdminPermission: RequestHandler
) {
  // ECS Stream Handlers
  const ecsStreamHandlers = {
    harvester: harvesterEcsStreamHandler,
    cloudmap: harvesterEcsStreamHandler,
    'cloudmap.private': harvesterEcsStreamHandler,
    'cloudmap.edge': harvesterEcsStreamHandler,
  };

  // ECS Lifecycle Handlers
  const ecsStartHandlers = {
    harvester: harvesterEcsStartHandler,
    cloudmap: harvesterEcsStartHandler,
    'cloudmap.private': harvesterEcsStartHandler,
    'cloudmap.edge': harvesterEcsStartHandler,
  };

  const ecsStopHandlers = {
    harvester: harvesterEcsStopHandler,
    cloudmap: harvesterEcsStopHandler,
    'cloudmap.private': harvesterEcsStopHandler,
    'cloudmap.edge': harvesterEcsStopHandler,
  };

  const ecsRebootHandlers = {
    harvester: harvesterEcsRebootHandler,
    cloudmap: harvesterEcsRebootHandler,
    'cloudmap.private': harvesterEcsRebootHandler,
    'cloudmap.edge': harvesterEcsRebootHandler,
  };

  const ecsSoftRebootHandlers = {
    harvester: harvesterEcsSoftRebootHandler,
    cloudmap: harvesterEcsSoftRebootHandler,
    'cloudmap.private': harvesterEcsSoftRebootHandler,
    'cloudmap.edge': harvesterEcsSoftRebootHandler,
  };

  const ecsPauseHandlers = {
    harvester: harvesterEcsPauseHandler,
    cloudmap: harvesterEcsPauseHandler,
    'cloudmap.private': harvesterEcsPauseHandler,
    'cloudmap.edge': harvesterEcsPauseHandler,
  };

  const ecsUnpauseHandlers = {
    harvester: harvesterEcsUnpauseHandler,
    cloudmap: harvesterEcsUnpauseHandler,
    'cloudmap.private': harvesterEcsUnpauseHandler,
    'cloudmap.edge': harvesterEcsUnpauseHandler,
  };

  const ecsDeleteHandlers = {
    harvester: harvesterEcsDeleteHandler,
    cloudmap: harvesterEcsDeleteHandler,
    'cloudmap.private': harvesterEcsDeleteHandler,
    'cloudmap.edge': harvesterEcsDeleteHandler,
  };

  const ecsRestoreHandlers = {
    harvester: harvesterEcsRestoreHandler,
    cloudmap: harvesterEcsRestoreHandler,
    'cloudmap.private': harvesterEcsRestoreHandler,
    'cloudmap.edge': harvesterEcsRestoreHandler,
  };

  const ecsForceDeleteHandlers = {
    harvester: harvesterEcsForceDeleteHandler,
    cloudmap: harvesterEcsForceDeleteHandler,
    'cloudmap.private': harvesterEcsForceDeleteHandler,
    'cloudmap.edge': harvesterEcsForceDeleteHandler,
  };

  // ECS CRUD Handlers
  const ecsCreateHandlers = {
    harvester: harvesterEcsCreateHandler,
    cloudmap: harvesterEcsCreateHandler,
    'cloudmap.private': harvesterEcsCreateHandler,
    'cloudmap.edge': harvesterEcsCreateHandler,
  };

  const ecsUpdateHandlers = {
    harvester: harvesterEcsUpdateHandler,
    cloudmap: harvesterEcsUpdateHandler,
    'cloudmap.private': harvesterEcsUpdateHandler,
    'cloudmap.edge': harvesterEcsUpdateHandler,
  };

  const vmUpdateSpecHandlers = {
    harvester: harvesterVmUpdateSpecHandler,
    cloudmap: harvesterVmUpdateSpecHandler,
    'cloudmap.private': harvesterVmUpdateSpecHandler,
    'cloudmap.edge': harvesterVmUpdateSpecHandler,
  };

  const vmPatchHandlers = {
    harvester: harvesterVmPatchHandler,
    cloudmap: harvesterVmPatchHandler,
    'cloudmap.private': harvesterVmPatchHandler,
    'cloudmap.edge': harvesterVmPatchHandler,
  };

  // ECS VNC Handlers
  const ecsVncUrlHandlers = {
    harvester: harvesterEcsVncUrlHandler,
    cloudmap: harvesterEcsVncUrlHandler,
    'cloudmap.private': harvesterEcsVncUrlHandler,
    'cloudmap.edge': harvesterEcsVncUrlHandler,
  };

  // ECS Volume Handlers
  const ecsAddVolumeHandlers = {
    harvester: harvesterEcsAddVolumeHandler,
    cloudmap: harvesterEcsAddVolumeHandler,
    'cloudmap.private': harvesterEcsAddVolumeHandler,
    'cloudmap.edge': harvesterEcsAddVolumeHandler,
  };

  const ecsRemoveVolumeHandlers = {
    harvester: harvesterEcsRemoveVolumeHandler,
    cloudmap: harvesterEcsRemoveVolumeHandler,
    'cloudmap.private': harvesterEcsRemoveVolumeHandler,
    'cloudmap.edge': harvesterEcsRemoveVolumeHandler,
  };

  // ECS Migration Handlers
  const ecsMigrateHandlers = {
    harvester: harvesterEcsMigrateHandler,
    cloudmap: harvesterEcsMigrateHandler,
    'cloudmap.private': harvesterEcsMigrateHandler,
    'cloudmap.edge': harvesterEcsMigrateHandler,
  };

  const ecsAbortMigrationHandlers = {
    harvester: harvesterEcsAbortMigrationHandler,
    cloudmap: harvesterEcsAbortMigrationHandler,
    'cloudmap.private': harvesterEcsAbortMigrationHandler,
    'cloudmap.edge': harvesterEcsAbortMigrationHandler,
  };

  // Hardware Resources Handlers
  const gpuResourcesHandlers = {
    harvester: harvesterGpuResourcesHandler,
    cloudmap: harvesterGpuResourcesHandler,
    'cloudmap.private': harvesterGpuResourcesHandler,
    'cloudmap.edge': harvesterGpuResourcesHandler,
  };

  const usbResourcesHandlers = {
    harvester: harvesterUsbResourcesHandler,
    cloudmap: harvesterUsbResourcesHandler,
    'cloudmap.private': harvesterUsbResourcesHandler,
    'cloudmap.edge': harvesterUsbResourcesHandler,
  };

  const migrationsDirectHandlers = {
    harvester: harvesterMigrationsDirectHandler,
    cloudmap: harvesterMigrationsDirectHandler,
    'cloudmap.private': harvesterMigrationsDirectHandler,
    'cloudmap.edge': harvesterMigrationsDirectHandler,
  };

  const ecsAggregatedHandlers = {
    harvester: harvesterEcsAggregatedHandler,
    cloudmap: harvesterEcsAggregatedHandler,
    'cloudmap.private': harvesterEcsAggregatedHandler,
    'cloudmap.edge': harvesterEcsAggregatedHandler,
  };

  const subnetListHandlers = {
    harvester: harvesterSubnetDirectListHandler,
    cloudmap: harvesterSubnetDirectListHandler,
    'cloudmap.private': harvesterSubnetDirectListHandler,
    'cloudmap.edge': harvesterSubnetDirectListHandler,
  };
  const subnetCreateHandlers = {
    harvester: harvesterSubnetDirectCreateHandler,
    cloudmap: harvesterSubnetDirectCreateHandler,
    'cloudmap.private': harvesterSubnetDirectCreateHandler,
    'cloudmap.edge': harvesterSubnetDirectCreateHandler,
  };
  const subnetUpdateHandlers = {
    harvester: harvesterSubnetDirectUpdateHandler,
    cloudmap: harvesterSubnetDirectUpdateHandler,
    'cloudmap.private': harvesterSubnetDirectUpdateHandler,
    'cloudmap.edge': harvesterSubnetDirectUpdateHandler,
  };
  const subnetDeleteHandlers = {
    harvester: harvesterSubnetDirectDeleteHandler,
    cloudmap: harvesterSubnetDirectDeleteHandler,
    'cloudmap.private': harvesterSubnetDirectDeleteHandler,
    'cloudmap.edge': harvesterSubnetDirectDeleteHandler,
  };

  const kubeOvnSgListHandlers = {
    harvester: kubeOvnSecurityGroupListHandler,
    cloudmap: kubeOvnSecurityGroupListHandler,
    'cloudmap.private': kubeOvnSecurityGroupListHandler,
    'cloudmap.edge': kubeOvnSecurityGroupListHandler,
  };
  const kubeOvnSgCreateHandlers = {
    harvester: kubeOvnSecurityGroupCreateHandler,
    cloudmap: kubeOvnSecurityGroupCreateHandler,
    'cloudmap.private': kubeOvnSecurityGroupCreateHandler,
    'cloudmap.edge': kubeOvnSecurityGroupCreateHandler,
  };
  const kubeOvnSgDetailHandlers = {
    harvester: kubeOvnSecurityGroupDetailHandler,
    cloudmap: kubeOvnSecurityGroupDetailHandler,
    'cloudmap.private': kubeOvnSecurityGroupDetailHandler,
    'cloudmap.edge': kubeOvnSecurityGroupDetailHandler,
  };
  const kubeOvnSgReplaceRulesHandlers = {
    harvester: kubeOvnSecurityGroupReplaceRulesHandler,
    cloudmap: kubeOvnSecurityGroupReplaceRulesHandler,
    'cloudmap.private': kubeOvnSecurityGroupReplaceRulesHandler,
    'cloudmap.edge': kubeOvnSecurityGroupReplaceRulesHandler,
  };
  const kubeOvnSgAddMembersHandlers = {
    harvester: kubeOvnSecurityGroupAddMembersHandler,
    cloudmap: kubeOvnSecurityGroupAddMembersHandler,
    'cloudmap.private': kubeOvnSecurityGroupAddMembersHandler,
    'cloudmap.edge': kubeOvnSecurityGroupAddMembersHandler,
  };
  const kubeOvnSgRemoveMemberHandlers = {
    harvester: kubeOvnSecurityGroupRemoveMemberHandler,
    cloudmap: kubeOvnSecurityGroupRemoveMemberHandler,
    'cloudmap.private': kubeOvnSecurityGroupRemoveMemberHandler,
    'cloudmap.edge': kubeOvnSecurityGroupRemoveMemberHandler,
  };
  const kubeOvnSgUpdateHandlers = {
    harvester: kubeOvnSecurityGroupUpdateHandler,
    cloudmap: kubeOvnSecurityGroupUpdateHandler,
    'cloudmap.private': kubeOvnSecurityGroupUpdateHandler,
    'cloudmap.edge': kubeOvnSecurityGroupUpdateHandler,
  };
  const kubeOvnSgDeleteHandlers = {
    harvester: kubeOvnSecurityGroupDeleteHandler,
    cloudmap: kubeOvnSecurityGroupDeleteHandler,
    'cloudmap.private': kubeOvnSecurityGroupDeleteHandler,
    'cloudmap.edge': kubeOvnSecurityGroupDeleteHandler,
  };
  const providerNetworkListHandlers = {
    harvester: harvesterProviderNetworkListHandler,
    cloudmap: harvesterProviderNetworkListHandler,
    'cloudmap.private': harvesterProviderNetworkListHandler,
    'cloudmap.edge': harvesterProviderNetworkListHandler,
  };
  const providerNetworkCreateHandlers = {
    harvester: harvesterProviderNetworkCreateHandler,
    cloudmap: harvesterProviderNetworkCreateHandler,
    'cloudmap.private': harvesterProviderNetworkCreateHandler,
    'cloudmap.edge': harvesterProviderNetworkCreateHandler,
  };
  const providerNetworkDeleteHandlers = {
    harvester: harvesterProviderNetworkDeleteHandler,
    cloudmap: harvesterProviderNetworkDeleteHandler,
    'cloudmap.private': harvesterProviderNetworkDeleteHandler,
    'cloudmap.edge': harvesterProviderNetworkDeleteHandler,
  };
  const vlanListHandlers = {
    harvester: harvesterVlanListHandler,
    cloudmap: harvesterVlanListHandler,
    'cloudmap.private': harvesterVlanListHandler,
    'cloudmap.edge': harvesterVlanListHandler,
  };
  const vlanCreateHandlers = {
    harvester: harvesterVlanCreateHandler,
    cloudmap: harvesterVlanCreateHandler,
    'cloudmap.private': harvesterVlanCreateHandler,
    'cloudmap.edge': harvesterVlanCreateHandler,
  };
  const vlanDeleteHandlers = {
    harvester: harvesterVlanDeleteHandler,
    cloudmap: harvesterVlanDeleteHandler,
    'cloudmap.private': harvesterVlanDeleteHandler,
    'cloudmap.edge': harvesterVlanDeleteHandler,
  };
  const switchLbRuleListHandlers = {
    harvester: harvesterSwitchLbRuleListHandler,
    cloudmap: harvesterSwitchLbRuleListHandler,
    'cloudmap.private': harvesterSwitchLbRuleListHandler,
    'cloudmap.edge': harvesterSwitchLbRuleListHandler,
  };
  const nadDirectListHandlers = {
    harvester: harvesterNadDirectListHandler,
    cloudmap: harvesterNadDirectListHandler,
    'cloudmap.private': harvesterNadDirectListHandler,
    'cloudmap.edge': harvesterNadDirectListHandler,
  };
  const nadDirectDetailHandlers = {
    harvester: harvesterNadDirectDetailHandler,
    cloudmap: harvesterNadDirectDetailHandler,
    'cloudmap.private': harvesterNadDirectDetailHandler,
    'cloudmap.edge': harvesterNadDirectDetailHandler,
  };
  const ovnEipListHandlers = {
    harvester: harvesterOvnEipListHandler,
    cloudmap: harvesterOvnEipListHandler,
    'cloudmap.private': harvesterOvnEipListHandler,
    'cloudmap.edge': harvesterOvnEipListHandler,
  };
  const ovnEipCreateHandlers = {
    harvester: harvesterOvnEipCreateHandler,
    cloudmap: harvesterOvnEipCreateHandler,
    'cloudmap.private': harvesterOvnEipCreateHandler,
    'cloudmap.edge': harvesterOvnEipCreateHandler,
  };
  const ovnFipListHandlers = {
    harvester: harvesterOvnFipListHandler,
    cloudmap: harvesterOvnFipListHandler,
    'cloudmap.private': harvesterOvnFipListHandler,
    'cloudmap.edge': harvesterOvnFipListHandler,
  };
  const ovnFipCreateHandlers = {
    harvester: harvesterOvnFipCreateHandler,
    cloudmap: harvesterOvnFipCreateHandler,
    'cloudmap.private': harvesterOvnFipCreateHandler,
    'cloudmap.edge': harvesterOvnFipCreateHandler,
  };
  const ovnSnatCreateHandlers = {
    harvester: harvesterOvnSnatCreateHandler,
    cloudmap: harvesterOvnSnatCreateHandler,
    'cloudmap.private': harvesterOvnSnatCreateHandler,
    'cloudmap.edge': harvesterOvnSnatCreateHandler,
  };
  const ovnSnatListHandlers = {
    harvester: harvesterOvnSnatListHandler,
    cloudmap: harvesterOvnSnatListHandler,
    'cloudmap.private': harvesterOvnSnatListHandler,
    'cloudmap.edge': harvesterOvnSnatListHandler,
  };
  const ovnDnatCreateHandlers = {
    harvester: harvesterOvnDnatCreateHandler,
    cloudmap: harvesterOvnDnatCreateHandler,
    'cloudmap.private': harvesterOvnDnatCreateHandler,
    'cloudmap.edge': harvesterOvnDnatCreateHandler,
  };
  const ovnDnatListHandlers = {
    harvester: harvesterOvnDnatListHandler,
    cloudmap: harvesterOvnDnatListHandler,
    'cloudmap.private': harvesterOvnDnatListHandler,
    'cloudmap.edge': harvesterOvnDnatListHandler,
  };
  const lbListHandlers = {
    harvester: harvesterLbListHandler,
    cloudmap: harvesterLbListHandler,
    'cloudmap.private': harvesterLbListHandler,
    'cloudmap.edge': harvesterLbListHandler,
  };
  const lbCreateHandlers = {
    harvester: harvesterLbCreateHandler,
    cloudmap: harvesterLbCreateHandler,
    'cloudmap.private': harvesterLbCreateHandler,
    'cloudmap.edge': harvesterLbCreateHandler,
  };
  const serviceListHandlers = {
    harvester: harvesterServiceDirectListHandler,
    cloudmap: harvesterServiceDirectListHandler,
    'cloudmap.private': harvesterServiceDirectListHandler,
    'cloudmap.edge': harvesterServiceDirectListHandler,
  };
  const lbDeleteHandlers = {
    harvester: harvesterLbDeleteHandler,
    cloudmap: harvesterLbDeleteHandler,
    'cloudmap.private': harvesterLbDeleteHandler,
    'cloudmap.edge': harvesterLbDeleteHandler,
  };
  const ipPoolListHandlers = {
    harvester: harvesterIpPoolListHandler,
    cloudmap: harvesterIpPoolListHandler,
    'cloudmap.private': harvesterIpPoolListHandler,
    'cloudmap.edge': harvesterIpPoolListHandler,
  };
  const ipPoolCreateHandlers = {
    harvester: harvesterIpPoolCreateHandler,
    cloudmap: harvesterIpPoolCreateHandler,
    'cloudmap.private': harvesterIpPoolCreateHandler,
    'cloudmap.edge': harvesterIpPoolCreateHandler,
  };
  const ipPoolDeleteHandlers = {
    harvester: harvesterIpPoolDeleteHandler,
    cloudmap: harvesterIpPoolDeleteHandler,
    'cloudmap.private': harvesterIpPoolDeleteHandler,
    'cloudmap.edge': harvesterIpPoolDeleteHandler,
  };

  // GET /:id/resources/ecs/stream - SSE 流
  router.get(
    '/:id/resources/ecs/stream',
    checkAdminPermission,
    createProviderRouter(ecsStreamHandlers)
  );

  // POST /:id/resources/ecs/:instanceId/start - 启动 VM
  router.post(
    '/:id/resources/ecs/:instanceId/start',
    checkAdminPermission,
    createProviderRouter(ecsStartHandlers)
  );

  // POST /:id/resources/ecs/:instanceId/stop - 停止 VM
  router.post(
    '/:id/resources/ecs/:instanceId/stop',
    checkAdminPermission,
    createProviderRouter(ecsStopHandlers)
  );

  // POST /:id/resources/ecs/:instanceId/reboot - 重启 VM
  router.post(
    '/:id/resources/ecs/:instanceId/reboot',
    checkAdminPermission,
    createProviderRouter(ecsRebootHandlers)
  );

  // POST /:id/resources/ecs/:instanceId/softreboot - 软重启 VM
  router.post(
    '/:id/resources/ecs/:instanceId/softreboot',
    checkAdminPermission,
    createProviderRouter(ecsSoftRebootHandlers)
  );

  // POST /:id/resources/ecs/:instanceId/pause - 暂停 VM
  router.post(
    '/:id/resources/ecs/:instanceId/pause',
    checkAdminPermission,
    createProviderRouter(ecsPauseHandlers)
  );

  // POST /:id/resources/ecs/:instanceId/unpause - 恢复 VM
  router.post(
    '/:id/resources/ecs/:instanceId/unpause',
    checkAdminPermission,
    createProviderRouter(ecsUnpauseHandlers)
  );

  // DELETE /:id/resources/ecs/:instanceId - 删除 VM
  router.delete(
    '/:id/resources/ecs/:instanceId',
    checkAdminPermission,
    createProviderRouter(ecsDeleteHandlers)
  );

  // POST /:id/resources/ecs/:instanceId/restore - 恢复 VM (回收站)
  router.post(
    '/:id/resources/ecs/:instanceId/restore',
    checkAdminPermission,
    createProviderRouter(ecsRestoreHandlers)
  );

  // DELETE /:id/resources/ecs/:instanceId/force - 强制删除 VM
  router.delete(
    '/:id/resources/ecs/:instanceId/force',
    checkAdminPermission,
    createProviderRouter(ecsForceDeleteHandlers)
  );

  // POST /:id/resources/ecs - 创建 VM
  router.post(
    '/:id/resources/ecs',
    checkAdminPermission,
    createProviderRouter(ecsCreateHandlers)
  );

  // POST /:id/resources/harvester/vms - 创建 VM（兼容前端调用）
  router.post(
    '/:id/resources/harvester/vms',
    checkAdminPermission,
    createProviderRouter(ecsCreateHandlers)
  );

  // PUT /:id/resources/ecs/:instanceId - 更新 VM
  router.put(
    '/:id/resources/ecs/:instanceId',
    checkAdminPermission,
    createProviderRouter(ecsUpdateHandlers)
  );

  // POST /:id/resources/harvester/vms/:namespace/:name/update-spec - 更新 VM Spec
  router.post(
    '/:id/resources/harvester/vms/:namespace/:name/update-spec',
    checkAdminPermission,
    createProviderRouter(vmUpdateSpecHandlers)
  );

  // PATCH /:id/resources/harvester/vms/:namespace/:name - PATCH VM
  router.patch(
    '/:id/resources/harvester/vms/:namespace/:name',
    checkAdminPermission,
    json({ type: ['application/json-patch+json', 'application/merge-patch+json'] }),
    createProviderRouter(vmPatchHandlers)
  );

  // POST /:id/resources/harvester/vms/:namespace/:name/start - 启动 VM（兼容前端调用）
  const vmStartByNamespaceHandlers = {
    harvester: harvesterVmStartByNamespaceHandler,
    cloudmap: harvesterVmStartByNamespaceHandler,
    'cloudmap.private': harvesterVmStartByNamespaceHandler,
    'cloudmap.edge': harvesterVmStartByNamespaceHandler,
  };
  router.post(
    '/:id/resources/harvester/vms/:namespace/:name/start',
    checkAdminPermission,
    createProviderRouter(vmStartByNamespaceHandlers)
  );

  // POST /:id/resources/harvester/vms/:namespace/:name/stop - 停止 VM（兼容前端调用）
  const vmStopByNamespaceHandlers = {
    harvester: harvesterVmStopByNamespaceHandler,
    cloudmap: harvesterVmStopByNamespaceHandler,
    'cloudmap.private': harvesterVmStopByNamespaceHandler,
    'cloudmap.edge': harvesterVmStopByNamespaceHandler,
  };
  router.post(
    '/:id/resources/harvester/vms/:namespace/:name/stop',
    checkAdminPermission,
    createProviderRouter(vmStopByNamespaceHandlers)
  );

  // POST /:id/resources/harvester/vms/:namespace/:name/save-as-template - 保存为模板（兼容前端调用）
  const vmSaveAsTemplateHandlers = {
    harvester: harvesterEcsSaveAsTemplateHandler,
    cloudmap: harvesterEcsSaveAsTemplateHandler,
    'cloudmap.private': harvesterEcsSaveAsTemplateHandler,
    'cloudmap.edge': harvesterEcsSaveAsTemplateHandler,
  };
  router.post(
    '/:id/resources/harvester/vms/:namespace/:name/save-as-template',
    checkAdminPermission,
    createProviderRouter(vmSaveAsTemplateHandlers)
  );

  // POST /:id/resources/harvester/templates/:namespace/:name/create-vm - 从模板创建虚拟机（兼容前端调用）
  const vmCreateFromTemplateHandlers = {
    harvester: harvesterEcsCreateFromTemplateHandler,
    cloudmap: harvesterEcsCreateFromTemplateHandler,
    'cloudmap.private': harvesterEcsCreateFromTemplateHandler,
    'cloudmap.edge': harvesterEcsCreateFromTemplateHandler,
  };
  router.post(
    '/:id/resources/harvester/templates/:namespace/:name/create-vm',
    checkAdminPermission,
    createProviderRouter(vmCreateFromTemplateHandlers)
  );

  // POST /:id/resources/harvester/vms/:namespace/:name/action - 执行 VM 操作（兼容前端调用）
  const vmActionHandlers = {
    harvester: harvesterVmActionHandler,
    cloudmap: harvesterVmActionHandler,
    'cloudmap.private': harvesterVmActionHandler,
    'cloudmap.edge': harvesterVmActionHandler,
  };
  router.post(
    '/:id/resources/harvester/vms/:namespace/:name/action',
    checkAdminPermission,
    createProviderRouter(vmActionHandlers)
  );

  // GET /:id/resources/ecs/:instanceId/vnc-url - 获取 VNC URL
  router.get(
    '/:id/resources/ecs/:instanceId/vnc-url',
    checkAdminPermission,
    createProviderRouter(ecsVncUrlHandlers)
  );

  // POST /:id/resources/ecs/:instanceId/add-volume - 挂载卷
  router.post(
    '/:id/resources/ecs/:instanceId/add-volume',
    checkAdminPermission,
    createProviderRouter(ecsAddVolumeHandlers)
  );

  // POST /:id/resources/ecs/:instanceId/remove-volume - 卸载卷
  router.post(
    '/:id/resources/ecs/:instanceId/remove-volume',
    checkAdminPermission,
    createProviderRouter(ecsRemoveVolumeHandlers)
  );

  // POST /:id/resources/ecs/:instanceId/migrate - 迁移 VM
  router.post(
    '/:id/resources/ecs/:instanceId/migrate',
    checkAdminPermission,
    createProviderRouter(ecsMigrateHandlers)
  );

  // POST /:id/resources/ecs/:instanceId/abort-migration - 取消迁移
  router.post(
    '/:id/resources/ecs/:instanceId/abort-migration',
    checkAdminPermission,
    createProviderRouter(ecsAbortMigrationHandlers)
  );

  // GET /:id/resources/harvester/gpu - 获取 GPU 资源
  router.get(
    '/:id/resources/harvester/gpu',
    checkAdminPermission,
    createProviderRouter(gpuResourcesHandlers)
  );

  // GET /:id/resources/harvester/usb - 获取 USB 资源
  router.get(
    '/:id/resources/harvester/usb',
    checkAdminPermission,
    createProviderRouter(usbResourcesHandlers)
  );

  // GET /:id/resources/harvester/migrations-direct - 获取迁移列表
  router.get(
    '/:id/resources/harvester/migrations-direct',
    checkAdminPermission,
    createProviderRouter(migrationsDirectHandlers)
  );

  // GET /:id/resources/ecs/:namespace/:name/aggregated - 获取聚合 VM 详情
  router.get(
    '/:id/resources/ecs/:namespace/:name/aggregated',
    checkAdminPermission,
    createProviderRouter(ecsAggregatedHandlers)
  );

  // OVN Subnet Direct
  router.get(
    '/:id/resources/subnets',
    checkAdminPermission,
    createProviderRouter(subnetListHandlers)
  );
  router.post(
    '/:id/resources/subnets',
    checkAdminPermission,
    createProviderRouter(subnetCreateHandlers)
  );
  router.put(
    '/:id/resources/subnets/:subnetId',
    checkAdminPermission,
    createProviderRouter(subnetUpdateHandlers)
  );
  // 与 PUT 等价：前端 harvesterApi.updateKubeOvnSubnet 使用 PATCH
  router.patch(
    '/:id/resources/subnets/:subnetId',
    checkAdminPermission,
    createProviderRouter(subnetUpdateHandlers)
  );
  router.delete(
    '/:id/resources/subnets/:name',
    checkAdminPermission,
    createProviderRouter(subnetDeleteHandlers)
  );

  // Kube-OVN 安全组（Tower 数据库）
  router.get(
    '/:id/resources/kube-ovn-security-groups',
    checkAdminPermission,
    createProviderRouter(kubeOvnSgListHandlers)
  );
  router.post(
    '/:id/resources/kube-ovn-security-groups',
    checkAdminPermission,
    createProviderRouter(kubeOvnSgCreateHandlers)
  );
  router.get(
    '/:id/resources/kube-ovn-security-groups/:sgId',
    checkAdminPermission,
    createProviderRouter(kubeOvnSgDetailHandlers)
  );
  router.put(
    '/:id/resources/kube-ovn-security-groups/:sgId/rules',
    checkAdminPermission,
    createProviderRouter(kubeOvnSgReplaceRulesHandlers)
  );
  router.post(
    '/:id/resources/kube-ovn-security-groups/:sgId/members',
    checkAdminPermission,
    createProviderRouter(kubeOvnSgAddMembersHandlers)
  );
  router.delete(
    '/:id/resources/kube-ovn-security-groups/:sgId/members/:memberId',
    checkAdminPermission,
    createProviderRouter(kubeOvnSgRemoveMemberHandlers)
  );
  router.patch(
    '/:id/resources/kube-ovn-security-groups/:sgId',
    checkAdminPermission,
    createProviderRouter(kubeOvnSgUpdateHandlers)
  );
  router.delete(
    '/:id/resources/kube-ovn-security-groups/:sgId',
    checkAdminPermission,
    createProviderRouter(kubeOvnSgDeleteHandlers)
  );

  // OVN Provider Networks
  router.get(
    '/:id/resources/providernetworks',
    checkAdminPermission,
    createProviderRouter(providerNetworkListHandlers)
  );
  router.post(
    '/:id/resources/providernetworks',
    checkAdminPermission,
    createProviderRouter(providerNetworkCreateHandlers)
  );
  router.delete(
    '/:id/resources/providernetworks/:name',
    checkAdminPermission,
    createProviderRouter(providerNetworkDeleteHandlers)
  );

  // OVN VLANs
  router.get(
    '/:id/resources/vlans',
    checkAdminPermission,
    createProviderRouter(vlanListHandlers)
  );
  router.post(
    '/:id/resources/vlans',
    checkAdminPermission,
    createProviderRouter(vlanCreateHandlers)
  );
  router.delete(
    '/:id/resources/vlans/:name',
    checkAdminPermission,
    createProviderRouter(vlanDeleteHandlers)
  );

  // OVN Switch LB Rules
  router.get(
    '/:id/resources/switch-lbrules',
    checkAdminPermission,
    createProviderRouter(switchLbRuleListHandlers)
  );

  // NADs Direct (直连查询)
  router.get(
    '/:id/resources/nads',
    checkAdminPermission,
    createProviderRouter(nadDirectListHandlers)
  );
  router.get(
    '/:id/resources/harvester/nads/:namespace/:name',
    checkAdminPermission,
    createProviderRouter(nadDirectDetailHandlers)
  );

  // OVN EIP/FIP/NAT
  router.get('/:id/resources/ovneips', checkAdminPermission, createProviderRouter(ovnEipListHandlers));
  router.post('/:id/resources/ovneips', checkAdminPermission, createProviderRouter(ovnEipCreateHandlers));
  router.get('/:id/resources/ovnfips', checkAdminPermission, createProviderRouter(ovnFipListHandlers));
  router.post('/:id/resources/ovnfips', checkAdminPermission, createProviderRouter(ovnFipCreateHandlers));
  router.post('/:id/resources/ovnsnatrules', checkAdminPermission, createProviderRouter(ovnSnatCreateHandlers));
  router.get('/:id/resources/ovnsnatrules', checkAdminPermission, createProviderRouter(ovnSnatListHandlers));
  router.post('/:id/resources/ovndnatrules', checkAdminPermission, createProviderRouter(ovnDnatCreateHandlers));
  router.get('/:id/resources/ovndnatrules', checkAdminPermission, createProviderRouter(ovnDnatListHandlers));

  // LB / Service / IPPool
  router.get('/:id/resources/harvester-loadbalancers', checkAdminPermission, createProviderRouter(lbListHandlers));
  router.post('/:id/resources/harvester-loadbalancers', checkAdminPermission, createProviderRouter(lbCreateHandlers));
  router.get('/:id/resources/services', checkAdminPermission, createProviderRouter(serviceListHandlers));
  router.delete('/:id/resources/harvester-loadbalancers/:namespace/:name', checkAdminPermission, createProviderRouter(lbDeleteHandlers));
  router.get('/:id/resources/ippools', checkAdminPermission, createProviderRouter(ipPoolListHandlers));
  router.post('/:id/resources/ippools', checkAdminPermission, createProviderRouter(ipPoolCreateHandlers));
  router.delete('/:id/resources/ippools/:name', checkAdminPermission, createProviderRouter(ipPoolDeleteHandlers));

  // Storage Volumes
  const volumeListHandlers = {
    harvester: harvesterVolumeDirectListHandler,
    cloudmap: harvesterVolumeDirectListHandler,
    'cloudmap.private': harvesterVolumeDirectListHandler,
    'cloudmap.edge': harvesterVolumeDirectListHandler,
  };
  const volumeDetailHandlers = {
    harvester: harvesterVolumeDirectDetailHandler,
    cloudmap: harvesterVolumeDirectDetailHandler,
    'cloudmap.private': harvesterVolumeDirectDetailHandler,
    'cloudmap.edge': harvesterVolumeDirectDetailHandler,
  };
  const availableVolumesHandlers = {
    harvester: harvesterAvailableVolumesDirectHandler,
    cloudmap: harvesterAvailableVolumesDirectHandler,
    'cloudmap.private': harvesterAvailableVolumesDirectHandler,
    'cloudmap.edge': harvesterAvailableVolumesDirectHandler,
  };
  const volumeCreateHandlers = {
    harvester: harvesterVolumeDirectCreateHandler,
    cloudmap: harvesterVolumeDirectCreateHandler,
    'cloudmap.private': harvesterVolumeDirectCreateHandler,
    'cloudmap.edge': harvesterVolumeDirectCreateHandler,
  };
  const volumeDeleteHandlers = {
    harvester: harvesterVolumeDirectDeleteHandler,
    cloudmap: harvesterVolumeDirectDeleteHandler,
    'cloudmap.private': harvesterVolumeDirectDeleteHandler,
    'cloudmap.edge': harvesterVolumeDirectDeleteHandler,
  };
  const volumeUpdateHandlers = {
    harvester: harvesterVolumeDirectUpdateHandler,
    cloudmap: harvesterVolumeDirectUpdateHandler,
    'cloudmap.private': harvesterVolumeDirectUpdateHandler,
    'cloudmap.edge': harvesterVolumeDirectUpdateHandler,
  };

  // Storage Snapshots
  const snapshotRestoreHandlers = {
    harvester: harvesterSnapshotRestoreHandler,
    cloudmap: harvesterSnapshotRestoreHandler,
    'cloudmap.private': harvesterSnapshotRestoreHandler,
    'cloudmap.edge': harvesterSnapshotRestoreHandler,
  };
  const volumeSnapshotCreateHandlers = {
    harvester: harvesterVolumeSnapshotCreateHandler,
    cloudmap: harvesterVolumeSnapshotCreateHandler,
    'cloudmap.private': harvesterVolumeSnapshotCreateHandler,
    'cloudmap.edge': harvesterVolumeSnapshotCreateHandler,
  };
  const volumeSnapshotLegacyHandlers = {
    harvester: harvesterVolumeSnapshotLegacyHandler,
    cloudmap: harvesterVolumeSnapshotLegacyHandler,
    'cloudmap.private': harvesterVolumeSnapshotLegacyHandler,
    'cloudmap.edge': harvesterVolumeSnapshotLegacyHandler,
  };
  const snapshotClassesListHandlers = {
    harvester: harvesterSnapshotClassesListHandler,
    cloudmap: harvesterSnapshotClassesListHandler,
    'cloudmap.private': harvesterSnapshotClassesListHandler,
    'cloudmap.edge': harvesterSnapshotClassesListHandler,
  };

  // Storage Volume Operations
  const volumeExportImageHandlers = {
    harvester: harvesterVolumeExportImageHandler,
    cloudmap: harvesterVolumeExportImageHandler,
    'cloudmap.private': harvesterVolumeExportImageHandler,
    'cloudmap.edge': harvesterVolumeExportImageHandler,
  };
  const volumeCloneHandlers = {
    harvester: harvesterVolumeCloneHandler,
    cloudmap: harvesterVolumeCloneHandler,
    'cloudmap.private': harvesterVolumeCloneHandler,
    'cloudmap.edge': harvesterVolumeCloneHandler,
  };
  const volumeExportImageLegacyHandlers = {
    harvester: harvesterVolumeExportImageLegacyHandler,
    cloudmap: harvesterVolumeExportImageLegacyHandler,
    'cloudmap.private': harvesterVolumeExportImageLegacyHandler,
    'cloudmap.edge': harvesterVolumeExportImageLegacyHandler,
  };
  const volumeCloneLegacyHandlers = {
    harvester: harvesterVolumeCloneLegacyHandler,
    cloudmap: harvesterVolumeCloneLegacyHandler,
    'cloudmap.private': harvesterVolumeCloneLegacyHandler,
    'cloudmap.edge': harvesterVolumeCloneLegacyHandler,
  };

  // Storage Capabilities
  const capabilitiesHandlers = {
    harvester: harvesterCapabilitiesDirectHandler,
    cloudmap: harvesterCapabilitiesDirectHandler,
    'cloudmap.private': harvesterCapabilitiesDirectHandler,
    'cloudmap.edge': harvesterCapabilitiesDirectHandler,
  };
  const storageClassDetailHandlers = {
    harvester: harvesterStorageClassDetailHandler,
    cloudmap: harvesterStorageClassDetailHandler,
    'cloudmap.private': harvesterStorageClassDetailHandler,
    'cloudmap.edge': harvesterStorageClassDetailHandler,
  };

  // Register Storage Routes
  router.get('/:id/resources/harvester/volumes', checkAdminPermission, createProviderRouter(volumeListHandlers));
  router.get('/:id/resources/harvester/volumes/:namespace/:name', checkAdminPermission, createProviderRouter(volumeDetailHandlers));
  router.get('/:id/resources/harvester/available-volumes', checkAdminPermission, createProviderRouter(availableVolumesHandlers));
  router.post('/:id/resources/harvester/volumes', checkAdminPermission, createProviderRouter(volumeCreateHandlers));
  router.delete('/:id/resources/harvester/volumes/:name', checkAdminPermission, createProviderRouter(volumeDeleteHandlers));
  router.put('/:id/resources/harvester/volumes/:namespace/:name', checkAdminPermission, createProviderRouter(volumeUpdateHandlers));

  router.post('/:id/resources/harvester/snapshots/:namespace/:name/restore', checkAdminPermission, createProviderRouter(snapshotRestoreHandlers));
  router.post('/:id/resources/harvester/volumes/:namespace/:name/snapshots', checkAdminPermission, createProviderRouter(volumeSnapshotCreateHandlers));
  router.post('/:id/resources/harvester/volumes/snapshot', checkAdminPermission, createProviderRouter(volumeSnapshotLegacyHandlers));
  router.get('/:id/resources/harvester/snapshot-classes', checkAdminPermission, createProviderRouter(snapshotClassesListHandlers));

  router.post('/:id/resources/harvester/volumes/:namespace/:name/export-image', checkAdminPermission, createProviderRouter(volumeExportImageHandlers));
  router.post('/:id/resources/harvester/volumes/:namespace/:name/clone', checkAdminPermission, createProviderRouter(volumeCloneHandlers));
  router.post('/:id/resources/harvester/volumes/export-image', checkAdminPermission, createProviderRouter(volumeExportImageLegacyHandlers));
  router.post('/:id/resources/harvester/volumes/clone', checkAdminPermission, createProviderRouter(volumeCloneLegacyHandlers));

  router.get('/:id/resources/harvester/capabilities', checkAdminPermission, createProviderRouter(capabilitiesHandlers));
  router.get('/:id/resources/harvester/storage-classes/:name', checkAdminPermission, createProviderRouter(storageClassDetailHandlers));
}
