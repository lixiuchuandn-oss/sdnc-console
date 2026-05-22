/**
 * Xinference 资源池 · 仪表板
 * 布局：两行视口网格（上 3 : 下 2），对齐 Cloudmap 监控概览。
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Card, Col, Empty, List, Progress, Row, Spin, Typography } from 'antd';
import {
  ApiOutlined,
  CloudServerOutlined,
  ClusterOutlined,
  DatabaseOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons';
import {
  fetchXinferenceClusterInfo,
  type XinferenceClusterInfo,
  type XinferenceClusterNodeDetail,
  type XinferenceClusterSummary,
} from '../../../../../services/xinferenceApi';
import {
  aggregateClusterMetrics,
  DASHBOARD_CARD_HEADER_STYLE,
  DASHBOARD_CARD_SHADOW,
  fmtGiB,
  fmtMiB,
  fmtNum,
  fmtVersionRelease,
  getRiskColor,
} from '../lib/xinferenceFormat';

type Props = {
  poolId: string;
};

const CARD_GAP = 16;

const OVERVIEW_GRID: React.CSSProperties = {
  display: 'grid',
  gridTemplateRows: 'minmax(0, 3fr) minmax(0, 2fr)',
  gap: CARD_GAP,
  height: 'calc(100vh - 152px)',
  minHeight: 420,
  boxSizing: 'border-box',
  position: 'relative',
};

/** 指标卡 body：内容在卡片内垂直水平居中 */
const METRIC_CARD_BODY: React.CSSProperties = {
  flex: 1,
  minHeight: 0,
  padding: '12px 16px',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
};

const ROW_STRETCH: React.CSSProperties = {
  alignItems: 'stretch',
  height: '100%',
  minHeight: 0,
};

const COL_FILL: React.CSSProperties = {
  display: 'flex',
  minHeight: 0,
  height: '100%',
};

const CARD_FILL: React.CSSProperties = {
  flex: 1,
  minHeight: 0,
  display: 'flex',
  flexDirection: 'column',
  width: '100%',
};

const CARD_BODY_CENTER: React.CSSProperties = {
  flex: 1,
  minHeight: 0,
  display: 'flex',
  flexDirection: 'column',
  justifyContent: 'center',
  padding: '12px 20px',
};

const METRIC_TILE: React.CSSProperties = {
  flex: 1,
  minWidth: 0,
  padding: '12px 14px',
  borderRadius: 8,
  background: '#f8fafc',
  border: '1px solid #eef2f7',
};

const WORKER_NODE_ITEM: React.CSSProperties = {
  padding: '12px 14px',
  marginBottom: 8,
  borderRadius: 8,
  background: '#f8fafc',
};

const RING_SIZE = 108;
const RING_STROKE = 8;

/** 仪表板横向进度条粗细（antd Progress line） */
const PROGRESS_BAR_STROKE = 12;

function dashCardStyle(): React.CSSProperties {
  return {
    ...CARD_FILL,
    boxShadow: DASHBOARD_CARD_SHADOW,
    display: 'flex',
    flexDirection: 'column',
  };
}

function CardTitle({
  icon,
  label,
}: {
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
      {icon}
      <span style={{ fontSize: 16 }}>{label}</span>
    </span>
  );
}

function MetricRing({
  percent,
  label,
  size = RING_SIZE,
}: {
  percent: number;
  label: string;
  size?: number;
}) {
  const riskColor = getRiskColor(percent);
  const radius = (size - RING_STROKE) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (percent / 100) * circumference;
  return (
    <div style={{ position: 'relative', flexShrink: 0, width: size, height: size }}>
      <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="#e5e7eb"
          strokeWidth={RING_STROKE}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={riskColor}
          strokeWidth={RING_STROKE}
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
          style={{ transition: 'stroke-dashoffset 0.3s' }}
        />
      </svg>
      <div
        style={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <span style={{ fontSize: 18, fontWeight: 600, lineHeight: 1 }}>{fmtNum(percent)}%</span>
        <span style={{ fontSize: 12, color: '#94a3b8', marginTop: 2 }}>{label}</span>
      </div>
    </div>
  );
}

function SplitMetricRow({
  label,
  value,
  border = true,
}: {
  label: string;
  value: string;
  border?: boolean;
}) {
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: '7px 0',
        borderBottom: border ? '1px solid #f0f0f0' : undefined,
      }}
    >
      <Typography.Text type="secondary">{label}</Typography.Text>
      <span style={{ fontSize: 14, fontWeight: 500 }}>{value}</span>
    </div>
  );
}

function SupervisorPanel({
  summary,
  versionRelease,
  fields,
}: {
  summary?: XinferenceClusterSummary;
  versionRelease?: string;
  fields: Array<{ label: string; value: string }>;
}) {
  const nodeExtra =
    summary?.count != null
      ? summary.count === 1 && summary.address
        ? summary.address
        : `${summary.count} 个节点`
      : '—';

  return (
    <Card
      size="small"
      title={
        <CardTitle
          icon={<ThunderboltOutlined style={{ color: '#64748b', fontSize: 20 }} />}
          label="主管"
        />
      }
      extra={
        <span style={{ fontSize: 13, color: '#94a3b8' }} title={typeof nodeExtra === 'string' ? nodeExtra : undefined}>
          {nodeExtra}
        </span>
      }
      styles={{
        header: DASHBOARD_CARD_HEADER_STYLE,
        body: {
          flex: 1,
          minHeight: 0,
          padding: '16px 20px',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
        },
      }}
      style={dashCardStyle()}
    >
      <SplitMetricRow label="版本" value={fmtVersionRelease(versionRelease)} />
      {fields.map((f, i) => (
        <SplitMetricRow key={f.label} label={f.label} value={f.value} border={i < fields.length - 1} />
      ))}
    </Card>
  );
}

function WorkerListMetric({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ minWidth: 0 }}>
      <Typography.Text type="secondary" style={{ fontSize: 12, display: 'block' }}>
        {label}
      </Typography.Text>
      <Typography.Text style={{ fontSize: 13 }}>{value}</Typography.Text>
    </div>
  );
}

/** 工作节点：每台一条 List 项 */
function WorkersListPanel({ workers }: { workers: XinferenceClusterNodeDetail[] }) {
  return (
    <Card
      size="small"
      title={
        <CardTitle icon={<ClusterOutlined style={{ color: '#1677ff', fontSize: 20 }} />} label="工作节点" />
      }
      extra={
        <span style={{ fontSize: 13, color: '#94a3b8' }}>
          {workers.length > 0 ? `共 ${workers.length} 台` : '无节点'}
        </span>
      }
      styles={{
        header: DASHBOARD_CARD_HEADER_STYLE,
        body: {
          flex: 1,
          minHeight: 0,
          padding: workers.length > 0 ? '8px 12px 12px' : '24px 16px',
          display: 'flex',
          flexDirection: 'column',
        },
      }}
      style={dashCardStyle()}
    >
      {workers.length === 0 ? (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无工作节点" />
      ) : (
        <List
          dataSource={workers}
          rowKey="key"
          split={false}
          style={{ flex: 1, minHeight: 0, overflow: 'auto' }}
          renderItem={(worker) => {
            const title = worker.address || worker.key;
            const hasGpu = worker.gpuCount > 0;
            return (
              <List.Item style={WORKER_NODE_ITEM}>
                <List.Item.Meta
                  avatar={<ClusterOutlined style={{ color: '#1677ff', fontSize: 20 }} />}
                  title={
                    <Typography.Text strong ellipsis={{ tooltip: title }}>
                      {title}
                    </Typography.Text>
                  }
                  description={
                    <div
                      style={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
                        gap: '10px 16px',
                        marginTop: 8,
                      }}
                    >
                      <WorkerListMetric
                        label="CPU 使用率"
                        value={`${fmtNum(worker.cpuUsagePercent)}% · ${fmtNum(worker.cpuCount, 0)} 核`}
                      />
                      <WorkerListMetric
                        label="内存"
                        value={`${fmtGiB(worker.memUsedBytes)} / ${fmtGiB(worker.memTotalBytes)}`}
                      />
                      <WorkerListMetric
                        label="GPU"
                        value={
                          hasGpu
                            ? `${fmtNum(worker.gpuUtilization)}% · ${worker.gpuCount} 块`
                            : '无 GPU'
                        }
                      />
                      <WorkerListMetric
                        label="显存"
                        value={
                          hasGpu
                            ? `${fmtMiB(worker.gpuVramUsedBytes)} / ${fmtMiB(worker.gpuVramTotalBytes)}`
                            : '—'
                        }
                      />
                    </div>
                  }
                />
              </List.Item>
            );
          }}
        />
      )}
    </Card>
  );
}

const DashboardSection: React.FC<Props> = ({ poolId }) => {
  const [info, setInfo] = useState<XinferenceClusterInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!poolId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setErr(null);
    try {
      setInfo(await fetchXinferenceClusterInfo(poolId, { skipCache: true }));
    } catch (e: unknown) {
      setInfo(null);
      setErr(e instanceof Error ? e.message : '加载仪表板失败');
    } finally {
      setLoading(false);
    }
  }, [poolId]);

  useEffect(() => {
    void load();
  }, [load]);

  const agg = useMemo(
    () => aggregateClusterMetrics(info?.supervisor, info?.workersSummary),
    [info?.supervisor, info?.workersSummary],
  );

  const cpuPercent = agg.cpuUsagePercent ?? 0;
  const memPercent = agg.memUsagePercent ?? 0;
  const gpuPercent = agg.gpuUtilization ?? 0;
  const vramPercent = agg.gpuVramUsagePercent ?? 0;
  const memAvail =
    agg.memTotalBytes != null && agg.memUsedBytes != null
      ? Math.max(0, agg.memTotalBytes - agg.memUsedBytes)
      : null;

  if (!poolId) {
    return <Alert type="warning" message="缺少资源池参数" showIcon />;
  }

  return (
    <>
      {err && <Alert type="error" message={err} showIcon style={{ marginBottom: CARD_GAP }} />}
      {(info?.modelsError || info?.versionError) && (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: CARD_GAP }}
          message="部分数据拉取失败"
          description={[info?.versionError, info?.modelsError].filter(Boolean).join('；')}
        />
      )}

      <Spin spinning={loading}>
        <div style={OVERVIEW_GRID}>
          {/* 上行：集群概览 | CPU+内存 | GPU */}
          <Row gutter={[CARD_GAP, CARD_GAP]} style={ROW_STRETCH}>
            <Col xs={24} lg={8} style={COL_FILL}>
              <Card
                size="small"
                title={
                  <CardTitle
                    icon={<CloudServerOutlined style={{ color: '#1677ff', fontSize: 20 }} />}
                    label="集群概览"
                  />
                }
                styles={{
                  header: DASHBOARD_CARD_HEADER_STYLE,
                  body: CARD_BODY_CENTER,
                }}
                style={dashCardStyle()}
              >
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 28 }}>
                  <Progress
                    type="circle"
                    percent={agg.nodeCount > 0 ? Math.round((agg.workerCount / agg.nodeCount) * 100) : 0}
                    size={140}
                    strokeWidth={8}
                    strokeColor="#1677ff"
                    trailColor="#f0f0f0"
                    format={() => (
                      <div style={{ lineHeight: 1.15, textAlign: 'center' }}>
                        <span style={{ fontSize: 28, fontWeight: 600 }}>{agg.nodeCount}</span>
                        <Typography.Text type="secondary" style={{ display: 'block', fontSize: 12, marginTop: 4 }}>
                          集群节点
                        </Typography.Text>
                      </div>
                    )}
                  />
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(3, 1fr)',
                      gap: 10,
                      width: '100%',
                    }}
                  >
                    {[
                      {
                        label: '主管',
                        value: info?.supervisor?.count ?? 1,
                        color: '#64748b',
                      },
                      {
                        label: 'Worker',
                        value: agg.workerCount,
                        color: '#1677ff',
                      },
                      {
                        label: '模型',
                        value: info?.runningModelCount ?? 0,
                        color: '#22c55e',
                      },
                    ].map((item) => (
                      <div key={item.label} style={{ ...METRIC_TILE, textAlign: 'center' }}>
                        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                          {item.label}
                        </Typography.Text>
                        <div style={{ fontSize: 22, fontWeight: 600, color: item.color, marginTop: 4 }}>
                          {item.value}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </Card>
            </Col>

            <Col xs={24} lg={8} style={COL_FILL}>
              <div style={{ ...CARD_FILL, gap: CARD_GAP }}>
                <Card
                  size="small"
                  title={
                    <CardTitle
                      icon={<ThunderboltOutlined style={{ color: '#1677ff', fontSize: 20 }} />}
                      label="CPU"
                    />
                  }
                  extra={
                    <span style={{ fontSize: 13, color: '#94a3b8' }}>
                      共 {fmtNum(agg.cpuCount, 0)} 核
                    </span>
                  }
                  styles={{
                    header: DASHBOARD_CARD_HEADER_STYLE,
                    body: METRIC_CARD_BODY,
                  }}
                  style={{
                    flex: 1,
                    minHeight: 0,
                    boxShadow: DASHBOARD_CARD_SHADOW,
                    display: 'flex',
                    flexDirection: 'column',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 14, width: '100%' }}>
                    <MetricRing percent={cpuPercent} label="使用率" size={92} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <SplitMetricRow
                        label="主管"
                        value={`${fmtNum(info?.supervisor?.cpuUsagePercent)}%`}
                      />
                      <SplitMetricRow
                        label="工作节点"
                        value={`${fmtNum(info?.workersSummary?.cpuUsagePercent)}%`}
                        border={false}
                      />
                    </div>
                  </div>
                </Card>

                <Card
                  size="small"
                  title={
                    <CardTitle
                      icon={<DatabaseOutlined style={{ color: '#1677ff', fontSize: 20 }} />}
                      label="内存"
                    />
                  }
                  extra={<span style={{ fontSize: 13, color: '#94a3b8' }}>共 {fmtGiB(agg.memTotalBytes)}</span>}
                  styles={{
                    header: DASHBOARD_CARD_HEADER_STYLE,
                    body: METRIC_CARD_BODY,
                  }}
                  style={{
                    flex: 1,
                    minHeight: 0,
                    boxShadow: DASHBOARD_CARD_SHADOW,
                    display: 'flex',
                    flexDirection: 'column',
                  }}
                >
                  <div style={{ width: '100%' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 }}>
                      <Typography.Text strong style={{ fontSize: 18 }}>
                        {fmtNum(memPercent)}%
                      </Typography.Text>
                      <Typography.Text type="secondary" style={{ fontSize: 13 }}>
                        已用 {fmtGiB(agg.memUsedBytes)} / {fmtGiB(agg.memTotalBytes)}
                      </Typography.Text>
                    </div>
                    <Progress
                      percent={Math.min(100, Math.round(memPercent * 10) / 10)}
                      strokeColor={getRiskColor(memPercent)}
                      showInfo={false}
                      strokeWidth={PROGRESS_BAR_STROKE}
                    />
                    <Typography.Text type="secondary" style={{ fontSize: 13, display: 'block', marginTop: 8 }}>
                      可用 {fmtGiB(memAvail)}
                    </Typography.Text>
                  </div>
                </Card>
              </div>
            </Col>

            <Col xs={24} lg={8} style={COL_FILL}>
              <Card
                size="small"
                title={
                  <CardTitle icon={<ApiOutlined style={{ color: '#1677ff', fontSize: 20 }} />} label="GPU" />
                }
                extra={<span style={{ fontSize: 13, color: '#94a3b8' }}>共 {agg.gpuCount} 块</span>}
                styles={{
                  header: DASHBOARD_CARD_HEADER_STYLE,
                  body: METRIC_CARD_BODY,
                }}
                style={dashCardStyle()}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 14, width: '100%' }}>
                  <MetricRing percent={gpuPercent} label="GPU 负载" size={92} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <SplitMetricRow label="显存已用" value={fmtMiB(agg.gpuVramUsedBytes)} />
                    <SplitMetricRow label="显存总量" value={fmtMiB(agg.gpuVramTotalBytes)} />
                    <SplitMetricRow label="显存使用率" value={`${fmtNum(vramPercent)}%`} border={false} />
                  </div>
                </div>
              </Card>
            </Col>
          </Row>

          {/* 下行：主管 / 工作节点分项 */}
          <Row gutter={[CARD_GAP, CARD_GAP]} style={ROW_STRETCH}>
            <Col xs={24} lg={12} style={COL_FILL}>
              <SupervisorPanel
                summary={info?.supervisor}
                versionRelease={info?.supervisor?.versionRelease}
                fields={[
                  { label: 'CPU 使用率', value: `${fmtNum(info?.supervisor?.cpuUsagePercent)}%` },
                  { label: 'CPU 总数', value: fmtNum(info?.supervisor?.cpuCount, 0) },
                  { label: '内存已用', value: fmtGiB(info?.supervisor?.memUsedBytes) },
                  { label: '内存总量', value: fmtGiB(info?.supervisor?.memTotalBytes) },
                ]}
              />
            </Col>
            <Col xs={24} lg={12} style={COL_FILL}>
              <WorkersListPanel workers={info?.workerDetails ?? []} />
            </Col>
          </Row>
        </div>
      </Spin>
    </>
  );
};

export default DashboardSection;
