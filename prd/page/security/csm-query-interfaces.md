# CSM 资源查询接口文档

> 本文档整理自 Dify 知识库查询结果。

## 1. 虚拟安全网元 (VM04)

### 1.1 查询资源池下主机的安全能力 (虚拟网元)

*   **接口描述**: 查询资源池下主机的安全能力 (通常指 VSW 实例)
*   **Method**: `GET`
*   **Path**: `/V2/ctcontrol/VM04/host/vms`

**请求参数**:

| 参数名 | 类型 | 是否必传 | 描述 |
| :--- | :--- | :--- | :--- |
| host_id | String | 否 | 物理机ID (如果不传则查询所有?) |

**响应参数**:

| 参数名 | 类型 | 描述 |
| :--- | :--- | :--- |
| vm_id | String | 虚机ID |
| vm_name | String | 虚机名称 |
| vm_group_id | String | 组ID |
| status | Int | 状态 |
| manage_ip | String | 管理IP |
| host_id | String | 所属物理机ID |

---

## 2. 物理主机管理 (VM02)

### 2.1 查询主机列表

*   **接口描述**: 查询资源池下的主机列表
*   **Method**: `GET`
*   **Path**: `/V2/ctcontrol/VM02/hosts`

**请求参数**:

| 参数名 | 类型 | 是否必传 | 描述 |
| :--- | :--- | :--- | :--- |
| page_size | Int | 是 | 每页大小 |
| page_num | Int | 是 | 页码 |

**响应参数**:

| 参数名 | 类型 | 描述 |
| :--- | :--- | :--- |
| host_id | String | 主机ID |
| host_name | String | 主机名称 |
| host_manage_ip | String | 管理IP |
| host_active_status | Int | 存活状态 (0:存活, 1:非存活) |
| cpu_usage | Double | CPU使用率 |
| mem_usage | Double | 内存使用率 |

### 2.2 查询主机详情

*   **接口描述**: 查询资源池下的主机详情
*   **Method**: `GET`
*   **Path**: `/V2/ctcontrol/VM02/host`

**请求参数**:

| 参数名 | 类型 | 是否必传 | 描述 |
| :--- | :--- | :--- | :--- |
| host_id | String | 是 | 主机ID |

---

## 3. VR 虚机 (VR1)

### 3.1 分页获取 VR 虚机

*   **Method**: `GET`
*   **Path**: `/V2/ctcontrol/VR1/pagelist`

**请求参数**:

| 参数名 | 类型 | 是否必传 | 描述 |
| :--- | :--- | :--- | :--- |
| page_size | Int | 是 | 分页大小 |
| page_num | Int | 是 | 页码 |
