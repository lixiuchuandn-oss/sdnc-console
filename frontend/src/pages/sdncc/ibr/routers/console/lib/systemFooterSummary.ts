import type { IbrDeviceStatusResp } from '../../../../../../services/ibrDeviceOpsApi';

function fmt(s: unknown): string {
	const v = String(s ?? '').trim();
	return v || '—';
}

export type SystemFooterItem = {
	label: string;
	value: string;
};

export type SystemFooterPresentation = {
	items: SystemFooterItem[];
	source: string;
};

export function buildSystemFooterPresentation(
	status: IbrDeviceStatusResp | null | undefined,
	opts?: { loading?: boolean },
): SystemFooterPresentation | null {
	if (opts?.loading && !status) {
		return {
			items: [{ label: '状态', value: '加载中…' }],
			source: '设备 · 代理',
		};
	}
	if (!status) return null;

	const items: SystemFooterItem[] = [];
	const push = (label: string, value: unknown) => {
		const v = fmt(value);
		if (v !== '—') items.push({ label, value: v });
	};

	push('OS', status.os_name);
	push('Kernel', status.system_info?.kernel);

	const platform = fmt(status.system_info?.platform);
	const arch = fmt(status.system_info?.arch);
	if (platform !== '—' || arch !== '—') {
		items.push({
			label: '平台',
			value: [platform, arch].filter((x) => x !== '—').join(' / '),
		});
	}

	push('主机', status.system_info?.hostname);
	push('Node', status.system_info?.node);
	push('运行', status.stats?.uptime);

	if (typeof status.stats?.cpu === 'number' && Number.isFinite(status.stats.cpu)) {
		items.push({ label: 'CPU', value: `${Math.round(status.stats.cpu)}%` });
	}
	if (typeof status.stats?.mem === 'number' && Number.isFinite(status.stats.mem)) {
		items.push({ label: '内存', value: `${Math.round(status.stats.mem)}%` });
	}
	if (typeof status.stats?.disk === 'number' && Number.isFinite(status.stats.disk)) {
		items.push({ label: '磁盘', value: `${Math.round(status.stats.disk)}%` });
	}

	const stats = status.stats;
	if (
		stats &&
		[stats.load_1, stats.load_5, stats.load_15].some((x) => typeof x === 'number' && Number.isFinite(x))
	) {
		items.push({
			label: 'Load',
			value: [stats.load_1, stats.load_5, stats.load_15]
				.map((x) => (typeof x === 'number' && Number.isFinite(x) ? x.toFixed(2) : '—'))
				.join(' / '),
		});
	}

	push('版本', status.version);

	if (items.length === 0) return null;
	return { items, source: '设备 · 代理' };
}
