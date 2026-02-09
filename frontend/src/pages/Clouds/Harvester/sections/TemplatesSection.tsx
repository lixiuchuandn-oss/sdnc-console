import React, { useState, useMemo } from 'react';
import { Table, Input, Button } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { ReloadOutlined } from '@ant-design/icons';
import PageDetailSection from '../../../../components/PageDetailSection';
import TableColumnSettings from '../../../../components/TableColumnSettings';

interface Props {
  cloudId: string;
  templates: any[];
  loading: boolean;
  onRefresh?: () => void;
}

const TemplatesSection: React.FC<Props> = ({ cloudId, templates = [], loading, onRefresh }) => {
  const [searchText, setSearchText] = useState('');
  
  const allColumns = useMemo<ColumnsType<any>>(() => [
    {
      title: '名称',
      key: 'name',
      render: (_: any, r: any) => <span>{r.metadata?.name}</span>
    },
    {
      title: '命名空间',
      key: 'namespace',
      render: (_: any, r: any) => r.metadata?.namespace || '-'
    },
    {
      title: '描述',
      key: 'description',
      render: (_: any, r: any) => r.spec?.description || '-'
    },
    {
      title: '创建时间',
      key: 'createdAt',
      render: (_: any, r: any) => r.metadata?.creationTimestamp || '-'
    },
    {
      title: '操作',
      key: 'actions',
      width: 120,
      render: () => (
        <span style={{ color: '#999', cursor: 'not-allowed' }}>暂无操作</span>
      )
    }
  ], []);

  const [tableColumns, setTableColumns] = useState<ColumnsType<any>>(allColumns);

  const filteredData = useMemo(() => {
    if (!searchText) return templates;
    const lower = searchText.toLowerCase();
    return templates.filter(item => 
      item?.metadata?.name?.toLowerCase().includes(lower) ||
      item?.metadata?.namespace?.toLowerCase().includes(lower)
    );
  }, [templates, searchText]);

  return (
    <PageDetailSection
      toolbarLeft={(
        <Input
          placeholder="搜索名称或命名空间"
          value={searchText}
          onChange={e => setSearchText(e.target.value)}
          className="toolbar-search"
          allowClear
        />
      )}
      toolbarGapLeft={12}
      keywordWidth={200}
      toolbarRight={(
        <>
          <TableColumnSettings
            columns={allColumns}
            onChange={setTableColumns}
            settingsKey="harvester_templates_table"
          />
          {onRefresh && (
            <Button 
              icon={<ReloadOutlined />} 
              onClick={onRefresh} 
              loading={loading}
            />
          )}
        </>
      )}
    >
      <Table
        className="std-table"
        bordered
        rowKey={(r) => r.metadata?.uid || r.metadata?.name}
        columns={tableColumns}
        dataSource={filteredData}
        loading={loading}
        pagination={{ size: 'small' }}
      />
    </PageDetailSection>
  );
};

export default TemplatesSection;
