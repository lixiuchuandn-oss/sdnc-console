# Harvester · database（云数据库 / 云 RDS）

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

---

## 镜像与实例元数据（标签 / 注解设计）

> **状态**：设计稿，供后续整改对照实现。  
> **范围**：当前以 Harvester **VirtualMachineImage** 与 **VirtualMachine**（云数据库形态）为主；其它 PaaS 产品线可复用同一套前缀与分层。

### 背景与问题

#### 现状（实现侧摘要）

- 云数据库创建向导将带 **`tower.io/paas-type`** 的镜像纳入可选目录；可选 **`tower.io/paas-ver`** 做版本维度。
- 云数据库实例列表以 **`tower.io/rds === 'true'`** 为成员条件，再以 **`tower.io/paas-type`** 收窄；MySQL 兼容「无 `paas-type`」的旧实例。
- 上述键均落在 Kubernetes **`metadata.labels`**，但部分 UI 文案仍口语化称为「注解」，易与 **`metadata.annotations`** 混淆。
- **`tower.io/rds`** 命名偏「RDS」语义，与产品线中 PostgreSQL、MongoDB、消息类等并存时易产生歧义；且与 **`paas-type`** 形成双轨「成员资格」，增加心智与文档成本。

#### 目标

1. **术语与 K8s 一致**：区分 **labels**（可筛选、短枚举）与 **annotations**（非选择性、可较长）。
2. **镜像与实例同一套「产品维度」键**，创建时从镜像继承到 VM，减少分叉。
3. **单一明确的成员语义**：避免「布尔成员 + 类型」重复表达（在可接受迁移成本的前提下）。
4. **可扩展**：同一前缀下容纳数据库、消息、缓存等不同 `domain`，而不滥用 `rds` 泛指。

### 设计原则

| 元数据类型 | 用途 | 典型内容 |
|------------|------|----------|
| **Labels** | 列表过滤、产品分类、策略/配额预留（selector）、取值短且枚举可控 | 引擎、域、主版本、通道 |
| **Annotations** | 展示名、长说明、外部 ID、非参与选择的配置 | `tower.io/alias`、构建信息、说明文案 |

约束遵循 Kubernetes 对 label key/value 的长度与字符集要求。

### 目标模型（建议）

#### 推荐 Labels（新键名）

以下键名在整改落地时可与旧键 **双读一段时间**，见「迁移与兼容」。

| Key | 必填 | 含义 | 示例值 |
|-----|------|------|--------|
| **`tower.io/paas-domain`** | 推荐 | PaaS 大类，与控制台产品线对齐 | `database` |
| **`tower.io/paas-engine`** | **是**（纳入目录时） | 引擎 / 形态，等同今日 `paas-type` 语义 | `mysql`、`postgresql`、`mongodb` |
| **`tower.io/paas-version`** | 否 | 主版本，用于筛选与展示，等同今日 `paas-ver` | `8.0`、`5.7`、`15` |

**可选扩展**（有明确需求再引入，避免标签膨胀）：

| Key | 含义 | 示例 |
|-----|------|------|
| `tower.io/paas-variant` | 同 engine+version 下的发行差异 | `bitnami`、`official` |
| `tower.io/paas-channel` | 发布通道 | `stable`、`preview` |

#### 成员判定（新逻辑）

- **镜像进入云数据库（database）镜像目录**：`tower.io/paas-domain=database` **且** `tower.io/paas-engine` 非空；或过渡期 **`paas-engine` 非空即视为 database**（若不希望省略 domain）。
- **实例进入云数据库实例列表**：与镜像一致，以 **`paas-domain` + `paas-engine`** 为准；**不再依赖**单独的 `tower.io/rds=true`（迁移完成后）。

#### Annotations（保持 / 补充）

- **`tower.io/alias`**：实例展示名，保持为 annotation（与现有 VM 体系一致）。
- 镜像展示：可继续依赖 Harvester / 既有字段（如 displayName、Harvester 自带注解）；**不把长展示名塞进 label value**。

### 与现状字段的对照

| 现状（labels） | 目标（labels） | 说明 |
|----------------|----------------|------|
| `tower.io/paas-type` | `tower.io/paas-engine` | 语义对齐，名称更贴切 |
| `tower.io/paas-ver` | `tower.io/paas-version` | 拼写统一为 `version` |
| `tower.io/rds=true` | **删除**（迁移后） | 由 `paas-domain` + `paas-engine` 表达成员关系 |

### 迁移与兼容（整改阶段建议）

1. **阶段 A — 双读**
   - 镜像目录：`paas-engine` 优先；若缺失则回退读 `tower.io/paas-type`。
   - 版本：`paas-version` 优先；若缺失则回退 `tower.io/paas-ver`。
   - 实例列表：`(paas-domain=database && paas-engine)` **或** 旧逻辑 `(tower.io/rds=true && …)`，直至数据刷完。

2. **阶段 B — 双写**
   - 创建 VM / 同步标签时同时写入新旧键（或仅写新键 + 后台任务补旧键），按发布节奏选择。

3. **阶段 C — 单读单写**
   - 仅认新键；文档与 UI 全部改为新键名。
   - 可选：一次性 job 为存量 Image/VM 补 `paas-domain` / 重命名键（注意 JSON Patch 与库存同步）。

4. **文档与 UI**
   - 全文使用「标签 / annotations」与 K8s 一致用语；镜像编辑、创建向导、错误提示中的示例键同步更新。

### 实现落点清单（整改时核对）

| 区域 | 路径 |
|------|------|
| 创建向导 / 镜像目录 | `modals/RdsCreateModal.tsx` |
| 实例列表与筛选 | `sections/PaasSection.tsx` |
| 实例标签编辑 | `modals/RdsInstanceLabelEditModal.tsx` |
| 镜像标签编辑 | `../ecs/modals/ImageLabelEditModal.tsx` |
| 控制台云数据库面板 | `../../../console/CloudConsole.tsx`、`../../../console/sections/CloudConsoleDatabasePanel.tsx` |
| 后端 | 若有按 label 过滤 VM/Image 的接口，需与前端双读策略一致 |

### 开放问题

1. **`tower.io/paas-domain` 是否强制**：若强制，需为所有存量带 `paas-type` 的镜像/VM 补写 `database`。
2. **消息队列 / Kafka 等**：是否共用 `paas-domain=messaging` 与独立控制台路由，避免与 `database` 混表。
3. **与 RBAC / 审计**：新 label 是否进入审计展示字段，与现有权限键对齐方式。

### 修订记录

| 日期 | 说明 |
|------|------|
| 2026-04-27 | 初稿：现状、目标 labels/annotations、迁移阶段、实现落点 |
