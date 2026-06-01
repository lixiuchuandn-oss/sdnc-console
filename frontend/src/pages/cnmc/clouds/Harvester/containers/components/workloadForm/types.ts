/**
 * WorkloadForm 类型定义
 */

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
