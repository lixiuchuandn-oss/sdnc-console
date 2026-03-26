  /**
   * 告警通知对象
   * 按命名空间搜索，展示该命名空间下 receivers 列表（后端返回新结构：通知方式标识/名称、邮件SMTP、是否发送恢复邮件等）
   */
  import React, { useCallback, useEffect, useMemo, useState } from 'react';
  import { Button, Checkbox, Col, Descriptions, Dropdown, Form, Input, message, Modal, Row, Select, Space, Switch, Table, Tag, Typography } from 'antd';
  import { DeleteOutlined, DingtalkOutlined, MailOutlined, PlusOutlined, ReloadOutlined as RefreshIcon, SearchOutlined } from '@ant-design/icons';
  import type { ColumnsType, ColumnType } from 'antd/es/table';
  import { useAuth } from '../../../../contexts/AuthContext';
  import PageDetailSection from '../../../../components/PageDetailSection';
  import TableColumnSettingsButton from '../../../../components/TableColumnSettingsButton';
  import { useTableColumnSettings } from '../../../../hooks/useTableColumnSettings';
  import {
    useMonitoring,
    ALERTMANAGERCONFIG_KIND,
    EMAIL_RECEIVER,
    DINGTALK_RECEIVER,
    WEBSITE_RECEIVER,
    MONITORING_API_VERSION,
  } from './context/MonitoringContext';
  import ResourceActionsDropdown from '../../../../components/ResourceActionsDropdown';
  import {
    checkReceiverNameExists,
    deleteAlertmanagerconfig,
    deleteAlertmanagerconfigReceiver,
    fetchAlertPolicyReceivers,
    fetchAllowedNamespaces,
    fetchAlertmanagerconfigs,
    fetchAlertmanagerconfigDetail,
    fetchNotificationTargetsList,
    fetchSecrets,
    postAlertmanagerconfigReceivers,
    type NotificationTargetReceiver,
    type OpaqueSecretItem,
  } from '../../../../services/monitoringApi';
  import {
    buildReceiverSpec,
    fetchDingtalkWebhookConfig,
    normalizeDingtalkReceiverSpec,
    type ReceiverName,
    type ReceiverSpec,
  } from './utils/receivers';
  import { hasPermissionForAction } from '../../../../utils/accessMapping';

  type ReceiverSpecItem = NotificationTargetReceiver;
  type ReceiverItem = {
    key: string;
    receiverName: string;
    namespace?: string;
    specReceiverName: string;
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
    /** 创建人、创建时间（后端返回） */
    creator?: string;
    createdAt?: string;
  };

  interface Props {
    cloudId: string;
  }
  /** 通知方式列表，请求告警通知对象列表时传入 */
  const receiverNames = [EMAIL_RECEIVER, DINGTALK_RECEIVER, WEBSITE_RECEIVER] as const;

  /** receiverName 值 -> 展示文案（用于表格、详情等） */
  const RECEIVER_NAME_LABELS: Record<string, string> = {
    [EMAIL_RECEIVER]: '邮件',       // 'email-receiver' -> '邮件'
    [DINGTALK_RECEIVER]: '钉钉',   // 'dingtalk-receiver' -> '钉钉'
    [WEBSITE_RECEIVER]: '站内信',    // 'website-receiver' -> '站内信'
  };
  const RECEIVER_NAME_SELECT_OPTIONS = Object.entries(RECEIVER_NAME_LABELS).map(([value, label]) => ({ value, label }));

const EMAIL_COLUMN_KEYS = ['receiverName', 'specReceiverName', 'namespace', 'creator', 'createdAt', 'smtpHost', 'smtpRequireTls', 'smtpAuthUsername', 'smtpAuthPassword', 'emailFrom', 'emailTo', 'sendResolved', 'action'] as const;
const DINGTALK_COLUMN_KEYS = ['receiverName', 'specReceiverName', 'namespace', 'creator', 'createdAt', 'url', 'robotAccount', 'robotUrl', 'robotAccessToken', 'sendResolved', 'action'] as const;
const WEBSITE_COLUMN_KEYS = ['receiverName', 'namespace', 'opened', 'action'] as const;

  const COLUMN_TITLES: Record<string, string> = {
    receiverName: '通知方式',
    namespace: '命名空间',
    specReceiverName: '通知对象名称',
    opened: '已开通',
    creator: '创建人',
    createdAt: '创建时间',
    smtpHost: '邮件服务器(SMTP)',
    smtpRequireTls: 'SMTP是否TLS',
    smtpAuthUsername: 'SMTP授权账号',
    smtpAuthPassword: 'SMTP授权账号密钥(Secret)',
    emailFrom: '发件人',
    emailTo: '收件人',
    sendResolved: '是否发送恢复通知',
    robotAccount: '钉钉机器人账号',
    robotUrl: '钉钉机器人地址',
    robotAccessToken: '钉钉机器人访问令牌',
    url: 'Webhook URL',
    action: '操作',
  };

const DEFAULT_ADMIN_NAMESPACE = 'cattle-monitoring-system';

  /** 邮件/钉钉分别使用独立 AlertmanagerConfig：metadata.name = email-receiver | dingtalk-receiver */
const EMPTY_EMAIL_CONFIG = { emailTo: '', emailFrom: '', smarthost: '', requireTls: false, authUsername: '', authIdentity: '', authSecretKey: '', sendResolved: true };
const EMPTY_DINGTALK_CONFIG = { url: '', robotAccount: '', robotUrl: '', robotAccessToken: '', sendResolved: true };

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
    const { formNamespaceOptions, namespaceLoading, configNsFilter, setConfigNsFilter, namespaceList, tenantNamespaces } = useMonitoring();

    // 注意：namespaceOptions 和 loadingNs 在 loadNamespaceOptions 中被设置，但当前使用 formNamespaceOptions 和 namespaceLoading（来自 useMonitoring hook）
    // 保留这些变量以保持代码一致性，可能用于未来功能
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const [namespaceOptions, setNamespaceOptions] = useState<{ label: string; value: string }[]>([]);
    const [selectedNamespace, setSelectedNamespace] = useState<string>('');
    const [receiverNameFilter, setReceiverNameFilter] = useState<string>(EMAIL_RECEIVER);
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

    /** 根据 configNsFilter 决定请求的命名空间；钉钉的 robotUrl/robotAccessToken 从 dingtalkWebhookConfig（ConfigMap targets）同步读取 */
    const loadReceivers = useCallback(async () => {
      if (!cloudId || !canReadReceivers) return;
      const namespaces =
        configNsFilter != null
          ? [configNsFilter]
          : (isAdmin ? namespaceList : tenantNamespaces);
      if (namespaces.length === 0) {
        setReceiverSpecs([]);
        return;
      }
      setLoading(true);
      const [targetsRes, dingtalkConfigRes] = await Promise.all([
        fetchNotificationTargetsList(cloudId, { namespaces, receiverName: [...receiverNames] }),
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
        if ((r.receiverName ?? '').toString().trim() !== DINGTALK_RECEIVER) return r;
        const ns = (r.namespace ?? '').toString().trim();
        const specReceivers = Array.isArray((r as any).specReceivers)
          ? (r as any).specReceivers.map((s: any) =>
              normalizeDingtalkReceiverSpec(s as ReceiverSpec, ns, (s?.name ?? '').toString().trim(), dingtalkConfig)
            )
          : [];
        return { ...r, specReceivers };
      });
      setReceiverSpecs(receivers);
    }, [cloudId, configNsFilter, isAdmin, namespaceList, tenantNamespaces, canReadReceivers]);

    useEffect(() => {
      if (cloudId && canReadReceivers) loadNamespaceOptions();
    }, [cloudId, loadNamespaceOptions, canReadReceivers]);

    useEffect(() => {
      if (isAdmin && selectedNamespace === '') setSelectedNamespace(DEFAULT_ADMIN_NAMESPACE);
    }, [isAdmin, selectedNamespace]);

    /** 通知方式或命名空间变更时重新加载通知对象列表 */
    useEffect(() => {
      if (cloudId && canReadReceivers) loadReceivers();
    }, [cloudId, configNsFilter, receiverNameFilter, loadReceivers, canReadReceivers]);

    /** 命名空间筛选改为具体命名空间时，同步 selectedNamespace 供「新增」使用 */
    useEffect(() => {
      if (configNsFilter != null) setSelectedNamespace(configNsFilter);
    }, [configNsFilter]);

    /** 按命名空间加载邮件弹窗内 SMTP 密钥列表（monitoring-receiver-secret 标签），命名空间变更时需刷新 */
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

    // 邮件弹窗内命名空间变化时刷新该命名空间下的 Secret 列表
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
        message.warning('请先选择命名空间');
        return;
      }
      setAddEmailModalOpen(true);
      setEmailConfigCount(1);
      addEmailForm.resetFields();
      addEmailForm.setFieldsValue({
        namespace: selectedNamespace,
        receiverName: EMAIL_RECEIVER,
        specReceiverName: '',
        emailConfigs: [{ ...EMPTY_EMAIL_CONFIG }],
      });
    }, [selectedNamespace, addEmailForm, canWriteReceivers]);

    const handleOpenAddDingtalkModal = useCallback(() => {
      if (!canWriteReceivers) {
        message.warning('无权新增通知对象');
        return;
      }
      if (!selectedNamespace) {
        message.warning('请先选择命名空间');
        return;
      }
      setAddDingtalkModalOpen(true);
      setDingtalkConfigCount(1);
      addDingtalkForm.resetFields();
      addDingtalkForm.setFieldsValue({
        namespace: selectedNamespace,
        specReceiverName: '',
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
      addWebsiteForm.resetFields();
    }, [addWebsiteForm]);

    const handleAddWebsiteSubmit = useCallback(async () => {
      const values = await addWebsiteForm.validateFields(['namespace', 'receiverName']).catch(() => null);
      if (!values || !cloudId) return;
      const raw = values.namespace;
      const namespaces = Array.isArray(raw) ? raw.map((n: any) => String(n ?? '').trim()).filter(Boolean) : [selectedNamespace].filter(Boolean).map(String);
      if (namespaces.length === 0) {
        message.warning('请至少选择一个命名空间');
        return;
      }
      setAddWebsiteFormLoading(true);
      try {
        const receiverSpec = buildReceiverSpec(WEBSITE_RECEIVER, WEBSITE_RECEIVER as ReceiverName, {});
        const failed: string[] = [];
        for (const ns of namespaces) {
          const payload = {
            apiVersion: MONITORING_API_VERSION,
            kind: ALERTMANAGERCONFIG_KIND,
            metadata: { name: WEBSITE_RECEIVER, namespace: ns },
            spec: { receivers: [receiverSpec] },
          };
          const { ok, error } = await postAlertmanagerconfigReceivers(cloudId, ns, WEBSITE_RECEIVER, payload);
          if (!ok) failed.push(`${ns}${error ? `: ${error}` : ''}`);
        }
        await loadReceivers();
        handleCloseAddWebsiteModal();
        if (failed.length === 0) {
          message.success(namespaces.length === 1 ? '本站站内信已开通' : `已为 ${namespaces.length} 个命名空间开通站内信`);
        } else if (failed.length < namespaces.length) {
          message.warning(`部分开通成功，失败：${failed.join('；')}`);
        } else {
          message.error(failed.length === 1 ? (failed[0] || '开通失败') : `开通失败：${failed.join('；')}`);
        }
      } finally {
        setAddWebsiteFormLoading(false);
      }
    }, [addWebsiteForm, cloudId, selectedNamespace, loadReceivers, handleCloseAddWebsiteModal]);

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

    const upsertReceiverToAlertmanagerConfig = useCallback(async (args: {
      namespace: string;
      receiverName: string;
      formValues: any;
      setLoading: (v: boolean) => void;
      onSuccess: () => void;
      /** 编辑时传入原 spec.receivers[].name，仅在该条上修改，不新增同名 receiver */
      editingSpecName?: string;
    }) => {
      const { namespace, receiverName, formValues, setLoading, onSuccess, editingSpecName } = args;
      setLoading(true);
      const specReceiverName = (formValues.specReceiverName ?? '').toString().trim() || receiverName;
      const receiverSpec = buildReceiverSpec(specReceiverName, receiverName as ReceiverName, formValues);
      // 通知方式 name 一一对应 AlertmanagerConfig.metadata.name（kind: AlertmanagerConfig）
      const configName = receiverName;
      const isAdding = !editingSpecName || editingSpecName.trim() === '';
      const isRenaming = !isAdding && specReceiverName !== editingSpecName.trim();
      if (isAdding || isRenaming) {
        const { data: checkData, ok: checkOk } = await checkReceiverNameExists(
          cloudId,
          namespace,
          specReceiverName,
          receiverName
        );
        if (checkOk && (checkData as any)?.exists) {
          setLoading(false);
          message.warning('该通知对象名称已存在，请使用其他名称');
          return;
        }
      }
      // email-receiver / dingtalk-receiver：从 receiverSpecs（数据库）构建 payload，不调用 Harvester API
      const isDbReceiver = configName === EMAIL_RECEIVER || configName === DINGTALK_RECEIVER;
      let existingReceivers: any[] = [];
      if (isDbReceiver) {
        const existing = receiverSpecs.find(
          (r) => (r.namespace ?? '').toString().trim() === namespace && ((r as any).receiverName ?? '').toString().trim() === configName
        );
        existingReceivers = Array.isArray((existing as any)?.specReceivers) ? (existing as any).specReceivers : [];
      } else {
        const { data: existingData, ok: fetchOk } = await fetchAlertmanagerconfigDetail(cloudId, namespace, configName);
        if (fetchOk && existingData && typeof (existingData as any)?.spec === 'object') {
          const raw = existingData as any;
          const existing = raw?.data != null && typeof raw.data === 'object' ? raw.data : raw;
          existingReceivers = Array.isArray(existing.spec?.receivers) ? existing.spec.receivers : [];
        }
      }
      const trimName = (r: any) => (r?.name ?? '').toString().trim();
      const nextReceivers =
        editingSpecName != null && editingSpecName !== ''
          ? existingReceivers.map((r: any) => (trimName(r) === editingSpecName ? receiverSpec : r))
          : [...existingReceivers, receiverSpec];
      const payload = { spec: { receivers: nextReceivers } };
      const { ok, error } = await postAlertmanagerconfigReceivers(cloudId, namespace, configName, payload);
      setLoading(false);
      if (ok) {
        message.success(editingSpecName != null ? '通知对象已更新' : '通知对象已添加');
        await loadReceivers();
        onSuccess();
      } else {
        message.error(error || (editingSpecName != null ? '更新通知对象失败' : '添加通知对象失败'));
      }
    }, [cloudId, loadReceivers, receiverSpecs]);

    const handleAddEmailSubmit = useCallback(async () => {
      const fieldsToValidate = ['namespace', 'specReceiverName', 'emailConfigs'];
      const values = await addEmailForm.validateFields(fieldsToValidate).catch(() => null);
      const namespace = (values?.namespace ?? selectedNamespace) ?? '';
      if (!values || !cloudId || !namespace) return;
      await upsertReceiverToAlertmanagerConfig({
        namespace,
        receiverName: EMAIL_RECEIVER,
        formValues: values,
        setLoading: setAddEmailFormLoading,
        onSuccess: handleCloseAddEmailModal,
        editingSpecName: editingRecord?.specReceiverName ?? undefined,
      });
    }, [addEmailForm, cloudId, selectedNamespace, editingRecord, upsertReceiverToAlertmanagerConfig, handleCloseAddEmailModal]);

    const handleAddDingtalkSubmit = useCallback(async () => {
      const fieldsToValidate = ['namespace', 'specReceiverName', 'webhookConfigs'];
      const values = await addDingtalkForm.validateFields(fieldsToValidate).catch(() => null);
      const namespace = (values?.namespace ?? selectedNamespace) ?? '';
      if (!values || !cloudId || !namespace) return;
      await upsertReceiverToAlertmanagerConfig({
        namespace,
        receiverName: DINGTALK_RECEIVER,
        formValues: values,
        setLoading: setAddDingtalkFormLoading,
        onSuccess: handleCloseAddDingtalkModal,
        editingSpecName: editingRecord?.specReceiverName ?? undefined,
      });
    }, [addDingtalkForm, cloudId, selectedNamespace, editingRecord, upsertReceiverToAlertmanagerConfig, handleCloseAddDingtalkModal]);

    const handleDetail = useCallback((record: ReceiverItem) => setDetailRecord(record), []);

    const handleEdit = useCallback(
      (record: ReceiverItem, receiverRows: ReceiverItem[]) => {
        if (!canWriteReceivers) {
          message.warning('无权编辑通知对象');
          return;
        }
        if (!cloudId || !record.namespace || !record.receiverName || !record.specReceiverName) {
          message.warning('无法编辑：缺少命名空间或通知对象信息');
          return;
        }
        setEditingRecord(record);
        if (record.receiverName === EMAIL_RECEIVER) {
          const sameReceiverRows = receiverRows.filter(
            (r) => r.namespace === record.namespace && r.receiverName === record.receiverName && r.specReceiverName === record.specReceiverName
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
            emailConfigs: formConfigs,
          });
          setAddEmailModalOpen(true);
        } else if (record.receiverName === DINGTALK_RECEIVER) {
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
            webhookConfigs: formList,
          });
          setAddDingtalkModalOpen(true);
        } else {
          setEditingRecord(null);
          message.info('暂不支持编辑该类型');
        }
      },
      [cloudId, addEmailForm, addDingtalkForm, canWriteReceivers]
    );
    const handleDelete = useCallback(
      (record: ReceiverItem) => {
        if (!canWriteReceivers) {
          message.warning('无权删除通知对象');
          return;
        }
        if (!record.namespace || !record.receiverName || !record.specReceiverName) {
          message.warning('无法删除：缺少命名空间或通知对象信息');
          return;
        }
        Modal.confirm({
          title: '确定删除该通知对象？',
          content: `将移出通知对象「${record.specReceiverName}」，告警通知策略中若引用了该对象需同步修改。`,
          okText: '确定',
          cancelText: '取消',
          okButtonProps: { danger: true },
          onOk: async () => {
            const rn = record.receiverName;
            if (rn === EMAIL_RECEIVER || rn === DINGTALK_RECEIVER || rn === WEBSITE_RECEIVER) {
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
            }
            const deleteFn =
              rn === WEBSITE_RECEIVER
                ? () => deleteAlertmanagerconfig(cloudId!, record.namespace!, rn!)
                : () => deleteAlertmanagerconfigReceiver(cloudId!, record.namespace!, rn!, record.specReceiverName);
            const { ok, error } = await deleteFn();
            if (ok) {
              message.success('已删除');
              loadReceivers();
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
        const receiverName = (r.receiverName ?? '').toString().trim() || undefined;
        const ns = (r.namespace ?? selectedNamespace) || '';
        const list = Array.isArray((r as any)?.specReceivers) ? (r as any).specReceivers : [];
        if (receiverName === EMAIL_RECEIVER) { // 邮件通知对象
          for (const specReceiver of list) {
            const specReceiverName = (specReceiver?.name ?? '').toString().trim() || '';
            const specEmailConfigs = Array.isArray(specReceiver?.emailConfigs) ? specReceiver.emailConfigs : [];
            const receiverId = specReceiver?.id;
            specEmailConfigs.forEach((c: any, idx: number) => {
              out.push({
                key: `${ns}/${receiverName ?? ''}/${specReceiverName}/${idx}`,
                namespace: ns || undefined,
                receiverName: receiverName,
                specReceiverName: specReceiverName,
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
                creator: specReceiver?.creator,
                createdAt: specReceiver?.createdAt,
              });
            });
            if (specEmailConfigs.length === 0 && specReceiverName) {
              out.push({
                key: `${ns}/${receiverName ?? ''}/${specReceiverName}/0`,
                namespace: ns || undefined,
                receiverName: receiverName,
                specReceiverName: specReceiverName,
                emailReceiverId: receiverId,
                creator: specReceiver?.creator,
                createdAt: specReceiver?.createdAt,
              } as ReceiverItem);
            }
          }
        } else if (receiverName === DINGTALK_RECEIVER) {  // 钉钉通知对象
          for (const specReceiver of list) {
            const specReceiverName = (specReceiver?.name ?? '').toString().trim() || '';
            const receiverId = specReceiver?.id;
            const webhookConfigs = Array.isArray(specReceiver?.webhookConfigs) ? specReceiver.webhookConfigs : [];
            webhookConfigs.forEach((c: any, idx: number) => {
              out.push({
                key: `${ns}/${receiverName ?? ''}/${specReceiverName}/${idx}`,
                namespace: ns || undefined,
                receiverName: receiverName,
                specReceiverName: specReceiverName,
                dingtalkReceiverId: receiverId,
                robotAccount: c?.robotAccount,
                robotUrl: c?.robotUrl,
                url: c?.url,
                robotAccessToken: c?.robotAccessToken,
                sendResolved: c?.sendResolved,
                creator: specReceiver?.creator,
                createdAt: specReceiver?.createdAt,
              });
            });
            if (webhookConfigs.length === 0 && specReceiverName) {
              out.push({
                key: `${ns}/${receiverName ?? ''}/${specReceiverName}/0`,
                namespace: ns || undefined,
                receiverName: receiverName,
                specReceiverName: specReceiverName,
                dingtalkReceiverId: receiverId,
                creator: specReceiver?.creator,
                createdAt: specReceiver?.createdAt,
              } as ReceiverItem);
            }
          }
        } else if (receiverName === WEBSITE_RECEIVER) {
          for (const specReceiver of list) {
            const specReceiverName = (specReceiver?.name ?? '').toString().trim() || WEBSITE_RECEIVER;
            out.push({
              key: `${ns}/${receiverName ?? ''}/${specReceiverName}`,
              namespace: ns || undefined,
              receiverName: receiverName,
              specReceiverName: specReceiverName,
              websiteReceiverId: specReceiver?.id,
              creator: specReceiver?.creator,
              createdAt: specReceiver?.createdAt,
            } as ReceiverItem);
          }
        }
      }
      return out;
    }, [receiverSpecs, selectedNamespace]);

    const filteredReceivers = useMemo(() => {
      let filtered = receiverRows.filter((r) => r.receiverName === receiverNameFilter);
      if (keyword.trim()) {
        const k = keyword.trim().toLowerCase();
        filtered = filtered.filter((r) => {
          const nameMatch = (r.receiverName ?? '').toLowerCase().includes(k);
          const specNameMatch = (r.specReceiverName ?? '').toLowerCase().includes(k);
          const nsMatch = (r.namespace ?? '').toLowerCase().includes(k);
          return nameMatch || specNameMatch || nsMatch;
        });
      }
      return filtered;
    }, [receiverRows, receiverNameFilter, keyword]);

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
          dataIndex: 'receiverName',
          key: 'receiverName',
          width: 90,
          onHeaderCell: () => ({ style: { whiteSpace: 'nowrap' } }),
          render: (_: unknown, r: ReceiverItem) => (
            <Space>
              <MailOutlined style={{ color: '#1890ff' }} />
              {RECEIVER_NAME_LABELS[r.receiverName ?? ''] ?? r.receiverName ?? '-'}
            </Space>
          ),
        },
        {
          title: '通知对象名称',
          dataIndex: 'specReceiverName',
          key: 'specReceiverName',
          width: 140,
          ellipsis: true,
          onHeaderCell: () => ({ style: { whiteSpace: 'nowrap' } }),
        },
        {
          title: '命名空间',
          dataIndex: 'namespace',
          key: 'namespace',
          width: 160,
          ellipsis: true,
          onHeaderCell: () => ({ style: { whiteSpace: 'nowrap' } }),
        },
        { title: '发件人', dataIndex: 'emailFrom', key: 'emailFrom', width: 160, ellipsis: true, onHeaderCell: () => ({ style: { whiteSpace: 'nowrap' } }) },
        { title: '收件人', dataIndex: 'emailTo', key: 'emailTo', width: 160, ellipsis: true, onHeaderCell: () => ({ style: { whiteSpace: 'nowrap' } }) },
        {
          title: '是否发送恢复通知',
          dataIndex: 'sendResolved',
          key: 'sendResolved',
          width: 110,
          render: (v: boolean | undefined) => (v === true ? <Tag color="blue">是</Tag> : <Tag color="warning">否</Tag>),
          onHeaderCell: () => ({ style: { whiteSpace: 'nowrap' } }),
        },
        {
          title: '邮件服务器(SMTP)',
          dataIndex: 'smtpHost',
          key: 'smtpHost',
          width: 180,
          ellipsis: true,
          onHeaderCell: () => ({ style: { whiteSpace: 'nowrap' } }),
        },
        {
          title: 'SMTP是否TLS',
          dataIndex: 'smtpRequireTls',
          key: 'smtpRequireTls',
          width: 100,
          onHeaderCell: () => ({ style: { whiteSpace: 'nowrap' } }),
          render: (v: boolean | undefined) => (v === true ? '是' : '否'),
        },
        {
          title: 'SMTP授权账号',
          dataIndex: 'smtpAuthUsername',
          key: 'smtpAuthUsername',
          width: 120,
          ellipsis: true,
          onHeaderCell: () => ({ style: { whiteSpace: 'nowrap' } }),
        },
        {
          title: 'SMTP授权账号密钥(Secret)',
          dataIndex: ['smtpAuthPassword', 'name'],
          key: 'smtpAuthPassword',
          width: 120,
          ellipsis: true,
          onHeaderCell: () => ({ style: { whiteSpace: 'nowrap' } }),
          render: (v: string | undefined) => v || '-',
        },
        { title: '创建人', dataIndex: 'creator', key: 'creator', width: 100, ellipsis: true, onHeaderCell: () => ({ style: { whiteSpace: 'nowrap' } }), render: (v: string | undefined) => v || '-' },
        { title: '创建时间', dataIndex: 'createdAt', key: 'createdAt', width: 172, ellipsis: true, onHeaderCell: () => ({ style: { whiteSpace: 'nowrap' } }), render: (v: string | undefined) => (v ? (v.replace('T', ' ').replace(/\.\d{3}Z?$/, '') || v) : '-') },
        { title: '操作', key: 'action', width: 80, fixed: 'right', onHeaderCell: () => ({ style: { whiteSpace: 'nowrap' } }), render: renderAction },
      ],
      [renderAction]
    );

    const dingtalkColumns: ColumnsType<ReceiverItem> = useMemo(
      () => [
        {
          title: '通知方式',
          dataIndex: 'receiverName',
          key: 'receiverName',
          width: 90,
          onHeaderCell: () => ({ style: { whiteSpace: 'nowrap' } }),
          render: (_: unknown, r: ReceiverItem) => (
            <Space>
              <DingtalkOutlined style={{ color: '#0089ff' }} />
              {RECEIVER_NAME_LABELS[r.receiverName ?? ''] ?? r.receiverName ?? '-'}
            </Space>
          ),
        },
        {
          title: '通知对象名称',
          dataIndex: 'specReceiverName',
          key: 'specReceiverName',
          width: 140,
          ellipsis: true,
          onHeaderCell: () => ({ style: { whiteSpace: 'nowrap' } }),
        },
        {
          title: '命名空间',
          dataIndex: 'namespace',
          key: 'namespace',
          width: 160,
          ellipsis: true,
          onHeaderCell: () => ({ style: { whiteSpace: 'nowrap' } }),
        },
        {
          title: 'Webhook URL',
          dataIndex: 'url',
          key: 'url',
          width: 260,
          ellipsis: true,
          render: (v: string | undefined) => v?.trim() || '-',
          onHeaderCell: () => ({ style: { whiteSpace: 'nowrap' } }),
        },
        {
          title: '钉钉机器人账号',
          dataIndex: 'robotAccount',
          key: 'robotAccount',
          width: 140,
          ellipsis: true,
          onHeaderCell: () => ({ style: { whiteSpace: 'nowrap' } }),
        },
        {
          title: '钉钉机器人地址',
          dataIndex: 'robotUrl',
          key: 'robotUrl',
          width: 260,
          ellipsis: true,
          render: (v: string | undefined) => v?.trim() || '-',
          onHeaderCell: () => ({ style: { whiteSpace: 'nowrap' } }),
        },
        {
          title: '发送恢复通知',
          dataIndex: 'sendResolved',
          key: 'sendResolved',
          width: 110,
          render: (v: boolean | undefined) => (v === true ? <Tag color="blue">是</Tag> : <Tag color="warning">否</Tag>),
          onHeaderCell: () => ({ style: { whiteSpace: 'nowrap' } }),
        },
        { title: '创建人', dataIndex: 'creator', key: 'creator', width: 100, ellipsis: true, onHeaderCell: () => ({ style: { whiteSpace: 'nowrap' } }), render: (v: string | undefined) => v || '-' },
        { title: '创建时间', dataIndex: 'createdAt', key: 'createdAt', width: 172, ellipsis: true, onHeaderCell: () => ({ style: { whiteSpace: 'nowrap' } }), render: (v: string | undefined) => (v ? (v.replace('T', ' ').replace(/\.\d{3}Z?$/, '') || v) : '-') },
        { title: '操作', key: 'action', width: 80, fixed: 'right', onHeaderCell: () => ({ style: { whiteSpace: 'nowrap' } }), render: renderAction },
      ],
      [renderAction]
    );

    const renderWebsiteAction = useCallback(
      (_: unknown, record: ReceiverItem) => (
        <Button type="link" danger size="small" disabled={!canWriteReceivers} onClick={() => handleDelete(record)}>
          删除
        </Button>
      ),
      [handleDelete, canWriteReceivers]
    );

    const websiteColumns: ColumnsType<ReceiverItem> = useMemo(
      () => [
        {
          title: '通知方式',
          dataIndex: 'receiverName',
          key: 'receiverName',
          width: 90,
          onHeaderCell: () => ({ style: { whiteSpace: 'nowrap' } }),
          render: (_: unknown, r: ReceiverItem) => RECEIVER_NAME_LABELS[r.receiverName ?? ''] ?? r.receiverName ?? '-',
        },
        {
          title: '命名空间',
          dataIndex: 'namespace',
          key: 'namespace',
          width: 160,
          ellipsis: true,
          onHeaderCell: () => ({ style: { whiteSpace: 'nowrap' } }),
        },
        {
          title: '已开通',
          key: 'opened',
          width: 90,
          onHeaderCell: () => ({ style: { whiteSpace: 'nowrap' } }),
          render: () => <Tag color="green">已开通</Tag>,
        },
        { title: '操作', key: 'action', width: 80, fixed: 'right', onHeaderCell: () => ({ style: { whiteSpace: 'nowrap' } }), render: renderWebsiteAction },
      ],
      [renderWebsiteAction]
    );

    // 根据通知方式选择对应的列定义
    const allColumns = useMemo(() => {
      return receiverNameFilter === DINGTALK_RECEIVER
        ? dingtalkColumns
        : receiverNameFilter === WEBSITE_RECEIVER
          ? websiteColumns
          : emailColumns;
    }, [receiverNameFilter, emailColumns, dingtalkColumns, websiteColumns]);

    // 列显示设置（根据通知方式使用不同的 settingsKey）
    const settingsKey = `monitoring_alert_notification_targets_${receiverNameFilter}`;
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
          asCard={false}
          toolbarLeft={
            <>
              <Input 
                allowClear 
                placeholder="名称/ID" 
                suffix={<SearchOutlined style={{ color: 'rgba(0,0,0,.45)' }} />}
                value={keyword || ''} 
                onChange={(e) => setKeyword(e.target.value)} 
                className="toolbar-search"
              />
              <Select
                placeholder="命名空间"
                allowClear
                value={configNsFilter}
                onChange={setConfigNsFilter}
                loading={namespaceLoading}
                options={formNamespaceOptions}
                className="toolbar-filter-sm"
              />
              <Select
                placeholder="通知方式"
                value={receiverNameFilter}
                onChange={(v) => setReceiverNameFilter(v ?? 'email-receiver')}
                options={RECEIVER_NAME_SELECT_OPTIONS}
                className="toolbar-filter-sm"
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
                  if (receiverNameFilter === EMAIL_RECEIVER) handleOpenAddEmailModal();
                  else if (receiverNameFilter === DINGTALK_RECEIVER) handleOpenAddDingtalkModal();
                  else if (receiverNameFilter === WEBSITE_RECEIVER) handleOpenAddWebsiteModal();
                }}
              >
                {receiverNameFilter === EMAIL_RECEIVER
                  ? '新增邮件通知对象'
                  : receiverNameFilter === DINGTALK_RECEIVER
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
            scroll={{ x: 1000 }}
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
                {RECEIVER_NAME_LABELS[detailRecord.receiverName ?? ''] ?? detailRecord.receiverName ?? '-'}
              </Descriptions.Item>
              <Descriptions.Item label="命名空间">{detailRecord.namespace ?? '-'}</Descriptions.Item>
              <Descriptions.Item label="通知对象名称">{detailRecord.specReceiverName ?? '-'}</Descriptions.Item>
              {detailRecord.receiverName === EMAIL_RECEIVER && ( // 邮件通知对象
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
              {detailRecord.receiverName === DINGTALK_RECEIVER && ( // 钉钉通知对象
                <>
                  <Descriptions.Item label="Webhook URL">{detailRecord.url ?? '-'}</Descriptions.Item>
                  <Descriptions.Item label="钉钉机器人账号">{detailRecord.robotAccount ?? '-'}</Descriptions.Item>
                  <Descriptions.Item label="钉钉机器人地址">{detailRecord.robotUrl ?? '-'}</Descriptions.Item>
                  <Descriptions.Item label="钉钉机器人访问令牌">{detailRecord.robotAccessToken ? '***' : '-'}</Descriptions.Item>
                  <Descriptions.Item label="发送恢复通知">{detailRecord.sendResolved === true ? '是' : '否'}</Descriptions.Item>
                </>
              )}
              {detailRecord.receiverName === WEBSITE_RECEIVER && (
                <Descriptions.Item label="说明">本站站内信通知对象，无额外配置</Descriptions.Item>
              )}
              <Descriptions.Item label="创建人">{detailRecord.creator ?? '-'}</Descriptions.Item>
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
              emailConfigs: [{ ...EMPTY_EMAIL_CONFIG }],
            }}
          >
            <Row gutter={24}>
              <Col span={10}>
                <Form.Item name="namespace" label="命名空间" rules={[{ required: true, message: '请选择命名空间' }]}>
                  <Select
                    placeholder="命名空间"
                    allowClear
                    options={formNamespaceOptions}
                    loading={namespaceLoading}
                    style={{ minWidth: '100%' }}
                    disabled={!!editingRecord}
                    onChange={(ns) => {
                      if (ns != null && ns !== '') loadEmailModalSecrets(String(ns));
                      else setEmailModalSecrets([]);
                      // 命名空间变更后密钥列表变化，清空所有邮箱配置的「密钥名称」「密钥Key」
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
              <Form.Item name="specReceiverName" label="通知对象名称" rules={[{ required: true, message: '请输入通知对象名称' }]}>
                <Input placeholder="如：ops-email、storage-email 等" />
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
                          placeholder="密钥名称"
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
              webhookConfigs: [{ url: '', robotAccount: '', robotUrl: '', robotAccessToken: '', sendResolved: true }],
            }}
          >
            <Row gutter={24}>
              <Col span={10}>
              <Form.Item name="namespace" label="命名空间" rules={[{ required: true, message: '请选择命名空间' }]}>
                <Select
                  placeholder="命名空间"
                  allowClear={!editingRecord}
                  disabled={!!editingRecord}
                  loading={namespaceLoading}
                  options={formNamespaceOptions}
                  style={{ minWidth: '100%' }}
              />
              </Form.Item>
              </Col>
            <Col span={14}>
              <Form.Item name="specReceiverName" label="通知对象名称" rules={[{ required: true, message: '请输入通知对象名称' }]}>
                <Input placeholder="ops-dingtalk、storage-dingtalk 等" />
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

        <Modal
          title="开通站内信"
          open={addWebsiteModalOpen}
          onCancel={handleCloseAddWebsiteModal}
          destroyOnHidden
          width={520}
          footer={[
            <Button key="cancel" onClick={handleCloseAddWebsiteModal}>取消</Button>,
            <Button key="submit" type="primary" loading={addWebsiteFormLoading} onClick={() => handleAddWebsiteSubmit()}>开通</Button>,
          ]}
        >
          <Form
            form={addWebsiteForm}
            layout="vertical"
            initialValues={{
              namespace: selectedNamespace ? [selectedNamespace] : [],
              receiverName: WEBSITE_RECEIVER,
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
                <Form.Item name="namespace" label="命名空间" rules={[{ required: true, type: 'array', min: 1, message: '请至少选择一个命名空间' }]}>
                  <Select
                    mode="multiple"
                    placeholder="请选择命名空间（可多选）"
                    allowClear
                    options={formNamespaceOptions}
                    loading={namespaceLoading}
                    style={{ minWidth: '100%' }}
                  />
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
