/**
 * ==============================================================================
 * 模块名称: 工作负载创建表单 (WorkloadForm)
 * 文件路径: frontend/src/pages/cnmc/clouds/Harvester/containers/components/WorkloadForm.tsx
 * ==============================================================================
 * 
 * [功能描述]
 * 分步骤表单组件，用于创建 Kubernetes 工作负载资源：
 * - Deployment
 * - StatefulSet
 * - DaemonSet
 * 
 * [模式支持]
 * - 表单模式: 分步骤引导填写
 * - YAML 模式: 直接编辑 YAML 定义
 * 
 * [步骤设计]
 * 步骤1: 基本信息 - 名称、命名空间、类型、标签
 * 步骤2: 容器配置 - 镜像、端口、环境变量、资源限制
 * 步骤3: 网络配置 - 网络类型、子网选择、静态IP
 * 步骤4: 存储配置 - 存储卷定义、卷挂载
 * 步骤5: 高级配置 - 副本数、调度、健康检查
 */

import React, { useState, useMemo, useCallback, useEffect, useRef } from 'react';
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
  Switch,
  App,
  Segmented,
  Alert,
  Collapse,
  Radio,
  Checkbox,
  Spin,
} from 'antd';
import {
  PlusOutlined,
  MinusCircleOutlined,
  InfoCircleOutlined,
  CodeOutlined,
  FormOutlined,
  FolderOutlined,
  DownOutlined,
  ProfileOutlined,
  AppstoreOutlined,
  SettingOutlined,
  CheckOutlined,
  CopyOutlined,
  DeleteOutlined,
  GlobalOutlined,
} from '@ant-design/icons';
import { Dropdown } from 'antd';
import yaml from 'js-yaml';
import { createHarvesterContainerResource, updateHarvesterContainerResource, fetchKubeOvnSubnets, fetchKubeOvnVpcs, fetchHarvesterNads } from '../../../../../../services/harvesterApi';
import YamlEditor from '../../../../../../components/YamlEditor';
import '../../ecs/modals/VmCreateWizard/InstanceWizard.css';
import { 
  RegistryBrowserDrawer, 
  QuickCreateRegistrySecretModal,
  QuickCreateConfigMapModal,
  QuickCreateSecretModal,
} from './index';
import { generateHarvesterCrMetadataName, generateVmWizardStyleDisplayName } from '../../../../../../utils/harvesterUtils';

// ============================================================
// 类型定义
// ============================================================

export type WorkloadType = 'deployment' | 'statefulset' | 'daemonset';

// 节点选择器条件操作符
export type NodeSelectorOperator = 'In' | 'NotIn' | 'Exists' | 'DoesNotExist' | 'Gt' | 'Lt';

// 节点选择器条件表达式
export interface NodeSelectorRequirement {
  key: string;
  operator: NodeSelectorOperator;
  values?: string[];
}

// 节点选择器项
export interface NodeSelectorTerm {
  matchExpressions?: NodeSelectorRequirement[];
  matchFields?: NodeSelectorRequirement[];
}

// 节点亲和性权重项
export interface PreferredSchedulingTerm {
  weight: number; // 1-100
  preference: NodeSelectorTerm;
}

// 节点亲和性配置
export interface NodeAffinityConfig {
  required?: {
    nodeSelectorTerms: NodeSelectorTerm[];
  };
  preferred?: PreferredSchedulingTerm[];
}

// Pod 亲和性标签选择器表达式
export interface PodLabelSelectorRequirement {
  key: string;
  operator: 'In' | 'NotIn' | 'Exists' | 'DoesNotExist';
  values?: string[];
}

// Pod 亲和性条件
export interface PodAffinityTerm {
  labelSelector?: {
    matchExpressions?: PodLabelSelectorRequirement[];
    matchLabels?: Record<string, string>;
  };
  namespaces?: string[];
  topologyKey: string;
}

// Pod 亲和性权重项 (用于 preferred)
export interface WeightedPodAffinityTerm {
  weight: number; // 1-100
  podAffinityTerm: PodAffinityTerm;
}

// Pod 亲和性配置
export interface PodAffinityConfig {
  required?: PodAffinityTerm[];
  preferred?: WeightedPodAffinityTerm[];
}

// 完整亲和性配置
export interface AffinityConfig {
  nodeAffinity?: NodeAffinityConfig;
  nodeAntiAffinity?: NodeAffinityConfig;
  podAffinity?: PodAffinityConfig;
  podAntiAffinity?: PodAffinityConfig;
}

// 污点容忍配置
export interface Toleration {
  key?: string;           // 污点键
  operator?: 'Equal' | 'Exists';  // 操作符
  value?: string;         // 污点值 (Equal 时需要)
  effect?: 'NoSchedule' | 'PreferNoSchedule' | 'NoExecute' | 'All';  // 效果
  tolerationSeconds?: number;  // 容忍时间 (NoExecute 时可选)
}

// ============================================================
// 网络配置类型定义
// ============================================================

// 网络模式
export type NetworkMode = 'none' | 'flat_subnet' | 'vpc';

// 扁平子网配置
export interface FlatSubnetConfig {
  subnetName: string;
  subnetNamespace: string;
  nadReference: string;
  cidr?: string;
  gateway?: string;
}

// VPC 子网配置
export interface VpcSubnetConfig {
  vpcName: string;
  subnetName: string;
  subnetNamespace: string;
  nadReference: string;
  cidr?: string;
}

// 网络配置
export interface NetworkConfig {
  networkMode: NetworkMode;
  flatSubnet?: FlatSubnetConfig;
  vpcSubnet?: VpcSubnetConfig;
}

// 存储卷类型
export type VolumeType = 'configMap' | 'secret' | 'persistentVolumeClaim' | 'emptyDir' | 'hostPath';

// 存储卷配置
export interface VolumeConfig {
  name: string;           // 卷名称
  type: VolumeType;       // 卷类型
  // ConfigMap
  configMapName?: string;
  configMapItems?: Array<{ key: string; path: string }>;
  configMapOptional?: boolean;
  // Secret
  secretName?: string;
  secretItems?: Array<{ key: string; path: string }>;
  secretOptional?: boolean;
  // PVC
  claimName?: string;
  readOnly?: boolean;
  // EmptyDir
  emptyDirMedium?: 'default' | 'Memory';
  emptyDirSizeLimit?: string;
  // HostPath
  hostPath?: string;
  hostPathType?: 'Directory' | 'File' | 'Socket' | 'CharDevice' | 'BlockDevice' | 'DirectoryOrCreate' | 'FileOrCreate';
}

// 卷挂载配置
export interface VolumeMountConfig {
  name: string;           // 卷名称（与 VolumeConfig.name 对应）
  mountPath: string;      // 挂载路径
  subPath?: string;       // 子路径
  readOnly?: boolean;     // 只读
}

export interface WorkloadContainerFormValue {
  containerName: string;
  image: string;
  imagePullPolicy: 'Always' | 'IfNotPresent' | 'Never';
  ports: Array<{ containerPort: number; protocol: 'TCP' | 'UDP'; name?: string }>;
  env: Array<any>;
  resources: {
    requests: { cpu?: string; memory?: string };
    limits: { cpu?: string; memory?: string };
  };
  command?: string[];
  args?: string[];
  livenessProbe?: {
    enabled: boolean;
    type: 'httpGet' | 'tcpSocket' | 'exec';
    httpGet?: { path: string; port: number };
    tcpSocket?: { port: number };
    exec?: { command: string[] };
    initialDelaySeconds: number;
    periodSeconds: number;
  };
  readinessProbe?: {
    enabled: boolean;
    type: 'httpGet' | 'tcpSocket' | 'exec';
    httpGet?: { path: string; port: number };
    tcpSocket?: { port: number };
    exec?: { command: string[] };
    initialDelaySeconds: number;
    periodSeconds: number;
  };
  volumeMounts?: VolumeMountConfig[];
  imagePullSecrets?: string[];
}

export interface WorkloadFormValues {
  // 基本信息
  name: string;
  namespace: string;
  workloadType: WorkloadType;
  labels: Array<{ key: string; value: string }>;
  containers: WorkloadContainerFormValue[];
  
  // 容器配置
  containerName: string;
  image: string;
  imagePullPolicy: 'Always' | 'IfNotPresent' | 'Never';
  ports: Array<{ containerPort: number; protocol: 'TCP' | 'UDP'; name?: string }>;
  env: Array<{ name: string; value: string }>;
  resources: {
    requests: { cpu?: string; memory?: string };
    limits: { cpu?: string; memory?: string };
  };
  command?: string[];
  args?: string[];
  
  // 高级配置
  replicas: number;
  imagePullSecrets: string[];
  nodeSelector: Array<{ key: string; value: string }>;
  
  // 亲和性配置
  nodeAffinity?: NodeAffinityConfig;
  nodeAntiAffinity?: NodeAffinityConfig;
  podAffinity?: PodAffinityConfig;
  podAntiAffinity?: PodAffinityConfig;
  
  // 污点容忍
  tolerations?: Toleration[];
  
  // 健康检查
  livenessProbe?: {
    enabled: boolean;
    type: 'httpGet' | 'tcpSocket' | 'exec';
    httpGet?: { path: string; port: number };
    tcpSocket?: { port: number };
    exec?: { command: string[] };
    initialDelaySeconds: number;
    periodSeconds: number;
  };
  readinessProbe?: {
    enabled: boolean;
    type: 'httpGet' | 'tcpSocket' | 'exec';
    httpGet?: { path: string; port: number };
    tcpSocket?: { port: number };
    exec?: { command: string[] };
    initialDelaySeconds: number;
    periodSeconds: number;
  };
  
  // 存储卷配置
  volumes?: VolumeConfig[];
  volumeMounts?: VolumeMountConfig[];
  
  // 网络配置
  networkType?: 'default' | 'flat_subnet' | 'vpc' | 'custom_nad';
  flatSubnet?: string;
  vpcName?: string;
  vpcSubnet?: string;
  customNad?: string;
  enableStaticIP?: boolean;
  staticIP?: string;
}

export interface WorkloadFormProps {
  cloudId: string;
  namespacesOptions: string[];
  imagePullSecrets: Array<{ metadata: { name: string; namespace: string } }>;
  secretsWithCredentials?: any[];  // 包含完整凭证信息的 Secret 列表（用于仓库浏览）
  onRefreshImagePullSecrets?: () => void;  // 刷新镜像拉取凭证列表
  onSuccess: () => void;
  onCancel: () => void;
  defaultNamespace?: string;
  defaultType?: WorkloadType;
  editData?: any; // 编辑模式：传入现有的 workload 数据
  // ConfigMap 和 Secret 相关 props（用于环境变量引入和存储卷挂载）
  configMaps?: Array<{ metadata: { name: string; namespace: string }; data?: Record<string, string> }>;
  secrets?: Array<{ metadata: { name: string; namespace: string }; data?: Record<string, string> }>;
  onRefreshConfigMaps?: () => void;
  onRefreshSecrets?: () => void;
  // PVC 相关 props（用于存储卷挂载）
  persistentVolumeClaims?: Array<{
    metadata: { name: string; namespace: string; annotations?: Record<string, string> };
    raw?: { metadata?: { annotations?: Record<string, string> } };
    annotations?: Record<string, string>;
    alias?: string;
    name?: string;
    namespace?: string;  // 顶层 namespace 字段
    pvcName?: string;
  }>;
  onRefreshPVCs?: () => void;
  // 网络配置相关 props
  hideFlatSubnet?: boolean;  // 是否隐藏扁平子网选项（Harvester 资源池不显示）
}

// ============================================================
// 常量定义
// ============================================================

const WORKLOAD_TYPE_OPTIONS = [
  { value: 'deployment', label: 'Deployment', desc: '无状态应用，支持弹性伸缩' },
  { value: 'statefulset', label: 'StatefulSet', desc: '有状态应用，稳定网络标识' },
  { value: 'daemonset', label: 'DaemonSet', desc: '守护进程，每个节点运行' },
];

const IMAGE_PULL_POLICY_OPTIONS = [
  { value: 'IfNotPresent', label: 'IfNotPresent (本地优先)' },
  { value: 'Always', label: 'Always (始终拉取)' },
  { value: 'Never', label: 'Never (从不拉取)' },
];

const PROTOCOL_OPTIONS = [
  { value: 'TCP', label: 'TCP' },
  { value: 'UDP', label: 'UDP' },
];

const PROBE_TYPE_OPTIONS = [
  { value: 'httpGet', label: 'HTTP 请求' },
  { value: 'tcpSocket', label: 'TCP 端口' },
  { value: 'exec', label: '执行命令' },
];

// 节点选择器操作符选项
const NODE_SELECTOR_OPERATOR_OPTIONS = [
  { value: 'In', label: 'In (值在列表中)' },
  { value: 'NotIn', label: 'NotIn (值不在列表中)' },
  { value: 'Exists', label: 'Exists (标签存在)' },
  { value: 'DoesNotExist', label: 'DoesNotExist (标签不存在)' },
  { value: 'Gt', label: 'Gt (大于)' },
  { value: 'Lt', label: 'Lt (小于)' },
];

// Pod 选择器操作符选项 (用于 Pod 亲和性)
const POD_SELECTOR_OPERATOR_OPTIONS = [
  { value: 'In', label: 'In (值在列表中)' },
  { value: 'NotIn', label: 'NotIn (值不在列表中)' },
  { value: 'Exists', label: 'Exists (标签存在)' },
  { value: 'DoesNotExist', label: 'DoesNotExist (标签不存在)' },
];

// 常用拓扑域键选项
const TOPOLOGY_KEY_OPTIONS = [
  { value: 'kubernetes.io/hostname', label: 'kubernetes.io/hostname (同一节点)' },
  { value: 'topology.kubernetes.io/zone', label: 'topology.kubernetes.io/zone (同一可用区)' },
  { value: 'topology.kubernetes.io/region', label: 'topology.kubernetes.io/region (同一区域)' },
];

// 污点容忍操作符选项
const TOLERATION_OPERATOR_OPTIONS = [
  { value: 'Equal', label: 'Equal (匹配键值)' },
  { value: 'Exists', label: 'Exists (键存在)' },
];

// 污点效果选项
const TOLERATION_EFFECT_OPTIONS = [
  { value: 'NoSchedule', label: 'NoSchedule (不调度新 Pod)' },
  { value: 'PreferNoSchedule', label: 'PreferNoSchedule (尽量不调度)' },
  { value: 'NoExecute', label: 'NoExecute (不调度且驱逐现有 Pod)' },
  { value: 'All', label: 'All (匹配所有效果)' },
];

// 常用污点预设
const COMMON_TOLERATION_PRESETS = [
  { key: 'node-role.kubernetes.io/master', label: 'Master 节点' },
  { key: 'node-role.kubernetes.io/control-plane', label: '控制平面节点' },
  { key: 'node.kubernetes.io/not-ready', label: '节点未就绪' },
  { key: 'node.kubernetes.io/unreachable', label: '节点不可达' },
  { key: 'node.kubernetes.io/disk-pressure', label: '磁盘压力' },
  { key: 'node.kubernetes.io/memory-pressure', label: '内存压力' },
  { key: 'node.kubernetes.io/pid-pressure', label: 'PID 压力' },
  { key: 'node.kubernetes.io/network-unavailable', label: '网络不可用' },
];

// ============================================================
// 子组件: 标签编辑器
// ============================================================

const LabelEditor: React.FC<{
  name: string;
  label: string;
}> = ({ name, label }) => (
  <Form.List name={name}>
    {(fields, { add, remove }) => (
      <div>
        <div style={{ marginBottom: 8 }}>
          <Space>
            <span style={{ fontWeight: 500 }}>{label}</span>
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
              <Input placeholder="键" style={{ width: 150 }} />
            </Form.Item>
            <Form.Item
              {...restField}
              name={[index, 'value']}
              rules={[{ required: true, message: '请输入值' }]}
            >
              <Input placeholder="值" style={{ width: 150 }} />
            </Form.Item>
            <MinusCircleOutlined onClick={() => remove(index)} />
          </Space>
        ))}
      </div>
    )}
  </Form.List>
);

// ============================================================
// 子组件: 端口配置
// ============================================================

const PortsEditor: React.FC = () => (
  <Form.List name="ports">
    {(fields, { add, remove }) => (
      <div>
        <div style={{ marginBottom: 8 }}>
          <Space>
            <span style={{ fontWeight: 500 }}>端口配置</span>
            <Button type="dashed" size="small" onClick={() => add({ protocol: 'TCP' })} icon={<PlusOutlined />}>
              添加端口
            </Button>
          </Space>
        </div>
        {fields.map(({ key, name: index, ...restField }) => (
          <Row key={key} gutter={8} style={{ marginBottom: 8 }}>
            <Col span={6}>
              <Form.Item
                {...restField}
                name={[index, 'name']}
              >
                <Input placeholder="端口名称" />
              </Form.Item>
            </Col>
            <Col span={6}>
              <Form.Item
                {...restField}
                name={[index, 'containerPort']}
                rules={[{ required: true, message: '端口必填' }]}
              >
                <InputNumber placeholder="容器端口" min={1} max={65535} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col span={6}>
              <Form.Item
                {...restField}
                name={[index, 'protocol']}
                initialValue="TCP"
              >
                <Select options={PROTOCOL_OPTIONS} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col span={6}>
              <MinusCircleOutlined onClick={() => remove(index)} style={{ marginTop: 8 }} />
            </Col>
          </Row>
        ))}
      </div>
    )}
  </Form.List>
);

// ============================================================
// 子组件: 环境变量（增强版，支持 ConfigMap/Secret 引入）
// ============================================================

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

interface EnvEditorProps {
  cloudId: string;
  namespacesOptions: string[];
  selectedNamespace: string;
  configMaps: Array<{ metadata: { name: string; namespace: string }; data?: Record<string, string> }>;
  secrets: Array<{ metadata: { name: string; namespace: string }; data?: Record<string, string> }>;
  onRefreshConfigMaps: () => void;
  onRefreshSecrets: () => void;
  onOpenQuickCreateConfigMap: () => void;
  onOpenQuickCreateSecret: () => void;
}

const EnvEditor: React.FC<EnvEditorProps> = ({
  cloudId,
  namespacesOptions,
  selectedNamespace,
  configMaps,
  secrets,
  onRefreshConfigMaps,
  onRefreshSecrets,
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
                rules={[{ required: true, message: '变量名必填' }]}
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
                options={filteredConfigMaps.map(cm => ({
                  label: cm.metadata.name,
                  value: cm.metadata.name,
                }))}
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
                options={filteredSecrets.map(s => ({
                  label: s.metadata.name,
                  value: s.metadata.name,
                }))}
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
                  <Button type="dashed" size="small" htmlType="button" onClick={() => add({ type: 'keyValue' })} icon={<PlusOutlined />}>
                    键值对
                  </Button>
                  <Button type="dashed" size="small" htmlType="button" onClick={() => add({ type: 'configMapKeyRef' })} icon={<PlusOutlined />}>
                    从 ConfigMap 引入
                  </Button>
                  <Button type="dashed" size="small" htmlType="button" onClick={() => add({ type: 'secretKeyRef' })} icon={<PlusOutlined />}>
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

              {fields.map(({ key, name, ...restField }, index) =>
                renderEnvVar(normalizedEnvVars[name] as EnvVarValue, name as number, key, restField, remove)
              )}
            </>
          );
        }}
      </Form.List>
    </div>
  );
};

// ============================================================
// 子组件: 存储卷配置（支持快速创建 ConfigMap/Secret）
// ============================================================

// 存储卷类型选项
const VOLUME_TYPE_OPTIONS = [
  { value: 'configMap', label: 'ConfigMap', desc: '挂载配置数据' },
  { value: 'secret', label: 'Secret', desc: '挂载敏感数据' },
  { value: 'persistentVolumeClaim', label: 'PVC', desc: '持久化存储卷' },
  { value: 'emptyDir', label: 'EmptyDir', desc: '临时存储' },
  { value: 'hostPath', label: 'HostPath', desc: '节点路径' },
];

// HostPath 类型选项
const HOST_PATH_TYPE_OPTIONS = [
  { value: 'Directory', label: 'Directory (目录)' },
  { value: 'DirectoryOrCreate', label: 'DirectoryOrCreate (目录，不存在则创建)' },
  { value: 'File', label: 'File (文件)' },
  { value: 'FileOrCreate', label: 'FileOrCreate (文件，不存在则创建)' },
  { value: 'Socket', label: 'Socket (套接字)' },
  { value: 'CharDevice', label: 'CharDevice (字符设备)' },
  { value: 'BlockDevice', label: 'BlockDevice (块设备)' },
];

// EmptyDir 存储介质选项
const EMPTY_DIR_MEDIUM_OPTIONS = [
  { value: 'default', label: '默认 (节点磁盘)' },
  { value: 'Memory', label: 'Memory (内存临时存储)' },
];

const WORKLOAD_STEPS = [
  { key: 'basic', title: '基本信息', icon: <ProfileOutlined /> },
  { key: 'containers', title: '容器配置', icon: <AppstoreOutlined /> },
  { key: 'network', title: '网络配置', icon: <AppstoreOutlined /> },
  { key: 'storage', title: '存储配置', icon: <FolderOutlined /> },
  { key: 'advanced', title: '高级配置', icon: <SettingOutlined /> },
];

const createEmptyContainer = (fallbackName = ''): WorkloadContainerFormValue => ({
  containerName: fallbackName,
  image: '',
  imagePullPolicy: 'IfNotPresent',
  ports: [],
  env: [],
  resources: { requests: {}, limits: {} },
  command: [],
  args: [],
  livenessProbe: { enabled: false, type: 'httpGet', initialDelaySeconds: 30, periodSeconds: 10 },
  readinessProbe: { enabled: false, type: 'httpGet', initialDelaySeconds: 5, periodSeconds: 10 },
  volumeMounts: [],
  imagePullSecrets: [],
});

const toContainerEditorFields = (container?: Partial<WorkloadContainerFormValue>) => ({
  containerName: container?.containerName || '',
  image: container?.image || '',
  imagePullPolicy: container?.imagePullPolicy || 'IfNotPresent',
  ports: container?.ports || [],
  env: container?.env || [],
  resources: container?.resources || { requests: {}, limits: {} },
  command: container?.command || [],
  args: container?.args || [],
  livenessProbe: container?.livenessProbe || { enabled: false, type: 'httpGet', initialDelaySeconds: 30, periodSeconds: 10 },
  readinessProbe: container?.readinessProbe || { enabled: false, type: 'httpGet', initialDelaySeconds: 5, periodSeconds: 10 },
  volumeMounts: container?.volumeMounts || [],
  imagePullSecrets: container?.imagePullSecrets || [],
});

interface VolumesEditorProps {
  cloudId: string;
  namespacesOptions: string[];
  selectedNamespace: string;
  configMaps: Array<{ metadata: { name: string; namespace: string }; data?: Record<string, string> }>;
  secrets: Array<{ metadata: { name: string; namespace: string }; data?: Record<string, string> }>;
  persistentVolumeClaims?: Array<{
    metadata: { name: string; namespace: string; annotations?: Record<string, string> };
    raw?: { metadata?: { annotations?: Record<string, string> } };
    annotations?: Record<string, string>;
    alias?: string;
    name?: string;
    pvcName?: string;
  }>;
  onRefreshConfigMaps: () => void;
  onRefreshSecrets: () => void;
  onOpenQuickCreateConfigMap: () => void;
  onOpenQuickCreateSecret: () => void;
}

const VolumesEditor: React.FC<VolumesEditorProps> = ({
  cloudId,
  namespacesOptions,
  selectedNamespace,
  configMaps,
  secrets,
  persistentVolumeClaims = [],
  onRefreshConfigMaps,
  onRefreshSecrets,
  onOpenQuickCreateConfigMap,
  onOpenQuickCreateSecret,
}) => {
  const form = Form.useFormInstance();
  const [, forceUpdate] = useState(0);
  
  // 按命名空间过滤资源
  const filteredConfigMaps = useMemo(() => {
    if (!selectedNamespace) return configMaps || [];
    return (configMaps || []).filter(cm => cm?.metadata?.namespace === selectedNamespace);
  }, [configMaps, selectedNamespace]);
  
  const filteredSecrets = useMemo(() => {
    if (!selectedNamespace) return secrets || [];
    return (secrets || []).filter(s => s?.metadata?.namespace === selectedNamespace);
  }, [secrets, selectedNamespace]);
  
  const filteredPVCs = useMemo(() => {
    if (!selectedNamespace) return persistentVolumeClaims || [];
    return (persistentVolumeClaims || []).filter((pvc: any) => {
      const pvcNs = pvc?.metadata?.namespace || pvc?.namespace;
      return pvcNs === selectedNamespace;
    });
  }, [persistentVolumeClaims, selectedNamespace]);
  
  const formValues = Form.useWatch([], form);
  void formValues;
  const volumes = ((form.getFieldValue('volumes') as VolumeConfig[] | undefined) || []).filter(Boolean);
  const volumeMounts = ((form.getFieldValue('volumeMounts') as VolumeMountConfig[] | undefined) || []).filter(Boolean);

  // 添加卷
  const addVolume = (type: VolumeType) => {
    const newVolume: VolumeConfig = { name: '', type };
    const updated = [...volumes, newVolume];
    form.setFieldsValue({ volumes: updated });
    forceUpdate((v) => v + 1);
  };

  // 删除卷
  const removeVolume = (index: number) => {
    const volName = volumes[index]?.name;
    const updated = volumes.filter((_: VolumeConfig, i: number) => i !== index);
    form.setFieldsValue({ volumes: updated });
    
    // 同时删除对应的挂载
    if (volName) {
      const updatedMounts = volumeMounts.filter((m: VolumeMountConfig) => m.name !== volName);
      form.setFieldsValue({ volumeMounts: updatedMounts });
    }
    forceUpdate((v) => v + 1);
  };

  // 添加挂载
  const addVolumeMount = () => {
    const newMount: VolumeMountConfig = { name: '', mountPath: '' };
    const updated = [...volumeMounts, newMount];
    form.setFieldsValue({ volumeMounts: updated });
    forceUpdate((v) => v + 1);
  };

  // 删除挂载
  const removeVolumeMount = (index: number) => {
    const updated = volumeMounts.filter((_: VolumeMountConfig, i: number) => i !== index);
    form.setFieldsValue({ volumeMounts: updated });
    forceUpdate((v) => v + 1);
  };

  // 获取可用的卷名称列表（用于挂载选择）
  const availableVolumeNames = volumes.filter((v: VolumeConfig) => v.name).map((v: VolumeConfig) => v.name);

  // 渲染单个卷配置
  const renderVolume = (volume: VolumeConfig, index: number) => {
    const basePath = ['volumes', index];
    
    return (
      <Card 
        key={index} 
        size="small" 
        style={{ marginBottom: 12 }}
        title={
          <Space>
            <Tag color={volume.type === 'configMap' ? 'blue' : volume.type === 'secret' ? 'orange' : 'green'}>
              {VOLUME_TYPE_OPTIONS.find(o => o.value === volume.type)?.label || volume.type}
            </Tag>
            <span style={{ fontSize: 12, color: '#999' }}>
              {VOLUME_TYPE_OPTIONS.find(o => o.value === volume.type)?.desc}
            </span>
          </Space>
        }
        extra={
          <Button
            type="text"
            danger
            size="small"
            icon={<MinusCircleOutlined />}
            onClick={() => removeVolume(index)}
          >
            删除
          </Button>
        }
      >
        <Row gutter={16}>
          <Col span={12}>
            <Form.Item
              name={[...basePath, 'name']}
              label="卷名称"
              rules={[{ required: true, message: '请输入卷名称' }]}
            >
              <Input placeholder="如: config-volume" />
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item
              name={[...basePath, 'type']}
              label="卷类型"
              rules={[{ required: true, message: '请选择卷类型' }]}
            >
              <Select
                options={VOLUME_TYPE_OPTIONS}
                onChange={(newType) => {
                  // 类型变更时重置该卷配置
                  const updated = [...volumes];
                  const currentName = updated[index]?.name;
                  updated[index] = { name: currentName || '', type: newType };
                  form.setFieldsValue({ volumes: updated });
                  forceUpdate((v) => v + 1);
                }}
              />
            </Form.Item>
          </Col>
        </Row>

        {/* ConfigMap 类型 */}
        {volume.type === 'configMap' && (
          <>
            <Row gutter={16}>
              <Col span={12}>
                <Form.Item
                  name={[...basePath, 'configMapName']}
                  label="ConfigMap"
                  rules={[{ required: true, message: '请选择 ConfigMap' }]}
                >
                  <Select
                    placeholder="选择 ConfigMap"
                    showSearch
                    optionFilterProp="label"
                    options={filteredConfigMaps.map(cm => ({
                      label: cm.metadata.name,
                      value: cm.metadata.name,
                    }))}
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
              <Col span={12}>
                <Form.Item
                  name={[...basePath, 'configMapOptional']}
                  label="可选"
                  valuePropName="checked"
                >
                  <Switch size="small" />
                </Form.Item>
              </Col>
            </Row>
            <Alert
              type="info"
              showIcon
              style={{ marginBottom: 8 }}
              message="ConfigMap 的所有 key 将挂载为文件，文件名为 key 名称"
            />
          </>
        )}

        {/* Secret 类型 */}
        {volume.type === 'secret' && (
          <>
            <Row gutter={16}>
              <Col span={12}>
                <Form.Item
                  name={[...basePath, 'secretName']}
                  label="Secret"
                  rules={[{ required: true, message: '请选择 Secret' }]}
                >
                                <Select
                                  placeholder="选择 Secret"
                                  showSearch
                                  optionFilterProp="label"
                                  options={filteredSecrets.map(s => ({
                                    label: s.metadata.name,
                                    value: s.metadata.name,
                                  }))}                    dropdownRender={(menu) => (
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
              <Col span={12}>
                <Form.Item
                  name={[...basePath, 'secretOptional']}
                  label="可选"
                  valuePropName="checked"
                >
                  <Switch size="small" />
                </Form.Item>
              </Col>
            </Row>
            <Alert
              type="info"
              showIcon
              style={{ marginBottom: 8 }}
              message="Secret 的所有 key 将挂载为文件，文件名为 key 名称"
            />
          </>
        )}

        {/* PVC 类型 */}
        {volume.type === 'persistentVolumeClaim' && (
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item
                name={[...basePath, 'claimName']}
                label="PVC 名称"
                rules={[{ required: true, message: '请选择 PVC' }]}
              >
                <Select
                  placeholder="选择 PVC"
                  showSearch
                  optionFilterProp="label"
                  options={filteredPVCs.map((pvc: any) => {
                    // 从多个位置获取 annotations（优先 rawData）
                    const alias = pvc?.rawData?.metadata?.annotations?.['tower.io/alias']
                      || pvc?.raw?.metadata?.annotations?.['tower.io/alias']
                      || pvc?.metadata?.annotations?.['tower.io/alias']
                      || pvc?.annotations?.['tower.io/alias']
                      || pvc?.alias;
                    const name = pvc?.rawData?.metadata?.name || pvc?.raw?.metadata?.name || pvc?.metadata?.name || pvc?.name || pvc?.pvcName;
                    return {
                      label: alias ? `${alias} (${name})` : name,
                      value: name,
                    };
                  })}
                />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item
                name={[...basePath, 'readOnly']}
                label="只读"
                valuePropName="checked"
              >
                <Switch size="small" />
              </Form.Item>
            </Col>
          </Row>
        )}

        {/* EmptyDir 类型 */}
        {volume.type === 'emptyDir' && (
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item
                name={[...basePath, 'emptyDirMedium']}
                label="存储介质"
                initialValue="default"
              >
                <Select options={EMPTY_DIR_MEDIUM_OPTIONS} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item
                name={[...basePath, 'emptyDirSizeLimit']}
                label="大小限制"
              >
                <Input placeholder="如: 1Gi" />
              </Form.Item>
            </Col>
          </Row>
        )}

        {/* HostPath 类型 */}
        {volume.type === 'hostPath' && (
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item
                name={[...basePath, 'hostPath']}
                label="节点路径"
                rules={[{ required: true, message: '请输入节点路径' }]}
              >
                <Input placeholder="如: /var/data" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item
                name={[...basePath, 'hostPathType']}
                label="路径类型"
              >
                <Select options={HOST_PATH_TYPE_OPTIONS} allowClear placeholder="自动检测" />
              </Form.Item>
            </Col>
          </Row>
        )}
      </Card>
    );
  };

  // 渲染单个挂载配置
  const renderVolumeMount = (mount: VolumeMountConfig, index: number) => {
    const basePath = ['volumeMounts', index];
    
    return (
      <Row key={index} gutter={8} style={{ marginBottom: 8 }} align="middle">
        <Col span={6}>
          <Form.Item
            name={[...basePath, 'name']}
            rules={[{ required: true, message: '请选择卷' }]}
            style={{ marginBottom: 0 }}
          >
            <Select
              placeholder="选择卷"
              showSearch
              options={availableVolumeNames.map((name: string) => ({ label: name, value: name }))}
            />
          </Form.Item>
        </Col>
        <Col span={8}>
          <Form.Item
            name={[...basePath, 'mountPath']}
            rules={[{ required: true, message: '请输入挂载路径' }]}
            style={{ marginBottom: 0 }}
          >
            <Input placeholder="挂载路径 (如: /etc/config)" />
          </Form.Item>
        </Col>
        <Col span={4}>
          <Form.Item
            name={[...basePath, 'subPath']}
            style={{ marginBottom: 0 }}
          >
            <Input placeholder="子路径" />
          </Form.Item>
        </Col>
        <Col span={4}>
          <Form.Item
            name={[...basePath, 'readOnly']}
            valuePropName="checked"
            style={{ marginBottom: 0 }}
          >
            <Switch size="small" /> 只读
          </Form.Item>
        </Col>
        <Col span={2}>
          <Button
            type="text"
            danger
            icon={<MinusCircleOutlined />}
            onClick={() => removeVolumeMount(index)}
          />
        </Col>
      </Row>
    );
  };

  // 存储卷类型下拉菜单
  const volumeTypeMenuItems = VOLUME_TYPE_OPTIONS.map(opt => ({
    key: opt.value,
    label: (
      <span>
        <Tag color={opt.value === 'configMap' ? 'blue' : opt.value === 'secret' ? 'orange' : 'green'} style={{ marginRight: 4 }}>
          {opt.label}
        </Tag>
        <span style={{ color: '#999', fontSize: 12 }}>{opt.desc}</span>
      </span>
    ),
    onClick: () => addVolume(opt.value as VolumeType),
  }));

  return (
    <div>
      {/* 存储卷定义 */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ marginBottom: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontWeight: 500 }}>存储卷定义</span>
          <Dropdown menu={{ items: volumeTypeMenuItems }} trigger={['click']}>
            <Button type="dashed" size="small" icon={<PlusOutlined />}>
              添加存储卷 <DownOutlined />
            </Button>
          </Dropdown>
        </div>
        
        {volumes.length === 0 && (
          <div style={{ color: '#999', fontSize: 12, padding: '8px 0' }}>
            暂无存储卷，点击上方按钮添加
          </div>
        )}
        
        {volumes.map((vol: VolumeConfig, index: number) => renderVolume(vol, index))}
      </div>

      {/* 卷挂载配置 */}
      <div>
        <div style={{ marginBottom: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontWeight: 500 }}>卷挂载配置</span>
          <Button
            type="dashed"
            size="small"
            icon={<PlusOutlined />}
            onClick={addVolumeMount}
            disabled={availableVolumeNames.length === 0}
          >
            添加挂载
          </Button>
        </div>
        
        {volumeMounts.length > 0 && (
          <Row gutter={8} style={{ marginBottom: 8, color: '#999', fontSize: 12 }}>
            <Col span={6}>卷名称</Col>
            <Col span={8}>挂载路径</Col>
            <Col span={4}>子路径</Col>
            <Col span={4}>只读</Col>
            <Col span={2}>操作</Col>
          </Row>
        )}
        
        {volumeMounts.length === 0 && availableVolumeNames.length > 0 && (
          <div style={{ color: '#999', fontSize: 12, padding: '8px 0' }}>
            已定义 {availableVolumeNames.length} 个卷，点击添加挂载
          </div>
        )}
        
        {volumeMounts.map((mount: VolumeMountConfig, index: number) => renderVolumeMount(mount, index))}
      </div>
    </div>
  );
};

// ============================================================
// 子组件: 健康检查配置
// ============================================================

const ProbeEditor: React.FC<{
  name: 'livenessProbe' | 'readinessProbe';
  label: string;
}> = ({ name, label }) => {
  const form = Form.useFormInstance();
  const probeType = Form.useWatch([name, 'type'], form);
  
  return (
    <Card size="small" title={label} style={{ marginBottom: 16 }}>
      <Form.Item name={[name, 'enabled']} label="启用" valuePropName="checked">
        <Switch />
      </Form.Item>
      
      <Form.Item noStyle shouldUpdate>
        {({ getFieldValue }) => {
          const enabled = getFieldValue([name, 'enabled']);
          if (!enabled) return null;
          
          return (
            <>
              <Form.Item name={[name, 'type']} label="检查方式">
                <Select options={PROBE_TYPE_OPTIONS} style={{ width: 150 }} />
              </Form.Item>
              
              {probeType === 'httpGet' && (
                <Row gutter={8}>
                  <Col span={12}>
                    <Form.Item name={[name, 'httpGet', 'path']} label="HTTP 路径">
                      <Input placeholder="/health" />
                    </Form.Item>
                  </Col>
                  <Col span={12}>
                    <Form.Item name={[name, 'httpGet', 'port']} label="端口">
                      <InputNumber min={1} max={65535} style={{ width: '100%' }} />
                    </Form.Item>
                  </Col>
                </Row>
              )}
              
              {probeType === 'tcpSocket' && (
                <Form.Item name={[name, 'tcpSocket', 'port']} label="TCP 端口">
                  <InputNumber min={1} max={65535} style={{ width: 200 }} />
                </Form.Item>
              )}
              
              {probeType === 'exec' && (
                <Form.Item name={[name, 'exec', 'command']} label="执行命令">
                  <Select
                    mode="tags"
                    placeholder="输入命令后按回车添加"
                    style={{ width: '100%' }}
                    tokenSeparators={[' ']}
                  />
                </Form.Item>
              )}
              
              <Row gutter={8}>
                <Col span={12}>
                  <Form.Item 
                    name={[name, 'initialDelaySeconds']} 
                    label="初始延迟(秒)"
                    initialValue={30}
                  >
                    <InputNumber min={0} style={{ width: '100%' }} />
                  </Form.Item>
                </Col>
                <Col span={12}>
                  <Form.Item 
                    name={[name, 'periodSeconds']} 
                    label="检查间隔(秒)"
                    initialValue={10}
                  >
                    <InputNumber min={1} style={{ width: '100%' }} />
                  </Form.Item>
                </Col>
              </Row>
            </>
          );
        }}
      </Form.Item>
    </Card>
  );
};

// ============================================================
// 子组件: 节点亲和性编辑器
// ============================================================

interface NodeAffinityEditorProps {
  name: 'nodeAffinity' | 'nodeAntiAffinity';
  label: string;
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
const NodeAffinityEditor: React.FC<NodeAffinityEditorProps> = ({ name, label }) => {
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
          <Form.Item name={[...basePath, 'key']} noStyle>
            <Input placeholder="标签键 (如: kubernetes.io/os)" />
          </Form.Item>
        </Col>
        <Col span={5}>
          <Form.Item name={[...basePath, 'operator']} noStyle>
            <Select options={NODE_SELECTOR_OPERATOR_OPTIONS} style={{ width: '100%' }} />
          </Form.Item>
        </Col>
        {showValues && (
          <Col span={10}>
            <Form.Item name={[...basePath, 'values']} noStyle>
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
};

// ============================================================
// 子组件: Pod 亲和性编辑器
// ============================================================
interface PodAffinityEditorProps {
  name: 'podAffinity' | 'podAntiAffinity';
  label: string;
  namespacesOptions?: string[];
}

/**
 * Pod 亲和性编辑器组件
 * 支持配置 required (必须) 和 preferred (尽量) 两种类型的规则
 * Pod 亲和性基于标签选择器匹配目标 Pod，并使用拓扑域约束调度位置
 * 
 * 使用 Form.useWatch 监听 form 数据，完全依赖 form 状态
 */
const PodAffinityEditor: React.FC<PodAffinityEditorProps> = ({ name, label, namespacesOptions = [] }) => {
  const form = Form.useFormInstance();
  
  // 本地 state 管理规则列表
  const [requiredRules, setRequiredRules] = useState<PodAffinityTerm[]>([]);
  const [preferredRules, setPreferredRules] = useState<WeightedPodAffinityTerm[]>([]);
  
  // 初始化时从 form 读取值
  useEffect(() => {
    const value = form.getFieldValue(name) || {};
    setRequiredRules(value?.required || []);
    setPreferredRules(value?.preferred || []);
  }, [form, name]);

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
                <Input
                  placeholder="标签键 (如: app)"
                  defaultValue={displayKey}
                  onBlur={(e) => {
                    const newKey = e.target.value.trim();
                    if (newKey && newKey !== key) {
                      // blur 时替换 key
                      updateMatchLabelKey(ruleType, ruleIndex, key, newKey);
                    }
                  }}
                />
              </Col>
              <Col span={10}>
                <Input
                  placeholder="标签值 (如: nginx)"
                  defaultValue={value as string}
                  onBlur={(e) => {
                    updateMatchLabelValue(ruleType, ruleIndex, key, e.target.value);
                  }}
                />
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
                <Form.Item name={[...exprPath, 'key']} noStyle>
                  <Input placeholder="标签键" />
                </Form.Item>
              </Col>
              <Col span={5}>
                <Form.Item name={[...exprPath, 'operator']} noStyle>
                  <Select options={POD_SELECTOR_OPERATOR_OPTIONS} style={{ width: '100%' }} />
                </Form.Item>
              </Col>
              {showValues && (
                <Col span={10}>
                  <Form.Item name={[...exprPath, 'values']} noStyle>
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

        {/* 命名空间选择器 */}
        <div style={{ marginBottom: 16 }}>
          <Form.Item
            name={namespacesPath}
            label={
              <span>
                命名空间选择器
                <span style={{ color: '#999', fontSize: 12, marginLeft: 4 }}>(可选，默认为当前命名空间)</span>
              </span>
            }
          >
            <Select
              mode="multiple"
              placeholder="选择目标命名空间（可选）"
              allowClear
              options={namespacesOptions.map((ns) => ({ label: ns, value: ns }))}
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
};

// ============================================================
// 子组件: 污点容忍编辑器
// ============================================================

/**
 * 污点容忍编辑器组件
 * 支持配置 Kubernetes Tolerations，允许 Pod 调度到有污点的节点
 * 
 * 使用 Form.useWatch 监听 form 数据，完全依赖 form 状态
 */
const TolerationsEditor: React.FC = () => {
  const form = Form.useFormInstance();
  
  // 本地 state 管理规则列表
  const [tolerations, setTolerations] = useState<Toleration[]>([]);
  
  // 初始化时从 form 读取值
  useEffect(() => {
    setTolerations(form.getFieldValue('tolerations') || []);
  }, [form]);

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
                rules={[{ required: showValue, message: 'Equal 操作符需要填写值' }]}
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
};

// ============================================================
// 主组件
// ============================================================

// ============================================================
// 默认 YAML 模板
// ============================================================

const DEFAULT_DEPLOYMENT_YAML = `apiVersion: apps/v1
kind: Deployment
metadata:
  name: my-app
  namespace: default
  labels:
    app: my-app
spec:
  replicas: 1
  selector:
    matchLabels:
      app: my-app
  template:
    metadata:
      labels:
        app: my-app
    spec:
      containers:
        - name: my-app
          image: nginx:latest
          imagePullPolicy: IfNotPresent
          ports:
            - containerPort: 80
              protocol: TCP
          resources:
            requests:
              cpu: 100m
              memory: 128Mi
            limits:
              cpu: 500m
              memory: 512Mi
`;

const DEFAULT_STATEFULSET_YAML = `apiVersion: apps/v1
kind: StatefulSet
metadata:
  name: my-app
  namespace: default
  labels:
    app: my-app
spec:
  replicas: 1
  serviceName: my-app
  selector:
    matchLabels:
      app: my-app
  template:
    metadata:
      labels:
        app: my-app
    spec:
      containers:
        - name: my-app
          image: nginx:latest
          imagePullPolicy: IfNotPresent
          ports:
            - containerPort: 80
              protocol: TCP
`;

const DEFAULT_DAEMONSET_YAML = `apiVersion: apps/v1
kind: DaemonSet
metadata:
  name: my-app
  namespace: default
  labels:
    app: my-app
spec:
  selector:
    matchLabels:
      app: my-app
  template:
    metadata:
      labels:
        app: my-app
    spec:
      containers:
        - name: my-app
          image: nginx:latest
          imagePullPolicy: IfNotPresent
          ports:
            - containerPort: 80
              protocol: TCP
`;

// ============================================================
// 主组件
// ============================================================

const WorkloadForm: React.FC<WorkloadFormProps> = ({
  cloudId,
  namespacesOptions,
  imagePullSecrets,
  secretsWithCredentials,
  onRefreshImagePullSecrets,
  onSuccess,
  onCancel,
  defaultNamespace,
  defaultType = 'deployment',
  editData,
  // ConfigMap 和 Secret 相关 props
  configMaps = [],
  secrets = [],
  onRefreshConfigMaps,
  onRefreshSecrets,
  // PVC 相关 props
  persistentVolumeClaims = [],
  onRefreshPVCs,
  // 网络配置相关 props
  hideFlatSubnet = false,
}) => {
  const { message } = App.useApp();
  const [form] = Form.useForm();
  const [currentStep, setCurrentStep] = useState(0);
  const [loading, setLoading] = useState(false);
  const isEditMode = !!editData;
  const [activeContainerIndex, setActiveContainerIndex] = useState(0);
  
  // YAML 模式状态
  const [mode, setMode] = useState<'form' | 'yaml'>('form');
  const [yamlContent, setYamlContent] = useState<string>(DEFAULT_DEPLOYMENT_YAML);
  const [yamlError, setYamlError] = useState<string>('');
  
  // 仓库浏览器状态
  const [browserVisible, setBrowserVisible] = useState(false);
  const [browserCredential, setBrowserCredential] = useState<any>(null);
  
  // 快速创建镜像凭证弹窗状态
  const [showQuickCreateRegistry, setShowQuickCreateRegistry] = useState(false);
  
  // 快速创建 ConfigMap/Secret 弹窗状态
  const [showQuickCreateConfigMap, setShowQuickCreateConfigMap] = useState(false);
  const [showQuickCreateSecret, setShowQuickCreateSecret] = useState(false);
  
  // 网络配置数据状态
  const [kubeSubnets, setKubeSubnets] = useState<any[]>([]);
  const [kubeVpcs, setKubeVpcs] = useState<any[]>([]);
  const [nads, setNads] = useState<any[]>([]);
  const [loadingNetworkData, setLoadingNetworkData] = useState(false);
  
  const editMetadata = editData?.metadata;
  const syncingContainerRef = useRef(false);
  const watchedImagePullSecretsValue = Form.useWatch('imagePullSecrets', form);
  const watchedImagePullSecrets = useMemo<string[]>(() => watchedImagePullSecretsValue || [], [watchedImagePullSecretsValue]);

  /**
   * 加载 localStorage 中的仓库列表
   */
  const localStorageRegistries = useMemo(() => {
    try {
      const data = localStorage.getItem('harvester-registries');
      return data ? JSON.parse(data) : [];
    } catch {
      return [];
    }
  }, []);

  /**
   * 将 Secret 对象转换为 RegistryBrowser 需要的 credential 格式
   * 只处理 kubernetes.io/dockerconfigjson 类型的 Secret
   */
  const secretToCredential = useCallback((secret: any) => {
    if (!secret) return null;

    try {
      // 只处理 docker-registry 类型的 Secret
      const secretType = secret?.type || secret?.metadata?.annotations?.['kubernetes.io/service-account.name'];
      const isDockerConfig = secretType === 'kubernetes.io/dockerconfigjson' || 
                            secret?.data?.['.dockerconfigjson'];
      
      if (!isDockerConfig) {
        // 非 docker-registry 类型的 Secret，静默跳过
        return null;
      }

      const data = secret?.data?.['.dockerconfigjson'];
      if (!data) {
        // 有类型但缺少数据字段，静默跳过
        return null;
      }

      const decoded = atob(data);
      const config = JSON.parse(decoded);
      const auths = config.auths || {};
      const server = Object.keys(auths)[0];

      if (!server) {
        // 未找到仓库地址，静默跳过
        return null;
      }

      const auth = auths[server];
      let username: string | undefined;
      let password: string | undefined;

      // 尝试从 auth 字段解码（base64 编码的 username:password）
      if (auth?.auth) {
        try {
          const decodedAuth = atob(auth.auth);
          const [u, p] = decodedAuth.split(':');
          username = u;
          password = p;
        } catch {
          // 解码失败，尝试直接获取
          username = auth?.username;
          password = auth?.password;
        }
      } else {
        // 如果没有 auth 字段，尝试直接从 username/password 获取
        username = auth?.username;
        password = auth?.password;
      }

      // 即使没有用户名密码，也可以返回 credential（无认证仓库）
      return {
        name: secret?.metadata?.name,
        namespace: secret?.metadata?.namespace,
        server,
        username: username || undefined,
        password: password || undefined,
        insecure: server.includes('172.16.3.79') || !server.startsWith('https://'),
      };
    } catch {
      // 解析失败，静默跳过
      return null;
    }
  }, []);

  /**
   * 将仓库转换为 RegistryBrowser 需要的 credential 格式
   */
  const registryToCredential = useCallback((registry: any) => {
    if (!registry) return null;

    return {
      name: registry.name,
      namespace: 'default',
      server: registry.server,
      username: registry.username,
      password: registry.password,
      insecure: registry.insecure,
    };
  }, []);

  /**
   * 合并 Secrets 和 localStorage 仓库列表
   */
  const allRegistries = useMemo(() => {
    const registries: any[] = [];

    // 添加 localStorage 仓库列表
    localStorageRegistries.forEach((reg: any) => {
      registries.push({
        source: 'localStorage',
        id: reg.id,
        name: reg.name,
        server: reg.server,
        username: reg.username,
        password: reg.password,
        insecure: reg.insecure,
      });
    });

    // 添加 Kubernetes Secrets
    if (secretsWithCredentials && secretsWithCredentials.length > 0) {
      secretsWithCredentials.forEach((secret: any) => {
        const credential = secretToCredential(secret);
        if (credential) {
          registries.push({
            source: 'secret',
            id: secret?.metadata?.name,
            name: secret?.metadata?.name,
            server: credential.server,
            username: credential.username,
            password: credential.password,
            insecure: credential.insecure,
          });
        }
      });
    }

    return registries;
  }, [localStorageRegistries, secretsWithCredentials, secretToCredential]);

  const syncContainerEditorToForm = useCallback((container: Partial<WorkloadContainerFormValue> | undefined) => {
    syncingContainerRef.current = true;
    form.setFieldsValue(toContainerEditorFields(container));
    queueMicrotask(() => {
      syncingContainerRef.current = false;
    });
  }, [form]);

  const buildActiveContainerFromEditor = useCallback((values: WorkloadFormValues): WorkloadContainerFormValue => {
    const fallbackName = values.name || 'container';
    return {
      containerName: values.containerName || fallbackName,
      image: values.image || '',
      imagePullPolicy: values.imagePullPolicy || 'IfNotPresent',
      ports: values.ports || [],
      env: values.env || [],
      resources: values.resources || { requests: {}, limits: {} },
      command: values.command || [],
      args: values.args || [],
      livenessProbe: values.livenessProbe,
      readinessProbe: values.readinessProbe,
      volumeMounts: values.volumeMounts || [],
      imagePullSecrets: values.imagePullSecrets || [],
    };
  }, []);

  const persistActiveContainerToForm = useCallback(() => {
    const values = form.getFieldsValue(true) as WorkloadFormValues;
    const containers = [...(values.containers || [])];
    const activeContainer = buildActiveContainerFromEditor(values);

    if (containers.length === 0) {
      containers.push(activeContainer);
    } else {
      containers[activeContainerIndex] = activeContainer;
    }

    syncingContainerRef.current = true;
    form.setFieldValue('containers', containers);
    queueMicrotask(() => {
      syncingContainerRef.current = false;
    });

    return containers;
  }, [activeContainerIndex, buildActiveContainerFromEditor, form]);

  const getSyncedFormValues = useCallback((): WorkloadFormValues => {
    const values = form.getFieldsValue(true) as WorkloadFormValues;
    const containers = [...(values.containers || [])];
    const activeContainer = buildActiveContainerFromEditor(values);
    const latestImagePullSecrets = watchedImagePullSecrets.length > 0
      ? watchedImagePullSecrets
      : ((form.getFieldValue('imagePullSecrets') as string[] | undefined) || values.imagePullSecrets || []);

    if (containers.length === 0) {
      containers.push(activeContainer);
    } else {
      containers[activeContainerIndex] = activeContainer;
    }

    return {
      ...values,
      containers,
      imagePullSecrets: latestImagePullSecrets,
    };
  }, [activeContainerIndex, buildActiveContainerFromEditor, form, watchedImagePullSecrets]);

  const handleSelectContainer = useCallback((index: number) => {
    const containers = persistActiveContainerToForm();
    const target = containers?.[index];
    setActiveContainerIndex(index);
    syncContainerEditorToForm(target);
  }, [persistActiveContainerToForm, syncContainerEditorToForm]);

  const handleAddContainer = useCallback(() => {
    const syncedValues = getSyncedFormValues();
    const nextContainers = [...(syncedValues.containers || [])];
    const fallbackName = syncedValues.name ? `${syncedValues.name}-${nextContainers.length + 1}` : `container-${nextContainers.length + 1}`;
    nextContainers.push(createEmptyContainer(fallbackName));
    form.setFieldsValue({ containers: nextContainers });
    setActiveContainerIndex(nextContainers.length - 1);
    syncContainerEditorToForm(nextContainers[nextContainers.length - 1]);
  }, [form, getSyncedFormValues, syncContainerEditorToForm]);

  const handleDuplicateContainer = useCallback(() => {
    const syncedValues = getSyncedFormValues();
    const nextContainers = [...(syncedValues.containers || [])];
    const current = nextContainers[activeContainerIndex];
    if (!current) return;
    nextContainers.splice(activeContainerIndex + 1, 0, {
      ...current,
      containerName: current.containerName ? `${current.containerName}-copy` : `container-${nextContainers.length + 1}`,
      ports: [...(current.ports || [])],
      env: [...(current.env || [])],
      resources: {
        requests: { ...(current.resources?.requests || {}) },
        limits: { ...(current.resources?.limits || {}) },
      },
      command: [...(current.command || [])],
      args: [...(current.args || [])],
      volumeMounts: [...(current.volumeMounts || [])],
    });
    form.setFieldsValue({ containers: nextContainers });
    setActiveContainerIndex(activeContainerIndex + 1);
    syncContainerEditorToForm(nextContainers[activeContainerIndex + 1]);
  }, [activeContainerIndex, form, getSyncedFormValues, syncContainerEditorToForm]);

  const handleRemoveContainer = useCallback(() => {
    const syncedValues = getSyncedFormValues();
    const nextContainers = [...(syncedValues.containers || [])];
    if (nextContainers.length <= 1) {
      message.warning('至少需要保留一个容器');
      return;
    }
    nextContainers.splice(activeContainerIndex, 1);
    const nextIndex = Math.max(0, activeContainerIndex - 1);
    form.setFieldsValue({ containers: nextContainers });
    setActiveContainerIndex(nextIndex);
    syncContainerEditorToForm(nextContainers[nextIndex]);
  }, [activeContainerIndex, form, getSyncedFormValues, message, syncContainerEditorToForm]);

  // 编辑模式：初始化表单数据
  useEffect(() => {
    if (editData) {
      const spec = editData?.spec || {};
      const metadata = editData?.metadata || {};
      const template = spec?.template || {};
      const rawContainers = template?.spec?.containers || [];
      const firstContainer = rawContainers[0] || {};
      
      // 提取标签
      const labels = Object.entries(metadata?.labels || {}).map(([key, value]) => ({ key, value }));
      
      // 提取健康检查（必须在 parseContainer 之前定义）
      const parseProbe = (probe: any) => {
        if (!probe) return undefined;
        const probeType: 'httpGet' | 'tcpSocket' | 'exec' = probe.httpGet ? 'httpGet' : probe.tcpSocket ? 'tcpSocket' : 'exec';
        return {
          enabled: true,
          type: probeType,
          httpGet: probe.httpGet ? { path: probe.httpGet.path, port: probe.httpGet.port } : undefined,
          tcpSocket: probe.tcpSocket ? { port: probe.tcpSocket.port } : undefined,
          exec: probe.exec ? { command: probe.exec.command } : undefined,
          initialDelaySeconds: probe.initialDelaySeconds || 0,
          periodSeconds: probe.periodSeconds || 10,
        };
      };
      
      // 提取端口
      const parseContainer = (container: any): WorkloadContainerFormValue => ({
        containerName: container?.name || '',
        image: container?.image || '',
        imagePullPolicy: container?.imagePullPolicy || 'IfNotPresent',
        ports: (container?.ports || []).map((p: any) => ({
          containerPort: p.containerPort,
          protocol: p.protocol || 'TCP',
          name: p.name,
        })),
        env: (container?.env || []).map((e: any) => ({
          type: e?.valueFrom?.configMapKeyRef ? 'configMapKeyRef' : e?.valueFrom?.secretKeyRef ? 'secretKeyRef' : 'keyValue',
          name: e.name,
          value: e.value,
          configMapName: e?.valueFrom?.configMapKeyRef?.name,
          configMapKey: e?.valueFrom?.configMapKeyRef?.key,
          secretName: e?.valueFrom?.secretKeyRef?.name,
          secretKey: e?.valueFrom?.secretKeyRef?.key,
        })),
        resources: {
          requests: {
            cpu: container?.resources?.requests?.cpu,
            memory: container?.resources?.requests?.memory,
          },
          limits: {
            cpu: container?.resources?.limits?.cpu,
            memory: container?.resources?.limits?.memory,
          },
        },
        command: container?.command,
        args: container?.args,
        livenessProbe: parseProbe(container?.livenessProbe),
        readinessProbe: parseProbe(container?.readinessProbe),
        volumeMounts: (container?.volumeMounts || []).map((mount: any) => ({
          name: mount.name,
          mountPath: mount.mountPath,
          subPath: mount.subPath,
          readOnly: mount.readOnly,
        })),
      });
      
      const containers = rawContainers.length > 0 ? rawContainers.map(parseContainer) : [createEmptyContainer(metadata?.name || 'container')];

      // 提取镜像拉取密钥
      const imagePullSecrets = (template?.spec?.imagePullSecrets || []).map((s: any) => s.name);
      
      // 提取节点选择器
      const nodeSelector = Object.entries(spec?.template?.spec?.nodeSelector || {}).map(([key, value]) => ({ key, value }));
      
      // 提取亲和性配置
      const parseNodeAffinity = (affinity: any): NodeAffinityConfig | undefined => {
        if (!affinity) return undefined;
        
        const result: NodeAffinityConfig = {};
        
        // 解析 required 规则
        if (affinity.requiredDuringSchedulingIgnoredDuringExecution?.nodeSelectorTerms) {
          result.required = {
            nodeSelectorTerms: affinity.requiredDuringSchedulingIgnoredDuringExecution.nodeSelectorTerms.map((term: any) => ({
              matchExpressions: (term.matchExpressions || []).map((expr: any) => ({
                key: expr.key,
                operator: expr.operator,
                values: expr.values,
              })),
              matchFields: (term.matchFields || []).map((field: any) => ({
                key: field.key,
                operator: field.operator,
                values: field.values,
              })),
            })),
          };
        }
        
        // 解析 preferred 规则
        if (affinity.preferredDuringSchedulingIgnoredDuringExecution) {
          result.preferred = affinity.preferredDuringSchedulingIgnoredDuringExecution.map((pref: any) => ({
            weight: pref.weight,
            preference: {
              matchExpressions: (pref.preference.matchExpressions || []).map((expr: any) => ({
                key: expr.key,
                operator: expr.operator,
                values: expr.values,
              })),
              matchFields: (pref.preference.matchFields || []).map((field: any) => ({
                key: field.key,
                operator: field.operator,
                values: field.values,
              })),
            },
          }));
        }
        
        return Object.keys(result).length > 0 ? result : undefined;
      };
      
      // 解析 Pod 亲和性配置
      const parsePodAffinity = (podAffinity: any): PodAffinityConfig | undefined => {
        if (!podAffinity) return undefined;
        
        const result: PodAffinityConfig = {};
        
        // 解析 required 规则
        if (podAffinity.requiredDuringSchedulingIgnoredDuringExecution?.length) {
          result.required = podAffinity.requiredDuringSchedulingIgnoredDuringExecution.map((term: any) => ({
            labelSelector: term.labelSelector ? {
              matchLabels: term.labelSelector.matchLabels || {},
              matchExpressions: (term.labelSelector.matchExpressions || []).map((expr: any) => ({
                key: expr.key,
                operator: expr.operator,
                values: expr.values,
              })),
            } : undefined,
            namespaces: term.namespaces,
            topologyKey: term.topologyKey,
          }));
        }
        
        // 解析 preferred 规则
        if (podAffinity.preferredDuringSchedulingIgnoredDuringExecution?.length) {
          result.preferred = podAffinity.preferredDuringSchedulingIgnoredDuringExecution.map((pref: any) => ({
            weight: pref.weight,
            podAffinityTerm: {
              labelSelector: pref.podAffinityTerm?.labelSelector ? {
                matchLabels: pref.podAffinityTerm.labelSelector.matchLabels || {},
                matchExpressions: (pref.podAffinityTerm.labelSelector.matchExpressions || []).map((expr: any) => ({
                  key: expr.key,
                  operator: expr.operator,
                  values: expr.values,
                })),
              } : undefined,
              namespaces: pref.podAffinityTerm?.namespaces,
              topologyKey: pref.podAffinityTerm?.topologyKey,
            },
          }));
        }
        
        return Object.keys(result).length > 0 ? result : undefined;
      };
      
      const affinity = template?.spec?.affinity;
      
      // 提取污点容忍
      const tolerations = (template?.spec?.tolerations || []).map((t: any) => ({
        key: t.key,
        operator: t.operator || 'Equal',
        value: t.value,
        effect: t.effect,
        tolerationSeconds: t.tolerationSeconds,
      }));
      
      // 设置表单值
      form.setFieldsValue({
        workloadType: editData?.kind?.toLowerCase() || defaultType,
        name: metadata?.annotations?.['tower.io/alias'] || metadata?.name || '',
        namespace: metadata?.namespace || 'default',
        labels,
        containers,
        ...toContainerEditorFields(containers[0] || parseContainer(firstContainer)),
        replicas: spec?.replicas || 1,
        imagePullSecrets,
        nodeSelector,
        nodeAffinity: parseNodeAffinity(affinity?.nodeAffinity),
        nodeAntiAffinity: undefined, // 反亲和性从UI层配置，K8s不区分
        podAffinity: parsePodAffinity(affinity?.podAffinity),
        podAntiAffinity: parsePodAffinity(affinity?.podAntiAffinity),
        tolerations: tolerations.length > 0 ? tolerations : undefined,
      });
      setActiveContainerIndex(0);
      
      // 设置 YAML 内容（过滤掉 managedFields，避免干扰用户编辑）
      const cleanData = {
        ...editData,
        metadata: {
          ...editData.metadata,
          managedFields: undefined, // 不展示内部管理字段
        },
      };
      const yamlStr = yaml.dump(cleanData, { indent: 2 });
      setYamlContent(yamlStr);
    }
  }, [editData, defaultType, form]);
  
  // 获取网络配置数据（扁平子网、VPC、NAD）
  useEffect(() => {
    const fetchNetworkData = async () => {
      setLoadingNetworkData(true);
      try {
        // 并行获取所有网络数据
        const [subnetsRes, vpcsRes, nadsRes] = await Promise.all([
          fetchKubeOvnSubnets(cloudId, false, false, 'underlay').catch(() => ({ items: [] })),
          fetchKubeOvnVpcs(cloudId, false, false, 'vpc').catch(() => ({ items: [] })),
          fetchHarvesterNads(cloudId).catch(() => ({ items: [] })),
        ]);
        
        // 规范化子网数据（参考 VM 创建向导 useHarvesterData.ts）
        const subnetItems: any[] = subnetsRes?.data?.items || subnetsRes?.items || (Array.isArray(subnetsRes) ? subnetsRes : []);
        const normalizedSubnets = subnetItems.map((x: any) => ({
          ...x,
          name: x?.metadata?.name || x?.name,
          namespace: x?.metadata?.namespace || 'default',
          vpc: x?.spec?.vpc || x?.vpc,
          cidr: x?.spec?.cidrBlock || x?.cidr,
        }));
        
        // 规范化 VPC 数据
        const vpcItems: any[] = vpcsRes?.data?.items || vpcsRes?.items || (Array.isArray(vpcsRes) ? vpcsRes : []);
        const normalizedVpcs = vpcItems.map((x: any) => ({
          ...x,
          name: x?.metadata?.name || x?.name,
          alias: x?.metadata?.annotations?.['tower.io/alias'] || x?.annotations?.['tower.io/alias'] || '',
        }));
        
        setKubeSubnets(normalizedSubnets);
        setKubeVpcs(normalizedVpcs);
        setNads(Array.isArray(nadsRes?.items) ? nadsRes.items : (Array.isArray(nadsRes) ? nadsRes : []));
      } catch (error) {
        console.error('获取网络数据失败:', error);
      } finally {
        setLoadingNetworkData(false);
      }
    };
    
    fetchNetworkData();
  }, [cloudId]);
  
  // 扁平子网识别条件
  const isFlatSubnet = useCallback((subnet: any) => {
    const type = subnet?.metadata?.annotations?.['tower.io/subnet-type'];
    return type === 'flat';
  }, []);
  
  const isFlatVpc = useCallback((vpc: string) => {
    return vpc === 'ovn-internal' || vpc === 'ovn-cluster';
  }, []);
  
  // 扁平子网选项
  const flatSubnetOptions = useMemo(() => {
    return (kubeSubnets || [])
      .filter(s => isFlatVpc(s?.vpc || s?.spec?.vpc) && isFlatSubnet(s))
      .map(s => {
        const name = s.name || s?.metadata?.name || '-';
        const alias = s?.metadata?.annotations?.['tower.io/alias'] || s?.annotations?.['tower.io/alias'] || '';
        const cidr = s?.cidr || s?.spec?.cidrBlock || 'N/A';
        const label = alias ? `${alias}(${name})@${cidr}` : `${name}@${cidr}`;
        return {
          label,
          value: name,
          subnet: s,
        };
      });
  }, [kubeSubnets, isFlatSubnet, isFlatVpc]);
  
  // VPC 选项
  const vpcOptions = useMemo(() => {
    return (kubeVpcs || [])
      .filter(v => !isFlatVpc(v?.name || v?.metadata?.name))
      .map(v => {
        const name = v.name || v?.metadata?.name || '-';
        const alias = v.alias || v?.metadata?.annotations?.['tower.io/alias'] || '';
        const label = alias ? `${alias}(${name})` : name;
        return {
          label,
          value: name,
        };
      });
  }, [kubeVpcs, isFlatVpc]);
  
  // 根据选中的 VPC 过滤子网选项
  const selectedVpc = Form.useWatch('vpcName', form);
  const vpcSubnetOptions = useMemo(() => {
    if (!selectedVpc) return [];
    return (kubeSubnets || [])
      .filter(s => (s?.vpc || s?.spec?.vpc) === selectedVpc)
      .map(s => {
        const name = s.name || s?.metadata?.name || '-';
        const alias = s?.metadata?.annotations?.['tower.io/alias'] || s?.annotations?.['tower.io/alias'] || '';
        const cidr = s?.cidr || s?.spec?.cidrBlock || 'N/A';
        const label = alias ? `${alias}(${name})@${cidr}` : `${name}@${cidr}`;
        return {
          label,
          value: name,
          subnet: s,
        };
      });
  }, [kubeSubnets, selectedVpc]);
  
  // NAD 选项（排除 kube-ovn 类型，参考 VM 创建向导）
  const allNadOptions = useMemo(() => {
    const selectedNamespace = form.getFieldValue('namespace') || defaultNamespace || 'default';
    return (nads || [])
      .map((n: any) => {
        const name = n?.metadata?.name || n?.name;
        const ns = n?.metadata?.namespace || n?.namespace || 'default';
        const displayName = n?.spec?.displayName || n?.metadata?.annotations?.['tower.io/alias'] || '';
        
        // 解析 config 获取 type 和 vlan
        let type = 'unknown';
        let vlan: any = undefined;
        try {
          const cfg = JSON.parse(n?.spec?.config || '{}');
          type = String(cfg?.type || 'unknown').toLowerCase();
          vlan = cfg?.vlan;
        } catch {}
        
        // 排除 kube-ovn 类型的 NAD
        if (type === 'kube-ovn') return null;
        
        const isCurrentNs = ns === selectedNamespace;
        const tag = type || '-';
        const labelBase = displayName ? `${displayName}(${name})` : name;
        const label = vlan 
          ? `${labelBase} · ${tag} · VLAN ${vlan}${isCurrentNs ? '' : ` [${ns}]`}`
          : `${labelBase} · ${tag}${isCurrentNs ? '' : ` [${ns}]`}`;
        
        return {
          label,
          value: `${ns}/${name}`,
          nad: n,
          _type: type,
        };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null) // 过滤掉 null
      .sort((a, b) => {
        // 当前命名空间的NAD排在前面
        const aNs = a.value.split('/')[0];
        const bNs = b.value.split('/')[0];
        if (aNs === selectedNamespace && bNs !== selectedNamespace) return -1;
        if (aNs !== selectedNamespace && bNs === selectedNamespace) return 1;
        return a.label.localeCompare(b.label);
      });
  }, [nads, defaultNamespace, form]);
  
  // 监听工作负载类型变化
  const workloadType = Form.useWatch('workloadType', form) || defaultType;
  
  // 获取 API 路径
  const getApiPath = useCallback((type: WorkloadType): string => {
    switch (type) {
      case 'deployment':
        return '/apis/apps/v1/deployments';
      case 'statefulset':
        return '/apis/apps/v1/statefulsets';
      case 'daemonset':
        return '/apis/apps/v1/daemonsets';
      default:
        return '/apis/apps/v1/deployments';
    }
  }, []);
  
  // 根据工作负载类型获取默认 YAML
  const getDefaultYaml = useCallback((type: WorkloadType): string => {
    switch (type) {
      case 'deployment':
        return DEFAULT_DEPLOYMENT_YAML;
      case 'statefulset':
        return DEFAULT_STATEFULSET_YAML;
      case 'daemonset':
        return DEFAULT_DAEMONSET_YAML;
      default:
        return DEFAULT_DEPLOYMENT_YAML;
    }
  }, []);
  
  // 构建 Kubernetes 资源定义
  const buildK8sResource = useCallback((values: WorkloadFormValues): any => {
    const {
      name,
      namespace,
      workloadType,
      labels,
      containers,
      replicas,
      nodeSelector,
      nodeAffinity,
      nodeAntiAffinity,
      podAffinity,
      podAntiAffinity,
      tolerations,
      volumes,
      // 网络配置
      networkType,
      flatSubnet,
      vpcName,
      vpcSubnet,
      customNad,
      enableStaticIP,
      staticIP,
    } = values;
    
    // 构建标签
    const labelsMap: Record<string, string> = { app: name };
    (labels || []).forEach((item) => {
      if (item.key && item.value) {
        labelsMap[item.key] = item.value;
      }
    });
    
    // 构建探针
    const buildProbe = (probe?: WorkloadContainerFormValue['livenessProbe']) => {
      if (!probe?.enabled) return undefined;
      
      let probeConfig: any = {
        initialDelaySeconds: probe.initialDelaySeconds || 30,
        periodSeconds: probe.periodSeconds || 10,
      };
      
      if (probe.type === 'httpGet' && probe.httpGet) {
        probeConfig.httpGet = {
          path: probe.httpGet.path || '/health',
          port: probe.httpGet.port,
        };
      } else if (probe.type === 'tcpSocket' && probe.tcpSocket) {
        probeConfig.tcpSocket = {
          port: probe.tcpSocket.port,
        };
      } else if (probe.type === 'exec' && probe.exec?.command) {
        probeConfig.exec = {
          command: probe.exec.command,
        };
      }
      
      return probeConfig;
    };
    
    const buildEnvList = (env: any[] = []) => env.map((item: any) => {
      const envVar: any = {};

      if (item.type === 'configMapKeyRef') {
        envVar.name = item.name || item.configMapKey;
        envVar.valueFrom = {
          configMapKeyRef: {
            name: item.configMapName,
            key: item.configMapKey,
          },
        };
      } else if (item.type === 'secretKeyRef') {
        envVar.name = item.name || item.secretKey;
        envVar.valueFrom = {
          secretKeyRef: {
            name: item.secretName,
            key: item.secretKey,
          },
        };
      } else {
        envVar.name = item.name;
        envVar.value = item.value;
      }

      return envVar;
    }).filter((item: any) => item.name);

    const buildPortsList = (ports: any[] = []) => ports.map((item) => ({
      name: item.name || `port-${item.containerPort}`,
      containerPort: item.containerPort,
      protocol: item.protocol,
    }));

    const buildResourceRequirements = (resources: WorkloadContainerFormValue['resources']) => {
      const resourceRequirements: any = {};
      if (resources?.requests?.cpu || resources?.requests?.memory) {
        resourceRequirements.requests = {};
        if (resources.requests.cpu) resourceRequirements.requests.cpu = resources.requests.cpu;
        if (resources.requests.memory) resourceRequirements.requests.memory = resources.requests.memory;
      }
      if (resources?.limits?.cpu || resources?.limits?.memory) {
        resourceRequirements.limits = {};
        if (resources.limits.cpu) resourceRequirements.limits.cpu = resources.limits.cpu;
        if (resources.limits.memory) resourceRequirements.limits.memory = resources.limits.memory;
      }
      return resourceRequirements;
    };

    const containerList = (containers && containers.length > 0 ? containers : [createEmptyContainer(name)]).map((container, index) => {
      const envList = buildEnvList(container.env || []);
      const portsList = buildPortsList(container.ports || []);
      const resourceRequirements = buildResourceRequirements(container.resources);

      return {
        name: container.containerName || (index === 0 ? name : `${name}-${index + 1}`),
        image: container.image,
        imagePullPolicy: container.imagePullPolicy,
        ports: portsList.length > 0 ? portsList : undefined,
        env: envList.length > 0 ? envList : undefined,
        resources: Object.keys(resourceRequirements).length > 0 ? resourceRequirements : undefined,
        command: container.command?.length ? container.command : undefined,
        args: container.args?.length ? container.args : undefined,
        livenessProbe: buildProbe(container.livenessProbe),
        readinessProbe: buildProbe(container.readinessProbe),
        volumeMounts: (container.volumeMounts || []).length > 0 ? (container.volumeMounts || []).map((m) => ({
          name: m.name,
          mountPath: m.mountPath,
          subPath: m.subPath,
          readOnly: m.readOnly,
        })) : undefined,
      };
    }).filter((container) => container.image || container.name);
    
    // 构建存储卷定义
    const buildVolumes = () => {
      return (volumes || []).map((vol) => {
        const volume: any = { name: vol.name };
        
        switch (vol.type) {
          case 'configMap':
            volume.configMap = {
              name: vol.configMapName,
              optional: vol.configMapOptional,
            };
            break;
          case 'secret':
            volume.secret = {
              secretName: vol.secretName,
              optional: vol.secretOptional,
            };
            break;
          case 'persistentVolumeClaim':
            volume.persistentVolumeClaim = {
              claimName: vol.claimName,
              readOnly: vol.readOnly,
            };
            break;
          case 'emptyDir':
            volume.emptyDir = {
              medium: vol.emptyDirMedium === 'Memory' ? 'Memory' : undefined,
              sizeLimit: vol.emptyDirSizeLimit,
            };
            break;
          case 'hostPath':
            volume.hostPath = {
              path: vol.hostPath,
              type: vol.hostPathType,
            };
            break;
        }
        
        return volume;
      });
    };
    
    const volumesList = buildVolumes();
    
    // 构建节点选择器
    const nodeSelectorMap: Record<string, string> = {};
    (nodeSelector || []).forEach((item) => {
      if (item.key && item.value) {
        nodeSelectorMap[item.key] = item.value;
      }
    });
    
    // 构建镜像拉取凭证（从所有容器收集并去重）
    const allContainerSecrets = new Set<string>();
    (containers || []).forEach((container) => {
      (container.imagePullSecrets || []).forEach((secretName) => {
        allContainerSecrets.add(secretName);
      });
    });
    const imagePullSecretsList = Array.from(allContainerSecrets).map((secretName) => ({
      name: secretName,
    }));
    
    // 构建亲和性配置
    const buildNodeAffinity = (affinityConfig?: NodeAffinityConfig) => {
      if (!affinityConfig) return undefined;
      
      const result: any = {};
      
      // 构建 required 规则
      if (affinityConfig.required?.nodeSelectorTerms?.length) {
        const terms = affinityConfig.required.nodeSelectorTerms
          .map((term) => {
            const termObj: any = {};
            
            if (term.matchExpressions?.length) {
              termObj.matchExpressions = term.matchExpressions
                .filter((expr) => expr.key)
                .map((expr) => ({
                  key: expr.key,
                  operator: expr.operator,
                  ...(expr.values && expr.values.length > 0 && { values: expr.values }),
                }));
            }
            
            if (term.matchFields?.length) {
              termObj.matchFields = term.matchFields
                .filter((field) => field.key)
                .map((field) => ({
                  key: field.key,
                  operator: field.operator,
                  ...(field.values && field.values.length > 0 && { values: field.values }),
                }));
            }
            
            return Object.keys(termObj).length > 0 ? termObj : null;
          })
          .filter(Boolean);
        
        if (terms.length > 0) {
          result.requiredDuringSchedulingIgnoredDuringExecution = {
            nodeSelectorTerms: terms,
          };
        }
      }
      
      // 构建 preferred 规则
      if (affinityConfig.preferred?.length) {
        const preferences = affinityConfig.preferred
          .map((pref) => {
            const prefObj: any = {
              weight: pref.weight || 50,
              preference: {},
            };
            
            if (pref.preference.matchExpressions?.length) {
              prefObj.preference.matchExpressions = pref.preference.matchExpressions
                .filter((expr) => expr.key)
                .map((expr) => ({
                  key: expr.key,
                  operator: expr.operator,
                  ...(expr.values && expr.values.length > 0 && { values: expr.values }),
                }));
            }
            
            if (pref.preference.matchFields?.length) {
              prefObj.preference.matchFields = pref.preference.matchFields
                .filter((field) => field.key)
                .map((field) => ({
                  key: field.key,
                  operator: field.operator,
                  ...(field.values && field.values.length > 0 && { values: field.values }),
                }));
            }
            
            return Object.keys(prefObj.preference).length > 0 ? prefObj : null;
          })
          .filter(Boolean);
        
        if (preferences.length > 0) {
          result.preferredDuringSchedulingIgnoredDuringExecution = preferences;
        }
      }
      
      return Object.keys(result).length > 0 ? result : undefined;
    };
    
    // 构建 Pod 亲和性配置
    const buildPodAffinity = (affinityConfig?: PodAffinityConfig) => {
      if (!affinityConfig) return undefined;
      
      const result: any = {};
      
      // 构建 required 规则
      if (affinityConfig.required?.length) {
        const requiredTerms = affinityConfig.required
          .map((term) => {
            const termObj: any = {};
            
            // 构建标签选择器
            const labelSelector: any = {};
            
            // matchLabels
            const matchLabels = term.labelSelector?.matchLabels || {};
            const validLabels = Object.fromEntries(
              Object.entries(matchLabels).filter(([k, v]) => k && v)
            );
            if (Object.keys(validLabels).length > 0) {
              labelSelector.matchLabels = validLabels;
            }
            
            // matchExpressions
            if (term.labelSelector?.matchExpressions?.length) {
              const expressions = term.labelSelector.matchExpressions
                .filter((expr) => expr.key)
                .map((expr) => ({
                  key: expr.key,
                  operator: expr.operator,
                  ...(expr.values && expr.values.length > 0 && { values: expr.values }),
                }));
              if (expressions.length > 0) {
                labelSelector.matchExpressions = expressions;
              }
            }
            
            if (Object.keys(labelSelector).length > 0) {
              termObj.labelSelector = labelSelector;
            }
            
            // namespaces
            if (term.namespaces?.length) {
              termObj.namespaces = term.namespaces;
            }
            
            // topologyKey (必填)
            if (term.topologyKey) {
              termObj.topologyKey = term.topologyKey;
            } else {
              return null; // topologyKey 是必填字段
            }
            
            return Object.keys(termObj).length > 1 ? termObj : null; // 至少需要 topologyKey
          })
          .filter(Boolean);
        
        if (requiredTerms.length > 0) {
          result.requiredDuringSchedulingIgnoredDuringExecution = requiredTerms;
        }
      }
      
      // 构建 preferred 规则
      if (affinityConfig.preferred?.length) {
        const preferences = affinityConfig.preferred
          .map((pref) => {
            const term = pref.podAffinityTerm;
            const termObj: any = {};
            
            // 构建标签选择器
            const labelSelector: any = {};
            
            // matchLabels
            const matchLabels = term.labelSelector?.matchLabels || {};
            const validLabels = Object.fromEntries(
              Object.entries(matchLabels).filter(([k, v]) => k && v)
            );
            if (Object.keys(validLabels).length > 0) {
              labelSelector.matchLabels = validLabels;
            }
            
            // matchExpressions
            if (term.labelSelector?.matchExpressions?.length) {
              const expressions = term.labelSelector.matchExpressions
                .filter((expr) => expr.key)
                .map((expr) => ({
                  key: expr.key,
                  operator: expr.operator,
                  ...(expr.values && expr.values.length > 0 && { values: expr.values }),
                }));
              if (expressions.length > 0) {
                labelSelector.matchExpressions = expressions;
              }
            }
            
            if (Object.keys(labelSelector).length > 0) {
              termObj.labelSelector = labelSelector;
            }
            
            // namespaces
            if (term.namespaces?.length) {
              termObj.namespaces = term.namespaces;
            }
            
            // topologyKey (必填)
            if (term.topologyKey) {
              termObj.topologyKey = term.topologyKey;
            } else {
              return null;
            }
            
            return Object.keys(termObj).length > 1 ? {
              weight: pref.weight || 50,
              podAffinityTerm: termObj,
            } : null;
          })
          .filter(Boolean);
        
        if (preferences.length > 0) {
          result.preferredDuringSchedulingIgnoredDuringExecution = preferences;
        }
      }
      
      return Object.keys(result).length > 0 ? result : undefined;
    };
    
    // 构建完整亲和性对象
    const affinity: any = {};
    
    // 节点亲和性
    const nodeAffinityResult = buildNodeAffinity(nodeAffinity);
    if (nodeAffinityResult) {
      affinity.nodeAffinity = nodeAffinityResult;
    }
    
    // 节点反亲和性 (使用相同的结构，但在K8s中反亲和性需要特殊处理)
    // 注意：Kubernetes 本身没有直接的 nodeAntiAffinity，需要通过 nodeAffinity 的 NotIn/DoesNotExist 操作符实现
    // 这里我们将其转换为对应的 nodeAffinity 规则
    if (nodeAntiAffinity) {
      const antiAffinityResult = buildNodeAffinity(nodeAntiAffinity);
      if (antiAffinityResult) {
        // 如果已有 nodeAffinity，需要合并规则
        if (affinity.nodeAffinity) {
          // 合并 required 规则
          if (antiAffinityResult.requiredDuringSchedulingIgnoredDuringExecution) {
            if (!affinity.nodeAffinity.requiredDuringSchedulingIgnoredDuringExecution) {
              affinity.nodeAffinity.requiredDuringSchedulingIgnoredDuringExecution = 
                antiAffinityResult.requiredDuringSchedulingIgnoredDuringExecution;
            } else {
              // 合并 nodeSelectorTerms
              affinity.nodeAffinity.requiredDuringSchedulingIgnoredDuringExecution.nodeSelectorTerms.push(
                ...antiAffinityResult.requiredDuringSchedulingIgnoredDuringExecution.nodeSelectorTerms
              );
            }
          }
          // 合并 preferred 规则
          if (antiAffinityResult.preferredDuringSchedulingIgnoredDuringExecution) {
            if (!affinity.nodeAffinity.preferredDuringSchedulingIgnoredDuringExecution) {
              affinity.nodeAffinity.preferredDuringSchedulingIgnoredDuringExecution = 
                antiAffinityResult.preferredDuringSchedulingIgnoredDuringExecution;
            } else {
              affinity.nodeAffinity.preferredDuringSchedulingIgnoredDuringExecution.push(
                ...antiAffinityResult.preferredDuringSchedulingIgnoredDuringExecution
              );
            }
          }
        } else {
          affinity.nodeAffinity = antiAffinityResult;
        }
      }
    }
    
    // Pod 亲和性
    const podAffinityResult = buildPodAffinity(podAffinity);
    if (podAffinityResult) {
      affinity.podAffinity = podAffinityResult;
    }
    
    // Pod 反亲和性
    const podAntiAffinityResult = buildPodAffinity(podAntiAffinity);
    if (podAntiAffinityResult) {
      affinity.podAntiAffinity = podAntiAffinityResult;
    }
    
    // 构建污点容忍
    const tolerationsList = (tolerations || [])
      .filter((t) => t.key || t.operator === 'Exists')
      .map((t) => {
        const toleration: any = {};
        if (t.key) toleration.key = t.key;
        if (t.operator) toleration.operator = t.operator;
        if (t.operator === 'Equal' && t.value) toleration.value = t.value;
        if (t.effect) toleration.effect = t.effect;
        if (t.effect === 'NoExecute' && t.tolerationSeconds !== undefined) {
          toleration.tolerationSeconds = t.tolerationSeconds;
        }
        return toleration;
      });
    
    // ============================================================
    // 构建网络相关注解
    // 注解将添加到 spec.template.metadata.annotations
    // ============================================================
    const buildNetworkAnnotations = (): Record<string, string> => {
      const annotations: Record<string, string> = {};
      
      // 默认网络不需要任何注解
      if (!networkType || networkType === 'default') {
        return annotations;
      }
      
      // 根据网络类型设置注解
      switch (networkType) {
        case 'flat_subnet':
          // 扁平子网：设置 networks 注解
          if (flatSubnet) {
            annotations['k8s.v1.cni.cncf.io/networks'] = flatSubnet;
          }
          break;
          
        case 'vpc':
          // VPC 子网：设置 networks 注解
          if (vpcSubnet) {
            annotations['k8s.v1.cni.cncf.io/networks'] = vpcSubnet;
            // Kube-OVN VPC 子网需要额外设置 logical_switch 注解
            // subnetName 格式为 <namespace>/<subnet-name>，提取子网名称
            const subnetParts = vpcSubnet.split('/');
            if (subnetParts.length === 2) {
              annotations['ovn.kubernetes.io/logical_switch'] = subnetParts[1];
            }
          }
          break;
          
        case 'custom_nad':
          // 自定义 NAD：设置 networks 注解
          if (customNad) {
            annotations['k8s.v1.cni.cncf.io/networks'] = customNad;
          }
          break;
      }
      
      // 静态 IP 配置
      if (enableStaticIP && staticIP) {
        annotations['ovn.kubernetes.io/ip_address'] = staticIP;
      }
      
      return annotations;
    };
    
    // 构建网络注解
    const networkAnnotations = buildNetworkAnnotations();
    
    // 构建完整资源
    const resource: any = {
      apiVersion: 'apps/v1',
      kind: workloadType === 'deployment' ? 'Deployment' 
          : workloadType === 'statefulset' ? 'StatefulSet' 
          : 'DaemonSet',
      metadata: {
        name: generateHarvesterCrMetadataName(workloadType),
        namespace,
        labels: labelsMap,
        annotations: {
          'tower.io/alias': name,
        },
      },
      spec: {
        selector: {
          matchLabels: { app: name },
        },
        template: {
          metadata: {
            labels: labelsMap,
            // 网络注解：合并到 spec.template.metadata.annotations
            ...(Object.keys(networkAnnotations).length > 0 && { annotations: networkAnnotations }),
          },
          spec: {
            containers: containerList,
            imagePullSecrets: imagePullSecretsList.length > 0 ? imagePullSecretsList : undefined,
            nodeSelector: Object.keys(nodeSelectorMap).length > 0 ? nodeSelectorMap : undefined,
            affinity: Object.keys(affinity).length > 0 ? affinity : undefined,
            tolerations: tolerationsList.length > 0 ? tolerationsList : undefined,
            volumes: volumesList.length > 0 ? volumesList : undefined,
          },
        },
      },
    };
    
    // 根据类型添加特定配置
    if (workloadType !== 'daemonset') {
      resource.spec.replicas = replicas || 1;
    }
    
    return resource;
  }, []);
  
  // 表单数据转 YAML
  const formToYaml = useCallback((values: WorkloadFormValues): string => {
    const resource = buildK8sResource(values);
    return yaml.dump(resource, {
      indent: 2,
      lineWidth: -1,
      noRefs: true,
      sortKeys: false,
    });
  }, [buildK8sResource]);
  
  // YAML 转表单数据
  const yamlToForm = useCallback((yamlStr: string): WorkloadFormValues | null => {
    try {
      const resource = yaml.load(yamlStr) as any;
      if (!resource) return null;
      
      // 提取基本信息
      const name = resource.metadata?.name || '';
      const namespace = resource.metadata?.namespace || 'default';
      const labels = resource.metadata?.labels || {};
      const kind = resource.kind?.toLowerCase();
      const workloadType = kind === 'statefulset' ? 'statefulset' 
                        : kind === 'daemonset' ? 'daemonset' 
                        : 'deployment';
      
      // 提取容器配置
      const podImagePullSecrets = (resource.spec?.template?.spec?.imagePullSecrets || []).map((s: any) => s.name);
      const parseContainer = (container: any, index: number): WorkloadContainerFormValue => ({
        containerName: container.name || '',
        image: container.image || '',
        imagePullPolicy: container.imagePullPolicy || 'IfNotPresent',
        ports: (container.ports || []).map((p: any) => ({
          name: p.name,
          containerPort: p.containerPort,
          protocol: p.protocol || 'TCP',
        })),
        env: (container.env || []).map((e: any) => ({
          type: e?.valueFrom?.configMapKeyRef ? 'configMapKeyRef' : e?.valueFrom?.secretKeyRef ? 'secretKeyRef' : 'keyValue',
          name: e.name,
          value: e.value || '',
          configMapName: e?.valueFrom?.configMapKeyRef?.name,
          configMapKey: e?.valueFrom?.configMapKeyRef?.key,
          secretName: e?.valueFrom?.secretKeyRef?.name,
          secretKey: e?.valueFrom?.secretKeyRef?.key,
        })),
        resources: {
          requests: container.resources?.requests || {},
          limits: container.resources?.limits || {},
        },
        command: container.command,
        args: container.args,
        livenessProbe: container.livenessProbe ? {
          enabled: true,
          type: container.livenessProbe.httpGet ? 'httpGet' : 
                container.livenessProbe.tcpSocket ? 'tcpSocket' : 'exec',
          httpGet: container.livenessProbe.httpGet,
          tcpSocket: container.livenessProbe.tcpSocket,
          exec: container.livenessProbe.exec,
          initialDelaySeconds: container.livenessProbe.initialDelaySeconds || 30,
          periodSeconds: container.livenessProbe.periodSeconds || 10,
        } : { enabled: false, type: 'httpGet', initialDelaySeconds: 30, periodSeconds: 10 },
        readinessProbe: container.readinessProbe ? {
          enabled: true,
          type: container.readinessProbe.httpGet ? 'httpGet' : 
                container.readinessProbe.tcpSocket ? 'tcpSocket' : 'exec',
          httpGet: container.readinessProbe.httpGet,
          tcpSocket: container.readinessProbe.tcpSocket,
          exec: container.readinessProbe.exec,
          initialDelaySeconds: container.readinessProbe.initialDelaySeconds || 5,
          periodSeconds: container.readinessProbe.periodSeconds || 10,
        } : { enabled: false, type: 'httpGet', initialDelaySeconds: 5, periodSeconds: 10 },
        volumeMounts: (container.volumeMounts || []).map((mount: any) => ({
          name: mount.name,
          mountPath: mount.mountPath,
          subPath: mount.subPath,
          readOnly: mount.readOnly,
        })),
        imagePullSecrets: index === 0 ? podImagePullSecrets : [],
      });

      const containers = (resource.spec?.template?.spec?.containers || []).map((c: any, i: number) => parseContainer(c, i));
      const firstContainer = containers[0] || createEmptyContainer(name);
      
      // 提取高级配置
      const replicas = resource.spec?.replicas || 1;
      const nodeSelector = resource.spec?.template?.spec?.nodeSelector || {};
      
      // 提取亲和性配置
      const affinity = resource.spec?.template?.spec?.affinity;
      const parseNodeAffinityFromYaml = (nodeAffinity: any): NodeAffinityConfig | undefined => {
        if (!nodeAffinity) return undefined;
        
        const result: NodeAffinityConfig = {};
        
        if (nodeAffinity.requiredDuringSchedulingIgnoredDuringExecution?.nodeSelectorTerms) {
          result.required = {
            nodeSelectorTerms: nodeAffinity.requiredDuringSchedulingIgnoredDuringExecution.nodeSelectorTerms.map((term: any) => ({
              matchExpressions: (term.matchExpressions || []).map((expr: any) => ({
                key: expr.key,
                operator: expr.operator,
                values: expr.values,
              })),
              matchFields: (term.matchFields || []).map((field: any) => ({
                key: field.key,
                operator: field.operator,
                values: field.values,
              })),
            })),
          };
        }
        
        if (nodeAffinity.preferredDuringSchedulingIgnoredDuringExecution) {
          result.preferred = nodeAffinity.preferredDuringSchedulingIgnoredDuringExecution.map((pref: any) => ({
            weight: pref.weight,
            preference: {
              matchExpressions: (pref.preference.matchExpressions || []).map((expr: any) => ({
                key: expr.key,
                operator: expr.operator,
                values: expr.values,
              })),
              matchFields: (pref.preference.matchFields || []).map((field: any) => ({
                key: field.key,
                operator: field.operator,
                values: field.values,
              })),
            },
          }));
        }
        
        return Object.keys(result).length > 0 ? result : undefined;
      };
      
      // 解析 Pod 亲和性配置
      const parsePodAffinityFromYaml = (podAffinity: any): PodAffinityConfig | undefined => {
        if (!podAffinity) return undefined;
        
        const result: PodAffinityConfig = {};
        
        // 解析 required 规则
        if (podAffinity.requiredDuringSchedulingIgnoredDuringExecution?.length) {
          result.required = podAffinity.requiredDuringSchedulingIgnoredDuringExecution.map((term: any) => ({
            labelSelector: term.labelSelector ? {
              matchLabels: term.labelSelector.matchLabels || {},
              matchExpressions: (term.labelSelector.matchExpressions || []).map((expr: any) => ({
                key: expr.key,
                operator: expr.operator,
                values: expr.values,
              })),
            } : undefined,
            namespaces: term.namespaces,
            topologyKey: term.topologyKey,
          }));
        }
        
        // 解析 preferred 规则
        if (podAffinity.preferredDuringSchedulingIgnoredDuringExecution?.length) {
          result.preferred = podAffinity.preferredDuringSchedulingIgnoredDuringExecution.map((pref: any) => ({
            weight: pref.weight,
            podAffinityTerm: {
              labelSelector: pref.podAffinityTerm?.labelSelector ? {
                matchLabels: pref.podAffinityTerm.labelSelector.matchLabels || {},
                matchExpressions: (pref.podAffinityTerm.labelSelector.matchExpressions || []).map((expr: any) => ({
                  key: expr.key,
                  operator: expr.operator,
                  values: expr.values,
                })),
              } : undefined,
              namespaces: pref.podAffinityTerm?.namespaces,
              topologyKey: pref.podAffinityTerm?.topologyKey,
            },
          }));
        }
        
        return Object.keys(result).length > 0 ? result : undefined;
      };
      
      // 提取污点容忍
      const tolerations = (resource.spec?.template?.spec?.tolerations || []).map((t: any) => ({
        key: t.key,
        operator: t.operator || 'Equal',
        value: t.value,
        effect: t.effect,
        tolerationSeconds: t.tolerationSeconds,
      }));
      
      return {
        name,
        namespace,
        workloadType,
        labels: Object.entries(labels).filter(([k]) => k !== 'app').map(([key, value]) => ({ key, value: String(value) })),
        containers,
        ...toContainerEditorFields(firstContainer),
        replicas,
        nodeSelector: Object.entries(nodeSelector).map(([key, value]) => ({ key, value: String(value) })),
        nodeAffinity: parseNodeAffinityFromYaml(affinity?.nodeAffinity),
        nodeAntiAffinity: undefined,
        podAffinity: parsePodAffinityFromYaml(affinity?.podAffinity),
        podAntiAffinity: parsePodAffinityFromYaml(affinity?.podAntiAffinity),
        tolerations: tolerations.length > 0 ? tolerations : undefined,
      };
    } catch (e) {
      console.error('YAML 解析失败:', e);
      return null;
    }
  }, []);
  
  // 切换到 YAML 模式时，将表单数据转换为 YAML
  const handleModeChange = useCallback((newMode: 'form' | 'yaml') => {
    if (newMode === 'yaml' && mode === 'form') {
      // 表单 → YAML
      try {
        const currentFormValues = getSyncedFormValues();
        
        if (isEditMode && editData) {
          const k8sResource = buildK8sResource(currentFormValues);
          // 保留原始 metadata 字段
          k8sResource.metadata = {
            ...editData.metadata,
            name: currentFormValues.name,
            namespace: currentFormValues.namespace,
            labels: {
              ...editData.metadata?.labels,
              ...(currentFormValues.labels || []).reduce((acc: any, l: any) => {
                if (l.key) acc[l.key] = l.value;
                return acc;
              }, {}),
            },
          };
          
          const yamlStr = yaml.dump(k8sResource, { indent: 2, lineWidth: -1, noRefs: true });
          setYamlContent(yamlStr);
        } else {
          // 创建模式：将当前表单数据转换为 YAML
          const yamlStr = formToYaml(currentFormValues as WorkloadFormValues);
          setYamlContent(yamlStr);
        }
        setYamlError('');
      } catch (e: any) {
        message.warning('数据转换失败，将使用默认模板');
        setYamlContent(getDefaultYaml(workloadType));
      }
    } else if (newMode === 'form' && mode === 'yaml') {
      // YAML → 表单：尝试解析 YAML 并填充表单
      try {
        const values = yamlToForm(yamlContent);
        if (values) {
          form.setFieldsValue(values);
          setYamlError('');
        }
      } catch (e: any) {
        message.warning('YAML 解析失败，请检查格式');
      }
    }
    setMode(newMode);
  }, [mode, form, formToYaml, yamlToForm, yamlContent, message, getDefaultYaml, workloadType, isEditMode, editData, buildK8sResource, getSyncedFormValues, watchedImagePullSecrets]);
  
  // 验证 YAML 格式
  const validateYaml = useCallback((content: string): boolean => {
    try {
      yaml.load(content);
      setYamlError('');
      return true;
    } catch (e: any) {
      setYamlError(`YAML 格式错误: ${e.message}`);
      return false;
    }
  }, []);
  
  // YAML 内容变化处理
  const handleYamlChange = useCallback((value: string) => {
    setYamlContent(value);
    validateYaml(value);
  }, [validateYaml]);
  
  // 提交表单
  const handleSubmit = useCallback(async () => {
    try {
      let resource: any;
      let apiPath: string;
      let namespace: string;
      let name: string;
      
      if (mode === 'yaml') {
        // YAML 模式提交
        if (!validateYaml(yamlContent)) {
          message.error('请修正 YAML 格式错误');
          return;
        }
        
        resource = yaml.load(yamlContent) as any;
        const kind = resource?.kind?.toLowerCase();
        apiPath = getApiPath(
          kind === 'statefulset' ? 'statefulset' :
          kind === 'daemonset' ? 'daemonset' : 'deployment'
        );
        namespace = resource?.metadata?.namespace || 'default';
        
        // 编辑模式下，使用资源 ID 作为 API 路径参数
        if (isEditMode && editMetadata) {
          name = editMetadata.name;
          resource.metadata = {
            ...resource.metadata,
            uid: editMetadata.uid,
            resourceVersion: editMetadata.resourceVersion,
            creationTimestamp: editMetadata.creationTimestamp,
            managedFields: editMetadata.managedFields,
          };
        } else {
          name = resource?.metadata?.name || '';
        }
      } else {
        // 表单模式提交 - 显式验证所有字段（分步骤表单需要）
        const values = await form.validateFields([
          'workloadType', 'name', 'namespace', 'labels',
          'containers',
          'image', 'containerName', 'imagePullPolicy',
          'ports', 'env', 'resources', 'command', 'args',
          'replicas', 'imagePullSecrets', 'nodeSelector',
          'nodeAffinity', 'nodeAntiAffinity', 'tolerations',
          'livenessProbe', 'readinessProbe',
          'volumes', 'volumeMounts'
        ]);

        const syncedValues = getSyncedFormValues();
        const invalidContainerIndex = (syncedValues.containers || []).findIndex((container) => !container.image);
        if (invalidContainerIndex >= 0) {
          setCurrentStep(1);
          setActiveContainerIndex(invalidContainerIndex);
          syncContainerEditorToForm(syncedValues.containers[invalidContainerIndex]);
          message.error(`请完善容器 ${invalidContainerIndex + 1} 的镜像地址`);
          setLoading(false);
          return;
        }
        
        resource = buildK8sResource(syncedValues);
        apiPath = getApiPath(values.workloadType);
        namespace = values.namespace;
        
        // 编辑模式下，保留原有元数据，使用资源 ID 作为 API 路径参数
        if (isEditMode && editMetadata) {
          name = editMetadata.name; // 使用资源 ID
          resource.metadata.name = editMetadata.name; // 保持资源名称不变
          resource.metadata.uid = editMetadata.uid;
          resource.metadata.resourceVersion = editMetadata.resourceVersion;
          resource.metadata.creationTimestamp = editMetadata.creationTimestamp;
          resource.metadata.managedFields = editMetadata.managedFields;
          // 保留原有 annotations 并更新 alias
          resource.metadata.annotations = {
            ...editMetadata.annotations,
            'tower.io/alias': values.name, // 更新显示名称
          };
          // 保留原有的 selector，避免 Pod 不匹配
          if (editData?.spec?.selector) {
            resource.spec.selector = editData.spec.selector;
          }
          // 保留原有的 template.labels，确保与 selector 匹配
          if (editData?.spec?.template?.metadata?.labels) {
            resource.spec.template.metadata.labels = editData.spec.template.metadata.labels;
          }
        } else {
          name = values.name; // 创建模式使用表单名称
        }
      }
      
      setLoading(true);
      
      if (isEditMode) {
        // 编辑模式：调用更新 API
        await updateHarvesterContainerResource(cloudId, apiPath, namespace, name, resource);
        message.success('工作负载更新成功');
      } else {
        // 创建模式：调用创建 API
        await createHarvesterContainerResource(cloudId, apiPath, namespace, resource);
        message.success('工作负载创建成功');
      }
      
      onSuccess();
    } catch (error: any) {
      console.error(isEditMode ? '更新工作负载失败:' : '创建工作负载失败:', error);
      message.error(error?.message || (isEditMode ? '更新工作负载失败' : '创建工作负载失败'));
    } finally {
      setLoading(false);
    }
  }, [mode, yamlContent, validateYaml, form, buildK8sResource, getApiPath, cloudId, message, onSuccess, isEditMode, getSyncedFormValues, syncContainerEditorToForm, editMetadata]);
  
  // 下一步
  const handleNext = useCallback(async () => {
    try {
      await form.validateFields();
      setCurrentStep((prev) => prev + 1);
    } catch {
      // 验证失败，不跳转
    }
  }, [form]);
  
  // 上一步
  const handlePrev = useCallback(() => {
    setCurrentStep((prev) => prev - 1);
  }, []);

  const handleStepClick = useCallback(async (targetStep: number) => {
    if (targetStep === currentStep) return;
    if (targetStep < currentStep) {
      setCurrentStep(targetStep);
      return;
    }

    try {
      await form.validateFields();
      setCurrentStep(targetStep);
    } catch {
      // 当前步骤校验失败，不允许前进
    }
  }, [currentStep, form]);


  const getFormSummary = useCallback(() => {
    const values = getSyncedFormValues();
    const containers = values.containers || [];
    
    // 网络配置摘要
    let networkSummary = '默认网络';
    if (values.networkType === 'flat_subnet') {
      networkSummary = values.flatSubnet ? `扁平子网: ${values.flatSubnet}` : '扁平子网';
    } else if (values.networkType === 'vpc') {
      networkSummary = values.vpcSubnet ? `VPC: ${values.vpcName || '-'}/${values.vpcSubnet}` : 'VPC子网';
    } else if (values.networkType === 'custom_nad') {
      networkSummary = values.customNad ? `NAD: ${values.customNad}` : '自定义NAD';
    }
    if (values.enableStaticIP && values.staticIP) {
      networkSummary += ` (静态IP: ${values.staticIP})`;
    }
    
    return {
      name: values.name || '-',
      namespace: values.namespace || '-',
      workloadType: values.workloadType || '-',
      replicas: values.workloadType === 'daemonset' ? '每节点 1 个' : String(values.replicas || 1),
      imagePullSecrets: values.imagePullSecrets?.length || 0,
      volumes: values.volumes?.length || 0,
      network: networkSummary,
      containers: containers.map((container, index) => ({
        key: `${container.containerName || 'container'}-${index}`,
        name: container.containerName || `container-${index + 1}`,
        image: container.image || '-',
        ports: container.ports?.length || 0,
        env: container.env?.length || 0,
        mounts: container.volumeMounts?.length || 0,
      })),
    };
  }, [getSyncedFormValues]);

  const [summary, setSummary] = useState(getFormSummary());

  useEffect(() => {
    setSummary(getFormSummary());
  }, [currentStep, activeContainerIndex, getFormSummary]);
  
  // 渲染步骤内容
  const renderStepContent = () => {
    switch (currentStep) {
      case 0:
        return (
          <div>
            <Form.Item
              name="workloadType"
              label="工作负载类型"
              rules={[{ required: true, message: '请选择工作负载类型' }]}
              initialValue={defaultType}
            >
              <Select
                disabled={isEditMode}
                options={WORKLOAD_TYPE_OPTIONS}
                optionRender={(option) => (
                  <div>
                    <div style={{ fontWeight: 500 }}>{option.label}</div>
                    <div style={{ fontSize: 12, color: '#999' }}>
                      {WORKLOAD_TYPE_OPTIONS.find(o => o.value === option.value)?.desc}
                    </div>
                  </div>
                )}
              />
            </Form.Item>
            
            <Row gutter={16}>
              <Col span={12}>
                {isEditMode ? (
                  <>
                    <Form.Item label="资源 ID">
                      <Input 
                        value={editMetadata?.name || ''} 
                        disabled 
                        style={{ color: 'rgba(0,0,0,0.45)' }}
                      />
                    </Form.Item>
                    <Form.Item
                      name="name"
                      label="显示名称"
                      rules={[
                        { required: true, message: '请输入显示名称' },
                        { max: 63, message: '名称不能超过63个字符' },
                      ]}
                    >
                      <Input placeholder="例如: my-app" />
                    </Form.Item>
                  </>
                ) : (
                  <Form.Item
                    name="name"
                    label="名称"
                    rules={[
                      { required: true, message: '请输入名称' },
                      { pattern: /^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/, message: '只允许小写字母、数字和中划线' },
                      { max: 63, message: '名称不能超过63个字符' },
                    ]}
                  >
                    <Input placeholder="例如: my-app" />
                  </Form.Item>
                )}
              </Col>
              <Col span={12}>
                <Form.Item
                  name="namespace"
                  label="命名空间"
                  rules={[{ required: true, message: '请选择命名空间' }]}
                  initialValue={defaultNamespace}
                >
                  <Select
                    showSearch
                    disabled={isEditMode}
                    optionFilterProp="label"
                    placeholder="选择命名空间"
                    options={namespacesOptions.map((ns) => ({ label: ns, value: ns }))}
                  />
                </Form.Item>
              </Col>
            </Row>
            
            <LabelEditor name="labels" label="标签" />
            
            {(workloadType === 'deployment' || workloadType === 'statefulset') && (
              <Form.Item
                name="replicas"
                label="副本数"
                initialValue={1}
                rules={[{ required: true, message: '请输入副本数' }]}
              >
                <InputNumber min={1} max={1000} style={{ width: '100%' }} />
              </Form.Item>
            )}
            
            {workloadType === 'daemonset' && (
              <Alert
                type="info"
                showIcon
                style={{ marginTop: 16 }}
                message="DaemonSet 会在每个节点上运行一个 Pod，无需设置副本数"
              />
            )}
          </div>
        );
        
      case 1:
        const containers = getSyncedFormValues().containers || [];
        return (
          <div>
            <Alert
              type="info"
              showIcon
              style={{ marginBottom: 16 }}
              message="容器配置"
              description={
                <div>
                  <div>每个容器独立配置镜像、端口、环境变量、资源限制、启动命令和健康检查。点击容器卡片可展开详细配置。</div>
                  <div style={{ marginTop: 8, color: '#faad14' }}>
                    <strong>注意：</strong>Kubernetes 限制镜像拉取凭证只能在 Pod 级别配置。如果您在多个容器中配置了不同的凭证，系统会自动合并去重后应用到 Pod。
                  </div>
                </div>
              }
            />
            {containers.map((container, index) => {
              const isActive = index === activeContainerIndex;
              const portsCount = container.ports?.length || 0;
              const envCount = container.env?.length || 0;
              const resourcesCount = (container.resources?.requests?.cpu || container.resources?.requests?.memory || container.resources?.limits?.cpu || container.resources?.limits?.memory) ? 1 : 0;
              const commandCount = (container.command?.length || container.args?.length) ? 1 : 0;
              const probeCount = (container.livenessProbe?.enabled ? 1 : 0) + (container.readinessProbe?.enabled ? 1 : 0);
              
              return (
                <Card
                  key={`container-${index}`}
                  size="small"
                  style={{ marginBottom: 16, border: isActive ? '2px solid #1677ff' : '1px solid #f0f0f0' }}
                  title={
                    <Space>
                      <Tag color={isActive ? 'blue' : 'default'}>{`容器 ${index + 1}`}</Tag>
                      <span style={{ fontWeight: 500 }}>{container.containerName || `container-${index + 1}`}</span>
                      {isActive && <Tag color="processing">编辑中</Tag>}
                    </Space>
                  }
                  extra={
                    <Space>
                      <Button
                        type="text"
                        size="small"
                        icon={<CopyOutlined />}
                        onClick={() => {
                          const syncedValues = getSyncedFormValues();
                          const nextContainers = [...(syncedValues.containers || [])];
                          const current = nextContainers[index];
                          if (!current) return;
                          nextContainers.splice(index + 1, 0, {
                            ...current,
                            containerName: current.containerName ? `${current.containerName}-copy` : `container-${nextContainers.length + 1}`,
                            ports: [...(current.ports || [])],
                            env: [...(current.env || [])],
                            resources: {
                              requests: { ...(current.resources?.requests || {}) },
                              limits: { ...(current.resources?.limits || {}) },
                            },
                            command: [...(current.command || [])],
                            args: [...(current.args || [])],
                            volumeMounts: [...(current.volumeMounts || [])],
                          });
                          form.setFieldsValue({ containers: nextContainers });
                          setActiveContainerIndex(index + 1);
                          syncContainerEditorToForm(nextContainers[index + 1]);
                        }}
                      >
                        复制
                      </Button>
                      {containers.length > 1 && (
                        <Button
                          type="text"
                          size="small"
                          danger
                          icon={<DeleteOutlined />}
                          onClick={() => {
                            const syncedValues = getSyncedFormValues();
                            const nextContainers = [...(syncedValues.containers || [])];
                            if (nextContainers.length <= 1) {
                              message.warning('至少需要保留一个容器');
                              return;
                            }
                            nextContainers.splice(index, 1);
                            const nextIndex = Math.max(0, index - 1);
                            form.setFieldsValue({ containers: nextContainers });
                            setActiveContainerIndex(nextIndex);
                            syncContainerEditorToForm(nextContainers[nextIndex]);
                          }}
                        >
                          删除
                        </Button>
                      )}
                    </Space>
                  }
                >
                  {isActive ? (
                    <>
                      <Form.Item
                        name="image"
                        label="镜像地址"
                        rules={[{ required: true, message: '请输入镜像地址' }]}
                        extra={<span style={{ color: '#999' }}>例如: nginx:latest 或 harbor.example.com/library/nginx:v1.0</span>}
                      >
                        <Input
                          placeholder="镜像地址"
                          addonAfter={
                            <Button
                              type="text"
                              size="small"
                              icon={<FolderOutlined />}
                              onClick={() => {
                                if (allRegistries.length > 0) {
                                  const currentImage = form.getFieldValue('image');
                                  let targetCredential = registryToCredential(allRegistries[0]);
                                  if (currentImage) {
                                    const serverMatch = currentImage.match(/^([^/]+):?\d*\//);
                                    if (serverMatch) {
                                      const serverFromImage = serverMatch[1];
                                      const matchingRegistry = allRegistries.find(r => r.server === serverFromImage);
                                      if (matchingRegistry) {
                                        targetCredential = registryToCredential(matchingRegistry);
                                      }
                                    }
                                  }
                                  if (targetCredential) {
                                    setBrowserCredential(targetCredential);
                                    setBrowserVisible(true);
                                  } else {
                                    message.error('解析镜像凭证失败，请检查凭证配置');
                                  }
                                } else {
                                  message.warning('请先在镜像仓库中添加仓库或创建凭证');
                                }
                              }}
                            >
                              浏览仓库
                            </Button>
                          }
                        />
                      </Form.Item>
                      <Row gutter={16}>
                        <Col span={12}>
                          <Form.Item name="containerName" label="容器名称" extra="默认与工作负载名称相同">
                            <Input placeholder="容器名称 (可选)" />
                          </Form.Item>
                        </Col>
                        <Col span={12}>
                          <Form.Item name="imagePullPolicy" label="镜像拉取策略" initialValue="IfNotPresent">
                            <Select options={IMAGE_PULL_POLICY_OPTIONS} />
                          </Form.Item>
                        </Col>
                      </Row>
                      <Form.Item
                        name="imagePullSecrets"
                        label="镜像拉取凭证"
                        extra={<span style={{ color: '#999' }}>选择此容器使用的镜像仓库凭证</span>}
                      >
                        <Select
                          mode="multiple"
                          placeholder="选择镜像拉取凭证"
                          allowClear
                          options={(imagePullSecrets || []).map((secret) => ({
                            label: secret.metadata.name,
                            value: secret.metadata.name,
                          }))}
                        />
                      </Form.Item>
                      <Collapse ghost defaultActiveKey={[]} items={[
                        {
                          key: 'ports',
                          label: `端口配置 (${portsCount})`,
                          children: <PortsEditor />,
                        },
                        {
                          key: 'env',
                          label: `环境变量 (${envCount})`,
                          children: (
                            <EnvEditor
                              cloudId={cloudId}
                              namespacesOptions={namespacesOptions}
                              selectedNamespace={form.getFieldValue('namespace') || defaultNamespace || 'default'}
                              configMaps={configMaps}
                              secrets={secrets}
                              onRefreshConfigMaps={() => onRefreshConfigMaps?.()}
                              onRefreshSecrets={() => onRefreshSecrets?.()}
                              onOpenQuickCreateConfigMap={() => setShowQuickCreateConfigMap(true)}
                              onOpenQuickCreateSecret={() => setShowQuickCreateSecret(true)}
                            />
                          ),
                        },
                        {
                          key: 'resources',
                          label: `资源限制 (${resourcesCount})`,
                          children: (
                            <Row gutter={16}>
                              <Col span={6}>
                                <Form.Item name={['resources', 'requests', 'cpu']} label="CPU 请求">
                                  <Input placeholder="如: 100m" />
                                </Form.Item>
                              </Col>
                              <Col span={6}>
                                <Form.Item name={['resources', 'requests', 'memory']} label="内存请求">
                                  <Input placeholder="如: 128Mi" />
                                </Form.Item>
                              </Col>
                              <Col span={6}>
                                <Form.Item name={['resources', 'limits', 'cpu']} label="CPU 限制">
                                  <Input placeholder="如: 500m" />
                                </Form.Item>
                              </Col>
                              <Col span={6}>
                                <Form.Item name={['resources', 'limits', 'memory']} label="内存限制">
                                  <Input placeholder="如: 512Mi" />
                                </Form.Item>
                              </Col>
                            </Row>
                          ),
                        },
                        {
                          key: 'command',
                          label: `启动命令 (${commandCount})`,
                          children: (
                            <Row gutter={16}>
                              <Col span={12}>
                                <Form.Item name="command" label="启动命令" extra="多个命令用逗号分隔">
                                  <Select mode="tags" placeholder="如: /bin/sh" style={{ width: '100%' }} tokenSeparators={[',']} />
                                </Form.Item>
                              </Col>
                              <Col span={12}>
                                <Form.Item name="args" label="启动参数" extra="多个参数用逗号分隔">
                                  <Select mode="tags" placeholder="如: -c, script.sh" style={{ width: '100%' }} tokenSeparators={[',']} />
                                </Form.Item>
                              </Col>
                            </Row>
                          ),
                        },
                        {
                          key: 'probes',
                          label: `健康检查 (${probeCount})`,
                          children: (
                            <>
                              <ProbeEditor name="livenessProbe" label="存活探针 (Liveness Probe)" />
                              <ProbeEditor name="readinessProbe" label="就绪探针 (Readiness Probe)" />
                            </>
                          ),
                        },
                      ]} />
                    </>
                  ) : (
                    <div
                      onClick={() => handleSelectContainer(index)}
                      style={{ cursor: 'pointer', padding: '8px 0' }}
                    >
                      <div style={{ color: '#666', fontSize: 13 }}>{container.image || '未配置镜像'}</div>
                      <div style={{ color: '#999', fontSize: 12, marginTop: 4 }}>
                        端口 {portsCount} / 环境变量 {envCount} / 挂载 {container.volumeMounts?.length || 0}
                      </div>
                    </div>
                  )}
                </Card>
              );
            })}
            <Button
              type="dashed"
              block
              icon={<PlusOutlined />}
              onClick={handleAddContainer}
              style={{ marginBottom: 16 }}
            >
              添加容器
            </Button>
          </div>
        );
        
      case 2:
        // 网络配置步骤
        const networkType = form.getFieldValue('networkType') || 'default';
        const enableStaticIP = form.getFieldValue('enableStaticIP');
        
        return (
          <div>
            <Alert
              type="info"
              showIcon
              style={{ marginBottom: 16 }}
              message="网络配置"
              description="配置 Pod 的网络连接方式。默认使用 Pod 网络，也可以选择扁平子网、VPC 子网或自定义 NAD。"
            />
            
            {loadingNetworkData ? (
              <div style={{ textAlign: 'center', padding: '40px 0' }}>
                <Spin tip="加载网络数据..." />
              </div>
            ) : (
              <>
                <Form.Item
                  name="networkType"
                  label="网络类型"
                  initialValue="default"
                  extra="选择 Pod 使用的网络类型"
                >
                  <Radio.Group>
                    <Radio value="default">默认网络（Pod网络）</Radio>
                    {!hideFlatSubnet && <Radio value="flat_subnet">扁平子网</Radio>}
                    <Radio value="vpc">VPC子网</Radio>
                    <Radio value="custom_nad">自定义NAD</Radio>
                  </Radio.Group>
                </Form.Item>
                
                {networkType === 'flat_subnet' && (
                  <>
                    {flatSubnetOptions.length === 0 && !loadingNetworkData && (
                      <Alert
                        type="warning"
                        showIcon
                        style={{ marginBottom: 16 }}
                        message="未找到扁平子网"
                        description={
                          <div>
                            <div>请确保已在资源池中创建扁平子网（Kube-OVN 子网，VPC 为 ovn-internal，注解 tower.io/subnet-type=flat）</div>
                            <div style={{ marginTop: 8 }}>当前加载了 {kubeSubnets.length} 个子网，{kubeSubnets.filter(s => isFlatVpc(s?.vpc || s?.spec?.vpc)).length} 个属于扁平 VPC</div>
                          </div>
                        }
                      />
                    )}
                    <Form.Item
                      name="flatSubnet"
                      label="选择子网"
                      rules={[{ required: true, message: '请选择扁平子网' }]}
                      extra="扁平子网提供 Underlay 网络连接，将自动生成 NAD 引用"
                    >
                      <Select
                        placeholder="选择扁平子网"
                        showSearch
                        optionFilterProp="label"
                        options={flatSubnetOptions}
                        onChange={(val) => {
                          // 查找选中的子网对象
                          const subnet = (kubeSubnets || []).find(s => (s.name || s?.metadata?.name) === val);
                          if (!subnet) {
                            form.setFieldsValue({ flatSubnet: val });
                            return;
                          }
                          
                          // 提取 namespace
                          let subnetNs = subnet?.namespace || subnet?.metadata?.namespace;
                          if (!subnetNs) {
                            const provider = subnet?.provider || subnet?.spec?.provider;
                            if (provider) {
                              const parts = provider.split('.');
                              if (parts.length >= 2) subnetNs = parts[parts.length - 2];
                            }
                          }
                          subnetNs = subnetNs || 'default';
                          
                          // 生成 NAD 引用（namespace/name 格式）
                          const nadRef = `${subnetNs}/${val}`;
                          
                          // 存储 NAD 引用
                          form.setFieldsValue({ flatSubnet: nadRef });
                        }}
                      />
                    </Form.Item>
                  </>
                )}
                
                {networkType === 'vpc' && (
                  <>
                    <Form.Item
                      name="vpcName"
                      label="选择VPC"
                      rules={[{ required: true, message: '请选择VPC' }]}
                    >
                      <Select
                        placeholder="选择VPC"
                        showSearch
                        optionFilterProp="label"
                        options={vpcOptions}
                        onChange={() => {
                          // VPC 变化时清空子网选择
                          form.setFieldsValue({ vpcSubnet: undefined });
                        }}
                      />
                    </Form.Item>
                    <Form.Item
                      name="vpcSubnet"
                      label="选择子网"
                      rules={[{ required: true, message: '请选择子网' }]}
                    >
                      <Select
                        placeholder={selectedVpc ? "选择子网" : "请先选择VPC"}
                        showSearch
                        optionFilterProp="label"
                        options={vpcSubnetOptions}
                        disabled={!selectedVpc}
                        onChange={(val) => {
                          // 查找选中的子网对象
                          const subnet = (kubeSubnets || []).find(s => 
                            (s.name || s?.metadata?.name) === val && 
                            (s.vpc || s?.spec?.vpc) === selectedVpc
                          );
                          if (!subnet) {
                            form.setFieldsValue({ vpcSubnet: val });
                            return;
                          }
                          
                          // 提取 namespace
                          let subnetNs = subnet?.namespace || subnet?.metadata?.namespace;
                          if (!subnetNs) {
                            const provider = subnet?.provider || subnet?.spec?.provider;
                            if (provider) {
                              const parts = provider.split('.');
                              if (parts.length >= 2) subnetNs = parts[parts.length - 2];
                            }
                          }
                          subnetNs = subnetNs || 'default';
                          
                          // 生成 NAD 引用（namespace/name 格式）
                          const nadRef = `${subnetNs}/${val}`;
                          
                          // 存储 NAD 引用
                          form.setFieldsValue({ vpcSubnet: nadRef });
                        }}
                      />
                    </Form.Item>
                  </>
                )}
                
                {networkType === 'custom_nad' && (
                  <Form.Item
                    name="customNad"
                    label="选择NAD"
                    rules={[{ required: true, message: '请选择NAD' }]}
                    extra="选择已创建的网络附件定义（NetworkAttachmentDefinition）"
                  >
                    <Select
                      placeholder="选择NAD网络"
                      options={allNadOptions}
                      showSearch
                      optionFilterProp="label"
                      allowClear
                      onDropdownVisibleChange={(open) => {
                        if (open) {
                          // 重新加载NAD数据
                          const fetchNads = async () => {
                            try {
                              const res = await fetchHarvesterNads(cloudId, true, false);
                              const nadItems = res?.data?.items || res?.items || (Array.isArray(res) ? res : []);
                              setNads(nadItems);
                            } catch (e) {
                              console.error('重新加载NAD失败:', e);
                            }
                          };
                          fetchNads();
                        }
                      }}
                    />
                  </Form.Item>
                )}
                
                <Divider />
                
                <Form.Item
                  name="enableStaticIP"
                  label="配置静态IP"
                  valuePropName="checked"
                  extra="为 Pod 分配固定的 IP 地址（仅部分网络类型支持）"
                >
                  <Checkbox />
                </Form.Item>
                
                {enableStaticIP && (
                  <Form.Item
                    name="staticIP"
                    label="静态IP地址"
                    rules={[
                      { required: true, message: '请输入静态IP地址' },
                      {
                        pattern: /^((25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(25[0-5]|2[0-4]\d|[01]?\d\d?)$/,
                        message: '请输入有效的IPv4地址'
                      }
                    ]}
                  >
                    <Input placeholder="例如: 192.168.1.100" />
                  </Form.Item>
                )}
                
                {networkType !== 'default' && (
                  <Alert
                    type="warning"
                    showIcon
                    style={{ marginTop: 16 }}
                    message="注意"
                    description={
                      <div>
                        <div>选择非默认网络类型时，请确保集群已正确配置对应的网络插件（如 Kube-OVN）。</div>
                        {networkType === 'flat_subnet' && (
                          <div style={{ marginTop: 8 }}>扁平子网需要 Pod 所在节点配置对应的物理网络接口。</div>
                        )}
                        {networkType === 'vpc' && (
                          <div style={{ marginTop: 8 }}>VPC 子网由 Kube-OVN 提供，支持网络隔离和高级网络功能。</div>
                        )}
                        {networkType === 'custom_nad' && (
                          <div style={{ marginTop: 8 }}>自定义 NAD 需要预先创建 NetworkAttachmentDefinition 资源。</div>
                        )}
                      </div>
                    }
                  />
                )}
              </>
            )}
          </div>
        );
        
      case 3:
        const containersForStorage = getSyncedFormValues().containers || [];
        const activeContainerForStorage = containersForStorage[activeContainerIndex];
        return (
          <div>
            <Alert
              type="info"
              showIcon
              style={{ marginBottom: 16 }}
              message="存储配置"
              description="先定义工作负载共享的存储卷，再为当前选中的容器配置卷挂载。卷定义共享，卷挂载属于当前容器。"
            />
            {containersForStorage.map((container, index) => {
              const isActive = index === activeContainerIndex;
              return (
                <Card
                  key={`storage-container-${index}`}
                  size="small"
                  style={{ marginBottom: 16, border: isActive ? '2px solid #1677ff' : '1px solid #f0f0f0' }}
                  title={
                    <Space>
                      <Tag color={isActive ? 'blue' : 'default'}>{`容器 ${index + 1}`}</Tag>
                      <span style={{ fontWeight: 500 }}>{container.containerName || `container-${index + 1}`}</span>
                    </Space>
                  }
                >
                  {isActive ? (
                    <VolumesEditor
                      cloudId={cloudId}
                      namespacesOptions={namespacesOptions}
                      selectedNamespace={form.getFieldValue('namespace') || defaultNamespace || 'default'}
                      configMaps={configMaps}
                      secrets={secrets}
                      persistentVolumeClaims={persistentVolumeClaims}
                      onRefreshConfigMaps={() => onRefreshConfigMaps?.()}
                      onRefreshSecrets={() => onRefreshSecrets?.()}
                      onOpenQuickCreateConfigMap={() => setShowQuickCreateConfigMap(true)}
                      onOpenQuickCreateSecret={() => setShowQuickCreateSecret(true)}
                    />
                  ) : (
                    <div
                      onClick={() => handleSelectContainer(index)}
                      style={{ cursor: 'pointer', padding: '8px 0' }}
                    >
                      <div style={{ color: '#999' }}>点击切换到此容器</div>
                    </div>
                  )}
                </Card>
              );
            })}
          </div>
        );

      case 4:
        const nodeAffinity = form.getFieldValue('nodeAffinity');
        const nodeAntiAffinity = form.getFieldValue('nodeAntiAffinity');
        const podAffinity = form.getFieldValue('podAffinity');
        const podAntiAffinity = form.getFieldValue('podAntiAffinity');
        const tolerations = form.getFieldValue('tolerations') || [];
        
        const nodeAffinityCount = (nodeAffinity?.required?.nodeSelectorTerms?.length || 0) + (nodeAffinity?.preferred?.length || 0);
        const nodeAntiAffinityCount = (nodeAntiAffinity?.required?.nodeSelectorTerms?.length || 0) + (nodeAntiAffinity?.preferred?.length || 0);
        const podAffinityCount = (podAffinity?.required?.length || 0) + (podAffinity?.preferred?.length || 0);
        const podAntiAffinityCount = (podAntiAffinity?.required?.length || 0) + (podAntiAffinity?.preferred?.length || 0);
        const tolerationsCount = tolerations.length;
        
        return (
          <div>
            <Divider orientation="left">调度策略</Divider>
            <LabelEditor name="nodeSelector" label="节点选择器" />
            
            <Collapse ghost defaultActiveKey={[]} items={[
              {
                key: 'nodeAffinity',
                label: `节点亲和性 (${nodeAffinityCount})`,
                children: <NodeAffinityEditor name="nodeAffinity" label="节点亲和性" />,
              },
              {
                key: 'nodeAntiAffinity',
                label: `节点反亲和性 (${nodeAntiAffinityCount})`,
                children: <NodeAffinityEditor name="nodeAntiAffinity" label="节点反亲和性" />,
              },
              {
                key: 'podAffinity',
                label: `Pod 亲和性 (${podAffinityCount})`,
                children: (
                  <PodAffinityEditor 
                    name="podAffinity" 
                    label="Pod 亲和性" 
                    namespacesOptions={namespacesOptions}
                  />
                ),
              },
              {
                key: 'podAntiAffinity',
                label: `Pod 反亲和性 (${podAntiAffinityCount})`,
                children: (
                  <PodAffinityEditor 
                    name="podAntiAffinity" 
                    label="Pod 反亲和性" 
                    namespacesOptions={namespacesOptions}
                  />
                ),
              },
              {
                key: 'tolerations',
                label: `污点容忍 (${tolerationsCount})`,
                children: <TolerationsEditor />,
              },
            ]} />
          </div>
        );
        
      default:
        return null;
    }
  };
  
  // YAML 编辑器视图
  const renderYamlEditor = () => (
    <div>
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        message="YAML 编辑模式"
        description="直接编辑 Kubernetes 资源定义，支持完整的 K8s API 规范。"
      />
      
      {yamlError && (
        <Alert
          type="error"
          showIcon
          style={{ marginBottom: 16 }}
          message={yamlError}
        />
      )}
      
      <YamlEditor
        value={yamlContent}
        onChange={handleYamlChange}
        minHeight={400}
        maxHeight={600}
      />
    </div>
  );
  
  return (
    <div>
      {/* 模式切换 */}
      <div style={{ marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Segmented
          value={mode}
          onChange={(v) => handleModeChange(v as 'form' | 'yaml')}
          options={[
            { value: 'form', label: <span><FormOutlined /> 表单模式</span> },
            { value: 'yaml', label: <span><CodeOutlined /> YAML 模式</span> },
          ]}
        />
      </div>

      {/* 仓库浏览器抽屉 */}
      <RegistryBrowserDrawer
        key={`registry-browser-${activeContainerIndex}-${form.getFieldValue('image') || 'empty'}`}
        visible={browserVisible}
        cloudId={cloudId}
        credential={browserCredential}
        registries={allRegistries}
        onRegistryChange={setBrowserCredential}
        currentImage={form.getFieldValue('image')}
        onClose={() => {
          setBrowserVisible(false);
        }}
        onSelectImage={(image) => {
          form.setFieldsValue({ image });
          setBrowserVisible(false);
          message.success(`已选择镜像: ${image}`);
        }}
      />

      {mode === 'form' ? (
        <>
          <Form
            form={form}
            layout="vertical"
            onValuesChange={() => {
              if (!syncingContainerRef.current) {
                persistActiveContainerToForm();
              }
              setSummary(getFormSummary());
            }}
            initialValues={{
              workloadType: defaultType,
              name: generateVmWizardStyleDisplayName('app'),
              namespace: defaultNamespace,
              containers: [createEmptyContainer(defaultType === 'daemonset' ? 'daemonset-container' : 'main-container')],
              imagePullPolicy: 'IfNotPresent',
              replicas: 1,
              labels: [],
              ports: [],
              env: [],
              imagePullSecrets: [],
              nodeSelector: [],
              nodeAffinity: { required: undefined, preferred: undefined },
              nodeAntiAffinity: { required: undefined, preferred: undefined },
              podAffinity: { required: undefined, preferred: undefined },
              podAntiAffinity: { required: undefined, preferred: undefined },
              tolerations: [],
              resources: { requests: {}, limits: {} },
              livenessProbe: { enabled: false, type: 'httpGet' as const, initialDelaySeconds: 30, periodSeconds: 10 },
              readinessProbe: { enabled: false, type: 'httpGet' as const, initialDelaySeconds: 5, periodSeconds: 10 },
              volumes: [],
              volumeMounts: [],
              // 网络配置默认值
              networkType: 'default',
              enableStaticIP: false,
            }}
          >
            <Row gutter={[0, 0]} style={{ height: '100%' }}>
              <Col span={5}>
                <div className="wizard-sidebar" style={{ padding: '0 8px 0 0', minHeight: 'calc(80vh - 24px)' }}>
                  <div>
                    {WORKLOAD_STEPS.map((step, idx) => {
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

              <Col span={12} style={{ height: '100%' }}>
                <div style={{ height: 'calc(80vh - 24px)', overflowY: 'auto', padding: '0 30px', scrollbarGutter: 'stable' }}>
                  {renderStepContent()}
                </div>
              </Col>

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
                        <span style={{ color: '#888' }}>命名空间</span>
                        <span style={{ color: '#333' }}>{summary.namespace}</span>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px dashed #f0f0f0' }}>
                        <span style={{ color: '#888' }}>类型</span>
                        <span style={{ color: '#333' }}>{summary.workloadType}</span>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px dashed #f0f0f0' }}>
                        <span style={{ color: '#888' }}>副本</span>
                        <span style={{ color: '#333' }}>{summary.replicas}</span>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px dashed #f0f0f0' }}>
                        <span style={{ color: '#888' }}>镜像凭证</span>
                        <span style={{ color: '#333' }}>{summary.imagePullSecrets} 个</span>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px dashed #f0f0f0' }}>
                        <span style={{ color: '#888' }}>存储卷</span>
                        <span style={{ color: '#333' }}>{summary.volumes} 个</span>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px dashed #f0f0f0' }}>
                        <span style={{ color: '#888' }}>网络</span>
                        <span style={{ color: '#333', maxWidth: '60%', textAlign: 'right', wordBreak: 'break-all' }}>{summary.network}</span>
                      </div>
                      <div style={{ padding: '8px 0' }}>
                        <div style={{ color: '#888', marginBottom: 8 }}>容器列表</div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                          {summary.containers.map((container, index) => (
                            <div key={container.key} style={{ border: '1px solid #f0f0f0', borderRadius: 8, padding: 10, background: index === activeContainerIndex ? '#f8fbff' : '#fff' }}>
                              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                                <span style={{ fontWeight: 500 }}>{container.name}</span>
                                <Tag color={index === activeContainerIndex ? 'blue' : 'default'}>{`容器 ${index + 1}`}</Tag>
                              </div>
                              <div style={{ fontSize: 12, color: '#666', wordBreak: 'break-all' }}>{container.image}</div>
                              <div style={{ fontSize: 12, color: '#999', marginTop: 4 }}>
                                端口 {container.ports} / 环境变量 {container.env} / 挂载 {container.mounts}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>

                  <div style={{ marginTop: 'auto', paddingTop: 16, borderTop: '1px solid #f0f0f0' }}>
                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                      <Button htmlType="button" onClick={onCancel}>取消</Button>
                      {currentStep > 0 && (
                        <Button htmlType="button" onClick={handlePrev}>上一步</Button>
                      )}
                      {currentStep < WORKLOAD_STEPS.length - 1 ? (
                        <Button type="primary" htmlType="button" onClick={handleNext}>
                          下一步
                        </Button>
                      ) : (
                        <Button type="primary" htmlType="button" loading={loading} onClick={handleSubmit}>
                          {isEditMode ? '更新' : '创建'}
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              </Col>
            </Row>
          </Form>
        </>
      ) : (
        <>
          {renderYamlEditor()}
          
          <div style={{ marginTop: 24, textAlign: 'right' }}>
            <Space>
              <Button onClick={onCancel}>取消</Button>
              <Button type="primary" loading={loading} onClick={handleSubmit}>
                {isEditMode ? '更新' : '创建'}
              </Button>
            </Space>
          </div>
        </>
      )}

      {/* 快速创建镜像拉取凭证弹窗 */}
      <QuickCreateRegistrySecretModal
        cloudId={cloudId}
        namespacesOptions={namespacesOptions}
        defaultNamespace={form.getFieldValue('namespace') || defaultNamespace}
        visible={showQuickCreateRegistry}
        onSuccess={(secret) => {
          setShowQuickCreateRegistry(false);
          // 刷新凭证列表
          if (onRefreshImagePullSecrets) {
            onRefreshImagePullSecrets();
          }
          // 自动选中新创建的凭证
          const currentSecrets = form.getFieldValue('imagePullSecrets') || [];
          if (!currentSecrets.includes(secret.name)) {
            form.setFieldsValue({ imagePullSecrets: [...currentSecrets, secret.name] });
          }
        }}
        onCancel={() => setShowQuickCreateRegistry(false)}
      />

      {/* 快速创建 ConfigMap 弹窗 */}
      <QuickCreateConfigMapModal
        cloudId={cloudId}
        namespacesOptions={namespacesOptions}
        defaultNamespace={form.getFieldValue('namespace') || defaultNamespace}
        visible={showQuickCreateConfigMap}
        onSuccess={(configMap) => {
          setShowQuickCreateConfigMap(false);
          // 刷新 ConfigMap 列表
          if (onRefreshConfigMaps) {
            onRefreshConfigMaps();
          }
          message.success(`ConfigMap "${configMap.name}" 创建成功，请在下拉列表中选择`);
        }}
        onCancel={() => setShowQuickCreateConfigMap(false)}
      />

      {/* 快速创建 Secret 弹窗 */}
      <QuickCreateSecretModal
        cloudId={cloudId}
        namespacesOptions={namespacesOptions}
        defaultNamespace={form.getFieldValue('namespace') || defaultNamespace}
        visible={showQuickCreateSecret}
        onSuccess={(secret) => {
          setShowQuickCreateSecret(false);
          // 刷新 Secret 列表
          if (onRefreshSecrets) {
            onRefreshSecrets();
          }
          message.success(`Secret "${secret.name}" 创建成功，请在下拉列表中选择`);
        }}
        onCancel={() => setShowQuickCreateSecret(false)}
      />
    </div>
  );
};

export default WorkloadForm;
