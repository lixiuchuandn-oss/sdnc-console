/**
 * 告警通知策略：配置列表 + 新增/编辑 Modal
 *
 * 数据契约（与后端 AlertmanagerPolicy 对齐）：
 *   - 列表/详情：从 fetchAlertmanagerconfigs / fetchAlertmanagerconfigDetail 直接拿结构化 Policy
 *     - aliasName / name / namespace / description 直接读
 *     - receivers: [{name, receiverType?, aliasName?}] 已联表通知对象元信息
 *     - subRoute.alertNames: 解析自 sub-route matchers（唯一可信源）
 *   - 创建/更新：提交 UpsertAlertmanagerPolicyPayload（不再前端拼 CR）
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Button,
  Cascader,
  Col,
  Descriptions,
  Form,
  Input,
  message,
  Modal,
  Row,
  Select,
  Space,
  Spin,
  Table,
  Tag,
  Transfer,
  Typography,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import {
  CheckOutlined,
  CloseOutlined,
  EditOutlined,
  ReloadOutlined,
  SearchOutlined,
} from '@ant-design/icons';
import PageDetailSection from '../../../../../components/PageDetailSection';
import TableColumnSettingsButton from '../../../../../components/TableColumnSettingsButton';
import { useTableColumnSettings } from '../../../../../hooks/useTableColumnSettings';
import {
  MONITORING_NAMESPACE_FILTER_ALL,
  useMonitoring,
} from './context/MonitoringContext';
import ResourceActionsDropdown from '../../../../../components/ResourceActionsDropdown';
import {
  fetchAlertmanagerconfigs,
  fetchAlertmanagerconfigDetail,
  createAlertmanagerconfig,
  updateAlertmanagerconfig,
  deleteAlertmanagerconfig,
  fetchPrometheusRuleVmCustomRules,
  fetchNotificationTargetsList,
  fetchPrometheusRules,
  fetchPrometheusRulesGroups,
  type AlertmanagerPolicy,
  type AlertmanagerPolicyReceiverRef,
  type NotificationTargetReceiver,
  type PrometheusRuleItem,
  type UpsertAlertmanagerPolicyPayload,
} from '../../../../../services/monitoringApi';
import { RECEIVER_NAME_OPTIONS, type ReceiverName } from './lib/receivers';
import { useAuth } from '../../../../../contexts/AuthContext';
import { hasPermissionForAction } from '../../../../../utils/accessMapping';

interface TriggerRuleOption {
  value: string;
  label: string;
  description?: string;
  severity?: string;
  /** 告警分组（管理员 rulesList 有，用于按分组筛选） */
  groupName?: string;
}

const SECTION_TITLE_TAG_STYLE: React.CSSProperties = {
  padding: '4px 12px',
  fontSize: 14,
  borderRadius: 16,
  cursor: 'default',
  userSelect: 'none',
};

const RECEIVER_TYPE_LABEL_MAP: Record<string, string> = {
  'email-receiver': '邮件',
  'dingtalk-receiver': '钉钉',
  'website-receiver': '站内信',
};

/** 「通知方式 + 通知对象」展示文案：`<aliasName 或 name>(<类型标签>)` */
function renderReceiverRefTag(ref: AlertmanagerPolicyReceiverRef): string {
  const display = ref.aliasName?.trim() || ref.name;
  const typeLabel = RECEIVER_TYPE_LABEL_MAP[ref.receiverType ?? ''] ?? '邮件';
  return `${display}(${typeLabel})`;
}

function flattenPrometheusRuleToTriggerOptions(raw: any): TriggerRuleOption[] {
  const spec = raw?.spec ?? raw?.data?.spec;
  const groups = spec?.groups ?? [];
  const list: TriggerRuleOption[] = [];
  for (const g of groups) {
    const rules = g?.rules ?? [];
    for (const r of rules) {
      const alert = r?.alert ?? '';
      if (!alert) continue;
      const summary = r?.annotations?.summary ?? alert;
      const description = r?.annotations?.description ?? '';
      const severity = r?.labels?.severity ?? '';
      list.push({ value: alert, label: summary, description, severity });
    }
  }
  return list;
}

/** 列表/详情接口响应解包：兼容 `{ data: [...] }` 与 `{ data: { data: [...] } }` 两层包装 */
function unwrapPoliciesPayload(raw: any): AlertmanagerPolicy[] {
  if (!raw || typeof raw !== 'object') return [];
  const inner = (raw as any).data;
  if (Array.isArray(inner)) return inner as AlertmanagerPolicy[];
  if (inner && typeof inner === 'object' && Array.isArray((inner as any).data)) {
    return (inner as any).data as AlertmanagerPolicy[];
  }
  if (Array.isArray((raw as any))) return raw as AlertmanagerPolicy[];
  return [];
}

function unwrapPolicyDetailPayload(raw: any): AlertmanagerPolicy | null {
  if (!raw || typeof raw !== 'object') return null;
  const inner = (raw as any).data;
  if (inner && typeof inner === 'object' && !Array.isArray(inner)) {
    if ((inner as any).id || (inner as any).name) return inner as AlertmanagerPolicy;
    const nested = (inner as any).data;
    if (nested && typeof nested === 'object') return nested as AlertmanagerPolicy;
  }
  return null;
}

type FormInstanceType = ReturnType<typeof Form.useForm>[0];

/** 告警规则穿梭框：左侧可选规则，右侧已选规则 */
function AlertRulesTransfer({
  form,
  options,
  loading,
}: {
  form: FormInstanceType;
  options: TriggerRuleOption[];
  loading?: boolean;
}) {
  const targetKeys = (Form.useWatch('matchers', form) ?? []) as string[];
  const dataSource = useMemo(
    () =>
      options.map((o) => ({
        key: o.value,
        title: o.label || o.value,
      })),
    [options]
  );
  return (
    <div style={{ width: '100%' }}>
      <Typography.Paragraph type="secondary" style={{ marginBottom: 12, fontSize: 13 }}>
        选择<strong>告警规则</strong>：从左侧勾选并移至右侧，符合该条件的告警将发送到您上面选择的通知对象。
      </Typography.Paragraph>
      <Spin spinning={!!loading}>
        <Transfer
          dataSource={dataSource}
          targetKeys={targetKeys}
          onChange={(keys) => form.setFieldValue('matchers', keys)}
          render={(item) => item.title ?? item.key}
          titles={['可选告警规则', '已选告警规则']}
          listStyle={{
            width: 'calc(50% - 44px)',
            minWidth: 200,
            height: 360,
          }}
          showSearch
          filterOption={(input, item) =>
            (item.title ?? '').toString().toLowerCase().includes(input.toLowerCase()) ||
            (item.key ?? '').toString().toLowerCase().includes(input.toLowerCase())
          }
          locale={{ itemUnit: '项', itemsUnit: '项', searchPlaceholder: '搜索', notFoundContent: '列表为空' }}
        />
      </Spin>
    </div>
  );
}

interface Props {
  cloudId: string;
}

const MonitoringAlertNotificationPolicy: React.FC<Props> = ({ cloudId }) => {
  const { user } = useAuth();
  const perms = useMemo(() => (user?.permissions ?? []) as string[], [user?.permissions]);
  const canReadPolicies = useMemo(
    () => hasPermissionForAction(perms, 'clouds.alert-policies:read'),
    [perms]
  );
  const canWritePolicies = useMemo(
    () => hasPermissionForAction(perms, 'clouds.alert-policies:write'),
    [perms]
  );
  const {
    isAdmin,
    namespaceList,
    namespaceLoading,
    configNsFilter,
    setConfigNsFilter,
    formNamespaceOptions,
    formNamespaceOptionsForForm,
  } = useMonitoring();

  const [configList, setConfigList] = useState<AlertmanagerPolicy[]>([]);
  const [configLoading, setConfigLoading] = useState(false);
  const [receiversList, setReceiversList] = useState<NotificationTargetReceiver[]>([]);
  const [receiversLoading, setReceiversLoading] = useState(false);
  const [keyword, setKeyword] = useState('');

  const [formModalOpen, setFormModalOpen] = useState(false);
  const [editingRecord, setEditingRecord] = useState<AlertmanagerPolicy | null>(null);
  const [formLoading, setFormLoading] = useState(false);
  const [form] = Form.useForm();
  const [vmTriggerOptions, setVmTriggerOptions] = useState<TriggerRuleOption[]>([]);
  const [vmTriggerLoading, setVmTriggerLoading] = useState(false);
  const [rulesList, setRulesList] = useState<PrometheusRuleItem[]>([]);
  const [rulesGroupMap, setRulesGroupMap] = useState<Record<string, string>>({});
  const [rulesLoading, setRulesLoading] = useState(false);

  const [detailModalOpen, setDetailModalOpen] = useState(false);
  const [detailData, setDetailData] = useState<AlertmanagerPolicy | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [aliasEditingKey, setAliasEditingKey] = useState<string | null>(null);
  const [aliasDraft, setAliasDraft] = useState('');
  const [aliasSaving, setAliasSaving] = useState(false);

  const loadConfigList = useCallback(async () => {
    if (!cloudId || !canReadPolicies) return;
    setConfigLoading(true);
    const { data, ok, error } = await fetchAlertmanagerconfigs(cloudId);
    setConfigLoading(false);
    if (!ok) {
      message.error(error || '加载配置列表失败');
      setConfigList([]);
      return;
    }
    setConfigList(unwrapPoliciesPayload(data));
  }, [cloudId, canReadPolicies]);

  /** 加载通知对象列表（供「通知方式 → 通知对象」级联与下拉使用） */
  const loadReceiversList = useCallback(
    async (overrideNamespaces?: string[]) => {
      if (!cloudId) return;
      setReceiversLoading(true);
      const namespaces =
        overrideNamespaces && overrideNamespaces.length > 0
          ? overrideNamespaces
          : namespaceList;
      const { data, ok } = await fetchNotificationTargetsList(cloudId, {
        namespaces: namespaces.length ? namespaces : undefined,
      });
      setReceiversLoading(false);
      if (!ok) {
        setReceiversList([]);
        return;
      }
      setReceiversList((data?.receivers ?? []) as NotificationTargetReceiver[]);
    },
    [cloudId, namespaceList]
  );

  const loadVmTriggerOptions = useCallback(async () => {
    if (!cloudId) return;
    setVmTriggerLoading(true);
    const { data, ok } = await fetchPrometheusRuleVmCustomRules(cloudId);
    setVmTriggerLoading(false);
    if (ok && data) setVmTriggerOptions(flattenPrometheusRuleToTriggerOptions(data));
    else setVmTriggerOptions([]);
  }, [cloudId]);

  useEffect(() => {
    if (cloudId && canReadPolicies) loadConfigList();
  }, [cloudId, loadConfigList, canReadPolicies]);

  useEffect(() => {
    if (!cloudId) return;
    const namespaces = namespaceList;
    if (namespaces.length > 0 || isAdmin) loadReceiversList();
  }, [cloudId, isAdmin, namespaceList, loadReceiversList]);

  useEffect(() => {
    if (formModalOpen && cloudId && !isAdmin) loadVmTriggerOptions();
  }, [formModalOpen, cloudId, isAdmin, loadVmTriggerOptions]);

  /** 告警规则数据：管理员加载全部 PrometheusRulesGroup + rules；租户只加载 vmTriggerOptions 对应的 rules */
  const loadAlertRules = useCallback(async () => {
    if (!cloudId || !formModalOpen) return;
    setRulesLoading(true);
    if (isAdmin) {
      const [rulesRes, groupsRes] = await Promise.all([
        fetchPrometheusRules(cloudId),
        fetchPrometheusRulesGroups(cloudId),
      ]);
      setRulesList((rulesRes.ok && rulesRes.data?.rules) ? rulesRes.data.rules : []);
      setRulesGroupMap((groupsRes.ok && groupsRes.data?.rulesGroupMap) ? groupsRes.data.rulesGroupMap : {});
    } else {
      const alertNames = vmTriggerOptions.map((o) => o.value).filter(Boolean);
      if (alertNames.length > 0) {
        const res = await fetchPrometheusRules(cloudId, { alertNames });
        setRulesList((res.ok && res.data?.rules) ? res.data.rules : []);
      } else {
        setRulesList([]);
      }
      setRulesGroupMap({});
    }
    setRulesLoading(false);
  }, [cloudId, formModalOpen, isAdmin, vmTriggerOptions]);

  useEffect(() => {
    if (!formModalOpen || !cloudId) return;
    if (isAdmin) loadAlertRules();
    else if (vmTriggerOptions.length > 0) loadAlertRules();
  }, [formModalOpen, cloudId, isAdmin, vmTriggerOptions.length, loadAlertRules]);

  const filteredConfigList = useMemo(() => {
    let list = configList;
    if (keyword.trim()) {
      const k = keyword.trim().toLowerCase();
      list = list.filter(
        (row) =>
          (row.name ?? '').toLowerCase().includes(k) ||
          (row.aliasName ?? '').toLowerCase().includes(k) ||
          (row.namespace ?? '').toLowerCase().includes(k)
      );
    }
    if (configNsFilter) list = list.filter((row) => row.namespace === configNsFilter);
    if (!isAdmin && namespaceList.length) {
      list = list.filter((row) => namespaceList.includes(row.namespace));
    }
    return list;
  }, [configList, keyword, configNsFilter, isAdmin, namespaceList]);

  /** 通知对象（specReceivers[].name -> NotificationTargetReceiver）索引；级联展示时按通知方式分组 */
  const receiversByType = useMemo(() => {
    const types: ReceiverName[] = ['email-receiver', 'dingtalk-receiver', 'website-receiver'];
    const result: Record<ReceiverName, { name: string; aliasName?: string }[]> = {} as Record<ReceiverName, { name: string; aliasName?: string }[]>;
    for (const t of types) result[t] = [];
    for (const r of receiversList) {
      const type = (
        (r as { receiverType?: string }).receiverType ??
        r.receiverName ??
        ''
      ).toString().trim() as ReceiverName;
      if (!result[type]) continue;
      const aliasName = (r as { aliasName?: string }).aliasName?.toString().trim() || undefined;
      const list = Array.isArray(r.specReceivers) ? r.specReceivers : [];
      for (const s of list) {
        const name = (s?.name ?? '').toString().trim();
        if (!name) continue;
        if (!result[type].some((x) => x.name === name)) {
          result[type].push({ name, aliasName });
        }
      }
    }
    return result;
  }, [receiversList]);

  /** name -> receiverType 索引：用于把级联 cascader 的 `:type:name` 值反推类型时回退 */
  const nameToType = useMemo(() => {
    const map: Record<string, ReceiverName> = {};
    (Object.entries(receiversByType) as Array<[ReceiverName, { name: string }[]]>).forEach(([t, list]) => {
      for (const o of list) {
        if (!map[o.name]) map[o.name] = t;
      }
    });
    return map;
  }, [receiversByType]);

  const handleOpenForm = useCallback(
    (record: AlertmanagerPolicy | null) => {
      if (!canWritePolicies) {
        message.warning('无权修改告警通知策略');
        return;
      }
      setEditingRecord(record);
      if (record?.namespace && record?.name && cloudId) {
        setFormLoading(true);
        fetchAlertmanagerconfigDetail(cloudId, record.namespace, record.name)
          .then(({ data, ok, error }) => {
            setFormLoading(false);
            const policy = unwrapPolicyDetailPayload(data);
            if (!ok || !policy) {
              message.error(error || '获取配置详情失败');
              return;
            }
            setEditingRecord(policy);
            const receiverEntries = policy.receivers.map(
              (r) => `${r.receiverType ?? nameToType[r.name] ?? 'email-receiver'}:${r.name}`,
            );
            form.setFieldsValue({
              name: policy.name,
              aliasName: policy.aliasName ?? '',
              namespace: policy.namespace,
              description: policy.description ?? '',
              repeatInterval: policy.subRoute?.repeatInterval ?? '4h',
              configReceiverName: receiverEntries,
              matchers: policy.subRoute?.alertNames ?? [],
            });
          })
          .catch(() => {
            setFormLoading(false);
            message.error('获取配置详情失败');
          });
      } else {
        form.resetFields();
        const defaultNs = isAdmin ? undefined : (namespaceList[0] ?? 'default');
        form.setFieldsValue({
          namespace: defaultNs,
          aliasName: '',
          configReceiverName: [],
          matchers: [],
          repeatInterval: '4h',
        });
      }
      setFormModalOpen(true);
    },
    [form, isAdmin, namespaceList, cloudId, nameToType, canWritePolicies]
  );

  const handleCloseForm = useCallback(() => {
    setFormModalOpen(false);
    setEditingRecord(null);
    form.resetFields();
  }, [form]);

  /** 打开详情：从接口拉取策略详情并展示只读 Modal */
  const handleOpenDetail = useCallback(
    (row: AlertmanagerPolicy) => {
      if (!cloudId || !row.namespace || !row.name) {
        message.error('缺少生效项目/策略标识');
        return;
      }
      setDetailData(null);
      setDetailModalOpen(true);
      setDetailLoading(true);
      fetchAlertmanagerconfigDetail(cloudId, row.namespace, row.name)
        .then(({ data, ok, error }) => {
          setDetailLoading(false);
          const policy = unwrapPolicyDetailPayload(data);
          if (!ok || !policy) {
            message.error(error || '获取策略详情失败');
            setDetailData(null);
            return;
          }
          setDetailData(policy);
        })
        .catch(() => {
          setDetailLoading(false);
          message.error('获取策略详情失败');
          setDetailData(null);
        });
    },
    [cloudId]
  );

  const handleCloseDetail = useCallback(() => {
    setDetailModalOpen(false);
    setDetailData(null);
  }, []);

  /** 详情 Modal 中：用 rulesList / vmTriggerOptions 把 alertname id 翻译为可读规则名 */
  const detailMatcherDisplayNames = useMemo(() => {
    if (!detailData?.subRoute?.alertNames?.length) return undefined;
    const nameMap = new Map<string, string>();
    for (const r of rulesList) {
      const id = (r?.name ?? '').toString().trim();
      const aliasName = (r?.aliasName ?? '').toString().trim() || id;
      if (id) nameMap.set(id, aliasName);
    }
    for (const o of vmTriggerOptions) {
      const id = (o?.value ?? '').toString().trim();
      const aliasName = (o?.label ?? '').toString().trim() || id;
      if (id && !nameMap.has(id)) nameMap.set(id, aliasName);
    }
    return detailData.subRoute.alertNames.map((id) => nameMap.get(id) || id);
  }, [detailData, rulesList, vmTriggerOptions]);

  /** 级联选择：第一级 邮件/钉钉/网站，第二级 该类型下的通知对象标识；叶子 value 为 type:name */
  const receiverCascadeOptions = useMemo((): { value: string; label: string; children?: { value: string; label: string }[] }[] => {
    return RECEIVER_NAME_OPTIONS.map((t) => ({
      value: t.value,
      label: t.label,
      children: (receiversByType[t.value] ?? []).map((o) => ({
        value: `${t.value}:${o.name}`,
        label: o.aliasName ? `${o.aliasName}（${o.name}）` : o.name,
      })),
    }));
  }, [receiversByType]);

  /** 通知对象多选：所有类型扁平化，value=type:name，label=<aliasName||name> (类型标签) */
  const configReceiverNameOptionsFlattened = useMemo(() => {
    const out: { value: string; label: string }[] = [];
    for (const t of RECEIVER_NAME_OPTIONS) {
      const list = receiversByType[t.value] ?? [];
      const typeLabel = RECEIVER_TYPE_LABEL_MAP[t.value] ?? t.label;
      for (const o of list) {
        const display = o.aliasName ? `${o.aliasName}（${o.name}）` : o.name;
        out.push({ value: `${t.value}:${o.name}`, label: `${display} (${typeLabel})` });
      }
    }
    return out;
  }, [receiversByType]);

  const [cascadeSelectedValue, setCascadeSelectedValue] = useState<string[]>([]);

  /** 表单内策略生效项目：未选择时无法按策略生效项目加载通知对象，需提示用户 */
  const watchedFormNamespace = Form.useWatch('namespace', form);
  const formNamespaceEmpty = !(watchedFormNamespace != null && String(watchedFormNamespace).trim());

  /** 表单打开且用户选择了策略生效项目时，按该策略生效项目重新加载通知对象列表 */
  useEffect(() => {
    if (!formModalOpen || !cloudId) return;
    const ns = (watchedFormNamespace ?? '').toString().trim();
    if (ns) loadReceiversList([ns]);
  }, [formModalOpen, cloudId, watchedFormNamespace, loadReceiversList]);

  /** 把 cascader/select 里 `type:name` 形式的条目解析出 name 数组 */
  const parseReceiverEntriesToNames = useCallback((entries: unknown): string[] => {
    if (!Array.isArray(entries)) {
      if (entries == null || entries === '') return [];
      return [String(entries).trim()].filter(Boolean);
    }
    return entries
      .map((entry) => {
        const e = String(entry ?? '').trim();
        if (!e) return '';
        const idx = e.indexOf(':');
        return idx > 0 ? e.slice(idx + 1) : e;
      })
      .filter(Boolean);
  }, []);

  const handleFormSubmit = useCallback(async () => {
    if (!canWritePolicies) {
      message.warning('无权修改告警通知策略');
      return;
    }
    const values = await form
      .validateFields(['name', 'namespace', 'configReceiverName', 'matchers'])
      .catch(() => null);
    if (!values || !cloudId) return;
    const receiverNames = parseReceiverEntriesToNames(form.getFieldValue('configReceiverName'));
    if (receiverNames.length === 0) {
      message.warning('请至少选择一个通知对象');
      return;
    }
    const matchersRaw = form.getFieldValue('matchers');
    const alertNames = (Array.isArray(matchersRaw) ? (matchersRaw as unknown[]) : [])
      .map((x) => String(x ?? '').trim())
      .filter(Boolean);
    if (alertNames.length === 0) {
      message.warning('已选告警规则不能为空');
      return;
    }
    const name = String(values.name ?? '').trim();
    const namespace = String(values.namespace ?? 'default').trim();
    const aliasNameInput = String(form.getFieldValue('aliasName') ?? '').trim();
    const description = String(form.getFieldValue('description') ?? '').trim();
    const subRouteRepeatInterval =
      String(form.getFieldValue('repeatInterval') ?? '').trim() || '4h';

    const payload: UpsertAlertmanagerPolicyPayload = {
      name,
      namespace,
      aliasName: aliasNameInput || name,
      ...(description ? { description } : {}),
      receivers: receiverNames.map((n) => ({ name: n })),
      alertNames,
      subRouteRepeatInterval,
      ...(editingRecord?.resourceVersion ? { resourceVersion: editingRecord.resourceVersion } : {}),
    };

    setFormLoading(true);
    if (editingRecord?.namespace && editingRecord?.name) {
      const { ok, error } = await updateAlertmanagerconfig(
        cloudId,
        editingRecord.namespace,
        editingRecord.name,
        payload,
      );
      setFormLoading(false);
      if (ok) {
        message.success('更新成功');
        handleCloseForm();
        await loadConfigList();
      } else message.error(error || '更新失败');
    } else {
      const { ok, error } = await createAlertmanagerconfig(cloudId, payload);
      setFormLoading(false);
      if (ok) {
        message.success('创建成功');
        handleCloseForm();
        await loadConfigList();
      } else message.error(error || '创建失败');
    }
  }, [
    canWritePolicies,
    cloudId,
    editingRecord,
    form,
    handleCloseForm,
    loadConfigList,
    parseReceiverEntriesToNames,
  ]);

  const handleDeleteConfig = useCallback(
    async (row: AlertmanagerPolicy) => {
      if (!canWritePolicies) {
        message.warning('无权删除告警通知策略');
        return;
      }
      const ns = row.namespace;
      const name = row.name;
      if (!ns || !name || !cloudId) {
        message.error('缺少策略生效项目或名称');
        return;
      }
      const { ok, error } = await deleteAlertmanagerconfig(cloudId, ns, name);
      if (ok) {
        message.success('已删除');
        loadConfigList();
      } else message.error(error || '删除失败');
    },
    [loadConfigList, cloudId, canWritePolicies]
  );

  const handleStartAliasEdit = useCallback((row: AlertmanagerPolicy) => {
    const name = row.name ?? '';
    const namespace = row.namespace ?? '';
    const key = `${namespace}/${name}`;
    setAliasEditingKey(key);
    setAliasDraft((row.aliasName ?? name).trim());
  }, []);

  const handleCancelAliasEdit = useCallback(() => {
    setAliasEditingKey(null);
    setAliasDraft('');
  }, []);

  const handleSaveAlias = useCallback(
    async (row: AlertmanagerPolicy) => {
      if (!canWritePolicies) {
        message.warning('无权编辑通知策略名称');
        return;
      }
      const namespace = row.namespace ?? '';
      const name = row.name ?? '';
      if (!cloudId || !namespace || !name) {
        message.error('缺少策略生效项目或通知策略标识');
        return;
      }
      const nextAlias = aliasDraft.trim() || name;
      setAliasSaving(true);
      try {
        const detailRes = await fetchAlertmanagerconfigDetail(cloudId, namespace, name);
        const policy = unwrapPolicyDetailPayload(detailRes.data);
        if (!detailRes.ok || !policy) {
          message.error(detailRes.error || '获取通知策略详情失败');
          return;
        }
        const payload: UpsertAlertmanagerPolicyPayload = {
          name: policy.name,
          namespace: policy.namespace,
          aliasName: nextAlias,
          ...(policy.description ? { description: policy.description } : {}),
          receivers: policy.receivers.map((r) => ({ name: r.name })),
          alertNames: policy.subRoute?.alertNames ?? [],
          subRouteRepeatInterval: policy.subRoute?.repeatInterval ?? '4h',
          ...(policy.resourceVersion ? { resourceVersion: policy.resourceVersion } : {}),
        };
        const { ok, error } = await updateAlertmanagerconfig(cloudId, namespace, name, payload);
        if (ok) {
          message.success('通知策略名称已更新');
          handleCancelAliasEdit();
          await loadConfigList();
        } else {
          message.error(error || '更新通知策略名称失败');
        }
      } finally {
        setAliasSaving(false);
      }
    },
    [aliasDraft, canWritePolicies, cloudId, handleCancelAliasEdit, loadConfigList]
  );

  const allConfigColumns: ColumnsType<AlertmanagerPolicy> = useMemo(
    () => [
      {
        title: '通知策略名称',
        key: 'aliasName',
        render: (_, row: AlertmanagerPolicy) => {
          const name = row.name ?? '';
          const namespace = row.namespace ?? '';
          const rowKey = `${namespace}/${name}`;
          if (aliasEditingKey === rowKey) {
            return (
              <Space size={4}>
                <Input
                  value={aliasDraft}
                  onChange={(e) => setAliasDraft(e.target.value)}
                  onPressEnter={() => handleSaveAlias(row)}
                  placeholder="请输入通知策略名称"
                  style={{ width: 220 }}
                  disabled={aliasSaving}
                />
                <Button
                  type="text"
                  icon={<CheckOutlined />}
                  onClick={() => handleSaveAlias(row)}
                  loading={aliasSaving}
                />
                <Button
                  type="text"
                  icon={<CloseOutlined />}
                  onClick={handleCancelAliasEdit}
                  disabled={aliasSaving}
                />
              </Space>
            );
          }
          return (
            <Space size={6}>
              <span
                className="cell-link"
                onClick={() => handleOpenDetail(row)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    handleOpenDetail(row);
                  }
                }}
              >
                {row.aliasName?.trim() || name || '-'}
              </span>
              <Button
                type="text"
                size="small"
                icon={<EditOutlined />}
                onClick={() => handleStartAliasEdit(row)}
                disabled={!canWritePolicies}
              />
            </Space>
          );
        },
      },
      {
        title: '通知策略标识',
        dataIndex: 'name',
        key: 'name',
        render: (v: string) => v || '-',
      },
      {
        title: '策略生效项目',
        dataIndex: 'namespace',
        key: 'namespace',
        render: (ns: string) => ns || '-',
      },
      {
        title: <span style={{ fontWeight: 600, color: '#000' }}>通知对象</span>,
        key: 'receivers',
        render: (_, row) => {
          const refs = Array.isArray(row.receivers) ? row.receivers : [];
          if (refs.length === 0) return '-';
          return (
            <Space size={[8, 4]} wrap>
              {refs.map((r) => (
                <Tag key={r.name} color="blue" style={{ fontSize: 'inherit', margin: 0, lineHeight: 'inherit' }}>
                  {renderReceiverRefTag(r)}
                </Tag>
              ))}
            </Space>
          );
        },
      },
      {
        title: '创建时间',
        dataIndex: 'creationTimestamp',
        key: 'createdAt',
        ellipsis: true,
        render: (v: string | undefined) =>
          v ? (String(v).replace('T', ' ').replace(/\.\d{3}Z?$/, '') || v) : '-',
      },
      {
        title: '操作',
        key: 'action',
        fixed: 'right',
        render: (_, row) => {
          const isSystemDefault = !!row.isSystemDefault;
          return (
            <ResourceActionsDropdown
              items={[
                { key: 'detail', label: '详情', onClick: () => handleOpenDetail(row) },
                {
                  key: 'edit',
                  label: '编辑策略',
                  disabled: !canWritePolicies || isSystemDefault,
                  onClick: () => handleOpenForm(row),
                },
                { type: 'divider' as const },
                {
                  key: 'delete',
                  label: '删除',
                  danger: true,
                  disabled: !canWritePolicies || isSystemDefault,
                  onClick: () => {
                    Modal.confirm({
                      title: '确定删除该策略？',
                      onOk: () => handleDeleteConfig(row),
                      okText: '删除',
                      cancelText: '取消',
                      okButtonProps: { danger: true },
                    });
                  },
                },
              ]}
            />
          );
        },
      },
    ],
    [
      aliasDraft,
      aliasEditingKey,
      aliasSaving,
      canWritePolicies,
      handleCancelAliasEdit,
      handleDeleteConfig,
      handleOpenDetail,
      handleOpenForm,
      handleSaveAlias,
      handleStartAliasEdit,
    ]
  );

  const { displayColumns: configColumns } = useTableColumnSettings(
    allConfigColumns,
    'monitoring_alert_notification_policy_table',
  );

  /** 告警规则 Transfer 数据源 */
  const alertRulesTransferOptions = useMemo((): TriggerRuleOption[] => {
    if (isAdmin) {
      return rulesList.map((r) => ({
        value: r.name,
        label: r.aliasName || r.name,
        groupName: r.groupName,
      }));
    }
    return vmTriggerOptions;
  }, [isAdmin, rulesList, vmTriggerOptions]);

  const alertGroupOptions = useMemo(() => {
    if (!isAdmin || !rulesList.length) return [];
    const seen = new Set<string>();
    const list: { value: string; label: string }[] = [{ value: '', label: '全部' }];
    for (const r of rulesList) {
      const g = (r.groupName ?? '').toString().trim();
      if (g && !seen.has(g)) {
        seen.add(g);
        list.push({
          value: g,
          label: (rulesGroupMap[g] ?? r.groupAliasName ?? g) || g,
        });
      }
    }
    return list.sort((a, b) => {
      if (a.value === '') return -1;
      if (b.value === '') return 1;
      return String(a.label).localeCompare(String(b.label));
    });
  }, [isAdmin, rulesList, rulesGroupMap]);

  const [selectedAlertGroup, setSelectedAlertGroup] = useState<string>('');

  const watchedMatchersRaw = Form.useWatch('matchers', form);
  const watchedMatchers = useMemo(
    () => (watchedMatchersRaw ?? []) as string[],
    [watchedMatchersRaw],
  );
  const filteredAlertRulesTransferOptions = useMemo(() => {
    const filtered =
      selectedAlertGroup && isAdmin
        ? alertRulesTransferOptions.filter((o) => o.groupName === selectedAlertGroup)
        : alertRulesTransferOptions;
    const selectedSet = new Set(watchedMatchers);
    const missing = alertRulesTransferOptions.filter(
      (o) => selectedSet.has(o.value) && !filtered.some((f) => f.value === o.value)
    );
    return [...filtered, ...missing];
  }, [alertRulesTransferOptions, isAdmin, selectedAlertGroup, watchedMatchers]);

  const alertRulesTransferLoading = isAdmin ? rulesLoading : vmTriggerLoading || rulesLoading;

  if (!canReadPolicies) {
    return (
      <PageDetailSection asCard={false}>
        <Typography.Text type="secondary">
          无权查看告警通知策略，请联系管理员分配 `clouds.alert-policies:read` 权限。
        </Typography.Text>
      </PageDetailSection>
    );
  }

  return (
    <>
      <div>
        <PageDetailSection
          asCard={true}
          toolbarLeft={
            <>
              <Tag.CheckableTag checked style={SECTION_TITLE_TAG_STYLE}>
                通知策略
              </Tag.CheckableTag>
              <Input
                allowClear
                placeholder="名称/标识"
                suffix={<SearchOutlined style={{ color: 'rgba(0,0,0,.45)' }} />}
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
                className="toolbar-search"
              />
              <Select
                placeholder="项目"
                allowClear
                value={configNsFilter ?? MONITORING_NAMESPACE_FILTER_ALL}
                onChange={(v) =>
                  setConfigNsFilter(
                    v === MONITORING_NAMESPACE_FILTER_ALL ? MONITORING_NAMESPACE_FILTER_ALL : v,
                  )
                }
                loading={namespaceLoading}
                options={formNamespaceOptions}
                style={{ minWidth: 300 }}
              />
              <button
                type="button"
                className="toolbar-reset-btn"
                onClick={() => {
                  setKeyword('');
                  setConfigNsFilter(MONITORING_NAMESPACE_FILTER_ALL);
                }}
              >
                重置
              </button>
            </>
          }
          toolbarRight={
            <>
              <Button type="primary" disabled={!canWritePolicies} onClick={() => handleOpenForm(null)}>
                新增通知策略
              </Button>
              <TableColumnSettingsButton
                allColumns={allConfigColumns}
                settingsKey="monitoring_alert_notification_policy_table"
              />
              <Button icon={<ReloadOutlined />} onClick={loadConfigList} loading={configLoading} />
            </>
          }
        >
          <Table
            className="std-table"
            bordered={false}
            rowKey={(row) => row.id ?? `${row.namespace}/${row.name}`}
            loading={configLoading}
            columns={configColumns}
            dataSource={filteredConfigList}
            scroll={{ x: true }}
            pagination={{ pageSize: 10, showSizeChanger: true, showTotal: (t) => `共 ${t} 条` }}
          />
        </PageDetailSection>
      </div>

      {/* 告警通知策略详情 Modal */}
      <Modal
        open={detailModalOpen}
        onCancel={handleCloseDetail}
        title="告警通知策略详情"
        footer={<Button onClick={handleCloseDetail}>关闭</Button>}
        width={560}
        destroyOnHidden
      >
        {detailLoading ? (
          <div style={{ padding: 24, textAlign: 'center' }}>
            <Spin />
          </div>
        ) : detailData ? (
          <Descriptions column={1} bordered size="small" labelStyle={{ width: 120 }}>
            <Descriptions.Item label="通知策略名称">{detailData.aliasName ?? '-'}</Descriptions.Item>
            <Descriptions.Item label="通知策略标识">{detailData.name ?? '-'}</Descriptions.Item>
            <Descriptions.Item label="项目">{detailData.namespace ?? '-'}</Descriptions.Item>
            <Descriptions.Item label="描述">{detailData.description ?? '-'}</Descriptions.Item>
            <Descriptions.Item label="通知对象">
              {detailData.receivers?.length ? (
                <Space size={[8, 4]} wrap>
                  {detailData.receivers.map((r) => (
                    <Tag key={r.name} color="blue">
                      {renderReceiverRefTag(r)}
                    </Tag>
                  ))}
                </Space>
              ) : (
                '-'
              )}
            </Descriptions.Item>
            <Descriptions.Item label="触发规则">
              {detailMatcherDisplayNames?.length ? (
                <Space size={[8, 4]} wrap>
                  {detailMatcherDisplayNames.map((m) => (
                    <Tag key={m}>{m}</Tag>
                  ))}
                </Space>
              ) : (
                '-'
              )}
            </Descriptions.Item>
            <Descriptions.Item label="重复推送间隔">
              {detailData.subRoute?.repeatInterval ?? '-'}
            </Descriptions.Item>
            <Descriptions.Item label="创建时间">
              {detailData.creationTimestamp
                ? String(detailData.creationTimestamp).replace('T', ' ').replace(/\.\d{3}Z?$/, '')
                : '-'}
            </Descriptions.Item>
          </Descriptions>
        ) : (
          <Typography.Text type="secondary">暂无数据</Typography.Text>
        )}
      </Modal>

      {/* 告警通知策略新增/编辑Modal */}
      <Modal
        open={formModalOpen}
        onCancel={handleCloseForm}
        title={editingRecord ? '编辑通知策略' : '新增通知策略'}
        width="90vw"
        destroyOnHidden
        footer={
          <Space>
            <Button onClick={handleCloseForm}>取消</Button>
            <Button type="primary" loading={formLoading} onClick={handleFormSubmit}>
              {editingRecord ? '保存' : '创建'}
            </Button>
          </Space>
        }
        styles={{ body: { maxHeight: '75vh', overflow: 'auto', padding: 24 } }}
      >
        <Form
          form={form}
          layout="vertical"
          initialValues={{
            namespace: isAdmin ? undefined : namespaceList[0] ?? 'default',
            aliasName: '',
            matchers: [],
            configReceiverName: [],
            repeatInterval: '4h',
          }}
        >
          <Row gutter={24}>
            <Col span={24}>
              <Form.Item name="namespace" label="项目" rules={[{ required: true }]}>
                <Select
                  placeholder={isAdmin ? '选择策略生效项目' : '租户策略生效项目'}
                  disabled={!!editingRecord}
                  loading={namespaceLoading}
                  options={formNamespaceOptionsForForm}
                />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={24}>
            <Col span={12}>
              <Form.Item
                name="aliasName"
                label="通知策略名称"
                extra="支持输入中文，如：运维团队通知策略、存储团队通知策略"
              >
                <Input placeholder="通知策略名称" maxLength={128} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item
                name="name"
                label="通知策略标识"
                extra="通知策略标识必须唯一且不可变更，如：ops-alert-policy、storage-alert-policy"
                rules={[{ required: true, message: '请输入通知策略标识，必须唯一' }]}
              >
                <Input placeholder="通知策略标识" disabled={!!editingRecord} />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={24}>
            <Col span={12}>
              <Form.Item name="repeatInterval" label="重复推送间隔 (repeatInterval)" extra="如 4h、30m">
                <Input placeholder="4h" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="description" label="通知策略描述">
                <Input.TextArea rows={2} placeholder="通知策略描述" />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={24}>
            <Col span={12}>
              <Form.Item
                label="通知方式"
                extra={formNamespaceEmpty ? '请先选择策略生效项目以加载通知对象' : undefined}
              >
                <Cascader
                  allowClear
                  placeholder="选择通知方式 → 通知对象"
                  options={receiverCascadeOptions}
                  value={cascadeSelectedValue}
                  loading={receiversLoading}
                  onDropdownVisibleChange={(open) => {
                    if (open && !(form.getFieldValue('namespace') != null && String(form.getFieldValue('namespace')).trim())) {
                      message.warning('请先选择策略生效项目，以便加载该项目下的通知对象');
                    }
                  }}
                  onChange={(value) => {
                    const v = value as string[];
                    if (v?.length === 2) {
                      const typeName = v[v.length - 1];
                      const current = (form.getFieldValue('configReceiverName') ?? []) as string[];
                      if (typeName && !current.includes(typeName)) {
                        form.setFieldValue('configReceiverName', [...current, typeName]);
                      }
                      setCascadeSelectedValue([]);
                    }
                  }}
                  displayRender={(labels) => labels.join(' / ')}
                />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item
                name="configReceiverName"
                label="通知对象"
                rules={[{ required: true, type: 'array', min: 1, message: '请至少选择一个通知对象' }]}
                extra={formNamespaceEmpty ? '请先选择策略生效项目以加载通知对象' : undefined}
              >
                <Select
                  mode="multiple"
                  allowClear
                  loading={receiversLoading}
                  options={configReceiverNameOptionsFlattened}
                  showSearch
                  optionFilterProp="label"
                  placeholder="请选择通知对象（可多选，至少选择一个）"
                  onDropdownVisibleChange={(open) => {
                    if (open && !(form.getFieldValue('namespace') != null && String(form.getFieldValue('namespace')).trim())) {
                      message.warning('请先选择策略生效项目，以便加载该项目下的通知对象');
                    }
                  }}
                />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={24}>
            <Col span={24}>
              <Form.Item
                name="matchers"
                label="告警规则"
                rules={[
                  { required: true, message: '请选择告警规则' },
                  {
                    validator: (_, value) => {
                      const arr = Array.isArray(value) ? value.filter(Boolean) : [];
                      if (arr.length === 0) return Promise.reject(new Error('已选告警规则不能为空'));
                      return Promise.resolve();
                    },
                  },
                ]}
                style={{ width: '100%' }}
              >
                <>
                  {alertGroupOptions.length > 0 && (
                    <div style={{ marginBottom: 16, width: '100%' }}>
                      <Form.Item label="告警分组" style={{ marginBottom: 0 }}>
                        <Select
                          placeholder="选择分组筛选左侧告警规则"
                          allowClear
                          value={selectedAlertGroup}
                          onChange={(v) => setSelectedAlertGroup(v ?? '')}
                          options={alertGroupOptions}
                          style={{ width: '100%', maxWidth: 320 }}
                        />
                      </Form.Item>
                    </div>
                  )}
                  <AlertRulesTransfer
                    form={form}
                    options={filteredAlertRulesTransferOptions}
                    loading={alertRulesTransferLoading}
                  />
                </>
              </Form.Item>
            </Col>
          </Row>
        </Form>
      </Modal>
    </>
  );
};

export default MonitoringAlertNotificationPolicy;
