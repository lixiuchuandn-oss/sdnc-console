import React, { useMemo, useState } from 'react';
import { App, Button, Input, InputNumber, Form, AutoComplete, Modal, Select, Space, Table, Tooltip, Typography } from 'antd';
import { HddOutlined, PlusOutlined, ReloadOutlined, SearchOutlined } from '@ant-design/icons';
import { fetchCloudProviderDisks } from '../../../../../services/api';
import { statusTag, tagsToText } from '../components/Common';
import PageDetailSection, { RowActionsButton } from '../../../../../components/PageDetailSection';
import {
  createHuaweiVolume, deleteHuaweiVolume, resizeHuaweiVolume,
  attachHuaweiVolume, detachHuaweiVolume, createHuaweiSnapshot,
} from '../../../../../services/huaweiApi';

type DiskSectionProps = {
  cloudId: string;
  disks: any[];
  ecs?: any[];
  onSetDisks: (list: any[]) => void;
  onOpenDetail: (type: string, title: string, data: any) => void;
  onRefreshAll?: () => Promise<void> | void;
};

const volumeTypeOptions = [
  { label: '高IO (SAS)', value: 'SAS' },
  { label: '超高IO (SSD)', value: 'SSD' },
  { label: '普通IO (SATA)', value: 'SATA' },
  { label: '通用型SSD (GPSSD)', value: 'GPSSD' },
];

const parseDiskList = (json: any): any[] => (json?.data?.volumes) || (json?.volumes) || [];
const getAtts = (r: any): any[] => (Array.isArray(r?.attachments) ? r.attachments : []);

const DiskSection: React.FC<DiskSectionProps> = ({ cloudId, disks, ecs, onSetDisks, onOpenDetail, onRefreshAll }) => {
  const { message } = App.useApp();
  const [keyword, setKeyword] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<string | undefined>(undefined);
  const [loading, setLoading] = useState<boolean>(false);
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [createForm] = Form.useForm();
  const [resizeOpen, setResizeOpen] = useState(false);
  const [resizeForm] = Form.useForm();
  const [resizeTarget, setResizeTarget] = useState<any | null>(null);
  const [attachOpen, setAttachOpen] = useState(false);
  const [attachForm] = Form.useForm();
  const [attachTarget, setAttachTarget] = useState<any | null>(null);
  const [snapOpen, setSnapOpen] = useState(false);
  const [snapForm] = Form.useForm();
  const [snapTarget, setSnapTarget] = useState<any | null>(null);

  const refresh = async () => {
    if (!cloudId) return;
    setLoading(true);
    try {
      const json = await fetchCloudProviderDisks(cloudId);
      onSetDisks(parseDiskList(json));
    } catch (e: any) { message.error(e?.message || '刷新失败'); }
    finally { setLoading(false); }
  };
  const reloadAfterWrite = async () => { await refresh(); if (onRefreshAll) await onRefreshAll(); };

  const filtered = useMemo(() => {
    const list = Array.isArray(disks) ? disks : [];
    const kw = keyword.trim().toLowerCase();
    return list.filter((r: any) => {
      const text = `${r?.name || ''} ${r?.id || ''} ${r?.volume_type || ''} ${r?.size || ''}`.toLowerCase();
      const okKw = !kw || text.includes(kw);
      const st = String(r?.status || '').toLowerCase();
      const okSt = !statusFilter || st === statusFilter.toLowerCase();
      return okKw && okSt;
    });
  }, [disks, keyword, statusFilter]);

  const zoneSuggestions = useMemo(() => {
    const set = new Set<string>();
    (Array.isArray(disks) ? disks : []).forEach((d: any) => { const z = d?.availability_zone || d?.zone; if (z) set.add(z); });
    (Array.isArray(ecs) ? ecs : []).forEach((i: any) => { const z = i?.['OS-EXT-AZ:availability_zone'] || i?.availability_zone; if (z) set.add(z); });
    return Array.from(set).map((z) => ({ value: z }));
  }, [disks, ecs]);

  const ecsOptions = useMemo(() => (Array.isArray(ecs) ? ecs : []).map((i: any) => ({ label: `${i?.name || i?.id}`, value: i?.id })), [ecs]);

  const submitCreate = async () => {
    try {
      const v = await createForm.validateFields();
      setSubmitting(true);
      await createHuaweiVolume(cloudId, { availabilityZone: v.availabilityZone, volumeType: v.volumeType, size: v.size, name: v.name, count: 1 });
      message.success('创建云盘指令已下发'); setCreateOpen(false); await reloadAfterWrite();
    } catch (e: any) { if (e?.errorFields) return; message.error(e?.message || '创建失败'); }
    finally { setSubmitting(false); }
  };
  const submitResize = async () => {
    try {
      const v = await resizeForm.validateFields();
      if (!resizeTarget?.id) return;
      setSubmitting(true);
      await resizeHuaweiVolume(cloudId, resizeTarget.id, v.newSize);
      message.success('扩容指令已下发'); setResizeOpen(false); await reloadAfterWrite();
    } catch (e: any) { if (e?.errorFields) return; message.error(e?.message || '扩容失败'); }
    finally { setSubmitting(false); }
  };
  const submitAttach = async () => {
    try {
      const v = await attachForm.validateFields();
      if (!attachTarget?.id) return;
      setSubmitting(true);
      await attachHuaweiVolume(cloudId, attachTarget.id, v.instanceId, v.device || undefined);
      message.success('挂载指令已下发'); setAttachOpen(false); await reloadAfterWrite();
    } catch (e: any) { if (e?.errorFields) return; message.error(e?.message || '挂载失败'); }
    finally { setSubmitting(false); }
  };
  const submitSnap = async () => {
    try {
      const v = await snapForm.validateFields();
      if (!snapTarget?.id) return;
      setSubmitting(true);
      await createHuaweiSnapshot(cloudId, { diskId: snapTarget.id, name: v.name, description: v.description });
      message.success('创建快照指令已下发'); setSnapOpen(false); if (onRefreshAll) await onRefreshAll();
    } catch (e: any) { if (e?.errorFields) return; message.error(e?.message || '创建快照失败'); }
    finally { setSubmitting(false); }
  };
  const handleDetach = (r: any) => {
    const atts = getAtts(r);
    const serverId = atts[0]?.server_id || atts[0]?.instance_id;
    if (!r?.id || !serverId) { message.error('未找到云盘所属实例'); return; }
    Modal.confirm({ title: '确定卸载该云盘?', content: `${r?.name || r?.id} 将从实例 ${serverId} 卸载`, okText: '确认卸载', okType: 'danger', cancelText: '取消',
      onOk: async () => { try { await detachHuaweiVolume(cloudId, r.id, String(serverId)); message.success('卸载指令已下发'); await reloadAfterWrite(); } catch (e: any) { message.error(e?.message || '卸载失败'); } } });
  };
  const handleDelete = (r: any) => {
    if (!r?.id) return;
    Modal.confirm({ title: '确定删除该云盘?', content: `${r?.name || r?.id} 删除后不可恢复`, okText: '确认删除', okType: 'danger', cancelText: '取消',
      onOk: async () => { try { await deleteHuaweiVolume(cloudId, r.id); message.success('删除成功'); await reloadAfterWrite(); } catch (e: any) { message.error(e?.message || '删除失败'); } } });
  };

  const columns = useMemo(() => ([
    {
      title: '名称/ID', key: 'name_id', fixed: 'left' as const, width: 240,
      sorter: (a: any, b: any) => String(a?.name || '').localeCompare(String(b?.name || '')),
      render: (_: any, r: any) => {
        const name = r?.name || '-'; const id = r?.id || '-';
        return (
          <Space direction="vertical" size={0} style={{ width: '100%' }}>
            <Typography.Text strong ellipsis={{ tooltip: name }}>{name}</Typography.Text>
            <Typography.Text type="secondary" style={{ fontSize: 12 }} copyable={id !== '-' ? { text: id } : false}>{id}</Typography.Text>
          </Space>
        );
      },
    },
    {
      title: '容量/类型', key: 'size_type', width: 160, sorter: (a: any, b: any) => Number(a?.size || 0) - Number(b?.size || 0),
      render: (_: any, r: any) => (
        <Space direction="vertical" size={0}>
          <Typography.Text>{(r?.size != null && r?.size !== '') ? `${r.size} GB` : '-'}</Typography.Text>
          {r?.volume_type && <Typography.Text type="secondary" style={{ fontSize: 12 }}>{r.volume_type}{String(r?.bootable) === 'true' ? ' · 系统盘' : ''}</Typography.Text>}
        </Space>
      ),
    },
    { title: '状态', dataIndex: 'status', key: 'status', width: 110, render: (s: string) => statusTag(s) },
    {
      title: '挂载实例/设备', key: 'attach', ellipsis: true,
      render: (_: any, r: any): React.ReactNode => {
        const list = getAtts(r).map((a: any) => `${a?.server_id || a?.instance_id || '-'}（${a?.device || '-'}）`).filter(Boolean);
        return list.length ? <Typography.Text ellipsis={{ tooltip: list.join('；') }}>{list.join('；')}</Typography.Text> : <Typography.Text type="secondary">未挂载</Typography.Text>;
      },
    },
    { title: '可用区', key: 'az', width: 130, render: (_: any, r: any) => r?.availability_zone || r?.zone || '-' },
    { title: '标签', key: 'tags', width: 140, ellipsis: true, render: (_: any, r: any) => tagsToText(r?.tags) || '-' },
    {
      title: '操作', key: 'actions', fixed: 'right' as const, width: 80,
      render: (_: any, r: any) => {
        const st = String(r?.status || '').toLowerCase();
        const bootable = String(r?.bootable) === 'true';
        const attached = getAtts(r).length > 0;
        const items: any[] = [{ key: 'detail', label: '详情' }, { key: 'snapshot', label: '创建快照' }, { key: 'resize', label: '扩容' }];
        if (st === 'available' && !attached) items.push({ key: 'attach', label: '挂载' });
        if (attached && !bootable) items.push({ key: 'detach', label: '卸载' });
        if (st === 'available' && !attached && !bootable) items.push({ key: 'delete', label: '删除', danger: true });
        return (
          <RowActionsButton
            items={items}
            onClick={async ({ key }) => {
              if (key === 'detail') { const name = r?.name || '-'; const id = r?.id || '-'; onOpenDetail('disk', `云盘 ${name}（${id}）`, r); return; }
              if (key === 'snapshot') { setSnapTarget(r); snapForm.resetFields(); setSnapOpen(true); return; }
              if (key === 'resize') { setResizeTarget(r); resizeForm.resetFields(); resizeForm.setFieldsValue({ newSize: Number(r?.size || 10) + 10 }); setResizeOpen(true); return; }
              if (key === 'attach') { setAttachTarget(r); attachForm.resetFields(); setAttachOpen(true); return; }
              if (key === 'detach') { handleDetach(r); return; }
              if (key === 'delete') { handleDelete(r); return; }
            }}
          />
        );
      },
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ]), [cloudId, onOpenDetail]);

  const statusOptions = useMemo(() => Array.from(new Set((disks || []).map((r: any) => String(r?.status || '').trim()).filter(Boolean))).map(s => ({ label: s, value: s })), [disks]);

  return (
    <PageDetailSection
      title={Label}
      icon={Icon}
      toolbarLeft={(
        <>
          <Input className="toolbar-search" prefix={<SearchOutlined style={{ color: 'rgba(0,0,0,.45)' }} />} placeholder="名称 / ID / 类型" allowClear value={keyword} onChange={(e) => setKeyword(e.target.value)} />
          <Select className="toolbar-filter-sm" placeholder="状态" allowClear value={statusFilter} onChange={setStatusFilter} options={statusOptions} dropdownMatchSelectWidth={false} />
          <button type="button" className="toolbar-reset-btn" onClick={() => { setKeyword(''); setStatusFilter(undefined); }}>重置</button>
        </>
      )}
      toolbarRight={(
        <div className="toolbar-actions">
          <Button type="primary" icon={<PlusOutlined />} onClick={() => { createForm.resetFields(); createForm.setFieldsValue({ volumeType: 'SAS', size: 40 }); setCreateOpen(true); }}>新建云盘</Button>
          <Tooltip title="刷新"><Button icon={<ReloadOutlined />} loading={loading} onClick={refresh} /></Tooltip>
        </div>
      )}
      asCard={false}
    >
      <Table className="std-table" bordered={false} rowKey={(r: any) => r.id} dataSource={filtered} columns={columns as any} loading={loading} scroll={{ x: true }} pagination={{ size: 'small', showTotal: (total) => `共 ${total} 条` }} />

      <Modal title="新建云盘" open={createOpen} onCancel={() => setCreateOpen(false)} onOk={submitCreate} confirmLoading={submitting} okText="创建" cancelText="取消" destroyOnHidden>
        <Form form={createForm} layout="vertical">
          <Form.Item name="availabilityZone" label="可用区" rules={[{ required: true, message: '请输入可用区' }]}>
            <AutoComplete options={zoneSuggestions} placeholder="如 cn-north-4a" allowClear filterOption={(v, o) => String(o?.value || '').includes(v)} />
          </Form.Item>
          <Form.Item name="volumeType" label="云盘类型" rules={[{ required: true }]}><Select options={volumeTypeOptions} /></Form.Item>
          <Form.Item name="size" label="容量 (GB)" rules={[{ required: true }]}><InputNumber min={10} max={32768} style={{ width: '100%' }} /></Form.Item>
          <Form.Item name="name" label="名称"><Input placeholder="选填" maxLength={64} allowClear /></Form.Item>
        </Form>
      </Modal>

      <Modal title="扩容云盘" open={resizeOpen} onCancel={() => setResizeOpen(false)} onOk={submitResize} confirmLoading={submitting} okText="扩容" cancelText="取消" destroyOnHidden>
        <Form form={resizeForm} layout="vertical">
          <Typography.Paragraph type="secondary">当前容量：{resizeTarget?.size ?? '-'} GB（仅可增大）</Typography.Paragraph>
          <Form.Item name="newSize" label="目标容量 (GB)" rules={[{ required: true, message: '请输入目标容量' }, { validator: (_, v) => (v != null && Number(v) > Number(resizeTarget?.size || 0)) ? Promise.resolve() : Promise.reject(new Error('目标容量须大于当前容量')) }]}>
            <InputNumber min={Number(resizeTarget?.size || 10) + 1} max={32768} style={{ width: '100%' }} />
          </Form.Item>
        </Form>
      </Modal>

      <Modal title="挂载云盘" open={attachOpen} onCancel={() => setAttachOpen(false)} onOk={submitAttach} confirmLoading={submitting} okText="挂载" cancelText="取消" destroyOnHidden>
        <Form form={attachForm} layout="vertical">
          <Form.Item name="instanceId" label="目标实例" rules={[{ required: true, message: '请选择目标实例' }]}>
            <Select showSearch optionFilterProp="label" options={ecsOptions} placeholder={ecsOptions.length ? '请选择实例' : '暂无可用实例'} />
          </Form.Item>
          <Form.Item name="device" label="挂载点（选填）"><Input placeholder="如 /dev/vdb" allowClear /></Form.Item>
        </Form>
      </Modal>

      <Modal title="创建快照" open={snapOpen} onCancel={() => setSnapOpen(false)} onOk={submitSnap} confirmLoading={submitting} okText="创建" cancelText="取消" destroyOnHidden>
        <Form form={snapForm} layout="vertical">
          <Typography.Paragraph type="secondary">源云盘：{snapTarget?.name || snapTarget?.id || '-'}</Typography.Paragraph>
          <Form.Item name="name" label="快照名称"><Input placeholder="选填" maxLength={64} allowClear /></Form.Item>
          <Form.Item name="description" label="描述"><Input.TextArea rows={2} placeholder="选填" maxLength={255} /></Form.Item>
        </Form>
      </Modal>
    </PageDetailSection>
  );
};

export const Icon = <HddOutlined />;
export const Label = '云盘';
export default DiskSection;
