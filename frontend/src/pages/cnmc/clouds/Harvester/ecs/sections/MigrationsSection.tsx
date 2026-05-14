/**
 * Harvester - 虚拟机迁移记录列表 Section
 * 展示通过 Harvester/KubeVirt 发起的虚拟机实时迁移任务，
 * 支持：
 * - 自动/手动刷新
 * - 按关键字过滤任务 ID 与虚拟机名称
 * - 查看迁移对象的 HarvesterResourceDrawer 详情
 * - 针对运行中迁移任务执行“取消”操作（需要写权限）
 */
import React, { useMemo, useState, useEffect } from 'react';
import { Table, Badge, Input, Button, Select, message, Space, Popconfirm } from 'antd';
import { ReloadOutlined, SearchOutlined, CloudServerOutlined, ClockCircleTwoTone } from '@ant-design/icons';
import PageDetailSection from '../../../../../../components/PageDetailSection';
import { 
  fetchHarvesterMigrations, 
  fetchHarvesterMigrationsDirect, 
  abortHarvesterMigration
} from '../../../../../../services/harvesterApi';
import { useAuth } from '../../../../../../contexts/AuthContext';
import { hasPermissionForAction } from '../../../../../../utils/accessMapping';
import HarvesterResourceDrawer from '../../shared/components/HarvesterOpsinfoDrawer';
import dayjs from 'dayjs';
import TableColumnSettingsButton from '../../../../../../components/TableColumnSettingsButton';
import { useTableColumnSettings } from '../../../../../../hooks/useTableColumnSettings';
import { isSystemNamespace } from '../../../../../../utils/harvesterUtils';
import type { ColumnsType } from 'antd/es/table';
import { useCloudmapOpsViewWrite } from '../../hooks/useCloudmapOpsViewWrite';

/**
 * SafeMig: 统一处理迁移对象的字段读取，兼容多种数据结构
 * - 后端可能直接返回 KubeVirt 对象，也可能经过中间层结构化
 * - 这里封装常用字段：phase、vmName、节点、命名空间、创建时间、任务 ID 等
 */
const SafeMig = {
  base: (r: any) => r?.rawData ? r.rawData : r,
  phase: (r: any) => {
    const x = SafeMig.base(r);
    return x?.status?.phase || r?.phase || x?.Phase || 'Unknown';
  },
  vmName: (r: any) => {
    const x = SafeMig.base(r);
    return x?.spec?.vmiName || r?.vmiName || x?.VmiName || x?.spec?.vmi || r?.vmName || '-';
  },
  vmDisplayName: (r: any) => {
    const x = SafeMig.base(r);
    const alias = x?.metadata?.annotations?.['tower.io/alias'] || r?.alias || '';
    const name = SafeMig.vmName(r);
    return alias || name || '-';
  },
  sourceNode: (r: any) => {
    const x = SafeMig.base(r);
    return x?.status?.migrationState?.sourceNode || r?.sourceNode || x?.SourceNode || '-';
  },
  targetNode: (r: any) => {
    const x = SafeMig.base(r);
    return x?.status?.migrationState?.targetNode || r?.targetNode || x?.TargetNode || '自动调度';
  },
  namespace: (r: any) => {
    const x = SafeMig.base(r);
    return x?.metadata?.namespace || r?.namespace || x?.Namespace || '-';
  },
  createdAt: (r: any) => {
    const x = SafeMig.base(r);
    return x?.metadata?.creationTimestamp || r?.createdAt || x?.CreationTimestamp || '';
  },
  uidOrKey: (r: any) => {
    const x = SafeMig.base(r);
    return x?.metadata?.uid || x?.metadata?.name || `${SafeMig.namespace(r)}/${SafeMig.vmName(r)}`;
  },
  taskId: (r: any) => {
    const x = SafeMig.base(r);
    return x?.metadata?.name || r?.name || x?.Name || x?.metadata?.uid || r?.uid || '-';
  }
};

/**
 * 组件入参说明
 * - cloudId: 当前云 ID，用于调用迁移相关 API
 * - onRefresh: 外层可选回调，在列表手动刷新时一并触发
 * - vms: 虚拟机列表，用于查找别名（参考备份页面实现方式）
 */
interface Props {
  cloudId: string;
  onRefresh?: (force?: boolean) => void;
  vms?: any[];
}

const MigrationsSection: React.FC<Props> = ({ cloudId, onRefresh, vms }) => {
  const hasOpsView = useCloudmapOpsViewWrite();
  // 加载状态与数据源
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<any[]>([]);
  // 关键字过滤
  const [keyword, setKeyword] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [namespaceFilter, setNamespaceFilter] = useState('');
  // 当前登录用户，用于权限判断
  const { user } = useAuth();
  // 详情抽屉状态
  const [detailVisible, setDetailVisible] = useState(false);
  const [detailRecord, setDetailRecord] = useState<any>(null);
  const [detailActiveTab, setDetailActiveTab] = useState('detail');

  /**
   * 获取虚拟机显示名称（参考备份页面实现方式）
   * 优先从 vms 列表中查找别名，其次从记录本身获取，最后使用 vmName
   */
  const getVmDisplayName = (r: any): string => {
    const x = SafeMig.base(r);
    const ns = x?.metadata?.namespace || r?.namespace;
    const vmName = SafeMig.vmName(r);
    
    // [参考备份页面的别名查找逻辑] 拿着 VM 的 ID 去 vms 列表里查它的别名
    if (ns && vmName && vms && vms.length > 0) {
      try {
        const vm = vms.find((vmItem: any) => {
          const vmNs = vmItem?.metadata?.namespace || vmItem?.namespace;
          const vmItemName = vmItem?.metadata?.name || vmItem?.name;
          return vmNs === ns && vmItemName === vmName;
        });
        if (vm) {
          return vm?.metadata?.annotations?.['tower.io/alias'] || 
                 vm?.alias || 
                 (vm?.name || vm?.metadata?.name) || 
                 vmName || '-';
        }
      } catch {}
    }
    
    // 其次从迁移记录本身的 annotations 获取
    const alias = x?.metadata?.annotations?.['tower.io/alias'] || r?.alias || '';
    if (alias) {
      return alias;
    }
    
    // 最后使用 vmName
    return vmName || '-';
  };

  /**
   * 从后端加载迁移记录
   * - 优先调用通过平台封装的接口
   * - 若无数据则尝试直接透传调用 Harvester API 作为兜底
   * - 虚拟机名称通过 vms prop 获取（参考备份页面实现方式）
   */
  const loadData = async (force = false) => {
    setLoading(true);
    try {
      const res = await fetchHarvesterMigrations(cloudId, force);
      let list = res?.data?.items || [];
      if (!Array.isArray(list) || list.length === 0) {
        try {
          const direct = await fetchHarvesterMigrationsDirect(cloudId, force);
          list = direct?.data?.items || direct?.items || [];
        } catch (e) {
          // ignore direct fallback error
        }
      }
      setData(list);
    } catch (e: any) {
      message.error(e.message || '加载迁移记录失败');
    } finally {
      setLoading(false);
    }
  };

  // 当 cloudId 变化时自动加载一次数据（强制刷新以确保获取最新数据）
  useEffect(() => {
    loadData(true); // 首次加载时强制刷新，避免显示旧数据
  }, [cloudId]);

  /**
   * 打开 HarvesterResourceDrawer 展示迁移对象及其关联事件
   * - 自动拼接 view 链接以便 EventsTab 使用
   */
  const handleOpenDrawer = (record: any, tab: string = 'detail') => {
    const ns = record?.metadata?.namespace;
    const name = record?.metadata?.name;
    const view = (ns && name) ? `/apis/kubevirt.io/v1/namespaces/${encodeURIComponent(ns)}/virtualmachineinstancemigrations/${encodeURIComponent(name)}` : undefined;
    const r = { 
      ...record, 
      kind: 'VirtualMachineInstanceMigration',
      links: { ...(record?.links || {}), ...(view ? { view } : {}) }
    };
    setDetailRecord(r);
    setDetailActiveTab(tab);
    setDetailVisible(true);
  };

  /**
   * 手动刷新列表，同时触发上层 onRefresh 回调
   */
  const handleRefresh = () => {
    loadData(true);
    if (onRefresh) onRefresh(true);
  };

  /**
   * 取消正在运行的迁移任务
   * - 根据 migration 对象中的 namespace + spec.vmiName 拼接 instanceId
   */
  const handleAbort = async (record: any) => {
    try {
        // Namespace/Name for migration object, but API might need VM name
        // Our backend API `abort-migration` takes `instanceId` which is `namespace/vmName`.
        // The migration object has `spec.vmiName`.
        const vmName = record.spec?.vmiName;
        const namespace = record.metadata?.namespace;
        if (!vmName || !namespace) {
            message.error('无法解析关联的虚拟机信息');
            return;
        }
        await abortHarvesterMigration(cloudId, `${namespace}/${vmName}`);
        message.success('已发送取消请求');
        handleRefresh();
    } catch (e: any) {
        message.error(e.message || '取消失败');
    }
  };

  /**
   * 迁移状态翻译
   * KubeVirt VirtualMachineInstanceMigration 的状态包括：
   * - Pending: 等待调度
   * - Scheduling: 正在调度
   * - Scheduled: 已调度
   * - Preparing: 准备中
   * - Running: 迁移中
   * - Succeeded: 迁移成功
   * - Failed: 迁移失败
   * - Unknown: 未知状态
   */
  const translatePhase = (phase: string): string => {
    const phaseMap: Record<string, string> = {
      'Pending': '等待中',
      'Scheduling': '调度中',
      'Scheduled': '已调度',
      'Preparing': '准备中',
      'Running': '迁移中',
      'Succeeded': '成功',
      'Failed': '失败',
      'Unknown': '未知'
    };
    return phaseMap[phase] || phase;
  };

  /**
   * 关键字过滤
   * - 匹配迁移任务名称、关联虚拟机名称、虚拟机显示名称（别名）
   */
  const filteredData = useMemo(() => {
    const k = keyword.trim().toLowerCase();
    const filtered = data.filter((item: any) => {
      const ns = String(SafeMig.namespace(item) || '');
      const phase = String(SafeMig.phase(item) || '');
      if (namespaceFilter && ns !== namespaceFilter) return false;
      if (statusFilter && phase !== statusFilter) return false;
      if (!k) return true;
      // 使用 SafeMig.taskId 获取任务ID，兼容多种数据结构
      const taskId = String(SafeMig.taskId(item) || '').toLowerCase();
      const vmName = String(SafeMig.vmName(item) || '').toLowerCase();
      // 同时匹配虚拟机的显示名称（别名）
      const vmDisplayName = String(getVmDisplayName(item) || '').toLowerCase();
      return taskId.includes(k) || vmName.includes(k) || vmDisplayName.includes(k);
    });
    // 按创建时间倒序排列
    return filtered.sort((a, b) => {
      const timeA = SafeMig.createdAt(a);
      const timeB = SafeMig.createdAt(b);
      if (!timeA && !timeB) return 0;
      if (!timeA) return 1;
      if (!timeB) return -1;
      return dayjs(timeB).valueOf() - dayjs(timeA).valueOf();
    });
  }, [data, keyword, statusFilter, namespaceFilter, vms]);

  const statusOptions = useMemo(
    () => Array.from(new Set(data.map((item: any) => String(SafeMig.phase(item) || '').trim()).filter(Boolean))).sort().map(phase => ({
      value: phase,
      label: translatePhase(phase)
    })),
    [data]
  );
  const namespaceOptions = useMemo(
    () => Array.from(new Set(data.map((item: any) => String(SafeMig.namespace(item) || '').trim()).filter((ns) => ns && !isSystemNamespace(ns)))).sort(),
    [data]
  );

  /**
   * 表格列定义
   * - 状态列根据 Phase 渲染不同颜色的 Badge
   * - 操作列在任务运行中且用户有写权限时提供“取消”按钮
   */
  const allColumns: ColumnsType<any> = useMemo(() => [
    {
      title: '任务ID',
      key: 'taskId',
      render: (_: any, r: any) => {
        const text = SafeMig.taskId(r);
        return (
          <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <ClockCircleTwoTone twoToneColor={['#1890ff', '#91caff']} style={{ fontSize: 16, flexShrink: 0 }} />
            <span style={{ wordBreak: 'break-all' }}>{text}</span>
          </span>
        );
      },
    },
    {
      title: '状态',
      key: 'status',
      render: (_: any, r: any) => {
        const phase = SafeMig.phase(r);
        const isRunning = phase === 'Running' || phase === 'Scheduled' || phase === 'Scheduling' || phase === 'Preparing';
        let status: 'success' | 'error' | 'processing' | 'default' | 'warning' = 'default';
        if (phase === 'Succeeded') status = 'success';
        else if (phase === 'Failed') status = 'error';
        else if (isRunning) status = 'processing';
        return <Badge status={status} text={translatePhase(phase)} />;
      }
    },
    {
      title: '虚拟机',
      key: 'vmName',
      render: (_: any, r: any) => {
        const displayName = getVmDisplayName(r);
        return (
          <span style={{ display: 'flex', alignItems: 'center', gap: 6, maxWidth: '100%' }}>
            <CloudServerOutlined style={{ color: '#1677ff', fontSize: 16, flexShrink: 0 }} />
            <span
              className="cell-link"
              style={{ overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0, fontWeight: 600 }}
              onClick={() => handleOpenDrawer(r, 'detail')}
            >
              {displayName}
            </span>
          </span>
        );
      },
    },
    {
      title: '源节点',
      key: 'sourceNode',
      render: (_: any, r: any) => SafeMig.sourceNode(r)
    },
    {
      title: '目标节点',
      key: 'targetNode',
      render: (_: any, r: any) => SafeMig.targetNode(r)
    },
    ...(hasOpsView ? [{
      title: '命名空间',
      key: 'namespace',
      render: (_: any, r: any) => SafeMig.namespace(r)
    }] : []),
    {
      title: '创建时间',
      key: 'createdAt',
      className: 'std-time',
      render: (_: any, r: any) => {
        const t = SafeMig.createdAt(r);
        return t ? dayjs(t).format('YYYY-MM-DD HH:mm:ss') : '-';
      }
    },
    {
      title: '操作',
      key: 'actions',
      render: (_: any, r: any) => {
        const phase = r.status?.phase;
        const isRunning = phase === 'Running' || phase === 'Scheduled' || phase === 'Scheduling' || phase === 'Preparing';
        
        const actions: React.ReactNode[] = [];
        actions.push(<Button type="link" size="small" onClick={() => handleOpenDrawer(r, 'detail')}>详情</Button>);
        const canWrite =
          hasPermissionForAction(user?.permissions || [], 'clouds.migrations:write') ||
          hasPermissionForAction(user?.permissions || [], 'clouds.ecs:write') ||
          hasPermissionForAction(user?.permissions || [], 'clouds:write');
        if (isRunning && canWrite) {
          actions.push(
            <Popconfirm title="确定要取消此迁移任务吗？" onConfirm={() => handleAbort(r)}>
              <Button type="link" danger size="small">取消</Button>
            </Popconfirm>
          );
        }
        return <Space size="small">{actions}</Space>;
      }
    }
  ], [user, hasOpsView]);
  // 列显示设置（需要在 allColumns 定义之后）
  const { displayColumns: tableColumns } = useTableColumnSettings(allColumns, 'harvester_migrations_table');

  return (
    <PageDetailSection
      title="迁移记录"
      toolbarLeft={(
        <>
          <Input 
            allowClear
            placeholder="任务ID/虚拟机"
            suffix={<SearchOutlined style={{ color: 'rgba(0,0,0,.45)' }} />}
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            className="toolbar-search"
          />
          {hasOpsView && (
            <Select
              allowClear
              showSearch
              placeholder="命名空间"
              value={namespaceFilter || undefined}
              onChange={(v) => setNamespaceFilter(v || '')}
              className="toolbar-filter-sm"
              options={namespaceOptions.map((v) => ({ value: v, label: v }))}
            />
          )}
          <Select
            allowClear
            placeholder="状态"
            value={statusFilter || undefined}
            onChange={(v) => setStatusFilter(v || '')}
            className="toolbar-filter-sm"
            options={statusOptions}
          />
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
      )}
      toolbarRight={(
        <div className="toolbar-actions">
          <TableColumnSettingsButton allColumns={allColumns} settingsKey="harvester_migrations_table" />
          <Button icon={<ReloadOutlined />} onClick={handleRefresh} loading={loading} />
        </div>
      )}
    >
      <Table
        className="std-table"
        scroll={{ x: true }}
        bordered={false}
        rowKey={(r) => SafeMig.uidOrKey(r)}
        columns={tableColumns}
        dataSource={filteredData}
        loading={loading}
        pagination={{
          showTotal: (total) => `共 ${total} 条`,
        }}
      />
      <HarvesterResourceDrawer
        open={detailVisible}
        onClose={() => setDetailVisible(false)}
        resourceType="VirtualMachineInstanceMigration"
        record={detailRecord}
        activeTab={detailActiveTab}
        onTabChange={setDetailActiveTab}
        cloudId={cloudId}
      />
    </PageDetailSection>
  );
};

export default MigrationsSection;
