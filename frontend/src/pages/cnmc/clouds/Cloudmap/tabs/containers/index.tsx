import React from 'react';
import { Tabs } from 'antd';
import {
  WorkloadsSection,
  PodsSection,
  JobsSection,
  ConfigsSection,
  RegistriesSection,
  GatewayApiSection,
  PDBSection,
  NetworkPoliciesSection,
  ServiceTopologySection,
  IngressesSection,
} from '../../../Harvester/containers';
import ServicesSection from '../../../Harvester/cluster/sections/ServicesSection';

export type CloudmapContainersTabsProps = {
  cloudId: string;
  mode: 'standard' | 'ops';
  isTenant: boolean;
  checkPerm: (act: string) => boolean;
  handleTabChange: (key: string) => void;
  loadTabResource: (
    key: string,
    force?: boolean,
    skipSync?: boolean,
  ) => Promise<void>;
  resourceLoading: Record<string, boolean>;
  namespacesOptions: string[];
  nodesOptions: string[];
  nsFilter: string;
  setNsFilter: (v: string) => void;
  nodeFilter: string;
  setNodeFilter: (v: string) => void;
  harvesterDeployments: any[];
  harvesterStatefulSets: any[];
  harvesterDaemonSets: any[];
  harvesterPods: any[];
  harvesterJobs: any[];
  harvesterCronJobs: any[];
  harvesterServices: any[];
  harvesterIngresses: any[];
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
  harvesterPDBs: any[];
  harvesterNetworkPolicies: any[];
  harvesterConfigMaps: any[];
  harvesterSecrets: any[];
  harvesterImagePullSecrets: any[];
  harvesterVolumes: any[];
};

/** Cloudmap 详情 — 容器分组内层 Tabs */
const CloudmapContainersTabs: React.FC<CloudmapContainersTabsProps> = (
  props,
) => {
  const {
    cloudId,
    mode,
    isTenant,
    checkPerm,
    handleTabChange,
    loadTabResource,
    resourceLoading,
    namespacesOptions,
    nodesOptions,
    nsFilter,
    setNsFilter,
    nodeFilter,
    setNodeFilter,
    harvesterDeployments,
    harvesterStatefulSets,
    harvesterDaemonSets,
    harvesterPods,
    harvesterJobs,
    harvesterCronJobs,
    harvesterServices,
    harvesterIngresses,
    gatewayApiStatus,
    gatewayClasses,
    gateways,
    httpRoutes,
    grpcRoutes,
    harvesterPDBs,
    harvesterNetworkPolicies,
    harvesterConfigMaps,
    harvesterSecrets,
    harvesterImagePullSecrets,
    harvesterVolumes,
  } = props;

  return (
    <Tabs
      type="line"
      destroyOnHidden
      defaultActiveKey="workloads"
      onChange={handleTabChange}
      items={[
        {
          key: 'workloads',
          label: '工作负载',
          children: (
            <WorkloadsSection
              deployments={harvesterDeployments}
              statefulsets={harvesterStatefulSets}
              daemonsets={harvesterDaemonSets}
              loading={
                resourceLoading.deployments ||
                resourceLoading.statefulsets ||
                resourceLoading.daemonsets
              }
              namespacesOptions={namespacesOptions}
              imagePullSecrets={harvesterImagePullSecrets}
              secretsWithCredentials={harvesterSecrets}
              configMaps={harvesterConfigMaps}
              secrets={harvesterSecrets}
              persistentVolumeClaims={harvesterVolumes}
              cloudId={cloudId}
              nsValue={nsFilter || undefined}
              onNsChange={(v) => setNsFilter(v || '')}
              onRefresh={() => {
                loadTabResource('workloads', true);
                loadTabResource('pods', true);
              }}
            />
          ),
        },
        {
          key: 'pods',
          label: '容器实例',
          children: (
            <PodsSection
              pods={harvesterPods}
              loading={resourceLoading.pods}
              namespacesOptions={namespacesOptions}
              nodesOptions={nodesOptions}
              cloudId={cloudId}
              nsValue={nsFilter || undefined}
              nodeValue={nodeFilter || undefined}
              onNsChange={(v) => setNsFilter(v || '')}
              onNodeChange={(v) => setNodeFilter(v || '')}
              onRefresh={() => loadTabResource('pods', true)}
              deployments={harvesterDeployments}
              statefulSets={harvesterStatefulSets}
              daemonSets={harvesterDaemonSets}
            />
          ),
        },
        {
          key: 'jobs',
          label: '任务',
          children: (
            <JobsSection
              jobs={harvesterJobs}
              cronjobs={harvesterCronJobs}
              loading={
                resourceLoading.jobs || resourceLoading.cronjobs
              }
              namespacesOptions={namespacesOptions}
              cloudId={cloudId}
              nsValue={nsFilter || undefined}
              onNsChange={(v) => setNsFilter(v || '')}
              onRefresh={(force) =>
                loadTabResource('jobs', force ?? true)
              }
              imagePullSecrets={harvesterImagePullSecrets}
              secretsWithCredentials={harvesterSecrets}
            />
          ),
        },
        {
          key: 'services',
          label: '服务',
          children: (
            <ServicesSection
              cloudId={cloudId}
              services={harvesterServices}
              loading={resourceLoading.services}
              onRefresh={() => loadTabResource('services', true)}
              isTenant={isTenant}
              namespacesOptions={namespacesOptions}
              nsValue={nsFilter || undefined}
              onNsChange={(v) => setNsFilter(v || '')}
              pods={harvesterPods}
              mode={mode}
            />
          ),
        },
        {
          key: 'ingresses',
          label: 'Ingress 路由',
          children: (
            <IngressesSection
              cloudId={cloudId}
              ingresses={harvesterIngresses}
              loading={resourceLoading.ingresses}
              onRefresh={() => loadTabResource('ingresses', true)}
              namespacesOptions={namespacesOptions}
              nsValue={nsFilter || undefined}
              onNsChange={(v) => setNsFilter(v || '')}
              secrets={harvesterSecrets}
            />
          ),
        },
        {
          key: 'gateway_api',
          label: '网关路由',
          children: (
            <GatewayApiSection
              cloudId={cloudId}
              gatewayApiStatus={gatewayApiStatus}
              gatewayClasses={gatewayClasses}
              gateways={gateways}
              httpRoutes={httpRoutes}
              grpcRoutes={grpcRoutes}
              loading={
                resourceLoading.gatewayApiStatus ||
                resourceLoading.gateways
              }
              namespacesOptions={namespacesOptions}
              nsValue={nsFilter || undefined}
              onNsChange={(v) => setNsFilter(v || '')}
              services={harvesterServices}
              onRefresh={() => loadTabResource('gateway_api', true)}
            />
          ),
        },
        {
          key: 'service_topology',
          label: '服务拓扑',
          children: (
            <ServiceTopologySection
              cloudId={cloudId}
              ingresses={harvesterIngresses}
              services={harvesterServices}
              pods={harvesterPods}
              namespacesOptions={namespacesOptions}
              loading={
                resourceLoading.ingresses ||
                resourceLoading.services ||
                resourceLoading.pods
              }
              onRefresh={() => {
                loadTabResource('ingresses', true);
                loadTabResource('services', true);
                loadTabResource('pods', true);
              }}
              nsValue={nsFilter || undefined}
              onNsChange={(v) => setNsFilter(v || '')}
            />
          ),
        },
        {
          key: 'pdbs',
          label: 'Pod中断保护',
          children: (
            <PDBSection
              pdbs={harvesterPDBs}
              loading={resourceLoading.pdbs}
              namespacesOptions={namespacesOptions}
              cloudId={cloudId}
              nsValue={nsFilter || undefined}
              onNsChange={(v) => setNsFilter(v || '')}
              onRefresh={(force) =>
                loadTabResource('containers', force ?? true)
              }
            />
          ),
        },
        {
          key: 'networkpolicies',
          label: '网络策略',
          children: (
            <NetworkPoliciesSection
              networkPolicies={harvesterNetworkPolicies}
              loading={resourceLoading.networkpolicies}
              namespacesOptions={namespacesOptions}
              cloudId={cloudId}
              nsValue={nsFilter || undefined}
              onNsChange={(v) => setNsFilter(v || '')}
              onRefresh={(force) =>
                loadTabResource('containers', force ?? true)
              }
            />
          ),
        },
        {
          key: 'configs',
          label: '配置管理',
          children: (
            <ConfigsSection
              configmaps={harvesterConfigMaps}
              secrets={harvesterSecrets}
              loading={
                resourceLoading.configmaps || resourceLoading.secrets
              }
              namespacesOptions={namespacesOptions}
              cloudId={cloudId}
              nsValue={nsFilter || undefined}
              onNsChange={(v) => setNsFilter(v || '')}
              onRefresh={(force) => loadTabResource('configs', force)}
            />
          ),
        },
        {
          key: 'registries',
          label: '镜像仓库',
          children: (
            <RegistriesSection
              secrets={harvesterImagePullSecrets}
              secretsWithCredentials={harvesterSecrets}
              loading={resourceLoading.imagePullSecrets}
              namespacesOptions={namespacesOptions}
              cloudId={cloudId}
              nsValue={nsFilter || undefined}
              onNsChange={(v) => setNsFilter(v || '')}
              onRefresh={() => loadTabResource('registries', true)}
            />
          ),
        },
      ].filter((i: any) => {
        if (i.key === 'services')
          return (
            checkPerm('clouds.services:read') ||
            checkPerm('clouds:read')
          );
        if (i.key === 'ingresses')
          return (
            checkPerm('clouds.ingresses:read') ||
            checkPerm('clouds:read')
          );
        if (i.key === 'gateway_api')
          return (
            checkPerm('clouds.containers:read') ||
            checkPerm('clouds:read')
          );
        if (i.key === 'pdbs')
          return (
            checkPerm('clouds.containers:read') ||
            checkPerm('clouds:read')
          );
        if (i.key === 'configs')
          return (
            checkPerm('clouds.containers:read') ||
            checkPerm('clouds:read')
          );
        if (i.key === 'registries')
          return (
            checkPerm('clouds.containers:read') ||
            checkPerm('clouds:read')
          );
        return (
          checkPerm('clouds.containers:read') || checkPerm('clouds:read')
        );
      })}
    />
  );
};

export default CloudmapContainersTabs;
