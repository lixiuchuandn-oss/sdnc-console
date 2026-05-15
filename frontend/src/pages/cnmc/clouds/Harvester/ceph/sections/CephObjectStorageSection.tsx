/** Cloudmap Ceph · 对象存储：`CephObjectStore` 列表 + 创建 + COSI 驱动（Rook bundle + Steve）。 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  AutoComplete,
  Button,
  Divider,
  Drawer,
  Form,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Select,
  Space,
  Spin,
  Switch,
  Table,
  Tabs,
  Tooltip,
  Typography,
  message,
} from 'antd';
import { PlusOutlined, ReloadOutlined, SearchOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import yaml from 'js-yaml';
import PageDetailSection from '../../../../../../components/PageDetailSection';
import CodeEditor from '../../../../../../components/CodeEditor';
import {
  createCephObjectStoreRook,
  deleteCephObjectStoreRook,
  fetchCephRookBundle,
  fetchRgwGatewayClientConfig,
  getCephObjectStoreRook,
  putRgwGatewayClientConfig,
  type RgwGatewayClientConfigResponse,
  type RgwS3GatewayPayload,
} from '../../../../../../services/cephApi';
import { normalizeCephBundle } from '../lib/cephStorage';
import { cosiDriverCrToRow, objectStoreCrToRow, type CephCosiDriverRow, type CephObjectStoreRow } from '../lib/cephBlockStorage';
import { suggestedRgwHttpsEndpoints } from '../lib/rgwRookHints';

export type CephObjectStorageSectionProps = {
  cloudId: string;
  /** 全页双 Tab；Cloudmap 侧栏分栏时仅渲染单块，避免嵌套 Tabs */
  embedMode?: 'full' | 'storesOnly' | 'cosiOnly';
  /** 对象网关 Tab：Tower S3 Endpoint 编辑权限（Cloudmap 面板传入） */
  checkPerm?: (act: string) => boolean;
};

type YamlTarget = { kind: 'cosi'; yaml: string };

function trimStr(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

const CephObjectStorageSection: React.FC<CephObjectStorageSectionProps> = ({ cloudId, embedMode = 'full', checkPerm }) => {
  const [activeTab, setActiveTab] = useState('stores');
  const [loading, setLoading] = useState(false);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [storeRows, setStoreRows] = useState<CephObjectStoreRow[]>([]);
  const [cosiRows, setCosiRows] = useState<CephCosiDriverRow[]>([]);
  const [storeQ, setStoreQ] = useState('');
  const [cosiQ, setCosiQ] = useState('');
  const [yamlOpen, setYamlOpen] = useState(false);
  const [yamlTitle, setYamlTitle] = useState('');
  const [yamlText, setYamlText] = useState('');

  const [clientGwMap, setClientGwMap] = useState<Record<string, RgwS3GatewayPayload>>({});
  const [towerForm] = Form.useForm();
  const [detailDrawerOpen, setDetailDrawerOpen] = useState(false);
  const [detailRow, setDetailRow] = useState<CephObjectStoreRow | null>(null);
  const [detailTab, setDetailTab] = useState('tower');
  const [detailYamlLoading, setDetailYamlLoading] = useState(false);
  const [detailYamlText, setDetailYamlText] = useState('');
  const [towerGwSaving, setTowerGwSaving] = useState(false);

  const [blockPools, setBlockPools] = useState<any[]>([]);
  const [clusters, setClusters] = useState<any[]>([]);
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [createSubmitting, setCreateSubmitting] = useState(false);
  const [createForm] = Form.useForm();

  const canWriteStores = useMemo(() => {
    if (!checkPerm) return false;
    return checkPerm('clouds.console:write') || checkPerm('clouds:write');
  }, [checkPerm]);

  const loadGatewayMap = useCallback(
    async (force?: boolean) => {
      if (!cloudId) return;
      const res = await fetchRgwGatewayClientConfig(cloudId, { force: !!force });
      if (!res.ok || !res.data?.byStore) return;
      setClientGwMap(res.data.byStore as Record<string, RgwS3GatewayPayload>);
    },
    [cloudId],
  );

  const load = useCallback(
    async (force?: boolean) => {
      if (!cloudId) return;
      setLoading(true);
      setLoadErr(null);
      void loadGatewayMap(!!force);
      try {
        const res = await fetchCephRookBundle(cloudId, { force: !!force });
        if (!res.ok || res.data == null) {
          setStoreRows([]);
          setCosiRows([]);
          setBlockPools([]);
          setClusters([]);
          setLoadErr(res.error || '无法加载 Ceph Rook 聚合');
          return;
        }
        const bundle = normalizeCephBundle(res.data);
        setStoreRows((bundle.objectStores || []).map(objectStoreCrToRow));
        setCosiRows((bundle.cosiDrivers || []).map(cosiDriverCrToRow));
        setBlockPools(bundle.blockPools || []);
        setClusters(bundle.clusters || []);
      } catch (e: unknown) {
        setLoadErr(e instanceof Error ? e.message : '加载失败');
        setStoreRows([]);
        setCosiRows([]);
        setBlockPools([]);
        setClusters([]);
      } finally {
        setLoading(false);
      }
    },
    [cloudId, loadGatewayMap],
  );

  useEffect(() => {
    void load();
  }, [load]);

  const namespaceSelectOptions = useMemo(() => {
    const s = new Set<string>();
    for (const r of storeRows) {
      const ns = trimStr(r.namespace);
      if (ns && ns !== '—') s.add(ns);
    }
    for (const p of blockPools) {
      const ns = trimStr(p?.metadata?.namespace);
      if (ns) s.add(ns);
    }
    for (const c of clusters) {
      const ns = trimStr(c?.metadata?.namespace);
      if (ns) s.add(ns);
    }
    return [...s].sort().map((v) => ({ label: v, value: v }));
  }, [storeRows, blockPools, clusters]);

  const poolAutocompleteOptions = useCallback((ns: string) => {
    const q = trimStr(ns);
    if (!q) return [] as { value: string }[];
    const names = new Set<string>();
    for (const p of blockPools) {
      if (trimStr(p?.metadata?.namespace) !== q) continue;
      const nm = trimStr(p?.metadata?.name);
      if (nm) names.add(nm);
    }
    return [...names].sort().map((v) => ({ value: v }));
  }, [blockPools]);

  const createNsWatch = Form.useWatch('namespace', createForm);

  const poolOptsForCreateNs = useMemo(
    () => poolAutocompleteOptions(trimStr(createNsWatch)),
    [createNsWatch, poolAutocompleteOptions],
  );

  const openCreateModal = useCallback(() => {
    createForm.resetFields();
    const defaultNs = namespaceSelectOptions[0]?.value ?? 'rook-ceph';
    createForm.setFieldsValue({
      namespace: defaultNs,
      gatewayInstances: 1,
      port: 80,
      preservePoolsOnDelete: false,
    });
    setCreateModalOpen(true);
  }, [createForm, namespaceSelectOptions]);

  const submitCreateObjectStore = useCallback(async () => {
    let v: Record<string, unknown>;
    try {
      v = await createForm.validateFields();
    } catch {
      return;
    }
    const ns = trimStr(v.namespace);
    const nm = trimStr(v.name);
    const metaPool = trimStr(v.metadataPool);
    const dataPool = trimStr(v.dataPool);
    if (!ns || !nm || !metaPool || !dataPool) return;
    const instances = Math.max(1, Math.floor(Number(v.gatewayInstances) || 1));
    const portNum =
      v.port != null && v.port !== ''
        ? Math.max(1, Math.floor(Number(v.port)))
        : 80;
    const gateway: Record<string, unknown> = { type: 's3', instances: instances, port: portNum };
    if (v.securePort != null && v.securePort !== '') {
      gateway.securePort = Math.max(1, Math.floor(Number(v.securePort)));
    }
    const spec: Record<string, unknown> = {
      metadataPool: metaPool,
      dataPool,
      gateway,
    };
    if (v.preservePoolsOnDelete === true) spec.preservePoolsOnDelete = true;
    const body = {
      apiVersion: 'ceph.rook.io/v1',
      kind: 'CephObjectStore',
      metadata: { name: nm, namespace: ns },
      spec,
    };
    setCreateSubmitting(true);
    try {
      const res = await createCephObjectStoreRook(cloudId, body);
      if (!res.ok) {
        message.error(res.error || '创建失败');
        return;
      }
      message.success('已提交创建 CephObjectStore（阶段就绪由 Operator 推进）');
      setCreateModalOpen(false);
      await load(true);
    } finally {
      setCreateSubmitting(false);
    }
  }, [cloudId, createForm, load]);

  const openYamlDrawer = useCallback(async (t: YamlTarget) => {
    setYamlOpen(true);
    setYamlTitle('COSI 驱动 · YAML');
    setYamlText(t.yaml);
  }, []);

  const openStoreDetail = useCallback((r: CephObjectStoreRow) => {
    setDetailRow(r);
    setDetailTab('tower');
    setDetailDrawerOpen(true);
  }, []);

  useEffect(() => {
    if (!detailDrawerOpen || !detailRow) return;
    let cancelled = false;
    setDetailYamlLoading(true);
    setDetailYamlText('');
    (async () => {
      try {
        const res = await getCephObjectStoreRook(cloudId, detailRow.namespace, detailRow.name);
        if (cancelled) return;
        if (!res.ok || res.data == null) {
          message.error(res.error || '拉取详情失败');
          setDetailYamlText('# 加载失败');
          return;
        }
        setDetailYamlText(yaml.dump(res.data, { lineWidth: 120, noRefs: true }));
      } finally {
        if (!cancelled) setDetailYamlLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [detailDrawerOpen, detailRow, cloudId]);

  useEffect(() => {
    if (!detailDrawerOpen || !detailRow) return;
    const sk = `${detailRow.namespace}/${detailRow.name}`;
    const saved = clientGwMap[sk];
    towerForm.setFieldsValue({
      endpoint: saved?.endpoint || '',
      region: saved?.region || 'us-east-1',
      forcePathStyle: saved?.forcePathStyle !== false,
    });
  }, [detailDrawerOpen, detailRow, clientGwMap, towerForm]);

  const detailCandidateEndpoints = useMemo(() => {
    if (!detailRow?.raw) return [];
    return suggestedRgwHttpsEndpoints(detailRow.raw).map((url) => ({ label: url, value: url }));
  }, [detailRow]);

  const persistGwResponse = useCallback((data: RgwGatewayClientConfigResponse | null | undefined) => {
    if (data?.byStore && typeof data.byStore === 'object') {
      setClientGwMap(data.byStore as Record<string, RgwS3GatewayPayload>);
    }
  }, []);

  const saveTowerGw = useCallback(async () => {
    if (!detailRow || !canWriteStores) return;
    await towerForm.validateFields(['endpoint', 'region']);
    const vals = towerForm.getFieldsValue(['endpoint', 'region', 'forcePathStyle']) as Record<string, unknown>;
    const endpoint = String(vals.endpoint ?? '').trim();
    const region = String(vals.region ?? '').trim() || 'us-east-1';
    const forcePathStyle = vals.forcePathStyle !== false;
    setTowerGwSaving(true);
    try {
      const res = await putRgwGatewayClientConfig(cloudId, detailRow.namespace, detailRow.name, {
        endpoint,
        region,
        forcePathStyle,
      });
      if (!res.ok) {
        message.error(res.error || '保存失败');
        return;
      }
      persistGwResponse(res.data ?? undefined);
      message.success('Tower S3 网关已保存');
    } finally {
      setTowerGwSaving(false);
    }
  }, [canWriteStores, cloudId, detailRow, persistGwResponse, towerForm]);

  const clearTowerGw = useCallback(async () => {
    if (!detailRow || !canWriteStores) return;
    setTowerGwSaving(true);
    try {
      const res = await putRgwGatewayClientConfig(cloudId, detailRow.namespace, detailRow.name, { endpoint: '' });
      if (!res.ok) {
        message.error(res.error || '清除失败');
        return;
      }
      persistGwResponse(res.data ?? undefined);
      towerForm.setFieldsValue({ endpoint: '', region: 'us-east-1', forcePathStyle: true });
      message.success('已清除 Tower S3 网关配置');
    } finally {
      setTowerGwSaving(false);
    }
  }, [canWriteStores, cloudId, detailRow, persistGwResponse, towerForm]);

  const filteredStores = useMemo(() => {
    const q = storeQ.trim().toLowerCase();
    if (!q) return storeRows;
    return storeRows.filter((r) => {
      const sk = `${r.namespace}/${r.name}`;
      const tw = clientGwMap[sk];
      const twSeg = tw?.endpoint
        ? `${tw.endpoint} ${tw.region ?? ''} ${tw.forcePathStyle === false ? 'virtual-hosted' : 'path-style'}`
        : '';
      const sug = r.suggestedEndpoints.join(' ');
      const hay = [
        r.name,
        r.namespace,
        r.phase,
        r.message,
        r.metadataPool,
        r.dataPool,
        r.preservePoolsOnDelete,
        r.gatewaySummary,
        r.primaryEndpointHint,
        sug,
        r.multisiteZone,
        r.observedGeneration,
        r.creationTime,
        twSeg,
      ]
        .join(' ')
        .toLowerCase();
      return hay.includes(q);
    });
  }, [storeRows, storeQ, clientGwMap]);

  const filteredCosi = useMemo(() => {
    const q = cosiQ.trim().toLowerCase();
    if (!q) return cosiRows;
    return cosiRows.filter((r) => r.name.toLowerCase().includes(q) || r.namespace.toLowerCase().includes(q));
  }, [cosiRows, cosiQ]);

  const storeColumns: ColumnsType<CephObjectStoreRow> = useMemo(
    () => [
      { title: '名称', dataIndex: 'name', key: 'name', fixed: 'left', ellipsis: true },
      { title: '命名空间', dataIndex: 'namespace', key: 'namespace', ellipsis: true },
      { title: '阶段', dataIndex: 'phase', key: 'phase', ellipsis: true },
      {
        title: '状态消息',
        dataIndex: 'message',
        key: 'message',
        ellipsis: { showTitle: false },
        render: (v: string) =>
          v && v !== '—' ? (
            <Tooltip placement="topLeft" title={v}>
              <span>{v}</span>
            </Tooltip>
          ) : (
            '—'
          ),
      },
      { title: '元数据池', dataIndex: 'metadataPool', key: 'metadataPool', ellipsis: true },
      { title: '数据池', dataIndex: 'dataPool', key: 'dataPool', ellipsis: true },
      {
        title: '删除保留池',
        dataIndex: 'preservePoolsOnDelete',
        key: 'preservePoolsOnDelete',
        ellipsis: true,
      },
      { title: '网关', dataIndex: 'gatewaySummary', key: 'gatewaySummary', ellipsis: true },
      {
        title: '推导 Endpoint',
        dataIndex: 'primaryEndpointHint',
        key: 'primaryEndpointHint',
        ellipsis: { showTitle: false },
        render: (v: string, r) =>
          v && v !== '—' && r.suggestedEndpoints.length > 1 ? (
            <Tooltip placement="topLeft" title={r.suggestedEndpoints.join('\n')}>
              <span>{v}</span>
            </Tooltip>
          ) : (
            v || '—'
          ),
      },
      { title: '多站点 Zone', dataIndex: 'multisiteZone', key: 'multisiteZone', ellipsis: true },
      {
        title: 'Tower S3',
        key: 'towerS3',
        ellipsis: { showTitle: false },
        render: (_, r) => {
          const sk = `${r.namespace}/${r.name}`;
          const tw = clientGwMap[sk];
          if (!tw?.endpoint?.trim()) {
            return <Typography.Text type="secondary">未配置</Typography.Text>;
          }
          const extra = [tw.region, tw.forcePathStyle === false ? 'virtual-hosted' : 'path-style'].filter(Boolean).join(' · ');
          const tip = extra ? `${tw.endpoint}\n${extra}` : tw.endpoint;
          return (
            <Tooltip placement="topLeft" title={tip}>
              <Typography.Text ellipsis>{tw.endpoint}</Typography.Text>
            </Tooltip>
          );
        },
      },
      { title: '观察代数', dataIndex: 'observedGeneration', key: 'observedGeneration', ellipsis: true },
      { title: '创建时间', dataIndex: 'creationTime', key: 'creationTime', ellipsis: true },
      {
        title: '操作',
        key: 'actions',
        fixed: 'right',
        width: 168,
        render: (_, r) => (
          <Space size="small">
            <Typography.Link
              onClick={() => {
                openStoreDetail(r);
              }}
            >
              详情
            </Typography.Link>
            <Popconfirm
              title={`确定删除 ${r.namespace}/${r.name}？`}
              description="删除 CephObjectStore 将影响 RGW 等对象网关，请确认集群侧无依赖。"
              onConfirm={async () => {
                const del = await deleteCephObjectStoreRook(cloudId, r.namespace, r.name);
                if (!del.ok) {
                  message.error(del.error || '删除失败');
                  return;
                }
                message.success('已删除');
                void load(true);
              }}
            >
              <Typography.Link type="danger">删除</Typography.Link>
            </Popconfirm>
          </Space>
        ),
      },
    ],
    [clientGwMap, cloudId, load, openStoreDetail],
  );

  const cosiColumns: ColumnsType<CephCosiDriverRow> = useMemo(
    () => [
      { title: '名称', dataIndex: 'name', key: 'name', fixed: 'left', ellipsis: true },
      { title: '命名空间', dataIndex: 'namespace', key: 'namespace', width: 140, ellipsis: true },
      { title: '阶段', dataIndex: 'phase', key: 'phase', width: 120, ellipsis: true },
      {
        title: '操作',
        key: 'actions',
        fixed: 'right',
        width: 88,
        render: (_, r) => (
          <Typography.Link
            onClick={() => {
              try {
                const y = yaml.dump(r.raw, { lineWidth: 120, noRefs: true });
                void openYamlDrawer({ kind: 'cosi', yaml: y });
              } catch {
                void openYamlDrawer({ kind: 'cosi', yaml: String(r.raw) });
              }
            }}
          >
            YAML
          </Typography.Link>
        ),
      },
    ],
    [openYamlDrawer],
  );

  const storesTab = (
    <PageDetailSection
      asCard={false}
      toolbarLeft={
        <>
          <Input
            allowClear
            placeholder="名称 / 命名空间 / 阶段 / 池 / 网关 / Endpoint …"
            suffix={<SearchOutlined style={{ color: 'rgba(0,0,0,.45)' }} />}
            value={storeQ}
            onChange={(e) => setStoreQ(e.target.value)}
            className="toolbar-search"
          />
          <button type="button" className="toolbar-reset-btn" onClick={() => setStoreQ('')}>
            重置
          </button>
        </>
      }
      toolbarRight={
        <>
          {canWriteStores ? (
            <Button type="primary" icon={<PlusOutlined />} onClick={openCreateModal}>
              新建对象网关
            </Button>
          ) : null}
          <Button icon={<ReloadOutlined />} onClick={() => void load(true)}>
            刷新
          </Button>
        </>
      }
    >
      {loadErr ? <Alert type="error" showIcon message={loadErr} style={{ marginBottom: 12 }} /> : null}
      <Table<CephObjectStoreRow>
        className="std-table"
        rowKey="key"
        bordered={false}
        loading={loading}
        columns={storeColumns}
        dataSource={filteredStores}
        pagination={{
          pageSize: 15,
          showSizeChanger: true,
          showTotal: (total) => `共 ${total} 条`,
        }}
        scroll={{ x: true }}
        locale={{ emptyText: storeRows.length === 0 && !loading ? '未发现 CephObjectStore CR' : undefined }}
      />
    </PageDetailSection>
  );

  const cosiTab = (
    <PageDetailSection
      asCard={false}
      toolbarLeft={
        <>
          <Input
            allowClear
            placeholder="名称 / 命名空间"
            suffix={<SearchOutlined style={{ color: 'rgba(0,0,0,.45)' }} />}
            value={cosiQ}
            onChange={(e) => setCosiQ(e.target.value)}
            className="toolbar-search"
          />
          <button type="button" className="toolbar-reset-btn" onClick={() => setCosiQ('')}>
            重置
          </button>
        </>
      }
      toolbarRight={
        <Button icon={<ReloadOutlined />} onClick={() => void load(true)}>
          刷新
        </Button>
      }
    >
      <Table<CephCosiDriverRow>
        className="std-table"
        rowKey="key"
        bordered={false}
        loading={loading}
        columns={cosiColumns}
        dataSource={filteredCosi}
        pagination={{
          pageSize: 15,
          showSizeChanger: true,
          showTotal: (total) => `共 ${total} 条`,
        }}
        scroll={{ x: true }}
        locale={{ emptyText: cosiRows.length === 0 && !loading ? '未检测到 COSI 驱动 CR' : undefined }}
      />
    </PageDetailSection>
  );

  const createObjectStoreModal = (
    <Modal
      title="新建对象网关"
      open={createModalOpen}
      onCancel={() => setCreateModalOpen(false)}
      okText="创建"
      cancelText="取消"
      confirmLoading={createSubmitting}
      onOk={() => void submitCreateObjectStore()}
      destroyOnHidden
      width={620}
    >
      <Form form={createForm} layout="vertical" preserve={false}>
        <Form.Item name="namespace" label="命名空间" rules={[{ required: true, message: '必填' }]}>
          <AutoComplete
            options={namespaceSelectOptions.map((o) => ({ value: o.value, label: o.label }))}
            placeholder={namespaceSelectOptions.length ? '选择或输入命名空间' : '例如 rook-ceph'}
            allowClear
          />
        </Form.Item>
        <Form.Item
          name="name"
          label="对象网关名称"
          rules={[
            { required: true, message: '必填' },
            {
              pattern: /^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/,
              message: '需符合 DNS 子域规则（小写字母、数字、连字符）',
            },
          ]}
        >
          <Input placeholder="例如 my-store" autoComplete="off" />
        </Form.Item>
        <Form.Item name="metadataPool" label="元数据池" rules={[{ required: true, message: '必填' }]}>
          <AutoComplete options={poolOptsForCreateNs} placeholder="RADOS 池名称" allowClear />
        </Form.Item>
        <Form.Item name="dataPool" label="数据池" rules={[{ required: true, message: '必填' }]}>
          <AutoComplete options={poolOptsForCreateNs} placeholder="RADOS 池名称" allowClear />
        </Form.Item>
        <Space wrap align="start">
          <Form.Item
            name="gatewayInstances"
            label="RGW 副本数"
            rules={[{ required: true, message: '必填' }]}
            style={{ minWidth: 140 }}
          >
            <InputNumber min={1} max={32} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="port" label="明文端口" style={{ minWidth: 140 }}>
            <InputNumber min={1} max={65535} style={{ width: '100%' }} placeholder="默认 80" />
          </Form.Item>
          <Form.Item name="securePort" label="TLS 端口" style={{ minWidth: 140 }}>
            <InputNumber min={1} max={65535} style={{ width: '100%' }} placeholder="可选" />
          </Form.Item>
        </Space>
        <Form.Item name="preservePoolsOnDelete" label="删除 CR 时保留 RADOS 池" valuePropName="checked">
          <Switch />
        </Form.Item>
      </Form>
    </Modal>
  );

  const storeDetailDrawer = (
    <Drawer
      title={detailRow ? `对象网关 · ${detailRow.namespace}/${detailRow.name}` : '对象网关'}
      width={720}
      open={detailDrawerOpen}
      onClose={() => {
        setDetailDrawerOpen(false);
        setDetailRow(null);
      }}
      destroyOnClose
    >
      {detailRow ? (
        <Tabs
          activeKey={detailTab}
          onChange={setDetailTab}
          items={[
            {
              key: 'tower',
              label: 'Tower S3',
              children: (
                <div style={{ paddingTop: 4 }}>
                  <Typography.Paragraph type="secondary" style={{ marginBottom: 12 }}>
                    此处保存的配置供「S3 存储桶（RGW）」页通过所选用户的{' '}
                    <Typography.Text code>spec.store</Typography.Text> 自动解析并代发 S3。
                  </Typography.Paragraph>
                  <Select
                    style={{ width: '100%', marginBottom: 12 }}
                    allowClear
                    showSearch
                    optionFilterProp="label"
                    placeholder={detailCandidateEndpoints.length ? '从推导地址填入 Endpoint' : undefined}
                    options={detailCandidateEndpoints}
                    disabled={!detailCandidateEndpoints.length}
                    onChange={(v) => {
                      if (v) towerForm.setFieldsValue({ endpoint: v });
                    }}
                  />
                  <Form form={towerForm} layout="vertical">
                    <Form.Item name="endpoint" label="S3 Endpoint" rules={[{ required: true, message: '必填' }]}>
                      <Input placeholder="https://…" autoComplete="off" disabled={!canWriteStores} />
                    </Form.Item>
                    <Space wrap align="start">
                      <Form.Item name="region" label="Region" style={{ width: 220 }}>
                        <Input placeholder="us-east-1" disabled={!canWriteStores} />
                      </Form.Item>
                      <Form.Item name="forcePathStyle" label="Path-Style" valuePropName="checked" style={{ marginTop: 30 }}>
                        <Switch checkedChildren="开" unCheckedChildren="关" disabled={!canWriteStores} />
                      </Form.Item>
                    </Space>
                    {canWriteStores ? (
                      <Space wrap style={{ marginTop: 8 }}>
                        <Button type="primary" loading={towerGwSaving} onClick={() => void saveTowerGw()}>
                          保存
                        </Button>
                        <Popconfirm title="清除该网关的 Tower S3 配置？" onConfirm={() => void clearTowerGw()}>
                          <Button loading={towerGwSaving}>清除</Button>
                        </Popconfirm>
                      </Space>
                    ) : (
                      <Typography.Text type="secondary">当前账号无写权限，仅可查看 YAML。</Typography.Text>
                    )}
                  </Form>
                  <Divider />
                </div>
              ),
            },
            {
              key: 'yaml',
              label: 'YAML',
              children: (
                <Spin spinning={detailYamlLoading}>
                  <CodeEditor language="yaml" value={detailYamlText} readOnly height={480} />
                </Spin>
              ),
            },
          ]}
        />
      ) : null}
    </Drawer>
  );

  const yamlDrawer = (
    <Drawer title={yamlTitle} width={640} open={yamlOpen} onClose={() => setYamlOpen(false)} destroyOnClose>
      <CodeEditor language="yaml" value={yamlText} readOnly height={480} />
    </Drawer>
  );

  if (embedMode === 'storesOnly') {
    return (
      <div style={{ width: '100%' }}>
        {storesTab}
        {createObjectStoreModal}
        {storeDetailDrawer}
      </div>
    );
  }
  if (embedMode === 'cosiOnly') {
    return (
      <div style={{ width: '100%' }}>
        {cosiTab}
        {yamlDrawer}
      </div>
    );
  }

  return (
    <div style={{ width: '100%' }}>
      <Tabs
        activeKey={activeTab}
        onChange={setActiveTab}
        items={[
          { key: 'stores', label: '对象网关', children: storesTab },
          { key: 'cosi', label: 'COSI 驱动', children: cosiTab },
        ]}
      />
      {createObjectStoreModal}
      {storeDetailDrawer}
      {yamlDrawer}
    </div>
  );
};

export default CephObjectStorageSection;
