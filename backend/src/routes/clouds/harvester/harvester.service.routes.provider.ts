/**
 * Harvester 服务路由注册（策略模式+中间件）
 * 包含日志和监控等跨资源服务
 */

import { Router, RequestHandler } from 'express';
import { createProviderRouter } from '../middleware/provider-router';
import {
  harvesterClusterFlowListHandler,
  harvesterClusterFlowDetailHandler,
  harvesterClusterFlowCreateHandler,
  harvesterClusterFlowUpdateHandler,
  harvesterClusterFlowDeleteHandler,
  harvesterClusterOutputListHandler,
  harvesterClusterOutputDetailHandler,
  harvesterClusterOutputCreateHandler,
  harvesterClusterOutputUpdateHandler,
  harvesterClusterOutputDeleteHandler,
  harvesterLoggingTemplateHandler,
  harvesterFlowListHandler,
  harvesterFlowDetailHandler,
  harvesterFlowCreateHandler,
  harvesterFlowUpdateHandler,
  harvesterFlowDeleteHandler,
  harvesterOutputListHandler,
  harvesterOutputListByNamespaceHandler,
  harvesterOutputDetailHandler,
  harvesterOutputCreateHandler,
  harvesterOutputUpdateHandler,
  harvesterOutputDeleteHandler,
  harvesterVmPodHandler,
  harvesterEventsHandler,
} from './handlers/logging.handlers';
import {
  harvesterMonitoringStorageNodesHandler,
  harvesterMonitoringCephClustersHandler,
  harvesterMonitoringCephRookBundleHandler,
  harvesterMonitoringNodeResourcesHandler,
  harvesterMonitoringNodeMetricsHandler,
  harvesterMonitoringVirtualMachinesHandler,
  harvesterMonitoringVirtualMachineInstancesHandler,
  harvesterMonitoringBlockDevicesHandler,
  harvesterMonitoringMetricRangeHandler,
  harvesterMonitoringAllowedNamespacesHandler,
} from './handlers/monitoring-overview.handlers';
import {
  harvesterMonitoringCephDashboardSummaryHandler,
  harvesterMonitoringCephDashboardSummaryPostHandler,
  harvesterMonitoringCephDashboardSyncHandler,
  harvesterMonitoringCephDashboardCacheHandler,
  harvesterMonitoringCephDashboardProxyHandler,
} from './handlers/monitoring-ceph-dashboard.handlers';
import { harvesterCephRookBundleHandler } from './handlers/ceph-rook.handlers';
import {
  harvesterCephHarvesterAddonApplyHandler,
  harvesterCephHarvesterAddonGetHandler,
} from './handlers/ceph-harvester-addon.handlers';
import {
  harvesterCephRookBlockPoolCreateHandler,
  harvesterCephRookBlockPoolDeleteHandler,
  harvesterCephRookBlockPoolGetHandler,
  harvesterCephRookBlockPoolPatchHandler,
  harvesterCephRookBlockPoolReplaceHandler,
  harvesterCephRookClusterGetHandler,
  harvesterCephRookClusterPatchHandler,
  harvesterCephRookClusterReplaceHandler,
  harvesterCephRookFilesystemCreateHandler,
  harvesterCephRookFilesystemDeleteHandler,
  harvesterCephRookFilesystemGetHandler,
  harvesterCephRookFilesystemPatchHandler,
  harvesterCephRookFilesystemReplaceHandler,
  harvesterCephRookObjectStoreCreateHandler,
  harvesterCephRookObjectStoreDeleteHandler,
  harvesterCephRookObjectStoreGetHandler,
  harvesterCephRookObjectStorePatchHandler,
  harvesterCephRookObjectStoreReplaceHandler,
  harvesterCephRookObjectStoreUserCreateHandler,
  harvesterCephRookObjectStoreUserDeleteHandler,
  harvesterCephRookObjectStoreUserGetHandler,
  harvesterCephRookObjectStoreUserPatchHandler,
  harvesterCephRookObjectStoreUserReplaceHandler,
  harvesterCephRookRadosNamespaceCreateHandler,
  harvesterCephRookRadosNamespaceDeleteHandler,
  harvesterCephRookRadosNamespaceGetHandler,
  harvesterCephRookRadosNamespacePatchHandler,
  harvesterCephRookRadosNamespaceReplaceHandler,
  harvesterCephRookRbdMirrorGetHandler,
} from './handlers/ceph-rook-crud.handlers';
import {
  harvesterCephRgwS3CreateBucketHandler,
  harvesterCephRgwS3DeleteBucketHandler,
  harvesterCephRgwS3ListBucketsHandler,
  harvesterCephRgwS3ListObjectsHandler,
  harvesterCephRgwS3RookSecretHandler,
} from './handlers/ceph-rgw-s3.handlers';
import {
  harvesterCephRgwS3GatewayClientConfigGetHandler,
  harvesterCephRgwS3GatewayClientConfigPutHandler,
} from './handlers/ceph-rgw-s3-gateway-binding.handlers';
import {
  harvesterMonitoringAlertsRulesHandler,
  harvesterMonitoringPrometheusRulesHandler,
  harvesterMonitoringPrometheusRulesGroupsHandler,
  harvesterMonitoringVmCustomRulesHandler,
} from './handlers/monitoring-rules.handlers';
import {
  harvesterMonitoringAlertmanagerConfigsHandler,
  harvesterMonitoringAlertmanagerConfigsPolicyReceiversHandler,
  harvesterMonitoringAlertmanagerConfigsDetailHandler,
  harvesterMonitoringAlertmanagerConfigsCreateHandler,
  harvesterMonitoringAlertmanagerConfigsUpdateHandler,
  harvesterMonitoringAlertmanagerConfigsDeleteHandler,
} from './handlers/monitoring-alerts-policies.handlers';
import {
  harvesterMonitoringAlertmanagerConfigsReceiversHandler,
  harvesterMonitoringAlertmanagerConfigsReceiversCheckHandler,
  harvesterMonitoringAlertmanagerConfigsReceiversCreateUpdateHandler,
  harvesterMonitoringAlertmanagerConfigsReceiversDeleteHandler,
} from './handlers/monitoring-alerts-receivers.handlers';
import {
  harvesterMonitoringSecretsListHandler,
  harvesterMonitoringSecretsDetailHandler,
  harvesterMonitoringSecretsCreateHandler,
  harvesterMonitoringSecretsUpdateHandler,
  harvesterMonitoringSecretsDeleteHandler,
  harvesterMonitoringConfigMapsDetailHandler,
} from './handlers/monitoring-secrets.handlers';

export function registerHarvesterServiceRoutesProvider(
  router: Router,
  checkAdminPermission: RequestHandler
) {
  // Logging Handlers 映射
  const loggingHandlers = {
    harvester: null as any,
    cloudmap: null as any,
    'cloudmap.private': null as any,
    'cloudmap.edge': null as any,
  };

  // ClusterFlow Handlers
  const clusterFlowListHandlers = {
    harvester: harvesterClusterFlowListHandler,
    cloudmap: harvesterClusterFlowListHandler,
    'cloudmap.private': harvesterClusterFlowListHandler,
    'cloudmap.edge': harvesterClusterFlowListHandler,
  };

  const clusterFlowDetailHandlers = {
    harvester: harvesterClusterFlowDetailHandler,
    cloudmap: harvesterClusterFlowDetailHandler,
    'cloudmap.private': harvesterClusterFlowDetailHandler,
    'cloudmap.edge': harvesterClusterFlowDetailHandler,
  };

  const clusterFlowCreateHandlers = {
    harvester: harvesterClusterFlowCreateHandler,
    cloudmap: harvesterClusterFlowCreateHandler,
    'cloudmap.private': harvesterClusterFlowCreateHandler,
    'cloudmap.edge': harvesterClusterFlowCreateHandler,
  };

  const clusterFlowUpdateHandlers = {
    harvester: harvesterClusterFlowUpdateHandler,
    cloudmap: harvesterClusterFlowUpdateHandler,
    'cloudmap.private': harvesterClusterFlowUpdateHandler,
    'cloudmap.edge': harvesterClusterFlowUpdateHandler,
  };

  const clusterFlowDeleteHandlers = {
    harvester: harvesterClusterFlowDeleteHandler,
    cloudmap: harvesterClusterFlowDeleteHandler,
    'cloudmap.private': harvesterClusterFlowDeleteHandler,
    'cloudmap.edge': harvesterClusterFlowDeleteHandler,
  };

  // ClusterOutput Handlers
  const clusterOutputListHandlers = {
    harvester: harvesterClusterOutputListHandler,
    cloudmap: harvesterClusterOutputListHandler,
    'cloudmap.private': harvesterClusterOutputListHandler,
    'cloudmap.edge': harvesterClusterOutputListHandler,
  };

  const clusterOutputDetailHandlers = {
    harvester: harvesterClusterOutputDetailHandler,
    cloudmap: harvesterClusterOutputDetailHandler,
    'cloudmap.private': harvesterClusterOutputDetailHandler,
    'cloudmap.edge': harvesterClusterOutputDetailHandler,
  };

  const clusterOutputCreateHandlers = {
    harvester: harvesterClusterOutputCreateHandler,
    cloudmap: harvesterClusterOutputCreateHandler,
    'cloudmap.private': harvesterClusterOutputCreateHandler,
    'cloudmap.edge': harvesterClusterOutputCreateHandler,
  };

  const clusterOutputUpdateHandlers = {
    harvester: harvesterClusterOutputUpdateHandler,
    cloudmap: harvesterClusterOutputUpdateHandler,
    'cloudmap.private': harvesterClusterOutputUpdateHandler,
    'cloudmap.edge': harvesterClusterOutputUpdateHandler,
  };

  const clusterOutputDeleteHandlers = {
    harvester: harvesterClusterOutputDeleteHandler,
    cloudmap: harvesterClusterOutputDeleteHandler,
    'cloudmap.private': harvesterClusterOutputDeleteHandler,
    'cloudmap.edge': harvesterClusterOutputDeleteHandler,
  };

  // Flow Handlers
  const flowListHandlers = {
    harvester: harvesterFlowListHandler,
    cloudmap: harvesterFlowListHandler,
    'cloudmap.private': harvesterFlowListHandler,
    'cloudmap.edge': harvesterFlowListHandler,
  };

  const flowDetailHandlers = {
    harvester: harvesterFlowDetailHandler,
    cloudmap: harvesterFlowDetailHandler,
    'cloudmap.private': harvesterFlowDetailHandler,
    'cloudmap.edge': harvesterFlowDetailHandler,
  };

  const flowCreateHandlers = {
    harvester: harvesterFlowCreateHandler,
    cloudmap: harvesterFlowCreateHandler,
    'cloudmap.private': harvesterFlowCreateHandler,
    'cloudmap.edge': harvesterFlowCreateHandler,
  };

  const flowUpdateHandlers = {
    harvester: harvesterFlowUpdateHandler,
    cloudmap: harvesterFlowUpdateHandler,
    'cloudmap.private': harvesterFlowUpdateHandler,
    'cloudmap.edge': harvesterFlowUpdateHandler,
  };

  const flowDeleteHandlers = {
    harvester: harvesterFlowDeleteHandler,
    cloudmap: harvesterFlowDeleteHandler,
    'cloudmap.private': harvesterFlowDeleteHandler,
    'cloudmap.edge': harvesterFlowDeleteHandler,
  };

  // Output Handlers
  const outputListHandlers = {
    harvester: harvesterOutputListHandler,
    cloudmap: harvesterOutputListHandler,
    'cloudmap.private': harvesterOutputListHandler,
    'cloudmap.edge': harvesterOutputListHandler,
  };

  const outputListByNamespaceHandlers = {
    harvester: harvesterOutputListByNamespaceHandler,
    cloudmap: harvesterOutputListByNamespaceHandler,
    'cloudmap.private': harvesterOutputListByNamespaceHandler,
    'cloudmap.edge': harvesterOutputListByNamespaceHandler,
  };

  const outputDetailHandlers = {
    harvester: harvesterOutputDetailHandler,
    cloudmap: harvesterOutputDetailHandler,
    'cloudmap.private': harvesterOutputDetailHandler,
    'cloudmap.edge': harvesterOutputDetailHandler,
  };

  const outputCreateHandlers = {
    harvester: harvesterOutputCreateHandler,
    cloudmap: harvesterOutputCreateHandler,
    'cloudmap.private': harvesterOutputCreateHandler,
    'cloudmap.edge': harvesterOutputCreateHandler,
  };

  const outputUpdateHandlers = {
    harvester: harvesterOutputUpdateHandler,
    cloudmap: harvesterOutputUpdateHandler,
    'cloudmap.private': harvesterOutputUpdateHandler,
    'cloudmap.edge': harvesterOutputUpdateHandler,
  };

  const outputDeleteHandlers = {
    harvester: harvesterOutputDeleteHandler,
    cloudmap: harvesterOutputDeleteHandler,
    'cloudmap.private': harvesterOutputDeleteHandler,
    'cloudmap.edge': harvesterOutputDeleteHandler,
  };

  // VM Pod & Events Handlers
  const vmPodHandlers = {
    harvester: harvesterVmPodHandler,
    cloudmap: harvesterVmPodHandler,
    'cloudmap.private': harvesterVmPodHandler,
    'cloudmap.edge': harvesterVmPodHandler,
  };

  const eventsHandlers = {
    harvester: harvesterEventsHandler,
    cloudmap: harvesterEventsHandler,
    'cloudmap.private': harvesterEventsHandler,
    'cloudmap.edge': harvesterEventsHandler,
  };

  const loggingTemplateHandlers = {
    harvester: harvesterLoggingTemplateHandler,
    cloudmap: harvesterLoggingTemplateHandler,
    'cloudmap.private': harvesterLoggingTemplateHandler,
    'cloudmap.edge': harvesterLoggingTemplateHandler,
  };

  // Logging Routes
  // ClusterFlow
  router.get('/:id/logging/clusterflows', checkAdminPermission, createProviderRouter(clusterFlowListHandlers));
  router.get('/:id/logging/clusterflows/:name', checkAdminPermission, createProviderRouter(clusterFlowDetailHandlers));
  router.post('/:id/logging/clusterflows', checkAdminPermission, createProviderRouter(clusterFlowCreateHandlers));
  router.put('/:id/logging/clusterflows/:name', checkAdminPermission, createProviderRouter(clusterFlowUpdateHandlers));
  router.delete('/:id/logging/clusterflows/:name', checkAdminPermission, createProviderRouter(clusterFlowDeleteHandlers));

  // ClusterOutput
  router.get('/:id/logging/clusteroutputs', checkAdminPermission, createProviderRouter(clusterOutputListHandlers));
  router.get('/:id/logging/clusteroutputs/:name', checkAdminPermission, createProviderRouter(clusterOutputDetailHandlers));
  router.post('/:id/logging/clusteroutputs', checkAdminPermission, createProviderRouter(clusterOutputCreateHandlers));
  router.put('/:id/logging/clusteroutputs/:name', checkAdminPermission, createProviderRouter(clusterOutputUpdateHandlers));
  router.delete('/:id/logging/clusteroutputs/:name', checkAdminPermission, createProviderRouter(clusterOutputDeleteHandlers));

  // Templates
  router.get('/:id/logging/templates', checkAdminPermission, createProviderRouter(loggingTemplateHandlers));

  // Flow (Namespace Scoped)
  router.get('/:id/logging/flows', checkAdminPermission, createProviderRouter(flowListHandlers));
  router.get('/:id/logging/flows/:namespace/:name', checkAdminPermission, createProviderRouter(flowDetailHandlers));
  router.post('/:id/logging/flows', checkAdminPermission, createProviderRouter(flowCreateHandlers));
  router.put('/:id/logging/flows/:namespace/:name', checkAdminPermission, createProviderRouter(flowUpdateHandlers));
  router.delete('/:id/logging/flows/:namespace/:name', checkAdminPermission, createProviderRouter(flowDeleteHandlers));

  // Output (Namespace Scoped)
  router.get('/:id/logging/outputs', checkAdminPermission, createProviderRouter(outputListHandlers));
  router.get('/:id/logging/outputs/:namespace', checkAdminPermission, createProviderRouter(outputListByNamespaceHandlers));
  router.get('/:id/logging/outputs/:namespace/:name', checkAdminPermission, createProviderRouter(outputDetailHandlers));
  router.post('/:id/logging/outputs', checkAdminPermission, createProviderRouter(outputCreateHandlers));
  router.put('/:id/logging/outputs/:namespace/:name', checkAdminPermission, createProviderRouter(outputUpdateHandlers));
  router.delete('/:id/logging/outputs/:namespace/:name', checkAdminPermission, createProviderRouter(outputDeleteHandlers));

  // VM Pod & Events
  router.get('/:id/logging/harvester/vm-pod', checkAdminPermission, createProviderRouter(vmPodHandlers));
  router.get('/:id/logging/harvester/events', checkAdminPermission, createProviderRouter(eventsHandlers));

  // Monitoring Handlers 映射
  const monitoringOverviewHandlers = {
    harvester: harvesterMonitoringStorageNodesHandler,
    cloudmap: harvesterMonitoringStorageNodesHandler,
    'cloudmap.private': harvesterMonitoringStorageNodesHandler,
    'cloudmap.edge': harvesterMonitoringStorageNodesHandler,
  };

  const monitoringCephClustersHandlers = {
    harvester: harvesterMonitoringCephClustersHandler,
    cloudmap: harvesterMonitoringCephClustersHandler,
    'cloudmap.private': harvesterMonitoringCephClustersHandler,
    'cloudmap.edge': harvesterMonitoringCephClustersHandler,
  };

  const monitoringCephRookBundleHandlers = {
    harvester: harvesterMonitoringCephRookBundleHandler,
    cloudmap: harvesterMonitoringCephRookBundleHandler,
    'cloudmap.private': harvesterMonitoringCephRookBundleHandler,
    'cloudmap.edge': harvesterMonitoringCephRookBundleHandler,
  };

  const cephRookBundleHandlers = {
    harvester: harvesterCephRookBundleHandler,
    cloudmap: harvesterCephRookBundleHandler,
    'cloudmap.private': harvesterCephRookBundleHandler,
    'cloudmap.edge': harvesterCephRookBundleHandler,
  };

  const monitoringCephDashboardSummaryHandlers = {
    harvester: harvesterMonitoringCephDashboardSummaryHandler,
    cloudmap: harvesterMonitoringCephDashboardSummaryHandler,
    'cloudmap.private': harvesterMonitoringCephDashboardSummaryHandler,
    'cloudmap.edge': harvesterMonitoringCephDashboardSummaryHandler,
  };

  const monitoringCephDashboardSummaryPostHandlers = {
    harvester: harvesterMonitoringCephDashboardSummaryPostHandler,
    cloudmap: harvesterMonitoringCephDashboardSummaryPostHandler,
    'cloudmap.private': harvesterMonitoringCephDashboardSummaryPostHandler,
    'cloudmap.edge': harvesterMonitoringCephDashboardSummaryPostHandler,
  };

  const monitoringCephDashboardSyncHandlers = {
    harvester: harvesterMonitoringCephDashboardSyncHandler,
    cloudmap: harvesterMonitoringCephDashboardSyncHandler,
    'cloudmap.private': harvesterMonitoringCephDashboardSyncHandler,
    'cloudmap.edge': harvesterMonitoringCephDashboardSyncHandler,
  };

  const monitoringCephDashboardCacheHandlers = {
    harvester: harvesterMonitoringCephDashboardCacheHandler,
    cloudmap: harvesterMonitoringCephDashboardCacheHandler,
    'cloudmap.private': harvesterMonitoringCephDashboardCacheHandler,
    'cloudmap.edge': harvesterMonitoringCephDashboardCacheHandler,
  };

  const monitoringCephDashboardProxyHandlers = {
    harvester: harvesterMonitoringCephDashboardProxyHandler,
    cloudmap: harvesterMonitoringCephDashboardProxyHandler,
    'cloudmap.private': harvesterMonitoringCephDashboardProxyHandler,
    'cloudmap.edge': harvesterMonitoringCephDashboardProxyHandler,
  };

  const monitoringNodeResourcesHandlers = {
    harvester: harvesterMonitoringNodeResourcesHandler,
    cloudmap: harvesterMonitoringNodeResourcesHandler,
    'cloudmap.private': harvesterMonitoringNodeResourcesHandler,
    'cloudmap.edge': harvesterMonitoringNodeResourcesHandler,
  };

  const monitoringNodeMetricsHandlers = {
    harvester: harvesterMonitoringNodeMetricsHandler,
    cloudmap: harvesterMonitoringNodeMetricsHandler,
    'cloudmap.private': harvesterMonitoringNodeMetricsHandler,
    'cloudmap.edge': harvesterMonitoringNodeMetricsHandler,
  };

  const monitoringVirtualMachinesHandlers = {
    harvester: harvesterMonitoringVirtualMachinesHandler,
    cloudmap: harvesterMonitoringVirtualMachinesHandler,
    'cloudmap.private': harvesterMonitoringVirtualMachinesHandler,
    'cloudmap.edge': harvesterMonitoringVirtualMachinesHandler,
  };

  const monitoringVirtualMachineInstancesHandlers = {
    harvester: harvesterMonitoringVirtualMachineInstancesHandler,
    cloudmap: harvesterMonitoringVirtualMachineInstancesHandler,
    'cloudmap.private': harvesterMonitoringVirtualMachineInstancesHandler,
    'cloudmap.edge': harvesterMonitoringVirtualMachineInstancesHandler,
  };

  const monitoringBlockDevicesHandlers = {
    harvester: harvesterMonitoringBlockDevicesHandler,
    cloudmap: harvesterMonitoringBlockDevicesHandler,
    'cloudmap.private': harvesterMonitoringBlockDevicesHandler,
    'cloudmap.edge': harvesterMonitoringBlockDevicesHandler,
  };

  const monitoringMetricRangeHandlers = {
    harvester: harvesterMonitoringMetricRangeHandler,
    cloudmap: harvesterMonitoringMetricRangeHandler,
    'cloudmap.private': harvesterMonitoringMetricRangeHandler,
    'cloudmap.edge': harvesterMonitoringMetricRangeHandler,
  };

  const monitoringAllowedNamespacesHandlers = {
    harvester: harvesterMonitoringAllowedNamespacesHandler,
    cloudmap: harvesterMonitoringAllowedNamespacesHandler,
    'cloudmap.private': harvesterMonitoringAllowedNamespacesHandler,
    'cloudmap.edge': harvesterMonitoringAllowedNamespacesHandler,
  };

  const monitoringAlertsRulesHandlers = {
    harvester: harvesterMonitoringAlertsRulesHandler,
    cloudmap: harvesterMonitoringAlertsRulesHandler,
    'cloudmap.private': harvesterMonitoringAlertsRulesHandler,
    'cloudmap.edge': harvesterMonitoringAlertsRulesHandler,
  };

  const monitoringPrometheusRulesHandlers = {
    harvester: harvesterMonitoringPrometheusRulesHandler,
    cloudmap: harvesterMonitoringPrometheusRulesHandler,
    'cloudmap.private': harvesterMonitoringPrometheusRulesHandler,
    'cloudmap.edge': harvesterMonitoringPrometheusRulesHandler,
  };

  const monitoringPrometheusRulesGroupsHandlers = {
    harvester: harvesterMonitoringPrometheusRulesGroupsHandler,
    cloudmap: harvesterMonitoringPrometheusRulesGroupsHandler,
    'cloudmap.private': harvesterMonitoringPrometheusRulesGroupsHandler,
    'cloudmap.edge': harvesterMonitoringPrometheusRulesGroupsHandler,
  };

  const monitoringVmCustomRulesHandlers = {
    harvester: harvesterMonitoringVmCustomRulesHandler,
    cloudmap: harvesterMonitoringVmCustomRulesHandler,
    'cloudmap.private': harvesterMonitoringVmCustomRulesHandler,
    'cloudmap.edge': harvesterMonitoringVmCustomRulesHandler,
  };

  const monitoringAlertmanagerConfigsHandlers = {
    harvester: harvesterMonitoringAlertmanagerConfigsHandler,
    cloudmap: harvesterMonitoringAlertmanagerConfigsHandler,
    'cloudmap.private': harvesterMonitoringAlertmanagerConfigsHandler,
    'cloudmap.edge': harvesterMonitoringAlertmanagerConfigsHandler,
  };

  const monitoringAlertmanagerConfigsPolicyReceiversHandlers = {
    harvester: harvesterMonitoringAlertmanagerConfigsPolicyReceiversHandler,
    cloudmap: harvesterMonitoringAlertmanagerConfigsPolicyReceiversHandler,
    'cloudmap.private': harvesterMonitoringAlertmanagerConfigsPolicyReceiversHandler,
    'cloudmap.edge': harvesterMonitoringAlertmanagerConfigsPolicyReceiversHandler,
  };

  const monitoringAlertmanagerConfigsDetailHandlers = {
    harvester: harvesterMonitoringAlertmanagerConfigsDetailHandler,
    cloudmap: harvesterMonitoringAlertmanagerConfigsDetailHandler,
    'cloudmap.private': harvesterMonitoringAlertmanagerConfigsDetailHandler,
    'cloudmap.edge': harvesterMonitoringAlertmanagerConfigsDetailHandler,
  };

  const monitoringAlertmanagerConfigsCreateHandlers = {
    harvester: harvesterMonitoringAlertmanagerConfigsCreateHandler,
    cloudmap: harvesterMonitoringAlertmanagerConfigsCreateHandler,
    'cloudmap.private': harvesterMonitoringAlertmanagerConfigsCreateHandler,
    'cloudmap.edge': harvesterMonitoringAlertmanagerConfigsCreateHandler,
  };

  const monitoringAlertmanagerConfigsUpdateHandlers = {
    harvester: harvesterMonitoringAlertmanagerConfigsUpdateHandler,
    cloudmap: harvesterMonitoringAlertmanagerConfigsUpdateHandler,
    'cloudmap.private': harvesterMonitoringAlertmanagerConfigsUpdateHandler,
    'cloudmap.edge': harvesterMonitoringAlertmanagerConfigsUpdateHandler,
  };

  const monitoringAlertmanagerConfigsDeleteHandlers = {
    harvester: harvesterMonitoringAlertmanagerConfigsDeleteHandler,
    cloudmap: harvesterMonitoringAlertmanagerConfigsDeleteHandler,
    'cloudmap.private': harvesterMonitoringAlertmanagerConfigsDeleteHandler,
    'cloudmap.edge': harvesterMonitoringAlertmanagerConfigsDeleteHandler,
  };

  const monitoringAlertmanagerConfigsReceiversHandlers = {
    harvester: harvesterMonitoringAlertmanagerConfigsReceiversHandler,
    cloudmap: harvesterMonitoringAlertmanagerConfigsReceiversHandler,
    'cloudmap.private': harvesterMonitoringAlertmanagerConfigsReceiversHandler,
    'cloudmap.edge': harvesterMonitoringAlertmanagerConfigsReceiversHandler,
  };

  const monitoringAlertmanagerConfigsReceiversCheckHandlers = {
    harvester: harvesterMonitoringAlertmanagerConfigsReceiversCheckHandler,
    cloudmap: harvesterMonitoringAlertmanagerConfigsReceiversCheckHandler,
    'cloudmap.private': harvesterMonitoringAlertmanagerConfigsReceiversCheckHandler,
    'cloudmap.edge': harvesterMonitoringAlertmanagerConfigsReceiversCheckHandler,
  };

  const monitoringAlertmanagerConfigsReceiversCreateUpdateHandlers = {
    harvester: harvesterMonitoringAlertmanagerConfigsReceiversCreateUpdateHandler,
    cloudmap: harvesterMonitoringAlertmanagerConfigsReceiversCreateUpdateHandler,
    'cloudmap.private': harvesterMonitoringAlertmanagerConfigsReceiversCreateUpdateHandler,
    'cloudmap.edge': harvesterMonitoringAlertmanagerConfigsReceiversCreateUpdateHandler,
  };

  const monitoringAlertmanagerConfigsReceiversDeleteHandlers = {
    harvester: harvesterMonitoringAlertmanagerConfigsReceiversDeleteHandler,
    cloudmap: harvesterMonitoringAlertmanagerConfigsReceiversDeleteHandler,
    'cloudmap.private': harvesterMonitoringAlertmanagerConfigsReceiversDeleteHandler,
    'cloudmap.edge': harvesterMonitoringAlertmanagerConfigsReceiversDeleteHandler,
  };

  const monitoringSecretsListHandlers = {
    harvester: harvesterMonitoringSecretsListHandler,
    cloudmap: harvesterMonitoringSecretsListHandler,
    'cloudmap.private': harvesterMonitoringSecretsListHandler,
    'cloudmap.edge': harvesterMonitoringSecretsListHandler,
  };

  const monitoringSecretsDetailHandlers = {
    harvester: harvesterMonitoringSecretsDetailHandler,
    cloudmap: harvesterMonitoringSecretsDetailHandler,
    'cloudmap.private': harvesterMonitoringSecretsDetailHandler,
    'cloudmap.edge': harvesterMonitoringSecretsDetailHandler,
  };

  const monitoringSecretsCreateHandlers = {
    harvester: harvesterMonitoringSecretsCreateHandler,
    cloudmap: harvesterMonitoringSecretsCreateHandler,
    'cloudmap.private': harvesterMonitoringSecretsCreateHandler,
    'cloudmap.edge': harvesterMonitoringSecretsCreateHandler,
  };

  const monitoringSecretsUpdateHandlers = {
    harvester: harvesterMonitoringSecretsUpdateHandler,
    cloudmap: harvesterMonitoringSecretsUpdateHandler,
    'cloudmap.private': harvesterMonitoringSecretsUpdateHandler,
    'cloudmap.edge': harvesterMonitoringSecretsUpdateHandler,
  };

  const monitoringSecretsDeleteHandlers = {
    harvester: harvesterMonitoringSecretsDeleteHandler,
    cloudmap: harvesterMonitoringSecretsDeleteHandler,
    'cloudmap.private': harvesterMonitoringSecretsDeleteHandler,
    'cloudmap.edge': harvesterMonitoringSecretsDeleteHandler,
  };

  const monitoringConfigMapsDetailHandlers = {
    harvester: harvesterMonitoringConfigMapsDetailHandler,
    cloudmap: harvesterMonitoringConfigMapsDetailHandler,
    'cloudmap.private': harvesterMonitoringConfigMapsDetailHandler,
    'cloudmap.edge': harvesterMonitoringConfigMapsDetailHandler,
  };

  const cephAll = (h: RequestHandler): any => ({
    harvester: h,
    cloudmap: h,
    'cloudmap.private': h,
    'cloudmap.edge': h,
  });

  // Ceph（Rook 控制面：只读 bundle + Steve CRUD）
  router.get('/:id/ceph/rook/bundle', checkAdminPermission, createProviderRouter(cephRookBundleHandlers));
  router.get(
    '/:id/ceph/harvester-addon',
    checkAdminPermission,
    createProviderRouter(cephAll(harvesterCephHarvesterAddonGetHandler)),
  );
  router.post(
    '/:id/ceph/harvester-addon',
    checkAdminPermission,
    createProviderRouter(cephAll(harvesterCephHarvesterAddonApplyHandler)),
  );
  router.get(
    '/:id/ceph/rook/clusters/:namespace/:name',
    checkAdminPermission,
    createProviderRouter(cephAll(harvesterCephRookClusterGetHandler)),
  );
  router.put(
    '/:id/ceph/rook/clusters/:namespace/:name',
    checkAdminPermission,
    createProviderRouter(cephAll(harvesterCephRookClusterReplaceHandler)),
  );
  router.patch(
    '/:id/ceph/rook/clusters/:namespace/:name',
    checkAdminPermission,
    createProviderRouter(cephAll(harvesterCephRookClusterPatchHandler)),
  );
  router.post(
    '/:id/ceph/rook/block-pools',
    checkAdminPermission,
    createProviderRouter(cephAll(harvesterCephRookBlockPoolCreateHandler)),
  );
  router.get(
    '/:id/ceph/rook/block-pools/:namespace/:name',
    checkAdminPermission,
    createProviderRouter(cephAll(harvesterCephRookBlockPoolGetHandler)),
  );
  router.put(
    '/:id/ceph/rook/block-pools/:namespace/:name',
    checkAdminPermission,
    createProviderRouter(cephAll(harvesterCephRookBlockPoolReplaceHandler)),
  );
  router.patch(
    '/:id/ceph/rook/block-pools/:namespace/:name',
    checkAdminPermission,
    createProviderRouter(cephAll(harvesterCephRookBlockPoolPatchHandler)),
  );
  router.delete(
    '/:id/ceph/rook/block-pools/:namespace/:name',
    checkAdminPermission,
    createProviderRouter(cephAll(harvesterCephRookBlockPoolDeleteHandler)),
  );
  router.post(
    '/:id/ceph/rook/filesystems',
    checkAdminPermission,
    createProviderRouter(cephAll(harvesterCephRookFilesystemCreateHandler)),
  );
  router.get(
    '/:id/ceph/rook/filesystems/:namespace/:name',
    checkAdminPermission,
    createProviderRouter(cephAll(harvesterCephRookFilesystemGetHandler)),
  );
  router.put(
    '/:id/ceph/rook/filesystems/:namespace/:name',
    checkAdminPermission,
    createProviderRouter(cephAll(harvesterCephRookFilesystemReplaceHandler)),
  );
  router.patch(
    '/:id/ceph/rook/filesystems/:namespace/:name',
    checkAdminPermission,
    createProviderRouter(cephAll(harvesterCephRookFilesystemPatchHandler)),
  );
  router.delete(
    '/:id/ceph/rook/filesystems/:namespace/:name',
    checkAdminPermission,
    createProviderRouter(cephAll(harvesterCephRookFilesystemDeleteHandler)),
  );
  router.post(
    '/:id/ceph/rook/object-stores',
    checkAdminPermission,
    createProviderRouter(cephAll(harvesterCephRookObjectStoreCreateHandler)),
  );
  router.get(
    '/:id/ceph/rook/object-stores/:namespace/:name',
    checkAdminPermission,
    createProviderRouter(cephAll(harvesterCephRookObjectStoreGetHandler)),
  );
  router.put(
    '/:id/ceph/rook/object-stores/:namespace/:name',
    checkAdminPermission,
    createProviderRouter(cephAll(harvesterCephRookObjectStoreReplaceHandler)),
  );
  router.patch(
    '/:id/ceph/rook/object-stores/:namespace/:name',
    checkAdminPermission,
    createProviderRouter(cephAll(harvesterCephRookObjectStorePatchHandler)),
  );
  router.delete(
    '/:id/ceph/rook/object-stores/:namespace/:name',
    checkAdminPermission,
    createProviderRouter(cephAll(harvesterCephRookObjectStoreDeleteHandler)),
  );
  router.post(
    '/:id/ceph/rook/object-store-users',
    checkAdminPermission,
    createProviderRouter(cephAll(harvesterCephRookObjectStoreUserCreateHandler)),
  );
  router.get(
    '/:id/ceph/rook/object-store-users/:namespace/:name',
    checkAdminPermission,
    createProviderRouter(cephAll(harvesterCephRookObjectStoreUserGetHandler)),
  );
  router.put(
    '/:id/ceph/rook/object-store-users/:namespace/:name',
    checkAdminPermission,
    createProviderRouter(cephAll(harvesterCephRookObjectStoreUserReplaceHandler)),
  );
  router.patch(
    '/:id/ceph/rook/object-store-users/:namespace/:name',
    checkAdminPermission,
    createProviderRouter(cephAll(harvesterCephRookObjectStoreUserPatchHandler)),
  );
  router.delete(
    '/:id/ceph/rook/object-store-users/:namespace/:name',
    checkAdminPermission,
    createProviderRouter(cephAll(harvesterCephRookObjectStoreUserDeleteHandler)),
  );
  router.post(
    '/:id/ceph/rook/blockpool-rados-namespaces',
    checkAdminPermission,
    createProviderRouter(cephAll(harvesterCephRookRadosNamespaceCreateHandler)),
  );
  router.get(
    '/:id/ceph/rook/blockpool-rados-namespaces/:namespace/:name',
    checkAdminPermission,
    createProviderRouter(cephAll(harvesterCephRookRadosNamespaceGetHandler)),
  );
  router.put(
    '/:id/ceph/rook/blockpool-rados-namespaces/:namespace/:name',
    checkAdminPermission,
    createProviderRouter(cephAll(harvesterCephRookRadosNamespaceReplaceHandler)),
  );
  router.patch(
    '/:id/ceph/rook/blockpool-rados-namespaces/:namespace/:name',
    checkAdminPermission,
    createProviderRouter(cephAll(harvesterCephRookRadosNamespacePatchHandler)),
  );
  router.delete(
    '/:id/ceph/rook/blockpool-rados-namespaces/:namespace/:name',
    checkAdminPermission,
    createProviderRouter(cephAll(harvesterCephRookRadosNamespaceDeleteHandler)),
  );
  router.get(
    '/:id/ceph/rook/rbd-mirrors/:namespace/:name',
    checkAdminPermission,
    createProviderRouter(cephAll(harvesterCephRookRbdMirrorGetHandler)),
  );

  // RGW / S3（Tower 代发；凭证在请求体 connection 中，不落库）
  router.post(
    '/:id/ceph/rgw/s3/list-buckets',
    checkAdminPermission,
    createProviderRouter(cephAll(harvesterCephRgwS3ListBucketsHandler)),
  );
  router.post(
    '/:id/ceph/rgw/s3/buckets',
    checkAdminPermission,
    createProviderRouter(cephAll(harvesterCephRgwS3CreateBucketHandler)),
  );
  router.post(
    '/:id/ceph/rgw/s3/delete-bucket',
    checkAdminPermission,
    createProviderRouter(cephAll(harvesterCephRgwS3DeleteBucketHandler)),
  );
  router.post(
    '/:id/ceph/rgw/s3/list-objects',
    checkAdminPermission,
    createProviderRouter(cephAll(harvesterCephRgwS3ListObjectsHandler)),
  );
  router.get(
    '/:id/ceph/rgw/s3/rook-secret/:namespace/:name',
    checkAdminPermission,
    createProviderRouter(cephAll(harvesterCephRgwS3RookSecretHandler)),
  );
  router.get(
    '/:id/ceph/rgw/s3/gateway-client-config',
    checkAdminPermission,
    createProviderRouter(cephAll(harvesterCephRgwS3GatewayClientConfigGetHandler)),
  );
  router.put(
    '/:id/ceph/rgw/s3/gateway-client-config/:namespace/:name',
    checkAdminPermission,
    createProviderRouter(cephAll(harvesterCephRgwS3GatewayClientConfigPutHandler)),
  );

  // Monitoring Routes
  // Overview
  router.get('/:id/monitoring/storage-nodes', checkAdminPermission, createProviderRouter(monitoringOverviewHandlers));
  router.get('/:id/monitoring/ceph-clusters', checkAdminPermission, createProviderRouter(monitoringCephClustersHandlers));
  router.get('/:id/monitoring/ceph-resources', checkAdminPermission, createProviderRouter(monitoringCephRookBundleHandlers));
  router.get(
    '/:id/monitoring/ceph-dashboard/summary',
    checkAdminPermission,
    createProviderRouter(monitoringCephDashboardSummaryHandlers),
  );
  router.post(
    '/:id/monitoring/ceph-dashboard/summary',
    checkAdminPermission,
    createProviderRouter(monitoringCephDashboardSummaryPostHandlers),
  );
  router.post(
    '/:id/monitoring/ceph-dashboard/sync',
    checkAdminPermission,
    createProviderRouter(monitoringCephDashboardSyncHandlers),
  );
  router.get(
    '/:id/monitoring/ceph-dashboard/cache',
    checkAdminPermission,
    createProviderRouter(monitoringCephDashboardCacheHandlers),
  );
  router.all(
    '/:id/monitoring/ceph-dashboard/proxy',
    checkAdminPermission,
    createProviderRouter(monitoringCephDashboardProxyHandlers),
  );
  router.get('/:id/monitoring/node-resources', checkAdminPermission, createProviderRouter(monitoringNodeResourcesHandlers));
  router.get('/:id/monitoring/node-metrics', checkAdminPermission, createProviderRouter(monitoringNodeMetricsHandlers));
  router.get('/:id/monitoring/virtualmachines', checkAdminPermission, createProviderRouter(monitoringVirtualMachinesHandlers));
  router.get('/:id/monitoring/virtualmachineinstances', checkAdminPermission, createProviderRouter(monitoringVirtualMachineInstancesHandlers));
  router.get('/:id/monitoring/blockdevices', checkAdminPermission, createProviderRouter(monitoringBlockDevicesHandlers));
  router.get('/:id/monitoring/metric-range', checkAdminPermission, createProviderRouter(monitoringMetricRangeHandlers));
  router.get('/:id/monitoring/allowed-namespaces', checkAdminPermission, createProviderRouter(monitoringAllowedNamespacesHandlers));

  // Rules
  router.get('/:id/monitoring/alerts-rules', checkAdminPermission, createProviderRouter(monitoringAlertsRulesHandlers));
  router.get('/:id/monitoring/prometheusrules', checkAdminPermission, createProviderRouter(monitoringPrometheusRulesHandlers));
  router.get('/:id/monitoring/prometheusrules-groups', checkAdminPermission, createProviderRouter(monitoringPrometheusRulesGroupsHandlers));
  router.get('/:id/monitoring/prometheusrules/vm-custom-rules', checkAdminPermission, createProviderRouter(monitoringVmCustomRulesHandlers));

  // Alertmanager Policies
  router.get('/:id/monitoring/alertmanagerconfigs', checkAdminPermission, createProviderRouter(monitoringAlertmanagerConfigsHandlers));
  router.get('/:id/monitoring/alertmanagerconfigs/policy-receivers', checkAdminPermission, createProviderRouter(monitoringAlertmanagerConfigsPolicyReceiversHandlers));
  router.get('/:id/monitoring/alertmanagerconfigs/:namespace/:name', checkAdminPermission, createProviderRouter(monitoringAlertmanagerConfigsDetailHandlers));
  router.post('/:id/monitoring/alertmanagerconfigs', checkAdminPermission, createProviderRouter(monitoringAlertmanagerConfigsCreateHandlers));
  router.put('/:id/monitoring/alertmanagerconfigs/:namespace/:name', checkAdminPermission, createProviderRouter(monitoringAlertmanagerConfigsUpdateHandlers));
  router.delete('/:id/monitoring/alertmanagerconfigs/:namespace/:name', checkAdminPermission, createProviderRouter(monitoringAlertmanagerConfigsDeleteHandlers));

  // Alertmanager Receivers
  router.get('/:id/monitoring/alertmanagerconfigs/receivers', checkAdminPermission, createProviderRouter(monitoringAlertmanagerConfigsReceiversHandlers));
  router.get('/:id/monitoring/alertmanagerconfigs/receivers/check', checkAdminPermission, createProviderRouter(monitoringAlertmanagerConfigsReceiversCheckHandlers));
  router.post('/:id/monitoring/alertmanagerconfigs/receivers/:namespace/:name', checkAdminPermission, createProviderRouter(monitoringAlertmanagerConfigsReceiversCreateUpdateHandlers));
  router.delete('/:id/monitoring/alertmanagerconfigs/receivers/:namespace/:name', checkAdminPermission, createProviderRouter(monitoringAlertmanagerConfigsReceiversDeleteHandlers));

  // Secrets & ConfigMaps
  router.get('/:id/monitoring/secrets', checkAdminPermission, createProviderRouter(monitoringSecretsListHandlers));
  router.get('/:id/monitoring/secrets/:namespace/:name', checkAdminPermission, createProviderRouter(monitoringSecretsDetailHandlers));
  router.post('/:id/monitoring/secrets', checkAdminPermission, createProviderRouter(monitoringSecretsCreateHandlers));
  router.put('/:id/monitoring/secrets/:namespace/:name', checkAdminPermission, createProviderRouter(monitoringSecretsUpdateHandlers));
  router.delete('/:id/monitoring/secrets/:namespace/:name', checkAdminPermission, createProviderRouter(monitoringSecretsDeleteHandlers));
  router.get('/:id/monitoring/configmaps/:namespace/:name', checkAdminPermission, createProviderRouter(monitoringConfigMapsDetailHandlers));
}
