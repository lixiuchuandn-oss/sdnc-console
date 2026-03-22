/**
 * ==============================================================================
 * 模块名称: Harvester 虚拟机列表视图 (VmSection)
 * 文件路径: src/pages/Clouds/Harvester/sections/VmSection.tsx
 * ==============================================================================
 * 
 * [功能描述]
 * 该组件是 Harvester 云平台详情页的核心部分，负责展示和管理虚拟机列表。
 * 它不仅仅是一个简单的表格，还集成了大量的运维操作入口和状态监控逻辑。
 * 
 * [核心逻辑]
 * 1. [数据标准化 (SafeRead)]: 
 *    - Harvester (基于 KubeVirt) 的资源对象结构非常深且复杂 (如 spec.template.spec...)。
 *    - 为了防止 "undefined" 报错并兼容不同版本的 API 结构，我们使用 SafeRead 对象统一封装所有字段的读取逻辑。
 * 
 * 2. [多维过滤]: 
 *    - 自动过滤系统级命名空间 (如 harvester-public)，只展示用户业务虚拟机。
 *    - 支持按关键字、状态、节点等多维度组合筛选。
 * 
 * 3. [复杂状态计算]:
 *    - 虚拟机的状态不仅仅是 "Running"，还包含 "Migrating", "Stopping" 等中间态。
 *    - 需要额外检查关联 PVC 的扩容状态 (Resizing/FileSystemResizePending) 并提示用户。
 * 
 * 4. [运维操作]:
 *    - 集成了 20+ 种操作，包括电源管理、快照备份、热迁移、磁盘扩容指南等。
 *    - 实现了复杂的批量操作逻辑 (批量停止/重启/删除)。
 * 
 * ------------------------------------------------------------------------------
 * [交互/依赖说明]
 * ------------------------------------------------------------------------------
 * 1. 上游数据:
 *    - 依赖父组件传入 `vms` (虚拟机列表), `volumes` (存储卷), `nodesOptions` 等原始数据。
 *    - 本组件不直接发起列表查询 API，而是通过 Props 接收数据，专注展示和交互。
 * 
 * 2. 关键服务:
 *    - harvesterApi.ts: 提供 start/stop/delete 等底层 API 调用。
 *    - harvesterUtils.ts: 提供状态文案转换等工具函数。
 * ==============================================================================
 */

import React, { useMemo, useState, useCallback, useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

import { Table, Select, Button, Dropdown, Modal, Input, Badge, App, Checkbox, Tag, Tabs, Tooltip, Alert, Cascader } from 'antd';
import { EllipsisOutlined, ReloadOutlined, ExclamationCircleOutlined, WarningOutlined, InfoCircleOutlined, SearchOutlined, SafetyCertificateFilled, CopyOutlined } from '@ant-design/icons';
import PageDetailSection from '../../../../components/PageDetailSection';
import ResourceActionsDropdown from '../../../../components/ResourceActionsDropdown';
import { detachHarvesterVolumeFromVm, fetchHarvesterVncUrl, stopHarvesterVm, startHarvesterVm, deleteHarvesterPVC, abortHarvesterMigration, fetchHarvesterNodes, fetchHarvesterNads, patchHarvesterVm } from '../../../../services/harvesterApi';
import { useTableColumnSettings } from '../../../../hooks/useTableColumnSettings';
import TableColumnSettingsButton from '../../../../components/TableColumnSettingsButton';
import HarvesterResourceDrawer from '../components/HarvesterOpsinfoDrawer';
import HarvesterVmDetailDrawer from '../components/HarvesterVmDetailDrawer';
import HarvesterMigrateModal from '../modals/HarvesterMigrateModal';
import VmBackupCreateModal from '../modals/VmBackupCreateModal';
import VmCloneModal from '../modals/VmCloneModal';
import VmSaveAsTemplateModal from '../modals/VmSaveAsTemplateModal';
import { isPublicNamespace, cnVmStatus, VM_STATUS_MAP, getVmCloneTaskStatus } from '../../../../utils/harvesterUtils';
import { OsIcon } from '../../../../components/OsIcon';
import { useAuth } from '../../../../contexts/AuthContext';
import { hasPermissionForAction } from '../../../../utils/accessMapping';

/**
 * [类型定义] 组件 Props 接口
 * 定义了父组件传递给 VmSection 的所有属性。
 * 
 * @property vms - [数据源] 虚拟机对象数组，包含所有 VM 的原始 JSON 数据
 * @property loading - [UI状态] 表格是否处于加载中状态
 * @property namespacesOptions - [筛选] 可用的命名空间列表
 * @property nodesOptions - [筛选] 可用的节点名称列表
 * @property cloudId - [上下文] 当前云平台的 ID
 * @property nsValue - [受控状态] 当前选中的命名空间（用于受控组件模式）
 * @property nodeValue - [受控状态] 当前选中的节点
 * @property onRefresh - [回调] 请求父组件刷新数据列表
 * @property volumes - [关联数据] 存储卷列表，用于判断磁盘扩容状态
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
  volumes?: any[]; 
  isTenant?: boolean;
  mode?: 'standard' | 'simple';
  bordered?: boolean; // New prop to control table border explicitly
  disableColumnSettings?: boolean; // 禁用列设置组件，避免在某些场景下导致死锁
  /** 若提供，则点击「创建」时调用而不跳转全量向导（如 Cloudmap 简易模式） */
  onCreateVmOverride?: () => void;
  /** 创建按钮文案，默认「创建实例」 */
  createVmButtonText?: string;
};

/**
 * [组件定义] VmSection
 * Harvester 虚拟机列表展示与管理组件
 */
const VmSection: React.FC<Props> = ({ vms, loading, namespacesOptions, nodesOptions, cloudId, nsValue, nodeValue, onNsChange, onNodeChange, onRefresh, onOpenReconfigure, onStart, onStop, onReboot, onSoftReboot, onPause, onUnpause, onDelete, images = [], namespaces = [], volumes = [], isTenant = false, mode = 'standard', bordered = true, disableColumnSettings = false, onCreateVmOverride, createVmButtonText }) => {
  // 使用 Ant Design 的 App 上下文获取 modal 和 message 实例
  const { modal, message } = App.useApp();
  // 路由跳转：用于跳转到“创建实例”等页面
  const navigate = useNavigate();
  // 当前路由位置：用于在跳转时携带 backgroundLocation，支持返回/抽屉等交互
  const location = useLocation();
  // 当前登录用户：包含 permissions 等信息
  const { user } = useAuth();
  // 创建虚拟机权限：需要 clouds.ecs:write 或 clouds:write（包含 ecs:write 的继承）
  const hasVmCreatePermission = useMemo(() => {
    const perms = (user?.permissions ?? []) as string[];
    return hasPermissionForAction(perms, 'clouds.ecs:write') || hasPermissionForAction(perms, 'clouds:write');
  }, [user?.permissions]);
  
  // ==========================================
  // [状态管理] 1. 本地 UI 状态 (Local State)
  // ==========================================
  
  // [搜索/筛选] 本地关键字和状态筛选
  const [keyword, setKeyword] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [showSystemResources, setShowSystemResources] = useState<boolean>(false);
  
  // [表格交互] 选中行和列配置
  const [selectedKeys, setSelectedKeys] = useState<React.Key[]>([]);
  
  // [弹窗控制] 详情抽屉状态
  const [metadataModalVisible, setMetadataModalVisible] = useState(false);
  const [metadataOpsMode, setMetadataOpsMode] = useState(false); // 是否开启 YAML/运维模式
  const [currentMetadata, setCurrentMetadata] = useState<any>(null); // 当前查看的 VM 对象
  const [metadataActiveTab, setMetadataActiveTab] = useState('detail');

  // [弹窗控制] 扩容指南
  const [resizeGuideVisible, setResizeGuideVisible] = useState(false);

  // [弹窗控制] 热迁移
  const [migrateModalVisible, setMigrateModalVisible] = useState(false);
  const [currentMigrateVm, setCurrentMigrateVm] = useState<any>(null);

  const [saveTemplateModalOpen, setSaveTemplateModalOpen] = useState(false);
  const [saveTemplateVm, setSaveTemplateVm] = useState<any>(null);


  // [弹窗控制] 备份与快照
  const [vmBackupModalVisible, setVmBackupModalVisible] = useState(false);
  const [vmBackupModalType, setVmBackupModalType] = useState<'backup' | 'snapshot'>('backup');
  const [vmBackupModalVm, setVmBackupModalVm] = useState<any>(null);

  // [弹窗控制] 克隆虚拟机
  const [cloneModalVisible, setCloneModalVisible] = useState(false);
  const [cloneSourceVm, setCloneSourceVm] = useState<any>(null);

  // [筛选] 租户/组织
  const [tenantOrgPath, setTenantOrgPath] = useState<string[]>([]);

  // ==========================================
  // [辅助函数] 2. 基础工具 (Basic Helpers)
  // ==========================================

  /**
   * [函数] 获取实例唯一标识
   * 优先构建 "namespace/name" 格式的唯一 ID，如果缺失则回退到 id 字段。
   */
  const getIid = (r: any): string => {
    if (r?.metadata?.name && r?.metadata?.namespace) {
      return `${r.metadata.namespace}/${r.metadata.name}`;
    }
    return String(r?.InstanceId || r?.id || '');
  };

  /**
   * [函数] 解析存储大小字符串
   * 将 "10Gi", "500Mi", "1024" 等不同格式的存储字符串统一转换为 GiB 数值。
   */
  const parseStorageSize = (sizeStr: string): number => {
    if (!sizeStr) return 0;
    const str = String(sizeStr).trim();

    // 纯数字 => 视为字节 (Bytes)
    if (/^\d+$/.test(str)) {
      const bytes = parseFloat(str);
      return bytes / (1024 ** 3); // 转换为 GiB
    }

    // 支持二进制单位 (Ki, Mi, Gi, Ti) 和十进制单位 (k, KB, ...)
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
   * 将 GiB 数值格式化为人类可读的字符串 (MiB, GiB, TiB)。
   */
  const formatStorageSize = (sizeGiB: number): string => {
    if (sizeGiB === 0) return '-';
    if (sizeGiB < 1) return `${Math.round(sizeGiB * 1024)} MiB`;
    if (sizeGiB >= 1024) return `${(sizeGiB / 1024).toFixed(1)} TiB`;
    return `${parseFloat(sizeGiB.toFixed(1))} GiB`;
  };

  // ==========================================
  // [核心逻辑] 3. 数据读取器 (SafeRead)
  // ==========================================
  /**
   * [逻辑说明] SafeRead 对象
   * 这是一个核心的数据访问层。由于 Kubernetes/Harvester 对象的嵌套层级极深（例如 r.spec.template.spec.domain.cpu.cores），
   * 直接访问极易出现 "Cannot read property of undefined" 错误。
   * SafeRead 封装了所有的空值检查和 Fallback 逻辑，确保 UI 渲染层始终能拿到有效数据。
   * 使用 useMemo 缓存该对象，仅当依赖数据变化时才重建。
   */
  const SafeRead = useMemo(() => ({
    // ------------------------------------------
    // 3.1 基础标识 (Identity)
    // ------------------------------------------
    
    // [字段] 显示名称：优先使用 alias 注解（用户自定义别名），其次是 metadata.name
    name: (r: any) => r?.metadata?.annotations?.['tower.io/alias'] || r?.InstanceName || r?.name || r?.metadata?.name || '', 
    
    // [字段] 真实资源 ID (Kubernetes Name)
    vmId: (r: any) => r?.metadata?.name || '', 
    
    // [字段] 全局唯一 ID (UID)
    uid: (r: any) => r?.metadata?.uid || r?.InstanceId || r?.id || '',
    
    // [字段] 命名空间
    namespace: (r: any) => r?.metadata?.namespace || r?.namespace || '',
    
    // [字段] 租户信息 (从 Namespace 的 Annotation 中解析)
    tenant: (r: any) => {
      const nsName = r?.metadata?.namespace || r?.namespace || '';
      const nsObj = namespaces.find((n: any) => n?.metadata?.name === nsName);
      if (nsObj?.metadata?.annotations?.['tower.io/tenant']) {
        return nsObj.metadata.annotations['tower.io/tenant'];
      }
      return '';
    },
    
    // [字段] 组织信息
    organization: (r: any) => {
      const nsName = r?.metadata?.namespace || r?.namespace || '';
      const nsObj = namespaces.find((n: any) => n?.metadata?.name === nsName);
      if (nsObj?.metadata?.annotations?.['tower.io/organization']) {
        return nsObj.metadata.annotations['tower.io/organization'];
      }
      return '';
    },
    
    // [字段] 创建时间
    creationTimestamp: (r: any) => r?.createdAt || r?.metadata?.creationTimestamp,

    // ------------------------------------------
    // 3.2 状态与生命周期 (Status & Lifecycle)
    // ------------------------------------------
    
    // [字段] 状态字符串 (Running, Stopped 等)
    status: (r: any) => {
      // [优先级1] 检查 VMI 的迁移状态（迁移状态优先级最高）
      // 迁移状态存储在 VMI 的 metadata.annotations['harvesterhci.io/migrationState'] 中
      // 也可能在 status.migrationState 中（不同版本可能不同）
      // 注意：如果 migrationState.Completed === true，说明迁移已完成，不应该返回 'Migrating'
      const vmi = r?.vmi || r?.vmiRaw;
      const migrationState = vmi?.status?.migrationState;
      const migrationAnnotation = vmi?.metadata?.annotations?.['harvesterhci.io/migrationState'];
      
      // 检查是否真的在迁移中（排除已完成的迁移）
      if (migrationState) {
        // 如果 migrationState.completed 或 migrationState.Completed 为 true，说明迁移已完成，不应该显示为迁移中
        // 注意：JSON 中的字段名是小写的 "completed"，但代码中可能有大写的情况
        const isCompleted = migrationState.completed === true || migrationState.Completed === true;
        if (!isCompleted) {
          return 'Migrating';
        }
      } else if (migrationAnnotation) {
        // 如果只有注解但没有 migrationState，也认为在迁移中
        // 但需要排除已完成的状态（Harvester 会在完成后删除注解，但可能有延迟）
        return 'Migrating';
      }
      
      // [优先级2] 检查 VM 的状态字段
      if (typeof r?.status === 'string') return r.status;
      // Harvester 的状态字段可能在 printableStatus, phase 或 Status 中
      return r?.status?.printableStatus || r?.status?.phase || r?.Status || 'Unknown';
    },
    
    // [字段] 运行节点
    node: (r: any) => r?.nodeName || r?.vmi?.status?.nodeName || r?.status?.nodeName || '',
    
    // [字段] 运行策略 (Always, RerunOnFailure 等)
    runStrategy: (r: any) => r?.spec?.runStrategy || '',
    
    // [字段] 驱逐策略
    evictionStrategy: (r: any) => r?.spec?.evictionStrategy || r?.spec?.template?.spec?.evictionStrategy || '',

    // ------------------------------------------
    // 3.3 计算资源 (Compute)
    // ------------------------------------------
    
    // [字段] CPU 核心数
    // 逻辑：Harvester CPU = Sockets * Cores * Threads
    // [统一] 与详情视图保持一致的计算顺序和回退逻辑
    cpu: (r: any) => {
      const cpu = r?.spec?.template?.spec?.domain?.cpu;
      
      // 优先：使用完整的拓扑信息计算（sockets * cores * threads）
      if (cpu?.sockets !== undefined && cpu?.cores !== undefined && cpu?.threads !== undefined) {
        return Number(cpu.sockets) * Number(cpu.cores) * Number(cpu.threads);
      }
      
      // 如果只有部分拓扑信息，尝试计算
      if (cpu?.sockets !== undefined && cpu?.cores !== undefined) {
        return Number(cpu.sockets) * Number(cpu.cores) * (cpu?.threads || 1);
      }
      if (cpu?.sockets !== undefined && cpu?.threads !== undefined) {
        return Number(cpu.sockets) * (cpu?.cores || 1) * Number(cpu.threads);
      }
      if (cpu?.cores !== undefined && cpu?.threads !== undefined) {
        return (cpu?.sockets || 1) * Number(cpu.cores) * Number(cpu.threads);
      }
      
      // 回退：使用后端计算的Extra.CPU（如果可用）
      if (r?.cpu !== undefined && r?.cpu !== null) {
        return Number(r.cpu);
      }
      
      // 最后回退：使用cores或VMI的cores
      return cpu?.cores || cpu?.sockets || r?.vmi?.spec?.domain?.cpu?.cores || 0;
    },
    
    // [字段] CPU 拓扑描述
    cpuSpec: (r: any) => {
      const cpu = r?.spec?.template?.spec?.domain?.cpu;
      if (cpu) return `${cpu.cores} Cores, ${cpu.sockets} Sockets, ${cpu.threads} Threads`;
      return '';
    },
    
    // [字段] 内存大小
    // [统一] 与详情视图保持一致：优先展示 Guest Memory（规格），这是用户在 VM 配置中显式设置的值
    // 优先级：guest > limits > memoryGb > vmi guest
    memory: (r: any) => {
      // [展示口径] 优先展示 Guest Memory（规格），这是用户在 VM 配置中显式设置的值
      const guest = r?.spec?.template?.spec?.domain?.memory?.guest;
      if (guest) return guest;
      
      const lim = r?.spec?.template?.spec?.domain?.resources?.limits?.memory;
      if (lim) return lim;
      
      return r?.memoryGb || r?.vmi?.spec?.domain?.memory?.guest || '';
    },

    // [字段] 内存规格描述 (Request / Limit)
    memSpec: (r: any) => {
        const req = r?.spec?.template?.spec?.domain?.resources?.requests;
        const lim = r?.spec?.template?.spec?.domain?.resources?.limits;
        return `Request: ${req?.memory || '-'} / Limit: ${lim?.memory || '-'}`;
    },

    // [字段] 是否开启热扩容
    // [Harvester 兼容] 复刻 Harvester 逻辑：通过 Annotation harvesterhci.io/enableCPUAndMemoryHotplug 判断
    // 同时需要排除 RestartRequired 和 HotPlugInProgress 状态
    isHotPlugEnabled: (r: any) => {
      // [Harvester 兼容] 使用 Annotation 判断，而不是 maxSockets
      const annotations = r?.metadata?.annotations || {};
      const isConfigured = annotations['harvesterhci.io/enableCPUAndMemoryHotplug']?.toLowerCase() === 'true';
      
      if (!isConfigured) return false;
      
      // 检查状态条件：如果存在 RestartRequired 或 HotPlugInProgress，视为未启用
      const conditions = r?.status?.conditions || [];
      const isRestartRequired = conditions.some((c: any) => c.type === 'RestartRequired' && c.status === 'True');
      const isHotPlugInProgress = conditions.some((c: any) => 
        (c.type === 'HotVCPUChange' || c.type === 'HotMemoryChange') && c.status === 'True'
      );
      
      // 如果存在 RestartRequired 或 HotPlugInProgress，返回 false
      if (isRestartRequired || isHotPlugInProgress) return false;
      
      return true;
    },

    // ------------------------------------------
    // 3.4 存储与镜像 (Storage & Image)
    // ------------------------------------------
    
    // [字段] 基础镜像 ID
    // 逻辑：尝试从多个 Annotation 位置查找关联的 Image ID
    image: (r: any) => {
      // 1. 优先：spec.template annotations (最准确，代表当前配置)
      const specImg = r?.spec?.template?.metadata?.annotations?.['harvesterhci.io/imageId'];
      if (specImg) return specImg;

      // 2. 次选：metadata annotations
      const metaImg = r?.metadata?.annotations?.['harvesterhci.io/imageId'];
      if (metaImg) return metaImg;

      // 3. 兜底：从 volumeClaimTemplates 中解析
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
    
    // [字段] 镜像显示名称
    // 逻辑：拿到 Image ID 后，去 images 列表里查找对应的 displayName
    imageDisplayName: (r: any) => {
      const imgId = SafeRead.image(r);
      if (!imgId) return '';
      
      const found = images.find((i: any) => {
         const id = i?.metadata?.name;
         const ns = i?.metadata?.namespace;
         const fullId = `${ns}/${id}`;
         return fullId === imgId || id === imgId || i.id === imgId;
      });
      if (found) {
        const labels = found.metadata?.labels || {};
        const ann = found.metadata?.annotations || {};
        // 尝试多个字段获取名称
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
    
    // [字段] 镜像大小 (从 volumeClaimTemplates 获取)
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

    // [字段] 卷详情 (Volume Details)
    // 逻辑：合并 VM 的 Volumes 定义和系统中 PVC 的实时状态
    volumeDetails: (r: any) => {
        const vols = r?.spec?.template?.spec?.volumes || [];
        
        // 解析 VM 所在的 Namespace
        let vmNs = r?.metadata?.namespace || r?.namespace;
        if (!vmNs) {
            const iid = r?.id || r?.metadata?.uid || '';
            if (iid && iid.includes('/')) {
                vmNs = iid.split('/')[0];
            }
        }
        
        // 确定启动盘 (Boot Volume)
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
             let capacityBytes = 0;
             let status = '';
             let isResizing = false;
             let isFsPending = false;
             let message = '';
             let phase = '';
             
             // 在全局 volumes 列表中查找对应的 PVC
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
                     
                     // 检查扩容相关的 Conditions
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
            // 区分系统盘、数据盘、CloudInit盘
            const kind = isCloudInit ? 'cloudinit' : (claimName ? (v?.name === bootVolumeName ? 'system' : 'data') : 'data');
            return { name: v.name, claimName, capacity, capacityBytes, status, phase, isResizing, isFsPending, message, kind };
        });
    },

    // ------------------------------------------
    // 3.5 网络 (Network)
    // ------------------------------------------
    
    // [字段] IP 地址
    ip: (r: any) => {
      if (Array.isArray(r?.ips) && r.ips.length > 0) return r.ips.join(', ');
      try {
        // 尝试从 Annotation 获取 (Harvester Agent 上报)
        const annot = r?.metadata?.annotations?.['network.harvesterhci.io/ips'];
        if (annot) {
          const arr = JSON.parse(annot);
          if (Array.isArray(arr) && arr.length > 0) return arr.join(', ');
        }
        // 尝试从 status.interfaces 获取 (KubeVirt 状态)
        if (r?.vmi?.status?.interfaces) {
          const ips = r.vmi.status.interfaces.flatMap((i:any) => i.ipAddress || i.ipAddresses || []).filter(Boolean);
          if (ips.length > 0) return ips.join(', ');
        }
      } catch (e) {}
      return '';
    },
    
    // [字段] MAC 地址
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
    
    // [字段] 网络名称列表
    networks: (r: any) => {
      if (Array.isArray(r?.networks) && r.networks.length > 0 && typeof r.networks[0] === 'string') return r.networks;
      const nets = r?.spec?.template?.spec?.networks || r?.vmi?.spec?.networks || [];
      const list = nets.map((n: any) => `${n.name} (${n.multus?.networkName || 'default'})`);
      if (list.length > 0) return list;
      return [];
    },

    // [字段] 网卡接口列表
    interfaces: (r: any) => {
        const ifaces = r?.spec?.template?.spec?.domain?.devices?.interfaces || [];
        return ifaces.map((i: any) => `${i.name} (${i.model || '-'})`).join(', ');
    },

    // ------------------------------------------
    // 3.6 硬件设备 (Hardware)
    // ------------------------------------------

    // [字段] GPU 列表
    gpus: (r: any) => {
        const short = (s: any) => {
          const v = String(s || '').trim();
          if (!v) return '';
          const parts = v.split('/');
          return parts[parts.length - 1] || v;
        };
        let alloc: any = null;
        try {
          const raw = r?.metadata?.annotations?.['harvesterhci.io/deviceAllocationDetails'];
          if (raw) alloc = typeof raw === 'string' ? JSON.parse(raw) : raw;
        } catch { }
        const hostAlloc = (alloc && alloc.hostdevices) ? alloc.hostdevices : {};
        const devices = r?.spec?.template?.spec?.domain?.devices || {};
        const hostDevices = Array.isArray(devices?.hostDevices) ? devices.hostDevices : [];
        const gpus = Array.isArray(devices?.gpus) ? devices.gpus : [];
        const isUsb = (x: any) => {
          const dn = String(x?.deviceName || '').toLowerCase();
          const n = String(x?.name || '').toLowerCase();
          return dn.includes('usb') || n.startsWith('usb');
        };
        const list: string[] = [];
        hostDevices.filter((d: any) => !isUsb(d)).forEach((d: any) => {
          const rn = String(d?.deviceName || '').trim();
          const localName = String(d?.name || '').trim();
          const mapped = Array.isArray(hostAlloc?.[rn]) ? hostAlloc[rn] : [];
          const suffix = mapped.length > 0 ? mapped.join(',') : (localName || '');
          const label = short(rn);
          list.push(suffix ? `${label}:${suffix}` : label);
        });
        gpus.forEach((g: any) => {
          const rn = String(g?.deviceName || '').trim();
          const localName = String(g?.name || '').trim();
          const label = short(rn);
          list.push(localName ? `${label}:${localName}` : label);
        });
        return list;
    },
    
    // [字段] USB 设备
    usb: (r: any) => {
        const hostDevices = r?.spec?.template?.spec?.domain?.devices?.hostDevices || [];
        const usb = hostDevices.filter((d: any) => {
            const n = String(d?.name || '').toLowerCase();
            const dn = String(d?.deviceName || '').toLowerCase();
            return n.startsWith('usb') || dn.includes('usb');
        });
        return usb.map((u: any) => u.name).join(', ');
    },

    // ------------------------------------------
    // 3.7 操作系统 (Guest OS)
    // ------------------------------------------

    // [字段] OS 名称 (通过 Guest Agent 上报)
    os: (r: any) => r?.vmi?.status?.guestOSInfo?.name || r?.vmi?.status?.guestOSInfo?.prettyName || '',
    kernel: (r: any) => r?.vmi?.status?.guestOSInfo?.kernelRelease || '',
    arch: (r: any) => r?.vmi?.status?.guestOSInfo?.architecture || r?.spec?.template?.spec?.architecture || '',
    hostname: (r: any) => r?.spec?.template?.spec?.hostname || '',
  }), [namespaces, volumes, images]);

  /**
   * [辅助函数] 检查卷扩容状态 (checkResizeStatus)
   * 
   * [业务背景]
   * 磁盘扩容是一个异步过程，包含两个阶段：
   * 1. Resizing: 后端存储（如 Longhorn）正在调整块设备大小。
   * 2. FileSystemResizePending: 块设备已扩容，但 VM 内的文件系统（如 ext4/xfs）需要 OS 介入才能识别新空间。
   * 
   * 此函数遍历 VM 的所有 PVC，检测并返回当前的扩容阶段，以便 UI 给出准确提示。
   */
  const checkResizeStatus = useCallback((r: any) => {
    if (!volumes || volumes.length === 0) return { isResizing: false, isFsPending: false, pvcName: '', message: '' };
    
    const vmVolumes = r?.spec?.template?.spec?.volumes || [];
    
    // 解析 VM Namespace
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
        
        // 查找对应的 PVC 对象
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
        
        // 阶段 2: 等待文件系统扩容
        const fsPendingCond = conditions.find((c: any) => c.type === 'FileSystemResizePending' && c.status === 'True');
        if (fsPendingCond) {
            return { 
                isResizing: false, 
                isFsPending: true, 
                pvcName: claimName,
                message: fsPendingCond.message 
            };
        }

        // 阶段 1: 正在扩容物理卷
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
  // [逻辑处理] 4. 数据过滤 (Filtering)
  // ==========================================

  // [计算属性] 租户/组织筛选选项
  const tenantOrgOptions = useMemo(() => {
    const orgMap = new Map<string, Set<string>>();
    (namespaces || []).forEach((ns: any) => {
      const annotations = ns?.metadata?.annotations || {};
      const org = annotations['tower.io/organization'];
      const tenant = annotations['tower.io/tenant'];
      if (org) {
        if (!orgMap.has(org)) orgMap.set(org, new Set());
        if (tenant) orgMap.get(org)!.add(tenant);
      }
    });

    const options: any[] = [];
    orgMap.forEach((tenants, org) => {
      const children = Array.from(tenants).map(t => ({ value: t, label: t }));
      options.push({
        value: org,
        label: org,
        children: children.length > 0 ? children : undefined,
      });
    });
    return options;
  }, [namespaces]);

  /**
   * [计算属性] filtered
   * 根据用户输入的关键字、状态、命名空间、节点对原始 vms 列表进行过滤。
   * 同时，默认过滤掉系统级命名空间（如 cattle-system）。
   */
  const filtered = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    const st = statusFilter.trim().toLowerCase();
    
    return (vms || []).filter((r: any) => {
      // [筛选] 过滤回收站中的VM（在正常VM视图中不显示）
      const finalizers = r?.metadata?.finalizers || [];
      const labels = r?.metadata?.labels || {};
      if (finalizers.includes('tower.io/recycle-bin') || labels['tower.io/recycle-bin'] === 'true') {
        return false;
      }
      
      const iid = getIid(r);
      const name = String(SafeRead.name(r)).toLowerCase();
      const ns = SafeRead.namespace(r) || (iid.includes('/') ? iid.split('/')[0] : '');
      const node = String(SafeRead.node(r));
      const sKey = String(SafeRead.status(r)).toLowerCase();

      // [筛选] 租户/组织
      // 租户侧过滤公共命名空间
      if (isTenant && isPublicNamespace(ns)) return false;

      if (tenantOrgPath && tenantOrgPath.length > 0) {
        const currentNsObj = (namespaces || []).find((n: any) => n?.metadata?.name === ns);
        const org = currentNsObj?.metadata?.annotations?.['tower.io/organization'];
        const tenant = currentNsObj?.metadata?.annotations?.['tower.io/tenant'];

        // Level 1: Organization
        if (tenantOrgPath[0] && org !== tenantOrgPath[0]) return false;
        // Level 2: Tenant
        if (tenantOrgPath[1] && tenant !== tenantOrgPath[1]) return false;
      }

      // 应用筛选条件
      if (nsValue && ns !== nsValue) return false;
      if (nodeValue && node !== nodeValue) return false;
      if (kw && !(iid.toLowerCase().includes(kw) || name.includes(kw))) return false;
      if (st && sKey !== st) return false;
      return true;
    });
  }, [vms, nsValue, nodeValue, keyword, statusFilter, SafeRead, tenantOrgPath, namespaces, isTenant]);

  // 计算当前抽屉需要显示的记录（详情与运维信息共用当前选中 VM）
  const drawerRecord = useMemo(() => {
    if (!currentMetadata) return null;
    const currentId = getIid(currentMetadata);
    // 优先从最新的 vms 列表中查找，保证数据实时性
    return vms.find((v) => getIid(v) === currentId) || currentMetadata;
  }, [vms, currentMetadata]);

  // ==========================================
  // [事件处理] 5. 单个操作事件 (Single Actions)
  // ==========================================

  // [事件] 显示虚拟机详情抽屉（HarvesterVmDetailDrawer）
  const handleShowVmDetail = useCallback((record: any, tab: string = 'detail') => {
    setCurrentMetadata(record);
    setMetadataActiveTab(tab);
    setMetadataOpsMode(false);
    setMetadataModalVisible(true);
  }, []);

  // [事件] 显示运维信息抽屉（HarvesterResourceDrawer）
  const handleShowOpsinfo = useCallback((record: any, tab: string = 'detail') => {
    setCurrentMetadata(record);
    setMetadataActiveTab(tab);
    setMetadataOpsMode(true);
    setMetadataModalVisible(true);
  }, []);

  // [事件] 打开 WebVNC
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
      
      // 优先尝试构造标准 URL 直接打开
      if (ns && name) {
        const url = `/clouds/${cloudId}/harvester/vnc?cloudId=${encodeURIComponent(cloudId)}&namespace=${encodeURIComponent(ns)}&name=${encodeURIComponent(name)}`;
        window.open(url, '_blank');
        return;
      }
      
      // 兜底：通过 API 获取 VNC URL
      const j = await fetchHarvesterVncUrl(cloudId, iid);
      const url = j?.data?.VncUrl || j?.data?.vncUrl || j?.data?.url;
      if (url) {
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

  const handleOpenSaveAsTemplate = useCallback((r: any) => {
    setSaveTemplateVm(r);
    setSaveTemplateModalOpen(true);
  }, []);

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

  // [事件] 触发克隆操作
  const handleClone = useCallback((r: any) => {
    setCloneSourceVm(r);
    setCloneModalVisible(true);
  }, []);

  // [事件] 切换重要实例标记 (Toggle Important)
  // 使用 JSON Patch (RFC 6902) 操作 Finalizer，实现真正的 Kubernetes 级硬防删
  const handleToggleImportant = useCallback(async (r: any) => {
    // 1. 判断当前状态 (基于 Finalizer)
    const finalizers = r?.metadata?.finalizers || [];
    const protectionKey = 'tower.io/deletion-protection';
    const isProtected = finalizers.includes(protectionKey);
    
    const ns = SafeRead.namespace(r);
    const name = SafeRead.vmId(r);
    
    try {
      let patchBody: any[] = [];
      
      if (isProtected) {
        // [移除逻辑]
        // 查找所有匹配项并生成移除操作 (从后往前删，避免索引偏移)
        const indices: number[] = [];
        finalizers.forEach((f: string, i: number) => {
            if (f === protectionKey) indices.push(i);
        });
        
        if (indices.length > 0) {
            // 倒序排列索引
            indices.sort((a, b) => b - a);
            indices.forEach(idx => {
                patchBody.push({ op: 'remove', path: `/metadata/finalizers/${idx}` });
            });
            // 同时移除 Label
            patchBody.push({ op: 'remove', path: '/metadata/labels/tower.io~1important' });
        }
      } else {
        // [添加逻辑]
        // 追加到 finalizers 数组末尾
        // 如果 metadata.finalizers 不存在，K8s 允许直接 add 到 /metadata/finalizers
        if (!r?.metadata?.finalizers) {
           patchBody = [ { op: 'add', path: '/metadata/finalizers', value: [protectionKey] } ];
        } else {
           patchBody = [ { op: 'add', path: '/metadata/finalizers/-', value: protectionKey } ];
        }
        // 同时添加 Label (为了 UI 显示一致性，Label 用于快速查询和显示)
        patchBody.push({ op: 'add', path: '/metadata/labels/tower.io~1important', value: 'true' });
      }

      if (patchBody.length > 0) {
        await patchHarvesterVm(
          cloudId, 
          ns, 
          name, 
          patchBody,
          'application/json-patch+json' // 显式指定 Content-Type
        );
        message.success(isProtected ? '已取消重要实例标记 (防删锁已移除)' : '已设为重要实例 (防删锁已启用)');
        onRefresh();
      }
    } catch (e: any) {
      console.error(e);
      message.error(`操作失败: ${e.message}`);
    }
  }, [cloudId, onRefresh]);

  // [事件] 删除确认
  // 包含“同步删除关联卷”的选项
  const handleDeleteConfirm = useCallback((r: any) => {
    // [Feature] 检查重要实例标记 (优先检查 Finalizer，其次检查 Label)
    const finalizers = r?.metadata?.finalizers || [];
    const isProtected = finalizers.includes('tower.io/deletion-protection');
    // 兼容旧的 Label 标记
    const isLabelProtected = r?.metadata?.labels?.['tower.io/important'] === 'true';

    if (isProtected || isLabelProtected) {
      modal.warning({
        title: '无法删除重要实例',
        icon: <SafetyCertificateFilled style={{ color: '#faad14' }} />,
        content: (
          <div style={{ marginTop: 12 }}>
            <p>该实例被标记为 <b>重要实例</b>，受到防删保护。</p>
            <p>如需删除，请先在操作菜单中取消“设为重要实例”标记。</p>
          </div>
        ),
        okText: '知道了',
      });
      return;
    }

    const iid = getIid(r);
    const status = String(SafeRead.status(r)).toLowerCase();
    const isRunning = status === 'running' || status === 'starting';
    const volumes = (r?.spec?.template?.spec?.volumes || []).filter((v: any) => v.persistentVolumeClaim);
    const volumeNames = volumes.map((v: any) => v.persistentVolumeClaim.claimName).join(', ');
    
    let deleteVolumes = false; // 默认不删除数据卷
    modal.confirm({
      title: '移入回收站',
      icon: <ExclamationCircleOutlined />,
      width: 500,
      content: (
        <div style={{ marginTop: 16 }}>
          <p>确定要将虚拟机 <b>{SafeRead.name(r)}</b> 移入回收站吗？</p>
          {isRunning && (
            <div style={{ marginBottom: 16, color: '#ff4d4f', background: '#fff1f0', padding: '8px 12px', border: '1px solid #ffccc7', borderRadius: 4 }}>
              <WarningOutlined style={{ marginRight: 8 }} />
              警告：虚拟机正在运行中。删除操作将强制终止虚拟机。建议先停止虚拟机。
            </div>
          )}
          
          <div style={{ marginBottom: 16, color: '#1890ff', background: '#e6f7ff', padding: '8px 12px', border: '1px solid #91d5ff', borderRadius: 4 }}>
            <InfoCircleOutlined style={{ marginRight: 8 }} />
            虚拟机将被移入回收站，您可以在回收站中恢复或彻底删除。
          </div>     
          
          {volumeNames && (
              <div style={{ marginBottom: 16, background: '#f5f5f5', padding: '8px 12px', border: '1px solid #d9d9d9', borderRadius: 4 }}>
                <div style={{ fontWeight: 500, marginBottom: 4 }}>关联的数据卷 (PVC):</div>
                <div style={{ color: 'rgba(0,0,0,0.65)' }}>{volumeNames}</div>
                <div style={{ fontSize: 12, color: '#999', marginTop: 4 }}>
                  注意：移入回收站时不会删除关联的数据卷 (PVC)。如需删除数据卷，请在回收站中执行彻底删除操作。
                </div>
              </div>
          )}
        </div>
      ),
      okText: '移入回收站',
      okType: 'default',
      onOk: () => onDelete(iid, deleteVolumes)
    });
  }, [onDelete, SafeRead]);

  // [事件] 安全弹出 CD-ROM
  // 逻辑复杂：如果 VM 运行中，需要 停止 -> 卸载 -> 删除PVC -> 启动
  const handleEjectCdrom = useCallback(async (r: any) => {
    const disks = r?.spec?.template?.spec?.domain?.devices?.disks || [];
    const cdrom = disks[0];
    if (!cdrom) return;
    
    const statusStr = String(SafeRead.status(r)).toLowerCase();
    const isRunning = !['stopped', 'shutoff', 'down', 'offline'].includes(statusStr);
    
    let deletePvc = true;
    
    modal.confirm({
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

          // Step 1: 如果正在运行，先停止
          if (isRunning) {
              await stopHarvesterVm(cloudId, ns, name, true);
              await new Promise(resolve => setTimeout(resolve, 5000)); // 简单的等待策略
          }

          // Step 2: 卸载 CD-ROM 设备
          await detachHarvesterVolumeFromVm(cloudId, iidStr, { name: cdrom.name });

          // Step 3: 删除关联 PVC (防止垃圾残留)
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

          // Step 4: 如果之前是运行的，重新启动
          if (isRunning) {
              await new Promise(resolve => setTimeout(resolve, 2000));
              await startHarvesterVm(cloudId, ns, name);
          }

          message.success('已发送弹出指令');
          onRefresh();
        } catch(e:any) {
          // [错误处理] 统一捕获
          message.error(`弹出失败: ${e.message}`);
        } finally {
          hide();
        }
      }
    });
  }, [cloudId, onRefresh, SafeRead]);

  // [事件] 热迁移 (Live Migration)
  // 包含严格的前置条件检查
  const handleMigrate = useCallback(async (r: any) => {
    // Check 0: 必须是 Running 状态
    const statusStr = String(r?.status?.printableStatus || r?.status?.phase || '').toLowerCase();
    if (statusStr !== 'running') {
       message.warning('只有运行中的实例才能进行热迁移');
       return;
    }

    const spec = r?.spec?.template?.spec || {};
    const nodeSelector = spec?.nodeSelector || {};
    const affinity = spec?.affinity?.nodeAffinity?.requiredDuringSchedulingIgnoredDuringExecution || null;
    
    // Check 1: 检查是否绑定特定节点 (Hostname Pinned)
    // 如果 VM 被强制绑定到某台宿主机，迁移将无法调度到其他节点
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

    // Check 2: 检查节点标签约束是否导致只有一个可用节点 (Single Label Node)
    // 即使没有绑定 Hostname，如果 Label 选择器只匹配到当前这台机器，迁移也会 Pending
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

    // Check 3: 检查网络接口限制 (Network Blocked)
    // SRIOV 或 Macvtap 等高性能网络接口通常绑定物理网卡，不支持热迁移
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
            if (ns && name) {
              typeMap[`${ns}/${name}`] = type;
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

  // [事件] 取消迁移
  const handleAbortMigration = useCallback((r: any) => {
    modal.confirm({
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
             // [错误处理] 捕获单个失败，防止阻塞整体
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

  // [事件] 批量移入回收站
  const batchDelete = () => {
    if (selectedKeys.length === 0) return;

    modal.confirm({
      title: '批量移入回收站',
      width: 500,
      content: (
        <div>
          <p>确定要将选中的 {selectedKeys.length} 台虚拟机移入回收站吗？</p>
          <div style={{ marginBottom: 16, color: '#1890ff', background: '#e6f7ff', padding: '8px 12px', border: '1px solid #91d5ff', borderRadius: 4 }}>
            <InfoCircleOutlined style={{ marginRight: 8 }} />
            虚拟机将被移入回收站，您可以在回收站中恢复或彻底删除。移入回收站时不会删除关联的数据卷 (PVC)。
          </div>
        </div>
      ),
      okText: '移入回收站',
      okType: 'default',
      cancelText: '取消',
      onOk: async () => {
        try {
          const targets = (vms || []).filter((r: any) => selectedKeys.includes(getIid(r)));
          const protectedTargets = targets.filter((r: any) => {
            const finalizers = r?.metadata?.finalizers || [];
            const isFinalizerProtected =
              Array.isArray(finalizers) && finalizers.includes('tower.io/deletion-protection');
            const isLabelProtected = r?.metadata?.labels?.['tower.io/important'] === 'true';
            return isFinalizerProtected || isLabelProtected;
          });

          const deletableTargets = targets.filter((r: any) => !protectedTargets.includes(r));

          const results: Array<{ ok: boolean; iid: string; err?: string }> = [];
          for (const r of deletableTargets) {
            const iid = getIid(r);
            try {
              await onDelete(iid, false);
              results.push({ ok: true, iid });
            } catch (e: any) {
              results.push({ ok: false, iid, err: e?.message || String(e) });
            }
          }

          const ok = results.filter((x) => x.ok).length;
          const fail = results.filter((x) => !x.ok);

          if (ok > 0) message.success(`已成功将 ${ok} 台虚拟机移入回收站`);
          if (protectedTargets.length > 0)
            message.warning(`已跳过重要虚拟机 ${protectedTargets.length} 台（受防删保护）`);
          if (fail.length > 0) {
            console.error('Batch recycle-bin errors:', fail);
            message.error(`移入回收站失败 ${fail.length} 台：${fail.map((f) => f.iid).join(', ')}`);
          }
          
          setSelectedKeys([]);
          if (onRefresh) onRefresh(true);
          
        } catch(e:any){ 
          message.error(e?.message||'批量移入回收站失败'); 
        }
      }
    });
  };

  // ==========================================
  // [配置] 7. 表格列定义 (Table Configuration)
  // ==========================================

  const allColumns = useMemo(() => [
        { title: '云主机名称', key: 'name',  fixed: 'left' as any, ellipsis: true, render: (_: any, r: any) => {
      const text = SafeRead.name(r) || '-';
      const osName = SafeRead.os(r) || SafeRead.imageDisplayName(r) || SafeRead.name(r) || '';
      const finalizers = r?.metadata?.finalizers || [];
      const isImportant = finalizers.includes('tower.io/deletion-protection') || r?.metadata?.labels?.['tower.io/important'] === 'true';

      const cloneTaskAnno = r?.metadata?.annotations?.['tower.io/cloneTask'];
      let cloneInfo: any = null;
      if (cloneTaskAnno) {
        try {
          cloneInfo = JSON.parse(cloneTaskAnno);
        } catch (e) {
          // 忽略解析错误
        }
      }
      const isCloned = !!cloneInfo;
      const sourceVmName = cloneInfo?.sourceVmName || cloneInfo?.sourceVm?.split('/')?.[1] || '';
      const sourceVmNamespace = cloneInfo?.sourceVmNamespace || cloneInfo?.sourceVm?.split('/')?.[0] || '';

      // 权限检查：检查用户是否有云主机相关权限
      const perms = (user?.permissions ?? []) as string[];
      const hasEcsRead = hasPermissionForAction(perms, 'clouds.ecs:read') || 
                         hasPermissionForAction(perms, 'clouds:read');
      const hasEcsWrite = hasPermissionForAction(perms, 'clouds.ecs:write') || 
                          hasPermissionForAction(perms, 'clouds:write');
      const hasConsoleRead = hasPermissionForAction(perms, 'clouds.console:read');
      const hasAnyPermission = hasEcsRead || hasEcsWrite || hasConsoleRead;

      return (
        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <OsIcon osName={osName} style={{ flexShrink: 0 }} />
          {hasAnyPermission ? (
          <span className="cell-link" onClick={() => handleShowVmDetail(r, 'detail')}>
            {text}
          </span>
          ) : (
            <span>{text}</span>
          )}
          {isImportant && (
            <Tooltip title="重要实例 (防删保护)">
              <SafetyCertificateFilled style={{ color: '#faad14', fontSize: 14 }} />
            </Tooltip>
          )}
          {isCloned && (
            <Tooltip title={sourceVmName ? `克隆自: ${sourceVmNamespace}/${sourceVmName}` : '克隆虚拟机'} placement="top">
              <Tag color="blue"  style={{ marginLeft: 4, cursor: 'help' }}>克隆</Tag>
            </Tooltip>
          )}
        </span>
      );
    } },
    { title: '云主机ID', key: 'vmId', ellipsis: true, render: (_: any, r: any) => {
      const id = SafeRead.vmId(r);
      return id ? <Tooltip title={id}>{id}</Tooltip> : '-';
    } },
    { title: '状态', key: 'status', fixed: 'left' as any, render: (_: any, r: any) => {
      const s = String(SafeRead.status(r));
      const k = s.toLowerCase();
      const statusColor = (function(){
        if (k === 'running') return 'success';
        if (k === 'starting' || k === 'migrating') return 'processing';
        if (k === 'stopping' || k === 'terminating') return 'warning';
        if (k === 'error' || k === 'errorunschedulable') return 'error';
        return 'default';
      })();
      const { isFsPending, isResizing } = checkResizeStatus(r);
      const hasCloneTask = !!r?.metadata?.annotations?.['tower.io/cloneTask'];
      const cloneStatus = hasCloneTask ? getVmCloneTaskStatus(r) : null;

      const tagStyle = { marginTop: 2, fontSize: 12 };
      const hasExtra = isResizing || isFsPending || cloneStatus;

      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 6 }}>
            <Badge status={statusColor as any} text={cnVmStatus(s)} />
          </div>
          {hasExtra && (
            <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 4 }}>
              {isResizing && <Tag style={tagStyle} color="processing">系统盘扩容中</Tag>}
              {isFsPending && (
                <>
                  <Tag style={tagStyle} color="warning">系统盘待扩容</Tag>
                  <Button type="link" size="small" className="cell-link" style={{ padding: 0, height: 'auto', fontSize: 12 }} onClick={(e) => { e.stopPropagation(); setResizeGuideVisible(true); }}>扩容指南</Button>
                </>
              )}
              {cloneStatus && (
                <Tooltip title="该虚拟机由克隆创建，此处显示克隆卷是否就绪">
                  <Tag style={tagStyle} color={cloneStatus.phase === 'ready' ? 'success' : 'processing'}>克隆{cloneStatus.phase === 'ready' ? '完成' : '进行中'}</Tag>
                </Tooltip>
              )}
            </div>
          )}
        </div>
      );
    } },
    ...(mode === 'standard' ? [
      { title: '命名空间', key: 'namespace', ellipsis: true, render: (_: any, r: any) => SafeRead.namespace(r) || '-' },
      { title: '租户', key: 'tenant', ellipsis: true, render: (_: any, r: any) => SafeRead.tenant(r) || '-' },
      { title: '组织', key: 'organization', ellipsis: true, render: (_: any, r: any) => SafeRead.organization(r) },
    ] : []),
    { title: '节点', key: 'node',  ellipsis: true, render: (_: any, r: any) => {
      const node = String(SafeRead.node(r)).trim();
      return node ? <Tag color="blue">{node}</Tag> : '-';
    } },
    { title: 'CPU', key: 'cpu',  render: (_: any, r: any) => {
      const v = SafeRead.cpu(r);
      return v ? `${v} C` : '-';
    } },
    { title: '内存', key: 'memory',  render: (_: any, r: any) => SafeRead.memory(r) || '-' },
    { title: 'GPU', key: 'gpus', ellipsis: true, render: (_: any, r: any) => {
      const items = SafeRead.gpus(r);
      const list = Array.isArray(items) ? items.filter(Boolean) : [];
      if (list.length === 0) return '-';
      const text = list.join(', ');
      return <Tooltip title={text}><div style={{ maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{text}</div></Tooltip>;
    } },
    { title: '热扩容', key: 'hotplug', width: 80, render: (_: any, r: any) => {
      const isEnabled = SafeRead.isHotPlugEnabled(r);
      return isEnabled ? <Tag color="success">已开启</Tag> : <Tag>未开启</Tag>;
    } },
    { title: '镜像', key: 'image', ellipsis: true, render: (_: any, r: any) => {
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
    { title: '存储卷', key: 'volumes', ellipsis: false, render: (_: any, r: any) => {
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
    { title: '操作', key: 'actions', width: 80, align: 'left' as const, fixed: 'right' as const, render: (_: any, r: any) => {
      const iid = getIid(r);
      const statusStr = String(SafeRead.status(r)).toLowerCase();
      const isStopped = ['stopped', 'shutoff', 'down', 'offline'].includes(statusStr);
      const isRunning = statusStr === 'running';
      const isPaused = statusStr === 'paused';
      const isMigrating = statusStr === 'migrating';
      const { isResizing, pvcName } = checkResizeStatus(r);

      // [Feature] 检查重要实例标记
      const finalizers = r?.metadata?.finalizers || [];
      const isImportant = finalizers.includes('tower.io/deletion-protection') || r?.metadata?.labels?.['tower.io/important'] === 'true';

      // 权限检查：检查用户是否有云主机相关权限
      const perms = (user?.permissions ?? []) as string[];
      const hasEcsRead = hasPermissionForAction(perms, 'clouds.ecs:read') ||
                         hasPermissionForAction(perms, 'clouds:read');
      const hasEcsWrite = hasPermissionForAction(perms, 'clouds.ecs:write') || 
                          hasPermissionForAction(perms, 'clouds:write');
      const hasConsoleRead = hasPermissionForAction(perms, 'clouds.console:read');
      const hasAnyPermission = hasEcsRead || hasEcsWrite || hasConsoleRead;

      const items: any[] = [
        // ----------------------------------------------------------------
        // 1. 基础信息与访问
        // ----------------------------------------------------------------
        { key: 'detail', label:'实例详情', onClick: () => handleShowVmDetail(r, 'detail') },        
        // 运维模式下的 YAML / 原始对象查看
        ...(!isTenant && mode === 'standard' ? [
            { key: 'detail_ops', label: '运维信息', onClick: () => handleShowOpsinfo(r, 'detail') }
        ] : []),

        // VNC 控制台
        { key: 'webvnc', label: '访问VNC', disabled: isStopped, onClick: () => handleWebVnc(r) },

        { type: 'divider' },
        
        // ----------------------------------------------------------------
        // 2. 生命周期管理 (Power Operations)
        // ----------------------------------------------------------------
        
        // [启动]
        ...(isStopped ? [{ 
          key: 'start', 
          label: '启动', 
          disabled: isResizing,
          tooltip: isResizing ? `无法启动: 关联磁盘 ${pvcName} 正在后端扩容中，请稍候...` : undefined,
          onClick: () => !isResizing && onStart(iid) 
        }] : []),

        // [停止]
        ...(!isStopped ? [
           { key: 'stop', label: '停止', onClick: () => onStop(iid) },
        ] : []),

        // [重启/暂停]
        ...(isRunning ? [
           { key: 'softreboot', label: '重启', onClick: () => onSoftReboot && onSoftReboot(iid) },
           { key: 'pause', label: '暂停', onClick: () => onPause && onPause(iid) }
        ] : []),

        // [恢复]
        ...(isPaused ? [
           { key: 'unpause', label: '恢复', onClick: () => onUnpause && onUnpause(iid) }
        ] : []),

        // ----------------------------------------------------------------
        // 2.5. 迁移操作 (Migration)
        // ----------------------------------------------------------------
        // 根据迁移状态动态显示"热迁移"或"中止迁移"
        ...(isMigrating ? [
          { 
            key: 'abort_migration', 
            label: '中止迁移', 
            danger: true, 
            onClick: () => handleAbortMigration(r) 
          }
        ] : [
          ...(isRunning ? [
            { 
              key: 'migrate', 
              label: '热迁移', 
              onClick: () => handleMigrate(r) 
            }
          ] : [])
        ]),

        // ----------------------------------------------------------------
        // 3. 标记管理 (Tags)
        // ----------------------------------------------------------------
        { type: 'divider' },
        { 
          key: 'important', 
          label: isImportant ? '取消重要标记' : '设为重要实例', 
          icon: isImportant ? undefined : <SafetyCertificateFilled style={{ color: '#faad14' }} />,
          onClick: () => handleToggleImportant(r) 
        },

        // ----------------------------------------------------------------
        // 4. 风险操作 (Danger Zone)
        // ----------------------------------------------------------------
        { type: 'divider' },
        
        ...(!isStopped ? [
           { key: 'force_stop', label: '强制停止', danger: true, onClick: () => onStop && onStop(`${iid}::force`) }
        ] : []),

        ...(isRunning ? [
           { key: 'reboot', label: '强制重启', danger: true, onClick: () => onReboot(iid) },
        ] : []),

        { 
          key: 'delete', 
          label: '删除', 
          danger: true, 
          disabled: !hasEcsWrite || isImportant,
          tooltip: isImportant ? '重要实例受保护，无法删除' : undefined,
          onClick: () => {
            if (!hasEcsWrite) {
              message.error('无权限执行该操作');
              return;
            }
            handleDeleteConfirm(r);
          } 
        },
      ];
      return (
        <span>
          <ResourceActionsDropdown 
            items={items} 
            buttonProps={{ 
              className: 'row-actions-trigger', 
              style: { margin: 0 },
              disabled: !hasEcsWrite
            }} 
          />
        </span>
      );
    } },
  ], [handleShowVmDetail, handleShowOpsinfo, handleClone, onStart, onStop, onReboot, onSoftReboot, onPause, onUnpause, SafeRead, checkResizeStatus, handleWebVnc, handleDeleteConfirm, isTenant, handleOpenSaveAsTemplate, handleToggleImportant, handleMigrate, handleAbortMigration]);

  // 使用新的 hook 管理列设置
  const { displayColumns: tableColumns } = useTableColumnSettings(allColumns, 'harvester_vm_table_v3');

  // ==========================================
  // [UI渲染] 8. 组件结构返回 (Render)
  // ==========================================

  return (
    <PageDetailSection asCard={false}>
      {/* 
        ========================================
        1. 工具栏区域 (Toolbar)
        包含：关键字搜索、下拉筛选、操作按钮
        ========================================
      */}
      <div key="toolbar" style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
        {/* 左侧：筛选器 */}
        <div key="toolbar-left" style={{ display: 'flex', gap: 8 }}>
          <Input key="keyword" allowClear placeholder="名称/ID" suffix={<SearchOutlined style={{ color: 'rgba(0,0,0,.45)' }} />} className="toolbar-search" value={keyword} onChange={(e)=> setKeyword(e.target.value)} />
          {!isTenant && mode === 'standard' && (
            <Cascader
              key="tenant-org-filter"
              className="toolbar-filter-sm"
              placeholder="组织/租户"
              options={tenantOrgOptions}
              value={tenantOrgPath}
              onChange={(value) => setTenantOrgPath(value as string[])}
              changeOnSelect
              allowClear
            />
          )}
          {!isTenant && mode === 'standard' && (
            <Select
            key="ns-filter"
            className="toolbar-filter-sm"
            placeholder="命名空间"
            value={nsValue || undefined}
            onChange={(v)=> onNsChange(v || undefined)}
            allowClear
            showSearch
            options={namespacesOptions
              .filter(ns => {
                // 租户模式下过滤公共命名空间
                if (isTenant && isPublicNamespace(ns)) return false;
                return true;
              })
              .map(ns=> ({ value: ns, label: ns }))}
          />
          )}
          <Select
            key="node-filter"
            className="toolbar-filter-sm"
            placeholder="节点"
            value={nodeValue || undefined}
            onChange={(v)=> onNodeChange(v || undefined)}
            allowClear
            showSearch
            options={nodesOptions.map(n=> ({ value: n, label: n }))}
          />
          <Select
            key="status-filter"
            className="toolbar-filter-sm"
            placeholder="状态"
            value={statusFilter || undefined}
            onChange={(v)=> setStatusFilter(v || '')}
            allowClear
            options={[{ value: '', label: '全部' }, ...Object.keys(VM_STATUS_MAP).map(k=> ({ value: k, label: VM_STATUS_MAP[k] }))]}
          />
          <button
            type="button"
            className="toolbar-reset-btn"
            onClick={() => {
              setKeyword('');
              setStatusFilter('');
              setTenantOrgPath([]);
              onNsChange(undefined);
              onNodeChange(undefined);
            }}
          >
            重置
          </button>
        </div>
        
        {/* 右侧：操作按钮 */}
        <div key="toolbar-right" className="toolbar-actions">
          <Button 
            key="create-btn" 
            type="primary"
            disabled={!hasVmCreatePermission}
            onClick={() => {
              if (!hasVmCreatePermission) return;
              if (onCreateVmOverride) {
                onCreateVmOverride();
                return;
              }
              navigate(`/clouds/${cloudId}/instances/create`, { state: { backgroundLocation: location, isTenant } });
            }}
          >
            {createVmButtonText ?? '创建实例'}
          </Button>
          <Tooltip
            title={
              !hasVmCreatePermission
                ? undefined
                : selectedKeys.length === 0
                  ? '请先选择实例'
                  : undefined
            }
          >
            <span>
              <Dropdown
                key="batch-actions"
                trigger={['click']}
                menu={{
                  items: [
                    { key:'batchStop', label:'批量停止', disabled: !hasVmCreatePermission || selectedKeys.length===0 },
                    { key:'batchReboot', label:'批量重启', disabled: !hasVmCreatePermission || selectedKeys.length===0 },
                    { type: 'divider' },
                    { key:'batchDelete', label:<span style={{ color:'#ff4d4f' }}>批量删除</span>, disabled: !hasVmCreatePermission || selectedKeys.length===0 },
                  ],
                  onClick: ({ key }) => {
                    if (!hasVmCreatePermission) {
                      message.error('无权限执行批量操作');
                      return;
                    }
                    if (selectedKeys.length === 0) {
                      message.warning('请先选择实例');
                      return;
                    }
                    if (key==='batchStop') batchStop();
                    if (key==='batchReboot') batchReboot();
                    if (key==='batchDelete') batchDelete();
                  },
                }}
              >
                <Button icon={<EllipsisOutlined />} disabled={!hasVmCreatePermission || selectedKeys.length===0}></Button>
              </Dropdown>
            </span>
          </Tooltip>
          {!disableColumnSettings && (
            <TableColumnSettingsButton
              key="col-settings"
              allColumns={allColumns}
              settingsKey="harvester_vm_table_v3"
            />
          )}
          <Button key="refresh-btn" icon={<ReloadOutlined />} onClick={() => onRefresh && onRefresh(true)} />
        </div>
      </div>

      {/* 
        ========================================
        2. 数据表格区域 (Table)
        ========================================
      */}
      <Table
        key="vm-table"
        className="std-table"
        bordered={false}
        rowKey={(r:any)=> getIid(r)}
        rowSelection={{ selectedRowKeys: selectedKeys, onChange: (keys)=> setSelectedKeys(keys) }}
        columns={disableColumnSettings ? allColumns : (tableColumns.length > 0 ? tableColumns : allColumns)}
        dataSource={filtered}
        loading={loading}
        scroll={{ 
          x: 'max-content',
          // 只有当数据量超过15条时才启用虚拟滚动，避免显示不可滚动的滚动条
          
        }}
        pagination={{
          size: 'small',
          showTotal: (total) => `共 ${total} 条`,
        }}
      />
      
      {/* 
        ========================================
        3. 弹窗与抽屉 (Modals & Drawers)
        ========================================
      */}
      
      {/* 虚拟机详情抽屉（实例详情） */}
      <HarvesterVmDetailDrawer
        open={metadataModalVisible && !metadataOpsMode}
        onClose={() => setMetadataModalVisible(false)}
        record={drawerRecord}
        cloudId={cloudId}
        namespaces={namespaces}
        volumes={volumes}
        images={images}
        activeTab={metadataActiveTab}
        onTabChange={setMetadataActiveTab}
        onRefresh={onRefresh}
        onOpenReconfigure={onOpenReconfigure}
        onBackup={handleBackup}
        onSnapshot={handleSnapshot}
        onClone={handleClone}
        onMigrate={handleMigrate}
        onDelete={handleDeleteConfirm}
      />

      {/* 运维信息抽屉（YAML / 原始对象 / 实例摘要） */}
      <HarvesterResourceDrawer
        open={metadataModalVisible && metadataOpsMode}
        onClose={() => setMetadataModalVisible(false)}
        resourceType="VirtualMachine"
        record={drawerRecord}
        activeTab={metadataActiveTab}
        onTabChange={setMetadataActiveTab}
        cloudId={cloudId}
      />
      
      {/* 备份/快照创建弹窗 */}
      <VmBackupCreateModal
        open={vmBackupModalVisible}
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

      <VmCloneModal
        open={cloneModalVisible}
        onCancel={() => setCloneModalVisible(false)}
        onSuccess={() => {
          setCloneModalVisible(false);
          // 成功消息已在 VmCloneModal 中显示，这里不再重复显示
          onRefresh && onRefresh(true);
        }}
        cloudId={cloudId}
        sourceVm={cloneSourceVm}
        existingVms={vms}
      />


      {/* 热迁移弹窗 */}
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

      <VmSaveAsTemplateModal
        open={saveTemplateModalOpen}
        onClose={() => setSaveTemplateModalOpen(false)}
        cloudId={cloudId}
        vmNamespace={SafeRead.namespace(saveTemplateVm)}
        vmName={SafeRead.vmId(saveTemplateVm)}
        vmDisplayName={SafeRead.name(saveTemplateVm)}
        namespacesOptions={namespacesOptions}
        isTenant={isTenant}
        onSuccess={() => {
          onRefresh && onRefresh(true);
        }}
      />

      {/* 扩容指南说明弹窗 */}
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
