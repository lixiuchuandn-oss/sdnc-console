/**
 * Cloudmap · RGW / S3：网关 Endpoint 等在对象网关详情维护（clouds.config）；本页只读解析并代发 S3。
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  App,
  Button,
  Drawer,
  Input,
  Select,
  Space,
  Table,
  Typography,
} from 'antd';
import { PlusOutlined, ReloadOutlined, UnorderedListOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import PageDetailSection from '../../../../../../components/PageDetailSection';
import {
  fetchCephRookBundle,
  fetchRgwGatewayClientConfig,
  rgwS3CreateBucket,
  rgwS3DeleteBucket,
  rgwS3ListBuckets,
  rgwS3ListObjects,
  type RgwS3GatewayPayload,
  type RgwS3ObjectStoreUserRef,
} from '../../../../../../services/cephApi';
import { normalizeCephBundle } from '../lib/cephStorage';
import { objectStoreUserGatewayStoreKey, objectStoreUserSelectOptions } from '../lib/rgwRookHints';
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

export type RgwS3BucketsSectionProps = {
  cloudId: string;
  checkPerm: (act: string) => boolean;
  onRefresh?: HarvesterSectionOnRefresh;
};

type BucketRow = { name: string; creationDate?: string };
type ObjRow = { key: string; size: number; lastModified?: string };

function parseOsUserKey(key: string | undefined): RgwS3ObjectStoreUserRef | null {
  if (!key) return null;
  const i = key.indexOf('/');
  if (i <= 0 || i >= key.length - 1) return null;
  return { namespace: key.slice(0, i), name: key.slice(i + 1) };
}

const RgwS3BucketsSection: React.FC<RgwS3BucketsSectionProps> = ({
  cloudId,
  checkPerm,
  onRefresh,
}) => {
  const { message } = App.useApp();
  const [loading, setLoading] = useState(false);
  const [buckets, setBuckets] = useState<BucketRow[]>([]);
  const [createOpen, setCreateOpen] = useState(false);
  const [createLoading, setCreateLoading] = useState(false);
  const [createName, setCreateName] = useState('');
  const [objectsOpen, setObjectsOpen] = useState(false);
  const [objectsBucket, setObjectsBucket] = useState('');
  const [objectsLoading, setObjectsLoading] = useState(false);
  const [objectsRows, setObjectsRows] = useState<ObjRow[]>([]);
  const [objectsPrefix, setObjectsPrefix] = useState('');
  const [objectsNextToken, setObjectsNextToken] = useState<string | undefined>(undefined);
  const [rookLoading, setRookLoading] = useState(false);
  const [objectStoreUsers, setObjectStoreUsers] = useState<any[]>([]);
  const [selectedOsUserKey, setSelectedOsUserKey] = useState<string | undefined>(undefined);
  const [clientGwMap, setClientGwMap] = useState<Record<string, RgwS3GatewayPayload>>({});

  const canWrite = useMemo(
    () => checkPerm('clouds.storage-s3-buckets:write') || checkPerm('clouds:write'),
    [checkPerm],
  );

  const loadGatewayMap = useCallback(
    async (force?: boolean) => {
      if (!cloudId) return;
      const res = await fetchRgwGatewayClientConfig(cloudId, { force: !!force });
      if (!res.ok || !res.data?.byStore) return;
      setClientGwMap(res.data.byStore as Record<string, RgwS3GatewayPayload>);
    },
    [cloudId],
  );

  const loadRookBundle = useCallback(async (force?: boolean) => {
    if (!cloudId) return;
    setRookLoading(true);
    try {
      const res = await fetchCephRookBundle(cloudId, { force: force !== false });
      if (!res.ok || !res.data) {
        setObjectStoreUsers([]);
        if (res.error) message.warning(`未能加载 Rook 聚合：${res.error}`);
        return;
      }
      const b = normalizeCephBundle(res.data);
      setObjectStoreUsers(b.objectStoreUsers || []);
    } finally {
      setRookLoading(false);
    }
  }, [cloudId, message]);

  useEffect(() => {
    void loadRookBundle();
    void loadGatewayMap();
  }, [loadRookBundle, loadGatewayMap]);

  const osUserSelectOptions = useMemo(() => objectStoreUserSelectOptions(objectStoreUsers), [objectStoreUsers]);

  const selectedRawUser = useMemo(() => {
    if (!selectedOsUserKey) return null;
    return objectStoreUsers.find((u) => {
      const ns = String(u?.metadata?.namespace ?? '').trim();
      const nm = String(u?.metadata?.name ?? '').trim();
      return `${ns}/${nm}` === selectedOsUserKey;
    });
  }, [objectStoreUsers, selectedOsUserKey]);

  const gatewayStoreKey = useMemo(() => objectStoreUserGatewayStoreKey(selectedRawUser), [selectedRawUser]);

  const towerGatewayForSelection = useMemo(() => {
    if (!gatewayStoreKey) return null;
    return clientGwMap[gatewayStoreKey] ?? null;
  }, [clientGwMap, gatewayStoreKey]);

  const buildS3ProxyArgs = useCallback((): {
    gateway: RgwS3GatewayPayload;
    userRef: RgwS3ObjectStoreUserRef;
  } | null => {
    const userRef = parseOsUserKey(selectedOsUserKey);
    if (!userRef?.namespace || !userRef?.name) {
      message.warning('请选择 RGW 用户');
      return null;
    }
    const sk = objectStoreUserGatewayStoreKey(selectedRawUser);
    if (!sk) {
      message.warning('所选用户缺少 spec.store，无法关联对象网关');
      return null;
    }
    const gw = clientGwMap[sk];
    if (!gw?.endpoint?.trim()) {
      message.warning('请先在「对象网关」详情中为该网关配置 Tower S3 Endpoint');
      return null;
    }
    return {
      gateway: {
        endpoint: gw.endpoint.trim(),
        region: gw.region ?? 'us-east-1',
        forcePathStyle: gw.forcePathStyle !== false,
      },
      userRef,
    };
  }, [clientGwMap, message, selectedOsUserKey, selectedRawUser]);

  const loadBuckets = useCallback(
    async (force?: boolean) => {
      if (!cloudId) return;
      if (force) {
        await loadGatewayMap(true);
      }
      const args = buildS3ProxyArgs();
      if (!args) return;
      setLoading(true);
      try {
        const res = await rgwS3ListBuckets(cloudId, args.gateway, args.userRef);
        if (!res.ok) {
          message.error(res.error || '列举存储桶失败');
          setBuckets([]);
          return;
        }
        const list = (res.data as any)?.buckets as BucketRow[] | undefined;
        setBuckets(Array.isArray(list) ? list : []);
        if (force) message.success('已刷新存储桶列表');
      } finally {
        setLoading(false);
      }
    },
    [buildS3ProxyArgs, cloudId, loadGatewayMap, message],
  );

  const sectionOnRefresh = useMemo(
    () => mergeCephSectionOnRefresh((force) => loadBuckets(force !== false), onRefresh),
    [loadBuckets, onRefresh],
  );

  const handleRefreshRook = useMemo(
    () => createHarvesterToolbarRefresh((force) => loadRookBundle(force !== false)),
    [loadRookBundle],
  );

  const handleRefreshBuckets = useMemo(
    () => createHarvesterToolbarRefresh(sectionOnRefresh),
    [sectionOnRefresh],
  );

  const openObjects = useCallback((bucket: string) => {
    setObjectsBucket(bucket);
    setObjectsRows([]);
    setObjectsPrefix('');
    setObjectsNextToken(undefined);
    setObjectsOpen(true);
  }, []);

  const loadObjectsPage = useCallback(
    async (opts?: { append?: boolean; continuationToken?: string }) => {
      const args = buildS3ProxyArgs();
      if (!args || !objectsBucket) return;
      setObjectsLoading(true);
      try {
        const res = await rgwS3ListObjects(cloudId, args.gateway, args.userRef, {
          bucket: objectsBucket,
          prefix: objectsPrefix.trim() || undefined,
          continuationToken: opts?.continuationToken,
          maxKeys: 500,
        });
        if (!res.ok) {
          message.error(res.error || '列举对象失败');
          return;
        }
        const data = res.data as any;
        const rows = (data?.contents || []) as ObjRow[];
        setObjectsNextToken(data?.continuationToken as string | undefined);
        if (opts?.append) {
          setObjectsRows((prev) => [...prev, ...rows]);
        } else {
          setObjectsRows(rows);
        }
      } finally {
        setObjectsLoading(false);
      }
    },
    [buildS3ProxyArgs, cloudId, message, objectsBucket, objectsPrefix],
  );

  const submitCreate = useCallback(async () => {
    const name = createName.trim();
    if (!name) {
      message.warning('请输入存储桶名称');
      return;
    }
    const args = buildS3ProxyArgs();
    if (!args) return;
    setCreateLoading(true);
    try {
      const res = await rgwS3CreateBucket(cloudId, args.gateway, args.userRef, name);
      if (!res.ok) {
        message.error(res.error || '创建失败');
        return;
      }
      message.success('存储桶已创建');
      setCreateOpen(false);
      setCreateName('');
      await runHarvesterSectionRefresh(sectionOnRefresh, { force: true });
    } finally {
      setCreateLoading(false);
    }
  }, [buildS3ProxyArgs, cloudId, createName, message, sectionOnRefresh]);

  const columns: ColumnsType<BucketRow> = useMemo(
    () => [
      {
        title: '存储桶名称',
        dataIndex: 'name',
        key: 'name',
        fixed: 'left',
        ellipsis: true,
      },
      {
        title: '创建时间',
        dataIndex: 'creationDate',
        key: 'creationDate',
        width: 220,
        render: (v: string | undefined) => v || '—',
      },
      {
        title: '操作',
        key: 'actions',
        fixed: 'right',
        width: 260,
        render: (_, r) => (
          <Space size="small">
            <Button type="link" size="small" icon={<UnorderedListOutlined />} onClick={() => openObjects(r.name)}>
              对象列表
            </Button>
            {canWrite ? (
              <Button
                type="link"
                size="small"
                danger
                onClick={() =>
                  void confirmHighRiskDelete({
                    resourceLabel: 'S3 存储桶',
                    name: r.name,
                    description: '仅允许删除空桶；删除后不可恢复。',
                    riskItems: CEPH_STORAGE_RISK_ITEMS,
                    onConfirm: async () => {
                      const args = buildS3ProxyArgs();
                      if (!args) return;
                      const del = await rgwS3DeleteBucket(
                        cloudId,
                        args.gateway,
                        args.userRef,
                        r.name,
                      );
                      if (!del.ok) {
                        message.error(del.error || '删除失败');
                        return;
                      }
                      message.success('已删除');
                      await runHarvesterSectionRefresh(sectionOnRefresh, { force: true });
                    },
                  }).catch(() => {})
                }
              >
                删除
              </Button>
            ) : null}
          </Space>
        ),
      },
    ],
    [buildS3ProxyArgs, canWrite, cloudId, message, openObjects, sectionOnRefresh],
  );

  const objColumns: ColumnsType<ObjRow> = useMemo(
    () => [
      {
        title: '对象键',
        dataIndex: 'key',
        key: 'key',
        ellipsis: true,
      },
      {
        title: '大小（字节）',
        dataIndex: 'size',
        key: 'size',
        width: 120,
      },
      {
        title: '上次修改',
        dataIndex: 'lastModified',
        key: 'lastModified',
        width: 220,
        render: (v: string | undefined) => v || '—',
      },
    ],
    [],
  );

  const endpointHint = useMemo(() => {
    if (!selectedOsUserKey) return null;
    if (!gatewayStoreKey) return { kind: 'bad_user' as const };
    if (!towerGatewayForSelection?.endpoint) return { kind: 'missing_cfg' as const, storeKey: gatewayStoreKey };
    const g = towerGatewayForSelection;
    const tail = [g.region ?? 'us-east-1', g.forcePathStyle === false ? 'virtual-hosted' : 'path-style'].join(' · ');
    return { kind: 'ok' as const, text: `${g.endpoint}（${tail}）` };
  }, [gatewayStoreKey, selectedOsUserKey, towerGatewayForSelection]);

  return (
    <>
      <PageDetailSection
        asCard={false}
        toolbarLeft={
          <>
            <Select
              allowClear
              showSearch
              optionFilterProp="label"
              className="toolbar-filter"
              placeholder={osUserSelectOptions.length ? 'RGW 用户' : undefined}
              options={osUserSelectOptions.map((o) => ({ label: o.label, value: o.value }))}
              value={selectedOsUserKey}
              onChange={setSelectedOsUserKey}
              loading={rookLoading}
            />
            {endpointHint?.kind === 'ok' ? (
              <Typography.Text type="secondary" ellipsis style={{ maxWidth: 520 }} title={endpointHint.text}>
                Tower S3：{endpointHint.text}
              </Typography.Text>
            ) : endpointHint?.kind === 'missing_cfg' ? (
              <Typography.Text type="warning">
                未配置 Tower S3（网关 {endpointHint.storeKey}，请在对象网关详情维护）
              </Typography.Text>
            ) : endpointHint?.kind === 'bad_user' ? (
              <Typography.Text type="warning">所选用户缺少 spec.store</Typography.Text>
            ) : null}
            <button type="button" className="toolbar-reset-btn" onClick={() => setSelectedOsUserKey(undefined)}>
              重置
            </button>
          </>
        }
        toolbarRight={
          <>
            <Button icon={<ReloadOutlined />} onClick={handleRefreshRook} loading={rookLoading}>
              刷新 Rook
            </Button>
            <Button icon={<ReloadOutlined />} onClick={handleRefreshBuckets} loading={loading}>
              刷新列表
            </Button>
            {canWrite ? (
              <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreateOpen(true)}>
                新建存储桶
              </Button>
            ) : null}
          </>
        }
      >
        <Table<BucketRow>
          className="std-table"
          rowKey="name"
          bordered={false}
          loading={loading}
          columns={columns}
          dataSource={buckets}
          pagination={{
            pageSize: 15,
            showSizeChanger: true,
            showTotal: (total) => `共 ${total} 条`,
          }}
          scroll={{ x: true }}
          locale={{ emptyText: !loading ? '暂无数据' : undefined }}
        />
      </PageDetailSection>

      <Drawer
        title="新建存储桶"
        placement="right"
        width={420}
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        destroyOnClose
        footer={
          <Space style={{ justifyContent: 'flex-end', width: '100%' }}>
            <Button onClick={() => setCreateOpen(false)}>取消</Button>
            <Button type="primary" loading={createLoading} onClick={() => void submitCreate()}>
              创建
            </Button>
          </Space>
        }
      >
        <Input
          placeholder="bucket-name"
          value={createName}
          onChange={(e) => setCreateName(e.target.value)}
          autoComplete="off"
        />
      </Drawer>

      <Drawer
        title={`对象列表 · ${objectsBucket}`}
        width={720}
        open={objectsOpen}
        onClose={() => setObjectsOpen(false)}
        destroyOnClose
        afterOpenChange={(open) => {
          if (open && objectsBucket) {
            void loadObjectsPage({ append: false });
          }
        }}
        extra={
          <Space>
            <Input.Search
              allowClear
              placeholder="前缀过滤"
              style={{ width: 220 }}
              onSearch={() => void loadObjectsPage({ append: false })}
              value={objectsPrefix}
              onChange={(e) => setObjectsPrefix(e.target.value)}
            />
            <Button icon={<ReloadOutlined />} onClick={() => void loadObjectsPage({ append: false })} loading={objectsLoading}>
              刷新
            </Button>
          </Space>
        }
      >
        <Table<ObjRow>
          className="std-table"
          rowKey={(r) => r.key}
          size="small"
          loading={objectsLoading}
          columns={objColumns}
          dataSource={objectsRows}
          pagination={false}
          scroll={{ x: true }}
        />
        {objectsNextToken ? (
          <div style={{ marginTop: 12, textAlign: 'center' }}>
            <Button
              loading={objectsLoading}
              onClick={() => void loadObjectsPage({ append: true, continuationToken: objectsNextToken })}
            >
              加载更多
            </Button>
          </div>
        ) : null}
      </Drawer>
    </>
  );
};

export default RgwS3BucketsSection;
