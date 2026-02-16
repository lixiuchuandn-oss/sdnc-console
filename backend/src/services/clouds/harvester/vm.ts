import { HarvesterTestParams } from './types';
import { getJsonOnce, requestJson, requestOnce } from './utils';
import { createHarvesterSecret, createHarvesterPVCVolume, deleteHarvesterPVC, updatePVCSpec } from './storage';

// ==================================================================================
// VM List (Direct API - Auto Discovery)
// ==================================================================================
/**
 * 获取 KubeVirt 虚拟机原始列表（VirtualMachine）
 * 直接访问 KubeVirt / Harvester API，返回未加工的原始 VM 对象数组
 * - 优先走标准 KubeVirt API
 * - 若失败则回退到 Harvester/Steve API（带有 links/actions）
 * @param endpoint Harvester 接入地址
 * @param token 访问 Harvester 的 Token
 * @param insecure 是否忽略 TLS 校验
 */
export const listKubevirtVMsRaw = async ({
  endpoint,
  token,
  insecure = false,
}: HarvesterTestParams): Promise<any[]> => {
  const base = (endpoint || '').replace(/\/+$/, '');
  let origin = base;
  try {
    const u = new URL(base);
    origin = `${u.protocol}//${u.host}`;
  } catch {
    origin = base.replace(/\/v[0-9].*$/, '');
  }

  // Common Kubevirt API paths
  // Use Harvester API strict mode for now to ensure cleaner code structure
  // as requested by user.
  const candidates = [
    `${origin}/apis/kubevirt.io/v1/virtualmachines`,
    `${origin}/v1/harvester/kubevirt.io.virtualmachines`, // Harvester/Steve API (Has links/actions)
  ];

  for (const url of candidates) {
    try {
      const json = await getJsonOnce(url, token, insecure);
      if (json && (Array.isArray(json.items) || Array.isArray(json.data))) {
        const items = json.items || json.data;
        return items;
      }
    } catch (e: any) {
      console.warn(`[Harvester-API] 虚拟机获取失败: 请求地址=${url} 错误=${e.message}`);
      // Continue to next candidate
    }
  }
  
  console.warn(`[Harvester-API] 虚拟机所有地址获取失败或为空`);
  return [];
};

/**
 * 获取带元数据的 KubeVirt 虚拟机列表
 * 在原始 VM 列表基础上，补充 resourceVersion 和实际命中的 URL
 * 便于后续基于 RV 做 Watch / SSE 等增量更新
 * @param endpoint Harvester 接入地址
 * @param token 访问 Harvester 的 Token
 * @param insecure 是否忽略 TLS 校验
 * @returns 若成功返回 { items, resourceVersion, url }，否则返回 null
 */
export const listKubevirtVMsRawWithMeta = async ({
  endpoint,
  token,
  insecure = false,
}: HarvesterTestParams): Promise<{ items: any[]; resourceVersion: string; url: string } | null> => {
  const base = (endpoint || '').replace(/\/+$/, '');
  let origin = base;
  try {
    const u = new URL(base);
    origin = `${u.protocol}//${u.host}`;
  } catch {
    origin = base.replace(/\/v[0-9].*$/, '');
  }

  const candidates = [
    `${origin}/apis/kubevirt.io/v1/virtualmachines`,
    `${origin}/v1/harvester/kubevirt.io.virtualmachines`, // Harvester/Steve API (Has links/actions)
  ];

  for (const url of candidates) {
    try {
      const json = await getJsonOnce(url, token, insecure);
      if (json && (Array.isArray(json.items) || Array.isArray(json.data))) {
        return {
          items: json.items || json.data,
          resourceVersion: json.metadata?.resourceVersion || json.resourceVersion || '',
          url
        };
      }
    } catch (e: any) {
      // Continue
    }
  }
  return null;
};

// ==================================================================================
// VMI List (Direct API - Auto Discovery)
// ==================================================================================
/**
 * 获取 KubeVirt 虚拟机实例列表（VirtualMachineInstance）
 * 用于获取实时运行状态（节点、网卡 IP、Phase 等）
 * @param endpoint Harvester 接入地址
 * @param token 访问 Harvester 的 Token
 * @param insecure 是否忽略 TLS 校验
 * @returns 原始 VMI 对象数组
 */
export const listKubevirtVMIsRaw = async ({
  endpoint,
  token,
  insecure = false,
}: HarvesterTestParams): Promise<any[]> => {
  const base = (endpoint || '').replace(/\/+$/, '');
  let origin = base;
  try {
    const u = new URL(base);
    origin = `${u.protocol}//${u.host}`;
  } catch {
    origin = base.replace(/\/v[0-9].*$/, '');
  }

  const candidates = [
    `${origin}/apis/kubevirt.io/v1/virtualmachineinstances`,
    `${origin}/v1/harvester/kubevirt.io.virtualmachineinstances`,
  ];

  for (const url of candidates) {
    try {
      const json = await getJsonOnce(url, token, insecure);
      if (json && Array.isArray(json.items)) return json.items;
      if (json && Array.isArray(json.data)) return json.data;
    } catch (e: any) {
      // Continue
    }
  }
  console.warn(`[Harvester-API] 虚拟机实例所有地址获取失败或为空`);
  return [];
};

/**
 * 获取带元数据的 KubeVirt 虚拟机实例列表
 * 在 VMI 列表基础上返回 resourceVersion 和命中的 URL
 * @param endpoint Harvester 接入地址
 * @param token 访问 Harvester 的 Token
 * @param insecure 是否忽略 TLS 校验
 * @returns 若成功返回 { items, resourceVersion, url }，否则返回 null
 */
export const listKubevirtVMIsRawWithMeta = async ({
  endpoint,
  token,
  insecure = false,
}: HarvesterTestParams): Promise<{ items: any[]; resourceVersion: string; url: string } | null> => {
  const base = (endpoint || '').replace(/\/+$/, '');
  let origin = base;
  try {
    const u = new URL(base);
    origin = `${u.protocol}//${u.host}`;
  } catch {
    origin = base.replace(/\/v[0-9].*$/, '');
  }

  const candidates = [
    `${origin}/apis/kubevirt.io/v1/virtualmachineinstances`,
    `${origin}/v1/harvester/kubevirt.io.virtualmachineinstances`,
  ];

  for (const url of candidates) {
    try {
      const json = await getJsonOnce(url, token, insecure);
      if (json && (Array.isArray(json.items) || Array.isArray(json.data))) {
        return {
          items: json.items || json.data,
          resourceVersion: json.metadata?.resourceVersion || json.resourceVersion || '',
          url
        };
      }
    } catch (e: any) {
      // Continue
    }
  }
  return null;
};

// ==================================================================================
// Legacy / Standard Functions (Maintained for compatibility if needed, but simplified)
// ==================================================================================

/**
 * 获取 Harvester 标准化虚拟机列表
 * 基于 KubeVirt VM + VMI 原始列表做一次聚合和字段整理：
 * - 合并 VM 与 VMI 的网络/IP/节点等实时信息
 * - 提供兼容旧版 Cloud VM 列表的字段（InstanceId / Status 等）
 * - 补充 view 链接，便于前端跳转到 Harvester 原生详情
 * @param endpoint Harvester 接入地址
 * @param token 访问 Harvester 的 Token
 * @param insecure 是否忽略 TLS 校验
 * @returns 标准化后的 VM 列表
 */
export const listHarvesterVMsStandard = async ({
  endpoint,
  token,
  insecure = false,
}: HarvesterTestParams): Promise<any[]> => {
  const base = (endpoint || '').replace(/\/+$/, '');
  let origin = base;
  try {
    const u = new URL(base);
    origin = `${u.protocol}//${u.host}`;
  } catch {
    origin = base.replace(/\/v[0-9].*$/, '');
  }

  // Reuse the raw functions for VM/VMI to ensure consistency with user request
  const [vms, vmis] = await Promise.all([
    listKubevirtVMsRaw({ endpoint, token, insecure }),
    listKubevirtVMIsRaw({ endpoint, token, insecure }),
  ]);

  const vmiMap = new Map<string, any>();
  for (const vmi of vmis) {
    const nm = vmi?.metadata?.name || vmi?.name || '';
    const ns = vmi?.metadata?.namespace || vmi?.namespace || '';
    const key = ns && nm ? `${ns}/${nm}` : vmi?.metadata?.uid || '';
    if (key) vmiMap.set(key, vmi);
  }

  // Simplified mapping (stripping complex logic if possible, but basic fields are needed)
  return vms.map((vm: any) => {
    const name = vm?.metadata?.name || vm?.name || '';
    const namespace = vm?.metadata?.namespace || vm?.namespace || '';
    const uid = vm?.metadata?.uid || vm?.id || name;
    const vmi = vmiMap.get(namespace && name ? `${namespace}/${name}` : uid);
    
    // Simple Status
    const status = vm?.status?.printableStatus || vm?.status?.phase || 'Unknown';
    
    // IP/Mac resolution (Merge VM Status & VMI Status)
    const ips: string[] = [];
    const macs: string[] = [];
    const addIp = (s: any) => {
      const v = String(s || '').trim();
      if (v && !ips.includes(v)) ips.push(v);
    };
    
    // From VM status
    if (vm?.status?.vmIp) addIp(vm.status.vmIp);
    if (Array.isArray(vm?.status?.interfaces)) {
      vm.status.interfaces.forEach((i: any) => {
        addIp(i.ipAddress || i.ip);
        if (i.mac || i.macAddress) macs.push(i.mac || i.macAddress);
      });
    }
    // From VMI status (More real-time)
    if (vmi) {
      if (Array.isArray(vmi.status?.interfaces)) {
        vmi.status.interfaces.forEach((i: any) => {
          if (i.ipAddress || i.ip) addIp(i.ipAddress || i.ip);
          if (i.mac || i.macAddress) macs.push(i.mac || i.macAddress);
        });
      }
    }

    // Node
    const nodeName = vm?.status?.nodeName || vmi?.status?.nodeName || '';

    // Networks (Parse Multus annotations)
    const networksArr: any[] = Array.isArray(vm?.spec?.template?.spec?.networks)
      ? vm?.spec?.template?.spec?.networks
      : [];
    const networks: string[] = networksArr
      .map((n: any) => n?.multus?.networkName || (n?.name ? String(n.name) : 'pod'))
      .filter((s: string) => !!s);

    // CPU/Memory
    const cpu =
      vm?.spec?.template?.spec?.domain?.cpu?.cores ||
      vm?.spec?.template?.spec?.domain?.cpu?.sockets ||
      undefined;
    const memory =
      vm?.spec?.template?.spec?.domain?.resources?.requests?.memory ||
      vm?.spec?.template?.spec?.domain?.memory?.guest ||
      undefined;

    // Volume Claims (PVCs)
    const volumes = vm?.spec?.template?.spec?.volumes || [];
    const volumeClaims = volumes
      .map((v: any) => v?.persistentVolumeClaim?.claimName)
      .filter((n: string) => !!n);

    const creationTimestamp = vm?.metadata?.creationTimestamp;
    const description = vm?.metadata?.annotations?.description || '';
    const creator = vm?.metadata?.labels?.['harvesterhci.io/creator'] || '';
    const conditions = vm?.status?.conditions || [];

    const viewUrl = `${origin}/apis/kubevirt.io/v1/namespaces/${namespace}/virtualmachines/${name}`;

    return {
      ...vm,
      links: { view: viewUrl },
      id: uid, // Use K8s UID as ID
      name,
      namespace,
      status,
      description,
      creator,
      conditions,
      createdAt: creationTimestamp,
      ips,
      macAddresses: Array.from(new Set(macs)),
      nodeName,
      networks,
      vpcName: networks.find(n => n !== 'pod' && n !== 'default'),
      volumeClaims,
      cpu,
      memoryGb: memory,
      // Include raw VMI if needed
      vmiRaw: vmi,
      
      // Legacy fields for compatibility (if any other consumers exist)
      Uid: uid,
      InstanceId: namespace && name ? `${namespace}/${name}` : uid,
      InstanceName: name,
      Status: status,
      VpcAttributes: {
        PrivateIpAddress: {
          IpAddress: ips,
        },
      },
    };
  });
};

/**
 * 获取单个 Harvester 虚拟机详情
 * 通过多组候选 URL 自动探测：
 * - 直接访问 KubeVirt API
 * - 通过 gateway / k8s.clusters.local 代理访问
 * 任一地址命中即返回对应 VM 对象
 * @param endpoint Harvester 接入地址
 * @param token 访问 Harvester 的 Token
 * @param insecure 是否忽略 TLS 校验
 * @param namespace 命名空间
 * @param name 虚拟机名称
 */
export const getHarvesterVM = async (
  { endpoint, token, insecure = false }: HarvesterTestParams,
  namespace: string,
  name: string,
): Promise<any> => {
  const base = (endpoint || '').replace(/\/+$/, '');
  let origin = base;
  try {
    const u = new URL(base);
    origin = `${u.protocol}//${u.host}`;
  } catch {
    origin = base.replace(/\/v[0-9].*$/, '');
  }

  const candidates = [
    `${origin}/apis/kubevirt.io/v1/namespaces/${encodeURIComponent(namespace)}/virtualmachines/${encodeURIComponent(name)}`,
    `${base}/gateway/apis/kubevirt.io/v1/namespaces/${encodeURIComponent(namespace)}/virtualmachines/${encodeURIComponent(name)}`,
    `${base}/k8s/clusters/local/apis/kubevirt.io/v1/namespaces/${encodeURIComponent(namespace)}/virtualmachines/${encodeURIComponent(name)}`
  ];

  let lastError: any = null;
  for (const url of candidates) {
    try {
      const res = await getJsonOnce(url, token, insecure);
      if (res && (res.metadata?.name || res.name)) {
        return res;
      }
    } catch (e: any) {
      lastError = e;
    }
  }
  
  if (lastError) throw lastError;
  throw new Error(`VM ${namespace}/${name} not found in any candidate paths`);
};

/**
 * 创建 Harvester 虚拟机
 * - 直接向 KubeVirt VirtualMachine API 提交 VM 对象
 * - 若检测到内联 cloudInitNoCloud（userData/networkData），自动：
 *   1. 生成一个 CloudInit Secret（Base64 编码）
 *   2. 将 VM Volume 改为通过 secretRef 引用该 Secret
 *   3. 创建 Secret 并通过 ownerReferences 绑定到 VM
 * 这样既兼容 Harvester UI，又避免内联大字段导致的请求体过大
 * @param endpoint Harvester 接入地址
 * @param token 访问 Harvester 的 Token
 * @param insecure 是否忽略 TLS 校验
 * @param namespace 命名空间
 * @param payload 完整 VM Spec（可能包含 cloudInit 相关字段）
 */
export const createHarvesterVM = async (
  { endpoint, token, insecure = false }: HarvesterTestParams,
  namespace: string,
  payload: any,
): Promise<any> => {
  const base = (endpoint || '').replace(/\/+$/, '');
  let origin = base;
  try {
    const u = new URL(base);
    origin = `${u.protocol}//${u.host}`;
  } catch {
    origin = base.replace(/\/v[0-9].*$/, '');
  }
  const url = `${origin}/apis/kubevirt.io/v1/namespaces/${encodeURIComponent(namespace)}/virtualmachines`;

  // --- CloudInit Secret Handling ---
  // If the payload contains inline cloudInitNoCloud data (userData/networkData),
  // we extract it, convert it to a Secret, and link it.
  let cloudInitSecret: any = null;
  
  // Clone payload to avoid side effects
  const vmPayload = JSON.parse(JSON.stringify(payload));
  const vmName = vmPayload.metadata?.name;

  if (vmName && vmPayload.spec?.template?.spec?.volumes) {
    const volumes = vmPayload.spec.template.spec.volumes;
    const ciVolIndex = volumes.findIndex((v: any) => v.cloudInitNoCloud);
    
    if (ciVolIndex >= 0) {
      const ciVol = volumes[ciVolIndex];
      const ciConfig = ciVol.cloudInitNoCloud;
      
      // Check for inline data or custom top-level fields
      // Note: Harvester/Kubevirt prefers Secrets for CloudInit to support networkData and large userData
      const userData = ciConfig.userData || vmPayload.userData;
      const networkData = ciConfig.networkData || vmPayload.networkData;
      
      // Only proceed if we have data and it's NOT already a secretRef
      if ((userData || networkData) && !ciConfig.secretRef) {
         const secretName = `${vmName}-${Math.random().toString(36).substring(2, 7)}-cloudinit`;
         
         // Prepare Secret Data (Base64)
         const data: any = {};
         if (userData) {
             data.userdata = Buffer.from(userData).toString('base64');
         }
         if (networkData) {
             data.networkdata = Buffer.from(networkData).toString('base64');
         }
         
         // Update VM Payload to use SecretRef
         volumes[ciVolIndex] = {
             name: ciVol.name,
             cloudInitNoCloud: {
                 secretRef: { name: secretName }
             }
         };
         
         // Prepare Secret Object
         cloudInitSecret = {
             apiVersion: 'v1',
             kind: 'Secret',
             metadata: {
                 name: secretName,
                 namespace,
                 labels: {
                     "harvesterhci.io/cloud-init-template": "harvester"
                 }
             },
             type: "Opaque",
             data
         };
         
         // Clean up custom/inline fields
         delete ciConfig.userData;
         delete ciConfig.networkData;
         delete vmPayload.userData;
         delete vmPayload.networkData;
      }
    }
  }

  // 1. Create VM
  const vm = await requestJson('POST', url, token, insecure, vmPayload);

  // 2. Create Secret (if needed) and link OwnerReference
  if (cloudInitSecret && vm?.metadata?.uid) {
      cloudInitSecret.metadata.ownerReferences = [{
          apiVersion: vm.apiVersion || "kubevirt.io/v1",
          kind: vm.kind || "VirtualMachine",
          name: vm.metadata.name,
          uid: vm.metadata.uid,
          blockOwnerDeletion: true
      }];
      
      try {
          await createHarvesterSecret({ endpoint, token, insecure }, namespace, cloudInitSecret);
      } catch (e: any) {
          console.error(`[Harvester] Failed to create CloudInit secret for VM ${vmName}:`, e);
          // Optional: We could try to delete the VM if secret creation fails, but that might be aggressive.
          // For now, we log the error. The VM will likely fail to start (Volume mismatch).
      }
  }

  return vm;
};

/**
 * 更新 Harvester 虚拟机规格（Spec）
 * 支持两类能力：
 * 1）简单规格变更走「最小 PATCH」：
 *    - 仅修改 CPU/内存/RunStrategy/HotPlug 等基础字段
 *    - 拼装极小的 merge-patch 以避免大 Spec 导致 ECONNRESET
 * 2）复杂变更走「读当前 -> 深拷贝 -> 合并 -> PATCH」：
 *    - 支持 CloudInit Secret 更新（userData/networkData）
 *    - 支持重装系统盘（更换镜像 + 新建 PVC + 更新 volumeClaimTemplates 注解）
 *    - 支持仅扩容系统盘（Resize PVC + 同步 VM 注解）
 *    - 支持 GPU / 网络 / 接口 等高级字段修改
 * @param endpoint Harvester 接入地址
 * @param token 访问 Harvester 的 Token
 * @param insecure 是否忽略 TLS 校验
 * @param namespace 命名空间
 * @param name 虚拟机名称
 * @param spec 变更请求体（由上层服务构造）
 */
export const updateHarvesterVMSpec = async (
  { endpoint, token, insecure = false }: HarvesterTestParams,
  namespace: string,
  name: string,
  spec: any,
): Promise<any> => {
  const base = (endpoint || '').replace(/\/+$/, '');
  let origin = base;
  try {
    const u = new URL(base);
    origin = `${u.protocol}//${u.host}`;
  } catch {
    origin = base.replace(/\/v[0-9].*$/, '');
  }
  // Fetch current to get resourceVersion
  const current = await getHarvesterVM({ endpoint, token, insecure }, namespace, name);

  // Optimization: Use Minimal Patch for simple CPU/Memory/HotPlug updates to avoid ECONNRESET issues with large payloads
  // We check if the request ONLY contains simple spec fields and NO complex operations (arrays, disks, gpu, etc.)
  const simpleFields = ['cpu', 'memory', 'enableHotPlug', 'cpuSockets', 'cpuCores', 'cpuThreads', 'dedicatedCPUPlacement', 'cpuRequest', 'cpuLimit', 'memoryLimit', 'runStrategy'];
  const hasComplexFields = Object.keys(spec).some(k => !simpleFields.includes(k));
  
  if (!hasComplexFields) {
      const patch: any = { spec: { template: { spec: { domain: {} } } } };
      const domain = patch.spec.template.spec.domain;
      
      const ensureResources = () => {
          if (!domain.resources) domain.resources = {};
          if (!domain.resources.requests) domain.resources.requests = {};
          if (!domain.resources.limits) domain.resources.limits = {};
      };
      const ensureCpu = () => {
          if (!domain.cpu) domain.cpu = {};
      };

      // 1. Simple CPU
      if (spec.cpu !== undefined) {
          ensureResources();
          domain.resources.requests.cpu = String(spec.cpu);
          ensureCpu();
          domain.cpu.sockets = 1;
          domain.cpu.cores = Number(spec.cpu);
          domain.cpu.threads = 1;
      }

      // 1.1 HotPlug
      if (spec.enableHotPlug !== undefined) {
          ensureCpu();
          if (spec.enableHotPlug) {
              domain.cpu.maxSockets = 128;
          } else {
              // For merge-patch, null deletes the field
              domain.cpu.maxSockets = null;
          }
      }

      // 2. Simple Memory
      if (spec.memory !== undefined) {
          ensureResources();
          domain.resources.requests.memory = spec.memory;
          domain.resources.limits.memory = spec.memory;
      }

      // 3. Advanced CPU
      if (spec.cpuSockets || spec.cpuCores || spec.cpuThreads) {
          ensureCpu();
          if (spec.cpuSockets) domain.cpu.sockets = Number(spec.cpuSockets);
          if (spec.cpuCores) domain.cpu.cores = Number(spec.cpuCores);
          if (spec.cpuThreads) domain.cpu.threads = Number(spec.cpuThreads);
      }
      
      if (spec.dedicatedCPUPlacement !== undefined) {
          ensureCpu();
          if (spec.dedicatedCPUPlacement) {
              domain.cpu.dedicatedCpuPlacement = true;
          } else {
              domain.cpu.dedicatedCpuPlacement = null;
          }
      }
      
      if (spec.cpuRequest !== undefined) {
          ensureResources();
          domain.resources.requests.cpu = String(spec.cpuRequest);
      }
      if (spec.cpuLimit !== undefined) {
          ensureResources();
          domain.resources.limits.cpu = String(spec.cpuLimit);
      }

      // 4. Advanced Memory
      if (spec.memoryLimit !== undefined) {
          ensureResources();
          domain.resources.limits.memory = spec.memoryLimit;
      }
      
      // 5. RunStrategy
      if (spec.runStrategy) {
          patch.spec.runStrategy = spec.runStrategy;
          if (spec.runStrategy !== 'Halted') {
              patch.spec.running = true;
          } else {
              patch.spec.running = false;
          }
      }

      const url = `${origin}/apis/kubevirt.io/v1/namespaces/${encodeURIComponent(namespace)}/virtualmachines/${encodeURIComponent(name)}`;
      // Use minimal patch
      return await requestJson('PATCH', url, token, insecure, patch, {
        'Content-Type': 'application/merge-patch+json',
      });
  }
  
  // Create a deep clone of the current spec to modify
  const newSpec = current.spec ? JSON.parse(JSON.stringify(current.spec)) : {};
  
  // Ensure structure exists
  if (!newSpec.template) newSpec.template = {};
  if (!newSpec.template.spec) newSpec.template.spec = {};
  if (!newSpec.template.spec.domain) newSpec.template.spec.domain = {};
  const domain = newSpec.template.spec.domain;
  
  const ensureResources = () => {
      if (!domain.resources) domain.resources = {};
      if (!domain.resources.requests) domain.resources.requests = {};
      if (!domain.resources.limits) domain.resources.limits = {};
  };
  const ensureCpu = () => {
      if (!domain.cpu) domain.cpu = {};
  };

  // --- CloudInit Secret Handling (NetworkData / UserData Update) ---
  // If the patch spec contains networkData or userData, we need to create/update the CloudInit Secret
  // and update the VM's volume reference.
  if (spec.networkData || spec.userData) {
      const vmName = name;
      const volumes = newSpec.template.spec.volumes || [];
      let ciVolIndex = volumes.findIndex((v: any) => v.cloudInitNoCloud);
      
      // If no CloudInit volume exists, create one
      if (ciVolIndex === -1) {
          ciVolIndex = volumes.length;
          volumes.push({
              name: 'cloudinitdisk',
              cloudInitNoCloud: {}
          });
          // Ensure disk exists for this volume
          if (!domain.devices) domain.devices = {};
          if (!domain.devices.disks) domain.devices.disks = [];
          const disks = domain.devices.disks;
          if (!disks.find((d: any) => d.name === 'cloudinitdisk')) {
              disks.push({
                  name: 'cloudinitdisk',
                  disk: { bus: 'virtio' }
              });
          }
      }
      
      const ciVol = volumes[ciVolIndex];
      // Generate new secret name to ensure update
      const secretName = `${vmName}-${Math.random().toString(36).substring(2, 7)}-cloudinit`;
      
      // Prepare Secret Data
      const data: any = {};
      
      // Inherit existing data if only one field is being updated
      // We need to fetch the existing secret if we want to preserve the *other* field (e.g. update IP but keep UserData)
      // For now, let's assume if the user provides one, they might provide both or we might overwrite.
      // BUT, safely, we should try to read the old secret if it exists.
      // However, reading secrets might require extra permissions or logic.
      // Strategy: If the user provides `networkData`, we use it. If `userData` is provided, use it.
      // If one is missing in the update, we ideally want to keep the old value.
      // To keep it simple and robust:
      // 1. If we have a secretRef, try to read the old secret content?
      //    That's expensive. 
      //    Alternative: The frontend should send BOTH if it wants to preserve BOTH.
      //    Frontend `useVmReconfigure` currently doesn't fetch UserData.
      //    Harvester UI typically re-sends the whole CloudInit config or just updates what changed.
      //    Let's stick to: "Update what is provided". If `networkData` is provided, we write it.
      //    If `userData` is NOT provided, we might lose it if we create a NEW secret.
      //    
      //    CRITICAL: If we replace the secretRef, we MUST ensure the new secret has all necessary data.
      //    If we can't read the old secret, we risk data loss (e.g. SSH keys in UserData).
      //    
      //    Solution: The frontend should be responsible for providing the FULL CloudInit data if it wants to replace it.
      //    OR, we implement a "Fetch old secret" logic here.
      //    Given this is a backend service, we CAN fetch the secret.
      
      let oldUserData = '';
      let oldNetworkData = '';
      
      if (ciVol.cloudInitNoCloud?.secretRef?.name) {
          try {
              const oldSecretName = ciVol.cloudInitNoCloud.secretRef.name;
              // Fetch old secret
               const oldSecret = await requestJson(
                  'GET', 
                  `${origin}/api/v1/namespaces/${encodeURIComponent(namespace)}/secrets/${encodeURIComponent(oldSecretName)}`, 
                  token, 
                  insecure
               );
               if (oldSecret && oldSecret.data) {
                   if (oldSecret.data.userdata) oldUserData = Buffer.from(oldSecret.data.userdata, 'base64').toString();
                   if (oldSecret.data.networkdata) oldNetworkData = Buffer.from(oldSecret.data.networkdata, 'base64').toString();
               }
          } catch (e) {
              console.warn(`[UpdateVM] Failed to fetch old CloudInit secret: ${e}`);
          }
      } else if (ciVol.cloudInitNoCloud?.userData) {
          oldUserData = ciVol.cloudInitNoCloud.userData;
      } else if (ciVol.cloudInitNoCloud?.networkData) {
          oldNetworkData = ciVol.cloudInitNoCloud.networkData;
      }

      // Merge new data
      const finalUserData = spec.userData !== undefined ? spec.userData : oldUserData;
      const finalNetworkData = spec.networkData !== undefined ? spec.networkData : oldNetworkData;

      if (finalUserData) data.userdata = Buffer.from(finalUserData).toString('base64');
      if (finalNetworkData) data.networkdata = Buffer.from(finalNetworkData).toString('base64');
      
      const cloudInitSecret = {
          apiVersion: 'v1',
          kind: 'Secret',
          metadata: {
              name: secretName,
              namespace,
              labels: { "harvesterhci.io/cloud-init-template": "harvester" }
          },
          type: "Opaque",
          data
      };
      
      // Create Secret
      await createHarvesterSecret({ endpoint, token, insecure }, namespace, cloudInitSecret);
      
      // Update VM Volume to point to new secret
      volumes[ciVolIndex] = {
          name: ciVol.name,
          cloudInitNoCloud: {
              secretRef: { name: secretName }
          }
      };
      
      newSpec.template.spec.volumes = volumes;
      
      // Cleanup spec
      delete spec.networkData;
      delete spec.userData;
  }

  // --- 0. Reinstall OS (Change Image) ---
  if (spec.action === 'reinstall') {
      const image = spec.image;
      if (!image) throw new Error('Reinstall requires target image');

      // 1. Identify Root Disk (first disk or bootOrder 1)
      const disks = domain.devices?.disks || [];
      const volumes = newSpec.template.spec.volumes || [];
      let rootDiskName = '';
      
      const bootDisk = disks.find((d: any) => d.bootOrder === 1) || disks.find((d: any) => d.name === 'disk-0') || disks[0];
      if (bootDisk) {
          rootDiskName = bootDisk.name;
      }

      if (!rootDiskName) throw new Error('Cannot identify root disk for reinstall');

      // 2. Create NEW PVC
      const newPvcName = `${name}-disk-0-${Math.random().toString(36).substring(2, 7)}`;
      console.log(`[Reinstall] Creating new root PVC: ${newPvcName} for VM ${namespace}/${name} using image ${image}`);
      
      await createHarvesterPVCVolume({ endpoint, token, insecure }, {
          namespace,
          name: newPvcName,
          size: spec.rootSize || '40Gi',
          storageClassName: spec.storageClassName,
          volumeMode: 'Block',
          annotations: {
              'harvesterhci.io/imageId': image
          }
      });

      // 3. Update VM Spec to point to new PVC
      const volIndex = volumes.findIndex((v: any) => v.name === rootDiskName);
      let oldPvcName = '';
      if (volIndex !== -1) {
          oldPvcName = volumes[volIndex].persistentVolumeClaim?.claimName;
          volumes[volIndex] = {
              name: rootDiskName,
              persistentVolumeClaim: {
                  claimName: newPvcName
              }
          };
      } else {
           throw new Error(`Volume definition for disk ${rootDiskName} not found`);
      }
      
      // Update bus and device type if requested
      if (spec.bus || spec.rootDeviceType) {
           const dIndex = disks.findIndex((d: any) => d.name === rootDiskName);
           if (dIndex !== -1) {
               const currentBus = disks[dIndex].disk?.bus || disks[dIndex].cdrom?.bus || 'virtio';
               const newBus = spec.bus || currentBus;
               
               // Handle Device Type Switching (disk <-> cdrom)
               if (spec.rootDeviceType === 'cdrom') {
                   disks[dIndex].cdrom = { bus: newBus };
                   delete disks[dIndex].disk;
               } else if (spec.rootDeviceType === 'disk') {
                   disks[dIndex].disk = { bus: newBus };
                   delete disks[dIndex].cdrom;
               } else {
                   // Just update bus on existing type
                   if (disks[dIndex].disk) disks[dIndex].disk.bus = newBus;
                   if (disks[dIndex].cdrom) disks[dIndex].cdrom.bus = newBus;
               }
           }
      }

      // 4. Update VM Template Annotation (Source of Truth for Image Display)
      // We MUST update both VM-level metadata (for list display) and Template-level metadata (for consistency)
      // And importantly, update 'harvesterhci.io/volumeClaimTemplates' to reflect new root disk size/image
      if (!newSpec.metadata) newSpec.metadata = {};
      if (!newSpec.metadata.annotations) newSpec.metadata.annotations = {};
      if (!newSpec.template.metadata) newSpec.template.metadata = {};
      if (!newSpec.template.metadata.annotations) newSpec.template.metadata.annotations = {};
      
      // Update imageId annotations
      newSpec.metadata.annotations['harvesterhci.io/imageId'] = image;
      newSpec.template.metadata.annotations['harvesterhci.io/imageId'] = image;

      // Update volumeClaimTemplates to reflect new PVC config (Size, Image, StorageClass)
      // This is crucial for UI to display correct "Image Size" in list view
      try {
        const vctStr = newSpec.metadata.annotations['harvesterhci.io/volumeClaimTemplates'];
        let vct = [];
        if (vctStr) {
           try { vct = JSON.parse(vctStr); } catch {}
        }
        
        // Construct new template for root disk
        const newRootTemplate = {
            metadata: {
                name: newPvcName,
                annotations: {
                    "harvesterhci.io/imageId": image
                }
            },
            spec: {
                accessModes: ["ReadWriteMany"],
                resources: {
                    requests: {
                        storage: spec.rootSize || '40Gi'
                    }
                },
                volumeMode: "Block",
                storageClassName: spec.storageClassName
            }
        };

        if (Array.isArray(vct)) {
            // Remove old root disk template (identify by old PVC name or simply reset if it's the only one)
            // Strategy: Filter out the old PVC name if we found it, then append new one
            if (oldPvcName) {
                vct = vct.filter((t: any) => t?.metadata?.name !== oldPvcName);
            }
            // Also filter out any template that looks like a root disk (has imageId) to be safe? 
            // No, user might have multiple disks with images. Better stick to PVC name replacement.
            
            // Add new template
            vct.push(newRootTemplate);
            
            // Write back to annotation
            newSpec.metadata.annotations['harvesterhci.io/volumeClaimTemplates'] = JSON.stringify(vct);
        } else {
            // Initialize if empty
            newSpec.metadata.annotations['harvesterhci.io/volumeClaimTemplates'] = JSON.stringify([newRootTemplate]);
        }
      } catch (e) {
        console.warn('Failed to update volumeClaimTemplates annotation during reinstall', e);
      }

      // 5. Delete Old PVC
      if (oldPvcName) {
           // We do NOT delete the old PVC here immediately.
           // Harvester/Kubevirt might need it during termination or it might be handled by ownerReferences.
           // However, for "Reinstall" semantics (replace disk), we usually want to clean up.
           // BUT: If the user wants to keep data, this is dangerous. 
           // Current logic: We detach it (remove from volumes) and user loses reference to it in VM.
           // If we want to strictly follow "Reinstall = Wipe System Disk", we should delete it.
           // Let's keep existing logic: delete it.
           console.log(`[Reinstall] Scheduling deletion of old root PVC: ${oldPvcName}`);
           // Fire and forget, or at least don't block main flow if deletion is slow
           deleteHarvesterPVC({ endpoint, token, insecure }, namespace, oldPvcName)
               .then(() => console.log(`[Reinstall] Successfully deleted old PVC: ${oldPvcName}`))
               .catch((err: any) => console.warn(`[Reinstall] Failed to delete old PVC ${oldPvcName}:`, err.message || err));
      }
  } 
  // --- 0.1 Resize Root Disk (Without Reinstall) ---
  else if (spec.rootSize && spec.action !== 'reinstall') {
      const disks = domain.devices?.disks || [];
      const volumes = newSpec.template.spec.volumes || [];
      let rootDiskName = '';
      
      // Identify root disk
      const validDisks = disks.filter((d: any) => d.disk);
      const bootDisk = validDisks.find((d: any) => d.bootOrder === 1) || validDisks.find((d: any) => d.name === 'disk-0') || validDisks[0];
      if (bootDisk) {
          rootDiskName = bootDisk.name;
      }
      
      if (rootDiskName) {
          const volIndex = volumes.findIndex((v: any) => v.name === rootDiskName);
          if (volIndex !== -1) {
              const pvcName = volumes[volIndex].persistentVolumeClaim?.claimName;
              if (pvcName) {
                  console.log(`[Resize] Resizing root PVC: ${pvcName} for VM ${namespace}/${name} to ${spec.rootSize}`);
                  // 1. Resize PVC
                  await updatePVCSpec(
                      { endpoint, token, insecure },
                      namespace,
                      pvcName,
                      { size: spec.rootSize }
                  );
                  
                  // 2. Sync VM Annotation (volumeClaimTemplates)
                  await syncVmVolumeSize(
                      { endpoint, token, insecure },
                      namespace,
                      name,
                      pvcName,
                      spec.rootSize
                  );
              }
          }
      }
  }

  // --- 1. Simple CPU/Memory Change ---
  if (spec.cpu !== undefined) {
      ensureResources();
      domain.resources.requests.cpu = String(spec.cpu);
      // Default topology for simple mode to avoid mismatch
      ensureCpu();
      domain.cpu.sockets = 1;
      domain.cpu.cores = Number(spec.cpu);
      domain.cpu.threads = 1;
  }
  
  // --- 1.1 HotPlug Configuration ---
  if (spec.enableHotPlug !== undefined) {
      ensureCpu();
      if (spec.enableHotPlug) {
          // Enable HotPlug by setting maxSockets > sockets
          // We use 128 to allow significant expansion
          domain.cpu.maxSockets = 128;
      } else {
          // Disable HotPlug
          delete domain.cpu.maxSockets;
      }
  }
  
  if (spec.memory !== undefined) {
      ensureResources();
      domain.resources.requests.memory = spec.memory;
      domain.resources.limits.memory = spec.memory;
  }

  // --- 2. Advanced CPU ---
  if (spec.cpuSockets || spec.cpuCores || spec.cpuThreads) {
      ensureCpu();
      if (spec.cpuSockets) domain.cpu.sockets = Number(spec.cpuSockets);
      if (spec.cpuCores) domain.cpu.cores = Number(spec.cpuCores);
      if (spec.cpuThreads) domain.cpu.threads = Number(spec.cpuThreads);
  }
  
  if (spec.dedicatedCPUPlacement !== undefined) {
      ensureCpu();
      if (spec.dedicatedCPUPlacement) {
          domain.cpu.dedicatedCpuPlacement = true;
      } else {
          delete domain.cpu.dedicatedCpuPlacement;
      }
  }
  
  if (spec.cpuRequest !== undefined) {
      ensureResources();
      domain.resources.requests.cpu = String(spec.cpuRequest);
  }
  
  if (spec.cpuLimit !== undefined) {
      ensureResources();
      domain.resources.limits.cpu = String(spec.cpuLimit);
  }
  
  // --- 3. Advanced Memory ---
  if (spec.memoryLimit !== undefined) {
      ensureResources();
      domain.resources.limits.memory = spec.memoryLimit;
  }

  // --- 4. GPU ---
  if (spec.gpuResourceName !== undefined) {
      if (!domain.devices) domain.devices = {};
      // If resourceName is empty, remove GPU
      if (!spec.gpuResourceName) {
          delete domain.devices.gpus;
      } else {
          domain.devices.gpus = [
              {
                  name: 'gpu-1',
                  deviceName: spec.gpuResourceName
              }
          ];
      }
  }

  // --- 5. Networks & Interfaces (Patch Support) ---
  if (spec.networks !== undefined) {
      newSpec.template.spec.networks = spec.networks;
  }
  if (spec.interfaces !== undefined) {
      if (!domain.devices) domain.devices = {};
      domain.devices.interfaces = spec.interfaces;
  }

  const body = {
    metadata: newSpec.metadata,
    spec: newSpec,
  };
  const url = `${origin}/apis/kubevirt.io/v1/namespaces/${encodeURIComponent(namespace)}/virtualmachines/${encodeURIComponent(name)}`;
  return await requestJson('PATCH', url, token, insecure, body, {
    'Content-Type': 'application/merge-patch+json',
  });
};

/**
 * 获取 Harvester 虚拟机 VNC 访问 URL
 * 直接拼接 KubeVirt Subresource vnc 地址，供前端透传给 WebSocket 代理
 * @param endpoint Harvester 接入地址
 * @param token 访问 Harvester 的 Token
 * @param insecure 是否忽略 TLS 校验
 * @param namespace 命名空间
 * @param name 虚拟机名称
 * @returns VNC WebSocket 反向代理使用的 URL 字符串
 */
export const getHarvesterVmVncUrl = async (
  { endpoint, token, insecure = false }: HarvesterTestParams,
  namespace: string,
  name: string,
): Promise<string> => {
  const base = (endpoint || '').replace(/\/+$/, '');
  let origin = base;
  try {
    const u = new URL(base);
    origin = `${u.protocol}//${u.host}`;
  } catch {
    origin = base.replace(/\/v[0-9].*$/, '');
  }
  return `${origin}/apis/subresources.kubevirt.io/v1/namespaces/${encodeURIComponent(namespace)}/virtualmachineinstances/${encodeURIComponent(name)}/vnc`;
};

/**
 * 同步 VM volumeClaimTemplates 注解中的磁盘大小
 * 用于在 PVC 已经扩容后，更新 VM 注解中的模板信息：
 * - Harvester UI 镜像列表中的 “Image Size” 实际读取的是注解里的模板规格
 * - 若只扩容 PVC 而不更新注解，重启后 UI 会显示旧容量
 * 支持两种定位方式：
 * 1）直接通过 vmName 获取目标 VM
 * 2）若 vmName 为空，则通过遍历 Namespace 下所有 VM，找到引用该 PVC 的 VM
 * @param endpoint Harvester 接入地址
 * @param token 访问 Harvester 的 Token
 * @param insecure 是否忽略 TLS 校验
 * @param namespace 命名空间
 * @param vmName 虚拟机名称（可为空，为空时通过 PVC 反查）
 * @param pvcName 已扩容的 PVC 名称
 * @param newSize 新的存储规格（例如 '40Gi'）
 */
export const syncVmVolumeSize = async (
  { endpoint, token, insecure = false }: HarvesterTestParams,
  namespace: string,
  vmName: string | null | undefined,
  pvcName: string,
  newSize: string
) => {
  const base = (endpoint || '').replace(/\/+$/, '');
  let origin = base;
  try {
    const u = new URL(base);
    origin = `${u.protocol}//${u.host}`;
  } catch {
    origin = base.replace(/\/v[0-9].*$/, '');
  }
  
  let targetVm: any = null;

  if (vmName) {
      // 1. Get VM by name
      const vmUrl = `${origin}/apis/kubevirt.io/v1/namespaces/${encodeURIComponent(namespace)}/virtualmachines/${encodeURIComponent(vmName)}`;
      try {
        targetVm = await getJsonOnce(vmUrl, token, insecure);
      } catch (e) {
        console.warn(`[SyncVmVolumeSize] Failed to fetch VM ${vmName}`, e);
        return;
      }
  } else {
      // 1. Find VM by PVC
      // We list all VMs in the namespace to find the owner
      // This is expensive but necessary if we don't know the VM name
      try {
          const vms = await listKubevirtVMsRaw({ endpoint, token, insecure });
          targetVm = vms.find((vm: any) => {
            if (vm?.metadata?.namespace !== namespace) return false;
            const volumes = vm?.spec?.template?.spec?.volumes || [];
            return volumes.some((v: any) => v?.persistentVolumeClaim?.claimName === pvcName);
          });
      } catch (e) {
          console.warn(`[SyncVmVolumeSize] Failed to list VMs for discovery`, e);
      }
  }
  
  if (!targetVm) return;
  const targetVmName = targetVm.metadata?.name;

  // 2. Check annotations
  const annotations = targetVm.metadata?.annotations || {};
  const vctStr = annotations['harvesterhci.io/volumeClaimTemplates'];
  if (!vctStr) return;

  let vct: any[] = [];
  try { vct = JSON.parse(vctStr); } catch { return; }
  
  if (!Array.isArray(vct)) return;

  // 3. Find template and update
  // Logic: 
  // 1. Try to match by template name == pvcName (Most common case in Harvester)
  // 2. If not found, try to resolve via spec.template.spec.volumes to find the template name that maps to this PVC claimName
  
  let index = vct.findIndex((t: any) => t?.metadata?.name === pvcName);
  
  if (index === -1) {
      // Fallback: Resolve via volumes
      const volumes = targetVm?.spec?.template?.spec?.volumes || [];
      const volume = volumes.find((v: any) => v?.persistentVolumeClaim?.claimName === pvcName);
      if (volume && volume.name) {
          // In volumeClaimTemplates, the metadata.name IS the volume name
          index = vct.findIndex((t: any) => t?.metadata?.name === volume.name);
          if (index !== -1) {
             console.log(`[SyncVmVolumeSize] Resolved PVC ${pvcName} to template ${volume.name} via volume mapping`);
          }
      }
  }

  if (index === -1) {
      console.warn(`[SyncVmVolumeSize] PVC ${pvcName} not found in VM ${targetVmName} volumeClaimTemplates (Direct or Mapped)`);
      return;
  }

  // Check if update is needed
  const currentReq = vct[index].spec?.resources?.requests?.storage;
  console.log(`[SyncVmVolumeSize] Checking VM ${targetVmName} PVC ${pvcName}. Current: ${currentReq}, New: ${newSize}`);
  
  // Update always to be safe
  if (!vct[index].spec) vct[index].spec = {};
  if (!vct[index].spec.resources) vct[index].spec.resources = {};
  if (!vct[index].spec.resources.requests) vct[index].spec.resources.requests = {};
  vct[index].spec.resources.requests.storage = newSize;

  // 4. Patch VM
  const newAnnotations = { 'harvesterhci.io/volumeClaimTemplates': JSON.stringify(vct) };
  
  const patchBody = {
    metadata: {
      annotations: newAnnotations
    }
  };
  
  const targetVmUrl = `${origin}/apis/kubevirt.io/v1/namespaces/${encodeURIComponent(namespace)}/virtualmachines/${encodeURIComponent(targetVmName)}`;

  try {
    await requestJson('PATCH', targetVmUrl, token, insecure, patchBody, {
      'Content-Type': 'application/merge-patch+json',
    });
    console.log(`[SyncVmVolumeSize] Successfully updated VM ${targetVmName} annotation`);
  } catch (e) {
    console.error(`[SyncVmVolumeSize] Failed to patch VM ${targetVmName}`, e);
  }
};
