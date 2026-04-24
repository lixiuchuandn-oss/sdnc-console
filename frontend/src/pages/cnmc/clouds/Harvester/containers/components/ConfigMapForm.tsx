/**
 * ==============================================================================
 * 模块名称: ConfigMap 创建/编辑表单 (ConfigMapForm)
 * 文件路径: frontend/src/pages/cnmc/clouds/Harvester/containers/components/ConfigMapForm.tsx
 * ==============================================================================
 * 
 * [功能描述]
 * 用于创建或编辑 Kubernetes ConfigMap 资源的表单组件。
 * 支持两种模式：
 * - 创建模式：所有字段可编辑
 * - 编辑模式：名称、命名空间禁用，其他字段可编辑
 * 
 * [使用场景]
 * - 存储配置文件内容
 * - 存储环境变量配置
 * - 存储命令行参数
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
} from 'antd';
import {
  PlusOutlined,
  MinusCircleOutlined,
  InfoCircleOutlined,
  FileTextOutlined,
} from '@ant-design/icons';
import {
  createHarvesterConfigMap,
  updateHarvesterConfigMap,
} from '../../../../../../services/harvesterApi';
import { generateHarvesterCrMetadataName, generateVmWizardStyleDisplayName } from '../../../../../../utils/harvesterUtils';
import CodeEditor, { 
  CodeLanguage, 
  LANGUAGE_OPTIONS, 
  detectLanguage 
} from '../../../../../../components/CodeEditor';

// ============================================================
// 类型定义
// ============================================================

export interface ConfigMapFormValues {
  name: string;
  namespace: string;
  labels: Array<{ key: string; value: string }>;
  data: Array<{ key: string; value: string }>;
}

export interface ConfigMapFormProps {
  cloudId: string;
  namespacesOptions: string[];
  onSuccess: () => void;
  onCancel: () => void;
  defaultNamespace?: string;
  /** 编辑模式 */
  editMode?: boolean;
  /** 编辑模式下的初始数据（原始 ConfigMap 对象） */
  initialData?: any;
}

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
            <Tooltip title="ConfigMap 的标签，用于标识和筛选">
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
              rules={[
                { required: true, message: '请输入键' },
                { pattern: /^[a-zA-Z0-9._-]+$/, message: '只允许字母、数字、点、下划线和连字符' },
              ]}
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
// 子组件: 数据项编辑器（支持语法高亮）
// ============================================================

interface DataEditorProps {
  form: any;
}

const DataEditor: React.FC<DataEditorProps> = ({ form }) => {
  // 存储每个数据项的语言类型（索引 -> 语言类型）
  const [languages, setLanguages] = useState<Record<number, CodeLanguage>>({});

  // 获取某个数据项的语言类型
  const getLanguage = (index: number, keyName?: string): CodeLanguage => {
    // 如果已有设置的语言，使用它
    if (languages[index]) {
      return languages[index];
    }
    // 否则根据键名推断
    if (keyName) {
      return detectLanguage(keyName);
    }
    return 'text';
  };

  // 处理键名变化，自动推断语言类型
  const handleKeyChange = (index: number, keyName: string) => {
    const detected = detectLanguage(keyName);
    setLanguages(prev => ({
      ...prev,
      [index]: detected,
    }));
  };

  // 处理语言选择变化
  const handleLanguageChange = (index: number, lang: CodeLanguage) => {
    setLanguages(prev => ({
      ...prev,
      [index]: lang,
    }));
  };

  return (
    <Form.List name="data">
      {(fields, { add, remove }) => (
        <div>
          <div style={{ marginBottom: 12 }}>
            <Space>
              <span style={{ fontWeight: 500 }}>数据内容</span>
              <Tooltip title="ConfigMap 存储的配置数据，键名作为文件名或配置项名。支持 YAML、JSON 等语法高亮。">
                <InfoCircleOutlined style={{ color: '#999' }} />
              </Tooltip>
              <Button type="dashed" size="small" onClick={() => add()} icon={<PlusOutlined />}>
                添加数据项
              </Button>
            </Space>
          </div>
          {fields.length === 0 && (
            <Card size="small" style={{ marginBottom: 8, background: '#fafafa', textAlign: 'center' }}>
              <span style={{ color: '#999' }}>暂无数据项，点击上方按钮添加</span>
            </Card>
          )}
          {fields.map(({ key, name: index, ...restField }) => {
            // 获取当前键名，用于推断语言
            const currentKey = form.getFieldValue(['data', index, 'key']) || '';
            const currentLang = getLanguage(index, currentKey);

            return (
              <Card
                key={key}
                size="small"
                style={{ marginBottom: 8, background: '#fafafa' }}
                title={
                  <Space>
                    <FileTextOutlined />
                    <span>数据项 {index + 1}</span>
                  </Space>
                }
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
                  <Col span={16}>
                    <Form.Item
                      {...restField}
                      name={[index, 'key']}
                      label="键名"
                      rules={[
                        { required: true, message: '请输入键名' },
                        { pattern: /^[a-zA-Z0-9._-]+$/, message: '只允许字母、数字、点、下划线和连字符' },
                      ]}
                      extra="作为文件名或配置项名使用"
                    >
                      <Input 
                        placeholder="如: config.yaml、app.properties" 
                        onChange={(e) => handleKeyChange(index, e.target.value)}
                      />
                    </Form.Item>
                  </Col>
                  <Col span={8}>
                    <Form.Item label="语法高亮">
                      <Select
                        value={currentLang}
                        onChange={(lang) => handleLanguageChange(index, lang)}
                        options={LANGUAGE_OPTIONS}
                        style={{ width: '100%' }}
                      />
                    </Form.Item>
                  </Col>
                </Row>
                <Form.Item
                  {...restField}
                  name={[index, 'value']}
                  label="值"
                >
                  <CodeEditor
                    language={currentLang}
                    filename={currentKey}
                    minHeight={150}
                    maxHeight={400}
                    placeholder="配置内容..."
                  />
                </Form.Item>
              </Card>
            );
          })}
          {fields.length > 0 && (
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

const ConfigMapForm: React.FC<ConfigMapFormProps> = ({
  cloudId,
  namespacesOptions,
  onSuccess,
  onCancel,
  defaultNamespace,
  editMode = false,
  initialData,
}) => {
  const [form] = Form.useForm<ConfigMapFormValues>();
  const { message } = App.useApp();
  const [loading, setLoading] = useState(false);

  // 从初始数据提取表单值（编辑模式）
  const extractFormValues = (data: any): Partial<ConfigMapFormValues> => {
    if (!data) return {};
    
    const metadata = data.metadata || {};
    
    // 提取标签
    const labels = Object.entries(metadata.labels || {}).map(([key, value]) => ({
      key,
      value: value as string,
    }));
    
    // 提取数据
    const dataEntries = Object.entries(data.data || {}).map(([key, value]) => ({
      key,
      value: value as string,
    }));
    
    return {
      name: metadata.annotations?.['tower.io/alias'] || metadata.name || '',
      namespace: metadata.namespace || '',
      labels,
      data: dataEntries,
    };
  };

  // 初始化默认命名空间或编辑数据
  useEffect(() => {
    if (editMode && initialData) {
      // 编辑模式：从初始数据填充表单
      const values = extractFormValues(initialData);
      form.setFieldsValue(values);
    } else {
      // 创建模式：设置默认命名空间
      const defaultNs = defaultNamespace || namespacesOptions[0] || 'default';
      form.setFieldValue('namespace', defaultNs);
    }
  }, [defaultNamespace, namespacesOptions, form, editMode, initialData]);

  // 构建提交数据
  const buildSubmitData = (values: ConfigMapFormValues, isEdit: boolean): any => {
    // 构建标签对象
    const labels = values.labels?.reduce((acc, { key, value }) => {
      if (key && value) acc[key] = value;
      return acc;
    }, {} as Record<string, string>);

    // 构建数据对象
    const data = values.data?.reduce((acc, { key, value }) => {
      if (key) acc[key] = value || '';
      return acc;
    }, {} as Record<string, string>);

    return {
      apiVersion: 'v1',
      kind: 'ConfigMap',
      metadata: {
        name: isEdit && initialData ? initialData.metadata?.name : generateHarvesterCrMetadataName('configmap'),
        namespace: values.namespace,
        labels: labels && Object.keys(labels).length > 0 ? labels : undefined,
        annotations: {
          ...(isEdit && initialData ? initialData.metadata?.annotations : {}),
          'tower.io/alias': values.name,
        },
      },
      data: data && Object.keys(data).length > 0 ? data : undefined,
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
        await updateHarvesterConfigMap(cloudId, values.namespace, initialData?.metadata?.name, submitData);
        message.success('ConfigMap 更新成功');
      } else {
        // 创建模式
        await createHarvesterConfigMap(cloudId, values.namespace, submitData);
        message.success('ConfigMap 创建成功');
      }
      onSuccess();
    } catch (error: any) {
      console.error('[ConfigMapForm] 提交失败:', error);
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
        name: generateVmWizardStyleDisplayName('cm'),
        labels: [],
        data: [],
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
                  rules={[
                    { required: true, message: '请输入显示名称' },
                  ]}
                >
                  <Input placeholder="如: my-config" />
                </Form.Item>
              </>
            ) : (
              <Form.Item
                name="name"
                label="名称"
                rules={[
                  { required: true, message: '请输入名称' },
                  { pattern: /^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/, message: '只允许小写字母、数字和连字符，且必须以字母数字开头和结尾' },
                ]}
              >
                <Input placeholder="如: my-config" />
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
                options={namespacesOptions.map(ns => ({ label: ns, value: ns }))}
              />
            </Form.Item>
          </Col>
        </Row>
        <LabelsEditor />
      </Card>

      {/* 数据内容 */}
      <Card title="数据配置" size="small" style={{ marginBottom: 16 }}>
        <DataEditor form={form} />
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

export default ConfigMapForm;
