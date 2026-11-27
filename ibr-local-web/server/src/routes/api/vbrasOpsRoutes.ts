import { Router } from 'express';
import { runHostCmd } from './helpers.js';
import { shouldReapplyLastApplyIps } from '../../services/network/nicInitClean.js';
import { applyNetConfig } from '../../services/network/netApply.js';
import { isForwardingMock, runClishArgv } from '../../services/forwarding/clishCsm.js';
import { getPaths, loadState, runVbrasCli, startVbras, stopVbras, waitForVbrasCliSock, type Paths } from '../../vrwizard.js';

const IPV4_RE = /^(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)$/;

export type DevicePingStats = {
	sent: number | null;
	received: number | null;
	packetLoss: string | null;
};

/** 解析 clish `do ping` / vbras ping 回显统计（勿与宿主 Linux `ping` 混淆）。 */
export function parseDevicePingStats(raw: string): DevicePingStats {
	const t = String(raw || '');
	const tx = /(\d+)\s+packets?\s+transmitted.*?(\d+)\s+received(?:.*?(\d+(?:\.\d+)?)\s*%\s*packet\s*loss)?/i.exec(t);
	if (tx) {
		return {
			sent: Number.parseInt(tx[1] ?? '', 10),
			received: Number.parseInt(tx[2] ?? '', 10),
			packetLoss: tx[3] != null ? `${tx[3]}%` : null,
		};
	}
	const stats = /statistics:\s*(\d+)\s*sent,\s*(\d+)\s*received(?:.*?(\d+(?:\.\d+)?)\s*%\s*packet\s*loss)?/i.exec(t);
	if (stats) {
		return {
			sent: Number.parseInt(stats[1] ?? '', 10),
			received: Number.parseInt(stats[2] ?? '', 10),
			packetLoss: stats[3] != null ? `${stats[3]}%` : null,
		};
	}
	const sentM = /(\d+)\s*sent/i.exec(t);
	const recvM = /(\d+)\s*received/i.exec(t);
	const lossM = /(\d+(?:\.\d+)?)\s*%\s*packet\s*loss/i.exec(t);
	return {
		sent: sentM ? Number.parseInt(sentM[1]!, 10) : null,
		received: recvM ? Number.parseInt(recvM[1]!, 10) : null,
		packetLoss: lossM ? `${lossM[1]}%` : null,
	};
}

/** 根据设备 CLI ping 回显判断是否真正收到回复。 */
export function isDevicePingOk(raw: string): boolean {
	const t = raw.trim();
	if (!t) return false;
	if (/failed:/i.test(t)) return false;
	if (/no egress interface/i.test(t)) return false;
	if (/aborted due to/i.test(t)) return false;
	if (/100%\s*packet\s*loss/i.test(t)) return false;
	if (/network is unreachable/i.test(t)) return false;
	if (/unknown host/i.test(t)) return false;
	if (/\bbytes from\b/i.test(t)) return true;

	const stats = parseDevicePingStats(t);
	if (stats.received != null && Number.isFinite(stats.received)) {
		return stats.received > 0;
	}
	const receivedMatches = [...t.matchAll(/(\d+)\s*received/gi)];
	for (const m of receivedMatches) {
		const n = Number.parseInt(m[1] ?? '0', 10);
		if (n > 0) return true;
	}
	return false;
}

export type ClishDoPingResult = {
	ok: boolean;
	target: string;
	repeat: number;
	command: string;
	raw: string;
	stats: DevicePingStats;
	error?: string;
	invalidTarget?: boolean;
};

export function buildClishDoPingCmd(target: string, repeat: number): { clishCmd: string; command: string } {
	const clishCmd = `do ping ${target} repeat ${repeat}`;
	const command = `/rhos/bin/clish --lock --log -x /rhos/etc/cli/enable-view -w configure-view --socket=/tmp/konfd.socket -c "${clishCmd}"`;
	return { clishCmd, command };
}

function mockLinuxPingOutput(target: string, repeat: number): string {
	const lines = [`PING ${target} (${target}) 56(84) bytes of data.`];
	for (let i = 1; i <= repeat; i++) {
		lines.push(`64 bytes from ${target}: icmp_seq=${i} ttl=64 time=0.200 ms`);
	}
	lines.push('');
	lines.push(`--- ${target} ping statistics ---`);
	lines.push(`${repeat} packets transmitted, ${repeat} received, 0% packet loss, time ${repeat * 1000}ms`);
	return lines.join('\n');
}

/** clish `do ping`（Linux ping via konfd），与 `POST /connectivity/ping` 同一落地。 */
export async function runClishDoPing(paths: Paths, target: string, repeat: number): Promise<ClishDoPingResult> {
	const { clishCmd, command } = buildClishDoPingCmd(target, repeat);
	const emptyStats: DevicePingStats = { sent: null, received: null, packetLoss: null };
	if (!IPV4_RE.test(target)) {
		return {
			ok: false,
			target,
			repeat,
			command,
			raw: '',
			stats: emptyStats,
			error: '目标须为合法 IPv4 地址',
			invalidTarget: true,
		};
	}
	if (isForwardingMock(paths)) {
		const raw = mockLinuxPingOutput(target, repeat);
		return { ok: true, target, repeat, command, raw, stats: parseDevicePingStats(raw) };
	}
	// Linux ping 默认 -i 1；不可达时需留足收齐统计行的时间，避免被标成 clish 超时失败
	const timeoutMs = Math.max(16_000, repeat * 2_500 + 8_000);
	try {
		const clishRes = await runClishArgv(['-c', clishCmd], paths, { timeoutMs });
		const raw = String(clishRes.ok ? clishRes.output : clishRes.output || clishRes.error || '');
		if (!clishRes.ok && !raw) {
			return {
				ok: false,
				target,
				repeat,
				command,
				raw: '',
				stats: emptyStats,
				error: `clish do ping 失败：${clishRes.error}`,
			};
		}
		const stats = parseDevicePingStats(raw);
		const ok = isDevicePingOk(raw);
		return {
			ok,
			target,
			repeat,
			command,
			raw,
			stats,
			...(ok ? {} : { error: clishRes.ok ? '设备 clish do ping 未收到回复' : clishRes.error }),
		};
	} catch (e) {
		const msg = e instanceof Error ? e.message : String(e);
		return {
			ok: false,
			target,
			repeat,
			command,
			raw: '',
			stats: emptyStats,
			error: `clish do ping 失败：${msg}`,
		};
	}
}

export function createVbrasOpsRouter(): Router {
	const r = Router();

	r.post('/start', (_req, res) => {
		const startRes = startVbras();
		res.json(startRes);
	});

	r.post('/stop', (_req, res) => {
		const stopRes = stopVbras();
		res.json(stopRes);
	});

	r.post('/restart', async (_req, res) => {
		const paths = getPaths();
		const logs: string[] = [];

		logs.push('正在停止 VBRAS 服务...');
		const stopRes = stopVbras();
		logs.push(stopRes.ok ? stopRes.message : `停止失败: ${stopRes.message}`);

		logs.push('正在启动 VBRAS 服务...');
		const startRes = startVbras();
		logs.push(startRes.ok ? startRes.message : `启动失败: ${startRes.message}`);

		let cliReady = false;
		if (startRes.ok) {
			logs.push('等待 CLI Socket 初始化 (超时 30s)...');
			cliReady = await waitForVbrasCliSock(paths, 30_000);
			logs.push(cliReady ? 'CLI Socket 已就绪' : 'CLI Socket 未就绪（可能仍在启动中）');
		}

		let reapply: { ok: boolean; logs: string[] } | null = null;
		if (cliReady) {
			try {
				const state = loadState(paths);
				const lastApply = state.last_apply && typeof state.last_apply === 'object' ? (state.last_apply as any) : null;
				if (shouldReapplyLastApplyIps(lastApply)) {
					logs.push('尝试恢复上次网络配置...');
					reapply = await applyNetConfig({
						scope: 'all',
						public_ip: lastApply.public_ip,
						public_ipv6: lastApply.public_ipv6,
						private_ip: lastApply.private_ip,
						private_ipv6: lastApply.private_ipv6,
						...(Object.prototype.hasOwnProperty.call(lastApply, 'public_gw')
							? { public_gw: lastApply.public_gw ?? null }
							: {}),
					});
				} else {
					logs.push('跳过恢复 last_apply（无 WAN/LAN CIDR：初始化后不再灌回旧地址）');
				}
			} catch (e) {
				logs.push(`恢复网络配置失败: ${e instanceof Error ? e.message : String(e)}`);
			}
		}

		res.json({ ok: stopRes.ok && startRes.ok, stop: stopRes, start: startRes, cli_ready: cliReady, reapply, logs });
	});

	/**
	 * 设备内连通性探测（konfd/clish），等效于：
	 * `/rhos/bin/clish --lock --log -x /rhos/etc/cli/enable-view -w configure-view --socket=/tmp/konfd.socket -c "do ping <ip> repeat 3"`
	 * 落地为 Linux ping（enable-view/ping.xml），禁止 Node 直接调宿主 `ping`，也禁止 vbras `cli.sock` 的 VPP ping。
	 */
	r.post('/connectivity/ping', async (req, res) => {
		const target = String(req.body?.target ?? req.body?.ip ?? req.body?.host ?? '').trim();
		const repeatRaw = Number(req.body?.repeat ?? 3);
		const repeat = Number.isFinite(repeatRaw) ? Math.min(Math.max(Math.floor(repeatRaw), 1), 20) : 3;
		const ping = await runClishDoPing(getPaths(), target, repeat);
		const status = ping.invalidTarget ? 400 : ping.error && !ping.raw && !ping.ok ? 500 : 200;
		if (status !== 200) {
			res.status(status).json({
				ok: false,
				target: ping.target,
				repeat: ping.repeat,
				stats: ping.stats,
				raw: ping.raw,
				command: ping.command,
				error: ping.error,
			});
			return;
		}
		res.json({
			ok: ping.ok,
			target: ping.target,
			repeat: ping.repeat,
			stats: ping.stats,
			raw: ping.raw,
			command: ping.command,
			...(ping.ok ? {} : { error: ping.error }),
		});
	});

	r.post('/selfcheck', async (req, res) => {
		const paths = getPaths();
		try {
			const public_gw = typeof req.body?.public_gw === 'string' ? req.body.public_gw.trim() : '';
			const cmds: string[] = ['show version', 'show interface', 'show plugin', 'show error'];
			let raw = (await runVbrasCli(paths, `${cmds.join('\n')}\n`, 4000)).trim();

			let ok = true;
			const reasons: string[] = [];
			const checks: Array<{ name: string; status: 'pass' | 'warning' | 'fail'; detail: string }> = [];

			const ver_ok = raw.includes('show version') || raw.includes('EROUTER') || raw.toLowerCase().includes('vpp');
			checks.push({ name: '系统响应性检查', status: ver_ok ? 'pass' : 'fail', detail: '验证 vbras 命令行是否正常响应' });
			if (!ver_ok) {
				ok = false;
				reasons.push('无法获取版本信息，服务可能未响应');
			}

			const if_ok = raw.includes('interface');
			if (if_ok) {
				if (raw.includes('Name') && raw.includes('Idx')) checks.push({ name: '接口状态检查', status: 'pass', detail: '网络接口表获取成功' });
				else checks.push({ name: '接口状态检查', status: 'warning', detail: '接口信息格式可能异常' });
			} else {
				checks.push({ name: '接口状态检查', status: 'fail', detail: '无法获取接口信息' });
				ok = false;
				reasons.push('无法获取接口信息');
			}

			const plugin_ok = raw.includes('plugin');
			checks.push({ name: '插件加载检查', status: plugin_ok ? 'pass' : 'fail', detail: plugin_ok ? '插件列表获取成功' : '无法获取插件信息' });
			if (!plugin_ok) {
				ok = false;
				reasons.push('无法获取插件信息');
			}

			const err_ok = raw.includes('show error');
			checks.push({ name: '系统错误计数', status: err_ok ? 'pass' : 'warning', detail: err_ok ? '错误计数器检查完成' : '无法获取错误计数' });

			if (public_gw) {
				const ping = await runClishDoPing(paths, public_gw, 3);
				raw = [raw, '=== clish do ping ===', ping.command, ping.raw, ping.error].filter(Boolean).join('\n');
				const pingDetail = ping.ok
					? ping.stats.packetLoss
						? `clish do ping 通，丢包 ${ping.stats.packetLoss}`
						: 'clish do ping 通'
					: ping.error || 'clish do ping 未收到回复';
				checks.push({
					name: `网关连通性 (${public_gw})`,
					status: ping.ok ? 'pass' : 'fail',
					detail: pingDetail,
				});
				if (!ping.ok) {
					ok = false;
					reasons.push(`网关 ${public_gw} 连通性测试失败`);
				}
			}

			res.json({ ok, reasons, checks, raw });
		} catch (e) {
			res.status(500).json({ ok: false, error: e instanceof Error ? e.message : String(e) });
		}
	});

	r.get('/system/logs', (_req, res) => {
		try {
			if (process.platform === 'win32') {
				res.type('text/plain').send('Windows mock logs:\n[INFO] System started\n[INFO] VBRAS running...\n');
				return;
			}
			const out = runHostCmd(['journalctl', '-u', 'vbras', '-n', '200', '--no-pager'], 4000);
			res.type('text/plain').send(out || '');
		} catch (e) {
			const msg = e instanceof Error ? e.message : String(e);
			res.type('text/plain').send(`Error getting logs: ${msg}`);
		}
	});

	return r;
}
