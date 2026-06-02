# Harvester / Cloudmap 虚拟化能力对标清单（Tower 实现现状）

> **用途**：按标书原文逐项对照 **是否满足**，区分 **已可截图** 与 **需继续开发**；供应标与排期使用。  
> **范围**：Cloudmap 资源池 + Harvester 域（`frontend/src/pages/cnmc/clouds/Harvester/` 等）。  
> **原则**：
>
> - 标书 **怎么写就怎么验收**——**改名词、改口径不算满足**（例如统一存储不能顶替「存储 DRS」，VM 开关机不能顶替「DPM」，高可用设置不能顶替「虚拟机替代项」）。
> - **不要求**做到 vSphere 等行业标准的每一项极致子功能；标书也未写细——但 **至少要有与条目名称一致的基本界面/能力**，能正经截图。
> - **基本能力** = 功能语义与标书条目对齐的 **最小可交付**（规则+迁移记录算计算 DRS；不是要求热力图、自动化级别滑块）。

**关联文档**：

- [3-2-新一代计算虚拟化.md](./cloudmap-whitepaper/source/ch03/3-2-新一代计算虚拟化.md)、[3-2-1-资源动态调度.md](./cloudmap-whitepaper/source/ch03/3-2-1-资源动态调度.md)
- DRS：`frontend/.../cluster/sections/DrsSection.tsx`、`backend/.../services/hms/metricRuleCr.ts`
- 控制面观测：`frontend/.../cluster/sections/NodesSection.tsx`、`ControlPlaneHaKpiRow.tsx`
- 亲和性：`StepOthersPodAffinity.tsx`、节点/虚拟机亲和抽屉

---

## 0. 结论速览

| 标书能力项 | 是否满足 | 现状 | 能否按标书名目截图 |
|------------|----------|------|-------------------|
| 创建五种架构集群 | **不满足** | 仅资源池 **注册**已有集群；节点可读架构（多为 amd64/arm64） | **否**（缺「创建集群 + 五架构选择」界面） |
| 集群 HA 高可用 | **部分满足** | 物理节点 KPI；VM 高可用；PDB；**故障域**；**节点维护模式** | **部分**（可截 HA + 故障域 + 维护模式；仍缺 Tower 内控制面扩缩） |
| 计算资源 DRS | **满足** | DRS 调度：MetricRule + DRS 迁移记录 | **是** |
| 存储资源 DRS | **不满足** | 有统一存储/卷/存储类，**无**存储 DRS 专名能力或界面 | **否** |
| 电源管理 DPM | **不满足** | 仅有 VM 电源操作，**无** DPM 策略/界面 | **否** |
| 虚拟机替代项 | **不满足** | **无**「替代项」菜单或等价专页 | **否** |
| VM↔VM 亲和性 | **满足** | 创建向导 + VM 详情调度 | **是** |
| VM↔Host 亲和性 | **满足** | 节点亲和抽屉 + 向导 | **是** |
| 多集群资源隔离 | **满足** | 一池一集群，网络/存储/计算隔离 | **是** |

**统计**：满足 **4** · 部分满足 **1** · 不满足 **4**。

**当前只能 honest 出图 5 项**：计算 DRS、VM↔VM 亲和、VM↔Host 亲和、多集群隔离、集群 HA（部分，需说明范围）。  
**必须开发后才能按标书名目出图 4 项**：五种架构 **创建集群**、**存储 DRS**、**DPM**、**虚拟机替代项**。

---

## 1. 需求原文

> 保持服务器虚拟化的操作习惯，支持创建 x86_64、aarch64、mips64el、loongarch64、sw_64 等架构类型的集群，提供集群 HA 高可用、计算资源 DRS、存储资源 DRS、电源管理 DPM、虚拟机替代项、虚拟机与虚拟机亲和性规则、虚拟机与宿主机亲和规则等虚拟化功能，不同的集群之间的计算、存储、网络资源互相独立。（提供创建集群支持的 5 种架构、HA 高可用、计算 DRS、存储 DRS、DPM、虚拟机替代项、亲和性规则等界面截图）

---

## 2. 总览对照表

| 需求项 | 满足？ | 已有（Tower） | 缺口（需开发） |
|--------|--------|---------------|----------------|
| **创建集群**（x86_64 / aarch64 / mips64el / loongarch64 / sw_64） | 否 | 添加云资源池（纳管 endpoint）；节点 **architecture** 列 | **创建集群**向导/UI，**显式五架构**选项；与安装器/Cloudmap 创建流程打通 |
| **集群 HA** | 部分 | 物理节点 KPI；VM 高可用；PDB；**故障域**；**节点维护模式** | 控制面扩缩仍在安装侧 |
| **计算 DRS** | 是 | DRS 调度：MetricRule CRUD + DRS 迁移记录 | 体验增强：热力图、规则↔告警（非应标硬门槛） |
| **存储 DRS** | 否 | 统一存储、存储类、云盘（**不同条目**） | **存储 DRS** 专页 + 底座 CR/API（规则或策略列表）；**不能**用 Ceph 页顶替 |
| **DPM** | 否 | VM 开/关/重启（**不是 DPM**） | **DPM** 专页 + 策略（集群/节点级节能或底座 DPM CR）；**不能**用 VM 电源或 MAAS 顶替 |
| **虚拟机替代项** | 否 | 无 | **「虚拟机替代项」** 菜单/Tab +  per-VM 覆盖字段（需产品定义 + 底座字段） |
| **VM↔VM 亲和** | 是 | 向导 + 详情 | — |
| **VM↔Host 亲和** | 是 | 节点亲和 + 向导 | — |
| **多集群隔离** | 是 | 多资源池模型 | — |

---

## 3. 分项说明

### 3.1 创建集群（五种 CPU 架构）— **不满足**

**标书要求**：**创建** x86_64、aarch64、mips64el、loongarch64、sw_64 等架构类型的集群。

**已有**：注册已有 Harvester/Cloudmap **资源池**；物理节点展示 `architecture`（常见 amd64/arm64）。

**为何不算满足**：标书写的是 **「创建…集群」** 且要求 **「创建集群支持的 5 种架构…截图」**；「添加资源池」是 **纳管**，不是 **创建**；UI 也未枚举五种架构字符串。

**开发方向（基本能力即可）**：

- Tower 或 CNMC **创建/接入集群** 向导：步骤中含 **架构类型** 下拉（五值与标书一致）。
- 与 Cloudmap 安装器/扩容 API 对接，或跳转安装器并在 Tower 展示创建任务状态。
- 截图：向导中选架构 + 创建成功/集群入池列表。

---

### 3.2 集群 HA 高可用 — **部分满足**

**标书要求**：集群 HA 高可用（未细化子项）。

**已有**：

| 层级 | 入口 |
|------|------|
| 控制面 / etcd | **集群 → 物理节点** KPI：控制面节点、etcd 节点、控制面状态、etcd 状态、etcd 活跃告警；节点详情 etcd 快照 |
| 虚拟机 | VM **高可用设置** |
| 容器 | **PDB** |

| 故障域 | **集群 → 集群资源 → 故障域**：定义机架/可用区/主机级故障域，分配物理节点，同步 label `topology.cloudmap.io/failure-domain` |
| 维护模式 | **集群 → 集群资源 → 物理节点**：预检、阻塞 VM 列表、Force、MaintenanceMode condition 展示；代理 Harvester `maintenancePossible` / `listUnhealthyVM` / `enableMaintenanceMode` / `disableMaintenanceMode` |

**仍缺**：Tower 内控制面扩缩。

**当前可截图**：物理节点 KPI + VM 高可用 + PDB + **故障域** + **维护模式**（进入/退出 + 运维状态列）。

---

### 3.3 计算资源 DRS — **满足**

**标书要求**：计算资源 DRS。

**已有**（**DRS 调度**，`clouds.drs:read/write`）：

- MetricRule 调度规则 CRUD（`metricrules.hms.rivercloud.com`）
- **DRS 迁移记录**（`hci.manager.system/auto-scheduled-fingerprint`）

```http
GET /api/clouds/{cloudId}/resources/harvester/drs/overview?force=true
POST/PUT/DELETE .../drs/metric-rules[/:name]
```

**基本能力认定**：规则 + 自动迁移记录 = 计算 DRS 最小闭环（不要求 vSphere 自动化级别/热力图）。

**截图**：DRS 调度 → 调度规则、DRS 迁移记录。

---

### 3.4 存储资源 DRS — **不满足**

**标书要求**：存储资源 DRS。

**已有**：统一存储、存储类、云盘/卷/快照 — 属于 **存储管理**，**不是**标书条目「存储 DRS」。

**为何不算满足**：界面上 **无**「存储 DRS」或等价存储调度规则/策略模块；不能用统一存储截图冒充。

**开发方向（基本能力即可）**：

- 向 HMS/存储线确认 **Storage DRS** CR 或 API 名称。
- Tower 新建 **存储 DRS** Tab（侧栏与计算 DRS 并列）：规则列表、启用状态、关联存储池/卷策略（字段以底座为准）。
- 截图：该 Tab 列表 + 创建/编辑规则。

---

### 3.5 电源管理 DPM — **不满足**

**标书要求**：电源管理 DPM。

**已有**：VM 开机/关机/重启 — 属于 **虚拟机电源**，**不是 DPM**（分布式电源管理/集群节能策略）。

**为何不算满足**：无 **DPM** 菜单、无 DPM 策略配置；MAAS 裸金属电源 **不能**代表虚拟化 DPM。

**开发方向（基本能力即可）**：

- 确认底座是否有 DPM CR/策略 API。
- Tower **DPM** 专页：策略列表、启用/阈值/作用节点范围（最小字段集）。
- 截图：DPM 策略列表 + 新建策略。

---

### 3.6 虚拟机替代项 — **不满足**

**标书要求**：虚拟机替代项。

**已有**：VM 高可用、亲和性 — **不同条目**，**不能**顶替「替代项」截图。

**为何不算满足**：无 **「虚拟机替代项」** 界面；无 per-VM 覆盖项与标书条目同名的配置入口。

**开发方向（基本能力即可）**：

- 产品定义「替代项」最小字段（如 DRS/HA 例外、固定主机、优先级等，与 Harvester/KubeVirt 扩展对齐）。
- VM 详情或集群侧 **虚拟机替代项** Tab/抽屉：列表 + 编辑。
- 截图：替代项配置界面（标题含「替代项」或与标书一致的产品名）。

---

### 3.7 虚拟机与虚拟机亲和性 — **满足**

创建向导 **亲和性（可选）**；VM 详情 **虚拟机间亲和/反亲和**。截图可直接使用。

---

### 3.8 虚拟机与宿主机亲和性 — **满足**

**节点亲和性** 抽屉；向导 **节点调度**。截图可直接使用。

---

### 3.9 多集群资源互相独立 — **满足**

一 Cloudmap 资源池 = 一集群；计算/存储/网络按池隔离。截图：资源池列表 + 两池网络/存储对比。

---

## 4. 标书截图清单（按真实满足情况）

| # | 标书要求 | 现在能否出图 | 截取位置 |
|---|----------|--------------|----------|
| 1 | 5 种架构 **创建集群** | **否** | 待开发：创建向导 + 架构选择 |
| 2 | HA 高可用 | **部分** | 物理节点 KPI；VM 高可用；PDB；**故障域**；**维护模式** |
| 3 | 计算 DRS | **是** | DRS 调度 |
| 4 | 存储 DRS | **否** | 待开发：存储 DRS 专页 |
| 5 | DPM | **否** | 待开发：DPM 专页 |
| 6 | 虚拟机替代项 | **否** | 待开发：替代项专页 |
| 7 | VM↔VM 亲和 | **是** | 创建向导 / VM 调度 |
| 8 | VM↔Host 亲和 | **是** | 节点亲和抽屉 |
| 9 | 集群隔离 | **是** | 多资源池 + 网络/存储 |

---

## 5. 研发排期（对齐标书条目）

| 优先级 | 条目 | 交付物（基本能力） | 依赖 |
|--------|------|-------------------|------|
| **P0** | 存储 DRS | **存储 DRS** 侧栏 Tab + 规则 CRUD + 列表截图 | 底座 Storage DRS CR/API |
| **P0** | DPM | **DPM** 专页 + 策略 CRUD + 截图 | 底座 DPM CR/API |
| **P0** | 虚拟机替代项 | **替代项** 专页/抽屉 + 最小字段 + 截图 | 产品字段定义 + 底座 |
| **P0** | 创建集群（五架构） | **创建集群**向导 + 五架构枚举 + 截图 | 安装器/Cloudmap 创建 API |
| **P1** | 集群 HA 补全 | **故障域**、**维护模式** 已提供；维护模式若需独立 Tab 可再议 | — |
| **P2** | 计算 DRS 增强 | 热力图、MetricRule↔告警联动 | — |
| **—** | 已满足项 | 计算 DRS、两种亲和、多集群隔离 — **先出截图** | 无 |

**P0 前置**：与 HMS / Cloudmap 研发确认 **存储 DRS、DPM、替代项** 的 CR 组名、字段与 List API，避免 Tower 做空页面。

---

## 6. Tower 代码索引（已实现部分）

| 能力 | 路径 |
|------|------|
| 物理节点 + 控制面 KPI | `frontend/.../cluster/sections/NodesSection.tsx` |
| 控制面 KPI | `frontend/.../cluster/components/ControlPlaneHaKpiRow.tsx` |
| 控制面摘要 | `frontend/.../cluster/lib/controlPlaneHaFromNodes.ts` |
| etcd 告警数 | `frontend/.../cluster/hooks/useEtcdActiveAlertCount.ts` |
| 计算 DRS | `frontend/.../cluster/sections/DrsSection.tsx` |
| 故障域 | `frontend/.../cluster/sections/FailureDomainSection.tsx` |
| 故障域 API | `backend/.../services/clouds/harvester/failureDomainService.ts` |
| 节点维护模式 | `frontend/.../cluster/modals/NodeMaintenanceEnableModal.tsx`、`cluster/lib/nodeMaintenanceStatus.ts` |
| 维护模式 API | `backend/.../services/clouds/harvester/nodeMaintenanceService.ts` |
| MetricRule CR | `backend/.../services/hms/metricRuleCr.ts` |
| VM 高可用 / 调度 | `ecs/drawers/vm-vm-policy/`、`vm-node-scheduling/`、`StepOthersPodAffinity.tsx` |
| 侧栏 DRS | `frontend/src/routes/cloudmapPoolNavRows.ts` |

**待建（文档占位，代码尚无）**：`StorageDrsSection`、`DpmSection`、`VmOverridesSection`、五架构 `CreateClusterWizard` — 路径待实现时写入本节。

---

## 7. 修订记录

| 日期 | 说明 |
|------|------|
| 2026-06-02 | 初稿 + DRS 管理 + 控制面 KPI 并入物理节点 |
| 2026-06-02 | **故障域管理**：集群 Tab + Tower DB + 节点 `topology.cloudmap.io/failure-domain` 标签同步 |
| 2026-06-02 | **节点维护模式**：物理节点预检/阻塞 VM/Force/退出 + Harvester Steve action 代理 |
