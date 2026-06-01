/**
 * ==============================================================================
 * 服务名称: Harvester 虚拟机聚合查询服务 (Harvester VM Aggregated Query Service)
 * 文件路径: backend/src/services/clouds/harvester/vm_aggregated.ts
 * ==============================================================================
 *
 * [功能描述]
 * 提供基于 VM ID (Namespace/Name) 的聚合查询接口，一次性返回 VM 详情及其关联的
 * 核心资源（镜像、卷、网络定义等），解决前端多次分散查询导致的数据不一致和性能问题。
 *
 * [核心功能]
 * 1. [VM 详情聚合]:
 *    - 获取 VM 定义（Spec）和状态（Status）
 *    - 获取 VMI（运行时实例）信息并合并到 VM 对象
 *    - 优先使用 VMI 的运行时状态（IP、节点、迁移状态等）
 *
 * 2. [关联资源查询]:
 *    - 镜像（Images）: 根据 VM 或 PVC 的 imageId 注解查找关联镜像
 *    - 卷（Volumes）: 获取 VM 所在 Namespace 下的所有 PVC，并过滤出 VM 实际使用的卷
 *    - 网络（NADs/VPCs/Subnets）: 获取集群级别的网络定义，并过滤出 VM 实际使用的网络
 *
 * 3. [数据过滤优化]:
 *    - 仅返回 VM 实际关联的资源，减少数据传输量
 *    - 通过并行查询提升性能
 *
 * [设计优势]
 * - 减少前端 API 调用次数：从多次分散查询合并为一次聚合查询
 * - 保证数据一致性：所有数据基于同一时间点的 VM 状态
 * - 提升性能：并行查询多个资源，总耗时接近最慢的单个查询
 *
 * ------------------------------------------------------------------------------
 * [使用场景]
 * ------------------------------------------------------------------------------
 * - VM 详情页面：需要显示 VM 的完整信息和关联资源
 * - VM 编辑页面：需要加载 VM 配置和可选资源列表
 * - VM 列表页面的详情展开：需要快速获取 VM 的关联信息
 *
 * ------------------------------------------------------------------------------
 * [依赖关系]
 * ------------------------------------------------------------------------------
 * - vm.ts: 依赖 getHarvesterVM、getHarvesterVMI
 * - network.ts: 依赖 listHarvesterNADsStandard、listKubeOvnVpcs、listKubeOvnSubnets
 * - storage.ts: 依赖 getHarvesterImage
 * - utils.ts: 依赖 getJsonOnce
 * ==============================================================================
 */

import { HarvesterTestParams } from './types';
import { getHarvesterVM, getHarvesterVMI } from './vm';
import { listHarvesterNADsStandard, listKubeOvnVpcs, listKubeOvnSubnets } from './network';
import { getHarvesterImage } from './storage';
import { getJsonOnce } from './utils';

/**
 * 获取指定命名空间下的 PVC 列表
 *
 * [功能描述]
 * 查询指定命名空间下的所有 PersistentVolumeClaim 资源。
 *
 * [实现原理]
 * 使用 Kubernetes 标准 API: GET /api/v1/namespaces/{namespace}/persistentvolumeclaims
 *
 * @param params Harvester 连接参数
 * @param namespace 命名空间
 * @returns PVC 对象数组，查询失败返回空数组
 */
const listHarvesterPVCsInNamespace = async (
  { endpoint, token, insecure = false }: HarvesterTestParams,
  namespace: string,
): Promise<any[]> => {
  const base = (endpoint || '').replace(/\/+$/, '');
  let origin = base;
  try {
    const u = new URL(base);
    origin = `${u.protocol}//${u.host}`;
  } catch {
    origin = base.replace(/\/v[0-9].*$/, '');
  }

  // K8s Standard API for Namespaced PVCs
  const url = `${origin}/api/v1/namespaces/${encodeURIComponent(namespace)}/persistentvolumeclaims`;

  try {
    const json = await getJsonOnce(url, token, insecure);
    if (json && Array.isArray(json.items)) {
      return json.items;
    }
    return [];
  } catch (e: any) {
    console.warn(
      `[Harvester-Aggregated] Failed to list PVCs in namespace ${namespace}: ${e.message}`,
    );
    return [];
  }
};

/**
 * 获取虚拟机聚合信息
 *
 * [功能描述]
 * 一次性获取 VM 详情及其所有关联资源，包括镜像、卷、网络定义等。
 *
 * [查询流程]
 * 1. [并行查询]: 同时查询 VM、VMI、NADs、VPCs、Subnets、Volumes
 * 2. [数据合并]: 将 VMI 信息合并到 VM 对象中
 * 3. [镜像解析]: 从 VM Annotation 或 PVC Annotation 中解析镜像 ID，并查询镜像详情
 * 4. [资源过滤]: 仅返回 VM 实际使用的资源（卷、网络等）
 *
 * [返回结构]
 * {
 *   vm: VM 对象（包含合并后的 VMI 信息）,
 *   related: {
 *     nads: VM 使用的网络附件定义数组,
 *     vpcs: VM 使用的 VPC 数组,
 *     subnets: VM 使用的子网数组,
 *     volumes: VM 使用的 PVC 数组,
 *     images: VM 使用的镜像数组（通常只有一个）
 *   }
 * }
 *
 * [网络资源过滤逻辑]
 * 1. 从 VM Spec 中提取 networks 配置
 * 2. 解析 networkName（支持 ns/name 或 name 格式）
 * 3. 匹配 NADs（根据命名空间和名称）
 * 4. 从匹配的 NADs 中提取 Kube-OVN 配置，获取 Subnet 名称
 * 5. 根据 Subnet 名称查找 Subnets
 * 6. 从 Subnets 中提取 VPC 名称，查找 VPCs
 *
 * @param params Harvester 连接参数
 * @param namespace 虚拟机命名空间
 * @param name 虚拟机名称
 * @returns 聚合后的 VM 信息对象
 */
export const getHarvesterVMAggregated = async (
  params: HarvesterTestParams,
  namespace: string,
  name: string,
) => {
  // 1. Parallel Fetch: VM Detail + Global/Namespaced Resources
  // We fetch VM first to ensure it exists, but we can also do it in parallel to save time.
  // If VM fetch fails, the whole request fails, which is expected.

  const vmPromise = getHarvesterVM(params, namespace, name);
  const vmiPromise = getHarvesterVMI(params, namespace, name);
  const nadsPromise = listHarvesterNADsStandard(params);
  const vpcsPromise = listKubeOvnVpcs(params);
  const subnetsPromise = listKubeOvnSubnets(params);
  const volumesPromise = listHarvesterPVCsInNamespace(params, namespace);

  const [vm, vmi, allNads, allVpcs, allSubnets, allVolumes] = await Promise.all([
    vmPromise,
    vmiPromise,
    nadsPromise,
    vpcsPromise,
    subnetsPromise,
    volumesPromise,
  ]);

  if (!vm) {
    throw new Error(`VM ${namespace}/${name} not found`);
  }

  // Attach VMI to VM object for frontend compatibility
  if (vmi) {
    vm.vmi = vmi;
    // Also merge status for robustness
    if (!vm.status) vm.status = {};
    if (vmi.status) {
      // Merge VMI status into VM status, prioritizing VMI (runtime) info
      vm.status = { ...vm.status, ...vmi.status };
    }
  }

  // --- Fetch Related Image (if any) ---
  // VM can be created from an image, which is usually stored in annotation "harvesterhci.io/imageId"
  // format: "namespace/name"
  let relatedImage = null;
  let imageId = vm.metadata?.annotations?.['harvesterhci.io/imageId'];

  // Fallback: If not found on VM, try to find image annotation on associated PVCs
  if (!imageId) {
    // Note: allVolumes contains PVCs in the same namespace.
    // We need to check which volumes are actually used by this VM.
    const vmVolumes = vm.spec?.template?.spec?.volumes || [];
    const claimNames = new Set(
      vmVolumes.map((v: any) => v.persistentVolumeClaim?.claimName).filter((n: any) => n),
    );

    const attachedVolumes = (allVolumes || []).filter((pvc: any) =>
      claimNames.has(pvc?.metadata?.name),
    );

    for (const vol of attachedVolumes) {
      const volImageId = vol.metadata?.annotations?.['harvesterhci.io/imageId'];
      if (volImageId) {
        imageId = volImageId;
        break; // Found one, use it
      }
    }
  }

  if (imageId) {
    // 1. Try to split by '/' directly
    const parts = imageId.split('/');
    if (parts.length === 2) {
      try {
        relatedImage = await getHarvesterImage(params, parts[0], parts[1]);
      } catch (e) {
        console.warn(`[Harvester-Aggregated] Failed to fetch related image ${imageId}:`, e);
      }
    } else {
      // 2. Try to handle case where namespace is not present, assume same namespace as VM
      try {
        relatedImage = await getHarvesterImage(params, namespace, imageId);
      } catch (e) {
        console.warn(
          `[Harvester-Aggregated] Failed to fetch related image ${imageId} (assumed ns=${namespace}):`,
          e,
        );
      }
    }
  }

  // --- Filter Resources to reduce payload size ---

  // 1. Filter Volumes (PVCs)
  const vmVolumes = vm.spec?.template?.spec?.volumes || [];
  const claimNames = new Set(
    vmVolumes.map((v: any) => v.persistentVolumeClaim?.claimName).filter((n: any) => n),
  );

  const relatedVolumes = (allVolumes || []).filter((pvc: any) =>
    claimNames.has(pvc?.metadata?.name),
  );

  // 2. Filter Networks (NADs -> Subnets -> VPCs)
  const vmNetworks = vm.spec?.template?.spec?.networks || [];
  const networkNames = vmNetworks
    .map((n: any) => n.multus?.networkName)
    .filter((n: any) => n && n !== 'Management Network'); // 'Management Network' implies pod network (no NAD)

  // Helper to match NAD based on networkName string (ns/name or name)
  const relatedNads = (allNads || []).filter((nad: any) => {
    const nadName = nad.metadata.name;
    const nadNs = nad.metadata.namespace;

    return networkNames.some((netName: string) => {
      const parts = netName.split('/');
      const targetNs = parts.length > 1 ? parts[0] : namespace;
      const targetName = parts.length > 1 ? parts[1] : parts[0];
      return nadName === targetName && nadNs === targetNs;
    });
  });

  // 3. Filter Subnets (referenced by matched NADs)
  // Logic: For Kube-OVN, Subnet name is typically the same as NAD name (targetName)
  const relatedSubnetNames = new Set<string>();

  relatedNads.forEach((nad: any) => {
    try {
      const config = JSON.parse(nad.spec?.config || '{}');
      const plugins = config.plugins || [config];
      // Check if it involves Kube-OVN
      const isKubeOvn =
        plugins.some((p: any) => p.type === 'kube-ovn') || config.type === 'kube-ovn';

      if (isKubeOvn) {
        relatedSubnetNames.add(nad.metadata.name);
      }
    } catch (e) {}
  });

  // Also checking if 'targetName' matches any subnet directly (fallback logic in frontend)
  // "const subnet = subnets.find((s: any) => s.metadata?.name === targetName);"
  // So we should also add the targetName from networkNames to the potential subnet list
  networkNames.forEach((netName: string) => {
    const parts = netName.split('/');
    const targetName = parts.length > 1 ? parts[1] : parts[0];
    relatedSubnetNames.add(targetName);
  });

  const relatedSubnets = (allSubnets || []).filter((s: any) =>
    relatedSubnetNames.has(s.metadata.name),
  );

  // 4. Filter VPCs (referenced by matched Subnets)
  const relatedVpcNames = new Set<string>();
  relatedSubnets.forEach((s: any) => {
    const vpc = s.spec?.vpc || s.vpc;
    if (vpc) relatedVpcNames.add(vpc);
  });

  const relatedVpcs = (allVpcs || []).filter((v: any) => relatedVpcNames.has(v.metadata.name));

  return {
    vm,
    related: {
      nads: relatedNads,
      vpcs: relatedVpcs,
      subnets: relatedSubnets,
      volumes: relatedVolumes,
      images: relatedImage ? [relatedImage] : [],
    },
  };
};
