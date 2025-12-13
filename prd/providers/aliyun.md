# 阿里云适配说明（基于能力驱动框架）

## 关系与原则
- 本文是多云“资源适配层”中的阿里云 Provider 适配指南，遵循统一能力 Schema、命名规范、适配器契约与注册中心策略。
- 前端只消费能力对象（`capabilities`），不在页面写死厂商分支。

## 能力映射（当前实现）
- 计算：
  - `compute.instanceType=true`、`compute.zone=true`
- 网络：
  - `network.vpc=true`、`network.subnet=true`
  - `network.eni=true`、`network.eip=true`
  - `network.routeTable=true`
- 存储：
  - `storage.disk=true`、`storage.snapshot=true`

## 数据与接口适配
- 后端路由能力返回示例（含 `capabilities`）：
  - VPC：`backend/src/routes/clouds.ts:403`
  - ECS（列表能力）：`backend/src/routes/clouds.ts:639`
  - 子网：`backend/src/routes/clouds.ts:1028`
  - ENI：`backend/src/routes/clouds.ts:1182`
  - EIP：`backend/src/routes/clouds.ts:1463`
  - 路由表：`backend/src/routes/clouds.ts:1512`
  - 云盘：`backend/src/routes/clouds.ts:1619`
  - 快照：`backend/src/routes/clouds.ts:1644`
- 数据来源适配：
  - `callAliyunVpc`、`callAliyunEcs` 封装阿里云 OpenAPI（分页聚合、集合字段解析）。

## 前端消费与展示
- `frontend/src/pages/Clouds/CloudDetail.tsx` 在各 `load*` 函数合并 `json.capabilities` 到 `caps`。
- 按能力控制按钮与列：VPC/子网/ENI/EIP/路由表/云盘/快照均根据对应能力启用或禁用。

## 注意事项
- 集合结构差异：例如 `EipAddresses.EipAddress`、`NetworkInterfaces.NetworkInterface`，前端解析需兼容数组形态。
- 认证与区域：需配置 `accessKeyId`/`accessKeySecret` 与 `regionId`。

## 测试与验证
- 能力对象断言：各接口返回包含 `capabilities` 且键值符合预期。
- 前端联动：创建/删除按钮禁用逻辑与列显示符合能力映射。