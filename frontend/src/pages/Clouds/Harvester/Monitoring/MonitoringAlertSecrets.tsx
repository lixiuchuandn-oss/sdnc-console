/**
 * 告警密钥：按命名空间、数据源检索 labels 为 monitoring-receiver-secret=true 的 Secrets
 * 支持新增、修改、删除
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Button, Descriptions, Form, Input, message, Modal, Select, Space, Table } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { PlusOutlined, ReloadOutlined } from '@ant-design/icons';
import PageDetailSection from '../../../../components/PageDetailSection';
import ResourceActionsDropdown from '../../../../components/ResourceActionsDropdown';
import { useMonitoring } from './context/MonitoringContext';
import {
  createSecret,
  deleteSecret,
  fetchSecretDetail,
  fetchSecrets,
  updateSecret,
  type OpaqueSecretItem,
} from '../../../../services/monitoringApi';

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
  const { formNamespaceOptions, configNsFilter, setConfigNsFilter } = useMonitoring();

  const [loading, setLoading] = useState(false);
  const [secrets, setSecrets] = useState<SecretRow[]>([]);
  const [namespaceFilter, setNamespaceFilter] = useState<string>(configNsFilter ?? 'cattle-monitoring-system');
  const [dataSourceFilter, setDataSourceFilter] = useState<string>('prometheus');
  const [keyword, setKeyword] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [modalLoading, setModalLoading] = useState(false);
  const [editingRecord, setEditingRecord] = useState<SecretRow | null>(null);
  const [detailRecord, setDetailRecord] = useState<SecretRow | null>(null);
  /** 编辑时从后端拉取的表单初始值，用于 Modal 打开后正确填充（destroyOnHidden 时 setFieldsValue 可能失效） */
  const [editFormInitialValues, setEditFormInitialValues] = useState<{
    namespace: string;
    name: string;
    dataKey: string;
    dataValue: string;
  } | null>(null);
  const [form] = Form.useForm();

  const loadSecrets = useCallback(async () => {
    if (!cloudId || !namespaceFilter) return;
    setLoading(true);
    const { data, ok } = await fetchSecrets(cloudId, {
      namespace: namespaceFilter,
      datasource: dataSourceFilter,
    });
    setLoading(false);
    if (ok && Array.isArray(data)) {
      setSecrets(data.map((s) => ({ ...s, namespace: namespaceFilter, key: s.name })));
    } else {
      setSecrets([]);
    }
  }, [cloudId, namespaceFilter, dataSourceFilter]);

  useEffect(() => {
    if (cloudId && namespaceFilter) loadSecrets();
  }, [cloudId, namespaceFilter, dataSourceFilter, loadSecrets]);

  useEffect(() => {
    if (configNsFilter && namespaceFilter !== configNsFilter) {
      setConfigNsFilter(namespaceFilter);
    }
  }, [namespaceFilter, configNsFilter, setConfigNsFilter]);

  const handleAdd = useCallback(() => {
    setEditingRecord(null);
    setEditFormInitialValues(null);
    form.resetFields();
    form.setFieldsValue({
      namespace: namespaceFilter,
      name: '',
      dataKey: 'password',
      dataValue: '',
    });
    setModalOpen(true);
  }, [form, namespaceFilter]);

  const handleEdit = useCallback(
    async (record: SecretRow) => {
      const ns = record.namespace ?? namespaceFilter;
      const nm = record.name;
      if (!cloudId || !ns || !nm) {
        message.warning('无法编辑：缺少命名空间或密钥名称');
        return;
      }
      const hideLoading = message.loading('加载密钥详情中...', 0);
      try {
        const { data, ok, error } = await fetchSecretDetail(cloudId, ns, nm);
        if (!ok || !data) {
          message.error(error || '获取密钥详情失败');
          return;
        }
        const dataKeys = data.data && typeof data.data === 'object' ? Object.keys(data.data) : [];
        const firstKey = dataKeys[0] ?? 'password';
        const firstVal = data.data?.[firstKey] ? base64Decode(data.data[firstKey]) : '';
        const formValues = {
          namespace: (data.namespace ?? ns).toString().trim(),
          name: (data.name ?? nm).toString().trim(),
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
    [cloudId, form, namespaceFilter]
  );

  const handleModalOk = useCallback(async () => {
    const values = await form.validateFields().catch(() => null);
    if (!values || !cloudId) return;
    const { namespace, name, dataKey, dataValue } = values;
    const trimmedName = (name ?? '').toString().trim();
    const trimmedKey = (dataKey ?? 'password').toString().trim() || 'password';
    if (!trimmedName) {
      message.warning('密钥名称不能为空');
      return;
    }
    if (!(dataValue ?? '').toString().trim()) {
      message.warning('密钥值不能为空');
      return;
    }
    const data: Record<string, string> = { [trimmedKey]: base64Encode((dataValue ?? '').toString()) };
    setModalLoading(true);
    try {
      if (editingRecord) {
        const { ok, error } = await updateSecret(cloudId, namespace, editingRecord.name, { data });
        if (ok) {
          message.success('修改成功');
          setModalOpen(false);
          setEditFormInitialValues(null);
          loadSecrets();
        } else {
          message.error(error || '修改失败');
        }
      } else {
        const { ok, error } = await createSecret(cloudId, {
          metadata: { namespace, name: trimmedName },
          data,
          type: 'Opaque',
        });
        if (ok) {
          message.success('新增成功');
          setModalOpen(false);
          setEditFormInitialValues(null);
          loadSecrets();
        } else {
          message.error(error || '新增失败');
        }
      }
    } finally {
      setModalLoading(false);
    }
  }, [cloudId, form, editingRecord, loadSecrets]);

  const filteredSecrets = useMemo(() => {
    if (!keyword.trim()) return secrets;
    const k = keyword.trim().toLowerCase();
    return secrets.filter(
      (row) =>
        (row.name ?? '').toLowerCase().includes(k) ||
        (row.namespace ?? '').toLowerCase().includes(k) ||
        (row.data && typeof row.data === 'object' && Object.keys(row.data).some((key) => key.toLowerCase().includes(k)))
    );
  }, [secrets, keyword]);

  const handleDetail = useCallback((record: SecretRow) => setDetailRecord(record), []);

  const handleDelete = useCallback(
    (record: SecretRow) => {
      if (!cloudId || !record.namespace || !record.name) {
        message.warning('无法删除：缺少命名空间或密钥名称');
        return;
      }
      Modal.confirm({
        title: '确定删除该告警密钥？',
        content: `将删除密钥「${record.name}」，告警通知对象中若引用了该密钥需同步修改。`,
        okText: '确定',
        cancelText: '取消',
        okButtonProps: { danger: true },
        onOk: async () => {
          const { ok, error } = await deleteSecret(cloudId, record.namespace!, record.name);
          if (ok) {
            message.success('已删除');
            loadSecrets();
          } else {
            message.error(error || '删除失败');
          }
        },
      });
    },
    [cloudId, loadSecrets]
  );

  const renderAction = useCallback(
    (_: unknown, record: SecretRow) => (
      <ResourceActionsDropdown
        items={[
          { key: 'edit', label: '编辑', onClick: () => handleEdit(record) },
          { key: 'detail', label: '详情', onClick: () => handleDetail(record) },
          { type: 'divider' },
          { key: 'delete', label: '删除', danger: true, onClick: () => handleDelete(record) },
        ]}
      />
    ),
    [handleEdit, handleDetail, handleDelete]
  );

  const columns: ColumnsType<SecretRow> = [
    { title: '密钥名称', dataIndex: 'name', key: 'name', width: 200, ellipsis: true },
    {
      title: '数据键',
      key: 'dataKeys',
      width: 120,
      render: (_, r) => (r.data && typeof r.data === 'object' ? Object.keys(r.data).join(', ') : '-'),
    },
    { title: '操作', key: 'action', width: 80, fixed: 'right', onHeaderCell: () => ({ style: { whiteSpace: 'nowrap' } }), render: renderAction },
  ];

  return (
    <>
      <PageDetailSection
        asCard={false}
        toolbarLeft={
          <Space wrap>
            <Select
              placeholder="数据源"
              value={dataSourceFilter}
              onChange={(v) => setDataSourceFilter(v ?? 'prometheus')}
              options={[{ label: 'Prometheus', value: 'prometheus' }]}
              style={{ minWidth: 120 }}
            />
            <Select
              placeholder="命名空间"
              value={namespaceFilter || undefined}
              onChange={(v) => setNamespaceFilter(v ?? 'cattle-monitoring-system')}
              options={formNamespaceOptions}
              style={{ width: 250 }}
            />
            <Input.Search
              placeholder="关键字"
              allowClear
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              style={{ width: 200 }}
            />
            <button
              type="button"
              className="toolbar-reset-btn"
              onClick={() => {
                setKeyword('');
                setNamespaceFilter('cattle-monitoring-system');
              }}
            >
              重置
            </button>
          </Space>
        }
        toolbarRight={
          <Space>
            <Button type="primary" icon={<PlusOutlined />} onClick={handleAdd}>
              新增密钥
            </Button>
            <Button icon={<ReloadOutlined />} onClick={loadSecrets} loading={loading} />
          </Space>
        }
      >
        <Table
          className="std-table"
          bordered
          rowKey={(r) => `${r.namespace ?? ''}-${r.name}`}
          loading={loading}
          columns={columns}
          dataSource={filteredSecrets}
          scroll={{ x: 500 }}
          pagination={{ showSizeChanger: true, showTotal: (t) => `共 ${t} 条`, pageSizeOptions: ['20', '50', '100'] }}
        />
      </PageDetailSection>

      <Modal
        title={editingRecord ? '修改告警密钥' : '新增告警密钥'}
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
          <Form.Item name="namespace" label="命名空间" rules={[{ required: true }]}>
            <Select placeholder="选择命名空间" options={formNamespaceOptions} disabled={!!editingRecord} />
          </Form.Item>
          <Form.Item
            name="name"
            label="密钥名称"
            rules={[{ required: true, message: '请输入密钥名称' }]}
          >
            <Input placeholder="如 admin-email-secret" disabled={!!editingRecord} />
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
        title="告警密钥详情"
        open={!!detailRecord}
        onCancel={() => setDetailRecord(null)}
        footer={null}
        width={480}
      >
        {detailRecord && (
          <Descriptions column={1} bordered size="small">
            <Descriptions.Item label="密钥名称">{detailRecord.name ?? '-'}</Descriptions.Item>
            <Descriptions.Item label="命名空间">{detailRecord.namespace ?? '-'}</Descriptions.Item>
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
