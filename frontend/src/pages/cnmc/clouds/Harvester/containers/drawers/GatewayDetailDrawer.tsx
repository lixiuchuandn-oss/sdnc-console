/**
 * ==============================================================================
 * 模块名称: Gateway 详情抽屉 (GatewayDetailDrawer)
 * 文件路径: frontend/src/pages/cnmc/clouds/Harvester/containers/drawers/GatewayDetailDrawer.tsx
 * ==============================================================================
 * 
 * [功能描述]
 * 展示 Gateway 资源的详细信息，包括：
 * - 概览：基本信息、Conditions 状态、Listeners 配置、Addresses
 * - 事件：Kubernetes 事件列表
 * - 关联路由：关联的 HTTPRoute 和 GRPCRoute
 */

import React, { useEffect, useState, useMemo } from 'react';
import {
  Drawer,
  Descriptions,
  Tabs,
  Tag,
  Space,
  Table,
  Card,
  Empty,
  Spin,
  Typography,
  Tooltip,
} from 'antd';
import {
  CheckCircleOutlined,
  CloseCircleOutlined,
  MinusCircleOutlined,
  QuestionCircleOutlined,
  InfoCircleOutlined,
} from '@ant-design/icons';
import { fetchGatewayEvents, fetchHttpRoutes, fetchGrpcRoutes } from '../../../../../../services/harvesterApi';

const { Text } = Typography;

// ============================================================
// 类型定义
// ============================================================

export interface GatewayDetailDrawerProps {
  open: boolean;
  onClose: () => void;
  gateway: any | null;
  cloudId: string;
}

// ============================================================
// 工具函数
// ============================================================

const formatTime = (timestamp?: string) => {
  if (!timestamp) return '-';
  try {
    return new Date(timestamp).toLocaleString('zh-CN');
  } catch {
    return timestamp;
  }
};

const calculateAge = (timestamp?: string) => {
  if (!timestamp) return '-';
  try {
    const created = new Date(timestamp).getTime();
    const diff = Date.now() - created;
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
    if (days > 0) return `${days}d${hours}h`;
    if (hours > 0) return `${hours}h${minutes}m`;
    return `${minutes}m`;
  } catch {
    return '-';
  }
};

const renderConditionStatus = (status: string) => {
  const statusConfig: Record<string, { color: string; icon: React.ReactNode; text: string }> = {
    True: { color: 'green', icon: <CheckCircleOutlined />, text: '正常' },
    False: { color: 'red', icon: <CloseCircleOutlined />, text: '异常' },
    Unknown: { color: 'default', icon: <QuestionCircleOutlined />, text: '未知' },
  };
  const config = statusConfig[status] || statusConfig.Unknown;
  return (
    <Tag color={config.color} icon={config.icon}>
      {config.text}
    </Tag>
  );
};

const renderListenerProtocol = (protocol: string) => {
  const protocolColors: Record<string, string> = {
    HTTP: 'blue',
    HTTPS: 'green',
    TCP: 'orange',
    TLS: 'purple',
    UDP: 'cyan',
  };
  return <Tag color={protocolColors[protocol] || 'default'}>{protocol}</Tag>;
};

const CONDITION_TYPE_MAP: Record<string, string> = {
  Accepted: '已接受',
  Programmed: '已编程',
  Ready: '就绪',
  'gateway.networking.k8s.io/v1/GatewayConditionAccepted': '已接受',
  'gateway.networking.k8s.io/v1/GatewayConditionProgrammed': '已编程',
  'gateway.networking.k8s.io/v1/GatewayConditionReady': '就绪',
};

const CONDITION_REASON_MAP: Record<string, string> = {
  Accepted: '已接受',
  Pending: '等待中',
  Programmed: '已编程',
  Invalid: '无效',
  'WaitingForController': '等待控制器',
  'NoGatewayClassController': '无网关类控制器',
};

const renderConditionType = (type: string) => {
  return <Text strong>{CONDITION_TYPE_MAP[type] || type}</Text>;
};

const renderConditionReason = (reason: string) => {
  if (!reason) return '-';
  return CONDITION_REASON_MAP[reason] || reason;
};

// ============================================================
// 主组件
// ============================================================

export const GatewayDetailDrawer: React.FC<GatewayDetailDrawerProps> = ({
  open,
  onClose,
  gateway,
  cloudId,
}) => {
  const [events, setEvents] = useState<any[]>([]);
  const [eventsLoading, setEventsLoading] = useState(false);
  const [relatedRoutes, setRelatedRoutes] = useState<{ httpRoutes: any[]; grpcRoutes: any[] }>({
    httpRoutes: [],
    grpcRoutes: [],
  });
  const [routesLoading, setRoutesLoading] = useState(false);

  const gatewayName = gateway?.metadata?.name;
  const gatewayNamespace = gateway?.metadata?.namespace;

  useEffect(() => {
    if (!open || !gatewayNamespace || !gatewayName || !cloudId) {
      setEvents([]);
      setRelatedRoutes({ httpRoutes: [], grpcRoutes: [] });
      return;
    }

    let cancelled = false;

    const fetchData = async () => {
      setEventsLoading(true);
      setRoutesLoading(true);

      try {
        const [eventsResult, httpRoutesResult, grpcRoutesResult] = await Promise.all([
          fetchGatewayEvents(cloudId, gatewayNamespace, gatewayName),
          fetchHttpRoutes(cloudId),
          fetchGrpcRoutes(cloudId),
        ]);

        if (!cancelled) {
          setEvents(eventsResult?.data?.items || []);

          const allHttpRoutes = httpRoutesResult?.data?.items || [];
          const allGrpcRoutes = grpcRoutesResult?.data?.items || [];

          const filteredHttpRoutes = allHttpRoutes.filter((route: any) => {
            const parentRefs = route.spec?.parentRefs || [];
            return parentRefs.some(
              (ref: any) =>
                ref.name === gatewayName &&
                (!ref.namespace || ref.namespace === gatewayNamespace) &&
                ref.kind === 'Gateway'
            );
          });

          const filteredGrpcRoutes = allGrpcRoutes.filter((route: any) => {
            const parentRefs = route.spec?.parentRefs || [];
            return parentRefs.some(
              (ref: any) =>
                ref.name === gatewayName &&
                (!ref.namespace || ref.namespace === gatewayNamespace) &&
                ref.kind === 'Gateway'
            );
          });

          setRelatedRoutes({
            httpRoutes: filteredHttpRoutes,
            grpcRoutes: filteredGrpcRoutes,
          });
        }
      } catch (error) {
        console.error('[GatewayDetailDrawer] 加载数据失败:', error);
        if (!cancelled) {
          setEvents([]);
          setRelatedRoutes({ httpRoutes: [], grpcRoutes: [] });
        }
      } finally {
        if (!cancelled) {
          setEventsLoading(false);
          setRoutesLoading(false);
        }
      }
    };

    void fetchData();

    return () => {
      cancelled = true;
    };
  }, [open, cloudId, gatewayNamespace, gatewayName]);

  const conditions = useMemo(() => {
    return gateway?.status?.conditions || [];
  }, [gateway]);

  const listeners = useMemo(() => {
    return gateway?.spec?.listeners || [];
  }, [gateway]);

  const listenerStatuses = useMemo(() => {
    return gateway?.status?.listeners || [];
  }, [gateway]);

  const addresses = useMemo(() => {
    return gateway?.spec?.addresses || [];
  }, [gateway]);

  const alias = gateway?.metadata?.annotations?.['tower.io/alias'] || '';

  if (!gateway) return null;

  return (
    <Drawer
      title={
        <Space>
          <span>Gateway 详情</span>
          {alias && <Text type="secondary">({alias})</Text>}
        </Space>
      }
      placement="right"
      width={800}
      open={open}
      onClose={onClose}
      destroyOnHidden
    >
      <Tabs
        items={[
          {
            key: 'overview',
            label: '概览',
            children: (
              <Space direction="vertical" style={{ width: '100%' }} size="middle">
                <Card title="基本信息" size="small">
                  <Descriptions column={2} bordered size="small">
                    <Descriptions.Item label="名称">{gateway.metadata?.name}</Descriptions.Item>
                    <Descriptions.Item label="项目">{gateway.metadata?.namespace}</Descriptions.Item>
                    <Descriptions.Item label="别名">{alias || '-'}</Descriptions.Item>
                    <Descriptions.Item label="GatewayClass">
                      {gateway.spec?.gatewayClassName || '-'}
                    </Descriptions.Item>
                    <Descriptions.Item label="运行时长">
                      {calculateAge(gateway.metadata?.creationTimestamp)}
                    </Descriptions.Item>
                    <Descriptions.Item label="创建时间">
                      {formatTime(gateway.metadata?.creationTimestamp)}
                    </Descriptions.Item>
                  </Descriptions>
                </Card>

                <Card
                  title={
                    <Space>
                      <span>状态条件</span>
                      <Tooltip title="Gateway 的状态条件，反映 Gateway 的当前状态">
                        <InfoCircleOutlined style={{ color: 'rgba(0,0,0,.45)' }} />
                      </Tooltip>
                    </Space>
                  }
                  size="small"
                >
                  {conditions.length > 0 ? (
                    <Table
                      dataSource={conditions.map((c: any, idx: number) => ({ ...c, key: idx }))}
                      columns={[
                        {
                          title: '类型',
                          dataIndex: 'type',
                          width: 180,
                          render: renderConditionType,
                        },
                        {
                          title: '状态',
                          dataIndex: 'status',
                          width: 100,
                          render: renderConditionStatus,
                        },
                        {
                          title: '原因',
                          dataIndex: 'reason',
                          width: 150,
                          render: renderConditionReason,
                        },
                        {
                          title: '消息',
                          dataIndex: 'message',
                          ellipsis: true,
                          render: (v: string) => (
                            <Tooltip title={v}>
                              <Text>{v || '-'}</Text>
                            </Tooltip>
                          ),
                        },
                        {
                          title: '最后变更',
                          dataIndex: 'lastTransitionTime',
                          width: 180,
                          render: (v: string) => {
                            if (!v || v === '0001-01-01T00:00:00Z') return '-';
                            return formatTime(v);
                          },
                        },
                      ]}
                      pagination={false}
                      size="small"
                    />
                  ) : (
                    <Empty description="暂无状态信息" image={Empty.PRESENTED_IMAGE_SIMPLE} />
                  )}
                </Card>

                <Card
                  title={
                    <Space>
                      <span>监听器</span>
                      <Tooltip title="Gateway 监听器配置，定义端口、协议和路由规则">
                        <InfoCircleOutlined style={{ color: 'rgba(0,0,0,.45)' }} />
                      </Tooltip>
                    </Space>
                  }
                  size="small"
                >
                  {listeners.length > 0 ? (
                    <Table
                      dataSource={listeners.map((l: any, idx: number) => {
                        const status = listenerStatuses.find(
                          (s: any) => s.name === l.name
                        );
                        return { ...l, key: idx, status };
                      })}
                      columns={[
                        {
                          title: '名称',
                          dataIndex: 'name',
                          width: 120,
                        },
                        {
                          title: '协议',
                          dataIndex: 'protocol',
                          width: 80,
                          render: renderListenerProtocol,
                        },
                        {
                          title: '端口',
                          dataIndex: 'port',
                          width: 80,
                        },
                        {
                          title: '主机名',
                          dataIndex: 'hostname',
                          width: 150,
                          render: (v: string) => v || '*',
                        },
                        {
                          title: '状态',
                          key: 'status',
                          width: 100,
                          render: (_: any, record: any) => {
                            const conditions = record.status?.conditions || [];
                            const programmed = conditions.find(
                              (c: any) => c.type === 'Programmed'
                            );
                            if (!programmed) return <Tag>未知</Tag>;
                            return renderConditionStatus(programmed.status);
                          },
                        },
                        {
                          title: '允许路由',
                          key: 'allowedRoutes',
                          ellipsis: true,
                          render: (_: any, record: any) => {
                            const from = record.allowedRoutes?.namespaces?.from || 'Same';
                            const fromMap: Record<string, string> = {
                              Same: '同命名空间',
                              All: '所有命名空间',
                              Selector: '选择器匹配',
                            };
                            return fromMap[from] || from;
                          },
                        },
                      ]}
                      pagination={false}
                      size="small"
                    />
                  ) : (
                    <Empty description="暂无监听器" image={Empty.PRESENTED_IMAGE_SIMPLE} />
                  )}
                </Card>

                <Card
                  title={
                    <Space>
                      <span>地址</span>
                      <Tooltip title="Gateway 的网络地址配置">
                        <InfoCircleOutlined style={{ color: 'rgba(0,0,0,.45)' }} />
                      </Tooltip>
                    </Space>
                  }
                  size="small"
                >
                  {addresses.length > 0 ? (
                    <Table
                      dataSource={addresses.map((a: any, idx: number) => ({ ...a, key: idx }))}
                      columns={[
                        {
                          title: '类型',
                          dataIndex: 'type',
                          width: 120,
                          render: (v: string) => v || 'IPAddress',
                        },
                        {
                          title: '值',
                          dataIndex: 'value',
                          render: (v: string) => <Text code>{v}</Text>,
                        },
                      ]}
                      pagination={false}
                      size="small"
                    />
                  ) : (
                    <Empty description="暂无地址配置" image={Empty.PRESENTED_IMAGE_SIMPLE} />
                  )}
                </Card>
              </Space>
            ),
          },
          {
            key: 'events',
            label: '事件',
            children: (
              <Spin spinning={eventsLoading}>
                {events.length > 0 ? (
                  <Table
                    dataSource={events.map((e: any, idx: number) => ({ ...e, key: idx }))}
                    columns={[
                      {
                        title: '类型',
                        dataIndex: 'type',
                        width: 80,
                        render: (v: string) => (
                          <Tag color={v === 'Normal' ? 'blue' : 'red'}>{v || '-'}</Tag>
                        ),
                      },
                      {
                        title: '原因',
                        dataIndex: 'reason',
                        width: 150,
                        render: (v: string) => v || '-',
                      },
                      {
                        title: '消息',
                        dataIndex: 'message',
                        ellipsis: true,
                        render: (v: string) => (
                          <Tooltip title={v}>
                            <Text>{v || '-'}</Text>
                          </Tooltip>
                        ),
                      },
                      {
                        title: '次数',
                        dataIndex: ['count'],
                        width: 60,
                        render: (v: number) => v || 1,
                      },
                      {
                        title: '时间',
                        dataIndex: 'lastTimestamp',
                        width: 180,
                        render: formatTime,
                      },
                    ]}
                    pagination={{ pageSize: 10, size: 'small' }}
                    size="small"
                  />
                ) : (
                  <Empty description="暂无事件" image={Empty.PRESENTED_IMAGE_SIMPLE} />
                )}
              </Spin>
            ),
          },
          {
            key: 'routes',
            label: '关联路由',
            children: (
              <Spin spinning={routesLoading}>
                <Space direction="vertical" style={{ width: '100%' }} size="middle">
                  <Card title="HTTPRoute" size="small">
                    {relatedRoutes.httpRoutes.length > 0 ? (
                      <Table
                        dataSource={relatedRoutes.httpRoutes.map((r: any, idx: number) => ({
                          ...r,
                          key: idx,
                        }))}
                        columns={[
                          {
                            title: '名称',
                            dataIndex: ['metadata', 'name'],
                            width: 200,
                          },
                          {
                            title: '项目',
                            dataIndex: ['metadata', 'namespace'],
                            width: 120,
                          },
                          {
                            title: '主机名',
                            key: 'hostnames',
                            ellipsis: true,
                            render: (_: any, record: any) => {
                              const hostnames = record.spec?.hostnames || [];
                              return hostnames.length > 0 ? hostnames.join(', ') : '*';
                            },
                          },
                          {
                            title: '创建时间',
                            dataIndex: ['metadata', 'creationTimestamp'],
                            width: 180,
                            render: formatTime,
                          },
                        ]}
                        pagination={false}
                        size="small"
                      />
                    ) : (
                      <Empty description="暂无关联的 HTTPRoute" image={Empty.PRESENTED_IMAGE_SIMPLE} />
                    )}
                  </Card>

                  <Card title="GRPCRoute" size="small">
                    {relatedRoutes.grpcRoutes.length > 0 ? (
                      <Table
                        dataSource={relatedRoutes.grpcRoutes.map((r: any, idx: number) => ({
                          ...r,
                          key: idx,
                        }))}
                        columns={[
                          {
                            title: '名称',
                            dataIndex: ['metadata', 'name'],
                            width: 200,
                          },
                          {
                            title: '项目',
                            dataIndex: ['metadata', 'namespace'],
                            width: 120,
                          },
                          {
                            title: '主机名',
                            key: 'hostnames',
                            ellipsis: true,
                            render: (_: any, record: any) => {
                              const hostnames = record.spec?.hostnames || [];
                              return hostnames.length > 0 ? hostnames.join(', ') : '*';
                            },
                          },
                          {
                            title: '创建时间',
                            dataIndex: ['metadata', 'creationTimestamp'],
                            width: 180,
                            render: formatTime,
                          },
                        ]}
                        pagination={false}
                        size="small"
                      />
                    ) : (
                      <Empty description="暂无关联的 GRPCRoute" image={Empty.PRESENTED_IMAGE_SIMPLE} />
                    )}
                  </Card>
                </Space>
              </Spin>
            ),
          },
        ]}
      />
    </Drawer>
  );
};

export default GatewayDetailDrawer;
