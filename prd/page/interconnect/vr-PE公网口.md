角色设置向导-PE
第2步:公网配置(PE to PE)

1. 标题1:设定SRv6标识
   a.设定SRv6 Locator 名称,必填
   b.设定SRv6 SID 前缀,必填
   ##标识符JSON拼接
   "segment\_routing\_srv6": {
   "locator": "pe2",
   "prefix": "2408:3333:1002::1"
   },
2. 标题2:设定公网口
   a. 选择网卡,下拉框,通过VR配置查询,将所有interface 列出选择,必填
   b. 配置网卡IPv4/IPv6地址,非必填
   c. 拼接JSON时，切记要将公网卡放在"interfaces\_GigabitEthernet"的第一个
   ##标识符JSON拼接
   "interfaces\_GigabitEthernet": \[
   {
   "name": "GigabitEthernet 0/3/0",  ##通过选择网卡关联
   "ipv4\_static": "",   ##通过输入框输入IPv4地址及掩码，非必填
   "ipv6\_static": "",   ##通过输入框输入IPv6地址及掩码，非必填
   "status": "up"  ##固定参数
   }],
3. 标题3:设定静态路由
   a. 设定IPv4及IPv6静态路由
   b. 均为非必填
   ##标识符JSON拼接
   "ipv4\_route": \[
   {
   "destination": "0.0.0.0/0",  ##支持输入框编辑，默认值是0.0.0.0/0，
   "dev": "GigabitEthernet 0/9/1",  ##通过设定公网口，设定的网卡关联
   "priority": 100   ##固定参数
   }],
   "ipv6\_route": \[
   {
   "destination": "0::0/0",  ##支持输入框编辑，默认值是0::0/0，
   "via": "500::1",  ##支持输入框编辑
   }],
4. 标题4:设定BGP路由
   a.设定BGP asn
   b.设定BGP Router-ID
   c.设定本端需向骨干网发布的IPv4网段
   d.设定本端需向骨干网发布的IPv6网段
   ##标识符JSON拼接
   "bgp": \[
   {
   "asn": 100,  ##支持输入框编辑,取值范围为1-4294967295,提供输入框提示
   "router\_id": "200.1.1.2",  ##支持输入框编辑
   "bgp\_ebgp\_requires\_policy": "disable",   ##固定参数
   "timer\_bgp\_KA": 2,   ##固定参数
   "timer\_bgp\_HA": 8,   ##固定参数
   "bgp\_fast\_convergence": "enable",   ##固定参数
   "segment\_routing\_srv6": {
   "locator": "pe2"  ##通过设定SRv6 Locator 名称关联
   }
   }
   ]
