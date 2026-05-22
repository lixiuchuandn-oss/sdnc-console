/**
 * Harvester - 云主机备份 / 快照列表 Section
 * 负责展示当前 Harvester 云中某一类型（备份 / 快照）的 VM Backup 列表，
 * 支持按状态与关键字筛选，以及发起删除和恢复操作，并在工具栏提供创建备份/快照入口。
 */
import React, { useMemo, useState, useCallback } from 'react';
import { Table, Tag, Button, message, Input, Modal, Select, Badge, Dropdown } from 'antd';
import { ReloadOutlined, EllipsisOutlined, SearchOutlined, CameraTwoTone  } from '@ant-design/icons';
import PageDetailSection from '../../../../../../components/PageDetailSection';
import TableColumnSettingsButton from '../../../../../../components/TableColumnSettingsButton';
import { useTableColumnSettings } from '../../../../../../hooks/useTableColumnSettings';
import { deleteHarvesterBackup } from '../../../../../../services/harvesterApi';
import VmBackupCreateModal from '../../cbr/modals/VmBackupCreateModal';
import VmRestoreModal from '../../cbr/modals/VmRestoreModal';
import HarvesterResourceDrawer from '../../shared/components/HarvesterOpsinfoDrawer';
import { isSystemNamespace } from '../../../../../../utils/harvesterUtils';
import { useHarvesterPublicNamespaces } from '../../context/HarvesterPublicNamespacesContext';
import { useAuth } from '../../../../../../contexts/AuthContext';
import { hasPermissionForAction } from '../../../../../../utils/accessMapping';

/**
 * 组件入参
 * - cloudId: 当前云 ID，用于调用后端 Harvester API
 * - backups: 后端返回的备份/快照列表（可能是原始数据或带 rawData 的包装对象）
 * - loading: 数据加载中标记，用于控制表格与按钮的 loading 状态
 * - onRefresh: 外层传入的刷新回调，支持强制刷新
 * - namespaces: 命名空间列表，用于创建备份弹窗中的下拉框
 * - vms: 虚拟机列表，用于创建/恢复时选择目标 VM
 * - type: 列表类型，'backup' 或 'snapshot'，默认展示备份
 */
interface Props {
  cloudId: string;
  backups: any[];
  loading: boolean;
  onRefresh?: (force?: boolean, silent?: boolean) => void;
  namespaces: any[];
  vms: any[];
  type?: 'backup' | 'snapshot';
  vmId?: string;
  /** 仅展示目标 VM 满足此谓词的备份/快照（与 vmId 同时存在时两者都需满足） */
  targetVmPredicate?: (namespace: string, vmName: string) => boolean;
  /** 恢复弹窗用的 VM 列表；不传则与 vms 相同（创建弹窗始终用 vms） */
  restoreVms?: any[];
  isTenant?: boolean;
  bordered?: boolean;
}

const BackupsSection: React.FC<Props> = ({
  cloudId,
  backups,
  loading,
  onRefresh,
  namespaces,
  vms,
  type = 'backup',
  vmId,
  targetVmPredicate,
  restoreVms,
  isTenant,
  bordered = true,
}) => {
  const vmsForRestore = restoreVms ?? vms;
  const { isPublicNamespace } = useHarvesterPublicNamespaces();
  const { user } = useAuth();
  const perms = useMemo(() => (user?.permissions ?? []) as string[], [user?.permissions]);
  const hasBackupsWrite = useMemo(
    () => hasPermissionForAction(perms, 'clouds.backups:write') || hasPermissionForAction(perms, 'clouds:write'),
    [perms],
  );
  // 关键字搜索
  const [keyword, setKeyword] = useState<string>('');
  // 状态过滤：all / ready / not_ready
  const [statusFilter, setStatusFilter] = useState<string | undefined>(undefined);
  // 命名空间过滤
  const [namespaceFilter, setNamespaceFilter] = useState<string | undefined>(undefined);
  // 创建备份/快照弹窗可见性
  const [createModalVisible, setCreateModalVisible] = useState(false);
  // 恢复弹窗可见性
  const [restoreModalVisible, setRestoreModalVisible] = useState(false);
  // 当前选中的备份/快照，用于恢复操作
  const [currentSnapshot, setCurrentSnapshot] = useState<any>(null);
  // 详情抽屉
  const [drawerVisible, setDrawerVisible] = useState(false);
  const [drawerRecord, setDrawerRecord] = useState<any>(null);
  const [drawerActiveTab, setDrawerActiveTab] = useState<string>('detail');
  
  // 列设置状态
  
  /**
   * 将原始备份列表规范化为表格可直接使用的数据结构
   * 同时按照 type 区分 Backup / Snapshot
   */
  const dataSource = useMemo(() => {
    return (backups || [])
      .filter((b: any) => {
        const raw = b.rawData || b;
        const itemType = raw.spec?.type || 'backup';
        // Filter by type
        if (itemType !== type) return false;
        // Filter by vmId if provided
        if (vmId) {
             const target = raw.spec?.source?.name || b.targetVm;
             if (target !== vmId) return false;
        }
        if (targetVmPredicate) {
          const ns = raw.metadata?.namespace || b.namespace;
          const targetName = raw.spec?.source?.name || b.targetVm || '';
          if (!targetName || !targetVmPredicate(ns, targetName)) return false;
        }
        return true;
      })
      .map((b: any) => {
      const raw = b.rawData || b;
      const itemType = raw.spec?.type || 'backup';
      const ns = raw.metadata?.namespace || b.namespace;
      const targetName = raw.spec?.source?.name || b.targetVm || '';
      let targetAlias = '-';
      try {
        const vm = (vms || []).find((vm: any) => {
          const vmNs = vm?.metadata?.namespace || vm?.namespace;
          const vmName = vm?.metadata?.name || vm?.name;
          return vmNs === ns && vmName === targetName;
        });
        if (vm) {
          targetAlias = vm?.metadata?.annotations?.['tower.io/alias'] || vm?.alias || (vm?.name || vm?.metadata?.name) || '-';
        }
      } catch {}

      return {
        key: raw.metadata?.uid || b.id || `${ns}-${raw.metadata?.name || b.name}`,
        name: raw.metadata?.name || b.name,
        itemType,
        namespace: ns,
        targetVmAlias: targetAlias,
        readyToUse: raw.status?.readyToUse,
        creationTimestamp: raw.metadata?.creationTimestamp || b.createdAt,
        alias: raw.metadata?.annotations?.['tower.io/alias'] || '-',
        raw,
      };
    });
  }, [backups, type, vmId, vms, targetVmPredicate]);

  /**
   * 客户端过滤逻辑
   * - 根据 readyToUse 状态过滤
   * - 根据关键字在名称 / 命名空间中模糊匹配
   */
  const filteredData = useMemo(() => {
    let d = dataSource;
    if (isTenant) {
      d = d.filter((x: any) => {
        const ns = (x.namespace || '').toLowerCase();
        return !isPublicNamespace(ns) && !isSystemNamespace(ns);
      });
    }
    if (statusFilter === 'ready' || statusFilter === 'not_ready') {
      const isReady = statusFilter === 'ready';
      d = d.filter((x: any) => !!x.readyToUse === isReady);
    }
    if (namespaceFilter) {
      d = d.filter((x: any) => x.namespace === namespaceFilter);
    }
    if (keyword) {
      const k = keyword.toLowerCase();
      d = d.filter((x: any) => 
        x.name.toLowerCase().includes(k) || 
        x.namespace.toLowerCase().includes(k) ||
        (x.alias && x.alias !== '-' && x.alias.toLowerCase().includes(k))
      );
    }
    return d;
  }, [dataSource, keyword, statusFilter, isTenant, namespaceFilter, isPublicNamespace]);

  const namespaceOptions = useMemo(() => {
    const set = new Set<string>();
    dataSource.forEach((x: any) => {
      const ns = String(x?.namespace || '');
      if (!ns) return;
      if (isSystemNamespace(ns)) return;
      if (isTenant && isPublicNamespace(ns)) return;
      set.add(ns);
    });
    return Array.from(set).sort().map((ns) => ({ label: ns, value: ns }));
  }, [dataSource, isTenant, isPublicNamespace]);

  /**
   * 删除单个备份 / 快照
   * 弹出确认框后调用后端删除接口，成功后触发刷新
   */
  const handleDelete = useCallback((record: any) => {
    if (!hasBackupsWrite) {
      message.error('无权限执行该操作');
      return;
    }
    Modal.confirm({
      title: `确认删除${type === 'backup' ? '备份' : '快照'}`,
      content: `确定要删除${type === 'backup' ? '备份' : '快照'} ${record.alias || record.name} 吗？`,
      okText: '删除',
      okType: 'danger',
      cancelText: '取消',
      onOk: async () => {
        try {
          await deleteHarvesterBackup(cloudId, record.namespace, record.name);
          message.success('删除成功');
          onRefresh?.(true);
        } catch (e: any) {
          message.error(`删除失败: ${e.message}`);
        }
      },
    });
  }, [type, cloudId, onRefresh, hasBackupsWrite]);

  /**
   * 表格列定义
   * - 名称列使用 alias，后台 metadata.name 作为 ID 独立展示
   * - 状态列使用 Badge 显示 Ready / NotReady
   * - 操作列支持恢复与删除
   */
  const columns = useMemo(() => [
    {
      title: '名称',
      dataIndex: 'alias',
      key: 'alias',
      render: (t: string, r: any) => (
        <span style={{ display: 'flex', alignItems: 'center', gap: 6, maxWidth: '100%' }}>
          <CameraTwoTone/>
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 }}>{t !== '-' ? t : r.name}</span>
        </span>
      ),
    },
    {
      title: '类型',
      dataIndex: 'itemType',
      key: 'itemType',
      render: (t: string) => (
        <span>{t === 'snapshot' ? '虚拟机快照' : '虚拟机备份'}</span>
      ),
    },
    { 
       title: 'ID', 
       dataIndex: 'name', 
       key: 'name',
       render: (t: string) => <span>{t}</span>
    },
    { title: '项目', dataIndex: 'namespace', key: 'namespace' },
    { title: '目标虚拟机', dataIndex: 'targetVmAlias', key: 'targetVmAlias' },
    { 
      title: '状态', 
      dataIndex: 'readyToUse', 
      key: 'readyToUse', 
      render: (ready: boolean) => (
        <Badge status={ready ? 'success' : 'warning'} text={ready ? '就绪' : '未就绪'} />
      )
    },
    { 
      title: '创建时间', 
      dataIndex: 'creationTimestamp', 
      key: 'creationTimestamp', 
      render: (t: string) => (
        <span className="text-secondary">{t ? new Date(t).toLocaleString() : '-'}</span>
      ),
      sorter: (a: any, b: any) => {
        const ta = Date.parse(String(a?.creationTimestamp || ''));
        const tb = Date.parse(String(b?.creationTimestamp || ''));
        const na = Number.isFinite(ta) ? ta : 0;
        const nb = Number.isFinite(tb) ? tb : 0;
        return na - nb;
      },
      defaultSortOrder: 'descend' as const,
    },
    {
      title: '操作',
      key: 'action',
      align: 'left' as const,
      fixed: 'right' as const,
      render: (_: any, record: any) => {
        const items: any[] = [];
        
        if (!isTenant) {
          items.push({
            key: 'opsinfo',
            label: '查看YAML',
            onClick: () => { 
              // 确保传递完整的 rawData，包含 status 信息
              const rawRecord = record.raw || record.rawData || record;
              
              // 创建新对象，避免直接修改原对象，并确保深度复制 links
              const recordWithLink = {
                ...rawRecord,
                links: rawRecord.links ? { ...rawRecord.links } : {}
              };
              
              // 生成 view link（如果不存在）
              if (!recordWithLink.links.view) {
                const ns = recordWithLink.metadata?.namespace || recordWithLink.namespace;
                const name = recordWithLink.metadata?.name || recordWithLink.name;
                if (ns && name) {
                  // VirtualMachineBackup 的 API 路径
                  recordWithLink.links.view = `/apis/harvesterhci.io/v1beta1/namespaces/${encodeURIComponent(ns)}/virtualmachinebackups/${encodeURIComponent(name)}`;
                }
              }
              
              setDrawerRecord(recordWithLink); 
              setDrawerVisible(true); 
            }
          });
          items.push({ type: 'divider' });
        }
        
        items.push({
          key: 'restore',
          label: '恢复',
          disabled: !record.readyToUse || !hasBackupsWrite,
          onClick: () => {
            if (!hasBackupsWrite) {
              message.error('无权限执行该操作');
              return;
            }
            setCurrentSnapshot(record);
            setRestoreModalVisible(true);
          }
        });
        items.push({ type: 'divider' });
        items.push({ key: 'delete', label: '删除', danger: true, disabled: !hasBackupsWrite, onClick: () => handleDelete(record) });
        
        return (
          <Dropdown menu={{ items }} trigger={['click']}>
            <Button icon={<EllipsisOutlined />} className="row-actions-trigger" type="text" disabled={!hasBackupsWrite} />
          </Dropdown>
        );
      },
    },
  ], [handleDelete, isTenant, hasBackupsWrite]);

  // 列显示设置（需要在 columns 定义之后）
  const { displayColumns: visibleColumns } = useTableColumnSettings(columns, `harvester_${type}_list`);

  return (
    <PageDetailSection asCard={false}>
      <div key="toolbar" style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
        <div key="toolbar-left" style={{ display: 'flex', gap: 8 }}>
          {/* 关键字搜索：按名称 / 别名 / ID 模糊匹配 */}
          <Input
            key="keyword-search"
            className="toolbar-search"
            placeholder="名称/ID"
            suffix={<SearchOutlined style={{ color: 'rgba(0,0,0,.45)' } } />}
            value={keyword}
            onChange={e => setKeyword(e.target.value)}
            allowClear
          />
          {!isTenant && (
            <Select
              key="namespace-filter"
              allowClear
              showSearch
              className="toolbar-filter-sm"
              placeholder="项目"
              value={namespaceFilter}
              onChange={setNamespaceFilter}
              options={namespaceOptions}
            />
          )}
          {/* 状态过滤：全部 / Ready / NotReady */}
          <Select
            key="status-filter"
            allowClear
            className="toolbar-filter-sm"
            placeholder="选择状态"
            value={statusFilter}
            onChange={setStatusFilter}
            options={[
              { label: '全部状态', value: undefined as any },
              { label: '就绪', value: 'ready' },
              { label: '未就绪', value: 'not_ready' },
            ]}
          />
          <button
            type="button"
            className="toolbar-reset-btn"
            onClick={() => {
              setKeyword('');
              setStatusFilter(undefined);
              setNamespaceFilter(undefined);
            }}
          >
            重置
          </button>
        </div>
        <div key="toolbar-right" className="toolbar-actions">
           <Button key="create-btn" type="primary" disabled={!hasBackupsWrite} onClick={() => { if (!hasBackupsWrite) return; setCreateModalVisible(true); }}>创建{type === 'backup' ? '备份' : '快照'}</Button>
           <TableColumnSettingsButton
             key="col-settings"
             allColumns={columns}
             settingsKey={`harvester_${type}_list`}
           />
           <Button key="refresh-btn" icon={<ReloadOutlined />} onClick={() => onRefresh?.(true)} loading={loading} />
         </div>
      </div>
      <Table
        key="table"
        className="std-table"
        scroll={{ x: true }}
        bordered={false}
        dataSource={filteredData}
        columns={visibleColumns || columns}
        rowKey={(record: any) => record.key || record.id || `${record.namespace}-${record.name}`}
        loading={loading}
        pagination={{
          showTotal: (total) => `共 ${total} 条`,
        }}
      />
      <HarvesterResourceDrawer
        open={drawerVisible}
        onClose={() => setDrawerVisible(false)}
        resourceType={type === 'backup' ? 'VmBackup' : 'VmSnapshot'}
        record={drawerRecord}
        cloudId={cloudId}
        activeTab={drawerActiveTab}
        onTabChange={setDrawerActiveTab}
      />
      <VmBackupCreateModal
        key="create-modal"
        open={createModalVisible}
        onCancel={() => setCreateModalVisible(false)}
        onSuccess={() => {
          setCreateModalVisible(false);
          onRefresh?.(true, true);
          window.setTimeout(() => onRefresh?.(true, true), 2500);
        }}
        cloudId={cloudId}
        namespaces={namespaces}
        vms={vms}
        initialType={type}
      />
      <VmRestoreModal
        key="restore-modal"
        open={restoreModalVisible}
        onCancel={() => setRestoreModalVisible(false)}
        onSuccess={() => {
          setRestoreModalVisible(false);
        }}
        cloudId={cloudId}
        resource={currentSnapshot}
        resourceType={type}
        vms={vmsForRestore}
      />
    </PageDetailSection>
  );
};

export default BackupsSection;
