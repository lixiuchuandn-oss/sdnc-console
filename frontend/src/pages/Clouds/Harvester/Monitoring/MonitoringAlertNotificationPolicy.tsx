/**
 * 告警通知策略：配置列表 + 新增/编辑步骤弹框（由 AlertForwardConfig 迁入）
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Button,
  Cascader,
  Col,
  Divider,
  Form,
  Input,
  message,
  Modal,
  Radio,
  Row,
  Select,
  Space,
  Spin,
  Switch,
  Table,
  Transfer,
  Typography,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { DeleteOutlined, PlusOutlined, ReloadOutlined } from '@ant-design/icons';
import { useAuth } from '../../../../contexts/AuthContext';
import PageDetailSection from '../../../../components/PageDetailSection';
import ResourceActionsDropdown from '../../../../components/ResourceActionsDropdown';
import {
  fetchAllowedNamespaces,
  fetchAlertmanagerconfigs,
  fetchAlertmanagerconfigDetail,
  createAlertmanagerconfig,
  updateAlertmanagerconfig,
  deleteAlertmanagerconfig,
  fetchPrometheusRuleVmCustomRules,
  fetchNotificationTargetsList,
  fetchPrometheusRules,
  fetchPrometheusRulesGroups,
} from '../../../../services/monitoringApi';
import type {
  NotificationTargetReceiver,
  PrometheusRuleItem,
} from '../../../../services/monitoringApi';
import { fetchHarvesterNamespaces } from '../../../../services/harvesterApi';
import {
  buildReceiverSpec,
  setReceiverTypeAnnotation,
  removeReceiverTypeAnnotation,
  RECEIVER_NAME_OPTIONS,
  type ReceiverName,
  type ReceiverSpec,
} from './utils/receivers';

const SYSTEM_NS_SET = new Set(['kube-system', 'kube-public', 'kube-node-lease', 'fleet-default']);
const SYSTEM_NS_PREFIXES = ['c-', 'p-', 'user-', 'local-', 'cattle-'];

function filterNonSystemNamespaces(names: string[]): string[] {
  return names.filter((name) => {
    if (!name || typeof name !== 'string') return false;
    if (SYSTEM_NS_SET.has(name)) return false;
    if (name.endsWith('-system')) return false;
    if (SYSTEM_NS_PREFIXES.some((p) => name.startsWith(p))) return false;
    return true;
  });
}

interface TriggerRuleOption {
  value: string;
  label: string;
  description?: string;
  severity?: string;
  /** 告警分组（管理员 rulesList 有，用于按分组筛选） */
  groupName?: string;
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

interface AlertmanagerConfigItem {
  id?: string;
  type?: string;
  metadata?: { name?: string; namespace?: string; creationTimestamp?: string; annotations?: Record<string, string> };
  spec?: { receivers?: Array<{ name?: string }>; route?: Record<string, unknown> };
}

function normalizeListPayload(res: any): AlertmanagerConfigItem[] {
  if (!res || typeof res !== 'object') return [];
  let list: any[] = [];
  if (Array.isArray(res.data)) list = res.data;
  else if (Array.isArray(res.data?.data)) list = res.data.data;
  else if (Array.isArray(res.items)) list = res.items;
  if (list.length === 0) return [];
  return list.map((item: any) => {
    const inner = item?.data != null && typeof item.data === 'object' ? item.data : item;
    const meta = inner?.metadata ?? {};
    const rawName = meta?.name ?? item?.name;
    const avoidIdAsName = item?.id && rawName === item?.id;
    return {
      ...item,
      metadata: {
        ...meta,
        name: avoidIdAsName ? undefined : rawName,
        namespace: meta?.namespace ?? item?.namespace,
      },
      spec: inner?.spec ?? item?.spec,
    };
  });
}

function parseAlertnameReToMatchers(alertnameRe: string): string[] {
  if (!alertnameRe.trim()) return [];
  const parts: string[] = [];
  let current = '';
  for (let i = 0; i < alertnameRe.length; i++) {
    const c = alertnameRe[i];
    if (c === '\\' && i + 1 < alertnameRe.length) {
      current += alertnameRe[i + 1];
      i++;
    } else if (c === '|') {
      if (current.trim()) parts.push(current.trim());
      current = '';
    } else {
      current += c;
    }
  }
  if (current.trim()) parts.push(current.trim());
  return parts.filter(Boolean);
}

/** 从 route 中收集所有 receiver 名称（顶层 + routes[].receiver），且仅保留在 receivers 中存在的 */
function collectReceiverNamesFromRoute(route: any, receivers: Array<{ name?: string }>): string[] {
  const names: string[] = [];
  const set = new Set((receivers ?? []).map((r) => (r?.name ?? '').trim()).filter(Boolean));
  const top = (route?.receiver ?? '').toString().trim();
  if (top && set.has(top)) names.push(top);
  const children = Array.isArray(route?.routes) ? route.routes : [];
  for (const c of children) {
    const r = (c?.receiver ?? '').toString().trim();
    if (r && set.has(r) && !names.includes(r)) names.push(r);
  }
  return names;
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

function AlertConfigPreview({
  form,
  triggerOptions = [],
}: { form: FormInstanceType; triggerOptions?: TriggerRuleOption[] }) {
  const name = Form.useWatch('name', form) ?? '';
  const namespace = Form.useWatch('namespace', form) ?? '';
  const description = Form.useWatch('description', form) ?? '';
  const configReceiverName = (Form.useWatch('configReceiverName', form) ?? []) as string[];
  const firstEntry = configReceiverName[0];
  const firstType: ReceiverName = firstEntry && firstEntry.includes(':')
    ? (firstEntry.slice(0, firstEntry.indexOf(':')) as ReceiverName)
    : 'email-receiver';
  const receiverName = (Form.useWatch('receiverName', form) ?? firstType) as ReceiverName;
  const emailList = Form.useWatch('emailList', form) ?? [];
  const matchers = (Form.useWatch('matchers', form) ?? []) as string[];
  const emailCount = Array.isArray(emailList) ? emailList.filter((i: any) => (i?.emailTo ?? '').toString().trim()).length : 0;
  const receiverDetail = receiverName === 'email-receiver' ? (emailCount ? `邮箱 ${emailCount} 条` : '-') : configReceiverName.length ? `已选 ${configReceiverName.length} 个通知对象` : '-';
  const matcherLabels = (matchers.filter(Boolean) as string[]).map((v) => triggerOptions.find((o) => o.value === v)?.label ?? v);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div><span style={{ color: 'rgba(0,0,0,0.45)', marginRight: 8 }}>名称</span><span>{name || '-'}</span></div>
      <div><span style={{ color: 'rgba(0,0,0,0.45)', marginRight: 8 }}>命名空间</span><span>{namespace || '-'}</span></div>
      <div><span style={{ color: 'rgba(0,0,0,0.45)', marginRight: 8 }}>描述</span><span>{(description || '').trim() || '-'}</span></div>
      <div><span style={{ color: 'rgba(0,0,0,0.45)', marginRight: 8 }}>配置摘要</span><span>{receiverDetail}</span></div>
      <div><span style={{ color: 'rgba(0,0,0,0.45)', marginRight: 8 }}>已选条件</span><span>{matcherLabels.length ? matcherLabels.join('、') : '-'}</span></div>
    </div>
  );
}

interface Props {
  cloudId: string;
}

const MonitoringAlertNotificationPolicy: React.FC<Props> = ({ cloudId }) => {
  const { user } = useAuth();
  const isAdmin = user?.role === 'super_admin' || user?.role === 'leased_lines_admin';

  const [configList, setConfigList] = useState<AlertmanagerConfigItem[]>([]);
  const [configLoading, setConfigLoading] = useState(false);
  const [receiversList, setReceiversList] = useState<NotificationTargetReceiver[]>([]);
  const [receiversLoading, setReceiversLoading] = useState(false);
  const [namespaceList, setNamespaceList] = useState<string[]>([]);
  const [namespaceLoading, setNamespaceLoading] = useState(false);
  const [tenantNamespaces, setTenantNamespaces] = useState<string[]>([]);
  const [keyword, setKeyword] = useState('');
  const [configNsFilter, setConfigNsFilter] = useState<string | undefined>();
  const [dataSourceFilter, setDataSourceFilter] = useState<string>('prometheus');

  const [formModalOpen, setFormModalOpen] = useState(false);
  const [editingRecord, setEditingRecord] = useState<AlertmanagerConfigItem | null>(null);
  const [formLoading, setFormLoading] = useState(false);
  const [form] = Form.useForm();
  const [vmTriggerOptions, setVmTriggerOptions] = useState<TriggerRuleOption[]>([]);
  const [vmTriggerLoading, setVmTriggerLoading] = useState(false);
  const [rulesList, setRulesList] = useState<PrometheusRuleItem[]>([]);
  const [rulesGroupMap, setRulesGroupMap] = useState<Record<string, string>>({});
  const [rulesLoading, setRulesLoading] = useState(false);

  const loadConfigList = useCallback(async () => {
    if (!cloudId) return;
    setConfigLoading(true);
    const { data, ok, error } = await fetchAlertmanagerconfigs(cloudId);
    setConfigLoading(false);
    if (!ok) {
      message.error(error || '加载配置列表失败');
      setConfigList([]);
      return;
    }
    setConfigList(normalizeListPayload(data));
  }, [cloudId]);

  /** 通知对象名称下拉数据：来自后端 GET .../alertmanagerconfigs/receivers，按 receiverName 聚合 */
  const loadReceiversList = useCallback(async () => {
    if (!cloudId) return;
    setReceiversLoading(true);
    const namespaces = isAdmin ? namespaceList : tenantNamespaces;
    const { data, ok, error } = await fetchNotificationTargetsList(cloudId, {
      namespaces: namespaces.length ? namespaces : undefined,
    });
    setReceiversLoading(false);
    if (!ok) {
      setReceiversList([]);
      return;
    }
    setReceiversList((data?.receivers ?? []) as NotificationTargetReceiver[]);
  }, [cloudId, isAdmin, namespaceList, tenantNamespaces]);

  const loadNamespaces = useCallback(async () => {
    if (!cloudId) return;
    setNamespaceLoading(true);
    try {
      const res: any = await fetchHarvesterNamespaces(cloudId);
      const items: any[] = Array.isArray(res?.data?.items) ? res.data.items : res?.data ?? res?.items ?? [];
      const raw: string[] = items.map((i: any) => i?.metadata?.name ?? i?.name).filter((n: unknown): n is string => typeof n === 'string' && n.length > 0);
      const filtered = filterNonSystemNamespaces([...new Set(raw)]);
      const withDefault = filtered.includes('default') ? filtered : ['default', ...filtered];
      setNamespaceList(withDefault.sort());
    } catch {
      setNamespaceList([]);
    } finally {
      setNamespaceLoading(false);
    }
  }, [cloudId]);

  const loadTenantNamespaces = useCallback(async () => {
    if (!cloudId || isAdmin) return;
    const { data, ok } = await fetchAllowedNamespaces(cloudId);
    if (ok && data?.namespaces) setTenantNamespaces(data.namespaces);
    else setTenantNamespaces([]);
  }, [cloudId, isAdmin]);

  const loadVmTriggerOptions = useCallback(async () => {
    if (!cloudId) return;
    setVmTriggerLoading(true);
    const { data, ok } = await fetchPrometheusRuleVmCustomRules(cloudId);
    setVmTriggerLoading(false);
    if (ok && data) setVmTriggerOptions(flattenPrometheusRuleToTriggerOptions(data));
    else setVmTriggerOptions([]);
  }, [cloudId]);

  useEffect(() => {
    if (cloudId) {
      loadConfigList();
      if (isAdmin) loadNamespaces();
    }
  }, [cloudId, isAdmin, loadConfigList, loadNamespaces]);

  useEffect(() => {
    if (cloudId && !isAdmin) loadTenantNamespaces();
  }, [cloudId, isAdmin, loadTenantNamespaces]);

  /** 命名空间就绪后拉取通知对象列表（供「通知对象名称」下拉使用） */
  useEffect(() => {
    if (!cloudId) return;
    const namespaces = isAdmin ? namespaceList : tenantNamespaces;
    if (namespaces.length > 0 || isAdmin) loadReceiversList();
  }, [cloudId, isAdmin, namespaceList, tenantNamespaces, loadReceiversList]);

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

  const formNamespaceOptions = useMemo(() => {
    if (isAdmin) {
      const opts = namespaceList.length ? namespaceList : ['default'];
      return opts.map((ns) => ({ label: ns, value: ns }));
    }
    return tenantNamespaces.map((ns) => ({ label: ns, value: ns }));
  }, [isAdmin, namespaceList, tenantNamespaces]);

  const filteredConfigList = useMemo(() => {
    let list = configList;
    if (keyword.trim()) {
      const k = keyword.trim().toLowerCase();
      list = list.filter(
        (row) =>
          (row.metadata?.name ?? '').toLowerCase().includes(k) ||
          (row.metadata?.namespace ?? '').toLowerCase().includes(k)
      );
    }
    if (configNsFilter) list = list.filter((row) => row.metadata?.namespace === configNsFilter);
    if (!isAdmin && tenantNamespaces.length) {
      list = list.filter((row) => tenantNamespaces.includes(row.metadata?.namespace ?? ''));
    }
    return list;
  }, [configList, keyword, configNsFilter, isAdmin, tenantNamespaces]);

  /** spec 接收器名称 -> 通知方式（用于编辑回填时拼 type:name，以及提交时按类型取 spec） */
  const nameToType = useMemo(() => {
    const map: Record<string, ReceiverName> = {};
    for (const r of receiversList) {
      const type = (r.receiverName ?? '').toString().trim() as ReceiverName;
      if (!type) continue;
      const list = Array.isArray(r.specReceivers) ? r.specReceivers : [];
      for (const s of list) {
        const name = (s?.name ?? '').toString().trim();
        if (name && !map[name]) map[name] = type;
      }
    }
    return map;
  }, [receiversList]);

  const handleOpenForm = useCallback(
    (record: AlertmanagerConfigItem | null) => {
      setEditingRecord(record);
      if (record?.metadata?.namespace != null && record?.metadata?.name != null && cloudId) {
        setFormLoading(true);
        fetchAlertmanagerconfigDetail(cloudId, record.metadata.namespace, record.metadata.name)
          .then(({ data, ok, error }) => {
            setFormLoading(false);
            if (ok && data && typeof data === 'object') {
              const raw = data as any;
              const d = raw?.data != null && typeof raw.data === 'object' ? raw.data : raw;
              const annotations = d.metadata?.annotations ?? {};
              const receivers = Array.isArray(d.spec?.receivers) ? d.spec.receivers : [];
              const routeReceiver = d.spec?.route?.receiver ?? receivers?.[0]?.name;
              const routeReceiverNames = collectReceiverNamesFromRoute(d.spec?.route, receivers);
              const r0 = routeReceiver ? receivers.find((r: any) => r.name === routeReceiver) : receivers[0];
              let receiverName: ReceiverName = 'email-receiver';
              let emailList = [{ emailTo: '', emailFrom: '', smarthost: '', requireTls: true, authUsername: '', authIdentity: '', authSecretKey: '' }];
              if (r0) {
                if (r0.emailConfigs?.length) {
                  receiverName = 'email-receiver';
                  emailList = (r0.emailConfigs || []).map((e: any) => {
                    const ap = e?.authPassword;
                    const name = typeof ap === 'object' && ap !== null ? ap.name : (e?.authIdentity ?? '');
                    const key = typeof ap === 'object' && ap !== null ? (ap.key ?? '') : (e?.authSecretKey ?? '');
                    return {
                      emailTo: e?.to ?? '',
                      emailFrom: e?.from ?? '',
                      smarthost: e?.smarthost ?? '',
                      requireTls: e?.requireTLS !== false && e?.requireTls !== false,
                      authUsername: e?.authUsername ?? '',
                      authIdentity: name,
                      authSecretKey: key,
                    };
                  });
                  if (emailList.length === 0) emailList.push({ emailTo: '', emailFrom: '', smarthost: '', requireTls: true, authUsername: '', authIdentity: '', authSecretKey: '' });
                }
              }
              const route = d.spec?.route ?? {};
              const match = (route.match ?? {}) as Record<string, string>;
              const matchRe = (route.matchRe ?? {}) as Record<string, string>;
              const routeMatchersArray = Array.isArray(route.matchers) ? route.matchers : [];
              const alertnameMatchers = routeMatchersArray.filter((m: any) => String(m?.name ?? '').toLowerCase() === 'alertname');
              let matchersFromRouteMatchers: string[] = [];
              if (alertnameMatchers.length > 0) {
                const first = alertnameMatchers[0];
                const matchType = String(first?.matchType ?? '').trim();
                const value = String(first?.value ?? '').trim();
                if (matchType === '=~' && value) matchersFromRouteMatchers = value.split('|').map((s) => s.trim()).filter(Boolean);
                else matchersFromRouteMatchers = alertnameMatchers.map((m: any) => String(m?.value ?? '').trim()).filter(Boolean);
              }
              const alertnameRe = (matchRe.alertname ?? '').toString().trim();
              const matchersFromRe = alertnameRe ? parseAlertnameReToMatchers(alertnameRe) : [];
              const alertnameExact = (match.alertname ?? '').toString().trim();
              const matchersFromMatch = alertnameExact ? [alertnameExact] : [];
              const fallbackMatchers = typeof annotations.matchers === 'string' ? annotations.matchers.split(',').map((s: string) => s.trim()).filter(Boolean) : [];
              const resolvedMatchers = matchersFromRouteMatchers.length ? matchersFromRouteMatchers : matchersFromRe.length ? matchersFromRe : matchersFromMatch.length ? matchersFromMatch : fallbackMatchers;
              const matcherPairsFromMatch =
                routeMatchersArray.length > 0
                  ? routeMatchersArray.filter((m: any) => (m?.name ?? '').trim() && (m?.value ?? '').trim()).map((m: any) => ({ key: String(m.name).trim(), value: String(m.value).trim() }))
                  : Object.keys(match).length ? Object.entries(match).map(([key, value]) => ({ key, value })) : [];
              const routeRepeatInterval = (d.spec?.route as any)?.repeatInterval ?? '4h';
              const configReceiverNameTypeName = routeReceiverNames.length
                ? routeReceiverNames.map((n: string) => `${nameToType[n] ?? 'email-receiver'}:${n}`)
                : routeReceiver ? [`${nameToType[routeReceiver] ?? 'email-receiver'}:${routeReceiver}`] : [];
              form.setFieldsValue({
                name: d.metadata?.name,
                namespace: d.metadata?.namespace,
                description: annotations.description ?? '',
                repeatInterval: routeRepeatInterval,
                receiverName,
                configReceiverName: configReceiverNameTypeName,
                emailList,
                matchers: resolvedMatchers,
                matcherPairs: matcherPairsFromMatch.length ? matcherPairsFromMatch : [],
              });
            } else message.error(error || '获取配置详情失败');
          })
          .catch(() => {
            setFormLoading(false);
            message.error('获取配置详情失败');
          });
      } else {
        form.resetFields();
        const defaultNs = isAdmin ? undefined : (tenantNamespaces[0] ?? 'default');
        form.setFieldsValue({
          namespace: defaultNs,
          receiverName: 'email-receiver',
          configReceiverName: [],
          emailList: [{ emailTo: '', emailFrom: '', smarthost: '', requireTls: true, authUsername: '', authIdentity: '', authSecretKey: '' }],
          matchers: [],
          matcherPairs: [],
          repeatInterval: '4h',
        });
      }
      setFormModalOpen(true);
    },
    [form, isAdmin, tenantNamespaces, cloudId, nameToType]
  );

  const handleCloseForm = useCallback(() => {
    setFormModalOpen(false);
    setEditingRecord(null);
    form.resetFields();
  }, [form]);

  /** 按 receiverName 类型筛选的 spec 接收器名称，用于级联下拉 */
  const specReceiverNameOptionsByType = useMemo(() => {
    const types: ReceiverName[] = ['email-receiver', 'dingtalk-receiver', 'website-receiver'];
    const map: Record<ReceiverName, { label: string; value: string }[]> = {} as Record<ReceiverName, { label: string; value: string }[]>;
    for (const t of types) {
      const names = new Set<string>();
      for (const r of receiversList) {
        if ((r.receiverName ?? '').toString().trim() !== t) continue;
        const list = Array.isArray(r.specReceivers) ? r.specReceivers : [];
        for (const s of list) {
          const name = (s?.name ?? '').toString().trim();
          if (name) names.add(name);
        }
      }
      map[t] = Array.from(names)
        .sort()
        .map((name) => ({ label: name, value: name }));
    }
    return map;
  }, [receiversList]);

  /** 按类型：spec 接收器名称 -> 完整 ReceiverSpec（用于多选时提交） */
  const specReceiverNameToSpecByType = useMemo(() => {
    const map: Record<ReceiverName, Record<string, ReceiverSpec>> = {} as Record<ReceiverName, Record<string, ReceiverSpec>>;
    const types: ReceiverName[] = ['email-receiver', 'dingtalk-receiver', 'website-receiver'];
    for (const t of types) {
      const byName: Record<string, ReceiverSpec> = {};
      for (const r of receiversList) {
        if ((r.receiverName ?? '').toString().trim() !== t) continue;
        const list = Array.isArray(r.specReceivers) ? r.specReceivers : [];
        for (const s of list) {
          const name = (s?.name ?? '').toString().trim();
          if (name && (s?.emailConfigs || s?.webhookConfigs)) byName[name] = { ...s, name } as ReceiverSpec;
        }
      }
      map[t] = byName;
    }
    return map;
  }, [receiversList]);

  /** 级联选择：第一级 邮件/钉钉/网站，第二级 该类型下的通知对象名称；叶子 value 为 type:name */
  const receiverCascadeOptions = useMemo((): { value: string; label: string; children?: { value: string; label: string }[] }[] => {
    return RECEIVER_NAME_OPTIONS.map((t) => ({
      value: t.value,
      label: t.label,
      children: (specReceiverNameOptionsByType[t.value] ?? []).map((o) => ({
        value: `${t.value}:${o.value}`,
        label: o.label,
      })),
    }));
  }, [specReceiverNameOptionsByType]);

  /** 通知对象多选：所有类型的选项扁平化，value=type:name，label=name (邮件) */
  const configReceiverNameOptionsFlattened = useMemo(() => {
    const out: { value: string; label: string }[] = [];
    const typeLabels: Record<ReceiverName, string> = {
      'email-receiver': '邮件',
      'dingtalk-receiver': '钉钉',
      'website-receiver': '网站',
    };
    for (const t of RECEIVER_NAME_OPTIONS) {
      const list = specReceiverNameOptionsByType[t.value] ?? [];
      const typeLabel = typeLabels[t.value] ?? t.label;
      for (const o of list) {
        out.push({ value: `${t.value}:${o.value}`, label: `${o.label} (${typeLabel})` });
      }
    }
    return out;
  }, [specReceiverNameOptionsByType]);

  const [cascadeSelectedValue, setCascadeSelectedValue] = useState<string[]>([]);

  const handleFormSubmit = useCallback(async () => {
    let fieldsToValidate: string[] = ['name', 'namespace', 'configReceiverName', 'matchers'];
    let values = await form.validateFields(fieldsToValidate).catch(() => null);
    if (!values || !cloudId) return;
    const rawConfigNames = form.getFieldValue('configReceiverName');
    const configReceiverNameEntries: string[] = Array.isArray(rawConfigNames)
      ? rawConfigNames.map((n: unknown) => String(n ?? '').trim()).filter(Boolean)
      : rawConfigNames != null && rawConfigNames !== ''
        ? [String(rawConfigNames).trim()]
        : (() => {
          const r = (editingRecord?.spec?.route as any)?.receiver;
          return r ? [r] : [];
        })();
    if (configReceiverNameEntries.length === 0) {
      message.warning('请至少选择一个通知对象');
      return;
    }
    const parsed = configReceiverNameEntries.map((entry: string) => {
      const idx = entry.indexOf(':');
      if (idx > 0) {
        const type = entry.slice(0, idx) as ReceiverName;
        const name = entry.slice(idx + 1);
        return { type, name };
      }
      return { type: (nameToType[entry] ?? 'email-receiver') as ReceiverName, name: entry };
    });
    const configReceiverNames = parsed.map((p) => p.name);
    const firstType = parsed[0]?.type ?? 'email-receiver';
    if (parsed.some((p) => p.type === 'email-receiver')) {
      const emailValues = await form.validateFields(['emailList']).catch(() => null);
      if (emailValues) values = { ...values, ...emailValues };
    }
    const name = (values.name ?? '').toString().trim();
    const namespace = (values.namespace ?? 'default').toString().trim();
    const description = form.getFieldValue('description');
    const matchers = (Array.isArray(form.getFieldValue('matchers')) ? form.getFieldValue('matchers') : []) as string[];
    setFormLoading(true);
    const annotations: Record<string, string> = editingRecord?.metadata?.annotations ? { ...editingRecord.metadata.annotations } : {};
    const existingRoute = editingRecord?.spec?.route as any;
    const existingReceivers = editingRecord?.spec?.receivers ?? [];
    const oldReceivers = collectReceiverNamesFromRoute(existingRoute, existingReceivers);
    for (const oldReceiverName of oldReceivers) {
      if (oldReceiverName) removeReceiverTypeAnnotation(annotations, oldReceiverName);
    }
    if (description != null) annotations.description = String(description).trim();
    if (matchers.length) annotations.matchers = matchers.join(',');
    type RouteMatcherItem = { matchType: string; name: string; value: string; matchers?: unknown[] };
    const routeMatchers: RouteMatcherItem[] = [];
    if (matchers.length) {
      const regexValue = matchers.map((a) => String(a).trim()).filter(Boolean).join('|');
      routeMatchers.push({ matchType: '=~', name: 'alertname', value: regexValue, matchers: [] });
    }
    setReceiverTypeAnnotation(annotations, configReceiverNames[0], firstType);
    const receiverSpecs: ReceiverSpec[] = parsed.map(({ type, name: n }) => {
      const lookup = specReceiverNameToSpecByType[type] ?? {};
      return lookup[n] ?? buildReceiverSpec(n, type, values);
    });
    const repeatInterval = (form.getFieldValue('repeatInterval') ?? '4h').toString().trim() || '4h';
    const baseRouteFields = {
      groupBy: ['alertname', 'namespace'],
      groupWait: '30s',
      groupInterval: '5m',
      repeatInterval,
      matchers: routeMatchers.map((m) => ({ matchType: m.matchType, name: m.name, value: m.value })),
    };
    const childRoutes = configReceiverNames.slice(1).map((receiver) => ({
      ...baseRouteFields,
      receiver,
      routes: [],
    }));
    const routePayload: Record<string, unknown> = {
      receivers: [],
      receiver: configReceiverNames[0],
      ...baseRouteFields,
      routes: childRoutes,
    };
    const payload: Record<string, unknown> = {
      apiVersion: 'monitoring.coreos.com/v1alpha1',
      kind: 'AlertmanagerConfig',
      metadata: { name, namespace, ...(Object.keys(annotations).length ? { annotations } : {}) },
      spec: { receivers: receiverSpecs, route: routePayload },
    };
    if (editingRecord?.metadata?.namespace && editingRecord?.metadata?.name) {
      const { data: full, ok: okDetail, error: errDetail } = await fetchAlertmanagerconfigDetail(cloudId, editingRecord.metadata.namespace, editingRecord.metadata.name);
      if (!okDetail || !full) {
        setFormLoading(false);
        message.error(errDetail || '获取告警通知策略失败');
        return;
      }
      const existingRaw = full as any;
      const existing = existingRaw?.data != null && typeof existingRaw.data === 'object' ? existingRaw.data : existingRaw;
      const existingRouteFull = existing.spec?.route ?? {};
      const { match: _omitMatch, matchRe: _omitMatchRe, ...restExistingRoute } = existingRouteFull as Record<string, unknown>;
      const routeForPut = {
        ...restExistingRoute,
        groupBy: routePayload.groupBy,
        groupInterval: routePayload.groupInterval,
        groupWait: routePayload.groupWait,
        repeatInterval: routePayload.repeatInterval,
        matchers: routePayload.matchers,
        receiver: routePayload.receiver,
        routes: routePayload.routes,
      };
      const nextPayload = {
        ...existing,
        metadata: { ...existing.metadata, name, namespace, resourceVersion: existing.metadata?.resourceVersion, ...(Object.keys(annotations).length ? { annotations } : {}) },
        spec: { ...existing.spec, receivers: receiverSpecs, route: routeForPut },
      };
      const { ok, error } = await updateAlertmanagerconfig(cloudId, editingRecord.metadata.namespace, editingRecord.metadata.name, nextPayload);
      setFormLoading(false);
      if (ok) {
        message.success('更新成功');
        handleCloseForm();
        loadConfigList();
      } else message.error(error || '更新失败');
    } else {
      const { data: created, ok, error } = await createAlertmanagerconfig(cloudId, payload);
      setFormLoading(false);
      if (ok) {
        message.success('创建成功');
        const raw = (created as any) || {};
        setConfigList((prev) => [...prev, { ...raw, id: raw.id ?? `${namespace}/${name}`, metadata: { ...raw.metadata, name, namespace }, spec: (raw.spec ?? payload.spec) as AlertmanagerConfigItem['spec'] }]);
        handleCloseForm();
      } else message.error(error || '创建失败');
    }
  }, [editingRecord, form, handleCloseForm, loadConfigList, specReceiverNameToSpecByType, cloudId]);

  const handleDeleteConfig = useCallback(
    async (row: AlertmanagerConfigItem) => {
      const ns = row.metadata?.namespace;
      const name = row.metadata?.name;
      if (!ns || !name || !cloudId) {
        message.error('缺少命名空间或名称');
        return;
      }
      const { ok, error } = await deleteAlertmanagerconfig(cloudId, ns, name);
      if (ok) {
        message.success('已删除');
        loadConfigList();
      } else message.error(error || '删除失败');
    },
    [loadConfigList, cloudId]
  );

  const configColumns: ColumnsType<AlertmanagerConfigItem> = useMemo(
    () => [
      { title: '数据源', key: 'dataSource', width: 100, render: () => 'Prometheus' },
      { title: '通知策略名称', dataIndex: ['metadata', 'name'], key: 'name', width: 180, render: (n: string, row: AlertmanagerConfigItem) => (n ?? (row as any).name ?? '-') as string },
      { title: '命名空间', dataIndex: ['metadata', 'namespace'], key: 'namespace', width: 140, render: (ns: string) => ns || '-' },
      { title: <span style={{ fontWeight: 600, color: '#000' }}>通知对象</span>, key: 'receivers', width: 120, render: (_, row) => { const receivers = row.spec?.receivers; return Array.isArray(receivers) ? (receivers as { name?: string }[]).map((r) => r.name).filter(Boolean).join(', ') || '-' : '-'; } },
      {
        title: '操作',
        key: 'action',
        width: 80,
        fixed: 'right',
        render: (_, row) => (
          <ResourceActionsDropdown
            items={[
              { key: 'edit', label: '编辑策略', onClick: () => handleOpenForm(row) },
              { type: 'divider' },
              {
                key: 'delete',
                label: '删除',
                danger: true,
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
        ),
      },
    ],
    [handleOpenForm, handleDeleteConfig]
  );

  /** 告警规则 Transfer 数据源：管理员用 rulesList（含 groupName），租户用 vmTriggerOptions */
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

  /** 告警分组下拉选项（管理员：从 rulesList 去重；租户无分组则空） */
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
    return list.sort((a, b) => (a.value === '' ? -1 : String(a.label).localeCompare(String(b.label))));
  }, [isAdmin, rulesList, rulesGroupMap]);

  const [selectedAlertGroup, setSelectedAlertGroup] = useState<string>('');

  /** 按告警分组筛选后的 Transfer 选项（左侧列表）；已选中的项始终保留以便右侧正确展示 */
  const watchedMatchers = (Form.useWatch('matchers', form) ?? []) as string[];
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

  return (
    <>
      <div>
        <PageDetailSection
          asCard={false}
          toolbarLeft={
            <>
              <Select
                placeholder="数据源"
                value={dataSourceFilter}
                onChange={(v) => setDataSourceFilter(v ?? 'prometheus')}
                options={[{ label: 'Prometheus', value: 'prometheus' }]}
                style={{ minWidth: 120 }}
              />
              <Select
                placeholder="命名空间"
                allowClear
                value={configNsFilter}
                onChange={setConfigNsFilter}
                loading={namespaceLoading}
                options={[{ label: '全部', value: undefined }, ...formNamespaceOptions]}
                style={{ width: 160 }}
              />
              <Input.Search
                placeholder="关键字"
                allowClear
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
                style={{ width: 200 }}
              />
            </>
          }
          toolbarRight={
            <>
              <Button type="primary" icon={<PlusOutlined />} onClick={() => handleOpenForm(null)}>新增通知策略</Button>
              <Button icon={<ReloadOutlined />} onClick={loadConfigList} loading={configLoading} />
            </>
          }
        >
          <Table
            className="std-table"
            bordered
            rowKey={(row) => row.id ?? row.metadata?.name ?? String(Math.random())}
            loading={configLoading}
            columns={configColumns}
            dataSource={filteredConfigList}
            scroll={{ x: 1000 }}
            pagination={{ pageSize: 10, showSizeChanger: true, showTotal: (t) => `共 ${t} 条` }}
          />
        </PageDetailSection>
      </div>

      <Modal
        open={formModalOpen}
        onCancel={handleCloseForm}
        title={editingRecord ? '编辑告警通知策略' : '新增告警通知策略'}
        width="90vw"
        destroyOnClose
        footer={
          <Space>
            <Button onClick={handleCloseForm}>取消</Button>
            <Button type="primary" loading={formLoading} onClick={handleFormSubmit}>{editingRecord ? '保存' : '创建'}</Button>
          </Space>
        }
        styles={{ body: { maxHeight: '75vh', overflow: 'auto', padding: 24 } }}
      >
        <Form
          form={form}
          layout="vertical"
          initialValues={{
            namespace: isAdmin ? undefined : (tenantNamespaces[0] ?? 'default'),
            matchers: [],
            matcherPairs: [],
            receiverName: 'email-receiver',
            configReceiverName: [],
            repeatInterval: '4h',
            emailList: [{ emailTo: '', emailFrom: '', smarthost: '', requireTls: true, authUsername: '', authIdentity: '', authSecretKey: '' }],
          }}
        >
          <Row gutter={24}>
            <Col span={10}>
              <Form.Item name="namespace" label="命名空间" rules={[{ required: true }]}>
                <Select placeholder={isAdmin ? '选择命名空间' : '租户命名空间'} disabled={!!editingRecord} loading={namespaceLoading} options={formNamespaceOptions} />
              </Form.Item>
            </Col>
            <Col span={14}>
              <Form.Item name="name" label="通知策略名称" rules={[{ required: true, message: '请输入通知策略名称' }]}>
                <Input placeholder="通知策略名称" disabled={!!editingRecord} />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={24}>
            <Col span={10}>
              <Form.Item name="repeatInterval" label="重复推送间隔 (repeatInterval)" extra="如 4h、30m">
                <Input placeholder="4h" />
              </Form.Item>
            </Col>
            <Col span={14}>
              <Form.Item name="description" label="通知策略描述">
                <Input.TextArea rows={2} placeholder="通知策略描述" />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={24}>
            <Col span={10}>
              <Form.Item label="通知方式">
                <Cascader
                  allowClear
                  placeholder="选择通知方式 → 通知对象"
                  options={receiverCascadeOptions}
                  value={cascadeSelectedValue}
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
            <Col span={14}>
              <Form.Item name="configReceiverName" label="通知对象" rules={[{ required: true, type: 'array', min: 1, message: '请至少选择一个通知对象' }]}>
                <Select
                  mode="multiple"
                  allowClear
                  loading={receiversLoading}
                  options={configReceiverNameOptionsFlattened}
                  showSearch
                  optionFilterProp="label"
                  placeholder="请选择通知对象（可多选，至少选择一个）"
                />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={24}>
            <Col span={24}>
              <Form.Item
                name="matchers"
                label="告警规则"
                rules={[{ required: true, message: '请选择告警规则' }]}
                style={{ width: '100%' }}
              >
                <>
                  {alertGroupOptions.length > 0 && (
                    <div style={{ marginBottom: 16, width: '100%' }}>
                      <Form.Item label="告警分组" style={{ marginBottom: 0 }}>
                        <Select
                          placeholder="选择分组筛选左侧告警规则"
                          allowClear
                          value={selectedAlertGroup || undefined}
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
