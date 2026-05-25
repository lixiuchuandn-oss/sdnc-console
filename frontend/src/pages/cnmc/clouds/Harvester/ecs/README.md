# Harvester · ecs 业务域（弹性计算）



> 源码根：`frontend/src/pages/cnmc/clouds/Harvester/ecs/`  

> 放置规则见 **`frontend/src/STRUCTURE.md`**；列表刷新等横切能力见 **`Harvester/shared/lib/harvesterSectionRefresh.ts`**（勿在域内再拷贝一套）。



## 目录角色



| 目录 | 职责 |

|------|------|

| `sections/` | 云主机、镜像、模板、SSH、CloudInit、回收站、迁移等列表 |

| `hooks/` | Section 编排 hook（`useVmSectionActions`、`useVmSectionFilters`、`useImagesSectionActions` 等） |

| `drawers/` | VM 详情、磁盘/网卡/GPU/USB 管理等侧栏 |

| `modals/` | 创建向导、克隆、镜像/密钥创建等 |

| `lib/` | 纯逻辑（变配、磁盘、网络、列表 `*SectionUtils` / `*TableColumns` / `*SectionActions`） |



## Cloudmap 池路径 ↔ Section（compute）



由 **`Cloudmap/pool/panels/compute/index.tsx`** 装配（`pathSuffix: compute/...`）。侧栏「高级配置」三级目录含 SSH 密钥、CloudInit、迁移记录（见 `routes/cloudmapPoolNavRows.ts` · `compute_advanced_config`）。



| `innerActiveKey` | Section | 规范状态 |

|------------------|---------|-----------------|

| `ecs` | `VmSection` | `lib/` + hooks；详见下文 VmSection |

| `images` | `ImagesSection` | `imagesSectionUtils` + `imagesSectionActions` + `useImagesSectionActions` |

| `templates` | `TemplatesSection` | `templatesSectionUtils` + `templatesSectionActions` |

| `ssh_keys` | `SshKeysSection` | `sshKeysSectionUtils` + 单测 |

| `cloud_inits` | `CloudInitsSection` | `cloudInitsSectionUtils`；列表依赖集群 CloudInitTemplate CRD，常为空态 |

| `recycle_bin` | `RecycleBinSection` | `recycleBinTableColumns` + `recycleBinSectionUtils` + 共用 `vmSectionUtils` |

| `migrations` | `MigrationsSection` | `migrationsSectionUtils` + 池 `loadTabResource('migrations')` |



回收站关机**记录**子表：`RecycleBinRecordsSection`（读 Tower 库，分页自拉；与 compute 统一刷新约定除外）。

## 刷新（Cloudmap compute 池）

- 池层：`Cloudmap/pool/loaders/computeRefresh.ts` → 各 Tab 均 `loadTabResource(innerKey, force)`，拉数在 `loaders/pathResource/computePathLoads.ts`。
- 云主机列表：`ecs`；`refreshVms` 即 `loadTabResource('ecs', …)`（SSE 仍在 `useCloudmapPoolEcs`）。
- Section 工具栏：`createHarvesterToolbarRefresh(onRefresh)`；写成功：`runHarvesterSectionRefresh(onRefresh, { force: true })`。



## VmSection 阅读引导



`VmSection.tsx` 负责列表编排（筛选 / 工具栏 / Table / Modal），建议阅读顺序：



1. **Props** — 数据从哪来、`onCreateVmOverride`、快速创建所需扁平资源  

2. **`useVmSectionFilters`** — 搜索 / 筛选 / 选中行  

3. **`useVmSectionActions`** — 行内与批量操作、Modal 状态  

4. **`SafeRead`**（`vmSafeRead.ts`）— 列渲染统一读字段  

5. **`filterActiveVmListRows`**（`vmSectionUtils.ts`）  

6. **`buildVmTableColumns`** + `useTableColumnSettings`  

7. **JSX** — `PageDetailSection` toolbar + Table + 弹窗  



详情 Tab、YAML、终端由 **`VmDetailDrawer`** 负责；本 Section 不再挂载 `HarvesterResourceDrawer`。



**权限**：工具栏批量操作用 `vmPermissions.create`；行内 `ResourceActionsDropdown` 含控制台 / 删除等细分权限，门控不一致属有意为之。



**与回收站对齐**：`RecycleBinSection` 共用 `getVmInstanceId`、`createVmRecycleBinListSafeRead` 等，改列表读字段时需同步回收站。



## 列表约定



- 工具栏：经 **`PageDetailSection`** 的 **`toolbarLeft`** / **`toolbarRight`** 挂载。  

- 工具栏刷新：**全部** compute 列表 Section 使用 **`createHarvesterToolbarRefresh(onRefresh)`**（`Harvester/shared/lib/harvesterSectionRefresh.ts`）；自拉数据的 Tab（如迁移记录）可在 `before` 中先 `loadData(true)`。  

- 写成功后：**禁止**裸调 `onRefresh(...)`，一律 `runHarvesterSectionRefresh(onRefresh, { force: true [, silent: true] })`。  

- 主列表：**`std-table`** + **`scroll={{ x: true }}`** + 首列/操作列 `fixed`（见 `*TableColumns.tsx`）。



## 其它入口



- 控制台：`console/sections/CloudConsoleMainPanel.tsx`（部分与 compute 池共用 Section）

