import { HarvesterTestParams } from './types';
import { getJsonOnce, requestJson, requestOnce } from './utils';
import { getHarvesterSettingValue } from './cluster';
import { createHarvesterSecret, createHarvesterPVCVolume, deleteHarvesterPVC, updatePVCSpec } from './storage';

/**
 * ==============================================================================
 * 服务名称: Harvester 虚拟机服务 (Harvester VM Service)
 * 文件路径: backend/src/services/clouds/harvester/vm.ts
 * ==============================================================================
 * 
 * [功能描述]
 * 提供对 Harvester (KubeVirt) 虚拟机的全生命周期管理能力，包括列表查询、详情获取、
 * 创建、变更规格 (Spec)、电源管理、VNC 访问等核心功能。
 * 它是后端与 Harvester API 交互的主要入口。
 * 
 * [核心逻辑]
 * 1. [数据获取]: 
 *    - 支持通过 KubeVirt 原生 API 和 Harvester Steve API 双路径探测，确保兼容性。
 *    - 提供 Raw (原始) 和 Standard (标准化) 两种数据视图。
 * 
 * 2. [规格变更 (Update Spec)]: 
 *    - [智能分流]: 区分“简单变更”和“复杂变更”。
 *    - [最小 Patch]: 对于仅修改 CPU/内存的请求，构造极简 Patch 包，避免由大 JSON 引起的 ECONNRESET。
 *    - [完整 Patch]: 对于涉及磁盘、网络、CloudInit 的变更，采用“读-改-写”模式。
 * 
 * 3. [高级特性]:
 *    - [热扩容]: 管理 maxSockets/maxGuest 以启用 KubeVirt 热插拔能力。
 *    - [重装系统]: 自动化处理 PVC 创建、Volume 替换、Annotation 更新流程。
 *    - [CloudInit]: 自动提取 userData/networkData 并封装为 Secret，避免内联数据过大。
 * 
 * ------------------------------------------------------------------------------
 * [下游接口调用说明 (Downstream API Reference)]
 * ------------------------------------------------------------------------------
 * 1. 涉及后端接口 (KubeVirt/Harvester):
 *    - GET /apis/kubevirt.io/v1/virtualmachines
 *    - GET /apis/kubevirt.io/v1/virtualmachineinstances
 *    - PATCH /apis/kubevirt.io/v1/namespaces/{ns}/virtualmachines/{name}
 * 
 * 2. 关键依赖:
 *    - storage.ts: 处理 PVC 和 Volume 相关的底层操作。
 *    - utils.ts: 封装 HTTP 请求与错误处理。
 * ==============================================================================
 */

// ==================================================================================
// VM List (Direct API - Auto Discovery)
// ==================================================================================
/**
 * 获取 KubeVirt 虚拟机原始列表 (Raw VM List)
 * 
 * [功能描述]
 * 直接访问 KubeVirt / Harvester API，返回未加工的原始 VirtualMachine 对象数组。
 * 
 * [核心逻辑]
 * 1. [双路径探测]: 
 *    - 优先尝试 KubeVirt 标准 API `/apis/kubevirt.io/v1/virtualmachines`。
 *    - 失败则降级到 Harvester Steve API `/v1/harvester/kubevirt.io.virtualmachines`。
 * 2. [兼容性]: 
 *    - 自动适配不同版本的 Harvester/KubeVirt API 路径差异。
 * 
 * @param params Harvester 连接参数
 * @returns 原始 VM 对象数组
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
 * 获取带元数据的 KubeVirt 虚拟机列表 (Raw VM List with Meta)
 * 
 * [功能描述]
 * 在原始 VM 列表基础上，补充 resourceVersion 和实际命中的 API URL。
 * 
 * [核心逻辑]
 * 1. [用途]: 
 *    - 返回的 resourceVersion 用于后续建立 Watch 连接或 SSE 增量更新。
 *    - 返回的 url 指示了当前成功的 API 路径 (KubeVirt vs Steve)。
 * 
 * @param params Harvester 连接参数
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
 * 获取 KubeVirt 虚拟机实例列表 (Raw VMI List)
 * 
 * [功能描述]
 * 获取 VirtualMachineInstance (VMI) 列表，用于反映虚拟机的实时运行状态。
 * 
 * [核心逻辑]
 * 1. [实时状态]: 
 *    - VMI 对象包含当前所在的 Node、分配的 IP 地址、以及详细的 Phase (Running, Scheduled 等)。
 *    - 与 VM 对象不同，VMI 仅在虚拟机运行时存在。
 * 2. [双路径探测]:
 *    - 同样支持 KubeVirt API 和 Harvester API 两种路径。
 * 
 * @param params Harvester 连接参数
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
 * 获取带元数据的 KubeVirt 虚拟机实例列表 (Raw VMI List with Meta)
 * 
 * [功能描述]
 * 在原始 VMI 列表基础上，补充 resourceVersion 和实际命中的 API URL。
 * 
 * [核心逻辑]
 * 1. [用途]: 
 *    - 返回的 resourceVersion 用于后续建立 Watch 连接或 SSE 增量更新。
 *    - 返回的 url 指示了当前成功的 API 路径 (KubeVirt vs Steve)。
 * 
 * @param params Harvester 连接参数
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
 * 获取标准化 Harvester 虚拟机列表 (Standard VM List)
 * 
 * [功能描述]
 * 在原始 VM 列表基础上，聚合 VMI (Instance) 状态，并转换为前端友好的扁平化结构。
 * 
 * [核心逻辑]
 * 1. [数据聚合]: 
 *    - 并行获取 VM (定义) 和 VMI (运行时实例) 列表。
 *    - 通过 Namespace/Name 将 VMI 的实时状态 (IP, Node, Phase) 合并到 VM 数据中。
 * 2. [状态计算]:
 *    - 优先使用 `printableStatus`，降级使用 `phase`。
 * 3. [网络解析]:
 *    - 解析 Multus CNI 注解，提取多网卡 IP 和 MAC 地址。
 * 
 * @param params Harvester 连接参数
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
 * 获取单个 Harvester 虚拟机详情 (Get VM Detail)
 * 
 * [功能描述]
 * 根据 Namespace 和 Name 获取指定虚拟机的完整定义 (Spec) 和状态 (Status)。
 * 
 * [核心逻辑]
 * 1. [多地址探测]:
 *    - 针对不同网络环境 (直接连接、代理转发)，尝试多组 API URL。
 *    - 只要任一地址成功响应，即返回结果。
 * 2. [错误处理]:
 *    - 自动捕获并忽略 404 以外的网络错误，直到所有候选地址都失败。
 * 
 * @param params Harvester 连接参数
 * @param namespace 命名空间
 * @param name 虚拟机名称
 * @returns 虚拟机完整对象 (VirtualMachine)
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
 * 获取 Harvester 虚拟机实例 (Get VMI)
 * 
 * [功能描述]
 * 获取虚拟机运行时实例 (VirtualMachineInstance)，包含详细的运行时状态（IP、节点、迁移状态等）。
 * 
 * @param params Harvester 连接参数
 * @param namespace 命名空间
 * @param name 虚拟机名称
 * @returns VMI 对象或 null
 */
export const getHarvesterVMI = async (
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

  const url = `${origin}/apis/kubevirt.io/v1/namespaces/${encodeURIComponent(namespace)}/virtualmachineinstances/${encodeURIComponent(name)}`;
  
  try {
    const res = await getJsonOnce(url, token, insecure);
    if (res && (res.metadata?.name || res.name)) {
      return res;
    }
  } catch (e: any) {
    // VMI might not exist if VM is stopped, just return null
    return null;
  }
  return null;
};

/**
 * 创建 Harvester 虚拟机 (Create VM)
 * 
 * [功能描述]
 * 创建新的虚拟机实例，自动处理关联资源的创建与绑定。
 * 
 * [核心逻辑]
 * 1. [CloudInit 自动化]:
 *    - 自动检测 Payload 中的 CloudInit 数据 (UserData/NetworkData)。
 *    - 剥离内联数据，创建独立的 Secret。
 *    - 修改 VM Spec，通过 secretRef 引用该 Secret。
 * 2. [资源绑定]:
 *    - 为创建的 Secret 设置 OwnerReference，确保 VM 删除时自动清理 Secret。
 * 3. [数据清洗]:
 *    - 移除 Payload 中的临时字段，防止 K8s API 报错。
 * 
 * @param params Harvester 连接参数
 * @param namespace 命名空间
 * @param payload 完整 VM Spec (可能包含 cloudInit 相关字段)
 * @returns 创建成功的 VM 对象
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

  // --- [Fix] SSH Key Injection ---
  // Harvester uses a MutatingWebhook to inject SSH keys from spec.sshKeys into CloudInit.
  // However, when using direct Kubevirt API or if the webhook is bypassed/fails, we need to manually inject them.
  // The frontend sends `sshNames` (list of KeyPair names). We fetch them and append to userData.
  if (vmPayload.sshNames && Array.isArray(vmPayload.sshNames) && vmPayload.sshNames.length > 0) {
      try {
          const kpUrl = `${origin}/apis/harvesterhci.io/v1beta1/namespaces/${encodeURIComponent(namespace)}/keypairs`;
          const kpRes = await getJsonOnce(kpUrl, token, insecure);
          const keypairs = kpRes?.items || [];
          
          const publicKeys: string[] = [];
          for (const name of vmPayload.sshNames) {
              const kp = keypairs.find((k: any) => k.metadata.name === name);
              if (kp && kp.spec && kp.spec.publicKey) {
                  publicKeys.push(kp.spec.publicKey);
              }
          }
          
          if (publicKeys.length > 0) {
              let currentUserData = vmPayload.userData || '';
              if (!currentUserData) currentUserData = '#cloud-config\n';
              
              // Robust append: ensure newline before appending keys
              if (!currentUserData.endsWith('\n')) currentUserData += '\n';
              
              const keysBlock = `ssh_authorized_keys:\n${publicKeys.map(k => `  - ${k}`).join('\n')}\n`;
              currentUserData += keysBlock;
              
              vmPayload.userData = currentUserData;
          }
      } catch (e) {
          console.warn(`[Harvester] Failed to inject SSH keys: ${e}`);
      }
      // Cleanup custom field to avoid API error
      delete vmPayload.sshNames;
  }

  // [Feature] 平台托管标记 (Platform Managed)
  // 1. 添加 tower.io/managed Finalizer：防止在 Tower 平台之外（如 Harvester UI）误删。
  //    除非 Tower 主动移除此 Finalizer，否则 K8s 不会物理删除 VM。
  if (!vmPayload.metadata) vmPayload.metadata = {};
  if (!vmPayload.metadata.finalizers) vmPayload.metadata.finalizers = [];
  const managedFinalizer = 'tower.io/managed';
  if (!vmPayload.metadata.finalizers.includes(managedFinalizer)) {
    vmPayload.metadata.finalizers.push(managedFinalizer);
  }

  // 2. 添加 tower.io/creator 标签：标识资源归属
  if (!vmPayload.metadata.labels) vmPayload.metadata.labels = {};
  vmPayload.metadata.labels['tower.io/creator'] = 'compute-tower';

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

  // [Feature] 防删保护再次确认
  // 由于 K8s ValidatingWebhook 可能会清洗非标准 Finalizers，导致创建时的 managedFinalizer 丢失。
  // 因此在创建成功后，再次检查返回对象。如果丢失，则通过 Patch 强行加回。
  const createdFinalizers = vm?.metadata?.finalizers || [];
  if (!createdFinalizers.includes(managedFinalizer)) {
      try {
          const patchUrl = `${url}/${encodeURIComponent(vm.metadata.name)}`;
          // 使用 JSON Patch 添加 finalizer
          const patchBody = [
              {
                  op: createdFinalizers.length > 0 ? "add" : "add", 
                  path: "/metadata/finalizers/-", // append
                  value: managedFinalizer
              }
          ];
          // 如果原 finalizers 为空，路径可能是 "/metadata/finalizers" (需初始化数组) 
          // 但 JSON Patch 的 "-" 语法通常要求数组已存在。
          // 更稳健的方式是使用 Merge Patch (application/merge-patch+json)
          const mergePatchBody = {
              metadata: {
                  finalizers: [...createdFinalizers, managedFinalizer]
              }
          };
          
          await requestJson('PATCH', patchUrl, token, insecure, mergePatchBody, {
              'Content-Type': 'application/merge-patch+json'
          });
          
          // 更新本地 vm 对象以反映变更
          if (!vm.metadata.finalizers) vm.metadata.finalizers = [];
          vm.metadata.finalizers.push(managedFinalizer);
          
      } catch (e: any) {
          console.warn(`[Harvester] Failed to apply managed finalizer for VM ${vmName}:`, e.message);
          // 不阻断创建流程，仅记录警告
      }
  }

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
 * 通用 Patch VM 接口 (JSON Merge Patch / JSON Patch)
 * 
 * [功能描述]
 * 直接对 VM 资源执行 Patch 操作，支持自定义 Payload 和 Content-Type。
 * 用于标签管理、注解更新等非 Spec 变更场景。
 * 
 * [JSON Patch 推荐]
 * 建议使用 JSON Patch (application/json-patch+json) 进行精确控制，
 * 避免 Merge Patch 可能导致的标签覆盖问题。
 */
export const patchHarvesterVM = async (
  { endpoint, token, insecure = false }: HarvesterTestParams,
  namespace: string,
  name: string,
  payload: any,
  contentType = 'application/merge-patch+json'
) => {
  const base = (endpoint || '').replace(/\/+$/, '');
  let origin = base;
  try {
    const u = new URL(base);
    origin = `${u.protocol}//${u.host}`;
  } catch {
    origin = base.replace(/\/v[0-9].*$/, '');
  }

  // [标签处理优化] 已移除自动合并逻辑。
  // 请在调用端使用 JSON Patch (application/json-patch+json) 来实现原子操作。
  // 或者确保 Merge Patch 的 payload 是正确的增量结构。

  // 构建 API URL (优先尝试 kubevirt.io API)
  const url = `${origin}/apis/kubevirt.io/v1/namespaces/${encodeURIComponent(namespace)}/virtualmachines/${encodeURIComponent(name)}`;

  return await requestJson('PATCH', url, token, insecure, payload, {
    'Content-Type': contentType
  });
};

/**
 * 更新 Harvester 虚拟机规格 (Spec)
 * 
 * [功能描述]
 * 处理虚拟机配置变更请求，支持简单 CPU/内存扩容和复杂的磁盘/网络/CloudInit 变更。
 * 
 * [核心逻辑]
 * 1. [智能分流 (Optimization)]:
 *    - 优先检查变更字段是否仅包含 CPU/Memory 等基础属性。
 *    - 若是，走“最小 Patch”路径，仅构造极简 JSON 发送给 K8s，大幅降低网络开销并规避 ECONNRESET。
 * 2. [复杂变更]:
 *    - 涉及数组操作 (Volumes/Networks) 或深层嵌套对象时，必须先拉取当前 Spec，进行深拷贝合并，再全量 Patch。
 * 3. [热扩容 (Hot Plug)]:
 *    - 自动处理 maxSockets 和 maxGuest 以启用 KubeVirt 热插拔特性。
 * 
 * @param endpoint Harvester 接入地址
 * @param token 访问 Harvester 的 Token
 * @param insecure 是否忽略 TLS 校验
 * @param namespace 命名空间
 * @param name 虚拟机名称
 * @param spec 变更请求体 (包含 cpu, memory, enableHotPlug, maxSockets, maxMemory 等字段)
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

  // [性能优化] 最小 Patch 策略
  // ---------------------------------------------------------
  // 为什么需要这个优化？
  // KubeVirt 的 VirtualMachine 对象通常非常庞大（包含 status、详细配置等）。
  // 如果每次微小的 CPU/内存变更都发送全量 Spec，不仅浪费带宽，
  // 还容易因为 Payload 过大触发 Node.js HTTP 客户端的 ECONNRESET 错误。
  // 
  // 实现原理：
  // 1. 检查 spec 是否仅包含白名单内的简单字段。
  // 2. 如果是，构造一个极其精简的 JSON Patch，只包含变化的字段。
  // ---------------------------------------------------------
  const simpleFields = ['cpu', 'memory', 'enableHotPlug', 'cpuSockets', 'cpuCores', 'cpuThreads', 'dedicatedCPUPlacement', 'cpuRequest', 'cpuLimit', 'memoryLimit', 'runStrategy', 'maxSockets', 'maxMemory'];
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
      // ---------------------------------------------------------
      // [核心逻辑] CPU 规格变更与热扩容拓扑策略
      // ---------------------------------------------------------
      if (spec.cpu !== undefined) {
          ensureCpu();

          // [状态检测] 判定是否处于“热扩容”模式
          // 判定逻辑：
          // 1. 本次请求明确启用了热扩容 (spec.enableHotPlug === true)
          // 2. 或者，本次请求未明确禁用 (spec.enableHotPlug !== false) 且虚拟机当前已配置了 maxSockets
          // 注意：maxSockets 是 KubeVirt 判断是否启用 CPU 热插拔的关键标志。
          const currentCpu = current?.spec?.template?.spec?.domain?.cpu || {};
          const currentMaxSockets = currentCpu.maxSockets;
          const isHotPlug = (spec.enableHotPlug === true) || (spec.enableHotPlug !== false && !!currentMaxSockets);

          if (isHotPlug) {
              if (currentCpu.cores !== 1 || currentCpu.threads !== 1) {
                  throw new Error('热扩容失败：当前 CPU 拓扑必须为 cores=1, threads=1。请先锁定拓扑（cores=1, threads=1）后再进行 CPU 热扩容。');
              }
              // [策略分支 A] 热扩容模式 (Hot Plug Mode)
              // ---------------------------------------------------------
              // [强制约束]: 必须将所有 CPU 资源映射到 Sockets 上。
              // 拓扑公式: Sockets = Total CPU, Cores = 1, Threads = 1
              //
              // [关键修正]: 在热扩容模式下，禁止修改 domain.resources (requests/limits)。
              // KubeVirt 仅通过监控 sockets 的数值变化来触发后端 Pod 的资源热更。
              // 如果 Patch 包中包含了 resources.requests.cpu 字段，KubeVirt 会认为
              // 用户试图修改 Pod 的 Template Spec（非热更字段），从而触发 RestartRequired。
              //
              // [优化技巧]: 仅当数值发生变化时才包含在 Patch 中，减少冗余。
              // ---------------------------------------------------------
              const targetSockets = Number(spec.cpu);
              if (currentCpu.sockets !== targetSockets) {
                  domain.cpu.sockets = targetSockets;
              }
              
              // 强制锁定拓扑为 1 Core, 1 Thread
              // 如果当前已经是 1，则无需在 Patch 中重复声明
          } else {
              // [策略分支 B] 标准模式 (Standard Mode)
              // ---------------------------------------------------------
              // 允许用户自定义 CPU 拓扑结构 (Sockets/Cores/Threads)。
              // 这种变更通常需要重启虚拟机生效。
              // ---------------------------------------------------------
              
              // 仅在非热扩容模式下，同步更新 K8s 资源配额
              ensureResources();
              domain.resources.requests.cpu = String(spec.cpu);
              domain.resources.limits.cpu = String(spec.cpu);

              if (spec.cpuSockets && spec.cpuCores && spec.cpuThreads) {
                   // 如果前端传入了完整拓扑，则直接使用
                   domain.cpu.sockets = Number(spec.cpuSockets);
                   domain.cpu.cores = Number(spec.cpuCores);
                   domain.cpu.threads = Number(spec.cpuThreads);
              } else {
                   // [兼容性默认值]
                   // 如果未指定拓扑，默认采用 1 Socket * N Cores 的传统结构。
                   domain.cpu.sockets = 1;
                   domain.cpu.cores = Number(spec.cpu);
                   domain.cpu.threads = 1;
              }
          }
      }

      // [核心逻辑] 热扩容 (Hot Plug) 配置
      // ---------------------------------------------------------
      // 1. CPU 热扩容: 
      //    - 必须设置 maxSockets 才能启用 CPU 热插拔。
      //    - KubeVirt 要求在热扩容模式下，Spec.sockets 必须 <= maxSockets。
      //    - [Strict Validation] 前端必须明确传入 maxSockets，禁止使用默认值。
      // 2. 内存热扩容:
      //    - 必须设置 maxGuest (通过 maxMemory 参数) 才能启用内存热插拔。
      //    - maxGuest 定义了虚拟机最大可扩容到的物理内存上限。
      //    - [Strict Validation] 前端必须明确传入 maxMemory。
      // ---------------------------------------------------------
      if (spec.enableHotPlug !== undefined) {
          ensureCpu();
          if (spec.enableHotPlug) {
              // [Strict Validation]
              // 必须传入 maxSockets 和 maxMemory 才能启用热扩容
              if (!spec.maxSockets) {
                  throw new Error('maxSockets is required when enabling hot plug');
              }
              try {
                  const ratioStr = await getHarvesterSettingValue({ endpoint, token, insecure }, 'max-hotplug-ratio');
                  const ratioNum = Number(ratioStr);
                  if (Number.isFinite(ratioNum) && ratioNum > 0) {
                      const currentCpuObj = current?.spec?.template?.spec?.domain?.cpu || {};
                      const baseTotalCpu = Number((currentCpuObj.sockets || 1) * (currentCpuObj.cores || 1) * (currentCpuObj.threads || 1));
                      const maxAllowed = Math.floor(baseTotalCpu * ratioNum);
                      if (Number(spec.maxSockets) > maxAllowed) {
                          throw new Error(`启用热扩容失败：目标 maxSockets=${spec.maxSockets} 超出集群设置 max-hotplug-ratio=${ratioNum} 基于当前总CPU=${baseTotalCpu} 的允许上限=${maxAllowed}。请先通过集群 Setting 提升比值或降低目标值。`);
                      }
                  }
              } catch {}
              
              // [防止 RestartRequired]: 仅在 maxSockets 确实变更时才修改。
              const currentMaxSockets = current?.spec?.template?.spec?.domain?.cpu?.maxSockets;
              if (currentMaxSockets !== Number(spec.maxSockets)) {
                  domain.cpu.maxSockets = Number(spec.maxSockets);
              }

              if (!spec.maxMemory) {
                  throw new Error('maxMemory is required when enabling hot plug');
              }
          } else {
              // 关闭热扩容时，清理相关字段
              domain.cpu.maxSockets = null;
          }
      }

      if (spec.maxMemory) {
          if (!domain.memory) domain.memory = {};
          // [防止 RestartRequired]: 仅在 maxGuest 确实变更时才修改。
          const currentMaxGuest = current?.spec?.template?.spec?.domain?.memory?.maxGuest;
          if (currentMaxGuest !== spec.maxMemory) {
              domain.memory.maxGuest = spec.maxMemory;
          }
      }

      // 2. Simple Memory
      // ---------------------------------------------------------
      // [核心逻辑] 内存规格变更与热扩容策略
      // ---------------------------------------------------------
      if (spec.memory !== undefined) {
          // [状态检测] 判定是否处于“内存热扩容”模式
          // 判定逻辑：
          // 1. 本次请求包含 maxMemory (正在启用热扩容)
          // 2. 或者，虚拟机当前已配置了 maxGuest (已启用热扩容)
          const currentMaxGuest = current?.spec?.template?.spec?.domain?.memory?.maxGuest;
          const isMemHotPlug = !!spec.maxMemory || !!currentMaxGuest;

          if (isMemHotPlug) {
              // [策略分支 A] 热扩容模式 (Hot Plug Mode)
              // ---------------------------------------------------------
              // [强制约束]: 必须通过 domain.memory.guest 字段来调整内存。
              // 
              // [关键修正]: 禁止修改 domain.resources.requests/limits。
              // KubeVirt 的内存热插拔控制器会根据 guest 内存自动调整 Pod 资源。
              // 如果手动修改 resources，会被视为非热更字段变更，导致 RestartRequired。
              // ---------------------------------------------------------
              if (!domain.memory) domain.memory = {};
              
              // [优化技巧]: 仅当内存值确实变化时才包含在 Patch 中
              const currentGuest = current?.spec?.template?.spec?.domain?.memory?.guest;
              if (currentGuest !== spec.memory) {
                  domain.memory.guest = spec.memory;
              }
          } else {
              // [策略分支 B] 标准模式 (Standard Mode)
              // ---------------------------------------------------------
              // 通过标准的 Kubernetes Resource Requests/Limits 调整内存。
              // 这种变更通常需要重启虚拟机生效。
              // ---------------------------------------------------------
              ensureResources();
              domain.resources.requests.memory = spec.memory;
              domain.resources.limits.memory = spec.memory;
          }
      }

      // 3. Advanced CPU
      if (spec.cpuSockets || spec.cpuCores || spec.cpuThreads) {
          ensureCpu();
          
          // [防御性编程] 再次检查热扩容状态
          const currentCpu = current?.spec?.template?.spec?.domain?.cpu || {};
          const currentMaxSockets = currentCpu.maxSockets;
          const isHotPlug = (spec.enableHotPlug === true) || (spec.enableHotPlug !== false && !!currentMaxSockets);

          if (isHotPlug) {
              // 热扩容模式下，强制锁定 Cores=1, Threads=1，仅允许修改 Sockets
              if (spec.cpuSockets) {
                  const targetSockets = Number(spec.cpuSockets);
                  if (currentCpu.sockets !== targetSockets) {
                      domain.cpu.sockets = targetSockets;
                  }
              }
              
              // [防止 RestartRequired]: 仅在 cores/threads 确实不符合热扩容拓扑要求时才修改。
              // 如果当前已经是 1，则无需在 Patch 中重复声明，避免 KubeVirt 误判为变更。
              if (currentCpu.cores !== 1) domain.cpu.cores = 1;
              if (currentCpu.threads !== 1) domain.cpu.threads = 1;
          } else {
              if (spec.cpuSockets) domain.cpu.sockets = Number(spec.cpuSockets);
              if (spec.cpuCores) domain.cpu.cores = Number(spec.cpuCores);
              if (spec.cpuThreads) domain.cpu.threads = Number(spec.cpuThreads);
          }
      }
      
      if (spec.dedicatedCPUPlacement !== undefined) {
          ensureCpu();
          const currentDedicated = current?.spec?.template?.spec?.domain?.cpu?.dedicatedCpuPlacement;
          if (spec.dedicatedCPUPlacement) {
              if (currentDedicated !== true) {
                  domain.cpu.dedicatedCpuPlacement = true;
              }
          } else {
              if (currentDedicated !== null && currentDedicated !== undefined) {
                  domain.cpu.dedicatedCpuPlacement = null;
              }
          }
      }
      
      // [Hot Plug Fix] 在热扩容模式下，忽略 cpuRequest/cpuLimit 的显式修改
      // 以避免触发 RestartRequired。
      const currentMaxSockets = current?.spec?.template?.spec?.domain?.cpu?.maxSockets;
      const isCpuHotPlug = (spec.enableHotPlug === true) || (spec.enableHotPlug !== false && !!currentMaxSockets);

      if (!isCpuHotPlug) {
          if (spec.cpuRequest !== undefined) {
              ensureResources();
              domain.resources.requests.cpu = String(spec.cpuRequest);
          }
          if (spec.cpuLimit !== undefined) {
              ensureResources();
              domain.resources.limits.cpu = String(spec.cpuLimit);
          }
      }

      // 4. Advanced Memory
      if (spec.memoryLimit !== undefined) {
          // [Hot Plug Fix] 内存热扩容模式下，忽略 memoryLimit
          const currentMaxGuest = current?.spec?.template?.spec?.domain?.memory?.maxGuest;
          const isMemHotPlug = !!spec.maxMemory || !!currentMaxGuest;
          
          if (!isMemHotPlug) {
              ensureResources();
              domain.resources.limits.memory = spec.memoryLimit;
          }
      }
      
      // 5. RunStrategy
      if (spec.runStrategy) {
          const currentRunStrategy = current?.spec?.runStrategy;
          if (currentRunStrategy !== spec.runStrategy) {
              patch.spec.runStrategy = spec.runStrategy;
          }
          const currentRunning = current?.spec?.running;
          const desiredRunning = spec.runStrategy !== 'Halted';
          if (currentRunning !== desiredRunning) {
              patch.spec.running = desiredRunning;
          }
      }

      const url = `${origin}/apis/kubevirt.io/v1/namespaces/${encodeURIComponent(namespace)}/virtualmachines/${encodeURIComponent(name)}`;
      // Use minimal patch
      return await requestJson('PATCH', url, token, insecure, patch, {
        'Content-Type': 'application/merge-patch+json',
      });
  }
  
  // [复杂变更] 全量 Patch 策略
  // ---------------------------------------------------------
  // 当涉及复杂字段（如磁盘、网络、CloudInit）时，我们不能简单地 merge-patch。
  // 必须采用 "Read -> Clone -> Modify -> Patch" 的模式：
  // 1. 获取当前 VM 完整 Spec。
  // 2. 深拷贝以避免副作用。
  // 3. 在副本上应用复杂的业务逻辑（如 CloudInit Secret 生成）。
  // 4. 发送全量 Spec 更新。
  // ---------------------------------------------------------
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

  // --- 1. [业务逻辑] CloudInit (UserData / NetworkData) ---
  // ---------------------------------------------------------
  // 为了避免 VM Spec 过大，我们不建议将 CloudInit 数据内联在 Spec 中。
  // 最佳实践：
  // 1. [提取数据]: 将 userData 和 networkData 从 Spec 中剥离。
  // 2. [保留旧数据]: 尝试读取旧的 Secret，防止只更新 UserData 时丢失 NetworkData (反之亦然)。
  // 3. [创建 Secret]: 将合并后的数据封装为新的 K8s Secret。
  // 4. [引用 Secret]: 在 VM Spec 中通过 cloudInitNoCloud.secretRef 引用该新 Secret。
  // ---------------------------------------------------------
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

  // --- 0. [业务逻辑] 重装系统 (Reinstall System Disk) ---
  // ---------------------------------------------------------
  // 这是一个破坏性操作，流程非常严谨：
  // 1. [创建新 PVC]: 根据新的镜像 ID 创建全新的 PVC。
  // 2. [替换 Volume]: 修改 VM Spec 中的 Volumes 列表，将 rootdisk 指向新 PVC。
  // 3. [更新注解]: 更新 volumeClaimTemplates，确保 Harvester UI 显示正确的镜像信息。
  // 4. [清理旧数据]: (可选) 异步删除旧的 PVC。
  // ---------------------------------------------------------
  if (spec.action === 'reinstall') {
      const image = spec.image || spec.imageId;
      if (!image) throw new Error('Reinstall requires target image');

      console.log(`[Reinstall] Reinstalling VM ${namespace}/${name} with image ${image}`);

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
  // --- 0.1 [业务逻辑] 扩容系统盘 (Resize Root Disk) ---
  // ---------------------------------------------------------
  // 注意：Harvester 不支持直接通过修改 VM Spec 来扩容磁盘。
  // 必须直接操作底层的 PVC (PersistentVolumeClaim)。
  // 流程：
  // 1. [Resize PVC]: 调用 K8s API 修改 PVC.spec.resources.requests.storage。
  // 2. [Sync Annotation]: 更新 VM 上的 volumeClaimTemplates 注解，
  //    确保 Harvester UI 的“配置”页签显示的磁盘大小与实际 PVC 一致。
  // ---------------------------------------------------------
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

  // --- 1. [基础变更] CPU / 内存调整 ---
  // ---------------------------------------------------------
  // 常规的规格变更逻辑：
  // 1. [CPU]: 同时更新 requests.cpu 和 limits.cpu (如果存在)。
  //    - 重置拓扑结构：默认 sockets=1, cores=N, threads=1 以简化管理。
  // 2. [Memory]: 同时更新 requests.memory 和 limits.memory。
  //    - 确保 guest 内存设置一致。
  // ---------------------------------------------------------
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
          // [Strict Validation]
          // Enable HotPlug requires explicit maxSockets and maxMemory
          if (!spec.maxSockets) {
              throw new Error('maxSockets is required when enabling hot plug');
          }
          domain.cpu.maxSockets = Number(spec.maxSockets);

          if (!spec.maxMemory) {
              throw new Error('maxMemory is required when enabling hot plug');
          }
      } else {
          // Disable HotPlug
          delete domain.cpu.maxSockets;
      }
  }

  // --- 1.2 Max Memory (HotPlug) ---
  if (spec.maxMemory) {
      if (!domain.memory) domain.memory = {};
      domain.memory.maxGuest = spec.maxMemory;
  }
  
  if (spec.memory !== undefined) {
      ensureResources();
      domain.resources.requests.memory = spec.memory;
      domain.resources.limits.memory = spec.memory;
  }

  // --- 3. [高级配置] CPU 拓扑与绑定 (Topology & Pinning) ---
  // ---------------------------------------------------------
  // 处理 CPU 拓扑结构 (Sockets/Cores/Threads) 和专用 CPU 绑定。
  // 注意：如果启用了热扩容，这些设置可能会受到限制或调整。
  // ---------------------------------------------------------
  if (spec.cpuSockets || spec.cpuCores || spec.cpuThreads) {
      ensureCpu();
      if (spec.cpuSockets) domain.cpu.sockets = Number(spec.cpuSockets);
      if (spec.cpuCores) domain.cpu.cores = Number(spec.cpuCores);
      if (spec.cpuThreads) domain.cpu.threads = Number(spec.cpuThreads);
  }
  
  // [CPU 绑定] Dedicated CPU Placement
  if (spec.dedicatedCPUPlacement !== undefined) {
      ensureCpu();
      if (spec.dedicatedCPUPlacement) {
          domain.cpu.dedicatedCpuPlacement = true;
      } else {
          delete domain.cpu.dedicatedCpuPlacement;
      }
  }
  
  // [资源限制] CPU Requests / Limits
  if (spec.cpuRequest !== undefined) {
      ensureResources();
      domain.resources.requests.cpu = String(spec.cpuRequest);
  }
  
  if (spec.cpuLimit !== undefined) {
      ensureResources();
      domain.resources.limits.cpu = String(spec.cpuLimit);
  }
  
  // --- 4. [高级配置] 内存限制 (Memory Limits) ---
  if (spec.memoryLimit !== undefined) {
      ensureResources();
      domain.resources.limits.memory = spec.memoryLimit;
  }

  // --- 5. [硬件设备] GPU 配置 ---
  // ---------------------------------------------------------
  // Harvester 支持将物理 GPU 透传给虚拟机。
  // 目前仅支持单个 GPU 设备的添加或移除。
  // ---------------------------------------------------------
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

  // --- 6. [网络配置] 多网卡 (Multus Networks) ---
  // ---------------------------------------------------------
  // 支持 Multus CNI 多网卡配置。
  // 直接替换 networks 数组，实现网卡的添加/删除/修改。
  // ---------------------------------------------------------
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
 * 
 * [功能描述]
 * 构造用于前端连接 VNC 控制台的 WebSocket 代理地址。
 * 
 * [核心逻辑]
 * 1. [Subresource API]:
 *    - 使用 KubeVirt 特定的 Subresource API `/vnc`。
 *    - 该 URL 将被后端 WebSocket 代理透传，建立与 VM 的实时控制台连接。
 * 
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
 * 同步 VM 磁盘规格注解 (Sync Volume Size Annotation)
 * 
 * [功能描述]
 * 在 PVC 扩容成功后，同步更新 VM 注解 `volumeClaimTemplates` 中的磁盘大小。
 * 
 * [核心逻辑]
 * 1. [问题背景]: 
 *    - Harvester UI 的“配置”页签中，磁盘列表是直接读取 VM Spec 和 Annotation 的。
 *    - 如果只扩容了底层 PVC 而不更新 VM Annotation，UI 仍然会显示旧的磁盘大小，导致用户困惑。
 * 2. [VM 定位]:
 *    - 优先使用 vmName。
 *    - 若 vmName 未知，通过遍历 Namespace 下所有 VM，查找引用了指定 PVC 的 VM。
 * 3. [模板匹配]:
 *    - 解析 `harvesterhci.io/volumeClaimTemplates` 注解。
 *    - 通过 Volume Name 或 PVC Name 匹配对应的模板项。
 * 4. [Patch 更新]:
 *    - 修改模板中的 resources.requests.storage 字段。
 *    - 使用 JSON Patch 更新 VM Annotation。
 * 
 * @param endpoint Harvester 接入地址
 * @param token 访问 Harvester 的 Token
 * @param insecure 是否忽略 TLS 校验
 * @param namespace 命名空间
 * @param vmName 虚拟机名称 (可选，若为空则自动反查)
 * @param pvcName 已扩容的 PVC 名称
 * @param newSize 新的存储规格 (e.g. '40Gi')
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