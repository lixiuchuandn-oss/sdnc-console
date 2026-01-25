创建SRv6隧道设置向导
第2步:选择PE对
## BGP信息中，第一个asn结构体用于PE互联，后续的asn结构体用于CE互联
## 选中PE-A和PE-B后，需要为他们插入互联信息，插入位置在第一个asn结构体中
### 第一个asn结构体是公网自治域
### 第一个网卡是PE的公网网卡

(一) 交互界面
1. 选择PE-A
    a. 选择PE实例  ## 选择与PE-B互联的PE实例
2. 选择PE-B
    a. 选择PE实例  ## 选择与PE-A互联的PE实例

(二) JSON拼接
## neighbor信息
## 如第一个asn结构体中已存在数据，千万不要动，这是PE-A 已经与PE-？建立互通，现在需要与PE-B建立互通
1. "neighbor_disable_connected_check": [
        "500::1"  ##填写对端PE的公网卡IP地址（如果是插入PE-A的json，此处就要写PE-B的公网卡地址）
        ],

2. "neighbor": [
        {
            "remote_ip": "500::1",  ##填写对端PE的公网卡IP地址（如果是插入PE-A的json，此处就要写PE-B的公网卡地址）
            "remote_as": 100  ##填写对端PE的第一个asn号（如果是插入PE-A的json，此处就要写PE-B的一个asn号）
        }],

## 地址族信息
1. "address_family": [
        {
            "address_family": "ipv6",   ##固定参数
            "modifiler": "unicast",   ##固定参数
            "activate_address_family": [
                "500::1"  ##填写对端PE的公网卡IPv6地址（如果是插入PE-A的json，此处就要写PE-B的公网卡地址）
            ],
            "network": [
                "500::0/64" ##填写本端公网卡的IPv6地址段（如果是插入PE-A的json，此处就要写PE-A的公网卡地址段）
            ]
        },
        {
            "address_family": "ipv4",   ##固定参数
            "modifiler": "vpn",   ##固定参数
            "activate_address_family": [
                "500::1"  ##填写对端PE的公网卡IP地址（如果是插入PE-A的json，此处就要写PE-B的公网卡地址）
            ]
        },
    ]
