# 华为云适配说明（基于能力驱动框架）

## 1. 关系与原则
- 本文是多云“资源适配层”中的华为云 Provider 适配指南，遵循统一能力 Schema、命名规范、适配器契约与注册中心策略。
- 前端只消费能力对象（`capabilities`），不在页面写死厂商分支。

## 2. 能力映射（当前实现）
- **计算**：
  - `compute.instanceType=true`、`compute.zone=true`
- **网络**：
  - `network.vpc=true`、`network.subnet=true`
  - `network.routeTable=true`
  - `network.eip=false`、`network.eni=false`（当前实现未接入这些接口）
- **存储**：
  - `storage.snapshot=true`
  - `storage.disk=false`（当前实现未接入云盘列表接口）

## 3. 数据与接口适配
- **后端路由**：
  - VPC：`backend/src/routes/clouds.ts:403`
  - ECS（列表能力）：`backend/src/routes/clouds.ts:639`
  - 子网：`backend/src/routes/clouds.ts:1028`
  - 路由表：`backend/src/routes/clouds.ts:1512`
  - 快照：`backend/src/routes/clouds.ts:1691`
- **数据来源**：
  - `huaweiListVpcs`、`huaweiListSubnets` 等封装 API 调用；需要 `projectId`。

## 4. 前端消费与展示
- `frontend/src/pages/Clouds/CloudDetail.tsx` 合并 `json.capabilities` 到 `caps`。
- 因 `network.eni=false`、`network.eip=false`，ENI/EIP 创建/删除按钮在界面禁用。

## 5. 注意事项
- **项目维度**：需要配置 `projectId` 以访问 VPC/子网/快照等资源。
- **分页兼容**：不同接口返回的集合字段名不一致，需统一解析。

---

## 附录：界面字段映射参考 (Legacy UI Mapping)

### 云主机 (ECS)
| 界面字段 | 华为云 API 字段 | 示例值 |
| :--- | :--- | :--- |
| 实例名 | `name` | 华为云VR实例 |
| ID | `id` | ef489d4a... |
| 状态 | `status` | ACTIVE |
| 规格 | `flavor.id` / `vcpus` / `ram` | x1.2u.8g (2vCPU, 8GB) |
| 镜像 | `image.name` | Huawei Cloud EulerOS 2.0 |
| VPC | `metadata.vpc_id` | vpc-default |
| 公网IP | `addresses[].addr` | 60.204.250.65 |
| 内网IP | `addresses[].addr` | 192.168.1.216 (primary) |

### VPC
| 界面字段 | 华为云 API 字段 | 示例值 |
| :--- | :--- | :--- |
| 名称 | `name` | vpc-default |
| 网段 | `cidr` | 192.168.0.0/16 |
| 状态 | `status` | OK |
| 路由条目 | `routes` | destination/nexthop |

### 子网 (Subnet)
| 界面字段 | 华为云 API 字段 | 示例值 |
| :--- | :--- | :--- |
| 名称 | `name` | subnet-a |
| 网段 | `cidr` | 192.168.1.0/24 |
| 网关 | `gateway_ip` | 192.168.1.1 |
| 可用IP | `available_ip_address_count` | 250 |

### 其他资源
- **安全组**: `name`, `security_group_rules` (ingress/egress)
- **EIP**: `public_ip_address`, `bandwidth_name`, `status`
- **ELB**: `name`, `vip_address`, `listeners`, `pools`
- **NAT**: `name`, `spec` (enhanced), `status`
