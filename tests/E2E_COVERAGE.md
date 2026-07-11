# SDN Console E2E 覆盖一览

> 终端一览：`cd tests && npm run e2e:status`  
> 登记：`e2e-manifest.cjs`（与本文同步维护）

## 图例

| 标记 | 含义 |
|------|------|
| ✅ 功能 E2E | 有 API 或浏览器用例 |
| ❌ 未覆盖 | 尚无自动化 |

## 已覆盖（✅）

| 域 | API 脚本 | 浏览器脚本 |
|----|----------|------------|
| 管理员登录 | `auth/admin-login.api.test.cjs` | `auth/admin-login.browser.test.cjs` |

## 建议下一批

1. 网际路由域列表 / 创建（需 mock 或联调环境）
2. IBR VR 列表只读冒烟
3. 系统设置 · 用户 / 角色 RBAC 只读

## 维护约定

1. 新增 `*.api.test.cjs` 或 `*.browser.test.cjs` 时，在 `e2e-manifest.cjs` 登记。
2. 跑 `npm run e2e:status` 确认无「文件缺失」警告。
