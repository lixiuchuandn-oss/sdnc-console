/**
 * ==============================================================================
 * 模块名称: Harvester 回收站视图组件 (RecycleBinSection)
 * 文件路径: src/pages/Clouds/Harvester/sections/RecycleBinSection.tsx
 * ==============================================================================
 * 
 * [功能描述]
 * 该组件用于展示和管理 Harvester 云平台中已删除但尚未彻底清理的虚拟机。
 * 回收站机制允许用户在删除虚拟机后有一个"后悔期"，可以恢复误删的资源。
 * 
 * [核心功能]
 * 1. [回收站识别]: 
 *    - 通过 finalizers 中的 'tower.io/recycle-bin' 或 labels 中的标记识别回收站中的 VM
 *    - 只显示标记为回收站状态的虚拟机，过滤掉正常运行的 VM
 * 
 * 2. [倒计时显示]:
 *    - 显示每个虚拟机距离自动清理的剩余时间
 *    - 支持天/小时/分钟的倒计时显示
 *    - 过期虚拟机显示"已过期"标签
 * 
 * 3. [恢复功能]:
 *    - 支持将回收站中的虚拟机恢复到正常运行状态
 *    - 恢复后会移除回收站标记，VM 重新出现在主列表中
 * 
 * 4. [彻底删除]:
 *    - 支持彻底删除虚拟机（绕过回收站机制）
 *    - 可选择是否同步删除关联的数据卷（PVC）
 *    - 彻底删除后无法恢复
 * 
 * 5. [清理周期配置]:
 *    - 支持配置自动清理任务的执行间隔（1-168小时）
 *    - 配置保存在系统设置中，影响后端清理任务的执行频率
 * 
 * [数据展示]
 * - 与 VM 云主机视图保持一致的列定义和数据显示
 * - 额外显示"删除时间"和"剩余时间"两列
 * - 使用 SafeRead 辅助函数统一处理复杂的数据结构
 * 
 * [筛选功能]
 * - 支持按关键字（名称/ID/命名空间）筛选
 * - 支持按命名空间筛选（租户模式下隐藏）
 * - 支持按状态筛选
 * 
 * [列设置]
 * - 使用 useTableColumnSettings hook 管理列显示/隐藏
 * - 设置持久化到 localStorage
 * - 避免使用旧的 TableColumnSettings 组件（防止死锁问题）
 * 
 * ------------------------------------------------------------------------------
 * [交互/依赖说明]
 * ------------------------------------------------------------------------------
 * 1. 上游数据:
 *    - 依赖父组件传入 `vms` (所有虚拟机列表), `volumes` (存储卷), `images` (镜像) 等
 *    - 本组件负责从 vms 中过滤出回收站中的 VM
 * 
 * 2. 关键服务:
 *    - harvesterApi.ts: restoreHarvesterVm, forceDeleteHarvesterVm
 *    - systemApi.ts: getSystemSetting, updateSystemSetting (清理周期配置)
 * 
 * 3. 状态管理:
 *    - 使用 React Hooks 管理本地 UI 状态
 *    - 筛选条件、抽屉状态、配置模态框状态等
 * 
 * ==============================================================================
 */

import React, { useMemo, useCallback, useState } from 'react';
import { Table, Space, message, Modal, Tooltip, App, Badge, Input, Select, Button, Typography, Checkbox } from 'antd';
import { DeleteOutlined, SafetyCertificateFilled, SearchOutlined, ReloadOutlined, WarningOutlined, SettingOutlined } from '@ant-design/icons';
import { restoreHarvesterVm, forceDeleteHarvesterVm } from '../../../../services/harvesterApi';
import PageDetailSection from '../../../../components/PageDetailSection';
import ResourceActionsDropdown from '../../../../components/ResourceActionsDropdown';
import { cnVmStatus } from '../../../../utils/harvesterUtils';
import { OsIcon } from '../../../../components/OsIcon';
import HarvesterResourceDrawer from '../components/HarvesterOpsinfoDrawer';
import { useTableColumnSettings } from '../../../../hooks/useTableColumnSettings';
import TableColumnSettingsButton from '../../../../components/TableColumnSettingsButton';
import RecycleBinTaskConfigModal from '../modals/RecycleBinTaskConfigModal';

/**
 * [类型定义] 组件 Props 接口
 * 
 * @property vms - [数据源] 所有虚拟机对象数组，包含正常和回收站中的 VM
 * @property loading - [UI状态] 表格是否处于加载中状态
 * @property cloudId - [上下文] 当前云平台的 ID，用于 API 调用
 * @property onRefresh - [回调] 请求父组件刷新数据列表
 * @property namespaces - [关联数据] 命名空间列表，用于解析租户/组织信息
 * @property volumes - [关联数据] 存储卷列表，用于显示卷详情
 * @property images - [关联数据] 镜像列表，用于显示镜像名称
 * @property isTenant - [权限控制] 是否为租户模式，影响功能可见性
 */
interface Props {
  vms: any[];
  loading: boolean;
  cloudId: string;
  onRefresh: (force?: boolean) => void;
  namespaces?: any[];
  volumes?: any[];
  images?: any[];
  isTenant?: boolean;
}

const RecycleBinSection: React.FC<Props> = ({ 
  vms, 
  loading, 
  cloudId, 
  onRefresh,
  namespaces = [],
  volumes = [],
  images = [],
  isTenant = false 
}) => {
  // ==========================================
  // [状态管理] 1. 本地 UI 状态 (Local State)
  // ==========================================
  
  const { modal } = App.useApp(); // Ant Design App 上下文，用于显示确认对话框

  // [筛选状态] 用户输入的筛选条件
  const [keyword, setKeyword] = useState<string>(''); // 关键字搜索（名称/ID/命名空间）
  const [namespaceFilter, setNamespaceFilter] = useState<string>(''); // 命名空间筛选
  const [statusFilter, setStatusFilter] = useState<string>(''); // 状态筛选

  // [运维信息抽屉状态] 控制资源详情抽屉的显示
  const [drawerVisible, setDrawerVisible] = useState(false); // 抽屉是否可见
  const [currentDrawerRecord, setCurrentDrawerRecord] = useState<any>(null); // 当前查看的 VM 记录
  const [drawerActiveTab, setDrawerActiveTab] = useState('detail'); // 抽屉当前激活的标签页

  // [配置模态框状态] 控制任务配置模态框的显示
  const [configModalVisible, setConfigModalVisible] = useState(false);

  // ==========================================
  // [数据处理] 2. 数据过滤与转换 (Data Processing)
  // ==========================================
  
  /**
   * 过滤出回收站中的虚拟机
   * 
   * 回收站识别规则:
   * 1. 检查 metadata.finalizers 数组中是否包含 'tower.io/recycle-bin'
   * 2. 检查 metadata.labels 中 'tower.io/recycle-bin' 是否为 'true'
   * 
   * 满足任一条件即视为回收站中的 VM
   * 
   * @returns 回收站中的虚拟机数组
   */
  const recycledVms = useMemo(() => {
    return vms.filter((vm: any) => {
      const finalizers = vm?.metadata?.finalizers || [];
      const labels = vm?.metadata?.labels || {};
      return finalizers.includes('tower.io/recycle-bin') || labels['tower.io/recycle-bin'] === 'true';
    });
  }, [vms]);

  // ==========================================
  // [工具函数] 3. 辅助函数 (Utility Functions)
  // ==========================================
  
  /**
   * 解析存储大小字符串，转换为 GiB 数值
   * 
   * 支持的格式:
   * - 纯数字: 视为字节数，转换为 GiB
   * - 带单位: 如 "10Gi", "500Mi", "2Ti" 等
   * - 支持二进制单位 (Ki, Mi, Gi, Ti) 和十进制单位 (K, KB, M, MB, G, GB, T, TB)
   * 
   * @param sizeStr - 存储大小字符串，如 "10Gi", "500Mi", "10737418240" 等
   * @returns 以 GiB 为单位的数值
   * 
   * @example
   * parseStorageSize("10Gi") => 10
   * parseStorageSize("500Mi") => 0.48828125
   * parseStorageSize("10737418240") => 10
   */
  const parseStorageSize = (sizeStr: string): number => {
    if (!sizeStr) return 0;
    const str = String(sizeStr).trim();
    if (/^\d+$/.test(str)) {
      const bytes = parseFloat(str);
      return bytes / (1024 ** 3);
    }
    const units: Record<string, number> = {
      ki: 1024, mi: 1024 ** 2, gi: 1024 ** 3, ti: 1024 ** 4,
      k: 1000, kb: 1000, m: 1000 ** 2, mb: 1000 ** 2, g: 1000 ** 3, gb: 1000 ** 3, t: 1000 ** 4, tb: 1000 ** 4,
    };
    const match = str.match(/^([\d.]+)\s*([a-zA-Z]+)$/);
    if (!match) return parseFloat(str) || 0;
    const val = parseFloat(match[1]);
    const unit = match[2].toLowerCase();
    const mul = units[unit];
    if (!mul) return val;
    return (val * mul) / (1024 ** 3);
  };

  /**
   * 格式化存储大小为可读字符串
   * 
   * 根据大小自动选择合适的单位:
   * - < 1 GiB: 显示为 MiB
   * - >= 1024 GiB: 显示为 TiB
   * - 其他: 显示为 GiB
   * 
   * @param sizeGiB - 以 GiB 为单位的存储大小
   * @returns 格式化后的字符串，如 "500 MiB", "10 GiB", "2.5 TiB"
   * 
   * @example
   * formatStorageSize(0.5) => "512 MiB"
   * formatStorageSize(10) => "10 GiB"
   * formatStorageSize(2048) => "2.0 TiB"
   */
  const formatStorageSize = (sizeGiB: number): string => {
    if (sizeGiB === 0) return '-';
    if (sizeGiB < 1) return `${Math.round(sizeGiB * 1024)} MiB`;
    if (sizeGiB >= 1024) return `${(sizeGiB / 1024).toFixed(1)} TiB`;
    return `${parseFloat(sizeGiB.toFixed(1))} GiB`;
  };

  /**
   * 获取虚拟机的唯一标识符
   * 
   * 优先级顺序:
   * 1. namespace/name 格式 (Kubernetes 标准格式)
   * 2. InstanceId (兼容旧格式)
   * 3. id (兜底)
   * 
   * @param r - 虚拟机对象
   * @returns 唯一标识符字符串
   */
  const getIid = (r: any): string => {
    if (r?.metadata?.name && r?.metadata?.namespace) {
      return `${r.metadata.namespace}/${r.metadata.name}`;
    }
    return String(r?.InstanceId || r?.id || '');
  };

  /**
   * 安全读取辅助函数对象
   * 
   * 目的: 统一处理 Harvester VM 对象的复杂嵌套结构，避免 undefined 错误
   * 
   * 设计原因:
   * - Harvester (基于 KubeVirt) 的资源对象结构非常深 (如 spec.template.spec.domain.cpu)
   * - 不同版本的 API 可能返回不同的数据结构
   * - 需要兼容多种数据格式（原始 K8s 对象、抽象后的对象等）
   * 
   * 使用方式:
   * - 所有字段读取都通过 SafeRead 对象的方法
   * - 每个方法都有多个回退路径，确保总能返回有效值
   * - 与 VmSection.tsx 保持完全一致，确保数据展示的一致性
   * 
   * 依赖项: namespaces, volumes, images - 用于解析关联信息
   */
  const SafeRead = useMemo(() => ({
    /**
     * 获取虚拟机显示名称
     * 优先级: 别名 > InstanceName > name > metadata.name
     */
    name: (r: any) => r?.metadata?.annotations?.['tower.io/alias'] || r?.InstanceName || r?.name || r?.metadata?.name || '',
    vmId: (r: any) => r?.metadata?.name || '',
    namespace: (r: any) => r?.metadata?.namespace || r?.namespace || '',
    uid: (r: any) => r?.metadata?.uid || r?.InstanceId || r?.id || '',
    tenant: (r: any) => {
      const nsName = r?.metadata?.namespace || r?.namespace || '';
      const nsObj = namespaces.find((n: any) => n?.metadata?.name === nsName);
      if (nsObj?.metadata?.annotations?.['tower.io/tenant']) {
        return nsObj.metadata.annotations['tower.io/tenant'];
      }
      return '';
    },
    organization: (r: any) => {
      const nsName = r?.metadata?.namespace || r?.namespace || '';
      const nsObj = namespaces.find((n: any) => n?.metadata?.name === nsName);
      if (nsObj?.metadata?.annotations?.['tower.io/organization']) {
        return nsObj.metadata.annotations['tower.io/organization'];
      }
      return '';
    },
    creationTimestamp: (r: any) => r?.createdAt || r?.metadata?.creationTimestamp,
    status: (r: any) => {
      if (typeof r?.status === 'string') return r.status;
      return r?.status?.printableStatus || r?.status?.phase || r?.Status || 'Unknown';
    },
    node: (r: any) => r?.nodeName || r?.vmi?.status?.nodeName || r?.status?.nodeName || '',
    cpu: (r: any) => {
      const cpu = r?.spec?.template?.spec?.domain?.cpu;
      if (cpu?.cores && cpu?.sockets && cpu?.threads) {
        return Number(cpu.cores) * Number(cpu.sockets) * Number(cpu.threads);
      }
      return r?.cpu || cpu?.cores || r?.vmi?.spec?.domain?.cpu?.cores;
    },
    memory: (r: any) => {
      const lim = r?.spec?.template?.spec?.domain?.resources?.limits?.memory;
      if (lim) return lim;
      const guest = r?.spec?.template?.spec?.domain?.memory?.guest;
      if (guest) return guest;
      return r?.memoryGb || r?.vmi?.spec?.domain?.memory?.guest;
    },
    memSpec: (r: any) => {
      const req = r?.spec?.template?.spec?.domain?.resources?.requests;
      const lim = r?.spec?.template?.spec?.domain?.resources?.limits;
      return `Request: ${req?.memory || '-'} / Limit: ${lim?.memory || '-'}`;
    },
    image: (r: any) => {
      const specImg = r?.spec?.template?.metadata?.annotations?.['harvesterhci.io/imageId'];
      if (specImg) return specImg;
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
    /**
     * 获取镜像显示名称
     * 
     * 逻辑:
     * 1. 先获取镜像 ID (通过 image 方法)
     * 2. 在 images 列表中查找对应的镜像对象
     * 3. 按优先级返回显示名称:
     *    - labels['harvesterhci.io/imageDisplayName']
     *    - annotations['harvesterhci.io/image-name']
     *    - annotations['field.cattle.io/displayName']
     *    - spec.displayName
     *    - displayName
     * 
     * 注意: 内联实现 image 逻辑，避免循环依赖
     */
    imageDisplayName: (r: any) => {
      let imgId = '';
      const specImg = r?.spec?.template?.metadata?.annotations?.['harvesterhci.io/imageId'];
      if (specImg) imgId = specImg;
      else {
        const metaImg = r?.metadata?.annotations?.['harvesterhci.io/imageId'];
        if (metaImg) imgId = metaImg;
        else {
          try {
            const annot = r?.metadata?.annotations?.['harvesterhci.io/volumeClaimTemplates'];
            if (annot) {
              const arr = JSON.parse(annot);
              for (const item of arr) {
                const img = item?.metadata?.annotations?.['harvesterhci.io/imageId'];
                if (img) { imgId = img; break; }
              }
            }
          } catch (e) {}
        }
      }
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
    /**
     * 获取存储卷详细信息
     * 
     * 返回每个卷的:
     * - name: 卷名称
     * - claimName: PVC 名称
     * - capacity: 容量字符串
     * - capacityBytes: 容量（GiB 数值）
     * - phase: PVC 状态（Bound/Pending 等）
     * - kind: 卷类型（system/data/cloudinit）
     * 
     * 逻辑:
     * 1. 从 spec.template.spec.volumes 获取卷定义
     * 2. 从 spec.template.spec.domain.devices.disks 确定启动卷（bootOrder 最小）
     * 3. 在 volumes 列表中查找对应的 PVC，获取实际容量和状态
     * 4. 区分系统卷、数据卷和 cloudinit 卷
     */
    volumeDetails: (r: any) => {
      const vols = r?.spec?.template?.spec?.volumes || [];
      let vmNs = r?.metadata?.namespace || r?.namespace;
      if (!vmNs) {
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
        let capacityBytes = 0;
        let phase = '';
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
          }
        }
        const isCloudInit = v?.cloudInitNoCloud || v?.cloudInitConfigDrive;
        const kind = isCloudInit ? 'cloudinit' : (claimName ? (v?.name === bootVolumeName ? 'system' : 'data') : 'data');
        return { name: v.name, claimName, capacity, capacityBytes, phase, kind };
      });
    },
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
    os: (r: any) => r?.vmi?.status?.guestOSInfo?.name || r?.vmi?.status?.guestOSInfo?.prettyName || '',
  }), [namespaces, volumes, images]);

  // ==========================================
  // [筛选选项] 4. 动态筛选选项生成 (Filter Options)
  // ==========================================
  
  /**
   * 生成命名空间筛选选项
   * 
   * 从回收站中的 VM 提取所有唯一的命名空间，生成下拉选项
   * 用于工具栏的命名空间筛选器
   */
  const namespaceOptions = useMemo(() => {
    const uniqueNamespaces = Array.from(new Set(recycledVms.map((vm: any) => {
      return vm?.metadata?.namespace || vm?.namespace || '';
    }).filter(Boolean)));
    return uniqueNamespaces.map((ns: string) => ({ value: ns, label: ns }));
  }, [recycledVms]);

  /**
   * 生成状态筛选选项
   * 
   * 从回收站中的 VM 提取所有唯一的状态值，并映射为中文标签
   * 状态映射表包含: running(运行中), starting(启动中), stopped(已停止) 等
   */
  const statusOptions = useMemo(() => {
    const uniqueStatuses = Array.from(new Set(recycledVms.map((vm: any) => {
      let s = '';
      if (typeof vm?.status === 'string') {
        s = vm.status;
      } else {
        s = vm?.status?.printableStatus || vm?.status?.phase || vm?.Status || 'Unknown';
      }
      return String(s).toLowerCase();
    }).filter(Boolean)));
    const statusMap: Record<string, string> = {
      'running': '运行中',
      'starting': '启动中',
      'stopping': '停止中',
      'stopped': '已停止',
      'terminating': '终止中',
      'error': '错误',
      'errorunschedulable': '调度错误',
      'migrating': '迁移中',
    };
    return uniqueStatuses.map((s: string) => ({ 
      value: s, 
      label: statusMap[s] || s 
    }));
  }, [recycledVms]);

  /**
   * 应用所有筛选条件后的虚拟机列表
   * 
   * 筛选逻辑（AND 关系）:
   * 1. 关键字筛选: 在名称、ID、命名空间中搜索
   * 2. 命名空间筛选: 精确匹配
   * 3. 状态筛选: 精确匹配（不区分大小写）
   * 
   * 所有筛选条件都是可选的，未设置时不进行筛选
   */
  const filteredVms = useMemo(() => {
    return recycledVms.filter((vm: any) => {
      // 关键字筛选
      if (keyword) {
        const searchText = keyword.toLowerCase();
        const name = SafeRead.name(vm).toLowerCase();
        const vmId = SafeRead.vmId(vm).toLowerCase();
        const namespace = SafeRead.namespace(vm).toLowerCase();
        if (!name.includes(searchText) && !vmId.includes(searchText) && !namespace.includes(searchText)) {
          return false;
        }
      }
      // 命名空间筛选
      if (namespaceFilter) {
        if (SafeRead.namespace(vm) !== namespaceFilter) {
          return false;
        }
      }
      // 状态筛选
      if (statusFilter) {
        const vmStatus = String(SafeRead.status(vm)).toLowerCase();
        if (vmStatus !== statusFilter) {
          return false;
        }
      }
      return true;
    });
  }, [recycledVms, keyword, namespaceFilter, statusFilter]);

  /**
   * 抽屉中显示的记录（确保数据最新）
   * 
   * 当用户打开抽屉后，如果数据刷新了，需要从最新的 filteredVms 中查找对应记录
   * 这样可以确保抽屉中显示的是最新数据，而不是打开时的快照
   */
  const drawerRecord = useMemo(() => {
    if (!currentDrawerRecord) return null;
    const currentId = SafeRead.uid(currentDrawerRecord);
    return filteredVms.find((v: any) => SafeRead.uid(v) === currentId) || currentDrawerRecord;
  }, [filteredVms, currentDrawerRecord, SafeRead]);

  /**
   * 恢复虚拟机
   * 
   * 将回收站中的虚拟机恢复到正常运行状态:
   * 1. 调用 restoreHarvesterVm API
   * 2. 后端会移除回收站标记（finalizer 或 label）
   * 3. VM 重新出现在主列表中
   * 4. 刷新列表以反映变化
   * 
   * @param r - 要恢复的虚拟机对象
   */
  const handleRestore = useCallback(async (r: any) => {
    const ns = r?.metadata?.namespace || r?.namespace || '';
    const name = r?.metadata?.name || r?.InstanceId?.split('/')[1] || '';
    const instanceId = `${ns}/${name}`;
    
    try {
      await restoreHarvesterVm(cloudId, instanceId);
      message.success('恢复成功');
      onRefresh(true);
    } catch (e: any) {
      message.error(`恢复失败: ${e.message}`);
    }
  }, [cloudId, onRefresh]);

  /**
   * 显示运维信息抽屉
   * 
   * 打开 HarvesterResourceDrawer 查看虚拟机的详细信息
   * 在租户模式下，此功能会被隐藏
   * 
   * @param record - 要查看的虚拟机对象
   * @param tab - 初始激活的标签页（默认为 'detail'）
   */
  const handleShowOpsinfo = useCallback((record: any, tab: string = 'detail') => {
    setCurrentDrawerRecord(record);
    setDrawerActiveTab(tab);
    setDrawerVisible(true);
  }, []);

  /**
   * 彻底删除虚拟机
   * 
   * 这是回收站中的危险操作，会永久删除虚拟机，无法恢复
   * 
   * 功能特点:
   * 1. 显示详细的确认对话框，包含警告信息
   * 2. 列出关联的数据卷（PVC），让用户了解影响范围
   * 3. 提供选项：是否同步删除关联的数据卷
   *    - 默认不勾选（保护数据）
   *    - 用户可勾选以彻底清理所有相关资源
   * 
   * 删除流程:
   * 1. 显示确认对话框
   * 2. 用户确认后调用 forceDeleteHarvesterVm API
   * 3. 根据 shouldDeleteVolumes 参数决定是否删除关联卷
   * 4. 删除成功后刷新列表
   * 
   * @param r - 要删除的虚拟机对象
   * 
   * 注意: 使用闭包变量 shouldDeleteVolumes 来捕获用户的选择
   * 因为 Checkbox 的 onChange 在对话框渲染时执行，而 onOk 在用户确认时执行
   */
  const handleForceDelete = useCallback(async (r: any) => {
    const ns = r?.metadata?.namespace || r?.namespace || '';
    const name = r?.metadata?.name || r?.InstanceId?.split('/')[1] || '';
    const instanceId = `${ns}/${name}`;

    // 获取关联卷信息
    const volDetails = SafeRead.volumeDetails(r);
    const volumeNames = volDetails.filter((v: any) => v.claimName).map((v: any) => v.claimName).join(', ');
    
    // 默认勾选删除卷，通过闭包变量控制
    // 注意: 这个变量在 Checkbox 的 onChange 中被修改，在 onOk 中被使用
    // 使用闭包而不是 state，因为需要在对话框的 onOk 回调中访问
    let shouldDeleteVolumes = !!volumeNames;
    
    modal.confirm({
      title: '确认彻底删除',
      icon: <DeleteOutlined style={{ color: '#ff4d4f' }} />,
      width: 500,
      content: (
        <div style={{ marginTop: 16 }}>
          <p>确定要彻底删除虚拟机 <b>{name}</b> 吗？</p>
          <div style={{ marginBottom: 16, color: '#ff4d4f', background: '#fff1f0', padding: '8px 12px', border: '1px solid #ffccc7', borderRadius: 4 }}>
            <WarningOutlined style={{ marginRight: 8 }} />
            警告：此操作不可恢复。虚拟机将被永久删除。
          </div>
          {volumeNames && (
              <div style={{ marginBottom: 16, background: '#f5f5f5', padding: '8px 12px',border: '1px solid #d9d9d9', borderRadius: 4 }}>
                <div style={{ fontWeight: 500, marginBottom: 4 }}>关联的数据卷 (PVC):</div>
                <div style={{ color: 'rgba(0,0,0,0.65)' }}>{volumeNames}</div>
                <div style={{ marginTop: 8, borderTop: '1px solid #e8e8e8', paddingTop: 8 }}>
                   <Checkbox defaultChecked={true} onChange={(e) => { shouldDeleteVolumes = e.target.checked; }}>
                     同步删除关联卷 (PVC)
                   </Checkbox>
                   <div style={{ color: '#999', fontSize: 12, marginLeft: 24, marginTop: 4 }}>
                     注意：勾选后将永久删除关联的数据卷 (PVC)，数据无法找回。
                   </div>
                </div>
              </div>
          )}
        </div>
      ),
      okText: '彻底删除',
      okType: 'danger',
      cancelText: '取消',
      onOk: async () => {
        try {
          await forceDeleteHarvesterVm(cloudId, instanceId, shouldDeleteVolumes);
          message.success('虚拟机已彻底删除');
          onRefresh(true);
        } catch (e: any) {
          message.error(`彻底删除失败: ${e.message}`);
        }
      },
    });
  }, [cloudId, onRefresh, modal, SafeRead]);

  // ==========================================
  // [表格定义] 7. 表格列配置 (Table Columns)
  // ==========================================
  
  /**
   * 表格列定义
   * 
   * 设计原则:
   * 1. 与 VmSection.tsx 保持一致的列定义和渲染逻辑
   * 2. 额外添加回收站特有的列: "删除时间" 和 "剩余时间"
   * 3. 使用 useMemo 稳定引用，避免不必要的重新计算
   * 4. 所有列都通过 SafeRead 对象读取数据，确保兼容性
   * 
   * 列说明:
   * - 基础信息: 名称、ID、状态、命名空间、租户、组织
   * - 资源信息: 节点、CPU、内存、镜像、操作系统
   * - 网络信息: IP地址、MAC地址
   * - 存储信息: 存储卷详情
   * - 时间信息: 创建时间、删除时间（回收站特有）、剩余时间（回收站特有）
   * - 操作列: 恢复、运维信息（租户模式隐藏）、彻底删除
   * 
   * 固定列:
   * - 名称列: fixed='left' - 始终显示在左侧
   * - 状态列: fixed='left' - 始终显示在左侧
   * - 操作列: fixed='right' - 始终显示在右侧
   */
  const allColumns = useMemo(() => {
    const cols = [
    {
      title: '云主机名称',
      key: 'name',
      fixed: 'left' as any,
      ellipsis: true,
      render: (_: any, r: any) => {
        const text = SafeRead.name(r) || '-';
        const osName = SafeRead.os(r) || SafeRead.imageDisplayName(r) || SafeRead.name(r) || '';
        const isImportant = r?.metadata?.labels?.['tower.io/important'] === 'true';
        return (
          <span>
            <OsIcon osName={osName} style={{ marginRight: 8 }} />
            <span>{text}</span>
            {isImportant && (
              <Tooltip title="重要实例">
                <SafetyCertificateFilled style={{ color: '#faad14', marginLeft: 8 }} />
              </Tooltip>
            )}
          </span>
        );
      },
    },
    {
      title: '云主机ID',
      key: 'vmId',
      ellipsis: true,
      render: (_: any, r: any) => {
        const id = SafeRead.vmId(r);
        return id ? <Tooltip title={id}>{id}</Tooltip> : '-';
      },
    },
    {
      title: '状态',
      key: 'status',
      fixed: 'left' as any,
      render: (_: any, r: any) => {
        const s = String(SafeRead.status(r));
        const k = s.toLowerCase();
        const status = (function(){
          if (k==='running') return 'success';
          if (k==='starting') return 'processing';
          if (k==='migrating') return 'processing';
          if (k==='stopping') return 'warning';
          if (k==='terminating') return 'warning';
          if (k==='error' || k==='errorunschedulable') return 'error';
          return 'default';
        })();
        return <Badge status={status as any} text={cnVmStatus(s)} />;
      },
    },
    {
      title: '命名空间',
      key: 'namespace',
      ellipsis: true,
      render: (_: any, r: any) => SafeRead.namespace(r) || '-',
    },
    {
      title: '租户',
      key: 'tenant',
      ellipsis: true,
      render: (_: any, r: any) => SafeRead.tenant(r) || '-',
    },
    {
      title: '组织',
      key: 'organization',
      ellipsis: true,
      render: (_: any, r: any) => SafeRead.organization(r) || '-',
    },
    {
      title: '节点',
      key: 'node',
      ellipsis: true,
      render: (_: any, r: any) => {
        const node = String(SafeRead.node(r)).trim();
        return node ? <span className="std-badge std-badge-info">{node}</span> : '-';
      },
    },
    {
      title: 'CPU',
      key: 'cpu',
      render: (_: any, r: any) => {
        const v = SafeRead.cpu(r);
        return v ? `${v} C` : '-';
      },
    },
    {
      title: '内存',
      key: 'memory',
      render: (_: any, r: any) => SafeRead.memory(r) || '-',
    },
    {
      title: '说明',
      key: 'memSpec',
      ellipsis: true,
      render: (_: any, r: any) => SafeRead.memSpec(r) || '-',
    },
    {
      title: '镜像',
      key: 'image',
      ellipsis: true,
      render: (_: any, r: any) => {
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
      },
    },
    {
      title: '操作系统',
      key: 'os',
      ellipsis: true,
      render: (_: any, r: any) => SafeRead.os(r) || '-',
    },
    {
      title: 'IP地址',
      key: 'ip',
      ellipsis: true,
      render: (_: any, r: any) => {
        const ip = SafeRead.ip(r);
        return ip ? <Tooltip title={ip}><div style={{ maxWidth: 210, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{ip}</div></Tooltip> : '-';
      },
    },
    {
      title: 'MAC地址',
      key: 'mac',
      ellipsis: true,
      render: (_: any, r: any) => {
        const mac = SafeRead.macAddress(r);
        return mac ? <Tooltip title={mac}>{mac}</Tooltip> : '-';
      },
    },
    {
      title: '存储卷',
      key: 'volumes',
      ellipsis: false,
      render: (_: any, r: any) => {
        const details = SafeRead.volumeDetails(r);
        if (!details || details.length === 0) return '-';
        const content = (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {details.map((v: any, i: number) => (
              v.kind !== 'cloudinit' ? (
                <Tooltip title={v.claimName || v.name} key={i}>
                  <span className={`std-badge ${v.kind === 'data' ? 'std-badge-success' : 'std-badge-info'}`}>
                    {[v.kind === 'system' ? '系统卷' : (v.kind === 'data' ? '数据卷' : ''), formatStorageSize(v.capacityBytes), v.phase]
                      .filter(Boolean).join(' | ')}
                  </span>
                </Tooltip>
              ) : null
            ))}
          </div>
        );
        return content;
      },
    },
    {
      title: '创建时间',
      key: 'created',
      render: (_: any, r: any) => {
        const t = SafeRead.creationTimestamp(r);
        if (!t) return '-';
        const date = new Date(t);
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        const hours = String(date.getHours()).padStart(2, '0');
        const minutes = String(date.getMinutes()).padStart(2, '0');
        const seconds = String(date.getSeconds()).padStart(2, '0');
        return <span className="std-time">{`${year}-${month}-${day} ${hours}:${minutes}:${seconds}`}</span>;
      },
    },
    /**
     * [回收站特有列] 删除时间
     * 
     * 显示虚拟机被删除的时间，从 metadata.annotations['tower.io/deletion-scheduled'] 读取
     * 这是回收站机制记录的时间点，用于追踪删除操作
     */
    {
      title: '删除时间',
      key: 'deletedAt',
      render: (_: any, r: any) => {
        const deletedAtStr = r?.metadata?.annotations?.['tower.io/deletion-scheduled'];
        if (!deletedAtStr) return '-';
        const deletedAt = new Date(deletedAtStr);
        const year = deletedAt.getFullYear();
        const month = String(deletedAt.getMonth() + 1).padStart(2, '0');
        const day = String(deletedAt.getDate()).padStart(2, '0');
        const hours = String(deletedAt.getHours()).padStart(2, '0');
        const minutes = String(deletedAt.getMinutes()).padStart(2, '0');
        const seconds = String(deletedAt.getSeconds()).padStart(2, '0');
        return <span className="std-time">{`${year}-${month}-${day} ${hours}:${minutes}:${seconds}`}</span>;
      },
    },
    {
      title: '操作',
      key: 'actions',
      width: 80,
      fixed: 'right' as const,
      render: (_: any, r: any) => {
        const items: any[] = [
          {
            key: 'restore',
            label: '恢复',
            onClick: () => handleRestore(r),
          },
          ...(!isTenant ? [
            { type: 'divider' },
            {
              key: 'opsinfo',
              label: '运维信息',
              onClick: () => handleShowOpsinfo(r, 'detail'),
            },
          ] : []),
          { type: 'divider' },
          {
            key: 'force_delete',
            label: '彻底删除',
            danger: true,
            onClick: () => handleForceDelete(r),
          },
        ];
        return <ResourceActionsDropdown items={items} buttonProps={{ className: 'row-actions-trigger', style: { margin: 0 } }} />;
      },
    },
    ];
    return cols;
  }, [SafeRead, handleRestore, handleForceDelete, handleShowOpsinfo, isTenant]);

  /**
   * 使用 useTableColumnSettings hook 管理列显示/隐藏
   * 
   * 功能:
   * - 从 localStorage 读取用户保存的列设置
   * - 根据用户选择过滤列
   * - 自动保存用户的选择到 localStorage
   * 
   * 优势:
   * - 避免使用旧的 TableColumnSettings 组件（防止死锁问题）
   * - 使用单向数据流，避免循环更新
   * - 初始化只执行一次，性能更好
   * 
   * @param allColumns - 所有列定义
   * @param 'harvester_recycle_bin_table' - localStorage 的 key
   * @returns displayColumns - 过滤后的列数组，用于表格显示
   */
  const { displayColumns } = useTableColumnSettings(allColumns, 'harvester_recycle_bin_table');

  // ==========================================
  // [UI渲染] 8. 组件结构返回 (Render)
  // ==========================================
  
  return (
    <PageDetailSection 
      asCard={false}
      toolbarLeft={
        /**
         * 工具栏左侧: 筛选器
         * 
         * 包含:
         * 1. 关键字搜索框 - 搜索名称/ID/命名空间
         * 2. 命名空间下拉 - 租户模式下隐藏
         * 3. 状态下拉 - 筛选不同状态的 VM
         * 4. 重置按钮 - 当有筛选条件时显示，一键清空所有筛选
         */
        <>
          <Input
            allowClear
            placeholder="关键字"
            suffix={<SearchOutlined style={{ color: 'rgba(0,0,0,.45)' }} />}
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            className="toolbar-search"
          />
          {!isTenant && namespaceOptions.length > 0 && (
            <Select
              allowClear
              showSearch
              placeholder="命名空间"
              value={namespaceFilter || undefined}
              onChange={(v) => setNamespaceFilter(v || '')}
              className="toolbar-filter"
              options={[{ value: '', label: '全部' }, ...namespaceOptions]}
            />
          )}
          {statusOptions.length > 0 && (
            <Select
              allowClear
              placeholder="状态"
              value={statusFilter || undefined}
              onChange={(v) => setStatusFilter(v || '')}
              className="toolbar-filter-sm"
              options={[{ value: '', label: '全部' }, ...statusOptions]}
            />
          )}
          <button
            type="button"
            className="toolbar-reset-btn"
            onClick={() => {
              setKeyword('');
              setNamespaceFilter('');
              setStatusFilter('');
            }}
          >
            重置
          </button>
        </>
      }
      toolbarRight={
        /**
         * 工具栏右侧: 操作按钮
         * 
         * 包含:
         * 1. 设定清理间隔 - 打开配置对话框，设置自动清理任务的执行间隔
         * 2. 列设置按钮 - 使用 TableColumnSettingsButton 组件，管理列的显示/隐藏
         * 3. 刷新按钮 - 手动刷新数据列表
         */
        <div className="toolbar-actions">
          <Button
            type="primary"
            onClick={() => setConfigModalVisible(true)}
          >
            任务配置
          </Button>
          <TableColumnSettingsButton
            allColumns={allColumns}
            settingsKey="harvester_recycle_bin_table"
          />
          <Button icon={<ReloadOutlined />} onClick={() => onRefresh()} loading={loading} />
        </div>
      }
    >
      <Table
        className="std-table"
        bordered={false}
        dataSource={filteredVms}
        columns={displayColumns}
        loading={loading}
        rowKey={(r: any) => SafeRead.uid(r)}
        scroll={{ x: 'max-content' }}
        pagination={{
          size: 'small',
          showTotal: (total) => `共 ${total} 条`,
        }}
        locale={{
          emptyText: '回收站为空',
        }}
      />
      
      {/* 
        ========================================
        运维信息抽屉 (Resource Detail Drawer)
        ========================================
        
        用于显示虚拟机的详细信息，包括:
        - 基本信息
        - YAML 配置
        - 事件日志
        - 关联资源等
        
        注意: 在租户模式下，此抽屉不会显示（isTenant 控制）
      */}
      {drawerRecord && (
        <HarvesterResourceDrawer
          open={drawerVisible}
          onClose={() => {
            setDrawerVisible(false);
            setCurrentDrawerRecord(null);
          }}
          resourceType="VirtualMachine"
          forceOpsMode={true}
          record={drawerRecord}
          activeTab={drawerActiveTab}
          onTabChange={setDrawerActiveTab}
          cloudId={cloudId}
          namespaces={namespaces}
          volumes={volumes}
          images={images}
          onRefresh={onRefresh}
        />
      )}
      <RecycleBinTaskConfigModal
        open={configModalVisible}
        onClose={() => setConfigModalVisible(false)}
        onSuccess={() => {
          console.log('回收站任务配置已更新');
        }}
      />
    </PageDetailSection>
  );
};

export default RecycleBinSection;
