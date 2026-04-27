import {
  fetchHarvesterDeployments,
  fetchHarvesterStatefulSets,
  fetchHarvesterDaemonSets,
  fetchHarvesterPods,
  fetchHarvesterJobs,
  fetchHarvesterCronJobs,
  fetchHarvesterServices,
  fetchHarvesterIngresses,
  fetchHarvesterConfigMaps,
  fetchHarvesterSecrets,
  fetchHarvesterImagePullSecrets,
  fetchHarvesterPDBs,
  fetchNetworkPolicies,
  checkGatewayApiStatus,
  fetchGatewayClasses,
  fetchGateways,
  fetchHttpRoutes,
  fetchGrpcRoutes,
} from '../../api';
import type { PoolPathResourceDeps } from '../poolDataDeps';
import {
  canReadContainerTab,
  canViewAnyContainerSubPage,
} from '../../../../../../../utils/permissionUtils';

/** 容器域（`panels/containers`）：工作负载、服务发现、Gateway API、拓扑等 */
export async function tryLoadContainerTab(
  key: string,
  force: boolean,
  _skipSync: boolean,
  deps: PoolPathResourceDeps,
): Promise<boolean> {
  const {
    cloudId,
    checkPerm,
    loadResource,
    loadedRef,
    harvesterSecrets,
    setHarvesterDeployments,
    setHarvesterStatefulSets,
    setHarvesterDaemonSets,
    setHarvesterPods,
    setHarvesterJobs,
    setHarvesterCronJobs,
    setHarvesterServices,
    setRawServices,
    setHarvesterIngresses,
    setRawIngresses,
    setHarvesterConfigMaps,
    setHarvesterSecrets,
    setHarvesterImagePullSecrets,
    setHarvesterPDBs,
    setHarvesterNetworkPolicies,
    setGatewayApiStatus,
    setGatewayClasses,
    setGateways,
    setHttpRoutes,
    setGrpcRoutes,
  } = deps;

  switch (key) {
    case 'containers':
      if (canViewAnyContainerSubPage(checkPerm)) {
        loadResource(
          'deployments',
          () => fetchHarvesterDeployments(cloudId, undefined, force),
          (json) => {
            const list: any[] = (json as any)?.data?.items || [];
            setHarvesterDeployments(Array.isArray(list) ? list : []);
          },
          force,
        );
        loadResource(
          'statefulsets',
          () => fetchHarvesterStatefulSets(cloudId, undefined, force),
          (json) => {
            const list: any[] = (json as any)?.data?.items || [];
            setHarvesterStatefulSets(Array.isArray(list) ? list : []);
          },
          force,
        );
        loadResource(
          'daemonsets',
          () => fetchHarvesterDaemonSets(cloudId, undefined, force),
          (json) => {
            const list: any[] = (json as any)?.data?.items || [];
            setHarvesterDaemonSets(Array.isArray(list) ? list : []);
          },
          force,
        );
        loadResource(
          'pods',
          () => fetchHarvesterPods(cloudId, undefined, force),
          (json) => {
            const list: any[] = (json as any)?.data?.items || [];
            setHarvesterPods(Array.isArray(list) ? list : []);
          },
          force,
        );
        loadResource(
          'jobs',
          () => fetchHarvesterJobs(cloudId, undefined, force),
          (json) => {
            const list: any[] = (json as any)?.data?.items || [];
            setHarvesterJobs(Array.isArray(list) ? list : []);
          },
          force,
        );
        loadResource(
          'cronjobs',
          () => fetchHarvesterCronJobs(cloudId, undefined, force),
          (json) => {
            const list: any[] = (json as any)?.data?.items || [];
            setHarvesterCronJobs(Array.isArray(list) ? list : []);
          },
          force,
        );
        loadResource(
          'services',
          () => fetchHarvesterServices(cloudId, force),
          (json) => {
            const list: any[] = Array.isArray((json as any)?.data?.items)
              ? (json as any).data.items
              : [];
            setHarvesterServices(Array.isArray(list) ? list : []);
            setRawServices(json || null);
          },
          force,
        );
        loadResource(
          'ingresses',
          () => fetchHarvesterIngresses(cloudId, force),
          (json) => {
            const list: any[] = Array.isArray((json as any)?.data?.items)
              ? (json as any).data.items
              : [];
            setHarvesterIngresses(Array.isArray(list) ? list : []);
            setRawIngresses(json || null);
          },
          force,
        );
        loadResource(
          'configmaps',
          () => fetchHarvesterConfigMaps(cloudId, undefined, force),
          (json) => {
            const list: any[] = (json as any)?.data?.items || [];
            setHarvesterConfigMaps(Array.isArray(list) ? list : []);
          },
          force,
        );
        loadResource(
          'secrets',
          () =>
            fetchHarvesterSecrets(cloudId, undefined, undefined, force),
          (json) => {
            const list: any[] = (json as any)?.data?.items || [];
            setHarvesterSecrets(Array.isArray(list) ? list : []);
          },
          force,
        );
        loadResource(
          'imagePullSecrets',
          () => fetchHarvesterImagePullSecrets(cloudId, undefined, force),
          (json) => {
            const list: any[] = (json as any)?.data?.items || [];
            setHarvesterImagePullSecrets(Array.isArray(list) ? list : []);
          },
          force,
        );
        loadResource(
          'pdbs',
          () => fetchHarvesterPDBs(cloudId, undefined, force),
          (json) => {
            const list: any[] = (json as any)?.data?.items || [];
            setHarvesterPDBs(Array.isArray(list) ? list : []);
          },
          force,
        );
        loadResource(
          'networkpolicies',
          () => fetchNetworkPolicies(cloudId, undefined, force),
          (json) => {
            const list: any[] = (json as any)?.data?.items || [];
            setHarvesterNetworkPolicies(Array.isArray(list) ? list : []);
          },
          force,
        );
      }
      return true;
    case 'workloads':
      if (canReadContainerTab(checkPerm, 'workloads')) {
        loadResource(
          'deployments',
          () => fetchHarvesterDeployments(cloudId, undefined, force),
          (json) => {
            const list: any[] = (json as any)?.data?.items || [];
            setHarvesterDeployments(Array.isArray(list) ? list : []);
          },
          force,
        );
        loadResource(
          'statefulsets',
          () => fetchHarvesterStatefulSets(cloudId, undefined, force),
          (json) => {
            const list: any[] = (json as any)?.data?.items || [];
            setHarvesterStatefulSets(Array.isArray(list) ? list : []);
          },
          force,
        );
        loadResource(
          'daemonsets',
          () => fetchHarvesterDaemonSets(cloudId, undefined, force),
          (json) => {
            const list: any[] = (json as any)?.data?.items || [];
            setHarvesterDaemonSets(Array.isArray(list) ? list : []);
          },
          force,
        );
        loadResource(
          'imagePullSecrets',
          () => fetchHarvesterImagePullSecrets(cloudId, undefined, force),
          (json) => {
            const list: any[] = (json as any)?.data?.items || [];
            setHarvesterImagePullSecrets(Array.isArray(list) ? list : []);
          },
          force,
        );
        loadResource(
          'secrets',
          () =>
            fetchHarvesterSecrets(cloudId, undefined, undefined, force),
          (json) => {
            const list: any[] = (json as any)?.data?.items || [];
            setHarvesterSecrets(Array.isArray(list) ? list : []);
          },
          force,
        );
      }
      return true;
    case 'pods':
      if (canReadContainerTab(checkPerm, 'pods')) {
        loadResource(
          'pods',
          () => fetchHarvesterPods(cloudId, undefined, force),
          (json) => {
            const list: any[] = (json as any)?.data?.items || [];
            setHarvesterPods(Array.isArray(list) ? list : []);
          },
          force,
        );
      }
      return true;
    case 'jobs':
      if (canReadContainerTab(checkPerm, 'jobs')) {
        loadResource(
          'jobs',
          () => fetchHarvesterJobs(cloudId, undefined, force),
          (json) => {
            const list: any[] = (json as any)?.data?.items || [];
            setHarvesterJobs(Array.isArray(list) ? list : []);
          },
          force,
        );
        loadResource(
          'cronjobs',
          () => fetchHarvesterCronJobs(cloudId, undefined, force),
          (json) => {
            const list: any[] = (json as any)?.data?.items || [];
            setHarvesterCronJobs(Array.isArray(list) ? list : []);
          },
          force,
        );
        if (!loadedRef.current.has('imagePullSecrets')) {
          loadResource(
            'imagePullSecrets',
            () => fetchHarvesterImagePullSecrets(cloudId, undefined, force),
            (json) => {
              const list: any[] = (json as any)?.data?.items || [];
              setHarvesterImagePullSecrets(Array.isArray(list) ? list : []);
            },
            force,
          );
        }
        if (!loadedRef.current.has('secrets')) {
          loadResource(
            'secrets',
            () => fetchHarvesterSecrets(cloudId),
            (json) => {
              const list: any[] = (json as any)?.data?.items || [];
              setHarvesterSecrets(Array.isArray(list) ? list : []);
            },
            force,
          );
        }
      }
      return true;
    case 'configs':
      if (canReadContainerTab(checkPerm, 'configs')) {
        loadResource(
          'configmaps',
          () => fetchHarvesterConfigMaps(cloudId, undefined, force),
          (json) => {
            const list: any[] = (json as any)?.data?.items || [];
            setHarvesterConfigMaps(Array.isArray(list) ? list : []);
          },
          force,
        );
        loadResource(
          'secrets',
          () =>
            fetchHarvesterSecrets(cloudId, undefined, undefined, force),
          (json) => {
            const list: any[] = (json as any)?.data?.items || [];
            setHarvesterSecrets(Array.isArray(list) ? list : []);
          },
          force,
        );
      }
      return true;
    case 'ingresses':
      if (canReadContainerTab(checkPerm, 'ingresses')) {
        loadResource(
          'ingresses',
          () => fetchHarvesterIngresses(cloudId, force),
          (json) => {
            const list: any[] = Array.isArray((json as any)?.data?.items)
              ? (json as any).data.items
              : [];
            setHarvesterIngresses(Array.isArray(list) ? list : []);
            setRawIngresses(json || null);
          },
          force,
        );
      }
      return true;
    case 'services':
      if (
        checkPerm('clouds.cluster-services:read') ||
        checkPerm('clouds.services:read') ||
        canReadContainerTab(checkPerm, 'services')
      ) {
        loadResource(
          'services',
          () => fetchHarvesterServices(cloudId, force),
          (json) => {
            const list: any[] = Array.isArray((json as any)?.data?.items)
              ? (json as any).data.items
              : [];
            setHarvesterServices(Array.isArray(list) ? list : []);
            setRawServices(json || null);
          },
          force,
        );
      }
      return true;
    case 'registries':
      if (canReadContainerTab(checkPerm, 'registries')) {
        if (harvesterSecrets.length > 0 && !force) {
          const dockerSecrets = harvesterSecrets.filter(
            (item: any) =>
              item?.type === 'kubernetes.io/dockerconfigjson',
          );
          setHarvesterImagePullSecrets(dockerSecrets);
          loadedRef.current.add('imagePullSecrets');
        } else {
          loadResource(
            'imagePullSecrets',
            () => fetchHarvesterImagePullSecrets(cloudId, undefined, force),
            (json) => {
              const list: any[] = (json as any)?.data?.items || [];
              setHarvesterImagePullSecrets(Array.isArray(list) ? list : []);
            },
            force,
          );
        }
        loadResource(
          'pdbs',
          () => fetchHarvesterPDBs(cloudId, undefined, force),
          (json) => {
            const list: any[] = (json as any)?.data?.items || [];
            setHarvesterPDBs(Array.isArray(list) ? list : []);
          },
          force,
        );
      }
      return true;
    case 'gateway_api':
      if (canReadContainerTab(checkPerm, 'gateway_api')) {
        loadResource(
          'gatewayApiStatus',
          () => checkGatewayApiStatus(cloudId),
          (json) => {
            setGatewayApiStatus(json?.data || null);
          },
          force,
        );
        loadResource(
          'gatewayClasses',
          () => fetchGatewayClasses(cloudId),
          (json) => {
            const list: any[] = (json as any)?.data?.items || [];
            setGatewayClasses(Array.isArray(list) ? list : []);
          },
          force,
        );
        loadResource(
          'gateways',
          () => fetchGateways(cloudId),
          (json) => {
            const list: any[] = (json as any)?.data?.items || [];
            setGateways(Array.isArray(list) ? list : []);
          },
          force,
        );
        loadResource(
          'httpRoutes',
          () => fetchHttpRoutes(cloudId),
          (json) => {
            const list: any[] = (json as any)?.data?.items || [];
            setHttpRoutes(Array.isArray(list) ? list : []);
          },
          force,
        );
        loadResource(
          'grpcRoutes',
          () => fetchGrpcRoutes(cloudId),
          (json) => {
            const list: any[] = (json as any)?.data?.items || [];
            setGrpcRoutes(Array.isArray(list) ? list : []);
          },
          force,
        );
      }
      return true;
    case 'pdbs':
      if (canReadContainerTab(checkPerm, 'pdbs')) {
        loadResource(
          'pdbs',
          () => fetchHarvesterPDBs(cloudId, undefined, force),
          (json) => {
            const list: any[] = (json as any)?.data?.items || [];
            setHarvesterPDBs(Array.isArray(list) ? list : []);
          },
          force,
        );
      }
      return true;
    case 'networkpolicies':
      if (canReadContainerTab(checkPerm, 'networkpolicies')) {
        loadResource(
          'networkpolicies',
          () => fetchNetworkPolicies(cloudId, undefined, force),
          (json) => {
            const list: any[] = (json as any)?.data?.items || [];
            setHarvesterNetworkPolicies(Array.isArray(list) ? list : []);
          },
          force,
        );
      }
      return true;
    case 'service_topology':
      if (
        canReadContainerTab(checkPerm, 'services') &&
        canReadContainerTab(checkPerm, 'ingresses') &&
        canReadContainerTab(checkPerm, 'pods')
      ) {
        loadResource(
          'ingresses',
          () => fetchHarvesterIngresses(cloudId, force),
          (json) => {
            const list: any[] = Array.isArray((json as any)?.data?.items)
              ? (json as any).data.items
              : [];
            setHarvesterIngresses(Array.isArray(list) ? list : []);
            setRawIngresses(json || null);
          },
          force,
        );
        loadResource(
          'services',
          () => fetchHarvesterServices(cloudId, force),
          (json) => {
            const list: any[] = Array.isArray((json as any)?.data?.items)
              ? (json as any).data.items
              : [];
            setHarvesterServices(Array.isArray(list) ? list : []);
            setRawServices(json || null);
          },
          force,
        );
        loadResource(
          'pods',
          () => fetchHarvesterPods(cloudId, undefined, force),
          (json) => {
            const list: any[] = (json as any)?.data?.items || [];
            setHarvesterPods(Array.isArray(list) ? list : []);
          },
          force,
        );
      }
      return true;
    default:
      return false;
  }
}
