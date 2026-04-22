/**
 * ==============================================================================
 * 模块名称: Secret 创建/编辑表单 (SecretForm)
 * 文件路径: frontend/src/pages/cnmc/clouds/Harvester/containers/components/SecretForm.tsx
 * ==============================================================================
 * 
 * [功能描述]
 * 用于创建或编辑 Kubernetes Secret 资源的表单组件。
 * 支持两种模式：
 * - 创建模式：所有字段可编辑
 * - 编辑模式：名称、命名空间、类型禁用，数据可编辑
 * 
 * [安全特性]
 * - 密码输入框默认隐藏值
 * - 提供显示/隐藏切换
 * - 编辑模式下自动填充现有数据
 * 
 * [支持的 Secret 类型]
 * - Opaque: 通用密钥（默认）
 * - kubernetes.io/basic-auth: 基础认证
 * - kubernetes.io/ssh-auth: SSH 认证
 * - kubernetes.io/tls: TLS 证书
 */

import React, { useState, useEffect } from 'react';
import {
  Form,
  Input,
  Select,
  Button,
  Space,
  Row,
  Col,
  App,
  Card,
  Tooltip,
  Alert,
  Spin,
} from 'antd';
import {
  PlusOutlined,
  MinusCircleOutlined,
  InfoCircleOutlined,
  LockOutlined,
  EyeOutlined,
  EyeInvisibleOutlined,
} from '@ant-design/icons';
import {
  createHarvesterSecret,
  updateHarvesterSecret,
  fetchHarvesterSecretDetail,
} from '../../../../../../services/harvesterApi';
import { generateHarvesterCrMetadataName, generateVmWizardStyleDisplayName } from '../../../../../../utils/harvesterUtils';

// ============================================================
// 类型定义
// ============================================================

export interface SecretFormValues {
  name: string;
  namespace: string;
  labels: Array<{ key: string; value: string }>;
  type: string;
  stringData: Array<{ key: string; value: string }>;
}

export interface SecretFormProps {
  cloudId: string;
  namespacesOptions: string[];
  onSuccess: () => void;
  onCancel: () => void;
  defaultNamespace?: string;
  /** 编辑模式 */
  editMode?: boolean;
  /** 编辑模式下的初始数据（原始 Secret 对象） */
  initialData?: any;
}

// ============================================================
// 常量定义
// ============================================================

const SECRET_TYPE_OPTIONS = [
  { value: 'Opaque', label: 'Opaque (通用密钥)' },
  { value: 'kubernetes.io/basic-auth', label: 'Basic Auth' },
  { value: 'kubernetes.io/ssh-auth', label: 'SSH Auth' },
  { value: 'kubernetes.io/tls', label: 'TLS 证书' },
  // 注意: kubernetes.io/dockerconfigjson 类型由镜像仓库模块管理，这里不包含
];

// 各类型 Secret 必需的键名定义
const SECRET_TYPE_REQUIRED_KEYS: Record<string, Array<{ key: string; label: string; placeholder: string; required: boolean }>> = {
  'Opaque': [], // 无限制
  'kubernetes.io/basic-auth': [
    { key: 'username', label: '用户名', placeholder: '请输入用户名', required: true },
    { key: 'password', label: '密码', placeholder: '请输入密码', required: true },
  ],
  'kubernetes.io/ssh-auth': [
    { key: 'ssh-privatekey', label: 'SSH 私钥', placeholder: '请输入 SSH 私钥内容（以 -----BEGIN OPENSSH PRIVATE KEY----- 开头）', required: true },
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
// 子组件: 数据键值对编辑器（带密码隐藏）
// ============================================================

interface DataEditorProps {
  /** 当前选择的 Secret 类型 */
  secretType: string;
  /** 是否编辑模式 */
  editMode?: boolean;
}

const DataEditor: React.FC<DataEditorProps> = ({ secretType, editMode }) => {
  // 获取当前类型的必需键名
  const requiredKeys = SECRET_TYPE_REQUIRED_KEYS[secretType] || [];
  const isOpaqueType = secretType === 'Opaque';
  // 获取表单实例，用于读取字段值
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
              {/* 只有 Opaque 类型才允许自由添加数据项 */}
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
          {/* 非Opaque类型的提示 */}
          {!isOpaqueType && requiredKeys.length > 0 && (
            <Alert
              type="warning"
              showIcon
              style={{ marginBottom: 12 }}
              message={`${SECRET_TYPE_OPTIONS.find(o => o.value === secretType)?.label || secretType} 类型需要以下必需字段`}
            />
          )}
          {fields.map(({ key, name: index, ...restField }) => {
            // 对于非 Opaque 类型，根据索引获取对应的必需键信息
            // 因为我们在 handleTypeChange 中已经按照 requiredKeys 的顺序填充了数据
            const requiredKeyInfo = !isOpaqueType ? requiredKeys[index] : null;
            // 判断是否是新添加的项：编辑模式下，如果 key 为空，说明是新添加的
            const existingKey = form.getFieldValue(['stringData', index, 'key']);
            const isNewItem = editMode && !existingKey;

            return (
              <Card
                key={key}
                size="small"
                style={{ marginBottom: 8, background: '#fafafa' }}
                title={
                  requiredKeyInfo
                    ? requiredKeyInfo.label
                    : `数据项 ${index + 1}`
                }
                extra={
                  // 只有 Opaque 类型才允许删除
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
                    {/* Opaque 类型允许自定义键名 */}
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
                        <Input placeholder="如: password" disabled={editMode && !isNewItem} />
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
                        // SSH 私钥和 TLS 证书使用 TextArea
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

const SecretForm: React.FC<SecretFormProps> = ({
  cloudId,
  namespacesOptions,
  onSuccess,
  onCancel,
  defaultNamespace,
  editMode = false,
  initialData,
}) => {
  const [form] = Form.useForm<SecretFormValues>();
  const { message } = App.useApp();
  const [loading, setLoading] = useState(false);
  const [loadingData, setLoadingData] = useState(false); // 加载编辑数据的状态
  const [secretType, setSecretType] = useState<string>('Opaque');

  // 从 API 返回的数据提取表单值（编辑模式，已获取明文）
  const extractFormValuesFromApi = (data: any): Partial<SecretFormValues> => {
    if (!data) return {};

    const metadata = data.metadata || {};

    // 提取标签
    const labels = Object.entries(metadata.labels || {}).map(([key, value]) => ({
      key,
      value: value as string,
    }));

    // 提取数据 - API 返回的 stringData 是明文
    const stringData: Array<{ key: string; value: string }> = [];

    // 对于非 Opaque 类型，需要按照 SECRET_TYPE_REQUIRED_KEYS 的顺序排列
    // 因为 DataEditor 组件假设 stringData[index] 对应 requiredKeys[index]
    const secretType = data.type || 'Opaque';
    const requiredKeys = SECRET_TYPE_REQUIRED_KEYS[secretType] || [];

    if (data.stringData) {
      if (requiredKeys.length > 0) {
        // 非 Opaque 类型：按照 requiredKeys 的顺序添加
        requiredKeys.forEach((rk) => {
          if (data.stringData[rk.key] !== undefined) {
            stringData.push({ key: rk.key, value: data.stringData[rk.key] });
          }
        });
        // 添加其他可能存在的额外键（以防万一）
        Object.entries(data.stringData).forEach(([key, value]) => {
          if (!stringData.find(item => item.key === key)) {
            stringData.push({ key, value: value as string });
          }
        });
      } else {
        // Opaque 类型：直接遍历
        Object.entries(data.stringData).forEach(([key, value]) => {
          stringData.push({ key, value: value as string });
        });
      }
    }

    return {
      name: metadata.name || '',
      namespace: metadata.namespace || '',
      labels,
      type: data.type || 'Opaque',
      stringData,
    };
  };

  // 初始化默认命名空间或编辑数据
  useEffect(() => {
    if (editMode && initialData) {
      // 编辑模式：需要调用 API 获取明文数据
      const namespace = initialData?.metadata?.namespace;
      const name = initialData?.metadata?.name;
      
      if (namespace && name) {
        setLoadingData(true);
        fetchHarvesterSecretDetail(cloudId, namespace, name, true)
          .then((result) => {
            if (result?.data) {
              const values = extractFormValuesFromApi(result.data);
              form.setFieldsValue(values);
              setSecretType(values.type || 'Opaque');
            }
          })
          .catch((error) => {
            console.error('获取 Secret 详情失败:', error);
            message.error('获取 Secret 数据失败');
          })
          .finally(() => {
            setLoadingData(false);
          });
      }
    } else {
      // 创建模式：设置默认命名空间
      const defaultNs = defaultNamespace || namespacesOptions[0] || 'default';
      form.setFieldValue('namespace', defaultNs);
    }
  }, [defaultNamespace, namespacesOptions, form, editMode, initialData, cloudId, message]);

  // 监听类型变化，自动填充必需键名
  const handleTypeChange = (newType: string) => {
    setSecretType(newType);

    // 编辑模式下不自动填充（已有数据）
    if (editMode) return;

    const requiredKeys = SECRET_TYPE_REQUIRED_KEYS[newType] || [];
    if (requiredKeys.length > 0) {
      // 自动填充必需的键名（值为空，等待用户输入）
      const stringData = requiredKeys.map(rk => ({
        key: rk.key,
        value: '',
      }));
      form.setFieldValue('stringData', stringData);
    } else {
      // Opaque 类型，清空数据
      form.setFieldValue('stringData', []);
    }
  };

  // 构建提交数据
  const buildSubmitData = (values: SecretFormValues): any => {
    // 构建 stringData 对象
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
        name: generateHarvesterCrMetadataName('secret'),
        namespace: values.namespace,
        labels: values.labels?.reduce((acc, { key, value }) => {
          if (key && value) acc[key] = value;
          return acc;
        }, {} as Record<string, string>),
        annotations: {
          'tower.io/alias': values.name,
        },
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

      if (editMode) {
        // 编辑模式：保留 resourceVersion 以支持更新
        if (initialData?.metadata?.resourceVersion) {
          submitData.metadata.resourceVersion = initialData.metadata.resourceVersion;
        }
        await updateHarvesterSecret(cloudId, values.namespace, values.name, submitData);
        message.success('Secret 更新成功');
      } else {
        // 创建模式
        await createHarvesterSecret(cloudId, values.namespace, submitData);
        message.success('Secret 创建成功');
      }
      onSuccess();
    } catch (error: any) {
      const errorMsg = error?.response?.data?.message || error?.message || '操作失败';
      message.error(errorMsg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Spin spinning={loadingData} tip="加载 Secret 数据中...">
      <Form
        form={form}
        layout="vertical"
initialValues={{
        name: generateVmWizardStyleDisplayName('sec'),
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
                <Input placeholder="如: my-secret" disabled={editMode} />
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
                  disabled={editMode}
                  options={namespacesOptions.map((ns) => ({ label: ns, value: ns }))}
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
                  disabled={editMode}
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
          <DataEditor secretType={secretType} editMode={editMode} />
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
    </Spin>
  );
};

export default SecretForm;
