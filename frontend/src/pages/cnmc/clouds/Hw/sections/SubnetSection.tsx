import React, { useMemo, useState } from 'react';
import { App, Button, Input, Modal, Select, Space, Table, Tooltip, Typography } from 'antd';
import { NodeIndexOutlined, PlusOutlined, ReloadOutlined, SearchOutlined } from '@ant-design/icons';
import { fetchCloudProviderSubnets, deleteCloudProviderSubnet } from '../../../../../services/api';
import { statusTag } from '../components/Common';
import PageDetailSection, { RowActionsButton } from '../../../../../components/PageDetailSection';

type SubnetSectionProps = {
  cloudId: string;
  subnets: any[];
  vpcs: any[];
  onSetSubnets: (list: any[]) => void;
  onOpenDetail: (type: string, title: string, data: any) => void;
  onOpenCreate: () => void;
  onOpenEdit?: (subnet: any) => void;
};

const parseSubnetList = (json: any): any[] => (json?.data?.subnets) || (json?.subnets) || [];

const SubnetSection: React.FC<SubnetSectionProps> = ({ cloudId, subnets, vpcs, onSetSubnets, onOpenDetail, onOpenCreate, onOpenEdit }) => {
  const { message } = App.useApp();
  const [keyword, setKeyword] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<string | undefined>(undefined);
  const [loading, setLoading] = useState<boolean>(false);

  const refresh = async () => {
    if (!cloudId) return;
    setLoading(true);
    try {
      const json = await fetchCloudProviderSubnets(cloudId);
      onSetSubnets(parseSubnetList(json));
    } catch (e: any) { message.error(e?.message || '刷新失败'); }
    finally { setLoading(false); }
  };

  const filteredSubnets = useMemo(() => {
    const list = Array.isArray(subnets) ? subnets : [];
    const kw = keyword.trim().toLowerCase();
    return list.filter((r: any) => {
      const text = `${r?.name || ''} ${r?.id || ''} ${r?.cidr || ''} ${r?.vpc_id || ''}`.toLowerCase();
      const okKw = !kw || text.includes(kw);
      const st = String(r?.status || r?.Status || '').toLowerCase();
      const okSt = !statusFilter || st === statusFilter.toLowerCase();
      return okKw && okSt;
    });
  }, [subnets, keyword, statusFilter]);

  const columns = useMemo(() => ([
    {
      title: '名称/ID', key: 'name_id', fixed: 'left' as const, width: 240,
      sorter: (a: any, b: any) => String(a?.name || '').localeCompare(String(b?.name || '')),
      render: (_: any, r: any) => {
        const name = r?.name || '-';
        const id = r?.id || r?.VSwitchId || r?.SubnetId || '-';
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
        const cidr = r?.cidr || '-';
        const gw = r?.gateway_ip || r?.GatewayIp || '';
        return (
          <Space direction="vertical" size={0}>
            <Typography.Text>{cidr}</Typography.Text>
            {gw && <Typography.Text type="secondary" style={{ fontSize: 12 }}>网关 {gw}</Typography.Text>}
          </Space>
        );
      },
    },
    {
      title: '所属 VPC', key: 'vpc', width: 220,
      render: (_: any, r: any) => {
        const vid = r?.vpc_id || '';
        const vname = (vpcs || []).find((v: any) => String(v?.id || v?.VpcId || '') === String(vid || ''))?.name || '';
        return (
          <Space direction="vertical" size={0}>
            {vname && <Typography.Text ellipsis={{ tooltip: vname }}>{vname}</Typography.Text>}
            <Typography.Text type="secondary" style={{ fontSize: 12 }} copyable={vid ? { text: vid } : false}>{vid || '-'}</Typography.Text>
          </Space>
        );
      },
    },
    { title: '状态', dataIndex: 'status', key: 'status', width: 110, render: (s: string) => statusTag(s) },
    { title: '可用 IP', dataIndex: 'available_ip_address_count', key: 'avail_ips', width: 100, render: (t: any) => (t != null ? `${t} 个` : '-') },
    {
      title: '创建时间', key: 'ctime', width: 170,
      render: (_: any, r: any) => {
        const c = r?.created_at || r?.createdAt || '';
        if (!c) return '-';
        try { const d = new Date(c); if (!isNaN(d.getTime())) return d.toLocaleString('zh-CN', { hour12: false }); } catch {}
        return c;
      },
    },
    {
      title: '操作', key: 'actions', fixed: 'right' as const, width: 80,
      render: (_: any, r: any) => {
        const items: any[] = [{ key: 'detail', label: '详情' }];
        if (onOpenEdit) items.push({ key: 'edit', label: '编辑' });
        items.push({ key: 'del', label: '删除', danger: true });
        return (
          <RowActionsButton
            items={items}
            onClick={async ({ key }: { key: string }) => {
              if (key === 'detail') { const name = r?.name || '-'; const id = r?.id || r?.SubnetId || '-'; onOpenDetail('subnet', `子网 ${name}（${id}）`, r); return; }
              if (key === 'edit') { onOpenEdit?.(r); return; }
              if (key === 'del') {
                const id0 = r?.id || r?.SubnetId; if (!id0) return;
                Modal.confirm({
                  title: '确定删除该子网?', content: `ID: ${id0}`, okText: '确认删除', okType: 'danger', cancelText: '取消',
                  onOk: async () => { try { await deleteCloudProviderSubnet(cloudId, id0); message.success('删除成功'); await refresh(); } catch (e: any) { message.error(e?.message || '删除失败'); } },
                });
              }
            }}
          />
        );
      },
    },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ]), [cloudId, vpcs, onOpenDetail, onOpenEdit]);

  const statusOptions = useMemo(() => Array.from(new Set((subnets || []).map((r: any) => String(r?.status || r?.Status || '').trim()).filter(Boolean))).map(s => ({ label: s, value: s })), [subnets]);

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
          <Button type="primary" icon={<PlusOutlined />} onClick={onOpenCreate}>创建子网</Button>
          <Tooltip title="刷新"><Button icon={<ReloadOutlined />} loading={loading} onClick={refresh} /></Tooltip>
        </div>
      )}
      asCard={false}
    >
      <Table
        className="std-table"
        bordered={false}
        rowKey={(r: any) => r.id || r.VSwitchId}
        dataSource={filteredSubnets}
        columns={columns as any}
        loading={loading}
        scroll={{ x: true }}
        pagination={{ size: 'small', showTotal: (total) => `共 ${total} 条` }}
      />
    </PageDetailSection>
  );
};

export const Icon = <NodeIndexOutlined />;
export const Label = '子网';
export default SubnetSection;
