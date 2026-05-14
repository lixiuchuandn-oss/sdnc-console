/**
 * Cloudmap 资源池：与 SDN 一致，路由表为唯一数据源。
 * 集群子页与 `layouts/admin/cloudmap/cloudPoolSidebar` 中 `CLOUDMAP_CLUSTER_INNER_MENU` 应保持一致（pathSeg / 标题）。
 */
export type CloudmapPoolNavRow = {
  id: string;
  pathSuffix: string;
  title: string;
  order: number;
  icon: string;
  poolNavGroup: string;
  poolMenuParentKey: string;
  requiredFeature?: string;
  /** 池内页 `requiredActions.page`；缺省为 `clouds.console:read`（见 RouteSpec.toCloudmapPoolRouteSpec） */
  poolPageAction?: string;
  /** 并入管理端默认首页顺位（后端 `resolveAdminDefaultHome` / RouteSpec `homePagePriority`） */
  homePagePriority?: number;
  homePageCandidate?: boolean;
  homePageReplaceParamFrom?: 'favoriteCloudId';
  homePageAllowedRoles?: string[];
  homePageOnlyWithoutFeature?: string;
  /** `RouteSpec.group`；缺省为「Cloudmap资源池」（见 `RouteSpec.toCloudmapPoolRouteSpec`） */
  routeSpecGroup?: string;
};

const RH = 'cloudmap_menu_resource_hub';
const MON = 'cloudmap_menu_monitoring_alerts';
const CLUSTER = 'cloudmap_menu_cluster';
const COMPUTE = 'cloudmap_menu_compute';
const PAAS = 'cloudmap_menu_paas_databases';
const ONIAAS = 'cloudmap_menu_oniaas_network';
const CONT = 'cloudmap_menu_containers';
const STOR = 'cloudmap_menu_storage';
const BAK = 'cloudmap_menu_backups';
const FLAT = 'cloudmap_menu_flat_network';
const KUBE = 'cloudmap_menu_kube_ovn';
const OBJ = 'cloudmap_menu_object_storage';
const LOGS = 'cloudmap_menu_logs_config';

/** 并入 `routeSpecs` 的唯一表 */
export const CLOUDMAP_POOL_NAV_ROWS: readonly CloudmapPoolNavRow[] = [
  {
    id: 'cloudmap-pool-rh-overview',
    pathSuffix: 'resource_hub/overview',
    title: '总览',
    order: 10,
    icon: 'DashboardOutlined',
    poolNavGroup: '资源总览',
    poolMenuParentKey: RH,
    homePagePriority: -1,
    homePageCandidate: true,
    homePageReplaceParamFrom: 'favoriteCloudId',
    homePageAllowedRoles: ['super_admin', 'admin'],
  },
  { id: 'cloudmap-pool-rh-datacenter', pathSuffix: 'resource_hub/datacenter_topology', title: '机房拓扑', order: 11, icon: 'DashboardOutlined', poolNavGroup: '资源总览', poolMenuParentKey: RH },
  { id: 'cloudmap-pool-rh-network-topo', pathSuffix: 'resource_hub/network_topology', title: '网络拓扑', order: 12, icon: 'DashboardOutlined', poolNavGroup: '资源总览', poolMenuParentKey: RH },
  {
    id: 'cloudmap-pool-rh-ceph-overview',
    pathSuffix: 'resource_hub/ceph_storage_overview',
    title: '存储仪表板',
    order: 13,
    icon: 'DatabaseOutlined',
    poolNavGroup: '资源总览',
    poolMenuParentKey: RH,
    routeSpecGroup: '资源总览',
  },
  { id: 'cloudmap-pool-mon-alerts', pathSuffix: 'monitoring_alerts/alerts-list', title: '告警列表', order: 20, icon: 'AlertOutlined', poolNavGroup: '监控告警', poolMenuParentKey: MON },
  { id: 'cloudmap-pool-mon-rules', pathSuffix: 'monitoring_alerts/alert-rules', title: '告警规则', order: 21, icon: 'AlertOutlined', poolNavGroup: '监控告警', poolMenuParentKey: MON },
  { id: 'cloudmap-pool-mon-policy', pathSuffix: 'monitoring_alerts/notification-policy', title: '告警通知策略', order: 22, icon: 'AlertOutlined', poolNavGroup: '监控告警', poolMenuParentKey: MON },
  { id: 'cloudmap-pool-mon-targets', pathSuffix: 'monitoring_alerts/notification-targets', title: '告警通知对象', order: 23, icon: 'AlertOutlined', poolNavGroup: '监控告警', poolMenuParentKey: MON },
  { id: 'cloudmap-pool-mon-secrets', pathSuffix: 'monitoring_alerts/alert-secrets', title: '告警密钥', order: 24, icon: 'AlertOutlined', poolNavGroup: '监控告警', poolMenuParentKey: MON },
  { id: 'cloudmap-pool-cluster-cluster_nodes', pathSuffix: 'cluster/cluster_nodes', title: '物理节点', order: 25, icon: 'ClusterOutlined', poolNavGroup: '集群', poolMenuParentKey: CLUSTER },
  { id: 'cloudmap-pool-cluster-cluster_physical_switches', pathSuffix: 'cluster/cluster_physical_switches', title: '物理交换机', order: 26, icon: 'ClusterOutlined', poolNavGroup: '集群', poolMenuParentKey: CLUSTER },
  { id: 'cloudmap-pool-cluster-kubeovn_public_networks', pathSuffix: 'cluster/kubeovn_public_networks', title: '物理网络', order: 27, icon: 'ClusterOutlined', poolNavGroup: '集群', poolMenuParentKey: CLUSTER },
  { id: 'cloudmap-pool-cluster-namespaces', pathSuffix: 'cluster/namespaces', title: '命名空间', order: 28, icon: 'ClusterOutlined', poolNavGroup: '集群', poolMenuParentKey: CLUSTER },
  { id: 'cloudmap-pool-cluster-kubeovn_public_subnets', pathSuffix: 'cluster/kubeovn_public_subnets', title: '公共子网', order: 29, icon: 'ClusterOutlined', poolNavGroup: '集群', poolMenuParentKey: CLUSTER },
  { id: 'cloudmap-pool-cluster-cluster_vlans', pathSuffix: 'cluster/cluster_vlans', title: 'VLANs', order: 30, icon: 'ClusterOutlined', poolNavGroup: '集群', poolMenuParentKey: CLUSTER },
  { id: 'cloudmap-pool-cluster-gpu', pathSuffix: 'cluster/gpu', title: 'GPU', order: 31, icon: 'ClusterOutlined', poolNavGroup: '集群', poolMenuParentKey: CLUSTER },
  { id: 'cloudmap-pool-cluster-cluster_usb', pathSuffix: 'cluster/cluster_usb', title: 'USB 设备', order: 32, icon: 'ClusterOutlined', poolNavGroup: '集群', poolMenuParentKey: CLUSTER },
  { id: 'cloudmap-pool-cluster-clusterNetworks', pathSuffix: 'cluster/clusterNetworks', title: '集群网络', order: 33, icon: 'ClusterOutlined', poolNavGroup: '集群', poolMenuParentKey: CLUSTER },
  { id: 'cloudmap-pool-cluster-cluster_services', pathSuffix: 'cluster/cluster_services', title: '基础服务', order: 34, icon: 'ClusterOutlined', poolNavGroup: '集群', poolMenuParentKey: CLUSTER },
  { id: 'cloudmap-pool-cluster-storage_classes', pathSuffix: 'cluster/storage_classes', title: '存储类', order: 35, icon: 'ClusterOutlined', poolNavGroup: '集群', poolMenuParentKey: CLUSTER },
  { id: 'cloudmap-pool-cluster-nads', pathSuffix: 'cluster/nads', title: '附加网络(NAD)', order: 36, icon: 'ClusterOutlined', poolNavGroup: '集群', poolMenuParentKey: CLUSTER },
  { id: 'cloudmap-pool-cluster-load_balancers', pathSuffix: 'cluster/load_balancers', title: '负载均衡', order: 37, icon: 'ClusterOutlined', poolNavGroup: '集群', poolMenuParentKey: CLUSTER },
  { id: 'cloudmap-pool-cluster-ippools', pathSuffix: 'cluster/ippools', title: 'IP地址池', order: 38, icon: 'ClusterOutlined', poolNavGroup: '集群', poolMenuParentKey: CLUSTER },
  { id: 'cloudmap-pool-cluster-cluster_pci', pathSuffix: 'cluster/cluster_pci', title: 'PCI 设备', order: 39, icon: 'ClusterOutlined', poolNavGroup: '集群', poolMenuParentKey: CLUSTER },
  { id: 'cloudmap-pool-compute-ecs', pathSuffix: 'compute/ecs', title: '云主机实例', order: 40, icon: 'DesktopOutlined', poolNavGroup: '云主机', poolMenuParentKey: COMPUTE },
  { id: 'cloudmap-pool-compute-images', pathSuffix: 'compute/images', title: '云主机镜像', order: 41, icon: 'DesktopOutlined', poolNavGroup: '云主机', poolMenuParentKey: COMPUTE },
  { id: 'cloudmap-pool-compute-templates', pathSuffix: 'compute/templates', title: '云主机模板', order: 42, icon: 'DesktopOutlined', poolNavGroup: '云主机', poolMenuParentKey: COMPUTE },
  { id: 'cloudmap-pool-compute-ssh', pathSuffix: 'compute/ssh_keys', title: 'SSH 密钥', order: 43, icon: 'DesktopOutlined', poolNavGroup: '云主机', poolMenuParentKey: COMPUTE },
  { id: 'cloudmap-pool-compute-bin', pathSuffix: 'compute/recycle_bin', title: '回收站', order: 45, icon: 'DesktopOutlined', poolNavGroup: '云主机', poolMenuParentKey: COMPUTE },
  { id: 'cloudmap-pool-compute-mig', pathSuffix: 'compute/migrations', title: '迁移记录', order: 46, icon: 'DesktopOutlined', poolNavGroup: '云主机', poolMenuParentKey: COMPUTE },
  { id: 'cloudmap-pool-paas-rds', pathSuffix: 'paas_databases/rds', title: '云数据库', order: 50, icon: 'ConsoleSqlOutlined', poolNavGroup: '云数据库', poolMenuParentKey: PAAS },
  {
    id: 'cloudmap-pool-oniaas-vr',
    pathSuffix: 'oniaas_network/virtual_routers',
    title: '虚拟路由器',
    order: 51,
    icon: 'NodeIndexOutlined',
    poolNavGroup: '虚拟网元',
    poolMenuParentKey: ONIAAS,
  },
  {
    id: 'cloudmap-pool-oniaas-slb',
    pathSuffix: 'oniaas_network/slb',
    title: '负载均衡器',
    order: 52,
    icon: 'ApiOutlined',
    poolNavGroup: '虚拟网元',
    poolMenuParentKey: ONIAAS,
  },
  { id: 'cloudmap-pool-cntr-wl', pathSuffix: 'containers/workloads', title: '工作负载', order: 60, icon: 'DeploymentUnitOutlined', poolNavGroup: '容器', poolMenuParentKey: CONT, poolPageAction: 'clouds.containers.workloads:read' },
  { id: 'cloudmap-pool-cntr-pods', pathSuffix: 'containers/pods', title: '容器实例', order: 61, icon: 'DeploymentUnitOutlined', poolNavGroup: '容器', poolMenuParentKey: CONT, poolPageAction: 'clouds.containers.pods:read' },
  { id: 'cloudmap-pool-cntr-jobs', pathSuffix: 'containers/jobs', title: '任务', order: 62, icon: 'DeploymentUnitOutlined', poolNavGroup: '容器', poolMenuParentKey: CONT, poolPageAction: 'clouds.containers.jobs:read' },
  { id: 'cloudmap-pool-cntr-svc', pathSuffix: 'containers/services', title: '服务', order: 63, icon: 'DeploymentUnitOutlined', poolNavGroup: '容器', poolMenuParentKey: CONT, poolPageAction: 'clouds.containers.services:read' },
  { id: 'cloudmap-pool-cntr-ing', pathSuffix: 'containers/ingresses', title: 'Ingress 路由', order: 64, icon: 'DeploymentUnitOutlined', poolNavGroup: '容器', poolMenuParentKey: CONT, poolPageAction: 'clouds.containers.ingresses:read' },
  { id: 'cloudmap-pool-cntr-gw', pathSuffix: 'containers/gateway_api', title: '网关路由', order: 65, icon: 'DeploymentUnitOutlined', poolNavGroup: '容器', poolMenuParentKey: CONT, poolPageAction: 'clouds.containers.gateway:read' },
  { id: 'cloudmap-pool-cntr-topo', pathSuffix: 'containers/service_topology', title: '服务拓扑', order: 66, icon: 'DeploymentUnitOutlined', poolNavGroup: '容器', poolMenuParentKey: CONT, poolPageAction: 'clouds.containers.services:read' },
  { id: 'cloudmap-pool-cntr-pdb', pathSuffix: 'containers/pdbs', title: 'Pod中断保护', order: 67, icon: 'DeploymentUnitOutlined', poolNavGroup: '容器', poolMenuParentKey: CONT, poolPageAction: 'clouds.containers.pdbs:read' },
  { id: 'cloudmap-pool-cntr-np', pathSuffix: 'containers/networkpolicies', title: '网络策略', order: 68, icon: 'DeploymentUnitOutlined', poolNavGroup: '容器', poolMenuParentKey: CONT, poolPageAction: 'clouds.containers.networkpolicies:read' },
  { id: 'cloudmap-pool-cntr-cfg', pathSuffix: 'containers/configs', title: '配置管理', order: 69, icon: 'DeploymentUnitOutlined', poolNavGroup: '容器', poolMenuParentKey: CONT, poolPageAction: 'clouds.containers.configs:read' },
  { id: 'cloudmap-pool-cntr-reg', pathSuffix: 'containers/registries', title: '镜像仓库', order: 70, icon: 'DeploymentUnitOutlined', poolNavGroup: '容器', poolMenuParentKey: CONT, poolPageAction: 'clouds.containers.registries:read' },
  { id: 'cloudmap-pool-stor-pools', pathSuffix: 'storage/storage_pools', title: '存储池', order: 80, icon: 'DatabaseOutlined', poolNavGroup: '云存储', poolMenuParentKey: STOR },
  { id: 'cloudmap-pool-stor-sc', pathSuffix: 'storage/storage_classes', title: '存储类', order: 81, icon: 'DatabaseOutlined', poolNavGroup: '云存储', poolMenuParentKey: STOR },
  { id: 'cloudmap-pool-stor-vol', pathSuffix: 'storage/volumes', title: '虚拟云盘', order: 82, icon: 'DatabaseOutlined', poolNavGroup: '云存储', poolMenuParentKey: STOR },
  { id: 'cloudmap-pool-stor-snap', pathSuffix: 'storage/snapshots', title: '云盘快照', order: 83, icon: 'DatabaseOutlined', poolNavGroup: '云存储', poolMenuParentKey: STOR },
  {
    id: 'cloudmap-pool-stor-rbd-mirror',
    pathSuffix: 'storage/rbd_mirror',
    title: 'RBD 镜像',
    order: 84,
    icon: 'DatabaseOutlined',
    poolNavGroup: '云存储',
    poolMenuParentKey: STOR,
  },
  {
    id: 'cloudmap-pool-obj-gateways',
    pathSuffix: 'object_storage/object_gateways',
    title: '对象网关',
    order: 87,
    icon: 'GatewayOutlined',
    poolNavGroup: '对象存储',
    poolMenuParentKey: OBJ,
    routeSpecGroup: '对象存储',
  },
  {
    id: 'cloudmap-pool-obj-storage-pools',
    pathSuffix: 'object_storage/storage_pools',
    title: '存储池',
    order: 88,
    icon: 'DatabaseOutlined',
    poolNavGroup: '对象存储',
    poolMenuParentKey: OBJ,
    routeSpecGroup: '对象存储',
  },
  {
    id: 'cloudmap-pool-obj-cosi',
    pathSuffix: 'object_storage/cosi',
    title: 'COSI 驱动',
    order: 89,
    icon: 'ApiOutlined',
    poolNavGroup: '对象存储',
    poolMenuParentKey: OBJ,
    routeSpecGroup: '对象存储',
  },
  { id: 'cloudmap-pool-bak-backups', pathSuffix: 'backups/backups', title: '云主机备份', order: 90, icon: 'CloudDownloadOutlined', poolNavGroup: '云备份', poolMenuParentKey: BAK },
  { id: 'cloudmap-pool-bak-snaps', pathSuffix: 'backups/vm_snapshots', title: '云主机快照', order: 91, icon: 'CloudDownloadOutlined', poolNavGroup: '云备份', poolMenuParentKey: BAK },
  { id: 'cloudmap-pool-bak-sched', pathSuffix: 'backups/schedule_vm_backups', title: '定时策略', order: 92, icon: 'CloudDownloadOutlined', poolNavGroup: '云备份', poolMenuParentKey: BAK },
  { id: 'cloudmap-pool-bak-rest', pathSuffix: 'backups/vm_restores', title: '恢复任务', order: 93, icon: 'CloudDownloadOutlined', poolNavGroup: '云备份', poolMenuParentKey: BAK },
  { id: 'cloudmap-pool-flat-pub', pathSuffix: 'flat_network/flat_public_subnets', title: '扁平子网', order: 100, icon: 'ApartmentOutlined', poolNavGroup: '扁平网络', poolMenuParentKey: FLAT },
  { id: 'cloudmap-pool-flat-sg', pathSuffix: 'flat_network/security_groups', title: '安全组', order: 101, icon: 'ApartmentOutlined', poolNavGroup: '扁平网络', poolMenuParentKey: FLAT },
  { id: 'cloudmap-pool-flat-eip', pathSuffix: 'flat_network/flat_kubeovn_eips', title: '弹性公网 IP', order: 102, icon: 'ApartmentOutlined', poolNavGroup: '扁平网络', poolMenuParentKey: FLAT },
  { id: 'cloudmap-pool-flat-snat', pathSuffix: 'flat_network/flat_kubeovn_snat', title: 'SNAT', order: 103, icon: 'ApartmentOutlined', poolNavGroup: '扁平网络', poolMenuParentKey: FLAT },
  { id: 'cloudmap-pool-flat-dnat', pathSuffix: 'flat_network/flat_kubeovn_dnat', title: 'DNAT', order: 104, icon: 'ApartmentOutlined', poolNavGroup: '扁平网络', poolMenuParentKey: FLAT },
  { id: 'cloudmap-pool-ovn-vpc', pathSuffix: 'kube_ovn/vpcs', title: 'VPC', order: 112, icon: 'GlobalOutlined', poolNavGroup: 'VPC网络', poolMenuParentKey: KUBE, requiredFeature: 'network.ovn.vpc' },
  { id: 'cloudmap-pool-ovn-sub', pathSuffix: 'kube_ovn/subnets', title: '子网', order: 113, icon: 'GlobalOutlined', poolNavGroup: 'VPC网络', poolMenuParentKey: KUBE, requiredFeature: 'network.ovn.vpc' },
  { id: 'cloudmap-pool-ovn-eip', pathSuffix: 'kube_ovn/kubeovn_eips', title: '弹性公网 IP', order: 114, icon: 'GlobalOutlined', poolNavGroup: 'VPC网络', poolMenuParentKey: KUBE, requiredFeature: 'network.ovn.vpc' },
  /** VPC 下浮动 IP 入口已隐藏（产品配置）；扁平网络仍保留 flat_kubeovn_fips */
  { id: 'cloudmap-pool-ovn-snat', pathSuffix: 'kube_ovn/kubeovn_snat', title: 'SNAT', order: 115, icon: 'GlobalOutlined', poolNavGroup: 'VPC网络', poolMenuParentKey: KUBE, requiredFeature: 'network.ovn.vpc' },
  { id: 'cloudmap-pool-ovn-dnat', pathSuffix: 'kube_ovn/kubeovn_dnat', title: 'DNAT', order: 116, icon: 'GlobalOutlined', poolNavGroup: 'VPC网络', poolMenuParentKey: KUBE, requiredFeature: 'network.ovn.vpc' },
  { id: 'cloudmap-pool-logs-target', pathSuffix: 'logs_config/logs-target', title: '日志采集对象', order: 120, icon: 'FileTextOutlined', poolNavGroup: '日志管理', poolMenuParentKey: LOGS },
  { id: 'cloudmap-pool-logs-out', pathSuffix: 'logs_config/log-outputs', title: '日志接收端', order: 121, icon: 'FileTextOutlined', poolNavGroup: '日志管理', poolMenuParentKey: LOGS },
  { id: 'cloudmap-pool-logs-flow', pathSuffix: 'logs_config/logs-flow-config', title: '日志采集配置', order: 122, icon: 'FileTextOutlined', poolNavGroup: '日志管理', poolMenuParentKey: LOGS },
];
