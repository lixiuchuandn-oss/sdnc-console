# SDN Console E2E 测试

与 `backend/`、`frontend/` 同级。当前产品（`PRODUCT_FLAVOR=sdnc`）仅保留认证相关用例。

## E2E 覆盖一眼看

```bash
cd tests
npm run e2e:status
```

详表：[E2E_COVERAGE.md](./E2E_COVERAGE.md) · 数据源：`e2e-manifest.cjs`

## 环境准备

```bash
cd tests
cp .env.example .env
npm install
```

| 变量 | 说明 |
|------|------|
| `TOWER_WEB_BASE` | 前端，默认 `http://127.0.0.1:5000` |
| `TOWER_API_BASE` | 后端，默认 `http://127.0.0.1:5001` |
| `TOWER_ADMIN_USER` / `TOWER_ADMIN_PASSWORD` | 管理员凭据 |
| `HEADLESS` | `1` 无头 |
| `HEADED` | `1` 强制有头 |

本地需先启动前后端（见仓库根 `AGENTS.md`）。

## 常用脚本

| 命令 | 说明 |
|------|------|
| `npm run test:auth:api` | 登录与 `admin-default-home` API 冒烟 |
| `npm run test:auth:browser` | Playwright 浏览器登录 |
| `npm run test:browser:auth:headed` | 有头调试登录用例 |
| `npm run e2e:status` | 打印覆盖矩阵 |

## 目录约定

- `auth/*.api.test.cjs` — Node API 冒烟
- `auth/*.browser.test.cjs` — Playwright 浏览器 E2E
- `shared/` — `tower-api`、Playwright 运行器
- `e2e-manifest.cjs` — 覆盖登记（新增用例须同步维护）
