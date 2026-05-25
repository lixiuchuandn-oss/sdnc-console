import React, { useEffect, useMemo, useState } from 'react';
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
  ContainerOperationsGate,
} from '../../../../Harvester/containers';
import { canReadContainerTab, canWriteContainerTab } from '../../../../../../../utils/permissionUtils';
import ServicesSection from '../../../../Harvester/containers/sections/ServicesSection';
import {
  fetchHarvesterDeployments,
  fetchHarvesterStatefulSets,
  fetchHarvesterDaemonSets,
  fetchHarvesterPods,
  fetchHarvesterJobs,
  fetchHarvesterCronJobs,
  fetchHarvesterServices,
  fetchHarvesterIngresses,
  fetchHarvesterPDBs,
  fetchNetworkPolicies,
  fetchHarvesterConfigMaps,
  fetchHarvesterSecrets,
} from '../../../../../../../services/harvesterApi';

export type CloudmapContainersRoutePanelProps = {
  cloudId: string;
  isTenant: boolean;
  checkPerm: (act: string) => boolean;
  innerActiveKey: string;
  loadTabResource: (
    key: string,
    force?: boolean,
    skipSync?: boolean,
  ) => Promise<void>;
  loadResource: (
    key: string,
    fn: () => Promise<any>,
    cb: (json: any) => void,
    force?: boolean,
  ) => Promise<void>;
  resourceLoading: Record<string, boolean>;
  namespacesOptions: string[];
  nodesOptions: string[];
  nsFilter: string;
  setNsFilter: (v: string) => void;
  nodeFilter: string;
  setNodeFilter: (v: string) => void;
  harvesterDeployments: any[];
  setHarvesterDeployments: (v: any[]) => void;
  harvesterStatefulSets: any[];
  setHarvesterStatefulSets: (v: any[]) => void;
  harvesterDaemonSets: any[];
  setHarvesterDaemonSets: (v: any[]) => void;
  harvesterPods: any[];
  setHarvesterPods: (v: any[]) => void;
  harvesterJobs: any[];
  setHarvesterJobs: (v: any[]) => void;
  harvesterCronJobs: any[];
  setHarvesterCronJobs: (v: any[]) => void;
  harvesterServices: any[];
  setHarvesterServices: (v: any[]) => void;
  harvesterIngresses: any[];
  setHarvesterIngresses: (v: any[]) => void;
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
  setHarvesterPDBs: (v: any[]) => void;
  harvesterNetworkPolicies: any[];
  setHarvesterNetworkPolicies: (v: any[]) => void;
  harvesterConfigMaps: any[];
  setHarvesterConfigMaps: (v: any[]) => void;
  harvesterSecrets: any[];
  setHarvesterSecrets: (v: any[]) => void;
  harvesterImagePullSecrets: any[];
  setHarvesterImagePullSecrets: (v: any[]) => void;
  harvesterVolumes: any[];
};

const CloudmapContainersRoutePanel: React.FC<CloudmapContainersRoutePanelProps> = (
  props,
) => {
  const {
    cloudId,
    isTenant,
    checkPerm,
    innerActiveKey,
    loadTabResource,
    loadResource,
    resourceLoading,
    namespacesOptions,
    nodesOptions,
    nsFilter,
    setNsFilter,
    nodeFilter,
    setNodeFilter,
    harvesterDeployments,
    setHarvesterDeployments,
    harvesterStatefulSets,
    setHarvesterStatefulSets,
    harvesterDaemonSets,
    setHarvesterDaemonSets,
    harvesterPods,
    setHarvesterPods,
    harvesterJobs,
    setHarvesterJobs,
    harvesterCronJobs,
    setHarvesterCronJobs,
    harvesterServices,
    setHarvesterServices,
    harvesterIngresses,
    setHarvesterIngresses,
    gatewayApiStatus,
    gatewayClasses,
    gateways,
    httpRoutes,
    grpcRoutes,
    harvesterPDBs,
    setHarvesterPDBs,
    harvesterNetworkPolicies,
    setHarvesterNetworkPolicies,
    harvesterConfigMaps,
    setHarvesterConfigMaps,
    harvesterSecrets,
    setHarvesterSecrets,
    harvesterImagePullSecrets,
    harvesterVolumes,
  } = props;

  const [workloadsAll, setWorkloadsAll] = useState(false);
  const [podsAll, setPodsAll] = useState(false);
  const [jobsAll, setJobsAll] = useState(false);
  const [ingressesAll, setIngressesAll] = useState(false);
  const [pdbsAll, setPdbsAll] = useState(false);
  const [networkPoliciesAll, setNetworkPoliciesAll] = useState(false);
  const [configsAll, setConfigsAll] = useState(false);

  const loadWorkloads = (force = true, all?: boolean) => {
    const queryAll = all !== undefined ? all : workloadsAll;
    loadResource('deployments', () => fetchHarvesterDeployments(cloudId, undefined, force, queryAll), (json) => { setHarvesterDeployments(json?.data?.items || []); }, force);
    loadResource('statefulsets', () => fetchHarvesterStatefulSets(cloudId, undefined, force, queryAll), (json) => { setHarvesterStatefulSets(json?.data?.items || []); }, force);
    loadResource('daemonsets', () => fetchHarvesterDaemonSets(cloudId, undefined, force, queryAll), (json) => { setHarvesterDaemonSets(json?.data?.items || []); }, force);
  };

  const loadPods = (force = true, all?: boolean) => {
    const queryAll = all !== undefined ? all : podsAll;
    loadResource('pods', () => fetchHarvesterPods(cloudId, undefined, force, queryAll), (json) => { setHarvesterPods(json?.data?.items || []); }, force);
  };

  const loadJobs = (force = true, all?: boolean) => {
    const queryAll = all !== undefined ? all : jobsAll;
    loadResource('jobs', () => fetchHarvesterJobs(cloudId, undefined, force, queryAll), (json) => { setHarvesterJobs(json?.data?.items || []); }, force);
    loadResource('cronjobs', () => fetchHarvesterCronJobs(cloudId, undefined, force, queryAll), (json) => { setHarvesterCronJobs(json?.data?.items || []); }, force);
  };

  const loadServices = (force = true) => {
    loadResource('services', () => fetchHarvesterServices(cloudId, force, false), (json) => { setHarvesterServices(json?.data?.items || []); }, force);
  };

  const loadIngresses = (force = true, all?: boolean) => {
    const queryAll = all !== undefined ? all : ingressesAll;
    loadResource('ingresses', () => fetchHarvesterIngresses(cloudId, force, queryAll), (json) => { setHarvesterIngresses(json?.data?.items || []); }, force);
  };

  const loadPdbs = (force = true, all?: boolean) => {
    const queryAll = all !== undefined ? all : pdbsAll;
    loadResource('pdbs', () => fetchHarvesterPDBs(cloudId, undefined, force, queryAll), (json) => { setHarvesterPDBs(json?.data?.items || []); }, force);
  };

  const loadNetworkPolicies = (force = true, all?: boolean) => {
    const queryAll = all !== undefined ? all : networkPoliciesAll;
    loadResource('networkpolicies', () => fetchNetworkPolicies(cloudId, undefined, force, queryAll), (json) => { setHarvesterNetworkPolicies(json?.data?.items || []); }, force);
  };

  const loadConfigs = (force = true, all?: boolean) => {
    const queryAll = all !== undefined ? all : configsAll;
    loadResource('configmaps', () => fetchHarvesterConfigMaps(cloudId, undefined, force, queryAll), (json) => { setHarvesterConfigMaps(json?.data?.items || []); }, force);
    loadResource('secrets', () => fetchHarvesterSecrets(cloudId, undefined, undefined, force, queryAll), (json) => { setHarvesterSecrets(json?.data?.items || []); }, force);
  };

  const operationsReadOnly = useMemo(
    () => !canWriteContainerTab(checkPerm, innerActiveKey),
    [checkPerm, innerActiveKey],
  );

  useEffect(() => {
    setWorkloadsAll(false);
    setPodsAll(false);
    setJobsAll(false);
    setIngressesAll(false);
    setPdbsAll(false);
    setNetworkPoliciesAll(false);
    setConfigsAll(false);
  }, [innerActiveKey]);

  if (!canReadContainerTab(checkPerm, innerActiveKey)) {
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
        onRefresh={() => loadWorkloads()}
        showAllSwitch
        queryAll={workloadsAll}
        onQueryAllChange={(checked) => { setWorkloadsAll(checked); loadWorkloads(true, checked); }}
        onRefreshConfigMaps={() => loadConfigs()}
        onRefreshSecrets={() => loadConfigs()}
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
        onRefresh={() => loadPods()}
        deployments={harvesterDeployments}
        statefulSets={harvesterStatefulSets}
        daemonSets={harvesterDaemonSets}
        showAllSwitch
        queryAll={podsAll}
        onQueryAllChange={(checked) => { setPodsAll(checked); loadPods(true, checked); }}
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
        onRefresh={() => loadJobs()}
        imagePullSecrets={harvesterImagePullSecrets}
        secretsWithCredentials={harvesterSecrets}
        showAllSwitch
        queryAll={jobsAll}
        onQueryAllChange={(checked) => { setJobsAll(checked); loadJobs(true, checked); }}
      />
    );
  } else if (innerActiveKey === 'services') {
    content = (
      <ServicesSection
        cloudId={cloudId}
        services={harvesterServices}
        loading={resourceLoading.services}
        onRefresh={() => loadServices()}
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
        onRefresh={() => loadIngresses()}
        namespacesOptions={namespacesOptions}
        nsValue={nsFilter || undefined}
        onNsChange={(v) => setNsFilter(v || '')}
        secrets={harvesterSecrets}
        showAllSwitch
        queryAll={ingressesAll}
        onQueryAllChange={(checked) => { setIngressesAll(checked); loadIngresses(true, checked); }}
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
        onRefresh={() => loadPdbs()}
        showAllSwitch
        queryAll={pdbsAll}
        onQueryAllChange={(checked) => { setPdbsAll(checked); loadPdbs(true, checked); }}
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
        onRefresh={() => loadNetworkPolicies()}
        showAllSwitch
        queryAll={networkPoliciesAll}
        onQueryAllChange={(checked) => { setNetworkPoliciesAll(checked); loadNetworkPolicies(true, checked); }}
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
        onRefresh={() => loadConfigs()}
        deployments={harvesterDeployments}
        statefulsets={harvesterStatefulSets}
        daemonsets={harvesterDaemonSets}
        showAllSwitch
        queryAll={configsAll}
        onQueryAllChange={(checked) => { setConfigsAll(checked); loadConfigs(true, checked); }}
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
    <ContainerOperationsGate operationsReadOnly={operationsReadOnly}>
      <div style={{ height: '100%', overflow: 'auto' }}>{content}</div>
    </ContainerOperationsGate>
  );
};

export default CloudmapContainersRoutePanel;
