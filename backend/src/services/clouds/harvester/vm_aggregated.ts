
import { HarvesterTestParams } from './types';
import { getHarvesterVM, getHarvesterVMI } from './vm';
import {
  listHarvesterNADsStandard,
  listKubeOvnVpcs,
  listKubeOvnSubnets,
} from './network';
import { getHarvesterImage } from './storage';
import { getJsonOnce } from './utils';

/**
 * ==============================================================================
 * 模块名称: Harvester VM 聚合查询服务
 * 文件路径: backend/src/services/clouds/harvester/vm_aggregated.ts
 * ==============================================================================
 * 
 * [功能描述]
 * 提供基于 VM ID (Namespace/Name) 的聚合查询接口，一次性返回 VM 详情及其关联的
 * 核心资源（镜像、卷、网络定义等），解决前端多次分散查询导致的数据不一致和性能问题。
 * 
 * [核心逻辑]
 * 1. [VM 详情]: 获取 VM 的最新状态 (Source of Truth)。
 * 2. [关联资源]:
 *    - NADs/VPCs/Subnets: 获取集群/Namespace 下的网络定义，用于渲染网卡信息。
 *    - Images: 获取所有可用镜像，用于匹配 OS 信息。
 *    - Volumes: 仅获取 VM 所在 Namespace 下的 PVC，避免全量查询。
 * 3. [数据聚合]: 将所有数据打包返回，前端无需再进行多次 API 调用。
 */

/**
 * 获取指定 Namespace 下的 PVC 列表
 */
const listHarvesterPVCsInNamespace = async (
  { endpoint, token, insecure = false }: HarvesterTestParams,
  namespace: string
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
    console.warn(`[Harvester-Aggregated] Failed to list PVCs in namespace ${namespace}: ${e.message}`);
    return [];
  }
};

export const getHarvesterVMAggregated = async (
  params: HarvesterTestParams,
  namespace: string,
  name: string
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
    volumesPromise
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
        vmVolumes
          .map((v: any) => v.persistentVolumeClaim?.claimName)
          .filter((n: any) => n)
      );
      
      const attachedVolumes = (allVolumes || []).filter((pvc: any) => 
        claimNames.has(pvc?.metadata?.name)
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
          } catch(e) {
              console.warn(`[Harvester-Aggregated] Failed to fetch related image ${imageId}:`, e);
          }
      } else {
          // 2. Try to handle case where namespace is not present, assume same namespace as VM
          try {
              relatedImage = await getHarvesterImage(params, namespace, imageId);
          } catch(e) {
              console.warn(`[Harvester-Aggregated] Failed to fetch related image ${imageId} (assumed ns=${namespace}):`, e);
          }
      }
  }

  // --- Filter Resources to reduce payload size ---

  // 1. Filter Volumes (PVCs)
  const vmVolumes = vm.spec?.template?.spec?.volumes || [];
  const claimNames = new Set(
    vmVolumes
      .map((v: any) => v.persistentVolumeClaim?.claimName)
      .filter((n: any) => n)
  );
  
  const relatedVolumes = (allVolumes || []).filter((pvc: any) => 
    claimNames.has(pvc?.metadata?.name)
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
         const isKubeOvn = plugins.some((p: any) => p.type === 'kube-ovn') || config.type === 'kube-ovn';
         
         if (isKubeOvn) {
             relatedSubnetNames.add(nad.metadata.name);
         }
     } catch(e) {}
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
    relatedSubnetNames.has(s.metadata.name)
  );

  // 4. Filter VPCs (referenced by matched Subnets)
  const relatedVpcNames = new Set<string>();
  relatedSubnets.forEach((s: any) => {
      const vpc = s.spec?.vpc || s.vpc;
      if (vpc) relatedVpcNames.add(vpc);
  });

  const relatedVpcs = (allVpcs || []).filter((v: any) => 
    relatedVpcNames.has(v.metadata.name)
  );

  return {
    vm,
    related: {
      nads: relatedNads,
      vpcs: relatedVpcs,
      subnets: relatedSubnets,
      volumes: relatedVolumes,
      images: relatedImage ? [relatedImage] : [],
    }
  };
};
