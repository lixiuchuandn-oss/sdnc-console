/**
 * ==============================================================================
 * 模块名称: Harvester 卷快照列表 (Harvester Volume Snapshot List)
 * 文件路径: frontend/src/pages/cnmc/clouds/Harvester/ebs/sections/SnapshotsSection.tsx
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
 *    - 系统命名空间：与云盘列表一致，管理员默认不展示；租户不展示系统/公共命名空间。
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
 * 【页面结构对照（便于改 UI 时定位代码）】
 * - `PageDetailSection.toolbarLeft`  → 搜索、命名空间(运维)、状态筛选、重置
 * - `PageDetailSection.toolbarRight` → 批量操作、列设置、刷新
 * - `PageDetailSection` 子节点      → 主表格 `Table`
 * - `VolumeSnapshotRestoreModal`     → 从表格行「恢复」打开
 * - `HarvesterResourceDrawer`        → 运维「查看 YAML」打开
 * 
 * ==============================================================================
 */

// -----------------------------------------------------------------------------
// 依赖
// -----------------------------------------------------------------------------
import React, { useMemo, useState, useCallback } from 'react';
import { Table, Badge, Button, Modal, Input, message, Dropdown, Select } from 'antd';
import { ReloadOutlined, EllipsisOutlined, SearchOutlined, CameraTwoTone } from '@ant-design/icons';
import PageDetailSection from '../../../../../../components/PageDetailSection';
import ResourceActionsDropdown from '../../../../../../components/ResourceActionsDropdown';
import { deleteHarvesterSnapshot } from '../../../../../../services/harvesterApi';
import VolumeSnapshotRestoreModal from '../../ebs/modals/VolumeSnapshotRestoreModal';
import HarvesterResourceDrawer from '../../shared/components/HarvesterOpsinfoDrawer';
import { isSystemNamespace } from '../../../../../../utils/harvesterUtils';
import { useHarvesterPublicNamespaces } from '../../context/HarvesterPublicNamespacesContext';
import TableColumnSettingsButton from '../../../../../../components/TableColumnSettingsButton';
import { useTableColumnSettings } from '../../../../../../hooks/useTableColumnSettings';
import { useAuth } from '../../../../../../contexts/AuthContext';
import { hasPermissionForAction } from '../../../../../../utils/accessMapping';

// -----------------------------------------------------------------------------
// Props（云详情「卷快照」Tab 注入）
// -----------------------------------------------------------------------------
/**
 * 组件 Props 定义
 * @property cloudId - 当前云环境 ID，用于 API 调用
 * @property snapshots - 快照数据列表 (支持 rawData 嵌套结构或扁平结构)
 * @property loading - 表格加载状态
 * @property onRefresh - 刷新回调，force=true 表示强制从后端同步
 * @property bordered - 是否显示表格边框 (默认: true)。租户侧可能需要无边框样式。
 * @property showYaml - 是否显示 YAML/详情入口 (默认: true)。租户侧通常隐藏底层细节。
 * @property isTenant - 是否为租户模式 (租户模式下强制过滤系统和公共命名空间；管理员侧与云盘列表一致，默认不展示系统命名空间)
 */
interface Props {
  cloudId: string;
  snapshots: any[];
  loading: boolean;
  onRefresh?: (force?: boolean, silent?: boolean) => void;
  isTenant?: boolean;
  namespaces?: any[];
  bordered?: boolean;
  mode?: 'standard' | 'ops';
}

const SnapshotsSection: React.FC<Props> = ({ 
  cloudId, 
  snapshots, 
  loading, 
  onRefresh,
  isTenant = false,
  namespaces = [],
  bordered = true,
  mode = 'ops'
}) => {
  const isStandardView = mode === 'standard';
  const { isPublicNamespace } = useHarvesterPublicNamespaces();
  const { user } = useAuth();
  const perms = useMemo(() => (user?.permissions ?? []) as string[], [user?.permissions]);
  const hasSnapshotsWrite = useMemo(
    () => hasPermissionForAction(perms, 'clouds.snapshots:write') || hasPermissionForAction(perms, 'clouds:write'),
    [perms],
  );

  // ==============================================================================
  // 1. 状态定义 (State Definitions)
  // ==============================================================================
  
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
  // 3. 系统资源过滤：与 VolumesSection 一致 — 租户排除系统/公共命名空间；管理员排除系统命名空间（无「显示系统资源」开关）
  const filteredData = useMemo(() => {
    let d = dataSource;

    // [系统资源过滤]
    d = d.filter((r: any) => {
      const ns = r.namespace;
      if (isTenant) {
        if (isSystemNamespace(ns) || isPublicNamespace(ns)) return false;
      } else if (isSystemNamespace(ns)) {
        return false;
      }
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
    if (mode === 'ops' && namespaceFilter) {
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
  }, [dataSource, keyword, statusFilter, isTenant, namespaceFilter, mode, isPublicNamespace]);

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
  const handleBatchDelete = useCallback(() => {
    if (!hasSnapshotsWrite) {
      message.error('无权限执行该操作');
      return;
    }
    if (selectedRowKeys.length === 0) return;
    const targets = dataSource.filter((s) => selectedRowKeys.includes(s.key));

    Modal.confirm({
      title: '批量删除确认',
      content: `即将删除 ${targets.length} 个快照：${targets.map((t) => (t.alias !== '-' ? t.alias : t.name)).join(', ')}`,
      okText: '删除',
      cancelText: '取消',
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          const results = await Promise.allSettled(
            targets.map((t) => deleteHarvesterSnapshot(cloudId, t.namespace, t.name)),
          );
          const ok = results.filter((x) => x.status === 'fulfilled').length;
          const fail = results.length - ok;

          if (ok > 0) message.success(`成功删除 ${ok} 个快照`);
          if (fail > 0) message.error(`${fail} 个快照删除失败`);

          setSelectedRowKeys([]);
          onRefresh?.(true);
        } catch (e: any) {
          message.error(e.message || '批量删除失败');
        }
      },
    });
  }, [hasSnapshotsWrite, selectedRowKeys, dataSource, cloudId, onRefresh]);

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
      width: 280,
      render: (_: any, r: any) => {
        const label = r.alias !== '-' ? r.alias : r.name;
        return (
          <span style={{ display: 'flex', alignItems: 'center', gap: 6, maxWidth: 280, minWidth: 0, width: '100%' }}>
            <CameraTwoTone style={{ flexShrink: 0 }} />
            <span
              style={{
                flex: 1,
                minWidth: 0,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
              title={label || undefined}
            >
              {label}
            </span>
          </span>
        );
      },
    },
    {
      title: '快照ID',
      dataIndex: 'name',
      key: 'name',
      render: (v: string) => (
        <span
          className="text-secondary"
          style={{
            display: 'block',
            maxWidth: 280,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
          title={v || undefined}
        >
          {v || '-'}
        </span>
      ),
    },
    ...(mode === 'ops' ? [{ title: '命名空间', dataIndex: 'namespace', key: 'namespace' }] : []),
    { title: '源PVC', dataIndex: 'sourcePvc', key: 'sourcePvc'  },
    ...(mode === 'ops' ? [{ title: '快照类', dataIndex: 'snapshotClassName', key: 'snapshotClassName' }] : []),
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
      sorter: (a: any, b: any) => {
        const ta = a?.creationTimestamp ? new Date(a.creationTimestamp).getTime() : 0;
        const tb = b?.creationTimestamp ? new Date(b.creationTimestamp).getTime() : 0;
        return ta - tb;
      },
      defaultSortOrder: 'descend' as const,
      render: (t: string) => (
        <span>{t ? new Date(t).toLocaleString() : '-'}</span>
      ),
    },
    {
      title: '操作',
      key: 'action',
      width: 80,
      align: 'left' as const,
      fixed: 'right' as const,
      render: (_: any, record: any) => {
        const items: any[] = [];
        if (!isTenant && !isStandardView) {
          items.push({ key: 'detail', label: '查看YAML', onClick: () => handleOpenDrawer(record, 'detail') });
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
  ], [isTenant, isStandardView, mode, handleOpenDrawer, handleRestore, handleDelete, hasSnapshotsWrite]);

  // 列显示设置（需要在 columns 定义之后）
  const { displayColumns: visibleColumns } = useTableColumnSettings(columns, 'harvester_volume_snapshots_list');

  // ==============================================================================
  // 5. 渲染视图 (Render) — 与云详情「卷快照」Tab 页面对应
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
          {!isTenant && mode === 'ops' && (
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
                    if (isSystemNamespace(n)) return false;
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
      {/* --- 主内容：快照列表表格（行选择用于批量删除）--- */}
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

      {/* --- 弹层：将快照恢复为新 PVC（跨 Harvester/modals）--- */}
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

      {/* --- 抽屉：YAML / Events（运维入口）--- */}
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
