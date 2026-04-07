/**
 * 监控服务 - 命名空间日志配置（Flow，namespaced）
 * 设计文档：plan/设计-监控服务-资源组日志配置.md
 * 参考集群日志配置 LogsConfig.tsx；按命名空间维度，引用 Output + ClusterOutput。
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
import ResourceActionsDropdown from '../../../../components/ResourceActionsDropdown';
import { WizardModal, WizardLayout } from '../../../../components/WizardShell';
import { useAuth } from '../../../../contexts/AuthContext';
import {
  fetchFlows,
  fetchFlowDetail,
  createFlow,
  updateFlow,
  deleteFlow,
  fetchOutputs,
  fetchClusteroutputs,
  fetchLoggingNodes,
} from '../../../../services/loggingApi';
import { fetchAllowedNamespaces } from '../../../../services/monitoringApi';
import { fetchHarvesterNamespaces } from '../../../../services/harvesterApi';
import { LOGGING_API_VERSION } from './constants';

const FLOW_TYPE_OPTIONS = [
  { label: 'Logging', value: 'Logging' },
  { label: 'Audit', value: 'Audit' },
  { label: 'Event', value: 'Event' },
];
const AUDIT_LOGGING_REF = 'harvester-kube-audit-log-ref';
const EVENT_TAILER_LABEL = 'app.kubernetes.io/name';
const EVENT_TAILER_VALUE = 'event-tailer';

function getOrgIdFromNamespace(ns: string): string | null {
  const match = ns.match(/^ns-([a-z0-9]+)$/);
  return match ? match[1] : null;
}

interface FlowItem {
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

function normalizeListPayload(res: unknown): FlowItem[] {
  if (!res || typeof res !== 'object') return [];
  let list: unknown[] = [];
  const o = res as Record<string, unknown>;
  if (Array.isArray(o.data)) list = o.data;
  else if (Array.isArray((o.data as Record<string, unknown>)?.data)) list = (o.data as Record<string, unknown[]>).data;
  else if (Array.isArray(o.items)) list = o.items;
  return list.map((item: unknown) => {
    const i = item as FlowItem;
    return { ...i, id: i.id ?? `${i.metadata?.namespace ?? ''}/${i.metadata?.name ?? ''}` };
  });
}

function parseMatchFromSpec(spec: FlowItem['spec']): { flowType: string; includeHosts: string[]; excludeHosts: string[] } {
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

function FlowPreview({ form }: { form: ReturnType<typeof Form.useForm>[0] }) {
  const name = Form.useWatch('name', form) ?? '';
  const namespace = Form.useWatch('namespace', form) ?? '';
  const description = Form.useWatch('description', form) ?? '';
  const flowType = Form.useWatch('flowType', form) ?? 'Logging';
  const includeHosts = (Form.useWatch('includeHosts', form) ?? []) as string[];
  const excludeHosts = (Form.useWatch('excludeHosts', form) ?? []) as string[];
  const localOutputRefs = (Form.useWatch('localOutputRefs', form) ?? []) as string[];
  const globalOutputRefs = (Form.useWatch('globalOutputRefs', form) ?? []) as string[];
  const parts: string[] = [];
  if (includeHosts.length) parts.push(`仅限 ${includeHosts.length} 节点`);
  if (excludeHosts.length) parts.push(`排除 ${excludeHosts.length} 节点`);
  const summary = parts.length ? parts.join('；') : '-';
  const refs = [...localOutputRefs, ...globalOutputRefs].filter(Boolean);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div><span style={{ color: 'rgba(0,0,0,0.45)', marginRight: 8 }}>名称</span><span>{name || '-'}</span></div>
      <div><span style={{ color: 'rgba(0,0,0,0.45)', marginRight: 8 }}>命名空间</span><span>{namespace || '-'}</span></div>
      <div><span style={{ color: 'rgba(0,0,0,0.45)', marginRight: 8 }}>描述</span><span>{(description || '').trim() || '-'}</span></div>
      <div><span style={{ color: 'rgba(0,0,0,0.45)', marginRight: 8 }}>类型</span><span>{flowType}</span></div>
      <div><span style={{ color: 'rgba(0,0,0,0.45)', marginRight: 8 }}>匹配规则</span><span>{summary}</span></div>
      <div><span style={{ color: 'rgba(0,0,0,0.45)', marginRight: 8 }}>输出引用</span><span>{refs.length ? refs.join('、') : '-'}</span></div>
    </div>
  );
}

interface LogsFlowConfigProps {
  cloudId: string;
}

const LogsFlowConfig: React.FC<LogsFlowConfigProps> = ({ cloudId }) => {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin' || user?.role === 'super_admin';

  const [configList, setConfigList] = useState<FlowItem[]>([]);
  const [configLoading, setConfigLoading] = useState(false);
  const [keyword, setKeyword] = useState('');
  const [namespaceFilter, setNamespaceFilter] = useState<string>('');
  const [namespaceOptions, setNamespaceOptions] = useState<Array<{ label: string; value: string }>>([]);
  const [namespaceLoading, setNamespaceLoading] = useState(false);
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([]);
  const [formModalOpen, setFormModalOpen] = useState(false);
  const [formStep, setFormStep] = useState(0);
  const [editingRecord, setEditingRecord] = useState<FlowItem | null>(null);
  const [formLoading, setFormLoading] = useState(false);
  const [localOutputOptions, setLocalOutputOptions] = useState<Array<{ label: string; value: string }>>([]);
  const [globalOutputOptions, setGlobalOutputOptions] = useState<Array<{ label: string; value: string }>>([]);
  const [outputLoading, setOutputLoading] = useState(false);
  const [nodeOptions, setNodeOptions] = useState<Array<{ label: string; value: string }>>([]);
  const [nodeLoading, setNodeLoading] = useState(false);
  const [form] = Form.useForm();

  const loadConfigList = useCallback(async () => {
    if (!cloudId) return;
    setConfigLoading(true);
    const opts: { namespace?: string } = {};
    if (namespaceFilter) opts.namespace = namespaceFilter;
    const { data, ok, error } = await fetchFlows(cloudId, opts);
    setConfigLoading(false);
    if (!ok) {
      message.error(error || '加载列表失败');
      setConfigList([]);
      return;
    }
    setConfigList(normalizeListPayload(data));
  }, [cloudId, namespaceFilter]);

  const loadNamespaceOptions = useCallback(async () => {
    if (!cloudId) return;
    setNamespaceLoading(true);
    try {
      if (isAdmin) {
        const res: any = await fetchHarvesterNamespaces(cloudId, false, true); // excludeSystem=true
        const items: any[] = Array.isArray(res?.data?.items) ? res.data.items : res?.data ?? res?.items ?? [];
        const raw = items
          .map((i: any) => i?.metadata?.name ?? i?.name)
          .filter((n: unknown): n is string => typeof n === 'string' && n.length > 0); // 后端已过滤系统命名空间
        const uniq = [...new Set(raw)].sort();
        setNamespaceOptions([{ label: '全部', value: '' }, ...uniq.map((ns) => {
          const orgId = getOrgIdFromNamespace(ns);
          return { label: orgId ? `${ns} (组织: ${orgId})` : ns, value: ns };
        })]);
      } else {
        const { data, ok } = await fetchAllowedNamespaces(cloudId);
        if (ok && data?.namespaces?.length) {
          const ns = data.namespaces as string[];
          setNamespaceOptions([{ label: '全部', value: '' }, ...ns.map((n) => ({ label: n, value: n }))]);
        } else setNamespaceOptions([]);
      }
    } catch {
      setNamespaceOptions([]);
    } finally {
      setNamespaceLoading(false);
    }
  }, [cloudId, isAdmin]);

  const loadOutputOptions = useCallback(async (namespaceOverride?: string) => {
    if (!cloudId) return;
    setOutputLoading(true);
    const formNs = namespaceOverride ?? form.getFieldValue('namespace') ?? '';
    const [outRes, clusterRes] = await Promise.all([
      formNs ? fetchOutputs(cloudId, { namespace: formNs }) : Promise.resolve({ data: [], ok: true }),
      fetchClusteroutputs(cloudId),
    ]);
    setOutputLoading(false);
    const localList = normalizeListPayload(outRes.ok ? outRes.data : []);
    const globalList = normalizeListPayload(clusterRes.ok ? clusterRes.data : []);
    setLocalOutputOptions(
      localList.map((i: any) => ({ label: i.metadata?.name ?? i.name ?? '', value: i.metadata?.name ?? i.name ?? '' })).filter((o: { value: string }) => o.value)
    );
    setGlobalOutputOptions(
      globalList.map((i: any) => ({ label: i.metadata?.name ?? i.name ?? '', value: i.metadata?.name ?? i.name ?? '' })).filter((o: { value: string }) => o.value)
    );
  }, [cloudId, form]);

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
          return { label: name || '-', value: name };
        })
        .filter((o: { value: string }) => o.value)
    );
  }, [cloudId]);

  useEffect(() => {
    if (cloudId) loadConfigList();
  }, [loadConfigList, cloudId]);

  useEffect(() => {
    if (cloudId) loadNamespaceOptions();
  }, [cloudId, isAdmin, loadNamespaceOptions]);

  useEffect(() => {
    if (formModalOpen && cloudId) {
      loadOutputOptions();
      loadNodeOptions();
    }
  }, [formModalOpen, cloudId, loadOutputOptions, loadNodeOptions]);

  const handleOpenForm = useCallback(
    (record: FlowItem | null) => {
      setFormStep(0);
      setEditingRecord(record);
      if (record?.metadata?.name && record?.metadata?.namespace && cloudId) {
        setFormLoading(true);
        fetchFlowDetail(cloudId, record.metadata.namespace, record.metadata.name)
          .then(({ data, ok, error }) => {
            setFormLoading(false);
            if (ok && data && typeof data === 'object') {
              const d = data as any;
              const raw = d?.data != null && typeof d.data === 'object' ? d.data : d;
              const annotations = raw.metadata?.annotations ?? {};
              const { flowType, includeHosts, excludeHosts } = parseMatchFromSpec(raw.spec);
              const localRefs = raw.spec?.localOutputRefs ?? [];
              const globalRefs = raw.spec?.globalOutputRefs ?? [];
              form.setFieldsValue({
                name: raw.metadata?.name,
                namespace: raw.metadata?.namespace,
                description: annotations.description ?? '',
                flowType,
                includeHosts,
                excludeHosts,
                localOutputRefs: localRefs,
                globalOutputRefs: globalRefs,
              });
            } else message.error(error || '获取详情失败');
          })
          .catch(() => {
            setFormLoading(false);
            message.error('获取详情失败');
          });
      } else {
        form.resetFields();
        const firstNs = namespaceOptions.find((o) => o.value)?.value ?? '';
        form.setFieldsValue({
          name: '',
          namespace: firstNs,
          description: '',
          flowType: 'Logging',
          includeHosts: [],
          excludeHosts: [],
          localOutputRefs: [],
          globalOutputRefs: [],
        });
      }
      setFormModalOpen(true);
    },
    [form, cloudId, namespaceOptions]
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
    const namespace = (values.namespace ?? '').toString().trim();
    if (!name) {
      message.error('请输入名称');
      return;
    }
    if (!namespace) {
      message.error('请选择命名空间');
      return;
    }
    const localOutputRefs = Array.isArray(values.localOutputRefs) ? values.localOutputRefs : [];
    const globalOutputRefs = Array.isArray(values.globalOutputRefs) ? values.globalOutputRefs : [];
    if (localOutputRefs.length === 0 && globalOutputRefs.length === 0) {
      message.error('请至少选择一个输出（命名空间输出或集群输出）');
      return;
    }

    const flowType = (values.flowType ?? 'Logging') as string;
    const includeHosts = (Array.isArray(values.includeHosts) ? values.includeHosts : []).filter((h: string) => (h ?? '').toString().trim());
    const excludeHosts = (Array.isArray(values.excludeHosts) ? values.excludeHosts : []).filter((h: string) => (h ?? '').toString().trim());
    // 所有 match 规则放在同一条：一个 select（hosts + labels）+ 一个 exclude（hosts）
    const selectEntry: { hosts?: string[]; labels?: Record<string, string> } = {};
    if (includeHosts.length) selectEntry.hosts = includeHosts;
    if (flowType === 'Event') selectEntry.labels = { [EVENT_TAILER_LABEL]: EVENT_TAILER_VALUE };
    const singleMatch: { select?: { hosts?: string[]; labels?: Record<string, string> }; exclude?: { hosts?: string[] } } = {};
    if (Object.keys(selectEntry).length > 0) singleMatch.select = selectEntry;
    if (excludeHosts.length) singleMatch.exclude = { hosts: excludeHosts };
    const matchPayload = Object.keys(singleMatch).length > 0 ? [singleMatch] : [];

    const spec: FlowItem['spec'] = {
      ...(localOutputRefs.length > 0 ? { localOutputRefs } : {}),
      ...(globalOutputRefs.length > 0 ? { globalOutputRefs } : {}),
      ...(matchPayload.length > 0 ? { match: matchPayload } : {}),
    };
    if (flowType === 'Audit') spec.loggingRef = AUDIT_LOGGING_REF;

    const metadata: Record<string, unknown> = {
      name,
      namespace,
      ...(values.description ? { annotations: { description: String(values.description).trim() } } : {}),
    };
    // 更新时拉取最新 resourceVersion/uid，避免 409 Conflict
    if (editingRecord?.metadata?.name && editingRecord?.metadata?.namespace) {
      const { data: latest } = await fetchFlowDetail(cloudId, editingRecord.metadata.namespace, editingRecord.metadata.name);
      const latestMeta = (latest as any)?.metadata;
      if (latestMeta?.resourceVersion != null) metadata.resourceVersion = latestMeta.resourceVersion;
      if (latestMeta?.uid != null) metadata.uid = latestMeta.uid;
    }
    const payload = {
      apiVersion: LOGGING_API_VERSION,
      kind: 'Flow',
      metadata,
      spec,
    };

    setFormLoading(true);
    if (editingRecord?.metadata?.name && editingRecord?.metadata?.namespace) {
      const { ok, error } = await updateFlow(
        cloudId,
        editingRecord.metadata.namespace,
        editingRecord.metadata.name,
        payload
      );
      setFormLoading(false);
      if (ok) {
        message.success('更新成功');
        handleCloseForm();
        loadConfigList();
      } else message.error(error || '更新失败');
    } else {
      const { data, ok, error } = await createFlow(cloudId, payload);
      setFormLoading(false);
      if (ok) {
        message.success('创建成功');
        const raw = (data as FlowItem) || {};
        setConfigList((prev) => [...prev, { ...raw, id: `${namespace}/${name}`, metadata: raw.metadata ?? { name, namespace }, spec: raw.spec }]);
        handleCloseForm();
      } else message.error(error || '创建失败');
    }
  }, [editingRecord, form, handleCloseForm, loadConfigList, cloudId]);

  const handleDelete = useCallback(
    async (row: FlowItem) => {
      const ns = row.metadata?.namespace;
      const name = row.metadata?.name;
      if (!ns || !name || !cloudId) {
        message.error('缺少命名空间或名称');
        return;
      }
      const { ok, error } = await deleteFlow(cloudId, ns, name);
      if (ok) {
        message.success('已删除');
        setSelectedRowKeys((prev) => prev.filter((k) => k !== (row.id ?? `${ns}/${name}`)));
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
        const toDelete = configList.filter((row) => selectedRowKeys.includes(row.id ?? `${row.metadata?.namespace ?? ''}/${row.metadata?.name ?? ''}`));
        for (const row of toDelete) {
          const ns = row.metadata?.namespace;
          const name = row.metadata?.name;
          if (ns && name) await deleteFlow(cloudId, ns, name);
        }
        message.success(`已删除 ${toDelete.length} 条`);
        setSelectedRowKeys([]);
        loadConfigList();
      },
    });
  }, [selectedRowKeys, configList, loadConfigList, cloudId]);

  const filteredList = useMemo(() => {
    if (!keyword.trim()) return configList;
    const k = keyword.trim().toLowerCase();
    return configList.filter(
      (row) =>
        (row.metadata?.name ?? '').toLowerCase().includes(k) ||
        (row.metadata?.namespace ?? '').toLowerCase().includes(k) ||
        (row.spec?.globalOutputRefs ?? row.spec?.localOutputRefs ?? []).join(' ').toLowerCase().includes(k)
    );
  }, [configList, keyword]);

  const renderStatus = (row: FlowItem) => {
    const failed = row.status?.conditions?.some((c) => c.type === 'Ready' && c.status !== 'True');
    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
        <span style={{ width: 8, height: 8, borderRadius: '50%', background: failed ? '#ff4d4f' : '#52c41a' }} />
        {failed ? '异常' : '活跃'}
      </span>
    );
  };

  const allColumns: ColumnsType<FlowItem> = useMemo(
    () => [
      { title: '状态', key: 'status', width: 90, render: (_, row) => renderStatus(row) },
      {
        title: '名称',
        dataIndex: ['metadata', 'name'],
        key: 'name',
        width: 200,
        render: (v: string, row) => (
          <Button type="link" style={{ padding: 0 }} onClick={() => handleOpenForm(row)}>
            {v || '-'}
          </Button>
        ),
      },
      {
        title: '命名空间',
        dataIndex: ['metadata', 'namespace'],
        key: 'namespace',
        width: 160,
        render: (v: string) => v || '-',
      },
      {
        title: '归属租户/组织',
        key: 'tenant',
        width: 140,
        render: (_, row) => {
          const ns = row?.metadata?.namespace || '';
          const orgId = getOrgIdFromNamespace(ns);
          return orgId ? (
            <span style={{ color: 'rgba(0,0,0,0.65)', fontSize: 12 }}>
              组织: {orgId}
            </span>
          ) : '-';
        },
      },
      {
        title: '命名空间输出',
        key: 'localOutputRefs',
        width: 180,
        render: (_, row) => (row.spec?.localOutputRefs ?? []).join(', ') || '-',
      },
      {
        title: '集群输出',
        key: 'globalOutputRefs',
        width: 180,
        render: (_, row) => (row.spec?.globalOutputRefs ?? []).join(', ') || '-',
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

  const rowSelection = { selectedRowKeys, onChange: (keys: React.Key[]) => setSelectedRowKeys(keys) };

  if (!cloudId) return null;

  return (
    <div>
      <PageDetailSection
        asCard={false}
        toolbarLeft={
          <Space wrap>
            <Input.Search
              placeholder="名称/ID"
              allowClear
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              onSearch={loadConfigList}
              style={{ width: 220 }}
            />
            <Select
              placeholder="命名空间"
              allowClear
              value={namespaceFilter || undefined}
              onChange={(v) => setNamespaceFilter(v ?? '')}
              options={namespaceOptions}
              loading={namespaceLoading}
              className="toolbar-filter-sm"
              style={{ width: 160 }}
            />
            <button
              type="button"
              className="toolbar-reset-btn"
              onClick={() => {
                setKeyword('');
                setNamespaceFilter('');
              }}
            >
              重置
            </button>
          </Space>
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
            <Button icon={<ReloadOutlined />} onClick={loadConfigList} loading={configLoading} />
          </>
        }
      >
        <Table
          className="std-table"
          bordered
          rowKey={(row: FlowItem) => row.id ?? `${row.metadata?.namespace ?? ''}/${row.metadata?.name ?? ''}`}
          loading={configLoading}
          columns={allColumns}
          dataSource={filteredList}
          rowSelection={rowSelection}
          scroll={{ x: 1000 }}
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
                    await form.validateFields(['name', 'namespace']);
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
                <FlowPreview form={form} />
              </div>
            </>
          }
        >
          <Form
            form={form}
            layout="vertical"
            initialValues={{ flowType: 'Logging', includeHosts: [], excludeHosts: [], localOutputRefs: [], globalOutputRefs: [] }}
          >
            <div style={{ display: formStep === 0 ? 'block' : 'none' }}>
              <Typography.Paragraph type="secondary" style={{ marginBottom: 12, fontSize: 13 }}>
                配置名称、命名空间与描述。
              </Typography.Paragraph>
              <Form.Item name="name" label="名称" rules={[{ required: true, message: '请输入名称' }]}>
                <Input placeholder="名称" disabled={!!editingRecord} />
              </Form.Item>
              <Form.Item name="namespace" label="命名空间" rules={[{ required: true, message: '请选择命名空间' }]}>
                <Select
                  placeholder="选择命名空间"
                  options={namespaceOptions.filter((o) => o.value !== '')}
                  loading={namespaceLoading}
                  disabled={!!editingRecord}
                  onChange={(ns: string) => {
                    form.setFieldsValue({ localOutputRefs: [] });
                    loadOutputOptions(ns);
                  }}
                />
              </Form.Item>
              <Form.Item name="description" label="描述（可选）">
                <Input.TextArea rows={2} placeholder="备注" />
              </Form.Item>
            </div>
            <div style={{ display: formStep === 1 ? 'block' : 'none' }}>
              <Typography.Paragraph type="secondary" style={{ marginBottom: 12, fontSize: 13 }}>
                选择日志类型、节点范围及输出目标（命名空间输出为同命名空间 Output，集群输出为 ClusterOutput）。
              </Typography.Paragraph>
              <Form.Item name="flowType" label="类型" rules={[{ required: true }]}>
                <Select options={FLOW_TYPE_OPTIONS} placeholder="Logging / Audit / Event" disabled={!!editingRecord} />
              </Form.Item>
              <Form.Item name="includeHosts" label="仅限以下节点">
                <Select mode="multiple" placeholder="不选表示不限制节点" allowClear loading={nodeLoading} options={nodeOptions} style={{ width: '100%' }} />
              </Form.Item>
              <Form.Item name="excludeHosts" label="排除以下节点">
                <Select mode="multiple" placeholder="不选表示不排除" allowClear loading={nodeLoading} options={nodeOptions} style={{ width: '100%' }} />
              </Form.Item>
              <Form.Item name="localOutputRefs" label="命名空间输出（同命名空间 Output）">
                <Select mode="multiple" placeholder="选择 Output" loading={outputLoading} options={localOutputOptions} style={{ width: '100%' }} />
              </Form.Item>
              <Form.Item name="globalOutputRefs" label="集群输出（ClusterOutput）">
                <Select mode="multiple" placeholder="选择 ClusterOutput" loading={outputLoading} options={globalOutputOptions} style={{ width: '100%' }} />
              </Form.Item>
            </div>
          </Form>
        </WizardLayout>
      </WizardModal>
    </div>
  );
};

export default LogsFlowConfig;
