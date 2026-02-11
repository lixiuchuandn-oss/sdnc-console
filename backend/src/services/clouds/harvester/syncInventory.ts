import { AppDataSource } from '../../../config/database';
import { HarvesterNodeInventory } from '../../../entities/harvester/HarvesterNodeInventory';// Harvester 节点资源
import { HarvesterNamespaceInventory } from '../../../entities/harvester/HarvesterNamespaceInventory';// Harvester 命名空间资源
import { HarvesterVmInventory } from '../../../entities/harvester/HarvesterVmInventory';// Harvester 虚拟机资源
import { HarvesterVmiInventory } from '../../../entities/harvester/HarvesterVmiInventory';// Harvester 虚拟机实例资源
import { HarvesterImageInventory } from '../../../entities/harvester/HarvesterImageInventory';// Harvester 镜像资源
import { KubevirtVolumeInventory } from '../../../entities/kubevirt/KubevirtVolumeInventory';// Kubevirt 卷资源
import { KubevirtStorageClassInventory } from '../../../entities/kubevirt/KubevirtStorageClassInventory';
import { KubevirtNadInventory } from '../../../entities/kubevirt/KubevirtNadInventory';// Kubevirt NAD 资源
import { KubevirtLoadBalancerInventory } from '../../../entities/kubevirt/KubevirtLoadBalancerInventory';
import { KubeOvnVpcInventory } from '../../../entities/kubeovn/KubeOvnVpcInventory';// Kube-ovn 虚拟私有云资源
import { KubeOvnSubnetInventory } from '../../../entities/kubeovn/KubeOvnSubnetInventory';// Kube-ovn 子网资源
// import { KubeOvnProviderInventory } from '../../../entities/kubeovn/KubeOvnProviderInventory';// Kbue-ovn 公共网络
import { HarvesterGpuInventory } from '../../../entities/harvester/HarvesterGpuInventory';// Harvester GPU 资源
import { HarvesterSnapshotInventory } from '../../../entities/harvester/HarvesterSnapshotInventory';
import { HarvesterBackupInventory } from '../../../entities/harvester/HarvesterBackupInventory';
import { HarvesterSshKeyInventory } from '../../../entities/harvester/HarvesterSshKeyInventory';
import { HarvesterCloudInitInventory } from '../../../entities/harvester/HarvesterCloudInitInventory';
import { KubeOvnIngressInventory } from '../../../entities/kubeovn/KubeOvnIngressInventory';
import { HarvesterLoadBalancerIPPoolInventory } from '../../../entities/harvester/HarvesterLoadBalancerIPPoolInventory';
import { HarvesterPciDeviceInventory } from '../../../entities/harvester/HarvesterPciDeviceInventory';
import { HarvesterUsbInventory } from '../../../entities/harvester/HarvesterUsbInventory';
import { HarvesterCapabilityInventory } from '../../../entities/harvester/HarvesterCapabilityInventory';
import { HarvesterServiceInventory } from '../../../entities/harvester/HarvesterServiceInventory';
import { KubeOvnEipInventory } from '../../../entities/kubeovn/KubeOvnEipInventory';
import { KubeOvnFipInventory } from '../../../entities/kubeovn/KubeOvnFipInventory';
import { KubeOvnNatRuleInventory } from '../../../entities/kubeovn/KubeOvnNatRuleInventory';
import { HarvesterTemplateInventory } from '../../../entities/harvester/HarvesterTemplateInventory';
import { HarvesterScheduleVmBackupInventory } from '../../../entities/harvester/HarvesterScheduleVmBackupInventory';
import { HarvesterClusterNetworkInventory } from '../../../entities/harvester/HarvesterClusterNetworkInventory';
import { HarvesterVlanConfigInventory } from '../../../entities/harvester/HarvesterVlanConfigInventory';

import {
  listHarvesterImagesStandard,
  listHarvesterVolumesStandard,
  listHarvesterNADsStandard,
  listKubeOvnVpcs,
  listKubeOvnSubnets,
  listHarvesterGpuResources,
  listHarvesterUsbResources,
  listKubevirtVMsRaw,
  listKubevirtVMIsRaw,
  listHarvesterNamespacesRaw,
  listHarvesterNodesStandard,
  listHarvesterStorageClassesStandard,
  listHarvesterLoadBalancers,
  listHarvesterVirtualMachineSnapshots,
  listHarvesterVolumeSnapshots,
  listHarvesterBackupsStandard,
  listHarvesterSshKeysStandard,
  listHarvesterCloudInitsStandard,
  listHarvesterIngressesStandard,
  listHarvesterLoadBalancerIPPools,
  listHarvesterServices,
  listKubeOvnEips,
  listKubeOvnFips,
  listKubeOvnSnatRules,
  listKubeOvnDnatRules,
  getHarvesterCapabilities,
  listHarvesterPciDevices,
  listHarvesterTemplatesRaw,
  listHarvesterScheduleVmBackupsStandard,
  listHarvesterClusterNetworks,
  listHarvesterClusterNetworkConfigs,
} from './client';

const upsertItems = async (repo: any, cloudId: string, items: any[], mapper: (item: any) => any) => {
  if (!items || items.length === 0) {
    // If empty, we might want to clear existing? Or maybe API failed.
    // If API returns empty list, we should clear.
    // But to be safe against empty returns due to error, we usually trust the caller handled errors.
    // Here we assume items is the valid full list.
    await repo.delete({ cloudId });
    return;
  }

  const entities = items.map((item) => {
    const mapped = mapper(item);
    return { ...mapped, cloudId };
  });

  // Use transaction to replace
  await AppDataSource.transaction(async (manager) => {
    // 1. Delete all for this cloud (Simple Full Sync)
    // To be more efficient/safe, we could diff, but for inventory snapshot, replace is common.
    // However, to preserve history or if IDs are stable, upsert is better.
    // Given we want to be "Reasonable", let's try to keep IDs if possible, but UUIDs are generated by DB?
    // The entities have 'uid' from K8s. We should use that as logical key.
    
    // Deleting and re-inserting is safest for consistency but changes internal IDs.
    // Let's delete by cloudId and re-insert.
    await manager.delete(repo.target, { cloudId });
    await manager.save(repo.target, entities);
  });
};

export const syncHarvesterImages = async (cloud: any, insecure: boolean) => {
  const items = await listHarvesterImagesStandard({
    endpoint: cloud.endpoint,
    token: cloud.secretKey,
    insecure,
    version: (cloud.config as any)?.harvesterVersion,
  } as any);

  console.log(`[Harvester-Sync] ${cloud.name}: 镜像同步完成，共 ${items.length} 条`);

  const repo = AppDataSource.getRepository(HarvesterImageInventory);
  await upsertItems(repo, cloud.id, items, (item) => ({
    uid: item.metadata?.uid || item.id,
    name: item.metadata?.name,
    namespace: item.metadata?.namespace,
    displayName: item.spec?.displayName,
    progress: item.status?.progress,
    size: String(item.status?.size || item.status?.downloadedBytes || '0'),
    storageClassName: item.spec?.storageClassName,
    labels: item.metadata?.labels,
    annotations: item.metadata?.annotations,
    rawData: item,
  }));
};

export const syncHarvesterScheduleVmBackups = async (cloud: any, insecure: boolean) => {
  let items: any[] = [];
  try {
    items = await listHarvesterScheduleVmBackupsStandard({
      endpoint: cloud.endpoint,
      token: cloud.secretKey,
      insecure,
    } as any);
  } catch (e: any) {
    if (Number(e?.status) === 401 || String(e?.message).includes('401')) return;
    console.warn(`[Harvester-Sync] ${cloud.name}: 定时备份策略获取失败:`, e.message);
    return;
  }

  console.log(`[Harvester-Sync] ${cloud.name}: 定时备份策略同步完成，共 ${items.length} 条`);

  // Filter out items that are marked for deletion
  const validItems = items.filter((item: any) => !item.metadata?.deletionTimestamp);

  const repo = AppDataSource.getRepository(HarvesterScheduleVmBackupInventory);
  await upsertItems(repo, cloud.id, validItems, (item) => ({
    uid: item.metadata?.uid || item.id,
    name: item.metadata?.name,
    namespace: item.metadata?.namespace,
    cron: item.spec?.cron,
    vmName: item.spec?.vmbackup?.source?.name,
    retention: String(item.spec?.retain || ''),
    status: item.spec?.suspend ? 'Suspended' : 'Active',
    maxFailure: item.spec?.maxFailure,
    links: item.links,
    labels: item.metadata?.labels,
    annotations: item.metadata?.annotations,
    rawData: item,
  }));
};

export const syncHarvesterClusterNetworks = async (cloud: any, insecure: boolean) => {
  const [items, configs] = await Promise.all([
    listHarvesterClusterNetworks({
      endpoint: cloud.endpoint,
      token: cloud.secretKey,
      insecure,
    } as any),
    listHarvesterClusterNetworkConfigs({
      endpoint: cloud.endpoint,
      token: cloud.secretKey,
      insecure,
    } as any),
  ]);

  console.log(`[Harvester-Sync] ${cloud.name}: 集群网络同步完成，共 ${items.length} 条 (配置 ${configs.length} 条)`);

  const repo = AppDataSource.getRepository(HarvesterClusterNetworkInventory);
  await upsertItems(repo, cloud.id, items, (item) => {
    // Match Configs (VlanConfigs) by spec.clusterNetwork
    // Note: A ClusterNetwork can have multiple VlanConfigs (for different node groups)
    const matchedConfigs = configs.filter((c: any) => c.spec?.clusterNetwork === item.metadata?.name);
    
    // Extract Uplink info
    // Aggregate nics from all matched configs
    let uplinks: any = null;
    if (matchedConfigs.length > 0) {
      const allNics = new Set<string>();
      matchedConfigs.forEach((c: any) => {
        const nics = c.spec?.uplink?.nics || [];
        if (Array.isArray(nics)) {
          nics.forEach((nic: string) => allNics.add(nic));
        }
      });

      uplinks = {
        nics: Array.from(allNics),
        // Use the first config's attributes as representative (usually consistent within a cluster network)
        linkAttributes: matchedConfigs[0]?.spec?.uplink?.linkAttributes,
        bondOptions: matchedConfigs[0]?.spec?.uplink?.bondOptions
      };
    }

    return {
      name: item.metadata?.name,
      description: item.metadata?.annotations?.['field.cattle.io/description'] || '',
      labels: item.metadata?.labels,
      annotations: item.metadata?.annotations,
      links: item.links,
      uplinks,
      rawData: item,
    };
  });

  // Sync VlanConfigs to its own table
  console.log(`[Harvester-Sync] ${cloud.name}: VLAN配置同步完成，共 ${configs.length} 条`);
  const vlanConfigRepo = AppDataSource.getRepository(HarvesterVlanConfigInventory);
  await upsertItems(vlanConfigRepo, cloud.id, configs, (item) => ({
    name: item.metadata?.name,
    description: item.metadata?.annotations?.['field.cattle.io/description'] || '',
    clusterNetwork: item.spec?.clusterNetwork,
    nodeSelector: item.spec?.nodeSelector,
    uplink: item.spec?.uplink,
    labels: item.metadata?.labels,
    annotations: item.metadata?.annotations,
    rawData: item,
  }));
};

export const syncHarvesterTemplates = async (cloud: any, insecure: boolean) => {
  let items: any[] = [];
  try {
    items = await listHarvesterTemplatesRaw({
      endpoint: cloud.endpoint,
      token: cloud.secretKey,
      insecure,
    } as any);
  } catch (e: any) {
    if (Number(e?.status) === 401 || String(e?.message).includes('401') || String(e?.message).toLowerCase().includes('unauthorized')) {
      console.warn(`[Harvester-Sync] ${cloud.name}: 跳过模板同步 (401 未授权)`);
      return;
    }
    throw e;
  }

  console.log(`[Harvester-Sync] ${cloud.name}: 模板同步完成，共 ${items.length} 条`);

  const repo = AppDataSource.getRepository(HarvesterTemplateInventory);
  await upsertItems(repo, cloud.id, items, (item) => ({
    uid: item.metadata?.uid || item.id,
    name: item.metadata?.name,
    namespace: item.metadata?.namespace,
    description: item.spec?.description,
    rawData: item,
  }));
};

export const syncHarvesterUsbResources = async (cloud: any, insecure: boolean) => {
  let items: any[] = [];
  try {
    items = await listHarvesterUsbResources({
      endpoint: cloud.endpoint,
      token: cloud.secretKey,
      insecure,
    } as any);
  } catch (e: any) {
    if (Number(e?.status) === 401 || String(e?.message).includes('401')) return;
    console.warn(`[Harvester-Sync] ${cloud.name}: USB设备获取失败:`, e.message);
    return;
  }

  console.log(`[Harvester-Sync] ${cloud.name}: USB设备同步完成，共 ${items.length} 条`);

  const repo = AppDataSource.getRepository(HarvesterUsbInventory);
  await upsertItems(repo, cloud.id, items, (item) => ({
    // USB items from listHarvesterUsbResources don't have standard k8s metadata
    // They are constructed objects
    uid: item.resourceName, // Using resourceName as unique ID
    resourceName: item.resourceName,
    name: item.name,
    vendorId: item.vendorId,
    productId: item.productId,
    description: (item.raw as any)?.description || item.name,
    rawData: item.raw,
  }));
};

export const syncHarvesterLoadBalancers = async (cloud: any, insecure: boolean) => {
  let items: any[] = [];
  try {
    items = await listHarvesterLoadBalancers({
      endpoint: cloud.endpoint,
      token: cloud.secretKey,
      insecure,
    } as any);
  } catch (e: any) {
    if (Number(e?.status) === 401 || String(e?.message).includes('401') || String(e?.message).toLowerCase().includes('unauthorized')) {
      console.warn(`[Harvester-Sync] ${cloud.name}: 跳过负载均衡器同步 (401 未授权)`);
      return;
    }
    throw e;
  }

  console.log(`[Harvester-Sync] ${cloud.name}: 负载均衡器同步完成，共 ${items.length} 条`);

  const repo = AppDataSource.getRepository(KubevirtLoadBalancerInventory);
  await upsertItems(repo, cloud.id, items, (item) => ({
    uid: item.metadata?.uid || item.id,
    name: item.metadata?.name,
    namespace: item.metadata?.namespace,
    cluster: item.spec?.cluster,
    vpc: item.spec?.vpc,
    externalIP: item.status?.externalIP,
    ports: item.spec?.ports,
    links: item.links,
    labels: item.metadata?.labels,
    annotations: item.metadata?.annotations,
    rawData: item,
  }));
};

export const syncHarvesterLoadBalancerIPPools = async (cloud: any, insecure: boolean) => {
  let items: any[] = [];
  try {
    items = await listHarvesterLoadBalancerIPPools({
      endpoint: cloud.endpoint,
      token: cloud.secretKey,
      insecure,
    } as any);
  } catch (e: any) {
    if (Number(e?.status) === 401 || String(e?.message).includes('401')) {
      return;
    }
    console.warn(`[Harvester-Sync] ${cloud.name}: 负载均衡IP池获取失败:`, e.message);
    // Non-critical, continue
    return;
  }

  console.log(`[Harvester-Sync] ${cloud.name}: 负载均衡IP池同步完成，共 ${items.length} 条`);

  const repo = AppDataSource.getRepository(HarvesterLoadBalancerIPPoolInventory);
  await upsertItems(repo, cloud.id, items, (item) => ({
    uid: item.metadata?.uid || item.id,
    name: item.metadata?.name,
    namespace: item.metadata?.namespace,
    links: item.links,
    ipam: item.spec?.ipam,
    selector: item.spec?.selector,
    subnet: item.status?.allocated?.subnet, // Common status field for subnet? Need to verify schema but saving rawData covers it
    gateway: item.status?.allocated?.gateway,
    rawData: item,
  }));
};

export const syncKubevirtVms = async (cloud: any, insecure: boolean) => {
  const items = await listKubevirtVMsRaw({
    endpoint: cloud.endpoint,
    token: cloud.secretKey,
    insecure,
    version: (cloud.config as any)?.harvesterVersion,
  } as any);

  console.log(`[Harvester-Sync] ${cloud.name}: 虚拟机同步完成，共 ${items.length} 条`);

  // Calculate origin for view links fallback
  const base = (cloud.endpoint || '').replace(/\/+$/, '');
  let origin = base;
  try {
    const u = new URL(base);
    origin = `${u.protocol}//${u.host}`;
  } catch {
    origin = base.replace(/\/v[0-9].*$/, '');
  }

  const repo = AppDataSource.getRepository(HarvesterVmInventory);
  await upsertItems(repo, cloud.id, items, (item) => ({
    uid: item.metadata?.uid,
    name: item.metadata?.name,
    namespace: item.metadata?.namespace,
    running: item.spec?.running,
    runStrategy: item.spec?.runStrategy,
    template: item.spec?.template,
    labels: item.metadata?.labels,
    annotations: item.metadata?.annotations,
    creationTimestamp: item.metadata?.creationTimestamp,
    // Strictly use API-provided link (Steve API). If missing (e.g. Native Kubevirt), leave it empty. No hacks.
    view: item.links?.view || '',
    rawData: item,
  }));

  return items.length;
};

export const syncKubevirtVmis = async (cloud: any, insecure: boolean) => {
  const items = await listKubevirtVMIsRaw({
    endpoint: cloud.endpoint,
    token: cloud.secretKey,
    insecure,
    version: (cloud.config as any)?.harvesterVersion,
  } as any);

  console.log(`[Harvester-Sync] ${cloud.name}: 虚拟机实例同步完成，共 ${items.length} 条`);

  const repo = AppDataSource.getRepository(HarvesterVmiInventory);
  await upsertItems(repo, cloud.id, items, (item) => ({
    uid: item.metadata?.uid,
    name: item.metadata?.name,
    namespace: item.metadata?.namespace,
    phase: item.status?.phase,
    nodeName: item.status?.nodeName,
    ipAddresses: (item.status?.interfaces || []).map((i: any) => i.ipAddress).filter((i: any) => !!i),
    interfaces: item.status?.interfaces,
    guestOSInfo: item.status?.guestOSInfo,
    conditions: item.status?.conditions,
    labels: item.metadata?.labels,
    annotations: item.metadata?.annotations,
    creationTimestamp: item.metadata?.creationTimestamp,
    view: item.links?.view || '',
    rawData: item,
  }));

  return items.filter((i: any) => i.status?.phase === 'Running').length;
};

export const syncHarvesterVolumes = async (cloud: any, insecure: boolean) => {
  const items = await listHarvesterVolumesStandard({
    endpoint: cloud.endpoint,
    token: cloud.secretKey,
    insecure,
  } as any);

  console.log(`[Harvester-Sync] ${cloud.name}: 存储卷同步完成，共 ${items.length} 条`);

  const repo = AppDataSource.getRepository(KubevirtVolumeInventory);
  await upsertItems(repo, cloud.id, items, (item) => ({
    uid: item.metadata?.uid || item.id,
    name: item.metadata?.name,
    namespace: item.metadata?.namespace,
    phase: item.status?.phase,
    capacity: item.status?.capacity?.storage,
    storageClassName: item.spec?.storageClassName,
    volumeMode: item.spec?.volumeMode,
    accessModes: Array.isArray(item.spec?.accessModes) ? item.spec.accessModes.join(',') : '',
    labels: item.metadata?.labels,
    annotations: item.metadata?.annotations,
    rawData: item,
  }));
};

export const syncHarvesterNads = async (cloud: any, insecure: boolean) => {
  const items = await listHarvesterNADsStandard({
    endpoint: cloud.endpoint,
    token: cloud.secretKey,
    insecure,
  } as any);

  console.log(`[Harvester-Sync] ${cloud.name}: 网络定义同步完成，共 ${items.length} 条`);

  const repo = AppDataSource.getRepository(KubevirtNadInventory);
  await upsertItems(repo, cloud.id, items, (item) => ({
    uid: item.metadata?.uid || item.id,
    name: item.metadata?.name,
    namespace: item.metadata?.namespace,
    links: item.links,
    config: item.spec?.config,
    type: JSON.parse(item.spec?.config || '{}').type,
    labels: item.metadata?.labels,
    annotations: item.metadata?.annotations,
    rawData: item,
  }));
};

export const syncKubeOvnVpcs = async (cloud: any, insecure: boolean) => {
  const items = await listKubeOvnVpcs({
    endpoint: cloud.endpoint,
    token: cloud.secretKey,
    insecure,
    version: (cloud.config as any)?.harvesterVersion,
  } as any);

  console.log(`[Harvester-Sync] ${cloud.name}: VPC同步完成，共 ${items.length} 条`);

  const repo = AppDataSource.getRepository(KubeOvnVpcInventory);
  await upsertItems(repo, cloud.id, items, (item) => ({
    uid: item.metadata?.uid || item.id,
    name: item.metadata?.name,
    namespace: item.metadata?.namespace, // Usually cluster scoped or null
    status: item.status?.conditions?.[0]?.type || 'Unknown',
    subnets: item.status?.subnets,
    labels: item.metadata?.labels,
    annotations: item.metadata?.annotations,
    rawData: item,
  }));
};

export const syncKubeOvnSubnets = async (cloud: any, insecure: boolean) => {
  const items = await listKubeOvnSubnets({
    endpoint: cloud.endpoint,
    token: cloud.secretKey,
    insecure,
    version: (cloud.config as any)?.harvesterVersion,
  } as any);

  console.log(`[Harvester-Sync] ${cloud.name}: 子网同步完成，共 ${items.length} 条`);

  const repo = AppDataSource.getRepository(KubeOvnSubnetInventory);
  await upsertItems(repo, cloud.id, items, (item) => ({
    uid: item.metadata?.uid || item.id,
    name: item.metadata?.name,
    namespace: item.metadata?.namespace, // Usually cluster scoped or null
    vpc: item.spec?.vpc,
    cidr: item.spec?.cidrBlock,
    gateway: item.spec?.gateway,
    protocol: item.spec?.protocol,
    availableIps: item.status?.availableIps,
    labels: item.metadata?.labels,
    annotations: item.metadata?.annotations,
    rawData: item,
  }));
};

export const syncHarvesterGpus = async (cloud: any, insecure: boolean) => {
  const items = await listHarvesterGpuResources({
    endpoint: cloud.endpoint,
    token: cloud.secretKey,
    insecure,
  } as any);

  console.log(`[Harvester-Sync] ${cloud.name}: GPU同步完成，共 ${items.length} 条`);

  const repo = AppDataSource.getRepository(HarvesterGpuInventory);
  await upsertItems(repo, cloud.id, items, (item) => ({
    uid: item.uid || item.raw?.metadata?.uid || `${item.nodeName}-${item.address}`, // Fallback ID
    name: item.name || item.productName || item.metadata?.name,
    nodeName: item.nodeName,
    address: item.address,
    vendorId: item.vendorId,
    deviceId: item.deviceId,
    labels: item.labels || item.raw?.metadata?.labels,
    rawData: item,
  }));
};

export const syncHarvesterNamespaces = async (cloud: any, insecure: boolean) => {
  const items = await listHarvesterNamespacesRaw({
    endpoint: cloud.endpoint,
    token: cloud.secretKey,
    insecure,
  } as any);

  console.log(`[Harvester-Sync] ${cloud.name}: 命名空间同步完成，共 ${items.length} 条`);

  const repo = AppDataSource.getRepository(HarvesterNamespaceInventory);
  await upsertItems(repo, cloud.id, items, (item) => ({
    name: item.metadata?.name,
    labels: item.metadata?.labels,
    annotations: item.metadata?.annotations,
    links: item.links,
    rawData: item,
  }));
};

export const syncHarvesterNodes = async (cloud: any, insecure: boolean) => {
  let items: any[] = [];
  try {
    items = await listHarvesterNodesStandard({
      endpoint: cloud.endpoint,
      token: cloud.secretKey,
      insecure,
    } as any);
  } catch (e: any) {
    if (Number(e?.status) === 401 || String(e?.message).includes('401')) return;
    console.warn(`[Harvester-Sync] ${cloud.name}: 节点列表获取失败:`, e.message);
    return;
  }

  console.log(`[Harvester-Sync] ${cloud.name}: 节点同步完成，共 ${items.length} 条`);

  const repo = AppDataSource.getRepository(HarvesterNodeInventory);
  await upsertItems(repo, cloud.id, items, (item) => ({
    uid: item.metadata?.uid || item.id,
    name: item.metadata?.name,
    status: item.ready ? 'Ready' : 'NotReady',
    internalIP: item.internalIP,
    externalIP: item.externalIP,
    links: item.links,
    capacity: { cpu: item.cpu, memory: item.memory },
    allocatable: { cpu: item.cpu, memory: item.memory },
    nodeInfo: item.status?.nodeInfo,
    kernelVersion: item.status?.nodeInfo?.kernelVersion,
    osImage: item.status?.nodeInfo?.osImage,
    containerRuntimeVersion: item.status?.nodeInfo?.containerRuntimeVersion,
    kubeletVersion: item.status?.nodeInfo?.kubeletVersion,
    kubeProxyVersion: item.status?.nodeInfo?.kubeProxyVersion,
    operatingSystem: item.status?.nodeInfo?.operatingSystem,
    architecture: item.status?.nodeInfo?.architecture,
    labels: item.metadata?.labels,
    annotations: item.metadata?.annotations,
    rawData: item,
  }));
};

export const syncHarvesterStorageClasses = async (cloud: any, insecure: boolean) => {
  let items: any[] = [];
  try {
    items = await listHarvesterStorageClassesStandard({
      endpoint: cloud.endpoint,
      token: cloud.secretKey,
      insecure,
    } as any);
  } catch (e: any) {
    if (Number(e?.status) === 401 || String(e?.message).includes('401') || String(e?.message).toLowerCase().includes('unauthorized')) {
      console.warn(`[Harvester-Sync] ${cloud.name}: 跳过存储类同步 (401 未授权)`);
      return;
    }
    throw e;
  }

  console.log(`[Harvester-Sync] ${cloud.name}: 存储类同步完成，共 ${items.length} 条`);

  const repo = AppDataSource.getRepository(KubevirtStorageClassInventory);
  await upsertItems(repo, cloud.id, items, (item) => ({
    uid: item.metadata?.uid || item.id,
    name: item.metadata?.name,
    links: item.links,
    provisioner: item.provisioner,
    reclaimPolicy: item.reclaimPolicy,
    volumeBindingMode: item.volumeBindingMode,
    allowVolumeExpansion: item.allowVolumeExpansion,
    parameters: item.parameters,
    labels: item.metadata?.labels,
    annotations: item.metadata?.annotations,
    rawData: item,
  }));
};

export const syncHarvesterSnapshots = async (cloud: any, insecure: boolean) => {
  let vmSnapshots: any[] = [];
  let volumeSnapshots: any[] = [];
  
  // 1. Sync Virtual Machine Snapshots
  try {
    vmSnapshots = await listHarvesterVirtualMachineSnapshots({
      endpoint: cloud.endpoint,
      token: cloud.secretKey,
      insecure,
    } as any);
  } catch (e: any) {
    if (Number(e?.status) === 401 || String(e?.message).includes('401') || String(e?.message).toLowerCase().includes('unauthorized')) {
      console.warn(`[Harvester-Sync] ${cloud.name}: 跳过虚拟机快照同步 (401 未授权)`);
    } else {
      console.warn(`[Harvester-Sync] ${cloud.name}: 虚拟机快照获取失败: ${e.message}`);
    }
  }

  // 2. Sync Volume Snapshots
  try {
    volumeSnapshots = await listHarvesterVolumeSnapshots({
      endpoint: cloud.endpoint,
      token: cloud.secretKey,
      insecure,
    } as any);
  } catch (e: any) {
    if (Number(e?.status) === 401 || String(e?.message).includes('401') || String(e?.message).toLowerCase().includes('unauthorized')) {
      console.warn(`[Harvester-Sync] ${cloud.name}: 跳过卷快照同步 (401 未授权)`);
    } else {
      console.warn(`[Harvester-Sync] ${cloud.name}: 卷快照获取失败: ${e.message}`);
    }
  }

  const items = [...vmSnapshots, ...volumeSnapshots];
  console.log(`[Harvester-Sync] ${cloud.name}: 快照同步完成，共 ${items.length} 条 (VM: ${vmSnapshots.length}, Volume: ${volumeSnapshots.length})`);

  // Filter out items that are marked for deletion
  const validItems = items.filter((item: any) => !item.metadata?.deletionTimestamp);

  const repo = AppDataSource.getRepository(HarvesterSnapshotInventory);
  await upsertItems(repo, cloud.id, validItems, (item) => ({
    uid: item.metadata?.uid || item.id,
    name: item.metadata?.name,
    namespace: item.metadata?.namespace,
    // Note: For VMSnapshot, spec.source.name is the VM name. For VolumeSnapshot, spec.source.persistentVolumeClaimName is the PVC name.
    // We store both in sourcePvc for now to maintain backward compatibility, or consider splitting columns in future.
    sourcePvc: item.spec?.source?.persistentVolumeClaimName || item.spec?.source?.name,
    status: item.status?.readyToUse ? 'Ready' : 'NotReady',
    size: item.status?.restoreSize,
    restoreSize: item.status?.restoreSize,
    snapshotClassName: item.spec?.volumeSnapshotClassName,
    labels: item.metadata?.labels,
    annotations: item.metadata?.annotations,
    rawData: item,
  }));
};

export const syncHarvesterBackups = async (cloud: any, insecure: boolean) => {
  let items: any[] = [];
  try {
    items = await listHarvesterBackupsStandard({
      endpoint: cloud.endpoint,
      token: cloud.secretKey,
      insecure,
    } as any);
  } catch (e: any) {
    if (Number(e?.status) === 401 || String(e?.message).includes('401') || String(e?.message).toLowerCase().includes('unauthorized')) {
      console.warn(`[Harvester-Sync] ${cloud.name}: 跳过备份同步 (401 未授权)`);
      return;
    }
    throw e;
  }

  console.log(`[Harvester-Sync] ${cloud.name}: 备份同步完成，共 ${items.length} 条`);

  // Filter out items that are marked for deletion
  const validItems = items.filter((item: any) => !item.metadata?.deletionTimestamp);

  const repo = AppDataSource.getRepository(HarvesterBackupInventory);
  await upsertItems(repo, cloud.id, validItems, (item) => ({
    uid: item.metadata?.uid || item.id,
    name: item.metadata?.name,
    namespace: item.metadata?.namespace,
    sourceVm: item.spec?.source?.name,
    readyToUse: item.status?.readyToUse,
    target: JSON.stringify(item.status?.target || {}),
    labels: item.metadata?.labels,
    annotations: item.metadata?.annotations,
    rawData: item,
  }));
};

export const syncHarvesterSshKeys = async (cloud: any, insecure: boolean) => {
  let items: any[] = [];
  try {
    items = await listHarvesterSshKeysStandard({
      endpoint: cloud.endpoint,
      token: cloud.secretKey,
      insecure,
    } as any);
  } catch (e: any) {
    if (Number(e?.status) === 401 || String(e?.message).includes('401') || String(e?.message).toLowerCase().includes('unauthorized')) {
      console.warn(`[Harvester-Sync] ${cloud.name}: 跳过SSH密钥同步 (401 未授权)`);
      return;
    }
    throw e;
  }

  console.log(`[Harvester-Sync] ${cloud.name}: SSH密钥同步完成，共 ${items.length} 条`);

  const repo = AppDataSource.getRepository(HarvesterSshKeyInventory);
  await upsertItems(repo, cloud.id, items, (item) => ({
    uid: item.metadata?.uid || item.id,
    name: item.metadata?.name,
    namespace: item.metadata?.namespace,
    publicKey: item.spec?.publicKey,
    fingerprint: item.status?.fingerprint || item.spec?.fingerprint,
    labels: item.metadata?.labels,
    annotations: item.metadata?.annotations,
    rawData: item,
  }));
};

export const syncHarvesterCloudInits = async (cloud: any, insecure: boolean) => {
  let items: any[] = [];
  try {
    items = await listHarvesterCloudInitsStandard({
      endpoint: cloud.endpoint,
      token: cloud.secretKey,
      insecure,
    } as any);
  } catch (e: any) {
    if (Number(e?.status) === 401 || String(e?.message).includes('401') || String(e?.message).toLowerCase().includes('unauthorized')) {
      console.warn(`[Harvester-Sync] ${cloud.name}: 跳过CloudInit配置同步 (401 未授权)`);
      return;
    }
    throw e;
  }

  console.log(`[Harvester-Sync] ${cloud.name}: CloudInit配置同步完成，共 ${items.length} 条`);

  const repo = AppDataSource.getRepository(HarvesterCloudInitInventory);
  await upsertItems(repo, cloud.id, items, (item) => ({
    uid: item.metadata?.uid || item.id,
    name: item.metadata?.name,
    namespace: item.metadata?.namespace,
    data: item.data,
    labels: item.metadata?.labels,
    annotations: item.metadata?.annotations,
    rawData: item,
  }));
};

export const syncHarvesterIngresses = async (cloud: any, insecure: boolean) => {
  let items: any[] = [];
  try {
    items = await listHarvesterIngressesStandard({
      endpoint: cloud.endpoint,
      token: cloud.secretKey,
      insecure,
    } as any);
  } catch (e: any) {
    if (Number(e?.status) === 401 || String(e?.message).includes('401') || String(e?.message).toLowerCase().includes('unauthorized')) {
      console.warn(`[Harvester-Sync] ${cloud.name}: 跳过路由同步 (401 未授权)`);
      return;
    }
    throw e;
  }

  console.log(`[Harvester-Sync] ${cloud.name}: 路由同步完成，共 ${items.length} 条`);

  const repo = AppDataSource.getRepository(KubeOvnIngressInventory);
  await upsertItems(repo, cloud.id, items, (item) => ({
    uid: item.metadata?.uid || item.id,
    name: item.metadata?.name,
    namespace: item.metadata?.namespace,
    rules: item.spec?.rules,
    tls: item.spec?.tls,
    labels: item.metadata?.labels,
    annotations: item.metadata?.annotations,
    rawData: item,
  }));
};

export const syncHarvesterPciDevices = async (cloud: any, insecure: boolean) => {
  let items: any[] = [];
  try {
    items = await listHarvesterPciDevices({
      endpoint: cloud.endpoint,
      token: cloud.secretKey,
      insecure,
    } as any);
  } catch (e: any) {
    if (Number(e?.status) === 401 || String(e?.message).includes('401')) return;
    console.warn(`[Harvester-Sync] ${cloud.name}: PCI设备获取失败:`, e.message);
    return;
  }

  console.log(`[Harvester-Sync] ${cloud.name}: PCI设备同步完成，共 ${items.length} 条`);

  const repo = AppDataSource.getRepository(HarvesterPciDeviceInventory);
  await upsertItems(repo, cloud.id, items, (item) => ({
    uid: item.uid || item.raw?.metadata?.uid, // listHarvesterPciDevices returns enriched object
    name: item.name,
    nodeName: item.nodeName,
    address: item.address,
    vendorName: item.vendorId, // Enriched object puts vendor ID in vendorId
    productName: item.productId, // Enriched object puts device ID in productId
    vendorId: item.vendorId,
    productId: item.productId,
    classId: item.classId,
    description: item.description,
    rawData: item.raw,
  }));
};

export const syncHarvesterCapabilities = async (cloud: any, insecure: boolean) => {
  let item: any = null;
  try {
    item = await getHarvesterCapabilities({
      endpoint: cloud.endpoint,
      token: cloud.secretKey,
      insecure,
    } as any);
  } catch (e: any) {
    console.warn(`[Harvester-Sync] ${cloud.name}: 功能集获取失败:`, e.message);
    return;
  }
  
  console.log(`[Harvester-Sync] ${cloud.name}: 功能集同步完成，共 ${item ? 1 : 0} 条`);

  const repo = AppDataSource.getRepository(HarvesterCapabilityInventory);
  if (item) {
    await upsertItems(repo, cloud.id, [item], (i) => ({
      name: 'harvester', // or cloud.type
      version: i.version,
      features: i,
      rawData: i,
    }));
  }
};

export const syncHarvesterServices = async (cloud: any, insecure: boolean) => {
  let items: any[] = [];
  try {
    items = await listHarvesterServices({
      endpoint: cloud.endpoint,
      token: cloud.secretKey,
      insecure,
    } as any);
  } catch (e: any) {
    if (Number(e?.status) === 401 || String(e?.message).includes('401')) return;
    console.warn(`[Harvester-Sync] ${cloud.name}: 服务(Service)获取失败:`, e.message);
    return;
  }

  console.log(`[Harvester-Sync] ${cloud.name}: 服务(Service)同步完成，共 ${items.length} 条`);

  const repo = AppDataSource.getRepository(HarvesterServiceInventory);
  await upsertItems(repo, cloud.id, items, (item) => ({
    uid: item.metadata?.uid || item.id,
    name: item.metadata?.name,
    namespace: item.metadata?.namespace,
    links: item.links, // Persist full links object
    type: item.spec?.type,
    clusterIP: item.spec?.clusterIP,
    externalIPs: item.spec?.externalIPs,
    ports: item.spec?.ports,
    selector: item.spec?.selector,
    labels: item.metadata?.labels,
    annotations: item.metadata?.annotations,
    rawData: item,
  }));
};

export const syncKubeOvnEips = async (cloud: any, insecure: boolean) => {
  let items: any[] = [];
  try {
    items = await listKubeOvnEips({
      endpoint: cloud.endpoint,
      token: cloud.secretKey,
      insecure,
    } as any);
  } catch (e: any) {
    if (Number(e?.status) === 401 || String(e?.message).includes('401')) return;
    console.warn(`[Harvester-Sync] ${cloud.name}: EIP获取失败:`, e.message);
    return;
  }

  console.log(`[Harvester-Sync] ${cloud.name}: EIP同步完成，共 ${items.length} 条`);

  const repo = AppDataSource.getRepository(KubeOvnEipInventory);
  await upsertItems(repo, cloud.id, items, (item) => ({
    uid: item.metadata?.uid || item.id,
    name: item.metadata?.name,
    namespace: item.metadata?.namespace,
    v4Ip: item.spec?.v4Ip,
    v6Ip: item.spec?.v6Ip,
    macAddress: item.spec?.macAddress,
    ready: item.status?.ready,
    inUse: item.status?.inUse,
    nat: item.status?.nat,
    labels: item.metadata?.labels,
    annotations: item.metadata?.annotations,
    rawData: item,
  }));
};

export const syncKubeOvnFips = async (cloud: any, insecure: boolean) => {
  let items: any[] = [];
  try {
    items = await listKubeOvnFips({
      endpoint: cloud.endpoint,
      token: cloud.secretKey,
      insecure,
    } as any);
  } catch (e: any) {
    if (Number(e?.status) === 401 || String(e?.message).includes('401')) return;
    console.warn(`[Harvester-Sync] ${cloud.name}: FIP获取失败:`, e.message);
    return;
  }

  console.log(`[Harvester-Sync] ${cloud.name}: FIP同步完成，共 ${items.length} 条`);

  const repo = AppDataSource.getRepository(KubeOvnFipInventory);
  await upsertItems(repo, cloud.id, items, (item) => ({
    uid: item.metadata?.uid || item.id,
    name: item.metadata?.name,
    namespace: item.metadata?.namespace,
    vpc: item.spec?.vpc,
    v4Ip: item.spec?.v4Ip,
    v4Eip: item.spec?.v4Eip,
    ready: item.status?.ready,
    labels: item.metadata?.labels,
    annotations: item.metadata?.annotations,
    rawData: item,
  }));
};

export const syncKubeOvnNatRules = async (cloud: any, insecure: boolean) => {
  let snatItems: any[] = [];
  let dnatItems: any[] = [];
  try {
    snatItems = await listKubeOvnSnatRules({
      endpoint: cloud.endpoint,
      token: cloud.secretKey,
      insecure,
    } as any);
    dnatItems = await listKubeOvnDnatRules({
      endpoint: cloud.endpoint,
      token: cloud.secretKey,
      insecure,
    } as any);
  } catch (e: any) {
    if (Number(e?.status) === 401 || String(e?.message).includes('401')) return;
    console.warn(`[Harvester-Sync] ${cloud.name}: NAT规则获取失败:`, e.message);
    return;
  }

  console.log(`[Harvester-Sync] ${cloud.name}: NAT规则同步完成，共 ${snatItems.length + dnatItems.length} 条`);

  // Combine them, marking type
  const combined = [
    ...snatItems.map(i => ({ ...i, _type: 'SNAT' })),
    ...dnatItems.map(i => ({ ...i, _type: 'DNAT' })),
  ];

  const repo = AppDataSource.getRepository(KubeOvnNatRuleInventory);
  await upsertItems(repo, cloud.id, combined, (item) => ({
    uid: item.metadata?.uid || item.id,
    name: item.metadata?.name,
    vpc: item.spec?.vpc,
    type: item._type,
    cidr: item.spec?.cidr, // SNAT
    eip: item.spec?.eip, // SNAT/DNAT
    externalIp: item.status?.v4Ip || item.status?.externalIp, // Resolved IP
    internalIp: item.spec?.internalIp, // DNAT
    internalPort: item.spec?.internalPort, // DNAT
    externalPort: item.spec?.externalPort, // DNAT
    protocol: item.spec?.protocol,
    rawData: item,
  }));
};
