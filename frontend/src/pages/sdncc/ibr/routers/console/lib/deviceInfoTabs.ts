/** 设备信息页内 Tab（原侧栏 5 项 JSON + Agent 状态） */

export type VrConsoleDeviceInfoTabId = 'vr1' | 'vr2' | 'vr3' | 'cache' | 'sase' | 'agent' | 'logs';

export type VrConsoleDeviceInfoTabDef = {
	id: VrConsoleDeviceInfoTabId;
	label: string;
	description: string;
	sourceLabel: string;
	kind: 'json' | 'agent' | 'logs';
};

export const DEVICE_INFO_TABS: VrConsoleDeviceInfoTabDef[] = [
	{
		id: 'vr1',
		label: 'VR1 注册信息',
		description: 'CSMCTL VR1 注册与 pagelist 缓存快照',
		sourceLabel: 'Tower · CSM',
		kind: 'json',
	},
	{
		id: 'vr2',
		label: 'VR2 实时配置',
		description: 'CSMCTL VR2 单实例配置（实时查询）',
		sourceLabel: 'Tower · CSM',
		kind: 'json',
	},
	{
		id: 'vr3',
		label: 'VR3 设备信息',
		description: 'CSMCTL VR3 扩展设备信息列表匹配项',
		sourceLabel: 'Tower · CSM',
		kind: 'json',
	},
	{
		id: 'cache',
		label: '平台 Cache',
		description: 'SDNC 本地数据库已保存的 vr_config 副本',
		sourceLabel: 'Tower · 本地库',
		kind: 'json',
	},
	{
		id: 'sase',
		label: 'Sase 配置',
		description: '租户侧 vrctl / SASE 相关配置聚合',
		sourceLabel: 'Tower · 聚合',
		kind: 'json',
	},
	{
		id: 'agent',
		label: 'Agent 状态',
		description: 'vrctl-agent 注册状态、云下发文件与 NetJSON 快照',
		sourceLabel: '设备 · 代理',
		kind: 'agent',
	},
	{
		id: 'logs',
		label: '查看日志',
		description: 'vbras 服务 journal 最近 200 行',
		sourceLabel: '设备 · 代理',
		kind: 'logs',
	},
];

export const DEVICE_INFO_DEFAULT_TAB: VrConsoleDeviceInfoTabId = 'vr1';

/** 旧侧栏 panel= 迁移到设备信息 Tab */
export const LEGACY_PANEL_TO_DEVICE_TAB: Partial<
	Record<string, VrConsoleDeviceInfoTabId>
> = {
	vr1: 'vr1',
	vr2: 'vr2',
	vr3: 'vr3',
	cache: 'cache',
	sase: 'sase',
	'ops-agent': 'agent',
	'ops-logs': 'logs',
};

export function parseDeviceInfoTab(raw: string | null): VrConsoleDeviceInfoTabId {
	const id = String(raw || '').trim() as VrConsoleDeviceInfoTabId;
	return DEVICE_INFO_TABS.some((t) => t.id === id) ? id : DEVICE_INFO_DEFAULT_TAB;
}

export function deviceInfoTabDef(id: VrConsoleDeviceInfoTabId): VrConsoleDeviceInfoTabDef {
	return DEVICE_INFO_TABS.find((t) => t.id === id) ?? DEVICE_INFO_TABS[0]!;
}

export function isDeviceInfoJsonTab(id: VrConsoleDeviceInfoTabId): boolean {
	return deviceInfoTabDef(id).kind === 'json';
}
