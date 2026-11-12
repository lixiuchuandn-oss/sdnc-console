# IBR 实例删除收口（生命周期）

> **状态**：**设计已定，代码未落地**（2026-11-11 评审）。后续按本文分期实现，实现前勿在删除路径上临时加「假回退」。  
> **读者**：产品、研发。  
> **关联**：身份主键见 [`ibr-identity-registration.md`](./ibr-identity-registration.md)；分域下发与角色向导通道见 [`ibr-vr-config-deploy.md`](./ibr-vr-config-deploy.md)；SRv6 三层账本见 [`srv6-baseline-recompute.md`](./srv6-baseline-recompute.md)；漂移见 [`srv6-config-ledger-and-drift.md`](./srv6-config-ledger-and-drift.md)；HA VRRP 健康与解散回退见 [`ibr-ha-vrrp-health-and-rollback.md`](./ibr-ha-vrrp-health-and-rollback.md)。

---

## 1. 目的

删除 IBR 实例应是该设备在控制器上的 **生命周期收口**，而不是只在 CSMCTL 抹掉登记。

现网「删除实例」只做控制器注销：设备 CLI、角色初始化、对端隧道注入、HA/IPsec 引用都不处理。SRv6 隧道删除已有「回退平台库 / 下发设备」选项；实例删除应对齐同一心智，并补齐 **角色向导这一层** 的入库与回退。

本文只定方案与分期，不改运行代码。

---

## 2. 现状（删除实例实际做了什么）

前端：`frontend/src/pages/sdncc/ibr/routers/index.tsx` → `vrApi.deleteVRInstance(uuid)`。  
接口：`DELETE /V2/vrcontrol/VR1/unregister?uuid=…`（404/405 时 POST 同路径 + body `{ uuid }`）。  
CSMCTL：`VrInServiceImpl.unregister`：

1. 删 VR1 登记（`vrDao.deleteByUuid`）
2. 删该 uuid 的 **整份 VR2**（角色、接口、BGP、SRv6 等 **控制器副本**）
3. 删配置状态

**不会**：

- 往设备下发回退或空配置（CLI 保留）
- 跑 SRv6 `recompute` / 隧道 `injectedDelta` 回退
- 清 sqlite `vr_config`（含 `srv6BaselineJson`）、ACL/NAT 行、HA 成员
- 处理 `registervr.conf` / `.registration_finish`（agent 仍可能用同一 uuid 再 register）

SRv6 隧道删除回退（`backend/src/routes/sdn/srv6.delete.ts`）是 **另一条路径**：勾选「回退平台库中的隧道注入项」后 `exclude` 贡献再 `recompute`，可选 `pushVRConfig`。删实例 **不走** 这条路径。

---

## 3. 目标产品行为

| 场景 | 行为 |
|------|------|
| 实例仍被 **存活 SRv6 隧道** 引用 | **禁止删除**；列出隧道名称，引导走现有「删除隧道 + 回退」 |
| 实例仍是 **HA 组成员** | **禁止删除**；先解散或移出 HA 组 |
| 实例仍是 **IPsec** 端点 | **禁止删除**（或强制先删该 IPsec）；不得在删 VR 时悄悄拆对端 |
| 无上述引用 | 允许删除；默认 **仅平台注销**；提供与删隧道同构的选项：**回退角色初始化并下发到设备 CLI**，成功后再 unregister |
| 身份文件仍在 | 与回退 CLI **分开说明 / 分开开关**：注销后 agent 可用同一 uuid 再报空行（见 §7） |

「有引用先拆引用、无引用再收口本机」——不要在一次「删 VR」里对四端隧道做隐式 recompute。

---

## 4. 关键：两层「基线」不是同一件事

现网 SRv6 账本是三层，挂在 **隧道** 上，不是挂在「实例从出生到删除」上：

```text
生效 config_json = merge(srv6BaselineJson, Σ 存活隧道 injectedDelta)
```

| 层 | 存什么 | 删隧道 + 勾选回退的终点 |
|----|--------|-------------------------|
| Layer 0 `VRConfig.srv6BaselineJson` | **第一次被隧道引用前** 的 `config_json` 快照（**已含角色向导** 写下的接口/BGP/SID 等） | 隧道删光后回到 **角色态** |
| Layer 1 `SRv6Tunnel.injectedDelta` | 各隧道相对基线的邻居/路由/RD/RT 等 | exclude 后 recompute |
| Layer 2 `VRConfig.config_json` | 平台生效配置 | 写入后再可选下发 |

零隧道时 `resetSrv6BaselineWhenNoTunnels` 会把 Layer 0 **对齐成当前 config_json**，角色配置被写进基线，之后更没有「角色之前」可回。

角色向导是 **初始化通道**（[`ibr-vr-config-deploy.md`](./ibr-vr-config-deploy.md) §5）：`saveVRConfig` + `setVRRole` 再 **整份 POST VR2**，不走分域 `pushVRConfig`。Hub 库存虽有 `role_wizard` / `device_baseline` 标签，只覆盖 Hub WAN/LAN 清单，**不是整机可逆账本**。今日 **没有**「角色前快照 / roleDelta」入库。

因此：

- 删隧道回退 ≠ 撤销角色向导。
- 删实例时若把 `srv6BaselineJson` 再 POST 到设备，等于把 **角色态钉死**，不是清向导。
- 要「从头走到尾」回退到 CLI，必须补 **Layer −1**（§6）。

```text
出厂 / 仅注册空机
  → [捕获 rolePreSnapshot]          ← Layer −1（今日缺失，落地时补）
  → 角色向导整份 POST
  → 日常 ACL / NAT / IPsec / SRv6
  → 删光隧道后回到「角色态」        ← 今日已有（Layer 0）
  → 删实例可选 push(Layer −1) 再注销 ← 本文收口
```

---

## 5. 删除状态机

```text
删 IBR 实例
  ├─ 被存活 SRv6 隧道引用 → 拒绝，列出隧道，跳转现有删除+回退
  ├─ 仍在 HA 组成员       → 拒绝，先解散/移出
  ├─ 被 IPsec 作为端点    → 拒绝，或先删该 IPsec
  └─ 无上述引用
        ├─ 默认：仅注销控制器（VR1 + Mongo VR2 + 状态 + 平台 sqlite 行）
        └─ 可选：先按 Layer −1 全量 POST 到设备（漂移确认）→ 成功后再注销
```

引用检查复用现成能力，不要另起一套：

| 引用 | 现成入口 |
|------|----------|
| SRv6 | `fetchSrv6VrReferences`（角色向导已用于拦截下发）；`listAliveContributionsForVr` |
| HA | `ibr_ha_group_member.vrUuid` 唯一 |
| IPsec | `IPsecVPN.localVrId`（及对端字段，实现时列全） |

平台侧随注销一并清理（阶段 B，即使不下发设备）：sqlite `vr_config`、该 `vrId` 的 ACL/NAT 行等。HA/IPsec 在门闩通过后不应再残留成员行。

---

## 6. Layer −1：角色前快照（落地回退 CLI 的前置）

### 6.1 捕获时机

**首次角色向导下发成功之前**（对标隧道创建前的 `captureSrv6BaselinesForTunnel`）：

1. `GET` 设备当前 VR2（或当时平台 `config_json`，以「即将被向导整份覆盖」的那份为准，实现时二选一写死并单测）
2. 写入 `VRConfig` 新字段（名称实现阶段定，文档称 **rolePreSnapshot**）
3. 仅空则写、已有则不覆盖（避免二次向导把「角色态」当成「向导前」）

二次改角色：默认不改 Layer −1（回退目标仍是「第一次角色化之前」）。若产品要「回退到上一角色」，需另存版本，不在一期范围。

### 6.2 回退怎么下发

CSMCTL VR2 是 **全量 POST**，缺的 key 会从设备上拿掉。有 Layer −1 后，「回退并下发」= 把 rolePreSnapshot 经 **漂移确认** 后全量 POST，再 unregister。

ACL/NAT 若已分域下发，优先包含在这份快照的覆盖里，或先按现有分域 deploy 把平台意图清空再 POST；**不要**另开按项 Lua 删除通道。

Hub 上 `device_baseline` 口地址属于本机原有，Layer −1 应保留它们；向导写入的 `role_wizard` 段应随回退消失。

### 6.3 没有 Layer −1 时禁止的三种假回退

| 做法 | 为何不做 |
|------|----------|
| 把 `srv6BaselineJson` 再下发 | 回的是角色态 |
| 拼一份空骨架 POST | 误伤本机原有口 / `device_baseline`，接近格式化 |
| 对当前 JSON 做 eject | 与历史隧道 eject 同类：Hub、手改、漂移会漏删或误删 |

一期若尚未捕获 Layer −1：**只允许「仅平台注销」**，选项「回退到设备」灰掉并说明「该实例无角色前快照，无法自动回退 CLI」。

历史已向导过的设备没有快照：不强制补录；需要清 CLI 时走专家模式或设备侧，不在删除对话框里赌空配置。

---

## 7. 身份尾巴（与回退 CLI 分开）

即使 CLI 回退 + unregister 都成功：只要 `/usr/local/src/vrconf/registervr.conf` 仍有该 uuid，agent 会按 **同一 uuid** 再 `POST VR1/register`，控制器出现 **无 VR2 的空行**。`.registration_finish` 仍在时，agent 可能暂时不再 POST，但与控制器已对不上号。

这与配置回退是不同开关，删除对话框须写清，例如：

- 仅清控制器（默认）
- 清控制器 + 回退设备配置（依赖 Layer −1）
- （可选，阶段 D）处理 finish / 提示到 Paas「接入与身份」——**不要**在一期静默改 uuid 或停 agent

uuid 变了 = 新设备，旧行不会自动迁移；那是身份问题，见 [`ibr-identity-registration.md`](./ibr-identity-registration.md)，不在删除收口里做搬家。

---

## 8. 分期（落地顺序）

| 阶段 | 内容 | 依赖 Layer −1 | 建议 |
|------|------|----------------|------|
| **A. 引用门闩** | 有存活 SRv6 / HA 成员 / IPsec 则拒绝删实例，文案列出对象并引导现有删除流 | 否 | 最先做；风险低 |
| **B. 平台侧收口** | 门闩通过后：unregister + 删 sqlite `vr_config` / 该 VR 的 ACL·NAT 行；**默认不下发设备** | 否 | 与 A 可同 PR 或紧随 |
| **C. 设备回退选项** | 对标删隧道的「回退并下发」；payload = Layer −1；漂移确认后全量 POST，失败则不注销 | **是** | 先在角色向导捕获快照，再开放勾选 |
| **D. 身份收口** | 对话框说明再注册；可选 finish 处理 | 与 C 独立 | 勿与 C 绑成一个勾选 |

阶段 C 的前端建议与删隧道一致：默认「仅平台」；显式勾选才下发设备；失败 409、实例仍在、可重试。

---

## 9. 实现落点（待编码时对照）

| 层 | 位置 |
|----|------|
| 删除入口 UI | `frontend/src/pages/sdncc/ibr/routers/index.tsx`（现 `Modal.confirm` 仅注销） |
| 注销 API | `frontend/src/services/virtualRouterApi.ts` → `deleteVRInstance` |
| CSM 注销 | `ibr-controller/.../VrInServiceImpl.unregister`（保持删 VR1/VR2/状态；设备回退必须在 **此调用之前** 由 SDNC 完成） |
| SRv6 引用 | `fetchSrv6VrReferences`；`backend/src/routes/sdn/srv6.recompute.ts` · `listAliveContributionsForVr` |
| 隧道回退（先拆引用） | `backend/src/routes/sdn/srv6.delete.ts` |
| 角色向导下发（捕获点） | `PEWizard` / `CEWizard` / `StandardWizard` / `SASEWizard` 的 `handleDispatch`（POST VR2 之前） |
| 下发网关 | `backend/src/services/vrouter/vrConfigDeploy.ts` · `pushVRConfig`（回退 CLI 走全量 + 漂移，不新开 Lua） |
| 实体 | `VRConfig` 增 rolePreSnapshot 类字段；`IbrHaGroupMember.vrUuid`；`ACL*` / `NAT*` / `IPsecVPN` 按 vrId |
| 单测 | 门闩：有隧道 / 有 HA → 拒绝；无引用 + 无快照 → 仅允许平台删；有快照 + 勾选下发 → POST 后再 unregister；POST 失败 → 仍登记 |

E2E：门闩与删除选项登记 `tests/e2e-manifest.cjs`（见 `tests/E2E_COVERAGE.md`）。

---

## 10. 验收要点（落地后）

1. 被 SRv6 引用的实例无法删除，提示含隧道名；删光隧道（含回退）后才可删实例。  
2. HA 成员、IPsec 端点同样挡删除。  
3. 无引用、不勾选下发：控制器与平台库无该 uuid；设备 CLI **仍在**（与今日一致，作为安全默认）。  
4. 无引用、勾选下发、且有 Layer −1：设备回到角色前快照（Hub 本机 `device_baseline` 口仍在）；然后 VR1/VR2/平台行消失。  
5. 无 Layer −1：不能勾选下发，只能平台注销。  
6. 下发失败：不 unregister，用户可重试或取消。  
7. 不把 `srv6BaselineJson` 当作「出厂回退」payload。

---

## 11. 明确不做（除非另开需求）

- 删实例时自动对四端做隧道 recompute  
- 用空 JSON / 骨架配置冒充回退出厂  
- 静默改设备 uuid、停 vrctl-agent、或当身份迁移工具  
- 历史存量实例强制补 Layer −1  
- 把角色向导改成走分域 `pushVRConfig`（初始化通道边界见下发文档 §5）

---

## 12. 修订

| 日期 | 说明 |
|------|------|
| 2026-11-11 | 初稿：现状、两层基线、状态机、Layer −1、分期 A–D；代码未落地 |
