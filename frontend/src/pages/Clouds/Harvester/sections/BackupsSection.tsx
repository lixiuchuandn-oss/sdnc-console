/**
 * Harvester - 云主机备份 / 快照列表 Section
 * 负责展示当前 Harvester 云中某一类型（备份 / 快照）的 VM Backup 列表，
 * 支持按状态与关键字筛选，以及发起删除和恢复操作，并在工具栏提供创建备份/快照入口。
 */
import React, { useMemo, useState, useEffect, useRef, useCallback } from 'react';
import { Table, Tag, Button, message, Input, Modal, Select, Badge, Dropdown } from 'antd';
import { ReloadOutlined, EllipsisOutlined, SearchOutlined, SaveOutlined, CameraOutlined } from '@ant-design/icons';
import PageDetailSection from '../../../../components/PageDetailSection';
import { TableColumnSettings } from '../../../../components/TableColumnSettings';
import { deleteHarvesterBackup } from '../../../../services/harvesterApi';
import VmBackupCreateModal from '../modals/VmBackupCreateModal';
import VmRestoreModal from '../modals/VmRestoreModal';
import HarvesterResourceDrawer from '../components/HarvesterOpsinfoDrawer';
import { isPublicNamespace, isSystemNamespace } from '../../../../utils/harvesterUtils';

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
  onRefresh?: (force?: boolean) => void;
  namespaces: any[];
  vms: any[];
  type?: 'backup' | 'snapshot';
  vmId?: string;
  isTenant?: boolean;
}

const BackupsSection: React.FC<Props> = ({ cloudId, backups, loading, onRefresh, namespaces, vms, type = 'backup', vmId, isTenant }) => {
  // 关键字搜索
  const [keyword, setKeyword] = useState<string>('');
  // 状态过滤：all / ready / not_ready
  const [statusFilter, setStatusFilter] = useState<string | undefined>(undefined);
  // 创建备份/快照弹窗可见性
  const [createModalVisible, setCreateModalVisible] = useState(false);
  // 恢复弹窗可见性
  const [restoreModalVisible, setRestoreModalVisible] = useState(false);
  // 当前选中的备份/快照，用于恢复操作
  const [currentSnapshot, setCurrentSnapshot] = useState<any>(null);
  // 详情抽屉
  const [drawerVisible, setDrawerVisible] = useState(false);
  const [drawerRecord, setDrawerRecord] = useState<any>(null);
  
  // Polling for created item status
  const [pendingCreated, setPendingCreated] = useState<{ namespace: string; name: string } | null>(null);
  const pollRef = useRef<any>(null);
  const pollCountRef = useRef(0);

  // 列设置状态
  const [visibleColumns, setVisibleColumns] = useState<any>();

  const startPolling = (created?: { namespace: string; name: string }) => {
    if (!onRefresh) return;
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    if (created) {
      setPendingCreated(created);
      pollCountRef.current = 0;
      onRefresh(true);
      pollRef.current = setInterval(() => {
        pollCountRef.current += 1;
        onRefresh(true);
        if (pollCountRef.current > 20) {
          clearInterval(pollRef.current);
          pollRef.current = null;
          setPendingCreated(null);
        }
      }, 3000);
    } else {
      onRefresh(true);
    }
  };

  useEffect(() => {
    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!pendingCreated) return;
    const found = (backups || []).find((b: any) => {
      const raw = b.rawData || b;
      const itemType = raw.spec?.type || 'backup';
      if (itemType !== type) return false;
      const nm = raw.metadata?.name || b.name;
      const ns = raw.metadata?.namespace || b.namespace;
      return nm === pendingCreated.name && ns === pendingCreated.namespace;
    });
    if (found) {
      const raw = found.rawData || found;
      const ready = !!raw.status?.readyToUse;
      if (ready) {
        if (pollRef.current) {
          clearInterval(pollRef.current);
          pollRef.current = null;
        }
        setPendingCreated(null);
      }
    }
  }, [backups, pendingCreated, type]);
  
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
  }, [backups, type, vmId, vms]);

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
    if (keyword) {
      const k = keyword.toLowerCase();
      d = d.filter((x: any) => x.name.toLowerCase().includes(k) || x.namespace.toLowerCase().includes(k));
    }
    return d;
  }, [dataSource, keyword, statusFilter, isTenant]);

  /**
   * 删除单个备份 / 快照
   * 弹出确认框后调用后端删除接口，成功后触发刷新
   */
  const handleDelete = useCallback((record: any) => {
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
          onRefresh?.();
        } catch (e: any) {
          message.error(`删除失败: ${e.message}`);
        }
      },
    });
  }, [type, cloudId, onRefresh]);

  /**
   * 表格列定义
   * - 名称列使用 alias，后台 metadata.name 作为 ID 独立展示
   * - 状态列使用 Badge 显示 Ready / NotReady
   * - 操作列支持恢复与删除
   */
  const columns = useMemo(() => [
    {
      title: '类型',
      dataIndex: 'itemType',
      key: 'itemType',
      render: (t: string) => (
        <span>{t === 'snapshot' ? '虚拟机快照' : '虚拟机备份'}</span>
      ),
    },
    { 
       title: '名称', 
       dataIndex: 'alias', 
       key: 'alias',
       render: (t: string, r: any) => (
          <span>
            {r.itemType === 'snapshot'
              ? <CameraOutlined style={{ color: '#1677ff', fontSize: 16, marginRight: 8 }} />
              : <SaveOutlined style={{ color: '#1677ff', fontSize: 16, marginRight: 8 }} />}
            {t !== '-' ? t : r.name}
          </span>
       )
    },
    { 
       title: 'ID', 
       dataIndex: 'name', 
       key: 'name',
       render: (t: string) => <span>{t}</span>
    },
    { title: '命名空间', dataIndex: 'namespace', key: 'namespace' },
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
      render: (t: string) => <span>{t}</span>
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
          items.push({
            key: 'opsinfo',
            label: '运维信息',
            onClick: () => { setDrawerRecord(record.raw); setDrawerVisible(true); }
          });
          items.push({ type: 'divider' });
        }
        
        items.push({
          key: 'restore',
          label: '恢复',
          disabled: !record.readyToUse,
          onClick: () => {
            setCurrentSnapshot(record);
            setRestoreModalVisible(true);
          }
        });
        items.push({ type: 'divider' });
        items.push({ key: 'delete', label: '删除', danger: true, onClick: () => handleDelete(record) });
        
        return (
          <Dropdown menu={{ items }} trigger={['click']}>
            <Button icon={<EllipsisOutlined />} className="row-actions-trigger" type="text" />
          </Dropdown>
        );
      },
    },
  ], [handleDelete, isTenant]);

  return (
    <PageDetailSection asCard={false}>
      <div key="toolbar" style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
        <div key="toolbar-left" style={{ display: 'flex', gap: 8 }}>
          {/* 关键字搜索：按名称 / 命名空间模糊匹配 */}
          <Input
            key="keyword-search"
            className="toolbar-search"
            placeholder="关键字"
            suffix={<SearchOutlined style={{ color: 'rgba(0,0,0,.45)' }} />}
            value={keyword}
            onChange={e => setKeyword(e.target.value)}
            allowClear
          />
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
        </div>
        <div key="toolbar-right" className="toolbar-actions">
           <Button key="create-btn" type="primary" onClick={() => setCreateModalVisible(true)}>创建{type === 'backup' ? '备份' : '快照'}</Button>
           <TableColumnSettings
             key="col-settings"
             columns={columns}
             onChange={setVisibleColumns}
             settingsKey={`harvester_${type}_list`}
           />
           <Button key="refresh-btn" icon={<ReloadOutlined />} onClick={() => onRefresh?.(true)} loading={loading} />
         </div>
      </div>
      <Table
        key="table"
        className={!isTenant ? "std-table" : "std-table no-border"}
        bordered={!isTenant}
        dataSource={filteredData}
        columns={visibleColumns || columns}
        rowKey={(record: any) => record.key || record.id || `${record.namespace}-${record.name}`}
        loading={loading}
        pagination={{
          size: 'small',
          showQuickJumper: false,
        }}
      />
      <HarvesterResourceDrawer
        open={drawerVisible}
        onClose={() => setDrawerVisible(false)}
        resourceType={type === 'backup' ? 'VmBackup' : 'VmSnapshot'}
        record={drawerRecord}
        cloudId={cloudId}
      />
      <VmBackupCreateModal
        key="create-modal"
        open={createModalVisible}
        onCancel={() => setCreateModalVisible(false)}
        onSuccess={(created) => {
          setCreateModalVisible(false);
          startPolling(created);
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
        vms={vms}
      />
    </PageDetailSection>
  );
};

export default BackupsSection;
