/**
 * 监控服务 - 日志采集配置（ClusterFlow）
 * 设计文档：plan/设计-监控服务-日志采集配置.md
 * 参考 Compute.Tower-Monitoring LogsConfigPage；节点用主项目 logging/nodes，组件复用主项目。
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Button,
  Col,
  Descriptions,
  Divider,
  Form,
  Input,
  message,
  Modal,
  Row,
  Select,
  Space,
  Table,
  Tag,
  Tooltip,
  Typography,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { PlusOutlined, QuestionCircleOutlined, ReloadOutlined, SearchOutlined } from '@ant-design/icons';
import PageDetailSection from '../../../../components/PageDetailSection';
import TableColumnSettingsButton from '../../../../components/TableColumnSettingsButton';
import { useTableColumnSettings } from '../../../../hooks/useTableColumnSettings';
import ResourceActionsDropdown from '../../../../components/ResourceActionsDropdown';
import {
  fetchClusterflows,
  fetchClusterflowDetail,
  createClusterflow,
  updateClusterflow,
  deleteClusterflow,
  fetchFlows,
  fetchFlowDetail,
  createFlow,
  updateFlow,
  deleteFlow,
  fetchClusteroutputs,
  fetchOutputs,
} from '../../../../services/loggingApi';
import { fetchHarvesterNodes } from '../../../../services/harvesterApi';
import { fetchNodeResources } from '../../../../services/monitoringApi';
import { useLoggingContext, getScopeAliasByNamespace } from './context/LoggingContext';
import {
  AUDIT_LOGGING_REFS,
  DESCRIPTION_ANNOTATION_KEY,
  LOG_KIND_CLUSTER_FLOW,
  LOG_KIND_FLOW,
  LOGGING_NS,
  LOGGING_API_VERSION,
  LOG_TYPE_ANNOTATION_KEY,
  TARGET_ANNOTATION_KEY,
  INCLUDE_HOSTS_ANNOTATION_KEY,
  EXCLUDE_HOSTS_ANNOTATION_KEY,
  LOG_TYPE_AUDIT,
  LOG_TYPE_EVENT,
  LOG_TYPE_LOGGING,
  LOG_TYPE_OPTIONS,
  PRESET_LOG_TARGETS,
  EVENT_TAILER_LABEL,
  EVENT_TAILER_VALUE,
  LOG_SCOPE_CLUSTER,
  LOG_SCOPE_NAMESPACE,
  LOG_SCOPE_MAP,
  GLOBAL_OUTPUT_REFS,
  LOCAL_OUTPUT_REFS,
  ELASTICSEARCH_PROVIDER,
  S3_PROVIDER,
  FILE_PROVIDER,
  KAFKA_PROVIDER,
  FORWARD_PROVIDER,
  SYSLOG_PROVIDER
} from './constants';
import { useAuth } from '../../../../contexts/AuthContext';
import { hasPermissionForAction } from '../../../../utils/accessMapping';



const LOG_TYPE_TIP = (
  <Typography style={{ maxWidth: 320 }}>
    <Typography.Paragraph style={{ marginBottom: 12 }}>
      <Typography.Text strong>Logging：常规日志</Typography.Text>
      <br />
      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
        一般指集群和各类组件在日常运行过程中输出的常规日志信息。如需更通用表述，可直接称为「日志」。
      </Typography.Text>
    </Typography.Paragraph>
    <Typography.Paragraph style={{ marginBottom: 12 }}>
      <Typography.Text strong>Audit：审计日志</Typography.Text>
      <br />
      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
        记录谁在什么时间对集群做了什么操作，用于安全审计与合规追踪。
      </Typography.Text>
    </Typography.Paragraph>
    <Typography.Paragraph style={{ marginBottom: 0 }}>
      <Typography.Text strong>Events：事件日志 / 事件</Typography.Text>
      <br />
      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
        记录集群中各类对象（如 Pod、Node、PVC 等）的状态变更、调度结果、告警提示等短生命周期消息。
      </Typography.Text>
    </Typography.Paragraph>
  </Typography>
);

interface ClusterFlowItem {
  id?: string;
  metadata?: { name?: string; namespace?: string; annotations?: Record<string, string>; creationTimestamp?: string };
  spec?: {
    match?: Array<{
      select?: { container_names?: string[]; hosts?: string[]; labels?: Record<string, string>; namespaces?: string[] };
      exclude?: { container_names?: string[]; hosts?: string[]; labels?: Record<string, string> };
    }>;
    loggingRef?: string;
    globalOutputRefs?: string[];
    localOutputRefs?: string[];
  };
  status?: { active?: string; conditions?: Array<{ type?: string; status?: string }> };
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
  logType: string;
  includeHosts: string[];
  excludeHosts: string[];
} {
  // 日志类型判定：loggingRef 命中审计 ref 则一定为 Audit；否则看 match 是否命中 event-tailer 为 Event；其余为 Logging
  const logType =
    (spec?.loggingRef ? AUDIT_LOGGING_REFS.includes(spec.loggingRef as any) : false)
      ? LOG_TYPE_AUDIT
      : (spec?.match ?? []).some((m) => m?.select?.labels?.[EVENT_TAILER_LABEL] === EVENT_TAILER_VALUE)
        ? LOG_TYPE_EVENT
        : LOG_TYPE_LOGGING;
  const includeHosts: string[] = [];
  const excludeHosts: string[] = [];
  const match = spec?.match ?? [];
  for (const m of match) {
    if (m?.select?.hosts?.length) includeHosts.push(...m.select.hosts);
    if (m?.exclude?.hosts?.length) excludeHosts.push(...m.exclude.hosts);
  }
  return { logType, includeHosts, excludeHosts };
}

interface LogsConfigProps {
  cloudId: string;
}

const LogsConfig: React.FC<LogsConfigProps> = ({ cloudId }) => {
  const { user } = useAuth();
  const perms = useMemo(() => (user?.permissions ?? []) as string[], [user?.permissions]);
  const canReadLogConfigs = useMemo(
    () => hasPermissionForAction(perms, 'clouds.log-configs:read'),
    [perms]
  );
  const canWriteLogConfigs = useMemo(
    () => hasPermissionForAction(perms, 'clouds.log-configs:write'),
    [perms]
  );
  const { formNamespaceOptions, namespaceLoading, isAdmin } = useLoggingContext();
  const [configList, setConfigList] = useState<ClusterFlowItem[]>([]);
  const [configLoading, setConfigLoading] = useState(false);
  const [keyword, setKeyword] = useState('');
  const [namespaceFilter, setNamespaceFilter] = useState<string>('');
  const [formModalOpen, setFormModalOpen] = useState(false);
  const [detailModalOpen, setDetailModalOpen] = useState(false);
  const [detailRecord, setDetailRecord] = useState<ClusterFlowItem | null>(null);
  const [editingRecord, setEditingRecord] = useState<ClusterFlowItem | null>(null);
  const [formLoading, setFormLoading] = useState(false);
  /** 日志接收端列表，含名称与日志类型（用于与采集对象类型一致筛选） */
  const [outputItems, setOutputItems] = useState<Array<{ name: string; logType: string }>>([]);
  const [outputLoading, setOutputLoading] = useState(false);
  const [nodeOptions, setNodeOptions] = useState<Array<{ label: string; value: string }>>([]);
  const [nodeLoading, setNodeLoading] = useState(false);
  const [form] = Form.useForm();
  const namespaceOptions = formNamespaceOptions;
  const formNamespace = Form.useWatch('namespace', form);
  const formLogTarget = Form.useWatch('logTarget', form);
  const selectedPreset = useMemo(
    () => (formLogTarget ? PRESET_LOG_TARGETS.find((t) => t.id === formLogTarget) : null),
    [formLogTarget]
  );
  const logTargetOptions = useMemo(() => {
    const onlyCluster = formNamespace === LOGGING_NS;
    return PRESET_LOG_TARGETS.filter((t) => (t.scope === LOG_SCOPE_CLUSTER) === onlyCluster).map((t) => {
      const scopeLabel = t.scope === LOG_SCOPE_CLUSTER ? LOG_SCOPE_MAP.LOG_SCOPE_CLUSTER : t.scope === LOG_SCOPE_NAMESPACE ? LOG_SCOPE_MAP.LOG_SCOPE_NAMESPACE : (t.scope ?? '-');
      const logTypeLabel = LOG_TYPE_OPTIONS.find((o) => o.value === t.logType)?.label ?? t.logType;
      const label = `${t.name} - ${scopeLabel} - ${logTypeLabel}`;
      return { label, value: t.id };
    });
  }, [formNamespace]);

  const handleLogTargetChange = useCallback(
    (value: string) => {
      const preset = PRESET_LOG_TARGETS.find((t) => t.id === value);
      if (preset) {
        form.setFieldsValue({ logType: preset.logType, logScope: preset.scope ?? undefined });
      } else {
        form.setFieldsValue({ logType: undefined, logScope: undefined });
      }
    },
    [form]
  );

  useEffect(() => {
    if (!formModalOpen || editingRecord) return;
    const current = form.getFieldValue('logTarget');
    const valid = logTargetOptions.some((o) => o.value === current);
    if (current && !valid) form.setFieldValue('logTarget', undefined);
  }, [formModalOpen, editingRecord, form, logTargetOptions]);

  const loadConfigList = useCallback(async () => {
    if (!cloudId || !canReadLogConfigs) return;
    setConfigLoading(true);
    const ns = (namespaceFilter ?? '').toString().trim();
    const isClusterNs = !ns || ns === LOGGING_NS;

    try {
      if (isClusterNs) {
        // 1. 集群级：仅加载 cattle-logging-system 命名空间下的 ClusterFlow
        const clusterRes = await fetchClusterflows(cloudId, { skipCache: true });
        const clusterListRaw = clusterRes.ok && clusterRes.data ? normalizeListPayload(clusterRes.data) : [];
        const clusterList = clusterListRaw.map((item: ClusterFlowItem) => ({
          ...item,
          metadata: { ...item.metadata, namespace: item.metadata?.namespace ?? LOGGING_NS },
        }));
        if (!clusterRes.ok) {
          message.error(clusterRes.error || '加载列表失败');
        }
        setConfigList(clusterList);
      } else {
        // 2. 命名空间级：仅加载指定命名空间下的 Flow（通过 Tower logging API）
        const flowsRes = await fetchFlows(cloudId, { namespace: ns, skipCache: true });
        const flowsList: ClusterFlowItem[] =
          flowsRes.ok && flowsRes.data ? normalizeListPayload(flowsRes.data) : [];
        if (!flowsRes.ok) {
          message.error(flowsRes.error || '加载列表失败');
        }
        setConfigList(flowsList);
      }
    } finally {
      setConfigLoading(false);
    }
  }, [cloudId, namespaceFilter, canReadLogConfigs]);

  const loadOutputListByNamespace = useCallback(async (namespace: string | undefined) => {
    if (!cloudId) return;
    setOutputLoading(true);
    const isClusterNs = !namespace || namespace === LOGGING_NS;
    if (isClusterNs) {
      const { data, ok } = await fetchClusteroutputs(cloudId, { skipCache: true });
      setOutputLoading(false);
      if (!ok) {
        setOutputItems([]);
        return;
      }
      const list = normalizeListPayload(data);
      setOutputItems(
        list
          .map((item: any) => {
            const name = item.metadata?.name ?? item.name ?? '';
            const logType = item.metadata?.annotations?.[LOG_TYPE_ANNOTATION_KEY] ?? LOG_TYPE_LOGGING;
            return name ? { name, logType } : null;
          })
          .filter(Boolean) as Array<{ name: string; logType: string }>
      );
    } else {
      const { data, ok } = await fetchOutputs(cloudId, { namespace, skipCache: true });
      setOutputLoading(false);
      if (!ok) {
        setOutputItems([]);
        return;
      }
      const raw = data as { items?: any[] } | null;
      const items = raw && Array.isArray(raw.items) ? raw.items : [];
      setOutputItems(
        items
          .map((item: any) => {
            const name = item?.metadata?.name ?? item?.name ?? '';
            const logType = item?.metadata?.annotations?.[LOG_TYPE_ANNOTATION_KEY] ?? LOG_TYPE_LOGGING;
            return name ? { name, logType } : null;
          })
          .filter(Boolean) as Array<{ name: string; logType: string }>
      );
    }
  }, [cloudId]);

  const loadNodeOptions = useCallback(async () => {
    if (!cloudId) return;
    setNodeLoading(true);
    try {
      let list: any[] = [];
      const nodeRes = await fetchNodeResources(cloudId);
      if (nodeRes.ok && nodeRes.data != null) {
        const raw = nodeRes.data as { data?: any[]; items?: any[] };
        const arr = raw?.data ?? raw?.items;
        list = Array.isArray(arr) ? arr : [];
      }
      if (list.length === 0) {
        const res = await fetchHarvesterNodes(cloudId, false);
        const raw = res as { data?: { items?: any[] }; items?: any[] };
        const items = raw?.data?.items ?? raw?.items;
        list = Array.isArray(items) ? items : [];
      }
      setNodeOptions(
        list
          .map((n: any) => {
            const name = n.name ?? n.metadata?.name ?? n.id ?? '';
            const display = n.name ?? n.metadata?.name ?? n.id ?? '-';
            return { label: String(display), value: String(name) };
          })
          .filter((o: { value: string }) => o.value.length > 0)
      );
    } catch {
      setNodeOptions([]);
    } finally {
      setNodeLoading(false);
    }
  }, [cloudId]);

  useEffect(() => {
    if (cloudId && canReadLogConfigs) loadConfigList();
  }, [loadConfigList, cloudId, canReadLogConfigs]);

  useEffect(() => {
    if (formModalOpen && cloudId) {
      loadNodeOptions();
    }
  }, [formModalOpen, cloudId, loadNodeOptions]);

  useEffect(() => {
    if (formModalOpen && cloudId && formNamespace) {
      loadOutputListByNamespace(formNamespace);
    }
  }, [formModalOpen, cloudId, formNamespace, loadOutputListByNamespace]);

  /** 与当前所选日志采集对象类型一致的接收端名称列表（新增时用于筛选；未选采集对象时展示全部） */
  const filteredOutputNames = useMemo(() => {
    if (selectedPreset) {
      return outputItems.filter((o) => o.logType === selectedPreset.logType).map((o) => o.name);
    }
    return outputItems.map((o) => o.name);
  }, [outputItems, selectedPreset]);

  useEffect(() => {
    if (!formModalOpen || editingRecord) return;
    const optionsSet = new Set(filteredOutputNames);
    const isClusterNs = formNamespace === LOGGING_NS;
    if (isClusterNs) {
      const current = form.getFieldValue(GLOBAL_OUTPUT_REFS) as string[] | undefined;
      const valid = Array.isArray(current) && current.every((v) => optionsSet.has(v));
      if (current?.length && !valid) form.setFieldValue(GLOBAL_OUTPUT_REFS, []);
    } else {
      const current = form.getFieldValue(LOCAL_OUTPUT_REFS) as string[] | undefined;
      const valid = Array.isArray(current) && current.every((v) => optionsSet.has(v));
      if (current?.length && !valid) form.setFieldValue(LOCAL_OUTPUT_REFS, []);
    }
  }, [formModalOpen, editingRecord, form, formNamespace, filteredOutputNames]);

  const handleOpenForm = useCallback(
    (record: ClusterFlowItem | null) => {
      if (!canWriteLogConfigs) {
        message.warning('无权修改日志采集配置');
        return;
      }
      setEditingRecord(record);
      if (record?.metadata?.name && cloudId) {
        const recordNs = (record.metadata.namespace ?? '') as string;
        const isClusterFlow = !recordNs || recordNs === LOGGING_NS;
        setFormLoading(true);
        const fetchPromise = isClusterFlow
          ? fetchClusterflowDetail(cloudId, record.metadata.name)
          : fetchFlowDetail(cloudId, recordNs, record.metadata.name);
        fetchPromise
          .then(({ data, ok, error }) => {
            setFormLoading(false);
            if (ok && data && typeof data === 'object') {
              const d = data as any;
              const raw = d?.data != null && typeof d.data === 'object' ? d.data : d;
              const annotations = raw.metadata?.annotations ?? {};
              const { logType, includeHosts, excludeHosts } = parseMatchFromSpec(raw.spec);
              const refs = raw.spec?.globalOutputRefs ?? raw.spec?.localOutputRefs ?? [];
              const targetId = annotations[TARGET_ANNOTATION_KEY];
              const preset = targetId ? PRESET_LOG_TARGETS.find((t) => t.id === targetId) : null;
              const ns = raw.metadata?.namespace ?? LOGGING_NS;
              const isCluster = !ns || ns === LOGGING_NS;
              form.setFieldsValue({
                name: raw.metadata?.name,
                namespace: ns,
                description: annotations[DESCRIPTION_ANNOTATION_KEY] ?? annotations.description ?? '',
                logTarget: targetId ?? undefined,
                logType: preset?.logType ?? logType,
                logScope: preset?.scope,
                includeHosts,
                excludeHosts,
                globalOutputRefs: isCluster ? refs : [],
                localOutputRefs: isCluster ? [] : refs,
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
          namespace: namespaceOptions[0]?.value ?? LOGGING_NS,
          description: '',
          logType: LOG_TYPE_LOGGING,
          includeHosts: [],
          excludeHosts: [],
          globalOutputRefs: [],
          localOutputRefs: [],
        });
      }
      setFormModalOpen(true);
    },
    [form, cloudId, namespaceOptions, canWriteLogConfigs]
  );

  const handleCloseForm = useCallback(() => {
    setFormModalOpen(false);
    setEditingRecord(null);
    form.resetFields();
  }, [form]);

  const handleFormSubmit = useCallback(async () => {
    if (!canWriteLogConfigs) {
      message.warning('无权修改日志采集配置');
      return;
    }
    const values = await form.validateFields().catch(() => null);
    if (!values || !cloudId) return;
    const name = (values.name ?? '').toString().trim();
    if (!name) {
      message.error('请输入名称');
      return;
    }
    const namespace = (values.namespace ?? '').toString().trim() || LOGGING_NS;
    const isClusterFlow = namespace === LOGGING_NS;
    const outputRefs = isClusterFlow
      ? (Array.isArray(values.globalOutputRefs) ? values.globalOutputRefs : [])
      : (Array.isArray(values.localOutputRefs) ? values.localOutputRefs : []);
    if (outputRefs.length === 0) {
      message.error('请至少选择一个日志接收端');
      return;
    }

    const logTargetId = (values.logTarget ?? '').toString().trim();
    const preset = logTargetId ? PRESET_LOG_TARGETS.find((t) => t.id === logTargetId) : null;
    const logType = ((preset?.logType ?? values.logType) ?? LOG_TYPE_LOGGING) as string;

    const includeHosts = (Array.isArray(values.includeHosts) ? values.includeHosts : []).filter((h: string) => (h ?? '').toString().trim());
    const excludeHosts = (Array.isArray(values.excludeHosts) ? values.excludeHosts : []).filter((h: string) => (h ?? '').toString().trim());
    // 所有 match 规则放在同一条：一个 select（合并 hosts + labels + namespaces）+ 一个 exclude（hosts）
    const selectEntry: { container_names?: string[]; hosts?: string[]; labels?: Record<string, string>; namespaces?: string[] } = {};
    if (includeHosts.length) selectEntry.hosts = includeHosts;
    if (preset?.labels && Object.keys(preset.labels).length > 0) selectEntry.labels = { ...preset.labels };
    if (preset?.logNamespaces && Array.isArray(preset.logNamespaces) && preset.logNamespaces.length > 0) selectEntry.namespaces = [...preset.logNamespaces];
    const excludeEntry: { hosts?: string[] } = {};
    if (excludeHosts.length) excludeEntry.hosts = excludeHosts;
    const singleMatch: {
      select?: { container_names?: string[]; hosts?: string[]; labels?: Record<string, string>; namespaces?: string[] };
      exclude?: { hosts?: string[] };
    } = {};
    if (Object.keys(selectEntry).length > 0) singleMatch.select = selectEntry;
    if (Object.keys(excludeEntry).length > 0) singleMatch.exclude = excludeEntry;
    const matchPayload = Object.keys(singleMatch).length > 0 ? [singleMatch] : [];

    const spec: ClusterFlowItem['spec'] = {
      ...(isClusterFlow ? { globalOutputRefs: outputRefs } : { localOutputRefs: outputRefs }),
      ...(matchPayload.length > 0 ? { match: matchPayload } : {}),
    };
    const loggingRefValue = (preset?.loggingRef ?? '').toString().trim();
    if (loggingRefValue !== '') {
      spec.loggingRef = loggingRefValue;
    }

    const descText = (values.description ?? '').toString().trim();
    const annotations: Record<string, string> = {
      ...(editingRecord?.metadata?.annotations ?? {}),
      [TARGET_ANNOTATION_KEY]: logTargetId || '',
      [LOG_TYPE_ANNOTATION_KEY]: logType,
      [DESCRIPTION_ANNOTATION_KEY]: descText,
      description: descText,
      [INCLUDE_HOSTS_ANNOTATION_KEY]: includeHosts.join(', '),
      [EXCLUDE_HOSTS_ANNOTATION_KEY]: excludeHosts.join(', '),
    };

    const kind = isClusterFlow ? LOG_KIND_CLUSTER_FLOW : LOG_KIND_FLOW;
    const metadata: Record<string, unknown> = {
      name,
      namespace: isClusterFlow ? LOGGING_NS : namespace,
      annotations,
    };
    // 更新时使用最新的 resourceVersion/uid，避免 409 Conflict（对象已被修改）
    if (editingRecord?.metadata?.name) {
      const editNs = (editingRecord.metadata.namespace ?? '') as string;
      const isEditCluster = !editNs || editNs === LOGGING_NS;
      const { data: latest } = isEditCluster
        ? await fetchClusterflowDetail(cloudId, editingRecord.metadata.name)
        : await fetchFlowDetail(cloudId, editNs, editingRecord.metadata.name);
      const latestMeta = (latest as any)?.metadata;
      if (latestMeta?.resourceVersion != null) metadata.resourceVersion = latestMeta.resourceVersion;
      if (latestMeta?.uid != null) metadata.uid = latestMeta.uid;
    }
    const payload = {
      apiVersion: LOGGING_API_VERSION,
      kind,
      metadata,
      spec,
    };

    setFormLoading(true);
    if (editingRecord?.metadata?.name) {
      const editNs = (editingRecord.metadata.namespace ?? '') as string;
      const isEditCluster = !editNs || editNs === LOGGING_NS;
      if (isEditCluster) {
        const { ok, error } = await updateClusterflow(cloudId, editingRecord.metadata.name, payload);
        setFormLoading(false);
        if (ok) {
          message.success('更新成功');
          handleCloseForm();
          loadConfigList();
        } else message.error(error || '更新失败');
      } else {
        const { ok, error } = await updateFlow(cloudId, editNs, editingRecord.metadata.name, payload);
        setFormLoading(false);
        if (ok) {
          message.success('更新成功');
          handleCloseForm();
          loadConfigList();
        } else message.error(error || '更新失败');
      }
    } else {
      if (isClusterFlow) {
        const { data, ok, error } = await createClusterflow(cloudId, payload);
        setFormLoading(false);
        if (ok) {
          message.success('创建成功');
          const raw = (data as any) || {};
          setConfigList((prev) => [...prev, { ...raw, id: raw.metadata?.name, metadata: raw.metadata, spec: raw.spec }]);
          handleCloseForm();
        } else message.error(error || '创建失败');
      } else {
        const { data, ok, error } = await createFlow(cloudId, payload);
        setFormLoading(false);
        if (ok) {
          message.success('创建成功');
          const raw = (data as any) || {};
          setConfigList((prev) => [...prev, { ...raw, id: raw.metadata?.name ?? `${namespace}/${name}`, metadata: raw.metadata ?? { name, namespace }, spec: raw.spec }]);
          handleCloseForm();
        } else message.error(error || '创建失败');
      }
    }
  }, [editingRecord, form, handleCloseForm, loadConfigList, cloudId, canWriteLogConfigs]);

  const handleOpenDetail = useCallback((row: ClusterFlowItem) => {
    setDetailRecord(row);
    setDetailModalOpen(true);
  }, []);

  const handleCloseDetail = useCallback(() => {
    setDetailModalOpen(false);
    setDetailRecord(null);
  }, []);

  const handleDelete = useCallback(
    async (row: ClusterFlowItem) => {
      if (!canWriteLogConfigs) {
        message.warning('无权删除日志采集配置');
        return;
      }
      const name = row.metadata?.name;
      const ns = (row.metadata?.namespace ?? '') as string;
      if (!name || !cloudId) {
        message.error('缺少名称');
        return;
      }
      const isClusterFlow = !ns || ns === LOGGING_NS;
      const { ok, error } = isClusterFlow
        ? await deleteClusterflow(cloudId, name)
        : await deleteFlow(cloudId, ns, name);
      if (ok) {
        message.success('已删除');
        loadConfigList();
      } else message.error(error || '删除失败');
    },
    [loadConfigList, cloudId, canWriteLogConfigs]
  );

  const filteredList = useMemo(() => {
    const k = keyword.trim().toLowerCase();
    return configList.filter((row) => {
      const nsOk = !namespaceFilter || row.metadata?.namespace === namespaceFilter;
      if (!k) return nsOk;
      const nameHit = (row.metadata?.name ?? '').toLowerCase().includes(k);
      const outputsStr = (row.spec?.globalOutputRefs ?? row.spec?.localOutputRefs ?? []).join(' ').toLowerCase();
      const outputsHit = outputsStr.includes(k);
      return nsOk && (nameHit || outputsHit);
    });
  }, [configList, keyword, namespaceFilter]);

  const outputOptions = useMemo(
    () => filteredOutputNames.map((name) => ({ label: name, value: name })),
    [filteredOutputNames]
  );

  const renderStatus = (row: ClusterFlowItem) => {
    const isNormal = String(row.status?.active ?? '').toLowerCase() === 'true';
    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
        <span style={{ width: 8, height: 8, borderRadius: '50%', background: isNormal ? '#52c41a' : '#ff4d4f' }} />
        {isNormal ? '正常' : '异常'}
      </span>
    );
  };

  const allColumns: ColumnsType<ClusterFlowItem> = useMemo(
    () => [
      {
        title: '采集配置名称',
        dataIndex: ['metadata', 'name'],
        key: 'name',
        width: 200,
        fixed: 'left',
        onHeaderCell: () => ({ style: { minWidth: 160 } }),
        onCell: () => ({ style: { minWidth: 160 } }),
        render: (v: string) => v || '-',
      },
      {
        title: '命名空间',
        dataIndex: ['metadata', 'namespace'],
        key: 'namespace',
        width: 200,
        onHeaderCell: () => ({ style: { minWidth: 200 } }),
        onCell: () => ({ style: { minWidth: 200 } }),
        render: (v: string) => v || '-',
      },
      {
        title: (
          <Space size={4}>
            日志类型
            <Tooltip
              title={LOG_TYPE_TIP}
              placement="topLeft"
              overlayInnerStyle={{
                background: '#fff',
                color: 'rgba(0,0,0,.88)',
                boxShadow: '0 6px 16px 0 rgba(0,0,0,.08), 0 3px 6px -4px rgba(0,0,0,.12), 0 9px 28px 8px rgba(0,0,0,.05)',
              }}
            >
              <QuestionCircleOutlined style={{ color: 'rgba(0,0,0,.45)', cursor: 'help', fontSize: 12 }} />
            </Tooltip>
          </Space>
        ),
        key: '日志类型',
        width: 180,
        render: (_, row) =>
          LOG_TYPE_OPTIONS.find((o) => o.value === parseMatchFromSpec(row.spec).logType)?.label ?? '-',
      },
      {
        title: '采集范围',
        dataIndex: 'scope',
        key: 'scope',
        width: 150,
        render: (_, row) => getScopeAliasByNamespace(row?.metadata?.namespace) || '-',
      },
      {
        title: '日志采集对象',
        key: 'logTarget',
        width: 300,
        render: (_, row) => {
          const targetId = (row.metadata?.annotations?.[TARGET_ANNOTATION_KEY] ?? '').toString().trim();
          const preset = targetId ? PRESET_LOG_TARGETS.find((t) => t.id === targetId) : null;
          if (!targetId) return '-';
          return (
            <>
              <Tag color="blue">{targetId}</Tag>
              {preset ? `(${preset.name})` : ''}
            </>
          );
        },
      },
      {
        title: '日志接收端',
        key: 'outputs',
        width: 220,
        render: (_, row) => {
          const isCluster = !row.metadata?.namespace || row.metadata.namespace === LOGGING_NS;
          const refs = isCluster ? (row.spec?.globalOutputRefs ?? []) : (row.spec?.localOutputRefs ?? []);
          if (!Array.isArray(refs) || refs.length === 0) return '-';
          return (
            <Space size={[4, 4]} wrap>
              {refs.map((name) => (
                <Tag key={name} color="blue">
                  {name}
                </Tag>
              ))}
            </Space>
          );
        },
      },
      {
        title: (
          <Space size={4}>
            日志管道状态
            <Tooltip
              title="验证日志采集是否正常，以及日志转发到接收端是否正常。"
              placement="topLeft"
              overlayInnerStyle={{ background: '#f5f5f5', color: 'rgba(0,0,0,.88)', boxShadow: '0 6px 16px 0 rgba(0,0,0,.08), 0 3px 6px -4px rgba(0,0,0,.12)', border: '1px solid #000' }}
            >
              <QuestionCircleOutlined style={{ color: 'rgba(0,0,0,.45)', cursor: 'help', fontSize: 12 }} />
            </Tooltip>
          </Space>
        ),
        key: '日志管道状态',
        width: 180,
        onHeaderCell: () => ({ style: { minWidth: 160 } }),
        onCell: () => ({ style: { minWidth: 160 } }),
        render: (_, row) => renderStatus(row),
      },
      {
        title: '创建时间',
        key: 'creationTimestamp',
        width: 220,
        render: (_, row) => {
          const t = row.metadata?.creationTimestamp;
          return t
            ? String(t)
                .replace('T', ' ')
                .replace(/\.\d{3}Z?$/, '')
                .replace(/Z$/, '')
            : '-';
        },
      },
      {
        title: '操作',
        key: 'action',
        width: 80,
        fixed: 'right',
        render: (_, row) => (
          <ResourceActionsDropdown
            items={[
              { key: 'detail', label: '详情', onClick: () => handleOpenDetail(row) },
              { key: 'edit', label: '编辑配置', disabled: !canWriteLogConfigs, onClick: () => handleOpenForm(row) },
              { type: 'divider' as const },
              {
                key: 'delete',
                label: '删除',
                danger: true,
                disabled: !canWriteLogConfigs,
                onClick: () => {
                  Modal.confirm({
                    title: '确定删除该日志采集配置？',
                    content: (
                      <Typography.Paragraph style={{ marginTop: 8, marginBottom: 0 }}>
                        将删除采集配置{' '}
                        <Typography.Text strong>
                          {row.metadata?.name ?? '-'}
                        </Typography.Text>
                        ，依赖此配置的日志采集将停止或无法转发到对应接收端，请确认当前无业务依赖后再删除。
                      </Typography.Paragraph>
                    ),
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
    [handleOpenDetail, handleOpenForm, handleDelete, canWriteLogConfigs]
  );

  // 列显示设置（需要在 allColumns 定义之后）
  const { displayColumns } = useTableColumnSettings(allColumns, 'logs_config_clusterflow_table_v2');

  if (!canReadLogConfigs) {
    return (
      <PageDetailSection asCard={false}>
        <Typography.Text type="secondary">无权查看日志采集配置，请联系管理员分配 `clouds.log-configs:read` 权限。</Typography.Text>
      </PageDetailSection>
    );
  }

  return (
    <div>
      <PageDetailSection
        asCard={false}
        toolbarLeft={
          <>
            <Input 
              allowClear 
              placeholder="名称/ID" 
              suffix={<SearchOutlined style={{ color: 'rgba(0,0,0,.45)' }} />}
              value={keyword} 
              onChange={(e) => setKeyword(e.target.value)} 
              onPressEnter={loadConfigList}
              className="toolbar-search"
            />
            <Select
              placeholder="命名空间"
              allowClear
              value={namespaceFilter || undefined}
              onChange={(v) => setNamespaceFilter(v ?? '')}
              options={namespaceOptions}
              loading={namespaceLoading}
              className="toolbar-filter-sm"
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
          </>
        }
        toolbarRight={
          <>
            <Button type="primary" icon={<PlusOutlined />} disabled={!canWriteLogConfigs} onClick={() => handleOpenForm(null)}>
              新增日志采集配置
            </Button>
            <TableColumnSettingsButton allColumns={allColumns} settingsKey="logs_config_clusterflow_table_v2" />
            <Button icon={<ReloadOutlined />} onClick={loadConfigList} loading={configLoading} />
          </>
        }
      >
        <Table
          className="std-table"
          bordered={false}
          rowKey={(row: ClusterFlowItem) => row.id ?? row.metadata?.name ?? String(Math.random())}
          loading={configLoading}
          columns={displayColumns}
          dataSource={filteredList}
          scroll={{ x: 1400 }}
          pagination={{
            pageSize: 10,
            showSizeChanger: true,
            showTotal: (total: number, range: [number, number]) => `第 ${range[0]}-${range[1]} 条，共 ${total} 条`,
            pageSizeOptions: ['10', '20', '50'],
          }}
        />
      </PageDetailSection>

      <Modal
        open={formModalOpen}
        onCancel={handleCloseForm}
        title={editingRecord ? '编辑日志采集策略' : '新增日志采集策略'}
        width={1100}
        footer={
          <Space>
            <Button onClick={handleCloseForm}>取消</Button>
            <Button type="primary" loading={formLoading} onClick={handleFormSubmit}>
              {editingRecord ? '保存' : '创建'}
            </Button>
          </Space>
        }
      >
        <Form
          form={form}
          layout="vertical"
          initialValues={{ logType: 'Logging', namespace: LOGGING_NS, includeHosts: [], excludeHosts: [], globalOutputRefs: [], localOutputRefs: [] }}
        >
          <Row gutter={24}>
            <Col span={10}>
              <Form.Item name="namespace" label={<span style={{ fontWeight: 600 }}>命名空间</span>} rules={[{ required: true, message: '请选择命名空间' }]}>
                <Select
                  placeholder="选择命名空间"
                  allowClear={false}
                  loading={namespaceLoading}
                  options={namespaceOptions}
                  disabled={!!editingRecord}
                  style={{ width: '100%' }}
                />
              </Form.Item>
            </Col>
            <Col span={14}>
              <Form.Item name="logTarget" label={<span style={{ fontWeight: 600 }}>日志采集对象</span>} rules={[{ required: true, message: '请选择日志采集对象' }]}>
                <Select
                  options={logTargetOptions}
                  placeholder={formNamespace === LOGGING_NS ? '选择日志采集对象' : '仅在选择命名空间 cattle-logging-system 时可选集群级采集对象'}
                  disabled={!!editingRecord}
                  onChange={handleLogTargetChange}
                />
              </Form.Item>
            </Col>
          </Row>
          {selectedPreset ? (
            <Descriptions
              title={<span style={{ fontWeight: 600, fontSize: 14 }}>采集对象信息</span>}
              column={1}
              size="small"
              bordered
              style={{ marginBottom: 0, border: 'solid 2px #91caff', padding: '12px 16px' }}
              items={[
                { label: '采集对象名称', children: selectedPreset.id },
                { label: '采集内容', children: selectedPreset.name },
                {
                  label: '采集范围',
                  children:
                    selectedPreset.scope === LOG_SCOPE_CLUSTER
                      ? LOG_SCOPE_MAP.LOG_SCOPE_CLUSTER
                      : selectedPreset.scope === LOG_SCOPE_NAMESPACE
                        ? LOG_SCOPE_MAP.LOG_SCOPE_NAMESPACE
                        : selectedPreset.scope ?? '-',
                },
                {
                  label: '日志类型',
                  children: LOG_TYPE_OPTIONS.find((o) => o.value === selectedPreset.logType)?.label ?? selectedPreset.logType,
                },
                { label: '描述', children: selectedPreset.description || '-' },
              ]}
            />
          ) : null}
          <Form.Item name="logType" hidden rules={[{ required: true, message: '请先选择日志采集对象' }]}>
            <Input />
          </Form.Item>
          <Form.Item name="logScope" hidden rules={[{ required: true, message: '请选择日志采集范围' }]}>
            <Input />
          </Form.Item>
          <Divider />
          <Row gutter={24}>
          <Col span={10}>
          <Form.Item name="name" label={<span style={{ fontWeight: 600 }}>采集配置名称</span>} rules={[{ required: true, message: '请输入采集配置名称' }]}>
              <Input placeholder="采集配置名称" disabled={!!editingRecord} />
            </Form.Item>
            </Col>
            <Col span={14}>
          <Form.Item name="description" label="描述（可选）">
                <Input.TextArea rows={2} placeholder="备注" />
              </Form.Item>
              </Col>
          </Row>
          <Row gutter={24}>
            <Col span={12}>
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
            </Col>
            <Col span={12}>
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
            </Col>
          </Row>
          {formNamespace === LOGGING_NS ? (
            <Form.Item name="globalOutputRefs" label={<span style={{ fontWeight: 600 }}>日志接收端</span>} rules={[{ required: true, message: '请至少选择一个日志接收端' }]}>
              <Select mode="multiple" placeholder="选择日志接收端" loading={outputLoading} options={outputOptions} />
            </Form.Item>
          ) : (
            <Form.Item name="localOutputRefs" label={<span style={{ fontWeight: 600 }}>日志接收端</span>} rules={[{ required: true, message: '请至少选择一个日志接收端' }]}>
              <Select mode="multiple" placeholder="选择日志接收端" loading={outputLoading} options={outputOptions} />
            </Form.Item>
          )}
        </Form>
      </Modal>

      <Modal
        open={detailModalOpen}
        onCancel={handleCloseDetail}
        title="日志采集配置详情"  
        footer={<Button onClick={handleCloseDetail}>关闭</Button>}
        width={600}
      >
        {detailRecord ? (
          <Descriptions column={1} bordered size="small" labelStyle={{ width: 120 }}>
            <Descriptions.Item label="日志采集配置名称">{detailRecord.metadata?.name ?? '-'}</Descriptions.Item>
            <Descriptions.Item label="命名空间">{detailRecord.metadata?.namespace ?? '-'}</Descriptions.Item>
            <Descriptions.Item label="描述">
              {(detailRecord.metadata?.annotations?.[DESCRIPTION_ANNOTATION_KEY] ??
                detailRecord.metadata?.annotations?.description ??
                '')
                .trim() || '-'}
            </Descriptions.Item>
            <Descriptions.Item label="日志类型">
              {LOG_TYPE_OPTIONS.find((o) => o.value === parseMatchFromSpec(detailRecord.spec).logType)?.label ??
                parseMatchFromSpec(detailRecord.spec).logType ??
                '-'}
            </Descriptions.Item>
            <Descriptions.Item label="日志采集对象">
              {(() => {
                const targetId = (detailRecord.metadata?.annotations?.[TARGET_ANNOTATION_KEY] ?? '').toString().trim();
                const preset = targetId ? PRESET_LOG_TARGETS.find((t) => t.id === targetId) : null;
                if (!targetId) return '-';
                return (
                  <>
                    <Tag color="blue">{targetId}</Tag>
                    {preset ? `(${preset.name})` : ''}
                  </>
                );
              })()}
            </Descriptions.Item>
            <Descriptions.Item label="日志采集范围">
              {getScopeAliasByNamespace(detailRecord.metadata?.namespace) || '-'}
            </Descriptions.Item>
            <Descriptions.Item label="仅限节点">
              {(() => {
                const raw = detailRecord.metadata?.annotations?.[INCLUDE_HOSTS_ANNOTATION_KEY];
                if (raw == null || String(raw).trim() === '') return '-';
                const list = String(raw).split(',').map((s) => s.trim()).filter(Boolean);
                return list.length ? list.join(', ') : '-';
              })()}
            </Descriptions.Item>
            <Descriptions.Item label="排除节点">
              {(() => {
                const raw = detailRecord.metadata?.annotations?.[EXCLUDE_HOSTS_ANNOTATION_KEY];
                if (raw == null || String(raw).trim() === '') return '-';
                const list = String(raw).split(',').map((s) => s.trim()).filter(Boolean);
                return list.length ? list.join(', ') : '-';
              })()}
            </Descriptions.Item>
            <Descriptions.Item label="日志接收端">
              {(() => {
                const isCluster = !detailRecord.metadata?.namespace || detailRecord.metadata.namespace === LOGGING_NS;
                const refs = isCluster ? (detailRecord.spec?.globalOutputRefs ?? []) : (detailRecord.spec?.localOutputRefs ?? []);
                if (!Array.isArray(refs) || refs.length === 0) return '-';
                return (
                  <Space size={[4, 4]} wrap>
                    {refs.map((name) => (
                      <Tag key={name} color="blue">
                        {name}
                      </Tag>
                    ))}
                  </Space>
                );
              })()}
            </Descriptions.Item>
            <Descriptions.Item label="日志管道状态">{renderStatus(detailRecord)}</Descriptions.Item>
            <Descriptions.Item label="创建时间">
              {detailRecord.metadata?.creationTimestamp
                ? String(detailRecord.metadata.creationTimestamp)
                    .replace('T', ' ')
                    .replace(/\.\d{3}Z?$/, '')
                    .replace(/Z$/, '')
                : '-'}
            </Descriptions.Item>
          </Descriptions>
        ) : null}
      </Modal>
    </div>
  );
};

export default LogsConfig;
