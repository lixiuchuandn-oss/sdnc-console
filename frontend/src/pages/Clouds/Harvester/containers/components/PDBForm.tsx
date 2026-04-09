/**
 * ==============================================================================
 * 模块名称: PodDisruptionBudget 创建表单 (PDBForm)
 * 文件路径: src/pages/Clouds/Harvester/containers/components/PDBForm.tsx
 * ==============================================================================
 * 
 * [功能描述]
 * 表单组件，用于创建 Kubernetes PodDisruptionBudget 资源。
 * 
 * [表单字段]
 * - 基本信息: 名称、命名空间、标签
 * - Pod 选择器: 标签选择器，用于匹配目标 Pod
 * - 可用性策略: minAvailable 或 maxUnavailable (二选一)
 * 
 * [验证规则]
 * - minAvailable 和 maxUnavailable 只能设置其中一个
 * - 值可以是整数或百分比 (如 2 或 50%)
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  Form,
  Input,
  Select,
  InputNumber,
  Button,
  Space,
  Card,
  Tag,
  Divider,
  Row,
  Col,
  App,
  Alert,
  Radio,
  Tooltip,
} from 'antd';
import {
  PlusOutlined,
  MinusCircleOutlined,
  InfoCircleOutlined,
  SafetyOutlined,
} from '@ant-design/icons';
import { createHarvesterPDB } from '../../../../../services/harvesterApi';

// ============================================================
// 类型定义
// ============================================================

export interface PDBFormValues {
  // 基本信息
  name: string;
  namespace: string;
  labels: Array<{ key: string; value: string }>;
  
  // Pod 选择器
  selector: Array<{ key: string; value: string }>;
  
  // 可用性策略
  strategyType: 'minAvailable' | 'maxUnavailable';
  strategyValue: string; // 可以是数字或百分比
}

export interface PDBFormProps {
  cloudId: string;
  namespacesOptions: string[];
  onSuccess: () => void;
  onCancel: () => void;
  defaultNamespace?: string;
}

// ============================================================
// 子组件: 标签编辑器
// ============================================================

const LabelEditor: React.FC<{
  name: string;
  label: string;
  tooltip?: string;
}> = ({ name, label, tooltip }) => (
  <div style={{ marginBottom: 8 }}>
    <div style={{ marginBottom: 8 }}>
      <Space>
        <span style={{ fontWeight: 500 }}>{label}</span>
        {tooltip && (
          <Tooltip title={tooltip}>
            <InfoCircleOutlined style={{ color: '#999' }} />
          </Tooltip>
        )}
      </Space>
    </div>
    <Form.List name={name}>
      {(fields, { add, remove }) => (
        <div>
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
              <MinusCircleOutlined
                onClick={() => remove(index)}
                style={{ color: '#ff4d4f', cursor: 'pointer' }}
              />
            </Space>
          ))}
          <Button
            type="dashed"
            size="small"
            onClick={() => add()}
            icon={<PlusOutlined />}
          >
            添加标签
          </Button>
        </div>
      )}
    </Form.List>
  </div>
);

// ============================================================
// 主组件
// ============================================================

const PDBForm: React.FC<PDBFormProps> = ({
  cloudId,
  namespacesOptions,
  onSuccess,
  onCancel,
  defaultNamespace,
}) => {
  const [form] = Form.useForm();
  const { message } = App.useApp();
  const [loading, setLoading] = useState(false);
  const [strategyType, setStrategyType] = useState<'minAvailable' | 'maxUnavailable'>('minAvailable');

  // 初始化默认值
  useEffect(() => {
    form.setFieldsValue({
      namespace: defaultNamespace || namespacesOptions[0] || 'default',
      strategyType: 'minAvailable',
      strategyValue: '1',
      labels: [],
      selector: [],
    });
  }, [form, defaultNamespace, namespacesOptions]);

  // 监听策略类型变化
  const handleStrategyTypeChange = useCallback((e: any) => {
    setStrategyType(e.target.value);
  }, []);

  // 提交表单
  const handleSubmit = async () => {
    setLoading(true);
    try {
      const values = await form.validateFields();
      
      // 构建 PDB 资源定义
      const selector: Record<string, string> = {};
      (values.selector || []).forEach((s: any) => {
        if (s.key && s.value) selector[s.key] = s.value;
      });

      if (Object.keys(selector).length === 0) {
        message.error('请添加至少一个标签选择器');
        return;
      }

      const labels: Record<string, string> = {};
      (values.labels || []).forEach((l: any) => {
        if (l.key && l.value) labels[l.key] = l.value;
      });

      // 解析策略值 (可能是整数或百分比)
      let strategyValue: number | string = values.strategyValue;
      const numValue = parseInt(values.strategyValue, 10);
      if (!isNaN(numValue) && !values.strategyValue.includes('%')) {
        strategyValue = numValue;
      }

      const pdbBody: any = {
        apiVersion: 'policy/v1',
        kind: 'PodDisruptionBudget',
        metadata: {
          name: values.name,
          namespace: values.namespace,
          labels: Object.keys(labels).length > 0 ? labels : undefined,
        },
        spec: {
          selector: {
            matchLabels: selector,
          },
        },
      };

      // 设置可用性策略
      if (values.strategyType === 'minAvailable') {
        pdbBody.spec.minAvailable = strategyValue;
      } else {
        pdbBody.spec.maxUnavailable = strategyValue;
      }

      await createHarvesterPDB(cloudId, values.namespace, pdbBody);
      message.success('Pod 中断保护规则创建成功');
      onSuccess();
    } catch (e: any) {
      console.error('创建 PDB 失败:', e);
      message.error(e?.message || '创建失败');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Form
      form={form}
      layout="vertical"
      onFinish={handleSubmit}
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
                { 
                  pattern: /^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/, 
                  message: '名称只能包含小写字母、数字和连字符' 
                },
                { max: 63, message: '名称最多 63 个字符' },
              ]}
            >
              <Input placeholder="my-pdb" />
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item
              name="namespace"
              label="命名空间"
              rules={[{ required: true, message: '请选择命名空间' }]}
            >
              <Select
                showSearch
                optionFilterProp="label"
                options={namespacesOptions.map((ns) => ({ label: ns, value: ns }))}
              />
            </Form.Item>
          </Col>
        </Row>
        <LabelEditor 
          name="labels" 
          label="标签" 
          tooltip="可选，添加到 PDB 资源的标签"
        />
      </Card>

      {/* Pod 选择器 */}
      <Card 
        title={
          <Space>
            <span>Pod 选择器</span>
            <Tag color="orange">必填</Tag>
          </Space>
        } 
        size="small" 
        style={{ marginBottom: 16 }}
      >
        <Alert
          message="选择器用于匹配目标 Pod，需要与 Deployment/StatefulSet 等工作负载的 Pod 标签一致"
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
        />
        <LabelEditor 
          name="selector" 
          label="标签选择器" 
          tooltip="需要与目标 Pod 的标签完全匹配"
        />
      </Card>

      {/* 可用性策略 */}
      <Card
        title={
          <Space>
            <SafetyOutlined />
            <span>保护策略（中断限制）</span>
          </Space>
        } 
        size="small" 
        style={{ marginBottom: 16 }}
      >
        <Alert
          message="minAvailable 和 maxUnavailable 只能设置其中一个"
          type="warning"
          showIcon
          style={{ marginBottom: 16 }}
        />
        
        <Form.Item
          name="strategyType"
          label="策略类型"
          rules={[{ required: true, message: '请选择策略类型' }]}
        >
          <Radio.Group onChange={handleStrategyTypeChange}>
            <Radio value="minAvailable">
              <Tooltip title="最少需要保持可用的 Pod 数量">
                最小可用数 (minAvailable)
              </Tooltip>
            </Radio>
            <Radio value="maxUnavailable">
              <Tooltip title="最多允许不可用的 Pod 数量">
                最大不可用数 (maxUnavailable)
              </Tooltip>
            </Radio>
          </Radio.Group>
        </Form.Item>
        
        <Row gutter={16}>
          <Col span={12}>
            <Form.Item
              name="strategyValue"
              label={
                <Space>
                  {strategyType === 'minAvailable' ? '最小可用数' : '最大不可用数'}
                  <Tooltip 
                    title={
                      strategyType === 'minAvailable'
                        ? '在自愿中断期间，必须保持可用的最小 Pod 数量。可以是绝对数 (如 2) 或百分比 (如 50%)'
                        : '在自愿中断期间，允许不可用的最大 Pod 数量。可以是绝对数 (如 1) 或百分比 (如 25%)'
                    }
                  >
                    <InfoCircleOutlined style={{ color: '#999' }} />
                  </Tooltip>
                </Space>
              }
              rules={[
                { required: true, message: '请输入数值' },
                {
                  validator: (_, value) => {
                    if (!value) return Promise.resolve();
                    
                    // 检查是否是有效的整数或百分比
                    const percentPattern = /^\d+%$/;
                    const intPattern = /^\d+$/;
                    
                    if (percentPattern.test(value)) {
                      const percent = parseInt(value, 10);
                      if (percent < 0 || percent > 100) {
                        return Promise.reject(new Error('百分比必须在 0-100 之间'));
                      }
                      return Promise.resolve();
                    }
                    
                    if (intPattern.test(value)) {
                      const num = parseInt(value, 10);
                      if (num < 0) {
                        return Promise.reject(new Error('数值不能为负数'));
                      }
                      return Promise.resolve();
                    }
                    
                    return Promise.reject(new Error('请输入有效的整数或百分比 (如: 2 或 50%)'));
                  },
                },
              ]}
            >
              <Input 
                placeholder={strategyType === 'minAvailable' ? '2 或 50%' : '1 或 25%'} 
              />
            </Form.Item>
          </Col>
          <Col span={12}>
            <Alert
              message={
                <div>
                  <div style={{ fontWeight: 'bold', marginBottom: 4 }}>示例说明</div>
                  <ul style={{ margin: 0, paddingLeft: 16 }}>
                    <li><code>2</code> - 绝对数量，至少/最多 2 个 Pod</li>
                    <li><code>50%</code> - 百分比，至少/最多 50% 的 Pod</li>
                    <li><code>0</code> - 特殊值，maxUnavailable=0 表示不允许任何自愿中断</li>
                  </ul>
                </div>
              }
              type="info"
            />
          </Col>
        </Row>
      </Card>

      {/* 操作按钮 */}
      <div style={{ textAlign: 'right' }}>
        <Space>
          <Button onClick={onCancel}>取消</Button>
          <Button type="primary" htmlType="submit" loading={loading}>
            创建
          </Button>
        </Space>
      </div>
    </Form>
  );
};

export default PDBForm;
