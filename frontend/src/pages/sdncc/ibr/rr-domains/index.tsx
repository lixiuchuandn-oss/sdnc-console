import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Badge,
  Button,
  Drawer,
  Form,
  Input,
  InputNumber,
  Modal,
  Select,
  Space,
  Tag,
  Upload,
  message,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { MinusCircleOutlined, PlusOutlined, SearchOutlined, UploadOutlined } from '@ant-design/icons';
import PageContainer from '../../../../components/PageContainer';
import ResourceActionsDropdown from '../../../../components/ResourceActionsDropdown';
import { useAuth } from '../../../../contexts/AuthContext';
import { getApiErrorMessage } from '../../../../services/api';
import {
  createRrDomain,
  deleteRrDomain,
  downloadRrDomainTemplate,
  fetchRrDomains,
  importRrDomainsCsv,
  updateRrDomain,
  type RrDomain,
  type RrDomainNodeInput,
} from '../../../../services/rrDomainApi';
import { hasPermissionForAction } from '../../../../utils/accessMapping';
import { commonBadgeStyles } from '../../../../utils/tableStyles';
import type { IbrSectionEmbedProps } from '../lib/embedProps';

const RrDomainsPage: React.FC<IbrSectionEmbedProps> = ({ embedded = false }) => {
  const { user } = useAuth();
  const perms = Array.isArray(user?.permissions) ? user?.permissions ?? [] : [];
  const canWrite =
    user?.role === 'super_admin' || hasPermissionForAction(perms, 'networks.rr-domains:write');

  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState<RrDomain[]>([]);
  const [keyword, setKeyword] = useState('');
  const [filterForm] = Form.useForm();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editing, setEditing] = useState<RrDomain | null>(null);
  const [saving, setSaving] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importPreview, setImportPreview] = useState<string>('');
  const [importing, setImporting] = useState(false);
  const [form] = Form.useForm();

  const load = useCallback(async (force = false) => {
    setLoading(true);
    try {
      const data = await fetchRrDomains({ skipCache: force });
      setRows(data);
    } catch (e) {
      message.error(getApiErrorMessage(e, '加载 RR 反射域失败'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(true);
  }, [load]);

  const filtered = useMemo(() => {
    const q = keyword.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (r) =>
        r.name.toLowerCase().includes(q) ||
        r.displayName.toLowerCase().includes(q) ||
        String(r.remoteAs).includes(q),
    );
  }, [rows, keyword]);

  const openCreate = () => {
    setEditing(null);
    form.resetFields();
    form.setFieldsValue({
      nodes: [{ rrName: '', neighborAddress: '', priority: 1 }],
    });
    setDrawerOpen(true);
  };

  const openEdit = useCallback((row: RrDomain) => {
    setEditing(row);
    form.setFieldsValue({
      name: row.name,
      displayName: row.displayName,
      description: row.description,
      remoteAs: row.remoteAs,
      localAs: row.localAs,
      status: row.status,
      nodes:
        row.nodes.length > 0
          ? row.nodes.map((n) => ({
              rrName: n.rrName,
              neighborAddress: n.neighborAddress,
              remoteAs: n.remoteAs,
              localAs: n.localAs,
              clusterId: n.clusterId,
              routerIdHint: n.routerIdHint,
              priority: n.priority,
              remark: n.remark,
            }))
          : [{ rrName: '', neighborAddress: '', priority: 1 }],
    });
    setDrawerOpen(true);
  }, [form]);

  const handleSave = async () => {
    try {
      const values = await form.validateFields();
      const nodes: RrDomainNodeInput[] = (values.nodes || []).map((n: RrDomainNodeInput) => ({
        rrName: String(n.rrName || '').trim(),
        neighborAddress: String(n.neighborAddress || '').trim(),
        remoteAs: n.remoteAs ?? null,
        localAs: n.localAs ?? null,
        clusterId: n.clusterId ?? null,
        routerIdHint: n.routerIdHint ?? null,
        priority: n.priority ?? 1,
        remark: n.remark ?? null,
      }));
      setSaving(true);
      if (editing) {
        await updateRrDomain(editing.id, {
          displayName: values.displayName,
          description: values.description ?? null,
          remoteAs: values.remoteAs,
          localAs: values.localAs ?? null,
          status: values.status,
          nodes,
        });
        message.success('已更新 RR 反射域');
      } else {
        await createRrDomain({
          name: values.name,
          displayName: values.displayName,
          description: values.description ?? null,
          remoteAs: values.remoteAs,
          localAs: values.localAs ?? null,
          nodes,
        });
        message.success('已创建 RR 反射域');
      }
      setDrawerOpen(false);
      await load(true);
    } catch (e) {
      if ((e as { errorFields?: unknown })?.errorFields) return;
      message.error(getApiErrorMessage(e, '保存失败'));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = useCallback(
    (row: RrDomain) => {
      Modal.confirm({
        title: `删除 RR 反射域「${row.displayName}」？`,
        content: '若已被 SRv6 隧道引用将无法删除。',
        okText: '删除',
        okButtonProps: { danger: true },
        cancelText: '取消',
        onOk: async () => {
          try {
            await deleteRrDomain(row.id);
            message.success('已删除');
            await load(true);
          } catch (e) {
            message.error(getApiErrorMessage(e, '删除失败'));
            throw e;
          }
        },
      });
    },
    [load],
  );

  const runImportPreview = async (file: File) => {
    setImporting(true);
    try {
      const { preview } = await importRrDomainsCsv(file, { dryRun: true });
      setImportPreview(
        [
          preview.warnings.length ? `警告：\n${preview.warnings.join('\n')}` : '',
          `将导入 ${preview.domains.length} 个反射域，共 ${preview.domains.reduce((s, d) => s + d.nodes.length, 0)} 个 RR 节点`,
          preview.domains
            .map((d) => `- ${d.displayName} (${d.name})：${d.nodes.length} 节点，AS${d.remoteAs}`)
            .join('\n'),
        ]
          .filter(Boolean)
          .join('\n\n'),
      );
    } catch (e) {
      message.error(getApiErrorMessage(e, '预览失败'));
      setImportPreview('');
    } finally {
      setImporting(false);
    }
  };

  const handleImport = async () => {
    if (!importFile) {
      message.warning('请选择 CSV 文件');
      return;
    }
    setImporting(true);
    try {
      await importRrDomainsCsv(importFile);
      message.success('导入成功');
      setImportOpen(false);
      setImportFile(null);
      setImportPreview('');
      await load(true);
    } catch (e) {
      message.error(getApiErrorMessage(e, '导入失败'));
    } finally {
      setImporting(false);
    }
  };

  const columns = useMemo((): ColumnsType<RrDomain> => {
    return [
      {
        title: '域标识',
        dataIndex: 'name',
        key: 'name',
        fixed: 'left',
        render: (v: string, row) => (
          <span title={row.id}>
            <b>{v}</b>
            {row.displayName ? (
              <div style={{ color: '#64748b', fontSize: 12, fontWeight: 400 }}>{row.displayName}</div>
            ) : null}
          </span>
        ),
      },
      {
        title: '对端 ASN',
        dataIndex: 'remoteAs',
        key: 'remoteAs',
        render: (v: number, row) => (
          <span>
            {v}
            {row.localAs ? <span style={{ color: '#64748b' }}> / 本端 {row.localAs}</span> : null}
          </span>
        ),
      },
      {
        title: 'RR 节点',
        key: 'nodes',
        render: (_, row) => (
          <Space wrap size={[4, 4]}>
            {row.nodes.map((n) => (
              <Tag key={n.id}>
                {n.rrName} · {n.neighborAddress}
              </Tag>
            ))}
          </Space>
        ),
      },
      {
        title: '来源',
        dataIndex: 'source',
        key: 'source',
        render: (v: string) => (v === 'excel_import' ? 'Excel' : '手工'),
      },
      {
        title: '状态',
        dataIndex: 'status',
        key: 'status',
        render: (v: string) =>
          v === 'active' ? (
            <Badge
              status={commonBadgeStyles.statusMap.success.status}
              text={<span style={commonBadgeStyles.text}>启用</span>}
            />
          ) : (
            <Badge
              status={commonBadgeStyles.statusMap.default.status}
              text={<span style={commonBadgeStyles.text}>归档</span>}
            />
          ),
      },
      {
        title: '操作',
        key: 'actions',
        fixed: 'right',
        render: (_, row) =>
          canWrite ? (
            <ResourceActionsDropdown
              items={[
                { key: 'edit', label: '编辑', onClick: () => openEdit(row) },
                { key: 'delete', label: '删除', danger: true, onClick: () => handleDelete(row) },
              ]}
            />
          ) : null,
      },
    ];
  }, [canWrite, handleDelete, openEdit]);

  return (
    <PageContainer
      titleLevel={3}
      asCard={false}
      hideHeader={embedded}
      pagePadding={embedded ? 0 : undefined}
      primaryAction={
        canWrite
          ? {
              text: '新建反射域',
              type: 'primary',
              onClick: openCreate,
            }
          : undefined
      }
      secondaryActions={
        canWrite ? (
          <Button icon={<UploadOutlined />} onClick={() => setImportOpen(true)}>
            Excel 导入
          </Button>
        ) : undefined
      }
      onRefresh={() => {
        void load(true);
      }}
      toolbarLeft={
        <Form
          className="toolbar-container"
          form={filterForm}
          layout="inline"
          style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}
          onValuesChange={(_, all) => setKeyword(all.keyword || '')}
        >
          <Form.Item name="keyword" style={{ marginBottom: 0 }}>
            <Input
              allowClear
              placeholder="域标识 / 名称 / ASN"
              className="toolbar-search"
              suffix={<SearchOutlined style={{ color: 'rgba(0,0,0,.45)' }} />}
            />
          </Form.Item>
          <button
            type="button"
            className="toolbar-reset-btn"
            onClick={() => {
              filterForm.resetFields();
              setKeyword('');
            }}
          >
            重置
          </button>
        </Form>
      }
      tableProps={{
        rowKey: 'id',
        loading,
        columns,
        dataSource: filtered,
        bordered: false,
        className: 'std-table',
        scroll: { x: true },
        pagination: {
          size: 'small',
          showTotal: (total) => `共 ${total} 条`,
        },
      }}
    >
      <Drawer
        title={editing ? '编辑 RR 反射域' : '新建 RR 反射域'}
        width={720}
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        extra={
          <Space>
            <Button onClick={() => setDrawerOpen(false)}>取消</Button>
            <Button type="primary" loading={saving} onClick={() => void handleSave()}>
              保存
            </Button>
          </Space>
        }
      >
        <Form form={form} layout="vertical">
          <Form.Item
            name="name"
            label="域标识"
            rules={[{ required: true, message: '请输入域标识' }]}
            extra="英文 slug，全局唯一，如 customer-a-bj"
          >
            <Input disabled={!!editing} placeholder="customer-a-bj" />
          </Form.Item>
          <Form.Item name="displayName" label="域名称" rules={[{ required: true, message: '请输入域名称' }]}>
            <Input placeholder="客户A-北京RR域" />
          </Form.Item>
          <Form.Item name="description" label="域备注">
            <Input.TextArea rows={2} />
          </Form.Item>
          <Form.Item name="remoteAs" label="域级对端 ASN" rules={[{ required: true, message: '请输入对端 ASN' }]}>
            <InputNumber min={1} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="localAs" label="域级本端 ASN">
            <InputNumber min={1} style={{ width: '100%' }} />
          </Form.Item>
          {editing ? (
            <Form.Item name="status" label="状态">
              <Select
                options={[
                  { value: 'active', label: '启用' },
                  { value: 'archived', label: '归档' },
                ]}
              />
            </Form.Item>
          ) : null}

          <div style={{ marginBottom: 8, fontWeight: 500 }}>RR 节点（主备均须填写，建邻时全部生效）</div>
          <Form.List name="nodes">
            {(fields, { add, remove }) => (
              <>
                {fields.map((field) => (
                  <Space key={field.key} align="baseline" style={{ display: 'flex', marginBottom: 8 }} wrap>
                    <Form.Item
                      {...field}
                      name={[field.name, 'rrName']}
                      rules={[{ required: true, message: 'RR名称' }]}
                    >
                      <Input placeholder="RR名称" style={{ width: 120 }} />
                    </Form.Item>
                    <Form.Item
                      {...field}
                      name={[field.name, 'neighborAddress']}
                      rules={[{ required: true, message: '邻居地址' }]}
                    >
                      <Input placeholder="邻居地址" style={{ width: 160 }} />
                    </Form.Item>
                    <Form.Item {...field} name={[field.name, 'priority']}>
                      <InputNumber min={1} placeholder="优先级" />
                    </Form.Item>
                    <MinusCircleOutlined onClick={() => remove(field.name)} />
                  </Space>
                ))}
                <Button type="dashed" onClick={() => add({ priority: 1 })} block icon={<PlusOutlined />}>
                  添加 RR 节点
                </Button>
              </>
            )}
          </Form.List>
        </Form>
      </Drawer>

      <Modal
        title="Excel / CSV 导入 RR 反射域"
        open={importOpen}
        onCancel={() => {
          setImportOpen(false);
          setImportFile(null);
          setImportPreview('');
        }}
        onOk={() => void handleImport()}
        confirmLoading={importing}
        okText="确认导入"
        width={640}
      >
        <Space direction="vertical" style={{ width: '100%' }} size="middle">
          <Button type="link" style={{ padding: 0 }} onClick={() => void downloadRrDomainTemplate()}>
            下载导入模板
          </Button>
          <Upload
            accept=".csv,text/csv"
            maxCount={1}
            beforeUpload={(file) => {
              setImportFile(file);
              void runImportPreview(file);
              return false;
            }}
            onRemove={() => {
              setImportFile(null);
              setImportPreview('');
            }}
          >
            <Button icon={<UploadOutlined />}>选择 CSV 文件</Button>
          </Upload>
          {importPreview ? (
            <pre style={{ background: '#f5f5f5', padding: 12, borderRadius: 6, whiteSpace: 'pre-wrap' }}>
              {importPreview}
            </pre>
          ) : null}
        </Space>
      </Modal>
    </PageContainer>
  );
};

export default RrDomainsPage;
