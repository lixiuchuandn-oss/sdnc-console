# SDNC 全栈整合方案（Tower + CSMCTL）

> **状态**：设计稿（2026-07）  
> **适用范围**：本仓库默认产品 **SDNC**（`PRODUCT_FLAVOR=sdnc`）及同仓 **`csm-controller/`**（CSMCTL）。  
> **目标**：对外交付 **一个安装单元、一套运维心智**；对内保持 **Node 编排面 + Java 设备控制面** 分进程，避免强行单运行时。

---

## 1. 要解决什么问题

| 现状痛点 | 说明 |
|----------|------|
| 三份 VR 相关数据 | CSMCTL Mongo、`VRCache*` SQLite 副本、`vr_config` SQLite 平台态 |
| 读路径绕 HTTP | `VRCacheService` 定时拉 VR1/VR3，延迟与失败诊断复杂 |
| 集成靠手工配置 | `CSMCTL_ADDRESS`、Mongo、HTTPS 证书需单独起服务 |
| 仓库已同仓 | 源码在握，但**交付与数据边界**未产品化 |

**不追求**：把 Spring Boot 塞进 Express、或 Node 直连 Mongo 旁路写库。

---

## 2. 设计原则

1. **一个产品，多个进程**：SDNC Stack = `frontend` + `backend` + `csm-controller` + MongoDB。
2. **写必走 CSMCTL 北向 API**：校验（`Srv6ConfigJsonValidator` 等）、签名、与南向 Agent 契约仍在 Java 侧。
3. **读分层、权威清晰**：平台展示以 Tower SQLite 为主；设备实时态按需调 CSMCTL，不新增「第三读源」。
4. **默认同机联调**：开发/单机部署默认 `CSMCTL_ADDRESS=https://127.0.0.1:8016`，无需先配集成项。
5. **渐进替换**：每阶段可独立上线；旧 HTTP 同步路径保留开关直至验收完成。

---

## 3. 目标架构

```text
┌─────────────────────────────────────────────────────────────────┐
│ SDNC Stack（单安装包 / 单 compose）                                │
├─────────────────────────────────────────────────────────────────┤
│  Browser → frontend (React)                                      │
│              ↓ REST                                                │
│  backend (Node/Express) ─────────────────────────────────────┐  │
│    · 网际路由域 / CEN / SRv6 / ACL / NAT / 用户 RBAC            │  │
│    · vr_config（平台编排权威）                                   │  │
│    · vr 列表展示（读缓存层，见 §4）                              │  │
│              │ 写：POST VR2 / 部署推送                           │  │
│              │ 读：列表/实时（逐步收敛）                         │  │
│              ▼                                                   │  │
│  csm-controller (Java, :8016 HTTPS)                              │  │
│    · 北向 /V2/ctcontrol  · 南向 /V2/vrcontrol  · POST /api/sign│  │
│              │                                                   │  │
│              ▼                                                   │  │
│  MongoDB（vr_controller_device / srv6 / srv6_config）            │  │
└─────────────────────────────────────────────────────────────────┘  │
                                                                       │
 VR Agent ◄──────── 南向注册 / 拉配置 / 上报状态 ─────────────────────┘
```

---

## 4. 数据权威（整合后）

| 数据 | 权威存储 | Tower 角色 | 变更路径 |
|------|----------|------------|----------|
| 租户/组织/IRD/CEN/SRv6 隧道等业务 | Tower SQLite | 读写 | Tower API |
| VR 平台绑定（tenant、role、baseline、vmId 等） | `vr_config` | 读写 | Tower `/api/vr-config` |
| VR 设备全量配置 JSON（VR2） | **CSMCTL Mongo** | 写：代理；读：展示可缓存 | **仅** `vrController.updateVRConfig` / `getVRConfig` |
| VR 注册信息（VR1） | CSMCTL Mongo | 展示用副本 | Agent→CSM；Tower 同步或事件刷新 |
| VR 运行态/接口（VR3） | CSMCTL Mongo | 展示用副本 + 实时接口 | 同步或按需 `getVRConfig` / VR3 list |

**整合后读模型（目标）**：

- **列表页 / 合并行**：以 Tower 本地 **`VRCache*`** 或下一阶段 **「写后刷新 + 短 TTL」** 为主；用户点「刷新」= 触发同步或强制读 CSM。
- **编辑/下发**：读 `vr_config` + 可选实时 `getVRConfig` 合并；**写**始终 `updateVRConfig`（SRv6/IPsec/NAT/ACL 已如此）。
- **不采用**：Tower 直连 Mongo 做展示（避免只读旁路与 CSM 写路径竞态、schema 耦合）；若未来只读 Mongo，须先 **废弃 VRCache 表且 CSM 只读角色**，单独立项。

---

## 5. 进程边界（为何保留 CSMCTL）

CSMCTL 除 CRUD 外还承担：

- VR2 JSON **业务校验**（VRF/接口/BGP/SRv6 segment 等）
- **Agent 通道**（`ExecuteUtil` ping、配置 tar 下载目录）
- **南向注册**（`/V2/vrcontrol/VR1/register`）
- **HTTPS + HMAC 签名**（`/api/sign`）

这些不宜在首轮用 TypeORM 直连 Mongo 替代。整合 = **收窄职责 + 统一交付**，不是语言合并。

---

## 6. 分阶段路线图

### P0 · 交付一体（优先落地）

**目标**：装一次，本地能跑通 IBR。

| 项 | 状态 |
|----|------|
| 同仓 `csm-controller/` | ✅ |
| 默认 `CSMCTL_ADDRESS=https://127.0.0.1:8016`（SDNC） | ✅ `csmctlEndpoint.ts` + 系统设置默认 |
| `docker-compose.yml`（Mongo + CSMCTL） | ✅ |
| `GET /health` 附带 `dependencies.csmctl` | ✅ SDNC 模式 |
| 文档 | ✅ 本文 + `csm-controller/README.md` |

---

### P1 · 配置与运维产品化

| 项 | 动作 |
|----|------|
| 系统设置 | SDNC 构建隐藏无关集成项；`CSMCTL_ADDRESS` 带默认值与校验提示 |
| 离线包 | `release/` 结构扩展：`server/`（Node）+ `csmctl/`（fat jar）+ `compose` 或安装脚本 |
| 版本对齐 | `manifest.json` 增加 `csmctlVersion`；与 `backend/package.json` 同级标注 |
| 日志 | 约定三进程日志目录（Tower / CSMCTL `logs/`） |

---

### P2 · 读路径收敛（降延迟、减混乱）

**目标**：列表不再强依赖 5 分钟轮询才「像新的」。

| 项 | 动作 |
|----|------|
| 刷新语义 | 用户刷新 / 写成功后：`VRCacheService.syncAll()` 或增量同步（已有 refresh API，统一全站调用） |
| 轮询 | SDNC 默认拉长后台间隔或 `TOWER_SKIP_BACKGROUND_SYNC` 下仅手动刷新（可配置） |
| 实时单条 | 详情/向导继续 `getVRConfig`；列表不每条都打 CSM |
| 诊断 | `GET /api/vr-instances` 继续返回 `vrSyncDiagnostics`（已有） |

**仍不**：Node 读 Mongo。

---

### P3 · 平台态与设备态拆分（数据合一）

**目标**：`vr_config` 与 VR2 职责清晰，减少双写认知负担。

| 项 | 动作 |
|----|------|
| 约定 | `vr_config.config_json` = 平台编辑草稿或上次成功下发快照；CSM Mongo = 设备侧已接受配置 |
| 下发 | 单一路径：`merge(vr_config) → validate via CSM API → updateVRConfig` |
| 失败 | CSM 业务错误回写 UI；**不**静默只写 SQLite |
| 可选 | 成功后把 CSM 返回体回写 `vr_config`，列表读库即可一致 |

---

### P4 · CSMCTL 瘦身（可选，长期）

若 Agent 协议稳定且校验规则可共享（JSON Schema）：

- 抽出 **agent-gateway** 模块：仅南向 + 下发队列
- Tower 成为 VR2 配置的 **唯一编辑入口**（SQLite）
- Mongo 缩为注册表/任务队列，或逐步迁离

**触发条件**：P0～P3 稳定半年+、测试覆盖 VR 全链路。

---

## 7. 接口契约（整合后不变）

Tower → CSMCTL（`backend/src/services/vrouter/vrController.ts`）：

| 操作 | CSMCTL | Tower 封装 |
|------|--------|------------|
| VR 列表 | `GET /V2/ctcontrol/VR1/pagelist` | 同步入 `VRCacheBasic` |
| VR 配置读 | `GET /V2/ctcontrol/VR2/VRConfig` | `getVRConfig` |
| VR 配置写 | `POST /V2/ctcontrol/VR2/VRConfig` | `updateVRConfig` |
| 状态列表 | `GET /V2/ctcontrol/VR3/VRConfig/list` | 同步入 `VRCacheExtended` |
| 签名 | `POST /api/sign` | `/api-proxy` |

前端 **不** 直连 CSMCTL；保持 BFF。

---

## 8. 部署拓扑

### 生产（推荐，全容器）

```text
docker compose up -d --build
  mongodb
  sdnc-csmctl
  sdnc-console（:5001，API + 前端静态资源一体）
可选：Nginx/Caddy TLS 终止 → 反代 :5001
```

### 开发（源码 + 容器依赖）

```text
docker compose up -d mongodb sdnc-csmctl
backend :5001   宿主机 npm run dev
frontend :5000  宿主机 npm run start（代理 → :5001）
```

---

## 9. 风险与对策

| 风险 | 对策 |
|------|------|
| SQLite 与 Mongo VR2 不一致 | 写只走 CSM；P3 成功后回写 `vr_config` |
| CSMCTL 挂掉导致列表空 | 探活 + UI 提示；缓存只读展示上次同步 |
| HTTPS 自签 | Tower 已 `rejectUnauthorized: false`；生产用内网 CA |
| 离线包体积 | CSMCTL jar 单独目录，与 Node dist 并列 |
| 双产品味（Tower 全量 vs SDNC） | `PRODUCT_FLAVOR` 门控；CSMCTL 两形态共用 |

---

## 10. 明确不做（首期）

- Tower 直连 Mongo 读写
- 将 `VrServiceImpl` 重写为 TypeScript
- 去掉 CSMCTL 进程合并进 Node
- 为整合而删 `VRCache*`（须在 P2 有替代读策略后再动表）

---

## 11. 建议实施顺序（执行清单）

1. **P0**：`docker-compose`、默认 `CSMCTL_ADDRESS`、健康探针文档  
2. **P0**：`docs/README.md` / `AGENTS.md` 链到本文（已完成索引可补一条）  
3. **P1**：离线包 manifest 含 csmctl  
4. **P2**：统一写成功 / 工具栏刷新 → `runHarvesterSectionRefresh` 等价物改为 VR `syncAll`  
5. **P3**：梳理 `vr_config` 与 `updateVRConfig` 单一成功路径文档 + 代码收敛  

---

## 12. 相关文档

| 文档 | 内容 |
|------|------|
| [`csm-controller/README.md`](../csm-controller/README.md) | CSMCTL 构建与 API |
| [`docs/internetwork-routing-domain.md`](./internetwork-routing-domain.md) | IRD、VR uuid/vm_id、CSMCTL 可信度 |
| [`docs/sdnc-tower-integration-api.md`](./sdnc-tower-integration-api.md) | Tower 与 SDNC 分体联部署（可选） |
| [`backend/src/STRUCTURE.md`](../backend/src/STRUCTURE.md) | 后端挂载与 SDNC 门控 |

---

## 修订记录

| 日期 | 说明 |
|------|------|
| 2026-07-09 | 初版：全栈整合原则、数据权威、P0～P4 路线 |
