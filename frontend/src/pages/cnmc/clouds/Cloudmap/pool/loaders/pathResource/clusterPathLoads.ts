import {
  fetchHarvesterNamespaces,
  fetchHarvesterGpuResources,
  fetchHarvesterUsbResources,
  fetchHarvesterPciDevices,
  fetchHarvesterLoadBalancers,
  fetchKubeOvnVlans,
  fetchKubeOvnProviderNetworks,
  fetchHarvesterIPPools,
  fetchHarvesterNads,
  fetchHarvesterClusterNetworks,
  fetchHarvesterNodes,
  fetchHarvesterStorageClasses,
  fetchKubeOvnSubnets,
} from '../../api';
import { CLOUD_PROVIDER_NETWORKS_READ } from '../../../../../../../constants/cloudPermissions';
import { isSystemNamespace } from '../../../../../../../utils/harvesterUtils';
import { clearCache } from '../../../../../../../utils/requestManager';
import type { PoolPathResourceDeps } from '../poolDataDeps';

/** Cloudmap `panels/cluster` ??????????????????????????????/GPU/USB/PCI/?????/VLAN/???????? */
export async function tryLoadClusterTab(
  key: string,
  force: boolean,
  skipSync: boolean,
  deps: PoolPathResourceDeps,
): Promise<boolean> {
  const {
    cloudId,
    checkPerm,
    loadResource,
    loadedRef,
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
    setHarvesterVlans,
    setRawVlans,
    setHarvesterKubeOvnProviderNetworks,
    setHarvesterIPPools,
    setRawIPPools,
    setHarvesterNads,
    setRawNads,
    setHarvesterClusterNetworks,
    setRawClusterNetworks,
    setHarvesterNodes,
    setRawNodes,
    setHarvesterStorageClasses,
    setKubeOvnSubnets,
    setRawSubnets,
  } = deps;

  switch (key) {
    case 'kubeovn_public_subnets':
      if (checkPerm('clouds.networks:read') || checkPerm(CLOUD_PROVIDER_NETWORKS_READ)) {
        await loadResource(
          'subnets',
          () => fetchKubeOvnSubnets(cloudId, force, skipSync, 'underlay'),
          (json) => {
            const list: any[] = Array.isArray((json as any)?.data?.items)
              ? (json as any).data.items
              : Array.isArray((json as any)?.items)
                ? (json as any).items
                : [];
            setKubeOvnSubnets(Array.isArray(list) ? list : []);
            setRawSubnets(json || null);
          },
          force,
        );
      }
      return true;
    case 'namespaces':
      if (
        checkPerm('clouds.namespaces:read') ||
        checkPerm('clouds.ecs:read')
      ) {
        await loadResource(
          'namespaces',
          () => fetchHarvesterNamespaces(cloudId, true, false, false),
          (json) => {
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
          },
          force,
        );
      }
      return true;
    case 'gpu':
      if (checkPerm('clouds.gpus:read') || checkPerm('clouds.ecs:read')) {
        await loadResource(
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
    case 'cluster_usb':
      if (
        checkPerm('clouds.usb-devices:read') ||
        checkPerm('clouds.ecs:read')
      ) {
        await loadResource(
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
    case 'cluster_pci':
      if (
        checkPerm('clouds.pci-devices:read') ||
        checkPerm('clouds.ecs:read')
      ) {
        await loadResource(
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
    case 'cluster_sriov':
      if (
        checkPerm('clouds.pci-devices:read') ||
        checkPerm('clouds.ecs:read')
      ) {
        await loadResource(
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
        await loadResource(
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
    case 'cluster_vlans':
      if (
        checkPerm('clouds.vlans:read') ||
        checkPerm(CLOUD_PROVIDER_NETWORKS_READ)
      ) {
        await loadResource(
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
        await loadResource(
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
    case 'nads':
      if (checkPerm('clouds.nads:read')) {
        await loadResource(
          'nads',
          () => fetchHarvesterNads(cloudId, force, skipSync),
          (json) => {
            const list: any[] = Array.isArray((json as any)?.data?.items)
              ? (json as any).data.items
              : [];
            setHarvesterNads(Array.isArray(list) ? list : []);
            setRawNads(json || null);
          },
          force,
        );
      }
      return true;
    case 'ippools':
      if (checkPerm('clouds.ip-pools:read')) {
        await loadResource(
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
        await loadResource(
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
        await loadResource(
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
    case 'cluster_physical_switches':
    case 'drs':
    case 'failure_domains':
      return true;
    case 'storage_classes':
      if (
        checkPerm('clouds.storage-classes:read') ||
        checkPerm('clouds.ecs:read') ||
        checkPerm('clouds:read')
      ) {
        await loadResource(
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
        await loadResource(
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
