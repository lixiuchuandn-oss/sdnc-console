import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Empty } from 'antd';
import { ContainerOperationsGate } from '../../../../Harvester/containers';
import {
  ContainerSectionSuspense,
  LazyWorkloadsSection,
  LazyPodsSection,
  LazyJobsSection,
  LazyServicesSection,
  LazyIngressesSection,
  LazyGatewayApiSection,
  LazyServiceTopologySection,
  LazyPDBSection,
  LazyNetworkPoliciesSection,
  LazyConfigsSection,
  LazyRegistriesSection,
} from '../../../../Harvester/containers/lazySections';
import {
  canReadContainerTab,
  canWriteContainerTab,
} from '../../../../../../../utils/permissionUtils';
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
  loadTabResource: (key: string, force?: boolean, skipSync?: boolean) => Promise<void>;
  loadResource: (
    key: string,
    fn: () => Promise<any>,
    cb: (json: any) => void,
    force?: boolean,
  ) => Promise<void>;
  resourceLoading: Record<string, boolean>;
  namespacesOptions: string[];
  tenantNamespaces: string[];
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

const CloudmapContainersRoutePanel: React.FC<CloudmapContainersRoutePanelProps> = (props) => {
  const {
    cloudId,
    isTenant,
    checkPerm,
    innerActiveKey,
    loadTabResource,
    loadResource,
    resourceLoading,
    namespacesOptions,
    tenantNamespaces,
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

  const loadWorkloads = async (force = true, all?: boolean) => {
    const queryAll = all !== undefined ? all : workloadsAll;
    await Promise.all([
      loadResource(
        'deployments',
        () => fetchHarvesterDeployments(cloudId, undefined, force, queryAll),
        (json) => {
          setHarvesterDeployments(json?.data?.items || []);
        },
        force,
      ),
      loadResource(
        'statefulsets',
        () => fetchHarvesterStatefulSets(cloudId, undefined, force, queryAll),
        (json) => {
          setHarvesterStatefulSets(json?.data?.items || []);
        },
        force,
      ),
      loadResource(
        'daemonsets',
        () => fetchHarvesterDaemonSets(cloudId, undefined, force, queryAll),
        (json) => {
          setHarvesterDaemonSets(json?.data?.items || []);
        },
        force,
      ),
    ]);
  };

  const loadPods = async (force = true, all?: boolean) => {
    const queryAll = all !== undefined ? all : podsAll;
    await loadResource(
      'pods',
      () => fetchHarvesterPods(cloudId, undefined, force, queryAll),
      (json) => {
        setHarvesterPods(json?.data?.items || []);
      },
      force,
    );
  };

  const loadJobs = async (force = true, all?: boolean) => {
    const queryAll = all !== undefined ? all : jobsAll;
    await Promise.all([
      loadResource(
        'jobs',
        () => fetchHarvesterJobs(cloudId, undefined, force, queryAll),
        (json) => {
          setHarvesterJobs(json?.data?.items || []);
        },
        force,
      ),
      loadResource(
        'cronjobs',
        () => fetchHarvesterCronJobs(cloudId, undefined, force, queryAll),
        (json) => {
          setHarvesterCronJobs(json?.data?.items || []);
        },
        force,
      ),
    ]);
  };

  const loadServices = async (force = true) => {
    await Promise.all([
      loadResource(
        'services',
        () => fetchHarvesterServices(cloudId, force, false),
        (json) => {
          setHarvesterServices(json?.data?.items || []);
        },
        force,
      ),
      loadResource(
        'pods',
        () => fetchHarvesterPods(cloudId, undefined, force, podsAll),
        (json) => {
          setHarvesterPods(json?.data?.items || []);
        },
        force,
      ),
    ]);
  };

  const loadIngresses = async (force = true, all?: boolean) => {
    const queryAll = all !== undefined ? all : ingressesAll;
    await loadResource(
      'ingresses',
      () => fetchHarvesterIngresses(cloudId, force, queryAll),
      (json) => {
        setHarvesterIngresses(json?.data?.items || []);
      },
      force,
    );
  };

  const loadPdbs = async (force = true, all?: boolean) => {
    const queryAll = all !== undefined ? all : pdbsAll;
    await loadResource(
      'pdbs',
      () => fetchHarvesterPDBs(cloudId, undefined, force, queryAll),
      (json) => {
        setHarvesterPDBs(json?.data?.items || []);
      },
      force,
    );
  };

  const loadNetworkPolicies = async (force = true, all?: boolean) => {
    const queryAll = all !== undefined ? all : networkPoliciesAll;
    await loadResource(
      'networkpolicies',
      () => fetchNetworkPolicies(cloudId, undefined, force, queryAll),
      (json) => {
        setHarvesterNetworkPolicies(json?.data?.items || []);
      },
      force,
    );
  };

  const loadConfigs = async (force = true, all?: boolean) => {
    const queryAll = all !== undefined ? all : configsAll;
    await Promise.all([
      loadResource(
        'configmaps',
        () => fetchHarvesterConfigMaps(cloudId, undefined, force, queryAll),
        (json) => {
          setHarvesterConfigMaps(json?.data?.items || []);
        },
        force,
      ),
      loadResource(
        'secrets',
        () => fetchHarvesterSecrets(cloudId, undefined, undefined, force, queryAll),
        (json) => {
          setHarvesterSecrets(json?.data?.items || []);
        },
        force,
      ),
    ]);
  };

  const operationsReadOnly = useMemo(
    () => !canWriteContainerTab(checkPerm, innerActiveKey),
    [checkPerm, innerActiveKey],
  );

  const filterByTenantNs = useCallback(
    (items: any[]) => {
      if (!isTenant || !tenantNamespaces.length) return items;
      return items.filter((item: any) => tenantNamespaces.includes(item?.metadata?.namespace));
    },
    [isTenant, tenantNamespaces],
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
    return <Empty description="无权限访问" style={{ marginTop: 48 }} />;
  }

  let content: React.ReactNode;

  if (innerActiveKey === 'workloads') {
    content = (
      <LazyWorkloadsSection
        deployments={filterByTenantNs(harvesterDeployments)}
        statefulsets={filterByTenantNs(harvesterStatefulSets)}
        daemonsets={filterByTenantNs(harvesterDaemonSets)}
        loading={
          resourceLoading.deployments || resourceLoading.statefulsets || resourceLoading.daemonsets
        }
        namespacesOptions={namespacesOptions}
        imagePullSecrets={filterByTenantNs(harvesterImagePullSecrets)}
        secretsWithCredentials={filterByTenantNs(harvesterSecrets)}
        configMaps={filterByTenantNs(harvesterConfigMaps)}
        secrets={filterByTenantNs(harvesterSecrets)}
        persistentVolumeClaims={filterByTenantNs(harvesterVolumes)}
        cloudId={cloudId}
        nsValue={nsFilter || undefined}
        onNsChange={(v) => setNsFilter(v || '')}
        onRefresh={(force) => loadWorkloads(force !== false)}
        showAllSwitch
        queryAll={workloadsAll}
        onQueryAllChange={(checked) => {
          setWorkloadsAll(checked);
          loadWorkloads(true, checked);
        }}
        onRefreshConfigMaps={() => loadConfigs(true)}
        onRefreshSecrets={() => loadConfigs(true)}
      />
    );
  } else if (innerActiveKey === 'pods') {
    content = (
      <LazyPodsSection
        pods={filterByTenantNs(harvesterPods)}
        loading={resourceLoading.pods}
        namespacesOptions={namespacesOptions}
        nodesOptions={nodesOptions}
        cloudId={cloudId}
        nsValue={nsFilter || undefined}
        nodeValue={nodeFilter || undefined}
        onNsChange={(v) => setNsFilter(v || '')}
        onNodeChange={(v) => setNodeFilter(v || '')}
        onRefresh={(force) => loadPods(force !== false)}
        deployments={filterByTenantNs(harvesterDeployments)}
        statefulSets={filterByTenantNs(harvesterStatefulSets)}
        daemonSets={filterByTenantNs(harvesterDaemonSets)}
        showAllSwitch
        queryAll={podsAll}
        onQueryAllChange={(checked) => {
          setPodsAll(checked);
          loadPods(true, checked);
        }}
      />
    );
  } else if (innerActiveKey === 'jobs') {
    content = (
      <LazyJobsSection
        jobs={filterByTenantNs(harvesterJobs)}
        cronjobs={filterByTenantNs(harvesterCronJobs)}
        loading={resourceLoading.jobs || resourceLoading.cronjobs}
        namespacesOptions={namespacesOptions}
        cloudId={cloudId}
        nsValue={nsFilter || undefined}
        onNsChange={(v) => setNsFilter(v || '')}
        onRefresh={(force) => loadJobs(force !== false)}
        imagePullSecrets={filterByTenantNs(harvesterImagePullSecrets)}
        secretsWithCredentials={filterByTenantNs(harvesterSecrets)}
        showAllSwitch
        queryAll={jobsAll}
        onQueryAllChange={(checked) => {
          setJobsAll(checked);
          loadJobs(true, checked);
        }}
      />
    );
  } else if (innerActiveKey === 'services') {
    content = (
      <LazyServicesSection
        cloudId={cloudId}
        services={filterByTenantNs(harvesterServices)}
        loading={resourceLoading.services}
        onRefresh={(force) => loadServices(force !== false)}
        isTenant={isTenant}
        namespacesOptions={namespacesOptions}
        nsValue={nsFilter || undefined}
        onNsChange={(v) => setNsFilter(v || '')}
        pods={filterByTenantNs(harvesterPods)}
      />
    );
  } else if (innerActiveKey === 'ingresses') {
    content = (
      <LazyIngressesSection
        cloudId={cloudId}
        ingresses={filterByTenantNs(harvesterIngresses)}
        loading={resourceLoading.ingresses}
        onRefresh={(force) => loadIngresses(force !== false)}
        namespacesOptions={namespacesOptions}
        nsValue={nsFilter || undefined}
        onNsChange={(v) => setNsFilter(v || '')}
        secrets={filterByTenantNs(harvesterSecrets)}
        services={filterByTenantNs(harvesterServices)}
        showAllSwitch
        queryAll={ingressesAll}
        onQueryAllChange={(checked) => {
          setIngressesAll(checked);
          loadIngresses(true, checked);
        }}
      />
    );
  } else if (innerActiveKey === 'gateway_api') {
    content = (
      <LazyGatewayApiSection
        cloudId={cloudId}
        gatewayApiStatus={gatewayApiStatus}
        gatewayClasses={gatewayClasses}
        gateways={filterByTenantNs(gateways)}
        httpRoutes={filterByTenantNs(httpRoutes)}
        grpcRoutes={filterByTenantNs(grpcRoutes)}
        loading={resourceLoading.gatewayApiStatus || resourceLoading.gateways}
        namespacesOptions={namespacesOptions}
        nsValue={nsFilter || undefined}
        onNsChange={(v) => setNsFilter(v || '')}
        services={filterByTenantNs(harvesterServices)}
        onRefresh={async (force) => loadTabResource('gateway_api', force !== false)}
      />
    );
  } else if (innerActiveKey === 'service_topology') {
    content = (
      <LazyServiceTopologySection
        cloudId={cloudId}
        ingresses={filterByTenantNs(harvesterIngresses)}
        services={filterByTenantNs(harvesterServices)}
        pods={filterByTenantNs(harvesterPods)}
        namespacesOptions={namespacesOptions}
        loading={resourceLoading.ingresses || resourceLoading.services || resourceLoading.pods}
        onRefresh={async (force) => {
          const shouldForce = force !== false;
          await Promise.all([
            loadTabResource('ingresses', shouldForce),
            loadTabResource('services', shouldForce),
            loadTabResource('pods', shouldForce),
          ]);
        }}
        nsValue={nsFilter || undefined}
        onNsChange={(v) => setNsFilter(v || '')}
      />
    );
  } else if (innerActiveKey === 'pdbs') {
    content = (
      <LazyPDBSection
        pdbs={filterByTenantNs(harvesterPDBs)}
        loading={resourceLoading.pdbs}
        namespacesOptions={namespacesOptions}
        cloudId={cloudId}
        nsValue={nsFilter || undefined}
        onNsChange={(v) => setNsFilter(v || '')}
        onRefresh={(force) => loadPdbs(force !== false)}
        showAllSwitch
        queryAll={pdbsAll}
        onQueryAllChange={(checked) => {
          setPdbsAll(checked);
          loadPdbs(true, checked);
        }}
      />
    );
  } else if (innerActiveKey === 'networkpolicies') {
    content = (
      <LazyNetworkPoliciesSection
        networkPolicies={filterByTenantNs(harvesterNetworkPolicies)}
        loading={resourceLoading.networkpolicies}
        namespacesOptions={namespacesOptions}
        cloudId={cloudId}
        nsValue={nsFilter || undefined}
        onNsChange={(v) => setNsFilter(v || '')}
        onRefresh={(force) => loadNetworkPolicies(force !== false)}
        showAllSwitch
        queryAll={networkPoliciesAll}
        onQueryAllChange={(checked) => {
          setNetworkPoliciesAll(checked);
          loadNetworkPolicies(true, checked);
        }}
      />
    );
  } else if (innerActiveKey === 'configs') {
    content = (
      <LazyConfigsSection
        configmaps={filterByTenantNs(harvesterConfigMaps)}
        secrets={filterByTenantNs(harvesterSecrets)}
        loading={resourceLoading.configmaps || resourceLoading.secrets}
        namespacesOptions={namespacesOptions}
        cloudId={cloudId}
        nsValue={nsFilter || undefined}
        onNsChange={(v) => setNsFilter(v || '')}
        onRefresh={(force) => loadConfigs(force !== false)}
        deployments={filterByTenantNs(harvesterDeployments)}
        statefulsets={filterByTenantNs(harvesterStatefulSets)}
        daemonsets={filterByTenantNs(harvesterDaemonSets)}
        showAllSwitch
        queryAll={configsAll}
        onQueryAllChange={(checked) => {
          setConfigsAll(checked);
          loadConfigs(true, checked);
        }}
      />
    );
  } else if (innerActiveKey === 'registries') {
    content = (
      <LazyRegistriesSection
        namespacesOptions={namespacesOptions}
        cloudId={cloudId}
        onRefresh={async (force) => loadTabResource('registries', force !== false)}
      />
    );
  } else {
    content = <Empty description="未知页面" style={{ marginTop: 48 }} />;
  }

  return (
    <ContainerOperationsGate operationsReadOnly={operationsReadOnly}>
      <ContainerSectionSuspense>{content}</ContainerSectionSuspense>
    </ContainerOperationsGate>
  );
};

export default CloudmapContainersRoutePanel;
