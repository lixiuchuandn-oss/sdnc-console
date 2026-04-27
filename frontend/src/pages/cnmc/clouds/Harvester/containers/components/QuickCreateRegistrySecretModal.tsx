/**
 * ==============================================================================
 * 模块名称: 快速创建镜像拉取凭证弹窗 (QuickCreateRegistrySecretModal)
 * 文件路径: frontend/src/pages/cnmc/clouds/Harvester/containers/components/QuickCreateRegistrySecretModal.tsx
 * ==============================================================================
 * 
 * [功能描述]
 * 用于在工作负载创建表单中快速创建镜像拉取凭证 (imagePullSecrets) 的弹窗组件。
 * 创建 kubernetes.io/dockerconfigjson 类型的 Secret，用于从私有镜像仓库拉取镜像。
 * 
 * [使用场景]
 * - WorkloadForm 创建工作负载时快速创建镜像拉取凭证
 * - 无需离开当前表单即可创建所需的凭证
 */

import React, { useEffect, useState } from 'react';
import { Modal, Form, Input, Select, Button, Space, App, Card, Row, Col, Tooltip, Alert } from 'antd';
import {
  PlusOutlined,
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

export interface QuickCreateRegistrySecretModalProps {
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

interface RegistrySecretFormValues {
  name: string;
  namespace: string;
  server: string;
  username: string;
  password: string;
  email?: string;
}

// ============================================================
// 主组件
// ============================================================

const QuickCreateRegistrySecretModal: React.FC<QuickCreateRegistrySecretModalProps> = ({
  cloudId,
  namespacesOptions,
  defaultNamespace,
  visible,
  onSuccess,
  onCancel,
}) => {
  const [form] = Form.useForm<RegistrySecretFormValues>();
  const { message } = App.useApp();
  const [loading, setLoading] = useState(false);

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
    }
  }, [visible, form]);

  // 构建 Docker 配置 JSON
  const buildDockerConfigJson = (values: RegistrySecretFormValues): string => {
    const { server, username, password, email } = values;
    
    // 构建 auth 字段 (base64 编码的 username:password)
    const auth = btoa(`${username}:${password}`);
    
    // 构建完整的 dockerconfigjson 结构
    const dockerConfig = {
      auths: {
        [server]: {
          username,
          password,
          email: email || '',
          auth,
        },
      },
    };
    
    return JSON.stringify(dockerConfig);
  };

  // 构建提交数据
  const buildSubmitData = (values: RegistrySecretFormValues): any => {
    const dockerConfigJson = buildDockerConfigJson(values);
    
    return {
      apiVersion: 'v1',
      kind: 'Secret',
      metadata: {
        name: values.name,
        namespace: values.namespace,
      },
      type: 'kubernetes.io/dockerconfigjson',
      stringData: {
        '.dockerconfigjson': dockerConfigJson,
      },
    };
  };

  // 提交表单
  const handleSubmit = async () => {
    try {
      const values = await form.validateFields();
      setLoading(true);

      const submitData = buildSubmitData(values);
      await createHarvesterSecret(cloudId, values.namespace, submitData);
      message.success('镜像拉取凭证创建成功');
      
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
      title="快速创建镜像拉取凭证"
      open={visible}
      onCancel={onCancel}
      width={550}
      footer={null}
      destroyOnClose
      maskClosable={false}
    >
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        message="创建 kubernetes.io/dockerconfigjson 类型的 Secret，用于从私有镜像仓库拉取镜像"
      />
      
      <Form
        form={form}
        layout="vertical"
        initialValues={{
          namespace: defaultNamespace,
        }}
      >
        {/* 基本信息 */}
        <Card title="基本信息" size="small" style={{ marginBottom: 16 }}>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item
                name="name"
                label="凭证名称"
                rules={[
                  { required: true, message: '请输入凭证名称' },
                  { pattern: /^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/, message: '只允许小写字母、数字和连字符' },
                ]}
              >
                <Input placeholder="如: harbor-registry" />
              </Form.Item>
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
                  options={namespacesOptions.filter((ns) => !isSystemNamespace(ns)).map((ns) => ({ label: ns, value: ns }))}
                />
              </Form.Item>
            </Col>
          </Row>
        </Card>

        {/* 仓库认证信息 */}
        <Card
          title={
            <span>
              <LockOutlined style={{ marginRight: 8 }} />
              仓库认证信息
            </span>
          }
          size="small"
          style={{ marginBottom: 16 }}
        >
          <Form.Item
            name="server"
            label={
              <span>
                仓库地址
                <Tooltip title="镜像仓库服务器地址，如: registry.example.com 或 harbor.example.com:5000">
                  <InfoCircleOutlined style={{ marginLeft: 4, color: '#999' }} />
                </Tooltip>
              </span>
            }
            rules={[
              { required: true, message: '请输入仓库地址' },
            ]}
          >
            <Input placeholder="如: registry.example.com" />
          </Form.Item>
          
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item
                name="username"
                label="用户名"
                rules={[{ required: true, message: '请输入用户名' }]}
              >
                <Input placeholder="镜像仓库用户名" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item
                name="password"
                label="密码"
                rules={[{ required: true, message: '请输入密码' }]}
              >
                <Input.Password
                  placeholder="镜像仓库密码"
                  visibilityToggle
                  iconRender={(visible) =>
                    visible ? <EyeOutlined /> : <EyeInvisibleOutlined />
                  }
                />
              </Form.Item>
            </Col>
          </Row>
          
          <Form.Item
            name="email"
            label={
              <span>
                邮箱
                <span style={{ color: '#999', fontSize: 12, marginLeft: 4 }}>(可选)</span>
              </span>
            }
          >
            <Input placeholder="user@example.com" />
          </Form.Item>
        </Card>

        {/* 操作按钮 */}
        <div style={{ textAlign: 'right' }}>
          <Space>
            <Button onClick={onCancel}>取消</Button>
            <Button type="primary" onClick={handleSubmit} loading={loading}>
              创建凭证
            </Button>
          </Space>
        </div>
      </Form>
    </Modal>
  );
};

export default QuickCreateRegistrySecretModal;
