/**
 * ==============================================================================
 * 模块名称: Harvester 卷快照列表 (Harvester Volume Snapshot List)
 * 文件路径: src/pages/Clouds/Harvester/sections/SnapshotsSection.tsx
 * ==============================================================================
 * 
 * [功能描述]
 * 展示 Harvester 存储卷快照资源列表。
 * 提供快照的生命周期管理功能（删除、恢复数据卷）。
 * 支持灵活的 UI 配置（bordered, showYaml）以适应不同角色的视图需求（如租户侧隐藏 YAML）。
 * 
 * [核心逻辑]
 * 1. [数据标准化]: 
 *    - 将后端返回的 Kubernetes 原始 Manifest 解析为扁平化的表格数据。
 *    - 优先展示别名 (Annotation)，回退展示 Name。
 * 2. [前端过滤]: 
 *    - 支持按名称/命名空间/别名进行关键字搜索。
 *    - 支持按 Ready/NotReady 状态筛选。
 * 3. [视图控制]: 
 *    - 通过 `showYaml` 属性控制是否允许用户查看底层 YAML 和 Events（通常用于区分管理员/租户视角）。
 * 
 * ------------------------------------------------------------------------------
 * [交互/依赖说明]
 * ------------------------------------------------------------------------------
 * 1. 数据流向:
 *    [Parent] --(snapshots)--> [SnapshotsSection] --(dataSource)--> [Table]
 * 
 * 2. 关键交互:
 *    - [恢复]: 唤起 VolumeSnapshotRestoreModal。
 *    - [详情]: 唤起 HarvesterResourceDrawer (仅当 showYaml=true)。
 *    - [删除]: 调用 deleteHarvesterSnapshot API。
 * 
 * ==============================================================================
 */
import React, { useMemo, useState, useCallback } from 'react';
import { Table, Badge, Button, Modal, Input, message, Dropdown, Select, Checkbox } from 'antd';
import { ReloadOutlined, EllipsisOutlined, SearchOutlined, CameraOutlined } from '@ant-design/icons';
import PageDetailSection from '../../../../components/PageDetailSection';
import ResourceActionsDropdown from '../../../../components/ResourceActionsDropdown';
import { deleteHarvesterSnapshot } from '../../../../services/harvesterApi';
import VolumeSnapshotRestoreModal from '../modals/VolumeSnapshotRestoreModal';
import HarvesterResourceDrawer from '../components/HarvesterOpsinfoDrawer';
import { isSystemNamespace, isPublicNamespace } from '../../../../utils/harvesterUtils';
import TableColumnSettingsButton from '../../../../components/TableColumnSettingsButton';
import { useTableColumnSettings } from '../../../../hooks/useTableColumnSettings';
import { useAuth } from '../../../../contexts/AuthContext';
import { hasPermissionForAction } from '../../../../utils/accessMapping';

/**
 * 组件 Props 定义
 * @property cloudId - 当前云环境 ID，用于 API 调用
 * @property snapshots - 快照数据列表 (支持 rawData 嵌套结构或扁平结构)
 * @property loading - 表格加载状态
 * @property onRefresh - 刷新回调，force=true 表示强制从后端同步
 * @property bordered - 是否显示表格边框 (默认: true)。租户侧可能需要无边框样式。
 * @property showYaml - 是否显示 YAML/详情入口 (默认: true)。租户侧通常隐藏底层细节。
 * @property isTenant - 是否为租户模式 (租户模式下强制过滤系统和公共卷，且隐藏开关)
 * @property showSys - [已废弃，逻辑合并入 isTenant] 是否允许显示系统资源开关 (默认 true)
 */
interface Props {
  cloudId: string;
  snapshots: any[];
  loading: boolean;
  onRefresh?: (force?: boolean, silent?: boolean) => void;
  isTenant?: boolean;
  namespaces?: any[];
  bordered?: boolean;
}

const SnapshotsSection: React.FC<Props> = ({ 
  cloudId, 
  snapshots, 
  loading, 
  onRefresh,
  isTenant = false,
  namespaces = [],
  bordered = true
}) => {
  const { user } = useAuth();
  const perms = useMemo(() => (user?.permissions ?? []) as string[], [user?.permissions]);
  const hasSnapshotsWrite = useMemo(
    () => hasPermissionForAction(perms, 'clouds.snapshots:write') || hasPermissionForAction(perms, 'clouds:write'),
    [perms],
  );

  // ==============================================================================
  // 1. 状态定义 (State Definitions)
  // ==============================================================================
  
  // 系统资源显示控制
  const [showSystemResources, setShowSystemResources] = useState<boolean>(false);

  // 工具栏过滤与选择状态
  const [keyword, setKeyword] = useState<string>('');
  const [namespaceFilter, setNamespaceFilter] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([]);
  
  // 恢复弹窗状态
  const [restoreVisible, setRestoreVisible] = useState(false);
  const [restoreRecord, setRestoreRecord] = useState<any>(null);

  // 详情抽屉状态
  const [detailVisible, setDetailVisible] = useState(false);
  const [detailRecord, setDetailRecord] = useState<any>(null);
  const [detailActiveTab, setDetailActiveTab] = useState('detail');

  // 列设置状态

  // ==============================================================================
  // 2. 数据处理与过滤 (Data Processing)
  // ==============================================================================

  // [数据标准化] 将原始 K8s 对象转换为表格行数据
  // 1. 兼容 rawData 包装结构。
  // 2. 解析 metadata 中的 uid, name, namespace, creationTimestamp。
  // 3. 解析 spec 中的 source PVC 和 snapshotClassName。
  // 4. 解析 status 中的 readyToUse 状态。
  const dataSource = useMemo(() => {
    return (snapshots || []).map((s: any) => {
      const raw = s.rawData || s;
      return {
        key: raw.metadata?.uid || s.id,
        name: raw.metadata?.name || s.name,
        namespace: raw.metadata?.namespace || s.namespace,
        sourcePvc: raw.spec?.source?.persistentVolumeClaimName || raw.spec?.source?.name || s.sourcePvc || '-',
        snapshotClassName: raw.spec?.volumeSnapshotClassName || s.snapshotClassName || '-',
        readyToUse: raw.status?.readyToUse,
        restoreSize: raw.status?.restoreSize || s.restoreSize,
        creationTimestamp: raw.metadata?.creationTimestamp || s.createdAt,
        alias: raw.metadata?.annotations?.['tower.io/alias'] || '-',
        raw,
      };
    });
  }, [snapshots]);

  // [前端过滤] 多维度数据筛选
  // 这里的逻辑是为了支持客户端即时搜索，无需频繁请求后端。
  // 1. 关键字匹配：同时搜索 Name, Namespace 和 Alias。
  // 2. 状态匹配：根据 Ready/NotReady 进行精确筛选。
  // 3. 系统资源过滤：根据 isTenant 和 showSystemResources 决定是否显示系统资源。
  const filteredData = useMemo(() => {
    let d = dataSource;

    // [系统资源过滤]
    d = d.filter((r: any) => {
      const ns = r.namespace;
      // 1. 租户模式: 强制过滤系统命名空间和公共命名空间
      if (isTenant && (isSystemNamespace(ns) || isPublicNamespace(ns))) return false;
      // 2. 管理员模式: 仅在未勾选"显示系统资源"时过滤系统命名空间
      if (!isTenant && !showSystemResources && isSystemNamespace(ns)) return false;
      return true;
    });

    if (keyword) {
      const k = keyword.toLowerCase();
      d = d.filter((x: any) => 
        x.name.toLowerCase().includes(k) || 
        x.namespace.toLowerCase().includes(k) ||
        (x.alias && x.alias.toLowerCase().includes(k))
      );
    }
    if (namespaceFilter) {
      d = d.filter((x: any) => x.namespace === namespaceFilter);
    }
    if (statusFilter) {
      if (statusFilter === 'ready') {
        d = d.filter((x: any) => x.readyToUse);
      } else if (statusFilter === 'notReady') {
        d = d.filter((x: any) => !x.readyToUse);
      }
    }
    return d;
  }, [dataSource, keyword, statusFilter, isTenant, showSystemResources, namespaceFilter]);

  // ==============================================================================
  // 3. 交互处理 (Action Handlers)
  // ==============================================================================

  // [恢复] 打开数据卷恢复弹窗
  // 将当前选中的快照记录传递给 Modal，用于后续的 PVC 恢复操作。
  const handleRestore = useCallback((record: any) => {
    if (!hasSnapshotsWrite) {
      message.error('无权限执行该操作');
      return;
    }
    setRestoreRecord(record);
    setRestoreVisible(true);
  }, [hasSnapshotsWrite]);

  // [详情] 打开资源详情抽屉 (HarvesterResourceDrawer)
  // 1. 注入 Kind: 确保 EventsTab 能正确查询 VolumeSnapshot 的事件。
  // 2. 注入 View Link: 构造 K8s API 路径，用于“实时数据”页签展示 Raw YAML。
  const handleOpenDrawer = useCallback((record: any, tab: string = 'detail') => {
    const raw = record.raw || record;
    // Inject kind for EventsTab
    if (!raw.kind) raw.kind = 'VolumeSnapshot';
    
    // Inject view link if missing
    if (!raw.links) raw.links = {};
    if (!raw.links.view) {
        const ns = raw.metadata?.namespace || raw.namespace;
        const name = raw.metadata?.name || raw.name;
        if (ns && name) {
            raw.links.view = `/apis/snapshot.storage.k8s.io/v1/namespaces/${ns}/volumesnapshots/${name}`;
        }
    }
    
    setDetailRecord(raw);
    setDetailActiveTab(tab);
    setDetailVisible(true);
  }, []);

  // [删除] 删除单个快照
  // 这是一个破坏性操作，必须弹出确认框。
  // 成功后触发 onRefresh(true) 强制刷新列表。
  const handleDelete = useCallback((record: any) => {
    if (!hasSnapshotsWrite) {
      message.error('无权限执行该操作');
      return;
    }
    Modal.confirm({
      title: '确认删除',
      content: `确定要删除快照 ${record.alias !== '-' ? record.alias : record.name} (${record.name}) 吗？`,
      okText: '删除',
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          await deleteHarvesterSnapshot(cloudId, record.namespace, record.name);
          message.success('删除成功');
          onRefresh?.(true);
        } catch (e: any) {
          message.error(e.message || '删除失败');
        }
      }
    });
  }, [cloudId, onRefresh, hasSnapshotsWrite]);

  // [批量删除] 处理多选删除逻辑
  // 1. 过滤出选中的数据对象。
  // 2. 使用 Promise.allSettled 并发执行删除请求，而不是串行阻塞。
  // 3. 汇总成功/失败结果并提示用户。
  const handleBatchDelete = () => {
    if (!hasSnapshotsWrite) {
      message.error('无权限执行该操作');
      return;
    }
    if (selectedRowKeys.length === 0) return;
    const targets = dataSource.filter(s => selectedRowKeys.includes(s.key));
    
    Modal.confirm({
      title: '批量删除确认',
      content: `即将删除 ${targets.length} 个快照：${targets.map(t => t.alias !== '-' ? t.alias : t.name).join(', ')}`,
      okText: '删除',
      cancelText: '取消',
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          const results = await Promise.allSettled(targets.map(t => deleteHarvesterSnapshot(cloudId, t.namespace, t.name)));
          const ok = results.filter(x => x.status === 'fulfilled').length;
          const fail = results.length - ok;
          
          if (ok > 0) message.success(`成功删除 ${ok} 个快照`);
          if (fail > 0) message.error(`${fail} 个快照删除失败`);
          
          setSelectedRowKeys([]);
          onRefresh?.(true);
        } catch (e: any) {
          message.error(e.message || '批量删除失败');
        }
      }
    });
  };

  // ==============================================================================
  // 4. 表格列定义 (Columns)
  // ==============================================================================

  // [UI 渲染] 动态列配置
  // 根据 showYaml 属性决定：
  // 1. 名称列是否可点击查看详情。
  // 2. 操作列菜单中是否包含“查看 YAML”选项。
  const columns = useMemo(() => [
    { 
      title: '快照名称', 
      dataIndex: 'alias', 
      key: 'alias', 
      render: (_: any, r: any) => (
        <span style={{ display: 'flex', alignItems: 'center', gap: 6, maxWidth: '100%' }}>
          <CameraOutlined style={{ color: '#1677ff', fontSize: 16, flexShrink: 0 }} />
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 }}>
            {r.alias !== '-' ? r.alias : r.name}
          </span>
        </span>
      )
    },
    { title: '快照ID', dataIndex: 'name', key: 'name' },
    { title: '命名空间', dataIndex: 'namespace', key: 'namespace' },
    { title: '源PVC', dataIndex: 'sourcePvc', key: 'sourcePvc'  },
    { title: '快照类', dataIndex: 'snapshotClassName', key: 'snapshotClassName' },
    { 
      title: '状态', 
      dataIndex: 'readyToUse', 
      key: 'readyToUse', 
      render: (ready: boolean) => (
        <Badge status={ready ? 'success' : 'warning'} text={ready ? '就绪' : '未就绪'} />
      )
    },
    { title: '大小', dataIndex: 'restoreSize', key: 'restoreSize' },
    { 
      title: '创建时间', 
      dataIndex: 'creationTimestamp', 
      key: 'creationTimestamp', 
      render: (t: string) => <span className="std-time">{t}</span>
    },
    {
      title: '操作',
      key: 'action',
      width: 80,
      align: 'left' as const,
      fixed: 'right' as const,
      render: (_: any, record: any) => {
        const items: any[] = [];
        if (!isTenant) {
          items.push({ key: 'detail', label: '运维信息', onClick: () => handleOpenDrawer(record, 'detail') });
          items.push({ type: 'divider' as const });
        }
        items.push({ key: 'restore', label: '恢复', onClick: () => handleRestore(record), disabled: !record.readyToUse || !hasSnapshotsWrite });
        items.push({ key: 'delete', label: '删除', danger: true, onClick: () => handleDelete(record), disabled: !hasSnapshotsWrite });
        
        return (
          <ResourceActionsDropdown 
            items={items}
            buttonProps={{ className: 'row-actions-trigger' }}
          />
        );
      },
    },
  ], [isTenant, handleOpenDrawer, handleRestore, handleDelete, hasSnapshotsWrite]);

  // 列显示设置（需要在 columns 定义之后）
  const { displayColumns: visibleColumns } = useTableColumnSettings(columns, 'harvester_volume_snapshots_list');

  // ==============================================================================
  // 5. 渲染视图 (Render)
  // ==============================================================================

  return (
    <PageDetailSection
      asCard={false}
      toolbarLeft={(
        <>
          <Input
            placeholder="名称/ID"
            className="toolbar-search"
            suffix={<SearchOutlined style={{ color: 'rgba(0,0,0,.45)' }} />}
            allowClear
            value={keyword}
            onChange={e => setKeyword(e.target.value)}
          />
          {!isTenant && (
            <Select
              allowClear
              showSearch
              placeholder="命名空间"
              className="toolbar-filter-sm"
              value={namespaceFilter || undefined}
              onChange={(v) => setNamespaceFilter(v || '')}
              options={[
                  { value: '', label: '全部' },
                  ...namespaces.filter((x: any) => {
                    const n = x.metadata?.name || x.name || '';
                    if (!showSystemResources && isSystemNamespace(n)) return false;
                    return true;
                  }).map((x: any) => {
                    const n = x.metadata?.name || x.name || '';
                    return { value: n, label: n };
                  }).filter((x: any) => x.value)
                ]}
            />
          )}
          <Select
            allowClear
            placeholder="状态"
            className="toolbar-filter-sm"
            value={statusFilter || undefined}
            onChange={(v) => setStatusFilter(v || '')}
            options={[
              { value: '', label: '全部' },
              { value: 'ready', label: '就绪' },
              { value: 'notReady', label: '未就绪' }
            ]}
          />
          {!isTenant && (
            <div style={{ display: 'flex', alignItems: 'center', marginLeft: 8 }}>
              <Checkbox 
                checked={showSystemResources} 
                onChange={(e: any) => setShowSystemResources(e.target.checked)}
              >
                显示系统资源
              </Checkbox>
            </div>
          )}
          <button
            type="button"
            className="toolbar-reset-btn"
            onClick={() => {
              setKeyword('');
              setNamespaceFilter('');
              setStatusFilter('');
              setShowSystemResources(false);
            }}
          >
            重置
          </button>
        </>
      )}
      toolbarRight={
        <>
          <Dropdown
            trigger={["click"]}
            menu={{
              items: [{ key: 'batchDelete', label: '批量删除', disabled: !hasSnapshotsWrite || selectedRowKeys.length === 0, danger: true }],
              onClick: ({ key }) => key === 'batchDelete' && handleBatchDelete()
            }}
          >
            <Button icon={<EllipsisOutlined />} disabled={!hasSnapshotsWrite || selectedRowKeys.length === 0} />
          </Dropdown>
          <TableColumnSettingsButton
            allColumns={columns}
            settingsKey="harvester_volume_snapshots_list"
          />
          <Button icon={<ReloadOutlined />} onClick={() => onRefresh?.(true)} loading={loading} />
        </>
      }
    >
      <Table
        className="std-table"
        bordered={false}
        dataSource={filteredData}
        columns={visibleColumns || columns}
        rowKey="key"
        loading={loading}
        rowSelection={{
          selectedRowKeys,
          onChange: setSelectedRowKeys,
        }}
        pagination={{
          size: 'small',
          showTotal: (total) => `共 ${total} 条`,
        }}
      />
      <VolumeSnapshotRestoreModal
        visible={restoreVisible}
        cloudId={cloudId}
        resource={restoreRecord}
        onCancel={() => setRestoreVisible(false)}
        onSuccess={() => {
          setRestoreVisible(false);
          message.success('已提交恢复任务，请前往“数据卷”列表查看');
        }}
      />

      <HarvesterResourceDrawer
        open={detailVisible}
        onClose={() => setDetailVisible(false)}
        resourceType="VolumeSnapshot"
        record={detailRecord}
        cloudId={cloudId}
        activeTab={detailActiveTab}
        onTabChange={setDetailActiveTab}
      />
    </PageDetailSection>
  );
};

export default SnapshotsSection;
