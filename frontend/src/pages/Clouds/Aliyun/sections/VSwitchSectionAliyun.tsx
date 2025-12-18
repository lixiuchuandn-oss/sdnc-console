import React, { useMemo, useState } from 'react';
import { App, Button, Dropdown, Input, Select, Table } from 'antd';
import { MoreOutlined, NodeIndexOutlined } from '@ant-design/icons';
import PageDetailSection from '../../../../components/PageDetailSection';
import { fetchCloudProviderVSwitches, deleteCloudProviderVSwitch } from '../../../../services/api';
import { statusTag } from '../../Hw/components/Common';

type VSwitchSectionAliyunProps = {
  cloudId: string;
  vswitches: any[];
  vpcs: any[];
  onSetVSwitches: (list: any[]) => void;
  onOpenDetail: (type: string, title: string, data: any) => void;
  onOpenCreate?: () => void;
  showLog?: boolean;
  raw?: any;
};

const VSwitchSectionAliyun: React.FC<VSwitchSectionAliyunProps> = ({ cloudId, vswitches, vpcs, onSetVSwitches, onOpenDetail, onOpenCreate, showLog, raw }) => {
  const { message } = App.useApp();
  const [keyword, setKeyword] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<string>('');

  const filteredVsw = useMemo(() => {
    const list = Array.isArray(vswitches) ? vswitches : [];
    const kw = keyword.trim().toLowerCase();
    return list.filter((r: any) => {
      const text = `${r?.VSwitchName || r?.name || ''} ${r?.VSwitchId || r?.id || ''} ${r?.CidrBlock || r?.cidr || ''} ${r?.VpcId || r?.vpc_id || ''}`.toLowerCase();
      const okKw = !kw || text.includes(kw);
      const st = String(r?.Status || r?.status || '').toLowerCase();
      const okSt = !statusFilter || st === statusFilter.toLowerCase();
      return okKw && okSt;
    });
  }, [vswitches, keyword, statusFilter]);

  const columns = useMemo(() => ([
    { title: '名称/ID', key: 'name_id', render: (_: any, r: any) => (<span>{r?.VSwitchName || r?.name || '-'}<br />{r?.VSwitchId || r?.id || '-'}</span>) },
    { title: 'CIDR/网关', key: 'cidr_gw', render: (_: any, r: any) => { const cidr = r?.CidrBlock || r?.cidr || '-'; const gw = r?.GatewayIp || r?.gateway_ip || ''; return gw ? `${cidr}（网关: ${gw}）` : String(cidr || '-'); } },
    { title: '所属VPC', key: 'vpc', render: (_: any, r: any) => { const vid = r?.VpcId || r?.vpc_id || ''; const vname = (vpcs || []).find((v: any) => String(v?.VpcId || v?.id || '') === String(vid || ''))?.VpcName || (vpcs || []).find((v: any) => String(v?.VpcId || v?.id || '') === String(vid || ''))?.name || '-'; return (<span>{vname}<br />{vid || '-'}</span>); } },
    { title: '状态', key: 'status', render: (_: any, r: any) => statusTag(r?.Status || r?.status) },
    { title: '操作', key: 'actions', render: (_: any, r: any) => {
      const items = [
        { key: 'detail', label: '详情' },
        { key: 'del', label: '删除' },
      ];
      return (
        <Dropdown
          menu={{ items, onClick: async ({ key }) => {
            if (key === 'detail') {
              const name = r?.VSwitchName || r?.name || '-';
              const id = r?.VSwitchId || r?.id || '-';
              onOpenDetail('vswitch', `交换机 ${name}（${id}）`, r);
              return;
            }
            if (key === 'del') {
              try {
                const id0 = r?.VSwitchId || r?.id; if (!id0) return;
                await deleteCloudProviderVSwitch(cloudId, id0);
                const json = await fetchCloudProviderVSwitches(cloudId);
                const vswList: any[] = (json?.data?.vswitches) || (json?.vswitches) || (json?.data?.subnets) || (json?.subnets) || [];
                onSetVSwitches(Array.isArray(vswList) ? vswList : []);
                message.success('删除成功');
              } catch (e: any) { message.error(e?.message || '删除失败'); }
            }
          } }}
        >
          <Button type="link" icon={<MoreOutlined />} />
        </Dropdown>
      );
    } },
  ]), [cloudId, vpcs, onOpenDetail, onSetVSwitches]);

  return (
    <PageDetailSection
      title={Label}
      icon={Icon}
      toolbarLeft={(
        <>
          <Input placeholder="请输入关键词" allowClear value={keyword} onChange={(e) => setKeyword(e.target.value)} style={{ width: 220 }} />
          <Select placeholder="选择状态" allowClear value={statusFilter} onChange={setStatusFilter} style={{ width: 160 }} options={[...Array.from(new Set((vswitches || []).map((r: any) => String(r?.Status || r?.status || '').trim()).filter(Boolean))).map(s => ({ label: s, value: s }))]} />
        </>
      )}
      toolbarRight={(
        <>
          {onOpenCreate && (<Button type="primary" onClick={onOpenCreate}>创建交换机</Button>)}
          <Dropdown
            menu={{
              items: [{ key: 'refresh', label: '刷新' }],
              onClick: async ({ key }) => {
                if (key === 'refresh') {
                  try {
                    const json = await fetchCloudProviderVSwitches(cloudId);
                    const vswList: any[] = (json?.data?.vswitches) || (json?.vswitches) || (json?.data?.subnets) || (json?.subnets) || [];
                    onSetVSwitches(Array.isArray(vswList) ? vswList : []);
                  } catch (e: any) { message.error(e?.message || '刷新失败'); }
                }
              }
            }}
          >
            <Button icon={<MoreOutlined style={{ transform: 'rotate(90deg)' }} />}>更多</Button>
          </Dropdown>
        </>
      )}
      asCard={false}
    >
      <Table rowKey={(r: any) => r.VSwitchId || r.id} dataSource={filteredVsw} columns={columns as any} pagination={{ pageSize: 10 }} />
      {!!showLog && (
        <div style={{ marginTop: 12 }}>
          <pre style={{ background:'#f7f7f7', padding:12, borderRadius:8, maxHeight:300, overflow:'auto' }}>{JSON.stringify(raw, null, 2)}</pre>
        </div>
      )}
    </PageDetailSection>
  );
};

export const Icon = <NodeIndexOutlined />;
export const Label = '交换机';
export default VSwitchSectionAliyun;
