  /**
   * 告警通知对象
   * 按命名空间搜索，展示该命名空间下 receivers 列表（后端返回新结构：通知方式标识/名称、邮件SMTP、是否发送恢复邮件等）
   */
  import React, { useCallback, useEffect, useMemo, useState } from 'react';
  import { Button, Checkbox, Col, Descriptions, Dropdown, Form, Input, message, Modal, Radio, Row, Select, Space, Switch, Table, Tag, Tooltip } from 'antd';
  import { DeleteOutlined, PlusOutlined, ReloadOutlined as RefreshIcon, SettingOutlined } from '@ant-design/icons';
  import type { ColumnsType, ColumnType } from 'antd/es/table';
  import { useAuth } from '../../../../contexts/AuthContext';
  import PageDetailSection from '../../../../components/PageDetailSection';
  import ResourceActionsDropdown from '../../../../components/ResourceActionsDropdown';
  import {
    deleteAlertmanagerconfigReceiver,
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
    setReceiverTypeAnnotation,
    type ReceiverName,
  } from './utils/receivers';

  type ReceiverSpecItem = NotificationTargetReceiver;
  type ReceiverItem = {
    key: string;
    /** receiver 名称（email-receiver | dingtalk-receiver 或具体条目名） */
    receiverName: string;
    /** 额外字段：来自 AlertmanagerConfig.metadata.namespace */
    namespace?: string;
    specReceiverName: string;
    /** emailConfigs 展开后的单条配置字段（用于表格展示） */
    smtpHost?: string;
    smtpRequireTls?: boolean;
    smtpAuthUsername?: string;
    smtpAuthPassword?: { name: string; key: string };
    emailFrom?: string;
    emailTo?: string;
    sendResolved?: boolean;
    /** dingtalk 展开后的字段（机器人账号与 specReceiverName 一致） */
    webhookUrl?: string;
    dingtalkRobotAccount?: string;
    dingtalkRobotUrl?: string;
  };

  interface Props {
    cloudId: string;
  }
  const EMAIL_RECEIVER = 'email-receiver';
  const DINGTALK_RECEIVER = 'dingtalk-receiver';
  const WEBSITE_RECEIVER = 'website-receiver';
  const ALERTMANAGERCONFIG_API_VERSION = 'monitoring.coreos.com/v1alpha1';
  /** 通知方式列表，请求告警通知对象列表时传入 */
  const receiverNames = [EMAIL_RECEIVER, DINGTALK_RECEIVER, WEBSITE_RECEIVER] as const;

  /** receiverName 值 -> 展示文案（用于表格、详情等） */
  const RECEIVER_NAME_LABELS: Record<string, string> = {
    [EMAIL_RECEIVER]: '邮件',       // 'email-receiver' -> '邮件'
    [DINGTALK_RECEIVER]: '钉钉',   // 'dingtalk-receiver' -> '钉钉'
    [WEBSITE_RECEIVER]: '站内信',    // 'website-receiver' -> '站内信'
  };
  const RECEIVER_NAME_SELECT_OPTIONS = Object.entries(RECEIVER_NAME_LABELS).map(([value, label]) => ({ value, label }));

const EMAIL_COLUMN_KEYS = ['receiverName', 'namespace', 'specReceiverName', 'smtpHost', 'smtpRequireTls', 'smtpAuthUsername', 'smtpAuthPassword', 'emailFrom', 'emailTo', 'sendResolved', 'action'] as const;
const DINGTALK_COLUMN_KEYS = ['receiverName', 'namespace', 'specReceiverName', 'dingtalkRobotAccount', 'dingtalkUrl', 'sendResolved', 'action'] as const;

  const COLUMN_TITLES: Record<string, string> = {
    receiverName: '通知方式',
    namespace: '命名空间',
    specReceiverName: '通知对象名称',
    smtpHost: '邮件服务器(SMTP)',
    smtpRequireTls: 'SMTP是否TLS',
    smtpAuthUsername: 'SMTP授权账号',
    smtpAuthPassword: 'SMTP授权账号密钥(Secret)',
    emailFrom: '发件人',
    emailTo: '收件人',
    sendResolved: '是否发送恢复通知',
    dingtalkRobotAccount: '钉钉机器人账号',
    dingtalkRobotUrl: '钉钉机器人地址',
    action: '操作',
  };
  const getDefaultVisibleKeys = (type: string): string[] => {
    if (type === DINGTALK_RECEIVER) return [...DINGTALK_COLUMN_KEYS];
    return [...EMAIL_COLUMN_KEYS];
  };

const DEFAULT_ADMIN_NAMESPACE = 'cattle-monitoring-system';

  /** 邮件/钉钉分别使用独立 AlertmanagerConfig：metadata.name = email-receiver | dingtalk-receiver */
const EMPTY_EMAIL_CONFIG = { emailTo: '', emailFrom: '', smarthost: '', requireTls: false, authUsername: '', authIdentity: '', authSecretKey: '', sendResolved: true };
const EMPTY_DINGTALK_CONFIG = { webhookUrl: '' };

  const MonitoringAlertNotificationTargets: React.FC<Props> = ({ cloudId }) => {
    const { user } = useAuth();
    const isAdmin = user?.role === 'super_admin' || user?.role === 'leased_lines_admin';

    const [namespaceOptions, setNamespaceOptions] = useState<{ label: string; value: string }[]>([]);
    const [selectedNamespace, setSelectedNamespace] = useState<string>('');
    const [receiverNameFilter, setReceiverNameFilter] = useState<string>(EMAIL_RECEIVER);
    const [loading, setLoading] = useState(false);
    const [receiverSpecs, setReceiverSpecs] = useState<ReceiverSpecItem[]>([]);
    const [loadingNs, setLoadingNs] = useState(false);
    const [visibleColumnKeysByTab, setVisibleColumnKeysByTab] = useState<Record<string, string[]>>(() => ({
      EMAIL_RECEIVER: [...EMAIL_COLUMN_KEYS],
      DINGTALK_RECEIVER: [...DINGTALK_COLUMN_KEYS],
    }));
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
    const [emailModalSecrets, setEmailModalSecrets] = useState<OpaqueSecretItem[]>([]);
    const [loadingEmailModalSecrets, setLoadingEmailModalSecrets] = useState(false);
    const watchedEmailConfigs = Form.useWatch('emailConfigs', addEmailForm) ?? [];
    const watchedEmailFormNamespace = Form.useWatch('namespace', addEmailForm);

    const loadNamespaceOptions = useCallback(async () => {
      if (!cloudId) return;
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
    }, [cloudId, isAdmin]);

    const loadReceivers = useCallback(async () => {
      if (!cloudId || !selectedNamespace) return;
      setLoading(true);
      const { data, ok, error } = await fetchNotificationTargetsList(cloudId, {
        namespaces: [selectedNamespace],
        receiverName: [...receiverNames],
      });
      setLoading(false);
      if (!ok) {
        message.error(error || '加载通知对象失败');
        setReceiverSpecs([]);
        return;
      }
      setReceiverSpecs(data?.receivers && Array.isArray(data.receivers) ? data.receivers : []);
    }, [cloudId, selectedNamespace]);

    useEffect(() => {
      if (cloudId) loadNamespaceOptions();
    }, [cloudId, loadNamespaceOptions]);

    useEffect(() => {
      if (isAdmin && selectedNamespace === '') setSelectedNamespace(DEFAULT_ADMIN_NAMESPACE);
    }, [isAdmin]);

    useEffect(() => {
      if (cloudId && selectedNamespace) loadReceivers();
    }, [cloudId, selectedNamespace, receiverNames, loadReceivers]);

    // 邮件弹窗内命名空间变化时，通过 monitoring secrets 密钥接口（GET /monitoring/secrets）重新加载该命名空间下的 Secret 列表（SMTP 授权密钥）
    useEffect(() => {
      if (!addEmailModalOpen || !cloudId) return;
      const ns = (watchedEmailFormNamespace ?? '').toString().trim();
      if (!ns) {
        setEmailModalSecrets([]);
        return;
      }
      let cancelled = false;
      setLoadingEmailModalSecrets(true);
      fetchSecrets(cloudId, { namespace: ns })
        .then(({ data }) => {
          if (!cancelled) setEmailModalSecrets(Array.isArray(data) ? data : []);
        })
        .finally(() => {
          if (!cancelled) setLoadingEmailModalSecrets(false);
        });
      return () => {
        cancelled = true;
      };
    }, [addEmailModalOpen, cloudId, watchedEmailFormNamespace]);

    const handleOpenAddEmailModal = useCallback(async () => {
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
    }, [selectedNamespace, addEmailForm]);

    const handleOpenAddDingtalkModal = useCallback(() => {
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
        dingtalkList: [{ ...EMPTY_DINGTALK_CONFIG }],
      });
    }, [selectedNamespace, addDingtalkForm]);

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

    const handleAddDingtalkConfigRow = useCallback(() => {
      const current = Array.isArray(addDingtalkForm.getFieldValue('dingtalkList')) ? addDingtalkForm.getFieldValue('dingtalkList') : [];
      addDingtalkForm.setFieldValue('dingtalkList', [...current, { ...EMPTY_DINGTALK_CONFIG }]);
      setDingtalkConfigCount((prev) => prev + 1);
    }, [addDingtalkForm]);

    const handleRemoveDingtalkConfigRow = useCallback((index: number) => {
      const current = Array.isArray(addDingtalkForm.getFieldValue('dingtalkList')) ? addDingtalkForm.getFieldValue('dingtalkList') : [];
      if (current.length <= 1) return;
      addDingtalkForm.setFieldValue('dingtalkList', current.filter((_: unknown, i: number) => i !== index));
      setDingtalkConfigCount((prev) => Math.max(1, prev - 1));
    }, [addDingtalkForm]);

    const upsertReceiverToAlertmanagerConfig = useCallback(async (args: {
      namespace: string;
      receiverName: string;
      formValues: any;
      setLoading: (v: boolean) => void;
      onSuccess: () => void;
      /** 编辑时传入，表示替换该名称的 receiver 而非追加 */
      editingSpecName?: string;
    }) => {
      const { namespace, receiverName, formValues, setLoading, onSuccess, editingSpecName } = args;
      setLoading(true);
      const specReceiverName = (formValues.specReceiverName ?? '').toString().trim() || receiverName;
      const receiverSpec = buildReceiverSpec(specReceiverName, receiverName as ReceiverName, formValues);
      const configName = receiverName;
      const { data: existingData, ok: fetchOk } = await fetchAlertmanagerconfigDetail(cloudId, namespace, configName);
      let payload: Record<string, unknown>;
      if (fetchOk && existingData && typeof (existingData as any)?.spec === 'object') {
        const raw = existingData as any;
        const existing = raw?.data != null && typeof raw.data === 'object' ? raw.data : raw;
        const existingReceivers = Array.isArray(existing.spec?.receivers) ? existing.spec.receivers : [];
        const nextReceivers =
          editingSpecName != null && editingSpecName !== ''
            ? existingReceivers.map((r: any) => ((r?.name ?? '').toString().trim() === editingSpecName ? receiverSpec : r))
            : [...existingReceivers, receiverSpec];
        payload = {
          ...existing,
          apiVersion: existing.apiVersion ?? ALERTMANAGERCONFIG_API_VERSION,
          kind: existing.kind ?? 'AlertmanagerConfig',
          metadata: {
            ...existing.metadata,
            name: configName,
            namespace,
            resourceVersion: existing.metadata?.resourceVersion,
          },
          spec: { receivers: nextReceivers },
        };
      } else {
        payload = {
          apiVersion: ALERTMANAGERCONFIG_API_VERSION,
          kind: 'AlertmanagerConfig',
          metadata: { name: configName, namespace },
          spec: { receivers: [receiverSpec] },
        };
      }
      const { ok, error } = await postAlertmanagerconfigReceivers(cloudId, namespace, configName, payload);
      setLoading(false);
      if (ok) {
        message.success(editingSpecName != null ? '通知对象已更新' : '通知对象已添加');
        onSuccess();
        loadReceivers();
      } else {
        message.error(error || (editingSpecName != null ? '更新通知对象失败' : '添加通知对象失败'));
      }
    }, [cloudId, loadReceivers]);

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
      const fieldsToValidate = ['namespace', 'specReceiverName', 'dingtalkList'];
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
      async (record: ReceiverItem) => {
        if (!cloudId || !record.namespace || !record.receiverName || !record.specReceiverName) {
          message.warning('无法编辑：缺少命名空间或接收器信息');
          return;
        }
        const configName = record.receiverName;
        const { data: rawData, ok } = await fetchAlertmanagerconfigDetail(cloudId, record.namespace, configName);
        if (!ok || !rawData) {
          message.error('获取配置详情失败');
          return;
        }
        const data = (rawData as any)?.data != null && typeof (rawData as any).data === 'object' ? (rawData as any).data : rawData;
        const receivers = Array.isArray((data as any)?.spec?.receivers) ? (data as any).spec.receivers : [];
        const receiverSpec = receivers.find((r: any) => (r?.name ?? '').toString().trim() === record.specReceiverName);
        if (!receiverSpec) {
          message.error('未找到该通知对象配置');
          return;
        }
        setEditingRecord(record);
        if (record.receiverName === EMAIL_RECEIVER) {
          const emailConfigs = Array.isArray(receiverSpec.emailConfigs) ? receiverSpec.emailConfigs : [];
          const formConfigs =
            emailConfigs.length > 0
              ? emailConfigs.map((c: any) => ({
                  emailTo: c?.to ?? '',
                  emailFrom: c?.from ?? '',
                  smarthost: c?.smarthost ?? '',
                  requireTls: c?.requireTLS !== false && c?.requireTls !== false,
                  authUsername: c?.authUsername ?? '',
                  authIdentity: (c?.authPassword && typeof c.authPassword === 'object' ? c.authPassword.name : '') ?? '',
                  authSecretKey: (c?.authPassword && typeof c.authPassword === 'object' ? c.authPassword.key : '') ?? '',
                  sendResolved: c?.sendResolved !== false,
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
          const webhookConfigs = Array.isArray(receiverSpec.webhookConfigs) ? receiverSpec.webhookConfigs : [];
          const formList =
            webhookConfigs.length > 0
              ? webhookConfigs.map((c: any) => ({ webhookUrl: c?.url ?? '' }))
              : [{ ...EMPTY_DINGTALK_CONFIG }];
          setDingtalkConfigCount(formList.length);
          addDingtalkForm.resetFields();
          addDingtalkForm.setFieldsValue({
            namespace: record.namespace,
            specReceiverName: record.specReceiverName,
            dingtalkList: formList,
          });
          setAddDingtalkModalOpen(true);
        } else {
          setEditingRecord(null);
          message.info('暂不支持编辑该类型');
        }
      },
      [cloudId, addEmailForm, addDingtalkForm]
    );
    const handleDelete = useCallback(
      (record: ReceiverItem) => {
        if (!record.namespace || !record.receiverName || !record.specReceiverName) {
          message.warning('无法删除：缺少命名空间或接收器信息');
          return;
        }
        Modal.confirm({
          title: '确定删除该通知对象？',
          content: `将从「${record.specReceiverName}」中移除该接收器配置，告警通知策略中若引用了该对象需同步修改。`,
          okText: '确定',
          cancelText: '取消',
          okButtonProps: { danger: true },
          onOk: async () => {
            const { ok, error } = await deleteAlertmanagerconfigReceiver(
              cloudId!,
              record.namespace!,
              record.receiverName!,
              record.specReceiverName
            );
            if (ok) {
              message.success('已删除');
              loadReceivers();
            } else {
              message.error(error || '删除失败');
            }
          },
        });
      },
      [cloudId, loadReceivers]
    );

    const renderAction = useCallback(
      (_: unknown, record: ReceiverItem) => (
        <ResourceActionsDropdown
          items={[
            { key: 'edit', label: '编辑', onClick: () => handleEdit(record) },
            { key: 'detail', label: '详情', onClick: () => handleDetail(record) },
            { type: 'divider' },
            { key: 'delete', label: '删除', danger: true, onClick: () => handleDelete(record) },
          ]}
        />
      ),
      [handleDetail, handleEdit, handleDelete]
    );

    const emailColumns: ColumnsType<ReceiverItem> = useMemo(
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
          title: '通知对象名称',
          dataIndex: 'specReceiverName',
          key: 'specReceiverName',
          width: 140,
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
          render: (v: boolean | undefined) => (v === true ? '是' : '否'),
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
          render: (_: unknown, r: ReceiverItem) => RECEIVER_NAME_LABELS[r.receiverName ?? ''] ?? r.receiverName ?? '-',
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
          title: '钉钉机器人账号',
          dataIndex: 'specReceiverName',
          key: 'dingtalkRobotAccount',
          width: 140,
          ellipsis: true,
          onHeaderCell: () => ({ style: { whiteSpace: 'nowrap' } }),
          render: (v: string | undefined) => v || '-',
        },
        {
          title: '钉钉机器人地址',
          dataIndex: 'dingtalkRobotUrl',
          key: 'dingtalkRobotUrl',
          width: 260,
          ellipsis: true,
          onHeaderCell: () => ({ style: { whiteSpace: 'nowrap' } }),
        },
        {
          title: '发送恢复通知',
          dataIndex: 'sendResolved',
          key: 'sendResolved',
          width: 110,
          render: (v: boolean | undefined) => (v === true ? '是' : '否'),
          onHeaderCell: () => ({ style: { whiteSpace: 'nowrap' } }),
        },
        { title: '操作', key: 'action', width: 80, fixed: 'right', onHeaderCell: () => ({ style: { whiteSpace: 'nowrap' } }), render: renderAction },
      ],
      [renderAction]
    );

    const receiverRows: ReceiverItem[] = useMemo(() => {
      const out: ReceiverItem[] = [];
      for (const r of receiverSpecs) {
        if (!r) continue;
        const receiverName = (r.receiverName ?? '').toString().trim() || undefined;
        const ns = (r.namespace ?? selectedNamespace) || '';
        if (receiverName === EMAIL_RECEIVER) {
          const specReceiver = r.specReceivers[0];
          const specReceiverName = specReceiver?.name ?? '';
          const specEmailConfigs = specReceiver?.emailConfigs ?? [];
          specEmailConfigs.forEach((c: any, idx: number) => {
            out.push({
              key: `${ns}/${receiverName ?? ''}/${specReceiverName}/${idx}`,
              namespace: ns || undefined,
              receiverName: receiverName,
              specReceiverName: specReceiverName,
              emailTo: c.to,
              emailFrom: c.from,
              smtpHost: c.smarthost,
              smtpRequireTls: c.requireTLS,
              smtpAuthUsername: c.authUsername,
              smtpAuthPassword: {
                name: c.authPassword?.name ?? '',
                key: c.authPassword?.key ?? '',
              },
              sendResolved: c.sendResolved,
            });
          });
        } else if (receiverName === DINGTALK_RECEIVER) {
          const specReceiver = r.specReceivers[0];
          const specReceiverName = specReceiver?.name ?? '';
          const webhookConfigs = specReceiver?.webhookConfigs ?? [];
          webhookConfigs.forEach((c: any, idx: number) => {
            out.push({
              key: `${ns}/${receiverName ?? ''}/${specReceiverName}/${idx}`,
              namespace: ns || undefined,
              receiverName: receiverName,
              specReceiverName: specReceiverName,
              dingtalkRobotAccount: specReceiverName,
              webhookUrl: c.url,
              sendResolved: c.sendResolved,
            });
          });
        }
      }
      return out;
    }, [receiverSpecs, selectedNamespace]);

    const columns = useMemo(() => {
      const base = receiverNameFilter === DINGTALK_RECEIVER ? dingtalkColumns : emailColumns;
      const visible = visibleColumnKeysByTab[receiverNameFilter] ?? getDefaultVisibleKeys(receiverNameFilter);
      return base.filter((col: ColumnType<ReceiverItem>) => visible.includes((col.key ?? '') as string));
    }, [receiverNameFilter, emailColumns, dingtalkColumns, visibleColumnKeysByTab]);

    const filteredReceivers = useMemo(
      () => receiverRows.filter((r) => r.receiverName === receiverNameFilter),
      [receiverRows, receiverNameFilter]
    );

    const currentTypeColumnKeys = useMemo(
      () => (receiverNameFilter === 'dingtalk-receiver' ? [...DINGTALK_COLUMN_KEYS] : [...EMAIL_COLUMN_KEYS]),
      [receiverNameFilter]
    );

    return (
      <div>
        <PageDetailSection
          asCard={false}
          toolbarLeft={
            <>
              <Select
                placeholder="通知方式"
                value={receiverNameFilter}
                onChange={(v) => setReceiverNameFilter(v ?? 'email-receiver')}
                options={RECEIVER_NAME_SELECT_OPTIONS}
                style={{ minWidth: 120 }}
              />
              <Select
                placeholder="命名空间"
                allowClear
                value={selectedNamespace || undefined}
                onChange={(v) => setSelectedNamespace(v ?? '')}
                options={namespaceOptions}
                loading={!isAdmin && loadingNs}
              />
            </>
          }
          toolbarRight={
            <>
              <Button
                type="primary"
                icon={<PlusOutlined />}
                onClick={() => (receiverNameFilter === DINGTALK_RECEIVER ? handleOpenAddDingtalkModal() : handleOpenAddEmailModal())}
              >
                {receiverNameFilter === DINGTALK_RECEIVER ? '新增钉钉通知对象' : '新增邮件通知对象'}
              </Button>
              <Dropdown
                trigger={['click']}
                popupRender={() => (
                  <div style={{ background: 'var(--ant-color-bg-elevated)', borderRadius: 8, boxShadow: 'var(--ant-box-shadow)', padding: 12, minWidth: 180 }}>
                    <div style={{ marginBottom: 8, fontWeight: 500 }}>列显示</div>
                    <Checkbox.Group
                      value={visibleColumnKeysByTab[receiverNameFilter] ?? currentTypeColumnKeys}
                      onChange={(vals) => setVisibleColumnKeysByTab((prev) => ({ ...prev, [receiverNameFilter]: vals as string[] }))}
                      options={currentTypeColumnKeys.map((key) => ({
                        label: COLUMN_TITLES[key] ?? key,
                        value: key,
                      }))}
                      style={{ display: 'flex', flexDirection: 'column', gap: 4 }}
                    />
                  </div>
                )}
              >
                <Button icon={<SettingOutlined />} />
              </Dropdown>
              <Button icon={<RefreshIcon />} loading={loading} onClick={() => loadReceivers()} />
            </>
          }
        >
          <Table<ReceiverItem>
            className="std-table"
            bordered
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
              {detailRecord.receiverName === EMAIL_RECEIVER && (
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
              {detailRecord.receiverName === DINGTALK_RECEIVER && (
                <>
                  <Descriptions.Item label="钉钉机器人账号">{detailRecord.specReceiverName ?? '-'}</Descriptions.Item>
                  <Descriptions.Item label="钉钉机器人地址">{detailRecord.dingtalkRobotUrl ?? detailRecord.webhookUrl ?? '-'}</Descriptions.Item>
                  <Descriptions.Item label="发送恢复通知">{detailRecord.sendResolved === true ? '是' : '否'}</Descriptions.Item>
                </>
              )}
            </Descriptions>
          )}
        </Modal>

        <Modal
          title={editingRecord ? '编辑邮件通知对象' : '新增邮件通知对象'}
          open={addEmailModalOpen}
          onCancel={handleCloseAddEmailModal}
          destroyOnClose
          width={720}
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
            <Form.Item name="specReceiverName" label="通知对象名称" rules={[{ required: true, message: '请输入通知对象名称' }]}>
              <Input placeholder="如：default、my-email 等" disabled={!!editingRecord} />
            </Form.Item>
            <Form.Item name="namespace" label="命名空间" rules={[{ required: true, message: '请选择命名空间' }]}>
              <Select
                placeholder="命名空间"
                allowClear
                options={namespaceOptions}
                loading={!isAdmin && loadingNs}
                style={{ minWidth: '100%' }}
                disabled={!!editingRecord}
              />
            </Form.Item>
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
          destroyOnClose
          width={560}
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
              dingtalkList: [{ webhookUrl: '' }],
            }}
          >
            <Form.Item name="specReceiverName" label="通知对象名称/机器人账号" rules={[{ required: true, message: '请输入通知对象名称/机器人账号' }]}>
              <Input placeholder="如：default、my-dingtalk 等" disabled={!!editingRecord} />
            </Form.Item>
            <Form.Item name="namespace" label="命名空间" rules={[{ required: true, message: '请选择命名空间' }]}>
              <Select
                placeholder="命名空间"
                allowClear
                options={namespaceOptions}
                loading={!isAdmin && loadingNs}
                style={{ minWidth: '100%' }}
                disabled={!!editingRecord}
              />
            </Form.Item>
            {Array.from({ length: dingtalkConfigCount }).map((_, index) => (
              <div key={`dingtalk-${index}`} style={{ marginBottom: 16, padding: 12, background: '#e6f4ff', borderRadius: 8 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                  <span style={{ fontSize: 13, fontWeight: 500 }}>钉钉机器人地址 {index + 1}</span>
                  {dingtalkConfigCount > 1 && <Button type="link" danger size="small" icon={<DeleteOutlined />} onClick={() => handleRemoveDingtalkConfigRow(index)}>删除</Button>}
                </div>
                <Form.Item name={['dingtalkList', index, 'webhookUrl']} label="Webhook 地址" rules={[{ required: true, message: '请输入 Webhook 地址' }]}>
                  <Input placeholder="https://oapi.dingtalk.com/robot/send?access_token=..." />
                </Form.Item>
              </div>
            ))}
            <Button type="dashed" onClick={handleAddDingtalkConfigRow} block icon={<PlusOutlined />}>添加钉钉机器人地址</Button>
          </Form>
        </Modal>
      </PageDetailSection>
      </div>
    );
  };

  export default MonitoringAlertNotificationTargets;
