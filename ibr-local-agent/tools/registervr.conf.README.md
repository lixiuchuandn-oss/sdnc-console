# registervr.conf 字段说明

设备身份文件路径：`/usr/local/src/vrconf/registervr.conf`  
推荐日常在 **Paas「接入与身份」** 填写并保存；本说明供脱开 Paas、直接编辑本文件时使用。

agent / CSMCTL **按字段名读写**，与 JSON 键顺序无关。模板把关键字段排在前面，仅方便阅读。

## 注册前必填

| 字段 | 含义 | 注意 |
|------|------|------|
| **uuid** | CSMCTL / SDNC 实例主键 | 空则不会注册。改已有 uuid = 控制器上的**新设备** |
| **name** | 列表显示名 | 非空即可 |
| **vm_id** | 运维辅助编号 | 非主键；可与云主机实例 ID 对齐 |
| **mac** | 注册报文占位 MAC | 形态 `XX:XX:XX:XX:XX:XX`；常用本地管理位 `02:…`，**不是**网卡硬件 MAC |

另两项有默认值，一般保留即可：

| 字段 | 默认 |
|------|------|
| **type** | `VR` |
| **version** | `V1.0` |

## 可选

| 字段 | 含义 |
|------|------|
| **pool_id** / **pool_name** | 资源池对齐；不填不影响注册 |

## 手改示例（可注册）

```json
{
    "uuid": "1234567890123456789",
    "name": "pe1",
    "vm_id": "pe1-01",
    "mac": "02:11:22:33:44:55",
    "type": "VR",
    "version": "V1.0",
    "pool_id": "",
    "pool_name": ""
}
```

保存后等待 agent 发现变更并 `POST VR1/register`（或重启 `vrctl-agent`）。  
`uuid` 为空时 agent **不会**自动生成，也不会向 CSMCTL 注册。
