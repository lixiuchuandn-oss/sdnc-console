import React, { useMemo, useState } from 'react';
import { Table, Tag, Button, Modal, Input, message } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import PageDetailSection from '../../../../components/PageDetailSection';
import ResourceActionsDropdown from '../../../../components/ResourceActionsDropdown';
import { deleteHarvesterSnapshot } from '../../../../services/harvesterApi';

interface Props {
  cloudId: string;
  snapshots: any[];
  loading: boolean;
  onRefresh?: () => void;
}

const SnapshotsSection: React.FC<Props> = ({ cloudId, snapshots, loading, onRefresh }) => {
  const [keyword, setKeyword] = useState<string>('');
  
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
      d = d.filter((x: any) => x.name.toLowerCase().includes(k) || x.namespace.toLowerCase().includes(k));
    }
    return d;
  }, [dataSource, keyword]);

  const handleDelete = (record: any) => {
    Modal.confirm({
      title: '确认删除快照',
      content: `确定要删除快照 ${record.name} 吗？`,
      okText: '删除',
      okType: 'danger',
      cancelText: '取消',
      onOk: async () => {
        try {
          await deleteHarvesterSnapshot(cloudId, record.namespace, record.name);
          message.success('删除成功');
          onRefresh?.();
        } catch (e: any) {
          message.error(`删除失败: ${e.message}`);
        }
      },
    });
  };

  const columns = [
    { title: '名称', dataIndex: 'name', key: 'name', width: 200 },
    { title: '别名', dataIndex: 'alias', key: 'alias', width: 150 },
    { title: '命名空间', dataIndex: 'namespace', key: 'namespace', width: 150 },
    { title: '源资源', dataIndex: 'sourcePvc', key: 'sourcePvc', width: 200 },
    { title: '快照类', dataIndex: 'snapshotClassName', key: 'snapshotClassName', width: 150 },
    { 
      title: '状态', 
      dataIndex: 'readyToUse', 
      key: 'readyToUse', 
      width: 100,
      render: (ready: boolean) => (
        <Tag color={ready ? 'green' : 'orange'}>{ready ? 'Ready' : 'NotReady'}</Tag>
      )
    },
    { title: '大小', dataIndex: 'restoreSize', key: 'restoreSize', width: 100 },
    { title: '创建时间', dataIndex: 'creationTimestamp', key: 'creationTimestamp', width: 180 },
    {
      title: '操作',
      key: 'action',
      width: 80,
      fixed: 'right' as const,
      render: (_: any, record: any) => (
        <ResourceActionsDropdown 
          items={[
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
        <Input
          placeholder="搜索快照"
          className="toolbar-search"
          allowClear
          value={keyword}
          onChange={e => setKeyword(e.target.value)}
        />
      )}
      toolbarRight={
        <>
          <Button icon={<ReloadOutlined />} onClick={onRefresh} loading={loading}>刷新</Button>
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
        pagination={{ size: 'small' }}
      />
    </PageDetailSection>
  );
};

export default SnapshotsSection;
