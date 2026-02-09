import React, { useMemo, useState } from 'react';
import { Table, Tag, Button, message, Input } from 'antd';
import { ReloadOutlined, SearchOutlined } from '@ant-design/icons';
import PageDetailSection from '../../../../components/PageDetailSection';
import ResourceActionsDropdown from '../../../../components/ResourceActionsDropdown';

interface Props {
  cloudId: string;
  ingresses: any[];
  loading: boolean;
  onRefresh?: (force?: boolean) => void;
}

const IngressesSection: React.FC<Props> = ({ cloudId, ingresses, loading, onRefresh }) => {
  const [keyword, setKeyword] = useState<string>('');
  
  const dataSource = useMemo(() => {
    return (ingresses || []).map((i: any) => {
      const raw = i.rawData || i;
      const rules = raw.spec?.rules || [];
      const ruleDesc = rules.map((r: any) => {
        const host = r.host || '*';
        const paths = (r.http?.paths || []).map((p: any) => p.path).join(', ');
        return `${host} -> [${paths}]`;
      }).join('; ');

      return {
        key: raw.metadata?.uid || i.id,
        name: raw.metadata?.name || i.name,
        namespace: raw.metadata?.namespace || i.namespace,
        rules: ruleDesc,
        creationTimestamp: raw.metadata?.creationTimestamp || i.createdAt,
        raw,
      };
    });
  }, [ingresses]);

  const filteredData = useMemo(() => {
    let d = dataSource;
    if (keyword) {
      const k = keyword.toLowerCase();
      d = d.filter((x: any) => x.name.toLowerCase().includes(k) || x.namespace.toLowerCase().includes(k));
    }
    return d;
  }, [dataSource, keyword]);

  const columns = [
    { title: '名称', dataIndex: 'name', key: 'name', width: 200 },
    { title: '命名空间', dataIndex: 'namespace', key: 'namespace', width: 150 },
    { title: '规则', dataIndex: 'rules', key: 'rules', width: 400, ellipsis: true },
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
      toolbarLeft={(
        <Input
          className="toolbar-search"
          placeholder="搜索名称或命名空间"
          value={keyword}
          onChange={e => setKeyword(e.target.value)}
          allowClear
        />
      )}
      toolbarRight={
        <Button icon={<ReloadOutlined />} onClick={() => onRefresh?.(true)} loading={loading}>刷新</Button>
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
    </PageDetailSection>
  );
};

export default IngressesSection;
