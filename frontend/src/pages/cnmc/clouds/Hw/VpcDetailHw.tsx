import React from 'react';
import { Button, Descriptions, Table, Tabs } from 'antd';
import { NodeIndexOutlined, CloudServerOutlined } from '@ant-design/icons';
import { statusTag, collectIpv4FromAddresses } from './components/Common';

type VpcDetailHwProps = {
  cloudId: string;
  vpc: any;
  vpcs: any[];
  subnets: any[];
  routeTables: any[];
  ecs: any[];
  onOpenVmDetail: (vm: any) => void;
};

const VpcDetailHw: React.FC<VpcDetailHwProps> = ({ vpc, subnets, routeTables, ecs, onOpenVmDetail }) => {
  const vpcId = String(vpc?.id || vpc?.VpcId || '');

  const subnetColumns = [
    { title: '名称', dataIndex: 'name', key: 'name' },
    { title: 'ID', dataIndex: 'id', key: 'id' },
    { title: 'CIDR', dataIndex: 'cidr', key: 'cidr' },
    { title: '可用区', dataIndex: 'availability_zone', key: 'zone', render: (_: any, r: any) => r?.availability_zone || r?.zone || r?.ZoneId || '-' },
    { title: '状态', dataIndex: 'status', key: 'status', render: (s: string) => statusTag(s) },
  ] as any;

  const routeTableColumns = [
    { title: '名称/ID', key: 'name_id', render: (_: any, r: any) => (<span>{r?.name || '-'}<br />{r?.id || '-'}</span>) },
    { title: '默认路由表', key: 'is_default', render: (_: any, r: any) => ((r?.is_default === true || r?._default === true || r?.default === true) ? '是' : '否') },
    { title: '关联子网', key: 'assoc_subnets', render: (_: any, r: any) => {
      const list: any[] = Array.isArray(r?.subnets) ? r?.subnets : [];
      const ids = list.map((x: any) => x?.id || x?.SubnetId || '').filter(Boolean);
      const cnt = ids.length;
      return (<span>{`关联 ${cnt} 个`}</span>);
    } },
  ] as any;

  const _sgColumns = [
    { title: '名称', dataIndex: 'name', key: 'name' },
    { title: 'ID', dataIndex: 'id', key: 'id' },
    { title: '描述', dataIndex: 'description', key: 'desc' },
  ] as any;

  const refsColumns = [
    { title: '实例ID', key: 'id', render: (_: any, r: any) => (r?.id || r?.InstanceId || '-') },
    { title: '实例名', key: 'name', render: (_: any, r: any) => (r?.name || r?.InstanceName || '-') },
    { title: '状态', key: 'status', render: (_: any, r: any) => (r?.status || r?.Status || '-') },
    { title: '私网IP', key: 'pri', render: (_: any, r: any) => { const { fixed } = collectIpv4FromAddresses(r?.addresses); return fixed.length ? fixed.join(', ') : '-'; } },
    { title: '操作', key: 'op', render: (_: any, r: any) => (
      <Button type="link" onClick={() => onOpenVmDetail(r)}>详情</Button>
    ) },
  ] as any;

  return (
    <>
      <div style={{ marginBottom: 12 }}>
        <Descriptions bordered size="small" column={2}>
          <Descriptions.Item label="VPC 名称">{vpc?.name || vpc?.VpcName || '-'}</Descriptions.Item>
          <Descriptions.Item label="VPC ID">{vpc?.id || vpc?.VpcId || '-'}</Descriptions.Item>
          <Descriptions.Item label="IPv4 CIDR">{vpc?.cidr || vpc?.CidrBlock || '-'}</Descriptions.Item>
          <Descriptions.Item label="IPv6 CIDR">{vpc?.ipv6_cidr || vpc?.Ipv6CidrBlock || '-'}</Descriptions.Item>
          <Descriptions.Item label="状态">{statusTag(vpc?.status || vpc?.Status)}</Descriptions.Item>
          <Descriptions.Item label="标签" span={2}>{(() => { const tags = vpc?.tags; const pairs: string[] = []; if (Array.isArray(tags)) { for (const t of tags){ const k = t?.key ?? t?.Key; const v = t?.value ?? t?.Value; if (k != null && v != null) pairs.push(`${k}=${v}`); } } else if (tags && typeof tags === 'object'){ for (const k of Object.keys(tags)){ const v = (tags as any)[k]; if (v != null) pairs.push(`${k}=${v}`); } } return pairs.length ? pairs.join('；') : '-'; })()}</Descriptions.Item>
          <Descriptions.Item label="创建时间">{vpc?.created_at || vpc?.createdAt || '-'}</Descriptions.Item>
          <Descriptions.Item label="更新时间">{vpc?.updated_at || vpc?.updatedAt || '-'}</Descriptions.Item>
        </Descriptions>
      </div>
      <Tabs
        defaultActiveKey="subnets"
        items={[
          {
            key: 'subnets',
            label: (<span><NodeIndexOutlined style={{ marginRight: 6 }} />子网</span>),
            children: (
              <Table
                size="small"
                rowKey={(r: any) => r.id}
                columns={subnetColumns}
                dataSource={(subnets || []).filter((s: any) => String(s?.vpc_id || s?.VpcId || '') === vpcId)}
                pagination={false}
              />
            )
          },
          {
            key: 'routeTables',
            label: (<span><NodeIndexOutlined style={{ marginRight: 6 }} />路由表</span>),
            children: (
              <Table
                size="small"
                rowKey={(r: any) => r.id}
                columns={routeTableColumns}
                dataSource={(routeTables || []).filter((rt: any) => String(rt?.vpc_id || '') === vpcId)}
                pagination={false}
              />
            )
          },
          {
            key: 'ecs',
            label: (<span><CloudServerOutlined style={{ marginRight: 6 }} />云主机</span>),
            children: (
              <Table
                size="small"
                rowKey={(r: any) => r.id}
                columns={refsColumns}
                dataSource={(() => { const out: any[] = []; const seen = new Set<string>(); for (const s of (ecs || [])) { const sid = String(s?.id || s?.InstanceId || ''); const vid = String(s?.VpcId || ''); if (vid && vid === vpcId && sid && !seen.has(sid)) { seen.add(sid); out.push(s); } } return out; })()}
                pagination={false}
              />
            )
          }
        ]}
      />
    </>
  );
};

export default VpcDetailHw;