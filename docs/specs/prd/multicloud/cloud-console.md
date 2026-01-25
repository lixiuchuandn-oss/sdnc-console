# 云资源控制台 PRD

> **说明**：本文档描述多云资源控制台（Cloud Console）的产品需求与交互设计。该模块是多云管理的核心入口，负责聚合展示和操作不同云厂商（Aliyun, Huawei, Tencent, Harvester）的资源。

## 1. 背景与目标
- **聚合管理**：在同一控制台聚合多云厂商的资源，提供统一的查看与操作体验。
- **能力驱动**：利用 Capability 系统（见 `01-capability-driven-ui.md`）动态调整界面（列显示、按钮可用性），屏蔽底层差异。
- **支持厂商**：阿里云（Aliyun）、华为云（Huaweicloud）、腾讯云（Tencentcloud）、Harvester、CloudMap Edge/Private/Security。

## 2. 页面架构与导航

### 2.1 布局结构
- **左侧导航树**：
  - 按“云厂商”或“区域”分组展示已接入的云资源池。
  - 节点代表具体资源池（Cloud Account），点击切换右侧上下文。
  - 代码入口：[`CloudConsole.tsx`](file:///d%3A/ComputeTower/Compute.Tower/frontend/src/pages/Clouds/CloudConsole.tsx) (替代了旧的 `ECS.tsx`)。
- **右侧工作区**：
  - **顶部栏**：显示当前资源池名称、状态概览。
  - **工具栏**：关键字搜索、状态筛选、刷新按钮、批量操作菜单。
  - **资源标签页 (Tabs)**：云主机 (ECS)、专有网络 (VPC)、弹性公网IP (EIP)、云硬盘 (Disk)、弹性网卡 (ENI)。

## 3. 云主机 (ECS) 核心功能

### 3.1 列表与筛选
- **筛选器**：
  - **关键字**：名称/ID 模糊匹配。
  - **状态**：快捷筛选（运行中/已停止/异常）。
  - **Harvester 专属**：按 Namespace 或 Node 分组查看。
- **列表列 (能力驱动)**：
  - **基础列**：名称/ID、状态、IP地址（私网/公网）、创建时间、操作。
  - **动态列**：
    - `compute.instanceType` -> 显示“规格”列。
    - `compute.zone` -> 显示“可用区”列。
    - `network.vpc` -> 显示“VPC”列。

### 3.2 操作交互
- **单机操作**：
  - **生命周期**：启动、停止、重启、删除（受 `compute.lifecycle.*` 能力控制）。
  - **远程连接**：
    - **VNC**: 调用厂商控制台 URL 或 WebVNC。
    - **SSH**: 唤起 WebSSH 终端。
- **批量操作**：
  - 基于复选框的多选操作，支持批量启动/停止/重启。

## 4. 关联资源视图

各 Tab 页加载对应资源列表，同样遵循能力驱动原则：

| 资源类型 | 对应数据源字段 (示例) | 能力键 |
| :--- | :--- | :--- |
| **VPC** | `json.data.Vpcs.Vpc` | `network.vpc` |
| **EIP** | `json.data.Eips.Eip` | `network.eip` |
| **Disk** | `json.data.Disks.Disk` | `storage.disk` |
| **ENI** | `json.data.Enis.Eni` | `network.eni` |

## 5. 技术实现参考

### 5.1 关键文件映射
- **主入口**：[`CloudConsole.tsx`](file:///d%3A/ComputeTower/Compute.Tower/frontend/src/pages/Clouds/CloudConsole.tsx) (页面骨架与状态管理)
- **详情弹窗**：[`CloudDetail.tsx`](file:///d%3A/ComputeTower/Compute.Tower/frontend/src/pages/Clouds/CloudDetail.tsx) (旧版详情页，逐步迁移中)
- **API 服务**：`frontend/src/services/api.ts` (统一后端接口调用)

### 5.2 数据加载策略
1.  **Cloud List**: `loadClouds` 获取所有资源池。
2.  **Instance List**: `loadEcs` 根据选中的 `cloudId` 加载实例数据。
3.  **Capabilities**: 后端接口返回 `capabilities` 对象，前端 `setCaps` 存储并在渲染时消费。

## 6. 验收标准
- [ ] **多云适配**：Aliyun/Huawei/Harvester 均能正常加载列表。
- [ ] **能力生效**：Harvester 不应显示 VPC 列（若不支持）；Aliyun 应显示完整列。
- [ ] **操作反馈**：点击启动/停止应有 Loading 状态和成功/失败提示。
- [ ] **空状态**：无数据或加载失败时应有友好提示。
