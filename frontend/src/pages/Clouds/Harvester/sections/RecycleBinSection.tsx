/**
 * 回收站视图组件
 * 显示回收站中的虚拟机，包含倒计时和恢复/删除操作
 * 与VM云主机视图保持一致的数据展示
 */

import React, { useMemo, useCallback, useState, useEffect, useRef } from 'react';
import { Table, Space, message, Modal, Tooltip, App, Badge, Tag, Input, Select, Button, Form, InputNumber, Typography, Checkbox, Popover } from 'antd';
import { DeleteOutlined, ClockCircleOutlined, SafetyCertificateFilled, SearchOutlined, ReloadOutlined, SettingOutlined, WarningOutlined } from '@ant-design/icons';
import { restoreHarvesterVm, forceDeleteHarvesterVm } from '../../../../services/harvesterApi';
import { getSystemSetting, updateSystemSetting } from '../../../../services/systemApi';
import PageDetailSection from '../../../../components/PageDetailSection';
import ResourceActionsDropdown from '../../../../components/ResourceActionsDropdown';
import { cnVmStatus } from '../../../../utils/harvesterUtils';
import { OsIcon } from '../../../../components/OsIcon';
import HarvesterResourceDrawer from '../components/HarvesterOpsinfoDrawer';

interface Props {
  vms: any[];
  loading: boolean;
  cloudId: string;
  onRefresh: () => void;
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
  const { modal } = App.useApp();

  // 筛选状态
  const [keyword, setKeyword] = useState<string>('');
  const [namespaceFilter, setNamespaceFilter] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<string>('');
  
  // 列设置相关状态
  const [columnSettingsVisible, setColumnSettingsVisible] = useState(false);
  const [checkedColumnKeys, setCheckedColumnKeys] = useState<string[]>([]);
  const [columnSettingsInitialized, setColumnSettingsInitialized] = useState(false);
  const allColumnsRef = useRef<any[]>([]);
  const settingsKey = 'harvester_recycle_bin_table';

  // 运维信息抽屉状态
  const [drawerVisible, setDrawerVisible] = useState(false);
  const [currentDrawerRecord, setCurrentDrawerRecord] = useState<any>(null);
  const [drawerActiveTab, setDrawerActiveTab] = useState('detail');

  // 清理周期设置模态框状态
  const [cleanupSettingsModalVisible, setCleanupSettingsModalVisible] = useState(false);
  const [cleanupSettingsLoading, setCleanupSettingsLoading] = useState(false);
  const [cleanupSettingsForm] = Form.useForm();

  // 过滤出回收站中的VM
  const recycledVms = useMemo(() => {
    return vms.filter((vm: any) => {
      const finalizers = vm?.metadata?.finalizers || [];
      const labels = vm?.metadata?.labels || {};
      return finalizers.includes('tower.io/recycle-bin') || labels['tower.io/recycle-bin'] === 'true';
    });
  }, [vms]);

  // 解析存储大小字符串
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

  // 格式化存储大小
  const formatStorageSize = (sizeGiB: number): string => {
    if (sizeGiB === 0) return '-';
    if (sizeGiB < 1) return `${Math.round(sizeGiB * 1024)} MiB`;
    if (sizeGiB >= 1024) return `${(sizeGiB / 1024).toFixed(1)} TiB`;
    return `${parseFloat(sizeGiB.toFixed(1))} GiB`;
  };

  // 获取实例唯一标识
  const getIid = (r: any): string => {
    if (r?.metadata?.name && r?.metadata?.namespace) {
      return `${r.metadata.namespace}/${r.metadata.name}`;
    }
    return String(r?.InstanceId || r?.id || '');
  };

  // 安全读取辅助函数（与VM视图保持一致）
  const SafeRead = useMemo(() => ({
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
    imageDisplayName: (r: any) => {
      // 内联image逻辑避免循环依赖
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

  // 命名空间选项
  const namespaceOptions = useMemo(() => {
    const uniqueNamespaces = Array.from(new Set(recycledVms.map((vm: any) => {
      return vm?.metadata?.namespace || vm?.namespace || '';
    }).filter(Boolean)));
    return uniqueNamespaces.map((ns: string) => ({ value: ns, label: ns }));
  }, [recycledVms]);

  // 状态选项
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

  // 应用筛选后的数据
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

  // 从 filteredVms 中查找最新的记录，确保数据是最新的
  const drawerRecord = useMemo(() => {
    if (!currentDrawerRecord) return null;
    const currentId = SafeRead.uid(currentDrawerRecord);
    return filteredVms.find((v: any) => SafeRead.uid(v) === currentId) || currentDrawerRecord;
  }, [filteredVms, currentDrawerRecord, SafeRead]);

  // 计算倒计时
  const getTimeRemaining = useCallback((expiresAtStr: string) => {
    if (!expiresAtStr) return null;
    const expiresAt = new Date(expiresAtStr);
    const now = new Date();
    const diff = expiresAt.getTime() - now.getTime();
    
    if (diff <= 0) return { expired: true, text: '已过期' };
    
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
    
    return {
      expired: false,
      days,
      hours,
      minutes,
      text: days > 0 ? `${days}天${hours}小时` : `${hours}小时${minutes}分钟`
    };
  }, []);

  // 恢复虚拟机
  const handleRestore = useCallback(async (r: any) => {
    const ns = r?.metadata?.namespace || r?.namespace || '';
    const name = r?.metadata?.name || r?.InstanceId?.split('/')[1] || '';
    const instanceId = `${ns}/${name}`;
    
    try {
      await restoreHarvesterVm(cloudId, instanceId);
      message.success('恢复成功');
      onRefresh();
    } catch (e: any) {
      message.error(`恢复失败: ${e.message}`);
    }
  }, [cloudId, onRefresh]);

  // 显示运维信息抽屉
  const handleShowOpsinfo = useCallback((record: any, tab: string = 'detail') => {
    setCurrentDrawerRecord(record);
    setDrawerActiveTab(tab);
    setDrawerVisible(true);
  }, []);

  // --- Config Dialog Logic (Refactored) ---
  const [configOpen, setConfigOpen] = useState(false);
  const [configLoading, setConfigLoading] = useState(false);
  const [configForm] = Form.useForm();

  // Load config on mount
  useEffect(() => {
    let mounted = true;
    const fetchConfig = async () => {
      try {
        const res = await getSystemSetting('recycleBin.cleanupInterval');
        if (!mounted) return;
        
        const rawVal = res?.data?.value ?? res?.value ?? (typeof res?.data === 'string' ? res.data : undefined);
        let hours = 24;
        if (rawVal) {
          const s = String(rawVal).trim().toLowerCase();
          const matchH = s.match(/^(\d+(?:\.\d+)?)\s*h(?:ours?)?$/);
          const matchD = s.match(/^(\d+(?:\.\d+)?)\s*d(?:ays?)?$/);
          const matchN = s.match(/^(\d+(?:\.\d+)?)$/);
          
          if (matchH) hours = parseFloat(matchH[1]);
          else if (matchD) hours = parseFloat(matchD[1]) * 24;
          else if (matchN) hours = parseFloat(matchN[1]);
        }
        configForm.setFieldsValue({ intervalHours: Math.max(1, Math.round(hours)) });
      } catch (e) {
        console.warn('Failed to load cleanup interval', e);
      }
    };
    fetchConfig();
    return () => { mounted = false; };
  }, []); // Only run once on mount

  const handleSaveConfig = async () => {
    try {
      const values = await configForm.validateFields();
      setConfigLoading(true);
      const val = `${values.intervalHours}h`;
      await updateSystemSetting('recycleBin.cleanupInterval', val);
      message.success('配置已保存');
      setConfigOpen(false);
    } catch (e: any) {
      if (!e?.errorFields) message.error(`保存失败: ${e.message}`);
    } finally {
      setConfigLoading(false);
    }
  };

  // 强制删除虚拟机
  const handleForceDelete = useCallback(async (r: any) => {
    const ns = r?.metadata?.namespace || r?.namespace || '';
    const name = r?.metadata?.name || r?.InstanceId?.split('/')[1] || '';
    const instanceId = `${ns}/${name}`;

    // 获取关联卷信息
    const volDetails = SafeRead.volumeDetails(r);
    const volumeNames = volDetails.filter((v: any) => v.claimName).map((v: any) => v.claimName).join(', ');
    
    // 默认不勾选删除卷，通过闭包变量控制
    let shouldDeleteVolumes = false;
    
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
                   <Checkbox onChange={(e) => { shouldDeleteVolumes = e.target.checked; }}>
                     同步删除关联卷 (PVC)
                   </Checkbox>
                   <div style={{ color: '#999', fontSize: 12, marginLeft: 24, marginTop: 4 }}>
                     注意：勾选后将永久删除关联的数据卷，数据无法找回。
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
          message.success('删除成功');
          onRefresh();
        } catch (e: any) {
          message.error(`删除失败: ${e.message}`);
        }
      },
    });
  }, [cloudId, onRefresh, modal, SafeRead]);

  // 表格列定义（与VM视图保持一致，添加回收站特有列）
  // 使用 useMemo 并稳定化引用，避免不必要的重新计算
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
      title: '剩余时间',
      key: 'timeRemaining',
      render: (_: any, r: any) => {
        const expiresAtStr = r?.metadata?.annotations?.['tower.io/deletion-expires'];
        if (!expiresAtStr) return '-';
        const timeRemaining = getTimeRemaining(expiresAtStr);
        if (!timeRemaining) return '-';
        if (timeRemaining.expired) {
          return <Tag color="red">已过期</Tag>;
        }
        return (
          <Space>
            <ClockCircleOutlined />
            <span>{timeRemaining.text}</span>
          </Space>
        );
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
    // 更新 ref，用于列设置
    allColumnsRef.current = cols;
    return cols;
  }, [SafeRead, getTimeRemaining, handleRestore, handleForceDelete, handleShowOpsinfo, isTenant]);

  // 初始化列设置（只执行一次）
  useEffect(() => {
    if (columnSettingsInitialized || allColumns.length === 0) return;
    
    const allKeys = allColumns
      .map((col) => {
        if (col.key) return String(col.key);
        return '';
      })
      .filter(Boolean);
    
    // 从 localStorage 读取保存的设置
    try {
      const saved = localStorage.getItem(`table_cols_${settingsKey}`);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) {
          // 过滤掉无效的 key
          const validKeys = parsed.filter((k: string) => allKeys.includes(k));
          if (validKeys.length > 0) {
            setCheckedColumnKeys(validKeys);
            setColumnSettingsInitialized(true);
            return;
          }
        }
      }
    } catch (e) {
      console.warn('Failed to load column settings', e);
    }
    
    // 默认全部选中
    setCheckedColumnKeys(allKeys);
    setColumnSettingsInitialized(true);
  }, [allColumns, columnSettingsInitialized, settingsKey]);

  // 根据选中的列键过滤列
  const displayColumns = useMemo(() => {
    if (!columnSettingsInitialized || checkedColumnKeys.length === 0) {
      return allColumns;
    }
    return allColumns.filter((col) => {
      const key = col.key ? String(col.key) : '';
      // 如果没有 key，默认显示（如操作列）
      if (!key) return true;
      return checkedColumnKeys.includes(key);
    });
  }, [allColumns, checkedColumnKeys, columnSettingsInitialized]);

  // 处理列设置变化
  const handleColumnSettingsChange = useCallback((keys: string[]) => {
    setCheckedColumnKeys(keys);
    // 保存到 localStorage
    try {
      localStorage.setItem(`table_cols_${settingsKey}`, JSON.stringify(keys));
    } catch (e) {
      console.warn('Failed to save column settings', e);
    }
  }, [settingsKey]);

  // 列设置内容
  const columnSettingsContent = useMemo(() => {
    const allKeys = allColumns
      .map((col) => {
        const key = col.key ? String(col.key) : '';
        const title = typeof col.title === 'string' ? col.title : key;
        if (!key) return null;
        return { label: title, value: key };
      })
      .filter((opt): opt is { label: string; value: string } => !!opt);

    const handleCheckAll = (e: any) => {
      const allValues = allKeys.map((o) => o.value);
      handleColumnSettingsChange(e.target.checked ? allValues : []);
    };

    return (
      <div style={{ minWidth: 150 }}>
        <div style={{ padding: '4px 8px 8px', borderBottom: '1px solid #f0f0f0' }}>
          <Checkbox
            indeterminate={checkedColumnKeys.length > 0 && checkedColumnKeys.length < allKeys.length}
            onChange={handleCheckAll}
            checked={checkedColumnKeys.length === allKeys.length}
          >
            列展示
          </Checkbox>
        </div>
        <div style={{ padding: '8px', maxHeight: '300px', overflowY: 'auto' }}>
          <Checkbox.Group
            style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}
            options={allKeys}
            value={checkedColumnKeys}
            onChange={(list) => handleColumnSettingsChange(list as string[])}
          />
        </div>
      </div>
    );
  }, [allColumns, checkedColumnKeys, handleColumnSettingsChange]);

  return (
    <PageDetailSection 
      asCard={false}
      toolbarLeft={
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
              className="toolbar-filter-sm"
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
          {(keyword || namespaceFilter || statusFilter) && (
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
          )}
        </>
      }
      toolbarRight={
        <div className="toolbar-actions">
          <Button type="primary"  onClick={() => setConfigOpen(true)}>
            设定清理间隔
          </Button>
          <Popover
            content={columnSettingsContent}
            title={null}
            trigger="click"
            placement="bottomRight"
            open={columnSettingsVisible}
            onOpenChange={setColumnSettingsVisible}
          >
            <Tooltip title="列设置">
              <Button icon={<SettingOutlined />} />
            </Tooltip>
          </Popover>
          <Button icon={<ReloadOutlined />} onClick={() => onRefresh()} loading={loading} />
        </div>
      }
    >
      <Table
        className="std-table"
        bordered
        dataSource={filteredVms}
        columns={displayColumns}
        loading={loading}
        rowKey={(r: any) => SafeRead.uid(r)}
        scroll={{ x: 'max-content' }}
        pagination={{
          size: 'small',
          pageSize: 20,
          showSizeChanger: true,
          showQuickJumper: false,
        }}
        locale={{
          emptyText: '回收站为空',
        }}
      />
      
      {/* 运维信息抽屉 */}
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

      {/* 清理任务执行间隔设置模态框 */}
      <Modal
        title="配置自动清理"
        open={configOpen}
        onOk={handleSaveConfig}
        onCancel={() => {
          setConfigOpen(false);
          // Do not reset fields here, to keep the loaded value for next open
          // configForm.resetFields(); 
        }}
        confirmLoading={configLoading}
        okText="保存"
        cancelText="取消"
        destroyOnClose={false}
      >
        <Form
          form={configForm}
          layout="vertical"
          style={{ marginTop: 16 }}
        >
          <Form.Item required={true} label="清理周期" style={{ marginBottom: 24 }}>
            <Space>
              <span>每间隔</span>
              <Form.Item
                name="intervalHours"
                noStyle
                rules={[
                  { required: true, message: '请输入执行间隔' },
                  { type: 'number', min: 1, max: 168, message: '范围 1-168 小时' }
                ]}
              >
                <InputNumber
                  min={1}
                  max={168}
                  style={{ width: '120px' }}
                  placeholder="24"
                />
              </Form.Item>
              <span>小时，执行一次过期虚拟机清理任务</span>
            </Space>
          </Form.Item>
        </Form>
      </Modal>
    </PageDetailSection>
  );
};

export default RecycleBinSection;
