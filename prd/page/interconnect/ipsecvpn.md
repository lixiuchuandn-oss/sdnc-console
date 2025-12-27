
1. 选择2个标准模式

# VR 网际路由器 IPsec VPN 配置指南

VR 网际路由器的 IPsec VPN 配置主要有两种途径：通过 **UI 界面向导（推荐）** 和 **专家模式（JSON 配置）**。

## 1. UI 配置流程（推荐）

这是最常用的配置方式，分为两个步骤：

### 第一步：VR 基础初始化（标准模式向导）
在创建或编辑 VR 时，使用“标准模式”向导。

- **作用**：配置 WAN/LAN 接口和公网网关。
- **结果**：向导会在 VR 配置中生成 `ipsec_preset` 预置字段（包含 `local_subnet`, `public_ip` 等），为后续创建 VPN 提供默认参数。
- **底层逻辑**：前端会调用 StandardWizard 组件，保存时生成 `ipsec_preset` 元数据。

### 第二步：创建 IPsec VPN 连接
进入 **“云间互联” -> “IPsec VPN”** 页面，点击“新建”。

1.  **选择本端 VR**：
    - 系统会自动读取该 VR 的 `ipsec_preset`。
    - 自动填充本地子网 (`local_subnet`) 等信息。
2.  **配置对端信息**：
    - 填写对端网关 IP (`remote_gateway`)。
    - 填写对端内网网段 (`remote_subnet`)。
3.  **配置策略参数**：
    - IKE 版本 (`ike_version`)：v1/v2
    - 加密算法 (`encryption_algorithm`)：aes-128, aes-256 等
    - 认证算法 (`authentication_algorithm`)：sha1, sha256 等
    - DH 组 (`dh_group`)：group2, group14 等
    - PFS (`pfs`)：group14 等
    - 模式 (`mode`)：tunnel (隧道模式)

**执行过程**：
后端接口接收到请求后，会将这些参数封装成一个对象，追加到 VR 配置的 `ipsec` 数组中，并调用 VR 控制器接口下发更新。

## 2. 专家模式（JSON 配置）

如果您需要更灵活的配置，或者进行批量操作，可以直接在 VR 的“专家模式”中编辑 JSON 配置。

**配置路径**：`ipsec` 数组。

**JSON 结构示例**：

```json
{
  "uuid": "vr-uuid-xxxxx",
  "role": "标准",
  "ipsec": [
    {
      "name": "vpn-connection-1",
      "description": "To Branch Office",
      "local_subnet": "192.168.10.0/24",
      "remote_gateway": "203.0.113.5",
      "remote_subnet": "10.0.5.0/24",
      "psk": "YourPreSharedKey",
      "ike_version": "v2",
      "encryption_algorithm": "aes-256",
      "authentication_algorithm": "sha256",
      "dh_group": "14",
      "pfs": "group14",
      "mode": "tunnel"
    }
  ]
  // ... 其他接口配置
}
```

## 3. 常见问题排查

- **参数不一致**：确保两端的加密、认证算法、DH 组和预共享密钥 (PSK) 完全一致。
- **网络连通性**：确保本端和对端的公网网关 (Gateway IP) 之间路由可达，且未被防火墙阻断 UDP 500/4500 端口。
- **子网冲突**：确保本端子网 (`local_subnet`) 和对端子网 (`remote_subnet`) 不重叠。
