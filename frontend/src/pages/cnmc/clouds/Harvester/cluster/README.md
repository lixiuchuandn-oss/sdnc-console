# Harvester · cluster 业务域

> 源码根：`frontend/src/pages/cnmc/clouds/Harvester/cluster/`  
> 放置规则以 **`frontend/src/STRUCTURE.md`** 与 **`deployment/docs/specs/修改纪要_Harvester前端目录结构_域优先与shared.md`** 为准。

## 目录角色

| 目录 | 职责 |
|------|------|
| `sections/` | Cloudmap 池「集群」导航（`cluster/:poolInnerSeg`）下、**本域自有**的列表 Section |
| `drawers/` | 创建/编辑、详情侧栏（命名空间表单、物理节点/交换机、Vlan 列表等） |
| `lib/` | 纯逻辑：过滤、列定义（`*TableColumns.tsx`）、ASW 解析、刷新 helper |
| `hooks/` | 节点资源 bundle、物理交换机数据、交换机 CR 操作 |
| `components/` | 域内 UI 子件（节点单元格、HMS 监控卡、探测 Tab 等） |

## Cloudmap 池路径 ↔ Section

侧栏路径来自 **`routes/cloudmapPoolNavRows.ts`**（`pathSuffix: cluster/...`），由 **`Cloudmap/pool/panels/cluster/index.tsx`** 装配。

| `innerActiveKey`（路径末段） | Section 组件 | 源码 |
|-----------------------------|--------------|------|
| `cluster_nodes` | `NodesSection` | `sections/NodesSection.tsx` |
| `cluster_physical_switches` | `PhysicalSwitchesSection` | `sections/PhysicalSwitchesSection.tsx` |
| `namespaces` | `NamespacesSection` | `sections/NamespacesSection.tsx` |
| `clusterNetworks` | `NetworksSection` | `sections/NetworksSection.tsx` |
| `storage_classes` | `StorageClassesSection` | `sections/StorageClassesSection.tsx` |
| `gpu` | `GpusSection` | `sections/GpusSection.tsx` |
| `cluster_usb` | `UsbDevicesSection` | `sections/UsbDevicesSection.tsx` |
| `cluster_pci` | `PciDevicesSection`（`variant="all"`） | `sections/PciDevicesSection.tsx` |
| `cluster_sriov` | `PciDevicesSection`（`variant="sriov_vf"`） | 同上 |

同面板 **`cluster/index.tsx`** 还挂载 **其它业务域** Section（仅路径归在「集群」导航下）：

| `innerActiveKey` | 实际域 | 组件位置 |
|------------------|--------|----------|
| `kubeovn_public_networks` / `kubeovn_public_subnets` / `cluster_vlans` | `kube-ovn` | `Harvester/kube-ovn/sections/` |
| `nads` / `load_balancers` / `ippools` | `nad` | `Harvester/nad/sections/` |
| `storage_pools` | `ceph` | `Harvester/ceph/sections/` |

## 列表刷新约定

- 通用工具栏：**`Harvester/shared/lib/harvesterSectionRefresh.ts`** → `createHarvesterToolbarRefresh(onRefresh)`（`cluster/lib/clusterSectionRefresh.ts` 仅为 re-export）。
- **其它 Harvester 域**（如 **`ecs/`**）直接 import shared，勿再拷贝刷新逻辑（见 **`AGENTS.md` · 不要重复造轮子**）。
- 节点列表：工具栏 `before` 钩子额外调用 **`useNodesResourceBundle().reload(true)`**（metrics/pods 与列表同步）。
- 命名空间写删：**`reloadHarvesterNamespacesList(cloudId, onRefresh)`**（`clearGetCacheForPath` + `onRefresh(true, true)`）。
- 物理交换机：Section 内 **`loadAll()`** 自拉 ASW-CTL / HMS 数据，不依赖父级 `onRefresh`。

## 列表表格

主列表须 **`className="std-table"`**、**`scroll={{ x: true }}`**，列冻结与列展示见 **`AGENTS.md` · 列表表格（版式 A）**；列定义放在 **`lib/*TableColumns.tsx`**。

## 其它入口

- 控制台 GPU Tab：`console/sections/CloudConsoleMainPanel.tsx` → `GpusSection`
- HSM 拓扑等可引用 **`cluster/lib/parseAswCtlInterfaceStdout`**、`physicalSwitchRecordUtils`（跨域只读复用）
