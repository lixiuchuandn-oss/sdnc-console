import React, { useMemo, useState } from 'react';
import { Table, Tag, Space, Input, Select, Button } from 'antd';
import { SettingOutlined, ReloadOutlined } from '@ant-design/icons';
import PageDetailSection from '../../../../components/PageDetailSection';

type Props = {
  subnets: any[];
  loading: boolean;
  onRefresh?: () => void;
};

const KubeOvnSubnetsSection: React.FC<Props> = ({ subnets, loading, onRefresh }) => {
  const [keyword, setKeyword] = useState<string>('');
  const [vpc, setVpc] = useState<string | undefined>(undefined);
  const [protocol, setProtocol] = useState<string | undefined>(undefined);
  const [nat, setNat] = useState<string | undefined>(undefined);
  const [dhcp, setDhcp] = useState<string | undefined>(undefined);

  const vpcOptions = useMemo(() => {
    const set = new Set<string>();
    for (const s of subnets || []) {
      const v = String(s?.vpc || s?.spec?.vpc || '').trim();
      if (v) set.add(v);
    }
    return Array.from(set).map((x) => ({ label: x, value: x }));
  }, [subnets]);

  const protocolOptions = useMemo(() => {
    const set = new Set<string>();
    for (const s of subnets || []) {
      const p = String(s?.protocol || '').trim();
      if (p) set.add(p);
    }
    return Array.from(set).map((x) => ({ label: x, value: x }));
  }, [subnets]);

  const filtered = useMemo(() => {
    const kw = String(keyword || '').toLowerCase().trim();
    return (subnets || []).filter((r: any) => {
      const name = String(r?.name || r?.metadata?.name || '').toLowerCase();
      if (kw && !name.includes(kw)) return false;
      if (vpc) {
        const vv = String(r?.vpc || r?.spec?.vpc || '');
        if (vv !== vpc) return false;
      }
      if (protocol) {
        const p = String(r?.protocol || '');
        if (p !== protocol) return false;
      }
      if (nat) {
        const val = r?.nat ? 'on' : 'off';
        if (val !== nat) return false;
      }
      if (dhcp) {
        const val = r?.allowDhcp ? 'on' : 'off';
        if (val !== dhcp) return false;
      }
      return true;
    });
  }, [subnets, keyword, vpc, protocol, nat, dhcp]);

  return (
    <PageDetailSection
      asCard={false}
      toolbarLeft={(
        <>
          <Input allowClear placeholder="搜索名称" value={keyword} onChange={(e)=> setKeyword(e.target.value)} style={{ width: 240 }} />
          <Select allowClear placeholder="VPC" options={vpcOptions} value={vpc} onChange={(v)=> setVpc(v)} style={{ width: 200 }} />
          <Select allowClear placeholder="协议" options={protocolOptions} value={protocol} onChange={(v)=> setProtocol(v)} style={{ width: 200 }} />
          <Select allowClear placeholder="NAT" options={[{ label:'启用', value:'on' }, { label:'关闭', value:'off' }]} value={nat} onChange={(v)=> setNat(v)} style={{ width: 200 }} />
          <Select allowClear placeholder="DHCP" options={[{ label:'启用', value:'on' }, { label:'关闭', value:'off' }]} value={dhcp} onChange={(v)=> setDhcp(v)} style={{ width: 200 }} />
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
          { title: 'VPC', key: 'vpc', render: (_:any, r:any)=> r?.vpc || r?.spec?.vpc || '-' },
          { title: 'CIDR', key: 'cidr', render: (_:any, r:any)=> r?.cidr || r?.spec?.cidr || r?.spec?.cidrBlock || '-' },
          { title: '网关', key: 'gateway', render: (_:any, r:any)=> r?.gateway || r?.spec?.gateway || '-' },
          { title: '协议', key: 'protocol', render: (_:any, r:any)=> r?.protocol || '-' },
          { title: 'NAT', key: 'nat', render: (_:any, r:any)=> (r?.nat ? <Tag color="blue">启用</Tag> : <Tag>关闭</Tag>) },
          { title: 'DHCP', key: 'dhcp', render: (_:any, r:any)=> (r?.allowDhcp ? <Tag color="blue">启用</Tag> : <Tag>关闭</Tag>) },
          { title: '创建时间', key: 'createdAt', render: (_:any, r:any)=> r?.createdAt || '-' },
        ] as any}
        dataSource={filtered}
        loading={loading}
        pagination={{ showSizeChanger:true, pageSize:10, pageSizeOptions:[10,20,50,100] }}
      />
    </PageDetailSection>
  );
};

export default KubeOvnSubnetsSection;
