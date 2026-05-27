import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { LineChartOutlined, QuestionCircleOutlined, SearchOutlined } from '@ant-design/icons';
import {
  Card,
  Col,
  Descriptions,
  Divider,
  Input,
  Modal,
  Pagination,
  Row,
  Space,
  Statistic,
  Table,
  Tag,
  Tooltip,
  Typography,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import PageDetailSection from '../../../../../components/PageDetailSection';
import {
  fetchMonitoringAccessManagement,
  fetchMonitoringPrometheusTargets,
  type MonitoringAccessPrometheusInstance,
  type MonitoringPrometheusMonitorTask,
  type MonitoringPrometheusTarget,
  type MonitoringPrometheusTaskEndpoint,
} from '../../../../../services/monitoringApi';
import { useAuth } from '../../../../../contexts/AuthContext';
import { hasPermissionForAction } from '../../../../../utils/accessMapping';
import { MONITORING_DEFAULT_NAMESPACE } from './context/MonitoringContext';

interface MonitoringAccessManagementProps {
  cloudId: string;
}

type MonitorTaskRow = MonitoringPrometheusMonitorTask & { rowKey: string };

const statCol = { xs: 24, sm: 12, md: 8 };
const ENDPOINT_MODAL_MAX_HEIGHT_VH = 75;

function formatTime(v: unknown): string {
  const raw = String(v ?? '').trim();
  if (!raw) return '-';
  return raw.replace('T', ' ').replace(/\.\d{3}Z?$/, '');
}

const RETENTION_UNIT_CN: Record<string, string> = {
  y: '年',
  w: '周',
  d: '天',
  h: '小时',
  m: '分钟',
  s: '秒',
  ms: '毫秒',
};

function formatRetentionCn(v: unknown): string {
  const raw = String(v ?? '').trim();
  if (!raw) return '-';
  const matches = raw.match(/\d+(?:ms|[ywdhms])/gi);
  if (!matches || matches.length === 0) return raw;
  return matches
    .map((seg) => {
      const m = seg.match(/^(\d+)(ms|[ywdhms])$/i);
      if (!m) return seg;
      const num = m[1];
      const unit = m[2].toLowerCase();
      return `${num}${RETENTION_UNIT_CN[unit] ?? unit}`;
    })
    .join('');
}

function mapHealthStatus(
  status: MonitoringAccessPrometheusInstance['healthStatus']
): { text: string; color: string } {
  if (status === 'healthy') return { text: '健康', color: 'success' };
  if (status === 'degraded') return { text: '降级', color: 'warning' };
  if (status === 'unhealthy') return { text: '异常', color: 'error' };
  return { text: '未知', color: 'default' };
}

function formatVolumeModeCn(mode?: string): string {
  const raw = String(mode ?? '').trim();
  if (!raw) return '-';
  const key = raw.toLowerCase();
  if (key === 'filesystem') return '文件系统';
  if (key === 'block') return '块设备';
  return raw;
}

const MonitoringAccessManagement: React.FC<MonitoringAccessManagementProps> = ({ cloudId }) => {
  const { user } = useAuth();
  const perms = useMemo(() => (user?.permissions ?? []) as string[], [user?.permissions]);
  const canRead = useMemo(() => hasPermissionForAction(perms, 'clouds.alerts:read'), [perms]);

  const [loading, setLoading] = useState(false);
  const [keyword, setKeyword] = useState('');
  const [tableScrollY, setTableScrollY] = useState(320);
  const [endpointTableScrollY, setEndpointTableScrollY] = useState(360);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [prometheusInstances, setPrometheusInstances] = useState<MonitoringAccessPrometheusInstance[]>([]);
  const [taskRows, setTaskRows] = useState<MonitorTaskRow[]>([]);
  const [endpointModal, setEndpointModal] = useState<{
    visible: boolean;
    task?: MonitorTaskRow;
    endpoint?: MonitoringPrometheusTaskEndpoint;
  }>({ visible: false });

  const loadData = useCallback(async () => {
    if (!cloudId || !canRead) return;
    setLoading(true);
    try {
      const [{ data: accessData, ok: accessOk }, { data: targetData, ok: targetOk }] = await Promise.all([
        fetchMonitoringAccessManagement(cloudId),
        fetchMonitoringPrometheusTargets(cloudId, { search: '' }),
      ]);
      if (accessOk && accessData) {
        setPrometheusInstances(accessData.prometheusInstances || []);
      }
      const tasks = (targetOk && targetData?.monitorTasks) || [];
      const rows: MonitorTaskRow[] = tasks.map((t) => ({
        ...t,
        rowKey: `${t.namespace}/${t.job || '__unknown__'}`,
      }));
      setTaskRows(rows);
    } finally {
      setLoading(false);
    }
  }, [canRead, cloudId]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  useEffect(() => {
    const updateTableHeight = () => {
      setTableScrollY(Math.max(260, window.innerHeight - 560));
      const modalBodyHeight = Math.floor(window.innerHeight * (ENDPOINT_MODAL_MAX_HEIGHT_VH / 100));
      setEndpointTableScrollY(Math.max(220, Math.min(640, modalBodyHeight - 230)));
    };
    updateTableHeight();
    window.addEventListener('resize', updateTableHeight);
    return () => window.removeEventListener('resize', updateTableHeight);
  }, []);

  const defaultPrometheus = useMemo(() => {
    return (
      prometheusInstances.find((r) => r.namespace === MONITORING_DEFAULT_NAMESPACE) ??
      prometheusInstances[0] ??
      null
    );
  }, [prometheusInstances]);

  const filteredTaskRows = useMemo(() => {
    const k = keyword.trim().toLowerCase();
    if (!k) return taskRows;
    return taskRows.filter((r) => {
      const hay = [
        r.namespace,
        r.job,
        r.service,
        r.scrapePool,
        r.endpoints.map((e) => e.endpoint).join(' '),
        r.endpoints
          .flatMap((e) => e.targets.flatMap((t) => [t.pod, t.container, t.instance]))
          .join(' '),
      ]
        .join(' ')
        .toLowerCase();
      return hay.includes(k);
    });
  }, [keyword, taskRows]);

  const pagedTaskRows = useMemo(() => {
    const start = (page - 1) * pageSize;
    return filteredTaskRows.slice(start, start + pageSize);
  }, [filteredTaskRows, page, pageSize]);

  useEffect(() => {
    setPage(1);
  }, [keyword, taskRows.length]);

  const monitorServiceTip = (
    <Typography style={{ maxWidth: 320 }}>
      <Typography.Paragraph style={{ marginBottom: 12 }}>
        <Typography.Text strong>监控服务</Typography.Text>
        <br />
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          按 Prometheus 抓取任务（labels.job）聚合，每个监控服务通常对应一个 ServiceMonitor / PodMonitor。
        </Typography.Text>
      </Typography.Paragraph>
      <Typography.Paragraph style={{ marginBottom: 0 }}>
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          一个监控服务下按 endpoint（端口/路径）分组，每个 endpoint 下包含若干实例 Target（Pod 副本）。
        </Typography.Text>
      </Typography.Paragraph>
    </Typography>
  );

  const renderEndpointTag = (
    task: MonitorTaskRow,
    ep: MonitoringPrometheusTaskEndpoint
  ) => {
    const color = ep.downCount > 0 ? (ep.upCount > 0 ? 'warning' : 'error') : 'success';
    return (
      <Tag
        key={ep.endpoint || '__unknown__'}
        color={color}
        style={{ cursor: 'pointer', userSelect: 'none' }}
        onClick={() => setEndpointModal({ visible: true, task, endpoint: ep })}
      >
        {ep.endpoint || '(unnamed)'}
        <Typography.Text type="secondary" style={{ marginLeft: 4, fontSize: 11 }}>
          {ep.upCount}/{ep.total}
        </Typography.Text>
      </Tag>
    );
  };

  const taskColumns: ColumnsType<MonitorTaskRow> = [
    {
      title: (
        <Space size={6}>
          <span>监控任务</span>
          <Tooltip
            title={monitorServiceTip}
            placement="topLeft"
            styles={{
              body: {
                background: '#fff',
                color: 'rgba(0,0,0,.88)',
                boxShadow:
                  '0 6px 16px 0 rgba(0,0,0,.08), 0 3px 6px -4px rgba(0,0,0,.12), 0 9px 28px 8px rgba(0,0,0,.05)',
              },
            }}
          >
            <QuestionCircleOutlined style={{ color: 'rgba(0,0,0,.45)', cursor: 'help', fontSize: 12 }} />
          </Tooltip>
        </Space>
      ),
      dataIndex: 'job',
      key: 'job',
      fixed: 'left',
      width: 220,
      render: (v: string, r) => (
        <Tooltip title={r.scrapePool || ''} placement="topLeft">
          <Typography.Text strong>{v || '(unknown)'}</Typography.Text>
        </Tooltip>
      ),
    },
    { title: '项目', dataIndex: 'namespace', key: 'namespace', width: 180 },
    {
      title: '监控目标服务',
      dataIndex: 'service',
      key: 'service',
      width: 240,
      render: (v: string) => v || <Typography.Text type="secondary">-</Typography.Text>,
    },
    {
      title: '监控目标端点',
      key: 'endpoints',
      width: 280,
      render: (_: unknown, r) => (
        <Space size={6} wrap>
          {r.endpoints.length > 0
            ? r.endpoints.map((ep) => renderEndpointTag(r, ep))
            : <Typography.Text type="secondary">-</Typography.Text>}
        </Space>
      ),
    },
    {
      title: '监控目标实例总数',
      dataIndex: 'total',
      key: 'total',
      width: 150,
      render: (v: number) => v ?? 0,
    },
    {
      title: '监控目标运行状态',
      key: 'health',
      width: 200,
      render: (_: unknown, r) => {
        if (r.total === 0) return <Tag>无 Target</Tag>;
        if (r.downCount === 0) return <Tag color="success">全部 UP（{r.upCount}）</Tag>;
        if (r.upCount === 0) return <Tag color="error">全部 DOWN（{r.downCount}）</Tag>;
        return (
          <Space size={4}>
            <Tag color="success">UP {r.upCount}</Tag>
            <Tag color="error">DOWN {r.downCount}</Tag>
          </Space>
        );
      },
    },
  ];

  const targetModalColumns: ColumnsType<MonitoringPrometheusTarget> = [
    {
      title: 'Pod',
      dataIndex: 'pod',
      key: 'pod',
      fixed: 'left',
      render: (v: string) => v || <Typography.Text type="secondary">-</Typography.Text>,
    },
    { title: '容器', dataIndex: 'container', key: 'container', render: (v: string) => v || '-' },
    { title: '实例 (instance)', dataIndex: 'instance', key: 'instance', render: (v: string) => v || '-' },
    {
      title: '健康',
      dataIndex: 'health',
      key: 'health',
      width: 100,
      render: (v: string) => {
        const norm = String(v || '').toLowerCase();
        if (norm === 'up') return <Tag color="success">UP</Tag>;
        if (norm === 'down') return <Tag color="error">DOWN</Tag>;
        return <Tag>{(v || 'unknown').toUpperCase()}</Tag>;
      },
    },
    {
      title: '采集地址',
      dataIndex: 'scrapeUrl',
      key: 'scrapeUrl',
      render: (v: string) => (
        <Typography.Text ellipsis={{ tooltip: v || '-' }} style={{ maxWidth: 360, display: 'inline-block' }}>
          {v || '-'}
        </Typography.Text>
      ),
    },
    {
      title: '最近采集时间',
      dataIndex: 'lastScrape',
      key: 'lastScrape',
      render: (v: string) => formatTime(v),
    },
    {
      title: '采集耗时(s)',
      dataIndex: 'lastScrapeDuration',
      key: 'lastScrapeDuration',
      width: 110,
      render: (v: number) => (Number.isFinite(v) ? v.toFixed(3) : '-'),
    },
    {
      title: '错误信息',
      dataIndex: 'lastError',
      key: 'lastError',
      render: (v: string) => (
        <Typography.Text
          type={v ? 'danger' : undefined}
          ellipsis={{ tooltip: v || '-' }}
          style={{ maxWidth: 320, display: 'inline-block' }}
        >
          {v || '-'}
        </Typography.Text>
      ),
    },
  ];

  if (!canRead) {
    return (
      <PageDetailSection asCard={false}>
        <Typography.Text type="secondary">
          无权查看接入管理，请联系管理员分配 `clouds.alerts:read` 权限。
        </Typography.Text>
      </PageDetailSection>
    );
  }

  const renderPrometheusDetail = () => {
    const health = mapHealthStatus(defaultPrometheus?.healthStatus);
    return (
      <Card
        size="small"
        style={{ marginBottom: 16 }}
        styles={{ body: { padding: 0 } }}
        title={
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            <LineChartOutlined />
            集群监控组件概览
          </span>
        }
      >
        <div style={{ padding: 16 }}>
          <Row gutter={[16, 20]}>
            <Col {...statCol}>
              <Typography.Text type="secondary" style={{ fontSize: 14, display: 'block' }}>
                默认接入监控组件
              </Typography.Text>
              <div style={{ marginTop: 8 }}>
                <Typography.Text style={{ fontSize: 30, lineHeight: '38px', fontWeight: 500 }}>
                  Prometheus
                </Typography.Text>
              </div>
            </Col>
            <Col {...statCol}>
              <Typography.Text type="secondary" style={{ fontSize: 14, display: 'block' }}>
                组件状态
              </Typography.Text>
              <div style={{ marginTop: 8 }}>
                <Tag color={health.color}>{health.text}</Tag>
              </div>
            </Col>
            <Col {...statCol}>
              <Statistic title="热存储时长" value={formatRetentionCn(defaultPrometheus?.retention)} />
            </Col>
          </Row>

          <Divider style={{ margin: '16px 0 12px' }} />

          <Descriptions column={2} bordered size="small" labelStyle={{ width: 180 }}>
            <Descriptions.Item label="所属项目">
              <Tag color="blue">{defaultPrometheus?.namespace || MONITORING_DEFAULT_NAMESPACE}</Tag>
            </Descriptions.Item>
            <Descriptions.Item label="数据保留容量">{defaultPrometheus?.retentionSize || '-'}</Descriptions.Item>
            <Descriptions.Item label="采集间隔 / 评估间隔">
              {`${defaultPrometheus?.scrapeInterval || '-'} / ${defaultPrometheus?.evaluationInterval || '-'}`}
            </Descriptions.Item>
            <Descriptions.Item label="规格配置">
              {`CPU ${defaultPrometheus?.cpuRequest || '-'} / ${defaultPrometheus?.cpuLimit || '-'}，内存 ${
                defaultPrometheus?.memoryRequest || '-'
              } / ${defaultPrometheus?.memoryLimit || '-'}`}
            </Descriptions.Item>
            <Descriptions.Item label="存储配置" span={2}>
              {`存储类：${defaultPrometheus?.storageClassName || '-'}，存储容量：${
                defaultPrometheus?.storageRequest || '-'
              }，访问模式：${
                defaultPrometheus?.storageAccessModes?.filter(Boolean).join(', ') || '-'
              }，卷模式：${formatVolumeModeCn(defaultPrometheus?.storageVolumeMode)}`}
            </Descriptions.Item>
          </Descriptions>
        </div>
      </Card>
    );
  };
  /** 监控目标 (Targets) 详情弹窗 */
  const renderEndpointModal = () => {
    const { task, endpoint } = endpointModal;
    return (
      <Modal
        title={
          task && endpoint ? (
            <Space size={8}>
              <span>监控目标 (Targets)</span>
              <Tag color="blue">{task.job || '(unknown)'}</Tag>
              <Typography.Text type="secondary">·</Typography.Text>
              <span>监控目标端点 =</span>
              <Tag>{endpoint.endpoint || '(unnamed)'}</Tag>
            </Space>
          ) : (
            '监控目标 (Targets)'
          )
        }
        open={endpointModal.visible}
        onCancel={() => setEndpointModal({ visible: false })}
        footer={null}
        width="92vw"
        styles={{
          body: {
            height: `${ENDPOINT_MODAL_MAX_HEIGHT_VH}vh`,
            overflow: 'hidden',
            display: 'flex',
            flexDirection: 'column',
          },
        }}
        destroyOnHidden
      >
        {task && endpoint ? (
          <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0, height: '100%' }}>
            <Descriptions
              column={2}
              size="small"
              labelStyle={{ width: 120 }}
              style={{ marginBottom: 16 }}
            >
              <Descriptions.Item label="监控任务">{task.job || '-'}</Descriptions.Item>
              <Descriptions.Item label="项目">{task.namespace || '-'}</Descriptions.Item>
              <Descriptions.Item label="采集池" span={2}>
                <Typography.Text code style={{ fontSize: 12 }}>
                  {task.scrapePool || '-'}
                </Typography.Text>
              </Descriptions.Item>
              <Descriptions.Item label="实例总数">{endpoint.total}</Descriptions.Item>
              <Descriptions.Item label="UP / DOWN">
                <Space size={4}>
                  <Tag color="success">UP {endpoint.upCount}</Tag>
                  <Tag color="error">DOWN {endpoint.downCount}</Tag>
                </Space>
              </Descriptions.Item>
            </Descriptions>
            <div style={{ flex: 1, minHeight: 0 }}>
              <Table
                className="std-table"
                size="small"
                bordered={false}
                rowKey={(r) => `${r.pod}/${r.instance || r.scrapeUrl}`}
                columns={targetModalColumns}
                dataSource={endpoint.targets}
                pagination={
                  endpoint.targets.length > 10 ? { pageSize: 10, showSizeChanger: false } : false
                }
                scroll={{ x: 'max-content', y: endpointTableScrollY }}
              />
            </div>
          </div>
        ) : null}
      </Modal>
    );
  };

  return (
    <>
      {renderPrometheusDetail()}

      <div style={{ marginTop: 12 }}>
        <PageDetailSection asCard={false}>
          <div style={{ marginBottom: 12 }}>
            <Input
              allowClear
              prefix={<SearchOutlined />}
              placeholder="按任务 / 项目 / 监控目标服务"
              style={{ maxWidth: 360 }}
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
            />
          </div>
          <div style={{ position: 'relative' }}>
            <Table
              className="std-table"
              bordered={false}
              rowKey="rowKey"
              loading={loading}
              columns={taskColumns}
              dataSource={pagedTaskRows}
              scroll={{ x: 'max-content', y: tableScrollY }}
              pagination={false}
            />
            <div
              style={{
                position: 'sticky',
                bottom: 0,
                zIndex: 3,
                marginTop: 8,
                padding: '8px 0 0',
                display: 'flex',
                justifyContent: 'flex-end',
                background: '#fff',
                borderTop: '1px solid #f0f0f0',
              }}
            >
              <Pagination
                current={page}
                pageSize={pageSize}
                total={Math.max(filteredTaskRows.length, 1)}
                showSizeChanger
                hideOnSinglePage={false}
                pageSizeOptions={['20', '50', '100']}
                showTotal={() => `共 ${filteredTaskRows.length} 条`}
                onChange={(nextPage, nextPageSize) => {
                  setPage(nextPage);
                  setPageSize(nextPageSize);
                }}
              />
            </div>
          </div>
        </PageDetailSection>
      </div>
      {renderEndpointModal()}
    </>
  );
};

export default MonitoringAccessManagement;
