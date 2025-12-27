import React, { useEffect, useMemo, useRef, useState } from 'react';
import { App, Button, Dropdown, Input, Select, Table, Space } from 'antd';
import { ReloadOutlined, EllipsisOutlined, ClusterOutlined } from '@ant-design/icons';
import PageDetailSection, { RowActionsButton } from '../../../../components/PageDetailSection';
import ResourceActionsDropdown from '../../../../components/ResourceActionsDropdown';
import { fetchCloudProviderVpcs, deleteCloudProviderVpc } from '../../../../services/api';
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

const VpcSectionAliyun: React.FC<VpcSectionAliyunProps> = ({ cloudId, vpcs, onSetVpcs, onOpenDetail, onOpenCreate, showLog, raw }) => {
  const { message } = App.useApp();
  const [keyword, setKeyword] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [changedIds, setChangedIds] = useState<Set<string>>(new Set());
  const prevRef = useRef<any[]>(Array.isArray(vpcs) ? vpcs : []);
  const [regionFilter, setRegionFilter] = useState<string>('');

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
    { title: '实例名称/ID', key: 'name_id', render: (_: any, r: any) => (<span>{r?.VpcName || r?.name || '-'}<br />{r?.VpcId || r?.id || '-'}</span>), sorter: (a: any, b: any) => {
      const na = String(a?.VpcName || a?.name || '').toLowerCase();
      const nb = String(b?.VpcName || b?.name || '').toLowerCase();
      if (na !== nb) return na.localeCompare(nb);
      const ia = String(a?.VpcId || a?.id || '');
      const ib = String(b?.VpcId || b?.id || '');
      return ia.localeCompare(ib);
    } },
    { title: 'IPv4 CIDR', key: 'cidr', render: (_: any, r: any) => r?.CidrBlock || r?.cidr || '-', sorter: (a: any, b: any) => {
      const ca = String(a?.CidrBlock || a?.cidr || '');
      const cb = String(b?.CidrBlock || b?.cidr || '');
      if (ca !== cb) return ca.localeCompare(cb);
      const ia = String(a?.VpcId || a?.id || '');
      const ib = String(b?.VpcId || b?.id || '');
      return ia.localeCompare(ib);
    } },
    { title: 'IPv6 CIDR', key: 'ipv6', render: (_: any, r: any) => r?.Ipv6CidrBlock || r?.ipv6_cidr || '-', sorter: (a: any, b: any) => {
      const ca = String(a?.Ipv6CidrBlock || a?.ipv6_cidr || '');
      const cb = String(b?.Ipv6CidrBlock || b?.ipv6_cidr || '');
      if (ca !== cb) return ca.localeCompare(cb);
      const ia = String(a?.VpcId || a?.id || '');
      const ib = String(b?.VpcId || b?.id || '');
      return ia.localeCompare(ib);
    } },
    { title: '状态', key: 'status', render: (_: any, r: any) => statusTag(r?.Status || r?.status), sorter: (a: any, b: any) => {
      const sa = String(a?.Status || a?.status || '').toLowerCase();
      const sb = String(b?.Status || b?.status || '').toLowerCase();
      if (sa !== sb) return sa.localeCompare(sb);
      const ia = String(a?.VpcId || a?.id || '');
      const ib = String(b?.VpcId || b?.id || '');
      return ia.localeCompare(ib);
    } },
    { title: '地域', key: 'region', render: (_: any, r: any) => r?.RegionId || r?.region || '-', sorter: (a: any, b: any) => {
      const ra = String(a?.RegionId || a?.region || '').toLowerCase();
      const rb = String(b?.RegionId || b?.region || '').toLowerCase();
      if (ra !== rb) return ra.localeCompare(rb);
      const ia = String(a?.VpcId || a?.id || '');
      const ib = String(b?.VpcId || b?.id || '');
      return ia.localeCompare(ib);
    } },
    { title: '默认', key: 'default', render: (_: any, r: any) => {
      const isDef = String(r?.IsDefault ?? r?.is_default ?? '').toLowerCase();
      return isDef === 'true' || isDef === '1' ? '默认' : '否';
    }, sorter: (a: any, b: any) => {
      const da = String(a?.IsDefault ?? a?.is_default ?? '').toLowerCase();
      const db = String(b?.IsDefault ?? b?.is_default ?? '').toLowerCase();
      const va = (da === 'true' || da === '1') ? 1 : 0;
      const vb = (db === 'true' || db === '1') ? 1 : 0;
      if (va !== vb) return va - vb;
      const ia = String(a?.VpcId || a?.id || '');
      const ib = String(b?.VpcId || b?.id || '');
      return ia.localeCompare(ib);
    } },
    { title: '描述', key: 'desc', render: (_: any, r: any) => r?.Description || r?.description || '-', sorter: (a: any, b: any) => {
      const da = String(a?.Description || a?.description || '').toLowerCase();
      const db = String(b?.Description || b?.description || '').toLowerCase();
      if (da !== db) return da.localeCompare(db);
      const ia = String(a?.VpcId || a?.id || '');
      const ib = String(b?.VpcId || b?.id || '');
      return ia.localeCompare(ib);
    } },
    { title: '创建时间', key: 'created', render: (_: any, r: any) => r?.CreationTime || r?.created || '-', sorter: (a: any, b: any) => {
      const ta = Date.parse(String(a?.CreationTime || a?.created || '')) || 0;
      const tb = Date.parse(String(b?.CreationTime || b?.created || '')) || 0;
      if (ta !== tb) return ta - tb;
      const ia = String(a?.VpcId || a?.id || '');
      const ib = String(b?.VpcId || b?.id || '');
      return ia.localeCompare(ib);
    } },
    { title: '操作', key: 'actions', render: (_: any, r: any) => {
      const items = [
        { key: 'detail', label: '详情' },
        { key: 'del', label: '删除' },
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
              try {
                const id0 = r?.VpcId || r?.id; if (!id0) return;
                await deleteCloudProviderVpc(cloudId, id0);
                const json = await fetchCloudProviderVpcs(cloudId);
                const vpcList: any[] = (json?.data?.vpcs) || (json?.vpcs) || [];
                onSetVpcs(Array.isArray(vpcList) ? vpcList : []);
                message.success('删除成功');
              } catch (e: any) { message.error(e?.message || '删除失败'); }
            }
          }}
        />
      );
    } },
  ]), [cloudId, onOpenDetail, onSetVpcs]);

  return (
    <>
      <PageDetailSection
        title={Label}
        icon={Icon}
        toolbarLeft={(
          <Space size={8}>
            <Input placeholder="请输入关键词" allowClear value={keyword} onChange={(e) => setKeyword(e.target.value)} style={{ width: 220 }} />
            <Select placeholder="选择状态" allowClear value={statusFilter} onChange={setStatusFilter} style={{ width: 160 }} options={[...Array.from(new Set((vpcs || []).map((r: any) => String(r?.Status || r?.status || '').trim()).filter(Boolean))).map(s => ({ label: s, value: s }))]} />
            <Select placeholder="地域" allowClear value={regionFilter} onChange={setRegionFilter} style={{ width: 160 }} options={[...Array.from(new Set((vpcs || []).map((r: any) => String(r?.RegionId || r?.region || '').trim()).filter(Boolean))).map(s => ({ label: s, value: s }))]} />
          </Space>
        )}
        toolbarRight={(
          <Space size={8}>
            {onOpenCreate && (<Button type="primary" onClick={onOpenCreate}>创建VPC</Button>)}
            <Button icon={<ReloadOutlined />} onClick={async () => {
              try {
                const json = await fetchCloudProviderVpcs(cloudId);
                const vpcList: any[] = (json?.data?.vpcs) || (json?.vpcs) || [];
                onSetVpcs(Array.isArray(vpcList) ? vpcList : []);
              } catch (e: any) { message.error(e?.message || '刷新失败'); }
            }}>刷新</Button>
          </Space>
        )}
        asCard={false}
      >
      <style>{`.vpc-row-updated{animation:vpcRowBlink .8s ease-in-out 1;background:#fffbe6}@keyframes vpcRowBlink{0%{background:#fffbe6}50%{background:#fff}}`}</style>
      <Table
        bordered
        tableLayout="auto"
        rowKey={(r: any) => r.VpcId || r.id}
        dataSource={filteredVpcs}
        columns={columns as any}
        pagination={{ pageSize: 10, size: 'default' }}
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
    </>
  );
};

export const Icon = <ClusterOutlined />;
export const Label = 'VPC';
export default VpcSectionAliyun;
