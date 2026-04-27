/**
 * ==============================================================================
 * 模块名称: Harvester 定时备份策略列表 (ScheduleVmBackupsSection)
 * 文件路径: frontend/src/pages/cnmc/clouds/Harvester/cbr/sections/ScheduleVmBackupsSection.tsx
 * ==============================================================================
 * 
 * [功能描述]
 * 这个组件是“定时备份/快照”功能的列表展示页面。
 * 它就像一个“日程表”，列出了所有给虚拟机设定的自动备份计划。
 * 
 * [核心功能]
 * 1. 列表展示: 显示所有定时策略，包括名字、针对哪台虚拟机、备份频率(Cron表达式)等。
 * 2. 过滤搜索: 可以只看“备份”或“快照”，也可以搜索名字。
 * 3. 增删改查: 
 *    - 创建: 弹出一个对话框新建策略。
 *    - 修改: 修改备份频率或保留数量。
 *    - 停用/启用: 就像闹钟开关一样，暂时关闭策略但不删除。
 *    - 删除: 彻底移除策略。
 * 4. 租户适配:
 *    - 通过 showYaml 属性控制，如果是租户看，就隐藏复杂的 YAML/详情入口。
 * 
 * [关键逻辑 - 乐观更新 (Optimistic UI)]
 * Harvester 的 API 有时候反应比较慢（异步），比如点了“删除”，后端可能要过几秒才真正删掉。
 * 为了让用户感觉“秒删”，我们在界面上会先“假装”它已经删了（从列表中移除），
 * 然后在后台悄悄轮询后端，直到后端真的删掉了，或者出错了再滚回。
 * 
 * ==============================================================================
 */
import React, { useMemo, useState, useCallback } from 'react';
import { Table, Button, Input, Badge, Tooltip, Dropdown, message, Modal, Select } from 'antd';
import { ReloadOutlined, EllipsisOutlined, SearchOutlined, CalendarOutlined } from '@ant-design/icons';
import { formatCron } from '../../../../../../utils/cronFormatter';
import { isSystemNamespace } from '../../../../../../utils/harvesterUtils';
import { deleteHarvesterScheduleVmBackup, updateHarvesterScheduleVmBackup } from '../../../../../../services/harvesterApi';
import PageDetailSection from '../../../../../../components/PageDetailSection';
import TableColumnSettingsButton from '../../../../../../components/TableColumnSettingsButton';
import { useTableColumnSettings } from '../../../../../../hooks/useTableColumnSettings';
import HarvesterResourceDrawer from '../../shared/components/HarvesterOpsinfoDrawer';
import ScheduleVmBackupCreateModal from '../../cbr/modals/ScheduleVmBackupCreateModal';
import ScheduleVmBackupEditModal from '../../cbr/modals/ScheduleVmBackupEditModal';
import { useAuth } from '../../../../../../contexts/AuthContext';
import { hasPermissionForAction } from '../../../../../../utils/accessMapping';
import { useCloudmapOpsViewWrite } from '../../hooks/useCloudmapOpsViewWrite';

/**
 * [组件参数定义]
 * 定义了组件需要从外部接收哪些数据。
 */
interface Props {
  /** 当前云平台的唯一标识 ID，发请求时需要用到 */
  cloudId: string;
  
  /** 
   * 后端返回的原始策略列表数据 
   * 注意：这个数据可能不是最新的，因为后端可能有缓存
   */
  data: any[];
  
  /** 表格是否正在加载（显示转圈圈） */
  loading: boolean;
  
  /** 
   * 刷新数据的回调函数
   * @param force - 如果为 true，强制后端从 Harvester 重新拉取最新数据，不走缓存
   * @param silent - 如果为 true，静默刷新（创建后刷新），跳过全量同步，直接查询数据库
   */
  onRefresh?: (force?: boolean, silent?: boolean) => void;
  
  /** 
   * 虚拟机列表
   * 用途：策略里只存了虚拟机的名字（如 vm-123），我们需要这个列表来查出它的“别名”（如 Web服务器-01）
   */
  vms?: any[];
  
  /** 如果传了这个 ID，说明是在“虚拟机详情页”里用，只显示该虚拟机的策略 */
  vmId?: string;

  /** 仅展示目标 VM 满足此谓词的策略（与 vmId 同时存在时两者都需满足） */
  targetVmPredicate?: (namespace: string, vmName: string) => boolean;
  
  /** 默认隐藏哪些列 */
  defaultHiddenColumns?: string[];
  
  /** 是否显示表格边框（租户侧通常不需要边框） */
  bordered?: boolean;
  
  /** 
   * 租户模式：隐藏运维信息入口
   */
  isTenant?: boolean;
}

/**
 * [辅助函数] 计算“存活时间”
 * 把枯燥的时间戳（2023-10-01...）转换成“5 分钟前”、“3 天前”这种人话。
 */
const formatAge = (timestamp: string) => {
  if (!timestamp) return '-';
  const created = new Date(timestamp).getTime();
  const now = Date.now();
  const diff = now - created;
  
  if (diff < 0) return '0 分钟';

  const minutes = Math.floor(diff / 60000);
  if (minutes < 60) return `${minutes} 分钟`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时`;
  const days = Math.floor(hours / 24);
  return `${days} 天`;
};

const ScheduleVmBackupsSection: React.FC<Props> = ({ 
  cloudId, 
  data, 
  loading, 
  onRefresh, 
  vms, 
  vmId,
  targetVmPredicate,
  defaultHiddenColumns, 
  isTenant,
  bordered = true
}) => {
  const hasOpsView = useCloudmapOpsViewWrite();
  const { user } = useAuth();
  const perms = useMemo(() => (user?.permissions ?? []) as string[], [user?.permissions]);
  const hasBackupsWrite = useMemo(
    () => hasPermissionForAction(perms, 'clouds.backups:write') || hasPermissionForAction(perms, 'clouds:write'),
    [perms],
  );
  const ensureBackupsWrite = useCallback(() => {
    if (hasBackupsWrite) return true;
    message.error('当前账号没有备份操作权限（需要 clouds.backups:write 或 clouds:write 权限）');
    return false;
  }, [hasBackupsWrite]);

  // ==============================================================================
  // 1. 本地状态管理 (Local State)
  // ==============================================================================
  
  // 搜索框里的文字
  const [keyword, setKeyword] = useState<string>('');
  // 下拉框选中的类型（全部 / 备份 / 快照）
  const [typeFilter, setTypeFilter] = useState<string | undefined>(undefined);
  // 命名空间筛选
  const [namespaceFilter, setNamespaceFilter] = useState<string | undefined>(undefined);
  
  // 控制各种弹窗的显示/隐藏
  const [drawerVisible, setDrawerVisible] = useState(false); // 侧边详情抽屉
  const [createModalVisible, setCreateModalVisible] = useState(false); // 创建弹窗
  const [editModalVisible, setEditModalVisible] = useState(false); // 编辑弹窗
  
  // 当前正在操作的那一行数据（比如点击了某行的编辑，这里就存那一行的数据）
  const [currentRecord, setCurrentRecord] = useState<any>(null);
  
  // ==============================================================================
  // 2. 乐观更新状态 (Optimistic UI State)
  // 这里的状态是为了让界面“反应更快”，不等后端返回就先变。
  // ==============================================================================
  
  // [创建轮询]: 刚创建完策略，后端列表里可能还没刷出来，这个变量记下“我要找谁”
  const [pollingTarget, setPollingTarget] = useState<{ namespace: string; alias: string } | null>(null);
  // [临时列表]: 刚创建还没刷出来的项，先临时存在这，手动拼到表格里显示
  const [optimisticItems, setOptimisticItems] = useState<any[]>([]);
  
  // [删除列表]: 用户点了删除，后端还没删掉时，先把它记在这，表格渲染时过滤掉这些 ID
  const [removed, setRemoved] = useState<Array<{ ns: string; id?: string; alias?: string }>>([]);
  
  // [状态覆盖]: 用户点了停用/启用，后端还没变时，先用这个状态覆盖掉原来的状态
  const [suspendedOverrides, setSuspendedOverrides] = useState<Array<{ ns: string; id: string; suspended: boolean }>>([]);
  // [状态轮询]: 记下“我在等谁的状态变化”，轮询到了就停止
  const [suspendPollingTarget, setSuspendPollingTarget] = useState<{ ns: string; id: string; suspended: boolean } | null>(null);

  // ==============================================================================
  // 3. 副作用与轮询逻辑 (Effects)
  // ==============================================================================

  /**
   * [轮询逻辑 1] 检查新创建的项是否出现了
   * 场景：用户刚创建了一个策略，后端还没同步过来。
   * 逻辑：
   * 1. 每 3 秒刷新一次列表 (onRefresh(true))。
   * 2. 检查列表里有没有我们需要找的那个名字 (pollingTarget)。
   * 3. 如果找到了，或者试了 15 次还没找到，就停止轮询。
   */
  React.useEffect(() => {
    if (!pollingTarget) return;
    let tries = 0;
    const maxTries = 15;
    const tick = () => {
      // 在当前数据里找，看有没有我们要找的目标
      const exists = (data || []).some((x: any) => {
        const raw = x.rawData || x;
        const ns = raw.metadata?.namespace || x.namespace;
        const name = raw.metadata?.name || x.name;
        const alias = raw.metadata?.annotations?.['tower.io/alias'];
        return ns === pollingTarget.namespace && (name === pollingTarget.alias || alias === pollingTarget.alias);
      });

      if (exists || tries >= maxTries) {
        setPollingTarget(null); // 停止寻找
        if (exists) {
          // 如果真数据里已经有了，就把“临时伪造的数据”删掉，避免重复显示
          setOptimisticItems(prev => prev.filter(o => !(o.namespace === pollingTarget.namespace && o.name === pollingTarget.alias)));
        }
        return;
      }
      tries++;
      onRefresh?.(true); // 强制刷新
    };
    tick();
    const timer = setInterval(tick, 3000);
    return () => clearInterval(timer);
  }, [pollingTarget, data, onRefresh]);

  /**
   * [轮询逻辑 2] 检查停用/启用状态是否生效
   * 逻辑同上，只是检查的是 suspend 字段是否变成了我们预期的值。
   */
  React.useEffect(() => {
    if (!suspendPollingTarget) return;
    let tries = 0;
    const maxTries = 15;
    const tick = () => {
      const rec = (data || []).find((x: any) => {
         const raw = x.rawData || x;
         const ns = raw.metadata?.namespace || x.namespace;
         const id = raw.metadata?.name || x.name;
         return ns === suspendPollingTarget.ns && id === suspendPollingTarget.id;
      });
      
      if (rec) {
        const raw = rec.rawData || rec;
        const isSuspended = raw.spec?.suspend === true || rec.status === 'Suspended';
        // 如果状态已经变过来了
        if (isSuspended === suspendPollingTarget.suspended) {
             setSuspendPollingTarget(null);
             // 移除本地的临时覆盖，改用后端真实数据
             setSuspendedOverrides(prev => prev.filter(o => !(o.ns === suspendPollingTarget.ns && o.id === suspendPollingTarget.id)));
             return;
        }
      }

      if (tries >= maxTries) {
        setSuspendPollingTarget(null);
        return;
      }
      tries++;
      onRefresh?.(true);
    };
    tick();
    const timer = setInterval(tick, 3000);
    return () => clearInterval(timer);
  }, [suspendPollingTarget, data, onRefresh]);

  // ==============================================================================
  // 4. 交互处理函数 (Handlers)
  // ==============================================================================

  // 处理“停用/启用”点击
  const handleSuspend = useCallback(async (record: any) => {
    if (!ensureBackupsWrite()) return;
    try {
      const newSuspend = !record.suspended;
      // 发请求给后端
      await updateHarvesterScheduleVmBackup(cloudId, record.namespace, record.id, { suspend: newSuspend });
      message.success(`${newSuspend ? '停用' : '启用'}成功`);
      
      // [乐观更新]: 马上修改界面显示，不用等刷新
      setSuspendedOverrides(prev => {
        const rest = prev.filter(o => !(o.ns === record.namespace && o.id === record.id));
        return rest.concat({ ns: record.namespace, id: record.id, suspended: newSuspend });
      });
      // 开启轮询，等待后端确认
      setSuspendPollingTarget({ ns: record.namespace, id: record.id, suspended: newSuspend });
      
      onRefresh?.(true);
    } catch (e: any) {
      message.error(`操作失败: ${e.message}`);
    }
  }, [cloudId, onRefresh, ensureBackupsWrite]);

  // 处理“删除”点击
  const handleDelete = useCallback((record: any) => {
    if (!ensureBackupsWrite()) return;
    Modal.confirm({
      title: '确认删除',
      content: `确定要删除定时备份策略 ${record.name} (${record.id}) 吗？此操作不可恢复。`,
      okText: '删除',
      okType: 'danger',
      cancelText: '取消',
      onOk: async () => {
        try {
          await deleteHarvesterScheduleVmBackup(cloudId, record.namespace, record.id);
          message.success('删除成功');
          
          // [乐观更新]: 马上把它加入“已删除名单”，表格渲染时会把它过滤掉
          setRemoved(prev => prev.concat({ ns: record.namespace, id: record.id, alias: record.name }));
          // 如果它是刚才乐观创建的临时项，也删掉
          setOptimisticItems(prev => prev.filter(o => !(o.namespace === record.namespace && (o.name === record.name || o.id === record.id))));
          
          onRefresh?.(true);
        } catch (e: any) {
          message.error(`删除失败: ${e.message}`);
        }
      }
    });
  }, [cloudId, onRefresh, ensureBackupsWrite]);

  // ==============================================================================
  // 5. 数据处理与渲染准备 (Data Processing)
  // ==============================================================================

  /**
   * [数据源构造]
   * 这里做了三件事：
   * 1. 过滤掉系统自带的命名空间（我们只关心用户业务的）。
   * 2. 数据格式化：把后端复杂的嵌套对象，转成表格好读的扁平对象。
   * 3. 别名解析：把 vm-abc 这种 ID 换成 "Web服务器" 这种人名。
   * 4. 合并“真数据”和“乐观新增的数据”，并剔除“乐观删除的数据”。
   */
  const dataSource = useMemo(() => {
    const base = (data || [])
      .filter((b: any) => {
        const raw = b.rawData || b;
        const ns = raw.metadata?.namespace || b.namespace;
        // 过滤系统命名空间
        return !isSystemNamespace(ns);
      })
      .map((b: any) => {
      const raw = b.rawData || b;
      
      // 解析保留数量 (Retention)
      let retentionCount = '-';
      if (raw.spec?.retain !== undefined) {
        retentionCount = raw.spec.retain;
      } else if (b.retention) {
        retentionCount = b.retention;
      }

      // 解析名称和别名
      const id = raw.metadata?.name || b.name;
      const alias = raw.metadata?.annotations?.['tower.io/alias'];
      const displayName = alias || id;

      const ns = raw.metadata?.namespace || b.namespace;
      const vmNameRaw = raw.spec?.vmbackup?.source?.name || b.vmName || '';
      
      // [别名查找逻辑] 拿着 VM 的 ID 去 vms 列表里查它的中文名
      let vmAlias = vmNameRaw || '-';
      try {
        const vm = (vms || []).find((x: any) => {
          const vmNs = x?.metadata?.namespace || x?.namespace;
          const vmName = x?.metadata?.name || x?.name;
          return vmNs === ns && vmName === vmNameRaw;
        });
        if (vm) {
          vmAlias = vm?.metadata?.annotations?.['tower.io/alias'] || vm?.alias || (vm?.name || vm?.metadata?.name) || vmNameRaw || '-';
        }
      } catch {}

      // 判断是否停用：优先看我们的“乐观覆盖状态”，没有覆盖再看真实状态
      let isSuspended = raw.spec?.suspend === true || b.status === 'Suspended';
      const ov = suspendedOverrides.find(o => o.ns === ns && o.id === id);
      if (ov) isSuspended = ov.suspended;

      return {
        key: raw.metadata?.uid || b.id || `${ns}-${id}`,
        name: displayName,
        id: id,
        namespace: ns,
        vmAlias, // 显示给用户的 VM 名字
        vmName: vmNameRaw, // 原始 VM ID，用于过滤
        retention: retentionCount,
        maxFailure: raw.spec?.maxFailure || b.maxFailure || '-',
        type: raw.spec?.vmbackup?.type || 'backup', // backup 或 snapshot
        cron: raw.spec?.cron || b.cron || '-',
        suspended: isSuspended,
        creationTimestamp: raw.metadata?.creationTimestamp || b.createdAt,
        age: formatAge(raw.metadata?.creationTimestamp || b.createdAt),
        raw,
        links: b.links || {},
      };
    });

    // 过滤掉被标记为“已删除”的项
    const filteredBase = base.filter((x: any) => {
      return !removed.some(r => r.ns === x.namespace && ((r.id && r.id === x.id) || (r.alias && r.alias === x.name)));
    });

    // 合并“乐观新增”的项（如果真实数据里已经有了，就不重复加）
    const dedupedOptimistic = optimisticItems.filter((o: any) => {
      return !filteredBase.some((x: any) => x.namespace === o.namespace && x.name === o.name);
    });
    
    return filteredBase.concat(dedupedOptimistic);
  }, [data, vms, optimisticItems, removed, suspendedOverrides]);

  /**
   * [前端过滤]
   * 根据用户在工具栏输入的关键字、选择的类型，对表格数据进行二次筛选。
   */
  const filteredData = useMemo(() => {
    let d = dataSource;
    // 类型过滤 (备份 vs 快照)
    if (typeFilter && typeFilter !== 'all') {
      d = d.filter((x: any) => x.type === typeFilter);
    }
    if (namespaceFilter) {
      d = d.filter((x: any) => x.namespace === namespaceFilter);
    }
    // 关键字过滤 (名称 或 命名空间)
    if (keyword) {
      const k = keyword.toLowerCase();
      d = d.filter((x: any) => x.name.toLowerCase().includes(k) || x.namespace.toLowerCase().includes(k));
    }
    // 如果指定了 vmId，只看这个 VM 的
    if (vmId) {
      d = d.filter((x: any) => x.vmName === vmId);
    }
    if (targetVmPredicate) {
      d = d.filter(
        (x: any) => x.vmName && targetVmPredicate(x.namespace, x.vmName),
      );
    }
    return d;
  }, [dataSource, keyword, typeFilter, vmId, namespaceFilter, targetVmPredicate]);

  const namespaceOptions = useMemo(() => {
    const set = new Set<string>();
    dataSource.forEach((x: any) => {
      const ns = String(x?.namespace || '').trim();
      if (!ns) return;
      set.add(ns);
    });
    return Array.from(set).sort().map((v) => ({ value: v, label: v }));
  }, [dataSource]);

  /**
   * [表格列定义]
   * 定义表格每一列怎么显示。
   */
  const columns = useMemo(() => [
    { 
      title: '策略名称', 
      dataIndex: 'name', 
      key: 'name', 
      render: (t: string) => (
        <span style={{ display: 'flex', alignItems: 'center', gap: 6, maxWidth: '100%' }}>
          <CalendarOutlined style={{ color: '#1677ff', fontSize: 16, flexShrink: 0 }} />
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 }}>{t}</span>
        </span>
      )
    },
    {
      title: '策略 ID',
      dataIndex: 'id',
      key: 'id', 
      render: (t: string) => <span style={{ color: '#666', fontSize: 13 }}>{t}</span>
    },
    { title: '策略类型', dataIndex: 'type', key: 'type', render: (t: string) => (t === 'snapshot' ? '快照定时策略' : '备份定时策略') },

    { 
      title: '状态', 
      dataIndex: 'suspended', 
      key: 'suspended', 
      render: (suspended: boolean) => (
        <Badge status={!suspended ? 'success' : 'warning'} text={!suspended ? '活跃' : '暂停'} />
      )
    },
    { title: '命名空间', dataIndex: 'namespace', key: 'namespace' },
    { title: '源虚拟机', dataIndex: 'vmAlias', key: 'vmAlias' },
    { 
      title: '计划任务', 
      dataIndex: 'cron', 
      key: 'cron', 
      render: (cron: string) => {
        if (!cron || cron === '-') return '-';
        try {
          // 把 "0 2 * * *" 翻译成 "每天凌晨 2:00"
          const human = formatCron(cron);
          return (
            <Tooltip title={cron}>
              <span>{human}</span>
            </Tooltip>
          );
        } catch (e) {
          return cron;
        }
      }
    },
    { title: '保存数量', dataIndex: 'retention', key: 'retention' },
    { title: '最大故障数', dataIndex: 'maxFailure', key: 'maxFailure' },
    { title: '存活时间', dataIndex: 'age', key: 'age' },
    { 
      title: '操作', 
      key: 'action', 
      width: 80,
      align: 'left' as const,
      fixed: 'right' as const,
      render: (_: any, r: any) => {
         const items: any[] = [];
         
         // [租户适配] 只有管理员才显示“查看详情”
         if (!isTenant && hasOpsView) {
           items.push({
             key: 'opsinfo',
             label: '查看YAML',
             onClick: () => { setCurrentRecord(r.raw); setDrawerVisible(true); }
           });
         }
         
         // 通用操作
         items.push({
           key: 'edit',
           label: '策略修改',
           disabled: !hasBackupsWrite,
           onClick: () => { setCurrentRecord(r); setEditModalVisible(true); }
         });
         items.push({
           key: 'suspend',
           label: r.suspended ? '启用' : '停用',
           disabled: !hasBackupsWrite,
           onClick: () => handleSuspend(r)
         });
         items.push({
           type: 'divider',
           key: 'divider-1',
         });
         items.push({
           key: 'delete',
           label: '删除',
           danger: true,
           disabled: !hasBackupsWrite,
           onClick: () => handleDelete(r)
         });

         return (
         <Dropdown 
           menu={{ items }} 
           trigger={['click']}
         >
           <Button icon={<EllipsisOutlined />} className="row-actions-trigger" type="text" />
         </Dropdown>
      );
      }
    }
  ], [handleDelete, handleSuspend, isTenant, hasOpsView, hasBackupsWrite]);

  // 用户自定义的列显示设置（需要在 columns 定义之后）
  const { displayColumns: visibleColumns } = useTableColumnSettings(columns, 'harvester_schedule_backups_list', defaultHiddenColumns);

  return (
    <>
      <PageDetailSection
        asCard={false}
        // 左侧工具栏：搜索框 + 类型筛选
        toolbarLeft={(
          <>
            <Input
              key="schedule-search"
              className="toolbar-search"
              placeholder="名称/ID"
              suffix={<SearchOutlined style={{ color: 'rgba(0,0,0,.45)' }} />}
              value={keyword}
              onChange={e => setKeyword(e.target.value)}
              allowClear
            />
            {hasOpsView && (
              <Select
                key="schedule-namespace-filter"
                className="toolbar-filter-sm"
                allowClear
                showSearch
                placeholder="命名空间"
                value={namespaceFilter}
                onChange={setNamespaceFilter}
                options={namespaceOptions}
              />
            )}
            <Select
              key="schedule-type-filter"
              className="toolbar-filter-sm"
              allowClear
              placeholder="选择类型"
              value={typeFilter}
              onChange={setTypeFilter}
              options={[
                { label: '全部类型', value: 'all' },
                { label: '备份定时策略', value: 'backup' },
                { label: '快照定时策略', value: 'snapshot' },
              ]}
            />
            <button
              type="button"
              className="toolbar-reset-btn"
              onClick={() => {
                setKeyword('');
                setTypeFilter(undefined);
                setNamespaceFilter(undefined);
              }}
            >
              重置
            </button>
          </>
        )}
        // 右侧工具栏：创建按钮 + 列设置 + 刷新
        toolbarRight={(
           <div className="toolbar-actions">
             <Button key="create-btn" type="primary" disabled={!hasBackupsWrite} onClick={() => { if (!ensureBackupsWrite()) return; setCreateModalVisible(true); }}>创建定时策略</Button>
             <TableColumnSettingsButton
               key="col-settings"
               allColumns={columns}
               settingsKey="harvester_schedule_backups_list"
               defaultHiddenColumns={defaultHiddenColumns}
             />
             <Button key="refresh-btn" icon={<ReloadOutlined />} onClick={() => onRefresh?.(true)} loading={loading} />
           </div>
        )}
      >
        <Table
        key="table"
        className="std-table"
        bordered={false}
        dataSource={filteredData}
        columns={visibleColumns || columns}
        rowKey={(record: any) => record.key || record.id || `${record.namespace}-${record.name}`}
        loading={loading}
        pagination={{
          size: 'small',
          showTotal: (total) => `共 ${total} 条`,
        }}
      />
      </PageDetailSection>

      {/* 侧边详情抽屉 */}
      <HarvesterResourceDrawer
        open={drawerVisible}
        onClose={() => setDrawerVisible(false)}
        resourceType="ScheduleVmBackup"
        record={currentRecord}
        cloudId={cloudId}
      />

      {/* 创建弹窗 */}
      <ScheduleVmBackupCreateModal
        open={createModalVisible}
        cloudId={cloudId}
        onCancel={() => setCreateModalVisible(false)}
        onSuccess={(created) => {
        setCreateModalVisible(false);
        if (created) {
          // 设置轮询目标，等待后端创建完成
          setPollingTarget(created);
          
          // [乐观创建] 立即在列表里造一个假数据，让用户觉得"秒创建"
          const vm = (vms || []).find((x: any) => {
            const vmNs = x?.metadata?.namespace || x?.namespace;
            const vmName = x?.metadata?.name || x?.name;
            return vmNs === created.namespace && vmName === created.vmName;
          });
          const vmAlias = vm?.metadata?.annotations?.['tower.io/alias'] || vm?.alias || (vm?.name || vm?.metadata?.name) || created.vmName || '-';
          const now = new Date().toISOString();
          // 使用从创建结果中获取的K8s资源名称，如果没有则使用'-'作为占位符
          const resourceName = created.resourceName || '-';
          const optimistic = {
            key: `opt-${Date.now()}`,
            name: created.alias,
            id: resourceName, // 使用真实的K8s资源名称
            namespace: created.namespace,
            vmAlias,
            vmName: created.vmName,
            retention: created.retain,
            maxFailure: created.maxFailure,
            type: created.type,
            cron: created.cron,
            suspended: created.suspend,
            creationTimestamp: now,
            age: '0 分钟',
            // raw 是部分数据，包含真实的K8s资源名称
            raw: {
               metadata: { 
                 namespace: created.namespace, 
                 name: resourceName, // 使用真实的K8s资源名称
                 annotations: { 'tower.io/alias': created.alias } 
               },
               spec: { suspend: created.suspend, cron: created.cron, retain: created.retain }
            }
          };
          setOptimisticItems(prev => prev.concat(optimistic));
        }
        // 刷新数据列表（创建后已直接入库，使用 force=true 跳过前端缓存，但后端会优先查询数据库）
        // 静默刷新，不显示提示信息
        onRefresh?.(true, true); // force=true, silent=true
      }}
      />

      {/* 编辑弹窗 */}
      <ScheduleVmBackupEditModal
        open={editModalVisible}
        cloudId={cloudId}
        record={currentRecord}
        onCancel={() => setEditModalVisible(false)}
        onSuccess={() => {
          setEditModalVisible(false);
          onRefresh?.(true);
        }}
      />
    </>
  );
};

export default ScheduleVmBackupsSection;
