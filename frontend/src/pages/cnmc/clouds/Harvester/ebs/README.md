# Harvester · ebs 业务域（块存储）

> 源码根：`frontend/src/pages/cnmc/clouds/Harvester/ebs/`  
> 放置规则见 **`frontend/src/STRUCTURE.md`**；列表刷新见 **`lib/ebsSectionRefresh.ts`**（re-export **`Harvester/shared/lib/harvesterSectionRefresh.ts`**）。

## 目录角色

| 目录 | 职责 |
|------|------|
| `sections/` | 云盘、云盘快照列表（编排层） |
| `drawers/` | 云盘详情侧栏（`VolumeDetailDrawer`） |
| `modals/` | 创建/挂载/克隆/导出/快照/扩容/恢复 |
| `lib/` | 归一化、筛选、列定义、卸载/存储类/PVC 名工具；`ebsSectionRefresh.ts` |
| `hooks/` | `useVolumesSectionActions`、`useSnapshotsSectionActions`、`useVolumesListPoll` |

## Cloudmap 池路径 ↔ Section（storage）

由 **`Cloudmap/pool/panels/storage/index.tsx`** 装配（`pathSuffix: storage/...`）。

| `innerActiveKey` | Section | 规范状态 |
|------------------|---------|----------|
| `volumes` | `VolumesSection` | 编排 ~380 行；`lib/` + `hooks/` + `modals/` |
| `snapshots` | `SnapshotsSection` | 编排 ~230 行；`lib/` + `useSnapshotsSectionActions` |
| `rbd_mirror` | （ceph 域） | 非本域 |

## 刷新（Cloudmap storage 池）

**两层**：池层 **`loadTabResource`** + Section 层 **`createHarvesterToolbarRefresh` / `runHarvesterSectionRefresh`**。横切细则见 **`Cloudmap/pool/README.md`**；本域 Tab key 见下文。

| 层 | 落点 |
|----|------|
| 池 · 各子 Tab `onRefresh` | `Cloudmap/pool/loaders/storageRefresh.ts` → **`createStorageTabOnRefresh`** |
| 池 · 拉数 | `loaders/pathResource/storagePathLoads.ts`（经 `runPathResourceLoad`） |
| 池 · 装配 | `Cloudmap/pool/panels/storage/index.tsx` → **`storageTabOnRefresh.volumes` / `.snapshots`** |
| Section 工具栏 | **`createHarvesterToolbarRefresh(onRefresh)`**；云盘 Tab 刷新后异步补拉命名空间（`parseHarvesterNamespaceNames`） |
| Section 写成功/删改 | **`runHarvesterSectionRefresh(onRefresh, { force: true [, silent: true] })`**，禁止裸 `onRefresh(...)` |
| PVC 中间态 / burst | **`useVolumesListPoll`**、**`useStableBurstVolumeRefresh`** 内部调用 **`runHarvesterSectionRefresh`**（`silent: true`） |
| 导出镜像 | 池层注入 **`onRefreshImages`** → `loadTabResource('images', …)` |
| 创建云盘前 | **`onRefreshStorageClasses`** → `loadTabResource('storage_classes', …)` |

**storage 子 Tab 与 `loadTabResource` key**

| `innerActiveKey` | `loadTabResource` key | 说明 |
|------------------|----------------------|------|
| `volumes` | `volumes` | 含关联 VM（`ecs`）直拉；强制刷新时顺带 `storage_classes` |
| `snapshots` | `snapshots` | 快照列表 |

## VolumesSection 阅读引导

`VolumesSection.tsx` 负责云盘列表编排（筛选 / 工具栏 / Table / Modal / Drawer），建议阅读顺序：

1. **Props** — 卷列表、VM、StorageClass、`onRefresh` / `onRefreshImages` 从池层注入  
2. **`normalizeVolumeList` / `filterVolumesForTable`**（`volumesSectionUtils.ts`）  
3. **`createVolumeSafeRead`**（`volumeSafeRead.ts`）— 挂载 VM、系统盘判定  
4. **`useVolumesSectionActions`** — 行内操作、Modal 状态、批量删  
5. **`buildVolumesTableColumns`** + `useTableColumnSettings`  
6. **`useVolumesListPoll`** — PVC 中间态轮询（内部 `runHarvesterSectionRefresh`）  
7. **JSX** — `PageDetailSection` + 弹窗 + `VolumeDetailDrawer` / `HarvesterOpsinfoDrawer`（YAML）

快照 Tab 结构更简单：见 `SnapshotsSection` + `useSnapshotsSectionActions`。

## 规范状态（逐文件）

| 文件 | 行数级 | 说明 |
|------|--------|------|
| `sections/VolumesSection.tsx` | ~380 | 列表编排；弹窗/列/hooks 外置 |
| `sections/SnapshotsSection.tsx` | ~230 | 筛选 + 表格 + 恢复/详情抽屉 |
| `hooks/useVolumesSectionActions.tsx` | ~400 | 云盘行操作、弹窗状态、批量删 |
| `hooks/useSnapshotsSectionActions.ts` | ~165 | 快照行操作、恢复/详情 |
| `hooks/useVolumesListPoll.ts` | ~80 | PVC 中间态轮询 |
| `lib/volumesSectionUtils.ts` | — | 归一化、筛选 |
| `lib/snapshotsSectionUtils.ts` | — | 快照归一化、筛选、命名空间 options |
| `lib/*TableColumns.tsx` | — | `std-table` 列 + 行操作 |
| `lib/volumePvcNameUtils.ts` | — | PVC 资源名生成（创建/恢复共用） |
| `lib/volumesStorageClassUtils.ts` | — | StorageClass 下拉与默认选取 |
| `modals/*.tsx` | — | 无 `any`；Create/Restore 已 typed |

单测：`lib/*.test.ts`（volumes/snapshots/detach 等，23+ 用例）。

## 弹窗清单（`modals/`）

| 组件 | 入口 |
|------|------|
| `VolumeCreateModal` | 工具栏「创建云盘」 |
| `VolumeAttachModal` | 行操作「挂载到虚拟机」 |
| `VolumeCloneModal` | 行操作「克隆云盘」 |
| `VolumeExportImageModal` | 行操作「导出为镜像」 |
| `VolumeSnapshotCreateModal` | 行操作「创建快照」 |
| `VolumeResizeModal` | 行操作「编辑配置」（扩容） |
| `VolumeSnapshotRestoreModal` | 快照列表「恢复」 |

## 列表约定

- 主列表：**`std-table`** + **`scroll={{ x: true }}`** + 列冻结（`*TableColumns.tsx`）。

## 其它入口

- 租户控制台：`console/sections/CloudConsoleMainPanel.tsx`
