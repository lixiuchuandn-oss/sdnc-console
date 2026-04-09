/**
 * 容器模块公共组件导出
 */

export { default as WorkloadForm } from './WorkloadForm';
export { default as WorkloadFormModal } from './WorkloadFormModal';
export type { WorkloadType, WorkloadFormValues, WorkloadFormProps } from './WorkloadForm';
export type { WorkloadFormModalProps } from './WorkloadFormModal';

// 镜像凭证组件
export { default as RegistryCredentialModal } from './RegistryCredentialModal';
export type { RegistryCredentialModalProps } from './RegistryCredentialModal';

// 镜像仓库浏览器组件
export { default as RegistryBrowser } from './RegistryBrowser';
export { default as RegistryBrowserDrawer } from './RegistryBrowserDrawer';
export type { RegistryCredential } from './RegistryBrowser';
export type { RegistryBrowserDrawerProps } from './RegistryBrowserDrawer';

// Job 和 CronJob 表单组件
export { default as JobForm } from './JobForm';
export { default as CronJobForm } from './CronJobForm';
export type { JobFormValues, JobFormProps } from './JobForm';
export type { CronJobFormValues, CronJobFormProps } from './CronJobForm';

// Service 表单组件
export { default as ServiceForm } from './ServiceForm';
export { default as ServiceFormModal } from './ServiceFormModal';
export type { ServiceFormValues, ServiceFormProps } from './ServiceForm';
export type { ServiceFormModalProps } from './ServiceFormModal';

// Ingress 表单组件
export { default as IngressForm } from './IngressForm';
export { default as IngressFormModal } from './IngressFormModal';
export type { IngressFormValues, IngressFormProps } from './IngressForm';
export type { IngressFormModalProps } from './IngressFormModal';

// Gateway API 表单组件
export { default as GatewayForm } from './GatewayForm';
export { default as GatewayFormModal } from './GatewayFormModal';
export type { GatewayFormValues, GatewayFormProps } from './GatewayForm';
export type { GatewayFormModalProps } from './GatewayFormModal';

export { default as HTTPRouteForm } from './HTTPRouteForm';
export { default as HTTPRouteFormModal } from './HTTPRouteFormModal';
export type { HTTPRouteFormValues, HTTPRouteFormProps } from './HTTPRouteForm';
export type { HTTPRouteFormModalProps } from './HTTPRouteFormModal';

export { default as GRPCRouteForm } from './GRPCRouteForm';
export { default as GRPCRouteFormModal } from './GRPCRouteFormModal';
export type { GRPCRouteFormValues, GRPCRouteFormProps } from './GRPCRouteForm';
export type { GRPCRouteFormModalProps } from './GRPCRouteFormModal';

// Pod 日志查看组件
export { default as PodLogViewer } from './PodLogViewer';
export type { PodLogViewerProps } from './PodLogViewer';

// Cron 表达式助手组件
export { default as CronExpressionHelper } from './CronExpressionHelper';

// YAML 编辑组件
export { default as YamlEditModal } from './YamlEditModal';
export type { YamlEditModalProps } from './YamlEditModal';

// Pod 终端组件
export { default as PodTerminal } from './PodTerminal';

// ConfigMap 表单组件
export { default as ConfigMapForm } from './ConfigMapForm';
export type { ConfigMapFormValues, ConfigMapFormProps } from './ConfigMapForm';

// Secret 表单组件
export { default as SecretForm } from './SecretForm';
export type { SecretFormValues, SecretFormProps } from './SecretForm';

// PDB (PodDisruptionBudget) 表单组件
export { default as PDBForm } from './PDBForm';
export type { PDBFormValues, PDBFormProps } from './PDBForm';

// 快速创建 ConfigMap 弹窗组件
export { default as QuickCreateConfigMapModal } from './QuickCreateConfigMapModal';
export type { QuickCreateConfigMapModalProps } from './QuickCreateConfigMapModal';

// 快速创建 Secret 弹窗组件
export { default as QuickCreateSecretModal } from './QuickCreateSecretModal';
export type { QuickCreateSecretModalProps } from './QuickCreateSecretModal';

// 快速创建镜像拉取凭证弹窗组件
export { default as QuickCreateRegistrySecretModal } from './QuickCreateRegistrySecretModal';
export type { QuickCreateRegistrySecretModalProps } from './QuickCreateRegistrySecretModal';

// NetworkPolicy 网络策略表单组件
export { default as NetworkPolicyForm } from './NetworkPolicyForm';
export { default as NetworkPolicyFormModal } from './NetworkPolicyFormModal';
export type { NetworkPolicyFormValues, NetworkPolicyFormProps } from './NetworkPolicyForm';

// 服务拓扑数据聚合工具
export {
  buildServiceTopology,
  buildServiceTopologyForService,
  buildNamespaceTopology,
  extractBackendServices,
  extractServiceSelector,
  matchPodsBySelector,
  getTopologyStats,
  getPodStatusStats,
} from './serviceTopologyUtils';
export type {
  TopologyNodeType,
  TopologyNode,
  TopologyEdge,
  ServiceTopology as ServiceTopologyData,
} from './serviceTopologyUtils';

// 服务拓扑可视化组件
export { ServiceTopology } from './topology';
export { IngressNode, ServiceNode, PodNode } from './topology';
export type { ServiceTopologyProps } from './topology';
