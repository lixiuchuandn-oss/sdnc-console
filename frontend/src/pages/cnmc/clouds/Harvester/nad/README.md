# Harvester · nad（NAD / 负载均衡 / IP 地址池）

> 源码根：`frontend/src/pages/cnmc/clouds/Harvester/nad/`  
> Cloudmap 入口：侧栏 `cluster/...`（**集群 → 平台网络**）→ `Cloudmap/pool/panels/cluster/`  
> 放置规则见 **`frontend/src/STRUCTURE.md`**；聚合导航说明见 **`Harvester/cluster/README.md`**。

## 目录角色

| 目录 | 职责 |
|------|------|
| `sections/` | NAD、LoadBalancer Service、IPPool 列表（薄编排） |
| `hooks/` | Section 侧状态与操作（`useNadsOvnSubnets`、`useNadsSectionActions`、`useLoadBalancersSectionActions`、`useIPPoolsSectionActions`） |
| `modals/` | 创建 NAD / 负载均衡 / 地址池 |
| `lib/` | `*SectionUtils`、`*TableColumns`、`*ModalUtils`、`nadSectionRefresh.ts` re-export |

## 单测

**lib**

- `lib/loadBalancersSectionUtils.test.ts`
- `lib/ippoolsSectionUtils.test.ts`
- `lib/nadsSectionUtils.test.ts`
- `lib/createLoadBalancerModalUtils.test.ts`
- `lib/nadCreateModalUtils.test.ts`
- `lib/ippoolCreateModalUtils.test.ts`

**hooks**

- `hooks/useLoadBalancersSectionActions.test.ts`
- `hooks/useIPPoolsSectionActions.test.ts`
- `hooks/useNadsSectionActions.test.tsx`
- `hooks/useNadsOvnSubnets.test.ts`

## 待办（工程化）

- [x] 拆 `NadsSection` → `lib/nadsSectionUtils` / `nadsTableColumns` / hooks
- [x] 拆 `LoadBalancersSection` / `IPPoolsSection` lib + hooks
- [x] modal lib 化（`CreateLoadBalancerModal` / `NadCreateModal` / `IPPoolCreateModal`）
- [x] hooks 单测（Section actions + `useNadsOvnSubnets`）
- [x] `frontend/src/STRUCTURE.md` §8.1 域索引
- [ ] 进一步收紧跨组件 Props 类型（低优先级）

## Cloudmap cluster 导航 ↔ Section

由 **`Cloudmap/pool/panels/cluster/index.tsx`** 装配（`pathSuffix: cluster/...`）。

| `innerActiveKey` | Section | 池 `loadTabResource` key |
|------------------|---------|--------------------------|
| `nads` | `NadsSection` | `nads` |
| `load_balancers` | `LoadBalancersSection` | `load_balancers` |
| `ippools` | `IPPoolsSection` | `ippools` |

## 刷新（cluster 池）

| 层 | 落点 |
|----|------|
| 池 · `onRefresh` | `loaders/clusterRefresh.ts` → **`createClusterTabOnRefresh(tab)`** |
| 池 · 拉数 | `loaders/pathResource/clusterPathLoads.ts` |
| 池 · 装配 | `panels/cluster/index.tsx` → **`clusterTabOnRefresh.{nads, load_balancers, ippools}`** |
| Section | **`createHarvesterToolbarRefresh(onRefresh)`**；写成功/删改 **`runHarvesterSectionRefresh(onRefresh, { force: true [, silent: true] })`** |

**`silent: true`** 在池层映射为 `loadTabResource(..., skipSync=true)`：创建后数据已入库，跳过后端全量 sync。

### 有意例外 · `NadsSection` 辅助数据

NAD 列表除池层 NAD 外，Section 内另拉 **Kube-OVN Subnet**（OVN 子网关联列、孤立 NAD 筛选、删除前子网依赖校验）及 **VM 列表**（删除前占用检查）。工具栏刷新时在 **`createHarvesterToolbarRefresh`** 的 **`before`** 中并行 **`loadOvnSubnets(true)`**，主列表仍经父级 **`clusterTabOnRefresh.nads`**。

## 其它入口

- **`Cloudmap/pool/panels/oniaas_network/index.tsx`**：复用 **`LoadBalancersSection`**

## 列表约定

- 主列表：**`std-table`** + **`scroll={{ x: true }}`** + 首列/操作列 `fixed`（`NadsSection` 另接列展示设置）。
