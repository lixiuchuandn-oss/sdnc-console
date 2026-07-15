# SRv6 Hub PE 组网 · 产品规格与约束（查阅用）

> **定位**：Hub–Spoke 场景下的**稳定产品约定**、实现边界与**遗留事项**；供研发、测试、运维快速确认「能不能做 / 当前怎么做」。  
> **不替代**：实现细节与 merge/recompute 流程见 [`srv6-baseline-recompute.md`](./srv6-baseline-recompute.md) §14；发版摘要见 [`srv6-release-notes.md`](./srv6-release-notes.md)。  
> **UX 改造计划**（P1–P4，已评审）：见本文 §4 与 [`srv6-baseline-recompute.md`](./srv6-baseline-recompute.md) §14.17；**以本文 §1–§3 为产品约束权威**。

**最后对齐**：2026-07（P5c Hub 客户侧 intent 层、inventoryId 精确匹配、真机回归修复）。

---

## 1. 规格约定（当前版本）

### 1.1 角色与拓扑

| 编号 | 约定 |
|------|------|
| **S-1** | 支持 **Hub–Spoke**（`tunnelTopology=H`）：同一 Hub PE 可挂 **多条**隧道，每条绑定 **一个** Spoke PE。 |
| **S-2** | 支持 **Spoke–Spoke 点对点**（`tunnelTopology=S`）：两端均为 `SPOKE_PE`，四端 CE–PE–PE–CE 模型不变。 |
| **S-3** | 支持 **Hub 对多 Spoke** 的星型互通：各 Spoke 经 Hub 私网/BGP 域交换路由（具体可达性取决于 REUSE / DEDICATED 与客户侧拓扑）。 |
| **S-4** | 支持 **Hub–Hub**（两端均为 `HUB_PE`）：按点对点拓扑归档（`tunnelTopology=S`），不做 Hub–Spoke 的 inventory / REUSE 锚点流程；与 Spoke–Spoke、Spoke–Hub 一并在向导第 1 步「隧道类型」中选型。 |

### 1.2 Hub PE · 多 WAN 公网

| 编号 | 约定 |
|------|------|
| **S-5** | Hub PE 可配置 **多个 WAN 出口**（`_towerHubInventory.wan[]` / 角色向导多 Tab）。 |
| **S-6** | 公网侧 **仅一个 BGP 进程段**（通常 `bgp[0]`）：**全 Hub 共用同一公网 ASN** 与 **唯一 Router-ID**（设备/进程级）。 |
| **S-7** | 多 WAN **不复用**时：差异体现在 **物理接口地址**、**每 WAN 静态路由 / IPv6 网关**（角色向导 WAN Tab 内配置），**不**为每 WAN 拆独立公网 ASN 或独立 `bgp[n]` 公网段。 |
| **S-8** | 多条 Hub 隧道在公网侧向 **同一 `bgp[0]`** 叠加 **不同 Spoke 的 neighbor / activate / ndc**；Blocking 判重键为 **`(hubPeUuid, peerPublicNeighbor)`**（对端 Spoke 公网 IPv6 唯一）。 |
| **S-9** | 同一 Hub WAN 口 **可被多条隧道复用**；不同隧道可选用 **不同 WAN 口**（轴 2 与路线 A/B 正交）。 |

### 1.3 Spoke PE / CE · 接口规模

| 编号 | 约定 |
|------|------|
| **S-10** | **Spoke PE** 与 **CE** 角色向导：**默认 1 个 WAN + 1 个 LAN**，**暂不支持**多 WAN / 多 LAN 扩展。 |
| **S-11** | Spoke PE 是否扩展多接口：**视产品需求再定**；当前实现与验收均按单口。 |

### 1.4 Hub 客户侧 · CE / VRF 复用（路线 A · `REUSE_VRF`）

| 编号 | 约定 |
|------|------|
| **S-12** | Hub 与 Spoke 复用 **同一客户侧 CE / 内网 VRF** 时（`hubVrfMode=REUSE_VRF`）：**Hub 私网 `bgp[vrfIndex]` 段共用**（首条隧道确立）。 |
| **S-13** | **RT**：第 2 条及以后 Spoke 隧道 **继承首条存活隧道的 `rtCommon`**（与首条相同）；**设备侧当前仅支持单 RT 下发**，不做多 RT 并集（见 §3 遗留 L-2）。 |
| **S-14** | **RD**：Hub 侧每 VRF **一个 RD**（首条确立、后续复用）；**各 Spoke PE 侧 RD 相互独立**（每条新 Spoke 隧道生成新 Spoke 槽位 RD，不复制首条 Spoke 的 RD）。 |
| **S-15** | **首条** Hub 隧道：用户须在隧道向导 **显式选择** Hub 客户侧 LAN（inventory 下拉）及 Hub 侧 CE，确立「共用锚点」。 |
| **S-16** | **后续** REUSE 隧道：Hub LAN / Hub CE / Hub `peInnerIf` **自动沿用首条**，UI 只读；用户仅选 Spoke 侧 + Hub WAN。 |

### 1.5 Hub 客户侧 · 独立专网（路线 B · `DEDICATED_VRF`）

| 编号 | 约定 |
|------|------|
| **S-17** | 每隧道 **独立**私网 `bgp[N]`（新 VRF、新私网 ASN/Router-ID、新 RD/RT）。 |
| **S-18** | LAN inventory 项在 **DEDICATED** 已被占用时 **不可再选**；WAN 仍可复用。 |

### 1.6 Inventory 与向导职责

| 编号 | 约定 |
|------|------|
| **S-19** | **WAN / LAN inventory 仅在 `HUB_PE` 角色配置向导创建与维护**（写入基线 `_towerHubInventory`）。 |
| **S-20** | **SRv6 隧道向导**只做：选 Spoke、选 Hub **公网口 → 内网口 → CE**（一次选择，同步 `peInnerIf`）；**不**展示客户侧策略单选；**不在隧道向导内联新建接口**。 |
| **S-21** | 无可用 inventory 时 **阻断创建**，提示用户先完成角色向导（见 §2.2）。 |
| **S-22** | 删除隧道 **不回收** inventory 口项（能力池永久留在 Hub 基线，除非用户在角色向导中改配）。 |

### 1.7 IPv6 路由（公网）

| 编号 | 约定 |
|------|------|
| **S-23** | 角色向导为 **每个 Hub WAN** 配置公网 **IPv6 静态路由 + 网关**（目的网段与 `via` 成对）；**设备下发** `ipv6_route[]` 仅含 `destination` + `via`（**不含 `dev`**）；口 ↔ 网关绑定由 **`_towerHubInventory`**（平台库，下发前剥离）维护。隧道 **不重复注入**该条，仅读取用于 SID/64 `via` 择优（§14.14.1）。 |
| **S-24** | SID/64 的 `via`：**优先**所选 Hub WAN 对应网关（inventory → 同序 `ipv6_route`）→ **否则**对端 Spoke/PE **公网 IPv6 直连接口地址**（直连回退，与单 WAN 一致）。 |

### 1.8 非 Hub 四端

| 编号 | 约定 |
|------|------|
| **S-25** | **非 Hub** 的 Spoke 点对点 / 传统四端流程 **保持现有交互**，不受 Hub 多 WAN/LAN 改造约束。 |

---

## 2. 操作与阻断规则

### 2.1 双轴模型（隧道创建）

| 轴 | 问题 | 字段 |
|----|------|------|
| **轴 1 · 客户内网** | 是否与已有隧道共用 CE/VRF？ | 由 **Hub 内网口选项态**隐式推导 `hubVrfMode`（见 §5.2） |
| **轴 2 · Hub 公网 WAN** | 本 Spoke 的 PE–PE 走哪条 Hub WAN？ | `hubBindings.wanIf` / `wanInventoryId` |

两轴 **正交**：`REUSE_VRF` 下仍可为不同 Spoke 选 **不同 WAN 口**。

### 2.2 Inventory 缺失阻断矩阵

| 场景 | 缺 WAN inventory | 缺 LAN inventory |
|------|------------------|------------------|
| 任意 Hub 隧道 | **阻断** | — |
| **首条** Hub 隧道 | 阻断 | **阻断**（须选客户侧 LAN） |
| **后续 + REUSE** | 阻断 | 不阻断选 LAN（自动沿用首条） |
| **后续 + DEDICATED** | 阻断 | **阻断**（须有空闲 LAN 项） |

统一提示模板：

```text
尚未配置 Hub {公网|内网} 口。请先在「HUB_PE 角色配置向导」完成 {WAN|LAN} 并保存基线。
```

### 2.3 首条 vs 后续（REUSE）隧道向导

| 步骤 | 首条 Hub–Spoke | 后续 REUSE（默认） | 后续 DEDICATED |
|------|----------------|-------------------|----------------|
| Spoke PE + 内网口 + CE | 用户选择 | 用户选择 | 用户选择 |
| Hub WAN | inventory 下拉 | inventory 下拉 | inventory 下拉 |
| Hub 内网口 | 选 **空闲** LAN（确立锚点） | **只读**（继承锚点 LAN） | 选 **另一条空闲** LAN |
| Hub CE | 用户选择 | **只读**（继承锚点 CE） | 用户选择 |
| `hubVrfMode` | `REUSE_VRF` | `REUSE_VRF` | `DEDICATED_VRF` |

Hub 列 **不单独展示** `peInnerIf` 下拉；用户仅在「Hub 内网口」选一次，提交时同步 Hub 槽位 `pe{x}InnerIf` 与 `hubBindings.lanIf`。

---

## 3. 遗留与后续规格（Out of Scope · 当前版本）

### L-1 · 多宿主公网 · 每 WAN 独立 ASN / 多段公网 BGP

**描述**：若业务要求「WAN1 走运营商 A（AS 430）、WAN2 走运营商 B（AS 540）」，属于 **多宿主 / 公网多实例** 需求，需 **单独产品规格**（例如公网 VRF 或多公网 `bgp[n]` 段）。

**当前**：**不做**；公网 ASN / Router-ID 保持 Hub 级一份（§1.2 S-6～S-7）。

**可选增强**（非必须、不挡本期）：设备若支持 neighbor 绑定 `update-source`，可在 inventory 用该 WAN 的 IPv6 作源地址——**无需**为此拆 ASN。

### L-2 · 设备多 RT 下发

**描述**：设备与 CSM 支持 **`route_target` 空格多 RT** 或等价能力后：

- Hub 侧 `REUSE_VRF` 可恢复「**每 Spoke 独立 RT**」并下发 RT 并集；
- merge / 删除须支持按隧道粒度增减 RT。

**当前**：`REUSE_VRF` 下 **恒为单 RT**，与首条隧道相同（§1.4 S-13）。详见 baseline §14.4.7。

### L-3 · 隧道向导内联新建 WAN/LAN（`tunnel_inline`，已废弃）

**描述**：曾在隧道创建页支持「新建公网口/内网口」写入 Hub 基线。

**当前 UX 决策**：**已取消**；inventory **仅角色向导**（P3 移除隧道向导 inline 表单；P4 移除后端 `hubInventoryInline` / `tunnel_inline` 死代码）。读库时遗留 `tunnel_inline` 规范为 `role_wizard`。

### L-4 · 多 WAN 按口匹配 `ipv6_route` 网关（已实现方向）

**描述**：`extractWanIpv6Gateway(cfg, wanIf)`，使 SID/64 `via` 与 **所选** `hubBindings.wanIf` 一致。

**状态**：**已实现**（P2b：`extractWanIpv6Gateway(cfg, wanIf)`；inventory / 同序 `ipv6_route` 择优；**设备不含 `ipv6_route.dev`**）。

### L-5 · Spoke PE 多 WAN / 多 LAN

**描述**：Spoke 侧多接口扩展。

**状态**：**未规划**；见 §1.3 S-10～S-11。

---

## 4. UX 实现分期（已评审）

| 阶段 | 内容 | 产品约束依据 | 状态 |
|------|------|----------------|------|
| **P1** | Hub PE：WAN/LAN `editable-card` Tab；Spoke PE **仅单 WAN+单 LAN** | §1.2、§1.3 | **已完成**（P5a 收口 Spoke 单 LAN） |
| **P2** | 每 Hub WAN Tab：静态路由 + IPv6 网关；写入 `ipv6_route` / inventory | §1.7 S-23 | **已完成**（`peWizardWanRoutes` 单测） |
| **P2b** | `resolveSid64Via(..., wanIf)` | §1.7 S-24 | **已完成**（`srv6Ipv6` 单测） |
| **P3** | 隧道向导 Hub 分区、首条/后续、去 inline | §1.6、§2 | **已完成**（`srv6TunnelWizardHub` 单测） |
| **P4** | 删除 `tunnel_inline` 死代码（清库后） | §3 L-3 | **已完成**（`srv6.hubInventory` 单测） |

**原则**：交互简化；**不改** merge、冲突、RD/RT 业务契约（§1.4、§1.8）。

---

## 5. UX 修订（P5 · 真机验收 · 已评审）

### 5.1 HUB_PE 角色向导（P5b）

Step1 自上而下：

1. SRv6 Locator / SID  
2. **Hub 公网 BGP（进程级 `bgp[0]`）**：ASN、Router-ID **独立区块**，不在 WAN Tab 内  
3. **多 WAN Tab**：每 Tab 仅接口地址 + 本口静态路由（§1.7）  
4. 与 LAN Step 之间 **明显分隔**（Divider / 卡片标题）

### 5.2 SRv6 隧道创建 · Hub 列线性流（P5c）

选中 `HUB_PE` 后，在 **Hub PE 所在列**、PE 下拉正下方顺序展示：

```text
Hub 公网口 → Hub 内网口 → Hub CE（ceA/ceB 槽位）
```

- **取消**底部独立「Hub 互联」分区与 `hubCustomerSide` Radio。  
- **取消** Hub 列「选择 PE-x 内网口」可见下拉；`pe{x}InnerIf` 由「Hub 内网口」选中值 **隐藏同步**。  
- 「Hub 内网口」`extra` 展示 VRF、IP、槽位映射，不设第三只读控件。

**`hubVrfMode` 隐式推导**（Hub 内网口选项态）：

| Hub 内网口选项 | `hubVrfMode` | Hub CE |
|----------------|--------------|--------|
| **空闲**，且 Hub **尚无** REUSE 锚点（首条） | `REUSE_VRF`（建锚点） | 用户自选 |
| **空闲**，且 Hub **已有** REUSE 锚点 | `DEDICATED_VRF` | 用户自选 |
| **已被 REUSE 隧道占用**（`已用于 Tn · 可复用`） | `REUSE_VRF` | 锁定锚点 CE |
| **DEDICATED 专网占用** | — | **不可选** |

**后续 REUSE 默认**：进入创建页时 **预填并锁定** 锚点 LAN + CE；用户仅改 Spoke 与 Hub WAN。若改选 **另一条空闲 LAN**（通常为**另一物理口 / 另一 inventory 行**）→ 切为 `DEDICATED_VRF` 并解锁 CE。

> **注意**：独立专网（路线 B）在 Hub 上通常占用 **另一条 LAN inventory 行**（另一物理口），而非「同一物理口不同 VRF」。判定以 **`lanInventoryId` 优先**，同 id 不同 `ifName` 视为不匹配。

**Hub LAN ↔ CE**：REUSE 占用 LAN 强关联锁定 CE；首条/DEDICATED 空闲 LAN 仅弱校验（VRF 不一致 warning，不阻断）。

**仅改 Hub WAN** 不影响 `hubVrfMode`（轴 1 / 轴 2 正交，§2.1）。

### 5.3 P5 实现分期

| 阶段 | 内容 | 状态 |
|------|------|------|
| **P5a** | Spoke PE 向导：LAN 禁 `editable-card`，固定单口 | **已完成** |
| **P5b** | Hub PE 向导：公网 BGP 与 WAN Tab 分层 | **已完成** |
| **P5c** | 隧道向导 Hub 列线性流 + 隐式 `hubVrfMode` | **已完成** |
| **P5c-intent** | Hub 客户侧 **intent 层** + inventoryId 精确匹配 + 真机时序修复（§5.4） | **已完成**（2026-07） |

### 5.4 P5c · Hub 客户侧 intent 层（2026-07 · 已实现）

P5c 将 §5.2 的隐式 `hubVrfMode` 推导下沉为 **可单测纯逻辑**，避免表单残留、异步锚点未到位、inventoryId/ifName 失步等时序问题。

#### 5.4.1 代码落点

| 层级 | 文件 | 职责 |
|------|------|------|
| **纯逻辑（权威）** | `frontend/.../srv6/srv6TunnelWizardHub.ts` | intent 解析、`hubVrfMode` 推导、LAN 占用态、锚点匹配、校验 |
| **UI 接线** | `frontend/.../srv6/Create.tsx` | 表单 watch、autofill、mount 清空、`customerSideTouched`、提交 payload |
| **Hub 状态 API** | `backend/.../sdn/srv6.hub.ts` | `GET .../hub`：`portRegistry[].lanInventoryId`；`tunnels[]` 含 `ceA`/`ceB` |
| **inventory 标注** | `backend/.../sdn/srv6.hubInventory.ts` | LAN 占用匹配 **`portRegistryLanMatchesInventoryItem`**（id 感知） |
| **单测** | `srv6TunnelWizardHub.test.ts`（**33**）、`srv6.hub.test.ts` + `srv6.hubInventory.test.ts` | intent / 锚点 / registry / 表单快照回归 |

#### 5.4.2 判定流水线

```text
表单 hubLan* / hubCe* + peHubStatus.tunnels
  → hubFormSnapshot（useWatch ∥ form store；确认步 Form 卸载仍可读）
  → pickHubReuseAnchorPreviewFromStatus（同步 LAN+CE，无需等 fetchSrv6Tunnel）
  → effectiveAnchor* = async anchor（fetch）∥ preview（status）
  → resolveHubVrfModeFromWizard（= intent + deriveHubVrfMode 单入口）
  → validateHubTunnelInventory
  → 提交时 computeHubVrfModeForValues 再次从 form 快照重算
```

**核心函数**：

| 函数 | 说明 |
|------|------|
| `resolveHubCustomerSideIntent` | **唯一意图入口**；显式选 **非锚点** 空闲 LAN、id/if 失步 → `explicit_dedicated`；**已对齐锚点 LAN** → `inherit_reuse`（**CE 偏离不切换模式**） |
| `deriveHubVrfMode` | **锚点 LAN 对齐**（`matchesReuseAnchorLan`）→ 优先 `REUSE_VRF`；其后 `explicit_dedicated`；`reuse_reusable` 须锚点匹配 |
| `resolveHubVrfModeFromWizard` | Create / 提交共用：封装 LAN 占用态 + intent + `deriveHubVrfMode` |
| `matchesHubReuseAnchorLan` | **`lanInventoryId` 优先**；id 相同但 `ifName` 不同 → **false**（防同口不同 VRF 误判） |
| `pickHubReuseAnchorPreviewFromStatus` | 从 `peHubStatus` 首条 `REUSE_VRF` 隧道同步锚点；`hubCeUuid` **可选**（CE 尚未写入 status 时不阻塞 LAN 匹配） |
| `shouldInheritReuseAnchor` | `resolveHubCustomerSideIntent === 'inherit_reuse'` 的语义别名，供 autofill / 只读 UI |

#### 5.4.3 Create.tsx 时序与守卫

| 机制 | 行为 |
|------|------|
| **hubFormSnapshot** | `useWatch` 为空时回退 `form.getFieldsValue()` / `formValues`；依赖 `current` 在确认步重算 |
| **提交重算** | `computeHubVrfModeForValues(values)` 与 UI 同源，避免 Step1 Alert 与 Step3 概要不一致 |
| **新建 mount 清空** | 无 `editId` 时清空 `hubWan*` / `hubLan*` / `pe*InnerIf`，重置 `hubReuseAnchor` 与 `customerSideTouched`（删隧道后二次创建不继承上一条表单） |
| **`customerSideTouched`** | state（驱动 intent）+ ref（autofill effect 内读最新值，防竞态） |
| **autofill 守卫** | 异步 `fetchSrv6Tunnel` 回填锚点前，若当前 LAN 已与锚点 **inventory 不一致**则 **跳过** 覆盖（用户已选独立专网口） |
| **autofill 匹配** | 使用 `matchesHubReuseAnchorLan`（非仅 `ifName`） |
| **提交** | 优先 `values.hubLanInventoryId` 写入 `hubBindings` |

#### 5.4.4 产品判定表（真机回归 · 2026-07）

| 用户操作 | 期望 `hubVrfMode` |
|----------|-------------------|
| Hub 已有 REUSE 锚点，**未动**客户侧（默认继承） | `REUSE_VRF` |
| 显式选 **非锚点空闲 LAN**（通常另一物理口 / inventory 行） | `DEDICATED_VRF` |
| 选 **锚点 / reuse_reusable LAN**（VRF 9999 · 可复用），Hub CE **可为非锚点 CE** | **`REUSE_VRF`**（模式由 **LAN** 决定；CE 可单独提示/校验） |
| 选回锚点 `reuse_reusable` LAN + 锚点 CE | `REUSE_VRF` |
| **仅改 Hub WAN** | 不影响 REUSE/DEDICATED |
| Step1 Alert 与 Step3「客户侧模式」概要 | **须一致**（`hubFormSnapshot` + 提交重算） |

冒烟用例映射：**HP.9–HP.13**（`testcases.md` §HP）。

#### 5.4.5 真机缺陷修复记录

| 提交 | 现象 | 根因 | 修复要点 |
|------|------|------|----------|
| `06adbc01` | 第二条 REUSE 隧道 Step3 误显示 `DEDICATED_VRF` | 空闲 LAN 默认未走继承；WAN 变更误触 `customerSideTouched` | idle + 有锚点时默认 `inherit_reuse`；WAN 与客户侧 touched 分离 |
| `2a564aa3` | 删 REUSE 第二条后，新 WAN + **不同物理口** + 新 CE 仍显示 `REUSE_VRF` | 默认继承 + 锚点 autofill + **表单残留** + 异步锚点 CE 未到位 | intent 层、`pickHubReuseAnchorPreviewFromStatus`、id 感知 registry、mount 清空、preview CE |
| `e4e0c2b3` | 前端 production build TS2322 | preview 返回 `hubCeUuid?: string` 与 `Pick<HubReuseAnchor>` 冲突 | preview 类型允许 optional `hubCeUuid` |
| `0931daab` | 锚点 LAN + 非锚点 CE 误判 DEDICATED；Step1「共用」与 Step3「独立专网」不一致 | 确认步 Form 卸载致 `useWatch` 空；CE 偏离误触发 dedicated | `hubFormSnapshot`、`resolveHubVrfModeFromWizard`、**锚点 LAN 对齐即 REUSE**；`computeHubVrfModeForValues` |

#### 5.4.6 已知遗留（P2 · 未做）

- `deriveHubVrfMode` 仍有多路径冗余，可进一步收敛为 intent 单入口输出。
- legacy 隧道无 `lanInventoryId` 时仍可能 ifName 级误判（建议数据补全 / 迁移）。
- 组件未 unmount 的极端导航路径仍可能残留表单（可考虑 route key）。

---

## 6. 文档与代码索引

| 主题 | 位置 |
|------|------|
| 本文（产品约束 + 遗留） | `docs/srv6-hub-pe-spec.md` |
| merge / recompute / §14 详述 | `docs/srv6-baseline-recompute.md` |
| 发版说明 | `docs/srv6-release-notes.md` |
| 冒烟 H1–H7 | `docs/srv6-testcases.md` |
| Hub inventory 类型 | `backend/src/routes/sdn/srv6.hubInventory.ts`、`frontend/.../routers/hubPeInventory.ts` |
| REUSE RD/RT | `backend/src/routes/sdn/srv6.reuseRdRt.ts`、`frontend/.../srv6/srv6RdRt.ts` |
| HUB_PE 角色向导 | `frontend/src/pages/sdncc/ibr/routers/wizards/PEWizard.tsx` |
| 隧道创建 | `frontend/src/pages/sdncc/ibr/srv6/Create.tsx` |
| Hub 客户侧 intent（纯逻辑） | `frontend/.../srv6/srv6TunnelWizardHub.ts` · `srv6TunnelWizardHub.test.ts` |
| Hub status / portRegistry | `backend/.../sdn/srv6.hub.ts` |

---

## 7. 修订记录

| 日期 | 说明 |
|------|------|
| 2026-06 | 初版：汇总 Hub 多 WAN/LAN UX 评审结论、RD/RT REUSE Spoke 独立 RD、inventory 单一入口、阻断矩阵与遗留 L-1～L-5 |
| 2026-06 | P1–P4 完成；P4 移除 `tunnel_inline`；全量 Code Review 见 `testcases.md` §HP Review 关注项 |
| 2026-06 | P5：真机验收 UX 修订（Spoke 单 LAN、Hub BGP 分层、隧道 Hub 列线性流、隐式 `hubVrfMode`） |
| 2026-07 | **P5c-intent**：`resolveHubCustomerSideIntent` 层、inventoryId 锚点匹配、preview CE、表单 mount 清空；真机修复 `06adbc01` / `2a564aa3` / `e4e0c2b3`；冒烟 **HP.9–HP.13** |
| 2026-07 | **P5c-intent.1**（`0931daab`）：`hubFormSnapshot` + `resolveHubVrfModeFromWizard`；锚点 LAN 决定 REUSE；Step1/Step3 模式一致 |
