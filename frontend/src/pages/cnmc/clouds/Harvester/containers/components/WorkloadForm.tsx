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

import React, { useState, useMemo, useCallback, useEffect, useRef, useImperativeHandle } from 'react';
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
  Tooltip,
  Modal,
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
  QuestionCircleOutlined,
} from '@ant-design/icons';
import { Dropdown } from 'antd';
import yaml from 'js-yaml';
import { createHarvesterContainerResource, updateHarvesterContainerResource, fetchKubeOvnSubnets, fetchKubeOvnVpcs, fetchHarvesterNads, checkSubnetStaticIP } from '../../../../../../services/harvesterApi';
import YamlEditor from '../../../../../../components/YamlEditor';
import '../../ecs/modals/VmCreateWizard/InstanceWizard.css';
import { 
  RegistryBrowserDrawer, 
  QuickCreateRegistrySecretModal,
  QuickCreateConfigMapModal,
  QuickCreateSecretModal,
} from './index';
import { generateHarvesterCrMetadataName, generateVmWizardStyleDisplayName, isSystemNamespace } from '../../../../../../utils/harvesterUtils';

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
  
  // 域名映射
  hostAliases?: Array<{ ip: string; hostnames: string[] }>;
  
  // DNS 配置
  dnsPolicy?: 'Default' | 'ClusterFirst' | 'ClusterFirstWithHostNet' | 'None';
  dnsConfig?: {
    nameservers?: string[];
    searches?: string[];
    options?: Array<{ name: string; value?: string }>;
  };
  
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
  imagePullSecrets: Array<{ metadata: { name: string; namespace: string; annotations?: Record<string, string> } }>;
  secretsWithCredentials?: any[];  // 包含完整凭证信息的 Secret 列表（用于仓库浏览）
  onRefreshImagePullSecrets?: () => void;  // 刷新镜像拉取凭证列表
  onSuccess: () => void;
  onCancel: () => void;
  defaultNamespace?: string;
  defaultType?: WorkloadType;
  editData?: any; // 编辑模式：传入现有的 workload 数据
  // ConfigMap 和 Secret 相关 props（用于环境变量引入和存储卷挂载）
  configMaps?: Array<{ metadata: { name: string; namespace: string; annotations?: Record<string, string> }; data?: Record<string, string> }>;
  secrets?: Array<{ metadata: { name: string; namespace: string; annotations?: Record<string, string> }; data?: Record<string, string> }>;
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

const CPU_UNITS = [
  { label: 'm', value: 'm' },
  { label: '核', value: '' },
];

const MEMORY_UNITS = [
  { label: 'MiB', value: 'Mi' },
  { label: 'GiB', value: 'Gi' },
];

const EMPTY_DIR_SIZE_UNITS = [
  { label: 'Mi', value: 'Mi' },
  { label: 'Gi', value: 'Gi' },
  { label: 'G', value: 'G' },
  { label: 'Ti', value: 'Ti' },
  { label: 'T', value: 'T' },
  { label: 'Pi', value: 'Pi' },
];

// ============================================================
// 资源比较函数
// ============================================================

/**
 * 解析 CPU 资源字符串为核数
 * 支持格式: '100m' (毫核), '0.5' (核), '1' (核)
 */
const parseCpuToCores = (value: string | undefined): number => {
  if (!value || typeof value !== 'string') return 0;
  const t = value.trim();
  const m = t.match(/^(\d+(?:\.\d+)?)\s*([mun])?$/i);
  if (!m) return 0;
  const num = parseFloat(m[1]);
  if (Number.isNaN(num)) return 0;
  const suffix = (m[2] || '').toLowerCase();
  if (suffix === 'm') return num / 1000;
  if (suffix === 'u') return num / 1e6;
  if (suffix === 'n') return num / 1e9;
  return num;
};

/**
 * 解析内存资源字符串为字节数
 * 支持格式: '128Mi', '1Gi', '1024' (字节)
 */
const parseMemoryToBytes = (value: string | undefined): number => {
  if (!value || typeof value !== 'string') return 0;
  const t = value.trim();
  const m = t.match(/^(\d+)\s*([KMGTP]i?)?$/i);
  if (!m) return 0;
  const num = parseInt(m[1], 10);
  if (Number.isNaN(num)) return 0;
  const suffix = (m[2] || '').toLowerCase();
  if (suffix === 'ki') return num * 1024;
  if (suffix === 'mi') return num * 1024 ** 2;
  if (suffix === 'gi') return num * 1024 ** 3;
  if (suffix === 'ti') return num * 1024 ** 4;
  if (suffix === 'pi') return num * 1024 ** 5;
  if (suffix === 'k') return num * 1000;
  if (suffix === 'm') return num * 1e6;
  if (suffix === 'g') return num * 1e9;
  if (suffix === 't') return num * 1e12;
  if (suffix === 'p') return num * 1e15;
  return num;
};

/**
 * 比较 CPU 资源值
 * @returns 正数表示 a > b，负数表示 a < b，0 表示相等
 */
const compareCpuResources = (a: string | undefined, b: string | undefined): number => {
  return parseCpuToCores(a) - parseCpuToCores(b);
};

/**
 * 比较内存资源值
 * @returns 正数表示 a > b，负数表示 a < b，0 表示相等
 */
const compareMemoryResources = (a: string | undefined, b: string | undefined): number => {
  return parseMemoryToBytes(a) - parseMemoryToBytes(b);
};

const K8S_ERROR_MAP: Record<string, string> = {
  'selector does not match template labels': '标签与选择器不匹配，请检查基本信息中的标签是否与系统自动生成的标签冲突',
  'is invalid': '资源配置无效',
  'FieldValueInvalid': '字段值无效',
  'FieldValueRequired': '必填字段缺失',
  'FieldValueDuplicate': '字段值重复',
  'FieldValueForbidden': '字段值不允许',
  'Unauthorized': '未授权，请检查权限',
  'Forbidden': '禁止访问',
  'NotFound': '资源不存在',
  'AlreadyExists': '资源已存在',
  'Invalid': '配置无效',
};

const parseK8sError = (error: any): string => {
  const rawMsg = error?.message || String(error);
  
  if (rawMsg.includes('selector') && rawMsg.includes('does not match template labels')) {
    return '标签配置错误：自定义标签与系统选择器标签冲突。建议：请在基本信息中使用不同的标签键，或避免使用 "app" 作为标签键。';
  }
  
  for (const [key, zhMsg] of Object.entries(K8S_ERROR_MAP)) {
    if (rawMsg.includes(key)) {
      const detailMatch = rawMsg.match(/"message":"([^"]+)"/);
      const detail = detailMatch ? detailMatch[1] : '';
      return `${zhMsg}${detail ? `: ${detail}` : ''}`;
    }
  }
  
  if (rawMsg.startsWith('{') || rawMsg.startsWith('创建资源失败:')) {
    return '资源配置无效，请检查表单填写是否正确';
  }
  
  return rawMsg;
};

/**
 * 检查 IP 地址是否在 CIDR 范围内
 * @param ip IP 地址，如 "192.168.1.100"
 * @param cidr CIDR 范围，如 "192.168.1.0/24"
 * @returns 是否在范围内
 */
const isIpInCidr = (ip: string, cidr: string): boolean => {
  try {
    const [cidrBase, prefixLenStr] = cidr.split('/');
    const prefixLen = parseInt(prefixLenStr, 10);
    
    if (!cidrBase || isNaN(prefixLen) || prefixLen < 0 || prefixLen > 32) {
      return false;
    }
    
    // 将 IP 转换为 32 位无符号整数（使用 >>> 0 确保无符号）
    const ipToNumber = (ipStr: string): number => {
      const parts = ipStr.split('.').map(p => parseInt(p, 10));
      if (parts.length !== 4 || parts.some(p => isNaN(p) || p < 0 || p > 255)) {
        return -1;
      }
      // 使用无符号右移确保结果为正数
      return ((parts[0] << 24) >>> 0) + ((parts[1] << 16) >>> 0) + ((parts[2] << 8) >>> 0) + parts[3];
    };
    
    const ipNum = ipToNumber(ip);
    const cidrNum = ipToNumber(cidrBase);
    
    if (ipNum < 0 || cidrNum < 0) {
      return false;
    }
    
    // 计算掩码（无符号）
    const mask = prefixLen === 0 ? 0 : ((~0 << (32 - prefixLen)) >>> 0);
    
    // 检查网络地址是否相同（使用无符号运算）
    return ((ipNum & mask) >>> 0) === ((cidrNum & mask) >>> 0);
  } catch {
    return false;
  }
};

/**
 * 将 IP 地址转换为 32 位整数
 * @param ip IP 地址，如 "192.168.1.100"
 * @returns 32 位整数，无效返回 -1
 */
const ipToNumber = (ip: string): number => {
  const parts = ip.split('.').map(p => parseInt(p, 10));
  if (parts.length !== 4 || parts.some(p => isNaN(p) || p < 0 || p > 255)) {
    return -1;
  }
  // 使用无符号右移确保结果为正数（避免 JavaScript 位运算溢出）
  return ((parts[0] << 24) >>> 0) + ((parts[1] << 16) >>> 0) + ((parts[2] << 8) >>> 0) + parts[3];
};

/**
 * 将 32 位整数转换为 IP 地址
 * @param num 32 位整数
 * @returns IP 地址字符串
 */
const numberToIp = (num: number): string => {
  return [
    (num >>> 24) & 255,
    (num >>> 16) & 255,
    (num >>> 8) & 255,
    num & 255
  ].join('.');
};

/**
 * 解析子网的已使用 IP 范围
 * Kube-OVN 子网 status.v4UsingIPrange 格式如 "10.1.1.2..10.1.1.10" 或数组形式
 * @param subnet 子网对象
 * @returns 已使用 IP 范围数组，每个元素为 { start, end }
 */
const parseUsingIPRanges = (subnet: any): Array<{ start: number; end: number }> => {
  const status = subnet?.status || subnet?.rawData?.status || {};
  
  // 尝试多种字段名获取已使用IP范围
  let rangeStr = status.v4UsingIPrange || status.v4usingIPrange || status.usingIPrange;
  
  if (!rangeStr) {
    return [];
  }
  
  // 如果是数组形式
  if (Array.isArray(rangeStr)) {
    return rangeStr
      .map((r: string) => {
        const parts = String(r).split('..');
        if (parts.length === 2) {
          const start = ipToNumber(parts[0].trim());
          const end = ipToNumber(parts[1].trim());
          if (start >= 0 && end >= 0 && start <= end) {
            return { start, end };
          }
        }
        return null;
      })
      .filter((r): r is { start: number; end: number } => r !== null);
  }
  
  // 如果是字符串形式，可能是单个范围或多个范围用逗号分隔
  const ranges: Array<{ start: number; end: number }> = [];
  const parts = String(rangeStr).split(',');
  
  for (const part of parts) {
    const rangeParts = part.trim().split('..');
    if (rangeParts.length === 2) {
      const start = ipToNumber(rangeParts[0].trim());
      const end = ipToNumber(rangeParts[1].trim());
      if (start >= 0 && end >= 0 && start <= end) {
        ranges.push({ start, end });
      }
    }
  }
  
  return ranges;
};

/**
 * 检查 IP 是否在已使用 IP 范围内
 * @param ipNum IP 数值
 * @param ranges 已使用 IP 范围数组
 * @returns 是否已使用
 */
const isIpInRanges = (ipNum: number, ranges: Array<{ start: number; end: number }>): boolean => {
  for (const range of ranges) {
    if (ipNum >= range.start && ipNum <= range.end) {
      return true;
    }
  }
  return false;
};

/**
 * 解析子网的可用 IP 范围
 * Kube-OVN 子网 status.v4AvailableIPrange 格式如 "10.1.1.2..10.1.1.254" 或数组形式
 * @param subnet 子网对象
 * @returns 可用 IP 范围数组，每个元素为 { start, end }
 */
const parseAvailableIPRanges = (subnet: any): Array<{ start: number; end: number }> => {
  const status = subnet?.status || subnet?.rawData?.status || {};
  const spec = subnet?.spec || subnet?.rawData?.spec || {};
  
  // 尝试多种字段名获取可用IP范围
  let rangeStr = status.v4AvailableIPrange || status.v4availableIPrange || status.availableIPrange;
  
  // 如果没有可用范围，尝试从 CIDR 计算（排除网关和广播地址）
  if (!rangeStr) {
    const cidr = spec.cidrBlock || subnet?.cidr || subnet?.spec?.cidrBlock;
    if (cidr) {
      // 从 CIDR 计算可用IP范围（简化版，不排除已使用的IP）
      // 这里只返回CIDR范围，实际检测需要后端API
      return [];
    }
    return [];
  }
  
  // 如果是数组形式
  if (Array.isArray(rangeStr)) {
    return rangeStr
      .map((r: string) => {
        const parts = String(r).split('..');
        if (parts.length === 2) {
          const start = ipToNumber(parts[0].trim());
          const end = ipToNumber(parts[1].trim());
          if (start >= 0 && end >= 0 && start <= end) {
            return { start, end };
          }
        }
        return null;
      })
      .filter((r): r is { start: number; end: number } => r !== null);
  }
  
  // 如果是字符串形式，可能是单个范围或多个范围用逗号分隔
  const ranges: Array<{ start: number; end: number }> = [];
  const parts = String(rangeStr).split(',');
  
  for (const part of parts) {
    const rangeParts = part.trim().split('..');
    if (rangeParts.length === 2) {
      const start = ipToNumber(rangeParts[0].trim());
      const end = ipToNumber(rangeParts[1].trim());
      if (start >= 0 && end >= 0 && start <= end) {
        ranges.push({ start, end });
      }
    }
  }
  
  return ranges;
};

/**
 * 检查 IP 是否在可用 IP 范围内
 * @param ip 要检查的 IP 地址
 * @param subnet 子网对象
 * @returns { available: boolean, reason: string, unknown?: boolean }
 */
const checkIpAvailability = (ip: string, subnet: any): { available: boolean; reason: string; unknown?: boolean } => {
  const ipNum = ipToNumber(ip);
  if (ipNum < 0) {
    return { available: false, reason: 'IP 地址格式无效' };
  }
  
  // 先检查是否在已使用IP范围内
  const usingRanges = parseUsingIPRanges(subnet);
  if (usingRanges.length > 0 && isIpInRanges(ipNum, usingRanges)) {
    const usingDesc = usingRanges.map(r => `${numberToIp(r.start)}..${numberToIp(r.end)}`).join(', ');
    return { available: false, reason: `IP 已被使用。已使用范围: ${usingDesc}` };
  }
  
  // 再检查可用IP范围
  const availableRanges = parseAvailableIPRanges(subnet);
  
  if (availableRanges.length === 0) {
    // 如果有已使用范围但没有可用范围，说明可以尝试（不在已使用范围中）
    if (usingRanges.length > 0) {
      return { available: true, reason: 'IP 不在已使用范围内，可以尝试分配' };
    }
    // 都没有，返回未知状态
    return { available: false, reason: '无法检测IP可用性：子网未提供可用IP范围信息。请确保该IP未被其他工作负载使用。', unknown: true };
  }
  
  // 检查 IP 是否在任一可用范围内
  for (const range of availableRanges) {
    if (ipNum >= range.start && ipNum <= range.end) {
      return { available: true, reason: `IP 在可用范围内 (${numberToIp(range.start)}..${numberToIp(range.end)})` };
    }
  }
  
  // IP 不在任何可用范围内，说明已被使用或被排除
  const rangeDesc = availableRanges.map(r => `${numberToIp(r.start)}..${numberToIp(r.end)}`).join(', ');
  return { available: false, reason: `IP 不在可用范围内。可用范围: ${rangeDesc}` };
};

// ============================================================
// K8s 格式校验函数
// ============================================================

/**
 * 校验 K8s 标签键 (Label Key) - 节点标签
 * 节点常用标签如 kubernetes.io/os、node.kubernetes.io/instance-type
 * 格式: 可选前缀（DNS子域名格式）+ / + 键名
 * 键名: 最多63字符，小写字母/数字开头结尾，中间可含连字符(-)、下划线(_)、点(.)
 */
const validateNodeLabelKey = (_: any, value: string) => {
  if (!value) return Promise.resolve();
  const labelKeyRegex = /^([a-z0-9]([-a-z0-9]*[a-z0-9])?(\.[a-z0-9]([-a-z0-9]*[a-z0-9])?)*\/)?[a-z0-9]([-a-z0-9._]*[a-z0-9])?$/;
  if (!labelKeyRegex.test(value)) {
    return Promise.reject(new Error('格式无效：须小写字母/数字开头结尾，中间可含连字符、下划线、点，可带前缀如 kubernetes.io/os'));
  }
  const keyPart = value.includes('/') ? value.split('/')[1] : value;
  if (keyPart.length > 63) {
    return Promise.reject(new Error('键名长度不能超过63个字符'));
  }
  if (value.includes('/')) {
    const prefixPart = value.split('/')[0];
    if (prefixPart.length > 253) {
      return Promise.reject(new Error('前缀长度不能超过253个字符'));
    }
  }
  return Promise.resolve();
};

/**
 * 校验 K8s 标签值 (Label Value)
 * 格式: 最多63字符，字母/数字开头结尾，中间可含连字符(-)、下划线(_)、点(.)
 * 允许空字符串
 */
const validateK8sLabelValue = (_: any, value: string) => {
  if (!value) return Promise.resolve(); // 空字符串是合法的标签值
  const labelValueRegex = /^[a-zA-Z0-9]([-a-zA-Z0-9._]*[a-zA-Z0-9])?$/;
  if (!labelValueRegex.test(value)) {
    return Promise.reject(new Error('格式无效：字母/数字开头结尾，中间可含连字符、下划线、点'));
  }
  if (value.length > 63) {
    return Promise.reject(new Error('标签值长度不能超过63个字符'));
  }
  return Promise.resolve();
};

/**
 * 校验 K8s 端口名称 (Port Name)
 * 格式: 最多63字符，小写字母开头结尾，中间可含小写字母、数字、连字符(-)
 * 允许为空（非必填）
 */
const validateK8sPortName = (_: any, value: string) => {
  if (!value) return Promise.resolve();
  const portNameRegex = /^[a-z]([a-z0-9-]*[a-z0-9])?$/;
  if (!portNameRegex.test(value)) {
    return Promise.reject(new Error('格式无效：小写字母开头，仅含小写字母、数字和连字符，须字母或数字结尾'));
  }
  if (value.length > 63) {
    return Promise.reject(new Error('端口名称长度不能超过63个字符'));
  }
  return Promise.resolve();
};

/**
 * 校验环境变量键名 (Env Var Name)
 * 格式: 字母开头，可含字母、数字、下划线(_)
 */
const validateEnvVarName = (_: any, value: string) => {
  if (!value) return Promise.resolve();
  const envNameRegex = /^[a-zA-Z_][a-zA-Z0-9_]*$/;
  if (!envNameRegex.test(value)) {
    return Promise.reject(new Error('格式无效：须以字母或下划线开头，仅含字母、数字和下划线'));
  }
  return Promise.resolve();
};

/**
 * 校验健康检查 HTTP 路径 (httpGet.path)
 * 格式: 必须以 / 开头
 */
const validateHttpProbePath = (_: any, value: string) => {
  if (!value) return Promise.resolve();
  if (!value.startsWith('/')) {
    return Promise.reject(new Error('路径必须以 / 开头'));
  }
  return Promise.resolve();
};

/**
 * 校验健康检查执行命令 (exec.command)
 * 格式: 不能为空数组
 */
const validateExecCommand = (_: any, value: string[]) => {
  if (!value || value.length === 0) {
    return Promise.reject(new Error('执行命令不能为空，请输入至少一个命令'));
  }
  const filtered = value.filter((item: string) => item && item.trim());
  if (filtered.length === 0) {
    return Promise.reject(new Error('执行命令不能为空，请输入有效的命令'));
  }
  return Promise.resolve();
};

/**
 * 校验存储卷名称 (Volume Name)
 * 格式: 小写字母开头结尾，中间可含小写字母、数字、连字符(-)，最多63字符
 */
const validateVolumeName = (_: any, value: string) => {
  if (!value) return Promise.resolve();
  const volumeNameRegex = /^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/;
  if (!volumeNameRegex.test(value)) {
    return Promise.reject(new Error('格式无效：小写字母/数字开头结尾，中间仅含小写字母、数字和连字符'));
  }
  if (value.length > 63) {
    return Promise.reject(new Error('卷名称长度不能超过63个字符'));
  }
  return Promise.resolve();
};

/**
 * 校验节点路径 (hostPath.path)
 * 格式: 必须是有效的 Unix 路径格式（以 / 开头）
 */
const validateUnixPath = (_: any, value: string) => {
  if (!value) return Promise.resolve();
  if (!value.startsWith('/')) {
    return Promise.reject(new Error('路径必须以 / 开头'));
  }
  // 基本路径格式校验：不允许连续的斜杠（但允许 // 这种，某些K8s场景会用到）
  // 校验路径中不包含非法字符
  const unixPathRegex = /^\/[^\0]*$/;
  if (!unixPathRegex.test(value)) {
    return Promise.reject(new Error('请输入有效的 Unix 路径格式（如 /var/data）'));
  }
  return Promise.resolve();
};

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

const ResourceInput: React.FC<{
  value?: string;
  onChange?: (value: string | undefined) => void;
  placeholder?: string;
  units: Array<{ label: string; value: string }>;
  defaultUnit: string;
  unitTooltip?: string;
}> = ({ value, onChange, placeholder, units, defaultUnit, unitTooltip }) => {
  const [num, setNum] = useState<string>('');
  const [unit, setUnit] = useState<string>(defaultUnit);

  useEffect(() => {
    if (!value) {
      setNum('');
      setUnit(defaultUnit);
      return;
    }
    const match = value.match(/^(\d+\.?\d*)(.*)$/);
    if (match) {
      setNum(match[1]);
      const suffix = match[2];
      if (suffix !== undefined && suffix !== '') {
        setUnit(suffix);
      } else {
        if (defaultUnit === 'm') {
          setUnit('');
        } else {
          setUnit(defaultUnit);
        }
      }
    }
  }, [value, defaultUnit]);

  const handleNumChange = (newNum: string) => {
    setNum(newNum);
    if (newNum) {
      onChange?.(newNum + unit);
    } else {
      onChange?.(undefined);
    }
  };

  const handleUnitChange = (newUnit: string) => {
    setUnit(newUnit);
    if (num) {
      onChange?.(num + newUnit);
    }
  };

  return (
    <Input.Group compact style={{ display: 'flex' }}>
      <InputNumber
        value={num ? Number(num) : undefined}
        onChange={(v) => handleNumChange(v ? String(v) : '')}
        placeholder={placeholder}
        min={0}
        step={unit === 'm' ? 100 : 0.5}
        precision={unit === 'm' ? 0 : 2}
        style={{ flex: 1, minWidth: 60 }}
      />
      <Tooltip title={unitTooltip}>
        <Select
          value={unit}
          onChange={handleUnitChange}
          options={units}
          style={{ width: 80 }}
        />
      </Tooltip>
    </Input.Group>
  );
};

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
              rules={[
                { required: true, message: '请输入键' },
                { validator: validateNodeLabelKey },
              ]}>
              <Input placeholder="键 (如: app 或 example.com/key)" style={{ width: 180 }} />
            </Form.Item>
            <Form.Item
              {...restField}
              name={[index, 'value']}
              rules={[
                { required: true, message: '请输入值' },
                { validator: validateK8sLabelValue },
              ]}
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
                rules={[{ validator: validateK8sPortName }]}
              >
                <Input placeholder="端口名称 (可选)" />
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
  configMaps: Array<{ metadata: { name: string; namespace: string; annotations?: Record<string, string> }; data?: Record<string, string> }>;
  secrets: Array<{ metadata: { name: string; namespace: string; annotations?: Record<string, string> }; data?: Record<string, string> }>;
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
  refreshKey?: number; // 父组件传入的刷新标记，变化时重新读取数据
  onVolumeChange?: () => void; // 卷变化时通知父组件
}

const VolumesEditor: React.FC<VolumesEditorProps> = ({
  cloudId: _cloudId,
  namespacesOptions: _namespacesOptions,
  selectedNamespace,
  configMaps,
  secrets,
  persistentVolumeClaims = [],
  onRefreshConfigMaps: _onRefreshConfigMaps,
  onRefreshSecrets: _onRefreshSecrets,
  onOpenQuickCreateConfigMap,
  onOpenQuickCreateSecret,
  refreshKey: _refreshKey = 0,
  onVolumeChange,
}) => {
  const form = Form.useFormInstance();
  
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
      // 过滤掉 Block 类型的 PVC，只展示 Filesystem 类型
      const source = pvc?.rawData || pvc || {};
      const volumeMode = source?.spec?.volumeMode || pvc?.volumeMode || 'Block';
      return pvcNs === selectedNamespace && volumeMode !== 'Block';
    });
  }, [persistentVolumeClaims, selectedNamespace]);
  
  // 直接从表单读取最新值，不使用 useMemo 缓存，确保卷名称变化时立即更新
  const volumes = (() => {
    const v = form.getFieldValue('volumes');
    return Array.isArray(v) ? v.filter(Boolean) : [];
  })();
  
  const volumeMounts = (() => {
    const v = form.getFieldValue('volumeMounts');
    return Array.isArray(v) ? v.filter(Boolean) : [];
  })();

  // 添加卷 - 直接从 form 读取最新值，避免闭包问题
  const addVolume = useCallback((type: VolumeType) => {
    const currentVolumes = form.getFieldValue('volumes') || [];
    const newVolume: VolumeConfig = { name: '', type };
    form.setFieldsValue({ volumes: [newVolume, ...currentVolumes] });
    onVolumeChange?.();
  }, [form, onVolumeChange]);

  // 删除卷
  const removeVolume = useCallback((index: number) => {
    const currentVolumes = form.getFieldValue('volumes') || [];
    const volName = currentVolumes[index]?.name;
    const updated = currentVolumes.filter((_: VolumeConfig, i: number) => i !== index);
    form.setFieldsValue({ volumes: updated });
    
    // 同时删除对应的挂载
    if (volName) {
      const currentMounts = form.getFieldValue('volumeMounts') || [];
      const updatedMounts = currentMounts.filter((m: VolumeMountConfig) => m.name !== volName);
      form.setFieldsValue({ volumeMounts: updatedMounts });
    }
    onVolumeChange?.(); // 通知父组件刷新
  }, [form, onVolumeChange]);

  // 添加挂载
  const addVolumeMount = useCallback(() => {
    const currentMounts = form.getFieldValue('volumeMounts') || [];
    const newMount: VolumeMountConfig = { name: '', mountPath: '', readOnly: false };
    form.setFieldsValue({ volumeMounts: [newMount, ...currentMounts] });
    onVolumeChange?.();
  }, [form, onVolumeChange]);

  // 删除挂载
  const removeVolumeMount = useCallback((index: number) => {
    const currentMounts = form.getFieldValue('volumeMounts') || [];
    const updated = currentMounts.filter((_: VolumeMountConfig, i: number) => i !== index);
    form.setFieldsValue({ volumeMounts: updated });
    onVolumeChange?.(); // 通知父组件刷新
  }, [form, onVolumeChange]);

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
              rules={[
                { required: true, message: '请输入卷名称' },
                { validator: validateVolumeName },
                {
                  validator: (_: any, value: string) => {
                    if (!value) return Promise.resolve();
                    const allVolumes: VolumeConfig[] = form.getFieldValue('volumes') || [];
                    const duplicates = allVolumes.filter(
                      (v: VolumeConfig, i: number) =>
                        i !== index && v?.name && v.name === value,
                    );
                    if (duplicates.length > 0) {
                      return Promise.reject(new Error(`卷名称 "${value}" 已存在，请使用不同的名称`));
                    }
                    return Promise.resolve();
                  },
                },
              ]}
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
                  onVolumeChange?.(); // 通知父组件刷新
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
              <Col span={12}>
                <Form.Item
                  name={[...basePath, 'configMapOptional']}
                  label={(
                    <Tooltip title="开启：ConfigMap 不存在时容器仍能启动；关闭：ConfigMap 必须存在，否则容器启动失败">
                      <span>允许不存在 <QuestionCircleOutlined style={{ marginLeft: 4, color: '#999' }} /></span>
                    </Tooltip>
                  )}
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
                                  options={filteredSecrets.map(s => {
                                    const alias = s?.metadata?.annotations?.['tower.io/alias'];
                                    const name = s.metadata.name;
                                    return {
                                      label: alias ? `${alias} (${name})` : name,
                                      value: name,
                                    };
                                  })}                    dropdownRender={(menu) => (
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
                  label={(
                    <Tooltip title="开启：Secret 不存在时容器仍能启动；关闭：Secret 必须存在，否则容器启动失败">
                      <span>允许不存在 <QuestionCircleOutlined style={{ marginLeft: 4, color: '#999' }} /></span>
                    </Tooltip>
                  )}
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
            <Col span={24}>
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
                <ResourceInput placeholder="如: 1" units={EMPTY_DIR_SIZE_UNITS} defaultUnit="Gi" unitTooltip="Mi=MiB(1024KiB)；Gi=GiB(1024MiB)；Ti=TiB(1024GiB)" />
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
                rules={[
                  { required: true, message: '请输入节点路径' },
                  { validator: validateUnixPath },
                ]}
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
    const mountName = form.getFieldValue([...basePath, 'name']);
    const allVolumes: VolumeConfig[] = form.getFieldValue('volumes') || [];
    const matchedVolume = allVolumes.find((v) => v.name === mountName);
    const isReadOnlyImmutable = matchedVolume?.type === 'configMap' || matchedVolume?.type === 'secret';
    
    return (
      <Row key={index} gutter={8} style={{ marginBottom: 8 }}>
        <Col span={6}>
          <Form.Item
            name={[...basePath, 'name']}
            label="卷名称"
            rules={[{ required: true, message: '请选择卷' }]}
          >
            <Select
              placeholder="选择卷"
              showSearch
              options={availableVolumeNames.map((name: string) => ({ label: name, value: name }))}
            />
          </Form.Item>
        </Col>
        <Col span={isReadOnlyImmutable ? 10 : 8}>
          <Form.Item
            name={[...basePath, 'mountPath']}
            label="挂载路径"
            rules={[
              { required: true, message: '请输入挂载路径' },
              {
                validator: (_, value) => {
                  if (!value) return Promise.resolve();
                  if (!value.startsWith('/')) {
                    return Promise.reject(new Error('路径必须以 / 开头'));
                  }
                  if (value === '/') {
                    return Promise.reject(new Error('不能挂载到根路径 /'));
                  }
                  if (value.includes('..')) {
                    return Promise.reject(new Error('路径不能包含 ..'));
                  }
                  if (/\/\//.test(value)) {
                    return Promise.reject(new Error('路径不能包含连续的 //'));
                  }
                  const allMounts: VolumeMountConfig[] = form.getFieldValue('volumeMounts') || [];
                  const duplicates = allMounts.filter(
                    (m: VolumeMountConfig, i: number) =>
                      i !== index && m?.mountPath && m.mountPath === value,
                  );
                  if (duplicates.length > 0) {
                    return Promise.reject(new Error(`挂载路径 "${value}" 已被使用，同一容器内不能重复挂载到相同路径`));
                  }
                  return Promise.resolve();
                },
              },
            ]}
            validateTrigger={['onChange', 'onBlur']}
          >
            <Input placeholder="/etc/config" />
          </Form.Item>
        </Col>
        <Col span={isReadOnlyImmutable ? 6 : 4}>
          <Form.Item
            name={[...basePath, 'subPath']}
            label="子路径"
            rules={[
              {
                validator: (_, value) => {
                  if (!value) return Promise.resolve();
                  if (value.startsWith('/')) {
                    return Promise.reject(new Error('子路径不能以 / 开头，请使用相对路径'));
                  }
                  if (value.includes('..')) {
                    return Promise.reject(new Error('子路径不能包含 ..'));
                  }
                  return Promise.resolve();
                },
              },
            ]}
            validateTrigger={['onChange', 'onBlur']}
          >
            <Input placeholder="相对路径" />
          </Form.Item>
        </Col>
        {!isReadOnlyImmutable && (
          <Col span={4}>
            <Form.Item
              name={[...basePath, 'readOnly']}
              label="只读"
              valuePropName="checked"
            >
              <Switch size="small" />
            </Form.Item>
          </Col>
        )}
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
                    <Form.Item 
                      name={[name, 'httpGet', 'path']} 
                      label="HTTP 路径"
                      rules={[{ validator: validateHttpProbePath }]}
                    >
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
                <Form.Item 
                  name={[name, 'exec', 'command']} 
                  label="执行命令"
                  rules={[{ validator: validateExecCommand }]}
                >
                  <Select
                    mode="tags"
                    placeholder="输入命令后按回车添加 (如: /bin/sh, -c, ls)"
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

// ============================================================
// 子组件: Pod 亲和性编辑器
// ============================================================
interface PodAffinityEditorProps {
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
                    onChange={(e) => {
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

// ============================================================
// 子组件: 污点容忍编辑器
// ============================================================

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

/**
 * 域名映射编辑器 (HostAliases)
 * 
 * 用于在 Pod 的 /etc/hosts 中添加域名映射
 * 适用于内网服务、绕过 DNS 解析、测试环境等场景
 */
const HostAliasesEditor: React.FC = () => {
  const form = Form.useFormInstance();

  return (
    <div style={{ marginBottom: 16 }}>
      <Form.List name="hostAliases">
        {(fields, { add, remove }) => (
          <>
            <div style={{ marginBottom: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontWeight: 500 }}>域名映射</span>
              <Button
                type="dashed"
                size="small"
                icon={<PlusOutlined />}
                onClick={() => add({ ip: '', hostnames: [] })}
              >
                添加域名映射
              </Button>
            </div>

            <Alert
              type="info"
              showIcon
              style={{ marginBottom: 12 }}
              message="用于在 Pod 的 /etc/hosts 中添加域名映射，适用于内网服务、绕过 DNS 解析等场景"
            />

            {fields.length === 0 && (
              <div style={{ color: '#999', fontSize: 12, padding: '8px 0' }}>
                未配置域名映射，点击上方按钮添加
              </div>
            )}

            {fields.map((field, index) => {
              const ipValue = form.getFieldValue(['hostAliases', field.name, 'ip']);
              return (
                <Card
                  key={field.key}
                  size="small"
                  style={{ marginBottom: 12 }}
                  title={
                    <Space>
                      <Tag color="purple">域名映射 {index + 1}</Tag>
                      {ipValue && (
                        <span style={{ color: '#666', fontSize: 12 }}>
                          {ipValue}
                        </span>
                      )}
                    </Space>
                  }
                  extra={
                    <Button
                      type="text"
                      danger
                      size="small"
                      onClick={() => remove(field.name)}
                    >
                      删除
                    </Button>
                  }
                >
                  <Row gutter={[8, 8]}>
                    <Col span={8}>
                      <Form.Item
                        name={[field.name, 'ip']}
                        label="IP 地址"
                        rules={[
                          { required: true, message: '请输入 IP 地址' },
                          {
                            pattern: /^((25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(25[0-5]|2[0-4]\d|[01]?\d\d?)$/,
                            message: '请输入有效的 IPv4 地址',
                          },
                        ]}
                        style={{ marginBottom: 0 }}
                      >
                        <Input placeholder="例如: 192.168.1.100" />
                      </Form.Item>
                    </Col>
                    <Col span={16}>
                      <Form.Item
                        name={[field.name, 'hostnames']}
                        label="主机名"
                        rules={[{ required: true, message: '请输入主机名' }]}
                        extra="多个主机名用逗号分隔，例如: harbor.local,cloudhci.harbor.local"
                        style={{ marginBottom: 0 }}
                      >
                        <Select
                          mode="tags"
                          placeholder="输入主机名后按回车添加"
                          tokenSeparators={[',', ' ']}
                          style={{ width: '100%' }}
                        />
                      </Form.Item>
                    </Col>
                  </Row>
                </Card>
              );
            })}
          </>
        )}
      </Form.List>
    </div>
  );
};

// ============================================================
// DNS 配置编辑器
// ============================================================

const DnsConfigEditor: React.FC = () => {
  const form = Form.useFormInstance();
  
  const [dnsPolicy, setDnsPolicy] = useState<string>(() => form.getFieldValue('dnsPolicy') || 'ClusterFirst');
  const [nameservers, setNameservers] = useState<string[]>(() => form.getFieldValue('dnsConfig')?.nameservers || []);
  const [searches, setSearches] = useState<string[]>(() => form.getFieldValue('dnsConfig')?.searches || []);
  const [options, setOptions] = useState<Array<{ name: string; value?: string }>>(() => form.getFieldValue('dnsConfig')?.options || []);

  // 编辑模式下 form 数据异步写入，需要再同步一次
  useEffect(() => {
    const policy = form.getFieldValue('dnsPolicy');
    const config = form.getFieldValue('dnsConfig') || {};
    if (policy) {
      setDnsPolicy(policy);
      setNameservers(config.nameservers || []);
      setSearches(config.searches || []);
      setOptions(config.options || []);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleDnsPolicyChange = (value: string) => {
    setDnsPolicy(value);
    form.setFieldsValue({ dnsPolicy: value });
  };
  
  const addNameserver = () => {
    const updated = [...nameservers, ''];
    setNameservers(updated);
    updateDnsConfig({ nameservers: updated });
  };
  
  const removeNameserver = (index: number) => {
    const updated = nameservers.filter((_, i) => i !== index);
    setNameservers(updated);
    updateDnsConfig({ nameservers: updated });
  };
  
  const updateNameserver = (index: number, value: string) => {
    const updated = [...nameservers];
    updated[index] = value;
    setNameservers(updated);
    updateDnsConfig({ nameservers: updated });
  };
  
  const addSearch = () => {
    const updated = [...searches, ''];
    setSearches(updated);
    updateDnsConfig({ searches: updated });
  };
  
  const removeSearch = (index: number) => {
    const updated = searches.filter((_, i) => i !== index);
    setSearches(updated);
    updateDnsConfig({ searches: updated });
  };
  
  const updateSearch = (index: number, value: string) => {
    const updated = [...searches];
    updated[index] = value;
    setSearches(updated);
    updateDnsConfig({ searches: updated });
  };
  
  const addOption = () => {
    const updated = [...options, { name: '', value: '' }];
    setOptions(updated);
    updateDnsConfig({ options: updated });
  };
  
  const removeOption = (index: number) => {
    const updated = options.filter((_, i) => i !== index);
    setOptions(updated);
    updateDnsConfig({ options: updated });
  };
  
  const updateOption = (index: number, field: 'name' | 'value', value: string) => {
    const updated = [...options];
    updated[index] = { ...updated[index], [field]: value };
    setOptions(updated);
    updateDnsConfig({ options: updated });
  };
  
  const updateDnsConfig = (partial: Partial<{
    nameservers?: string[];
    searches?: string[];
    options?: Array<{ name: string; value?: string }>;
  }>) => {
    const currentDnsConfig = form.getFieldValue('dnsConfig') || {};
    const newDnsConfig = {
      ...currentDnsConfig,
      ...partial,
    };
    
    const hasConfig = 
      (newDnsConfig.nameservers && newDnsConfig.nameservers.length > 0) ||
      (newDnsConfig.searches && newDnsConfig.searches.length > 0) ||
      (newDnsConfig.options && newDnsConfig.options.length > 0);
    
    form.setFieldsValue({ 
      dnsConfig: hasConfig ? newDnsConfig : undefined 
    });
  };
  
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ marginBottom: 12 }}>
        <span style={{ fontWeight: 500 }}>DNS 配置</span>
      </div>
      
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 12 }}
        message="DNS 配置用于自定义 Pod 的域名解析策略，适用于自定义 DNS 服务器或修改搜索域等场景"
      />
      
      {/* 隐藏的 Form.Item 用于向 antd 表单注册 dnsPolicy / dnsConfig 字段，使 getFieldValue/setFieldsValue 正常工作 */}
      <Form.Item name="dnsPolicy" hidden><Input /></Form.Item>
      <Form.Item name="dnsConfig" hidden><Input /></Form.Item>

      <Form.Item label="DNS 策略" style={{ marginBottom: 16 }}>
        <Select value={dnsPolicy} onChange={handleDnsPolicyChange}>
          <Select.Option value="Default">Default - 使用节点 DNS 配置</Select.Option>
          <Select.Option value="ClusterFirst">ClusterFirst - 使用集群 DNS（默认）</Select.Option>
          <Select.Option value="ClusterFirstWithHostNet">ClusterFirstWithHostNet - 主机网络使用集群 DNS</Select.Option>
          <Select.Option value="None">None - 自定义 DNS 配置</Select.Option>
        </Select>
      </Form.Item>
      
      {dnsPolicy === 'None' && (
        <>
          <Alert
            type="warning"
            showIcon
            style={{ marginBottom: 12 }}
            message="DNS 策略为 None 时，必须配置 DNS 配置（nameservers、searches 或 options）"
          />

          <Card size="small" title="DNS 服务器" style={{ marginBottom: 12 }}>
            {nameservers.map((ns, index) => (
              <Row key={index} gutter={8} style={{ marginBottom: 8 }}>
                <Col span={20}>
                  <Input
                    placeholder="例如: 10.96.0.10"
                    value={ns}
                    onChange={(e) => updateNameserver(index, e.target.value)}
                  />
                </Col>
                <Col span={4}>
                  <Button
                    type="text"
                    danger
                    icon={<MinusCircleOutlined />}
                    onClick={() => removeNameserver(index)}
                  />
                </Col>
              </Row>
            ))}
            <Button type="dashed" size="small" icon={<PlusOutlined />} onClick={addNameserver}>
              添加 DNS 服务器
            </Button>
          </Card>

          <Card size="small" title="搜索域" style={{ marginBottom: 12 }}>
            {searches.map((s, index) => (
              <Row key={index} gutter={8} style={{ marginBottom: 8 }}>
                <Col span={20}>
                  <Input
                    placeholder="例如: default.svc.cluster.local"
                    value={s}
                    onChange={(e) => updateSearch(index, e.target.value)}
                  />
                </Col>
                <Col span={4}>
                  <Button
                    type="text"
                    danger
                    icon={<MinusCircleOutlined />}
                    onClick={() => removeSearch(index)}
                  />
                </Col>
              </Row>
            ))}
            <Button type="dashed" size="small" icon={<PlusOutlined />} onClick={addSearch}>
              添加搜索域
            </Button>
          </Card>

          <Card size="small" title="DNS 选项">
            {options.map((opt, index) => (
              <Row key={index} gutter={8} style={{ marginBottom: 8 }}>
                <Col span={10}>
                  <Input
                    placeholder="选项名称，例如: ndots"
                    value={opt.name}
                    onChange={(e) => updateOption(index, 'name', e.target.value)}
                  />
                </Col>
                <Col span={10}>
                  <Input
                    placeholder="选项值（可选）"
                    value={opt.value || ''}
                    onChange={(e) => updateOption(index, 'value', e.target.value)}
                  />
                </Col>
                <Col span={4}>
                  <Button
                    type="text"
                    danger
                    icon={<MinusCircleOutlined />}
                    onClick={() => removeOption(index)}
                  />
                </Col>
              </Row>
            ))}
            <Button type="dashed" size="small" icon={<PlusOutlined />} onClick={addOption}>
              添加 DNS 选项
            </Button>
          </Card>
        </>
      )}
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
  onRefreshPVCs: _onRefreshPVCs,
  // 网络配置相关 props
  hideFlatSubnet = false,
}) => {
  const { message, modal } = App.useApp();
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
  
  // 静态 IP 检测状态
  const [checkingStaticIP, setCheckingStaticIP] = useState(false);
  const [staticIPCheckResult, setStaticIPCheckResult] = useState<{
    checked: boolean;
    available: boolean;
    reason: string;
  } | null>(null);
  
  // 监听表单字段变化
  const enableStaticIPWatch = Form.useWatch('enableStaticIP', form);

  const [, setContainersVersion] = useState(0);
  
  const editMetadata = editData?.metadata;
  const syncingContainerRef = useRef(false);
  const nodeAffinityEditorRef = useRef<NodeAffinityEditorHandle>(null);
  const nodeAntiAffinityEditorRef = useRef<NodeAffinityEditorHandle>(null);
  const podAffinityEditorRef = useRef<PodAffinityEditorHandle>(null);
  const podAntiAffinityEditorRef = useRef<PodAffinityEditorHandle>(null);
  const tolerationsEditorRef = useRef<TolerationsEditorHandle>(null);
  const watchedImagePullSecretsValue = Form.useWatch('imagePullSecrets', form);
  const watchedImagePullSecrets = useMemo<string[]>(() => watchedImagePullSecretsValue || [], [watchedImagePullSecretsValue]);
  Form.useWatch('containers', form);
  Form.useWatch('nodeAffinity', form);
  Form.useWatch('nodeAntiAffinity', form);
  Form.useWatch('podAffinity', form);
  Form.useWatch('podAntiAffinity', form);
  Form.useWatch('tolerations', form);
  
  // 存储配置刷新标记，用于通知 VolumesEditor 重新读取数据
  const [volumeRefreshKey, setVolumeRefreshKey] = useState(0);

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
    // 刷新 VolumesEditor 数据
    setVolumeRefreshKey(v => v + 1);
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
    setContainersVersion((v) => v + 1);
  }, [form, getSyncedFormValues, syncContainerEditorToForm]);

  const _handleDuplicateContainer = useCallback(() => {
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
    setContainersVersion((v) => v + 1);
  }, [activeContainerIndex, form, getSyncedFormValues, syncContainerEditorToForm]);

  const _handleRemoveContainer = useCallback(() => {
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
    setContainersVersion((v) => v + 1);
  }, [activeContainerIndex, form, getSyncedFormValues, message, syncContainerEditorToForm]);

  // 编辑模式：初始化表单数据
  useEffect(() => {
    if (!editData) return;
    try {
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

      // 提取域名映射
      const hostAliases = (template?.spec?.hostAliases || []).map((ha: any) => ({
        ip: ha.ip || '',
        hostnames: ha.hostnames || [],
      }));

      // 提取 DNS 配置
      const dnsPolicy = template?.spec?.dnsPolicy;
      const dnsConfigRaw = template?.spec?.dnsConfig;
      const dnsConfig = dnsConfigRaw
        ? {
            nameservers: dnsConfigRaw.nameservers || [],
            searches: dnsConfigRaw.searches || [],
            options: (dnsConfigRaw.options || []).map((opt: any) => ({
              name: opt.name,
              value: opt.value,
            })),
          }
        : undefined;
      
      // 提取存储卷定义
      const rawVolumes = template?.spec?.volumes || [];
      const volumes: VolumeConfig[] = rawVolumes.map((vol: any) => {
        const result: VolumeConfig = {
          name: vol.name,
          type: 'emptyDir', // 默认类型
        };
        
        if (vol.configMap) {
          result.type = 'configMap';
          result.configMapName = vol.configMap.name;
          result.configMapOptional = vol.configMap.optional;
        } else if (vol.secret) {
          result.type = 'secret';
          result.secretName = vol.secret.secretName;
          result.secretOptional = vol.secret.optional;
        } else if (vol.persistentVolumeClaim) {
          result.type = 'persistentVolumeClaim';
          result.claimName = vol.persistentVolumeClaim.claimName;
        } else if (vol.emptyDir) {
          result.type = 'emptyDir';
          result.emptyDirMedium = vol.emptyDir.medium === 'Memory' ? 'Memory' : 'default';
          result.emptyDirSizeLimit = vol.emptyDir.sizeLimit;
        } else if (vol.hostPath) {
          result.type = 'hostPath';
          result.hostPath = vol.hostPath.path;
          result.hostPathType = vol.hostPath.type;
        }
        
        return result;
      });
      
      // 解析网络配置
      const templateAnnotations = template?.metadata?.annotations || {};
      const networksAnnotation = templateAnnotations['k8s.v1.cni.cncf.io/networks'];
      const logicalSwitch = templateAnnotations['ovn.kubernetes.io/logical_switch'];
      const staticIPAnnotation = templateAnnotations['ovn.kubernetes.io/ip_address'];
      
      // 解析网络类型和值
      let networkType = 'default';
      let flatSubnet: string | undefined;
      let vpcSubnet: string | undefined;
      let customNad: string | undefined;
      let vpcName: string | undefined;
      
      if (networksAnnotation) {
        // networksAnnotation 格式: namespace/name 或 name
        if (logicalSwitch) {
          // 有 logical_switch 注解，说明是 VPC 子网
          networkType = 'vpc';
          vpcSubnet = networksAnnotation;
          // VPC 名称需要等网络数据加载后才能确定
        } else {
          // 没有 logical_switch，可能是扁平子网或自定义 NAD
          // 扁平子网的判断需要查询子网数据，这里先假设为扁平子网
          // 如果不是扁平子网，用户可以在网络数据加载后手动调整
          networkType = 'flat_subnet';
          flatSubnet = networksAnnotation;
        }
      }
      
      const enableStaticIP = !!staticIPAnnotation;
      const staticIP = staticIPAnnotation || undefined;
      
      // 设置表单值
      const kind = editData?.kind?.toLowerCase();
      const type = editData?.type?.toLowerCase();
      
      // 根据 kind/type 字段识别工作负载类型
      const workloadTypeValue = kind === 'daemonset' || type === 'daemonset' ? 'daemonset'
        : kind === 'statefulset' || type === 'statefulset' ? 'statefulset'
        : kind === 'deployment' || type === 'deployment' ? 'deployment'
        : defaultType;
      
      form.setFieldsValue({
        workloadType: workloadTypeValue,
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
        hostAliases: hostAliases.length > 0 ? hostAliases : undefined,
        dnsPolicy,
        dnsConfig,
        volumes: volumes, // 始终设置数组，确保 VolumesEditor 能正确读取
        // 网络配置
        networkType,
        flatSubnet,
        vpcSubnet,
        vpcName,
        customNad,
        enableStaticIP,
        staticIP,
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
    } catch (err) {
      console.error('编辑模式初始化表单数据失败:', err);
    }
  }, [editData, defaultType, form]);
  
  // 步骤切换时同步容器数据到顶级字段（特别是步骤3存储配置）
  useEffect(() => {
    if (currentStep === 3) {
      const containers = form.getFieldValue('containers') || [];
      const activeContainer = containers[activeContainerIndex];
      if (activeContainer) {
        syncContainerEditorToForm(activeContainer);
      }
    }
  }, [currentStep, activeContainerIndex, form, syncContainerEditorToForm]);
  
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
        setNads(nadsRes?.data?.items || nadsRes?.items || (Array.isArray(nadsRes) ? nadsRes : []));
      } catch (error) {
        console.error('获取网络数据失败:', error);
      } finally {
        setLoadingNetworkData(false);
      }
    };
    
    fetchNetworkData();
  }, [cloudId]);
  
  // 编辑模式：网络数据加载完成后，根据子网数据正确设置网络类型和 VPC 名称
  useEffect(() => {
    if (!editData || loadingNetworkData || kubeSubnets.length === 0) return;
    
    const template = editData?.spec?.template || {};
    const templateAnnotations = template?.metadata?.annotations || {};
    const networksAnnotation = templateAnnotations['k8s.v1.cni.cncf.io/networks'];
    const logicalSwitch = templateAnnotations['ovn.kubernetes.io/logical_switch'];
    
    if (!networksAnnotation) return;
    
    // 解析 networksAnnotation 获取子网名称
    // 格式: namespace/name 或 name
    const parts = networksAnnotation.split('/');
    const subnetName = parts.length === 2 ? parts[1] : parts[0];
    
    // 查找子网
    const subnet = kubeSubnets.find(s => (s.name || s?.metadata?.name) === subnetName);
    if (!subnet) {
      // 子网未找到，可能是自定义 NAD
      form.setFieldsValue({
        networkType: 'custom_nad',
        customNad: networksAnnotation,
        flatSubnet: undefined,
        vpcSubnet: undefined,
        vpcName: undefined,
      });
      return;
    }
    
    const subnetVpc = subnet?.vpc || subnet?.spec?.vpc;
    const subnetType = subnet?.metadata?.annotations?.['tower.io/subnet-type'];
    
    if (subnetType === 'flat' || subnetVpc === 'ovn-internal') {
      // 扁平子网
      form.setFieldsValue({
        networkType: 'flat_subnet',
        flatSubnet: networksAnnotation,
        vpcSubnet: undefined,
        vpcName: undefined,
        customNad: undefined,
      });
    } else if (logicalSwitch) {
      // VPC 子网
      form.setFieldsValue({
        networkType: 'vpc',
        vpcSubnet: networksAnnotation,
        vpcName: subnetVpc,
        flatSubnet: undefined,
        customNad: undefined,
      });
    } else {
      // 默认当作扁平子网
      form.setFieldsValue({
        networkType: 'flat_subnet',
        flatSubnet: networksAnnotation,
        vpcSubnet: undefined,
        vpcName: undefined,
        customNad: undefined,
      });
    }
  }, [editData, loadingNetworkData, kubeSubnets, form]);
  
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
        const subnetNs = s?.namespace || s?.metadata?.namespace || 'default';
        const alias = s?.metadata?.annotations?.['tower.io/alias'] || s?.annotations?.['tower.io/alias'] || '';
        const cidr = s?.cidr || s?.spec?.cidrBlock || '';
        const label = alias 
          ? `${alias} (${name})${cidr ? ` - ${cidr}` : ''}` 
          : `${name}${cidr ? ` (${cidr})` : ''}`;
        const nadRef = `${subnetNs}/${name}`;
        return {
          label,
          value: nadRef,
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
        const cidr = s?.cidr || s?.spec?.cidrBlock || '';
        const label = alias 
          ? `${alias} (${name})${cidr ? ` - ${cidr}` : ''}` 
          : `${name}${cidr ? ` (${cidr})` : ''}`;
        return {
          label,
          value: name,
          subnet: s,
        };
      });
  }, [kubeSubnets, selectedVpc]);
  
  // 静态 IP 检测函数（调用后端API）
  const handleCheckStaticIP = useCallback(async () => {
    const staticIP = form.getFieldValue('staticIP');
    const networkType = form.getFieldValue('networkType');
    
    if (!staticIP) {
      message.warning('请先输入静态 IP 地址');
      return;
    }
    
    // 验证 IP 格式
    const ipPattern = /^((25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(25[0-5]|2[0-4]\d|[01]?\d\d?)$/;
    if (!ipPattern.test(staticIP)) {
      message.error('请输入有效的 IPv4 地址');
      return;
    }
    
    // 获取当前子网信息
    let subnetName: string | undefined;
    let subnetNs = 'default';
    
    if (networkType === 'flat_subnet') {
      const flatSubnetValue = form.getFieldValue('flatSubnet');
      if (flatSubnetValue) {
        const parts = flatSubnetValue.split('/');
        if (parts.length === 2) {
          subnetNs = parts[0];
          subnetName = parts[1];
        } else {
          subnetName = flatSubnetValue;
        }
      }
    } else if (networkType === 'vpc') {
      const vpcSubnetValue = form.getFieldValue('vpcSubnet');
      if (vpcSubnetValue) {
        const parts = vpcSubnetValue.split('/');
        if (parts.length === 2) {
          subnetNs = parts[0];
          subnetName = parts[1];
        } else {
          subnetName = vpcSubnetValue;
        }
      }
    }
    
    if (!subnetName) {
      message.warning('请先选择子网');
      return;
    }
    
    setCheckingStaticIP(true);
    
    try {
      // 调用后端API检测IP是否已被使用
      const res = await checkSubnetStaticIP(cloudId, subnetNs, subnetName, staticIP);
      const data = res?.data || res;
      const used = data?.used === true;
      const usedBy = data?.usedBy || '';
      
      setStaticIPCheckResult({
        checked: true,
        available: !used,
        reason: used
          ? `IP 已被使用（被 ${usedBy} 占用）`
          : 'IP 可用，未被其他工作负载使用',
      });
      
      if (used) {
        message.error(`IP ${staticIP} 已被使用（被 ${usedBy} 占用）`);
      } else {
        message.success('IP 可用');
      }
    } catch (e: any) {
      // API调用失败，回退到本地检测
      console.warn('静态IP检测API调用失败，回退到本地检测:', e);
      let currentSubnet: any = null;
      
      if (networkType === 'flat_subnet') {
        const flatSubnetValue = form.getFieldValue('flatSubnet');
        const flatSubnetOption = flatSubnetOptions.find(opt => opt.value === flatSubnetValue);
        currentSubnet = flatSubnetOption?.subnet;
      } else if (networkType === 'vpc') {
        const vpcSubnetValue = form.getFieldValue('vpcSubnet');
        if (vpcSubnetValue) {
          const parts = vpcSubnetValue.split('/');
          const sn = parts.length === 2 ? parts[1] : parts[0];
          currentSubnet = kubeSubnets.find(s => 
            (s.name || s?.metadata?.name) === sn && 
            (s.vpc || s?.spec?.vpc) === selectedVpc
          );
        }
      }
      
      if (currentSubnet) {
        const result = checkIpAvailability(staticIP, currentSubnet);
        setStaticIPCheckResult({
          checked: true,
          available: result.available,
          reason: result.reason,
        });
        if (!result.available) {
          message.error(result.reason);
        } else {
          message.success(result.reason);
        }
      } else {
        setStaticIPCheckResult({
          checked: true,
          available: false,
          reason: '检测失败：无法获取子网信息',
        });
        message.error('IP检测失败：无法获取子网信息');
      }
    } finally {
      setCheckingStaticIP(false);
    }
  }, [cloudId, form, flatSubnetOptions, kubeSubnets, selectedVpc, message]);
  
  
  const allNadOptions = useMemo(() => {
    const selectedNamespace = form.getFieldValue('namespace') || defaultNamespace || 'default';
    return (nads || [])
      .map((n: any) => {
        const name = n?.metadata?.name || n?.name;
        const ns = n?.metadata?.namespace || n?.namespace || 'default';
        const displayName = n?.spec?.displayName || n?.metadata?.annotations?.['tower.io/alias'] || '';
        
        let type = 'unknown';
        let vlan: any = undefined;
        let promiscMode = false;
        try {
          const cfg = JSON.parse(n?.spec?.config || '{}');
          type = String(cfg?.type || 'unknown').toLowerCase();
          vlan = cfg?.vlan;
          promiscMode = !!cfg?.promiscMode;
        } catch {}
        
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
          _promisc: promiscMode,
        };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null)
      .filter((x: any) => x._promisc === true)
      .filter((x: any) => x.value.split('/')[0] === selectedNamespace)
      .sort((a, b) => a.label.localeCompare(b.label));
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
      hostAliases,
      dnsPolicy,
      dnsConfig,
      volumes,
      // 网络配置
      networkType,
      flatSubnet,
      vpcName: _vpcName,
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
    
    // 构建域名映射
    const hostAliasesList = (hostAliases || [])
      .filter((ha) => ha.ip && ha.hostnames && ha.hostnames.length > 0)
      .map((ha) => ({
        ip: ha.ip,
        hostnames: ha.hostnames,
      }));
    
    // 构建 DNS 配置
    const dnsConfigObj: any = {};
    if (dnsConfig?.nameservers && dnsConfig.nameservers.length > 0) {
      dnsConfigObj.nameservers = dnsConfig.nameservers.filter((ns) => ns);
    }
    if (dnsConfig?.searches && dnsConfig.searches.length > 0) {
      dnsConfigObj.searches = dnsConfig.searches.filter((s) => s);
    }
    if (dnsConfig?.options && dnsConfig.options.length > 0) {
      dnsConfigObj.options = dnsConfig.options
        .filter((opt) => opt.name)
        .map((opt) => ({
          name: opt.name,
          ...(opt.value !== undefined && opt.value !== '' && { value: opt.value }),
        }));
    }
    const hasDnsConfig = Object.keys(dnsConfigObj).length > 0;
    
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
          // 扁平子网：设置 networks 注解和 logical_switch 注解
          if (flatSubnet) {
            annotations['k8s.v1.cni.cncf.io/networks'] = flatSubnet;
            // 扁平子网需要 logical_switch 注解，格式为 <namespace>/<subnet-name>
            const flatParts = flatSubnet.split('/');
            const subnetName = flatParts.length === 2 ? flatParts[1] : flatSubnet;
            if (flatParts.length === 2) {
              annotations['ovn.kubernetes.io/logical_switch'] = flatParts[1];
            } else if (flatParts.length === 1) {
              annotations['ovn.kubernetes.io/logical_switch'] = flatSubnet;
            }
            // 扁平子网静态IP需要用网络名称前缀的注解格式
            // 格式: <subnet-name>.default.ovn.kubernetes.io/ip_address
            if (enableStaticIP && staticIP) {
              // 同时设置两种格式的静态IP注解，确保兼容性
              annotations['ovn.kubernetes.io/ip_address'] = staticIP;
              // 使用网络名称前缀格式（这是Kube-OVN多网络模式识别的格式）
              annotations[`${subnetName}.default.ovn.kubernetes.io/ip_address`] = staticIP;
            }
          }
          break;
          
        case 'vpc':
          // VPC 子网：设置 networks 注解
          if (vpcSubnet) {
            annotations['k8s.v1.cni.cncf.io/networks'] = vpcSubnet;
            // Kube-OVN VPC 子网需要 logical_switch 注解
            const subnetParts = vpcSubnet.split('/');
            const vpcSubnetName = subnetParts.length === 2 ? subnetParts[1] : vpcSubnet;
            if (subnetParts.length === 2) {
              annotations['ovn.kubernetes.io/logical_switch'] = subnetParts[1];
            }
            // VPC 子网静态IP需要用网络名称前缀的注解格式
            if (enableStaticIP && staticIP) {
              annotations['ovn.kubernetes.io/ip_address'] = staticIP;
              const vpcSubnetNs = subnetParts.length === 2 ? subnetParts[0] : 'default';
              annotations[`${vpcSubnetName}.${vpcSubnetNs}.ovn.kubernetes.io/ip_address`] = staticIP;
            }
          }
          break;
          
        case 'custom_nad':
          if (customNad) {
            annotations['k8s.v1.cni.cncf.io/networks'] = customNad;
            const selectedNadOption = allNadOptions.find((o: any) => o.value === customNad);
            if (selectedNadOption?._type === 'kube-ovn') {
              const nadParts = customNad.split('/');
              if (nadParts.length === 2) {
                annotations['ovn.kubernetes.io/logical_switch'] = nadParts[1];
              }
            }
          }
          break;
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
            hostAliases: hostAliasesList.length > 0 ? hostAliasesList : undefined,
            dnsPolicy: dnsPolicy && dnsPolicy !== 'ClusterFirst' ? dnsPolicy : undefined,
            dnsConfig: hasDnsConfig ? dnsConfigObj : undefined,
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
  }, [allNadOptions]);
  
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
      
      // 提取域名映射
      const hostAliases = (resource.spec?.template?.spec?.hostAliases || []).map((ha: any) => ({
        ip: ha.ip || '',
        hostnames: ha.hostnames || [],
      }));
      
      // 提取 DNS 配置
      const dnsPolicy = resource.spec?.template?.spec?.dnsPolicy;
      const dnsConfigRaw = resource.spec?.template?.spec?.dnsConfig;
      const dnsConfig = dnsConfigRaw ? {
        nameservers: dnsConfigRaw.nameservers || [],
        searches: dnsConfigRaw.searches || [],
        options: (dnsConfigRaw.options || []).map((opt: any) => ({
          name: opt.name,
          value: opt.value,
        })),
      } : undefined;
      
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
        hostAliases: hostAliases.length > 0 ? hostAliases : undefined,
        dnsPolicy,
        dnsConfig,
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
  }, [mode, form, formToYaml, yamlToForm, yamlContent, message, getDefaultYaml, workloadType, isEditMode, editData, buildK8sResource, getSyncedFormValues]);
  
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
          'nodeAffinity', 'nodeAntiAffinity', 'tolerations', 'hostAliases', 'dnsPolicy', 'dnsConfig',
          'livenessProbe', 'readinessProbe',
          'volumes', 'volumeMounts'
        ]);

        const syncedValues = getSyncedFormValues();
        
        // DEBUG: 打印表单中的 volumeMounts
        const invalidContainerIndex = (syncedValues.containers || []).findIndex((container) => !container.image);
        if (invalidContainerIndex >= 0) {
          setCurrentStep(1);
          setActiveContainerIndex(invalidContainerIndex);
          syncContainerEditorToForm(syncedValues.containers[invalidContainerIndex]);
          message.error(`请完善容器 ${invalidContainerIndex + 1} 的镜像地址`);
          setLoading(false);
          return;
        }
        
        // 校验容器名称是否重复
        const containerNames = (syncedValues.containers || [])
          .map(c => c.containerName)
          .filter(name => name && name.trim());
        const duplicateNames = containerNames.filter((name, index) => 
          containerNames.indexOf(name) !== index
        );
        if (duplicateNames.length > 0) {
          setCurrentStep(1); // 跳转到容器配置步骤
          message.error(`容器名称重复: ${[...new Set(duplicateNames)].join(', ')}，请使用不同的容器名称`);
          setLoading(false);
          return;
        }
        
        // 校验存储卷挂载：如果定义了存储卷，则必须配置至少一个卷挂载
        const volumes = syncedValues.volumes || [];
        const volumeMounts = syncedValues.volumeMounts || [];
        if (volumes.length > 0 && volumeMounts.length === 0) {
          setCurrentStep(3); // 跳转到存储配置步骤
          message.warning('已定义存储卷，请配置至少一个卷挂载');
          setLoading(false);
          return;
        }
        
        // 校验静态 IP 是否在子网 CIDR 范围内
        if (syncedValues.enableStaticIP && syncedValues.staticIP) {
          const networkType = syncedValues.networkType;
          let subnetCidr: string | undefined;
          
          if (networkType === 'flat_subnet' && syncedValues.flatSubnet) {
            // 扁平子网：从 flatSubnetOptions 中查找 CIDR
            const flatSubnetOption = flatSubnetOptions.find(opt => opt.value === syncedValues.flatSubnet);
            subnetCidr = flatSubnetOption?.subnet?.cidr || flatSubnetOption?.subnet?.spec?.cidrBlock;
          } else if (networkType === 'vpc' && syncedValues.vpcSubnet) {
            // VPC 子网：从 kubeSubnets 中查找 CIDR
            // vpcSubnet 格式为 namespace/name 或 name
            const parts = syncedValues.vpcSubnet.split('/');
            const subnetName = parts.length === 2 ? parts[1] : parts[0];
            const subnet = kubeSubnets.find(s => 
              (s.name || s?.metadata?.name) === subnetName && 
              (s.vpc || s?.spec?.vpc) === syncedValues.vpcName
            );
            subnetCidr = subnet?.cidr || subnet?.spec?.cidrBlock;
          }
          
          if (subnetCidr && !isIpInCidr(syncedValues.staticIP, subnetCidr)) {
            setCurrentStep(2); // 跳转到网络配置步骤
            message.error(`静态 IP ${syncedValues.staticIP} 不在子网 CIDR 范围 ${subnetCidr} 内，请检查`);
            setLoading(false);
            return;
          }
          
          // 校验静态 IP 是否可用（调用后端API）
          let subnetName: string | undefined;
          let subnetNs = 'default';
          
          if (networkType === 'flat_subnet' && syncedValues.flatSubnet) {
            const flatParts = syncedValues.flatSubnet.split('/');
            if (flatParts.length === 2) {
              subnetNs = flatParts[0];
              subnetName = flatParts[1];
            } else {
              subnetName = syncedValues.flatSubnet;
            }
          } else if (networkType === 'vpc' && syncedValues.vpcSubnet) {
            const vpcParts = syncedValues.vpcSubnet.split('/');
            if (vpcParts.length === 2) {
              subnetNs = vpcParts[0];
              subnetName = vpcParts[1];
            } else {
              subnetName = syncedValues.vpcSubnet;
            }
          }
          
          if (subnetName) {
            try {
              const ipCheckRes = await checkSubnetStaticIP(cloudId, subnetNs, subnetName, syncedValues.staticIP);
              const ipCheckData = ipCheckRes?.data || ipCheckRes;
              if (ipCheckData?.used === true) {
                setCurrentStep(2);
                message.error(`静态 IP ${syncedValues.staticIP} 已被使用（被 ${ipCheckData.usedBy || '其他工作负载'} 占用）`);
                setLoading(false);
                return;
              }
            } catch (e: any) {
              // API调用失败，弹出确认框让用户确认
              console.warn('静态IP检测API调用失败:', e);
              const confirmed = await new Promise<boolean>((resolve) => {
                modal.confirm({
                  title: '静态 IP 冲突风险',
                  content: (
                    <div>
                      <p>无法自动检测 IP <strong>{syncedValues.staticIP}</strong> 是否已被使用。</p>
                      <p style={{ color: '#faad14', marginTop: 8 }}>
                        ⚠️ 请确认该 IP 未被其他工作负载使用，否则可能导致网络冲突。
                      </p>
                    </div>
                  ),
                  okText: '确认未使用，继续提交',
                  cancelText: '取消',
                  onOk: () => resolve(true),
                  onCancel: () => resolve(false),
                });
              });
              if (!confirmed) {
                setCurrentStep(2);
                setLoading(false);
                return;
              }
            }
          }
        }
        
        // 校验节点亲和性/反亲和性的标签键输入错误
        const nodeAffinityHasErrors = nodeAffinityEditorRef.current?.getHasLabelErrors();
        const nodeAntiAffinityHasErrors = nodeAntiAffinityEditorRef.current?.getHasLabelErrors();
        if (nodeAffinityHasErrors || nodeAntiAffinityHasErrors) {
          setCurrentStep(4);
          setLoading(false);
          return;
        }
        
        // 校验 Pod 亲和性/反亲和性的 matchLabels 输入错误
        const podAffinityHasErrors = podAffinityEditorRef.current?.getHasLabelErrors();
        const podAntiAffinityHasErrors = podAntiAffinityEditorRef.current?.getHasLabelErrors();
        if (podAffinityHasErrors || podAntiAffinityHasErrors) {
          setCurrentStep(4);
          setLoading(false);
          return;
        }
        
        // 校验污点容忍的键/值输入错误
        const tolerationsHasErrors = tolerationsEditorRef.current?.getHasLabelErrors();
        if (tolerationsHasErrors) {
          setCurrentStep(4);
          setLoading(false);
          return;
        }
        
        resource = buildK8sResource(syncedValues);
        apiPath = getApiPath(values.workloadType);

        // 防御性检查：编辑模式下若表单 workloadType 与资源类型不一致，自动纠正
        if (isEditMode) {
          const editKind = editData?.kind?.toLowerCase()
            || (editMetadata?.name && (() => {
              if (editMetadata.name.startsWith('id-ds-')) return 'daemonset';
              if (editMetadata.name.startsWith('id-sts-')) return 'statefulset';
              if (editMetadata.name.startsWith('id-dep-')) return 'deployment';
              return null;
            })());
          if (editKind) {
            const formType = values.workloadType?.toLowerCase();
            if (editKind !== formType) {
              console.warn('[WorkloadForm 提交] workloadType 不一致，自动纠正:', { formType, editKind, name: editMetadata?.name });
              values.workloadType = editKind;
              syncedValues.workloadType = editKind;
              resource = buildK8sResource(syncedValues);
              apiPath = getApiPath(editKind as WorkloadType);
            }
          }
        }

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
      
      // 检测版本冲突（409 Conflict）
      const isConflict = error?.response?.status === 409
        || error?.status === 409
        || /conflict/i.test(error?.message || '')
        || /resourceVersion/i.test(error?.message || '');
      
      if (isConflict) {
        Modal.confirm({
          title: '版本冲突',
          content: '该资源已被其他用户修改，请刷新后重新编辑。',
          okText: '确认刷新',
          cancelText: '取消',
          onOk: () => {
            onSuccess(); // 刷新列表并关闭抽屉
          },
        });
      } else {
        const friendlyMsg = parseK8sError(error);
        message.error(friendlyMsg);
      }
    } finally {
      setLoading(false);
    }
  }, [mode, yamlContent, validateYaml, form, buildK8sResource, getApiPath, cloudId, message, modal, onSuccess, isEditMode, getSyncedFormValues, syncContainerEditorToForm, editMetadata, editData?.kind, editData?.spec?.selector, editData?.spec?.template?.metadata?.labels, flatSubnetOptions, kubeSubnets]);
  
  // 下一步
  const handleNext = useCallback(async () => {
    try {
      await form.validateFields();
      // 切换步骤前持久化当前容器数据（包括 volumeMounts）
      persistActiveContainerToForm();
      
      // 在存储配置页面（步骤3）点击下一步时，检查是否有存储卷但没有卷挂载
      if (currentStep === 3) {
        const volumes = form.getFieldValue('volumes') || [];
        const containers = form.getFieldValue('containers') || [];
        let hasVolumeMounts = false;
        
        for (const container of containers) {
          if ((container.volumeMounts || []).length > 0) {
            hasVolumeMounts = true;
            break;
          }
        }
        
        if (volumes.length > 0 && !hasVolumeMounts) {
          message.warning('已定义存储卷，请配置至少一个卷挂载');
          return;
        }
      }
      
      setCurrentStep((prev) => prev + 1);
    } catch {
      // 验证失败，不跳转
    }
  }, [form, persistActiveContainerToForm, currentStep, message]);
  
  // 上一步
  const handlePrev = useCallback(() => {
    // 切换步骤前持久化当前容器数据（包括 volumeMounts）
    persistActiveContainerToForm();
    setCurrentStep((prev) => prev - 1);
  }, [persistActiveContainerToForm]);

  const handleStepClick = useCallback(async (targetStep: number) => {
    if (targetStep === currentStep) return;
    
    // 切换步骤前持久化当前容器数据（包括 volumeMounts）
    persistActiveContainerToForm();
    
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
  }, [currentStep, form, persistActiveContainerToForm]);


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
    if (values.enableStaticIP && values.staticIP && values.networkType !== 'custom_nad') {
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
                  label="项目"
                  rules={[{ required: true, message: '请选择项目' }]}
                  initialValue={defaultNamespace}
                >
                  <Select
                    showSearch
                    disabled={isEditMode}
                    optionFilterProp="label"
                    placeholder="选择项目"
                    options={namespacesOptions
                      .filter((ns) => !isSystemNamespace(ns))
                      .map((ns) => ({ label: ns, value: ns }))}
                  />
                </Form.Item>
              </Col>
            </Row>
            
            <LabelEditor name="labels" label="标签" />
            
            {workloadType !== 'daemonset' && (
              <Form.Item
                name="replicas"
                label="副本数"
                initialValue={1}
                rules={[{ required: true, message: '请输入副本数' }]}
              >
                <InputNumber min={1} max={1000} style={{ width: '100%' }} />
              </Form.Item>
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
                          setContainersVersion((v) => v + 1);
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
                            setContainersVersion((v) => v + 1);
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
                          <Form.Item 
                            name="containerName" 
                            label="容器名称" 
                            extra="默认与工作负载名称相同，仅支持小写字母、数字和连字符"
                            rules={[
                              {
                                pattern: /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/,
                                message: '容器名称只能包含小写字母、数字和连字符，且开头结尾必须是字母或数字',
                              },
                            ]}
                          >
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
                          options={(imagePullSecrets || []).map((secret) => {
                            const alias = secret?.metadata?.annotations?.['tower.io/alias'];
                            const name = secret?.metadata?.name;
                            return {
                              label: alias ? `${alias} (${name})` : name,
                              value: name,
                            };
                          })}
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
                            <>
                              <Row gutter={16}>
                                <Col span={12}>
                                  <Form.Item
                                    name={['resources', 'requests', 'cpu']}
                                    label="CPU 请求"
                                    dependencies={[['resources', 'limits', 'cpu']]}
                                    rules={[
                                      {
                                        validator: (_, value) => {
                                          if (!value) return Promise.resolve();
                                          const limit = form.getFieldValue(['resources', 'limits', 'cpu']);
                                          if (limit && compareCpuResources(value, limit) > 0) {
                                            return Promise.reject(new Error('请求值不能超过限制值'));
                                          }
                                          return Promise.resolve();
                                        },
                                      },
                                    ]}
                                  >
                                    <ResourceInput placeholder="如: 100" units={CPU_UNITS} defaultUnit="m" unitTooltip="m: 毫核(1000m=1核)；核: 支持小数如0.5" />
                                  </Form.Item>
                                </Col>
                                <Col span={12}>
                                  <Form.Item
                                    name={['resources', 'limits', 'cpu']}
                                    label="CPU 限制"
                                    dependencies={[['resources', 'requests', 'cpu']]}
                                    rules={[
                                      {
                                        validator: (_, value) => {
                                          if (!value) return Promise.resolve();
                                          const request = form.getFieldValue(['resources', 'requests', 'cpu']);
                                          if (request && compareCpuResources(request, value) > 0) {
                                            return Promise.reject(new Error('限制值不能小于请求值'));
                                          }
                                          return Promise.resolve();
                                        },
                                      },
                                    ]}
                                  >
                                    <ResourceInput placeholder="如: 500" units={CPU_UNITS} defaultUnit="m" unitTooltip="m: 毫核(1000m=1核)；核: 支持小数如0.5" />
                                  </Form.Item>
                                </Col>
                              </Row>
                              <Row gutter={16}>
                                <Col span={12}>
                                  <Form.Item
                                    name={['resources', 'requests', 'memory']}
                                    label="内存请求"
                                    dependencies={[['resources', 'limits', 'memory']]}
                                    rules={[
                                      {
                                        validator: (_, value) => {
                                          if (!value) return Promise.resolve();
                                          const limit = form.getFieldValue(['resources', 'limits', 'memory']);
                                          if (limit && compareMemoryResources(value, limit) > 0) {
                                            return Promise.reject(new Error('请求值不能超过限制值'));
                                          }
                                          return Promise.resolve();
                                        },
                                      },
                                    ]}
                                  >
                                    <ResourceInput placeholder="如: 128" units={MEMORY_UNITS} defaultUnit="Mi" unitTooltip="MiB/GiB: 二进制单位(1GiB=1024MiB)，任意数值均可" />
                                  </Form.Item>
                                </Col>
                                <Col span={12}>
                                  <Form.Item
                                    name={['resources', 'limits', 'memory']}
                                    label="内存限制"
                                    dependencies={[['resources', 'requests', 'memory']]}
                                    rules={[
                                      {
                                        validator: (_, value) => {
                                          if (!value) return Promise.resolve();
                                          const request = form.getFieldValue(['resources', 'requests', 'memory']);
                                          if (request && compareMemoryResources(request, value) > 0) {
                                            return Promise.reject(new Error('限制值不能小于请求值'));
                                          }
                                          return Promise.resolve();
                                        },
                                      },
                                    ]}
                                  >
                                    <ResourceInput placeholder="如: 512" units={MEMORY_UNITS} defaultUnit="Mi" unitTooltip="MiB/GiB: 二进制单位(1GiB=1024MiB)，任意数值均可" />
                                  </Form.Item>
                                </Col>
                              </Row>
                            </>
                          ),
                        },
                        {
                          key: 'command',
                          label: `启动命令 (${commandCount})`,
                          children: (
                            <Row gutter={16}>
                              <Col span={12}>
                                <Form.Item 
                                  name="command" 
                                  label="启动命令" 
                                  extra="覆盖容器默认入口点，多个命令用逗号分隔"
                                  rules={[
                                    {
                                      validator: (_, value) => {
                                        if (!value || !Array.isArray(value)) return Promise.resolve();
                                        const chineseRegex = /[\u4e00-\u9fa5]/;
                                        for (let i = 0; i < value.length; i++) {
                                          if (chineseRegex.test(value[i])) {
                                            return Promise.reject(new Error('不能包含中文字符'));
                                          }
                                        }
                                        return Promise.resolve();
                                      },
                                    },
                                  ]}
                                >
                                  <Select mode="tags" placeholder="如: /bin/sh" style={{ width: '100%' }} tokenSeparators={[',']} />
                                </Form.Item>
                              </Col>
                              <Col span={12}>
                                <Form.Item 
                                  name="args" 
                                  label="启动参数" 
                                  extra="传递给入口点的参数，多个参数用逗号分隔"
                                  rules={[
                                    {
                                      validator: (_, value) => {
                                        if (!value || !Array.isArray(value)) return Promise.resolve();
                                        const chineseRegex = /[\u4e00-\u9fa5]/;
                                        for (let i = 0; i < value.length; i++) {
                                          if (chineseRegex.test(value[i])) {
                                            return Promise.reject(new Error('不能包含中文字符'));
                                          }
                                        }
                                        return Promise.resolve();
                                      },
                                    },
                                  ]}
                                >
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
        
        return (
          <div>
            <Alert
              type="info"
              showIcon
              style={{ marginBottom: 16 }}
              message="网络配置"
              description={
                <div>
                  <div>配置 Pod 的网络连接方式。默认使用 Pod 网络，也可以选择扁平子网、VPC 子网或自定义 NAD。</div>
                  <div style={{ marginTop: 8, color: '#faad14' }}>
                    💡 提示：如果您刚创建了子网，请等待几秒钟让系统完成 NAD 创建后再创建工作负载。
                  </div>
                </div>
              }
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
                            <div style={{ marginTop: 8, color: '#1677ff' }}>💡 如果您刚创建了子网，请等待几秒钟让系统完成 NAD 创建后再重试。</div>
                          </div>
                        }
                      />
                    )}
                    {flatSubnetOptions.length > 0 && (
                      <Alert
                        type="info"
                        showIcon
                        style={{ marginBottom: 16 }}
                        message="子网选择提示"
                        description="如果您刚创建了子网，请等待几秒钟让系统完成 NAD 创建后再创建工作负载，否则可能出现 NAD 未找到的错误。"
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
                      />
                    </Form.Item>
                  </>
                )}
                
                {networkType === 'vpc' && (
                  <>
                    <Alert
                      type="info"
                      showIcon
                      style={{ marginBottom: 16 }}
                      message="子网选择提示"
                      description="如果您刚创建了子网，请等待几秒钟让系统完成 NAD 创建后再创建工作负载，否则可能出现 NAD 未找到的错误。"
                    />
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
                        options={vpcSubnetOptions.map(opt => {
                          // 查找子网对象生成 NAD 引用
                          const subnet = (kubeSubnets || []).find(s => 
                            (s.name || s?.metadata?.name) === opt.value && 
                            (s.vpc || s?.spec?.vpc) === selectedVpc
                          );
                          
                          let nadRef = opt.value;
                          if (subnet) {
                            let subnetNs = subnet?.namespace || subnet?.metadata?.namespace;
                            if (!subnetNs) {
                              const provider = subnet?.provider || subnet?.spec?.provider;
                              if (provider) {
                                const parts = provider.split('.');
                                if (parts.length >= 2) subnetNs = parts[parts.length - 2];
                              }
                            }
                            subnetNs = subnetNs || 'default';
                            nadRef = `${subnetNs}/${opt.value}`;
                          }
                          
                          return {
                            ...opt,
                            value: nadRef,
                          };
                        })}
                        disabled={!selectedVpc}
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
                
                {networkType !== 'default' && networkType !== 'custom_nad' && (() => {
                  // 获取当前子网的 CIDR 信息
                  let currentCidr: string | undefined;
                  
                  if (networkType === 'flat_subnet') {
                    const flatSubnetValue = form.getFieldValue('flatSubnet');
                    const flatSubnetOption = flatSubnetOptions.find(opt => opt.value === flatSubnetValue);
                    currentCidr = flatSubnetOption?.subnet?.cidr || flatSubnetOption?.subnet?.spec?.cidrBlock;
                  } else if (networkType === 'vpc') {
                    const vpcSubnetValue = form.getFieldValue('vpcSubnet');
                    if (vpcSubnetValue) {
                      const parts = vpcSubnetValue.split('/');
                      const subnetName = parts.length === 2 ? parts[1] : parts[0];
                      const subnet = kubeSubnets.find(s => 
                         (s.name || s?.metadata?.name) === subnetName && 
                         (s.vpc || s?.spec?.vpc) === selectedVpc
                       );
                       currentCidr = subnet?.cidr || subnet?.spec?.cidrBlock;
                     }
                   }
                   
return (
                      <Form.Item label="静态IP配置">
                        <Space direction="vertical" style={{ width: '100%' }}>
                          <Form.Item name="enableStaticIP" valuePropName="checked" noStyle>
                            <Checkbox>启用静态IP</Checkbox>
                          </Form.Item>
                          {(enableStaticIPWatch ?? form.getFieldValue('enableStaticIP')) && (
                           <>
                             {currentCidr && (
                               <div style={{ color: '#666', fontSize: 12, marginBottom: 8 }}>
                                 子网 CIDR: <Tag color="blue">{currentCidr}</Tag>
                               </div>
                             )}
                            <Form.Item
                              name="staticIP"
                              label="静态IP地址"
                              rules={[
                                { required: true, message: '请输入静态IP地址' },
                                {
                                  pattern: /^((25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(25[0-5]|2[0-4]\d|[01]?\d\d?)$/,
                                  message: '请输入有效的IPv4地址'
                                },
                                ...(currentCidr ? [{
                                  validator: (_: any, value: string) => {
                                    if (!value || isIpInCidr(value, currentCidr!)) {
                                      return Promise.resolve();
                                    }
                                    return Promise.reject(new Error(`IP 地址不在子网 CIDR 范围 ${currentCidr} 内`));
                                  }
                                } as any] : []),
                                {
                                  validator: () => {
                                    if (staticIPCheckResult && !staticIPCheckResult.available) {
                                      return Promise.reject(new Error(staticIPCheckResult.reason));
                                    }
                                    return Promise.resolve();
                                  }
                                }
                              ]}
                              extra={currentCidr ? `子网 CIDR: ${currentCidr}` : '请先选择子网以获取 CIDR 范围'}
                            >
                              <Input 
                                placeholder="例如: 192.168.1.100" 
                                addonAfter={
                                  <Button 
                                    type="link" 
                                    size="small"
                                    loading={checkingStaticIP}
                                    onClick={handleCheckStaticIP}
                                    style={{ padding: '0 8px' }}
                                  >
                                    检测
                                  </Button>
                                }
                                onChange={() => {
                                  setStaticIPCheckResult(null);
                                }}
                              />
                            </Form.Item>
                            {staticIPCheckResult && (
                              <Alert
                                type={staticIPCheckResult.available ? 'success' : 'error'}
                                showIcon
                                style={{ marginBottom: 16 }}
                                message={staticIPCheckResult.available ? 'IP 可用' : 'IP 不可用'}
                                description={staticIPCheckResult.reason}
                              />
                            )}
                            {!staticIPCheckResult && (
                              <Alert
                                type="warning"
                                showIcon
                                style={{ marginBottom: 16 }}
                                message="建议点击「检测」按钮验证 IP 是否可用后再提交"
                              />
                            )}
                           </>
                         )}
                       </Space>
                     </Form.Item>
                   );
                 })()}
                
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
                          <div style={{ marginTop: 8 }}>自定义 NAD 仅展示当前命名空间下混杂模式已开启的网络。Kube-OVN 类型的 NAD 将自动补充子网注解。非 Kube-OVN 类型（如 macvlan/bridge）的 NAD 需在 NAD 配置中设置 IPAM（如 DHCP 或静态 IP）才能为容器分配 IP 地址。</div>
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
                      refreshKey={volumeRefreshKey}
                      onVolumeChange={() => setVolumeRefreshKey(v => v + 1)}
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
        const hostAliases = form.getFieldValue('hostAliases') || [];
        
        const nodeAffinityCount = (nodeAffinity?.required?.nodeSelectorTerms?.length || 0) + (nodeAffinity?.preferred?.length || 0);
        const nodeAntiAffinityCount = (nodeAntiAffinity?.required?.nodeSelectorTerms?.length || 0) + (nodeAntiAffinity?.preferred?.length || 0);
        const podAffinityCount = (podAffinity?.required?.length || 0) + (podAffinity?.preferred?.length || 0);
        const podAntiAffinityCount = (podAntiAffinity?.required?.length || 0) + (podAntiAffinity?.preferred?.length || 0);
        const tolerationsCount = tolerations.length;
        const hostAliasesCount = hostAliases.length;
        
        return (
          <div>
            <Divider orientation="left">调度策略</Divider>
            <LabelEditor name="nodeSelector" label="节点选择器" />
            
            <Collapse ghost defaultActiveKey={[]} items={[
              {
                key: 'nodeAffinity',
                label: `节点亲和性 (${nodeAffinityCount})`,
                children: <NodeAffinityEditor ref={nodeAffinityEditorRef} name="nodeAffinity" label="节点亲和性" />,
              },
              {
                key: 'nodeAntiAffinity',
                label: `节点反亲和性 (${nodeAntiAffinityCount})`,
                children: <NodeAffinityEditor ref={nodeAntiAffinityEditorRef} name="nodeAntiAffinity" label="节点反亲和性" />,
              },
              {
                key: 'podAffinity',
                label: `Pod 亲和性 (${podAffinityCount})`,
                children: (
                  <PodAffinityEditor 
                    ref={podAffinityEditorRef}
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
                    ref={podAntiAffinityEditorRef}
                    name="podAntiAffinity" 
                    label="Pod 反亲和性" 
                    namespacesOptions={namespacesOptions}
                  />
                ),
              },
              {
                key: 'tolerations',
                label: `污点容忍 (${tolerationsCount})`,
                children: <TolerationsEditor ref={tolerationsEditorRef} />,
              },
              {
                key: 'hostAliases',
                label: `域名映射 (${hostAliasesCount})`,
                children: <HostAliasesEditor />,
              },
              {
                key: 'dnsConfig',
                label: `DNS 配置`,
                children: <DnsConfigEditor />,
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
        onSelectImage={(image, secret) => {
          form.setFieldsValue({ image });
          if (secret) {
            const currentSecrets = form.getFieldValue('imagePullSecrets') || [];
            if (!currentSecrets.includes(secret)) {
              form.setFieldsValue({ imagePullSecrets: [...currentSecrets, secret] });
              message.success(`已选择镜像: ${image}，并自动添加拉取凭证: ${secret}`);
            } else {
              message.success(`已选择镜像: ${image}`);
            }
          } else {
            message.success(`已选择镜像: ${image}`);
          }
          setBrowserVisible(false);
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
                        <span style={{ color: '#888' }}>项目</span>
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
