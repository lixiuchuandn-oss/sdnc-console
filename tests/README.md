# Compute Tower 业务域测试

与 `backend/`、`frontend/` 同级，按业务域组织 API 与浏览器 E2E。

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
| `TOWER_CLOUD_ID` | 云池 ID；不填则自动选 online 池 |
| `HEADLESS` | `1` 无头 |
| `HEADED` | `1` 强制有头 |

有头调试（本机终端）：

```powershell
cd tests
$env:HEADED = "1"
$env:HEADLESS = "0"
node shared/run-headed.cjs harvester/vlans/browser-crud.browser.test.cjs
```

## 常用脚本

见 `package.json`；功能 E2E：`test:vlans:*`、`test:public-subnets:*`、`test:deployment-sets:*`、`test:security-groups:*`、`test:failure-domains:*`、`test:images:*`。

冒烟：`npm run test:smoke` 及 `test:smoke:*`（见 [smoke/README.md](./smoke/README.md)）。

## 目录约定

- `*.api.test.cjs` / `*.browser.test.cjs` — 功能 E2E
- `smoke/` — 只读 Tab 冒烟
- `e2e-manifest.cjs` — 覆盖登记
