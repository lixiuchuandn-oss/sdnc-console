# VR 控制器接口

## 1. 概述
本接口集提供 VR (Virtual Router) 实例的查询、注册、配置管理等功能。

*   **Auth**: Required (HMAC-SHA256)
*   **Base URL**: `/V2` (部分接口以具体说明为准)

## 2. 接口详情

### 2.1 分页获取 VR 虚机
*   **Method**: `GET`
*   **Path**: `/V2/ctcontrol/VR1/pagelist`
*   **Query Params**:
    *   `page_num`: 页码 (默认 1)
    *   `page_size`: 每页条数 (默认 10)
*   **Response Fields**:
    *   `pool_id`, `pool_name`: 资源池信息
    *   `vm_id`, `name`, `uuid`: 虚拟机基本信息
    *   `mac`: MAC 地址
    *   `version`: 版本号
    *   `type`: 类型
    *   `health_status`: 在线状态 (`ONLINE` / `OFFLINE`)
    *   `page_size`, `page_num`, `total`: 分页元数据
*   **Errors**: `10001`~`10005`, `5001`

### 2.2 查询资源池下主机的安全能力 (VM04)
*   **Method**: `GET`
*   **Path**: `/V2/ctcontrol/VM04/host/vms`
*   **Query Params**:
    *   `host_id`: (可选) 主机 ID。若不填写，则查询资源池下所有能力。
*   **Response Data**: 
    *   List of objects: `{ vm_id, vm_name, status, vm_type, manage_ip, interfaceList, dev_disk }`
*   **Errors**: `10009` (host_id不存在), `200`, `500`

### 2.3 VR 实例注册
*   **Method**: `POST`
*   **Path**: `/V2/vrcontrol/VR1/register`
*   **Body**:
    *   `pool_id`, `pool_name`
    *   `vm_id`, `name`, `uuid`
    *   `mac`
    *   `version`
    *   `type`: 固定为 `VR`
*   **Errors**: `200`, `500`, `10001`~`10005`

### 2.4 VR 配置查询
*   **Method**: `GET`
*   **Path**: `/V2/ctcontrol/VR2/VRConfig`
*   **Query Params**:
    *   `uuid`: (必填) VR 实例 UUID
*   **Response Fields**:
    *   `vrf`, `acl`, `ipsec`
    *   `interfaces`, `subinterfaces`
    *   `ipv4_route`, `ipv6_route`
    *   `segment_routing_srv6`, `bgp`

### 2.5 VR 配置编辑（新增或更新）
*   **Method**: `POST`
*   **Path**: `/V2/ctcontrol/VR2/VRConfig`
*   **Description**: 全量更新。若记录存在则更新，不存在则新增。
*   **Body**:
    *   `uuid`: (必填)
    *   `vrf`, `acl`, `ipsec`
    *   `nat_address_group`
    *   `interfaces`, `subinterfaces`
    *   `ipv4_route`, `ipv6_route`
    *   `segment_routing_srv6`, `bgp`
*   **Errors**: `19000` (参数错误)

## 3. 参考
*   通信规约与认证：`docs/specs/api/api-protocol.md`
