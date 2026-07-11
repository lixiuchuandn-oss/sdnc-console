import React, { useMemo } from 'react';
import { Menu, Typography } from 'antd';
import type { MenuProps } from 'antd';
import {
	ApiOutlined,
	CloudServerOutlined,
	CodeOutlined,
	DashboardOutlined,
	GlobalOutlined,
	HeartOutlined,
	ClusterOutlined,
	DeploymentUnitOutlined,
	GatewayOutlined,
	LockOutlined,
	NodeIndexOutlined,
	SafetyOutlined,
	SwapOutlined,
} from '@ant-design/icons';
import {
	VR_CONSOLE_PANELS,
	panelDef,
	type VrConsolePanelId,
} from './lib/consolePanels';

const PANEL_ICONS: Partial<Record<VrConsolePanelId, React.ReactNode>> = {
	'ops-dashboard': <DashboardOutlined />,
	'ops-device-info': <CloudServerOutlined />,
	'ops-selfcheck': <HeartOutlined />,
	'ops-set-ip': <GlobalOutlined />,
	'ops-nic-init': <ApiOutlined />,
	'fwd-vrrp': <ClusterOutlined />,
	'fwd-routes': <NodeIndexOutlined />,
	'fwd-bgp': <DeploymentUnitOutlined />,
	'fwd-srv6': <GatewayOutlined />,
	'fwd-acl': <SafetyOutlined />,
	'fwd-nat': <SwapOutlined />,
	'fwd-ipsec': <LockOutlined />,
	ssh: <CodeOutlined />,
};

export type VrConsoleSidebarProps = {
	activePanel: VrConsolePanelId;
	managementIp?: string;
	onSelect: (panel: VrConsolePanelId) => void;
};

export const VrConsoleSidebar: React.FC<VrConsoleSidebarProps> = ({
	activePanel,
	managementIp,
	onSelect,
}) => {
	const active = panelDef(activePanel);
	const hasMgmt = Boolean(String(managementIp || '').trim());
	const showMgmtWarn = active.group === 'ops' && !hasMgmt;

	const items: MenuProps['items'] = useMemo(() => {
		const groups: Array<{ key: string; label: string; panels: typeof VR_CONSOLE_PANELS }> = [
			{ key: 'ops', label: '运维管理', panels: VR_CONSOLE_PANELS.filter((p) => p.group === 'ops') },
			{
				key: 'forward',
				label: '转发配置',
				panels: VR_CONSOLE_PANELS.filter((p) => p.group === 'forward'),
			},
			{ key: 'terminal', label: '终端', panels: VR_CONSOLE_PANELS.filter((p) => p.group === 'terminal') },
		];
		return groups
			.filter((g) => g.panels.length > 0)
			.map((g) => ({
				key: g.key,
				label: g.label,
				type: 'group' as const,
				children: g.panels.map((p) => ({
					key: p.id,
					icon: PANEL_ICONS[p.id],
					label: p.label,
					disabled: false,
				})),
			}));
	}, []);

	return (
		<aside className="ibr-console-sidebar">
			<Menu
				theme="dark"
				mode="inline"
				selectedKeys={[activePanel]}
				items={items}
				className="ibr-console-menu"
				onClick={({ key }) => onSelect(key as VrConsolePanelId)}
			/>
			{showMgmtWarn ? (
				<div className="ibr-console-sidebar-footer">
					<Typography.Text type="warning" className="ibr-console-sidebar-warn">
						需先上报管理口 IP
					</Typography.Text>
				</div>
			) : null}
		</aside>
	);
};
