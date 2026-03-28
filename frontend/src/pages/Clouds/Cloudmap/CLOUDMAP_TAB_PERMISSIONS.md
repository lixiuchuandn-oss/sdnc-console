# Cloudmap 资源池详情页 Tab 门控与权限原子对照

本文档描述 `CloudDetailCloudmap.tsx` 中 **Tab 展示** 与 **RBAC 权限原子** 的对应关系，便于配角色与排查「有 Tab 无数据」等问题。

> 权限校验统一走 `hasPermissionForAction`；若角色含 **`clouds:read` / `clouds:write`**，会按全局规则扩张到几乎所有 `clouds.*:read` / `:write`，下文不再逐条重复「或 clouds:read」。

---

## 1. 综合结论

1. **大部分分组 / 子 Tab** 均有 `checkPerm` / `canView*` 门控；数据加载在 `loadTabResource` / `loadResource` 中与 Tab 对齐：**VPC 列表 / Kube-OVN 子网预取**用 **`ovnVpcEnabled && canViewKubeOvnGroup`** 或 §2.1 子网预取条件，**不再整段绑在 `canReadNetworkScope` 上**；**NAD** 预取仍依赖 **`canReadNetworkScope`**。**云备份**懒加载与内层 Tab 一致：**`loadTabResource('backups')`** 在 **`clouds.backups:read`**（含 **`clouds:read` 扩张**）时拉备份与定时策略。**虚拟专有云**：进入顶层 **`kube_ovn_group`** 时仅按 **`clouds.eips.vpc` / `fips.vpc` / `snat.vpc` / `dnat.vpc` 的 `:read`** 分别拉对应列表（无原子则不请求该接口）；切换子 Tab 时仍可再次按需刷新。
2. **无 Tab 级门控**：**「资源总览」**（`overview`）**始终展示**，未按 RBAC 隐藏（若需与 `clouds.dashboard:read` 等对齐，需另加门控）。
3. **扁平子网 vs VPC（标价解耦）**：**「扁平子网」**与 **「虚拟专有云 (VPC)」**顶层分组已拆分（见 §2.1 / §3），不再共用 **`canReadNetworkScope`**；VPC 内各子 Tab 与各 `clouds.*.vpc:read` 原子一一对应（另含 **`clouds:read`** 全量兜底）。
4. **License**：**「虚拟专有云 (VPC)」** 整组依赖 **`network.ovn.vpc`**（`ovnVpcEnabled`）。
5. **标准 / 运维（`mode`）**：仅影响各 Section 内展示与交互；**Tab 显隐仅由 License + RBAC**，不因标准 / 运维切换而增减。

---

## 2. 组合变量（多处复用）

| 变量 | 含义（满足其一即可；另受 `clouds:read`/`write` 全局扩张影响） |
|------|----------------------------------------------------------------|
| **canReadNetworkScopeBase** | `clouds.vpcs:read` **或** VPC/扁平/公共子网读（含 `clouds.subnets:read`）**或** `clouds.security-groups.flat`/`vpc:read` **或** `clouds.nads:read` **或** `clouds.networks:read` |
| **canReadNetworkScope** | **canReadNetworkScopeBase** **或** `clouds.provider-networks:read` **或** `clouds.vlans:read` |
| **canReadLoadBalancers** | `clouds.load-balancers:read` **或** `clouds.loadbalancers:read` **或** `clouds.nads:read` |
| **canReadVpcSubnets** | `clouds.subnets.vpc:read` **或** `clouds.subnets:read` |
| **canReadFlatSubnets** | `clouds.subnets.flat:read` **或** `clouds.subnets:read` |
| **canReadPublicSubnets** | `clouds.subnets.public:read` **或** `clouds.subnets:read` |

### 2.1 扁平 / VPC 分组专用（与 `canReadNetworkScope` 解耦）

| 变量 | 含义 |
|------|------|
| **canViewFlatNetworkGroup** | **`clouds:read`** **或** **canReadFlatSubnets** **或** **`clouds.security-groups.flat:read`**（不含 VPC 专有读权限） |
| **canViewKubeOvnGroup** | **`clouds:read`** **或** **`clouds.vpcs:read`** **或** **canReadVpcSubnets** **或** **`clouds.security-groups.vpc:read`** **或** **`clouds.eips.vpc:read`** **或** **`clouds.fips.vpc:read`** **或** **`clouds.dnat.vpc:read`** **或** **`clouds.snat.vpc:read`** **或** **`clouds.traffic-mirroring.vpc:read`** |

> 父级 **`clouds.subnets:read`** 会同时满足 **canReadFlatSubnets** 与 **canReadVpcSubnets**，两个分组都会出现（符合「子网汇总」授权）。

**`loadEssentials` 子网预取**（与上述分组解耦、避免仅 VPC EIP 等权限时无数据）：**`clouds:read`** **或** **canReadFlatSubnets** **或** **canReadVpcSubnets** **或** **`clouds.subnets:read`** **或**（**`ovnVpcEnabled && canViewKubeOvnGroup`**）。

常量别名（与代码一致）：

- `CLOUD_PROVIDER_NETWORKS_READ` → `clouds.provider-networks:read`
- `CLOUD_CLOUDMAP_OPS_VIEW_WRITE` → `clouds.cloudmap.ops-view:write`
- 子网分域：`CLOUD_SUBNETS_VPC_READ` 等 → `clouds.subnets.vpc:read` 等

---

## 3. 顶层 Tab（主 Tabs）

| 顶层 Tab（key） | 显示条件 | 主要权限 / 逻辑 |
|-----------------|----------|-----------------|
| **资源总览** `overview` | 始终显示 | **无** RBAC Tab 门控 |
| **监控告警** `monitoring-alerts` | `canViewMonitoringTab` | 任一：`clouds.alerts` / `alert-rules` / `alert-policies` / `alert-receivers` / `alert-secrets` 的 `:read` |
| **集群** `cluster` | `canViewClusterGroup` | 任一：`cluster-nodes` / `cluster-services` / `cluster-networks` / `namespaces` / `storage-classes` / `gpus` / `usb-devices` / `pci-devices` / `nads` / **`provider-networks`** / **`vlans`** 的 `:read`，或 **`clouds:read`** |
| **云主机** `compute_group` | `canViewComputeGroup` | 任一：`ecs` / `templates` / `images` / `sshkeys` / `cloudinits` / `recycle-bin` / `migrations` 的 `:read`，或 **`clouds:read`** |
| **云存储** `storage_group` | `canViewStorageGroup` | `clouds.disks:read` **或** `clouds.snapshots:read` **或** **`clouds:read`** |
| **云备份** `backups_group` | `canViewBackupsGroup` | `clouds.backups:read` **或** `clouds.restore-tasks:read` **或** **`clouds:read`** |
| **扁平子网** `flat_network_group` | `canViewFlatNetworkGroup` | 见 §2.1（扁平子网 / 扁平安全组 / 全量） |
| **虚拟专有云 (VPC)** `kube_ovn_group` | `ovnVpcEnabled && canViewKubeOvnGroup` | License **`network.ovn.vpc`** **且** 见 §2.1（VPC 侧网络原子 / 全量） |
| **日志管理** `logs-config` | `canViewLoggingTab` | 任一：`clouds.log-targets` / `log-receivers` / `log-configs` 的 `:read` |

---

## 4. 嵌套 Tab 与权限对照

### 4.1 监控告警（内层）

| 子 Tab | 显示条件 |
|--------|----------|
| 告警列表 | `clouds.alerts:read` |
| 告警规则 | `clouds.alert-rules:read` |
| 告警通知策略 | `clouds.alert-policies:read` |
| 告警通知对象 | `clouds.alert-receivers:read` |
| 告警密钥 | `clouds.alert-secrets:read` |

### 4.2 集群（内层）

| 子 Tab | 显示条件 |
|--------|----------|
| 物理节点 | `clouds.cluster-nodes:read` |
| 基础服务 | `clouds.cluster-services:read` |
| **集群网络**（整块 Tab） | `clusterNetworkSegmentOptions.length > 0`（见 §4.2.1） |
| 物理网络 | `clouds.provider-networks:read` |
| 公共子网 | **canReadPublicSubnets** |
| VLANs | `clouds.vlans:read` **或** `clouds.provider-networks:read` |
| 命名空间 | `clouds.namespaces:read` **或** **`clouds:read`** |
| 存储池 | `clouds.storage-classes:read` |
| GPU | `clouds.gpus:read` |
| USB | `clouds.usb-devices:read` |
| PCI 设备 | `clouds.pci-devices:read` |

#### 4.2.1 集群网络 · Segmented 分段可见性

| 分段（value） | 可见条件 |
|---------------|----------|
| 集群网络（ClusterNetworks 列表） | `clouds.cluster-networks:read` |
| 附加网络(NAD) | **canReadNetworkScope** |
| 负载均衡 | **canReadLoadBalancers** |
| IP 地址池 | `clouds.nads:read` |

### 4.3 云主机（内层）

| 子 Tab | 显示条件 |
|--------|----------|
| 云主机实例 | `clouds.ecs:read` |
| 模板 | `clouds.templates:read` |
| 镜像 | `clouds.images:read` |
| SSH 密钥 | `clouds.sshkeys:read` |
| Cloud Init | `clouds.cloudinits:read` |
| 回收站 | `clouds.recycle-bin:read` **或** `clouds.ecs:read` |
| 迁移记录 | `clouds.migrations:read` **或** `clouds.ecs:read` |

### 4.4 云存储（内层）

| 子 Tab | 显示条件 |
|--------|----------|
| 虚拟云盘 | `clouds.disks:read` |
| 云盘快照 | `clouds.snapshots:read` |

### 4.5 云备份（内层）

| 子 Tab | 显示条件 |
|--------|----------|
| 云主机备份 / 云主机快照 / 定时策略 | `clouds.backups:read` **或** **`clouds:read`** |
| 恢复任务 | `clouds.restore-tasks:read` **或** `clouds.backups:read` **或** **`clouds:read`** |

**懒加载**：`loadTabResource('backups')` 与上表前三项一致，使用 **`checkPerm('clouds.backups:read')`**（已含 **`clouds:read` 扩张**），**不**再依赖单独的 **`clouds.ecs:read`**。

### 4.6 扁平子网（内层）

| 子 Tab | 显示条件 |
|--------|----------|
| 扁平子网 | **canReadFlatSubnets** |
| 安全组（Kube-OVN 扁平） | **`clouds.security-groups.flat:read`** **或** **`clouds:read`**（不含仅 VPC 安全组原子） |

### 4.7 虚拟专有云 VPC（内层）

| 子 Tab | 显示条件 |
|--------|----------|
| VPC 网络 | **`clouds.vpcs:read`** **或** **canReadVpcSubnets** **或** **`clouds:read`** |
| VPC 子网 | **canReadVpcSubnets** **或** **`clouds:read`** |
| 弹性公网 IP | **`clouds.eips.vpc:read`** **或** **`clouds:read`** |
| 浮动 IP | **`clouds.fips.vpc:read`** **或** **`clouds:read`** |
| SNAT 网关 | **`clouds.snat.vpc:read`** **或** **`clouds:read`** |
| DNAT 网关 | **`clouds.dnat.vpc:read`** **或** **`clouds:read`** |

**懒加载**：切换到顶层 **`kube_ovn_group`** 时，仅对当前用户**已有读权限**的 EIP / FIP / SNAT / DNAT 发对应列表请求；VPC 与 Kube-OVN 子网仍以 **`loadEssentials`** 预取为主。子 Tab 切换时仍调用各自的 `loadTabResource` / 刷新。

### 4.8 日志管理（内层）

| 子 Tab | 显示条件 |
|--------|----------|
| 日志采集对象 | `clouds.log-targets:read` |
| 日志接收端 | `clouds.log-receivers:read` |
| 日志采集配置 | `clouds.log-configs:read` |

---

## 5. 标准 / 运维切换（仅 UI 模式，不裁剪 Tab）

- 是否显示 **标准 | 运维** Segmented：**`clouds.cloudmap.ops-view:write`**（`CLOUD_CLOUDMAP_OPS_VIEW_WRITE`）；无该权限时固定为「标准」模式且隐藏切换控件。
- **`mode` 不改变 Tab 显隐**；各 Tab 仍仅由 §3、§4 的 License + RBAC 决定。切换模式时仍会回到 **资源总览**（产品行为，与权限无关）。

---

## 6. 已知可改进点（可选）

1. **资源总览**：可增加与 **`clouds.dashboard:read`** 或独立原子一致的门控。

---

## 7. 维护说明

- 实现文件：`frontend/src/pages/Clouds/Cloudmap/CloudDetailCloudmap.tsx`
- 修改 Tab 门控后请同步更新本文档。
