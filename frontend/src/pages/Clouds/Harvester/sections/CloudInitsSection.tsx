import React, { useMemo, useState } from 'react';
import { Table, Button, message, Input } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import PageDetailSection from '../../../../components/PageDetailSection';
import ResourceActionsDropdown from '../../../../components/ResourceActionsDropdown';
import TableColumnSettings from '../../../../components/TableColumnSettings';

interface Props {
  cloudId: string;
  cloudInits: any[];
  loading: boolean;
  onRefresh?: () => void;
}

const CloudInitsSection: React.FC<Props> = ({ cloudId, cloudInits, loading, onRefresh }) => {
  const [keyword, setKeyword] = useState<string>('');
  
  const dataSource = useMemo(() => {
    return (cloudInits || []).map((c: any) => {
      const raw = c.rawData || c;
      return {
        key: raw.metadata?.uid || c.id,
        name: raw.metadata?.name || c.name,
        namespace: raw.metadata?.namespace || c.namespace,
        description: raw.metadata?.annotations?.['harvesterhci.io/cloud-init-template-description'] || c.description || '-',
        creationTimestamp: raw.metadata?.creationTimestamp || c.createdAt,
        raw,
      };
    });
  }, [cloudInits]);

  const filteredData = useMemo(() => {
    let d = dataSource;
    if (keyword) {
      const k = keyword.toLowerCase();
      d = d.filter((x: any) => x.name.toLowerCase().includes(k) || x.namespace.toLowerCase().includes(k));
    }
    return d;
  }, [dataSource, keyword]);

  const columns = [
    { title: '名称', dataIndex: 'name', key: 'name', className: 'cell-link' },
    { title: '命名空间', dataIndex: 'namespace', key: 'namespace', width: 150 },
    { title: '描述', dataIndex: 'description', key: 'description', ellipsis: true },
    { title: '创建时间', dataIndex: 'creationTimestamp', key: 'creationTimestamp', width: 180, className: 'std-time' },
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

  const [tableColumns, setTableColumns] = useState<any[]>(columns);

  return (
    <PageDetailSection
      title="Cloud Init 模板"
      asCard={false}
      toolbarLeft={(
        <Input 
          allowClear 
          placeholder="关键字" 
          className="toolbar-search" 
          value={keyword} 
          onChange={(e)=> setKeyword(e.target.value)} 
        />
      )}
      toolbarRight={(
        <>
          <TableColumnSettings 
            columns={columns} 
            onChange={setTableColumns}
            settingsKey="harvester_cloud_inits_table"
          />
          <Button icon={<ReloadOutlined />} onClick={onRefresh} loading={loading} />
        </>
      )}
    >
      <Table
        className="std-table"
        bordered
        dataSource={filteredData}
        columns={tableColumns}
        rowKey="key"
        loading={loading}
        pagination={{size: 'small'}}
      />
    </PageDetailSection>
  );
};

export default CloudInitsSection;
