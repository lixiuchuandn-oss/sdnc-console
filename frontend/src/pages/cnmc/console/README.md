# Cloudmap 云主机控制台（Console）

## 租户控制台入口

- **本目录** `frontend/src/pages/cnmc/console` 在沟通与文档中作为 **租户侧 Cloudmap 控制台** 的正式锚点。
- **路由**：`/console`（租户控制台专用前缀；旧入口 `/admin/clouds/console` 由前端 `Navigate` 重定向到 `/console`。见 `RouteSpec` / `App.tsx` / `tenantConsolePaths.ts`）。
- **与管理员侧区别**：管理员常从「资源池管理 → 某资源池详情」等入口操作；**租户日常以本 Console 为主**。功能上均针对 Cloudmap/Harvester，但权限与数据范围（如 `mergePublicScenarioNamespaces`）可能不同，实现见 `CloudConsole.tsx` 中 `isTenantConsole` 等逻辑。

## 主要文件

| 文件 | 说明 |
|------|------|
| `CloudConsole.tsx` | 页面壳：资源池切换、数据拉取、Layout |
| `CloudConsoleMainPanel.tsx` | 云主机 / 扁平 / VPC 类目与 Section 路由 |
| `CloudConsoleContainerPanel.tsx` | 容器服务 |
| `CloudConsoleDatabasePanel.tsx` | 云 RDS 等 |
| `CloudConsole.css` | 控制台布局与样式 |
| `TenantConsoleHeaderSlotContext.tsx` | 顶栏「可用区」等中间槽位（由 `TenantConsoleLayout` 提供） |

## 沟通用语建议

对内对外说明「租户控制台」「云主机控制台页面」时，可指向：**`Console` 目录**或路由 **`/console`**，避免与「资源池详情页」混淆。
