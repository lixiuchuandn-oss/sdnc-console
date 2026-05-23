import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { DatabaseOutlined, LinkOutlined, PlusOutlined, QuestionCircleOutlined, ReloadOutlined, SearchOutlined } from '@ant-design/icons';
import { Button, Card, Col, Descriptions, Divider, Input, Pagination, Row, Space, Statistic, Table, Tag, Tooltip, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import PageDetailSection from '../../../../../components/PageDetailSection';
import {
  fetchMonitoringAccessManagement,
  type MonitoringAccessPrometheusInstance,
  type MonitoringAccessTarget,
} from '../../../../../services/monitoringApi';
import { useAuth } from '../../../../../contexts/AuthContext';
import { hasPermissionForAction } from '../../../../../utils/accessMapping';

interface MonitoringAccessManagementProps {
  cloudId: string;
}

type MonitorTargetRow = {
  key: string;
  alias: string;
  monitorCategory: '集群核心组件' | '监控告警组件' | '存储系统' | '集群节点';
  monitorStatus: 'UP' | 'DOWN';
  name: string;
  namespace: string;
  endpointsCount: number;
  selectorText: string;
  createdAt: string;
};

const DEFAULT_MONITORING_NAMESPACE = 'cattle-monitoring-system';
const statCol = { xs: 24, sm: 12, md: 8 };

function formatTime(v: unknown): string {
  const raw = String(v ?? '').trim();
  if (!raw) return '-';
  return raw.replace('T', ' ').replace(/\.\d{3}Z?$/, '');
}

function selectorToText(sel: unknown): string {
  if (!sel || typeof sel !== 'object') return '';
  const ml = (sel as { matchLabels?: Record<string, string> }).matchLabels;
  if (ml && typeof ml === 'object') {
    return Object.entries(ml).map(([k, v]) => `${k}=${v}`).join(',');
  }
  return '';
}

function resolveTargetMeta(labels: Record<string, string> | undefined): {
  alias: string;
  monitorCategory: '集群核心组件' | '监控告警组件' | '存储系统' | '集群节点';
} {
  const map = labels || {};
  const app = String(map.app || '').trim().toLowerCase();   
  const appName = String(map['app.kubernetes.io/name'] || '').trim().toLowerCase();
  const component = String(map.component || '').trim().toLowerCase();
  const kubevirt = String(map['prometheus.kubevirt.io'] || '').trim().toLowerCase();
  const k8sApp = String(map.k8s_app || map['k8s-app'] || '').trim().toLowerCase();

  if (kubevirt === 'true') return { alias: '虚拟机', monitorCategory: '集群节点' };
  if (appName === 'prometheus-smartctl-exporter') return {  alias: '主机物理磁盘', monitorCategory: '存储系统' };
  if (app === 'rancher-monitoring-alertmanager') return { alias: '告警组件', monitorCategory: '监控告警组件' };
  if (app === 'rancher-monitoring-coredns') return { alias: 'coredns', monitorCategory: '集群核心组件' };
  if (appName === 'grafana') return { alias: 'grafana', monitorCategory: '监控告警组件' };
  if (component === 'kube-etcd') return { alias: 'etcd', monitorCategory: '集群核心组件' };
  if (appName === 'kubelet') return { alias: 'kubelet', monitorCategory: '集群节点' };
  if (app === 'rancher-monitoring-prometheus') return { alias: 'prometheus', monitorCategory: '监控告警组件' };
  if (app === 'longhorn-manager') return { alias: 'longhorn-manager', monitorCategory: '存储系统' };
  if (appName === 'prometheus-node-exporter') return { alias: 'node-exporter', monitorCategory: '集群节点' };
  if (component === 'apiserver') return { alias: 'kube-apiserver', monitorCategory: '集群核心组件' };
  if (
    component === 'kube-scheduler' ||
    appName === 'kube-scheduler' ||
    k8sApp === 'kube-scheduler'
  ) {
    return { alias: 'kube-scheduler', monitorCategory: '集群核心组件' };
  }
  if (
    component === 'kube-controller-manager' ||
    appName === 'kube-controller-manager' ||
    k8sApp === 'kube-controller-manager'
  ) {
    return { alias: 'controller-manager', monitorCategory: '集群核心组件' };
  }
  return { alias: '', monitorCategory: '集群核心组件' };
}

function mapHealthStatus(
  status: MonitoringAccessPrometheusInstance['healthStatus']
): { text: string; color: string } {
  if (status === 'healthy') return { text: '健康', color: 'success' };
  if (status === 'degraded') return { text: '降级', color: 'warning' };
  if (status === 'unhealthy') return { text: '异常', color: 'error' };
  return { text: '未知', color: 'default' };
}

function resolveMonitorStatus(endpointsCount: number | undefined): 'UP' | 'DOWN' {
  return Number(endpointsCount ?? 0) > 0 ? 'UP' : 'DOWN';
}

const MonitoringAccessManagement: React.FC<MonitoringAccessManagementProps> = ({ cloudId }) => {
  const { user } = useAuth();
  const perms = useMemo(() => (user?.permissions ?? []) as string[], [user?.permissions]);
  const canRead = useMemo(() => hasPermissionForAction(perms, 'clouds.alerts:read'), [perms]);

  const [loading, setLoading] = useState(false);
  const [keyword, setKeyword] = useState('');
  const [tableScrollY, setTableScrollY] = useState(320);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [prometheusInstances, setPrometheusInstances] = useState<MonitoringAccessPrometheusInstance[]>([]);
  const [targetRows, setTargetRows] = useState<MonitorTargetRow[]>([]);

  const loadData = useCallback(async () => {
    if (!cloudId || !canRead) return;
    setLoading(true);
    try {
      const { data, ok } = await fetchMonitoringAccessManagement(cloudId);
      if (!ok || !data) {
        return;
      }
      setPrometheusInstances(data.prometheusInstances || []);
      const monitorRows = (data.monitorTargets || []).map((item: MonitoringAccessTarget) => {
        const name = String(item.name ?? '-');
        const meta = resolveTargetMeta(item.labels);
        const endpointsCount = Number(item.endpointsCount ?? 0);
        return {
          ...meta,
          alias: meta.alias && meta.alias.trim() ? meta.alias : name,
          key: `${item.type}/${item.namespace ?? ''}/${item.name ?? ''}`,
          monitorStatus: resolveMonitorStatus(endpointsCount),
          type: item.type,
          name,
          namespace: String(item.namespace ?? '-'),
          endpointsCount,
          selectorText: selectorToText(item.selector),
          createdAt: formatTime(item.createdAt),
        };
      });
      setTargetRows(monitorRows);
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
    };
    updateTableHeight();
    window.addEventListener('resize', updateTableHeight);
    return () => window.removeEventListener('resize', updateTableHeight);
  }, []);

  const defaultPrometheus = useMemo(() => {
    return (
      prometheusInstances.find((r) => r.namespace === DEFAULT_MONITORING_NAMESPACE) ??
      prometheusInstances[0] ??
      null
    );
  }, [prometheusInstances]);

  const filteredTargetRows = useMemo(() => {
    const k = keyword.trim().toLowerCase();
    if (!k) return targetRows;
    return targetRows.filter((r) =>
      [r.alias, r.monitorCategory, r.monitorStatus, r.name, r.namespace, r.selectorText].some((v) =>
        String(v).toLowerCase().includes(k)
      )
    );
  }, [keyword, targetRows]);
  const pagedTargetRows = useMemo(() => {
    const start = (page - 1) * pageSize;
    return filteredTargetRows.slice(start, start + pageSize);
  }, [filteredTargetRows, page, pageSize]);

  useEffect(() => {
    setPage(1);
  }, [keyword, targetRows.length]);

  const targetColumns: ColumnsType<MonitorTargetRow> = [
    {
      title: (
        <Space size={6}>
          <span>监控对象</span>
          <Tooltip
            title={
              <>
                <div>监控对象 = 监控指标提供者（即被采集监控数据的对象）。</div>
                <div>例如：kube-apiserver、etcd、node-exporter、longhorn-manager、虚拟机等。</div>
              </>
            }
          >
            <QuestionCircleOutlined style={{ color: 'rgba(0,0,0,.45)' }} />
          </Tooltip>
        </Space>
      ),
      dataIndex: 'alias',
      key: 'alias',
      fixed: 'left',
    },
    { title: '监控类别', dataIndex: 'monitorCategory', key: 'monitorCategory' },
    {
      title: '状态',
      dataIndex: 'monitorStatus',
      key: 'monitorStatus',
      render: (v: 'UP' | 'DOWN') => <Tag color={v === 'UP' ? 'success' : 'error'}>{v}</Tag>,
    },
    { title: '创建时间', dataIndex: 'createdAt', key: 'createdAt' },
  ];

  if (!canRead) {
    return (
      <PageDetailSection asCard={false}>
        <Typography.Text type="secondary">无权查看接入管理，请联系管理员分配 `clouds.alerts:read` 权限。</Typography.Text>
      </PageDetailSection>
    );
  }

  const renderPrometheusDetail = () => {
    const health = mapHealthStatus(defaultPrometheus?.healthStatus);
    const healthTooltip = [
      `判定依据：${defaultPrometheus?.healthReason || '暂无'}`,
      `副本（可用/期望）：${defaultPrometheus ? `${defaultPrometheus.availableReplicas ?? 0} / ${defaultPrometheus.replicas ?? 1}` : '-'}`,
      '说明：当前按 Prometheus 副本状态进行简化判定',
    ].join(' | ');
    return (
      <Card
        size="small"
        style={{ marginBottom: 16 }}
        styles={{ body: { padding: 0 } }}
        title={
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            <DatabaseOutlined />
            集群监控组件概览
          </span>
        }
      >
        <div style={{ padding: 16 }}>
          <Row gutter={[16, 20]}>
            <Col {...statCol}>
              <Statistic title="默认接入监控组件" value="Prometheus" />
            </Col>
            <Col {...statCol}>
              <Typography.Text type="secondary" style={{ fontSize: 14, display: 'block' }}>
                组件状态
              </Typography.Text>
              <div style={{ marginTop: 8 }}>
                <Tooltip title={healthTooltip}>
                  <Tag color={health.color}>{health.text}</Tag>
                </Tooltip>
              </div>
            </Col>
            <Col {...statCol}>
              <Statistic title="数据保留时长" value={defaultPrometheus?.retention || '-'} />
            </Col>
          </Row>

          <Divider style={{ margin: '16px 0 12px' }} />

          <Descriptions column={2} bordered size="small" labelStyle={{ width: 180 }}>
            <Descriptions.Item label="实例所属项目">
              {defaultPrometheus?.namespace || DEFAULT_MONITORING_NAMESPACE}
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
          </Descriptions>
        </div>
      </Card>
    );
  };

  return (
    <>
      {renderPrometheusDetail()}

      <div style={{ marginTop: 12 }}>
        <PageDetailSection
          asCard={false}
          toolbarLeft={
            <Space>
              <Input
                allowClear
                placeholder="监控类别 / 监控对象 / 状态 / 原始名称 / 标签"
                suffix={<SearchOutlined style={{ color: 'rgba(0,0,0,.45)' }} />}
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
                className="toolbar-search"
              />
            </Space>
          }
          toolbarRight={
            <Space>
              <Button type="primary" icon={<PlusOutlined />} disabled>
                添加监控对象
              </Button>
              <Button icon={<ReloadOutlined />} onClick={() => void loadData()} loading={loading} />
            </Space>
          }
        >
          <div style={{ position: 'relative' }}>
            <Table
              className="std-table"
              bordered={false}
              rowKey="key"
              loading={loading}
              columns={targetColumns}
              dataSource={pagedTargetRows}
              scroll={{ x: true, y: tableScrollY }}
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
                total={Math.max(filteredTargetRows.length, 1)}
                showSizeChanger
                hideOnSinglePage={false}
                pageSizeOptions={['20', '50', '100']}
                showTotal={() => `共 ${filteredTargetRows.length} 条`}
                onChange={(nextPage, nextPageSize) => {
                  setPage(nextPage);
                  setPageSize(nextPageSize);
                }}
              />
            </div>
          </div>
        </PageDetailSection>
      </div>
    </>
  );
};

export default MonitoringAccessManagement;
