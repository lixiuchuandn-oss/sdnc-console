# CSM Controller（CSMCTL）

VR 虚拟路由控制面：Tower / SDNC 后端通过 **`CSMCTL_ADDRESS`** 调用本服务北向 API，VR Agent 通过南向 API 注册与上报。

## 在仓库中的位置

```
Compute.Tower/
├── backend/          # Node BFF：vrController.ts、/api-proxy → CSMCTL
├── frontend/         # IBR / SRv6 等 UI
└── csm-controller/   # 本服务（Java Spring Boot，独立进程）
```

## 依赖

- JDK 8+
- Maven 3.6+
- MongoDB（默认 `127.0.0.1:27017`，库 `admin`；见 `application.properties` / `application-dev.properties`）

## 本地启动

### 方式 A：Docker Compose 全栈（推荐）

在仓库根目录：

```bash
docker compose up -d --build
```

浏览器访问 `http://<主机>:5001`。CSMCTL 在 Compose 内网为 `https://sdnc-csmctl:8016`（`sdnc-console` 服务已配置 `CSMCTL_ADDRESS`）。

仅本机源码开发时，可只起依赖：

```bash
docker compose up -d mongodb sdnc-csmctl
```

随后在宿主机 `npm run dev` / `npm run start`；`CSMCTL_ADDRESS` 默认 `https://127.0.0.1:8016`。

### 方式 B：本机 Maven

```bash
cd csm-controller
mvn spring-boot:run -Dspring-boot.run.profiles=dev
```

默认 **HTTPS** 端口 **8016**（自签名证书 `classpath:keystore.p12`）。

## 与 Tower / SDNC 联调

1. 启动 MongoDB 与 CSM Controller（上节）。
2. 启动 `backend`（`PRODUCT_FLAVOR=sdnc` 即可）。
3. **系统设置 → 高级集成**：`CSMCTL_ADDRESS` = `https://127.0.0.1:8016`（或实际部署地址，勿带尾部 `/`）。
4. 前端 **IBR → IBR实例**：执行同步，确认能拉到 IBR 列表。

签名密钥须与 Tower 一致（默认 `Cloudmap#123` / `ACCESS_KEY` + `SECRET_KEY`）。

## API 分区

| 方向 | 前缀 | 调用方 | 说明 |
|------|------|--------|------|
| 北向 | `/V2/ctcontrol` | Tower `backend/src/services/vrouter/vrController.ts` | VR1 列表、VR2 配置读写、VR3 状态、ping |
| 南向 | `/V2/vrcontrol` | VR Agent | 注册/注销、配置下载、状态上报 |
| 签名 | `POST /api/sign` | Tower `/api-proxy`、VR2 写配置 | HMAC 鉴权 |

详细契约见 `doc/北向/`、`doc/南向/` 接口文档（Word）。

## Tower 后端映射（摘要）

| CSMCTL | Tower |
|--------|-------|
| `GET /V2/ctcontrol/VR1/pagelist` | `vrController.getVRList`、VR 缓存同步 |
| `GET/POST /V2/ctcontrol/VR2/VRConfig` | `vrController.getVRConfig` / `updateVRConfig` |
| `GET /V2/ctcontrol/VR3/VRConfig/list` | 合并列表、实时状态 |
| `POST /api/sign` | `apiProxy.ts` 代签 |

SRv6 / IPsec / ACL / NAT 写成功后最终经 `updateVRConfig` 下发 VR2。

## 配置说明

| 文件 | 用途 |
|------|------|
| `application.properties` | 生产默认（Linux 路径、SSL） |
| `application-dev.properties` | 本地开发：日志目录、`appDir`、Mongo |

生产部署请单独维护 `application.properties` 或外置配置，勿将生产密钥提交仓库。

## VR Agent（可选）

VR 设备侧 Agent 脚本见仓库 `新建文件夹/agent/`（未纳入本模块构建；与南向 `/V2/vrcontrol` 配合）。
