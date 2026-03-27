/**
 * ==============================================================================
 * 模块名称: NetworkPolicy 创建表单
 * 文件路径: src/pages/Clouds/Harvester/containers/components/NetworkPolicyForm.tsx
 * ==============================================================================
 * 
 * [功能描述]
 * 表单组件，用于创建 Kubernetes NetworkPolicy 资源。
 * 
 * [表单字段]
 * - 基本信息: 名称、命名空间
 * - Pod 选择器: 标签选择器，用于匹配目标 Pod
 * - 策略类型: 入站、出站、或两者
 * - 入站规则: 来源配置（Pod选择器/命名空间选择器/IP块）+ 端口配置
 * - 出站规则: 目标配置 + 端口配置
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Form,
  Input,
  Select,
  Button,
  Space,
  Card,
  Tag,
  Divider,
  Row,
  Col,
  App,
  Alert,
  Checkbox,
  Tooltip,
  Radio,
  Collapse,
} from 'antd';
import {
  PlusOutlined,
  MinusCircleOutlined,
  InfoCircleOutlined,
  SafetyCertificateOutlined,
  ArrowDownOutlined,
  ArrowUpOutlined,
} from '@ant-design/icons';
import { createNetworkPolicy, updateNetworkPolicy } from '../../../../../services/harvesterApi';

// ============================================================
// 类型定义
// ============================================================

interface LabelItem {
  key: string;
  value: string;
}

interface PortConfig {
  protocol: 'TCP' | 'UDP' | 'SCTP';
  port: string;
}

interface PeerConfig {
  // Pod 选择器
  podSelectorLabels?: LabelItem[];
  // 命名空间选择器
  namespaceSelectorLabels?: LabelItem[];
  // IP 块
  ipBlockCidr?: string;
  ipBlockExcept?: string;
  // 选择类型
  peerType: 'podSelector' | 'namespaceSelector' | 'ipBlock';
}

interface RuleConfig {
  peers: PeerConfig[];
  ports: PortConfig[];
}

export interface NetworkPolicyFormValues {
  name: string;
  namespace: string;
  labels: LabelItem[];
  // Pod 选择器
  podSelector: LabelItem[];
  // 策略类型
  policyTypes: ('Ingress' | 'Egress')[];
  // 入站规则
  ingressRules: RuleConfig[];
  // 出站规则
  egressRules: RuleConfig[];
}

export interface NetworkPolicyFormProps {
  cloudId: string;
  namespacesOptions: string[];
  onSuccess: () => void;
  onCancel: () => void;
  defaultNamespace?: string;
  initialData?: any; // 编辑时的初始数据
  mode?: 'create' | 'edit'; // 模式：创建或编辑
}

// ============================================================
// 子组件: 标签编辑器
// ============================================================

const LabelEditor: React.FC<{
  name: string | number | (string | number)[];
  label: string;
  tooltip?: string;
  required?: boolean;
}> = ({ name, label, tooltip, required }) => (
  <div style={{ marginBottom: 8 }}>
    <div style={{ marginBottom: 8 }}>
      <Space>
        <span style={{ fontWeight: 500 }}>{label}</span>
        {required && <Tag color="red">必填</Tag>}
        {tooltip && (
          <Tooltip title={tooltip}>
            <InfoCircleOutlined style={{ color: '#999' }} />
          </Tooltip>
        )}
      </Space>
    </div>
    <Form.List name={name as any}>
      {(fields, { add, remove }) => (
        <div>
          {fields.map(({ key, name: index, ...restField }) => (
            <Space key={key} style={{ display: 'flex', marginBottom: 8 }} align="baseline">
              <Form.Item
                {...restField}
                name={[index, 'key']}
                rules={[{ required: true, message: '请输入键' }]}
              >
                <Input placeholder="键 (如: app)" style={{ width: 140 }} />
              </Form.Item>
              <Form.Item
                {...restField}
                name={[index, 'value']}
                rules={[{ required: true, message: '请输入值' }]}
              >
                <Input placeholder="值 (如: nginx)" style={{ width: 140 }} />
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
// 子组件: 端口配置编辑器
// ============================================================

const PortsEditor: React.FC<{
  name: string | number | (string | number)[];
}> = ({ name }) => (
  <div style={{ marginBottom: 8 }}>
    <div style={{ marginBottom: 8, fontWeight: 500 }}>
      <Space>
        <span>端口配置</span>
        <Tooltip title="限制规则只对特定端口生效，不配置则对所有端口生效">
          <InfoCircleOutlined style={{ color: '#999' }} />
        </Tooltip>
      </Space>
    </div>
    <Form.List name={name as any}>
      {(fields, { add, remove }) => (
        <div>
          {fields.map(({ key, name: index, ...restField }) => (
            <Space key={key} style={{ display: 'flex', marginBottom: 8 }} align="baseline">
              <Form.Item
                {...restField}
                name={[index, 'protocol']}
                initialValue="TCP"
              >
                <Select style={{ width: 100 }}>
                  <Select.Option value="TCP">TCP</Select.Option>
                  <Select.Option value="UDP">UDP</Select.Option>
                  <Select.Option value="SCTP">SCTP</Select.Option>
                </Select>
              </Form.Item>
              <Form.Item
                {...restField}
                name={[index, 'port']}
                rules={[{ required: true, message: '请输入端口' }]}
              >
                <Input placeholder="端口号 (如: 80)" style={{ width: 120 }} />
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
            onClick={() => add({ protocol: 'TCP', port: '' })}
            icon={<PlusOutlined />}
          >
            添加端口
          </Button>
        </div>
      )}
    </Form.List>
  </div>
);

// ============================================================
// 子组件: 单个对端卡片（用于监听 peerType 变化）
// ============================================================

const PeerCard: React.FC<{
  restField: any;
  index: number;
  name: string | number | (string | number)[];
  remove: (index: number) => void;
}> = ({ restField, index, name, remove }) => {
  const form = Form.useFormInstance();
  const [peerType, setPeerType] = useState<string>('podSelector');
  const initializedRef = useRef(false);
  
  // 只在首次挂载时从 form 读取值
  useEffect(() => {
    if (initializedRef.current) return;
    initializedRef.current = true;
    
    const path = [...(Array.isArray(name) ? name : [name]), index, 'peerType'];
    const value = form.getFieldValue(path);
    if (value && value !== 'podSelector') {
      setPeerType(value);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handlePeerTypeChange = (e: any) => {
    const newType = e.target.value;
    setPeerType(newType);
    const path = [...(Array.isArray(name) ? name : [name]), index, 'peerType'];
    form.setFieldValue(path, newType);
  };

  return (
    <Card
      size="small"
      style={{ marginBottom: 8, background: '#fafafa' }}
      extra={
        <MinusCircleOutlined
          onClick={() => remove(index)}
          style={{ color: '#ff4d4f', cursor: 'pointer' }}
        />
      }
    >
      <Form.Item
        {...restField}
        name={[index, 'peerType']}
        label="类型"
        initialValue="podSelector"
      >
        <Radio.Group size="small" onChange={handlePeerTypeChange} value={peerType}>
          <Radio.Button value="podSelector">Pod 选择器</Radio.Button>
          <Radio.Button value="namespaceSelector">命名空间选择器</Radio.Button>
          <Radio.Button value="ipBlock">IP 地址块</Radio.Button>
        </Radio.Group>
      </Form.Item>
      
      {/* Pod 选择器 */}
      {peerType === 'podSelector' && (
        <Form.Item label="Pod 标签">
          <Form.List name={[index, 'podSelectorLabels']}>
            {(labelFields, { add: addLabel, remove: removeLabel }) => (
              <div>
                {labelFields.map(({ key: lKey, name: lIndex, ...lRest }) => (
                  <Space key={lKey} style={{ marginBottom: 4 }} align="baseline">
                    <Form.Item
                      {...lRest}
                      name={[lIndex, 'key']}
                      rules={[{ required: true, message: '请输入键' }]}
                    >
                      <Input placeholder="键" style={{ width: 100 }} />
                    </Form.Item>
                    <Form.Item
                      {...lRest}
                      name={[lIndex, 'value']}
                      rules={[{ required: true, message: '请输入值' }]}
                    >
                      <Input placeholder="值" style={{ width: 100 }} />
                    </Form.Item>
                    <MinusCircleOutlined
                      onClick={() => removeLabel(lIndex)}
                      style={{ color: '#ff4d4f', cursor: 'pointer' }}
                    />
                  </Space>
                ))}
                <Button
                  type="dashed"
                  size="small"
                  onClick={() => addLabel()}
                  icon={<PlusOutlined />}
                >
                  添加
                </Button>
              </div>
            )}
          </Form.List>
        </Form.Item>
      )}
      
      {/* 命名空间选择器 */}
      {peerType === 'namespaceSelector' && (
        <Form.Item label="命名空间标签">
          <Form.List name={[index, 'namespaceSelectorLabels']}>
            {(labelFields, { add: addLabel, remove: removeLabel }) => (
              <div>
                {labelFields.map(({ key: lKey, name: lIndex, ...lRest }) => (
                  <Space key={lKey} style={{ marginBottom: 4 }} align="baseline">
                    <Form.Item
                      {...lRest}
                      name={[lIndex, 'key']}
                      rules={[{ required: true, message: '请输入键' }]}
                    >
                      <Input placeholder="键" style={{ width: 100 }} />
                    </Form.Item>
                    <Form.Item
                      {...lRest}
                      name={[lIndex, 'value']}
                      rules={[{ required: true, message: '请输入值' }]}
                    >
                      <Input placeholder="值" style={{ width: 100 }} />
                    </Form.Item>
                    <MinusCircleOutlined
                      onClick={() => removeLabel(lIndex)}
                      style={{ color: '#ff4d4f', cursor: 'pointer' }}
                    />
                  </Space>
                ))}
                <Button
                  type="dashed"
                  size="small"
                  onClick={() => addLabel()}
                  icon={<PlusOutlined />}
                >
                  添加
                </Button>
              </div>
            )}
          </Form.List>
        </Form.Item>
      )}
      
      {/* IP 地址块 */}
      {peerType === 'ipBlock' && (
        <>
          <Form.Item
            {...restField}
            name={[index, 'ipBlockCidr']}
            label="CIDR"
            rules={[{ required: true, message: '请输入 CIDR' }]}
          >
            <Input placeholder="如: 10.0.0.0/24" />
          </Form.Item>
          <Form.Item
            {...restField}
            name={[index, 'ipBlockExcept']}
            label="排除"
            tooltip="排除的 IP 范围，多个用逗号分隔"
          >
            <Input placeholder="如: 10.0.0.1/32, 10.0.0.2/32" />
          </Form.Item>
        </>
      )}
    </Card>
  );
};

// ============================================================
// 子组件: 对端配置编辑器（来源/目标）
// ============================================================

const PeerEditor: React.FC<{
  name: string | number | (string | number)[];
  label: string;
  isEgress?: boolean;
}> = ({ name, label, isEgress }) => {
  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ marginBottom: 8, fontWeight: 500 }}>
        <Space>
          <span>{label}</span>
          <Tooltip title={`配置${isEgress ? '目标' : '来源'}，可以是 Pod、命名空间或 IP 地址块`}>
            <InfoCircleOutlined style={{ color: '#999' }} />
          </Tooltip>
        </Space>
      </div>
      <Form.List name={name as any}>
        {(fields, { add, remove }) => (
          <div>
            {fields.map(({ key, name: index, ...restField }) => (
              <PeerCard
                key={key}
                restField={restField}
                index={index}
                name={name}
                remove={remove}
              />
            ))}
            <Button
              type="dashed"
              size="small"
              onClick={() => add({ peerType: 'podSelector', podSelectorLabels: [] })}
              icon={<PlusOutlined />}
            >
              添加{label}
            </Button>
          </div>
        )}
      </Form.List>
    </div>
  );
};

// ============================================================
// 子组件: 规则编辑器（入站/出站）
// ============================================================

const RuleEditor: React.FC<{
  name: string | number | (string | number)[];
  label: string;
  isEgress?: boolean;
}> = ({ name, label, isEgress }) => (
  <div>
    <Form.List name={name as any}>
      {(fields, { add, remove }) => (
        <div>
          {fields.map(({ key, name: index, ...restField }) => (
            <Card
              key={key}
              size="small"
              title={`规则 ${index + 1}`}
              style={{ marginBottom: 16 }}
              extra={
                <MinusCircleOutlined
                  onClick={() => remove(index)}
                  style={{ color: '#ff4d4f', cursor: 'pointer' }}
                />
              }
            >
              <PeerEditor
                name={[index, 'peers']}
                label={isEgress ? '目标' : '来源'}
                isEgress={isEgress}
              />
              <Divider style={{ margin: '12px 0' }} />
              <PortsEditor name={[index, 'ports']} />
            </Card>
          ))}
          <Button
            type="dashed"
            onClick={() => add({ peers: [], ports: [] })}
            icon={<PlusOutlined />}
            block
          >
            添加{label}规则
          </Button>
        </div>
      )}
    </Form.List>
  </div>
);

// ============================================================
// 主组件
// ============================================================

const NetworkPolicyForm: React.FC<NetworkPolicyFormProps> = ({
  cloudId,
  namespacesOptions,
  onSuccess,
  onCancel,
  defaultNamespace,
  initialData,
  mode = 'create',
}) => {
  const [form] = Form.useForm();
  const { message } = App.useApp();
  const [loading, setLoading] = useState(false);
  const [policyTypes, setPolicyTypes] = useState<('Ingress' | 'Egress')[]>(['Ingress']);
  const isEdit = mode === 'edit';

  // 将 K8s NetworkPolicy 转换为表单数据
  const convertK8sToFormData = useCallback((data: any): any => {
    if (!data) return null;
    
    const spec = data.spec || {};
    
    // 转换标签
    const labels = Object.entries(data.metadata?.labels || {}).map(([key, value]) => ({
      key,
      value: String(value),
    }));
    
    // 转换 Pod 选择器
    const podSelector = Object.entries(spec.podSelector?.matchLabels || {}).map(([key, value]) => ({
      key,
      value: String(value),
    }));
    
    // 转换规则
    const convertRules = (rules: any[], isEgress: boolean): any[] => {
      if (!rules) return [];
      return rules.map((rule) => {
        const peerKey = isEgress ? 'to' : 'from';
        const peers = (rule[peerKey] || []).map((peer: any) => {
          if (peer.podSelector !== undefined) {
            return {
              peerType: 'podSelector',
              podSelectorLabels: Object.entries(peer.podSelector?.matchLabels || {}).map(([k, v]) => ({
                key: k,
                value: String(v),
              })),
            };
          }
          if (peer.namespaceSelector !== undefined) {
            return {
              peerType: 'namespaceSelector',
              namespaceSelectorLabels: Object.entries(peer.namespaceSelector?.matchLabels || {}).map(([k, v]) => ({
                key: k,
                value: String(v),
              })),
            };
          }
          if (peer.ipBlock) {
            return {
              peerType: 'ipBlock',
              ipBlockCidr: peer.ipBlock.cidr,
              ipBlockExcept: peer.ipBlock.except?.join(', '),
            };
          }
          return null;
        }).filter(Boolean);
        
        return {
          peers,
          ports: (rule.ports || []).map((p: any) => ({
            protocol: p.protocol,
            port: String(p.port),
          })),
        };
      });
    };
    
    return {
      name: data.metadata?.name,
      namespace: data.metadata?.namespace,
      policyTypes: spec.policyTypes || ['Ingress'],
      labels,
      podSelector,
      ingressRules: convertRules(spec.ingress, false),
      egressRules: convertRules(spec.egress, true),
    };
  }, []);

  // 初始化默认值（只在首次挂载时执行）
  useEffect(() => {
    if (isEdit && initialData) {
      // 编辑模式：回填数据
      const formData = convertK8sToFormData(initialData);
      form.setFieldsValue(formData);
      setPolicyTypes(formData.policyTypes || ['Ingress']);
    } else {
      // 创建模式：设置默认值
      const currentValues = form.getFieldsValue();
      form.setFieldsValue({
        namespace: currentValues.namespace || defaultNamespace || namespacesOptions[0] || 'default',
        policyTypes: currentValues.policyTypes || ['Ingress'],
        labels: currentValues.labels || [],
        podSelector: currentValues.podSelector || [],
        ingressRules: currentValues.ingressRules || [],
        egressRules: currentValues.egressRules || [],
      });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isEdit, initialData]);

  // 监听策略类型变化
  const handlePolicyTypeChange = useCallback((checkedValues: ('Ingress' | 'Egress')[]) => {
    setPolicyTypes(checkedValues);
  }, []);

  // 构建 K8s NetworkPolicy 规则
  const buildRules = (rules: RuleConfig[], isEgress: boolean) => {
    if (!rules || rules.length === 0) return undefined;
    
    return rules.map((rule) => {
      const result: any = {};
      
      // 构建 peers
      const peerKey = isEgress ? 'to' : 'from';
      if (rule.peers && rule.peers.length > 0) {
        result[peerKey] = rule.peers.map((peer) => {
          const peerResult: any = {};
          
          if (peer.peerType === 'podSelector') {
            const labels: Record<string, string> = {};
            (peer.podSelectorLabels || []).forEach((l) => {
              if (l.key && l.value) labels[l.key] = l.value;
            });
            if (Object.keys(labels).length > 0) {
              peerResult.podSelector = { matchLabels: labels };
            } else {
              peerResult.podSelector = {};
            }
          } else if (peer.peerType === 'namespaceSelector') {
            const labels: Record<string, string> = {};
            (peer.namespaceSelectorLabels || []).forEach((l) => {
              if (l.key && l.value) labels[l.key] = l.value;
            });
            if (Object.keys(labels).length > 0) {
              peerResult.namespaceSelector = { matchLabels: labels };
            } else {
              peerResult.namespaceSelector = {};
            }
          } else if (peer.peerType === 'ipBlock') {
            if (peer.ipBlockCidr) {
              peerResult.ipBlock = { cidr: peer.ipBlockCidr };
              if (peer.ipBlockExcept) {
                peerResult.ipBlock.except = peer.ipBlockExcept.split(',').map((s) => s.trim()).filter(Boolean);
              }
            }
          }
          
          return peerResult;
        }).filter((p: any) => Object.keys(p).length > 0);
      }
      
      // 构建 ports
      if (rule.ports && rule.ports.length > 0) {
        result.ports = rule.ports
          .filter((p) => p.port)
          .map((p) => ({
            protocol: p.protocol,
            port: parseInt(p.port, 10) || p.port,
          }));
      }
      
      return result;
    }).filter((r: any) => Object.keys(r).length > 0);
  };

  // 提交表单
  const handleSubmit = async () => {
    setLoading(true);
    try {
      const values = await form.validateFields();
      
      // 构建 Pod 选择器
      const selector: Record<string, string> = {};
      (values.podSelector || []).forEach((s: LabelItem) => {
        if (s.key && s.value) selector[s.key] = s.value;
      });

      // 空的 podSelector 表示选择所有 Pod
      const podSelector = Object.keys(selector).length > 0 
        ? { matchLabels: selector } 
        : {};

      // 构建标签
      const labels: Record<string, string> = {};
      (values.labels || []).forEach((l: LabelItem) => {
        if (l.key && l.value) labels[l.key] = l.value;
      });

      // 构建 NetworkPolicy 资源
      const npBody: any = {
        apiVersion: 'networking.k8s.io/v1',
        kind: 'NetworkPolicy',
        metadata: {
          name: values.name,
          namespace: values.namespace,
          labels: Object.keys(labels).length > 0 ? labels : undefined,
        },
        spec: {
          podSelector,
          policyTypes: values.policyTypes || [],
        },
      };

      // 添加入站规则
      if (values.policyTypes?.includes('Ingress')) {
        const ingress = buildRules(values.ingressRules, false);
        if (ingress && ingress.length > 0) {
          npBody.spec.ingress = ingress;
        } else {
          // 空规则数组表示允许所有入站流量
          npBody.spec.ingress = [{}];
        }
      }

      // 添加出站规则
      if (values.policyTypes?.includes('Egress')) {
        const egress = buildRules(values.egressRules, true);
        if (egress && egress.length > 0) {
          npBody.spec.egress = egress;
        } else {
          // 空规则数组表示允许所有出站流量
          npBody.spec.egress = [{}];
        }
      }

      if (isEdit && initialData) {
        await updateNetworkPolicy(cloudId, values.namespace, values.name, npBody);
        message.success('网络策略更新成功');
      } else {
        await createNetworkPolicy(cloudId, values.namespace, npBody);
        message.success('网络策略创建成功');
      }
      onSuccess();
    } catch (e: any) {
      console.error(isEdit ? '更新' : '创建', 'NetworkPolicy 失败:', e);
      message.error(e?.message || (isEdit ? '更新失败' : '创建失败'));
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
                { max: 253, message: '名称最多 253 个字符' },
              ]}
            >
              <Input placeholder="my-network-policy" disabled={isEdit} />
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
                disabled={isEdit}
              />
            </Form.Item>
          </Col>
        </Row>
        <LabelEditor 
          name="labels" 
          label="标签" 
          tooltip="可选，添加到 NetworkPolicy 资源的标签"
        />
      </Card>

      {/* Pod 选择器 */}
      <Card 
        title={
          <Space>
            <SafetyCertificateOutlined />
            <span>Pod 选择器</span>
            <Tag color="orange">必填</Tag>
          </Space>
        } 
        size="small" 
        style={{ marginBottom: 16 }}
      >
        <Alert
          message="选择器用于匹配目标 Pod，规则将应用到匹配的 Pod 上。不添加标签表示选择命名空间下所有 Pod。"
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
        />
        <LabelEditor 
          name="podSelector" 
          label="标签选择器" 
          tooltip="需要与目标 Pod 的标签匹配"
        />
      </Card>

      {/* 策略类型 */}
      <Card 
        title="策略类型" 
        size="small" 
        style={{ marginBottom: 16 }}
      >
        <Alert
          message="至少选择一种策略类型。选择后需要配置对应的规则，否则将拒绝所有流量。"
          type="warning"
          showIcon
          style={{ marginBottom: 16 }}
        />
        <Form.Item
          name="policyTypes"
          rules={[{ required: true, message: '请至少选择一种策略类型' }]}
        >
          <Checkbox.Group onChange={handlePolicyTypeChange as any}>
            <Checkbox value="Ingress">
              <Space>
                <ArrowDownOutlined style={{ color: '#1890ff' }} />
                入站规则 (Ingress)
              </Space>
            </Checkbox>
            <Checkbox value="Egress">
              <Space>
                <ArrowUpOutlined style={{ color: '#52c41a' }} />
                出站规则 (Egress)
              </Space>
            </Checkbox>
          </Checkbox.Group>
        </Form.Item>
      </Card>

      {/* 入站规则 */}
      {policyTypes.includes('Ingress') && (
        <Card 
          title={
            <Space>
              <ArrowDownOutlined style={{ color: '#1890ff' }} />
              <span>入站规则 (Ingress)</span>
            </Space>
          }
          size="small" 
          style={{ marginBottom: 16 }}
        >
          <Alert
            message="入站规则控制进入 Pod 的流量。不添加规则将允许所有入站流量。"
            type="info"
            showIcon
            style={{ marginBottom: 16 }}
          />
          <RuleEditor name="ingressRules" label="入站" isEgress={false} />
        </Card>
      )}

      {/* 出站规则 */}
      {policyTypes.includes('Egress') && (
        <Card 
          title={
            <Space>
              <ArrowUpOutlined style={{ color: '#52c41a' }} />
              <span>出站规则 (Egress)</span>
            </Space>
          }
          size="small" 
          style={{ marginBottom: 16 }}
        >
          <Alert
            message="出站规则控制从 Pod 流出的流量。不添加规则将允许所有出站流量。"
            type="info"
            showIcon
            style={{ marginBottom: 16 }}
          />
          <RuleEditor name="egressRules" label="出站" isEgress={true} />
        </Card>
      )}

      {/* 操作按钮 */}
      <div style={{ textAlign: 'right' }}>
        <Space>
          <Button onClick={onCancel}>取消</Button>
          <Button type="primary" htmlType="submit" loading={loading}>
            {isEdit ? '更新' : '创建'}
          </Button>
        </Space>
      </div>
    </Form>
  );
};

export default NetworkPolicyForm;
