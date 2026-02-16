/**
 * Harvester - 卷快照 (VolumeSnapshot) 列表 Section
 * 展示存储卷快照资源，支持：
 * - 关键字搜索（名称 / 命名空间 / 别名）
 * - 按 Ready / NotReady 过滤
 * - 单个/批量删除快照
 * - 通过 VolumeSnapshotRestoreModal 发起基于快照的数据卷恢复
 * - 打开 HarvesterResourceDrawer 查看快照详情及事件
 */
import React, { useMemo, useState } from 'react';
import { Table, Badge, Button, Modal, Input, message, Dropdown, Select } from 'antd';
import { ReloadOutlined, EllipsisOutlined } from '@ant-design/icons';
import PageDetailSection from '../../../../components/PageDetailSection';
import ResourceActionsDropdown from '../../../../components/ResourceActionsDropdown';
import { deleteHarvesterSnapshot } from '../../../../services/harvesterApi';
import VolumeSnapshotRestoreModal from '../modals/VolumeSnapshotRestoreModal';
import HarvesterResourceDrawer from '../components/HarvesterResourceDrawer';

/**
 * 组件入参说明
 * - cloudId: 当前云 ID，用于调用快照删除与恢复相关 API
 * - snapshots: 后端返回的快照列表（可能带 rawData 包装）
 * - loading: 外层加载状态
 * - onRefresh: 刷新回调，支持 force=true
 */
interface Props {
  cloudId: string;
  snapshots: any[];
  loading: boolean;
  onRefresh?: (force?: boolean) => void;
}

const SnapshotsSection: React.FC<Props> = ({ cloudId, snapshots, loading, onRefresh }) => {
  // 工具栏过滤与选择状态
  const [keyword, setKeyword] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([]);
  
  // 恢复弹窗状态
  const [restoreVisible, setRestoreVisible] = useState(false);
  const [restoreRecord, setRestoreRecord] = useState<any>(null);

  // 详情抽屉状态
  const [detailVisible, setDetailVisible] = useState(false);
  const [detailRecord, setDetailRecord] = useState<any>(null);
  const [detailActiveTab, setDetailActiveTab] = useState('detail');

  /**
   * 将快照列表转换为表格可用结构
   * - 统一解析名称、命名空间、源 PVC、快照类、状态、别名等字段
   */
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

  /**
   * 前端过滤逻辑
   * - 关键字：匹配名称 / 命名空间 / 别名
   * - 状态：Ready / NotReady
   */
  const filteredData = useMemo(() => {
    let d = dataSource;
    if (keyword) {
      const k = keyword.toLowerCase();
      d = d.filter((x: any) => 
        x.name.toLowerCase().includes(k) || 
        x.namespace.toLowerCase().includes(k) ||
        (x.alias && x.alias.toLowerCase().includes(k))
      );
    }
    if (statusFilter) {
      if (statusFilter === 'ready') {
        d = d.filter((x: any) => x.readyToUse);
      } else if (statusFilter === 'notReady') {
        d = d.filter((x: any) => !x.readyToUse);
      }
    }
    return d;
  }, [dataSource, keyword, statusFilter]);

  /**
   * 打开恢复弹窗
   */
  const handleRestore = (record: any) => {
    setRestoreRecord(record);
    setRestoreVisible(true);
  };

  /**
   * 打开 HarvesterResourceDrawer 展示快照详情
   * - 注入 kind 与 view 链接以支持事件页签
   */
  const handleOpenDrawer = (record: any, tab: string = 'detail') => {
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
  };

  /**
   * 删除单个快照
   */
  const handleDelete = (record: any) => {
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
  };

  /**
   * 批量删除选中的快照
   * - 逐个调用后端删除接口，并统计成功/失败数量
   */
  const handleBatchDelete = () => {
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

  /**
   * 表格列定义
   * - 名称列使用 alias 优先展示，回退到 name
   * - 状态列使用 Badge 区分 Ready / NotReady
   * - 操作列提供恢复与删除操作
   */
  const columns = [
    { 
      title: '名称', 
      dataIndex: 'alias', 
      key: 'alias', 
      width: 200,
      render: (_: any, r: any) => (
        <span className="cell-link" onClick={() => handleOpenDrawer(r, 'detail')}>
          {r.alias !== '-' ? r.alias : r.name}
        </span>
      )
    },
    { title: 'ID', dataIndex: 'name', key: 'name', width: 200 },
    { title: '命名空间', dataIndex: 'namespace', key: 'namespace', width: 150 },
    { title: '源资源', dataIndex: 'sourcePvc', key: 'sourcePvc', width: 200 },
    { title: '快照类', dataIndex: 'snapshotClassName', key: 'snapshotClassName', width: 150 },
    { 
      title: '状态', 
      dataIndex: 'readyToUse', 
      key: 'readyToUse', 
      width: 100,
      render: (ready: boolean) => (
        <Badge status={ready ? 'success' : 'warning'} text={ready ? 'Ready' : 'NotReady'} />
      )
    },
    { title: '大小', dataIndex: 'restoreSize', key: 'restoreSize', width: 100 },
    { 
      title: '创建时间', 
      dataIndex: 'creationTimestamp', 
      key: 'creationTimestamp', 
      width: 180,
      render: (t: string) => <span className="std-time">{t}</span>
    },
    {
      title: '操作',
      key: 'action',
      width: 80,
      fixed: 'right' as const,
      render: (_: any, record: any) => (
        <ResourceActionsDropdown 
          items={[
            { key: 'detail', label: '资源详情', onClick: () => handleOpenDrawer(record, 'detail') },
            { type: 'divider' as const },
            { key: 'restore', label: '恢复', onClick: () => handleRestore(record), disabled: !record.readyToUse },
            { key: 'delete', label: '删除', danger: true, onClick: () => handleDelete(record) }
          ]}
          buttonProps={{ className: 'row-actions-trigger' }}
        />
      ),
    },
  ];

  return (
    <PageDetailSection
      asCard={false}
      toolbarLeft={(
        <>
          <Input
            placeholder="搜索快照"
            className="toolbar-search"
            allowClear
            value={keyword}
            onChange={e => setKeyword(e.target.value)}
          />
          <Select
            allowClear
            placeholder="状态"
            className="toolbar-filter-sm"
            value={statusFilter || undefined}
            onChange={(v) => setStatusFilter(v || '')}
            options={[
              { value: '', label: '全部' },
              { value: 'ready', label: 'Ready' },
              { value: 'notReady', label: 'NotReady' }
            ]}
          />
        </>
      )}
      toolbarRight={
        <>
          <Dropdown
            trigger={["click"]}
            menu={{
              items: [{ key: 'batchDelete', label: '批量删除', disabled: selectedRowKeys.length === 0, danger: true }],
              onClick: ({ key }) => key === 'batchDelete' && handleBatchDelete()
            }}
          >
            <Button icon={<EllipsisOutlined />} />
          </Dropdown>
          <Button icon={<ReloadOutlined />} onClick={() => onRefresh?.(true)} loading={loading} />
        </>
      }
    >
      <Table
        className="std-table"
        bordered
        dataSource={filteredData}
        columns={columns}
        rowKey="key"
        loading={loading}
        rowSelection={{
          selectedRowKeys,
          onChange: setSelectedRowKeys,
        }}
        pagination={{
          size: 'small',
          showQuickJumper: false,
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
