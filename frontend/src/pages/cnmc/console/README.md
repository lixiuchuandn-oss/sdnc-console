# 租户 Cloudmap 控制台（`/console`）

## 定位

- **路由**：`/console`（租户专用；旧入口 `/admin/clouds/console` 重定向至此，见 `lib/tenantConsolePaths.ts`）。
- **与管理员侧**：管理员多从资源池详情进入；租户日常以本控制台为主。数据范围（如 `mergePublicScenarioNamespaces`）见 `CloudConsole.tsx`。
- **RBAC**：与 Cloudmap 池内 `poolPageAction` 对齐，见 `docs/cloudmap-pool-rbac.md` 与 `lib/tenantConsolePageAccess.ts`。

## 目录结构（对齐 `frontend/src/STRUCTURE.md`）

```
console/
├── index.ts                 # 懒加载入口 + 路由常量再导出
├── CloudConsole.tsx         # 页面壳：资源池切换、数据拉取、侧栏联动
├── CloudConsole.css         # 控制台内容区样式
├── README.md
├── hooks/
│   └── useTenantConsolePermissions.ts
├── lib/
│   ├── tenantConsolePaths.ts      # 路径常量、租户 GET 合并公共场景规则
│   └── tenantConsolePageAccess.ts # 控制台 ↔ poolPageAction 映射
└── sections/                # 主内容区（按产品域拆分 Panel）
    ├── CloudConsoleMainPanel.tsx      # 云主机 / 扁平 / VPC
    ├── CloudConsoleContainerPanel.tsx # 容器服务
    └── CloudConsoleDatabasePanel.tsx  # 云数据库
```

布局壳（顶栏、产品侧栏）在 `layouts/tenant/`，与业务 `sections/` 分离。

## 对外 import

```ts
import { TENANT_CLOUD_CONSOLE_PATH } from 'pages/cnmc/console';
const Page = lazy(() => import('pages/cnmc/console'));
```
