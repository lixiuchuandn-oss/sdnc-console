# Cloudmap 只读 Tab 冒烟（`smoke/`）

与 `manual/` 截图脚本对齐的 **Playwright 浏览器冒烟**：遍历路由、断言无 React 红屏；默认不写库、不截图。

**功能 E2E（创建/改删等写路径）覆盖总表**见 **[E2E_COVERAGE.md](../E2E_COVERAGE.md)**（`npm run e2e:status`）。本目录只负责「Tab 能打开、无红屏」。

## 前置条件

- 前后端已启动（默认 `5000` / `5001`）
- 至少一个 **online** 云池，或设置 `TOWER_CLOUD_ID`
- `cd tests && npm install`

## 一键运行

```bash
HEADLESS=1 npm run test:smoke
```

## 分项脚本

见 `tests/README.md` 中「只读 Tab 冒烟」表格；常用：

| 脚本 | 章节 |
|------|------|
| `test:smoke:cluster` | ch03 §6 集群 |
| `test:smoke:vm` | ch03 §3.2 云主机 |
| `test:smoke:network` | ch03 §3.4 网络 |
| `test:smoke:pool` | ch02 登录与资源池列表 |
| `test:smoke:pool-wizard` | ch02 顶栏边缘云向导 **测连**（需 Cloudmap 凭证） |

## 环境变量

| 变量 | 说明 |
|------|------|
| `HEADLESS=1` | 无头浏览器 |
| `TOWER_SMOKE_PAGE_DELAY_MS` | Tab 间等待，默认 `500` |
| `TOWER_CLOUDMAP_ENDPOINT` / `TOWER_CLOUDMAP_TOKEN` | 仅 `pool-edge-wizard` 需要 |

## 实现结构

- `../lib/pool-nav.cjs` — 池内 / 平台 `goto`
- `../lib/smoke-pool-tab.cjs` — 池内 Tab 断言
- `../lib/smoke-admin-tab.cjs` — 平台管理页断言
- `../lib/pool-edge-wizard.cjs` — ch02 顶栏向导

CI 在 PR 上执行 `npx playwright test smoke/ --list` 校验用例可加载（不启动浏览器跑全量）。

## 公共测试机定时跑（Windows）

本机已常驻 Tower 前后端时，可用任务计划程序每天自动跑全量冒烟。

### 1. 一次性准备

```powershell
cd D:\Compute.Tower\tests
cp .env.example .env   # 按测试环境填写
npm install
```

确认手动可绿：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File D:\Compute.Tower\tests\scripts\run-smoke.ps1
```

日志目录：`tests/logs/smoke-YYYYMMDD-HHmmss.log`

### 2. 创建计划任务（示例：每天 02:00）

以**能访问本机 Tower 的账号**打开「任务计划程序」→ 创建任务：

| 项 | 值 |
|----|-----|
| 触发器 | 每天 02:00（或下班后） |
| 操作 | 启动程序 |
| 程序 | `powershell.exe` |
| 参数 | `-NoProfile -ExecutionPolicy Bypass -File "D:\Compute.Tower\tests\scripts\run-smoke.ps1"` |
| 起始于 | `D:\Compute.Tower` |

建议勾选「不管用户是否登录都要运行」仅当该账号下前后端服务也会自动启动；否则保持登录态跑，并确保 **5000/5001 已先起来**。

### 3. 注意

- 全量约 **15～40 分钟**（集群 Tab 最慢）；避开大家白天密集手工测试时段即可。
- `pool-edge-wizard` 未配 Cloudmap 凭证时会 skip，不影响其余用例。
- 失败时看最新 `tests/logs/smoke-*-playwright.log`；摘要见同时间戳的 `smoke-*.log`。

`pool-edge-wizard` 未配 `TOWER_CLOUDMAP_*` 时会 **skip**，全量仍视为通过（12 passed + 1 skipped）。
