# CSM SSLO 流量编排接口文档

> 本文档整理自 Dify 知识库查询结果。

## 1. 服务链管理 (VM08)

### 1.1 添加服务链

*   **接口描述**: 添加指定客户的服务链
*   **Method**: `POST`
*   **Path**: `/V2/ctcontrol/VM08/service-chain`

**请求参数**:

| 参数名 | 类型 | 是否必传 | 描述 |
| :--- | :--- | :--- | :--- |
| network_ids | String | 否 | 防护对象ID列表 (分号分隔?) |
| serial_list | String | 否 | 串行设备ID列表 (分号分隔) |
| monitor_list | String | 是 | 旁路/监控设备ID列表 |
| vrf_id | Int | 否 | VRF ID |

**请求样例**:

```json
{
    "network_ids": "b3bd56e6-3668-4d1f-8ffb-8dd86710b21c;c3bd56e6-3668-4d1f-8ffb-8dd86710b21c",
    "monitor_list": "a4e3e9cf-a4f8-40dc-8d7d-9f9b5d8791bf",
    "serial_list": "cc9bb531-7d31-4fe1-ba23-ab20e6cb4858;f93ebebc-a7d7-4f91-8fbf-ff39d3e4af42",
    "vrf_id": 1
}
```

**响应参数**:

| 参数名 | 类型 | 描述 |
| :--- | :--- | :--- |
| msg | String | 消息 |
| service_chain_id | String | 服务链ID |

**响应样例**:

```json
{
    "code": 200,
    "msg": "success",
    "requestId": "5fdd827e7099-4dd6b435d3c9c7402a7f",
    "data": {
        "service_chain_id": "5fdd827e7099-4dd6b435d3c9c7402a7f"
    }
}
```

### 1.2 删除服务链

*   **接口描述**: 删除指定客户的服务链
*   **Method**: `DELETE`
*   **Path**: `/V2/ctcontrol/VM08/service-chain`

**请求参数**:

| 参数名 | 类型 | 描述 |
| :--- | :--- | :--- |
| pool_id | String | 资源池ID (Path参数?) |
| service_chain_id | String | 服务链ID |

**请求样例**:

```
/V1.0/ctcontrol/VM08/service-chain?service_chain_id=fa755f80-9e0a-425f-8b11-431b5e2ed7f6
```
*(注意: 样例中 Path 版本为 V1.0，但描述中为 V2，建议优先使用 V2)*

**响应样例**:

```json
{
    "code": 200,
    "msg": "success",
    "requestId": "5fdd827e7099-4dd6b435d3c9c7402a7f",
    "data": ""
}
```

## 2. 资产/网络查询 (VM07)

### 2.1 按IP+Port查询资产详情

*   **接口描述**: 按ip+port查询资产详情 (同一个ip带端口和不带端口是两个资产)
*   **Method**: `GET`
*   **Path**: `/V2/ctcontrol/VM07/customer/network/ipAndPort`

**请求参数**:

| 参数名 | 类型 | 是否必填 | 描述 |
| :--- | :--- | :--- | :--- |
| ip | String | 是 | IP地址 |
| port | String | 否 | 端口 |

**响应样例**:

```json
{
    "code": 200,
    "msg": "success",
    "requestId": "5fdd827e7099-4dd6b435d3c9c7402a7f",
    "data": {
        "network_id": "b3bd56e6-3668-4d1f-8ffb-8dd86710b21c",
        "type": "ip",
        "ip_type": "ipv4",
        "value": "x.x.x.x",
        "port": "8000"
    }
}
```

## 3. 错误码说明

| Code | 说明 |
| :--- | :--- |
| 200 | 成功 |
| 500 | 内部错误 |
| 10001 | tonce字段缺失 |
| 10002 | tonce时间戳超时 |
| 10003 | Authorization字段缺失 |
| 10004 | Authorization字段错误 |
| 10005 | 未授权访问 |
| 70026 | ip不能为空 |
| 80001 | service_chain_id重复 |
| 80004 | type不能为空 |
