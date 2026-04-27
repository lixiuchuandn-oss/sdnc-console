/**
 * ==============================================================================
 * 模块名称: 快速创建 Secret 弹窗 (QuickCreateSecretModal)
 * 文件路径: frontend/src/pages/cnmc/clouds/Harvester/containers/components/QuickCreateSecretModal.tsx
 * ==============================================================================
 * 
 * [功能描述]
 * 用于在工作负载创建表单中快速创建 Secret 的弹窗组件。
 * 无需离开当前表单即可创建所需的 Secret 资源。
 * 
 * [使用场景]
 * - WorkloadForm 创建工作负载时快速创建 Secret
 * - 配置敏感环境变量时快速创建
 * - 配置存储卷时快速创建 Secret
 */

import React, { useRef, useCallback, useEffect, useState } from 'react';
import { Modal, Form, Input, Select, Button, Space, App, Card, Row, Col, Tooltip, Alert, Spin } from 'antd';
import {
  PlusOutlined,
  MinusCircleOutlined,
  InfoCircleOutlined,
  LockOutlined,
  EyeOutlined,
  EyeInvisibleOutlined,
} from '@ant-design/icons';
import { createHarvesterSecret } from '../../../../../../services/harvesterApi';
import { isSystemNamespace } from '../../../../../../utils/harvesterUtils';

// ============================================================
// 类型定义
// ============================================================

export interface QuickCreateSecretModalProps {
  /** 云环境 ID */
  cloudId: string;
  /** 命名空间选项列表 */
  namespacesOptions: string[];
  /** 默认命名空间 */
  defaultNamespace?: string;
  /** 弹窗是否可见 */
  visible: boolean;
  /** 创建成功回调，返回创建的 Secret 信息 */
  onSuccess: (secret: { name: string; namespace: string }) => void;
  /** 取消回调 */
  onCancel: () => void;
}

interface SecretFormValues {
  name: string;
  namespace: string;
  labels: Array<{ key: string; value: string }>;
  type: string;
  stringData: Array<{ key: string; value: string }>;
}

// ============================================================
// 常量定义
// ============================================================

const SECRET_TYPE_OPTIONS = [
  { value: 'Opaque', label: 'Opaque (通用密钥)' },
  { value: 'kubernetes.io/basic-auth', label: 'Basic Auth' },
  { value: 'kubernetes.io/ssh-auth', label: 'SSH Auth' },
  { value: 'kubernetes.io/tls', label: 'TLS 证书' },
];

const SECRET_TYPE_REQUIRED_KEYS: Record<string, Array<{ key: string; label: string; placeholder: string; required: boolean }>> = {
  'Opaque': [],
  'kubernetes.io/basic-auth': [
    { key: 'username', label: '用户名', placeholder: '请输入用户名', required: true },
    { key: 'password', label: '密码', placeholder: '请输入密码', required: true },
  ],
  'kubernetes.io/ssh-auth': [
    { key: 'ssh-privatekey', label: 'SSH 私钥', placeholder: '请输入 SSH 私钥内容', required: true },
  ],
  'kubernetes.io/tls': [
    { key: 'tls.crt', label: 'TLS 证书', placeholder: '请输入 TLS 证书内容（PEM 格式）', required: true },
    { key: 'tls.key', label: 'TLS 私钥', placeholder: '请输入 TLS 私钥内容（PEM 格式）', required: true },
  ],
};

// ============================================================
// 子组件: 标签编辑器
// ============================================================

const LabelsEditor: React.FC = () => (
  <Form.List name="labels">
    {(fields, { add, remove }) => (
      <div>
        <div style={{ marginBottom: 8 }}>
          <Space>
            <span style={{ fontWeight: 500 }}>标签</span>
            <Tooltip title="Secret 的标签，用于标识和筛选">
              <InfoCircleOutlined style={{ color: '#999' }} />
            </Tooltip>
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
              <Input placeholder="值 (如: myapp)" style={{ width: 150 }} />
            </Form.Item>
            <MinusCircleOutlined onClick={() => remove(index)} style={{ color: '#999' }} />
          </Space>
        ))}
      </div>
    )}
  </Form.List>
);

// ============================================================
// 子组件: 数据编辑器
// ============================================================

interface DataEditorProps {
  secretType: string;
}

const DataEditor: React.FC<DataEditorProps> = ({ secretType }) => {
  const requiredKeys = SECRET_TYPE_REQUIRED_KEYS[secretType] || [];
  const isOpaqueType = secretType === 'Opaque';
  const form = Form.useFormInstance();

  return (
    <Form.List name="stringData">
      {(fields, { add, remove }) => (
        <div>
          <div style={{ marginBottom: 12 }}>
            <Space>
              <span style={{ fontWeight: 500 }}>
                <LockOutlined style={{ marginRight: 4 }} />
                数据内容
              </span>
              <Tooltip title="Secret 数据会被自动编码为 Base64 格式存储">
                <InfoCircleOutlined style={{ color: '#999' }} />
              </Tooltip>
              {isOpaqueType && (
                <Button type="dashed" size="small" onClick={() => add()} icon={<PlusOutlined />}>
                  添加数据项
                </Button>
              )}
            </Space>
          </div>
          {fields.length === 0 && isOpaqueType && (
            <Alert
              type="info"
              showIcon
              message="暂无数据项，请点击上方按钮添加"
              style={{ marginBottom: 12 }}
            />
          )}
          {!isOpaqueType && requiredKeys.length > 0 && (
            <Alert
              type="warning"
              showIcon
              style={{ marginBottom: 12 }}
              message={`${SECRET_TYPE_OPTIONS.find(o => o.value === secretType)?.label || secretType} 类型需要以下必需字段`}
            />
          )}
          {fields.map(({ key, name: index, ...restField }) => {
            const requiredKeyInfo = !isOpaqueType ? requiredKeys[index] : null;

            return (
              <Card
                key={key}
                size="small"
                style={{ marginBottom: 8, background: '#fafafa' }}
                title={requiredKeyInfo ? requiredKeyInfo.label : `数据项 ${index + 1}`}
                extra={
                  isOpaqueType && (
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
                  <Col span={isOpaqueType ? 8 : 0}>
                    {isOpaqueType && (
                      <Form.Item
                        {...restField}
                        name={[index, 'key']}
                        label="键名"
                        rules={[
                          { required: true, message: '请输入键名' },
                          { pattern: /^[a-zA-Z0-9_.-]+$/, message: '只允许字母、数字、下划线、点和连字符' },
                        ]}
                      >
                        <Input placeholder="如: password" />
                      </Form.Item>
                    )}
                  </Col>
                  <Col span={isOpaqueType ? 16 : 24}>
                    <Form.Item
                      {...restField}
                      name={[index, 'value']}
                      label={isOpaqueType ? '值' : undefined}
                      rules={[{ required: true, message: '请输入值' }]}
                    >
                      {secretType === 'kubernetes.io/ssh-auth' || secretType === 'kubernetes.io/tls' ? (
                        <Input.TextArea
                          placeholder={requiredKeyInfo?.placeholder || '请输入内容'}
                          rows={6}
                          style={{ fontFamily: 'monospace' }}
                        />
                      ) : (
                        <Input.Password
                          placeholder={requiredKeyInfo?.placeholder || '密钥值...'}
                          visibilityToggle
                          iconRender={(visible) =>
                            visible ? <EyeOutlined /> : <EyeInvisibleOutlined />
                          }
                        />
                      )}
                    </Form.Item>
                  </Col>
                </Row>
              </Card>
            );
          })}
          {fields.length > 0 && isOpaqueType && (
            <Button type="dashed" onClick={() => add()} block icon={<PlusOutlined />}>
              添加数据项
            </Button>
          )}
        </div>
      )}
    </Form.List>
  );
};

// ============================================================
// 主组件
// ============================================================

const QuickCreateSecretModal: React.FC<QuickCreateSecretModalProps> = ({
  cloudId,
  namespacesOptions,
  defaultNamespace,
  visible,
  onSuccess,
  onCancel,
}) => {
  const [form] = Form.useForm<SecretFormValues>();
  const { message } = App.useApp();
  const [loading, setLoading] = useState(false);
  const [secretType, setSecretType] = useState<string>('Opaque');

  // 初始化默认命名空间
  useEffect(() => {
    if (visible && defaultNamespace) {
      form.setFieldValue('namespace', defaultNamespace);
    }
  }, [visible, defaultNamespace, form]);

  // 重置表单
  useEffect(() => {
    if (!visible) {
      form.resetFields();
      setSecretType('Opaque');
    }
  }, [visible, form]);

  // 监听类型变化
  const handleTypeChange = (newType: string) => {
    setSecretType(newType);
    const requiredKeys = SECRET_TYPE_REQUIRED_KEYS[newType] || [];
    if (requiredKeys.length > 0) {
      const stringData = requiredKeys.map(rk => ({
        key: rk.key,
        value: '',
      }));
      form.setFieldValue('stringData', stringData);
    } else {
      form.setFieldValue('stringData', []);
    }
  };

  // 构建提交数据
  const buildSubmitData = (values: SecretFormValues): any => {
    const stringData = values.stringData?.reduce((acc, { key, value }) => {
      if (key && value !== undefined) {
        acc[key] = value;
      }
      return acc;
    }, {} as Record<string, string>);

    return {
      apiVersion: 'v1',
      kind: 'Secret',
      metadata: {
        name: values.name,
        namespace: values.namespace,
        labels: values.labels?.reduce((acc, { key, value }) => {
          if (key && value) acc[key] = value;
          return acc;
        }, {} as Record<string, string>),
      },
      type: values.type,
      stringData,
    };
  };

  // 提交表单
  const handleSubmit = async () => {
    try {
      const values = await form.validateFields();
      setLoading(true);

      const submitData = buildSubmitData(values);
      await createHarvesterSecret(cloudId, values.namespace, submitData);
      message.success('Secret 创建成功');
      
      // 调用成功回调，返回创建的 Secret 信息
      onSuccess({
        name: values.name,
        namespace: values.namespace,
      });
    } catch (error: any) {
      const errorMsg = error?.response?.data?.message || error?.message || '创建失败';
      message.error(errorMsg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      title="快速创建 Secret"
      open={visible}
      onCancel={onCancel}
      width={600}
      footer={null}
      destroyOnClose
      maskClosable={false}
    >
      <Form
        form={form}
        layout="vertical"
        initialValues={{
          type: 'Opaque',
          labels: [],
          stringData: [],
        }}
      >
        {/* 基本信息 */}
        <Card title="基本信息" size="small" style={{ marginBottom: 16 }}>
          <Row gutter={16}>
            <Col span={8}>
              <Form.Item
                name="name"
                label="名称"
                rules={[
                  { required: true, message: '请输入名称' },
                  { pattern: /^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/, message: '只允许小写字母、数字和连字符' },
                ]}
              >
                <Input placeholder="如: my-secret" />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item
                name="namespace"
                label="命名空间"
                rules={[{ required: true, message: '请选择命名空间' }]}
              >
                <Select
                  placeholder="选择命名空间"
                  showSearch
                  options={namespacesOptions.filter((ns) => !isSystemNamespace(ns)).map((ns) => ({ label: ns, value: ns }))}
                />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item
                name="type"
                label="类型"
                rules={[{ required: true, message: '请选择类型' }]}
              >
                <Select
                  options={SECRET_TYPE_OPTIONS}
                  placeholder="选择 Secret 类型"
                  onChange={handleTypeChange}
                />
              </Form.Item>
            </Col>
          </Row>
          <LabelsEditor />
        </Card>

        {/* 数据内容 */}
        <Card
          title={
            <span>
              <LockOutlined style={{ marginRight: 8 }} />
              数据内容
            </span>
          }
          size="small"
          style={{ marginBottom: 16 }}
        >
          <Alert
            type="info"
            showIcon
            style={{ marginBottom: 16 }}
            message="Secret 数据会被自动编码为 Base64 格式存储，请直接输入明文值"
          />
          <DataEditor secretType={secretType} />
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
    </Modal>
  );
};

export default QuickCreateSecretModal;