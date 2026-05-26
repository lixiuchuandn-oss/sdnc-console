# Cloudmap 资源池 · 池层数据与刷新

> 源码根：`frontend/src/pages/cnmc/clouds/Cloudmap/pool/`  
> 对外导航与 RBAC 见 **`deployment/docs/specs/cloudmap-pool-page-rbac.md`**；全站刷新原则摘要见 **`AGENTS.md` · 数据展示与刷新**。

## 池层职责

| 目录 / 文件 | 职责 |
|-------------|------|
| `hooks/useCloudmapPoolDetailEngine.ts` | 池引擎；**`loadTabResource(key, force, skipSync)`** 为各 Tab 拉数统一入口 |
| `loaders/runPathResourceLoad.ts` | 按 `innerActiveKey` 分发到各 `pathResource/*PathLoads.ts` |
| `loaders/*Refresh.ts` | 各业务域 **`create*TabOnRefresh`** → 注入 Section 的 `onRefresh` |
| `panels/<域>/index.tsx` | 装配 Section + 注入 `*TabOnRefresh.*` |

**禁止**：在 `panels/*` 内联 `loadResource` / 平行 `refreshXxx`；新增 Tab 优先对齐下文样板域。

## 刷新两层模型（样板域通用）

| 层 | 约定 |
|----|------|
| **池层** | `create*TabOnRefresh(tab, { loadTabResource, … })` → `void loadTabResource(innerKey, force, skipSync)` |
| **Section 层** | 工具栏 **`createHarvesterToolbarRefresh(onRefresh)`**；写成功/删改 **`runHarvesterSectionRefresh(onRefresh, { force: true [, silent: true] })`**（`Harvester/shared/lib/harvesterSectionRefresh.ts`） |

样板域：**`ecs`（compute）**、**`cluster`**、**`ebs`（storage 池）**、**`paas_databases`（云数据库 / RDS）**、**`hsm`（resource_hub · 机房/网络拓扑）**。其它域新增 Tab 时**优先对齐本模式**。

---

## 虚拟机（compute / `ecs`）

Harvester **弹性计算**在 Cloudmap 资源池内装配（`panels/compute` + `Harvester/ecs/`）。刷新分 **两层**，新增 Tab 或改刷新逻辑时须按层落位，**禁止**在 Section 内再写一套 `fetch` + `setState` 拉列表（迁移记录等已收口为例）。

### 语义（产品）

| 视图类型 | 刷新应对齐的数据源 | 是否算「反映集群」 |
|----------|-------------------|-------------------|
| 云主机、回收站 VM、镜像、模板、SSH、CloudInit、迁移记录 | 集群（`force=true` 时后端 **sync** 或 **直拉 Steve/KubeVirt**） | **是**（sync 通常在数秒内完成即视为已对齐；集群自身最终一致晚几秒属正常） |
| 回收站 **关机记录**子表（`RecycleBinRecordsSection`） | **Tower 平台任务库**（`GET /api/system/recycle-bin/shutdown-records`） | **不适用**（平台审计/任务流水，**不是**集群 VM 列表；勿与上表混谈） |

### 第 1 层 — 池层

| 职责 | 文件 |
|------|------|
| 各 compute 子 Tab 的 `onRefresh` 映射 | `loaders/computeRefresh.ts` → **`createComputeTabOnRefresh(tab, deps)`** |
| 按 `innerKey` 拉数 | `loaders/pathResource/computePathLoads.ts` |
| 云主机列表 sync + GET | `loaders/pathResource/computeEcsListLoad.ts` |
| 迁移记录列表 fetch | `loaders/pathResource/computeMigrationsLoad.ts` |
| 池引擎入口 | `hooks/useCloudmapPoolDetailEngine.ts` 的 **`loadTabResource`**；**`refreshVms` ≡ `loadTabResource('ecs', force, skipSync)`** |
| 装配与注入 `onRefresh` | `panels/compute/index.tsx` → **`computeTabOnRefresh.*`** |

### compute 子 Tab 与 `loadTabResource` key

| `innerActiveKey` | `loadTabResource` key | 说明 |
|------------------|----------------------|------|
| `ecs` | `ecs` | 先可选 `POST /api/clouds/:id/sync`，再 `GET .../resources/ecs`；强制刷新时可顺带拉镜像/卷/命名空间（`refreshVmSectionAuxiliaries`） |
| `recycle_bin`（VM 列表） | `ecs` | 与云主机同一份 `ecs`，前端按回收站标记过滤 |
| `images` / `templates` / `ssh_keys` / `cloud_inits` | 同名 key | `force=true` 时后端 inventory **sync 后读库** |
| `migrations` | `migrations` | `force=true` 时 sync；列表空时 loader 可回退 `migrations-direct` 直拉集群 |

### 第 2 层 — Section 层

| 场景 | 用法 |
|------|------|
| 工具栏「刷新」 | **`createHarvesterToolbarRefresh(onRefresh)`** |
| 写成功 / 删改 / 弹窗 `onSuccess` | **`runHarvesterSectionRefresh(onRefresh, { force: true })`**；静默加 **`silent: true`**。**禁止**裸 `onRefresh(true)` |
| 需等待刷新结束 | `await runHarvesterSectionRefresh(...)` |

### 数据与实时推送

- 云主机列表：**`useCloudmapPoolEcs`** 负责 **SSE**（`/api/clouds/:id/resources/ecs/stream`）与 vm 状态缓冲；与工具栏刷新并存。
- 详情抽屉内改 VM 后刷新列表：经注入的 **`onRefresh`** 走 Section → 池层。

### 新增 / 修改检查清单

1. 列表数据是否进入池状态并由 `computePathLoads` 拉取？（Tower 自有记录如关机记录除外。）
2. `panels/compute` 是否配置 **`computeTabOnRefresh.<tab>`**？
3. Section 是否仅用 **`createHarvesterToolbarRefresh` / `runHarvesterSectionRefresh`**？
4. `force` 路径是否 **`skipCache: true`**（或等价无缓存读）？

细则亦见 **`Harvester/ecs/README.md`**。

---

## 集群（cluster · 导航聚合体）

Cloudmap 侧栏「**集群**」是**产品导航与池层的聚合体**：URL 前缀 `cluster/...`，统一由 **`panels/cluster`** + **`clusterRefresh`** 装配与刷新；**不等于**单一源码目录 `Harvester/cluster/`。节点、命名空间、直通设备在本目录；**NAD、Kube-OVN 物理网络、Ceph 存储池**等子页路径也归 cluster 导航，实现仍在 **`Harvester/nad/`**、**`kube-ovn/`**、**`ceph/`**（域优先）。聚合地图与 Section 收口状态见 **`Harvester/cluster/README.md`**。

**禁止**在引擎为单 Tab 再维护独立 `refreshNodes` / `refreshNads` 等。

### 第 1 层 — 池层

| 职责 | 文件 |
|------|------|
| 各 cluster 子 Tab 的 `onRefresh` 映射 | `loaders/clusterRefresh.ts` → **`createClusterTabOnRefresh(tab, deps)`** |
| 按 `innerKey` 拉数 | `loaders/pathResource/clusterPathLoads.ts` |
| 池引擎入口 | **`loadTabResource`** |
| 装配 | `panels/cluster/index.tsx` → **`clusterTabOnRefresh.*`** |

### cluster 子 Tab 与 `loadTabResource` key

| 实现域 | `innerActiveKey` | `loadTabResource` key | 说明 |
|--------|------------------|----------------------|------|
| **cluster** | `cluster_nodes` | `cluster_nodes` | sync 后读库；工具栏另触发 **`useNodesResourceBundle`** |
| **cluster** | `namespaces` | `namespaces` | 写删用 **`reloadHarvesterNamespacesList`** |
| **cluster** | `gpu` / `cluster_usb` / `cluster_pci` / `cluster_sriov` / `clusterNetworks` / `storage_classes` | 同名 key | `force=true` 时 inventory **sync 后读库** |
| **nad** | `nads` / `load_balancers` / `ippools` | 同名 key | 路径归 cluster 导航；Section 在 **`Harvester/nad/`** |
| **kube-ovn** | `cluster_vlans` | `cluster_vlans` | 可同时刷新 VLAN + ProviderNetwork |
| **kube-ovn** | `kubeovn_public_networks` | `kubeovn_public_networks` | Provider 网络 Tab |

**有意不走路径 `onRefresh` 的例外**：**物理交换机**（Section 内 `loadAll`）、**Ceph `storage_pools`**、**Underlay 子网**（`kubeovn_public_subnets` 自拉）。

### 第 2 层 — Section 层

- **本域**（`Harvester/cluster/sections/`）：与 compute 相同；`cluster/lib/clusterSectionRefresh.ts` 仅 re-export shared。
- **聚合子域**（nad / kube-ovn / ceph）：池 `onRefresh` 已注入，Section 内仍须 **`createHarvesterToolbarRefresh` / `runHarvesterSectionRefresh`**；待收口清单见 **`Harvester/cluster/README.md`**。

细则亦见 **`Harvester/cluster/README.md`**。

---

## 块存储（storage / `ebs`）

Harvester **块存储**在 Cloudmap 资源池内装配（`panels/storage` + `Harvester/ebs/`）。**禁止**在 `panels/storage` 内联 `loadResource` 拉卷/VM 列表。

### 第 1 层 — 池层

| 职责 | 文件 |
|------|------|
| 各 storage 子 Tab 的 `onRefresh` 映射 | `loaders/storageRefresh.ts` → **`createStorageTabOnRefresh(tab, deps)`** |
| 按 `innerKey` 拉数 | `loaders/pathResource/storagePathLoads.ts` |
| 装配 | `panels/storage/index.tsx` → **`storageTabOnRefresh.volumes` / `.snapshots`**；另 **`onRefreshStorageClasses`**、**`onRefreshImages`** |

### storage 子 Tab 与 `loadTabResource` key

| `innerActiveKey` | `loadTabResource` key | 说明 |
|------------------|----------------------|------|
| `volumes` | `volumes` | 直拉 PVC；有权限时并行拉 VM；强制刷新时顺带 **`storage_classes`** |
| `snapshots` | `snapshots` | 快照列表 |
| `rbd_mirror` | — | ceph 域自管 |

### 第 2 层 — Section 层

| 场景 | 用法 |
|------|------|
| 工具栏「刷新」 | **`createHarvesterToolbarRefresh(onRefresh)`**；云盘 Tab `after` 可补拉命名空间 |
| 写成功 / 删改 | **`runHarvesterSectionRefresh(...)`** |
| PVC 中间态 / burst | **`useVolumesListPoll`**、**`useStableBurstVolumeRefresh`** 内部 silent 刷新 |

细则亦见 **`Harvester/ebs/README.md`**。

---

## 云数据库（paas_databases / `database`）

Cloudmap 侧栏 **`paas_databases/rds`** → `panels/paas_databases` + `Harvester/database/sections/PaasSection.tsx`。列表数据为池 **`ecs`**，Section 内按 PaaS 标签过滤（RDS 与云主机 Tab **同源**）。

### 第 1 层 — 池层

| 职责 | 文件 |
|------|------|
| `onRefresh` 映射 | `loaders/paasDatabasesRefresh.ts` → **`createPaasDatabasesTabOnRefresh('rds')`** |
| 拉数 | `loaders/pathResource/paasDatabasesPathLoads.ts`（**`rds` → `tryLoadComputeTab('ecs')`**） |
| 装配 | `panels/paas_databases/index.tsx` → **`paasDatabasesTabOnRefresh.rds`** |

### 第 2 层 — Section 层

| 场景 | 用法 |
|------|------|
| 工具栏「刷新」 | **`createHarvesterToolbarRefresh(onRefresh)`** |
| 写成功 / 删改 | **`runHarvesterSectionRefresh(onRefresh, { force: true })`**；**禁止**裸 `onRefresh(true)` |

细则亦见 **`Harvester/database/README.md`**。

---

## 资源总览拓扑（resource_hub / `hsm`）

Cloudmap **资源总览** 内 **机房拓扑**、**网络拓扑**（`Harvester/hsm/`）。监控大盘、Ceph 存储总览仍各自面板内拉取（`ceph_storage_overview` 在 `runPathResourceLoad` 早退）。

### 第 1 层 — 池层

| 职责 | 文件 |
|------|------|
| 各子页的 `onRefresh` | `loaders/resourceHubRefresh.ts` → **`createResourceHubTabOnRefresh`** |
| 按 key 拉数 | `loaders/pathResource/resourceHubPathLoads.ts` |
| 装配 | `panels/resource_hub/CloudmapResourceHubTopologyPanels.tsx` |

### resource_hub 子页与 `loadTabResource` key

| 侧栏 / URL | `loadTabResource` key | 说明 |
|------------|----------------------|------|
| `datacenter_topology` | `datacenter_topology` | `loadDatacenterTopologyBundle` → 池 `datacenterRacks`、节点、ASW、metrics（`force` 时 metrics 代理 `force`；ASW 同网络拓扑） |
| `network_topology` | `network_topology` | 并行刷新 VLAN/物理网络、集群网络、节点、子网、ASW（写入既有池状态；`force` 且有 `cluster-networks:write` 时 ASW 走 HSM 探测写库） |

### 第 2 层 — Section 层

| 场景 | 用法 |
|------|------|
| 工具栏「刷新」 | **`createHarvesterToolbarRefresh(onRefresh)`**（网络拓扑工具栏 `onReload`） |
| 写成功 / 机柜 CRUD | **`runHarvesterSectionRefresh(onRefresh, { force: true })`** |

细则亦见 **`Harvester/hsm/README.md`**。

---

## 审计与边界（全站检索参考）

在 `frontend/src` 内可配合检索（命中后人工判断）：

- 裸调 **`onRefresh(true)`** / **`onSuccess={onRefresh}`** 未包装 → 应改为 **`runHarvesterSectionRefresh`**
- **`onClick={onRefresh}`** 绑 Button → 会把点击事件当 `force`；用 **`createHarvesterToolbarRefresh`** 或 `() => load(true)`
- 写操作后列表 GET 仍走内存缓存 → **`skipCache: true`** 或 **`clearCache`**

**不强行全局替换的边界**：监控/日志局部 `setState`、仪表盘慢变缓存、K8s 最终一致需轮询等——按页评审。
