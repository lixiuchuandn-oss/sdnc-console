/**
 * 污点容忍配置
 */
import React, { useState, useEffect, useImperativeHandle } from 'react';
import { Form, Input, Select, InputNumber, Button, Space, Tag, Card, Row, Col } from 'antd';
import { PlusOutlined } from '@ant-design/icons';

import type { Toleration } from '../types';
import {
  TOLERATION_OPERATOR_OPTIONS,
  TOLERATION_EFFECT_OPTIONS,
  COMMON_TOLERATION_PRESETS,
} from '../constants';
import { validateNodeLabelKey, validateK8sLabelValue } from '../validators';

/**
 * 污点容忍编辑器组件
 * 支持配置 Kubernetes Tolerations，允许 Pod 调度到有污点的节点
 * 
 * 使用 Form.useWatch 监听 form 数据，完全依赖 form 状态
 */
export interface TolerationsEditorHandle {
  getHasLabelErrors: () => boolean;
}

const TolerationsEditor = React.forwardRef<TolerationsEditorHandle, {}>(
  (_props, ref) => {
  const form = Form.useFormInstance();
  
  // 本地 state 管理规则列表
  const [tolerations, setTolerations] = useState<Toleration[]>([]);
  
  // 初始化时从 form 读取值
  useEffect(() => {
    setTolerations(form.getFieldValue('tolerations') || []);
  }, [form]);

  useImperativeHandle(ref, () => ({
    getHasLabelErrors: () => {
      const errors = form.getFieldsError();
      return errors.some(e => {
        if (!e.errors?.length) return false;
        const fieldName = Array.isArray(e.name) ? e.name.join('.') : String(e.name);
        return fieldName.startsWith('tolerations');
      });
    },
  }), [form]);

  // 添加容忍规则
  const addToleration = (preset?: typeof COMMON_TOLERATION_PRESETS[0]) => {
    // 从 form 读取最新数据（包含用户已输入的内容）
    const currentTolerations = form.getFieldValue('tolerations') || [];
    const newToleration: Toleration = {
      key: preset?.key || '',
      operator: 'Equal',
      value: '',
      effect: 'NoSchedule',
    };
    const updated = [...currentTolerations, newToleration];
    setTolerations(updated);
    
    form.setFieldsValue({ tolerations: updated });
  };

  // 删除容忍规则
  const removeToleration = (index: number) => {
    const updated = tolerations.filter((_, i) => i !== index);
    setTolerations(updated);
    
    form.setFieldsValue({ tolerations: updated });
  };

  // 使用预设快速添加
  const handlePresetClick = (preset: typeof COMMON_TOLERATION_PRESETS[0]) => {
    addToleration(preset);
  };

  // 渲染单个容忍规则
  const renderToleration = (index: number) => {
    const basePath = ['tolerations', index];
    const operatorValue = form.getFieldValue([...basePath, 'operator']);
    const effectValue = form.getFieldValue([...basePath, 'effect']);
    const showValue = operatorValue === 'Equal';
    const showTolerationSeconds = effectValue === 'NoExecute';
    const tolerationKey = tolerations[index]?.key;

    return (
      <Card
        key={index}
        size="small"
        style={{ marginBottom: 12 }}
        title={
          <Space>
            <Tag color="orange">容忍规则 {index + 1}</Tag>
            {tolerationKey && (
              <span style={{ color: '#666', fontSize: 12 }}>
                {tolerationKey}
              </span>
            )}
          </Space>
        }
        extra={
          <Button
            type="text"
            danger
            size="small"
            onClick={() => removeToleration(index)}
          >
            删除
          </Button>
        }
      >
        <Row gutter={[8, 8]}>
          {/* Key 输入框 - 支持预设和自定义 */}
          <Col span={10}>
            <Form.Item
              name={[...basePath, 'key']}
              label="污点键 (Key)"
              rules={[
                { required: true, message: '请输入污点键' },
                { validator: validateNodeLabelKey },
              ]}
              extra="可输入或选择预设"
              style={{ marginBottom: 0 }}
            >
              <Select
                showSearch
                placeholder="选择或输入污点键"
                options={COMMON_TOLERATION_PRESETS.map(p => ({
                  value: p.key,
                  label: `${p.label} (${p.key})`,
                }))}
                filterOption={(input, option) =>
                  (option?.label ?? '').toLowerCase().includes(input.toLowerCase()) ||
                  (option?.value ?? '').toLowerCase().includes(input.toLowerCase())
                }
              />
            </Form.Item>
          </Col>
          
          {/* Operator */}
          <Col span={4}>
            <Form.Item
              name={[...basePath, 'operator']}
              label="操作符"
              initialValue="Equal"
              style={{ marginBottom: 0 }}
            >
              <Select
                options={TOLERATION_OPERATOR_OPTIONS}
                onChange={() => {
                  // 切换操作符时清空 value
                  if (form.getFieldValue([...basePath, 'operator']) === 'Exists') {
                    form.setFieldValue([...basePath, 'value'], undefined);
                  }
                }}
              />
            </Form.Item>
          </Col>
          
          {/* Value - 仅 Equal 时显示 */}
          {showValue && (
            <Col span={5}>
              <Form.Item
                name={[...basePath, 'value']}
                label="污点值 (Value)"
                rules={[
                  { required: showValue, message: 'Equal 操作符需要填写值' },
                  { validator: validateK8sLabelValue },
                ]}
                style={{ marginBottom: 0 }}
              >
                <Input placeholder="污点值" />
              </Form.Item>
            </Col>
          )}
          
          {/* Effect */}
          <Col span={showValue ? 5 : 10}>
            <Form.Item
              name={[...basePath, 'effect']}
              label="效果 (Effect)"
              initialValue="NoSchedule"
              style={{ marginBottom: 0 }}
            >
              <Select options={TOLERATION_EFFECT_OPTIONS} />
            </Form.Item>
          </Col>
          
          {/* tolerationSeconds - 仅 NoExecute 时显示 */}
          {showTolerationSeconds && (
            <Col span={6}>
              <Form.Item
                name={[...basePath, 'tolerationSeconds']}
                label="容忍时间 (秒)"
                extra="Pod 被驱逐前可运行的时间"
                style={{ marginBottom: 0 }}
              >
                <InputNumber
                  min={0}
                  placeholder="如: 300"
                  style={{ width: '100%' }}
                />
              </Form.Item>
            </Col>
          )}
        </Row>
      </Card>
    );
  };

  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ marginBottom: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontWeight: 500 }}>污点容忍</span>
        <Space>
          <Button type="dashed" size="small" icon={<PlusOutlined />} onClick={() => addToleration()}>
            添加容忍规则
          </Button>
        </Space>
      </div>

      {/* 常用预设快速添加 */}
      <div style={{ marginBottom: 12 }}>
        <span style={{ fontSize: 12, color: '#999', marginRight: 8 }}>快速添加预设:</span>
        <Space wrap size={[4, 4]}>
          {COMMON_TOLERATION_PRESETS.map((preset) => (
            <Tag
              key={preset.key}
              style={{ cursor: 'pointer' }}
              onClick={() => handlePresetClick(preset)}
            >
              <PlusOutlined style={{ marginRight: 4 }} />
              {preset.label}
            </Tag>
          ))}
        </Space>
      </div>

      {tolerations.length === 0 && (
        <div style={{ color: '#999', fontSize: 12, padding: '8px 0' }}>
          未配置污点容忍规则，点击上方按钮或预设标签添加
        </div>
      )}

      {/* 容忍规则列表 */}
      {tolerations.map((_: any, index: number) => renderToleration(index))}
    </div>
  );
});

export default TolerationsEditor;
