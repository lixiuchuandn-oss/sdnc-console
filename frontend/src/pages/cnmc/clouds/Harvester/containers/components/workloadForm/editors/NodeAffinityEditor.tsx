/**
 * 节点亲和性 / 反亲和性规则
 */
import React, { useState, useEffect, useImperativeHandle } from 'react';
import { Form, Input, Select, InputNumber, Button, Space, Tag, Row, Col, Card } from 'antd';
import { PlusOutlined, MinusCircleOutlined } from '@ant-design/icons';

import type { NodeSelectorTerm, PreferredSchedulingTerm } from '../types';
import { NODE_SELECTOR_OPERATOR_OPTIONS } from '../constants';
import { validateNodeLabelKey } from '../validators';

export interface NodeAffinityEditorProps {
  name: 'nodeAffinity' | 'nodeAntiAffinity';
  label: string;
}

export interface NodeAffinityEditorHandle {
  getHasLabelErrors: () => boolean;
}

/**
 * 节点亲和性编辑器组件
 * 支持配置 required (必须) 和 preferred (尽量) 两种类型的规则
 */
/**
 * 节点亲和性编辑器组件
 * 支持配置 required (必须) 和 preferred (尽量) 两种类型的规则
 * 
 * 使用 Form.useWatch 监听 form 数据，完全依赖 form 状态
 */
const NodeAffinityEditor = React.forwardRef<NodeAffinityEditorHandle, NodeAffinityEditorProps>(
  ({ name, label }, ref) => {
  const form = Form.useFormInstance();
  
  // 本地 state 管理规则列表
  const [requiredRules, setRequiredRules] = useState<NodeSelectorTerm[]>([]);
  const [preferredRules, setPreferredRules] = useState<PreferredSchedulingTerm[]>([]);
  
  // 初始化时从 form 读取值
  useEffect(() => {
    const value = form.getFieldValue(name) || {};
    setRequiredRules(value?.required?.nodeSelectorTerms || []);
    setPreferredRules(value?.preferred || []);
  }, [form, name]);

  useImperativeHandle(ref, () => ({
    getHasLabelErrors: () => {
      const errors = form.getFieldsError();
      return errors.some(e => {
        if (!e.errors?.length) return false;
        const fieldName = Array.isArray(e.name) ? e.name.join('.') : String(e.name);
        return fieldName.startsWith(name);
      });
    },
  }), [form, name]);

  // 添加必须满足的规则
  const addRequiredRule = () => {
    const newRule: NodeSelectorTerm = { matchExpressions: [], matchFields: [] };
    const updated = [...requiredRules, newRule];
    setRequiredRules(updated);
    
    const currentValue = form.getFieldValue(name) || {};
    form.setFieldsValue({
      [name]: {
        ...currentValue,
        required: { nodeSelectorTerms: updated }
      }
    });
  };

  // 添加尽量满足的规则
  const addPreferredRule = () => {
    const newRule: PreferredSchedulingTerm = { weight: 50, preference: { matchExpressions: [], matchFields: [] } };
    const updated = [...preferredRules, newRule];
    setPreferredRules(updated);
    
    const currentValue = form.getFieldValue(name) || {};
    form.setFieldsValue({
      [name]: {
        ...currentValue,
        preferred: updated
      }
    });
  };

  // 删除必须满足的规则
  const removeRequiredRule = (index: number) => {
    const updated = requiredRules.filter((_, i) => i !== index);
    setRequiredRules(updated);
    
    const currentValue = form.getFieldValue(name) || {};
    form.setFieldsValue({
      [name]: {
        ...currentValue,
        required: updated.length > 0 ? { nodeSelectorTerms: updated } : undefined
      }
    });
  };

  // 删除尽量满足的规则
  const removePreferredRule = (index: number) => {
    const updated = preferredRules.filter((_, i) => i !== index);
    setPreferredRules(updated);
    
    const currentValue = form.getFieldValue(name) || {};
    form.setFieldsValue({
      [name]: {
        ...currentValue,
        preferred: updated
      }
    });
  };

  // 添加匹配表达式
  const addMatchExpression = (ruleType: 'required' | 'preferred', ruleIndex: number, fieldType: 'matchExpressions' | 'matchFields') => {
    const newExpr = { key: '', operator: 'In' as const, values: [] };
    const currentValue = form.getFieldValue(name) || {};
    
    if (ruleType === 'required') {
      // 从 form 读取最新数据（包含用户已输入的内容）
      const currentRequired = currentValue?.required?.nodeSelectorTerms || [];
      const currentRule = currentRequired[ruleIndex] || { matchExpressions: [], matchFields: [] };
      
      const newRequired = [...currentRequired];
      newRequired[ruleIndex] = {
        ...currentRule,
        [fieldType]: [...(currentRule[fieldType] || []), newExpr]
      };
      
      setRequiredRules(newRequired);
      form.setFieldsValue({
        [name]: {
          ...currentValue,
          required: { nodeSelectorTerms: newRequired }
        }
      });
    } else {
      // 从 form 读取最新数据（包含用户已输入的内容）
      const currentPreferred = currentValue?.preferred || [];
      const currentRule = currentPreferred[ruleIndex] || { weight: 50, preference: { matchExpressions: [], matchFields: [] } };
      const currentPreference = currentRule.preference || { matchExpressions: [], matchFields: [] };
      
      const newPreferred = [...currentPreferred];
      newPreferred[ruleIndex] = {
        ...currentRule,
        preference: {
          ...currentPreference,
          [fieldType]: [...(currentPreference[fieldType] || []), newExpr]
        }
      };
      
      setPreferredRules(newPreferred);
      form.setFieldsValue({
        [name]: {
          ...currentValue,
          preferred: newPreferred
        }
      });
    }
  };

  // 删除匹配表达式
  const removeMatchExpression = (ruleType: 'required' | 'preferred', ruleIndex: number, exprIndex: number, fieldType: 'matchExpressions' | 'matchFields') => {
    const currentValue = form.getFieldValue(name) || {};
    
    if (ruleType === 'required') {
      // 从 form 读取最新数据
      const currentRequired = currentValue?.required?.nodeSelectorTerms || [];
      const currentRule = currentRequired[ruleIndex];
      if (currentRule) {
        const newRequired = [...currentRequired];
        newRequired[ruleIndex] = {
          ...currentRule,
          [fieldType]: (currentRule[fieldType] || []).filter((_: any, i: number) => i !== exprIndex)
        };
        setRequiredRules(newRequired);
        form.setFieldsValue({
          [name]: {
            ...currentValue,
            required: { nodeSelectorTerms: newRequired }
          }
        });
      }
    } else {
      // 从 form 读取最新数据
      const currentPreferred = currentValue?.preferred || [];
      const currentRule = currentPreferred[ruleIndex];
      if (currentRule) {
        const currentPreference = currentRule.preference || { matchExpressions: [], matchFields: [] };
        const newPreferred = [...currentPreferred];
        newPreferred[ruleIndex] = {
          ...currentRule,
          preference: {
            ...currentPreference,
            [fieldType]: (currentPreference[fieldType] || []).filter((_: any, i: number) => i !== exprIndex)
          }
        };
        setPreferredRules(newPreferred);
        form.setFieldsValue({
          [name]: {
            ...currentValue,
            preferred: newPreferred
          }
        });
      }
    }
  };

  // 渲染单个匹配表达式
  const renderMatchExpression = (ruleType: 'required' | 'preferred', ruleIndex: number, exprIndex: number, fieldType: 'matchExpressions' | 'matchFields') => {
    const basePath = ruleType === 'required'
      ? [name, 'required', 'nodeSelectorTerms', ruleIndex, fieldType, exprIndex]
      : [name, 'preferred', ruleIndex, 'preference', fieldType, exprIndex];
    
    const operatorValue = form.getFieldValue([...basePath, 'operator']);
    const showValues = operatorValue !== 'Exists' && operatorValue !== 'DoesNotExist';

    return (
      <Row key={`${fieldType}-${exprIndex}`} gutter={8} style={{ marginBottom: 8 }}>
        <Col span={6}>
          <Form.Item name={[...basePath, 'key']} rules={[{ required: true, message: '请输入标签键' }, { validator: validateNodeLabelKey }]} style={{ marginBottom: 0 }}>
            <Input placeholder="标签键 (如: kubernetes.io/os)" />
          </Form.Item>
        </Col>
        <Col span={5}>
          <Form.Item name={[...basePath, 'operator']} style={{ marginBottom: 0 }}>
            <Select options={NODE_SELECTOR_OPERATOR_OPTIONS} style={{ width: '100%' }} />
          </Form.Item>
        </Col>
        {showValues && (
          <Col span={10}>
            <Form.Item name={[...basePath, 'values']} style={{ marginBottom: 0 }}>
              <Select
                mode="tags"
                placeholder="输入值后回车添加 (如: linux)"
                style={{ width: '100%' }}
                tokenSeparators={[',']}
              />
            </Form.Item>
          </Col>
        )}
        <Col span={showValues ? 3 : 13}>
          <Button
            type="text"
            danger
            icon={<MinusCircleOutlined />}
            onClick={() => removeMatchExpression(ruleType, ruleIndex, exprIndex, fieldType)}
          />
        </Col>
      </Row>
    );
  };

  // 渲染单个规则
  const renderRule = (ruleType: 'required' | 'preferred', ruleIndex: number) => {
    const matchExpressions = ruleType === 'required'
      ? (requiredRules[ruleIndex]?.matchExpressions || [])
      : (preferredRules[ruleIndex]?.preference?.matchExpressions || []);
    
    const matchFields = ruleType === 'required'
      ? (requiredRules[ruleIndex]?.matchFields || [])
      : (preferredRules[ruleIndex]?.preference?.matchFields || []);

    return (
      <Card
        key={`${ruleType}-${ruleIndex}`}
        size="small"
        style={{ marginBottom: 12 }}
        title={
          <Space>
            <Tag color={ruleType === 'required' ? 'red' : 'blue'}>
              {ruleType === 'required' ? '必须满足' : '尽量满足'}
            </Tag>
            {ruleType === 'preferred' && (
              <Form.Item name={[name, 'preferred', ruleIndex, 'weight']} noStyle>
                <InputNumber
                  min={1}
                  max={100}
                  placeholder="权重"
                  style={{ width: 80 }}
                />
              </Form.Item>
            )}
            <span style={{ color: '#999', fontSize: 12 }}>权重 1-100</span>
          </Space>
        }
        extra={
          <Button
            type="text"
            danger
            size="small"
            onClick={() => ruleType === 'required' ? removeRequiredRule(ruleIndex) : removePreferredRule(ruleIndex)}
          >
            删除规则
          </Button>
        }
      >
        {/* 匹配表达式 */}
        <div style={{ marginBottom: 12 }}>
          <div style={{ marginBottom: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontWeight: 500, fontSize: 13 }}>匹配表达式 (matchExpressions)</span>
            <Button
              type="dashed"
              size="small"
              icon={<PlusOutlined />}
              onClick={() => addMatchExpression(ruleType, ruleIndex, 'matchExpressions')}
            >
              添加条件
            </Button>
          </div>
          {matchExpressions.map((_: any, exprIndex: number) =>
            renderMatchExpression(ruleType, ruleIndex, exprIndex, 'matchExpressions')
          )}
          {matchExpressions.length === 0 && (
            <div style={{ color: '#999', fontSize: 12 }}>暂无匹配表达式</div>
          )}
        </div>

        {/* 匹配字段 */}
        <div>
          <div style={{ marginBottom: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontWeight: 500, fontSize: 13 }}>匹配字段 (matchFields)</span>
            <Button
              type="dashed"
              size="small"
              icon={<PlusOutlined />}
              onClick={() => addMatchExpression(ruleType, ruleIndex, 'matchFields')}
            >
              添加条件
            </Button>
          </div>
          {matchFields.map((_: any, exprIndex: number) =>
            renderMatchExpression(ruleType, ruleIndex, exprIndex, 'matchFields')
          )}
          {matchFields.length === 0 && (
            <div style={{ color: '#999', fontSize: 12 }}>暂无匹配字段</div>
          )}
        </div>
      </Card>
    );
  };

  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ marginBottom: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontWeight: 500 }}>{label}</span>
        <Space>
          <Button type="dashed" size="small" icon={<PlusOutlined />} onClick={addRequiredRule}>
            添加必须规则
          </Button>
          <Button type="dashed" size="small" icon={<PlusOutlined />} onClick={addPreferredRule}>
            添加偏好规则
          </Button>
        </Space>
      </div>

      {requiredRules.length === 0 && preferredRules.length === 0 && (
        <div style={{ color: '#999', fontSize: 12, padding: '8px 0' }}>
          未配置亲和性规则，点击上方按钮添加
        </div>
      )}

      {/* 必须满足的规则 */}
      {requiredRules.map((_: any, index: number) => renderRule('required', index))}

      {/* 尽量满足的规则 */}
      {preferredRules.map((_: any, index: number) => renderRule('preferred', index))}
    </div>
  );
});

export default NodeAffinityEditor;
