/**
 * @file VmSection.tsx
 * @type [页面组件]
 * @description Harvester 虚拟机列表主视图
 *
 * 职责说明：
 * - 展示 Harvester 集群中的虚拟机列表（仅业务 Namespace，自动过滤系统 Namespace）
 * - 提供搜索 / 命名空间 / 节点 / 状态等多种组合筛选能力
 * - 汇总展示计算、存储、网络、操作系统等关键信息（通过 SafeRead 统一兼容不同数据结构）
 * - 支持单机操作：查看详情、资源变配、WebVNC、热迁移 / 取消迁移、电源控制、删除等
 * - 支持批量操作：批量停止、批量重启、批量删除（可选同步删除关联 PVC）
 * - 内联展示磁盘扩容状态，并提供“扩容指南”弹窗，指导用户在 Guest OS 内完成文件系统扩容
 *
 * 集成说明：
 * - 该组件只关注前端展示与交互，通过 Props 将实际 API 调用 / 状态刷新委托给上层页面
 * - 使用 utils/harvesterUtils 中的 isSystemNamespace、cnVmStatus 等工具函数
 */

import React, { useMemo, useState, useCallback } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

import { Table, Select, Button, Dropdown, Modal, Input, Badge, message, Checkbox, Tag, Tabs, Tooltip, Alert } from 'antd';
import { EllipsisOutlined, ReloadOutlined, ExclamationCircleOutlined, WarningOutlined, InfoCircleOutlined, DesktopOutlined } from '@ant-design/icons';
import PageDetailSection from '../../../../components/PageDetailSection';
import ResourceActionsDropdown from '../../../../components/ResourceActionsDropdown';
import { detachHarvesterVolumeFromVm, fetchHarvesterVncUrl, stopHarvesterVm, startHarvesterVm, deleteHarvesterPVC, abortHarvesterMigration, saveHarvesterVmAsTemplate, fetchHarvesterNodes, fetchHarvesterNads } from '../../../../services/harvesterApi';
import TableColumnSettings from '../../../../components/TableColumnSettings';
import HarvesterResourceDrawer from '../components/HarvesterResourceDrawer';
import HarvesterMigrateModal from '../modals/HarvesterMigrateModal';
import VmBackupCreateModal from '../modals/VmBackupCreateModal';
import { isSystemNamespace, cnVmStatus } from '../../../../utils/harvesterUtils';

/**
 * [类型定义] Props 接口定义
 * @property vms - 虚拟机列表数据
 * @property loading - 加载状态
 * @property namespacesOptions - 命名空间选项列表
 * @property nodesOptions - 节点选项列表
 * @property cloudId - 云平台 ID
 * @property nsValue - 当前选中的命名空间筛选值
 * @property nodeValue - 当前选中的节点筛选值
 * @property onNsChange - 命名空间筛选变化回调
 * @property onNodeChange - 节点筛选变化回调
 * @property onRefresh - 刷新列表回调
 * @property onOpenReconfigure - 打开变配窗口回调
 * @property onStart - 启动虚拟机回调
 * @property onStop - 停止虚拟机回调
 * @property onReboot - 重启虚拟机回调
 * @property onSoftReboot - 软重启虚拟机回调
 * @property onPause - 暂停虚拟机回调
 * @property onUnpause - 恢复虚拟机回调
 * @property onDelete - 删除虚拟机回调
 * @property images - 镜像列表 (用于解析镜像名称)
 * @property namespaces - 命名空间列表 (用于解析租户/组织信息)
 * @property volumes - 存储卷列表 (用于状态检查和容量显示)
 */
type Props = {
  vms: any[];
  loading: boolean;
  namespacesOptions: string[];
  nodesOptions: string[];
  cloudId: string;
  nsValue?: string;
  nodeValue?: string;
  onNsChange: (v?: string) => void;
  onNodeChange: (v?: string) => void;
  onRefresh: (force?: boolean) => void;
  // onOpenDetail 已移除
  onOpenReconfigure: (vm: any) => void;
  onStart: (iid: string) => void;
  onStop: (iid: string) => void;
  onReboot: (iid: string) => void;
  onSoftReboot?: (iid: string) => void;
  onPause?: (iid: string) => void;
  onUnpause?: (iid: string) => void;
  onDelete: (iid: string, deleteVolumes?: boolean) => void;
  images?: any[];
  namespaces?: any[];
  volumes?: any[]; // 从父组件传入，用于状态检查
  bordered?: boolean;
  showOpsDetail?: boolean;
};

/**
 * [组件定义] VmSection 虚拟机列表组件
 * 用于展示和管理 Harvester 虚拟机列表
 */
const VmSection: React.FC<Props> = ({ vms, loading, namespacesOptions, nodesOptions, cloudId, nsValue, nodeValue, onNsChange, onNodeChange, onRefresh, onOpenReconfigure, onStart, onStop, onReboot, onSoftReboot, onPause, onUnpause, onDelete, images = [], namespaces = [], volumes = [], bordered = true, showOpsDetail = true }) => {
  const navigate = useNavigate();
  const location = useLocation();
  
  // ==========================================
  // [状态管理] 1. 本地状态 (Local State)
  // ==========================================
  
  // 搜索与筛选状态
  const [keyword, setKeyword] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<string>('');
  
  // 表格状态
  const [selectedKeys, setSelectedKeys] = useState<React.Key[]>([]);
  const [tableColumns, setTableColumns] = useState<any[]>([]);
  
  // 详情抽屉 (Metadata Modal) 状态
  const [metadataModalVisible, setMetadataModalVisible] = useState(false);
  const [metadataOpsMode, setMetadataOpsMode] = useState(false);
  const [currentMetadata, setCurrentMetadata] = useState<any>(null);
  const [metadataActiveTab, setMetadataActiveTab] = useState('detail');

  // 扩容指南弹窗状态
  const [resizeGuideVisible, setResizeGuideVisible] = useState(false);

  // 迁移弹窗状态
  const [migrateModalVisible, setMigrateModalVisible] = useState(false);
  const [currentMigrateVm, setCurrentMigrateVm] = useState<any>(null);

  const [savingTemplate, setSavingTemplate] = useState(false);

  // 备份/快照弹窗状态
  const [vmBackupModalVisible, setVmBackupModalVisible] = useState(false);
  const [vmBackupModalType, setVmBackupModalType] = useState<'backup' | 'snapshot'>('backup');
  const [vmBackupModalVm, setVmBackupModalVm] = useState<any>(null);



  // ==========================================
  // [辅助函数] 3. 内部工具函数 (Helpers)
  // ==========================================

  // [函数] 获取实例唯一标识 (Namespace/Name)
  const getIid = (r: any): string => {
    if (r?.metadata?.name && r?.metadata?.namespace) {
      return `${r.metadata.namespace}/${r.metadata.name}`;
    }
    return String(r?.InstanceId || r?.id || '');
  };

  /**
   * [函数] 解析存储大小字符串
   * 辅助函数：解析存储大小字符串为 GiB 数值
   * 支持纯数字(Bytes)以及带有单位(Ki, Mi, Gi, Ti)的字符串
   */
  const parseStorageSize = (sizeStr: string): number => {
    if (!sizeStr) return 0;
    const str = String(sizeStr).trim();

    // 纯数字 => 视为字节 (Bytes)
    if (/^\d+$/.test(str)) {
      const bytes = parseFloat(str);
      return bytes / (1024 ** 3); // 转换为 GiB
    }

    // 支持二进制单位 (Ki, Mi, Gi, Ti) 和十进制单位 (k, K, KB, MB, GB, TB)
    const units: Record<string, number> = {
      ki: 1024, mi: 1024 ** 2, gi: 1024 ** 3, ti: 1024 ** 4,
      k: 1000, kb: 1000, m: 1000 ** 2, mb: 1000 ** 2, g: 1000 ** 3, gb: 1000 ** 3, t: 1000 ** 4, tb: 1000 ** 4,
    };

    const match = str.match(/^([\d.]+)\s*([a-zA-Z]+)$/);
    if (!match) return parseFloat(str) || 0;

    const val = parseFloat(match[1]);
    const unit = match[2].toLowerCase();
    const mul = units[unit];
    if (!mul) return val; // 默认为 GiB
    return (val * mul) / (1024 ** 3); // 转换为 GiB
  };

  /**
   * [函数] 格式化存储大小
   * 辅助函数：格式化存储大小为可读字符串
   * 自动选择合适的单位 (MiB, GiB, TiB)
   */
  const formatStorageSize = (sizeGiB: number): string => {
    if (sizeGiB === 0) return '-';
    if (sizeGiB < 1) return `${Math.round(sizeGiB * 1024)} MiB`;
    if (sizeGiB >= 1024) return `${(sizeGiB / 1024).toFixed(1)} TiB`;
    return `${parseFloat(sizeGiB.toFixed(1))} GiB`;
  };

  /**
   * [核心对象] 安全读取帮助对象 (SafeRead)
   * 用于处理 Harvester 资源对象结构的复杂性和不确定性
   * 包含一系列读取器方法，支持从不同字段路径 (Annotation, Status, Spec) 获取数据
   */
  const SafeRead = useMemo(() => ({
    // ==========================================
    // [字段组] 3.1 基本标识 (Identity)
    // ==========================================
    
    // [字段] 获取显示名称：优先使用别名 (Annotation)，其次使用 Name
    name: (r: any) => r?.metadata?.annotations?.['tower.io/alias'] || r?.InstanceName || r?.name || r?.metadata?.name || '', 
    
    // [字段] 获取真实资源 ID
    vmId: (r: any) => r?.metadata?.name || '', 
    
    // [字段] 获取 UID
    uid: (r: any) => r?.metadata?.uid || r?.InstanceId || r?.id || '',
    
    // [字段] 获取命名空间
    namespace: (r: any) => r?.metadata?.namespace || r?.namespace || '',
    
    // [字段] 获取租户信息 (优先从 Namespace Annotation 获取)
    tenant: (r: any) => {
      // 优先从 Namespace Annotations 获取 (tower.io/tenant)
      const nsName = r?.metadata?.namespace || r?.namespace || '';
      const nsObj = namespaces.find((n: any) => n?.metadata?.name === nsName);
      if (nsObj?.metadata?.annotations?.['tower.io/tenant']) {
        return nsObj.metadata.annotations['tower.io/tenant'];
      }
      return '';
    },
    
    // [字段] 获取组织信息 (优先从 Namespace Annotation 获取)
    organization: (r: any) => {
      // 优先从 Namespace Annotations 获取 (tower.io/organization)
      const nsName = r?.metadata?.namespace || r?.namespace || '';
      const nsObj = namespaces.find((n: any) => n?.metadata?.name === nsName);
      if (nsObj?.metadata?.annotations?.['tower.io/organization']) {
        return nsObj.metadata.annotations['tower.io/organization'];
      }
      return '';
    },
    
    // [字段] 获取创建时间
    creationTimestamp: (r: any) => r?.createdAt || r?.metadata?.creationTimestamp,

    // ==========================================
    // [字段组] 3.2 状态与生命周期 (Status & Lifecycle)
    // ==========================================
    
    // [字段] 获取状态字符串
    status: (r: any) => {
      if (typeof r?.status === 'string') return r.status;
      return r?.status?.printableStatus || r?.status?.phase || r?.Status || 'Unknown';
    },
    
    // [字段] 获取运行节点
    node: (r: any) => r?.nodeName || r?.vmi?.status?.nodeName || r?.status?.nodeName || '',
    
    // [字段] 运行策略
    runStrategy: (r: any) => r?.spec?.runStrategy || '',
    
    // [字段] 驱逐策略
    evictionStrategy: (r: any) => r?.spec?.evictionStrategy || r?.spec?.template?.spec?.evictionStrategy || '',

    // ==========================================
    // [字段组] 3.3 计算资源 (Compute)
    // ==========================================
    
    // [字段] 获取 CPU 核心数 (优先计算完整拓扑)
    cpu: (r: any) => {
      // 优先计算完整拓扑 (cores * sockets * threads)
      const cpu = r?.spec?.template?.spec?.domain?.cpu;
      if (cpu?.cores && cpu?.sockets && cpu?.threads) {
        return Number(cpu.cores) * Number(cpu.sockets) * Number(cpu.threads);
      }
      return r?.cpu || cpu?.cores || r?.vmi?.spec?.domain?.cpu?.cores;
    },
    
    // [字段] 获取 CPU 规格描述
    cpuSpec: (r: any) => {
      const cpu = r?.spec?.template?.spec?.domain?.cpu;
      if (cpu) return `${cpu.cores} Cores, ${cpu.sockets} Sockets, ${cpu.threads} Threads`;
      return '';
    },
    
    // [字段] 获取内存大小 (优先使用 limits)
    memory: (r: any) => {
      const lim = r?.spec?.template?.spec?.domain?.resources?.limits?.memory;
      if (lim) return lim;
      const guest = r?.spec?.template?.spec?.domain?.memory?.guest;
      if (guest) return guest;
      return r?.memoryGb || r?.vmi?.spec?.domain?.memory?.guest;
    },

    // [字段] 获取内存规格描述
    memSpec: (r: any) => {
        const req = r?.spec?.template?.spec?.domain?.resources?.requests;
        const lim = r?.spec?.template?.spec?.domain?.resources?.limits;
        return `Request: ${req?.memory || '-'} / Limit: ${lim?.memory || '-'}`;
    },

    // ==========================================
    // [字段组] 3.4 存储与镜像 (Storage & Image)
    // ==========================================
    
    // [字段] 获取镜像 ID (优先从 Annotation 获取)
    image: (r: any) => {
      // 1. 尝试从 spec.template annotations 获取 (VM 实时来源)
      const specImg = r?.spec?.template?.metadata?.annotations?.['harvesterhci.io/imageId'];
      if (specImg) return specImg;

      // 2. 尝试从 metadata annotations 获取
      const metaImg = r?.metadata?.annotations?.['harvesterhci.io/imageId'];
      if (metaImg) return metaImg;

      try {
        const annot = r?.metadata?.annotations?.['harvesterhci.io/volumeClaimTemplates'];
        if (annot) {
          const arr = JSON.parse(annot);
          for (const item of arr) {
            const img = item?.metadata?.annotations?.['harvesterhci.io/imageId'];
            if (img) return img;
          }
        }
      } catch (e) {}
      return '';
    },
    
    // [字段] 获取镜像显示名称 (关联 Images 列表查找)
    imageDisplayName: (r: any) => {
      const imgId = SafeRead.image(r);
      if (!imgId) return '';
      // 尝试在 images 属性中查找
      // imgId 通常是 'namespace/name' 或仅仅是 'name'
      // Harvester 镜像 ID 典型格式为 'namespace/name'
      const found = images.find((i: any) => {
         const id = i?.metadata?.name;
         const ns = i?.metadata?.namespace;
         const fullId = `${ns}/${id}`;
         return fullId === imgId || id === imgId || i.id === imgId;
      });
      if (found) {
        const labels = found.metadata?.labels || {};
        const ann = found.metadata?.annotations || {};
        const labelName = labels['harvesterhci.io/imageDisplayName'];
        if (labelName) return labelName;
        const imageName = ann['harvesterhci.io/image-name'];
        if (imageName) return imageName;
        const displayName = ann['field.cattle.io/displayName'];
        if (displayName) return displayName;
        if (found.spec?.displayName) return found.spec.displayName;
        if (found.displayName) return found.displayName;
      }
      return '';
    },
    
    // [字段] 获取镜像大小 (从 volumeClaimTemplates 解析)
    imageSize: (r: any) => {
      try {
        const annot = r?.metadata?.annotations?.['harvesterhci.io/volumeClaimTemplates'];
        if (annot) {
          const arr = JSON.parse(annot);
          for (const item of arr) {
            const img = item?.metadata?.annotations?.['harvesterhci.io/imageId'];
            if (img) {
                return item?.spec?.resources?.requests?.storage || '';
            }
          }
        }
      } catch (e) {}
      return '';
    },

    // [字段] 获取卷详情 (包含容量、状态、扩容信息)
    volumeDetails: (r: any) => {
        const vols = r?.spec?.template?.spec?.volumes || [];
        
        // 健壮的 Namespace 解析逻辑
        let vmNs = r?.metadata?.namespace || r?.namespace;
        if (!vmNs) {
            // 尝试从 ID 解析 (ns/name)
            const iid = r?.id || r?.metadata?.uid || '';
            if (iid && iid.includes('/')) {
                vmNs = iid.split('/')[0];
            }
        }
        
        const disks = r?.spec?.template?.spec?.domain?.devices?.disks || [];
        let bootVolumeName = '';
        let minOrder = Number.POSITIVE_INFINITY;
        for (const d of disks) {
          const order = typeof d?.bootOrder === 'number' ? d.bootOrder : Number.POSITIVE_INFINITY;
          if (order < minOrder) { minOrder = order; bootVolumeName = d?.name || ''; }
        }
        if (!bootVolumeName && disks.length > 0) bootVolumeName = disks[0]?.name || '';

        return vols.map((v: any) => {
             const claimName = v?.persistentVolumeClaim?.claimName;
             let capacity = '';
             let capacityBytes = 0; // 其实存储的是 GiB 数值
             let status = '';
             let isResizing = false;
             let isFsPending = false;
             let message = '';
             let phase = '';
             
             // 关联 PVC 列表查找详细状态
             if (claimName && volumes && volumes.length > 0) {
                 const pvc = volumes.find((p: any) => {
                    const pName = p?.metadata?.name || p?.name;
                    const pNs = p?.metadata?.namespace || p?.namespace;
                    if (pName === claimName && pNs === vmNs) return true;
                    const pId = p?.id;
                    if (pId && pId === `${vmNs}/${claimName}`) return true;
                    if (p?.name === claimName && p?.namespace === vmNs) return true;
                    return false;
                 });
                 
                 if (pvc) {
                     const actualPvc = pvc?.rawData || pvc;
                     const capStr = actualPvc?.status?.capacity?.storage || actualPvc?.spec?.resources?.requests?.storage || pvc?.size || '';
                     if (capStr) {
                         capacityBytes = parseStorageSize(capStr);
                         capacity = capStr; 
                     }
                     phase = actualPvc?.status?.phase || pvc?.state || 'Bound';
                     const conditions = actualPvc?.status?.conditions || [];
                     const fsPendingCond = conditions.find((c: any) => c.type === 'FileSystemResizePending' && c.status === 'True');
                     const resizingCond = conditions.find((c: any) => c.type === 'Resizing' && c.status === 'True');
                     if (fsPendingCond) {
                         status = 'FileSystemResizePending';
                         isFsPending = true;
                         message = fsPendingCond.message;
                     } else if (resizingCond) {
                         status = 'Resizing';
                         isResizing = true;
                         message = resizingCond.message;
                     } else {
                         status = phase;
                     }
                 }
             }
            const isCloudInit = v?.cloudInitNoCloud || v?.cloudInitConfigDrive;
            const kind = isCloudInit ? 'cloudinit' : (claimName ? (v?.name === bootVolumeName ? 'system' : 'data') : 'data');
            return { name: v.name, claimName, capacity, capacityBytes, status, phase, isResizing, isFsPending, message, kind };
        });
    },

    // ==========================================
    // [字段组] 3.5 网络 (Network)
    // ==========================================
    
    // [字段] 获取 IP 地址
    ip: (r: any) => {
      if (Array.isArray(r?.ips) && r.ips.length > 0) return r.ips.join(', ');
      try {
        const annot = r?.metadata?.annotations?.['network.harvesterhci.io/ips'];
        if (annot) {
          const arr = JSON.parse(annot);
          if (Array.isArray(arr) && arr.length > 0) return arr.join(', ');
        }
        if (r?.vmi?.status?.interfaces) {
          const ips = r.vmi.status.interfaces.flatMap((i:any) => i.ipAddress || i.ipAddresses || []).filter(Boolean);
          if (ips.length > 0) return ips.join(', ');
        }
      } catch (e) {}
      return '';
    },
    
    // [字段] 获取 MAC 地址
    macAddress: (r: any) => {
      if (Array.isArray(r?.macAddresses) && r.macAddresses.length > 0) return r.macAddresses.join(', ');
      try {
        if (r?.status?.interfaces && r.status.interfaces.length > 0) {
          const macs = r.status.interfaces.map((i:any) => i.mac).filter(Boolean);
          if (macs.length > 0) return macs.join(', ');
        }
        const annot = r?.metadata?.annotations?.['harvesterhci.io/mac-address'];
        if (annot) {
          const json = JSON.parse(annot);
          return Object.values(json).join(', ');
        }
      } catch (e) {}
      return '';
    },
    
    // [字段] 获取网络列表
    networks: (r: any) => {
      if (Array.isArray(r?.networks) && r.networks.length > 0 && typeof r.networks[0] === 'string') return r.networks;
      const nets = r?.spec?.template?.spec?.networks || r?.vmi?.spec?.networks || [];
      const list = nets.map((n: any) => `${n.name} (${n.multus?.networkName || 'default'})`);
      if (list.length > 0) return list;
      return [];
    },

    // [字段] 获取网卡列表
    interfaces: (r: any) => {
        const ifaces = r?.spec?.template?.spec?.domain?.devices?.interfaces || [];
        return ifaces.map((i: any) => `${i.name} (${i.model || '-'})`).join(', ');
    },

    // ==========================================
    // [字段组] 3.6 硬件设备 (Hardware Devices)
    // ==========================================

    // [字段] 获取 GPU 列表
    gpus: (r: any) => {
        const gpus = r?.spec?.template?.spec?.domain?.devices?.gpus || [];
        return gpus.map((g: any) => g.name).join(', ');
    },
    
    // [字段] 获取 USB 设备列表
    usb: (r: any) => {
        const hostDevices = r?.spec?.template?.spec?.domain?.devices?.hostDevices || [];
        const usb = hostDevices.filter((d: any) => {
            const n = String(d?.name || '').toLowerCase();
            const dn = String(d?.deviceName || '').toLowerCase();
            return n.startsWith('usb') || dn.includes('usb');
        });
        return usb.map((u: any) => u.name).join(', ');
    },

    // ==========================================
    // [字段组] 3.7 操作系统 (Guest OS)
    // ==========================================

    // [字段] 获取操作系统信息
    os: (r: any) => r?.vmi?.status?.guestOSInfo?.name || r?.vmi?.status?.guestOSInfo?.prettyName || '',
    kernel: (r: any) => r?.vmi?.status?.guestOSInfo?.kernelRelease || '',
    arch: (r: any) => r?.vmi?.status?.guestOSInfo?.architecture || r?.spec?.template?.spec?.architecture || '',
    hostname: (r: any) => r?.spec?.template?.spec?.hostname || '',
  }), [namespaces, volumes, images]);

  /**
   * [辅助函数] 检查卷扩容状态 (checkResizeStatus)
   * 辅助函数：检查卷扩容状态
   * 遍历 VM 关联的所有 PVC，检查是否存在 Resizing 或 FileSystemResizePending 状态
   * @returns {Object} 包含是否正在扩容、是否等待文件系统扩容、涉及的 PVC 名称及状态消息
   */
  const checkResizeStatus = useCallback((r: any) => {
    if (!volumes || volumes.length === 0) return { isResizing: false, isFsPending: false, pvcName: '', message: '' };
    
    const vmVolumes = r?.spec?.template?.spec?.volumes || [];
    
    // 健壮的 Namespace 解析逻辑 (与 SafeRead.volumeDetails 保持一致)
    let vmNs = r?.metadata?.namespace || r?.namespace;
    if (!vmNs) {
        const iid = r?.id || r?.metadata?.uid || '';
        if (iid && iid.includes('/')) {
            vmNs = iid.split('/')[0];
        }
    }
    
    for (const v of vmVolumes) {
        const claimName = v?.persistentVolumeClaim?.claimName;
        if (!claimName) continue;
        
        const pvc = volumes.find((p: any) => {
             // 策略 1: 标准 Metadata 匹配
             const pName = p?.metadata?.name || p?.name;
             const pNs = p?.metadata?.namespace || p?.namespace;
             if (pName === claimName && pNs === vmNs) return true;
             
             // 策略 2: ID 匹配
             const pId = p?.id;
             if (pId && pId === `${vmNs}/${claimName}`) return true;
             
             // 策略 3: 扁平结构
             if (p?.name === claimName && p?.namespace === vmNs) return true;
             
             return false;
        });
        if (!pvc) continue;
        
        const actualPvc = pvc?.rawData || pvc;
        const conditions = actualPvc?.status?.conditions || [];
        
        // 检查 FileSystemResizePending 状态 (后端扩容完成，等待操作系统扩容)
        const fsPendingCond = conditions.find((c: any) => c.type === 'FileSystemResizePending' && c.status === 'True');
        if (fsPendingCond) {
            return { 
                isResizing: false, 
                isFsPending: true, 
                pvcName: claimName,
                message: fsPendingCond.message 
            };
        }

        // 检查 Resizing 状态 (后端存储扩容进行中)
        const resizingCond = conditions.find((c: any) => c.type === 'Resizing' && c.status === 'True');
        if (resizingCond) {
            return { 
                isResizing: true, 
                isFsPending: false, 
                pvcName: claimName,
                message: resizingCond.message || '等待存储后端...' 
            };
        }
    }
    return { isResizing: false, isFsPending: false, pvcName: '', message: '' };
  }, [volumes]);

  // ==========================================
  // [逻辑处理] 4. 数据过滤与处理 (Data Processing)
  // ==========================================

  // [计算属性] 过滤后的虚拟机列表
  // 客户端过滤逻辑 (关键字、状态、命名空间、节点)
  const filtered = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    const st = statusFilter.trim().toLowerCase();
    
    return (vms || []).filter((r: any) => {
      const iid = getIid(r);
      const name = String(SafeRead.name(r)).toLowerCase();
      const ns = SafeRead.namespace(r) || (iid.includes('/') ? iid.split('/')[0] : '');
      const node = String(SafeRead.node(r));
      const sKey = String(SafeRead.status(r)).toLowerCase();
      
      // 强制过滤系统 Namespace (harvester-public, cattle-system 等)
      if (isSystemNamespace(ns)) return false;

      if (nsValue && ns !== nsValue) return false;
      if (nodeValue && node !== nodeValue) return false;
      if (kw && !(iid.toLowerCase().includes(kw) || name.includes(kw))) return false;
      if (st && sKey !== st) return false;
      return true;
    });
  }, [vms, nsValue, nodeValue, keyword, statusFilter, SafeRead]);

  const drawerRecord = useMemo(() => {
    if (!currentMetadata) return null;
    const currentId = getIid(currentMetadata);
    return vms.find((v) => getIid(v) === currentId) || currentMetadata;
  }, [vms, currentMetadata]);

  // ==========================================
  // [事件处理] 5. 单个操作事件 (Single Actions)
  // ==========================================

  // [事件] 显示资源详情抽屉
  const handleShowMetadata = useCallback(async (record: any, tab: string = 'detail', opsMode: boolean = false) => {
    setCurrentMetadata(record);
    setMetadataActiveTab(tab);
    setMetadataOpsMode(opsMode);
    setMetadataModalVisible(true);
  }, []);

  // [事件] 处理打开 WebVNC
  const handleWebVnc = useCallback(async (r: any) => {
    const iid = getIid(r);
    try {
      let ns = '', name = '';
      if (iid.includes('/')) {
          [ns, name] = iid.split('/');
      } else {
          ns = SafeRead.namespace(r);
          name = SafeRead.vmId(r);
      }
      
      if (ns && name) {
        const url = `/clouds/${cloudId}/harvester/vnc?cloudId=${encodeURIComponent(cloudId)}&namespace=${encodeURIComponent(ns)}&name=${encodeURIComponent(name)}`;
        // 在新标签页打开，而非弹窗
        window.open(url, '_blank');
        return;
      }
      
      const j = await fetchHarvesterVncUrl(cloudId, iid);
      const url = j?.data?.VncUrl || j?.data?.vncUrl || j?.data?.url;
      if (url) {
        // 在新标签页打开，而非弹窗
        window.open(url, '_blank');
        return;
      }
      message.warning('该实例暂不支持 VNC');
      return;
    } catch (e:any) {
      message.error(e?.message || '获取VNC地址失败');
      return;
    }
  }, [cloudId, SafeRead]);

  const handleSaveAsTemplate = useCallback(async (r: any) => {
    if (!cloudId) return;
    const ns = SafeRead.namespace(r);
    const vmName = SafeRead.vmId(r);
    if (!ns || !vmName) {
      message.error('无法解析实例命名空间或名称');
      return;
    }
    try {
      setSavingTemplate(true);
      await saveHarvesterVmAsTemplate(cloudId, ns, vmName, {});
      message.success('已根据当前实例配置创建模板');
    } catch (e: any) {
      message.error(e?.message || '保存为模板失败');
    } finally {
      setSavingTemplate(false);
    }
  }, [cloudId, SafeRead]);

  // [事件] 触发备份操作
  const handleBackup = useCallback((r: any) => {
    setVmBackupModalVm(r);
    setVmBackupModalType('backup');
    setVmBackupModalVisible(true);
  }, []);

  // [事件] 触发快照操作
  const handleSnapshot = useCallback((r: any) => {
    setVmBackupModalVm(r);
    setVmBackupModalType('snapshot');
    setVmBackupModalVisible(true);
  }, []);

  // [事件] 触发克隆操作 (跳转)
  const handleClone = useCallback((r: any) => {
    navigate(`/clouds/${cloudId}/instances/create`, { state: { fromVm: r, backgroundLocation: location } });
  }, [cloudId, location, navigate]);

  // [事件] 处理删除确认 (支持同步删除关联 PVC)
  const handleDeleteConfirm = useCallback((r: any) => {
    const iid = getIid(r);
    const status = String(SafeRead.status(r)).toLowerCase();
    const isRunning = status === 'running' || status === 'starting';
    const volumes = (r?.spec?.template?.spec?.volumes || []).filter((v: any) => v.persistentVolumeClaim);
    const volumeNames = volumes.map((v: any) => v.persistentVolumeClaim.claimName).join(', ');
    
    let deleteVolumes = false;
    Modal.confirm({
      title: '确认删除该实例？',
      icon: <ExclamationCircleOutlined />,
      width: 500,
      content: (
        <div style={{ marginTop: 16 }}>
          {isRunning && (
            <div style={{ marginBottom: 16, color: '#ff4d4f', background: '#fff1f0', padding: '8px 12px', border: '1px solid #ffccc7', borderRadius: 4 }}>
              <WarningOutlined style={{ marginRight: 8 }} />
              警告：实例正在运行中。删除操作将强制终止实例。建议先停止实例。
            </div>
          )}
          
          <p>确定要永久删除实例 <b>{SafeRead.name(r)}</b> 吗？此操作不可恢复。</p>
          
          {volumeNames && (
              <div style={{ marginBottom: 16, background: '#f5f5f5', padding: '8px 12px', borderRadius: 4 }}>
                <div style={{ fontWeight: 500, marginBottom: 4 }}>关联的数据卷 (PVC):</div>
                <div style={{ color: 'rgba(0,0,0,0.65)' }}>{volumeNames}</div>
              </div>
          )}

          <div style={{ marginTop: 16 }}>
              <Checkbox onChange={(e) => { deleteVolumes = e.target.checked; }}>同步删除关联卷 (PVC) <span style={{ color:'#999', fontSize:12 }}>(推荐)</span></Checkbox>
          </div>
        </div>
      ),
      okText: isRunning ? '强制删除' : '删除',
      okType: 'danger',
      onOk: () => onDelete(iid, deleteVolumes)
    });
  }, [onDelete, SafeRead]);

  // [事件] 处理弹出 CD-ROM (支持同步删除 PVC 以避免孤儿卷)
  const handleEjectCdrom = useCallback(async (r: any) => {
    const disks = r?.spec?.template?.spec?.domain?.devices?.disks || [];
    const cdrom = disks[0];
    if (!cdrom) return;
    
    const statusStr = String(SafeRead.status(r)).toLowerCase();
    const isRunning = !['stopped', 'shutoff', 'down', 'offline'].includes(statusStr);
    
    let deletePvc = true;
    
    Modal.confirm({
      title: isRunning ? '安全弹出 CD-ROM (需要重启)' : '弹出 CD-ROM',
      width: 500,
      content: (
        <div>
            <p>即将弹出设备: <b>{cdrom.name}</b></p>
            {isRunning && (
              <div style={{ marginBottom: 16, color: '#faad14', background: '#fffbe6', padding: '8px 12px', border: '1px solid #ffe58f', borderRadius: 4 }}>
                <InfoCircleOutlined style={{ marginRight: 8 }} />
                实例正在运行。系统将自动停止实例，弹出光驱，然后重新启动。
              </div>
            )}
            <div style={{ marginTop: 16 }}>
              <Checkbox defaultChecked={true} onChange={(e) => { deletePvc = e.target.checked; }}>
                  同步删除关联卷 (PVC) <span style={{ color:'#999', fontSize:12 }}>(推荐，避免残留孤儿卷)</span>
              </Checkbox>
            </div>
        </div>
      ),
      onOk: async () => {
        const hide = message.loading('正在执行弹出操作...', 0);
        try {
          const iidStr = getIid(r);
          let ns = '', name = '';
          if (iidStr.includes('/')) {
              [ns, name] = iidStr.split('/');
          } else {
              ns = SafeRead.namespace(r);
              name = SafeRead.vmId(r);
          }
          
          if (!ns || !name) throw new Error('无法解析实例信息');

          // 1. 如果正在运行，则停止 VM
          if (isRunning) {
              await stopHarvesterVm(cloudId, ns, name, true);
              await new Promise(resolve => setTimeout(resolve, 5000)); // 等待停止
          }

          // 2. 卸载卷
          await detachHarvesterVolumeFromVm(cloudId, iidStr, { name: cdrom.name });

          // 3. 如果需要，删除 PVC
          if (deletePvc) {
              const volumes = r?.spec?.template?.spec?.volumes || [];
              const vol = volumes.find((v: any) => v.name === cdrom.name);
              const pvcName = vol?.persistentVolumeClaim?.claimName;
              
              if (pvcName) {
                try {
                    await deleteHarvesterPVC(cloudId, ns, pvcName);
                } catch (e: any) {
                    console.warn('Delete PVC failed', e);
                    message.warning(`PVC删除失败: ${e.message}`);
                }
              }
          }

          // 4. 如果之前是运行状态，则启动 VM
          if (isRunning) {
              await new Promise(resolve => setTimeout(resolve, 2000));
              await startHarvesterVm(cloudId, ns, name);
          }

          message.success('已发送弹出指令');
          onRefresh();
        } catch(e:any) {
          message.error(`弹出失败: ${e.message}`);
        } finally {
          hide();
        }
      }
    });
  }, [cloudId, onRefresh, SafeRead]);

  // [事件] 处理迁移操作
  const handleMigrate = useCallback(async (r: any) => {
    // 0. 基础状态检查
    const statusStr = String(r?.status?.printableStatus || r?.status?.phase || '').toLowerCase();
    if (statusStr !== 'running') {
       message.warning('只有运行中的实例才能进行热迁移');
       return;
    }

    const spec = r?.spec?.template?.spec || {};
    const nodeSelector = spec?.nodeSelector || {};
    const affinity = spec?.affinity?.nodeAffinity?.requiredDuringSchedulingIgnoredDuringExecution || null;
    
    // 1. 检查是否绑定特定节点 (Hostname Pinned)
    // 如果 VM 通过 nodeSelector 或 Affinity 强制绑定到特定 Hostname，则无法迁移
    const hostnamePinned =
      !!nodeSelector?.['kubernetes.io/hostname'] ||
      (affinity &&
        Array.isArray(affinity.nodeSelectorTerms) &&
        affinity.nodeSelectorTerms.some((t: any) =>
          Array.isArray(t?.matchExpressions) &&
          t.matchExpressions.some((e: any) => String(e?.key) === 'kubernetes.io/hostname' && String(e?.operator).toLowerCase() === 'in' && Array.isArray(e?.values) && e.values.length === 1)
        ));
    if (hostnamePinned) {
      message.warning('当前实例绑定了特定节点，不支持热迁移');
      return;
    }

    // 2. 检查节点标签约束是否导致只有一个可用节点 (Single Label Node)
    // 如果 nodeSelector 导致集群中只有一个匹配节点，则无法迁移
    let singleLabelNode = false;
    const selectorKeys = Object.keys(nodeSelector || {});
    if (selectorKeys.length > 0) {
      try {
        const json = await fetchHarvesterNodes(cloudId, false);
        const items: any[] = Array.isArray(json?.data?.items) ? json.data.items : [];
        const matched = items.filter((n: any) => {
          const labels = n?.metadata?.labels || {};
          return selectorKeys.every((k) => String(labels[k] || '') === String(nodeSelector[k] || ''));
        });
        if (matched.length <= 1) singleLabelNode = true;
      } catch {}
    }
    if (singleLabelNode) {
      message.warning('当前实例的节点标签约束导致无可迁移的目标节点');
      return;
    }

    // 3. 检查网络接口限制 (Network Blocked)
    // SRIOV 或 Macvtap 类型的网络接口通常不支持热迁移
    let networkBlocked = false;
    const interfaces = spec?.domain?.devices?.interfaces || [];
    if (interfaces.some((i: any) => i?.sriov || i?.macvtap)) {
      networkBlocked = true;
    } else {
      const nets = Array.isArray(spec?.networks) ? spec.networks : [];
      const multusNames = nets.map((n: any) => n?.multus?.networkName).filter(Boolean);
      if (multusNames.length > 0) {
        try {
          const nadJson = await fetchHarvesterNads(cloudId, false);
          const nadItems: any[] = Array.isArray(nadJson?.data?.items) ? nadJson.data.items : Array.isArray(nadJson?.items) ? nadJson.items : [];
          const typeMap: Record<string, string> = {};
          nadItems.forEach((x: any) => {
            const name = x?.metadata?.name || x?.name;
            const ns = x?.metadata?.namespace || x?.namespace;
            let type = '';
            try {
              const cfg = JSON.parse(x?.spec?.config || '{}');
              type = String(cfg?.type || '').toLowerCase();
            } catch {}
            // 构建 key，支持全名和短名
            if (ns && name) {
              typeMap[`${ns}/${name}`] = type;
              // 如果 VM 在同一个 namespace，可能只用 name 引用
              if (ns === (r?.metadata?.namespace || r?.namespace)) {
                typeMap[name] = type;
              }
            } else if (name) {
              typeMap[name] = type;
            }
          });
          if (multusNames.some((k: string) => ['sriov', 'macvtap'].includes(String(typeMap[k] || '').toLowerCase()))) {
            networkBlocked = true;
          }
        } catch {}
      }
    }
    if (networkBlocked) {
      message.warning('当前实例使用了不支持热迁移的网络接口 (SR-IOV/Macvtap)');
      return;
    }
    setCurrentMigrateVm(r);
    setMigrateModalVisible(true);
  }, [cloudId]);

  // [事件] 处理取消迁移
  const handleAbortMigration = useCallback((r: any) => {
    Modal.confirm({
      title: '确认取消迁移？',
      icon: <ExclamationCircleOutlined />,
      content: `确定要取消虚拟机 ${SafeRead.name(r)} 的迁移任务吗？`,
      okText: '取消迁移',
      okType: 'danger',
      onOk: async () => {
        const hide = message.loading('正在取消迁移...', 0);
        try {
          const iid = getIid(r);
          await abortHarvesterMigration(cloudId, iid);
          message.success('已发送取消指令');
          onRefresh && onRefresh(true);
        } catch (e: any) {
          message.error(`取消失败: ${e.message}`);
        } finally {
          hide();
        }
      }
    });
  }, [cloudId, onRefresh, SafeRead]);

  // ==========================================
  // [事件处理] 6. 批量操作事件 (Batch Actions)
  // ==========================================

  // [事件] 批量停止
  const batchStop = async () => {
    if (selectedKeys.length === 0) return;
    try {
      const targets = (vms || []).filter((r:any)=> selectedKeys.includes(getIid(r)));
      const results = await Promise.all(targets.map(async (r: any)=> { 
          const iid = getIid(r);
          try { 
             let ns = '', name = '';
             if (iid.includes('/')) {
                 [ns, name] = iid.split('/');
             } else {
                 ns = SafeRead.namespace(r);
                 name = SafeRead.vmId(r);
             }
             if (ns && name) {
                await stopHarvesterVm(cloudId, ns, name, true);
             } else {
                await onStop(iid); 
             }
             return { ok:true, iid }; 
          } catch(e:any){ 
             return { ok:false, iid, err:e?.message||String(e) }; 
          } 
      }));
      const ok = results.filter(x=>x.ok).length; const fail = results.filter(x=>!x.ok);
      if (ok>0) message.success(`停止成功 ${ok} 台`);
      if (fail.length>0) message.error(`停止失败 ${fail.length} 台：${fail.map(f=>f.iid).join(', ')}`);
      setSelectedKeys([]);
    } catch(e:any){ message.error(e?.message||'批量停止失败'); }
  };

  // [事件] 批量重启
  const batchReboot = async () => {
    if (selectedKeys.length === 0) return;
    try {
      const targets = (vms || []).filter((r:any)=> selectedKeys.includes(getIid(r)));
      const results = await Promise.all(targets.map(async (r: any)=> { 
          const iid = getIid(r);
          try { 
             let ns = '', name = '';
             if (iid.includes('/')) {
                 [ns, name] = iid.split('/');
             } else {
                 ns = SafeRead.namespace(r);
                 name = SafeRead.vmId(r);
             }
             if (ns && name) {
                 // 目前使用 onReboot 回调 (通常调用 Harvester API)
                 await onReboot(iid);
             } else {
                 await onReboot(iid); 
             }
             return { ok:true, iid }; 
          } catch(e:any){ 
             return { ok:false, iid, err:e?.message||String(e) }; 
          } 
      }));
      const ok = results.filter(x=>x.ok).length; const fail = results.filter(x=>!x.ok);
      if (ok>0) message.success(`重启成功 ${ok} 台`);
      if (fail.length>0) message.error(`重启失败 ${fail.length} 台：${fail.map(f=>f.iid).join(', ')}`);
      setSelectedKeys([]);
    } catch(e:any){ message.error(e?.message||'批量重启失败'); }
  };

  // [事件] 批量删除 (支持勾选同步删除 PVC)
  const batchDelete = () => {
    if (selectedKeys.length === 0) return;
    
    // 创建局部变量以在 Modal 闭包中捕获 Checkbox 状态
    let batchDeleteVolumes = false;

    Modal.confirm({
      title: '确认批量删除所选实例？',
      width: 500,
      content: (
        <div>
          <p>即将删除 {selectedKeys.length} 台虚拟机。此操作不可恢复。</p>
          <div style={{ marginTop: 16, borderTop: '1px solid #eee', paddingTop: 16 }}>
             <Checkbox onChange={(e) => { batchDeleteVolumes = e.target.checked; }}>
               同步删除关联卷 (PVC)
             </Checkbox>
             <div style={{ color: '#999', fontSize: 12, marginLeft: 24, marginTop: 4 }}>
               注意：将删除所有关联的 DataVolume 和 PVC，数据无法找回。
             </div>
          </div>
        </div>
      ),
      okText: '批量删除',
      okType: 'danger',
      cancelText: '取消',
      onOk: async () => {
        try {
          const targets = (vms || []).filter((r:any)=> selectedKeys.includes(getIid(r)));
          const results = await Promise.all(targets.map(async (r: any)=> { 
            const iid = getIid(r);
            try { 
              // 使用新的删除逻辑 (支持 PVC 删除)，或回退到通用删除
              // 目前 onDelete (来自 props) 处理通用删除，但我们需要确保它支持 PVC 删除
              // Harvester CloudDetail 中的 'onDelete' 签名是: (id, deleteVolumes?)
              await onDelete(iid, batchDeleteVolumes); 
              return { ok:true, iid }; 
            } catch(e:any){ 
              return { ok:false, iid, err:e?.message||String(e) }; 
            } 
          }));
          
          const ok = results.filter(x=>x.ok).length; 
          const fail = results.filter(x=>!x.ok);
          
          if (ok>0) message.success(`删除指令已发送: ${ok} 台`);
          if (fail.length>0) {
            console.error('Batch delete errors:', fail);
            message.error(`删除失败 ${fail.length} 台`);
          }
          
          setSelectedKeys([]);
          if (onRefresh) onRefresh(true);
          
        } catch(e:any){ 
          message.error(e?.message||'批量删除失败'); 
        }
      }
    });
  };

  // ==========================================
  // [配置] 7. 表格列定义与配置 (Table Configuration)
  // ==========================================

  // [UI配置] 表格列定义 (Columns)
  const allColumns = useMemo(() => [
        { title: '实例名称', key: 'name',  fixed: 'left' as any, ellipsis: true, render: (_: any, r: any) => {
      const text = SafeRead.name(r) || '-';
      return (
        <span className="cell-link" onClick={() => handleShowMetadata(r, 'detail')}>
          <DesktopOutlined style={{ marginRight: 8 }} />
          {text}
        </span>
      );
    } },
    { title: '实例ID', key: 'vmId', ellipsis: true, render: (_: any, r: any) => {
      const id = SafeRead.vmId(r);
      return id ? <Tooltip title={id}>{id}</Tooltip> : '-';
    } },
    { title: '状态', key: 'status', fixed: 'left' as any, render: (_: any, r: any) => {
      const s = String(SafeRead.status(r));
      const k = s.toLowerCase();
      // [逻辑] 状态颜色映射
      const status = (function(){
        if (k==='running') return 'success';
        if (k==='starting') return 'processing';
        if (k==='migrating') return 'processing';
        if (k==='stopping') return 'warning';
        if (k==='terminating') return 'warning';
        if (k==='error' || k==='errorunschedulable') return 'error';
        return 'default';
      })();
      
      const { isFsPending, isResizing } = checkResizeStatus(r);
      
      return (
        <div>
          <Badge status={status as any} text={
            <span>
              {cnVmStatus(s)}
              {isResizing && <span style={{ color: '#1890ff', marginLeft: 4 }}>[系统盘扩容中]</span>}
              {isFsPending && (
                <>
                  <span style={{ color: '#faad14', marginLeft: 4 }}>[系统盘待扩容]</span>
                  <Button 
                      type="link" 
                      size="small" 
                      className="cell-link"
                      style={{ padding: 0, height: 'auto', fontSize: 12, marginLeft: 6 }}
                      onClick={(e) => { e.stopPropagation(); setResizeGuideVisible(true); }}
                  >
                      扩容指南
                  </Button>
                </>
              )}
            </span>
          } />
        </div>
      );
    } },
    { title: '命名空间', key: 'namespace', ellipsis: true, render: (_: any, r: any) => SafeRead.namespace(r) || '-' },
    { title: '租户', key: 'tenant', ellipsis: true, render: (_: any, r: any) => SafeRead.tenant(r) || '-' },
    { title: '组织', key: 'organization', ellipsis: true, render: (_: any, r: any) => SafeRead.organization(r) },
    { title: '节点', key: 'node',  ellipsis: true, render: (_: any, r: any) => {
      const node = String(SafeRead.node(r)).trim();
      return node ? <Tag color="blue">{node}</Tag> : '-';
    } },
    { title: 'CPU', key: 'cpu',  render: (_: any, r: any) => {
      const v = SafeRead.cpu(r);
      return v ? `${v} C` : '-';
    } },
    { title: '内存', key: 'memory',  render: (_: any, r: any) => SafeRead.memory(r) || '-' },
    { title: '说明', key: 'memSpec', width: 200, ellipsis: true, render: (_: any, r: any) => SafeRead.memSpec(r) },
    { title: '镜像', key: 'image', width: 220, ellipsis: true, render: (_: any, r: any) => {
        const displayName = SafeRead.imageDisplayName(r);
        const img = SafeRead.image(r);
        const size = SafeRead.imageSize(r);
        
        if (!displayName && !img) return '-';

        const content = (
          <div>
            {displayName && <div>{displayName}</div>}
            <div>
              {img && <span className="std-time">{img}</span>}
              {size && <span style={{ marginLeft: 6 }} className="std-badge std-badge-default">{size}</span>}
            </div>
          </div>
        );
        return <Tooltip title={content}><div style={{ maxWidth: 210, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{displayName || img}</div></Tooltip>;
      } },
     { title: '操作系统', key: 'os',  ellipsis: true, render: (_: any, r: any) => SafeRead.os(r) || '-' },
    { title: 'IP地址', key: 'ip',  ellipsis: true, render: (_: any, r: any) => {
       const ip = SafeRead.ip(r);
       return ip ? <Tooltip title={ip}><div style={{ maxWidth: 210, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{ip}</div></Tooltip> : '-';
    } },
    { title: 'MAC地址', key: 'mac',  ellipsis: true, render: (_: any, r: any) => {
       const mac = SafeRead.macAddress(r);
       return mac ? <Tooltip title={mac}>{mac}</Tooltip> : '-';
    } },
    { title: '存储卷', key: 'volumes', width: 340, ellipsis: false, render: (_: any, r: any) => {
       const details = SafeRead.volumeDetails(r);
       if (!details || details.length === 0) return '-';

       const content = (
         <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
           {details.map((v: any, i: number) => (
             v.kind !== 'cloudinit' ? (
               <Tooltip title={v.claimName || v.name} key={i}>
                 <span className={`std-badge ${v.kind === 'data' ? 'std-badge-success' : 'std-badge-info'}`}>
                   {[v.kind === 'system' ? '系统卷' : (v.kind === 'data' ? '数据卷' : ''), formatStorageSize(v.capacityBytes), v.phase, v.isResizing ? 'Resizing' : (v.isFsPending ? 'FileSystemResizePending' : '')]
                     .filter(Boolean).join(' | ')}
                 </span>
               </Tooltip>
             ) : null
           ))}
         </div>
       );
       return content;
    } },
    { title: '创建时间', key: 'created',  render: (_: any, r: any) => {
       const t = SafeRead.creationTimestamp(r);
       return t ? new Date(t).toLocaleString() : '-';
    } },
    { title: '操作', key: 'actions', width: 80, fixed: 'right' as const, render: (_: any, r: any) => {
      const iid = getIid(r);
      const statusStr = String(SafeRead.status(r)).toLowerCase();
      const isStopped = ['stopped', 'shutoff', 'down', 'offline'].includes(statusStr);
      const isRunning = statusStr === 'running';
      const isPaused = statusStr === 'paused';
      const { isResizing, pvcName } = checkResizeStatus(r);

      const items: any[] = [
        // 1. 资源详情 (加粗引导)
        { key: 'detail', label:'实例详情', onClick: () => handleShowMetadata(r, 'detail') },
        
      // 4. 资源运维信息
        ...(showOpsDetail ? [
            { key: 'detail_ops', label: '查看YAML', onClick: () => handleShowMetadata(r, 'detail', true) }
        ] : []),

        // 2. VNC (浏览器)
        { key: 'webvnc', label: '访问VNC', disabled: isStopped, onClick: () => handleWebVnc(r) },

        { type: 'divider' },
        
        // 3. 电源操作 - 根据状态动态显示
        // [状态] 已停止：仅显示启动
        ...(isStopped ? [{ 
          key: 'start', 
          label: '启动', 
          disabled: isResizing,
          tooltip: isResizing ? `无法启动: 关联磁盘 ${pvcName} 正在后端扩容中，请稍候...` : undefined,
          onClick: () => !isResizing && onStart(iid) 
        }] : []),

        // [状态] 非停止状态 (运行中、暂停中、中间状态)：显示停止
        ...(!isStopped ? [
           { key: 'stop', label: '停止', onClick: () => onStop(iid) },
        ] : []),

        // [状态] 运行中：额外显示重启(软)、暂停
        ...(isRunning ? [
           { key: 'softreboot', label: '重启', onClick: () => onSoftReboot && onSoftReboot(iid) },
           { key: 'pause', label: '暂停', onClick: () => onPause && onPause(iid) }
        ] : []),

        // [状态] 暂停中：额外显示恢复
        ...(isPaused ? [
           { key: 'unpause', label: '恢复', onClick: () => onUnpause && onUnpause(iid) }
        ] : []),

  
       
        // 5. 风险操作 (平铺显示)
        { type: 'divider' },
        
        // [状态] 非停止状态：强制停止
        ...(!isStopped ? [
           { key: 'force_stop', label: '强制停止', danger: true, onClick: () => onStop && onStop(`${iid}::force`) }
        ] : []),

        // [状态] 运行中：强制重启
        ...(isRunning ? [
           { key: 'reboot', label: '强制重启', danger: true, onClick: () => onReboot(iid) },
        ] : []),

        // 删除 - 始终显示
        { key: 'delete', label: '删除', danger: true, onClick: () => handleDeleteConfirm(r) },
      ];
      return <ResourceActionsDropdown items={items} buttonProps={{ className: 'row-actions-trigger' }} />;
    } },
  ], [handleShowMetadata, onStart, onStop, onReboot, onSoftReboot, onPause, onUnpause, SafeRead, checkResizeStatus, handleWebVnc, handleDeleteConfirm, showOpsDetail]);

  // ==========================================
  // [UI渲染] 8. 组件结构返回 (Render)
  // ==========================================

  // [UI] 主渲染逻辑
  return (
    <PageDetailSection
      asCard={false}
      // 左侧工具栏：搜索与筛选
      toolbarLeft={(
        <>
          {/* 关键字搜索框 */}
          <Input allowClear placeholder="关键字" className="toolbar-search" value={keyword} onChange={(e)=> setKeyword(e.target.value)} />
          {/* 命名空间筛选 */}
          <Select
            className="toolbar-filter"
            placeholder="命名空间"
            value={nsValue || undefined}
            onChange={(v)=> onNsChange(v || undefined)}
            allowClear
            options={namespacesOptions.map(ns=> ({ value: ns, label: ns }))}
          />
          {/* 节点筛选 */}
          <Select
            className="toolbar-filter-sm"
            placeholder="节点"
            value={nodeValue || undefined}
            onChange={(v)=> onNodeChange(v || undefined)}
            allowClear
            options={nodesOptions.map(n=> ({ value: n, label: n }))}
          />
          {/* 状态筛选 */}
          <Select
            className="toolbar-filter-sm"
            placeholder="云主机状态"
            value={statusFilter || undefined}
            onChange={(v)=> setStatusFilter(v || '')}
            allowClear
            options={[{ value: '', label: '全部' }, ...['Running','Starting','Migrating','Stopping','Terminating','Stopped','Terminated','Error','Unknown'].map(k=> ({ value: k.toLowerCase(), label: cnVmStatus(k) }))]}
          />
        </>
      )}
      // 右侧工具栏：操作按钮
      toolbarRight={(
        <>
          {/* 创建按钮 */}
          <Button type="primary" onClick={() => navigate(`/clouds/${cloudId}/instances/create`, { state: { backgroundLocation: location } })}>创建实例</Button>
          {/* 批量操作下拉菜单 */}
          <Dropdown
            menu={{
              items: [
                { key:'batchStop', label:'批量停止', disabled: selectedKeys.length===0 },
                { key:'batchReboot', label:'批量重启', disabled: selectedKeys.length===0 },
                { type: 'divider' },
                { key:'batchDelete', label:<span style={{ color:'#ff4d4f' }}>批量删除</span>, disabled: selectedKeys.length===0 },
              ],
              onClick: ({ key }) => { if (key==='batchStop') batchStop(); if (key==='batchReboot') batchReboot(); if (key==='batchDelete') batchDelete(); },
            }}
          >
            <Button icon={<EllipsisOutlined />}></Button>
          </Dropdown>
          {/* 表格列设置 */}
          <TableColumnSettings 
            columns={allColumns} 
            onChange={setTableColumns}
            settingsKey="harvester_vm_table_v3"
          />
          {/* 刷新按钮 */}
          <Button icon={<ReloadOutlined />} onClick={() => onRefresh && onRefresh(true)} />
        </>
      )}
    >
      {/* 虚拟机列表表格 */}
      <Table
        className="std-table"
        bordered={bordered}
        rowKey={(r:any)=> getIid(r)}
        rowSelection={{ selectedRowKeys: selectedKeys, onChange: (keys)=> setSelectedKeys(keys) }}
        columns={tableColumns}
        dataSource={filtered}
        loading={loading}
        scroll={{ x: 'max-content' }}
        pagination={{
          size: 'small',
          showQuickJumper: false,
        }}
      />
      
      {/* 资源详情抽屉 (Metadata) */}
      <HarvesterResourceDrawer
        open={metadataModalVisible}
        onClose={() => setMetadataModalVisible(false)}
        resourceType="VirtualMachine"
        forceOpsMode={metadataOpsMode}
        record={drawerRecord}
        activeTab={metadataActiveTab}
        onTabChange={setMetadataActiveTab}
        cloudId={cloudId}
        namespaces={namespaces}
        volumes={volumes}
        images={images}
        onRefresh={onRefresh}
        onOpenReconfigure={onOpenReconfigure}
        onBackup={handleBackup}
        onSnapshot={handleSnapshot}
        onClone={handleClone}
        onMigrate={handleMigrate}
        onDelete={handleDeleteConfirm}
      />
      
      {/* 备份/快照弹窗 */}
      <VmBackupCreateModal
        visible={vmBackupModalVisible}
        onCancel={() => setVmBackupModalVisible(false)}
        onSuccess={() => {
          setVmBackupModalVisible(false);
          if (onRefresh) onRefresh(true);
        }}
        cloudId={cloudId}
        namespaces={namespaces}
        vms={vms}
        initialType={vmBackupModalType}
        initialVm={vmBackupModalVm}
      />

      {/* 迁移弹窗 */}
      <HarvesterMigrateModal
        open={migrateModalVisible}
        onClose={() => setMigrateModalVisible(false)}
        onOk={() => {
            onRefresh && onRefresh(true);
        }}
        cloudId={cloudId}
        vm={currentMigrateVm}
        nodes={nodesOptions.map(n => ({ metadata: { name: n } }))}
      />

      {/* 扩容指南弹窗 */}
      <Modal
        title="文件系统扩容指南"
        open={resizeGuideVisible}
        onCancel={() => setResizeGuideVisible(false)}
        footer={[
           <Button key="close" onClick={() => setResizeGuideVisible(false)}>关闭</Button>
        ]}
        width={650}
      >
        <div style={{ lineHeight: 1.6 }}>
           <Alert
             type="warning"
             showIcon
             message="磁盘空间已分配，但操作系统尚未识别"
             description="Harvester/Longhorn 已完成底层块设备的扩容，但虚拟机内部的文件系统需要手动执行命令来占用新增的空间。"
             style={{ marginBottom: 16 }}
           />
           
           <Tabs defaultActiveKey="linux" items={[
             {
               key: 'linux',
               label: 'Linux',
               children: (
                 <div>
                   <p>请登录到虚拟机（通过 SSH 或 VNC），执行以下步骤：</p>
                   <div style={{ background: '#f5f5f5', padding: '12px 16px', borderRadius: 8, fontFamily: 'monospace', marginBottom: 16, fontSize: 13 }}>
                     <div style={{ color: '#999', marginBottom: 4 }}># 1. 查看磁盘和分区 (确认扩容盘如 vda)</div>
                     <div style={{ color: '#000', marginBottom: 8 }}>lsblk</div>
                     
                     <div style={{ color: '#999', marginBottom: 4 }}># 2. 扩展分区表 (如果使用分区如 vda1)</div>
                     <div style={{ color: '#000', marginBottom: 8 }}>sudo growpart /dev/vda 1</div>
                     
                     <div style={{ color: '#999', marginBottom: 4 }}># 3. 扩展文件系统 (ext4)</div>
                     <div style={{ color: '#000', marginBottom: 8 }}>sudo resize2fs /dev/vda1</div>
                     
                     <div style={{ color: '#999', marginBottom: 4 }}># 4. 扩展文件系统 (xfs)</div>
                     <div style={{ color: '#000' }}>sudo xfs_growfs -d /</div>
                   </div>
                   <p style={{ fontSize: 12, color: '#666' }}>
                     注：若直接使用裸盘(无分区)，可跳过步骤2。请根据实际设备名调整命令。
                   </p>
                 </div>
               )
             },
             {
               key: 'windows',
               label: 'Windows',
               children: (
                 <div>
                   <p>请通过远程桌面 (RDP) 或 VNC 登录 Windows：</p>
                   <ol>
                     <li>右键点击 <b>开始菜单</b>，选择 <b>磁盘管理 (Disk Management)</b>。</li>
                     <li>找到需要扩容的磁盘，右键点击其主分区。</li>
                     <li>选择 <b>扩展卷 (Extend Volume)</b>。</li>
                     <li>按照向导点击“下一步”直到完成。</li>
                   </ol>
                 </div>
               )
             }
           ]} />
        </div>
      </Modal>
    </PageDetailSection>
  );
};

export default VmSection;
