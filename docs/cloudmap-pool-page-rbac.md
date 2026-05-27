# Cloudmap 池内页 RBAC（以页面为实体）

> Hub 子文档 · 合入前与新增池内页权限时必读。  
> 入口摘要见 **`AGENTS.md` · 开发规范**；实现落点见下文「源码映射」。

---

## 1. 设计原则

**权限原子以「页面」为实体**，不以底层资源 API、不以全局依赖图为设计中心。

每个 Cloudmap 池内**主页面**（侧栏一片叶子 Tab）在权限上是一张独立卡片，卡片内只描述三类能力：

| 维度 | 含义 | 何时需要「依赖」 |
|------|------|------------------|
| **入口门控** | 用户能否进入该 Tab / 路由 | 仅本页 `poolPageAction:read`（勾选 write 时自动带 read，见 §5） |
| **页面数据展示** | 进页后为渲染 UI 需要读哪些数据 | **仅当**展示需要读**其它业务域**的数据时，在本页下声明**隐式读**；否则**不写任何依赖** |
| **操作功能** | 页内创建 / 编辑 / 删除 / 同步等 | **仅当**操作需要**写其它业务域**时，在本页下声明**跨域写**；否则只用本页 `:write` |

**核心句：没跨域，就不造依赖逻辑。**

禁止：

- 跨页「soft 依赖」、角色抽屉勾选时自动补齐其它 Tab 权限
- 用 `clouds:read` 等超级权限在租户控制台兜底进页
- 把「纯展示页」绑到无关 Tab 的 write 权限（例如机房拓扑布局读节点清单 ≠ `cluster-networks:write`）
- 维护与侧栏无关的 legacy catalog 分组

---

## 2. 页面类型（Taxonomy）

Cloudmap 池内 UI 在权限设计上分为下列类型。**A–D 为授权原子相关**；**E–F 为导航/抽屉归类**；页内普通详情抽屉**不算**独立类型。

| 代号 | 类型 | 有无 `poolPageAction` | 代码 / 配置落点 | 说明 |
|------|------|----------------------|-----------------|------|
| **A** | **Hub 壳** | 无 | `CloudmapPoolNavKey`（如 `resource_hub`、`cluster`、`compute`）；路由 `tab/innerSeg` | 侧栏一级 Tab + 内菜单容器；**本身不是**权限实体，下面挂若干 **B/C** 页面实体 |
| **B** | **页面实体 · 纯展示** | 有 read | `poolPageDisplayOnly: true` | 仅有入口 read；抽屉 checkbox 文案为「只读」；页内无 write 门控 |
| **C** | **页面实体 · 可操作** | 有 read + write | 有 `poolPageAction` 且未标 `displayOnly` | 列表/表单 CRUD；写操作走本页 `:write` 或 `canWritePoolPage` |
| **D** | **附加能力** | 独立 action | `POOL_NAV_GROUP_ATTACHED_PREFIXES`；抽屉 `capabilityKind: 'attached'` | 不进侧栏（创建向导、快捷入口等）；**独立授权**，不随父列表页 write 自动获得 |
| **E** | **分组门控** | 无（非原子） | `useCloudmapPoolPermissions` · `canViewClusterGroup` 等 | 决定侧栏一级 Tab **是否展示**（子页权限 OR）；抽屉**无**对应总卡 |
| **F** | **组内孤儿** | 有，但无侧栏叶 | `buildCloudmapPoolNavDrawerSections` · orphan 输入 | 抽屉有卡、侧栏无叶；**存量兼容**；新功能应避免新增 |

### 2.1 与 §1 三维度的关系

**B/C 才是「页面实体」**，在 §1 中分别填写：入口门控 / 页面数据展示 / 操作功能。

下列为**正交维度**（不单独构成新页面类型）：

| 维度 | 说明 | 示例 |
|------|------|------|
| **展示是否跨域读** | 无 → 不写依赖；有 → 挂在本页 `POOL_PAGE_IMPLIED_READ_BASES` | 集群总览：无；网络拓扑：有 |
| **操作是否跨域写** | 无 → 仅本页 `:write`；有 → 在本页文档与 Section 显式声明 | 机房拓扑写布局：本页 write；不要求 `cluster-networks:write` |
| **License 门控** | 与 B/C 正交；先过 License 再过 RBAC | `kube_ovn` 组 · `network.ovn.vpc` |
| **租户 vs 管理端** | 同一 `poolPageAction`；租户用 `checkPoolPageReadPerm` 更严 | 控制台与池内对齐同一原子 |

### 2.2 不算独立页面类型

| UI 形态 | 权限归属 |
|---------|----------|
| **页内详情抽屉 / 弹窗**（VM 详情、卷详情等） | 继承**父列表页（C）**的 read/write，不单独占原子 |
| **D · 附加能力** | 与上表不同：有**独立** action（如 `clouds.vm-create-wizard:write`） |
| **Cloudmap 池外页面**（设置、租户、SDN 等） | 走 `RouteSpec.requiredActions`，不在本 Taxonomy 内 |

### 2.3 类型对照示例

| 侧栏 | 类型 | 备注 |
|------|------|------|
| 资源总览（一级 Tab） | **A** Hub | 壳 |
| 资源总览 → 集群总览 | **B** | `poolPageDisplayOnly` |
| 资源总览 → 机房拓扑 | **C** | 有 write；展示含跨域读 |
| 资源总览 → 网络拓扑 | **B** | 无 write；展示含跨域读 |
| 弹性计算 → 云主机 | **C** | 标准列表页 |
| 弹性计算 · 创建向导 | **D** | `vm-create-wizard` |
| 集群（一级 Tab 是否可见） | **E** | `canViewClusterGroup` |

---

## 3. 配置与授权面

### 3.1 侧栏 ↔ 抽屉目录

- **侧栏叶子**：`frontend/src/routes/cloudmapPoolNavRows.ts`（`poolNavGroup` / `poolNavSubgroup` / `order`）
- **配置权限抽屉**：`frontend/src/utils/permissionUtils.ts` → `buildCloudmapPoolNavDrawerSections`  
  按侧栏 **12 组 + 二级 subgroup** 生成卡片；**一片侧栏叶子一张卡**，标题 = 侧栏 `title`
- **纯展示页（B）**：`poolPageDisplayOnly: true` → 抽屉只展示「只读」（read），不展示写权限 checkbox

### 3.2 主页面（B/C）vs 附加能力（D）

| 类型 | 配置 | 说明 |
|------|------|------|
| **主页面（B/C）** | `poolPageAction` | 侧栏叶子 Tab；一片叶子一张抽屉卡 |
| **附加能力（D）** | 独立 action（如 `vm-create-wizard`） | 抽屉单独一张卡；排在**同组无 subgroup 主页面之后**、**二级 subgroup（如「高级配置」）之前**；不污染主列表页 write |

### 3.3 容器服务 · orphan（F 存量）

无侧栏叶、挂在 **`容器服务`** 分组下的 prefix（`POOL_NAV_GROUP_ORPHAN_PREFIXES`）：

- `clouds.containers`（K8s 总权）
- `clouds.cluster-services`（K8s Service；**不属于「集群」抽屉分组**）
- `harbor.registry` / `harbor.project` / `harbor.image` / `harbor.scan`（Harbor 镜像仓；**CNMC · 容器业务域**，非独立 HARBOR 平台 Tab）

后端 `getPlatformByPermission('harbor.*')` → `CNMC`；`getGroupByPermission` → `Cloudmap资源池`（抽屉仍按侧栏 `poolNavGroup` 展示）。

后端权限原子：`backend/src/constants/permissions.ts`、`backend/src/permissions/definitions.ts`；API 映射：`backend/src/permissions/registry.ts`。

---

## 4. 运行时门控（唯一落点）

**前端**：`frontend/src/pages/cnmc/clouds/Cloudmap/pool/lib/poolPageReadAccess.ts`

| 函数 | 用途 |
|------|------|
| `canAccessPoolPage` | 管理端 / 池内：能否进入某叶子页 |
| `canWritePoolPage` | 页内写操作；`poolPageDisplayOnly` 页恒 false |
| `checkPoolPageReadPerm` | **租户控制台**严格读（不用 `clouds:read` 兜底） |
| `expandRoleGrantOnCheck` | 角色抽屉：勾选 write 时自动带上同资源 read |

**后端**：`backend/src/permissions/checker.ts` + `backend/src/constants/poolPageImpliedReads.ts`

页 token 隐式读清单 **`POOL_PAGE_IMPLIED_READ_BASES`** 须前后端内容一致（注释互指）。

**前端镜像**：`frontend/src/utils/accessMapping.ts` 循环 `POOL_PAGE_IMPLIED_READ_BASES`，勿再内联重复 Set。

---

## 5. 角色勾选约定

仅保留一种自动规则：**write → read**（`expandRoleGrantOnCheck`）。

不自动补齐：

- 跨 Tab read（例如勾「虚拟机」不自动勾「镜像」）
- 跨页「依赖链」
- 页顶「你还缺某某权限」提示

运维授權：用户要能进某页，须在抽屉里显式勾选该页的 read（或 write）。

---

## 6. 样板：资源总览（`resource_hub`）

资源总览是 **A · Hub 壳**，内含三个 **B/C 页面实体**（各有一张权限卡片）：

### 6.1 集群总览（B · 纯展示）

| 维度 | 内容 |
|------|------|
| 入口 | `clouds.monitoring.overview:read` |
| 展示 | 监控聚合；**无跨域读依赖**（`poolPageDisplayOnly: true`） |
| 操作 | 无写操作 |

### 6.2 机房拓扑（C · 可操作）

| 维度 | 内容 |
|------|------|
| 入口 | `clouds.dc-topology:read` |
| 展示 | 机柜布局只读视图；选节点/交换机清单需**本页隐式读**：`cluster-nodes`、`cluster-networks`（见 `POOL_PAGE_IMPLIED_READ_BASES['clouds.dc-topology']`） |
| 操作 | `clouds.dc-topology:write`（机柜 / 插板等）；**不**要求 `cluster-networks:write` |

池层加载：`loaders/pathResource/resourceHubPathLoads.ts` · `datacenter_topology`（ASW 同步 `skipSync: true`）。

Section 写门控：`Harvester/hsm/sections/DatacenterTopologySection.tsx` → `canWritePoolPage(..., 'resource_hub/datacenter_topology')`。

### 6.3 网络拓扑（B · 纯展示 + 跨域读）

| 维度 | 内容 |
|------|------|
| 入口 | `clouds.net-topology:read`（`canViewNetworkTopology` / `canAccessPoolPage`） |
| 展示 | 拓扑图需**本页隐式读**：物理网络、集群网络、VLAN、节点、公共子网、NAD 等（见 `POOL_PAGE_IMPLIED_READ_BASES['clouds.net-topology']`） |
| 操作 | 无写操作（`poolPageDisplayOnly: true`） |

**不要**用集群 Tab 的 `canReadNetworkScope`（VPC/扁平/物理网络等聚合布尔）作为网络拓扑进门条件；进门只认本页 token。

---

## 7. 新增 / 改造池内页检查清单

1. **定类型**：A 壳 / B 纯展示 / C 可操作 / D 附加能力（见 §2）；新功能避免 F 孤儿
2. **`cloudmapPoolNavRows`**：B/C 补 `poolPageAction`；B 则 `poolPageDisplayOnly: true`
3. **后端**：`permissions.ts` / `definitions.ts` / `registry.ts` 注册原子与 API 映射
4. **入口**：路由 / 侧栏 / Section 用 `canAccessPoolPage` 或 `checkPoolPageReadPerm`（租户）
5. **跨域读**：若有，写入 `POOL_PAGE_IMPLIED_READ_BASES`（前后端同步）；若无，**不要**加项
6. **跨域写**：若有，文档化并在 Section 显式 `checkPerm`；若无，仅 `canWritePoolPage` 或主页面 write
7. **抽屉**：确认 `buildCloudmapPoolNavDrawerSections` 能生成对应卡片（group/subgroup 与侧栏一致）
8. **自测**：仅授本页 read 能否进页；仅授本页 read 能否看到该看的数；未授其它 Tab 不应因「自动补齐」而出现

---

## 8. 源码映射（速查）

| 职责 | 路径 |
|------|------|
| 页配置（入口 action） | `frontend/src/routes/cloudmapPoolNavRows.ts` |
| 运行时门控 | `frontend/src/pages/cnmc/clouds/Cloudmap/pool/lib/poolPageReadAccess.ts` |
| 隐式读（前端） | 同上 `POOL_PAGE_IMPLIED_READ_BASES` + `accessMapping.ts` |
| 隐式读（后端） | `backend/src/constants/poolPageImpliedReads.ts` + `checker.ts` |
| 附加能力（D）配置 | `frontend/src/utils/permissionUtils.ts` · `POOL_NAV_GROUP_ATTACHED_PREFIXES` |
| 分组门控（E） | `frontend/src/pages/cnmc/clouds/Cloudmap/pool/hooks/useCloudmapPoolPermissions.ts` |
| 权限抽屉 UI | `frontend/src/pages/settings/Roles/components/RolePermissionDrawer.tsx` |
| 池层 Tab 加载 | `frontend/src/pages/cnmc/clouds/Cloudmap/pool/loaders/` |
| 池刷新约定 | `frontend/src/pages/cnmc/clouds/Cloudmap/pool/README.md` |

---

## 9. 与其它 RBAC 的关系

- **RouteSpec / 平台级**：控制台、设置等非 Cloudmap 池内页，仍用 `RouteSpec.requiredActions`
- **CNMC 平台页**（`/admin/dashboard` **多云总览**、`/admin/clouds` 资源池列表）：权限分组「**多云管理**」；`clouds.dashboard:read` 抽屉展示名为「多云总览」
- **租户控制台**（`/console`）：权限分组「**租户控制台**」；`clouds.console:*` 在角色抽屉中为独立业务域，**不**与「多云管理」合并
- **Cloudmap 池内 Tab**：权限分组「**Cloudmap资源池**」；抽屉按侧栏 `poolNavGroup`（资源总览、集群、弹性计算…）展示
- **VM 创建向导等附加能力（D）**：独立 action；其跨域读（镜像、NAD、节点等）在 **checker 4c** 单独维护，**不**并入池内页通用依赖表
- **Harvester 云详情（非 Cloudmap 池）**：Section 级权限逐步对齐同一「页面实体」心智，但以各自 Tab 的 `RouteSpec` 为准
