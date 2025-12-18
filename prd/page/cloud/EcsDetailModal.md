# ECS实例详情页面-组件设计
设计一个通用组件，可约束各个云平台的ecs 实例 详情展示效果
组件文件路径：frontend\src\components\EcsInsDetContainer.tsx

## ECS实例概览表格
- 此处通过路由显示对应云平台的 ECS 详情章节
- 例如此ECS实例为阿里云实例，则应显示\pages\Clouds\Aliyun\section\EcsInsDetSection.tsx的内容
- Aliyun/Sections/EcsInsDetSection，内容是适用于阿里云的云主机概览表格，里面所有的字段都是跟随阿里云提供的信息进行设计

## ECS实例资源tabs
### 云硬盘
- 此处通过路由显示对应云平台的云硬盘详情章节
- 例如此ECS实例为阿里云实例，则应显示\pages\Clouds\Aliyun\section\DiskSection.tsx的内容
- DiskSection，内容是适用于阿里云的云硬盘概览表格，里面所有的字段都是跟随阿里云提供的信息进行设计
### 弹性网卡
- 此处通过路由显示对应云平台的弹性网卡详情章节
- 例如此ECS实例为阿里云实例，则应显示\pages\Clouds\Aliyun\section\NetworkInterfaceSection.tsx的内容
- NetworkInterfaceSection，内容是适用于阿里云的弹性网卡概览表格，里面所有的字段都是跟随阿里云提供的信息进行设计
### 弹性IP
- 此处通过路由显示对应云平台的弹性IP详情章节
- 例如此ECS实例为阿里云实例，则应显示\pages\Clouds\Aliyun\section\EipAddressSection.tsx的内容
- EipAddressSection，内容是适用于阿里云的弹性IP概览表格，里面所有的字段都是跟随阿里云提供的信息进行设计
### 安全组
- 此处通过路由显示对应云平台的安全组详情章节
- 例如此ECS实例为阿里云实例，则应显示\pages\Clouds\Aliyun\section\SecurityGroupSection.tsx的内容
- SecurityGroupSection，内容是适用于阿里云的安全组概览表格，里面所有的字段都是跟随阿里云提供的信息进行设计
### 监控
- 此处通过路由显示对应云平台的监控详情章节
- 例如此ECS实例为阿里云实例，则应显示\pages\Clouds\Aliyun\section\MonitorSection.tsx的内容
- MonitorSection，内容是适用于阿里云的监控概览表格，里面所有的字段都是跟随阿里云提供的信息进行设计
### 审计日志
- 此处通过路由显示对应云平台的审计日志详情章节
- 例如此ECS实例为阿里云实例，则应显示\pages\Clouds\Aliyun\section\AuditLogSection.tsx的内容
- AuditLogSection，内容是适用于阿里云的审计日志概览表格，里面所有的字段都是跟随阿里云提供的信息进行设计
### 云备份
- 此处通过路由显示对应云平台的云备份详情章节
- 例如此ECS实例为阿里云实例，则应显示\pages\Clouds\Aliyun\section\BackupSection.tsx的内容
- BackupSection，内容是适用于阿里云的云备份概览表格，里面所有的字段都是跟随阿里云提供的信息进行设计

---------------------------------------------------------------------------------------------------------------
**构成概览**
- 页面入口：在实例列表点击“详情”后打开 `EcsDetailModal`，承载数据加载与标签组装
- 公共容器：`ResourceDetailContainer` 统一控制弹窗布局与 Tabs 标签样式
- 概览区：`EcsInsDetSection` 作为顶部资源概览（若未提供则显示默认提示）
- 标签内容：若干 Aliyun `section` 组件（网卡、EIP、磁盘、监控、审计）按 Tab 呈现
- 等待与加载：各数据源在弹窗打开时异步加载；部分表格或监控卡片具备局部加载状态

**页面与文件**
- 弹窗页面
  - `d:\computer.tower\frontend\src\pages\Clouds\Aliyun\modals\EcsDetailModal.tsx`：主页面，负责数据获取、状态管理、Tabs 组装
- 公共容器
  - `d:\computer.tower\frontend\src\components\ResourceDetailContainer.tsx`：统一弹窗标题、主体布局、Tabs 标签样式渲染
- 概览组件
  - `d:\computer.tower\frontend\src\pages\Clouds\Aliyun\sections\EcsInsDetSection.tsx`：实例基础信息、IP、规格等概览（作为 `overviewNode`）

**数据加载与状态**
- 云与实例信息
  - 获取云列表与厂商：`EcsDetailModal.tsx:39-49`
  - 加载实例并归一化聚合库存与云端数据：`EcsDetailModal.tsx:51-82`
- 关联资源
  - ENI：`EcsDetailModal.tsx:84-99`
  - EIP：`EcsDetailModal.tsx:100-114`
  - 安全组：`EcsDetailModal.tsx:115-122`
  - 磁盘与快照：`EcsDetailModal.tsx:123-138`
  - 监控与审计事件：`EcsDetailModal.tsx:139-156`
- 打开时批量加载
  - `EcsDetailModal.tsx:158-160` 在 `open` 为真时调用各加载函数

**容器与样式**
- 容器渲染弹窗与统一标题
  - 标题：`ResourceDetailContainer.tsx:95`，采用通用“详情 · 实例名/ID”
- Tabs 标签的公共样式控制
  - 统一渲染逻辑：`ResourceDetailContainer.tsx:88-106`
  - 图标颜色固定 `#1677FF`；数量仅在 `> 0` 时显示；结构为“Icon + 标题 + 数量”
  - 容器根据每个 tab 的 `labelMeta` 与 `count` 生成最终 `label` 并传给 `Tabs`

**标签与 sections**
- 统一的可见标签集合
  - `EcsDetailModal.tsx:168` 定义：`['network','eips','disks','backup','secgroups','monitor','audit']`
- Tabs 项组装（从各 section 的 `tabMeta` 获取标题与图标；在弹窗计算 `count`）
  - 组装入口：`EcsDetailModal.tsx:191-314`
  - 为每个项传入 `labelMeta` 与 `count`，容器负责最终样式渲染
- 各标签的内容组件
  - 网卡：`NetworkInterfaceSectionAliyun` `d:\computer.tower\frontend\src\pages\Clouds\Aliyun\sections\NetworkInterfaceSectionAliyun.tsx:257-258`
  - EIP：`EipAddressSectionAliyun` `d:\computer.tower\frontend\src\pages\Clouds\Aliyun\sections\EipAddressSectionAliyun.tsx:262-263`
  - 磁盘：`DiskSectionAliyun` `d:\computer.tower\frontend\src\pages\Clouds\Aliyun\sections\DiskSectionAliyun.tsx:267-268`
  - 备份：弹窗内表格视图 `EcsDetailModal.tsx:270-286`
  - 安全组：弹窗内表格视图 `EcsDetailModal.tsx:287-301`
  - 监控：`MonitorSectionAliyun` `d:\computer.tower\frontend\src\pages\Clouds\Aliyun\sections\MonitorSectionAliyun.tsx:306-307`
  - 审计：`AuditLogSectionAliyun` `d:\computer.tower\frontend\src\pages\Clouds\Aliyun\sections\AuditLogSectionAliyun.tsx:310-311`

**概览区**
- 概览节点传入容器
  - `EcsDetailModal.tsx:190` 使用 `EcsInsDetSection` 作为 `overviewNode`
  - 容器内显示默认提示（当 `overviewNode` 为空时）：`ResourceDetailContainer.tsx:100-106`

**交互与刷新**
- 容器层
  - 监控标签延迟激活刷新：`ResourceDetailContainer.tsx:97` 在打开且当前 tab 为 `monitor` 时，`300ms` 后触发 `onRefreshMonitor`
  - Tabs 切换与额外工具栏：`ResourceDetailContainer.tsx:108`
- 弹窗层
  - 一键刷新所有资源：`EcsDetailModal.tsx:185` 触发并提示成功
- sections 层
  - 表格加载状态与手动刷新（如磁盘）：`DiskSectionAliyun.tsx:21-33, 57-77`
  - 监控指标载入与自动刷新控制：`MonitorSectionAliyun.tsx:30-50, 121-123`

**小结**
- 架构分层明确：弹窗页面负责数据与标签组装，公共容器统一样式与布局，各 `section` 专注具体视图与操作。
- 如果后续要让其他云厂商复用统一标签样式，只需在其详情弹窗按同样方式传入 `labelMeta` 与 `count`，无需改动各 `section` 的内容渲染。