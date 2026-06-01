/**
 * ==============================================================================
 * 模块名称: GRPCRoute 创建表单 (GRPCRouteForm)
 * 文件路径: frontend/src/pages/cnmc/clouds/Harvester/containers/components/GRPCRouteForm.tsx
 * ==============================================================================
 * 
 * [功能描述]
 * 用于创建 Kubernetes Gateway API 中的 GRPCRoute 资源。
 * 
 * [核心配置]
 * - 基本信息：名称、命名空间
 * - 父级 Gateway 引用
 * - 主机名配置
 * - 路由规则：服务/方法匹配 -> 后端服务
 */

import React, { useState, useEffect, useMemo } from 'react';
import {
  Form,
  Input,
  Select,
  InputNumber,
  Button,
  Space,
  Row,
  Col,
  App,
  Card,
  Alert,
  Tooltip,
} from 'antd';
import {
  PlusOutlined,
  MinusCircleOutlined,
  InfoCircleOutlined,
} from '@ant-design/icons';
import { createGrpcRoute } from '../../../../../../services/harvesterApi';
import { isSystemNamespace } from '../../../../../../utils/harvesterUtils';

// ============================================================
// 类型定义
// ============================================================

export interface GRPCRouteFormValues {
  name: string;
  namespace: string;
  parentRefs: Array<{
    name: string;
    namespace?: string;
    sectionName?: string;
  }>;
  hostnames?: string[];
  rules: Array<{
    matches: Array<{
      method?: {
        type: 'Exact' | 'RegularExpression';
        service?: string;
        method?: string;
      };
    }>;
    backendRefs: Array<{
      name: string;
      port: number;
      weight?: number;
    }>;
  }>;
}

export interface GRPCRouteFormProps {
  cloudId: string;
  namespacesOptions: string[];
  gateways: any[];
  services?: any[];
  onSuccess: () => void;
  onCancel: () => void;
  defaultNamespace?: string;
}

// ============================================================
// 常量定义
// ============================================================

const METHOD_TYPE_OPTIONS = [
  { value: 'Exact', label: 'Exact (精确匹配)' },
  { value: 'RegularExpression', label: 'RegularExpression (正则匹配)' },
];

// ============================================================
// 主组件
// ============================================================

const GRPCRouteForm: React.FC<GRPCRouteFormProps> = ({
  cloudId,
  namespacesOptions,
  gateways,
  services,
  onSuccess,
  onCancel,
  defaultNamespace,
}) => {
  const [form] = Form.useForm<GRPCRouteFormValues>();
  const { message } = App.useApp();
  const [loading, setLoading] = useState(false);

  const currentNamespace = Form.useWatch('namespace', form);

  useEffect(() => {
    if (defaultNamespace) {
      form.setFieldValue('namespace', defaultNamespace);
    }
  }, [defaultNamespace, form]);

  const gatewayOptions = useMemo(() => {
    if (!gateways || !currentNamespace) return [];
    return gateways
      .filter((g: any) => (g.metadata?.namespace || g.namespace) === currentNamespace)
      .map((g: any) => ({
        label: g.metadata?.name || g.name,
        value: g.metadata?.name || g.name,
      }));
  }, [gateways, currentNamespace]);

  const serviceOptions = useMemo(() => {
    if (!services || !currentNamespace) return [];
    return services
      .filter((s: any) => (s.metadata?.namespace || s.namespace) === currentNamespace)
      .map((s: any) => ({
        label: s.metadata?.name || s.name,
        value: s.metadata?.name || s.name,
      }));
  }, [services, currentNamespace]);

  const buildSubmitData = (values: GRPCRouteFormValues): any => {
    const grpcRoute: any = {
      apiVersion: 'gateway.networking.k8s.io/v1',
      kind: 'GRPCRoute',
      metadata: {
        name: values.name,
        namespace: values.namespace,
      },
      spec: {},
    };

    if (values.parentRefs && values.parentRefs.length > 0) {
      grpcRoute.spec.parentRefs = values.parentRefs
        .filter((p) => p.name)
        .map((p) => {
          const ref: any = {
            name: p.name,
            kind: 'Gateway',
            group: 'gateway.networking.k8s.io',
          };
          if (p.namespace && p.namespace !== values.namespace) {
            ref.namespace = p.namespace;
          }
          if (p.sectionName) {
            ref.sectionName = p.sectionName;
          }
          return ref;
        });
    }

    if (values.hostnames && values.hostnames.length > 0) {
      grpcRoute.spec.hostnames = values.hostnames.filter(Boolean);
    }

    if (values.rules && values.rules.length > 0) {
      grpcRoute.spec.rules = values.rules.map((rule) => ({
        matches: rule.matches?.map((m) => {
          const match: any = {};
          if (m.method) {
            match.method = {
              type: m.method.type || 'Exact',
            };
            if (m.method.service) {
              match.method.service = m.method.service;
            }
            if (m.method.method) {
              match.method.method = m.method.method;
            }
          }
          return match;
        }),
        backendRefs: rule.backendRefs?.map((b) => ({
          name: b.name,
          port: b.port,
          kind: 'Service',
          group: '',
          ...(b.weight && { weight: b.weight }),
        })),
      }));
    }

    return grpcRoute;
  };

  const handleSubmit = async () => {
    try {
      const values = await form.validateFields();
      setLoading(true);

      const submitData = buildSubmitData(values);

      await createGrpcRoute(cloudId, values.namespace, submitData);
      message.success('GRPCRoute 创建成功');
      onSuccess();
    } catch (error: any) {
      console.error('[GRPCRouteForm] 创建失败:', error);
      const errorMsg = error?.response?.data?.message || error?.message || '创建失败';
      message.error(errorMsg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Form
      form={form}
      layout="vertical"
      initialValues={{
        parentRefs: [{}],
        rules: [{ matches: [{}], backendRefs: [{}] }],
      }}
    >
      {/* 基本信息 */}
      <Card title="基本信息" size="small" style={{ marginBottom: 16 }}>
        <Row gutter={16}>
          <Col span={12}>
            <Form.Item
              name="name"
              label="名称"
              rules={[
                { required: true, message: '请输入名称' },
                { pattern: /^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/, message: '只允许小写字母、数字和连字符' },
              ]}
            >
              <Input placeholder="如: my-grpcroute" />
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item
              name="namespace"
              label="项目"
              rules={[{ required: true, message: '请选择项目' }]}
            >
              <Select
                placeholder="选择项目"
                showSearch
                options={namespacesOptions.filter(ns => !isSystemNamespace(ns)).map(ns => ({ label: ns, value: ns }))}
              />
            </Form.Item>
          </Col>
        </Row>
      </Card>

      {/* Gateway 引用 */}
      <Card title="Gateway 引用" size="small" style={{ marginBottom: 16 }}>
        <Form.List name="parentRefs">
          {(fields, { add, remove }) => (
            <>
              {fields.map(({ key, name: index, ...restField }) => (
                <Row key={key} gutter={16} style={{ marginBottom: 8 }}>
                  <Col span={10}>
                    <Form.Item
                      {...restField}
                      name={[index, 'name']}
                      label="Gateway 名称"
                      rules={[{ required: true, message: '请选择 Gateway' }]}
                    >
                      <Select
                        placeholder="选择 Gateway"
                        showSearch
                        options={gatewayOptions}
                        notFoundContent="当前项目下没有 Gateway"
                      />
                    </Form.Item>
                  </Col>
                  <Col span={8}>
                    <Form.Item
                      {...restField}
                      name={[index, 'sectionName']}
                      label={
                        <span>
                          监听器
                          <Tooltip title="可选，指定 Gateway 的监听器名称">
                            <InfoCircleOutlined style={{ marginLeft: 4, color: '#999' }} />
                          </Tooltip>
                        </span>
                      }
                    >
                      <Input placeholder="监听器名称" />
                    </Form.Item>
                  </Col>
                  <Col span={4} style={{ display: 'flex', alignItems: 'flex-end', paddingBottom: 24 }}>
                    {fields.length > 1 && (
                      <MinusCircleOutlined onClick={() => remove(index)} style={{ color: '#999' }} />
                    )}
                  </Col>
                </Row>
              ))}
              <Button type="dashed" onClick={() => add()} block icon={<PlusOutlined />}>
                添加 Gateway 引用
              </Button>
            </>
          )}
        </Form.List>
      </Card>

      {/* 主机名配置 */}
      <Card title="主机名（可选）" size="small" style={{ marginBottom: 16 }}>
        <Form.Item name="hostnames" label="主机名列表">
          <Select
            mode="tags"
            placeholder="输入主机名后回车添加，如: grpc.example.com"
            tokenSeparators={[',']}
          />
        </Form.Item>
      </Card>

      {/* 路由规则 */}
      <Card title="路由规则" size="small" style={{ marginBottom: 16 }}>
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
          message="gRPC 路由支持按服务名和方法名匹配请求"
        />

        <Form.List name="rules">
          {(ruleFields, { add: addRule, remove: removeRule }) => (
            <>
              {ruleFields.map(({ key: ruleKey, name: ruleIndex, ..._ruleRest }) => (
                <Card
                  key={ruleKey}
                  size="small"
                  style={{ marginBottom: 12, background: '#fafafa' }}
                  title={`规则 ${ruleIndex + 1}`}
                  extra={
                    ruleFields.length > 1 && (
                      <Button type="text" danger size="small" onClick={() => removeRule(ruleIndex)}>
                        删除规则
                      </Button>
                    )
                  }
                >
                  {/* 匹配条件 */}
                  <div style={{ marginBottom: 16 }}>
                    <div style={{ fontWeight: 500, marginBottom: 8 }}>方法匹配</div>
                    <Form.List name={[ruleIndex, 'matches']}>
                      {(matchFields, { add: addMatch, remove: removeMatch }) => (
                        <>
                          {matchFields.map(({ key: matchKey, name: matchIndex, ...matchRest }) => (
                            <Row key={matchKey} gutter={8} style={{ marginBottom: 8 }}>
                              <Col span={6}>
                                <Form.Item
                                  {...matchRest}
                                  name={[matchIndex, 'method', 'type']}
                                  style={{ marginBottom: 0 }}
                                >
                                  <Select options={METHOD_TYPE_OPTIONS} />
                                </Form.Item>
                              </Col>
                              <Col span={8}>
                                <Form.Item
                                  {...matchRest}
                                  name={[matchIndex, 'method', 'service']}
                                  style={{ marginBottom: 0 }}
                                >
                                  <Input placeholder="服务名 (如: myservice.MyService)" />
                                </Form.Item>
                              </Col>
                              <Col span={8}>
                                <Form.Item
                                  {...matchRest}
                                  name={[matchIndex, 'method', 'method']}
                                  style={{ marginBottom: 0 }}
                                >
                                  <Input placeholder="方法名 (如: MyMethod)" />
                                </Form.Item>
                              </Col>
                              <Col span={2}>
                                {matchFields.length > 1 && (
                                  <MinusCircleOutlined onClick={() => removeMatch(matchIndex)} style={{ color: '#999' }} />
                                )}
                              </Col>
                            </Row>
                          ))}
                          <Button type="dashed" size="small" onClick={() => addMatch({})} icon={<PlusOutlined />}>
                            添加匹配条件
                          </Button>
                        </>
                      )}
                    </Form.List>
                  </div>

                  {/* 后端服务 */}
                  <div>
                    <div style={{ fontWeight: 500, marginBottom: 8 }}>后端服务</div>
                    <Form.List name={[ruleIndex, 'backendRefs']}>
                      {(backendFields, { add: addBackend, remove: removeBackend }) => (
                        <>
                          {backendFields.map(({ key: backendKey, name: backendIndex, ...backendRest }) => (
                            <Row key={backendKey} gutter={8} style={{ marginBottom: 8 }}>
                              <Col span={10}>
                                <Form.Item
                                  {...backendRest}
                                  name={[backendIndex, 'name']}
                                  rules={[{ required: true, message: 'Service 名称' }]}
                                  style={{ marginBottom: 0 }}
                                >
                                  <Select
                                    placeholder="Service"
                                    showSearch
                                    options={serviceOptions}
                                  />
                                </Form.Item>
                              </Col>
                              <Col span={6}>
                                <Form.Item
                                  {...backendRest}
                                  name={[backendIndex, 'port']}
                                  rules={[{ required: true, message: '端口' }]}
                                  style={{ marginBottom: 0 }}
                                >
                                  <InputNumber min={1} max={65535} placeholder="端口" style={{ width: '100%' }} />
                                </Form.Item>
                              </Col>
                              <Col span={5}>
                                <Form.Item
                                  {...backendRest}
                                  name={[backendIndex, 'weight']}
                                  style={{ marginBottom: 0 }}
                                >
                                  <InputNumber min={1} max={100} placeholder="权重" style={{ width: '100%' }} />
                                </Form.Item>
                              </Col>
                              <Col span={3}>
                                {backendFields.length > 1 && (
                                  <MinusCircleOutlined onClick={() => removeBackend(backendIndex)} style={{ color: '#999' }} />
                                )}
                              </Col>
                            </Row>
                          ))}
                          <Button type="dashed" size="small" onClick={() => addBackend()} icon={<PlusOutlined />}>
                            添加后端服务
                          </Button>
                        </>
                      )}
                    </Form.List>
                  </div>
                </Card>
              ))}
              <Button type="dashed" onClick={() => addRule({ matches: [{}], backendRefs: [{}] })} block icon={<PlusOutlined />}>
                添加规则
              </Button>
            </>
          )}
        </Form.List>
      </Card>

      {/* 操作按钮 */}
      <div style={{ textAlign: 'right' }}>
        <Space>
          <Button onClick={onCancel}>取消</Button>
          <Button type="primary" onClick={handleSubmit} loading={loading}>
            创建
          </Button>
        </Space>
      </div>
    </Form>
  );
};

export default GRPCRouteForm;
