import React, { useState, useMemo, useCallback } from 'react';
import { Drawer, Tabs, Button, Dropdown, MenuProps, Tag, Tooltip, message, Card, Badge, Descriptions, Collapse, List, Avatar, Space, Radio, Progress, Modal, Checkbox } from 'antd';
import { 
  PlayCircleOutlined, PoweroffOutlined, ReloadOutlined, PauseCircleOutlined, 
  CodeOutlined, EllipsisOutlined, DesktopOutlined, DatabaseOutlined,
  CloudServerOutlined, GlobalOutlined, HddOutlined, ApartmentOutlined,
  ExportOutlined, CopyOutlined, HistoryOutlined, DownOutlined, DeleteOutlined,
  SaveOutlined, StopOutlined, InfoCircleOutlined, ExclamationCircleOutlined, WarningOutlined
} from '@ant-design/icons';
import { cnVmStatus, isSystemNamespace } from '../../../../utils/harvesterUtils';
import { stopHarvesterVm, startHarvesterVm, abortHarvesterMigration, detachHarvesterVolumeFromVm, deleteHarvesterPVC, fetchHarvesterBackups, fetchHarvesterScheduleVmBackups, saveHarvesterVmAsTemplate } from '../../../../services/harvesterApi';
import { rebootCloudProviderEcs } from '../../../../services/api';
import { fetchMetricRange } from '../../../../services/monitoringApi';
import { VMPerformance } from './VMPerformance';
import BackupsSection from '../sections/BackupsSection';
import ScheduleVmBackupsSection from '../sections/ScheduleVmBackupsSection';
import { ReactComponent as CpuIcon } from '../../../../assets/clouds/cpu.svg';
import { ReactComponent as MemIcon } from '../../../../assets/clouds/mem.svg';
import { ReactComponent as DiskIcon } from '../../../../assets/clouds/disk.svg';
import { ReactComponent as NicIcon } from '../../../../assets/clouds/nic.svg';
import HarvesterEventsTab from './HarvesterEventsTab';

interface HarvesterVmDetailDrawerProps {
  open: boolean;
  onClose: () => void;
  record: any;
  cloudId?: string;
  namespaces?: any[];
  volumes?: any[];
  images?: any[];
  activeTab?: string;
  onTabChange?: (key: string) => void;
  onRefresh?: (force?: boolean) => void;
  onOpenReconfigure?: (vm: any) => void;
  onBackup?: (vm: any) => void;
  onSnapshot?: (vm: any) => void;
  onClone?: (vm: any) => void;
  onMigrate?: (vm: any) => void;
  onDelete?: (vm: any) => void;
}

const HarvesterVmDetailDrawer: React.FC<HarvesterVmDetailDrawerProps> = ({
  open,
  onClose,
  record,
  cloudId = '',
  namespaces = [],
  volumes = [],
  images = [],
  activeTab: propActiveTab,
  onTabChange: propOnTabChange,
  onRefresh,
  onOpenReconfigure,
  onBackup,
  onSnapshot,
  onClone,
  onMigrate,
  onDelete,
}) => {
  const [localActiveTab, setLocalActiveTab] = useState('detail');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [savingTemplate, setSavingTemplate] = useState(false);

  // CPU/Memory Usage State
  const [cpuUsage, setCpuUsage] = useState<number | null>(null);
  const [memUsage, setMemUsage] = useState<number | null>(null);

  // Fetch Metrics
  React.useEffect(() => {
    if (!open || !cloudId || !record?.metadata?.namespace || !record?.metadata?.name) return;

    const fetchMetrics = async () => {
      const end = Math.floor(Date.now() / 1000);
      const start = end - 300;
      const step = 15;
      const namespace = record.metadata.namespace;
      const name = record.metadata.name;

      const cpuQuery = `rate(container_cpu_usage_seconds_total{namespace="${namespace}", pod=~"virt-launcher-${name}-.*", container="compute"}[5m])`;
      const memQuery = `container_memory_usage_bytes{namespace="${namespace}", pod=~"virt-launcher-${name}-.*", container="compute"}`;

      try {
        const [cpuRes, memRes] = await Promise.all([
          fetchMetricRange(cloudId, { query: cpuQuery, start, end, step }),
          fetchMetricRange(cloudId, { query: memQuery, start, end, step }),
        ]);

        if (cpuRes.ok && cpuRes.data?.data?.result?.[0]?.values) {
          const values = cpuRes.data.data.result[0].values;
          const lastValue = values[values.length - 1];
          if (lastValue) setCpuUsage(parseFloat(lastValue[1]));
        } else {
          setCpuUsage(null);
        }

        if (memRes.ok && memRes.data?.data?.result?.[0]?.values) {
          const values = memRes.data.data.result[0].values;
          const lastValue = values[values.length - 1];
          if (lastValue) setMemUsage(parseFloat(lastValue[1]));
        } else {
          setMemUsage(null);
        }
      } catch (e) {
        console.error('Fetch metrics failed', e);
      }
    };

    fetchMetrics();
    const interval = setInterval(fetchMetrics, 30000);
    return () => clearInterval(interval);
  }, [open, cloudId, record]);

  // Backups/Snapshots state
  const [backups, setBackups] = useState<any[]>([]);
  const [backupsLoading, setBackupsLoading] = useState(false);

  // Schedules state
  const [schedules, setSchedules] = useState<any[]>([]);
  const [schedulesLoading, setSchedulesLoading] = useState(false);

  const activeTab = propActiveTab !== undefined ? propActiveTab : localActiveTab;

  // Fetch data when tab is active
  React.useEffect(() => {
    if (open) {
      if (activeTab === 'backup_snapshot') {
        fetchBackups();
        fetchSchedules();
      }
    }
  }, [activeTab, open]);

  const fetchBackups = async (force = false) => {
    if (!cloudId) return;
    setBackupsLoading(true);
    try {
      const res = await fetchHarvesterBackups(cloudId, force);
      const items = (res as any)?.data?.items || [];
      setBackups(items);
    } catch (e: any) {
      message.error(`获取备份数据失败: ${e.message}`);
    } finally {
      setBackupsLoading(false);
    }
  };

  const fetchSchedules = async (force = false) => {
    if (!cloudId) return;
    setSchedulesLoading(true);
    try {
      const res = await fetchHarvesterScheduleVmBackups(cloudId, force);
      const items = (res as any)?.data?.items || [];
      setSchedules(items);
    } catch (e: any) {
      message.error(`获取定时策略失败: ${e.message}`);
    } finally {
      setSchedulesLoading(false);
    }
  };

  const handleTabChange = useCallback((key: string) => {
    if (propOnTabChange) {
      propOnTabChange(key);
    } else {
      setLocalActiveTab(key);
    }
  }, [propOnTabChange]);

  // Helper functions (copied/adapted from VmSection)
  const parseStorageSize = (sizeStr: string): number => {
    if (!sizeStr) return 0;
    const str = String(sizeStr).trim();
    if (/^\d+$/.test(str)) return parseFloat(str) / (1024 ** 3);
    const units: Record<string, number> = {
      ki: 1024, mi: 1024 ** 2, gi: 1024 ** 3, ti: 1024 ** 4,
      k: 1000, kb: 1000, m: 1000 ** 2, mb: 1000 ** 2, g: 1000 ** 3, gb: 1000 ** 3, t: 1000 ** 4, tb: 1000 ** 4,
    };
    const match = str.match(/^([\d.]+)\s*([a-zA-Z]+)$/);
    if (!match) return parseFloat(str) || 0;
    const val = parseFloat(match[1]);
    const unit = match[2].toLowerCase();
    const mul = units[unit];
    return mul ? (val * mul) / (1024 ** 3) : val;
  };

  const formatStorageSize = (sizeGiB: number): string => {
    if (sizeGiB === 0) return '-';
    if (sizeGiB < 1) return `${Math.round(sizeGiB * 1024)} MiB`;
    if (sizeGiB >= 1024) return `${(sizeGiB / 1024).toFixed(1)} TiB`;
    return `${parseFloat(sizeGiB.toFixed(1))} GiB`;
  };

  const formatMemoryParts = (val: any): [string, string] => {
    if (!val) return ['-', ''];
    const str = String(val).trim();
    const match = str.match(/^([\d.]+)\s*([a-zA-Z]+)$/);
    if (match) {
        return [match[1], match[2]];
    }
    return [str, ''];
  };

  const SafeRead = useMemo(() => ({
    name: (r: any) => r?.metadata?.annotations?.['tower.io/alias'] || r?.InstanceName || r?.name || r?.metadata?.name || '',
    vmId: (r: any) => r?.metadata?.name || '',
    namespace: (r: any) => r?.metadata?.namespace || r?.namespace || '',
    status: (r: any) => {
        if (typeof r?.status === 'string') return r.status;
        return r?.status?.printableStatus || r?.status?.phase || r?.Status || 'Unknown';
    },
    cpu: (r: any) => {
      const cpu = r?.spec?.template?.spec?.domain?.cpu;
      if (cpu?.cores && cpu?.sockets && cpu?.threads) {
        return Number(cpu.cores) * Number(cpu.sockets) * Number(cpu.threads);
      }
      return r?.cpu || cpu?.cores || r?.vmi?.spec?.domain?.cpu?.cores || 0;
    },
    memory: (r: any) => {
      const lim = r?.spec?.template?.spec?.domain?.resources?.limits?.memory;
      if (lim) return lim;
      const guest = r?.spec?.template?.spec?.domain?.memory?.guest;
      if (guest) return guest;
      return r?.memoryGb || r?.vmi?.spec?.domain?.memory?.guest || '-';
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
    volumeDetails: (r: any) => {
        const vols = r?.spec?.template?.spec?.volumes || [];
        const vmNs = r?.metadata?.namespace || r?.namespace || (r?.id || '').split('/')[0] || '';
        const disks = r?.spec?.template?.spec?.domain?.devices?.disks || [];
        
        // Map disk info to volumes
        return vols.map((v: any) => {
             const claimName = v?.persistentVolumeClaim?.claimName;
             const diskInfo = disks.find((d: any) => d.name === v.name);
             let capacityBytes = 0;
             
             if (claimName && volumes && volumes.length > 0) {
                 const pvc = volumes.find((p: any) => {
                    const pName = p?.metadata?.name || p?.name;
                    const pNs = p?.metadata?.namespace || p?.namespace;
                    if (pName === claimName && pNs === vmNs) return true;
                    return false;
                 });
                 if (pvc) {
                     const actualPvc = pvc?.rawData || pvc;
                     const capStr = actualPvc?.status?.capacity?.storage || actualPvc?.spec?.resources?.requests?.storage || pvc?.size || '';
                     if (capStr) capacityBytes = parseStorageSize(capStr);
                 }
             } else if (v.cloudInitNoCloud || v.cloudInitConfigDrive) {
                 // CloudInit disk
             } else if (v.containerDisk) {
                 // Container disk
             }
             
             return { 
                 name: v.name, 
                 claimName, 
                 capacityBytes, 
                 bootOrder: diskInfo?.bootOrder,
                 bus: diskInfo?.disk?.bus || diskInfo?.cdrom?.bus || '-',
                 type: v.persistentVolumeClaim ? 'Disk' : (v.cloudInitNoCloud || v.cloudInitConfigDrive ? 'CloudInit' : (v.containerDisk ? 'Container' : 'Unknown')),
                 isCdrom: !!diskInfo?.cdrom
             };
        }).sort((a: any, b: any) => (a.bootOrder || 999) - (b.bootOrder || 999));
    },
    interfaces: (r: any) => {
        const ifaces = r?.spec?.template?.spec?.domain?.devices?.interfaces || [];
        const networks = r?.spec?.template?.spec?.networks || [];
        
        return ifaces.map((i: any) => {
            const net = networks.find((n: any) => n.name === i.name);
            let mac = i.macAddress; 
            let ip = '';

            // Helper to extract IP from interface status
            const extractIp = (statusIface: any) => {
                if (statusIface.ipAddress) return statusIface.ipAddress;
                if (Array.isArray(statusIface.ipAddresses) && statusIface.ipAddresses.length > 0) {
                    return statusIface.ipAddresses.join(', ');
                }
                return '';
            };

            // 1. Check VMI status (Most accurate for running VMs)
            if (r?.vmi?.status?.interfaces) {
                const vmiIface = r.vmi.status.interfaces.find((si: any) => si.name === i.name || (mac && si.mac === mac));
                if (vmiIface) {
                    mac = vmiIface.mac || mac;
                    ip = extractIp(vmiIface);
                }
            }

            // 2. Check VM status (Fallback)
            if (!ip && r?.status?.interfaces) {
                 const statusIface = r.status.interfaces.find((si: any) => si.name === i.name || (mac && si.mac === mac));
                 if (statusIface) {
                     mac = statusIface.mac || mac;
                     ip = extractIp(statusIface);
                 }
            }
            
            // 3. Fallback: Check annotations if single interface or no IP found yet
            if (!ip && ifaces.length === 1) {
                try {
                    const annot = r?.metadata?.annotations?.['network.harvesterhci.io/ips'];
                    if (annot) {
                        const ips = JSON.parse(annot);
                        if (Array.isArray(ips)) ip = ips.join(', ');
                    }
                } catch(e) {}
            }

            return {
                name: i.name,
                model: i.model || 'virtio',
                networkName: net?.multus?.networkName || 'Management Network',
                mac: mac,
                ip: ip
            };
        });
    }
  }), [namespaces, volumes, images]);

  // Actions
  const handleStart = async () => {
     try {
         const ns = SafeRead.namespace(record);
         const name = SafeRead.vmId(record);
         await startHarvesterVm(cloudId, ns, name);
         message.success('启动指令已发送');
         onRefresh && onRefresh();
     } catch(e: any) {
         message.error(e.message || '启动失败');
     }
  };

  const handleStop = async (force = false) => {
     try {
         const ns = SafeRead.namespace(record);
         const name = SafeRead.vmId(record);
         await stopHarvesterVm(cloudId, ns, name, force);
         message.success('停止指令已发送');
         onRefresh && onRefresh();
     } catch(e: any) {
         message.error(e.message || '停止失败');
     }
  };

  const handleReboot = async () => {
      try {
          const ns = SafeRead.namespace(record);
          const name = SafeRead.vmId(record);
          // For Harvester, instanceId is namespace/name
          const instanceId = `${ns}/${name}`;
          await rebootCloudProviderEcs(cloudId, instanceId);
          message.success('重启指令已发送');
          onRefresh && onRefresh();
      } catch(e: any) {
          message.error(e.message || '重启失败');
      }
  };

  const handleConsole = async () => {
    const ns = SafeRead.namespace(record);
    const name = SafeRead.vmId(record);
    if (ns && name) {
        const url = `/clouds/${encodeURIComponent(cloudId)}/harvester/vnc?cloudId=${encodeURIComponent(cloudId)}&namespace=${encodeURIComponent(ns)}&name=${encodeURIComponent(name)}`;
        window.open(url, '_blank');
    } else {
        message.warning('无法解析实例信息');
    }
  };

  const handleSaveAsTemplate = useCallback(async () => {
    if (!cloudId) return;
    const ns = SafeRead.namespace(record);
    const vmName = SafeRead.vmId(record);
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
  }, [cloudId, record, SafeRead]);

  const handleEjectCdrom = useCallback(async () => {
    const disks = record?.spec?.template?.spec?.domain?.devices?.disks || [];
    const cdrom = disks[0]; // Assuming first disk check for cdrom property, similar to VmSection logic but safer
    if (!cdrom) return;
    
    const statusStr = String(SafeRead.status(record)).toLowerCase();
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
          const ns = SafeRead.namespace(record);
          const name = SafeRead.vmId(record);
          // Construct iid properly as namespace/name
          const iidStr = `${ns}/${name}`;
          
          if (!ns || !name) throw new Error('无法解析实例信息');

          // 1. Stop VM if running
          if (isRunning) {
              await stopHarvesterVm(cloudId, ns, name, true);
              await new Promise(resolve => setTimeout(resolve, 5000)); // Wait for stop
          }

          // 2. Detach Volume
          await detachHarvesterVolumeFromVm(cloudId, iidStr, { name: cdrom.name });

          // 3. Delete PVC if requested
          if (deletePvc) {
              const volumes = record?.spec?.template?.spec?.volumes || [];
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

          // 4. Start VM if it was running
          if (isRunning) {
              await new Promise(resolve => setTimeout(resolve, 2000));
              await startHarvesterVm(cloudId, ns, name);
          }

          message.success('已发送弹出指令');
          onRefresh && onRefresh();
        } catch(e:any) {
          message.error(`弹出失败: ${e.message}`);
        } finally {
          hide();
        }
      }
    });
  }, [cloudId, record, onRefresh, SafeRead]);

  const status = String(SafeRead.status(record)).toLowerCase();
  const isStopped = ['stopped', 'shutoff', 'down', 'offline'].includes(status);
  const isRunning = ['running'].includes(status);
  const isPaused = ['paused'].includes(status);


  // Check for HotPlugCPUError
  const conditions = record?.status?.conditions || [];
  const hotPlugCpuError = conditions.find((c: any) => c.type === 'Failure' && c.reason === 'HotPlugCPUError' && c.status === 'True');
  
  const vmDisks = SafeRead.volumeDetails(record);
  const vmNics = SafeRead.interfaces(record);

  // Check for CD-ROM
  const rawDisks = record?.spec?.template?.spec?.domain?.devices?.disks || [];
  const isCdromBoot = rawDisks.length > 0 && !!rawDisks[0].cdrom;

  // Toolbar Actions
  const actionItems: MenuProps['items'] = [
      // Data & Replication
      { key: 'backup', label: '备份', icon: <DatabaseOutlined />, onClick: () => onBackup && onBackup(record) },
      { key: 'snapshot', label: '快照', icon: <HistoryOutlined />, onClick: () => onSnapshot && onSnapshot(record) },
      { key: 'clone', label: '克隆', icon: <CopyOutlined />, onClick: () => onClone && onClone(record) },
      { key: 'save_template', label: '保存为模板', icon: <SaveOutlined />, disabled: savingTemplate, onClick: handleSaveAsTemplate },
      
      { type: 'divider' },

      // Runtime Operations
      { key: 'reconfigure', label: '资源变配', icon: <HddOutlined />, onClick: () => onOpenReconfigure && onOpenReconfigure(record) },
      { key: 'migrate', label: '热迁移', icon: <ExportOutlined />, disabled: isStopped, onClick: () => onMigrate && onMigrate(record) },
      ...(isCdromBoot ? [{ key: 'eject', label: '弹出CD-ROM', icon: <StopOutlined />, onClick: handleEjectCdrom }] : []),

      { type: 'divider' },

      // Danger Zone
      { key: 'force_stop', label: '强制停止', icon: <PoweroffOutlined />, danger: true, disabled: isStopped, onClick: () => handleStop(true) },
      { key: 'delete', label: '删除', icon: <DeleteOutlined />, danger: true, onClick: () => onDelete && onDelete(record) },
  ];

  return (
    <Drawer
      open={open}
      onClose={onClose}
      width={900}
      placement="right"
      closable={false}
      styles={{ body: { padding: 0, background: '#f5f7fa', display: 'flex', flexDirection: 'column' } }}
    >
      {/* Custom Header */}
      <div style={{ background: '#f5f7fa', padding: '16px 24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0 }}>
         <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ 
                fontSize: 24, 
                color: '#1890ff',
                width: 38,
                height: 38,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
            }}>
                <DesktopOutlined />
            </div>
            <div>
                <div style={{ fontSize: 18, fontWeight: 500, lineHeight: 1.2 }}>{SafeRead.name(record)}</div>
                <div style={{ fontSize: 12, color: '#999'}}>ID: {SafeRead.vmId(record)}</div>
            </div>
            <Tag color={isRunning ? 'success' : 'default'} style={{ margin: 0}}>{cnVmStatus(status)}</Tag>

            {hotPlugCpuError && (
              <Tooltip title={`CPU 热插拔失败: ${hotPlugCpuError.message || '未知错误'}`}>
                <Tag color="error" style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 4 }}>
                  <ExclamationCircleOutlined /> CPU 热插拔失败
                </Tag>
              </Tooltip>
            )}
         </div>
         <Button type="text" onClick={onClose} style={{ fontSize: 16 }}>×</Button>
      </div>

      {/* Toolbar */}
      <div style={{ background: '#f5f7fa', padding: '0 24px 16px', flexShrink: 0 }}>
        <div style={{ padding: 10, background: '#fff', borderRadius: 8, border: '1px solid #e8e8e8', display: 'flex', gap: 4, alignItems: 'center' }}>
          <Button type="text" size="small" icon={<CodeOutlined style={{ color: isStopped ? undefined : '#1890ff' }} />} onClick={handleConsole} disabled={isStopped} style={{ fontSize: 14 }}>打开终端</Button>
          
          <Button type="text" size="small" icon={<PlayCircleOutlined style={{ color: isStopped ? '#1890ff' : undefined }} />} onClick={handleStart} disabled={!isStopped} style={{ fontSize: 14 }}>开机</Button>

          <Button type="text" size="small" icon={<PoweroffOutlined style={{ color: isStopped ? undefined : '#1890ff' }} />} onClick={() => handleStop(false)} disabled={isStopped} style={{ fontSize: 14 }}>关机</Button>

          <Button type="text" size="small" icon={<ReloadOutlined style={{ color: isStopped ? undefined : '#1890ff' }} />} onClick={handleReboot} disabled={isStopped} style={{ fontSize: 14 }}>重启</Button>

          <Button type="text" size="small" icon={<PauseCircleOutlined style={{ color: isRunning ? '#1890ff' : undefined }} />} disabled={!isRunning} style={{ fontSize: 14 }}>暂停</Button>

          <Button type="text" size="small" icon={<PlayCircleOutlined style={{ color: isPaused ? '#1890ff' : undefined }} />} disabled={!isPaused} style={{ fontSize: 14 }}>恢复</Button>

          <div style={{ flex: 1 }} />
          
          <Dropdown menu={{ items: actionItems }} trigger={['click']}>
              <Button type="text" size="small" icon={<EllipsisOutlined style={{ color: '#1890ff' }} />} />
          </Dropdown>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ background: '#f5f7fa', padding: '0 24px', flexShrink: 0 }}>
          <Tabs 
            type="card"
            size='small'
            activeKey={activeTab} 
            onChange={handleTabChange}
            tabBarStyle={{ borderBottom: '1px solid #e8e8e8'}}
            items={[
                { key: 'detail', label: '详情' },
                { key: 'performance', label: '性能' },
                { key: 'backup_snapshot', label: '备份/快照' },
                { key: 'events', label: '事件' },
            ]}
          />
      </div>

      {/* Content */}
      <style>{`
          .minimal-scroll::-webkit-scrollbar {
              width: 6px;
              height: 6px;
          }
          .minimal-scroll::-webkit-scrollbar-track {
              background: transparent;
          }
          .minimal-scroll::-webkit-scrollbar-thumb {
              background: #e0e0e0;
              border-radius: 3px;
          }
          .minimal-scroll::-webkit-scrollbar-thumb:hover {
              background: #ccc;
          }
          .minimal-scroll::-webkit-scrollbar-button {
              display: none;
          }
      `}</style>
      <div className="minimal-scroll" style={{ padding: '0 24px 24px', flex: 1, overflowY: 'auto' }}>
          {activeTab === 'detail' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
                  {/* CPU/Memory Card */}
                  <Card bordered={false} bodyStyle={{ padding: 16 }}>
                      <div style={{ display: 'flex', gap: 24 }}>
                          {/* CPU Section */}
                          <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 12 }}>
                                  <div style={{ 
                                    width: 48, height: 48, borderRadius: 8, background: '#ffffff', border: '1px solid #188fff80',
                                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                                    color: '#1890ff', fontSize: 24
                                }}>
                                    <CpuIcon width={28} height={28} style={{ fill: '#1890ff' }} />
                                </div>
                                  <div>
                                      <div style={{ color: '#999', fontSize: 12 }}>CPU</div>
                                      <div style={{ fontSize: 20, fontWeight: 500 }}>
                                          {SafeRead.cpu(record)} <span style={{ fontSize: 14, color: '#999', fontWeight: 400 }}>Core</span>
                                      </div>
                                  </div>
                              </div>
                              {SafeRead.cpu(record) > 0 && (
                                  <div>
                                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: '#666', marginBottom: 4 }}>
                                          <span>使用率</span>
                                          <span>{cpuUsage !== null ? `${((cpuUsage / SafeRead.cpu(record)) * 100).toFixed(1)}%` : '-'}</span>
                                      </div>
                                      <Progress 
                                        percent={cpuUsage !== null ? parseFloat(((cpuUsage / SafeRead.cpu(record)) * 100).toFixed(1)) : 0} 
                                        showInfo={false} 
                                        strokeColor="#1890ff"
                                        trailColor="#f0f0f0"
                                        size="small"
                                      />
                                  </div>
                              )}
                          </div>
                          
                          <div style={{ width: 1, background: '#f0f0f0' }} />

                          {/* Memory Section */}
                          <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 12 }}>
                                  <div style={{ 
                                    width: 48, height: 48, borderRadius: 8, background: '#ffffff', border: '1px solid #188fff80',
                                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                                    color: '#1890ff', fontSize: 24
                                }}>
                                    <MemIcon width={28} height={28} style={{ fill: '#1890ff' }} />
                                </div>
                                  <div>
                                      <div style={{ color: '#999', fontSize: 12 }}>内存</div>
                                      <div style={{ fontSize: 20, fontWeight: 500 }}>
                                          {(() => {
                                              const [val, unit] = formatMemoryParts(SafeRead.memory(record));
                                              return <>{val} <span style={{ fontSize: 14, color: '#999', fontWeight: 400 }}>{unit}</span></>;
                                          })()}
                                      </div>
                                  </div>
                              </div>
                              {parseStorageSize(SafeRead.memory(record)) > 0 && (
                                  <div>
                                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: '#666', marginBottom: 4 }}>
                                          <span>使用率</span>
                                          <span>{memUsage !== null ? `${((memUsage / (1024 ** 3) / parseStorageSize(SafeRead.memory(record))) * 100).toFixed(1)}%` : '-'}</span>
                                      </div>
                                      <Progress 
                                        percent={memUsage !== null ? parseFloat(((memUsage / (1024 ** 3) / parseStorageSize(SafeRead.memory(record))) * 100).toFixed(1)) : 0} 
                                        showInfo={false} 
                                        strokeColor="#1890ff"
                                        trailColor="#f0f0f0"
                                        size="small"
                                      />
                                  </div>
                              )}
                          </div>
                      </div>

                      <div style={{ marginTop: 16, textAlign: 'center' }}>
                          <Button 
                              type="link" 
                              size="small" 
                              onClick={() => setShowAdvanced(!showAdvanced)}
                              style={{ color: '#999', fontSize: 12 }}
                          >
                              {showAdvanced ? '收起详细信息' : '查看详细信息'} <DownOutlined rotate={showAdvanced ? 180 : 0} />
                          </Button>
                      </div>

                      {showAdvanced && (
                          <div style={{ marginTop: 16, paddingTop: 16, borderTop: '1px solid #f0f0f0' }}>
                              <Descriptions size="small" column={2}>
                                  <Descriptions.Item label="CPU 插槽">{record?.spec?.template?.spec?.domain?.cpu?.sockets || '-'}</Descriptions.Item>
                                  <Descriptions.Item label="CPU 核心">{record?.spec?.template?.spec?.domain?.cpu?.cores || '-'}</Descriptions.Item>
                                  <Descriptions.Item label="CPU 线程">{record?.spec?.template?.spec?.domain?.cpu?.threads || '-'}</Descriptions.Item>
                                  <Descriptions.Item label="机器类型">{record?.spec?.template?.spec?.architecture || '-'} ({record?.spec?.template?.spec?.domain?.machine?.type || '-'})</Descriptions.Item>
                                  <Descriptions.Item label="内存请求">{record?.spec?.template?.spec?.domain?.resources?.requests?.memory || '-'}</Descriptions.Item>
                                  <Descriptions.Item label="内存限制">{record?.spec?.template?.spec?.domain?.resources?.limits?.memory || '-'}</Descriptions.Item>
                              </Descriptions>
                          </div>
                      )}
                  </Card>

                  {/* Disks */}
                  <div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                          <span style={{ color: '#666' }}>虚拟磁盘</span>
                      </div>
                      <Card bordered={false} bodyStyle={{ padding: 0 }}>
                          <List
                            dataSource={vmDisks}
                            renderItem={(item: any, index: number) => (
                                <List.Item style={{ padding: '16px 24px' }}>
                                    <List.Item.Meta
                                        avatar={
                                            <div style={{ 
                                                width: 48, height: 48, borderRadius: 8, background: '#ffffff',
                                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                                flexShrink: 0 
                                            }}>
                                                <DiskIcon width={38} height={38} style={{ fill: '#1890ff' }} />
                                            </div>
                                        }
                                        title={
                                            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                                                <span>{item.name}</span>
                                                {item.bootOrder === 1 && <Tag color="orange" style={{ fontSize: 10 }}>BOOT</Tag>}
                                            </div>
                                        }
                                        description={
                                            <div style={{ fontSize: 12 }}>
                                                <span>{formatStorageSize(item.capacityBytes)}</span>
                                                <span style={{ margin: '0 8px', color: '#eee' }}>|</span>
                                                <span>{item.bus.toUpperCase()}</span>
                                                {item.isCdrom && <span style={{ marginLeft: 8 }}>(CD-ROM)</span>}
                                            </div>
                                        }
                                    />
                                    {item.claimName && (
                                        <div style={{ maxWidth: 300, fontSize: 12, background: '#f5f7fa', padding: '4px 8px', borderRadius: 4 }}>
                                            <HddOutlined style={{ marginRight: 4 }} />
                                            {item.claimName}
                                        </div>
                                    )}
                                </List.Item>
                            )}
                          />
                      </Card>
                  </div>

                  {/* NICs */}
                  <div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                          <span style={{ color: '#666' }}>虚拟网卡</span>
                      </div>
                      <Card bordered={false} bodyStyle={{ padding: 0 }}>
                          <List
                            dataSource={vmNics}
                            renderItem={(item: any) => (
                                <List.Item style={{ padding: '16px 24px' }}>
                                    <List.Item.Meta
                                        avatar={
                                            <div style={{ 
                                                width: 48, height: 48, borderRadius: 8, background: '#ffffff',
                                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                                flexShrink: 0 
                                            }}>
                                                <NicIcon width={38} height={38} style={{ fill: '#1890ff' }} />
                                            </div>
                                        }
                                        title={item.name}
                                        description={
                                            <div style={{ fontSize: 12 }}>
                                                <span>{item.mac}</span>
                                                {item.ip && (
                                                    <>
                                                        <span style={{ margin: '0 8px', color: '#eee' }}>|</span>
                                                        <span>{item.ip}</span>
                                                    </>
                                                )}
                                            </div>
                                        }
                                    />
                                    <div style={{ maxWidth: 300, fontSize: 12, background: '#f5f7fa', padding: '4px 8px', borderRadius: 4 }}>
                                        <ApartmentOutlined style={{ marginRight: 4 }} />
                                        {item.networkName}
                                    </div>
                                </List.Item>
                            )}
                          />
                      </Card>
                  </div>

                  {/* 其它选项 */}
                  <div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                          <span style={{ color: '#666' }}>其他选项</span>
                      </div>
                      <Card bordered={false} bodyStyle={{ padding: '16px 24px' }}>
                          <Descriptions column={1} size="small" labelStyle={{ width: 120, color: '#999' }}>
                              <Descriptions.Item label="Guest Agent">
                                  {record?.spec?.template?.spec?.domain?.devices?.inputs?.some((i: any) => i.type === 'tablet' && i.bus === 'usb') ? '已启用 (USB Tablet)' : '未启用'}
                              </Descriptions.Item>
                              <Descriptions.Item label="Cloud-Init">
                                  <div className="minimal-scroll" style={{ maxHeight: 200, overflow: 'auto', background: '#f5f5f5', padding: 8, borderRadius: 4, width: '100%' }}>
                                      <pre style={{ margin: 0, fontSize: 12, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                                          {record?.spec?.template?.spec?.volumes?.find((v: any) => v.cloudInitNoCloud || v.cloudInitConfigDrive)?.cloudInitNoCloud?.userData || 
                                           record?.spec?.template?.spec?.volumes?.find((v: any) => v.cloudInitNoCloud || v.cloudInitConfigDrive)?.cloudInitConfigDrive?.userData || 
                                           '未配置'}
                                      </pre>
                                  </div>
                              </Descriptions.Item>
                              <Descriptions.Item label="SSH Keys">
                                  {(() => {
                                      try {
                                          const sshNames = JSON.parse(record?.spec?.template?.metadata?.annotations?.['harvesterhci.io/sshNames'] || '[]');
                                          return sshNames.length > 0 ? (
                                              <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                                                  {sshNames.map((name: string) => (
                                                      <Tag key={name}>{name}</Tag>
                                                  ))}
                                              </div>
                                          ) : '无';
                                      } catch {
                                          return '无';
                                      }
                                  })()}
                              </Descriptions.Item>
                              <Descriptions.Item label="运行策略">
                                  {record?.spec?.runStrategy || 'RerunOnFailure'}
                              </Descriptions.Item>
                              <Descriptions.Item label="固件/TPM">
                                  <Space direction="vertical" size={0}>
                                      <div>EFI: {record?.spec?.template?.spec?.domain?.firmware?.bootloader?.efi ? '启用' : '未启用'}</div>
                                      <div>Secure Boot: {record?.spec?.template?.spec?.domain?.firmware?.bootloader?.efi?.secureBoot ? '启用' : '未启用'}</div>
                                      <div>TPM: {record?.spec?.template?.spec?.domain?.devices?.tpm ? '启用' : '未启用'}</div>
                                  </Space>
                              </Descriptions.Item>
                          </Descriptions>
                      </Card>
                  </div>
              </div>
          )}
          
          {activeTab === 'performance' && (
              <VMPerformance 
                  cloudId={cloudId} 
                  namespace={SafeRead.namespace(record)} 
                  name={SafeRead.vmId(record)} 
              />
          )}

          {activeTab === 'backup_snapshot' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
                  {/* Backup Section */}
                  <div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                          <span style={{ color: '#666' }}>备份</span>
                      </div>
                      <Card bordered={false} bodyStyle={{ padding: 16 }}>
                          <BackupsSection 
                              cloudId={cloudId}
                              backups={backups}
                              loading={backupsLoading}
                              onRefresh={() => fetchBackups(true)}
                              namespaces={namespaces}
                              vms={[record]}
                              type="backup"
                              vmId={SafeRead.vmId(record)}
                              bordered={false}
                          />
                      </Card>
                  </div>

                  {/* Snapshot Section */}
                  <div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                          <span style={{ color: '#666' }}>快照</span>
                      </div>
                      <Card bordered={false} bodyStyle={{ padding: 16 }}>
                          <BackupsSection 
                              cloudId={cloudId}
                              backups={backups}
                              loading={backupsLoading}
                              onRefresh={() => fetchBackups(true)}
                              namespaces={namespaces}
                              vms={[record]}
                              type="snapshot"
                              vmId={SafeRead.vmId(record)}
                              bordered={false}
                          />
                      </Card>
                  </div>

                  {/* Schedule Section */}
                  <div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                          <span style={{ color: '#666' }}>定时策略</span>
                      </div>
                      <Card bordered={false} bodyStyle={{ padding: 16 }}>
                          <ScheduleVmBackupsSection 
                              cloudId={cloudId}
                              data={schedules}
                              loading={schedulesLoading}
                              onRefresh={() => fetchSchedules(true)}
                              vmId={SafeRead.vmId(record)}
                              defaultHiddenColumns={['id', 'namespace', 'retention', 'maxFailure', 'age']}
                              bordered={false}
                          />
                      </Card>
                  </div>
              </div>
          )}
          
          {activeTab === 'events' && (
              <Card bordered={false} bodyStyle={{ padding: 0, height: '100%' }} style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
                 <HarvesterEventsTab 
                    cloudId={cloudId} 
                    record={record} 
                    active={activeTab === 'events'} 
                    kind="VirtualMachine"
                 />
              </Card>
          )}
      </div>
    </Drawer>
  );
};

export default HarvesterVmDetailDrawer;
