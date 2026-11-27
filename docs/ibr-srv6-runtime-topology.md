# SRv6 隧道运行态展示（流量统计 + 拓扑叠加）设计

> 状态：**方案已定，待开发**（2026-11-27 评审结论）。
> 底层分析参考：开发机 VR 仓 `doc/SRv6_Localsid_Counter_Analysis.md`。
> 相关：`docs/srv6-config-ledger-and-drift.md`（配置面，本方案**不涉及**）、`backend/src/routes/sdn/srv6.health.ts`、`frontend/src/pages/sdncc/ibr/srv6/lib/topology/buildTopology.ts`。

## 1. 背景与目标

客户要求在 SDNC 界面上按隧道体现流量，同时隧道拓扑需要展示运行态。原则：

- **只展示设备运行态**，不展示平台配置面（对账 / 漂移 / injectedDelta）。
- **不冗余**：已在其他入口体现的信息（健康巡检的连通性）不在拓扑重复。
- **不遗漏关键信息**：BGP（公网 / 私网）、dataplane 生效状态、双向流量。

## 2. 底层统计结论

### 2.1 可用计数

测试环境实测：

| 对象 | 是否有计数 | 说明 |
|---|---|---|
| `show sr localsids` | **有** | Good / Bad 各含 packets、bytes |
| `show sr policies` | **无** | 仅 BSID、Behavior、Segment Lists |

示例：

```
Address:      2200::1:0:0:100/128
Behavior:     DT4 (...)
Table:        10001
Good traffic: [334051 packets : 28060284 bytes]
Bad traffic:  [0 packets : 0 bytes]

[0].- BSID: fcfb:3baf:3a9c:2200::1
  Segment Lists:
    [0].- < 2100::1:0:0:100 > weight: 1
```

### 2.2 计数语义与局限

- localsid 计数是**入向解封装计数**：Good 记在 VRF 查表**之前**，CE 不通时仍会累加。
- **Good ≠ 端到端连通**，连通性以健康巡检为准；界面须标注此口径。
- 计数随 localsid 创建清零；删除不清零；`clear sr localsid-counters` 全量清零，不支持单条清零。
- 粒度：每 VRF 一个 localsid。

### 2.3 现有 agent 采集问题（记录，后续修）

| 问题 | 位置 | 影响 |
|---|---|---|
| 未采 localsid 计数 | `netjson-monitoring` `collect_srv6_data` | 平台无隧道流量数据 |
| 多 localsid 只取最后一条（`tail -n 1`） | 同上 | Hub 多 VRF 漏采 |
| 接口“速率” = 累计值 / INTERVAL | `add_interfaces_config` | 数值错误，应为 Δcounter / Δt |
| policy 解析固定 7 行（`head -n 7`） | `collect_srv6_data` | 长 seglist 错位 |

本期**不依赖** agent 周期上报，采用按需拉取（§5）。

## 3. 流量方向口径

每侧 PE 的 localsid 只代表**一个方向**，因此**两侧都展示，按方向各取一份**：

| 方向 | 取数 |
|---|---|
| A → B | PE-B 的 localsid Good / Bad |
| B → A | PE-A 的 localsid Good / Bad |

**方向关联规则**：本端 policy 的 segment 地址 = 对端 localsid Address（去掉前缀长度后比较，小写归一）。平台档案中的两端 SID 仅作交叉校验，不作为主依据。

### 3.1 Hub 复用 VRF（`REUSE_VRF`）

| 方向 | 取数 | 精度 |
|---|---|---|
| Hub → Spoke-n | Spoke-n 的 localsid | 精确 |
| Spoke-n → Hub | Hub 的 localsid | **仅汇总，无法拆到单个 Spoke** |

展示：Hub 节点 / ×N 折叠处显示“入向合计”；单条 Spoke 边该方向显示“—（Hub 汇总）”。
`DEDICATED_VRF` 每隧道独立 localsid，无此问题。

### 3.2 速率计算

- `rate = Δcounter / Δt`（pps、bps = Δbytes × 8 / Δt）。
- Δ < 0（localsid 重建或被 clear）：本次不出数，显示“采样中”，等下一次。
- 首次无上次样本：显示累计值 + “采样中”，**不得把累计值当速率**。
- 采样时间戳以设备侧返回为准。

## 4. 拓扑展示口径（最终）

### 4.1 节点（PE / Hub / Spoke / CE）

| 项 | 来源 |
|---|---|
| 设备在线 | VR 在线状态（平台 / CSMCTL） |
| vbras 服务状态 | local-web `agentStatus` |
| VRRP 主备角色 | local-web `forwarding/vrrp`（仅 HA 组成员显示） |

### 4.2 隧道边（PE ↔ PE）

| 项 | 表现 | 来源 |
|---|---|---|
| 公网 BGP 状态 | 边颜色：Established 正常，否则异常 | `forwarding/bgp-summary`（VRF 0） |
| 双向流量 | 双向箭头，各方向 pps / bps | 对端 PE localsid Good |
| dataplane 状态 | 并入流量：该方向 localsid 不存在 → “未生效”（非 0） | localsid 计数接口 |
| 异常标记 | Bad Δ > 0 时标红 | localsid Bad |

### 4.3 接入边（PE ↔ CE）

| 项 | 来源 |
|---|---|
| 私网 BGP（VRF 内）状态 | `forwarding/bgp-summary`（对应 VRF） |

### 4.4 明确不展示

| 项 | 原因 |
|---|---|
| ceReach 连通性 | 已在健康巡检体现 |
| reconcile / configHealth / 漂移 | 配置面，非运行态 |
| 资源指标（CPU / 内存） | 信息冗余 |

## 5. 数据链路

```
设备 vctl show sr localsids / policies
        │  （按需，刷新触发）
        ▼
ibr-local-web  GET /api/north/v1/forwarding/srv6/counters
        ▼
SDNC 后端  ibrLocalWebClient.getForwardingSrv6Counters()
        │  方向匹配 + 速率计算 + 与 BGP/VRRP/在线聚合
        ▼
GET /api/networks/srv6/topology/runtime
        ▼
前端 buildTopology 节点/边挂运行态字段（不改布局）
```

### 5.1 ibr-local-web：localsid 计数接口

`GET /api/north/v1/forwarding/srv6/counters`（同时挂 `/api/forwarding/srv6/counters` 供本机 Console）

```ts
type Srv6CountersResult = {
  sampledAt: string;          // ISO，设备本地采样时间
  sampledAtMs: number;
  localsids: Array<{
    address: string;          // 2200::1:0:0:100（无前缀长度）
    prefixLen: number;        // 128
    behavior: string;         // DT4 / DT6 / End ...
    table: string | null;     // 10001
    good: { packets: number; bytes: number };
    bad: { packets: number; bytes: number };
  }>;
  policies: Array<{
    bsid: string;
    behavior: string;         // Encapsulation
    fibTable: string | null;
    segmentLists: Array<{ segments: string[]; weight: number }>;
  }>;
  raw?: { localsids: string; policies: string };   // 调试用
  error?: string;
};
```

实现要点：
- 实现在 `server/src/services/forwarding/forwardingExtended.ts`，与 `getSrv6Status` 并列；mock 模式返回固定样例。
- 解析按块分割（`Address:` / `[n].- BSID:` 起始），**不按固定行数**；全部 localsid 返回，不 `tail -n 1`。
- 数值用 `Number`，大计数超出 2^53 时以字符串兜底（字段约定 `number`，超限另议）。
- 本副本修改后按规则同步推回原仓 `Paas-VRv2`（分支 `Paas-VRv2_yundi_1031`）。

### 5.2 SDNC 后端

- `ibrLocalWebClient.getForwardingSrv6Counters(managementIp)`。
- 速率：后端内存保留每 VR 上次样本（key = vrUuid + localsid address），用设备 `sampledAtMs` 计算；可选单次请求内双采样（间隔 ~3s）以便首屏即出速率，由参数 `sample=2` 控制。
- 新接口 `GET /api/networks/srv6/topology/runtime?tunnelIds=...|hubUuid=...`，读路径**必须实时访问设备**（符合“刷新必须对端真实拉取”规范），前端调用 `skipCache: true`。
- 设备不可达：对应节点/边字段返回 `unknown` + `error`，不影响其他端点。
- 并发：按 VR 去重，并发上限沿用 4。

响应结构：

```ts
type Srv6TopologyRuntime = {
  checkedAt: string;
  nodes: Record<string /* vrUuid */, {
    online: 'online' | 'offline' | 'unknown';
    vbras: 'running' | 'stopped' | 'unknown';
    vrrpRole?: 'master' | 'backup' | null;
    error?: string;
  }>;
  tunnels: Record<string /* tunnelId */, {
    publicBgp: 'up' | 'down' | 'unknown';
    directions: {
      aToB: Srv6DirectionTraffic;   // hub 模式下 hubToSpoke
      bToA: Srv6DirectionTraffic;   // hub 模式下 spokeToHub
    };
  }>;
  attaches: Record<string /* `${peUuid}|${ceUuid}` */, {
    privateBgp: 'up' | 'down' | 'unknown';
    vrf?: string;
    prefixReceived?: number;
  }>;
  hubAggregates?: Record<string /* hubUuid */, Srv6DirectionTraffic>;  // REUSE_VRF 入向合计
};

type Srv6DirectionTraffic = {
  state: 'active' | 'not_effective' | 'hub_aggregate' | 'sampling' | 'unknown';
  localsid?: string;      // 计数来源（对端 localsid）
  pps?: number;
  bps?: number;
  goodTotal?: { packets: number; bytes: number };
  badDelta?: number;      // >0 → 异常标记
  error?: string;
};
```

### 5.3 前端

- `buildTopology` 产出的 `TopoNode` / `TopoTunnel` / `TopoAttach` 按 id 关联 runtime，不改布局算法。
- 隧道边：BGP 决定颜色；双向标签 `→ 1.2 Mbps / 300 pps`、`← …`；`not_effective` 显示“未生效”；`badDelta>0` 红色标记；`hub_aggregate` 显示“—（Hub 汇总）”。
- ×N 折叠：显示组内流量合计。
- 详情 tooltip 注明：“流量为对端 SRv6 解封装计数，不代表 CE 间连通”。
- 刷新按钮触发 runtime 实时拉取；可选自动刷新（默认关闭，开启间隔 ≥ 10s）。

## 6. 开发计划

| 阶段 | 内容 | 涉及仓 |
|---|---|---|
| R1 | local-web localsid/policy 计数接口 + 解析单测（用 §2.1 实测输出作 fixture） | `ibr-local-web` + 原仓 `Paas-VRv2` |
| R2 | SDNC 后端 client、速率计算、runtime 聚合接口 + 单测（方向匹配、Δ<0、REUSE_VRF） | `backend` |
| R3 | 前端拓扑叠加（节点三项、隧道边、接入边）+ 隧道详情流量区块 | `frontend` |
| R4（后续） | 修 agent 采集问题（§2.3），评估周期上报与趋势曲线 | `ibr-local-agent` + 原仓 |

## 7. 待确认 / 风险

- VR 在线状态的权威来源（CSMCTL 心跳 vs local-web 可达）实现时确认。
- 私网 BGP 与接入边的匹配：按 VRF + CE 侧邻居地址，实现时以档案字段确定。
- 多 segment（非单跳）policy 场景：方向匹配取 segment 列表**最后一跳**。
