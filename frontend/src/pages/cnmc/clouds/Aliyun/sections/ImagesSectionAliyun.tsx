import React, { useMemo, useState } from 'react';
import { App, Button, Input, Select, Table, Space, Tooltip, Typography, Tag, Modal, Form } from 'antd';
import { FileImageOutlined, PlusOutlined, ReloadOutlined, SearchOutlined } from '@ant-design/icons';
import PageDetailSection, { RowActionsButton } from '../../../../../components/PageDetailSection';
import { statusTag } from '../../Hw/components/Common';
import {
  fetchCloudProviderImages,
  deleteCloudProviderImage,
  createCloudProviderImage,
} from '../../../../../services/aliyunApi';

type Props = {
  cloudId: string;
  images: any[];
  ecs?: any[];
  snapshots?: any[];
  onSetImages: (list: any[]) => void;
  onRefreshAll?: () => Promise<void> | void;
};

const ownerOptions = [
  { label: '自定义镜像', value: 'self' },
  { label: '公共镜像', value: 'system' },
  { label: '共享镜像', value: 'others' },
  { label: '镜像市场', value: 'marketplace' },
];
const ownerLabel: Record<string, string> = { self: '自定义', system: '公共', others: '共享', marketplace: '市场' };

const parseImageList = (json: any): any[] =>
  (json?.data?.Images?.Image) || (json?.Images?.Image) || (json?.data?.images) || (json?.images) || [];

const ImagesSectionAliyun: React.FC<Props> = ({ cloudId, images, ecs, snapshots, onSetImages, onRefreshAll }) => {
  const { message } = App.useApp();
  const [keyword, setKeyword] = useState<string>('');
  const [owner, setOwner] = useState<string>('self');
  const [loading, setLoading] = useState<boolean>(false);
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [createOpen, setCreateOpen] = useState<boolean>(false);
  const [createForm] = Form.useForm();
  const [sourceType, setSourceType] = useState<'instance' | 'snapshot'>('instance');

  const refresh = async (ownerValue?: string) => {
    if (!cloudId) return;
    setLoading(true);
    try {
      const json = await fetchCloudProviderImages(cloudId, { owner: ownerValue ?? owner, pageSize: 100 });
      onSetImages(parseImageList(json));
    } catch (e: any) { message.error(e?.message || '刷新失败'); }
    finally { setLoading(false); }
  };

  const reloadAfterWrite = async () => {
    await refresh();
    if (onRefreshAll) await onRefreshAll();
  };

  const filtered = useMemo(() => {
    const list = Array.isArray(images) ? images : [];
    const kw = keyword.trim().toLowerCase();
    return list.filter((r: any) => {
      const text = `${r?.ImageName || r?.name || ''} ${r?.ImageId || r?.id || ''} ${r?.OSName || r?.OSNameEn || ''}`.toLowerCase();
      return !kw || text.includes(kw);
    });
  }, [images, keyword]);

  const submitCreate = async () => {
    try {
      const values = await createForm.validateFields();
      setSubmitting(true);
      await createCloudProviderImage(cloudId, {
        instanceId: sourceType === 'instance' ? values.sourceId : undefined,
        snapshotId: sourceType === 'snapshot' ? values.sourceId : undefined,
        imageName: values.imageName,
        description: values.description,
      });
      message.success('创建镜像指令已下发');
      setCreateOpen(false);
      await reloadAfterWrite();
    } catch (e: any) {
      if (e?.errorFields) return;
      message.error(e?.message || '创建镜像失败');
    } finally { setSubmitting(false); }
  };

  const handleDelete = (r: any) => {
    const imageId = r?.ImageId || r?.id;
    if (!imageId) return;
    Modal.confirm({
      title: '确定删除该镜像?',
      content: `镜像 ${r?.ImageName || imageId} 删除后不可恢复`,
      okText: '确认删除', okType: 'danger', cancelText: '取消',
      onOk: async () => {
        try {
          await deleteCloudProviderImage(cloudId, imageId);
          message.success('删除成功');
          await reloadAfterWrite();
        } catch (e: any) { message.error(e?.message || '删除镜像失败'); }
      },
    });
  };

  const sourceOptions = useMemo(() => {
    if (sourceType === 'instance') {
      return (Array.isArray(ecs) ? ecs : []).map((i: any) => ({ label: `${i?.InstanceName || i?.name || i?.InstanceId || i?.id}（${i?.InstanceId || i?.id}）`, value: i?.InstanceId || i?.id }));
    }
    return (Array.isArray(snapshots) ? snapshots : []).map((s: any) => ({ label: `${s?.SnapshotName || s?.SnapshotId || s?.id}（${s?.SnapshotId || s?.id}）`, value: s?.SnapshotId || s?.id }));
  }, [sourceType, ecs, snapshots]);

  const columns = useMemo(() => ([
    {
      title: '名称/ID', key: 'name_id', fixed: 'left' as const, width: 260,
      sorter: (a: any, b: any) => String(a?.ImageName || a?.name || '').localeCompare(String(b?.ImageName || b?.name || '')),
      render: (_: any, r: any) => {
        const name = r?.ImageName || r?.name || '-';
        const idv = r?.ImageId || r?.id || '-';
        return (
          <Space direction="vertical" size={0} style={{ width: '100%' }}>
            <Typography.Text strong ellipsis={{ tooltip: name }}>{name}</Typography.Text>
            <Typography.Text type="secondary" style={{ fontSize: 12 }} copyable={idv !== '-' ? { text: idv } : false}>{idv}</Typography.Text>
          </Space>
        );
      },
    },
    {
      title: '操作系统', key: 'os', width: 220,
      render: (_: any, r: any) => {
        const os = r?.OSName || r?.OSNameEn || r?.Platform || '-';
        const plat = r?.Platform;
        return (
          <Space direction="vertical" size={0}>
            <Typography.Text ellipsis={{ tooltip: os }}>{os}</Typography.Text>
            {plat && <Typography.Text type="secondary" style={{ fontSize: 12 }}>{plat}</Typography.Text>}
          </Space>
        );
      },
    },
    { title: '架构', key: 'arch', width: 100, render: (_: any, r: any) => r?.Architecture || '-' },
    { title: '大小', key: 'size', width: 90, render: (_: any, r: any) => (r?.Size != null ? `${r.Size} GB` : '-') },
    {
      title: '类型', key: 'owner', width: 100,
      render: (_: any, r: any) => {
        const o = r?.ImageOwnerAlias || '';
        return o ? <Tag color={o === 'self' ? 'blue' : 'default'}>{ownerLabel[o] || o}</Tag> : '-';
      },
    },
    { title: '状态', key: 'status', width: 110, render: (_: any, r: any) => statusTag(r?.Status || r?.status) },
    {
      title: '创建时间', key: 'ctime', width: 170,
      render: (_: any, r: any) => {
        const t = r?.CreationTime;
        if (!t) return '-';
        try { return new Date(t).toLocaleString('zh-CN', { hour12: false }); } catch { return t; }
      },
    },
    {
      title: '操作', key: 'actions', fixed: 'right' as const, width: 80,
      render: (_: any, r: any) => {
        const isSelf = String(r?.ImageOwnerAlias || '') === 'self';
        const items: any[] = [{ key: 'detail', label: '详情' }];
        if (isSelf) items.push({ key: 'del', label: '删除', danger: true });
        return (
          <RowActionsButton
            items={items}
            onClick={async ({ key }: { key: string }) => {
              if (key === 'detail') {
                Modal.info({ title: '镜像详情', width: 600, maskClosable: true, content: (<pre style={{ maxHeight: 400, overflow: 'auto', background: '#f5f5f5', padding: 10 }}>{JSON.stringify(r, null, 2)}</pre>) });
                return;
              }
              if (key === 'del') { handleDelete(r); return; }
            }}
          />
        );
      },
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ]), [cloudId]);

  return (
    <PageDetailSection
      title={Label}
      icon={Icon}
      toolbarLeft={(
        <>
          <Input className="toolbar-search" prefix={<SearchOutlined style={{ color: 'rgba(0,0,0,.45)' }} />} placeholder="名称 / ID / 系统" allowClear value={keyword} onChange={(e) => setKeyword(e.target.value)} />
          <Select className="toolbar-filter-sm" value={owner} onChange={(v) => { setOwner(v); refresh(v); }} options={ownerOptions} dropdownMatchSelectWidth={false} />
          <button type="button" className="toolbar-reset-btn" onClick={() => { setKeyword(''); }}>重置</button>
        </>
      )}
      toolbarRight={(
        <div className="toolbar-actions">
          <Button type="primary" icon={<PlusOutlined />} onClick={() => { createForm.resetFields(); setSourceType('instance'); setCreateOpen(true); }}>创建自定义镜像</Button>
          <Tooltip title="刷新"><Button icon={<ReloadOutlined />} loading={loading} onClick={() => refresh()} /></Tooltip>
        </div>
      )}
      asCard={false}
    >
      <Table
        className="std-table"
        bordered={false}
        rowKey={(r: any) => r?.ImageId || r?.id}
        dataSource={filtered}
        columns={columns as any}
        loading={loading}
        scroll={{ x: true }}
        pagination={{ size: 'small', showTotal: (total) => `共 ${total} 条` }}
      />

      <Modal title="创建自定义镜像" open={createOpen} onCancel={() => setCreateOpen(false)} onOk={submitCreate} confirmLoading={submitting} okText="创建" cancelText="取消" destroyOnClose>
        <Form form={createForm} layout="vertical">
          <Form.Item label="来源类型">
            <Select value={sourceType} onChange={(v) => { setSourceType(v); createForm.setFieldsValue({ sourceId: undefined }); }} options={[{ label: '从实例创建', value: 'instance' }, { label: '从快照创建', value: 'snapshot' }]} />
          </Form.Item>
          <Form.Item name="sourceId" label={sourceType === 'instance' ? '源实例' : '源快照'} rules={[{ required: true, message: '请选择来源' }]}>
            <Select showSearch optionFilterProp="label" placeholder={sourceOptions.length ? '请选择' : '暂无可选来源'} options={sourceOptions} />
          </Form.Item>
          <Form.Item name="imageName" label="镜像名称" rules={[{ required: true, message: '请输入镜像名称' }]}>
            <Input placeholder="请输入名称" maxLength={128} allowClear />
          </Form.Item>
          <Form.Item name="description" label="描述"><Input.TextArea rows={2} placeholder="选填" maxLength={256} /></Form.Item>
        </Form>
      </Modal>
    </PageDetailSection>
  );
};

export const Icon = <FileImageOutlined />;
export const Label = '镜像';
export default ImagesSectionAliyun;
