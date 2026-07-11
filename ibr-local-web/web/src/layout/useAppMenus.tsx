import {
	AlertOutlined,
	ApiOutlined,
	AppstoreOutlined,
	BankOutlined,
	CloudOutlined,
	ClusterOutlined,
	ControlOutlined,
	DashboardOutlined,
	DeploymentUnitOutlined,
	ExportOutlined,
	EyeOutlined,
	FileTextOutlined,
	FilterOutlined,
	GatewayOutlined,
	ImportOutlined,
	LinkOutlined,
	LaptopOutlined,
	LockOutlined,
	MedicineBoxOutlined,
	NodeIndexOutlined,
	PartitionOutlined,
	RadarChartOutlined,
	RobotOutlined,
	SafetyOutlined,
	ShareAltOutlined,
	UnorderedListOutlined,
} from '@ant-design/icons';
import { useMemo } from 'react';
import type { AppDomain } from './AppShell.js';
import type { NavSection } from './navTypes.js';

export function useAppNavSections(domain: AppDomain): NavSection[] {
	return useMemo(() => {
		if (domain === 'forward') {
			return [
				{
					key: 'fwd-cloud',
					items: [{ key: '/forward/cloud-config', label: '配置概览', icon: <CloudOutlined /> }],
				},
				{
					key: 'fwd-l2',
					items: [
						{ key: '/forward/subif', label: 'VLAN 子接口', icon: <PartitionOutlined /> },
						{ key: '/forward/vrrp', label: 'VRRP', icon: <ClusterOutlined /> },
					],
				},
				{
					key: 'fwd-route',
					items: [
						{ key: '/forward/vrf', label: 'VRF', icon: <BankOutlined /> },
						{ key: '/forward/routes', label: 'IPv4 路由', icon: <NodeIndexOutlined /> },
						{ key: '/forward/routes/ipv6', label: 'IPv6 路由', icon: <ShareAltOutlined /> },
						{ key: '/forward/bgp', label: 'BGP 邻居', icon: <DeploymentUnitOutlined /> },
						{ key: '/forward/srv6', label: 'SRv6', icon: <GatewayOutlined /> },
					],
				},
				{
					key: 'fwd-policy',
					items: [{ key: '/forward/routing-policy', label: '策略对象', icon: <FilterOutlined /> }],
				},
				{
					key: 'fwd-acl',
					items: [{ key: '/forward/acl', label: 'ACL 规则', icon: <SafetyOutlined /> }],
				},
				{
					key: 'fwd-nat',
					items: [
						{ key: '/forward/nat/static', label: '静态 NAT', icon: <LinkOutlined /> },
						{ key: '/forward/nat/snat', label: 'SNAT', icon: <ExportOutlined /> },
						{ key: '/forward/nat/dnat', label: 'DNAT', icon: <ImportOutlined /> },
					],
				},
				{
					key: 'fwd-ipsec',
					items: [
						{ key: '/forward/ipsec/tunnel', label: 'IPsec 隧道', icon: <LockOutlined /> },
						{ key: '/forward/ipsec/guard', label: '隧道守卫', icon: <EyeOutlined /> },
					],
				},
			];
		}

		if (domain === 'security') {
			return [
				{
					key: 'sec-assets',
					items: [
						{ key: '/security/assets/list', label: '资产列表', icon: <UnorderedListOutlined /> },
						{ key: '/security/assets/scan', label: '立即扫描', icon: <RadarChartOutlined /> },
					],
				},
				{
					key: 'sec-sase',
					items: [
						{ key: '/security/services/domain', label: '网际路由域', icon: <ClusterOutlined /> },
						{ key: '/security/services/list', label: '安全服务', icon: <AppstoreOutlined /> },
						{ key: '/security/aisoc/threats', label: 'AI 威胁情报', icon: <AlertOutlined /> },
					],
				},
			];
		}

		return [
			{
				key: 'sub1',
				items: [{ key: '/', label: '仪表板', icon: <DashboardOutlined /> }],
			},
			{
				key: 'sub2',
				items: [
					{ key: '/device/ip', label: '设定网卡 IP', icon: <LaptopOutlined /> },
					{ key: '/device/service', label: '配置服务', icon: <ControlOutlined /> },
					{ key: '/init', label: '初始化网卡', icon: <ApiOutlined /> },
				],
			},
			{
				key: 'sub3',
				items: [
					{ key: '/ops/health', label: '健康巡检', icon: <MedicineBoxOutlined /> },
					{ key: '/ops/logs', label: '查看日志', icon: <FileTextOutlined /> },
					{ key: '/ops/agent', label: 'Agent 状态', icon: <RobotOutlined /> },
				],
			},
		];
	}, [domain]);
}
