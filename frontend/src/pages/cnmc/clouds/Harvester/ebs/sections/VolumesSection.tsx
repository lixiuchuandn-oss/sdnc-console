/**
 * ==============================================================================
 * [模块] VolumesSection - Harvester 虚拟卷 (PVC) 列表管理
 * [文件] frontend/src/pages/cnmc/clouds/Harvester/ebs/sections/VolumesSection.tsx
 * [标签] #Harvester #Volume #PVC #存储管理 #生命周期管理
 * ==============================================================================
 * 
 * [功能概述]
 * 展示和管理 Harvester 集群中的虚拟卷 (PersistentVolumeClaim) 资源。
 * 
 * [核心功能]
 * 1. 列表展示: 展示 PVC 的状态、容量、存储类、挂载 VM 等信息
 * 2. 资源过滤: 支持按关键字、命名空间、状态、存储类筛选，默认排除系统卷
 * 3. 生命周期管理: 创建、克隆、扩容、删除、创建快照、导出镜像
 * 4. 挂载管理: 将卷挂载到虚拟机或从虚拟机卸载
 * 
 * [核心逻辑]
 * 
 * 1. 视图模型 (ViewModel)
 *    - 定义 `VolumeView` 接口，将后端返回的复杂 K8s PVC 对象转换为扁平化的前端视图数据
 *    - 统一处理容量单位 (Bytes/GiB)、状态映射 (Phase)、挂载关系 (AttachedTo)
 *    - 位置: 第 91-107 行
 * 
 * 2. 系统资源过滤
 *    - 默认过滤掉 Harvester/Longhorn 等系统命名空间的卷 (依赖 `isSystemNamespace`)
 *    - 默认过滤掉系统存储类 (依赖 `isSystemStorageClass`)
 *    - 提供 Checkbox 开关允许用户查看系统级资源
 *    - 位置: 第 402-410 行
 * 
 * 3. 关联查询 (挂载反查)
 *    - 利用 `SafeRead.attachedVm` 和传入的 `vms` 列表，自动反查卷当前挂载的虚拟机名称
 *    - 在列表中生成指向 VM 详情页的链接
 *    - 位置: 第 287-311 行
 * 
 * 4. 操作权限控制
 *    - 根据卷的状态 (Bound/Available/In-use) 动态禁用或启用特定操作按钮
 *    - 如仅 Bound 状态可扩容
 *    - 位置: 第 721-819 行
 * 
 * [数据流]
 * 
 * 上游数据源:
 *   - 资源池详情页传入 `volumes`, `vms`, `storageClasses` 数据
 *   - Props 定义: 第 68-78 行
 * 
 * 下游接口调用:
 *   - `harvesterApi`: 执行 CRUD 和挂载/卸载操作
 *   - 导入位置: 第 49 行
 * 
 * [复用组件]
 *   - `HarvesterResourceDrawer`: 展示详情 (第 52 行)
 *   - `ResourceActionsDropdown`: 展示操作菜单 (第 48 行)
 *   - `TableColumnSettings`: 列设置 (第 50 行)
 * 
 * [关键函数索引]
 *   - `parseQuantity`: 容量单位解析 (第 118 行)
 *   - `gbText`: 容量格式化 (第 138 行)
 *   - `statusBadge`: 状态徽标渲染 (第 168 行)
 *   - `SafeRead`: 安全读取工具 (第 271 行)
 *   - `handleAttach`: 挂载处理 (第 512 行)
 *   - `handleDetach`: 卸载处理 (第 537 行)
 *   - `handleBatchDelete`: 批量删除 (第 485 行)
 *
 * 【页面结构对照（云详情 Tab「虚拟云盘」）】
 * - `PageDetailSection.toolbarLeft`   → 名称/ID 搜索、命名空间(运维)、状态、重置
 * - `PageDetailSection.toolbarRight`  → 创建卷、批量删除、列设置、刷新
 * - `PageDetailSection` 子节点        → 主表格 `Table`（行选用于批量删）
 * - `VolumeCreateModal`               → `ebs/modals`，创建 PVC
 * - `VolumeAttachModal` / `VolumeCloneModal` → `ebs/modals`，挂载 VM、克隆卷
 * - 其余 `Modal` / `Drawer`           → 导出镜像、快照、扩容等（见 JSX 注释）
 * 
 * ==============================================================================
 */

// -----------------------------------------------------------------------------
// 依赖（顺序：React → antd → icons → 远程 API → 通用组件 → hooks → Harvester 域内）
// -----------------------------------------------------------------------------
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  App,
  Badge,
  Button,
  Dropdown,
  Form,
  Input,
  InputNumber,
  Modal,
  Select,
  Table,
  Tag,
  Tooltip,
} from 'antd';
import { EllipsisOutlined, ExclamationCircleOutlined, HddTwoTone, ReloadOutlined, SearchOutlined, SyncOutlined } from '@ant-design/icons';
import { rebootCloudProviderEcs } from '../../../../../../services/api';
import PageDetailSection from '../../../../../../components/PageDetailSection';
import ResourceActionsDropdown from '../../../../../../components/ResourceActionsDropdown';
import TableColumnSettingsButton from '../../../../../../components/TableColumnSettingsButton';
import {
  createHarvesterVolumeSnapshot,
  deleteHarvesterVolume,
  detachHarvesterVolumeFromVm,
  exportHarvesterImageFromVolume,
  fetchHarvesterNamespaces,
  updateHarvesterVolume,
} from '../../../../../../services/harvesterApi';
import { useTableColumnSettings } from '../../../../../../hooks/useTableColumnSettings';
import { useAuth } from '../../../../../../contexts/AuthContext';
import { hasPermissionForAction } from '../../../../../../utils/accessMapping';
import {
  isClusterDefaultStorageClass,
  isSystemNamespace,
  isSystemStorageClass,
  pickDefaultStorageClassName,
} from '../../../../../../utils/harvesterUtils';
import { useHarvesterPublicNamespaces } from '../../context/HarvesterPublicNamespacesContext';
import HarvesterResourceDrawer from '../../shared/components/HarvesterOpsinfoDrawer';
import HarvesterVolumeDetailDrawer from '../../shared/components/HarvesterVolumeDetailDrawer';
import VolumeCreateModal, { type VolumeCreateSeed } from '../modals/VolumeCreateModal';
import VolumeAttachModal from '../modals/VolumeAttachModal';
import VolumeCloneModal from '../modals/VolumeCloneModal';
import { useCloudmapOpsViewWrite } from '../../hooks/useCloudmapOpsViewWrite';

// -----------------------------------------------------------------------------
// Props（云详情「虚拟云盘」Tab 注入）
// -----------------------------------------------------------------------------
/**
 * [组件参数] Props - VolumesSection 组件入参
 * [标签] #Props #接口定义 #数据源
 * 
 * [参数说明]
 * - cloudId: 云平台 ID（用于调用 Harvester 相关 API）
 * - volumes: 后端返回的卷列表（PVC 或包装对象），作为原始数据源
 * - loading: 上层传入的加载状态，用于控制表格/刷新按钮的 loading
 * - vms: 当前集群中云主机列表，用于反查卷挂载到哪台 VM
 * - storageClasses: 存储类列表（StorageClass），用于创建/导出卷时提供下拉选项
 * - namespacesOptions: 可选的命名空间选项（如果不给，则从数据中推导）
 * - onRefresh: 触发上层重新拉取 volumes/vms 等数据的回调
 * - isTenant: 是否为租户模式（租户模式下强制过滤系统和公共卷）
 * - bordered: 表格是否显示边框
 */
type Props = {
  cloudId: string;
  volumes: any[];
  loading: boolean;
  vms?: any[];
  storageClasses?: any[];
  namespacesOptions?: string[];
  onRefresh?: (force?: boolean, silent?: boolean) => void;
  onRefreshStorageClasses?: (force?: boolean, skipSync?: boolean) => void;
  onRefreshImages?: (force?: boolean, silent?: boolean) => void; // 刷新镜像列表的回调
  isTenant?: boolean; // 是否为租户模式 (租户模式下强制过滤系统和公共卷)
  bordered?: boolean;
};

// ==============================================================================
// [1] 视图模型定义 (ViewModel)
// ==============================================================================

/**
 * [类型定义] VolumeView - 前端统一视图模型
 * [标签] #ViewModel #数据转换 #类型定义
 * 
 * [用途]
 * 将后端返回的不一致数据结构（原生 K8s 对象或包装对象）转换为标准化的前端视图数据。
 * 
 * [字段说明]
 * - key: 唯一标识 (UID)
 * - name: PVC 名称
 * - alias: 别名 (Annotations)
 * - namespace: 命名空间
 * - pvName: 绑定的 PV 名称
 * - phase: 卷状态 (Bound, Pending, etc.)
 * - capacityRaw: 原始容量 (10Gi)
 * - capacityBytes: 字节容量 (用于排序)
 * - storageClass: 存储类
 * - accessModes: 访问模式 (RWO, RWX)
 * - volumeMode: 卷模式 (Block, Filesystem)
 * - creationTimestamp: 创建时间
 * - attachedTo: 挂载到的节点/实例
 * - raw: 原始数据对象 (用于详情抽屉)
 */
interface VolumeView {
  key: string;               // 唯一标识 (UID)
  name: string;              // PVC 名称
  alias?: string;            // 别名 (Annotations)
  namespace: string;         // 命名空间
  pvName: string;            // 绑定的 PV 名称
  phase: string;             // 卷状态 (Bound, Pending, etc.)
  capacityRaw: string;       // 原始容量 (10Gi)
  capacityBytes: number;     // 字节容量 (用于排序)
  storageClass: string;      // 存储类
  accessModes: string[];     // 访问模式 (RWO, RWX)
  volumeMode: string;        // 卷模式 (Block, Filesystem)
  creationTimestamp: string; // 创建时间
  attachedTo: string[];      // (后端字段) 挂载到的节点/实例
  links?: { view?: string }; // 扩展链接
  raw: any;                  // 原始数据对象 (用于详情抽屉)
}

// ==============================================================================
// [2] 辅助工具函数 (Helpers)
// ==============================================================================

/**
 * [工具函数] parseQuantity - K8s 容量单位解析
 * [标签] #工具函数 #容量解析 #单位转换
 * 
 * [功能]
 * 将 K8s 容量字符串 ("10Gi", "500Mi") 转换为字节数 (number)。
 * 
 * [用途]
 * - 用于数值排序
 * - 用于容量格式化显示
 * 
 * [支持单位]
 * - 二进制: Ki, Mi, Gi, Ti, Pi
 * - 十进制: k, M, G, T, P
 */
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

/**
 * [工具函数] gbText - 格式化容量文本
 * [标签] #工具函数 #容量格式化 #显示
 * 
 * [功能]
 * 将字节数转换为人类可读的 "xx.xx GB" 格式。
 */
const gbText = (bytes: number): string => {
  if (!bytes || bytes <= 0) return '-';
  const gb = bytes / (1024 * 1024 * 1024);
  return `${gb.toFixed(2)} GB`;
};

/**
 * [工具函数] cnStatus - 状态汉化映射
 * [标签] #工具函数 #状态映射 #国际化
 * 
 * [功能]
 * 将 K8s 的英文状态 (Bound, Lost) 翻译成中文，用于筛选框展示。
 */
const cnStatus = (s: string): string => {
  const k = s.toLowerCase();
  const m: Record<string, string> = {
    healthy: '健康', degraded: '降级', faulted: '故障', unknown: '未知',
    bound: '已绑定', pending: '等待中', lost: '丢失', detached: '已卸载',
    attaching: '使用中', attached: '使用中', detaching: '卸载中',
    maintenance: '维护', restoring: '恢复中', creating: '创建中',
    deleting: '删除中', error: '错误'
  };
  return m[k] || s;
};

/**
 * [工具函数] statusBadge - 状态徽标渲染
 * [标签] #工具函数 #状态显示 #UI组件
 * 
 * [功能]
 * 根据卷的状态显示不同颜色的徽标 (Badge)。
 * 
 * [状态映射]
 * - 绿色 (success): 正常/已绑定 (Bound, Available)
 * - 红色 (error): 丢失/错误 (Lost)
 * - 蓝色 (processing): 处理中/创建中 (Pending, Resizing)
 * - 黄色 (warning): 警告 (FileSystemResizePending)
 */
const statusBadge = (phase: string) => {
  const p = (phase || '').toLowerCase();
  let status = 'default';
  let text = phase;
  let icon = null;

  if (p === 'bound' || p === 'available') {
    status = 'success';
    text = '正常 (Bound)';
  } else if (p === 'lost') {
    status = 'error';
    text = '丢失 (Lost)';
  } else if (p === 'pending') {
    status = 'processing';
    text = '创建中 (Pending)';
  } else if (p === 'resizing') {
      status = 'processing';
      text = '扩容中 (Resizing)';
      icon = <SyncOutlined spin />;
    } else if (p === 'filesystemresizepending') {
      status = 'warning';
      text = '等待文件系统扩容';
      icon = <ExclamationCircleOutlined />;
    }

    return <Badge status={status as any} text={icon ? <span style={{display:'inline-flex', alignItems:'center', gap:6}}>{text}{icon}</span> : text} />;
  };

/** 列表轮询：与中间态展示一致（创建中/删除中/扩容中等），避免依赖用户手动点「刷新」 */
const VOLUME_LIST_POLL_MS = 3500;
/** 不设上限：PVC 长期处于 Pending/Longhorn 中间态时需持续跳过缓存刷新，否则会回到「只能靠手动刷新」的体验 */
const TRANSITION_VOLUME_PHASES = new Set([
  'pending',
  'creating',
  'deleting',
  'resizing',
  'filesystemresizepending',
  'terminating',
  'attaching',
  'detaching',
]);

function isVolumePhaseTransitional(phase: string): boolean {
  const p = String(phase || '').trim().toLowerCase();
  return TRANSITION_VOLUME_PHASES.has(p);
}

// ==============================================================================
// [3] 主组件 (Component)
// ==============================================================================

const VolumesSection: React.FC<Props> = ({ 
  cloudId, 
  volumes, 
  loading, 
  vms, 
  storageClasses: propStorageClasses, 
  namespacesOptions, 
  onRefresh, 
  onRefreshStorageClasses,
  onRefreshImages,
  isTenant,
}) => {
  const hasOpsView = useCloudmapOpsViewWrite();
  const { message, modal } = App.useApp();
  const { user } = useAuth();
  const { isPublicNamespace } = useHarvesterPublicNamespaces();
  const isStandardView = !hasOpsView;
  const perms = useMemo(() => (user?.permissions ?? []) as string[], [user?.permissions]);
  const hasDisksWrite = useMemo(
    () => hasPermissionForAction(perms, 'clouds.disks:write') || hasPermissionForAction(perms, 'clouds:write'),
    [perms],
  );
  const ensureDisksWrite = useCallback(() => {
    if (hasDisksWrite) return true;
    message.error('当前账号没有云盘操作权限（需要 clouds.disks:write 或 clouds:write 权限）');
    return false;
  }, [hasDisksWrite, message]);

  // ----------------------------------------------------------------
  // [状态管理] State
  // [标签] #状态管理 #useState
  // ----------------------------------------------------------------
  
  // 过滤条件
  const [keyword, setKeyword] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [nsFilter, setNsFilter] = useState<string>('');
  const [scFilter, setScFilter] = useState<string>('');
  
  // 批量操作选中项
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([]);

  // 弹窗可见性控制
  const [createOpen, setCreateOpen] = useState(false);
  const [createModalNonce, setCreateModalNonce] = useState(0);
  const [volumeCreateSeed, setVolumeCreateSeed] = useState<VolumeCreateSeed | null>(null);
  const [attachOpen, setAttachOpen] = useState(false);
  const [attachModalNonce, setAttachModalNonce] = useState(0);
  const [attachInitialInstanceId, setAttachInitialInstanceId] = useState<string | undefined>();
  const [exportOpen, setExportOpen] = useState(false);
  const [snapshotOpen, setSnapshotOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [cloneOpen, setCloneOpen] = useState(false);
  const [cloneModalNonce, setCloneModalNonce] = useState(0);
  
  // 详情 / 运维信息抽屉控制
  const [detailVisible, setDetailVisible] = useState(false);
  const [detailRecord, setDetailRecord] = useState<any>(null);
  const [detailActiveTab, setDetailActiveTab] = useState('detail');
  const [detailOpsMode, setDetailOpsMode] = useState(false); // false: 云盘详情; true: 运维信息

  // 表单实例
  const [exportForm] = Form.useForm();
  const [snapshotForm] = Form.useForm();
  const [editForm] = Form.useForm();

  // 当前操作对象与辅助状态
  const [currentRecord, setCurrentRecord] = useState<VolumeView | null>(null);
  const [storageClasses, setStorageClasses] = useState<any[]>([]); 
  const defaultStorageClassName = useMemo(() => pickDefaultStorageClassName(storageClasses), [storageClasses]);

  /** 创建卷弹窗：存储类下拉，集群默认类显示「（默认）」 */
  const createVolumeStorageClassOptions = useMemo(
    () =>
      (storageClasses || [])
        .map((s: any) => {
          const n = s?.metadata?.name || s?.name;
          if (!n || isSystemStorageClass(n)) return null;
          const isDef = isClusterDefaultStorageClass(s);
          return { value: n, label: isDef ? `${n}（默认）` : n };
        })
        .filter(Boolean) as { value: string; label: string }[],
    [storageClasses],
  );

  // 同步外部传入的 storageClasses
  useEffect(() => {
    if (propStorageClasses) setStorageClasses(propStorageClasses);
  }, [propStorageClasses]);

  // ----------------------------------------------------------------
  // [安全读取工具] SafeRead
  // [标签] #工具对象 #数据提取 #挂载反查
  // ----------------------------------------------------------------
  /**
   * [工具对象] SafeRead - 安全读取工具
   * 
   * [功能]
   * 封装所有从 raw 数据中提取字段的逻辑，统一处理数据不一致问题。
   * 
   * [核心方法] attachedVm - 挂载虚拟机反查
   * 
   * [为什么需要]
   * - PVC 对象本身通常只记录"被谁使用了"，但不一定包含 VM 的名字
   * - 需要遍历所有 VM，检查 VM 的 Volume 列表里有没有包含当前 PVC 的名字
   * 
   * [匹配规则]
   * 1. Namespace 必须相同
   * 2. ClaimName 必须匹配
   * 3. 支持两种策略：
   *    - 策略 A: 检查后端预处理的 volumeClaims 字段
   *    - 策略 B: 深度检查 K8s spec.template.spec.volumes
   * 
   * [位置] 第 271-312 行
   */
  const SafeRead = useMemo(() => ({
    id: (r: any) => r?.name || r?.metadata?.name || '',
    name: (r: any) => r?.alias || r?.metadata?.annotations?.['tower.io/alias'] || r?.name || r?.metadata?.name || '',
    namespace: (r: any) => r?.namespace || r?.metadata?.namespace || '',
    phase: (r: any) => r?.phase || r?.status?.phase || r?.status?.state || 'Unknown',
    capacity: (r: any) => r?.capacityRaw || r?.status?.capacity?.storage || r?.spec?.resources?.requests?.storage || '',
    storageClass: (r: any) => r?.storageClass || r?.spec?.storageClassName || '',
    accessModes: (r: any) => {
      const modes = r?.accessModes || r?.spec?.accessModes || r?.status?.accessModes;
      return Array.isArray(modes) ? modes : (modes ? [modes] : []);
    },
    attachedTo: (r: any) => {
      if (Array.isArray(r?.attachedTo)) return r.attachedTo;
      return [];
    },
    // [挂载反查逻辑]
    attachedVm: (r: any) => {
      const list = Array.isArray(vms) ? vms : [];
      const pvcName = r?.name || r?.metadata?.name || ''; 
      const pvcNs = r?.namespace || r?.metadata?.namespace || '';

      return list.find((vm: any) => {
        // 1. 命名空间必须一致
        const vmNs = vm.namespace || vm.metadata?.namespace || vm.extra?.namespace || vm.Extra?.Namespace || '';
        if (String(vmNs) !== pvcNs) return false;

        // 2. 检查 VM 的 claim 列表
        // 策略 A: 检查后端预处理的 volumeClaims 字段
        const claims = vm.volumeClaims || vm.extra?.volumeClaims || vm.Extra?.VolumeClaims;
        if (Array.isArray(claims) && claims.includes(pvcName)) return true;

        // 策略 B: 深度检查 K8s spec.template.spec.volumes
        const volumes = vm?.spec?.template?.spec?.volumes;
        if (Array.isArray(volumes)) {
            const found = volumes.some((v: any) => v?.persistentVolumeClaim?.claimName === pvcName);
            if (found) return true;
        }

        return false;
      });
    }
  }), [vms]);

  // [系统盘识别辅助函数]
  const checkIsSystemDisk = useCallback((r: VolumeView, vm: any): boolean => {
    if (!vm) return false;
    
    const pvcName = r.name;
    const vmVolumes = Array.isArray(vm?.spec?.template?.spec?.volumes) ? vm.spec.template.spec.volumes : [];
    const vmDisks = Array.isArray(vm?.spec?.template?.spec?.domain?.devices?.disks)
      ? vm.spec.template.spec.domain.devices.disks
      : [];
    const volEntry = vmVolumes.find((v: any) => v?.persistentVolumeClaim?.claimName === pvcName);
    const volName = volEntry?.name || '';
    
    if (!volName) return false;
    
    const diskEntry = vmDisks.find((d: any) => d?.name === volName);
    if (!diskEntry || diskEntry.cdrom) return false;
    
    // 策略1: bootOrder === 1
    if (Number(diskEntry.bootOrder) === 1) return true;
    // 策略2: 名称为 'disk-0'
    if (volName === 'disk-0') return true;
    // 策略3: 名称为 'rootdisk'
    if (volName === 'rootdisk') return true;
    // 策略4: 如果只有一个非 CDROM 磁盘，则认为是系统盘
    const nonCdromDisks = vmDisks.filter((d: any) => !d.cdrom);
    if (nonCdromDisks.length === 1 && nonCdromDisks[0]?.name === volName) return true;
    
    return false;
  }, []);

  // ----------------------------------------------------------------
  // [数据处理] 归一化与视图转换
  // [标签] #数据处理 #数据转换 #useMemo
  // ----------------------------------------------------------------
  /**
   * [核心逻辑] dataSource - 数据源归一化
   * 
   * [功能]
   * 将后端返回的不一致数据格式转换为统一的 `VolumeView` 视图模型。
   * 
   * [处理步骤]
   * 1. 统一格式: 强制转换为 `VolumeView` 结构
   * 2. 状态修正: 结合 Conditions (如 Resizing) 生成更准确的状态
   * 3. 去重: 按 namespace/name 去重，防止列表 Key 冲突
   * 
   * [状态修正逻辑]
   * - 检查 `FileSystemResizePending` Condition → phase = 'FileSystemResizePending'
   * - 检查 `Resizing` Condition → phase = 'Resizing'
   * 
   * [位置] 第 325-388 行
   */
  const dataSource = useMemo<VolumeView[]>(() => {
    const rawList = Array.isArray(volumes) ? volumes : [];
    
    const mapped = rawList.map((r: any) => {
      // 优先使用 rawData (K8s Spec)，如果没有则使用外层字段
      const source = r?.rawData || r || {};
      
      const name = source?.metadata?.name || r?.name || '';
      const namespace = source?.metadata?.namespace || r?.namespace || '';
      const alias = source?.metadata?.annotations?.['tower.io/alias'] || '';
      
      const pvName = source?.spec?.volumeName || r?.volumeName || r?.pvcName || ''; 
      const storageClass = source?.spec?.storageClassName || r?.storageClassName || '';
      const accessModes = source?.spec?.accessModes || source?.status?.accessModes || r?.accessModes || [];
      const volumeMode = source?.spec?.volumeMode || r?.volumeMode || 'Block';

      let phase = source?.status?.phase || r?.phase || source?.status?.state || r?.state || 'Unknown';
      
      // [状态修正] 检查扩容相关的 Condition
      const conditions = source?.status?.conditions || r?.status?.conditions;
      if (Array.isArray(conditions)) {
          const isResizing = conditions.some((c: any) => c.type === 'Resizing' && c.status === 'True');
          const isFsPending = conditions.some((c: any) => c.type === 'FileSystemResizePending' && c.status === 'True');
          
          if (isFsPending) {
              phase = 'FileSystemResizePending';
          } else if (isResizing) {
              phase = 'Resizing';
          }
      }

      const capacityRaw = source?.status?.capacity?.storage || source?.spec?.resources?.requests?.storage || r?.size || r?.capacity || '';
      const attachedTo = Array.isArray(r?.attachedTo) ? r.attachedTo : [];

      return {
        key: source?.metadata?.uid || r?.id || `${namespace}/${name}`,
        name,
        alias,
        namespace,
        pvName,
        phase,
        capacityRaw: String(capacityRaw),
        capacityBytes: parseQuantity(capacityRaw),
        storageClass,
        accessModes: Array.isArray(accessModes) ? accessModes : [String(accessModes)],
        volumeMode,
        creationTimestamp: source?.metadata?.creationTimestamp || r?.created,
        attachedTo,
        links: r?.links,
        raw: r // 保留原始数据
      };
    }).filter(v => !!v.name); // 过滤无效数据

    // [去重逻辑] 按 namespace/name 去重
    const uniqueMap = new Map<string, VolumeView>();
    mapped.forEach(v => {
      const uniqKey = `${v.namespace}/${v.name}`;
      if (!uniqueMap.has(uniqKey)) {
        uniqueMap.set(uniqKey, v);
      }
    });
    
    return Array.from(uniqueMap.values());
  }, [volumes]);

  const onRefreshRef = useRef(onRefresh);
  onRefreshRef.current = onRefresh;

  const shouldPollVolumes = useMemo(
    () => dataSource.some((v) => isVolumePhaseTransitional(v.phase)),
    [dataSource],
  );

  const burstSeqRef = useRef(0);
  const burstRefreshVolumes = useCallback(() => {
    onRefresh?.(true);
    const seq = ++burstSeqRef.current;
    const delays = [700, 2000, 4500];
    delays.forEach((ms) => {
      window.setTimeout(() => {
        if (burstSeqRef.current !== seq) return;
        onRefresh?.(true);
      }, ms);
    });
  }, [onRefresh]);

  useEffect(() => {
    return () => {
      burstSeqRef.current += 1;
    };
  }, []);

  useEffect(() => {
    if (!shouldPollVolumes || !cloudId) return;
    const tick = () => {
      try {
        onRefreshRef.current?.(true);
      } catch {
        /* ignore */
      }
    };
    tick();
    const id = window.setInterval(tick, VOLUME_LIST_POLL_MS);
    return () => window.clearInterval(id);
  }, [shouldPollVolumes, cloudId]);

  // ----------------------------------------------------------------
  // [数据过滤] 列表筛选逻辑
  // [标签] #数据过滤 #筛选 #useMemo
  // ----------------------------------------------------------------
  const filteredData = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    const st = statusFilter.trim().toLowerCase();
    return dataSource.filter(item => {
      // 关键字搜索：支持匹配 3 个列（显示名称/ID/PV 名称）
      // - 显示名称列：alias 或 name
      // - 云盘ID：name（PVC metadata.name）
      // - PV 名称：pvName（PVC spec.volumeName）
      if (kw) {
        const alias = String(item.alias || '').toLowerCase();
        const name = String(item.name || '').toLowerCase();
        const pvName = String(item.pvName || '').toLowerCase();
        if (!alias.includes(kw) && !name.includes(kw) && !pvName.includes(kw)) return false;
      }
      // 状态筛选
      if (st && item.phase.toLowerCase() !== st) return false;
      
      // [系统资源过滤]
      // 系统卷 = 系统命名空间下的卷
      // 1. 租户模式: 强制过滤系统命名空间和公共命名空间
      if (isTenant) {
        if (isSystemNamespace(item.namespace) || isPublicNamespace(item.namespace)) return false;
      }
      
      // 2. 非租户模式: 只过滤系统命名空间
      if (!isTenant) {
        if (isSystemNamespace(item.namespace)) return false;
      }

      // 命名空间筛选（仅运维模式展示下拉，标准模式忽略 nsFilter 避免残留条件）
      if (hasOpsView && nsFilter && item.namespace !== nsFilter) return false;
      // 存储类筛选
      if (scFilter && item.storageClass !== scFilter) return false;

      return true;
    });
  }, [dataSource, keyword, statusFilter, nsFilter, scFilter, isTenant, hasOpsView, isPublicNamespace]);

  // 生成命名空间下拉选项
  const [fetchedNsOptions, setFetchedNsOptions] = useState<string[]>([]);
  const nsOptions = useMemo(() => {
    const set = new Set<string>();
    if (Array.isArray(namespacesOptions)) {
      namespacesOptions.forEach(ns => ns && set.add(ns));
    }
    (fetchedNsOptions || []).forEach(ns => ns && set.add(ns));
    if (set.size === 0) {
      dataSource.forEach(v => v.namespace && set.add(v.namespace));
      (vms || []).forEach((vm: any) => {
        const ns = vm?.extra?.namespace || vm?.namespace || vm?.Extra?.Namespace;
        if (ns) set.add(ns);
      });
      if (!isTenant && !set.has('default')) set.add('default');
    }
    let list = Array.from(set);
    if (isTenant) {
      list = list.filter(ns => !isSystemNamespace(ns) && !isPublicNamespace(ns));
    } else {
      // 管理员模式下，命名空间下拉默认排除系统命名空间
      list = list.filter(ns => !isSystemNamespace(ns));
    }
    return list.sort().map(s => ({ value: s, label: s }));
  }, [dataSource, vms, namespacesOptions, fetchedNsOptions, isTenant, isPublicNamespace]);

  const statusOptions = [
    'healthy','degraded','faulted','detached','attaching','attached','detaching','maintenance','restoring','creating','deleting','error','bound','pending','lost'
  ];

  // ----------------------------------------------------------------
  // [交互处理] 动作处理函数
  // [标签] #事件处理 #用户交互 #回调函数
  // ----------------------------------------------------------------
  
  /**
   * [处理函数] handleOpenVolumeDetail - 打开云盘详情抽屉
   * [标签] #详情查看 #云盘详情
   */
  const handleOpenVolumeDetail = useCallback((record: VolumeView, tab: string = 'detail') => {
    const raw = record.raw || {};
    if (!raw.kind) raw.kind = 'PersistentVolumeClaim';
    if (!raw.metadata) {
      raw.metadata = {
        name: record.name,
        namespace: record.namespace,
        uid: record.key,
        creationTimestamp: record.creationTimestamp,
      };
    }
    setDetailRecord(raw);
    setDetailActiveTab(tab);
    setDetailOpsMode(false);
    setDetailVisible(true);
  }, []);

  /**
   * [处理函数] handleOpenOpsDrawer - 打开运维信息抽屉
   * [标签] #运维信息 #抽屉
   */
  const handleOpenOpsDrawer = useCallback((record: VolumeView, tab: string = 'detail') => {
    const raw = record.raw || {};
    if (!raw.kind) raw.kind = 'PersistentVolumeClaim';
    if (!raw.metadata) {
      raw.metadata = {
        name: record.name,
        namespace: record.namespace,
        uid: record.key,
        creationTimestamp: record.creationTimestamp,
      };
    }
    setDetailRecord(raw);
    setDetailActiveTab(tab);
    setDetailOpsMode(true);
    setDetailVisible(true);
  }, []);

  /**
   * [处理函数] handleBatchDelete - 批量删除
   * [标签] #批量操作 #删除
   * 
   * [功能]
   * 批量删除选中的多个卷。
   * 
   * [位置] 第 485-507 行
   */
  const handleBatchDelete = () => {
    if (!ensureDisksWrite()) return;
    if (selectedRowKeys.length === 0) return;
    const targets = dataSource.filter(v => selectedRowKeys.includes(v.key));
    /** 与列表「云盘名称」列一致：优先展示别名 tower.io/alias，无别名则回退 PVC 名称 */
    const displayLabel = (t: VolumeView) => {
      const alias = String(t.alias ?? '').trim();
      return alias || t.name;
    };

    modal.confirm({
      title: '批量删除确认',
      content: `即将删除 ${targets.length} 个云盘：${targets.map(displayLabel).join(', ')}`,
      okText: '删除', cancelText: '取消', okButtonProps: { danger: true },
      onOk: async () => {
        try {
          const results = await Promise.allSettled(targets.map(t => deleteHarvesterVolume(cloudId, t.namespace, t.name)));
          const ok = results.filter((x: any) => {
            if (x.status === 'fulfilled') return true;
            const status = Number(x?.reason?.status || 0);
            const msg = String(x?.reason?.message || '').toLowerCase();
            return status === 404 || msg.includes('not found') || msg.includes('未找到');
          }).length;
          const fail = Math.max(0, results.length - ok);
          if (ok > 0) message.success(`成功删除 ${ok} 个云盘`);
          if (fail > 0) message.error(`${fail} 个云盘删除失败`);
          setSelectedRowKeys([]);
          burstRefreshVolumes();
        } catch (e: any) {
          message.error(e.message || '批量删除失败');
        }
      }
    });
  };

  /**
   * [处理函数] handleAttach - 打开挂载弹窗
   * [标签] #挂载 #弹窗
   * 
   * [功能]
   * 打开挂载弹窗，允许用户将卷挂载到虚拟机。
   * 
   * [位置] 第 512-527 行
   */
  const handleAttach = useCallback((r: VolumeView) => {
    if (!ensureDisksWrite()) return;
    // 防止页面刚加载完 VM 数据还没同步过来
    if (!vms || vms.length === 0) {
      onRefresh?.(true);
    }

    const vm = SafeRead.attachedVm(r);
    setCurrentRecord(r);
    setAttachInitialInstanceId(vm ? (vm.id || vm.InstanceId) : undefined);
    setAttachModalNonce((n) => n + 1);
    setAttachOpen(true);
  }, [vms, onRefresh, SafeRead, ensureDisksWrite]);

  const handleBranchCloneToCreateVolume = useCallback((seed: VolumeCreateSeed) => {
    setVolumeCreateSeed(seed);
    setCreateModalNonce((n) => n + 1);
    setCreateOpen(true);
  }, []);

  /**
   * [处理函数] handleDetach - 卸载卷
   * [标签] #卸载 #核心逻辑 #复杂处理
   * 
   * [功能]
   * 从虚拟机卸载卷。
   * 
   * [处理流程]
   * 1. 找到 VM: 确定卷挂载在哪台 VM 上
   * 2. 确定磁盘名: Harvester API 卸载时需要传 `diskName`
   *    - 磁盘名不一定是 PVC 的名字，可能是 VM 内部生成的随机名
   *    - 从 VM spec.template.spec.volumes 中查找
   *    - 或从 Extra.VolumeMap 中查找
   * 3. 兜底重启: 如果找不到磁盘名，提示用户重启 VM 来强制解绑
   * 
   * [位置] 第 537-614 行
   */
  const handleDetach = useCallback(async (r: VolumeView) => {
    if (!ensureDisksWrite()) return;
    // 1. 数据检查
    if (!vms || vms.length === 0) {
      onRefresh?.(true);
      message.loading('正在同步云主机数据，请稍后重试...', 1);
      return;
    }

    const vm = SafeRead.attachedVm(r);
    if (!vm) {
      message.warning('无法找到关联的云主机，请确认数据已同步');
      return;
    }
    
    // 2. 检查是否为系统盘
    if (checkIsSystemDisk(r, vm)) {
      message.warning('系统盘不支持通过此入口卸载，如需变更请使用重建/镜像等高级操作。');
      return;
    }
    
    // 3. 尝试解析磁盘名称 (diskName)
    const pvcName = r.name;
    const vmVolumes = Array.isArray(vm?.spec?.template?.spec?.volumes) ? vm.spec.template.spec.volumes : [];
    // 在 VM spec 里找对应 claimName 的卷
    const volEntry = vmVolumes.find((v: any) => v?.persistentVolumeClaim?.claimName === pvcName);
    const volName = volEntry?.name || '';
    // 或者从 Extra Map 里找
    const mappedName = vm?.Extra?.VolumeMap?.[pvcName] || '';
    const diskName = volName || mappedName || '';

    // 3. 如果找不到磁盘名，进入兜底流程 (提示重启)
    if (!diskName) {
      const iid = String(vm.InstanceId || '');
      modal.confirm({
        title: '无法确定挂载的磁盘名称',
        content: '请先在虚机内卸载该云盘（umount/移除磁盘），以避免数据损坏。是否重启虚拟机以完成卸载？',
        okText: '重启虚拟机',
        cancelText: '取消',
        onOk: async () => {
          try {
            const ns = vm?.metadata?.namespace || vm?.namespace || vm?.extra?.namespace || vm?.Extra?.Namespace || '';
            const name = vm?.name || vm?.metadata?.name || vm?.InstanceName || '';
            const resolvedId = iid ? iid : (ns && name ? `${ns}/${name}` : '');
            if (!resolvedId) { message.error('实例标识缺失，无法重启'); return; }
            await rebootCloudProviderEcs(cloudId, resolvedId);
            message.success('已触发重启');
          } catch (e: any) {
            message.error(e.message || '重启失败');
          }
        }
      });
      return;
    }

    // 4. 执行标准卸载
    const iid = String(vm.InstanceId || '');
    const ns = vm?.metadata?.namespace || vm?.namespace || vm?.extra?.namespace || vm?.Extra?.Namespace || '';
    const name = vm?.name || vm?.metadata?.name || vm?.InstanceName || '';
    const iidNameOnly = (iid && iid.includes('/')) ? iid.split('/').pop() : iid || name;
    const resolvedId = iid ? iid : (ns && name ? `${ns}/${name}` : iidNameOnly);

    modal.confirm({
      title: '确认卸载',
      content: `将从云主机 ${vm.InstanceName || vm.InstanceId} 卸载云盘 ${r.name}`,
      onOk: async () => {
        try {
          // 先试全名 ID，不行再试短 ID
          try {
            await detachHarvesterVolumeFromVm(cloudId, resolvedId, { name: String(diskName) });
          } catch (e: any) {
            if (String(e?.message).includes('NotFound')) {
              await detachHarvesterVolumeFromVm(cloudId, iidNameOnly!, { name: String(diskName) });
            } else {
              throw e;
            }
          }
          message.success('卸载成功');
          onRefresh?.(true);
        } catch (e: any) {
          message.error(e.message || '卸载失败');
        }
      }
    });
  }, [vms, onRefresh, SafeRead, cloudId, message, modal, checkIsSystemDisk, ensureDisksWrite]);

  // ----------------------------------------------------------------
  // [表格列配置] Table Columns
  // [标签] #表格配置 #列定义 #useMemo
  // ----------------------------------------------------------------
  const allColumns = useMemo(() => [
    { 
      title: '云盘名称 (PVC)', 
      dataIndex: 'name',
      key: 'name',
      fixed: 'left' as const,
      render: (_: string, r: VolumeView) => {
        const vm = SafeRead.attachedVm(r);
        const isSystemDisk = checkIsSystemDisk(r, vm);
        return (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, maxWidth: '100%', whiteSpace: 'nowrap' }}>
            <HddTwoTone style={{ display: 'inline-block', verticalAlign: 'middle' }}/>
            <span
              className="cell-link"
              onClick={() => handleOpenVolumeDetail(r, 'detail')}
              style={{ cursor: 'pointer', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, minWidth: 0 }}
            >
              {r.alias || r.name}
            </span>
            {isSystemDisk && <Tag color="blue" style={{ display: 'inline-block', verticalAlign: 'middle' }}>系统盘</Tag>}
          </span>
        );
      }
    },
    { 
      title: '云盘ID', 
      dataIndex: 'name',
      key: 'id', 
      render: (v: string) => <span className="text-secondary">{v}</span> 
    },
    ...(hasOpsView
      ? [
          {
            title: 'PV 名称',
            dataIndex: 'pvName',
            key: 'pvName',
            render: (v: string) => <span className="text-secondary">{v || '-'}</span>,
          },
        ]
      : []),
    { 
      title: '状态', 
      dataIndex: 'phase',
      key: 'phase', 
      render: (v: string) => statusBadge(v) 
    },
    ...(isTenant ? [] : [{ 
      title: '项目', 
      dataIndex: 'namespace',
      key: 'namespace' 
    }]),
    ...(hasOpsView
      ? [
          {
            title: '存储类',
            dataIndex: 'storageClass',
            key: 'storageClass',
            render: (v: string) => <span className="text-secondary">{v || '-'}</span>,
          },
        ]
      : []),
    { 
      title: '访问模式', 
      dataIndex: 'accessModes',
      key: 'accessModes',
      render: (modes: string[]) => {
        const list = Array.isArray(modes) ? modes : (modes ? [modes] : []);
        if (list.length === 0) return '-';
        return list.map((m) => {
          const raw = String(m || '');
          const k = raw.toLowerCase();
          let cls = 'std-badge std-badge-default';
          let text = raw;
          if (k === 'readwriteonce') {
            cls = 'std-badge std-badge-info';
            text = 'RWO';
          } else if (k === 'readwritemany') {
            cls = 'std-badge std-badge-success';
            text = 'RWX';
          } else if (k === 'readonlymany') {
            cls = 'std-badge std-badge-warning';
            text = 'ROX';
          }
          return (
            <span key={raw} className={cls} style={{ marginRight: 4 }}>
              {text}
            </span>
          );
        });
      }
    },
    { 
      title: '云盘类型', 
      dataIndex: 'volumeMode',
      key: 'volumeMode',
      render: (v: string) => <span className="text-secondary">{v || '-'}</span>
    },
    { 
      title: '挂载云主机', 
      key: 'attachedTo', 
      render: (_: any, r: VolumeView) => {
        const vm = SafeRead.attachedVm(r);
        if (vm) {
            // 优先显示别名，其次是 InstanceName 或 name
            const alias = vm.metadata?.annotations?.['tower.io/alias'];
            const name = alias || vm.name || vm.metadata?.name || vm.InstanceName || vm.InstanceId;
            return name;
        }
        return r.attachedTo.length > 0 ? r.attachedTo.join(', ') : '-';
      } 
    },
    { 
      title: '大小', 
      dataIndex: 'capacityBytes',
      key: 'size', 
      render: (bytes: number) => gbText(bytes) 
    },
    {
      title: '创建时间',
      dataIndex: 'creationTimestamp',
      key: 'creationTimestamp',
      sorter: (a: VolumeView, b: VolumeView) => {
        const ta = a?.creationTimestamp ? new Date(a.creationTimestamp).getTime() : 0;
        const tb = b?.creationTimestamp ? new Date(b.creationTimestamp).getTime() : 0;
        return ta - tb;
      },
      defaultSortOrder: 'descend' as const,
      render: (v: string) => <span className="text-secondary">{v ? new Date(v).toLocaleString() : '-'}</span>
    },
    { 
      title: '操作', 
      key: 'actions', 
      fixed: 'right' as const,
      render: (_: any, r: VolumeView) => {
        const vm = SafeRead.attachedVm(r);
        const isSystemDisk = checkIsSystemDisk(r, vm);

        const items: any[] = [
          // 1. 资源详情 / 运维信息
          ...(!isTenant && !isStandardView ? [
            { key: 'volume_detail', label: '云盘详情', onClick: () => handleOpenVolumeDetail(r, 'detail') },
            { key: 'detail', label: '查看YAML', onClick: () => handleOpenOpsDrawer(r, 'detail') },
          ] : []),
          
          // 2. 基础管理
          { 
            key: 'edit', 
            label: '编辑配置', 
            disabled: !hasDisksWrite,
            onClick: () => { 
              if (!ensureDisksWrite()) return;
              setCurrentRecord(r); 
              editForm.resetFields(); 
              editForm.setFieldsValue({ 
                sizeGi: r.capacityBytes / (1024**3)
              }); 
              setEditOpen(true); 
            } 
          },
          { 
            key: 'attach', 
            label: '挂载到虚拟机', 
            disabled: !!vm || !hasDisksWrite, 
            onClick: () => handleAttach(r) 
          },
          
          // 3. 数据操作
          { 
            key: 'export', 
            label: '导出为镜像', 
            disabled: !hasDisksWrite,
            onClick: () => { 
              if (!ensureDisksWrite()) return;
              setCurrentRecord(r); 
              exportForm.resetFields();
              const scNames = storageClasses.map((s: any) => s?.metadata?.name || s?.name).filter(Boolean);
              const defaultSc =
                defaultStorageClassName ||
                scNames.find((n: string) => n.toLowerCase() === 'longhorn') ||
                scNames.find((n: string) => n.toLowerCase().includes('longhorn')) ||
                scNames[0];
              exportForm.setFieldsValue({ displayName: r.name, targetStorageClassName: defaultSc }); 
              setExportOpen(true); 
            } 
          },
          { 
            key: 'snapshot', 
            label: '创建快照', 
            disabled: !hasDisksWrite,
            onClick: () => { 
              if (!ensureDisksWrite()) return;
              setCurrentRecord(r); 
              snapshotForm.resetFields(); 
              // 生成带随机后缀的快照名称以避免冲突
              const suffix = Math.random().toString(36).substring(2, 7);
              snapshotForm.setFieldsValue({ name: `${r.name}-snap-${suffix}` }); 
              setSnapshotOpen(true); 
            } 
          },
          { 
            key: 'clone', 
            label: '克隆云盘', 
            disabled: !hasDisksWrite,
            onClick: () => { 
              if (!ensureDisksWrite()) return;
              setCurrentRecord(r); 
              setCloneModalNonce((n) => n + 1);
              setCloneOpen(true); 
            } 
          },

          // 4. 风险操作
          { type: 'divider' as const },
          ...(vm ? [{ 
            key: 'detach', 
            label: '从云主机卸载', 
            danger: true, 
            disabled: isSystemDisk || !hasDisksWrite,
            onClick: () => handleDetach(r) 
          }] : []),
          { 
            key: 'delete', 
            label: '删除', 
            danger: true, 
            disabled: !hasDisksWrite,
            onClick: () => {
              if (!ensureDisksWrite()) return;
              const vm = SafeRead.attachedVm(r);
              const vmAlias = vm?.metadata?.annotations?.['tower.io/alias'];
              const vmTech = vm?.metadata?.name || vm?.name || '';
              const vmLabel = vm ? (vmAlias ? `${vmAlias}（${vmTech}）` : vmTech || '未知实例') : '';
              const diskLabel = r.alias ? `${r.alias}（${r.name}）` : r.name;
              modal.confirm({ 
                title: `确认删除云盘`, 
                content: (
                  <div>
                    <div style={{ marginBottom: 8 }}>云盘：{diskLabel}</div>
                    {vm ? (
                      <div style={{ color: '#d48806' }}>该云盘仍挂载在云主机：{vmLabel}，请先卸载后再删除。</div>
                    ) : null}
                    <div>删除后无法恢复。</div>
                  </div>
                ),
                okText: '确认', cancelText: '取消', 
                okButtonProps: { 
                  danger: true,
                  disabled: !!vm,
                  title: vm ? `该云盘已挂载到云主机：${vmLabel}，请先卸载后再删除` : undefined
                },
                onOk: async () => { 
                  try { 
                    await deleteHarvesterVolume(cloudId, r.namespace, r.name); 
                    message.success('删除成功'); 
                    burstRefreshVolumes(); 
                  } catch (e: any) { 
                    const raw = String(e?.message || '');
                    const useVmHint =
                      !!vm &&
                      (raw.includes('删除失败') ||
                        raw.includes('Forbidden') ||
                        /in use|using|attached|bound|mounted|被使用|引用/i.test(raw));
                    message.error(
                      useVmHint
                        ? `删除失败，当前云盘被云主机实例 ${vmLabel} 使用`
                        : raw || '删除失败',
                    );
                  } 
                } 
              });
            } 
          }
        ];
        return <ResourceActionsDropdown items={items} buttonProps={{ className: 'row-actions-trigger', disabled: !hasDisksWrite }} />;
      } 
    },
  ], [cloudId, storageClasses, defaultStorageClassName, burstRefreshVolumes, handleOpenVolumeDetail, handleOpenOpsDrawer, SafeRead, handleAttach, handleDetach, exportForm, snapshotForm, editForm, message, modal, isTenant, isStandardView, hasOpsView, checkIsSystemDisk, hasDisksWrite, ensureDisksWrite]);

  // 列显示设置（需要在 allColumns 定义之后）
  const { displayColumns: tableColumns } = useTableColumnSettings(allColumns, 'harvester_volumes_table', ['namespace', 'volumeMode']);

  // ----------------------------------------------------------------
  // [渲染] Render — 对应云详情「虚拟云盘」整页布局
  // ----------------------------------------------------------------
  return (
    <PageDetailSection
      asCard={false}
      toolbarLeft={(
        <>
          {/* 工具栏左：关键字 + 命名空间(运维) + 状态 + 重置 */}
          <Input 
            allowClear 
            placeholder="名称/ID" 
            suffix={<SearchOutlined style={{ color: 'rgba(0,0,0,.45)' }} />} 
            value={keyword} 
            onChange={(e) => setKeyword(e.target.value)} 
            className="toolbar-search" 
          />
          {!isTenant && hasOpsView && (
            <Select
              allowClear showSearch placeholder="项目"
              value={nsFilter || undefined} onChange={(v) => setNsFilter(v || '')}
              className="toolbar-filter-sm" options={[{ value: '', label: '全部' }, ...nsOptions]}
            />
          )}
          <Select
            allowClear placeholder="状态"
            value={statusFilter || undefined} onChange={(v) => setStatusFilter(v || '')}
            className="toolbar-filter-sm" options={[{ value: '', label: '全部' }, ...statusOptions.map(k => ({ value: k, label: cnStatus(k) }))]}
          />
          <button
            type="button"
            className="toolbar-reset-btn"
            onClick={() => {
              setKeyword('');
              setStatusFilter('');
              setNsFilter('');
              setScFilter('');
            }}
          >
            重置
          </button>
        </>
      )}
      toolbarRight={(
        <>
          {/* 工具栏右：创建、批量菜单、列设置、刷新 */}
          <Button type="primary" disabled={!hasDisksWrite} onClick={() => { 
            if (!ensureDisksWrite()) return;
            onRefreshStorageClasses?.(true, true);
            setVolumeCreateSeed(null);
            setCreateModalNonce((n) => n + 1);
            setCreateOpen(true); 
          }}>创建云盘</Button>
          <Tooltip
            title={
              !hasDisksWrite
                ? undefined
                : selectedRowKeys.length === 0
                  ? '请先选择云盘'
                  : undefined
            }
          >
            <span>
              <Dropdown
                trigger={["click"]}
                menu={{
                  items: [{ key: 'batchDelete', label: '批量删除', disabled: !hasDisksWrite || selectedRowKeys.length === 0, danger: true }],
                  onClick: ({ key }) => {
                    if (!hasDisksWrite) {
                      message.error('当前账号没有批量操作云盘的权限（需要 clouds.disks:write 或 clouds:write 权限）');
                      return;
                    }
                    if (selectedRowKeys.length === 0) {
                      message.warning('请先选择云盘');
                      return;
                    }
                    if (key === 'batchDelete') handleBatchDelete();
                  }
                }}
              >
                <Button icon={<EllipsisOutlined />} disabled={!hasDisksWrite || selectedRowKeys.length === 0} />
              </Dropdown>
            </span>
          </Tooltip>
          <TableColumnSettingsButton 
            allColumns={allColumns} 
            settingsKey="harvester_volumes_table"
            defaultHiddenColumns={['namespace', 'volumeMode']}
          />
          <Button 
            icon={<ReloadOutlined />} 
            onClick={async () => {
              // 优先刷新主数据（volumes），确保用户看到的主要数据先更新
              onRefresh?.(true);
              // 异步刷新命名空间列表（不影响主数据刷新），确保下拉选项包含最新数据
              // 使用 setTimeout 延迟执行，避免阻塞主数据刷新
              setTimeout(async () => {
                try {
                  const res: any = await fetchHarvesterNamespaces(cloudId, true, true);
                  const items: any[] = res?.data?.items || res?.items || [];
                  const list = items.map((x: any) => x?.metadata?.name || x?.name).filter((s: any) => !!s);
                  setFetchedNsOptions(list);
                } catch {}
              }, 100);
            }} 
            loading={loading} 
          />
        </>
      )}
    >
      {/* 主内容：云盘列表 */}
      <Table
        className="std-table"
        scroll={{ x: true }}
        bordered={false}
        rowKey="key"
        rowSelection={{
          selectedRowKeys,
          onChange: setSelectedRowKeys,
        }}
        columns={tableColumns}
        dataSource={filteredData}
        loading={loading}
        pagination={{
          showTotal: (total) => `共 ${total} 条`,
        }}
      />

      {/* 弹层区：创建卷（独立 modal 组件） */}
      <VolumeCreateModal
        open={createOpen}
        openNonce={createModalNonce}
        onCancel={() => {
          setCreateOpen(false);
          setVolumeCreateSeed(null);
        }}
        cloudId={cloudId}
        nsOptions={nsOptions}
        storageClassOptions={createVolumeStorageClassOptions}
        defaultStorageClassName={defaultStorageClassName}
        onNamespacesListFetched={(list) => setFetchedNsOptions(list)}
        onSuccess={onRefresh}
        seed={volumeCreateSeed}
      />

      <VolumeAttachModal
        open={attachOpen}
        openNonce={attachModalNonce}
        onCancel={() => setAttachOpen(false)}
        cloudId={cloudId}
        pvcNamespace={currentRecord?.namespace || ''}
        pvcName={currentRecord?.name || ''}
        vms={vms || []}
        initialInstanceId={attachInitialInstanceId}
        onSuccess={onRefresh}
      />

      {/* 从卷导出为 VirtualMachineImage */}
      <Modal
        title="导出为镜像"
        open={exportOpen}
        onCancel={() => setExportOpen(false)}
        onOk={() => exportForm.submit()}
        okText="导出"
        centered
        destroyOnHidden
        width={600}
        styles={{ body: { maxHeight: '80vh', overflowY: 'auto', overflowX: 'hidden' } }}
      >
        <Form
          form={exportForm}
          layout="vertical"
          onFinish={async (v: any) => {
            try {
              if (!currentRecord) return;
              await exportHarvesterImageFromVolume(cloudId, currentRecord.namespace, currentRecord.name, {
                displayName: v.displayName,
                targetStorageClassName: v.targetStorageClassName
              });
              message.success('导出镜像任务已提交，在云主机镜像列表能看到导出的镜像数据');
              setExportOpen(false);
              onRefreshImages?.(true, true);
            } catch (e: any) {
              message.error(e.message || '导出失败');
            }
          }}
        >
          <Form.Item label="镜像名称" name="displayName" rules={[{ required: true }]}><Input /></Form.Item>
          <Form.Item label="存储类" name="targetStorageClassName">
            <Select allowClear options={createVolumeStorageClassOptions} style={{ width: '100%' }} />
          </Form.Item>
        </Form>
      </Modal>

      {/* 创建 VolumeSnapshot */}
      <Modal
        title="创建快照"
        open={snapshotOpen}
        onCancel={() => setSnapshotOpen(false)}
        onOk={() => snapshotForm.submit()}
        okText="创建"
        centered
        destroyOnHidden
        width={600}
        styles={{ body: { maxHeight: '80vh', overflowY: 'auto', overflowX: 'hidden' } }}
      >
        <Form
          form={snapshotForm}
          layout="vertical"
          onFinish={async (v: any) => {
            try {
              if (!currentRecord) return;
              const id = `id-vs-${Math.random().toString(36).substring(2, 13)}`;
              await createHarvesterVolumeSnapshot(cloudId, currentRecord.namespace, currentRecord.name, {
                name: id,
                snapshotClassName: 'longhorn-snapshot',
                alias: v.name
              });
              message.success('创建成功');
              setSnapshotOpen(false);
              onRefresh?.(true, true);
            } catch (e: any) {
              message.error(e.message || '创建失败');
            }
          }}
        >
          <Form.Item rules={[{ required: true, message: '请输入快照名称' }]} label="快照名称" name="name"><Input placeholder="留空自动生成" /></Form.Item>
        </Form>
      </Modal>

      {/* 扩容（仅 Bound 等允许状态下可用） */}
      <Modal
        title="编辑配置"
        open={editOpen}
        onCancel={() => setEditOpen(false)}
        onOk={() => editForm.submit()}
        okText="保存"
        centered
        destroyOnHidden
        width={600}
        styles={{ body: { maxHeight: '80vh', overflowY: 'auto', overflowX: 'hidden' } }}
      >
        <Form
          form={editForm}
          layout="vertical"
          onFinish={async (v: any) => {
            try {
              if (!currentRecord) return;
              await updateHarvesterVolume(cloudId, currentRecord.namespace, currentRecord.name, {
                sizeGi: Number(v.sizeGi)
              });
              message.success('更新成功');
              setEditOpen(false);
              onRefresh?.(true, true);
            } catch (e: any) {
              message.error(e.message || '更新失败');
            }
          }}
        >
          <Form.Item label="容量(GB)" name="sizeGi" rules={[{ required: true }]}><InputNumber min={1} style={{ width: '100%' }} /></Form.Item>
        </Form>
      </Modal>

      <VolumeCloneModal
        open={cloneOpen}
        openNonce={cloneModalNonce}
        onCancel={() => setCloneOpen(false)}
        cloudId={cloudId}
        source={
          currentRecord
            ? {
                namespace: currentRecord.namespace,
                name: currentRecord.name,
                capacityBytes: currentRecord.capacityBytes,
                storageClass: currentRecord.storageClass,
                accessModes: currentRecord.accessModes,
                volumeMode: currentRecord.volumeMode,
              }
            : null
        }
        storageClasses={storageClasses}
        nsOptions={nsOptions}
        onCloneSuccess={() => onRefresh?.(true)}
        onBranchToCreateVolume={handleBranchCloneToCreateVolume}
      />

      {/* 云盘详情抽屉 + 运维 YAML（HarvesterVolumeDetailDrawer / HarvesterResourceDrawer） */}
      <HarvesterVolumeDetailDrawer
        open={detailVisible && !detailOpsMode}
        onClose={() => setDetailVisible(false)}
        record={detailRecord}
        cloudId={cloudId}
        activeTab={detailActiveTab}
        onTabChange={setDetailActiveTab}
      />
      <HarvesterResourceDrawer
        open={detailVisible && detailOpsMode}
        onClose={() => setDetailVisible(false)}
        resourceType="PersistentVolumeClaim"
        record={detailRecord}
        cloudId={cloudId}
        activeTab={detailActiveTab}
        onTabChange={setDetailActiveTab}
      />
    </PageDetailSection>
  );
};

export default VolumesSection;
