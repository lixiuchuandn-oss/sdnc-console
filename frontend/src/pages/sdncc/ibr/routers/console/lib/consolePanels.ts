/** IBR 运维控制台 · 左侧能力 panel 注册（URL query `panel=`）
 *
 * 转发类面板约定：
 * - 侧栏 label 与 ibr-local-web `/forward/*` 菜单对齐（如 IPv4 路由、BGP 邻居、ACL 规则、IPsec 隧道）。
 * - 设备 running-config 类须经 `ibrDeviceOpsApi` → `/api/vr-instances/:uuid/device/forwarding/*`，
 *   **禁止**复用 Tower 平台库（`/api/networks/acl-groups`、`/api/networks/nat` 等）或独立菜单 embed。
 */

import { LEGACY_PANEL_TO_DEVICE_TAB } from './deviceInfoTabs';
import { LEGACY_PANEL_TO_HEALTH_TAB } from './healthCheckTabs';

export type VrConsolePanelId =
	| 'ops-dashboard'
	| 'ops-device-info'
	| 'ops-selfcheck'
	| 'ops-set-ip'
	| 'ops-nic-init'
	| 'fwd-vrrp'
	| 'fwd-routes'
	| 'fwd-bgp'
	| 'fwd-srv6'
	| 'fwd-acl'
	| 'fwd-nat'
	| 'fwd-ipsec'
	| 'ssh';

type VrConsolePanelGroup = 'ops' | 'forward' | 'terminal';

export type VrConsolePanelDef = {
	id: VrConsolePanelId;
	label: string;
	group: VrConsolePanelGroup;
	/** P0 是否已实现 */
	ready: boolean;
	/** 数据来源说明（主区副标题） */
	description?: string;
	/** 顶栏右侧徽标文案 */
	sourceLabel?: string;
};

export const VR_CONSOLE_PANELS: VrConsolePanelDef[] = [
	{
		id: 'ops-dashboard',
		label: '仪表板',
		group: 'ops',
		ready: true,
		description: '设备运行状态、网卡监控、资源使用与服务可达性',
		sourceLabel: '设备 · 代理',
	},
	{
		id: 'ops-device-info',
		label: '设备信息',
		group: 'ops',
		ready: true,
		description: 'CSM/平台缓存、Agent 状态与设备日志（页内 Tab 切换）',
		sourceLabel: 'Tower · 聚合',
	},
	{
		id: 'ops-selfcheck',
		label: '健康巡检',
		group: 'ops',
		ready: true,
		description: 'vbras CLI 自检与连通性探测（页内 Tab 切换）',
		sourceLabel: '设备 · 代理',
	},
	{
		id: 'ops-set-ip',
		label: '设定网卡',
		group: 'ops',
		ready: true,
		description: '配置 WAN、LAN 及辅助网口的 IP 地址',
		sourceLabel: '设备 · 代理',
	},
	{
		id: 'ops-nic-init',
		label: '初始化网卡',
		group: 'ops',
		ready: true,
		description: '选择静态/DHCP 模式，绑定 WAN/LAN；仅当目标口尚未进入 VPP 数据面时才重启 VBRAS',
		sourceLabel: '设备 · 代理',
	},
	{
		id: 'fwd-vrrp',
		label: 'VRRP',
		group: 'forward',
		ready: true,
		description: '查看云配置 VRRP 实例',
		sourceLabel: '设备 · 代理',
	},
	{
		id: 'fwd-routes',
		label: 'IP 路由',
		group: 'forward',
		ready: true,
		description: '查看、新增和删除 IPv4 / IPv6 静态路由',
		sourceLabel: '设备 · 代理',
	},
	{
		id: 'fwd-bgp',
		label: 'BGP 邻居',
		group: 'forward',
		ready: true,
		description: '查看 BGP 邻居摘要与运行状态',
		sourceLabel: '设备 · 代理',
	},
	{
		id: 'fwd-srv6',
		label: 'SRv6 状态',
		group: 'forward',
		ready: true,
		description: '查看设备 SRv6 运行状态与 locator 配置',
		sourceLabel: '设备 · 代理',
	},
	{
		id: 'fwd-acl',
		label: 'ACL 规则',
		group: 'forward',
		ready: true,
		description: '设备 running-config 上的 ACL 列表、规则与接口绑定',
		sourceLabel: '设备 · 代理',
	},
	{
		id: 'fwd-nat',
		label: 'NAT 转换',
		group: 'forward',
		ready: true,
		description: '静态 NAT、SNAT、DNAT 与全局 NAT 策略（设备 running-config）',
		sourceLabel: '设备 · 代理',
	},
	{
		id: 'fwd-ipsec',
		label: 'IPsec 隧道',
		group: 'forward',
		ready: true,
		description: '设备侧 SA 状态、隧道配置与自动重连守卫',
		sourceLabel: '设备 · 代理',
	},
	{
		id: 'ssh',
		label: 'SSH 终端',
		group: 'terminal',
		ready: true,
		description: '浏览器内 WebSSH，经 SDNC 连接设备管理口 :22',
		sourceLabel: 'SDNC · WebSSH',
	},
];

export const VR_CONSOLE_DEFAULT_PANEL: VrConsolePanelId = 'ops-dashboard';

export function parseConsolePanel(raw: string | null): VrConsolePanelId {
	const id = String(raw || '').trim();
	if (LEGACY_PANEL_TO_DEVICE_TAB[id]) {
		return 'ops-device-info';
	}
	if (LEGACY_PANEL_TO_HEALTH_TAB[id]) {
		return 'ops-selfcheck';
	}
	if (id === 'fwd-routes-ipv6') {
		return 'fwd-routes';
	}
	const typed = id as VrConsolePanelId;
	return VR_CONSOLE_PANELS.some((p) => p.id === typed) ? typed : VR_CONSOLE_DEFAULT_PANEL;
}

export function panelDef(id: VrConsolePanelId): VrConsolePanelDef {
	return VR_CONSOLE_PANELS.find((p) => p.id === id) ?? VR_CONSOLE_PANELS[0]!;
}
