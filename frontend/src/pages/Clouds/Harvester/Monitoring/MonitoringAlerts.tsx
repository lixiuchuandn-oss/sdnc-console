/**
 * 监控服务 - 监控告警
 * 设计文档：plan/设计-监控服务-监控告警.md、设计-监控服务-租户入口与权限.md
 * 告警列表 + 租户告警外发配置（新增/编辑/删除）；管理员看全量，租户仅看其命名空间范围。
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Button,
  Col,
  Dropdown,
  Form,
  Input,
  message,
  Modal,
  Radio,
  Row,
  Select,
  Space,
  Switch,
  Table,
  Typography,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import {
  DeleteOutlined,
  EllipsisOutlined,
  PlusOutlined,
  ProfileOutlined,
  ReloadOutlined,
  SettingOutlined,
} from '@ant-design/icons';
import { useAuth } from '../../../../contexts/AuthContext';
import PageDetailSection from '../../../../components/PageDetailSection';
import TableColumnSettings from '../../../../components/TableColumnSettings';
import ResourceActionsDropdown from '../../../../components/ResourceActionsDropdown';
import { WizardModal, WizardLayout } from '../../../../components/WizardShell';
import {
  fetchAlertsRules,
  fetchAllowedNamespaces,
  fetchAlertmanagerconfigs,
  fetchAlertmanagerconfigDetail,
  createAlertmanagerconfig,
  updateAlertmanagerconfig,
  deleteAlertmanagerconfig,
  fetchPrometheusRuleVmCustomRules,
} from '../../../../services/monitoringApi';
import { fetchHarvesterNamespaces } from '../../../../services/harvesterApi';
import { parseAlerts, type ParsedAlert } from './utils/prometheusAlerts';
import {
  RECEIVER_TYPE_OPTIONS,
  buildReceiverSpec,
  getDingtalkSecretsFromAnnotations,
  INBOX_WEBHOOK_PLACEHOLDER,
  mergeDingtalkSecretsIntoAnnotations,
  removeDingtalkSecretsFromAnnotations,
  setReceiverTypeAnnotation,
  removeReceiverTypeAnnotation,
  type ReceiverUIType,
} from './utils/receivers';

const CRITICAL_COLOR = '#FF5C7C';
const WARNING_COLOR = '#f59e0b';

/** 排除系统命名空间，供管理员创建告警配置时命名空间下拉使用 */
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

/** 租户仅展示此规则组（触发条件选项来源） */
const TENANT_ALERT_GROUP = 'kubevirt-custom-rules';

/** 从 PrometheusRule vm-custom-rules 展平得到的触发条件选项 */
interface TriggerRuleOption {
  value: string;
  label: string;
  description?: string;
  severity?: string;
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

/** 将 route.matchRe.alertname 的正则串解析为告警名数组 */
function parseAlertnameReToMatchers(alertnameRe: string): string[] {
  if (!alertnameRe.trim()) return [];
  const parts: string[] = [];
  let current = '';
  for (let i = 0; i < alertnameRe.length; i++) {
    const c = alertnameRe[i];
    if (c === '\\' && i + 1 < alertnameRe.length) {
      const next = alertnameRe[i + 1];
      if (next === '|') {
        current += '|';
        i++;
      } else {
        current += c + next;
        i++;
      }
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

type FormInstanceType = ReturnType<typeof Form.useForm>[0];

/** 租户：触发条件多选 */
function TriggerConditionSelect({
  form,
  options,
  loading,
}: {
  form: FormInstanceType;
  options: TriggerRuleOption[];
  loading?: boolean;
}) {
  const selectedKeys = (Form.useWatch('matchers', form) ?? []) as string[];
  const setSelectedKeys = (keys: string[]) => form.setFieldValue('matchers', keys);

  return (
    <div>
      <Typography.Paragraph type="secondary" style={{ marginBottom: 12, fontSize: 13 }}>
        选择<strong>触发条件</strong>：勾选后，符合该条件的告警将发送到您上面选择的接收器。
      </Typography.Paragraph>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <span style={{ fontSize: 13, color: 'rgba(0,0,0,0.65)' }}>
          触发条件{selectedKeys.length > 0 ? `（已选 ${selectedKeys.length} 项）` : ''}
        </span>
        {selectedKeys.length > 0 && (
          <Button type="link" size="small" onClick={() => setSelectedKeys([])} style={{ padding: 0, fontSize: 12 }}>
            清空
          </Button>
        )}
      </div>
      <Table
        size="small"
        rowKey="value"
        dataSource={options}
        loading={loading}
        pagination={false}
        rowSelection={{
          selectedRowKeys: selectedKeys,
          onChange: (keys) => setSelectedKeys(keys as string[]),
        }}
        columns={[{ title: '条件名称', dataIndex: 'label', key: 'label', render: (t: string) => t || '-' }]}
      />
    </div>
  );
}

/** 管理员：匹配器键值对 */
function AdminMatcherPairs({ form }: { form: FormInstanceType }) {
  return (
    <div>
      <Typography.Paragraph type="secondary" style={{ marginBottom: 12, fontSize: 13 }}>
        添加<strong>匹配器</strong>（标签键值对）：仅当告警的标签与下列键值对一致时，才会发送到本接收器。
      </Typography.Paragraph>
      <Form.List name="matcherPairs">
        {(fields, { add, remove }) => (
          <>
            {fields.map(({ key, name, ...rest }) => (
              <div key={key} style={{ display: 'flex', gap: 8, marginBottom: 8, alignItems: 'center' }}>
                <Form.Item {...rest} name={[name, 'key']} rules={[{ required: true, message: '必填' }]} noStyle>
                  <Input placeholder="键（如 severity）" style={{ width: 160 }} />
                </Form.Item>
                <Form.Item {...rest} name={[name, 'value']} rules={[{ required: true, message: '必填' }]} noStyle>
                  <Input placeholder="值（如 critical）" style={{ width: 160 }} />
                </Form.Item>
                <Button type="link" danger size="small" onClick={() => remove(name)}>
                  删除
                </Button>
              </div>
            ))}
            <Button type="dashed" onClick={() => add({ key: '', value: '' })} icon={<PlusOutlined />}>
              添加匹配器
            </Button>
          </>
        )}
      </Form.List>
    </div>
  );
}

/** 右侧配置预览 */
function AlertConfigPreview({
  form,
  isAdmin,
  triggerOptions = [],
}: {
  form: FormInstanceType;
  isAdmin: boolean;
  triggerOptions?: TriggerRuleOption[];
}) {
  const name = Form.useWatch('name', form) ?? '';
  const namespace = Form.useWatch('namespace', form) ?? '';
  const description = Form.useWatch('description', form) ?? '';
  const receiverType: ReceiverUIType = Form.useWatch('receiverType', form) ?? 'email';
  const dingtalkList = Form.useWatch('dingtalkList', form) ?? [];
  const emailList = Form.useWatch('emailList', form) ?? [];
  const matchers = (Form.useWatch('matchers', form) ?? []) as string[];
  const matcherPairs = (Form.useWatch('matcherPairs', form) ?? []) as Array<{ key?: string; value?: string }>;
  const dingtalkCount = Array.isArray(dingtalkList) ? dingtalkList.filter((i: any) => (i?.webhookUrl ?? '').toString().trim()).length : 0;
  const emailCount = Array.isArray(emailList) ? emailList.filter((i: any) => (i?.emailTo ?? '').toString().trim()).length : 0;
  const receiverDetail =
    receiverType === 'email'
      ? emailCount
        ? `邮箱 ${emailCount} 条`
        : '-'
      : receiverType === 'dingtalk'
        ? dingtalkCount
          ? `钉钉 ${dingtalkCount} 条`
          : '-'
        : '-';
  const matcherLabels = isAdmin
    ? matcherPairs.filter((p) => (p?.key ?? '').trim()).map((p) => `${p?.key ?? ''}=${p?.value ?? ''}`)
    : (matchers.filter(Boolean) as string[]).map((v) => triggerOptions.find((o) => o.value === v)?.label ?? v);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div><span style={{ color: 'rgba(0,0,0,0.45)', marginRight: 8 }}>名称</span><span>{name || '-'}</span></div>
      <div><span style={{ color: 'rgba(0,0,0,0.45)', marginRight: 8 }}>命名空间</span><span>{namespace || '-'}</span></div>
      <div><span style={{ color: 'rgba(0,0,0,0.45)', marginRight: 8 }}>描述</span><span>{(description || '').trim() || '-'}</span></div>
      <div><span style={{ color: 'rgba(0,0,0,0.45)', marginRight: 8 }}>接收类型</span><span>{RECEIVER_TYPE_OPTIONS.find((o) => o.value === receiverType)?.label ?? receiverType}</span></div>
      <div><span style={{ color: 'rgba(0,0,0,0.45)', marginRight: 8 }}>配置摘要</span><span>{receiverDetail}</span></div>
      <div><span style={{ color: 'rgba(0,0,0,0.45)', marginRight: 8 }}>已选条件</span><span>{matcherLabels.length ? matcherLabels.join('、') : '-'}</span></div>
    </div>
  );
}

interface MonitoringAlertsProps {
  cloudId: string;
}

const MonitoringAlerts: React.FC<MonitoringAlertsProps> = ({ cloudId }) => {
  const { user } = useAuth();
  const isAdmin = user?.role === 'super_admin' || user?.role === 'leased_lines_admin';

  // 告警列表
  const [alertsLoading, setAlertsLoading] = useState(false);
  const [alertsData, setAlertsData] = useState<any>(null);
  const [alertTotal, setAlertTotal] = useState(0);
  const [alertPage, setAlertPage] = useState(1);
  const [alertPageSize, setAlertPageSize] = useState(10);
  const [alertKeyword, setAlertKeyword] = useState('');
  const [levelFilter, setLevelFilter] = useState<string>('');
  const [namespaceFilter, setNamespaceFilter] = useState<string>('');
  const [tenantNamespaces, setTenantNamespaces] = useState<string[]>([]);
  const [allowedNsLoading, setAllowedNsLoading] = useState(false);
  const [alertTableColumns, setAlertTableColumns] = useState<ColumnsType<ParsedAlert>>([]);

  // 告警外发配置弹框（管理员与租户共用）
  const [configModalOpen, setConfigModalOpen] = useState(false);
  const [configList, setConfigList] = useState<AlertmanagerConfigItem[]>([]);
  const [configLoading, setConfigLoading] = useState(false);
  const [namespaceList, setNamespaceList] = useState<string[]>([]);
  const [namespaceLoading, setNamespaceLoading] = useState(false);
  const [keyword, setKeyword] = useState('');
  const [configNsFilter, setConfigNsFilter] = useState<string | undefined>();

  // 新增/编辑步骤弹框
  const [formModalOpen, setFormModalOpen] = useState(false);
  const [formStep, setFormStep] = useState(0);
  const [editingRecord, setEditingRecord] = useState<AlertmanagerConfigItem | null>(null);
  const [formLoading, setFormLoading] = useState(false);
  const [form] = Form.useForm();
  const [vmTriggerOptions, setVmTriggerOptions] = useState<TriggerRuleOption[]>([]);
  const [vmTriggerLoading, setVmTriggerLoading] = useState(false);

  const loadAlerts = useCallback(async () => {
    if (!cloudId) return;
    setAlertsLoading(true);
    const opts: { namespace?: string; page?: number; pageSize?: number } = {};
    if (namespaceFilter) opts.namespace = namespaceFilter;
    if (isAdmin) {
      opts.page = alertPage;
      opts.pageSize = alertPageSize;
    }
    const { data, ok } = await fetchAlertsRules(cloudId, opts);
    setAlertsLoading(false);
    if (!ok) {
      setAlertsData(null);
      setAlertTotal(0);
    } else if (data != null && typeof data === 'object' && !Array.isArray(data) && 'data' in data && 'total' in data) {
      setAlertsData((data as { data: unknown[] }).data);
      setAlertTotal((data as { total: number }).total);
    } else {
      const list = Array.isArray(data) ? data : [];
      setAlertsData(list);
      setAlertTotal(list.length);
    }
  }, [cloudId, isAdmin, alertPage, alertPageSize, namespaceFilter]);

  const loadAllowedNamespaces = useCallback(async () => {
    if (!cloudId || isAdmin) return;
    setAllowedNsLoading(true);
    const { data, ok } = await fetchAllowedNamespaces(cloudId);
    setAllowedNsLoading(false);
    if (ok && data?.namespaces) setTenantNamespaces(data.namespaces);
    else setTenantNamespaces([]);
  }, [cloudId, isAdmin]);

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

  const loadNamespaces = useCallback(async () => {
    if (!cloudId) return;
    setNamespaceLoading(true);
    try {
      const res: any = await fetchHarvesterNamespaces(cloudId);
      const items: any[] = Array.isArray(res?.data?.items) ? res.data.items : res?.data ?? res?.items ?? [];
      const raw: string[] = items
        .map((i: any) => i?.metadata?.name ?? i?.name)
        .filter((n: unknown): n is string => typeof n === 'string' && n.length > 0);
      const filtered = filterNonSystemNamespaces([...new Set(raw)]);
      const withDefault = filtered.includes('default') ? filtered : ['default', ...filtered];
      setNamespaceList(withDefault.sort());
    } catch {
      setNamespaceList([]);
    } finally {
      setNamespaceLoading(false);
    }
  }, [cloudId]);

  const loadVmTriggerOptions = useCallback(async () => {
    if (!cloudId) return;
    setVmTriggerLoading(true);
    const { data, ok } = await fetchPrometheusRuleVmCustomRules(cloudId);
    setVmTriggerLoading(false);
    if (ok && data) setVmTriggerOptions(flattenPrometheusRuleToTriggerOptions(data));
    else setVmTriggerOptions([]);
  }, [cloudId]);

  useEffect(() => {
    if (cloudId) loadAlerts();
  }, [loadAlerts, cloudId]);

  useEffect(() => {
    if (cloudId && !isAdmin) loadAllowedNamespaces();
  }, [cloudId, isAdmin, loadAllowedNamespaces]);

  useEffect(() => {
    if (configModalOpen && cloudId) {
      loadConfigList();
      if (isAdmin) loadNamespaces();
    }
  }, [configModalOpen, cloudId, isAdmin, loadConfigList, loadNamespaces]);

  useEffect(() => {
    if (formModalOpen && cloudId && !isAdmin) loadVmTriggerOptions();
  }, [formModalOpen, cloudId, isAdmin, loadVmTriggerOptions]);

  const alertsList = useMemo(() => parseAlerts(alertsData ?? null), [alertsData]);

  const filteredAlerts = useMemo(() => {
    let list = alertsList;
    if (levelFilter === 'critical') list = list.filter((a) => a.level === 'critical');
    else if (levelFilter === 'warning') list = list.filter((a) => a.level === 'warning');
    if (alertKeyword.trim()) {
      const k = alertKeyword.trim().toLowerCase();
      list = list.filter(
        (a) =>
          a.title.toLowerCase().includes(k) ||
          a.description.toLowerCase().includes(k)
      );
    }
    return list;
  }, [alertsList, levelFilter, alertKeyword]);

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

  const levelOptions = [
    { label: '全部', value: '' },
    { label: '严重', value: 'critical' },
    { label: '警告', value: 'warning' },
  ];

  const handleOpenForm = useCallback(
    (record: AlertmanagerConfigItem | null) => {
      setFormStep(0);
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
              const routeReceiver = d.spec?.route?.receiver ?? d.spec?.receivers?.[0]?.name;
              const receivers = Array.isArray(d.spec?.receivers) ? d.spec.receivers : [];
              const r0 = routeReceiver ? receivers.find((r: any) => r.name === routeReceiver) : receivers[0];
              let receiverType: ReceiverUIType = 'email';
              let dingtalkList = [{ webhookUrl: '', dingtalkSigningSecret: '' }];
              let emailList = [{ emailTo: '', emailFrom: '', smarthost: '', requireTls: true, authUsername: '', authIdentity: '', authSecretKey: '' }];
              if (r0) {
                if (r0.emailConfigs?.length) {
                  receiverType = 'email';
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
                } else if (r0.webhookConfigs?.length) {
                  const url0 = r0.webhookConfigs[0]?.url ?? '';
                  if (url0 !== INBOX_WEBHOOK_PLACEHOLDER && !/inbox|站内信/i.test(url0)) {
                    receiverType = 'dingtalk';
                    const secrets = getDingtalkSecretsFromAnnotations(annotations, r0.name);
                    dingtalkList = (r0.webhookConfigs || []).map((w: any, i: number) => ({
                      webhookUrl: w?.url ?? '',
                      dingtalkSigningSecret: secrets[i] ?? '',
                    }));
                    if (dingtalkList.length === 0) dingtalkList.push({ webhookUrl: '', dingtalkSigningSecret: '' });
                  }
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
                if (matchType === '=~' && value) {
                  matchersFromRouteMatchers = value.split('|').map((s) => s.trim()).filter(Boolean);
                } else {
                  matchersFromRouteMatchers = alertnameMatchers.map((m: any) => String(m?.value ?? '').trim()).filter(Boolean);
                }
              }
              const alertnameRe = (matchRe.alertname ?? '').toString().trim();
              const matchersFromRe = alertnameRe ? parseAlertnameReToMatchers(alertnameRe) : [];
              const alertnameExact = (match.alertname ?? '').toString().trim();
              const matchersFromMatch = alertnameExact ? [alertnameExact] : [];
              const fallbackMatchers = typeof annotations.matchers === 'string' ? annotations.matchers.split(',').map((s: string) => s.trim()).filter(Boolean) : [];
              const resolvedMatchers =
                matchersFromRouteMatchers.length
                  ? matchersFromRouteMatchers
                  : matchersFromRe.length
                    ? matchersFromRe
                    : matchersFromMatch.length
                      ? matchersFromMatch
                      : fallbackMatchers;
              const matcherPairsFromMatch =
                routeMatchersArray.length > 0
                  ? routeMatchersArray
                      .filter((m: any) => (m?.name ?? '').trim() && (m?.value ?? '').trim())
                      .map((m: any) => ({ key: String(m.name).trim(), value: String(m.value).trim() }))
                  : Object.keys(match).length
                    ? Object.entries(match).map(([key, value]) => ({ key, value }))
                    : [];
              const routeRepeatInterval = (d.spec?.route as any)?.repeatInterval ?? '4h';
              form.setFieldsValue({
                name: d.metadata?.name,
                namespace: d.metadata?.namespace,
                description: annotations.description ?? '',
                repeatInterval: routeRepeatInterval,
                receiverType,
                dingtalkList,
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
          receiverType: 'email',
          dingtalkList: [{ webhookUrl: '', dingtalkSigningSecret: '' }],
          emailList: [{ emailTo: '', emailFrom: '', smarthost: '', requireTls: true, authUsername: '', authIdentity: '', authSecretKey: '' }],
          matchers: [],
          matcherPairs: [],
          repeatInterval: '4h',
        });
        setFormModalOpen(true);
      }
      setFormModalOpen(true);
    },
    [form, isAdmin, tenantNamespaces, cloudId]
  );

  const handleCloseForm = useCallback(() => {
    setFormModalOpen(false);
    setFormStep(0);
    setEditingRecord(null);
    form.resetFields();
  }, [form]);

  const handleFormSubmit = useCallback(async () => {
    const receiverType: ReceiverUIType = form.getFieldValue('receiverType') ?? 'email';
    const fieldsToValidate = ['name', 'namespace'];
    if (receiverType === 'dingtalk') fieldsToValidate.push('dingtalkList');
    else if (receiverType === 'email') fieldsToValidate.push('emailList');
    fieldsToValidate.push('receiverType');
    const values = await form.validateFields(fieldsToValidate).catch(() => null);
    if (!values || !cloudId) return;
    const name = (values.name ?? '').toString().trim();
    const namespace = (values.namespace ?? 'default').toString().trim();
    const description = form.getFieldValue('description');
    const matchers = (Array.isArray(form.getFieldValue('matchers')) ? form.getFieldValue('matchers') : []) as string[];
    const matcherPairs = (Array.isArray(form.getFieldValue('matcherPairs')) ? form.getFieldValue('matcherPairs') : []) as Array<{ key?: string; value?: string }>;
    const receiverName = (editingRecord?.spec?.route as any)?.receiver ?? receiverType;

    setFormLoading(true);
    const annotations: Record<string, string> = editingRecord?.metadata?.annotations ? { ...editingRecord.metadata.annotations } : {};
    const oldReceiverName = (editingRecord?.spec?.route as any)?.receiver;
    if (oldReceiverName) {
      removeDingtalkSecretsFromAnnotations(annotations, oldReceiverName);
      removeReceiverTypeAnnotation(annotations, oldReceiverName);
    }
    if (description != null) annotations.description = String(description).trim();
    if (matchers.length) annotations.matchers = matchers.join(',');
    type RouteMatcherItem = { matchType: string; name: string; value: string; matchers?: unknown[] };
    const routeMatchers: RouteMatcherItem[] = [];
    if (isAdmin) {
      matcherPairs.forEach((p) => {
        const k = (p?.key ?? '').toString().trim();
        const v = (p?.value ?? '').toString().trim();
        if (k) routeMatchers.push({ matchType: '=', name: k, value: v, matchers: [] });
      });
    } else if (matchers.length) {
      const regexValue = matchers.map((a) => String(a).trim()).filter(Boolean).join('|');
      routeMatchers.push({ matchType: '=~', name: 'alertname', value: regexValue, matchers: [] });
    }
    if (receiverType === 'dingtalk' && Array.isArray(values.dingtalkList)) {
      const secrets = values.dingtalkList.map((item: any) => (item?.dingtalkSigningSecret ?? '').toString().trim());
      mergeDingtalkSecretsIntoAnnotations(annotations, receiverName, secrets);
    }
    setReceiverTypeAnnotation(annotations, receiverName, receiverType);

    const receiverSpec = buildReceiverSpec(receiverName, receiverType, values);
    const repeatInterval = (form.getFieldValue('repeatInterval') ?? '4h').toString().trim() || '4h';
    const routePayload: Record<string, unknown> = {
      receivers: [],
      receiver: receiverName,
      groupBy: ['alertname', 'namespace'],
      groupWait: '30s',
      groupInterval: '5m',
      repeatInterval,
      matchers: routeMatchers.map((m) => ({ matchType: m.matchType, name: m.name, value: m.value })),
    };
    const payload: Record<string, unknown> = {
      apiVersion: 'monitoring.coreos.com/v1alpha1',
      kind: 'AlertmanagerConfig',
      metadata: { name, namespace, ...(Object.keys(annotations).length ? { annotations } : {}) },
      spec: {
        receivers: [receiverSpec],
        route: { ...routePayload, routes: [] },
      },
    };

    if (editingRecord?.metadata?.namespace && editingRecord?.metadata?.name) {
      const { data: full, ok: okDetail, error: errDetail } = await fetchAlertmanagerconfigDetail(
        cloudId,
        editingRecord.metadata.namespace,
        editingRecord.metadata.name
      );
      if (!okDetail || !full) {
        setFormLoading(false);
        message.error(errDetail || '获取配置失败');
        return;
      }
      const existingRaw = full as any;
      const existing = existingRaw?.data != null && typeof existingRaw.data === 'object' ? existingRaw.data : existingRaw;
      const existingRoute = existing.spec?.route ?? {};
      const { match: _omitMatch, matchRe: _omitMatchRe, ...restExistingRoute } = existingRoute as Record<string, unknown>;
      const routeForPut = {
        ...restExistingRoute,
        groupBy: routePayload.groupBy,
        groupInterval: routePayload.groupInterval,
        groupWait: routePayload.groupWait,
        repeatInterval: routePayload.repeatInterval,
        matchers: routePayload.matchers,
        receiver: routePayload.receiver,
        routes: (existingRoute as any).routes ?? [],
      };
      const nextPayload = {
        ...existing,
        metadata: {
          ...existing.metadata,
          name,
          namespace,
          resourceVersion: existing.metadata?.resourceVersion,
          ...(Object.keys(annotations).length ? { annotations } : {}),
        },
        spec: {
          ...existing.spec,
          receivers: [receiverSpec],
          route: routeForPut,
        },
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
        setConfigList((prev) => [
          ...prev,
          {
            ...raw,
            id: raw.id ?? `${namespace}/${name}`,
            metadata: { ...raw.metadata, name, namespace },
            spec: (raw.spec ?? payload.spec) as AlertmanagerConfigItem['spec'],
          },
        ]);
        handleCloseForm();
      } else message.error(error || '创建失败');
    }
  }, [editingRecord, form, handleCloseForm, loadConfigList, isAdmin, cloudId]);

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
      {
        title: '名称',
        dataIndex: ['metadata', 'name'],
        key: 'name',
        width: 180,
        render: (n: string, row: AlertmanagerConfigItem) => (n ?? (row as any).name ?? '-') as string,
      },
      { title: '命名空间', dataIndex: ['metadata', 'namespace'], key: 'namespace', width: 140, render: (ns: string) => ns || '-' },
      {
        title: '接收器',
        key: 'receivers',
        width: 120,
        render: (_, row) => {
          const receivers = row.spec?.receivers ?? [];
          const names = Array.isArray(receivers) ? (receivers as { name?: string }[]).map((r) => r.name).filter(Boolean).join(', ') || '-' : '-';
          return names;
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
              { key: 'edit', label: '编辑配置', onClick: () => handleOpenForm(row) },
              { type: 'divider' },
              {
                key: 'delete',
                label: '删除',
                danger: true,
                onClick: () => {
                  Modal.confirm({
                    title: '确定删除该配置？',
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

  const alertConfigReceiverType: ReceiverUIType = Form.useWatch('receiverType', form) ?? 'email';

  const alertColumns: ColumnsType<ParsedAlert> = useMemo(
    () => [
      { title: '告警名称', dataIndex: 'title', key: 'title', width: 220, ellipsis: true, render: (t: string) => <Typography.Text strong ellipsis>{t || '--'}</Typography.Text> },
      {
        title: '状态',
        dataIndex: 'level',
        key: 'level',
        width: 100,
        render: (level: 'critical' | 'warning') => (
          <Space size={6}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: level === 'critical' ? CRITICAL_COLOR : WARNING_COLOR }} />
            <span>{level === 'critical' ? '严重' : '警告'}</span>
          </Space>
        ),
      },
      ...(isAdmin ? [] : [{ title: '命名空间', dataIndex: 'namespace', key: 'namespace', width: 120, render: (v: string) => v || '-' }]),
      { title: '触发时间', dataIndex: 'activeAt', key: 'activeAt', width: 160, render: (v: string) => v || '-' },
      { title: '描述', dataIndex: 'description', key: 'description', render: (v: string) => <Typography.Text type="secondary" style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{v || '-'}</Typography.Text> },
    ],
    [isAdmin]
  );

  const namespaceFilterOptions = useMemo(() => {
    if (isAdmin) {
      const allNs = new Set<string>();
      alertsList.forEach((a) => { if (a.namespace) allNs.add(a.namespace); });
      return [{ label: '全部', value: '' }, ...Array.from(allNs).sort().map((ns) => ({ label: ns, value: ns }))];
    }
    return [{ label: '全部', value: '' }, ...tenantNamespaces.map((ns) => ({ label: ns, value: ns }))];
  }, [isAdmin, alertsList, tenantNamespaces]);

  const alertTableDisplayColumns = alertTableColumns.length > 0 ? alertTableColumns : alertColumns;

  return (
    <div>
      <PageDetailSection
        asCard={false}
        toolbarLeft={
          <>
            <Input.Search
              placeholder="关键字"
              allowClear
              value={alertKeyword}
              onChange={(e) => setAlertKeyword(e.target.value)}
              onSearch={loadAlerts}
            />
            <Select
              placeholder="级别"
              allowClear
              value={levelFilter || undefined}
              onChange={(v) => setLevelFilter(v ?? '')}
              options={levelOptions}
            />
            <Select
              placeholder="命名空间"
              allowClear
              value={namespaceFilter || undefined}
              onChange={(v) => setNamespaceFilter(v ?? '')}
              options={namespaceFilterOptions}
              loading={!isAdmin && allowedNsLoading}
            />
          </>
        }
        toolbarRight={
          <>
            <Button type="primary" icon={<SettingOutlined />} onClick={() => setConfigModalOpen(true)}>
              告警外发配置
            </Button>
            <Dropdown menu={{ items: [{ key: 'placeholder', label: '暂无更多操作', disabled: true }] }} trigger={['click']}>
              <Button icon={<EllipsisOutlined />} />
            </Dropdown>
            <TableColumnSettings
              columns={alertColumns}
              onChange={setAlertTableColumns}
              settingsKey="monitoring_alerts_table"
            />
            <Button icon={<ReloadOutlined />} onClick={loadAlerts} loading={alertsLoading} />
          </>
        }
      >
        <Table
          className="std-table"
          bordered
          rowKey={(row: ParsedAlert) => row.id}
          loading={alertsLoading}
          columns={alertTableDisplayColumns}
          dataSource={filteredAlerts}
          scroll={{ x: 1000 }}
          pagination={
            isAdmin
              ? {
                  current: alertPage,
                  pageSize: alertPageSize,
                  total: alertTotal,
                  showSizeChanger: true,
                  showTotal: (total, range) => `第 ${range[0]}-${range[1]} 条，共 ${total} 条`,
                  pageSizeOptions: ['10', '20', '50'],
                  onChange: (page, size) => {
                    setAlertPage(page);
                    if (size) setAlertPageSize(size);
                  },
                }
              : { pageSize: 10, showSizeChanger: true, showTotal: (t) => `共 ${t} 条` }
          }
        />
      </PageDetailSection>

      {/* 告警外发配置弹框（管理员与租户共用） */}
      <Modal
        title="告警外发配置"
        open={configModalOpen}
        onCancel={() => setConfigModalOpen(false)}
        width={900}
        centered
        styles={{ body: { minHeight: 400, maxHeight: '70vh', overflowY: 'auto' } }}
        footer={null}
        destroyOnClose
      >
        <Space direction="vertical" style={{ width: '100%' }} size="middle">
          <Space wrap style={{ width: '100%', justifyContent: 'space-between' }}>
            <Space wrap>
              <Input.Search placeholder="关键字" allowClear value={keyword} onChange={(e) => setKeyword(e.target.value)} style={{ width: 200 }} />
              <Select
                placeholder="命名空间"
                allowClear
                value={configNsFilter}
                onChange={setConfigNsFilter}
                loading={namespaceLoading}
                options={[{ label: '全部', value: undefined }, ...formNamespaceOptions]}
                style={{ width: 160 }}
              />
            </Space>
            <Space>
              <Button type="primary" icon={<PlusOutlined />} onClick={() => handleOpenForm(null)}>
                新增
              </Button>
              <Button icon={<ReloadOutlined />} onClick={loadConfigList} loading={configLoading} />
            </Space>
          </Space>
          <Table
            rowKey={(row) => row.id ?? row.metadata?.name ?? String(Math.random())}
            size="small"
            loading={configLoading}
            columns={configColumns}
            dataSource={filteredConfigList}
            scroll={{ x: 800 }}
            pagination={{ pageSize: 10, showSizeChanger: true, showTotal: (t) => `共 ${t} 条` }}
          />
        </Space>
      </Modal>

      {/* 新增/编辑步骤弹框（复用全局 WizardShell） */}
      <WizardModal
        open={formModalOpen}
        onCancel={handleCloseForm}
        title={editingRecord ? '编辑告警外发配置' : '新增告警外发'}
        width="70vw"
        bodyVh={75}
        footer={
          <Space>
            <Button onClick={handleCloseForm}>取消</Button>
            {formStep > 0 && (
              <Button onClick={() => setFormStep(formStep - 1)}>上一步</Button>
            )}
            {formStep < 2 ? (
              <Button
                type="primary"
                onClick={async () => {
                  try {
                    if (formStep === 0) {
                      await form.validateFields(['name', 'namespace']);
                      setFormStep(1);
                      return;
                    }
                    if (formStep === 1) {
                      const type = form.getFieldValue('receiverType');
                      await form.validateFields(['receiverType']);
                      if (type === 'email') {
                        const list = form.getFieldValue('emailList') ?? [];
                        const hasOne = Array.isArray(list) && list.some((i: any) => (i?.emailTo ?? '').toString().trim());
                        if (!hasOne) {
                          message.error('至少添加一条目标邮箱');
                          return;
                        }
                      } else if (type === 'dingtalk') {
                        const list = form.getFieldValue('dingtalkList') ?? [];
                        const hasOne = Array.isArray(list) && list.some((i: any) => (i?.webhookUrl ?? '').toString().trim());
                        if (!hasOne) {
                          message.error('至少添加一条钉钉 Webhook 地址');
                          return;
                        }
                      }
                      setFormStep(2);
                    }
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
          steps={[{ title: '基础信息' }, { title: '接收器' }, { title: '触发条件' }]}
          current={formStep}
          onStepChange={setFormStep}
          right={
            <>
              <Typography.Text type="secondary">配置预览</Typography.Text>
              <div style={{ marginTop: 8 }}>
                <AlertConfigPreview form={form} isAdmin={isAdmin} triggerOptions={vmTriggerOptions} />
              </div>
            </>
          }
        >
          <Form
              form={form}
              layout="vertical"
              initialValues={{
                namespace: isAdmin ? undefined : (tenantNamespaces[0] ?? 'default'),
                matchers: [],
                matcherPairs: [],
                receiverType: 'email',
                repeatInterval: '4h',
                dingtalkList: [{ webhookUrl: '', dingtalkSigningSecret: '' }],
                emailList: [{ emailTo: '', emailFrom: '', smarthost: '', requireTls: true, authUsername: '', authIdentity: '', authSecretKey: '' }],
              }}
            >
              <div style={{ display: formStep === 0 ? 'block' : 'none' }}>
                <Typography.Paragraph type="secondary" style={{ marginBottom: 12, fontSize: 13 }}>
                  设定告警外发配置的基本信息。
                </Typography.Paragraph>
                <Row gutter={24}>
                  <Col span={12}>
                    <Form.Item name="name" label="名称" rules={[{ required: true, message: '请输入名称' }]}>
                      <Input placeholder="名称" disabled={!!editingRecord} />
                    </Form.Item>
                  </Col>
                  <Col span={12}>
                    <Form.Item name="namespace" label="命名空间" rules={[{ required: true }]}>
                      <Select placeholder={isAdmin ? '选择命名空间' : '租户命名空间'} disabled={!!editingRecord} loading={namespaceLoading} options={formNamespaceOptions} />
                    </Form.Item>
                  </Col>
                </Row>
                <Form.Item name="repeatInterval" label="重复推送间隔 (repeatInterval)" extra="如 4h、30m">
                  <Input placeholder="4h" />
                </Form.Item>
                <Form.Item name="description" label="描述（可选）">
                  <Input.TextArea rows={2} placeholder="备注信息" />
                </Form.Item>
              </div>

              <div style={{ display: formStep === 1 ? 'block' : 'none' }}>
                <Typography.Paragraph type="secondary" style={{ marginBottom: 12, fontSize: 13 }}>
                  选择接收器类型并填写推送地址。
                </Typography.Paragraph>
                <Form.Item name="receiverType" rules={[{ required: true, message: '请选择类型' }]}>
                  <Radio.Group optionType="button" buttonStyle="solid">
                    {RECEIVER_TYPE_OPTIONS.map((o) => (
                      <Radio key={o.value} value={o.value}>
                        {o.label}
                      </Radio>
                    ))}
                  </Radio.Group>
                </Form.Item>
                {alertConfigReceiverType === 'dingtalk' && (
                  <Form.List name="dingtalkList">
                    {(fields, { add, remove }) => (
                      <>
                        {fields.map(({ key, name, ...rest }) => (
                          <div key={key} style={{ marginBottom: 16, padding: 12, background: '#fafafa', borderRadius: 8 }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                              <span style={{ fontSize: 13, fontWeight: 500 }}>钉钉地址 {name + 1}</span>
                              {fields.length > 1 && (
                                <Button type="link" danger size="small" icon={<DeleteOutlined />} onClick={() => remove(name)}>
                                  删除
                                </Button>
                              )}
                            </div>
                            <Form.Item {...rest} name={[name, 'webhookUrl']} label="Webhook 地址" rules={[{ required: true, message: '请输入 Webhook 地址' }]}>
                              <Input placeholder="https://oapi.dingtalk.com/robot/send?access_token=..." />
                            </Form.Item>
                            <Form.Item {...rest} name={[name, 'dingtalkSigningSecret']} label="签名密钥">
                              <Input.Password placeholder="加签安全设置中的签名密钥（可选）" autoComplete="new-password" />
                            </Form.Item>
                          </div>
                        ))}
                        <Button type="dashed" onClick={() => add({ webhookUrl: '', dingtalkSigningSecret: '' })} block icon={<PlusOutlined />}>
                          添加钉钉地址
                        </Button>
                      </>
                    )}
                  </Form.List>
                )}
                {alertConfigReceiverType === 'email' && (
                  <Form.List name="emailList">
                    {(fields, { add, remove }) => (
                      <>
                        {fields.map(({ key, name, ...rest }) => (
                          <div key={key} style={{ marginBottom: 16, padding: 12, background: '#fafafa', borderRadius: 8 }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                              <span style={{ fontSize: 13, fontWeight: 500 }}>邮箱 {name + 1}</span>
                              {fields.length > 1 && (
                                <Button type="link" danger size="small" icon={<DeleteOutlined />} onClick={() => remove(name)}>
                                  删除
                                </Button>
                              )}
                            </div>
                            <Form.Item {...rest} name={[name, 'emailTo']} label="目标邮箱" rules={[{ required: true, message: '请输入收件人邮箱' }]}>
                              <Input placeholder="收件人邮箱，多个用逗号隔开" />
                            </Form.Item>
                            <Row gutter={16}>
                              <Col span={12}>
                                <Form.Item {...rest} name={[name, 'smarthost']} label="SMTP 服务器" rules={[{ required: true, message: '请输入 SMTP 服务器' }]}>
                                  <Input placeholder="smtp.example.com:587" />
                                </Form.Item>
                              </Col>
                              <Col span={12}>
                                <Form.Item {...rest} name={[name, 'emailFrom']} label="发件人">
                                  <Input placeholder="noreply@example.com" />
                                </Form.Item>
                              </Col>
                            </Row>
                            <Form.Item {...rest} name={[name, 'requireTls']} label="SMTP SSL" valuePropName="checked">
                              <Switch checkedChildren="开启" unCheckedChildren="关闭" />
                            </Form.Item>
                            <Form.Item {...rest} name={[name, 'authUsername']} label="认证用户名">
                              <Input placeholder="可选" />
                            </Form.Item>
                            <Row gutter={16}>
                              <Col span={12}>
                                <Form.Item {...rest} name={[name, 'authIdentity']} label="具有 Auth 密码的密钥（Secret 名称）">
                                  <Input placeholder="如 admin-email-secret" />
                                </Form.Item>
                              </Col>
                              <Col span={12}>
                                <Form.Item {...rest} name={[name, 'authSecretKey']} label="Key（Secret 中的键名）">
                                  <Input placeholder="如 password" />
                                </Form.Item>
                              </Col>
                            </Row>
                          </div>
                        ))}
                        <Button type="dashed" onClick={() => add({ emailTo: '', emailFrom: '', smarthost: '', requireTls: true, authUsername: '', authIdentity: '', authSecretKey: '' })} block icon={<PlusOutlined />}>
                          添加邮箱配置
                        </Button>
                      </>
                    )}
                  </Form.List>
                )}
              </div>

              <div style={{ display: formStep === 2 ? 'block' : 'none' }}>
                {isAdmin ? (
                  <>
                    <Typography.Paragraph type="secondary" style={{ marginBottom: 12, fontSize: 13 }}>
                      添加匹配器（标签键值对），仅当告警标签匹配时才会发送到本接收器。
                    </Typography.Paragraph>
                    <AdminMatcherPairs form={form} />
                  </>
                ) : (
                  <>
                    <Typography.Paragraph type="secondary" style={{ marginBottom: 12, fontSize: 13 }}>
                      选择需要触发的告警规则，符合该条件的告警将发送到上一步配置的接收器。
                    </Typography.Paragraph>
                    <Form.Item name="matchers">
                      <TriggerConditionSelect form={form} options={vmTriggerOptions} loading={vmTriggerLoading} />
                    </Form.Item>
                  </>
                )}
              </div>
            </Form>
        </WizardLayout>
      </WizardModal>
    </div>
  );
};

export default MonitoringAlerts;
