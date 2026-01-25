# CSM 单点登录 (SSO) 集成指南

本文档说明如何生成 Web ID 并调用 CSM 接口实现网元 Web 页面的单点登录 (SSO)。

## 1. Web ID 生成算法

SSO 登录需要使用 `web_id`，该 ID 通过对虚拟机 UUID 进行特定位运算转换得到。

**Java 实现示例**:

```java
import java.nio.ByteBuffer;
import java.util.UUID;
// import org.bson.types.ObjectId; // 需依赖 BSON 库

public static String toObjectId(String uuidStr) {
    UUID uuid = null;
    try {
        uuid = UUID.fromString(uuidStr);
    } catch (Exception e) {
        throw new IllegalArgumentException("UUID 格式非法: " + e.getMessage());
    }

    byte[] uuidBytes = new byte[16];
    ((ByteBuffer) ByteBuffer.allocate(16)
        .putLong(uuid.getMostSignificantBits())
        .putLong(uuid.getLeastSignificantBits())
        .position(0))
        .get(uuidBytes);

    // 校验特定字节位 (CSM 约定)
    if (uuidBytes[6] != 64 || uuidBytes[7] != 0 || uuidBytes[8] != -128 || uuidBytes[9] != 0) {
        throw new IllegalArgumentException(String.format("UUID: %s 不符合 ObjectId 转换规则", uuid.toString()));
    }

    // 提取有效字节并重新组合
    byte[] objectidBytes = new byte[12];
    System.arraycopy(uuidBytes, 0, objectidBytes, 0, 6);
    System.arraycopy(uuidBytes, 10, objectidBytes, 6, 6);

    // 转换为 Hex 字符串 (类似 MongoDB ObjectId)
    // 若无 BSON 库，可自行实现 bytesToHex
    return bytesToHex(objectidBytes); 
}

// 辅助方法: 字节数组转 Hex 字符串
private static String bytesToHex(byte[] bytes) {
    StringBuilder sb = new StringBuilder();
    for (byte b : bytes) {
        sb.append(String.format("%02x", b));
    }
    return sb.toString();
}
```

## 2. SSO 接口调用流程

完成 Web ID 生成后，需按序调用以下 CSM 接口完成登录。

### 步骤 1: 初始认证

*   **Path**: `/csm/api/v1.0/authentication/auth`
*   **Method**: `POST`
*   **Content-Type**: `application/json`

**请求示例**:
```json
{
    "username": "admin",
    "password": "+yNpVuicvsiBzpDpeaIq3g==" // 加密后的密码
}
```

**响应**:
获取响应 Header 中的 `data` 字段值，作为后续步骤的 Token。

### 步骤 2: 获取管理员信息

*   **Path**: `/csm/api/v1.0/user/getAdmin`
*   **Method**: `GET`
*   **Query Params**:
    *   `webPort`: `8011`
*   **Headers**:
    *   `data`: `<步骤 1 获取到的 Token>`

**响应**:
解析响应 JSON，获取 `id` 字段值 (User ID)。

### 步骤 3: 触发 SSO 登录

*   **Path**: `/csm/api/v1.0/security/domain/attach/callOnSSO`
*   **Method**: `POST`
*   **Query Params**:
    *   `webPort`: `8011`
*   **Headers**:
    *   `token`: `<步骤 1 或刷新后的 Token>` (注意 Header Key 为 `token` 而非 `data`)
*   **Body**:

```json
{
  "id": "695f6a0ae70890179d5120c7",        // 目标虚拟机的 Web ID (由 UUID 转换而来)
  "currentLoginWebPort": "8011",           // 当前 CSM 端口
  "userId": "677e6012d0cc467001064eb1"     // 步骤 2 获取的 User ID
}
```

**响应**:
成功调用后，前端即可跳转至目标网元管理页面。
