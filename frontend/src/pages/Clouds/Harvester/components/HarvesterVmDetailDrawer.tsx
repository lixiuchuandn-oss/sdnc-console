/**
 * ==============================================================================
 * 模块名称: Harvester 虚拟机详情抽屉 (Harvester VM Detail Drawer)
 * 文件路径: src/pages/Clouds/Harvester/components/HarvesterVmDetailDrawer.tsx
 * ==============================================================================
 *
 * [功能描述]
 * 以 Drawer 形式展示 Harvester 虚拟机的详情信息，并提供常用运维操作入口（开关机/重启/暂停/控制台/备份等）。
 * 该组件会在打开时拉取“聚合详情数据”，并通过 SSE 接收实时状态更新，确保抽屉内状态与列表/集群保持一致。
 *
 * [核心逻辑]
 * 1. [状态同步]:
 *    - 将外部 record 同步到内部 vmData，作为统一渲染与操作的数据源。
 * 2. [数据聚合]:
 *    - 调用 fetchHarvesterVMAggregated 拉取 VM 及关联资源（NAD/VPC/Subnet/镜像）并落地到本地状态。
 *    - 为网卡网络名称映射（VPC/Flat/VLAN）提供必要的上下文数据。
 * 3. [实时更新]:
 *    - 通过 /resources/ecs/stream SSE 订阅 vm_status/vm_deleted 事件，增量合并状态/节点/IP 变化。
 * 4. [性能指标]:
 *    - 使用 Prometheus range query 拉取 virt-launcher 容器 CPU/内存，并计算使用率用于 UI 展示。
 * 5. [操作入口]:
 *    - 封装开关机/重启/暂停/恢复/弹出 CD-ROM/保存为模板等动作，并在必要时提示与刷新。
 *
 * ------------------------------------------------------------------------------
 * [交互/依赖说明 (Dependencies & Interactions)]
 * ------------------------------------------------------------------------------
 * 1. 数据流向:
 *    上游页面(传入 record/volumes/namespaces) -> HarvesterVmDetailDrawer -> harvesterApi/monitoringApi/SSE -> UI 渲染
 *
 * 2. 关键依赖/接口:
 *    - GET  /api/clouds/:id/resources/ecs/stream (SSE: vm_status/vm_deleted)
 *    - harvesterApi: fetchHarvesterVMAggregated / startHarvesterVm / stopHarvesterVm / pauseHarvesterVm / unpauseHarvesterVm
 *    - harvesterApi: detachHarvesterVolumeFromVm / deleteHarvesterPVC / fetchHarvesterBackups / fetchHarvesterScheduleVmBackups
 *    - monitoringApi: fetchMetricRange (Prometheus range query)
 * ==============================================================================
 */
import React, { useState, useMemo, useCallback } from 'react';
import { Drawer, Segmented, Button, Dropdown, MenuProps, Tag, Tooltip, message, Card, Descriptions, List, Space, Progress, Modal, Checkbox } from 'antd';
import { 
  PlayCircleOutlined, PoweroffOutlined, ReloadOutlined, PauseCircleOutlined, 
  CodeOutlined, EllipsisOutlined, DesktopOutlined, DatabaseOutlined,
  HddOutlined, ApartmentOutlined,
  ExportOutlined, CopyOutlined, HistoryOutlined, DownOutlined, DeleteOutlined,
  SaveOutlined, StopOutlined, InfoCircleOutlined, ExclamationCircleOutlined,
  CloseOutlined, SyncOutlined, LineChartOutlined, BellOutlined, FileTextOutlined,
  ThunderboltOutlined
} from '@ant-design/icons';
import { cnVmStatus } from '../../../../utils/harvesterUtils';
import { stopHarvesterVm, startHarvesterVm, pauseHarvesterVm, unpauseHarvesterVm, detachHarvesterVolumeFromVm, deleteHarvesterPVC, fetchHarvesterBackups, fetchHarvesterScheduleVmBackups, fetchHarvesterVMAggregated, abortHarvesterMigration } from '../../../../services/harvesterApi';
import { rebootCloudProviderEcs, API_BASE_URL, apiPost } from '../../../../services/api';
import { fetchMetricRange } from '../../../../services/monitoringApi';
import { VMPerformance } from './VMPerformance';
import HarvesterVmBackupTab from './HarvesterVmBackupTab';
import { ReactComponent as CpuIcon } from '../../../../assets/clouds/cpu.svg';
import { ReactComponent as MemIcon } from '../../../../assets/clouds/mem.svg';
import { ReactComponent as DiskIcon } from '../../../../assets/clouds/disk.svg';
import { ReactComponent as GpuIcon } from '../../../../assets/clouds/gpu.svg';
import { ReactComponent as UsbIcon } from '../../../../assets/clouds/usb.svg';
import { ReactComponent as NicIcon } from '../../../../assets/clouds/nic.svg';
import HarvesterEventsTab from './HarvesterEventsTab';
import HarvesterVmLogsTab from './HarvesterVmLogsTab';
import HarvesterVmDiagnosisTab from './HarvesterVmDiagnosisTab';
import { OsIcon } from '../../../../components/OsIcon';
import VmSaveAsTemplateModal from '../modals/VmSaveAsTemplateModal';
import { getToken } from '../../../../utils/tokenStorage';

/**
 * HarvesterVmDetailDrawer 组件入参定义
 * @property open - 抽屉是否打开
 * @property onClose - 关闭抽屉回调
 * @property record - 当前 VM 记录（上游列表传入，结构可能为原始或聚合后的 VM 对象）
 * @property cloudId - 当前云资源 ID，用于后端 API 路由拼装
 * @property namespaces - Harvester 命名空间列表（用于展示/过滤等场景）
 * @property volumes - PVC/卷列表（用于磁盘容量等信息补全）
 * @property images - 镜像列表（用于关联信息补全）
 * @property activeTab - 外部受控 Tab Key（可选）
 * @property onTabChange - Tab 切换回调（可选）
 * @property onRefresh - 上游刷新回调（用于触发列表/外部数据重新加载）
 * @property onOpenReconfigure - 打开“资源变配”弹窗（可选）
 * @property onBackup - 触发备份动作（可选）
 * @property onSnapshot - 触发快照动作（可选）
 * @property onClone - 触发克隆动作（可选）
 * @property onMigrate - 触发热迁移动作（可选）
 * @property onDelete - 触发删除动作（可选）
 */
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
  // ==============================================================================
  // 1. 基础状态 (Base State)
  // ==============================================================================
  const [localActiveTab, setLocalActiveTab] = useState('detail');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [showTemplateModal, setShowTemplateModal] = useState(false);

  // [状态同步] 抽屉内部统一使用 vmData 作为渲染/动作的数据源
  // 详细解释：
  // 1. 为什么需要：上游 record 的结构可能随着聚合接口返回变化；内部统一口径可降低渲染与动作逻辑的分支复杂度
  // 2. 如何工作：默认以 record 初始化，打开后再用聚合接口结果增量覆盖
  // 3. 边界处理：record 变化时同步更新，避免切换不同 VM 时显示旧数据
  const [vmData, setVmData] = useState<any>(record);
  
  // [状态同步] 外部 record 变化时同步到本地，避免抽屉展示与上游选中项不一致
  React.useEffect(() => {
      setVmData((prev: any) => {
        const prevUid = prev?.metadata?.uid || prev?.id || '';
        const newUid = record?.metadata?.uid || record?.id || '';
        const prevName = prev?.metadata?.name || prev?.name || '';
        const newName = record?.metadata?.name || record?.name || '';
        
        if (!prevUid && !prevName) return record;
        if ((prevUid && newUid && prevUid !== newUid) || (prevName && newName && prevName !== newName)) {
          return record;
        }
        
        return {
          ...prev,
          status: record?.status ?? prev?.status,
          nodeName: record?.nodeName ?? prev?.nodeName,
          ips: Array.isArray(record?.ips) ? record.ips : prev?.ips,
          metadata: { ...(prev?.metadata || {}), ...(record?.metadata || {}) }
        };
      });
  }, [record]);

  // ==============================================================================
  // 2. 性能指标 (CPU/Memory Usage)
  // ==============================================================================
  const [cpuUsage, setCpuUsage] = useState<number | null>(null);
  const [memUsage, setMemUsage] = useState<number | null>(null);

  // ==============================================================================
  // 3. 网络映射上下文 (VPC/Subnet/NAD)
  // ==============================================================================
  const [vpcs, setVpcs] = useState<any[]>([]);
  const [subnets, setSubnets] = useState<any[]>([]);
  const [nads, setNads] = useState<any[]>([]);
  const [vmImages, setVmImages] = useState<any[]>(images);
  // [聚合卷信息] 优先使用 aggregated 接口返回的 related.volumes（VM 引用的 PVC 列表）
  // 这样磁盘容量/phase/conditions 与 VM spec 能保持同源，避免依赖外层缓存 volumes 导致差异。
  const [vmPvcs, setVmPvcs] = useState<any[]>([]);

  // ==============================================================================
  // 4. 数据聚合拉取 (Aggregated Fetch)
  // ==============================================================================
  // [数据聚合] 拉取 VM 本体 + 关联资源（网络/镜像等）
  // 详细解释：
  // 1. 为什么需要：详情页需要将网卡的 networkName 映射为 VPC/Flat/VLAN 等可读信息，单靠 VM 本体无法完成
  // 2. 如何工作：调用 fetchHarvesterVMAggregated 后拆分 vm 与 related，并分别写入 vmData/vpcs/subnets/nads/vmImages
  // 3. 边界处理：兼容 res.data.vm 结构与扁平结构；手动刷新提供 loading 与提示
  const fetchAggregated = useCallback(async (manual = false) => {
    if (!open || !cloudId || !record?.metadata?.namespace || !record?.metadata?.name) return;

    if (manual) setRefreshing(true);
    try {
        const namespace = record.metadata.namespace;
        const name = record.metadata.name;
        const res = await fetchHarvesterVMAggregated(cloudId, namespace, name);
        
        if (res) {
            // [兼容返回结构] 支持 { data: { vm, related } } 与 { vm, related } 两种形态
            const data = res.data && res.data.vm ? res.data : res;
            
            if (data.vm) setVmData(data.vm);
            if (data.related) {
                setNads(data.related.nads || []);
                setVpcs(data.related.vpcs || []);
                setSubnets(data.related.subnets || []);
                setVmImages(data.related.images || []);
                setVmPvcs(data.related.volumes || []);
            }
            if (manual) {
              message.success('刷新成功');
              // 兜底：如果后端聚合未返回 volumes，则仍可触发上游强刷
              if (!Array.isArray(data?.related?.volumes) || data.related.volumes.length === 0) {
                try { onRefresh?.(true); } catch {}
              }
            }
        }
    } catch (e) {
        console.error('Failed to fetch aggregated VM data', e);
        if (manual) message.error('刷新失败');
    } finally {
        if (manual) setRefreshing(false);
    }
  }, [open, cloudId, record?.metadata?.namespace, record?.metadata?.name]);

  React.useEffect(() => {
    fetchAggregated();
  }, [fetchAggregated]);

  // [改进] 监听 record 的变化（包括变配后的刷新触发），如果详情页已打开，自动刷新详情数据
  // 这样可以确保变配操作完成后，详情页能够及时显示最新的配置
  const refreshTriggerRef = React.useRef<number>(0);
  React.useEffect(() => {
    if (open && record) {
      // 检查是否有刷新触发标记（变配完成后会设置 _refreshTrigger）
      const currentTrigger = (record as any)?._refreshTrigger;
      if (currentTrigger && currentTrigger !== refreshTriggerRef.current) {
        refreshTriggerRef.current = currentTrigger;
        // 延迟一小段时间，确保后端数据已更新
        const timer = setTimeout(() => {
          fetchAggregated(false);
        }, 500);
        return () => clearTimeout(timer);
      }
    }
  }, [record, open, fetchAggregated]);

  // ==============================================================================
  // 5. 实时状态 (SSE)
  // ==============================================================================
  // [实时更新] 订阅后端 SSE 的 vm_status/vm_deleted 事件并合并到 vmData
  // 详细解释：
  // 1. 为什么需要：VM 状态、节点归属、IP 可能随迁移/重启/网络变化而快速变化，轮询会造成延迟与额外负载
  // 2. 如何工作：EventSource 连接 /resources/ecs/stream，收到事件后按 VM uid/name 过滤，仅更新当前抽屉对象
  // 3. 边界处理：EventSource 无法自定义 Header，因此使用 query token；网络断开由浏览器自动重连
  React.useEffect(() => {
    if (!open || !cloudId || !record?.metadata?.uid) return;

    let eventSource: EventSource | null = null;
    const connectSSE = () => {
        const token = getToken();
        if (!token) {
           console.warn('[VmDetail] No auth token found, skipping SSE');
           return;
        }

        const urlObj = new URL(`${API_BASE_URL}/api/clouds/${cloudId}/resources/ecs/stream`);
        urlObj.searchParams.append('token', token);
        urlObj.searchParams.append('t', String(Date.now()));

        eventSource = new EventSource(urlObj.toString());
        
        eventSource.addEventListener('vm_status', (event: any) => {
            try {
                const data = JSON.parse(event.data);
                
                const currentUid = record.metadata?.uid || record.id;
                const currentName = record.metadata?.name || record.name;
                const incomingIid = String(data?.iid || data?.id || '');
                
                if (!incomingIid) return;
                if (incomingIid !== currentUid && incomingIid !== currentName) {
                    return;
                }

                setVmData((prev: any) => {
                    const statusStr = String(data.status || '');
                    const nodeName = String(data.nodeName || '');
                    const ips = Array.isArray(data.ips) ? data.ips : [];
                    
                    // [增量合并] 避免无意义的 state 更新导致 UI 频繁重渲染
                    const prevStatusStr = typeof prev.status === 'string' 
                        ? prev.status 
                        : (prev.status?.printableStatus || prev.status?.phase || '');
                    
                    const currentNode = prev.nodeName;
                    const currentIps = prev.ips || [];
                    
                    if (prevStatusStr === statusStr && currentNode === nodeName && JSON.stringify(currentIps) === JSON.stringify(ips)) {
                        return prev;
                    }

                    // [兼容结构] status 可能为 string 或 object，合并时保留已有字段，确保 SafeRead 可用
                    let newStatus: any;
                    if (typeof prev.status === 'object' && prev.status !== null) {
                        newStatus = { ...prev.status, printableStatus: statusStr };
                        if (prev.status.phase) newStatus.phase = statusStr;
                    } else {
                        // [兼容结构] prev.status 为 string 或 null 时，重建对象以匹配 SafeRead 的读取口径
                        newStatus = { printableStatus: statusStr, phase: statusStr };
                    }

                    return {
                        ...prev,
                        status: newStatus,
                        nodeName: nodeName,
                        ips: ips,
                        Extra: { ...(prev.Extra || {}), NodeName: nodeName }
                    };
                });
            } catch (e) {
                console.error('[VmDetail] SSE Parse Error', e);
            }
        });

        eventSource.addEventListener('vm_deleted', (event: any) => {
             try {
                const data = JSON.parse(event.data);
                const incomingIid = String(data?.iid || data?.id || '');
                if (incomingIid && incomingIid === record.metadata.uid) {
                    message.warning('当前虚拟机已被删除');
                    onClose();
                }
             } catch(e) {}
        });
        
        // [服务端错误] 仅记录告警，连接错误由浏览器自动重连机制处理
        eventSource.addEventListener('stream_error', (ev: MessageEvent) => {
            try {
              const json = JSON.parse(String(ev.data || '{}'));
              const message = String(json?.message ?? '');
              const cause = String(json?.cause ?? '');
              const s = `${message} ${cause}`.toLowerCase();
              if (
                s.includes('aborted') ||
                s.includes('context canceled') ||
                s.includes('context cancelled') ||
                s.includes('canceled') ||
                s.includes('cancelled') ||
                s.includes('client disconnected') ||
                s.includes('connection closed') ||
                s.includes('broken pipe') ||
                s.includes('eof')
              ) {
                return;
              }
              console.warn('[VmDetail] SSE Server Error:', json);
            } catch {}
        });

        eventSource.onerror = (err) => {
            // console.error('[VmDetail] SSE Connection Error:', err);
            // [重连策略] 不主动 close，交由浏览器内建的 EventSource 自动重连机制处理
        };
    };

    connectSSE();

    return () => {
        if (eventSource) {
            eventSource.close();
        }
    };
  }, [open, cloudId, record?.metadata?.uid, record?.metadata?.name, record?.id, record?.name, onClose]);

  // ==============================================================================
  // 6. 性能指标拉取 (Prometheus Metrics)
  // ==============================================================================
  // [性能指标] 拉取 VM 对应 virt-launcher Pod 的 CPU/内存指标，用于顶部卡片展示
  // 详细解释：
  // 1. 为什么需要：Harvester VM 实际运行在 KubeVirt 的 virt-launcher Pod 中，指标应以该容器为口径
  // 2. 如何工作：PromQL 使用 pod=~virt-launcher-${vmName}-.* 匹配 Pod，container="compute" 选择计算容器
  // 3. 边界处理：指标缺失或查询失败时设置为 null，UI 使用 '-' 兜底
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

  // ==============================================================================
  // 7. 备份/快照数据 (Backup & Schedule)
  // ==============================================================================
  const [backups, setBackups] = useState<any[]>([]);
  const [backupsLoading, setBackupsLoading] = useState(false);

  const [schedules, setSchedules] = useState<any[]>([]);
  const [schedulesLoading, setSchedulesLoading] = useState(false);

  const activeTab = propActiveTab !== undefined ? propActiveTab : localActiveTab;

  // [按需加载] 仅在切换到“备份/快照”Tab 时拉取数据，避免抽屉打开瞬间触发过多请求
  React.useEffect(() => {
    if (open) {
      if (activeTab === 'backup_snapshot') {
        fetchBackups();
        fetchSchedules();
      }
    }
  }, [activeTab, open]);

  const fetchBackups = async (force = false, skipSync = false) => {
    if (!cloudId) return;
    setBackupsLoading(true);
    try {
      if (force && !skipSync) {
        try { await apiPost(`/api/clouds/${cloudId}/sync`); } catch {}
      }
      const res = await fetchHarvesterBackups(cloudId, force, skipSync);
      const items = (res as any)?.data?.items || [];
      setBackups(items);
    } catch (e: any) {
      message.error(`获取备份数据失败: ${e.message}`);
    } finally {
      setBackupsLoading(false);
    }
  };

  const fetchSchedules = async (force = false, skipSync = false) => {
    if (!cloudId) return;
    setSchedulesLoading(true);
    try {
      if (force && !skipSync) {
        try { await apiPost(`/api/clouds/${cloudId}/sync`); } catch {}
      }
      const res = await fetchHarvesterScheduleVmBackups(cloudId, force, skipSync);
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

  // ==============================================================================
  // 8. 展示辅助函数 (Format Helpers)
  // ==============================================================================
  // [单位换算] 统一处理 K8s 资源量字符串（Ki/Mi/Gi/Ti 与 KB/MB/GB 等）并转换为 GiB 口径显示
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

  // ==============================================================================
  // 9. 安全读取器 (SafeRead)
  // ==============================================================================
  // [数据适配] 统一处理不同来源/不同结构的 VM 对象字段读取
  // 详细解释：
  // 1. 为什么需要：列表 record、聚合接口 vm、SSE 增量合并后的 vmData 字段形态可能不一致
  // 2. 如何工作：将读取逻辑集中在一处，渲染与动作代码只依赖 SafeRead 的稳定返回值
  // 3. 边界处理：缺失字段统一返回空串或 '-'，避免 UI 报错
  const SafeRead = useMemo(() => ({
    // ------------------------------------------
    // 3.1 基础标识 (Identity)
    // ------------------------------------------
    name: (r: any) => r?.metadata?.annotations?.['tower.io/alias'] || r?.InstanceName || r?.name || r?.metadata?.name || '',
    vmId: (r: any) => r?.metadata?.name || '',
    namespace: (r: any) => r?.metadata?.namespace || r?.namespace || '',
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
        return r?.status?.printableStatus || r?.status?.phase || r?.Status || 'Unknown';
    },

    // ------------------------------------------
    // 3.2 镜像与操作系统 (Image & OS) - 移植自 VmSection.tsx
    // ------------------------------------------
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
    
    imageDisplayName: (r: any) => {
      const imgId = SafeRead.image(r);
      if (!imgId) return '';
      
      // 在 vmImages (来自 aggregated 接口的 related.images) 中查找
      const found = (vmImages || []).find((i: any) => {
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

    os: (r: any) => r?.vmi?.status?.guestOSInfo?.name || r?.vmi?.status?.guestOSInfo?.prettyName || '',

    osName: (r: any) => {
        // 1. 优先使用 Guest Agent 上报的 OS 名称 (最准确)
        const guestOs = SafeRead.os(r);
        if (guestOs) return guestOs;

        // 2. 其次使用关联镜像的显示名称
        const imgName = SafeRead.imageDisplayName(r);
        if (imgName) return imgName;

        // 3. 回退到 VM 名称组合
        return `${r?.metadata?.annotations?.['tower.io/alias'] || r?.InstanceName || r?.name || r?.metadata?.name || ''} ${r?.metadata?.name || ''}`;
    },

    // ------------------------------------------
    // 3.3 计算资源 (Compute)
    // ------------------------------------------
    cpu: (r: any) => {
      // [修复] 优先从VM spec计算CPU数量，确保热扩容后显示正确
      // VM spec是配置规格，热扩容后会立即更新
      // VMI spec是运行实例规格，热扩容过程中可能还没同步
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
    memory: (r: any) => {
      // [展示口径] 优先展示 Guest Memory（规格），这是用户在 VM 配置中显式设置的值
      const guest = r?.spec?.template?.spec?.domain?.memory?.guest;
      if (guest) return guest;
      
      const lim = r?.spec?.template?.spec?.domain?.resources?.limits?.memory;
      if (lim) return lim;
      
      return r?.memoryGb || r?.vmi?.spec?.domain?.memory?.guest || '-';
    },

    // ------------------------------------------
    // 3.4 网络 (Network)
    // ------------------------------------------
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
        
        // [磁盘映射] 将 domain.devices.disks 的设备信息（如 bootOrder/bus/cdrom）合并到 volumes 上，用于列表展示
        // [容量数据源] 优先使用聚合接口返回的 related.volumes，其次才用外层 props volumes
        const pvcSource = (Array.isArray(vmPvcs) && vmPvcs.length > 0) ? vmPvcs : volumes;

        return vols.map((v: any) => {
             const claimName = v?.persistentVolumeClaim?.claimName;
             const diskInfo = disks.find((d: any) => d.name === v.name);
             let capacityBytes = 0;
             let imageDisplayName = '';
             
             if (claimName && pvcSource && pvcSource.length > 0) {
                 const pvc = pvcSource.find((p: any) => {
                    const pName = p?.metadata?.name || p?.name;
                    const pNs = p?.metadata?.namespace || p?.namespace;
                    if (pName === claimName && pNs === vmNs) return true;
                    return false;
                 });
                 if (pvc) {
                     const actualPvc = pvc?.rawData || pvc;
                     const capStr = actualPvc?.status?.capacity?.storage || actualPvc?.spec?.resources?.requests?.storage || pvc?.size || '';
                     if (capStr) capacityBytes = parseStorageSize(capStr);

                     // 尝试从 PVC 注解中获取镜像 ID，再查找镜像显示名称
                     const pvcImageId = actualPvc?.metadata?.annotations?.['harvesterhci.io/imageId'];
                     if (pvcImageId) {
                         const foundImg = (vmImages || []).find((i: any) => {
                             const id = i?.metadata?.name;
                             const ns = i?.metadata?.namespace;
                             const fullId = `${ns}/${id}`;
                             return fullId === pvcImageId || id === pvcImageId || i.id === pvcImageId;
                         });
                         if (foundImg) {
                             const labels = foundImg.metadata?.labels || {};
                             const ann = foundImg.metadata?.annotations || {};
                             imageDisplayName = labels['harvesterhci.io/imageDisplayName'] || 
                                              ann['harvesterhci.io/image-name'] || 
                                              ann['field.cattle.io/displayName'] || 
                                              foundImg.spec?.displayName || 
                                              foundImg.displayName || '';
                         }
                     }
                 }
             } else if (v.cloudInitNoCloud || v.cloudInitConfigDrive) {
                 // CloudInit 虚拟盘：容量不参与计算，仅用于展示类型
             } else if (v.containerDisk) {
                 // ContainerDisk：通常为镜像盘，容量不参与计算，仅用于展示类型
             }
             
             return { 
                 name: v.name, 
                 claimName, 
                 capacityBytes, 
                 bootOrder: diskInfo?.bootOrder,
                 bus: diskInfo?.disk?.bus || diskInfo?.cdrom?.bus || '-',
                 type: v.persistentVolumeClaim ? 'Disk' : (v.cloudInitNoCloud || v.cloudInitConfigDrive ? 'CloudInit' : (v.containerDisk ? 'Container' : 'Unknown')),
                 isCdrom: !!diskInfo?.cdrom,
                 imageDisplayName // 新增字段
             };
        }).sort((a: any, b: any) => (a.bootOrder || 999) - (b.bootOrder || 999));
    },
    interfaces: (r: any) => {
        // [网络信息提取] 组合“设备接口 + networks”并补齐 MAC/IP/网络归属展示
        // 详细解释：
        // 1. IP 提取优先级：VMI.status.interfaces（运行态最准确）> VM.status.interfaces（回退）> 注解 ips（单网卡兜底）
        // 2. 网络映射：将 multus.networkName 映射为 VPC/Flat/VLAN 文案；若无法解析则按 Flat 兜底显示
        const ifaces = r?.spec?.template?.spec?.domain?.devices?.interfaces || [];
        const networks = r?.spec?.template?.spec?.networks || [];
        
        return ifaces.map((i: any) => {
            const net = networks.find((n: any) => n.name === i.name);
            let mac = i.macAddress; 
            let ip = '';

            // [辅助函数] 从接口状态对象中提取 IP 字段（兼容单 IP 与多 IP 结构）
            const extractIp = (statusIface: any) => {
                if (statusIface.ipAddress) return statusIface.ipAddress;
                if (Array.isArray(statusIface.ipAddresses) && statusIface.ipAddresses.length > 0) {
                    return statusIface.ipAddresses.join(', ');
                }
                return '';
            };

            // [优先级 1] VMI 运行态：KubeVirt 提供的实时接口信息最可靠
            if (r?.vmi?.status?.interfaces) {
                const vmiIface = r.vmi.status.interfaces.find((si: any) => si.name === i.name || (mac && si.mac === mac));
                if (vmiIface) {
                    mac = vmiIface.mac || mac;
                    ip = extractIp(vmiIface);
                }
            }

            // [优先级 2] VM 状态：在部分状态下 VMI 不存在时作为回退来源
            if (!ip && r?.status?.interfaces) {
                 const statusIface = r.status.interfaces.find((si: any) => si.name === i.name || (mac && si.mac === mac));
                 if (statusIface) {
                     mac = statusIface.mac || mac;
                     ip = extractIp(statusIface);
                 }
            }
            
            // [优先级 3] 注解兜底：仅在单网卡且前两级未取到 IP 时尝试解析注解
            if (!ip && ifaces.length === 1) {
                try {
                    const annot = r?.metadata?.annotations?.['network.harvesterhci.io/ips'];
                    if (annot) {
                        const ips = JSON.parse(annot);
                        if (Array.isArray(ips)) ip = ips.join(', ');
                    }
                } catch(e) {}
            }

            // [网络映射] 将 networkName 映射为 VPC/Subnet 或 Flat/VLAN 的可读文案
            let displayName = net?.multus?.networkName || 'Management Network';
            
            if (displayName !== 'Management Network') {
                try {
                    // networkName 格式：namespace/name（若无 namespace 则默认使用 VM 所在命名空间）
                    const parts = displayName.split('/');
                    const targetNs = parts.length > 1 ? parts[0] : (r?.metadata?.namespace || 'default');
                    const targetName = parts.length > 1 ? parts[1] : parts[0];
                    
                    // [解析步骤 1] 先在 related.nads 中按“命名空间+名称”精确匹配 NAD
                    let nad = nads.find((n: any) => n.metadata?.name === targetName && n.metadata?.namespace === targetNs);
                    
                    // [解析步骤 2] 若未找到且非 default，尝试在 default 命名空间寻找同名 NAD
                    if (!nad && targetNs !== 'default') {
                        nad = nads.find((n: any) => n.metadata?.name === targetName && n.metadata?.namespace === 'default');
                    }

                    // [解析步骤 3] 最后仅按名称匹配（related.nads 理论上已包含相关 NAD）
                    if (!nad) {
                        nad = nads.find((n: any) => n.metadata?.name === targetName);
                    }
                    
                    if (nad) {
                        let config: any = {};
                        try {
                            const rawConfig = nad.spec?.config || '{}';
                            config = typeof rawConfig === 'object' ? rawConfig : JSON.parse(rawConfig);
                        } catch (e) {}
                        
                        // 兼容 NAD config 的两种形态：plugins 列表或单对象
                        const plugins = config.plugins || [config];
                        const kubeOvnConfig = plugins.find((p: any) => p?.type === 'kube-ovn');
                        const bridgeConfig = plugins.find((p: any) => p?.type === 'bridge');

                        if (kubeOvnConfig) {
                            // [VPC 网络] kube-ovn：用 subnet.spec.vpc 找到 VPC，并展示别名/名称
                            const subnet = subnets.find((s: any) => s.metadata?.name === targetName);
                            if (subnet) {
                                const vpcName = subnet.spec?.vpc || subnet.vpc || 'Unknown VPC';
                                const vpc = vpcs.find((v: any) => v.metadata?.name === vpcName);
                                const vpcDisplay = vpc?.metadata?.annotations?.['tower.io/alias'] || vpcName;
                                displayName = `VPC / ${vpcDisplay} / ${subnet.metadata.name}`;
                            } else {
                                // subnet 资源缺失时兜底展示
                                displayName = `VPC / ${targetName}`;
                            }
                        } else if (bridgeConfig) {
                            // [Flat 网络] bridge：按 VLAN 与 NAD 名称展示
                            const vlanId = bridgeConfig.vlan;
                            displayName = `Flat / ${vlanId ? `VLAN ${vlanId} / ` : ''}${nad.metadata.name}`;
                        } else {
                            // [其它网络] 自定义 CNI：展示 type 与 NAD 名称便于排查
                            const type = config.type || 'Unknown';
                            displayName = `${type} / ${nad.metadata.name}`;
                        }
                    } else {
                        // NAD 未找到时兜底按 Flat 展示，避免 UI 出现空值
                        displayName = `Flat / ${targetName}`;
                    }
                } catch (e) {
                    console.warn('[VmDetail] Error mapping network:', e);
                    // 最终兜底：仅展示名称，避免异常阻断渲染
                    const parts = displayName.split('/');
                    const targetName = parts.length > 1 ? parts[1] : parts[0];
                    displayName = `Flat / ${targetName}`;
                }
            }

            return {
                name: i.name,
                model: i.model || 'virtio',
                networkName: displayName,
                mac: mac,
                ip: ip
            };
        });
    }
  }), [namespaces, volumes, vpcs, subnets, nads]);

  // ==============================================================================
  // 10. 操作封装 (Actions)
  // ==============================================================================
  // [动作封装] 将按钮/菜单的操作集中封装，统一处理消息提示与上游刷新回调
  const handleStart = async () => {
     try {
         const ns = SafeRead.namespace(vmData);
         const name = SafeRead.vmId(vmData);
         await startHarvesterVm(cloudId, ns, name);
         message.success('启动指令已发送');
         onRefresh && onRefresh();
     } catch(e: any) {
         message.error(e.message || '启动失败');
     }
  };

  const handleStop = async (force = false) => {
     try {
         const ns = SafeRead.namespace(vmData);
         const name = SafeRead.vmId(vmData);
         await stopHarvesterVm(cloudId, ns, name, force);
         message.success('停止指令已发送');
         onRefresh && onRefresh();
     } catch(e: any) {
         message.error(e.message || '停止失败');
     }
  };

  const handleReboot = async () => {
      try {
          const ns = SafeRead.namespace(vmData);
          const name = SafeRead.vmId(vmData);
          // [实例标识] Harvester 侧的 instanceId 约定为 namespace/name
          const instanceId = `${ns}/${name}`;
          await rebootCloudProviderEcs(cloudId, instanceId);
          message.success('重启指令已发送');
          onRefresh && onRefresh();
      } catch(e: any) {
          message.error(e.message || '重启失败');
      }
  };

  const handlePause = async () => {
    try {
        const ns = SafeRead.namespace(vmData);
        const name = SafeRead.vmId(vmData);
        await pauseHarvesterVm(cloudId, ns, name);
        message.success('暂停指令已发送');
        onRefresh && onRefresh();
    } catch(e: any) {
        message.error(e.message || '暂停失败');
    }
  };

  const handleUnpause = async () => {
    try {
        const ns = SafeRead.namespace(vmData);
        const name = SafeRead.vmId(vmData);
        await unpauseHarvesterVm(cloudId, ns, name);
        message.success('恢复指令已发送');
        onRefresh && onRefresh();
    } catch(e: any) {
        message.error(e.message || '恢复失败');
    }
  };

  const handleConsole = async () => {
    const ns = SafeRead.namespace(vmData);
    const name = SafeRead.vmId(vmData);
    if (ns && name) {
        const url = `/clouds/${encodeURIComponent(cloudId)}/harvester/vnc?cloudId=${encodeURIComponent(cloudId)}&namespace=${encodeURIComponent(ns)}&name=${encodeURIComponent(name)}`;
        window.open(url, '_blank');
    } else {
        message.warning('无法解析实例信息');
    }
  };

  const handleSaveAsTemplate = useCallback(async () => {
    setShowTemplateModal(true);
  }, []);


  const handleEjectCdrom = useCallback(async () => {
    const disks = vmData?.spec?.template?.spec?.domain?.devices?.disks || [];
    // [设备选择] 以第一块盘作为“启动盘/引导盘”候选，并在下方按 isCdromBoot 控制入口是否展示
    const cdrom = disks[0];
    if (!cdrom) return;
    
    const statusStr = String(SafeRead.status(vmData)).toLowerCase();
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
          const ns = SafeRead.namespace(vmData);
          const name = SafeRead.vmId(vmData);
          // [实例标识] 后端部分接口使用 iid=namespace/name
          const iidStr = `${ns}/${name}`;
          
          if (!ns || !name) throw new Error('无法解析实例信息');

          // ---------------------------------------------------------
          // 第一步：运行中先停止（避免在线卸载导致状态不一致）
          // ---------------------------------------------------------
          if (isRunning) {
              await stopHarvesterVm(cloudId, ns, name, true);
              await new Promise(resolve => setTimeout(resolve, 5000));
          }

          // ---------------------------------------------------------
          // 第二步：从 VM 上卸载对应卷
          // ---------------------------------------------------------
          await detachHarvesterVolumeFromVm(cloudId, iidStr, { name: cdrom.name });

          // ---------------------------------------------------------
          // 第三步：按用户勾选决定是否删除 PVC（避免残留孤儿卷）
          // ---------------------------------------------------------
          if (deletePvc) {
              const volumes = vmData?.spec?.template?.spec?.volumes || [];
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

          // ---------------------------------------------------------
          // 第四步：若之前处于运行态，则恢复启动
          // ---------------------------------------------------------
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
  }, [cloudId, vmData, onRefresh, SafeRead]);

  // [事件] 中止迁移
  const handleAbortMigration = useCallback(() => {
    Modal.confirm({
      title: '确认中止迁移？',
      icon: <ExclamationCircleOutlined />,
      content: `确定要中止虚拟机 ${SafeRead.name(vmData)} 的迁移任务吗？`,
      okText: '中止迁移',
      okType: 'danger',
      onOk: async () => {
        const hide = message.loading('正在中止迁移...', 0);
        try {
          const ns = SafeRead.namespace(vmData);
          const name = SafeRead.vmId(vmData);
          // [实例标识] Harvester 侧的 instanceId 约定为 namespace/name
          const instanceId = `${ns}/${name}`;
          await abortHarvesterMigration(cloudId, instanceId);
          message.success('已发送中止迁移指令');
          onRefresh && onRefresh(true);
        } catch (e: any) {
          message.error(`中止迁移失败: ${e.message || '未知错误'}`);
        } finally {
          hide();
        }
      }
    });
  }, [cloudId, vmData, onRefresh, SafeRead]);

  const status = String(SafeRead.status(vmData)).toLowerCase();

  // [配置同步状态] 使用 K8s generation 字段简单判断是否存在“配置未完全同步”的提示信息
  const vmGeneration = vmData?.metadata?.generation;
  // 预留 observedGeneration/desiredGeneration 等字段（如果后端聚合接口未来补充，可以直接使用）
  const observedGeneration =
    vmData?.status?.observedGeneration ??
    vmData?.status?.desiredGeneration ??
    vmData?.status?.lastObservedGeneration;

  const hasGenerationInfo =
    typeof vmGeneration === 'number' && typeof observedGeneration === 'number';

  const isConfigOutOfSync =
    hasGenerationInfo && vmGeneration > observedGeneration;

  // [热扩容状态] 复刻列表/变配中的判定逻辑：基于 Annotation + Conditions
  const annotations = vmData?.metadata?.annotations || {};
  const conditions = vmData?.status?.conditions || [];

  const isHotPlugConfigured =
    annotations['harvesterhci.io/enableCPUAndMemoryHotplug']?.toLowerCase() ===
    'true';

  const hasRestartRequired = conditions.some(
    (c: any) => c.type === 'RestartRequired' && c.status === 'True',
  );

  const hasHotPlugChangeInProgress = conditions.some(
    (c: any) =>
      (c.type === 'HotVCPUChange' || c.type === 'HotMemoryChange') &&
      c.status === 'True',
  );

  // [关键修复] 检查 VM 是否可迁移（内存热扩容的前提条件）
  // KubeVirt 要求：Memory-hotplug is only available for migratable VMs
  // [兼容性] 同时检查 LiveMigratable 和 VirtualMachineInstanceIsMigratable 两种条件类型
  const vmi = vmData?.vmi || vmData?.vmiRaw;
  const vmiConditions = vmi?.status?.conditions || [];
  const isMigratable = vmiConditions.some(
    (c: any) =>
      (c.type === 'LiveMigratable' || c.type === 'VirtualMachineInstanceIsMigratable') &&
      c.status === 'True',
  );

  // 当前是否可以正常执行热扩容操作（已配置 且 无待重启 且 无在途变更）
  // [关键修正] CPU 热扩容会触发迁移，因此也需要 VM 可迁移
  // 如果 VM 不可迁移，CPU 和内存热扩容都无法执行
  const isHotPlugEffective =
    isHotPlugConfigured && !hasRestartRequired && !hasHotPlugChangeInProgress && isMigratable;

  // 已配置但需要重启后才生效
  const isHotPlugPendingRestart =
    isHotPlugConfigured && hasRestartRequired && !hasHotPlugChangeInProgress;

  // 已配置且正在执行热扩容
  const isHotPlugInProgress =
    isHotPlugConfigured && hasHotPlugChangeInProgress;
  const isStopped = ['stopped', 'shutoff', 'down', 'offline'].includes(status);
  const isRunning = ['running'].includes(status);
  const isPaused = ['paused'].includes(status);
  const isMigrating = status === 'Migrating' || status.toLowerCase() === 'migrating';


  // ==============================================================================
  // 11. 派生状态 (Derived Flags)
  // ==============================================================================
  // [故障提示] HotPlugCPUError 通常表示热插拔 CPU 变配失败，需要在 UI 上显式提示
  const hotPlugCpuError = conditions.find(
    (c: any) =>
      c.type === 'Failure' &&
      c.reason === 'HotPlugCPUError' &&
      c.status === 'True',
  );
  
  const vmDisks = SafeRead.volumeDetails(vmData);
  const vmNics = SafeRead.interfaces(vmData);
  const vmDeviceAlloc = useMemo(() => {
    const domain = vmData?.spec?.template?.spec?.domain;
    const devices = domain?.devices || {};

    let allocation: any = null;
    try {
      const raw = vmData?.metadata?.annotations?.['harvesterhci.io/deviceAllocationDetails'];
      if (raw) allocation = typeof raw === 'string' ? JSON.parse(raw) : raw;
    } catch {
      allocation = null;
    }
    const hostAlloc = allocation?.hostdevices || {};
    return { hostAlloc, devices };
  }, [vmData]);

  const vmGpus = useMemo(() => {
    const isUsb = (x: any) => {
      const dn = String(x?.deviceName || '').toLowerCase();
      const n = String(x?.name || '').toLowerCase();
      return dn.includes('usb') || n.includes('usb');
    };
    const hostDevices = Array.isArray(vmDeviceAlloc?.devices?.hostDevices) ? vmDeviceAlloc.devices.hostDevices : [];
    const gpus = Array.isArray(vmDeviceAlloc?.devices?.gpus) ? vmDeviceAlloc.devices.gpus : [];
    const mapped = [
      ...hostDevices.filter((d: any) => !isUsb(d)).map((d: any) => ({ kind: 'hostDevices', deviceName: d?.deviceName, name: d?.name })),
      ...gpus.map((d: any) => ({ kind: 'gpus', deviceName: d?.deviceName, name: d?.name })),
    ]
      .filter((x: any) => x?.deviceName || x?.name)
      .map((x: any) => {
        const allocNames = Array.isArray(vmDeviceAlloc?.hostAlloc?.[x.deviceName]) ? vmDeviceAlloc.hostAlloc[x.deviceName] : [];
        return { ...x, allocationNames: allocNames };
      });
    return mapped;
  }, [vmDeviceAlloc]);

  const vmUsb = useMemo(() => {
    const isUsb = (x: any) => {
      const dn = String(x?.deviceName || '').toLowerCase();
      const n = String(x?.name || '').toLowerCase();
      return dn.includes('usb') || n.includes('usb');
    };
    const hostDevices = Array.isArray(vmDeviceAlloc?.devices?.hostDevices) ? vmDeviceAlloc.devices.hostDevices : [];
    return hostDevices
      .filter((d: any) => isUsb(d))
      .map((d: any) => ({ kind: 'hostDevices', deviceName: d?.deviceName, name: d?.name }))
      .filter((x: any) => x?.deviceName || x?.name)
      .map((x: any) => {
        const allocNames = Array.isArray(vmDeviceAlloc?.hostAlloc?.[x.deviceName]) ? vmDeviceAlloc.hostAlloc[x.deviceName] : [];
        return { ...x, allocationNames: allocNames };
      });
  }, [vmDeviceAlloc]);

  // [动作开关] 若第一块磁盘为 cdrom，则暴露“弹出 CD-ROM”动作
  const rawDisks = vmData?.spec?.template?.spec?.domain?.devices?.disks || [];
  const isCdromBoot = rawDisks.length > 0 && !!rawDisks[0].cdrom;

  // [下拉菜单] 更多动作入口（按业务域分组：数据/运行态/危险操作）
  const actionItems: MenuProps['items'] = [
      // 数据与副本（备份/快照/克隆/模板）
      { key: 'backup', label: '备份', icon: <DatabaseOutlined />, onClick: () => onBackup && onBackup(vmData) },
      { key: 'snapshot', label: '快照', icon: <HistoryOutlined />, onClick: () => onSnapshot && onSnapshot(vmData) },
      { key: 'clone', label: '克隆', icon: <CopyOutlined />, onClick: () => onClone && onClone(vmData) },
      { key: 'save_template', label: '保存为模板', icon: <SaveOutlined />, onClick: handleSaveAsTemplate },
      
      { type: 'divider' },

      // 运行态操作（变配/热插拔/迁移/介质卸载）
      { 
        key: 'reconfigure', 
        label: '资源变配', 
        icon: <HddOutlined />, 
        disabled: !isStopped && !isRunning,
        title: (!isStopped && !isRunning) ? '仅在运行中或停止状态下支持变配' : undefined,
        onClick: () => onOpenReconfigure && onOpenReconfigure(vmData) 
      },
      // 根据迁移状态动态显示"热迁移"或"中止迁移"
      ...(isMigrating ? [
        { 
          key: 'abort_migration', 
          label: '中止迁移', 
          icon: <StopOutlined />, 
          danger: true,
          onClick: handleAbortMigration 
        }
      ] : [
        { 
          key: 'migrate', 
          label: '热迁移', 
          icon: <ExportOutlined />, 
          disabled: !isRunning,
          title: !isRunning ? '只有运行中的实例才能进行热迁移' : undefined,
          onClick: () => onMigrate && onMigrate(vmData) 
        }
      ]),
      ...(isCdromBoot ? [{ key: 'eject', label: '弹出CD-ROM', icon: <StopOutlined />, onClick: handleEjectCdrom }] : []),

      { type: 'divider' },

      // 危险操作（强制停止/删除）
      { key: 'force_stop', label: '强制停止', icon: <PoweroffOutlined />, danger: true, disabled: isStopped, onClick: () => handleStop(true) },
      { key: 'delete', label: '删除', icon: <DeleteOutlined />, danger: true, onClick: () => onDelete && onDelete(vmData) },
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
      {/*
        ========================================
        1. 标题区域
        ========================================
        展示 VM 名称/ID/状态，以及刷新与关闭入口。
      */}
      <div style={{ background: '#f5f7fa', padding: '16px 24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0 }}>
         <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ 
                width: 38,
                height: 38,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
            }}>
                <OsIcon osName={SafeRead.osName(vmData)} style={{ fontSize: 32 }} />
            </div>
            <div>
                <div style={{ fontSize: 18, fontWeight: 500, lineHeight: 1.2 }}>{SafeRead.name(vmData)}</div>
                <div style={{ fontSize: 12, color: '#999'}}>ID: {SafeRead.vmId(vmData)}</div>
            </div>
            <Tag color={isRunning ? 'success' : 'default'} style={{ margin: 0}}>{cnVmStatus(status)}</Tag>

            {/* 配置同步状态徽章：仅当存在 generation 信息时展示 */}
            {hasGenerationInfo && (
              <Tooltip
                title={
                  isConfigOutOfSync
                    ? `配置未完全同步：当前 VM generation = ${vmGeneration}，最新已同步版本 = ${observedGeneration}。这通常表示最近一次规格/配置变更仍在同步或落盘过程中。`
                    : `配置已同步：当前 VM generation = ${vmGeneration}，同步版本 = ${observedGeneration}。`
                }
              >
                <Tag
                  color={isConfigOutOfSync ? 'processing' : 'default'}
                  style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 4 }}
                >
                  <InfoCircleOutlined />
                  {isConfigOutOfSync ? '变更同步中' : '配置已同步'}
                </Tag>
              </Tooltip>
            )}

            {/* 热扩容状态徽章：仅当已配置且在运行状态（或待重启状态）时展示 */}
            {/* [关键修正] 热扩容功能需要 VM 运行，关机状态下不显示状态徽章（待重启状态除外） */}
            {isHotPlugConfigured && (isRunning || isHotPlugPendingRestart) && (
              <Tooltip
                title={
                  isHotPlugInProgress
                    ? '热扩容进行中：当前正在执行 CPU 或内存热扩容操作，期间禁止再次发起新的热扩容/规格变更。'
                    : isHotPlugPendingRestart
                    ? '热扩容已配置但未完全生效：需要先重启虚拟机，才能开启 CPU/内存热插拔能力。'
                    : isHotPlugEffective
                    ? '热扩容已启用：当前虚拟机支持在不重启的前提下增加 CPU / 内存（受 maxSockets/maxMemory 上限约束）。'
                    : isHotPlugConfigured && !isMigratable
                    ? '热扩容不可用：CPU 和内存热扩容都需要 VM 可迁移（当前不可迁移），请检查 PVC 是否为共享存储（ReadWriteMany）或移除阻止迁移的设备。'
                    : '热扩容状态异常：已存在配置标记，但状态条件无法判定为生效/在途/待重启，请查看事件或日志。'
                }
              >
                <Tag
                  color={
                    isHotPlugInProgress
                      ? 'processing'
                      : isHotPlugPendingRestart
                      ? 'warning'
                      : isHotPlugEffective
                      ? 'success'
                      : isHotPlugConfigured && !isMigratable
                      ? 'warning' // VM 不可迁移，热扩容不可用
                      : 'default'
                  }
                  style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 4 }}
                >
                  <InfoCircleOutlined />
                  {isHotPlugInProgress
                    ? '热扩容中'
                    : isHotPlugPendingRestart
                    ? '热扩容待重启'
                    : isHotPlugEffective
                    ? '热扩容已启用'
                    : isHotPlugConfigured && !isMigratable
                    ? '热扩容不可用'
                    : '热扩容异常'}
                </Tag>
              </Tooltip>
            )}

            {hotPlugCpuError && (
              <Tooltip title={`CPU 热插拔失败: ${hotPlugCpuError.message || '未知错误'}`}>
                <Tag color="error" style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 4 }}>
                  <ExclamationCircleOutlined /> CPU 热插拔失败
                </Tag>
              </Tooltip>
            )}
         </div>
         <div style={{ display: 'flex', alignItems: 'center' }}>
            <Button 
                type="text" 
                icon={<SyncOutlined spin={refreshing} />} 
                onClick={() => fetchAggregated(true)}
                style={{ 
                    width: 32, 
                    height: 32, 
                    display: 'flex', 
                    alignItems: 'center', 
                    justifyContent: 'center', 
                    borderRadius: 4,
                    padding: 0,
                    color: '#666'
                    }}
                />
            <Button 
                type="text" 
                onClick={onClose} 
                style={{ 
                    width: 32, 
                    height: 32, 
                    display: 'flex', 
                    alignItems: 'center', 
                    justifyContent: 'center', 
                    borderRadius: 4,
                    fontSize: 16,
                    padding: 0,
                    color: '#666'
                }}
            >
                <CloseOutlined />
            </Button>
         </div>
      </div>

      {/*
        ========================================
        2. 工具栏区域
        ========================================
        常用运维动作入口；右侧“更多”下拉承载低频/危险操作。
      */}
      <div style={{ background: '#f5f7fa', padding: '0 24px 4px', flexShrink: 0 }}>
        <div style={{ padding: 4, background: '#fff', borderRadius: 8, display: 'flex', gap: 4, alignItems: 'center',border: '1px solid #e0e0e0' }}>
          <Button className="vm-toolbar-btn" type="text" size="small" icon={<CodeOutlined style={{ color: isStopped ? undefined : '#1890ff' }} />} onClick={handleConsole} disabled={isStopped} style={{ fontSize: 14 }}>打开终端</Button>
          
          <Button className="vm-toolbar-btn" type="text" size="small" icon={<PlayCircleOutlined style={{ color: isStopped ? '#1890ff' : undefined }} />} onClick={handleStart} disabled={!isStopped} style={{ fontSize: 14 }}>开机</Button>

          <Button className="vm-toolbar-btn" type="text" size="small" icon={<PoweroffOutlined style={{ color: isStopped ? undefined : '#1890ff' }} />} onClick={() => handleStop(false)} disabled={isStopped} style={{ fontSize: 14 }}>关机</Button>

          <Button className="vm-toolbar-btn" type="text" size="small" icon={<ReloadOutlined style={{ color: isStopped ? undefined : '#1890ff' }} />} onClick={handleReboot} disabled={isStopped} style={{ fontSize: 14 }}>重启</Button>

          <Button className="vm-toolbar-btn" type="text" size="small" icon={<PauseCircleOutlined style={{ color: isRunning ? '#1890ff' : undefined }} />} onClick={handlePause} disabled={!isRunning} style={{ fontSize: 14 }}>暂停</Button>

          <Button className="vm-toolbar-btn" type="text" size="small" icon={<PlayCircleOutlined style={{ color: isPaused ? '#1890ff' : undefined }} />} onClick={handleUnpause} disabled={!isPaused} style={{ fontSize: 14 }}>恢复</Button>

          <div style={{ flex: 1 }} />
          
          <Dropdown menu={{ items: actionItems }} trigger={['click']}>
              <Button className="vm-toolbar-btn" type="text" size="small" icon={<EllipsisOutlined style={{ color: '#1890ff' }} />} />
          </Dropdown>
        </div>
      </div>

      {/*
        ========================================
        3. Tab 导航
        ========================================
        detail: 规格/磁盘/网卡/配置等；performance: 性能趋势；backup_snapshot: 备份与定时策略；events: 事件流。
      */}
      <div style={{ background: '#f5f7fa', padding: '0 24px', flexShrink: 0 }}>
          <div style={{ padding: '0 0 24px 0' }}>
            <div style={{ padding: 4, background: '#fff', borderRadius: 8 ,border: '1px solid #e0e0e0'}}>
            <Segmented
              size="small"
              value={activeTab}
              onChange={(val) => handleTabChange(String(val))}
              options={[
                { label: '详情', value: 'detail', icon: <DesktopOutlined /> },
                { label: '性能', value: 'performance', icon: <LineChartOutlined /> },
                { label: '诊断', value: 'diagnosis', icon: <ExclamationCircleOutlined /> },
                { label: '备份/快照', value: 'backup_snapshot', icon: <DatabaseOutlined /> },
                { label: '事件', value: 'events', icon: <BellOutlined /> },
                { label: '实时日志', value: 'logs', icon: <FileTextOutlined /> },
              ]}
            />
            </div>
          </div>
      </div>

      {/*
        ========================================
        4. 内容区域
        ========================================
        根据 activeTab 渲染对应内容；detail Tab 为主信息聚合展示。
      */}
      <style>{`
          .vm-toolbar-btn {
               background: #f5f7fa;
               border: none !important;
               color: #666;
           }
           .vm-toolbar-btn:hover:not(:disabled) {
               background: #e6f7ff !important;
               color: #1890ff !important;
           }
           .vm-toolbar-btn:hover:not(:disabled) .anticon {
               color: #1890ff !important;
           }
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
                  {/*
                    ========================================
                    4.1 规格与使用率
                    ========================================
                    上半部分展示 CPU/内存规格与当前使用率（来自 Prometheus 指标）。
                  */}
                  
                  <Card variant="borderless" styles={{ body: { padding: 16 } }}>
                      <div style={{ display: 'flex', gap: 24 }}>
                          {/* CPU 区域 */}
                          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                                  <div style={{ 
                                    width: 48, height: 48, borderRadius: 8, background: '#f0f9ff',
                                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                                    color: '#1890ff', fontSize: 24
                                }}>
                                    <CpuIcon width={28} height={28} style={{ fill: '#1890ff' }} />
                                </div>
                                  <div>
                                      <div style={{ color: '#999', fontSize: 12 }}>CPU</div>
                                      <div style={{ fontSize: 20, fontWeight: 500 }}>
                                          {SafeRead.cpu(vmData)} <span style={{ fontSize: 14, color: '#999', fontWeight: 400 }}>Core</span>
                                      </div>
                                  </div>
                              </div>
                              {SafeRead.cpu(vmData) > 0 && (
                                  <div style={{ flex: 1, marginLeft: 24, background: '#ffffff', border: '1px solid #188fff80', borderRadius: 8, padding: 8 }}>
                                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: '#666' }}>
                                          <span>使用率</span>
                                          <span>{cpuUsage !== null ? `${((cpuUsage / SafeRead.cpu(vmData)) * 100).toFixed(1)}%` : '-'}</span>
                                      </div>
                                      <Progress 
                                        percent={cpuUsage !== null ? parseFloat(((cpuUsage / SafeRead.cpu(vmData)) * 100).toFixed(1)) : 0} 
                                        showInfo={false} 
                                        strokeColor="#1890ff"
                                        trailColor="#f0f0f0"
                                        size="small"
                                      />
                                  </div>
                              )}
                          </div>
                          
                          <div style={{ width: 1, background: '#f0f0f0' }} />

                          {/* 内存区域 */}
                          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                                  <div style={{ 
                                    width: 48, height: 48, borderRadius: 8, background: '#f0f9ff',
                                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                                    color: '#1890ff', fontSize: 24
                                }}>
                                    <MemIcon width={28} height={28} style={{ fill: '#1890ff' }} />
                                </div>
                                  <div>
                                      <div style={{ color: '#999', fontSize: 12 }}>内存</div>
                                      <div style={{ fontSize: 20, fontWeight: 500 }}>
                                          {(() => {
                                              const [val, unit] = formatMemoryParts(SafeRead.memory(vmData));
                                              return <>{val} <span style={{ fontSize: 14, color: '#999', fontWeight: 400 }}>{unit}</span></>;
                                          })()}
                                      </div>
                                  </div>
                              </div>
                              {parseStorageSize(SafeRead.memory(vmData)) > 0 && (
                                  <div style={{ flex: 1, marginLeft: 24, background: '#ffffff', border: '1px solid #188fff80', borderRadius: 8, padding: 8 }}>
                                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: '#666' }}>
                                          <span>使用率</span>
                                          <span>{memUsage !== null ? `${((memUsage / (1024 ** 3) / parseStorageSize(SafeRead.memory(vmData))) * 100).toFixed(1)}%` : '-'}</span>
                                      </div>
                                      <Progress 
                                        percent={memUsage !== null ? parseFloat(((memUsage / (1024 ** 3) / parseStorageSize(SafeRead.memory(vmData))) * 100).toFixed(1)) : 0} 
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
                              <Descriptions size="small" column={2} styles={{ label: { width: 150, color: '#999' } }}>
                                  <Descriptions.Item label={
                                      <Tooltip title="CPU Topology: 插槽 (Sockets) × 核心 (Cores) × 线程 (Threads)">
                                          <span style={{ borderBottom: '1px dashed #999', cursor: 'help' }}>CPU 拓扑</span>
                                      </Tooltip>
                                  }>
                                      {`${vmData?.spec?.template?.spec?.domain?.cpu?.sockets || '-'} 插槽 × ${vmData?.spec?.template?.spec?.domain?.cpu?.cores || '-'} 核心 × ${vmData?.spec?.template?.spec?.domain?.cpu?.threads || '-'} 线程`}
                                  </Descriptions.Item>
                                  <Descriptions.Item label={
                                      <Tooltip title="Guest Memory: 虚拟机操作系统实际可见的内存大小（配置规格）">
                                          <span style={{ borderBottom: '1px dashed #999', cursor: 'help' }}>内存规格 (Guest)</span>
                                      </Tooltip>
                                  }>
                                      {vmData?.spec?.template?.spec?.domain?.memory?.guest || '-'}
                                  </Descriptions.Item>

                                  <Descriptions.Item label={
                                      <Tooltip title="Request CPU: Kubernetes 调度器为该虚拟机预留的 CPU 资源保障">
                                          <span style={{ borderBottom: '1px dashed #999', cursor: 'help' }}>CPU 预留 (Request)</span>
                                      </Tooltip>
                                  }>
                                      {vmData?.spec?.template?.spec?.domain?.resources?.requests?.cpu || '-'}
                                  </Descriptions.Item>
                                  <Descriptions.Item label={
                                      <Tooltip title="Request Memory: Kubernetes 调度器为该虚拟机预留的内存资源保障">
                                          <span style={{ borderBottom: '1px dashed #999', cursor: 'help' }}>内存预留 (Request)</span>
                                      </Tooltip>
                                  }>
                                      {vmData?.spec?.template?.spec?.domain?.resources?.requests?.memory || '-'}
                                  </Descriptions.Item>

                                  <Descriptions.Item label={
                                      <Tooltip title="Limit CPU: 虚拟机容器允许使用的最大 CPU 资源（通常与 Request 一致以保证独占）">
                                          <span style={{ borderBottom: '1px dashed #999', cursor: 'help' }}>CPU 上限 (Limit)</span>
                                      </Tooltip>
                                  }>
                                      {vmData?.spec?.template?.spec?.domain?.resources?.limits?.cpu || '-'}
                                  </Descriptions.Item>
                                  <Descriptions.Item label={
                                      <Tooltip title="Limit Memory: 虚拟机容器允许使用的最大内存资源（包含虚拟化开销）">
                                          <span style={{ borderBottom: '1px dashed #999', cursor: 'help' }}>内存上限 (Limit)</span>
                                      </Tooltip>
                                  }>
                                      {vmData?.spec?.template?.spec?.domain?.resources?.limits?.memory || '-'}
                                  </Descriptions.Item>

                                  <Descriptions.Item label={
                                      <Tooltip title="机器架构: 虚拟机运行的 CPU 架构（如 x86_64, aarch64）">
                                          <span style={{ borderBottom: '1px dashed #999', cursor: 'help' }}>机器架构</span>
                                      </Tooltip>
                                  }>
                                      {vmData?.spec?.template?.spec?.architecture || '-'} 
                                  </Descriptions.Item>
                                  <Descriptions.Item label={
                                      <Tooltip title="QEMU 机器类型: 虚拟机使用的 QEMU 模拟硬件类型（如 pc, q35）">
                                          <span style={{ borderBottom: '1px dashed #999', cursor: 'help' }}>QEMU 机器类型</span>
                                      </Tooltip>
                                  }>
                                      {vmData?.spec?.template?.spec?.domain?.machine?.type || '-'}
                                  </Descriptions.Item>
                              </Descriptions>
                          </div>
                      )}
                  </Card>

                  {/*
                    ========================================
                    4.2 虚拟磁盘
                    ========================================
                    由 VM volumes 与 domain.devices.disks 合并得到：
                    - 展示引导顺序、总线类型、容量（PVC 口径）、以及 CD-ROM 标识。
                  */}
                  <div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                          <span style={{ color: '#666' }}>虚拟磁盘</span>
                      </div>
                      <Card variant="borderless" styles={{ body: { padding: 0 } }}>
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
                                            <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                                                <span>{item.name}</span>
                                                {item.bootOrder === 1 && <Tag color="red" style={{ fontSize: 10, margin: 0 }}>启动盘</Tag>}
                                                {item.imageDisplayName && (
                                                    <Tag color="blue" style={{ fontSize: 10, margin: 0, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                                                        <OsIcon osName={item.imageDisplayName} style={{ fontSize: 12 }} />
                                                        {item.imageDisplayName}
                                                    </Tag>
                                                )}
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

                  {/*
                    ========================================
                    4.3 虚拟网卡
                    ========================================
                    结合接口/VMI status/注解提取 MAC/IP，并将 multus.networkName 映射为 VPC/Flat/VLAN 文案。
                  */}
                  <div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                          <span style={{ color: '#666' }}>虚拟网卡</span>
                      </div>
                      <Card variant="borderless" styles={{ body: { padding: 0 } }}>
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

                  {vmGpus.length > 0 && (
                      <div>
                          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                              <span style={{ color: '#666' }}>GPU</span>
                          </div>
                          <Card variant="borderless" styles={{ body: { padding: 0 } }}>
                              <List
                                dataSource={vmGpus}
                                renderItem={(item: any) => (
                                    <List.Item style={{ padding: '16px 24px' }}>
                                        <List.Item.Meta
                                            avatar={
                                              <div style={{ 
                                                  width: 48, height: 48, borderRadius: 8, background: '#ffffff',
                                                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                                                  flexShrink: 0 
                                              }}>
                                                  <GpuIcon width={34} height={34} style={{ fill: '#1890ff' }} />
                                              </div>
                                            }
                                            title={
                                              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                                                <span style={{ wordBreak: 'break-word' }}>{item.deviceName || '-'}</span>
                                                <Tag color={item.kind === 'gpus' ? 'blue' : 'purple'} style={{ fontSize: 10, margin: 0 }}>
                                                  {item.kind === 'gpus' ? 'GPU' : 'HostDevice'}
                                                </Tag>
                                              </div>
                                            }
                                            description={
                                              <div style={{ fontSize: 12, color: '#666' }}>
                                                {item.name ? (
                                                  <span>分配ID：{item.name}</span>
                                                ) : null}
                                                {Array.isArray(item.allocationNames) && item.allocationNames.length > 0 ? (
                                                  <>
                                                    {item.name ? <span style={{ margin: '0 8px', color: '#eee' }}>|</span> : null}
                                                    <span>分配明细：{item.allocationNames.join(', ')}</span>
                                                  </>
                                                ) : null}
                                              </div>
                                            }
                                        />
                                    </List.Item>
                                )}
                              />
                          </Card>
                      </div>
                  )}

                  {vmUsb.length > 0 && (
                      <div>
                          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                              <span style={{ color: '#666' }}>USB</span>
                          </div>
                          <Card variant="borderless" styles={{ body: { padding: 0 } }}>
                              <List
                                dataSource={vmUsb}
                                renderItem={(item: any) => (
                                    <List.Item style={{ padding: '16px 24px' }}>
                                        <List.Item.Meta
                                            avatar={
                                              <div style={{ 
                                                  width: 48, height: 48, borderRadius: 8, background: '#ffffff',
                                                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                                                  flexShrink: 0 
                                              }}>
                                                  <UsbIcon width={34} height={34} style={{ fill: '#1890ff' }} />
                                              </div>
                                            }
                                            title={
                                              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                                                <span style={{ wordBreak: 'break-word' }}>{item.deviceName || '-'}</span>
                                                <Tag color="purple" style={{ fontSize: 10, margin: 0 }}>USB</Tag>
                                              </div>
                                            }
                                            description={
                                              <div style={{ fontSize: 12, color: '#666' }}>
                                                {item.name ? (
                                                  <span>分配ID：{item.name}</span>
                                                ) : null}
                                                {Array.isArray(item.allocationNames) && item.allocationNames.length > 0 ? (
                                                  <>
                                                    {item.name ? <span style={{ margin: '0 8px', color: '#eee' }}>|</span> : null}
                                                    <span>分配明细：{item.allocationNames.join(', ')}</span>
                                                  </>
                                                ) : null}
                                              </div>
                                            }
                                        />
                                    </List.Item>
                                )}
                              />
                          </Card>
                      </div>
                  )}

                  {/*
                    ========================================
                    4.4 节点调度
                    ========================================
                    展示节点选择器（nodeSelector）和节点亲和性（nodeAffinity）配置，帮助诊断调度问题。
                  */}
                  <div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                          <span style={{ color: '#666' }}>节点调度</span>
                      </div>
                      <Card variant="borderless" styles={{ body: { padding: '16px 24px' } }}>
                          <Descriptions column={1} size="small" styles={{ label: { width: 140, color: '#999' } }}>
                              <Descriptions.Item label="当前节点">
                                  {vmData?.status?.nodeName || vmData?.vmi?.status?.nodeName || '-'}
                              </Descriptions.Item>
                              <Descriptions.Item label={
                                  <Tooltip title="节点选择器：强制虚拟机调度到指定节点（如 GPU 节点固定）">
                                      <span style={{ borderBottom: '1px dashed #999', cursor: 'help' }}>节点选择器</span>
                                  </Tooltip>
                              }>
                                  {(() => {
                                      const nodeSelector = vmData?.spec?.template?.spec?.nodeSelector;
                                      if (!nodeSelector || Object.keys(nodeSelector).length === 0) {
                                          return <span style={{ color: '#999' }}>未设置</span>;
                                      }
                                      return (
                                          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                                              {Object.entries(nodeSelector).map(([key, value]) => (
                                                  <Tag key={key} color="blue" style={{ margin: 0 }}>
                                                      {key}: {String(value)}
                                                  </Tag>
                                              ))}
                                          </div>
                                      );
                                  })()}
                              </Descriptions.Item>
                              <Descriptions.Item label={
                                  <Tooltip title="节点亲和性：根据节点标签进行调度（如网络标签要求）">
                                      <span style={{ borderBottom: '1px dashed #999', cursor: 'help' }}>节点亲和性</span>
                                  </Tooltip>
                              }>
                                  {(() => {
                                      const nodeAffinity = vmData?.spec?.template?.spec?.affinity?.nodeAffinity;
                                      if (!nodeAffinity?.requiredDuringSchedulingIgnoredDuringExecution) {
                                          return <span style={{ color: '#999' }}>未设置</span>;
                                      }
                                      const terms = nodeAffinity.requiredDuringSchedulingIgnoredDuringExecution.nodeSelectorTerms || [];
                                      if (terms.length === 0) {
                                          return <span style={{ color: '#999' }}>未设置</span>;
                                      }
                                      return (
                                          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                                              {terms.map((term: any, idx: number) => (
                                                  <div key={idx} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                                                      {term.matchExpressions?.map((expr: any, exprIdx: number) => (
                                                          <Tag key={exprIdx} color="green" style={{ margin: 0 }}>
                                                              {expr.key} {expr.operator} {Array.isArray(expr.values) ? expr.values.join(', ') : expr.values || ''}
                                                          </Tag>
                                                      ))}
                                                  </div>
                                              ))}
                                          </div>
                                      );
                                  })()}
                              </Descriptions.Item>
                          </Descriptions>
                      </Card>
                  </div>

                  {/*
                    ========================================
                    4.5 其他选项
                    ========================================
                    展示 Guest Agent、Cloud-Init、SSH Keys、运行策略、固件/TPM 等配置项，便于排查实例行为差异。
                  */}
                  <div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                          <span style={{ color: '#666' }}>其他选项</span>
                      </div>
                      <Card variant="borderless" styles={{ body: { padding: '16px 24px' } }}>
                          <Descriptions column={1} size="small" styles={{ label: { width: 120, color: '#999' } }}>
                              <Descriptions.Item label="Guest Agent">
                                  {vmData?.spec?.template?.spec?.domain?.devices?.inputs?.some((i: any) => i.type === 'tablet' && i.bus === 'usb') ? '已启用 (USB Tablet)' : '未启用'}
                              </Descriptions.Item>
                              <Descriptions.Item label="Cloud-Init">
                                  <div className="minimal-scroll" style={{ maxHeight: 200, overflow: 'auto', background: '#f5f5f5', padding: 8, borderRadius: 4, width: '100%' }}>
                                      <pre style={{ margin: 0, fontSize: 12, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                                          {vmData?.spec?.template?.spec?.volumes?.find((v: any) => v.cloudInitNoCloud || v.cloudInitConfigDrive)?.cloudInitNoCloud?.userData || 
                                           vmData?.spec?.template?.spec?.volumes?.find((v: any) => v.cloudInitNoCloud || v.cloudInitConfigDrive)?.cloudInitConfigDrive?.userData || 
                                           '未配置'}
                                      </pre>
                                  </div>
                              </Descriptions.Item>
                              <Descriptions.Item label="SSH Keys">
                                  {(() => {
                                      try {
                                          const sshNames = JSON.parse(vmData?.spec?.template?.metadata?.annotations?.['harvesterhci.io/sshNames'] || '[]');
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
                                  {vmData?.spec?.runStrategy || 'RerunOnFailure'}
                              </Descriptions.Item>
                              <Descriptions.Item label="固件/TPM">
                                  <Space direction="vertical" size={0}>
                                      <div>EFI: {vmData?.spec?.template?.spec?.domain?.firmware?.bootloader?.efi ? '启用' : '未启用'}</div>
                                      <div>Secure Boot: {vmData?.spec?.template?.spec?.domain?.firmware?.bootloader?.efi?.secureBoot ? '启用' : '未启用'}</div>
                                      <div>TPM: {vmData?.spec?.template?.spec?.domain?.devices?.tpm ? '启用' : '未启用'}</div>
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
                  namespace={SafeRead.namespace(vmData)} 
                  name={SafeRead.vmId(vmData)} 
              />
          )}

          {activeTab === 'diagnosis' && (
              <div style={{ padding: '0 0 24px' }}>
                 <HarvesterVmDiagnosisTab 
                    cloudId={cloudId} 
                    record={vmData} 
                    active={activeTab === 'diagnosis'} 
                 />
              </div>
          )}

          {activeTab === 'backup_snapshot' && (
            <div style={{ padding: '0 0 24px' }}>
              <HarvesterVmBackupTab 
                  cloudId={cloudId}
                  record={vmData}
                  backups={backups}
                  schedules={schedules}
                  backupsLoading={backupsLoading}
                  schedulesLoading={schedulesLoading}
                  onRefresh={(force, silent) => { 
                    const skipSync = silent || false;
                    fetchBackups(force, skipSync); 
                    fetchSchedules(force, skipSync); 
                  }}
                  namespaces={namespaces}
              />
            </div>
          )}
          
          {activeTab === 'events' && (
              <Card variant="borderless" styles={{ body: { padding: 0, height: '100%' } }} style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
                 <HarvesterEventsTab 
                    cloudId={cloudId} 
                    record={vmData} 
                    active={activeTab === 'events'} 
                    kind="VirtualMachine"
                 />
              </Card>
          )}
          {activeTab === 'logs' && (
              <Card 
                variant="borderless"
                styles={{ body: { padding: 0, height: '100%', display: 'flex', flexDirection: 'column' } }} 
                style={{ height: '100%', display: 'flex', flexDirection: 'column' }}
              >
                 <HarvesterVmLogsTab 
                    cloudId={cloudId} 
                    record={record} 
                    active={activeTab === 'logs'} 
                 />
              </Card>
          )}
      </div>
      {/*
        ========================================
        5. 弹窗组件
        ========================================
      */}
      <VmSaveAsTemplateModal
        open={showTemplateModal}
        onClose={() => setShowTemplateModal(false)}
        cloudId={cloudId}
        vmNamespace={SafeRead.namespace(vmData)}
        vmName={SafeRead.vmId(vmData)}
        vmDisplayName={SafeRead.name(vmData)}
        namespacesOptions={namespaces.map((n: any) => n?.metadata?.name || n)}
      />
    </Drawer>
  );
};

export default HarvesterVmDetailDrawer;
