/**
 * 监控服务 - 集群日志配置（ClusterFlow）
 * 设计文档：plan/设计-监控服务-集群日志配置.md
 * 参考 Compute.Tower-Monitoring LogsConfigPage；节点用主项目 logging/nodes，组件复用主项目。
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Button,
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
import TableColumnSettings from '../../../../components/TableColumnSettings';
import ResourceActionsDropdown from '../../../../components/ResourceActionsDropdown';
import { WizardModal, WizardLayout } from '../../../../components/WizardShell';
import {
  fetchClusterflows,
  fetchClusterflowDetail,
  createClusterflow,
  updateClusterflow,
  deleteClusterflow,
  fetchClusteroutputs,
  fetchLoggingNodes,
} from '../../../../services/loggingApi';

const LOGGING_NS = 'cattle-logging-system';
const FLOW_TYPE_OPTIONS = [
  { label: 'Logging', value: 'Logging' },
  { label: 'Audit', value: 'Audit' },
  { label: 'Event', value: 'Event' },
];
const AUDIT_LOGGING_REF = 'harvester-kube-audit-log-ref';
const EVENT_TAILER_LABEL = 'app.kubernetes.io/name';
const EVENT_TAILER_VALUE = 'event-tailer';

interface ClusterFlowItem {
  id?: string;
  metadata?: { name?: string; namespace?: string; annotations?: Record<string, string>; creationTimestamp?: string };
  spec?: {
    match?: Array<{ select?: { hosts?: string[]; labels?: Record<string, string> }; exclude?: { hosts?: string[] } }>;
    loggingRef?: string;
    globalOutputRefs?: string[];
    localOutputRefs?: string[];
  };
  status?: { conditions?: Array<{ type?: string; status?: string }> };
}

function normalizeListPayload(res: any): ClusterFlowItem[] {
  if (!res || typeof res !== 'object') return [];
  let list: any[] = [];
  if (Array.isArray(res.data)) list = res.data;
  else if (Array.isArray(res.data?.data)) list = res.data.data;
  else if (Array.isArray(res.items)) list = res.items;
  return list.map((item: any) => ({
    ...item,
    id: item.id ?? item.metadata?.name ?? `${item.metadata?.namespace ?? ''}/${item.metadata?.name ?? ''}`,
  }));
}

function parseMatchFromSpec(spec: ClusterFlowItem['spec']): {
  flowType: string;
  includeHosts: string[];
  excludeHosts: string[];
} {
  const flowType =
    spec?.loggingRef === AUDIT_LOGGING_REF
      ? 'Audit'
      : (spec?.match ?? []).some((m) => m?.select?.labels?.[EVENT_TAILER_LABEL] === EVENT_TAILER_VALUE)
        ? 'Event'
        : 'Logging';
  const includeHosts: string[] = [];
  const excludeHosts: string[] = [];
  const match = spec?.match ?? [];
  for (const m of match) {
    if (m?.select?.hosts?.length) includeHosts.push(...m.select.hosts);
    if (m?.exclude?.hosts?.length) excludeHosts.push(...m.exclude.hosts);
  }
  return { flowType, includeHosts, excludeHosts };
}

function LogFlowPreview({ form }: { form: ReturnType<typeof Form.useForm>[0] }) {
  const name = Form.useWatch('name', form) ?? '';
  const description = Form.useWatch('description', form) ?? '';
  const flowType = Form.useWatch('flowType', form) ?? 'Logging';
  const includeHosts = (Form.useWatch('includeHosts', form) ?? []) as string[];
  const excludeHosts = (Form.useWatch('excludeHosts', form) ?? []) as string[];
  const globalOutputRefs = (Form.useWatch('globalOutputRefs', form) ?? []) as string[];
  const parts: string[] = [];
  if (includeHosts.length) parts.push(`仅限 ${includeHosts.length} 节点`);
  if (excludeHosts.length) parts.push(`排除 ${excludeHosts.length} 节点`);
  const summary = parts.length ? parts.join('；') : '-';
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div><span style={{ color: 'rgba(0,0,0,0.45)', marginRight: 8 }}>名称</span><span>{name || '-'}</span></div>
      <div><span style={{ color: 'rgba(0,0,0,0.45)', marginRight: 8 }}>描述</span><span>{(description || '').trim() || '-'}</span></div>
      <div><span style={{ color: 'rgba(0,0,0,0.45)', marginRight: 8 }}>类型</span><span>{flowType}</span></div>
      <div><span style={{ color: 'rgba(0,0,0,0.45)', marginRight: 8 }}>匹配规则</span><span>{summary}</span></div>
      <div><span style={{ color: 'rgba(0,0,0,0.45)', marginRight: 8 }}>输出引用</span><span>{globalOutputRefs.length ? globalOutputRefs.join('、') : '-'}</span></div>
    </div>
  );
}

interface LogsConfigProps {
  cloudId: string;
}

const LogsConfig: React.FC<LogsConfigProps> = ({ cloudId }) => {
  const [configList, setConfigList] = useState<ClusterFlowItem[]>([]);
  const [configLoading, setConfigLoading] = useState(false);
  const [keyword, setKeyword] = useState('');
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([]);
  const [formModalOpen, setFormModalOpen] = useState(false);
  const [formStep, setFormStep] = useState(0);
  const [editingRecord, setEditingRecord] = useState<ClusterFlowItem | null>(null);
  const [formLoading, setFormLoading] = useState(false);
  const [outputList, setOutputList] = useState<string[]>([]);
  const [outputLoading, setOutputLoading] = useState(false);
  const [nodeOptions, setNodeOptions] = useState<Array<{ label: string; value: string }>>([]);
  const [nodeLoading, setNodeLoading] = useState(false);
  const [tableColumns, setTableColumns] = useState<ColumnsType<ClusterFlowItem>>([]);
  const [form] = Form.useForm();

  const loadConfigList = useCallback(async () => {
    if (!cloudId) return;
    setConfigLoading(true);
    const { data, ok, error } = await fetchClusterflows(cloudId);
    setConfigLoading(false);
    if (!ok) {
      message.error(error || '加载列表失败');
      setConfigList([]);
      return;
    }
    setConfigList(normalizeListPayload(data));
  }, [cloudId]);

  const loadOutputList = useCallback(async () => {
    if (!cloudId) return;
    setOutputLoading(true);
    const { data, ok } = await fetchClusteroutputs(cloudId);
    setOutputLoading(false);
    if (!ok) {
      setOutputList([]);
      return;
    }
    const list = normalizeListPayload(data);
    setOutputList(list.map((item: any) => item.metadata?.name ?? item.name ?? '').filter(Boolean));
  }, [cloudId]);

  const loadNodeOptions = useCallback(async () => {
    if (!cloudId) return;
    setNodeLoading(true);
    const { data, ok } = await fetchLoggingNodes(cloudId);
    setNodeLoading(false);
    if (!ok) {
      setNodeOptions([]);
      return;
    }
    const list = normalizeListPayload(data);
    setNodeOptions(
      list
        .map((n: any) => {
          const name = n.metadata?.name ?? n.name ?? n.id ?? '';
          const display = n.metadata?.name ?? n.name ?? n.id ?? '-';
          return { label: display, value: name };
        })
        .filter((o: { value: string }) => o.value)
    );
  }, [cloudId]);

  useEffect(() => {
    if (cloudId) loadConfigList();
  }, [loadConfigList, cloudId]);

  useEffect(() => {
    if (formModalOpen && cloudId) {
      loadOutputList();
      loadNodeOptions();
    }
  }, [formModalOpen, cloudId, loadOutputList, loadNodeOptions]);

  const handleOpenForm = useCallback(
    (record: ClusterFlowItem | null) => {
      setFormStep(0);
      setEditingRecord(record);
      if (record?.metadata?.name && cloudId) {
        setFormLoading(true);
        fetchClusterflowDetail(cloudId, record.metadata.name)
          .then(({ data, ok, error }) => {
            setFormLoading(false);
            if (ok && data && typeof data === 'object') {
              const d = data as any;
              const raw = d?.data != null && typeof d.data === 'object' ? d.data : d;
              const annotations = raw.metadata?.annotations ?? {};
              const { flowType, includeHosts, excludeHosts } = parseMatchFromSpec(raw.spec);
              const refs = raw.spec?.globalOutputRefs ?? raw.spec?.localOutputRefs ?? [];
              form.setFieldsValue({
                name: raw.metadata?.name,
                description: annotations.description ?? '',
                flowType,
                includeHosts,
                excludeHosts,
                globalOutputRefs: refs,
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
          flowType: 'Logging',
          includeHosts: [],
          excludeHosts: [],
          globalOutputRefs: [],
        });
      }
      setFormModalOpen(true);
    },
    [form, cloudId]
  );

  const handleCloseForm = useCallback(() => {
    setFormModalOpen(false);
    setFormStep(0);
    setEditingRecord(null);
    form.resetFields();
  }, [form]);

  const handleFormSubmit = useCallback(async () => {
    const values = await form.validateFields().catch(() => null);
    if (!values || !cloudId) return;
    const name = (values.name ?? '').toString().trim();
    if (!name) {
      message.error('请输入名称');
      return;
    }
    const globalOutputRefs = Array.isArray(values.globalOutputRefs) ? values.globalOutputRefs : [];
    if (globalOutputRefs.length === 0) {
      message.error('请至少选择一个输出');
      return;
    }

    const flowType = (values.flowType ?? 'Logging') as string;
    const includeHosts = (Array.isArray(values.includeHosts) ? values.includeHosts : []).filter((h: string) => (h ?? '').toString().trim());
    const excludeHosts = (Array.isArray(values.excludeHosts) ? values.excludeHosts : []).filter((h: string) => (h ?? '').toString().trim());
    const matchPayload: Array<{ select?: { hosts?: string[]; labels?: Record<string, string> }; exclude?: { hosts?: string[] } }> = [];
    if (includeHosts.length) matchPayload.push({ select: { hosts: includeHosts } });
    if (excludeHosts.length) matchPayload.push({ exclude: { hosts: excludeHosts } });
    if (flowType === 'Event') {
      matchPayload.push({ select: { labels: { [EVENT_TAILER_LABEL]: EVENT_TAILER_VALUE } } });
    }

    const spec: ClusterFlowItem['spec'] = {
      globalOutputRefs,
      ...(matchPayload.length > 0 ? { match: matchPayload } : {}),
    };
    if (flowType === 'Audit') {
      spec.loggingRef = AUDIT_LOGGING_REF;
    }

    const payload = {
      apiVersion: 'logging.banzaicloud.io/v1beta1',
      kind: 'ClusterFlow',
      metadata: {
        name,
        namespace: LOGGING_NS,
        ...(values.description ? { annotations: { description: String(values.description).trim() } } : {}),
      },
      spec,
    };

    setFormLoading(true);
    if (editingRecord?.metadata?.name) {
      const { ok, error } = await updateClusterflow(cloudId, editingRecord.metadata.name, payload);
      setFormLoading(false);
      if (ok) {
        message.success('更新成功');
        handleCloseForm();
        loadConfigList();
      } else message.error(error || '更新失败');
    } else {
      const { data, ok, error } = await createClusterflow(cloudId, payload);
      setFormLoading(false);
      if (ok) {
        message.success('创建成功');
        const raw = (data as any) || {};
        setConfigList((prev) => [...prev, { ...raw, id: raw.metadata?.name, metadata: raw.metadata, spec: raw.spec }]);
        handleCloseForm();
      } else message.error(error || '创建失败');
    }
  }, [editingRecord, form, handleCloseForm, loadConfigList, cloudId]);

  const handleDelete = useCallback(
    async (row: ClusterFlowItem) => {
      const name = row.metadata?.name;
      if (!name || !cloudId) {
        message.error('缺少名称');
        return;
      }
      const { ok, error } = await deleteClusterflow(cloudId, name);
      if (ok) {
        message.success('已删除');
        setSelectedRowKeys((prev) => prev.filter((k) => k !== (row.id ?? row.metadata?.name)));
        loadConfigList();
      } else message.error(error || '删除失败');
    },
    [loadConfigList, cloudId]
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
        const toDelete = configList.filter((row) => selectedRowKeys.includes(row.id ?? row.metadata?.name ?? ''));
        for (const row of toDelete) {
          const name = row.metadata?.name;
          if (name) await deleteClusterflow(cloudId, name);
        }
        message.success(`已删除 ${toDelete.length} 条`);
        setSelectedRowKeys([]);
        loadConfigList();
      },
    });
  }, [selectedRowKeys, configList, loadConfigList, cloudId]);

  const filteredList = useMemo(() => {
    let list = configList;
    if (keyword.trim()) {
      const k = keyword.trim().toLowerCase();
      list = list.filter(
        (row) =>
          (row.metadata?.name ?? '').toLowerCase().includes(k) ||
          (row.spec?.globalOutputRefs ?? row.spec?.localOutputRefs ?? []).join(' ').toLowerCase().includes(k)
      );
    }
    return list;
  }, [configList, keyword]);

  const outputOptions = useMemo(() => outputList.map((name) => ({ label: name, value: name })), [outputList]);

  const renderStatus = (row: ClusterFlowItem) => {
    const failed = row.status?.conditions?.some((c) => c.type === 'Ready' && c.status !== 'True');
    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
        <span style={{ width: 8, height: 8, borderRadius: '50%', background: failed ? '#ff4d4f' : '#52c41a' }} />
        {failed ? '异常' : '活跃'}
      </span>
    );
  };

  const allColumns: ColumnsType<ClusterFlowItem> = useMemo(
    () => [
      { title: '状态', key: 'status', width: 90, render: (_, row) => renderStatus(row) },
      { title: '名称', dataIndex: ['metadata', 'name'], key: 'name', width: 200, render: (v: string) => v || '-' },
      { title: '命名空间', dataIndex: ['metadata', 'namespace'], key: 'namespace', width: 180, render: (v: string) => v || '-' },
      {
        title: '集群输出',
        key: 'outputs',
        width: 220,
        render: (_, row) => (row.spec?.globalOutputRefs ?? row.spec?.localOutputRefs ?? []).join(', ') || '-',
      },
      {
        title: '操作',
        key: 'action',
        width: 80,
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

  const displayColumns = tableColumns.length > 0 ? tableColumns : allColumns;
  const rowSelection = { selectedRowKeys, onChange: (keys: React.Key[]) => setSelectedRowKeys(keys) };

  return (
    <div>
      <PageDetailSection
        asCard={false}
        toolbarLeft={
          <Input.Search
            placeholder="请输入名称"
            allowClear
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            onSearch={loadConfigList}
          />
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
                    onClick: handleBulkDelete,
                  },
                ],
              }}
              trigger={['click']}
            >
              <Button icon={<EllipsisOutlined />} />
            </Dropdown>
            <TableColumnSettings columns={allColumns} onChange={setTableColumns} settingsKey="logs_config_clusterflow_table" />
            <Button icon={<ReloadOutlined />} onClick={loadConfigList} loading={configLoading} />
          </>
        }
      >
        <Table
          className="std-table"
          bordered
          rowKey={(row: ClusterFlowItem) => row.id ?? row.metadata?.name ?? String(Math.random())}
          loading={configLoading}
          columns={displayColumns}
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
        title={editingRecord ? '编辑日志配置' : '新增日志配置'}
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
                    await form.validateFields(['name']);
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
          steps={[{ title: '基础信息' }, { title: '匹配规则与输出配置' }]}
          current={formStep}
          onStepChange={setFormStep}
          right={
            <>
              <Typography.Text type="secondary">配置预览</Typography.Text>
              <div style={{ marginTop: 8 }}>
                <LogFlowPreview form={form} />
              </div>
            </>
          }
        >
          <Form
            form={form}
            layout="vertical"
            initialValues={{ flowType: 'Logging', includeHosts: [], excludeHosts: [], globalOutputRefs: [] }}
          >
            <div style={{ display: formStep === 0 ? 'block' : 'none' }}>
              <Typography.Paragraph type="secondary" style={{ marginBottom: 12, fontSize: 13 }}>
                配置名称与描述。
              </Typography.Paragraph>
              <Form.Item name="name" label="名称" rules={[{ required: true, message: '请输入名称' }]}>
                <Input placeholder="名称" disabled={!!editingRecord} />
              </Form.Item>
              <Form.Item name="description" label="描述（可选）">
                <Input.TextArea rows={2} placeholder="备注" />
              </Form.Item>
            </div>
            <div style={{ display: formStep === 1 ? 'block' : 'none' }}>
              <Typography.Paragraph type="secondary" style={{ marginBottom: 12, fontSize: 13 }}>
                选择日志类型、节点范围及输出目标。
              </Typography.Paragraph>
              <Form.Item name="flowType" label="类型" rules={[{ required: true }]}>
                <Select options={FLOW_TYPE_OPTIONS} placeholder="Logging / Audit / Event" disabled={!!editingRecord} />
              </Form.Item>
              <Form.Item name="includeHosts" label="仅限以下节点">
                <Select
                  mode="multiple"
                  placeholder="不选表示不限制节点"
                  allowClear
                  loading={nodeLoading}
                  options={nodeOptions}
                  style={{ width: '100%' }}
                />
              </Form.Item>
              <Form.Item name="excludeHosts" label="排除以下节点">
                <Select
                  mode="multiple"
                  placeholder="不选表示不排除"
                  allowClear
                  loading={nodeLoading}
                  options={nodeOptions}
                  style={{ width: '100%' }}
                />
              </Form.Item>
              <Form.Item name="globalOutputRefs" label="输出" rules={[{ required: true, message: '请至少选择一个输出' }]}>
                <Select mode="multiple" placeholder="选择 ClusterOutput" loading={outputLoading} options={outputOptions} />
              </Form.Item>
            </div>
          </Form>
        </WizardLayout>
      </WizardModal>
    </div>
  );
};

export default LogsConfig;
