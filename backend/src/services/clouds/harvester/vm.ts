import { HarvesterTestParams } from './types';
import { getJsonOnce, requestJson } from './utils';
import { createHarvesterSecret } from './storage';
import { buildHarvesterVmRowIps } from './vmIpMerge';

/**
 * ==============================================================================
 * 服务名称: Harvester 虚拟机基础服务 (Harvester VM Base Service)
 * 文件路径: backend/src/services/clouds/harvester/vm.ts
 * ==============================================================================
 *
 * [功能描述]
 * 提供 Harvester (KubeVirt) 虚拟机的基础管理能力，包括列表查询、详情获取、创建、
 * VNC 访问、卷管理（挂载/卸载）等核心功能。本模块专注于 VM 的基础操作，不涉及
 * 生命周期管理（启动/停止等）和规格变更（CPU/内存调整等）。
 *
 * [核心功能]
 * 1. [数据查询]:
 *    - VM 列表查询: 支持 Raw（原始）和 Standard（标准化）两种视图
 *    - VM 详情获取: 根据命名空间和名称获取完整 VM 定义
 *    - VMI 查询: 获取虚拟机运行时实例信息
 *    - 双路径探测: 自动尝试 KubeVirt 原生 API 和 Harvester Steve API，确保兼容性
 *
 * 2. [VM 创建]:
 *    - 创建虚拟机: 支持完整的 VM Spec 创建
 *    - CloudInit 自动化: 自动提取 userData/networkData 并封装为 Secret
 *    - SSH 密钥注入: 自动从 KeyPair 资源注入 SSH 公钥
 *    - 平台托管标记: 自动添加 tower.io/managed Finalizer 和 creator 标签
 *
 * 3. [卷管理]:
 *    - 挂载卷: 将 PVC 挂载到 VM（支持通过实例ID或直接指定命名空间/名称）
 *    - 卸载卷: 从 VM 卸载已挂载的卷
 *    - 总线类型修正: 自动处理 Harvester addVolume API 的限制（仅支持 SCSI），
 *      通过 PATCH VM spec 实现其他总线类型
 *
 * 4. [辅助功能]:
 *    - VNC 访问: 生成 VNC 控制台访问 URL
 *    - 磁盘规格同步: 同步 PVC 扩容后的 VM Annotation
 *
 * [设计原则]
 * - 数据查询采用双路径探测，优先使用 KubeVirt API，失败时降级到 Harvester API
 * - Standard 视图聚合 VM 和 VMI 数据，提供前端友好的扁平化结构
 * - 卷管理函数位于本文件，因为它们属于 VM 的基础操作，而非生命周期管理
 *
 * ------------------------------------------------------------------------------
 * [模块划分]
 * ------------------------------------------------------------------------------
 * - lifecycle.ts: VM 生命周期管理（启动/停止/重启/删除等）
 * - vm_update.ts: VM 规格变更（CPU/内存/磁盘/网络等配置修改）
 * - vm_aggregated.ts: VM 聚合查询（一次性获取 VM 及关联资源）
 *
 * ------------------------------------------------------------------------------
 * [API 接口]
 * ------------------------------------------------------------------------------
 * - GET /apis/kubevirt.io/v1/virtualmachines - 获取 VM 列表
 * - GET /apis/kubevirt.io/v1/virtualmachineinstances - 获取 VMI 列表
 * - GET /apis/kubevirt.io/v1/namespaces/{ns}/virtualmachines/{name} - 获取 VM 详情
 * - POST /apis/kubevirt.io/v1/namespaces/{ns}/virtualmachines - 创建 VM
 * - POST /v1/harvester/kubevirt.io.virtualmachines/{ns}/{name}?action=addVolume - 挂载卷
 * - POST /v1/harvester/kubevirt.io.virtualmachines/{ns}/{name}?action=removeVolume - 卸载卷
 *
 * ------------------------------------------------------------------------------
 * [依赖关系]
 * ------------------------------------------------------------------------------
 * - storage.ts: 处理 PVC 和 Secret 的创建与管理
 * - cluster.ts: 获取集群配置信息（如热扩容比例）
 * - utils.ts: HTTP 请求封装与错误处理
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
          url,
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
          url,
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
    // [优先级1] 检查 VMI 的迁移状态（迁移状态优先级最高）
    // 迁移状态存储在 VMI 的 metadata.annotations['harvesterhci.io/migrationState'] 中
    // 也可能在 status.migrationState 中（不同版本可能不同）
    // 注意：如果 migrationState.completed 为 true，说明迁移已完成，不应该返回 'Migrating'
    let status = vm?.status?.printableStatus || vm?.status?.phase || 'Unknown';
    const migrationState = vmi?.status?.migrationState;
    const migrationAnnotation = vmi?.metadata?.annotations?.['harvesterhci.io/migrationState'];

    // 检查是否真的在迁移中（排除已完成的迁移）
    if (migrationState) {
      // 如果 migrationState.completed 或 migrationState.Completed 为 true，说明迁移已完成，不应该显示为迁移中
      // 注意：JSON 中的字段名是小写的 "completed"，但代码中可能有大写的情况
      const isCompleted = migrationState.completed === true || migrationState.Completed === true;
      if (!isCompleted) {
        status = 'Migrating';
      }
    } else if (migrationAnnotation) {
      // 如果只有注解但没有 migrationState，也认为在迁移中
      status = 'Migrating';
    }

    const ips = buildHarvesterVmRowIps(vm, vmi);

    const macs: string[] = [];
    if (Array.isArray(vm?.status?.interfaces)) {
      vm.status.interfaces.forEach((i: any) => {
        if (i.mac || i.macAddress) macs.push(i.mac || i.macAddress);
      });
    }
    if (vmi && Array.isArray(vmi.status?.interfaces)) {
      vmi.status.interfaces.forEach((i: any) => {
        if (i.mac || i.macAddress) macs.push(i.mac || i.macAddress);
      });
    }

    // Node
    const nodeName = vmi?.status?.nodeName || vm?.status?.nodeName || '';

    // Networks (Parse Multus annotations)
    const networksArr: any[] = Array.isArray(vm?.spec?.template?.spec?.networks)
      ? vm?.spec?.template?.spec?.networks
      : [];
    const networks: string[] = networksArr
      .map((n: any) => n?.multus?.networkName || (n?.name ? String(n.name) : 'pod'))
      .filter((s: string) => !!s);

    // CPU/Memory
    // [修复] 正确计算CPU数量：sockets * cores * threads
    // 热扩容模式下，sockets会变化，需要完整计算
    const cpuSpec = vm?.spec?.template?.spec?.domain?.cpu;
    let cpu: number | undefined = undefined;
    if (
      cpuSpec?.sockets !== undefined &&
      cpuSpec?.cores !== undefined &&
      cpuSpec?.threads !== undefined
    ) {
      cpu = Number(cpuSpec.sockets) * Number(cpuSpec.cores) * Number(cpuSpec.threads);
    } else if (cpuSpec?.sockets !== undefined && cpuSpec?.cores !== undefined) {
      cpu = Number(cpuSpec.sockets) * Number(cpuSpec.cores) * (cpuSpec?.threads || 1);
    } else if (cpuSpec?.cores !== undefined) {
      cpu = Number(cpuSpec.cores);
    } else if (cpuSpec?.sockets !== undefined) {
      cpu = Number(cpuSpec.sockets);
    }
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
      vpcName: networks.find((n) => n !== 'pod' && n !== 'default'),
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
    `${base}/k8s/clusters/local/apis/kubevirt.io/v1/namespaces/${encodeURIComponent(namespace)}/virtualmachines/${encodeURIComponent(name)}`,
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

        const keysBlock = `ssh_authorized_keys:\n${publicKeys.map((k) => `  - ${k}`).join('\n')}\n`;
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
            secretRef: { name: secretName },
          },
        };

        // Prepare Secret Object
        cloudInitSecret = {
          apiVersion: 'v1',
          kind: 'Secret',
          metadata: {
            name: secretName,
            namespace,
            labels: {
              'harvesterhci.io/cloud-init-template': 'harvester',
            },
          },
          type: 'Opaque',
          data,
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
      const _patchBody = [
        {
          op: createdFinalizers.length > 0 ? 'add' : 'add',
          path: '/metadata/finalizers/-', // append
          value: managedFinalizer,
        },
      ];
      // 如果原 finalizers 为空，路径可能是 "/metadata/finalizers" (需初始化数组)
      // 但 JSON Patch 的 "-" 语法通常要求数组已存在。
      // 更稳健的方式是使用 Merge Patch (application/merge-patch+json)
      const mergePatchBody = {
        metadata: {
          finalizers: [...createdFinalizers, managedFinalizer],
        },
      };

      await requestJson('PATCH', patchUrl, token, insecure, mergePatchBody, {
        'Content-Type': 'application/merge-patch+json',
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
    cloudInitSecret.metadata.ownerReferences = [
      {
        apiVersion: vm.apiVersion || 'kubevirt.io/v1',
        kind: vm.kind || 'VirtualMachine',
        name: vm.metadata.name,
        uid: vm.metadata.uid,
        blockOwnerDeletion: true,
      },
    ];

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
  contentType = 'application/merge-patch+json',
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
    'Content-Type': contentType,
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
/**
 * [Harvester 兼容] 判断虚拟机是否启用了 CPU 和内存热扩容
 * 复刻 Harvester 的逻辑：通过 Annotation harvesterhci.io/enableCPUAndMemoryHotplug 判断
 */

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
  { endpoint, token: _token, insecure: _insecure = false }: HarvesterTestParams,
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
  newSize: string,
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
  try {
    vct = JSON.parse(vctStr);
  } catch {
    return;
  }

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
        console.log(
          `[SyncVmVolumeSize] Resolved PVC ${pvcName} to template ${volume.name} via volume mapping`,
        );
      }
    }
  }

  if (index === -1) {
    console.warn(
      `[SyncVmVolumeSize] PVC ${pvcName} not found in VM ${targetVmName} volumeClaimTemplates (Direct or Mapped)`,
    );
    return;
  }

  // Check if update is needed
  const currentReq = vct[index].spec?.resources?.requests?.storage;
  console.log(
    `[SyncVmVolumeSize] Checking VM ${targetVmName} PVC ${pvcName}. Current: ${currentReq}, New: ${newSize}`,
  );

  // Update always to be safe
  if (!vct[index].spec) vct[index].spec = {};
  if (!vct[index].spec.resources) vct[index].spec.resources = {};
  if (!vct[index].spec.resources.requests) vct[index].spec.resources.requests = {};
  vct[index].spec.resources.requests.storage = newSize;

  // 4. Patch VM
  const newAnnotations = { 'harvesterhci.io/volumeClaimTemplates': JSON.stringify(vct) };

  const patchBody = {
    metadata: {
      annotations: newAnnotations,
    },
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

// ==================================================================================
// VM Volume Management (挂载/卸载卷)
// ==================================================================================

/**
 * 解析实例标识为命名空间和名称
 *
 * [功能描述]
 * 将前端传入的多种格式的实例标识统一解析为 { namespace, name } 格式。
 * 用于卷管理函数中，支持通过实例ID挂载/卸载卷。
 *
 * [支持的格式]
 * 1. 命名空间/名称格式: "default/vm-01" 或 "default:vm-01"
 * 2. 实例ID格式: 通过查询 VM 列表，根据 InstanceId 或 InstanceName 反推命名空间和名称
 *
 * @param params Harvester 连接参数
 * @param instanceId 实例标识（支持多种格式）
 * @returns 解析后的命名空间和名称，解析失败返回 null
 */
const resolveVmPath = async (
  { endpoint, token, insecure = false }: HarvesterTestParams,
  instanceId: string,
): Promise<{ namespace: string; name: string } | null> => {
  const s = String(instanceId || '');
  const sep = s.includes('/') ? '/' : s.includes(':') ? ':' : null;
  if (sep) {
    const [ns, nm] = s.split(sep);
    if (ns && nm) return { namespace: ns, name: nm };
  }
  const list = await listHarvesterVMsStandard({ endpoint, token, insecure });
  const hit = list.find((x: any) => x.InstanceId === s || x.InstanceName === s);
  if (hit && typeof hit.InstanceId === 'string' && hit.InstanceId.includes('/')) {
    const [ns, nm] = String(hit.InstanceId).split('/');
    if (ns && nm) return { namespace: ns, name: nm };
  }
  return null;
};

/**
 * 挂载卷到虚拟机（通过实例ID）
 *
 * [功能描述]
 * 将 PersistentVolumeClaim (PVC) 挂载到指定的虚拟机，支持通过实例ID解析VM路径。
 *
 * [核心逻辑]
 * 1. [路径解析]: 支持多种实例标识格式 (ns/name, ns:name, InstanceId)
 * 2. [PVC 就绪等待]: 新创建的 PVC 可能尚未 Bound，等待其就绪后再挂载（最多等待 90 秒）
 * 3. [Longhorn 兼容]: 支持从 Longhorn Volume 解析 PVC 名称
 * 4. [错误恢复]: 自动检测已挂载状态，避免重复挂载错误
 *
 * [API 限制]
 * **Harvester 的 addVolume API 不支持 bus 参数**，只接受精简格式 { diskName, volumeSourceName }，
 * 且总线类型会被硬编码为 "scsi"。如果需要其他总线类型（如 virtio），请使用
 * harvesterAddVolumeToVMDirect 函数，它会在挂载后通过 PATCH VM spec 自动修改总线类型。
 *
 * @param params Harvester 连接参数
 * @param instanceId 虚拟机实例标识（支持 ns/name、ns:name 或 InstanceId）
 * @param payload 挂载参数
 *   - name: 磁盘名称（必填）
 *   - bus: 总线类型（可选，但本函数不支持，会被忽略）
 *   - pvcNamespace: PVC 命名空间（必填）
 *   - pvcName: PVC 名称（必填）
 * @returns API 响应结果
 */
export const harvesterAddVolumeToVM = async (
  { endpoint, token, insecure = false }: HarvesterTestParams,
  instanceId: string,
  payload: { name: string; bus?: string; pvcNamespace: string; pvcName: string },
) => {
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const waitForPvcBound = async (namespace: string, pvcName: string, timeoutMs = 90_000) => {
    const base = (endpoint || '').replace(/\/+$/, '');
    let origin = base;
    try {
      const u = new URL(base);
      origin = `${u.protocol}//${u.host}`;
    } catch {
      origin = base.replace(/\/v[0-9].*$/, '');
    }
    const start = Date.now();
    let last: any = null;
    while (Date.now() - start < timeoutMs) {
      try {
        const url = `${origin}/api/v1/namespaces/${encodeURIComponent(namespace)}/persistentvolumeclaims/${encodeURIComponent(pvcName)}`;
        const j = await getJsonOnce(url, token, insecure, true);
        last = j;
        const phase = String(j?.status?.phase || '').toLowerCase();
        const pvName = String(j?.spec?.volumeName || '').trim();
        if (phase === 'bound' || pvName) return { pvName: pvName || undefined, phase };
      } catch (e: any) {
        last = e;
      }
      await sleep(2000);
    }
    const phase = String(last?.status?.phase || '').toLowerCase();
    const pvName = String(last?.spec?.volumeName || '').trim();
    throw new Error(
      `等待PVC就绪超时：${namespace}/${pvcName}（phase=${phase || 'unknown'} pv=${pvName || 'n/a'}）`,
    );
  };

  const base = (endpoint || '').replace(/\/+$/, '');
  let origin = base;
  try {
    const u = new URL(base);
    origin = `${u.protocol}//${u.host}`;
  } catch {
    origin = base.replace(/\/v[0-9].*$/, '');
  }
  let path = await resolveVmPath({ endpoint, token, insecure }, instanceId);
  if (!path) {
    const guessNs = String(payload.pvcNamespace || '').trim();
    const guessName = String(instanceId || '').trim();
    if (guessNs && guessName) {
      try {
        const probe = await getJsonOnce(
          `${origin}/v1/harvester/kubevirt.io.virtualmachines/${encodeURIComponent(guessNs)}/${encodeURIComponent(guessName)}`,
          token,
          insecure,
          true,
        );
        if (probe && (probe?.metadata?.name || probe?.name)) {
          path = { namespace: guessNs, name: guessName };
        }
      } catch {}
    }
  }
  if (!path) throw new Error('无法解析实例标识');
  const url = `${origin}/v1/harvester/kubevirt.io.virtualmachines/${encodeURIComponent(path.namespace)}/${encodeURIComponent(path.name)}?action=addVolume`;
  const isAttached = (vm: any, pvc: string) => {
    const vols = vm?.spec?.template?.spec?.volumes || [];
    return vols.some((v: any) => v?.persistentVolumeClaim?.claimName === pvc);
  };
  let pvcName = String(payload.pvcName || '').trim();
  const volName = String(payload.name || '').trim();
  let pvName: string | undefined = undefined;
  // [Race Fix] 新创建的 PVC 可能尚未 Bound，直接 addVolume 可能 422/404。
  // 尝试等待 PVC 就绪，以提高创建后立刻挂载的成功率。
  if (payload.pvcNamespace && pvcName) {
    try {
      const w = await waitForPvcBound(String(payload.pvcNamespace).trim(), pvcName);
      if (!pvName && w?.pvName) pvName = w.pvName;
    } catch (e) {
      // 不阻断后续兼容逻辑（仍会走 longhorn/pvcName 解析与多 body 尝试）
      console.warn(
        '[Harvester addVolume] wait PVC bound failed (continue)',
        (e as any)?.message || e,
      );
    }
  }
  if (!pvcName || pvcName.toLowerCase() === volName.toLowerCase()) {
    const ns = String(payload.pvcNamespace || '').trim();
    const candidates = [
      `${origin}/apis/longhorn.io/v1beta1/namespaces/${encodeURIComponent(ns)}/volumes/${encodeURIComponent(volName)}`,
      `${origin}/v1/harvester/longhorn.io.volumes/${encodeURIComponent(volName)}`,
      `${origin}/v1/longhorn.io.volumes/${encodeURIComponent(volName)}`,
    ];
    for (const p of candidates) {
      try {
        const j = await getJsonOnce(p, token, insecure, true);
        const k = j?.status?.kubernetesStatus?.pvcName || '';
        const pv = j?.status?.kubernetesStatus?.pvName || '';
        if (typeof k === 'string' && k.trim()) {
          pvcName = String(k).trim();
          pvName = typeof pv === 'string' && pv.trim() ? String(pv).trim() : pvName;
          break;
        }
      } catch {}
    }
  }
  if (!pvcName) throw new Error('该卷缺少 PVC 名称，无法挂载');
  if (!pvName) {
    try {
      const ns = String(payload.pvcNamespace || '').trim();
      const urls = [
        `${origin}/v1/harvester/persistentvolumeclaims/${encodeURIComponent(ns)}/${encodeURIComponent(pvcName)}`,
        `${origin}/api/v1/namespaces/${encodeURIComponent(ns)}/persistentvolumeclaims/${encodeURIComponent(pvcName)}`,
      ];
      for (const u of urls) {
        try {
          const j = await getJsonOnce(u, token, insecure, true);
          const pv = j?.spec?.volumeName || '';
          if (typeof pv === 'string' && pv.trim()) {
            pvName = String(pv).trim();
            break;
          }
        } catch {}
      }
    } catch {}
  }
  // [重要] 根据 Harvester 源码，addVolume API 只接受精简格式 { diskName, volumeSourceName }
  // AddVolumeInput 结构体只有两个字段（见 types.go:37-40），且 bus 被硬编码为 "scsi"（见 handler.go:1231）
  // 该 API 不支持 bus 参数，如果用户需要其他总线类型，需要在挂载后通过修改 VM spec 来实现
  const bodies: any[] = [
    {
      diskName: volName,
      volumeSourceName: pvcName,
    },
  ];
  let lastErr: any = null;
  for (let i = 0; i < bodies.length; i++) {
    const body = bodies[i];
    try {
      const tag = 'harvester addVolume request';
      console.info(tag, {
        url,
        name: body.name,
        diskBus: body.disk?.bus,
        diskName: body.diskName,
        volumeName: body.volumeName,
        volumeSourceName: body.volumeSourceName,
        claimName: body.volumeSource?.persistentVolumeClaim?.claimName,
        ...(lastErr
          ? { status: Number(lastErr?.status || 0), error: String(lastErr?.message || '') }
          : {}),
      });
      const res = await requestJson('POST', url, token, insecure, body);
      return res;
    } catch (e: any) {
      lastErr = e;
      const s = Number(e?.status || 0);
      const m = String(e?.message || '').toLowerCase();

      // [特殊处理] 422 Unprocessable Entity
      // 如果错误信息包含 "already" (e.g. "Volume ... is already attached"), 则视为成功
      if (s === 422 && (m.includes('already') || m.includes('exist'))) {
        console.info('harvester addVolume 422 ignored (already attached)', {
          name: body.name,
          error: m,
        });
        return { status: 'AlreadyAttached', message: 'Volume is already attached' };
      }

      // 兜底：少数场景 Harvester 可能返回 5xx/422，但 addVolume 实际已生效；回查 VM，若已挂载则视为成功
      if (s === 422 || s === 500) {
        try {
          const vm = await getHarvesterVM({ endpoint, token, insecure }, path.namespace, path.name);
          if (isAttached(vm, pvcName)) {
            console.info('harvester addVolume recovered (already attached by vm check)', {
              pvcName,
              vm: `${path.namespace}/${path.name}`,
            });
            return { ok: true, alreadyAttached: true };
          }
        } catch {
          // ignore
        }
      }

      const needContinue =
        s === 422 ||
        s === 500 ||
        m.includes('invalid') ||
        m.includes('required') ||
        s === 404 ||
        m.includes('not found');
      if (!needContinue) throw e;
    }
  }
  if (lastErr) throw lastErr;
};

/**
 * 挂载卷到虚拟机（直接指定命名空间和名称）
 *
 * [功能描述]
 * 将 PersistentVolumeClaim (PVC) 挂载到指定的虚拟机，直接使用命名空间和名称。
 * 相比 harvesterAddVolumeToVM，本函数支持总线类型修正功能。
 *
 * [核心逻辑]
 * 1. [PVC 就绪等待]: 新创建的 PVC 可能尚未 Bound，等待其就绪后再挂载（最多等待 90 秒）
 * 2. [Longhorn 兼容]: 支持从 Longhorn Volume 解析 PVC 名称
 * 3. [总线类型修正（重要）]:
 *    - **Harvester 的 addVolume API 不支持 bus 参数**，会被硬编码为 "scsi"
 *    - 如果用户指定了非 SCSI 总线类型（如 virtio），本函数会通过两步操作实现：
 *      1) 先调用 addVolume API 挂载（此时总线类型为 scsi）
 *      2) 立即 PATCH VM spec 修改磁盘的总线类型为用户指定的值
 *    - 注意：修改总线类型可能需要重启 VM 才能生效
 * 4. [重启要求]:
 *    - **重要**：虽然 Harvester 设置了 Hotpluggable=true，但 addVolume 会修改 VM 的 spec.template
 *    - 修改 spec.template 通常会导致 KubeVirt 设置 RestartRequired condition
 *    - 因此添加/删除卷操作通常需要重启 VM 才能生效
 * 5. [错误恢复]: 自动检测已挂载状态，避免重复挂载错误
 *
 * [使用场景]
 * - 需要指定非 SCSI 总线类型时使用本函数
 * - 已知 VM 的命名空间和名称时，使用本函数可避免实例ID解析的开销
 *
 * @param params Harvester 连接参数
 * @param namespace 虚拟机命名空间
 * @param name 虚拟机名称
 * @param payload 挂载参数
 *   - name: 磁盘名称（必填）
 *   - bus: 总线类型（可选，支持 virtio/scsi/sata/nvme，默认为 virtio）
 *          注意：Harvester addVolume API 不支持此参数，本函数通过两步操作实现总线类型设置
 *   - pvcNamespace: PVC 命名空间（必填）
 *   - pvcName: PVC 名称（必填）
 * @returns API 响应结果
 */
export const harvesterAddVolumeToVMDirect = async (
  { endpoint, token, insecure = false }: HarvesterTestParams,
  namespace: string,
  name: string,
  payload: { name: string; bus?: string; pvcNamespace: string; pvcName: string },
) => {
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const waitForPvcBound = async (ns: string, pvc: string, timeoutMs = 90_000) => {
    const base = (endpoint || '').replace(/\/+$/, '');
    let origin = base;
    try {
      const u = new URL(base);
      origin = `${u.protocol}//${u.host}`;
    } catch {
      origin = base.replace(/\/v[0-9].*$/, '');
    }
    const start = Date.now();
    let last: any = null;
    while (Date.now() - start < timeoutMs) {
      try {
        const url = `${origin}/api/v1/namespaces/${encodeURIComponent(ns)}/persistentvolumeclaims/${encodeURIComponent(pvc)}`;
        const j = await getJsonOnce(url, token, insecure, true);
        last = j;
        const phase = String(j?.status?.phase || '').toLowerCase();
        const pvName = String(j?.spec?.volumeName || '').trim();
        if (phase === 'bound' || pvName) return { pvName: pvName || undefined, phase };
      } catch (e: any) {
        last = e;
      }
      await sleep(2000);
    }
    const phase = String(last?.status?.phase || '').toLowerCase();
    const pvName = String(last?.spec?.volumeName || '').trim();
    throw new Error(
      `等待PVC就绪超时：${ns}/${pvc}（phase=${phase || 'unknown'} pv=${pvName || 'n/a'}）`,
    );
  };

  const base = (endpoint || '').replace(/\/+$/, '');
  let origin = base;
  try {
    const u = new URL(base);
    origin = `${u.protocol}//${u.host}`;
  } catch {
    origin = base.replace(/\/v[0-9].*$/, '');
  }
  const url = `${origin}/v1/harvester/kubevirt.io.virtualmachines/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}?action=addVolume`;
  let pvcName = String(payload.pvcName || '').trim();
  const volName = String(payload.name || '').trim() || String(pvcName || '').trim();
  if (!volName) throw new Error('参数缺失：磁盘名(name/diskName)');
  let pvName: string | undefined = undefined;

  // [Race Fix] 新创建 PVC 可能未 Bound，先尽力等待一段时间
  if (payload.pvcNamespace && pvcName) {
    try {
      const w = await waitForPvcBound(String(payload.pvcNamespace).trim(), pvcName);
      if (!pvName && w?.pvName) pvName = w.pvName;
    } catch (e) {
      console.warn(
        '[Harvester addVolume direct] wait PVC bound failed (continue)',
        (e as any)?.message || e,
      );
    }
  }
  const needResolveFromLonghorn =
    !pvcName || pvcName.toLowerCase() === volName.toLowerCase() || !/^pvc-/.test(pvcName);
  if (needResolveFromLonghorn) {
    try {
      const candidatesAll = [
        `${origin}/v1/longhorn.io.volumes`,
        `${origin}/v1/harvester/longhorn.io.volumes`,
        `${origin}/apis/longhorn.io/v1beta1/volumes`,
      ];
      let listJson: any = null;
      for (const u of candidatesAll) {
        try {
          listJson = await getJsonOnce(u, token, insecure, true);
          if (listJson) break;
        } catch {}
      }
      const items: any[] = Array.isArray(listJson?.data)
        ? listJson?.data
        : Array.isArray(listJson?.items)
          ? listJson?.items
          : [];
      const hit = items.find((it: any) => {
        const ks = it?.status?.kubernetesStatus || {};
        const nm = it?.metadata?.name || it?.name || '';
        const vname = ks?.volumeName || '';
        return String(vname || '').trim() === volName || String(nm || '').trim() === volName;
      });
      if (hit) {
        const ks = hit?.status?.kubernetesStatus || {};
        const kPVC = ks?.pvcName || '';
        const kPV = ks?.pvName || '';
        if (typeof kPVC === 'string' && kPVC.trim()) pvcName = String(kPVC).trim();
        if (typeof kPV === 'string' && kPV.trim()) pvName = String(kPV).trim();
      }
    } catch {}
  }
  if (!pvcName || pvcName.toLowerCase() === volName.toLowerCase()) {
    const ns = String(payload.pvcNamespace || '').trim();
    const candidates = [
      `${origin}/apis/longhorn.io/v1beta1/namespaces/${encodeURIComponent(ns)}/volumes/${encodeURIComponent(volName)}`,
      `${origin}/v1/harvester/longhorn.io.volumes/${encodeURIComponent(volName)}`,
      `${origin}/v1/longhorn.io.volumes/${encodeURIComponent(volName)}`,
    ];
    for (const p of candidates) {
      try {
        const j = await getJsonOnce(p, token, insecure);
        const k = j?.status?.kubernetesStatus?.pvcName || '';
        const pv = j?.status?.kubernetesStatus?.pvName || '';
        if (typeof k === 'string' && k.trim()) {
          pvcName = String(k).trim();
          pvName = typeof pv === 'string' && pv.trim() ? String(pv).trim() : pvName;
          break;
        }
      } catch {}
    }
  }
  if (!pvcName) throw new Error('该卷缺少 PVC 名称，无法挂载');
  const isAttached = (vm: any, pvc: string) => {
    const vols = vm?.spec?.template?.spec?.volumes || [];
    return vols.some((v: any) => v?.persistentVolumeClaim?.claimName === pvc);
  };
  if (!pvName) {
    try {
      const ns = String(payload.pvcNamespace || '').trim();
      const urls = [
        `${origin}/v1/harvester/persistentvolumeclaims/${encodeURIComponent(ns)}/${encodeURIComponent(pvcName)}`,
        `${origin}/api/v1/namespaces/${encodeURIComponent(ns)}/persistentvolumeclaims/${encodeURIComponent(pvcName)}`,
      ];
      for (const u of urls) {
        try {
          const j = await getJsonOnce(u, token, insecure, true);
          const pv = j?.spec?.volumeName || '';
          if (typeof pv === 'string' && pv.trim()) {
            pvName = String(pv).trim();
            break;
          }
        } catch {}
      }
    } catch {}
  }
  // [重要] 根据 Harvester 源码，addVolume API 只接受精简格式 { diskName, volumeSourceName }
  // AddVolumeInput 结构体只有两个字段（见 types.go:37-40），且 bus 被硬编码为 "scsi"（见 handler.go:1231）
  // 该 API 不支持 bus 参数，如果用户需要其他总线类型，需要在挂载后通过修改 VM spec 来实现
  // [总线类型修正函数] 提取为独立函数，确保在所有成功路径都能执行
  // 添加重试机制，因为 addVolume 后磁盘可能需要一些时间才能出现在 VM spec 中
  const updateDiskBusType = async (tag: string, vmCache?: any) => {
    const requestedBus = payload.bus || 'virtio';
    if (!requestedBus || requestedBus === 'scsi') {
      return; // 不需要修正
    }

    // 等待并重试，确保磁盘已经添加到 VM spec 中
    const maxRetries = 5;
    const retryDelay = 1000; // 1秒

    for (let retry = 0; retry < maxRetries; retry++) {
      try {
        console.info(
          `${tag} UPDATING BUS TO ${requestedBus} (attempt ${retry + 1}/${maxRetries})`,
          {
            diskName: volName,
            requestedBus,
            vm: `${namespace}/${name}`,
          },
        );

        // 获取当前 VM spec（如果提供了缓存且是第一次尝试则使用缓存，否则重新获取）
        let vm = retry === 0 && vmCache ? vmCache : null;
        if (!vm) {
          vm = await getHarvesterVM({ endpoint, token, insecure }, namespace, name);
        }
        if (!vm) throw new Error('无法获取 VM 信息');

        // 查找对应的磁盘并修改 bus
        const disks = vm?.spec?.template?.spec?.domain?.devices?.disks || [];
        const diskIndex = disks.findIndex((d: any) => d.name === volName);

        if (diskIndex === -1) {
          if (retry < maxRetries - 1) {
            console.info(`${tag} DISK NOT FOUND YET, RETRYING...`, {
              diskName: volName,
              attempt: retry + 1,
              totalDisks: disks.length,
              diskNames: disks.map((d: any) => d.name),
            });
            await sleep(retryDelay);
            continue;
          }
          throw new Error(`未找到磁盘 ${volName}（已重试 ${maxRetries} 次）`);
        }

        // 检查当前总线类型，如果已经是目标类型则跳过
        const currentBus = disks[diskIndex]?.disk?.bus;
        if (currentBus === requestedBus) {
          console.info(`${tag} BUS ALREADY SET TO ${requestedBus}`, {
            diskName: volName,
            requestedBus,
            vm: `${namespace}/${name}`,
          });
          return;
        }

        // 构造 merge-patch 请求，只修改对应磁盘的 bus
        // 使用 JSON Merge Patch 格式，只发送需要修改的部分
        const patchPayload = {
          spec: {
            template: {
              spec: {
                domain: {
                  devices: {
                    disks: [
                      ...disks.slice(0, diskIndex),
                      {
                        ...disks[diskIndex],
                        disk: {
                          ...(disks[diskIndex].disk || {}),
                          bus: requestedBus,
                        },
                      },
                      ...disks.slice(diskIndex + 1),
                    ],
                  },
                },
              },
            },
          },
        };

        // 使用正确的 KubeVirt API 路径和 Content-Type
        const vmUrl = `${origin}/apis/kubevirt.io/v1/namespaces/${encodeURIComponent(namespace)}/virtualmachines/${encodeURIComponent(name)}`;
        await requestJson('PATCH', vmUrl, token, insecure, patchPayload, {
          'Content-Type': 'application/merge-patch+json',
        });

        console.info(`${tag} BUS UPDATED SUCCESSFULLY`, {
          diskName: volName,
          requestedBus,
          previousBus: currentBus,
          vm: `${namespace}/${name}`,
          note: '修改 bus 可能需要重启生效',
        });

        // 成功，退出重试循环
        return;
      } catch (busErr: any) {
        // 如果是最后一次重试，抛出错误
        if (retry === maxRetries - 1) {
          console.warn(
            `${tag} BUS UPDATE FAILED AFTER ${maxRetries} ATTEMPTS (disk mounted with scsi)`,
            {
              diskName: volName,
              requestedBus: payload.bus || 'virtio',
              error: busErr?.message || busErr,
              errorStatus: busErr?.status,
              vm: `${namespace}/${name}`,
            },
          );
          // 不抛出错误，让挂载操作继续
          return;
        }

        // 如果是 409 Conflict，等待后重试
        if (busErr?.status === 409) {
          console.info(`${tag} BUS UPDATE 409 CONFLICT, RETRYING...`, {
            diskName: volName,
            attempt: retry + 1,
          });
          await sleep(retryDelay);
          continue;
        }

        // 其他错误，等待后重试
        console.warn(`${tag} BUS UPDATE ERROR, RETRYING...`, {
          diskName: volName,
          attempt: retry + 1,
          error: busErr?.message || busErr,
        });
        await sleep(retryDelay);
      }
    }
  };

  const bodies: any[] = [
    {
      diskName: volName,
      volumeSourceName: pvcName,
    },
  ];

  let lastErr: any = null;
  for (let i = 0; i < bodies.length; i++) {
    const body = bodies[i];
    try {
      const tag = 'harvester addVolume direct request';
      console.info(tag, {
        url,
        name: body.name,
        diskBus: body.disk?.bus,
        diskName: body.diskName,
        volumeName: body.volumeName,
        volumeSourceName: body.volumeSourceName,
        claimName: body.volumeSource?.persistentVolumeClaim?.claimName,
        ...(lastErr
          ? { status: Number(lastErr?.status || 0), error: String(lastErr?.message || '') }
          : {}),
      });
      const res = await requestJson('POST', url, token, insecure, body);
      console.info(`${tag} SUCCESS`, {
        url,
        response: res,
        pvcName,
        vm: `${namespace}/${name}`,
      });

      // [总线类型修正] 如果用户指定了 bus 且不是 scsi，需要在挂载后修改 VM spec
      // 注意：Harvester 的 addVolume API 会强制使用 scsi，所以需要额外修改
      // 等待一小段时间，确保磁盘已经添加到 VM spec 中
      if (payload.bus && payload.bus !== 'scsi') {
        await sleep(500); // 等待 500ms，让 Harvester/KubeVirt 完成磁盘添加
        await updateDiskBusType(tag);
      }

      return res;
    } catch (e: any) {
      lastErr = e;
      const s = Number(e?.status || 0);
      const m = String(e?.message || '').toLowerCase();

      const tag =
        i === 0
          ? 'harvester addVolume direct request'
          : i === 1
            ? 'harvester addVolume direct retry'
            : 'harvester addVolume direct fallback';
      console.info(`${tag} FAILED`, {
        url,
        status: s,
        error: m,
        errorDetails: e?.body || e?.message,
        pvcName,
        vm: `${namespace}/${name}`,
      });

      // 兜底：少数场景 Harvester 可能返回 5xx/422，但 addVolume 实际已生效；回查 VM，若已挂载则视为成功
      if (s === 422 || s === 500) {
        try {
          console.info(`${tag} CHECKING VM STATUS (422/500 fallback)`, {
            url,
            pvcName,
            vm: `${namespace}/${name}`,
            willCheckVM: true,
          });
          const vm = await getHarvesterVM({ endpoint, token, insecure }, namespace, name);
          const attached = isAttached(vm, pvcName);
          console.info(`${tag} VM STATUS CHECK RESULT`, {
            url,
            pvcName,
            vm: `${namespace}/${name}`,
            isAttached: attached,
            volumes: (vm?.spec?.template?.spec?.volumes || []).map((v: any) => ({
              name: v.name,
              claimName: v?.persistentVolumeClaim?.claimName,
            })),
          });
          if (attached) {
            console.info(`${tag} RECOVERED (already attached by vm check)`, {
              url,
              pvcName,
              vm: `${namespace}/${name}`,
              attemptIndex: i,
              finalStatus: 'SUCCESS',
            });
            // [重要] 即使是通过恢复路径成功，也需要执行总线类型修正
            // 传递已获取的 VM 对象，避免重复请求和 resourceVersion 不一致
            // 如果用户指定了 bus 且不是 scsi，需要修正总线类型
            if (payload.bus && payload.bus !== 'scsi') {
              await sleep(500); // 等待 500ms，确保磁盘已经完全添加
              await updateDiskBusType(tag, vm);
            }
            return { ok: true, alreadyAttached: true };
          } else {
            console.info(`${tag} VM CHECK FAILED (not attached yet)`, {
              url,
              pvcName,
              vm: `${namespace}/${name}`,
              attemptIndex: i,
              willContinue: true,
            });
          }
        } catch (checkErr: any) {
          console.warn(`${tag} VM STATUS CHECK ERROR`, {
            url,
            pvcName,
            vm: `${namespace}/${name}`,
            checkError: checkErr?.message || checkErr,
            willContinue: true,
          });
          // ignore
        }
      }

      const needContinue =
        s === 422 ||
        s === 500 ||
        m.includes('invalid') ||
        m.includes('required') ||
        s === 404 ||
        m.includes('not found');
      if (!needContinue) throw e;
    }
  }
  if (lastErr) throw lastErr;
};

/**
 * 从虚拟机卸载卷
 *
 * [功能描述]
 * 从指定的虚拟机卸载已挂载的卷，优先使用 Harvester 的 removeVolume action API，失败时回退到直接修改 VM spec。
 *
 * [实现原理]
 * 1. [优先路径]: 调用 Harvester API: POST /v1/harvester/kubevirt.io.virtualmachines/{ns}/{name}?action=removeVolume
 *    请求体包含磁盘名称（name、volumeName、diskName 三个字段都设置为磁盘名称，确保兼容性）。
 * 2. [回退路径]: 如果 removeVolume API 失败且错误提示 "not hotpluggable"，则直接修改 VM spec：
 *    - 从 spec.template.spec.domain.devices.disks 中移除对应的磁盘
 *    - 从 spec.template.spec.volumes 中移除对应的卷
 *    - 更新 volumeClaimTemplates annotation（如果有）
 *    - 使用 PATCH 请求更新 VM spec
 *
 * [并发控制]
 * 实现重试机制处理 Kubernetes 409 Conflict 错误。
 * 当资源在获取和更新之间被其他操作修改时，Kubernetes 会返回 409。
 * 此时会等待一小段时间后重试，最多重试 3 次。
 *
 * [热插拔说明]
 * - **Harvester 的 addVolume/removeVolume 都是修改 spec.template.spec.volumes**
 * - 即使设置了 Hotpluggable: true，修改 spec.template 通常也需要重启 VM 才能生效
 * - 某些卷（如创建 VM 时添加的卷）可能没有 Hotpluggable: true 标记，无法通过 removeVolume API 删除
 * - 本函数通过回退到直接修改 VM spec 的方式，可以处理所有类型的卷
 *
 * [注意事项]
 * - 卸载卷后，VM 将无法访问该卷的数据
 * - 卷本身不会被删除，只是从 VM 中移除
 * - **重启要求**：修改 spec.template 通常会导致 KubeVirt 设置 RestartRequired condition
 * - 因此删除卷操作通常需要重启 VM 才能生效
 *
 * @param params Harvester 连接参数
 * @param instanceId 虚拟机实例标识（支持 ns/name、ns:name 或 InstanceId）
 * @param payload 卸载参数
 *   - name: 磁盘名称（必填）
 * @param maxRetries 最大重试次数，默认为 3
 * @returns API 响应结果
 */
export const harvesterRemoveVolumeFromVM = async (
  { endpoint, token, insecure = false }: HarvesterTestParams,
  instanceId: string,
  payload: { name: string },
  maxRetries: number = 5, // 增加重试次数，处理添加磁盘后立即解绑的场景
) => {
  const base = (endpoint || '').replace(/\/+$/, '');
  let origin = base;
  try {
    const u = new URL(base);
    origin = `${u.protocol}//${u.host}`;
  } catch {
    origin = base.replace(/\/v[0-9].*$/, '');
  }
  const path = await resolveVmPath({ endpoint, token, insecure }, instanceId);
  if (!path) throw new Error('无法解析实例标识');
  const url = `${origin}/v1/harvester/kubevirt.io.virtualmachines/${encodeURIComponent(path.namespace)}/${encodeURIComponent(path.name)}?action=removeVolume`;
  // Harvester/KubeVirt requires volumeName (or diskName) in the body
  const body = { name: payload.name, volumeName: payload.name, diskName: payload.name };

  // [并发控制] 实现重试机制，处理 Kubernetes 409 Conflict 错误
  let retryCount = 0;
  while (retryCount < maxRetries) {
    try {
      return await requestJson('POST', url, token, insecure, body);
    } catch (error: any) {
      // [409 Conflict] 资源版本冲突，需要重试
      // 但 409 也可能意味着操作已经成功（资源版本冲突但操作已完成）
      if (error?.status === 409) {
        // 先检查磁盘是否已经被删除（操作可能已经成功）
        try {
          const checkVm = await getHarvesterVM(
            { endpoint, token, insecure },
            path.namespace,
            path.name,
          );
          if (checkVm) {
            const checkDisks = checkVm?.spec?.template?.spec?.domain?.devices?.disks || [];
            const diskStillExists = checkDisks.some((d: any) => d.name === payload.name);
            if (!diskStillExists) {
              // 磁盘已经被删除，操作实际上已经成功
              console.info(
                `[Harvester removeVolume] 检测到 409 Conflict，但磁盘已不存在，操作已成功`,
                {
                  vm: `${path.namespace}/${path.name}`,
                  diskName: payload.name,
                },
              );
              return { ok: true, alreadyRemoved: true };
            }
          }
        } catch (checkErr: any) {
          // 检查失败，继续重试流程
          console.warn(`[Harvester removeVolume] 检查磁盘状态失败`, checkErr);
        }

        retryCount++;
        if (retryCount >= maxRetries) {
          throw {
            status: 409,
            message: `操作无法完成：虚拟机 "${path.name}" 对象有更新；请更新到最新的版本后重试`,
            body: error.body || error.message,
          };
        }

        console.info(
          `[Harvester removeVolume] 检测到 409 Conflict，重试 ${retryCount}/${maxRetries}...`,
          {
            vm: `${path.namespace}/${path.name}`,
            diskName: payload.name,
          },
        );

        // 等待一小段时间，避免立即重试（递增延迟，确保添加磁盘操作完全完成）
        const delay = Math.min(500 * retryCount, 2000); // 最多等待 2 秒，延迟递增
        console.info(`[Harvester removeVolume] 等待 ${delay}ms 后重试...`, {
          vm: `${path.namespace}/${path.name}`,
          diskName: payload.name,
          retryCount,
        });
        await new Promise((resolve) => setTimeout(resolve, delay));
        continue;
      }

      // [回退逻辑] 如果错误提示卷不是可热插拔的，回退到直接修改 VM spec
      // 错误信息可能在 error.message、error.body（字符串）或 error.body.message 中
      // 需要检查所有可能的错误信息位置
      let errorMsg = '';
      if (error?.message) {
        errorMsg = String(error.message);
      } else if (typeof error?.body === 'string') {
        errorMsg = error.body;
      } else if (error?.body?.message) {
        errorMsg = String(error.body.message);
      } else if (typeof error?.body === 'object') {
        // 尝试从对象中提取错误信息
        errorMsg = JSON.stringify(error.body);
        // 如果 body 中有 error 字段，也检查
        if (error.body.error) {
          errorMsg += ' ' + String(error.body.error);
        }
      }

      // 将所有错误信息合并成一个字符串进行检查
      const allErrorText = [
        errorMsg,
        error?.status ? `status: ${error.status}` : '',
        JSON.stringify(error || {}),
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();

      // 检查错误信息中是否包含 "not hotpluggable" 相关提示
      const isNotHotpluggable =
        allErrorText.includes('not hotpluggable') ||
        allErrorText.includes('not hot-pluggable') ||
        allErrorText.includes('unable to remove volume') ||
        allErrorText.includes('because it is not hotpluggable');

      // 记录错误详情（用于调试）
      console.info(`[Harvester removeVolume] 捕获错误`, {
        vm: `${path.namespace}/${path.name}`,
        diskName: payload.name,
        status: error?.status,
        errorMsg: errorMsg.substring(0, 300),
        allErrorText: allErrorText.substring(0, 300),
        isNotHotpluggable,
        errorKeys: Object.keys(error || {}),
        errorBodyType: typeof error?.body,
      });

      if (isNotHotpluggable) {
        console.info(`[Harvester removeVolume] 卷不是可热插拔的，回退到直接修改 VM spec`, {
          vm: `${path.namespace}/${path.name}`,
          diskName: payload.name,
        });

        // 回退到直接修改 VM spec
        return await removeVolumeByPatchingSpec(
          { endpoint, token, insecure },
          path.namespace,
          path.name,
          payload.name,
          maxRetries,
        );
      }

      // 其他错误直接抛出
      throw error;
    }
  }

  throw new Error('卸载卷失败：达到最大重试次数');
};

/**
 * 通过直接修改 VM spec 删除卷（回退方案）
 *
 * [功能描述]
 * 当 removeVolume API 失败时，直接修改 VM spec 删除卷和磁盘。
 * 参考 Harvester 源码 handler.go:removeVolume 的实现。
 *
 * @param params Harvester 连接参数
 * @param namespace VM 命名空间
 * @param name VM 名称
 * @param diskName 磁盘名称
 * @param maxRetries 最大重试次数
 */
const removeVolumeByPatchingSpec = async (
  { endpoint, token, insecure = false }: HarvesterTestParams,
  namespace: string,
  name: string,
  diskName: string,
  maxRetries: number = 5, // 增加重试次数，处理添加磁盘后立即解绑的场景
) => {
  const base = (endpoint || '').replace(/\/+$/, '');
  let origin = base;
  try {
    const u = new URL(base);
    origin = `${u.protocol}//${u.host}`;
  } catch {
    origin = base.replace(/\/v[0-9].*$/, '');
  }

  let retryCount = 0;
  while (retryCount < maxRetries) {
    try {
      // 获取当前 VM spec
      const vm = await getHarvesterVM({ endpoint, token, insecure }, namespace, name);
      if (!vm) throw new Error(`无法获取虚拟机 ${namespace}/${name}`);

      // 查找要删除的磁盘和卷
      const oldDisks = vm?.spec?.template?.spec?.domain?.devices?.disks || [];
      const oldVolumes = vm?.spec?.template?.spec?.volumes || [];

      // 检查磁盘是否存在
      // 如果磁盘已经不存在，说明操作已经成功（可能是之前的重试已经成功）
      const diskExists = oldDisks.some((d: any) => d.name === diskName);
      if (!diskExists) {
        console.info(`[Harvester removeVolume] 磁盘 "${diskName}" 已不存在，操作已成功`, {
          vm: `${namespace}/${name}`,
          diskName,
        });
        return { ok: true, alreadyRemoved: true };
      }

      // 构建新的 disks 和 volumes 列表（排除要删除的磁盘）
      const newDisks = oldDisks.filter((d: any) => d.name !== diskName);
      const newVolumes = oldVolumes.filter((v: any) => v.name !== diskName);

      // 查找要删除的卷的 PVC 名称（用于更新 annotation）
      const volumeToRemove = oldVolumes.find((v: any) => v.name === diskName);
      const toRemoveClaimNames: string[] = [];
      if (volumeToRemove?.persistentVolumeClaim?.claimName) {
        toRemoveClaimNames.push(volumeToRemove.persistentVolumeClaim.claimName);
      }

      // 使用 PATCH + merge-patch，只更新需要删除的磁盘和卷
      // 这样不会影响其他数据盘的挂载状态
      // 构建 PATCH payload，只包含需要修改的字段
      const patchPayload = {
        spec: {
          template: {
            spec: {
              domain: {
                devices: {
                  disks: newDisks, // 只更新 disks 数组，移除要删除的磁盘
                },
              },
              volumes: newVolumes, // 只更新 volumes 数组，移除要删除的卷
            },
          },
        },
      };

      // 如果有 volumeClaimTemplates annotation，需要更新它
      // 注意：这里简化处理，实际 Harvester 的 removeVolumeClaimTemplatesFromVMAnnotation 逻辑更复杂
      // 如果遇到问题，可能需要实现完整的 annotation 更新逻辑

      // 执行 PATCH 请求（使用 merge-patch，只更新指定字段，不影响其他数据盘）
      const vmUrl = `${origin}/apis/kubevirt.io/v1/namespaces/${encodeURIComponent(namespace)}/virtualmachines/${encodeURIComponent(name)}`;
      const result = await requestJson('PATCH', vmUrl, token, insecure, patchPayload, {
        'Content-Type': 'application/merge-patch+json',
      });

      console.info(`[Harvester removeVolume] 通过修改 VM spec 成功删除卷`, {
        vm: `${namespace}/${name}`,
        diskName,
        note: '设置已保存，需要重启 VM 才能生效',
      });

      return result;
    } catch (error: any) {
      // [409 Conflict] 资源版本冲突，需要重试
      if (error?.status === 409) {
        retryCount++;

        console.info(
          `[Harvester removeVolume] 检测到 409 Conflict，重试 ${retryCount}/${maxRetries}...`,
          {
            vm: `${namespace}/${name}`,
            diskName,
            errorMsg: error?.message || error?.body,
          },
        );

        if (retryCount >= maxRetries) {
          // 达到最大重试次数，先检查磁盘是否已经被删除（可能操作已经成功）
          try {
            const checkVm = await getHarvesterVM({ endpoint, token, insecure }, namespace, name);
            if (checkVm) {
              const checkDisks = checkVm?.spec?.template?.spec?.domain?.devices?.disks || [];
              const diskStillExists = checkDisks.some((d: any) => d.name === diskName);
              if (!diskStillExists) {
                // 磁盘已经被删除，操作实际上已经成功
                console.info(
                  `[Harvester removeVolume] 达到最大重试次数，但磁盘已不存在，操作已成功`,
                  {
                    vm: `${namespace}/${name}`,
                    diskName,
                  },
                );
                return { ok: true, alreadyRemoved: true };
              }
            }
          } catch (checkErr: any) {
            // 检查失败，继续抛出原始错误
            console.warn(`[Harvester removeVolume] 检查磁盘状态失败`, checkErr);
          }

          // 提取错误信息
          const errorMsg = error?.body?.message || error?.body || error?.message || '';
          const errorStr = typeof errorMsg === 'string' ? errorMsg : JSON.stringify(errorMsg);

          throw {
            status: 409,
            message: `操作无法完成：虚拟机 "${name}" 对象有更新；请更新到最新的版本后重试`,
            body: errorStr,
          };
        }

        // 等待一小段时间，避免立即重试（递增延迟，避免频繁重试）
        // 增加延迟时间，确保添加磁盘操作完全完成后再重试
        const delay = Math.min(500 * (retryCount + 1), 3000); // 最多等待 3 秒，延迟递增
        console.info(`[Harvester removeVolume] 等待 ${delay}ms 后重试...`, {
          vm: `${namespace}/${name}`,
          diskName,
          retryCount,
        });
        await new Promise((resolve) => setTimeout(resolve, delay));
        continue;
      }

      // 其他错误直接抛出
      throw error;
    }
  }

  throw new Error('卸载卷失败：达到最大重试次数');
};
