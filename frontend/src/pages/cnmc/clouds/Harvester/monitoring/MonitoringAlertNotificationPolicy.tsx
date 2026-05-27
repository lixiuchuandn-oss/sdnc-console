/**
 * 告警通知策略：配置列表 + 新增/编辑步骤弹框（由 AlertForwardConfig 迁入）
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
  DeleteOutlined,
  EditOutlined,
  PlusOutlined,
  ReloadOutlined,
  SearchOutlined,
  UploadOutlined,
} from '@ant-design/icons';
import PageDetailSection from '../../../../../components/PageDetailSection';
import TableColumnSettingsButton from '../../../../../components/TableColumnSettingsButton';
import { useTableColumnSettings } from '../../../../../hooks/useTableColumnSettings';
import {
  ALERTMANAGERCONFIG_KIND,
  MONITORING_API_VERSION,
  MONITORING_DEFAULT_NAMESPACE,
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
} from '../../../../../services/monitoringApi';
import type {
  NotificationTargetReceiver,
  PrometheusRuleItem,
} from '../../../../../services/monitoringApi';
import {
  buildReceiverSpec,
  RECEIVER_NAME_OPTIONS,
  type ReceiverName,
  type ReceiverSpec,
} from './lib/receivers';
import { useAuth } from '../../../../../contexts/AuthContext';
import { hasPermissionForAction } from '../../../../../utils/accessMapping';

const ALERT_POLICY_ALIAS_ANNOTATION = 'tower.io/alias';

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
  metadata?: { name?: string; namespace?: string; creationTimestamp?: string; creator?: string; annotations?: Record<string, string> };
  spec?: { receivers?: Array<{ name?: string }>; route?: Record<string, unknown> };
}

const SYSTEM_DEFAULT_ALERTMANAGER_CONFIG_NAME = 'default-alertmanager-config';

function isSystemDefaultAlertPolicy(row: AlertmanagerConfigItem): boolean {
  const namespace = (row.metadata?.namespace ?? '').toString().trim();
  if (namespace !== MONITORING_DEFAULT_NAMESPACE) return false;
  const specAny = (row.spec ?? {}) as any;
  const alertmanagerSpecName = (
    specAny?.alertmanager?.spec?.name ??
    specAny?.alertmanager?.name ??
    specAny?.name
  )
    ?.toString()
    .trim();
  if (alertmanagerSpecName === SYSTEM_DEFAULT_ALERTMANAGER_CONFIG_NAME) return true;
  const targetAnnotation = (row.metadata?.annotations?.['tower.io/alertmanager-target'] ?? '')
    .toString()
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return targetAnnotation.includes(SYSTEM_DEFAULT_ALERTMANAGER_CONFIG_NAME);
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

  const [configList, setConfigList] = useState<AlertmanagerConfigItem[]>([]);
  const [configLoading, setConfigLoading] = useState(false);
  const [receiversList, setReceiversList] = useState<NotificationTargetReceiver[]>([]);
  const [receiversLoading, setReceiversLoading] = useState(false);
  const [keyword, setKeyword] = useState('');

  const [formModalOpen, setFormModalOpen] = useState(false);
  const [editingRecord, setEditingRecord] = useState<AlertmanagerConfigItem | null>(null);
  const [formLoading, setFormLoading] = useState(false);
  const [form] = Form.useForm();
  const [vmTriggerOptions, setVmTriggerOptions] = useState<TriggerRuleOption[]>([]);
  const [vmTriggerLoading, setVmTriggerLoading] = useState(false);
  const [rulesList, setRulesList] = useState<PrometheusRuleItem[]>([]);
  const [rulesGroupMap, setRulesGroupMap] = useState<Record<string, string>>({});
  const [rulesLoading, setRulesLoading] = useState(false);

  const [detailModalOpen, setDetailModalOpen] = useState(false);
  const [detailData, setDetailData] = useState<{
    name?: string;
    alias?: string;
    namespace?: string;
    description?: string;
    creator?: string;
    creationTimestamp?: string;
    receiverNames?: string[];
    matchers?: string[];
    repeatInterval?: string;
  } | null>(null);
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
    setConfigList(normalizeListPayload(data));
  }, [cloudId, canReadPolicies]);

  /** 通知对象标识下拉数据：来自数据库（GET .../alertmanagerconfigs/receivers，不调用 Harvester），按 receiverName 聚合；可指定 namespaces 覆盖（用于表单内按选中项目名称加载） */
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

  /** 项目名称就绪后拉取通知对象列表（供「通知对象标识」下拉使用） */
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
          (row.metadata?.name ?? '').toLowerCase().includes(k) ||
          (row.metadata?.namespace ?? '').toLowerCase().includes(k)
      );
    }
    if (configNsFilter) list = list.filter((row) => row.metadata?.namespace === configNsFilter);
    if (!isAdmin && namespaceList.length) {
      list = list.filter((row) => namespaceList.includes(row.metadata?.namespace ?? ''));
    }
    return [...list].sort((a, b) => {
      const aTs = new Date((a.metadata?.creationTimestamp ?? '').toString()).getTime();
      const bTs = new Date((b.metadata?.creationTimestamp ?? '').toString()).getTime();
      const aSafe = Number.isFinite(aTs) ? aTs : 0;
      const bSafe = Number.isFinite(bTs) ? bTs : 0;
      return bSafe - aSafe;
    });
  }, [configList, keyword, configNsFilter, isAdmin, namespaceList]);

  /**
   * spec 接收器名称 -> 通知方式（用于编辑回填时拼 type:name，以及提交时按类型取 spec）。
   *
   * 通知方式优先取后端落到 `receiverType` 字段（来源于 AlertmanagerConfig 注解
   * `tower.io/monitoring-receiver`）；注解缺失时回退 metadata.name（receiverName）以兼容历史数据。
   */
  const nameToType = useMemo(() => {
    const map: Record<string, ReceiverName> = {};
    for (const r of receiversList) {
      const type = (
        (r as { receiverType?: string }).receiverType ??
        r.receiverName ??
        ''
      )
        .toString()
        .trim() as ReceiverName;
      if (!type) continue;
      const list = Array.isArray(r.specReceivers) ? r.specReceivers : [];
      for (const s of list) {
        const name = (s?.name ?? '').toString().trim();
        if (name && !map[name]) map[name] = type;
      }
    }
    return map;
  }, [receiversList]);
  const receiverTypeLabelMap: Record<ReceiverName, string> = useMemo(
    () => ({
      'email-receiver': '邮件',
      'dingtalk-receiver': '钉钉',
      'website-receiver': '站内信',
    }),
    []
  );

  const handleOpenForm = useCallback(
    (record: AlertmanagerConfigItem | null) => {
      if (!canWritePolicies) {
        message.warning('无权修改告警通知策略');
        return;
      }
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
              const routeReceiverNames = (collectReceiverNamesFromRoute(d.spec?.route, receivers) ?? []).filter((n: string) => n !== 'null-receiver');
              const routeReceiver = routeReceiverNames[0] ?? (d.spec?.route?.receiver !== 'null-receiver' ? d.spec?.route?.receiver : undefined) ?? receivers.find((r: any) => (r?.name ?? '') !== 'null-receiver')?.name;
              const r0 = routeReceiver ? receivers.find((r: any) => r.name === routeReceiver) : receivers.find((r: any) => (r?.name ?? '') !== 'null-receiver');
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
              let routeMatchersArray = Array.isArray(route.matchers) ? route.matchers : [];
              const childRoutes = Array.isArray(route.routes) ? route.routes : [];
              if (routeMatchersArray.length === 0 && childRoutes.length > 0) {
                const firstChild = childRoutes[0];
                routeMatchersArray = Array.isArray(firstChild?.matchers) ? firstChild.matchers : [];
              }
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
              const routeRepeatInterval = (childRoutes[0] as any)?.repeatInterval ?? (d.spec?.route as any)?.repeatInterval ?? '4h';
              const configReceiverNameTypeName = routeReceiverNames.length
                ? routeReceiverNames.map((n: string) => `${nameToType[n] ?? 'email-receiver'}:${n}`)
                : routeReceiver ? [`${nameToType[routeReceiver] ?? 'email-receiver'}:${routeReceiver}`] : [];
              form.setFieldsValue({
                name: d.metadata?.name,
                alias: (annotations[ALERT_POLICY_ALIAS_ANNOTATION] ?? '').toString(),
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
        const defaultNs = isAdmin ? undefined : (namespaceList[0] ?? 'default');
        form.setFieldsValue({
          namespace: defaultNs,
          alias: '',
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
    [form, isAdmin, namespaceList, cloudId, nameToType, canWritePolicies]
  );

  const handleCloseForm = useCallback(() => {
    setFormModalOpen(false);
    setEditingRecord(null);
    form.resetFields();
  }, [form]);

  /** 打开详情：从接口拉取策略详情并展示只读 Modal */
  const handleOpenDetail = useCallback(
    (row: AlertmanagerConfigItem) => {
      const ns = row.metadata?.namespace ?? '';
      const name = row.metadata?.name ?? '';
      if (!cloudId || !ns || !name) {
        message.error('缺少项目名称/策略名称/策略标识');
        return;
      }
      setDetailData(null);
      setDetailModalOpen(true);
      setDetailLoading(true);
      fetchAlertmanagerconfigDetail(cloudId, ns, name)
        .then(async ({ data, ok, error }) => {
          setDetailLoading(false);
          if (!ok || !data) {
            message.error(error || '获取策略详情失败');
            setDetailData(null);
            return;
          }
          const raw = data as any;
          const d = raw?.data != null && typeof raw.data === 'object' ? raw.data : raw;
          const annotations = d.metadata?.annotations ?? {};
          const receivers = Array.isArray(d.spec?.receivers) ? d.spec.receivers : [];
          const route = d.spec?.route ?? {};
          const rawRouteReceiverNames = collectReceiverNamesFromRoute(route, receivers);
          const routeReceiverNames = (rawRouteReceiverNames ?? []).filter((n: string) => n !== 'null-receiver');
          const match = (route.match ?? {}) as Record<string, string>;
          const matchRe = (route.matchRe ?? {}) as Record<string, string>;
          let routeMatchersArray = Array.isArray(route.matchers) ? route.matchers : [];
          const detailChildRoutes = Array.isArray(route.routes) ? route.routes : [];
          if (routeMatchersArray.length === 0 && detailChildRoutes.length > 0) {
            const firstChild = detailChildRoutes[0];
            routeMatchersArray = Array.isArray(firstChild?.matchers) ? firstChild.matchers : [];
          }
          const alertnameMatchers = routeMatchersArray.filter((m: any) => String(m?.name ?? '').toLowerCase() === 'alertname');
          let matchersFromRouteMatchers: string[] = [];
          if (alertnameMatchers.length > 0) {
            const first = alertnameMatchers[0];
            const matchType = String(first?.matchType ?? '').trim();
            const value = String(first?.value ?? '').trim();
            if (matchType === '=~' && value) matchersFromRouteMatchers = value.split('|').map((s: string) => s.trim()).filter(Boolean);
            else matchersFromRouteMatchers = alertnameMatchers.map((m: any) => String(m?.value ?? '').trim()).filter(Boolean);
          }
          const alertnameRe = (matchRe.alertname ?? '').toString().trim();
          const matchersFromRe = alertnameRe ? parseAlertnameReToMatchers(alertnameRe) : [];
          const alertnameExact = (match.alertname ?? '').toString().trim();
          const matchersFromMatch = alertnameExact ? [alertnameExact] : [];
          const fallbackMatchers = typeof annotations.matchers === 'string' ? annotations.matchers.split(',').map((s: string) => s.trim()).filter(Boolean) : [];
          const resolvedMatchers: string[] =
            matchersFromRouteMatchers.length ? matchersFromRouteMatchers
              : matchersFromRe.length ? matchersFromRe
              : matchersFromMatch.length ? matchersFromMatch
              : fallbackMatchers;
          const matcherNameMap = new Map<string, string>();
          for (const r of rulesList) {
            const ruleId = (r?.name ?? '').toString().trim();
            const ruleName = (r?.aliasName ?? '').toString().trim() || ruleId;
            if (ruleId) matcherNameMap.set(ruleId, ruleName);
          }
          for (const o of vmTriggerOptions) {
            const ruleId = (o?.value ?? '').toString().trim();
            const ruleName = (o?.label ?? '').toString().trim() || ruleId;
            if (ruleId && !matcherNameMap.has(ruleId)) matcherNameMap.set(ruleId, ruleName);
          }
          const missingMatcherIds = resolvedMatchers.filter((id: string) => !matcherNameMap.has(id));
          if (missingMatcherIds.length > 0) {
            const { data: matchedRules, ok: matchedOk } = await fetchPrometheusRules(cloudId, {
              alertNames: missingMatcherIds,
            });
            if (matchedOk && matchedRules?.rules?.length) {
              for (const r of matchedRules.rules) {
                const ruleId = (r?.name ?? '').toString().trim();
                const ruleName = (r?.aliasName ?? '').toString().trim() || ruleId;
                if (ruleId) matcherNameMap.set(ruleId, ruleName);
              }
            }
          }
          const matcherDisplayNames = resolvedMatchers.map((id: string) => matcherNameMap.get(id) || id);
          setDetailData({
            name: d.metadata?.name ?? name,
            alias: (annotations[ALERT_POLICY_ALIAS_ANNOTATION] ?? '').toString().trim() || undefined,
            namespace: d.metadata?.namespace ?? ns,
            description: (annotations.description ?? '').toString().trim() || undefined,
            creator: d.metadata?.creator ?? undefined,
            creationTimestamp: d.metadata?.creationTimestamp ?? undefined,
            receiverNames: routeReceiverNames.length ? routeReceiverNames : (route.receiver && route.receiver !== 'null-receiver' ? [route.receiver] : receivers.map((r: any) => r.name).filter((n: string) => n !== 'null-receiver')),
            matchers: matcherDisplayNames.length ? matcherDisplayNames : undefined,
            repeatInterval: (detailChildRoutes[0] as any)?.repeatInterval ?? (route as any)?.repeatInterval ?? '4h',
          });
        })
        .catch(() => {
          setDetailLoading(false);
          message.error('获取策略详情失败');
          setDetailData(null);
        });
    },
    [cloudId, rulesList, vmTriggerOptions]
  );

  const handleCloseDetail = useCallback(() => {
    setDetailModalOpen(false);
    setDetailData(null);
  }, []);

  /**
   * 按通知方式（receiverType）聚合该类型下所有 spec 接收器名称，供级联/多选下拉使用。
   * 通知方式从 annotation 落到的 `receiverType` 字段读取，缺失回退 metadata.name（receiverName）。
   */
  const specReceiverNameOptionsByType = useMemo(() => {
    const types: ReceiverName[] = ['email-receiver', 'dingtalk-receiver', 'website-receiver'];
    const map: Record<ReceiverName, { label: string; value: string }[]> = {} as Record<ReceiverName, { label: string; value: string }[]>;
    for (const t of types) {
      const names = new Set<string>();
      for (const r of receiversList) {
        const rt = (
          (r as { receiverType?: string }).receiverType ??
          r.receiverName ??
          ''
        )
          .toString()
          .trim();
        if (rt !== t) continue;
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

  /**
   * 按通知方式（receiverType）映射 spec 接收器名称 -> 完整 ReceiverSpec，
   * 用于多选提交时按类型取 spec；通知方式以 annotation `receiverType` 为准。
   */
  const specReceiverNameToSpecByType = useMemo(() => {
    const map: Record<ReceiverName, Record<string, ReceiverSpec>> = {} as Record<ReceiverName, Record<string, ReceiverSpec>>;
    const types: ReceiverName[] = ['email-receiver', 'dingtalk-receiver', 'website-receiver'];
    for (const t of types) {
      const byName: Record<string, ReceiverSpec> = {};
      for (const r of receiversList) {
        const rt = (
          (r as { receiverType?: string }).receiverType ??
          r.receiverName ??
          ''
        )
          .toString()
          .trim();
        if (rt !== t) continue;
        const list = Array.isArray(r.specReceivers) ? r.specReceivers : [];
        for (const s of list) {
          const name = (s?.name ?? '').toString().trim();
          const hasConfig = 'emailConfigs' in s ? !!s.emailConfigs : 'webhookConfigs' in s && !!s.webhookConfigs;
          if (name && hasConfig) byName[name] = { ...s, name } as ReceiverSpec;
        }
      }
      map[t] = byName;
    }
    return map;
  }, [receiversList]);

  /** 级联选择：第一级 邮件/钉钉/网站，第二级 该类型下的通知对象标识；叶子 value 为 type:name */
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
      'website-receiver': '站内信',
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

  /** 表单内项目名称：未选择时无法按项目名称加载通知对象，需提示用户 */
  const watchedFormNamespace = Form.useWatch('namespace', form);
  const formNamespaceEmpty = !(watchedFormNamespace != null && String(watchedFormNamespace).trim());

  /** 表单打开且用户选择了项目名称时，按该项目名称重新加载通知对象列表（确保「通知方式」下拉能获取 specReceiverName） */
  useEffect(() => {
    if (!formModalOpen || !cloudId) return;
    const ns = (watchedFormNamespace ?? '').toString().trim();
    if (ns) loadReceiversList([ns]);
  }, [formModalOpen, cloudId, watchedFormNamespace, loadReceiversList]);

  const handleFormSubmit = useCallback(async () => {
    if (!canWritePolicies) {
      message.warning('无权修改告警通知策略');
      return;
    }
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
    const matchersRaw = Array.isArray(form.getFieldValue('matchers')) ? form.getFieldValue('matchers') : [];
    const matchersFiltered = (matchersRaw as string[]).filter(Boolean);
    if (matchersFiltered.length === 0) {
      message.warning('已选告警规则不能为空');
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
    if (parsed.some((p) => p.type === 'email-receiver')) {
      const emailValues = await form.validateFields(['emailList']).catch(() => null);
      if (emailValues) values = { ...values, ...emailValues };
    }
    const name = (values.name ?? '').toString().trim();
    const aliasInput = (form.getFieldValue('alias') ?? '').toString().trim();
    const namespace = (values.namespace ?? 'default').toString().trim();
    const description = form.getFieldValue('description');
    const matchers = (Array.isArray(form.getFieldValue('matchers')) ? form.getFieldValue('matchers') : []) as string[];
    setFormLoading(true);
    const annotations: Record<string, string> = editingRecord?.metadata?.annotations ? { ...editingRecord.metadata.annotations } : {};
    if (description != null) annotations.description = String(description).trim();
    const alias = aliasInput || name;
    if (alias) annotations[ALERT_POLICY_ALIAS_ANNOTATION] = alias;
    else delete annotations[ALERT_POLICY_ALIAS_ANNOTATION];
    if (matchers.length) annotations.matchers = matchers.join(',');
    type RouteMatcherItem = { matchType: string; name: string; value: string; matchers?: unknown[] };
    const routeMatchers: RouteMatcherItem[] = [];
    if (matchers.length) {
      const regexValue = matchers.map((a) => String(a).trim()).filter(Boolean).join('|');
      routeMatchers.push({ matchType: '=~', name: 'alertname', value: regexValue, matchers: [] });
    }
    const receiverSpecs: ReceiverSpec[] = parsed.map(({ type, name: n }) => {
      const lookup = specReceiverNameToSpecByType[type] ?? {};
      return lookup[n] ?? buildReceiverSpec(n, type, values);
    });
    const repeatInterval = (form.getFieldValue('repeatInterval') ?? '4h').toString().trim() || '4h';
    const rootRepeatInterval = '30m';
    const routePayload: Record<string, unknown> = {
      groupBy: ['alertname', 'namespace'],
      groupWait: '30s',
      groupInterval: '5m',
      receiver: configReceiverNames[0],
      repeatInterval: rootRepeatInterval,
      routes: configReceiverNames.map((receiver) => ({
        continue: true,
        matchers: routeMatchers.map((m) => ({ matchType: m.matchType, name: m.name, value: m.value })),
        receiver,
        repeatInterval,
      })),
    };
    const payload: Record<string, unknown> = {
      apiVersion: MONITORING_API_VERSION,
      kind: ALERTMANAGERCONFIG_KIND,
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
      const { match: _omitMatch, matchRe: _omitMatchRe, matchers: _omitMatchers, ...restExistingRoute } = existingRouteFull as Record<string, unknown>;
      const routeForPut = {
        ...restExistingRoute,
        groupBy: routePayload.groupBy,
        groupInterval: routePayload.groupInterval,
        groupWait: routePayload.groupWait,
        receiver: routePayload.receiver,
        repeatInterval: routePayload.repeatInterval,
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
      const { ok, error } = await createAlertmanagerconfig(cloudId, payload);
      setFormLoading(false);
      if (ok) {
        message.success('创建成功');
        handleCloseForm();
        await loadConfigList();
      } else message.error(error || '创建失败');
    }
  }, [editingRecord, form, handleCloseForm, loadConfigList, nameToType, specReceiverNameToSpecByType, cloudId, canWritePolicies]);

  const handleDeleteConfig = useCallback(
    async (row: AlertmanagerConfigItem) => {
      if (!canWritePolicies) {
        message.warning('无权删除告警通知策略');
        return;
      }
      const ns = row.metadata?.namespace;
      const name = row.metadata?.name;
      if (!ns || !name || !cloudId) {
        message.error('缺少项目名称或名称');
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

  const handleStartAliasEdit = useCallback((row: AlertmanagerConfigItem) => {
    const name = (row.metadata?.name ?? (row as any).name ?? '').toString().trim();
    const namespace = (row.metadata?.namespace ?? '').toString().trim();
    const key = `${namespace}/${name}`;
    const alias = (row.metadata?.annotations?.[ALERT_POLICY_ALIAS_ANNOTATION] ?? name).toString().trim();
    setAliasEditingKey(key);
    setAliasDraft(alias);
  }, []);

  const handleCancelAliasEdit = useCallback(() => {
    setAliasEditingKey(null);
    setAliasDraft('');
  }, []);

  const handleSaveAlias = useCallback(
    async (row: AlertmanagerConfigItem) => {
      if (!canWritePolicies) {
        message.warning('无权编辑通知策略名称');
        return;
      }
      const namespace = (row.metadata?.namespace ?? '').toString().trim();
      const name = (row.metadata?.name ?? (row as any).name ?? '').toString().trim();
      if (!cloudId || !namespace || !name) {
        message.error('缺少项目名称或通知策略标识');
        return;
      }
      const nextAlias = aliasDraft.trim() || name;
      setAliasSaving(true);
      try {
        const { data: full, ok: okDetail, error: errDetail } = await fetchAlertmanagerconfigDetail(cloudId, namespace, name);
        if (!okDetail || !full) {
          message.error(errDetail || '获取通知策略详情失败');
          return;
        }
        const existingRaw = full as any;
        const existing = existingRaw?.data != null && typeof existingRaw.data === 'object' ? existingRaw.data : existingRaw;
        const existingAnnotations =
          existing?.metadata?.annotations && typeof existing.metadata.annotations === 'object'
            ? existing.metadata.annotations
            : {};
        const nextPayload = {
          ...existing,
          metadata: {
            ...existing.metadata,
            name,
            namespace,
            resourceVersion: existing.metadata?.resourceVersion,
            annotations: {
              ...existingAnnotations,
              [ALERT_POLICY_ALIAS_ANNOTATION]: nextAlias,
            },
          },
        };
        const { ok, error } = await updateAlertmanagerconfig(cloudId, namespace, name, nextPayload);
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

  const allConfigColumns: ColumnsType<AlertmanagerConfigItem> = useMemo(
    () => [
      {
        title: '通知策略名称',
        key: 'alias',
        render: (_, row: AlertmanagerConfigItem) => {
          const name = (row.metadata?.name ?? (row as any).name ?? '').toString().trim();
          const namespace = (row.metadata?.namespace ?? '').toString().trim();
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
          const alias = (row.metadata?.annotations?.[ALERT_POLICY_ALIAS_ANNOTATION] ?? '').toString().trim();
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
                {alias || name || '-'}
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
      { title: '通知策略标识', dataIndex: ['metadata', 'name'], key: 'name', render: (n: string, row: AlertmanagerConfigItem) => (n ?? (row as any).name ?? '-') as string },
      { title: '项目名称', dataIndex: ['metadata', 'namespace'], key: 'namespace', render: (ns: string) => ns || '-' },
      {
        title: <span style={{ fontWeight: 600, color: '#000' }}>通知对象</span>,
        key: 'receivers',
        render: (_, row) => {
          const receivers = row.spec?.receivers;
          if (!Array.isArray(receivers)) return '-';
          const names = (receivers as { name?: string }[])
            .map((r) => r.name)
            .filter((n): n is string => Boolean(n) && String(n).trim() !== 'null-receiver');
          if (!names.length) return '-';
          return (
            <Space size={[8, 4]} wrap>
              {names.map((name) => (
                <Tag key={name} color="blue" style={{ fontSize: 'inherit', margin: 0, lineHeight: 'inherit' }}>
                  {`${name}(${receiverTypeLabelMap[(nameToType[name] ?? 'email-receiver') as ReceiverName] ?? '邮件'})`}
                </Tag>
              ))}
            </Space>
          );
        },
      },
      { title: '创建时间', dataIndex: ['metadata', 'creationTimestamp'], key: 'createdAt', ellipsis: true, render: (v: string | undefined) => (v ? (String(v).replace('T', ' ').replace(/\.\d{3}Z?$/, '') || v) : '-') },
      {
        title: '操作',
        key: 'action',
        fixed: 'right',
        render: (_, row) => {
          const isSystemDefaultPolicy = isSystemDefaultAlertPolicy(row);
          return (
            <ResourceActionsDropdown
              items={[
                { key: 'detail', label: '详情', onClick: () => handleOpenDetail(row) },
                {
                  key: 'edit',
                  label: '编辑策略',
                  disabled: !canWritePolicies || isSystemDefaultPolicy,
                  onClick: () => handleOpenForm(row),
                },
                { type: 'divider' as const },
                {
                  key: 'delete',
                  label: '删除',
                  danger: true,
                  disabled: !canWritePolicies || isSystemDefaultPolicy,
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
      nameToType,
      receiverTypeLabelMap,
    ]
  );

  // 列显示设置（需要在 allConfigColumns 定义之后）
  const { displayColumns: configColumns } = useTableColumnSettings(allConfigColumns, 'monitoring_alert_notification_policy_table');

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
    return list.sort((a, b) => {
      if (a.value === '') return -1;
      if (b.value === '') return 1;
      return String(a.label).localeCompare(String(b.label));
    });
  }, [isAdmin, rulesList, rulesGroupMap]);

  const [selectedAlertGroup, setSelectedAlertGroup] = useState<string>('');

  /** 按告警分组筛选后的 Transfer 选项（左侧列表）；已选中的项始终保留以便右侧正确展示 */
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
        <Typography.Text type="secondary">无权查看告警通知策略，请联系管理员分配 `clouds.alert-policies:read` 权限。</Typography.Text>
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
                  setConfigNsFilter(v === MONITORING_NAMESPACE_FILTER_ALL ? MONITORING_NAMESPACE_FILTER_ALL : v)
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
              <Button type="primary" disabled={!canWritePolicies} onClick={() => handleOpenForm(null)}>新增通知策略</Button>
              <TableColumnSettingsButton allColumns={allConfigColumns} settingsKey="monitoring_alert_notification_policy_table" />
              <Button icon={<ReloadOutlined />} onClick={loadConfigList} loading={configLoading} />
            </>
          }
        >
          <Table
            className="std-table"
            bordered={false}
            rowKey={(row) => row.id ?? row.metadata?.name ?? String(Math.random())}
            loading={configLoading}
            columns={configColumns}
            dataSource={filteredConfigList}
            scroll={{ x: true }}
            pagination={{ pageSize: 10, showSizeChanger: true, showTotal: (t) => `共 ${t} 条` }}
          />
        </PageDetailSection>
      </div>
      {/* 告警通知策略详情/只读Modal */}
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
            <Descriptions.Item label="通知策略名称">{detailData.alias ?? '-'}</Descriptions.Item>
            <Descriptions.Item label="通知策略标识">{detailData.name ?? '-'}</Descriptions.Item>
            <Descriptions.Item label="项目">{detailData.namespace ?? '-'}</Descriptions.Item>
            <Descriptions.Item label="描述">{detailData.description ?? '-'}</Descriptions.Item>
            <Descriptions.Item label="通知对象">
              {detailData.receiverNames?.length ? (
                <Space size={[8, 4]} wrap>
                  {detailData.receiverNames.map((n) => (
                    <Tag key={n} color="blue">
                      {`${n}(${receiverTypeLabelMap[(nameToType[n] ?? 'email-receiver') as ReceiverName] ?? '邮件'})`}
                    </Tag>
                  ))}
                </Space>
              ) : '-'}
            </Descriptions.Item>
            <Descriptions.Item label="触发规则">
              {detailData.matchers?.length ? (
                <Space size={[8, 4]} wrap>
                  {detailData.matchers.map((m) => (
                    <Tag key={m}>{m}</Tag>
                  ))}
                </Space>
              ) : '-'}
            </Descriptions.Item>
            <Descriptions.Item label="重复推送间隔">{detailData.repeatInterval ?? '-'}</Descriptions.Item>
            <Descriptions.Item label="创建时间">
              {detailData.creationTimestamp ? String(detailData.creationTimestamp).replace('T', ' ').replace(/\.\d{3}Z?$/, '') : '-'}
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
            <Button type="primary" loading={formLoading} onClick={handleFormSubmit}>{editingRecord ? '保存' : '创建'}</Button>
          </Space>
        }
        styles={{ body: { maxHeight: '75vh', overflow: 'auto', padding: 24 } }}
      >
        <Form
          form={form}
          layout="vertical"
          initialValues={{
            namespace: isAdmin ? undefined : (namespaceList[0] ?? 'default'),
            alias: '',
            matchers: [],
            matcherPairs: [],
            receiverName: 'email-receiver',
            configReceiverName: [],
            repeatInterval: '4h',
            emailList: [{ emailTo: '', emailFrom: '', smarthost: '', requireTls: true, authUsername: '', authIdentity: '', authSecretKey: '' }],
          }}
        >
          <Row gutter={24}>
            <Col span={24}>
              <Form.Item name="namespace" label="项目" rules={[{ required: true }]}>
                <Select placeholder={isAdmin ? '选择项目名称' : '租户项目名称'} disabled={!!editingRecord} loading={namespaceLoading} options={formNamespaceOptionsForForm} />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={24}>
            <Col span={12}>
              <Form.Item name="alias" label="通知策略名称" extra="支持输入中文，如：运维团队通知策略、存储团队通知策略">
                <Input placeholder="通知策略名称" maxLength={128} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="name" label="通知策略标识" extra="通知策略标识必须唯一且不可变更，如：ops-alert-policy、storage-alert-policy" rules={[{ required: true, message: '请输入通知策略标识，必须唯一' }]}>
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
                extra={formNamespaceEmpty ? '请先选择项目名称以加载通知对象' : undefined}
              >
                <Cascader
                  allowClear
                  placeholder="选择通知方式 → 通知对象"
                  options={receiverCascadeOptions}
                  value={cascadeSelectedValue}
                  loading={receiversLoading}
                  onDropdownVisibleChange={(open) => {
                    if (open && !(form.getFieldValue('namespace') != null && String(form.getFieldValue('namespace')).trim())) {
                      message.warning('请先选择项目名称，以便加载该项目下的通知对象');
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
                extra={formNamespaceEmpty ? '请先选择项目名称以加载通知对象' : undefined}
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
                      message.warning('请先选择项目名称，以便加载该项目下的通知对象');
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