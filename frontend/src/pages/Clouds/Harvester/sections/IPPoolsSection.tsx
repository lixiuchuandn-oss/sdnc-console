import React, { useMemo, useState } from 'react';
import { Table, Button, message, Input } from 'antd';
import { ReloadOutlined, PlusOutlined } from '@ant-design/icons';
import PageDetailSection from '../../../../components/PageDetailSection';
import ResourceActionsDropdown from '../../../../components/ResourceActionsDropdown';
import IPPoolCreateModal from '../modals/IPPoolCreateModal';

interface Props {
  cloudId: string;
  ippools: any[];
  loading: boolean;
  onRefresh?: (force?: boolean) => void;
}

const IPPoolsSection: React.FC<Props> = ({ cloudId, ippools, loading, onRefresh }) => {
  const [keyword, setKeyword] = useState<string>('');
  const [createVisible, setCreateVisible] = useState(false);
  
  const dataSource = useMemo(() => {
    return (ippools || []).map((pool: any) => {
      const raw = pool.rawData || pool;
      
      // Harvester/Kube-VIP IP Pool structure typically has ranges or cidr in spec
      // Adjust based on actual CRD structure if needed. 
      // Common structure: spec.ranges, spec.cidrs
      const ranges = (raw.spec?.ranges || []).map((r: any) => `${r.start}-${r.end}`).join(', ');
      const cidrs = (raw.spec?.cidrs || []).join(', ');

      return {
        key: raw.metadata?.uid || pool.id,
        name: raw.metadata?.name || pool.name,
        namespace: raw.metadata?.namespace || pool.namespace || '-', // Some IPPools might be cluster-scoped
        ranges: ranges || cidrs || '-',
        selector: raw.spec?.selector ? JSON.stringify(raw.spec.selector) : '-',
        creationTimestamp: raw.metadata?.creationTimestamp || pool.createdAt,
        raw,
      };
    });
  }, [ippools]);

  const filteredData = useMemo(() => {
    let d = dataSource;
    if (keyword) {
      const k = keyword.toLowerCase();
      d = d.filter((x: any) => x.name.toLowerCase().includes(k) || (x.namespace && x.namespace.toLowerCase().includes(k)));
    }
    return d;
  }, [dataSource, keyword]);

  const columns = [
    { title: '名称', dataIndex: 'name', key: 'name', width: 200 },
    { title: '命名空间', dataIndex: 'namespace', key: 'namespace', width: 150 },
    { title: 'IP 范围/CIDR', dataIndex: 'ranges', key: 'ranges', width: 250 },
    { title: '选择器', dataIndex: 'selector', key: 'selector', width: 200, ellipsis: true },
    { title: '创建时间', dataIndex: 'creationTimestamp', key: 'creationTimestamp', width: 180 },
    {
      title: '操作',
      key: 'action',
      width: 80,
      fixed: 'right' as const,
      render: (_: any, record: any) => (
        <ResourceActionsDropdown 
          buttonProps={{ className: 'row-actions-trigger' }}
          items={[
            { key: 'delete', label: '删除', danger: true, onClick: () => message.info('暂不支持删除') }
          ]}
        />
      ),
    },
  ];

  return (
    <PageDetailSection
      asCard={false}
      toolbarLeft={
        <Input
          className="toolbar-search"
          placeholder="搜索名称或命名空间"
          value={keyword}
          onChange={e => setKeyword(e.target.value)}
          allowClear
        />
      }
      toolbarRight={
        <>
          <Button icon={<PlusOutlined />} type="primary" onClick={() => setCreateVisible(true)}>创建</Button>
          <Button icon={<ReloadOutlined />} onClick={() => onRefresh?.(true)} loading={loading}>刷新</Button>
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
        pagination={{size: 'small'}}
      />
      <IPPoolCreateModal
        visible={createVisible}
        onCancel={() => setCreateVisible(false)}
        onSuccess={() => onRefresh?.(true)}
        cloudId={cloudId}
      />
    </PageDetailSection>
  );
};

export default IPPoolsSection;
