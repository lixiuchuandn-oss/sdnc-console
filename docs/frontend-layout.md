# 前端页面布局规范

> Hub 子文档 · 全站页面壳层、容器组件与路由—侧栏—内容区约定（**`docs/frontend-layout.md`**，可提交）。  
> 入口摘要见 **`AGENTS.md` · 开发规范**；目录落位见 **`frontend/src/STRUCTURE.md`**；列表表格 **§5.1**、工具栏 **§5.2**（样板 **`Harvester/ecs/sections/VmSection.tsx`**）；表格细则亦见 **`AGENTS.md` · 列表表格**；加载态见 **`deployment/docs/specs/frontend-loading-skeleton.md`**（本地规格，不入库）。

**推荐阅读顺序**：① 整体壳层 → ② 三层容器 → ③ 路由与侧栏模式 → ④ 业务域内 UI 落位 → ⑤ 刷新、表格与工具栏 → ⑥ PR 自查交叉引用。

---

## 1. 整体壳层（自上而下）

```
┌─────────────────────────────────────────────────────────────┐
│ AdminLayout：顶栏（平台切换、用户、资源池选云等）              │
├──────────────┬──────────────────────────────────────────────┤
│ AdminSidebar │ 主内容区（React Router `<Outlet />`）           │
│ 平台导航 或   │                                               │
│ 上下文侧栏    │  PageContainer / PageDetailContainer / …       │
└──────────────┴──────────────────────────────────────────────┘
```

| 层级 | 路径 | 职责 |
|------|------|------|
| 应用布局 | `layouts/admin/AdminLayout.tsx` | 顶栏 + 侧栏 + 内容区；按 URL 切换**平台导航**或**资源池/集群上下文侧栏** |
| 侧栏装配 | `layouts/admin/AdminSidebar.tsx` | 菜单 `selectedKeys` 与 `navigate(key)`；菜单项 `key` 为完整路径（可含 `?tab=`） |
| 路由声明 | `routes/RouteSpec.ts` + `App.tsx` | `platform`、`group`、`requiredActions`；与权限映射一致 |
| 页面容器 | `components/PageContainer.tsx` 等 | 页面内标题、工具栏、面包屑、Tab、表格 |

**原则**：布局壳在 `layouts/` 与 `components/`；业务数据与区块在 `pages/<platform>/` 的 `sections/` / `drawers/` / `modals/`。

---

## 2. 三层页面容器（强制心智模型）

全站列表页、详情页、详情内 Tab 区块须按下列分工选用，**禁止**在业务页重复造一套「标题 + 工具栏 + 白卡片」骨架。

| 组件 | 路径 | 适用场景 |
|------|------|----------|
| **`PageContainer`** | `components/PageContainer.tsx` | **列表/管理页**（单表或单主内容）：资源池列表、设置列表等；可内置 `tableProps`、Tab、列展示 |
| **`PageDetailContainer`** | `components/PageDetailContainer.tsx` | **详情页外壳**：资源详情、带总览折叠区或 **Ant Design Tabs** 的详情；可提供 `onBack`、面包屑、`overviewContent` |
| **`PageDetailSection`** | `components/PageDetailSection.tsx` | **详情内的数据区块**：某 Tab 下「虚拟机列表」「卷列表」等；标题 + `toolbarLeft`/`toolbarRight` + `onRefresh` + 子内容 |

### 2.1 组合方式

**模式 A — 详情 + 内置 Tabs（`PageDetailContainer.tabs`）**

- 适用于 Tab 较少、Tab 与详情头同一卡片内的场景（部分公有云详情壳）。
- 每个 Tab 的 `children` 内再放 **`PageDetailSection`**（或整块表单/表格）。

**模式 B — 详情壳 + 路由/查询参数 Tab（推荐：Cloudmap / 厂商资源池）**

- 外层：**`PageDetailContainer`** 设 `hideHeader`（或极简头），`asCard={false}`，仅作 padding/高度容器。
- Tab 切换：**URL** `?tab=` 或路径后缀；**侧栏**菜单项 `key` 指向带 query 的完整 URL。
- 每个 Tab 对应一个 **`sections/*Section.tsx`**，根节点为 **`PageDetailSection`**。

**模式 C — 纯列表页**

- 根节点 **`PageContainer`**，`tableProps` 或 `children` 二选一；刷新走 `onRefresh`（见 §5）。

### 2.2 代码示例（摘要）

```tsx
// 列表页
<PageContainer
  title="资源池管理"
  icon={<CloudOutlined />}
  primaryAction={{ text: '新增', onClick: handleAdd }}
  onRefresh={handleRefresh}
  tableProps={{ columns, dataSource, rowKey: 'id' }}
/>

// 详情 + 内置 Tabs
<PageDetailContainer
  title={cloud.name}
  icon={<CloudOutlined />}
  onBack={() => navigate(-1)}
  tabs={[
    { key: 'compute', label: '弹性计算', children: <ComputeSection /> },
  ]}
/>

// 资源池 Tab 区块（模式 B 中最常见）
<PageDetailSection
  title="虚拟机列表"
  toolbarLeft={<Input.Search />}
  onRefresh={() => runHarvesterSectionRefresh(onRefresh, { force: true })}
>
  <Table className="std-table" columns={columns} scroll={{ x: true }} />
</PageDetailSection>
```

### 2.3 常用 props 约定

| 组件 | 属性 | 说明 |
|------|------|------|
| `PageDetailContainer` | `hideHeader` | 池内多 Tab 由侧栏驱动时，避免重复大标题 |
| `PageDetailContainer` | `asCard={false}` | 内容区不再包一层 Card，由 `PageDetailSection` 各自成卡 |
| `PageDetailContainer` | `rootStyle` / `contentWrapperStyle` | 监控/拓扑等需 **占满视口高度** 时使用 |
| `PageDetailSection` | `toolbarLeft` / `toolbarRight` | 筛选与操作区；内部由 **`SharedToolbar`** 排版（见 **§5.2**） |
| `PageDetailSection` | `toolbarGapLeft` / `toolbarGapRight` | 默认 **`8`**，与 `Space size` 一致 |
| `PageDetailSection` | `onRefresh` | 传入时由 `SharedToolbar` 渲染刷新钮并传 **`true`**；Harvester 池可改用手动刷新钮 + **`createHarvesterToolbarRefresh`**（VmSection） |
| `PageDetailSection` | `primaryAction` / `batchActions` / `columnsConfig` | 右侧标准动作（主按钮 → 批量 `…` → 列展示 → 刷新），不必手写 |
| `PageDetailSection` | `RowActionsButton` | 行操作列下拉（导出同文件） |
| `PageContainer` | `toolbarLeft` + `primaryAction` 等 | 工具栏容器类名 **`page-container-toolbar`**，间距约定同 **§5.2** |

---

## 3. 路由与侧栏模式

### 3.1 平台顶栏导航

- 顶栏切换 **CNMC / TENANTS / SDNCC / CNSOC / SETTINGS**（与 `RouteSpec.platform` 一致）。
- 侧栏默认展示该平台 `visibleCenters` 菜单（由 `RouteSpec` + 权限过滤）。

### 3.2 资源池与上下文侧栏

进入特定资源池或集群工作台时，`AdminLayout` 用 **`contextualPoolSidebar`** **替换**平台侧栏（顶栏平台下拉 selectedKeys 置空）。

| 场景 | URL 模式 | 侧栏配置位置 |
|------|----------|----------------|
| Cloudmap / Harvester 池 | `/admin/clouds/:id/...` | `layouts/admin/cloudmap/`、`cloudmapPoolNavRows` |
| 厂商资源池（华为/阿里/Rancher/Xinference/MAAS 等） | `/admin/clouds/vendor/<slug>/:id?tab=` | `layouts/admin/<vendor>/` 或 `pages/.../lib/poolDetailNav.ts` |
| CSM 安全资源池 | `/admin/security/traffic/csm-pools/:id` | `layouts/admin/csm/csmPoolSidebar.ts` |
| Rancher 集群工作台 | `/admin/clouds/:poolId/clusters/:clusterId` | `layouts/admin/rancher/rancherClusterSidebar.ts` |

**约定**：

1. 新增「独立资源池产品线」时，须实现：`parse*PoolDetailId`、`build*PoolSidebarCenter`、`*SidebarSelectedKey`，并在 **`AdminLayout`** 注册（与 MAAS / Xinference 同级）。
2. 列表点击进入详情：统一走 **`poolDetailNav.buildPoolEntryPath`**（或域内等价函数），保证 URL 与侧栏菜单 `key` 一致。
3. Tab 默认项须在首次进入时 **`replace`** 写入 `?tab=`（避免无 Tab 高亮）。

### 3.3 路径与源码（不要求逐段同构）

- 对外 URL 以 **`RouteSpec.ts`** 为准。
- 页面源码在 **`pages/<platform>/`**；Cloudmap 池内 Tab 与 **`panels/`** 装配见 **`frontend/.../Cloudmap/pool/README.md`**。

---

## 4. 业务域内 UI 落位

| 类型 | 目录 | 用途 |
|------|------|------|
| `sections/` | 域内 | Tab 主内容、列表+工具栏（根节点多为 `PageDetailSection`） |
| `drawers/` | 域内 | 侧滑详情、复杂只读/编辑（如 VM 详情壳） |
| `modals/` | 域内 | 对话框、向导（如 `CloudWizard`、部署/创建） |
| `components/` | 域内 | 域内复用块（非全站级） |
| `lib/` | 域内 | 导航、格式化、常量（如 `poolDetailNav.ts`、`maasPoolTabs.ts`） |

**全站复用**（跨平台）：`frontend/src/components/`（`CodeEditor`、`MonitoringPopover`、`PageContainer` 等）。

**禁止**：

- 在 `sections/` 里再实现一套与 `PageDetailSection` 等价的「小标题 + 刷新 + 白底」包装。
- 仅为包装 `Skeleton` 单独建组件（见加载态规范）。

---

## 5. 刷新、加载与表格（与布局配套）

与 **`AGENTS.md` · 开发规范 · 数据展示与刷新** 一致，布局相关要点：

| 场景 | 要求 |
|------|------|
| `PageDetailSection` / `PageContainer` 工具栏刷新 | `onRefresh` 须触发**真实对端拉取**；GET 使用 **`skipCache: true`** |
| Harvester Cloudmap 池 Section | 使用 **`createHarvesterToolbarRefresh` / `runHarvesterSectionRefresh`**，禁止裸 `onRefresh(true)` |
| 列表 `Table` | 见 **§5.1**（结构 + 样式）；样板 **`VmSection`** |
| 列表工具栏 | 见 **§5.2**（布局 + `global-new.css` 工具栏类）；样板 **`VmSection`** |
| 加载态 | 表格用 **`loading`**；其它区域直接用 **`antd` `Skeleton`** |

### 5.1 列表表格（`.std-table`，样板：VmSection）

**参考实现**：`frontend/src/pages/cnmc/clouds/Harvester/ecs/sections/VmSection.tsx`（列定义见同域 `ecs/lib/vmTableColumns.tsx`）。全站数据列表默认对齐该页，**视觉与边框以 `frontend/src/global-new.css` 中 `.std-table` 为唯一 CSS 落点**，业务页勿再叠一套表格外框/竖线样式。

#### 结构与 Ant Design 属性

| 项 | 约定 |
|----|------|
| 类名 | **`className="std-table"`**（必选） |
| 边框模式 | **`bordered={false}`**（显式写出或与默认一致）；**禁止**对标准列表开 `bordered`（全网格竖线/外框与全站行分隔线冲突） |
| 横向滚动 | **`scroll={{ x: true }}`**（有 `fixed` 列时必选） |
| 表格密度 | **勿**给 `Table` 设 `size="small"`（除非产品明确要求）；分页可用 `pagination={{ size: 'small', showTotal: … }}`（VmSection 即如此） |
| 首列冻结 | 主标识列（名称 / System ID 等）**`fixed: 'left'`**；有 **`rowSelection`** 时，多选列由 antd 置于最左，主标识列仍须 `fixed: 'left'`（与 VmSection「云主机名称」列一致） |
| 操作列 | 有行级操作时末列 **`fixed: 'right'`**，配合 **`ResourceActionsDropdown`** / **`RowActionsButton`** 等同域既有组件 |
| 列宽 | 列上**原则上不写**固定 `width`；超长主字段可用列级 **`ellipsis: true`** + Tooltip（见 VmSection 名称列） |
| 列展示 | 列数较多的大表可接 **`useTableColumnSettings`** + **`TableColumnSettingsButton`**；`fixed` 列在列展示中**不可关闭**（见 `AGENTS.md`） |

#### 边框与单元格视觉（由 `global-new.css` 统一，业务勿覆盖）

| 项 | 约定 |
|----|------|
| 行分隔 | 仅 **横向** 底边：`border-bottom: 1px solid #e5e6eb`（表头、表体单元格均由 `.std-table` 统一） |
| 竖线 / 表格外框 | **无**（不启用 `bordered`，不在页面内对 `.std-table .ant-table-cell` 写 `border-inline` / 外框） |
| 表头字重 | **正常**（`font-weight: normal`），不靠加粗表头区分层级 |
| 单元格 | 默认 **`padding: 12px 16px`**、**`font-size: 14px`**、**`white-space: nowrap`**；需多行展示时在单元格**子节点**设 `white-space: normal` |
| 行悬停 | **`background-color: #f2f3f5`**（`.std-table` 已定义，勿在单页用内联样式盖掉） |
| 空表 | 无数据时由 `.ant-table-empty` 规则收束宽度，避免「空表仍出现横向滚动条」（见 `global-new.css` 注释） |

#### 代码摘要（与 VmSection 一致）

```tsx
<PageDetailSection title="虚拟机列表" onRefresh={handleToolbarRefresh} toolbarRight={…}>
  <Table
    className="std-table"
    bordered={false}
    rowKey={…}
    rowSelection={…}  // 可选；有则多选列在最左
    columns={columns} // 首列 fixed: 'left'，操作列 fixed: 'right'
    dataSource={data}
    loading={loading}
    scroll={{ x: true }}
    pagination={{ size: 'small', showTotal: (t) => `共 ${t} 条` }}
  />
</PageDetailSection>
```

**禁止**：在 `sections/` 内为「对齐某页」给标准列表表写 `bordered`、`size="small"`，或用页面级 `<style>` / 选择器把 `.std-table` 行底线改成 `border-bottom: none`（SDN 控制台对**非** `.std-table` 表另有局部规则，标准列表不适用）。

### 5.2 列表工具栏（样板：VmSection）

**参考实现**：`VmSection` 的 `PageDetailSection` **`toolbarLeft` / `toolbarRight`**（`ecs/sections/VmSection.tsx`）。布局由 **`PageDetailSection` → `SharedToolbar`**（`components/SharedToolbar.tsx`）或列表页的 **`PageContainer`**（类名 **`page-container-toolbar`**）统一输出；**间距、控件宽度、右侧按钮区**以 **`frontend/src/global-new.css`** 工具栏段落为 CSS 落点，业务页优先用下列 **className**，勿在 Section 内再写一套 toolbar flex + 随意 `gap`。

#### 整体布局

| 项 | 约定 |
|----|------|
| 容器 | 详情区块：**`SharedToolbar`**（`className="shared-toolbar"`）；列表页：**`page-container-toolbar`** |
| 结构 | **左**：筛选 / 搜索；**右**：`marginLeft: 'auto'` 对齐的操作区（`Space` **`size={8}`**，`wrap` 允许换行） |
| 与表格间距 | 工具栏 **`margin-bottom: 16px`**（`SharedToolbar` / `page-container-toolbar` 已内置） |
| 对齐 | 控件与按钮 **底对齐**（`align-items: flex-end` 或 `center`）；多行筛选时 **行间距 8px**（`.toolbar-container` 的 `row-gap` / `column-gap`） |

#### 左侧筛选区（`toolbarLeft`）

| 控件 | className / 写法 | 说明 |
|------|------------------|------|
| 关键字 | **`toolbar-search`** | `Input` 或 `Input.Search`；**`allowClear`**；后缀搜索图标颜色 **`rgba(0,0,0,.45)`**（VmSection 用 `suffix={<SearchOutlined … />}`） |
| 常规下拉 | **`toolbar-filter`** | 宽度约 **200px**（状态、类型等） |
| 紧凑下拉 | **`toolbar-filter-sm`** | 宽度约 **140px**（命名空间、节点等短标签） |
| 带 Label 的表单行 | 外包 **`toolbar-container`** | 用于 `PageContainer` 左栏 `Form`；Label **14px**，表单项 **`margin-bottom: 0`** |
| 重置 | **`toolbar-reset-btn`** | **原生 `<button type="button">`** 文字链样式（非 `antd` `Button`）；高度 **32px**，主题色文字，清空左侧筛选 |

`PageDetailSection` 在 **`autoStyleInputs={true}`**（默认）时会对未带 class 的 `Input.Search` / `Select` 自动设宽约 **240 / 200px**；与 VmSection 一样显式加 **`toolbar-search` / `toolbar-filter*`** 时，以 **global CSS 类**为准。

#### 右侧操作区（`toolbarRight`）

右侧内容须包在 **`div.toolbar-actions`** 内（flex **`gap: 8px`**），与 VmSection 一致。

**推荐顺序**（与 `SharedToolbar` 内置顺序对齐；复杂页可手写同序）：

1. **主操作**：`Button type="primary"`（如「快速创建」「创建向导」）；按权限隐藏或 `disabled`
2. **批量 / 更多**：`Dropdown` + **`icon={<EllipsisOutlined />}`** 的**图标按钮**（无文字）；危险项在菜单内标红
3. **列展示**（可选）：`TableColumnSettingsButton` 或 `SharedToolbar` 的 `columnsConfig`
4. **刷新**：**仅图标** **`ReloadOutlined`**，`loading` 绑列表加载态；Harvester Cloudmap 池用 **`createHarvesterToolbarRefresh(onRefresh)`** 作 `onClick`（VmSection 做法），勿裸传 `onRefresh` 当点击处理器

**图标按钮尺寸**：`.toolbar-actions .ant-btn.ant-btn-icon-only` → **32×32px**，内容居中（刷新、批量、列设置等同理）。

**简化写法**：若无需 VmSection 级自定义右侧，可向 `PageDetailSection` 直接传 **`primaryAction`**、**`batchActions`**、**`columnsConfig`**、**`onRefresh`**，由 `SharedToolbar` 按上序渲染，无需自写 `toolbarRight`。

#### 代码摘要（VmSection）

```tsx
<PageDetailSection
  asCard={false}
  toolbarLeft={
    <>
      <Input className="toolbar-search" allowClear placeholder="名称/ID" suffix={<SearchOutlined style={{ color: 'rgba(0,0,0,.45)' }} />} … />
      <Select className="toolbar-filter-sm" placeholder="状态" allowClear … />
      <button type="button" className="toolbar-reset-btn" onClick={resetFilters}>重置</button>
    </>
  }
  toolbarRight={
    <div className="toolbar-actions">
      <Button type="primary" …>快速创建</Button>
      <Dropdown trigger={['click']} menu={{ items: batchMenuItems }}><Button icon={<EllipsisOutlined />} /></Dropdown>
      <TableColumnSettingsButton … />
      <Button icon={<ReloadOutlined />} loading={loading} onClick={handleToolbarRefresh} />
    </div>
  }
>
  <Table className="std-table" bordered={false} … />
</PageDetailSection>
```

#### 禁止

- 在 `sections/` 内自建与 `SharedToolbar` 等价的整条 flex 工具栏（应用 **`PageDetailSection` / `PageContainer`** + 上述 class）。
- 右侧操作区省略 **`toolbar-actions`** 导致按钮间距不一致。
- 刷新钮使用带文字的默认 `Button` 占宽（标准列表用**图标刷新**）。
- 批量菜单用 `type="primary"` 大按钮代替 **`EllipsisOutlined`** 图标钮（与全站列表页不一致）。

---

## 6. 特殊布局场景

| 场景 | 建议 |
|------|------|
| 全屏拓扑 / 监控嵌入 | `PageDetailContainer` + `hideHeader` + `rootStyle`/`contentWrapperStyle` 撑满高度；子组件内部滚动 |
| 向导 / 多步表单 | `modals/` 内 `Modal` + `Steps`，不占用 `PageDetailContainer` Tabs |
| 租户控制台 | 独立布局或简化头；见 `pages/cnmc/console/` |
| 登录 / 欢迎页 | 不使用三层容器；独立页面 |

---

## 7. 新增页面检查清单（可复制到 PR）

1. 是否选对 **`PageContainer` / `PageDetailContainer` / `PageDetailSection`**？
2. 资源池类详情是否接入 **`buildPoolEntryPath`** 与（如需）**上下文侧栏**？
3. Tab 是否与 URL `?tab=`（或路径）同步，且侧栏 `key` 可导航？
4. 列表是否 **§5.1**（`.std-table`、`bordered={false}`、冻结列、`scroll.x`）？
5. 工具栏是否 **§5.2**（`toolbarLeft`/`toolbarRight` 或 `SharedToolbar` 标准动作、`toolbar-search` / `toolbar-actions`、图标刷新）？
6. 刷新与写成功后重载是否符合 **`AGENTS.md`** 与 Cloudmap 池样板？
7. 域内新块是否落在 **`sections/` / `drawers/` / `modals/`**，而非堆在 `pages` 根文件？

---

## 8. 相关文档索引

| 文档 | 内容 |
|------|------|
| **`AGENTS.md`** | 强制约定摘要、Harvester 落位索引、API |
| **`frontend/src/STRUCTURE.md`** | `pages/` 平台划分、`sections` 角色 |
| **`docs/code-quality.md`** | 合入前自查 |
| **`docs/cloudmap-pool-rbac.md`** | 池内页权限 |
| **`frontend/.../Cloudmap/pool/README.md`** | 池刷新与 Tab 装配样板 |
