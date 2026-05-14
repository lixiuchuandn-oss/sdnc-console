/** Ceph 存储池：列表与增删改走 Rook `CephBlockPool`（Tower `/ceph/rook`）；总览仍由 `CephStorageSection` 独立使用 Dashboard，勿混用。 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Alert, Button, Empty, Input, message, Popconfirm, Progress, Select, Space, Spin, Table, Tabs, Tag, Typography } from 'antd';
import { DatabaseTwoTone, ReloadOutlined, SearchOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import PageDetailSection from '../../../../../../components/PageDetailSection';
import TableColumnSettingsButton from '../../../../../../components/TableColumnSettingsButton';
import { useTableColumnSettings } from '../../../../../../hooks/useTableColumnSettings';
import { cloudmapPoolBasePath } from '../../../../../../layouts/admin/cloudmap/cloudPoolSidebar';
import { fetchCephPoolRbdConfiguration, fetchCephDashboardPools } from '../../../../../../services/monitoringApi';
import { deleteCephBlockPoolRook, fetchCephRookBundle } from '../../../../../../services/cephApi';
import {
  buildRbdPoolConfigurationTableRows,
  type RbdPoolConfigurationTableRow,
} from '../lib/cephRbdPoolConfiguration';
import {
  buildDashboardPoolGeneralDetailEntries,
  buildDashboardPoolStatsDetailRows,
  buildRookBlockPoolDetailEntries,
  cephBlockPoolRowToTableRow,
  cephBlockPoolToRow,
  cephDashboardPoolToTableRow,
  cephPoolTableRowMatchesApplicationScope,
  enrichRookPoolRowWithDashboardStats,
  normalizeCephBundle,
  normalizeDashboardPoolListPayload,
  type CephPoolDetailKV,
  type CephPoolStatDetailRow,
  type CephPoolTableRow,
} from '../lib/cephStorage';
import CephPoolRookFormModal from '../modals/CephPoolRookFormModal';

const TABLE_SETTINGS_KEY = 'harvester_ceph_pools_table_v4';

/** 展开区三 Tab 内表格：保留 std-table 约定，行高由 `ceph-pool-detail-table` 覆盖收紧 */
const POOL_DETAIL_TABLE_CLASS = 'std-table ceph-pool-detail-table';

/** 尚无行时只保留与 Dashboard 池列表常见列，避免出现一堆空 Rook 专用列 */
const POOL_COLUMNS_WHEN_EMPTY: readonly string[] = [
  'name',
  'dataProtection',
  'applications',
  'pgStatus',
  'usagePct',
  'readBps',
  'writeBps',
  'readIops',
  'writeIops',
  'failureDomain',
];

function rowHasColumnValue(r: CephPoolTableRow, colKey: string): boolean {
  if (colKey === 'name') return true;
  if (colKey === 'usagePct') return r.usagePct != null && Number.isFinite(r.usagePct);
  const v = r[colKey as keyof CephPoolTableRow];
  if (v == null) return false;
  if (typeof v === 'string') return v !== '—' && v.trim() !== '';
  return true;
}

function filterPoolColumnsByRows(
  cols: ColumnsType<CephPoolTableRow>,
  rows: CephPoolTableRow[],
): ColumnsType<CephPoolTableRow> {
  if (!rows.length) {
    return cols.filter((c) => POOL_COLUMNS_WHEN_EMPTY.includes(String(c.key ?? '')));
  }
  return cols.filter((col) => {
    const k = String(col.key ?? '');
    if (!k || k === 'name') return true;
    if (k === 'phase' && rows.every((r) => r.source === 'dashboard')) return false;
    return rows.some((r) => rowHasColumnValue(r, k));
  });
}

const POOL_DETAIL_KV_COLUMNS: ColumnsType<CephPoolDetailKV> = [
  {
    title: '字段',
    dataIndex: 'label',
    key: 'label',
    width: 300,
    fixed: 'left',
    ellipsis: { showTitle: false },
  },
  {
    title: '值',
    dataIndex: 'value',
    key: 'value',
    render: (t: string) => (
      <span style={{ display: 'block', whiteSpace: 'pre-wrap', fontSize: 12, lineHeight: 1.35, wordBreak: 'break-word' }}>
        {t}
      </span>
    ),
  },
];

const POOL_DETAIL_STAT_COLUMNS: ColumnsType<CephPoolStatDetailRow> = [
  { title: '指标', dataIndex: 'label', key: 'label', width: 220, fixed: 'left', ellipsis: { showTitle: false } },
  { title: '最新值', dataIndex: 'latest', key: 'latest', width: 160, ellipsis: { showTitle: false } },
  { title: '速率', dataIndex: 'rate', key: 'rate', width: 120, ellipsis: { showTitle: false } },
  { title: '序列', dataIndex: 'ratesHint', key: 'ratesHint', width: 120, ellipsis: { showTitle: false } },
];

/** 与 Ceph Dashboard Pools →「配置」一致：RBD 服务质量（QoS） */
const POOL_RBD_CONFIGURATION_COLUMNS: ColumnsType<RbdPoolConfigurationTableRow> = [
  { title: '名称', dataIndex: 'displayName', key: 'displayName', width: 140, fixed: 'left', ellipsis: { showTitle: false } },
  {
    title: '描述',
    dataIndex: 'description',
    key: 'description',
    ellipsis: { showTitle: false },
    render: (t: string) => (
      <span style={{ fontSize: 12, lineHeight: 1.35, wordBreak: 'break-word' }}>{t}</span>
    ),
  },
  { title: '密钥', dataIndex: 'optionKey', key: 'optionKey', width: 220, ellipsis: { showTitle: false } },
  { title: '来源', dataIndex: 'sourceLabel', key: 'sourceLabel', width: 72, ellipsis: { showTitle: false } },
  { title: '值', dataIndex: 'valueDisplay', key: 'valueDisplay', width: 120, ellipsis: { showTitle: false } },
];

function CephPoolExpandedDetail({ record, cloudId }: { record: CephPoolTableRow; cloudId: string }) {
  const raw = record.detailRaw;
  const [rbdCfgRows, setRbdCfgRows] = useState<RbdPoolConfigurationTableRow[]>([]);
  const [rbdCfgLoading, setRbdCfgLoading] = useState(false);
  const [rbdCfgErr, setRbdCfgErr] = useState<string | null>(null);

  useEffect(() => {
    if (record.source !== 'dashboard' || !cloudId.trim()) {
      setRbdCfgRows([]);
      setRbdCfgErr(null);
      setRbdCfgLoading(false);
      return;
    }
    const ac = new AbortController();
    setRbdCfgLoading(true);
    setRbdCfgErr(null);
    void (async () => {
      try {
        const res = await fetchCephPoolRbdConfiguration(cloudId, record.name, { signal: ac.signal });
        if (ac.signal.aborted) return;
        if (!res.ok) {
          setRbdCfgErr(res.error || `请求失败（HTTP ${res.status}）`);
          setRbdCfgRows([]);
          return;
        }
        setRbdCfgRows(buildRbdPoolConfigurationTableRows(res.data));
      } catch (e: unknown) {
        if (ac.signal.aborted) return;
        setRbdCfgErr(e instanceof Error ? e.message : '加载配置失败');
        setRbdCfgRows([]);
      } finally {
        if (!ac.signal.aborted) setRbdCfgLoading(false);
      }
    })();
    return () => ac.abort();
  }, [cloudId, record.source, record.name]);

  if (raw == null) {
    return (
      <div style={{ padding: '12px 16px' }}>
        <Typography.Text type="secondary">暂无原始数据</Typography.Text>
      </div>
    );
  }

  if (record.source === 'dashboard') {
    const general = buildDashboardPoolGeneralDetailEntries(raw);
    const statsRows = buildDashboardPoolStatsDetailRows(raw);
    // Dashboard 展开区：浅底边框与全局表格区块一致，便于与主表区分
    return (
      <div
        style={{
          padding: '10px',
          border: '1px solid var(--ant-color-border-secondary, #f0f0f0)',
          borderRadius: 8,
          background: '#fafafa',
        }}
      >
        <Tabs
          size="small"
          items={[
            {
              key: 'detail',
              label: '详细信息',
              children: (
                <Table<CephPoolDetailKV>
                  className={POOL_DETAIL_TABLE_CLASS}
                  size="small"
                  rowKey="key"
                  pagination={false}
                  scroll={{ x: true, y: 440 }}
                  columns={POOL_DETAIL_KV_COLUMNS}
                  dataSource={general}
                />
              ),
            },
            {
              key: 'perf',
              label: '性能详细信息',
              children:
                statsRows.length > 0 ? (
                  <Table<CephPoolStatDetailRow>
                    className={POOL_DETAIL_TABLE_CLASS}
                    size="small"
                    rowKey="key"
                    pagination={false}
                    scroll={{ x: true, y: 440 }}
                    columns={POOL_DETAIL_STAT_COLUMNS}
                    dataSource={statsRows}
                  />
                ) : (
                  <Empty description="无 stats 块（需 Dashboard api/pool?stats=true）" />
                ),
            },
            {
              key: 'cfg',
              label: '配置',
              children: (
                <div style={{ minHeight: 100 }}>
                  {rbdCfgLoading ? (
                    <div style={{ textAlign: 'center', padding: '48px 0' }}>
                      <Spin />
                    </div>
                  ) : rbdCfgErr ? (
                    <Alert type="warning" message={rbdCfgErr} showIcon />
                  ) : (
                    <Table<RbdPoolConfigurationTableRow>
                      className={POOL_DETAIL_TABLE_CLASS}
                      size="small"
                      rowKey="key"
                      pagination={false}
                      scroll={{ x: true, y: 440 }}
                      columns={POOL_RBD_CONFIGURATION_COLUMNS}
                      dataSource={rbdCfgRows}
                      locale={{
                        emptyText: '暂无 RBD QoS 项（不完整池或 Dashboard 未返回配置列表）',
                      }}
                    />
                  )}
                </div>
              ),
            },
          ]}
        />
      </div>
    );
  }

  const rook = buildRookBlockPoolDetailEntries(raw);
  return (
    <div style={{ padding: '8px 12px 16px 48px', background: 'rgba(0,0,0,0.02)' }}>
      <Tabs
        size="small"
        items={[
          {
            key: 'detail',
            label: '详细信息',
            children: (
              <Table<CephPoolDetailKV>
                className={POOL_DETAIL_TABLE_CLASS}
                size="small"
                rowKey="key"
                pagination={false}
                scroll={{ x: true, y: 440 }}
                columns={POOL_DETAIL_KV_COLUMNS}
                dataSource={rook.general}
              />
            ),
          },
          {
            key: 'perf',
            label: '性能详细信息',
            children: <Empty description="Rook 列表无 RADOS 实时 stats，请使用 Dashboard 视图" />,
          },
          {
            key: 'cfg',
            label: '配置',
            children: (
              <Table<CephPoolDetailKV>
                className={POOL_DETAIL_TABLE_CLASS}
                size="small"
                rowKey="key"
                pagination={false}
                scroll={{ x: true, y: 440 }}
                columns={POOL_DETAIL_KV_COLUMNS}
                dataSource={rook.config}
              />
            ),
          },
        ]}
      />
    </div>
  );
}

function poolPhaseTagColor(phase: string): string {
  const u = phase.toUpperCase();
  if (u.includes('READY') && !u.includes('NOT')) return 'success';
  if (u.includes('FAIL') || u.includes('ERR')) return 'error';
  if (u.includes('PEND') || u.includes('PROGRESS') || u.includes('CREAT')) return 'processing';
  if (u.includes('WARN')) return 'warning';
  return 'default';
}

export type CephPoolSectionProps = {
  cloudId: string;
  /**
   * Cloudmap：云存储入口为 `cloud`（Rook BlockPool）；对象存储入口为 `object`
   *（mgr Dashboard `api/pool`，仅保留 application 中含 `rgw` 的 RADOS 池）。
   */
  applicationsScope?: 'cloud' | 'object';
};

const CephPoolSection: React.FC<CephPoolSectionProps> = ({ cloudId, applicationsScope = 'cloud' }) => {
  const [loading, setLoading] = useState(false);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [rows, setRows] = useState<CephPoolTableRow[]>([]);
  const [listSource, setListSource] = useState<'rook' | 'dashboard' | null>(null);
  const [bundleUnreachable, setBundleUnreachable] = useState(false);
  /** Rook 模式下合并 Dashboard 性能失败时提示（401/网络等） */
  const [dashboardPoolsHint, setDashboardPoolsHint] = useState<string | null>(null);
  const [keyword, setKeyword] = useState('');
  const [phaseFilter, setPhaseFilter] = useState<string>('');
  const [pagination, setPagination] = useState({ current: 1, pageSize: 10 });
  const [poolModalOpen, setPoolModalOpen] = useState(false);
  const [poolModalMode, setPoolModalMode] = useState<'create' | 'edit'>('create');
  const [poolEditRecord, setPoolEditRecord] = useState<CephPoolTableRow | null>(null);

  const load = useCallback(
    async (force?: boolean) => {
      if (!cloudId) return;
      setLoading(true);
      setLoadErr(null);
      setBundleUnreachable(false);
      setDashboardPoolsHint(null);
      try {
        if (applicationsScope === 'object') {
          const res = await fetchCephDashboardPools(cloudId, { force: !!force });
          if (!res.ok || res.data == null) {
            setRows([]);
            setListSource(null);
            setLoadErr(res.error || '无法读取 mgr Dashboard 池列表（api/pool）');
            return;
          }
          const list = normalizeDashboardPoolListPayload(res.data);
          const mapped = list.map((pool: unknown, index: number) =>
            cephDashboardPoolToTableRow(pool as any, index),
          );
          const kept = mapped.filter((r) => cephPoolTableRowMatchesApplicationScope(r, 'object'));
          setRows(kept);
          setListSource('dashboard');
          return;
        }

        const [res, dashRes] = await Promise.all([
          fetchCephRookBundle(cloudId, { force: !!force }),
          fetchCephDashboardPools(cloudId, { force: !!force }),
        ]);

        if (!res.ok || res.data == null) {
          setRows([]);
          setListSource(null);
          setLoadErr(res.error || '无法读取 Rook CephBlockPool 列表（/ceph/rook/bundle）。请检查集群连接与权限。');
          return;
        }
        const body = res.data as Record<string, unknown>;
        setBundleUnreachable(!!body?._tower && (body._tower as { unreachable?: boolean }).unreachable === true);

        const dashByName = new Map<string, unknown>();
        if (dashRes.ok && dashRes.data != null) {
          for (const p of normalizeDashboardPoolListPayload(dashRes.data)) {
            if (!p || typeof p !== 'object') continue;
            const o = p as Record<string, unknown>;
            const nm =
              o.pool_name != null ? String(o.pool_name) : o.name != null ? String(o.name) : '';
            if (nm) dashByName.set(nm, p);
          }
          setDashboardPoolsHint(null);
        } else {
          setDashboardPoolsHint(
            dashRes.error ||
              `无法合并 mgr Dashboard 池性能（HTTP ${dashRes.status || '—'}）。列表仍可来自 Rook；读写 IOPS、吞吐量、使用率等为「—」直至 Dashboard 可用。生产环境请在 Tower 后端配置 CEPH_DASHBOARD_USER / CEPH_DASHBOARD_PASSWORD（或 NODE_ENV 非 production 下的默认会话）。`,
          );
        }

        const bundle = normalizeCephBundle(body);
        const next = bundle.blockPools.map((p, i) => {
          const row = cephBlockPoolToRow(p, i);
          const base = cephBlockPoolRowToTableRow(row, p);
          const dash = dashByName.get(row.name);
          return enrichRookPoolRowWithDashboardStats(base, dash);
        });
        setRows(next.filter((r) => cephPoolTableRowMatchesApplicationScope(r, 'cloud')));
        setListSource('rook');
      } catch (e: unknown) {
        setRows([]);
        setListSource(null);
        setLoadErr(e instanceof Error ? e.message : '请求失败');
      } finally {
        setLoading(false);
      }
    },
    [cloudId, applicationsScope],
  );

  const deletePool = useCallback(
    async (r: CephPoolTableRow) => {
      const ns = r.namespace?.trim();
      const nm = r.name?.trim();
      if (!cloudId || !ns || !nm || ns === '—') {
        message.error('无法删除：缺少命名空间或名称');
        return;
      }
      const res = await deleteCephBlockPoolRook(cloudId, ns, nm);
      if (!res.ok) {
        message.error(res.error || '删除失败');
        return;
      }
      message.success('已删除存储池');
      void load(true);
    },
    [cloudId, load],
  );

  useEffect(() => {
    void load();
  }, [load]);

  const phaseOptions = useMemo(() => {
    const set = new Set<string>();
    for (const r of rows) {
      if (r.phase && r.phase !== '—') set.add(r.phase);
    }
    return Array.from(set)
      .sort()
      .map((p) => ({ label: p.length > 48 ? `${p.slice(0, 48)}…` : p, value: p }));
  }, [rows]);

  const filtered = useMemo(() => {
    const k = keyword.trim().toLowerCase();
    const pf = phaseFilter.trim().toLowerCase();
    return rows.filter((r) => {
      if (pf && r.phase.toLowerCase() !== pf) return false;
      if (!k) return true;
      return (
        r.name.toLowerCase().includes(k) ||
        r.namespace.toLowerCase().includes(k) ||
        r.phase.toLowerCase().includes(k) ||
        r.pgStatus.toLowerCase().includes(k) ||
        r.dataProtection.toLowerCase().includes(k) ||
        r.applications.toLowerCase().includes(k) ||
        r.failureDomain.toLowerCase().includes(k) ||
        r.deviceClass.toLowerCase().includes(k)
      );
    });
  }, [rows, keyword, phaseFilter]);

  const allColumnsBase: ColumnsType<CephPoolTableRow> = useMemo(
    () => [
      {
        title: '名称',
        key: 'name',
        dataIndex: 'name',
        fixed: 'left',
        ellipsis: true,
        render: (t: string) => (
          <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <DatabaseTwoTone style={{ color: '#1890ff', flexShrink: 0 }} />
            <Typography.Text strong ellipsis={{ tooltip: t }}>
              {t}
            </Typography.Text>
          </span>
        ),
      },
      {
        title: '数据保护',
        key: 'dataProtection',
        dataIndex: 'dataProtection',
        ellipsis: true,
        render: (t: string) => {
          if (t === '—') return '—';
          const isEc = t.includes('纠删');
          return <Tag color={isEc ? 'purple' : 'blue'}>{t}</Tag>;
        },
      },
      {
        title: '应用',
        key: 'applications',
        dataIndex: 'applications',
        ellipsis: true,
        render: (t: string) => (t === '—' ? '—' : <Tag>{t}</Tag>),
      },
      {
        title: 'PG 状态',
        key: 'pgStatus',
        dataIndex: 'pgStatus',
        ellipsis: true,
        render: (t: string) => {
          if (t === '—') return '—';
          const low = t.toLowerCase();
          const okish = low.includes('clean') && !low.includes('incomplete');
          return <Typography.Text type={okish ? 'success' : undefined}>{t}</Typography.Text>;
        },
      },
      {
        title: '使用率',
        key: 'usagePct',
        dataIndex: 'usagePct',
        render: (v: number | null) =>
          v != null && Number.isFinite(v) ? (
            <Progress percent={Math.min(100, v)} size="small" status={v > 90 ? 'exception' : 'normal'} />
          ) : (
            '—'
          ),
      },
      {
        title: '读字节/秒',
        key: 'readBps',
        dataIndex: 'readBps',
      },
      {
        title: '写字节/秒',
        key: 'writeBps',
        dataIndex: 'writeBps',
      },
      {
        title: '读 IOPS',
        key: 'readIops',
        dataIndex: 'readIops',
      },
      {
        title: '写 IOPS',
        key: 'writeIops',
        dataIndex: 'writeIops',
      },
      {
        title: '命名空间',
        key: 'namespace',
        dataIndex: 'namespace',
        ellipsis: true,
      },
      {
        title: '阶段',
        key: 'phase',
        dataIndex: 'phase',
        ellipsis: true,
        render: (p: string) =>
          p === '—' ? '—' : <Tag color={poolPhaseTagColor(p)}>{p.length > 40 ? `${p.slice(0, 40)}…` : p}</Tag>,
      },
      {
        title: '类型',
        key: 'poolType',
        dataIndex: 'poolType',
      },
      {
        title: '副本数 / 纠删',
        key: 'typeDetail',
        dataIndex: 'typeDetail',
        ellipsis: true,
        render: (_: string, r: CephPoolTableRow) =>
          r.poolType === '—' ? '—' : r.poolType === '副本' ? `size: ${r.typeDetail}` : r.typeDetail,
      },
      {
        title: '故障域',
        key: 'failureDomain',
        dataIndex: 'failureDomain',
        ellipsis: true,
      },
      {
        title: '设备类',
        key: 'deviceClass',
        dataIndex: 'deviceClass',
        ellipsis: true,
      },
    ],
    [],
  );

  /** 与表格实际可出现列一致，再交给「列展示」；避免勾选列被二次 filter 掉导致与弹层不符 */
  const poolColumnsForSettings = useMemo(
    () => filterPoolColumnsByRows(allColumnsBase, rows),
    [allColumnsBase, rows],
  );

  const { displayColumns: userDisplayColumns } = useTableColumnSettings(poolColumnsForSettings, TABLE_SETTINGS_KEY);

  const tableColumns = useMemo(() => {
    const pathBase = cloudmapPoolBasePath(cloudId);
    const blockChainLink = (r: CephPoolTableRow) => (
      <Link
        to={`${pathBase}/storage/rados_namespaces?blockPool=${encodeURIComponent(r.name)}`}
        style={{ whiteSpace: 'nowrap' }}
      >
        RADOS 命名空间
      </Link>
    );
    const cols = userDisplayColumns;
    if (listSource !== 'rook') {
      return [
        ...cols,
        {
          title: '块存储链',
          key: 'chain',
          fixed: 'right' as const,
          width: 132,
          render: (_: unknown, r: CephPoolTableRow) => blockChainLink(r),
        },
      ];
    }
    return [
      ...cols,
      {
        title: '操作',
        key: 'actions',
        fixed: 'right' as const,
        width: 258,
        render: (_: unknown, r: CephPoolTableRow) => (
          <Space size={4} wrap>
            {blockChainLink(r)}
            {r.source === 'rook' ? (
              <>
                <Button
                  type="link"
                  size="small"
                  onClick={() => {
                    setPoolModalMode('edit');
                    setPoolEditRecord(r);
                    setPoolModalOpen(true);
                  }}
                >
                  编辑
                </Button>
                <Popconfirm title="确定删除该 CephBlockPool？" okText="删除" cancelText="取消" onConfirm={() => void deletePool(r)}>
                  <Button type="link" size="small" danger>
                    删除
                  </Button>
                </Popconfirm>
              </>
            ) : null}
          </Space>
        ),
      },
    ];
  }, [userDisplayColumns, listSource, deletePool, cloudId]);

  const resetFilters = () => {
    setKeyword('');
    setPhaseFilter('');
    setPagination((p) => ({ ...p, current: 1 }));
  };

  return (
    <>
      <PageDetailSection
      asCard={false}
      toolbarLeft={
        <>
          <Input
            allowClear
            placeholder="名称 / 应用 / PG / 阶段…"
            suffix={<SearchOutlined style={{ color: 'rgba(0,0,0,.45)' }} />}
            value={keyword}
            onChange={(e) => {
              setKeyword(e.target.value);
              setPagination((p) => ({ ...p, current: 1 }));
            }}
            className="toolbar-search"
          />
          <Select
            allowClear
            placeholder="阶段 / PG 摘要"
            value={phaseFilter || undefined}
            onChange={(v) => {
              setPhaseFilter(v ?? '');
              setPagination((p) => ({ ...p, current: 1 }));
            }}
            className="toolbar-filter-sm"
            options={phaseOptions}
            popupMatchSelectWidth={false}
          />
          <button type="button" className="toolbar-reset-btn" onClick={resetFilters}>
            重置
          </button>
        </>
      }
      toolbarRight={
        <>
          {applicationsScope === 'cloud' && listSource === 'rook' ? (
            <Button
              type="primary"
              onClick={() => {
                setPoolModalMode('create');
                setPoolEditRecord(null);
                setPoolModalOpen(true);
              }}
            >
              创建存储池
            </Button>
          ) : null}
          <TableColumnSettingsButton allColumns={poolColumnsForSettings} settingsKey={TABLE_SETTINGS_KEY} />
          <Button icon={<ReloadOutlined />} onClick={() => void load(true)} loading={loading} />
        </>
      }
    >
      {loadErr ? (
        <Alert type="error" showIcon message={loadErr} style={{ marginBottom: 12 }} />
      ) : bundleUnreachable ? (
        <Alert
          type="warning"
          showIcon
          message="当前无法从集群拉取 Rook 资源（Steve 不可达或已降级）。列表可能为空；请检查控制面后再试。"
          style={{ marginBottom: 12 }}
        />
      ) : dashboardPoolsHint && listSource === 'rook' ? (
        <Alert type="info" showIcon message={dashboardPoolsHint} style={{ marginBottom: 12 }} />
      ) : null}
      <Table<CephPoolTableRow>
        className="std-table"
        bordered={false}
        scroll={{ x: true }}
        rowKey="key"
        loading={loading}
        columns={tableColumns}
        dataSource={filtered}
        expandable={{
          columnWidth: 40,
          expandedRowRender: (record) => <CephPoolExpandedDetail record={record} cloudId={cloudId} />,
        }}
        locale={{
          emptyText: loadErr ? (
            <Empty description="加载失败" />
          ) : (
            <Empty description="暂无存储池" />
          ),
        }}
        pagination={{
          current: pagination.current,
          pageSize: pagination.pageSize,
          showSizeChanger: true,
          showTotal: (total) => `共 ${total} 条`,
          onChange: (page, pageSize) =>
            setPagination({ current: page, pageSize: pageSize ?? pagination.pageSize }),
        }}
      />
      <CephPoolRookFormModal
        open={poolModalOpen}
        mode={poolModalMode}
        cloudId={cloudId}
        editRecord={poolModalMode === 'edit' ? poolEditRecord : null}
        onClose={() => {
          setPoolModalOpen(false);
          setPoolEditRecord(null);
        }}
        onSuccess={() => void load(true)}
      />
    </PageDetailSection>
    </>
  );
};

export default CephPoolSection;
