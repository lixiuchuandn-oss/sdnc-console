# 已知问题（待修复）

## 租户/无「界面设置」权限用户加载应用时控制台刷屏

**现象**：以租户等无 `system.settings`（界面设置）权限的账号进入前端时，`SettingsContext` 仍会并行请求 `ui.*`、`network.*` 等 `/api/system/settings/...`，接口返回 403「权限不足：需要 界面设置」，浏览器控制台出现大量 `Failed to fetch setting ...` / `API请求失败`。

**原因**：`frontend/src/contexts/SettingsContext.tsx` 在挂载时对全部 `uiKeys` / `systemKeys` 一律 `getSystemSetting`，未按权限区分；后端系统设置读操作绑定 `system.settings:read`。

**影响**：功能上多回退到代码内默认值；主要干扰开发调试与日志噪音。

**建议修复方向**（任选或组合）：

- 仅当 `hasPermissionForAction(..., 'system.settings:read')`（或等价）时再请求 `uiKeys` / 敏感 `systemKeys`；否则只用本地默认。
- 或对 403 静默处理，避免对预期无权限场景 `console.warn`。
- 长期：登录页 / 控制台所需的「公开品牌化」配置可单独只读接口，与管理员 `system.settings` 写权限分离。

**相关文件**：`frontend/src/contexts/SettingsContext.tsx`、`frontend/src/services/systemApi.ts`、后端 `system` 设置路由与权限注册。
