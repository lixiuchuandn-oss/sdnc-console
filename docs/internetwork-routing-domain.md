# 网际路由域与 CSM 安全域 — 产品边界与联动规格

> **状态**：架构共识（2026-06 定稿；导航 IA 目标 2026-06 增补）  
> **适用范围**：SDNCC 导航与信息架构 · 网际路由域 · IBR · CSM 管理 · 租户恢复 · 邻居/服务链引流  
> **代码映射（内部名，暂未改表）**：`SecurityDomain` / `security_domains` / `/api/security-domains`  
> **UI 名称**：**网际路由域**（Tower）；**CSM 安全域**（CSM 能力池侧，界面须带前缀）

---

## 1. 为什么需要两个名字

历史上 Tower 与 CSM 均使用「安全域」，但语义不同：

| 维度 | CSM 安全域 | Tower 网际路由域 |
|------|------------|------------------|
| **租户** | `orgId` / 租户分页中的组织 | Tower `Tenant` + `Organization`（可从 CSM 恢复对齐 `csmOrgId`） |
| **域** | 防护对象 + 网元 + 服务链的**逻辑包** | VR + 防护目标网络 + 引流/级联/服务链的**作用范围** |
| **创建入口** | CSM 控制台 / CSM 能力池 Tab | SDNCC「网际路由域」、服务链 VR 引流 |

**原则**：界面与文档中避免单独使用泛称「安全域」；必须写 **网际路由域** 或 **CSM 安全域**。

**下游对接**：VR / SASE 网关研发请参阅 **[vr-sase-downstream-notice.md](./vr-sase-downstream-notice.md)**（更名通知、API 不变项、术语对照）。

---

## 2. 网际路由域的定义（Tower）

网际路由域是 Tower 在跨域互联能力之上的**编排与资产锚点**，由四部分组成：

```
网际路由域 = VR（互联 / 引流锚点）
           + 防护目标网络（云 VPC 或线下 IDC / 扁平网等）
           + 该网络内可发现的 Guest OS 实体（资产台账）
           +（可选）关联的 CSM 安全域（安全能力包）
```

### 2.1 VR

- 跨域互联、南北/东西向引流、**邻居**（原级联通道）挂载的锚点。
- 线下 IDC 场景下，VR 还可作为**扫描探针**所在侧（与 SASE/VR 发现链路配合）。
- **身份与云主机锚点**：编排侧用 CSM **`uuid`**（Tower `vrUuid`）；云侧落在哪台 ECS/VM 用 **`vm_id`**（运维在 VR 本地界面维护，见 §16、§17）。二者不可混用。

### 2.2 防护目标网络

- **云上**：绑定资源池 + VPC（或等价云网络对象），CIDR 来自云侧权威数据。
- **线下**：扁平网 / IDC 等，以录入 CIDR 为边界（`category` 中 `flat:*` 等，见 `securityDomainKind`）。

**权威在 Tower**：不是 CSM 控制台里单独维护的抽象网段 alone。

### 2.3 资产发现（Guest OS 台账）

在同一片防护目标网络内，发现所有可作为防护目标的 **Guest OS 实体**：

| 场景 | 发现方式 | 仓库内参考 |
|------|----------|------------|
| 云 VPC 等 | 多云 / 资源池 **API 同步**（VM、网卡、归属关系） | 云实例库存、`cloudId` / `vpcId` 关联 |
| 线下 IDC 等 | **VR 扫描 / 网关上报告** | `SASEDiscoveredAsset`、`domainId` + `vrUuid` + `os` 等 |

发现结果归属网际路由域（`domainId`），形成**资产台账**。

### 2.4 关联 CSM 安全域

- 不替代 VR 与网络定义。
- 为同租户下的业务提供 **网元 + 服务链** 等安全能力（见 §4）。

---

## 3. 三块管理能力

| 能力 | 主责 | 说明 |
|------|------|------|
| **资产台账** | Tower 网际路由域 | 云 API + VR 扫描 → Guest OS；统一在网际路由域下展示 |
| **通信管理** | Tower 网际路由域 + SDN | IBR（VR）、邻居、服务链引流、ACL/NAT/SRv6 等；作用范围 = 网际路由域 |
| **安全管理** | CSM 安全域（经 Tower **关联**） | 防护对象、网元、服务链；策略下发与 SSO 走 CSM 池 / BFF |

**一句话**：Tower 管「这片网里有什么、流量怎么走」；CSM 管「这片网怎么防」；**网际路由域**是把两者钉在同一片网络上的枢纽。

---

## 4. CSM 安全域与「防护对象」对齐（硬约束）

CSM 安全域是能力池内的**逻辑聚合**：

- **防护对象** — 策略所保护的目标
- **网元（安全服务）** — 防火墙、WAF 等实例 / 组
- **服务链** — 流量过哪些安全能力

### 4.1 防护对象 = 网际路由域防护目标网络的 CSM 侧投影

**CSM 里的「防护对象」必须与 Tower 网际路由域的「防护目标网络」一致。**

| 侧 | 含义 | 权威来源 |
|----|------|----------|
| Tower 网际路由域 | VR + 可发现的那片网 + Guest OS 台账 | **Tower 权威**（云 API、VR 扫描） |
| CSM 防护对象 | CSM 策略里「保护谁」 | **应由 Tower 推导 / 同步**，不应与 Tower 台账长期脱节 |

- CSM `networkCidrs`、防护对象列表：理想状态是「**这片网在 CSM 里长什么样**」。
- 「**这片网实际是什么**」以 Tower 发现为准；发现增量应能 **diff 同步** 到 CSM 防护对象（实现分阶段，见 §8）。

### 4.2 网元 + 服务链

- 仍在 **CSM 安全域** 内编排（CSM 控制台或 Tower BFF 代发）。
- Tower 网际路由域提供 **VR 引流锚点** 与 **租户 / 池上下文**；防护对象已与该片网对齐后，策略才落在正确目标上。

---

## 5. 租户联动

- CSM 租户标识：`orgId`（租户分页、安全域上的 `orgId`）。
- Tower：`Tenant` + `Organization`；CSM 恢复时使用稳定 ID 映射（见 `backend/src/services/tenants/csmStableIds.ts`）。
- **创建网际路由域**：先选 Tower 租户 / 组织 → 仅允许关联 **同一 `csmOrgId`** 下的 CSM 安全域。
- CSM 安全域与网际路由域是 **关联关系**，不是同一生命周期下的同一对象。

**关联关系（已定稿）**：

- **严格 1 : 1**：一个网际路由域**仅能**关联**一个** CSM 安全域。
- 创建/编辑表单为**单选**；数据模型用单一字段（如 `linkedCsmSecurityDomainId`），**不**提供 1:N 多域切换 UI。
- 若未来业务需要 1:N，须单独立项修订本文，不得在未改规格前隐式扩展。

---

## 6. 创建网际路由域（目标流程）

推荐顺序（与当前表单能力逐步对齐）：

1. **归属**：Tower 租户 + 组织（具备 `csmOrgId` 时可联动 CSM）。
2. **网络类型**：云 VPC（资源池 + VPC）或 IDC / 扁平网（CIDR + 分类）。
3. **绑定 VR**（网际路由域核心条件之一）。
4. **发现**：触发云同步或 VR 扫描 → Guest OS 台账写入本网际路由域。
5. **关联 CSM 安全域**（要做安全时必选，**单选 1:1**）：从该租户在 CSM 池下的列表择一；可用 CSM `networkCidrs` 作**初值建议**，以 Tower CIDR / 发现结果校验或覆盖。
6. **同步防护对象**（目标能力）：将 Tower 防护目标网络（CIDR ± 资产摘要）写入 CSM 防护对象。
7. **通信编排**：服务链、邻居挂载等在**已创建的网际路由域**上操作。

**两条入口（体验）**：

- 从「网际路由域」新建：租户 → 网络 + VR → 发现 → 选 CSM 安全域 → 同步防护对象。
- 从 CSM 池「CSM 安全域」：**创建网际路由域并关联** — 预填租户、`csmOrgId`、CSM 域 ID，用户补 VR / 发现。

---

## 7. 产品规则（实现须遵守）

1. **没有 VR + 防护网络边界（及发现能力）的，不算完整网际路由域**；仅 CSM 同步下来的行默认视为 **CSM 镜像**，不可直接用于邻居挂载 / 服务链 VR 引流，除非用户完成「提升为网际路由域」。
2. **防护对象权威**：网际路由域防护目标网络（含发现）> CSM 抽象网段。
3. **关联 CSM 安全域时**：`csmOrgId` 必须与网际路由域租户一致；**至多关联一个** CSM 安全域（1:1）。
4. **Guest OS 台账在 Tower**；CSM 防护对象可为 CIDR + 资产引用，不必在 CSM 维护完整 CMDB。
5. **网元 + 服务链** 以 CSM 为编排面；Tower 展示关联状态、引流状态，必要时 BFF 代发。
6. **禁止**将 CSM 租户恢复产出的 CSM 安全域数据**直接等同**为已就绪的网际路由域（无 VR、无发现即不可编排）。

---

## 8. 与当前实现的差距（研发 backlog）

| 现状 | 目标 |
|------|------|
| `csmTenantRepair` 将 CSM 安全域写入 `security_domains`，ID 与 CSM `domainId` 稳定映射 | CSM 安全域 → **镜像 / 只读缓存** 或带 `kind=csm_mirror`；与 **网际路由域** 分型 |
| 创建网际路由域表单无 CSM 安全域选择、无「同步防护对象」 | 租户 → CSM 安全域关联 → 防护对象同步 |
| 资产发现在应用 / 服务链等入口分散 | 网际路由域详情固定 **资产台账** Tab（云 + VR） |
| 服务链有顶层菜单 / 独立向导入口 | **取消顶层**；服务链仅作为网际路由域详情 → **CSM 安全域** → 服务链子 Tab |
| 服务链 `steeringMode=direct` 直连 CSM 资产 | 保留能力；入口收敛到安全域子 Tab，不在导航抬高层级 |

### 建议分期

| 阶段 | 内容 |
|------|------|
| **一期** | 类型字段区分 `internetwork_routing` / `csm_mirror`；创建表单增加租户下 CSM 安全域**单选**（1:1）；保存 `linkedCsmSecurityDomainId`、`csmOrgId`、`csmCloudId` |
| **二期** | 保存 / 刷新时调用 CSM 防护对象 API，用 Tower `cidr`（及资产摘要）写入 CSM |
| **三期** | 云同步 / VR 扫描增量 → 自动 diff 同步 CSM 防护对象；CSM 侧重命名冲突告警 |
| **VR 推荐绑定** | 创建网际路由域时按所选网络推荐 `vrUuid`（§16）；`GET /api/security-domains/suggest-vr`（已落地） |

### 8.1 实现状态快照（2026-06）

| 项 | 状态 | 说明 |
|----|------|------|
| 导航三组 IA（IA-1 / IA-1b 首期） | 已落地 | `RouteSpec`、`cross-domain/`、`ibr/`、`csm/` |
| 详情 Tab 重组 + IBR 复用 Section（IA-2 首期） | 已落地 | `internetwork-routing/Detail`；IBR 五子 Tab 嵌入 `ibr/*` + `scopedVrUuid` |
| `roleKind` / CSM 1:1 表单（IA-4 首期） | 已落地 | 创建表单、镜像提升、防护对象 Tab 首期 |
| CSM 安全服务跨池 KPI（IA-3 首期） | 已落地 | `csm/security-services` |
| CSM 域内元素投影（防护对象/安全服务/服务链） | **已落地** | `csmSecurityDomainProjection`；废弃 `securityServiceIds` 与本地服务链聚合 |
| CSM 防护对象二期同步 | 待做 | 保存/刷新写回 CSM |
| 创建时 VR 智能推荐（§16） | **已落地** | `suggest-vr` BFF + 表单推荐分组（`suggestVrForSecurityDomain`） |
| 邻居 / 应用详情与全局页深度联动 | 部分 | 仍有占位与旧 path |
| Tab 角标与实时 IBR 列表对齐 | 待优化 | 角标仍可读域实体聚合字段 |
| `CSMCTL_ADDRESS` 未配置 | 环境依赖 | VR 缓存为空时无法推荐 VR |
| 旧 `sec-mgr-plane/` barrel | 迁移中 | 新功能只落 `cross-domain/` / `ibr/` / `csm/` |

---

## 9. 数据模型（目标字段，可与现表渐进融合）

**网际路由域**（现 `security_domains`）建议显式字段：

| 字段 | 说明 |
|------|------|
| `kind` | `internetwork_routing` \| `csm_mirror` |
| `vrUuid` / VR 相关 | 引流与 IDC 扫描锚点；`vrUuid` = CSM/控制面 **uuid**（§18.1） |
| `vrInstanceIds` | 云厂商 **实例 ID**（如阿里云 `i-xxx`）；应与 VR 本地 `registervr.conf.vm_id` 及 inventory 对齐，**非** CSMCTL 自动采集的废字段 |
| `cloudId`、`vpcId`、`cidr` 等 | 防护目标网络 |
| `tenantId`、`organizationId` | Tower 归属 |
| `csmCloudId` | CSM 资源池 |
| `csmOrgId` | 与租户对齐的 CSM 组织 ID |
| `linkedCsmSecurityDomainId` | 关联的 **唯一** CSM 安全域 ID（1:1；可用独立关联表，但逻辑上不得多于一条有效关联） |
| `discoveryMode` | `cloud_api` \| `vr_scan` \| `hybrid`（可选） |

**资产台账**：

- 云：池内 VM / 实例与 `domainId` 关联。
- IDC / VR：`sase_discovered_assets.domainId`（及 OS、IP、端口等）。

**CSM 安全域**：

- 池详情 Tab / BFF：`GET /api/clouds/{id}/csm/security-domains` 等为**读模型**。
- 与网际路由域：**关联表** `ird_id ↔ csm_domain_id`（**1:1 唯一约束**），不共用创建 / 删除生命周期。

---

## 10. 代码与 API 索引（内部名）

| 主题 | 路径 |
|------|------|
| 网际路由域实体 | `backend/src/entities/SecurityDomain.ts` |
| 网际路由域 API | `backend/src/routes/sdn/securityDomains.ts` |
| 前端列表 / 表单 / 详情 | `frontend/src/pages/sdncc/cross-domain/internetwork-routing/`（迁移期 `sec-mgr-plane/SecurityDomain/` barrel 兼容） |
| 云实例库存（终端 IP / instanceId） | `backend/src/entities/CloudInstanceInventory.ts` |
| VR 本地注册配置落库 | `backend/src/entities/vRouter/VRConfig.ts`（`vmId`、`config_json`） |
| VR 实例聚合缓存 | `backend/src/routes/sdn/vrInstances.ts`、`VRCacheService`（API 路径保留 `vr`） |
| VR 绑定租户 / vm_id | `backend/src/routes/sdn/vrConfig.ts`、`vrManagementService` |
| CSM 安全域 BFF | `backend/src/routes/clouds/csm/routes.ts`（`tenants`、`security/domains`） |
| CSM 租户 / 域恢复 | `backend/src/services/tenants/csmTenantRepair.ts` |
| 稳定 ID 映射 | `backend/src/services/tenants/csmStableIds.ts` |
| VR 发现资产 | `backend/src/entities/vRouter/SASEDiscoveredAsset.ts` |
| 服务链（无顶层菜单；详情内嵌） | `frontend/src/pages/sdncc/traffic/ServiceChains/`（复用组件，入口仅在网际路由域 → 安全域 → 服务链） |
| IBR 能力页（菜单 + 详情内嵌） | `frontend/src/pages/sdncc/ibr/`（`routers/`、`srv6/`、`ipsec-vpn/`、`acl/`、`nat/`；嵌入参数见 `ibr/embedProps.ts`） |
| 导航与分组（目标 §11） | `frontend/src/routes/RouteSpec.ts` |
| 网际路由域详情 Tab（目标 §12） | `frontend/src/pages/sdncc/cross-domain/internetwork-routing/Detail/` |
| 邻居（现级联通道） | `frontend/src/pages/sdncc/sec-mgr-plane/cascade-channels/` |
| 应用管理 | `frontend/src/pages/sdncc/sec-mgr-plane/Applications/` |
| CSM 安全服务（现 + 目标跨池 KPI） | `frontend/src/pages/sdncc/sec-mgr-plane/SecurityServices/`、`traffic/CsmPools/` |
| RBAC 显示名 | `backend/src/permissions/definitions.ts`（`networks.security-domain`） |

---

## 11. SDN 导航与信息架构（目标）

网际路由域提升为 **整个 SDN 的枢纽元素**；导航从「安全管理面 / 跨域互联 / 流量编排 / 安全资源池」四组，收敛为下列 **三组**（`RouteSpec.group` 目标；License 特性码 `sdn.cascade` / `sdn.interconnect` / `sdn.traffic` 可暂不改，先调分组与文案）。

### 11.1 目标侧栏

| 分组 | 顺序 | 菜单项 | 说明 |
|------|------|--------|------|
| **跨域互联** | 1 | **网际路由域** | SDN 编排锚点；列表 + 详情以「这片网」为中心（见 §12） |
| **跨域互联** | 2 | **邻居管理** | 原「级联通道管理」；网际路由域之间的邻接 / CEN 互联 |
| **跨域互联** | 3 | **应用管理** | 抽象应用纳管；与网际路由域详情「应用」Tab 联动 |
| **IBR 管理** | 1 | **IBR实例**（及子页） | 列表、新增、专家模式、PE/CE/标准/SASE 角色向导等 |
| **IBR 管理** | 2～5 | **SRv6 隧道** / **IPsec VPN** / **ACL** / **NAT** | **IBR 能力**；全局管理入口在此组 |
| **CSM 管理** | 1 | **资源池管理** | CSM 资源池接入、连接测试、池详情（池内 Tab 仍可含 CSM 安全域 / 租户运维视图） |
| **CSM 管理** | 2 | **安全服务管理** | **跨所有资源池** 的安全能力目录；现阶段以安全网元组为主，后续扩展「网元组 ↔ 已上架安全服务接口」关联包，并带 **KPI 卡片** |

### 11.2 产品语义（导航层）

| 名称 | 角色 |
|------|------|
| **网际路由域** | Tower 编排面：这片网有什么、怎么连、流量怎么走 |
| **邻居** | 网际路由域之间的互联关系（原级联通道）；比「通道」更贴近枢纽模型 |
| **应用** | 在网际路由域边界内的逻辑应用（微隔离 / 零信任），区别于裸资产 |
| **IBR** | 设备与策略面：IBR实例及 SRv6/IPsec/ACL/NAT 等能力；菜单在 **IBR 管理** 组 |
| **CSM 安全域** | 能力池内逻辑包；在网际路由域详情中以 **「安全域」分组 Tab** 呈现（见 §12），界面须带 **CSM** 前缀或上下文，避免与网际路由域混称 |
| **安全服务管理（CSM）** | 全局目录视角，非单池详情 Tab |

### 11.3 与现网 `RouteSpec` 映射（迁移对照）

| 现状 `group` / `title` | 目标 |
|------------------------|------|
| `流量编排` → 网际路由域 | → `跨域互联` **第 1 项** |
| `安全管理面` → 级联通道管理 | → `跨域互联` → **邻居管理** |
| `安全管理面` → 应用管理 | → `跨域互联` **第 3 项**（保留） |
| `跨域互联` → VR 实例管理及子路由 | → **`IBR 管理`** |
| `安全资源池` / `流量编排` → 资源池管理 | → **`CSM 管理`** → 资源池管理 |
| `流量编排` → 安全服务 | → **`CSM 管理`** → 安全服务管理（跨池 + KPI） |
| `跨域互联` → SRv6 / IPsec / ACL / NAT | → **`IBR 管理`** 各菜单项（§11.1） |
| `流量编排` / `traffic/` → 服务链等 | **取消顶层服务链菜单**；能力收敛至网际路由域详情 → CSM 安全域 → 服务链 |

**解散的导航组（已定稿）**：**必须解散** `安全管理面`、`流量编排`、`安全资源池`；菜单与源码目录均按 §11.4 **三组结构** 收敛。License 特性码 `sdn.cascade` / `sdn.interconnect` / `sdn.traffic` **可暂不改**，仅调整 `RouteSpec.group`、文案与目录落位。

### 11.4 目标源码目录（`pages/sdncc/`，与导航三组对齐）

```
pages/sdncc/
├── cross-domain/              # Group1 跨域互联（产品组名；目录名实现时可 kebab-case）
│   ├── internetwork-routing/  # 网际路由域（现 SecurityDomain/，可渐进迁移）
│   ├── neighbors/             # 邻居管理（现 cascade-channels/）
│   └── applications/          # 应用管理（现 Applications/）
├── ibr/                       # Group2 IBR 管理
│   ├── routers/               # IBR实例（现 interconnect/vr/）
│   ├── srv6/                  # SRv6（现 interconnect/srv6/）
│   ├── ipsec-vpn/             # IPsec（现 interconnect/ipsec-vpn/）
│   ├── acl/                   # ACL（现 interconnect/acl/）
│   └── nat/                   # NAT（现 interconnect/nat/）
└── csm/                       # Group3 CSM 管理
    ├── pools/                 # 资源池（现 traffic/CsmPools/）
    └── security-services/     # 安全服务管理（现 sec-mgr-plane/SecurityServices/）
```

- **服务链**：**无**独立 `pages/sdncc/.../service-chains/` 导航入口；保留 `ServiceChains/` 下向导/列表**组件**，由网际路由域详情「安全域 → 服务链」子 Tab 引用。
- 迁移期允许旧路径 `sec-mgr-plane/`、`traffic/`、`interconnect/` 通过 barrel 再导出；**新功能只落目标目录**（见 `frontend/src/STRUCTURE.md`）。

---

## 12. 网际路由域详情 Tab 结构（目标）

详情页以网际路由域为壳：**IBR 能力**（VR/SRv6/IPsec/ACL/NAT）归入 **IBR 管理** Tab；**CSM 逻辑包**（防护对象、安全服务、服务链）归入 **安全域** Tab（1:1）；二者不与「网络 / 资产」平级混排。

### 12.1 一级 Tab（目标）

| Tab | 内容 |
|-----|------|
| **总览** | 枢纽摘要：租户、防护目标网络、主绑定 IBR（VR）、邻居数、资产数、关联 CSM 安全域（1:1）状态 |
| **网络** | **仅**防护目标网络：VPC/CIDR/分类、云池绑定等；**不含** SRv6/IPsec/ACL/NAT（属 IBR 能力，见下） |
| **资产** | 统一台账：**各类负载形态** — 云虚拟机、容器工作负载、IDC 服务器、办公网 PC 等；来源含云 API 同步与 VR 扫描（`CloudInstanceInventory`、`SASEDiscoveredAsset` 等） |
| **应用** | 归属本网际路由域的**抽象应用**实例；与顶层「应用管理」列表联动 |
| **邻居** | 原「级联通道」Tab；本网际路由域参与的邻居 / CEN 附着关系 |
| **IBR 管理** | 本网际路由域范围内的 **IBR 资产视图**（§12.2）；**页面复用** IBR 管理组既有 Section + **按 `domainId` / `vrUuid` 筛选** |
| **安全域** | 关联的 **唯一** CSM 安全域（1:1）；其下 **子 Tab** 即 CSM 安全域逻辑包三部分（§12.3） |

### 12.2 「IBR 管理」Tab 内子 Tab（目标）

实现方式：**复用** `pages/sdncc/ibr/`（迁移后）或现 `interconnect/` 下各列表/配置页为 **嵌入 Section**，传入网际路由域上下文，仅展示本网际路由域相关数据。

| 子 Tab | 复用来源 | 筛选维度（示例） |
|--------|----------|------------------|
| **IBR实例** | `ibr/routers/`（现 `interconnect/vr/`） | 绑定 `vrUuid`、域标签、租户 |
| **SRv6 隧道** | `ibr/srv6/` | 域 / VR / attachment 关联 |
| **IPsec VPN** | `ibr/ipsec-vpn/` | 域 / VR 端点 |
| **ACL** | `ibr/acl/` | 域 / VR 接口 |
| **NAT** | `ibr/nat/` | 域 / VR 接口 |

> 菜单级 **IBR 管理** 组提供全局 CRUD；网际路由域详情 **IBR 管理 Tab** 为**同组件、域内 filtered 视图**，避免重复实现。

### 12.3 「安全域」Tab 内子 Tab（目标 · 1:1）

**CSM 安全域** 在 Tower 侧的投影固定为三个子 Tab（**无第四层**；服务链不得再抬为独立导航）：

| 子 Tab | 说明 |
|--------|------|
| **防护对象** | CSM 侧「保护谁」；权威以 Tower 资产与 CIDR 为准（§4） |
| **安全服务** | 网元 / 网元组；编排面在 CSM，Tower BFF 展示与代发 |
| **服务链** | 策略路径与引流；**唯一入口**之一（与 CSM 池内运维视图并存时，以本网际路由域上下文为准） |

未关联 CSM 安全域时：展示空态 +「选择 / 关联 CSM 安全域」引导（单选）。

### 12.4 现网详情 Tab → 目标（对照）

| 现 Tab（`SecurityDomain/Detail`） | 目标落点 |
|-----------------------------------|----------|
| 资源总览 | **总览** |
| 级联通道 | **邻居** |
| 应用实例 | **应用** |
| 安全服务 / 服务链 / 防护对象 | **安全域** 子 Tab（1:1） |
| 网络基础设施 | **网络** |
| 云主机实例 | **资产**（并入多形态台账） |
| SRv6 / IPsec / NAT / 网络ACL | **IBR 管理** 对应子 Tab |
| 旁路阻断 | **安全域** 或 CSM 能力扩展（实现时与 CSM 编排面对齐，不单独抬导航） |

---

## 13. CSM 管理 · 安全服务管理（目标能力）

- **范围**：聚合所有已接入 CSM 资源池可提供的安全能力，不仅限于进入某一池详情。
- **现阶段**：以 **安全网元组**（`element-groups` / 现 `SecurityServices` 列表能力）为主。
- **演进**：提供 **已上架的安全服务接口**（网元组与安全服务产品的关联逻辑包）；列表或详情顶部展示 **KPI 卡片**（健康、吞吐、会话、授权状态等，指标集随 CSM/OpenAPI 能力扩展）。
- **与池详情关系**：池详情 Tab 保留**池内运维**（租户、CSM 安全域、防护对象 CRUD）；全局「安全服务管理」提供**跨池目录与 KPI**，二者粒度不同，不互相替代。

---

## 14. 已定稿产品决策（2026-06）

| # | 议题 | 决策 |
|---|------|------|
| 1 | **网际路由域 ↔ CSM 安全域** | **严格 1:1**；一个网际路由域仅能关联一个 CSM 安全域；表单单选，字段 `linkedCsmSecurityDomainId` |
| 2 | **SRv6 / IPsec / ACL / NAT** | **菜单**：归入 **IBR 管理** 组，作为 IBR 能力独立 section；**详情**：网际路由域新增 **IBR 管理** Tab，子 Tab 为 VR / SRv6 / IPsec / ACL / NAT，**页面复用 + 域内数据筛选** |
| 3 | **服务链顶层菜单** | **无**；服务链层级不得过高；仅为 CSM 安全域子项，与防护对象、安全服务并列（网际路由域详情 → 安全域 → 服务链） |
| 4 | **旧导航组** | **解散** `安全管理面`、`流量编排`、`安全资源池`，合并进 §11 三组；**目录结构**按 §11.4 执行；License 特性码可暂不改 |

**实现细节（可研发自定，不阻塞）**：邻居 / CEN 的 URL 与权限内部名是否统一为 `neighbor`；旧 path 重定向策略。

---

## 15. 导航 IA 研发 backlog（建议分期）

| 阶段 | 内容 |
|------|------|
| **IA-1** | `RouteSpec` 三组重组；解散旧三组 `group`；文案（邻居、IBR）；SRv6/IPsec/ACL/NAT 迁入 **IBR 管理**；移除服务链顶层路由 |
| **IA-1b** | `pages/sdncc/` 目录按 §11.4 搬迁（`cross-domain/`、`ibr/`、`csm/`）；旧路径 barrel 兼容 |
| **IA-2** | 网际路由域详情 Tab：总览 / 网络 / 资产 / 应用 / 邻居 / **IBR 管理**（五子 Tab 复用筛选）/ **安全域**（防护对象、安全服务、服务链） |
| **IA-3** | CSM 安全服务管理：跨池聚合 + KPI 卡片骨架 |
| **IA-4** | §8 数据分型（`roleKind`、CSM **1:1** 关联）+ 防护对象同步联调 |
| **IA-5** | 创建网际路由域 **VR 推荐绑定**（§16）：`suggest-vr` API、表单推荐 UI、网际路由器列表「vm_id 对齐」提示 |

---

## 16. VR 身份、云主机锚点与创建时推荐绑定

本节约定：**如何把「这片 VPC 里的 VR」与 Tower 网际路由域创建表单中的 `vrUuid` 关联起来**。与 §2.3 资产台账、§12「IBR 管理」Tab 筛选共用同一套身份语义。

### 16.1 两个标识：`uuid` 与 `vm_id`（禁止混用）

VR 侧本地配置文件示例（PaaS VR · `registervr.conf`，路径一般为 `/usr/local/src/vrconf/registervr.conf`）：

```json
{
  "pool_id": "",
  "pool_name": "",
  "vm_id": "",
  "name": "sw-qMtxz3f",
  "uuid": "589741676340655098",
  "version": "V1.0",
  "type": "NB",
  "mac": "02:07:7E:96:54:35"
}
```

| 字段 | 含义 | 谁维护 | Tower 用途 |
|------|------|--------|------------|
| **`uuid`** | VR 在 CSM / 控制面的实例 ID | 注册流程生成，**勿随意手改** | 网际路由域 `vrUuid`；IBR 能力（SRv6/IPsec/ACL/NAT）锚点 |
| **`vm_id`** | 云厂商虚拟机 / ECS **实例 ID** | **运维在 VR 本地管理界面人工填写**（见 §19） | 与 `cloud_instance_inventory.instanceId` 对齐；创建域时 **VR 推荐** 的强匹配键 |

**口语注意**：有人把云实例 ID 叫作「VM 的 uuid」——产品文档与实现中统一写作 **`vm_id` / `instanceId`**，避免与 VR 控制面 **`uuid`** 混淆。

### 16.2 CSMCTL 数据通道与可信度

| 数据 | 来源 | 可信度 | Tower 策略 |
|------|------|--------|------------|
| VR **`uuid`**、name、mac 等注册信息 | CSMCTL VR1 → Tower `VRCacheBasic` | 高（控制面主键） | 用于 `vrUuid` 列表与 IBR |
| VR **`vm_id`**（未在本地配置） | CSMCTL 同步的 VR1 字段 | **低 / 常为空或错误** | **不得**作为自动关联的强匹配依据 |
| VR **`vm_id`**（运维在 PaaS VR 本地写入后同步） | `registervr.conf` → CSMCTL → Tower 缓存 / `vr_config.vmId` | **高（运维承诺）** | 可与 Tower 云库存 **强匹配**（须校验，见 §16.4） |
| VR LAN / WAN IP | CSM VR2、`vr_config.config_json`、创建后 `fillAliyunDetails` | 中 | 创建前 **IP 兜底推荐**；创建后云 API 补 ENI/IP |
| 云主机 `instanceId`、`privateIps` | Tower 多云同步 `cloud_instance_inventory` | 高 | 定义「所选网络内终端」集合 |

**结论**：CSMCTL **不能**可靠提供云 ECS/VM 的实例 UUID；**不能**假设 VR1 里的 `vm_id` 默认可用。可信的实例级锚点来自：**运维在 VR 本地填写的 `vm_id`** + **Tower 云同步库存**。

### 16.3 数据流（运维配置 → Tower 可见）

```
云控制台创建 VR 虚机 → 记下实例 ID（如 i-bp12…）
  → PaaS VR 本地界面：配置服务 → registervr.conf → 填写 vm_id
  → Agent / 注册上报 CSMCTL（VR1 pagelist）
  → Tower：POST /api/vr-instances/refresh → VRCache + vr_config.vmId
  → 创建网际路由域：cloudId + vpcId → suggest-vr 比对 inventory.instanceId
```

`uuid` 保持 VR 自身控制面身份；**不要**为「对齐云主机」而手改 `uuid`。

### 16.4 Tower 侧如何「信任」同步回来的 `vm_id`

| 条件 | 处理 |
|------|------|
| `vm_id` 非空，且等于 inventory 中某行 `instanceId`，且 `vpcId` 与所选 VPC 一致 | **可信**；强推荐绑定对应 `vrUuid` |
| `vm_id` 非空，但 inventory 无此实例 | 标黄：「本地 vm_id 未在库存中找到」；**不自动绑定**；提示刷新资源池 / 核对填写 |
| `vm_id` 为空 | 仅 IP / 网段弱推荐；提示「请在 VR 本地配置 vm_id」 |
| `vm_id` 与 `uuid` 相同或格式明显非云实例 ID | 降权，视为未配置云锚点 |

创建**之后**的 `fillAliyunDetails`（阿里云 ENI/IP 补全）依赖已选 `vrUuid` 与 Tower 侧 `vrInstanceIds`；与创建前推荐分离，不替代 §16.5 逻辑。

### 16.5 创建网际路由域时 VR 推荐算法（目标）

触发时机：创建表单已选 **租户/组织 + 类型 VPC + 云资源池 + VPC**（扁平网等见 §16.7）。

**终端集合 T**（所选网络内可被关联的负载）：

- `cloud_instance_inventory` 中 `cloudId` + `vpcId` 匹配的行；
- 解析 `privateIps`（JSON 数组）得到 IP 集合；VPC CIDR 来自所选 VPC 元数据。

**VR 候选集合 V**：

- `GET /api/vr-instances` 缓存列表；
- 可按 `tenant_id`、`pool_id`、`vr_config.cloudId` 粗筛；
- **不用** VR1 中无效 `vm_id` 做候选过滤。

**打分（仅推荐，默认需用户确认）**：

| 规则 | 分数 | 说明 |
|------|------|------|
| VR 的 `vm_id`（已同步且通过 §16.4 校验）= inventory `instanceId`，同 VPC | 95～100 | **强推荐**；理由：「VR 本地 vm_id 与云主机 xxx 一致」 |
| VR LAN / 私网 IP ∈ 某 inventory 行 `privateIps`，同 VPC | 85～90 | 中强；理由：「私网 IP 与云主机 xxx 一致」 |
| VR LAN ∈ VPC CIDR，或与 T 中 IP 同子网（`subnetCidr`） | 60～75 | 弱；多台 VR 同网时 **不自动唯一** |
| 仅 WAN/EIP 与库存公网字段重合 | +5～10 | 辅助 |
| CSMCTL 自动采集、未人工维护的 `vm_id` | **不参与加分** | 与空 vm_id 同等对待 |

**自动预填 `vrUuid` 规则（产品）**：

- 仅当 **唯一候选** 且分数 ≥ 95（vm_id 强匹配）时预填；
- 多个候选或仅 IP 级匹配：展示「推荐」分组，**不静默绑定**；
- 已被其他网际路由域占用的 VR：继续排除（与现网 `vrUuidsBoundElsewhere` 一致）。

### 16.6 API（已落地）

```
GET /api/security-domains/suggest-vr
  ?cloudId=
  &vpcId=
  &tenantId=
  &organizationId=
```

响应示例：

```json
{
  "terminals": { "count": 42, "vpcCidr": "10.0.0.0/16" },
  "suggestions": [
    {
      "vrUuid": "...",
      "score": 100,
      "reasons": ["vm_id 与云主机 i-bp12 一致", "私网 IP 10.0.0.5"],
      "instanceId": "i-bp12",
      "privateIp": "10.0.0.5"
    }
  ]
}
```

实现落点：BFF 聚合 `cloud_instance_inventory` + VR 缓存 + `vr_config`；阿里云可在分数不足时按需 `DescribeInstances`（与 `fillAliyunDetails` 同源），避免每次打开弹窗都打云 API。

**前端**：`drawers/SecurityDomainFormDrawer` VR 下拉增加「推荐」分组与匹配原因；无数据时区分「未配置 CSMCTL」「未配置 vm_id」「库存未同步」。

### 16.7 非 VPC 与边界

| 场景 | 策略 |
|------|------|
| **扁平网 / 自定义 CIDR** | 终端集改为 CIDR 内 IP；VR LAN ∈ CIDR + vm_id 规则仍适用 |
| **容器 / Rancher** | 常无 `vpcId` inventory；降级为租户 + 集群标签，**不承诺** IP 反推 |
| **库存滞后** | 推荐前应对库存 `skipCache` 或触发池刷新（与全站刷新规范一致） |
| **多 VR 同 VPC** | 仅 IP / 子网时不得自动唯一；依赖 vm_id 运维区分 |
| **VR 仅公网、无私网** | LAN 为空时只能弱提示或不做推荐 |

### 16.8 与 IBR / 资产 Tab 的关系

- **IBR 管理 Tab**：绑定后以 `vrUuid` 筛选嵌入的 `ibr/*` Section（已落地）。
- **资产 Tab**：云主机列表可增加列「是否 VR 虚机 / 关联 vrUuid」（与 suggest 同源）；**终端 IP 本身不反推 VR**，应先归到 inventory 行再判断该行是否为 VR 的云主机身份。

---

## 17. VR 部署运维约定（PaaS VR 本地界面）

与 Tower 产品文档配套，供现场部署 VR 时执行。

### 17.1 界面入口

- **PaaS VR 本地管理界面**（示例菜单）：仪表盘、设定网卡 IP、**配置服务**、初始化网卡、健康巡检等。
- **配置服务 → 配置文件 → `registervr.conf`**（界面提示：一般无需修改；有特殊需求时可编辑）。

### 17.2 部署检查清单

1. 在目标云资源池创建 VR 虚机，在云控制台记录 **实例 ID**（阿里云 `i-xxx`、华为云等价 ID 等）。
2. 在 VR 本地界面打开 `registervr.conf`，将 **`vm_id`** 设为该实例 ID（**不要**为对齐云主机而修改 **`uuid`**）。
3. 配置 CSMCTL 地址（SDWAN 控制器等），确保 Agent 能上报。
4. Tower：**系统设置** 配置 `CSMCTL_ADDRESS`；**IBR 管理 → IBR实例** 执行同步，确认列表中该 IBR 的 `vm_id` 与云控制台一致。
5. Tower：刷新对应云资源池库存，确认 `cloud_instance_inventory` 含该实例且 `vpcId` 正确。
6. 创建网际路由域：选同一资源池 + VPC → 应出现 **VR 推荐**（实现 §16.6 后）或人工选择 `vrUuid`。

### 17.3 字段填写规范

| 字段 | 填写内容 | 错误示例 |
|------|----------|----------|
| `vm_id` | 云厂商实例 ID，与 Tower inventory `instanceId` 一致 | 内网 IP、主机名、VR 的 `uuid`、随意别名 |
| `uuid` | 保持注册生成的控制面 ID | 改成云实例 ID |
| `pool_id` / `pool_name` | 与 Tower 资源池对齐（若产品要求） | 与云池不一致导致粗筛失败 |

### 17.4 故障排查

| 现象 | 可能原因 |
|------|----------|
| Tower VR 列表 `vm_id` 为空 | 本地未填或未同步；检查 registervr.conf 与 CSMCTL |
| 创建域时 VR 下拉无数据 | `CSMCTL_ADDRESS` 未配置或 VR 缓存未 refresh |
| vm_id 已填但推荐不匹配 | 库存未同步、vpcId 不一致、instanceId 填错 |
| 两台 VR 同 VPC 无法自动区分 | 补全各自 `vm_id` 或人工选 `vrUuid` |

---

## 18. 相关文档

- [frontend-layout.md](./frontend-layout.md) — 网际路由域列表 / 详情页面壳层。
- [srv6-hub-pe-spec.md](./srv6-hub-pe-spec.md) — Hub PE 与网际路由域联动。
- [sdnc-tower-integration-api.md](./sdnc-tower-integration-api.md) — Tower 联部署时的 BFF / 北向约定（独立 SDNC 可忽略）。

---

## 19. 修订记录

| 日期 | 说明 |
|------|------|
| 2026-06 | 初版：网际路由域命名、与 CSM 安全域边界、防护对象对齐、三块管理、创建流程与 backlog |
| 2026-06 | 增补 §11～§15：SDN 三组导航 IA、详情 Tab 目标、CSM 安全服务管理、现网映射、IA backlog |
| 2026-06 | §14 定稿：CSM 1:1、IBR 能力与详情 Tab、无服务链顶层菜单、解散旧三组 + §11.4 目标目录 |
| 2026-06 | **IA-1 落地**：`RouteSpec` 三组、`navigation.ts`、邻居/IBR 文案；详情 Tab 重组；`cross-domain/` / `ibr/` / `csm/` barrel 占位 |
| 2026-06 | **IA-4（首期）**：`roleKind` / CSM 1:1 字段、`internetworkRoutingDomain` 工具、repair 分型、列表筛选与编排门禁、表单 CSM 关联、镜像提升入口 |
| 2026-06 | **IA-3（首期）**：安全服务管理跨池 KPI 卡片；分配目标仅可编排网际路由域 |
| 2026-06 | **IA-1b（首期）**：`App.tsx` 懒加载迁至 `cross-domain/`、`ibr/`、`csm/` barrel；IBR 四能力物理迁至 `ibr/`；防护对象 Tab 联调 CSM assets |
| 2026-06 | **IA-2（IBR Tab 复用）**：详情 IBR 管理五子 Tab 嵌入 `ibr/*`（`embedded` + `scopedVrUuid`）；移除详情内占位表格 |
| 2026-06 | **§16～§17**：VR `uuid` vs `vm_id`、CSMCTL 可信度、PaaS VR 本地 `registervr.conf` 运维约定、创建域 VR 推荐算法与 `suggest-vr` API 目标；§8.1 实现状态快照 |
