# 标准资源查询接口 (Standard Resources API)

本模块提供标准化的后端接口，用于查询资源池列表，并获取针对特定资源池的标准化查询指令（Payload）。这允许上层应用或第三方模块以统一的方式获取云资源数据，而无需关心底层不同云厂商的 API 差异。

## 1. 获取资源池列表

*   **接口描述**: 获取平台已接入的所有资源池的基本信息（ID、名称、厂商类型、区域）。
*   **Method**: `GET`
*   **Path**: `/api/standard/resource-pools`
*   **Auth**: Required

**响应示例**:

```json
{
  "message": "Success",
  "data": [
    {
      "id": "cloud-1",
      "name": "阿里云华东1",
      "provider": "aliyun",
      "region": "cn-hangzhou"
    },
    {
      "id": "cloud-2",
      "name": "华为云华南",
      "provider": "huaweicloud",
      "region": "cn-south-1"
    }
  ]
}
```

## 2. 获取资源查询指令

*   **接口描述**: 根据资源池 ID，获取用于查询该资源池 VPC 和 虚拟机（VM）列表的标准指令元数据。调用方可以使用返回的 `payload` 直接发起请求，无需自行拼装 URL 或处理厂商差异。
*   **Method**: `GET`
*   **Path**: `/api/standard/resource-pools/:id/query-commands`
*   **Auth**: Required

**请求参数**:

| 参数名 | 位置 | 类型 | 必填 | 描述 |
| :--- | :--- | :--- | :--- | :--- |
| id | Path | String | 是 | 资源池 ID |

**响应结构**:

*   `resourcePoolId`: 资源池 ID
*   `vpcQuery`: VPC 查询指令对象
*   `vmQuery`: 虚拟机查询指令对象

**指令对象 (QueryCommand) 结构**:

*   `description`: 指令描述
*   `type`: 指令类型（目前仅支持 `http_request`）
*   `payload`: 执行指令所需的数据
    *   `url`: 请求 URL (相对路径)
    *   `method`: HTTP 方法 (GET/POST/etc.)
    *   `headers`: 请求头
    *   `params`: 查询参数 (可选)
    *   `body`: 请求体 (可选)

**响应示例**:

```json
{
  "message": "Success",
  "data": {
    "resourcePoolId": "cloud-1",
    "vpcQuery": {
      "description": "Query VPCs for cloud 阿里云华东1 (aliyun)",
      "type": "http_request",
      "payload": {
        "url": "/api/clouds/cloud-1/resources/vpcs",
        "method": "GET",
        "headers": {
          "Content-Type": "application/json"
        }
      }
    },
    "vmQuery": {
      "description": "Query VMs for cloud 阿里云华东1 (aliyun)",
      "type": "http_request",
      "payload": {
        "url": "/api/clouds/cloud-1/resources/ecs-all",
        "method": "GET",
        "headers": {
          "Content-Type": "application/json"
        }
      }
    }
  }
}
```
