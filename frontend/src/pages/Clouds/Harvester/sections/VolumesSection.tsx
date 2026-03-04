/**
 * ==============================================================================
 * 模块名称: Harvester 虚拟卷 (Volume) 列表
 * 文件路径: src/pages/Clouds/Harvester/sections/VolumesSection.tsx
 * ==============================================================================
 * 
 * [功能描述]
 * 负责展示 Harvester 集群中的虚拟卷 (PVC) 资源，提供全生命周期管理功能。
 * 核心功能包括：
 * 1. 列表展示: 统一展示 PVC 的状态、容量、存储类、挂载 VM 等信息。
 * 2. 资源过滤: 支持按关键字、命名空间、状态、存储类筛选，并提供“显示系统卷”开关。
 * 3. 生命周期管理: 支持创建、克隆、扩容、删除、创建快照、导出镜像等操作。
 * 4. 挂载管理: 支持将卷挂载到虚拟机或从虚拟机卸载。
 * 
 * [核心逻辑]
 * 1. [视图模型 (ViewModel)]:
 *    - 定义 `VolumeView` 接口，将后端返回的复杂 K8s PVC 对象 (Raw/Wrapped) 转换为扁平化的前端视图数据。
 *    - 统一处理容量单位 (Bytes/GiB)、状态映射 (Phase)、挂载关系 (AttachedTo)。
 * 2. [系统资源过滤]:
 *    - 默认过滤掉 Harvester/Longhorn 等系统命名空间的卷 (依赖 `isSystemNamespace`)。
 *    - 默认过滤掉系统存储类 (依赖 `isSystemStorageClass`)。
 *    - 提供 Checkbox 开关允许用户查看系统级资源。
 * 3. [关联查询]:
 *    - 利用 `SafeRead.attachedVm` 和传入的 `vms` 列表，自动反查卷当前挂载的虚拟机名称。
 *    - 在列表中生成指向 VM 详情页的链接。
 * 4. [操作权限]:
 *    - 根据卷的状态 (Bound/Available/In-use) 动态禁用或启用特定操作按钮 (如仅 Bound 状态可扩容)。
 * 
 * ------------------------------------------------------------------------------
 * [交互/依赖说明]
 * ------------------------------------------------------------------------------
 * 1. 上游数据: 
 *    - 依赖 `CloudDetailHarvester` 传入 `volumes`, `vms`, `storageClasses` 数据。
 * 2. 下游接口: 
 *    - 调用 `harvesterApi` 执行实际的 CRUD 和挂载/卸载操作。
 * 3. 复用组件: 
 *    - `HarvesterResourceDrawer` 展示详情。
 *    - `ResourceActionsDropdown` 展示操作菜单。
 * ==============================================================================
 */

import React, { useMemo, useState, useEffect, useCallback } from 'react';
import { Table, Input, Select, Button, Dropdown, Modal, Form, App, InputNumber, Checkbox, Tabs, Badge } from 'antd';
import { rebootCloudProviderEcs } from '../../../../services/api';
import StdFormModal from '../../../../components/StdFormModal';
import { EllipsisOutlined, ReloadOutlined, SyncOutlined, ExclamationCircleOutlined } from '@ant-design/icons';
import PageDetailSection from '../../../../components/PageDetailSection';
import ResourceActionsDropdown from '../../../../components/ResourceActionsDropdown';
import { attachHarvesterVolumeToVmByName, detachHarvesterVolumeFromVm, deleteHarvesterVolume, createHarvesterVolume, exportHarvesterImageFromVolume, createHarvesterVolumeSnapshot, updateHarvesterVolume, cloneHarvesterVolume } from '../../../../services/harvesterApi';
import TableColumnSettings from '../../../../components/TableColumnSettings';

import HarvesterResourceDrawer from '../components/HarvesterOpsinfoDrawer';

import { isSystemNamespace, isSystemStorageClass, isPublicNamespace } from '../../../../utils/harvesterUtils';

/**
 * [组件参数定义]
 * 定义组件从外部接收的数据源和回调。
 *
 * @property cloudId           云平台 ID（用于调用 Harvester 相关 API）
 * @property volumes           后端返回的卷列表（PVC 或包装对象），作为原始数据源
 * @property loading           上层传入的加载状态，用于控制表格 / 刷新按钮的 loading
 * @property vms               当前集群中云主机列表，用于反查卷挂载到哪台 VM
 * @property storageClasses    存储类列表（StorageClass），用于创建/导出卷时提供下拉选项
 * @property namespacesOptions 可选的命名空间选项（如果不给，则从数据中推导）
 * @property onRefresh         触发上层重新拉取 volumes / vms 等数据的回调
 */
type Props = {
  cloudId: string;
  volumes: any[];
  loading: boolean;
  vms?: any[];
  storageClasses?: any[];
  namespacesOptions?: string[];
  onRefresh?: (force?: boolean) => void;
  bordered?: boolean; // 表格边框控制
  showYaml?: boolean; // 控制是否显示资源详情抽屉入口 (租户侧可能不需要看底层YAML/详情)
  showSys?: boolean;  // 控制是否显示"显示系统卷"复选框
  isTenant?: boolean; // 是否为租户模式 (租户模式下强制过滤系统和公共卷)
};

// ==============================================================================
// 1. 视图模型定义 (ViewModel)
// ==============================================================================

/**
 * [类型定义] VolumeView 前端统一视图模型
 * 
 * 为什么需要这个模型？
 * 后端返回的数据结构可能不一致（有时是原生 K8s 对象，有时是经过包装的对象）。
 * 我们在这里定义一个标准结构，把混乱的数据“洗”干净，给表格组件使用。
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
// 2. 辅助工具函数 (Helpers)
// ==============================================================================

/**
 * [辅助工具] K8s 容量单位解析
 * 把 "10Gi", "500Mi" 这种字符串转换成具体的字节数 (number)。
 * 方便后续进行数值排序和格式化。
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
 * [辅助工具] 格式化容量文本
 * 把字节数转换成人类可读的 "xx.xx GB" 格式。
 */
const gbText = (bytes: number): string => {
  if (!bytes || bytes <= 0) return '-';
  const gb = bytes / (1024 * 1024 * 1024);
  return `${gb.toFixed(2)} GB`;
};

/**
 * [辅助工具] 状态汉化映射
 * 把 K8s 的英文状态 (Bound, Lost) 翻译成中文，用于筛选框展示。
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
 * [辅助工具] 状态徽标渲染
 * 根据卷的状态显示不同颜色的徽标 (Badge)。
 * - 绿色: 正常/已绑定
 * - 红色: 丢失/错误
 * - 蓝色: 处理中/创建中
 * - 黄色: 警告
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

// ==============================================================================
// 3. 主组件 (Component)
// ==============================================================================

const VolumesSection: React.FC<Props> = ({ 
  cloudId, 
  volumes, 
  loading, 
  vms, 
  storageClasses: propStorageClasses, 
  namespacesOptions, 
  onRefresh, 
  bordered = true, 
  showYaml = true, 
  showSys = true,
  isTenant
}) => {
  // ----------------------------------------------------------------
  // 状态管理 (State)
  // ----------------------------------------------------------------
  
  // 过滤条件
  const [keyword, setKeyword] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [nsFilter, setNsFilter] = useState<string>('');
  const [scFilter, setScFilter] = useState<string>('');
  const [showSystemVolumes, setShowSystemVolumes] = useState<boolean>(false);
  
  // 批量操作选中项
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([]);

  // 弹窗可见性控制
  const [createOpen, setCreateOpen] = useState(false);
  const [attachOpen, setAttachOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [snapshotOpen, setSnapshotOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [cloneOpen, setCloneOpen] = useState(false);
  
  // 详情抽屉控制
  const [detailVisible, setDetailVisible] = useState(false);
  const [detailRecord, setDetailRecord] = useState<any>(null);
  const [detailActiveTab, setDetailActiveTab] = useState('detail');

  const { message, modal } = App.useApp();

  // 表单实例
  const [createForm] = Form.useForm();
  const [attachForm] = Form.useForm();
  const [exportForm] = Form.useForm();
  const [snapshotForm] = Form.useForm();
  const [editForm] = Form.useForm();
  const [cloneForm] = Form.useForm();

  // 当前操作对象与辅助状态
  const [currentRecord, setCurrentRecord] = useState<VolumeView | null>(null);
  const [creating, setCreating] = useState(false);                 
  const [storageClasses, setStorageClasses] = useState<any[]>([]); 
  const [tableColumns, setTableColumns] = useState<any[]>([]);     

  // 同步外部传入的 storageClasses
  useEffect(() => {
    if (propStorageClasses) setStorageClasses(propStorageClasses);
  }, [propStorageClasses]);

  // ----------------------------------------------------------------
  // [安全读取工具] SafeRead
  // ----------------------------------------------------------------
  /**
   * SafeRead 对象封装了所有从 raw 数据中提取字段的逻辑。
   * 
   * [核心逻辑] 挂载虚拟机反查 (attachedVm)
   * 为什么需要这个？
   * - PVC 对象本身通常只记录“被谁使用了”，但不一定包含 VM 的名字。
   * - 我们需要遍历所有 VM，检查 VM 的 Volume 列表里有没有包含当前 PVC 的名字。
   * - 匹配规则：Namespace 必须相同，且 ClaimName 必须匹配。
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

  // ----------------------------------------------------------------
  // [数据处理] 归一化与视图转换
  // ----------------------------------------------------------------
  /**
   * [核心逻辑] 数据源归一化 (dataSource)
   * 
   * 为什么要这么做？
   * 1. 统一格式: 后端返回的数据格式可能不统一，这里强制转成 `VolumeView`。
   * 2. 状态修正: K8s 的 Phase 字段有时不够详细，我们需要结合 Conditions (如 Resizing) 来生成更准确的状态。
   * 3. 去重: 防止后端返回重复数据导致列表 Key 冲突。
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

  // ----------------------------------------------------------------
  // [数据过滤] 列表筛选逻辑
  // ----------------------------------------------------------------
  const filteredData = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    const st = statusFilter.trim().toLowerCase();
    return dataSource.filter(item => {
      // 关键字搜索
      if (kw && !item.name.toLowerCase().includes(kw)) return false;
      // 状态筛选
      if (st && item.phase.toLowerCase() !== st) return false;
      
      // [系统资源过滤]
      // 1. 如果是租户模式 (isTenant=true)，强制过滤系统命名空间和公共命名空间
      if (isTenant) {
        if (isSystemNamespace(item.namespace) || isPublicNamespace(item.namespace)) return false;
      }
      
      // 2. 如果用户没有勾选“显示系统卷”，则隐藏系统命名空间的卷 (仅针对非租户场景或补充过滤)
      // 注意：租户场景下 showSystemVolumes 应该被忽略或强制为 false
      if (!isTenant && !showSystemVolumes && isSystemNamespace(item.namespace)) return false;

      // 命名空间筛选
      if (nsFilter && item.namespace !== nsFilter) return false;
      // 存储类筛选
      if (scFilter && item.storageClass !== scFilter) return false;

      return true;
    });
  }, [dataSource, keyword, statusFilter, nsFilter, scFilter, showSystemVolumes]);

  // 生成命名空间下拉选项
  const nsOptions = useMemo(() => {
    const set = new Set<string>();

    if (Array.isArray(namespacesOptions)) {
      namespacesOptions.forEach(ns => ns && set.add(ns));
    }

    if (set.size === 0) {
      dataSource.forEach(v => v.namespace && set.add(v.namespace));
      (vms || []).forEach((vm: any) => {
        const ns = vm?.extra?.namespace || vm?.namespace || vm?.Extra?.Namespace;
        if (ns) set.add(ns);
      });
      // 仅在非租户模式下添加 default
      if (!isTenant && !set.has('default')) set.add('default');
    }
    
    let list = Array.from(set);
    
    if (isTenant) {
      list = list.filter(ns => !isSystemNamespace(ns) && !isPublicNamespace(ns));
    } else if (!isTenant && !showSystemVolumes) {
      list = list.filter(ns => !isSystemNamespace(ns));
    }
    
    return list.sort().map(s => ({ value: s, label: s }));
  }, [dataSource, vms, showSystemVolumes, namespacesOptions, isTenant]);

  const statusOptions = [
    'healthy','degraded','faulted','detached','attaching','attached','detaching','maintenance','restoring','creating','deleting','error','bound','pending','lost'
  ];

  // ----------------------------------------------------------------
  // [交互处理] 动作处理函数
  // ----------------------------------------------------------------
  
  /**
   * 打开资源详情抽屉
   * 
   * [注意]
   * 我们必须确保传入的对象包含 `kind` 和 `metadata`，
   * 否则抽屉组件无法正确请求 K8s 事件 API。
   */
  const handleOpenDrawer = useCallback(async (record: VolumeView, tab: string = 'detail') => {
    const raw = record.raw || {};
    if (!raw.kind) raw.kind = 'PersistentVolumeClaim';
    if (!raw.metadata) {
      raw.metadata = {
        name: record.name,
        namespace: record.namespace,
        uid: record.key,
        creationTimestamp: record.creationTimestamp
      };
    }

    setDetailRecord(raw);
    setDetailActiveTab(tab);
    setDetailVisible(true);
  }, []);

  /**
   * 批量删除
   */
  const handleBatchDelete = () => {
    if (selectedRowKeys.length === 0) return;
    const targets = dataSource.filter(v => selectedRowKeys.includes(v.key));
    
    modal.confirm({
      title: '批量删除确认',
      content: `即将删除 ${targets.length} 个卷：${targets.map(t => t.name).join(', ')}`,
      okText: '删除', cancelText: '取消', okButtonProps: { danger: true },
      onOk: async () => {
        try {
          const results = await Promise.allSettled(targets.map(t => deleteHarvesterVolume(cloudId, t.namespace, t.name)));
          const ok = results.filter(x => x.status === 'fulfilled').length;
          const fail = results.length - ok;
          if (ok > 0) message.success(`成功删除 ${ok} 个卷`);
          if (fail > 0) message.error(`${fail} 个卷删除失败`);
          setSelectedRowKeys([]);
          onRefresh?.(true);
        } catch (e: any) {
          message.error(e.message || '批量删除失败');
        }
      }
    });
  };

  /**
   * 打开挂载弹窗
   */
  const handleAttach = useCallback((r: VolumeView) => {
    // 防止页面刚加载完 VM 数据还没同步过来
    if (!vms || vms.length === 0) {
      onRefresh?.(true);
    }

    const vm = SafeRead.attachedVm(r);
    setCurrentRecord(r);
    attachForm.resetFields();
    attachForm.setFieldsValue({ 
      instanceId: vm ? vm.InstanceId : undefined, 
      diskName: r.name, 
      bus: 'virtio' 
    });
    setAttachOpen(true);
  }, [vms, onRefresh, SafeRead, attachForm]);

  /**
   * [核心逻辑] 卸载卷 (Detach)
   * 
   * 为什么这里逻辑这么复杂？
   * 1. 找到 VM: 首先得知道卷挂在哪个 VM 上。
   * 2. 确定磁盘名: Harvester API 卸载时需要传 `diskName`，这不一定是 PVC 的名字，可能是 VM 内部生成的随机名。
   * 3. 兜底重启: 如果实在找不到磁盘名，说明状态可能不一致，最安全的做法是让用户去 VM 内部卸载或者重启 VM 来强制解绑。
   */
  const handleDetach = useCallback(async (r: VolumeView) => {
    // 1. 数据检查
    if (!vms || vms.length === 0) {
      onRefresh?.();
      message.loading('正在同步云主机数据，请稍后重试...', 1);
      return;
    }

    const vm = SafeRead.attachedVm(r);
    if (!vm) {
      message.warning('无法找到关联的云主机，请确认数据已同步');
      return;
    }
    
    // 2. 尝试解析磁盘名称 (diskName)
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
        content: '请先在虚机内卸载该卷（umount/移除磁盘），以避免数据损坏。是否重启虚拟机以完成卸载？',
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
      content: `将从云主机 ${vm.InstanceName || vm.InstanceId} 卸载卷 ${r.name}`,
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
  }, [vms, onRefresh, SafeRead, cloudId, message, modal]);

  // ----------------------------------------------------------------
  // [表格列配置]
  // ----------------------------------------------------------------
  const allColumns = useMemo(() => [
    { 
      title: 'PVC名称', 
      dataIndex: 'name',
      key: 'name', 
      render: (_: string, r: VolumeView) => (
        showYaml ? (
          <span className="cell-link" onClick={() => handleOpenDrawer(r, 'detail')}>
            {r.alias || r.name}
          </span> 
        ) : (
          <span>{r.alias || r.name}</span>
        )
      )
    },
    { 
      title: 'PVC ID', 
      dataIndex: 'name',
      key: 'id', 
      render: (v: string) => <span className="text-secondary">{v}</span> 
    },
    { 
      title: '卷名称 (PV)', 
      dataIndex: 'pvName',
      key: 'pvName', 
      render: (v: string) => <span className="text-secondary">{v || '-'}</span> 
    },
    { 
      title: '状态', 
      dataIndex: 'phase',
      key: 'phase', 
      render: (v: string) => statusBadge(v) 
    },
    { 
      title: '命名空间', 
      dataIndex: 'namespace',
      key: 'namespace' 
    },
    { 
      title: '存储类', 
      dataIndex: 'storageClass',
      key: 'storageClass',
      render: (v: string) => <span className="text-secondary">{v || '-'}</span>
    },
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
      title: '卷类型', 
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
      title: '操作', 
      key: 'actions', 
      width: 80,
      fixed: 'right' as const,
      render: (_: any, r: VolumeView) => {
        const vm = SafeRead.attachedVm(r);
        
        const items: any[] = [
          // 1. 资源详情
          ...(showYaml ? [{ key: 'detail', label: '查看YAML', onClick: () => handleOpenDrawer(r, 'detail') }] : []),
          
          // 2. 基础管理
          { 
            key: 'edit', 
            label: '编辑配置', 
            onClick: () => { 
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
            disabled: !!vm, 
            onClick: () => handleAttach(r) 
          },
          
          // 3. 数据操作
          { 
            key: 'export', 
            label: '导出为镜像', 
            onClick: () => { 
              setCurrentRecord(r); 
              exportForm.resetFields(); 
              const scNames = storageClasses.map(s => s?.metadata?.name || s?.name).filter(Boolean);
              const defaultSc = scNames.find(n => n.toLowerCase() === 'longhorn') || scNames.find(n => n.toLowerCase().includes('longhorn')) || scNames[0];
              exportForm.setFieldsValue({ displayName: r.name, targetStorageClassName: defaultSc }); 
              setExportOpen(true); 
            } 
          },
          { 
            key: 'snapshot', 
            label: '创建快照', 
            onClick: () => { 
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
            label: '克隆虚拟卷', 
            onClick: () => { 
              setCurrentRecord(r); 
              cloneForm.resetFields(); 
              cloneForm.setFieldsValue({ 
                cloneData: true, 
                newName: `${r.name}-clone`
              }); 
              setCloneOpen(true); 
            } 
          },

          // 4. 风险操作
          { type: 'divider' as const },
          ...(vm ? [{ 
            key: 'detach', 
            label: '从云主机卸载', 
            danger: true, 
            onClick: () => handleDetach(r) 
          }] : []),
          { 
            key: 'delete', 
            label: '删除', 
            danger: true, 
            onClick: () => {
              modal.confirm({ 
                title: `确认删除卷 ${r.name}？`, 
                content: '删除后无法恢复。', 
                okText: '确认', cancelText: '取消', okButtonProps: { danger: true },
                onOk: async () => { 
                  try { 
                    await deleteHarvesterVolume(cloudId, r.namespace, r.name); 
                    message.success('删除成功'); 
                    onRefresh?.(); 
                  } catch (e: any) { 
                    message.error(e.message || '删除失败'); 
                  } 
                } 
              });
            } 
          }
        ];
        return <ResourceActionsDropdown items={items} buttonProps={{ className: 'row-actions-trigger' }} />;
      } 
    },
  ], [cloudId, vms, storageClasses, onRefresh, handleOpenDrawer, SafeRead, handleAttach, handleDetach, exportForm, snapshotForm, cloneForm, editForm, message, modal, showYaml]);

  // ----------------------------------------------------------------
  // [渲染]
  // ----------------------------------------------------------------
  return (
    <PageDetailSection
      asCard={false}
      toolbarLeft={(
        <>
          <Input allowClear placeholder="关键字" value={keyword} onChange={(e) => setKeyword(e.target.value)} className="toolbar-search" />
          <Select
            allowClear showSearch placeholder="命名空间"
            value={nsFilter || undefined} onChange={(v) => setNsFilter(v || '')}
            className="toolbar-filter-sm" options={[{ value: '', label: '全部' }, ...nsOptions]}
          />
          <Select
            allowClear placeholder="状态"
            value={statusFilter || undefined} onChange={(v) => setStatusFilter(v || '')}
            className="toolbar-filter-sm" options={[{ value: '', label: '全部' }, ...statusOptions.map(k => ({ value: k, label: cnStatus(k) }))]}
          />
          <Select
            allowClear showSearch placeholder="存储类"
            value={scFilter || undefined} onChange={(v) => setScFilter(v || '')}
            className="toolbar-filter" 
            options={[{ value: '', label: '全部' }, ...dataSource.map(v => v.storageClass).filter(Boolean).filter((v, i, a) => a.indexOf(v) === i).map(s => ({ value: s, label: s }))]}
          />
          {!isTenant && (
            <div style={{ display: 'flex', alignItems: 'center' }}>
              <Checkbox 
                checked={showSystemVolumes} 
                onChange={(e: any) => setShowSystemVolumes(e.target.checked)}
              >
                显示系统资源
              </Checkbox>
            </div>
          )}
        </>
      )}
      toolbarRight={(
        <>
          <Button type="primary" onClick={() => { 
            createForm.resetFields(); 
            const scNames = storageClasses.map(s => s?.metadata?.name || s?.name).filter(Boolean);
            // 优先选择 longhorn，然后选择包含 longhorn 的存储类
            let defaultSc = scNames.find(n => n.toLowerCase() === 'longhorn');
            if (!defaultSc) {
              defaultSc = scNames.find(n => n.toLowerCase().includes('longhorn')) || scNames[0];
            }
            const defaultNs = nsOptions.length > 0 ? nsOptions[0].value : undefined;
            
            createForm.setFieldsValue({ 
              alias: '',
              namespace: defaultNs,
              sizeGi: undefined,
              accessModes: 'ReadWriteMany',
              volumeMode: 'Block',
              storageClassName: defaultSc
            }); 
            setCreateOpen(true); 
          }}>创建卷</Button>
          <Dropdown
            trigger={["click"]}
            menu={{
              items: [{ key: 'batchDelete', label: '批量删除', disabled: selectedRowKeys.length === 0, danger: true }],
              onClick: ({ key }) => key === 'batchDelete' && handleBatchDelete()
            }}
          >
            <Button icon={<EllipsisOutlined />} />
          </Dropdown>
          <TableColumnSettings 
            columns={allColumns} 
            onChange={setTableColumns}
            settingsKey="harvester_volumes_table"
            defaultHiddenColumns={['namespace', 'volumeMode']}
          />
          <Button icon={<ReloadOutlined />} onClick={() => onRefresh?.(true)} loading={loading} />
        </>
      )}
    >
      <Table
        className={bordered ? "std-table" : "std-table no-border"}
        bordered={bordered}
        rowKey="key"
        rowSelection={{
          selectedRowKeys,
          onChange: setSelectedRowKeys,
        }}
        columns={tableColumns}
        dataSource={filteredData}
        loading={loading}
        scroll={{ x: 'max-content' }}
        pagination={{
          size: 'small',
          showQuickJumper: false,
        }}
      />

      {/* --- 弹窗组件区域 --- */}
      
      {/* 1. 创建卷弹窗 */}
      <StdFormModal
        title="创建卷" open={createOpen} onCancel={() => setCreateOpen(false)} confirmLoading={creating}
        okText="创建"
        form={createForm}
        onFinish={async (v: any) => {
          try {
            setCreating(true);
            const modes = Array.isArray(v.accessModes) ? v.accessModes : (v.accessModes ? [v.accessModes] : ['ReadWriteMany']);
            
            // 生成随机 ID: id-vol-{11 chars}
            let suffix = Math.random().toString(36).substring(2);
            while (suffix.length < 11) suffix += Math.random().toString(36).substring(2);
            suffix = suffix.substring(0, 11);
            const customId = `id-vol-${suffix}`;

            const payload = {
              namespace: String(v.namespace || ''),
              name: customId,
              sizeGi: Number(v.sizeGi || 0),
              accessModes: modes,
              volumeMode: String(v.volumeMode || 'Block'),
              storageClassName: String(v.storageClassName || '') || undefined,
              annotations: {
                'tower.io/alias': v.alias || ''
              }
            };
            await createHarvesterVolume(cloudId, payload);
            message.success('创建成功');
            setCreateOpen(false);
            onRefresh?.();
          } catch (e: any) { message.error(e.message || '创建失败'); }
          finally { setCreating(false); }
        }}
      >
          <Form.Item label="别名" name="alias" rules={[{ required: true }]}><Input placeholder="例如: 测试pvc" /></Form.Item>
          <Form.Item label="命名空间" name="namespace" rules={[{ required: true }]}>
            <Select showSearch options={nsOptions} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item label="容量(GB)" name="sizeGi" rules={[{ required: true }]}><InputNumber min={1} style={{ width: '100%' }} /></Form.Item>
          <Form.Item label="访问模式" name="accessModes" initialValue="ReadWriteMany">
            <Select options={[{ value: 'ReadWriteOnce', label: 'RWO' }, { value: 'ReadWriteMany', label: 'RWX' }, { value: 'ReadOnlyMany', label: 'ROX' }]} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item label="卷类型" name="volumeMode" initialValue="Block">
            <Select options={[{ value: 'Block', label: 'Block' }, { value: 'Filesystem', label: 'Filesystem' }]} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item label="存储类" name="storageClassName">
            <Select allowClear options={storageClasses.map(s => {
              const n = s?.metadata?.name || s?.name;
              return { value: n, label: n };
            }).filter(x => x.value && !isSystemStorageClass(x.value))} style={{ width: '100%' }} />
          </Form.Item>
      </StdFormModal>

      {/* 2. 挂载弹窗 */}
      <StdFormModal
        title="挂载到云主机" open={attachOpen} onCancel={() => setAttachOpen(false)}
        okText="挂载"
        form={attachForm}
        onFinish={async (v: any) => {
          try {
            if (!currentRecord) return;
            const vm = (vms || []).find((x: any) => (x.id || x.InstanceId) === v.instanceId);
            if (!vm) { message.error('未找到云主机'); return; }
            
            const vmName = vm.name || vm.InstanceName || '';
            const iid = String(vm.id || vm.InstanceId || '');
            const finalName = vmName || (iid.includes('/') ? iid.split('/').pop() : iid);

            if (!finalName) { message.error('云主机名称无效'); return; }

            // 生成安全的磁盘名
            const computedDiskName = (currentRecord.name).replace(/[^a-z0-9-]/gi, '-').toLowerCase().slice(0, 63);

            await attachHarvesterVolumeToVmByName(cloudId, currentRecord.namespace, finalName, {
              diskName: computedDiskName,
              bus: v.bus || 'virtio',
              pvcNamespace: currentRecord.namespace,
              pvcName: currentRecord.name
            });
            message.success('挂载成功');
            setAttachOpen(false);
            onRefresh?.(true);
          } catch (e: any) { message.error(e.message || '挂载失败'); }
        }}
      >
          <Form.Item label="云主机" name="instanceId" rules={[{ required: true }]}>
            <Select showSearch placeholder="选择云主机" options={(vms || [])
              .filter((vm: any) => {
                const extra = vm?.extra || vm?.Extra || {};
                const vmNs = extra.namespace || vm.namespace || extra.Namespace;
                return vmNs === currentRecord?.namespace;
              })
              .map((vm: any) => ({ value: vm.id || vm.InstanceId, label: vm.name || vm.InstanceName || vm.id || vm.InstanceId }))} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item label="总线" name="bus" initialValue="virtio">
            <Select options={['virtio', 'sata', 'scsi'].map(v => ({ value: v, label: v }))} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item label="PVC"><Input value={currentRecord?.name} disabled /></Form.Item>
      </StdFormModal>

      {/* 3. 导出镜像弹窗 */}
      <StdFormModal
        title="导出为镜像" open={exportOpen} onCancel={() => setExportOpen(false)}
        okText="导出"
        form={exportForm}
        onFinish={async (v: any) => {
          try {
            if (!currentRecord) return;
            await exportHarvesterImageFromVolume(cloudId, currentRecord.namespace, currentRecord.name, {
              displayName: v.displayName,
              targetStorageClassName: v.targetStorageClassName
            });
            message.success('任务已提交');
            setExportOpen(false);
          } catch (e: any) { message.error(e.message || '导出失败'); }
        }}
      >
          <Form.Item label="镜像名称" name="displayName" rules={[{ required: true }]}><Input /></Form.Item>
          <Form.Item label="存储类" name="targetStorageClassName"><Select allowClear options={storageClasses.map(s => {
            const n = s?.metadata?.name || s?.name;
            return { value: n, label: n };
          }).filter(x => x.value && !isSystemStorageClass(x.value))} style={{ width: '100%' }} /></Form.Item>
      </StdFormModal>

      {/* 4. 创建快照弹窗 */}
      <StdFormModal
        title="创建快照" open={snapshotOpen} onCancel={() => setSnapshotOpen(false)}
        okText="创建"
        form={snapshotForm}
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
          } catch (e: any) { message.error(e.message || '创建失败'); }
        }}
      >
          <Form.Item label="快照名称" name="name"><Input placeholder="留空自动生成" /></Form.Item>
      </StdFormModal>

      {/* 5. 编辑弹窗 */}
      <StdFormModal
        title="编辑配置" open={editOpen} onCancel={() => setEditOpen(false)}
        okText="保存"
        form={editForm}
        onFinish={async (v: any) => {
          try {
            if (!currentRecord) return;
            await updateHarvesterVolume(cloudId, currentRecord.namespace, currentRecord.name, {
              sizeGi: Number(v.sizeGi)
            });
            message.success('更新成功');
            setEditOpen(false);
            onRefresh?.();
          } catch (e: any) { message.error(e.message || '更新失败'); }
        }}
      >
          <Form.Item label="容量(GB)" name="sizeGi" rules={[{ required: true }]}><InputNumber min={1} style={{ width: '100%' }} /></Form.Item>
      </StdFormModal>

      {/* 6. 克隆弹窗 */}
      <StdFormModal
        title="克隆虚拟卷" open={cloneOpen} onCancel={() => setCloneOpen(false)}
        okText="创建"
        form={cloneForm}
        onFinish={async (v: any) => {
          try {
            if (!currentRecord) return;
            
            // 根据是否勾选克隆数据使用不同的API传参
            if (v.cloneData) {
              // 克隆虚拟卷数据 - 传递与原卷一致的参数
              await cloneHarvesterVolume(cloudId, currentRecord.namespace, currentRecord.name, {
                newName: v.newName,
                sizeGi: currentRecord.capacityBytes / (1024**3),
                storageClassName: currentRecord.storageClass,
                accessModes: currentRecord.accessModes || ['ReadWriteOnce'],
                volumeMode: currentRecord.volumeMode || 'Block'
              });
            } else {
              // 不克隆虚拟卷数据，进入创建卷弹窗
              setCloneOpen(false);
              createForm.resetFields();
              const scNames = storageClasses.map(s => s?.metadata?.name || s?.name).filter(Boolean);
              const defaultSc = scNames.find(n => n.toLowerCase().includes('longhorn')) || scNames[0];
              const defaultNs = nsOptions.length > 0 ? nsOptions[0].value : currentRecord.namespace;
              
              createForm.setFieldsValue({ 
                alias: v.newName,
                namespace: defaultNs,
                sizeGi: currentRecord.capacityBytes / (1024**3),
                accessModes: 'ReadWriteMany',
                volumeMode: 'Block',
                storageClassName: currentRecord.storageClass || defaultSc
              }); 
              setCreateOpen(true);
              return;
            }
            
            message.success('克隆成功');
            setCloneOpen(false);
            onRefresh?.();
          } catch (e: any) { message.error(e.message || '操作失败'); }
        }}
      >
          <Form.Item name="cloneData" valuePropName="checked" initialValue={true}>
            <Checkbox>克隆虚拟卷数据</Checkbox>
          </Form.Item>
          
          <Form.Item 
            name="newName" 
            label="名称" 
            rules={[
              {
                required: true,
                message: '请输入新卷名称',
                validator: (_, value) => {
                  const cloneData = cloneForm.getFieldValue('cloneData');
                  if (cloneData && !value) {
                    return Promise.reject(new Error('请输入新卷名称'));
                  }
                  return Promise.resolve();
                }
              }
            ]}
          >
            <Input placeholder="请输入新卷名称" />
          </Form.Item>
      </StdFormModal>

      {/* 7. 详情抽屉 */}
      <HarvesterResourceDrawer
        open={detailVisible}
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
