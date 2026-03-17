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
import { KubeOvnProviderNetworkInventory } from '../../../entities/kubeovn/KubeOvnProviderNetworkInventory';// Kube-ovn Provider Network 公共网络
import { KubeOvnVlanInventory } from '../../../entities/kubeovn/KubeOvnVlanInventory';// Kube-ovn VLAN 资源
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
import { HarvesterMigrationInventory } from '../../../entities/harvester/HarvesterMigrationInventory';
import { getJsonOnce } from './utils';

// Harvester Inventory 同步层（技术关注点）。
// 设计约定：
// - 本文件只做 “远端 Harvester/Kube-OVN 资源 → 本地 Inventory 表” 的同步，不暴露 HTTP 细节。
// - 细粒度函数：syncHarvesterImages / syncHarvesterVolumes / syncKubeOvnVpcs 等，按资源类型一一对应。
// - 聚合入口（给定一个 cloud，按领域同步一批资源），用于后台任务或一次性全量同步：
//   - syncVmInventory(cloud, insecure)：同步 VM/VMI 相关库存
//   - syncNamespaceInventory(cloud, insecure)：同步命名空间库存
//   - syncVolumeInventory(cloud, insecure)：同步卷 / 存储类 / 快照 / 备份库存
//   - syncNetworkInventory(cloud, insecure)：同步 NAD / VPC / Subnet / EIP / FIP / NAT / Ingress 库存
//   - syncClusterInventory(cloud, insecure)：同步节点、集群网络等 cluster 级库存
//   - syncPeripheralInventory(cloud, insecure)：同步 GPU / USB / PCI 等外设库存
//   - syncTemplateInventory(cloud, insecure)：同步模板 / CloudInit / Schedule 备份等配置库存
// 上层调用方只需选择需要的聚合入口，即可一次性刷新某个领域的本地 DB。

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
  listKubeOvnProviderNetworks,
  listKubeOvnVlans,
  getHarvesterCapabilities,
  listHarvesterPciDevices,
  listHarvesterTemplatesRaw,
  listHarvesterScheduleVmBackupsStandard,
  listHarvesterClusterNetworks,
  listHarvesterClusterNetworkConfigs,
} from './client';

/**
 * 通用库存同步工具：先全量删除，再按映射函数批量插入
 * - 适用于“快照式”同步场景，每次同步都以远端返回为准
 * - 使用事务保证同一云账号 cloudId 下的数据要么全部替换成功，要么全部回滚
 * @param repo TypeORM Repository 实例
 * @param cloudId 云账号 / Harvester 集群 ID
 * @param items 远端返回的原始列表
 * @param mapper 将远端对象映射为库存实体的函数（会自动补充 cloudId）
 */
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
  await AppDataSource.transaction(async (manager: any) => {
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

/**
 * 同步 Harvester 镜像库存
 * 从 Harvester API 获取 VirtualMachineImage 列表，写入 HarvesterImageInventory 表
 * @param cloud 云账号配置（包含 endpoint / secretKey）
 * @param insecure 是否忽略 TLS 校验
 */
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
    // [修复] listHarvesterImagesStandard 返回的数据中，name 和 namespace 已经提取到顶层
    // 优先使用顶层的 name 和 namespace，如果没有则从 metadata 中获取
    uid: item.metadata?.uid || item.id,
    name: item.name || item.metadata?.name,
    namespace: item.namespace || item.metadata?.namespace,
    displayName: item.displayName || item.spec?.displayName,
    progress: item.status?.progress || 0,
    size: String(item.size || item.status?.size || item.status?.downloadedBytes || '0'),
    storageClassName: item.storageClassName || item.spec?.storageClassName,
    labels: item.metadata?.labels,
    annotations: item.metadata?.annotations,
    rawData: item,
  }));
};

/**
 * 同步 Harvester 定时备份策略（ScheduleVMBackup）
 * 过滤掉已标记删除的资源，仅保存有效计划
 * @param cloud 云账号配置
 * @param insecure 是否忽略 TLS 校验
 */
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

/**
 * 同步 Harvester ClusterNetwork 与 VlanConfig
 * - ClusterNetworkInventory：记录逻辑二层网络及其 Uplink 信息
 * - VlanConfigInventory：记录 VLAN 配置及节点选择器等
 * @param cloud 云账号配置
 * @param insecure 是否忽略 TLS 校验
 */
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

/**
 * 同步 Harvester 虚拟机模板
 * 只做简单映射，将模板描述等信息落库
 * @param cloud 云账号配置
 * @param insecure 是否忽略 TLS 校验
 */
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

/**
 * 同步 KubeVirt 虚拟机迁移任务（VirtualMachineInstanceMigration）
 * 优先尝试集群级列表，失败时按命名空间降级遍历
 * @param cloud 云账号配置
 * @param insecure 是否忽略 TLS 校验
 * @returns 返回同步到的迁移任务数量
 */
export const syncKubevirtMigrations = async (cloud: any, insecure: boolean) => {
  const base = (cloud.endpoint || '').replace(/\/+$/, '');
  let origin = base;
  try {
    const u = new URL(base);
    origin = `${u.protocol}//${u.host}`;
  } catch {
    origin = base.replace(/\/v[0-9].*$/, '');
  }

  const clusterUrl = `${origin}/apis/kubevirt.io/v1/virtualmachineinstancemigrations`;
  let items: any[] = [];
  let clusterErr: any = null;
  try {
    const raw = await getJsonOnce(clusterUrl, cloud.secretKey || '', insecure);
    items = Array.isArray(raw?.items) ? raw.items : [];
  } catch (e: any) {
    clusterErr = e;
  }

  if (items.length === 0 && clusterErr) {
    const nsRepo = AppDataSource.getRepository(HarvesterNamespaceInventory);
    const dbItems = await nsRepo.find({ where: { cloudId: cloud.id } });
    const nsList = dbItems
      .map((i: any) => String(i?.name || i?.rawData?.metadata?.name || '').trim())
      .filter(Boolean);
    const uniqueNs = Array.from(new Set(nsList)).filter(Boolean);
    for (const ns of uniqueNs) {
      const nsUrl = `${origin}/apis/kubevirt.io/v1/namespaces/${encodeURIComponent(
        String(ns),
      )}/virtualmachineinstancemigrations`;
      try {
        const rawNs = await getJsonOnce(nsUrl, cloud.secretKey || '', insecure, true);
        const arr = Array.isArray(rawNs?.items) ? rawNs.items : [];
        if (arr.length > 0) items.push(...arr);
      } catch {}
    }
  }

  const repo = AppDataSource.getRepository(HarvesterMigrationInventory);
  await upsertItems(repo, cloud.id, items, (item) => ({
    uid: item?.metadata?.uid || item?.id,
    name: item?.metadata?.name,
    namespace: item?.metadata?.namespace,
    vmiName: item?.spec?.vmiName,
    phase: item?.status?.phase,
    startTimestamp: item?.status?.startTimestamp,
    endTimestamp: item?.status?.endTimestamp,
    labels: item?.metadata?.labels,
    annotations: item?.metadata?.annotations,
    rawData: item,
  }));

  return items.length;
};

/**
 * 同步 Harvester USB 设备库存
 * 数据来源为 listHarvesterUsbResources 的标准化结果
 * @param cloud 云账号配置
 * @param insecure 是否忽略 TLS 校验
 */
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
    vendorId:
      item.vendorId ||
      (item.raw as any)?.status?.vendorID ||
      (item.raw as any)?.status?.vendorId ||
      (item.raw as any)?.spec?.vendorID ||
      (item.raw as any)?.spec?.vendorId,
    productId:
      item.productId ||
      (item.raw as any)?.status?.productID ||
      (item.raw as any)?.status?.productId ||
      (item.raw as any)?.spec?.productID ||
      (item.raw as any)?.spec?.productId,
    description: item.description || (item.raw as any)?.status?.description || (item.raw as any)?.spec?.description || (item.raw as any)?.description || item.name,
    rawData: item.raw,
  }));
};

/**
 * 同步 Harvester 负载均衡器资源
 * 将 Kube-OVN / Harvester LoadBalancer CRD 落库，包含端口、VPC 等信息
 * @param cloud 云账号配置
 * @param insecure 是否忽略 TLS 校验
 */
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

/**
 * 同步 Harvester 负载均衡 IP 池
 * 记录 IP 池的 IPAM 策略、选择器等，用于 UI 展示和策略分析
 * @param cloud 云账号配置
 * @param insecure 是否忽略 TLS 校验
 */
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

/**
 * 同步 KubeVirt 虚拟机（VM）库存
 * 使用 listKubevirtVMsRaw 标准化的 VM 列表，写入 HarvesterVmInventory
 * @param cloud 云账号配置
 * @param insecure 是否忽略 TLS 校验
 * @returns 返回同步到的 VM 数量
 */
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

/**
 * 同步 KubeVirt 虚拟机实例（VMI）库存
 * 提取运行状态、节点、IP 等实时信息
 * @param cloud 云账号配置
 * @param insecure 是否忽略 TLS 校验
 * @returns 返回当前 Running 状态的 VMI 数量
 */
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

/**
 * 同步 Harvester 卷（PVC）库存
 * 使用 listHarvesterVolumesStandard，保留原始 PVC 状态并写入 VolumeInventory
 * @param cloud 云账号配置
 * @param insecure 是否忽略 TLS 校验
 */
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

/**
 * 同步 网络附件定义（NAD，NetworkAttachmentDefinition）
 * 保存原始 config 和 UI 需要的 view 链接
 * @param cloud 云账号配置
 * @param insecure 是否忽略 TLS 校验
 */
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

/**
 * 同步 Kube-OVN VPC 库存
 * 主要记录 VPC 名称、状态及关联的子网信息
 * @param cloud 云账号配置
 * @param insecure 是否忽略 TLS 校验
 */
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

/**
 * 同步 Kube-OVN 子网库存
 * 记录 VPC、CIDR、网关、协议等网络属性
 * @param cloud 云账号配置
 * @param insecure 是否忽略 TLS 校验
 */
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

/**
 * 同步 Harvester GPU 库存
 * 基于 listHarvesterGpuResources 的标准化结果写入 GPUInventory
 * @param cloud 云账号配置
 * @param insecure 是否忽略 TLS 校验
 */
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

/**
 * 同步 Harvester 命名空间库存
 * 用于租户可见性和命名空间下拉列表等场景
 * @param cloud 云账号配置
 * @param insecure 是否忽略 TLS 校验
 */
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

/**
 * 同步 Harvester 节点库存
 * 记录节点就绪状态、IP、规格等信息，用于资源池视图
 * @param cloud 云账号配置
 * @param insecure 是否忽略 TLS 校验
 */
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

/**
 * 同步 存储类（StorageClass）库存
 * 记录 Provisioner、回收策略、是否支持扩容等
 * @param cloud 云账号配置
 * @param insecure 是否忽略 TLS 校验
 */
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

/**
 * 同步 快照库存（VM Snapshot + VolumeSnapshot）
 * 将两类快照合并后统一写入 HarvesterSnapshotInventory
 * @param cloud 云账号配置
 * @param insecure 是否忽略 TLS 校验
 */
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

/**
 * 同步 虚拟机备份库存
 * 过滤掉已删除资源，记录源 VM、目标存储等信息
 * @param cloud 云账号配置
 * @param insecure 是否忽略 TLS 校验
 */
export const syncHarvesterBackups = async (cloud: any, insecure: boolean) => {
  let items: any[] = [];
  try {
    console.log(`[Harvester-Sync] ${cloud.name}: 开始获取备份列表，cloudId: ${cloud.id}`);
    items = await listHarvesterBackupsStandard({
      endpoint: cloud.endpoint,
      token: cloud.secretKey,
      insecure,
    } as any);
    console.log(`[Harvester-Sync] ${cloud.name}: 从 Harvester API 获取到 ${items.length} 条备份`);
  } catch (e: any) {
    if (Number(e?.status) === 401 || String(e?.message).includes('401') || String(e?.message).toLowerCase().includes('unauthorized')) {
      console.warn(`[Harvester-Sync] ${cloud.name}: 跳过备份同步 (401 未授权)`);
      return;
    }
    console.error(`[Harvester-Sync] ${cloud.name}: 获取备份列表失败:`, e?.message || e);
    throw e;
  }

  // Filter out items that are marked for deletion
  const validItems = items.filter((item: any) => !item.metadata?.deletionTimestamp);
  console.log(`[Harvester-Sync] ${cloud.name}: 过滤后有效备份 ${validItems.length} 条（排除删除中的备份）`);

  const repo = AppDataSource.getRepository(HarvesterBackupInventory);
  console.log(`[Harvester-Sync] ${cloud.name}: 开始同步到数据库，cloudId: ${cloud.id}`);
  await upsertItems(repo, cloud.id, validItems, (item) => ({
    uid: item.metadata?.uid || item.id,
    name: item.metadata?.name,
    namespace: item.metadata?.namespace,
    sourceVm: item.spec?.source?.name,
    status: item.status?.readyToUse ? 'Ready' : 'NotReady',
    type: item.spec?.type,
    target: JSON.stringify(item.status?.target || {}),
    labels: item.metadata?.labels,
    annotations: item.metadata?.annotations,
    rawData: item,
  }));
  console.log(`[Harvester-Sync] ${cloud.name}: 备份同步完成，共 ${validItems.length} 条已入库`);
};

/**
 * 同步 Harvester SSH 密钥库存
 * 主要用于在 UI 中快速选择密钥和展示指纹
 * @param cloud 云账号配置
 * @param insecure 是否忽略 TLS 校验
 */
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

/**
 * 同步 CloudInit 配置库存
 * 当前实现保持与 listHarvesterCloudInitsStandard 一致，方便后续扩展
 * @param cloud 云账号配置
 * @param insecure 是否忽略 TLS 校验
 */
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

/**
 * 同步 K8s Ingress 路由库存
 * 记录主机名、规则、TLS 配置等，用于南北向流量视图
 * @param cloud 云账号配置
 * @param insecure 是否忽略 TLS 校验
 */
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

/**
 * 同步 Harvester PCI 设备库存
 * 把 listHarvesterPciDevices 的标准化结果写入数据库，用于硬件资源视图
 * @param cloud 云账号配置
 * @param insecure 是否忽略 TLS 校验
 */
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

/**
 * 同步 Harvester 能力集（Capabilities）
 * 记录 Harvester 版本及支持的特性集合，供前端能力开关使用
 * @param cloud 云账号配置
 * @param insecure 是否忽略 TLS 校验
 */
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

/**
 * 同步 Harvester Service 服务库存
 * 保存 Service 类型、ClusterIP、端口、选择器等，用于服务拓扑展示
 * @param cloud 云账号配置
 * @param insecure 是否忽略 TLS 校验
 */
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

/**
 * 同步 Kube-OVN EIP 库存
 * 记录外网 IP、MAC、使用状态等，用于 EIP 管理视图
 * @param cloud 云账号配置
 * @param insecure 是否忽略 TLS 校验
 */
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

/**
 * 同步 Kube-OVN FIP（浮动 IP）库存
 * 记录绑定的 VPC、EIP、就绪状态等，用于 DNAT/FIP 配置展示
 * @param cloud 云账号配置
 * @param insecure 是否忽略 TLS 校验
 */
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

/**
 * 同步 Kube-OVN VLAN 库存
 * @param cloud 云账号配置
 * @param insecure 是否忽略 TLS 校验
 */
export const syncKubeOvnVlans = async (cloud: any, insecure: boolean) => {
  let items: any[] = [];
  try {
    items = await listKubeOvnVlans({
      endpoint: cloud.endpoint,
      token: cloud.secretKey,
      insecure,
    } as any);
  } catch (e: any) {
    if (Number(e?.status) === 401 || String(e?.message).includes('401')) return;
    console.warn(`[Harvester-Sync] ${cloud.name}: VLAN获取失败:`, e.message);
    return;
  }

  console.log(`[Harvester-Sync] ${cloud.name}: VLAN同步完成，共 ${items.length} 条`);

  const repo = AppDataSource.getRepository(KubeOvnVlanInventory);
  await upsertItems(repo, cloud.id, items, (item) => ({
    uid: item.metadata?.uid || item.id,
    name: item.metadata?.name,
    vlanId: item.spec?.id || item.spec?.vlanId,
    provider: item.spec?.provider,
    providerInterfaceName: item.spec?.providerInterfaceName,
    subnets: item.status?.subnets,
    conflict: item.status?.conflict,
    labels: item.metadata?.labels,
    annotations: item.metadata?.annotations,
    rawData: item,
  }));
};

/**
 * 同步 Kube-OVN Provider Network 库存
 * @param cloud 云账号配置
 * @param insecure 是否忽略 TLS 校验
 */
export const syncKubeOvnProviderNetworks = async (cloud: any, insecure: boolean) => {
  let items: any[] = [];
  try {
    items = await listKubeOvnProviderNetworks({
      endpoint: cloud.endpoint,
      token: cloud.secretKey,
      insecure,
    } as any);
  } catch (e: any) {
    if (Number(e?.status) === 401 || String(e?.message).includes('401')) return;
    console.warn(`[Harvester-Sync] ${cloud.name}: Provider Network获取失败:`, e.message);
    return;
  }

  console.log(`[Harvester-Sync] ${cloud.name}: Provider Network同步完成，共 ${items.length} 条`);

  const repo = AppDataSource.getRepository(KubeOvnProviderNetworkInventory);
  await upsertItems(repo, cloud.id, items, (item) => ({
    uid: item.metadata?.uid || item.id,
    name: item.metadata?.name,
    defaultInterface: item.spec?.defaultInterface,
    customInterfaces: item.spec?.customInterfaces,
    exchangeLinkName: item.spec?.exchangeLinkName,
    excludeNodes: item.spec?.excludeNodes,
    ready: item.status?.ready,
    readyNodes: item.status?.readyNodes,
    notReadyNodes: item.status?.notReadyNodes,
    vlans: item.status?.vlans,
    labels: item.metadata?.labels,
    annotations: item.metadata?.annotations,
    rawData: item,
  }));
};

/**
 * 同步 Kube-OVN NAT 规则库存（SNAT + DNAT）
 * 分别拉取 SNAT / DNAT 资源，打上 _type 标记后统一写入表
 * @param cloud 云账号配置
 * @param insecure 是否忽略 TLS 校验
 */
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

export const syncVmInventory = async (cloud: any, insecure: boolean) => {
  const vms = await syncKubevirtVms(cloud, insecure);
  const vmis = await syncKubevirtVmis(cloud, insecure);
  return { vms, vmis };
};

export const syncVolumeInventory = async (cloud: any, insecure: boolean) => {
  await syncHarvesterVolumes(cloud, insecure);
  await syncHarvesterStorageClasses(cloud, insecure);
  await syncHarvesterSnapshots(cloud, insecure);
  await syncHarvesterBackups(cloud, insecure);
};

export const syncNetworkInventory = async (cloud: any, insecure: boolean) => {
  await syncHarvesterNads(cloud, insecure);
  await syncKubeOvnVpcs(cloud, insecure);
  await syncKubeOvnSubnets(cloud, insecure);
  await syncKubeOvnProviderNetworks(cloud, insecure);
  await syncKubeOvnVlans(cloud, insecure);
  await syncKubeOvnEips(cloud, insecure);
  await syncKubeOvnFips(cloud, insecure);
  await syncKubeOvnNatRules(cloud, insecure);
  await syncHarvesterIngresses(cloud, insecure);
};

export const syncSecurityInventory = async (cloud: any, insecure: boolean) => {
  await syncHarvesterSshKeys(cloud, insecure);
};

export const syncNamespaceInventory = async (cloud: any, insecure: boolean) => {
  await syncHarvesterNamespaces(cloud, insecure);
};

export const syncClusterInventory = async (cloud: any, insecure: boolean) => {
  await syncHarvesterNodes(cloud, insecure);
  await syncHarvesterNamespaces(cloud, insecure);
  await syncHarvesterClusterNetworks(cloud, insecure);
};

export const syncPeripheralInventory = async (cloud: any, insecure: boolean) => {
  await syncHarvesterGpus(cloud, insecure);
  await syncHarvesterUsbResources(cloud, insecure);
  await syncHarvesterPciDevices(cloud, insecure);
};

export const syncTemplateInventory = async (cloud: any, insecure: boolean) => {
  await syncHarvesterTemplates(cloud, insecure);
  await syncHarvesterCloudInits(cloud, insecure);
  await syncHarvesterScheduleVmBackups(cloud, insecure);
};
