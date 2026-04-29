/**
 * Rook-Ceph：布局参考 Ceph Dashboard；Rook CR 来自 `/monitoring/ceph-resources`；
 * 「物理磁盘」对齐 Dashboard「集群 → 物理磁盘」，数据为 Harvester `BlockDevice`（`/monitoring/blockdevices`）。
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Col,
  Divider,
  Progress,
  Row,
  Space,
  Table,
  Tabs,
  Tag,
  Tooltip,
  Typography,
} from 'antd';
import {
  AppstoreOutlined,
  DatabaseOutlined,
  HeartOutlined,
  HddOutlined,
  ReloadOutlined,
  SafetyCertificateOutlined,
} from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import PageDetailSection from '../../../../../../components/PageDetailSection';
import { fetchBlockDevices, fetchCephResources } from '../../../../../../services/monitoringApi';
import type { CephHealthLevel, CephResourceBundle } from '../../monitoring/utils/cephStorage';
import {
  blockPoolCephPoolName,
  blockPoolCrushRoot,
  blockPoolDeviceClass,
  blockPoolHybridSummary,
  blockPoolMirroringSummary,
  blockPoolMode,
  blockPoolParametersSummary,
  blockPoolQuotasSummary,
  blockPoolReplicasOrEc,
  blockDeviceCapacityLabel,
  blockDeviceDevPath,
  blockDeviceDiskType,
  blockDeviceHasError,
  blockDeviceModel,
  blockDeviceNodeName,
  blockDeviceProvisionIntent,
  blockDeviceProvisionPhase,
  blockDeviceRowKey,
  blockDeviceSerialOrWwn,
  blockPoolStatusPoolId,
  cephClusterCapacityBytes,
  cephClusterFsid,
  cephClusterHealth,
  cephClusterPhase,
  cephClusterVersion,
  cephHealthLevel,
  countRadosNamespacesForBlockPool,
  filesystemMdsSummary,
  harvesterSteveItems,
  fmtBytesFromUnknown,
  normalizeCephBundle,
  objectStorePoolsSummary,
  rookPhase,
  rookResourceRowKey,
  rookStatusMessage,
  worstCephHealthLevel,
} from '../../monitoring/utils/cephStorage';

export type CephStorageSectionProps = {
  cloudId: string;
};

function healthBannerColors(level: CephHealthLevel): { tag: string; stroke: [string, string] } {
  if (level === 'ok') {
    return { tag: 'success', stroke: ['#00c853', '#69f0ae'] };
  }
  if (level === 'warn') {
    return { tag: 'warning', stroke: ['#ff9800', '#ffcc80'] };
  }
  if (level === 'err') {
    return { tag: 'error', stroke: ['#ff5252', '#ff8a80'] };
  }
  return { tag: 'default', stroke: ['#78909c', '#b0bec5'] };
}

function pickBannerHealthLabel(clusters: any[], worst: CephHealthLevel): string {
  for (const c of clusters) {
    const h = cephClusterHealth(c);
    if (h !== '-' && cephHealthLevel(h) === worst) return h;
  }
  const h0 = clusters[0] ? cephClusterHealth(clusters[0]) : '-';
  return h0 !== '-' ? h0 : worst === 'unknown' ? '未知' : '—';
}

const CephStorageSection: React.FC<CephStorageSectionProps> = ({ cloudId }) => {
  const [bundle, setBundle] = useState<CephResourceBundle>(normalizeCephBundle(null));
  const [blockDevices, setBlockDevices] = useState<any[]>([]);
  const [blockDevicesErr, setBlockDevicesErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [tabKey, setTabKey] = useState('overview');

  const load = useCallback(async () => {
    if (!cloudId) return;
    setLoading(true);
    setErr(null);
    setBlockDevicesErr(null);
    try {
      const [cephRes, bdRes] = await Promise.all([
        fetchCephResources(cloudId),
        fetchBlockDevices(cloudId),
      ]);
      if (!cephRes.ok) {
        setErr(cephRes.error || '加载失败');
        setBundle(normalizeCephBundle(null));
      } else {
        setBundle(normalizeCephBundle(cephRes.data));
      }
      if (bdRes.ok) {
        setBlockDevices(harvesterSteveItems(bdRes.data));
      } else {
        setBlockDevices([]);
        setBlockDevicesErr(bdRes.error || '块设备列表加载失败');
      }
    } catch (e: any) {
      setErr(e?.message || '加载失败');
      setBundle(normalizeCephBundle(null));
      setBlockDevices([]);
    } finally {
      setLoading(false);
    }
  }, [cloudId]);

  useEffect(() => {
    void load();
  }, [load]);

  const { clusters, blockPools, filesystems, objectStores, radosNamespaces } = bundle;

  const hasAny =
    clusters.length +
      blockPools.length +
      filesystems.length +
      objectStores.length +
      radosNamespaces.length +
      blockDevices.length >
    0;

  const summary = useMemo(() => {
    let total = 0;
    let used = 0;
    let avail = 0;
    for (const c of clusters) {
      const { total: t, used: u, available: a } = cephClusterCapacityBytes(c);
      total += t;
      used += u;
      avail += a;
    }
    const usedPct = total > 0 ? Math.min(100, Math.round((used / total) * 1000) / 10) : 0;
    return { total, used, avail, count: clusters.length, usedPct };
  }, [clusters]);

  const worst = useMemo(() => worstCephHealthLevel(clusters), [clusters]);
  const bannerHealthLabel = useMemo(() => pickBannerHealthLabel(clusters, worst), [clusters, worst]);
  const bannerColors = useMemo(() => healthBannerColors(worst), [worst]);

  const primary = clusters[0];

  const clusterColumns: ColumnsType<any> = useMemo(
    () => [
      {
        title: '命名空间',
        key: 'ns',
        ellipsis: true,
        render: (_: unknown, r: any) => r?.metadata?.namespace || '-',
      },
      {
        title: '集群名称',
        key: 'name',
        ellipsis: true,
        render: (_: unknown, r: any) => <Typography.Text strong>{r?.metadata?.name || '-'}</Typography.Text>,
      },
      {
        title: '阶段',
        key: 'phase',
        ellipsis: true,
        render: (_: unknown, r: any) => {
          const p = cephClusterPhase(r);
          const ok = /ready/i.test(p);
          return ok ? <Tag color="success">{p}</Tag> : <Tag>{p}</Tag>;
        },
      },
      {
        title: 'Ceph 健康',
        key: 'health',
        ellipsis: true,
        render: (_: unknown, r: any) => {
          const h = cephClusterHealth(r);
          if (h === '-') return <Typography.Text type="secondary">-</Typography.Text>;
          const lv = cephHealthLevel(h);
          const color = lv === 'ok' ? 'success' : lv === 'err' ? 'error' : lv === 'warn' ? 'warning' : 'default';
          return <Tag color={color}>{h}</Tag>;
        },
      },
      {
        title: '版本',
        key: 'ver',
        ellipsis: true,
        render: (_: unknown, r: any) => {
          const v = cephClusterVersion(r);
          return v === '-' ? <Typography.Text type="secondary">-</Typography.Text> : v;
        },
      },
      {
        title: '总容量',
        key: 'total',
        ellipsis: true,
        render: (_: unknown, r: any) => fmtBytesFromUnknown(cephClusterCapacityBytes(r).total),
      },
      {
        title: '已用',
        key: 'used',
        ellipsis: true,
        render: (_: unknown, r: any) => fmtBytesFromUnknown(cephClusterCapacityBytes(r).used),
      },
      {
        title: '可用',
        key: 'avail',
        ellipsis: true,
        render: (_: unknown, r: any) => fmtBytesFromUnknown(cephClusterCapacityBytes(r).available),
      },
      {
        title: '信息',
        key: 'msg',
        ellipsis: true,
        render: (_: unknown, r: any) => {
          const m =
            r?.status?.message ||
            r?.status?.conditions?.find?.((c: any) => c?.type === 'Ready' && c?.message)?.message ||
            '';
          const s = typeof m === 'string' ? m.trim() : '';
          return s ? <Typography.Text type="secondary">{s}</Typography.Text> : '-';
        },
      },
    ],
    [],
  );

  const poolColumns: ColumnsType<any> = useMemo(
    () => [
      {
        title: '命名空间',
        key: 'ns',
        ellipsis: true,
        render: (_: unknown, r: any) => r?.metadata?.namespace || '-',
      },
      {
        title: '池名称',
        key: 'name',
        ellipsis: true,
        render: (_: unknown, r: any) => <Typography.Text strong>{r?.metadata?.name || '-'}</Typography.Text>,
      },
      {
        title: 'Ceph 池名',
        key: 'cephPool',
        ellipsis: true,
        render: (_: unknown, r: any) => blockPoolCephPoolName(r?.spec),
      },
      {
        title: 'deviceClass',
        key: 'dc',
        ellipsis: true,
        render: (_: unknown, r: any) => blockPoolDeviceClass(r?.spec),
      },
      {
        title: 'crushRoot',
        key: 'cr',
        ellipsis: true,
        render: (_: unknown, r: any) => blockPoolCrushRoot(r?.spec),
      },
      {
        title: '混合存储',
        key: 'hybrid',
        ellipsis: true,
        render: (_: unknown, r: any) => blockPoolHybridSummary(r?.spec),
      },
      {
        title: '类型',
        key: 'mode',
        ellipsis: true,
        render: (_: unknown, r: any) => blockPoolMode(r?.spec),
      },
      {
        title: '副本 / 纠删',
        key: 'rep',
        ellipsis: true,
        render: (_: unknown, r: any) => blockPoolReplicasOrEc(r?.spec),
      },
      {
        title: 'failureDomain',
        key: 'fd',
        ellipsis: true,
        render: (_: unknown, r: any) => {
          const f = r?.spec?.failureDomain ?? r?.spec?.replicated?.failureDomain;
          return typeof f === 'string' && f ? f : '-';
        },
      },
      {
        title: '参数',
        key: 'params',
        ellipsis: true,
        render: (_: unknown, r: any) => {
          const full = blockPoolParametersSummary(r?.spec, 8000);
          const cell = blockPoolParametersSummary(r?.spec, 96);
          if (full === '-') return '-';
          return (
            <Tooltip title={<span style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>{full}</span>}>
              <span>{cell}</span>
            </Tooltip>
          );
        },
      },
      {
        title: '配额',
        key: 'quota',
        ellipsis: true,
        render: (_: unknown, r: any) => blockPoolQuotasSummary(r?.spec),
      },
      {
        title: 'RBD 镜像',
        key: 'mirror',
        ellipsis: true,
        render: (_: unknown, r: any) => blockPoolMirroringSummary(r?.spec),
      },
      {
        title: '池 ID',
        key: 'poolId',
        ellipsis: true,
        render: (_: unknown, r: any) => blockPoolStatusPoolId(r?.status),
      },
      {
        title: 'RADOS NS',
        key: 'rns',
        render: (_: unknown, r: any) => countRadosNamespacesForBlockPool(r, radosNamespaces),
      },
      {
        title: '阶段',
        key: 'phase',
        ellipsis: true,
        render: (_: unknown, r: any) => {
          const p = rookPhase(r);
          const ok = /ready/i.test(p);
          return ok ? <Tag color="success">{p}</Tag> : <Tag>{p}</Tag>;
        },
      },
      {
        title: '信息',
        key: 'msg',
        ellipsis: true,
        render: (_: unknown, r: any) => {
          const s = rookStatusMessage(r);
          return s ? <Typography.Text type="secondary">{s}</Typography.Text> : '-';
        },
      },
    ],
    [radosNamespaces],
  );

  const fsColumns: ColumnsType<any> = useMemo(
    () => [
      {
        title: '命名空间',
        key: 'ns',
        ellipsis: true,
        render: (_: unknown, r: any) => r?.metadata?.namespace || '-',
      },
      {
        title: '文件系统',
        key: 'name',
        ellipsis: true,
        render: (_: unknown, r: any) => <Typography.Text strong>{r?.metadata?.name || '-'}</Typography.Text>,
      },
      {
        title: 'MDS',
        key: 'mds',
        ellipsis: true,
        render: (_: unknown, r: any) => filesystemMdsSummary(r?.spec),
      },
      {
        title: '阶段',
        key: 'phase',
        ellipsis: true,
        render: (_: unknown, r: any) => {
          const p = rookPhase(r);
          const ok = /ready/i.test(p);
          return ok ? <Tag color="success">{p}</Tag> : <Tag>{p}</Tag>;
        },
      },
      {
        title: '信息',
        key: 'msg',
        ellipsis: true,
        render: (_: unknown, r: any) => {
          const s = rookStatusMessage(r);
          return s ? <Typography.Text type="secondary">{s}</Typography.Text> : '-';
        },
      },
    ],
    [],
  );

  const osColumns: ColumnsType<any> = useMemo(
    () => [
      {
        title: '命名空间',
        key: 'ns',
        ellipsis: true,
        render: (_: unknown, r: any) => r?.metadata?.namespace || '-',
      },
      {
        title: '对象存储',
        key: 'name',
        ellipsis: true,
        render: (_: unknown, r: any) => <Typography.Text strong>{r?.metadata?.name || '-'}</Typography.Text>,
      },
      {
        title: '池',
        key: 'pools',
        ellipsis: true,
        render: (_: unknown, r: any) => objectStorePoolsSummary(r?.spec),
      },
      {
        title: '阶段',
        key: 'phase',
        ellipsis: true,
        render: (_: unknown, r: any) => {
          const p = rookPhase(r);
          const ok = /ready|created/i.test(p);
          return ok ? <Tag color="success">{p}</Tag> : <Tag>{p}</Tag>;
        },
      },
      {
        title: '信息',
        key: 'msg',
        ellipsis: true,
        render: (_: unknown, r: any) => {
          const s = rookStatusMessage(r);
          return s ? <Typography.Text type="secondary">{s}</Typography.Text> : '-';
        },
      },
    ],
    [],
  );

  const sortedBlockDevices = useMemo(() => {
    return [...blockDevices].sort((a, b) => {
      const na = blockDeviceNodeName(a);
      const nb = blockDeviceNodeName(b);
      if (na !== nb) return na.localeCompare(nb);
      return blockDeviceDevPath(a).localeCompare(blockDeviceDevPath(b));
    });
  }, [blockDevices]);

  const diskColumns: ColumnsType<any> = useMemo(
    () => [
      {
        title: '命名空间',
        key: 'ns',
        ellipsis: true,
        render: (_: unknown, r: any) => r?.metadata?.namespace || '-',
      },
      {
        title: '节点',
        key: 'node',
        ellipsis: true,
        render: (_: unknown, r: any) => blockDeviceNodeName(r),
      },
      {
        title: '设备 CR',
        key: 'cr',
        ellipsis: true,
        render: (_: unknown, r: any) => <Typography.Text strong>{r?.metadata?.name || '-'}</Typography.Text>,
      },
      {
        title: '设备路径',
        key: 'path',
        ellipsis: true,
        render: (_: unknown, r: any) => <Typography.Text code>{blockDeviceDevPath(r)}</Typography.Text>,
      },
      {
        title: '容量',
        key: 'cap',
        ellipsis: true,
        render: (_: unknown, r: any) => blockDeviceCapacityLabel(r),
      },
      {
        title: '类型',
        key: 'dtype',
        ellipsis: true,
        render: (_: unknown, r: any) => blockDeviceDiskType(r),
      },
      {
        title: '型号',
        key: 'model',
        ellipsis: true,
        render: (_: unknown, r: any) => blockDeviceModel(r),
      },
      {
        title: '序列号 / WWN',
        key: 'sn',
        ellipsis: true,
        render: (_: unknown, r: any) => blockDeviceSerialOrWwn(r),
      },
      {
        title: '供应阶段',
        key: 'phase',
        ellipsis: true,
        render: (_: unknown, r: any) => {
          const p = blockDeviceProvisionPhase(r);
          const ok = /provisioned|inuse|ready|available/i.test(p);
          return ok ? <Tag color="success">{p}</Tag> : <Tag>{p}</Tag>;
        },
      },
      {
        title: '供应意图',
        key: 'intent',
        ellipsis: true,
        render: (_: unknown, r: any) => blockDeviceProvisionIntent(r),
      },
      {
        title: '异常',
        key: 'err',
        render: (_: unknown, r: any) =>
          blockDeviceHasError(r) ? <Tag color="error">是</Tag> : <Typography.Text type="secondary">—</Typography.Text>,
      },
    ],
    [],
  );

  const overviewTab = (
    <>
      {clusters.length === 0 && hasAny ? (
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
          message="未返回 CephCluster 资源，总览容量与健康可能为空；可在「物理磁盘」或「块存储池 / 文件系统 / 对象存储」查看其它数据。"
        />
      ) : null}

      <div className="ceph-dash-hero">
        <Row align="middle" gutter={[16, 16]}>
          <Col flex="auto">
            <div className="ceph-dash-title">集群状态</div>
            <div className="ceph-dash-cluster-name">
              {summary.count === 1 && primary
                ? `${primary?.metadata?.namespace || 'default'} / ${primary?.metadata?.name || 'ceph'}`
                : summary.count > 1
                  ? `已托管 ${summary.count} 个 Ceph 集群`
                  : 'Rook Ceph'}
            </div>
            <Space size={12} style={{ marginTop: 12 }} wrap>
              <Tag
                icon={<HeartOutlined />}
                color={bannerColors.tag}
                style={{ fontSize: 14, padding: '4px 12px', margin: 0, border: 'none' }}
              >
                {bannerHealthLabel}
              </Tag>
              {summary.count === 1 && primary ? (
                <Tag color="processing" style={{ margin: 0, opacity: 0.95 }}>
                  阶段：{cephClusterPhase(primary)}
                </Tag>
              ) : null}
            </Space>
          </Col>
          <Col>
            <Space direction="vertical" align="end" size={8}>
              <Button
                type="primary"
                ghost
                style={{ color: '#fff', borderColor: 'rgba(255,255,255,0.55)' }}
                icon={<ReloadOutlined />}
                onClick={() => void load()}
                loading={loading}
              >
                刷新
              </Button>
              <Typography.Text style={{ color: 'rgba(255,255,255,0.65)', fontSize: 12 }}>
                ceph-resources 聚合
              </Typography.Text>
            </Space>
          </Col>
        </Row>
      </div>

      <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
        <Col xs={24} lg={10}>
          <div className="ceph-dash-card-metric">
            <div className="ceph-dash-widget-title">
              <HddOutlined style={{ marginRight: 6 }} />
              存储容量
            </div>
            {summary.total > 0 ? (
              <Row align="middle" gutter={24}>
                <Col>
                  <Progress
                    type="dashboard"
                    percent={summary.usedPct}
                    size={140}
                    strokeColor={{ '0%': bannerColors.stroke[0], '100%': bannerColors.stroke[1] }}
                    trailColor="rgba(0,0,0,0.06)"
                    format={(p) => `${p ?? 0}%`}
                  />
                </Col>
                <Col flex="auto">
                  <Typography.Paragraph style={{ marginBottom: 6 }} strong>
                    已用 {fmtBytesFromUnknown(summary.used)}
                  </Typography.Paragraph>
                  <Typography.Paragraph type="secondary" style={{ marginBottom: 4, fontSize: 13 }}>
                    共 {fmtBytesFromUnknown(summary.total)} · 可用 {fmtBytesFromUnknown(summary.avail)}
                  </Typography.Paragraph>
                  <Progress
                    percent={summary.usedPct}
                    showInfo={false}
                    strokeColor={bannerColors.stroke[0]}
                    trailColor="#e8eaf0"
                    style={{ marginTop: 8 }}
                  />
                </Col>
              </Row>
            ) : (
              <Typography.Text type="secondary">
                无 CephCluster 容量字段或未就绪；就绪后 Rook 会写入 status.ceph.capacity。
              </Typography.Text>
            )}
          </div>
        </Col>
        <Col xs={24} lg={7}>
          <div className="ceph-dash-card-metric">
            <div className="ceph-dash-widget-title">
              <SafetyCertificateOutlined style={{ marginRight: 6 }} />
              集群身份
            </div>
            {primary ? (
              <>
                <Typography.Text type="secondary" style={{ fontSize: 12, display: 'block' }}>
                  FSID
                </Typography.Text>
                {cephClusterFsid(primary) !== '-' ? (
                  <Typography.Paragraph
                    copyable={{ text: cephClusterFsid(primary) }}
                    style={{ marginBottom: 8, fontFamily: 'monospace', fontSize: 12, wordBreak: 'break-all' }}
                  >
                    {cephClusterFsid(primary)}
                  </Typography.Paragraph>
                ) : (
                  <Typography.Paragraph style={{ marginBottom: 8 }} type="secondary">
                    —
                  </Typography.Paragraph>
                )}
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  Ceph 版本
                </Typography.Text>
                <Typography.Text code style={{ fontSize: 12 }}>
                  {cephClusterVersion(primary)}
                </Typography.Text>
              </>
            ) : (
              <Typography.Text type="secondary">—</Typography.Text>
            )}
          </div>
        </Col>
        <Col xs={24} lg={7}>
          <div className="ceph-dash-card-metric">
            <div className="ceph-dash-widget-title">
              <AppstoreOutlined style={{ marginRight: 6 }} />
              CRD 对象计数
            </div>
            <Space direction="vertical" size={4} style={{ width: '100%' }}>
              <Typography.Text>
                <Typography.Text strong>{clusters.length}</Typography.Text> CephCluster
              </Typography.Text>
              <Typography.Text>
                <Typography.Text strong>{blockPools.length}</Typography.Text> CephBlockPool
              </Typography.Text>
              <Typography.Text>
                <Typography.Text strong>{filesystems.length}</Typography.Text> CephFilesystem
              </Typography.Text>
              <Typography.Text>
                <Typography.Text strong>{objectStores.length}</Typography.Text> CephObjectStore
              </Typography.Text>
              <Typography.Text>
                <Typography.Text strong>{radosNamespaces.length}</Typography.Text> CephBlockPoolRadosNamespace
              </Typography.Text>
              <Typography.Text>
                <Typography.Text strong>{blockDevices.length}</Typography.Text> Harvester BlockDevice（物理磁盘）
              </Typography.Text>
            </Space>
            <Divider style={{ margin: '12px 0' }} />
            <Typography.Paragraph type="secondary" style={{ margin: 0, fontSize: 12 }}>
              Rook CR 为资源视图；「物理磁盘」来自 Harvester 块设备发现。Ceph Dashboard 中 OSD / Monitor / PG 等仍依赖 mgr 或
              Prometheus。
            </Typography.Paragraph>
          </div>
        </Col>
      </Row>

      <Card
        size="small"
        variant="borderless"
        style={{ border: '1px solid #e8eaf0', borderRadius: 8 }}
        title={
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            <DatabaseOutlined />
            <span>CephCluster 列表</span>
          </span>
        }
      >
        <Table
          className="std-table"
          bordered={false}
          rowKey={(r: any, i) => rookResourceRowKey(r, i ?? 0)}
          loading={loading}
          columns={clusterColumns}
          dataSource={clusters}
          scroll={clusters.length > 0 ? ({ x: true } as const) : undefined}
          pagination={clusters.length > 12 ? { pageSize: 12, showTotal: (t) => `共 ${t} 条` } : false}
          locale={{ emptyText: '无 CephCluster' }}
        />
      </Card>
    </>
  );

  const tabItems = [
      {
        key: 'overview',
        label: '总览',
        children: overviewTab,
      },
      {
        key: 'physical-disks',
        label: '物理磁盘',
        children: (
          <Card size="small" variant="borderless" style={{ border: '1px solid #e8eaf0', borderRadius: 8 }}>
            {blockDevicesErr ? (
              <Alert
                type="warning"
                showIcon
                style={{ marginBottom: 12 }}
                message={blockDevicesErr}
                description="物理磁盘列表依赖 Steve 的 harvesterhci.io.blockdevices；无权限或接口不可达时仅影响本 Tab。"
              />
            ) : null}
            <Typography.Paragraph type="secondary" style={{ marginBottom: 12 }}>
              对齐 Ceph Dashboard「<Typography.Text strong>集群 → 物理磁盘</Typography.Text>」：在 Harvester 上由{' '}
              <Typography.Text code>harvesterhci.io.blockdevices</Typography.Text> 描述各节点上的块设备发现结果（路径、容量、型号、供应阶段等），供
              Longhorn / Ceph 等使用；与 Rook <Typography.Text code>CephBlockPool</Typography.Text> 不同源。
            </Typography.Paragraph>
            <Table
              className="std-table"
              bordered={false}
              rowKey={(r: any, i) => blockDeviceRowKey(r, i ?? 0)}
              loading={loading}
              columns={diskColumns}
              dataSource={sortedBlockDevices}
              scroll={sortedBlockDevices.length > 0 ? { x: 1480 } : undefined}
              pagination={sortedBlockDevices.length > 12 ? { pageSize: 12, showTotal: (t) => `共 ${t} 条` } : false}
              locale={{ emptyText: '无 BlockDevice（或未安装节点磁盘发现组件）' }}
            />
          </Card>
        ),
      },
      {
        key: 'pools',
        label: '块存储池',
        children: (
          <Card size="small" variant="borderless" style={{ border: '1px solid #e8eaf0', borderRadius: 8 }}>
            <Typography.Paragraph type="secondary" style={{ marginBottom: 12 }}>
              对应 Ceph Dashboard 的 <Typography.Text strong>Pools</Typography.Text>：主资源为{' '}
              <Typography.Text code>CephBlockPool</Typography.Text>；同命名空间下{' '}
              <Typography.Text code>CephBlockPoolRadosNamespace</Typography.Text>（
              <Typography.Text code>spec.blockPoolName</Typography.Text> 指向池 CR 名）汇总在「RADOS
              NS」列。其余 Rook CR（如 CephFilesystem、CephObjectStore、CephNFS 等）在其它 Tab 或未接入本页。
            </Typography.Paragraph>
            <Table
              className="std-table"
              bordered={false}
              rowKey={(r: any, i) => rookResourceRowKey(r, i ?? 0)}
              loading={loading}
              columns={poolColumns}
              dataSource={blockPools}
              scroll={blockPools.length > 0 ? { x: 1680 } : undefined}
              pagination={blockPools.length > 12 ? { pageSize: 12, showTotal: (t) => `共 ${t} 条` } : false}
              locale={{ emptyText: '无 CephBlockPool' }}
            />
          </Card>
        ),
      },
      {
        key: 'filesystems',
        label: '文件系统',
        children: (
          <Card size="small" variant="borderless" style={{ border: '1px solid #e8eaf0', borderRadius: 8 }}>
            <Typography.Paragraph type="secondary" style={{ marginBottom: 12 }}>
              对应 Ceph Dashboard 的 <Typography.Text strong>Filesystems</Typography.Text>（
              <Typography.Text code>CephFilesystem</Typography.Text>）。
            </Typography.Paragraph>
            <Table
              className="std-table"
              bordered={false}
              rowKey={(r: any, i) => rookResourceRowKey(r, i ?? 0)}
              loading={loading}
              columns={fsColumns}
              dataSource={filesystems}
              scroll={filesystems.length > 0 ? ({ x: true } as const) : undefined}
              pagination={filesystems.length > 12 ? { pageSize: 12, showTotal: (t) => `共 ${t} 条` } : false}
              locale={{ emptyText: '无 CephFilesystem' }}
            />
          </Card>
        ),
      },
      {
        key: 'objectstores',
        label: '对象存储',
        children: (
          <Card size="small" variant="borderless" style={{ border: '1px solid #e8eaf0', borderRadius: 8 }}>
            <Typography.Paragraph type="secondary" style={{ marginBottom: 12 }}>
              对应 Ceph Dashboard 的 <Typography.Text strong>Object Gateway</Typography.Text> 抽象（
              <Typography.Text code>CephObjectStore</Typography.Text>）。
            </Typography.Paragraph>
            <Table
              className="std-table"
              bordered={false}
              rowKey={(r: any, i) => rookResourceRowKey(r, i ?? 0)}
              loading={loading}
              columns={osColumns}
              dataSource={objectStores}
              scroll={objectStores.length > 0 ? ({ x: true } as const) : undefined}
              pagination={objectStores.length > 12 ? { pageSize: 12, showTotal: (t) => `共 ${t} 条` } : false}
              locale={{ emptyText: '无 CephObjectStore' }}
            />
          </Card>
        ),
      },
    ];

  return (
    <PageDetailSection asCard={false}>
      <style>{`
        .ceph-dash-hero {
          border-radius: 10px;
          padding: 20px 24px;
          color: #fff;
          background: linear-gradient(135deg, #0d1642 0%, #1a237e 42%, #283593 100%);
          margin-bottom: 16px;
          box-shadow: 0 4px 14px rgba(26, 35, 126, 0.35);
        }
        .ceph-dash-hero .ceph-dash-title {
          font-size: 13px;
          letter-spacing: 0.06em;
          text-transform: uppercase;
          opacity: 0.75;
          margin-bottom: 6px;
        }
        .ceph-dash-hero .ceph-dash-cluster-name {
          font-size: 20px;
          font-weight: 600;
          letter-spacing: 0.02em;
        }
        .ceph-dash-widget-title {
          font-size: 11px;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          color: rgba(0, 0, 0, 0.45);
          margin-bottom: 8px;
        }
        .ceph-dash-card-metric {
          border-radius: 8px;
          border: 1px solid #e8eaf0;
          background: linear-gradient(180deg, #fafbff 0%, #fff 100%);
          padding: 16px;
          height: 100%;
        }
      `}</style>

      {err ? (
        <Alert type="error" showIcon message={err} style={{ marginBottom: 16 }} />
      ) : null}

      {hasAny ? (
        <Tabs activeKey={tabKey} onChange={setTabKey} items={tabItems} destroyInactiveTabPane />
      ) : (
        <Card size="small">
          <Space direction="vertical" size="middle" style={{ width: '100%' }}>
            <Typography.Text type="secondary">
              未获取到 Rook Ceph 聚合资源或 Harvester BlockDevice（均为空）。请确认已安装 Rook-Ceph、节点块设备发现正常，且当前账号对
              Steve 相关资源有 list 权限。
            </Typography.Text>
            <Button icon={<ReloadOutlined />} onClick={() => void load()} loading={loading}>
              重试
            </Button>
          </Space>
        </Card>
      )}
    </PageDetailSection>
  );
};

export default CephStorageSection;
