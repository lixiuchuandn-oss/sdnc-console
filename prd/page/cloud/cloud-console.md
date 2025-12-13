# 云资源控制台 PRD

## 背景与目标
- 聚合多云厂商的云资源在同一控制台进行查看与操作；按能力驱动展示差异化列与按钮。
- 支持的云厂商：阿里云（Aliyun）、华为云（Huaweicloud）、腾讯云（Tencentcloud）、Harvester。
- 能力对象用于控制列显示与操作可用性；未声明的能力视为不支持。

## 页面与导航
- 左侧：已接入云资源池的树形目录，按“云厂商+区域”分组，节点为具体资源池；点击节点切换当前上下文并加载对应数据（树构建与选择：`frontend/src/pages/Clouds/ECS.tsx:129`、`frontend/src/pages/Clouds/ECS.tsx:502`）。
- 右侧：
  - 顶部标题显示当前资源池（`providerName + name`），参考 `frontend/src/pages/Clouds/ECS.tsx:537`。
  - 过滤工具行：关键字输入、状态快捷筛选（全部/运行中/已停止）、Harvester 分组与命名空间/节点筛选、批量操作、创建实例、刷新（参考 `frontend/src/pages/Clouds/ECS.tsx:560`）。
  - 标签页：云主机/VPC/EIP/磁盘/弹性网卡（参考 `frontend/src/pages/Clouds/ECS.tsx:537`）。

## 云主机（ECS）列表与筛选
- 关键字搜索：按名称/ID模糊匹配。
- 状态快捷筛选：全部/运行中/已停止。
- Harvester 专属：分组选择（不分组/按命名空间/按节点）、命名空间筛选、节点筛选。
- 分页：默认 10/页，可切换 20/50。
- 列表列（按能力驱动）：
  - 基础：名称/ID、状态、私网IP、创建时间、操作。
  - 当 `supportsInstanceType=true`：显示“实例规格”。
  - 当 `supportsZone=true`：显示“可用区”。
  - 当 `supportsVpc=true && !supportsNetworkFusion`：显示“VPC”。
  - 当 `isHarvester=true`：显示“已使用CPU（%）/已使用内存”来自 `Extra` 字段。
- 代码参考：列的能力控制 `frontend/src/pages/Clouds/ECS.tsx:358`。

## ECS 资源加载与解析
- 云资源池列表：仅展示受支持的 Provider，未配置支持的云账号时提示并引导前往资源池管理。
- ECS 列表加载：
  - Aliyun：`json.data.Instances.Instance`
  - Huaweicloud：`json.data.servers`
  - Tencentcloud：`json.data.InstanceSet`
  - Harvester：与默认解析一致，能力默认 `isHarvester=true` 且开启网络融合/Multus。
- 能力对象：优先使用接口返回的 `capabilities`；否则按 Provider 注入默认能力。
- 错误处理：不支持的 Provider 显示提示；查询异常显示“查询失败”。
- 代码参考：加载与解析 `frontend/src/pages/Clouds/ECS.tsx:70`；错误提示 `frontend/src/pages/Clouds/ECS.tsx:537`。

## 远程与操作（ECS）
- 单行操作菜单：远程连接、WebSSH、WebVNC、启动/停止/重启/删除（部分 Provider 禁用）。
  - 远程连接：弹窗选择 SSH/RDP，填写主机/端口/用户名等。
  - WebSSH/WebVNC：自动选取公网或私网地址构造跳转参数。
  - 启动/停止/重启/删除：当前仅 Aliyun/Harvester 可用，其它 Provider 按禁用处理。
- 批量操作：批量启动/停止/重启/删除，依据表格勾选项进行。
- 代码参考：行内菜单与操作 `frontend/src/pages/Clouds/ECS.tsx:358`、批量操作 `frontend/src/pages/Clouds/ECS.tsx:444`。

## 关联资源标签页
- VPC：解析 `json.data.Vpcs.Vpc` 或 `json.data.vpcs`。
- EIP：解析 `json.data.Eips.Eip` 或 `json.data.eips`。
- 磁盘：解析 `json.data.Disks.Disk` 或 `json.data.disks`。
- 弹性网卡：解析 `json.data.NetworkInterfaces.NetworkInterface` 或 `json.data.enis`。
- 代码参考：加载方法 `frontend/src/pages/Clouds/ECS.tsx:197`（VPC）、`frontend/src/pages/Clouds/ECS.tsx:224`（ENI）。

## 能力驱动
- 能力键示例：
  - 计算：`compute.instanceType`、`compute.zone`
  - 网络：`network.vpc`、`network.subnet`、`network.eni`、`network.eip`、`network.routeTable`
  - 存储：`storage.disk`、`storage.snapshot`
- 能力使用：
  - 控制列显示与按钮可用性（如启动/停止等）。
  - Harvester 网络：`supportsNetworkFusion=true` 与 `supportsMultus=true` 时隐藏传统 VPC 列，保留 ENI 展示。

## 状态与性能
- 加载状态与错误提示在顶部区域统一显示；提供“刷新”按钮强制重载当前云池数据。
- 分页与筛选对渲染性能的影响控制在可接受范围（目标：表格交互 <200ms）。

## 验收与测试
- 多云解析：四类 Provider 的列表解析正确，列显示与按钮状态符合能力映射。
- Harvester 分组：按命名空间/节点分组渲染正确，筛选联动生效。
- 批量操作：多选与操作执行正确；禁用 Provider 不触发。
- 远程连接：SSH/RDP/WebSSH/WebVNC 跳转或弹窗行为正确；地址选取规则符合代码逻辑。
- 关联资源：VPC/EIP/磁盘/ENI 标签页加载与展示正确。
- 错误提示：未支持 Provider 与查询异常提示文案正确。

## 参考
- 设计综述：`docs/design/capability-driven-ui.md`
- Provider 文档：`docs/providers/aliyun.md`、`docs/providers/huaweicloud.md`、`docs/providers/tencentcloud.md`、`docs/providers/harvester.md`
- 代码入口：`frontend/src/pages/Clouds/ECS.tsx`