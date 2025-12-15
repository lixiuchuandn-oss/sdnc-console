        
**设计概览**
- 目标：在“网络差/外部 API 慢”的场景下降低前端首屏等待和交互抖动，用“后端采集 + 本地库快读 + SSE 推送”替代“每次直连 Harvester/K8s”的模式。
- 原则：准实时即可，牺牲少量一致性换取稳定与速度；对变化敏感的资源（VM 状态）更高频，低变化资源（镜像、NAD、Kube-OVN）更低频。
- 现状参考：当前 VM 已有 SSE 推送，直接轮询外部集群每 3 秒生成增量事件（`backend/src/routes/clouds.harvester.ts:58-109`，前端订阅 `frontend/src/pages/Clouds/Harvester/CloudDetailHarvester.tsx:109-183`）。

**定时采集**
- 采集范围与频率建议（按资源类型灵活配置，可动态回退）
  - `VM`：3–5 秒（状态变化频繁、对前端体验影响最大）
  - `Nodes`：5–10 秒（节点数较少、变化不频繁）
  - `Volumes`：10–30 秒（容量与挂载变化较少）
  - `Images`、`NAD`：30–60 秒（新增/删除密度低）
  - `Kube-OVN VPC/Subnet`：60–120 秒（网络拓扑变化低）
  - `GPU/USB`：30–60 秒（资源标识变化低）
- 采集器设计
  - 每个资源池（`cloudId`）启动一个采集调度器，持有安全参数（`endpoint`/`token`/`ignoreTls`），从 `Cloud` 取（`backend/src/routes/clouds.harvester.ts:7-12`）。
  - 分资源类型并行、统一限速，Promise 池并发控制（如 5 并发），避免“雪崩/群体惊群”。
  - 错误退避：指数回退至 60–120 秒，上线后记录平均耗时与失败率用于动态调参。
  - 去重与幂等：使用“规范化主键 + 哈希/资源版本”决定是否写库；无变化不写库。
  - 全量到库、增量事件：第一次全量入库，之后仅对变化项 upsert + 写入更新戳，供 SSE 快速取增量。
- 外部访问参考：已存在稳定的取数工具（`getJsonOnce` 等，`backend/src/services/clouds/harvester/resources.ts:1-16`），沿用即可。

**数据库模型**
- 存储引擎与实体系统：TypeORM + SQLite（`backend/src/config/database.ts:1-17`）。可直接启用 `synchronize` 在非生产环境自动迁移。
- 优先方案：复用“跨云通用清单表”作为 Harvester VM 的规范化快照，再加一个 Harvester 详情表承载专有字段。
  - 基表：`cloud_instance_inventory`（已存在，`backend/src/entities/CloudInstanceInventory.ts:1-73`）
    - 字段要点：`cloudId`、`provider`、`instanceId`（Harvester 统一为 `namespace/name`）、`instanceName`、`status`、`cpu`、`memoryGb`、`privateIps`、`networks` 等
    - 索引：`cloudId`、`provider`、`instanceId` 已有索引，满足按资源池与实例的查找
  - 详情表（新增）：`harvester_vm_detail`
    - 主键：`id`（uuid）
    - 唯一索引：`cloudId + instanceId`
    - 规范化字段
      - `cloudId`、`provider='harvester'`
      - `instanceId`（`namespace/name`）、`namespace`、`name`
      - `status`（统一态：`Running/Stopped/Pending/...`）、`runStrategy`
      - `nodeName`、`image`（显示名/源）
      - `cpuAlloc`、`memoryAlloc`（如请求/限制或规格）
      - `gpuMode`、`gpuResource`、`gpuCount`
      - `netIfaces`（JSON，含 NAD 名称、IP、MAC）
      - `volumes`（JSON，含 pvcName、size、bus）
      - `createdAtIso`（来自集群）、`lastSeenAtIso`
      - `resourceVersion` 或 `specHash/statusHash`（用于变化检测）
      - `isDeleted`（软删除标志，便于 SSE 下发“删除事件”与审计）
    - 原始字段（TEXT 存 JSON）
      - `rawSpecJson`、`rawStatusJson`、`rawExtraJson`（保留原始对象以便详情页与排障）
    - 索引
      - `cloudId`、`namespace`、`nodeName`、`status`、`updatedAt`
- 其他资源（Nodes/Volumes/Images/NAD/Kube-OVN）可以采用“各自一张表”或“通用 `cloud_resource_snapshot` + type 字段”的策略；首期可仅落库 VM + Nodes + Volumes，其余仍直连，渐进替换。

**SSE 推送**
- 数据源切换：SSE 改为从本地库推送，而非每次直连集群
  - 路由示例：`GET /api/clouds/:id/resources/ecs/stream` 保持不变，对应实现由“外部轮询”改为“库中增量扫描”
  - 增量机制：服务端保存 `lastSentAt` 与上一轮的 `instanceId -> statusHash` 映射；查询 `updatedAt > lastSentAt` 的记录生成 `vm_created/vm_status/vm_deleted/vms` 事件包
  - 客户端协议：沿用现有事件名与数据结构，前端无需改动订阅逻辑（`frontend/src/pages/Clouds/Harvester/CloudDetailHarvester.tsx:109-183`）
- 推送频率：2–3 秒（库内扫描比外部 API 快得多）；并在高订阅量时对每个 `cloudId` 合并批量事件，降低写入频次。

**单项更新**
- 即时触发：提供“单项刷新”路由，对某实例或某资源进行外部直连刷新并落库
  - 例如：`POST /api/clouds/:id/resources/harvester/vms/:namespace/:name/refresh`
  - 行为：直连 Harvester/K8s 获取该资源，计算变化并 upsert；随后 SSE 立刻广播该实例的增量事件
- 使用场景：详情页打开、执行生命周期操作后、用户点“刷新该项”

**性能与一致性**
- 采集优雅性：定时采集是云控控制台的常见做法；本地库快读能显著降低用户等待与跨网络波动。
- 性能风险与缓解
  - 外部 API 压力：分资源类型调度、并发控制、指数回退、随机抖动（jitter）、错峰启动
  - 库写入：批量 upsert、无变化不写、事务批次化；索引按查询路径建立，避免全表扫
  - SSE 背压：按云池合并事件、限频；客户端掉线回补使用 `vms` 全量事件
- 一致性取舍：最多 3–60 秒的延迟；VM 状态采用高频采集保障关键交互；其他资源可接受更大的刷新间隔
- 未来优化：如果可用，优先启用 K8s `watch`（减少拉取与延迟）；或在 Harvester 仪表盘提供事件订阅通道后改用原生事件流

**前端影响**
- 列表页：首屏数据来自本地库，显著减少 `loadAll()` 的跨域等待（`frontend/src/pages/Clouds/Harvester/CloudDetailHarvester.tsx:57-107`）；SSE 保持原订阅，体验一致。
- 详情抽屉与“单项刷新”：新增“刷新该项”按钮调用单项刷新路由；其余操作不变。
- 差异提示：在页面顶部标注“数据为准实时，轻微延迟”，必要时为敏感操作提供“强制直连刷新”按钮。

**表结构示例（Harvester 云主机）**
- 表：`harvester_vm_detail`
  - 关键主键与约束：`id`（uuid），唯一(`cloudId`, `instanceId`)
  - 规范化列：`cloudId`、`provider`、`instanceId`、`namespace`、`name`、`status`、`runStrategy`、`nodeName`、`image`、`cpuAlloc`、`memoryAlloc`、`gpuMode`、`gpuResource`、`gpuCount`、`createdAtIso`、`lastSeenAtIso`、`resourceVersion`、`isDeleted`
  - JSON 列（TEXT）：`netIfaces`、`volumes`、`rawSpecJson`、`rawStatusJson`、`rawExtraJson`
  - 索引：`cloudId`、`namespace`、`nodeName`、`status`、`updatedAt`
- 兼容共表：同步更新 `cloud_instance_inventory`（规范化跨云视图），保证跨云聚合页一致的字段消费

**与现有代码的衔接**
- 现有 SSE（外部直连）位置：`backend/src/routes/clouds.harvester.ts:58-109`
- 现有前端订阅位置：`frontend/src/pages/Clouds/Harvester/CloudDetailHarvester.tsx:109-183`
- 现有直连查询工具：`backend/src/services/clouds/harvester/resources.ts:1-16`
- 现有数据库与实体：`backend/src/config/database.ts:1-17`、`backend/src/entities/CloudInstanceInventory.ts:1-73`

**总结**
- 你的 1–4 点方案是可行且优雅的工程化折中：后端定时采集入库+SSE 从库推送，前端首屏与交互显著提速；一致性延迟可控。
- 我建议先落库 VM（含状态）、Nodes、Volumes 三类作为第一阶段，观测负载后再拓展；采集频率按资源池规模与稳定性动态调参。后续如条件允许再切换到 K8s watch 降低外部轮询成本。

如果确认方案，我再补充实体字段与索引的精确定义、采集器的接口契约、SSE 增量协议，以及路由草案，保持与现有代码风格一致并分阶段提交变更。

**答复**
- 是的，不需要勉强做跨云聚合。当前阶段可以完全采用“Harvester 专属表 + 本地采集 + 本地推送”的设计，不依赖通用跨云清单表。
- 之前提到的 `cloud_instance_inventory` 只是一个可选的跨云视图；鉴于你计划后续由独立模块做聚合展示，我们现在不使用它，全部改为 Harvester 专属存储与查询。

**方案对应你的 1–4 点**
- 定时采集入库
  - 每个 `cloudId` 启一个采集器，按资源类型分频率采集并 upsert 到本地库，避免外部慢网对首屏影响。
  - 频率建议：`VM 3–5s`、`Nodes 5–10s`、`Volumes 10–30s`、`Images/NAD 30–60s`、`Kube-OVN 60–120s`；视规模与负载可调。
- SSE 改读本地库
  - SSE 路由保持不变，但推送数据从本地库读取增量，客户端订阅逻辑无需改动（现有 SSE 位置：`backend/src/routes/clouds.harvester.ts:58-109`）。
- 单项更新
  - 为单资源提供“强制刷新并入库”的路由，详情页或操作后触发，立即 upsert 并推送增量事件。
- 多资源池
  - 以 `cloudId` 作为分区键，所有表均带 `cloudId` + 资源唯一键（如 `namespace/name`）进行隔离与索引。

**Harvester 专属数据模型**
- 通用约束
  - 所有表包含：`id`（uuid）、`cloudId`、`createdAt/updatedAt`；必要索引：`cloudId`、主业务查询键；原始对象保留为 `TEXT` JSON，便于详情页与排障。
- 表与字段
  - `harvester_vms`
    - 主键唯一：`cloudId + instanceId`（`instanceId = namespace/name`）
    - 规范化：`namespace`、`name`、`status`、`runStrategy`、`nodeName`、`image`、`cpuAlloc`、`memoryAlloc`、`gpuMode`、`gpuResource`、`gpuCount`
    - 结构化 JSON：`netIfaces`（含 NAD/IP/MAC）、`volumes`（pvcName/size/bus）
    - 原始 JSON：`rawSpecJson`、`rawStatusJson`、`rawExtraJson`
    - 变更与生命周期：`createdAtIso`、`lastSeenAtIso`、`specHash`、`statusHash`、`isDeleted`
    - 索引：`cloudId`、`namespace`、`nodeName`、`status`、`updatedAt`
  - `harvester_nodes`
    - 唯一：`cloudId + nodeName`
    - 列：`nodeName`、`roles`、`cpuCapacity`、`cpuAllocatable`、`memoryCapacity`、`memoryAllocatable`、`labels`、`taints`
    - 原始：`rawJson`
    - 索引：`cloudId`、`nodeName`、`updatedAt`
  - `harvester_volumes`
    - 唯一：`cloudId + namespace + name`（PVC 名）
    - 列：`namespace`、`name`、`size`、`state`、`pvcName`、`attachedTo`（数组 JSON）
    - 原始：`rawJson`
    - 索引：`cloudId`、`namespace`、`state`、`updatedAt`
  - `harvester_images`
    - 唯一：`cloudId + namespace + name`
    - 列：`displayName`、`sourceType`、`url`、`targetStorageClassName`、`status`
    - 原始：`rawJson`
    - 索引：`cloudId`、`namespace`、`status`、`updatedAt`
  - `harvester_nads`
    - 唯一：`cloudId + namespace + name`
    - 列：`namespace`、`name`、`type`、`config`（JSON）
    - 原始：`rawJson`
    - 索引：`cloudId`、`namespace`、`updatedAt`
  - `kube_ovn_vpcs` / `kube_ovn_subnets`
    - 唯一：`cloudId + name`
    - 列：`name`、`cidr`、`vpc`（对子网表）、`annotations/labels`（JSON）
    - 原始：`rawJson`
    - 索引：`cloudId`、`name`、`updatedAt`
  - `harvester_gpu_resources` / `harvester_usb_resources`
    - 唯一：`cloudId + resourceName`
    - 列：`resourceName`、`vendor`、`model`、`capacity/slots` 等
    - 原始：`rawJson`
    - 索引：`cloudId`、`resourceName`、`updatedAt`
- 不再使用跨云表
  - 当前阶段不写入 `cloud_instance_inventory`（`backend/src/entities/CloudInstanceInventory.ts:1-73`）；聚合展示交由后续独立模块处理。

**后端行为与路由**
- 采集器
  - 读取 `Cloud` 凭据并按频率调用现有取数函数（如 `getJsonOnce`，`backend/src/services/clouds/harvester/resources.ts:1-16`），批量 upsert。
  - 并发控制与退避、无变化不写，记录耗时与失败率用于调参。
- SSE
  - 原路由不变：周期从库中扫描 `updatedAt` 增量，推送 `vm_created/vm_status/vm_deleted/vms` 事件包。
- 单项刷新
  - 新增 `POST /api/clouds/:id/resources/harvester/vms/:namespace/:name/refresh` 等路由，直连拉取该项并入库，随后广播增量事件。

**为何不做跨云强整合**
- 你已明确后续会有独立聚合模块；当前控制台以“Harvester 专属页”优化首屏与交互，避免在模型上为跨云做折中。
- 专属表模型更贴合 Harvester 的字段与关系，开发与演进更直接；未来聚合模块只需读取这些表做规范化映射即可。

**现状参考**
- 数据库与实体系统：`backend/src/config/database.ts:1-17`
- 现有 SSE 位置（可替换为库推送）：`backend/src/routes/clouds.harvester.ts:58-109`
- 前端 SSE 订阅与列表更新：`frontend/src/pages/Clouds/Harvester/CloudDetailHarvester.tsx:109-183`
