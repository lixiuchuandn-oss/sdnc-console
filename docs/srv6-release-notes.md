# SRv6 隧道 · 发版说明（baseline + 贡献 + recompute）

> **功能批次**：SRv6 配置管理架构升级（P1–P4）  
> **实现方案（详细）**：[`docs/srv6-baseline-recompute.md`](./srv6-baseline-recompute.md)  
> **冒烟用例**：[`frontend/src/pages/sdncc/interconnect/srv6/testcases.md`](../frontend/src/pages/sdncc/interconnect/srv6/testcases.md)  
> **建议平台版本**：与下一 PATCH 发版对齐（发版时同步 bump `backend/package.json` 与 `frontend/package.json` 的 `version`）

---

## 摘要

本次升级将 SRv6 隧道四端配置管理从「前端写库 + 删除 eject」改为 **「向导基线 + 隧道贡献 + 服务端重算」**。支持 **Hub PE 多隧道**、创建前 **冲突拒绝**、**配置对账与修复**，并统一 **中文错误提示**。  
**不兼容**无关系档案/无基线的历史隧道之自动删除回退，需按文档人工处理。

---

## 新能力

### 平台配置三层模型

- **向导基线**（`VRConfig.srv6BaselineJson`）：VR 首次参与 SRv6 时的快照。  
- **隧道贡献**（`SRv6Tunnel.injectedDelta` 等档案）：每条隧道对四端的结构化增量。  
- **平台生效配置**（`VRConfig.config_json`）：`merge(基线, Σ存活贡献)`，由服务端在创建/更新/删除后自动重算。

### Hub 多隧道

- 同一 PE 可承载多条隧道（不同公网邻居 / 内网 VRF / 内网口等）。  
- 创建页与列表展示 Hub 状态；重复 neighbor、RD/RT、内网口+VRF 等 **409 拒绝**并返回中文 `conflicts[]`。

### 配置对账

- 列表页 **「配置对账」**：扫描平台生效配置是否与「基线 + 存活隧道叠加」一致。  
- 支持 **扫描并修复**（recompute 写回 / 零隧道基线对齐）。  
- 操作写入 **审计日志**（`SRv6 Reconcile`、`SRv6 Baseline Reset` 等）。

### VR 配置保护

- 已被存活隧道引用的 VR，**关键指纹字段**（公网 IP/ASN、SID 前缀、内网口/VRF 等）不可通过角色配置向导修改（409）。  
- 有存活隧道时，VR upsert **强制 recompute**，避免手改破坏恒等式。

### 新增/扩展 HTTP API

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/networks/srv6/vr/:vrUuid/hub` | Hub 状态与引用隧道 |
| GET | `/api/networks/srv6/reconcile` | 对账扫描（可选 `vrUuid`） |
| POST | `/api/networks/srv6/reconcile` | 对账；body `{ repair?, vrUuid? }` |
| POST | `/api/networks/srv6/vr/:vrUuid/baseline/reset` | 零隧道时手动基线重置 |

既有隧道 CRUD、deploy preview/push 行为路径不变；**创建/更新/删除语义**见下文「行为变更」。

---

## 行为变更（相对旧版）

| 场景 | 旧行为 | 新行为 |
|------|--------|--------|
| 创建隧道成功 | 前端可能对四端 `saveVRConfig` 直写 | **仅服务端** capture 基线 + sync 四端；前端只提示进入下发向导 |
| 删除隧道（默认） | 主路径 eject 逐项删 | **recompute**（exclude 本隧道）写回平台库；可选 push 设备 |
| 更新隧道 | 可能先落库再失败 | **先冲突检测再 save**；通过后 sync 四端 |
| Hub PE 第二隧道 | 易冲突或 silent 覆盖 | 409 + 中文冲突明细 |
| 保存被引用 VR 配置 | 可能直接覆盖 | 有隧道时 **忽略手改** 并 recompute；改指纹 **409** |
| 错误文案 | 含 `injectedDelta`、`config_json`、规则码等 | **中文业务描述**；UI 不展示内部 code |

---

## 兼容性说明（重要）

### 历史隧道

以下情况 **不支持** 自动「回退平台库」删除：

- 缺少 `injectedDelta`（创建时配置变更清单）  
- 四端 VR 缺少 `srv6BaselineJson`（向导基线）

接口返回 **400/409**，提示：

- 取消勾选「回退平台库」**仅删除隧道记录**；或  
- 使用 **「配置对账」**；或  
- 管理员在四端 VR **手工还原**。

**不做**旧数据自动补档案/补基线。

### 数据库

- 新增列：`VRConfig.srv6BaselineJson`、`srv6BaselineAt`、`srv6BaselineTunnelId`（`DB_SYNC=true` 时 TypeORM 自动同步 SQLite schema）。  
- 生产若使用 PostgreSQL/MySQL，须确保迁移/同步已执行后再启用本批次。

### 下发设备

- 平台库重算 **不会** 自动 push 设备；运维仍须走 **下发向导**（与 IPsec 一致）。  
- 删除时若勾选回退设备，行为与旧版类似（读库后 push），但库内内容来自 **recompute** 而非 eject。

---

## 前端变更摘要

| 页面 | 变更 |
|------|------|
| SRv6 创建向导 | Hub 提示；保存成功/失败中文 toast；去掉创建后四端直写 VR |
| SRv6 列表 | Hub 标签；**配置对账**弹窗（仅展示中文问题描述） |
| 下发向导 | 文案「推送到设备」（不再对用户展示 CSMctl） |

---

## 后端变更摘要

- 新增模块：`srv6.baseline`、`merge`、`recompute`、`sync`、`conflict`、`hub`、`reconcile`、`audit` 等（见实现方案 §9）。  
- `srv6.eject.ts` 标记 deprecated，**勿在新流程使用**。  
- `vrConfig.ts` upsert 集成 SRv6 recompute 与 `srv6.vrLock`。  
- 单测：`backend/src/routes/sdn/srv6*.test.ts`，共 **48** 条（含 `scenarios.test.ts` 场景矩阵）。

---

## 升级与发版步骤（运维）

1. **停写或维护窗口**（可选）：避免升级过程中并发创建/删除隧道。  
2. 部署 **后端**（含 DB schema 同步）+ **前端** 同一发版单元；`version` 建议 PATCH bump 并打 Git tag。  
3. 升级后打开 SRv6 列表 → **配置对账 → 重新扫描**，处理 `INVARIANT_DRIFT` / `ORPHAN_BASELINE_DRIFT`（必要时「扫描并修复」）。  
4. 对 **历史隧道** 台账：标记无档案隧道，规划删除或重建。  
5. 按 [`testcases.md`](../frontend/src/pages/sdncc/interconnect/srv6/testcases.md) 执行 **R1–R7** 冒烟（至少覆盖创建、删除回退、Hub 冲突、对账）。  
6. 在 **审计日志** 中确认新 action：`SRv6 Create/Update/Delete Tunnel`、`SRv6 Reconcile`、`SRv6 Baseline Reset`。

---

## 回滚建议

| 层级 | 说明 |
|------|------|
| **应用回滚** | 回退至上一版本前后端包；平台库中已写入的基线/档案字段 **保留**（一般无害） |
| **数据** | 不建议删除 `srv6BaselineJson` 列；回滚后新架构字段可能被旧代码忽略 |
| **设备** | 若已 push 新配置，回滚应用 **不能** 自动还原设备；需按备份或手工下发 |

---

## 验证清单（发版签收）

- [ ] `npx jest src/routes/sdn/srv6` 全绿  
- [ ] R1 新隧道创建 + 四端生效配置正确  
- [ ] R2 删除回退至基线（PE22 类）  
- [ ] R4 Hub 重复 neighbor → 409 中文  
- [ ] R5 对账扫描/修复 + 审计有记录  
- [ ] R6 改 WAN 指纹 → VR 保存 409  
- [ ] R7 删最后一条隧道 → 基线对齐  
- [ ] 历史无档案隧道删除 → 400 中文引导（负向）  

---

## 相关文档索引

| 文档 | 路径 |
|------|------|
| 实现方案（本文详细版） | `docs/srv6-baseline-recompute.md` |
| 发版说明（本文） | `docs/srv6-release-notes.md` |
| 冒烟用例 | `frontend/src/pages/sdncc/interconnect/srv6/testcases.md` |
| API 总索引 | `AGENTS.md` |
| 后端落点 | `backend/src/STRUCTURE.md` |

---

## 修订记录

| 日期 | 版本/批次 | 说明 |
|------|-----------|------|
| 2026-06 | SRv6 P1–P4 | 初版发版说明与实现方案归档 |
