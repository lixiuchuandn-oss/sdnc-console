# MAAS 裸金属资源池（CNMC）

> URL：`/admin/clouds/vendor/maas/:cloudId?tab=` · 侧栏：`layouts/admin/maas/maasPoolSidebar.ts` · BFF：`backend/src/routes/clouds/maas.routes.ts` · 集成规格：`docs/maas-integration.md` §4 / §14

## Tab ↔ Section

| `?tab=` | Section | 说明 |
|---------|---------|------|
| `dashboard` | `sections/DashboardSection.tsx` | 概览（`GET .../maas/dashboard`）、Tower 连接只读、控制器表 |
| `machines` | `sections/MachinesSection.tsx` | 机器列表与操作 |
| `discoveries` | `sections/DiscoveriesSection.tsx` | 网络发现 |
| `images` | `sections/ImagesSection.tsx` | 操作系统镜像（v2 boot-resources） |
| `network` | `sections/NetworkSection.tsx` | 子网 / VLAN |

旧 `?tab=settings` 重定向至 `dashboard`（Region 配置已并入概览；编辑/测连在资源池管理）。

## 目录

| 目录 | 用途 |
|------|------|
| `sections/` | 各 Tab 主内容（根节点 `PageDetailSection`） |
| `components/` | 概览 KPI 卡、dashboard 子块 |
| `drawers/` | 机器详情 |
| `modals/` | 部署向导等 |
| `hooks/` | `useMaasDashboard` 等 |
| `lib/` | Tab key、状态分桶、表格列、工具栏 |

## 刷新约定

- 列表/概览显式刷新与写成功后重载：`fetchMaas*` 均传 **`skipCache: true`**。
- 概览 30s 静默轮询见 `lib/maasDashboardUtils.ts` · `MAAS_DASHBOARD_POLL_MS`。

## 页面布局

- 池壳：`MaasPoolWorkspace` + `PageDetailContainer`（`hideHeader`）。
- 列表页工具栏：`toolbarLeft` / `toolbarRight` + `toolbar-actions`（见 `docs/frontend-layout.md` §5.2）。
- 子网/VLAN 内切换：`Segmented` 在 `toolbarLeft`，禁止在工具栏上方单独放 `Tabs`。
