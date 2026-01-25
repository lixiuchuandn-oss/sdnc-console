# VR 网际路由器 IPsec VPN 配置与开发指南

本文档详细描述了 Compute Tower 中 IPsec VPN 的配置逻辑、API 交互流程及底层数据结构，适用于开发人员与高级运维。

## 1. 架构原则

系统采用 **“期望状态 (Desired State)”** 模式：
1.  **Source of Truth**: 平台数据库 (DB) 存储用户的期望配置。
2.  **DB First**: 用户在 UI 的修改仅更新 DB，不直接触达设备。
3.  **Explicit Push**: 必须通过显式的“部署”动作，将 DB 配置转换为设备指令并下发。
4.  **No Device Read-Modify-Write**: 严禁先读取设备配置再修改回写，防止覆盖设备侧的带外变更或导致状态不一致。

## 2. 核心流程详解

### 2.1 阶段一：配置构建 (Frontend -> Backend -> DB)

此阶段仅涉及数据库读写，不产生设备流量。

*   **API**: `POST /api/networks/ipsec` (新建) 或 `PUT /api/networks/ipsec/:id` (更新)
*   **前端逻辑 (`IPsecVPNWizard.tsx`)**:
    *   **EIP 优先**: 若用户勾选 `enableLocalEip` 或 `enableRemoteEip`，则优先使用填写的 EIP 地址作为 IKE 协商地址，忽略自动发现的 WAN IP。
    *   **Any Peer**: 若勾选 `localIkeRemoteIpAny`，则 `ike_remote_ip` 被强制设为 `0.0.0.0`，允许任意 IP 接入（适用于动态 IP 场景）。
    *   **子网计算**: 自动调用 `cidrToNetwork` 将用户输入的 CIDR (如 `192.168.1.5/24`) 转换为标准网络地址 (`192.168.1.0/24`)。

*   **后端逻辑 (`ipsecRoutes.ts`)**:
    1.  **保存实体**: 将 IPsec 参数存入 `ipsec_vpn` 表。
    2.  **更新 VR 配置缓存**:
        *   读取本端 VR (`localVrId`) 和对端 VR (`peerVrId`) 在 `vr_config_cache` 表中的 `config_json`。
        *   将 IPsec 参数转换为设备识别的 JSON 对象（见下文数据结构）。
        *   追加到 `config_json.ipsec` 数组中。
        *   **关键**: 此时仅更新 `vr_config_cache` 表，**不推送**到 CSMCTL。

### 2.2 阶段二：手动部署 (Manual Deployment)

部署是一个严格的 6 步状态机，由前端依次调用后端 API 执行。

| 步骤 | 动作 | API Endpoint | 逻辑详情 |
| :--- | :--- | :--- | :--- |
| **1. Preview Local** | 预览本端 | `GET /deploy/preview?vrId={localId}` | 从 DB 读取 `config_json`，应用字段映射（如布尔转字符串），返回给前端展示。 |
| **2. Push Local** | 推送本端 | `POST /deploy/push {vrId: localId}` | 1. 从 DB 读取 `config_json`。<br>2. 清理元数据 (`stripMeta`)。<br>3. 调用 CSMCTL `/V2/ctcontrol/VR2/VRConfig` 下发全量配置。<br>4. 检查 CSMCTL 返回的 `code` 是否为 0 或 200。 |
| **3. Verify Local** | 验证本端 | `GET /deploy/verify?vrId={localId}` | 调用 CSMCTL 获取设备实时配置，检查 `ipsec` 数组长度是否 > 0。 |
| **4. Preview Peer** | 预览对端 | `GET /deploy/preview?vrId={peerId}` | 同步骤 1，针对对端 VR。 |
| **5. Push Peer** | 推送对端 | `POST /deploy/push {vrId: peerId}` | 同步骤 2，针对对端 VR。 |
| **6. Verify Peer** | 验证对端 | `GET /deploy/verify?vrId={peerId}` | 同步骤 3，针对对端 VR。 |

> **自动执行机制**: 前端 `executeManualStep` 函数在每一步成功后，会设置 500ms 延时自动触发下一步，直至流程结束或出错暂停。

## 3. 数据结构与字段映射

后端 (`ipsecRoutes.ts`) 在生成设备 JSON 时，会执行以下关键转换，开发时需严格遵守：

### 3.1 字段重命名与类型转换

设备 CLI 对部分字段有严格的格式要求，与数据库字段存在差异：

| 数据库/前端字段 | 设备 JSON 字段 | 转换规则 | 备注 |
| :--- | :--- | :--- | :--- |
| `natTraversal` (bool) | `nat-traversal` | `true` -> `"true"`, `false` -> `"false"` | **必须是字符串**，且 Key 含连字符 |
| `sa-initiate` (N/A) | `sa-initiate` | 固定 `"false"` (被动端) 或 `"true"` | **必须是字符串**，且 Key 含连字符 |
| `dpd` (bool) | (移除) | 仅用于逻辑判断，**不发送**给设备 | 设备使用 `ike-dpd-*` 组配置 |
| `ike_dpd_delay` | `ike-dpd-delay` | 下划线 -> 连字符 | 自动映射 |
| `ike_dpd_timeout` | `ike-dpd-timeout` | 下划线 -> 连字符 | 自动映射 |
| `ike_dpd_action` | `ike-dpd-action` | 下划线 -> 连字符 | 自动映射 |

### 3.2 完整 Payload 示例

以下是 `Push Local` 阶段发送给 CSMCTL 的最终 JSON 示例：

```json
{
  "uuid": "vr-bj-001",
  "vrf": [...],
  "ipsec": [
    {
      "name": "vpn-to-shanghai",
      "description": "Connection to SH DC",
      "local_subnet": "192.168.10.0/24",
      "remote_gateway": "203.0.113.5",
      "remote_subnet": "10.0.5.0/24",
      "ike_local_ip": "1.1.1.1",       // 本端 WAN IP 或 EIP
      "ike_remote_ip": "203.0.113.5",  // 对端 WAN IP 或 EIP (或 0.0.0.0)
      
      "psk": "SecretKey123",
      "ike_version": "v2",
      "encryption_algorithm": "aes-256",
      "authentication_algorithm": "sha256",
      "dh_group": "14",
      "pfs": "group14",
      "mode": "tunnel",
      
      "nat-traversal": "false",        // 字符串
      "sa-initiate": "true",           // 字符串
      
      "ike-dpd-delay": 10,
      "ike-dpd-timeout": 30,
      "ike-dpd-action": "restart",
      
      "ike_proposal_local": "vr-bj-001",
      "ike_proposal_remote": {
          "remote_id": "vr-sh-002",
          "pre_shared_key": "SecretKey123"
      }
    }
  ]
}
```

## 4. 故障排查指南

### 4.1 常见错误代码

*   **Status 500 / "Device returned error"**:
    *   原因：CSMCTL 校验失败。
    *   排查：查看 `Push Response` 中的 `Body`。常见原因包括：
        *   `local_subnet` 与现有路由冲突。
        *   `ike_local_ip` 不是设备接口上的 IP。
        *   JSON 字段拼写错误（如 `nat_traversal` 未转为 `nat-traversal`）。
*   **Verification failed (Count = 0)**:
    *   原因：配置下发成功，但设备未生成实例。
    *   排查：通常是 IKE 参数不合法导致守护进程拒绝加载。需登录设备查看 `/var/log/charon.log` 或类似 IKE 日志。

### 4.2 调试技巧

1.  **查看 Raw Payload**: 在手动部署的 Step 1 (Preview) 中，仔细检查 JSON 结构，特别是连字符字段和字符串类型的布尔值。
2.  **CSMCTL 直连**: 使用 Postman 带上 `Authorization` 头直接调用 CSMCTL 接口，排除平台侧逻辑干扰。
3.  **日志追踪**: 后端日志会打印 `[IPSEC] Pushing config to VR: xxx`，可追踪请求发出的确切时间。
