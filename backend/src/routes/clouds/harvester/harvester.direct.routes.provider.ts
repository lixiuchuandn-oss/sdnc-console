/**
 * Harvester 直连路由注册（策略模式+中间件）
 * 使用 provider-router 中间件统一处理不同供应商的路由分发
 *
 * 从 harvester.direct.vm.routes.ts 中迁移的 VM 操作路由
 *
 * 【命名与路径约定】
 * - 虚拟机电源与标准生命周期（启/停/重启/暂停/删/回收站恢复等）：统一走
 *   `POST|DELETE .../resources/ecs/:instanceId/...`，handler 命名为 `harvesterEcs*Handler`。
 *   `instanceId` 通常为 `namespace/name`（URL 中单段编码）。
 * - 仍挂在 `.../resources/harvester/vms/:namespace/:name/...` 的接口：表示 K8s/Harvester 原生形态
 *   （如 PATCH、update-spec、自定义 action、创建 VM 体），handler 命名为 `harvesterVm*`。
 * - 不再增加「仅参数形式不同」的 ecs 与 vms 重复路由；新能力择其一并文档化。
 */

import { Router, RequestHandler, json } from 'express'; // Router / RequestHandler / JSON body 解析
import { createProviderRouter } from '../middleware/provider-router'; // 按云 provider 分发到对应 handler
import {
  harvesterEcsStreamHandler, // GET ecs/stream：虚拟机状态 SSE
  harvesterEcsVncUrlHandler, // GET ecs/:id/vnc-url：控制台 URL
  harvesterEcsAddVolumeHandler, // 挂数据盘
  harvesterEcsRemoveVolumeHandler, // 卸数据盘
  harvesterEcsMigrateHandler, // 热迁移
  harvesterEcsAbortMigrationHandler, // 中止迁移
  harvesterGpuResourcesHandler, // GPU 设备列表
  harvesterUsbResourcesHandler, // USB 设备列表
  harvesterMigrationsDirectHandler, // 迁移任务列表
  harvesterEcsAggregatedHandler, // 虚拟机聚合详情
  harvesterVmActionHandler, // POST vms/.../action：自定义动作
} from './handlers/ecs-direct-operations.handlers';
import {
  harvesterEcsStartHandler, // POST ecs/:instanceId/start
  harvesterEcsStopHandler, // POST ecs/:instanceId/stop
  harvesterEcsRebootHandler, // POST ecs/:instanceId/reboot
  harvesterEcsSoftRebootHandler, // POST ecs/:instanceId/softreboot
  harvesterEcsPauseHandler, // POST ecs/:instanceId/pause
  harvesterEcsUnpauseHandler, // POST ecs/:instanceId/unpause
  harvesterEcsDeleteHandler, // DELETE ecs/:instanceId（进回收站）
  harvesterEcsRestoreHandler, // POST ecs/:instanceId/restore
  harvesterEcsForceDeleteHandler, // DELETE ecs/:instanceId/force
} from './handlers/ecs-direct-lifecycle.handlers';
import {
  harvesterEcsCreateHandler, // POST ecs / POST harvester/vms：创建虚拟机
  harvesterEcsUpdateHandler, // PUT ecs/:instanceId：整资源更新
  harvesterVmUpdateSpecHandler, // POST vms/:ns/:name/update-spec：更新 Spec
  harvesterVmPatchHandler, // PATCH vms/:ns/:name：K8s Patch
  harvesterEcsCreateFromTemplateHandler, // 从模板创建 VM
  harvesterEcsSaveAsTemplateHandler, // 保存为模板
} from './handlers/ecs-direct-crud.handlers';
import {
  harvesterSubnetDirectListHandler, // 子网列表
  harvesterSubnetDirectCreateHandler, // 创建子网
  harvesterSubnetDirectUpdateHandler, // 更新子网
  harvesterSubnetDirectDeleteHandler, // 删除子网
  harvesterSubnetCheckIpHandler, // 检测子网静态 IP 使用状态
} from './handlers/ovn-direct-subnets.handlers';
import {
  kubeOvnSecurityGroupListHandler, // 安全组列表
  kubeOvnSecurityGroupCreateHandler, // 创建安全组
  kubeOvnSecurityGroupDetailHandler, // 安全组详情
  kubeOvnSecurityGroupReplaceRulesHandler, // 替换规则集
  kubeOvnSecurityGroupUpdateHandler, // 更新安全组
  kubeOvnSecurityGroupDeleteHandler, // 删除安全组
  kubeOvnSecurityGroupAddMembersHandler, // 添加成员
  kubeOvnSecurityGroupRemoveMemberHandler, // 移除成员
} from './handlers/kube-ovn-security-groups.handlers';
import {
  harvesterProviderNetworkListHandler, // Provider Network 列表
  harvesterProviderNetworkCreateHandler, // 创建物理网络
  harvesterProviderNetworkDeleteHandler, // 删除物理网络
} from './handlers/ovn-direct-provider-networks.handlers';
import {
  harvesterVlanListHandler, // VLAN 子网列表
  harvesterVlanCreateHandler, // 创建 VLAN
  harvesterVlanDeleteHandler, // 删除 VLAN
} from './handlers/ovn-direct-vlans.handlers';
import { harvesterSwitchLbRuleListHandler } from './handlers/ovn-direct-switch-lbrules.handlers'; // 交换机 LB 规则列表
import {
  harvesterNadDirectListHandler, // NAD 列表
  harvesterNadDirectDetailHandler, // NAD 详情
} from './handlers/network-direct-nads.handlers';
import {
  harvesterOvnEipListHandler, // 弹性公网 IP 列表
  harvesterOvnEipCreateHandler, // 创建 EIP
  harvesterOvnEipDeleteHandler, // 删除 EIP
  harvesterOvnFipListHandler, // FIP 列表
  harvesterOvnFipCreateHandler, // 创建 FIP
  harvesterOvnFipDeleteHandler, // 删除 FIP
  harvesterOvnSnatCreateHandler, // 创建 SNAT
  harvesterOvnSnatListHandler, // SNAT 列表
  harvesterOvnSnatDeleteHandler, // 删除 SNAT
  harvesterOvnDnatCreateHandler, // 创建 DNAT
  harvesterOvnDnatListHandler, // DNAT 列表
  harvesterOvnDnatDeleteHandler, // 删除 DNAT
} from './handlers/ovn-direct-eip-fip-nat.handlers';
import {
  harvesterLbListHandler, // LoadBalancer Service 列表
  harvesterLbCreateHandler, // 创建 LB
  harvesterServiceDirectListHandler, // Service 直连列表
  harvesterLbDeleteHandler, // 删除 LB
  harvesterIpPoolListHandler, // IP 池列表
  harvesterIpPoolCreateHandler, // 创建 IP 池
  harvesterIpPoolDeleteHandler, // 删除 IP 池
} from './handlers/network-direct-lb-ippool.handlers';
import {
  harvesterVolumeDirectListHandler, // 卷列表
  harvesterVolumeDirectDetailHandler, // 卷详情
  harvesterAvailableVolumesDirectHandler, // 可挂载卷
  harvesterVolumeDirectCreateHandler, // 创建卷
  harvesterVolumeDirectDeleteHandler, // 删除卷
  harvesterVolumeDirectUpdateHandler, // 更新卷
} from './handlers/storage-direct-volumes.handlers';
import {
  harvesterSnapshotRestoreHandler, // 快照恢复
  harvesterVolumeSnapshotCreateHandler, // 创建卷快照
  harvesterVolumeSnapshotLegacyHandler, // 快照兼容路径
  harvesterSnapshotClassesListHandler, // 快照类列表
} from './handlers/storage-direct-snapshots.handlers';
import {
  harvesterVolumeExportImageHandler, // 卷导出镜像
  harvesterVolumeCloneHandler, // 卷克隆
  harvesterVolumeExportImageLegacyHandler, // 导出镜像兼容路径
  harvesterVolumeCloneLegacyHandler, // 克隆兼容路径
} from './handlers/storage-direct-volume-ops.handlers';
import {
  harvesterCapabilitiesDirectHandler, // 存储/集群能力
  harvesterStorageClassDetailHandler, // StorageClass 详情
} from './handlers/storage-direct-capabilities.handlers';

export function registerHarvesterDirectRoutesProvider(
  router: Router,
  checkAdminPermission: RequestHandler,
) {
  /**
   * Harvester / Cloudmap / cloudmap.private / cloudmap.edge 共用同一直连 handler
   * （与 middleware/provider-router 中 normalizeProvider 白名单一致）
   */
  function harvesterProviderMap<T>(handler: T): Record<string, T> {
    return {
      harvester: handler,
      cloudmap: handler,
      'cloudmap.private': handler,
      'cloudmap.edge': handler,
    };
  }

  // ECS Stream Handlers
  const ecsStreamHandlers = harvesterProviderMap(harvesterEcsStreamHandler);

  // ECS Lifecycle Handlers
  const ecsStartHandlers = harvesterProviderMap(harvesterEcsStartHandler);

  const ecsStopHandlers = harvesterProviderMap(harvesterEcsStopHandler);

  const ecsRebootHandlers = harvesterProviderMap(harvesterEcsRebootHandler);

  const ecsSoftRebootHandlers = harvesterProviderMap(harvesterEcsSoftRebootHandler);

  const ecsPauseHandlers = harvesterProviderMap(harvesterEcsPauseHandler);

  const ecsUnpauseHandlers = harvesterProviderMap(harvesterEcsUnpauseHandler);

  const ecsDeleteHandlers = harvesterProviderMap(harvesterEcsDeleteHandler);

  const ecsRestoreHandlers = harvesterProviderMap(harvesterEcsRestoreHandler);

  const ecsForceDeleteHandlers = harvesterProviderMap(harvesterEcsForceDeleteHandler);

  // ECS CRUD Handlers
  const ecsCreateHandlers = harvesterProviderMap(harvesterEcsCreateHandler);

  const ecsUpdateHandlers = harvesterProviderMap(harvesterEcsUpdateHandler);

  const vmUpdateSpecHandlers = harvesterProviderMap(harvesterVmUpdateSpecHandler);

  const vmPatchHandlers = harvesterProviderMap(harvesterVmPatchHandler);

  // ECS VNC Handlers
  const ecsVncUrlHandlers = harvesterProviderMap(harvesterEcsVncUrlHandler);

  // ECS Volume Handlers
  const ecsAddVolumeHandlers = harvesterProviderMap(harvesterEcsAddVolumeHandler);

  const ecsRemoveVolumeHandlers = harvesterProviderMap(harvesterEcsRemoveVolumeHandler);

  // ECS Migration Handlers
  const ecsMigrateHandlers = harvesterProviderMap(harvesterEcsMigrateHandler);

  const ecsAbortMigrationHandlers = harvesterProviderMap(harvesterEcsAbortMigrationHandler);

  // Hardware Resources Handlers
  const gpuResourcesHandlers = harvesterProviderMap(harvesterGpuResourcesHandler);

  const usbResourcesHandlers = harvesterProviderMap(harvesterUsbResourcesHandler);

  const migrationsDirectHandlers = harvesterProviderMap(harvesterMigrationsDirectHandler);

  const ecsAggregatedHandlers = harvesterProviderMap(harvesterEcsAggregatedHandler);

  const subnetListHandlers = harvesterProviderMap(harvesterSubnetDirectListHandler);
  const subnetCreateHandlers = harvesterProviderMap(harvesterSubnetDirectCreateHandler);
  const subnetUpdateHandlers = harvesterProviderMap(harvesterSubnetDirectUpdateHandler);
  const subnetDeleteHandlers = harvesterProviderMap(harvesterSubnetDirectDeleteHandler);
  const subnetCheckIpHandlers = harvesterProviderMap(harvesterSubnetCheckIpHandler);

  const kubeOvnSgListHandlers = harvesterProviderMap(kubeOvnSecurityGroupListHandler);
  const kubeOvnSgCreateHandlers = harvesterProviderMap(kubeOvnSecurityGroupCreateHandler);
  const kubeOvnSgDetailHandlers = harvesterProviderMap(kubeOvnSecurityGroupDetailHandler);
  const kubeOvnSgReplaceRulesHandlers = harvesterProviderMap(
    kubeOvnSecurityGroupReplaceRulesHandler,
  );
  const kubeOvnSgAddMembersHandlers = harvesterProviderMap(kubeOvnSecurityGroupAddMembersHandler);
  const kubeOvnSgRemoveMemberHandlers = harvesterProviderMap(
    kubeOvnSecurityGroupRemoveMemberHandler,
  );
  const kubeOvnSgUpdateHandlers = harvesterProviderMap(kubeOvnSecurityGroupUpdateHandler);
  const kubeOvnSgDeleteHandlers = harvesterProviderMap(kubeOvnSecurityGroupDeleteHandler);
  const providerNetworkListHandlers = harvesterProviderMap(harvesterProviderNetworkListHandler);
  const providerNetworkCreateHandlers = harvesterProviderMap(harvesterProviderNetworkCreateHandler);
  const providerNetworkDeleteHandlers = harvesterProviderMap(harvesterProviderNetworkDeleteHandler);
  const vlanListHandlers = harvesterProviderMap(harvesterVlanListHandler);
  const vlanCreateHandlers = harvesterProviderMap(harvesterVlanCreateHandler);
  const vlanDeleteHandlers = harvesterProviderMap(harvesterVlanDeleteHandler);
  const switchLbRuleListHandlers = harvesterProviderMap(harvesterSwitchLbRuleListHandler);
  const nadDirectListHandlers = harvesterProviderMap(harvesterNadDirectListHandler);
  const nadDirectDetailHandlers = harvesterProviderMap(harvesterNadDirectDetailHandler);
  const ovnEipListHandlers = harvesterProviderMap(harvesterOvnEipListHandler);
  const ovnEipCreateHandlers = harvesterProviderMap(harvesterOvnEipCreateHandler);
  const ovnFipListHandlers = harvesterProviderMap(harvesterOvnFipListHandler);
  const ovnFipCreateHandlers = harvesterProviderMap(harvesterOvnFipCreateHandler);
  const ovnSnatCreateHandlers = harvesterProviderMap(harvesterOvnSnatCreateHandler);
  const ovnSnatListHandlers = harvesterProviderMap(harvesterOvnSnatListHandler);
  const ovnDnatCreateHandlers = harvesterProviderMap(harvesterOvnDnatCreateHandler);
  const ovnDnatListHandlers = harvesterProviderMap(harvesterOvnDnatListHandler);

  const ovnEipDeleteHandlers = harvesterProviderMap(harvesterOvnEipDeleteHandler);
  const ovnFipDeleteHandlers = harvesterProviderMap(harvesterOvnFipDeleteHandler);
  const ovnSnatDeleteHandlers = harvesterProviderMap(harvesterOvnSnatDeleteHandler);
  const ovnDnatDeleteHandlers = harvesterProviderMap(harvesterOvnDnatDeleteHandler);

  const lbListHandlers = harvesterProviderMap(harvesterLbListHandler);
  const lbCreateHandlers = harvesterProviderMap(harvesterLbCreateHandler);
  const serviceListHandlers = harvesterProviderMap(harvesterServiceDirectListHandler);
  const lbDeleteHandlers = harvesterProviderMap(harvesterLbDeleteHandler);
  const ipPoolListHandlers = harvesterProviderMap(harvesterIpPoolListHandler);
  const ipPoolCreateHandlers = harvesterProviderMap(harvesterIpPoolCreateHandler);
  const ipPoolDeleteHandlers = harvesterProviderMap(harvesterIpPoolDeleteHandler);

  // VM（Harvester 路径）：模板 / 自定义 action
  const vmSaveAsTemplateHandlers = harvesterProviderMap(harvesterEcsSaveAsTemplateHandler);
  const vmCreateFromTemplateHandlers = harvesterProviderMap(harvesterEcsCreateFromTemplateHandler);
  const vmActionHandlers = harvesterProviderMap(harvesterVmActionHandler);

  // 存储：卷 / 快照 / 导出克隆 / 能力
  const volumeListHandlers = harvesterProviderMap(harvesterVolumeDirectListHandler);
  const volumeDetailHandlers = harvesterProviderMap(harvesterVolumeDirectDetailHandler);
  const availableVolumesHandlers = harvesterProviderMap(harvesterAvailableVolumesDirectHandler);
  const volumeCreateHandlers = harvesterProviderMap(harvesterVolumeDirectCreateHandler);
  const volumeDeleteHandlers = harvesterProviderMap(harvesterVolumeDirectDeleteHandler);
  const volumeUpdateHandlers = harvesterProviderMap(harvesterVolumeDirectUpdateHandler);
  const snapshotRestoreHandlers = harvesterProviderMap(harvesterSnapshotRestoreHandler);
  const volumeSnapshotCreateHandlers = harvesterProviderMap(harvesterVolumeSnapshotCreateHandler);
  const volumeSnapshotLegacyHandlers = harvesterProviderMap(harvesterVolumeSnapshotLegacyHandler);
  const snapshotClassesListHandlers = harvesterProviderMap(harvesterSnapshotClassesListHandler);
  const volumeExportImageHandlers = harvesterProviderMap(harvesterVolumeExportImageHandler);
  const volumeCloneHandlers = harvesterProviderMap(harvesterVolumeCloneHandler);
  const volumeExportImageLegacyHandlers = harvesterProviderMap(
    harvesterVolumeExportImageLegacyHandler,
  );
  const volumeCloneLegacyHandlers = harvesterProviderMap(harvesterVolumeCloneLegacyHandler);
  const capabilitiesHandlers = harvesterProviderMap(harvesterCapabilitiesDirectHandler);
  const storageClassDetailHandlers = harvesterProviderMap(harvesterStorageClassDetailHandler);

  // --- 路由注册（按资源域分段注释）---

  // GET /:id/resources/ecs/stream - SSE 流
  router.get(
    '/:id/resources/ecs/stream',
    checkAdminPermission,
    createProviderRouter(ecsStreamHandlers),
  );

  // POST /:id/resources/ecs/:instanceId/start - 启动 VM
  router.post(
    '/:id/resources/ecs/:instanceId/start',
    checkAdminPermission,
    createProviderRouter(ecsStartHandlers),
  );

  // POST /:id/resources/ecs/:instanceId/stop - 停止 VM
  router.post(
    '/:id/resources/ecs/:instanceId/stop',
    checkAdminPermission,
    createProviderRouter(ecsStopHandlers),
  );

  // POST /:id/resources/ecs/:instanceId/reboot - 重启 VM
  router.post(
    '/:id/resources/ecs/:instanceId/reboot',
    checkAdminPermission,
    createProviderRouter(ecsRebootHandlers),
  );

  // POST /:id/resources/ecs/:instanceId/softreboot - 软重启 VM
  router.post(
    '/:id/resources/ecs/:instanceId/softreboot',
    checkAdminPermission,
    createProviderRouter(ecsSoftRebootHandlers),
  );

  // POST /:id/resources/ecs/:instanceId/pause - 暂停 VM
  router.post(
    '/:id/resources/ecs/:instanceId/pause',
    checkAdminPermission,
    createProviderRouter(ecsPauseHandlers),
  );

  // POST /:id/resources/ecs/:instanceId/unpause - 恢复 VM
  router.post(
    '/:id/resources/ecs/:instanceId/unpause',
    checkAdminPermission,
    createProviderRouter(ecsUnpauseHandlers),
  );

  // DELETE /:id/resources/ecs/:instanceId - 删除 VM
  router.delete(
    '/:id/resources/ecs/:instanceId',
    checkAdminPermission,
    createProviderRouter(ecsDeleteHandlers),
  );

  // POST /:id/resources/ecs/:instanceId/restore - 恢复 VM (回收站)
  router.post(
    '/:id/resources/ecs/:instanceId/restore',
    checkAdminPermission,
    createProviderRouter(ecsRestoreHandlers),
  );

  // DELETE /:id/resources/ecs/:instanceId/force - 强制删除 VM
  router.delete(
    '/:id/resources/ecs/:instanceId/force',
    checkAdminPermission,
    createProviderRouter(ecsForceDeleteHandlers),
  );

  // POST /:id/resources/ecs - 创建 VM
  router.post('/:id/resources/ecs', checkAdminPermission, createProviderRouter(ecsCreateHandlers));

  // POST /:id/resources/harvester/vms - 创建 VM（兼容前端调用）
  router.post(
    '/:id/resources/harvester/vms',
    checkAdminPermission,
    createProviderRouter(ecsCreateHandlers),
  );

  // PUT /:id/resources/ecs/:instanceId - 更新 VM
  router.put(
    '/:id/resources/ecs/:instanceId',
    checkAdminPermission,
    createProviderRouter(ecsUpdateHandlers),
  );

  // POST /:id/resources/harvester/vms/:namespace/:name/update-spec - 更新 VM Spec
  router.post(
    '/:id/resources/harvester/vms/:namespace/:name/update-spec',
    checkAdminPermission,
    createProviderRouter(vmUpdateSpecHandlers),
  );

  // PATCH /:id/resources/harvester/vms/:namespace/:name - PATCH VM
  router.patch(
    '/:id/resources/harvester/vms/:namespace/:name',
    checkAdminPermission,
    json({ type: ['application/json-patch+json', 'application/merge-patch+json'] }),
    createProviderRouter(vmPatchHandlers),
  );

  // POST /:id/resources/harvester/vms/:namespace/:name/save-as-template - 保存为模板（兼容前端调用）
  router.post(
    '/:id/resources/harvester/vms/:namespace/:name/save-as-template',
    checkAdminPermission,
    createProviderRouter(vmSaveAsTemplateHandlers),
  );

  // POST /:id/resources/harvester/templates/:namespace/:name/create-vm - 从模板创建虚拟机（兼容前端调用）
  router.post(
    '/:id/resources/harvester/templates/:namespace/:name/create-vm',
    checkAdminPermission,
    createProviderRouter(vmCreateFromTemplateHandlers),
  );

  // POST /:id/resources/harvester/vms/:namespace/:name/action - 执行 VM 操作（兼容前端调用）
  router.post(
    '/:id/resources/harvester/vms/:namespace/:name/action',
    checkAdminPermission,
    createProviderRouter(vmActionHandlers),
  );

  // GET /:id/resources/ecs/:instanceId/vnc-url - 获取 VNC URL
  router.get(
    '/:id/resources/ecs/:instanceId/vnc-url',
    checkAdminPermission,
    createProviderRouter(ecsVncUrlHandlers),
  );

  // POST /:id/resources/ecs/:instanceId/add-volume - 挂载卷
  router.post(
    '/:id/resources/ecs/:instanceId/add-volume',
    checkAdminPermission,
    createProviderRouter(ecsAddVolumeHandlers),
  );

  // POST /:id/resources/ecs/:instanceId/remove-volume - 卸载卷
  router.post(
    '/:id/resources/ecs/:instanceId/remove-volume',
    checkAdminPermission,
    createProviderRouter(ecsRemoveVolumeHandlers),
  );

  // POST /:id/resources/ecs/:instanceId/migrate - 迁移 VM
  router.post(
    '/:id/resources/ecs/:instanceId/migrate',
    checkAdminPermission,
    createProviderRouter(ecsMigrateHandlers),
  );

  // POST /:id/resources/ecs/:instanceId/abort-migration - 取消迁移
  router.post(
    '/:id/resources/ecs/:instanceId/abort-migration',
    checkAdminPermission,
    createProviderRouter(ecsAbortMigrationHandlers),
  );

  // GET /:id/resources/harvester/gpu - 获取 GPU 资源
  router.get(
    '/:id/resources/harvester/gpu',
    checkAdminPermission,
    createProviderRouter(gpuResourcesHandlers),
  );

  // GET /:id/resources/harvester/usb - 获取 USB 资源
  router.get(
    '/:id/resources/harvester/usb',
    checkAdminPermission,
    createProviderRouter(usbResourcesHandlers),
  );

  // GET /:id/resources/harvester/migrations-direct - 获取迁移列表
  router.get(
    '/:id/resources/harvester/migrations-direct',
    checkAdminPermission,
    createProviderRouter(migrationsDirectHandlers),
  );

  // GET /:id/resources/ecs/:namespace/:name/aggregated - 获取聚合 VM 详情
  router.get(
    '/:id/resources/ecs/:namespace/:name/aggregated',
    checkAdminPermission,
    createProviderRouter(ecsAggregatedHandlers),
  );

  // OVN Subnet Direct
  router.get(
    '/:id/resources/subnets',
    checkAdminPermission,
    createProviderRouter(subnetListHandlers),
  );
  router.post(
    '/:id/resources/subnets',
    checkAdminPermission,
    createProviderRouter(subnetCreateHandlers),
  );
  /** 路径参数 name = Kube-OVN Subnet CR 的 metadata.name（非 UID），与 DELETE 一致 */
  router.put(
    '/:id/resources/subnets/:name',
    checkAdminPermission,
    createProviderRouter(subnetUpdateHandlers),
  );
  // 与 PUT 等价：前端 harvesterApi.updateKubeOvnSubnet 使用 PATCH
  router.patch(
    '/:id/resources/subnets/:name',
    checkAdminPermission,
    createProviderRouter(subnetUpdateHandlers),
  );
  router.delete(
    '/:id/resources/subnets/:name',
    checkAdminPermission,
    createProviderRouter(subnetDeleteHandlers),
  );
  // 检测子网静态 IP 使用状态
  // 路由：GET /api/clouds/:id/resources/subnets/:namespace/:name/check-ip?ip=172.16.2.1
  router.get(
    '/:id/resources/subnets/:namespace/:name/check-ip',
    checkAdminPermission,
    createProviderRouter(subnetCheckIpHandlers),
  );

  // Kube-OVN 安全组（Tower 数据库）
  router.get(
    '/:id/resources/kube-ovn-security-groups',
    checkAdminPermission,
    createProviderRouter(kubeOvnSgListHandlers),
  );
  router.post(
    '/:id/resources/kube-ovn-security-groups',
    checkAdminPermission,
    createProviderRouter(kubeOvnSgCreateHandlers),
  );
  router.get(
    '/:id/resources/kube-ovn-security-groups/:sgId',
    checkAdminPermission,
    createProviderRouter(kubeOvnSgDetailHandlers),
  );
  router.put(
    '/:id/resources/kube-ovn-security-groups/:sgId/rules',
    checkAdminPermission,
    createProviderRouter(kubeOvnSgReplaceRulesHandlers),
  );
  router.post(
    '/:id/resources/kube-ovn-security-groups/:sgId/members',
    checkAdminPermission,
    createProviderRouter(kubeOvnSgAddMembersHandlers),
  );
  router.delete(
    '/:id/resources/kube-ovn-security-groups/:sgId/members/:memberId',
    checkAdminPermission,
    createProviderRouter(kubeOvnSgRemoveMemberHandlers),
  );
  router.patch(
    '/:id/resources/kube-ovn-security-groups/:sgId',
    checkAdminPermission,
    createProviderRouter(kubeOvnSgUpdateHandlers),
  );
  router.delete(
    '/:id/resources/kube-ovn-security-groups/:sgId',
    checkAdminPermission,
    createProviderRouter(kubeOvnSgDeleteHandlers),
  );

  // OVN Provider Networks
  router.get(
    '/:id/resources/provider-networks',
    checkAdminPermission,
    createProviderRouter(providerNetworkListHandlers),
  );
  router.post(
    '/:id/resources/provider-networks',
    checkAdminPermission,
    createProviderRouter(providerNetworkCreateHandlers),
  );
  router.delete(
    '/:id/resources/provider-networks/:name',
    checkAdminPermission,
    createProviderRouter(providerNetworkDeleteHandlers),
  );

  // OVN VLANs
  router.get('/:id/resources/vlans', checkAdminPermission, createProviderRouter(vlanListHandlers));
  router.post(
    '/:id/resources/vlans',
    checkAdminPermission,
    createProviderRouter(vlanCreateHandlers),
  );
  router.delete(
    '/:id/resources/vlans/:name',
    checkAdminPermission,
    createProviderRouter(vlanDeleteHandlers),
  );

  // OVN Switch LB Rules
  router.get(
    '/:id/resources/switch-lbrules',
    checkAdminPermission,
    createProviderRouter(switchLbRuleListHandlers),
  );

  // NADs Direct (直连查询)
  router.get(
    '/:id/resources/nads',
    checkAdminPermission,
    createProviderRouter(nadDirectListHandlers),
  );
  router.get(
    '/:id/resources/harvester/nads/:namespace/:name',
    checkAdminPermission,
    createProviderRouter(nadDirectDetailHandlers),
  );

  // OVN EIP/FIP/NAT：GET 须带 ?ovnNetworkScope=vpc|underlay|all；POST 须带 ?ovnNetworkScope=vpc|underlay
  router.get(
    '/:id/resources/ovneips',
    checkAdminPermission,
    createProviderRouter(ovnEipListHandlers),
  );
  router.post(
    '/:id/resources/ovneips',
    checkAdminPermission,
    createProviderRouter(ovnEipCreateHandlers),
  );
  router.delete(
    '/:id/resources/ovneips/:name',
    checkAdminPermission,
    createProviderRouter(ovnEipDeleteHandlers),
  );
  router.get(
    '/:id/resources/ovnfips',
    checkAdminPermission,
    createProviderRouter(ovnFipListHandlers),
  );
  router.post(
    '/:id/resources/ovnfips',
    checkAdminPermission,
    createProviderRouter(ovnFipCreateHandlers),
  );
  router.delete(
    '/:id/resources/ovnfips/:name',
    checkAdminPermission,
    createProviderRouter(ovnFipDeleteHandlers),
  );
  router.post(
    '/:id/resources/ovnsnatrules',
    checkAdminPermission,
    createProviderRouter(ovnSnatCreateHandlers),
  );
  router.get(
    '/:id/resources/ovnsnatrules',
    checkAdminPermission,
    createProviderRouter(ovnSnatListHandlers),
  );
  router.delete(
    '/:id/resources/ovnsnatrules/:name',
    checkAdminPermission,
    createProviderRouter(ovnSnatDeleteHandlers),
  );
  router.post(
    '/:id/resources/ovndnatrules',
    checkAdminPermission,
    createProviderRouter(ovnDnatCreateHandlers),
  );
  router.get(
    '/:id/resources/ovndnatrules',
    checkAdminPermission,
    createProviderRouter(ovnDnatListHandlers),
  );
  router.delete(
    '/:id/resources/ovndnatrules/:name',
    checkAdminPermission,
    createProviderRouter(ovnDnatDeleteHandlers),
  );

  // LB / Service / IPPool
  router.get(
    '/:id/resources/harvester-loadbalancers',
    checkAdminPermission,
    createProviderRouter(lbListHandlers),
  );
  router.post(
    '/:id/resources/harvester-loadbalancers',
    checkAdminPermission,
    createProviderRouter(lbCreateHandlers),
  );
  router.get(
    '/:id/resources/services',
    checkAdminPermission,
    createProviderRouter(serviceListHandlers),
  );
  router.delete(
    '/:id/resources/harvester-loadbalancers/:namespace/:name',
    checkAdminPermission,
    createProviderRouter(lbDeleteHandlers),
  );
  router.get(
    '/:id/resources/ippools',
    checkAdminPermission,
    createProviderRouter(ipPoolListHandlers),
  );
  router.post(
    '/:id/resources/ippools',
    checkAdminPermission,
    createProviderRouter(ipPoolCreateHandlers),
  );
  router.delete(
    '/:id/resources/ippools/:name',
    checkAdminPermission,
    createProviderRouter(ipPoolDeleteHandlers),
  );

  // 存储（Harvester volumes / snapshots / capabilities）
  router.get(
    '/:id/resources/harvester/volumes',
    checkAdminPermission,
    createProviderRouter(volumeListHandlers),
  );
  router.get(
    '/:id/resources/harvester/volumes/:namespace/:name',
    checkAdminPermission,
    createProviderRouter(volumeDetailHandlers),
  );
  router.get(
    '/:id/resources/harvester/available-volumes',
    checkAdminPermission,
    createProviderRouter(availableVolumesHandlers),
  );
  router.post(
    '/:id/resources/harvester/volumes',
    checkAdminPermission,
    createProviderRouter(volumeCreateHandlers),
  );
  router.delete(
    '/:id/resources/harvester/volumes/:name',
    checkAdminPermission,
    createProviderRouter(volumeDeleteHandlers),
  );
  router.put(
    '/:id/resources/harvester/volumes/:namespace/:name',
    checkAdminPermission,
    createProviderRouter(volumeUpdateHandlers),
  );

  router.post(
    '/:id/resources/harvester/snapshots/:namespace/:name/restore',
    checkAdminPermission,
    createProviderRouter(snapshotRestoreHandlers),
  );
  router.post(
    '/:id/resources/harvester/volumes/:namespace/:name/snapshots',
    checkAdminPermission,
    createProviderRouter(volumeSnapshotCreateHandlers),
  );
  router.post(
    '/:id/resources/harvester/volumes/snapshot',
    checkAdminPermission,
    createProviderRouter(volumeSnapshotLegacyHandlers),
  );
  router.get(
    '/:id/resources/harvester/snapshot-classes',
    checkAdminPermission,
    createProviderRouter(snapshotClassesListHandlers),
  );

  router.post(
    '/:id/resources/harvester/volumes/:namespace/:name/export-image',
    checkAdminPermission,
    createProviderRouter(volumeExportImageHandlers),
  );
  router.post(
    '/:id/resources/harvester/volumes/:namespace/:name/clone',
    checkAdminPermission,
    createProviderRouter(volumeCloneHandlers),
  );
  router.post(
    '/:id/resources/harvester/volumes/export-image',
    checkAdminPermission,
    createProviderRouter(volumeExportImageLegacyHandlers),
  );
  router.post(
    '/:id/resources/harvester/volumes/clone',
    checkAdminPermission,
    createProviderRouter(volumeCloneLegacyHandlers),
  );

  router.get(
    '/:id/resources/harvester/capabilities',
    checkAdminPermission,
    createProviderRouter(capabilitiesHandlers),
  );
  router.get(
    '/:id/resources/harvester/storage-classes/:name',
    checkAdminPermission,
    createProviderRouter(storageClassDetailHandlers),
  );
}
