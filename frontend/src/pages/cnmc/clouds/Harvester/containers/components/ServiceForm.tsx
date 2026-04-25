/**
 * ==============================================================================
 * 模块名称: Service 创建/编辑表单 (ServiceForm)
 * 文件路径: frontend/src/pages/cnmc/clouds/Harvester/containers/components/ServiceForm.tsx
 * ==============================================================================
 * 
 * [功能描述]
 * 用于创建或编辑 Kubernetes Service 资源的表单组件。
 * 支持两种模式：
 * - 创建模式：所有字段可编辑
 * - 编辑模式：名称、命名空间禁用，其他字段可编辑
 * 
 * [支持的 Service 类型]
 * - ClusterIP: 集群内部访问（默认）
 * - NodePort: 通过节点端口暴露
 * - LoadBalancer: 通过负载均衡器暴露
 * - ExternalName: 映射到外部 DNS 名称
 */

import React, { useState, useEffect, useMemo } from 'react';
import {
  Form,
  Input,
  Select,
  InputNumber,
  Button,
  Space,
  Divider,
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
  ApiOutlined,
} from '@ant-design/icons';
import { createHarvesterService, updateHarvesterService } from '../../../../../../services/harvesterApi';
import { generateHarvesterCrMetadataName, generateVmWizardStyleDisplayName, isSystemNamespace } from '../../../../../../utils/harvesterUtils';

// ============================================================
// 类型定义
// ============================================================

export interface ServiceFormValues {
  name: string;
  namespace: string;
  labels: Array<{ key: string; value: string }>;
  type: 'ClusterIP' | 'NodePort' | 'LoadBalancer' | 'ExternalName';
  selector: Array<{ key: string; value: string }>;
  ports: Array<{
    name: string;
    protocol: 'TCP' | 'UDP' | 'SCTP';
    port: number;
    targetPort: string | number;
    nodePort?: number;
  }>;
  externalName?: string;
  clusterIP?: string;
}

export interface ServiceFormProps {
  cloudId: string;
  namespacesOptions: string[];
  onSuccess: () => void;
  onCancel: () => void;
  defaultNamespace?: string;
  /** 编辑模式 */
  editMode?: boolean;
  /** 编辑模式下的初始数据（原始 Service 对象） */
  initialData?: any;
}

// ============================================================
// 常量定义
// ============================================================

const SERVICE_TYPE_OPTIONS = [
  { value: 'ClusterIP', label: 'ClusterIP (集群内部访问)' },
  { value: 'NodePort', label: 'NodePort (节点端口暴露)' },
  { value: 'LoadBalancer', label: 'LoadBalancer (负载均衡器)' },
  { value: 'ExternalName', label: 'ExternalName (外部名称映射)' },
];

const PROTOCOL_OPTIONS = [
  { value: 'TCP', label: 'TCP' },
  { value: 'UDP', label: 'UDP' },
  { value: 'SCTP', label: 'SCTP' },
];

// ============================================================
// 子组件: 标签/选择器编辑器
// ============================================================

const KeyValueEditor: React.FC<{
  name: string;
  label: string;
  tooltip?: string;
}> = ({ name, label, tooltip }) => (
  <Form.List name={name}>
    {(fields, { add, remove }) => (
      <div>
        <div style={{ marginBottom: 8 }}>
          <Space>
            <span style={{ fontWeight: 500 }}>{label}</span>
            {tooltip && (
              <Tooltip title={tooltip}>
                <InfoCircleOutlined style={{ color: '#999' }} />
              </Tooltip>
            )}
            <Button type="dashed" size="small" onClick={() => add()} icon={<PlusOutlined />}>
              添加
            </Button>
          </Space>
        </div>
        {fields.map(({ key, name: index, ...restField }) => (
          <Space key={key} style={{ display: 'flex', marginBottom: 8 }} align="baseline">
            <Form.Item
              {...restField}
              name={[index, 'key']}
              rules={[{ required: true, message: '请输入键' }]}
            >
              <Input placeholder="键 (如: app)" style={{ width: 150 }} />
            </Form.Item>
            <Form.Item
              {...restField}
              name={[index, 'value']}
              rules={[{ required: true, message: '请输入值' }]}
            >
              <Input placeholder="值 (如: nginx)" style={{ width: 150 }} />
            </Form.Item>
            <MinusCircleOutlined onClick={() => remove(index)} style={{ color: '#999' }} />
          </Space>
        ))}
      </div>
    )}
  </Form.List>
);

// ============================================================
// 主组件
// ============================================================

const ServiceForm: React.FC<ServiceFormProps> = ({
  cloudId,
  namespacesOptions,
  onSuccess,
  onCancel,
  defaultNamespace,
  editMode = false,
  initialData,
}) => {
  const [form] = Form.useForm<ServiceFormValues>();
  const { message } = App.useApp();
  const [loading, setLoading] = useState(false);
  const [serviceType, setServiceType] = useState<string>('ClusterIP');

  // 从初始数据提取表单值（编辑模式）
  const extractFormValues = (data: any): Partial<ServiceFormValues> => {
    if (!data) return {};
    
    const metadata = data.metadata || {};
    const spec = data.spec || {};
    
    // 提取标签
    const labels = Object.entries(metadata.labels || {}).map(([key, value]) => ({
      key,
      value: value as string,
    }));
    
    // 提取选择器
    const selector = Object.entries(spec.selector || {}).map(([key, value]) => ({
      key,
      value: value as string,
    }));
    
    // 提取端口
    const ports = (spec.ports || []).map((p: any) => ({
      name: p.name || '',
      protocol: p.protocol || 'TCP',
      port: p.port,
      targetPort: p.targetPort,
      nodePort: p.nodePort,
    }));
    
    return {
      name: metadata?.annotations?.['tower.io/alias'] || metadata.name || '',
      namespace: metadata.namespace || '',
      labels,
      selector,
      ports,
      type: spec.type || 'ClusterIP',
      externalName: spec.externalName,
      clusterIP: spec.clusterIP,
    };
  };

  // 初始化默认命名空间或编辑数据
  useEffect(() => {
    if (editMode && initialData) {
      // 编辑模式：从初始数据填充表单
      const values = extractFormValues(initialData);
      form.setFieldsValue(values);
      setServiceType(values.type || 'ClusterIP');
    } else {
      // 创建模式：设置默认命名空间
      const defaultNs = defaultNamespace || namespacesOptions[0] || 'default';
      form.setFieldValue('namespace', defaultNs);
    }
  }, [defaultNamespace, namespacesOptions, form, editMode, initialData]);

  // 监听 Service 类型变化
  const handleTypeChange = (value: string) => {
    setServiceType(value);
    // ExternalName 类型不需要端口配置
    if (value === 'ExternalName') {
      form.setFieldValue('ports', []);
    }
  };

  // 构建提交数据
  const buildSubmitData = (values: ServiceFormValues, isEdit: boolean): any => {
    const baseResource = {
      apiVersion: 'v1',
      kind: 'Service',
      metadata: {
        name: isEdit ? initialData?.metadata?.name : generateHarvesterCrMetadataName('service'),
        namespace: values.namespace,
        labels: values.labels?.reduce((acc, { key, value }) => {
          if (key && value) acc[key] = value;
          return acc;
        }, {} as Record<string, string>),
        annotations: {
          ...(isEdit ? initialData?.metadata?.annotations : {}),
          'tower.io/alias': values.name,
        },
      },
    };

    // 构建选择器
    const selector = values.selector?.reduce((acc, { key, value }) => {
      if (key && value) acc[key] = value;
      return acc;
    }, {} as Record<string, string>);

    // 根据类型构建不同的 spec
    if (values.type === 'ExternalName') {
      return {
        ...baseResource,
        spec: {
          type: 'ExternalName',
          externalName: values.externalName,
        },
      };
    }

    // 构建端口配置
    const ports = values.ports?.map((p, index) => {
      const portSpec: any = {
        name: p.name || `port-${index}`,
        protocol: p.protocol || 'TCP',
        port: p.port,
        targetPort: typeof p.targetPort === 'number' ? p.targetPort : parseInt(p.targetPort) || p.targetPort,
      };
      if (values.type === 'NodePort' && p.nodePort) {
        portSpec.nodePort = p.nodePort;
      }
      return portSpec;
    });

    const spec: any = {
      type: values.type,
      selector: selector,
      ports: ports,
    };

    // ClusterIP 为 None 表示 Headless Service
    if (values.clusterIP) {
      spec.clusterIP = values.clusterIP;
    }

    return {
      ...baseResource,
      spec,
    };
  };

  // 提交表单
  const handleSubmit = async () => {
    try {
      const values = await form.validateFields();
      setLoading(true);

      const submitData = buildSubmitData(values, editMode);

      if (editMode) {
        // 编辑模式：保留 resourceVersion 以支持更新
        if (initialData?.metadata?.resourceVersion) {
          submitData.metadata.resourceVersion = initialData.metadata.resourceVersion;
        }
        await updateHarvesterService(cloudId, values.namespace, initialData?.metadata?.name, submitData);
        message.success('Service 更新成功');
      } else {
        // 创建模式
        await createHarvesterService(cloudId, values.namespace, submitData);
        message.success('Service 创建成功');
      }
      onSuccess();
    } catch (error: any) {
      console.error('[ServiceForm] 提交失败:', error);
      const errorMsg = error?.response?.data?.message || error?.message || '操作失败';
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
        name: generateVmWizardStyleDisplayName('svc'),
        type: 'ClusterIP',
        labels: [],
        selector: [],
        ports: [{ protocol: 'TCP' }],
      }}
    >
      {/* 基本信息 */}
      <Card title="基本信息" size="small" style={{ marginBottom: 16 }}>
        <Row gutter={16}>
          <Col span={12}>
            {editMode ? (
              <>
                <Form.Item label="资源 ID">
                  <Input 
                    value={initialData?.metadata?.name || ''} 
                    disabled 
                    style={{ color: 'rgba(0,0,0,0.45)' }}
                  />
                </Form.Item>
                <Form.Item
                  name="name"
                  label="显示名称"
                  rules={[{ required: true, message: '请输入显示名称' }]}
                >
                  <Input placeholder="如: my-service" />
                </Form.Item>
              </>
            ) : (
              <Form.Item
                name="name"
                label="名称"
                rules={[
                  { required: true, message: '请输入名称' },
                  { pattern: /^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/, message: '只允许小写字母、数字和连字符' },
                ]}
              >
                <Input placeholder="如: my-service" />
              </Form.Item>
            )}
          </Col>
          <Col span={12}>
            <Form.Item
              name="namespace"
              label="命名空间"
              rules={[{ required: true, message: '请选择命名空间' }]}
            >
              <Select
                placeholder="选择命名空间"
                showSearch
                disabled={editMode}
                options={namespacesOptions.filter(ns => !isSystemNamespace(ns)).map(ns => ({ label: ns, value: ns }))}
              />
            </Form.Item>
          </Col>
        </Row>
        <KeyValueEditor
          name="labels"
          label="标签"
          tooltip="Service 的标签，用于标识和筛选"
        />
      </Card>

      {/* Service 类型配置 */}
      <Card title="Service 配置" size="small" style={{ marginBottom: 16 }}>
        <Row gutter={16}>
          <Col span={12}>
            <Form.Item
              name="type"
              label="Service 类型"
              rules={[{ required: true, message: '请选择类型' }]}
            >
              <Select options={SERVICE_TYPE_OPTIONS} onChange={handleTypeChange} />
            </Form.Item>
          </Col>
          {serviceType === 'ClusterIP' && (
            <Col span={12}>
              <Form.Item
                name="clusterIP"
                label={
                  <span>
                    ClusterIP
                    <Tooltip title="设置为 'None' 可创建 Headless Service">
                      <InfoCircleOutlined style={{ marginLeft: 4, color: '#999' }} />
                    </Tooltip>
                  </span>
                }
              >
                <Input placeholder="留空自动分配，或输入 'None'" />
              </Form.Item>
            </Col>
          )}
        </Row>

        {/* ExternalName 配置 */}
        {serviceType === 'ExternalName' && (
          <Alert
            type="info"
            showIcon
            style={{ marginBottom: 16 }}
            message="ExternalName 类型将 Service 映射到外部 DNS 名称"
          />
        )}
        {serviceType === 'ExternalName' && (
          <Form.Item
            name="externalName"
            label="外部名称"
            rules={[{ required: true, message: '请输入外部 DNS 名称' }]}
          >
            <Input placeholder="如: external.example.com" />
          </Form.Item>
        )}

        {/* 选择器配置 */}
        {serviceType !== 'ExternalName' && (
          <KeyValueEditor
            name="selector"
            label="选择器"
            tooltip="用于选择后端 Pod，必须与 Pod 的标签匹配"
          />
        )}
      </Card>

      {/* 端口配置 */}
      {serviceType !== 'ExternalName' && (
        <Card title="端口配置" size="small" style={{ marginBottom: 16 }}>
          <Form.List name="ports">
            {(fields, { add, remove }) => (
              <>
                {fields.map(({ key, name: index, ...restField }) => (
                  <Card
                    key={key}
                    size="small"
                    style={{ marginBottom: 8, background: '#fafafa' }}
                    title={`端口 ${index + 1}`}
                    extra={
                      <Button
                        type="text"
                        danger
                        size="small"
                        icon={<MinusCircleOutlined />}
                        onClick={() => remove(index)}
                      >
                        删除
                      </Button>
                    }
                  >
                    <Row gutter={16}>
                      <Col span={6}>
                        <Form.Item
                          {...restField}
                          name={[index, 'name']}
                          label="名称"
                        >
                          <Input placeholder="如: http" />
                        </Form.Item>
                      </Col>
                      <Col span={6}>
                        <Form.Item
                          {...restField}
                          name={[index, 'protocol']}
                          label="协议"
                          initialValue="TCP"
                        >
                          <Select options={PROTOCOL_OPTIONS} />
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
                          name={[index, 'targetPort']}
                          label="目标端口"
                          rules={[{ required: true, message: '请输入目标端口' }]}
                        >
                          <Input placeholder="80 或 http" />
                        </Form.Item>
                      </Col>
                    </Row>
                    {serviceType === 'NodePort' && (
                      <Row gutter={16}>
                        <Col span={8}>
                          <Form.Item
                            {...restField}
                            name={[index, 'nodePort']}
                            label={
                              <span>
                                NodePort
                                <Tooltip title="节点端口范围: 30000-32767，留空自动分配">
                                  <InfoCircleOutlined style={{ marginLeft: 4, color: '#999' }} />
                                </Tooltip>
                              </span>
                            }
                          >
                            <InputNumber
                              min={30000}
                              max={32767}
                              placeholder="自动分配"
                              style={{ width: '100%' }}
                            />
                          </Form.Item>
                        </Col>
                      </Row>
                    )}
                  </Card>
                ))}
                <Button type="dashed" onClick={() => add({ protocol: 'TCP' })} block icon={<PlusOutlined />}>
                  添加端口
                </Button>
              </>
            )}
          </Form.List>
        </Card>
      )}

      {/* 操作按钮 */}
      <div style={{ textAlign: 'right' }}>
        <Space>
          <Button onClick={onCancel}>取消</Button>
          <Button type="primary" onClick={handleSubmit} loading={loading}>
            {editMode ? '更新' : '创建'}
          </Button>
        </Space>
      </div>
    </Form>
  );
};

export default ServiceForm;
