/**
 * ==============================================================================
 * 模块名称: 快速创建 ConfigMap 弹窗 (QuickCreateConfigMapModal)
 * 文件路径: frontend/src/pages/cnmc/clouds/Harvester/containers/components/QuickCreateConfigMapModal.tsx
 * ==============================================================================
 * 
 * [功能描述]
 * 在其他表单（如 WorkloadForm）中快速创建 ConfigMap 的弹窗组件。
 * 内部复用 ConfigMapForm 组件，无需离开当前页面即可创建 ConfigMap。
 * 
 * [使用场景]
 * - 创建工作负载时快速创建 ConfigMap 用于环境变量
 * - 创建工作负载时快速创建 ConfigMap 用于存储卷挂载
 */

import React, { useState, useCallback, useRef } from 'react';
import { Modal, Form, Input, Select, Button, Space, Row, Col, Card, App, Tooltip } from 'antd';
import {
  PlusOutlined,
  MinusCircleOutlined,
  InfoCircleOutlined,
  FileTextOutlined,
} from '@ant-design/icons';
import { createHarvesterConfigMap } from '../../../../../../services/harvesterApi';
import CodeEditor, { 
  CodeLanguage, 
  LANGUAGE_OPTIONS, 
  detectLanguage 
} from '../../../../../../components/CodeEditor';

// ============================================================
// 类型定义
// ============================================================

export interface QuickCreateConfigMapModalProps {
  /** 云环境 ID */
  cloudId: string;
  /** 命名空间选项列表 */
  namespacesOptions: string[];
  /** 默认命名空间 */
  defaultNamespace?: string;
  /** 弹窗是否可见 */
  visible: boolean;
  /** 创建成功回调，返回创建的 ConfigMap 信息 */
  onSuccess: (configMap: { name: string; namespace: string }) => void;
  /** 取消回调 */
  onCancel: () => void;
}

interface ConfigMapFormValues {
  name: string;
  namespace: string;
  labels: Array<{ key: string; value: string }>;
  data: Array<{ key: string; value: string }>;
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
  const [languages, setLanguages] = useState<Record<number, CodeLanguage>>({});

  const getLanguage = (index: number, keyName?: string): CodeLanguage => {
    if (languages[index]) {
      return languages[index];
    }
    if (keyName) {
      return detectLanguage(keyName);
    }
    return 'text';
  };

  const handleKeyChange = (index: number, keyName: string) => {
    const detected = detectLanguage(keyName);
    setLanguages(prev => ({
      ...prev,
      [index]: detected,
    }));
  };

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

const QuickCreateConfigMapModal: React.FC<QuickCreateConfigMapModalProps> = ({
  cloudId,
  namespacesOptions,
  defaultNamespace,
  visible,
  onSuccess,
  onCancel,
}) => {
  const [form] = Form.useForm<ConfigMapFormValues>();
  const { message } = App.useApp();
  const [loading, setLoading] = useState(false);
  const successRef = useRef(false);

  // 初始化默认命名空间
  React.useEffect(() => {
    if (visible && defaultNamespace) {
      form.setFieldValue('namespace', defaultNamespace);
    }
  }, [visible, defaultNamespace, form]);

  // 构建提交数据
  const buildSubmitData = (values: ConfigMapFormValues): any => {
    const labels = values.labels?.reduce((acc, { key, value }) => {
      if (key && value) acc[key] = value;
      return acc;
    }, {} as Record<string, string>);

    const data = values.data?.reduce((acc, { key, value }) => {
      if (key) acc[key] = value || '';
      return acc;
    }, {} as Record<string, string>);

    return {
      apiVersion: 'v1',
      kind: 'ConfigMap',
      metadata: {
        name: values.name,
        namespace: values.namespace,
        labels: labels && Object.keys(labels).length > 0 ? labels : undefined,
      },
      data: data && Object.keys(data).length > 0 ? data : undefined,
    };
  };

  // 提交表单
  const handleSubmit = async () => {
    try {
      const values = await form.validateFields();
      setLoading(true);

      const submitData = buildSubmitData(values);
      console.log('[QuickCreateConfigMapModal] 提交数据:', submitData);

      await createHarvesterConfigMap(cloudId, values.namespace, submitData);
      message.success('ConfigMap 创建成功');
      
      // 标记成功
      successRef.current = true;
      
      // 回调父组件
      onSuccess({ name: values.name, namespace: values.namespace });
    } catch (error: any) {
      console.error('[QuickCreateConfigMapModal] 提交失败:', error);
      const errorMsg = error?.response?.data?.message || error?.message || '创建失败';
      message.error(errorMsg);
    } finally {
      setLoading(false);
    }
  };

  // 处理取消
  const handleCancel = () => {
    form.resetFields();
    onCancel();
  };

  // Modal 关闭后重置
  const handleAfterClose = () => {
    form.resetFields();
    successRef.current = false;
  };

  return (
    <Modal
      title="快速创建 ConfigMap"
      open={visible}
      onCancel={handleCancel}
      afterClose={handleAfterClose}
      width={600}
      footer={null}
      destroyOnClose
      maskClosable={false}
    >
      <Form
        form={form}
        layout="vertical"
        initialValues={{
          labels: [],
          data: [],
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
                  { pattern: /^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/, message: '只允许小写字母、数字和连字符，且必须以字母数字开头和结尾' },
                ]}
              >
                <Input placeholder="如: my-config" />
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
            <Button onClick={handleCancel}>取消</Button>
            <Button type="primary" onClick={handleSubmit} loading={loading}>
              创建
            </Button>
          </Space>
        </div>
      </Form>
    </Modal>
  );
};

export default QuickCreateConfigMapModal;