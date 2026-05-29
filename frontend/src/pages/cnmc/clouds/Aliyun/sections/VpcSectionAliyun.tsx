import React, { useEffect, useMemo, useRef, useState } from 'react';
import { App, Button, Input, Select, Table, Space, Tooltip, Typography } from 'antd';
import { ReloadOutlined, PlusOutlined, ClusterOutlined, SearchOutlined } from '@ant-design/icons';
import PageDetailSection, { RowActionsButton } from '../../../../../components/PageDetailSection';
import { fetchCloudProviderVpcs, deleteCloudProviderVpc } from '../../../../../services/aliyunApi';
import { statusTag } from '../../Hw/components/Common';

type VpcSectionAliyunProps = {
  cloudId: string;
  vpcs: any[];
  onSetVpcs: (list: any[]) => void;
  onOpenDetail: (type: string, title: string, data: any) => void;
  onOpenCreate?: () => void;
  showLog?: boolean;
  raw?: any;
};

const parseVpcList = (json: any): any[] =>
  (json?.data?.Vpcs?.Vpc) || (json?.Vpcs?.Vpc) || (json?.data?.vpcs) || (json?.vpcs) || [];

const VpcSectionAliyun: React.FC<VpcSectionAliyunProps> = ({ cloudId, vpcs, onSetVpcs, onOpenDetail, onOpenCreate, showLog, raw }) => {
  const { message } = App.useApp();
  const [keyword, setKeyword] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<string | undefined>(undefined);
  const [regionFilter, setRegionFilter] = useState<string | undefined>(undefined);
  const [loading, setLoading] = useState<boolean>(false);
  const [changedIds, setChangedIds] = useState<Set<string>>(new Set());
  const prevRef = useRef<any[]>(Array.isArray(vpcs) ? vpcs : []);

  useEffect(() => {
    try {
      const prev = Array.isArray(prevRef.current) ? prevRef.current : [];
      const curr = Array.isArray(vpcs) ? vpcs : [];
      const prevMap = new Map<string, any>();
      prev.forEach((r: any) => { const id = String(r?.VpcId || r?.id || ''); if (id) prevMap.set(id, r); });
      const changed: string[] = [];
      curr.forEach((r: any) => {
        const id = String(r?.VpcId || r?.id || '');
        const old = id ? prevMap.get(id) : undefined;
        if (old) {
          const stOld = String(old?.Status || old?.status || '');
          const stNew = String(r?.Status || r?.status || '');
          const cidrOld = String(old?.CidrBlock || old?.cidr || '');
          const cidrNew = String(r?.CidrBlock || r?.cidr || '');
          const descOld = String(old?.Description || old?.description || '');
          const descNew = String(r?.Description || r?.description || '');
          if (stOld !== stNew || cidrOld !== cidrNew || descOld !== descNew) changed.push(id);
        }
      });
      setChangedIds(new Set(changed));
      prevRef.current = curr;
      setTimeout(() => setChangedIds(new Set()), 900);
    } catch {}
  }, [vpcs]);

  const refresh = async () => {
    if (!cloudId) return;
    setLoading(true);
    try {
      const json = await fetchCloudProviderVpcs(cloudId);
      onSetVpcs(parseVpcList(json));
    } catch (e: any) { message.error(e?.message || '刷新失败'); }
    finally { setLoading(false); }
  };

  const filteredVpcs = useMemo(() => {
    const list = Array.isArray(vpcs) ? vpcs : [];
    const kw = keyword.trim().toLowerCase();
    return list.filter((r: any) => {
      const n = r?.VpcName || r?.name || '';
      const text = `${n} ${r?.VpcId || r?.id || ''} ${r?.CidrBlock || r?.cidr || ''} ${r?.Description || r?.description || ''}`.toLowerCase();
      const okKw = !kw || text.includes(kw);
      const st = String(r?.Status || r?.status || '').toLowerCase();
      const okSt = !statusFilter || st === statusFilter.toLowerCase();
      const rg = String(r?.RegionId || r?.region || '').toLowerCase();
      const okRg = !regionFilter || rg === regionFilter.toLowerCase();
      return okKw && okSt && okRg;
    });
  }, [vpcs, keyword, statusFilter, regionFilter]);

  const columns = useMemo(() => ([
    {
      title: '名称/ID',
      key: 'name_id',
      fixed: 'left' as const,
      width: 240,
      sorter: (a: any, b: any) => String(a?.VpcName || a?.name || '').localeCompare(String(b?.VpcName || b?.name || '')),
      render: (_: any, r: any) => {
        const name = r?.VpcName || r?.name || '-';
        const id = r?.VpcId || r?.id || '-';
        return (
          <Space direction="vertical" size={0} style={{ width: '100%' }}>
            <Typography.Text strong ellipsis={{ tooltip: name }}>{name}</Typography.Text>
            <Typography.Text type="secondary" style={{ fontSize: 12 }} copyable={id !== '-' ? { text: id } : false}>{id}</Typography.Text>
          </Space>
        );
      },
    },
    { title: 'IPv4 CIDR', key: 'cidr', width: 160, render: (_: any, r: any) => r?.CidrBlock || r?.cidr || '-' },
    { title: 'IPv6 CIDR', key: 'ipv6', width: 200, render: (_: any, r: any) => r?.Ipv6CidrBlock || r?.ipv6_cidr || '-' },
    { title: '状态', key: 'status', width: 110, render: (_: any, r: any) => statusTag(r?.Status || r?.status) },
    { title: '地域', key: 'region', width: 130, render: (_: any, r: any) => r?.RegionId || r?.region || '-' },
    {
      title: '默认', key: 'default', width: 80, render: (_: any, r: any) => {
        const isDef = String(r?.IsDefault ?? r?.is_default ?? '').toLowerCase();
        return isDef === 'true' || isDef === '1' ? '默认' : '否';
      },
    },
    {
      title: '描述', key: 'desc', ellipsis: true,
      render: (_: any, r: any) => r?.Description || r?.description || '-',
    },
    {
      title: '创建时间', key: 'created', width: 170,
      sorter: (a: any, b: any) => (Date.parse(String(a?.CreationTime || a?.created || '')) || 0) - (Date.parse(String(b?.CreationTime || b?.created || '')) || 0),
      render: (_: any, r: any) => {
        const t = r?.CreationTime || r?.created;
        if (!t) return '-';
        try { return new Date(t).toLocaleString('zh-CN', { hour12: false }); } catch { return t; }
      },
    },
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
                const name = r?.VpcName || r?.name || '-';
                const id = r?.VpcId || r?.id || '-';
                onOpenDetail('vpc', `VPC ${name}（${id}）`, r);
                return;
              }
              if (key === 'del') {
                const { Modal } = await import('antd');
                const id0 = r?.VpcId || r?.id; if (!id0) return;
                Modal.confirm({
                  title: '确定删除该 VPC?',
                  content: `ID: ${id0}`,
                  okText: '确认删除', okType: 'danger', cancelText: '取消',
                  onOk: async () => {
                    try {
                      await deleteCloudProviderVpc(cloudId, id0);
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
  ]), [cloudId, onOpenDetail]);

  const statusOptions = useMemo(() => Array.from(new Set((vpcs || []).map((r: any) => String(r?.Status || r?.status || '').trim()).filter(Boolean))).map(s => ({ label: s, value: s })), [vpcs]);
  const regionOptions = useMemo(() => Array.from(new Set((vpcs || []).map((r: any) => String(r?.RegionId || r?.region || '').trim()).filter(Boolean))).map(s => ({ label: s, value: s })), [vpcs]);

  return (
    <PageDetailSection
      title={Label}
      icon={Icon}
      toolbarLeft={(
        <>
          <Input className="toolbar-search" prefix={<SearchOutlined style={{ color: 'rgba(0,0,0,.45)' }} />} placeholder="名称 / ID / CIDR" allowClear value={keyword} onChange={(e) => setKeyword(e.target.value)} />
          <Select className="toolbar-filter-sm" placeholder="状态" allowClear value={statusFilter} onChange={setStatusFilter} options={statusOptions} dropdownMatchSelectWidth={false} />
          <Select className="toolbar-filter-sm" placeholder="地域" allowClear value={regionFilter} onChange={setRegionFilter} options={regionOptions} dropdownMatchSelectWidth={false} />
          <button type="button" className="toolbar-reset-btn" onClick={() => { setKeyword(''); setStatusFilter(undefined); setRegionFilter(undefined); }}>重置</button>
        </>
      )}
      toolbarRight={(
        <div className="toolbar-actions">
          {onOpenCreate && (<Button type="primary" icon={<PlusOutlined />} onClick={onOpenCreate}>创建 VPC</Button>)}
          <Tooltip title="刷新"><Button icon={<ReloadOutlined />} loading={loading} onClick={refresh} /></Tooltip>
        </div>
      )}
      asCard={false}
    >
      <style>{`.vpc-row-updated{animation:vpcRowBlink .8s ease-in-out 1;background:#fffbe6}@keyframes vpcRowBlink{0%{background:#fffbe6}50%{background:#fff}}`}</style>
      <Table
        className="std-table"
        bordered={false}
        rowKey={(r: any) => r.VpcId || r.id}
        dataSource={filteredVpcs}
        columns={columns as any}
        loading={loading}
        scroll={{ x: true }}
        pagination={{
          size: 'small',
          showTotal: (total) => `共 ${total} 条`,
        }}
        rowClassName={(r: any) => {
          const id = String(r?.VpcId || r?.id || '');
          return changedIds.has(id) ? 'vpc-row-updated' : '';
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

export const Icon = <ClusterOutlined />;
export const Label = 'VPC';
export default VpcSectionAliyun;
