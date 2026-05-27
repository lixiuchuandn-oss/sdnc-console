# Harvester · database（云数据库 / RDS）

> 源码根：`frontend/src/pages/cnmc/clouds/Harvester/database/`  
> Cloudmap 入口：侧栏 `paas_databases/rds` → `Cloudmap/pool/panels/paas_databases/`  
> 放置规则见 **`frontend/src/STRUCTURE.md`**。

## 目录角色

| 目录 | 职责 |
|------|------|
| `sections/` | `PaasSection` — 托管数据库 VM 列表（按 `tower.io/paas-category` / 旧 `rds` 标签筛选） |
| `modals/` | 创建实例、标签编辑、数据库控制台 |
| `drawers/` | 管理侧栏（若有） |

## 列表刷新约定（Cloudmap 池，与 compute/cluster 样板对称）

| 层 | 落点 |
|----|------|
| 池 · `onRefresh` | `loaders/paasDatabasesRefresh.ts` → **`createPaasDatabasesTabOnRefresh('rds')`** |
| 池 · 拉数 | `loaders/pathResource/paasDatabasesPathLoads.ts` → **`rds` ≡ `ecs`**（sync + 直拉 VM，与云主机 Tab 同源） |
| 池 · 装配 | `panels/paas_databases/index.tsx` → **`paasDatabasesTabOnRefresh.rds`** |
| Section | **`createHarvesterToolbarRefresh(onRefresh)`**；写成功/删改 **`runHarvesterSectionRefresh(onRefresh, { force: true })`** |

**说明**：列表数据来自池状态 **`ecs`**，前端在 `PaasSection` 内按 PaaS 标签过滤；刷新的是整份 VM 列表，不是单独 RDS API。

**控制台**（`console/sections/CloudConsoleDatabasePanel.tsx`）可继续注入自有 `onRefresh` / 旧 `onForceRefresh`；Cloudmap 池勿再传 `onForceRefresh`。

## 创建向导依赖数据

打开创建弹窗前可调用 `onReloadImages` / `onReloadSubnets` / `onReloadNads` / `onReloadStorageClasses`；Cloudmap 池内由面板经 **`loadTabResource` / `loadResource`** 实现，与强制刷新 RDS 列表时的辅助拉数一致。
