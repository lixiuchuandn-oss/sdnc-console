# 1层结构
访问资源池管理页面，从列表中选择华为公有云类型资源池，即可访问华为资源池详情页面。
华为云资源池详情页面 frontend\src\pages\Clouds\Hw\CloudDetailHw.tsx

## 资源池信息表格
资源名称	华东上海1资源池	
资源供应商	华为云	
资源地域	cn-east-3	
资源类型	central
资源状态	在线	
Endpoint	https://ecs.cn-east-3.myhuaweicloud.com	
项目ID	0d3618b58b00f3072f54c014b473b366	
资源ID	152472da-a1de-4062-97f9-b23f3dfe2f51
创建时间	2025-12-05T07:27:46.000Z	
更新时间	2025-12-07T07:49:31.000Z

## 云主机表格
### 实例名/ID
华为云VR实例  [数据来源 "name": "华为云VR实例"]
ef489d4a-653c-4eec-a058-e25bb115fd5d  [数据来源 "id": "ef489d4a-653c-4eec-a058-e25bb115fd5d"]
### 状态
ACTIVE（运行中）  [数据来源 "status": "ACTIVE"]
### 实例规格
2vCPU，8GB内存  [数据来源 "vcpus": "2","ram": "8192"]
规格名称:x1.2u.8g  [数据来源 "name": "x1.2u.8g"]
### 镜像
Huawei Cloud EulerOS 2.0 Standard 64 bit（Linux 64位）  [数据来源 "image_name": "Huawei Cloud EulerOS 2.0 Standard 64 bit"]
### VPC/子网
vpc-default  [数据来源 "name": "vpc-default"]
77d8618c-bfe4-4a21-9c43-5c82e671f095  [数据来源 "id": "77d8618c-bfe4-4a21-9c43-5c82e671f095"]
### 公网/内网IP
公网IP：60.204.250.65  [数据来源 "addr": "60.204.250.65"]
内网IP：192.168.1.216（主）  [数据来源 "addr": "192.168.1.216","primary": true]

## VPC表格
### 名称/ID
vpc-default  [数据来源 "name": "vpc-default"]
vpc-77d8618c...  [数据来源 "id": "vpc-77d8618c..."]
### 网段
192.168.0.0/16  [数据来源 "cidr": "192.168.0.0/16"]
### 状态
OK（可用）  [数据来源 "status": "OK"]
### 路由条目数
共 1 条（目的地/下一跳）  [数据来源 "routes": [ { "destination": "10.0.0.0/24", "nexthop": "192.168.1.216" } ]]
### 地址使用度量开关
关闭（建议开启以精确计算使用率）  [数据来源 "enable_network_address_usage_metrics": false]
### 描述
用于测试VR IPsecVPN隧道  [数据来源 "description": ""]
### 创建/更新
创建: 2025-12-05 14:19  [数据来源 "created_at": "2025-12-05T06:19:54"]

## 子网表格
### 名称/ID 
subnet-a  [数据来源 "name": "subnet-a"]
subnet-7f2c...  [数据来源 "id": "subnet-7f2c..."]
### CIDR/网关
192.168.1.0/24（网关: 192.168.1.1）  [数据来源 "cidr": "192.168.1.0/24","gateway_ip": "192.168.1.1"]
### 所属VPC
vpc-default  [数据来源 "name": "vpc-default"]
77d8618c-bfe4-4a21-9c43-5c82e671f095  [数据来源 "id": "77d8618c-bfe4-4a21-9c43-5c82e671f095"]
### 状态
ACTIVE（可用）  [数据来源 "status": "ACTIVE"]
### 可用IP数
可用 250 个（用于计算使用率）  [数据来源 "available_ip_address_count": 250]
### 创建/更新
创建: 2025-12-05 15:42  [数据来源 "created_at": "2025-12-05T07:42:49"]

## 安全组表格
### 名称/ID（支持关键字查询）
sg-web  [数据来源 "name": "sg-web"]
2e38b641-3c0f-4b5a-9b1f-7f1e6e2c6f7a  [数据来源 "id": "2e38b641-3c0f-4b5a-9b1f-7f1e6e2c6f7a"]
### 所属VPC
vpc-default  [数据来源 "name": "vpc-default"]
77d8618c-bfe4-4a21-9c43-5c82e671f095  [数据来源 "id": "77d8618c-bfe4-4a21-9c43-5c82e671f095"]
### 规则统计（入/出站）
入站: 8 条；出站: 6 条  [数据来源 "security_group_rules": [ { "direction": "ingress" }, { "direction": "egress" } ... ]]
### 引用实例数
被 12 台云主机引用  [数据来源 "port_count": 12]
### 创建时间
2024-07-01 16:30  [数据来源 "created_at": "2024-07-01T08:30:00Z"]

## 弹性公网IP表格
### 公网IP/ID
60.204.250.65  [数据来源 "public_ip_address": "60.204.250.65"]
eip-3e2c...   [数据来源 "id": "eip-3e2c..."]
### 带宽
bw-prod（10Mbps，独享）  [数据来源 "bandwidth": "bw-prod"]
### 绑定资源
绑定: 网卡 port-abc...  [数据来源 "associate_instance": "port-abc..."]
### 状态
ACTIVE（已分配）  [数据来源 "status": "ACTIVE"]

## 负载均衡（ELB）表格
### 名称/ID
elb-web  [数据来源 "name": "elb-web"]
elb-51ac...  [数据来源 "id": "elb-51ac..."]
### 类型/VIP
公网型；VIP: 60.204.250.70  [数据来源 "type": "public","vip_address": "60.204.250.70"]
### 监听器/后端池数量
监听器: 3；后端池: 2  [数据来源 "listener_count": 3,"pool_count": 2]
### 所属子网/VPC
subnet-a / vpc-default  [数据来源 "name": "subnet-a","name": "vpc-default"]
### 状态
ACTIVE（运行中）  [数据来源 "status": "ACTIVE"]

## NAT网关表格
### 名称/ID
nat-prod  [数据来源 "name": "nat-prod"]
nat-9b3c...  [数据来源 "id": "nat-9b3c..."]
### 类型/状态
增强型；ACTIVE  [数据来源 "spec": "enhanced","status": "ACTIVE"]
### 绑定EIP数量
EIP: 3 个  [关联合同的 EIP 列表计数]
### 所属子网/VPC
subnet-a / vpc-default  [数据来源 "name": "subnet-a","name": "vpc-default"]

## 路由表表格
### 名称/ID
rtb-vpc-default  [数据来源 "name": "rtb-vpc-default"]
2f7d3ad2-736f-42d3-955b-147c38e0e8e2  [数据来源 "id": "2f7d3ad2-736f-42d3-955b-147c38e0e8e2"]
### 默认路由表
主路由表（默认） / 备用路由表  [数据来源 "default": true]
### 关联子网数/列表
关联 4 个子网（可悬浮/展开显示子网ID）  [数据来源 "subnets": [ { "id": "c9bbea8c-3673-4451-90f1-cc5240fd54fb" }, { "id": "ae0159d9-f829-43e0-b142-eba004fa3a07" }, { "id": "8fa028a5-aad9-46bc-8f2b-1db68f838227" }, { "id": "e27d016a-7c25-4306-aba3-04de48cbc0ec" } ]]
### 所属VPC
vpc-default  [数据来源 "name": "vpc-default"]
77d8618c-bfe4-4a21-9c43-5c82e671f095  [数据来源 "id": "77d8618c-bfe4-4a21-9c43-5c82e671f095"]
### 创建/更新
创建: 2025-12-05 14:19  [数据来源 "created_at": "2025-12-05T06:19:54"]

# 2层结构 云主机详情
从华为资源池详情页面，点击云主机标签页，点击某云主机记录行内的详情按钮， 即可访问华为云ECS详情页面。
华为云ECS详情页面 frontend\src\pages\Clouds\Hw\EcsDetailHw.tsx

## 云主机详情表格
实例ID	ef489d4a-653c-4eec-a058-e25bb115fd5d	
实例名	华为云VR实例
状态	运行中
规格	x1.2u.8g / 2vCPU / 8GB
可用区	cn-east-3a	
VPC	hw_test_vpc
子网	外网；中网	
私网IP	192.168.2.138, 192.168.1.216
公网IP	60.204.250.65, 60.204.250.65	
镜像	Huawei Cloud EulerOS 2.0 Standard 64 bit
安全组	-	
标签	_sys_type_hcss_x
创建时间	2025-12-05T07:54:32Z	
更新时间	2025-12-08T06

## 网络接口（Port/ENI）卡片
标题：左侧 网卡名称 eni-app-01  | 右侧 状态徽章 [数据来源 "name": "eni-app-01","status": "ACTIVE"]
左侧列：
网卡ID 159be8c8-f053-4efa-ba09-aa523e17486a  [数据来源 "id": "159be8c8-f053-4efa-ba09-aa523e17486a"]
私有IP地址 192.168.1.216  [数据来源 "ip_address": "192.168.1.216"]
弹性公网IP 60.204.250.65  [数据来源 "public_ip_address": "60.204.250.65"]
MAC地址 fa:16:3e:3d:96:6d  [数据来源 "mac_address": "fa:16:3e:3d:96:6d"]
右侧列：
VPC网络 hw_test_vpc  [数据来源 "vpc_id": "77d8618c-bfe4-4a21-9c43-5c82e671f095"]
子网信息 外网 (192.168.1.0/24)  [数据来源 "subnet_id": "subnet-7f2c..."]
安全组 -  [数据来源 "security_groups": []]
源/目的检查 开启/禁用  [数据来源 "source_dest_check": true]

## 云硬盘（EVS）卡片
标题：左侧 云硬盘名称 data-vol  | 右侧 状态徽章 [数据来源 "name": "data-vol","status": "in-use"]
左侧列：
云硬盘ID vol-91ab...  [数据来源 "id": "vol-91ab..."]
类型 GPSSD  [数据来源 "volume_type": "GPSSD"]
可启动 是  [数据来源 "bootable": true]
右侧列：
容量 100GB  [数据来源 "size": 100]
挂载点 /dev/vda  [数据来源 "device": "/dev/vda"]
创建时间 2025-12-05T07:54:36.735560  [数据来源 "created_at": "2025-12-05T07:54:36.735560Z"]

## 弹性公网IP卡片
标题：左侧 弹性公网IP 60.204.250.65  | 右侧 状态徽章 [数据来源 "public_ip_address": "60.204.250.65","status": "ACTIVE"]
左侧列：
弹性公网IPID eip-3e2c...  [数据来源 "id": "eip-3e2c..."]
带宽 bw-prod（10Mbps，独享）  [数据来源 "bandwidth": "bw-prod"]
右侧列：
绑定资源 绑定: 网卡 port-abc...  [数据来源 "associate_instance": "port-abc..."]
状态 ACTIVE（已分配）  [数据来源 "status": "ACTIVE"]

## 监控趋势卡片
筛选时间范围 最近 1 小时  [数据来源 "time_range": "1h"]
时间窗口 [数据来源 "time_window": "1h"]
统计方式 [数据来源 "statistics": "avg,max,min"]
cpu利用率 5%  [数据来源 "cpu_utilization": 5]
cpu空闲率 95%  [数据来源 "cpu_idle": 95]
cpu iowait 0%  [数据来源 "iowait": 0]
cpu 用户态 5%  [数据来源 "user": 5]
cpu 内核态 5%  [数据来源 "kernel": 5]
内存使用率 10%  [数据来源 "memory_utilization": 10]
内存可用 7GB  [数据来源 "memory_available": 7]

## 审计日志
时间	事件	操作	资源类型	资源名	响应码	IP	跟踪侧	评级
2025-12-08 14:30:00	CreateEip	CreateEip	ElasticIP	eip-3e2c...	200	60.204.250.65	Client	INFO
2025-12-08 14:35:00	AssociateEip	AssociateEip	ElasticIP	eip-3e2c...	200	60.204.250.65	Client	INFO
2025-12-08 14:40:00	DisassociateEip	DisassociateEip	ElasticIP	eip-3e2c...	200	60.204.250.65	Client	INFO

## 云备份列表
备份ID	backup-1234...	[数据来源 "id": "backup-1234..."]
备份名称	hw_test_vpc_backup	[数据来源 "name": "hw_test_vpc_backup"]
备份类型	全量备份	[数据来源 "type": "full"]
备份状态	完成	[数据来源 "status": "completed"]
备份大小	100GB	[数据来源 "size": 100]
备份时间	2025-12-08 14:30:00	[数据来源 "created_at": "2025-12-08T06:30:00Z"]
备份周期	每天	[数据来源 "cycle": "daily"]

# 2层结构 VPC详情
从华为资源池详情页面，点击VPC标签页，点击某VPC记录行内的详情按钮，即可访问华为云VPC详情页面。
华为云VPC详情页面 frontend\src\pages\Clouds\Hw\VpcDetailHw.tsx

## VPC详情信息表格
VPCID 77d8618c-bfe4-4a21-9c43-5c82e671f095  [数据来源 "id": "77d8618c-bfe4-4a21-9c43-5c82e671f095"]
VPC名 hw_test_vpc  [数据来源 "name": "hw_test_vpc"]
可用区 cn-east-3a, cn-east-3b, cn-east-3c  [数据来源 "availability_zones": ["cn-east-3a", "cn-east-3b", "cn-east-3c"]]
CIDR 192.168.0.0/16  [数据来源 "cidr_block": "192.168.0.0/16"]

## VPC详情卡片
