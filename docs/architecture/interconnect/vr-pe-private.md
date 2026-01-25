角色设置向导-PE
第3步:内网配置(PE to CE)
## 支持设定多个内网配置，每组内网配置包括内网口+VRF+BGP。



2. 标题2:设定网络切片(VRF)
    a.网络切片(VRF ID)
    ## 每个内网配置只能关联一个VRF ID
    ## 每组内网配置的唯一标识是 VRF ID
    ##标识符JSON拼接
    "vrf": [
        9999,  ##手工输入
        9989  ## 如果有第二个内网配置，则其VRF号要继续在vrf结构体中添加
        ],


2. 标题2:设定内网口
    a. 选择网卡,下拉框,通过VR配置查询,将所有interface 列出选择
    b. 配置网卡IPv4/IPv6地址,其中IPv6为必填
    ##标识符JSON拼接
        "interfaces_GigabitEthernet": [ 
        {
            "name": "GigabitEthernet 0/3/0",  ##通过下拉框选择网卡
            "ipv4_static": "",   ##通过输入框，配置此网卡的IPv4，非必填
            "ipv6_static": "",   ##通过输入框，配置此网卡的IPv6，非必填
            "vrf": 9999,   ##通过关联VRF ID获得，不能手工输入
            "status": "up"  ##固定参数
        },
        {
            "name": "GigabitEthernet 0/3/0",  ## 如果有第二个内网配置，则其网卡信息要继续在interfaces_GigabitEthernet结构体中添加
            "ipv4_static": "",   
            "ipv6_static": "",   
            "vrf": 9989,  
            "status": "up"  
        }]


3. 标题3:设定BGP路由
    a.设定BGP asn
    b.设定BGP Router-ID
    ##标识符JSON拼接，注意这里是插入到"bgp": []，不要影响上一步已经添加的bgp参数
        {
            "asn": 100,  ##通过输入框输入，取值范围为1-4294967295，提供一个例如说明
            "vrf": 9999,  ##通过关联VRF ID获得，不能手工输入
            "router_id": "130.1.1.1",  ##通过输入框输入，提供一个例如说明
            "bgp_ebgp_requires_policy": "disable",  ##固定参数
            "address_family": [
                {
                    "address_family": "ipv4",  ##固定参数
                    "modifiler": "unicast",  ##固定参数
                    "export_route": "enable",  ##固定参数
                    "import_route": "enable",  ##固定参数
                    "auto_assign_sid": "enable"  ##固定参数
                }
            ]
        },
        {
            "asn": 200, ## 如果有第二个内网配置，则其asn信息要继续在vrf结构体中添加
            "vrf": 9989,
            "router_id": "130.1.1.2",
            "bgp_ebgp_requires_policy": "disable",
            "address_family": [
                {
                    "address_family": "ipv4", 
                    "modifiler": "unicast", 
                    "export_route": "enable", 
                    "import_route": "enable", 
                    "auto_assign_sid": "enable"
                }
            ]
        }