# Harvester · vne（虚拟网元）

> 源码根：`frontend/src/pages/cnmc/clouds/Harvester/vne/`  
> Cloudmap 入口：侧栏 `oniaas_network/virtual_routers` → `Cloudmap/pool/panels/oniaas_network/`  
> 同导航下 `slb` 负载均衡列表在 **`Harvester/nad/`**（见 **`Harvester/nad/README.md`**）。

## 目录角色

| 目录 | 职责 |
|------|------|
| `sections/` | `VirtualRouterSection` — 虚拟路由器 VM 列表（`tower.io/paas-category=vne` 或旧 `vne-router`） |
| `modals/` | `VirtualRouterCreateModal` |

## 列表刷新约定（Cloudmap 池，与 paas_databases / compute 样板对称）

| 层 | 落点 |
|----|------|
| 池 · `onRefresh` | `loaders/oniaasNetworkRefresh.ts` → **`createOniaasNetworkTabOnRefresh('virtual_routers')`** |
| 池 · 拉数 | `loaders/pathResource/oniaasNetworkPathLoads.ts` → **`virtual_routers`**（sync + GET ecs，与云主机同源） |
| 池 · 装配 | `panels/oniaas_network/index.tsx` → **`oniaasNetworkTabOnRefresh.virtual_routers`** |
| Section | **`createHarvesterToolbarRefresh` / `runHarvesterSectionRefresh`**（`Harvester/shared/lib/harvesterSectionRefresh.ts`） |

**说明**：列表数据来自池状态 **`ecs`**，Section 内按 VNE 标签过滤；强制刷新时可顺带拉镜像/子网/NAD/存储类（与 compute `ecs` Tab 一致）。

**控制台**（`CloudConsole.tsx` → 虚拟网元 Tab）可继续注入 **`onForceRefresh`**；Cloudmap 池勿再传该 prop。

## 创建向导依赖数据

与云数据库相同：打开创建弹窗前经 `onReloadImages` / `onReloadSubnets` / `onReloadNads` / `onReloadStorageClasses` 补全依赖；Cloudmap 池内由 `panels/oniaas_network` 经 **`loadTabResource` / `loadResource`** 实现。
