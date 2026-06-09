# Cloudmap 只读 Tab 冒烟（`smoke/`）

与 `manual/` 截图脚本对齐的 **Playwright 浏览器冒烟**：遍历路由、断言无 React 红屏；默认不写库、不截图。

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
