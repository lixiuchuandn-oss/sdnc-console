/**
 * 监控服务 - 集群日志外发（ClusterOutput）
 * 设计文档：plan/设计-监控服务-集群日志外发.md
 * 参考 Compute.Tower-Monitoring LogOutputPage；复用主项目 PageDetailSection、WizardShell、loggingApi。
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Button,
  Collapse,
  Divider,
  Dropdown,
  Form,
  Input,
  message,
  Modal,
  Select,
  Space,
  Table,
  Typography,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { EllipsisOutlined, PlusOutlined, ReloadOutlined } from '@ant-design/icons';
import PageDetailSection from '../../../../components/PageDetailSection';
import ResourceActionsDropdown from '../../../../components/ResourceActionsDropdown';
import { WizardModal, WizardLayout } from '../../../../components/WizardShell';
import {
  fetchClusteroutputs,
  fetchClusteroutputDetail,
  createClusteroutput,
  updateClusteroutput,
  deleteClusteroutput,
} from '../../../../services/loggingApi';

const LOGGING_NS = 'cattle-logging-system';
const PROVIDER_OPTIONS = [
  { label: 'Syslog', value: 'syslog' },
  { label: 'Elasticsearch', value: 'elasticsearch' },
  { label: 'Forward', value: 'forward' },
  { label: 'S3', value: 's3' },
  { label: 'Kafka', value: 'kafka' },
];

interface ClusterOutputItem {
  id?: string;
  metadata?: {
    name?: string;
    namespace?: string;
    annotations?: Record<string, string>;
    labels?: Record<string, string>;
  };
  spec?: Record<string, unknown>;
  status?: { conditions?: Array<{ type?: string; status?: string }> };
}

function normalizeListPayload(res: unknown): ClusterOutputItem[] {
  if (!res || typeof res !== 'object') return [];
  let list: unknown[] = [];
  const o = res as Record<string, unknown>;
  if (Array.isArray(o.data)) list = o.data;
  else if (Array.isArray((o.data as Record<string, unknown>)?.data)) list = (o.data as Record<string, unknown[]>).data;
  else if (Array.isArray(o.items)) list = o.items;
  return list.map((item: unknown) => {
    const i = item as ClusterOutputItem;
    return {
      ...i,
      id: i.id ?? i.metadata?.name ?? `${i.metadata?.namespace ?? ''}/${i.metadata?.name ?? ''}`,
    };
  });
}

function getProviderFromSpec(spec: Record<string, unknown> | undefined): string {
  if (!spec || typeof spec !== 'object') return '-';
  const key = Object.keys(spec).find(
    (k) => k !== 'loggingRef' && spec[k] != null && typeof spec[k] === 'object'
  );
  return key ? key.charAt(0).toUpperCase() + key.slice(1) : '-';
}

function OutputPreview({ form }: { form: ReturnType<typeof Form.useForm>[0] }) {
  const name = Form.useWatch('name', form) ?? '';
  const description = Form.useWatch('description', form) ?? '';
  const provider = Form.useWatch('provider', form) ?? 'syslog';
  const host = Form.useWatch('host', form) ?? '';
  const port = Form.useWatch('port', form);
  const labels = (Form.useWatch('labels', form) ?? []) as Array<{ key?: string; value?: string }>;
  const labelStr =
    labels.filter((l) => (l?.key ?? '').trim()).length > 0
      ? labels.map((l) => `${l?.key ?? ''}=${l?.value ?? ''}`).join(', ')
      : '-';
  const providerLabel = PROVIDER_OPTIONS.find((o) => o.value === provider)?.label ?? provider;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div><span style={{ color: 'rgba(0,0,0,0.45)', marginRight: 8 }}>名称</span><span>{name || '-'}</span></div>
      <div><span style={{ color: 'rgba(0,0,0,0.45)', marginRight: 8 }}>描述</span><span>{(description || '').trim() || '-'}</span></div>
      <div><span style={{ color: 'rgba(0,0,0,0.45)', marginRight: 8 }}>提供商（Output）</span><span>{providerLabel}</span></div>
      <div><span style={{ color: 'rgba(0,0,0,0.45)', marginRight: 8 }}>输出配置</span><span>
        {provider === 'syslog' || provider === 'elasticsearch'
          ? `${host || '-'}:${port ?? 514}`
          : provider === 's3'
            ? `${(form.getFieldValue('bucket') ?? '-')} / ${(form.getFieldValue('region') ?? '-')}`
            : '-'}
      </span></div>
      <div><span style={{ color: 'rgba(0,0,0,0.45)', marginRight: 8 }}>标签</span><span>{labelStr}</span></div>
    </div>
  );
}

interface LogOutputsProps {
  cloudId: string;
}

const LogOutputs: React.FC<LogOutputsProps> = ({ cloudId }) => {
  const [list, setList] = useState<ClusterOutputItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [keyword, setKeyword] = useState('');
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([]);
  const [formModalOpen, setFormModalOpen] = useState(false);
  const [formStep, setFormStep] = useState(0);
  const [editingRecord, setEditingRecord] = useState<ClusterOutputItem | null>(null);
  const [formLoading, setFormLoading] = useState(false);
  const [form] = Form.useForm();

  const loadList = useCallback(async () => {
    if (!cloudId) return;
    setLoading(true);
    const { data, ok, error } = await fetchClusteroutputs(cloudId);
    setLoading(false);
    if (!ok) {
      message.error(error || '加载列表失败');
      setList([]);
      return;
    }
    setList(normalizeListPayload(data));
  }, [cloudId]);

  useEffect(() => {
    loadList();
  }, [loadList]);

  const handleOpenForm = useCallback(
    (record: ClusterOutputItem | null) => {
      setEditingRecord(record);
      setFormStep(0);
      if (record?.metadata?.name) {
        setFormLoading(true);
        fetchClusteroutputDetail(cloudId, record.metadata.name)
          .then(({ data, ok, error }) => {
            setFormLoading(false);
            if (ok && data && typeof data === 'object') {
              const d = data as ClusterOutputItem & { spec?: Record<string, unknown> };
              const spec = d.spec || {};
              const meta = d.metadata || {};
              const provider = Object.keys(spec).find(
                (k) => k !== 'loggingRef' && spec[k] != null && typeof spec[k] === 'object'
              );
              const ps = provider ? (spec[provider] as Record<string, unknown>) || {} : {};
              const labelsArr = meta.labels
                ? Object.entries(meta.labels).map(([key, value]) => ({ key, value: String(value) }))
                : [];
              form.setFieldsValue({
                name: meta.name,
                description: meta.annotations?.description ?? '',
                provider: provider || 'syslog',
                host: (ps.host as string) ?? '',
                port: (ps.port as number) ?? 514,
                bucket: (ps.bucket as string) ?? (ps.s3_bucket as string) ?? '',
                region: (ps.region as string) ?? (ps.s3_region as string) ?? '',
                accessKeyId: (ps.access_key_id as string) ?? (ps.accessKeyId as string) ?? '',
                secretKey: (ps.secret_key as string) ?? (ps.secretKey as string) ?? '',
                labels: labelsArr.length ? labelsArr : [{ key: '', value: '' }],
              });
            } else message.error(error || '获取详情失败');
          })
          .catch(() => {
            setFormLoading(false);
            message.error('获取详情失败');
          });
      } else {
        form.resetFields();
        form.setFieldsValue({
          name: '',
          description: '',
          provider: 'syslog',
          host: '',
          port: 514,
          bucket: '',
          region: '',
          accessKeyId: '',
          secretKey: '',
          labels: [{ key: '', value: '' }],
        });
      }
      setFormModalOpen(true);
    },
    [cloudId, form]
  );

  const handleCloseForm = useCallback(() => {
    setFormModalOpen(false);
    setFormStep(0);
    setEditingRecord(null);
    form.resetFields();
  }, [form]);

  const buildSpecFromForm = useCallback(
    (values: Record<string, unknown>, editing: ClusterOutputItem | null): Record<string, unknown> => {
      const provider = (values.provider ?? 'syslog') as string;
      const host = (values.host ?? '').toString().trim();
      const port = values.port != null ? Number(values.port) : 514;
      const bucket = (values.bucket ?? '').toString().trim();
      const region = (values.region ?? '').toString().trim();
      const accessKeyId = (values.accessKeyId ?? '').toString().trim();
      const secretKey = (values.secretKey ?? '').toString().trim();

      if (provider === 'syslog') {
        return { syslog: { host: host || 'localhost', port } };
      }
      if (provider === 'elasticsearch') {
        return { elasticsearch: { host: host || 'localhost', port } };
      }
      if (provider === 's3') {
        const s3: Record<string, unknown> = { bucket: bucket || 'bucket', region: region || 'us-east-1' };
        if (accessKeyId) s3.access_key_id = accessKeyId;
        if (secretKey) s3.secret_key = secretKey;
        return { s3 };
      }
      if (editing?.spec && !['syslog', 'elasticsearch', 's3'].includes(provider)) {
        return { ...editing.spec };
      }
      return { [provider]: {} };
    },
    []
  );

  const handleFormSubmit = useCallback(async () => {
    const values = await form.validateFields().catch(() => null);
    if (!values || !cloudId) return;
    const name = (values.name ?? '').toString().trim();
    if (!name) {
      message.error('请输入名称');
      return;
    }
    const labelsArr = (values.labels ?? []) as Array<{ key?: string; value?: string }>;
    const labels: Record<string, string> = {};
    labelsArr.forEach((item) => {
      const k = (item?.key ?? '').toString().trim();
      if (k) labels[k] = (item?.value ?? '').toString().trim();
    });

    const spec = buildSpecFromForm(values, editingRecord);
    const payload = {
      apiVersion: 'logging.banzaicloud.io/v1beta1',
      kind: 'ClusterOutput',
      metadata: {
        name,
        namespace: LOGGING_NS,
        ...(Object.keys(labels).length > 0 ? { labels } : {}),
        ...(values.description ? { annotations: { description: String(values.description).trim() } } : {}),
      },
      spec,
    };

    setFormLoading(true);
    if (editingRecord?.metadata?.name) {
      const { ok, error } = await updateClusteroutput(cloudId, editingRecord.metadata.name, payload);
      setFormLoading(false);
      if (ok) {
        message.success('更新成功');
        handleCloseForm();
        loadList();
      } else message.error(error || '更新失败');
    } else {
      const { data, ok, error } = await createClusteroutput(cloudId, payload);
      setFormLoading(false);
      if (ok) {
        message.success('创建成功');
        const raw = (data as ClusterOutputItem) || {};
        setList((prev) => [...prev, { ...raw, id: raw.metadata?.name, metadata: raw.metadata, spec: raw.spec }]);
        handleCloseForm();
      } else message.error(error || '创建失败');
    }
  }, [cloudId, editingRecord, form, buildSpecFromForm, handleCloseForm, loadList]);

  const handleDelete = useCallback(
    async (row: ClusterOutputItem) => {
      const name = row.metadata?.name;
      if (!name || !cloudId) {
        message.error('缺少名称');
        return;
      }
      const { ok, error } = await deleteClusteroutput(cloudId, name);
      if (ok) {
        message.success('已删除');
        setSelectedRowKeys((prev) => prev.filter((k) => k !== (row.id ?? row.metadata?.name)));
        loadList();
      } else message.error(error || '删除失败');
    },
    [cloudId, loadList]
  );

  const handleBulkDelete = useCallback(async () => {
    if (selectedRowKeys.length === 0 || !cloudId) return;
    Modal.confirm({
      title: '确定删除所选？',
      content: `已选 ${selectedRowKeys.length} 条，删除后不可恢复。`,
      okText: '删除',
      okType: 'danger',
      cancelText: '取消',
      onOk: async () => {
        const toDelete = list.filter((row) => selectedRowKeys.includes(row.id ?? row.metadata?.name ?? ''));
        for (const row of toDelete) {
          const name = row.metadata?.name;
          if (name) await deleteClusteroutput(cloudId, name);
        }
        message.success(`已删除 ${toDelete.length} 条`);
        setSelectedRowKeys([]);
        loadList();
      },
    });
  }, [selectedRowKeys, list, cloudId, loadList]);

  const filteredList = useMemo(() => {
    if (!keyword.trim()) return list;
    const k = keyword.trim().toLowerCase();
    return list.filter(
      (row) =>
        (row.metadata?.name ?? '').toLowerCase().includes(k) ||
        (row.metadata?.namespace ?? '').toLowerCase().includes(k)
    );
  }, [list, keyword]);

  const renderStatus = (row: ClusterOutputItem) => {
    const failed = row.status?.conditions?.some((c) => c.type === 'Ready' && c.status !== 'True');
    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
        <span style={{ width: 8, height: 8, borderRadius: '50%', background: failed ? '#ff4d4f' : '#52c41a' }} />
        {failed ? '异常' : '活跃'}
      </span>
    );
  };

  const renderRetention = (row: ClusterOutputItem) => {
    const retention =
      row.metadata?.annotations?.['retention'] ??
      row.metadata?.annotations?.['logging.banzaicloud.io/retention'];
    return retention ?? '-';
  };

  const columns: ColumnsType<ClusterOutputItem> = useMemo(
    () => [
      { title: '状态', key: 'status', width: 90, render: (_, row) => renderStatus(row) },
      {
        title: '名称',
        dataIndex: ['metadata', 'name'],
        key: 'name',
        width: 220,
        render: (v: string, row) => (
          <Button type="link" style={{ padding: 0 }} onClick={() => handleOpenForm(row)}>
            {v || '-'}
          </Button>
        ),
      },
      { title: '命名空间', dataIndex: ['metadata', 'namespace'], key: 'namespace', width: 180, render: (v: string) => v || '-' },
      { title: '提供商', key: 'provider', width: 120, render: (_, row) => getProviderFromSpec(row.spec) },
      { title: '存活时间', key: 'retention', width: 100, render: (_, row) => renderRetention(row) },
      {
        title: '操作',
        key: 'actions',
        width: 72,
        fixed: 'right',
        render: (_, row) => (
          <ResourceActionsDropdown
            items={[
              { key: 'edit', label: '编辑配置', onClick: () => handleOpenForm(row) },
              { type: 'divider' },
              {
                key: 'delete',
                label: '删除',
                danger: true,
                onClick: () => {
                  Modal.confirm({
                    title: '确定删除？',
                    onOk: () => handleDelete(row),
                    okText: '删除',
                    cancelText: '取消',
                    okButtonProps: { danger: true },
                  });
                },
              },
            ]}
          />
        ),
      },
    ],
    [handleOpenForm, handleDelete]
  );

  const rowSelection = {
    selectedRowKeys,
    onChange: (keys: React.Key[]) => setSelectedRowKeys(keys),
  };

  if (!cloudId) return null;

  return (
    <div>
      <PageDetailSection
        asCard={false}
        toolbarLeft={
          <>
            <Input.Search
              placeholder="请输入名称"
              allowClear
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              onSearch={loadList}
            />
            <button
              type="button"
              className="toolbar-reset-btn"
              onClick={() => {
                setKeyword('');
              }}
            >
              重置
            </button>
          </>
        }
        toolbarRight={
          <>
            <Button type="primary" icon={<PlusOutlined />} onClick={() => handleOpenForm(null)}>
              创建
            </Button>
            <Dropdown
              menu={{
                items: [
                  {
                    key: 'batchDelete',
                    label: '批量删除',
                    danger: true,
                    disabled: selectedRowKeys.length === 0,
                    onClick: () => {
                      if (selectedRowKeys.length === 0) return;
                      Modal.confirm({
                        title: '确定删除所选？',
                        content: `已选 ${selectedRowKeys.length} 条，删除后不可恢复。`,
                        okText: '删除',
                        okType: 'danger',
                        cancelText: '取消',
                        onOk: handleBulkDelete,
                      });
                    },
                  },
                ],
              }}
              trigger={['click']}
            >
              <Button icon={<EllipsisOutlined />} />
            </Dropdown>
            <Button icon={<ReloadOutlined />} onClick={loadList} loading={loading} />
          </>
        }
      >
        <Table
          className="std-table"
          bordered
          rowKey={(row: ClusterOutputItem) => row.id ?? row.metadata?.name ?? String(Math.random())}
          loading={loading}
          columns={columns}
          dataSource={filteredList}
          rowSelection={rowSelection}
          scroll={{ x: 900 }}
          pagination={{
            pageSize: 10,
            showSizeChanger: true,
            showTotal: (total: number, range: [number, number]) => `第 ${range[0]}-${range[1]} 条，共 ${total} 条`,
            pageSizeOptions: ['10', '20', '50'],
          }}
        />
      </PageDetailSection>

      <WizardModal
        open={formModalOpen}
        onCancel={handleCloseForm}
        title={editingRecord ? '编辑输出' : '创建输出'}
        width="70vw"
        bodyVh={75}
        footer={
          <Space>
            <Button onClick={handleCloseForm}>取消</Button>
            {formStep > 0 && <Button onClick={() => setFormStep(formStep - 1)}>上一步</Button>}
            {formStep < 1 ? (
              <Button
                type="primary"
                onClick={async () => {
                  try {
                    await form.validateFields(['name', 'provider']);
                    setFormStep(1);
                  } catch {
                    message.error('请填写必填项');
                  }
                }}
              >
                下一步
              </Button>
            ) : (
              <Button type="primary" loading={formLoading} onClick={handleFormSubmit}>
                {editingRecord ? '保存' : '创建'}
              </Button>
            )}
          </Space>
        }
      >
        <WizardLayout
          steps={[{ title: '基础信息' }, { title: '输出配置' }]}
          current={formStep}
          onStepChange={setFormStep}
          right={
            <>
              <Typography.Text type="secondary">配置预览</Typography.Text>
              <div style={{ marginTop: 8 }}>
                <OutputPreview form={form} />
              </div>
            </>
          }
        >
          <Form
            form={form}
            layout="vertical"
            initialValues={{
              provider: 'syslog',
              port: 514,
              labels: [{ key: '', value: '' }],
            }}
          >
            <div style={{ display: formStep === 0 ? 'block' : 'none' }}>
              <Typography.Paragraph type="secondary" style={{ marginBottom: 12, fontSize: 13 }}>
                名称、描述及输出类型。
              </Typography.Paragraph>
              <Form.Item name="name" label="名称" rules={[{ required: true, message: '请输入名称' }]}>
                <Input placeholder="名称" disabled={!!editingRecord} />
              </Form.Item>
              <Form.Item name="description" label="描述（可选）">
                <Input.TextArea rows={2} placeholder="备注" />
              </Form.Item>
              <Form.Item
                name="provider"
                label="提供商（Output）"
                rules={[{ required: true, message: '请选择提供商' }]}
              >
                <Select options={PROVIDER_OPTIONS} placeholder="选择输出类型" disabled={!!editingRecord} />
              </Form.Item>
            </div>
            <div style={{ display: formStep === 1 ? 'block' : 'none' }}>
              <Typography.Paragraph type="secondary" style={{ marginBottom: 12, fontSize: 13 }}>
                按所选提供商填写目标地址等。
              </Typography.Paragraph>
              <Form.Item
                name="provider"
                label="类型"
                rules={[{ required: true, message: '请选择类型' }]}
              >
                <Select options={PROVIDER_OPTIONS} placeholder="选择输出类型" disabled={!!editingRecord} />
              </Form.Item>
              <Form.Item noStyle shouldUpdate={(prev, curr) => prev.provider !== curr.provider}>
                {({ getFieldValue }) => {
                  const p = getFieldValue('provider');
                  if (p === 'syslog' || p === 'elasticsearch') {
                    return (
                      <>
                        <Form.Item
                          name="host"
                          label={p === 'syslog' ? 'Syslog 主机（URL 的主机地址）' : 'Elasticsearch 主机'}
                        >
                          <Input placeholder="例如 192.168.1.1 或 syslog.example.com" />
                        </Form.Item>
                        <Form.Item name="port" label="端口">
                          <Input type="number" placeholder={p === 'syslog' ? '514' : '9200'} />
                        </Form.Item>
                      </>
                    );
                  }
                  if (p === 's3') {
                    return (
                      <>
                        <Form.Item name="bucket" label="Bucket">
                          <Input placeholder="S3 存储桶名称" />
                        </Form.Item>
                        <Form.Item name="region" label="Region">
                          <Input placeholder="例如 us-east-1" />
                        </Form.Item>
                      </>
                    );
                  }
                  return (
                    <Typography.Paragraph type="secondary">
                      当前提供商无需在此填写主要连接参数，可在下方高级选项中补充。
                    </Typography.Paragraph>
                  );
                }}
              </Form.Item>
              <div>
                <Collapse
                  ghost
                  defaultActiveKey={['advanced']}
                  items={[
                    {
                      key: 'advanced',
                      label: <span style={{ fontSize: 13, color: 'rgba(0,0,0,0.65)' }}>高级选项</span>,
                      children: (
                        <>
                          <Divider style={{ margin: 0 }} />
                          <div style={{ paddingTop: 12, paddingBottom: 8 }}>
                            <Form.Item name="accessKeyId" label="访问密钥 ID" style={{ marginBottom: 16 }}>
                              <Input.Password placeholder="可选，如 S3 Access Key ID" autoComplete="off" />
                            </Form.Item>
                            <Form.Item name="secretKey" label="Secret Key" style={{ marginBottom: 20 }}>
                              <Input.Password placeholder="可选，如 S3 Secret Key" autoComplete="off" />
                            </Form.Item>
                            <Form.Item label="标签" style={{ marginBottom: 0 }}>
                              <Form.List name="labels">
                                {(fields, { add, remove }) => (
                                  <>
                                    {fields.map(({ key, name, ...rest }) => (
                                      <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, width: '100%' }}>
                                        <Form.Item {...rest} name={[name, 'key']} noStyle style={{ flex: 1, marginBottom: 0 }}>
                                          <Input placeholder="键" />
                                        </Form.Item>
                                        <Form.Item {...rest} name={[name, 'value']} noStyle style={{ flex: 1, marginBottom: 0 }}>
                                          <Input placeholder="值" />
                                        </Form.Item>
                                        <Button type="link" danger size="small" onClick={() => remove(name)} style={{ flexShrink: 0 }}>
                                          删除
                                        </Button>
                                      </div>
                                    ))}
                                    <Button type="dashed" onClick={() => add({ key: '', value: '' })} icon={<PlusOutlined />} size="small">
                                      添加标签
                                    </Button>
                                  </>
                                )}
                              </Form.List>
                            </Form.Item>
                          </div>
                        </>
                      ),
                    },
                  ]}
                />
              </div>
            </div>
          </Form>
        </WizardLayout>
      </WizardModal>
    </div>
  );
};

export default LogOutputs;
