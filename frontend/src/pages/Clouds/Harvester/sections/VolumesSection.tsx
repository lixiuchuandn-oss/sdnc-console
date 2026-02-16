/**
 * @file VolumesSection.tsx
 * @description Harvester 虚拟卷（PVC）列表视图
 *
 * 职责说明：
 * - 以统一的视图模型 VolumeView 展示 Harvester/K8s PVC 列表（名称、容量、存储类、访问模式等）
 * - 提供关键字、命名空间、状态、存储类等多维度筛选，并支持“显示系统卷”开关
 * - 自动过滤系统命名空间和系统存储类（依赖 harvesterUtils 中的 isSystemNamespace / isSystemStorageClass）
 * - 自动尝试关联卷所属的云主机（SafeRead.attachedVm），在列表中展示“挂载云主机”
 * - 支持卷的全生命周期操作：创建、挂载到云主机、从云主机卸载、导出为镜像、创建快照、编辑容量、克隆、删除
 * - 支持批量删除卷
 * - 支持打开 HarvesterResourceDrawer 查看 PVC 详情 / 事件
 *
 * 集成说明：
 * - 所有实际的后端调用（创建/删除/挂载/卸载/导出/快照/编辑/克隆）统一通过 services/harvesterApi 下的接口实现
 * - 组件通过 Props 接收 volumes / vms / storageClasses 列表以及 onRefresh 回调，由上层页面负责数据拉取
 * - 本组件内部不会做任何“Hack”式写法，只通过 ViewModel + SafeRead 做兼容性适配
 */

import React, { useMemo, useState, useEffect } from 'react';
import { Table, Input, Select, Button, Dropdown, Modal, Form, message, InputNumber, Checkbox, Tabs, Badge } from 'antd';
import { rebootCloudProviderEcs } from '../../../../services/api';
import StdFormModal from '../../../../components/StdFormModal';
import { EllipsisOutlined, ReloadOutlined, SyncOutlined, ExclamationCircleOutlined } from '@ant-design/icons';
import PageDetailSection from '../../../../components/PageDetailSection';
import ResourceActionsDropdown from '../../../../components/ResourceActionsDropdown';
import { attachHarvesterVolumeToVmByName, detachHarvesterVolumeFromVm, deleteHarvesterVolume, createHarvesterVolume, exportHarvesterImageFromVolume, createHarvesterVolumeSnapshot, updateHarvesterVolume, cloneHarvesterVolume } from '../../../../services/harvesterApi';
import TableColumnSettings from '../../../../components/TableColumnSettings';

import HarvesterResourceDrawer from '../components/HarvesterResourceDrawer';

import { isSystemNamespace, isSystemStorageClass } from '../../../../utils/harvesterUtils';

/**
 * Props 定义
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
};

// ----------------------------------------------------------------------
// 1. Clean Data Model (ViewModel) based on PVC Spec
// ----------------------------------------------------------------------
/**
 * VolumeView：前端使用的“干净视图模型”
 *
 * 设计目的：
 * - 后端可能返回多种结构（原生 K8s PVC 对象、带 rawData 的包装对象等）
 * - 通过统一映射到 VolumeView，表格渲染与后续逻辑都只依赖这一种结构
 *
 * 字段说明：
 * - key：表格行唯一标识，优先使用 metadata.uid，其次使用 id 或 namespace/name
 * - name：PVC 名称（metadata.name）
 * - alias：展示别名（tower.io/alias），如果有的话
 * - namespace：命名空间（metadata.namespace）
 * - pvName：绑定的 PV 名称（spec.volumeName）
 * - phase：卷状态（status.phase），增加了 Resizing / FileSystemResizePending 兼容
 * - capacityRaw：原始容量字符串（如 "10Gi"）
 * - capacityBytes：换算后的字节数，便于进行数值计算和排序
 * - storageClass：存储类名称（spec.storageClassName）
 * - accessModes：访问模式数组（如 ['ReadWriteOnce']）
 * - volumeMode：卷类型（Block / Filesystem）
 * - creationTimestamp：创建时间（metadata.creationTimestamp）
 * - attachedTo：后端直接提供的“挂载到哪些实例”的列表（如果有）
 * - links：扩展用链接信息（当前主要保留原样）
 * - raw：原始记录（用于打开详情抽屉时传给 HarvesterResourceDrawer）
 */
interface VolumeView {
  key: string;
  name: string;
  alias?: string;
  namespace: string;
  pvName: string;
  phase: string;
  capacityRaw: string;
  capacityBytes: number;
  storageClass: string;
  accessModes: string[];
  volumeMode: string;
  creationTimestamp: string;
  attachedTo: string[];
  links?: { view?: string };
  raw: any;
}

// ----------------------------------------------------------------------
// 2. Helpers（通用辅助函数）
// ----------------------------------------------------------------------
/**
 * parseQuantity：解析 K8s 容量字符串为字节数
 *
 * 支持格式：
 * - 纯数字：默认视为字节数，例如 "10737418240"
 * - 带二进制单位：Ki / Mi / Gi / Ti / Pi
 * - 带十进制单位：k / M / G / T / P
 *
 * 示例：
 * - "10Gi" => 10 * 1024^3
 * - "500Mi" => 500 * 1024^2
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
 * gbText：将字节数格式化为 GB 文本
 *
 * - 输入为字节数（通常来自 parseQuantity）
 * - 输出保留两位小数的 "xx.xx GB" 文本
 * - 如果字节数为空或 <= 0，则返回 "-"
 */
const gbText = (bytes: number): string => {
  if (!bytes || bytes <= 0) return '-';
  const gb = bytes / (1024 * 1024 * 1024);
  return `${gb.toFixed(2)} GB`;
};

/**
 * cnStatus：将卷状态英文字符串转换为中文文案
 *
 * 用于：
 * - 顶部“状态”筛选下拉框的展示（label）
 * - 让终端用户看到中文状态而不是英文枚举
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
 * statusBadge：根据 PVC phase 渲染状态徽标
 *
 * 映射规则（示例）：
 * - bound / available          => 绿色“正常 (Bound)”
 * - lost                       => 红色“丢失 (Lost)”
 * - pending                    => 蓝色“创建中 (Pending)”
 * - resizing                   => 带旋转图标的“扩容中 (Resizing)”
 * - filesystemresizepending    => 黄色“等待文件系统扩容”
 *
 * 返回值：
 * - Antd Badge 组件，用于表格“状态”列
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

// ----------------------------------------------------------------------
// 3. Component
// ----------------------------------------------------------------------
/**
 * VolumesSection 组件
 *
 * 主要职责：
 * - 将后端返回的 PVC 列表归一化为 VolumeView 视图模型
 * - 提供多条件过滤（关键字、命名空间、状态、存储类、是否显示系统卷）
 * - 提供卷生命周期相关操作（创建、挂载/卸载、导出、快照、编辑、克隆、删除）
 * - 打开 HarvesterResourceDrawer 查看 PVC 详情
 */
const VolumesSection: React.FC<Props> = ({ cloudId, volumes, loading, vms, storageClasses: propStorageClasses, namespacesOptions, onRefresh }) => {
  // 过滤条件状态：关键字 / 状态 / 命名空间 / 存储类 / 是否展示系统卷
  const [keyword, setKeyword] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [nsFilter, setNsFilter] = useState<string>('');
  const [scFilter, setScFilter] = useState<string>('');
  const [showSystemVolumes, setShowSystemVolumes] = useState<boolean>(false);
  
  // 表格勾选的行，用于批量删除
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([]);

  // 各类弹窗开关状态：创建 / 挂载 / 导出 / 快照 / 编辑 / 克隆
  const [createOpen, setCreateOpen] = useState(false);
  const [attachOpen, setAttachOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [snapshotOpen, setSnapshotOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [cloneOpen, setCloneOpen] = useState(false);
  
  // 详情抽屉状态：是否可见 / 当前记录 / 当前 Tab
  const [detailVisible, setDetailVisible] = useState(false);
  const [detailRecord, setDetailRecord] = useState<any>(null);
  const [detailActiveTab, setDetailActiveTab] = useState('detail');

  // 表单实例：分别对应创建 / 挂载 / 导出 / 快照 / 编辑 / 克隆
  const [createForm] = Form.useForm();
  const [attachForm] = Form.useForm();
  const [exportForm] = Form.useForm();
  const [snapshotForm] = Form.useForm();
  const [editForm] = Form.useForm();
  const [cloneForm] = Form.useForm();

  // 当前正在操作的卷（配合各个弹窗使用）
  const [currentRecord, setCurrentRecord] = useState<VolumeView | null>(null);
  const [creating, setCreating] = useState(false);                 // 创建卷时的提交状态
  const [storageClasses, setStorageClasses] = useState<any[]>([]); // 实际使用的存储类列表
  const [tableColumns, setTableColumns] = useState<any[]>([]);     // 当前表格列配置（受 TableColumnSettings 控制）

  // 同步外部传入的 storageClasses 到本地 state
  useEffect(() => {
    if (propStorageClasses) setStorageClasses(propStorageClasses);
  }, [propStorageClasses]);

  // 在“创建卷”表单中自动选择一个推荐的存储类（优先 longhorn）
  useEffect(() => {
    try {
      const cur = createForm.getFieldValue('storageClassName');
      if (!cur && storageClasses.length > 0) {
        const names = storageClasses.map(s => s?.metadata?.name || s?.name).filter(Boolean);
        let prefer = names.find(n => n.toLowerCase() === 'longhorn');
        if (!prefer) {
          prefer = names.find(n => n.toLowerCase().includes('longhorn')) || names[0];
        }
        if (prefer) createForm.setFieldsValue({ storageClassName: prefer });
      }
    } catch {}
  }, [storageClasses, createForm]);

  // ----------------------------------------------------------------
  // SafeRead Helper (Robust Data Access)
  // ----------------------------------------------------------------
  /**
   * SafeRead：安全读取工具
   *
   * 作用：
   * - 屏蔽后端数据结构差异（原生 PVC / 包装对象 / 扁平字段）
   * - 对外提供一组统一的读取接口（id / name / namespace / phase 等）
   */
  const SafeRead = {
    // 真实 PVC 名称（逻辑 ID）：优先使用 r.name，其次 metadata.name
    id: (r: any) => r?.name || r?.metadata?.name || '',
    // 展示名称：优先别名，其次 name
    name: (r: any) => r?.alias || r?.metadata?.annotations?.['tower.io/alias'] || r?.name || r?.metadata?.name || '',
    // 命名空间
    namespace: (r: any) => r?.namespace || r?.metadata?.namespace || '',
    // 卷状态（Phase）
    phase: (r: any) => r?.phase || r?.status?.phase || r?.status?.state || 'Unknown',
    // 原始容量
    capacity: (r: any) => r?.capacityRaw || r?.status?.capacity?.storage || r?.spec?.resources?.requests?.storage || '',
    // 存储类
    storageClass: (r: any) => r?.storageClass || r?.spec?.storageClassName || '',
    // 访问模式（统一为数组）
    accessModes: (r: any) => {
      const modes = r?.accessModes || r?.spec?.accessModes || r?.status?.accessModes;
      return Array.isArray(modes) ? modes : (modes ? [modes] : []);
    },
    // 后端直接提供的挂载目标列表（如果有）
    attachedTo: (r: any) => {
      if (Array.isArray(r?.attachedTo)) return r.attachedTo;
      // Harvester/K8s usually doesn't have attachedTo in status, but if backend provides it:
      return [];
    },
    // 查找该卷挂载到的 VM 对象
    attachedVm: (r: any) => {
      const list = Array.isArray(vms) ? vms : [];
      const pvcName = SafeRead.id(r); // PVC Name (metadata.name)
      const pvcNs = SafeRead.namespace(r);

      // Strictly use PVC Name to match VM's volumeClaims
      // This is the most reliable way as Harvester/K8s maps PVCs to VMs via spec.volumes.persistentVolumeClaim.claimName
      return list.find((vm: any) => {
        // Check Namespace (Support both flat object and K8s object)
        const vmNs = vm.namespace || vm.metadata?.namespace || vm.extra?.namespace || vm.Extra?.Namespace || '';
        if (String(vmNs) !== pvcNs) return false;

        // Check Claims
        // Strategy 1: Check pre-parsed volumeClaims (from backend)
        const claims = vm.volumeClaims || vm.extra?.volumeClaims || vm.Extra?.VolumeClaims;
        if (Array.isArray(claims) && claims.includes(pvcName)) return true;

        // Strategy 2: Deep inspect spec.template.spec.volumes (Standard K8s/Harvester structure)
        const volumes = vm?.spec?.template?.spec?.volumes;
        if (Array.isArray(volumes)) {
            const found = volumes.some((v: any) => v?.persistentVolumeClaim?.claimName === pvcName);
            if (found) return true;
        }

        return false;
      });
    }
  };

  // ----------------------------------------------------------------
  // Core Data Normalization (The "Rewrite" Logic)
  // ----------------------------------------------------------------
  /**
   * dataSource：核心数据归一化逻辑
   *
   * 作用：
   * - 将原始 volumes 列表转为 VolumeView 数组
   * - 处理多种来源字段（rawData / 扁平字段）
   * - 识别并合并“扩容中 / 文件系统待扩容”等特殊状态
   * - 去重：按 namespace/name 保证唯一
   */
  const dataSource = useMemo<VolumeView[]>(() => {
    const rawList = Array.isArray(volumes) ? volumes : [];
    
    const mapped = rawList.map((r: any) => {
      // Prioritize rawData (K8s Spec) if available (e.g. from backend wrapper)
      const source = r?.rawData || r || {};
      
      // 1. 基础元信息：名称 / 命名空间 / 别名
      const name = source?.metadata?.name || r?.name || '';
      const namespace = source?.metadata?.namespace || r?.namespace || '';
      const alias = source?.metadata?.annotations?.['tower.io/alias'] || '';
      
      // 2. 规格信息：PV 名称 / 存储类 / 访问模式 / 卷类型
      const pvName = source?.spec?.volumeName || r?.volumeName || r?.pvcName || ''; 
      const storageClass = source?.spec?.storageClassName || r?.storageClassName || '';
      const accessModes = source?.spec?.accessModes || source?.status?.accessModes || r?.accessModes || [];
      const volumeMode = source?.spec?.volumeMode || r?.volumeMode || 'Block';

      // 3. 状态与容量：phase + capacityRaw（同时兼容 conditions 中的扩容状态）
      let phase = source?.status?.phase || r?.phase || source?.status?.state || r?.state || 'Unknown';
      
      // Check for Resizing conditions (Resizing or FileSystemResizePending)
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
      
      // 4. 挂载信息：保留后端直接给出的 attachedTo（如果有）
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
        raw: r // Keep original record
      };
    }).filter(v => !!v.name); // 过滤掉缺少名称的无效记录

    // De-duplicate：按 namespace/name 去重
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
  // Helper: Find VM for a Volume
  // ----------------------------------------------------------------
  // Replaced by SafeRead.attachedVm


  // ----------------------------------------------------------------
  // Filtering（列表过滤）
  // ----------------------------------------------------------------
  /**
   * filteredData：根据多种条件过滤之后的列表
   *
   * 条件：
   * - 关键字：匹配 name（别名或 PVC 名称）
   * - 状态：phase 精确匹配
   * - 命名空间：精确匹配
   * - 存储类：精确匹配
   * - 是否显示系统卷：未勾选时，会自动隐藏系统命名空间下的卷
   */
  const filteredData = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    const st = statusFilter.trim().toLowerCase();
    return dataSource.filter(item => {
      // Keyword
      if (kw && !item.name.toLowerCase().includes(kw)) return false;
      // Status
      if (st && item.phase.toLowerCase() !== st) return false;
      
      // Namespace System Filter
      if (!showSystemVolumes && isSystemNamespace(item.namespace)) return false;

      // Namespace Filter
      if (nsFilter && item.namespace !== nsFilter) return false;
      // StorageClass
      if (scFilter && item.storageClass !== scFilter) return false;

      return true;
    });
  }, [dataSource, keyword, statusFilter, nsFilter, scFilter, showSystemVolumes]);

  // Options for Filters（筛选下拉选项）
  const nsOptions = useMemo(() => {
    const set = new Set<string>();

    // 优先使用外部传入的 namespacesOptions（CloudConsole 组合筛选）
    if (Array.isArray(namespacesOptions)) {
      namespacesOptions.forEach(ns => ns && set.add(ns));
    }

    // 若未传入，则从卷和 VM 数据中推导命名空间列表
    if (set.size === 0) {
      dataSource.forEach(v => v.namespace && set.add(v.namespace));
      (vms || []).forEach((vm: any) => {
        const ns = vm?.extra?.namespace || vm?.namespace || vm?.Extra?.Namespace;
        if (ns) set.add(ns);
      });
      if (!set.has('default')) set.add('default');
    }
    
    // 默认过滤系统命名空间，除非用户勾选“显示系统卷”
    let list = Array.from(set);
    if (!showSystemVolumes) {
      list = list.filter(ns => !isSystemNamespace(ns));
    }
    
    return list.sort().map(s => ({ value: s, label: s }));
  }, [dataSource, vms, showSystemVolumes, namespacesOptions]);

  // 状态筛选可选值列表（结合 cnStatus 渲染为中文）
  const statusOptions = [
    'healthy','degraded','faulted','detached','attaching','attached','detaching','maintenance','restoring','creating','deleting','error','bound','pending','lost'
  ];

  // ----------------------------------------------------------------
  // Actions Handlers（单个 / 批量操作）
  // ----------------------------------------------------------------
  /**
   * handleOpenDrawer：打开资源详情抽屉
   *
   * - 确保传给 Drawer 的 record 至少包含 kind / metadata 基础信息
   * - activeTab 控制默认打开的二级 Tab（detail / events 等）
   */
  const handleOpenDrawer = async (record: VolumeView, tab: string = 'detail') => {
    // Inject kind: 'PersistentVolumeClaim' for events fetching
    const raw = record.raw || {};
    // Ensure raw data has kind
    if (!raw.kind) raw.kind = 'PersistentVolumeClaim';
    // Ensure raw data has metadata
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
  };

  /**
   * handleBatchDelete：批量删除选中卷
   *
   * 流程：
   * - 根据 selectedRowKeys 找到目标 VolumeView
   * - 弹出确认框展示即将删除的卷名称
   * - 并发调用 deleteHarvesterVolume
   * - 汇总成功/失败数量并提示
   */
  const handleBatchDelete = () => {
    if (selectedRowKeys.length === 0) return;
    const targets = dataSource.filter(v => selectedRowKeys.includes(v.key));
    
    Modal.confirm({
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
   * handleAttach：打开“挂载到云主机”弹窗
   *
   * 逻辑：
   * - 如果当前 vms 列表为空，先尝试触发一次刷新（避免数据不同步）
   * - 通过 SafeRead.attachedVm 找到当前卷已挂载的 VM（如果有）
   * - 预填表单：instanceId / diskName / bus
   */
  const handleAttach = (r: VolumeView) => {
    // Proactively refresh if vms are missing (common issue on fresh load)
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
  };

  /**
   * handleDetach：从云主机卸载卷
   *
   * 核心步骤：
   * 1. 校验 vms 数据是否存在，否则提示用户稍后重试
   * 2. 通过 SafeRead.attachedVm 找到挂载的 VM；若找不到则提示
   * 3. 尝试解析磁盘名称（优先 VM.spec.volumes，其次 Extra.VolumeMap）
   * 4. 若仍无法确定磁盘名称，建议用户先在 VM 内卸载，并可选择重启 VM
   * 5. 调用 detachHarvesterVolumeFromVm 进行卸载，必要时退化为使用短 ID
   */
  const handleDetach = async (r: VolumeView) => {
    // Proactively refresh if vms are missing
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
    
    // Attempt to resolve volume/disk name:
    // 1) From VM spec.volumes[].name where claimName === pvc
    // 2) From Extra.VolumeMap[pvcName]
    const pvcName = r.name;
    const vmVolumes = Array.isArray(vm?.spec?.template?.spec?.volumes) ? vm.spec.template.spec.volumes : [];
    const volEntry = vmVolumes.find((v: any) => v?.persistentVolumeClaim?.claimName === pvcName);
    const volName = volEntry?.name || '';
    const mappedName = vm?.Extra?.VolumeMap?.[pvcName] || '';
    const diskName = volName || mappedName || '';

    if (!diskName) {
      const iid = String(vm.InstanceId || '');
      Modal.confirm({
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

    const iid = String(vm.InstanceId || '');
    const ns = vm?.metadata?.namespace || vm?.namespace || vm?.extra?.namespace || vm?.Extra?.Namespace || '';
    const name = vm?.name || vm?.metadata?.name || vm?.InstanceName || '';
    const iidNameOnly = (iid && iid.includes('/')) ? iid.split('/').pop() : iid || name;
    const resolvedId = iid ? iid : (ns && name ? `${ns}/${name}` : iidNameOnly);

    Modal.confirm({
      title: '确认卸载',
      content: `将从云主机 ${vm.InstanceName || vm.InstanceId} 卸载卷 ${r.name}`,
      onOk: async () => {
        try {
          // Try with full ID first, then short name fallback
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
  };

  // ----------------------------------------------------------------
  // Columns（表格列定义）
  // ----------------------------------------------------------------
  /**
   * allColumns：卷列表表头配置
   *
   * 包含：
   * - PVC名称 / PVC ID / PV 名称 / 状态 / 命名空间 / 存储类 / 访问模式 / 卷类型 / 挂载云主机 / 大小 / 操作
   *
   * 说明：
   * - “挂载云主机”优先显示已解析的 VM 别名，否则回退到 InstanceName/InstanceId
   * - “操作”列集中各类动作（编辑、挂载/卸载、导出、快照、克隆、删除）
   */
  const allColumns = useMemo(() => [
    { 
      title: 'PVC名称', 
      dataIndex: 'name',
      key: 'name', 
      render: (_: string, r: VolumeView) => (
        <span className="cell-link" onClick={() => handleOpenDrawer(r, 'detail')}>
          {r.alias || r.name}
        </span> 
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
          { key: 'detail', label: '资源详情', onClick: () => handleOpenDrawer(r, 'detail') },
          { type: 'divider' as const },
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
          ...(vm ? [{ 
            key: 'detach', 
            label: '从云主机卸载', 
            danger: true, 
            onClick: () => handleDetach(r) 
          }] : []),
          // Metadata/SourceData actions removed as per request

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
          { type: 'divider' as const },
          { 
            key: 'delete', 
            label: '删除', 
            danger: true, 
            onClick: () => {
              Modal.confirm({ 
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
  ], [cloudId, vms, storageClasses, onRefresh, handleOpenDrawer, SafeRead, handleAttach, handleDetach, exportForm, snapshotForm, cloneForm, editForm]);

  // ----------------------------------------------------------------
  // Render（渲染）
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
          <Checkbox 
            checked={showSystemVolumes} 
            onChange={(e: any) => setShowSystemVolumes(e.target.checked)}
          >
            显示系统卷
          </Checkbox>
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
        className="std-table"
        bordered
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

      {/* --- Modals --- */}
      
      {/* 1. Metadata - Removed */}

      {/* 2. Create */}
      <StdFormModal
        title="创建卷" open={createOpen} onCancel={() => setCreateOpen(false)} confirmLoading={creating}
        okText="创建"
        form={createForm}
        onFinish={async (v: any) => {
          try {
            setCreating(true);
            const modes = Array.isArray(v.accessModes) ? v.accessModes : (v.accessModes ? [v.accessModes] : ['ReadWriteMany']);
            
            // Generate ID: id-vol-{11 random chars}
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

      {/* 3. Attach */}
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
            // If ID is complex path, try to parse name (fallback)
            const iid = String(vm.id || vm.InstanceId || '');
            const finalName = vmName || (iid.includes('/') ? iid.split('/').pop() : iid);

            if (!finalName) { message.error('云主机名称无效'); return; }

            // Generate a safe disk name
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

      {/* 4. Export */}
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

      {/* 5. Snapshot */}
      <StdFormModal
        title="创建快照" open={snapshotOpen} onCancel={() => setSnapshotOpen(false)}
        okText="创建"
        form={snapshotForm}
        onFinish={async (v: any) => {
          try {
            if (!currentRecord) return;
            // Generate ID: id-vs-{11 random chars}
            const id = `id-vs-${Math.random().toString(36).substring(2, 13)}`;
            await createHarvesterVolumeSnapshot(cloudId, currentRecord.namespace, currentRecord.name, {
              name: id,
              snapshotClassName: 'longhorn-snapshot',
              alias: v.name // Use user input as alias
            });
            message.success('创建成功');
            setSnapshotOpen(false);
          } catch (e: any) { message.error(e.message || '创建失败'); }
        }}
      >
          <Form.Item label="快照名称" name="name"><Input placeholder="留空自动生成" /></Form.Item>
      </StdFormModal>

      {/* 6. Edit */}
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

      {/* 7. Clone */}
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

      {/* 8. Resource Drawer */}
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
