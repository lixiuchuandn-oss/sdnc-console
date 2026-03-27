/**
 * @file useVmReconfigure.ts
 * @description Harvester 虚拟机变配弹窗（VmReconfigureModal）的状态与提交逻辑 Hook。
 *
 * ## 职责
 * - 管理变配表单、左侧功能项 `selectedKey`、以及镜像/存储类/GPU/USB/NAD/VPC/子网/节点等资源列表状态。
 * - 弹窗打开时通过聚合接口刷新 `latestVm`（含 related.volumes），供解绑磁盘等子组件使用。
 * - 随 `selectedKey` 切换重置并回填表单（与创建向导字段对齐的变配语义）。
 * - `handleSubmit` 按当前菜单分支调用更新 VM / 卷 / 策略等 API；部分操作后提示重启（`openRestartConfirm` / `maybePromptRestart`）。
 *
 * ## 模块级函数（文件顶部，Hook 外）
 * | 函数 | 用途 |
 * |------|------|
 * | `parseQuantity` | 将 K8s 资源量字符串（如 1Gi、500Mi）解析为字节数。 |
 * | `hasDuplicateFlatSubnetsInNetworks` | 检查 networks 中 Kube-OVN 扁平子网是否被多块网卡重复使用。 |
 * | `allocateSecondaryNicNames` | 为辅网卡生成 `nic-N` 名称，避免与主网卡及其它辅卡冲突。 |
 *
 * ## Hook 内主要函数（节选）
 * | 函数 | 用途 |
 * |------|------|
 * | `getCurrentSpec` | 从 VM 清单解析当前 CPU/内存及热插拔相关上限，供表单初值。 |
 * | `loadSystemDiskSize` | 读取系统盘 PVC 容量并写入表单（扩系统盘步骤）。 |
 * | `getParsedNetworkData` | 解析 cloud-init networkData（YAML）为对象，用于静态 IP 等。 |
 * | `getQuantityInGi` / `getMemoryInGi` | 资源量转 GiB 整数，供展示与表单。 |
 * | `reloadNads` / `reloadVpcs` / `reloadSubnets` 等 | 拉取集群网络与节点数据。 |
 * | `ensureNadsLoaded` | 若内存无 NAD 列表则先拉取。 |
 * | `getMissingNadsFromNetworks` | 根据 VM networks 解析 multus 引用，返回集群中不存在的 NAD。 |
 * | `generateMacAddress` | 生成随机 MAC（静态 IP 且未填 MAC 时使用）。 |
 * | `openRestartConfirm` | 变更需重启时弹出确认框，可选立即调用云主机重启 API。 |
 * | `isRestartRequiredFromVm` | 判断 VM status.conditions 是否含 RestartRequired。 |
 * | `isVmStopped` | 判断是否关机，用于跳过「立即重启」提示。 |
 * | `fetchAggregatedVm` | 拉取聚合 VM 并写回 `latestVm`。 |
 * | `maybePromptRestart` | 提交后短暂延迟再拉取 VM，若需重启且未关机则弹确认。 |
 * | `handleSubmit` | 主提交：按 `selectedKey` 分支处理各类变配（见函数上方分支说明）。 |
 * | `handleCreateDisk` / `handleAttachDisk` | 添加数据盘：创建 PVC 或挂载已有卷。 |
 * | `handleDetachDisk` | 解绑数据盘。 |
 * | `refreshVm` | 手动刷新聚合 VM 数据。 |
 */
import { useState, useEffect, useMemo } from 'react';
import { Form, message, Modal } from 'antd';
import yaml from 'js-yaml';
import {
  updateHarvesterVmSpec,
  createHarvesterVolume,
  attachHarvesterVolumeToVm,
  fetchHarvesterGpuResources,
  fetchHarvesterUsbResources,
  patchHarvesterVm,
  fetchHarvesterNads,
  fetchKubeOvnVpcs,
  fetchKubeOvnSubnets,
  fetchHarvesterImages,
  fetchHarvesterStorageClasses,
  fetchHarvesterVolume,
  fetchHarvesterVmDetail,
  updateHarvesterVolume,
  fetchHarvesterAvailableVolumes,
  detachHarvesterVolumeFromVm,
  fetchHarvesterVMAggregated,
  fetchHarvesterNodes,
} from '../../../../../services/harvesterApi';
import { rebootCloudProviderEcs } from '../../../../../services/api';

/** 将 Kubernetes 资源量字符串（如 `1Gi`、`500Mi`、`1000`）解析为字节数。 */
const parseQuantity = (s: string | number | undefined): number => {
  if (typeof s === 'number') return s;
  if (!s) return 0;
  const str = String(s);
  const units: Record<string, number> = {
    'Ki': 1024, 'Mi': 1024**2, 'Gi': 1024**3, 'Ti': 1024**4, 'Pi': 1024**5,
    'k': 1000, 'M': 1000**2, 'G': 1000**3, 'T': 1000**4, 'P': 1000**5
  };
  for (const [u, m] of Object.entries(units)) {
    if (str.endsWith(u)) {
      return parseFloat(str.slice(0, -u.length)) * m;
    }
  }
  return parseFloat(str);
};

/** 全部 multus 网络中，Kube-OVN 扁平子网（tower.io/subnet-type=flat）是否重复使用 */
function hasDuplicateFlatSubnetsInNetworks(networks: any[], subnetInventory: any[]): boolean {
  const names: string[] = [];
  for (const n of networks || []) {
    const nn = n?.multus?.networkName;
    if (!nn) continue;
    const raw = String(nn);
    const name = raw.includes('/') ? raw.split('/').pop() || '' : raw;
    if (!name) continue;
    const s = subnetInventory.find((x: any) => x?.metadata?.name === name);
    const t = String(s?.metadata?.annotations?.['tower.io/subnet-type'] || '').trim().toLowerCase();
    if (t === 'flat') names.push(name);
  }
  return new Set(names).size !== names.length;
}

/**
 * 为辅网卡分配 nic-N 名称：从 nic-1、nic-2… 中取最小可用编号，保证不与主网卡名冲突。
 * Harvester 等底座常把第一块网卡命名为 nic-1，若仍固定辅卡为 nic-1 会与主卡重名。
 */
function allocateSecondaryNicNames(primaryIfaceName: string, count: number): string[] {
  const used = new Set<string>();
  if (primaryIfaceName) used.add(primaryIfaceName);
  const out: string[] = [];
  let n = 1;
  for (let i = 0; i < count; i++) {
    while (used.has(`nic-${n}`)) n++;
    const name = `nic-${n}`;
    used.add(name);
    out.push(name);
    n++;
  }
  return out;
}

/**
 * 虚拟机变配主 Hook：供 VmReconfigureModal 使用。
 * @param props.open - 弹窗是否打开
 * @param props.cloudId - 资源池 ID
 * @param props.record - 当前 VM 行/CR 数据
 * @param props.onClose - 关闭回调
 * @param props.onOk - 变更成功后的回调（部分流程会传 `true` 表示需刷新列表）
 * @param props.storageClasses / images / gpuResources - 外部传入时可避免重复请求
 * @param props.initialConfigType - 打开弹窗时默认选中的菜单项（如 `change_spec`）
 */
export const useVmReconfigure = (props: any) => {
  const { 
    open, cloudId, record, onClose, onOk, 
    storageClasses: propStorageClasses, images: propImages, gpuResources: propGpuResources, 
    initialConfigType 
  } = props;

  const [form] = Form.useForm();
  // 添加数据盘：创建/挂载两步按钮的 loading 状态
  const [diskCreating, setDiskCreating] = useState(false);
  const [diskAttaching, setDiskAttaching] = useState(false);
  // 添加数据盘：可选择"已有磁盘(PVC)"进行挂载
  const [availableDiskPvcs, setAvailableDiskPvcs] = useState<any[]>([]);
  // 解绑数据盘：loading 状态
  const [diskDetaching, setDiskDetaching] = useState(false);
  
  // Flattened state: just track the selected menu key
  const [selectedKey, setSelectedKey] = useState<string>('change_spec');
  
  // Resource states
  const [scs, setScs] = useState<any[]>([]);
  const [images, setImages] = useState<any[]>([]);
  const [gpuResources, setGpuResources] = useState<any[]>([]);
  const [selectedGpuKeys, setSelectedGpuKeys] = useState<string[]>([]);
  const [usbResources, setUsbResources] = useState<any[]>([]);
  const [selectedUsbKeys, setSelectedUsbKeys] = useState<string[]>([]);
  const [nads, setNads] = useState<any[]>([]);
  const [vpcs, setVpcs] = useState<any[]>([]);
  const [subnets, setSubnets] = useState<any[]>([]);
  const [nodes, setNodes] = useState<any[]>([]);
  const [gpuLoading, setGpuLoading] = useState<boolean>(false);
  const [usbLoading, setUsbLoading] = useState<boolean>(false);
  const [systemDiskSize, setSystemDiskSize] = useState<number | null>(null);
  const [systemDiskLoading, setSystemDiskLoading] = useState<boolean>(false);

  // --- Add VM Refresh Logic ---
  const [latestVm, setLatestVm] = useState<any>(null);

  useEffect(() => {
    if (open && cloudId && record?.metadata?.name && record?.metadata?.namespace) {
       // 使用聚合接口获取 VM 及关联资源（包括 related.volumes），与虚拟卷详情页保持一致
       fetchHarvesterVMAggregated(cloudId, record.metadata.namespace, record.metadata.name)
         .then((res: any) => {
            // [兼容返回结构] 支持 { data: { vm, related } } 与 { vm, related } 两种形态
            const data = res?.data?.vm ? res.data : res;
            
            // 合并 vm 和 related 数据到 latestVm，确保 DetachDataDisk 组件能获取到 related.volumes
            const updatedVm = data?.vm || data;
            if (updatedVm && data?.related) {
              updatedVm.related = data.related;
            }
            
            setLatestVm(updatedVm);
         })
         .catch((err: any) => {
            console.error('Failed to fetch aggregated VM data:', err);
            // 如果聚合接口失败，回退到普通接口
            fetchHarvesterVmDetail(cloudId, record.metadata.namespace, record.metadata.name)
              .then((res: any) => {
                setLatestVm(res?.data || res);
              })
              .catch((fallbackErr: any) => {
                console.error('回退获取也失败:', fallbackErr);
              });
         });
    }
  }, [open, cloudId, record]);

  const activeRecord = latestVm || record;

  const { systemDisk } = useMemo(() => {
    if (!activeRecord) return { systemDisk: '' };
    
    const disks = activeRecord?.spec?.template?.spec?.domain?.devices?.disks || [];
    const volumes = activeRecord?.spec?.template?.spec?.volumes || [];
    
    // 1. Identify System Disk (Boot Disk)
    let sysDiskPvc = '';
    // Priority 1: Boot Order 1 AND Not CDROM
    let bootDisk = disks.find((d: any) => d.bootOrder === 1 && !d.cdrom);
    
    // Priority 2: Named 'disk-0' AND Not CDROM
    if (!bootDisk) bootDisk = disks.find((d: any) => d.name === 'disk-0' && !d.cdrom);

    // Priority 3: Named 'rootdisk' AND Not CDROM (Common in some templates)
    if (!bootDisk) bootDisk = disks.find((d: any) => d.name === 'rootdisk' && !d.cdrom);

    // Priority 4: First non-CDROM disk
    if (!bootDisk && disks.length > 0) bootDisk = disks.find((d: any) => !d.cdrom);
    
    // Debug log for troubleshooting
    // 磁盘检测逻辑
    
    if (bootDisk) {
       const volume = volumes.find((v: any) => v.name === bootDisk.name);
       if (volume?.persistentVolumeClaim?.claimName) {
          sysDiskPvc = volume.persistentVolumeClaim.claimName;
       }
    }
    // Fallback to backend enriched field if not found in spec
    if (!sysDiskPvc) sysDiskPvc = record?.volumeClaims?.[0] || '';

    return { systemDisk: sysDiskPvc };
  }, [record, activeRecord]);

  /** 读取系统盘 PVC 的容量并写入表单字段 `systemDiskSize`（扩系统盘菜单使用）。 */
  const loadSystemDiskSize = async () => {
    if (!systemDisk || !record?.metadata?.namespace) return;
    try {
      setSystemDiskLoading(true);
      const res = await fetchHarvesterVolume(cloudId, record.metadata.namespace, systemDisk);
       const data = res?.data || res;
       // Prefer spec.resources.requests (user intent) over status.capacity (actual/current)
       // This avoids issues where status reflects underlying image size before resize is complete
       const cap = data?.spec?.resources?.requests?.storage || data?.status?.capacity?.storage;
       if (cap) {
         const sizeGi = getQuantityInGi(cap);
         setSystemDiskSize(sizeGi);
         form.setFieldsValue({ systemDiskSize: sizeGi });
       }
     } catch (e) {
      console.error('Failed to load system disk size', e);
    } finally {
      setSystemDiskLoading(false);
    }
  };

  // Delete old diskClaims useMemo

  // --- State Sync & Initialization (状态同步与初始化) ---
  // Sync props to state (同步外部资源数据)
  useEffect(() => { setScs(propStorageClasses || []); }, [propStorageClasses]);
  useEffect(() => { setImages(propImages || []); }, [propImages]);
  useEffect(() => { setGpuResources(propGpuResources || []); }, [propGpuResources]);

  // Handle initial config type (处理初始选中项)
  useEffect(() => {
    if (open && initialConfigType) {
      setSelectedKey(initialConfigType === 'mem_advanced' ? 'cpu_advanced' : initialConfigType);
    } else if (open && !initialConfigType) {
      setSelectedKey('change_spec');
    }
  }, [open, initialConfigType]);

  /**
   * 从 `record` / `activeRecord` 解析当前 CPU/内存及热插拔上限（maxSockets、maxMemory 等），
   * 供「调整规格」「热插拔设置」「CPU 高级」等表单的初始值。
   */
  const getCurrentSpec = () => {
    let cpu = record?.Extra?.CPU;
    let mem = record?.Extra?.Memory;
    
    // Retrieve maxSockets and maxMemory from the active record (latest state)
    const domain = activeRecord?.spec?.template?.spec?.domain;
    const maxSockets = domain?.cpu?.maxSockets;
    const maxMemory = domain?.memory?.maxGuest;

    if (cpu === undefined || cpu === null) {
       const sockets = domain?.cpu?.sockets || 1;
       const cores = domain?.cpu?.cores || 1;
       const threads = domain?.cpu?.threads || 1;
       cpu = sockets * cores * threads;
    }
    
    // [Harvester 兼容] 在热扩容模式下，优先使用 domain.memory.guest
    // 复刻 Harvester 逻辑：通过 Annotation 判断热扩容状态
    // 如果启用了热扩容，domain.memory.guest 不会被 mutator 修改，是用户实际设置的值
    const annotations = activeRecord?.metadata?.annotations || {};
    const isHotPlug = annotations['harvesterhci.io/enableCPUAndMemoryHotplug']?.toLowerCase() === 'true';
    if (mem === undefined || mem === null || isHotPlug) {
      // 热扩容模式下，优先使用 domain.memory.guest
      mem = activeRecord?.spec?.template?.spec?.domain?.memory?.guest;
      // 如果没有 guest 内存，再使用 requests.memory（非热扩容模式）
      if (!mem && !isHotPlug) {
        mem = activeRecord?.spec?.template?.spec?.domain?.resources?.requests?.memory;
      }
    }
    return { cpu: Number(cpu || 0), memory: mem, maxSockets, maxMemory };
  };

  /** 生成随机本地管理 MAC（52:54:00 前缀），用于静态 IP 且未指定 MAC 的网卡。 */
  const generateMacAddress = () => {
    const hex = '0123456789ABCDEF';
    let mac = '52:54:00'; 
    for (let i = 0; i < 3; i++) {
      mac += ':' + hex[Math.floor(Math.random() * 16)] + hex[Math.floor(Math.random() * 16)];
    }
    return mac;
  };

  /**
   * 从 VM 的 cloud-init volume 中解析 `networkData`（YAML），失败时返回空 ethernets 结构。
   * 用于读写静态 IP、网关、DNS 等。
   */
  const getParsedNetworkData = (vm: any) => {
    try {
      const volumes = vm?.spec?.template?.spec?.volumes || [];
      const ciVol = volumes.find((v: any) => v.cloudInitNoCloud);
      if (ciVol && ciVol.cloudInitNoCloud.networkData) {
        return yaml.load(ciVol.cloudInitNoCloud.networkData) as any;
      }
    } catch (e) {
      console.warn('Failed to parse existing networkData', e);
    }
    return { network: { version: 2, ethernets: {} } };
  };

  /** 将任意资源量字符串转为 GiB 整数（向上取整）。 */
  const getQuantityInGi = (q: string | number | undefined): number => {
    const bytes = parseQuantity(q);
    if (!bytes) return 0;
    return Math.ceil(bytes / (1024 ** 3));
  };

  /** 将内存量字符串转为 GiB 整数（向上取整），与 `getQuantityInGi` 语义一致。 */
  const getMemoryInGi = (memStr: string | number | undefined): number => {
    const bytes = parseQuantity(memStr);
    if (!bytes) return 0;
    // Always round up to next GiB to ensure user sees integer GiB if close enough, or CEIL if it was MiB
    return Math.ceil(bytes / (1024 ** 3));
  };

  /** 是否开启 CPU/内存热插拔（仅看 Annotation，与当前是否可热插无关）。 */
  const isHotPlugConfiguredOnVm = useMemo(() => {
    const annotations = activeRecord?.metadata?.annotations || {};
    return annotations['harvesterhci.io/enableCPUAndMemoryHotplug']?.toLowerCase() === 'true';
  }, [activeRecord]);

  /** 当前是否允许走热插拔调整（已配置热插且无异步重启/热插进行中条件）。 */
  const isHotPlugEnabledOnVm = useMemo(() => {
    if (!isHotPlugConfiguredOnVm) return false;

    const conditions = activeRecord?.status?.conditions || [];
    const isRestartRequired = conditions.some((c: any) => c.type === 'RestartRequired' && c.status === 'True');
    const isHotPlugInProgress = conditions.some((c: any) => (c.type === 'HotVCPUChange' || c.type === 'HotMemoryChange') && c.status === 'True');

    // 存在待重启或正在热扩容中的条件时，本次不允许再走热扩容路径
    if (isRestartRequired || isHotPlugInProgress) return false;

    return true;
  }, [isHotPlugConfiguredOnVm, activeRecord]);

  /** status 中是否处于 HotVCPUChange / HotMemoryChange 进行中。 */
  const isHotPlugInProgress = useMemo(() => {
    const conditions = activeRecord?.status?.conditions || [];
    return conditions.some((c: any) => (c.type === 'HotVCPUChange' || c.type === 'HotMemoryChange') && c.status === 'True');
  }, [activeRecord]);

  /** 拉取集群 NetworkAttachmentDefinition 列表并写入 `nads`。 */
  const reloadNads = async () => {
    try {
      const res = await fetchHarvesterNads(cloudId);
      const items = res?.data?.items || res?.items || [];
      setNads(items);
      return items;
    } catch (e) { console.error(e); return []; }
  };

  /** 若内存中已有 NAD 则直接返回，否则调用 `reloadNads`。提交前校验引用完整性时使用。 */
  const ensureNadsLoaded = async () => {
    if (Array.isArray(nads) && nads.length > 0) return nads;
    return await reloadNads();
  };

  /**
   * 从 VM 的 `networks[].multus.networkName` 解析出 NAD 引用，与 `nadList` 比对，
   * 返回集群中不存在的 `namespace/name` 列表（用于提交前拦截无效网络）。
   */
  const getMissingNadsFromNetworks = (networks: any[], vmNamespace: string, nadList: any[]) => {
    const list = Array.isArray(nadList) ? nadList : [];
    const getNs = (x: any) => x?.metadata?.namespace || x?.namespace || '';
    const getName = (x: any) => x?.metadata?.name || x?.name || '';
    const hasNad = (ns: string, name: string) =>
      list.some((x: any) => String(getNs(x)) === String(ns) && String(getName(x)) === String(name));

    return (Array.isArray(networks) ? networks : [])
      .map((n: any) => n?.multus?.networkName)
      .filter(Boolean)
      .map((raw: any) => String(raw))
      .map((s: string) => (s.includes('@') ? s.split('@')[0] : s))
      .map((s: string) => {
        const parts = s.split('/');
        if (parts.length > 1) return { namespace: parts[0], name: parts[1] };
        const shortName = parts[0];
        const matched = list.filter((x: any) => String(getName(x)) === String(shortName));
        if (matched.length === 1) return { namespace: getNs(matched[0]), name: shortName };
        return { namespace: vmNamespace, name: shortName };
      })
      .filter((ref: any) => ref?.name && ref?.namespace)
      .filter((ref: any) => !hasNad(ref.namespace, ref.name))
      .map((ref: any) => `${ref.namespace}/${ref.name}`);
  };

  /** 拉取 Kube-OVN VPC 列表。 */
  const reloadVpcs = async () => {
    try { 
      const res = await fetchKubeOvnVpcs(cloudId); 
      const items = res?.data?.items || res?.items || [];
      setVpcs(items); 
      return items;
    } catch (e) { console.error(e); return []; }
  };
  /** 拉取 Kube-OVN Subnet 列表。 */
  const reloadSubnets = async () => {
    try { 
      const res = await fetchKubeOvnSubnets(cloudId); 
      const items = res?.data?.items || res?.items || [];
      setSubnets(items); 
      return items;
    } catch (e) { console.error(e); return []; }
  };

  /** 拉取集群节点列表（调度/节点选择等）。 */
  const reloadNodes = async () => {
    try {
      const res = await fetchHarvesterNodes(cloudId);
      const items = res?.data?.items || res?.items || (Array.isArray(res?.data) ? res.data : []);
      setNodes(Array.isArray(items) ? items : []);
      return items;
    } catch (e: any) {
      console.error('Failed to reload nodes:', e);
      return [];
    }
  };

  /** 拉取镜像列表。 */
  const reloadImages = async () => {
    try {
      const res = await fetchHarvesterImages(cloudId);
      const items = Array.isArray(res?.data?.items) ? res.data.items : (Array.isArray(res?.items) ? res.items : []);
      setImages(items);
    } catch (e) { console.error(e); }
  };

  /** 拉取 StorageClass 列表。 */
  const reloadScs = async () => {
    try {
      const res = await fetchHarvesterStorageClasses(cloudId);
      const items = Array.isArray(res?.data?.items) ? res.data.items : (Array.isArray(res?.items) ? res.items : []);
      setScs(items);
    } catch (e) { console.error(e); }
  };

  /** 拉取 GPU 设备资源列表（含 loading 状态）。 */
  const reloadGpuResources = async () => {
    try {
      setGpuLoading(true);
      const res = await fetchHarvesterGpuResources(cloudId);
      const items = Array.isArray(res?.data?.items) ? res.data.items : (Array.isArray(res?.items) ? res.items : []);
      setGpuResources(items);
    } catch (e: any) {
      message.error(e?.message || '刷新失败');
    } finally {
      setGpuLoading(false);
    }
  };

  /** 拉取 USB 透传设备列表（含 loading 状态）。 */
  const reloadUsbResources = async () => {
    try {
      setUsbLoading(true);
      const res = await fetchHarvesterUsbResources(cloudId);
      const items = Array.isArray(res?.data?.items) ? res.data.items : (Array.isArray(res?.items) ? res.items : []);
      setUsbResources(items);
    } catch (e: any) {
      message.error(e?.message || '刷新失败');
    } finally {
      setUsbLoading(false);
    }
  };

  // Handle form reset and initialization on tab switch
  useEffect(() => {
    if (!open) return;
    
    // Reset all fields when switching tabs to ensure "Single Selection" / "Single Task" isolation
    // 切换功能菜单时，强制重置表单，防止配置冲突
    form.resetFields();
    setSelectedGpuKeys([]);
    setSelectedUsbKeys([]);

    if (!record) return;

    // Re-populate initial values for specific tabs
    switch (selectedKey) {
      case 'expand_system_disk': {
         loadSystemDiskSize();
         break;
      }
      case 'change_spec': {
        const { cpu, memory } = getCurrentSpec();
        const memGi = getMemoryInGi(memory);

        const cpuSpec = record?.spec?.template?.spec?.domain?.cpu;
        const sockets = cpuSpec?.sockets || 1;
        const cores = cpuSpec?.cores || 1;
        const threads = cpuSpec?.threads || 1;
        
        // 如果已开启热扩容，cpu 应该等于 sockets（因为 cores=1, threads=1）
        const isHotPlug = cpuSpec?.maxSockets && cpuSpec?.maxSockets > sockets;
        
        // 计算总CPU值：
        // 1. 如果已开启热扩容，总CPU = sockets（因为cores=1, threads=1）
        // 2. 否则，优先使用 getCurrentSpec 返回的 cpu 值
        // 3. 如果 cpu 不存在，计算 sockets * cores * threads
        let cpuValue: number;
        if (isHotPlug) {
          // 已开启热扩容：总CPU = sockets
          cpuValue = sockets;
        } else {
          // 未开启热扩容：使用计算值或 getCurrentSpec 的值
          const calculatedCpu = sockets * cores * threads;
          cpuValue = cpu || calculatedCpu;
        }
        
        // 确保 cpuValue 是有效数字
        cpuValue = cpuValue > 0 ? cpuValue : 1;

        form.setFieldsValue({
          cpu: cpuValue,
          memory: memGi,
          cpuSockets: sockets,
          cpuCores: cores,
          cpuThreads: threads
        });
        break;
      }
      case 'hotplug_settings': {
        const { cpu, memory, maxSockets, maxMemory } = getCurrentSpec();
        const maxMemGi = maxMemory ? getMemoryInGi(maxMemory) : undefined;
        // [修复] 使用 getCurrentSpec() 返回的 memory 值计算，确保一致性
        const currentMemGi = getMemoryInGi(memory);

        // [Harvester 兼容] 使用 Annotation 判断热扩容状态
        const annotations = record?.metadata?.annotations || {};
        const isHotPlug = annotations['harvesterhci.io/enableCPUAndMemoryHotplug']?.toLowerCase() === 'true';

        form.setFieldsValue({
          enableHotPlug: !!isHotPlug,
          maxSockets: maxSockets || (cpu * 4),
          maxMemory: maxMemGi || (currentMemGi * 4)
        });
        break;
      }
      case 'cpu_advanced': {
        const domain = activeRecord?.spec?.template?.spec?.domain;
        const cpuSpec = domain?.cpu;
        const resources = domain?.resources;

        // Check if Hot Plug is enabled on the VM
        const isHotPlug = cpuSpec?.maxSockets && cpuSpec?.maxSockets > (cpuSpec?.sockets || 1);

        const parseCpu = (v: any) => {
          if (!v) return null;
          const s = String(v);
          if (s.endsWith('m')) return parseInt(s) / 1000;
          return parseFloat(s);
        };

        const limit = parseCpu(resources?.limits?.cpu);
        const reqMem = resources?.requests?.memory;
        const limMem = resources?.limits?.memory;
        const reqGi = reqMem ? getQuantityInGi(reqMem) : undefined;
        const limGi = limMem ? getQuantityInGi(limMem) : undefined;

        form.setFieldsValue({
          cpuSockets: cpuSpec?.sockets || 1,
          cpuCores: cpuSpec?.cores || 1,
          cpuThreads: cpuSpec?.threads || 1,
          cpuModel: cpuSpec?.mode || 'host-passthrough',
          cpuModelCustom: cpuSpec?.mode === 'custom' ? cpuSpec?.model : '',
          dedicatedCPUPlacement: !!cpuSpec?.dedicatedCpuPlacement,
          isolateEmulatorThread: !!cpuSpec?.isolateEmulatorThread,
          cpuRequest: parseCpu(resources?.requests?.cpu),
          cpuLimit: limit,
          memoryRequestGi: reqGi,
          memoryLimitGi: limGi,
          enableHotPlug: !!isHotPlug
        });
        break;
      }
      case 'change_primary_nic': {
        (async () => {
          const loadedSubnets = (
            await Promise.all([reloadNads(), reloadVpcs(), reloadSubnets()])
          )[2];
          const networks = record?.spec?.template?.spec?.networks || [];
          const interfaces = record?.spec?.template?.spec?.domain?.devices?.interfaces || [];
          if (interfaces.length > 0) {
            const iface = interfaces[0];
            const net = networks.find((n: any) => n.name === iface.name);
            const networkName = net?.multus?.networkName || '';
            const subnetName =
              networkName && String(networkName).includes('/')
                ? String(networkName).split('/').pop()
                : networkName;
            let type = 'bridge';
            if (String(iface?.binding?.name ?? '').toLowerCase() === 'managedtap') type = 'managedtap';
            else if (iface.masquerade) type = 'masquerade';
            else if (iface.sriov) type = 'sriov';
            else if (iface.macvtap) type = 'macvtap';
            const targetSubnet = (loadedSubnets || []).find((s: any) => s?.metadata?.name === subnetName);
            const subnetType = String(targetSubnet?.metadata?.annotations?.['tower.io/subnet-type'] || '')
              .trim()
              .toLowerCase();
            const isVpc = subnetType === 'vpc';
            const netMode =
              type === 'managedtap'
                ? 'flat_subnet'
                : type === 'sriov' || type === 'macvtap'
                  ? 'passthrough'
                  : isVpc
                    ? 'vpc'
                    : 'flat';
            const networkDataObj = getParsedNetworkData(record);
            let eth = networkDataObj?.network?.ethernets?.['nic-0'] || networkDataObj?.network?.ethernets?.['nic0'];
            if (!eth && iface.macAddress && networkDataObj?.network?.ethernets) {
              eth = Object.values(networkDataObj.network.ethernets).find(
                (e: any) => e?.match?.macaddress?.toLowerCase() === iface.macAddress.toLowerCase(),
              );
            }
            let ipAddress = undefined;
            let gateway = undefined;
            let dns = undefined;
            if (eth) {
              if (eth.addresses && eth.addresses.length > 0) ipAddress = eth.addresses[0];
              if (eth.gateway4) gateway = eth.gateway4;
              if (eth.nameservers?.addresses) dns = eth.nameservers.addresses.join(', ');
            }
            form.setFieldsValue({
              netMode,
              primaryNic: {
                name: networkName,
                type,
                model: iface.model || 'virtio',
                macAddress: iface.macAddress,
                vpc: netMode === 'vpc' ? targetSubnet?.spec?.vpc : netMode === 'flat_subnet' ? 'ovn-cluster' : undefined,
                subnet: subnetName,
                ipAddress,
                gateway,
                dns,
              },
            });
          }
        })();
        break;
      }
      case 'change_secondary_nic': {
        (async () => {
          const loadedSubnets = (
            await Promise.all([reloadNads(), reloadVpcs(), reloadSubnets()])
          )[2];
          const networks = record?.spec?.template?.spec?.networks || [];
          const interfaces = record?.spec?.template?.spec?.domain?.devices?.interfaces || [];
          const networkDataObj = getParsedNetworkData(record);

          let primaryForm: { netMode?: string; primaryNic?: any } = {};
          if (interfaces.length > 0) {
            const iface = interfaces[0];
            const net = networks.find((n: any) => n.name === iface.name);
            const networkName = net?.multus?.networkName || '';
            const subnetName =
              networkName && String(networkName).includes('/')
                ? String(networkName).split('/').pop()
                : networkName;
            let type = 'bridge';
            if (String(iface?.binding?.name ?? '').toLowerCase() === 'managedtap') type = 'managedtap';
            else if (iface.masquerade) type = 'masquerade';
            else if (iface.sriov) type = 'sriov';
            else if (iface.macvtap) type = 'macvtap';
            const targetSubnet = (loadedSubnets || []).find((s: any) => s?.metadata?.name === subnetName);
            const subnetType = String(targetSubnet?.metadata?.annotations?.['tower.io/subnet-type'] || '')
              .trim()
              .toLowerCase();
            const isVpc = subnetType === 'vpc';
            const netMode =
              type === 'managedtap'
                ? 'flat_subnet'
                : type === 'sriov' || type === 'macvtap'
                  ? 'passthrough'
                  : isVpc
                    ? 'vpc'
                    : 'flat';
            let eth = networkDataObj?.network?.ethernets?.['nic-0'] || networkDataObj?.network?.ethernets?.['nic0'];
            if (!eth && iface.macAddress && networkDataObj?.network?.ethernets) {
              eth = Object.values(networkDataObj.network.ethernets).find(
                (e: any) => e?.match?.macaddress?.toLowerCase() === iface.macAddress.toLowerCase(),
              );
            }
            let ipAddress = undefined;
            let gateway = undefined;
            let dns = undefined;
            if (eth) {
              if (eth.addresses && eth.addresses.length > 0) ipAddress = eth.addresses[0];
              if (eth.gateway4) gateway = eth.gateway4;
              if (eth.nameservers?.addresses) dns = eth.nameservers.addresses.join(', ');
            }
            primaryForm = {
              netMode,
              primaryNic: {
                name: networkName,
                type,
                model: iface.model || 'virtio',
                macAddress: iface.macAddress,
                vpc: netMode === 'vpc' ? targetSubnet?.spec?.vpc : netMode === 'flat_subnet' ? 'ovn-cluster' : undefined,
                subnet: subnetName,
                ipAddress,
                gateway,
                dns,
              },
            };
          }

          const secondaries = interfaces.slice(1).map((iface: any, idx: number) => {
            const net = networks.find((n: any) => n.name === iface.name);
            const networkName = net?.multus?.networkName || '';
            const subnetName =
              networkName && String(networkName).includes('/')
                ? String(networkName).split('/').pop()
                : networkName;
            let type = 'bridge';
            if (String(iface?.binding?.name ?? '').toLowerCase() === 'managedtap') type = 'managedtap';
            else if (iface.masquerade) type = 'masquerade';
            else if (iface.sriov) type = 'sriov';
            else if (iface.macvtap) type = 'macvtap';
            const targetSubnet = (loadedSubnets || []).find((s: any) => s?.metadata?.name === subnetName);
            const subnetType = String(targetSubnet?.metadata?.annotations?.['tower.io/subnet-type'] || '')
              .trim()
              .toLowerCase();
            const isVpc = subnetType === 'vpc';
            const mode =
              type === 'managedtap'
                ? 'flat_subnet'
                : type === 'sriov' || type === 'macvtap'
                  ? 'passthrough'
                  : isVpc
                    ? 'vpc'
                    : 'flat';
            const ifaceKey = iface.name || `nic-${idx + 1}`;
            let eth = networkDataObj?.network?.ethernets?.[ifaceKey];
            if (!eth && iface.macAddress && networkDataObj?.network?.ethernets) {
              eth = Object.values(networkDataObj.network.ethernets).find(
                (e: any) => e?.match?.macaddress?.toLowerCase() === iface.macAddress.toLowerCase(),
              );
            }
            let ipAddress = undefined;
            let gateway = undefined;
            let dns = undefined;
            if (eth) {
              if (eth.addresses && eth.addresses.length > 0) ipAddress = eth.addresses[0];
              if (eth.gateway4) gateway = eth.gateway4;
              if (eth.nameservers?.addresses) dns = eth.nameservers.addresses.join(', ');
            }
            return {
              mode,
              name: networkName,
              type,
              model: iface.model || 'virtio',
              macAddress: iface.macAddress,
              vpc: mode === 'vpc' ? targetSubnet?.spec?.vpc : mode === 'flat_subnet' ? 'ovn-cluster' : undefined,
              subnet: subnetName,
              ipAddress,
              gateway,
              dns,
            };
          });
          form.setFieldsValue({ ...primaryForm, secondaryNics: secondaries });
        })();
        break;
      }
      case 'change_gpu': {
        if (!gpuResources || gpuResources.length === 0) reloadGpuResources();

        const domain = activeRecord?.spec?.template?.spec?.domain || record?.spec?.template?.spec?.domain;
        const hostDevicesAll = domain?.devices?.hostDevices || [];
        const hostDevices = (Array.isArray(hostDevicesAll) ? hostDevicesAll : []).filter((d: any) => {
          const n = String(d?.name || '').toLowerCase();
          return n.startsWith('gpu');
        });
        const gpus = domain?.devices?.gpus || [];
        const hasHost = Array.isArray(hostDevices) && hostDevices.length > 0;
        const hasGpu = Array.isArray(gpus) && gpus.length > 0;
        const mode = hasGpu ? 'vgpu' : (hasHost ? 'passthrough' : 'none');
        const usedList = hasGpu ? gpus : (hasHost ? hostDevices : []);
        const names = (Array.isArray(usedList) ? usedList : []).map((x: any) => x?.deviceName).filter(Boolean);
        form.setFieldsValue({
          gpuMode: mode,
          gpuResourceNames: names,
        });
        break;
      }
      case 'change_node_scheduling': {
        // 确保节点列表已加载
        if (!nodes || nodes.length === 0) {
          reloadNodes();
        }
        
        const spec = activeRecord?.spec?.template?.spec || record?.spec?.template?.spec;
        const nodeSelector = spec?.nodeSelector || {};
        
        // 提取节点选择器中的 hostname
        // 同时检查当前运行节点（如果 nodeSelector 中没有，但 VM 正在运行，可以从 status.nodeName 获取）
        let currentNode = nodeSelector['kubernetes.io/hostname'] || null;
        if (!currentNode) {
          // 如果 nodeSelector 中没有，尝试从 status 中获取当前运行节点
          const currentRunningNode = activeRecord?.status?.nodeName || record?.status?.nodeName || activeRecord?.nodeName || record?.nodeName || null;
          if (currentRunningNode) {
            currentNode = currentRunningNode;
          }
        }
        
        // 提取其他标签（除了 hostname）
        const labelPairs: Array<{ key: string; value: string }> = [];
        Object.entries(nodeSelector).forEach(([key, value]) => {
          if (key !== 'kubernetes.io/hostname') {
            labelPairs.push({ key, value: String(value) });
          }
        });
        
        // 判断调度模式
        let mode: 'auto' | 'fixed' | 'label' = 'auto';
        if (currentNode) {
          mode = 'fixed';
        } else if (labelPairs.length > 0) {
          mode = 'label';
        }
        
        form.setFieldsValue({
          nodeSchedulingMode: mode,
          fixedNode: currentNode || undefined,
          nodeSelectorPairs: labelPairs.length > 0 ? labelPairs : undefined,
        });
        break;
      }
      case 'change_usb': {
        if (!usbResources || usbResources.length === 0) reloadUsbResources();

        const domain = activeRecord?.spec?.template?.spec?.domain || record?.spec?.template?.spec?.domain;
        const hostDevices = domain?.devices?.hostDevices || [];
        const usb = (Array.isArray(hostDevices) ? hostDevices : []).filter((d: any) => {
          const n = String(d?.name || '').toLowerCase();
          const dn = String(d?.deviceName || '').toLowerCase();
          return n.startsWith('usb') || dn.includes('usb');
        });
        const names = usb.map((x: any) => x?.deviceName).filter(Boolean);
        form.setFieldsValue({ usbResourceNames: names });
        setSelectedUsbKeys(Array.from(new Set(names.map((x: any) => String(x || '')).filter(Boolean))));
        break;
      }
      case 'vm_policy': {
        const rs = (activeRecord || record)?.spec?.runStrategy || 'Manual';
        const es = (activeRecord || record)?.spec?.evictionStrategy
          || (activeRecord || record)?.spec?.template?.spec?.evictionStrategy
          || undefined;
        form.setFieldsValue({ runStrategy: rs, evictionStrategy: es });
        break;
      }
      case 'change_os': {
        if (!images || images.length === 0) reloadImages();
        if (!scs || scs.length === 0) reloadScs();
        break;
      }
      case 'add_disk': {
        if (!scs || scs.length === 0) reloadScs();
        // 预加载当前 namespace 下可挂载的 PVC（用于“选择已有磁盘”）
        if (open && cloudId && record?.metadata?.namespace) {
          void (async () => {
            try {
              const ns = String(record.metadata.namespace || '').trim();
              const res = await fetchHarvesterAvailableVolumes(cloudId, ns || undefined);
              const items = (res as any)?.data?.items || (res as any)?.items || [];
              const normalized = (Array.isArray(items) ? items : []).map((x: any) => {
                const meta = x?.metadata || {};
                const ann = meta?.annotations || x?.annotations || {};
                const name = x?.pvcName || meta?.name || x?.name || '';
                const namespace = meta?.namespace || x?.namespace || x?.ns || ns || '';
                const alias = ann?.['tower.io/alias'] || x?.Alias || x?.alias || '';
                return { ...x, pvcName: name, namespace, alias };
              });
              const enriched = await Promise.all(
                normalized.map(async (x: any) => {
                  if (x.alias) return x;
                  if (!x.namespace || !x.pvcName) return x;
                  try {
                    const detail: any = await fetchHarvesterVolume(cloudId, x.namespace, x.pvcName);
                    const ann = detail?.metadata?.annotations || detail?.data?.metadata?.annotations || {};
                    const alias = ann?.['tower.io/alias'];
                    return alias ? { ...x, alias } : x;
                  } catch {
                    return x;
                  }
                })
              );
              setAvailableDiskPvcs(enriched);
            } catch {
              // ignore
            }
          })();
        }
        break;
      }
    }
    // 仅随菜单/VM/弹窗切换初始化表单；补全 reload* / 资源列表等依赖会导致重复 reset 与多余请求
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional: tab-switch init only
  }, [selectedKey, open, record, latestVm, form]);

  // 专门针对 CPU 高级配置做一次“精确回显”，确保 dedicatedCPUPlacement 等字段与最新 VM 保持一致
  useEffect(() => {
    if (!open) return;
    if (selectedKey !== 'cpu_advanced') return;

    const domain = activeRecord?.spec?.template?.spec?.domain;
    const cpuSpec = domain?.cpu;
    const resources = domain?.resources;
    if (!cpuSpec || !resources) return;

    const parseCpu = (v: any) => {
      if (!v) return null;
      const s = String(v);
      if (s.endsWith('m')) return parseInt(s) / 1000;
      return parseFloat(s);
    };

    const limit = parseCpu(resources?.limits?.cpu);

    form.setFieldsValue({
      dedicatedCPUPlacement: !!cpuSpec?.dedicatedCpuPlacement,
      isolateEmulatorThread: !!cpuSpec?.isolateEmulatorThread,
      cpuRequest: parseCpu(resources?.requests?.cpu),
      cpuLimit: limit,
    });
  }, [open, selectedKey, activeRecord, form]);

  useEffect(() => {
    if (!open) return;
    if (selectedKey !== 'change_gpu') return;

    const domain = activeRecord?.spec?.template?.spec?.domain;
    const hostDevices = domain?.devices?.hostDevices || [];
    const gpus = domain?.devices?.gpus || [];
    const hostNames = (Array.isArray(hostDevices) ? hostDevices : []).map((x: any) => x?.deviceName).filter(Boolean);
    const gpuNames = (Array.isArray(gpus) ? gpus : []).map((x: any) => x?.deviceName).filter(Boolean);
    const getResourceName = (x: any) => x?.resourceName || x?.raw?.status?.resourceName || x?.raw?.spec?.resourceName;
    const resList = Array.isArray(gpuResources) ? gpuResources : [];

    const deriveModeFromVm = () => {
      if (gpuNames.length > 0) return 'vgpu';
      if (hostNames.length === 0) return 'none';
      const wanted = new Set(hostNames.map((x: any) => String(x)));
      const matchedTypes = new Set<string>();
      resList.forEach((x: any) => {
        const rn = getResourceName(x);
        if (!rn) return;
        if (!wanted.has(String(rn))) return;
        const t = String(x?.type || '').toLowerCase();
        if (t) matchedTypes.add(t);
      });
      if (matchedTypes.has('sriov')) return 'sriov';
      if (matchedTypes.has('passthrough')) return 'passthrough';
      return 'passthrough';
    };

    const inferredMode = deriveModeFromVm();
    const currentMode = form.getFieldValue('gpuMode') || 'none';
    if (currentMode !== inferredMode) {
      const names = inferredMode === 'vgpu' ? gpuNames : inferredMode === 'none' ? [] : hostNames;
      form.setFieldsValue({ gpuMode: inferredMode, gpuResourceNames: Array.from(new Set(names.filter(Boolean))) });
    }

    const effectiveMode = form.getFieldValue('gpuMode') || inferredMode || 'none';
    if (effectiveMode === 'none') {
      setSelectedGpuKeys([]);
      return;
    }

    const vmAssigned = (effectiveMode === 'vgpu' ? gpus : hostDevices);
    const vmAssignedNames = (Array.isArray(vmAssigned) ? vmAssigned : []).map((x: any) => x?.deviceName).filter(Boolean);

    const currentNames = form.getFieldValue('gpuResourceNames');
    const desiredNames = (Array.isArray(currentNames) && currentNames.length > 0) ? currentNames : vmAssignedNames;
    if (!Array.isArray(desiredNames) || desiredNames.length === 0) {
      setSelectedGpuKeys([]);
      return;
    }

    form.setFieldsValue({ gpuResourceNames: Array.from(new Set(desiredNames.filter(Boolean))) });

    const parseAllocation = () => {
      try {
        const raw = activeRecord?.metadata?.annotations?.['harvesterhci.io/deviceAllocationDetails'];
        if (!raw) return null;
        return typeof raw === 'string' ? JSON.parse(raw) : raw;
      } catch {
        return null;
      }
    };
    const allocation = parseAllocation();
    const hostAlloc = allocation?.hostdevices || {};
    const runningNode = activeRecord?.vmi?.status?.nodeName || activeRecord?.vmiRaw?.status?.nodeName || undefined;

    const matchByAllocName = (allocName: string) => {
      const target = String(allocName || '');
      if (!target) return null;
      const found = resList.find((x: any) => String(x?.raw?.metadata?.name || x?.name || '') === target);
      if (!found) return null;
      if (String(found?.type) !== String(effectiveMode)) return null;
      const name = found?.raw?.metadata?.name || found?.name || target || '-';
      const node = found?.node || found?.nodeName || '-';
      const bus = found?.pciAddress || found?.address || found?.pci || '-';
      return `${name}|${node}|${bus}`;
    };

    const buildKeyFromResourceName = (rn: string, usedKeys: Set<string>) => {
      const candidates = resList
        .filter((x: any) => String(x?.type) === String(effectiveMode))
        .filter((x: any) => String(getResourceName(x) || '') === String(rn || ''));
      const scored = candidates.slice().sort((a: any, b: any) => {
        const an = String(a?.node || a?.nodeName || '');
        const bn = String(b?.node || b?.nodeName || '');
        const as = runningNode && an === runningNode ? 1 : 0;
        const bs = runningNode && bn === runningNode ? 1 : 0;
        return bs - as;
      });
      const pick = scored.find((x: any) => {
        const name = x?.raw?.metadata?.name || x?.name || rn || '-';
        const node = x?.node || x?.nodeName || '-';
        const bus = x?.pciAddress || x?.address || x?.pci || '-';
        const key = `${name}|${node}|${bus}`;
        return !usedKeys.has(key);
      }) || scored[0];
      if (!pick) return null;
      const name = pick?.raw?.metadata?.name || pick?.name || rn || '-';
      const node = pick?.node || pick?.nodeName || '-';
      const bus = pick?.pciAddress || pick?.address || pick?.pci || '-';
      return `${name}|${node}|${bus}`;
    };

    const keys: string[] = [];
    const usedKeys = new Set<string>();

    if (effectiveMode !== 'vgpu') {
      const assigned = Array.isArray(hostDevices) ? hostDevices : [];
      assigned.forEach((d: any) => {
        const rn = String(d?.deviceName || '');
        const allocNames = Array.isArray(hostAlloc?.[rn]) ? hostAlloc[rn] : [];
        if (allocNames.length > 0) {
          const k = matchByAllocName(String(allocNames[0] || ''));
          if (k) {
            keys.push(k);
            usedKeys.add(k);
            return;
          }
        }
        const k = buildKeyFromResourceName(rn, usedKeys);
        if (k) {
          keys.push(k);
          usedKeys.add(k);
        }
      });
    } else {
      const assigned = Array.isArray(gpus) ? gpus : [];
      assigned.forEach((d: any) => {
        const rn = String(d?.deviceName || '');
        const k = buildKeyFromResourceName(rn, usedKeys);
        if (k) {
          keys.push(k);
          usedKeys.add(k);
        }
      });
    }

    setSelectedGpuKeys(keys);
    const inferredNode = (() => {
      const first = keys[0];
      if (!first) return null;
      const parts = String(first).split('|');
      const node = parts.length >= 2 ? String(parts[1] || '') : '';
      if (!node || node === '-') return null;
      return node;
    })();
    form.setFieldsValue({ gpuNodeName: inferredNode });
  }, [open, selectedKey, activeRecord, gpuResources, form]);

  /**
   * 变更需重启生效时弹出确认：用户可选择立即重启（调用云 API）或稍后手动重启。
   * 若 VM 已停止则仅提示「下次启动生效」，不弹重启框。
   */
  const openRestartConfirm = (namespace: string, vmName: string, force: boolean = false) => {
    // [修复] 检查虚拟机状态，如果已停止则不提示重启
    const activeVm = latestVm || record;
    if (isVmStopped(activeVm)) {
      message.success('设置已保存，下次启动时将自动应用新配置');
      return;
    }
    
    Modal.confirm({
      title: '规格变更已提交，需要重启实例生效，是否重启实例',
      okText: '立即重启',
      cancelText: '手动重启',
      onOk: async () => {
        try {
          await rebootCloudProviderEcs(cloudId, `${namespace}/${vmName}`, force);
          message.success('重启指令已下发');
        } catch (e: any) {
          message.error(e?.message || '重启失败');
        }
      },
      onCancel: () => {}
    });
  };

  /** 读取 VM status.conditions 是否包含 `RestartRequired=True`。 */
  const isRestartRequiredFromVm = (vm: any) => {
    const conditions = vm?.status?.conditions || [];
    return conditions.some((c: any) => c.type === 'RestartRequired' && c.status === 'True');
  };

  /** 判断虚拟机是否处于停止状态（用于跳过重启提示）。 */
  const isVmStopped = (vm: any) => {
    if (!vm) return false;
    // 检查 spec.running 字段
    if (vm.spec?.running === false) return true;
    // 检查状态字符串
    const status = vm.status?.printableStatus || vm.status?.phase || '';
    const statusLower = String(status).toLowerCase();
    return ['stopped', 'shutoff', 'down', 'offline'].includes(statusLower);
  };

  /** 拉取聚合 VM 数据并更新 `latestVm`，返回更新后的 VM 对象。 */
  const fetchAggregatedVm = async (namespace: string, vmName: string) => {
    const res: any = await fetchHarvesterVMAggregated(cloudId, namespace, vmName);
    const data = res?.data?.vm ? res.data : res;
    const updatedVm = data?.vm || data;
    if (updatedVm && data?.related) {
      updatedVm.related = data.related;
    }
    setLatestVm(updatedVm);
    return updatedVm;
  };

  /**
   * 提交成功后：可选延迟后重新拉取 VM；若仍运行且出现 RestartRequired，则弹重启确认。
   * `force` 为 true 时直接走 `openRestartConfirm`。
   */
  const maybePromptRestart = async (namespace: string, vmName: string, options?: { force?: boolean }) => {
    const force = !!options?.force;
    if (force) {
      openRestartConfirm(namespace, vmName, false);
      return;
    }

    try {
      await new Promise((r) => setTimeout(r, 300));
      const updatedVm = await fetchAggregatedVm(namespace, vmName);
      
      // [修复] 如果虚拟机处于停止状态，不需要提示重启
      // 停止状态的虚拟机在下次启动时会自动应用配置，无需重启
      if (isVmStopped(updatedVm)) {
        message.success('设置已保存，下次启动时将自动应用新配置');
        return;
      }
      
      if (isRestartRequiredFromVm(updatedVm)) {
        openRestartConfirm(namespace, vmName, false);
      }
    } catch {
      message.info('设置已保存（请检查是否需要重启）');
    }
  };

  /**
   * 变配表单统一提交入口：根据 `selectedKey` 分支处理。
   *
   * - `expand_system_disk`：扩容系统盘 PVC，必要时更新 annotation。
   * - `change_spec`：调整 CPU/内存（含热插拔路径下的 patch 逻辑）。
   * - `hotplug_settings`：开关 CPU/内存热插拔及上限。
   * - `cpu_advanced`：CPU 拓扑、独占、requests/limits 等高级域。
   * - `change_os`：更换镜像/启动相关。
   * - `add_disk`：新增数据盘（卷与磁盘条目）。
   * - `change_gpu`：GPU 绑定与节点亲和。
   * - `change_node_scheduling` / `change_node_affinity`：节点调度与亲和性。
   * - `change_usb`：USB 设备透传列表。
   * - `vm_policy`：运行策略、驱逐策略等。
   * - `change_primary_nic` / `change_secondary_nic`：主/辅网卡 Multus 与 cloud-init 网络数据。
   *
   * 非网卡类提交前会校验当前 VM 引用的 NAD 均存在（`getMissingNadsFromNetworks`）。
   */
  const handleSubmit = async () => {
    try {
      const values = await form.validateFields();
      const vmName = record?.metadata?.name;
      const namespace = record?.metadata?.namespace;

      if (selectedKey !== 'change_primary_nic' && selectedKey !== 'change_secondary_nic') {
        const currentNetworks = activeRecord?.spec?.template?.spec?.networks || record?.spec?.template?.spec?.networks || [];
        const nadList = await ensureNadsLoaded();
        const missing = getMissingNadsFromNetworks(currentNetworks, String(namespace || 'default'), nadList);
        if (missing.length > 0) {
          message.error(`更新失败：虚拟机网卡引用的 NAD 不存在：${missing.join(', ')}。请先在【变更网卡】中修复后再进行该操作。`);
          return;
        }
      }

      switch (selectedKey) {
        case 'expand_system_disk': {
          const newSize = values.systemDiskSize;
          if (systemDisk && newSize) {
             // 1. Update PVC
             await updateHarvesterVolume(cloudId, namespace, systemDisk, { sizeGi: newSize });
             
             // 2. Update VM Annotation if exists (for consistency)
             // Use activeRecord to ensure we have the latest annotations
             const currentAnnotations = (latestVm || record)?.metadata?.annotations || {};
             const templateStr = currentAnnotations['harvesterhci.io/volumeClaimTemplates'];
             
             if (templateStr) {
                 try {
                     const templates = JSON.parse(templateStr);
                     let hasChange = false;
                     const updatedTemplates = templates.map((t: any) => {
                         if (t.metadata.name === systemDisk) {
                             hasChange = true;
                             return {
                                 ...t,
                                 spec: {
                                     ...t.spec,
                                     resources: {
                                         ...t.spec.resources,
                                         requests: {
                                             ...t.spec.resources.requests,
                                             storage: `${newSize}Gi`
                                         }
                                     }
                                 }
                             };
                         }
                         return t;
                     });
                     
                     if (hasChange) {
                        await patchHarvesterVm(cloudId, namespace, vmName, {
                            annotations: {
                                'harvesterhci.io/volumeClaimTemplates': JSON.stringify(updatedTemplates)
                            }
                        });
                     }
                 } catch (e) {
                     console.warn('Failed to update volumeClaimTemplates annotation', e);
                 }
             }
             
             try {
               const res: any = await fetchHarvesterVMAggregated(cloudId, namespace, vmName);
               const data = res?.data?.vm ? res.data : res;
               const updatedVm = data?.vm || data;
               if (updatedVm && data?.related) {
                 updatedVm.related = data.related;
               }
               setLatestVm(updatedVm);
             } catch {}

            message.success('系统盘扩容请求已提交，设置已保存');
            void maybePromptRestart(namespace, vmName);
          }
          break;
        }
        case 'change_spec': {
          // [关键检查] 如果热扩容正在进行中，禁止任何变更操作
          const conditions = activeRecord?.status?.conditions || [];
          const isHotPlugInProgress = conditions.some((c: any) => 
            (c.type === 'HotVCPUChange' || c.type === 'HotMemoryChange') && c.status === 'True'
          );
          
          if (isHotPlugInProgress) {
            message.warning('热扩容操作正在进行中，请等待操作完成后再进行变更');
            return;
          }
          
          // 检查当前虚拟机的CPU拓扑和热扩容状态
          const currentDomain = activeRecord?.spec?.template?.spec?.domain;
          const currentCores = currentDomain?.cpu?.cores || 1;
          const currentThreads = currentDomain?.cpu?.threads || 1;
          const currentSockets = currentDomain?.cpu?.sockets || 1;
          const currentTotalCpu = currentSockets * currentCores * currentThreads;
          
          // [热扩容配置判断] 同时检查 Annotation 和 maxSockets，确保准确识别热扩容能力
          // 根据 Harvester 源码（pkg/util/virtualmachine/virtualmachine.go:SupportCPUAndMemoryHotplug），
          // 热扩容能力通过 Annotation harvesterhci.io/enableCPUAndMemoryHotplug 控制
          const hotPlugAnnotation = activeRecord?.metadata?.annotations?.['harvesterhci.io/enableCPUAndMemoryHotplug'];
          const isHotPlugConfiguredByAnnotation = hotPlugAnnotation?.toLowerCase() === 'true';
          const hasMaxSockets = currentDomain?.cpu?.maxSockets && currentDomain.cpu.maxSockets > currentSockets;
          // 只有当 Annotation 存在且 maxSockets 配置了，才认为已配置热扩容
          const isCurrentlyHotPlug = isHotPlugConfiguredByAnnotation && hasMaxSockets;
          
          // 检查用户是否修改了规格
          // [关键修复] 统一使用 getCurrentSpec 获取当前内存值，确保表单初始化和提交验证使用相同的数据源
          const { memory: currentMemRaw } = getCurrentSpec();
          const currentMemGi = getMemoryInGi(currentMemRaw);
          const cpuChanged = values.cpu !== undefined && values.cpu !== currentTotalCpu;
          
          // [关键修复] 只有当表单中的内存值与当前内存值确实不同时，才认为用户修改了内存
          // 使用容差比较避免浮点数精度问题，但如果差值很小（<=0.01），认为没有变化
          const formMemory = values.memory !== undefined ? Number(values.memory) : undefined;
          const memoryChanged = formMemory !== undefined && Math.abs(formMemory - currentMemGi) > 0.01;
          
          // [注意] change_spec 中不再有 enableHotPlug 字段，热扩容开关已拆分为独立功能
          // 这里只检查当前VM是否已配置热扩容，用于限制规则判断
          
          // [热扩容限制] 如果已开启热扩容，只允许增加资源，不允许减少
          if (isCurrentlyHotPlug) {
            if (cpuChanged && values.cpu < currentTotalCpu) {
              message.warning('热扩容模式下不允许减少CPU，请先关闭热扩容后再修改');
              return;
            }
            // [关键修复] 只有当用户确实修改了内存（memoryChanged=true）且新值小于当前值时，才报错
            // 如果用户没有修改内存（memoryChanged=false），即使进入这个判断也不会报错
            if (memoryChanged && formMemory !== undefined && formMemory < currentMemGi - 0.01) {
              message.warning('热扩容模式下不允许减少内存，请先关闭热扩容后再修改');
              return;
            }
            // 检查是否超出热扩容上限
            const maxSockets = currentDomain?.cpu?.maxSockets;
            const maxMemory = currentDomain?.memory?.maxGuest;
            if (cpuChanged && maxSockets && values.cpu > maxSockets) {
              message.warning(`CPU数量不能超过热扩容上限 ${maxSockets} 核`);
              return;
            }
            if (memoryChanged && maxMemory) {
              const maxMemGi = parseQuantity(maxMemory) / (1024**3);
              if (Number(values.memory) > maxMemGi) {
                message.warning(`内存数量不能超过热扩容上限 ${maxMemGi} GiB`);
                return;
              }
            }
          }
          
          // [注意] change_spec 中不再处理热扩容开关变更，热扩容开关已拆分为独立功能
          
          // 如果已开启热扩容，确保拓扑符合要求（cores=1, threads=1）
          // 如果当前拓扑不符合要求，需要先修复拓扑（但这种情况应该很少见，因为开启热扩容时会自动设置）
          const needTopologyFix = isCurrentlyHotPlug && (currentCores !== 1 || currentThreads !== 1);
          
          if (needTopologyFix) {
            // 第一步：先设置拓扑为 sockets=x（现有CPU数量总和）, cores=1, threads=1（不开启热扩容）
            const topologyPayload: any = {
              cpu: currentTotalCpu, // 保持总CPU数不变
              cpuSockets: currentTotalCpu, // sockets = 现有CPU数量总和
              cpuCores: 1,
              cpuThreads: 1,
              enableHotPlug: false // 先不开启热扩容，只设置拓扑
            };
            
            await updateHarvesterVmSpec(cloudId, namespace, vmName, topologyPayload);
            message.info('已先设置CPU拓扑为cores=1, threads=1，正在开启热扩容...');
            
            // 刷新VM状态
            try {
              const refreshedVm = await fetchHarvesterVmDetail(cloudId, namespace, vmName);
              setLatestVm(refreshedVm?.data || refreshedVm);
              await new Promise(resolve => setTimeout(resolve, 300));
            } catch (e) {
              console.warn('刷新VM状态失败，继续执行', e);
              await new Promise(resolve => setTimeout(resolve, 500));
            }
          }
          
          // 第二步：构建规格变更payload
          // [注意] change_spec 只处理规格变更，不处理热扩容开关变更
          let payload: any = {};
          
          // 如果当前已开启热扩容，使用热扩容模式的最小化 payload
          if (isCurrentlyHotPlug) {
            // [热扩容模式] 只传递必要的字段，避免触发 RestartRequired
            // 1. CPU: 只传递 cpu（后端会转换为 sockets），不传递 cpuCores/cpuThreads（如果已经是1）
            // 2. 内存: 只传递 memory（后端会使用 domain.memory.guest），不传递 resources
            if (values.cpu !== undefined) {
              payload.cpu = values.cpu;
              // 不传递 cpuSockets，因为后端会根据 cpu 自动设置 sockets
              // 不传递 cpuCores 和 cpuThreads，因为后端会检查当前值，如果已经是1则不会在Patch中包含
            }
            if (values.memory !== undefined) {
              payload.memory = `${values.memory}Gi`;
            }
          } else {
            // [标准模式] 传递完整的拓扑信息
            payload = { 
              cpu: values.cpu,
              cpuSockets: values.cpuSockets,
              cpuCores: values.cpuCores,
              cpuThreads: values.cpuThreads,
              memory: `${values.memory}Gi`
            };
          }
          
          // 如果需要修复拓扑，先修复
          if (needTopologyFix) {
            // 先设置正确的拓扑
            const topologyPayload: any = {
              cpu: currentTotalCpu,
              cpuSockets: currentTotalCpu,
              cpuCores: 1,
              cpuThreads: 1
            };
            await updateHarvesterVmSpec(cloudId, namespace, vmName, topologyPayload);
            message.info('已修复CPU拓扑为cores=1, threads=1');
            
            // 刷新VM状态
            try {
              const refreshedVm = await fetchHarvesterVmDetail(cloudId, namespace, vmName);
              setLatestVm(refreshedVm?.data || refreshedVm);
              await new Promise(resolve => setTimeout(resolve, 300));
            } catch (e) {
              console.warn('刷新VM状态失败，继续执行', e);
              await new Promise(resolve => setTimeout(resolve, 500));
            }
          }

          await updateHarvesterVmSpec(cloudId, namespace, vmName, payload);

          // [Hot Plug Logic] Check if we can skip restart prompt
          // 如果第一步修改了拓扑，需要重新获取最新的VM状态
          let finalDomain = currentDomain;
          if (needTopologyFix) {
            try {
              const refreshedVm = await fetchHarvesterVmDetail(cloudId, namespace, vmName);
              const refreshedData = refreshedVm?.data || refreshedVm;
              finalDomain = refreshedData?.spec?.template?.spec?.domain;
              setLatestVm(refreshedData);
            } catch (e) {
              console.warn('刷新VM状态失败，使用原始状态', e);
            }
          }
          
          // [注意] change_spec 中不再有 enableHotPlug 字段，使用 isCurrentlyHotPlug 判断是否“已配置”热扩容
          // 这里的 isHotPlugActive 用于判断“本次操作是否按热扩容路径执行”，因此直接复用 isCurrentlyHotPlug，
          // 上面已经做过 isHotPlugInProgress 校验，这里不再重复依赖状态条件，避免误判为需要重启。
          const isHotPlugActive = !!isCurrentlyHotPlug;

          // Get current resources from active record (source of truth)
          // 使用最新的domain状态（如果刷新了则用新的，否则用原来的）
          const finalSockets = finalDomain?.cpu?.sockets || currentSockets;
          const finalCores = finalDomain?.cpu?.cores || currentCores;
          const finalThreads = finalDomain?.cpu?.threads || currentThreads;
          const finalTotalCpu = finalSockets * finalCores * finalThreads;

          const newCpu = values.cpu !== undefined ? Number(values.cpu) : finalTotalCpu; // Total Cores，如果未传则保持原值
          // [关键修复] 如果用户没有修改内存（values.memory 为 undefined），应该使用表单初始化时的值（currentMemGi）
          // 这样可以确保即使用户只改了 CPU，内存比较逻辑也能正确工作
          const newMemGi = values.memory !== undefined ? Number(values.memory) : currentMemGi; // GiB，如果未传则使用表单初始值

          // [热扩容判断] 如果已配置热扩容，且本次操作是"只增不减"的标准热扩容场景，则无需重启
          const arch = activeRecord?.spec?.template?.spec?.architecture;
          const isArm = arch === 'arm64' || arch === 'aarch64';
          
          // [关键修复] 统一使用表单值与初始值的比较来判断是否修改了CPU/内存
          // 这样可以避免因为计算方式不同或刷新后的值变化导致的误判
          // 注意：这里使用之前已经计算好的 cpuChanged 和 memoryChanged（基于表单值和初始值的比较）
          const finalCpuChanged = cpuChanged; // 复用之前计算的 cpuChanged
          const finalMemChanged = memoryChanged; // 复用之前计算的 memoryChanged（基于 formMemory 和 currentMemGi）
          
          // 检查是否是"只增不减"的热扩容场景（基于表单值和当前实际值的比较）
          const isCpuHotAdd = !finalCpuChanged || (newCpu >= finalTotalCpu - 0.01);
          const isMemHotAdd = !finalMemChanged || (newMemGi >= currentMemGi - 0.01); // 与表单初始化时的 currentMemGi 比较
          
          // ARM架构不支持CPU热插拔，但支持内存热插拔
          const isCpuHotPlugAllowed = !isArm || !finalCpuChanged;
          
          // [关键修复] 检查 VM 是否可迁移（内存热插拔的前提条件）
          // KubeVirt 要求：Memory-hotplug is only available for migratable VMs
          // 通过检查 VMI 的 status.conditions 中 LiveMigratable condition（status 为 True 表示可迁移）
          const vmi = activeRecord?.vmi || activeRecord?.vmiRaw;
          const vmiConditions = vmi?.status?.conditions || [];
          const isMigratable = vmiConditions.some(
            (c: any) => 
              (c.type === 'LiveMigratable' || c.type === 'VirtualMachineInstanceIsMigratable') && 
              c.status === 'True'
          );
          
          // [关键修复] 如果已配置热扩容（isHotPlugActive），且满足以下条件，则走热扩容路径（无需重启）：
          // 1. CPU：未修改 或 （增加且非ARM架构）- CPU 热插拔不需要 VM 可迁移
          // 2. 内存：未修改 或 （增加 且 VM 可迁移）- 内存热插拔需要 VM 可迁移
          // 根据 Harvester 源码（pkg/api/vm/formatter.go:canCPUAndMemoryHotplug），CPU 热扩容不检查 migratable
          const canUseCpuHotPlug = isHotPlugActive && isCpuHotAdd && isCpuHotPlugAllowed;
          // 内存热插拔需要 VM 可迁移（KubeVirt 要求："Memory-hotplug is only available for migratable VMs"）
          const canUseMemHotPlug = isHotPlugActive && isMemHotAdd && (isMigratable || !finalMemChanged);
          
          // 如果只改了CPU，或只改了内存（且可迁移），或两者都改且都满足条件，则可以使用热扩容
          const canUseHotPlug = 
            (finalCpuChanged && !finalMemChanged && canUseCpuHotPlug) ||
            (!finalCpuChanged && finalMemChanged && canUseMemHotPlug) ||
            (finalCpuChanged && finalMemChanged && canUseCpuHotPlug && canUseMemHotPlug) ||
            (!finalCpuChanged && !finalMemChanged); // 都没改，不需要重启
          
          if (canUseHotPlug) {
             message.success('规格变更已提交（热扩容生效），无需重启实例');
          } else {
             // 如果内存变更但 VM 不可迁移，给出明确提示
             if (finalMemChanged && !isMigratable && isHotPlugActive) {
               message.warning('内存热扩容需要 VM 可迁移，当前 VM 不可迁移，将需要重启生效');
             }
             // [修复] 检查虚拟机是否处于停止状态，停止状态的虚拟机在启动时会自动应用配置，无需重启
             try {
               const updatedVm = await fetchAggregatedVm(namespace, vmName);
               if (isVmStopped(updatedVm)) {
                 message.success('设置已保存，下次启动时将自动应用新配置');
               } else {
                 openRestartConfirm(namespace, vmName, false);
               }
             } catch {
               // 如果获取VM状态失败，仍然提示重启（保守策略）
               openRestartConfirm(namespace, vmName, false);
             }
          }
          break;
        }
        case 'hotplug_settings': {
          // [关键检查] 如果热扩容正在进行中，禁止任何变更操作
          const conditions = activeRecord?.status?.conditions || [];
          const isHotPlugInProgress = conditions.some((c: any) => 
            (c.type === 'HotVCPUChange' || c.type === 'HotMemoryChange') && c.status === 'True'
          );
          
          if (isHotPlugInProgress) {
            message.warning('热扩容操作正在进行中，请等待操作完成后再进行变更');
            return;
          }
          
          // 检查当前虚拟机的CPU拓扑和热扩容状态
          const currentDomain = activeRecord?.spec?.template?.spec?.domain;
          const currentCores = currentDomain?.cpu?.cores || 1;
          const currentThreads = currentDomain?.cpu?.threads || 1;
          const currentSockets = currentDomain?.cpu?.sockets || 1;
          const currentTotalCpu = currentSockets * currentCores * currentThreads;
          
          // [热扩容配置判断] 同时检查 Annotation 和 maxSockets，确保准确识别热扩容能力
          const hotPlugAnnotation = activeRecord?.metadata?.annotations?.['harvesterhci.io/enableCPUAndMemoryHotplug'];
          const isHotPlugConfiguredByAnnotation = hotPlugAnnotation?.toLowerCase() === 'true';
          const hasMaxSockets = currentDomain?.cpu?.maxSockets && currentDomain.cpu.maxSockets > currentSockets;
          const isCurrentlyHotPlug = isHotPlugConfiguredByAnnotation && hasMaxSockets;

          // 如果要开启热扩容，且当前拓扑不是cores=1, threads=1，需要先设置拓扑
          const needTopologyFix = values.enableHotPlug && !isCurrentlyHotPlug && (currentCores !== 1 || currentThreads !== 1);
          
          if (needTopologyFix) {
            // 第一步：先设置拓扑为 sockets=x（现有CPU数量总和）, cores=1, threads=1
            // [关键修复] 不传入 enableHotPlug，避免触发热扩容逻辑（设置 maxSockets = 1）
            // 我们只是调整拓扑，不应该修改热扩容状态
            const topologyPayload: any = {
              cpu: currentTotalCpu, // 保持总CPU数不变
              cpuSockets: currentTotalCpu, // sockets = 现有CPU数量总和
              cpuCores: 1,
              cpuThreads: 1
              // 不传入 enableHotPlug，让后端只处理拓扑调整
            };
            
            await updateHarvesterVmSpec(cloudId, namespace, vmName, topologyPayload);
            message.info('已先设置CPU拓扑为cores=1, threads=1，正在开启热扩容...');
            
            // 刷新VM状态
            try {
              const refreshedVm = await fetchHarvesterVmDetail(cloudId, namespace, vmName);
              setLatestVm(refreshedVm?.data || refreshedVm);
              await new Promise(resolve => setTimeout(resolve, 300));
            } catch (e) {
              console.warn('刷新VM状态失败，继续执行', e);
              await new Promise(resolve => setTimeout(resolve, 500));
            }
          }
          
          // 第二步：提交热扩容设置
          let payload: any;
          
          if (values.enableHotPlug) {
            // 开启热扩容
            // [关键修复] 如果第一步调整了拓扑，需要在第二步时同时传入拓扑参数
            // 确保后端知道拓扑已经调整为单核模式，避免验证失败
            payload = {
              enableHotPlug: true,
              maxSockets: values.maxSockets,
              maxMemory: `${values.maxMemory}Gi`
            };
            
            // 如果第一步调整了拓扑，或者当前拓扑已经是单核模式，传入拓扑参数
            if (needTopologyFix || (currentCores === 1 && currentThreads === 1)) {
              // 获取调整后的拓扑（如果第一步调整了，使用调整后的值；否则使用当前值）
              const finalSockets = needTopologyFix ? currentTotalCpu : currentSockets;
              payload.cpuSockets = finalSockets;
              payload.cpuCores = 1;
              payload.cpuThreads = 1;
            }
          } else {
            // 关闭热扩容
            payload = {
              enableHotPlug: false
            };
          }

          await updateHarvesterVmSpec(cloudId, namespace, vmName, payload);
          message.success('热扩容设置已提交');
          // [修复] 开启热扩容应该无条件提示重启对话框
          // 只要开启了热扩容（values.enableHotPlug === true），就需要重启生效
          if (values.enableHotPlug) {
            openRestartConfirm(namespace, vmName, false);
          } else {
            // 关闭热扩容也需要重启生效
            openRestartConfirm(namespace, vmName, false);
          }
          break;
        }
        case 'cpu_advanced': {
          // 构造最小化 payload，避免将 null 之类的非法 quantity 传给后端
          const advancedPayload: any = {
            cpuSockets: values.cpuSockets,
            cpuCores: values.cpuCores,
            cpuThreads: values.cpuThreads,
            cpuModel: values.cpuModel,
            cpuModelCustom: values.cpuModelCustom,
            dedicatedCPUPlacement: values.dedicatedCPUPlacement,
            isolateEmulatorThread: values.isolateEmulatorThread,
          };

          if (values.dedicatedCPUPlacement) {
            advancedPayload.cpuRequest = null;
            advancedPayload.cpuLimit = null;
          } else {
            // 仅在用户填写了 cpuRequest 时才下发
            if (values.cpuRequest !== undefined && values.cpuRequest !== null && values.cpuRequest !== '') {
              advancedPayload.cpuRequest = Number(values.cpuRequest);
            }

            // 仅在用户填写了 cpuLimit 时才下发；未填写则不修改后端 limit 配置
            if (values.cpuLimit !== undefined && values.cpuLimit !== null && values.cpuLimit !== '') {
              advancedPayload.cpuLimit = Number(values.cpuLimit);
            }
          }

          if (typeof values.memoryRequestGi === 'number') {
            advancedPayload.memoryRequestGi = values.memoryRequestGi > 0 ? values.memoryRequestGi : null;
          }
          if (typeof values.memoryLimitGi === 'number') {
            advancedPayload.memoryLimitGi = values.memoryLimitGi > 0 ? values.memoryLimitGi : null;
          }

          await updateHarvesterVmSpec(cloudId, namespace, vmName, advancedPayload);
          message.success('性能设置已更新');
          openRestartConfirm(namespace, vmName, false);
          break;
        }
        case 'change_os': {
          // [修复] 处理容量值：空值/“自动选择”/无效 -> 使用默认值 40Gi
          let rootSize = '40Gi';
          const sizeValue = values.newOsRootSize;
          if (sizeValue !== undefined && sizeValue !== null && sizeValue !== '' && sizeValue !== '自动选择') {
            const numSize = Number(sizeValue);
            if (!isNaN(numSize) && numSize > 0) {
              rootSize = `${numSize}Gi`;
            }
          }
          
          // [修复] 验证必填字段
          if (!values.newOsImage) {
            message.error('请选择镜像');
            return;
          }

          // [安全确认] 用户必须勾选“我已知晓风险”复选框才能提交
          if (!values.changeOsConfirmed) {
            message.warning('请勾选确认更换系统盘的风险后再提交');
            return;
          }
          
          await updateHarvesterVmSpec(cloudId, namespace, vmName, {
             action: 'reinstall',
             image: values.newOsImage,
             rootSize: rootSize,
             bus: values.newOsBus || 'virtio',
             storageClassName: values.storageClassName || undefined,
             rootDeviceType: values.rootDeviceType || 'disk'
          });
          // message.success('重装系统请求已提交。请确保实例处于【停止】状态后，再点击【启动】（不要直接重启）。');
          openRestartConfirm(namespace, vmName, true);
          break;
        }
        case 'add_disk': {
          const volName = values.newDiskName;
          const created = !!values.newDiskCreated;

          // 两步流程：
          // - 第一次提交：只创建 PVC（避免 PVC 尚未 Bound 导致挂载需要点两次）
          // - 第二次提交：通过修改 VM 规格模板挂载数据盘（支持自定义总线类型，需重启生效）
          if (!created) {
            const accessMode = values.newDiskAccessMode || 'ReadWriteMany';
            const accessModeText = accessMode === 'ReadWriteOnce' ? 'RWO (ReadWriteOnce)' :
                                   accessMode === 'ReadWriteMany' ? 'RWX (ReadWriteMany)' :
                                   accessMode === 'ReadOnlyMany' ? 'ROX (ReadOnlyMany)' :
                                   'RWX (ReadWriteMany)';
            
            await createHarvesterVolume(cloudId, {
              namespace,
              name: volName,
              size: values.newDiskSize,
              storageClassName: values.newDiskSc,
              accessModes: [accessMode],
              volumeMode: 'Block',
            });
            form.setFieldsValue({ newDiskCreated: true });
            message.success(`数据盘创建成功（访问类型: ${accessModeText}），请再次点击【提交】进行挂载（需重启生效）`);
            return; // 不关闭弹窗
          }

          // 第二步：通过修改 VM 规格模板挂载数据盘，而不是走在线热插拔 API
          {
            const vmSpecSource = latestVm || record;
            const vmSpec = vmSpecSource?.spec || {};
            const tplSpec = vmSpec?.template?.spec || {};
            const domain = tplSpec?.domain || {};
            const devices = domain?.devices || {};
            const volumes = Array.isArray(tplSpec?.volumes) ? [...tplSpec.volumes] : [];
            const disks = Array.isArray(devices?.disks) ? [...devices.disks] : [];

            // 确保 PVC 作为 volume 存在
            const volExisting = volumes.find((v: any) => v?.name === volName);
            if (!volExisting) {
              volumes.push({
                name: volName,
                persistentVolumeClaim: { claimName: volName },
              });
            }

            // 为该 volume 添加/更新磁盘信息（总线类型由用户选择）
            const targetBus = values.newDiskBus || 'virtio';
            const diskExisting = disks.find((d: any) => d?.name === volName);
            if (diskExisting) {
              diskExisting.disk = diskExisting.disk || {};
              diskExisting.disk.bus = targetBus;
              // 不设置 bootOrder，避免误当成系统盘
            } else {
              disks.push({
                name: volName,
                disk: { bus: targetBus },
              });
            }

            const patchPayload: any = {
              spec: {
                template: {
                  spec: {
                    ...tplSpec,
                    domain: {
                      ...domain,
                      devices: {
                        ...devices,
                        disks,
                      },
                    },
                    volumes,
                  },
                },
              },
            };

            await patchHarvesterVm(cloudId, namespace, vmName, patchPayload);
          }

          try {
            const res: any = await fetchHarvesterVMAggregated(cloudId, namespace, vmName);
            const data = res?.data?.vm ? res.data : res;
            const updatedVm = data?.vm || data;
            if (updatedVm && data?.related) {
              updatedVm.related = data.related;
            }
            setLatestVm(updatedVm);
          } catch {
            // 刷新失败不影响后续重启提示
          }
          // 无论后端是否显式打上 RestartRequired，都统一给出“需重启”提示
          message.success('数据盘挂载成功，设置已保存，需要重启后生效');
          openRestartConfirm(namespace, vmName, false);
          // 清理 step 标记，避免下次复用表单误走挂载
          form.setFieldsValue({ newDiskCreated: false });

          // 通知上层刷新（VM + volumes），并关闭
          try { onOk?.(true); } catch {}
          onClose?.();
          break;
        }
        case 'change_gpu': {
          const mode = values.gpuMode || 'none';
          const names = Array.isArray(values.gpuResourceNames) ? values.gpuResourceNames : [];
          const deviceNames = Array.isArray(values.gpuDeviceNames) ? values.gpuDeviceNames : [];
          const gpuNodeName = values.gpuNodeName !== undefined ? values.gpuNodeName : undefined;
          
          // [节点选择器校验] 如果是直通GPU（非vGPU），需要校验节点选择器
          if (mode !== 'none' && mode !== 'vgpu' && names.length > 0) {
            const activeVm = latestVm || record;
            const currentNodeSelector = activeVm?.spec?.template?.spec?.nodeSelector || {};
            const currentNodeName = currentNodeSelector['kubernetes.io/hostname'];
            
            // 获取要挂载的GPU设备所在的节点
            const gpuList = Array.isArray(gpuResources) ? gpuResources : [];
            const targetGpus = names.map((rn: string) => gpuList.find((g: any) => String(g?.resourceName || '') === String(rn))).filter(Boolean);
            const targetNodes = targetGpus.map((g: any) => String(g?.node || g?.nodeName || '').trim()).filter(Boolean);
            const uniqueTargetNodes = Array.from(new Set(targetNodes));
            
            if (uniqueTargetNodes.length > 0) {
              const targetNode = uniqueTargetNodes[0]; // 取第一个节点（如果多个节点不一致，后面会拒绝）
              
              // 检查当前VM是否有其他直通设备（USB或GPU）
              const domain = activeVm?.spec?.template?.spec?.domain;
              const hostDevices = Array.isArray(domain?.devices?.hostDevices) ? domain.devices.hostDevices : [];
              const currentGpus = Array.isArray(domain?.devices?.gpus) ? domain.devices.gpus : [];
              const isUsbHostDevice = (d: any) => {
                const dn = String(d?.deviceName || '').toLowerCase();
                const n = String(d?.name || '').toLowerCase();
                return n.startsWith('usb') || dn.includes('usb');
              };
              const isGpuLikeHostDevice = (d: any) => {
                if (isUsbHostDevice(d)) return false;
                const dn = String(d?.deviceName || '').toLowerCase();
                const n = String(d?.name || '').toLowerCase();
                return n.startsWith('gpu') || dn.startsWith('nvidia.com/');
              };
              const hasOtherPassthroughDevices = hostDevices.some((d: any) => isGpuLikeHostDevice(d) || isUsbHostDevice(d)) || currentGpus.length > 0;
              
              // 1. 判断是否有节点选择器
              if (!currentNodeName) {
                // 2. 如果没有，自动设置节点选择器
                await updateHarvesterVmSpec(cloudId, namespace, vmName, {
                  gpuMode: mode,
                  gpuResourceNames: names,
                  gpuDeviceNames: deviceNames,
                  gpuNodeName: targetNode,
                });
                message.success(`GPU配置已更新，已自动设置节点选择器为 ${targetNode}`);
                openRestartConfirm(namespace, vmName, false);
                break;
              } else {
                // 3. 如果有节点选择器
                if (!hasOtherPassthroughDevices) {
                  // 3.1 没有其他直通设备，提示用户是否变更节点
                  if (currentNodeName !== targetNode) {
                    Modal.confirm({
                      title: '节点选择器不一致',
                      content: `当前VM的节点选择器为 ${currentNodeName}，但GPU设备位于节点 ${targetNode}。是否将节点选择器变更为 ${targetNode}？`,
                      okText: '是，变更节点',
                      cancelText: '取消',
                      onOk: async () => {
                        await updateHarvesterVmSpec(cloudId, namespace, vmName, {
                          gpuMode: mode,
                          gpuResourceNames: names,
                          gpuDeviceNames: deviceNames,
                          gpuNodeName: targetNode,
                        });
                        message.success('GPU配置已更新，节点选择器已变更');
                        openRestartConfirm(namespace, vmName, false);
                      },
                    });
                    return; // 不继续执行，等待用户确认
                  }
                } else {
                  // 3.2 有其他直通设备
                  if (currentNodeName === targetNode) {
                    // 3.2.1 节点选择器与自己一致，跳过（直接提交）
                  } else {
                    // 3.2.2 节点选择器与自己不一致，拒绝变配
                    message.error(`无法挂载GPU：当前VM已挂载其他直通设备，节点选择器为 ${currentNodeName}，但GPU设备位于节点 ${targetNode}。请先移除其他直通设备或选择位于 ${currentNodeName} 节点的GPU设备。`);
                    return; // 拒绝提交
                  }
                }
              }
              
              // 检查多个GPU是否在同一节点
              if (uniqueTargetNodes.length > 1) {
                message.error(`无法挂载GPU：选择的GPU设备位于不同节点（${uniqueTargetNodes.join(', ')}），请选择位于同一节点的GPU设备。`);
                return; // 拒绝提交
              }
            }
          }
          
          await updateHarvesterVmSpec(cloudId, namespace, vmName, {
            gpuMode: mode,
            gpuResourceNames: mode === 'none' ? [] : names,
            gpuDeviceNames: mode === 'none' ? [] : deviceNames,
            gpuNodeName: mode === 'none' ? null : gpuNodeName,
          });
          message.success('GPU配置已更新');
          openRestartConfirm(namespace, vmName, false);
          break;
        }
        case 'change_node_scheduling': {
          const mode = values.nodeSchedulingMode;
          const fixedNode = values.fixedNode;
          const nodeSelectorPairs = values.nodeSelectorPairs || [];
          
          // 验证
          if (mode === 'fixed' && !fixedNode) {
            message.error('请选择要固定的节点');
            return;
          }
          if (mode === 'label') {
            const validPairs = nodeSelectorPairs.filter((p: any) => p?.key && p?.value);
            if (validPairs.length === 0) {
              message.error('请至少添加一个标签选择器');
              return;
            }
          }
          
          // 构建提交参数
          let updateParams: any = {};
          
          if (mode === 'auto') {
            // 自动调度：清空所有 nodeSelector
            updateParams.nodeSelector = null;
          } else if (mode === 'fixed') {
            // 指定主机：使用 nodeSelector
            const nodeName = String(fixedNode || '').trim();
            if (nodeName) {
              updateParams.nodeSelector = {
                'kubernetes.io/hostname': nodeName
              };
            } else {
              updateParams.nodeSelector = null;
            }
          } else if (mode === 'label') {
            // 标签选择：构建 nodeSelector 对象
            const nodeSelector: Record<string, string> = {};
            nodeSelectorPairs.forEach((p: any) => {
              const key = String(p?.key || '').trim();
              const value = String(p?.value || '').trim();
              if (key && value) {
                nodeSelector[key] = value;
              }
            });
            updateParams.nodeSelector = Object.keys(nodeSelector).length > 0 ? nodeSelector : null;
          }

          await updateHarvesterVmSpec(cloudId, namespace, vmName, updateParams);
          message.success('节点调度配置已更新');
          openRestartConfirm(namespace, vmName, false);
          break;
        }
        case 'change_node_affinity': {
          const mode = values.nodeAffinityMode;
          const terms = values.nodeAffinityTerms || [];
          
          // 构建 nodeAffinity
          let nodeAffinity: any = null; // 使用 null 表示清空
          if (mode === 'required' && terms.length > 0) {
            const nodeSelectorTerms = terms.map((term: any) => {
              const expressions = (term.expressions || []).filter((expr: any) => expr?.key && expr?.operator);
              if (expressions.length === 0) return null;
              
              return {
                matchExpressions: expressions.map((expr: any) => {
                  const matchExpr: any = {
                    key: String(expr.key || '').trim(),
                    operator: String(expr.operator || 'In'),
                  };
                  
                  // 某些操作符不需要 values（如 Exists, DoesNotExist）
                  if (!['Exists', 'DoesNotExist'].includes(matchExpr.operator)) {
                    const values = Array.isArray(expr.values) ? expr.values : [];
                    const filteredValues = values.filter((v: any) => v && String(v).trim()).map((v: any) => String(v).trim());
                    if (filteredValues.length > 0) {
                      matchExpr.values = filteredValues;
                    } else {
                      // 如果操作符需要值但没有提供，跳过这个表达式
                      return null;
                    }
                  }
                  
                  return matchExpr;
                }).filter((expr: any) => expr !== null && expr.key),
              };
            }).filter((term: any) => term !== null && term.matchExpressions && term.matchExpressions.length > 0);
            
            if (nodeSelectorTerms.length > 0) {
              nodeAffinity = {
                nodeAffinity: {
                  requiredDuringSchedulingIgnoredDuringExecution: {
                    nodeSelectorTerms,
                  },
                },
              };
            }
          }
          
          await updateHarvesterVmSpec(cloudId, namespace, vmName, { affinity: nodeAffinity });
          message.success('节点亲和性配置已更新');
          openRestartConfirm(namespace, vmName, false);
          break;
        }
        case 'change_usb': {
          const names = Array.isArray(values.usbResourceNames) ? values.usbResourceNames : [];
          
          // [节点选择器校验] USB是直通设备，需要校验节点选择器
          if (names.length > 0) {
            const activeVm = latestVm || record;
            const currentNodeSelector = activeVm?.spec?.template?.spec?.nodeSelector || {};
            const currentNodeName = currentNodeSelector['kubernetes.io/hostname'];
            
            // 获取要挂载的USB设备所在的节点
            const usbList = Array.isArray(usbResources) ? usbResources : [];
            const targetUsbs = names.map((rn: string) => usbList.find((u: any) => String(u?.resourceName || '') === String(rn))).filter(Boolean);
            const targetNodes = targetUsbs.map((u: any) => String(u?.nodeName || u?.node || '').trim()).filter(Boolean);
            const uniqueTargetNodes = Array.from(new Set(targetNodes));
            
            if (uniqueTargetNodes.length > 0) {
              const targetNode = uniqueTargetNodes[0]; // 取第一个节点（如果多个节点不一致，后面会拒绝）
              
              // 检查当前VM是否有其他直通设备（USB或GPU）
              const domain = activeVm?.spec?.template?.spec?.domain;
              const hostDevices = Array.isArray(domain?.devices?.hostDevices) ? domain.devices.hostDevices : [];
              const currentGpus = Array.isArray(domain?.devices?.gpus) ? domain.devices.gpus : [];
              const isUsbHostDevice = (d: any) => {
                const dn = String(d?.deviceName || '').toLowerCase();
                const n = String(d?.name || '').toLowerCase();
                return n.startsWith('usb') || dn.includes('usb');
              };
              const isGpuLikeHostDevice = (d: any) => {
                if (isUsbHostDevice(d)) return false;
                const dn = String(d?.deviceName || '').toLowerCase();
                const n = String(d?.name || '').toLowerCase();
                return n.startsWith('gpu') || dn.startsWith('nvidia.com/');
              };
              const hasOtherPassthroughDevices = hostDevices.some((d: any) => isGpuLikeHostDevice(d) || isUsbHostDevice(d)) || currentGpus.length > 0;
              
              // 1. 判断是否有节点选择器
              if (!currentNodeName) {
                // 2. 如果没有，自动设置节点选择器
                await updateHarvesterVmSpec(cloudId, namespace, vmName, { 
                  usbResourceNames: names,
                  nodeSelector: { 'kubernetes.io/hostname': targetNode }
                });
                message.success(`USB配置已更新，已自动设置节点选择器为 ${targetNode}`);
                openRestartConfirm(namespace, vmName, false);
                break;
              } else {
                // 3. 如果有节点选择器
                if (!hasOtherPassthroughDevices) {
                  // 3.1 没有其他直通设备，提示用户是否变更节点
                  if (currentNodeName !== targetNode) {
                    Modal.confirm({
                      title: '节点选择器不一致',
                      content: `当前VM的节点选择器为 ${currentNodeName}，但USB设备位于节点 ${targetNode}。是否将节点选择器变更为 ${targetNode}？`,
                      okText: '是，变更节点',
                      cancelText: '取消',
                      onOk: async () => {
                        await updateHarvesterVmSpec(cloudId, namespace, vmName, { 
                          usbResourceNames: names,
                          nodeSelector: { 'kubernetes.io/hostname': targetNode }
                        });
                        message.success('USB配置已更新，节点选择器已变更');
                        openRestartConfirm(namespace, vmName, false);
                      },
                    });
                    return; // 不继续执行，等待用户确认
                  }
                } else {
                  // 3.2 有其他直通设备
                  if (currentNodeName === targetNode) {
                    // 3.2.1 节点选择器与自己一致，跳过（直接提交）
                  } else {
                    // 3.2.2 节点选择器与自己不一致，拒绝变配
                    message.error(`无法挂载USB：当前VM已挂载其他直通设备，节点选择器为 ${currentNodeName}，但USB设备位于节点 ${targetNode}。请先移除其他直通设备或选择位于 ${currentNodeName} 节点的USB设备。`);
                    return; // 拒绝提交
                  }
                }
              }
              
              // 检查多个USB是否在同一节点
              if (uniqueTargetNodes.length > 1) {
                message.error(`无法挂载USB：选择的USB设备位于不同节点（${uniqueTargetNodes.join(', ')}），请选择位于同一节点的USB设备。`);
                return; // 拒绝提交
              }
            }
          }
          
          await updateHarvesterVmSpec(cloudId, namespace, vmName, { usbResourceNames: names });
          message.success('USB配置已更新');
          openRestartConfirm(namespace, vmName, false);
          break;
        }
        case 'vm_policy': {
          const rs = values.runStrategy || 'Manual';
          const es = values.evictionStrategy ? String(values.evictionStrategy) : null;
          await updateHarvesterVmSpec(cloudId, namespace, vmName, { runStrategy: rs, evictionStrategy: es });
          message.success('策略配置已更新');
          openRestartConfirm(namespace, vmName, false);
          break;
        }
        case 'change_primary_nic': {
           // Construct new networks list with modified primary
           const nic = values.primaryNic;
           const netMode = values.netMode || 'flat';
           // We need to fetch current VM state to be safe, but using record is okay for now
           const networks = [...(record?.spec?.template?.spec?.networks || [])];
           const interfaces = [...(record?.spec?.template?.spec?.domain?.devices?.interfaces || [])];
           
           if (interfaces.length > 0) {
              // Update interface[0]
              const interfaceConfig: any = {
                 name: networks[0]?.name || 'default', // Keep link name
                 model: nic.model || 'virtio',
              };
              
              // Set MAC address if provided
              if (nic.macAddress) {
                 interfaceConfig.macAddress = nic.macAddress;
              }
              
              // Set interface type (managedtap binding, bridge, masquerade, sriov, macvtap)
              if (nic.type === 'managedtap') {
                 interfaceConfig.binding = { name: 'managedtap' };
              } else if (nic.type === 'masquerade') {
                 interfaceConfig.masquerade = {};
              } else if (nic.type === 'sriov') {
                 interfaceConfig.sriov = {};
              } else if (nic.type === 'macvtap') {
                 interfaceConfig.macvtap = {};
              } else {
                 interfaceConfig.bridge = {};
              }
              
              interfaces[0] = interfaceConfig;
              
              // Update network[0]
              let pNetName = nic.name;
              
              // Handle different network modes
              if (netMode === 'vpc') {
                 // VPC network: subnet name is the network name
                 const subnetName = nic.subnet || nic.name || '';
                 if (subnetName) {
                    const subnet = subnets.find((s: any) => s?.metadata?.name === subnetName);
                    if (subnet?.metadata?.namespace) {
                       pNetName = `${subnet.metadata.namespace}/${subnetName}`;
                    } else {
                       const nad = nads.find((n: any) => n?.metadata?.name === subnetName);
                       if (nad?.metadata?.namespace) {
                          pNetName = `${nad.metadata.namespace}/${subnetName}`;
                       } else {
                          pNetName = subnetName;
                       }
                    }
                 } else {
                    pNetName = '';
                 }
              } else if (netMode === 'flat_subnet') {
                 const raw = nic.name || '';
                 const subnetName =
                    nic.subnet ||
                    (raw && String(raw).includes('/') ? String(raw).split('/').pop() : raw) ||
                    '';
                 if ((!pNetName || !String(pNetName).includes('/')) && subnetName) {
                    const subnet = subnets.find((s: any) => s?.metadata?.name === subnetName);
                    let ns = subnet?.metadata?.namespace;
                    if (!ns && subnet?.spec?.provider) {
                       const parts = String(subnet.spec.provider).split('.');
                       if (parts.length >= 2) ns = parts[parts.length - 2];
                    }
                    if (ns) {
                       pNetName = `${ns}/${subnetName}`;
                    } else {
                       const nad = nads.find((n: any) => n?.metadata?.name === subnetName);
                       if (nad?.metadata?.namespace) {
                          pNetName = `${nad.metadata.namespace}/${subnetName}`;
                       } else {
                          pNetName = subnetName;
                       }
                    }
                 } else if (!subnetName) {
                    pNetName = '';
                 }
              } else if (netMode === 'flat') {
                 // Flat network: NAD name (namespace/name format)
                 if (!pNetName) {
                    // If no name selected, use pod network
                    pNetName = 'default/pod';
                 } else if (!pNetName.includes('/')) {
                    // If name doesn't have namespace, try to resolve it from loaded NADs
                    const found = nads.find((n: any) => n.metadata.name === pNetName);
                    if (found) {
                       pNetName = `${found.metadata.namespace}/${found.metadata.name}`;
                    } else {
                       // Fallback: assume it's in default namespace
                       pNetName = `default/${pNetName}`;
                    }
                 }
              } else if (netMode === 'passthrough') {
                 // Passthrough network: SR-IOV/Macvtap NAD
                 if (!pNetName) {
                    pNetName = 'default/pod';
                 } else if (!pNetName.includes('/')) {
                    const found = nads.find((n: any) => n.metadata.name === pNetName);
                    if (found) {
                       pNetName = `${found.metadata.namespace}/${found.metadata.name}`;
                    } else {
                       pNetName = `default/${pNetName}`;
                    }
                 }
              } else {
                 pNetName = pNetName || 'default/pod';
              }

              // Build network configuration
              if (pNetName === 'default/pod' || !pNetName) {
                 // Pod network: no multus needed
                 networks[0] = {
                    name: networks[0]?.name || 'default',
                 };
              } else {
                 // Multus network: NAD or VPC subnet
                 networks[0] = {
                    name: networks[0]?.name || 'default',
                    multus: { networkName: pNetName }
                 };
              }

              if (hasDuplicateFlatSubnetsInNetworks(networks, subnets)) {
                message.error('同一扁平子网在同一云主机内只能使用一次');
                return;
              }

              const payload: any = { networks, interfaces };

              // --- Static IP Handling (NetworkData) ---
              let networkDataObj = getParsedNetworkData(record);
              let hasNetworkDataChange = false;
              const ifaceName = 'nic-0'; // Primary NIC

              if (nic.ipAddress) {
                 hasNetworkDataChange = true;
                 if (!networkDataObj.network) networkDataObj.network = { version: 2, ethernets: {} };
                 if (!networkDataObj.network.ethernets) networkDataObj.network.ethernets = {};
                 
                 const mac = nic.macAddress || interfaces[0].macAddress;
                 const ethConfig: any = {
                     addresses: [nic.ipAddress]
                 };
                 
                 if (mac) {
                     ethConfig.match = { macaddress: mac };
                 } else {
                     ethConfig.match = { name: 'e*' };
                 }

                 if (nic.gateway) ethConfig.gateway4 = nic.gateway;
                 if (nic.dns) {
                    const dnsList = nic.dns.split(/[,;\s]+/).filter((d: string) => d.trim());
                    if (dnsList.length > 0) {
                        ethConfig.nameservers = { addresses: dnsList };
                    }
                 }
                 // Use nic-0 as key
                 networkDataObj.network.ethernets[ifaceName] = ethConfig;
                 
                 // Clean up legacy 'nic0' key if it exists to avoid duplicates/confusion
                 if (networkDataObj.network.ethernets['nic0']) {
                     delete networkDataObj.network.ethernets['nic0'];
                 }
              } else {
                 // Remove static config if exists
                 if (networkDataObj?.network?.ethernets?.[ifaceName]) {
                     delete networkDataObj.network.ethernets[ifaceName];
                     hasNetworkDataChange = true;
                 }
                 if (networkDataObj?.network?.ethernets?.['nic0']) {
                     delete networkDataObj.network.ethernets['nic0'];
                     hasNetworkDataChange = true;
                 }
              }
                 
              if (hasNetworkDataChange) {
                 payload.networkData = yaml.dump(networkDataObj);
              }
              
              {
                const nadList = await ensureNadsLoaded();
                const missing = getMissingNadsFromNetworks(networks, String(namespace || 'default'), nadList);
                if (missing.length > 0) {
                  message.error(`更新失败：引用的 NAD 不存在：${missing.join(', ')}。请更换为存在的网络后再提交。`);
                  return;
                }
              }

              await updateHarvesterVmSpec(cloudId, namespace, vmName, payload);
              openRestartConfirm(namespace, vmName, false);
           }
           break;
        }
        case 'change_secondary_nic': {
           const secondaryNics = values.secondaryNics || [];
           
           // Fetch current state
           const currentNetworks = record?.spec?.template?.spec?.networks || [];
           const currentInterfaces = record?.spec?.template?.spec?.domain?.devices?.interfaces || [];
           
           // Keep Primary NIC (index 0) if exists
           const newNetworks = currentNetworks.length > 0 ? [currentNetworks[0]] : [];
           const newInterfaces = currentInterfaces.length > 0 ? [currentInterfaces[0]] : [];
           
           let networkDataObj = getParsedNetworkData(record);
           let hasNetworkDataChange = false;

           const primaryIfaceName =
             String(currentInterfaces[0]?.name || currentNetworks[0]?.name || '').trim() || 'default';
           const secondaryIfaceNames = allocateSecondaryNicNames(primaryIfaceName, secondaryNics.length);

           // Append Secondary NICs
           secondaryNics.forEach((nic: any, idx: number) => {
              const ifaceName = secondaryIfaceNames[idx];
              let mac = nic.macAddress;

              // Auto-generate MAC if Static IP is used but MAC is missing
              if (nic.ipAddress && !mac) {
                  mac = generateMacAddress();
              }

              // Interface
              const ifaceRow: any = {
                 name: ifaceName,
                 model: nic.model || 'virtio',
                 macAddress: mac,
              };
              const nt = nic.type || 'bridge';
              if (nt === 'managedtap') ifaceRow.binding = { name: 'managedtap' };
              else if (nt === 'masquerade') ifaceRow.masquerade = {};
              else if (nt === 'sriov') ifaceRow.sriov = {};
              else if (nt === 'macvtap') ifaceRow.macvtap = {};
              else ifaceRow.bridge = {};
              newInterfaces.push(ifaceRow);
              
              // Network
              let sNetName = nic.name;
              // Handle flat network name resolution
              if (nic.mode === 'flat' && sNetName && !sNetName.includes('/')) {
                  const found = nads.find((n: any) => n.metadata.name === sNetName);
                  if (found) sNetName = `${found.metadata.namespace}/${found.metadata.name}`;
              }
              if (nic.mode === 'passthrough' && sNetName && !sNetName.includes('/')) {
                  const found = nads.find((n: any) => n.metadata.name === sNetName);
                  if (found) sNetName = `${found.metadata.namespace}/${found.metadata.name}`;
              }
              // Handle VPC network name (subnet name -> NAD name)
              // For Kube-OVN VPC, subnet name should match NAD name, but networkName needs namespace/name format
              if (nic.mode === 'vpc') {
                  const subnetName = nic.subnet;
                  if (subnetName) {
                      // 按子网名 + VPC 查找，避免跨 VPC 同名子网误匹配
                      const subnet = subnets.find(
                        (s: any) =>
                          s?.metadata?.name === subnetName &&
                          String(s?.spec?.vpc || s?.vpc || '').trim() === String(nic?.vpc || '').trim(),
                      );
                      if (subnet?.metadata?.namespace) {
                          sNetName = `${subnet.metadata.namespace}/${subnetName}`;
                      } else {
                          // Fallback: try to find NAD with same name
                          const nad = nads.find((n: any) => n.metadata.name === subnetName);
                          if (nad) {
                              sNetName = `${nad.metadata.namespace}/${subnetName}`;
                          } else {
                              // Last resort: use subnet name only (may fail if NAD not found)
                              sNetName = subnetName;
                          }
                      }
                  }
              }
              if (nic.mode === 'flat_subnet') {
                  const raw = nic.name || '';
                  const subnetName =
                      nic.subnet ||
                      (raw && String(raw).includes('/') ? String(raw).split('/').pop() : raw) ||
                      '';
                  if ((!sNetName || !String(sNetName).includes('/')) && subnetName) {
                      const subnet = subnets.find(
                        (s: any) =>
                          s?.metadata?.name === subnetName &&
                          String(s?.spec?.vpc || s?.vpc || '').trim() === 'ovn-cluster',
                      );
                      let ns = subnet?.metadata?.namespace;
                      if (!ns && subnet?.spec?.provider) {
                          const parts = String(subnet.spec.provider).split('.');
                          if (parts.length >= 2) ns = parts[parts.length - 2];
                      }
                      if (ns) {
                          sNetName = `${ns}/${subnetName}`;
                      } else {
                          const nad = nads.find((n: any) => n?.metadata?.name === subnetName);
                          if (nad?.metadata?.namespace) {
                              sNetName = `${nad.metadata.namespace}/${subnetName}`;
                          } else {
                              sNetName = subnetName;
                          }
                      }
                  }
              }

              newNetworks.push({
                 name: ifaceName,
                 multus: { networkName: sNetName }
              });

              // Update NetworkData for Static IP
              if (nic.ipAddress) {
                  hasNetworkDataChange = true;
                  if (!networkDataObj.network) networkDataObj.network = { version: 2, ethernets: {} };
                  if (!networkDataObj.network.ethernets) networkDataObj.network.ethernets = {};
                  
                  const ethConfig: any = {
                      match: { macaddress: mac },
                      addresses: [nic.ipAddress]
                  };
                  if (nic.gateway) ethConfig.gateway4 = nic.gateway;
                  if (nic.dns) {
                      const dnsList = nic.dns.split(/[,;\s]+/).filter((d: string) => d.trim());
                      if (dnsList.length > 0) {
                          ethConfig.nameservers = { addresses: dnsList };
                      }
                  }
                  networkDataObj.network.ethernets[ifaceName] = ethConfig;
              } else {
                  // If switching back to DHCP, remove static config for this interface
                  if (networkDataObj?.network?.ethernets?.[ifaceName]) {
                      delete networkDataObj.network.ethernets[ifaceName];
                      hasNetworkDataChange = true;
                  }
              }
           });

           if (hasDuplicateFlatSubnetsInNetworks(newNetworks, subnets)) {
               message.error('同一扁平子网在同一云主机内只能使用一次');
               return;
           }

           // 删除 cloud-init 中已无对应网卡的 ethernets 条目（与当前 interfaces[].name 对齐）
           const ifaceNamesInSpec = new Set(
             newInterfaces.map((i: any) => String(i?.name || '').trim()).filter(Boolean),
           );
           if (networkDataObj?.network?.ethernets) {
             Object.keys(networkDataObj.network.ethernets).forEach((key) => {
               if (!ifaceNamesInSpec.has(key)) {
                 delete networkDataObj.network.ethernets[key];
                 hasNetworkDataChange = true;
               }
             });
           }

           const payload: any = {
              networks: newNetworks,
              interfaces: newInterfaces
           };

           if (hasNetworkDataChange) {
               payload.networkData = yaml.dump(networkDataObj);
           }

           {
             const nadList = await ensureNadsLoaded();
             const missing = getMissingNadsFromNetworks(newNetworks, String(namespace || 'default'), nadList);
             if (missing.length > 0) {
               message.error(`更新失败：引用的 NAD 不存在：${missing.join(', ')}。请更换为存在的网络后再提交。`);
               return;
             }
           }

           await updateHarvesterVmSpec(cloudId, namespace, vmName, payload);
           openRestartConfirm(namespace, vmName, false);
           break;
        }
        // ... other cases
        default:
          break;
      }
      onOk();
      onClose();
    } catch (e: any) {
      console.error(e);
      // 如果不是表单校验错误，则提示后端/逻辑异常
      if (!e?.errorFields) {
        let errorMsg = e?.message || '操作失败';
        
        if (typeof errorMsg === 'string') {
          // KubeVirt/Harvester Webhook Error Translation
          if (errorMsg.includes('Guest memory is greater than the configured maxGuest memory')) {
            errorMsg = '调整后的内存超过了配置的最大限制（热扩容上限），请求被拒绝。';
          }
          const nadNotFound = errorMsg.match(/network-attachment-definitions\.k8s\.cni\.cncf\.io\s+"([^"]+)"\s+not\s+found/i);
          if (nadNotFound?.[1]) {
            errorMsg = `更新失败：引用的网络附件（NAD）不存在：${nadNotFound[1]}。请在虚拟机网卡配置中更换为存在的网络，或在对应命名空间创建该 NAD。`;
          }
        }

        message.error(errorMsg);
      }
    }
  };

  // ============================================================================
  // Add Disk: Split Actions (Create vs Attach) for better UX
  // 注意：PVC 就绪等待逻辑在后端 harvesterAddVolumeToVM(*)
  // 已经实现，这里不再阻塞前端交互，只在创建成功后允许挂载。
  // ============================================================================
  /** 「添加数据盘」：按表单创建 PVC，可选随后挂载到 VM。 */
  const handleCreateDisk = async () => {
    if (diskCreating || diskAttaching) return;
    setDiskCreating(true);
    try {
      const values = await form.validateFields(['newDiskName', 'newDiskSize', 'newDiskSc', 'newDiskAccessMode']);
      const vmName = record?.metadata?.name;
      const namespace = record?.metadata?.namespace;
      if (!vmName || !namespace) throw new Error('无法解析虚拟机信息');

      const volName = values.newDiskName;
      const accessMode = values.newDiskAccessMode || 'ReadWriteMany';
      const accessModeText = accessMode === 'ReadWriteOnce' ? 'RWO (ReadWriteOnce)' :
                             accessMode === 'ReadWriteMany' ? 'RWX (ReadWriteMany)' :
                             accessMode === 'ReadOnlyMany' ? 'ROX (ReadOnlyMany)' :
                             'RWX (ReadWriteMany)';
      
      await createHarvesterVolume(cloudId, {
        namespace,
        name: volName,
        size: values.newDiskSize,
        storageClassName: values.newDiskSc,
        accessModes: [accessMode],
        volumeMode: 'Block',
      });

      form.setFieldsValue({ newDiskCreated: true });
      message.success(`数据盘创建成功（访问类型: ${accessModeText}），请点击【挂载磁盘】继续`);
    } catch (e: any) {
      // 表单校验错误交给 antd
      if (e?.errorFields) return;
      message.error(e?.message || '创建磁盘失败');
    } finally {
      setDiskCreating(false);
    }
  };

  /** 将已有 PVC/卷挂载为 VM 的数据盘。 */
  const handleAttachDisk = async () => {
    if (diskCreating || diskAttaching) return;
    setDiskAttaching(true);
    try {
      const values = await form.validateFields(['newDiskName', 'newDiskCreated', 'newDiskBus', 'newDiskMode']);
      const vmName = record?.metadata?.name;
      const namespace = record?.metadata?.namespace;
      if (!vmName || !namespace) throw new Error('无法解析虚拟机信息');

      {
        const currentNetworks = activeRecord?.spec?.template?.spec?.networks || record?.spec?.template?.spec?.networks || [];
        const nadList = await ensureNadsLoaded();
        const missing = getMissingNadsFromNetworks(currentNetworks, String(namespace || 'default'), nadList);
        if (missing.length > 0) {
          message.error(`挂载失败：虚拟机网卡引用的 NAD 不存在：${missing.join(', ')}。请先在【变更网卡】中修复后再挂载磁盘。`);
          return;
        }
      }

      const created = !!values.newDiskCreated;
      if (!created) {
        message.warning('请先创建磁盘或选择已有磁盘');
        return;
      }

      const volName = values.newDiskName;
      const mode = values.newDiskMode || 'spec';

      if (mode === 'hotplug') {
        // 在线热插拔：仅支持运行中的虚拟机，总线类型固定为 SCSI
        const vmStatus = (latestVm || record)?.status?.printableStatus;
        if (vmStatus !== 'Running') {
          message.warning('仅支持在【运行中】的虚拟机上执行在线热插拔，请先启动虚拟机。');
          return;
        }

        // NAD 依赖检查沿用其他任务的逻辑
        {
          const currentNetworks = activeRecord?.spec?.template?.spec?.networks || record?.spec?.template?.spec?.networks || [];
          const nadList = await ensureNadsLoaded();
          const missing = getMissingNadsFromNetworks(currentNetworks, String(namespace || 'default'), nadList);
          if (missing.length > 0) {
            message.error(`挂载失败：虚拟机网卡引用的 NAD 不存在：${missing.join(', ')}。请先在【变更网卡】中修复后再执行在线热插拔。`);
            return;
          }
        }

        // 使用 InstanceId 格式（namespace/name）调用标准 addVolume 接口：
        // - 后端会等待 PVC Bound
        // - 调用 Harvester 原生 addVolume 动作（总线类型由 Harvester 固定为 SCSI）
        await attachHarvesterVolumeToVm(cloudId, `${namespace}/${vmName}`, {
          name: volName,
          pvcName: volName,
          pvcNamespace: namespace,
        });

        try {
          const updated = await fetchAggregatedVm(namespace, vmName);
          setLatestVm(updated);
        } catch (e: any) {
          console.warn('在线热插拔后刷新 VM 数据失败:', e);
        }

        message.success('数据盘已在线热插拔成功（SCSI，总线）');
        try { onOk?.(true); } catch {}
        onClose?.();
        return;
      }

      // 配置添加：通过修改 VM 规格模板挂载数据盘（支持自定义总线类型，需重启生效）
      {
        const vmSpecSource = latestVm || record;
        const vmSpec = vmSpecSource?.spec || {};
        const tplSpec = vmSpec?.template?.spec || {};
        const domain = tplSpec?.domain || {};
        const devices = domain?.devices || {};
        const volumes = Array.isArray(tplSpec?.volumes) ? [...tplSpec.volumes] : [];
        const disks = Array.isArray(devices?.disks) ? [...devices.disks] : [];

        // 确保 PVC 作为 volume 存在
        const volExisting = volumes.find((v: any) => v?.name === volName);
        if (!volExisting) {
          volumes.push({
            name: volName,
            persistentVolumeClaim: { claimName: volName },
          });
        }

        // 为该 volume 添加/更新磁盘信息
        const targetBus = values.newDiskBus || 'virtio';
        const diskExisting = disks.find((d: any) => d?.name === volName);
        if (diskExisting) {
          diskExisting.disk = diskExisting.disk || {};
          diskExisting.disk.bus = targetBus;
        } else {
          disks.push({
            name: volName,
            disk: { bus: targetBus },
          });
        }

        const patchPayload: any = {
          spec: {
            template: {
              spec: {
                ...tplSpec,
                domain: {
                  ...domain,
                  devices: {
                    ...devices,
                    disks,
                  },
                },
                volumes,
              },
            },
          },
        };

        await patchHarvesterVm(cloudId, namespace, vmName, patchPayload);
      }

      // 检查是否需要重启（添加/删除卷通常会触发 RestartRequired）
      // 使用聚合接口刷新，确保包含 related.volumes 数据
      try {
        const res: any = await fetchHarvesterVMAggregated(cloudId, namespace, vmName);
        // [兼容返回结构] 支持 { data: { vm, related } } 与 { vm, related } 两种形态
        const data = res?.data?.vm ? res.data : res;
        const updatedVm = data?.vm || data;
        
        // 合并 related 数据，确保 DetachDataDisk 组件能获取到 related.volumes
        if (updatedVm && data?.related) {
          updatedVm.related = data.related;
        }
        
        setLatestVm(updatedVm);
      } catch (refreshErr: any) {
        console.warn('刷新VM数据失败:', refreshErr);
        // 刷新失败不影响后续重启提示
      }
      // 统一弹出重启提示，而不是让用户自己判断
      message.success('数据盘挂载成功，设置已保存，需要重启后生效');
      setTimeout(() => {
        openRestartConfirm(namespace, vmName, false);
      }, 300);
      
      // 清理 step 标记，避免下次误走挂载
      form.setFieldsValue({ newDiskCreated: false });
      try { onOk?.(true); } catch {}
      onClose?.();
    } catch (e: any) {
      if (e?.errorFields) return;
      message.error(e?.message || '挂载失败');
    } finally {
      setDiskAttaching(false);
    }
  };

  /**
   * 使用聚合接口刷新当前 VM（含 related.volumes）；失败时回退到普通详情接口。
   */
  const refreshVm = async () => {
    if (!cloudId || !record?.metadata?.name || !record?.metadata?.namespace) return;
    try {
      // 使用聚合接口获取 VM 及关联资源（包括 related.volumes）
      const res: any = await fetchHarvesterVMAggregated(cloudId, record.metadata.namespace, record.metadata.name);
      
      // [兼容返回结构] 支持 { data: { vm, related } } 与 { vm, related } 两种形态
      const data = res?.data?.vm ? res.data : res;
      
      // 合并 vm 和 related 数据到 latestVm，确保 DetachDataDisk 组件能获取到 related.volumes
      const updatedVm = data?.vm || data;
      if (updatedVm && data?.related) {
        updatedVm.related = data.related;
      }
      
      setLatestVm(updatedVm);
    } catch (err: any) {
      console.error('刷新VM数据失败:', err);
      // 如果聚合接口失败，回退到普通接口
      try {
        const res: any = await fetchHarvesterVmDetail(cloudId, record.metadata.namespace, record.metadata.name);
        setLatestVm(res?.data || res);
      } catch (fallbackErr: any) {
        console.error('回退刷新也失败:', fallbackErr);
        throw err; // 抛出原始错误
      }
    }
  };

  /**
   * 解绑指定数据盘：提交前校验 VM 网卡引用的 NAD 仍存在，再调用 detach API 并刷新聚合 VM。
   */
  const handleDetachDisk = async (diskName: string) => {
    if (diskDetaching) return;
    setDiskDetaching(true);
    try {
      const vmName = record?.metadata?.name;
      const namespace = record?.metadata?.namespace;
      if (!vmName || !namespace) throw new Error('无法解析虚拟机信息');

      {
        const currentNetworks = activeRecord?.spec?.template?.spec?.networks || record?.spec?.template?.spec?.networks || [];
        const nadList = await ensureNadsLoaded();
        const missing = getMissingNadsFromNetworks(currentNetworks, String(namespace || 'default'), nadList);
        if (missing.length > 0) {
          message.error(`解绑失败：虚拟机网卡引用的 NAD 不存在：${missing.join(', ')}。请先在【变更网卡】中修复后再解绑磁盘。`);
          return;
        }
      }

      const instanceId = `${namespace}/${vmName}`;
      await detachHarvesterVolumeFromVm(cloudId, instanceId, {
        name: diskName,
      });

      // 使用聚合接口刷新，确保 DetachDataDisk 组件能获取到最新 related.volumes
      try {
        const res: any = await fetchHarvesterVMAggregated(cloudId, namespace, vmName);
        // [兼容返回结构] 支持 { data: { vm, related } } 与 { vm, related } 两种形态
        const data = res?.data?.vm ? res.data : res;
        const updatedVm = data?.vm || data;
        
        // 合并 related 数据，确保 DetachDataDisk 组件能获取到 related.volumes
        if (updatedVm && data?.related) {
          updatedVm.related = data.related;
        }
        
        setLatestVm(updatedVm);
      } catch (refreshErr: any) {
        console.warn('刷新VM数据失败:', refreshErr);
        // 刷新失败不影响后续重启提示
      }

      // 为避免依赖 RestartRequired 条件的时序问题，统一按“需重启”处理
      message.success('解绑成功，设置已保存，需要重启虚拟机后生效');
      setTimeout(() => {
        openRestartConfirm(namespace, vmName, false);
      }, 300);

      // 通知上层刷新（VM + volumes）
      try { onOk?.(true); } catch {}
    } catch (e: any) {
      // 提取友好的错误消息
      const errorMessage = e?.message || e?.response?.data?.message || '解绑失败';
      message.error(errorMessage);
      // 不再抛出错误，避免导致 Uncaught runtime error
      // 错误已经通过 message.error 显示给用户了
    } finally {
      setDiskDetaching(false);
    }
  };

  /** 当前 `activeRecord` 是否处于「需要重启」条件（供 UI 徽章等使用）。 */
  const isRestartRequired = useMemo(() => {
    const conditions = activeRecord?.status?.conditions || [];
    return conditions.some((c: any) => c.type === 'RestartRequired' && c.status === 'True');
  }, [activeRecord]);

  /** 暴露给 VmReconfigureModal：表单、菜单、资源列表、各类 reload、提交与磁盘操作等。 */
  return {
    form,
    selectedKey, setSelectedKey,
    scs, images, gpuResources, selectedGpuKeys, setSelectedGpuKeys,
    usbResources, selectedUsbKeys, setSelectedUsbKeys,
    nads, vpcs, subnets, setVpcs,
    nodes,
    gpuLoading,
    usbLoading,
    reloadScs, reloadImages, reloadGpuResources, reloadUsbResources, reloadNads, reloadVpcs, reloadSubnets, reloadNodes,
    handleSubmit,
    systemDisk,
    systemDiskSize,
    systemDiskLoading,
    getCurrentSpec,
    getMemoryInGi,
    isHotPlugEnabledOnVm,
    isHotPlugConfiguredOnVm,
    isRestartRequired,
    isHotPlugInProgress,
    latestVm,
    // add disk split actions
    diskCreating,
    diskAttaching,
    handleCreateDisk,
    handleAttachDisk,
    availableDiskPvcs,
    // detach disk actions
    diskDetaching,
    handleDetachDisk,
    refreshVm,
  };
};
