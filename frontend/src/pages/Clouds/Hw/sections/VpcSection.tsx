import React, { useMemo, useState } from 'react';
import { App, Button, Dropdown, Input, Select, Space, Table, Tag } from 'antd';
import { CheckOutlined, CloseOutlined, EditOutlined, MoreOutlined, ReloadOutlined } from '@ant-design/icons';
import { fetchCloudProviderVpcs, updateHuaweiCloudVpc, deleteCloudProviderVpc } from '../../../../services/api';
import SharedToolbar from '../../../../components/SharedToolbar';

type VpcSectionProps = {
  cloudId: string;
  vpcs: any[];
  onSetVpcs: (list: any[]) => void;
  onOpenDetail: (type: string, title: string, data: any) => void;
  onOpenCreate: () => void;
};

const VpcSection: React.FC<VpcSectionProps> = ({ cloudId, vpcs, onSetVpcs, onOpenDetail, onOpenCreate }) => {
  const { message } = App.useApp();
  const [keyword, setKeyword] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [nameEditingId, setNameEditingId] = useState<string | null>(null);
  const [nameEditingValue, setNameEditingValue] = useState<string>('');
  const [descEditingId, setDescEditingId] = useState<string | null>(null);
  const [descEditingValue, setDescEditingValue] = useState<string>('');

  const filteredVpcs = useMemo(() => {
    const list = Array.isArray(vpcs) ? vpcs : [];
    const kw = keyword.trim().toLowerCase();
    return list.filter((r: any) => {
      const n = r?.name || r?.VpcName || r?.vpcName || '';
      const text = `${n} ${r?.id || r?.VpcId || ''} ${r?.cidr || r?.CidrBlock || ''} ${r?.description || r?.Description || ''}`.toLowerCase();
      const okKw = !kw || text.includes(kw);
      const st = String(r?.status || r?.Status || '').toLowerCase();
      const okSt = !statusFilter || st === statusFilter.toLowerCase();
      return okKw && okSt;
    });
  }, [vpcs, keyword, statusFilter]);

  const columns = useMemo(() => ([
    { title: '实例名称/ID', key: 'name_id', render: (_: any, r: any) => {
      const id = r?.id || r?.VpcId || '';
      const isEditing = nameEditingId && String(nameEditingId) === String(id);
      const name = r?.name || r?.VpcName || r?.vpcName || '-';
      if (isEditing) {
        return (
          <div>
            <Space size={4} style={{ whiteSpace: 'nowrap' }}>
              <Input size="small" value={nameEditingValue} onChange={(e) => setNameEditingValue(e.target.value)} style={{ width: 140 }} />
              <Button type="link" size="small" style={{ padding: 0 }} icon={<CheckOutlined />} onClick={async () => {
                const newName = String(nameEditingValue || '').trim();
                if (!newName) { message.warning('请输入名称'); return; }
                try {
                  await updateHuaweiCloudVpc(cloudId, String(id), { name: newName });
                  setNameEditingId(null);
                  setNameEditingValue('');
                  const json = await fetchCloudProviderVpcs(cloudId);
                  const vpcList: any[] = (json?.data?.vpcs) || (json?.vpcs) || [];
                  onSetVpcs(Array.isArray(vpcList) ? vpcList : []);
                  message.success('已更新');
                } catch (e: any) { message.error(e?.message || '更新失败'); }
              }} />
              <Button type="link" size="small" style={{ padding: 0 }} icon={<CloseOutlined />} onClick={() => { setNameEditingId(null); setNameEditingValue(''); }} />
            </Space>
            <div style={{ color: '#888' }}>{id}</div>
          </div>
        );
      }
      return (
        <div>
          <div style={{ whiteSpace: 'nowrap' }}>
            <span>{name}</span>
            <Button type="link" size="small" style={{ padding: 0, marginLeft: 4 }} icon={<EditOutlined />} onClick={() => { setNameEditingId(String(id)); setNameEditingValue(String(name || '')); }} />
          </div>
          <div style={{ color: '#888' }}>{id}</div>
        </div>
      );
    }, sorter: (a: any, b: any) => {
      const an = String(a?.name || a?.VpcName || a?.vpcName || '');
      const bn = String(b?.name || b?.VpcName || b?.vpcName || '');
      const cmp = an.localeCompare(bn);
      if (cmp !== 0) return cmp;
      return String(a?.id || a?.VpcId || '').localeCompare(String(b?.id || b?.VpcId || ''));
    } },
    { title: 'IPv4 CIDR', dataIndex: 'cidr', key: 'cidr', render: (t: string) => t || '-', sorter: (a: any, b: any) => String(a?.cidr || '').localeCompare(String(b?.cidr || '')) },
    { title: '状态', key: 'status', render: (_: any, r: any) => {
      const s = String(r?.status || r?.Status || '').trim();
      const txt = s === 'ACTIVE' || s === 'Available' || s === 'OK' ? '可用'
        : s === 'PENDING_CREATE' || s === 'CREATING' || s === 'BUILDING' ? '创建中'
        : s === 'PENDING_DELETE' || s === 'DELETING' ? '删除中'
        : s === 'ERROR' || s === 'FAILED' ? '错误'
        : s === 'SHUTOFF' || s === 'DOWN' ? '关闭'
        : (s || '-');
      const color = txt === '可用' ? 'green' : txt === '错误' ? 'red' : txt === '删除中' ? 'orange' : 'blue';
      return <Tag color={color}>{txt}</Tag>;
    }, sorter: (a: any, b: any) => String(a?.status || a?.Status || '').localeCompare(String(b?.status || b?.Status || '')) },
    { title: '路由数', key: 'routeCount', render: (_: any, r: any) => Array.isArray(r?.routes) ? String(r.routes.length) : '-', sorter: (a: any, b: any) => (Array.isArray(a?.routes) ? a.routes.length : 0) - (Array.isArray(b?.routes) ? b.routes.length : 0) },
    { title: '地址使用度量开关', dataIndex: 'enable_network_address_usage_metrics', key: 'addr_usage', render: (t: any) => (t === true ? '开启' : t === false ? '关闭' : '-') },
    { title: '描述', key: 'desc', render: (_: any, r: any) => {
      const id = r?.id || r?.VpcId || '';
      const isEditing = descEditingId && String(descEditingId) === String(id);
      const desc = r?.description || r?.Description || '';
      if (isEditing) {
        return (
          <div>
            <Space size={4} style={{ whiteSpace: 'nowrap' }}>
              <Input size="small" value={descEditingValue} onChange={(e) => setDescEditingValue(e.target.value)} style={{ width: 200 }} />
              <Button type="link" size="small" style={{ padding: 0 }} icon={<CheckOutlined />} onClick={async () => {
                const newDesc = String(descEditingValue || '').trim();
                try {
                  await updateHuaweiCloudVpc(cloudId, String(id), { description: newDesc });
                  setDescEditingId(null);
                  setDescEditingValue('');
                  const json = await fetchCloudProviderVpcs(cloudId);
                  const vpcList: any[] = (json?.data?.vpcs) || (json?.vpcs) || [];
                  onSetVpcs(Array.isArray(vpcList) ? vpcList : []);
                  message.success('已更新');
                } catch (e: any) { message.error(e?.message || '更新失败'); }
              }} />
              <Button type="link" size="small" style={{ padding: 0 }} icon={<CloseOutlined />} onClick={() => { setDescEditingId(null); setDescEditingValue(''); }} />
            </Space>
          </div>
        );
      }
      return (
        <div style={{ whiteSpace: 'nowrap' }}>
          <span>{desc || '-'}</span>
        </div>
      );
    }, sorter: (a: any, b: any) => String(a?.description || a?.Description || '').localeCompare(String(b?.description || b?.Description || '')) },
    { title: '创建时间', dataIndex: 'created_at', key: 'ctime', render: (t: string, r: any) => r?.created_at || '-', sorter: (a: any, b: any) => String(a?.created_at || '').localeCompare(String(b?.created_at || '')) },
    { title: '操作', key: 'actions', render: (_: any, r: any) => {
      const items = [
        { key: 'detail', label: '详情' },
        { key: 'del', label: '删除' },
      ];
      return (
        <Dropdown
          menu={{ items, onClick: async ({ key }) => {
            if (key === 'detail') {
              const name = r?.name || r?.VpcName || r?.vpcName || '-';
              const id = r?.id || r?.VpcId || '-';
              onOpenDetail('vpc', `VPC ${name}（${id}）`, r);
              return;
            }
            if (key === 'del') {
              try {
                const id0 = r?.id || r?.VpcId; if (!id0) return;
                await deleteCloudProviderVpc(cloudId, id0);
                const json = await fetchCloudProviderVpcs(cloudId);
                const vpcList: any[] = (json?.data?.vpcs) || (json?.vpcs) || [];
                onSetVpcs(Array.isArray(vpcList) ? vpcList : []);
                message.success('删除成功');
              } catch (e: any) { message.error(e?.message || '删除失败'); }
            }
          } }}
        >
          <Button type="link" icon={<MoreOutlined />} />
        </Dropdown>
      );
    } },
  ]), [cloudId, nameEditingId, nameEditingValue, descEditingId, descEditingValue, onOpenDetail]);

  return (
    <>
      <SharedToolbar
        left={(
          <>
            <Input placeholder="请输入关键词" allowClear value={keyword} onChange={(e) => setKeyword(e.target.value)} style={{ width: 220 }} />
            <Select placeholder="选择状态" allowClear value={statusFilter} onChange={setStatusFilter} style={{ width: 160 }} options={[...Array.from(new Set((vpcs || []).map((r: any) => String(r?.status || r?.Status || '').trim()).filter(Boolean))).map(s => ({ label: s, value: s }))]} />
          </>
        )}
        right={(
          <>
            <Button type="primary" onClick={onOpenCreate}>创建VPC</Button>
            <Dropdown
              menu={{
                items: [{ key: 'refresh', label: '刷新' }],
                onClick: async ({ key }) => {
                  if (key === 'refresh') {
                    try {
                      const json = await fetchCloudProviderVpcs(cloudId);
                      const vpcList: any[] = (json?.data?.vpcs) || (json?.vpcs) || [];
                      onSetVpcs(Array.isArray(vpcList) ? vpcList : []);
                    } catch (e: any) { message.error(e?.message || '刷新失败'); }
                  }
                }
              }}
            >
              <Button icon={<MoreOutlined style={{ transform: 'rotate(90deg)' }} />}>更多</Button>
            </Dropdown>
          </>
        )}
      />
      <Table bordered rowKey={(r: any) => r.id || r.VpcId} dataSource={filteredVpcs} columns={columns as any} pagination={{ pageSize: 10 }} />
    </>
  );
};

export default VpcSection;
