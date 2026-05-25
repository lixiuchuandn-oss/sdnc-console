/**
 * ==============================================================================
 * 模块名称: Ingress 创建/编辑表单 (IngressForm)
 * 文件路径: frontend/src/pages/cnmc/clouds/Harvester/containers/components/IngressForm.tsx
 * ==============================================================================
 * 
 * [功能描述]
 * 用于创建或编辑 Kubernetes Ingress 资源的表单组件。
 * 
 * [模式说明]
 * - 创建模式：所有字段可编辑
 * - 编辑模式：名称、命名空间禁用，其他字段可编辑
 * 
 * [核心配置]
 * - 基本信息：名称、命名空间、标签
 * - Ingress Class：指定 Ingress 控制器
 * - TLS 配置：HTTPS 证书
 * - 路由规则：Host -> Path -> Backend 映射
 */

import React, { useState, useEffect, useMemo } from 'react';
import {
  Form,
  Input,
  Select,
  Button,
  Space,
  Divider,
  Row,
  Col,
  App,
  Card,
  Alert,
  Tooltip,
  Switch,
} from 'antd';
import {
  PlusOutlined,
  MinusCircleOutlined,
  InfoCircleOutlined,
  GlobalOutlined,
} from '@ant-design/icons';
import { createHarvesterIngress, updateHarvesterIngress } from '../../../../../../services/harvesterApi';
import { generateHarvesterCrMetadataName, generateVmWizardStyleDisplayName, isSystemNamespace, translateK8sError } from '../../../../../../utils/harvesterUtils';

// ============================================================
// 类型定义
// ============================================================

export interface IngressFormValues {
  name: string;
  namespace: string;
  labels: Array<{ key: string; value: string }>;
  ingressClassName?: string;
  rules: Array<{
    host: string;
    paths: Array<{
      path: string;
      pathType: 'Prefix' | 'Exact' | 'ImplementationSpecific';
      backend: {
        service: {
          name: string;
          port: {
            number?: number;
            name?: string;
          };
        };
      };
    }>;
  }>;
  tls: Array<{
    hosts: string[];
    secretName: string;
  }>;
  enableTls: boolean;
}

export interface IngressFormProps {
  cloudId: string;
  namespacesOptions: string[];
  secrets?: any[]; // 可用的 Secret 列表（用于 TLS）
  onSuccess: () => void;
  onCancel: () => void;
  defaultNamespace?: string;
  editMode?: boolean;
  initialData?: any;
}

// ============================================================
// 常量定义
// ============================================================

const PATH_TYPE_OPTIONS = [
  { value: 'Prefix', label: '前缀匹配 (Prefix)' },
  { value: 'Exact', label: '精确匹配 (Exact)' },
  { value: 'ImplementationSpecific', label: '由控制器决定 (ImplementationSpecific)' },
];

// ============================================================
// 子组件: 标签编辑器
// ============================================================

const LabelEditor: React.FC<{
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
              <Input placeholder="键" style={{ width: 150 }} />
            </Form.Item>
            <Form.Item
              {...restField}
              name={[index, 'value']}
              rules={[{ required: true, message: '请输入值' }]}
            >
              <Input placeholder="值" style={{ width: 150 }} />
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

const IngressForm: React.FC<IngressFormProps> = ({
  cloudId,
  namespacesOptions,
  secrets,
  onSuccess,
  onCancel,
  defaultNamespace,
  editMode,
  initialData,
}) => {
  const [form] = Form.useForm<IngressFormValues>();
  const { message } = App.useApp();
  const [loading, setLoading] = useState(false);
  const [enableTls, setEnableTls] = useState(false);

  // 初始化默认命名空间
  useEffect(() => {
    if (defaultNamespace) {
      form.setFieldValue('namespace', defaultNamespace);
    }
  }, [defaultNamespace, form]);

  // 编辑模式：初始化表单数据
  useEffect(() => {
    if (editMode && initialData) {
      const metadata = initialData.metadata || {};
      const spec = initialData.spec || {};
      
      // 解析标签
      const labels = Object.entries(metadata.labels || {}).map(([key, value]) => ({
        key,
        value: String(value),
      }));
      
      // 解析规则
      const rules = (spec.rules || []).map((rule: any) => ({
        host: rule.host || '',
        paths: (rule.http?.paths || []).map((p: any) => ({
          path: p.path || '',
          pathType: p.pathType || 'Prefix',
          backend: {
            service: {
              name: p.backend?.service?.name || '',
              port: {
                number: p.backend?.service?.port?.number,
                name: p.backend?.service?.port?.name,
              },
            },
          },
        })),
      }));
      
      // 解析 TLS
      const tls = (spec.tls || []).map((t: any) => ({
        hosts: t.hosts || [],
        secretName: t.secretName || '',
      }));
      
      const hasTls = tls.length > 0;
      setEnableTls(hasTls);
      
      form.setFieldsValue({
        name: metadata?.annotations?.['tower.io/alias'] || metadata.name,
        namespace: metadata.namespace,
        labels,
        ingressClassName: spec.ingressClassName,
        rules: rules.length > 0 ? rules : [{ host: '', paths: [{ path: '/', pathType: 'Prefix', backend: { service: { name: '', port: {} } } }] }],
        tls,
        enableTls: hasTls,
      });
    }
  }, [editMode, initialData, form]);

  // 构建提交数据
  const buildSubmitData = (values: IngressFormValues, isEdit: boolean): any => {
    const ingress: any = {
      apiVersion: 'networking.k8s.io/v1',
      kind: 'Ingress',
      metadata: {
        name: isEdit ? initialData?.metadata?.name : generateHarvesterCrMetadataName('ingress'),
        namespace: values.namespace,
        annotations: {
          ...(isEdit ? initialData?.metadata?.annotations : {}),
          'tower.io/alias': values.name,
        },
        labels: values.labels?.reduce((acc, { key, value }) => {
          if (key && value) acc[key] = value;
          return acc;
        }, {} as Record<string, string>),
      },
      spec: {},
    };

    // Ingress Class
    if (values.ingressClassName) {
      ingress.spec.ingressClassName = values.ingressClassName;
    }

    // 构建规则
    const rules = values.rules?.map((rule) => {
      const ruleSpec: any = {};
      if (rule.host) {
        ruleSpec.host = rule.host;
      }
      ruleSpec.http = {
        paths: rule.paths?.map((p) => {
          const portNumber = p.backend?.service?.port?.number;
          const portName = p.backend?.service?.port?.name;
          const parsedPort = portNumber ? parseInt(String(portNumber), 10) : null;

          // 确保 port 对象有效
          let port: any = {};
          if (parsedPort && !isNaN(parsedPort)) {
            port = { number: parsedPort };
          } else if (portName) {
            port = { name: portName };
          } else {
            port = { number: 80 }; // 默认端口
          }

          return {
            path: p.path || '/',
            pathType: p.pathType || 'Prefix',
            backend: {
              service: {
                name: p.backend?.service?.name,
                port,
              },
            },
          };
        }),
      };
      return ruleSpec;
    }).filter((r) => r.http?.paths?.length > 0);

    if (rules?.length > 0) {
      ingress.spec.rules = rules;
    }

    // TLS 配置
    if (enableTls && values.tls?.length > 0) {
      ingress.spec.tls = values.tls
        .filter((t) => t.secretName)
        .map((t) => ({
          hosts: t.hosts?.filter(Boolean) || [],
          secretName: t.secretName,
        }));
    }

    return ingress;
  };

  // 提交表单
  const handleSubmit = async () => {
    try {
      const values = await form.validateFields();
      setLoading(true);

      const submitData = buildSubmitData(values, !!editMode);

      if (editMode) {
        // 编辑模式：保留必要的元数据
        if (initialData?.metadata) {
          submitData.metadata.uid = initialData.metadata.uid;
          submitData.metadata.resourceVersion = initialData.metadata.resourceVersion;
          submitData.metadata.creationTimestamp = initialData.metadata.creationTimestamp;
        }
        await updateHarvesterIngress(cloudId, values.namespace, initialData?.metadata?.name, submitData);
        message.success('Ingress 更新成功');
      } else {
        // 创建模式
        await createHarvesterIngress(cloudId, values.namespace, submitData);
        message.success('Ingress 创建成功');
      }
      onSuccess();
    } catch (error: any) {
      const errorMsg = translateK8sError(error);
      message.error(`${editMode ? '更新' : '创建'} Ingress 失败: ${errorMsg}`);
    } finally {
      setLoading(false);
    }
  };

  // 获取当前命名空间下的 TLS Secret 选项
  const currentNamespace = Form.useWatch('namespace', form);
  const tlsSecretOptions = useMemo(() => {
    if (!secrets || !currentNamespace) return [];
    return secrets
      .filter((s: any) => {
        const ns = s.metadata?.namespace || s.namespace;
        const type = s.type || s.rawData?.type;
        return ns === currentNamespace && type === 'kubernetes.io/tls';
      })
      .map((s: any) => ({
        label: s.metadata?.name || s.name,
        value: s.metadata?.name || s.name,
      }));
  }, [secrets, currentNamespace]);

  return (
    <Form
      form={form}
      layout="vertical"
      initialValues={{
        name: generateVmWizardStyleDisplayName('ing'),
        labels: [],
        rules: [{ host: '', paths: [{ pathType: 'Prefix', backend: { service: { name: '', port: {} } } }] }],
        tls: [],
        enableTls: false,
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
                  <Input placeholder="如: my-ingress" />
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
                <Input placeholder="如: my-ingress" />
              </Form.Item>
            )}
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
                disabled={editMode}
                options={namespacesOptions.filter(ns => !isSystemNamespace(ns)).map(ns => ({ label: ns, value: ns }))}
              />
            </Form.Item>
          </Col>
        </Row>
        <Row gutter={16}>
          <Col span={12}>
            <Form.Item
              name="ingressClassName"
              label={
                <span>
                  Ingress Class
                  <Tooltip title="指定使用的 Ingress 控制器，留空使用默认">
                    <InfoCircleOutlined style={{ marginLeft: 4, color: '#999' }} />
                  </Tooltip>
                </span>
              }
            >
              <Input placeholder="如: nginx" />
            </Form.Item>
          </Col>
        </Row>
        <LabelEditor name="labels" label="标签" />
      </Card>

      {/* 路由规则配置 */}
      <Card title="路由规则" size="small" style={{ marginBottom: 16 }}>
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
          message="配置 HTTP 路由规则，将外部请求转发到后端 Service"
        />

        <Form.List name="rules">
          {(ruleFields, { add: addRule, remove: removeRule }) => (
            <>
              {ruleFields.map(({ key: ruleKey, name: ruleIndex, ...ruleRest }) => (
                <Card
                  key={ruleKey}
                  size="small"
                  style={{ marginBottom: 12, background: '#fafafa' }}
                  title={`规则 ${ruleIndex + 1}`}
                  extra={
                    ruleFields.length > 1 && (
                      <Button
                        type="text"
                        danger
                        size="small"
                        onClick={() => removeRule(ruleIndex)}
                      >
                        删除规则
                      </Button>
                    )
                  }
                >
                  {/* Host 输入行 */}
                  <Form.Item
                    {...ruleRest}
                    name={[ruleIndex, 'host']}
                    label="主机名"
                    style={{ marginBottom: 12 }}
                  >
                    <Input placeholder="如: example.com，留空表示默认规则" />
                  </Form.Item>

                  {/* 路径列表 */}
                  <Form.List name={[ruleIndex, 'paths']}>
                    {(pathFields, { add: addPath, remove: removePath }) => (
                      <>
                        {pathFields.map(({ key: pathKey, name: pathIndex, ...pathRest }) => (
                          <Row key={pathKey} gutter={8} style={{ marginBottom: 8 }}>
                            <Col span={7}>
                              <Form.Item
                                {...pathRest}
                                name={[pathIndex, 'path']}
                                rules={[{ required: true, message: '请输入路径' }]}
                                style={{ marginBottom: 0 }}
                              >
                                <Input placeholder="路径 (如: /api)" />
                              </Form.Item>
                            </Col>
                            <Col span={7}>
                              <Form.Item
                                {...pathRest}
                                name={[pathIndex, 'pathType']}
                                style={{ marginBottom: 0 }}
                              >
                                <Select options={PATH_TYPE_OPTIONS} />
                              </Form.Item>
                            </Col>
                            <Col span={5}>
                              <Form.Item
                                {...pathRest}
                                name={[pathIndex, 'backend', 'service', 'name']}
                                rules={[{ required: true, message: 'Service 名称' }]}
                                style={{ marginBottom: 0 }}
                              >
                                <Input placeholder="Service 名称" />
                              </Form.Item>
                            </Col>
                            <Col span={5}>
                              <Form.Item
                                {...pathRest}
                                name={[pathIndex, 'backend', 'service', 'port', 'number']}
                                style={{ marginBottom: 0 }}
                              >
                                <Input
                                  placeholder="端口"
                                  suffix={
                                    pathFields.length > 1 && (
                                      <MinusCircleOutlined
                                        onClick={() => removePath(pathIndex)}
                                        style={{ color: '#999', cursor: 'pointer' }}
                                      />
                                    )
                                  }
                                />
                              </Form.Item>
                            </Col>
                          </Row>
                        ))}
                        <Button
                          type="dashed"
                          onClick={() => addPath({ pathType: 'Prefix', backend: { service: { name: '', port: {} } } })}
                          block
                          icon={<PlusOutlined />}
                          size="small"
                        >
                          添加路径
                        </Button>
                      </>
                    )}
                  </Form.List>
                </Card>
              ))}
              <Button
                type="dashed"
                onClick={() => addRule({ host: '', paths: [{ pathType: 'Prefix', backend: { service: { name: '', port: {} } } }] })}
                block
                icon={<PlusOutlined />}
              >
                添加规则
              </Button>
            </>
          )}
        </Form.List>
      </Card>

      {/* TLS 配置 */}
      <Card title="TLS 配置" size="small" style={{ marginBottom: 16 }}>
        <Form.Item name="enableTls" label={null} valuePropName="checked">
          <Switch
            checkedChildren="启用 TLS"
            unCheckedChildren="禁用 TLS"
            onChange={setEnableTls}
          />
        </Form.Item>

        {enableTls && (
          <Alert
            type="warning"
            showIcon
            style={{ marginBottom: 16 }}
            message="需要预先创建 kubernetes.io/tls 类型的 Secret"
          />
        )}

        {enableTls && (
          <Form.List name="tls">
            {(tlsFields, { add: addTls, remove: removeTls }) => (
              <>
                {tlsFields.map(({ key: tlsKey, name: tlsIndex, ...tlsRest }) => (
                  <Card
                    key={tlsKey}
                    size="small"
                    style={{ marginBottom: 8, background: '#fff7e6' }}
                  >
                    <Row gutter={16}>
                      <Col span={12}>
                        <Form.Item
                          {...tlsRest}
                          name={[tlsIndex, 'secretName']}
                          label="TLS Secret"
                          rules={[{ required: true, message: '请选择 Secret' }]}
                        >
                          <Select
                            placeholder="选择 TLS Secret"
                            options={tlsSecretOptions}
                            showSearch
                          />
                        </Form.Item>
                      </Col>
                      <Col span={10}>
                        <Form.Item
                          {...tlsRest}
                          name={[tlsIndex, 'hosts']}
                          label="主机名列表"
                        >
                          <Select
                            mode="tags"
                            placeholder="输入主机名后回车添加"
                            tokenSeparators={[',']}
                          />
                        </Form.Item>
                      </Col>
                      <Col span={2}>
                        <Button
                          type="text"
                          danger
                          onClick={() => removeTls(tlsIndex)}
                        >
                          删除
                        </Button>
                      </Col>
                    </Row>
                  </Card>
                ))}
                <Button
                  type="dashed"
                  onClick={() => addTls()}
                  block
                  icon={<PlusOutlined />}
                >
                  添加 TLS 配置
                </Button>
              </>
            )}
          </Form.List>
        )}
      </Card>

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

export default IngressForm;
