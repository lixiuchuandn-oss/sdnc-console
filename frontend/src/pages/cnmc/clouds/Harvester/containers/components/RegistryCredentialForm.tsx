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

import React from 'react';
import {
  Form,
  Input,
  Select,
} from 'antd';
import {
  KeyOutlined,
  CloudServerOutlined,
  UserOutlined,
  LockOutlined,
  MailOutlined,
} from '@ant-design/icons';

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
    
    if (!data) {
      return null;
    }
    
    // 尝试 Base64 解码，如果失败则可能是已解码的 JSON 字符串
    let decoded: string;
    try {
      // 检查是否已经是 JSON 格式（以 { 开头）
      if (data.trim().startsWith('{')) {
        decoded = data;
      } else {
        decoded = atob(data);
      }
    } catch (base64Error) {
      // Base64 解码失败，尝试直接作为 JSON 解析
      decoded = data;
    }
    
    const config = JSON.parse(decoded);
    
    // 获取第一个仓库地址
    const servers = Object.keys(config.auths || {});
    if (servers.length === 0) {
      return null;
    }
    
    const server = servers[0];
    const authData = config.auths[server];
    
    // 解码 base64 编码的用户名密码 (格式: username:password)
    let username = '';
    let password = '';
    if (authData?.auth) {
      try {
        // 同样处理：可能已经是明文，也可能是 base64 编码
        let authDecoded: string;
        try {
          authDecoded = atob(authData.auth);
        } catch {
          authDecoded = authData.auth;
        }
        const colonIndex = authDecoded.indexOf(':');
        if (colonIndex > 0) {
          username = authDecoded.substring(0, colonIndex);
          password = authDecoded.substring(colonIndex + 1);
        }
      } catch {
        // 忽略解析错误
      }
    }
    
    return {
      name: metadata.annotations?.['tower.io/alias'] || metadata.name || '',
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
  // 注意：表单数据初始化由父组件 RegistryCredentialModal 的 useEffect 处理
  // 这里不再重复设置，避免冲突
  
  return (
    <Form
      form={form}
      layout="vertical"
      requiredMark="optional"
    >
      {isEditMode ? (
        <>
          <Form.Item label="资源 ID">
            <Input
              value={editData?.metadata?.name || ''}
              disabled
              style={{ color: 'rgba(0,0,0,0.45)' }}
            />
          </Form.Item>
          <Form.Item
            name="name"
            label="显示名称"
            rules={[
              { required: true, message: '请输入显示名称' },
            ]}
          >
            <Input
              placeholder="例如: harbor-registry-secret"
              prefix={<KeyOutlined />}
            />
          </Form.Item>
        </>
      ) : (
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
          />
        </Form.Item>
      )}
      
      <Form.Item
        name="namespace"
        label="项目"
        rules={[{ required: true, message: '请选择项目' }]}
      >
        <Select
          placeholder="选择项目"
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
