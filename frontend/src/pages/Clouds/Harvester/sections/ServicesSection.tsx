import React, { useMemo, useState } from 'react';
import { Table, Button, Input, Select } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import PageDetailSection from '../../../../components/PageDetailSection';
import ResourceActionsDropdown from '../../../../components/ResourceActionsDropdown';
import TableColumnSettings from '../../../../components/TableColumnSettings';
import HarvesterResourceDrawer from '../components/HarvesterResourceDrawer';

interface Props {
  cloudId: string;
  services: any[];
  loading: boolean;
  onRefresh?: () => void;
}

const ServicesSection: React.FC<Props> = ({ cloudId, services, loading, onRefresh }) => {
  const [keyword, setKeyword] = useState<string>('');
  const [typeFilter, setTypeFilter] = useState<string>('All');
  
  // Drawer state
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [selectedRecord, setSelectedRecord] = useState<any>(null);
  const [drawerActiveTab, setDrawerActiveTab] = useState('detail');
  
  const dataSource = useMemo(() => {
    return (services || []).map((s: any) => {
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
        originalRecord: s, // 保留原始数据库记录
      };
    });
  }, [services]);

  const filteredData = useMemo(() => {
    let d = dataSource;
    if (keyword) {
      const k = keyword.toLowerCase();
      d = d.filter((x: any) => x.name.toLowerCase().includes(k) || x.namespace.toLowerCase().includes(k));
    }
    if (typeFilter && typeFilter !== 'All') {
      d = d.filter((x: any) => x.type === typeFilter);
    }
    return d;
  }, [dataSource, keyword, typeFilter]);

  const serviceTypes = useMemo(() => {
    const types = new Set(dataSource.map((d: any) => d.type).filter((t: string) => t !== '-'));
    return ['All', ...Array.from(types)];
  }, [dataSource]);

  const allColumns = useMemo(() => [
    { 
      title: '名称', 
      dataIndex: 'name', 
      key: 'name',
      render: (text: string, record: any) => (
        <a className="cell-link" onClick={() => {
          setSelectedRecord(record);
          setDrawerActiveTab('detail');
          setDrawerOpen(true);
        }}>{text}</a>
      )
    },
    { title: '命名空间', dataIndex: 'namespace', key: 'namespace' },
    { 
      title: '类型', 
      dataIndex: 'type', 
      key: 'type', 
      render: (t: string) => {
        let badgeClass = 'std-badge-default';
        if (t === 'LoadBalancer') badgeClass = 'std-badge-success';
        else if (t === 'NodePort') badgeClass = 'std-badge-warning';
        else if (t === 'ClusterIP') badgeClass = 'std-badge-info';
        
        return (
          <span className={`std-badge ${badgeClass}`}>
            {t}
          </span>
        );
      } 
    },
    { title: 'Cluster IP', dataIndex: 'clusterIP', key: 'clusterIP' },
    { title: '外部 IP', dataIndex: 'externalIPs', key: 'externalIPs' },
    { title: '端口', dataIndex: 'ports', key: 'ports', ellipsis: true },
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
      render: (_: any, record: any) => (
        <ResourceActionsDropdown 
          items={[
            { key: 'detail', label: '资源详情', onClick: () => {
              setSelectedRecord(record);
              setDrawerActiveTab('detail');
              setDrawerOpen(true);
            }}
          ]}
          buttonProps={{ className: 'row-actions-trigger' }}
        />
      ),
    },
  ], []);

  const [tableColumns, setTableColumns] = useState<any[]>(allColumns);
  const [pagination, setPagination] = useState({ current: 1, pageSize: 10 });

  return (
    <PageDetailSection
      asCard={false}
      toolbarLeft={
        <>
          <Input 
            allowClear 
            placeholder="搜索名称或命名空间" 
            value={keyword}
            onChange={e => { setKeyword(e.target.value); setPagination(p=>({...p, current:1})); }}
            className="toolbar-search" 
          />
          <Select
            value={typeFilter}
            onChange={v => { setTypeFilter(v); setPagination(p=>({...p, current:1})); }}
            options={serviceTypes.map(t => ({ label: t === 'All' ? '所有类型' : t, value: t }))}
            className="toolbar-filter-sm"
          />
          <a className="toolbar-reset-btn" onClick={() => { setKeyword(''); setTypeFilter('All'); setPagination(p=>({...p, current:1})); }}>重置</a>
        </>
      }
      toolbarRight={
        <div className="toolbar-actions">
          <TableColumnSettings 
            columns={allColumns} 
            onChange={setTableColumns}
            settingsKey="harvester_services_table"
          />
          <Button icon={<ReloadOutlined />} onClick={onRefresh} loading={loading} />
        </div>
      }
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
      
      <HarvesterResourceDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        resourceType="Service"
        record={selectedRecord ? { ...selectedRecord.originalRecord, kind: 'Service' } : null}
        cloudId={cloudId}
        activeTab={drawerActiveTab}
        onTabChange={setDrawerActiveTab}
      />
    </PageDetailSection>
  );
};

export default ServicesSection;
