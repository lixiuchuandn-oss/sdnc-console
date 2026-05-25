# Harvester · ecs 业务域（弹性计算）

> 源码根：`frontend/src/pages/cnmc/clouds/Harvester/ecs/`  
> 放置规则见 **`frontend/src/STRUCTURE.md`**；列表刷新等横切能力见 **`Harvester/shared/lib/harvesterSectionRefresh.ts`**（勿在域内再拷贝一套）。

## 目录角色

| 目录 | 职责 |
|------|------|
| `sections/` | 云主机、镜像、模板、SSH、CloudInit、回收站、迁移等列表 |
| `drawers/` | VM 详情、磁盘/网卡/GPU/USB 管理等侧栏 |
| `modals/` | 创建向导、克隆、镜像/密钥创建等 |
| `lib/` | 纯逻辑（变配、磁盘、网络、列表 `*SectionUtils` / `*TableColumns`） |

## Cloudmap 池路径 ↔ Section（compute）

由 **`Cloudmap/pool/panels/compute/index.tsx`** 装配（`pathSuffix: compute/...`）。

| `innerActiveKey` | Section | 阶段 A 规范状态 |
|------------------|---------|-----------------|
| `ecs` | `VmSection` | **未动**（核心列表，单独里程碑） |
| `images` | `ImagesSection` | 已拆 `lib/imagesSectionUtils`、`imagesTableColumns`、统一刷新 |
| `templates` | `TemplatesSection` | 待阶段 B |
| `ssh_keys` | `SshKeysSection` | 已拆 `lib/`，统一刷新 |
| `cloud_inits` | `CloudInitsSection` | 已拆 `lib/`，统一刷新 |
| `recycle_bin` | `RecycleBinSection` | 待阶段 B |
| `migrations` | `MigrationsSection` | 已拆 `lib/`，自拉数据 + 统一刷新 |

回收站关机**记录**子表：`RecycleBinRecordsSection`（读 Tower 库，非 `onRefresh` 父级列表）。

## 列表约定

- 工具栏刷新：**`createHarvesterToolbarRefresh(onRefresh)`**（来自 `Harvester/shared/lib/harvesterSectionRefresh.ts`）。
- 写成功后：`onRefresh(true)` 或 `onRefresh(true, true)`（静默），与 **AGENTS · 数据展示与刷新** 一致。
- 主列表：**`std-table`** + **`scroll={{ x: true }}`** + 首列/操作列 `fixed`（见 `*TableColumns.tsx`）。

## 其它入口

- 控制台：`console/sections/CloudConsoleMainPanel.tsx`（含 GPU 等，部分与 compute 池共用 Section）
