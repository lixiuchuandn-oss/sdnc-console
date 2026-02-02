import React, { useState, useMemo, useEffect, useRef } from 'react';
import { Table, Badge, Tooltip, Tag, Space, Input, Modal, Tabs, MenuProps, message, Select, Checkbox } from 'antd';
import { QuestionCircleOutlined } from '@ant-design/icons';
import { useNavigate, useLocation } from 'react-router-dom';
import SharedToolbar from '../../../components/SharedToolbar';
import ResourceActionsDropdown from '../../../components/ResourceActionsDropdown';
import { DEFAULT_PAGINATION_CONFIG } from '../../../constants/pagination';
import { 
  startCloudProviderEcs, 
  stopCloudProviderEcs, 
  rebootCloudProviderEcs, 
  softRebootCloudProviderEcs, 
  pauseCloudProviderEcs, 
  unpauseCloudProviderEcs, 
  deleteCloudProviderEcs,
  fetchHarvesterStorageClasses,
  API_BASE_URL
} from '../../../services/api';
import VmReconfigureModal from '../Harvester/modals/VmReconfigureModal';
import { memoryUsage } from 'process';

interface Props {
  dataSource: any[];
  loading: boolean;
  isHarvester: boolean;
  onRefresh?: () => void;
  // Parent can still pass visibleColumns if it wants to control it, but we'll default to internal state
  visibleColumns?: string[];
  images?: any[];
  cloudId?: string;
}

export const ECS_COLUMNS_CONFIG = [
  { label: '名称', value: 'name', disabled: true },
  { label: 'UID', value: 'uid' },
  { label: 'Namespace', value: 'namespace' },
  { label: '状态', value: 'status' },
  { label: '架构', value: 'architecture' },
  { label: '机型', value: 'machineType' },
  { label: 'CPU', value: 'cpu' },
  { label: 'CPU使用率', value: 'cpuUsage' },
  { label: '内存', value: 'memory' },
  { label: '内存使用率', value: 'memoryUsage' },
  { label: '操作系统', value: 'os' },
  { label: '镜像 名称', value: 'imageName' },
  { label: '镜像 ID', value: 'image' },
  { label: '磁盘 (PVC)', value: 'volumes' },
  { label: 'IP地址', value: 'ips' },
  { label: '网络', value: 'networks' },
  { label: 'MAC地址', value: 'mac' },
  { label: '节点', value: 'node' },
  { label: '运行策略', value: 'runStrategy' },
  { label: '创建者', value: 'creator' },
  { label: '创建时间', value: 'createdAt' },
  { label: '存活时间', value: 'uptime' },
  { label: '描述', value: 'description' },
];

const statusMark = (raw: any) => {
  const v = String(raw || '').toLowerCase();
  // Harvester/K8s statuses
  if (['running', 'succeeded'].includes(v)) return <Badge status="success" text="运行中" />;
  if (['starting', 'provisioning', 'waitingforvolumebinding'].includes(v)) return <Badge status="processing" text={v === 'waitingforvolumebinding' ? '等待卷绑定' : '启动中'} />;
  if (['stopping', 'terminating'].includes(v)) return <Badge status="warning" text="停止中" />;
  if (['stopped', 'terminated', 'failed', 'completed', 'crashloopbackoff'].includes(v)) return <Badge status="default" text={v === 'stopped' ? '已停止' : v} />;
  
  // Standard Cloud statuses
  if (['healthy', 'ok'].includes(v)) return <Badge status="success" text="运行中" />;
  if (['warning', 'degraded'].includes(v)) return <Badge status="warning" text="告警" />;
  if (['error', 'unhealthy'].includes(v)) return <Badge status="error" text="异常" />;
  if (['offline'].includes(v)) return <Badge status="default" text="已停止" />;
  
  return <Badge status="default" text={v || '未知'} />;
};

const getVmImageId = (r: any) => {
  let imgId = r?.metadata?.annotations?.['harvesterhci.io/imageId'];
  if (!imgId) {
     try {
         const vct = r?.metadata?.annotations?.['harvesterhci.io/volumeClaimTemplates'];
         if (vct) {
             const templates = JSON.parse(vct);
             if (Array.isArray(templates)) {
                 for (const t of templates) {
                     if (t?.metadata?.annotations?.['harvesterhci.io/imageId']) {
                         imgId = t.metadata.annotations['harvesterhci.io/imageId'];
                         break;
                     }
                 }
             }
         }
     } catch (e) {}
  }
  return imgId;
};

const parseMemory = (mem: string) => {
    if (!mem) return 0;
    const m = String(mem).toLowerCase();
    let num = parseFloat(m);
    if (isNaN(num)) return 0;
    if (m.includes('ti')) num *= 1024 * 1024 * 1024 * 1024;
    else if (m.includes('gi')) num *= 1024 * 1024 * 1024;
    else if (m.includes('mi')) num *= 1024 * 1024;
    else if (m.includes('ki')) num *= 1024;
    return num;
};

const formatDuration = (ms: number) => {
    if (ms < 0) return '-';
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 0) return `${days}天 ${hours % 24}小时`;
    if (hours > 0) return `${hours}小时 ${minutes % 60}分钟`;
    if (minutes > 0) return `${minutes}分钟 ${seconds % 60}秒`;
    return `${seconds}秒`;
};

const CloudConsoleEcsTable: React.FC<Props> = ({ 
  dataSource, 
  loading, 
  isHarvester, 
  onRefresh,
  visibleColumns: propVisibleColumns,
  images = [],
  cloudId
}) => {
  const navigate = useNavigate();
  const location = useLocation();
  // Local state for columns
  const [visibleColumns, setVisibleColumns] = useState<string[]>(
    propVisibleColumns || 
    ECS_COLUMNS_CONFIG
      .filter(c => !['uid', 'namespace', 'architecture', 'machineType', 'cpuUsage', 'memoryUsage', 'os', 'image', 'volumes', 'mac', 'node', 'runStrategy', 'creator', 'createdAt', 'description'].includes(c.value))
      .map(c => c.value)
  );

  // Local Data Source for SSE
  const [localDataSource, setLocalDataSource] = useState<any[]>(dataSource);

  // Refs for SSE to access latest state without re-triggering effect
  const dataSourceRef = useRef(localDataSource);
  const onRefreshRef = useRef(onRefresh);
  const loadingRef = useRef(loading);

  useEffect(() => {
    dataSourceRef.current = localDataSource;
  }, [localDataSource]);

  useEffect(() => {
    onRefreshRef.current = onRefresh;
  }, [onRefresh]);

  useEffect(() => {
    loadingRef.current = loading;
  }, [loading]);

  useEffect(() => {
    setLocalDataSource(dataSource);
  }, [dataSource]);

  // SSE Effect
  useEffect(() => {
    if (!isHarvester || !cloudId) return;

    let es: EventSource | null = null;
    try {
      const token = localStorage.getItem('token') || '';
          const url = `${API_BASE_URL}/api/clouds/${cloudId}/resources/ecs/stream${token ? `?token=${encodeURIComponent(token)}` : ''}`;
          console.log('[SSE] Connecting to:', url);
          es = new EventSource(url);

          es.onopen = () => {
             console.log('[SSE] Connection opened');
          };

          es.onerror = (err) => {
             console.error('[SSE] Connection error:', err);
             // EventSource will retry automatically, but logging helps
          };

          es.addEventListener('vms', (ev: MessageEvent) => {
        try {
          const json = JSON.parse(String(ev.data || '{}'));
          const items: any[] = Array.isArray(json?.items) ? json.items : [];
          // Only update if we have items, to avoid clearing on empty initial push if that happens (though backend sends full list)
          if (items.length > 0 || json?.items?.length === 0) {
             setLocalDataSource(items);
          }
        } catch {}
      });

      es.addEventListener('vm_created', (ev: MessageEvent) => {
        try {
          const json = JSON.parse(String(ev.data || '{}'));
          const r = json?.item || (json?.metadata ? json : null);
          if (!r) return;
          setLocalDataSource(prev => {
             const iid = String(r?.id || r?.metadata?.uid || '');
             // Check existence
             if (iid && prev.some((x: any) => String(x?.id || x?.metadata?.uid || '') === iid)) return prev;
             return [r, ...prev];
          });
          // Trigger refresh to ensure consistency
          if (!loadingRef.current && onRefreshRef.current) {
              onRefreshRef.current();
          }
        } catch {}
      });

      es.addEventListener('vm_deleted', (ev: MessageEvent) => {
        try {
           const json = JSON.parse(String(ev.data || '{}'));
           const iid = String(json?.iid || json?.id || json?.uid || '');
           if (!iid) return;
           setLocalDataSource(prev => prev.filter((x: any) => String(x?.id || x?.metadata?.uid || '') !== iid));
           // Trigger refresh to ensure consistency
           if (!loadingRef.current && onRefreshRef.current) {
               onRefreshRef.current();
           }
        } catch {}
      });

      es.addEventListener('vm_status', (ev: MessageEvent) => {
        try {
           const json = JSON.parse(String(ev.data || '{}'));
           const iid = String(json?.iid || '');
           const status = String(json?.status || '');
           if (!iid) return;

           // Check if VM exists in current list
           const exists = dataSourceRef.current.some((x: any) => String(x?.id || x?.metadata?.uid || '') === iid);
           
           if (!exists) {
               // If VM not found and not currently loading, trigger refresh to fetch new VM
               if (!loadingRef.current && onRefreshRef.current) {
                   console.log('[SSE] Unknown VM status received, refreshing list...', iid);
                   onRefreshRef.current();
               }
               return;
           }

           setLocalDataSource(prev => prev.map((x: any) => {
              if (String(x?.id || x?.metadata?.uid || '') === iid) {
                 // Update status fields
                 const newStatus = { ...(x.status || {}), printableStatus: status, phase: status };
                 const nodeName = String(json?.nodeName || '');
                 const newItem = { ...x, status: newStatus, Status: status };
                 
                 // Always update NodeName
                 if (!newItem.Extra) newItem.Extra = {};
                 newItem.Extra.NodeName = nodeName;
                 if (!newItem.vmi) newItem.vmi = { status: {} };
                 if (!newItem.vmi.status) newItem.vmi.status = {};
                 newItem.vmi.status.nodeName = nodeName;

                 return newItem;
              }
              return x;
           }));
        } catch {}
      });

    } catch (e) {
      console.error('SSE Error:', e);
    }

    return () => {
      if (es) {
        es.close();
      }
    };
  }, [isHarvester, cloudId]);

  
  // Local state for search
  const [keyword, setKeyword] = useState('');
  const [statusFilter, setStatusFilter] = useState<string | undefined>(undefined);
  
  // Selection state
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([]);
  const [selectedRows, setSelectedRows] = useState<any[]>([]);

  // Reconfigure Modal State
  const [reconfigureModalOpen, setReconfigureModalOpen] = useState(false);
  const [currentRecord, setCurrentRecord] = useState<any>(null);
  const [reconfigureType, setReconfigureType] = useState<string>('spec');
  const [storageClasses, setStorageClasses] = useState<any[]>([]);

  const rowSelection = {
    selectedRowKeys,
    onChange: (keys: React.Key[], rows: any[]) => {
      setSelectedRowKeys(keys);
      setSelectedRows(rows);
    },
  };

  const handleBatchAction = async (key: string) => {
    if (!cloudId || selectedRows.length === 0) return;

    const actionMap: Record<string, string> = {
      start: '启动',
      stop: '停止',
      reboot: '重启',
      delete: '删除',
    };
    const actionName = actionMap[key] || '操作';

    const executeBatch = async (deleteVolumes?: boolean) => {
      const hide = message.loading(`正在批量${actionName}...`, 0);
      try {
        const promises = selectedRows.map(row => {
          const name = row.metadata?.name || row.name || row.InstanceName;
          const namespace = row.metadata?.namespace || 'default';
          const instanceId = isHarvester ? `${namespace}/${name}` : (row.id || row.InstanceId);
          
          switch (key) {
            case 'start': return startCloudProviderEcs(cloudId, instanceId);
            case 'stop': return stopCloudProviderEcs(cloudId, instanceId);
            case 'reboot': return rebootCloudProviderEcs(cloudId, instanceId);
            case 'delete': return deleteCloudProviderEcs(cloudId, instanceId, undefined, deleteVolumes);
            default: return Promise.resolve();
          }
        });

        await Promise.all(promises);
        hide();
        message.success(`批量${actionName}指令已发送`);
        setSelectedRowKeys([]);
        setSelectedRows([]);
        if (onRefresh) onRefresh();
      } catch (e: any) {
        hide();
        message.error(`批量${actionName}失败: ${e.message || '未知错误'}`);
      }
    };

    if (key === 'delete') {
      let deleteVolumes = false;
      Modal.confirm({
        title: '确认批量删除',
        content: (
          <div>
            <p>{`确定要删除选中的 ${selectedRows.length} 台实例吗？此操作不可恢复。`}</p>
            <Checkbox onChange={(e: any) => { deleteVolumes = e.target.checked; }}>
              同步删除关联的虚拟卷
            </Checkbox>
          </div>
        ),
        okType: 'danger',
        onOk: () => executeBatch(deleteVolumes),
      });
    } else {
      Modal.confirm({
        title: `确认批量${actionName}`,
        content: `确定要${actionName}选中的 ${selectedRows.length} 台实例吗？`,
        onOk: () => executeBatch(),
      });
    }
  };

  const handleMenuClick = async (key: string, record: any) => {
    if (!cloudId) {
      message.error('缺少资源池信息，无法执行操作');
      return;
    }

    const name = record.metadata?.name || record.name || record.InstanceName;
    const namespace = record.metadata?.namespace || 'default';
    const instanceId = isHarvester ? `${namespace}/${name}` : (record.id || record.InstanceId);

    // Handle Reconfigure Actions
    const reconfigureKeys = [
      'change_spec', 'cpu_advanced', 'mem_advanced', 'change_gpu',
      'change_os', 'expand_system_disk', 'add_disk', 'resize_disk', 'remove_disk',
      'change_primary_nic', 'change_secondary_nic'
    ];
    
    if (reconfigureKeys.includes(key)) {
       setCurrentRecord(record);
       setReconfigureType(key);
       setReconfigureModalOpen(true);
       
       // Lazy load storage classes for relevant actions
       if (['change_os', 'add_disk'].includes(key) && storageClasses.length === 0) {
           try {
               const res = await fetchHarvesterStorageClasses(cloudId);
               setStorageClasses(Array.isArray(res) ? res : (res?.items || []));
           } catch (e) {
               console.error('Failed to fetch storage classes', e);
           }
       }
       return;
    }

    try {
      switch (key) {
        case 'start':
          await startCloudProviderEcs(cloudId, instanceId);
          message.success('启动指令已发送');
          break;
        case 'stop':
          await stopCloudProviderEcs(cloudId, instanceId);
          message.success('停止指令已发送');
          break;
        case 'reboot':
          await rebootCloudProviderEcs(cloudId, instanceId);
          message.success('重启指令已发送');
          break;
        case 'softreboot':
          await softRebootCloudProviderEcs(cloudId, instanceId);
          message.success('软重启指令已发送');
          break;
        case 'pause':
          await pauseCloudProviderEcs(cloudId, instanceId);
          message.success('暂停指令已发送');
          break;
        case 'unpause':
          await unpauseCloudProviderEcs(cloudId, instanceId);
          message.success('恢复指令已发送');
          break;
        case 'delete':
          let deleteVolumes = false;
          Modal.confirm({
            title: '确认删除',
            content: (
              <div>
                <p>{`确定要删除实例 ${name} 吗？此操作不可恢复。`}</p>
                <Checkbox onChange={(e: any) => { deleteVolumes = e.target.checked; }}>
                  同步删除关联的虚拟卷
                </Checkbox>
              </div>
            ),
            okType: 'danger',
            onOk: async () => {
              try {
                await deleteCloudProviderEcs(cloudId, instanceId, undefined, deleteVolumes);
                message.success('删除指令已发送');
                if (onRefresh) onRefresh();
              } catch (e: any) {
                message.error(e.message || '删除失败');
              }
            }
          });
          return;
        default:
          message.info('功能开发中...');
          break;
      }
      // Remove auto-refresh for operations as SSE handles status updates now
      // if (onRefresh && key !== 'delete') {
      //   setTimeout(onRefresh, 1000);
      // }
    } catch (error: any) {
      message.error(error.message || '操作失败');
    }
  };

  const filteredDataSource = useMemo(() => {
    let result = localDataSource;

    // 1. Status Filter
    if (statusFilter) {
      result = result.filter(item => {
        const rawStatus = String(item.status?.printableStatus || item.status?.phase || item.Status || 'Unknown').toLowerCase();
        
        switch (statusFilter) {
          case 'running':
            return ['running', 'succeeded', 'healthy', 'ok'].includes(rawStatus);
          case 'stopped':
            return ['stopped', 'terminated', 'offline'].includes(rawStatus);
          case 'starting':
            return ['starting', 'provisioning'].includes(rawStatus);
          case 'stopping':
            return ['stopping', 'terminating'].includes(rawStatus);
          case 'abnormal':
            return ['failed', 'error', 'unhealthy', 'warning', 'degraded', 'crashloopbackoff'].includes(rawStatus);
          default:
            return true;
        }
      });
    }

    // 2. Keyword Filter
    if (!keyword) return result;
    const lower = keyword.toLowerCase();
    return result.filter(item => {
      const name = item.name || item.metadata?.name || item.InstanceName || '';
      const id = item.id || item.metadata?.uid || item.InstanceId || '';
      const ip = JSON.stringify(item.publicIps || item.privateIps || item.status?.interfaces || []);
      return name.toLowerCase().includes(lower) || 
             id.toLowerCase().includes(lower) ||
             ip.toLowerCase().includes(lower);
    });
  }, [localDataSource, keyword, statusFilter]);
  
  const columns = useMemo(() => {
    let cols: any[] = [];

    if (isHarvester) {
      cols = [
        {
          title: '名称',
          key: 'name',
          fixed: 'left',
          sorter: (a: any, b: any) => (a.metadata?.name || '').localeCompare(b.metadata?.name || ''),
          render: (_: any, r: any) => <span>{r.metadata?.name || '-'}</span>
        },
        {
          title: 'UID',
          key: 'uid',
          render: (_: any, r: any) => <span>{r.metadata?.uid || '-'}</span>
        },
        {
          title: 'Namespace',
          key: 'namespace',
          sorter: (a: any, b: any) => (a.metadata?.namespace || '').localeCompare(b.metadata?.namespace || ''),
          render: (_: any, r: any) => r.metadata?.namespace || 'default'
        },
        {
          title: '描述',
          key: 'description',
          ellipsis: true,
          render: (_: any, r: any) => r.metadata?.annotations?.description || '-'
        },
        {
          title: '创建者',
          key: 'creator',
          render: (_: any, r: any) => r.metadata?.labels?.['harvesterhci.io/creator'] || '-'
        },
        {
          title: '状态',
          key: 'status',
          sorter: (a: any, b: any) => {
             const sa = a.status?.printableStatus || a.status?.phase || 'Unknown';
             const sb = b.status?.printableStatus || b.status?.phase || 'Unknown';
             return sa.localeCompare(sb);
          },
          render: (_: any, r: any) => {
             const status = r.status?.printableStatus || r.status?.phase || 'Unknown';
             return statusMark(status);
          }
        },

        {
          title: '运行策略',
          key: 'runStrategy',
          render: (_: any, r: any) => r.spec?.runStrategy || '-'
        },
        {
          title: 'CPU',
          key: 'cpu',
          sorter: (a: any, b: any) => {
            const getCpu = (r: any) => {
                const domain = r.spec?.template?.spec?.domain || {};
                return domain.cpu?.cores || domain.cpu?.sockets || 0;
            };
            return getCpu(a) - getCpu(b);
          },
          render: (_: any, r: any) => {
            const domain = r.spec?.template?.spec?.domain || {};
            const cpu = domain.cpu?.cores || domain.cpu?.sockets || 0;
            return <span>{cpu} C</span>;
          }
        },
        {
          title: 'CPU使用率',
          key: 'cpuUsage',
          render: (_: any, r: any) => {
            // Placeholder: Check if metrics exist (future)
            const usage = r.metrics?.cpu;
            if (usage) return <span>{usage}</span>;
            
            const isRunning = ['running', 'succeeded', 'healthy', 'ok'].includes(String(r.status?.printableStatus || r.status?.phase || '').toLowerCase());
            if (isRunning) {
              return (
                <Tooltip title="无法获取数据，请检查监控组件状态或Guest Agent">
                  <span style={{ color: '#8c8c8c', cursor: 'help' }}>未获取 <QuestionCircleOutlined /></span>
                </Tooltip>
              );
            }
            return <Tooltip title="实例未运行"><span style={{ color: '#ccc' }}>-</span></Tooltip>;
          }
        },
        {
          title: '内存',
          key: 'memory',
          sorter: (a: any, b: any) => {
            const getMem = (r: any) => {
                const domain = r.spec?.template?.spec?.domain || {};
                const mem = domain.memory?.guest || domain.resources?.requests?.memory || '0';
                return parseMemory(mem);
            };
            return getMem(a) - getMem(b);
          },
          render: (_: any, r: any) => {
            const domain = r.spec?.template?.spec?.domain || {};
            const mem = domain.memory?.guest || domain.resources?.requests?.memory || '-';
            return <span>{mem}</span>;
          }
        },
        {
          title: '内存使用率',
          key: 'memoryUsage',
          render: (_: any, r: any) => {
             // Placeholder
             const usage = r.metrics?.memory;
             if (usage) return <span>{usage}</span>;
             
             const isRunning = ['running', 'succeeded', 'healthy', 'ok'].includes(String(r.status?.printableStatus || r.status?.phase || '').toLowerCase());
             if (isRunning) {
               return (
                 <Tooltip title="无法获取数据，请检查监控组件状态或Guest Agent">
                   <span style={{ color: '#8c8c8c', cursor: 'help' }}>未获取 <QuestionCircleOutlined /></span>
                 </Tooltip>
               );
             }
             return <Tooltip title="实例未运行"><span style={{ color: '#ccc' }}>-</span></Tooltip>;
          }
        },
        {
          title: '架构',
          key: 'architecture',
          sorter: (a: any, b: any) => (a.spec?.template?.spec?.architecture || '').localeCompare(b.spec?.template?.spec?.architecture || ''),
          render: (_: any, r: any) => r.spec?.template?.spec?.architecture || '-'
        },
        {
          title: '操作系统',
          key: 'os',
          render: (_: any, r: any) => r.metadata?.labels?.['harvesterhci.io/os'] || '-'
        },
        {
          title: '机型',
          key: 'machineType',
          sorter: (a: any, b: any) => (a.spec?.template?.spec?.domain?.machine?.type || '').localeCompare(b.spec?.template?.spec?.domain?.machine?.type || ''),
          render: (_: any, r: any) => r.spec?.template?.spec?.domain?.machine?.type || '-'
        },
        {
          title: 'IP地址',
          key: 'ips',
          render: (_: any, r: any) => {
             // Try VMI interfaces first (real-time), then VM status interfaces
             const ifaces = r.vmi?.status?.interfaces || r.status?.interfaces || [];
             const ips = ifaces
               .map((i: any) => i.ipAddress || i.ip)
               .filter(Boolean);
             
             if (ips.length === 0) {
                const isRunning = ['running', 'succeeded', 'healthy', 'ok'].includes(String(r.status?.printableStatus || r.status?.phase || '').toLowerCase());
                if (isRunning) {
                  return (
                    <Tooltip title="未获取到IP，请检查Guest Agent是否安装或网络配置">
                      <span style={{ color: '#8c8c8c', cursor: 'help' }}>未获取 <QuestionCircleOutlined /></span>
                    </Tooltip>
                  );
                }
                return <Tooltip title="实例未运行"><span style={{ color: '#ccc' }}>-</span></Tooltip>;
             }
             
             return (
               <div>
                 {ips.slice(0, 2).map((ip: string) => <div key={ip}>{ip}</div>)}
                 {ips.length > 2 && <div style={{ color: '#999' }}>+{ips.length - 2} more</div>}
               </div>
             );
          }
        },
        {
          title: 'MAC地址',
          key: 'mac',
          render: (_: any, r: any) => {
             const macJson = r.metadata?.annotations?.['harvesterhci.io/mac-address'];
             if (!macJson) return '-';
             try {
               const macs = JSON.parse(macJson);
               return (
                 <div>
                   {Object.entries(macs).map(([k, v]) => (
                     <div key={k}>{k}: {v as string}</div>
                   ))}
                 </div>
               );
             } catch (e) {
               return '-';
             }
          }
        },
        {
          title: '节点',
          key: 'node',
          sorter: (a: any, b: any) => {
             const n1 = a.vmi?.status?.nodeName || a.status?.nodeName || '';
             const n2 = b.vmi?.status?.nodeName || b.status?.nodeName || '';
             return n1.localeCompare(n2);
          },
          render: (_: any, r: any) => r.vmi?.status?.nodeName || r.status?.nodeName || '-'
        },
        {
          title: '镜像 名称',
          key: 'imageName',
          sorter: (a: any, b: any) => {
             const getName = (r: any) => {
                 const imgId = getVmImageId(r);
                 if (!imgId) return '';
                 const found = images.find(img => {
                    const fullId = `${img.metadata.namespace}/${img.metadata.name}`;
                    return fullId === imgId || img.metadata.name === imgId;
                 });
                 return found?.spec?.displayName || found?.metadata?.name || imgId || '';
             };
             return getName(a).localeCompare(getName(b));
          },
          render: (_: any, r: any) => {
             const imgId = getVmImageId(r);
             if (!imgId) return '-';
             
             // Try to find in images list
             // Harvester Image ID format is usually "namespace/name"
             const found = images.find(img => {
                const fullId = `${img.metadata.namespace}/${img.metadata.name}`;
                return fullId === imgId || img.metadata.name === imgId; // Try both exact match and short name
             });
             
             if (found) {
                return <span>{found.spec?.displayName || found.metadata?.name}</span>;
             }
             
             return <span style={{ color: '#999' }}>{imgId}</span>;
          }
        },
        {
          title: '镜像 ID',
          key: 'image',
          render: (_: any, r: any) => {
             const imgId = getVmImageId(r);
             return <span>{imgId || '-'}</span>;
          }
        },
        {
          title: '磁盘 (PVC)',
          key: 'volumes',
          render: (_: any, r: any) => {
             const vols = r.spec?.template?.spec?.volumes || [];
             if (vols.length === 0) return '-';
             return (
               <div>
                 {vols.map((v: any) => {
                    const claim = v.persistentVolumeClaim?.claimName;
                    if (!claim) return null;
                    return (
                      <div key={v.name} style={{ whiteSpace: 'nowrap' }}>
                        {v.name}: {claim}
                      </div>
                    );
                 })}
               </div>
             );
          }
        },
        {
          title: '网络',
          key: 'networks',
          render: (_: any, r: any) => {
             const nets = r.spec?.template?.spec?.networks || [];
             return (
               <div>
                 {nets.map((n: any) => {
                    const name = n.multus?.networkName || n.name;
                    return <Tag key={n.name} style={{ marginBottom: 2 }}>{name}</Tag>;
                 })}
               </div>
             );
          }
        },
        {
          title: '创建时间',
          key: 'createdAt',
          sorter: (a: any, b: any) => {
            const t1 = new Date(a.metadata?.creationTimestamp || 0).getTime();
            const t2 = new Date(b.metadata?.creationTimestamp || 0).getTime();
            return t1 - t2;
          },
          render: (_: any, r: any) => {
            const t = r.metadata?.creationTimestamp;
            return <span>{t ? new Date(t).toLocaleString() : '-'}</span>;
          }
        },
        {
          title: '存活时间',
          key: 'uptime',
          render: (_: any, r: any) => {
             const readyCond = r.status?.conditions?.find((c: any) => c.type === 'Ready');
             if (readyCond?.status === 'True' && readyCond?.lastTransitionTime) {
                const start = new Date(readyCond.lastTransitionTime).getTime();
                const now = Date.now();
                return formatDuration(now - start);
             }
             return '-';
          }
        }
      ];
    } else {
      // Standard Cloud Columns
      cols = [
        {
          title: '实例名称',
          dataIndex: 'name',
          key: 'name',
          fixed: 'left',
          sorter: (a: any, b: any) => (a.name || a.InstanceName || '').localeCompare(b.name || b.InstanceName || ''),
          render: (t: any, r: any) => <span style={{ fontWeight: 500 }}>{t || r.InstanceName || '-'}</span>
        },
        {
          title: '实例ID',
          key: 'id',
          render: (_: any, r: any) => <span style={{ fontFamily: 'monospace', fontSize: 12 }}>{r.id || r.InstanceId || '-'}</span>
        },
        {
          title: '区域',
          dataIndex: 'region',
          key: 'region',
          render: (t: any, r: any) => r.RegionId || t || '-'
        },
        {
          title: '状态',
          dataIndex: 'status',
          key: 'status',
          sorter: (a: any, b: any) => String(a.status || a.Status || '').localeCompare(String(b.status || b.Status || '')),
          render: (t: any, r: any) => statusMark(t || r.Status)
        },
        {
          title: '规格',
          dataIndex: 'instanceType',
          key: 'instanceType',
          sorter: (a: any, b: any) => (a.instanceType || a.InstanceType || '').localeCompare(b.instanceType || b.InstanceType || ''),
          render: (t: any, r: any) => <span style={{ fontFamily: 'monospace' }}>{t || r.InstanceType}</span>
        },
        {
          title: '公网IP',
          key: 'publicIp',
          render: (_: any, r: any) => {
             const publicIps = r.publicIps || r.PublicIpAddress?.IpAddress || [];
             return (
               <div style={{ fontSize: 12, fontFamily: 'monospace' }}>
                 {Array.isArray(publicIps) ? publicIps.map((ip: string) => <div key={ip}>{ip}</div>) : '-'}
               </div>
             );
          }
        },
        {
          title: '内网IP',
          key: 'privateIp',
          render: (_: any, r: any) => {
             const ips = r.privateIps || r.VpcAttributes?.PrivateIpAddress?.IpAddress || [];
             return (
               <div style={{ fontSize: 12, fontFamily: 'monospace' }}>
                 {Array.isArray(ips) ? ips.map((ip: string) => <div key={ip}>{ip}</div>) : '-'}
               </div>
             );
          }
        },
        {
          title: 'VPC',
          key: 'vpc',
          render: (_: any, r: any) => {
            const vpcId = r.extra?.vpcId || r.VpcAttributes?.VpcId;
            return <span style={{ fontFamily: 'monospace', fontSize: 12 }}>{vpcId || '-'}</span>;
          }
        },
        {
          title: '创建时间',
          dataIndex: 'createdAt',
          key: 'createdAt',
          sorter: (a: any, b: any) => {
             const t1 = new Date(a.createdAt || a.CreationTime || 0).getTime();
             const t2 = new Date(b.createdAt || b.CreationTime || 0).getTime();
             return t1 - t2;
          },
          render: (t: any, r: any) => {
            const time = t || r.CreationTime;
            return <span style={{ fontSize: 12 }}>{time ? new Date(time).toLocaleString() : '-'}</span>;
          }
        }
      ];
    }

    // Filter by visibility and sort by ECS_COLUMNS_CONFIG order
    const finalCols: any[] = [];
    ECS_COLUMNS_CONFIG.forEach(conf => {
      const col = cols.find(c => c.key === conf.value);
      if (col && visibleColumns.includes(conf.value)) {
        finalCols.push(col);
      }
    });
    
    // Add Action Column
    finalCols.push({
      title: '操作',
      key: 'action',
      fixed: 'right',
      render: (_: any, r: any) => {
        const menuItems: MenuProps['items'] = [];

        // 1. Power Management
        const powerItems: MenuProps['items'] = [
          { key: 'start', label: '启动' },
          { key: 'stop', label: '停止' },
          { key: 'reboot', label: '重启' },
        ];
        if (isHarvester) {
          powerItems.push(
            { key: 'softreboot', label: '软重启' },
            { key: 'pause', label: '暂停' },
            { key: 'unpause', label: '恢复' }
          );
        }
        menuItems.push(...(powerItems || []));
        menuItems.push({ type: 'divider' });

        // 2. Data Protection (Snapshot/Backup)
        menuItems.push({
          key: 'data_protection',
          label: '数据保护',
          children: [
            { key: 'snapshot', label: '快照' },
            { key: 'backup', label: '备份' },
            { key: 'create_policy', label: '创建策略' },
            { key: 'set_quota', label: '设定配额' },
          ]
        });

        // 3. Configuration
        menuItems.push({
          key: 'configuration',
          label: '配置变更',
          children: [
            { key: 'change_spec', label: '变更实例规格' },
            { key: 'cpu_advanced', label: 'CPU高级配置' },
            { key: 'mem_advanced', label: '内存高级配置' },
            { key: 'change_gpu', label: '变更GPU' },
            { type: 'divider' },
            { key: 'change_os', label: '更换操作系统', danger: true },
            { key: 'add_disk', label: '添加数据盘' },
            { key: 'resize_disk', label: '扩容数据盘' },
            { key: 'remove_disk', label: '移除数据盘', danger: true },
            { type: 'divider' },
            { key: 'change_primary_nic', label: '变更主网卡' },
            { key: 'change_secondary_nic', label: '变更辅助网卡' },
          ]
        });

        // 4. Lifecycle (Clone/Template)
        menuItems.push({
          key: 'lifecycle',
          label: '镜像与模板',
          children: [
            { key: 'clone', label: '克隆' },
            { key: 'create_template', label: '生成模板' },
          ]
        });

        // 5. Delete (Separate)
        menuItems.push(
          { type: 'divider' },
          { key: 'delete', label: '删除', danger: true }
        );

        return (
          <ResourceActionsDropdown 
            items={menuItems} 
            onClick={({ key }) => handleMenuClick(key, r)} 
          />
        );
      }
    });

    return finalCols;

  }, [isHarvester, visibleColumns, images]);

  return (
    <>
      <SharedToolbar
        left={
          <Space>
            <Input 
              placeholder="搜索名称/ID/IP" 
              allowClear 
              value={keyword}
              onChange={e => setKeyword(e.target.value)}
              style={{ width: 220 }}
            />
            <Select
              placeholder="状态"
              allowClear
              style={{ width: 120 }}
              value={statusFilter}
              onChange={setStatusFilter}
              options={[
                { label: '运行中', value: 'running' },
                { label: '已停止', value: 'stopped' },
                { label: '启动中', value: 'starting' },
                { label: '停止中', value: 'stopping' },
                { label: '异常/告警', value: 'abnormal' },
              ]}
            />
          </Space>
        }
        primaryAction={isHarvester ? {
          label: '创建云主机',
          onClick: () => {
            if (cloudId) {
              navigate(`/admin/clouds/${cloudId}/instances/create`, { state: { backgroundLocation: location } });
            } else {
              message.warning('请选择资源池');
            }
          }
        } : undefined}
        batchActions={{
          items: [
            { key: 'start', label: '启动' },
            { key: 'stop', label: '停止' },
            { key: 'reboot', label: '重启' },
            { type: 'divider' },
            { key: 'delete', label: '删除', danger: true },
          ],
          onMenuClick: handleBatchAction,
          disabled: selectedRows.length === 0,
          tooltip: selectedRows.length === 0 ? '请先选择实例' : undefined
        }}
        columnsConfig={{
          value: visibleColumns,
          options: ECS_COLUMNS_CONFIG,
          onChange: setVisibleColumns
        }}
        onRefresh={onRefresh}
        refreshLoading={loading}
      />
      
      <Table
        rowSelection={rowSelection}
        dataSource={filteredDataSource}
        columns={columns as any}
        rowKey={(r) => r.id || r.InstanceId || r.metadata?.uid}
        loading={loading}
        pagination={DEFAULT_PAGINATION_CONFIG}
        scroll={{ x: 'max-content' }}
      />
      
      <VmReconfigureModal
        open={reconfigureModalOpen}
        cloudId={cloudId || ''}
        record={currentRecord}
        onClose={() => setReconfigureModalOpen(false)}
        onOk={() => {
            setReconfigureModalOpen(false);
            if (onRefresh) onRefresh();
        }}
        storageClasses={storageClasses}
        images={images}
        initialConfigType={reconfigureType}
      />
    </>
  );
};

export default CloudConsoleEcsTable;