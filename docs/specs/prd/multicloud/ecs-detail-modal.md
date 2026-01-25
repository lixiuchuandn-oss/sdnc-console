# ECS实例详情页面-组件设计

> **说明**：本设计文档主要描述 ECS 详情页的组件架构与复用模式。目前以 **阿里云 (Aliyun)** 实现为标准模版，其他云厂商（如 Huawei、Tencent）应复用此架构模式。

## 1. 核心架构设计

ECS 详情页采用 **"容器 (Shell) + 编排 (Orchestrator) + 积木 (Sections)"** 的分层架构：

*   **公共容器 (`ResourceDetailContainer`)**: 负责弹窗骨架、统一 Header、Tabs 样式、加载状态管理。所有云资源的详情页都应使用此容器。
*   **编排组件 (`EcsDetailModal`)**: 负责具体云厂商的数据获取、状态聚合、Tab 组装逻辑。
*   **内容积木 (`Sections`)**: 独立的业务展示组件（如磁盘列表、网卡列表），只负责渲染传入的数据。

### 文件路径映射

| 组件角色 | 说明 | 实际文件路径 |
| :--- | :--- | :--- |
| **公共容器** | 详情页骨架 | `frontend\src\components\ResourceDetailContainer.tsx` |
| **编排组件** | 阿里云 ECS 详情页入口 | `frontend\src\pages\Clouds\Aliyun\modals\EcsDetailModal.tsx` |
| **概览组件** | 实例基础信息概览 | `frontend\src\pages\Clouds\Aliyun\sections\EcsInsDetSection.tsx` |
| **网卡组件** | 弹性网卡列表 | `frontend\src\pages\Clouds\Aliyun\sections\NetworkInterfaceSectionAliyun.tsx` |
| **磁盘组件** | 云硬盘列表 | `frontend\src\pages\Clouds\Aliyun\sections\DiskSectionAliyun.tsx` |
| **EIP 组件** | 公网 IP 列表 | `frontend\src\pages\Clouds\Aliyun\sections\EipAddressSectionAliyun.tsx` |
| **监控组件** | 云监控图表 | `frontend\src\pages\Clouds\Aliyun\sections\MonitorSectionAliyun.tsx` |
| **审计组件** | 操作日志 | `frontend\src\pages\Clouds\Aliyun\sections\AuditLogSectionAliyun.tsx` |

---

## 2. 详细功能模块

### 2.1 ECS实例概览 (Overview)
*   **组件**: `EcsInsDetSection`
*   **位置**: 弹窗顶部，始终可见。
*   **内容**: 实例 ID/名称、状态（运行中/停止）、规格（vCPU/内存）、操作系统、IP 地址（公网/私有/EIP）、安全组摘要、计费到期时间等。
*   **数据源**: `EcsDetailModal` 聚合了 `fetchInventoryInstancesByCloud` (本地库存) 与 `fetchCloudProviderEcs` (云端实时) 的数据。

### 2.2 资源 Tabs 设计

#### 云硬盘 (Disks)
*   **文件**: `DiskSectionAliyun.tsx`
*   **逻辑**: 展示挂载到该实例的系统盘与数据盘。支持表格内的简单操作（如卸载/挂载，视能力而定）。

#### 弹性网卡 (Network Interfaces)
*   **文件**: `NetworkInterfaceSectionAliyun.tsx`
*   **逻辑**: 展示主网卡与辅助网卡。包含内网 IP、MAC 地址、关联的安全组等信息。

#### 弹性IP (EIPs)
*   **文件**: `EipAddressSectionAliyun.tsx`
*   **逻辑**: 专门展示绑定的 EIP 资源。若实例只有公网 IP 无 EIP，则此 Tab 可能为空或仅展示公网 IP 信息。

#### 安全组 (Security Groups)
*   **实现方式**: 目前在 `EcsDetailModal` 内部直接使用 `Table` 渲染，未拆分为独立文件（可优化）。
*   **逻辑**: 列出实例所属的安全组规则摘要。

#### 监控 (Monitor)
*   **文件**: `MonitorSectionAliyun.tsx`
*   **逻辑**: 对接云厂商监控 API (`fetchAliyunEcsMetrics`)。
*   **特性**: 支持时间范围选择（1小时/6小时/1天），支持自动刷新。容器组件在 Tab 切换到 Monitor 时会触发延迟加载。

#### 审计日志 (Audit Logs)
*   **文件**: `AuditLogSectionAliyun.tsx`
*   **逻辑**: 展示该实例相关的操作记录（启动、停止、重启等）。

---

## 3. 数据流与状态管理 (Implementation Details)

### 3.1 初始化与加载
1.  **打开弹窗**: 用户点击列表“详情”，`EcsDetailModal` 接收 `open=true`。
2.  **并行加载**: `useEffect` 触发 `loadInstance`，同时触发 `loadEnis`, `loadEips`, `loadDisks` 等。
3.  **Loading 状态**: `ResourceDetailContainer` 接收 `loading` 属性，统一显示骨架屏或 Spin。

### 3.2 归一化处理
*   **多源合并**: `loadInstance` 会尝试同时获取本地数据库缓存 (`Inventory`) 和云端 API (`Provider`) 数据，并进行合并，优先显示云端最新状态。
*   **厂商兼容**: 虽然代码位于 Aliyun 目录下，但 `loadInstance` 包含针对 `tencentcloud`, `huaweicloud`, `harvester` 的简单数据结构适配逻辑（建议后续拆分）。

### 3.3 Tab 渲染逻辑
*   `EcsDetailModal` 计算每个 Section 的 `count` (例如磁盘数量、网卡数量)。
*   将 `tabMeta` (图标、标题) 和 `count` 传递给 `ResourceDetailContainer`。
*   容器自动过滤掉数量为 0 的 Tab（除非强制显示），并渲染带数字徽标的 Tab 标签。

## 4. 优化建议 (TODO)

1.  **安全组组件拆分**: 将 `EcsDetailModal` 内嵌的安全组表格拆分为独立的 `SecurityGroupSectionAliyun.tsx`，保持代码整洁。
2.  **厂商逻辑解耦**: `loadInstance` 中的 `if (p === 'tencentcloud')` 等逻辑应剥离到各厂商的 Adapter 或 Service 中，保持 Modal 纯净。
3.  **能力驱动 (Capability Driven)**: 目前 Tab 的显示主要依赖数据是否为空。未来应结合 `capabilities` 系统，如果云厂商不支持某项能力（如无 EIP），则直接不加载该 Tab。
