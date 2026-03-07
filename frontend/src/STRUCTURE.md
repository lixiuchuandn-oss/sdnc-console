# 前端目录结构说明

## 📁 目录结构

```
src/
├── assets/              # 静态资源（图片、图标等）
├── components/          # 公共组件
├── constants/           # 常量定义
├── contexts/            # React Context（全局状态）
├── hooks/               # 自定义 Hooks
├── layouts/             # 布局组件
├── pages/               # 页面组件（按功能模块组织）
├── routes/              # 路由配置
├── services/            # API 服务层
├── types/               # TypeScript 类型定义
├── utils/               # 工具函数
├── App.tsx              # 应用入口组件
├── index.tsx             # 应用入口文件
├── global-new.css       # 全局样式
├── setupProxy.js        # 开发环境代理配置
└── setupTests.ts        # 测试环境配置
```

## 📋 目录职责

### `assets/`
静态资源文件，包括：
- 图片文件（.png, .svg）
- 图标资源
- 其他静态文件

### `components/`
可复用的公共组件，包括：
- 页面容器组件（PageContainer, PageDetailContainer）
- 表单组件（StdFormModal, StdSideDrawer）
- 工具组件（Breadcrumbs, ResourceActionsDropdown）
- 路由组件（AdminRoute, PrivateRoute）

### `constants/`
常量定义，包括：
- 业务常量（如省份城市数据）
- 配置常量（如分页配置）

### `contexts/`
React Context 提供者，包括：
- AuthContext - 认证状态
- LicenseContext - 授权状态
- SettingsContext - 系统设置

### `hooks/`
自定义 React Hooks，包括：
- useTableColumnSettings - 表格列设置

### `pages/`
页面组件，按功能模块组织：
- `Access/` - 权限管理
- `Clouds/` - 云资源管理
- `Dashboard/` - 仪表盘
- `InterConnect/` - 互联互通
- `Settings/` - 系统设置
- `Tenants/` - 租户管理
- 等等

### `services/`
API 服务层，每个文件对应一个业务模块的 API：
- `api.ts` - 通用 API
- `harvesterApi.ts` - Harvester API
- `aliyunApi.ts` - 阿里云 API
- 等等

### `types/`
TypeScript 类型定义文件

### `utils/`
工具函数，包括：
- 访问权限映射
- 云资源标准化
- 格式化工具
- 等等

## 🔄 已优化项

1. ✅ **空目录清理**
   - `domains/` - 已删除
   - `shared/` - 已删除
   - `catalogs/` - 已删除（文件已移至 constants/）

2. ✅ **文件整理**
   - `catalogs/navCatalog.ts` → `constants/navCatalog.ts` - 已完成

3. ✅ **CSS 迁移**
   - `global.css` → `global-new.css` 的迁移已完成，`global.css` 已删除

## 📝 命名规范

- **组件文件**: PascalCase（如 `PageContainer.tsx`）
- **工具文件**: camelCase（如 `harvesterUtils.ts`）
- **类型文件**: camelCase（如 `cloud.ts`）
- **常量文件**: camelCase（如 `pagination.ts`）

## 🎯 最佳实践

1. **组件复用**: 公共逻辑提取到 `components/` 或 `hooks/`
2. **类型安全**: 使用 TypeScript 类型定义，放在 `types/`
3. **API 封装**: 所有 API 调用通过 `services/` 层
4. **常量管理**: 业务常量统一放在 `constants/`
5. **工具函数**: 通用工具函数放在 `utils/`
