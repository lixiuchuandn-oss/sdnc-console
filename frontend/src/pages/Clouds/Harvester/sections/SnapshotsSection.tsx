import React, { useMemo, useState } from 'react';
import { Table, Badge, Button, Modal, Input, message, Dropdown, Select } from 'antd';
import { ReloadOutlined, EllipsisOutlined } from '@ant-design/icons';
import PageDetailSection from '../../../../components/PageDetailSection';
import ResourceActionsDropdown from '../../../../components/ResourceActionsDropdown';
import { deleteHarvesterSnapshot } from '../../../../services/harvesterApi';
import VolumeSnapshotRestoreModal from '../modals/VolumeSnapshotRestoreModal';
import HarvesterResourceDrawer from '../components/HarvesterResourceDrawer';

interface Props {
  cloudId: string;
  snapshots: any[];
  loading: boolean;
  onRefresh?: (force?: boolean) => void;
}

const SnapshotsSection: React.FC<Props> = ({ cloudId, snapshots, loading, onRefresh }) => {
  const [keyword, setKeyword] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([]);
  
  const [restoreVisible, setRestoreVisible] = useState(false);
  const [restoreRecord, setRestoreRecord] = useState<any>(null);

  // Detail Drawer State
  const [detailVisible, setDetailVisible] = useState(false);
  const [detailRecord, setDetailRecord] = useState<any>(null);
  const [detailActiveTab, setDetailActiveTab] = useState('detail');

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

  const handleRestore = (record: any) => {
    setRestoreRecord(record);
    setRestoreVisible(true);
  };

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
          showSizeChanger: true,
          pageSizeOptions: ['10', '20', '50', '100'],
          showQuickJumper: false,
          defaultPageSize: 10
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
