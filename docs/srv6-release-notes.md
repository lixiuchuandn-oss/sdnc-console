# SRv6 隧道 · 发版说明（baseline + 贡献 + recompute + P5 Hub）

> **功能批次**：SRv6 配置管理架构升级（**P1–P5**，不含 Post-P5 多 RT 空格串）  
> **实现方案（详细）**：[`docs/srv6-baseline-recompute.md`](./srv6-baseline-recompute.md)  
> **Hub PE 产品规格与遗留**：[`docs/srv6-hub-pe-spec.md`](./srv6-hub-pe-spec.md)  
> **冒烟用例**：[`frontend/src/pages/sdncc/interconnect/srv6/testcases.md`](../frontend/src/pages/sdncc/interconnect/srv6/testcases.md)  
> **建议平台版本**：与下一 PATCH 发版对齐（发版时同步 bump `backend/package.json` 与 `frontend/package.json` 的 `version`）

---

## 摘要

SRv6 四端配置管理采用 **「向导基线 + 隧道贡献 + 服务端重算」**。**P5** 交付 **真·Hub PE 组网**（`HUB_PE` / `SPOKE_PE`、Hub 档案、C-H1 Blocking、merge/recompute Hub 分支、创建向导 Hub 互联 UI、§14.14.1 SID/64 `via` 择优）。

**不兼容**：无关系档案/无基线的历史隧道自动回退；库内 `role=PE` 的 VR **不自动迁移**。  
**Post-P5 遗留**：设备/CSM 支持空格多 `route_target` 后的完整多 RT merge（§14.4.7）。

---

## P5 新能力（相对 P1–P4）

### 角色与拓扑

- VR 角色：**`SPOKE_PE`**（分支）、**`HUB_PE`**（中心）；**取消 `PE` 枚举**。
- 隧道拓扑：**S** Spoke 点对点（双 SPOKE_PE）；**H** Hub–Spoke（恰一 HUB_PE + 一 SPOKE_PE）。

### Hub 档案与 API

- 隧道字段：`tunnelTopology`、`hubPeSlot`、`hubBindings`、`hubVrfMode`。
- `GET /api/networks/srv6/vr/:vrUuid/hub`：引用隧道 + **`portRegistry`** 口占用表。
- 冲突 **C-H1**：`(hubPeUuid, peerPublicNeighbor)` Blocking；409 优先单条主因（H6）。

### Merge / Recompute（§14.4.6）

| 模式 | 行为 |
|------|------|
| **`REUSE_VRF`（路线 A · 当前阶段）** | 同 VRF `bgpIndex`：**首条**确立 RD/RT，后续 Spoke **不覆盖**；删非最后一条 **不动** RD/RT |
| **`DEDICATED_VRF`（路线 B）** | 每 Spoke 独立 `bgp[N]` + RD/RT |

### 前端

- 创建向导：**Hub 互联**（WAN/LAN、客户侧网络文案 §14.16）、拓扑/Hub 列表列。
- **`resolveSid64Via`**：本端 WAN 有 IPv6 网关时用网关，否则对端公网 IPv6（R-GW-1）。
- PE 向导：URL `?peRole=HUB_PE`；文案「IPv6 网关」「静态路由（WAN）」。

### P5.2b · Hub inventory 与双轴 UI（WS-2b）

- Hub PE 基线 **`_towerHubInventory`**（API：`hubInventory` / `hubInventoryUi`）：WAN/LAN 能力池；**删隧道不回收** inventory 口项。
- **HUB_PE 角色向导**：多 WAN inventory 卡片 + LAN inventory 序列化；设备下发前剥离 Tower 扩展字段。
- **隧道创建向导**：双轴 UI（① Hub WAN ② 路线 A/B）；inventory **下拉选用**或**内联新建**（`hubInventoryInline`）；**无手工填口名**。
- **`hubBindings`** 扩展：`wanInventoryId` / `lanInventoryId`；POST 创建后 `patchHubBindingsInventoryIds`。
- **merge 物化**：首引用将 inventory 写入 `interfaces_*`；路线 B 物化独立 `bgp[N]`。
- **`srv6Archive`**：Spoke 解析 Hub 公网 IPv6 时优先 inventory WAN 地址。

---

## 仍支持的能力（P1–P4）

- 向导基线、隧道贡献、平台生效配置恒等式、配置对账、VR 指纹锁。
- Spoke 点对点 **直连**场景与 P4 **零行为差异**（R1/R2 回归）。
- 四端下发向导（preview/push）路径不变。

---

## 行为变更（相对 P1–P4 发版）

| 场景 | P1–P4 | P5 |
|------|-------|-----|
| Hub 第二隧道 | 409 误报 / 跳过验收 | H 型 + REUSE/DEDICATED 可创建（H1–H3） |
| 重复 Hub 公网 neighbor | 多条冲突 | **C-H1** 单条 409 |
| 同 Hub 同 VRF 第二 RT | 后者覆盖前者 | REUSE：**保留首条 RT** |
| SID/64 `via` | 始终对端公网 IPv6 | 本端有 WAN 网关时 **择优**（R-GW-1） |
| VR 角色 | 曾用 `PE` | 须 **SPOKE_PE / HUB_PE** |

---

## 兼容性说明

### 历史隧道 / 角色

- 无 `injectedDelta` / 无 `srv6BaselineJson`：删除回退 **400/409**，引导对账或手工处理。
- **`role=PE`**：创建/更新隧道 **409**；须在 VR 页改为 SPOKE_PE 或 HUB_PE（Q-MIG-2）。

### 测试机 10.21.49.59

- **发版包验收不依赖**对该环境的批量删改；H1–H7、R3/R4、R-GW-1 见 `testcases.md` **手工清单**，由运维择机执行。
- 清理项（如删 `test-20260508`）**非代码仓阻塞项**。

### 数据库

- P5 新增列：`SRv6Tunnel.tunnelTopology`、`hubPeSlot`、`hubBindings`、`hubVrfMode`（`DB_SYNC=true` 时 SQLite 自动同步）。

---

## 本地自动化签收（WS-2b / G3 · 必跑）

```bash
cd backend && npx tsc --noEmit
cd backend && npx jest src/routes/sdn --runInBand
cd frontend && CI=true npx react-scripts test --watchAll=false src/pages/sdncc/ibr/srv6 src/pages/sdncc/ibr/routers/hubPeInventory.test.ts
```

| 套件 | 规模（当前） |
|------|----------------|
| `backend/src/routes/sdn/*.test.ts` | **106** tests / **13** suites |
| `frontend/src/pages/sdncc/ibr/srv6/*.test.ts` | **11** tests / **2** suites |
| `frontend/src/pages/sdncc/ibr/routers/hubPeInventory.test.ts` | **5** tests / **1** suite |

**P5.2b 新增覆盖**：`srv6.hubInventory.test.ts`、`srv6.merge.test.ts`（materialize + NR-1）、`srv6.scenarios.test.ts`（NR-1～NR-3）、`srv6Archive.test.ts`（inventory WAN IPv6）。**P5.2b.1**：`srv6.vrLock.test.ts`（A11/A12）、`hubPeInventory.test.ts`、`resolveHubBindingsWithInventory`（PUT 内联 append）。

---

## 升级与发版步骤（运维）

1. 部署前后端同一 PATCH；确认 DB schema 含 P5 列。  
2. SRv6 列表 → **配置对账** 全量扫描。  
3. 台账：`role=PE` VR、无档案历史隧道。  
4. 本地/CI 自动化签收通过后，在测试机按 `testcases.md` **手工**执行 R1–R2、R-GW-1、R3/R4（H1–H6）、R5–R7。  
5. 审计：Create/Update/Delete、Reconcile、Baseline Reset。

---

## 验证清单（发版签收）

### 代码仓（WS-0～WS-3 + WS-2b 自动化）

- [x] `npx tsc --noEmit`（backend）
- [x] `npx jest src/routes/sdn` 全绿（**106**）
- [x] 前端 `srv6Ipv6` + `srv6Archive` 单测（**11**）
- [x] **P5.2b.1**：`srv6.vrLock`（A11/A12）、`hubPeInventory`（**5**）、PUT 内联 append
- [x] P5 场景：`scenarios` PE3、`merge` REUSE/DEDICATED、`hub` C-H1
- [x] **P5.2b**：`hubInventory`、merge 物化、**NR-1～NR-3**

### 测试机（手工 · 不阻塞发版包合入）

- [ ] R1/R2 Spoke 回归  
- [ ] R-GW-1  
- [ ] R3/R4（H1–H3、H6）  
- [ ] H4/H5/H7 Hub REUSE 删建  
- [ ] R5–R7、R6 Hub wanIf 锁  
- [ ] **P5.2b**：HUB_PE inventory 向导、8.1a–8.1e（路线 B + 内联新建 + inventory 永久保留）

---

## 相关文档

| 文档 | 路径 |
|------|------|
| 实现方案 | `docs/srv6-baseline-recompute.md`（§14–§18） |
| 冒烟用例 | `frontend/.../interconnect/srv6/testcases.md` |
| API 索引 | `AGENTS.md` |

---

## 修订记录

| 日期 | 批次 | 说明 |
|------|------|------|
| 2026-06 | P1–P4 | 初版发版说明 |
| 2026-06 | P5 方案 | §14–§15 定稿；角色 HUB_PE/SPOKE_PE |
| 2026-06-17 | **P5 代码合入 + WS-4** | Hub 档案/UI/merge/单测；测试机手工清单 |
| 2026-06-23 | **P5.2b / WS-2b** | Hub inventory、双轴 UI、merge 物化、NR 单测；`testcases.md` 8.1 |
| 2026-06-23 | **P5.2b.1** | PUT 内联 append、vrLock/hubPeInventory 单测 |
