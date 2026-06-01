import React, { useMemo, useState } from 'react';
import { App, Button, Input, Modal, Select, Space, Table, Tooltip, Typography, Form } from 'antd';
import { CameraOutlined, PlusOutlined, ReloadOutlined, SearchOutlined } from '@ant-design/icons';
import { fetchCloudProviderSnapshots } from '../../../../../services/api';
import { createHuaweiSnapshot, deleteHuaweiSnapshot } from '../../../../../services/huaweiApi';
import { statusTag } from '../components/Common';
import PageDetailSection, { RowActionsButton } from '../../../../../components/PageDetailSection';

type SnapshotSectionProps = {
  cloudId: string;
  snapshots: any[];
  disks?: any[];
  onSetSnapshots: (list: any[]) => void;
  onOpenDetail: (type: string, title: string, data: any) => void;
};

const parseSnapList = (json: any): any[] => (json?.data?.snapshots) || (json?.snapshots) || [];

const SnapshotSection: React.FC<SnapshotSectionProps> = ({ cloudId, snapshots, disks, onSetSnapshots, onOpenDetail }) => {
  const { message } = App.useApp();
  const [keyword, setKeyword] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<string | undefined>(undefined);
  const [loading, setLoading] = useState<boolean>(false);
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [createOpen, setCreateOpen] = useState<boolean>(false);
  const [createForm] = Form.useForm();

  const refresh = async () => {
    if (!cloudId) return;
    setLoading(true);
    try {
      const json = await fetchCloudProviderSnapshots(cloudId);
      onSetSnapshots(parseSnapList(json));
    } catch (e: any) { message.error(e?.message || '刷新失败'); }
    finally { setLoading(false); }
  };

  const diskOptions = useMemo(() => (Array.isArray(disks) ? disks : []).map((d: any) => ({ label: `${d?.name || d?.id}`, value: d?.id })), [disks]);

  const submitCreate = async () => {
    try {
      const v = await createForm.validateFields();
      setSubmitting(true);
      await createHuaweiSnapshot(cloudId, { diskId: v.diskId, name: v.name, description: v.description });
      message.success('创建快照指令已下发'); setCreateOpen(false); await refresh();
    } catch (e: any) { if (e?.errorFields) return; message.error(e?.message || '创建失败'); }
    finally { setSubmitting(false); }
  };

  const handleDelete = (r: any) => {
    if (!r?.id) return;
    Modal.confirm({ title: '确定删除该快照?', content: `${r?.name || r?.id} 删除后不可恢复`, okText: '确认删除', okType: 'danger', cancelText: '取消',
      onOk: async () => { try { await deleteHuaweiSnapshot(cloudId, r.id); message.success('删除成功'); await refresh(); } catch (e: any) { message.error(e?.message || '删除失败'); } } });
  };

  const filtered = useMemo(() => {
    const list = Array.isArray(snapshots) ? snapshots : [];
    const kw = keyword.trim().toLowerCase();
    return list.filter((r: any) => {
      const text = `${r?.name || ''} ${r?.id || ''} ${r?.volume_id || ''}`.toLowerCase();
      const okKw = !kw || text.includes(kw);
      const st = String(r?.status || '').toLowerCase();
      const okSt = !statusFilter || st === statusFilter.toLowerCase();
      return okKw && okSt;
    });
  }, [snapshots, keyword, statusFilter]);

  const columns = useMemo(() => ([
    {
      title: '名称/ID', key: 'name_id', fixed: 'left' as const, width: 240,
      sorter: (a: any, b: any) => String(a?.name || '').localeCompare(String(b?.name || '')),
      render: (_: any, r: any) => {
        const name = r?.name || '-';
        const id = r?.id || '-';
        return (
          <Space direction="vertical" size={0} style={{ width: '100%' }}>
            <Typography.Text strong ellipsis={{ tooltip: name }}>{name}</Typography.Text>
            <Typography.Text type="secondary" style={{ fontSize: 12 }} copyable={id !== '-' ? { text: id } : false}>{id}</Typography.Text>
          </Space>
        );
      },
    },
    {
      title: '源磁盘', dataIndex: 'volume_id', key: 'src', width: 240,
      render: (t: string) => t ? <Typography.Text type="secondary" copyable={{ text: t }} ellipsis={{ tooltip: t }}>{t}</Typography.Text> : '-',
    },
    { title: '状态', dataIndex: 'status', key: 'status', width: 110, render: (s: string) => statusTag(s) },
    {
      title: '操作', key: 'actions', fixed: 'right' as const, width: 80,
      render: (_: any, r: any) => (
        <RowActionsButton
          items={[{ key: 'detail', label: '详情' }, { key: 'delete', label: '删除', danger: true }]}
          onClick={async ({ key }: { key: string }) => {
            if (key === 'detail') { const name = r?.name || '-'; const id = r?.id || '-'; onOpenDetail('snapshot', `快照 ${name}（${id}）`, r); return; }
            if (key === 'delete') handleDelete(r);
          }}
        />
      ),
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ]), [onOpenDetail]);

  const statusOptions = useMemo(() => Array.from(new Set((snapshots || []).map((r: any) => String(r?.status || '').trim()).filter(Boolean))).map(s => ({ label: s, value: s })), [snapshots]);

  return (
    <PageDetailSection
      title={Label}
      icon={Icon}
      toolbarLeft={(
        <>
          <Input className="toolbar-search" prefix={<SearchOutlined style={{ color: 'rgba(0,0,0,.45)' }} />} placeholder="名称 / ID / 源磁盘" allowClear value={keyword} onChange={(e) => setKeyword(e.target.value)} />
          <Select className="toolbar-filter-sm" placeholder="状态" allowClear value={statusFilter} onChange={setStatusFilter} options={statusOptions} dropdownMatchSelectWidth={false} />
          <button type="button" className="toolbar-reset-btn" onClick={() => { setKeyword(''); setStatusFilter(undefined); }}>重置</button>
        </>
      )}
      toolbarRight={(
        <div className="toolbar-actions">
          <Button type="primary" icon={<PlusOutlined />} onClick={() => { createForm.resetFields(); setCreateOpen(true); }}>创建快照</Button>
          <Tooltip title="刷新"><Button icon={<ReloadOutlined />} loading={loading} onClick={refresh} /></Tooltip>
        </div>
      )}
      asCard={false}
    >
      <Table
        className="std-table"
        bordered={false}
        rowKey={(r: any) => r.id}
        dataSource={filtered}
        columns={columns as any}
        loading={loading}
        scroll={{ x: true }}
        pagination={{ size: 'small', showTotal: (total) => `共 ${total} 条` }}
      />

      <Modal title="创建快照" open={createOpen} onCancel={() => setCreateOpen(false)} onOk={submitCreate} confirmLoading={submitting} okText="创建" cancelText="取消" destroyOnHidden>
        <Form form={createForm} layout="vertical">
          <Form.Item name="diskId" label="源云盘" rules={[{ required: true, message: '请选择源云盘' }]}>
            <Select showSearch optionFilterProp="label" options={diskOptions} placeholder={diskOptions.length ? '请选择云盘' : '暂无可用云盘'} />
          </Form.Item>
          <Form.Item name="name" label="快照名称"><Input placeholder="选填" maxLength={64} allowClear /></Form.Item>
          <Form.Item name="description" label="描述"><Input.TextArea rows={2} placeholder="选填" maxLength={255} /></Form.Item>
        </Form>
      </Modal>
    </PageDetailSection>
  );
};

export const Icon = <CameraOutlined />;
export const Label = '快照';
export default SnapshotSection;
