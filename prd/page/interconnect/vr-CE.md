CE设置向导
第2步:外网配置(CE to PE)
(一) 交互界面
1. 分组1:设定外网口
    a. 选择网卡,下拉框 ##通过VR配置查询,将所有interface 列出选择
    b. 配置网卡IPv4/IPv6地址,输入框 ##其中IPv6为必填
2. 分组2:设定BGP路由(CE to PE)
    a. 设定BGP asn,输入框
    b. 设定BGP Router-ID,输入框

(二) JSON拼接
1. "interfaces_GigabitEthernet": [ 
        {
            "name": "GigabitEthernet 0/3/0",  ##通过下拉框选择网卡
            "ipv4_static": "",   ##通过输入框输入IPv4地址，非必填
            "ipv6_static": "",   ##通过输入框输入IPv6地址，非必填
            "status": "up"  ##固定参数
        }],
2. "bgp": [
        {
            "asn": 100,  ##支持输入框编辑,取值范围为1-4294967295,提供输入框提示
            "router_id": "200.1.1.2",  ##通过输入框输入BGP Router-ID
            "bgp_ebgp_requires_policy": "disable",   ##固定参数
        }
    ]

第3步:内网配置(CE to local)
(一) 交互界面
1. 分组1:设定内网口
    a. 选择网卡,下拉框,## 通过VR配置查询,将所有interface 列出选择
    b. 配置网卡IPv4/IPv6地址,输入框 ##其中IPv6为必填

(二) JSON拼接
        "interfaces_GigabitEthernet": [ 
        {
            "name": "GigabitEthernet 0/3/0",  ##通过下拉框选择网卡
            "ipv4_static": "",   ##通过输入框输入IPv4地址，非必填
            "ipv6_static": "",   ##通过输入框输入IPv6地址，非必填
            "status": "up"  ##固定参数
        }],