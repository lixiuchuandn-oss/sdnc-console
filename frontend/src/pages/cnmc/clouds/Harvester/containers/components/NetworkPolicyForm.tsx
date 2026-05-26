/**
 * ==============================================================================
 * 模块名称: NetworkPolicy 创建表单
 * 文件路径: frontend/src/pages/cnmc/clouds/Harvester/containers/components/NetworkPolicyForm.tsx
 * ==============================================================================
 * 
 * [功能描述]
 * 表单组件，用于创建 Kubernetes NetworkPolicy 资源。
 * 
 * [表单字段]
 * - 基本信息: 名称、命名空间
 * - Pod 选择器: 标签选择器，用于匹配目标 Pod
 * - 策略类型: 入站、出站、或两者
 * - 入站规则: 来源配置（Pod选择器/项目选择器/IP块）+ 端口配置
 * - 出站规则: 目标配置 + 端口配置
 */

import React, { useState, useEffect, useCallback } from 'react';
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
  Tooltip,
  Radio,
} from 'antd';
import {
  PlusOutlined,
  MinusCircleOutlined,
  InfoCircleOutlined,
  SafetyCertificateOutlined,
  ArrowDownOutlined,
  ArrowUpOutlined,
  ProfileOutlined,
  ApartmentOutlined,
  ImportOutlined,
  ExportOutlined,
  CheckOutlined,
} from '@ant-design/icons';
import { createNetworkPolicy, updateNetworkPolicy } from '../../../../../../services/harvesterApi';
import { generateHarvesterCrMetadataName, generateVmWizardStyleDisplayName, isSystemNamespace } from '../../../../../../utils/harvesterUtils';
import '../../ecs/modals/VmCreateWizard/InstanceWizard.css';

const isValidCidr = (cidr: string): boolean => {
  if (!cidr || typeof cidr !== 'string') return false;
  const parts = cidr.split('/');
  if (parts.length !== 2) return false;
  const [ip, maskStr] = parts;
  const mask = parseInt(maskStr, 10);
  if (isNaN(mask) || maskStr !== String(mask)) return false;
  const isV4 = ip.includes('.');
  const isV6 = ip.includes(':');
  if (isV4 && !isV6) {
    if (mask < 0 || mask > 32) return false;
    const octets = ip.split('.');
    if (octets.length !== 4) return false;
    return octets.every((o) => {
      const n = parseInt(o, 10);
      return !isNaN(n) && n >= 0 && n <= 255 && String(n) === o;
    });
  }
  if (isV6) {
    if (mask < 0 || mask > 128) return false;
    const fullIp = expandIPv6(ip);
    return /^([0-9a-f]{1,4}:){7}[0-9a-f]{1,4}$/i.test(fullIp);
  }
  return false;
};

const expandIPv6 = (ip: string): string => {
  if (ip === '::') return '0000:0000:0000:0000:0000:0000:0000:0000';
  const halves = ip.split('::');
  const left = halves[0] ? halves[0].split(':') : [];
  const right = halves.length > 1 && halves[1] ? halves[1].split(':') : [];
  const missing = 8 - left.length - right.length;
  const expanded = [...left, ...Array(missing).fill('0000'), ...right];
  return expanded.map((seg) => seg.padStart(4, '0')).join(':');
};

const ipv4ToInt = (ip: string): number => {
  const parts = ip.split('.').map(Number);
  return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
};

const ipv6ToSegments = (ip: string): number[] => {
  const expanded = expandIPv6(ip);
  return expanded.split(':').map((seg) => parseInt(seg, 16));
};

const isCidrInRange = (subCidr: string, parentCidr: string): boolean => {
  if (!isValidCidr(subCidr) || !isValidCidr(parentCidr)) return false;
  const [subIp, subMaskStr] = subCidr.split('/');
  const [parentIp, parentMaskStr] = parentCidr.split('/');
  const subIsV6 = subIp.includes(':');
  const parentIsV6 = parentIp.includes(':');
  if (subIsV6 !== parentIsV6) return false;
  const subMask = parseInt(subMaskStr, 10);
  const parentMask = parseInt(parentMaskStr, 10);
  if (subMask < parentMask) return false;
  if (!subIsV6) {
    const subNet = (ipv4ToInt(subIp) >>> (32 - parentMask));
    const parentNet = (ipv4ToInt(parentIp) >>> (32 - parentMask));
    return subNet === parentNet;
  }
  const subSegs = ipv6ToSegments(subIp);
  const parentSegs = ipv6ToSegments(parentIp);
  let bitsChecked = 0;
  for (let i = 0; i < 8 && bitsChecked < parentMask; i++) {
    const segBits = Math.min(16, parentMask - bitsChecked);
    const subSeg = (subSegs[i] >> (16 - segBits)) & ((1 << segBits) - 1);
    const parentSeg = (parentSegs[i] >> (16 - segBits)) & ((1 << segBits) - 1);
    if (subSeg !== parentSeg) return false;
    bitsChecked += 16;
  }
  return true;
};

// ============================================================
// 步骤定义
// ============================================================
const STEPS = [
  { key: 'basic', title: '基本信息', icon: <ProfileOutlined /> },
  { key: 'selector', title: 'Pod 选择器', icon: <ApartmentOutlined /> },
  { key: 'ingress', title: '入站规则', icon: <ImportOutlined /> },
  { key: 'egress', title: '出站规则', icon: <ExportOutlined /> },
];

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
  // 项目选择器
  namespaceSelectorLabels?: LabelItem[];
  // IP 块
  ipBlockCidr?: string;
  ipBlockExcept?: string;
  // 选择类型
  peerType: 'all' | 'podSelector' | 'namespaceSelector' | 'ipBlock';
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
}> = ({ name, label, tooltip, required }) => {
  const form = Form.useFormInstance();

  const getDuplicateKeyValidator = () => ({
    validator: (_: any, value: string) => {
      if (!value) return Promise.resolve();
      const allLabels: LabelItem[] = form.getFieldValue(name as any) || [];
      const sameKeyCount = allLabels.filter((item: LabelItem) => item && item.key === value).length;
      if (sameKeyCount > 1) {
        return Promise.reject(new Error('相同键名的标签会被覆盖，请使用不同的键名'));
      }
      return Promise.resolve();
    },
  });

  return (
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
                  rules={[{ required: true, message: '请输入键' }, getDuplicateKeyValidator()]}
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
              htmlType="button"
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
};

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
        <Tooltip title="不添加端口表示允许所有端口">
          <InfoCircleOutlined style={{ color: '#999' }} />
        </Tooltip>
      </Space>
    </div>
    <Form.List name={name as any}>
      {(fields, { add, remove }) => (
        <div>
          {fields.length === 0 && (
            <Alert
              message="允许所有端口（不限制）"
              type="info"
              showIcon
              style={{ marginBottom: 8 }}
            />
          )}
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
            htmlType="button"
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
  absoluteFieldPath: (string | number)[];
  remove: (index: number) => void;
}> = ({ restField, index, absoluteFieldPath, remove }) => {
  const form = Form.useFormInstance();
  const peerTypePath = [...absoluteFieldPath, 'peerType'];
  const peerType = Form.useWatch(peerTypePath, form) || 'all';

  const handlePeerTypeChange = (e: any) => {
    const newType = e.target.value;
    form.setFieldValue(peerTypePath, newType);
    
    if (newType === 'all') {
      form.setFieldValue([...absoluteFieldPath, 'podSelectorLabels'], []);
      form.setFieldValue([...absoluteFieldPath, 'namespaceSelectorLabels'], []);
      form.setFieldValue([...absoluteFieldPath, 'ipBlockCidr'], undefined);
      form.setFieldValue([...absoluteFieldPath, 'ipBlockExcept'], undefined);
    }
  };

  const getDuplicateKeyValidator = (labelsPath: (string | number)[]) => ({
    validator: (_: any, value: string) => {
      if (!value) return Promise.resolve();
      const allLabels: LabelItem[] = form.getFieldValue(labelsPath) || [];
      const sameKeyCount = allLabels.filter((item: LabelItem) => item && item.key === value).length;
      if (sameKeyCount > 1) {
        return Promise.reject(new Error('相同键名的标签会被覆盖，请使用不同的键名'));
      }
      return Promise.resolve();
    },
  });

  const getCidrValidator = () => ({
    validator: (_: any, value: string) => {
      if (!value) return Promise.resolve();
      if (!isValidCidr(value)) {
        return Promise.reject(new Error('请输入有效的 CIDR 格式，如 10.9.8.0/24 或 2001:db8::/64'));
      }
      return Promise.resolve();
    },
  });

  const getExceptValidator = () => ({
    validator: (_: any, value: string) => {
      if (!value) return Promise.resolve();
      const cidr = form.getFieldValue([...absoluteFieldPath, 'ipBlockCidr']);
      const excepts = value.split(',').map((s: string) => s.trim()).filter(Boolean);
      for (const ex of excepts) {
        if (!isValidCidr(ex)) {
          const hasSlash = ex.includes('/');
          if (!hasSlash) {
            return Promise.reject(new Error(`"${ex}" 不是有效的 CIDR 格式，排除 IP 必须带掩码，如 10.0.0.1/32`));
          }
          return Promise.reject(new Error(`"${ex}" 不是有效的 CIDR 格式`));
        }
        if (cidr && !isCidrInRange(ex, cidr)) {
          return Promise.reject(new Error(`"${ex}" 不在主 CIDR "${cidr}" 范围内`));
        }
      }
      return Promise.resolve();
    },
  });

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
      >
        <Radio.Group size="small" onChange={handlePeerTypeChange} value={peerType}>
          <Radio.Button value="all">全部</Radio.Button>
          <Radio.Button value="podSelector">Pod 选择器</Radio.Button>
          <Radio.Button value="namespaceSelector">项目选择器</Radio.Button>
          <Radio.Button value="ipBlock">IP 地址块</Radio.Button>
        </Radio.Group>
      </Form.Item>
      
      {peerType === 'all' && (
        <Alert
          message="允许所有来源/目标（不限制）"
          type="info"
          showIcon
          style={{ marginBottom: 8 }}
        />
      )}
      
      {peerType === 'podSelector' && (
        <Form.Item label="Pod 标签">
          <Form.List name={[index, 'podSelectorLabels']}>
            {(labelFields, { add: addLabel, remove: removeLabel }) => (
              <div>
                {labelFields.length === 0 && (
                  <Alert
                    message="不添加标签表示选择所有 Pod"
                    type="info"
                    showIcon
                    style={{ marginBottom: 8 }}
                  />
                )}
                {labelFields.map(({ key: lKey, name: lIndex, ...lRest }) => (
                  <div key={lKey} style={{ display: 'flex', marginBottom: 4, alignItems: 'baseline', flexWrap: 'wrap', gap: 8 }}>
                    <Form.Item
                      {...lRest}
                      name={[lIndex, 'key']}
                      rules={[{ required: true, message: '请输入键' }, getDuplicateKeyValidator([...absoluteFieldPath, 'podSelectorLabels'])]}
                      style={{ marginBottom: 0 }}
                    >
                      <Input placeholder="键" style={{ width: 100 }} />
                    </Form.Item>
                    <Form.Item
                      {...lRest}
                      name={[lIndex, 'value']}
                      rules={[{ required: true, message: '请输入值' }]}
                      style={{ marginBottom: 0 }}
                    >
                      <Input placeholder="值" style={{ width: 100 }} />
                    </Form.Item>
                    <MinusCircleOutlined
                      onClick={() => removeLabel(lIndex)}
                      style={{ color: '#ff4d4f', cursor: 'pointer' }}
                    />
                  </div>
                ))}
                <Button
                  type="dashed"
                  size="small"
                  htmlType="button"
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
      
      {peerType === 'namespaceSelector' && (
        <Form.Item label="项目标签">
          <Form.List name={[index, 'namespaceSelectorLabels']}>
            {(labelFields, { add: addLabel, remove: removeLabel }) => (
              <div>
                {labelFields.length === 0 && (
                  <Alert
                    message="不添加标签表示选择所有项目"
                    type="info"
                    showIcon
                    style={{ marginBottom: 8 }}
                  />
                )}
                {labelFields.map(({ key: lKey, name: lIndex, ...lRest }) => (
                  <div key={lKey} style={{ display: 'flex', marginBottom: 4, alignItems: 'baseline', flexWrap: 'wrap', gap: 8 }}>
                    <Form.Item
                      {...lRest}
                      name={[lIndex, 'key']}
                      rules={[{ required: true, message: '请输入键' }, getDuplicateKeyValidator([...absoluteFieldPath, 'namespaceSelectorLabels'])]}
                      style={{ marginBottom: 0 }}
                    >
                      <Input placeholder="键" style={{ width: 100 }} />
                    </Form.Item>
                    <Form.Item
                      {...lRest}
                      name={[lIndex, 'value']}
                      rules={[{ required: true, message: '请输入值' }]}
                      style={{ marginBottom: 0 }}
                    >
                      <Input placeholder="值" style={{ width: 100 }} />
                    </Form.Item>
                    <MinusCircleOutlined
                      onClick={() => removeLabel(lIndex)}
                      style={{ color: '#ff4d4f', cursor: 'pointer' }}
                    />
                  </div>
                ))}
                <Button
                  type="dashed"
                  size="small"
                  htmlType="button"
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
      
      {peerType === 'ipBlock' && (
        <>
          <Form.Item
            {...restField}
            name={[index, 'ipBlockCidr']}
            label="CIDR"
            rules={[{ required: true, message: '请输入 CIDR' }, getCidrValidator()]}
          >
            <Input placeholder="如: 10.0.0.0/24" />
          </Form.Item>
          <Form.Item
            {...restField}
            name={[index, 'ipBlockExcept']}
            label="排除"
            tooltip="排除的 IP 范围，必须为带掩码的 CIDR 格式，多个用逗号分隔"
            rules={[getExceptValidator()]}
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
  absoluteName: (string | number)[];
  label: string;
  isEgress?: boolean;
}> = ({ name, absoluteName, label, isEgress }) => {
  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ marginBottom: 8, fontWeight: 500 }}>
        <Space>
          <span>{label}</span>
          <Tooltip title={`配置${isEgress ? '目标' : '来源'}，可以是 Pod、项目或 IP 地址块`}>
            <InfoCircleOutlined style={{ color: '#999' }} />
          </Tooltip>
        </Space>
      </div>
      <Form.List name={name as any} initialValue={[{ peerType: 'all' }]}>
        {(fields, { add, remove }) => (
          <div>
            {fields.map(({ key, name: index, ...restField }) => (
              <PeerCard
                key={key}
                restField={restField}
                index={index}
                absoluteFieldPath={[...absoluteName, index]}
                remove={remove}
              />
            ))}
            <Button
              type="dashed"
              size="small"
              htmlType="button"
              onClick={() => add({ peerType: 'all' })}
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
    <Form.List name={name as any} initialValue={[{ peers: [{ peerType: 'all' }], ports: [] }]}>
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
                absoluteName={[...(Array.isArray(name) ? name : [name]), index, 'peers']}
                label={isEgress ? '目标' : '来源'}
                isEgress={isEgress}
              />
              <Divider style={{ margin: '12px 0' }} />
              <PortsEditor name={[index, 'ports']} />
            </Card>
          ))}
          <Button
            type="dashed"
            htmlType="button"
            onClick={() => add({ peers: [{ peerType: 'all' }], ports: [] })}
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
  const [currentStep, setCurrentStep] = useState(0);
  const isEdit = mode === 'edit';

  // 固定4个步骤
  const TOTAL_STEPS = 4;

  // 处理步骤切换
  const handleStepClick = async (stepIndex: number) => {
    try {
      await form.validateFields();
      setCurrentStep(stepIndex);
    } catch {
      // 验证失败，留在当前步骤
    }
  };

  // 处理下一步
  const handleNext = async () => {
    try {
      await form.validateFields();
      if (currentStep < TOTAL_STEPS - 1) {
        setCurrentStep(currentStep + 1);
      }
    } catch {
      // 验证失败
    }
  };

  // 处理上一步
  const handlePrev = () => {
    if (currentStep > 0) {
      setCurrentStep(currentStep - 1);
    }
  };

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
        const rawPeers = rule[peerKey];
        const peers = (rawPeers || []).map((peer: any) => {
          // 空的 peer 对象表示允许全部
          if (!peer || Object.keys(peer).length === 0) {
            return { peerType: 'all' };
          }
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

        const normalizedPeers = rawPeers === undefined || rawPeers.length === 0
          ? [{ peerType: 'all' }]
          : peers;
        
        return {
          peers: normalizedPeers,
          ports: (rule.ports || []).map((p: any) => ({
            protocol: p.protocol,
            port: String(p.port),
          })),
        };
      });
    };
    
    return {
      name: data.metadata?.annotations?.['tower.io/alias'] || data.metadata?.name,
      namespace: data.metadata?.namespace,
      labels,
      podSelector,
      ingressRules: convertRules(spec.ingress, false),
      egressRules: convertRules(spec.egress, true),
    };
  }, []);

  // 初始化默认值
  useEffect(() => {
    if (isEdit && initialData) {
      // 编辑模式：回填数据
      const formData = convertK8sToFormData(initialData);
      form.setFieldsValue(formData);
    } else {
      // 创建模式：设置默认值
      const currentValues = form.getFieldsValue();
      // 只有当 namespace 未设置且有可用的 namespacesOptions 时才设置默认值
      if (!currentValues.namespace && namespacesOptions.length > 0) {
        form.setFieldsValue({
          name: currentValues.name || generateVmWizardStyleDisplayName('np'),
          namespace: defaultNamespace || namespacesOptions[0] || 'default',
          labels: currentValues.labels || [],
          podSelector: currentValues.podSelector || [],
          ingressRules: currentValues.ingressRules || [],
          egressRules: currentValues.egressRules || [],
        });
      }
    }
  }, [isEdit, initialData, defaultNamespace, namespacesOptions, form, convertK8sToFormData]);

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
          
          if (peer.peerType === 'all') {
            // 全部来源/目标，返回空对象（不限制）
            return {};
          } else if (peer.peerType === 'podSelector') {
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
        
        // 如果所有 peers 都是 'all' 类型，则移除 peerKey（表示允许所有）
        if (result[peerKey].length === 0) {
          delete result[peerKey];
        }
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
    });
  };

  // 提交表单
  const handleSubmit = async () => {
    setLoading(true);
    try {
      await form.validateFields();
      const values = form.getFieldsValue(true);
      
      // 验证至少配置一种规则
      const hasIngressRules = values.ingressRules && values.ingressRules.length > 0;
      const hasEgressRules = values.egressRules && values.egressRules.length > 0;
      
      if (!hasIngressRules && !hasEgressRules) {
        message.error('请至少配置一种规则（入站规则或出站规则）');
        setLoading(false);
        return;
      }
      
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

      // 确定策略类型
      const policyTypes: ('Ingress' | 'Egress')[] = [];
      if (hasIngressRules) policyTypes.push('Ingress');
      if (hasEgressRules) policyTypes.push('Egress');

      // 构建 NetworkPolicy 资源
      const npBody: any = {
        apiVersion: 'networking.k8s.io/v1',
        kind: 'NetworkPolicy',
        metadata: {
          name: isEdit && initialData ? initialData.metadata?.name : generateHarvesterCrMetadataName('networkpolicy'),
          namespace: values.namespace,
          labels: Object.keys(labels).length > 0 ? labels : undefined,
          annotations: {
            ...(isEdit && initialData ? initialData.metadata?.annotations : {}),
            'tower.io/alias': values.name,
          },
        },
        spec: {
          podSelector,
          policyTypes,
        },
      };

      // 添加入站规则
      if (hasIngressRules) {
        const ingress = buildRules(values.ingressRules, false);
        if (ingress && ingress.length > 0) {
          npBody.spec.ingress = ingress;
        }
      }

      // 添加出站规则
      if (hasEgressRules) {
        const egress = buildRules(values.egressRules, true);
        if (egress && egress.length > 0) {
          npBody.spec.egress = egress;
        }
      }

      if (isEdit && initialData) {
        await updateNetworkPolicy(cloudId, values.namespace, initialData.metadata?.name, npBody);
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

  // 获取当前表单值的摘要
  const getFormSummary = useCallback(() => {
    const values = form.getFieldsValue(true);
    const ingressCount = values.ingressRules?.length || 0;
    const egressCount = values.egressRules?.length || 0;
    
    let policyTypeStr = '未配置';
    if (ingressCount > 0 && egressCount > 0) {
      policyTypeStr = '入站 + 出站';
    } else if (ingressCount > 0) {
      policyTypeStr = '仅入站';
    } else if (egressCount > 0) {
      policyTypeStr = '仅出站';
    }
    
    return {
      name: values.name || '-',
      namespace: values.namespace || '-',
      podSelector: values.podSelector?.length > 0 
        ? values.podSelector.filter((l: any) => l && l.key).map((l: any) => `${l.key}=${l.value}`).join(', ')
        : '所有 Pod',
      policyTypes: policyTypeStr,
      ingressRules: ingressCount,
      egressRules: egressCount,
    };
  }, [form]);

  const [summary, setSummary] = useState(getFormSummary());

  // 监听表单变化更新摘要
  useEffect(() => {
    const updateSummary = () => setSummary(getFormSummary());
    updateSummary();
  }, [currentStep, isEdit, initialData, defaultNamespace, namespacesOptions, getFormSummary]);

  const renderStepContent = () => {
    switch (currentStep) {
      case 0:
        return (
          <Card title="基本信息" size="small" style={{ marginBottom: 16 }}>
            <Row gutter={16}>
              <Col span={12}>
                {isEdit ? (
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
                        { max: 253, message: '名称最多 253 个字符' },
                      ]}
                    >
                      <Input placeholder="my-network-policy" />
                    </Form.Item>
                  </>
                ) : (
                  <Form.Item
                    name="name"
                    label="名称"
                    rules={[
                      { required: true, message: '请输入名称' },
                      { pattern: /^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/, message: '名称只能包含小写字母、数字和连字符' },
                      { max: 253, message: '名称最多 253 个字符' },
                    ]}
                  >
                    <Input placeholder="my-network-policy" />
                  </Form.Item>
                )}
              </Col>
              <Col span={12}>
                <Form.Item
                  name="namespace"
                  label="项目"
                  rules={[{ required: true, message: '请选择项目' }]}
                >
                  <Select
                    showSearch
                    optionFilterProp="label"
                    options={namespacesOptions.filter((ns) => !isSystemNamespace(ns)).map((ns) => ({ label: ns, value: ns }))}
                    disabled={isEdit}
                  />
                </Form.Item>
              </Col>
            </Row>
            <LabelEditor name="labels" label="标签" tooltip="可选，添加到 NetworkPolicy 资源的标签" />
          </Card>
        );
      case 1:
        return (
          <Card title={<Space><SafetyCertificateOutlined /><span>Pod 选择器</span><Tag color="orange">必填</Tag></Space>} size="small" style={{ marginBottom: 16 }}>
            <Alert
              message="选择器用于匹配目标 Pod，规则将应用到匹配的 Pod 上。不添加标签表示选择项目下所有 Pod。"
              type="info"
              showIcon
              style={{ marginBottom: 16 }}
            />
            <LabelEditor name="podSelector" label="标签选择器" tooltip="需要与目标 Pod 的标签匹配" />
          </Card>
        );
      case 2:
        return (
          <Card title={<Space><ArrowDownOutlined style={{ color: '#1890ff' }} /><span>入站规则 (Ingress)</span></Space>} size="small">
            <Alert
              message="入站规则控制进入 Pod 的流量。不添加规则将允许所有入站流量。"
              type="info"
              showIcon
              style={{ marginBottom: 16 }}
            />
            <RuleEditor name="ingressRules" label="入站" isEgress={false} />
          </Card>
        );
      case 3:
        return (
          <Card title={<Space><ArrowUpOutlined style={{ color: '#52c41a' }} /><span>出站规则 (Egress)</span></Space>} size="small">
            <Alert
              message="出站规则控制从 Pod 流出的流量。不添加规则将允许所有出站流量。"
              type="info"
              showIcon
              style={{ marginBottom: 16 }}
            />
            <RuleEditor name="egressRules" label="出站" isEgress={true} />
          </Card>
        );
      default:
        return null;
    }
  };

  const isLastStep = currentStep === TOTAL_STEPS - 1;

  return (
    <Form form={form} layout="vertical" onFinish={handleSubmit} onValuesChange={() => setSummary(getFormSummary())}>
      <Row gutter={[0, 0]} style={{ height: '100%' }}>
        {/* 左侧步骤导航 */}
        <Col span={5}>
          <div className="wizard-sidebar" style={{ padding: '0 8px 0 0', minHeight: 'calc(80vh - 24px)' }}>
            <div>
              {STEPS.map((step, idx) => {
                const isActive = currentStep === idx;
                const isCompleted = currentStep > idx;
                
                return (
                  <div
                    key={step.key}
                    className={`wizard-step ${isActive ? 'active' : ''} ${isCompleted ? 'completed' : ''}`}
                    onClick={() => handleStepClick(idx)}
                  >
                    <div className="wizard-step-icon">
                      {isCompleted ? <CheckOutlined /> : step.icon}
                    </div>
                    <span className="wizard-step-text">{step.title}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </Col>

        {/* 中间表单内容 */}
        <Col span={12} style={{ height: '100%' }}>
          <div style={{ height: 'calc(80vh - 24px)', overflowY: 'auto', padding: '0 30px', scrollbarGutter: 'stable' }}>
            {renderStepContent()}
          </div>
        </Col>

        {/* 右侧配置预览 */}
        <Col span={7} style={{ height: '100%' }}>
          <div style={{ background: '#fff', border: '1px solid #eaeaea', borderRadius: 8, padding: 16, height: 'calc(80vh - 24px)', display: 'flex', flexDirection: 'column' }}>
            <div style={{ borderBottom: '1px solid #f0f0f0', paddingBottom: 12, marginBottom: 12 }}>
              <span style={{ fontSize: 14, fontWeight: 500 }}>配置预览</span>
            </div>
            <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px dashed #f0f0f0' }}>
                  <span style={{ color: '#888' }}>名称</span>
                  <span style={{ color: '#333', fontWeight: 500 }}>{summary.name}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px dashed #f0f0f0' }}>
                  <span style={{ color: '#888' }}>项目</span>
                  <span style={{ color: '#333' }}>{summary.namespace}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px dashed #f0f0f0' }}>
                  <span style={{ color: '#888' }}>Pod 选择器</span>
                  <span style={{ color: '#333', maxWidth: 150, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textAlign: 'right' }}>{summary.podSelector}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px dashed #f0f0f0' }}>
                  <span style={{ color: '#888' }}>规则配置</span>
                  <span style={{ color: '#333' }}>{summary.policyTypes}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px dashed #f0f0f0' }}>
                  <span style={{ color: '#888' }}>入站规则数</span>
                  <span style={{ color: '#1890ff' }}>{summary.ingressRules} 条</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px dashed #f0f0f0' }}>
                  <span style={{ color: '#888' }}>出站规则数</span>
                  <span style={{ color: '#52c41a' }}>{summary.egressRules} 条</span>
                </div>
              </div>
            </div>
            <div style={{ marginTop: 'auto', paddingTop: 16, borderTop: '1px solid #f0f0f0' }}>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                <Button key="cancel" htmlType="button" onClick={onCancel}>取消</Button>
                {currentStep > 0 && (
                  <Button key="prev" htmlType="button" onClick={handlePrev}>上一步</Button>
                )}
                {!isLastStep ? (
                  <Button
                    key="next"
                    type="primary"
                    htmlType="button"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      handleNext();
                    }}
                  >
                    下一步
                  </Button>
                ) : (
                  <Button key="submit" type="primary" htmlType="submit" loading={loading}>
                    {isEdit ? '更新' : '创建'}
                  </Button>
                )}
              </div>
            </div>
          </div>
        </Col>
      </Row>
    </Form>
  );
};

export default NetworkPolicyForm;
