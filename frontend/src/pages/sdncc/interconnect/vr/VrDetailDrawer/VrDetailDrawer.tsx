/**
 * VR 详情抽屉：右侧滑出，顶部标题区 → 主 Tab（概览 | 设备数据）→ 各 Tab 内容。
 * 下文「页面」均指该 Drawer 内的 UI。
 *
 * 代码顺序：类型 → Typography 解构与样式常量 → 纯函数与 healthStatusLabel → useOverviewModel →
 * DeviceJsonViewer → VrDetailDrawer（state → vrUuid → loadMetadata → handleRefresh → effect →
 * overview → statusTag → deviceJsonText → 渲染）。
 */
import React, { memo, useCallback, useEffect, useMemo, useState } from 'react';
import {
  Button,
  Card,
  Descriptions,
  Drawer,
  Progress,
  Segmented,
  Spin,
  Table,
  Tag,
  Tooltip,
  Typography,
} from 'antd';
import {
  ApiOutlined,
  CloseOutlined,
  DatabaseOutlined,
  ProfileOutlined,
  SyncOutlined,
} from '@ant-design/icons';
import {
  fetchVrCacheMerged,
  fetchVrTowerLocalConfigCache,
} from '../../../../../services/virtualRouterApi';

// ---------- 类型：列表行、抽屉 props、元数据、设备子 Tab、Tower 本地缓存 ----------
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

type DeviceSubTab = 'csmctl' | 'vr2' | 'vr3' | 'towerConfig' | 'saseConfig';

type TowerLocalConfigCache = {
  config: any;
  meta: { updatedAt?: string; role?: string } | null;
};

const { Text } = Typography;

// ---------- 样式常量：等宽字体、概览卡片标题 / 小标题 ----------
const VR_JSON_CODE_FONT =
  'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace';

// ---------- 纯函数：健康状态归一化、字段格式化（供概览 Descriptions / 表格 使用）----------
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

function fmt(v: unknown): string {
  if (v === null || v === undefined || v === '') return '—';
  return String(v);
}

function fmtDate(v: unknown): string {
  if (v == null || v === '') return '—';
  const d = new Date(String(v));
  if (Number.isNaN(d.getTime())) return String(v);
  return d.toLocaleString();
}

/** 顶栏健康 Tag 的文案（由原始 health/status 字符串推导） */
function healthStatusLabel(healthRaw: string): string {
  if (!healthRaw || healthRaw === '—') return '未知';
  if (healthRaw === 'ONLINE') return '在线';
  if (healthRaw === 'OFFLINE') return '离线';
  return healthRaw;
}

/** 卡片区块标题：对齐 PhysicalNodeDetailDrawer（物理节点详情抽屉） */
const VR_DRAWER_SECTION_TITLE: React.CSSProperties = {
  fontSize: 14,
  fontWeight: 500,
  marginBottom: 12,
};
/** 卡片内分栏小标题（如 CPU / 内存） */
const VR_DRAWER_SUBSECTION_TITLE: React.CSSProperties = {
  fontSize: 14,
  fontWeight: 500,
  marginBottom: 8,
};

/** 概览 Tab 的数据模型：驱动「CPU/内存卡片」「基本信息」「时间」「接口表」等整块概览内容 */
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

/**
 * 设备数据 Tab → 下方 JSON 展示区：左侧行号 + 右侧等宽文本，占满「设备数据」主内容区剩余高度并内部滚动。
 */
const DeviceJsonViewer: React.FC<{ loading?: boolean; text: string }> = memo(
  ({ loading, text }) => {
    const lines = useMemo(() => text.split('\n'), [text]);
    const lineHeightPx = 20;
    if (loading) {
      return (
        <div
          style={{
            flex: 1,
            minHeight: 120,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Spin />
        </div>
      );
    }
    return (
      <div
        style={{
          flex: 1,
          minHeight: 0,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          background: '#fff',
        }}
      >
        <div
          className="minimal-scroll"
          style={{ flex: 1, minHeight: 0, overflowY: 'auto', borderRadius: 4 }}
        >
          <div style={{ background: '#fff' }}>
            <div
              style={{ display: 'flex', alignItems: 'stretch', minHeight: 80 }}
            >
              <div
                aria-hidden
                style={{
                  flexShrink: 0,
                  width: 46,
                  padding: '12px 0',
                  background: '#f6f8fa',
                  borderRight: '1px solid #e8ecf0',
                  textAlign: 'right',
                  userSelect: 'none',
                }}
              >
                {lines.map((_, i) => (
                  <div
                    key={i}
                    style={{
                      paddingRight: 10,
                      color: '#656d76',
                      fontSize: 12,
                      lineHeight: `${lineHeightPx}px`,
                      fontFamily: VR_JSON_CODE_FONT,
                      height: lineHeightPx,
                    }}
                  >
                    {i + 1}
                  </div>
                ))}
              </div>
              <div
                style={{ flex: 1, minWidth: 0, padding: '12px 12px 12px 0' }}
              >
                {lines.map((line, i) => (
                  <div
                    key={i}
                    style={{
                      fontFamily: VR_JSON_CODE_FONT,
                      fontSize: 12,
                      lineHeight: `${lineHeightPx}px`,
                      color: '#1f2328',
                      whiteSpace: 'pre-wrap',
                      wordBreak: 'break-word',
                      minHeight: lineHeightPx,
                    }}
                  >
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

// ---------- 主组件：整页抽屉 = 顶栏 + 主 Tab + 概览或设备数据 ----------
const VrDetailDrawer: React.FC<VrDetailDrawerProps> = ({
  open,
  onClose,
  row,
  rolesMap = {},
  orgNameMap = {},
}) => {
  const [activeTab, setActiveTab] = useState<'overview' | 'device'>('overview');
  const [deviceSubTab, setDeviceSubTab] = useState<DeviceSubTab>('csmctl');
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

  /** 拉取聚合缓存 + Tower 本地 vr_config，供概览与设备数据 Tab 展示 */
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

  // 打开抽屉且可选中行时拉数据；关闭时回到「概览」与设备子 Tab 默认项
  useEffect(() => {
    if (!open) {
      setActiveTab('overview');
      setDeviceSubTab('csmctl');
      return;
    }
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

  /** 顶栏标题行：健康状态 Tag（在名称右侧） */
  const statusTag = useMemo(() => {
    if (!overview) return <Tag>未知</Tag>;
    const { health, healthRaw } = overview;
    const label = healthStatusLabel(healthRaw);
    if (health === 'online') return <Tag color="success">{label}</Tag>;
    if (health === 'offline') return <Tag color="error">{label}</Tag>;
    if (health === 'warn') return <Tag color="warning">{label}</Tag>;
    return <Tag>{label}</Tag>;
  }, [overview]);

  /** 设备数据 Tab 当前子项对应的 JSON / 提示文案 → 交给 DeviceJsonViewer */
  const deviceJsonText = useMemo(() => {
    const m = currentMetadata;
    if (deviceSubTab === 'csmctl')
      return JSON.stringify(m?.csmctl ?? {}, null, 2);
    if (deviceSubTab === 'towerConfig') {
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
    if (deviceSubTab === 'saseConfig') {
      const vrctl = m?.mergedFull?.vr_tower_vrctl;
      if (vrctl && typeof vrctl === 'object') {
        return JSON.stringify(vrctl, null, 2);
      }
      return '暂无租户侧 vrctl 数据（Tower 未同步 vr_cache_device，或该 VR 无本地 vr_config / 绑定记录）。可尝试刷新列表缓存或完成租户绑定后再查看。';
    }
    if (deviceSubTab === 'vr2') {
      return m?.vr2
        ? JSON.stringify(m.vr2, null, 2)
        : '暂无 VR2 实时数据（聚合接口未返回或 CSMCTL 不可用）';
    }
    return m?.vr3 ? JSON.stringify(m.vr3, null, 2) : '暂无扩展信息或获取失败';
  }, [
    currentMetadata,
    deviceSubTab,
    towerLocalConfigCache,
    towerLocalConfigCacheError,
  ]);

  // 注册信息(VR1) 在请求过程中仍有列表占位数据，故不显示 loading；其余子 Tab 请求中显示 Spin
  const deviceJsonLoading = metadataLoading && deviceSubTab !== 'csmctl';

  return (
    <Drawer
      open={open}
      onClose={onClose}
      width={900}
      placement="right"
      closable={false}
      styles={{
        body: {
          padding: 0,
          background: '#f5f7fa',
          display: 'flex',
          flexDirection: 'column',
          minHeight: 0,
          height: '100%',
          overflow: 'hidden',
        },
      }}
    >
      {/* 布局对齐 HarvesterVmDetailDrawer：顶栏 → 主 Tab → 样式 → 主内容区（flex:1 内滚动） */}
      {/* 页面顶栏：左侧图标 + 名称/UUID + 状态 Tag + 角色 Tag；右侧刷新 + 关闭 */}
      <div
        style={{
          background: '#f5f7fa',
          padding: '16px 24px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexShrink: 0,
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            minWidth: 0,
          }}
        >
          <div
            style={{
              width: 38,
              height: 38,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#1890ff',
              fontSize: 28,
            }}
          >
            <ApiOutlined />
          </div>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 18, fontWeight: 500, lineHeight: 1.2 }}>
              {overview?.name || row?.name || '虚拟路由器'}
            </div>
            <Tooltip title={overview?.uuid || vrUuid || undefined}>
              <div
                style={{
                  fontSize: 12,
                  color: '#999',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  maxWidth: 520,
                }}
              >
                UUID: {overview?.uuid || vrUuid || '—'}
              </div>
            </Tooltip>
          </div>
          {statusTag}
          {overview?.role && overview.role !== '—' ? (
            <Tag color="blue" style={{ margin: 0 }}>
              {overview.role}
            </Tag>
          ) : null}
        </div>
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <Button
            type="text"
            icon={<SyncOutlined spin={refreshing || metadataLoading} />}
            onClick={() => void handleRefresh()}
            style={{
              width: 32,
              height: 32,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: 4,
              padding: 0,
              color: '#666',
            }}
          />
          <Button
            type="text"
            onClick={onClose}
            style={{
              width: 32,
              height: 32,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: 4,
              fontSize: 16,
              padding: 0,
              color: '#666',
            }}
          >
            <CloseOutlined />
          </Button>
        </div>
      </div>

      {/* 主 Tab 切换条：「概览」与「设备数据」（对齐 HarvesterVmDetailDrawer） */}
      <div style={{ background: '#f5f7fa', padding: '0 24px', flexShrink: 0 }}>
        <div style={{ padding: '0 0 24px 0' }}>
          <div
            style={{
              padding: 4,
              background: '#fff',
              borderRadius: 8,
              border: '1px solid #e0e0e0',
            }}
          >
            <Segmented
              size="small"
              value={activeTab}
              onChange={(v) => setActiveTab(String(v) as 'overview' | 'device')}
              options={[
                {
                  label: '概览',
                  value: 'overview',
                  icon: <ProfileOutlined />,
                },
                {
                  label: '设备数据',
                  value: 'device',
                  icon: <DatabaseOutlined />,
                },
              ]}
            />
          </div>
        </div>
      </div>

      {/* 与 HarvesterVmDetailDrawer 相同的 minimal-scroll 细滚动条 */}
      <style>{`
          .minimal-scroll::-webkit-scrollbar {
            width: 6px;
            height: 6px;
          }
          .minimal-scroll::-webkit-scrollbar-track {
            background: transparent;
          }
          .minimal-scroll::-webkit-scrollbar-thumb {
            background: #e0e0e0;
            border-radius: 3px;
          }
          .minimal-scroll::-webkit-scrollbar-thumb:hover {
            background: #ccc;
          }
          .minimal-scroll::-webkit-scrollbar-button {
            display: none;
          }
        `}</style>

      {/* 主内容区：占满剩余高度；概览与 HarvesterVmDetailDrawer 一致，padding 与 overflow 在同一滚动层 */}
      <div
        style={{
          flex: 1,
          minHeight: 0,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        {/* ———— 概览 Tab：资源卡片 → 基本信息 → 时间信息 → 接口表 ———— */}
        {activeTab === 'overview' && (
          <div
            className="minimal-scroll"
            style={{
              flex: 1,
              minHeight: 0,
              overflowY: 'auto',
              padding: '0 24px 24px',
              display: 'flex',
              flexDirection: 'column',
            }}
          >
            <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
              {!row && !overview ? (
                <div style={{ color: '#999' }}>未选择实例</div>
              ) : overview ? (
                <>
                  {/* 概览 · 首块卡片：CPU / 内存使用率与进度条 */}
                  {overview.resourceIndicators &&
                    typeof overview.resourceIndicators === 'object' && (
                      <Card
                        variant="borderless"
                        styles={{ body: { padding: 16 } }}
                      >
                        <div
                          style={{
                            display: 'flex',
                            gap: 48,
                            flexWrap: 'wrap',
                          }}
                        >
                          <div style={{ flex: 1, minWidth: 280 }}>
                            <div style={VR_DRAWER_SUBSECTION_TITLE}>CPU</div>
                            <div
                              style={{
                                display: 'flex',
                                justifyContent: 'space-between',
                                fontSize: 12,
                                color: '#666',
                              }}
                            >
                              <span>使用率</span>
                              <span>
                                {Number(
                                  overview.resourceIndicators.cpuUsed ?? 0,
                                ).toFixed(1)}
                                % ·{' '}
                                {overview.resourceIndicators.cpuTotal ?? '—'} 核
                              </span>
                            </div>
                            <div style={{ marginTop: 6 }}>
                              <Progress
                                percent={Math.min(
                                  100,
                                  Math.max(
                                    0,
                                    Number(
                                      overview.resourceIndicators.cpuUsed,
                                    ) || 0,
                                  ),
                                )}
                                showInfo={false}
                                strokeColor="#1890ff"
                                trailColor="#f0f0f0"
                                size="small"
                              />
                            </div>
                          </div>
                          <div style={{ flex: 1, minWidth: 280 }}>
                            <div style={VR_DRAWER_SUBSECTION_TITLE}>内存</div>
                            <div
                              style={{
                                display: 'flex',
                                justifyContent: 'space-between',
                                fontSize: 12,
                                color: '#666',
                              }}
                            >
                              <span>使用率</span>
                              <span>
                                {Number(
                                  overview.resourceIndicators.memoryUsed ?? 0,
                                ).toFixed(1)}
                                % ·{' '}
                                {overview.resourceIndicators.memoryTotal ?? '—'}{' '}
                                GiB
                              </span>
                            </div>
                            <div style={{ marginTop: 6 }}>
                              <Progress
                                percent={Math.min(
                                  100,
                                  Math.max(
                                    0,
                                    Number(
                                      overview.resourceIndicators.memoryUsed,
                                    ) || 0,
                                  ),
                                )}
                                showInfo={false}
                                strokeColor="#52c41a"
                                trailColor="#f0f0f0"
                                size="small"
                              />
                            </div>
                          </div>
                        </div>
                      </Card>
                    )}

                  {/* 概览 · 基本信息：Descriptions 两列 */}
                  <Card variant="borderless" styles={{ body: { padding: 16 } }}>
                    <div style={VR_DRAWER_SECTION_TITLE}>基本信息</div>
                    <Descriptions
                      column={2}
                      size="small"
                      styles={{ label: { width: 132, color: '#999' } }}
                    >
                      <Descriptions.Item label="名称">
                        {overview.name}
                      </Descriptions.Item>
                      <Descriptions.Item label="类型">
                        {fmt(overview.type)}
                      </Descriptions.Item>
                      <Descriptions.Item label="UUID">
                        <span style={{ wordBreak: 'break-all' }}>
                          {overview.uuid}
                        </span>
                      </Descriptions.Item>
                      <Descriptions.Item label="版本">
                        {fmt(overview.version)}
                      </Descriptions.Item>
                      <Descriptions.Item label="设备 ID">
                        <span style={{ wordBreak: 'break-all' }}>
                          {fmt(overview.id)}
                        </span>
                      </Descriptions.Item>
                      <Descriptions.Item label="虚拟机 ID">
                        <span style={{ wordBreak: 'break-all' }}>
                          {fmt(overview.vm_id)}
                        </span>
                      </Descriptions.Item>
                      <Descriptions.Item label="MAC">
                        {fmt(overview.mac)}
                      </Descriptions.Item>
                      <Descriptions.Item label="VR 唯一标识">
                        {fmt(overview.vr_unique_id)}
                      </Descriptions.Item>
                      <Descriptions.Item label="健康状态">
                        {overview.healthRaw}
                      </Descriptions.Item>
                      <Descriptions.Item label="角色">
                        {overview.role}
                      </Descriptions.Item>
                      <Descriptions.Item label="资源池">
                        {overview.pool_name || overview.pool_id
                          ? `${overview.pool_name || ''}${
                              overview.pool_id !== undefined &&
                              overview.pool_id !== '' &&
                              String(overview.pool_id) !==
                                String(overview.pool_name)
                                ? ` (${overview.pool_id})`
                                : ''
                            }`
                          : '—'}
                      </Descriptions.Item>
                      <Descriptions.Item label="默认网关">
                        {fmt(overview.gateway)}
                      </Descriptions.Item>
                      <Descriptions.Item label="租户 ID">
                        {fmt(overview.tenant_id)}
                      </Descriptions.Item>
                      <Descriptions.Item label="组织">
                        {overview.org_id &&
                        overview.orgNameMap[String(overview.org_id)] ? (
                          <span>
                            {overview.orgNameMap[String(overview.org_id)]}
                            <Text
                              type="secondary"
                              style={{ fontSize: 12, marginLeft: 8 }}
                            >
                              ({overview.org_id})
                            </Text>
                          </span>
                        ) : (
                          fmt(overview.org_id)
                        )}
                      </Descriptions.Item>
                      <Descriptions.Item label="绑定状态">
                        {fmt(overview.bind_status)}
                      </Descriptions.Item>
                      <Descriptions.Item label="区域">
                        {fmt(overview.region)}
                      </Descriptions.Item>
                      <Descriptions.Item label="云名称">
                        {fmt(overview.cloud)}
                      </Descriptions.Item>
                    </Descriptions>
                  </Card>

                  {/* 概览 · 时间信息（有创建/更新字段时才显示） */}
                  {(overview.createDate || overview.updateDate) && (
                    <Card
                      variant="borderless"
                      styles={{ body: { padding: 16 } }}
                    >
                      <div style={VR_DRAWER_SECTION_TITLE}>时间信息</div>
                      <Descriptions
                        column={2}
                        size="small"
                        styles={{ label: { width: 132, color: '#999' } }}
                      >
                        <Descriptions.Item label="创建时间">
                          {fmtDate(overview.createDate)}
                        </Descriptions.Item>
                        <Descriptions.Item label="更新时间">
                          {fmtDate(overview.updateDate)}
                        </Descriptions.Item>
                      </Descriptions>
                    </Card>
                  )}

                  {/* 概览 · 接口列表表格 */}
                  <Card variant="borderless" styles={{ body: { padding: 16 } }}>
                    <div style={VR_DRAWER_SECTION_TITLE}>
                      接口列表（{overview.interfaces.length}）
                    </div>
                    <Table
                      className="std-table"
                      size="small"
                      bordered={false}
                      pagination={false}
                      scroll={{ x: 'max-content' }}
                      locale={{ emptyText: '暂无接口数据' }}
                      dataSource={overview.interfaces.map(
                        (it: any, idx: number) => ({
                          key: `${it.name}-${idx}`,
                          name: it.name,
                          status: it.status,
                          ipv4: it.ipv4_static,
                          ipv6: it.ipv6_static,
                        }),
                      )}
                      columns={[
                        {
                          title: '接口名',
                          dataIndex: 'name',
                          key: 'name',
                          width: 200,
                          ellipsis: true,
                        },
                        {
                          title: '状态',
                          dataIndex: 'status',
                          key: 'status',
                          width: 88,
                          render: (s: string) => (
                            <Tag
                              color={
                                String(s).toLowerCase() === 'up'
                                  ? 'success'
                                  : 'default'
                              }
                            >
                              {s || '—'}
                            </Tag>
                          ),
                        },
                        {
                          title: 'IPv4',
                          dataIndex: 'ipv4',
                          key: 'ipv4',
                          ellipsis: true,
                          render: (v: any) => fmt(v),
                        },
                        {
                          title: 'IPv6',
                          dataIndex: 'ipv6',
                          key: 'ipv6',
                          ellipsis: true,
                          render: (v: any) => (
                            <span
                              style={{
                                whiteSpace: 'pre-wrap',
                                wordBreak: 'break-all',
                              }}
                            >
                              {v ? String(v) : '—'}
                            </span>
                          ),
                        },
                      ]}
                    />
                  </Card>

                  {/* 概览 · 底部：聚合详情拉取中的提示（仅列表占位时尚未合并完成） */}
                  {metadataLoading && !overview.fromMerged ? (
                    <div
                      style={{
                        textAlign: 'center',
                        color: '#999',
                        fontSize: 12,
                      }}
                    >
                      <Spin size="small" style={{ marginRight: 8 }} />
                      正在拉取聚合详情…
                    </div>
                  ) : null}
                </>
              ) : (
                <div style={{ color: '#999' }}>未选择实例</div>
              )}
            </div>
          </div>
        )}

        {/* ———— 设备数据 Tab：子 Segmented + 下方 JSON 查看器 ———— */}
        {activeTab === 'device' && (
          <div
            style={{
              flex: 1,
              minHeight: 0,
              margin: '0 24px 24px',
              display: 'flex',
              flexDirection: 'column',
              background: '#fff',
              borderRadius: 8,
              overflow: 'hidden',
            }}
          >
            {/* 设备数据 · 子 Tab：VR1 / VR2 / VR3 / Tower 本地配置缓存 */}
            <div
              style={{
                flexShrink: 0,
                padding: '2px',
                marginBottom: '0px',
                background: '#fff',
              }}
            >
              <Segmented
                size="middle"
                value={deviceSubTab}
                onChange={(v) => setDeviceSubTab(v as DeviceSubTab)}
                options={[
                  { label: '注册信息 (VR1)', value: 'csmctl' },
                  { label: '实时配置 (VR2)', value: 'vr2' },
                  { label: '设备信息 (VR3)', value: 'vr3' },
                  { label: '本地配置 (Cache)', value: 'towerConfig' },
                  { label: '租户配置 (Sase)', value: 'saseConfig' },
                ]}
              />
            </div>
            {/* 设备数据 · 当前子 Tab 对应的 JSON 或说明文字 */}
            <div
              style={{
                flex: 1,
                minHeight: 0,
                display: 'flex',
                flexDirection: 'column',
                padding: '0 4px 4px 4px',
              }}
            >
              <DeviceJsonViewer
                loading={deviceJsonLoading}
                text={deviceJsonText}
              />
            </div>
          </div>
        )}
      </div>
    </Drawer>
  );
};

export default VrDetailDrawer;
