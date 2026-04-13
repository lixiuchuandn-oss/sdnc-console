/**
 * ==============================================================================
 * 模块名称: 镜像凭证表单 (RegistryCredentialForm)
 * 文件路径: frontend/src/pages/cnmc/clouds/Harvester/containers/components/RegistryCredentialForm.tsx
 * ==============================================================================
 * 
 * [功能描述]
 * 镜像拉取凭证创建/编辑表单组件，用于配置私有镜像仓库的认证信息。
 * 创建 kubernetes.io/dockerconfigjson 类型的 Secret。
 * 
 * [表单字段]
 * - 名称（name）：必填，Kubernetes 资源命名规范
 * - 命名空间（namespace）：必填，下拉选择
 * - 仓库地址（server）：必填，如 harbor.example.com 或 registry.local:5000
 * - 用户名（username）：必填
 * - 密码（password）：必填，密码框
 * - 邮箱（email）：可选
 */

import React, { useCallback } from 'react';
import {
  Form,
  Input,
  Select,
  Space,
  App,
} from 'antd';
import {
  KeyOutlined,
  CloudServerOutlined,
  UserOutlined,
  LockOutlined,
  MailOutlined,
} from '@ant-design/icons';
import {
  createHarvesterImagePullSecret,
  updateHarvesterImagePullSecret,
} from '../../../../../../services/harvesterApi';

// ============================================================
// 类型定义
// ============================================================

export interface RegistryCredentialFormValues {
  name: string;
  namespace: string;
  server: string;
  username: string;
  password: string;
  email?: string;
}

export interface RegistryCredentialFormProps {
  form: any;
  editData?: any; // 编辑模式：传入现有的 Secret 数据
  namespaces: string[];
  isEditMode?: boolean;
}

export interface RegistryCredentialFormRef {
  submit: () => Promise<void>;
}

// ============================================================
// 常量定义
// ============================================================

// Kubernetes 资源命名规范：小写字母、数字、连字符，开头结尾必须是字母或数字
const K8S_NAME_REGEX = /^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/;

// ============================================================
// 工具函数
// ============================================================

/**
 * 从 Secret 数据中解析仓库凭证信息
 */
const parseSecretData = (secret: any): Partial<RegistryCredentialFormValues> | null => {
  try {
    const metadata = secret?.metadata || {};
    const data = secret?.data?.['.dockerconfigjson'];
    
    if (!data) return null;
    
    // Base64 解码
    const decoded = atob(data);
    const config = JSON.parse(decoded);
    
    // 获取第一个仓库地址
    const servers = Object.keys(config.auths || {});
    if (servers.length === 0) return null;
    
    const server = servers[0];
    const authData = config.auths[server];
    
    // 解码 base64 编码的用户名密码 (格式: username:password)
    let username = '';
    let password = '';
    if (authData?.auth) {
      try {
        const decodedAuth = atob(authData.auth);
        const colonIndex = decodedAuth.indexOf(':');
        if (colonIndex > 0) {
          username = decodedAuth.substring(0, colonIndex);
          password = decodedAuth.substring(colonIndex + 1);
        }
      } catch {
        // 忽略解析错误
      }
    }
    
    return {
      name: metadata.name || '',
      namespace: metadata.namespace || 'default',
      server,
      username,
      password,
      email: authData?.email || '',
    };
  } catch (e) {
    console.error('解析 Secret 数据失败:', e);
    return null;
  }
};

// ============================================================
// 主组件
// ============================================================

const RegistryCredentialForm: React.FC<RegistryCredentialFormProps> = ({
  form,
  editData,
  namespaces,
  isEditMode = false,
}) => {
  const { message } = App.useApp();
  
  // 编辑模式：初始化表单数据
  React.useEffect(() => {
    if (editData) {
      const parsed = parseSecretData(editData);
      if (parsed) {
        form.setFieldsValue(parsed);
      }
    }
  }, [editData, form]);
  
  return (
    <Form
      form={form}
      layout="vertical"
      requiredMark="optional"
    >
      <Form.Item
        name="name"
        label="凭证名称"
        rules={[
          { required: true, message: '请输入凭证名称' },
          { 
            pattern: K8S_NAME_REGEX, 
            message: '名称只能包含小写字母、数字和连字符，且必须以字母或数字开头结尾' 
          },
          { max: 253, message: '名称最长 253 个字符' },
        ]}
        tooltip="凭证名称需符合 Kubernetes 资源命名规范：小写字母、数字、连字符"
      >
        <Input
          placeholder="例如: harbor-registry-secret"
          prefix={<KeyOutlined />}
          disabled={isEditMode}
        />
      </Form.Item>
      
      <Form.Item
        name="namespace"
        label="命名空间"
        rules={[{ required: true, message: '请选择命名空间' }]}
      >
        <Select
          placeholder="选择命名空间"
          showSearch
          optionFilterProp="label"
          disabled={isEditMode}
          options={namespaces.map((ns) => ({ label: ns, value: ns }))}
        />
      </Form.Item>
      
      <Form.Item
        name="server"
        label="仓库地址"
        rules={[
          { required: true, message: '请输入仓库地址' },
        ]}
        tooltip="镜像仓库服务器地址，不需要包含 https:// 前缀"
      >
        <Input
          placeholder="例如: harbor.example.com 或 registry.local:5000"
          prefix={<CloudServerOutlined />}
        />
      </Form.Item>
      
      <Form.Item
        name="username"
        label="用户名"
        rules={[{ required: true, message: '请输入用户名' }]}
      >
        <Input
          placeholder="镜像仓库用户名"
          prefix={<UserOutlined />}
          autoComplete="off"
        />
      </Form.Item>
      
      <Form.Item
        name="password"
        label="密码"
        rules={[{ required: true, message: '请输入密码' }]}
      >
        <Input.Password
          placeholder="镜像仓库密码"
          prefix={<LockOutlined />}
          autoComplete="new-password"
        />
      </Form.Item>
      
      <Form.Item
        name="email"
        label="邮箱"
        tooltip="可选字段，部分镜像仓库可能需要"
      >
        <Input
          placeholder="可选"
          prefix={<MailOutlined />}
        />
      </Form.Item>
    </Form>
  );
};

// ============================================================
// 导出
// ============================================================

export default RegistryCredentialForm;

// 导出工具函数供外部使用
export { parseSecretData };
