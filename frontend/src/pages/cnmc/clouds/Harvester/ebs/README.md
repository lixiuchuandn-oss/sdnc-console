# Harvester · ebs 业务域（块存储）

> 源码根：`frontend/src/pages/cnmc/clouds/Harvester/ebs/`  
> 放置规则见 **`frontend/src/STRUCTURE.md`**；列表刷新见 **`Harvester/shared/lib/harvesterSectionRefresh.ts`**。

## 目录角色

| 目录 | 职责 |
|------|------|
| `sections/` | 云盘、云盘快照列表（编排层） |
| `modals/` | 创建/挂载/克隆/导出/快照/扩容/恢复 |
| `lib/` | 归一化、筛选、列定义、卸载/存储类/PVC 名工具 |
| `hooks/` | `useVolumesSectionActions`、`useSnapshotsSectionActions`、`useVolumesListPoll` |

## Cloudmap 池路径 ↔ Section（storage）

| `innerActiveKey` | Section | 规范状态 |
|------------------|---------|----------|
| `volumes` | `VolumesSection` | 编排 ~380 行；`lib/` + `hooks/` + `modals/` |
| `snapshots` | `SnapshotsSection` | 编排 ~230 行；`lib/` + `useSnapshotsSectionActions` |
| `rbd_mirror` | （ceph 域） | 非本域 |

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

- 工具栏刷新：**`createHarvesterToolbarRefresh(onRefresh)`**；云盘 Tab 刷新后异步补拉命名空间（`parseHarvesterNamespaceNames`）。
- 写成功后：`onRefresh(true)` 或 `onRefresh(true, true)`；删除/批量删使用 **`useStableBurstVolumeRefresh`**。
- PVC 中间态：**`useVolumesListPoll`** 轮询 `onRefresh(true)`。
- 主列表：**`std-table`** + **`scroll={{ x: true }}`** + 列冻结（`*TableColumns.tsx`）。

## 其它入口

- 租户控制台：`console/sections/CloudConsoleMainPanel.tsx`
