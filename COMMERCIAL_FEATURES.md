# ComputeTower 可售卖功能清单

本文档列出了 ComputeTower 平台的可售卖功能特性（License Features）。在生成授权文件时，可根据客户购买的套餐勾选相应的功能模块。

## 1. CNMC 核心管理 (Cloud Native Management Center)

基础管理平台，包含多云纳管与租户体系。

| 功能代码 (Key) | 功能名称 | 描述 | 依赖 |
| :--- | :--- | :--- | :--- |
| `platform.default` | **基础平台 (Base)** | 包含 Cloudmap 资源池基础管理能力，支持资源发现与同步。 | 必选 |
| `platform.multi-cloud` | **多云管理 (Multi-Cloud)** | 支持接入阿里云、华为云、腾讯云等公有云资源池。 | `platform.default` |
| `network.ovn.vpc` | **虚拟专有云 (OVN VPC)** | 提供基于 Kube-OVN 的 VPC 网络能力，包含子网、EIP、NAT 网关管理。 | `platform.default` |
| `sys.tenant-mgmt` | **多租户管理 (Multi-Tenant)** | 支持多级组织架构、租户隔离与资源配额分配。 | - |
| `sys.rbac-advanced` | **权限控制 (RBAC)** | 支持自定义角色、细粒度权限策略与用户组管理。 | - |
| `sys.dashboard` | **全局仪表板 (Dashboard)** | 提供全平台的资源概览大屏与监控统计视图。 | - |

## 2. SDN 控制中心 (SDN Control Center)

高级网络控制能力，支持跨地域互联与流量编排。

| 功能代码 (Key) | 功能名称 | 描述 | 依赖 |
| :--- | :--- | :--- | :--- |
| `sdn.cascade` | **级联管理 (Cascade)** | 支持多层级联架构，统一管理下级边缘节点与通道。 | `platform.default` |
| `sdn.interconnect` | **跨地域互联 (Interconnect)** | 提供 IPsec VPN、SRv6 隧道、VXLAN 等跨网互联能力。 | `platform.default` |
| `sdn.traffic` | **流量编排 (Traffic)** | 支持服务链编排、QoS 策略与流量镜像/重定向功能。 | `platform.default` |

## 3. AISOC 安全运营 (AI Security Operations Center)

智能化安全运营中心。

| 功能代码 (Key) | 功能名称 | 描述 | 依赖 |
| :--- | :--- | :--- | :--- |
| `platform.aisoc` | **AISOC 安全运营中心** | 解锁态势感知、威胁分析、安全大屏与自动化响应能力。 | - |

---

### 授权生成说明

1. **Trial (试用版)**: 默认开启部分基础功能，有时间与资源限制。
2. **Standard (标准版)**: 通常包含 CNMC 核心模块。
3. **Enterprise (企业版)**: 可选购 SDN 与 AISOC 高级模块。

*生成器路径*: `deployment/license-ui`
