/**
 * 环境变量编辑（键值 / ConfigMap / Secret）
 */
import React, { useMemo } from 'react';
import { Form, Input, Select, Button, Space, Tag, Divider, Row, Col } from 'antd';
import { PlusOutlined, MinusCircleOutlined } from '@ant-design/icons';

import { validateEnvVarName } from '../validators';

/** 环境变量类型 */
type EnvVarType = 'keyValue' | 'configMapKeyRef' | 'secretKeyRef';

/** 环境变量表单值 */
interface EnvVarValue {
  type: EnvVarType;
  // 键值对
  name?: string;
  value?: string;
  // ConfigMap 引入
  configMapName?: string;
  configMapKey?: string;
  // Secret 引入
  secretName?: string;
  secretKey?: string;
}

export interface EnvEditorProps {
  cloudId: string;
  namespacesOptions: string[];
  selectedNamespace: string;
  configMaps: Array<{ metadata: { name: string; namespace: string; annotations?: Record<string, string> }; data?: Record<string, string> }>;
  secrets: Array<{ metadata: { name: string; namespace: string; annotations?: Record<string, string> }; data?: Record<string, string> }>;
  onRefreshConfigMaps: () => void;
  onRefreshSecrets: () => void;
  onOpenQuickCreateConfigMap: () => void;
  onOpenQuickCreateSecret: () => void;
}

const EnvEditor: React.FC<EnvEditorProps> = ({
  cloudId: _cloudId,
  namespacesOptions: _namespacesOptions,
  selectedNamespace,
  configMaps,
  secrets,
  onRefreshConfigMaps: _onRefreshConfigMaps,
  onRefreshSecrets: _onRefreshSecrets,
  onOpenQuickCreateConfigMap,
  onOpenQuickCreateSecret,
}) => {
  const form = Form.useFormInstance();
  const envFormValues = Form.useWatch('env', form);
  
  // 按命名空间过滤 ConfigMap 和 Secret
  const filteredConfigMaps = useMemo(() => {
    if (!selectedNamespace) return configMaps || [];
    return (configMaps || []).filter(cm => cm?.metadata?.namespace === selectedNamespace);
  }, [configMaps, selectedNamespace]);
  
  const filteredSecrets = useMemo(() => {
    if (!selectedNamespace) return secrets || [];
    return (secrets || []).filter(s => s?.metadata?.namespace === selectedNamespace);
  }, [secrets, selectedNamespace]);
  
  // 获取 ConfigMap 的 keys
  const getConfigMapKeys = (name: string): string[] => {
    if (!name) return [];
    const cm = filteredConfigMaps.find(c => c.metadata.name === name);
    return cm?.data ? Object.keys(cm.data) : [];
  };

  // 获取 Secret 的 keys
  const getSecretKeys = (name: string): string[] => {
    if (!name) return [];
    const secret = filteredSecrets.find(s => s.metadata.name === name);
    return secret?.data ? Object.keys(secret.data) : [];
  };

  // Form.Item 样式：使用 CSS 类让错误提示使用绝对定位，不影响布局对齐
  const formItemStyle = { marginBottom: 0 };

  // 渲染单个环境变量行
  const renderEnvVar = (
    envVar: EnvVarValue,
    index: number,
    rowKey: React.Key,
    restField: any,
    remove: (index: number) => void,
  ) => {
    if (!envVar) return null;
    
    if (envVar.type === 'keyValue') {
      return (
        <Row key={rowKey} gutter={8} className="env-var-row" align="middle">
          <Form.Item {...restField} name={[index, 'type']} initialValue="keyValue" hidden>
            <Input />
          </Form.Item>
          <Col span={2}>
            <Tag color="green" style={{ marginTop: 4 }}>键值</Tag>
          </Col>
          <Col span={8}>
              <Form.Item
                {...restField}
                name={[index, 'name']}
                rules={[
                  { required: true, message: '变量名必填' },
                  { validator: validateEnvVarName },
                ]}
                style={formItemStyle}
              >
              <Input placeholder="变量名 (如: ENV_KEY)" />
            </Form.Item>
          </Col>
          <Col span={6}>
              <Form.Item
                {...restField}
                name={[index, 'value']}
                rules={[{ required: true, message: '变量值必填' }]}
                style={formItemStyle}
              >
              <Input placeholder="变量值" />
            </Form.Item>
          </Col>
          <Col span={6}>
            <span style={{ color: '#999' }}>-</span>
          </Col>
          <Col span={2}>
            <Button
              type="text"
              danger
              icon={<MinusCircleOutlined />}
              onClick={() => remove(index)}
            />
          </Col>
        </Row>
      );
    }
    
    if (envVar.type === 'configMapKeyRef') {
      // 使用 envFormValues 获取最新值，解决禁用状态延迟问题
      const selectedCM = envFormValues?.[index]?.configMapName;
      const cmKeys = getConfigMapKeys(selectedCM);
      
      return (
        <Row key={rowKey} gutter={8} className="env-var-row" align="middle">
          <Form.Item {...restField} name={[index, 'type']} initialValue="configMapKeyRef" hidden>
            <Input />
          </Form.Item>
          <Col span={2}>
            <Tag color="blue">CM</Tag>
          </Col>
          <Col span={8}>
              <Form.Item
                {...restField}
                name={[index, 'configMapName']}
                rules={[{ required: true, message: '请选择 ConfigMap' }]}
                style={formItemStyle}
              >
              <Select
                placeholder="选择 ConfigMap"
                showSearch
                optionFilterProp="label"
                options={filteredConfigMaps.map(cm => {
                  const alias = cm?.metadata?.annotations?.['tower.io/alias'];
                  const name = cm.metadata.name;
                  return {
                    label: alias ? `${alias} (${name})` : name,
                    value: name,
                  };
                })}
                dropdownRender={(menu) => (
                  <>
                    {menu}
                    <Divider style={{ margin: '8px 0' }} />
                    <Button
                      type="link"
                      icon={<PlusOutlined />}
                      onClick={() => {
                        onOpenQuickCreateConfigMap();
                      }}
                      style={{ width: '100%', textAlign: 'left' }}
                    >
                      快速创建 ConfigMap
                    </Button>
                  </>
                )}
              />
            </Form.Item>
          </Col>
          <Col span={6}>
              <Form.Item
                {...restField}
                name={[index, 'configMapKey']}
                rules={[{ required: true, message: '请选择 Key' }]}
                style={formItemStyle}
              >
              <Select
                placeholder="选择 Key"
                showSearch
                options={cmKeys.map(k => ({ label: k, value: k }))}
                disabled={!selectedCM}
              />
            </Form.Item>
          </Col>
          <Col span={6}>
              <Form.Item
                {...restField}
                name={[index, 'name']}
                style={formItemStyle}
              >
              <Input placeholder="别名 (可选)" />
            </Form.Item>
          </Col>
          <Col span={2}>
            <Button
              type="text"
              danger
              icon={<MinusCircleOutlined />}
              onClick={() => remove(index)}
            />
          </Col>
        </Row>
      );
    }
    
    if (envVar.type === 'secretKeyRef') {
      // 使用 envFormValues 获取最新值，解决禁用状态延迟问题
      const selectedSecret = envFormValues?.[index]?.secretName;
      const secretKeys = getSecretKeys(selectedSecret);
      
      return (
        <Row key={rowKey} gutter={8} className="env-var-row" align="middle">
          <Form.Item {...restField} name={[index, 'type']} initialValue="secretKeyRef" hidden>
            <Input />
          </Form.Item>
          <Col span={2}>
            <Tag color="orange">Secret</Tag>
          </Col>
          <Col span={8}>
              <Form.Item
                {...restField}
                name={[index, 'secretName']}
                rules={[{ required: true, message: '请选择 Secret' }]}
                style={formItemStyle}
              >
              <Select
                placeholder="选择 Secret"
                showSearch
                optionFilterProp="label"
                options={filteredSecrets.map(s => {
                  const alias = s?.metadata?.annotations?.['tower.io/alias'];
                  const name = s.metadata.name;
                  return {
                    label: alias ? `${alias} (${name})` : name,
                    value: name,
                  };
                })}
                dropdownRender={(menu) => (
                  <>
                    {menu}
                    <Divider style={{ margin: '8px 0' }} />
                    <Button
                      type="link"
                      icon={<PlusOutlined />}
                      onClick={() => {
                        onOpenQuickCreateSecret();
                      }}
                      style={{ width: '100%', textAlign: 'left' }}
                    >
                      快速创建 Secret
                    </Button>
                  </>
                )}
              />
            </Form.Item>
          </Col>
          <Col span={6}>
              <Form.Item
                {...restField}
                name={[index, 'secretKey']}
                rules={[{ required: true, message: '请选择 Key' }]}
                style={formItemStyle}
              >
              <Select
                placeholder="选择 Key"
                showSearch
                options={secretKeys.map(k => ({ label: k, value: k }))}
                disabled={!selectedSecret}
              />
            </Form.Item>
          </Col>
          <Col span={6}>
              <Form.Item
                {...restField}
                name={[index, 'name']}
                style={formItemStyle}
              >
              <Input placeholder="别名 (可选)" />
            </Form.Item>
          </Col>
          <Col span={2}>
            <Button
              type="text"
              danger
              icon={<MinusCircleOutlined />}
              onClick={() => remove(index)}
            />
          </Col>
        </Row>
      );
    }
    
    return null;
  };

  return (
    <div>
      <Form.List name="env">
        {(fields, { add, remove }) => {
          const normalizedEnvVars = (envFormValues || []).map((env: any) => {
            if (!env) return undefined;
            if (!env.type) {
              return { type: 'keyValue', name: env.name, value: env.value };
            }
            return env;
          });

          return (
            <>
              <div style={{ marginBottom: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontWeight: 500 }}>环境变量</span>
                <Space>
                  <Button type="dashed" size="small" htmlType="button" onClick={() => add({ type: 'keyValue' }, 0)} icon={<PlusOutlined />}>
                    键值对
                  </Button>
                  <Button type="dashed" size="small" htmlType="button" onClick={() => add({ type: 'configMapKeyRef' }, 0)} icon={<PlusOutlined />}>
                    从 ConfigMap 引入
                  </Button>
                  <Button type="dashed" size="small" htmlType="button" onClick={() => add({ type: 'secretKeyRef' }, 0)} icon={<PlusOutlined />}>
                    从 Secret 引入
                  </Button>
                </Space>
              </div>

              {fields.length > 0 && (
                <Row gutter={8} style={{ marginBottom: 0, paddingBottom: 22, color: '#999', fontSize: 12 }}>
                  <Col span={2}>类型</Col>
                  <Col span={8}>名称/来源</Col>
                  <Col span={6}>值/Key</Col>
                  <Col span={6}>别名</Col>
                  <Col span={2}>操作</Col>
                </Row>
              )}

              {fields.length === 0 && (
                <div style={{ color: '#999', fontSize: 12, padding: '8px 0' }}>
                  暂无环境变量，点击上方按钮添加
                </div>
              )}

              {fields.map(({ key, name, ...restField }, _index) =>
                renderEnvVar(normalizedEnvVars[name] as EnvVarValue, name as number, key, restField, remove)
              )}
            </>
          );
        }}
      </Form.List>
    </div>
  );
};

export default EnvEditor;
