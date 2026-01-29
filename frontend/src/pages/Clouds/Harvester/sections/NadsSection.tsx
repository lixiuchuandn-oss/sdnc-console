import React, { useMemo, useState } from 'react';
import { Table, Input, Select, Tag, Button } from 'antd';
import { SettingOutlined, ReloadOutlined } from '@ant-design/icons';
import PageDetailSection from '../../../../components/PageDetailSection';

type Props = {
  nads: any[];
  loading: boolean;
  onRefresh?: () => void;
};

const NadsSection: React.FC<Props> = ({ nads, loading, onRefresh }) => {
  const [keyword, setKeyword] = useState<string>('');
  const [nsFilter, setNsFilter] = useState<string>('');
  const [ipamFilter, setIpamFilter] = useState<string>('');
  const getIpamType = (r: any): string => { try { const v=r?.config; const o=typeof v==='string'?JSON.parse(v):v; const ip=o?.ipam; const t=String(ip?.type||'').toLowerCase(); if (!t && typeof (ip as any)?.subnet==='string') return 'host-local'; return t || ''; } catch { return ''; } };
  const netTypeText = (t?: string): string => { const k=String(t||'').toLowerCase(); const m:Record<string,string>={ 'host-local':'主机本地', 'static':'静态', 'dhcp':'DHCP', '':'未配置' }; return m[k] || t || '-'; };
  const netTypeBadge = (t?: string) => { const k=String(t||'').toLowerCase(); const color=(function(){ if(k==='dhcp')return 'green'; if(k==='static')return 'blue'; if(k==='host-local')return 'gold'; return undefined; })(); return <Tag color={color}>{netTypeText(t)}</Tag>; };
  const filtered = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    const ns = nsFilter.trim().toLowerCase();
    const ipt = ipamFilter.trim().toLowerCase();
    return (Array.isArray(nads) ? nads : []).filter((r:any) => {
      const name = String(r?.name || '').toLowerCase();
      const nspace = String(r?.namespace || '').toLowerCase();
      const okKw = !kw || name.includes(kw) || nspace.includes(kw);
      if (!okKw) return false;
      if (ns && nspace !== ns) return false;
      const t = getIpamType(r);
      if (ipt && t !== ipt) return false;
      return true;
    });
  }, [nads, keyword, nsFilter, ipamFilter]);
  const nsOptions = Array.from(new Set((nads||[]).map((r:any)=>String(r?.namespace||'').trim()).filter(Boolean)));
  const ipamOptions = Array.from(new Set((nads||[]).map((r:any)=>getIpamType(r)).filter(Boolean)));
  return (
    <PageDetailSection
      asCard={false}
      toolbarLeft={(
        <>
          <Input allowClear placeholder="关键字" value={keyword} onChange={(e)=>setKeyword(e.target.value)} style={{ width: 240 }} />
          <Select allowClear placeholder="命名空间" value={nsFilter || undefined} onChange={(v)=>setNsFilter(v||'')} style={{ width: 200 }} options={[{ value: '', label: '全部' }, ...nsOptions.map(s=>({ value: s.toLowerCase(), label: s }))]} />
          <Select allowClear placeholder="IPAM类型" value={ipamFilter || undefined} onChange={(v)=>setIpamFilter(v||'')} style={{ width: 200 }} options={[{ value: '', label: '全部' }, ...ipamOptions.map(s=>({ value: s.toLowerCase(), label: netTypeText(s) }))]} />
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
        rowKey={(r:any)=> r?.name || Math.random().toString(36).slice(2)}
        columns={[
          { title: '网络名称', key: 'name', render: (_:any, r:any)=> (r?.name || '-') },
          { title: '命名空间', key: 'ns', render: (_:any, r:any)=> (r?.namespace || '-') },
          { title: 'VLAN', key: 'vlan', render: (_:any, r:any)=> { try { const v=r?.config; const o=typeof v==='string'?JSON.parse(v):v; const n=o?.vlan; return typeof n==='number'?String(n): (typeof n==='string'?n:'-'); } catch { return '-'; } } },
          { title: 'IPAM类型', key: 'ipamType', render: (_:any, r:any)=> netTypeBadge(getIpamType(r)) },
          { title: '混杂模式', key: 'promisc', render: (_:any, r:any)=> { try { const v=r?.config; const o=typeof v==='string'?JSON.parse(v):v; return o?.promiscMode===true?'是':o?.promiscMode===false?'否':'-'; } catch { return '-'; } } },
          { title: '网桥信息', key: 'bridgeInfo', render: (_:any, r:any)=> { try { const v=r?.config; const o=typeof v==='string'?JSON.parse(v):v; const tp=o?.type||'-'; const br=o?.bridge||'-'; return `${tp} / ${br}`; } catch { return '-'; } } },
          { title: 'CNI版本', key: 'cni', render: (_:any, r:any)=> { try { const v=r?.config; const o=typeof v==='string'?JSON.parse(v):v; return o?.cniVersion || '-'; } catch { return '-'; } } },
        ] as any}
        dataSource={filtered}
        loading={loading}
        pagination={{ showSizeChanger:true, pageSize:10, pageSizeOptions:[10,20,50,100] }}
      />
    </PageDetailSection>
  );
};

export default NadsSection;
