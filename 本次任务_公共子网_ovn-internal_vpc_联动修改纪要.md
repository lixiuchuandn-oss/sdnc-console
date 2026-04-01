# 本次任务：公共子网与 ovn-internal VPC 联动 — 修改纪要（2026-03-31）

## 目标/范围
- 目标：公共子网（Kube-OVN Subnet）在创建/编辑/删除时，联动维护内置 VPC `ovn-internal`（`extraExternalSubnets` + `staticRoutes`），并对 EIP 依赖做限制（非 lrp 拦截）。
- 范围：仅记录本任务涉及的“公共子网 + ovn-internal 联动 / EIP 依赖限制 / routeCidr / NAD / 物理网络别名展示”等改动点，不与其他历史纪要关联。

## 用户可见行为
### 1) 公共子网新增“路由 CIDR”字段
- 创建/编辑公共子网表单新增 `路由 CIDR`，默认值 `0.0.0.0/0`。
- `routeCidr` 写入子网注解：`tower.io/ovn-internal-route-cidr`，用于后端删除/更新时精确清理对应 VPC 路由。

### 2) EIP 依赖限制（非 lrp 拦截）
- 若公共子网被 **非 lrp 类型** EIP 使用：禁止编辑/删除，并提示用户先删除相关 EIP。
- 若仅被 **lrp 类型** EIP 使用：允许编辑/删除。
- 约束为前后端双校验，避免绕过前端直接调用接口破坏约束。

### 3) 公共子网与 ovn-internal VPC 联动
- 创建公共子网成功后：写入 `ovn-internal` VPC
  - `spec.extraExternalSubnets` 追加该公共子网名
  - `spec.staticRoutes` 增/改路由（`policyDst`，`cidr=routeCidr`，`nextHopIP=gateway`）
  - 若 VPC 写入失败：回滚删除刚创建的子网，避免“子网存在但 VPC 未联动”的脏状态
- 编辑公共子网：
  - 支持“仅改 routeCidr”的轻量路径：不改子网关键字段，仅更新 VPC 静态路由
  - 若子网关键字段（`cidrBlock/gateway/vlan`）发生变化：先清理 VPC 旧关联，再更新子网，最后写入新关联；失败时尽力回滚 VPC
- 删除公共子网：
  - 删除前先清理 VPC：移除 `extraExternalSubnets` + 移除匹配的 `staticRoutes`
  - 路由清理优先使用子网注解 `tower.io/ovn-internal-route-cidr` 精确匹配 `cidr`，并结合 `nextHopIP=gateway` 做兜底匹配

### 4) 物理网络列展示“别名”
- 公共子网列表“物理网络”列优先展示 ProviderNetwork 的别名注解（无则回退资源名），避免仅显示集群资源名导致难以辨识。

### 5) NAD（NetworkAttachmentDefinition）创建与兼容
- 公共/扁平子网创建时使用逻辑 provider 名：`{subnetName}.{namespace}.ovn`，并处理常见冲突/校验失败场景（409/422）。

## 关键实现点
- `routeCidr` 通过注解持久化（`tower.io/ovn-internal-route-cidr`），用于更新/删除时确定“旧路由”与“应清理路由”。
- 更新时拆分为两类路径：
  - route-only：仅更新 VPC 路由（不触碰子网关键字段）
  - major-change：先清 VPC，再更子网，再写回 VPC（含回滚）
- 子网更新增加 409 冲突重试，降低资源版本冲突导致的失败概率。

## 涉及文件（本任务核心）
- 后端
  - [ovn-direct-subnets.handlers.ts](file:///d:/work/Compute.Tower/backend/src/routes/clouds/harvester/handlers/ovn-direct-subnets.handlers.ts)
  - [network.ts](file:///d:/work/Compute.Tower/backend/src/services/clouds/harvester/network.ts)
  - [kubeOvnNetworkScope.ts](file:///d:/work/Compute.Tower/backend/src/services/clouds/harvester/kubeOvnNetworkScope.ts)
- 前端
  - [UnderlaySubnetsSection.tsx](file:///d:/work/Compute.Tower/frontend/src/pages/Clouds/Harvester/kube-ovn/UnderlaySubnetsSection.tsx)
  - [UnderlaySubnetFormFields.tsx](file:///d:/work/Compute.Tower/frontend/src/pages/Clouds/Harvester/kube-ovn/underlay-subnet/UnderlaySubnetFormFields.tsx)
  - [CreatePublicSubnetModal.tsx](file:///d:/work/Compute.Tower/frontend/src/pages/Clouds/Harvester/kube-ovn/underlay-subnet/CreatePublicSubnetModal.tsx)
  - [constants.ts](file:///d:/work/Compute.Tower/frontend/src/pages/Clouds/Harvester/kube-ovn/underlay-subnet/constants.ts)
  - [harvesterApi.ts](file:///d:/work/Compute.Tower/frontend/src/services/harvesterApi.ts)

## 对接说明（调用侧/联调）
- 创建/更新公共子网时，前端向后端提交 `routeCidr`（CIDR 字符串，例如 `0.0.0.0/0`）；后端会校验格式并写入注解。
- 删除/更新公共子网若遇到“被非 lrp EIP 占用”会返回 409（前端也会预检拦截）。

