# Harvester · Ceph 存储：用户视角功能架构

本文档从 **使用产品的用户** 出发规划能力边界与信息架构（五大区块）。实现上仍以 **Rook 在 Kubernetes 中的 CRD** 为权威数据面，`GET /api/clouds/:id/ceph/rook/bundle` 等为数据源；**Ceph mgr Dashboard** 仅作可选增强（摘要图表等），不得阻塞下列任一板块的只读能力。

权威目录规则见 `frontend/src/STRUCTURE.md`；本文件描述 `Harvester/ceph/` 子域的产品切片。

---

## 功能架构（五大板块）

### 1. 总览

**用户来这做什么**  
进门第一眼：判断这套 Ceph/Rook 是否健康、能不能用、容量是否告警。

**应呈现（由简到繁迭代）**

- 集群状态：健康（OK/WARN/ERR）、Phase、版本等。
- 容量与对象：总容量/已用/可用（若 status 可得）、对象健康度摘要（可选）。
- 拓扑摘要：Monitor 法定人数、OSD 总数/在线/in、Mgr 等（可与 Dashboard summary 或 CR status 同源，优先 CR）。
- 快捷入口：跳转到「存储池 / 块存储 / CephFS / 对象存储」对应 Tab。
- 异常时：明确提示是「集群不可达 / 无权限 / 未安装 Rook」等，避免空白页。

**与当前实现核对**（`sections/CephStorageSection.tsx` · Cloudmap Ceph 分组内层 `overview`）

| 规划项 | 现状 |
|--------|------|
| 集群状态 | **已做**：`api/health/minimal` + `fetchCephDashboardSummary` 经 `buildCephLandingModel` 展示健康文案与严重度样式（非 Rook CR）。 |
| 容量与对象 | **已做**：裸容量/对象数/PG 等卡片与环形指标；部分依赖 summary / minimal。 |
| 拓扑摘要（Mon / OSD / Mgr） | **已做**：独立 MetricCard（监视器实例数 + 仲裁数、OSD 总数 + up/in、管理器 active/standby 说明）。 |
| 快捷入口 | **部分**：块存储 / CephFS / 对象存储 **尚未**在产品里挂 Tab；用户通过 **Cloudmap 侧栏** 在「总览 / 存储池」间切换。总览页 **内无**「一键跳到存储池」按钮（可后续用路由或锚点补强）。 |
| 异常提示 | **已做**：Dashboard 请求失败、`_tower.cephDashboardError`、健康 minimal 失败等均有 `Alert`；文案偏「Dashboard / 连接凭据」，**未**单独区分「未安装 Rook」（因当前未走 bundle）。 |
| 数据源 | **现状全部为 Ceph mgr Dashboard REST**（含 `api/pool?stats=true` 用于池使用率趋势），**未**使用 `cephclusters` CR 或 `/ceph/rook/bundle` 作为总览主链路。 |

**与现网关系**  
总览能力已在 `CephStorageSection` 落地，但 **与上文规划中的「优先 CR」不一致**；演进方向是保留现有卡片体验的同时，逐步接入 Rook status / bundle 作为降级或主源。

---

### 2. 存储池

**用户来这做什么**  
管理 **RADOS 层面的存储池**：有哪些池、副本/纠删策略、是否给 RBD/CephFS/RGW 用、容量占用大致如何；需要时 **创建 / 调整 / 删除池**（权限与危险操作需确认）。

**能力范围**

- 列表：池名称、命名空间、类型（副本/EC）、关联应用/用途、Phase、容量或用量指标（有则展示，无则 `—`）。
- 详情：Spec / Status 分块、YAML（与全站 CRD 详情模式一致）。
- 操作（分期）：新建池、编辑池参数、删池；成功之后列表 **强制刷新** 对齐集群。

**与当前实现核对**（`sections/CephPoolSection.tsx` · Cloudmap Ceph 分组内层 `storage_pools`）

| 规划项 | 现状 |
|--------|------|
| 列表 | **已做**：字段与 Ceph Dashboard Pools 列表对齐（`fetchCephDashboardPools` → `cephDashboardPoolToTableRow`）；含搜索、Phase 筛选、分页。 |
| Rook 主路径 | **未做**：注释与逻辑均为 **仅 Dashboard**，失败时 **不回退** Steve / `CephBlockPool`；与 PLAN「Rook 权威」目标不符，属后续改造点。 |
| 详情 | **已做**：展开行多 Tab——Dashboard 通用字段、统计指标、RBD「配置」（QoS，走 `fetchCephPoolRbdConfiguration`）；Rook CR 详情 Tab 在代码中存在，但 **列表数据非 Rook 时基本不会被推到该形态**。 |
| 创建 / 编辑 | **已做**：`CephPoolFormModal` 经 Tower 代理调 Dashboard `POST/PUT api/pool`；成功后 `load(true)` 刷新。 |
| YAML / 全站 CRD 抽屉 | **未做**：非 `HarvesterCrdMetadataDrawer` 式统一 YAML 详情，以表格 + KV/统计为主。 |

**技术映射（目标态备忘）**  
规划主数据：`CephBlockPool`（Steve）+ `/ceph/*` 写接口；**当前实现**仍以 mgr Dashboard REST 为唯一数据源与写路径。

---

### 3. 块存储

**用户来这做什么**  
在 **存储池之下**，管理 **块存储相关扩展能力**（不是重复做第二张「池表」）。例如：在多租户场景下划分 **块命名空间**、配置 **RBD 跨集群镜像** 等；后续若有「与卷/镜像列表」类产品需求，归本 Tab，不与「存储池」混为一张表。

**能力范围（分期）**

- **RADOS 命名空间**：列表与详情（`CephBlockPoolRadosNamespace`）；创建/删除（随后端写接口落地）。
- **RBlock 镜像/Mirror**：`CephRBDMirror` 等资源列表与详情；操作按集群实际安装情况显示。
- **COSI 等**：若集群启用 `CephCOSIDriver`，在本 Tab 或子节展示，避免挤占「对象存储」主叙事。

**与「存储池」的边界**  
| 板块 | 用户心智 |  
|------|----------|  
| 存储池 | 我管的是 **池** 本身（一组 PG、副本策略、给谁用）。 |  
| 块存储 | 我管的是 **池下面的块维度能力**（命名空间隔离、镜像、块相关驱动等）。 |  

---

### 4. CephFS

**用户来这做什么**  
管理 **分布式文件系统**：文件系统实例是否就绪、元数据与数据池、子卷组等；需要时创建或调整（分期）。

**能力范围**

- 列表：`CephFilesystem` 主资源；列：名称、命名空间、Phase、关联集群等。
- 详情：MDS/池配置等 status 可读字段 + YAML。
- 子能力（二期+）：`CephFilesystemSubVolumeGroup`、`CephFilesystemMirror`、NFS（`CephNFS`）等以 **子 Tab 或折叠区块** 挂在本板块下，避免总览过载。

---

### 5. 对象存储

**用户来这做什么**  
管理 **S3 兼容对象网关**：Object Store 是否就绪、网关入口；用户密钥、Zone/Realm 等多站点能力在集群启用时展示；**存储桶**若产品要做，明确是 OBC/COSI、S3 API 还是 RGW Admin，单独子路径实现，不冒充「CR 列表页解决一切」。

**能力范围**

- 列表：`CephObjectStore`；详情与 YAML。
- 二期+：`CephObjectStoreUser`、多站点相关（`CephObjectRealm` / `Zone` / `ZoneGroup`）、桶通知与 Topic 等 CR，按 **对象存储 → 子节** 渐进增加。
- **创建存储桶**：用户操作归口「对象存储」；技术方案在 `ceph` 后端独立子 API（见下文附录），不塞进单一只读 bundle。

---

## 导航与页面结构（建议）

```
Ceph 存储
├── 1. 总览
├── 2. 存储池
├── 3. 块存储
├── 4. CephFS
└── 5. 对象存储
```

- 每个 Tab：`PageDetailSection` + 表格（`.std-table`）+ 详情抽屉；写操作成功后 **skipCache / force** 刷新（见 `AGENTS.md`）。
- `sections/` 落位建议：保留并收窄 `CephStorageSection`（总览）；`CephPoolSection`（存储池）；新增 `CephBlockStorageSection`、`CephFilesystemSection`、`CephObjectStoreSection`（或与父级 Tab 文件合并，以 `STRUCTURE.md` 为准）。

---

## 附录 A：后端与数据源（精简）

- **读聚合**：`/api/clouds/:id/ceph/rook/bundle`（及迁移期 `monitoring/ceph-resources`）提供多类 Rook Steve 列表；各板块按 key 取子集展示。
- **写能力**：落在 `/api/clouds/:id/ceph/...` 专用路由（池中资源池、块命名空间、FS、ObjectStore 等分期开放）；**不**依赖 `ceph-dashboard/proxy` 完成核心 CRUD。
- **前端 API**：逐步由 `cephApi.ts` 承载 `/ceph/*`，与 `monitoringApi` 解耦。

---

## 附录 B：验收（用户可感知）

1. 在未配置或不可用 Ceph Dashboard 时，**五大板块至少能完成总览 + 各自主资源的列表与详情**（除明确依赖 Dashboard 的可选图表外）。
2. 任一创建/编辑/删除成功后，当前 Tab 列表 **立即与集群一致**（真实重拉、不伪造刷新）。
3. 权限与危险操作（删池等）有二次确认与后端校验。

（完）
