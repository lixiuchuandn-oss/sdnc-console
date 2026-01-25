# Harvester 适配说明（基于能力驱动框架）

## 1. 关系与原则
- 本文是多云“资源适配层”中的 Harvester Provider 适配指南，遵循统一能力 Schema、命名规范、适配器契约与注册中心策略。
- 前端只消费能力对象（`capabilities`），不在页面写死厂商分支。

## 2. 能力映射
- **计算**：
  - `compute.instanceType=false`、`compute.zone=false`
  - `compute.lifecycle.start|stop|reboot|delete=true`（管理员）
- **网络**：
  - `network.vpc=true`（Kube-OVN）
  - `network.subnet=true`（Kube-OVN 子网）
  - `network.fusion=true`（融合展示 VPC/Subnet/NAD）
  - `provider.harvester.multus=true`（Multus/NAD）
- **存储**：
  - `storage.disk=false`、`storage.snapshot=false`（按当前实现）

## 3. 数据与操作适配
- **列表数据统一**：`InstanceId` 标准化为 `namespace/name`；状态与 IP 字段按统一模型输出。
- **生命周期操作**（统一 ECS 入口）：
  - `POST /api/clouds/:id/resources/ecs/:instanceId/start|stop|reboot`
  - `DELETE /api/clouds/:id/resources/ecs/:instanceId`
- **Harvester 动作 API**：
  - `POST /v1/harvester/kubevirt.io.virtualmachines/{namespace}/{name}?action=start|stop|restart`
  - `DELETE /v1/harvester/kubevirt.io.virtualmachines/{namespace}/{name}`
- **命名空间解析**：优先 `InstanceId`，必要时回查列表补全。
- **TLS 与认证**：`Authorization: Bearer`；自签支持 `rejectUnauthorized: false`。
- **权限控制**：写操作统一走管理员权限中间件。

## 4. 前端消费与展示
- **差异列**：命名空间、所属主机、网络（融合）、镜像、vCPU/内存分配、已用 CPU/内存。
- **能力驱动**：按钮禁用/列展示完全依赖能力对象。
- **网络融合**：统一展示 Kube-OVN（VPC/Subnet/IP）与 Multus/NAD 名称。

## 5. 错误与状态处理
- 操作返回可能是非 JSON 文本，前端统一消息提示。
- 状态兼容 `printableStatus/phase/state` → 统一 `Status`；IP 兼容 `vmIp/interfaces[0].ipAddress`。

---

## 6. 性能优化设计（本地缓存 + SSE）

### 6.1 设计目标
在“网络差/外部 API 慢”的场景下降低前端首屏等待和交互抖动，采用“后端采集 + 本地库快读 + SSE 推送”替代“每次直连 Harvester/K8s”模式。

### 6.2 采集策略
- **定时采集入库**：每个资源池（`cloudId`）启动一个采集调度器。
  - `VM`：3–5 秒（高频）
  - `Nodes`：5–10 秒
  - `Volumes`：10–30 秒
  - `Images/NAD`：30–60 秒
  - `Kube-OVN`：60–120 秒
- **机制**：分资源类型并行、统一限速、错误退避、无变化不写库。

### 6.3 数据库模型 (Harvester 专属)
不依赖跨云通用表，建立 Harvester 专属表以承载完整字段。所有表均包含 `cloudId` 分区键。

- **`harvester_vms`**:
  - 唯一键：`cloudId + namespace + name`
  - 规范化字段：`status`, `runStrategy`, `nodeName`, `image`, `cpuAlloc`, `memoryAlloc` 等。
  - JSON 字段：`netIfaces`, `volumes`, `rawSpecJson`。
- **其他表**：`harvester_nodes`, `harvester_volumes`, `harvester_images`, `harvester_nads`。

### 6.4 数据推送 (SSE)
- **源切换**：SSE 改为从本地库扫描增量推送，而非每次直连集群。
- **增量机制**：扫描 `updatedAt > lastSentAt` 的记录，生成事件包。
- **前端兼容**：前端订阅逻辑无需修改，仅数据源变更为准实时的本地库。

### 6.5 单项刷新
- **场景**：详情页打开或操作后。
- **接口**：`POST /api/clouds/:id/resources/harvester/vms/:namespace/:name/refresh`。
- **行为**：直连拉取该项 -> 入库 -> 广播 SSE 事件。

## 7. 验证与测试建议
- 管理员角色在资源池详情页与聚合页，对 Harvester VM 执行生命周期操作，确认提示与列表刷新。
- 后端健康 `GET /health`；自签环境开启 `ignoreTls`。
