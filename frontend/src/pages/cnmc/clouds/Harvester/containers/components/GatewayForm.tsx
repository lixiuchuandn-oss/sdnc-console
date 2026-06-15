/**
 * ==============================================================================
 * 模块名称: Gateway 创建表单 (GatewayForm)
 * 文件路径: frontend/src/pages/cnmc/clouds/Harvester/containers/components/GatewayForm.tsx
 * ==============================================================================
 * 
 * [功能描述]
 * 用于创建 Kubernetes Gateway API 中的 Gateway 资源。
 * 
 * [核心配置]
 * - 基本信息：名称、命名空间
 * - GatewayClass：定义 Gateway 的控制器实现
 * - 监听器：端口、协议、主机名
 * - 地址：Gateway 的网络地址
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
import { createGateway } from '../../../../../../services/harvesterApi';
import { isSystemNamespace, generateHarvesterCrMetadataName, generateVmWizardStyleDisplayName } from '../../../../../../utils/harvesterUtils';

// ============================================================
// 类型定义
// ============================================================

export interface GatewayFormValues {
  name: string;
  namespace: string;
  gatewayClassName: string;
  listeners: Array<{
    name: string;
    port: number;
    protocol: 'HTTP' | 'HTTPS' | 'TCP' | 'UDP' | 'TLS';
    hostname?: string;
    allowedRoutes?: {
      namespaces: {
        from: 'Same' | 'All' | 'Selector';
      };
    };
  }>;
  addresses?: Array<{
    type: 'IPAddress' | 'NamedAddress' | 'HostnameAddress';
    value: string;
  }>;
}

export interface GatewayFormProps {
  cloudId: string;
  namespacesOptions: string[];
  gatewayClasses: any[]; // 可用的 GatewayClass 列表
  onSuccess: (gatewayInfo?: { name: string; namespace: string }) => void;
  onCancel: () => void;
  defaultNamespace?: string;
}

// ============================================================
// 常量定义
// ============================================================

const PROTOCOL_OPTIONS = [
  { value: 'HTTP', label: 'HTTP' },
  { value: 'HTTPS', label: 'HTTPS' },
  { value: 'TCP', label: 'TCP' },
  { value: 'UDP', label: 'UDP' },
  { value: 'TLS', label: 'TLS' },
];

const ALLOWED_ROUTES_OPTIONS = [
  { value: 'Same', label: 'Same (相同项目)' },
  { value: 'All', label: 'All (所有项目)' },
];

// ============================================================
// 主组件
// ============================================================

const GatewayForm: React.FC<GatewayFormProps> = ({
  cloudId,
  namespacesOptions,
  gatewayClasses,
  onSuccess,
  onCancel,
  defaultNamespace,
}) => {
  const [form] = Form.useForm<GatewayFormValues>();
  const { message } = App.useApp();
  const [loading, setLoading] = useState(false);

  // 初始化默认命名空间
  useEffect(() => {
    if (defaultNamespace) {
      form.setFieldValue('namespace', defaultNamespace);
    }
  }, [defaultNamespace, form]);

  // 构建 GatewayClass 选项
  const gatewayClassOptions = useMemo(() => {
    return (gatewayClasses || []).map((gc: any) => {
      const name = gc.metadata?.name || gc.name;
      return {
        label: name,
        value: name,
      };
    });
  }, [gatewayClasses]);

  // 构建提交数据
  const buildSubmitData = (values: GatewayFormValues): any => {
    const gateway: any = {
      apiVersion: 'gateway.networking.k8s.io/v1',
      kind: 'Gateway',
      metadata: {
        name: generateHarvesterCrMetadataName('gateway'),
        namespace: values.namespace,
        annotations: {
          'tower.io/alias': values.name,
        },
      },
      spec: {
        gatewayClassName: values.gatewayClassName,
        listeners: values.listeners?.map((listener) => ({
          name: listener.name,
          port: listener.port,
          protocol: listener.protocol,
          ...(listener.hostname && { hostname: listener.hostname }),
          allowedRoutes: {
            namespaces: {
              from: listener.allowedRoutes?.namespaces?.from || 'Same',
            },
          },
        })),
      },
    };

    // 地址配置
    if (values.addresses && values.addresses.length > 0) {
      gateway.spec.addresses = values.addresses
        .filter((a) => a.value)
        .map((a) => ({
          type: a.type || 'IPAddress',
          value: a.value,
        }));
    }

    return gateway;
  };

  // 提交表单
  const handleSubmit = async () => {
    try {
      const values = await form.validateFields();
      
      if (!values.gatewayClassName) {
        message.error('请选择 GatewayClass');
        return;
      }

      setLoading(true);
      const submitData = buildSubmitData(values);

      await createGateway(cloudId, values.namespace, submitData);
      message.success('Gateway 创建成功');
      
      // 传递新创建的 Gateway 信息给父组件
      onSuccess({ 
        name: submitData.metadata.name, 
        namespace: values.namespace 
      });
    } catch (error: any) {
      console.error('[GatewayForm] 创建失败:', error);
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
        name: generateVmWizardStyleDisplayName('gateway'),
        listeners: [{ protocol: 'HTTP', port: 80, allowedRoutes: { namespaces: { from: 'Same' } } }],
        addresses: [],
      }}
    >
      {/* 基本信息 */}
      <Card title="基本信息" size="small" style={{ marginBottom: 16 }}>
        <Row gutter={16}>
          <Col span={12}>
            <Form.Item
              name="name"
              label="别名"
              rules={[
                { required: true, message: '请输入别名' },
              ]}
            >
              <Input placeholder="如: my-gateway" />
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
        <Row gutter={16}>
          <Col span={12}>
            <Form.Item
              name="gatewayClassName"
              label="GatewayClass"
              rules={[{ required: true, message: '请选择 GatewayClass' }]}
            >
              <Select
                placeholder="选择 GatewayClass"
                showSearch
                options={gatewayClassOptions}
                notFoundContent={
                  <Alert
                    type="warning"
                    message="没有可用的 GatewayClass"
                    description="请先安装 Gateway API CRD 并创建 GatewayClass"
                    showIcon
                    style={{ margin: -8 }}
                  />
                }
              />
            </Form.Item>
          </Col>
        </Row>
      </Card>

      {/* 监听器配置 */}
      <Card title="监听器" size="small" style={{ marginBottom: 16 }}>
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
          message="监听器定义 Gateway 监听的端口和协议"
        />

        <Form.List name="listeners">
          {(fields, { add, remove }) => (
            <>
              {fields.map(({ key, name: index, ...restField }) => (
                <Card
                  key={key}
                  size="small"
                  style={{ marginBottom: 8, background: '#fafafa' }}
                  title={`监听器 ${index + 1}`}
                  extra={
                    fields.length > 1 && (
                      <Button
                        type="text"
                        danger
                        size="small"
                        icon={<MinusCircleOutlined />}
                        onClick={() => remove(index)}
                      >
                        删除
                      </Button>
                    )
                  }
                >
                  <Row gutter={16}>
                    <Col span={6}>
                      <Form.Item
                        {...restField}
                        name={[index, 'name']}
                        label="名称"
                        rules={[{ required: true, message: '请输入名称' }]}
                      >
                        <Input placeholder="如: http" />
                      </Form.Item>
                    </Col>
                    <Col span={6}>
                      <Form.Item
                        {...restField}
                        name={[index, 'port']}
                        label="端口"
                        rules={[{ required: true, message: '请输入端口' }]}
                      >
                        <InputNumber min={1} max={65535} placeholder="80" style={{ width: '100%' }} />
                      </Form.Item>
                    </Col>
                    <Col span={6}>
                      <Form.Item
                        {...restField}
                        name={[index, 'protocol']}
                        label="协议"
                        rules={[{ required: true, message: '请选择协议' }]}
                      >
                        <Select options={PROTOCOL_OPTIONS} />
                      </Form.Item>
                    </Col>
                    <Col span={6}>
                      <Form.Item
                        {...restField}
                        name={[index, 'hostname']}
                        label={
                          <span>
                            主机名
                            <Tooltip title="可选，用于基于主机名的路由">
                              <InfoCircleOutlined style={{ marginLeft: 4, color: '#999' }} />
                            </Tooltip>
                          </span>
                        }
                      >
                        <Input placeholder="如: example.com" />
                      </Form.Item>
                    </Col>
                  </Row>
                  <Row gutter={16}>
                    <Col span={12}>
                      <Form.Item
                        {...restField}
                        name={[index, 'allowedRoutes', 'namespaces', 'from']}
                        label="允许的路由来源"
                      >
                        <Select options={ALLOWED_ROUTES_OPTIONS} />
                      </Form.Item>
                    </Col>
                  </Row>
                </Card>
              ))}
              <Button
                type="dashed"
                onClick={() => add({ protocol: 'HTTP', port: 80, allowedRoutes: { namespaces: { from: 'Same' } } })}
                block
                icon={<PlusOutlined />}
              >
                添加监听器
              </Button>
            </>
          )}
        </Form.List>
      </Card>

      {/* 地址配置（可选） */}
      <Card title="地址配置（可选）" size="small" style={{ marginBottom: 16 }}>
        <Form.List name="addresses">
          {(fields, { add, remove }) => (
            <>
              {fields.map(({ key, name: index, ...restField }) => (
                <Row key={key} gutter={16} style={{ marginBottom: 8 }}>
                  <Col span={6}>
                    <Form.Item
                      {...restField}
                      name={[index, 'type']}
                      label="类型"
                    >
                      <Select
                        options={[
                          { value: 'IPAddress', label: 'IP 地址' },
                          { value: 'HostnameAddress', label: '主机名' },
                        ]}
                      />
                    </Form.Item>
                  </Col>
                  <Col span={14}>
                    <Form.Item
                      {...restField}
                      name={[index, 'value']}
                      label="值"
                    >
                      <Input placeholder="如: 192.168.1.1 或 gateway.example.com" />
                    </Form.Item>
                  </Col>
                  <Col span={4} style={{ display: 'flex', alignItems: 'flex-end', paddingBottom: 24 }}>
                    <MinusCircleOutlined onClick={() => remove(index)} style={{ color: '#999' }} />
                  </Col>
                </Row>
              ))}
              <Button type="dashed" onClick={() => add({ type: 'IPAddress' })} block icon={<PlusOutlined />}>
                添加地址
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

export default GatewayForm;
