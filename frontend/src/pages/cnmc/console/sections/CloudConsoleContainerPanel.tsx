/**
 * Cloudmap 控制台 — 容器服务主内容区
 *
 * 信息架构（与资源池详情页「容器」分组对齐，但控制台收敛为 3 个类目，降低顶栏 Tab 数量）：
 *
 * 1. 运行 — 工作负载(Deployment/STS/DS)、Pod、任务(Job/CronJob)
 * 2. 网络 — Service、Ingress、网关路由(Gateway API)
 * 3. 配置 — ConfigMap/Secret、镜像仓库、Pod 中断保护、网络策略
 *
 * 说明：服务拓扑、Service 与多资源联动视图放在资源池详情页更合适；控制台以列表与常用操作为主。
 */
import React, { useCallback, useEffect, useMemo } from 'react';
import { Empty } from 'antd';
import { checkPoolPageReadPerm } from '../../clouds/Cloudmap/pool/lib/poolPageReadAccess';
import {
  CLOUD_CONTAINER_TAB_WRITE,
  CLOUD_CONSOLE_CONTAINER_RESOURCE_TO_TAB,
  type ContainerTabPermissionKey,
} from '../../../../utils/permissionUtils';
import { canAccessTenantConsoleContainerResource } from '../lib/tenantConsolePageAccess';
import { CONTAINER_NAV_CATEGORIES, type NavCategory } from '../lib/tenantConsoleSiderNav';
import { ContainerOperationsGate } from '../../clouds/Harvester/containers/ContainerOperationsContext';
import {
  ContainerSectionSuspense,
  LazyWorkloadsSection,
  LazyPodsSection,
  LazyJobsSection,
  LazyServicesSection,
  LazyIngressesSection,
  LazyGatewayApiSection,
  LazyConfigsSection,
  LazyRegistriesSection,
  LazyPDBSection,
  LazyNetworkPoliciesSection,
} from '../../clouds/Harvester/containers/lazySections';
import { pickFirstNamespaceRecordByScenario } from '../../../../utils/harvesterUtils';
import { useAuth } from '../../../../contexts/AuthContext';

const CONTAINER_TAB_CONFIG: NavCategory[] = CONTAINER_NAV_CATEGORIES;

export interface CloudConsoleContainerPanelProps {
  cloudId: string;

  activeCategory: string;
  setActiveCategory: (k: string) => void;
  activeResource: string;
  setActiveResource: (k: string) => void;

  namespacesOptions: string[];
  /** 命名空间库存（含 tower.io/scenario），用于创建表单的默认命名空间 */
  namespaceRecords?: any[];
  nodesOptions: string[];
  nsValue?: string;
  nodeValue?: string;
  onNsChange: (v?: string) => void;
  onNodeChange: (v?: string) => void;

  deployments: any[];
  statefulsets: any[];
  daemonsets: any[];
  pods: any[];
  jobs: any[];
  cronjobs: any[];
  services: any[];
  ingresses: any[];
  configmaps: any[];
  secrets: any[];
  imagePullSecrets: any[];
  pdbs: any[];
  networkpolicies: any[];
  gatewayApiStatus: {
    installed: boolean;
    resources: {
      gatewayClass: boolean;
      gateway: boolean;
      httpRoute: boolean;
      grpcRoute: boolean;
    };
  } | null;
  gatewayClasses: any[];
  gateways: any[];
  httpRoutes: any[];
  grpcRoutes: any[];
  volumes: any[];

  resourceLoading: Record<string, boolean | undefined>;

  onRefreshWorkloads: () => void;
  onRefreshPods: () => void;
  onRefreshJobs: (force?: boolean) => void;
  onRefreshServices: () => void;
  onRefreshIngresses: () => void;
  onRefreshGateway: () => void;
  onRefreshConfigs: (force?: boolean) => void;
  onRefreshRegistries: () => void;
  onRefreshPdbs: (force?: boolean) => void;
  onRefreshNetpol: (force?: boolean) => void;
}

const CloudConsoleContainerPanel: React.FC<CloudConsoleContainerPanelProps> = ({
  cloudId,
  activeCategory,
  setActiveCategory,
  activeResource,
  setActiveResource,
  namespacesOptions,
  namespaceRecords = [],
  nodesOptions,
  nsValue,
  nodeValue,
  onNsChange,
  onNodeChange,
  deployments,
  statefulsets,
  daemonsets,
  pods,
  jobs,
  cronjobs,
  services,
  ingresses,
  configmaps,
  secrets,
  imagePullSecrets,
  pdbs,
  networkpolicies,
  gatewayApiStatus,
  gatewayClasses,
  gateways,
  httpRoutes,
  grpcRoutes,
  volumes,
  resourceLoading,
  onRefreshWorkloads,
  onRefreshPods,
  onRefreshJobs,
  onRefreshServices,
  onRefreshIngresses,
  onRefreshGateway,
  onRefreshConfigs,
  onRefreshRegistries,
  onRefreshPdbs,
  onRefreshNetpol,
}) => {
  const { user } = useAuth();
  const permissions = useMemo(() => {
    const p = user?.permissions;
    return Array.isArray(p) ? p : [];
  }, [user?.permissions]);
  const canAccessContainerResource = useCallback(
    (resourceKey: string) => canAccessTenantConsoleContainerResource(permissions, resourceKey),
    [permissions],
  );
  const operationsReadOnly = useMemo(() => {
    const tabKey = CLOUD_CONSOLE_CONTAINER_RESOURCE_TO_TAB[activeResource] as
      | ContainerTabPermissionKey
      | undefined;
    if (!tabKey) return true;
    const writeAct = CLOUD_CONTAINER_TAB_WRITE[tabKey];
    const readAct = writeAct.replace(':write', ':read');
    return !(checkPoolPageReadPerm(permissions, readAct) || permissions.includes(writeAct));
  }, [activeResource, permissions]);

  const containerTabConfig = useMemo((): NavCategory[] => {
    return CONTAINER_TAB_CONFIG.map((cat) => ({
      ...cat,
      resources: cat.resources.filter((r) => canAccessContainerResource(r.key)),
    })).filter((cat) => cat.resources.length > 0);
  }, [canAccessContainerResource]);
  const isTenantUser = useMemo(
    () => user?.role === 'tenant' || !!user?.tenantId,
    [user],
  );

  const createDefaultNamespace = useMemo(() => {
    const picked = pickFirstNamespaceRecordByScenario(
      namespaceRecords,
      isTenantUser ? 'tenant' : 'admin',
    );
    return picked || nsValue;
  }, [namespaceRecords, isTenantUser, nsValue]);

  useEffect(() => {
    const keys = containerTabConfig.map((c) => c.key);
    if (keys.length === 0) return;
    if (!keys.includes(activeCategory)) {
      const first = containerTabConfig[0];
      setActiveCategory(first.key);
      setActiveResource(first.resources[0]?.key ?? '');
    }
  }, [activeCategory, containerTabConfig, setActiveCategory, setActiveResource]);

  useEffect(() => {
    const cat = containerTabConfig.find((c) => c.key === activeCategory);
    if (!cat?.resources.some((r) => r.key === activeResource)) {
      setActiveResource((cat?.resources[0]?.key ?? '') as string);
    }
  }, [activeCategory, activeResource, containerTabConfig, setActiveResource]);

  const renderContent = useCallback(() => {
    if (!canAccessContainerResource(activeResource)) {
      return <Empty description="无权限访问该页面" />;
    }
    const wlLoading =
      !!resourceLoading.deployments ||
      !!resourceLoading.statefulsets ||
      !!resourceLoading.daemonsets;
    const jobLoading = !!resourceLoading.jobs || !!resourceLoading.cronjobs;

    switch (activeResource) {
      case 'ctr-workloads':
        return (
          <LazyWorkloadsSection
            deployments={deployments}
            statefulsets={statefulsets}
            daemonsets={daemonsets}
            loading={wlLoading}
            namespacesOptions={namespacesOptions}
            imagePullSecrets={imagePullSecrets}
            secretsWithCredentials={secrets}
            configMaps={configmaps}
            secrets={secrets}
            persistentVolumeClaims={volumes}
            cloudId={cloudId}
            nsValue={nsValue}
            onNsChange={onNsChange}
            onRefresh={onRefreshWorkloads}
            createDefaultNamespace={createDefaultNamespace}
            onRefreshConfigMaps={() => onRefreshConfigs(true)}
            onRefreshSecrets={() => onRefreshConfigs(true)}
          />
        );
      case 'ctr-pods':
        return (
          <LazyPodsSection
            pods={pods}
            loading={!!resourceLoading.pods}
            namespacesOptions={namespacesOptions}
            nodesOptions={nodesOptions}
            cloudId={cloudId}
            nsValue={nsValue}
            nodeValue={nodeValue}
            onNsChange={onNsChange}
            onNodeChange={onNodeChange}
            onRefresh={onRefreshPods}
            deployments={deployments}
            statefulSets={statefulsets}
            daemonSets={daemonsets}
          />
        );
      case 'ctr-jobs':
        return (
          <LazyJobsSection
            jobs={jobs}
            cronjobs={cronjobs}
            loading={jobLoading}
            namespacesOptions={namespacesOptions}
            cloudId={cloudId}
            nsValue={nsValue}
            onNsChange={onNsChange}
            onRefresh={onRefreshJobs}
            imagePullSecrets={imagePullSecrets}
            secretsWithCredentials={secrets}
            createDefaultNamespace={createDefaultNamespace}
          />
        );
      case 'ctr-services':
        return (
          <LazyServicesSection
            cloudId={cloudId}
            services={services}
            loading={!!resourceLoading.services}
            onRefresh={onRefreshServices}
            isTenant={isTenantUser}
            namespacesOptions={namespacesOptions}
            nsValue={nsValue}
            onNsChange={onNsChange}
            pods={pods}
            createDefaultNamespace={createDefaultNamespace}
          />
        );
      case 'ctr-ingresses':
        return (
          <LazyIngressesSection
            cloudId={cloudId}
            ingresses={ingresses}
            loading={!!resourceLoading.ingresses}
            onRefresh={onRefreshIngresses}
            namespacesOptions={namespacesOptions}
            nsValue={nsValue}
            onNsChange={onNsChange}
            secrets={secrets}
            createDefaultNamespace={createDefaultNamespace}
          />
        );
      case 'ctr-gateway':
        return (
          <LazyGatewayApiSection
            cloudId={cloudId}
            gatewayApiStatus={gatewayApiStatus}
            gatewayClasses={gatewayClasses}
            gateways={gateways}
            httpRoutes={httpRoutes}
            grpcRoutes={grpcRoutes}
            loading={
              !!resourceLoading.gatewayApiStatus || !!resourceLoading.gateways
            }
            namespacesOptions={namespacesOptions}
            nsValue={nsValue}
            onNsChange={onNsChange}
            services={services}
            onRefresh={onRefreshGateway}
            createDefaultNamespace={createDefaultNamespace}
          />
        );
      case 'ctr-configs':
        return (
          <LazyConfigsSection
            configmaps={configmaps}
            secrets={secrets}
            loading={
              !!resourceLoading.configmaps || !!resourceLoading.secrets
            }
            namespacesOptions={namespacesOptions}
            cloudId={cloudId}
            nsValue={nsValue}
            onNsChange={onNsChange}
            onRefresh={onRefreshConfigs}
            createDefaultNamespace={createDefaultNamespace}
          />
        );
      case 'ctr-registries':
        return (
          <LazyRegistriesSection
            secrets={imagePullSecrets}
            secretsWithCredentials={secrets}
            loading={!!resourceLoading.imagePullSecrets}
            namespacesOptions={namespacesOptions}
            cloudId={cloudId}
            nsValue={nsValue}
            onNsChange={onNsChange}
            onRefresh={onRefreshRegistries}
            createDefaultNamespace={createDefaultNamespace}
          />
        );
      case 'ctr-pdbs':
        return (
          <LazyPDBSection
            pdbs={pdbs}
            loading={!!resourceLoading.pdbs}
            namespacesOptions={namespacesOptions}
            cloudId={cloudId}
            nsValue={nsValue}
            onNsChange={onNsChange}
            onRefresh={onRefreshPdbs}
            createDefaultNamespace={createDefaultNamespace}
          />
        );
      case 'ctr-netpol':
        return (
          <LazyNetworkPoliciesSection
            networkPolicies={networkpolicies}
            loading={!!resourceLoading.networkpolicies}
            namespacesOptions={namespacesOptions}
            cloudId={cloudId}
            nsValue={nsValue}
            onNsChange={onNsChange}
            onRefresh={onRefreshNetpol}
            createDefaultNamespace={createDefaultNamespace}
          />
        );
      default:
        return <Empty description="请选择资源类型" />;
    }
  }, [
    activeResource,
    cloudId,
    deployments,
    statefulsets,
    daemonsets,
    pods,
    jobs,
    cronjobs,
    services,
    ingresses,
    configmaps,
    secrets,
    imagePullSecrets,
    pdbs,
    networkpolicies,
    gatewayApiStatus,
    gatewayClasses,
    gateways,
    httpRoutes,
    grpcRoutes,
    volumes,
    resourceLoading,
    namespacesOptions,
    nodesOptions,
    nsValue,
    nodeValue,
    onNsChange,
    onNodeChange,
    onRefreshWorkloads,
    onRefreshPods,
    onRefreshJobs,
    onRefreshServices,
    onRefreshIngresses,
    onRefreshGateway,
    onRefreshConfigs,
    onRefreshRegistries,
    onRefreshPdbs,
    onRefreshNetpol,
    isTenantUser,
    createDefaultNamespace,
    canAccessContainerResource,
  ]);

  if (containerTabConfig.length === 0) {
    return (
      <div className="cloud-console-panel-root">
        <Empty description="当前账号无容器服务页面读权限" />
      </div>
    );
  }

  return (
    <ContainerOperationsGate operationsReadOnly={operationsReadOnly}>
      <div className="cloud-console-panel-root">
        <ContainerSectionSuspense>{renderContent()}</ContainerSectionSuspense>
      </div>
    </ContainerOperationsGate>
  );
};

export default CloudConsoleContainerPanel;
