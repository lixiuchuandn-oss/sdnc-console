# SRv6 配置账本、叠加与漂移

> **读法**：先看 §1～§3（三份配置 + 公式），再看 §4（两套告警不要混）。  
> **关联**：隧道三层模型见 [`srv6-baseline-recompute.md`](./srv6-baseline-recompute.md)；统一下发网关见 [`ibr-vr-config-deploy.md`](./ibr-vr-config-deploy.md)；CSMCTL / agent 边界见 [`ibr-stack-components.md`](./ibr-stack-components.md)。  
> **代码**：`backend/src/utils/configSemanticEqual.ts`、`vrConfigDeploy.ts` · `detectDeployDrift`、`routes/sdn/srv6.reconcile.ts`。

本文回答：平台意图怎么叠、什么叫漂移、弹窗和黄标各管什么、怎样算修完。2026-11-09 起下发/对账改为**语义比较**（见 §6）。

---

## 1. 本轮约定是否已覆盖

| 约定 | 是否已落地 | 说明 |
|------|------------|------|
| 下发以新意图为准 | 是 | 用户确认覆盖（或无需弹窗）后，SRv6 域整 key 用平台意图盖到 VR2 |
| 只有「将丢掉设备独有项」才弹明确清单 | 是 | 仅 `removed` / `changed` 阻塞；文案带路径 |
| 首条隧道首次下发不弹 | 是 | 设备侧是基线、平台只**多注入**贡献时视为预期，不弹窗 |
| 对账忽略元数据和 key 顺序 | 是 | 丢掉 `_id` / 时间戳 / `report_config_status` 等，对象 key 排序后再比 |
| 黄标只表示公式/业务字段真不一致 | 是 | 仅包装字段或顺序不同 → 健康 |
| 修复修的是账本不是设备 | 是 | 「扫描并修复」只写 SQLite，**不下发** |

**注入字段不是白名单。** 「邻居 + VRF `::/0`」只是当前隧道贡献的例子。判定是树形 diff：平台多出来的任意业务字段都算「注入」，不必改告警代码；见 §7。

**黄标多数可对账修复，不是全部。** `INVARIANT_DRIFT` / `ORPHAN_BASELINE_DRIFT` 可点「扫描并修复」。缺基线、JSON 损坏不能自动修。控制面 VR2 业务字段已偏离公式时，修账本挡不住 VR-Cache 回写，需要对齐下发；见 §8。

---

## 2. 先分清三份配置（不要混）

| 名称 | 存在哪 | 是什么 | 谁在改 |
|------|--------|--------|--------|
| **实时 VR2** | CSMCTL Mongo | 控制面**已接受**的整份 JSON；agent 下载并应用到设备 | 向导/专家模式/统一下发 POST |
| **平台账本** | SQLite `vr_config.config_json`；详情「本地配置 (Cache)」 | SRv6 规定它应等于下面的**公式**；也是再下发的底稿 | 隧道 recompute、下发成功回写、**VR-Cache 定时用 VR2 整份覆盖** |
| **设备 FRR / VPP** | 盒子本机 | 真正在跑的转发表 | agent 按 VR2 应用；clish 本地改 **不上报** |

`GET VR2` **不是**读 FRR。南向只有：下载 VR2、上报 applied/error、VR3 接口/运行态。  
clish 加的 BGP 邻居：**弹窗看不见**；下次 agent 按 VR2 应用会被冲掉。

弹窗里能比到的「设备多出来的东西」，只可能来自**另一条北向写 VR2 的路径**（专家模式、角色向导、其它业务 POST），不是盒子上偷偷改、又不上报的那份。

后台 `VRCacheService`（约 5 分钟，列表刷新也会跑）会把 VR2 写进同一张 `config_json`。账本因此经常长得像 VR2，但职责仍是「公式底稿」，不是第三份终极配置。

---

## 3. 公式：基线 + 存活隧道叠加

```text
公式 = merge(向导基线 srv6BaselineJson, Σ 存活隧道对该 VR 的 injectedDelta)
账本 ≟ 公式     ← 列表黄标 / 「配置对账」只问这一句
```

| 层 | 字段 | 含义 |
|----|------|------|
| 0 基线 | `srv6BaselineJson` | 该 VR **第一次**被隧道引用前的向导快照（无隧道后可再对齐） |
| 1 贡献 | `SRv6Tunnel.injectedDelta` | 相对基线**新增**的 neighbors、activate AF、NDC、RD/RT、ipv6Routes 等 |
| 2 账本 | `config_json` | 设计上 = 公式；给删除回退和再下发用 |

删除隧道不靠「从现网抠条目」，而是 **exclude 该隧道贡献再 recompute**。所以账本必须还能等于公式，否则下一次删除/下发会按错误底稿算。

---

## 4. 两套告警（产品上必须分开）

| | 下发弹窗「检测到配置漂移」 | 列表黄标 / 「配置对账」 |
|--|---------------------------|-------------------------|
| **何时** | 创建隧道后对各端 `deploy/push` | 拉列表时对账；工具栏「配置对账」 |
| **比什么** | CSM **VR2** vs 平台意图（此时意图已是公式） | **账本** vs **公式** |
| **不管什么** | 不是 FRR，不是 live BGP | 不是线路是否已通，不是 VR2 的 `_id` |
| **正常** | 平台只比 VR2 **多注入**公式项 → **不弹** | 业务字段语义相等 → **健康** |
| **要拦** | VR2 里有意图没有的项，或同路径值被改过 → 列出将丢掉/将修改 | 账本业务字段 ≠ 公式 |
| **怎么修** | 确认后以**新意图**覆盖 SRv6 域（ACL/NAT/IPsec 保留） | 「扫描并修复」重写账本；**不下发** |

界面：黄标可点，打开对账弹窗；「扫描并修复」写库后刷新列表。

SRv6 下发若 VR2 的 `acl` / `nat` / `ipsec` 与账本不一致，只出 **PLATFORM_STALE**（不阻塞）：本次不覆盖这些域，提醒账本滞后。

CE 高可用 VRRP **不是**本文件的黄标范围（不进隧道公式）。HA 组自己的健康与解散回退见 [`ibr-ha-vrrp-health-and-rollback.md`](./ibr-ha-vrrp-health-and-rollback.md)。SRv6 下发/回退须成对保留设备接口 vrrp 与顶层 `vrrp`，避免冲掉 HA。

---

## 5. 原实现与问题（为何建一条隧道会连弹四次）

旧比较：整份 / 整 key `JSON.stringify`，空值才跳过。

1. **创建即告警**  
   隧道一保存就把公式写入账本，再去 GET VR2。VR2 还停在向导基线，公式已含邻居和 VRF `::/0`。整 key `bgp` / `ipv6_route` 必不等 → 四端各弹一次。用户只能点覆盖，弹窗只报 key 名，分不清「预期注入」还是「会删 VR2 里多的邻居」。

2. **黄标假阳性**  
   下发成功后 VR-Cache 把 CSM 文档（新 `_id` / 时间戳、对象 key 顺序可能变了）写回账本。对账仍用原始字符串去比「带着旧元数据的重算结果」→ 业务已齐也标黄。

3. **修复被回写打回**  
   「扫描并修复」把账本写成公式后，下一次 VR2 同步又用带新元数据的 VR2 盖回去，黄标可能再来。运维会以为设备不健康。

4. **两套告警文案接近**  
   都叫「不一致 / 漂移」，一个管下发覆盖，一个管账本公式，无法从界面判断怎么修。

---

## 6. 当前优化（2026-11-09）

共用 `backend/src/utils/configSemanticEqual.ts`：

- 比较前丢掉包装字段（与下发 `stripMeta` 同一套，外加 `_towerLocalMeta`）  
- 对象 key 排序；邻居按 `remote_ip`、路由按 `destination|via|vrf`、接口按 `name` 等指纹配对  
- diff 分类：`added`（右侧多）/ `removed`（左侧多）/ `changed`（同路径值不同）  
- **指纹对不上的落单项一律 `removed`/`added`**，不做「左右各剩 1 条就当成同一条」的强行配对（避免把「换掉旧路由」收成纯新增而漏拦）  
- 对账用 `configBusinessEqual`（`diff` 为空即相等，**忽略数组顺序**）；下发相等仍用 `configSemanticEqual`（保留 ACL/NAT 顺序敏感）

**下发（`detectDeployDrift`，域 = srv6）**

- 语义相等 → 跳过  
- 仅有 `added`（意图是 VR2 的超集，没有将删除/将改值）→ **不阻塞**  
- 有 `removed` 或 `changed` → 弹窗，文案带路径（设备多出 / 将从 A 改为 B）  
- 覆盖语义未变：确认后仍用平台 SRv6 意图盖 VR2 对应 key，ACL/NAT/IPsec 保留  

**对账（`jsonEqual` → `configBusinessEqual`）**

- 账本与公式只比业务字段（含邻居顺序无关）  
- 不一致时 issue 里带「账本多出 / 公式多出 / 值不同」  
- `INVARIANT_DRIFT` 修复：账本 ← 公式；`ORPHAN_BASELINE_DRIFT` 修复：账本 ← 基线（不改基线）  
- 修复文案写明「写回平台账本（未下发设备）」  

单测：`backend/src/utils/configSemanticEqual.test.ts`。

---

## 7. 叠加判定：动态扩充，不是写死邻居和 `::/0`

### 7.1 贡献怎么进公式

`injectedDelta` 由创建/更新隧道时按端生成，`mergeBaselineWithContributions` 叠进基线。今日常见项：

- `neighbors` / `activateAddressFamily` / `neighborDisableConnectedCheck`  
- `rdRt`  
- `ipv6Routes`（含 VRF `::/0 via nexthop-vrf 0`）  

以后在 merge 里增加 locator、policy、其它路由，**只要写进贡献并进公式**，账本和对账自动带上，不必改告警白名单。

### 7.2 下发何时不弹窗（与具体字段名无关）

对每个 SRv6 覆盖 key（平台意图里除元数据、`acl`/`nat`/`ipsec` 外的顶层 key）做树形 diff（左 = VR2，右 = 意图）：

| diff | 含义 | 弹窗？ |
|------|------|--------|
| 只有 `added` | 意图在 VR2 上**多出来**的项（本条或后续隧道注入） | 否 |
| 有 `removed` | VR2 有、意图没有 → 全量 POST 会丢掉 | 是，列出 |
| 有 `changed` | 同路径值不同（ASN、via 等） | 是，列出 |

因此：

- 第一条隧道：VR2 ≈ 基线，意图 = 基线 + 本条贡献 → 几乎全是 `added` → **不弹**  
- 再加一条隧道：VR2 已含第一条，意图再多第二条贡献 → 仍主要是 `added` → **不弹**  
- 新贡献字段（新邻居、新路由、新 AF）同样走 `added`，**不用改漂移代码**  

### 7.3 指纹表（只有配对身份时才可能要加）

`added`/`removed` 判定是通用的。数组若是「对象列表」，会尽量用身份配对，避免按下标把「多一项」看成「改了第 2 项」：

| 对象特征 | 指纹 |
|----------|------|
| `remote_ip` | BGP 邻居 |
| `destination` + `via` + `vrf` | 静态路由 |
| `name` | 接口 |
| `address_family` 为字符串 | AF 条目（避免和 BGP 块上的 `address_family` 数组混淆） |
| `asn` + `vrf` + `router_id` | BGP 实例块 |
| `ID` / `acl_id` / `group_id` | IPsec / ACL / NAT 组 |

新类型如果是「数组里追加一个带稳定身份的对象」，给 `itemFingerprint` 加一条即可。没有指纹时退回按下标比：平台数组更长仍偏 `added`；同下标换成完全不同的对象会变成 `changed`，可能误报。**扩展贡献优先带稳定身份字段。**

---

## 8. 黄标：多数对账可修，例外要认

### 8.1 可自动修（「扫描并修复」）

| 码 | 含义 | 修复动作 |
|----|------|----------|
| `INVARIANT_DRIFT` | 有存活隧道，账本 ≠ 公式 | `persistSrv6VrEffectiveConfig`：账本写成公式 |
| `ORPHAN_BASELINE_DRIFT` | 无存活隧道，账本 ≠ 基线 | 把**账本**写回向导基线（**不改** `srv6BaselineJson`） |

修完列表应变健康。只改 SQLite，设备 / VR2 不变。

### 8.2 不能点修复了事

| 码 | 原因 | 怎么处理 |
|----|------|----------|
| `NO_BASELINE` | 有隧道但从未打下基线（多为历史档） | 人工：删档或从向导重建 |
| `BASELINE_PARSE_ERROR` / `CONFIG_PARSE_ERROR` | JSON 坏了 | 查库、不要盲修 |

### 8.3 修完又黄：控制面已偏离公式

VR-Cache 仍可能用 VR2 覆盖账本。

- VR2 与公式**业务字段已齐**（只是 `_id`/顺序）→ 语义比较后**不应再黄**  
- VR2 **业务字段**已和公式不同（专家模式改过 BGP 等）→ 修账本只是暂时写成公式，回写又把 VR2 带回来 → 黄标表示**控制面偏离公式**。要对齐只能 **再下发意图**，不能只对账  

这不是对账失败，是「账本镜子」和「公式」抢同一张 `config_json`。产品上不要把黄标理解成「修一下设备就通」。

---

## 9. 源码索引

| 职责 | 路径 |
|------|------|
| 语义相等 / 树形 diff / 指纹 | `backend/src/utils/configSemanticEqual.ts` |
| 下发漂移、SRv6 仅破坏性才阻塞 | `backend/src/services/vrouter/vrConfigDeploy.ts` · `detectDeployDrift` |
| 分域 merge（SRv6 覆盖除 acl/nat/ipsec 外的意图 key） | 同上 · `mergeDeviceWithPlatformSlice` |
| 对账、修复 | `backend/src/routes/sdn/srv6.reconcile.ts` |
| 公式写入账本 | `backend/src/routes/sdn/srv6.sync.ts` · `persistSrv6VrEffectiveConfig` |
| merge 引擎 | `backend/src/routes/sdn/srv6.merge.ts` |
| 列表黄标 | `backend/src/routes/sdn/srv6.listHealth.ts`；前端 `pages/sdncc/ibr/srv6/index.tsx` |
| VR2 → 账本定时回写 | `backend/src/services/vrouter/vr2PlatformSync.ts`（由 `VRCacheService` 调用） |
| 弹窗文案 | `frontend/src/utils/vrConfigDeployDrift.ts` |

---

## 10. 后续可扩展（未做）

1. **账本与 VR2 镜子拆开**：有 SRv6 基线时，VR-Cache 不要用 VR2 整份覆盖 `config_json`，对账不再和回写打架。Cache 页需标明「公式账本」还是「VR2 副本」。  
2. **真偏离时的修复**：黄标在「VR2 业务 ≠ 公式」时提供「按下发意图推到设备」，而不是只写库。  
3. **新贡献类型**：先扩 `injectedDelta` + merge；对象数组补指纹。不必为每种新字段单独写「免弹窗」逻辑。  
4. **对账 diff 全量导出**：弹窗目前截前 4 条，排障可加完整列表。

---

## 11. 运维怎么判断「正常」

1. 建第一条（或又一条）隧道，只是按公式**多**邻居/路由/AF → **不应弹覆盖**。  
2. 下发成功后 VR2 回写只刷新包装字段 → 列表 **健康**。  
3. 仍黄 → 点黄标打开对账看路径：能修就「扫描并修复」；修完仍黄 → 查 VR2 是否被人改过，需要对齐则再下发。  
4. 弹窗出现且列出「设备多出 / 将修改」→ 覆盖会丢掉或改掉 VR2 里有、公式里没有的项；确认后仍以**新意图**为准。
