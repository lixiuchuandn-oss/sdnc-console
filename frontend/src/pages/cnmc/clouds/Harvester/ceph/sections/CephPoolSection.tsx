/** Ceph 存储池：列表与增删改仅走 Rook `CephBlockPool`（`replicapool` + 自定义副本池）；不调用 mgr Dashboard。 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Button,
  Empty,
  Input,
  message,
  Modal,
  Progress,
  Select,
  Table,
  Tag,
  Typography,
} from 'antd';
import { DatabaseTwoTone, ReloadOutlined, SearchOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import PageDetailSection from '../../../../../../components/PageDetailSection';
import ResourceActionsDropdown from '../../../../../../components/ResourceActionsDropdown';
import TableColumnSettingsButton from '../../../../../../components/TableColumnSettingsButton';
import { useTableColumnSettings } from '../../../../../../hooks/useTableColumnSettings';
import { fetchCephDashboardPools } from '../../../../../../services/monitoringApi';
import { getCephBlockPoolRook, deleteCephBlockPoolRook, fetchCephRookBundle } from '../../../../../../services/cephApi';
import { useHarvesterResourceLinkYamlDrawerSlot } from '../../shared/components/HarvesterResourceLinkYamlDrawerSlot';
import {
  confirmHighRiskDelete,
  CEPH_STORAGE_RISK_ITEMS,
} from '../../shared/lib/highRiskConfirm';
import yaml from 'js-yaml';
import {
  cephBlockPoolRowToTableRow,
  cephBlockPoolToRow,
  cephDashboardPoolToTableRow,
  cephPoolTableRowMatchesApplicationScope,
  isTowerVisibleRookStoragePool,
  normalizeCephBundle,
  normalizeDashboardPoolListPayload,
  type CephPoolTableRow,
} from '../lib/cephStorage';
import CephPoolRookFormModal from '../modals/CephPoolRookFormModal';
import {
  createHarvesterToolbarRefresh,
  mergeCephSectionOnRefresh,
  runHarvesterSectionRefresh,
  type HarvesterSectionOnRefresh,
} from '../lib/cephSectionRefresh';

const TABLE_SETTINGS_KEY = 'harvester_ceph_pools_table_v4';

/** 为 false 时仅隐藏「创建存储池」「删除」按钮；`deletePool` / 创建弹窗等逻辑仍保留 */
const SHOW_CEPH_POOL_CREATE_AND_DELETE_ACTIONS = false;

/** 避免将 K8s Status JSON 原样展示在 Alert 中 */
function formatCephDashboardLoadError(error: string | undefined, status?: number): string {
  const raw = typeof error === 'string' ? error.trim() : '';
  if (raw.startsWith('{')) {
    try {
      const o = JSON.parse(raw) as Record<string, unknown>;
      const msg = typeof o.message === 'string' ? o.message.trim() : '';
      const reason = typeof o.reason === 'string' ? o.reason.trim() : '';
      if (msg.includes('rook-ceph-mgr-dashboard') || msg.includes('not found')) {
        return '集群未部署 Ceph mgr Dashboard 服务（rook-ceph-mgr-dashboard），无法列出对象存储 RADOS 池。';
      }
      if (msg) return msg;
      if (reason) return reason;
    } catch {
      /* 非 JSON */
    }
  }
  if (status === 404) return 'Ceph mgr Dashboard 不可用（HTTP 404）。';
  return raw;
}

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

function poolPhaseTagColor(phase: string): string {
  const u = phase.toUpperCase();
  if (u.includes('READY') && !u.includes('NOT')) return 'success';
  if (u.includes('FAIL') || u.includes('ERR')) return 'error';
  if (u.includes('PEND') || u.includes('PROGRESS') || u.includes('CREAT')) return 'processing';
  if (u.includes('WARN')) return 'warning';
  return 'default';
}

/** 从当前列表行收集去重选项，供 Select 筛选（忽略空与「—」）。 */
function distinctFieldOptions(
  rows: CephPoolTableRow[],
  field: keyof CephPoolTableRow,
  maxLabel = 48,
): { label: string; value: string }[] {
  const set = new Set<string>();
  for (const r of rows) {
    const v = r[field];
    if (typeof v !== 'string') continue;
    const s = v.trim();
    if (!s || s === '—') continue;
    set.add(s);
  }
  return Array.from(set)
    .sort((a, b) => a.localeCompare(b, 'zh-CN'))
    .map((val) => ({
      value: val,
      label: val.length > maxLabel ? `${val.slice(0, maxLabel)}…` : val,
    }));
}

export type CephPoolSectionProps = {
  cloudId: string;
  /**
   * Cloudmap：云存储 `cloud`（Rook，仅 replicapool + 自定义副本池）；
   * 对象存储 `object` 仍走 mgr Dashboard `api/pool`（rgw 池）。
   */
  applicationsScope?: 'cloud' | 'object';
  onRefresh?: HarvesterSectionOnRefresh;
};

const CephPoolSection: React.FC<CephPoolSectionProps> = ({
  cloudId,
  applicationsScope = 'cloud',
  onRefresh,
}) => {
  const [loading, setLoading] = useState(false);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [rows, setRows] = useState<CephPoolTableRow[]>([]);
  const [listSource, setListSource] = useState<'rook' | 'dashboard' | null>(null);
  const [bundleUnreachable, setBundleUnreachable] = useState(false);
  const [keyword, setKeyword] = useState('');
  const [namespaceFilter, setNamespaceFilter] = useState('');
  const [phaseFilter, setPhaseFilter] = useState('');
  const [applicationsFilter, setApplicationsFilter] = useState('');
  const [pgStatusFilter, setPgStatusFilter] = useState('');
  const [dataProtectionFilter, setDataProtectionFilter] = useState('');
  const [failureDomainFilter, setFailureDomainFilter] = useState('');
  const [deviceClassFilter, setDeviceClassFilter] = useState('');
  const [pagination, setPagination] = useState({ current: 1, pageSize: 10 });
  const [poolModalOpen, setPoolModalOpen] = useState(false);
  const [poolModalMode, setPoolModalMode] = useState<'create' | 'edit'>('create');
  const [poolEditRecord, setPoolEditRecord] = useState<CephPoolTableRow | null>(null);
  const { openStaticYamlDrawer, yamlDrawer } = useHarvesterResourceLinkYamlDrawerSlot(cloudId);

  const openPoolYaml = useCallback(
    async (row: CephPoolTableRow) => {
      const ns = row.namespace?.trim();
      const nm = row.name?.trim();

      if (row.source === 'rook' && ns && nm && ns !== '—') {
        try {
          const res = await getCephBlockPoolRook(cloudId, ns, nm);
          if (!res.ok || res.data == null) {
            message.error(res.error || '拉取 CephBlockPool 失败');
            return;
          }
          openStaticYamlDrawer(yaml.dump(res.data, { lineWidth: 120, noRefs: true }), {
            title: `CephBlockPool · ${ns}/${nm}`,
            sourceLabel: `CephBlockPool · ${ns}/${nm}`,
          });
        } catch (e: unknown) {
          console.error(e);
          message.error('拉取 CephBlockPool 失败');
        }
        return;
      }

      if (row.detailRaw != null && typeof row.detailRaw === 'object') {
        openStaticYamlDrawer(yaml.dump(row.detailRaw, { lineWidth: 120, noRefs: true }), {
          title: `存储池 · ${nm || row.name}`,
          sourceLabel: `存储池 · ${nm || row.name}`,
        });
        return;
      }

      message.warning('无法查看 YAML：缺少资源详情');
    },
    [cloudId, openStaticYamlDrawer],
  );

  const load = useCallback(
    async (force?: boolean) => {
      if (!cloudId) return;
      setLoading(true);
      setLoadErr(null);
      setBundleUnreachable(false);
      try {
        if (applicationsScope === 'object') {
          const res = await fetchCephDashboardPools(cloudId, { force: !!force });
          if (!res.ok || res.data == null) {
            setRows([]);
            setListSource(null);
            setLoadErr(
              formatCephDashboardLoadError(res.error, res.status) ||
                '无法读取 mgr Dashboard 池列表（api/pool）',
            );
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

        const res = await fetchCephRookBundle(cloudId, { force: !!force });

        if (!res.ok || res.data == null) {
          setRows([]);
          setListSource(null);
          setLoadErr(res.error || '无法读取统一存储池列表（/ceph/rook/bundle）。请检查集群连接与权限。');
          return;
        }
        const body = res.data as Record<string, unknown>;
        setBundleUnreachable(!!body?._tower && (body._tower as { unreachable?: boolean }).unreachable === true);

        const bundle = normalizeCephBundle(body);
        const next = bundle.blockPools
          .filter(isTowerVisibleRookStoragePool)
          .map((p, i) => {
            const row = cephBlockPoolToRow(p, i);
            return cephBlockPoolRowToTableRow(row, p);
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

  const sectionOnRefresh = useMemo(
    () => mergeCephSectionOnRefresh(load, onRefresh),
    [load, onRefresh],
  );

  const handleToolbarRefresh = useMemo(
    () => createHarvesterToolbarRefresh(sectionOnRefresh),
    [sectionOnRefresh],
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
      void runHarvesterSectionRefresh(sectionOnRefresh, { force: true });
    },
    [cloudId, sectionOnRefresh],
  );

  useEffect(() => {
    void load();
  }, [load]);

  const namespaceOptions = useMemo(() => distinctFieldOptions(rows, 'namespace'), [rows]);
  const phaseOptions = useMemo(() => distinctFieldOptions(rows, 'phase'), [rows]);
  const applicationsOptions = useMemo(() => distinctFieldOptions(rows, 'applications'), [rows]);

  const filtered = useMemo(() => {
    const k = keyword.trim().toLowerCase();
    return rows.filter((r) => {
      if (k && !r.name.toLowerCase().includes(k)) return false;
      if (namespaceFilter && r.namespace !== namespaceFilter) return false;
      if (phaseFilter && r.phase !== phaseFilter) return false;
      if (applicationsFilter && r.applications !== applicationsFilter) return false;
      if (pgStatusFilter && r.pgStatus !== pgStatusFilter) return false;
      if (dataProtectionFilter && r.dataProtection !== dataProtectionFilter) return false;
      if (failureDomainFilter && r.failureDomain !== failureDomainFilter) return false;
      if (deviceClassFilter && r.deviceClass !== deviceClassFilter) return false;
      return true;
    });
  }, [
    rows,
    keyword,
    namespaceFilter,
    phaseFilter,
    applicationsFilter,
    pgStatusFilter,
    dataProtectionFilter,
    failureDomainFilter,
    deviceClassFilter,
  ]);

  const bumpPage = () => setPagination((p) => ({ ...p, current: 1 }));

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
    const cols = userDisplayColumns;
    if (listSource !== 'rook') {
      return cols;
    }
    return [
      ...cols,
      {
        title: '操作',
        key: 'actions',
        fixed: 'right' as const,
        align: 'left' as const,
        render: (_: unknown, r: CephPoolTableRow) =>
          r.source === 'rook' ? (
            <ResourceActionsDropdown
              buttonProps={{ className: 'row-actions-trigger' }}
              items={[
                {
                  key: 'edit',
                  label: '编辑',
                  onClick: () => {
                    setPoolModalMode('edit');
                    setPoolEditRecord(r);
                    setPoolModalOpen(true);
                  },
                },
                {
                  key: 'yaml',
                  label: '查看 YAML',
                  onClick: () => void openPoolYaml(r),
                },
                ...(SHOW_CEPH_POOL_CREATE_AND_DELETE_ACTIONS
                  ? ([
                      { type: 'divider' as const, key: 'd1' },
                      {
                        key: 'delete',
                        label: '删除',
                        danger: true,
                        onClick: () => {
                          void confirmHighRiskDelete({
                            resourceLabel: 'CephBlockPool',
                            name: `${r.namespace}/${r.name}`,
                            riskItems: CEPH_STORAGE_RISK_ITEMS,
                            onConfirm: () => deletePool(r),
                          }).catch(() => {});
                        },
                      },
                    ] as const)
                  : []),
              ]}
            />
          ) : null,
      },
    ];
  }, [userDisplayColumns, listSource, deletePool, openPoolYaml]);

  const resetFilters = () => {
    setKeyword('');
    setNamespaceFilter('');
    setPhaseFilter('');
    setApplicationsFilter('');
    setPgStatusFilter('');
    setDataProtectionFilter('');
    setFailureDomainFilter('');
    setDeviceClassFilter('');
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
            placeholder="搜索池名称"
            suffix={<SearchOutlined style={{ color: 'rgba(0,0,0,.45)' }} />}
            value={keyword}
            onChange={(e) => {
              setKeyword(e.target.value);
              bumpPage();
            }}
            className="toolbar-search"
          />
          <Select
            allowClear
            showSearch
            placeholder="命名空间"
            value={namespaceFilter || undefined}
            onChange={(v) => {
              setNamespaceFilter(v ?? '');
              bumpPage();
            }}
            className="toolbar-filter"
            options={namespaceOptions}
            popupMatchSelectWidth={false}
            optionFilterProp="label"
          />
          <Select
            allowClear
            showSearch
            placeholder="阶段"
            value={phaseFilter || undefined}
            onChange={(v) => {
              setPhaseFilter(v ?? '');
              bumpPage();
            }}
            className="toolbar-filter-sm"
            options={phaseOptions}
            popupMatchSelectWidth={false}
            optionFilterProp="label"
          />
          <Select
            allowClear
            showSearch
            placeholder="应用"
            value={applicationsFilter || undefined}
            onChange={(v) => {
              setApplicationsFilter(v ?? '');
              bumpPage();
            }}
            className="toolbar-filter-sm"
            options={applicationsOptions}
            popupMatchSelectWidth={false}
            optionFilterProp="label"
          />
          <button type="button" className="toolbar-reset-btn" onClick={resetFilters}>
            重置
          </button>
        </>
      }
      toolbarRight={
        <>
          {SHOW_CEPH_POOL_CREATE_AND_DELETE_ACTIONS &&
          applicationsScope === 'cloud' &&
          listSource === 'rook' ? (
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
          <Button icon={<ReloadOutlined />} onClick={handleToolbarRefresh} loading={loading} />
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
      ) : null}
      <Table<CephPoolTableRow>
        className="std-table"
        bordered={false}
        scroll={{ x: true }}
        rowKey="key"
        columns={tableColumns}
        dataSource={filtered}
        loading={loading}
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
        onSuccess={() => void runHarvesterSectionRefresh(sectionOnRefresh, { force: true })}
      />
      {yamlDrawer}
    </PageDetailSection>
    </>
  );
};

export default CephPoolSection;
