/**
 * 告警通知对象
 * 按项目搜索，展示该项目下 receivers 列表（后端返回新结构：通知方式标识/名称、邮件SMTP、是否发送恢复邮件等）
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Button, Col, Descriptions, Form, Input, message, Modal, Row, Select, Space, Switch, Table, Tag, Typography } from 'antd';
import { DeleteOutlined, DingtalkOutlined, MailOutlined, PlusOutlined, ReloadOutlined as RefreshIcon, SearchOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import { useAuth } from '../../../../../contexts/AuthContext';
import PageDetailSection from '../../../../../components/PageDetailSection';
import TableColumnSettingsButton from '../../../../../components/TableColumnSettingsButton';
import { useTableColumnSettings } from '../../../../../hooks/useTableColumnSettings';
import {
  useMonitoring,
  ALERTMANAGERCONFIG_KIND,
  ANNOTATION_MONITORING_RECEIVER,
  ANNOTATION_ALIAS,
  ANNOTATION_DESCRIPTION,
  EMAIL_RECEIVER,
  DINGTALK_RECEIVER,
  WEBSITE_RECEIVER,
  MONITORING_API_VERSION,
  MONITORING_NAMESPACE_FILTER_ALL,
} from './context/MonitoringContext';
import ResourceActionsDropdown from '../../../../../components/ResourceActionsDropdown';
import {
  checkReceiverNameExists,
  deleteAlertmanagerconfig,
  deleteAlertmanagerconfigReceiver,
  fetchAlertPolicyReceivers,
  fetchAllowedNamespaces,
  fetchAlertmanagerconfigs,
  fetchNotificationTargetsList,
  fetchSecrets,
  postAlertmanagerconfigReceivers,
  type NotificationReceiverType,
  type NotificationTargetReceiver,
  type OpaqueSecretItem,
} from '../../../../../services/monitoringApi';
import {
  buildReceiverSpec,
  fetchDingtalkWebhookConfig,
  normalizeDingtalkReceiverSpec,
  type ReceiverName,
  type ReceiverSpec,
} from './lib/receivers';
import { hasPermissionForAction } from '../../../../../utils/accessMapping';

type ReceiverSpecItem = NotificationTargetReceiver;
type ReceiverItem = {
  key: string;
  /**
   * AlertmanagerConfig `metadata.name`，仅用于后续 CRUD URL 寻址。
   * **判断「通知方式」请使用 {@link ReceiverItem.receiverType}，不要再用 `receiverName`。**
   */
  receiverName: string;
  /**
   * 通知方式类型，来源于 AlertmanagerConfig 注解 `tower.io/monitoring-receiver`。
   * 注解缺失时按 metadata.name 回退（兼容历史数据）；
   * 前端「通知方式」列、详情、编辑、删除等所有派发一律以此字段为准。
   */
  receiverType: string;
  namespace?: string;
  specReceiverName: string;
  /** 通知对象名称，annotation `tower.io/alias` */
  alias?: string;
  /** 通知对象描述，annotation `tower.io/description` */
  description?: string;
  /** 邮件/钉钉/站内信通知对象 ID（用于删除前校验关联） */
  emailReceiverId?: string;
  dingtalkReceiverId?: string;
  websiteReceiverId?: string;
  smtpHost?: string;
  smtpRequireTls?: boolean;
  smtpAuthUsername?: string;
  smtpAuthPassword?: { name: string; key: string };
  emailFrom?: string;
  emailTo?: string;
  sendResolved?: boolean;
  url?: string;
  robotUrl?: string;
  robotAccount?: string;
  robotAccessToken?: string;
  /** 创建时间（后端返回） */
  createdAt?: string;
};

interface Props {
  cloudId: string;
}
const SECTION_TITLE_TAG_STYLE: React.CSSProperties = {
  padding: '4px 12px',
  fontSize: 14,
  borderRadius: 16,
  cursor: 'default',
  userSelect: 'none',
};
/**
 * 通知方式取值列表（与后端 annotation `tower.io/monitoring-receiver` 等价），
 * 请求告警通知对象列表时透传给后端按通知方式过滤。
 */
const MONITORING_RECEIVER_TYPES = [EMAIL_RECEIVER, DINGTALK_RECEIVER, WEBSITE_RECEIVER] as const;

/** 通知方式 -> 展示文案（受表格、详情、下拉等场景复用，KEY 与 annotation 取值一致） */
const RECEIVER_TYPE_LABELS: Record<string, string> = {
  [EMAIL_RECEIVER]: '邮件',       // 'email-receiver' -> '邮件'
  [DINGTALK_RECEIVER]: '钉钉',   // 'dingtalk-receiver' -> '钉钉'
  [WEBSITE_RECEIVER]: '站内信',    // 'website-receiver' -> '站内信'
};
const RECEIVER_TYPE_SELECT_OPTIONS = Object.entries(RECEIVER_TYPE_LABELS).map(([value, label]) => ({ value, label }));

const DEFAULT_ADMIN_NAMESPACE = 'cattle-monitoring-system';

/** 邮件/钉钉分别使用独立 AlertmanagerConfig：metadata.name = email-receiver | dingtalk-receiver */
const EMPTY_EMAIL_CONFIG = { emailTo: '', emailFrom: '', smarthost: '', requireTls: false, authUsername: '', authIdentity: '', authSecretKey: '', sendResolved: true };
const EMPTY_DINGTALK_CONFIG = { url: '', robotAccount: '', robotUrl: '', robotAccessToken: '', sendResolved: true };

/** 构造 AlertmanagerConfig metadata.annotations（含 monitoring-receiver / alias / description） */
function buildReceiverCrAnnotations(
  receiverType: NotificationReceiverType,
  alias?: string,
  description?: string,
): Record<string, string> {
  return {
    [ANNOTATION_MONITORING_RECEIVER]: receiverType,
    [ANNOTATION_ALIAS]: (alias ?? '').toString().trim(),
    [ANNOTATION_DESCRIPTION]: (description ?? '').toString().trim(),
  };
}

/** 列表列：通知对象名称（描述仅在详情/表单展示，不在列表展示） */
const RECEIVER_ALIAS_COLUMN: ColumnsType<ReceiverItem> = [
  {
    title: '通知对象名称',
    dataIndex: 'alias',
    key: 'alias',
    ellipsis: true,
    onHeaderCell: () => ({ style: { whiteSpace: 'nowrap' } }),
    render: (v: string | undefined) => v?.trim() || '-',
  },
];

const MonitoringAlertNotificationTargets: React.FC<Props> = ({ cloudId }) => {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin' || user?.role === 'super_admin';
  const perms = useMemo(() => (user?.permissions ?? []) as string[], [user?.permissions]);
  const canReadReceivers = useMemo(
    () => hasPermissionForAction(perms, 'clouds.alert-receivers:read'),
    [perms]
  );
  const canWriteReceivers = useMemo(
    () => hasPermissionForAction(perms, 'clouds.alert-receivers:write'),
    [perms]
  );
  const { formNamespaceOptions, formNamespaceOptionsForForm, namespaceLoading, configNsFilter, setConfigNsFilter, namespaceList } = useMonitoring();

  // 注意：namespaceOptions 和 loadingNs 在 loadNamespaceOptions 中被设置，但当前使用 formNamespaceOptions 和 namespaceLoading（来自 useMonitoring hook）
  // 保留这些变量以保持代码一致性，可能用于未来功能
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [namespaceOptions, setNamespaceOptions] = useState<{ label: string; value: string }[]>([]);
  const [selectedNamespace, setSelectedNamespace] = useState<string>('');
  /** 工具栏「通知方式」筛选值：取值与 annotation `tower.io/monitoring-receiver` 一致 */
  const [receiverTypeFilter, setReceiverTypeFilter] = useState<string>(EMAIL_RECEIVER);
  const [keyword, setKeyword] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [receiverSpecs, setReceiverSpecs] = useState<ReceiverSpecItem[]>([]);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [loadingNs, setLoadingNs] = useState(false);
  const [detailRecord, setDetailRecord] = useState<ReceiverItem | null>(null);
  const [editingRecord, setEditingRecord] = useState<ReceiverItem | null>(null);
  const [addEmailModalOpen, setAddEmailModalOpen] = useState(false);
  const [addDingtalkModalOpen, setAddDingtalkModalOpen] = useState(false);
  const [addEmailFormLoading, setAddEmailFormLoading] = useState(false);
  const [addDingtalkFormLoading, setAddDingtalkFormLoading] = useState(false);
  const [emailConfigCount, setEmailConfigCount] = useState(1);
  const [dingtalkConfigCount, setDingtalkConfigCount] = useState(1);
  const [addEmailForm] = Form.useForm();
  const [addDingtalkForm] = Form.useForm();
  const [addWebsiteModalOpen, setAddWebsiteModalOpen] = useState(false);
  const [addWebsiteFormLoading, setAddWebsiteFormLoading] = useState(false);
  const [addWebsiteForm] = Form.useForm();
  const [emailModalSecrets, setEmailModalSecrets] = useState<OpaqueSecretItem[]>([]);
  const [loadingEmailModalSecrets, setLoadingEmailModalSecrets] = useState(false);
  const watchedEmailConfigs = Form.useWatch('emailConfigs', addEmailForm) ?? [];
  const watchedEmailFormNamespace = Form.useWatch('namespace', addEmailForm);

  const loadNamespaceOptions = useCallback(async () => {
    if (!cloudId || !canReadReceivers) return;
    setLoadingNs(true);
    if (!isAdmin) {
      const { data: allowedData, ok: allowedOk } = await fetchAllowedNamespaces(cloudId);
      setLoadingNs(false);
      if (allowedOk && allowedData?.namespaces?.length) {
        setNamespaceOptions(
          allowedData.namespaces.map((ns) => ({ label: ns, value: ns }))
        );
        setSelectedNamespace((prev) => (!prev || !allowedData.namespaces.includes(prev) ? allowedData.namespaces[0] ?? '' : prev));
        return;
      }
    }
    const { data: configsData, ok: configsOk } = await fetchAlertmanagerconfigs(cloudId);
    if (!isAdmin) setLoadingNs(false);
    if (configsOk && configsData) {
      const list = Array.isArray(configsData) ? configsData : (configsData as any)?.data ?? [];
      const nsSet = new Set<string>();
      list.forEach((item: any) => {
        const ns = item?.metadata?.namespace ?? item?.namespace ?? '';
        if (ns) nsSet.add(String(ns).trim());
      });
      if (isAdmin) {
        nsSet.add(DEFAULT_ADMIN_NAMESPACE);
        setLoadingNs(false);
      }
      const names = Array.from(nsSet).sort();
      if (!names.length) names.push('default');
      setNamespaceOptions(names.map((ns) => ({ label: ns, value: ns })));
      setSelectedNamespace((prev) => {
        if (isAdmin && (!prev || !names.includes(prev))) return DEFAULT_ADMIN_NAMESPACE;
        if (!prev || !names.includes(prev)) return names[0] ?? '';
        return prev;
      });
    } else {
      setLoadingNs(false);
      setNamespaceOptions(isAdmin ? [{ label: DEFAULT_ADMIN_NAMESPACE, value: DEFAULT_ADMIN_NAMESPACE }] : [{ label: 'default', value: 'default' }]);
      setSelectedNamespace(isAdmin ? DEFAULT_ADMIN_NAMESPACE : 'default');
    }
  }, [cloudId, isAdmin, canReadReceivers]);

  /** 根据 configNsFilter 决定请求的项目；钉钉的 robotUrl/robotAccessToken 从 dingtalkWebhookConfig（ConfigMap targets）同步读取 */
  const loadReceivers = useCallback(async () => {
    if (!cloudId || !canReadReceivers) return;
    const ns = String(configNsFilter ?? '').trim();
    const namespaces = ns ? [ns] : namespaceList;
    if (namespaces.length === 0) {
      setReceiverSpecs([]);
      return;
    }
    setLoading(true);
    const [targetsRes, dingtalkConfigRes] = await Promise.all([
      fetchNotificationTargetsList(cloudId, { namespaces, receiverName: [...MONITORING_RECEIVER_TYPES] }),
      fetchDingtalkWebhookConfig(cloudId),
    ]);
    setLoading(false);
    const { data, ok, error } = targetsRes;
    if (!ok) {
      message.error(error || '加载通知对象失败');
      setReceiverSpecs([]);
      return;
    }
    /** 钉钉的 robotUrl/robotAccessToken 从 ConfigMap targets[robotAccount].url 解析补全 */
    const dingtalkConfig = dingtalkConfigRes.ok ? dingtalkConfigRes.config : undefined;
    let receivers = data?.receivers && Array.isArray(data.receivers) ? data.receivers : [];
    receivers = receivers.map((r: NotificationTargetReceiver) => {
      // 通知方式优先取注解 receiverType；缺失时回退 metadata.name（receiverName）以兼容历史数据
      const type = ((r as { receiverType?: string }).receiverType ?? r.receiverName ?? '').toString().trim();
      if (type !== DINGTALK_RECEIVER) return r;
      const ns = (r.namespace ?? '').toString().trim();
      const specReceivers = Array.isArray((r as any).specReceivers)
        ? (r as any).specReceivers.map((s: any) =>
            normalizeDingtalkReceiverSpec(s as ReceiverSpec, ns, (s?.name ?? '').toString().trim(), dingtalkConfig)
          )
        : [];
      return { ...r, specReceivers };
    });
    setReceiverSpecs(receivers);
  }, [cloudId, configNsFilter, namespaceList, canReadReceivers]);

  useEffect(() => {
    if (cloudId && canReadReceivers) loadNamespaceOptions();
  }, [cloudId, loadNamespaceOptions, canReadReceivers]);

  useEffect(() => {
    if (isAdmin && selectedNamespace === '') setSelectedNamespace(DEFAULT_ADMIN_NAMESPACE);
  }, [isAdmin, selectedNamespace]);

  /** 通知方式或项目变更时重新加载通知对象列表 */
  useEffect(() => {
    if (cloudId && canReadReceivers) loadReceivers();
  }, [cloudId, configNsFilter, receiverTypeFilter, loadReceivers, canReadReceivers]);

  /** 项目筛选改为具体项目时，同步 selectedNamespace 供「新增」使用 */
  useEffect(() => {
    if (configNsFilter != null) setSelectedNamespace(configNsFilter);
  }, [configNsFilter]);

  /** 按项目加载邮件弹窗内 SMTP 密钥列表（monitoring-receiver-secret 标签），项目变更时需刷新 */
  const loadEmailModalSecrets = useCallback(
    (namespace: string) => {
      if (!cloudId) return;
      const ns = (namespace ?? '').toString().trim();
      if (!ns) {
        setEmailModalSecrets([]);
        return;
      }
      setLoadingEmailModalSecrets(true);
      fetchSecrets(cloudId, { namespace: ns })
        .then(({ data }) => setEmailModalSecrets(Array.isArray(data) ? data : []))
        .finally(() => setLoadingEmailModalSecrets(false));
    },
    [cloudId]
  );

  // 邮件弹窗内项目变化时刷新该项目下的 Secret 列表
  useEffect(() => {
    if (!addEmailModalOpen || !cloudId) return;
    const ns = (watchedEmailFormNamespace ?? '').toString().trim();
    if (!ns) {
      setEmailModalSecrets([]);
      return;
    }
    loadEmailModalSecrets(ns);
  }, [addEmailModalOpen, cloudId, watchedEmailFormNamespace, loadEmailModalSecrets]);

  const handleOpenAddEmailModal = useCallback(async () => {
    if (!canWriteReceivers) {
      message.warning('无权新增通知对象');
      return;
    }
    if (!selectedNamespace) {
      message.warning('请先选择项目');
      return;
    }
    setAddEmailModalOpen(true);
    setEmailConfigCount(1);
    addEmailForm.resetFields();
    addEmailForm.setFieldsValue({
      namespace: selectedNamespace,
      receiverName: EMAIL_RECEIVER,
      specReceiverName: '',
      alias: '',
      description: '',
      emailConfigs: [{ ...EMPTY_EMAIL_CONFIG }],
    });
  }, [selectedNamespace, addEmailForm, canWriteReceivers]);

  const handleOpenAddDingtalkModal = useCallback(() => {
    if (!canWriteReceivers) {
      message.warning('无权新增通知对象');
      return;
    }
    if (!selectedNamespace) {
      message.warning('请先选择项目');
      return;
    }
    setAddDingtalkModalOpen(true);
    setDingtalkConfigCount(1);
    addDingtalkForm.resetFields();
    addDingtalkForm.setFieldsValue({
      namespace: selectedNamespace,
      specReceiverName: '',
      alias: '',
      description: '',
      webhookConfigs: [{ ...EMPTY_DINGTALK_CONFIG }],
    });
  }, [selectedNamespace, addDingtalkForm, canWriteReceivers]);

  const handleOpenAddWebsiteModal = useCallback(() => {
    if (!canWriteReceivers) {
      message.warning('无权新增通知对象');
      return;
    }
    setAddWebsiteModalOpen(true);
    addWebsiteForm.resetFields();
    addWebsiteForm.setFieldsValue({
      namespace: selectedNamespace ? [selectedNamespace] : [],
      receiverName: WEBSITE_RECEIVER,
      alias: '',
      description: '',
    });
  }, [selectedNamespace, addWebsiteForm, canWriteReceivers]);

  const handleCloseAddEmailModal = useCallback(() => {
    setAddEmailModalOpen(false);
    setEditingRecord(null);
    setEmailConfigCount(1);
    addEmailForm.resetFields();
  }, [addEmailForm]);

  const handleCloseAddDingtalkModal = useCallback(() => {
    setAddDingtalkModalOpen(false);
    setEditingRecord(null);
    setDingtalkConfigCount(1);
    addDingtalkForm.resetFields();
  }, [addDingtalkForm]);

  const handleCloseAddWebsiteModal = useCallback(() => {
    setAddWebsiteModalOpen(false);
    setEditingRecord(null);
    addWebsiteForm.resetFields();
  }, [addWebsiteForm]);

  const handleAddWebsiteSubmit = useCallback(async () => {
    const values = await addWebsiteForm.validateFields(['namespace', 'receiverName', 'alias', 'description']).catch(() => null);
    if (!values || !cloudId) return;
    const raw = values.namespace;
    const isWebsiteEdit = !!editingRecord && editingRecord.receiverType === WEBSITE_RECEIVER;
    const namespaces = isWebsiteEdit
      ? [String(editingRecord?.namespace ?? selectedNamespace ?? '').trim()].filter(Boolean)
      : Array.isArray(raw)
        ? raw.map((n: any) => String(n ?? '').trim()).filter(Boolean)
        : [selectedNamespace].filter(Boolean).map(String);
    if (namespaces.length === 0) {
      message.warning('请至少选择一个项目');
      return;
    }
    setAddWebsiteFormLoading(true);
    try {
      const receiverSpec = buildReceiverSpec(WEBSITE_RECEIVER, WEBSITE_RECEIVER as ReceiverName, {});
      const annotations = buildReceiverCrAnnotations(
        WEBSITE_RECEIVER,
        values.alias,
        values.description,
      );
      const failed: string[] = [];
      for (const ns of namespaces) {
        const payload = {
          apiVersion: MONITORING_API_VERSION,
          kind: ALERTMANAGERCONFIG_KIND,
          metadata: {
            name: WEBSITE_RECEIVER,
            namespace: ns,
            labels: { 'monitoring-receiver': 'true' },
            annotations,
          },
          spec: { receivers: [receiverSpec] },
        };
        const { ok, error } = await postAlertmanagerconfigReceivers(
          cloudId,
          ns,
          WEBSITE_RECEIVER,
          payload,
          { receiverType: WEBSITE_RECEIVER }
        );
        if (!ok) failed.push(`${ns}${error ? `: ${error}` : ''}`);
      }
      await loadReceivers();
      handleCloseAddWebsiteModal();
      setEditingRecord(null);
      if (failed.length === 0) {
        message.success(
          isWebsiteEdit
            ? '站内信通知对象已更新'
            : namespaces.length === 1
              ? '本站站内信已开通'
              : `已为 ${namespaces.length} 个项目开通站内信`,
        );
      } else if (failed.length < namespaces.length) {
        message.warning(`部分开通成功，失败：${failed.join('；')}`);
      } else {
        message.error(failed.length === 1 ? (failed[0] || '开通失败') : `开通失败：${failed.join('；')}`);
      }
    } finally {
      setAddWebsiteFormLoading(false);
    }
  }, [addWebsiteForm, cloudId, selectedNamespace, editingRecord, loadReceivers, handleCloseAddWebsiteModal]);

  const handleAddEmailConfigRow = useCallback(() => {
    const current = Array.isArray(addEmailForm.getFieldValue('emailConfigs')) ? addEmailForm.getFieldValue('emailConfigs') : [];
    addEmailForm.setFieldValue('emailConfigs', [...current, { ...EMPTY_EMAIL_CONFIG }]);
    setEmailConfigCount((prev) => prev + 1);
  }, [addEmailForm]);

  const handleRemoveEmailConfigRow = useCallback((index: number) => {
    const current = Array.isArray(addEmailForm.getFieldValue('emailConfigs')) ? addEmailForm.getFieldValue('emailConfigs') : [];
    if (current.length <= 1) return;
    addEmailForm.setFieldValue('emailConfigs', current.filter((_: unknown, i: number) => i !== index));
    setEmailConfigCount((prev) => Math.max(1, prev - 1));
  }, [addEmailForm]);

  const handleRemoveDingtalkConfigRow = useCallback((index: number) => {
    const current = Array.isArray(addDingtalkForm.getFieldValue('webhookConfigs')) ? addDingtalkForm.getFieldValue('webhookConfigs') : [];
    if (current.length <= 1) return;
    addDingtalkForm.setFieldValue('webhookConfigs', current.filter((_: unknown, i: number) => i !== index));
    setDingtalkConfigCount((prev) => Math.max(1, prev - 1));
  }, [addDingtalkForm]);

  /**
   * 新增/编辑通知对象 —— 每通知对象一独立 AlertmanagerConfig CR。
   *
   * 约定：
   *   - `metadata.name = specReceiverName`（用户输入的唯一标识，邮件/钉钉），
   *     站内信沿用 `metadata.name = website-receiver`（外层另有专用提交入口）。
   *   - `metadata.annotations['tower.io/monitoring-receiver'] = receiverType`。
   *   - `spec.receivers = [<本次表单产生的单条 receiver>]`，不再向历史共享 CR 合并。
   *
   * 历史共享 CR 迁移：若 editingRecord 来源于「receiverName ≠ specReceiverName」的旧共享 CR，
   * 写入新 CR 成功后，会调用 deleteAlertmanagerconfigReceiver 移除旧 CR 中的同名 entry，
   * 避免列表里同一标识出现两条数据。
   */
  const upsertReceiverToAlertmanagerConfig = useCallback(async (args: {
    namespace: string;
    receiverType: NotificationReceiverType;
    formValues: any;
    setLoading: (v: boolean) => void;
    onSuccess: () => void;
    /** 编辑模式下传入原 ReceiverItem（用于历史共享 CR 迁移与重名校验） */
    editingRecord?: ReceiverItem | null;
  }) => {
    const { namespace, receiverType, formValues, setLoading, onSuccess, editingRecord } = args;
    setLoading(true);
    const specReceiverName = (formValues.specReceiverName ?? '').toString().trim();
    if (!specReceiverName) {
      setLoading(false);
      message.warning('通知对象标识不能为空');
      return;
    }
    // 防止与历史共享 CR 同名（email/dingtalk）。站内信 metadata.name 沿用 website-receiver。
    if (receiverType !== WEBSITE_RECEIVER && specReceiverName === receiverType) {
      setLoading(false);
      message.warning('通知对象标识不能等于通知方式名，请改名');
      return;
    }
    const receiverSpec = buildReceiverSpec(specReceiverName, receiverType as ReceiverName, formValues);

    const editingSpecName = (editingRecord?.specReceiverName ?? '').toString().trim();
    const isAdding = !editingSpecName;
    const isRenaming = !isAdding && specReceiverName !== editingSpecName;
    if (isAdding || isRenaming) {
      const { data: checkData, ok: checkOk } = await checkReceiverNameExists(
        cloudId,
        namespace,
        specReceiverName,
        receiverType
      );
      if (checkOk && (checkData as any)?.exists) {
        setLoading(false);
        message.warning('该通知对象标识已存在，请使用其他标识');
        return;
      }
    }

    // 新模型：URL `:name` 直接为通知对象标识；payload 仅含本次表单生成的单条 receiver
    const alias = (formValues.alias ?? '').toString().trim();
    const description = (formValues.description ?? '').toString().trim();
    const payload = {
      apiVersion: MONITORING_API_VERSION,
      kind: ALERTMANAGERCONFIG_KIND,
      metadata: {
        name: specReceiverName,
        namespace,
        labels: { 'monitoring-receiver': 'true' },
        annotations: buildReceiverCrAnnotations(receiverType, alias, description),
      },
      spec: { receivers: [receiverSpec] },
    };
    const { ok, error } = await postAlertmanagerconfigReceivers(
      cloudId,
      namespace,
      specReceiverName,
      payload,
      { receiverType }
    );

    // 迁移：编辑来源是旧共享 CR 时，写入新 CR 成功后从旧共享 CR 中删除同名 entry
    const editingFromLegacyShared =
      editingRecord &&
      editingRecord.receiverName &&
      editingRecord.specReceiverName &&
      editingRecord.receiverName !== editingRecord.specReceiverName;
    if (ok && editingFromLegacyShared) {
      const legacyConfigName = editingRecord!.receiverName;
      const legacySpecName = editingRecord!.specReceiverName;
      const legacyNs = (editingRecord!.namespace ?? namespace) || namespace;
      try {
        await deleteAlertmanagerconfigReceiver(cloudId, legacyNs, legacyConfigName, legacySpecName);
      } catch (e) {
        console.warn('[upsert receiver] migrate legacy shared CR entry failed:', e);
      }
    }

    setLoading(false);
    if (ok) {
      message.success(editingRecord ? '通知对象已更新' : '通知对象已添加');
      await loadReceivers();
      onSuccess();
    } else {
      message.error(error || (editingRecord ? '更新通知对象失败' : '添加通知对象失败'));
    }
  }, [cloudId, loadReceivers]);

  const handleAddEmailSubmit = useCallback(async () => {
    const fieldsToValidate = ['namespace', 'specReceiverName', 'alias', 'description', 'emailConfigs'];
    const values = await addEmailForm.validateFields(fieldsToValidate).catch(() => null);
    const namespace = (values?.namespace ?? selectedNamespace) ?? '';
    if (!values || !cloudId || !namespace) return;
    await upsertReceiverToAlertmanagerConfig({
      namespace,
      receiverType: EMAIL_RECEIVER,
      formValues: values,
      setLoading: setAddEmailFormLoading,
      onSuccess: handleCloseAddEmailModal,
      editingRecord,
    });
  }, [addEmailForm, cloudId, selectedNamespace, editingRecord, upsertReceiverToAlertmanagerConfig, handleCloseAddEmailModal]);

  const handleAddDingtalkSubmit = useCallback(async () => {
    const fieldsToValidate = ['namespace', 'specReceiverName', 'alias', 'description', 'webhookConfigs'];
    const values = await addDingtalkForm.validateFields(fieldsToValidate).catch(() => null);
    const namespace = (values?.namespace ?? selectedNamespace) ?? '';
    if (!values || !cloudId || !namespace) return;
    await upsertReceiverToAlertmanagerConfig({
      namespace,
      receiverType: DINGTALK_RECEIVER,
      formValues: values,
      setLoading: setAddDingtalkFormLoading,
      onSuccess: handleCloseAddDingtalkModal,
      editingRecord,
    });
  }, [addDingtalkForm, cloudId, selectedNamespace, editingRecord, upsertReceiverToAlertmanagerConfig, handleCloseAddDingtalkModal]);

  const handleDetail = useCallback((record: ReceiverItem) => setDetailRecord(record), []);

  const handleEdit = useCallback(
    (record: ReceiverItem, receiverRows: ReceiverItem[]) => {
      if (!canWriteReceivers) {
        message.warning('无权编辑通知对象');
        return;
      }
      if (!cloudId || !record.namespace || !record.receiverType || !record.specReceiverName) {
        message.warning('无法编辑：缺少项目或通知对象信息');
        return;
      }
      setEditingRecord(record);
      if (record.receiverType === EMAIL_RECEIVER) {
        // 同一通知对象标识下可能有多条邮件配置（一对多），编辑时按 receiverType 聚合该 specReceiverName 的全部行
        const sameReceiverRows = receiverRows.filter(
          (r) =>
            r.namespace === record.namespace &&
            r.receiverType === record.receiverType &&
            r.specReceiverName === record.specReceiverName
        );
        const formConfigs =
          sameReceiverRows.length > 0
            ? sameReceiverRows.map((r) => ({
                emailTo: (r?.emailTo ?? '').toString().trim(),
                emailFrom: (r?.emailFrom ?? '').toString().trim(),
                smarthost: (r?.smtpHost ?? '').toString().trim(),
                requireTls: r?.smtpRequireTls === true,
                authUsername: (r?.smtpAuthUsername ?? '').toString().trim(),
                authIdentity: (r?.smtpAuthPassword?.name ?? '').toString().trim(),
                authSecretKey: (r?.smtpAuthPassword?.key ?? '').toString().trim(),
                sendResolved: r?.sendResolved !== false,
              }))
            : [{ ...EMPTY_EMAIL_CONFIG }];
        setEmailConfigCount(formConfigs.length);
        addEmailForm.resetFields();
        addEmailForm.setFieldsValue({
          namespace: record.namespace,
          receiverName: EMAIL_RECEIVER,
          specReceiverName: record.specReceiverName,
          alias: record.alias ?? '',
          description: record.description ?? '',
          emailConfigs: formConfigs,
        });
        setAddEmailModalOpen(true);
      } else if (record.receiverType === DINGTALK_RECEIVER) {
        const formList = [
          {
            robotUrl: (record?.robotUrl ?? '').toString().trim(),
            robotAccessToken: (record?.robotAccessToken ?? '').toString().trim(),
            sendResolved: record?.sendResolved !== false,
          },
        ];
        setDingtalkConfigCount(1);
        addDingtalkForm.resetFields();
        addDingtalkForm.setFieldsValue({
          namespace: record.namespace,
          specReceiverName: record.specReceiverName,
          alias: record.alias ?? '',
          description: record.description ?? '',
          webhookConfigs: formList,
        });
        setAddDingtalkModalOpen(true);
      } else if (record.receiverType === WEBSITE_RECEIVER) {
        addWebsiteForm.resetFields();
        addWebsiteForm.setFieldsValue({
          namespace: record.namespace ?? undefined,
          receiverName: WEBSITE_RECEIVER,
          alias: record.alias ?? '',
          description: record.description ?? '',
        });
        setAddWebsiteModalOpen(true);
      } else {
        setEditingRecord(null);
        message.info('暂不支持编辑该类型');
      }
    },
    [cloudId, addEmailForm, addDingtalkForm, canWriteReceivers]
  );
  /**
   * 删除通知对象。
   *
   * 派发逻辑：
   *   - 新模型（每通知对象一 CR）：`receiverName === specReceiverName`（或站内信沿用 `website-receiver`），
   *     调用 `deleteAlertmanagerconfig` 整 CR 删除（后端会兜底处理钉钉 ConfigMap、邮件 Secret 关联）。
   *   - 历史共享 CR：`receiverName ∈ {email-receiver, dingtalk-receiver}` 且与 specReceiverName 不一致，
   *     调用 `deleteAlertmanagerconfigReceiver` 仅移除该条 entry。
   */
  const handleDelete = useCallback(
    (record: ReceiverItem) => {
      if (!canWriteReceivers) {
        message.warning('无权删除通知对象');
        return;
      }
      if (!record.namespace || !record.receiverName || !record.receiverType || !record.specReceiverName) {
        message.warning('无法删除：缺少项目或通知对象信息');
        return;
      }
      Modal.confirm({
        title: '确定删除该通知对象？',
        content: `将移出通知对象「${record.specReceiverName}」，告警通知策略中若引用了该对象需同步修改。`,
        okText: '确定',
        cancelText: '取消',
        okButtonProps: { danger: true },
        onOk: async () => {
          const { data: policyReceivers, ok: checkOk } = await fetchAlertPolicyReceivers(cloudId!, {
            namespace: record.namespace,
            specReceiverName: record.specReceiverName,
          });
          const list = (policyReceivers as any)?.data?.data ?? (policyReceivers as any)?.data ?? [];
          if (checkOk && Array.isArray(list) && list.length > 0) {
            const policyNames = [...new Set(list.map((p: any) => p.policyName))].join('、');
            message.warning(`该通知对象已被以下告警通知策略引用，请先解除关联后再删除：${policyNames}`);
            return;
          }
          // 新模型：receiverName === specReceiverName ⇒ 整 CR 删除；
          // 历史共享 CR：receiverName ∈ {email-receiver, dingtalk-receiver, website-receiver} 且 ≠ specReceiverName
          //   ⇒ 仅移除 spec.receivers 中的同名 entry。
          const isLegacySharedEntry =
            record.receiverName !== record.specReceiverName &&
            (record.receiverName === EMAIL_RECEIVER ||
              record.receiverName === DINGTALK_RECEIVER ||
              record.receiverName === WEBSITE_RECEIVER);
          const deleteFn = isLegacySharedEntry
            ? () =>
                deleteAlertmanagerconfigReceiver(
                  cloudId!,
                  record.namespace!,
                  record.receiverName,
                  record.specReceiverName
                )
            : () => deleteAlertmanagerconfig(cloudId!, record.namespace!, record.receiverName);
          const { ok, error } = await deleteFn();
          if (ok) {
            message.success('已删除');
            await loadReceivers();
          } else {
            message.error(error || '删除失败');
          }
        },
      });
    },
    [cloudId, loadReceivers, canWriteReceivers]
  );

  const receiverRows: ReceiverItem[] = useMemo(() => {
    const out: ReceiverItem[] = [];
    for (const r of receiverSpecs) {
      if (!r) continue;
      // 「通知方式」一律以 annotation 落到的 receiverType 为准，缺失时回退 metadata.name（兼容历史数据）
      const rawType = ((r as { receiverType?: string }).receiverType ?? r.receiverName ?? '').toString().trim();
      const receiverType = rawType || '';
      const receiverName = (r.receiverName ?? '').toString().trim() || receiverType;
      const ns = (r.namespace ?? selectedNamespace) || '';
      const itemAlias = ((r as { alias?: string }).alias ?? '').toString().trim() || undefined;
      const itemDescription = ((r as { description?: string }).description ?? '').toString().trim() || undefined;
      const list = Array.isArray((r as any)?.specReceivers) ? (r as any).specReceivers : [];
      const keyType = receiverType || receiverName || 'unknown-receiver';
      if (receiverType === EMAIL_RECEIVER) { // 邮件通知对象
        for (const specReceiver of list) {
          const specReceiverName = (specReceiver?.name ?? '').toString().trim() || '';
          const specEmailConfigs = Array.isArray(specReceiver?.emailConfigs) ? specReceiver.emailConfigs : [];
          const receiverId = specReceiver?.id;
          specEmailConfigs.forEach((c: any, idx: number) => {
            out.push({
              key: `${ns}/${keyType}/${specReceiverName}/${idx}`,
              namespace: ns || undefined,
              receiverName,
              receiverType,
              specReceiverName,
              alias: itemAlias,
              description: itemDescription,
              emailReceiverId: receiverId,
              emailTo: c?.to,
              emailFrom: c?.from,
              smtpHost: c?.smarthost,
              smtpRequireTls: c?.requireTLS,
              smtpAuthUsername: c?.authUsername,
              smtpAuthPassword: {
                name: (c?.authPassword?.name ?? '').toString().trim(),
                key: (c?.authPassword?.key ?? '').toString().trim(),
              },
              sendResolved: c?.sendResolved,
              createdAt: specReceiver?.createdAt,
            });
          });
          if (specEmailConfigs.length === 0 && specReceiverName) {
            out.push({
              key: `${ns}/${keyType}/${specReceiverName}/0`,
              namespace: ns || undefined,
              receiverName,
              receiverType,
              specReceiverName,
              alias: itemAlias,
              description: itemDescription,
              emailReceiverId: receiverId,
              createdAt: specReceiver?.createdAt,
            } as ReceiverItem);
          }
        }
      } else if (receiverType === DINGTALK_RECEIVER) {  // 钉钉通知对象
        for (const specReceiver of list) {
          const specReceiverName = (specReceiver?.name ?? '').toString().trim() || '';
          const receiverId = specReceiver?.id;
          const webhookConfigs = Array.isArray(specReceiver?.webhookConfigs) ? specReceiver.webhookConfigs : [];
          webhookConfigs.forEach((c: any, idx: number) => {
            out.push({
              key: `${ns}/${keyType}/${specReceiverName}/${idx}`,
              namespace: ns || undefined,
              receiverName,
              receiverType,
              specReceiverName,
              alias: itemAlias,
              description: itemDescription,
              dingtalkReceiverId: receiverId,
              robotAccount: c?.robotAccount,
              robotUrl: c?.robotUrl,
              url: c?.url,
              robotAccessToken: c?.robotAccessToken,
              sendResolved: c?.sendResolved,
              createdAt: specReceiver?.createdAt,
            });
          });
          if (webhookConfigs.length === 0 && specReceiverName) {
            out.push({
              key: `${ns}/${keyType}/${specReceiverName}/0`,
              namespace: ns || undefined,
              receiverName,
              receiverType,
              specReceiverName,
              alias: itemAlias,
              description: itemDescription,
              dingtalkReceiverId: receiverId,
              createdAt: specReceiver?.createdAt,
            } as ReceiverItem);
          }
        }
      } else if (receiverType === WEBSITE_RECEIVER) {  // 站内信通知对象
        for (const specReceiver of list) {
          const specReceiverName = (specReceiver?.name ?? '').toString().trim() || WEBSITE_RECEIVER;
          out.push({
            key: `${ns}/${keyType}/${specReceiverName}`,
            namespace: ns || undefined,
            receiverName,
            receiverType,
            specReceiverName,
            alias: itemAlias,
            description: itemDescription,
            websiteReceiverId: specReceiver?.id,
            createdAt: specReceiver?.createdAt,
          } as ReceiverItem);
        }
      }
    }
    return out;
  }, [receiverSpecs, selectedNamespace]);

  const filteredReceivers = useMemo(() => {
    // 工具栏「通知方式」下拉值即 receiverType，列表过滤直接以 receiverType 命中
    let filtered = receiverRows.filter((r) => r.receiverType === receiverTypeFilter);
    if (keyword.trim()) {
      const k = keyword.trim().toLowerCase();
      filtered = filtered.filter((r) => {
        const typeMatch = (r.receiverType ?? '').toLowerCase().includes(k);
        const specNameMatch = (r.specReceiverName ?? '').toLowerCase().includes(k);
        const aliasMatch = (r.alias ?? '').toLowerCase().includes(k);
        const nsMatch = (r.namespace ?? '').toLowerCase().includes(k);
        return typeMatch || specNameMatch || aliasMatch || nsMatch;
      });
    }
    return filtered;
  }, [receiverRows, receiverTypeFilter, keyword]);

  const renderAction = useCallback(
    (_: unknown, record: ReceiverItem) => (
      <ResourceActionsDropdown
        items={[
          { key: 'detail', label: '详情', onClick: () => handleDetail(record) },
          { key: 'edit', label: '编辑', disabled: !canWriteReceivers, onClick: () => handleEdit(record, receiverRows) },
          { type: 'divider' as const },
          { key: 'delete', label: '删除', danger: true, disabled: !canWriteReceivers, onClick: () => handleDelete(record) },
        ]}
      />
    ),
    [handleDetail, handleEdit, handleDelete, receiverRows, canWriteReceivers]
  );

  const emailColumns: ColumnsType<ReceiverItem> = useMemo(
    () => [
      {
        title: '通知方式',
        dataIndex: 'receiverType',
        key: 'receiverType',
        fixed: 'left',
        onHeaderCell: () => ({ style: { whiteSpace: 'nowrap' } }),
        // 通知方式展示一律以 annotation 落入的 receiverType 为准
        render: (_: unknown, r: ReceiverItem) => (
          <Space>
            <MailOutlined style={{ color: '#1890ff' }} />
            {RECEIVER_TYPE_LABELS[r.receiverType ?? ''] ?? r.receiverType ?? '-'}
          </Space>
        ),
      },
      {
        title: '通知对象标识',
        dataIndex: 'specReceiverName',
        key: 'specReceiverName',
        ellipsis: true,
        onHeaderCell: () => ({ style: { whiteSpace: 'nowrap' } }),
      },
      ...RECEIVER_ALIAS_COLUMN,
      {
        title: '项目',
        dataIndex: 'namespace',
        key: 'namespace',
        ellipsis: true,
        onHeaderCell: () => ({ style: { whiteSpace: 'nowrap' } }),
      },
      { title: '发件人', dataIndex: 'emailFrom', key: 'emailFrom', ellipsis: true, onHeaderCell: () => ({ style: { whiteSpace: 'nowrap' } }) },
      { title: '收件人', dataIndex: 'emailTo', key: 'emailTo', ellipsis: true, onHeaderCell: () => ({ style: { whiteSpace: 'nowrap' } }) },
      {
        title: '是否发送恢复通知',
        dataIndex: 'sendResolved',
        key: 'sendResolved',
        render: (v: boolean | undefined) => (v === true ? <Tag color="blue">是</Tag> : <Tag color="warning">否</Tag>),
        onHeaderCell: () => ({ style: { whiteSpace: 'nowrap' } }),
      },
      {
        title: '邮件服务器(SMTP)',
        dataIndex: 'smtpHost',
        key: 'smtpHost',
        ellipsis: true,
        onHeaderCell: () => ({ style: { whiteSpace: 'nowrap' } }),
      },
      {
        title: 'SMTP是否TLS',
        dataIndex: 'smtpRequireTls',
        key: 'smtpRequireTls',
        onHeaderCell: () => ({ style: { whiteSpace: 'nowrap' } }),
        render: (v: boolean | undefined) => (v === true ? '是' : '否'),
      },
      {
        title: 'SMTP授权账号',
        dataIndex: 'smtpAuthUsername',
        key: 'smtpAuthUsername',
        ellipsis: true,
        onHeaderCell: () => ({ style: { whiteSpace: 'nowrap' } }),
      },
      {
        title: 'SMTP授权账号密钥(Secret)',
        dataIndex: ['smtpAuthPassword', 'name'],
        key: 'smtpAuthPassword',
        ellipsis: true,
        onHeaderCell: () => ({ style: { whiteSpace: 'nowrap' } }),
        render: (v: string | undefined) => v || '-',
      },
      { title: '创建时间', dataIndex: 'createdAt', key: 'createdAt', ellipsis: true, onHeaderCell: () => ({ style: { whiteSpace: 'nowrap' } }), render: (v: string | undefined) => (v ? (v.replace('T', ' ').replace(/\.\d{3}Z?$/, '') || v) : '-') },
      { title: '操作', key: 'action', fixed: 'right', render: renderAction },
    ],
    [renderAction]
  );

  const dingtalkColumns: ColumnsType<ReceiverItem> = useMemo(
    () => [
      {
        title: '通知方式',
        dataIndex: 'receiverType',
        key: 'receiverType',
        fixed: 'left',
        onHeaderCell: () => ({ style: { whiteSpace: 'nowrap' } }),
        render: (_: unknown, r: ReceiverItem) => (
          <Space>
            <DingtalkOutlined style={{ color: '#0089ff' }} />
            {RECEIVER_TYPE_LABELS[r.receiverType ?? ''] ?? r.receiverType ?? '-'}
          </Space>
        ),
      },
      {
        title: '通知对象标识',
        dataIndex: 'specReceiverName',
        key: 'specReceiverName',
        ellipsis: true,
        onHeaderCell: () => ({ style: { whiteSpace: 'nowrap' } }),
      },
      ...RECEIVER_ALIAS_COLUMN,
      {
        title: '项目名称',
        dataIndex: 'namespace',
        key: 'namespace',
        ellipsis: true,
        onHeaderCell: () => ({ style: { whiteSpace: 'nowrap' } }),
      },
      {
        title: 'Webhook URL',
        dataIndex: 'url',
        key: 'url',
        ellipsis: true,
        render: (v: string | undefined) => v?.trim() || '-',
        onHeaderCell: () => ({ style: { whiteSpace: 'nowrap' } }),
      },
      {
        title: '钉钉机器人账号',
        dataIndex: 'robotAccount',
        key: 'robotAccount',
        ellipsis: true,
        onHeaderCell: () => ({ style: { whiteSpace: 'nowrap' } }),
      },
      {
        title: '钉钉机器人地址',
        dataIndex: 'robotUrl',
        key: 'robotUrl',
        ellipsis: true,
        render: (v: string | undefined) => v?.trim() || '-',
        onHeaderCell: () => ({ style: { whiteSpace: 'nowrap' } }),
      },
      {
        title: '发送恢复通知',
        dataIndex: 'sendResolved',
        key: 'sendResolved',
        render: (v: boolean | undefined) => (v === true ? <Tag color="blue">是</Tag> : <Tag color="warning">否</Tag>),
        onHeaderCell: () => ({ style: { whiteSpace: 'nowrap' } }),
      },
      { title: '创建时间', dataIndex: 'createdAt', key: 'createdAt', ellipsis: true, onHeaderCell: () => ({ style: { whiteSpace: 'nowrap' } }), render: (v: string | undefined) => (v ? (v.replace('T', ' ').replace(/\.\d{3}Z?$/, '') || v) : '-') },
      { title: '操作', key: 'action', fixed: 'right', render: renderAction },
    ],
    [renderAction]
  );

  const renderWebsiteAction = useCallback(
    (_: unknown, record: ReceiverItem) => (
      <ResourceActionsDropdown
        items={[
          { key: 'detail', label: '详情', onClick: () => handleDetail(record) },
          { key: 'edit', label: '编辑', disabled: !canWriteReceivers, onClick: () => handleEdit(record, receiverRows) },
          { type: 'divider' as const },
          { key: 'delete', label: '删除', danger: true, disabled: !canWriteReceivers, onClick: () => handleDelete(record) },
        ]}
      />
    ),
    [handleDetail, handleEdit, handleDelete, receiverRows, canWriteReceivers]
  );

  const websiteColumns: ColumnsType<ReceiverItem> = useMemo(
    () => [
      {
        title: '通知方式',
        dataIndex: 'receiverType',
        key: 'receiverType',
        fixed: 'left',
        onHeaderCell: () => ({ style: { whiteSpace: 'nowrap' } }),
        render: (_: unknown, r: ReceiverItem) => RECEIVER_TYPE_LABELS[r.receiverType ?? ''] ?? r.receiverType ?? '-',
      },
      ...RECEIVER_ALIAS_COLUMN,
      {
        title: '项目名称',
        dataIndex: 'namespace',
        key: 'namespace',
        ellipsis: true,
        onHeaderCell: () => ({ style: { whiteSpace: 'nowrap' } }),
      },
      {
        title: '已开通',
        key: 'opened',
        onHeaderCell: () => ({ style: { whiteSpace: 'nowrap' } }),
        render: () => <Tag color="green">已开通</Tag>,
      },
      { title: '操作', key: 'action', fixed: 'right', render: renderWebsiteAction },
    ],
    [renderWebsiteAction]
  );

  // 根据通知方式选择对应的列定义
  const allColumns = useMemo(() => {
    return receiverTypeFilter === DINGTALK_RECEIVER
      ? dingtalkColumns
      : receiverTypeFilter === WEBSITE_RECEIVER
        ? websiteColumns
        : emailColumns;
  }, [receiverTypeFilter, emailColumns, dingtalkColumns, websiteColumns]);

  // 列显示设置（根据通知方式使用不同的 settingsKey）
  const settingsKey = `monitoring_alert_notification_targets_${receiverTypeFilter}`;
  const { displayColumns: columns } = useTableColumnSettings(allColumns, settingsKey);

  if (!canReadReceivers) {
    return (
      <PageDetailSection asCard={false}>
        <Typography.Text type="secondary">无权查看告警通知对象，请联系管理员分配 `clouds.alert-receivers:read` 权限。</Typography.Text>
      </PageDetailSection>
    );
  }

  return (
    <div>
      <PageDetailSection
        asCard={true}
        toolbarLeft={
          <>
            <Tag.CheckableTag checked style={SECTION_TITLE_TAG_STYLE}>
              通知对象
            </Tag.CheckableTag>
            <Input 
              allowClear 
              placeholder="名称/标识" 
              suffix={<SearchOutlined style={{ color: 'rgba(0,0,0,.45)' }} />}
              value={keyword || ''} 
              onChange={(e) => setKeyword(e.target.value)} 
              className="toolbar-search"
            />
            <Select
              placeholder="通知方式"
              value={receiverTypeFilter}
              onChange={(v) => setReceiverTypeFilter(v ?? EMAIL_RECEIVER)}
              options={RECEIVER_TYPE_SELECT_OPTIONS}
              className="toolbar-filter-sm"
            />
            <Select
              placeholder="项目"
              allowClear
              value={configNsFilter ?? MONITORING_NAMESPACE_FILTER_ALL}
              onChange={(v) => setConfigNsFilter(v === MONITORING_NAMESPACE_FILTER_ALL ? MONITORING_NAMESPACE_FILTER_ALL : v)}
              loading={namespaceLoading}
              options={formNamespaceOptions}
              className="toolbar-filter-sm" 
              style={{ minWidth: 300 }}
            />
          </>
        }
        toolbarRight={
          <>
            <Button
              type="primary"
              icon={<PlusOutlined />}
              disabled={!canWriteReceivers}
              onClick={() => {
                if (receiverTypeFilter === EMAIL_RECEIVER) handleOpenAddEmailModal();
                else if (receiverTypeFilter === DINGTALK_RECEIVER) handleOpenAddDingtalkModal();
                else if (receiverTypeFilter === WEBSITE_RECEIVER) handleOpenAddWebsiteModal();
              }}
            >
              {receiverTypeFilter === EMAIL_RECEIVER
                ? '新增邮件通知对象'
                : receiverTypeFilter === DINGTALK_RECEIVER
                  ? '新增钉钉通知对象'
                  : '开通站内信'}
            </Button>
            <TableColumnSettingsButton allColumns={allColumns} settingsKey={settingsKey} />
            <Button icon={<RefreshIcon />} loading={loading} onClick={() => loadReceivers()} />
          </>
        }
      >
        <Table<ReceiverItem>
          className="std-table"
          bordered={false}
          rowKey={(record) => record.key}
          loading={loading}
          columns={columns}
          dataSource={filteredReceivers}
          scroll={{ x: true }}
          pagination={false}
          locale={{ emptyText: '暂无数据' }}
        />

      <Modal
        title="详情"
        open={!!detailRecord}
        onCancel={() => setDetailRecord(null)}
        footer={null}
        width={560}
      >
        {detailRecord && (
          <Descriptions column={1} size="small" bordered>
            <Descriptions.Item label="通知方式">
              {RECEIVER_TYPE_LABELS[detailRecord.receiverType ?? ''] ?? detailRecord.receiverType ?? '-'}
            </Descriptions.Item>
            <Descriptions.Item label="项目">{detailRecord.namespace ?? '-'}</Descriptions.Item>
            <Descriptions.Item label="通知对象标识">{detailRecord.specReceiverName ?? '-'}</Descriptions.Item>
            <Descriptions.Item label="通知对象名称">{detailRecord.alias?.trim() || '-'}</Descriptions.Item>
            <Descriptions.Item label="通知对象描述">{detailRecord.description?.trim() || '-'}</Descriptions.Item>
            {detailRecord.receiverType === EMAIL_RECEIVER && ( // 邮件通知对象
              <>
                <Descriptions.Item label="发件人">{detailRecord.emailFrom ?? '-'}</Descriptions.Item>
                <Descriptions.Item label="收件人">{detailRecord.emailTo ?? '-'}</Descriptions.Item>
                <Descriptions.Item label="是否发送恢复通知">{detailRecord.sendResolved === true ? '是' : '否'}</Descriptions.Item>
                <Descriptions.Item label="邮件服务器(SMTP)">{detailRecord.smtpHost ?? '-'}</Descriptions.Item>
                <Descriptions.Item label="SMTP是否TLS">{detailRecord.smtpRequireTls === true ? '是' : '否'}</Descriptions.Item>
                <Descriptions.Item label="SMTP授权账号">{detailRecord.smtpAuthUsername ?? '-'}</Descriptions.Item>
                <Descriptions.Item label="SMTP授权账号密钥(Secret)">{detailRecord.smtpAuthPassword?.name ?? '-'}</Descriptions.Item>
              </>
            )}
            {detailRecord.receiverType === DINGTALK_RECEIVER && ( // 钉钉通知对象
              <>
                <Descriptions.Item label="Webhook URL">{detailRecord.url ?? '-'}</Descriptions.Item>
                <Descriptions.Item label="钉钉机器人账号">{detailRecord.robotAccount ?? '-'}</Descriptions.Item>
                <Descriptions.Item label="钉钉机器人地址">{detailRecord.robotUrl ?? '-'}</Descriptions.Item>
                <Descriptions.Item label="钉钉机器人访问令牌">{detailRecord.robotAccessToken ? '***' : '-'}</Descriptions.Item>
                <Descriptions.Item label="发送恢复通知">{detailRecord.sendResolved === true ? '是' : '否'}</Descriptions.Item>
              </>
            )}
            {detailRecord.receiverType === WEBSITE_RECEIVER && (
              <Descriptions.Item label="说明">本站站内信通知对象，无额外配置</Descriptions.Item>
            )}
            <Descriptions.Item label="创建时间">
              {detailRecord.createdAt ? String(detailRecord.createdAt).replace('T', ' ').replace(/\.\d{3}Z?$/, '') : '-'}
            </Descriptions.Item>
          </Descriptions>
        )}
      </Modal>

      <Modal
        title={editingRecord ? '编辑邮件通知对象' : '新增邮件通知对象'}
        open={addEmailModalOpen}
        onCancel={handleCloseAddEmailModal}
        destroyOnHidden
        width={800}
        footer={[
          <Button key="cancel" onClick={handleCloseAddEmailModal}>取消</Button>,
          <Button key="submit" type="primary" loading={addEmailFormLoading} onClick={() => handleAddEmailSubmit()}>确定</Button>,
        ]}
      >
        <Form
          form={addEmailForm}
          layout="vertical"
          initialValues={{
            namespace: selectedNamespace,
            specReceiverName: '',
            alias: '',
            description: '',
            emailConfigs: [{ ...EMPTY_EMAIL_CONFIG }],
          }}
        >
          <Row gutter={24}>
            <Col span={10} style={{ minWidth: 280 }}>
              <Form.Item name="namespace" label="项目" rules={[{ required: true, message: '请选择项目' }]}>
                <Select
                  placeholder="项目"
                  allowClear
                  options={formNamespaceOptionsForForm}
                  loading={namespaceLoading}
                  style={{ width: '100%' }}
                  disabled={!!editingRecord}
                  onChange={(ns) => {
                    if (ns != null && ns !== '') loadEmailModalSecrets(String(ns));
                    else setEmailModalSecrets([]);
                    // 项目变更后密钥列表变化，清空所有邮箱配置的「密钥标识」「密钥Key」
                    const configs = addEmailForm.getFieldValue('emailConfigs') ?? [];
                    if (Array.isArray(configs) && configs.length > 0) {
                      addEmailForm.setFieldValue(
                        'emailConfigs',
                        configs.map((c: any) => ({ ...c, authIdentity: '', authSecretKey: '' }))
                      );
                    }
                  }}
                />
              </Form.Item>
            </Col>
          <Col span={14}>
            <Form.Item name="specReceiverName" label="通知对象标识" rules={[{ required: true, message: '请输入通知对象标识' }]}>
              <Input placeholder="如：ops-email、storage-email 等" disabled={!!editingRecord} />
            </Form.Item>
          </Col>
        </Row>
          <Row gutter={24}>
            <Col span={12}>
              <Form.Item name="alias" label="通知对象名称">
                <Input placeholder="便于识别的展示名称（可选）" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="description" label="通知对象描述">
                <Input.TextArea placeholder="用途说明（可选）" rows={2} />
              </Form.Item>
            </Col>
          </Row>
          {Array.from({ length: emailConfigCount }).map((_, index) => (
            <div key={`email-${index}`} style={{ marginBottom: 16, padding: 12, background: '#fafafa', borderRadius: 8 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <span style={{ fontSize: 13, fontWeight: 500 }}>邮箱 {index + 1}</span>
                {emailConfigCount > 1 && <Button type="link" danger size="small" icon={<DeleteOutlined />} onClick={() => handleRemoveEmailConfigRow(index)}>删除</Button>}
              </div>
              <Form.Item name={['emailConfigs', index, 'emailFrom']} label="发件人" rules={[{ required: true, message: '请输入发件人邮箱' }]}>
                <Input placeholder="发件人邮箱" />
              </Form.Item>
              <Form.Item name={['emailConfigs', index, 'emailTo']} label="收件人" rules={[{ required: true, message: '请输入收件人邮箱' }]}>
                <Input placeholder="收件人邮箱，多个用逗号隔开" />
              </Form.Item>
              <Form.Item name={['emailConfigs', index, 'sendResolved']} valuePropName="checked" label="是否发送恢复通知">
                <Switch checkedChildren="是" unCheckedChildren="否" />
              </Form.Item>
              <Form.Item name={['emailConfigs', index, 'smarthost']} label="邮件服务器(SMTP)" rules={[{ required: true, message: '请输入 SMTP 服务器' }]}>
                <Input placeholder="smtp.example.com:587" />
              </Form.Item>
              <Form.Item name={['emailConfigs', index, 'requireTls']} valuePropName="checked" label="SMTP是否TLS">
                <Switch checkedChildren="是" unCheckedChildren="否" />
              </Form.Item>
              <Form.Item name={['emailConfigs', index, 'authUsername']} label="SMTP授权账号">
                <Input placeholder="可选" />
              </Form.Item>
              <Form.Item label="SMTP授权账号密钥(Secret)">
                <Row gutter={16}>
                  <Col span={12}>
                    <Form.Item name={['emailConfigs', index, 'authIdentity']} noStyle>
                      <Select
                        placeholder="密钥标识"
                        allowClear
                        loading={loadingEmailModalSecrets}
                        options={emailModalSecrets.map((s) => ({ value: s.name, label: s.name }))}
                        onChange={() => {
                          addEmailForm.setFieldValue(['emailConfigs', index, 'authSecretKey'], '');
                        }}
                        style={{ width: '100%' }}
                      />
                    </Form.Item>
                  </Col>
                  <Col span={12}>
                    <Form.Item name={['emailConfigs', index, 'authSecretKey']} noStyle>
                      <Select
                        placeholder="密钥Key"
                        allowClear
                        options={(() => {
                          const selectedSecretName = watchedEmailConfigs[index]?.authIdentity;
                          const selectedSecret = emailModalSecrets.find((s) => s.name === selectedSecretName);
                          if (!selectedSecret?.data || typeof selectedSecret.data !== 'object') return [];
                          return Object.keys(selectedSecret.data).map((k) => ({ value: k, label: k }));
                        })()}
                        style={{ width: '100%' }}
                        disabled={!watchedEmailConfigs[index]?.authIdentity}
                      />
                    </Form.Item>
                  </Col>
                </Row>
              </Form.Item>
            </div>
          ))}
          <Button type="dashed" onClick={handleAddEmailConfigRow} block icon={<PlusOutlined />}>添加邮箱</Button>
        </Form>
      </Modal>

      <Modal
        title={editingRecord ? '编辑钉钉通知对象' : '新增钉钉通知对象'}
        open={addDingtalkModalOpen}
        onCancel={handleCloseAddDingtalkModal}
        destroyOnHidden
        width={800}
        footer={[
          <Button key="cancel" onClick={handleCloseAddDingtalkModal}>取消</Button>,
          <Button key="submit" type="primary" loading={addDingtalkFormLoading} onClick={() => handleAddDingtalkSubmit()}>确定</Button>,
        ]}
      >
        <Form
          form={addDingtalkForm}
          layout="vertical"
          initialValues={{
            namespace: selectedNamespace,
            specReceiverName: '',
            alias: '',
            description: '',
            webhookConfigs: [{ url: '', robotAccount: '', robotUrl: '', robotAccessToken: '', sendResolved: true }],
          }}
        >
          <Row gutter={24}>
            <Col span={10}>
            <Form.Item name="namespace" label="项目" rules={[{ required: true, message: '请选择项目' }]}>
              <Select
                placeholder="项目"
                allowClear={!editingRecord}
                disabled={!!editingRecord}
                loading={namespaceLoading}
                options={formNamespaceOptionsForForm}
                style={{ minWidth: '100%' }}
            />
            </Form.Item>
            </Col>
          <Col span={14}>
            <Form.Item name="specReceiverName" label="通知对象标识" rules={[{ required: true, message: '请输入通知对象标识' }]}>
              <Input placeholder="ops-dingtalk、storage-dingtalk 等" disabled={!!editingRecord} />
            </Form.Item>
          </Col>
        </Row>
          <Row gutter={24}>
            <Col span={12}>
              <Form.Item name="alias" label="通知对象名称">
                <Input placeholder="便于识别的展示名称（可选）" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="description" label="通知对象描述">
                <Input.TextArea placeholder="用途说明（可选）" rows={2} />
              </Form.Item>
            </Col>
          </Row>
          {Array.from({ length: dingtalkConfigCount }).map((_, index) => (
            <div key={`dingtalk-${index}`} style={{ marginBottom: 16, padding: 12, background: '#e6f4ff', borderRadius: 8 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <span style={{ fontSize: 13, fontWeight: 500 }}>钉钉Webhook地址 {index + 1}</span>
                {dingtalkConfigCount > 1 && <Button type="link" danger size="small" icon={<DeleteOutlined />} onClick={() => handleRemoveDingtalkConfigRow(index)}>删除</Button>}
              </div>
              <Form.Item name={['webhookConfigs', index, 'robotUrl']} label="钉钉机器人地址" rules={[{ required: true, message: '请输入钉钉机器人地址' }]}>
                <Input placeholder="https://oapi.dingtalk.com/robot/send" />
              </Form.Item>
              <Form.Item name={['webhookConfigs', index, 'robotAccessToken']} label="钉钉机器人访问令牌" rules={[{ required: true, message: '请输入访问令牌' }]}>
                <Input.Password placeholder="你的钉钉机器人访问令牌" autoComplete="off" />
              </Form.Item>
              <Form.Item name={['webhookConfigs', index, 'sendResolved']} label="是否发送恢复通知" valuePropName="checked">
                <Switch checkedChildren="是" unCheckedChildren="否" />
              </Form.Item>
            </div>
          ))}
          </Form>
      </Modal>
      {/* 开通/编辑站内信 Modal */}
      <Modal
        title={editingRecord?.receiverType === WEBSITE_RECEIVER ? '编辑站内信' : '开通站内信'}
        open={addWebsiteModalOpen}
        onCancel={handleCloseAddWebsiteModal}
        destroyOnHidden
        width={520}
        footer={[
          <Button key="cancel" onClick={handleCloseAddWebsiteModal}>取消</Button>,
          <Button key="submit" type="primary" loading={addWebsiteFormLoading} onClick={() => handleAddWebsiteSubmit()}>
            {editingRecord?.receiverType === WEBSITE_RECEIVER ? '确定' : '开通'}
          </Button>,
        ]}
      >
        <Form
          form={addWebsiteForm}
          layout="vertical"
          initialValues={{
            namespace: selectedNamespace ? [selectedNamespace] : [],
            receiverName: WEBSITE_RECEIVER,
            alias: '',
            description: '',
          }}
        >
          <Row gutter={24}>
            <Col span={12}>
              <Form.Item name="receiverName" label="通知方式" rules={[{ required: true }]}>
                <Select
                  options={[{ value: WEBSITE_RECEIVER, label: '本站站内信' }]}
                  disabled
                  style={{ minWidth: '100%' }}
                />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="namespace" label="项目名称" rules={[{ required: true, type: 'array', min: 1, message: '请至少选择一个项目' }]}>
                <Select
                  mode={editingRecord?.receiverType === WEBSITE_RECEIVER ? undefined : 'multiple'}
                  placeholder="请选择项目（可多选）"
                  allowClear={!editingRecord}
                  disabled={!!editingRecord}
                  options={formNamespaceOptionsForForm}
                  loading={namespaceLoading}
                  style={{ minWidth: '100%' }}
                />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={24}>
            <Col span={12}>
              <Form.Item name="alias" label="通知对象名称">
                <Input placeholder="便于识别的展示名称（可选）" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="description" label="通知对象描述">
                <Input.TextArea placeholder="用途说明（可选）" rows={2} />
              </Form.Item>
            </Col>
          </Row>
        </Form>
      </Modal>
    </PageDetailSection>
    </div>
  );
};

export default MonitoringAlertNotificationTargets;