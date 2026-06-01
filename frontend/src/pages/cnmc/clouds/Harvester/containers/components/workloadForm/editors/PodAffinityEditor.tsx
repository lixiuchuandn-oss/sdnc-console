/**
 * Pod 亲和性 / 反亲和性规则
 */
import React, { useState, useEffect, useImperativeHandle } from 'react';
import { Form, Input, Select, InputNumber, Button, Space, Tag, Row, Col, Card } from 'antd';
import { PlusOutlined, MinusCircleOutlined, InfoCircleOutlined } from '@ant-design/icons';
import { isSystemNamespace } from '../../../../../../../../utils/harvesterUtils';

import type {
  PodAffinityTerm,
  WeightedPodAffinityTerm,
  PodLabelSelectorRequirement,
} from '../types';
import { POD_SELECTOR_OPERATOR_OPTIONS, TOPOLOGY_KEY_OPTIONS } from '../constants';
import { validateNodeLabelKey } from '../validators';

export interface PodAffinityEditorProps {
  name: 'podAffinity' | 'podAntiAffinity';
  label: string;
  namespacesOptions?: string[];
}

export interface PodAffinityEditorHandle {
  getHasLabelErrors: () => boolean;
}

/**
 * Pod 亲和性编辑器组件
 * 支持配置 required (必须) 和 preferred (尽量) 两种类型的规则
 * Pod 亲和性基于标签选择器匹配目标 Pod，并使用拓扑域约束调度位置
 * 
 * 使用 Form.useWatch 监听 form 数据，完全依赖 form 状态
 */
const PodAffinityEditor = React.forwardRef<PodAffinityEditorHandle, PodAffinityEditorProps>(
  ({ name, label, namespacesOptions = [] }, ref) => {
  const form = Form.useFormInstance();
  
  const [requiredRules, setRequiredRules] = useState<PodAffinityTerm[]>([]);
  const [preferredRules, setPreferredRules] = useState<WeightedPodAffinityTerm[]>([]);
  const [labelErrors, setLabelErrors] = useState<Record<string, { key?: string; value?: string }>>({});

  const validateLabelKey = (v: string): string | undefined => {
    if (!v) return undefined;
    const labelKeyRegex = /^([a-z0-9]([-a-z0-9]*[a-z0-9])?(\.[a-z0-9]([-a-z0-9]*[a-z0-9])?)*\/)?[a-z0-9]([-a-z0-9._]*[a-z0-9])?$/;
    if (!labelKeyRegex.test(v)) {
      return '格式无效：须小写字母/数字开头结尾，中间可含连字符、下划线、点';
    }
    const keyPart = v.includes('/') ? v.split('/')[1] : v;
    if (keyPart.length > 63) {
      return '键名长度不能超过63个字符';
    }
    return undefined;
  };

  const validateLabelValue = (v: string): string | undefined => {
    if (!v) return undefined;
    if (!/^[a-zA-Z0-9]([-a-zA-Z0-9._]*[a-zA-Z0-9])?$/.test(v)) {
      return '格式无效：字母/数字开头结尾，中间可含连字符、下划线、点';
    }
    if (v.length > 63) {
      return '值长度不能超过63个字符';
    }
    return undefined;
  };
  
  // 初始化时从 form 读取值
  useEffect(() => {
    const value = form.getFieldValue(name) || {};
    setRequiredRules(value?.required || []);
    setPreferredRules(value?.preferred || []);
  }, [form, name]);

  useImperativeHandle(ref, () => ({
    getHasLabelErrors: () => Object.values(labelErrors).some(e => e.key || e.value),
  }), [labelErrors]);

  // 添加必须满足的规则
  const addRequiredRule = () => {
    const newRule: PodAffinityTerm = {
      labelSelector: { matchLabels: {}, matchExpressions: [] },
      namespaces: [],
      topologyKey: 'kubernetes.io/hostname'
    };
    const updated = [...requiredRules, newRule];
    setRequiredRules(updated);
    
    const currentValue = form.getFieldValue(name) || {};
    form.setFieldsValue({
      [name]: {
        ...currentValue,
        required: updated
      }
    });
  };

  // 添加尽量满足的规则
  const addPreferredRule = () => {
    const newRule: WeightedPodAffinityTerm = {
      weight: 50,
      podAffinityTerm: {
        labelSelector: { matchLabels: {}, matchExpressions: [] },
        namespaces: [],
        topologyKey: 'kubernetes.io/hostname'
      }
    };
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
        required: updated
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

  // 添加标签匹配条件 (matchLabels)
  const addMatchLabel = (ruleType: 'required' | 'preferred', ruleIndex: number) => {
    const tempKey = `__new_label_${Date.now()}`;
    const currentValue = form.getFieldValue(name) || {};
    
    if (ruleType === 'required') {
      // 从 form 读取最新数据
      const currentRequired = currentValue?.required || [];
      const currentRule = currentRequired[ruleIndex] || { labelSelector: { matchLabels: {}, matchExpressions: [] }, namespaces: [], topologyKey: 'kubernetes.io/hostname' };
      const currentLabelSelector = currentRule.labelSelector || { matchLabels: {}, matchExpressions: [] };
      
      const newRequired = [...currentRequired];
      newRequired[ruleIndex] = {
        ...currentRule,
        labelSelector: {
          ...currentLabelSelector,
          matchLabels: { ...currentLabelSelector.matchLabels, [tempKey]: '' }
        }
      };
      setRequiredRules(newRequired);
      form.setFieldsValue({ [name]: { ...currentValue, required: newRequired } });
    } else {
      // 从 form 读取最新数据
      const currentPreferred = currentValue?.preferred || [];
      const currentRule = currentPreferred[ruleIndex] || { weight: 50, podAffinityTerm: { labelSelector: { matchLabels: {}, matchExpressions: [] }, namespaces: [], topologyKey: 'kubernetes.io/hostname' } };
      const currentPodAffinityTerm = currentRule.podAffinityTerm || { labelSelector: { matchLabels: {}, matchExpressions: [] }, namespaces: [], topologyKey: 'kubernetes.io/hostname' };
      const currentLabelSelector = currentPodAffinityTerm.labelSelector || { matchLabels: {}, matchExpressions: [] };
      
      const newPreferred = [...currentPreferred];
      newPreferred[ruleIndex] = {
        ...currentRule,
        podAffinityTerm: {
          ...currentPodAffinityTerm,
          labelSelector: {
            ...currentLabelSelector,
            matchLabels: { ...currentLabelSelector.matchLabels, [tempKey]: '' }
          }
        }
      };
      setPreferredRules(newPreferred);
      form.setFieldsValue({ [name]: { ...currentValue, preferred: newPreferred } });
    }
  };

  // 删除标签匹配条件 (matchLabels)
  const removeMatchLabel = (ruleType: 'required' | 'preferred', ruleIndex: number, key: string) => {
    if (ruleType === 'required') {
      const updated = [...requiredRules];
      const currentRule = updated[ruleIndex];
      if (currentRule?.labelSelector?.matchLabels) {
        const newMatchLabels = { ...currentRule.labelSelector.matchLabels };
        delete newMatchLabels[key];
        updated[ruleIndex] = {
          ...currentRule,
          labelSelector: { ...currentRule.labelSelector, matchLabels: newMatchLabels }
        };
        setRequiredRules(updated);
        
        const currentValue = form.getFieldValue(name) || {};
        form.setFieldsValue({ [name]: { ...currentValue, required: updated } });
      }
    } else {
      const updated = [...preferredRules];
      const currentRule = updated[ruleIndex];
      if (currentRule?.podAffinityTerm?.labelSelector?.matchLabels) {
        const newMatchLabels = { ...currentRule.podAffinityTerm.labelSelector.matchLabels };
        delete newMatchLabels[key];
        updated[ruleIndex] = {
          ...currentRule,
          podAffinityTerm: {
            ...currentRule.podAffinityTerm,
            labelSelector: { ...currentRule.podAffinityTerm.labelSelector, matchLabels: newMatchLabels }
          }
        };
        setPreferredRules(updated);
        
        const currentValue = form.getFieldValue(name) || {};
        form.setFieldsValue({ [name]: { ...currentValue, preferred: updated } });
      }
    }
  };

  // 更新标签键
  const updateMatchLabelKey = (ruleType: 'required' | 'preferred', ruleIndex: number, oldKey: string, newKey: string) => {
    if (!newKey || oldKey === newKey) return;
    
    if (ruleType === 'required') {
      const updated = [...requiredRules];
      const currentRule = updated[ruleIndex];
      if (currentRule?.labelSelector?.matchLabels) {
        const matchLabels = { ...currentRule.labelSelector.matchLabels };
        const value = matchLabels[oldKey];
        delete matchLabels[oldKey];
        matchLabels[newKey] = value;
        updated[ruleIndex] = {
          ...currentRule,
          labelSelector: { ...currentRule.labelSelector, matchLabels }
        };
        setRequiredRules(updated);
        
        const currentValue = form.getFieldValue(name) || {};
        form.setFieldsValue({ [name]: { ...currentValue, required: updated } });
      }
    } else {
      const updated = [...preferredRules];
      const currentRule = updated[ruleIndex];
      if (currentRule?.podAffinityTerm?.labelSelector?.matchLabels) {
        const matchLabels = { ...currentRule.podAffinityTerm.labelSelector.matchLabels };
        const value = matchLabels[oldKey];
        delete matchLabels[oldKey];
        matchLabels[newKey] = value;
        updated[ruleIndex] = {
          ...currentRule,
          podAffinityTerm: {
            ...currentRule.podAffinityTerm,
            labelSelector: { ...currentRule.podAffinityTerm.labelSelector, matchLabels }
          }
        };
        setPreferredRules(updated);
        
        const currentValue = form.getFieldValue(name) || {};
        form.setFieldsValue({ [name]: { ...currentValue, preferred: updated } });
      }
    }
  };

  // 更新标签值
  const updateMatchLabelValue = (ruleType: 'required' | 'preferred', ruleIndex: number, key: string, value: string) => {
    if (ruleType === 'required') {
      const updated = [...requiredRules];
      const currentRule = updated[ruleIndex];
      if (currentRule?.labelSelector?.matchLabels) {
        updated[ruleIndex] = {
          ...currentRule,
          labelSelector: {
            ...currentRule.labelSelector,
            matchLabels: { ...currentRule.labelSelector.matchLabels, [key]: value }
          }
        };
        setRequiredRules(updated);
        
        const currentValue = form.getFieldValue(name) || {};
        form.setFieldsValue({ [name]: { ...currentValue, required: updated } });
      }
    } else {
      const updated = [...preferredRules];
      const currentRule = updated[ruleIndex];
      if (currentRule?.podAffinityTerm?.labelSelector?.matchLabels) {
        updated[ruleIndex] = {
          ...currentRule,
          podAffinityTerm: {
            ...currentRule.podAffinityTerm,
            labelSelector: {
              ...currentRule.podAffinityTerm.labelSelector,
              matchLabels: { ...currentRule.podAffinityTerm.labelSelector.matchLabels, [key]: value }
            }
          }
        };
        setPreferredRules(updated);
        
        const currentValue = form.getFieldValue(name) || {};
        form.setFieldsValue({ [name]: { ...currentValue, preferred: updated } });
      }
    }
  };

  // 添加表达式匹配条件 (matchExpressions)
  const addMatchExpression = (ruleType: 'required' | 'preferred', ruleIndex: number) => {
    const newExpr: PodLabelSelectorRequirement = { key: '', operator: 'In', values: [] };
    const currentValue = form.getFieldValue(name) || {};
    
    if (ruleType === 'required') {
      // 从 form 读取最新数据
      const currentRequired = currentValue?.required || [];
      const currentRule = currentRequired[ruleIndex] || { labelSelector: { matchLabels: {}, matchExpressions: [] }, namespaces: [], topologyKey: 'kubernetes.io/hostname' };
      const currentLabelSelector = currentRule.labelSelector || { matchLabels: {}, matchExpressions: [] };
      
      const newRequired = [...currentRequired];
      newRequired[ruleIndex] = {
        ...currentRule,
        labelSelector: {
          ...currentLabelSelector,
          matchExpressions: [...(currentLabelSelector.matchExpressions || []), newExpr]
        }
      };
      setRequiredRules(newRequired);
      form.setFieldsValue({ [name]: { ...currentValue, required: newRequired } });
    } else {
      // 从 form 读取最新数据
      const currentPreferred = currentValue?.preferred || [];
      const currentRule = currentPreferred[ruleIndex] || { weight: 50, podAffinityTerm: { labelSelector: { matchLabels: {}, matchExpressions: [] }, namespaces: [], topologyKey: 'kubernetes.io/hostname' } };
      const currentPodAffinityTerm = currentRule.podAffinityTerm || { labelSelector: { matchLabels: {}, matchExpressions: [] }, namespaces: [], topologyKey: 'kubernetes.io/hostname' };
      const currentLabelSelector = currentPodAffinityTerm.labelSelector || { matchLabels: {}, matchExpressions: [] };
      
      const newPreferred = [...currentPreferred];
      newPreferred[ruleIndex] = {
        ...currentRule,
        podAffinityTerm: {
          ...currentPodAffinityTerm,
          labelSelector: {
            ...currentLabelSelector,
            matchExpressions: [...(currentLabelSelector.matchExpressions || []), newExpr]
          }
        }
      };
      setPreferredRules(newPreferred);
      form.setFieldsValue({ [name]: { ...currentValue, preferred: newPreferred } });
    }
  };

  // 删除表达式匹配条件 (matchExpressions)
  const removeMatchExpression = (ruleType: 'required' | 'preferred', ruleIndex: number, exprIndex: number) => {
    const currentValue = form.getFieldValue(name) || {};
    
    if (ruleType === 'required') {
      // 从 form 读取最新数据
      const currentRequired = currentValue?.required || [];
      const currentRule = currentRequired[ruleIndex];
      if (currentRule?.labelSelector?.matchExpressions) {
        const newRequired = [...currentRequired];
        newRequired[ruleIndex] = {
          ...currentRule,
          labelSelector: {
            ...currentRule.labelSelector,
            matchExpressions: currentRule.labelSelector.matchExpressions.filter((_: any, i: number) => i !== exprIndex)
          }
        };
        setRequiredRules(newRequired);
        form.setFieldsValue({ [name]: { ...currentValue, required: newRequired } });
      }
    } else {
      // 从 form 读取最新数据
      const currentPreferred = currentValue?.preferred || [];
      const currentRule = currentPreferred[ruleIndex];
      if (currentRule?.podAffinityTerm?.labelSelector?.matchExpressions) {
        const newPreferred = [...currentPreferred];
        newPreferred[ruleIndex] = {
          ...currentRule,
          podAffinityTerm: {
            ...currentRule.podAffinityTerm,
            labelSelector: {
              ...currentRule.podAffinityTerm.labelSelector,
              matchExpressions: currentRule.podAffinityTerm.labelSelector.matchExpressions.filter((_: any, i: number) => i !== exprIndex)
            }
          }
        };
        setPreferredRules(newPreferred);
        form.setFieldsValue({ [name]: { ...currentValue, preferred: newPreferred } });
      }
    }
  };

  // 渲染标签匹配条件 (matchLabels)
  const renderMatchLabels = (ruleType: 'required' | 'preferred', ruleIndex: number) => {
    const matchLabels = ruleType === 'required'
      ? (requiredRules[ruleIndex]?.labelSelector?.matchLabels || {})
      : (preferredRules[ruleIndex]?.podAffinityTerm?.labelSelector?.matchLabels || {});
    
    const entries = Object.entries(matchLabels);
    
    return (
      <div style={{ marginBottom: 12 }}>
        <div style={{ marginBottom: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontWeight: 500, fontSize: 13 }}>匹配标签 (matchLabels)</span>
          <Button
            type="dashed"
            size="small"
            icon={<PlusOutlined />}
            onClick={() => addMatchLabel(ruleType, ruleIndex)}
          >
            添加标签
          </Button>
        </div>
        {entries.map(([key, value], index) => {
          const isTempKey = key.startsWith('__new_label_');
          const displayKey = isTempKey ? '' : key;
          // 使用索引作为 key，避免 key 变化时组件重建
          const rowKey = `${ruleType}-${ruleIndex}-label-${index}`;
          
          return (
            <Row key={rowKey} gutter={8} style={{ marginBottom: 8 }}>
              <Col span={10}>
                <div style={{ position: 'relative' }}>
                  <Input
                    placeholder="标签键 (如: app)"
                    defaultValue={displayKey}
                    status={labelErrors[rowKey]?.key ? 'error' : undefined}
                    onBlur={(e) => {
                      const newKey = e.target.value.trim();
                      const err = validateLabelKey(newKey);
                      setLabelErrors((prev) => ({ ...prev, [rowKey]: { ...prev[rowKey], key: err } }));
                      if (!newKey || err) return;
                      if (newKey !== key) {
                        updateMatchLabelKey(ruleType, ruleIndex, key, newKey);
                      }
                    }}
                    onChange={() => {
                      if (labelErrors[rowKey]?.key) {
                        setLabelErrors((prev) => ({ ...prev, [rowKey]: { ...prev[rowKey], key: undefined } }));
                      }
                    }}
                  />
                  {labelErrors[rowKey]?.key && (
                    <div style={{ color: '#ff4d4f', fontSize: 12, lineHeight: 1.5, marginTop: 2 }}>{labelErrors[rowKey]!.key}</div>
                  )}
                </div>
              </Col>
              <Col span={10}>
                <div style={{ position: 'relative' }}>
                  <Input
                    placeholder="标签值 (如: nginx)"
                    defaultValue={value as string}
                    status={labelErrors[rowKey]?.value ? 'error' : undefined}
                    onBlur={(e) => {
                      const newValue = e.target.value;
                      const err = validateLabelValue(newValue);
                      setLabelErrors((prev) => ({ ...prev, [rowKey]: { ...prev[rowKey], value: err } }));
                      if (err) return;
                      updateMatchLabelValue(ruleType, ruleIndex, key, newValue);
                    }}
                    onChange={(e) => {
                      if (!e.target.value) return;
                      if (labelErrors[rowKey]?.value) {
                        setLabelErrors((prev) => ({ ...prev, [rowKey]: { ...prev[rowKey], value: undefined } }));
                      }
                    }}
                  />
                  {labelErrors[rowKey]?.value && (
                    <div style={{ color: '#ff4d4f', fontSize: 12, lineHeight: 1.5, marginTop: 2 }}>{labelErrors[rowKey]!.value}</div>
                  )}
                </div>
              </Col>
              <Col span={4}>
                <Button
                  type="text"
                  danger
                  icon={<MinusCircleOutlined />}
                  onClick={() => removeMatchLabel(ruleType, ruleIndex, key)}
                />
              </Col>
            </Row>
          );
        })}
        {entries.length === 0 && (
          <div style={{ color: '#999', fontSize: 12 }}>暂无匹配标签</div>
        )}
      </div>
    );
  };

  // 渲染表达式匹配条件 (matchExpressions)
  const renderMatchExpressions = (ruleType: 'required' | 'preferred', ruleIndex: number) => {
    const basePath = ruleType === 'required'
      ? [name, 'required', ruleIndex, 'labelSelector', 'matchExpressions']
      : [name, 'preferred', ruleIndex, 'podAffinityTerm', 'labelSelector', 'matchExpressions'];
    
    const matchExpressions = form.getFieldValue(basePath) || [];

    return (
      <div style={{ marginBottom: 12 }}>
        <div style={{ marginBottom: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontWeight: 500, fontSize: 13 }}>匹配表达式 (matchExpressions)</span>
          <Button
            type="dashed"
            size="small"
            icon={<PlusOutlined />}
            onClick={() => addMatchExpression(ruleType, ruleIndex)}
          >
            添加条件
          </Button>
        </div>
        {matchExpressions.map((_: any, exprIndex: number) => {
          const exprPath = ruleType === 'required'
            ? [name, 'required', ruleIndex, 'labelSelector', 'matchExpressions', exprIndex]
            : [name, 'preferred', ruleIndex, 'podAffinityTerm', 'labelSelector', 'matchExpressions', exprIndex];
          
          const operatorValue = form.getFieldValue([...exprPath, 'operator']);
          const showValues = operatorValue !== 'Exists' && operatorValue !== 'DoesNotExist';

          return (
            <Row key={exprIndex} gutter={8} style={{ marginBottom: 8 }}>
              <Col span={6}>
                <Form.Item name={[...exprPath, 'key']} rules={[{ required: true, message: '请输入标签键' }, { validator: validateNodeLabelKey }]} style={{ marginBottom: 0 }}>
                  <Input placeholder="标签键" />
                </Form.Item>
              </Col>
              <Col span={5}>
                <Form.Item name={[...exprPath, 'operator']} style={{ marginBottom: 0 }}>
                  <Select options={POD_SELECTOR_OPERATOR_OPTIONS} style={{ width: '100%' }} />
                </Form.Item>
              </Col>
              {showValues && (
                <Col span={10}>
                  <Form.Item name={[...exprPath, 'values']} style={{ marginBottom: 0 }}>
                    <Select
                      mode="tags"
                      placeholder="输入值后回车添加"
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
                  onClick={() => removeMatchExpression(ruleType, ruleIndex, exprIndex)}
                />
              </Col>
            </Row>
          );
        })}
        {matchExpressions.length === 0 && (
          <div style={{ color: '#999', fontSize: 12 }}>暂无匹配表达式</div>
        )}
      </div>
    );
  };

  // 渲染单个规则
  const renderRule = (ruleType: 'required' | 'preferred', ruleIndex: number) => {
    const topologyPath = ruleType === 'required'
      ? [name, 'required', ruleIndex, 'topologyKey']
      : [name, 'preferred', ruleIndex, 'podAffinityTerm', 'topologyKey'];
    
    const namespacesPath = ruleType === 'required'
      ? [name, 'required', ruleIndex, 'namespaces']
      : [name, 'preferred', ruleIndex, 'podAffinityTerm', 'namespaces'];
    
    const currentTopologyKey = form.getFieldValue(topologyPath);
    const isCustomTopology = currentTopologyKey && !TOPOLOGY_KEY_OPTIONS.some(opt => opt.value === currentTopologyKey);

    return (
      <Card
        key={ruleIndex}
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
        {/* 标签选择器 */}
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontWeight: 500, marginBottom: 8 }}>
            <InfoCircleOutlined style={{ marginRight: 4 }} />
            目标 Pod 选择器
          </div>
          {renderMatchLabels(ruleType, ruleIndex)}
          {renderMatchExpressions(ruleType, ruleIndex)}
        </div>

        {/* 项目选择器 */}
        <div style={{ marginBottom: 16 }}>
          <Form.Item
            name={namespacesPath}
            label={
              <span>
                项目选择器
                <span style={{ color: '#999', fontSize: 12, marginLeft: 4 }}>(可选，默认为当前项目)</span>
              </span>
            }
          >
            <Select
              mode="multiple"
              placeholder="选择目标项目（可选）"
              allowClear
              options={namespacesOptions.filter((ns) => !isSystemNamespace(ns)).map((ns) => ({ label: ns, value: ns }))}
            />
          </Form.Item>
        </div>

        {/* 拓扑域 */}
        <div>
          <Form.Item
            name={topologyPath}
            label="拓扑域 (topologyKey)"
            rules={[{ required: true, message: '请选择或输入拓扑域' }]}
          >
            {isCustomTopology ? (
              <Input 
                placeholder="自定义拓扑域键"
                onChange={(e) => form.setFieldValue(topologyPath, e.target.value)}
              />
            ) : (
              <Select
                placeholder="选择拓扑域"
                options={TOPOLOGY_KEY_OPTIONS}
                allowClear
                onChange={(value) => {
                  if (value === undefined) {
                    form.setFieldValue(topologyPath, '');
                  }
                }}
              />
            )}
          </Form.Item>
          {!isCustomTopology && (
            <Button
              type="link"
              size="small"
              onClick={() => form.setFieldValue(topologyPath, 'custom-key')}
              style={{ padding: 0 }}
            >
              切换为自定义拓扑域
            </Button>
          )}
          {isCustomTopology && (
            <Button
              type="link"
              size="small"
              onClick={() => form.setFieldValue(topologyPath, 'kubernetes.io/hostname')}
              style={{ padding: 0 }}
            >
              切换为预设选项
            </Button>
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
          未配置 Pod 亲和性规则，点击上方按钮添加
        </div>
      )}

      {/* 必须满足的规则 */}
      {requiredRules.map((_: any, index: number) => renderRule('required', index))}

      {/* 尽量满足的规则 */}
      {preferredRules.map((_: any, index: number) => renderRule('preferred', index))}
    </div>
  );
});

export default PodAffinityEditor;
