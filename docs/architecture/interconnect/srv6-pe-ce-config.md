创建SRv6隧道设置向导
第3步:选择CE对
## PE和CE选中后,需要为他们互相插入互联信息，到其JSON配置文件内，PE-A 和 CE-A为一组，PE-B 和 CE-B为一组
## PE的BGP信息中，第一个asn结构体用于PE的运营商网络互联，后续的asn结构体用于客户侧的CE互联
## PE的内网配置包括内网口+VRF+BGP_asn，CE会通过公网口与PE的内网口进行互联

(一) 交互界面
1. 选择CE-A
    a. 选择CE实例  ## 选择与PE-A互联的CE实例
    B. 选择PE-A 内网口 ## 选择PE-A与CE-A互联的内网口
2. 选择CE-B
    a. 选择CE实例  ## 选择与PE-B互联的CE实例
    B. 选择PE-B 内网口 ## 选择PE-B与CE-B互联的内网口

(二) JSON拼接说明
## 下方JSON拼接的说明，以PE-A举例，PE-B同理
## 由于此时已经选定PE-A与CE-A互联的内网口,所以可以根据选定的内网口定位 PE-A 的内网配置组

# PE-A 互联信息
## PE IPv6路由信息 
## 在"ipv6_route"中,插入PE-A的IPv6路由信息，如果不存在，则创建一个新的结构体
1. "ipv6_route": [
        {
            "vrf": 9999,   ## 从PE-A已选定的内网卡，获取VRF ID
            "destination": "2408:4444:1002::/64",  ##填写PE-A的prefix加/64
            "via": "500::1"  ##填写PE-B的公网卡IPv6地址
        }],

## PE 内网配置组互联信息
## 在bgp → asn → neighbor中,插入CE的公网IP和asn号
## 从PE-A已选定的内网卡，获取VRF ID, 通过此VRF ID定位到PE-A的内网bgp asn结构体
## 已经选定PE-A与CE-A互联的内网口,所以可以根据选定的内网口定位 PE-A 的内网配置组
2.  "bgp": [
            {
            "vrf": 9999  ## 从PE-A已选定的内网卡，获取VRF ID
            "asn": 900,  ## 通过VRF ID，定位到PE-A的bgp asn值
            "router_id": "200.1.1.2",  ## 通过VRF ID，定位到PE-A的bgp router_id值
            "bgp_ebgp_requires_policy": "disable",  ## 固定参数
            "neighbor":[  ## 插入neighbor信息，如不存在，则创建一个新的neighbor结构体
            {
                "remote_ip": "130.1.1.9", ## 本端CE的公网口（第一个网口）IPv4地址
                "remote_as": 400  ## 本端CE的bgp内 asn号
            },
            {
                "route_distinguisher": "200:11",  ## 增加route_distinguisher，PE-A、PE-B、CE-A、CE-B的route_distinguisher 要互不相同，需要随机生成
                "route_target": "200:200",  ## 增加route_target，PE-A、PE-B、CE-A、CE-B的route_target 要完全相同，需要随机生成
            }],

# CE-A 互联信息
## 在CE的bgp标识符,第1个结构体中,插入neighbor数据
1.  "bgp": [
            {
            "bgp_ebgp_requires_policy": "disable", ## ← 在此位置下方插入neighbor信息
            "neighbor_disable_connected_check": [
                "130.1.1.2"   ## PE-A 内网配置组的 内网口IP
            ],
            "neighbor":[
            {
                "remote_ip": "130.1.1.2",   ## PE-A 内网配置组的 内网口IP
                "remote_as": 100    ## PE-A 内网配置组的 asn号
            },
            {
                "route_distinguisher": "200:11",  ## 增加route_distinguisher，PE-A、PE-B、CE-A、CE-B的route_distinguisher 要互不相同，需要随机生成
                "route_target": "200:200",  ## 增加route_target，PE-A、PE-B、CE-A、CE-B的route_target 要完全相同，需要随机生成
            }],
