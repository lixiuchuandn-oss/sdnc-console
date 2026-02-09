import React, { useMemo, useState } from 'react';
import { Table, Tag, Button, message, Input, Modal, Select, Badge } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import PageDetailSection from '../../../../components/PageDetailSection';
import ResourceActionsDropdown from '../../../../components/ResourceActionsDropdown';
import { deleteHarvesterBackup } from '../../../../services/harvesterApi';
import VmBackupCreateModal from '../modals/VmBackupCreateModal';
import VmRestoreModal from '../modals/VmRestoreModal';

interface Props {
  cloudId: string;
  backups: any[];
  loading: boolean;
  onRefresh?: () => void;
  namespaces: any[];
  vms: any[];
  type?: 'backup' | 'snapshot';
}

const BackupsSection: React.FC<Props> = ({ cloudId, backups, loading, onRefresh, namespaces, vms, type = 'backup' }) => {
  const [keyword, setKeyword] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [createModalVisible, setCreateModalVisible] = useState(false);
  const [restoreModalVisible, setRestoreModalVisible] = useState(false);
  const [currentSnapshot, setCurrentSnapshot] = useState<any>(null);
  
  const dataSource = useMemo(() => {
    return (backups || [])
      .filter((b: any) => {
        const raw = b.rawData || b;
        const itemType = raw.spec?.type || 'backup';
        return itemType === type;
      })
      .map((b: any) => {
      const raw = b.rawData || b;
      return {
        key: raw.metadata?.uid || b.id,
        name: raw.metadata?.name || b.name,
        namespace: raw.metadata?.namespace || b.namespace,
        targetVm: raw.spec?.source?.name || b.targetVm || '-',
        readyToUse: raw.status?.readyToUse,
        creationTimestamp: raw.metadata?.creationTimestamp || b.createdAt,
        alias: raw.metadata?.annotations?.['tower.io/alias'] || '-',
        raw,
      };
    });
  }, [backups, type]);

  const filteredData = useMemo(() => {
    let d = dataSource;
    if (statusFilter !== 'all') {
      const isReady = statusFilter === 'ready';
      d = d.filter((x: any) => !!x.readyToUse === isReady);
    }
    if (keyword) {
      const k = keyword.toLowerCase();
      d = d.filter((x: any) => x.name.toLowerCase().includes(k) || x.namespace.toLowerCase().includes(k));
    }
    return d;
  }, [dataSource, keyword, statusFilter]);

  const handleDelete = (record: any) => {
    Modal.confirm({
      title: '确认删除备份',
      content: `确定要删除备份 ${record.name} 吗？`,
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
  };

  const columns = [

    { title: '名称', dataIndex: 'alias', key: 'alias' },
    { title: 'ID', dataIndex: 'name', key: 'name' },
    { title: '命名空间', dataIndex: 'namespace', key: 'namespace' },
    { title: '目标虚拟机', dataIndex: 'targetVm', key: 'targetVm' },
    { 
      title: '状态', 
      dataIndex: 'readyToUse', 
      key: 'readyToUse', 
      render: (ready: boolean) => (
        <Badge status={ready ? 'success' : 'warning'} text={ready ? 'Ready' : 'NotReady'} />
      )
    },
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
      fixed: 'right' as const,
      render: (_: any, record: any) => {
        const items: any[] = [
          {
            key: 'restore',
            label: '恢复',
            onClick: () => {
              setCurrentSnapshot(record);
              setRestoreModalVisible(true);
            }
          },
          { key: 'delete', label: '删除', danger: true, onClick: () => handleDelete(record) }
        ];
        
        return (
          <ResourceActionsDropdown 
            buttonProps={{ className: 'row-actions-trigger' }}
            items={items}
          />
        );
      },
    },
  ];

  return (
    <PageDetailSection
      asCard={false}
      toolbarLeft={(
        <>
          <Input
            className="toolbar-search"
            placeholder="搜索名称或命名空间"
            value={keyword}
            onChange={e => setKeyword(e.target.value)}
            allowClear
          />
          <Select
            className="toolbar-filter"
            value={statusFilter}
            onChange={setStatusFilter}
            options={[
              { label: '全部状态', value: 'all' },
              { label: 'Ready', value: 'ready' },
              { label: 'NotReady', value: 'not_ready' },
            ]}
          />
        </>
      )}
      toolbarRight={(
         <div className="toolbar-actions">
           <Button type="primary" onClick={() => setCreateModalVisible(true)}>创建{type === 'backup' ? '备份' : '快照'}</Button>
           <Button icon={<ReloadOutlined />} onClick={onRefresh} loading={loading} />
         </div>
      )}
    >
      <Table
        className="std-table"
        bordered
        dataSource={filteredData}
        columns={columns}
        rowKey="key"
        loading={loading}
        pagination={{size: 'small'}}
      />
      <VmBackupCreateModal
        visible={createModalVisible}
        onCancel={() => setCreateModalVisible(false)}
        onSuccess={() => {
          setCreateModalVisible(false);
          onRefresh?.();
        }}
        cloudId={cloudId}
        namespaces={namespaces}
        vms={vms}
        initialType={type}
      />
      <VmRestoreModal
        visible={restoreModalVisible}
        onCancel={() => setRestoreModalVisible(false)}
        onSuccess={() => {
          setRestoreModalVisible(false);
        }}
        cloudId={cloudId}
        resource={currentSnapshot}
        resourceType={type}
      />
    </PageDetailSection>
  );
};

export default BackupsSection;
