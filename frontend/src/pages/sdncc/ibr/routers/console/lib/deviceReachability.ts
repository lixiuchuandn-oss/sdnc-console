/** 控制台设备状态展示（复用 CSMCTL / VRCache 合并字段，不额外探活 local-web） */

export type DeviceReachState =
	| 'no_mgmt'
	| 'checking'
	| 'unreachable'
	| 'running'
	| 'stopped'
	| 'degraded';

export type DeviceReachability = {
	state: DeviceReachState;
	label: string;
	detail: string;
};

export type CsmHealthKey = 'online' | 'offline' | 'warn' | 'unknown';

export function deriveDeviceReachabilityFromCsm(params: {
	statusKey: CsmHealthKey;
	statusLabel: string;
	managementIp: string;
	loading?: boolean;
}): DeviceReachability {
	const mgmt = String(params.managementIp || '').trim();
	if (!mgmt) {
		return {
			state: 'no_mgmt',
			label: '未接入',
			detail: '尚未上报管理口 IP',
		};
	}

	if (params.loading && params.statusKey === 'unknown') {
		return {
			state: 'checking',
			label: '加载中',
			detail: '正在读取 CSMCTL 缓存状态…',
		};
	}

	const label = params.statusLabel || '未知';

	switch (params.statusKey) {
		case 'online':
			return {
				state: 'running',
				label,
				detail: 'CSMCTL 上报：设备运行中',
			};
		case 'offline':
			return {
				state: 'unreachable',
				label,
				detail: 'CSMCTL 上报：设备不可达或已停止',
			};
		case 'warn':
			return {
				state: 'degraded',
				label,
				detail: 'CSMCTL 上报：设备存在告警',
			};
		default:
			return {
				state: 'stopped',
				label,
				detail: 'CSMCTL 未返回明确状态，请刷新缓存同步',
			};
	}
}

export function deviceReachRootClass(state: DeviceReachState): string {
	if (state === 'running') return 'is-device-running';
	if (state === 'unreachable') return 'is-device-unreachable';
	if (state === 'stopped') return 'is-device-stopped';
	if (state === 'degraded') return 'is-device-degraded';
	if (state === 'checking') return 'is-device-checking';
	return '';
}
