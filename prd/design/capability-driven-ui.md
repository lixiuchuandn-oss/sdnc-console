# 能力驱动的云资源界面设计（可扩展框架）

> 总索引：`docs/README.md`

## 设计原则
- 供应商无关：以“能力”为抽象单元，避免把厂商概念写死到前端或页面逻辑中。
- 分层清晰：资源能力与操作能力分层；列表展示与操作按钮分层；数据解析与能力判定分层。
- 前后端契约化：后端负责输出统一能力对象；前端只消费能力对象，不关心具体厂商细节。
- 版本化与向前兼容：能力对象具备版本号与默认值策略，允许渐进扩展。

## 架构总览
- 后端：`ProviderAdapter` 将不同云厂商的原生能力映射为统一能力对象；`CapabilityRegistry` 维护默认能力与各接口的增量能力；路由只负责透传结果。
- 前端：统一在页面 `load*` 函数中合并能力对象到 `caps` 状态；所有按钮和列显示依赖 `caps`；不编写厂商分支判断。
- 数据流：请求资源列表 → 后端返回 `{ data, capabilities }` → 前端合并 `capabilities` → 按能力渲染操作与列。

## 能力分类与命名规范
- 命名采用“领域.能力”前缀，避免散乱：
  - 计算：`compute.instanceType`、`compute.zone`、`compute.lifecycle.start`、`compute.lifecycle.stop`
  - 网络：`network.vpc`、`network.subnet`、`network.eni`、`network.eip`、`network.routeTable`、`network.fusion`
  - 存储：`storage.disk`、`storage.snapshot`
  - 安全：`security.securityGroup`、`security.networkAcl`
  - 供应商特性：`provider.harvester.multus`、`provider.k8s.multus`、`provider.vmware.portgroup`
- 布尔能力统一用肯定式命名，默认 `false`；动作型能力统一加动词路径，如 `compute.lifecycle.reboot`。

## 能力 Schema 与版本
- 能力对象基础结构：
  - `version`: 能力对象版本（如 `1.0`）
  - `provider`: 当前云厂商标识（如 `aliyun`、`harvester`、`vmware`、`k8s`）
  - `caps`: 扁平或分组的能力键集合（布尔或枚举）
- 示例（简化）：
```
{
  "version": "1.0",
  "provider": "harvester",
  "caps": {
    "compute.instanceType": false,
    "compute.zone": false,
    "network.vpc": true,
    "network.subnet": true,
    "network.fusion": true,
    "provider.harvester.multus": true,
    "storage.disk": false,
    "storage.snapshot": false
  }
}
```
- 默认处理：未声明的能力按 `false`；前端必须兼容缺失键。

### 版本策略（SemVer）
- `major`：能力键语义变更或删除（潜在破坏性），需前后端同步升级。
- `minor`：新增能力键或非破坏性的枚举值扩充，前端应默认忽略未知键并保持兼容。
- `patch`：文案/说明修正或精度调整，不影响消费方式。

### 版本协商与兼容
- 后端始终返回 `version`；前端维护 `supportedVersionRange`（如 `^1.0.0`）。
- 若后端版本高于前端支持范围：前端仍按“未知键忽略，缺失键视为不支持”策略渲染；必要时在控制台输出警告。
- 能力别名与弃用：
  - 通过注册中心维护 `deprecatedKeys: Record<old,new>`，后端可同时返回新旧键一段时间。
  - 前端优先消费新键；若只存在旧键，仍按旧键渲染。

### TypeScript 接口（建议）
```
export interface CapabilityPayload {
  version: string;
  provider: string;
  caps: Record<string, boolean | string | number>;
}

export interface CapabilityNegotiation {
  supportedVersionRange: string;
  deprecatedKeys?: Record<string, string>;
}
```

### JSON Schema（建议）
```
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "required": ["version", "provider", "caps"],
  "properties": {
    "version": { "type": "string" },
    "provider": { "type": "string" },
    "caps": {
      "type": "object",
      "additionalProperties": {
        "oneOf": [ {"type": "boolean"}, {"type": "string"}, {"type": "number"} ]
      }
    }
  }
}
```

## Provider Adapter 约定
- 适配器职责：把云厂商原生概念映射为统一能力对象。
- 约定接口（后端内部）：
  - 输入：`context`（含 provider、region、cloud config 等）
  - 输出：能力对象（见上）与资源数据（保持原始结构或统一结构）
- 实现位置：各路由调用具体 provider 适配器，适配器负责构造 `capabilities`，路由只透传。

### 适配器示例（伪代码）
```
function buildCapabilities(context): CapabilityPayload {
  const p = (context.provider || '').toLowerCase();
  const caps: Record<string, boolean> = {};
  if (p === 'harvester') {
    caps['compute.instanceType'] = false;
    caps['compute.zone'] = false;
    caps['network.vpc'] = true;
    caps['network.subnet'] = true;
    caps['network.fusion'] = true;
    caps['provider.harvester.multus'] = true;
  } else if (p === 'aliyun') {
    caps['compute.instanceType'] = true;
    caps['compute.zone'] = true;
    caps['network.vpc'] = true;
    caps['network.subnet'] = true;
    caps['network.eni'] = true;
    caps['network.eip'] = true;
    caps['network.routeTable'] = true;
    caps['storage.disk'] = true;
    caps['storage.snapshot'] = true;
  }
  return { version: '1.0', provider: p, caps };
}
```

## 能力注册中心
- 在后端维护一个能力注册表，用于：
  - 定义各 provider 的基础能力默认值（例如 `vmware` 默认不支持 `network.vpc`）。
  - 在特定资源接口上做增量能力（例如 ENI 接口额外声明 `network.eni=true`）。
- 变更集中：新增/调整能力只改注册表或适配器，不散落在页面代码。

### 注册表示例（伪代码）
```
const baseCaps = {
  harvester: {
    'compute.instanceType': false,
    'compute.zone': false,
    'network.vpc': true,
    'network.subnet': true,
    'network.fusion': true,
    'provider.harvester.multus': true
  },
  aliyun: {
    'compute.instanceType': true,
    'compute.zone': true,
    'network.vpc': true,
    'network.subnet': true,
    'network.eni': true,
    'network.eip': true,
    'network.routeTable': true,
    'storage.disk': true,
    'storage.snapshot': true
  }
};

function enrichCapsForEndpoint(provider, endpoint) {
  const caps = { ...(baseCaps[provider] || {}) };
  if (endpoint === 'enis' && provider !== 'aliyun') caps['network.eni'] = false;
  return caps;
}
```

## 扩展指引（VMware、K8s、公有云、私有云）
- VMware vSphere：
  - 映射：`network.vpc=false`、`network.subnet=false`、`provider.vmware.portgroup=true`、`network.fusion=false`
  - 计算：`compute.instanceType=true`（映射到模板/资源池）按产品策略决定
- Kubernetes（原生集群）：
  - 映射：`provider.k8s.multus` 取决于是否安装 Multus；`network.vpc=false`、`network.subnet=false`
  - 计算：`compute.zone=false`；生命周期操作能力按集群权限决定
- 其他公有云（AWS、Azure、GCP）：
  - 映射到统一：`network.vpc=true`、`network.subnet=true`、`network.eip=true`（按产品）
  - 路由表：`network.routeTable=true`
- 私有云（OpenStack、VMware、KVM 等）：
  - 使用适配器确定是否存在 VPC 等；无则用供应商特性能力替代（如 PortGroup/NAD）。

### Provider 文档
- Harvester 适配说明：`docs/providers/harvester.md`
- 阿里云适配说明：`docs/providers/aliyun.md`
- 华为云适配说明：`docs/providers/huaweicloud.md`
- 腾讯云适配说明：`docs/providers/tencentcloud.md`

## 后端输出规范（当前实现示例）
- ECS：`backend/src/routes/clouds.ts:639–704`
- VPC：`backend/src/routes/clouds.ts:403–445`
- Subnets：`backend/src/routes/clouds.ts:1028–1083`
- ENI：`backend/src/routes/clouds.ts:1182–1216`
- EIP：`backend/src/routes/clouds.ts:1476–1497`
- RouteTables：`backend/src/routes/clouds.ts:1559–1615`
- Disks：`backend/src/routes/clouds.ts:1666–1684`
- Snapshots：`backend/src/routes/clouds.ts:1691–1720`

## 前端消费规范（统一模式）
- 统一能力状态：各资源加载函数合并 `json.capabilities` 到全局 `caps`，不相互覆盖。
- 按能力渲染：
  - 创建/编辑/删除按钮：由能力布尔控制禁用与提示文案。
  - 列控制：由能力布尔控制显示/隐藏（如 `compute.instanceType`、`compute.zone`）。
  - Harvester 网络融合：由 `network.fusion` 与 `provider.harvester.multus` 决定融合展示。
- 兜底：缺失键视为不支持，不抛错；展示“-”或禁用。

### 页面集成点（当前实现）
- `frontend/src/pages/Clouds/CloudDetail.tsx` 在 `loadVpcs`、`loadEcs`、`loadSubnets`、`loadEnis`、`loadEips`、`loadRouteTables`、`loadDisks`、`loadSnapshots` 中合并 `json.capabilities` 到 `caps`。
- 创建/删除按钮禁用逻辑基于 `caps`，如 VPC/子网/ENI 按对应能力控制。

## 兼容性策略
- 默认值：未声明能力即 `false`，防止误启用。
- 版本号：前后端按 `version` 做灰度；新增能力只影响有新版本的消费者。
- 渐进增强：优先兼容旧能力键，新增键不破坏现有逻辑。

## 测试与验证
- 单元测试：适配器将厂商数据映射到能力对象的测试用例。
- 集成测试：接口返回的能力对象与前端按钮/列的联动测试。
- 验证场景：Harvester、阿里云、（占位：VMware、K8s、AWS、Azure、GCP）。

### 新增 Provider 测试清单（建议）
- 能力对象完整性（必含 `version`、`provider`、`caps`）。
- 关键能力断言（如 `network.vpc`、`network.subnet`、`compute.instanceType`）。
- 前端禁用逻辑断言（按钮/列）。

## 变更管理
- 能力注册表与适配器变更需走代码评审；前端消费层只接受能力对象，不引入厂商分支。
- 增加新云厂商时，按“扩展指引”落地：新适配器 + 注册表增量 + 前端无需改或仅添加新列映射。

## 术语
- 能力对象：描述当前云厂商在特定资源上的功能集合。
- 适配器：把云厂商原生能力映射到统一能力对象的后端组件。
- 注册中心：集中维护默认能力与接口增量能力的后端配置中心。

## 文档目录约定
- `docs/design/`：总体设计与架构约定（本文件）
- `docs/providers/`：各 Provider 的适配说明（如 `harvester.md`）
- `docs/prd/`：各功能的产品需求与交互（如 `cloud/cloud-console.md`、`interconnect/vr-instance.md`、`interconnect/srv6-tunnel.md`）

### 阅读顺序（建议）
- 首读本文件了解能力模型与版本策略
- 再读对应功能 PRD（`docs/prd/*`）明确页面与交互
- 最后读对应 Provider 文档（`docs/providers/*`）理解差异化能力映射