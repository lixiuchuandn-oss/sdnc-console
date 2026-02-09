import React, { useMemo, useState } from 'react';
import { Table, Button, message, Input } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import PageDetailSection from '../../../../components/PageDetailSection';
import ResourceActionsDropdown from '../../../../components/ResourceActionsDropdown';
import TableColumnSettings from '../../../../components/TableColumnSettings';

interface Props {
  cloudId: string;
  sshKeys: any[];
  loading: boolean;
  onRefresh?: (force?: boolean) => void;
}

const SshKeysSection: React.FC<Props> = ({ cloudId, sshKeys, loading, onRefresh }) => {
  const [keyword, setKeyword] = useState<string>('');
  
  const dataSource = useMemo(() => {
    return (sshKeys || []).map((k: any) => {
      const raw = k.rawData || k;
      return {
        key: raw.metadata?.uid || k.id,
        name: raw.metadata?.name || k.name,
        namespace: raw.metadata?.namespace || k.namespace,
        fingerprint: raw.status?.fingerprint || k.fingerprint || '-',
        creationTimestamp: raw.metadata?.creationTimestamp || k.createdAt,
        raw,
      };
    });
  }, [sshKeys]);

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
    { title: '指纹 (Fingerprint)', dataIndex: 'fingerprint', key: 'fingerprint', ellipsis: true },
    { title: '创建时间', dataIndex: 'creationTimestamp', key: 'creationTimestamp', width: 180, className: 'std-time' },
    {
      title: '操作',
      key: 'action',
      width: 80,
      fixed: 'right' as const,
      render: (_: any, record: any) => (
        <ResourceActionsDropdown 
          items={[
            { key: 'delete', label: '删除', danger: true, onClick: () => message.info('暂不支持删除') }
          ]}
          buttonProps={{ className: 'row-actions-trigger' }}
        />
      ),
    },
  ];

  const [tableColumns, setTableColumns] = useState<any[]>(columns);

  return (
    <PageDetailSection
      title="SSH 密钥 (SSH Keys)"
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
            settingsKey="harvester_ssh_keys_table"
          />
          <Button icon={<ReloadOutlined />} onClick={() => onRefresh?.(true)} loading={loading} />
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
        pagination={{ size: 'small' }}
      />
    </PageDetailSection>
  );
};

export default SshKeysSection;
