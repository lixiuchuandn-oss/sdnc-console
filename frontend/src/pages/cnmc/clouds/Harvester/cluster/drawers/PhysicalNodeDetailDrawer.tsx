/**
 * 物理节点（Harvester Node）侧滑详情 — 归属 Harvester/cluster/drawers。
 * 壳层约定：deployment/docs/specs/ui/物理交换机详情抽屉-壳层与实现规范.md（§1–§4 通用部分，实现以本文件为准）
 */
import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Button,
  ConfigProvider,
  Descriptions,
  Drawer,
  Empty,
  Space,
  Table,
  Tabs,
  Tag,
  Tooltip,
  Typography,
  theme,
} from 'antd';
import { CodeOutlined } from '@ant-design/icons';
import { NodeArchBadge } from '../components/NodeArchBadge';
import { ViewLinkTab } from '../../shared/components/ViewLinkTab';

type HmsNic = {
  device: string;
  state?: string;
  mac?: string;
  master?: string;
  usedByHarvester?: boolean;
};

export interface PhysicalNodeDetailDrawerProps {
  open: boolean;
  onClose: () => void;
  record: any;
  cloudId?: string;
  metrics?: { cpuUsedCores?: number; memUsedBytes?: number };
  /** 从集群刷新节点列表/详情数据（与列表区刷新同源） */
  onRefreshFromCluster?: (force?: boolean) => void;
  refreshLoading?: boolean;
}

const UI = {
  shell: '#0f1419',
  shellMuted: '#1a222d',
  text: '#e6edf3',
  textMuted: '#8b949e',
  bodyBg: '#f0f2f5',
  accent: '#58a6ff',
  border: 'rgba(230, 237, 243, 0.12)',
};

const HERO_KPI_DIVIDER: React.CSSProperties = {
  width: 1,
  alignSelf: 'stretch',
  minHeight: 40,
  background: UI.border,
  flexShrink: 0,
};

/** 与 ProviderNetworkDetailDrawer Tab 区一致：滚动外包左右 22px，面板仅上下留白 */
const DRAWER_TAB_SCROLL_BODY: React.CSSProperties = {
  flex: 1,
  minHeight: 0,
  overflow: 'auto',
  padding: '0 22px',
};
const TAB_PANEL_PADDING: React.CSSProperties = { padding: '4px 0 16px' };
/** 表格等较长内容 Tab 底部略增留白 */
const TAB_PANEL_PADDING_WIDE: React.CSSProperties = { padding: '4px 0 24px' };
const TAB_BAR_STYLE: React.CSSProperties = { marginBottom: 8, fontWeight: 500 };

/** 与 ProviderNetworkDetailDrawer 运维子抽屉内 ViewLink 区域一致 */
const NODE_OPS_SUB_DRAWER_VIEW_LINK_BOX: React.CSSProperties = {
  width: '100%',
  flex: 1,
  minHeight: 360,
  display: 'flex',
  flexDirection: 'column',
};

/** 首行右上角：小号文字链，不压标题 */
const heroActionTextPrimary: React.CSSProperties = { fontSize: 12, color: UI.accent, height: 'auto', paddingInline: 0 };
const heroActionTextSecondary: React.CSSProperties = { fontSize: 12, color: UI.textMuted, height: 'auto', paddingInline: 0 };

const HERO_TAG_BASE: React.CSSProperties = {
  margin: 0,
  fontSize: 12,
  lineHeight: '20px',
  borderRadius: 6,
};
const heroTagSuccess: React.CSSProperties = {
  ...HERO_TAG_BASE,
  background: 'rgba(63, 185, 80, 0.14)',
  border: '1px solid rgba(63, 185, 80, 0.38)',
  color: '#7ee787',
};
const heroTagError: React.CSSProperties = {
  ...HERO_TAG_BASE,
  background: 'rgba(248, 81, 73, 0.12)',
  border: '1px solid rgba(248, 81, 73, 0.42)',
  color: '#ffb1a9',
};

const safeNodeName = (r: any) => String(r?.name || r?.metadata?.name || '').trim();

const parseCpuToCores = (s?: string | number): number => {
  if (s === undefined || s === null) return 0;
  const t = String(s).trim();
  if (!t) return 0;
  if (/m$/i.test(t)) {
    const v = Number(t.replace(/m$/i, ''));
    return Number.isFinite(v) ? v / 1000 : 0;
  } else if (/n$/i.test(t)) {
    const v = Number(t.replace(/n$/i, ''));
    return Number.isFinite(v) ? v / 1e9 : 0;
  } else if (/u$/i.test(t)) {
    const v = Number(t.replace(/u$/i, ''));
    return Number.isFinite(v) ? v / 1e6 : 0;
  }
  const v = Number(t);
  return Number.isFinite(v) ? v : 0;
};

const parseMemoryToBytes = (s?: string | number): number => {
  if (s === undefined || s === null) return 0;
  const t = String(s).trim();
  if (!t) return 0;
  const m = t.match(/^(\d+(?:\.\d+)?)([KMGTP]i?)?$/i);
  if (!m) {
    const v = Number(t);
    return Number.isFinite(v) ? v : 0;
  }
  const val = Number(m[1]);
  const unit = (m[2] || '').toLowerCase();
  let bytes = val;
  if (unit === 'ki') bytes = val * 1024;
  else if (unit === 'mi') bytes = val * 1024 * 1024;
  else if (unit === 'gi') bytes = val * 1024 * 1024 * 1024;
  else if (unit === 'ti') bytes = val * 1024 * 1024 * 1024 * 1024;
  else if (unit === 'pi') bytes = val * 1024 * 1024 * 1024 * 1024 * 1024;
  else if (unit === 'k') bytes = val * 1000;
  else if (unit === 'm') bytes = val * 1e6;
  else if (unit === 'g') bytes = val * 1e9;
  else if (unit === 't') bytes = val * 1e12;
  else if (unit === 'p') bytes = val * 1e15;
  return bytes;
};

const safeJsonParse = <T,>(raw: any): T | null => {
  if (raw === undefined || raw === null) return null;
  if (typeof raw === 'object') return raw as T;
  const s = String(raw || '').trim();
  if (!s) return null;
  try {
    return JSON.parse(s) as T;
  } catch {
    return null;
  }
};

const formatBytesToGiB = (bytesLike: any): string => {
  const n = Number(bytesLike);
  if (!Number.isFinite(n) || n <= 0) return '-';
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GiB`;
};

const formatCpuToCoresText = (cpuLike: any): string => {
  const s = String(cpuLike ?? '').trim();
  if (!s) return '-';
  if (/m$/i.test(s)) {
    const v = Number(s.replace(/m$/i, ''));
    if (!Number.isFinite(v)) return s;
    return `${(v / 1000).toFixed(2)} 核`;
  }
  const v = Number(s);
  if (Number.isFinite(v)) return `${v.toFixed(2)} 核`;
  return s;
};

type KpiTone = 'ok' | 'warn' | 'err' | 'muted';

type PulseStatProps = {
  label: string;
  children: React.ReactNode;
  tone?: KpiTone;
};

const KPI_VALUE_COLOR: Record<KpiTone, string> = {
  ok: '#7ee787',
  err: '#ff7b72',
  warn: '#e3b341',
  muted: UI.text,
};

const PulseStat: React.FC<PulseStatProps> = ({ label, children, tone = 'muted' }) => (
  <div style={{ flex: '1 1 auto', minWidth: 88, maxWidth: '100%', padding: '2px 14px 0' }}>
    <Typography.Text style={{ fontSize: 12, color: UI.textMuted, display: 'block', marginBottom: 4 }}>
      {label}
    </Typography.Text>
    <div style={{ fontSize: 14, fontWeight: 600, color: KPI_VALUE_COLOR[tone], lineHeight: 1.35 }}>
      {children}
    </div>
  </div>
);

const descLabelStyle: React.CSSProperties = {
  width: 120,
  background: 'rgba(0,0,0,0.02)',
};

const PhysicalNodeDetailDrawer: React.FC<PhysicalNodeDetailDrawerProps> = ({
  open,
  onClose,
  record,
  cloudId,
  metrics,
  onRefreshFromCluster,
  refreshLoading = false,
}) => {
  const [activeTab, setActiveTab] = useState('node');
  const [opsSubDrawerOpen, setOpsSubDrawerOpen] = useState(false);

  const nics: HmsNic[] = useMemo(() => {
    const arr = record?.nics;
    return Array.isArray(arr) ? arr : [];
  }, [record]);

  const ready = useMemo(() => {
    if (typeof record?.ready === 'boolean') return record.ready;
    const conds: any[] = Array.isArray(record?.status?.conditions) ? record.status.conditions : [];
    return conds.some(
      (c) => String(c?.type || '') === 'Ready' && String(c?.status || '').toLowerCase() === 'true',
    );
  }, [record]);

  const internalIP =
    record?.internalIP ||
    record?.status?.addresses?.find((a: any) => a?.type === 'InternalIP')?.address ||
    '-';
  const externalIP =
    record?.externalIP ||
    record?.status?.addresses?.find((a: any) => a?.type === 'ExternalIP')?.address ||
    '-';

  const cpuTotal = useMemo(() => {
    return parseCpuToCores(
      record?.status?.allocatable?.cpu || record?.status?.capacity?.cpu || record?.cpu,
    );
  }, [record]);
  const memTotalBytes = useMemo(() => {
    return parseMemoryToBytes(
      record?.status?.allocatable?.memory || record?.status?.capacity?.memory || record?.memory,
    );
  }, [record]);
  const cpuUsed = metrics?.cpuUsedCores ?? 0;
  const memUsedBytes = metrics?.memUsedBytes ?? 0;
  const cpuPct = cpuTotal > 0 ? (cpuUsed / cpuTotal) * 100 : null;
  const memPct = memTotalBytes > 0 ? (memUsedBytes / memTotalBytes) * 100 : null;

  const annotations = (record?.metadata?.annotations || {}) as Record<string, any>;
  const ntp = useMemo(() => {
    return safeJsonParse<{ ntpSyncStatus?: string; currentNtpServers?: string }>(
      annotations?.['node.harvesterhci.io/ntp-service'],
    );
  }, [annotations]);
  const podRequests = useMemo(() => {
    return safeJsonParse<Record<string, any>>(annotations?.['management.cattle.io/pod-requests']);
  }, [annotations]);
  const podLimits = useMemo(() => {
    return safeJsonParse<Record<string, any>>(annotations?.['management.cattle.io/pod-limits']);
  }, [annotations]);
  const harvesterVersion = useMemo(() => {
    const fields: any[] = Array.isArray(record?.metadata?.fields) ? record.metadata.fields : [];
    const hit = fields.find((x) => String(x || '').includes('CloudHCI'));
    return String(hit || '').trim() || '-';
  }, [record]);

  const nicColumns = useMemo(
    () => [
      {
        title: '设备',
        key: 'device',
        dataIndex: 'device',
        width: 180,
        render: (v: any) => <span>{String(v || '-')}</span>,
      },
      {
        title: '状态',
        key: 'state',
        dataIndex: 'state',
        width: 120,
        render: (v: any) => {
          const s = String(v || '').toLowerCase();
          const color = s === 'up' ? 'success' : s === 'down' ? 'default' : 'default';
          return (
            <Tag color={color} style={{ margin: 0 }}>
              {s || '-'}
            </Tag>
          );
        },
      },
      {
        title: 'MAC',
        key: 'mac',
        dataIndex: 'mac',
        width: 220,
        render: (v: any) => <span className="nic-mono">{String(v || '-')}</span>,
      },
      {
        title: 'Master',
        key: 'master',
        dataIndex: 'master',
        width: 200,
        render: (v: any) => <span>{String(v || '-')}</span>,
      },
      {
        title: '已占用',
        key: 'usedByHarvester',
        dataIndex: 'usedByHarvester',
        width: 140,
        render: (v: any, r: HmsNic) => {
          const used = Boolean(v);
          const t = used ? `已被占用（master=${r?.master || '-'})` : '未占用';
          return (
            <Tooltip title={t}>
              <Tag color={used ? 'processing' : 'default'} style={{ margin: 0 }}>
                {used ? '已占用' : '可用'}
              </Tag>
            </Tooltip>
          );
        },
      },
    ],
    [],
  );

  const titleName = safeNodeName(record) || '节点详情';

  const nodeArchitecture = useMemo(
    () => record?.architecture || record?.status?.nodeInfo?.architecture,
    [record],
  );

  useEffect(() => {
    if (open) setActiveTab('node');
  }, [open, titleName]);

  useEffect(() => {
    if (!open) setOpsSubDrawerOpen(false);
  }, [open]);

  const hasMetrics = metrics != null && (metrics.cpuUsedCores != null || metrics.memUsedBytes != null);
  const cpuKpiTone: KpiTone =
    !hasMetrics || cpuTotal <= 0 ? 'muted' : cpuPct != null && cpuPct >= 90 ? 'warn' : 'ok';
  const memKpiTone: KpiTone =
    !hasMetrics || memTotalBytes <= 0 ? 'muted' : memPct != null && memPct >= 90 ? 'warn' : 'ok';
  const nicKpiTone: KpiTone = nics.length > 0 ? 'ok' : 'muted';
  const nicUsed = nics.filter((x) => Boolean(x?.usedByHarvester)).length;

  const nodeViewLink = useMemo(() => {
    if (!record) return '';
    const raw = record?.links?.view;
    if (raw != null && String(raw).trim()) return String(raw).trim();
    const name = String(record?.metadata?.name || record?.name || '').trim();
    if (!name) return '';
    return `/api/v1/nodes/${encodeURIComponent(name)}`;
  }, [record]);

  const tabItems = useMemo(() => {
    if (!record) return [];
    return [
      {
        key: 'node',
        label: '节点信息',
        children: (
          <div style={TAB_PANEL_PADDING}>
            <Descriptions bordered size="small" column={1} labelStyle={descLabelStyle}>
              <Descriptions.Item label="名称">{titleName || '-'}</Descriptions.Item>
              <Descriptions.Item label="就绪">{ready ? 'Ready' : 'NotReady'}</Descriptions.Item>
              <Descriptions.Item label="内网 IP">
                {internalIP !== '-' ? (
                  <Typography.Text copyable={{ text: String(internalIP) }} code>
                    {internalIP}
                  </Typography.Text>
                ) : (
                  '-'
                )}
              </Descriptions.Item>
              <Descriptions.Item label="公网 IP">
                {externalIP !== '-' ? (
                  <Typography.Text copyable={{ text: String(externalIP) }} code>
                    {externalIP}
                  </Typography.Text>
                ) : (
                  '-'
                )}
              </Descriptions.Item>
              <Descriptions.Item label="Kubelet 版本">
                {record?.kubeletVersion || record?.status?.nodeInfo?.kubeletVersion || '-'}
              </Descriptions.Item>
              <Descriptions.Item label="架构">
                {record?.architecture || record?.status?.nodeInfo?.architecture || '-'}
              </Descriptions.Item>
              <Descriptions.Item label="系统镜像">
                {record?.osImage || record?.status?.nodeInfo?.osImage || '-'}
              </Descriptions.Item>
              <Descriptions.Item label="内核版本">
                {record?.kernelVersion || record?.status?.nodeInfo?.kernelVersion || '-'}
              </Descriptions.Item>
              <Descriptions.Item label="容器运行时">
                {record?.containerRuntimeVersion ||
                  record?.status?.nodeInfo?.containerRuntimeVersion ||
                  '-'}
              </Descriptions.Item>
            </Descriptions>
          </div>
        ),
      },
      {
        key: 'cluster',
        label: '集群信息',
        children: (
          <div style={TAB_PANEL_PADDING}>
            <Descriptions bordered size="small" column={1} labelStyle={descLabelStyle}>
              <Descriptions.Item label="集群版本">{harvesterVersion}</Descriptions.Item>
              <Descriptions.Item label="NTP 同步状态">{String(ntp?.ntpSyncStatus || '-')}</Descriptions.Item>
              <Descriptions.Item label="NTP 服务器">
                <span style={{ wordBreak: 'break-all' }}>{String(ntp?.currentNtpServers || '-')}</span>
              </Descriptions.Item>
              <Descriptions.Item label="OVN 节点 IP">
                {String(annotations?.['ovn.kubernetes.io/ip_address'] || '-')}
              </Descriptions.Item>
              <Descriptions.Item label="OVN 节点 MAC">
                {String(annotations?.['ovn.kubernetes.io/mac_address'] || '-')}
              </Descriptions.Item>
              <Descriptions.Item label="OVN 网段 (CIDR)">
                {String(annotations?.['ovn.kubernetes.io/cidr'] || '-')}
              </Descriptions.Item>
              <Descriptions.Item label="OVN 网关">
                {String(annotations?.['ovn.kubernetes.io/gateway'] || '-')}
              </Descriptions.Item>
              <Descriptions.Item label="节点对外 IP（Flannel）">
                {String(annotations?.['flannel.alpha.coreos.com/public-ip'] || '-')}
              </Descriptions.Item>
              <Descriptions.Item label="etcd 本地快照时间">
                {String(annotations?.['etcd.rke2.cattle.io/local-snapshots-timestamp'] || '-')}
              </Descriptions.Item>
            </Descriptions>
          </div>
        ),
      },
      {
        key: 'reservations',
        label: '资源预留',
        children: (
          <div style={TAB_PANEL_PADDING}>
            <Descriptions bordered size="small" column={1} labelStyle={descLabelStyle}>
              <Descriptions.Item label="CPU 请求（Requests）">
                {podRequests?.cpu
                  ? `${String(podRequests.cpu)}（约 ${formatCpuToCoresText(podRequests.cpu)}）`
                  : '-'}
              </Descriptions.Item>
              <Descriptions.Item label="内存请求（Requests）">
                {podRequests?.memory
                  ? `${String(podRequests.memory)}（约 ${formatBytesToGiB(podRequests.memory)}）`
                  : '-'}
              </Descriptions.Item>
              <Descriptions.Item label="Pod 数请求">{String(podRequests?.pods || '-')}</Descriptions.Item>
              <Descriptions.Item label="临时存储请求">
                {String(podRequests?.['ephemeral-storage'] || '-')}
              </Descriptions.Item>
              <Descriptions.Item label="CPU 上限（Limits）">
                {podLimits?.cpu
                  ? `${String(podLimits.cpu)}（约 ${formatCpuToCoresText(podLimits.cpu)}）`
                  : '-'}
              </Descriptions.Item>
              <Descriptions.Item label="内存上限（Limits）">
                {podLimits?.memory
                  ? `${String(podLimits.memory)}（约 ${formatBytesToGiB(podLimits.memory)}）`
                  : '-'}
              </Descriptions.Item>
            </Descriptions>
          </div>
        ),
      },
      {
        key: 'nics',
        label: '网卡信息',
        children: (
          <div style={TAB_PANEL_PADDING_WIDE}>
            <Table
              className="physical-node-nic-table"
              size="small"
              bordered
              rowKey={(r: any) => `${r?.device || ''}-${r?.mac || ''}-${r?.master || ''}`}
              columns={nicColumns as any}
              dataSource={nics}
              pagination={{ size: 'small', showTotal: (t) => `共 ${t} 条` }}
            />
          </div>
        ),
      },
    ];
  }, [
    record,
    titleName,
    ready,
    internalIP,
    externalIP,
    harvesterVersion,
    ntp,
    annotations,
    podRequests,
    podLimits,
    nics,
    nicColumns,
  ]);

  const nodeOpsSubDrawerTitle = (
    <Space style={{ color: UI.text }}>
      <CodeOutlined style={{ color: UI.textMuted }} />
      <span>运维信息（集群 View Link）</span>
      {titleName ? (
        <Typography.Text style={{ fontSize: 13, color: UI.textMuted }}>{titleName}</Typography.Text>
      ) : null}
    </Space>
  );

  return (
    <>
      <style>{`
        .nic-mono { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace; }
        .physical-node-nic-table.ant-table-wrapper .ant-table-thead > tr > th.ant-table-cell {
          font-weight: 400 !important;
        }
        .physical-node-detail-drawer-scroll::-webkit-scrollbar { width: 6px; height: 6px; }
        .physical-node-detail-drawer-scroll::-webkit-scrollbar-track { background: transparent; }
        .physical-node-detail-drawer-scroll::-webkit-scrollbar-thumb { background: #e0e0e0; border-radius: 3px; }
        .physical-node-detail-drawer-scroll::-webkit-scrollbar-thumb:hover { background: #ccc; }
        .physical-node-detail-drawer-scroll .ant-tabs-content-holder { padding: 0; }
      `}</style>
      <Drawer
        title={null}
        open={open && !!record}
        onClose={onClose}
        width="min(1000px, 96vw)"
        placement="right"
        closable={false}
        destroyOnHidden
        styles={{
          body: {
            padding: 0,
            background: UI.bodyBg,
            display: 'flex',
            flexDirection: 'column',
            height: '100%',
            maxHeight: '100vh',
            overflow: 'hidden',
          },
        }}
      >
        {record ? (
          <>
            <div
              style={{
                flexShrink: 0,
                background: `linear-gradient(145deg, ${UI.shell} 0%, ${UI.shellMuted} 100%)`,
                color: UI.text,
                padding: '20px 22px 18px',
                borderBottom: `1px solid ${UI.border}`,
              }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 12,
                  flexWrap: 'wrap',
                }}
              >
                <Typography.Text
                  style={{
                    fontSize: 12,
                    letterSpacing: '0.14em',
                    textTransform: 'uppercase',
                    color: UI.textMuted,
                    flexShrink: 0,
                  }}
                >
                  Cloudmap 物理节点
                </Typography.Text>
                <div
                  style={{
                    flexShrink: 0,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'flex-end',
                    flexWrap: 'wrap',
                    gap: 8,
                    marginLeft: 'auto',
                  }}
                >
                  {onRefreshFromCluster ? (
                    <Button
                      type="text"
                      size="small"
                      onClick={() => onRefreshFromCluster(true)}
                      loading={refreshLoading}
                      style={heroActionTextPrimary}
                    >
                      刷新
                    </Button>
                  ) : null}
                  {cloudId ? (
                    <Button
                      type="text"
                      size="small"
                      disabled={!nodeViewLink}
                      onClick={() => {
                        if (nodeViewLink) setOpsSubDrawerOpen(true);
                      }}
                      style={heroActionTextSecondary}
                    >
                      运维信息
                    </Button>
                  ) : null}
                  <Button
                    type="text"
                    size="small"
                    aria-label="关闭"
                    onClick={onClose}
                    style={{ color: UI.textMuted, fontSize: 12, paddingInline: 0, height: 'auto' }}
                  >
                    关闭
                  </Button>
                </div>
              </div>
              <Typography.Title
                level={4}
                style={{
                  color: UI.text,
                  margin: '6px 0 0',
                  fontWeight: 600,
                  lineHeight: 1.35,
                  wordBreak: 'break-word',
                }}
              >
                {titleName}
              </Typography.Title>

              <div
                style={{
                  marginTop: 14,
                  paddingTop: 14,
                  borderTop: `1px solid ${UI.border}`,
                  display: 'flex',
                  flexWrap: 'wrap',
                  alignItems: 'center',
                  gap: '10px 14px',
                }}
              >
                <NodeArchBadge architecture={nodeArchitecture} />
                <Typography.Text style={{ color: UI.textMuted, fontSize: 13, marginRight: 4 }}>
                  内网 IP
                  {internalIP !== '-' ? (
                    <>
                      {' '}
                      <Typography.Text copyable={{ text: String(internalIP) }} style={{ color: UI.accent, fontSize: 13 }}>
                        {internalIP}
                      </Typography.Text>
                    </>
                  ) : (
                    ' —'
                  )}
                </Typography.Text>
                {externalIP !== '-' ? (
                  <Typography.Text style={{ color: UI.textMuted, fontSize: 13 }}>
                    公网{' '}
                    <Typography.Text copyable={{ text: String(externalIP) }} style={{ color: UI.accent, fontSize: 13 }}>
                      {externalIP}
                    </Typography.Text>
                  </Typography.Text>
                ) : null}
                <Typography.Text style={{ color: UI.textMuted, fontSize: 13 }}>
                  网卡 {nics.length} · 占用 {nicUsed}
                </Typography.Text>
                {ready ? (
                  <Tag style={heroTagSuccess}>就绪 · Ready</Tag>
                ) : (
                  <Tag style={heroTagError}>就绪 · NotReady</Tag>
                )}
              </div>

              <div
                style={{
                  display: 'flex',
                  flexWrap: 'wrap',
                  alignItems: 'stretch',
                  marginTop: 14,
                  paddingTop: 14,
                  borderTop: `1px solid ${UI.border}`,
                }}
              >
                <PulseStat label="就绪状态" tone={ready ? 'ok' : 'err'}>
                  {ready ? 'Ready' : 'NotReady'}
                </PulseStat>
                <div aria-hidden style={HERO_KPI_DIVIDER} />
                <PulseStat label="CPU 使用" tone={cpuKpiTone}>
                  {cpuTotal > 0 && cpuPct !== null
                    ? `${Math.max(0, Math.min(100, cpuPct)).toFixed(1)}% · ${cpuUsed.toFixed(2)}/${cpuTotal.toFixed(2)} core`
                    : hasMetrics
                      ? '—'
                      : '无实时指标'}
                </PulseStat>
                <div aria-hidden style={HERO_KPI_DIVIDER} />
                <PulseStat label="内存使用" tone={memKpiTone}>
                  {memTotalBytes > 0 && memPct !== null
                    ? `${Math.max(0, Math.min(100, memPct)).toFixed(1)}% · ${(memUsedBytes / (1024 * 1024 * 1024)).toFixed(2)}/${(memTotalBytes / (1024 * 1024 * 1024)).toFixed(2)} GiB`
                    : hasMetrics
                      ? '—'
                      : '无实时指标'}
                </PulseStat>
                <div aria-hidden style={HERO_KPI_DIVIDER} />
                <PulseStat label="物理网卡" tone={nicKpiTone}>
                  {nics.length} 块{nicUsed > 0 ? ` · ${nicUsed} 已占用` : ''}
                </PulseStat>
              </div>
            </div>

            <div className="physical-node-detail-drawer-scroll" style={DRAWER_TAB_SCROLL_BODY}>
              <Tabs activeKey={activeTab} onChange={setActiveTab} items={tabItems} tabBarStyle={TAB_BAR_STYLE} />
            </div>
          </>
        ) : null}
      </Drawer>

      <ConfigProvider
        theme={{
          algorithm: theme.darkAlgorithm,
          token: {
            colorBgElevated: UI.shell,
            colorBgContainer: UI.shellMuted,
            colorSplit: UI.border,
            colorText: UI.text,
            colorTextSecondary: UI.textMuted,
          },
        }}
      >
        <Drawer
          title={nodeOpsSubDrawerTitle}
          placement="right"
          width="min(920px, 96vw)"
          open={opsSubDrawerOpen && open && !!record}
          onClose={() => setOpsSubDrawerOpen(false)}
          destroyOnHidden
          zIndex={1100}
          styles={{
            content: { background: UI.shell },
            header: {
              background: UI.shell,
              borderBottom: `1px solid ${UI.border}`,
            },
            body: {
              padding: 0,
              display: 'flex',
              flexDirection: 'column',
              height: '100%',
              maxHeight: '100vh',
              overflow: 'hidden',
              background: UI.shell,
            },
          }}
        >
          {!cloudId ? (
            <div
              style={{
                flex: 1,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: 24,
                minHeight: 200,
              }}
            >
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="未配置 cloudId，无法拉取集群 API数据" />
            </div>
          ) : nodeViewLink ? (
            <div style={NODE_OPS_SUB_DRAWER_VIEW_LINK_BOX}>
              <ViewLinkTab
                cloudId={cloudId}
                viewLink={nodeViewLink}
                active={opsSubDrawerOpen && open && !!record}
                style={{ flex: 1, minHeight: 360, border: 'none', borderRadius: 0 }}
              />
            </div>
          ) : (
            <div style={{ padding: 16, flex: 1, minHeight: 0 }}>
              <Alert
                type="warning"
                showIcon
                message="无法解析查看路径"
                description="缺少节点名称，无法构造 Node的集群查看 URL。"
              />
            </div>
          )}
        </Drawer>
      </ConfigProvider>
    </>
  );
};

export default PhysicalNodeDetailDrawer;
