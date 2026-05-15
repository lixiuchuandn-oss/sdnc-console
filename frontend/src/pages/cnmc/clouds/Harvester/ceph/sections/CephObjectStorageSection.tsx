/** Cloudmap Ceph · 对象存储：`CephObjectStore` 列表 + COSI 驱动（Rook bundle + Steve GET/DELETE）。 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Button, Drawer, Input, Popconfirm, Space, Spin, Table, Tabs, Typography, message } from 'antd';
import { ReloadOutlined, SearchOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import yaml from 'js-yaml';
import PageDetailSection from '../../../../../../components/PageDetailSection';
import CodeEditor from '../../../../../../components/CodeEditor';
import { deleteCephObjectStoreRook, fetchCephRookBundle, getCephObjectStoreRook } from '../../../../../../services/cephApi';
import { normalizeCephBundle } from '../lib/cephStorage';
import { cosiDriverCrToRow, objectStoreCrToRow, type CephCosiDriverRow, type CephObjectStoreRow } from '../lib/cephBlockStorage';

export type CephObjectStorageSectionProps = {
  cloudId: string;
  /** 全页双 Tab；Cloudmap 侧栏分栏时仅渲染单块，避免嵌套 Tabs */
  embedMode?: 'full' | 'storesOnly' | 'cosiOnly';
};

type YamlTarget = { kind: 'objectStore'; namespace: string; name: string } | { kind: 'cosi'; yaml: string };

const CephObjectStorageSection: React.FC<CephObjectStorageSectionProps> = ({ cloudId, embedMode = 'full' }) => {
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
  const [yamlLoading, setYamlLoading] = useState(false);

  const load = useCallback(
    async (force?: boolean) => {
      if (!cloudId) return;
      setLoading(true);
      setLoadErr(null);
      try {
        const res = await fetchCephRookBundle(cloudId, { force: !!force });
        if (!res.ok || res.data == null) {
          setStoreRows([]);
          setCosiRows([]);
          setLoadErr(res.error || '无法加载 Ceph Rook 聚合');
          return;
        }
        const bundle = normalizeCephBundle(res.data);
        setStoreRows((bundle.objectStores || []).map(objectStoreCrToRow));
        setCosiRows((bundle.cosiDrivers || []).map(cosiDriverCrToRow));
      } catch (e: unknown) {
        setLoadErr(e instanceof Error ? e.message : '加载失败');
        setStoreRows([]);
        setCosiRows([]);
      } finally {
        setLoading(false);
      }
    },
    [cloudId],
  );

  useEffect(() => {
    void load();
  }, [load]);

  const openYamlDrawer = useCallback(
    async (t: YamlTarget) => {
      setYamlOpen(true);
      setYamlLoading(true);
      setYamlText('');
      try {
        if (t.kind === 'cosi') {
          setYamlTitle('COSI 驱动 · YAML');
          setYamlText(t.yaml);
          return;
        }
        setYamlTitle(`对象存储 · ${t.namespace}/${t.name}`);
        const res = await getCephObjectStoreRook(cloudId, t.namespace, t.name);
        if (!res.ok || res.data == null) {
          message.error(res.error || '拉取详情失败');
          setYamlText('# 加载失败');
          return;
        }
        setYamlText(yaml.dump(res.data, { lineWidth: 120, noRefs: true }));
      } finally {
        setYamlLoading(false);
      }
    },
    [cloudId],
  );

  const filteredStores = useMemo(() => {
    const q = storeQ.trim().toLowerCase();
    if (!q) return storeRows;
    return storeRows.filter(
      (r) => r.name.toLowerCase().includes(q) || r.namespace.toLowerCase().includes(q) || r.phase.toLowerCase().includes(q),
    );
  }, [storeRows, storeQ]);

  const filteredCosi = useMemo(() => {
    const q = cosiQ.trim().toLowerCase();
    if (!q) return cosiRows;
    return cosiRows.filter(
      (r) => r.name.toLowerCase().includes(q) || r.namespace.toLowerCase().includes(q),
    );
  }, [cosiRows, cosiQ]);

  const storeColumns: ColumnsType<CephObjectStoreRow> = useMemo(
    () => [
      { title: '名称', dataIndex: 'name', key: 'name', fixed: 'left', ellipsis: true },
      { title: '命名空间', dataIndex: 'namespace', key: 'namespace', width: 140, ellipsis: true },
      { title: '阶段', dataIndex: 'phase', key: 'phase', width: 120, ellipsis: true },
      {
        title: '操作',
        key: 'actions',
        fixed: 'right',
        width: 168,
        render: (_, r) => (
          <Space size="small">
            <Typography.Link
              onClick={() => {
                void openYamlDrawer({ kind: 'objectStore', namespace: r.namespace, name: r.name });
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
    [cloudId, load, openYamlDrawer],
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
      title="对象存储"
      toolbarLeft={
        <Input.Search
          allowClear
          placeholder="搜索名称、命名空间、阶段"
          style={{ width: 280 }}
          prefix={<SearchOutlined />}
          value={storeQ}
          onChange={(e) => setStoreQ(e.target.value)}
        />
      }
      toolbarRight={
        <Button icon={<ReloadOutlined />} onClick={() => void load(true)}>
          刷新
        </Button>
      }
    >
      <Typography.Paragraph type="secondary" style={{ marginBottom: 12, fontSize: 13 }}>
        Rook <Typography.Text code>CephObjectStore</Typography.Text>：集群内 RGW/对象网关实例。新建/复杂变更可在集群侧或通过 API 提交完整 CR。
      </Typography.Paragraph>
      {loadErr ? (
        <Alert type="error" showIcon message={loadErr} style={{ marginBottom: 12 }} />
      ) : null}
      <Spin spinning={loading}>
        <Table<CephObjectStoreRow>
          className="std-table"
          rowKey="key"
          size="small"
          columns={storeColumns}
          dataSource={filteredStores}
          pagination={{ pageSize: 15, showSizeChanger: true }}
          scroll={{ x: true }}
          locale={{ emptyText: storeRows.length === 0 && !loading ? '未发现 CephObjectStore CR' : undefined }}
        />
      </Spin>
    </PageDetailSection>
  );

  const cosiTab = (
    <PageDetailSection
      title="COSI 驱动"
      toolbarLeft={
        <Input.Search
          allowClear
          placeholder="搜索名称、命名空间"
          style={{ width: 260 }}
          value={cosiQ}
          onChange={(e) => setCosiQ(e.target.value)}
        />
      }
      toolbarRight={
        <Button icon={<ReloadOutlined />} onClick={() => void load(true)}>
          刷新
        </Button>
      }
    >
      <Typography.Paragraph type="secondary" style={{ marginBottom: 12, fontSize: 13 }}>
        <Typography.Text code>CephCOSIDriver</Typography.Text>
        ：供 Kubernetes COSI（BucketClaim 等）对接 Ceph 对象能力。以下为 bundle 列表；完整 YAML 可点行内「YAML」。
      </Typography.Paragraph>
      <Spin spinning={loading}>
        <Table<CephCosiDriverRow>
          className="std-table"
          rowKey="key"
          size="small"
          columns={cosiColumns}
          dataSource={filteredCosi}
          pagination={{ pageSize: 15, showSizeChanger: true }}
          scroll={{ x: true }}
          locale={{ emptyText: cosiRows.length === 0 && !loading ? '未检测到 COSI 驱动 CR' : undefined }}
        />
      </Spin>
    </PageDetailSection>
  );

  const yamlDrawer = (
    <Drawer title={yamlTitle} width={640} open={yamlOpen} onClose={() => setYamlOpen(false)} destroyOnClose>
      <Spin spinning={yamlLoading}>
        <CodeEditor language="yaml" value={yamlText} readOnly height={480} />
      </Spin>
    </Drawer>
  );

  if (embedMode === 'storesOnly') {
    return (
      <div style={{ width: '100%' }}>
        {storesTab}
        {yamlDrawer}
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
      {yamlDrawer}
    </div>
  );
};

export default CephObjectStorageSection;
