/**
 * 通知密钥：与后端 /monitoring/secrets 增删改查一致
 * - 查列表：GET /monitoring/secrets?namespace=&datasource= （labelSelector: monitoring-receiver-secret=true）
 * - 查详情：GET /monitoring/secrets/:namespace/:name（编辑时拉取并 Base64 解码填充表单）
 * - 增：POST /monitoring/secrets（metadata.namespace/name + data 键值对 Base64）
 * - 改：PUT /monitoring/secrets/:namespace/:name（data 键值对 Base64）
 * - 删：DELETE /monitoring/secrets/:namespace/:name
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Button, Descriptions, Form, Input, message, Modal, Select, Space, Table, Tag, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { CheckOutlined, CloseOutlined, EditOutlined, PlusOutlined, ReloadOutlined, SearchOutlined } from '@ant-design/icons';
import PageDetailSection from '../../../../../components/PageDetailSection';
import TableColumnSettingsButton from '../../../../../components/TableColumnSettingsButton';
import { useTableColumnSettings } from '../../../../../hooks/useTableColumnSettings';
import ResourceActionsDropdown from '../../../../../components/ResourceActionsDropdown';
import WriteGuard from '../../../../../components/WriteGuard';
import { filterMenuItemsForReadOnly } from '../../../../../utils/rbacUi';
import {
  confirmHighRiskDelete,
  DELETE_RISK_ITEMS,
} from '../shared/lib/highRiskConfirm';
import { MONITORING_DEFAULT_NAMESPACE, MONITORING_NAMESPACE_FILTER_ALL, useMonitoring } from './context/MonitoringContext';
import {
  createSecret,
  deleteSecret,
  fetchSecretDetail,
  fetchSecrets,
  updateSecret,
  type OpaqueSecretItem,
} from '../../../../../services/monitoringApi';
import { useAuth } from '../../../../../contexts/AuthContext';
import { hasPermissionForAction } from '../../../../../utils/accessMapping';

const ALERT_POLICY_ALIAS_ANNOTATION = 'tower.io/alias';
const SECTION_TITLE_TAG_STYLE: React.CSSProperties = {
  padding: '4px 12px',
  fontSize: 14,
  borderRadius: 16,
  cursor: 'default',
  userSelect: 'none',
};

function base64Encode(str: string): string {
  try {
    return btoa(unescape(encodeURIComponent(str)));
  } catch {
    return btoa(str);
  }
}

function base64Decode(str: string): string {
  try {
    return decodeURIComponent(escape(atob(str)));
  } catch {
    return '';
  }
}

interface SecretRow extends OpaqueSecretItem {
  namespace?: string;
  key?: string;
}

interface Props {
  cloudId: string;
}

const MonitoringAlertSecrets: React.FC<Props> = ({ cloudId }) => {
  const { user } = useAuth();
  const perms = useMemo(() => (user?.permissions ?? []) as string[], [user?.permissions]);
  const canReadSecrets = useMemo(
    () => hasPermissionForAction(perms, 'clouds.alert-secrets:read'),
    [perms]
  );
  const canWriteSecrets = useMemo(
    () => hasPermissionForAction(perms, 'clouds.alert-secrets:write'),
    [perms]
  );
  const {
    formNamespaceOptions,
    formNamespaceOptionsForForm,
    namespaceList,
    namespaceLoading,
    configNsFilter,
    setConfigNsFilter,
  } = useMonitoring();

  const [loading, setLoading] = useState(false);
  const [secrets, setSecrets] = useState<SecretRow[]>([]);
  const [namespaceFilter, setNamespaceFilter] = useState<string>(
    configNsFilter != null ? configNsFilter : MONITORING_DEFAULT_NAMESPACE,
  );
  const [keyword, setKeyword] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [modalLoading, setModalLoading] = useState(false);
  const [editingRecord, setEditingRecord] = useState<SecretRow | null>(null);
  const [detailRecord, setDetailRecord] = useState<SecretRow | null>(null);
  const [aliasEditingKey, setAliasEditingKey] = useState<string | null>(null);
  const [aliasDraft, setAliasDraft] = useState('');
  const [aliasSaving, setAliasSaving] = useState(false);
  /** 编辑时从后端拉取的表单初始值，用于 Modal 打开后正确填充（destroyOnHidden 时 setFieldsValue 可能失效） */
  const [editFormInitialValues, setEditFormInitialValues] = useState<{
    namespace: string;
    name: string;
    alias: string;
    dataKey: string;
    dataValue: string;
  } | null>(null);
  const [form] = Form.useForm();

  const loadSecrets = useCallback(async () => {
    if (!cloudId || !canReadSecrets) return;
    const ns = String(namespaceFilter ?? '').trim();
    const namespaces = ns ? [ns] : namespaceList;
    if (namespaces.length === 0) {
      setSecrets([]);
      return;
    }
    setLoading(true);
    const results = await Promise.all(namespaces.map((namespace) => fetchSecrets(cloudId, { namespace })));
    setLoading(false);
    const merged: SecretRow[] = [];
    let firstError = '';
    results.forEach(({ data, ok, error }, idx) => {
      if (!ok) {
        if (!firstError && error) firstError = error;
        return;
      }
      if (!Array.isArray(data)) return;
      const namespace = namespaces[idx] ?? '';
      data.forEach((s) => {
        merged.push({ ...s, namespace, key: s.name });
      });
    });
    setSecrets(merged);
    if (merged.length === 0 && firstError) message.error(firstError);
  }, [cloudId, namespaceFilter, namespaceList, canReadSecrets]);

  useEffect(() => {
    if (cloudId && canReadSecrets) loadSecrets();
  }, [cloudId, loadSecrets, canReadSecrets]);

  useEffect(() => {
    const next =
      namespaceFilter === MONITORING_NAMESPACE_FILTER_ALL ? MONITORING_NAMESPACE_FILTER_ALL : namespaceFilter;
    if (next !== (configNsFilter ?? MONITORING_NAMESPACE_FILTER_ALL)) {
      setConfigNsFilter(next);
    }
  }, [namespaceFilter, configNsFilter, setConfigNsFilter]);

  const handleAdd = useCallback(() => {
    if (!canWriteSecrets) {
      message.warning('无权新增通知密钥');
      return;
    }
    setEditingRecord(null);
    setEditFormInitialValues(null);
    form.resetFields();
    form.setFieldsValue({
      namespace:
        namespaceFilter && namespaceFilter !== MONITORING_NAMESPACE_FILTER_ALL
          ? namespaceFilter
          : (formNamespaceOptionsForForm[0]?.value ?? MONITORING_DEFAULT_NAMESPACE),
      name: '',
      alias: '',
      dataKey: 'password',
      dataValue: '',
    });
    setModalOpen(true);
  }, [form, namespaceFilter, formNamespaceOptionsForForm, canWriteSecrets]);

  const handleEdit = useCallback(
    async (record: SecretRow) => {
      if (!canWriteSecrets) {
        message.warning('无权编辑通知密钥');
        return;
      }
      const ns = record.namespace ?? namespaceFilter;
      const nm = record.name;
      if (!cloudId || !ns || !nm) {
        message.warning('无法编辑：缺少项目或密钥标识');
        return;
      }
      const hideLoading = message.loading('加载密钥详情中...', 0);
      try {
        const { data, ok, error } = await fetchSecretDetail(cloudId, ns, nm);
        if (!ok || !data) {
          message.error(error ?? '获取密钥详情失败');
          return;
        }
        const dataKeys = data.data && typeof data.data === 'object' ? Object.keys(data.data) : [];
        const firstKey = dataKeys[0] ?? 'password';
        const firstVal = data.data?.[firstKey] ? base64Decode(data.data[firstKey]) : '';
        const alias = (data.annotations?.[ALERT_POLICY_ALIAS_ANNOTATION] ?? data.name ?? nm).toString().trim();
        const formValues = {
          namespace: (data.namespace ?? ns).toString().trim(),
          name: (data.name ?? nm).toString().trim(),
          alias,
          dataKey: firstKey,
          dataValue: firstVal,
        };
        setEditingRecord({ ...record, ...data, namespace: data.namespace ?? ns });
        setEditFormInitialValues(formValues);
        form.resetFields();
        form.setFieldsValue(formValues);
        setModalOpen(true);
      } finally {
        hideLoading();
      }
    },
    [cloudId, form, namespaceFilter, canWriteSecrets]
  );

  const handleModalOk = useCallback(async () => {
    if (!canWriteSecrets) {
      message.warning('无权修改通知密钥');
      return;
    }
    const values = await form.validateFields().catch(() => null);
    if (!values || !cloudId) return;
    const { namespace, name, alias, dataKey, dataValue } = values;
    const trimmedName = (name ?? '').toString().trim();
    const aliasInput = (alias ?? '').toString().trim();
    const effectiveAlias = aliasInput || trimmedName;
    const trimmedKey = (dataKey ?? 'password').toString().trim() || 'password';
    if (!trimmedName) {
      message.warning('密钥标识不能为空');
      return;
    }
    if (!(dataValue ?? '').toString().trim()) {
      message.warning('密钥数据值不能为空');
      return;
    }
    const data: Record<string, string> = { [trimmedKey]: base64Encode((dataValue ?? '').toString()) };
    setModalLoading(true);
    try {
      if (editingRecord) {
        const { ok, error } = await updateSecret(cloudId, namespace, editingRecord.name, {
          data,
          metadata: {
            annotations: {
              [ALERT_POLICY_ALIAS_ANNOTATION]: effectiveAlias,
            },
          },
        });
        if (ok) {
          message.success('修改成功');
          setModalOpen(false);
          setEditFormInitialValues(null);
          loadSecrets();
        } else {
          message.error(error ?? '修改失败');
        }
      } else {
        const { ok, error } = await createSecret(cloudId, {
          metadata: {
            namespace,
            name: trimmedName,
            annotations: {
              [ALERT_POLICY_ALIAS_ANNOTATION]: effectiveAlias,
            },
          },
          data,
          type: 'Opaque',
        });
        if (ok) {
          message.success('新增成功');
          setModalOpen(false);
          setEditFormInitialValues(null);
          loadSecrets();
        } else {
          const errText = (error ?? '').toString();
          const isNameConflict =
            errText.includes('资源版本冲突') ||
            errText.toLowerCase().includes('already exists') ||
            errText.toLowerCase().includes('alreadyexists') ||
            errText.includes('已存在');
          if (isNameConflict) {
            message.error(`密钥标识（${trimmedName}）已存在，请更换成其他名称再试`);
          } else {
            message.error(error ?? '新增失败');
          }
        }
      }
    } finally {
      setModalLoading(false);
    }
  }, [cloudId, form, editingRecord, loadSecrets, canWriteSecrets]);

  const filteredSecrets = useMemo(() => {
    if (!keyword.trim()) return secrets;
    const k = keyword.trim().toLowerCase();
    return secrets.filter(
      (row) =>
        (row.name ?? '').toLowerCase().includes(k) ||
        (row.annotations?.[ALERT_POLICY_ALIAS_ANNOTATION] ?? '').toString().toLowerCase().includes(k) ||
        (row.namespace ?? '').toLowerCase().includes(k) ||
        (row.data && typeof row.data === 'object' && Object.keys(row.data).some((key) => key.toLowerCase().includes(k)))
    );
  }, [secrets, keyword]);

  const handleDetail = useCallback((record: SecretRow) => setDetailRecord(record), []);

  const handleStartAliasEdit = useCallback((record: SecretRow) => {
    const key = `${record.namespace ?? ''}-${record.name}`;
    const currentAlias = (record.annotations?.[ALERT_POLICY_ALIAS_ANNOTATION] ?? record.name ?? '').toString();
    setAliasEditingKey(key);
    setAliasDraft(currentAlias);
  }, []);

  const handleCancelAliasEdit = useCallback(() => {
    setAliasEditingKey(null);
    setAliasDraft('');
  }, []);

  const handleSaveAlias = useCallback(
    async (record: SecretRow) => {
      if (!cloudId || !record.namespace || !record.name) {
        message.warning('无法修改密钥名称：缺少项目或密钥标识');
        return;
      }
      const nextAlias = aliasDraft.trim() || record.name;
      setAliasSaving(true);
      try {
        const annotations = {
          ...(record.annotations || {}),
          [ALERT_POLICY_ALIAS_ANNOTATION]: nextAlias,
        };
        const { ok, error } = await updateSecret(cloudId, record.namespace, record.name, {
          data: record.data || {},
          metadata: { annotations },
        });
        if (ok) {
          message.success('密钥名称已更新');
          handleCancelAliasEdit();
          await loadSecrets();
        } else {
          message.error(error ?? '更新密钥名称失败');
        }
      } finally {
        setAliasSaving(false);
      }
    },
    [aliasDraft, cloudId, handleCancelAliasEdit, loadSecrets]
  );

  const handleDelete = useCallback(
    (record: SecretRow) => {
      if (!canWriteSecrets) {
        message.warning('无权删除通知密钥');
        return;
      }
      if (!cloudId || !record.namespace || !record.name) {
        message.warning('无法删除：缺少项目或密钥标识');
        return;
      }
      void confirmHighRiskDelete({
        title: '确定删除该通知密钥？',
        resourceLabel: '通知密钥',
        name: record.name,
        description: `将删除密钥「${record.name}」，告警通知对象中若引用了该密钥需同步修改。`,
        riskItems: DELETE_RISK_ITEMS,
        confirmText: '确定',
        onConfirm: async () => {
          const { ok, error } = await deleteSecret(cloudId, record.namespace!, record.name);
          if (ok) {
            message.success('已删除');
            loadSecrets();
          } else {
            message.error(error ?? '删除失败');
          }
        },
      }).catch(() => {});
    },
    [cloudId, loadSecrets, canWriteSecrets]
  );

  const renderAction = useCallback(
    (_: unknown, record: SecretRow) => (
      <ResourceActionsDropdown
        items={filterMenuItemsForReadOnly(
          [
            { key: 'detail', label: '详情', onClick: () => handleDetail(record) },
            { key: 'edit', label: '编辑', onClick: () => handleEdit(record) },
            { type: 'divider' as const },
            { key: 'delete', label: '删除', danger: true, onClick: () => handleDelete(record) },
          ],
          canWriteSecrets,
        )}
      />
    ),
    [handleEdit, handleDetail, handleDelete, canWriteSecrets]
  );

  const allColumns: ColumnsType<SecretRow> = [
    {
      title: '密钥名称',
      key: 'alias',
      render: (_, r) => {
        const rowKey = `${r.namespace ?? ''}-${r.name}`;
        if (aliasEditingKey === rowKey) {
          return (
            <Space size={4}>
              <Input
                value={aliasDraft}
                onChange={(e) => setAliasDraft(e.target.value)}
                onPressEnter={() => handleSaveAlias(r)}
                placeholder="请输入密钥名称"
                style={{ width: 220 }}
                disabled={aliasSaving}
              />
              <Button
                type="text"
                icon={<CheckOutlined />}
                onClick={() => handleSaveAlias(r)}
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
        const alias = (r.annotations?.[ALERT_POLICY_ALIAS_ANNOTATION] ?? '').toString().trim();
        const name = (r.name ?? '').toString().trim();
        return (
          <Space size={6}>
            <span
              className="cell-link"
              onClick={() => handleDetail(r)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  handleDetail(r);
                }
              }}
            >
              {alias || name || '-'}
            </span>
            {canWriteSecrets && (
              <Button
                type="text"
                size="small"
                icon={<EditOutlined />}
                onClick={() => handleStartAliasEdit(r)}
              />
            )}
          </Space>
        );
      },
    },
    { title: '密钥标识', dataIndex: 'name', key: 'name', fixed: 'left', ellipsis: true },
    {
      title: '项目',
      dataIndex: 'namespace',
      key: 'namespace',
      render: (v: string | undefined) => v || '-',
    },
    {
      title: '数据键',
      key: 'dataKeys',
      render: (_, r) => (r.data && typeof r.data === 'object' ? Object.keys(r.data).join(', ') : '-'),
    },
    { title: '操作', key: 'action', fixed: 'right', render: renderAction },
  ];

  // 列显示设置（需要在 allColumns 定义之后）
  const { displayColumns: columns } = useTableColumnSettings(allColumns, 'monitoring_alert_secrets_table');

  if (!canReadSecrets) {
    return (
      <PageDetailSection asCard={false}>
        <Typography.Text type="secondary">无权查看通知密钥，请联系管理员分配 `clouds.alert-secrets:read` 权限。</Typography.Text>
      </PageDetailSection>
    );
  }

  return (
    <>
      <PageDetailSection
        asCard={true}
        toolbarLeft={
          <Space wrap>
            <Tag.CheckableTag checked style={SECTION_TITLE_TAG_STYLE}>
              通知密钥
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
              value={namespaceFilter || MONITORING_NAMESPACE_FILTER_ALL}
              onChange={(v) =>
                setNamespaceFilter(
                  v === MONITORING_NAMESPACE_FILTER_ALL ? MONITORING_NAMESPACE_FILTER_ALL : (v ?? MONITORING_DEFAULT_NAMESPACE),
                )
              }
              options={formNamespaceOptions}
              loading={namespaceLoading}
              style={{ minWidth: 300 }}
            />
          </Space>
        }
        toolbarRight={
          <Space>
            <WriteGuard canWrite={canWriteSecrets}>
              <Button type="primary" icon={<PlusOutlined />} onClick={handleAdd}>
                新增密钥
              </Button>
            </WriteGuard>
            <TableColumnSettingsButton allColumns={allColumns} settingsKey="monitoring_alert_secrets_table" />
            <Button icon={<ReloadOutlined />} onClick={loadSecrets} loading={loading} />
          </Space>
        }
      >
        <Table
          className="std-table"
          bordered={false}
          rowKey={(r) => `${r.namespace ?? ''}-${r.name}`}
          loading={loading}
          columns={columns}
          dataSource={filteredSecrets}
          scroll={{ x: true }}
          pagination={{ showSizeChanger: true, showTotal: (t) => `共 ${t} 条`, pageSizeOptions: ['20', '50', '100'] }}
        />
      </PageDetailSection>
      {/* 新增/修改通知密钥 Modal */}
      <Modal
        title={editingRecord ? '修改通知密钥' : '新增通知密钥'}
        open={modalOpen}
        onOk={handleModalOk}
        onCancel={() => {
          setModalOpen(false);
          setEditFormInitialValues(null);
        }}
        okText="确定"
        cancelText="取消"
        confirmLoading={modalLoading}
        destroyOnHidden
        width={480}
      >
        <Form
          form={form}
          layout="vertical"
          preserve={false}
          initialValues={editFormInitialValues ?? undefined}
          key={editFormInitialValues ? `edit-${editFormInitialValues.name}` : 'add'}
        >
          <Form.Item name="namespace" label="项目名称" rules={[{ required: true }]}>
            <Select placeholder="选择项目名称" options={formNamespaceOptionsForForm} disabled={!!editingRecord} />
          </Form.Item>
          <Form.Item
            name="name"
            label="密钥标识"
            extra="密钥标识必须唯一且不可变更，用于在告警通知对象中引用"
            rules={[{ required: true, message: '请输入密钥标识' }]}
          >
            <Input placeholder="请输入密钥标识" disabled={!!editingRecord} />
          </Form.Item>
          <Form.Item
            name="alias"
            label="密钥名称"
            extra="支持输入中文，如运维团队邮件密钥"
          >
            <Input placeholder="请输入密钥名称，如：运维团队通知密钥" maxLength={128} />
          </Form.Item>
          <Form.Item name="dataKey" label="数据键" rules={[{ required: true }]}>
            <Input placeholder="如 password" disabled={!!editingRecord} />
          </Form.Item>
          <Form.Item
            name="dataValue"
            label="数据值"
            rules={[{ required: true, message: '请输入密钥值' }]}
          >
            <Input.Password placeholder="明文输入，将自动 Base64 编码存储" autoComplete="new-password" />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title="通知密钥详情"
        open={!!detailRecord}
        onCancel={() => setDetailRecord(null)}
        footer={null}
        width={480}
      >
        {detailRecord && (
          <Descriptions column={1} bordered size="small">
            <Descriptions.Item label="密钥名称">
              {(detailRecord.annotations?.[ALERT_POLICY_ALIAS_ANNOTATION] ?? detailRecord.name ?? '-').toString()}
            </Descriptions.Item>
            <Descriptions.Item label="密钥标识">{detailRecord.name ?? '-'}</Descriptions.Item>
            <Descriptions.Item label="项目">{detailRecord.namespace ?? '-'}</Descriptions.Item>
            <Descriptions.Item label="数据键">
              {detailRecord.data && typeof detailRecord.data === 'object'
                ? Object.keys(detailRecord.data).join(', ')
                : '-'}
            </Descriptions.Item>
          </Descriptions>
        )}
      </Modal>
    </>
  );
};

export default MonitoringAlertSecrets;