/**
 * Cloudmap · RGW 用户：`CephObjectStoreUser` 增删改查；AK/SK 由 Rook Operator 写入 Secret（Tower 经 rook-secret 只读解码展示）。
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { App, Button, Form, Input, Modal, Select, Space, Table, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { PlusOutlined, ReloadOutlined, SearchOutlined } from '@ant-design/icons';
import PageDetailSection from '../../../../../../components/PageDetailSection';
import {
  createCephObjectStoreUserRook,
  deleteCephObjectStoreUserRook,
  fetchCephRookBundle,
  fetchRgwRookSecret,
  getCephObjectStoreUserRook,
  patchCephObjectStoreUserRook,
} from '../../../../../../services/cephApi';
import { normalizeCephBundle } from '../lib/cephStorage';
import { objectStoreUserSecretRef } from '../lib/rgwRookHints';
import {
  createHarvesterToolbarRefresh,
  mergeCephSectionOnRefresh,
  runHarvesterSectionRefresh,
  type HarvesterSectionOnRefresh,
} from '../lib/cephSectionRefresh';
import {
  confirmHighRiskDelete,
  CEPH_STORAGE_RISK_ITEMS,
} from '../../shared/lib/highRiskConfirm';

export type RgwObjectStoreUsersSectionProps = {
  cloudId: string;
  checkPerm: (act: string) => boolean;
  onRefresh?: HarvesterSectionOnRefresh;
};

const k8sDnsLabel = /^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/;

function trimStr(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

const RgwObjectStoreUsersSection: React.FC<RgwObjectStoreUsersSectionProps> = ({
  cloudId,
  checkPerm,
  onRefresh,
}) => {
  const { message } = App.useApp();
  const [bundleLoading, setBundleLoading] = useState(false);
  const [objectStores, setObjectStores] = useState<any[]>([]);
  const [rows, setRows] = useState<any[]>([]);

  const [createOpen, setCreateOpen] = useState(false);
  const [createSubmitting, setCreateSubmitting] = useState(false);
  const [createForm] = Form.useForm();

  const [editOpen, setEditOpen] = useState(false);
  const [editSubmitting, setEditSubmitting] = useState(false);
  const [editNs, setEditNs] = useState('');
  const [editNm, setEditNm] = useState('');
  const [editForm] = Form.useForm();

  const [secretOpen, setSecretOpen] = useState(false);
  const [secretLoading, setSecretLoading] = useState(false);
  const [secretLabel, setSecretLabel] = useState('');
  const [secretAk, setSecretAk] = useState('');
  const [secretSk, setSecretSk] = useState('');
  const [keyword, setKeyword] = useState('');

  const canWrite = useMemo(
    () => checkPerm('clouds.storage-rgw-users:write') || checkPerm('clouds:write'),
    [checkPerm],
  );

  const loadBundle = useCallback(async (force?: boolean) => {
    if (!cloudId) return;
    setBundleLoading(true);
    try {
      const res = await fetchCephRookBundle(cloudId, { force: force !== false });
      if (!res.ok || !res.data) {
        setObjectStores([]);
        setRows([]);
        if (res.error) message.warning(`未能加载 Rook 聚合：${res.error}`);
        return;
      }
      const b = normalizeCephBundle(res.data);
      setObjectStores(b.objectStores || []);
      const list = b.objectStoreUsers || [];
      setRows(
        [...list].sort((a, b) => {
          const an = `${trimStr(a?.metadata?.namespace)}/${trimStr(a?.metadata?.name)}`;
          const bn = `${trimStr(b?.metadata?.namespace)}/${trimStr(b?.metadata?.name)}`;
          return an.localeCompare(bn);
        }),
      );
    } finally {
      setBundleLoading(false);
    }
  }, [cloudId, message]);

  const sectionOnRefresh = useMemo(
    () => mergeCephSectionOnRefresh(loadBundle, onRefresh),
    [loadBundle, onRefresh],
  );

  const handleToolbarRefresh = useMemo(
    () => createHarvesterToolbarRefresh(sectionOnRefresh),
    [sectionOnRefresh],
  );

  useEffect(() => {
    void loadBundle();
  }, [loadBundle]);

  const filteredRows = useMemo(() => {
    const q = keyword.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((u) => {
      const ns = trimStr(u?.metadata?.namespace).toLowerCase();
      const nm = trimStr(u?.metadata?.name).toLowerCase();
      const store = trimStr(u?.spec?.store).toLowerCase();
      const dn = trimStr(u?.spec?.displayName).toLowerCase();
      return `${ns}/${nm}`.includes(q) || ns.includes(q) || nm.includes(q) || store.includes(q) || dn.includes(q);
    });
  }, [rows, keyword]);

  const createNsWatch = Form.useWatch('namespace', createForm);

  const objectStoreNamespaceOptions = useMemo(() => {
    const seen = new Set<string>();
    for (const s of objectStores) {
      const ns = trimStr(s?.metadata?.namespace);
      if (ns) seen.add(ns);
    }
    return [...seen].sort((a, b) => a.localeCompare(b)).map((ns) => ({ label: ns, value: ns }));
  }, [objectStores]);

  useEffect(() => {
    if (!createOpen || objectStoreNamespaceOptions.length !== 1) return;
    const only = trimStr(objectStoreNamespaceOptions[0]?.value);
    if (!only) return;
    if (!trimStr(createForm.getFieldValue('namespace'))) {
      createForm.setFieldsValue({ namespace: only });
    }
  }, [createOpen, createForm, objectStoreNamespaceOptions]);

  const storeOptionsForNs = useMemo(() => {
    const ns = trimStr(createNsWatch);
    if (!ns) return [];
    const out: { label: string; value: string }[] = [];
    const seen = new Set<string>();
    for (const s of objectStores) {
      if (trimStr(s?.metadata?.namespace) !== ns) continue;
      const nm = trimStr(s?.metadata?.name);
      if (!nm || seen.has(nm)) continue;
      seen.add(nm);
      out.push({ label: nm, value: nm });
    }
    return out;
  }, [createNsWatch, objectStores]);

  const openCreate = () => {
    createForm.resetFields();
    setCreateOpen(true);
  };

  const submitCreate = async () => {
    const v = await createForm.validateFields();
    const ns = trimStr(v.namespace);
    const nm = trimStr(v.name);
    const store = trimStr(v.store);
    const displayName = trimStr(v.displayName);
    if (!ns || !nm || !store) return;
    setCreateSubmitting(true);
    try {
      const body: Record<string, unknown> = {
        apiVersion: 'ceph.rook.io/v1',
        kind: 'CephObjectStoreUser',
        metadata: { name: nm, namespace: ns },
        spec: { store },
      };
      if (displayName) (body.spec as Record<string, unknown>).displayName = displayName;
      const res = await createCephObjectStoreUserRook(cloudId, body);
      if (!res.ok) {
        message.error(res.error || '创建失败');
        return;
      }
      message.success('已创建 RGW 用户（Secret 由 Operator 异步写入）');
      setCreateOpen(false);
      await runHarvesterSectionRefresh(sectionOnRefresh, { force: true });
    } finally {
      setCreateSubmitting(false);
    }
  };

  const openEdit = async (u: any) => {
    const ns = trimStr(u?.metadata?.namespace);
    const nm = trimStr(u?.metadata?.name);
    if (!ns || !nm) return;
    setEditNs(ns);
    setEditNm(nm);
    setEditOpen(true);
    editForm.resetFields();
    const res = await getCephObjectStoreUserRook(cloudId, ns, nm, {});
    if (!res.ok || !res.data) {
      message.error(res.error || '加载失败');
      setEditOpen(false);
      return;
    }
    const dn = trimStr((res.data as any)?.spec?.displayName);
    editForm.setFieldsValue({ displayName: dn });
  };

  const submitEdit = async () => {
    const v = await editForm.validateFields();
    const displayName = trimStr(v.displayName);
    setEditSubmitting(true);
    try {
      const res = await patchCephObjectStoreUserRook(cloudId, editNs, editNm, {
        spec: { displayName: displayName || null },
      });
      if (!res.ok) {
        message.error(res.error || '更新失败');
        return;
      }
      message.success('已更新');
      setEditOpen(false);
      await runHarvesterSectionRefresh(sectionOnRefresh, { force: true });
    } finally {
      setEditSubmitting(false);
    }
  };

  const doDelete = async (u: any) => {
    const ns = trimStr(u?.metadata?.namespace);
    const nm = trimStr(u?.metadata?.name);
    if (!ns || !nm) return;
    const res = await deleteCephObjectStoreUserRook(cloudId, ns, nm);
    if (!res.ok) {
      message.error(res.error || '删除失败');
      return;
    }
    message.success('已删除');
    await runHarvesterSectionRefresh(sectionOnRefresh, { force: true });
  };

  const openSecret = async (u: any) => {
    const ref = objectStoreUserSecretRef(u);
    setSecretAk('');
    setSecretSk('');
    if (!ref) {
      message.warning('该 CR 未解析到 Secret 引用（如 status.info.secretName）；请稍后重试或核对 Rook 版本');
      return;
    }
    const ns = trimStr(u?.metadata?.namespace);
    const nm = trimStr(u?.metadata?.name);
    setSecretLabel(`${ns}/${nm} · Secret ${ref.namespace}/${ref.name}`);
    setSecretOpen(true);
    setSecretLoading(true);
    try {
      const res = await fetchRgwRookSecret(cloudId, ref.namespace, ref.name);
      if (!res.ok || !res.data) {
        message.error(res.error || '读取 Secret 失败');
        return;
      }
      setSecretAk(String((res.data as any)?.accessKeyId ?? '').trim());
      setSecretSk(String((res.data as any)?.secretAccessKey ?? '').trim());
    } finally {
      setSecretLoading(false);
    }
  };

  const columns: ColumnsType<any> = [
    {
      title: '命名空间 / 名称',
      key: 'id',
      fixed: 'left',
      ellipsis: true,
      render: (_, u) => (
        <Typography.Text code>
          {trimStr(u?.metadata?.namespace)}/{trimStr(u?.metadata?.name)}
        </Typography.Text>
      ),
    },
    {
      title: 'ObjectStore',
      key: 'store',
      width: 160,
      ellipsis: true,
      render: (_, u) => trimStr(u?.spec?.store) || '—',
    },
    {
      title: '显示名',
      key: 'displayName',
      width: 160,
      ellipsis: true,
      render: (_, u) => trimStr(u?.spec?.displayName) || '—',
    },
    {
      title: '状态',
      key: 'phase',
      width: 120,
      render: (_, u) => trimStr(u?.status?.phase) || trimStr(u?.status?.conditions?.[0]?.type) || '—',
    },
    {
      title: 'Secret',
      key: 'sec',
      width: 100,
      render: (_, u) => (objectStoreUserSecretRef(u) ? '已引用' : '—'),
    },
    {
      title: '操作',
      key: 'actions',
      fixed: 'right',
      width: canWrite ? 260 : 120,
      render: (_, u) => (
        <Space size="small" wrap>
          <Button type="link" size="small" onClick={() => void openSecret(u)}>
            查看密钥
          </Button>
          {canWrite ? (
            <>
              <Button type="link" size="small" onClick={() => void openEdit(u)}>
                编辑
              </Button>
              <Button
                type="link"
                size="small"
                danger
                onClick={() =>
                  void confirmHighRiskDelete({
                    resourceLabel: 'RGW 用户',
                    name: `${u.namespace}/${u.name}`,
                    description:
                      '将删除该 RGW 用户 CR，关联 Secret 可能被清理；不可恢复。',
                    riskItems: CEPH_STORAGE_RISK_ITEMS,
                    onConfirm: () => void doDelete(u),
                  }).catch(() => {})
                }
              >
                删除
              </Button>
            </>
          ) : null}
        </Space>
      ),
    },
  ];

  return (
    <div style={{ width: '100%' }}>
      <PageDetailSection
        asCard={false}
        toolbarLeft={
          <>
            <Input
              allowClear
              placeholder="名称 / 命名空间 / ObjectStore"
              suffix={<SearchOutlined style={{ color: 'rgba(0,0,0,.45)' }} />}
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              className="toolbar-search"
            />
            <button
              type="button"
              className="toolbar-reset-btn"
              onClick={() => {
                setKeyword('');
              }}
            >
              重置
            </button>
          </>
        }
        toolbarRight={
          <>
            <Button icon={<ReloadOutlined />} onClick={handleToolbarRefresh} loading={bundleLoading}>
              刷新列表
            </Button>
            {canWrite ? (
              <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
                新建用户
              </Button>
            ) : null}
          </>
        }
      >
        <Table<any>
          className="std-table"
          rowKey={(u) => `${trimStr(u?.metadata?.namespace)}/${trimStr(u?.metadata?.name)}`}
          bordered={false}
          loading={bundleLoading}
          columns={columns}
          dataSource={filteredRows}
          pagination={{
            pageSize: 15,
            showSizeChanger: true,
            showTotal: (total) => `共 ${total} 条`,
          }}
          scroll={{ x: true }}
          locale={{ emptyText: !bundleLoading ? '暂无 RGW 用户，可新建或确认 Rook bundle 已加载' : undefined }}
        />
      </PageDetailSection>

      <Modal
        title="新建 RGW 用户"
        open={createOpen}
        onCancel={() => setCreateOpen(false)}
        okText="创建"
        cancelText="取消"
        confirmLoading={createSubmitting}
        onOk={() => void submitCreate()}
        destroyOnClose
        width={520}
      >
        <Typography.Paragraph type="secondary" style={{ fontSize: 13 }}>
          命名空间与 <Typography.Text code>ObjectStore</Typography.Text> 均来自当前 Rook bundle（须有 <Typography.Text code>CephObjectStore</Typography.Text>）。
        </Typography.Paragraph>
        <Form form={createForm} layout="vertical">
          <Form.Item
            name="namespace"
            label="命名空间（Kubernetes）"
            rules={[{ required: true, message: '必选' }]}
          >
            <Select
              allowClear
              showSearch
              optionFilterProp="label"
              placeholder={
                objectStoreNamespaceOptions.length
                  ? '选择命名空间（与 bundle 中对象网关一致）'
                  : 'bundle 中暂无对象网关，请先点「刷新列表」'
              }
              options={objectStoreNamespaceOptions}
              disabled={objectStoreNamespaceOptions.length === 0}
              onChange={() => createForm.setFieldValue('store', undefined)}
            />
          </Form.Item>
          <Form.Item
            name="name"
            label="资源名称"
            rules={[
              { required: true, message: '必填' },
              { pattern: k8sDnsLabel, message: '须为 DNS-1123 标签' },
              { max: 63, type: 'string', message: '最长 63 字符' },
            ]}
          >
            <Input placeholder="CR metadata.name" autoComplete="off" />
          </Form.Item>
          <Form.Item name="store" label="ObjectStore" rules={[{ required: true, message: '必选' }]}>
            <Select
              allowClear
              showSearch
              optionFilterProp="label"
              placeholder={
                trimStr(createNsWatch) && storeOptionsForNs.length
                  ? '选择对象网关'
                  : trimStr(createNsWatch)
                    ? '该命名空间下 bundle 中无 ObjectStore'
                    : '请先选择命名空间'
              }
              options={storeOptionsForNs}
              disabled={!trimStr(createNsWatch) || storeOptionsForNs.length === 0}
            />
          </Form.Item>
          <Form.Item name="displayName" label="显示名（可选）">
            <Input placeholder="spec.displayName" autoComplete="off" />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title={`编辑显示名 · ${editNs}/${editNm}`}
        open={editOpen}
        onCancel={() => setEditOpen(false)}
        okText="保存"
        cancelText="取消"
        confirmLoading={editSubmitting}
        onOk={() => void submitEdit()}
        destroyOnClose
      >
        <Form form={editForm} layout="vertical">
          <Form.Item name="displayName" label="spec.displayName">
            <Input placeholder="可留空" autoComplete="off" />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title="RGW 访问密钥（敏感）"
        open={secretOpen}
        onCancel={() => {
          setSecretOpen(false);
          setSecretAk('');
          setSecretSk('');
        }}
        footer={null}
        destroyOnClose
        width={560}
      >
        <Typography.Paragraph type="secondary" style={{ marginBottom: 8, fontSize: 13 }}>
          请勿在不受控渠道传播密钥；关闭本窗口后即不再保留明文。
        </Typography.Paragraph>
        <Typography.Paragraph type="secondary" style={{ fontSize: 12 }}>
          {secretLabel}
        </Typography.Paragraph>
        {secretLoading ? (
          <Typography.Paragraph>加载中…</Typography.Paragraph>
        ) : (
          <Space direction="vertical" style={{ width: '100%' }} size={8}>
            <div>
              <Typography.Text strong>Access Key ID</Typography.Text>
              <Input readOnly value={secretAk || '—'} style={{ marginTop: 4 }} />
            </div>
            <div>
              <Typography.Text strong>Secret Access Key</Typography.Text>
              <Input.Password readOnly value={secretSk || ''} style={{ marginTop: 4 }} visibilityToggle />
            </div>
          </Space>
        )}
      </Modal>
    </div>
  );
};

export default RgwObjectStoreUsersSection;
