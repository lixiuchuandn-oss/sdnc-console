import React, { useMemo, useState } from 'react';
import { Table, Button, message, Tag, Input } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import PageDetailSection from '../../../../components/PageDetailSection';
import ResourceActionsDropdown from '../../../../components/ResourceActionsDropdown';

interface Props {
  cloudId: string;
  services: any[];
  loading: boolean;
  onRefresh?: (force?: boolean) => void;
}

const LoadBalancersSection: React.FC<Props> = ({ cloudId, services, loading, onRefresh }) => {
  const [keyword, setKeyword] = useState<string>('');
  
  const dataSource = useMemo(() => {
    // Filter only LoadBalancer type services
    const lbs = (services || []).filter((s: any) => {
        const raw = s.rawData || s;
        return raw.spec?.type === 'LoadBalancer';
    });

    return lbs.map((s: any) => {
      const raw = s.rawData || s;
      const ports = (raw.spec?.ports || []).map((p: any) => `${p.port}:${p.targetPort}/${p.protocol}`).join(', ');
      const externalIPs = (raw.status?.loadBalancer?.ingress || []).map((i: any) => i.ip || i.hostname).join(', ');

      return {
        key: raw.metadata?.uid || s.id,
        name: raw.metadata?.name || s.name,
        namespace: raw.metadata?.namespace || s.namespace,
        type: raw.spec?.type || '-',
        clusterIP: raw.spec?.clusterIP || '-',
        externalIPs: externalIPs || '-',
        ports: ports || '-',
        creationTimestamp: raw.metadata?.creationTimestamp || s.createdAt,
        raw,
      };
    });
  }, [services]);

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
    { title: '类型', dataIndex: 'type', key: 'type', width: 120, render: (t: string) => <Tag color="blue">{t}</Tag> },
    { title: 'Cluster IP', dataIndex: 'clusterIP', key: 'clusterIP', width: 140 },
    { title: '外部 IP', dataIndex: 'externalIPs', key: 'externalIPs', width: 150 },
    { title: '端口', dataIndex: 'ports', key: 'ports', width: 200, ellipsis: true },
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
        <Button icon={<ReloadOutlined />} onClick={() => onRefresh && onRefresh(true)} loading={loading}>刷新</Button>
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

export default LoadBalancersSection;
