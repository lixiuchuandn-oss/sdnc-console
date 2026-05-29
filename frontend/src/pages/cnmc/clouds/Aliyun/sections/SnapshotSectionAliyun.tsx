import React, { useMemo, useState } from 'react';
import { App, Button, Input, Select, Table, Space, Typography, Badge, Tag, Modal, Form } from 'antd';
import { CameraOutlined, ReloadOutlined, SearchOutlined, PlusOutlined } from '@ant-design/icons';
import {
  fetchCloudProviderSnapshots,
  createCloudProviderSnapshot,
  deleteCloudProviderSnapshot,
  rollbackCloudProviderDisk,
} from '../../../../../services/aliyunApi';
import PageDetailSection, { RowActionsButton } from '../../../../../components/PageDetailSection';

type SnapshotSectionAliyunProps = {
  cloudId: string;
  snapshots: any[];
  disks?: any[];
  onSetSnapshots: (list: any[]) => void;
  onOpenDetail?: (type: string, title: string, data: any) => void;
  onRefreshAll?: () => Promise<void> | void;
};

const snapshotStatusMap: Record<string, { status: 'success' | 'processing' | 'error' | 'default', text: string }> = {
  accomplished: { status: 'success', text: '成功' },
  progressing: { status: 'processing', text: '创建中' },
  failed: { status: 'error', text: '失败' },
};

const snapshotTypeMap: Record<string, string> = {
  auto: '自动快照',
  user: '手动快照',
  all: '全部',
};

const SnapshotSectionAliyun: React.FC<SnapshotSectionAliyunProps> = ({ cloudId, snapshots, disks, onSetSnapshots, onRefreshAll }) => {
  const { message } = App.useApp();
  const [keyword, setKeyword] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<string | undefined>(undefined);
  const [typeFilter, setTypeFilter] = useState<string | undefined>(undefined);
  const [loading, setLoading] = useState<boolean>(false);
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [createOpen, setCreateOpen] = useState<boolean>(false);
  const [createForm] = Form.useForm();

  const diskOptions = useMemo(
    () =>
      (Array.isArray(disks) ? disks : []).map((d: any) => ({
        label: `${d?.DiskName || d?.name || d?.DiskId || d?.id}（${d?.DiskId || d?.id}）`,
        value: d?.DiskId || d?.id,
      })),
    [disks],
  );

  const reloadAfterWrite = async () => {
    await load();
    if (onRefreshAll) await onRefreshAll();
  };

  const submitCreate = async () => {
    try {
      const values = await createForm.validateFields();
      setSubmitting(true);
      await createCloudProviderSnapshot(cloudId, {
        diskId: values.diskId,
        snapshotName: values.snapshotName,
        description: values.description,
      });
      message.success('创建快照指令已下发');
      setCreateOpen(false);
      await reloadAfterWrite();
    } catch (e: any) {
      if (e?.errorFields) return;
      message.error(e?.message || '创建快照失败');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = (r: any) => {
    const id0 = r?.SnapshotId || r?.id;
    if (!id0) return;
    Modal.confirm({
      title: '确定删除该快照?',
      content: `快照 ${r?.SnapshotName || id0} 删除后不可恢复`,
      okText: '确认删除',
      okType: 'danger',
      cancelText: '取消',
      onOk: async () => {
        try {
          await deleteCloudProviderSnapshot(cloudId, id0);
          message.success('删除成功');
          await reloadAfterWrite();
        } catch (e: any) { message.error(e?.message || '删除快照失败'); }
      },
    });
  };

  const handleRollback = (r: any) => {
    const diskId = r?.SourceDiskId || r?.volume_id;
    const snapId = r?.SnapshotId || r?.id;
    if (!diskId || !snapId) { message.error('未找到源云盘'); return; }
    Modal.confirm({
      title: '确定将云盘回滚到该快照?',
      content: `云盘 ${diskId} 将回滚至快照创建时的数据，期间须先停止关联实例，回滚后数据不可恢复`,
      okText: '确认回滚',
      okType: 'danger',
      cancelText: '取消',
      onOk: async () => {
        try {
          await rollbackCloudProviderDisk(cloudId, String(diskId), { snapshotId: String(snapId) });
          message.success('回滚指令已下发');
          await reloadAfterWrite();
        } catch (e: any) { message.error(e?.message || '回滚云盘失败'); }
      },
    });
  };

  const filtered = useMemo(() => {
    const list = Array.isArray(snapshots) ? snapshots : [];
    const kw = keyword.trim().toLowerCase();
    
    return list.filter((r: any) => {
      // Aliyun: SnapshotId, SnapshotName, SourceDiskId
      const name = String(r?.SnapshotName || r?.name || '').toLowerCase();
      const id = String(r?.SnapshotId || r?.id || '').toLowerCase();
      const diskId = String(r?.SourceDiskId || r?.volume_id || '').toLowerCase();
      
      const okKw = !kw || name.includes(kw) || id.includes(kw) || diskId.includes(kw);
      
      const st = String(r?.Status || r?.status || '').toLowerCase();
      const okSt = !statusFilter || st === statusFilter.toLowerCase();

      const tp = String(r?.SnapshotType || r?.type || '').toLowerCase();
      const okTp = !typeFilter || tp === typeFilter.toLowerCase();

      return okKw && okSt && okTp;
    });
  }, [snapshots, keyword, statusFilter, typeFilter]);

  const load = async () => {
    if (!cloudId) return;
    setLoading(true);
    try {
      const json = await fetchCloudProviderSnapshots(cloudId);
      const list: any[] = (json?.Snapshots?.Snapshot) || (json?.data?.snapshots) || (json?.snapshots) || [];
      onSetSnapshots(Array.isArray(list) ? list : []);
      message.success('快照已刷新');
    } catch (e: any) { 
      message.error(e?.message || '刷新失败'); 
    } finally {
      setLoading(false);
    }
  };

  const columns = useMemo(() => [
    { 
      title: '快照信息', 
      key: 'info', 
      width: 240,
      sorter: (a: any, b: any) => {
        const an = String(a?.SnapshotName || a?.name || '');
        const bn = String(b?.SnapshotName || b?.name || '');
        const cmp = an.localeCompare(bn);
        if (cmp !== 0) return cmp;
        return String(a?.SnapshotId || a?.id || '').localeCompare(String(b?.SnapshotId || b?.id || ''));
      },
      render: (_: any, r: any) => {
        const name = r?.SnapshotName || r?.name || '-';
        const id = r?.SnapshotId || r?.id || '-';
        return (
          <Space direction="vertical" size={0} style={{ width: '100%' }}>
            <Typography.Text strong ellipsis={{ tooltip: name }}>{name}</Typography.Text>
            <Typography.Text type="secondary" style={{ fontSize: 12 }} copyable={{ text: id }}>
              {id}
            </Typography.Text>
          </Space>
        );
      } 
    },
    { 
      title: '状态', 
      key: 'status', 
      width: 100,
      sorter: (a: any, b: any) => String(a?.Status || a?.status || '').localeCompare(String(b?.Status || b?.status || '')),
      render: (_: any, r: any) => {
        const s = r?.Status || r?.status || '-';
        const map = snapshotStatusMap[s] || { status: 'default', text: s };
        const progress = r?.Progress || r?.progress;
        return (
          <Space direction="vertical" size={0}>
            <Badge status={map.status} text={map.text} />
            {progress && <span style={{ fontSize: 12, color: '#888', paddingLeft: 12 }}>{progress}</span>}
          </Space>
        );
      } 
    },
    { 
      title: '源磁盘', 
      key: 'source', 
      width: 180,
      sorter: (a: any, b: any) => String(a?.SourceDiskId || a?.volume_id || '').localeCompare(String(b?.SourceDiskId || b?.volume_id || '')),
      render: (_: any, r: any) => {
        const diskId = r?.SourceDiskId || r?.volume_id || '-';
        const size = r?.SourceDiskSize || r?.size;
        return (
          <Space direction="vertical" size={0}>
            <Typography.Text type="secondary" copyable={{ text: diskId }} ellipsis={{ tooltip: diskId }} style={{ maxWidth: 160 }}>
              {diskId}
            </Typography.Text>
            {size && <Tag style={{ margin: 0 }}>{size} GB</Tag>}
          </Space>
        );
      } 
    },
    { 
      title: '类型', 
      key: 'type', 
      width: 100,
      sorter: (a: any, b: any) => String(a?.SnapshotType || a?.type || '').localeCompare(String(b?.SnapshotType || b?.type || '')),
      render: (_: any, r: any) => {
        const t = r?.SnapshotType || r?.type || '-';
        return <Tag>{snapshotTypeMap[t] || t}</Tag>;
      } 
    },
    { 
      title: '创建时间', 
      key: 'time', 
      width: 160,
      render: (_: any, r: any) => {
        const t = r?.CreationTime || r?.created_at || r?.createdAt;
        if (!t) return '-';
        try {
          return new Date(t).toLocaleString('zh-CN', { hour12: false }); 
        } catch { return t; }
      },
      sorter: (a: any, b: any) => String(a?.CreationTime || '').localeCompare(String(b?.CreationTime || ''))
    },
    { 
      title: '操作', 
      key: 'actions', 
      fixed: 'right',
      width: 80,
      render: (_: any, r: any) => {
        const items = [
          { key: 'detail', label: '详情' },
          { key: 'rollback', label: '回滚云盘' },
          { key: 'delete', label: '删除', danger: true },
        ];
        return (
          <RowActionsButton
            items={items}
            onClick={async ({ key }: { key: string }) => {
              if (key === 'detail') { 
                Modal.info({
                  title: '快照详情',
                  width: 600,
                  content: (
                    <pre style={{ maxHeight: 400, overflow: 'auto', background: '#f5f5f5', padding: 10, borderRadius: 4 }}>
                      {JSON.stringify(r, null, 2)}
                    </pre>
                  ),
                  maskClosable: true,
                });
                return;
              }
              if (key === 'rollback') { handleRollback(r); return; }
              if (key === 'delete') { handleDelete(r); return; }
            }}
          />
        );
      } 
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ], []);

  // Filter options
  const statusOptions = useMemo(() => {
    const all = new Set<string>();
    (Array.isArray(snapshots) ? snapshots : []).forEach((r: any) => {
      if (r?.Status) all.add(r.Status);
    });
    return Array.from(all).map(s => ({ label: snapshotStatusMap[s]?.text || s, value: s }));
  }, [snapshots]);

  return (
    <PageDetailSection
      title={Label}
      icon={Icon}
      toolbarLeft={(
        <Space wrap>
          <Input 
            prefix={<SearchOutlined style={{ color: 'rgba(0,0,0,.45)' }} />}
            placeholder="搜索名称/ID/磁盘ID" 
            allowClear 
            value={keyword} 
            onChange={(e) => setKeyword(e.target.value)} 
            style={{ width: 220 }} 
          />
          <Select 
            placeholder="状态" 
            allowClear 
            value={statusFilter} 
            onChange={setStatusFilter} 
            style={{ width: 120 }} 
            options={statusOptions} 
            dropdownMatchSelectWidth={false}
          />
          <Select 
            placeholder="类型" 
            allowClear 
            value={typeFilter} 
            onChange={setTypeFilter} 
            style={{ width: 120 }} 
            options={[
              { label: '自动快照', value: 'auto' },
              { label: '手动快照', value: 'user' }
            ]}
            dropdownMatchSelectWidth={false}
          />
        </Space>
      )}
      toolbarRight={(
        <Space>
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => { createForm.resetFields(); setCreateOpen(true); }}
          >
            创建快照
          </Button>
          <Button icon={<ReloadOutlined />} onClick={load} loading={loading} />
        </Space>
      )}
      asCard={false}
    >
      <Table 
        loading={loading}
        rowKey={(r: any) => r?.SnapshotId || r?.id} 
        dataSource={filtered} 
        columns={columns as any} 
        pagination={{
          size: 'small',
          showTotal: (total) => `共 ${total} 条`,
        }} 
        scroll={{ x: 1000 }}
      />

      <Modal
        title="创建快照"
        open={createOpen}
        onCancel={() => setCreateOpen(false)}
        onOk={submitCreate}
        okText="创建"
        cancelText="取消"
        confirmLoading={submitting}
        destroyOnClose
      >
        <Form form={createForm} layout="vertical">
          <Form.Item name="diskId" label="源云盘" rules={[{ required: true, message: '请选择源云盘' }]}>
            <Select
              showSearch
              optionFilterProp="label"
              options={diskOptions}
              placeholder={diskOptions.length ? '请选择云盘' : '暂无可用云盘'}
            />
          </Form.Item>
          <Form.Item name="snapshotName" label="快照名称">
            <Input placeholder="选填" maxLength={128} allowClear />
          </Form.Item>
          <Form.Item name="description" label="描述">
            <Input.TextArea rows={2} placeholder="选填" maxLength={256} />
          </Form.Item>
        </Form>
      </Modal>
    </PageDetailSection>
  );
};

export const Icon = <CameraOutlined />;
export const Label = '快照';
export default SnapshotSectionAliyun;
