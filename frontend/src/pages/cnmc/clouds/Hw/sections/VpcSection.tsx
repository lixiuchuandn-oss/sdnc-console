import React, { useMemo, useState } from 'react';
import { App, Button, Input, Select, Space, Table, Tag, Tooltip, Typography } from 'antd';
import { CheckOutlined, CloseOutlined, EditOutlined, ClusterOutlined, PlusOutlined, ReloadOutlined, SearchOutlined } from '@ant-design/icons';
import { fetchCloudProviderVpcs, deleteCloudProviderVpc } from '../../../../../services/api';
import { updateHuaweiCloudVpc } from '../../../../../services/huaweiApi';
import PageDetailSection, { RowActionsButton } from '../../../../../components/PageDetailSection';

type VpcSectionProps = {
  cloudId: string;
  vpcs: any[];
  onSetVpcs: (list: any[]) => void;
  onOpenDetail: (type: string, title: string, data: any) => void;
  onOpenCreate: () => void;
};

const parseVpcList = (json: any): any[] => (json?.data?.vpcs) || (json?.vpcs) || [];

const VpcSection: React.FC<VpcSectionProps> = ({ cloudId, vpcs, onSetVpcs, onOpenDetail, onOpenCreate }) => {
  const { message } = App.useApp();
  const [keyword, setKeyword] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<string | undefined>(undefined);
  const [loading, setLoading] = useState<boolean>(false);
  const [nameEditingId, setNameEditingId] = useState<string | null>(null);
  const [nameEditingValue, setNameEditingValue] = useState<string>('');
  const [descEditingId, setDescEditingId] = useState<string | null>(null);
  const [descEditingValue, setDescEditingValue] = useState<string>('');

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
      const n = r?.name || r?.VpcName || r?.vpcName || '';
      const text = `${n} ${r?.id || r?.VpcId || ''} ${r?.cidr || r?.CidrBlock || ''} ${r?.description || r?.Description || ''}`.toLowerCase();
      const okKw = !kw || text.includes(kw);
      const st = String(r?.status || r?.Status || '').toLowerCase();
      const okSt = !statusFilter || st === statusFilter.toLowerCase();
      return okKw && okSt;
    });
  }, [vpcs, keyword, statusFilter]);

  const columns = useMemo(() => ([
    {
      title: '名称/ID', key: 'name_id', fixed: 'left' as const, width: 260,
      sorter: (a: any, b: any) => String(a?.name || a?.VpcName || '').localeCompare(String(b?.name || b?.VpcName || '')),
      render: (_: any, r: any) => {
        const id = r?.id || r?.VpcId || '';
        const isEditing = nameEditingId && String(nameEditingId) === String(id);
        const name = r?.name || r?.VpcName || r?.vpcName || '-';
        if (isEditing) {
          return (
            <Space direction="vertical" size={0} style={{ width: '100%' }}>
              <Space size={4}>
                <Input size="small" value={nameEditingValue} onChange={(e) => setNameEditingValue(e.target.value)} style={{ width: 140 }} />
                <Button type="link" size="small" style={{ padding: 0 }} icon={<CheckOutlined />} onClick={async () => {
                  const newName = String(nameEditingValue || '').trim();
                  if (!newName) { message.warning('请输入名称'); return; }
                  try { await updateHuaweiCloudVpc(cloudId, String(id), { name: newName }); setNameEditingId(null); setNameEditingValue(''); await refresh(); message.success('已更新'); } catch (e: any) { message.error(e?.message || '更新失败'); }
                }} />
                <Button type="link" size="small" style={{ padding: 0 }} icon={<CloseOutlined />} onClick={() => { setNameEditingId(null); setNameEditingValue(''); }} />
              </Space>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>{id}</Typography.Text>
            </Space>
          );
        }
        return (
          <Space direction="vertical" size={0} style={{ width: '100%' }}>
            <Space size={4}>
              <Typography.Text strong ellipsis={{ tooltip: name }}>{name}</Typography.Text>
              <Button type="link" size="small" style={{ padding: 0 }} icon={<EditOutlined />} onClick={() => { setNameEditingId(String(id)); setNameEditingValue(String(name || '')); }} />
            </Space>
            <Typography.Text type="secondary" style={{ fontSize: 12 }} copyable={id ? { text: id } : false}>{id || '-'}</Typography.Text>
          </Space>
        );
      },
    },
    { title: 'IPv4 CIDR', dataIndex: 'cidr', key: 'cidr', width: 160, render: (t: string) => t || '-' },
    {
      title: '状态', key: 'status', width: 110,
      render: (_: any, r: any) => {
        const s = String(r?.status || r?.Status || '').trim();
        const txt = s === 'ACTIVE' || s === 'Available' || s === 'OK' ? '可用'
          : s === 'PENDING_CREATE' || s === 'CREATING' || s === 'BUILDING' ? '创建中'
          : s === 'PENDING_DELETE' || s === 'DELETING' ? '删除中'
          : s === 'ERROR' || s === 'FAILED' ? '错误'
          : s === 'SHUTOFF' || s === 'DOWN' ? '关闭'
          : (s || '-');
        const color = txt === '可用' ? 'green' : txt === '错误' ? 'red' : txt === '删除中' ? 'orange' : 'blue';
        return <Tag color={color}>{txt}</Tag>;
      },
    },
    { title: '路由数', key: 'routeCount', width: 90, render: (_: any, r: any) => Array.isArray(r?.routes) ? String(r.routes.length) : '-' },
    {
      title: '描述', key: 'desc', ellipsis: true,
      render: (_: any, r: any) => {
        const id = r?.id || r?.VpcId || '';
        const isEditing = descEditingId && String(descEditingId) === String(id);
        const desc = r?.description || r?.Description || '';
        if (isEditing) {
          return (
            <Space size={4}>
              <Input size="small" value={descEditingValue} onChange={(e) => setDescEditingValue(e.target.value)} style={{ width: 200 }} />
              <Button type="link" size="small" style={{ padding: 0 }} icon={<CheckOutlined />} onClick={async () => {
                const newDesc = String(descEditingValue || '').trim();
                try { await updateHuaweiCloudVpc(cloudId, String(id), { description: newDesc }); setDescEditingId(null); setDescEditingValue(''); await refresh(); message.success('已更新'); } catch (e: any) { message.error(e?.message || '更新失败'); }
              }} />
              <Button type="link" size="small" style={{ padding: 0 }} icon={<CloseOutlined />} onClick={() => { setDescEditingId(null); setDescEditingValue(''); }} />
            </Space>
          );
        }
        return (
          <Space size={4}>
            <Typography.Text ellipsis={{ tooltip: desc }}>{desc || '-'}</Typography.Text>
            <Button type="link" size="small" style={{ padding: 0 }} icon={<EditOutlined />} onClick={() => { setDescEditingId(String(id)); setDescEditingValue(String(desc || '')); }} />
          </Space>
        );
      },
    },
    { title: '创建时间', dataIndex: 'created_at', key: 'ctime', width: 170, render: (_: string, r: any) => r?.created_at || '-' },
    {
      title: '操作', key: 'actions', fixed: 'right' as const, width: 80,
      render: (_: any, r: any) => (
        <RowActionsButton
          items={[{ key: 'detail', label: '详情' }, { key: 'del', label: '删除', danger: true }]}
          onClick={async ({ key }: { key: string }) => {
            if (key === 'detail') { const name = r?.name || r?.VpcName || '-'; const id = r?.id || r?.VpcId || '-'; onOpenDetail('vpc', `VPC ${name}（${id}）`, r); return; }
            if (key === 'del') {
              const id0 = r?.id || r?.VpcId; if (!id0) return;
              const { Modal } = await import('antd');
              Modal.confirm({
                title: '确定删除该 VPC?', content: `ID: ${id0}`, okText: '确认删除', okType: 'danger', cancelText: '取消',
                onOk: async () => { try { await deleteCloudProviderVpc(cloudId, id0); message.success('删除成功'); await refresh(); } catch (e: any) { message.error(e?.message || '删除失败'); } },
              });
            }
          }}
        />
      ),
    },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ]), [cloudId, nameEditingId, nameEditingValue, descEditingId, descEditingValue, onOpenDetail]);

  const statusOptions = useMemo(() => Array.from(new Set((vpcs || []).map((r: any) => String(r?.status || r?.Status || '').trim()).filter(Boolean))).map(s => ({ label: s, value: s })), [vpcs]);

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
          <Button type="primary" icon={<PlusOutlined />} onClick={onOpenCreate}>创建 VPC</Button>
          <Tooltip title="刷新"><Button icon={<ReloadOutlined />} loading={loading} onClick={refresh} /></Tooltip>
        </div>
      )}
      asCard={false}
    >
      <Table
        className="std-table"
        bordered={false}
        rowKey={(r: any) => r.id || r.VpcId}
        dataSource={filteredVpcs}
        columns={columns as any}
        loading={loading}
        scroll={{ x: true }}
        pagination={{ size: 'small', showTotal: (total) => `共 ${total} 条` }}
      />
    </PageDetailSection>
  );
};

export const Icon = <ClusterOutlined />;
export const Label = 'VPC';
export default VpcSection;
