/**
 * @file useVmReconfigure.ts
 * @description Harvester 虚拟机变配弹窗（VmReconfigureModal）的状态与提交逻辑 Hook。
 *
 * 拆分说明（STRUCTURE：Harvester `ecs` 域内 `lib/` 放纯函数，提交体单独文件）：
 * - `lib/`：`vmReconfigureQuantity`、`vmReconfigureNetwork`、`vmReconfigureCloudInit` 等
 * - `vmReconfigureSubmit.ts`：`runVmReconfigureSubmit`（按 `selectedKey` 的表单提交分支）
 */
import { useState, useEffect, useMemo } from 'react';
import { Form, message, Modal } from 'antd';
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
} from '../../../../../../../services/harvesterApi';
import { rebootCloudProviderEcs } from '../../../../../../../services/api';
import { KUBE_OVN_FLAT_VPC } from '../../../kube-ovn/lib/kubeOvnSubnetConstants';
import { translateKnownApiErrorMessage } from '../../../../../../../utils/k8sErrorMessages';
import { isHarvesterVmImageReady, resolveVmImageKind } from '../../../../../../../utils/harvesterUtils';
import { parseSizeToGi } from '../VmCreateWizard/VmWizardUtils';
import { getVmRootImageIdFromVm } from '../../lib/vmImageStatus';
import { runVmReconfigureSubmit } from './vmReconfigureSubmit';
import { harvesterCreatedPvcNameFromResponse } from './lib/vmReconfigureHarvesterResponse';
import { parseQuantity, storageQuantityToGiB } from './lib/vmReconfigureQuantity';
import {
  allocateSecondaryNicNames,
  getMissingNadsFromNetworks,
  hasDuplicateFlatSubnetsInNetworks,
} from './lib/vmReconfigureNetwork';
import { applyBootOrderCdromFirst } from './lib/vmReconfigureBootOrder';
import { buildExpandDiskCandidates, type ExpandDiskCandidate } from './lib/vmReconfigureDiskCandidates';
import { parseVmCloudInitNetworkData } from './lib/vmReconfigureCloudInit';
import { getVmReconfigureCurrentSpec } from './lib/vmReconfigureCurrentSpec';
import { isRestartRequiredFromVm, isVmStopped } from './lib/vmReconfigureVmStatus';

export { buildExpandDiskCandidates, type ExpandDiskCandidate };

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
  // 添加磁盘：创建/挂载两步按钮的 loading 状态
  const [diskCreating, setDiskCreating] = useState(false);
  const [diskAttaching, setDiskAttaching] = useState(false);
  // 添加光盘（ISO）
  const [cdromCreating, setCdromCreating] = useState(false);
  const [cdromAttaching, setCdromAttaching] = useState(false);
  // 添加磁盘：可选择「已有磁盘」(PVC) 进行挂载
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
  /** 当前选中的「待扩容」PVC 的已有容量（GiB），用于下限校验与展示 */
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

  const expandDiskCandidates = useMemo(
    () => buildExpandDiskCandidates(activeRecord, record),
    [activeRecord, record],
  );

  /** 读取指定 PVC 容量并回填「新容量」输入框为当前值（用户再改大）。 */
  const loadExpandDiskSize = async (pvcName: string) => {
    const pvc = String(pvcName || '').trim();
    if (!pvc || !record?.metadata?.namespace) return;
    try {
      setSystemDiskLoading(true);
      const res = await fetchHarvesterVolume(cloudId, record.metadata.namespace, pvc);
      const data = res?.data || res;
      const cap = data?.spec?.resources?.requests?.storage || data?.status?.capacity?.storage;
      if (cap) {
        const sizeGi = storageQuantityToGiB(cap);
        setSystemDiskSize(sizeGi);
        form.setFieldsValue({ systemDiskSize: sizeGi });
      } else {
        setSystemDiskSize(null);
      }
    } catch (e) {
      console.error('Failed to load PVC size', e);
      setSystemDiskSize(null);
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
      const key =
        initialConfigType === 'mem_advanced'
          ? 'cpu_advanced'
          : initialConfigType === 'expand_system_disk'
            ? 'expand_disk'
            : initialConfigType;
      setSelectedKey(key);
    } else if (open && !initialConfigType) {
      setSelectedKey('change_spec');
    }
  }, [open, initialConfigType]);

  const getCurrentSpec = () => getVmReconfigureCurrentSpec(record, activeRecord);
  const getMemoryInGi = storageQuantityToGiB;

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
      case 'expand_disk': {
        const list = buildExpandDiskCandidates(latestVm || record, record);
        const first = list[0]?.pvcName;
        if (first) {
          form.setFieldsValue({ expandDiskPvc: first });
          void loadExpandDiskSize(first);
        } else {
          form.setFieldsValue({ expandDiskPvc: undefined, systemDiskSize: undefined });
          setSystemDiskSize(null);
        }
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
        const reqGi = reqMem ? storageQuantityToGiB(reqMem) : undefined;
        const limGi = limMem ? storageQuantityToGiB(limMem) : undefined;

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
                ? isVpc ? 'vpc' : 'flat_subnet'
                : type === 'sriov' || type === 'macvtap'
                  ? 'passthrough'
                  : isVpc
                    ? 'vpc'
                    : 'flat';
            const networkDataObj = parseVmCloudInitNetworkData(record);
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
                vpc:
                  netMode === 'vpc'
                    ? targetSubnet?.spec?.vpc
                    : netMode === 'flat_subnet'
                      ? String(targetSubnet?.spec?.vpc || targetSubnet?.vpc || KUBE_OVN_FLAT_VPC).trim() ||
                        KUBE_OVN_FLAT_VPC
                      : undefined,
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
          const networkDataObj = parseVmCloudInitNetworkData(record);

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
                ? isVpc ? 'vpc' : 'flat_subnet'
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
                vpc:
                  netMode === 'vpc'
                    ? targetSubnet?.spec?.vpc
                    : netMode === 'flat_subnet'
                      ? String(targetSubnet?.spec?.vpc || targetSubnet?.vpc || KUBE_OVN_FLAT_VPC).trim() ||
                        KUBE_OVN_FLAT_VPC
                      : undefined,
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
                ? isVpc ? 'vpc' : 'flat_subnet'
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
              vpc:
                mode === 'vpc'
                  ? targetSubnet?.spec?.vpc
                  : mode === 'flat_subnet'
                    ? String(targetSubnet?.spec?.vpc || targetSubnet?.vpc || KUBE_OVN_FLAT_VPC).trim() ||
                      KUBE_OVN_FLAT_VPC
                    : undefined,
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
        const r = activeRecord || record;
        const disks = r?.spec?.template?.spec?.domain?.devices?.disks || [];
        let bootDisk = disks.find((d: any) => d.bootOrder === 1 && !d.cdrom);
        if (!bootDisk) bootDisk = disks.find((d: any) => d.name === 'disk-0' && !d.cdrom);
        if (!bootDisk) bootDisk = disks.find((d: any) => d.name === 'rootdisk' && !d.cdrom);
        if (!bootDisk && disks.length > 0) bootDisk = disks.find((d: any) => !d.cdrom);

        let rootDeviceType: string = 'disk';
        let newOsBus = 'virtio';
        if (bootDisk) {
          if (bootDisk.cdrom) {
            rootDeviceType = 'cdrom';
            newOsBus = String(bootDisk.cdrom?.bus || 'sata').toLowerCase();
          } else if (bootDisk.disk) {
            rootDeviceType = 'disk';
            newOsBus = String(bootDisk.disk?.bus || 'virtio').toLowerCase();
          }
        }
        if (!['virtio', 'scsi', 'sata', 'ide'].includes(newOsBus)) {
          newOsBus = 'virtio';
        }

        const imgId = getVmRootImageIdFromVm(r);
        const patch: Record<string, unknown> = {
          rootSourceType: 'image',
          rootDeviceType,
          newOsBus,
        };
        if (imgId) {
          patch.newOsImage = imgId;
          const hit = (images || []).find((x: any) => {
            const name = x?.metadata?.name || x?.name;
            const ns = x?.metadata?.namespace || x?.namespace;
            const v = ns && name ? `${ns}/${name}` : name;
            return v === imgId;
          });
          if (hit) {
            const sc =
              (hit as any)?.storageClassName ||
              (hit as any)?.spec?.storageClassName ||
              (hit as any)?.status?.storageClassName;
            if (sc) patch.storageClassName = sc;
            const raw =
              (hit as any)?.spec?.virtualSize ??
              (hit as any)?.virtualSize ??
              (hit as any)?.size;
            const gi = parseSizeToGi(raw);
            if (gi > 0) patch.newOsRootSize = gi;
            const kind = resolveVmImageKind(hit);
            if (kind === 'iso') {
              patch.rootDeviceType = 'cdrom';
              const arch = String(
                r?.spec?.template?.spec?.architecture || r?.spec?.architecture || '',
              ).toLowerCase();
              const arm = arch.includes('arm64') || arch.includes('aarch');
              patch.newOsBus = arm ? 'scsi' : 'sata';
            } else if (kind === 'disk') {
              patch.rootDeviceType = 'disk';
            }
          }
        }

        form.setFieldsValue(patch);

        if (systemDisk && cloudId && record?.metadata?.namespace) {
          void (async () => {
            try {
              const res = await fetchHarvesterVolume(cloudId, record.metadata.namespace, systemDisk);
              const data = (res as any)?.data || res;
              const cap = data?.spec?.resources?.requests?.storage || data?.status?.capacity?.storage;
              const scFromPvc = data?.spec?.storageClassName;
              const pvcPatch: Record<string, unknown> = {};
              if (cap) {
                const gi = storageQuantityToGiB(cap);
                if (gi > 0) pvcPatch.newOsRootSize = gi;
              }
              if (scFromPvc) pvcPatch.storageClassName = scFromPvc;
              if (Object.keys(pvcPatch).length > 0) {
                form.setFieldsValue(pvcPatch);
              }
            } catch {
              /* PVC 回填失败不影响镜像注解路径 */
            }
          })();
        }
        break;
      }
      case 'add_disk': {
        if (!scs || scs.length === 0) reloadScs();
        if (!images || images.length === 0) reloadImages();
        form.setFieldsValue({
          newDiskSource: 'create',
          newDiskCreated: false,
          newDiskMode: 'spec',
          newDiskIsoImage: undefined,
          existingPvcName: undefined,
          newDiskBootFromCdrom: false,
        });
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
                  if (!x.namespace || !x.pvcName) return x;
                  const raw = x?.rawData || x;
                  const hasSpecSc = !!(raw?.spec?.storageClassName || x?.storageClassName);
                  const modes = raw?.spec?.accessModes;
                  const hasSpecModes = Array.isArray(modes) && modes.length > 0;
                  // 缓存路径常带完整 PVC；直连 Longhorn 列表仅有摘要，须拉 PVC 详情才能预览存储类/访问模式
                  if (hasSpecSc && hasSpecModes) return x;
                  try {
                    const detail: any = await fetchHarvesterVolume(cloudId, x.namespace, x.pvcName);
                    const pvc = detail?.data || detail;
                    if (!pvc || typeof pvc !== 'object' || !pvc.metadata) return x;
                    const ann = pvc?.metadata?.annotations || {};
                    const aliasFromPvc = ann?.['tower.io/alias'];
                    return {
                      ...x,
                      alias: x.alias || aliasFromPvc || undefined,
                      rawData: pvc,
                    };
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
      case 'add_cdrom': {
        if (!images || images.length === 0) reloadImages();
        if (!scs || scs.length === 0) reloadScs();
        form.setFieldsValue({
          newCdromCreated: false,
          newCdromSize: 10,
          newCdromAccessMode: 'ReadWriteMany',
          newCdromImage: undefined,
          newCdromName: undefined,
          newCdromSc: undefined,
          newCdromBootFromCdrom: false,
        });
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

  /** 虚拟光驱（cdrom）在 Harvester 侧总线固定为 SATA；挂载后必须重启（或关机态下启动后再重启）方可靠生效。 */
  const CDROM_BUS: 'sata' = 'sata';

  /**
   * 变更需重启生效时弹出确认：用户可选择立即重启（调用云 API）或稍后手动重启。
   * 若 VM 已停止则通常仅 toast「下次启动生效」；`options.cdrom` 时改为弹窗强调光盘必须走重启链路。
   */
  const openRestartConfirm = (
    namespace: string,
    vmName: string,
    force: boolean = false,
    options?: { cdrom?: boolean },
  ) => {
    const activeVm = latestVm || record;
    if (isVmStopped(activeVm)) {
      if (options?.cdrom) {
        Modal.info({
          title: '光盘配置已保存',
          content:
            '当前虚拟机已关机，规格已写入。添加/挂载光盘后必须重启才能生效：请先启动虚拟机，再执行一次重启（或关机再开），否则光驱可能不可用。',
          okText: '知道了',
        });
        return;
      }
      message.success('设置已保存，下次启动时将自动应用新配置');
      return;
    }

    Modal.confirm({
      title: options?.cdrom
        ? '光盘已挂入规格：必须重启虚拟机后生效，是否立即重启'
        : '规格变更已提交，需要重启实例生效，是否重启实例',
      okText: '立即重启',
      cancelText: '手动重启',
      onOk: async () => {
        try {
          await rebootCloudProviderEcs(cloudId, `${namespace}/${vmName}`, force);
          message.success('重启指令已下发');
        } catch (e: any) {
          message.error(translateKnownApiErrorMessage(String(e?.message || e || '重启失败')));
        }
      },
      onCancel: () => {},
    });
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

  /** 将已存在的 ISO PVC（卷名 / claimName 均为 `volName`）挂到 VM 模板为 SCSI cdrom（供挂载步骤复用）。 */
  const attachIsoPvcAsCdromToVm = async (volName: string, bootFromCdrom: boolean) => {
    const vmName = record?.metadata?.name;
    const namespace = record?.metadata?.namespace;
    if (!vmName || !namespace) throw new Error('无法解析虚拟机信息');

    const currentNetworks =
      activeRecord?.spec?.template?.spec?.networks || record?.spec?.template?.spec?.networks || [];
    const nadList = await ensureNadsLoaded();
    const missing = getMissingNadsFromNetworks(currentNetworks, String(namespace || 'default'), nadList);
    if (missing.length > 0) {
      throw new Error(`虚拟机网卡引用的 NAD 不存在：${missing.join(', ')}`);
    }

    const vmSpecSource = latestVm || record;
    const vmSpec = vmSpecSource?.spec || {};
    const tplSpec = vmSpec?.template?.spec || {};
    const domain = tplSpec?.domain || {};
    const devices = domain?.devices || {};
    const volumes = Array.isArray(tplSpec?.volumes) ? [...tplSpec.volumes] : [];
    const disks = Array.isArray(devices?.disks) ? [...devices.disks] : [];

    const nameTaken =
      volumes.some((v: any) => v?.name === volName) || disks.some((d: any) => d?.name === volName);
    if (nameTaken) {
      throw new Error(`名称 ${volName} 与现有卷/磁盘冲突`);
    }

    volumes.push({
      name: volName,
      persistentVolumeClaim: { claimName: volName },
    });
    disks.push({
      name: volName,
      cdrom: { bus: CDROM_BUS },
    });
    if (bootFromCdrom) {
      applyBootOrderCdromFirst(disks, volName);
    }

    await patchHarvesterVm(cloudId, namespace, vmName, {
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
    });

    try {
      const res: any = await fetchHarvesterVMAggregated(cloudId, namespace, vmName);
      const data = res?.data?.vm ? res.data : res;
      const updatedVm = data?.vm || data;
      if (updatedVm && data?.related) {
        updatedVm.related = data.related;
      }
      setLatestVm(updatedVm);
    } catch {
      /* ignore */
    }
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

  /** 表单提交：分支实现见 `vmReconfigureSubmit.ts` 的 `runVmReconfigureSubmit`。 */
  const handleSubmit = async () => {
    await runVmReconfigureSubmit({
      form,
      cloudId,
      record,
      latestVm,
      activeRecord,
      selectedKey,
      systemDisk,
      subnets,
      nads,
      images,
      gpuResources,
      usbResources,
      setLatestVm,
      ensureNadsLoaded,
      openRestartConfirm,
      maybePromptRestart,
      fetchAggregatedVm,
      onOk,
      onClose,
    });
  };

  // ============================================================================
  // Add Disk：创建 PVC 与挂载 VM 分步（含「选择光盘」ISO）；挂载走后端 removeVolume/addVolume 或 patch 逻辑。
  // ============================================================================
  /** 「添加磁盘」：按表单创建 PVC（ISO 与普通盘均为仅创建，挂载用底部【挂载磁盘】或第二次提交）。 */
  const handleCreateDisk = async () => {
    if (diskCreating || diskAttaching) return;
    setDiskCreating(true);
    try {
      const src = String(form.getFieldValue('newDiskSource') || 'create');
      if (src === 'existing') {
        message.warning('已选择已有磁盘时，请直接点击【挂载磁盘】');
        return;
      }

      if (src === 'iso') {
        await form.validateFields(['newDiskIsoImage', 'newDiskName', 'newDiskSize', 'newDiskSc', 'newDiskAccessMode']);
      } else {
        await form.validateFields(['newDiskName', 'newDiskSize', 'newDiskSc', 'newDiskAccessMode']);
      }

      const values = form.getFieldsValue();
      const vmName = record?.metadata?.name;
      const namespace = record?.metadata?.namespace;
      if (!vmName || !namespace) throw new Error('无法解析虚拟机信息');

      const volName = values.newDiskName;
      const accessMode = values.newDiskAccessMode || 'ReadWriteMany';

      if (src === 'iso') {
        const imgVal = String(values.newDiskIsoImage || '').trim();
        const hit = (images || []).find((x: any) => {
          const name = x?.metadata?.name || x?.name;
          const ns = x?.metadata?.namespace || x?.namespace;
          const v = ns && name ? `${ns}/${name}` : name;
          return v === imgVal;
        });
        if (!hit || resolveVmImageKind(hit) !== 'iso' || !isHarvesterVmImageReady(hit)) {
          message.error('请选择有效的 ISO 镜像');
          return;
        }
        const createRes: any = await createHarvesterVolume(cloudId, {
          namespace,
          name: volName,
          size: values.newDiskSize,
          storageClassName: values.newDiskSc,
          accessModes: [accessMode],
          volumeMode: 'Block',
          annotations: { 'harvesterhci.io/imageId': imgVal },
        });
        const actualName = harvesterCreatedPvcNameFromResponse(createRes, volName);
        form.setFieldsValue({ newDiskCreated: true, newDiskName: actualName });
        message.success('光盘卷已创建');
        return;
      }

      const createRes: any = await createHarvesterVolume(cloudId, {
          namespace,
          name: volName,
          size: values.newDiskSize,
          storageClassName: values.newDiskSc,
          accessModes: [accessMode],
          volumeMode: 'Block',
        });

      const actualName = harvesterCreatedPvcNameFromResponse(createRes, volName);
      form.setFieldsValue({ newDiskCreated: true, newDiskName: actualName });
      message.success('磁盘卷已创建');
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
      const diskSrc = String(form.getFieldValue('newDiskSource') || 'create');
      const values =
        diskSrc === 'iso'
          ? await form.validateFields(['newDiskName', 'newDiskCreated'])
          : await form.validateFields(['newDiskName', 'newDiskCreated', 'newDiskBus', 'newDiskMode']);
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

      if (diskSrc === 'iso') {
        if (mode === 'hotplug') {
          message.warning('选择光盘（ISO）仅支持「配置添加」挂载至规格模板；须重启生效，请切换添加方式后重试。');
          return;
        }

        try {
          await attachIsoPvcAsCdromToVm(volName, !!form.getFieldValue('newDiskBootFromCdrom'));
        } catch (e: any) {
          message.error(e?.message || '挂载失败');
          return;
        }

        message.success(
          form.getFieldValue('newDiskBootFromCdrom')
            ? '光盘已挂载并将启动顺序设为优先光驱；须重启后生效（光驱总线固定 SCSI）'
            : '光盘已挂载到虚拟机规格；须重启后生效（光驱总线固定 SCSI）',
        );
        setTimeout(() => {
          openRestartConfirm(namespace, vmName, false, { cdrom: true });
        }, 300);

        form.setFieldsValue({ newDiskCreated: false, newDiskIsoImage: undefined, newDiskBootFromCdrom: false });
        try {
          onOk?.(true);
        } catch {}
        onClose?.();
        return;
      }

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

        message.success('磁盘已在线热插拔成功（SCSI 总线）');
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
      message.success('磁盘挂载成功，设置已保存，需要重启后生效');
      setTimeout(() => {
        openRestartConfirm(namespace, vmName, false);
      }, 300);

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

  /** 添加光盘：创建带 ISO imageId 注解的 PVC（第二步用【挂载光盘】挂为 cdrom）。 */
  const handleCreateCdrom = async () => {
    if (cdromCreating || cdromAttaching) return;
    setCdromCreating(true);
    try {
      const values = await form.validateFields([
        'newCdromName',
        'newCdromSize',
        'newCdromSc',
        'newCdromImage',
        'newCdromAccessMode',
      ]);
      const vmName = record?.metadata?.name;
      const namespace = record?.metadata?.namespace;
      if (!vmName || !namespace) throw new Error('无法解析虚拟机信息');

      const imgVal = String(values.newCdromImage || '').trim();
      const hit = (images || []).find((x: any) => {
        const name = x?.metadata?.name || x?.name;
        const ns = x?.metadata?.namespace || x?.namespace;
        const v = ns && name ? `${ns}/${name}` : name;
        return v === imgVal;
      });
      if (!hit || resolveVmImageKind(hit) !== 'iso') {
        message.error('请选择有效的 ISO 镜像');
        return;
      }

      const volName = values.newCdromName;
      const accessMode = values.newCdromAccessMode || 'ReadWriteMany';

      const createRes: any = await createHarvesterVolume(cloudId, {
        namespace,
        name: volName,
        size: values.newCdromSize,
        storageClassName: values.newCdromSc,
        accessModes: [accessMode],
        volumeMode: 'Block',
        annotations: {
          'harvesterhci.io/imageId': imgVal,
        },
      });

      const actualName = harvesterCreatedPvcNameFromResponse(createRes, volName);
      form.setFieldsValue({ newCdromCreated: true, newCdromName: actualName });
      message.success('光盘卷已创建');
    } catch (e: any) {
      if (e?.errorFields) return;
      message.error(e?.message || '创建光盘卷失败');
    } finally {
      setCdromCreating(false);
    }
  };

  /** 将已创建的光盘 PVC 挂为虚拟光驱（cdrom，总线固定 SCSI）；须重启生效。 */
  const handleAttachCdrom = async () => {
    if (cdromCreating || cdromAttaching) return;
    setCdromAttaching(true);
    try {
      const values = await form.validateFields(['newCdromName', 'newCdromCreated']);
      const vmName = record?.metadata?.name;
      const namespace = record?.metadata?.namespace;
      if (!vmName || !namespace) throw new Error('无法解析虚拟机信息');

      const created = !!values.newCdromCreated;
      if (!created) {
        message.warning('请先创建光盘卷');
        return;
      }

      const volName = values.newCdromName;

      try {
        await attachIsoPvcAsCdromToVm(volName, !!form.getFieldValue('newCdromBootFromCdrom'));
      } catch (e: any) {
        message.error(e?.message || '挂载光盘失败');
        return;
      }

      message.success(
        form.getFieldValue('newCdromBootFromCdrom')
          ? '光盘已挂载并将启动顺序设为优先光驱；须重启后生效（光驱总线固定 SCSI）'
          : '光盘已挂载到虚拟机规格；须重启后生效（光驱总线固定 SCSI）',
      );
      setTimeout(() => {
        openRestartConfirm(namespace, vmName, false, { cdrom: true });
      }, 300);

      form.setFieldsValue({ newCdromCreated: false, newCdromBootFromCdrom: false });
      try {
        onOk?.(true);
      } catch {}
      onClose?.();
    } catch (e: any) {
      if (e?.errorFields) return;
      message.error(e?.message || '挂载光盘失败');
    } finally {
      setCdromAttaching(false);
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
   * 解绑指定云硬盘（块设备）：提交前校验 VM 网卡引用的 NAD 仍存在，再调用 detach API 并刷新聚合 VM。
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

      const disks = activeRecord?.spec?.template?.spec?.domain?.devices?.disks ||
        record?.spec?.template?.spec?.domain?.devices?.disks ||
        [];
      const diskEntry = (Array.isArray(disks) ? disks : []).find(
        (d: any) => String(d?.name || '') === String(diskName || ''),
      );
      const diskBus = String(diskEntry?.disk?.bus || diskEntry?.cdrom?.bus || '')
        .toLowerCase()
        .trim();

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

      // SCSI 总线走在线 detach，一般无需重启；其它总线仍提示重启使规格生效
      if (diskBus === 'scsi') {
        message.success('解绑成功，该卷已从虚拟机移除');
      } else {
        message.success('解绑成功，设置已保存，需要重启虚拟机后生效');
        setTimeout(() => {
          openRestartConfirm(namespace, vmName, false);
        }, 300);
      }

      // 通知上层刷新（VM + volumes）
      try { onOk?.(true); } catch {}
    } catch (e: any) {
      // 提取友好的错误消息
      const errorMessage = e?.message || e?.response?.data?.message || '解绑失败';
      message.error(errorMessage);
      throw e;
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
    expandDiskCandidates,
    loadExpandDiskSize,
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
    cdromCreating,
    cdromAttaching,
    handleCreateCdrom,
    handleAttachCdrom,
    availableDiskPvcs,
    // detach disk actions
    diskDetaching,
    handleDetachDisk,
    refreshVm,
  };
};
