# IBR 高可用组：VRRP 健康检查与删除回退

> **状态**：**设计已定**（2026-11-12）。**H0 / H1（含隧道引用拒绝 + 备失败主补偿）已落地**；**H5**：删失败不再写死 `error`，历史 sticky `error` 用 `POST .../clear-lifecycle-error`（write）显式复位，**不在列表 GET 静默改 status**。**隧道 CE 与 HA 组已解耦**：隧道始终选具体 CE 并对其下发；HA 组仅作归属标注 + VRRP。H2/H3/H4 仍待实现。  
> **读者**：产品、研发。  
> **关联**：分域下发见 [`ibr-vr-config-deploy.md`](./ibr-vr-config-deploy.md)；SRv6 账本/黄标见 [`srv6-config-ledger-and-drift.md`](./srv6-config-ledger-and-drift.md)；删 IBR 实例门闩见 [`ibr-instance-delete-lifecycle.md`](./ibr-instance-delete-lifecycle.md)。

---

## 1. 目的

CE / 标准模式的 **高可用组** 有独立意图（`vrrpIntent`）和独立下发域（`vrrp`）。SRv6 隧道端点是所选 CE；若该 CE 属于 HA 组则指纹标注归属，但隧道 **不拥有、不回退** 这组 VRRP。

需要补齐与删隧道同构、但挂在 HA 组上的两件事：

1. **配置健康**：主备两台设备 VR2 上的 VRRP 片是否还等于该组意图的物化结果。
2. **删除回退**：解散组时可选从两台 CE 上剥掉 **本组** 的 `vrid` / `group_id`，再删平台行。

隧道列表「配置健康 / 生命周期」、删 IBR 实例、角色向导，都不承担这两件事。

---

## 2. 现状（2026-11-12）

| 能力 | 现网 |
|------|------|
| 实体 | `ibr_ha_group` + `ibr_ha_group_member`（一主一备，`vrUuid` 全局唯一） |
| 意图 | `vrrpIntentJson`，scheme `srv6-segment-list-vrrp`；成员仅 **CE / 标准** |
| 下发 | `POST /api/ibr-ha-groups/:id/deploy`：读设备 → `haGroupVrrpMaterialize` 定点 upsert 接口 `vrrp` + 顶层 `vrrp[]` → `pushVRConfig({ domain: 'vrrp', preMergedConfig, skipDriftCheck: true })` |
| 组状态 | 双端成功 `configured`；仅主成功 `degraded` |
| 创建/换成员 | 主备若是**同一条隧道**的 CE-A/CE-B（或对调）→ **409**；成员已是隧道端点 → **允许**，响应 `warnings` 提示 |
| 解散 | `DELETE /api/ibr-ha-groups/:id`：有隧道 `haGroupId` 引用则 409；默认真删 sqlite；`?revertDevice=true` 先剥主备 VR2 本组 vrrp，备失败则补偿主侧，成功再删库（H1） |
| 隧道创建 | **始终直接选 CE 设备**（与标准四端相同）。若 CE 属于 HA 组，指纹标注 `haGroupId`/`backupVrUuid`（同组另一台）；可对主或备建隧道并下发。**不**强制两端同为 HA；**不**推 VRRP |
| SRv6 健康 | 账本 ≟ 基线 + 存活隧道；**不含 vrrp** |
| SRv6 删隧道 | `domain: srv6` 整表盖接口；顶层 `vrrp` 若平台基线没有该键会留下 → CSM「vrrp_instance 须先有接口 vrid」（`test-20261106` / CE1） |
| 隧道生命周期 `error` | 历史：删隧道回退失败会写死 `error`。现网：失败不再改 status；历史 sticky 用 `POST /api/networks/srv6/:id/clear-lifecycle-error`（需 write，且配置健康 ok）复位（H5） |

实验室对照：HA 组 `ha-loc-ad3ydj201q2`（CE1 主 / CE3 备）仍在；CE1 设备 VR2 仍有 `vrid=1`。删错隧道后 `test-20261106` 档案还在、`injectedDelta` 还在、配置健康仍是「健康」，仅 `status=error`。

**现在去高可用页解散该组，不能把隧道从「异常」拉回「可用」，也不能清掉 CE1 上的 VRRP。** 反而会丢掉平台意图，以后按意图做回退更难。应急做法见 §10。

---

## 3. 账本（HA 自己的一层）

```text
HA 意图     = IbrHaGroup.vrrpIntent（主备各 instances[] + groups[]）
设备 VRRP 片 = 该 uuid 的 VR2：匹配接口上的 vrrp[] + 顶层 vrrp[]
物化结果     = materializeHaGroupVrrpForMember(intent, primary|backup)
健康         = 两台「本组物化结果 ≟ 设备 VRRP 片中属于本组的子集」
```

| 层 | 存什么 | 谁改 |
|----|--------|------|
| 意图 | 组级 JSON，不进 SRv6 `injectedDelta` | HA 向导保存 |
| 物化 | 按角色生成接口实例 + 顶层 group | `haGroupVrrpMaterialize` |
| 设备片 | CSM VR2 里本组 `vrid` / `group_id` | `deploy` / 将来的解散回退 |
| 隧道引用 | `endpointFingerprint.ceA/ceB.haGroupId` | 创建/编辑隧道；只读指针 |

比较范围 **只含本组标识**：接口实例按 `vrid`（可加接口名），顶层组按 `group_id`。设备上其它 vrid（不应出现，但防御）不计入「本组健康」，下发/回退也不得删除。

不管：FRR 比 VR2 多出来的 CLI（与 SRv6 黄标同一边界）、live VRRP 主备状态、隧道 BGP/SID。

---

## 4. 配置健康（挂在 HA 组列表）

拉 HA 组列表（或组详情）时对主备做一次只读对账（并发与 SRv6 列表健康同级，避免打爆 CSM）。

| 结果 | 条件 | 界面 |
|------|------|------|
| 健康 | 两台本组 vrrp 片与物化语义相等 | 绿 |
| 漂移 | 缺实例、priority/VIP/接口不一致、有顶层 group 无对应 vrid、或反向 | 黄；可点开 diff |
| 未下发 | 组为 `draft` 或设备上完全没有本组 vrid | 灰；不是故障 |
| 降级 | 与现网 `degraded` 对齐：一端成功一端失败，或一对一健康一漂移 | 橙 |
| 端点缺失 | 成员 uuid 在 CSM 查不到 | 红；不自动修 |

**扫描并修复（HA）**：只允许把 **平台意图再 deploy**（以意图为准盖本组片），或把「仅组状态」与对账结果对齐。禁止用设备片回写 `vrrpIntent`（避免把误操作写进意图）。禁止改 SRv6 `config_json` 里的 BGP/SID。

SRv6 隧道列表 **不** 把 HA 漂移算进 `configHealth`。最多在 CE 为高可用时显示「绑定组 xxx」，点到 HA 页。

---

## 5. 下发漂移（`deploy`）

现状 `skipDriftCheck: true`，邻域策略无确认。落地后：

1. 仍用设备底稿 + 定点 upsert（不要改成 SRv6 那种整 key 覆盖）。
2. 漂移只报：**将丢掉的非本组 vrid / group_id**，或将改写的本组字段。
3. 本组 upsert、设备上没有本组 → 视为注入，不弹窗（对标 SRv6「只多注入」）。
4. 用户确认后仍只写本组片；SRv6 / ACL / NAT / IPsec 保持底稿原样。

`GET /api/vr-config/:uuid/deploy-drift?domain=vrrp` 可复用网关，但比较函数必须按 vrid 子集，不能拿整份 interfaces 做 destructive diff。

---

## 6. 解散回退

对标删 SRv6 隧道的勾选，**默认只删平台**。

```text
解散 HA 组
  ├─ 被存活 SRv6 隧道 fingerprint.haGroupId 引用
  │     → 拒绝，列出隧道名；或弹窗「仍有隧道绑定，只解绑引用 / 取消」
  │        （一期建议直接拒绝，避免组没了隧道档案还指着）
  ├─ 不勾选「回退设备」
  │     → 删 sqlite 组与成员（与今日相同）；设备 VRRP 保留
  └─ 勾选「回退设备」
        → 主、备串行：设备底稿上删除本组 vrid 与 group_id
          → 一份 POST 里接口片和顶层 vrrp 同时改干净
            （避免再触发「顶层 vrrp_instance 在接口中无 vrid」）
          → 双端成功再删库；任一侧失败 → 409，组仍在，可重试
```

回退补丁 = 物化的 **逆操作**（按 `vrid` / `group_id` 删除），不是 POST 空 `vrrp: []`，也不是回放 SRv6 基线。

CSM 约束：最外层 `vrrp_instance` 必须是已配置的接口 `vrid`。剥离时同一 payload 内两边一起去掉。

---

## 7. 与 SRv6 隧道、删实例的边界

```text
SRv6 隧道公式     不含 vrrp
SRv6 下发/回退    必须保留设备 VRRP（接口 + 顶层成对）
HA 下发/回退      只动本组 vrrp 片
删隧道            不剥 VRRP；最后一条引用该组的隧道可另问「是否解散 HA」，默认否
删 IBR 实例       仍是 HA 成员 → 拒绝；先走本文解散（可勾选回退）
```

隧道 `status=error` **只表示上次隧道删除回退失败**，与 HA 健康无关。HA 变健康、解散 HA、SRv6 配置健康变绿，都 **不得** 自动把隧道改回 `available`。若产品要「失败可恢复」，单独做隧道生命周期复位（用户确认后 `error` → `available`），不要绑在 HA 删除上。

---

## 8. 删除状态机（HA 组）

```text
解散 HA 组
  ├─ 有隧道 haGroupId 指向本组 → 一期拒绝
  ├─ 无引用、不回退设备 → 只删库
  └─ 无引用、回退设备 → 剥本组 VRRP → 成功再删库
```

删 IBR 实例仍以 [`ibr-instance-delete-lifecycle.md`](./ibr-instance-delete-lifecycle.md) 为准：HA 成员门闩 **先于** 本文解散完成。不要在「删 VR」里隐式剥 VRRP。

---

## 9. 分期

| 阶段 | 内容 | 建议 |
|------|------|------|
| **H0. 互不踩踏** | SRv6 `domain=srv6` 覆盖 interfaces 时保留设备接口 vrrp；顶层 `vrrp` 不覆盖；**漂移比较忽略 VRRP**（不弹「覆盖」窗） | 否则 HA 健康再准也会被邻域冲掉（CE1 已中招） |
| **H1. 解散回退** | 解散对话框「回退设备」；隧道引用拒绝；备失败补偿主 | **已落地** |
| **H2. 列表健康** | HA 组列增加健康；详情 diff；不写进 SRv6 `configHealth` | 只读对账，不自动 deploy |
| **H3. 下发漂移** | 去掉无条件 `skipDriftCheck`；按 vrid 子集弹窗 | 依赖 H0 |
| **H4. 隧道联手** | 删最后一条绑定该组的隧道时，可选「同时解散 HA」（独立确认，默认否） | 仍调 HA 解散 API，不把 vrrp 写入 `injectedDelta` |
| **H5. 隧道 error 复位** | 删失败不再写死 error；历史 sticky 用 write 接口显式 `clear-lifecycle-error` | **已落地**（禁止 GET 列表静默改 status） |
| **HA-SRv6 解耦** | 隧道选具体 CE 下发；HA 仅标注 + VRRP；多隧道可分别落主/备 | **已落地** |

实现前 H1 未落地时，禁止把「解散」做成假回退（删库却提示已清设备）。

---

## 10. 落地前应急（实验室 `test-20261106` / CE1）

| 目标 | 现在这样做 | 不要这样做 |
|------|------------|------------|
| 隧道从「异常」变回「可用」 | 档案还在，只是 `status=error`。需以后 H5，或运维把该行改为 `available`。**解散 HA 无效。** | 以为解散 HA / 刷新列表会自动复原 |
| 以后还能「回退设备」删这条隧道 | 保留 HA 组与 CE1 VRRP，等 H0 发到实验室后再删；或删隧道时 **取消回退设备** 只删档案 | 先解散 HA（意图没了，VRRP 还在，更脏） |
| 清掉 CE1 验证用的 VRRP | 等 H1；或 HA 页保留组、在设备/专家模式按 vrid 手工拆，组意图一并改掉 | 只解散组、指望 CLI 跟着没 |

---

## 11. 实现落点（待编码时对照）

| 层 | 位置 |
|----|------|
| 列表 / 解散 UX | `frontend/src/pages/sdncc/ibr/ha-groups/index.tsx` |
| 向导 / 意图 | `ha-groups/IbrHaGroupWizard.tsx`、`haGroupWizardLib.ts` |
| 路由 | `backend/src/routes/sdn/ibrHaGroups.ts`（`DELETE` 加回退选项；健康 GET） |
| 服务 | `ibrHaGroupService.ts`：`remove`、`deploy`、新增 `health` / `stripVrrpPatch` |
| 物化 | `haGroupVrrpMaterialize.ts` 增 **按 vrid/group_id 删除** 的逆操作；单测成对 POST |
| 下发网关 | `vrConfigDeploy.ts`：`domain=vrrp` 漂移按子集；SRv6 保留 VRRP（H0） |
| 隧道引用 | `SRv6Tunnel.endpointFingerprint.*.haGroupId`；解散前 `findSrv6TunnelsReferencingHaGroup` |
| 隧道 error | `srv6.delete.ts` 写入；复位不要放进 HA `remove` |
| E2E | `tests/e2e-manifest.cjs` 登记 HA 健康 / 解散回退 |

---

## 12. 验收要点（落地后）

1. SRv6 隧道黄标不因 CE 上存在已下发的 HA VRRP 而变「漂移」。  
2. HA 组黄标在意图与设备本组 vrrp 片不一致时出现；再 deploy 后变健康。  
3. 解散不勾选回退：库无该组，设备 VRRP 仍在（与今日默认一致，须在 UI 写明）。  
4. 解散勾选回退：两台 CE 上本组 vrid/group 消失，其它域与其它 vrid 仍在；失败则组还在。  
5. 有隧道 `haGroupId` 指向本组时一期不能解散。  
6. 解散成功 **不** 修改任何 `srv6_tunnels.status`。  
7. 仍为 HA 成员的 IBR 不能删实例（实例删除文档阶段 A）。

---

## 13. 明确不做

- 把 `vrrp` 写入 SRv6 `injectedDelta` 或 `recompute` 公式  
- 删一条隧道就拆主备 VRRP  
- 解散 HA 时 POST 空配置 / 用 `srv6BaselineJson` 冒充回退  
- 用 HA 健康或解散去复位隧道「异常」  
- 健康检查去扫设备 FRR（只比 VR2 片）  
- PE 侧 VRRP、一台 CE 多 HA 组（现网 `vrUuid` 唯一约束保持）  
- 把角色向导改成走 `domain=vrrp`
- 把一条隧道的四端自动扩成「主+备」六端下发（同组另一台须另建隧道）

---

## 14. 修订

| 日期 | 说明 |
|------|------|
| 2026-11-12 | 初稿：与 SRv6 隔离、HA 账本/健康/解散回退、H0–H5、实验室应急；代码未落地 |
| 2026-11-12 | **HA CE + SRv6 正式下发**：禁止混合一端 HA / 一端单台；四端向导只推逻辑主；POST/PUT `assertSrv6TunnelHaCePair` |
| 2026-11-12 | **解耦**：取消「逻辑主独占」与双端同模强制；隧道直接选 CE，HA 仅标注；同组主/备可分别建隧道下发；拒绝同组主备作一条隧道两端；成员须写标注 |

---

## 15. 隧道 CE 与 HA 组（解耦后）

HA 组只管 CE 上的 VRRP；SRv6 隧道创建与标准四端一致。

```text
任意隧道    PE-A → PE-B → CE-A（所选设备）→ CE-B（所选设备）
第二条隧道  可再选同组另一台 CE，对其单独下发 SRv6
VRRP        仍走高可用组向导（domain=vrrp）
```

| 项 | 约定 |
|----|------|
| 选 CE | 始终选具体设备；下拉可标注「HA 组名（主/备）」 |
| 指纹 | 若 CE 属于 HA 组：写 `haGroupId`/`haGroupName`/`backupVrUuid`（= 同组另一台） |
| 校验 | 有标注时端点须为该组成员且 peer 一致；允许一端有标注、一端无。CE 属于某组时须写标注（防保存抹掉解散门闩）。**拒绝**同一组主备作为一条隧道的 CE-A/CE-B |
| 增量 CLI | 写入所选 CE 的 `injectedDelta`，经 `domain=srv6` 推送；H0 保留设备 VRRP；SRv6 漂移比较忽略 VRRP |
| 删除/健康 | 扫隧道四端（所选 CE）；解散 HA 仍受 `haGroupId` 引用门闩 |
| VRRP | 不进 SRv6 公式 |

落点：`srv6.haBinding.ts`、`Create.tsx`、`srv6CeHaGroupLib.ts`（`lookupHaAnnotationByVrUuid`）、`srv6Archive.ts`。
