# SRv6 隧道 · 发版前冒烟测试用例

> 适用范围：**P1–P4** baseline + 贡献 + recompute；**P5 真·Hub PE**（H1–H7、R-GW-1）代码已合入，见 [`docs/srv6-baseline-recompute.md`](../../../../../../docs/srv6-baseline-recompute.md) §14–§18。  
> 组网范围见 [`docs/srv6-baseline-recompute.md`](../../../../../../docs/srv6-baseline-recompute.md#140-架构总览定稿)。  
> 建议环境：具备四端 VR（PE-A、PE-B、CE-A、CE-B）的测试集群，管理员账号。

## 环境与执行说明

| 环境 | 用途 | 说明 |
|------|------|------|
| **本地代码仓** | 自动化签收（4-5） | `backend`: `npx tsc --noEmit` + `npx jest src/routes/sdn/srv6`；`frontend`: `npx react-scripts test --watchAll=false src/pages/sdncc/ibr/srv6` |
| **测试机 10.21.49.59** | 手工 H1–H7、R1–R2、R-GW-1 | **勿在发版准备阶段批量删改现网配置**；按下方清单逐项手工执行，角色迁移（Q-MIG-2）、删 `test-20260508` 等由运维择机处理 |

### 前置条件

- 四端 VR 已在「角色配置向导」中完成基础配置；PE 角色为 **`SPOKE_PE` 或 `HUB_PE`**（**取消 `PE` 旧值**）。
- Hub 场景：中心 PE 为 **`HUB_PE`**，Spoke 为 **`SPOKE_PE`**；创建向导 Step2 出现 **Hub 互联**（WAN 口、客户侧网络）。
- 测试账号具备 `networks.srv6:read` / `networks.srv6:write` 权限。

---

## R1 · 新隧道创建与四端生效配置

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

| 项 | 内容 |
|----|------|
| **步骤** | 1. 创建 **H 型**隧道 T1：Hub PE（如 PE3）+ Spoke PE22，Hub 互联选 WAN、客户侧「共用」<br>2. 同 Hub 上创建 T2：**不同 Spoke**（如 PE2）、**不同 PE–PE 公网 neighbor**；Hub LAN/VRF/CE **可复用**<br>3. 列表查看 **类型 / Hub 列**；`GET /api/networks/srv6/vr/:hubUuid/hub` 查看口占用 |
| **期望** | T2 创建成功；Hub 口占用表含两条 WAN 绑定；公网 `bgp[0]` 两个 neighbor |
| **失败信号** | 不同 Spoke 仍 409；Hub 口占用 / 列表未展示 |

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

### 本地自动化（发版前必跑 · WS-4 / G3）

- [ ] `cd backend && npx tsc --noEmit`
- [ ] `cd backend && npx jest src/routes/sdn/srv6`（当前 **74** 条）
- [ ] `cd frontend && CI=true npx react-scripts test --watchAll=false src/pages/sdncc/ibr/srv6`（**10** 条）

### Spoke 点对点（P1–P4 回归）

- [ ] R1 创建 + 四端配置重算
- [ ] R2 删除回退至基线
- [ ] R-GW-1 SID/64 via 择优（可选网关 / 直连对照）
- [ ] R5 对账扫描/修复 + 审计
- [ ] R6 VR 指纹锁 409
- [ ] R7 零隧道 / 最后一条隧道基线一致

### P5 真 Hub（测试机 10.21.49.59 · 手工，择机）

- [ ] H1–H3：R3 双 Spoke 成功 + 列表/Hub API
- [ ] H6：R4 重复 neighbor 409 单条文案
- [ ] H4/H5/H7：REUSE 双隧道 + 删一条后 RD/RT 仍正确
- [ ] （可选）DEDICATED 第二 Spoke 独立 VRF 段

---

## 相关 API（调试参考）

| 接口 | 用途 |
|------|------|
| `GET /api/networks/srv6/vr/:vrUuid/hub` | Hub 引用列表 + **口占用表** `portRegistry` |
| `GET/POST /api/networks/srv6/reconcile` | 配置对账 |
| `POST /api/networks/srv6/vr/:vrUuid/baseline/reset` | 零隧道基线重置 |
| 实现方案 §14–§18 | Hub 规格、并行计划、DoD |
