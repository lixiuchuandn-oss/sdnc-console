# Harvester · cbr（云备份 / 快照 / 定时策略 / 恢复任务）

> 源码根：`frontend/src/pages/cnmc/clouds/Harvester/cbr/`  
> Cloudmap 入口：侧栏 `backups/...` → `Cloudmap/pool/panels/backups/`  
> 放置规则见 **`frontend/src/STRUCTURE.md`**；列表刷新横切能力见 **`Harvester/shared/lib/harvesterSectionRefresh.ts`**（域内 **`lib/cbrSectionRefresh.ts`** 仅 re-export）。

## 目录角色

| 目录 | 职责 |
|------|------|
| `sections/` | 备份/快照列表、定时策略、恢复任务（薄编排） |
| `hooks/` | Section 侧状态与操作 + 单测（`useScheduleVmBackupsOptimistic.test.ts`、`useBackupsSectionActions.test.ts`、`useVmRestoreTasksListController.test.ts`） |
| `modals/` | 创建备份/快照、恢复、定时策略增改 |
| `lib/` | `*SectionUtils`、`*TableColumns`、`vmBackupDisplay.ts`、`vmRestoreModalUtils.ts`、`scheduleVmBackupCreateModalUtils.ts`、`scheduleVmBackupEditModalUtils.ts`、Section 刷新 re-export |

## Cloudmap 池路径 ↔ Section

由 **`Cloudmap/pool/panels/backups/index.tsx`** 装配（`pathSuffix: backups/...`）。

| `innerActiveKey` | Section | 规范状态 |
|------------------|---------|----------|
| `backups` | `BackupsSection`（`type="backup"`） | 池 + **`useBackupsSectionActions`** + shared refresh |
| `vm_snapshots` | `BackupsSection`（`type="snapshot"`） | 同上 |
| `schedule_vm_backups` | `ScheduleVmBackupsSection` | 池 + optimistic hooks |
| `vm_restores` | `VmRestoreTasksSection` | **`useVmRestoreTasksListController`** 自拉 + 轮询 |

## 刷新（Cloudmap backups 池）

| 层 | 落点 |
|----|------|
| 池 · `onRefresh` | `loaders/backupsRefresh.ts` → **`createBackupsTabOnRefresh(tab)`** |
| 池 · 拉数 | `loaders/pathResource/backupsPathLoads.ts` → **`loadTabResource('backups')`** 并行拉备份列表与定时策略 |
| 池 · 装配 | `panels/backups/index.tsx` → **`backupsTabOnRefresh.*`** |
| Section | **`createHarvesterToolbarRefresh(onRefresh)`**；写成功/删改 **`runHarvesterSectionRefresh(onRefresh, { force: true [, silent: true] })`** |

**`silent: true`** 在池层映射为 `loadTabResource(..., skipSync=true)`：写操作后数据已入库，跳过后端全量 sync，避免刚创建的备份/策略被同步抹掉。

### 有意例外 · `vm_restores`

恢复任务 Tab 在 Section 内直拉 `VirtualMachineRestore` / `CephVmRestore` 与关联备份（进行中任务需轮询）。工具栏与轮询仍走 **`createHarvesterToolbarRefresh` / `runHarvesterSectionRefresh`** 包装本地 `refresh`，**不**经池 `loadTabResource`。

## 其它入口

**控制台**（`console/CloudConsole.tsx` → `CloudConsoleMainPanel`）与池层对称：经 **`createBackupsTabOnRefresh`** 装配 **`backupsTabOnRefresh.{backups, vm_snapshots, schedule_vm_backups}`**，底层 **`loadBackupsTabResource`** 并行拉备份列表与定时策略。

## 列表约定

- 工具栏：经 **`PageDetailSection`** 的 **`toolbarLeft` / `toolbarRight`** 或内联工具栏 + **`createHarvesterToolbarRefresh`**。
- 主列表：**`std-table`** + **`scroll={{ x: true }}`** + 首列/操作列 `fixed`。
- 定时策略：创建/停用采用乐观 UI + 静默轮询直至对端一致（**`hooks/useScheduleVmBackupsOptimistic.ts`**；内部 `runHarvesterSectionRefresh(..., { silent: true })`）。
- 恢复任务：列表拉取与轮询在 **`hooks/useVmRestoreTasksListController.ts`**。
