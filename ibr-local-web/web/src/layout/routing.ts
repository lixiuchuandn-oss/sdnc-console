import type { AppDomain } from './AppShell.js';

export type RouteMeta = {
	subnav: string;
	title: string;
	topKey: AppDomain;
};

export const ROUTE_META = new Map<string, RouteMeta>([
	['/', { subnav: '概览', title: '仪表板', topKey: 'device' }],
	['/init', { subnav: '参数配置', title: '初始化网卡', topKey: 'device' }],
	['/device/ip', { subnav: '参数配置', title: '设定网卡IP', topKey: 'device' }],
	['/device/service', { subnav: '参数配置', title: '配置服务', topKey: 'device' }],
	['/ops/health', { subnav: '运维管理', title: '健康巡检', topKey: 'device' }],
	['/ops/logs', { subnav: '运维管理', title: '查看日志', topKey: 'device' }],
	['/ops/agent', { subnav: '运维管理', title: 'Agent 状态', topKey: 'device' }],

	['/forward/cloud-config', { subnav: '云配置', title: '配置概览', topKey: 'forward' }],

	['/forward/subif', { subnav: '接口', title: 'VLAN 子接口', topKey: 'forward' }],
	['/forward/vrrp', { subnav: '接口', title: 'VRRP', topKey: 'forward' }],

	['/forward/vrf', { subnav: '路由', title: 'VRF', topKey: 'forward' }],
	['/forward/routes', { subnav: '路由', title: 'IPv4 路由', topKey: 'forward' }],
	['/forward/routes/ipv6', { subnav: '路由', title: 'IPv6 路由', topKey: 'forward' }],
	['/forward/bgp', { subnav: '路由', title: 'BGP 邻居', topKey: 'forward' }],
	['/forward/srv6', { subnav: '路由', title: 'SRv6', topKey: 'forward' }],

	['/forward/routing-policy', { subnav: '路由策略', title: '策略对象', topKey: 'forward' }],

	['/forward/acl', { subnav: '访问控制', title: 'ACL 规则', topKey: 'forward' }],

	['/forward/nat/static', { subnav: '地址转换', title: '静态 NAT', topKey: 'forward' }],
	['/forward/nat/snat', { subnav: '地址转换', title: 'SNAT', topKey: 'forward' }],
	['/forward/nat/dnat', { subnav: '地址转换', title: 'DNAT', topKey: 'forward' }],

	['/forward/ipsec/tunnel', { subnav: 'VPN', title: 'IPsec 隧道', topKey: 'forward' }],
	['/forward/ipsec/guard', { subnav: 'VPN', title: '隧道守卫', topKey: 'forward' }],

	['/security/assets/list', { subnav: '资产发现', title: '资产列表', topKey: 'security' }],
	['/security/assets/scan', { subnav: '资产发现', title: '立即扫描', topKey: 'security' }],
	['/security/services/domain', { subnav: '云端', title: '网际路由域', topKey: 'security' }],
	['/security/services/list', { subnav: '云端', title: '安全服务', topKey: 'security' }],
	['/security/aisoc/threats', { subnav: '威胁情报', title: 'AI 威胁情报', topKey: 'security' }],
]);

export const DOMAIN_HOME: Record<AppDomain, string> = {
	device: '/',
	forward: '/forward/routes',
	security: '/security/assets/list',
};
