# Harvester · kube-ovn 业务域

> 源码根：`frontend/src/pages/cnmc/clouds/Harvester/kube-ovn/`  
> Cloudmap 入口分散在 **`kube_ovn/`**（VPC 网络）、**`flat_network/`**（扁平网络）、**`cluster/`** 导航下的物理网络 / VLAN / 公共子网（域优先，路径归 cluster）。

## 目录角色

| 目录 | 职责 |
|------|------|
| `sections/` | VPC、子网、EIP/SNAT/DNAT/FIP、物理网络、VLAN、Underlay 子网等列表 |
| `drawers/` / `modals/` | 详情、创建、ACL、VLAN 规划等 |
| `lib/` | 常量、校验、展示 helper；`kubeOvnSectionRefresh.ts` re-export shared 刷新 helper |

## 列表刷新约定（Cloudmap 池样板域）

| 层 | 落点 |
|----|------|
| 池 · VPC Tab | `loaders/kubeOvnRefresh.ts` → **`createKubeOvnTabOnRefresh`** → `loadTabResource` → `kubeOvnPathLoads` |
| 池 · 扁平 Tab | 同上 → `flatNetworkPathLoads`（含 `flat_public_subnets`） |
| 池 · cluster 导航内 | `clusterRefresh` · `kubeovn_public_networks` / `cluster_vlans` / `kubeovn_public_subnets` |
| `VlansSection` / `VpcsSection` / `SecurityGroupsSection` / `UnderlaySubnetsSection` | **`runHarvesterSectionRefresh` / `createHarvesterToolbarRefresh`**（`lib/kubeOvnSectionRefresh.ts`） |

### `loadTabResource` key（VPC / 扁平侧栏）

| 侧栏 / 导航 | key |
|-------------|-----|
| VPC 列表 | `vpcs`（可选 `refreshVpcsAllScope` 拉 `all=true`） |
| VPC 子网 | `subnets` |
| VPC EIP / SNAT / DNAT | `kubeovn_eips` / `kubeovn_snat` / `kubeovn_dnat` |
| 扁平 EIP / SNAT / DNAT | `flat_kubeovn_eips` / `flat_kubeovn_snat` / `flat_kubeovn_dnat` |
| 扁平公共子网 | `flat_public_subnets`（池拉 underlay 子网；Section 内仍有 VLAN/Provider 等辅助请求） |

### cluster 导航挂载（`panels/cluster`）

| `innerActiveKey` | Section | `onRefresh` |
|------------------|---------|-------------|
| `kubeovn_public_networks` | `ProviderNetworksSection` | `clusterTabOnRefresh.kubeovn_public_networks` |
| `cluster_vlans` | `VlansSection` | `clusterTabOnRefresh.cluster_vlans` |
| `kubeovn_public_subnets` | `UnderlaySubnetsSection` | 写成功后 `clusterTabOnRefresh.kubeovn_public_subnets`；列表主体仍 Section 自拉（复杂表单/拓扑） |

## 有意例外

- **`UnderlaySubnetsSection`**（公共/扁平子网）：创建编辑流程含多路 K8s/ECS 校验，首屏与弹窗内仍 **Section 自拉**；池层在写成功后经 `onSubnetsChanged` / `flat_public_subnets` 同步池状态。
- **`SecurityGroupsSection`**：独立拉取列表；工具栏/写成功已接 shared refresh，待后续纳入池 path load。
- **非 Cloudmap 入口**：`ProviderNetworksSection` 无 `onParentRefresh` 时保留 `fetchData` 自拉（兼容其它入口）。

细则亦见 **`Cloudmap/pool/README.md`** · Kube-OVN 章节。
