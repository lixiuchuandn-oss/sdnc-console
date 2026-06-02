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

| 标书能力项       | 是否满足     | 现状                                                        | 能否按标书名目截图                                               |
| ---------------- | ------------ | ----------------------------------------------------------- | ---------------------------------------------------------------- |
| 创建五种架构集群 | **不满足**   | 仅资源池 **注册**已有集群；节点可读架构（多为 amd64/arm64） | **否**（缺「创建集群 + 五架构选择」界面）                        |
| 集群 HA 高可用   | **满足**     | 物理节点 KPI；VM 高可用；PDB；**故障域**；**节点维护模式**  | **是**（控制面扩缩在安装侧，不纳入应标范围）                   |
| 计算资源 DRS     | **满足**     | DRS 调度：MetricRule + DRS 迁移记录                         | **是**                                                           |
| 存储资源 DRS     | **不满足**   | 有 Ceph/云盘管理；**SDRS 方案已定**（RBD migration + 自研引擎，§3.4） | **否**（待开发 §3.4 五页）                                       |
| 电源管理 DPM     | **不满足**   | 仅有 VM 电源操作，**无** DPM 策略/界面                      | **否**                                                           |
| 虚拟机替代项     | **不满足**   | **无**「替代项」菜单或等价专页                              | **否**                                                           |
| VM↔VM 亲和性     | **满足**     | 创建向导 + VM 详情调度                                      | **是**                                                           |
| VM↔Host 亲和性   | **满足**     | 节点亲和抽屉 + 向导                                         | **是**                                                           |
| 多集群资源隔离   | **满足**     | 一池一集群，网络/存储/计算隔离                              | **是**                                                           |

**统计**：满足 **5** · 部分满足 **0** · 不满足 **4**。

**当前可 honest 出图 6 项**：集群 HA、计算 DRS、VM↔VM 亲和、VM↔Host 亲和、多集群隔离。  
**必须开发后才能按标书名目出图 4 项**：五种架构 **创建集群**、**存储 DRS**、**DPM**、**虚拟机替代项**。

---

## 1. 需求原文

> 保持服务器虚拟化的操作习惯，支持创建 x86_64、aarch64、mips64el、loongarch64、sw_64 等架构类型的集群，提供集群 HA 高可用、计算资源 DRS、存储资源 DRS、电源管理 DPM、虚拟机替代项、虚拟机与虚拟机亲和性规则、虚拟机与宿主机亲和规则等虚拟化功能，不同的集群之间的计算、存储、网络资源互相独立。（提供创建集群支持的 5 种架构、HA 高可用、计算 DRS、存储 DRS、DPM、虚拟机替代项、亲和性规则等界面截图）

---

## 2. 总览对照表

| 需求项                                                            | 满足？ | 已有（Tower）                                              | 缺口（需开发）                                                                      |
| ----------------------------------------------------------------- | ------ | ---------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| **创建集群**（x86_64 / aarch64 / mips64el / loongarch64 / sw_64） | 否     | 添加云资源池（纳管 endpoint）；节点 **architecture** 列    | **创建集群**向导/UI，**显式五架构**选项；与安装器/Cloudmap 创建流程打通             |
| **集群 HA**                                                       | 是     | 物理节点 KPI；VM 高可用；PDB；**故障域**；**节点维护模式** | 控制面扩缩在安装侧（**不纳入应标**）；可选增强：独立 HA 总览 Tab                    |
| **计算 DRS**                                                      | 是     | DRS 调度：MetricRule CRUD + DRS 迁移记录                   | 体验增强：热力图、规则↔告警（非应标硬门槛）                                         |
| **存储 DRS（SDRS）**                                              | 否     | Ceph Pool/RBD、云盘；Balancer 仅 OSD 层                       | **§3.4 四层方案**：SDRS 引擎 + `rbd migration` + 存储 DRS 专页（待开发）           |
| **DPM**                                                           | 否     | VM 开/关/重启（**不是 DPM**）                              | **DPM** 专页 + 策略（集群/节点级节能或底座 DPM CR）；**不能**用 VM 电源或 MAAS 顶替 |
| **虚拟机替代项**                                                  | 否     | 无                                                         | **「虚拟机替代项」** 菜单/Tab + per-VM 覆盖字段（需产品定义 + 底座字段）            |
| **VM↔VM 亲和**                                                    | 是     | 向导 + 详情                                                | —                                                                                   |
| **VM↔Host 亲和**                                                  | 是     | 节点亲和 + 向导                                            | —                                                                                   |
| **多集群隔离**                                                    | 是     | 多资源池模型                                               | —                                                                                   |

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

### 3.2 集群 HA 高可用 — **满足**

**标书要求**：集群 HA 高可用（未细化子项）。

**已有**：

| 层级          | 入口                                                                                                     |
| ------------- | -------------------------------------------------------------------------------------------------------- |
| 控制面 / etcd | **集群 → 物理节点** KPI：控制面节点、etcd 节点、控制面状态、etcd 状态、etcd 活跃告警；节点详情 etcd 快照 |
| 虚拟机        | VM **高可用设置**                                                                                        |
| 容器          | **PDB**                                                                                                  |
| 故障域        | **集群 → 集群资源 → 故障域**：定义机架/可用区/主机级故障域，分配物理节点，同步 label `topology.cloudmap.io/failure-domain` |
| 维护模式      | **集群 → 集群资源 → 物理节点**：预检、阻塞 VM 列表、Force、MaintenanceMode condition 展示；代理 Harvester `maintenancePossible` / `listUnhealthyVM` / `enableMaintenanceMode` / `disableMaintenanceMode` |

**应标认定**：标书未要求 Tower 内 **创建/扩缩控制面节点**；控制面 HA **观测 + 虚拟机/容器 HA + 故障域 + 维护模式** 已构成集群 HA 基本闭环，**按满足验收**。

**不在应标范围**：控制面节点扩缩（Cloudmap 安装/运维侧完成即可）。

**截图建议**：物理节点 KPI + **故障域** + **维护模式**；辅以 VM 高可用设置或 PDB 任一即可。

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

### 3.4 存储资源 DRS（SDRS）— **不满足**（拟定方案已明确）

**标书要求**：存储资源 DRS（业界常称 **SDRS**，Storage DRS）。

**已有**：统一存储、Ceph Pool/RBD 管理、云盘/卷/快照 — 属于 **存储资源管理**；Ceph **Balancer** 仅做 **PG/OSD 层**均衡，**不识别虚拟机 RBD 磁盘**，**不能**顶替 SDRS。

**为何不算满足**：Tower 尚无 **「存储 DRS / SDRS」** 专页、调度引擎与迁移任务链；不能用 Ceph Dashboard 或云盘列表截图冒充。

---

#### 产品方案描述（标书 / 白皮书可直接引用）

平台提供 **存储动态资源调度（SDRS）**，与计算 DRS 并列，面向 **虚拟机磁盘** 而非 PG。底层依托 **Ceph 原生 RBD 能力**（不改 Ceph 源码）：**Ceph Balancer** 在 OSD 层自动均衡容量；**平台自研 SDRS 调度引擎** 以 **RBD 单盘** 为粒度，根据容量、IO 与维护事件，调用 **`rbd migration` 在线热迁移**（Ceph Quincy+ / Squid+）将虚机磁盘在同 Pool 或跨 Pool（如 SSD/HDD 分层）间搬迁，实现 **不停机迁盘**。用户可在虚拟化界面配置 SDRS 总开关、手动/半自动/全自动模式、容量与性能阈值、磁盘亲和/反亲和规则，并查看迁移任务与触发原因。**适用范围**：Rook-Ceph **RBD 云盘**；Longhorn 等非 RBD 后端不在本方案内。

**与 Ceph Balancer 区分**：Balancer = PG 颗粒度、整集群 OSD 均衡；SDRS = **RBD（虚机磁盘）颗粒度**、面向业务调度，二者并行、互不替代。

---

#### 落地实现（四层）

**第一层 — Ceph 原生底座（不改源码）**

| 能力 | 作用 |
| ---- | ---- |
| **RBD live-migration** | SDRS 单盘迁移核心：`prepare` → `execute` → `commit`；同 Pool 调整 OSD 分布，跨 Pool 做 SSD/HDD 分层 |
| **CRUSH + 多 Pool 分层** | SSD 高性能池 / HDD 容量池 / 归档池；新建盘绑定指定 Pool = 「磁盘只能放某类存储」 |
| **MGR 监控导出** | OSD 使用率、IOPS/延迟、Pool 占用 — SDRS 决策数据源；**不依赖 Balancer 做虚机迁盘** |

```bash
# 平台后端封装示例（单 RBD 热迁）
rbd migration prepare pool1/vmdisk pool2/vmdisk
rbd migration execute pool2/vmdisk
rbd migration commit pool2/vmdisk
```

**第二层 — 平台 SDRS 调度引擎（Tower 自研）**

| 模式 | 说明 |
| ---- | ---- |
| **手动** | 选中 VM → 选择磁盘 → 目标 Pool → 调用 RBD migration |
| **半自动** | 引擎给出优化建议，管理员一键批量执行 |
| **全自动** | 定时巡检，超阈值自动生成并执行迁移任务 |

**可配置阈值（界面）**：OSD 使用率 &gt; 85%；OSD 平均 IO 延迟 &gt; 20ms 或 IOPS 饱和；宿主机/磁盘 **维护模式** 时批量迁出该节点上全部 VM RBD。

**亲和/反亲和**：磁盘亲和 — 同业务多 VM 盘固定同一 Pool/OSD 域；磁盘反亲和 — 主备库盘不得同 OSD/机架（新建 + 迁移时避让）。

**第三层 — 执行链路**

1. 界面开启集群 SDRS、配置阈值与亲和规则  
2. 引擎定时拉取 Ceph OSD/Pool 指标，映射 **PVC/PV → RBD image → 所属 VM**  
3. 筛选待迁 RBD，生成任务（原因、源/目标 Pool）  
4. 后端调用 `rbd migration`（及必要的 KubeVirt/PVC 元数据同步）  
5. 任务落库，前端 **SDRS 任务日志** 展示迁盘记录  

**第四层 — 产品界面（应标截图点位）**

| # | 页面 | 说明 |
| - | ---- | ---- |
| 1 | **存储 DRS 总开关** | 集群 → 存储 DRS：自动/手动、空间/性能阈值 |
| 2 | **存储资源池** | 对接 Ceph 多 Pool（SSD/HDD 等） |
| 3 | **存储亲和规则** | 磁盘亲和 / 反亲和策略 |
| 4 | **SDRS 任务日志** | 迁移记录、触发原因、前后 Pool |
| 5 | **Ceph Dashboard（配套）** | OSD 使用率、RBD 列表、Pool 管理 — **辅助证明底座能力，不能单独顶替 SDRS 页** |

**Tower 待建**：`StorageDrsSection`、SDRS 策略/任务 API、`backend/.../sdrs/`（RBD migration 封装 + Ceph 指标采集）— 实现后更新 §6 索引。

**MVP 建议**：先做 **手动 + 任务日志 + 离线/热迁单盘**，再迭代全自动与亲和规则。

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

| #   | 标书要求              | 现在能否出图 | 截取位置                                               |
| --- | --------------------- | ------------ | ------------------------------------------------------ |
| 1   | 5 种架构 **创建集群** | **否**       | 待开发：创建向导 + 架构选择                            |
| 2   | HA 高可用             | **是**       | 物理节点 KPI；**故障域**；**维护模式**；VM 高可用 / PDB |
| 3   | 计算 DRS              | **是**       | DRS 调度                                               |
| 4   | 存储 DRS（SDRS）      | **否**       | 待开发：§3.4 五页（总开关 / Pool / 亲和 / 任务日志 + Ceph 配套） |
| 5   | DPM                   | **否**       | 待开发：DPM 专页                                       |
| 6   | 虚拟机替代项          | **否**       | 待开发：替代项专页                                     |
| 7   | VM↔VM 亲和            | **是**       | 创建向导 / VM 调度                                     |
| 8   | VM↔Host 亲和          | **是**       | 节点亲和抽屉                                           |
| 9   | 集群隔离              | **是**       | 多资源池 + 网络/存储                                   |

---

## 5. 研发排期（对齐标书条目）

| 优先级 | 条目               | 交付物（基本能力）                                           | 依赖                     |
| ------ | ------------------ | ------------------------------------------------------------ | ------------------------ |
| **P0** | 存储 DRS（SDRS）   | §3.4 四层方案：**SDRS 引擎** + `rbd migration` 封装 + 4 个自研 Tab + 任务日志 | Ceph Quincy+/Squid+；Rook RBD 卷；Prometheus/MGR 指标 |
| **P0** | DPM                | **DPM** 专页 + 策略 CRUD + 截图                              | 底座 DPM CR/API          |
| **P0** | 虚拟机替代项       | **替代项** 专页/抽屉 + 最小字段 + 截图                       | 产品字段定义 + 底座      |
| **P0** | 创建集群（五架构） | **创建集群**向导 + 五架构枚举 + 截图                         | 安装器/Cloudmap 创建 API |
| **P2** | 计算 DRS 增强      | 热力图、MetricRule↔告警联动                                  | —                        |
| **—**  | 已满足项           | **集群 HA**、计算 DRS、两种亲和、多集群隔离 — **先出截图**   | 无                       |

**P0 前置**：**存储 SDRS** — 确认集群 Ceph 版本支持 RBD migration、VM 系统/数据盘为 Rook RBD PVC；**DPM / 替代项** — 仍须产品字段与底座 API 对齐。

---

## 6. Tower 代码索引（已实现部分）

| 能力                  | 路径                                                                                                 |
| --------------------- | ---------------------------------------------------------------------------------------------------- |
| 物理节点 + 控制面 KPI | `frontend/.../cluster/sections/NodesSection.tsx`                                                     |
| 控制面 KPI            | `frontend/.../cluster/components/ControlPlaneHaKpiRow.tsx`                                           |
| 控制面摘要            | `frontend/.../cluster/lib/controlPlaneHaFromNodes.ts`                                                |
| etcd 告警数           | `frontend/.../cluster/hooks/useEtcdActiveAlertCount.ts`                                              |
| 计算 DRS              | `frontend/.../cluster/sections/DrsSection.tsx`                                                       |
| 故障域                | `frontend/.../cluster/sections/FailureDomainSection.tsx`                                             |
| 故障域 API            | `backend/.../services/clouds/harvester/failureDomainService.ts`                                      |
| 节点维护模式          | `frontend/.../cluster/modals/NodeMaintenanceEnableModal.tsx`、`cluster/lib/nodeMaintenanceStatus.ts` |
| 维护模式 API          | `backend/.../services/clouds/harvester/nodeMaintenanceService.ts`                                    |
| MetricRule CR         | `backend/.../services/hms/metricRuleCr.ts`                                                           |
| VM 高可用 / 调度      | `ecs/drawers/vm-vm-policy/`、`vm-node-scheduling/`、`StepOthersPodAffinity.tsx`                      |
| 侧栏 DRS              | `frontend/src/routes/cloudmapPoolNavRows.ts`                                                         |

**待建（§3.4 SDRS）**：`StorageDrsSection`、SDRS 策略/任务/亲和 API、`sdrsRbdMigration` 服务 — 路径待实现时写入本节。  
**待建（其它）**：`DpmSection`、`VmSubstituteSection`、五架构 `CreateClusterWizard`。

---

## 7. 修订记录

| 日期       | 说明                                                                                      |
| ---------- | ----------------------------------------------------------------------------------------- |
| 2026-06-02 | 初稿 + DRS 管理 + 控制面 KPI 并入物理节点                                                 |
| 2026-06-02 | **故障域管理**：集群 Tab + Tower DB + 节点 `topology.cloudmap.io/failure-domain` 标签同步 |
| 2026-06-02 | **节点维护模式**：物理节点预检/阻塞 VM/Force/退出 + Harvester Steve action 代理           |
| 2026-06-02 | **集群 HA**：产品认定已满足应标；控制面扩缩不纳入 Tower 应标范围                            |
| 2026-06-02 | **存储 SDRS**：§3.4 写入基于 Ceph RBD migration 的四层落地方案与标书文案                  |
