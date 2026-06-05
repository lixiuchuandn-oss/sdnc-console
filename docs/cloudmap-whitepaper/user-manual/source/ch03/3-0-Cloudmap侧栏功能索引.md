### 资源池功能索引

本表覆盖 **Cloudmap 资源池** 侧栏全部 Tab（以 `cloudmapPoolNavRows.ts` 为准）。**path** 为池内 URL 段（`…/admin/clouds/{cloudId}/` 之后）。

**手册章节** 列：按本手册第三章的资源池功能编号标注；覆盖状态见 [COVERAGE.md](../../COVERAGE.md)。

| 侧栏分组          | Tab            | path                                    | 手册章节 |
| ----------------- | -------------- | --------------------------------------- | -------- |
| **资源总览**      | 集群总览       | `resource_hub/overview`                 | 4        |
|                   | 机房拓扑       | `resource_hub/datacenter_topology`      | 4        |
|                   | 网络拓扑       | `resource_hub/network_topology`         | 4        |
| **云监控**        | 运维监控       | `monitoring_alerts/alerts-list`         | 5        |
|                   | 运维告警       | `monitoring_alerts/ops-alert-dashboard` | 5        |
|                   | 接入管理       | `monitoring_alerts/access-management`   | 5        |
| **集群·计算资源** | 计算配置       | `cluster/compute_cluster`               | 6        |
|                   | 项目管理       | `cluster/compute_projects`              | 6        |
|                   | GPU 管理       | `cluster/compute_gpu`                   | 6、7     |
| **集群·基础网络** | 交换机         | `cluster/cluster_physical_switches`     | 6        |
|                   | 物理网络       | `cluster/kubeovn_public_networks`       | 6        |
|                   | 公共子网       | `cluster/kubeovn_public_subnets`        | 6        |
|                   | VLAN           | `cluster/cluster_vlans`                 | 6        |
| **集群·平台网络** | 集群网络       | `cluster/clusterNetworks`               | 6        |
|                   | NAD 网络       | `cluster/nads`                          | 6、14    |
|                   | 负载均衡       | `cluster/load_balancers`                | 6        |
|                   | IP 地址池      | `cluster/ippools`                       | 6        |
| **集群·统一存储** | 存储概览       | `cluster/overview`                      | 6        |
|                   | 存储配置       | `cluster/harvester_addon`               | 6        |
|                   | StorageClass   | `cluster/storage_classes`               | 6        |
|                   | RBD Mirror     | `cluster/rbd_mirror`                    | 6        |
| **集群·对象存储** | S3 存储桶      | `cluster/rgw_s3_buckets`                | 6        |
|                   | 对象存储用户   | `cluster/rgw_users`                     | 6        |
|                   | 对象存储网关   | `cluster/object_gateways`               | 6        |
|                   | COSI 接口      | `cluster/cosi`                          | 6        |
| **集群·直通设备** | USB设备        | `cluster/cluster_usb`                   | 6、7     |
|                   | PCI设备        | `cluster/cluster_pci`                   | 6、7     |
|                   | 网卡           | `cluster/cluster_sriov`                 | 6、7     |
| **云主机**        | 云主机实例     | `compute/ecs`                           | 7        |
|                   | 云主机镜像     | `compute/images`                        | 7        |
|                   | 云主机模板     | `compute/templates`                     | 7        |
|                   | 回收站         | `compute/recycle_bin`                   | 7        |
|                   | SSH 密钥       | `compute/ssh_keys`                      | 7        |
|                   | CloudInit 配置 | `compute/cloud_inits`                   | 7        |
|                   | 迁移记录       | `compute/migrations`                    | 7        |
| **云数据库**      | 云 RDS         | `paas_databases/rds`                    | 8        |
| **虚拟网元**      | 虚拟路由器     | `oniaas_network/virtual_routers`        | 9        |
|                   | 负载均衡器     | `oniaas_network/slb`                    | 9        |
| **容器服务**      | 工作负载       | `containers/workloads`                  | 10       |
|                   | 容器实例       | `containers/pods`                       | 10       |
|                   | 任务           | `containers/jobs`                       | 10       |
|                   | 服务           | `containers/services`                   | 10       |
|                   | Ingress 路由   | `containers/ingresses`                  | 10       |
|                   | 网关路由       | `containers/gateway_api`                | 10       |
|                   | 服务拓扑       | `containers/service_topology`           | 10       |
|                   | Pod中断保护    | `containers/pdbs`                       | 10       |
|                   | 网络策略       | `containers/networkpolicies`            | 10       |
|                   | 配置管理       | `containers/configs`                    | 10       |
|                   | 镜像仓库       | `containers/registries`                 | 10       |
| **云存储**        | 虚拟云盘       | `storage/volumes`                       | 11       |
|                   | 云盘快照       | `storage/snapshots`                     | 11       |
| **云备份**        | 云主机备份     | `backups/backups`                       | 12       |
|                   | 云主机快照     | `backups/vm_snapshots`                  | 12       |
|                   | 定时策略       | `backups/schedule_vm_backups`           | 12       |
|                   | 恢复任务       | `backups/vm_restores`                   | 12       |
| **扁平网络**      | 扁平子网       | `flat_network/flat_public_subnets`      | 13       |
|                   | 安全组         | `flat_network/security_groups`          | 13       |
|                   | 弹性公网 IP    | `flat_network/flat_kubeovn_eips`        | 13       |
|                   | SNAT           | `flat_network/flat_kubeovn_snat`        | 13       |
|                   | DNAT           | `flat_network/flat_kubeovn_dnat`        | 13       |
| **VPC网络**       | VPC            | `kube_ovn/vpcs`                         | 14       |
|                   | 子网           | `kube_ovn/subnets`                      | 14       |
|                   | 弹性公网 IP    | `kube_ovn/kubeovn_eips`                 | 14       |
|                   | SNAT           | `kube_ovn/kubeovn_snat`                 | 14       |
|                   | DNAT           | `kube_ovn/kubeovn_dnat`                 | 14       |
| **日志管理**      | 日志采集对象   | `logs_config/logs-target`               | 15       |
|                   | 日志接收端     | `logs_config/log-outputs`               | 15       |
|                   | 日志采集配置   | `logs_config/logs-flow-config`          | 15       |

**创建向导六步**（从 **云主机实例** 进入，无独立 Tab）：见 **7. 云主机**。

**非 Cloudmap 池侧栏**（本手册不列入第三章主目录）：云桌面、MAAS 裸金属、Xinference 智算池。
