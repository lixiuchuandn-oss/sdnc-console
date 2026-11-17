# IBR 实例删除收口（生命周期）

> **状态**：**开发基线**（2026-11-17 终审）。编码以本文为准；与旧讨论冲突时以 **§6.1 / §6.2 / §18.0** 为准。HA 解散剥离隧道指纹、IBR 列表「登记时间」已接线。实现前勿在删除路径上临时加「假回退」。  
> **读者**：产品、研发。  
> **关联**：身份主键见 [`ibr-identity-registration.md`](./ibr-identity-registration.md)；分域下发与角色向导通道见 [`ibr-vr-config-deploy.md`](./ibr-vr-config-deploy.md)；SRv6 三层账本见 [`srv6-baseline-recompute.md`](./srv6-baseline-recompute.md)；漂移见 [`srv6-config-ledger-and-drift.md`](./srv6-config-ledger-and-drift.md)；HA VRRP 健康与解散回退见 [`ibr-ha-vrrp-health-and-rollback.md`](./ibr-ha-vrrp-health-and-rollback.md)。

---

## 1. 目的

删除 IBR 实例应是该设备在控制器上的 **生命周期收口**，而不是只在 CSMCTL 抹掉登记。

现网「删除实例」只做控制器注销：设备 CLI、角色初始化、对端隧道注入、HA/IPsec 引用都不处理。SRv6 隧道删除已有「回退平台库 / 下发设备」选项；实例删除应对齐同一心智，并补齐 **角色向导这一层** 的入库与回退。

本文删实例收口只定方案与分期；HA `remove()` 剥离指纹与列表「登记时间」已接线，见 §5.1 / §7.1。

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
| 实例仍是 **IPsec** 端点 | **禁止删除**；先删该 IPsec。不得在删 VR 时悄悄拆对端 |
| 无上述引用、**无** Layer −1 | 只能平台注销（§6.3）。对话框说明 CLI 保留，**没有**回退勾选 |
| 无上述引用、**有** Layer −1 | 收口固有步骤，不是勾选：漂移确认 → 全量 POST 快照 → **等到 agent 回报 `applied`** → 再 unregister（§6.2）。任一步失败则实例仍在、可重试。再注册上来应是角色前空机 |
| 身份文件仍在 | **说明，不是开关**（§7）：注销后 agent 可用同一 uuid 再报空行 |

「有引用先拆引用、无引用再收口本机」——不要在一次「删 VR」里对四端隧道做隐式 recompute。各叠加业务 **自己管删除与平台/设备回退**（SRv6、HA、IPsec、以后同类照搬同一套）；删 VR 只问绑定注册表「还有没有 binder」（§13）。

---

## 4. 关键：两层「基线」不是同一件事

### 4.0 先分清「存在哪」——删平台 ≠ 改 VR2

容易绕的原因是：界面上好几处都叫配置 / Cache，其实不是同一份。

```text
盒子 CLI / FRR     ← agent 按 VR2 应用；clish 改了不上报
        ↑
CSM Mongo VR2      ← 控制面已接受的整份 JSON；只有向导 / 专家 / 分域 POST 会改它
        ↑ GET 实时
详情里的 vr2_info   ← 打开详情时现拉 CSM，不是五分钟缓存

sqlite vr_config.config_json          ← 平台「账本」，详情「本地配置 (Cache)」
sqlite vr_config.srv6BaselineJson     ← SRv6 向导基线（角色态快照）
sqlite srv6_tunnels.injectedDelta     ← 各条隧道相对基线的叠加
sqlite ibr_ha_group.vrrpIntentJson    ← HA 意图（不进 SRv6 公式）

sqlite vr_cache_basic / extended      ← VR1 / VR3 **列表**缓存（约 5 分钟 + 手动刷新）；不含 BGP/SRv6 业务 JSON
```

两份 sqlite 不要混：`VRCache*` 只给 IBR 列表（名称、UUID、状态、口/流量、登记时间）；`config_json` 是整机业务底稿（详情「本地配置」），ACL / NAT / IPsec / SRv6 / 角色向导 **共用这一张**，不是各业务各有一份。SRv6 另有 `srv6BaselineJson` + 隧道 `injectedDelta`，公式算完写回同一张 `config_json`。列表 **不需要** VR2 业务内容；详情要看控制面时现拉 `vr2_info`。

黄标等式 **两端都是 sqlite，不读 VR2**：

```text
账本 vr_config.config_json  ≟  公式 merge(srv6BaselineJson, Σ 还活着的隧道 injectedDelta)
```

「删隧道 / 解散 HA、不回退设备」清的就是这些 **sqlite 行**（隧道档案、HA 组、并把 `config_json` recompute 成公式）。**不会 POST VR2**，所以 Mongo 里的邻居 / VRRP 还在，agent 也不会去拆 CLI。

VR2 什么时候才会被清：

| 动作 | VR2 |
|------|-----|
| 只清平台（不勾回退设备） | **不动** |
| 删隧道勾回退设备 | `domain=srv6` POST 公式（H0 **保留** VRRP） |
| 解散 HA 勾回退设备 | 剥本组 VRRP 后 POST |
| 五分钟 / 列表刷新 | **反向、半套**：有存活隧道且有基线时不盖 `config_json`；**零隧道后保护取消**，脏 VR2 会盖回账本（黄标可能过一会才亮）。**方案 2（§14）改为永不盖 `config_json`**；VR1/VR3 列表缓存照刷 |
| 删实例 unregister | **整份删掉** Mongo VR1+VR2。若在 agent 下载并 `transfer` 之前删掉，刚 POST 的快照不会进 CLI（§6.2） |

详情不要和账本混：列表 / 概览主要是 VR1 缓存；「本地配置」才是 `config_json`；`vr2_info` 是实时 CSM。

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
  → 删实例 POST Layer −1 再注销
  → agent 再注册上来 = 角色前空机   ← 本文收口目标，不再做「留角色剥残留」
```

---

## 5. 删除状态机

```text
删 IBR 实例
  ├─ 被存活 SRv6 隧道引用（四端 uuid） → 拒绝，列出隧道，跳转现有删除+回退
  ├─ 仍在 HA 组成员（vrUuid）         → 拒绝，先解散或移出（VRRP 回退走 HA 自己的勾选）
  ├─ 被 IPsec 作为端点                → 拒绝，或先删该 IPsec
  └─ 无上述引用（绑定注册表为空）
        ├─ 无 Layer −1：仅注销（VR1 + Mongo VR2 + 状态 + 平台 sqlite）；设备 CLI 仍在
        └─ 有 Layer −1：漂移确认 → updateVRConfig(快照) → 等到 report_config_status=applied
           → 再注销。未回退的邻居 / VRRP / 角色 / ACL 段在这次全量 POST 里被盖掉。
           不必重建隧道/HA，也不另设「先清残留才能删」门闩（见 §12）
```

引用检查复用现成能力，不要另起一套：

| 绑定（binder） | 判定 | 现成入口 |
|----------------|------|----------|
| SRv6 | 本 uuid 是否为某存活隧道 peA/peB/ceA/ceB | `fetchSrv6VrReferences`；`findSrv6TunnelsReferencingVr` |
| HA | 本 uuid 是否为某组成员 | `ibr_ha_group_member.vrUuid` 唯一 |
| IPsec | 本 uuid 是否为隧道端点 | `IPsecVPN.localVrId` **或** `IPsecVPN.peerVrId` 等于本 uuid（一期不按对端 IP 猜；`peerVrId` 为空的只挡本端行） |

平台侧随注销一并清理（阶段 B，即使不下发设备）：sqlite `vr_config`、该 `vrId` 的 ACL/NAT 行等。HA/IPsec 在门闩通过后不应再残留成员行。

### 5.1 拆除顺序：SRv6 与 HA 独立

SRv6 与 HA 是两类独立绑定。隧道端点是所选 CE；`haGroupId` 只是指纹 **标注**，隧道不拥有、不回退 VRRP。

**现网（2026-11-16）**：解散 HA **不再**因隧道指纹 409。`ibrHaGroupService.remove` 在设备回退（可选）成功后调用 `detachSrv6TunnelsFromHaGroup`，剥掉隧道上的 `haGroupId` / `haGroupName` / `backupVrUuid`，SRv6 增量不动。CE 仍属某组时保存隧道仍须写标注（归属展示），组删掉后标注被剥离即可。

删 VR 的门闩问三件独立的事：还是不是隧道端点、还是不是 HA 成员、还是不是 IPsec 本端或对端。三者都空才能收口。**不存在**「必须先删光隧道才能解散 HA」。IPsec 先走现有删除，不在删 VR 里拆对端。HA 成员可解散组，或经 `replaceMembers` 换掉该成员。

门闩文案按 **待办清单** 列：还在哪些隧道（端点角色）、还在哪个 HA 组、还在哪条 IPsec；不要三个 409 堆成一句。

---

## 6. Layer −1：角色前快照（落地回退 CLI 的前置）

### 6.0 与「角色基线 / SRv6 基线」的对应（已对齐）

**对。** Layer −1 就是 **第一次设置角色之前** 的设备状态（刚注册上来、尚未走 PE/CE/Hub/标准/SASE 向导），**不是** `srv6BaselineJson`。

| 名字 | 何时有 | 里面有什么 |
|------|--------|------------|
| Layer −1 `rolePreSnapshot` | 首次角色向导 **下发成功前** 捕获 | 注册后、角色化前的 VR2（可能已有 Paas 网卡初始化等，但无向导写入的 BGP/SID/角色段） |
| 角色基线（口语） | 角色向导成功下发之后 | 该角色对应的初始化配置，在 `config_json` / 设备 VR2 里 |
| Layer 0 `srv6BaselineJson` | **第一次被 SRv6 隧道引用前** 从当时 `config_json` 快照 | **已经含角色基线**；再叠加隧道 `injectedDelta` |

因此：

- 设了角色且 **当时捕获成功**：删实例会 POST Layer −1，把角色基线从设备清掉，再注销。
- **从未捕获**（历史向导、或 VR2 上已经有角色才升级到本方案）：快照保持空，**禁止**用当前 VR2 补录。只能平台注销。
- **已捕获、向导尚未下发成功**（快照≈当前 VR2）：仍然 POST（幂等）并等到 `applied`，再注销。不要因为「还没角色」就跳过。
- 有角色、还没建 SRv6：`srv6BaselineJson` 可能为空，**不能**当回退目标。
- 删光隧道档案后回到的是 **角色态**（Layer 0），不是 Layer −1。隧道不必先勾设备回退；残留邻居由删实例这一次 POST 盖掉。

「空」指 **没有角色向导叠加**，不是保证出厂白板：注册时设备上已有的口地址/`device_baseline` 应留在 Layer −1 里。

### 6.1 捕获时机

**第一次把「无角色」写成「有角色」之前**（对标隧道创建前的 `captureSrv6BaselinesForTunnel`）。挂在 `upsert` 与 `set-role` **写库之前**，四向导不必各写一份 GET。

**只有同时满足才 GET、才写入：**

1. `rolePreSnapshot` 为空
2. 平台 `vr_config.role` 为空
3. 实时 VR2 剥掉 `CONFIG_META_KEYS` 之后 **非空**，且 **没有** `role`（无向导角色段）

然后：

1. 快照 = 该 VR2 去掉 `msg` / `code` / `report_config_status` / `createDate` / `updateDate` / `_id` / `requestId`（与 `configSemanticEqual` 的元数据同一套）。**不要**把 `report_config_status=applied` 存进去，否则回退 POST 会让 CSM 新文档一上来就是 applied，注销会赶在 agent 下载之前。
2. 已有快照 **不覆盖**。二次改角色不换快照。要「回到上一角色」不在一期。
3. **禁止补录**：平台 role 已有，或 VR2 已有 role，而快照仍空 → **不 GET、不写**。这是历史实例。用当前 VR2 当 Layer −1 会把角色态当成角色前，删实例 POST 清不掉角色。
4. VR2 为空、GET 失败、或剥完只剩元数据 → **不写** `{}`。空快照会在删除时变成禁止的空骨架 POST。此次捕获中止：向导 / `set-role` 不得继续改角色。已有快照或本就不应捕获时，GET 失败 **不**挡住后续保存。
5. 专家 `source=expert` 若将 409，**先 409 再捕获**，被拒绝的保存不得留下快照。

`set-role` 在无行时会 `create({ config_json: '{}' })`。捕获必须在这之前；捕获失败则不要先插入空行。

### 6.2 回退怎么下发

CSMCTL VR2 是 **全量 POST**，缺的 key 会从设备上拿掉。有快照时的顺序固定为：

```text
binders 空
  → GET 当前 VR2，与 rolePreSnapshot 做全量语义 diff（含 vrrp，去掉元数据）
  → 有差异且用户未确认 → 409，不 POST
  → 已确认：若 VR2 与快照语义已相同，不要再 POST（重试不得重置 checksum）
    否则 vrController.updateVRConfig(快照)          ← 不走 pushVRConfig
  → 轮询 report_config_status === 'applied'
  → 才 unregister，然后删 sqlite
```

`updateVRConfig` 的响应 `code` 不是 0/200 时，视为 POST 失败：不轮询、不注销。判定与 `assertCsmUpdateSuccess` 相同，只是不走那条会回写 sqlite 的函数。

**不要走 `pushVRConfig`。** 现网该函数在传入 `preMergedConfig` 时跳过 drift；成功后 `saveVRConfigToDB` 会把快照写进 `config_json`；`SKIP_VR_PUSH=1` 会把「没下发」当成成功。`domain=srv6` 的 `detectDeployDrift` **忽略 VRRP**，不能复用 `GET /api/vr-config/:uuid/deploy-drift?domain=srv6`。弹窗复用 `diffConfigSemantic` 和现有确认框文案，比较本身是删实例预览接口。

**为什么要等 `applied`。** `monitoring.agent` 默认每 30s（`download_interval`）对 checksum，变了才 `download-config` + `transfer.lua`，然后 `POST report-config-status` = `applied`。CSM `VrConfigDao.add` 是删掉旧 VR2 再插入。unregister 再删掉 VR2。若 POST 刚返回就注销，agent 还没下载，CLI 不会变，再注册也不是空机。GET VR2 与快照相同只说明 **控制器已接受**，不是 FRR 已应用。

轮询上限盖住至少一轮下载（建议 90s，可配置）。超时或设备离线：**不注销**，409，文案写明「回退配置已在控制器，设备尚未 applied」。快照列与 `config_json` 都保持原样，方便原样重试。重试时若 VR2 已等于快照且尚未 applied，只继续等，不第二次 POST。

等待期间 **不要**把快照写回 `config_json` / `srv6BaselineJson`。ACL/NAT 键不在快照里就会被这次 POST 从设备拿掉；sqlite 的 ACL/NAT 行仍等到 unregister 成功再删。不要先分域清空，也不要按项 Lua 删除。

Hub 上 `device_baseline` 口地址属于本机原有，Layer −1 应保留它们；向导写入的 `role_wizard` 段应随回退消失。

### 6.3 没有 Layer −1 时禁止的三种假回退

| 做法 | 为何不做 |
|------|----------|
| 把 `srv6BaselineJson` 再下发 | 回的是角色态 |
| 拼一份空骨架 POST | 误伤本机原有口 / `device_baseline`，接近格式化 |
| 对当前 JSON 做 eject | 与历史隧道 eject 同类：Hub、手改、漂移会漏删或误删 |

一期若没有 Layer −1：**只平台注销**。对话框说明「该实例无角色前快照，无法自动回退 CLI」，**不提供**回退勾选（也不是置灰勾选）。

历史已向导过的设备没有快照：不强制补录；需要清 CLI 时走专家模式或设备侧，不在删除对话框里赌空配置。

---

## 7. 身份尾巴（与回退 CLI 分开）

即使 CLI 回退 + unregister 都成功：只要 `/usr/local/src/vrconf/registervr.conf` 仍有该 uuid，agent 会按 **同一 uuid** 再 `POST VR1/register`，控制器出现 **无 VR2 的空行**。`.registration_finish` 仍在时，agent 可能暂时不再 POST，但与控制器已对不上号。

身份不是第三种删除模式。对话框只说明：注销后若 `registervr.conf` 仍有该 uuid，列表会再出现空行，用登记时间区分。一期不改 uuid、不停 agent、不碰 `.registration_finish`，也不做「清 finish」勾选。有无快照决定会不会 POST，用户不另选。

uuid 变了 = 新设备，旧行不会自动迁移；那是身份问题，见 [`ibr-identity-registration.md`](./ibr-identity-registration.md)，不在删除收口里做搬家。

### 7.1 删后 agent 再注册：预期行为，用「控制器登记时间」区分

删实例后同一 uuid 再出现在列表，是 **Paas / vrctl-agent 注册机制的正常结果**（文件里还有 uuid 就会 `POST VR1/register`），不是回退没做完。不要和「恢复初始配置」绑成一个勾选，也不要在一期停 agent。

要在列表上看出「老设备一直在」还是「刚被注销后又报上来的空行」，应看 **控制器本条 VR1 记录的出生时间**，不是设备 OS 运行时长。

| 字段 | 现网 | 能否区分刚注册 |
|------|------|----------------|
| VR1 `createDate` | CSM `VrDeviceBean.createDate`；**insert** 时写入，**update**（「设备已注册, 仅更新该设备」）不刷新。unregister 后该文档已删，再 register 走 insert → **新的 createDate** | **能**。删后重登的空行，创建时间会接近「刚才」 |
| VR1 `updateDate` | 每次 register/心跳类更新可能刷新 | 只能说明最近有过写入，不能当「这条身份活了多久」 |
| 列表「状态」ONLINE/OFFLINE | 健康快照，无「本次在线已持续多久」 | **不能**单独当年龄 |
| 设备 `uptime`（Paas 概览 / 运维控制台） | 主机 `os.uptime()` | **不能**。盒子跑了 30 天、1 分钟前才重新 register，uptime 仍显示很长 |
| sqlite `vr_config.created_at` | 平台配置行；unregister 后阶段 B 会删 | 空行可能尚无 VR2/平台配置，不宜当列表主列 |

**结论：** 现网列表已加 **登记时间** 列（`useVrListColumns`，VR1 `createDate`；`GET /api/vr-instances` 的 `mergeOne` 以 VR1 缓存为准，不被 VR3 同名字段覆盖）。详情抽屉「创建时间」同源。不要用设备 OS uptime。刚重登的空行：登记时间新、角色未设置、无隧道/HA。老实例：登记时间早、有角色。同一 uuid 从未 unregister、只是心跳恢复的，createDate **不变**（仍是当年 insert）。ONLINE 时不必再单独做「在线时长」列，以免和主机 uptime 混淆。

---

## 8. 分期（落地顺序）

| 阶段 | 内容 | 依赖 Layer −1 | 建议 |
|------|------|----------------|------|
| **E. 账本/VR2 分离** | 五分钟不再用 VR2 盖 `config_json`（§14）；无行时也不用 VR2 建行 | 否 | **先做**；立刻掐掉零隧道黄标循环 |
| **C0. 捕获 Layer −1** | 向导/首次写角色前 GET VR2 写入 `rolePreSnapshot` | 捕获本身 | **尽早合入**，让现网开始攒快照；否则阶段 C 上线后历史实例仍只能平台注销 |
| **F. 专家入口** | 保存+下发走同一套 upsert→`updateVRConfig`；专家路径有隧道则 409（§15） | 否 | 可与 C0 并行；**不要**让普通 upsert（PE ND、SRv6 persist）也 409 |
| **A. 引用门闩** | 有存活 SRv6 / HA 成员 / IPsec 则拒绝删实例，文案列出对象并引导现有删除流 | 否 | 删实例 UI 改走后端；风险低 |
| **B. 平台侧收口** | 门闩通过后：unregister + 删 sqlite `vr_config` / ACL·NAT / VRCache | 否 | 与 A 同 PR；无 Layer −1 时这就是全部 |
| **C. 设备回退** | 快照 POST → 等到 `applied` → 再注销；失败或超时不注销 | **是** | 有快照时是固有步骤；直接 `updateVRConfig`，不走 `pushVRConfig` |
| **D. 身份收口** | 对话框说明再注册；看登记时间 | 与 C 独立 | 与 C 同 PR 的文案即可；勿停 agent / 改 uuid |

阶段 C：失败 409、实例仍在、可重试。不要另做详情「留角色剥残留」。无快照时不得假装回退出厂。步骤顺序、落点与每步回归见 **§18**。

---

## 9. 实现落点（待编码时对照）

| 层 | 位置 |
|----|------|
| 删除入口 UI | `frontend/src/pages/sdncc/ibr/routers/index.tsx`（现 `Modal.confirm` 仅注销）；漂移确认复用 `utils/vrConfigDeployDrift.ts` |
| 删除 API | **改走** `DELETE /api/vr-instances/:uuid`（新）；前端不再直打 CSM unregister |
| 绑定注册表 | 新 `backend/src/services/vrouter/vrInstanceBinders.ts`（SRv6 / HA / IPsec） |
| 删除编排 | 新 `backend/src/services/vrouter/vrInstanceDeleteService.ts` |
| 注销 API（仅服务层调用） | `frontend/src/services/virtualRouterApi.ts` 今日 `deleteVRInstance` 迁到后端；CSM `DELETE /V2/vrcontrol/VR1/unregister` |
| CSM 注销 | `ibr-controller/.../VrInServiceImpl.unregister`（保持删 VR1/VR2/状态；设备回退必须在 **此调用之前** 由 SDNC 完成） |
| SRv6 引用 | `findSrv6TunnelsReferencingVr`；`fetchSrv6VrReferences` |
| 隧道回退（先拆引用） | `backend/src/routes/sdn/srv6.delete.ts` |
| Layer −1 捕获 | `VRConfig.rolePreSnapshot`；仅「快照空 + 平台 role 空 + VR2 无 role」时在 `upsert` / `set-role` 写库前 GET（§6.1） |
| 回退 POST | `vrController.updateVRConfig(uuid, rolePreSnapshot)`。**不**调用 `pushVRConfig`。漂移用 `diffConfigSemantic` 全量比（含 vrrp），**不**用 `deploy-drift?domain=srv6` |
| VR2 回写 | `vr2PlatformSync.ts`（方案 2：永不盖 `config_json`，也不用 VR2 建行） |
| 专家模式 | `EditVRConfig.tsx` + `POST /api/vr-config/upsert?source=expert` + 新 dispatch-full；去掉裸代理与写死的 accesskey |
| 实体 | `VRConfig.rolePreSnapshot`；`IbrHaGroupMember.vrUuid`；`ACL*` / `NATAddressGroup.vrId`；`IPsecVPN.localVrId`/`peerVrId` |
| 单测 | 见 §18 各步；门闩 / 捕获不覆盖 / POST 失败不注销 / 专家 409 与普通 upsert 分流 |

E2E：门闩与删除选项登记 `tests/e2e-manifest.cjs`（见 `tests/E2E_COVERAGE.md`）。

---

## 10. 验收要点（落地后）

1. 被 SRv6 引用的实例无法删除，提示含隧道名。删光隧道 **档案** 后即可删实例，不要求先勾隧道的设备回退。  
2. HA 成员、IPsec 本端或对端同样挡删除。  
3. 无引用、无 Layer −1：控制器与平台库无该 uuid；设备 CLI **仍在**。  
4. 无引用、有 Layer −1：`applied` 之后设备才是角色前快照（Hub 本机 `device_baseline` 口仍在）；然后 VR1/VR2/平台行消失；再注册为空行。  
5. 无 Layer −1：对话框没有回退勾选，只能平台注销。  
6. POST 失败、或超时仍未 `applied`：不 unregister，用户可重试或取消。  
7. 不把 `srv6BaselineJson` 或空 JSON 当作回退 payload。快照里不带 `report_config_status`。

---

## 11. 明确不做（除非另开需求）

- 删实例时自动对四端做隧道 recompute  
- 用空 JSON / 骨架配置冒充回退出厂  
- 静默改设备 uuid、停 vrctl-agent、或当身份迁移工具  
- 历史存量实例强制补 Layer −1  
- 把角色向导改成走分域 `pushVRConfig`（初始化通道边界见下发文档 §5）
- 实例详情再做「角色态 vs 设备」覆盖（删实例收口后角色态已无意义）
- 为 clish / 临时 CLI 做「从设备导入平台」（临时改动不上报，下次 agent 按 VR2 会冲掉）
- 把 SRv6 公式从 `config_json` 拆成另一张表，好让五分钟继续当 VR2 镜子（§14 否决的方案 1）

---

## 12. 只删平台之后：残留跟谁走

删隧道 / 解散 HA 都可以只改 sqlite、不 POST VR2。列表空了，删实例门闩放行，VR2 和盒子上邻居 / VRRP 可能还在。原来的删除框没了，无法再勾一次回退。

### 12.0 产品口径（已收简）

**不做「留着这台 IBR、只剥残留」的详情对账。** 角色态覆盖、更严门闩、重建隧道/HA，全部不做。

收口目标就一件：删实例成功后，agent 再注册上来应是 **角色前空机**。实现是注销前 POST Layer −1，并等到 agent `applied`，然后 unregister。忘了回退的邻居 / VRRP / 角色段都在这一次 diff 里被盖掉。只 POST、不等 `applied` 就注销，盒子不会变空。

今日只注销、不 POST，再注册得到的是控制器上空 VR2，**盒子 CLI 不会自己变空**。要变成你说的空设备，必须走 Layer −1，不能指望五分钟同步或黄标。

### 12.1 现成对账为什么帮不上

| 能力 | 比什么 | 只清平台之后 |
|------|--------|--------------|
| 删实例（**现网**） | 只 unregister | 不读 VR2 |
| SRv6 黄标 | sqlite 账本 ≟ sqlite 公式 | **不读 VR2**。刚 recompute 完是绿的。现网零隧道后五分钟可能把脏 VR2 盖回账本才变黄（§14 半套）；「扫描并修复」只把账本写回公式，**仍不下发**。方案 2 落地后这条循环应消失 |
| 下发漂移 `domain=srv6` | 要有人去点下发才跑；H0 忽略 VRRP | 不是残留扫描 |
| HA 对账 | 依赖还在的组意图 | 组删了就没有对端 |

### 12.2 删实例时残留怎么处理

```text
绑定已空 → POST Layer −1（全量，含 vrrp）→ applied → 再 unregister
         → 设备 = 角色前；控制器无 VR1/VR2
         → 同一 uuid 再 register = 空行，角色未设
```

没有 Layer −1 快照：只能平台注销（§6.3），不能拿 `srv6BaselineJson` 或空骨架冒充。存量无快照、必须清 CLI 时走专家模式或设备侧（§15），不在删除对话框里赌空配置。

### 12.3 明确不要

- 实例详情再做一套「角色态 vs 设备」覆盖（删完实例角色态也没了，留着只会绕）
- 为补残留重建隧道 / HA
- 组已删还跑 HA reconcile
- 用 SRv6「扫描并修复」冒充已清设备

---

## 13. 绑定注册表（以后业务照搬）

删 VR **不**为每个新业务加一支 if。每个跨实例（或占住这台 VR 不能收口）的业务登记一条 binder：

| 字段 | 含义 |
|------|------|
| 检测 | 这台 uuid 是否仍被本业务引用 |
| 清平台 | 本业务自己的删档案 / 解绑 |
| 清设备 | 本业务自己的 revertDevice / 分域 push |
| 文案 | 门闩里怎么列待办、跳到哪条现有删除流 |

一期登记：SRv6 端点、HA 成员、IPsec 端点。RR 反射域节点按地址不是按 uuid，邻居随隧道 `injectedDelta` 走，一期不单独挡。ACL/NAT 是本机分域策略，不是 binder，随 Layer −1 或分域清空覆盖。

新业务（再来一种会话/组）按 SRv6/HA/IPsec 同一套：自己管叠加与回退；删 VR 只问注册表是否已空。

---

## 14. 账本与 VR2 镜子拆开（方案 2）

### 14.1 半套改造在干什么

五分钟同步比 SRv6 账本更早：列表不能每次打 CSM，所以抄 VR1/VR3 到 `VRCache*`。顺带把 VR2 写入 `config_json`，当时这份 sqlite 是 **设备镜子**。

SRv6 后来让同一张 `config_json` 改当 **公式结果**。有隧道时加了 `shouldPreserveSrv6PlatformLedger`（有基线且仍被引用则不盖），以免注入项被 VR2 抹掉。零隧道后保护取消，想的是「空闲了，再当镜子，方便下一次向导/捕获基线」——不是为了报黄标。

后果：基线还留着，黄标仍拿账本比基线。镜子一恢复，脏 VR2 写进账本，黄标才亮；「扫描并修复」把账本写回公式，下一轮又盖回来。这是 **「空闲跟设备」和「空闲仍对公式」抢同一张表**。

### 14.2 评过的两条路

| | 方案 1：SRv6 公式不再写 `config_json` | 方案 2：五分钟不再用 VR2 盖 `config_json` |
|--|--------------------------------------|------------------------------------------|
| 想法 | 公式单独放，`config_json` 继续当镜子，有没有隧道都覆盖 | sqlite 只由平台自己写；VR1/VR3 照刷列表；要看设备就 GET 实时 VR2 |
| 前提错误 | 「其它业务各有一份 config_json」——没有。ACL/NAT/IPsec 有自己的表，下发仍 merge 进 **这一张** 整机 JSON | 列表本来就不读 VR2 业务 |
| 改动面 | 下发/回退/捕获/黄标/单测全换数据源；定时覆盖仍可能冲掉未下发的 ACL 切片 | 主要改 `vr2PlatformSync`（跳过或删除对 `config_json` 的覆盖，角色仍可从 VR2 同步） |
| 黄标循环 | 不直接消；镜子会把脏 VR2 抄回整机底稿 | 停：零隧道后账本保持公式 |
| 结论 | **否决** | **采用** |

更小的补丁（「只要有基线就永不覆盖」）能掐掉这条循环，但 `config_json` 仍然一身二职，后面还会绊，不当终态。

### 14.3 方案 2 落地后谁读什么

| 读者 | 数据 |
|------|------|
| IBR 实例列表 | `VRCache*`（VR1/VR3） |
| 详情「本地配置」 | `config_json` = **上次平台意图**，不再冒充设备镜像 |
| 详情控制面 / 向导左侧设备回读 | 实时 `vr2_info` / `GET VR2` |
| SRv6 下发意图 | `config_json` 或现场 `merge(基线, Δ)` |
| 删实例 Layer −1 漂移 | **当前 VR2** vs 快照，与五分钟无关 |

专家模式改 VR2 后 sqlite 是否落后，见 §15。Clish 不上报，**不做**「从设备导入平台」。

方案 2 与删实例独立，但建议不晚于阶段 C：否则零隧道后黄标仍会谎报，运维容易以为「扫描并修复」清了设备。

---

## 15. 专家模式入口

现网 `EditVRConfig` **会走平台**，不是「专家 = 只改 VR2」：

| 按钮 | sqlite | VR2 |
|------|--------|-----|
| 保存到平台 | `POST /api/vr-config/upsert` | 不动 |
| 保存并下发 | 先 upsert，再 **代理裸 POST** `/V2/ctcontrol/VR2/VRConfig`（不走 `pushVRConfig`） | 被专家 JSON 盖掉 |

upsert 在 **有存活隧道** 时丢掉提交正文、只 `persistSrv6VrEffectiveConfig`（接口仍 200）。于是「保存并下发」成功后：sqlite 仍是公式，VR2 已是专家 JSON。有隧道时五分钟本来就不盖账本，**今天就会落后**；方案 2 不把它变坏。无隧道时 upsert 会写 `config_json`（有基线则连基线一起刷新），保存并下发两边对齐。

**要做（阶段 F）**

1. 保存和下发同一条链路：upsert 成功再 `updateVRConfig`，禁止裸代理绕过指纹锁。
2. 有存活 SRv6 隧道：保存、下发都 **409**，引导改/删隧道，禁止专家改 BGP/SID 等指纹。
3. 无隧道：专家 JSON 写入账本后再 POST VR2。

**不做**：定时用 VR2 追专家结果；为 clish 做导入（临时改动，下次 agent 按 VR2 冲掉）。下一次分域下发的漂移弹窗仍是安全网：VR2 多出来的项会列出，确认后以平台意图覆盖。

存量无 Layer −1、又必须清设备时，专家模式仍是应急，不是删实例对话框的一部分。

---

## 16. 列表三列：对账、漂移、生命周期

不要把三件事叫成同一种「配置检查」。

| | 比什么 | 看见什么 | 怎么修 |
|--|--------|----------|--------|
| **配置健康 / 黄标 / 扫描并修复** | sqlite `config_json` ≟ sqlite 公式 | 平台有没有把账本算对。**不读 VR2** | 修复以 **公式为准** 重写账本，不下发、不改 VR2、不改基线 |
| **下发弹窗** | 当前 CSM **VR2** vs 本次平台意图（通常来自 `config_json` 或刚 recompute 的公式） | 全量 POST 会不会盖掉 VR2 多出来的项 | 确认后以意图覆盖。Clish 改 FRR 不上报，看不见 |
| **生命周期** | 平台档案自己的阶段字段 | **不是**线路已通，也不是配置健康 | 见下 |

删实例有快照时的确认框，比的是 **当前 VR2 vs Layer −1**（全量，含 vrrp），不是黄标，也不是 `domain=srv6` 的下发预览。

### 16.1 SRv6 隧道「生命周期」

字段 `srv6_tunnels.status`。Tooltip：平台档案生命周期，不等于线路已通。

| 界面 | 值 | 何时 |
|------|-----|------|
| 创建中 | `creating` | 刚插入 |
| 可用 | `available` | 创建成功约 1s 后改过来（**不表示已下发/BGP 已通**） |
| 下发中 / 已降级 | `deploying` / `degraded` | 枚举还在，现网创建/下发 **不再写入** |
| 异常 | `error` | **历史**：删隧道回退失败曾写死。现网失败不再改这一列 |

历史 `error` 不会因健康变绿、解散 HA、刷新列表而变回可用；write 权限复位且配置健康须 ok。

### 16.2 HA 组「生命周期」

字段 `ibr_ha_group.status`。Tooltip：不等于 VRRP 已通。

| 界面 | 值 | 何时 |
|------|-----|------|
| 草稿 | `draft` | 刚建组；改意图或换成员后从已配置/降级退回 |
| 已配置 | `configured` | 主、备两次 VRRP 下发都成功 |
| 降级 | `degraded` | 主成功备失败；或已下发过之后某步又失败 |
| 未知 | `unknown` | 类型里有，现网几乎不用 |

IBR 实例列表的「状态」（运行中/已停止）来自 VR3 健康，与上两列不是一回事。

---

## 17. 修订

| 日期 | 说明 |
|------|------|
| 2026-11-11 | 初稿：现状、两层基线、状态机、Layer −1、分期 A–D；代码未落地 |
| 2026-11-16 | 复核：HA 解散现网仍 409 vs 意图允许刷指纹（§5.1）；平台已空的 CLI 残留补救（§12）；binder 注册表（§13）；删后重登用 VR1 `createDate` 而非设备 uptime（§7.1） |
| 2026-11-16 | HA `remove()` 接线 `detachSrv6TunnelsFromHaGroup`（不再因指纹 409）；列表「登记时间」；§6.0 对齐 Layer −1 = 角色前、非 SRv6 基线 |
| 2026-11-17 | §12 重写：现网对账看不见残留；删实例勾 CLI = 一次 Layer −1；否决「先清残留才能删」 |
| 2026-11-17 | 收简：不做详情「角色态覆盖」；再注册目标 = 角色前空机。§4.0 分层：sqlite 账本 / Mongo VR2 / VRCache / 五分钟同步方向 |
| 2026-11-17 | §14 采用账本/VR2 分离（否决拆 SRv6 公式表）；§15 专家入口；§16 黄标/下发漂移/生命周期。删实例有快照则 POST Layer −1；不做 clish 导入 |
| 2026-11-17 | 评审硬规则写入 §3/§6；IPsec 门闩字段写死；§8 调整为 E→C0→F→A/B→C/D；新增 **§18 开发落地计划与回归** |
| 2026-11-17 | **基线**：捕获只在「尚无角色」时发生，禁止补录；回退改走 `updateVRConfig` 并等到 `applied` 再注销；去掉回退勾选与 `pushVRConfig` |

---

## 18. 开发落地计划与回归

每步单独可合入、有完成门禁。下一步未开始前，本步自动化必须绿、手工清单必须打勾。不要把 E/F/C 揉进同一个 PR。

### 18.0 开工硬规则（评审已钉，编码勿再讨论）

| # | 规则 |
|---|------|
| 1 | 只在「快照空 + 平台 role 空 + VR2 无 role 且非空」时，从 GET VR2 捕获。不用 `config_json`。已有角色 **不补录**。不存 `{}`，不存 `report_config_status` |
| 2 | 回退只调 `updateVRConfig(快照)`。**不**走 `pushVRConfig`，**不**用 `deploy-drift?domain=srv6`。diff 含 VRRP |
| 3 | 有快照：POST 后必须等到 `applied` 才 unregister。超时、POST 失败、未 applied：**不注销**。VR2 已等于快照时重试 **不再 POST**。无快照：只平台注销，无回退勾选 |
| 4 | 方案 2：**永不**用 VR2 盖/建 `config_json`，也不改 `rolePreSnapshot` / `srv6BaselineJson`。无 `vr_config` 行时向导读实时 VR2 |
| 5 | IPsec 门闩：`localVrId` **或** `peerVrId` |
| 6 | 专家 409 仅 `source=expert`，且 **先于**捕获。PE ND / `persistSrv6VrEffectiveConfig` 仍走普通 upsert。等 `applied` 只用于删实例，不用于向导/专家 |
| 7 | 不做 clish 导入、不做详情「角色态覆盖」、不重建隧道/HA、不把黄标当设备已清 |

建议合入顺序：**E → C0 → F（可与 C0 并行）→ A+B → C+D**。C0 尽早合入是为了让实验室开始攒快照。

---

### 18.1 步骤 E — 账本 / VR2 分离

**目标**：五分钟 / 列表刷新只更新 `VRCache*`（VR1/VR3）；`config_json` 只由平台自己写。

**改动**

| 落点 | 做什么 |
|------|--------|
| `backend/src/services/vrouter/vr2PlatformSync.ts` | 有 `vr_config` 行：最多同步 `role`，**永不**写 `config_json` / `rolePreSnapshot` / `srv6BaselineJson`。无行：**不要**用 VR2 `create` |
| `vr2PlatformSync.test.ts` | 重写现网「无基线 / 零隧道仍覆盖 / 无行则建行」三条 |
| `docs/srv6-config-ledger-and-drift.md` §2 / §10.1 | 改成「已落地：不再回写账本」 |

**不做**：拆第二张 SRv6 表；停 VR1/VR3 列表缓存；改黄标公式。

**自动化**

- 有基线 + 有隧道：不盖 `config_json`，role 仍可更新（现有用例保留）。
- 有基线 + **零隧道**：`config_json` 仍是公式，**不再**被脏 VR2 盖掉（现网会覆盖，本步必须改红→绿）。
- 无基线：同样不盖。
- 平台无行 + CSM 有 VR2：不 `create`，`updated=0`。
- 无 VR2：不删既有行。
- `cd backend && npx jest src/services/vrouter/vr2PlatformSync.test.ts src/routes/sdn/srv6.reconcile.test.ts src/routes/sdn/srv6.listHealth.test.ts`

**本步验收（手工）**

1. 删光隧道、不回退设备：账本已是公式。等五分钟或点 IBR 列表刷新 → 黄标 **保持绿**（或保持原来的账本≟公式结果），不会过一会变黄。
2. 同一实例详情「本地配置」仍是公式，不是 VR2 脏邻居。
3. 「扫描并修复」仍只写 sqlite、不下发。
4. 列表名称 / ONLINE / 流量 / 登记时间刷新正常。
5. 尚无 `vr_config` 的新注册空机：打开角色向导，左侧设备回读仍是 GET VR2，不能空白卡死。

**回归（不得坏）**

- SRv6 建隧道 / 删隧道勾回退 / 下发弹窗（读的是 VR2 vs 意图，与五分钟无关）。
- HA 下发 / 解散回退（不经 `vr2PlatformSync`）。
- ACL / NAT / IPsec 分域 push（成功后仍写 `config_json`）。

**完成门禁**：上列 Jest 绿；零隧道黄标循环在实验室复现一次并确认消失。

---

### 18.2 步骤 C0 — 捕获 Layer −1

**目标**：第一次写角色之前把实时 VR2 存进 `rolePreSnapshot`；二次向导不覆盖。

**改动**

| 落点 | 做什么 |
|------|--------|
| `entities/vRouter/VRConfig.ts` | 可空 `text` 字段 `rolePreSnapshot`（`DB_SYNC=true` 本地即可） |
| 新 `services/vrouter/rolePreSnapshot.ts` | `captureRolePreSnapshotIfEmpty(uuid)`：按 §6.1 三条件。不满足则直接返回，不 GET。满足但 GET 失败 / VR2 空 → 抛错，调用方不写库 |
| `routes/sdn/vrConfig.ts` · `upsert`、`set-role` | **写库之前**调用。专家 409 判断放在捕获之前。快照是剥掉元数据的 VR2，不是请求 body |
| 四向导 | 不必各写一份 GET；走现有 `saveVRConfig` / `setVRRole` 即可。捕获失败要让用户看到错误、不得继续 POST VR2 |

**不做**：补录历史实例；二次改角色换快照；挂在五分钟同步上。

**自动化**（`rolePreSnapshot.test.ts`）

- 三条件都满足：快照等于剥掉元数据的 VR2（含 `device_baseline` 口，无 `role`，无 `report_config_status`）。
- 再 upsert 带角色的 body → 快照不变，且不等于新 body。
- 平台 role 已有，或 VR2 已有 role → **不写**快照（禁止补录）。
- VR2 为空或只剩元数据 → 不写 `{}`，且不写 `config_json` / role。
- GET 失败且本应捕获 → 不写库。已有快照或不应捕获 → 不 GET，后续保存照常。

**本步验收（手工）**

对 **PE / CE / Hub / 标准 / SASE** 各走一次首次向导下发：

1. sqlite `rolePreSnapshot` 有值；JSON 没有向导写入的 BGP/SID/角色段，也没有 `report_config_status`。
2. Hub：本机 `device_baseline` 口地址在快照里。
3. 同一台再跑一次向导：快照不换。这台是历史已有角色、快照仍空时：再跑向导 **不会**突然写入快照。
4. **首次**捕获时拔 CSM：保存失败、设备角色未改。已有快照的向导不因捕获去打 CSM。

**回归**：向导成功路径（save + setRole + POST VR2）与现网一致；有隧道时 PE ND-only、CE 拒绝全量覆盖的现网行为不变。

**完成门禁**：单测绿；至少一个角色的实验室实例能在 sqlite 读到快照。此后新向导实例才具备阶段 C 资格。

---

### 18.3 步骤 F — 专家入口统一

**目标**：专家「保存 / 保存并下发」与平台账本同一条链路；有存活隧道时专家进不去。

**改动**

| 落点 | 做什么 |
|------|--------|
| `POST /api/vr-config/upsert?source=expert` | **先**判断隧道：有存活 SRv6 → **409**（列隧道名），不捕获、不写库。无隧道 → 再按 §6.1 捕获（通常因 VR2 已有角色而跳过）→ 写提交正文 |
| 新 `POST /api/vr-config/:uuid/dispatch-full` | expert upsert 成功 → `vrController.updateVRConfig`。CSM 接受即返回，**不等** `applied`（等 applied 只在删实例） |
| `EditVRConfig.tsx` | `handleSave` / `handleSaveAndDispatch` 改打上述接口；**删除**写死的 accesskey/secretkey 与裸 POST |
| 普通 upsert | **保持**现网：有隧道 + 基线 → `persistSrv6VrEffectiveConfig`（丢正文）。指纹锁 `assertSrv6VrConfigUpsertAllowed` 仍在 |

**不做**：定时用 VR2 追专家结果；clish 导入；把 409 套到 PE ND / 分域 deploy。

**自动化**

- `source=expert` + 隧道 → 409，sqlite 不变。
- 无 `source` + 隧道 + 基线 → 仍 persist 公式（回归现网 upsert）。
- `source=expert` 无隧道 → `config_json` = body。
- `dispatch-full` 无隧道 → 调用 `updateVRConfig`；upsert 失败则 **不** POST。
- `dispatch-full` 有隧道 → 409，不 POST。

**本步验收（手工）**

1. 无隧道：专家改一处接口描述 → 保存后详情「本地配置」已变；保存并下发后 GET VR2 一致。
2. 有隧道：两个按钮都 409，文案带隧道名并引导 SRv6 列表；VR2 与账本都不变。
3. 有隧道：PE 向导 ND 代答仍能保存（走普通 upsert）。
4. 无隧道专家下发后，SRv6 尚未建：黄标不适用或仍按公式（无基线则无黄标）。

**回归**：ACL/NAT/IPsec/SRv6 `deploy/push`、HA deploy、指纹锁单测 `srv6.vrLock.test.ts`。

**完成门禁**：专家页不再出现硬编码密钥；有/无隧道两条手工路径通过。

---

### 18.4 步骤 A — 引用门闩

**目标**：binder 非空则删实例 409，并按待办清单列出对象。前端不再直打 CSM unregister。

**改动**

| 落点 | 做什么 |
|------|--------|
| 新 `vrInstanceBinders.ts` | SRv6：`findSrv6TunnelsReferencingVr`；HA：`ibr_ha_group_member.vrUuid`；IPsec：`localVrId` **或** `peerVrId` |
| 新 `DELETE /api/vr-instances/:uuid` | 先 binders；非空 409 `{ binders: [{ type, id, name, href }] }` |
| `routers/index.tsx` | 删除改走该 API；409 展示隧道/HA/IPsec 名称，跳到现有删除流。无 write 权限：**隐藏**删除（不要置灰） |
| `virtualRouterApi.ts` | 列表删除不再调 CSM unregister |

**自动化**（`vrInstanceBinders.test.ts` / delete service）

- 四端任一命中 SRv6 → 409，含隧道名。
- HA 主或备 → 409，含组名。
- IPsec 本端、对端各一条 → 409。
- 三者都空 → 放行到 B（本步可 mock 掉 unregister）。
- 缺 uuid → 400。

**本步验收（手工）**

1. 隧道端点点删除：提示含隧道名，点过去是现网「删除隧道」。
2. HA 成员、IPsec 本端/对端：同样挡，且 **不要**三条 409 叠成一句。
3. 先按现网拆光引用后，删除框才能继续。
4. 只读账号看不到删除。

**回归**：SRv6/HA/IPsec 自己的删除+回退；HA 解散仍剥指纹、不 409。

**完成门禁**：三条 binder 单测绿；UI 三条待办能点到现网页面。可与 B 同一 PR。

---

### 18.5 步骤 B — 平台侧收口

**目标**：门闩通过后才 unregister；无论有无快照，平台 sqlite 行清掉。CSM 失败则不动库。

**改动**（`vrInstanceDeleteService.ts`）

顺序：binders 空 →（阶段 C：POST 快照并等到 `applied`；无快照则跳过）→ CSM unregister → 删：

- `vr_config`（含 baseline / Layer −1）
- `ACLGroup` / `ACLRule` / `ACLGroupBinding`（`vrId`）
- `NATAddressGroup`（`vrId`，mapping cascade）
- `VRCacheBasic` / `VRCacheExtended`
- IPsec / HA 成员此时应已空；若仍有行视为门闩 bug，**不要**在删 VR 里悄悄拆对端

CSM **404**：视为已注销，仍做 sqlite 清理（可重试）。unregister 网络/5xx：**不**删 sqlite。

**自动化**

- unregister 成功 → 上列行数为 0。
- unregister 抛错 → `vr_config` 仍在。
- 404 → 仍清理 sqlite。
- binders 非空 → 不调用 unregister、不删行。

**本步验收（手工，无快照实例）**

1. 无引用、无 Layer −1：删除成功；列表无该 uuid（直到 agent 再注册）。
2. 详情 / ACL / NAT 不再出现该 VR 的平台行。
3. **设备 CLI 仍在**（这是无快照的合法结果，不是 bug）。
4. 点列表刷新：不会从 sqlite 把已删配置救回来。

**回归**：`POST /api/vr-instances/refresh` 仍只同步 VR1/VR3；其它实例的 `vr_config` 还在。

**完成门禁**：无快照删除的实验室路径走通；A 的 409 路径未回归。

---

### 18.6 步骤 C — 设备回退（有快照则必须 POST）

**目标**：有 `rolePreSnapshot` 时，先全量盖回角色前，成功再走 B。这是「再上来是空机」的唯一实现。

**改动**

| 落点 | 做什么 |
|------|--------|
| `GET /api/vr-instances/:uuid/delete-preview` | binders + 是否有快照 + **当前 VR2 vs Layer −1** 的 `diffConfigSemantic`（含 vrrp，去元数据）。不是 `srv6BaselineJson`，不是 `deploy-drift?domain=srv6` |
| `DELETE /api/vr-instances/:uuid` | body `{ acknowledgeDrift?: boolean }`。有快照：有差异且未 ack → 409。ack 后若 VR2 已等于快照则不 POST，否则 `updateVRConfig`。然后轮询 `applied`（建议 90s）。未 applied 或 POST 失败 → **不** unregister，不改 sqlite。无快照：不 POST，走 B，`deviceReverted: false` |
| 前端删除框 | 有快照：列出将从设备拿掉的项（邻居 / VRRP / 角色段）→ 确认后 DELETE，并显示「等待设备应用」。无快照：只说明 CLI 保留，**没有**回退勾选 |

**不做**：空骨架 POST；用 Layer 0 冒充；详情另做角色态覆盖。

**自动化**

- 有快照 + POST 成功 + `applied` → 才 unregister。
- POST 失败，或超时未 `applied` → 不 unregister，`config_json` 与快照列都不变。
- VR2 已与快照语义相同且未 applied → **零次** `updateVRConfig`，继续等；仍超时则不注销。
- 有差异且未 ack → 409，不 POST。
- 无快照 → 不 POST，unregister。
- POST 的 JSON **等于**快照，**不等于** `srv6BaselineJson`，且不含 `report_config_status`。
- 设备多一段 `vrrp` 时预览 **能**报出来。
- 断言删除服务 **没有**调用 `pushVRConfig`。

**本步验收（手工，必须用 C0 之后向导过的实例）**

1. 建角色 →（可选）建隧道再只清平台删光 →（可选）HA 只清平台解散 → 删实例。弹窗列出 VR2 上多出来的邻居/VRRP/角色段。
2. 确认后先看到「等待设备应用」。`applied` 之后：Hub 本机口还在；向导段 / 隧道邻居 / 本组 VRRP 从 CLI 消失。然后列表该行消失。
3. 同一 uuid 再注册 = **空行**（无角色、无隧道）；**登记时间接近刚才**。
4. 停 CSM，或把 agent 停住让 `applied` 不来：实例仍在，sqlite 还在，可重试。重试时若 VR2 已是快照，不应把 checksum 再打乱一遍。
5. 存量无快照实例：框上无回退勾选，删除后 CLI 仍在（与 B 一致）。历史已有角色的机器，再跑一次向导后快照仍为空。

**回归**：日常 ACL/NAT/IPsec/SRv6 分域下发仍按原 domain；SRv6 下发 H0 **仍保留** VRRP；HA 解散回退仍剥指纹。

**完成门禁**：上列 1–4 在实验室至少一条 PE 或 Hub 闭环；Jest 含「失败不注销」与「payload ≠ srv6Baseline」。

---

### 18.7 步骤 D — 身份文案

**目标**：删除框写清「CLI 回退」和「agent 再注册」是两件事。

**改动**：C 的同一对话框加说明——注销后若 `registervr.conf` 仍有该 uuid，列表可能再出现空行，用 **登记时间** 区分；一期不改 uuid、不停 agent、不碰 `.registration_finish`。

**自动化**：无（文案）。可选：unregister 后 mock 再 register，列表 `createDate` 更新（若已有 VR1 单测则顺手加）。

**本步验收**

1. 删后 agent 再报：新行、登记时间新、角色未设。这是预期，不是回退失败。
2. 未注销、仅心跳恢复：登记时间 **不变**。

**完成门禁**：与 C 同 PR 合入即可。

---

### 18.8 全链路实验室（C+D 合入后做一次）

按顺序，中途失败停在该步，不要跳到「直接注销」充数。

| # | 动作 | 期望 |
|---|------|------|
| 1 | 新盒子注册 | 列表有行；无角色；无 `rolePreSnapshot` |
| 2 | 角色向导下发 | 有快照；快照无角色段；设备已角色化 |
| 3 | 建 SRv6（可选 HA） | 黄标绿；删实例 409 列出隧道/组 |
| 4 | 只清平台删隧道 / 解散 HA | 列表空绑定；设备邻居/VRRP 可能仍在；黄标不因五分钟变黄（E） |
| 5 | 删实例，看 drift | 残留项出现在弹窗，不是黄标 |
| 6 | 确认删除 | 先 `applied`，CLI ≈ 角色前；然后控制器无 VR1/VR2；sqlite 无该 uuid 配置 |
| 7 | agent 再注册 | 空行；登记时间新；再向导是全新角色化 |
| 8 | 对照组：无快照存量删除 | 仅平台注销，CLI 仍在 |

E2E：实现 A/B/C 的 API 测试文件后登记 `tests/e2e-manifest.cjs`（见 `tests/E2E_COVERAGE.md`）。浏览器用例实验室有设备再补；未登记空文件。建议 id：`ibr-vr-delete-binders`（A）、`ibr-vr-delete-lifecycle`（C，可 `deferred` 到有设备）。

---

### 18.9 PR 切分与门禁命令

| PR | 步骤 | 最少命令 |
|----|------|----------|
| 1 | E | `cd backend && npx jest src/services/vrouter/vr2PlatformSync.test.ts` |
| 2 | C0 | `npx jest src/services/vrouter/rolePreSnapshot.test.ts` |
| 3 | F | 专家 upsert/dispatch 单测 + `src/routes/sdn/srv6.vrLock.test.ts` |
| 4 | A+B | binders + delete service 单测 |
| 5 | C+D | delete service（含 applied 才注销、超时不注销、已相等不再 POST、无快照）+ `vrConfigDeploy.test.ts`（确认日常 srv6 域仍忽略 vrrp，删实例不调用该路径） |

合入前另跑与触碰文件相关的现网套件（HA：`haGroup*.test.ts`；SRv6：`srv6.reconcile` / `srv6.delete` 若有）。前端改动按 `docs/frontend-layout.md` 与 RBAC 隐藏按钮。不提交密钥、不在删除路径上加空 JSON 假回退。
