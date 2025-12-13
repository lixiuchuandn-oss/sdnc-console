# VR 控制器接口

## 分页获取 VR 虚机
- `GET /V2/ctcontrol/VR1/pagelist?page_num=1&page_size=10`
- 字段：`pool_id/pool_name/vm_id/mac/name/uuid/version/type/health_status/page_size/page_num/total/page[]`
- 在线状态：`health_status` 取值 `ONLINE/OFFLINE`
- 错误码：`10001/10002/10003/10004/10005/5001`

## VR 实例注册
- `POST /V2/vrcontrol/VR1/register`
- 参数：`pool_id/pool_name/vm_id/mac/name/uuid/version/type(=VR)`
- 错误码：`200/500/10001/10002/10003/10004/10005`

## VR 配置查询
- `GET /V2/ctcontrol/VR2/VRConfig?uuid=<uuid>`（必填 `uuid`）
- 返回：`vrf/acl/ipsec/interfaces*/subinterfaces*/ipv4_route/ipv6_route/segment_routing_srv6/bgp`

## VR 配置编辑（新增或更新）
- `POST /V2/ctcontrol/VR2/VRConfig`（存在更新，不存在新增，需传全量）
- 参数概览：`uuid/vrf/acl/ipsec/nat_address_group/interfaces* /subinterfaces* /ipv4_route/ipv6_route/segment_routing_srv6/bgp`
- 业务错误码：`19000 参数错误`

## 参考
- 通信规约与认证：`docs/api/communication.md`
- 历史来源与示例：`PRD/0. 公共内容/api_doc/VR实例注册.txt`、`VR配置查询.txt`、`VR配置编辑.txt`