# Harvester · hsm（资源总览拓扑）

> 源码根：`frontend/src/pages/cnmc/clouds/Harvester/hsm/`  
> Cloudmap 入口：侧栏 **资源总览** → `resource_hub/datacenter_topology` | `resource_hub/network_topology`  
> 池装配：`Cloudmap/pool/panels/resource_hub/CloudmapResourceHubTopologyPanels.tsx`

## 目录角色

| 目录 | 职责 |
|------|------|
| `sections/` | `DatacenterTopologySection`、`NetworkTopologySection` |
| `hooks/` | `useNetworkTopologyData`（池数据派生 + 选网 UI）、`useDatacenterRackCarousel`、`useNetworkTopologyChartLayout` |
| `lib/` | 拓扑图（React Flow）、机柜网格、LLDP 链路、`loadDatacenterTopologyBundle` |
| `modals/` | 机柜 / 上架设备表单 |

## 列表刷新约定（Cloudmap 池样板域）

| 层 | 落点 |
|----|------|
| 池 · `onRefresh` | `loaders/resourceHubRefresh.ts` → **`createResourceHubTabOnRefresh`** |
| 池 · 拉数 | `loaders/pathResource/resourceHubPathLoads.ts` |
| 池 · 装配 | `panels/resource_hub/CloudmapResourceHubTopologyPanels.tsx` |
| Section | **`runHarvesterSectionRefresh` / `createHarvesterToolbarRefresh`**（`Harvester/shared/lib/harvesterSectionRefresh.ts`） |

### `loadTabResource` key

| 侧栏子页 | key | 说明 |
|----------|-----|------|
| 机房拓扑 | `datacenter_topology` | Tower 机柜 API + 节点 + ASW 交换机 + metrics |
| 网络拓扑 | `network_topology` | 并行：`cluster_vlans`、`clusterNetworks`、`cluster_nodes`、子网、ASW；复用池内 Kube-OVN / 集群网络状态 |

**禁止**在 Section 内再维护平行 `fetch` + `setState` 拉整页数据（选网、画布布局等 UI 状态除外）。

强制刷新（`force=true`）：

- **GET 前** `clearCache`：机柜、ASW、子网；节点 `fetchHarvesterNodes(cloudId, force)`；节点 metrics `fetchHarvesterResourceByLink(..., force)`。
- **ASW**：有 `clouds.cluster-networks:write` 且未 `skipSync` 时与集群物理交换机一致，走 `syncAswCtlSwitchesToInventory`；否则 `fetchAswCtlSwitchesSummary`（`loadHarvesterAswSwitchesForTopology`）。
- VLAN/集群网络等由 `tryLoadClusterTab` 既有逻辑处理。

### 跨域复用

- **cluster**：物理节点/交换机详情抽屉、`physicalSwitchRecordUtils`
- **kube-ovn**：`kubeOvnTopoPrimitives.tsx` 供子网 → VM 拓扑（`SubnetVmTopologyGraph`）样式对齐

## 列表表格

本域以拓扑/机柜可视化为主，无标准 `.std-table` 大列表；表格规范不适用处勿强行套版式 A。
