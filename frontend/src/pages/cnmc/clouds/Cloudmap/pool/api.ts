/**
 * Cloudmap 资源池：对外部 HTTP 客户端的聚合出口（实现仍复用平台 services）。
 * Cloudmap 内页面/handler 优先从此文件 import，便于清单化与后续换实现。
 *
 * 下列 export 按业务域分组排序（同域内大致：读列表 → 写操作）。
 *
 * 注释文案约定（与本模块 UI 用语对齐）：
 * - 虚拟机：计算实例（原 ECS/VM/云主机，注释统一称虚拟机）
 * - 虚拟卷：持久化块存储卷（含 PVC 等）
 * - 虚拟卷快照：卷的时点副本
 * - 集群：Kubernetes 集群侧资源；命名空间、节点等保留常见英文缩写时附中文
 */

// --- 资源池环境 · 通用请求（services/api）---
export {
  API_BASE_URL, // 后端根 URL（如 SSE、拼接请求等）
  apiPost, // 通用 POST（同步资源、改配等）
  fetchCloudById, // 按 ID 拉取资源池元数据
} from '../../../../../services/api';

// --- 虚拟机：列表与电源生命周期（services/api）---
export {
  deleteCloudProviderEcs, // 删除虚拟机（进回收站等）
  fetchCloudProviderEcs, // 拉取虚拟机列表
  pauseCloudProviderEcs, // 暂停虚拟机
  rebootCloudProviderEcs, // 硬重启虚拟机
  softRebootCloudProviderEcs, // 软重启虚拟机
  startCloudProviderEcs, // 启动虚拟机
  stopCloudProviderEcs, // 停止虚拟机（instanceId 可为 namespace/name）
  unpauseCloudProviderEcs, // 恢复已暂停虚拟机
} from '../../../../../services/api';

// --- 虚拟机镜像 · 模板 · SSH · Cloud-init ---
export {
  fetchHarvesterCloudInits, // Cloud-init 配置列表
  fetchHarvesterImages, // 虚拟机镜像列表
  fetchHarvesterSshKeys, // SSH 密钥列表
  fetchHarvesterTemplates, // 虚拟机模板列表
} from '../../../../../services/harvesterApi';

// --- 虚拟卷 · 虚拟卷快照 ---
export {
  fetchHarvesterSnapshots, // 虚拟卷快照列表
  fetchHarvesterVolumes, // 虚拟卷列表（含 PVC）
} from '../../../../../services/harvesterApi';

// --- 虚拟机备份 · 定时备份策略 ---
export {
  fetchHarvesterBackups, // 虚拟机备份列表
  fetchHarvesterScheduleVmBackups, // 虚拟机定时备份策略列表
} from '../../../../../services/harvesterApi';

// --- 集群 · 命名空间 · 存储类 · 能力 ---
export {
  fetchHarvesterClusterNetworks, // 集群网络（Harvester Cluster Network）
  fetchAswCtlSwitchesSummary, // 物理交换机：Tower 已入库列表（不触发集群侧实时探测）
  syncAswCtlSwitchesToInventory, // 物理交换机：探测并写库后返回列表
} from 'services/harvester/cluster';

export {
  fetchHarvesterNamespaces, // 命名空间列表
  fetchHarvesterNodes, // 物理节点列表
  fetchHarvesterStorageClasses, // 存储类（StorageClass）列表
  fetchHarvesterGpuResources, // GPU 设备列表
  fetchHarvesterPciDevices, // PCI 设备列表（透传等）
  fetchHarvesterUsbResources, // USB 设备列表
} from 'services/harvester/clusterInventory';

export {
  fetchHarvesterCapabilities, // 集群能力/特性（首屏或鉴能力）
} from 'services/harvester/vm';

// --- 网络附件 · 负载均衡 · IP 池 ---
export {
  fetchHarvesterIPPools, // IP 池列表
  fetchHarvesterLoadBalancers, // 负载均衡（LoadBalancer Service）列表
  fetchHarvesterNads, // 网络附件定义（NAD）列表
} from '../../../../../services/harvesterApi';

// --- Kube-OVN：VPC · 子网 · VLAN · 物理网络 ---
export {
  fetchKubeOvnProviderNetworks, // 物理网络（Provider Network）
  fetchKubeOvnSubnets, // 子网列表（多场景）
  fetchKubeOvnVlans, // VLAN 子网列表
  fetchKubeOvnVpcs, // VPC 列表
} from '../../../../../services/harvesterApi';

// --- 弹性公网 IP · SNAT · DNAT（OVN，VPC/扁平共用）---
export {
  fetchCloudProviderOvnDnatRules, // DNAT 规则
  fetchCloudProviderOvnEips, // 弹性公网 IP 列表
  fetchCloudProviderOvnSnatRules, // SNAT 规则
} from '../../../../../services/harvesterApi';

// --- 容器：工作负载 · Pod · 任务 ---
export {
  fetchHarvesterCronJobs, // 定时任务（CronJob）列表
  fetchHarvesterDaemonSets, // 守护进程集（DaemonSet）列表
  fetchHarvesterDeployments, // 无状态工作负载（Deployment）列表
  fetchHarvesterJobs, // 任务（Job）列表
  fetchHarvesterPods, // Pod 列表
  fetchHarvesterStatefulSets, // 有状态工作负载（StatefulSet）列表
} from '../../../../../services/harvesterApi';

// --- 服务发现 · 入口 · 配置与凭据 ---
export {
  fetchHarvesterConfigMaps, // 配置（ConfigMap）列表
  fetchHarvesterImagePullSecrets, // 镜像拉取凭据（Secret）列表
  fetchHarvesterIngresses, // 入口（Ingress）列表
  fetchHarvesterSecrets, // 凭据（Secret）列表
  fetchHarvesterServices, // 服务（Service）列表
} from '../../../../../services/harvesterApi';

// --- 中断预算 · 网络策略 ---
export {
  fetchHarvesterPDBs, // Pod 中断预算（PDB）列表
  fetchNetworkPolicies, // 网络策略（NetworkPolicy）列表
} from '../../../../../services/harvesterApi';

// --- Gateway API ---
export {
  checkGatewayApiStatus, // 是否启用 Gateway API
  fetchGatewayClasses, // GatewayClass 列表
  fetchGateways, // Gateway 列表
  fetchGrpcRoutes, // GRPCRoute 列表
  fetchHttpRoutes, // HTTPRoute 列表
} from '../../../../../services/harvesterApi';
