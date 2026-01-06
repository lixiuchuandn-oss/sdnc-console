# 安全域管理 PRD

## 背景与目标
- 安全域表示用户私有网络（IDC/VPC/虚拟化/办公等），通过 VR 实例之间建立隧道实现互联。
- 提供三步向导，支持 IPv4/IPv6 配置与云 VPC 的创建或选择，保障数据一致性。

## 范围
- 前端页面：`/admin/sec-mgr-plane/security-domain/new`（React + Ant Design）。
- 后端接口：安全域 CRUD、云资源池与 VPC 列表、云端创建 VPC。
- 展示与确认：确认页完整展示（含 IPv6）。

## 术语
- SecurityDomain/VPC/VR/IPv4/IPv6 CIDR/Cloud Pool。

## 用户与权限
- 管理员或网络管理员；需携带授权 Token。

## 三步向导
1) 设定基础信息：名称、类型（IDC/VPC/虚拟化/办公）、说明、标签。
2) 设定安全域（分支）：
   - VPC 类型：选择云资源池；来源（已有/新建）；新建时填写名称与 IPv4 CIDR；可启用 IPv6 并填写 CIDR；VR 绑定（自动/绑定已有）。
   - 非 VPC 类型：绑定 VR；可选 IPv4/IPv6 CIDR（建议至少填一项）。
3) 确认安全域：按分区展示基础信息/云资源与 VPC/网络设置/VR 绑定；提交创建。

## 前端功能详述
- VR 列表：搜索与下拉；可选角色提醒（CE）。
- 云资源与 VPC：标准化显示；列表按云选择加载。
- 新建 VPC：名称与 IPv4 CIDR；启用 IPv6 时必填 IPv6 CIDR；云端创建失败不阻断安全域创建。
- 表单联动与状态：切换类型/来源/绑定方式时重置与显示/隐藏相应控件。
- 确认页：分区展示，含 IPv6。

## 字段与校验
- 基础：`name`、`type` 必填；`description/tags` 可选。
- VPC：`cloudId/vpcMode` 必填；`vpcId/newVpcName/newVpcCidr` 按模式必填；IPv6 开启时 `newVpcIpv6Cidr` 必填。
- 非 VPC：`vrUuid` 必填；`cidr/cidr6` 可选；建议增强至少填一项。

## 数据与接口
- SecurityDomainPayload 字段定义与 CRUD；云接口：`fetchClouds()`、`fetchCloudProviderVpcs(cloudId)`、`createCloudProviderVpc(...)`。

## 页面结构与文案
- 左侧 Steps；右侧内容区按步渲染；主要按钮“上一步/下一步/创建/取消”；标准中文文案与提示。

## 状态与性能
- 使用表单值驱动；VR 与云列表加载策略；搜索与截断显示。

## 错误与回退
- 云端新建 VPC 失败不阻断；表单校验失败不进入下一步；网络错误提示并显示“暂无数据”。

## 非功能
- 安全与兼容性、性能目标。

## 展示一致性
- 列表/详情展示 IPv4/IPv6；前端标准化为数组形式。

## 验收与测试
- 基础流程、IPv6 支持、校验与回退、UI一致性。

## 开放问题
- 至少填 IPv4/IPv6 的校验是否强制；绑定 CE 是否强制；云端新建 VPC 的 IPv6 参数差异；标签上限与格式；确认页是否增加云细节。

## 参考
- 原始来源：`PRD/3. 跨地域互联/安全管理面/安全域管理.txt`
