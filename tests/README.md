# Compute Tower 业务域测试

与 `backend/`、`frontend/` 同级，按业务域组织 API 与浏览器 E2E。

## 环境准备

```bash
cd tests
cp .env.example .env
npm install            # postinstall 自动执行 playwright install chromium
```

| 变量 | 说明 |
|------|------|
| `TOWER_WEB_BASE` | 前端地址，默认 `http://127.0.0.1:5000` |
| `TOWER_API_BASE` | 后端地址，默认 `http://127.0.0.1:5001` |
| `TOWER_CLOUD_ID` | 云池 ID；不填则自动选第一个 online 池 |
| `HEADLESS` | 设为 `1` 时浏览器无头运行 |
| `TOWER_SMOKE_PAGE_DELAY_MS` | 冒烟 Tab 间等待（毫秒），默认 `500` |

运行浏览器用例前请确保前后端已启动。

## 脚本

### API（无需 Playwright）

```bash
npm run test:auth:api
npm run test:cloudmap:connection
npm run test:failure-domains:api
```

### 浏览器 E2E（需要 Playwright）

```bash
npm run test:browser
npm run test:browser:auth
npm run test:browser:harvester
```

分项：

```bash
npm run test:auth:browser
npm run test:images:browser
npm run test:failure-domains:browser
npm run test:failure-domains:browser-filter
```

故障域可选环境变量：`TOWER_FD_NODE_NAME`、`TOWER_FD_NAME_PREFIX`。

### 只读 Tab 冒烟（Playwright）

遍历池内侧栏 Tab，断言无 React 红屏；不写库、不截图。需在线云池与前后端。

```bash
HEADLESS=1 npm run test:smoke:cluster   # ch03 §6 集群
HEADLESS=1 npm run test:smoke:vm        # ch03 §3.2 云主机
HEADLESS=1 npm run test:smoke:storage     # ch03 §3.3 块存储
HEADLESS=1 npm run test:smoke:backups      # ch03 §3.9 备份
HEADLESS=1 npm run test:smoke:overview     # ch03 §4 资源总览
HEADLESS=1 npm run test:smoke:containers   # ch03 §10 容器
HEADLESS=1 npm run test:smoke:monitoring   # ch03 §3.14 监控
HEADLESS=1 npm run test:smoke:misc        # 云数据库 / VNE / 日志
HEADLESS=1 npm run test:smoke:admin       # ch04 设置 / ch05 租户
HEADLESS=1 npm run test:smoke:pool        # ch02 登录与资源池列表
HEADLESS=1 npm run test:smoke:pool-wizard # ch02 边缘云向导测连（需 Cloudmap 凭证）
HEADLESS=1 npm run test:smoke:vm-detail   # VM 详情抽屉
HEADLESS=1 npm run test:smoke             # 全部 smoke
```

| 脚本 | 手册章节 | 路由来源 |
|------|----------|----------|
| `test:smoke:cluster` | ch03 §6 集群 | `manual/capture-ch03-cluster.browser.cjs` |
| `test:smoke:vm` | ch03 §3.2 云主机 | 侧栏 `compute/*` + VM 列表 capture |

公共导航：`lib/pool-nav.cjs`；断言：`lib/smoke-pool-tab.cjs`。

### 用户手册截图（Playwright）

截图输出到 `docs/cloudmap/user-manual/source/assets/`。多池 UI 需先激活企业 License，详见 `manual/README.md` 与 `docs/cloudmap/user-manual/SCREENSHOTS.md`。

```bash
npm run manual:shots:images      # 3.2.7 镜像
npm run manual:shots:pool        # 第 2 章资源池
npm run manual:shots:vm          # VM 创建向导
npm run manual:shots:volumes     # 卷与快照
npm run manual:shots:backups     # 备份与恢复
npm run manual:shots:vm-detail   # VM 详情抽屉
npm run manual:shots:network     # 网络
npm run manual:shots:monitoring  # 监控告警
```

## 目录约定

- `*.api.test.cjs` — 仅 HTTP API
- `*.browser.test.cjs` — Playwright 驱动浏览器
- `smoke/` — 只读 Tab 冒烟（`*.browser.test.cjs`）；与手册章节对应，不写库
- `lib/` — 跨用例封装（`pool-nav.cjs`、`smoke-pool-tab.cjs`）；域内 lib 仍在各 `harvester/*/lib/`
- `manual/` — 用户手册截图脚本
- `shared/` — 登录、环境变量、浏览器启动、`manual-screenshot.cjs`
