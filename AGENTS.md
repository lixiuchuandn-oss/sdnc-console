# Compute Tower - 多云管理平台

## 项目概述

Compute Tower 是一个企业级多云管理平台，提供统一的云资源管理、SDN网络编排、安全运营和AI SOC能力。

### 核心能力

- **多云管理 (CNMC)**: 支持阿里云、华为云、腾讯云、Harvester(KubeVirt) 等多云资源的统一管理
- **SDN管理 (SDNCC)**: SRv6隧道、IPsec VPN、ACL、NAT、虚拟路由器等网络编排能力
- **AI SOC中心 (CNSOC)**: 安全运营、威胁分析、报告管理等安全能力
- **系统设置**: 用户管理、租户管理、RBAC权限控制、审计日志

## 技术栈

### 后端
- **运行时**: Node.js + TypeScript
- **框架**: Express
- **数据库**: SQLite (TypeORM)
- **认证**: JWT + bcryptjs
- **WebSocket**: ws (SSH/VNC/KubeVirt)
- **云SDK**: 阿里云SDK、华为云SDK、腾讯云SDK

### 前端
- **框架**: React 18 + TypeScript
- **UI组件**: Ant Design 5.x
- **路由**: React Router 6
- **图表**: ECharts
- **终端**: xterm.js
- **远程控制**: noVNC

## 项目结构

```
Compute.Tower/
├── backend/                 # 后端服务
│   ├── src/
│   │   ├── index.ts        # 服务入口
│   │   ├── config/         # 配置（数据库、运行时参数）
│   │   ├── entities/       # TypeORM 实体定义
│   │   │   ├── harvester/  # Harvester/KubeVirt 相关实体
│   │   │   ├── kubeovn/    # KubeOVN 网络实体
│   │   │   ├── kubevirt/   # KubeVirt 虚拟化实体
│   │   │   ├── vRouter/    # 虚拟路由器实体
│   │   │   └── *.ts        # 业务实体（云、租户、用户等）
│   │   ├── routes/         # API 路由
│   │   ├── services/       # 业务服务层
│   │   ├── middleware/     # 中间件（认证、审计、错误处理）
│   │   ├── ws/             # WebSocket 服务（SSH/VNC/KubeVirt）
│   │   └── utils/          # 工具函数
│   └── package.json
├── frontend/               # 前端应用
│   ├── src/
│   │   ├── App.tsx         # 应用入口
│   │   ├── components/     # 公共组件
│   │   ├── pages/          # 页面组件
│   │   │   ├── Access/     # 权限管理
│   │   │   ├── Clouds/     # 云资源管理
│   │   │   ├── Dashboard/  # 仪表盘
│   │   │   ├── InterConnect/ # 互联互通
│   │   │   ├── SecMgrPlane/ # 安全管理面
│   │   │   ├── SecOps/     # 安全运营
│   │   │   ├── Settings/   # 系统设置
│   │   │   └── Tenants/    # 租户管理
│   │   ├── services/       # API 服务层
│   │   ├── contexts/       # React Context
│   │   ├── hooks/          # 自定义 Hooks
│   │   ├── constants/      # 常量定义
│   │   └── utils/          # 工具函数
│   └── package.json
├── scripts/                # 工具脚本
└── tools/                  # 外部工具
```

## 构建与运行

### 环境要求
- Node.js 18+
- npm 或 yarn

### 后端

```bash
cd backend
npm install
npm run dev      # 开发模式 (端口 5001)
npm run build    # 编译
npm run start    # 生产模式
```

### 前端

```bash
cd frontend
npm install
npm run start    # 开发模式 (端口 5000)
npm run build    # 生产构建
```

### 环境变量

**后端**:
- `PORT`: 服务端口 (默认 5001)
- `JWT_SECRET`: JWT 密钥
- `DB_PATH`: SQLite 数据库路径
- `NODE_ENV`: 环境标识 (development/production)

**前端**:
- `REACT_APP_API_URL`: 后端 API 地址
- `HOST`: 监听地址
- `PORT`: 服务端口

## API 规范

### 路由前缀
- `/api/auth`: 认证相关
- `/api/users`: 系统用户管理
- `/api/clouds`: 云资源管理
- `/api/tenants`: 租户管理
- `/api/vr-config`: 虚拟路由器配置
- `/api/networks/*`: SDN 网络能力
- `/api/security-domains`: 安全域管理
- `/api/system`: 系统配置

### WebSocket 路径
- `/ws/ssh`: WebSSH 终端
- `/ws/vnc`: WebVNC 远程控制
- `/ws/kv-vnc`: KubeVirt VNC
- `/ws/kv-pod-log`: KubeVirt Pod 日志

## 认证与权限

### 用户角色
- `super_admin`: 超级管理员 (全部权限)
- `admin`: 管理员
- `tenant`: 租户用户
- `sase_device`: SASE 设备

### 权限系统
采用 RBAC (基于角色的访问控制)，权限通过 `permissions` 数组传递，`*` 表示全部权限。

### Token 存储
前端 Token 存储使用 `utils/tokenStorage`，支持 localStorage 和 sessionStorage。

## 开发规范

### 命名约定
- **组件文件**: PascalCase (如 `PageContainer.tsx`)
- **工具文件**: camelCase (如 `harvesterUtils.ts`)
- **类型文件**: camelCase (如 `cloud.ts`)
- **常量文件**: camelCase (如 `pagination.ts`)

### API 调用
使用 `services/` 下的 API 服务函数，统一使用 `requestManager` 进行请求管理（支持去重、缓存、重试）。

### 组件开发
- 公共逻辑提取到 `components/` 或 `hooks/`
- 使用 TypeScript 类型定义，放在 `types/`
- 所有 API 调用通过 `services/` 层

### 页面模板组件

前端页面开发遵循三层容器结构：

| 组件 | 路径 | 用途 |
|------|------|------|
| `PageContainer` | `components/PageContainer.tsx` | 列表页面容器，如资源池管理页面 |
| `PageDetailContainer` | `components/PageDetailContainer.tsx` | 详情页容器，如某个资源池详情页 |
| `PageDetailSection` | `components/PageDetailSection.tsx` | 详情页 Tab 区块，如弹性计算、块存储等 |

**使用示例**：

```tsx
// 1. 列表页面 (PageContainer)
<PageContainer
  title="资源池管理"
  icon={<CloudOutlined />}
  primaryAction={{ text: '新增', onClick: handleAdd }}
  onRefresh={handleRefresh}
  tableProps={{ columns, dataSource, rowKey: 'id' }}
/>

// 2. 详情页面 (PageDetailContainer)
<PageDetailContainer
  title={cloud.name}
  icon={<CloudOutlined />}
  onBack={() => navigate(-1)}
  tabs={[
    { key: 'compute', label: '弹性计算', children: <ComputeTab /> },
    { key: 'storage', label: '块存储', children: <StorageTab /> },
  ]}
/>

// 3. Tab 区块内容 (PageDetailSection)
<PageDetailSection
  title="虚拟机列表"
  toolbarLeft={<Input.Search placeholder="搜索" />}
  onRefresh={handleRefresh}
>
  <Table columns={columns} dataSource={vms} />
</PageDetailSection>
```

### API 开发原则

开发功能对接标准实体时，遵循以下原则：

1. **优先使用标准 API**: 项目已整理的标准 API 文档位于 `docs/` 目录
   - `harvester-api-reference.md` - Harvester 虚拟化 API
   - `kubernetes-container-api-reference.md` - Kubernetes 容器 API

2. **发现缺失先核对**: 如果发现缺少某个接口，先提出来核对：
   - 是否实际存在该接口，只是未总结到文档
   - 是否可以用其他接口替代
   - 确认后再决定是否需要新增

3. **避免重复造轮子**: 不要一上来就从零开始开发，优先复用已有的 API 和代码

### 全局样式
通用 CSS 样式文件：`frontend/src/global-new.css`

### Ant Design 表格固定列
使用 columns 配置中的 `fixed` 属性（'left' 或 'right'），配合 Table 的 `scroll={{ x: 宽度 }}` 属性。

```tsx
const columns = [
  { title: '任务ID', fixed: 'left', width: 100, dataIndex: 'id' },
  // ...其他列
  { title: '操作', fixed: 'right', width: 150 }
];

<Table columns={columns} scroll={{ x: 1200 }} />
```

## 平台模块

| 平台 | 代码 | 说明 |
|------|------|------|
| 多云管理 | CNMC | 云资源、云主机、云网络 |
| SDN管理 | SDNCC | SRv6、IPsec、ACL、NAT、VR |
| AI SOC中心 | CNSOC | 安全运营、威胁分析、报告 |
| 系统设置 | SETTINGS | 用户、租户、权限、审计 |

## 注意事项

1. **数据库**: 使用 SQLite，生产环境建议迁移到 PostgreSQL/MySQL
2. **安全**: 修改默认 `JWT_SECRET`，生产环境收紧 CORS 配置
3. **内存**: 前端设置了 `--max-old-space-size=4096` 以支持大型应用
4. **代理**: 开发环境前端通过 `setupProxy.js` 代理后端 API
