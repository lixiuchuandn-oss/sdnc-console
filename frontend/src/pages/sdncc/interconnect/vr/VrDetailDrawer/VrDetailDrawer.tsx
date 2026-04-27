/**
 * VR 详情抽屉：对齐 Cloudmap 物理节点详情（PhysicalNodeDetailDrawer）— Ant Design Drawer
 * + Tabs：详情（含设备标识）/ 网卡信息（仅接口）+ 各 JSON 源。
 */
import React, { memo, useCallback, useEffect, useMemo, useState } from 'react';
import {
  Button,
  Descriptions,
  Drawer,
  Empty,
  Space,
  Spin,
  Table,
  Tabs,
  Typography,
} from 'antd';
import { SyncOutlined } from '@ant-design/icons';
import {
  fetchVrCacheMerged,
  fetchVrTowerLocalConfigCache,
} from '../../../../../services/virtualRouterApi';

// ---------- 类型：列表行、抽屉 props、元数据、JSON 源 Tab、Tower 本地缓存 ----------
export interface VrDetailRow {
  id?: string;
  vm_id?: string;
  name?: string;
  status?: string;
  pool_id?: string | number;
  pool_name?: string;
  cpu?: number;
  memory?: number;
  mac?: string;
  uuid?: string;
  version?: string;
  create_time?: string;
  vr_unique_id?: string;
  tenant_id?: string;
  org_id?: string;
  bind_status?: string;
  role?: string;
  region?: string;
  cloud?: string;
  type?: string;
  [key: string]: any;
}

interface VrDetailDrawerProps {
  open: boolean;
  onClose: () => void;
  row: VrDetailRow | null;
  rolesMap?: Record<string, string>;
  orgNameMap?: Record<string, string>;
}

type MetadataState = {
  csmctl: any;
  vr3?: any;
  vr2?: any;
  /** 聚合接口完整 data，用于概览 Tab 结构化展示；含 vr_tower_vrctl（Tower vr_config 整行） */
  mergedFull?: any | null;
} | null;

type DeviceJsonSource = 'csmctl' | 'vr2' | 'vr3' | 'towerConfig' | 'saseConfig';

/** 顶层 Tab：详情（实例/业务 + 设备标识）+ 网卡信息（接口列表）+ 各 JSON 源 */
type VrDrawerTab = 'detail' | 'nics' | DeviceJsonSource;

type TowerLocalConfigCache = {
  config: any;
  meta: { updatedAt?: string; role?: string } | null;
};

const { Text } = Typography;

const TAB_PANEL_PADDING: React.CSSProperties = { padding: '8px 0 16px' };
const TAB_PANEL_DEVICE: React.CSSProperties = {
  padding: '8px 0 16px',
  minHeight: 360,
  display: 'flex',
  flexDirection: 'column',
};
const TAB_BAR_STYLE: React.CSSProperties = { marginBottom: 8 };

/** 与 PhysicalNodeDetailDrawer 一致：Descriptions 标签列宽 */
const descLabelNarrow: React.CSSProperties = { width: 200 };

/** 无数据时不展示「-」「—」等占位符（与物理节点详情抽屉一致） */
function displayCell(v: unknown): string {
  if (v === undefined || v === null) return '';
  const s = String(v).trim();
  if (!s || s === 'undefined' || s === 'null') return '';
  return s;
}

/** 网卡表状态列：Typography 语义色（非 Tag） */
function nicStatusColored(raw: string): React.ReactNode {
  const t = displayCell(raw);
  if (!t) return null;
  const low = t.toLowerCase();
  if (['up', 'active', 'running', 'ok', 'online'].includes(low)) {
    return <Typography.Text type="success">{t}</Typography.Text>;
  }
  if (['down', 'inactive', 'error', 'failed', 'offline'].includes(low)) {
    return <Typography.Text type="danger">{t}</Typography.Text>;
  }
  if (['warn', 'warning', 'degraded'].includes(low) || low.includes('warn')) {
    return <Typography.Text type="warning">{t}</Typography.Text>;
  }
  return <Typography.Text type="secondary">{t}</Typography.Text>;
}

/** 网卡信息 Tab：与 Harvester 列表一致使用 std-table + bordered */
const VR_NIC_TABLE_COLUMNS = [
  {
    title: '网卡',
    dataIndex: 'name',
    key: 'name',
    width: 200,
    ellipsis: true,
  },
  {
    title: '状态',
    dataIndex: 'status',
    key: 'status',
    width: 100,
    render: (s: string) => nicStatusColored(s),
  },
  {
    title: 'IPv4',
    dataIndex: 'ipv4',
    key: 'ipv4',
    ellipsis: true,
    render: (v: string) => displayCell(v) || null,
  },
  {
    title: 'IPv6',
    dataIndex: 'ipv6',
    key: 'ipv6',
    ellipsis: true,
    render: (v: string) =>
      v ? (
        <span className="vr-nic-ipv6-cell">{String(v)}</span>
      ) : null,
  },
];

// ---------- 纯函数：健康状态归一化、字段格式化（供 Descriptions / JSON Tab 使用）----------
function normalizeHealth(
  raw: string,
): 'online' | 'offline' | 'warn' | 'unknown' {
  const s = String(raw || '').toLowerCase();
  if (['online', 'healthy', 'running', 'ok', 'active', 'up'].includes(s))
    return 'online';
  if (
    ['offline', 'down', 'stopped', 'error', 'failed', 'unhealthy'].includes(s)
  )
    return 'offline';
  if (['warning', 'degraded'].includes(s)) return 'warn';
  return 'unknown';
}

function fmtDate(v: unknown): string {
  if (v == null || v === '') return '—';
  const d = new Date(String(v));
  if (Number.isNaN(d.getTime())) return String(v);
  return d.toLocaleString();
}

/** 健康状态展示文案（由原始 health/status 推导） */
function healthStatusLabel(healthRaw: string): string {
  if (!healthRaw || healthRaw === '—') return '未知';
  if (healthRaw === 'ONLINE') return '在线';
  if (healthRaw === 'OFFLINE') return '离线';
  return healthRaw;
}

/** 详情 / 网卡：聚合行 + mergedFull，供 Descriptions 与各 JSON Tab */
function useOverviewModel(
  row: VrDetailRow | null,
  mergedFull: any | null | undefined,
  vrUuid: string,
  rolesMap: Record<string, string>,
  orgNameMap: Record<string, string>,
) {
  return useMemo(() => {
    if (!row && !mergedFull) return null;
    const m = mergedFull && typeof mergedFull === 'object' ? mergedFull : null;
    const base = m || (row as any);
    const ri =
      base.resourceIndicators || m?._raw_csmctl_info?.resourceIndicators;
    const healthRaw = base.health_status ?? row?.status ?? '';
    const health = normalizeHealth(String(healthRaw));
    const role =
      String(base.role || '') ||
      (vrUuid ? rolesMap[vrUuid] : '') ||
      String(row?.role || '') ||
      '';
    const interfaces = Array.isArray(base.interfaces) ? base.interfaces : [];
    const tenantId = base.tenant_id ?? base.tenantId ?? row?.tenant_id;
    const orgId = base.org_id ?? base.organizationId ?? row?.org_id;

    return {
      fromMerged: !!m,
      name: base.name ?? row?.name ?? '—',
      uuid: String(base.uuid || vrUuid || row?.uuid || '—'),
      id: base.id ?? row?.id,
      vm_id: base.vm_id ?? row?.vm_id,
      mac: base.mac ?? row?.mac,
      type: base.type ?? row?.type,
      version: base.version ?? row?.version,
      vr_unique_id: base.vr_unique_id ?? row?.vr_unique_id,
      pool_id: base.pool_id ?? row?.pool_id,
      pool_name: base.pool_name ?? row?.pool_name,
      gateway: base.gateway,
      createDate: base.createDate ?? base.create_time ?? row?.create_time,
      updateDate: base.updateDate,
      health,
      healthRaw: String(healthRaw || '—'),
      role: role || '—',
      resourceIndicators: ri,
      interfaces,
      tenant_id: tenantId,
      org_id: orgId,
      bind_status: base.bind_status ?? row?.bind_status,
      region: row?.region,
      cloud: row?.cloud,
      orgNameMap,
    };
  }, [row, mergedFull, vrUuid, rolesMap, orgNameMap]);
}

/** JSON 源 Tab：左侧行号 + 右侧等宽文本，区域内纵向滚动。 */
const DeviceJsonViewer: React.FC<{ loading?: boolean; text: string }> = memo(
  ({ loading, text }) => {
    const lines = useMemo(() => text.split('\n'), [text]);
    if (loading) {
      return (
        <div className="vr-detail-json-loading">
          <Spin />
        </div>
      );
    }
    return (
      <div className="vr-detail-json-viewport">
        <div className="vr-detail-json-scroll">
          <div className="vr-detail-json-inner">
            <div className="vr-detail-json-rows">
              <div aria-hidden className="vr-detail-json-linewrap">
                {lines.map((_, i) => (
                  <div key={i} className="vr-detail-json-linenum">
                    {i + 1}
                  </div>
                ))}
              </div>
              <div className="vr-detail-json-codecol">
                {lines.map((line, i) => (
                  <div key={i} className="vr-detail-json-codeline">
                    {line.length === 0 ? '\u00a0' : line}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  },
);
DeviceJsonViewer.displayName = 'DeviceJsonViewer';

// ---------- 主组件：Drawer + 多顶层 Tab（详情 / 网卡信息 / 各 JSON 源）----------
const VrDetailDrawer: React.FC<VrDetailDrawerProps> = ({
  open,
  onClose,
  row,
  rolesMap = {},
  orgNameMap = {},
}) => {
  const [activeTab, setActiveTab] = useState<VrDrawerTab>('detail');
  const [metadataLoading, setMetadataLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [currentMetadata, setCurrentMetadata] = useState<MetadataState>(null);
  const [towerLocalConfigCache, setTowerLocalConfigCache] =
    useState<TowerLocalConfigCache | null>(null);
  const [towerLocalConfigCacheError, setTowerLocalConfigCacheError] = useState<
    string | null
  >(null);

  const vrUuid = useMemo(
    () => String(row?.uuid || row?.vr_unique_id || row?.vm_id || '').trim(),
    [row],
  );

  /** 拉取聚合缓存 + Tower 本地 vr_config，供 Descriptions 与各 JSON Tab 展示 */
  const loadMetadata = useCallback(async () => {
    if (!row || !vrUuid) {
      setCurrentMetadata(null);
      return;
    }
    const id = vrUuid;

    // 先用列表行上的合并字段占位，再以 GET /api/vr-instances/:uuid 刷新（VR1 + VR3 + 本地设备 + 可选 VR2）
    const r = row as any;
    const rowLooksMerged =
      r &&
      (Array.isArray(r.interfaces) || r.resourceIndicators || r.health_status);
    setCurrentMetadata({
      csmctl: r._raw_csmctl_info ?? {},
      vr3: r.vr3_info ?? null,
      vr2: r.vr2_info ?? null,
      mergedFull: rowLooksMerged ? r : null,
    });

    setMetadataLoading(true);
    setTowerLocalConfigCache(null);
    setTowerLocalConfigCacheError(null);
    try {
      const [merged, towerCached] = await Promise.all([
        fetchVrCacheMerged(id).catch((e) => {
          console.warn(
            '[VrDetailDrawer] fetchVrCacheMerged failed, keeping list row snapshot:',
            e,
          );
          return null;
        }),
        fetchVrTowerLocalConfigCache(id, { skipCache: true }).catch((e) => {
          const msg = e instanceof Error ? e.message : String(e);
          setTowerLocalConfigCacheError(msg);
          return null;
        }),
      ]);
      if (merged && typeof merged === 'object') {
        const m = merged as Record<string, any>;
        setCurrentMetadata({
          mergedFull: m,
          csmctl: m._raw_csmctl_info ?? {},
          vr3: m.vr3_info ?? null,
          vr2: m.vr2_info ?? null,
        });
      }
      if (towerCached) setTowerLocalConfigCache(towerCached);
    } finally {
      setMetadataLoading(false);
    }
  }, [row, vrUuid]);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await loadMetadata();
    } finally {
      setRefreshing(false);
    }
  }, [loadMetadata]);

  // 关闭抽屉时回到默认 Tab
  useEffect(() => {
    if (!open) {
      setActiveTab('detail');
    }
  }, [open]);

  // 打开且切换实例（uuid）时回到详情
  useEffect(() => {
    if (open && vrUuid) {
      setActiveTab('detail');
    }
  }, [open, vrUuid]);

  // 打开抽屉且可选中行时拉数据
  useEffect(() => {
    if (!open) return;
    if (row && vrUuid) {
      void loadMetadata();
    }
  }, [open, row, vrUuid, loadMetadata]);

  const overview = useOverviewModel(
    row,
    currentMetadata?.mergedFull,
    vrUuid,
    rolesMap,
    orgNameMap,
  );

  /** 详情「状态」项：Typography 语义色，不用 Tag */
  const statusCell = useMemo(() => {
    if (!overview) return <Typography.Text type="secondary">未知</Typography.Text>;
    const { health, healthRaw } = overview;
    const label = healthStatusLabel(healthRaw);
    if (health === 'online') return <Typography.Text type="success">{label}</Typography.Text>;
    if (health === 'offline') return <Typography.Text type="danger">{label}</Typography.Text>;
    if (health === 'warn') return <Typography.Text type="warning">{label}</Typography.Text>;
    return <Typography.Text>{label}</Typography.Text>;
  }, [overview]);

  const getDeviceJsonText = useCallback(
    (sub: DeviceJsonSource): string => {
      const m = currentMetadata;
      if (sub === 'csmctl') return JSON.stringify(m?.csmctl ?? {}, null, 2);
      if (sub === 'towerConfig') {
        if (towerLocalConfigCacheError)
          return `加载 Tower 本地配置缓存失败：${towerLocalConfigCacheError}`;
        if (!towerLocalConfigCache) {
          return 'Tower 本地尚未保存该 VR 的配置（数据库无 vr_config 缓存记录）';
        }
        return JSON.stringify(
          {
            _towerLocalMeta: towerLocalConfigCache.meta ?? null,
            config: towerLocalConfigCache.config,
          },
          null,
          2,
        );
      }
      if (sub === 'saseConfig') {
        const vrctl = m?.mergedFull?.vr_tower_vrctl;
        if (vrctl && typeof vrctl === 'object') {
          return JSON.stringify(vrctl, null, 2);
        }
        return '暂无租户侧 vrctl 数据（Tower 未同步 vr_cache_device，或该 VR 无本地 vr_config / 绑定记录）。可尝试刷新列表缓存或完成租户绑定后再查看。';
      }
      if (sub === 'vr2') {
        return m?.vr2
          ? JSON.stringify(m.vr2, null, 2)
          : '暂无 VR2 实时数据（聚合接口未返回或 CSMCTL 不可用）';
      }
      return m?.vr3 ? JSON.stringify(m.vr3, null, 2) : '暂无扩展信息或获取失败';
    },
    [currentMetadata, towerLocalConfigCache, towerLocalConfigCacheError],
  );

  const drawerTitle = overview?.name || row?.name || 'VR 实例详情';

  const tabItems = useMemo(() => {
    if (!row) return [];
    if (!overview) return [];

    const jsonPane = (key: DeviceJsonSource, label: string) => ({
      key,
      label,
      children: (
        <div style={TAB_PANEL_DEVICE}>
          <DeviceJsonViewer
            loading={metadataLoading && key !== 'csmctl'}
            text={getDeviceJsonText(key)}
          />
        </div>
      ),
    });

    type KvRow = { key: string; field: string; value: React.ReactNode };
    const detailRows: KvRow[] = [];
    const push = (bucket: KvRow[], key: string, field: string, value: React.ReactNode) => {
      if (value === null || value === undefined || value === '') return;
      bucket.push({ key, field, value });
    };

    push(detailRows, 'name', '名称', overview.name);
    push(detailRows, 'status', '状态', statusCell);

    const ri = overview.resourceIndicators;
    if (ri && typeof ri === 'object') {
      push(
        detailRows,
        'cpu',
        'CPU 使用',
        `${Number(ri.cpuUsed ?? 0).toFixed(1)}% · ${ri.cpuTotal ?? '—'} 核`,
      );
      push(
        detailRows,
        'mem',
        '内存使用',
        `${Number(ri.memoryUsed ?? 0).toFixed(1)}% · ${ri.memoryTotal ?? '—'} GiB`,
      );
    }

    if (displayCell(overview.type)) push(detailRows, 'type', '类型', displayCell(overview.type));
    if (displayCell(overview.uuid)) {
      push(detailRows, 'uuid', 'UUID', displayCell(overview.uuid));
    }
    if (displayCell(overview.version)) {
      push(detailRows, 'ver', '版本', displayCell(overview.version));
    }

    if (displayCell(overview.id)) {
      push(detailRows, 'id', '设备 ID', displayCell(overview.id));
    }
    if (displayCell(overview.vm_id)) {
      push(detailRows, 'vm', '虚拟机 ID', displayCell(overview.vm_id));
    }
    if (displayCell(overview.mac)) {
      push(detailRows, 'mac', 'MAC', displayCell(overview.mac));
    }
    if (displayCell(overview.vr_unique_id)) {
      push(detailRows, 'vruid', 'VR 唯一标识', displayCell(overview.vr_unique_id));
    }

    if (displayCell(overview.healthRaw)) {
      push(detailRows, 'health', '健康状态（原始）', displayCell(overview.healthRaw));
    }
    if (
      displayCell(overview.role) &&
      overview.role !== '—' &&
      String(overview.role).trim()
    ) {
      push(detailRows, 'role', '角色', String(overview.role).trim());
    }

    const poolText =
      overview.pool_name || overview.pool_id !== undefined
        ? `${overview.pool_name || ''}${
            overview.pool_id !== undefined &&
            overview.pool_id !== '' &&
            String(overview.pool_id) !== String(overview.pool_name)
              ? ` (${overview.pool_id})`
              : ''
          }`.trim()
        : '';
    if (poolText) push(detailRows, 'pool', '资源池', poolText);

    if (displayCell(overview.gateway)) {
      push(detailRows, 'gw', '默认网关', displayCell(overview.gateway));
    }
    if (displayCell(overview.tenant_id)) {
      push(detailRows, 'tenant', '租户 ID', displayCell(overview.tenant_id));
    }
    if (overview.org_id && overview.orgNameMap[String(overview.org_id)]) {
      push(
        detailRows,
        'org',
        '组织',
        <Space size="small" wrap>
          <span>{overview.orgNameMap[String(overview.org_id)]}</span>
          <Text type="secondary">({overview.org_id})</Text>
        </Space>,
      );
    } else if (displayCell(overview.org_id)) {
      push(detailRows, 'org', '组织', displayCell(overview.org_id));
    }
    if (displayCell(overview.bind_status)) {
      push(detailRows, 'bind', '绑定状态', displayCell(overview.bind_status));
    }
    if (displayCell(overview.region)) {
      push(detailRows, 'region', '区域', displayCell(overview.region));
    }
    if (displayCell(overview.cloud)) {
      push(detailRows, 'cloud', '云名称', displayCell(overview.cloud));
    }
    if (overview.createDate) {
      push(detailRows, 'cd', '创建时间', fmtDate(overview.createDate));
    }
    if (overview.updateDate) {
      push(detailRows, 'ud', '更新时间', fmtDate(overview.updateDate));
    }

    const nicDataSource = overview.interfaces.map((it: any, idx: number) => ({
      key: `if-${idx}`,
      name: displayCell(it?.name) || `网卡 ${idx + 1}`,
      status: String(it?.status ?? '').trim(),
      ipv4: displayCell(it?.ipv4_static),
      ipv6: it?.ipv6_static ? String(it.ipv6_static).trim() : '',
    }));

    const mergeHint =
      metadataLoading && !overview.fromMerged ? (
        <div className="vr-detail-merge-hint">
          <Space>
            <Spin size="small" />
            <Typography.Text type="secondary">正在拉取聚合详情…</Typography.Text>
          </Space>
        </div>
      ) : null;

    const kvDescriptions = (rows: KvRow[], emptyDesc: string) =>
      rows.length ? (
        <Descriptions bordered size="small" column={1} labelStyle={descLabelNarrow}>
          {rows.map((r) => (
            <Descriptions.Item key={r.key} label={r.field}>
              {r.value}
            </Descriptions.Item>
          ))}
        </Descriptions>
      ) : (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={emptyDesc} />
      );

    return [
      {
        key: 'detail',
        label: '详情',
        children: (
          <div style={TAB_PANEL_PADDING}>
            {kvDescriptions(detailRows, '暂无数据')}
            {mergeHint}
          </div>
        ),
      },
      {
        key: 'nics',
        label: '网卡信息',
        children: (
          <div style={TAB_PANEL_PADDING}>
            <Table
              className="std-table"
              size="small"
              bordered
              rowKey="key"
              pagination={false}
              scroll={nicDataSource.length > 0 ? ({ x: true } as const) : undefined}
              locale={{ emptyText: '暂无网卡数据' }}
              dataSource={nicDataSource}
              columns={VR_NIC_TABLE_COLUMNS as any}
            />
          </div>
        ),
      },
      jsonPane('csmctl', '注册信息 (VR1)'),
      jsonPane('vr2', '实时配置 (VR2)'),
      jsonPane('vr3', '设备信息 (VR3)'),
      jsonPane('towerConfig', '本地配置 (Cache)'),
      jsonPane('saseConfig', '租户配置 (Sase)'),
    ];
  }, [row, overview, statusCell, getDeviceJsonText, metadataLoading]);

  return (
    <Drawer
      title={drawerTitle}
      extra={
        <Button
          size="small"
          icon={<SyncOutlined spin={refreshing || metadataLoading} />}
          onClick={() => void handleRefresh()}
        >
          刷新
        </Button>
      }
      open={open}
      onClose={onClose}
      width="min(1000px, 96vw)"
      placement="right"
      destroyOnHidden
    >
      {!row ? (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="未选择实例" />
      ) : (
        <Tabs
          activeKey={activeTab}
          onChange={(k) => setActiveTab(k as VrDrawerTab)}
          tabBarStyle={TAB_BAR_STYLE}
          items={tabItems}
        />
      )}
    </Drawer>
  );
};

export default VrDetailDrawer;
