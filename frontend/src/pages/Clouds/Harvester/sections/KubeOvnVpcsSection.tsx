import React, { useMemo, useState } from 'react';
import { Table, Space, Input, Select, Button } from 'antd';
import { SettingOutlined, ReloadOutlined } from '@ant-design/icons';
import PageDetailSection from '../../../../components/PageDetailSection';

type Props = {
  vpcs: any[];
  loading: boolean;
  onRefresh?: () => void;
};

const KubeOvnVpcsSection: React.FC<Props> = ({ vpcs, loading, onRefresh }) => {
  const [keyword, setKeyword] = useState<string>('');
  const [ns, setNs] = useState<string | undefined>(undefined);
  const [standalone, setStandalone] = useState<string | undefined>(undefined);

  const nsOptions = useMemo(() => {
    const set = new Set<string>();
    for (const v of vpcs || []) {
      const arr = Array.isArray(v?.namespaces) ? v.namespaces : [];
      for (const n of arr) {
        const s = String(n || '').trim();
        if (s) set.add(s);
      }
    }
    return Array.from(set).map((x) => ({ label: x, value: x }));
  }, [vpcs]);

  const filtered = useMemo(() => {
    const kw = String(keyword || '').toLowerCase().trim();
    return (vpcs || []).filter((r: any) => {
      const name = String(r?.name || r?.metadata?.name || '').toLowerCase();
      if (kw && !name.includes(kw)) return false;
      if (ns) {
        const arr = Array.isArray(r?.namespaces) ? r.namespaces : [];
        if (!arr.map((x:any)=> String(x||'')).includes(ns)) return false;
      }
      if (standalone) {
        const val = r?.standalone ? 'yes' : 'no';
        if (val !== standalone) return false;
      }
      return true;
    });
  }, [vpcs, keyword, ns, standalone]);

  return (
    <PageDetailSection
      asCard={false}
      toolbarLeft={(
        <>
          <Input allowClear placeholder="搜索名称" value={keyword} onChange={(e)=> setKeyword(e.target.value)} style={{ width: 240 }} />
          <Select allowClear placeholder="命名空间" options={nsOptions} value={ns} onChange={(v)=> setNs(v)} style={{ width: 200 }} />
          <Select allowClear placeholder="独立模式" options={[{ label:'是', value:'yes' }, { label:'否', value:'no' }]} value={standalone} onChange={(v)=> setStandalone(v)} style={{ width: 200 }} />
        </>
      )}
      toolbarRight={(
        <>
          <Button icon={<SettingOutlined />} />
          <Button icon={<ReloadOutlined />} onClick={onRefresh} />
        </>
      )}
    >
      <Table
        className="kv-section-table"
        bordered
        rowKey={(r:any)=> r?.name || r?.metadata?.name || Math.random().toString(36).slice(2)}
        columns={[
          { title: '名称', key: 'name', render: (_:any, r:any)=> r?.name || r?.metadata?.name || '-' },
          { title: '命名空间', key: 'namespaces', render: (_:any, r:any)=> Array.isArray(r?.namespaces) ? r.namespaces.join(',') : '-' },
          { title: '独立模式', key: 'standalone', render: (_:any, r:any)=> (r?.standalone ? '是' : '否') },
          { title: '静态路由数', key: 'staticRoutes', render: (_:any, r:any)=> typeof r?.staticRoutes === 'number' ? r.staticRoutes : '-' },
          { title: '创建时间', key: 'createdAt', render: (_:any, r:any)=> r?.createdAt || '-' },
        ] as any}
        dataSource={filtered}
        loading={loading}
        pagination={{ showSizeChanger:true, pageSize:10, pageSizeOptions:[10,20,50,100] }}
      />
    </PageDetailSection>
  );
};

export default KubeOvnVpcsSection;
