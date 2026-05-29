import React, { useMemo, useState } from 'react';
import { App, Button, Input, Select, Table, Space, Tooltip, Typography } from 'antd';
import { NodeIndexOutlined, PlusOutlined, ReloadOutlined, SearchOutlined } from '@ant-design/icons';
import PageDetailSection, { RowActionsButton } from '../../../../../components/PageDetailSection';
import { fetchCloudProviderVSwitches, deleteCloudProviderVSwitch } from '../../../../../services/aliyunApi';
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

const parseVSwitchList = (json: any): any[] =>
  (json?.data?.VSwitches?.VSwitch) || (json?.VSwitches?.VSwitch) || (json?.data?.vswitches) || (json?.vswitches) || (json?.data?.subnets) || (json?.subnets) || [];

const VSwitchSectionAliyun: React.FC<VSwitchSectionAliyunProps> = ({ cloudId, vswitches, vpcs, onSetVSwitches, onOpenDetail, onOpenCreate, showLog, raw }) => {
  const { message } = App.useApp();
  const [keyword, setKeyword] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<string | undefined>(undefined);
  const [loading, setLoading] = useState<boolean>(false);

  const refresh = async () => {
    if (!cloudId) return;
    setLoading(true);
    try {
      const json = await fetchCloudProviderVSwitches(cloudId);
      onSetVSwitches(parseVSwitchList(json));
    } catch (e: any) { message.error(e?.message || '刷新失败'); }
    finally { setLoading(false); }
  };

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
    {
      title: '名称/ID', key: 'name_id', fixed: 'left' as const, width: 240,
      sorter: (a: any, b: any) => String(a?.VSwitchName || a?.name || '').localeCompare(String(b?.VSwitchName || b?.name || '')),
      render: (_: any, r: any) => {
        const name = r?.VSwitchName || r?.name || '-';
        const id = r?.VSwitchId || r?.id || '-';
        return (
          <Space direction="vertical" size={0} style={{ width: '100%' }}>
            <Typography.Text strong ellipsis={{ tooltip: name }}>{name}</Typography.Text>
            <Typography.Text type="secondary" style={{ fontSize: 12 }} copyable={id !== '-' ? { text: id } : false}>{id}</Typography.Text>
          </Space>
        );
      },
    },
    {
      title: 'CIDR / 网关', key: 'cidr_gw', width: 220,
      render: (_: any, r: any) => {
        const cidr = r?.CidrBlock || r?.cidr || '-';
        const gw = r?.GatewayIp || r?.gateway_ip || '';
        return (
          <Space direction="vertical" size={0}>
            <Typography.Text>{cidr || '-'}</Typography.Text>
            {gw && <Typography.Text type="secondary" style={{ fontSize: 12 }}>网关 {gw}</Typography.Text>}
          </Space>
        );
      },
    },
    { title: '可用区', key: 'zone', width: 130, render: (_: any, r: any) => r?.ZoneId || r?.zone || '-' },
    {
      title: '所属 VPC', key: 'vpc', width: 220,
      render: (_: any, r: any) => {
        const vid = r?.VpcId || r?.vpc_id || '';
        const hit = (vpcs || []).find((v: any) => String(v?.VpcId || v?.id || '') === String(vid || ''));
        const vname = hit?.VpcName || hit?.name || '';
        return vid ? (
          <Space direction="vertical" size={0}>
            {vname && <Typography.Text ellipsis={{ tooltip: vname }}>{vname}</Typography.Text>}
            <Typography.Text type="secondary" style={{ fontSize: 12 }} copyable={{ text: vid }} ellipsis={{ tooltip: vid }}>{vid}</Typography.Text>
          </Space>
        ) : '-';
      },
    },
    { title: '状态', key: 'status', width: 110, render: (_: any, r: any) => statusTag(r?.Status || r?.status) },
    {
      title: '操作', key: 'actions', fixed: 'right' as const, width: 80,
      render: (_: any, r: any) => {
        const items = [
          { key: 'detail', label: '详情' },
          { key: 'del', label: '删除', danger: true },
        ];
        return (
          <RowActionsButton
            items={items}
            onClick={async ({ key }: { key: string }) => {
              if (key === 'detail') {
                const name = r?.VSwitchName || r?.name || '-';
                const id = r?.VSwitchId || r?.id || '-';
                onOpenDetail('vswitch', `交换机 ${name}（${id}）`, r);
                return;
              }
              if (key === 'del') {
                const { Modal } = await import('antd');
                const id0 = r?.VSwitchId || r?.id; if (!id0) return;
                Modal.confirm({
                  title: '确定删除该交换机?',
                  content: `ID: ${id0}`,
                  okText: '确认删除', okType: 'danger', cancelText: '取消',
                  onOk: async () => {
                    try {
                      await deleteCloudProviderVSwitch(cloudId, id0);
                      message.success('删除成功');
                      await refresh();
                    } catch (e: any) { message.error(e?.message || '删除失败'); }
                  },
                });
              }
            }}
          />
        );
      },
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ]), [cloudId, vpcs, onOpenDetail]);

  const statusOptions = useMemo(() => Array.from(new Set((vswitches || []).map((r: any) => String(r?.Status || r?.status || '').trim()).filter(Boolean))).map(s => ({ label: s, value: s })), [vswitches]);

  return (
    <PageDetailSection
      title={Label}
      icon={Icon}
      toolbarLeft={(
        <>
          <Input className="toolbar-search" prefix={<SearchOutlined style={{ color: 'rgba(0,0,0,.45)' }} />} placeholder="名称 / ID / CIDR" allowClear value={keyword} onChange={(e) => setKeyword(e.target.value)} />
          <Select className="toolbar-filter-sm" placeholder="状态" allowClear value={statusFilter} onChange={setStatusFilter} options={statusOptions} dropdownMatchSelectWidth={false} />
          <button type="button" className="toolbar-reset-btn" onClick={() => { setKeyword(''); setStatusFilter(undefined); }}>重置</button>
        </>
      )}
      toolbarRight={(
        <div className="toolbar-actions">
          {onOpenCreate && (<Button type="primary" icon={<PlusOutlined />} onClick={onOpenCreate}>创建交换机</Button>)}
          <Tooltip title="刷新"><Button icon={<ReloadOutlined />} loading={loading} onClick={refresh} /></Tooltip>
        </div>
      )}
      asCard={false}
    >
      <Table
        className="std-table"
        bordered={false}
        rowKey={(r: any) => r.VSwitchId || r.id}
        dataSource={filteredVsw}
        columns={columns as any}
        loading={loading}
        scroll={{ x: true }}
        pagination={{
          size: 'small',
          showTotal: (total) => `共 ${total} 条`,
        }}
      />
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
