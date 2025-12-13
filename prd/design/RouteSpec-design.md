路由配置结构体设计（RouteSpec）

**目标**
- 单一来源声明：用统一的 RouteSpec 生成路由、导航、面包屑与模态叠加。
- 显示与行为解耦：显示元信息（标题、图标、层级）与行为（守卫、布局、权限）分层组织。
- 可扩展与可验证：字段有明确意义、默认值与校验规则，支持版本演进。

**核心字段**
- 标识
  - `id`：唯一标识（推荐稳定字符串，如 `clouds.instances.detail`）
  - `path`：URL 路径模板（如 `/admin/clouds/:id/instances/:instanceId`）
- 显示
  - `title` / `subtitle`：页面主/副标题
  - `icon`：图标名（与 `ROUTE_CATALOG` 一致）
  - `group` / `platform`：导航分组与平台归属
  - `order`：同级排序；`hidden`：是否在导航隐藏
- 层级
  - `parentId`：父节点标识；`children`：子节点数组（结构化层级）
  - `breadcrumbLabel`：面包屑替换文本；`breadcrumbHidden`：面包屑隐藏
- 行为
  - `layout`：`admin` | `default`（是否使用管理布局）
  - `guard`：`admin` | `private`（页面守卫，分别映射到 `AdminRoute` 与 `PrivateRoute`）
  - `backgroundCapable`：是否支持背景路由叠加；`modalElement`：模态版组件名
- 访问控制
  - `requiredActions`：`{ page?: string; read?: string; write?: string }`
  - `rolesAllow` / `rolesDeny`：角色白/黑名单（可选）
- 路由契约
  - `paramsSchema`：路径参数约束（如 `id` 必填、格式）
  - `querySchema`：查询参数约束（如 `host`、`port` 类型）
- 其它
  - `i18n`：多语言键或映射；`tags`：自由标签；`version`：配置版本；`deprecated`：废弃标记与替代建议

**完整结构体示例**

```
[
  {
    "id": "cloudspools.list", //唯一标识
    "path": "/admin/clouds", //URL 路径模板
    "title": "资源池管理", //页面主标题
    "subtitle": "列表", //页面副标题
    "icon": "CloudUploadOutlined", //图标名（与 ROUTE_CATALOG 一致）
    "platform": "CNMC", //平台归属
    "group": "资源控制台", //导航分组
    "order": 10, //同级排序
    "hidden": false, //是否在导航隐藏
    "parentId": null, //父节点标识
    "breadcrumbLabel": "资源池", //面包屑替换文本
    "breadcrumbHidden": false, //面包屑隐藏
    "layout": "admin", //布局模式
    "guard": "admin", //页面守卫
    "backgroundCapable": false, //是否支持背景路由叠加
    "modalElement": null, //模态版组件名
    "requiredActions": {
      "page": "clouds:page", //页面访问权限
      "read": "clouds:read", //数据读取权限
      "write": "clouds:write" //数据修改权限
    },
    "rolesAllow": [], //角色白名单
    "rolesDeny": [], //角色黑名单
    "paramsSchema": {}, //路径参数约束
    "querySchema": {}, //查询参数约束
    "i18n": { "key": "route.admin.clouds" }, //多语言键或映射
    "tags": ["admin"], //自由标签 （如 "admin"、"tenant"、"wizard" 等）
    "version": "1.0", //配置版本
    "deprecated": false //是否废弃
  },
  {
    "id": "clouds.instances.create",
    "path": "/clouds/:id/instances/create",
    "title": "创建实例",
    "subtitle": "向导",
    "icon": "PlusOutlined",
    "group": "资源控制台",
    "platform": "CNMC",
    "order": 20,
    "hidden": false,
    "parentId": null,
    "breadcrumbLabel": "创建实例",
    "breadcrumbHidden": false,
    "layout": "default",
    "guard": "private",
    "backgroundCapable": true,
    "modalElement": "InstanceWizardModal",
    "requiredActions": {
      "page": "clouds.instances:page",
      "write": "clouds.instances:write"
    },
    "rolesAllow": [],
    "rolesDeny": [],
    "paramsSchema": {
      "id": { "type": "string", "minLength": 1 }
    },
    "querySchema": {},
    "i18n": { "key": "route.clouds.instances.create" },
    "tags": ["tenant", "wizard"],
    "version": "1.0",
    "deprecated": false
  },
  {
    "id": "clouds.instances.detail",
    "path": "/clouds/:id/instances/:instanceId",
    "title": "实例详情",
    "subtitle": "概览",
    "icon": "DesktopOutlined",
    "group": "资源控制台",
    "platform": "CNMC",
    "order": 21,
    "hidden": false,
    "parentId": null,
    "breadcrumbLabel": "实例详情",
    "breadcrumbHidden": false,
    "layout": "default",
    "guard": "private",
    "backgroundCapable": true,
    "modalElement": "InstanceDetailModal",
    "requiredActions": {
      "page": "clouds.instances:page",
      "read": "clouds.instances:read"
    },
    "rolesAllow": [],
    "rolesDeny": [],
    "paramsSchema": {
      "id": { "type": "string", "minLength": 1 },
      "instanceId": { "type": "string", "minLength": 1 }
    },
    "querySchema": {},
    "i18n": { "key": "route.clouds.instances.detail" },
    "tags": ["tenant", "detail"],
    "version": "1.0",
    "deprecated": false
  }
]
```

**生成规则（易读版）**
- 路由树（把 RouteSpec 变成前端路由）
  - 目标：每个 RouteSpec 生成一条路由，正确套用布局与守卫。
  - 步骤：
    - 根据 `layout` 决定挂载区域：`admin` 用管理布局，`default` 用普通布局。
    - 根据 `guard` 包裹页面：`admin` → `AdminRoute`，`private` → `PrivateRoute`。
    - 主路由使用 `background || location` 渲染，确保背景路由机制可用。
  - 模态叠加：
    - 若 `backgroundCapable=true`，再注册同 `path` 的 `modalElement`，仅在存在 `backgroundLocation` 时显示。
    - 关闭模态使用 `navigate(-1)`，返回到进入模态前的背景页面。
- 导航树（侧边栏与入口）
  - 用 `platform/group/icon/order/hidden` 渲染菜单结构与顺序。
  - 显隐规则：用户具备 `requiredActions.page` 或命中 `rolesAllow` 才显示；命中 `rolesDeny` 隐藏。
- 面包屑（页面层级轨迹）
  - 从当前节点沿 `parentId` 回溯，依次取各级 `breadcrumbLabel`（缺省用 `title`）。
  - `breadcrumbHidden=true` 的节点不呈现，用于简化层级显示。
- 参数校验（保证路由参数有效）
  - 在开发/注册阶段校验 `paramsSchema` 与 `querySchema`，提前发现无效路径与查询参数。
  - 生产环境建议仅记录警告并兜底，避免影响用户访问。

**权限三分法**
- `page` 负责“能否进入页面”；`read` 负责“能否读取数据”；`write` 负责“能否修改数据”
- 常用组合：`page+read`（查看），`page+read+write`（操作）；避免 `page` 隐式授予数据权限
- 管理区 `/admin` 与租户侧采用不同守卫；数据权限统一由后端强校验

**背景路由与模态叠加**
- 导航时附带 `state.backgroundLocation`；主内容渲染背景页面，模态路由渲染叠加内容
- 关闭模态 `navigate(-1)` 回到背景页面；适合创建/详情等流程化场景

**最佳实践**
- 最小权限：默认授予 `page+read`，按需增授 `write`
- 一处声明，多处复用：RouteSpec 同时驱动路由、菜单、面包屑与权限校验
- 版本化演进：为字段与节点维护 `version/deprecated`，提供替代路线与兼容策略