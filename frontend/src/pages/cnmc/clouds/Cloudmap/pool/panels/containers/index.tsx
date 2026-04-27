import React from 'react';
import { Empty } from 'antd';
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
} from '../../../../Harvester/containers';
import ServicesSection from '../../../../Harvester/cluster/sections/ServicesSection';

export type CloudmapContainersTabsProps = {
  cloudId: string;
  isTenant: boolean;
  checkPerm: (act: string) => boolean;
  innerActiveKey: string;
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

function canViewContainersInner(
  key: string,
  checkPerm: (a: string) => boolean,
): boolean {
  if (key === 'services')
    return (
      checkPerm('clouds.services:read') || checkPerm('clouds:read')
    );
  if (key === 'ingresses')
    return (
      checkPerm('clouds.ingresses:read') || checkPerm('clouds:read')
    );
  if (key === 'gateway_api')
    return (
      checkPerm('clouds.containers:read') || checkPerm('clouds:read')
    );
  if (key === 'pdbs')
    return (
      checkPerm('clouds.containers:read') || checkPerm('clouds:read')
    );
  if (key === 'configs')
    return (
      checkPerm('clouds.containers:read') || checkPerm('clouds:read')
    );
  if (key === 'registries')
    return (
      checkPerm('clouds.containers:read') || checkPerm('clouds:read')
    );
  return checkPerm('clouds.containers:read') || checkPerm('clouds:read');
}

const CloudmapContainersTabs: React.FC<CloudmapContainersTabsProps> = (
  props,
) => {
  const {
    cloudId,
    isTenant,
    checkPerm,
    innerActiveKey,
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

  if (!canViewContainersInner(innerActiveKey, checkPerm)) {
    return (
      <div style={{ height: '100%', overflow: 'auto' }}>
        <Empty description="无权限访问" style={{ marginTop: 48 }} />
      </div>
    );
  }

  let content: React.ReactNode;

  if (innerActiveKey === 'workloads') {
    content = (
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
    );
  } else if (innerActiveKey === 'pods') {
    content = (
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
    );
  } else if (innerActiveKey === 'jobs') {
    content = (
      <JobsSection
        jobs={harvesterJobs}
        cronjobs={harvesterCronJobs}
        loading={resourceLoading.jobs || resourceLoading.cronjobs}
        namespacesOptions={namespacesOptions}
        cloudId={cloudId}
        nsValue={nsFilter || undefined}
        onNsChange={(v) => setNsFilter(v || '')}
        onRefresh={(force) => loadTabResource('jobs', force ?? true)}
        imagePullSecrets={harvesterImagePullSecrets}
        secretsWithCredentials={harvesterSecrets}
      />
    );
  } else if (innerActiveKey === 'services') {
    content = (
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
      />
    );
  } else if (innerActiveKey === 'ingresses') {
    content = (
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
    );
  } else if (innerActiveKey === 'gateway_api') {
    content = (
      <GatewayApiSection
        cloudId={cloudId}
        gatewayApiStatus={gatewayApiStatus}
        gatewayClasses={gatewayClasses}
        gateways={gateways}
        httpRoutes={httpRoutes}
        grpcRoutes={grpcRoutes}
        loading={
          resourceLoading.gatewayApiStatus || resourceLoading.gateways
        }
        namespacesOptions={namespacesOptions}
        nsValue={nsFilter || undefined}
        onNsChange={(v) => setNsFilter(v || '')}
        services={harvesterServices}
        onRefresh={() => loadTabResource('gateway_api', true)}
      />
    );
  } else if (innerActiveKey === 'service_topology') {
    content = (
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
    );
  } else if (innerActiveKey === 'pdbs') {
    content = (
      <PDBSection
        pdbs={harvesterPDBs}
        loading={resourceLoading.pdbs}
        namespacesOptions={namespacesOptions}
        cloudId={cloudId}
        nsValue={nsFilter || undefined}
        onNsChange={(v) => setNsFilter(v || '')}
        onRefresh={(force) => loadTabResource('containers', force ?? true)}
      />
    );
  } else if (innerActiveKey === 'networkpolicies') {
    content = (
      <NetworkPoliciesSection
        networkPolicies={harvesterNetworkPolicies}
        loading={resourceLoading.networkpolicies}
        namespacesOptions={namespacesOptions}
        cloudId={cloudId}
        nsValue={nsFilter || undefined}
        onNsChange={(v) => setNsFilter(v || '')}
        onRefresh={(force) => loadTabResource('containers', force ?? true)}
      />
    );
  } else if (innerActiveKey === 'configs') {
    content = (
      <ConfigsSection
        configmaps={harvesterConfigMaps}
        secrets={harvesterSecrets}
        loading={resourceLoading.configmaps || resourceLoading.secrets}
        namespacesOptions={namespacesOptions}
        cloudId={cloudId}
        nsValue={nsFilter || undefined}
        onNsChange={(v) => setNsFilter(v || '')}
        onRefresh={(force) => loadTabResource('configs', force)}
        deployments={harvesterDeployments}
        statefulsets={harvesterStatefulSets}
        daemonsets={harvesterDaemonSets}
      />
    );
  } else if (innerActiveKey === 'registries') {
    content = (
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
    );
  } else {
    content = <Empty description="未知页面" style={{ marginTop: 48 }} />;
  }

  return (
    <div style={{ height: '100%', overflow: 'auto' }}>
      {content}
    </div>
  );
};

export default CloudmapContainersTabs;
