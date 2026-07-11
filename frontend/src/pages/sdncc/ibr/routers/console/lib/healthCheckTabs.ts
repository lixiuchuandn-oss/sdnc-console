/** 健康巡检页内 Tab（CLI 自检 + 连通性探测） */

export type VrConsoleHealthCheckTabId = 'cli' | 'ping';

export type VrConsoleHealthCheckTabDef = {
	id: VrConsoleHealthCheckTabId;
	label: string;
	description: string;
	sourceLabel: string;
};

export const HEALTH_CHECK_TABS: VrConsoleHealthCheckTabDef[] = [
	{
		id: 'cli',
		label: 'CLI 检查项',
		description: 'vbras CLI 自检：版本、接口、插件与错误计数',
		sourceLabel: '设备 · 代理',
	},
	{
		id: 'ping',
		label: '连通性测试',
		description: 'vbras CLI ping，经 cli.sock 探测目标 IPv4 可达性',
		sourceLabel: '设备 · 代理',
	},
];

export const HEALTH_CHECK_DEFAULT_TAB: VrConsoleHealthCheckTabId = 'cli';

/** 旧侧栏 panel= 迁移到健康巡检 Tab */
export const LEGACY_PANEL_TO_HEALTH_TAB: Partial<Record<string, VrConsoleHealthCheckTabId>> = {
	'ops-ping': 'ping',
};

export function parseHealthCheckTab(raw: string | null): VrConsoleHealthCheckTabId {
	const id = String(raw || '').trim() as VrConsoleHealthCheckTabId;
	return HEALTH_CHECK_TABS.some((t) => t.id === id) ? id : HEALTH_CHECK_DEFAULT_TAB;
}

export function healthCheckTabDef(id: VrConsoleHealthCheckTabId): VrConsoleHealthCheckTabDef {
	return HEALTH_CHECK_TABS.find((t) => t.id === id) ?? HEALTH_CHECK_TABS[0]!;
}
