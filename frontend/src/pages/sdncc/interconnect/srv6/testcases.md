# SRv6 隧道 · 发版前冒烟测试用例

> 适用范围：**P1–P4** baseline + 贡献 + recompute；**P1–P4 Hub PE 多 WAN/LAN UX**（§HP）；**P5 真·Hub PE**（H1–H7、R-GW-1）；**P5.2b / WS-2b Hub inventory + 双轴互联 UI**（§14.17）。  
> 组网范围见 [`docs/srv6-baseline-recompute.md`](../../../../../../docs/srv6-baseline-recompute.md#140-架构总览定稿)。  
> Hub PE 产品约束：[`docs/srv6-hub-pe-spec.md`](../../../../../../docs/srv6-hub-pe-spec.md)。  
> 建议环境：具备四端 VR（PE-A、PE-B、CE-A、CE-B）的测试集群，管理员账号。

## 环境与执行说明

| 环境 | 用途 | 说明 |
|------|------|------|
| **本地代码仓** | 自动化签收（4-5） | `backend`: `npx tsc --noEmit` + `npx jest src/routes/sdn --runInBand`；`frontend`: `CI=true npx react-scripts test --watchAll=false src/pages/sdncc/ibr/srv6 src/pages/sdncc/ibr/routers/peWizardTabEdit.test.ts src/pages/sdncc/ibr/routers/peWizardWanRoutes.test.ts src/pages/sdncc/ibr/routers/hubPeInventory.test.ts` |
| **测试机** | 手工 **§HP**、H1–H7、R1–R2、R-GW-1、**8.1 路线 B** | **勿在发版准备阶段批量删改现网配置**；按下方清单逐项手工执行 |

### 前置条件

- 四端 VR 已在「角色配置向导」中完成基础配置；PE 角色为 **`SPOKE_PE` 或 `HUB_PE`**（**取消 `PE` 旧值**）。
- **Hub 场景**：中心 PE 为 **`HUB_PE`**，Spoke 为 **`SPOKE_PE`**；创建向导 Step2 出现 **Hub 互联**（双轴：① Hub WAN inventory ② 客户侧路线 A/B）。
- **Hub inventory**：存于 Hub PE 基线 `srv6BaselineJson._towerHubInventory`（API 字段名 `hubInventory`）；**仅在 HUB_PE 角色向导**维护多 WAN/LAN 卡片；隧道向导 **仅下拉选用**（P3/P4 已移除 `hubInventoryInline` / 内联新建）。
- Hub WAN/LAN **仅 inventory 下拉选用**，**禁止**手工填口名。
- 测试账号具备 `networks.srv6:read` / `networks.srv6:write` 权限。

---

## P1–P4 · Hub PE 多 WAN/LAN UX（§HP）

> 对照 [`docs/srv6-hub-pe-spec.md`](../../../../../../docs/srv6-hub-pe-spec.md) §1–§4。真机验收 **须先于或并行** P5 H1–H7 主路径。

| ID | 阶段 | 要点 | 自动化参考 |
|----|------|------|------------|
| **HP-P1** | P1 | HUB_PE 向导 WAN/LAN **editable-card** Tab；Tab 栏 `+` 增页；删页后表单同步 | `peWizardTabEdit.test.ts` |
| **HP-P2** | P2 | 每 WAN Tab：**IPv4 目的/优先级**、**IPv6 目的/网关**；保存后基线含 `ipv4_route`/`ipv6_route` + `_towerHubInventory`；Hub 时隐藏全局「静态路由（WAN）」 | `peWizardWanRoutes.test.ts` · `hubPeInventory.test.ts` |
| **HP-P2b** | P2b | Hub 隧道 SID/64 `via` 与 **所选 WAN** 网关一致；无网关时回退对端 PE 公网 IPv6 | `srv6Ipv6.test.ts` · `srv6Archive.test.ts` |
| **HP-P3** | P3 | 隧道向导 **Hub 分区**（①公网 WAN ②客户侧 ③LAN）；**无 inline 新建**；首条 REUSE 必选 Hub LAN+CE；后续 REUSE 继承锚点只读 | `srv6TunnelWizardHub.test.ts` |
| **HP-P4** | P4 | 保存 **不提交** `hubInventoryInline`；后端无 inline append；遗留 `tunnel_inline` 读库规范为 `role_wizard` | `srv6.hubInventory.test.ts` |

### HP 手工验收（测试机 · 建议顺序）

| # | 操作 | 通过标准 | ☐ |
|---|------|----------|---|
| HP.1 | HUB_PE 向导：新增 **2 个 WAN Tab** + **2 个 LAN Tab**，各填接口/地址/静态路由/VRF | 保存成功；基线 JSON 含 `_towerHubInventory.wan[]`/`lan[]` 各 ≥2 | |
| HP.2 | 查看基线 / 设备下发预览 | `ipv6_route[]` **仅** `destination`+`via`（**无 `dev`**）；`ipv4_route` 含 `dev` | |
| HP.3 | 创建 **首条 H 型**隧道：路线 A「共用」；选 Hub WAN #1 + Hub LAN #1 + Hub CE | 成功；`hubBindings.wanInventoryId`/`lanInventoryId` 有值 | |
| HP.4 | 同 Hub 创建 **第二条 REUSE**：仅选 Spoke + **不同 Hub WAN** | Hub LAN/CE/内网口 **只读**且与首条一致；保存成功 | |
| HP.5 | 第二条 REUSE 选 **与首条相同 WAN** | 下拉标注「已用于 T1 · 可复用」；仍可保存 | |
| HP.6 | 路线 B「独立」：选 **空闲 LAN** + Hub WAN | 成功；Hub 侧新增 dedicated `bgp[N]` | |
| HP.7 | inventory 为空时打开隧道向导 | **阻断**创建；文案含「HUB_PE 角色配置向导」 | |
| HP.8 | 删 HP.3–HP.6 测试隧道（勾选回退） | neighbor/私网段摘净；**inventory 口项仍在** Hub 基线 | |

**Review 关注（发版前必验）**：

| 标记 | 场景 | 期望 |
|------|------|------|
| ⚠️ **R-HP-1** | Hub 上 **先建 DEDICATED、再建 REUSE**（非常规顺序） | REUSE 应继承 **首条 REUSE 隧道** 的 LAN/CE，而非 DEDICATED 首条（见 Code Review MAJOR #1） |
| ⚠️ **R-HP-2** | 多 WAN 均为 `::/0` + 不同 `via`，设备回读 PE 向导 | 各 WAN Tab 网关 **不串口**；必要时以 inventory 已存值为准 |

---

| 项 | 内容 |
|----|------|
| **步骤** | 1. 进入 SRv6 创建向导，选择四端 VR（Spoke 点对点：两端均为 SPOKE_PE）<br>2. 完成 PE/CE 互联参数<br>3. 点击「创建隧道并保存到平台」<br>4. （可选）进入下发向导，分步预览四端配置 |
| **期望** | 创建成功；提示「四端生效配置已由平台重算并写入库」<br>平台库中四端 VR 的生效配置 = 向导基线 + 本隧道贡献 |
| **失败信号** | 400/409 报错；四端配置未变化或缺少基线 |

---

## R2 · 删除隧道并回退配置

| 项 | 内容 |
|----|------|
| **步骤** | 1. 在隧道列表删除 R1 创建的隧道<br>2. 勾选「回退平台库中的隧道注入项」<br>3. 确认删除 |
| **期望** | 删除成功；四端 VR 生效配置回到创建前的向导基线（Spoke 点对点 / PE22 类场景） |
| **失败信号** | 400「缺少配置变更记录」或「尚未保存向导基线」；四端配置仍含已删隧道的邻居/路由 |

---

## R-GW-1 · Spoke 点对点 · SID/64 `via` 择优（§14.14.1）

| 项 | 内容 |
|----|------|
| **步骤** | 1. 在 **Spoke PE** 角色向导配置 WAN **静态路由（WAN）**（`ipv6_route` 无 vrf，含有效 **IPv6 网关** `via`）<br>2. 创建 **S 型**隧道（两端 SPOKE_PE），保存并查看档案 / 预览中的 SID/64 路由<br>3. 对比：同一对端 **未配** 本端 IPv6 网关时新建 S 隧道（直连） |
| **期望** | 已配网关时：SID/64 的 `via` = **本端 IPv6 网关**；`::/0` + `nexthop-vrf 0` **不变**<br>未配网关时：与 P1–P4 **一致**，`via` = 对端 PE 公网 IPv6（**零行为差异**） |
| **自动化** | `frontend/.../ibr/srv6/srv6Ipv6.test.ts` · `resolveSid64Via` |
| **失败信号** | 有网关仍走对端 IP；无网关时行为与旧版不一致 |

---

## R3 · Hub PE 多隧道（不同 Spoke / neighbor）

> **状态**：**P5 已实现** — 验收 **H1–H3**。自动化见 `srv6.scenarios.test.ts` · PE3 REUSE 双 Spoke。  
> **P5.2b**：Hub WAN 从 **inventory 下拉**选用；占用标注见 `hubInventoryUi`（`GET .../hub`）。

| 项 | 内容 |
|----|------|
| **步骤** | 1. **HUB_PE 角色向导**维护 Hub WAN/LAN inventory（或多 WAN 卡片）并下发<br>2. 创建 **H 型**隧道 T1：Hub + Spoke，Hub 互联 **① 从 inventory 选用 WAN**、**② 客户侧「共用」**（路线 A）<br>3. 同 Hub 上创建 T2：**不同 Spoke**、**不同 PE–PE 公网 neighbor**；WAN 可同口可异口<br>4. `GET /api/networks/srv6/vr/:hubUuid/hub` 查看 `portRegistry` + `hubInventoryUi` |
| **期望** | T2 创建成功；WAN 下拉含 `[空闲]` / `[已用于 T1 · 可复用]`；公网 `bgp[0]` 两个 neighbor；`hubBindings.wanInventoryId` 有值 |
| **失败信号** | 仍出现手工填口名；inventory 空且无引导；选用后缺 `wanInventoryId` |

---

## R4 · Hub 冲突拒绝（C-H1 · 复用 PE–PE neighbor）

> **状态**：**P5 已实现** — 验收 **H6**。Blocking 键：`(hubPeUuid, peerPublicNeighbor)`。

| 项 | 内容 |
|----|------|
| **步骤** | 1. 创建 T3，与 T1/T2 **复用相同对端 Spoke 公网 neighbor**（同一 `peerPublicNeighbor`）<br>2. 点击保存 |
| **期望** | HTTP **409**；toast **一条**中文说明（如「公网 BGP 邻居 x 已在 Hub 设备上被隧道 xxx 使用」），**不**堆砌 RD/内网口/::/0 等从属项 |
| **失败信号** | 重复 neighbor 仍保存成功；409 多条冲突 |

---

## R5 · 配置对账扫描与修复

| 项 | 内容 |
|----|------|
| **步骤** | 1. 隧道列表 →「配置对账」<br>2. 点击「重新扫描」<br>3. 若有问题项，点击「扫描并修复」<br>4. 系统设置 → 审计日志，检索 SRv6 Reconcile |
| **期望** | 正常时显示「暂无漂移项」；人为制造漂移后可检出中文问题描述并修复；审计有对账记录 |
| **失败信号** | 问题描述含 config_json、baseline+Σcontrib；修复后仍漂移 |

---

## R6 · 改 WAN 指纹不一致 → 保存 VR 配置

| 项 | 内容 |
|----|------|
| **步骤** | 1. 某 VR 已被存活隧道引用<br>2. 在 VR 配置页修改公网 IPv6 / SID 前缀 / **Hub 已绑定 wanIf** 等关键项并保存 |
| **期望** | HTTP 409；提示「已被 SRv6 隧道引用，关键配置不允许修改」，并列出中文关键项名称 |
| **失败信号** | 静默保存成功；字段名显示 publicIpv6 等英文键 |

---

## R7 · 删除 Hub 上最后一条 / 非最后一条隧道（H7）

| 项 | 内容 |
|----|------|
| **步骤 A** | 删除 Hub 上 **非最后一条** Spoke 隧道（REUSE 模式）：仅摘本 Spoke 公网 neighbor；私网 RD/RT **不变** |
| **步骤 B** | 删除 **最后一条** Spoke 隧道：私网 `bgp[vrfIndex]` 回到基线（无该隧道贡献） |
| **步骤 C** | 打开「配置对账」扫描 Hub PE |
| **期望** | 步骤 A 后其余隧道仍可用；步骤 B 后无残留 neighbor/RD/RT；对账无 ORPHAN 漂移 |
| **自动化** | `srv6.merge.test.ts` · H7 REUSE；`srv6.scenarios.test.ts` · PE3 |

---

## P5.2b · Hub inventory 与双轴 UI（WS-2b）

| ID | 要点 | 自动化参考 |
|----|------|------------|
| **NR-1** | Spoke–Spoke（S）merge 不受基线 `_towerHubInventory` 影响 | `srv6.merge.test.ts` · NR-1；`srv6.scenarios.test.ts` · P5.2b NR |
| **NR-2** | Hub 首条路线 A：inventory WAN 物化 + 单私网 bgp 段 | `srv6.scenarios.test.ts` · NR-2 |
| **NR-3** | Hub 第二条路线 A（REUSE）：不增 dedicated `bgp[N]` | `srv6.scenarios.test.ts` · NR-3 |
| **INV-1** | inventory 解析/剥离/legacy `tunnel_inline` 归一化 / baseline 口登记 | `srv6.hubInventory.test.ts` |
| **INV-2** | merge 物化 `interfaces_*` / 路线 B `bgp[N]` | `srv6.merge.test.ts` · P5.2b materialize |
| **INV-3** | archive 用 inventory WAN IPv6（Hub 配置无 WAN 口时） | `srv6Archive.test.ts` · hub inventory wan |
| **INV-4** | HUB_PE 向导序列化 `_towerHubInventory` | `hubPeInventory.test.ts` + 手工 HP.1 |
| **INV-5** | `resolveHubBindingsWithInventory` baseline 口升格 + `patchHubBindingsInventoryIds` | `srv6.hubInventory.test.ts` |
| **INV-6** | Hub 多 WAN 指纹锁 / set-role（A11/A12） | `srv6.vrLock.test.ts` |

---

## P5 · Hub 规格对照（H1–H7）

| ID | 手工要点 | 自动化参考 |
|----|----------|------------|
| **H1** | 同 Hub 多 Spoke，公网 neighbor 唯一 | `srv6.hub.test.ts` C-H1 |
| **H2** | 每隧道独立 Hub WAN 绑定 | Create Hub 互联 + hub API `portRegistry` |
| **H3** | LAN/VRF/CE 可复用；A 模式私网 neighbor 零增量 | `srv6.conflict.test.ts` REUSE |
| **H4** | 同 VRF 一个 RD | `srv6.merge.test.ts` REUSE |
| **H5** | **A**：与首条相同 RT；**B**：每 Spoke 独立 RT | merge REUSE / DEDICATED 用例 |
| **H6** | 409 仅 Blocking 主因 | `pickPrimaryConflicts` |
| **H7** | 删单条不误拆共享 RD/RT | merge + scenarios |

---

## 历史隧道与角色迁移

| 项 | 内容 |
|----|------|
| **无档案隧道** | 删除时 400/409 中文引导；不自动迁移 |
| **Q-MIG-2 · `role=PE`** | VR 管理页改为 `SPOKE_PE` 或 `HUB_PE` 后再建隧道；**测试机现网数据勿批量脚本修改** |
| **删 `test-20260508`** | 测试机清理项，**运维手工**执行，非发版阻塞 |

---

## 快速检查清单

### 本地自动化（发版前必跑 · P1–P4 + WS-2b）

- [ ] `cd backend && npx tsc --noEmit`
- [ ] `cd backend && npx jest src/routes/sdn --runInBand`
- [ ] `cd frontend && CI=true npx react-scripts test --watchAll=false src/pages/sdncc/ibr/srv6 src/pages/sdncc/ibr/routers/peWizardTabEdit.test.ts src/pages/sdncc/ibr/routers/peWizardWanRoutes.test.ts src/pages/sdncc/ibr/routers/hubPeInventory.test.ts`

### P1–P4 Hub PE UX（测试机 · 手工 §HP）

- [ ] **HP.1–HP.2**：HUB_PE 多 WAN/LAN Tab + 静态路由/下发预览
- [ ] **HP.3–HP.5**：首条/后续 REUSE 隧道 + WAN 复用标注
- [ ] **HP.6**：路线 B DEDICATED + 空闲 LAN
- [ ] **HP.7–HP.8**：inventory 阻断 + 删隧道不回收 inventory
- [ ] **R-HP-1**（Review 关注）：DEDICATED 首条 + REUSE 第二条锚点是否正确

### P5.2b 非回归（合入门禁 · 须先于 8.1）

- [ ] NR-1：S 型 merge 与 inventory 扩展共存（自动化已覆盖）
- [ ] NR-2：Hub 首条路线 A + inventory 物化（自动化已覆盖）
- [ ] NR-3：Hub 第二条路线 A REUSE（自动化已覆盖）

### Spoke 点对点（P1–P4 回归）

- [ ] R1 创建 + 四端配置重算
- [ ] R2 删除回退至基线
- [ ] R-GW-1 SID/64 via 择优（可选网关 / 直连对照）
- [ ] R5 对账扫描/修复 + 审计
- [ ] R6 VR 指纹锁 409
- [ ] R7 零隧道 / 最后一条隧道基线一致

### P5.2b Hub inventory（测试机 · 手工 8.1）

- [ ] **1.5b / HP.1** HUB_PE 角色向导：多 WAN + LAN inventory 卡片 → 基线含 `_towerHubInventory`
- [ ] 8.1a–8.1d（见附录 A 阶段 8；**无 8.1b 内联新建**）
- [ ] 选用 baseline 口后 `GET .../hub` 可见 inventory 项；删隧道后 **inventory 仍在**

### P5 真 Hub（测试机 · 手工，择机）

- [ ] H1–H3：R3 双 Spoke 成功 + 列表/Hub API
- [ ] H6：R4 重复 neighbor 409 单条文案
- [ ] H4/H5/H7：REUSE 双隧道 + 删一条后 RD/RT 仍正确
- [ ] （可选）DEDICATED 第二 Spoke 独立 VRF 段

---

## 相关 API（调试参考）

| 接口 | 用途 |
|------|------|
| `GET /api/networks/srv6/vr/:vrUuid/hub` | Hub 引用 + `portRegistry` + **`hubInventory` / `hubInventoryUi`**（占用标注） |
| `POST /api/networks/srv6` | 创建隧道；Hub 绑定由 `hubBindings` + 服务端 `resolveHubBindingsWithInventory` 补全 inventoryId |
| `GET/POST /api/networks/srv6/reconcile` | 配置对账 |
| `POST /api/networks/srv6/vr/:vrUuid/baseline/reset` | 零隧道基线重置 |
| 实现方案 §14.17、§18 WS-2b | Hub inventory、双轴 UI、merge 物化 |

### 实现落点（P5.2b 代码索引）

| 层 | 路径 | 职责 |
|----|------|------|
| 后端 | `backend/src/routes/sdn/srv6.hubInventory.ts` | `_towerHubInventory` 读写、占用 UI、baseline 口登记、merge 物化、`patchHubBindingsInventoryIds` |
| 后端 | `backend/src/routes/sdn/srv6.hub.ts` | `GET .../hub` 返回 inventory |
| 后端 | `backend/src/routes/sdn/srv6.merge.ts` | merge 前物化 inventory → `interfaces_*` / 路线 B `bgp[N]` |
| 后端 | `backend/src/routes/sdn/srv6.ts` | POST/PUT：`resolveHubBindingsWithInventory` → sync |
| 前端 | `frontend/.../ibr/routers/hubPeInventory.ts` + `PEWizard.tsx` | HUB_PE 向导 inventory 多 Tab（P1/P2） |
| 前端 | `frontend/.../ibr/srv6/Create.tsx` + `srv6TunnelWizardHub.ts` | Hub 分区 UI、首条/后续 REUSE（P3） |
| 前端 | `frontend/.../ibr/srv6/srv6Ipv6.ts` + `srv6Archive.ts` | SID/64 via 按 WAN 择优（P2b） |

---

## 附录 A · 测试机 `10.21.49.59` 手工验收 Checklist（按操作顺序）

> **用途**：部署 P5 到测试机后，按阶段逐项打勾；与上文 R1–R7、R-GW-1、H1–H7 用例一一对应。  
> **原则**：不批量脚本改现网；每步记录隧道名、VR UUID、截图或审计条目。  
> **参考 VR（以测试机实际名称为准）**：Hub **PE3**；Spoke **PE22 / PE2**；CE **CE3 / CE22 / CE2**。

### 建议总顺序

```
阶段 0 部署与台账 → 1 角色/基线（含 HP.1） → 1b P1–P4 Hub UX（HP.2–HP.8）
→ 2 R1/R2 → 3 R-GW-1 → 4 R3(T1,T2) → 5 R4(T3 负例) → 6 R7 → 7 R5/R6 → 8 可选清理 → 9 签收
```

---

### 阶段 0 · 部署与开工前（一次性）

| # | 操作 | 通过标准 | ☐ |
|---|------|----------|---|
| 0.1 | 将含 P5 的前后端部署到 `10.21.49.59` | 可登录；版本与预期一致 | |
| 0.2 | 管理员账号；确认 `networks.srv6:read` / `write` | 能进入 SRv6 隧道列表 | |
| 0.3 | **台账**（只读）：参与 VR 的 `role`、历史隧道（如 `test-20260508`） | 写入验收记录 | |
| 0.4 | SRv6 列表 → **配置对账** → **重新扫描**（先不修） | 了解当前漂移基线 | |

**注意**：`test-20260508`、批量 `role=PE` 迁移放在 **阶段 8**，主路径勿先删历史隧道。

---

### 阶段 1 · 角色与向导基线（Q-MIG-2，按需）

仅处理**本次用到的 VR**，勿全库批量改。

| # | 操作 | 通过标准 | ☐ |
|---|------|----------|---|
| 1.1 | Hub 中心 PE（如 PE3）→ 角色 **`HUB_PE`** | 保存成功 | |
| 1.2 | Spoke PE（PE22、PE2 等）→ 角色 **`SPOKE_PE`** | 保存成功 | |
| 1.3 | 仍为 **`PE`** 的 VR → 改为 `SPOKE_PE` 或 `HUB_PE` | 建隧道不报「角色 PE 已废弃」 | |
| 1.4 | 各参与 VR → **角色配置向导** → 保存基线 | 基线已保存 | |
| 1.5 | **HUB_PE** 向导：维护 **Hub WAN inventory**（可多卡）+ **LAN inventory**；每 WAN 配静态路由/IPv6 网关；保存后基线含 `_towerHubInventory` | `GET .../hub` 的 `hubInventory` 非空；见 **HP.1–HP.2** | |

---

### 阶段 1b · P1–P4 Hub PE UX（§HP · 真机）

| # | 操作 | 通过标准 | ☐ |
|---|------|----------|---|
| 1b.1 | **HP.3** 首条 H 型 REUSE：选 Hub WAN + Hub LAN + Hub CE | `hubBindings` 含 inventoryId；Hub LAN/CE 可编辑 | |
| 1b.2 | **HP.4** 第二条 REUSE：Hub LAN/CE **只读** | 与首条一致；仅选 Spoke + Hub WAN | |
| 1b.3 | **HP.5** 同 WAN 复用 | 下拉「已用于 … · 可复用」 | |
| 1b.4 | **HP.6** 路线 B DEDICATED | 独立 LAN + 新 `bgp[N]` | |
| 1b.5 | **HP.7** 清空 inventory 后试建隧道 | 阻断 + 角色向导引导文案 | |
| 1b.6 | **R-HP-1**（可选负例）：先 DEDICATED 再 REUSE | 记录 REUSE 锚点是否与首条 REUSE 一致 | |
| 1.6 | Spoke PE：向导保持 1 WAN + LAN；**不写** inventory | S 型创建不受影响 | |

---

### 阶段 2 · Spoke 点对点回归（R1 → R2）

建议专用隧道名（如 `smoke-s-YYYYMMDD`），与现网区分。

| # | 操作 | 通过标准 | ☐ |
|---|------|----------|---|
| 2.1 **R1** | 创建向导：两端 **SPOKE_PE**；四端 VR；**创建并保存到平台** | 成功提示含四端重算；列表类型 **Spoke 点对点** | |
| 2.2 | （可选）下发向导预览四端 | 含 neighbor、SID/64、`::/0` + `nexthop-vrf 0` | |
| 2.3 | 查看四端平台库 config | 生效配置 ≈ 基线 + 本隧道贡献 | |
| 2.4 **R2** | 删除 2.1 隧道，勾选 **回退平台库中的隧道注入项** | 四端回到建隧道前基线 | |

---

### 阶段 3 · IPv6 网关择优（R-GW-1）

| # | 操作 | 通过标准 | ☐ |
|---|------|----------|---|
| 3.1 | 选一 Spoke PE → 向导配置 **IPv6 网关**（WAN 静态路由，无 vrf）→ 保存基线 | 基线含网关路由 | |
| 3.2 | 建 **S 型**隧道，查看 SID/64 | `via` = **本端 IPv6 网关** | |
| 3.3 | 确认 **`::/0` + `nexthop-vrf 0`** 未变 | 与 P1–P4 一致 | |
| 3.4 | **对照**：未配网关的 Spoke 再建 S 隧道 | `via` = **对端 PE 公网 IPv6** | |
| 3.5 | 删除 3.2–3.4 测试隧道（勾选回退） | 不影响后续 Hub 用例 | |

---

### 阶段 4 · Hub 双 Spoke 创建（R3 · H1–H5）

客户侧选 **「与已有隧道共用客户侧网络」**（路线 A · `REUSE_VRF`）。

| # | 操作 | 通过标准 | ☐ |
|---|------|----------|---|
| 4.1 **T1** | H 型：**HUB_PE（PE3）** + **SPOKE_PE（PE22）**；Hub WAN；客户侧 **共用**；保存 | 列表 **Hub–Spoke**；Hub 列有信息 | |
| 4.2 | `GET /api/networks/srv6/vr/{PE3 uuid}/hub` 或 UI 口占用 | `portRegistry` 含 T1 | |
| 4.3 **T2** | 同 Hub + **不同 Spoke（PE2）**、**不同**公网 neighbor；LAN/CE 可复用；客户侧 **共用** | 创建成功；公网两个 neighbor | |
| 4.4 | 再查 Hub API / 列表 | `portRegistry` **两条**（H2） | |
| 4.5 | 查看 Hub 私网 bgp 段 | **一个 RD**（H4）；**RT 与 T1 相同**（H5） | |

---

### 阶段 5 · Hub 冲突（R4 · H6）

在 **T1、T2 仍存在** 时执行。

| # | 操作 | 通过标准 | ☐ |
|---|------|----------|---|
| 5.1 **T3（负例）** | 再建 H 隧道，**复用** T1/T2 的相同 Spoke 公网 neighbor | HTTP **409** | |
| 5.2 | 查看错误文案 | **一条**中文主因；不堆砌 RD/内网口/::/0 | |

---

### 阶段 6 · Hub 删除语义（R7 · H7）

针对阶段 4 的 T1、T2（REUSE）；顺序：**4 → 5 → 6**。

| # | 操作 | 通过标准 | ☐ |
|---|------|----------|---|
| 6.1 | 删除 **非最后一条**（如 T2），勾选回退 | 仅摘该 Spoke 公网 neighbor；**RD/RT 不变** | |
| 6.2 | 删除 **最后一条**，勾选回退 | Hub 私网 bgp 回基线；无残留 neighbor/RD/RT | |
| 6.3 | **配置对账** 扫描 Hub PE | 无 ORPHAN / 持续漂移 | |

---

### 阶段 7 · 运维能力（R5、R6）

| # | 操作 | 通过标准 | ☐ |
|---|------|----------|---|
| 7.1 **R5** | 配置对账 → 重新扫描 | 正常时「暂无漂移项」 | |
| 7.2 | （可选）人为漂移后 **扫描并修复** | 可修复；审计有 Reconcile | |
| 7.3 **R6** | 被引用 VR 修改公网 IPv6 / SID 前缀 / Hub **wanIf** 等 | **409**；中文关键项名称 | |

---

### 阶段 8 · Hub inventory 与路线 B（P5.2b · §14.17）

| # | 操作 | 通过标准 | ☐ |
|---|------|----------|---|
| 8.0 | **NR 回归**：本地跑通 `jest src/routes/sdn` + 前端 `ibr/srv6` 单测 | NR-1～NR-3 全绿 | |
| 8.1a | **路线 B · WAN 复用**：客户侧选「独立」；Hub WAN **从 inventory 选用 T1 同口** | 新 `bgp[N]` + 独立 RT；下拉 `[已用于 T1 · 可复用]` | |
| 8.1b | **路线 A · WAN 异口**：客户侧「共用」；Hub WAN **与 T1 不同 inventory 口** | 同 VRF/RT；`bgp[0]` 新 neighbor；私网段不增 | |
| 8.1c | 删 8.1a 路线 B 测试隧道（勾选回退） | neighbor/私网段摘净；**inventory 口项仍在** Hub 基线 | |
| 8.1d | Hub 生效配置：选用的 WAN 在 merge 后出现在 `interfaces_*` | 对账无异常；设备下发预览无 `_towerHubInventory` | |
| 8.2 | 删历史隧道 **`test-20260508`**（业务确认后） | 按策略回退 | |
| 8.3 | 全量配置对账扫描 | 漂移已处理或已登记 | |

**UI 约束**：Hub WAN/LAN **仅 inventory 下拉**（角色向导维护）；占用标注与 `GET .../hub` · `hubInventoryUi` 一致。

**非回归（合入前必跑）**：NR-1（S 型）、NR-2（Hub 首条 A）、NR-3（Hub 第二条 A）— 自动化见 `srv6.scenarios.test.ts` · `P5.2b NR`；**通过后**再验 8.1 路线 B。

---

### 阶段 9 · 签收

| 项 | ☐ |
|----|---|
| 本地自动化（backend sdn + frontend P1–P4 单测） | |
| **§HP** HP.1–HP.8 + R-HP-1 | |
| NR-1 / NR-2 / NR-3 | |
| R1 / R2（S 型） | |
| R-GW-1（网关 + 直连对照） | |
| R3（H1–H3）+ R4（H6） | |
| H4 / H5 / H7（REUSE 删建） | |
| P5.2b：8.1a–8.1d（路线 B + inventory） | |
| R5 / R6 | |
| 验收人 / 日期 / 备注：________________ | |

---

### 附录 A · 调试 API

```http
GET  /api/networks/srv6/vr/{hubPeUuid}/hub
GET  /api/networks/srv6/reconcile
POST /api/networks/srv6/reconcile
```

POST body 修复示例：`{ "repair": true }`
