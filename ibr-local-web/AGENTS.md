# AGENTS.md

## Cursor Cloud specific instructions

`paas-vr-console` 是一个 npm workspaces monorepo（VR 实例管理控制台）：

- `server/` — Express + TypeScript API（`tsx watch` 开发热重载，端口 `3000`）。校验云平台下发的 SSO/JWT。
- `web/` — React + Vite + Ant Design 前端（端口 `5173`，`/api` 代理到 `127.0.0.1:3000`）。

### 运行 / 构建 / 测试

标准命令见根 `package.json`、`server/package.json`、`web/package.json`：

- 同时启动两个服务（开发）：`npm run dev`（根目录，concurrently 启动 server + web）。
- 单独运行：`npm run dev -w server` / `npm run dev -w web`。
- 构建（类型检查）：`npm run build`（先 `vite build`，再 `tsc -p server/tsconfig.json`）。这是唯一可用的类型检查/“lint”手段——仓库未配置 ESLint 或独立 lint 脚本，也没有自动化测试套件。

### 非显而易见的注意事项

- 本地开发必须有 `server/.env`（被 git 忽略，参考 `server/.env.example`）。最简单的本地可用方式：设置 `NODE_ENV=development` 且 `SSO_DEV_BYPASS=true`，这样会注入本地开发用户、跳过 JWT 校验，前端 `/api/me` 即可直接返回登录态。否则前端会停在“暂无法验证登录”。
- 此控制台实际管理远端 VR 设备，许多 API（路由表、ACL、NAT、IPsec、VBRAS 运维等）会在服务端执行设备二进制（如 `/rhos/bin/vtish`）或访问内网设备/云平台。在没有真实设备的开发环境中，这些页面会渲染成功但显示报错 toast（如 `Executable not found: /rhos/bin/vtish`）或空状态（“暂无数据”）——这是预期行为，不代表环境损坏。
- 不要在仓库中提交明文设备凭据；测试机凭据通过环境变量 / 团队密钥库下发（见 `scripts/test.md`）。

### 开发 / 测试 / 部署环境

统一使用阿里云 ECS **`120.26.76.215`**（VR 控制台与 vbras 同机部署）：

- 部署：`npm run deploy:remote`（配置 `scripts/deploy.config`，模板见 `deploy.config.example`）
- 验收：http://120.26.76.215:3000/
- 本地只改前端、联调远端：`npm run dev:remote:web`
- 环境清单与 SSH 说明：`scripts/test.md`
- **开发知识库**（架构、设备 agent 参考说明、vrconf、双配置体系）：`docs/knowledge-base.md`

说明：设备 agent 在本地 **`products/vrctl-agent/`**（`.gitignore`，不进 GitHub；设备 `/rhos/etc/agent/`），**不**随 `deploy:remote` 部署。
