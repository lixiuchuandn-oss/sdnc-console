import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Button, Card, Descriptions, Drawer, Progress, Segmented, Spin, Table, Tabs, Tag, Tooltip, Typography } from 'antd';
import {
  ApiOutlined,
  CloseOutlined,
  CloudOutlined,
  CodeOutlined,
  DatabaseOutlined,
  DeploymentUnitOutlined,
  ProfileOutlined,
  SyncOutlined,
} from '@ant-design/icons';
import { fetchVrCacheMerged, getVRConfig } from '../../../../services/virtualRouterApi';

const { Text, Paragraph } = Typography;

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
  /** 聚合接口完整 data，用于概览 Tab 结构化展示 */
  mergedFull?: any | null;
} | null;

function normalizeHealth(raw: string): 'online' | 'offline' | 'warn' | 'unknown' {
  const s = String(raw || '').toLowerCase();
  if (['online', 'healthy', 'running', 'ok', 'active', 'up'].includes(s)) return 'online';
  if (['offline', 'down', 'stopped', 'error', 'failed', 'unhealthy'].includes(s)) return 'offline';
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

/** 卡片区块标题：对齐 HarvesterNodeDetailDrawer（物理节点详情抽屉） */
const VR_DRAWER_SECTION_TITLE: React.CSSProperties = { fontSize: 14, fontWeight: 500, marginBottom: 12 };
/** 卡片内分栏小标题（如 CPU / 内存） */
const VR_DRAWER_SUBSECTION_TITLE: React.CSSProperties = { fontSize: 14, fontWeight: 500, marginBottom: 8 };

/** 概览数据源：优先聚合接口整包，否则列表行 */
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
    const ri = base.resourceIndicators || m?._raw_csmctl_info?.resourceIndicators;
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

/** 设备数据子 Tab 内：仅 JSON 正文 + 滚动，无外框与标题（语义由 Tab 标签承担） */
const VrJsonBlock: React.FC<{ loading?: boolean; bodyText: string }> = ({ loading, bodyText }) => (
  <div
    className="vr-detail-drawer-scroll"
    style={{ maxHeight: 'min(60vh, 560px)', overflowY: 'auto', paddingTop: 4 }}
  >
    {loading ? (
      <div style={{ textAlign: 'center', padding: '32px 0' }}>
        <Spin />
      </div>
    ) : (
      <Paragraph
        style={{
          margin: 0,
          fontFamily: 'monospace',
          fontSize: 12,
          lineHeight: 1.6,
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-all',
          color: 'rgba(0,0,0,0.75)',
        }}
      >
        {bodyText}
      </Paragraph>
    )}
  </div>
);

const VrDetailDrawer: React.FC<VrDetailDrawerProps> = ({
  open,
  onClose,
  row,
  rolesMap = {},
  orgNameMap = {},
}) => {
  const [activeTab, setActiveTab] = useState<'overview' | 'device'>('overview');
  const [deviceSubTab, setDeviceSubTab] = useState<'csmctl' | 'vr3' | 'vr2'>('csmctl');
  const [metadataLoading, setMetadataLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [currentMetadata, setCurrentMetadata] = useState<MetadataState>(null);

  const vrUuid = useMemo(
    () => String(row?.uuid || row?.vr_unique_id || row?.vm_id || '').trim(),
    [row],
  );

  const loadMetadata = useCallback(async () => {
    if (!row || !vrUuid) {
      setCurrentMetadata(null);
      return;
    }
    const id = vrUuid;

    // 先用列表行上的合并字段占位，再以 GET /api/vr-cache/:uuid/merged 刷新（VR1 + VR3 + 本地设备）
    const r = row as any;
    const rowLooksMerged =
      r && (Array.isArray(r.interfaces) || r.resourceIndicators || r.health_status);
    setCurrentMetadata({
      csmctl: r._raw_csmctl_info ?? {},
      vr3: r.vr3_info ?? null,
      vr2: null,
      mergedFull: rowLooksMerged ? r : null,
    });

    setMetadataLoading(true);
    try {
      await Promise.allSettled([
        (async () => {
          try {
            const merged = await fetchVrCacheMerged(id);
            if (merged && typeof merged === 'object') {
              const m = merged as Record<string, any>;
              setCurrentMetadata((prev) =>
                prev
                  ? {
                      ...prev,
                      mergedFull: m,
                      csmctl: m._raw_csmctl_info ?? {},
                      vr3: m.vr3_info ?? null,
                    }
                  : null,
              );
            }
          } catch (e) {
            console.warn('[VrDetailDrawer] fetchVrCacheMerged failed, keeping list row snapshot:', e);
          }
        })(),
        (async () => {
          try {
            const data = await getVRConfig(id);
            if (data) {
              setCurrentMetadata((prev) => (prev ? { ...prev, vr2: data } : null));
            } else {
              setCurrentMetadata((prev) =>
                prev
                  ? {
                      ...prev,
                      vr2: { error: '暂无配置', details: '本地数据库未找到该VR的配置信息' },
                    }
                  : null,
              );
            }
          } catch (e) {
            console.warn('Failed to fetch VR config:', e);
            setCurrentMetadata((prev) =>
              prev
                ? { ...prev, vr2: { error: '获取配置失败', details: (e as any).message } }
                : null,
            );
          }
        })(),
      ]);
    } finally {
      setMetadataLoading(false);
    }
  }, [row, vrUuid]);

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

  const overview = useOverviewModel(row, currentMetadata?.mergedFull, vrUuid, rolesMap, orgNameMap);

  const statusTag = useMemo(() => {
    if (!overview) return <Tag>未知</Tag>;
    const { health, healthRaw } = overview;
    const label =
      healthRaw && healthRaw !== '—'
        ? healthRaw === 'ONLINE'
          ? '在线'
          : healthRaw === 'OFFLINE'
            ? '离线'
            : healthRaw
        : '未知';
    if (health === 'online') return <Tag color="success">{label}</Tag>;
    if (health === 'offline') return <Tag color="error">{label}</Tag>;
    if (health === 'warn') return <Tag color="warning">{label}</Tag>;
    return <Tag>{label}</Tag>;
  }, [overview]);

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await loadMetadata();
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <Drawer
      open={open}
      onClose={onClose}
      width={900}
      placement="right"
      closable={false}
      styles={{
        body: { padding: 0, background: '#f5f7fa', display: 'flex', flexDirection: 'column' },
      }}
    >
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
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
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

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
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
                  { label: '概览', value: 'overview', icon: <ProfileOutlined /> },
                  { label: '设备数据', value: 'device', icon: <DatabaseOutlined /> },
                ]}
              />
            </div>
          </div>
        </div>

        <style>{`
          .vr-detail-drawer-scroll::-webkit-scrollbar {
            width: 6px;
            height: 6px;
          }
          .vr-detail-drawer-scroll::-webkit-scrollbar-track {
            background: transparent;
          }
          .vr-detail-drawer-scroll::-webkit-scrollbar-thumb {
            background: #e0e0e0;
            border-radius: 3px;
          }
          .vr-detail-drawer-scroll::-webkit-scrollbar-thumb:hover {
            background: #ccc;
          }
          .vr-detail-drawer-scroll::-webkit-scrollbar-button {
            display: none;
          }
        `}</style>
        <div
          className="vr-detail-drawer-scroll"
          style={{ padding: '0 24px 24px', flex: 1, overflowY: 'auto', minHeight: 0 }}
        >
          {activeTab === 'overview' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
              {!row && !overview ? (
                <div style={{ color: '#999' }}>未选择实例</div>
              ) : overview ? (
                <>
                  {overview.resourceIndicators &&
                    typeof overview.resourceIndicators === 'object' && (
                      <Card variant="borderless" styles={{ body: { padding: 16 } }}>
                        <div style={{ display: 'flex', gap: 48, flexWrap: 'wrap' }}>
                          <div style={{ flex: 1, minWidth: 280 }}>
                            <div style={VR_DRAWER_SUBSECTION_TITLE}>CPU</div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: '#666' }}>
                              <span>使用率</span>
                              <span>
                                {Number(overview.resourceIndicators.cpuUsed ?? 0).toFixed(1)}% ·{' '}
                                {overview.resourceIndicators.cpuTotal ?? '—'} 核
                              </span>
                            </div>
                            <div style={{ marginTop: 6 }}>
                              <Progress
                                percent={Math.min(
                                  100,
                                  Math.max(0, Number(overview.resourceIndicators.cpuUsed) || 0),
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
                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: '#666' }}>
                              <span>使用率</span>
                              <span>
                                {Number(overview.resourceIndicators.memoryUsed ?? 0).toFixed(1)}% ·{' '}
                                {overview.resourceIndicators.memoryTotal ?? '—'} GiB
                              </span>
                            </div>
                            <div style={{ marginTop: 6 }}>
                              <Progress
                                percent={Math.min(
                                  100,
                                  Math.max(0, Number(overview.resourceIndicators.memoryUsed) || 0),
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

                  <Card variant="borderless" styles={{ body: { padding: 16 } }}>
                    <div style={VR_DRAWER_SECTION_TITLE}>基本信息</div>
                    <Descriptions
                      column={2}
                      size="small"
                      styles={{ label: { width: 132, color: '#999' } }}
                    >
                      <Descriptions.Item label="名称">{overview.name}</Descriptions.Item>
                      <Descriptions.Item label="类型">{fmt(overview.type)}</Descriptions.Item>
                      <Descriptions.Item label="UUID">
                        <span style={{ wordBreak: 'break-all' }}>{overview.uuid}</span>
                      </Descriptions.Item>
                      <Descriptions.Item label="版本">{fmt(overview.version)}</Descriptions.Item>
                      <Descriptions.Item label="设备 ID">
                        <span style={{ wordBreak: 'break-all' }}>{fmt(overview.id)}</span>
                      </Descriptions.Item>
                      <Descriptions.Item label="虚拟机 ID">
                        <span style={{ wordBreak: 'break-all' }}>{fmt(overview.vm_id)}</span>
                      </Descriptions.Item>
                      <Descriptions.Item label="MAC">{fmt(overview.mac)}</Descriptions.Item>
                      <Descriptions.Item label="VR 唯一标识">
                        {fmt(overview.vr_unique_id)}
                      </Descriptions.Item>
                      <Descriptions.Item label="健康状态">{overview.healthRaw}</Descriptions.Item>
                      <Descriptions.Item label="角色">{overview.role}</Descriptions.Item>
                      <Descriptions.Item label="资源池">
                        {overview.pool_name || overview.pool_id
                          ? `${overview.pool_name || ''}${
                              overview.pool_id !== undefined &&
                              overview.pool_id !== '' &&
                              String(overview.pool_id) !== String(overview.pool_name)
                                ? ` (${overview.pool_id})`
                                : ''
                            }`
                          : '—'}
                      </Descriptions.Item>
                      <Descriptions.Item label="默认网关">{fmt(overview.gateway)}</Descriptions.Item>
                      <Descriptions.Item label="租户 ID">{fmt(overview.tenant_id)}</Descriptions.Item>
                      <Descriptions.Item label="组织">
                        {overview.org_id && overview.orgNameMap[String(overview.org_id)] ? (
                          <span>
                            {overview.orgNameMap[String(overview.org_id)]}
                            <Text type="secondary" style={{ fontSize: 12, marginLeft: 8 }}>
                              ({overview.org_id})
                            </Text>
                          </span>
                        ) : (
                          fmt(overview.org_id)
                        )}
                      </Descriptions.Item>
                      <Descriptions.Item label="绑定状态">{fmt(overview.bind_status)}</Descriptions.Item>
                      <Descriptions.Item label="区域">{fmt(overview.region)}</Descriptions.Item>
                      <Descriptions.Item label="云名称">{fmt(overview.cloud)}</Descriptions.Item>
                    </Descriptions>
                  </Card>

                  {(overview.createDate || overview.updateDate) && (
                    <Card variant="borderless" styles={{ body: { padding: 16 } }}>
                      <div style={VR_DRAWER_SECTION_TITLE}>时间信息</div>
                      <Descriptions column={2} size="small" styles={{ label: { width: 132, color: '#999' } }}>
                        <Descriptions.Item label="创建时间">
                          {fmtDate(overview.createDate)}
                        </Descriptions.Item>
                        <Descriptions.Item label="更新时间">
                          {fmtDate(overview.updateDate)}
                        </Descriptions.Item>
                      </Descriptions>
                    </Card>
                  )}

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
                      dataSource={overview.interfaces.map((it: any, idx: number) => ({
                        key: `${it.name}-${idx}`,
                        name: it.name,
                        status: it.status,
                        ipv4: it.ipv4_static,
                        ipv6: it.ipv6_static,
                      }))}
                      columns={[
                        { title: '接口名', dataIndex: 'name', key: 'name', width: 200, ellipsis: true },
                        {
                          title: '状态',
                          dataIndex: 'status',
                          key: 'status',
                          width: 88,
                          render: (s: string) => (
                            <Tag color={String(s).toLowerCase() === 'up' ? 'success' : 'default'}>
                              {s || '—'}
                            </Tag>
                          ),
                        },
                        { title: 'IPv4', dataIndex: 'ipv4', key: 'ipv4', ellipsis: true, render: (v: any) => fmt(v) },
                        {
                          title: 'IPv6',
                          dataIndex: 'ipv6',
                          key: 'ipv6',
                          ellipsis: true,
                          render: (v: any) => (
                            <span style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>{v ? String(v) : '—'}</span>
                          ),
                        },
                      ]}
                    />
                  </Card>

                  {metadataLoading && !overview.fromMerged ? (
                    <div style={{ textAlign: 'center', color: '#999', fontSize: 12 }}>
                      <Spin size="small" style={{ marginRight: 8 }} />
                      正在拉取聚合详情…
                    </div>
                  ) : null}
                </>
              ) : (
                <div style={{ color: '#999' }}>未选择实例</div>
              )}
            </div>
          )}

          {activeTab === 'device' && (
            <div
              style={{
                background: '#fff',
                border: '1px solid #e0e0e0',
                borderRadius: 8,
                overflow: 'hidden',
              }}
            >
              <Tabs
                type="line"
                size="small"
                activeKey={deviceSubTab}
                onChange={(k) => setDeviceSubTab(k as 'csmctl' | 'vr3' | 'vr2')}
                tabBarStyle={{ margin: 0, paddingLeft: 16, paddingRight: 16, marginBottom: 0 }}
                items={[
                  {
                    key: 'csmctl',
                    label: (
                      <span>
                        <CloudOutlined style={{ marginRight: 6 }} />
                        注册信息(VR1)
                      </span>
                    ),
                    children: (
                      <div style={{ padding: '0 16px 16px' }}>
                        <VrJsonBlock bodyText={JSON.stringify(currentMetadata?.csmctl ?? {}, null, 2)} />
                      </div>
                    ),
                  },
                  {
                    key: 'vr3',
                    label: (
                      <span>
                        <DeploymentUnitOutlined style={{ marginRight: 6 }} />
                        设备信息(VR3)
                      </span>
                    ),
                    children: (() => {
                      const raw = currentMetadata?.vr3;
                      const text = raw ? JSON.stringify(raw, null, 2) : '暂无扩展信息或获取失败';
                      return (
                        <div style={{ padding: '0 16px 16px' }}>
                          <VrJsonBlock loading={metadataLoading} bodyText={text} />
                        </div>
                      );
                    })(),
                  },
                  {
                    key: 'vr2',
                    label: (
                      <span>
                        <CodeOutlined style={{ marginRight: 6 }} />
                        配置信息(缓存)
                      </span>
                    ),
                    children: (() => {
                      const raw = currentMetadata?.vr2;
                      const text = raw ? JSON.stringify(raw, null, 2) : '暂无缓存数据或获取失败';
                      return (
                        <div style={{ padding: '0 16px 16px' }}>
                          <VrJsonBlock loading={metadataLoading} bodyText={text} />
                        </div>
                      );
                    })(),
                  },
                ]}
              />
            </div>
          )}
        </div>
      </div>
    </Drawer>
  );
};

export default VrDetailDrawer;
