/**
 * ==============================================================================
 * 模块名称: HTTPRoute 详情抽屉 (HTTPRouteDetailDrawer)
 * 文件路径: frontend/src/pages/cnmc/clouds/Harvester/containers/drawers/HTTPRouteDetailDrawer.tsx
 * ==============================================================================
 * 
 * [功能描述]
 * 展示 HTTPRoute 资源的详细信息，包括：
 * - 概览：基本信息、关联 Gateway、主机名
 * - 规则配置：每个规则的匹配条件和后端服务
 * - 状态：Conditions 状态
 */

import React, { useMemo, useState, useEffect } from 'react';
import {
  Drawer,
  Descriptions,
  Tabs,
  Tag,
  Space,
  Table,
  Card,
  Empty,
  Typography,
  Tooltip,
  Divider,
} from 'antd';
import {
  CheckCircleOutlined,
  CloseCircleOutlined,
  QuestionCircleOutlined,
  InfoCircleOutlined,
} from '@ant-design/icons';
import { fetchGatewayDetail } from '../../../../../../services/harvesterApi';

const { Text } = Typography;

// ============================================================
// 类型定义
// ============================================================

export interface HTTPRouteDetailDrawerProps {
  open: boolean;
  onClose: () => void;
  httpRoute: any | null;
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

const CONDITION_TYPE_MAP: Record<string, string> = {
  Accepted: '已接受',
  ResolvedRefs: '引用已解析',
  'gateway.networking.k8s.io/v1/RouteConditionAccepted': '已接受',
  'gateway.networking.k8s.io/v1/RouteConditionResolvedRefs': '引用已解析',
};

const CONDITION_REASON_MAP: Record<string, string> = {
  Accepted: '已接受',
  Pending: '等待中',
  ResolvedRefs: '引用已解析',
  Invalid: '无效',
  'NotAllowedByListener': '不被监听器允许',
  'NotFound': '未找到',
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

export const HTTPRouteDetailDrawer: React.FC<HTTPRouteDetailDrawerProps> = ({
  open,
  onClose,
  httpRoute,
  cloudId,
}) => {
  const [gatewaysData, setGatewaysData] = useState<Record<string, any>>({});
  const [loadingGateways, setLoadingGateways] = useState(false);

  const conditions = useMemo(() => {
    return httpRoute?.status?.conditions || [];
  }, [httpRoute]);

  const parentRefs = useMemo(() => {
    return httpRoute?.spec?.parentRefs || [];
  }, [httpRoute]);

  const hostnames = useMemo(() => {
    return httpRoute?.spec?.hostnames || [];
  }, [httpRoute]);

  const rules = useMemo(() => {
    return httpRoute?.spec?.rules || [];
  }, [httpRoute]);

  const alias = httpRoute?.metadata?.annotations?.['tower.io/alias'] || '';

  useEffect(() => {
    if (!open || !httpRoute || !cloudId) return;

    const fetchGateways = async () => {
      setLoadingGateways(true);
      const refs = httpRoute?.spec?.parentRefs || [];
      const gatewayMap: Record<string, any> = {};

      for (const ref of refs) {
        if (ref.kind === 'Gateway' || !ref.kind) {
          const ns = ref.namespace || httpRoute.metadata?.namespace;
          const name = ref.name;
          const key = `${ns}/${name}`;

          try {
            const response = await fetchGatewayDetail(cloudId, ns, name);
            const gateway = response?.data || response;
            console.log(`[HTTPRouteDetailDrawer] Fetched Gateway ${key}:`, gateway);
            console.log(`[HTTPRouteDetailDrawer] Gateway listeners:`, gateway?.spec?.listeners);
            gatewayMap[key] = gateway;
          } catch (error) {
            console.error(`Failed to fetch Gateway ${key}:`, error);
          }
        }
      }

      console.log('[HTTPRouteDetailDrawer] All gateways data:', gatewayMap);
      setGatewaysData(gatewayMap);
      setLoadingGateways(false);
    };

    fetchGateways();
  }, [open, httpRoute, cloudId]);

  const getListenerPort = (ref: any) => {
    const ns = ref.namespace || httpRoute?.metadata?.namespace;
    const name = ref.name;
    const key = `${ns}/${name}`;
    const gateway = gatewaysData[key];

    if (!gateway) return null;

    const listeners = gateway?.spec?.listeners || [];

    if (ref.sectionName) {
      const listener = listeners.find((l: any) => l.name === ref.sectionName);
      return listener?.port || null;
    }

    if (ref.port) {
      return ref.port;
    }

    if (listeners.length === 1) {
      return listeners[0]?.port || null;
    }

    return listeners.map((l: any) => l.port).filter(Boolean);
  };

  if (!httpRoute) return null;

  return (
    <Drawer
      title={
        <Space>
          <span>HTTPRoute 详情</span>
          {alias && <Text type="secondary">({alias})</Text>}
        </Space>
      }
      placement="right"
      width={900}
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
                    <Descriptions.Item label="名称">{httpRoute.metadata?.name}</Descriptions.Item>
                    <Descriptions.Item label="项目">{httpRoute.metadata?.namespace}</Descriptions.Item>
                    <Descriptions.Item label="别名">{alias || '-'}</Descriptions.Item>
                    <Descriptions.Item label="运行时长">
                      {calculateAge(httpRoute.metadata?.creationTimestamp)}
                    </Descriptions.Item>
                    <Descriptions.Item label="创建时间" span={2}>
                      {formatTime(httpRoute.metadata?.creationTimestamp)}
                    </Descriptions.Item>
                  </Descriptions>
                </Card>

                <Card
                  title={
                    <Space>
                      <span>关联 Gateway</span>
                      <Tooltip title="此路由绑定的 Gateway 列表">
                        <InfoCircleOutlined style={{ color: 'rgba(0,0,0,.45)' }} />
                      </Tooltip>
                    </Space>
                  }
                  size="small"
                >
                  {parentRefs.length > 0 ? (
                    <Table
                      dataSource={parentRefs.map((ref: any, idx: number) => ({ ...ref, key: idx }))}
                      columns={[
                        {
                          title: '名称',
                          dataIndex: 'name',
                          render: (name: string) => <Text strong>{name}</Text>,
                        },
                        {
                          title: '项目',
                          dataIndex: 'namespace',
                          render: (ns: string) => <Tag>{ns || httpRoute.metadata?.namespace}</Tag>,
                        },
                        {
                          title: '类型',
                          dataIndex: 'kind',
                          render: (kind: string) => <Tag color="blue">{kind || 'Gateway'}</Tag>,
                        },
                        {
                          title: '端口',
                          dataIndex: 'port',
                          render: (port: number, ref: any) => {
                            if (loadingGateways) {
                              return <Text type="secondary">加载中...</Text>;
                            }
                            const listenerPort = getListenerPort(ref);
                            console.log('[HTTPRouteDetailDrawer] getListenerPort result:', { ref, listenerPort });
                            if (listenerPort === null) {
                              return '-';
                            }
                            if (Array.isArray(listenerPort)) {
                              if (listenerPort.length === 0) return '-';
                              return (
                                <Space size={4}>
                                  {listenerPort.map((p, idx) => (
                                    <Tag key={idx} color="orange">{p}</Tag>
                                  ))}
                                </Space>
                              );
                            }
                            return <Tag color="orange">{listenerPort}</Tag>;
                          },
                        },
                        {
                          title: 'Section名称',
                          dataIndex: 'sectionName',
                          render: (section: string) => section || '-',
                        },
                      ]}
                      pagination={false}
                      size="small"
                    />
                  ) : (
                    <Empty description="未关联 Gateway" image={Empty.PRESENTED_IMAGE_SIMPLE} />
                  )}
                </Card>

                <Card
                  title={
                    <Space>
                      <span>主机名</span>
                      <Tooltip title="路由匹配的主机名列表，为空表示匹配所有主机">
                        <InfoCircleOutlined style={{ color: 'rgba(0,0,0,.45)' }} />
                      </Tooltip>
                    </Space>
                  }
                  size="small"
                >
                  {hostnames.length > 0 ? (
                    <Space wrap>
                      {hostnames.map((hostname: string, idx: number) => (
                        <Tag key={idx} color="blue">
                          {hostname}
                        </Tag>
                      ))}
                    </Space>
                  ) : (
                    <Tag color="default">*（所有主机）</Tag>
                  )}
                </Card>

                <Card
                  title={
                    <Space>
                      <span>状态条件</span>
                      <Tooltip title="HTTPRoute 的状态条件，反映路由的当前状态">
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
              </Space>
            ),
          },
          {
            key: 'rules',
            label: '规则配置',
            children: (
              <Space direction="vertical" style={{ width: '100%' }} size="middle">
                {rules.length > 0 ? (
                  rules.map((rule: any, ruleIdx: number) => (
                    <Card
                      key={ruleIdx}
                      title={
                        <Space>
                          <span>规则 {ruleIdx + 1}</span>
                          <Tag color="blue">
                            {rule.matches?.length || 0} 个匹配条件
                          </Tag>
                          <Tag color="green">
                            {rule.backendRefs?.length || 0} 个后端服务
                          </Tag>
                        </Space>
                      }
                      size="small"
                    >
                      <Space direction="vertical" style={{ width: '100%' }} size="small">
                        <Divider orientation="left" style={{ margin: '8px 0' }}>
                          匹配条件
                        </Divider>
                        {rule.matches && rule.matches.length > 0 ? (
                          <Table
                            dataSource={rule.matches.map((match: any, idx: number) => ({
                              ...match,
                              key: idx,
                            }))}
                            columns={[
                              {
                                title: '路径',
                                dataIndex: 'path',
                                render: (path: any) => {
                                  if (!path) return '-';
                                  const typeMap: Record<string, string> = {
                                    Exact: '精确',
                                    PathPrefix: '前缀',
                                    RegularExpression: '正则',
                                  };
                                  return (
                                    <Space size={4}>
                                      <Text code>{path.value}</Text>
                                      <Tag color="blue" style={{ marginLeft: 4 }}>
                                        {typeMap[path.type] || path.type}
                                      </Tag>
                                    </Space>
                                  );
                                },
                              },
                              {
                                title: '方法',
                                dataIndex: 'method',
                                render: (method: string) =>
                                  method ? <Tag color="orange">{method}</Tag> : '-',
                              },
                              {
                                title: '请求头',
                                dataIndex: 'headers',
                                render: (headers: any[]) => {
                                  if (!headers || headers.length === 0) return '-';
                                  const typeMap: Record<string, string> = {
                                    Exact: '精确',
                                    RegularExpression: '正则',
                                  };
                                  return (
                                    <Space direction="vertical" size={0}>
                                      {headers.map((h, idx) => (
                                        <div key={idx}>
                                          <Text code>
                                            {h.name}: {h.value}
                                          </Text>
                                          <Tag color="blue" style={{ marginLeft: 4, fontSize: 11 }}>
                                            {typeMap[h.type] || h.type || '精确'}
                                          </Tag>
                                        </div>
                                      ))}
                                    </Space>
                                  );
                                },
                              },
                              {
                                title: '查询参数',
                                dataIndex: 'queryParams',
                                render: (params: any[]) => {
                                  if (!params || params.length === 0) return '-';
                                  const typeMap: Record<string, string> = {
                                    Exact: '精确',
                                    RegularExpression: '正则',
                                  };
                                  return (
                                    <Space direction="vertical" size={0}>
                                      {params.map((p, idx) => (
                                        <div key={idx}>
                                          <Text code>
                                            {p.name}={p.value}
                                          </Text>
                                          <Tag color="blue" style={{ marginLeft: 4, fontSize: 11 }}>
                                            {typeMap[p.type] || p.type || '精确'}
                                          </Tag>
                                        </div>
                                      ))}
                                    </Space>
                                  );
                                },
                              },
                            ]}
                            pagination={false}
                            size="small"
                          />
                        ) : (
                          <Empty
                            description="无匹配条件（匹配所有请求）"
                            image={Empty.PRESENTED_IMAGE_SIMPLE}
                          />
                        )}

                        <Divider orientation="left" style={{ margin: '16px 0 8px 0' }}>
                          后端服务
                        </Divider>
                        {rule.backendRefs && rule.backendRefs.length > 0 ? (
                          <Table
                            dataSource={rule.backendRefs.map((backend: any, idx: number) => ({
                              ...backend,
                              key: idx,
                            }))}
                            columns={[
                              {
                                title: 'Service名称',
                                dataIndex: 'name',
                                render: (name: string) => <Text strong>{name}</Text>,
                              },
                              {
                                title: '项目',
                                dataIndex: 'namespace',
                                render: (ns: string) => (
                                  <Tag>{ns || httpRoute.metadata?.namespace}</Tag>
                                ),
                              },
                              {
                                title: '端口',
                                dataIndex: 'port',
                                render: (port: number) =>
                                  port ? <Tag color="orange">{port}</Tag> : '-',
                              },
                              {
                                title: '权重',
                                dataIndex: 'weight',
                                render: (weight: number) => (
                                  <Tag color="purple">{weight || 100}</Tag>
                                ),
                              },
                              {
                                title: '类型',
                                dataIndex: 'kind',
                                render: (kind: string) => (
                                  <Tag color="blue">{kind || 'Service'}</Tag>
                                ),
                              },
                            ]}
                            pagination={false}
                            size="small"
                          />
                        ) : (
                          <Empty
                            description="无后端服务配置"
                            image={Empty.PRESENTED_IMAGE_SIMPLE}
                          />
                        )}
                      </Space>
                    </Card>
                  ))
                ) : (
                  <Empty description="暂无规则配置" image={Empty.PRESENTED_IMAGE_SIMPLE} />
                )}
              </Space>
            ),
          },
        ]}
      />
    </Drawer>
  );
};

export default HTTPRouteDetailDrawer;
