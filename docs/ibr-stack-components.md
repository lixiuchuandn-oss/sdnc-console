# IBR 全栈组件对照（SDNC · CSMCTL · 设备侧）

> **适用范围**：本仓库 `Compute.Tower` 与**内嵌目录** `ibr-local-web/`、`ibr-controller/`、`ibr-local-agent/` 的职责划分与联调心智（**非 Git 子模块**，`git clone` 即含源码）。  
> **关联**：[sdnc-stack-integration.md](./sdnc-stack-integration.md)（云侧数据边界）、[ibr-vr-config-deploy.md](./ibr-vr-config-deploy.md)（SDNC 分域下发）、`ibr-local-web/docs/reference/architecture.md`（设备侧上下游长文）。

---

## 1. 一句话

| 组件 | 角色 |
|------|------|
| **`frontend/` + `backend/`**（本仓） | **SDNC 云控制台** — 浏览器里管多台 IBR |
| **`ibr-controller`**（≈ `csm-controller/`） | **CSMCTL 云控制面** — 存 Mongo、北向 API、南向对接 agent |
| **`ibr-local-agent`**（≈ `csm-agent/`） | **设备 agent** — 注册、拉 JSON、`transfer.lua` → clish |
| **`ibr-local-web`** | **设备本地 Console** — 单台 IBR 本机运维 UI/API |

到设备生效的 **SDN 整包 JSON**，路径始终是：**SDNC → CSMCTL → agent → ipoe（FRR/vbras）**。  
`ibr-local-web` **不替代** 该路径，与 agent **并行**（双配置体系）。

---

## 2. 总体架构

```text
                    ┌─────────────────────────────────────┐
                    │  云侧 / 机房（Server 端）              │
                    ├─────────────────────────────────────┤
                    │  Compute.Tower（本仓主工程）           │
                    │    frontend/ + backend/   SDNC 控制台  │
                    │         │ 北向 HTTPS :8016            │
                    │         ▼                             │
                    │  ibr-controller  (= csm-controller/)  │
                    │    CSMCTL · MongoDB                   │
                    └──────────────┬────────────────────────┘
                                   │ 南向注册 / 拉配置 / VR2
                    ┌──────────────▼────────────────────────┐
                    │  IBR 一体机（设备上，同机部署）           │
                    ├─────────────────────────────────────┤
                    │  ibr-local-agent  (= csm-agent/)      │
                    │    /rhos/etc/agent · vrctl.agent      │
                    │    download → transfer.lua → clish    │
                    ├─────────────────────────────────────┤
                    │  ibr-local-web  (Paas Console)        │
                    │    web/ + server/ → /opt/paas-vr-v2/ │
                    │    本地运维：网卡 IP、转发、部分 IPsec   │
                    ├─────────────────────────────────────┤
                    │  ipoe（独立产品，不在此三目录内）         │
                    │    FRR + strongSwan + vbras (VPP)     │
                    └─────────────────────────────────────┘
```

**硬约束**（设备侧）：Console、agent、ipoe **同机部署于 IBR**；分离会导致 `cli.sock`、`/usr/local/src/vrconf/` 等不可用。详见 `ibr-local-web/docs/reference/architecture.md`。

---

## 3. 目录与主仓对照

| 目录（本工作区） | 产品名 | 主仓等价路径 | 部署位置 |
|------------------|--------|--------------|----------|
| **`ibr-local-web/`** | Paas Console（`paas-vr-console`） | **无**（主仓为 `frontend/` + `backend/`） | IBR `/opt/paas-vr-v2/` |
| **`ibr-controller/`** | CSMCTL | `csm-controller/` | 云侧 `:8016` HTTPS |
| **`ibr-local-agent/`** | vrctl-agent | `csm-agent/` | IBR `/rhos/etc/agent/` |

### 3.1 SDNC 控制台（本仓主工程）

| 路径 | 说明 |
|------|------|
| `frontend/` | React 管理端：IBR实例、ACL/NAT、IPsec/SRv6 向导、系统设置 |
| `backend/` | Node BFF：`/api/*`、`vr_config`、`pushVRConfig` 网关、`/api-proxy` → CSMCTL |

默认联调：`CSMCTL_ADDRESS=https://127.0.0.1:8016`（见 `docker-compose.yml`）。

### 3.2 CSMCTL（`ibr-controller` / `csm-controller`）

| 方向 | 前缀 | 调用方 |
|------|------|--------|
| 北向 | `/V2/ctcontrol` | SDNC `backend/src/services/vrouter/vrController.ts` |
| 南向 | `/V2/vrcontrol` | 设备 `vrctl.agent` 注册、拉配置、上报 |
| 签名 | `POST /api/sign` | SDNC `/api-proxy`、VR2 写配置 |

构建与运行见 [`csm-controller/README.md`](../csm-controller/README.md)。

### 3.3 设备 agent（`ibr-local-agent` / `csm-agent`）

- 向 CSMCTL **注册**、**轮询下载** NetJSON/VR2 包至 `/rhos/etc/agent/download/`。
- `transfer.lua` 按模块（`bgp.lua`、`ipsec.lua`、`acl.lua` 等）diff 后执行 **clish** → FRR / strongSwan / vbras。
- CSMCTL 另可通过 HTTP **8015** 调 agent 执行远程命令（`ExecuteUtil`，如 ping 探测）；与 CSMCTL **8016** 不是同一进程。

本目录为设备路径 `/rhos/etc/agent/` 的**参考副本**；真机由运维/`deploy:remote` 外流程维护（见 `ibr-local-agent/README.md`）。

### 3.4 设备本地 Console（`ibr-local-web`）

| 子目录 | 说明 |
|--------|------|
| `web/` | Vite + React 本地管理 UI |
| `server/` | Express API：读写 `vrconf`、部分转发/IPsec（clish）、Agent 状态页 |

`npm run deploy:remote` **只发布** `web/` + `server/`，不包含 controller/agent/ipoe。

---

## 4. 双配置体系（设备上最易混淆）

IBR 上 **两条并行配置链**，不是二选一：

| 维度 | **链路 A：本地 Console** | **链路 B：云下发 agent** |
|------|--------------------------|---------------------------|
| 代码 | `ibr-local-web` | `ibr-local-agent` |
| 配置目录 | `/usr/local/src/vrconf/` | `/rhos/etc/agent/download/` |
| 典型场景 | Tower 地址、网卡 IP、管理面 | BGP、SRv6、整包 IPsec/ACL/NAT（SDN JSON） |
| 触发方 | 人在设备上打开 Paas Console | SDNC 保存 + `deploy/push` → CSMCTL → agent |
| 与 SDNC 关系 | 写本地文件，**不经** `pushVRConfig` | **即**云侧统一下发在设备侧的落地 |

SDNC 已统一的 **ACL / NAT / IPsec / SRv6 分域下发**（见 [ibr-vr-config-deploy.md](./ibr-vr-config-deploy.md)）走 **链路 B**。  
**专家模式、VR 角色向导**（PE/CE/Standard/SASE）为初始化通道，云侧直写 VR2，设备侧仍由 **agent** 应用；**刻意不**并入 `vrConfigDeployFlow`。

仅改 Console 链路 A（如 LAN IP）**不会**自动补全 BGP/VRF；SRv6 等须走链路 B 整段 SDN 下发。

---

## 5. 端口与进程

| 服务 | 端口 | 说明 |
|------|------|------|
| SDNC 控制台 API | 5001（生产容器）/ 5001（dev 后端） | 浏览器经前端或同源访问 |
| SDNC 前端 dev | 5000 | 代理 `/api` → backend |
| CSMCTL | **8016** HTTPS | `CSMCTL_ADDRESS` |
| 设备 csm-agent | **8015** HTTP | CSMCTL `ExecuteUtil` 远程命令 |
| Paas Console | 设备本地（`paas-vr-v2.service`） | 仅管理网/本机 |

---

## 6. 联调组合

### 6.1 只测 SDNC 页面与平台库（无真设备）

```bash
cd backend && npm run dev
cd frontend && npm run start
```

可不启 CSMCTL；IBR 列表/sync、下发会受限，`GET /health` 反映 `dependencies.csmctl`。

### 6.2 云侧 + CSMCTL（推荐）

```bash
# 仓库根目录
docker compose up -d mongodb sdnc-csmctl

cd backend && npm run dev
cd frontend && npm run start
```

或使用目录 `ibr-controller/` 本机 `mvn spring-boot:run -Dspring-boot.run.profiles=dev`（需 MongoDB）。

### 6.3 端到端下发（需设备 agent）

1. 云侧：SDNC + CSMCTL + MongoDB（上节）。
2. 设备：`vrctl-agent.service` 在线，`vrcontrol.conf` 指向 Tower/CSMCTL 地址。
3. SDNC：**IBR实例** 同步列表 → ACL/NAT 等 **保存** → **下发配置**（`deploy/push`）。
4. 设备侧验收：`/rhos/etc/agent/download/{uuid}.bak`、`clish` running-config、业务 ping。

可选：设备上同时起 `paas-vr-v2.service`（`ibr-local-web`）做本机网卡/排障，与云下发无关。

---

## 7. 与「整份 JSON POST」的关系

CSMCTL 的 VR 配置更新为 **全量 JSON POST**（非 PATCH）。  
SDNC `pushVRConfig` 在 POST 前 **读设备现网 → 分域 merge → 漂移检测**，避免用不完整快照覆盖设备。

设备侧 **agent** 收到云侧意图后，经 `transfer.lua` 增量/全量应用至 **clish/FRR**，与「POST 一次 JSON」是 **云—设备契约** 与 **设备内部落地** 两层，不要混为一谈。

---

## 8. 延伸阅读

| 文档 | 内容 |
|------|------|
| [sdnc-stack-integration.md](./sdnc-stack-integration.md) | SDNC + CSMCTL + Mongo 数据权威 |
| [ibr-vr-config-deploy.md](./ibr-vr-config-deploy.md) | 分域下发、NAT/ACL、初始化通道边界 |
| `ibr-local-web/docs/reference/architecture.md` | IBR 内部分层、ipoe、双配置图、Lua 模块 |
| `ibr-local-web/docs/knowledge-base.md` | Paas Console 部署、`products/` 四份源码 |
| [`csm-controller/README.md`](../csm-controller/README.md) | CSMCTL 构建与北向 API |

---

## 9. 修订记录

| 日期 | 说明 |
|------|------|
| 2026-07-09 | 初版：`ibr-local-web` / `ibr-controller` / `ibr-local-agent` 与 SDNC 主仓对照 |
