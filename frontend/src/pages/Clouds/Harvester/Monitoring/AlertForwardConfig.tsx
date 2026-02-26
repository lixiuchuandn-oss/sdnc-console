/**
 * 告警通知配置：配置列表弹框 + 新增/编辑步骤弹框
 * 从 MonitoringAlerts 迁出，置于「告警规则」Tab 下使用。
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Button,
  Col,
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
  Empty,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { DeleteOutlined, PlusOutlined, ReloadOutlined, SettingOutlined } from '@ant-design/icons';
import { useAuth } from '../../../../contexts/AuthContext';
import ResourceActionsDropdown from '../../../../components/ResourceActionsDropdown';
import { WizardModal, WizardLayout } from '../../../../components/WizardShell';
import {
  fetchAllowedNamespaces,
  fetchAlertmanagerconfigs,
  fetchAlertmanagerconfigDetail,
  createAlertmanagerconfig,
  updateAlertmanagerconfig,
  deleteAlertmanagerconfig,
  fetchPrometheusRuleVmCustomRules,
} from '../../../../services/monitoringApi';
import { fetchHarvesterNamespaces } from '../../../../services/harvesterApi';
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

export interface AlertmanagerConfigItem {
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

type FormInstanceType = ReturnType<typeof Form.useForm>[0];

function TriggerConditionSelect({ form, options, loading }: { form: FormInstanceType; options: TriggerRuleOption[]; loading?: boolean }) {
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
          <Button type="link" size="small" onClick={() => setSelectedKeys([])} style={{ padding: 0, fontSize: 12 }}>清空</Button>
        )}
      </div>
      <Table
        size="small"
        rowKey="value"
        dataSource={options}
        loading={loading}
        pagination={false}
        rowSelection={{ selectedRowKeys: selectedKeys, onChange: (keys) => setSelectedKeys(keys as string[]) }}
        columns={[{ title: '条件名称', dataIndex: 'label', key: 'label', render: (t: string) => t || '-' }]}
      />
    </div>
  );
}

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
                <Button type="link" danger size="small" onClick={() => remove(name)}>删除</Button>
              </div>
            ))}
            <Button type="dashed" onClick={() => add({ key: '', value: '' })} icon={<PlusOutlined />}>添加匹配器</Button>
          </>
        )}
      </Form.List>
    </div>
  );
}

function AlertConfigPreview({
  form,
  isAdmin,
  triggerOptions = [],
}: { form: FormInstanceType; isAdmin: boolean; triggerOptions?: TriggerRuleOption[] }) {
  const name = Form.useWatch('name', form) ?? '';
  const namespace = Form.useWatch('namespace', form) ?? '';
  const description = Form.useWatch('description', form) ?? '';
  const receiverType: ReceiverUIType = Form.useWatch('receiverType', form) ?? 'email-receiver';
  const dingtalkList = Form.useWatch('dingtalkList', form) ?? [];
  const emailList = Form.useWatch('emailList', form) ?? [];
  const matchers = (Form.useWatch('matchers', form) ?? []) as string[];
  const matcherPairs = (Form.useWatch('matcherPairs', form) ?? []) as Array<{ key?: string; value?: string }>;
  const dingtalkCount = Array.isArray(dingtalkList) ? dingtalkList.filter((i: any) => (i?.webhookUrl ?? '').toString().trim()).length : 0;
  const emailCount = Array.isArray(emailList) ? emailList.filter((i: any) => (i?.emailTo ?? '').toString().trim()).length : 0;
  const receiverDetail =
    receiverType === 'email-receiver' ? (emailCount ? `邮箱 ${emailCount} 条` : '-')
      : receiverType === 'dingtalk-receiver' ? (dingtalkCount ? `钉钉 ${dingtalkCount} 条` : '-') : '-';
  const matcherLabels = isAdmin
    ? matcherPairs.filter((p) => (p?.key ?? '').trim()).map((p) => `${p?.key ?? ''}=${p?.value ?? ''}`)
    : (matchers.filter(Boolean) as string[]).map((v) => triggerOptions.find((o) => o.value === v)?.label ?? v);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div><span style={{ color: 'rgba(0,0,0,0.45)', marginRight: 8 }}>名称</span><span>{name || '-'}</span></div>
      <div><span style={{ color: 'rgba(0,0,0,0.45)', marginRight: 8 }}>命名空间</span><span>{namespace || '-'}</span></div>
      <div><span style={{ color: 'rgba(0,0,0,0.45)', marginRight: 8 }}>描述</span><span>{(description || '').trim() || '-'}</span></div>
      <div><span style={{ color: 'rgba(0,0,0,0.45)', marginRight: 8 }}>接收类型</span><span>{RECEIVER_TYPE_OPTIONS.find((o: any) => o.value === receiverType)?.label ?? receiverType}</span></div>
      <div><span style={{ color: 'rgba(0,0,0,0.45)', marginRight: 8 }}>配置摘要</span><span>{receiverDetail}</span></div>
      <div><span style={{ color: 'rgba(0,0,0,0.45)', marginRight: 8 }}>已选条件</span><span>{matcherLabels.length ? matcherLabels.join('、') : '-'}</span></div>
    </div>
  );
}

interface AlertForwardConfigProps {
  cloudId: string;
}

const AlertForwardConfig: React.FC<AlertForwardConfigProps> = ({ cloudId }) => {
  const { user } = useAuth();
  const isAdmin = user?.role === 'super_admin' || user?.role === 'leased_lines_admin';

  const [configModalOpen, setConfigModalOpen] = useState(false);
  const [configList, setConfigList] = useState<AlertmanagerConfigItem[]>([]);
  const [configLoading, setConfigLoading] = useState(false);
  const [namespaceList, setNamespaceList] = useState<string[]>([]);
  const [namespaceLoading, setNamespaceLoading] = useState(false);
  const [tenantNamespaces, setTenantNamespaces] = useState<string[]>([]);
  const [keyword, setKeyword] = useState('');
  const [configNsFilter, setConfigNsFilter] = useState<string | undefined>();

  const [formModalOpen, setFormModalOpen] = useState(false);
  const [formStep, setFormStep] = useState(0);
  const [editingRecord, setEditingRecord] = useState<AlertmanagerConfigItem | null>(null);
  const [formLoading, setFormLoading] = useState(false);
  const [form] = Form.useForm();
  const [vmTriggerOptions, setVmTriggerOptions] = useState<TriggerRuleOption[]>([]);
  const [vmTriggerLoading, setVmTriggerLoading] = useState(false);

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
    if (configModalOpen && cloudId) {
      loadConfigList();
      if (isAdmin) loadNamespaces();
    }
  }, [configModalOpen, cloudId, isAdmin, loadConfigList, loadNamespaces]);

  useEffect(() => {
    if (cloudId && !isAdmin) loadTenantNamespaces();
  }, [cloudId, isAdmin, loadTenantNamespaces]);

  useEffect(() => {
    if (formModalOpen && cloudId && !isAdmin) loadVmTriggerOptions();
  }, [formModalOpen, cloudId, isAdmin, loadVmTriggerOptions]);

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
              let receiverType: ReceiverUIType = 'email-receiver';
              let dingtalkList = [{ webhookUrl: '', dingtalkSigningSecret: '' }];
              let emailList = [{ emailTo: '', emailFrom: '', smarthost: '', requireTls: true, authUsername: '', authIdentity: '', authSecretKey: '' }];
              if (r0) {
                if (r0.emailConfigs?.length) {
                  receiverType = 'email-receiver';
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
                    receiverType = 'dingtalk-receiver';
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
          receiverType: 'email-receiver',
          repeatInterval: '4h',
          dingtalkList: [{ webhookUrl: '', dingtalkSigningSecret: '' }],
          emailList: [{ emailTo: '', emailFrom: '', smarthost: '', requireTls: true, authUsername: '', authIdentity: '', authSecretKey: '' }],
          matchers: [],
          matcherPairs: [],
        });
      }
      setFormModalOpen(true);
    },
    [cloudId, isAdmin, tenantNamespaces, form]
  );

  const handleCloseForm = useCallback(() => {
    setFormModalOpen(false);
    setFormStep(0);
    setEditingRecord(null);
    form.resetFields();
  }, [form]);

  const handleFormSubmit = useCallback(async () => {
    if (!cloudId) return;
    try {
      const values = await form.validateFields();
      const namespace = values.namespace;
      const name = values.name;
      const description = values.description || '';
      const repeatInterval = values.repeatInterval || '4h';
      const receiverType = values.receiverType;
      const matchers = (values.matchers || []) as string[];
      const matcherPairs = (values.matcherPairs || []) as Array<{ key: string; value: string }>;
      
      const receiverName = `recv-${Date.now()}`;
      const receivers = [buildReceiverSpec(receiverName, receiverType, values)];
      const annotations: Record<string, string> = {
        description,
        receiverType,
      };
      if (receiverType === 'dingtalk-receiver') {
        mergeDingtalkSecretsIntoAnnotations(annotations, receiverName, values.dingtalkList);
      } else {
        removeDingtalkSecretsFromAnnotations(annotations, receiverName);
      }
      setReceiverTypeAnnotation(annotations, receiverName, receiverType);

      // Route
      // Admin: use matchers (matcherPairs)
      // Tenant: use match_re (matchers)
      const route: any = {
        receiver: receiverName,
        repeatInterval,
        groupWait: '30s',
        groupInterval: '5m',
      };
      
      if (isAdmin) {
        if (matcherPairs.length > 0) {
          route.matchers = matcherPairs.map((p) => ({ name: p.key, matchType: '=', value: p.value }));
        } else {
          // No matchers? Match everything?
        }
      } else {
        if (matchers.length > 0) {
          const joined = matchers.join('|');
          route.matchers = [{ name: 'alertname', matchType: '=~', value: joined }];
          annotations.matchers = matchers.join(',');
        }
      }

      const payload = {
        apiVersion: 'monitoring.coreos.com/v1alpha1',
        kind: 'AlertmanagerConfig',
        metadata: {
          name,
          namespace,
          annotations,
        },
        spec: {
          route,
          receivers,
        },
      };

      setFormLoading(true);
      if (editingRecord) {
        // update
        const { ok, error } = await updateAlertmanagerconfig(cloudId, namespace, name, payload);
        setFormLoading(false);
        if (ok) {
          message.success('更新成功');
          handleCloseForm();
          loadConfigList();
        } else message.error(error || '更新失败');
      } else {
        // create
        const { ok, error } = await createAlertmanagerconfig(cloudId, payload);
        setFormLoading(false);
        if (ok) {
          message.success('创建成功');
          handleCloseForm();
          loadConfigList();
        } else message.error(error || '创建失败');
      }
    } catch (e: any) {
      console.error(e);
      // form validation error
    }
  }, [cloudId, form, editingRecord, isAdmin, loadConfigList, handleCloseForm]);

  const handleDeleteConfig = useCallback(async (record: AlertmanagerConfigItem) => {
    if (!cloudId || !record.metadata?.namespace || !record.metadata?.name) return;
    Modal.confirm({
      title: '确认删除',
      content: `确定要删除配置 ${record.metadata.name} 吗？`,
      okType: 'danger',
      onOk: async () => {
        const { ok, error } = await deleteAlertmanagerconfig(cloudId, record.metadata?.namespace!, record.metadata?.name!);
        if (ok) {
          message.success('删除成功');
          loadConfigList();
        } else {
          message.error(error || '删除失败');
        }
      },
    });
  }, [cloudId, loadConfigList]);

  const configColumns: ColumnsType<AlertmanagerConfigItem> = useMemo(() => [
    { title: '名称', dataIndex: ['metadata', 'name'], key: 'name', width: 180, ellipsis: true },
    { title: '命名空间', dataIndex: ['metadata', 'namespace'], key: 'namespace', width: 120 },
    {
      title: '接收器',
      key: 'receivers',
      render: (row: AlertmanagerConfigItem) => {
        // fix: TS18048 - split access
        const receivers = row.spec?.receivers;
        if (Array.isArray(receivers)) {
          return receivers.map((r: any) => r.name).join(', ');
        }
        return '-';
      },
    },
    {
      title: '操作',
      key: 'actions',
      width: 80,
      render: (row: AlertmanagerConfigItem) => (
        <ResourceActionsDropdown
          items={[
            { key: 'edit', label: '编辑', onClick: () => handleOpenForm(row) },
            { key: 'delete', label: '删除', danger: true, onClick: () => handleDeleteConfig(row) },
          ]}
        />
      ),
    },
  ], [handleOpenForm, handleDeleteConfig]);

  return (
    <>
      <Button icon={<SettingOutlined />} onClick={() => setConfigModalOpen(true)}>
        告警外发配置
      </Button>

      {/* 列表弹框 */}
      <Modal
        title="告警外发配置"
        open={configModalOpen}
        onCancel={() => setConfigModalOpen(false)}
        width={900}
        footer={null}
        destroyOnClose
      >
        <div style={{ marginBottom: 16, display: 'flex', justifyContent: 'space-between' }}>
          <Space>
            <Input.Search
              placeholder="搜索名称或命名空间"
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              style={{ width: 200 }}
            />
            <Select
              placeholder="命名空间"
              allowClear
              value={configNsFilter}
              onChange={setConfigNsFilter}
              style={{ width: 150 }}
              options={formNamespaceOptions}
            />
          </Space>
          <Space>
            <Button icon={<ReloadOutlined />} onClick={loadConfigList} loading={configLoading} />
            <Button type="primary" icon={<PlusOutlined />} onClick={() => handleOpenForm(null)}>新增配置</Button>
          </Space>
        </div>
        <Table
          size="small"
          rowKey={(r) => `${r.metadata?.namespace}/${r.metadata?.name}`}
          columns={configColumns}
          dataSource={filteredConfigList}
          loading={configLoading}
          pagination={{ pageSize: 5, showSizeChanger: true }}
        />
      </Modal>

      {/* 新增/编辑 Wizard */}
      <WizardModal
        title={editingRecord ? '编辑告警配置' : '新增告警配置'}
        open={formModalOpen}
        onCancel={handleCloseForm}
        width={720}
        footer={(
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, padding: '12px 24px' }}>
            <Button onClick={handleCloseForm}>取消</Button>
            {formStep > 0 && <Button onClick={() => setFormStep((s) => s - 1)}>上一步</Button>}
            {formStep < 2 && (
              <Button
                type="primary"
                onClick={async () => {
                  try {
                    if (formStep === 0) await form.validateFields(['name', 'namespace', 'description', 'repeatInterval']);
                    else if (formStep === 1) await form.validateFields(['receiverType', 'dingtalkList', 'emailList']);
                    setFormStep((s) => s + 1);
                  } catch {
                    // ignore
                  }
                }}
              >
                下一步
              </Button>
            )}
            {formStep === 2 && (
              <Button type="primary" loading={formLoading} onClick={handleFormSubmit}>
                确定
              </Button>
            )}
          </div>
        )}
      >
        <Form form={form} layout="vertical">
          <WizardLayout
            current={formStep}
            steps={[{ title: '基础信息' }, { title: '接收器配置' }, { title: '触发条件' }]}
          >
            <div style={{ padding: '0 24px' }}>
              <div style={{ display: formStep === 0 ? 'block' : 'none' }}>
                <div style={{ maxWidth: 600, margin: '0 auto' }}>
                  <Row gutter={16}>
                    <Col span={12}>
                      <Form.Item
                        name="name"
                        label="名称"
                        rules={[
                          { required: true, message: '请输入名称' },
                          { pattern: /^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/, message: '仅支持小写字母、数字和中划线' },
                        ]}
                      >
                        <Input placeholder="例如: email-alerts" disabled={!!editingRecord} />
                      </Form.Item>
                    </Col>
                    <Col span={12}>
                      <Form.Item name="namespace" label="命名空间" rules={[{ required: true, message: '请选择命名空间' }]}>
                        <Select placeholder="选择命名空间" options={formNamespaceOptions} disabled={!!editingRecord} showSearch />
                      </Form.Item>
                    </Col>
                  </Row>
                  <Form.Item name="description" label="描述">
                    <Input.TextArea placeholder="可选描述" rows={2} />
                  </Form.Item>
                  <Form.Item name="repeatInterval" label="重复发送间隔" extra="若告警未恢复，每隔多久发送一次通知">
                    <Select
                      options={[
                        { label: '1小时', value: '1h' },
                        { label: '4小时', value: '4h' },
                        { label: '12小时', value: '12h' },
                        { label: '24小时', value: '24h' },
                      ]}
                    />
                  </Form.Item>
                </div>
              </div>

              <div style={{ display: formStep === 1 ? 'block' : 'none' }}>
                <div style={{ maxWidth: 640, margin: '0 auto' }}>
                  <Form.Item name="receiverType" label="接收类型" rules={[{ required: true }]}>
                    <Radio.Group options={RECEIVER_TYPE_OPTIONS} optionType="button" buttonStyle="solid" />
                  </Form.Item>
                  <Form.Item shouldUpdate={(prev, curr) => prev.receiverType !== curr.receiverType} noStyle>
                    {({ getFieldValue }) => {
                      const type = getFieldValue('receiverType') as ReceiverUIType;
                      if (type === 'dingtalk-receiver') {
                        return (
                          <Form.List name="dingtalkList">
                            {(fields, { add, remove }) => (
                              <>
                                {fields.map(({ key, name, ...rest }) => (
                                  <div key={key} style={{ border: '1px solid #eee', padding: 12, marginBottom: 12, borderRadius: 4 }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                                      <Typography.Text strong>钉钉机器人 #{name + 1}</Typography.Text>
                                      {fields.length > 1 && (
                                        <Button type="link" danger size="small" onClick={() => remove(name)} icon={<DeleteOutlined />} />
                                      )}
                                    </div>
                                    <Form.Item
                                      {...rest}
                                      name={[name, 'webhookUrl']}
                                      label="Webhook 地址"
                                      rules={[{ required: true, message: '必填' }]}
                                    >
                                      <Input placeholder="https://oapi.dingtalk.com/robot/send?access_token=..." />
                                    </Form.Item>
                                    <Form.Item
                                      {...rest}
                                      name={[name, 'dingtalkSigningSecret']}
                                      label="加签密钥 (SEC...)"
                                      rules={[{ required: true, message: '必填' }]}
                                    >
                                      <Input.Password placeholder="SEC..." />
                                    </Form.Item>
                                  </div>
                                ))}
                                <Button
                                  type="dashed"
                                  onClick={() => add({ webhookUrl: '', dingtalkSigningSecret: '' })}
                                  icon={<PlusOutlined />}
                                  block
                                >
                                  添加机器人
                                </Button>
                              </>
                            )}
                          </Form.List>
                        );
                      }
                      if (type === 'email-receiver') {
                        return (
                          <Form.List name="emailList">
                            {(fields, { add, remove }) => (
                              <>
                                {fields.map(({ key, name, ...rest }) => (
                                  <div key={key} style={{ border: '1px solid #eee', padding: 12, marginBottom: 12, borderRadius: 4 }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                                      <Typography.Text strong>邮箱配置 #{name + 1}</Typography.Text>
                                      {fields.length > 1 && (
                                        <Button type="link" danger size="small" onClick={() => remove(name)} icon={<DeleteOutlined />} />
                                      )}
                                    </div>
                                    <Row gutter={12}>
                                      <Col span={12}>
                                        <Form.Item
                                          {...rest}
                                          name={[name, 'emailTo']}
                                          label="收件人邮箱"
                                          rules={[{ required: true }]}
                                        >
                                          <Input placeholder="user@example.com" />
                                        </Form.Item>
                                      </Col>
                                      <Col span={12}>
                                        <Form.Item
                                          {...rest}
                                          name={[name, 'emailFrom']}
                                          label="发件人邮箱"
                                          rules={[{ required: true }]}
                                        >
                                          <Input placeholder="alert@example.com" />
                                        </Form.Item>
                                      </Col>
                                    </Row>
                                    <Row gutter={12}>
                                      <Col span={16}>
                                        <Form.Item
                                          {...rest}
                                          name={[name, 'smarthost']}
                                          label="SMTP 服务器 (Host:Port)"
                                          rules={[{ required: true }]}
                                        >
                                          <Input placeholder="smtp.example.com:587" />
                                        </Form.Item>
                                      </Col>
                                      <Col span={8}>
                                        <Form.Item {...rest} name={[name, 'requireTls']} label="启用 TLS" valuePropName="checked">
                                          <Switch />
                                        </Form.Item>
                                      </Col>
                                    </Row>
                                    <Row gutter={12}>
                                      <Col span={8}>
                                        <Form.Item {...rest} name={[name, 'authUsername']} label="SMTP 用户名">
                                          <Input />
                                        </Form.Item>
                                      </Col>
                                      <Col span={8}>
                                        <Form.Item {...rest} name={[name, 'authIdentity']} label="Auth Identity">
                                          <Input placeholder="可选" />
                                        </Form.Item>
                                      </Col>
                                      <Col span={8}>
                                        <Form.Item {...rest} name={[name, 'authSecretKey']} label="SMTP 密码">
                                          <Input.Password />
                                        </Form.Item>
                                      </Col>
                                    </Row>
                                  </div>
                                ))}
                                <Button
                                  type="dashed"
                                  onClick={() => add({ emailTo: '', emailFrom: '', smarthost: '', requireTls: true })}
                                  icon={<PlusOutlined />}
                                  block
                                >
                                  添加邮箱配置
                                </Button>
                              </>
                            )}
                          </Form.List>
                        );
                      }
                      return <Empty description="暂不支持该类型" />;
                    }}
                  </Form.Item>
                </div>
              </div>

              <div style={{ display: formStep === 2 ? 'block' : 'none' }}>
                <div style={{ maxWidth: 640, margin: '0 auto' }}>
                  {isAdmin ? (
                    <AdminMatcherPairs form={form} />
                  ) : (
                    <TriggerConditionSelect form={form} options={vmTriggerOptions} loading={vmTriggerLoading} />
                  )}
                  <div style={{ marginTop: 24, borderTop: '1px solid #f0f0f0', paddingTop: 16 }}>
                    <Typography.Text strong>配置预览</Typography.Text>
                    <div style={{ background: '#fafafa', padding: 12, borderRadius: 4, marginTop: 8, fontSize: 13 }}>
                      <AlertConfigPreview form={form} isAdmin={isAdmin} triggerOptions={vmTriggerOptions} />
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </WizardLayout>
        </Form>
      </WizardModal>
    </>
  );
};

export default AlertForwardConfig;
