/**
 * @file useVmReconfigure.ts
 * @description Harvester 虚拟机变配弹窗（VmReconfigureModal）的状态与提交逻辑 Hook。
 *
 * 拆分说明（STRUCTURE：Harvester `ecs` 域内 `lib/` 放纯函数，提交体单独文件）：
 * - `lib/`：`vmReconfigureQuantity`、`vmReconfigureNetwork`、`vmReconfigureCloudInit` 等
 * - `menu/`：按左侧 Menu `selectedKey` 拆分「切换菜单项表单初始化」与 GPU/CPU 高级菜单项的二次同步
 * - `vmReconfigureSubmit.ts`：`runVmReconfigureSubmit`（按 `selectedKey` 的表单提交分支）
 * - `useVmReconfigureVmDiskActions.ts`：添加/挂载磁盘与光盘、解绑、VM 聚合刷新与重启确认
 */
import { useState, useEffect, useMemo } from 'react';
import { Form, message } from 'antd';
import {
  fetchHarvesterGpuResources,
  fetchHarvesterUsbResources,
  fetchHarvesterNads,
  fetchKubeOvnVpcs,
  fetchKubeOvnSubnets,
  fetchHarvesterImages,
  fetchHarvesterStorageClasses,
  fetchHarvesterVolume,
  fetchHarvesterVmDetail,
  fetchHarvesterVMAggregated,
  fetchHarvesterNodes,
} from '../../../../../../../services/harvesterApi';
import { runVmReconfigureSubmit } from './vmReconfigureSubmit';
import { storageQuantityToGiB } from './lib/vmReconfigureQuantity';
import { buildExpandDiskCandidates, type ExpandDiskCandidate } from './lib/vmReconfigureDiskCandidates';
import { getVmReconfigureCurrentSpec } from './lib/vmReconfigureCurrentSpec';
import { initVmReconfigureMenuFields } from './menu/initVmReconfigureMenuFields';
import { useVmReconfigureCpuAdvancedMenuSync } from './menu/useVmReconfigureCpuAdvancedMenuSync';
import { useVmReconfigureGpuMenuSync } from './menu/useVmReconfigureGpuMenuSync';
import { useVmReconfigureVmDiskActions } from './useVmReconfigureVmDiskActions';

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
  // 添加磁盘：可选择「已有磁盘」(PVC) 进行挂载
  const [availableDiskPvcs, setAvailableDiskPvcs] = useState<any[]>([]);

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

  /** 拉取集群 NetworkAttachmentDefinition 列表并写入 `nads`（带 force：触发后端库存与集群同步）。 */
  const reloadNads = async () => {
    try {
      const res = await fetchHarvesterNads(cloudId, true);
      const items = res?.data?.items || res?.items || [];
      setNads(items);
      return items;
    } catch (e) { console.error(e); return []; }
  };

  /** 提交前校验 multus 引用时始终重新拉取 NAD，避免库存未同步导致误报「NAD 不存在」。 */
  const ensureNadsLoaded = async () => {
    return await reloadNads();
  };

  const {
    diskCreating,
    diskAttaching,
    cdromCreating,
    cdromAttaching,
    diskDetaching,
    openRestartConfirm,
    fetchAggregatedVm,
    maybePromptRestart,
    handleCreateDisk,
    handleAttachDisk,
    handleCreateCdrom,
    handleAttachCdrom,
    refreshVm,
    handleDetachDisk,
  } = useVmReconfigureVmDiskActions({
    cloudId,
    record,
    latestVm,
    setLatestVm,
    activeRecord,
    form,
    images,
    ensureNadsLoaded,
    onOk,
    onClose,
  });

  /** 拉取 Kube-OVN VPC 列表（force：与集群同步后再读库存，避免新建 VPC 后下拉/提交仍陈旧）。 */
  const reloadVpcs = async () => {
    try { 
      const res = await fetchKubeOvnVpcs(cloudId, true); 
      const items = res?.data?.items || res?.items || [];
      setVpcs(items); 
      return items;
    } catch (e) { console.error(e); return []; }
  };
  /** 拉取 Kube-OVN Subnet 列表（force：新建扁平/VPC 子网后立即变配网卡时列表需对齐集群）。 */
  const reloadSubnets = async () => {
    try { 
      const res = await fetchKubeOvnSubnets(cloudId, true); 
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

  // 切换左侧 Menu 后重置表单并按 key 初始化（逻辑在 menu/init*）
  useEffect(() => {
    if (!open) return;

    form.resetFields();
    setSelectedGpuKeys([]);
    setSelectedUsbKeys([]);

    if (!record) return;

    initVmReconfigureMenuFields(selectedKey, {
      form,
      record,
      latestVm,
      activeRecord,
      cloudId,
      open,
      systemDisk,
      images,
      scs,
      gpuResources,
      usbResources,
      nodes,
      getCurrentSpec,
      getMemoryInGi,
      setSystemDiskSize,
      setAvailableDiskPvcs,
      loadExpandDiskSize,
      reloadScs,
      reloadImages,
      reloadGpuResources,
      reloadUsbResources,
      reloadNodes,
      reloadNads,
      reloadVpcs,
      reloadSubnets,
      setSelectedUsbKeys,
    });
    // 仅随菜单/VM/弹窗切换初始化表单；补全 reload* / 资源列表等依赖会导致重复 reset 与多余请求
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional: menu-switch init only
  }, [selectedKey, open, record, latestVm, form]);

  useVmReconfigureCpuAdvancedMenuSync({ open, selectedKey, activeRecord, form });

  useVmReconfigureGpuMenuSync({
    open,
    selectedKey,
    activeRecord,
    gpuResources,
    form,
    setSelectedGpuKeys,
  });

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
