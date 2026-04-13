import {
  fetchHarvesterNamespaces,
  fetchHarvesterGpuResources,
  fetchHarvesterUsbResources,
  fetchHarvesterPciDevices,
  fetchHarvesterLoadBalancers,
  fetchHarvesterServices,
  fetchKubeOvnVlans,
  fetchKubeOvnProviderNetworks,
  fetchHarvesterIPPools,
  fetchHarvesterClusterNetworks,
  fetchHarvesterNodes,
  fetchHarvesterStorageClasses,
} from '../../runtime/api';
import { CLOUD_PROVIDER_NETWORKS_READ } from '../../../../../../constants/cloudPermissions';
import { isSystemNamespace } from '../../../../../../utils/harvesterUtils';
import { clearCache } from '../../../../../../utils/requestManager';
import type { LoadTabResourceDeps } from '../types';

/** 集群分组：命名空间、节点、设备、网络附件、VLAN/物理网络等 */
export async function tryLoadClusterTab(
  key: string,
  force: boolean,
  skipSync: boolean,
  deps: LoadTabResourceDeps,
): Promise<boolean> {
  const {
    cloudId,
    checkPerm,
    loadResource,
    loadedRef,
    setResourceLoading,
    canReadLoadBalancers,
    setHarvesterNamespacesForManagement,
    setHarvesterNamespaces,
    setHarvesterGpuResources,
    setRawGpu,
    setHarvesterUsbDevices,
    setRawUsbDevices,
    setHarvesterPciDevices,
    setRawPciDevices,
    setHarvesterLoadBalancers,
    setRawLoadBalancers,
    setHarvesterServices,
    setRawServices,
    setHarvesterVlans,
    setRawVlans,
    setHarvesterKubeOvnProviderNetworks,
    setHarvesterIPPools,
    setRawIPPools,
    setHarvesterClusterNetworks,
    setRawClusterNetworks,
    setHarvesterNodes,
    setRawNodes,
    setHarvesterStorageClasses,
  } = deps;

  switch (key) {
    case 'namespaces':
      if (
        checkPerm('clouds.namespaces:read') ||
        checkPerm('clouds.ecs:read')
      ) {
        setResourceLoading((prev) => ({ ...prev, namespaces: true }));
        try {
          const skipSyncParam = skipSync || !force;
          const json = await fetchHarvesterNamespaces(
            cloudId,
            true,
            false,
            skipSyncParam,
          );
          const list: any[] = Array.isArray((json as any)?.data?.items)
            ? (json as any).data.items
            : Array.isArray((json as any)?.items)
              ? (json as any).items
              : [];
          setHarvesterNamespacesForManagement(Array.isArray(list) ? list : []);
          const filtered = list.filter((ns: any) => {
            const name = ns?.metadata?.name || ns?.name;
            return name && !isSystemNamespace(name);
          });
          setHarvesterNamespaces(filtered);
        } catch (e) {
          console.warn('Failed to load namespaces for management', e);
        } finally {
          setResourceLoading((prev) => ({ ...prev, namespaces: false }));
        }
      }
      return true;
    case 'gpu':
      if (checkPerm('clouds.gpus:read') || checkPerm('clouds.ecs:read')) {
        loadResource(
          'gpu',
          () => fetchHarvesterGpuResources(cloudId, force),
          (json) => {
            const list: any[] = Array.isArray((json as any)?.data?.items)
              ? (json as any).data.items
              : Array.isArray((json as any)?.items)
                ? (json as any).items
                : [];
            setHarvesterGpuResources(Array.isArray(list) ? list : []);
            setRawGpu(json || null);
          },
          force,
        );
      }
      return true;
    case 'usb_devices':
    case 'cluster_usb':
      if (
        checkPerm('clouds.usb-devices:read') ||
        checkPerm('clouds.ecs:read')
      ) {
        loadResource(
          'usbDevices',
          () => fetchHarvesterUsbResources(cloudId, force),
          (json) => {
            const list: any[] = Array.isArray((json as any)?.data?.items)
              ? (json as any).data.items
              : Array.isArray((json as any)?.items)
                ? (json as any).items
                : [];
            setHarvesterUsbDevices(Array.isArray(list) ? list : []);
            setRawUsbDevices(json || null);
          },
          force,
        );
      }
      return true;
    case 'pci_devices':
    case 'cluster_pci':
      if (
        checkPerm('clouds.pci-devices:read') ||
        checkPerm('clouds.ecs:read')
      ) {
        loadResource(
          'pciDevices',
          () => fetchHarvesterPciDevices(cloudId, force),
          (json) => {
            const list: any[] = Array.isArray((json as any)?.data?.items)
              ? (json as any).data.items
              : Array.isArray((json as any)?.items)
                ? (json as any).items
                : [];
            setHarvesterPciDevices(Array.isArray(list) ? list : []);
            setRawPciDevices(json || null);
          },
          force,
        );
      }
      return true;
    case 'load_balancers':
      if (canReadLoadBalancers) {
        loadResource(
          'loadBalancers',
          () => fetchHarvesterLoadBalancers(cloudId, force),
          (json) => {
            const list = Array.isArray((json as any)?.data?.items)
              ? (json as any).data.items
              : [];
            setHarvesterLoadBalancers(list);
            setRawLoadBalancers(json || null);
          },
          force,
        );
      }
      return true;
    case 'cluster_services':
    case 'services':
      if (
        checkPerm('clouds.cluster-services:read') ||
        checkPerm('clouds.services:read') ||
        checkPerm('clouds.containers:read') ||
        checkPerm('clouds:read')
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
    case 'cluster_vlans':
    case 'vlans':
      if (
        checkPerm('clouds.vlans:read') ||
        checkPerm(CLOUD_PROVIDER_NETWORKS_READ)
      ) {
        loadResource(
          'vlans',
          () => fetchKubeOvnVlans(cloudId, force, skipSync),
          (json) => {
            const list: any[] = Array.isArray((json as any)?.data?.items)
              ? (json as any).data.items
              : [];
            setHarvesterVlans(Array.isArray(list) ? list : []);
            setRawVlans(json || null);
            if (force && cloudId) {
              clearCache(`/api/clouds/${cloudId}/resources/vlans`, 'GET');
            }
          },
          force,
        );
        loadResource(
          'kubeOvnProviderNetworks',
          () => fetchKubeOvnProviderNetworks(cloudId, force, skipSync),
          (json) => {
            const list: any[] = Array.isArray((json as any)?.data?.items)
              ? (json as any).data.items
              : [];
            setHarvesterKubeOvnProviderNetworks(Array.isArray(list) ? list : []);
          },
          force,
        );
      }
      return true;
    case 'ippools':
      if (checkPerm('clouds.nads:read')) {
        loadResource(
          'ippools',
          () => fetchHarvesterIPPools(cloudId, force),
          (json) => {
            const list: any[] = Array.isArray((json as any)?.data?.items)
              ? (json as any).data.items
              : [];
            setHarvesterIPPools(Array.isArray(list) ? list : []);
            setRawIPPools(json || null);
          },
          force,
        );
      }
      return true;
    case 'clusterNetworks':
      if (checkPerm('clouds.cluster-networks:read')) {
        loadResource(
          'clusterNetworks',
          () => fetchHarvesterClusterNetworks(cloudId, force),
          (json) => {
            const list: any[] = Array.isArray((json as any)?.items)
              ? (json as any).items
              : [];
            setHarvesterClusterNetworks(Array.isArray(list) ? list : []);
            setRawClusterNetworks(json || null);
          },
          force,
        );
      }
      return true;
    case 'cluster_nodes':
      if (
        checkPerm('clouds.cluster-nodes:read') ||
        checkPerm('clouds.ecs:read')
      ) {
        loadResource(
          'nodes',
          () => fetchHarvesterNodes(cloudId, force),
          (json) => {
            const list: any[] = (json as any)?.data?.items || [];
            setHarvesterNodes(Array.isArray(list) ? list : []);
            setRawNodes(json || null);
          },
          force,
        );
      }
      return true;
    case 'storage_classes':
      if (
        checkPerm('clouds.storage-classes:read') ||
        checkPerm('clouds.ecs:read')
      ) {
        loadResource(
          'storageClasses',
          () => fetchHarvesterStorageClasses(cloudId, force),
          (json) => {
            const list: any[] = Array.isArray((json as any)?.data?.items)
              ? (json as any).data.items
              : Array.isArray((json as any)?.items)
                ? (json as any).items
                : [];
            setHarvesterStorageClasses(Array.isArray(list) ? list : []);
          },
          force,
        );
      }
      return true;
    case 'kubeovn_public_networks':
      if (checkPerm(CLOUD_PROVIDER_NETWORKS_READ)) {
        loadResource(
          'providerNetworksTab',
          async () => {
            const [pnRes, vlanRes] = await Promise.all([
              fetchKubeOvnProviderNetworks(cloudId, force, skipSync),
              fetchKubeOvnVlans(cloudId, force, skipSync).catch(() => ({
                data: { items: [] },
              })),
            ]);
            return { pn: pnRes, vlan: vlanRes };
          },
          (json: any) => {
            if (!json?.pn) {
              setHarvesterKubeOvnProviderNetworks([]);
              return;
            }
            const pnItems = Array.isArray(json.pn?.data?.items)
              ? json.pn.data.items
              : [];
            const vItems = Array.isArray(json.vlan?.data?.items)
              ? json.vlan.data.items
              : [];
            setHarvesterKubeOvnProviderNetworks(pnItems);
            setHarvesterVlans(vItems);
            setRawVlans(json.vlan || null);
            if (!force) {
              loadedRef.current.add('vlans');
              loadedRef.current.add('kubeOvnProviderNetworks');
            }
            if (force && cloudId) {
              clearCache(
                `/api/clouds/${cloudId}/resources/provider-networks`,
                'GET',
              );
              clearCache(`/api/clouds/${cloudId}/resources/vlans`, 'GET');
            }
          },
          force,
        );
      }
      return true;
    default:
      return false;
  }
}
