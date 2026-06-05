## 3.0 Cloudmap 侧栏功能索引

本表覆盖 **Cloudmap 资源池** 侧栏全部 Tab（与控制台现网菜单一致）。**path** 为池内 URL 路径段（完整地址形如 `…/admin/clouds/{资源池 ID}/` + path）。

**手册章节** 列指引本手册中写操作说明的节号；合订节内的小节写作 **`3-14` §3.14.2** 形式。

| 侧栏分组          | Tab            | path                                    | 手册章节      |
| ----------------- | -------------- | --------------------------------------- | ------------- |
| **资源总览**      | 集群总览       | `resource_hub/overview`                 | 3.1.1         |
|                   | 机房拓扑       | `resource_hub/datacenter_topology`      | 3.1.2         |
|                   | 网络拓扑       | `resource_hub/network_topology`         | 3.1.2         |
| **云监控**        | 运维监控       | `monitoring_alerts/alerts-list`         | 3-14 §3.14.1  |
|                   | 运维告警       | `monitoring_alerts/ops-alert-dashboard` | 3-14 §3.14.2  |
|                   | 接入管理       | `monitoring_alerts/access-management`   | 3-14 §3.14.3  |
| **集群·计算资源** | 计算配置       | `cluster/compute_cluster`               | 3.1.3         |
|                   | 项目管理       | `cluster/compute_projects`              | 3.1.4         |
|                   | GPU 管理       | `cluster/compute_gpu`                   | 3.1.5、3.2.5  |
| **集群·基础网络** | 交换机         | `cluster/cluster_physical_switches`     | 3.4.1         |
|                   | 物理网络       | `cluster/kubeovn_public_networks`       | 3.4.1、3.4    |
|                   | 公共子网       | `cluster/kubeovn_public_subnets`        | 3.4.1、3.4    |
|                   | VLAN           | `cluster/cluster_vlans`                 | 3.4.1         |
| **集群·平台网络** | 集群网络       | `cluster/clusterNetworks`               | 3.4.1、3.4.2  |
|                   | NAD 网络       | `cluster/nads`                          | 3.4.2、3.4.4  |
|                   | 负载均衡       | `cluster/load_balancers`                | 3.4.2         |
|                   | IP 地址池      | `cluster/ippools`                       | 3.4.2         |
| **集群·统一存储** | 存储概览       | `cluster/overview`                      | 3.3.1         |
|                   | 存储配置       | `cluster/harvester_addon`               | 3.3.1         |
|                   | StorageClass   | `cluster/storage_classes`               | 3.3.2         |
|                   | RBD Mirror     | `cluster/rbd_mirror`                    | 3.3.2         |
| **集群·对象存储** | S3 存储桶      | `cluster/rgw_s3_buckets`                | 3.3.6         |
|                   | 对象存储用户   | `cluster/rgw_users`                     | 3.3.6         |
|                   | 对象存储网关   | `cluster/object_gateways`               | 3.3.6         |
|                   | COSI 接口      | `cluster/cosi`                          | 3.3.6         |
| **集群·直通设备** | USB设备        | `cluster/cluster_usb`                   | 3.2.5         |
|                   | PCI设备        | `cluster/cluster_pci`                   | 3.2.5         |
|                   | 网卡           | `cluster/cluster_sriov`                 | 3.2.5、3.2.8  |
| **云主机**        | 云主机实例     | `compute/ecs`                           | 3.2.0–3.2.12  |
|                   | 云主机镜像     | `compute/images`                        | 3.2.7         |
|                   | 云主机模板     | `compute/templates`                     | 3.2.7         |
|                   | 回收站         | `compute/recycle_bin`                   | 3.2.7         |
|                   | SSH 密钥       | `compute/ssh_keys`                      | 3.2.7、3.2.10 |
|                   | CloudInit 配置 | `compute/cloud_inits`                   | 3.2.7、3.2.10 |
|                   | 迁移记录       | `compute/migrations`                    | 3.2.7、3.8    |
| **云数据库**      | 云 RDS         | `paas_databases/rds`                    | 3.10          |
| **虚拟网元**      | 虚拟路由器     | `oniaas_network/virtual_routers`        | 3.4.8         |
|                   | 负载均衡器     | `oniaas_network/slb`                    | 3.4.8         |
| **容器服务**      | 工作负载       | `containers/workloads`                  | 3.5.1         |
|                   | 容器实例       | `containers/pods`                       | 3.5.2         |
|                   | 任务           | `containers/jobs`                       | 3.5.3         |
|                   | 服务           | `containers/services`                   | 3.5.4         |
|                   | Ingress 路由   | `containers/ingresses`                  | 3.5.4         |
|                   | 网关路由       | `containers/gateway_api`                | 3.5.4         |
|                   | 服务拓扑       | `containers/service_topology`           | 3.5.4         |
|                   | Pod中断保护    | `containers/pdbs`                       | 3.5.6         |
|                   | 网络策略       | `containers/networkpolicies`            | 3.5.6         |
|                   | 配置管理       | `containers/configs`                    | 3.5.5         |
|                   | 镜像仓库       | `containers/registries`                 | 3.5.5         |
| **云存储**        | 虚拟云盘       | `storage/volumes`                       | 3.3           |
|                   | 云盘快照       | `storage/snapshots`                     | 3.3           |
| **云备份**        | 云主机备份     | `backups/backups`                       | 3.9           |
|                   | 云主机快照     | `backups/vm_snapshots`                  | 3.9           |
|                   | 定时策略       | `backups/schedule_vm_backups`           | 3.9           |
|                   | 恢复任务       | `backups/vm_restores`                   | 3.9           |
| **扁平网络**      | 扁平子网       | `flat_network/flat_public_subnets`      | 3.4.3         |
|                   | 安全组         | `flat_network/security_groups`          | 3.4.3         |
|                   | 弹性公网 IP    | `flat_network/flat_kubeovn_eips`        | 3.4.3         |
|                   | SNAT           | `flat_network/flat_kubeovn_snat`        | 3.4.3         |
|                   | DNAT           | `flat_network/flat_kubeovn_dnat`        | 3.4.3         |
| **VPC网络**       | VPC            | `kube_ovn/vpcs`                         | 3.4.4         |
|                   | 子网           | `kube_ovn/subnets`                      | 3.4.4         |
|                   | 弹性公网 IP    | `kube_ovn/kubeovn_eips`                 | 3.4.4         |
|                   | SNAT           | `kube_ovn/kubeovn_snat`                 | 3.4.4         |
|                   | DNAT           | `kube_ovn/kubeovn_dnat`                 | 3.4.4         |
| **日志管理**      | 日志采集对象   | `logs_config/logs-target`               | 3-14-1        |
|                   | 日志接收端     | `logs_config/log-outputs`               | 3-14-1        |
|                   | 日志采集配置   | `logs_config/logs-flow-config`          | 3-14-1        |

**创建向导六步**（从 **云主机实例** 进入，无独立 Tab）：3.2.1–3.2.3、3.2.8–3.2.11。

**非 Cloudmap 池侧栏**（本手册另章）：云桌面（3.6）、MAAS 裸金属（3.7）、Xinference 智算池（3.11）。
