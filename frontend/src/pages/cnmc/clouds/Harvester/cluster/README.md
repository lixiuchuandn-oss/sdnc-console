# Harvester · cluster 业务域

> **读本文前先建立心智**：Cloudmap 侧栏「**集群**」是**产品导航与池层的聚合体**，不等于本目录 `Harvester/cluster/` 一个源码文件夹。  
> 节点、命名空间、直通设备等在本目录；**NAD、Kube-OVN 物理网络、Ceph 存储池**等能力挂在同一导航下，源码仍在各自域（`nad/`、`kube-ovn/`、`ceph/`）。  
> 放置规则以 **`frontend/src/STRUCTURE.md`** 与 **`deployment/docs/specs/修改纪要_Harvester前端目录结构_域优先与shared.md`** 为准。

## 两层「cluster」分别指什么

| 层级 | 含义 | 落点 |
|------|------|------|
| **产品 / 导航 cluster** | 侧栏大 Tab，URL 前缀 `cluster/...`；运维在此管理节点、网络、存储、设备等 | `routes/cloudmapPoolNavRows.ts` · `poolNavGroup: 集群` |
| **池 cluster** | 统一装配与刷新入口：`loadTabResource` + `clusterTabOnRefresh.*` | `Cloudmap/pool/panels/cluster/` · `loaders/clusterRefresh.ts` · `pathResource/clusterPathLoads.ts` |
| **源码 cluster** | 本目录；仅承载**本域自有** Section / drawer / hook | `Harvester/cluster/`（下文「本域 Section」） |

**域优先**：导航聚合、源码分域——新增 NAD 相关弹窗仍落 `Harvester/nad/`，不要搬进 `cluster/` 除非 ≥2 域复用再上浮 `shared/`。

## 侧栏分组 ↔ 实现域（聚合地图）

侧栏路径来自 **`routes/cloudmapPoolNavRows.ts`**（`pathSuffix: cluster/...`），由 **`Cloudmap/pool/panels/cluster/index.tsx`** 装配。

| 侧栏子分组（`poolNavSubgroup`） | 典型子页 | 源码域 | 池 `loadTabResource` key |
|--------------------------------|----------|--------|--------------------------|
| `cluster_compute` | 计算节点、故障域、项目管理、DRS 规则、迁移记录、GPU 管理 | **`cluster/`** | `compute_*`（见 `cluster/lib/computeResourcesNav.ts`） |
| `cluster_physical_network` | 交换机、物理网络、公共子网、VLAN | **`cluster/`** + **`kube-ovn/`** | `cluster_physical_switches`（例外自拉）、`kubeovn_public_networks`、`kubeovn_public_subnets`（自拉）、`cluster_vlans` |
| `cluster_platform_network` | 集群网络、NAD 网络、负载均衡、IP 地址池 | **`cluster/`** + **`nad/`** | `clusterNetworks`、`nads`、`load_balancers`、`ippools` |
| `cluster_storage` | 存储概览、统一存储配置、统一存储池、存储智能调度、存储策略、跨域复制 | **`ceph/`** + **`cluster/`** | `overview`、`harvester_addon`、`storage_pools`（ceph 自管）、`storage_drs`、`storage_classes`、`rbd_mirror` |
| `cluster_storage_object` | 对象桶、对象用户、对象接入、标准对象接口 | **`ceph/`** | `rgw_s3_buckets`、`rgw_users`、`object_gateways`、`cosi` |
| `cluster_device_passthrough` | USB 直通、设备直通、网卡直通 | **`cluster/`** | `cluster_usb`、`cluster_pci`、`cluster_sriov` |

## 本目录角色

| 目录 | 职责 |
|------|------|
| `sections/` | **本域自有**列表 Section（见下表「本域 Section」） |
| `drawers/` | 命名空间表单、物理节点/交换机详情等 |
| `lib/` | 过滤、列定义（`*TableColumns.tsx`）、ASW 解析；`clusterSectionRefresh.ts` 仅 re-export shared |
| `hooks/` | 节点资源 bundle、物理交换机数据等 |
| `components/` | 节点单元格、HMS 监控卡等域内 UI |

### 本域 Section（`Harvester/cluster/sections/`）

| `innerActiveKey` | Section | 文件 |
|------------------|---------|------|
| `compute_nodes` | `NodesSection` | `NodesSection.tsx` |
| `compute_failure_domains` | `FailureDomainSection` | `FailureDomainSection.tsx` |
| `compute_projects` | `NamespacesSection` | `NamespacesSection.tsx` |
| `compute_drs_rules` | `DrsRulesSection` | `DrsRulesSection.tsx` |
| `compute_migrations` | `DrsMigrationsSection` | `DrsMigrationsSection.tsx` |
| `compute_gpu` | `GpusSection` | `GpusSection.tsx` |
| `storage_drs` | `StorageDrsSection` | `StorageDrsSection.tsx` |
| `cluster_physical_switches` | `PhysicalSwitchesSection` | `PhysicalSwitchesSection.tsx` |
| `clusterNetworks` | `NetworksSection` | `NetworksSection.tsx` |
| `storage_classes` | `StorageClassesSection` | `StorageClassesSection.tsx` |
| `cluster_usb` | `UsbDevicesSection` | `UsbDevicesSection.tsx` |
| `cluster_pci` | `PciDevicesSection`（`variant="all"`） | `PciDevicesSection.tsx` |
| `cluster_sriov` | `PciDevicesSection`（`variant="sriov_vf"`） | 同上 |

### 聚合挂载 Section（路径归 cluster 导航，源码在其它域）

| `innerActiveKey` | 实际域 | 组件位置 | 域内 README |
|------------------|--------|----------|-------------|
| `kubeovn_public_networks` / `kubeovn_public_subnets` / `cluster_vlans` | `kube-ovn` | `Harvester/kube-ovn/sections/` | （待补） |
| `nads` / `load_balancers` / `ippools` | `nad` | `Harvester/nad/sections/` | **`Harvester/nad/README.md`** |
| `overview` / `harvester_addon` / `storage_pools` / `rbd_mirror` / `rgw_*` / `object_gateways` / `cosi` | `ceph` | `Harvester/ceph/sections/`（经 `panels/unified_storage`） | **`Harvester/ceph/README.md`** |

改聚合子页的列表/刷新时：**池层**改 `clusterRefresh` / `clusterPathLoads`；**Section 层**到对应实现域改 Section，勿只在 `cluster/sections/` 找文件。

## 列表刷新约定（Cloudmap 池样板域）

**两层**：池层 **`loadTabResource`** + Section 层 **`createHarvesterToolbarRefresh` / `runHarvesterSectionRefresh`**。横切细则见 **`Cloudmap/pool/README.md`** · 集群章节；摘要见 **`AGENTS.md` · 数据展示与刷新**。

| 层 | 落点 |
|----|------|
| 池 · 各子 Tab `onRefresh` | `Cloudmap/pool/loaders/clusterRefresh.ts` → **`createClusterTabOnRefresh`** |
| 池 · 拉数 | `loaders/pathResource/clusterPathLoads.ts`（经 `runPathResourceLoad`） |
| 池 · 装配 | `Cloudmap/pool/panels/cluster/index.tsx` → **`clusterTabOnRefresh.*`** |
| 本域 Section 工具栏 | **`Harvester/shared/lib/harvesterSectionRefresh.ts`**（`cluster/lib/clusterSectionRefresh.ts` 仅 re-export） |
| Section 写成功/删改 | **`runHarvesterSectionRefresh(onRefresh, { force: true [, silent: true] })`**，禁止裸 `onRefresh(true)` |

### 本域已对齐（`cluster/sections/`）

- 工具栏普遍使用 **`createClusterToolbarRefresh`**（即 shared 的 `createHarvesterToolbarRefresh`）。
- 节点：工具栏 `before` 另触发 **`useNodesResourceBundle().reload(true)`**；详情抽屉经 **`runHarvesterSectionRefresh`**。
- 命名空间写删：**`reloadHarvesterNamespacesList(cloudId, onRefresh)`**（清 GET 缓存 + silent 刷新）。
- USB 写操作：**`runHarvesterSectionRefresh`**。

### 有意例外（不走路径 `onRefresh`）

| 子页 | 原因 |
|------|------|
| **物理交换机** | Section 内 **`loadAll()`**（Tower/HMS 数据，非标准 inventory sync） |
| **Ceph `storage_pools`** | ceph 域面板/ Section 自管 |
| **`kubeovn_public_subnets`** | Underlay 子网 Section 自拉 |

### 聚合子域 · Section 层

池层 key（如 `nads`、`cluster_vlans`）已进 **`clusterTabOnRefresh`**。

**`nad/`**（`NadsSection`、`LoadBalancersSection`、`IPPoolsSection`）：Section 刷新已对齐 shared helper；列表逻辑已拆 **`lib/*SectionUtils`**、**`*TableColumns`**、**`hooks/*`**（见 **`Harvester/nad/README.md`**）。`NadsSection` 另在 Section 内拉 Subnet/VM 辅助数据。

**`ceph/`**（`CephPoolSection` 等）：池层 **`cephTabOnRefresh.storage_pools`** 已注入；列表仍 Section 自拉 Rook/Dashboard，工具栏/写成功须 **`createHarvesterToolbarRefresh` / `runHarvesterSectionRefresh`**（见 **`Harvester/ceph/README.md`**）。

**`kube-ovn/`（cluster 导航）**：`ProviderNetworksSection` / `VlansSection` 已接池 `onRefresh` 与 shared helper；**`UnderlaySubnetsSection`** 列表主体仍 Section 自拉（见 **`Harvester/kube-ovn/README.md`** 例外）

收口时：**不改导航归属、不迁目录**；在各自域内 Section 改用 shared refresh helper，父级继续注入 `clusterTabOnRefresh.*` 或 **`kubeOvnTabOnRefresh.*`**（VPC/扁平侧栏见 **`panels/kube_ovn`**）。

## 列表表格

主列表须 **`className="std-table"`**、**`scroll={{ x: true }}`**，列冻结与列展示见 **`AGENTS.md` · 列表表格（版式 A）**；本域列定义放在 **`lib/*TableColumns.tsx`**。

## 其它入口

- 控制台 GPU Tab：`console/sections/CloudConsoleMainPanel.tsx` → `GpusSection`
- HSM 拓扑等可只读复用 **`cluster/lib/parseAswCtlInterfaceStdout`**、`physicalSwitchRecordUtils`
