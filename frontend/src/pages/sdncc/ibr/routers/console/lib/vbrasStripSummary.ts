import type { IbrDeviceStatusResp } from '../../../../../../services/ibrDeviceOpsApi';

function fmt(s: unknown): string {
	const v = String(s ?? '').trim();
	return v || '—';
}

export type VbrasStripPresentation = {
	line: string;
	tooltip: string;
};

export function buildVbrasStripPresentation(
	status: IbrDeviceStatusResp | null | undefined,
	opts?: { loading?: boolean },
): VbrasStripPresentation | null {
	if (opts?.loading && !status) {
		return {
			line: 'vbras 加载中…',
			tooltip: '正在从设备代理拉取 vbras 进程状态',
		};
	}
	if (!status) return null;

	const proc = status.vbras_process;
	const parts: string[] = ['vbras'];
	const tipParts: string[] = [];

	if (proc?.service) tipParts.push(`Service: ${fmt(proc.service)}`);

	const active = fmt(proc?.active_state);
	if (active !== '—') {
		parts.push(active);
		tipParts.push(`Active: ${active}`);
	} else if (status.vbras_running === true) {
		parts.push('running');
		tipParts.push('进程运行中');
	} else if (status.vbras_running === false) {
		parts.push('stopped');
		tipParts.push('进程已停止');
	}

	const pid = fmt(proc?.main_pid);
	if (pid !== '—') {
		parts.push(`PID ${pid}`);
		tipParts.push(`PID: ${pid}`);
	}

	const tasks = fmt(proc?.tasks);
	if (tasks !== '—') {
		parts.push(`${tasks} tasks`);
		tipParts.push(`Tasks: ${tasks}`);
	}

	const mem = fmt(proc?.memory);
	if (mem !== '—') {
		parts.push(mem);
		tipParts.push(`Memory: ${mem}`);
	}

	if (parts.length <= 1) {
		if (status.cli_ok === false) {
			return {
				line: 'vbras CLI 不可用',
				tooltip: String(status.cli_error || '设备代理 cli.sock 不可用'),
			};
		}
		return {
			line: 'vbras 状态未知',
			tooltip: '设备未返回 vbras 进程信息',
		};
	}

	return {
		line: parts.join(' · '),
		tooltip: tipParts.length > 0 ? tipParts.join('\n') : parts.join(' · '),
	};
}
