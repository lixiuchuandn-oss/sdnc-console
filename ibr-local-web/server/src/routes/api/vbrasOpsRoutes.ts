import { Router } from 'express';
import { runHostCmd } from './helpers.js';
import { applyNetConfig } from '../../services/network/netApply.js';
import { getPaths, loadState, runVbrasCli, startVbras, stopVbras, waitForVbrasCliSock } from '../../vrwizard.js';

/** 根据 vbras / VPP CLI 的 ping 回显判断是否真正收到回复（避免「0 sent, 0 received, 0% packet loss」误判为通过）。 */
function isPublicGwPingOk(raw: string): boolean {
	const t = raw.trim();
	if (!t) return false;
	if (/failed:/i.test(t)) return false;
	if (/no egress interface/i.test(t)) return false;
	if (/aborted due to/i.test(t)) return false;
	if (/100%\s*packet\s*loss/i.test(t)) return false;

	const stats = /statistics:\s*(\d+)\s*sent,\s*(\d+)\s*received/i.exec(t);
	if (stats) {
		const received = Number.parseInt(stats[2] ?? '0', 10);
		return received > 0;
	}
	// 无 Statistics 行时：要求明确有非零 received，且不能只有「0 received」
	const receivedMatches = [...t.matchAll(/(\d+)\s*received/gi)];
	for (const m of receivedMatches) {
		const n = Number.parseInt(m[1] ?? '0', 10);
		if (n > 0) return true;
	}
	return false;
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
				if (lastApply) {
					logs.push('尝试恢复上次网络配置...');
					reapply = await applyNetConfig({
						scope: 'all',
						public_ip: lastApply.public_ip,
						public_gw: lastApply.public_gw ?? null,
						private_ip: lastApply.private_ip,
					});
				}
			} catch (e) {
				logs.push(`恢复网络配置失败: ${e instanceof Error ? e.message : String(e)}`);
			}
		}

		res.json({ ok: stopRes.ok && startRes.ok, stop: stopRes, start: startRes, cli_ready: cliReady, reapply, logs });
	});

	r.post('/selfcheck', async (req, res) => {
		const paths = getPaths();
		try {
			const public_gw = typeof req.body?.public_gw === 'string' ? req.body.public_gw.trim() : '';
			const cmds: string[] = ['show version', 'show interface', 'show plugin', 'show error'];
			if (public_gw) cmds.push(`ping ${public_gw} repeat 3`);
			const out = await runVbrasCli(paths, `${cmds.join('\n')}\n`, 4000);
			const raw = out.trim();

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
				const ping_ok = isPublicGwPingOk(raw);
				checks.push({ name: `网关连通性 (${public_gw})`, status: ping_ok ? 'pass' : 'fail', detail: 'Ping 测试公网网关' });
				if (!ping_ok) {
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
