/**
 * IPsec 隧道与守卫：与 vrlocalctl `app/api/forwarding.py` 中
 * `get_ipsec_sas`、`/forwarding/ipsec/connect|disconnect`、`autoreconnect`、监控循环语义对齐。
 */
import fs from 'node:fs';
import path from 'node:path';
import type { Paths } from '../../vrwizard.js';
import { getForwardingAgentConfig, agentConfigFiles } from './routesAndIfaces.js';
import { isForwardingMock, runCsmScript } from './clishCsm.js';
import { ipsecMonitorConfigPath, ipsecMonitorLogPath } from './persist.js';

/** 云配置根 JSON 或 `content` 嵌套下的 `ipsec` 隧道数组（兼容不同 .bak 形状） */
function ipsecTunnelArrayFromRoot(root: Record<string, unknown>): Array<Record<string, unknown>> | null {
	if (Array.isArray(root.ipsec)) return root.ipsec as Array<Record<string, unknown>>;
	const nested = root.content;
	if (nested && typeof nested === 'object' && Array.isArray((nested as Record<string, unknown>).ipsec)) {
		return (nested as Record<string, unknown>).ipsec as Array<Record<string, unknown>>;
	}
	return null;
}

/** 子 SA 已建立：与监控循环一致，除 INSTALLED 外识别 REKEYING（strongSwan 重协商） */
function isChildSaEstablishedLine(line: string): boolean {
	return line.includes(': #') && (line.includes('INSTALLED') || line.includes('REKEYING'));
}

const defaultReconnectConfig = () => ({
	enabled: true,
	reconnect_enabled: false,
	interval: 60,
	max_retries: 3,
});

type ReconnectEntry = { time: string; tunnel_id: string; action: string; detail: string };

const reconnectLogs: ReconnectEntry[] = [];
const RECONNECT_MAX = 500;

function loadReconnectConfig(paths: Paths): Record<string, unknown> {
	const p = ipsecMonitorConfigPath(paths);
	const cfg = defaultReconnectConfig();
	if (!fs.existsSync(p)) return cfg;
	try {
		const saved = JSON.parse(fs.readFileSync(p, 'utf-8')) as Record<string, unknown>;
		Object.assign(cfg, saved);
	} catch {
		/* ignore */
	}
	return cfg;
}

function saveReconnectConfig(paths: Paths, cfg: Record<string, unknown>) {
	const p = ipsecMonitorConfigPath(paths);
	fs.mkdirSync(path.dirname(p), { recursive: true });
	const tmp = `${p}.tmp`;
	fs.writeFileSync(tmp, JSON.stringify(cfg, null, 2) + '\n', 'utf-8');
	fs.renameSync(tmp, p);
}

function logPath(paths: Paths) {
	return ipsecMonitorLogPath(paths);
}

function appendLog(paths: Paths, entry: ReconnectEntry) {
	reconnectLogs.unshift(entry);
	if (reconnectLogs.length > RECONNECT_MAX) reconnectLogs.length = RECONNECT_MAX;
	try {
		const line = `${entry.time} | ${entry.tunnel_id} | ${entry.action} | ${entry.detail}\n`;
		fs.appendFileSync(logPath(paths), line, 'utf-8');
	} catch {
		/* ignore */
	}
}

let logsBootstrapped = false;
function loadLogsFromFile(paths: Paths) {
	if (logsBootstrapped) return;
	logsBootstrapped = true;
	const p = logPath(paths);
	if (!fs.existsSync(p)) return;
	try {
		const lines = fs.readFileSync(p, 'utf-8').split('\n').filter(Boolean);
		for (const line of lines.slice(-500)) {
			const parts = line.split('|');
			if (parts.length >= 4) {
				reconnectLogs.push({
					time: parts[0]!.trim(),
					tunnel_id: parts[1]!.trim(),
					action: parts[2]!.trim(),
					detail: parts.slice(3).join('|').trim(),
				});
			}
		}
		reconnectLogs.reverse();
		while (reconnectLogs.length > RECONNECT_MAX) reconnectLogs.pop();
	} catch {
		/* ignore */
	}
}

const reconnectState = new Map<string, number>();
let lastPathsForMonitor: Paths | null = null;
let monitorTimer: ReturnType<typeof setInterval> | null = null;
let lastEnabled: boolean | null = null;
let lastMonitorTickAt = 0;

function extractCsmOutputData(rawOutput: string): string {
	try {
		const m = /\{[\s\S]*\}/.exec(rawOutput);
		if (!m) return rawOutput;
		const data = JSON.parse(m[0]!) as Record<string, unknown>;
		const arr = data.data;
		if (Array.isArray(arr) && arr.length > 0) {
			const item = arr[0] as Record<string, unknown>;
			if (typeof item.data === 'string') return item.data;
			if (typeof item.message === 'string') return item.message;
		}
		if (typeof data.message === 'string') return data.message;
	} catch {
		/* ignore */
	}
	return rawOutput;
}

function readTunnelIdsFromBakFiles(paths: Paths): Set<string> {
	const ids = new Set<string>();
	const files = agentConfigFiles(paths);
	for (const fpath of files) {
		try {
			const data = JSON.parse(fs.readFileSync(fpath, 'utf-8')) as Record<string, unknown>;
			const ipsec = ipsecTunnelArrayFromRoot(data);
			if (!ipsec) continue;
			for (const tunnel of ipsec) {
				if (!tunnel || typeof tunnel !== 'object') continue;
				const t = tunnel as Record<string, unknown>;
				if (String(t['sa-initiate'] ?? t.sa_initiate) === 'true' && t.ID != null) {
					ids.add(String(t.ID));
				}
			}
		} catch {
			/* ignore */
		}
	}
	return ids;
}

async function ipsecMonitorTick(paths: Paths) {
	const cfg = loadReconnectConfig(paths) as {
		enabled: boolean;
		reconnect_enabled: boolean;
		interval: number;
		max_retries: number;
	};

	if (cfg.enabled !== lastEnabled) {
		lastEnabled = cfg.enabled;
		const timeStr = new Date().toISOString().replace('T', ' ').slice(0, 19);
		if (cfg.enabled) appendLog(paths, { time: timeStr, tunnel_id: 'SYSTEM', action: 'Info', detail: '监控功能已启用/恢复 (Ready)' });
		else appendLog(paths, { time: timeStr, tunnel_id: 'SYSTEM', action: 'Info', detail: '监控功能已暂停 (Paused)' });
	}

	if (!cfg.enabled) return;

	const timeStr = () => new Date().toISOString().replace('T', ' ').slice(0, 19);
	appendLog(paths, { time: timeStr(), tunnel_id: 'SYSTEM', action: 'Check', detail: '开始新一轮状态探测...' });

	try {
		const targetTunnels = readTunnelIdsFromBakFiles(paths);
		if (isForwardingMock(paths) && targetTunnels.size === 0) {
			targetTunnels.add('mock_tunnel');
		}

		appendLog(paths, {
			time: timeStr(),
			tunnel_id: 'SYSTEM',
			action: 'Check',
			detail: `需监控的隧道 ID: ${JSON.stringify(Array.from(targetTunnels))}`,
		});

		if (targetTunnels.size === 0) {
			appendLog(paths, { time: timeStr(), tunnel_id: 'SYSTEM', action: 'Check', detail: '无需要监控的隧道 (未找到 sa-initiate: true)' });
			return;
		}

		const res = await runCsmScript({ opt: 'ipsec_show_sas_list', args: {} }, paths);
		let innerText = '';
		if (res.ok) innerText = extractCsmOutputData(res.output);
		if (!innerText && isForwardingMock(paths)) {
			innerText = mockSasText();
		}

		const runningIds = new Set<string>();
		for (const line of innerText.split('\n')) {
			if (!line.includes(': #')) continue;
			const parts = line.split(': #');
			const rawName = parts[0]!.replace(/["']/g, '').trim();
			const rest = parts[1] ?? '';
			if (rawName.startsWith('net') && (rest.includes('INSTALLED') || rest.includes('REKEYING'))) {
				runningIds.add(rawName.slice(3));
			}
		}

		appendLog(paths, {
			time: timeStr(),
			tunnel_id: 'SYSTEM',
			action: 'Check',
			detail: `当前运行中的隧道(已去前缀): ${JSON.stringify(Array.from(runningIds))}`,
		});

		for (const tid of targetTunnels) {
			const isRunning = runningIds.has(tid);
			if (isRunning) {
				appendLog(paths, { time: timeStr(), tunnel_id: tid, action: 'Check', detail: '状态: 运行中' });
				if (reconnectState.has(tid)) {
					appendLog(paths, { time: timeStr(), tunnel_id: tid, action: 'Reconnected', detail: '检测到隧道已恢复连接' });
					reconnectState.delete(tid);
				}
				continue;
			}

			const fails = reconnectState.get(tid) ?? 0;
			if (fails === 0) {
				appendLog(paths, { time: timeStr(), tunnel_id: tid, action: 'Check', detail: '检测到状态异常，正在复核(防抖)...' });
				reconnectState.set(tid, 1);
				continue;
			}

			if (!cfg.reconnect_enabled) {
				appendLog(paths, {
					time: timeStr(),
					tunnel_id: tid,
					action: 'Check',
					detail: '探测到断开: ' + tid + '，但自动重连功能未开启 (仅探测模式)',
				});
				reconnectState.set(tid, fails + 1);
				continue;
			}

			const retryCount = fails;
			if (retryCount <= cfg.max_retries) {
				appendLog(paths, {
					time: timeStr(),
					tunnel_id: tid,
					action: 'Retry',
					detail: `确认隧道断开，尝试第 ${retryCount}/${cfg.max_retries} 次重连`,
				});
				await runCsmScript({ opt: 'ipsec_sa_initiate_config', args: { ipsec_id: tid } }, paths);
				reconnectState.set(tid, fails + 1);
			} else {
				if (fails === cfg.max_retries + 1) {
					appendLog(paths, { time: timeStr(), tunnel_id: tid, action: 'Failed', detail: '重连次数耗尽，停止重试' });
				} else {
					appendLog(paths, { time: timeStr(), tunnel_id: tid, action: 'Check', detail: '状态: 断开 (已放弃重试)' });
				}
				reconnectState.set(tid, fails + 1);
			}
		}
	} catch (e) {
		const msg = e instanceof Error ? e.message : String(e);
		appendLog(paths, { time: new Date().toISOString().replace('T', ' ').slice(0, 19), tunnel_id: 'SYSTEM', action: 'Error', detail: `监控循环异常: ${msg}` });
	}
}

function mockSasText(): string {
	return `conntesst101: #2, ESTABLISHED, IKEv1, dae9f440a14f1c0f_i* 932e0309967156e7_r
  local  '669741676840656896' @ 10.21.255.116[4500]
  remote '668712107747622912' @ 10.21.155.101[4500]
  nettesst101: #3, reqid 2, INSTALLED, TUNNEL-in-UDP, ESP:AES_CBC-256/HMAC_SHA2_256_128/MODP_3072
    installed 4619s ago
    in  c4be0682, 0 bytes,    0 packets
    out ce4571ef,      0 bytes,    0 packets`;
}

export function ensureIpsecMonitor(paths: Paths) {
	if (process.env.VRWIZARD_IPSEC_MONITOR === '0') return;
	lastPathsForMonitor = paths;
	loadLogsFromFile(paths);
	if (monitorTimer) return;
	monitorTimer = setInterval(() => {
		const p = lastPathsForMonitor ?? paths;
		const cfg = loadReconnectConfig(p) as { interval?: number };
		const periodMs = Math.max(5, Number(cfg.interval) || 60) * 1000;
		const now = Date.now();
		if (now - lastMonitorTickAt < periodMs - 500) return;
		lastMonitorTickAt = now;
		void ipsecMonitorTick(p);
	}, 5000);
	lastMonitorTickAt = 0;
	void ipsecMonitorTick(paths);
}

export function getAutoreconnectConfig(paths: Paths) {
	const c = loadReconnectConfig(paths);
	if (c.reconnect_enabled === undefined) c.reconnect_enabled = false;
	return c;
}

export function setAutoreconnectConfig(
	paths: Paths,
	body: { enabled: boolean; reconnect_enabled: boolean; interval: number; max_retries: number },
) {
	const cfg = loadReconnectConfig(paths);
	cfg.enabled = body.enabled;
	cfg.reconnect_enabled = body.reconnect_enabled;
	cfg.interval = body.interval;
	cfg.max_retries = body.max_retries;
	saveReconnectConfig(paths, cfg);
	reconnectState.clear();
	return { status: 'success', config: cfg };
}

export function getReconnectLogs() {
	return { logs: [...reconnectLogs] };
}

export async function getIpsecSas(paths: Paths): Promise<Record<string, unknown>> {
	const cloudIds = new Set<string>();
	try {
		const configData = getForwardingAgentConfig(paths) as { config?: Array<{ content?: Record<string, unknown> }> };
		for (const cfg of configData.config ?? []) {
			const c = cfg.content;
			if (!c || typeof c !== 'object') continue;
			const tunnels = ipsecTunnelArrayFromRoot(c as Record<string, unknown>);
			if (!tunnels) continue;
			for (const tunnel of tunnels) {
				if (tunnel?.ID != null) cloudIds.add(String(tunnel.ID));
			}
		}
	} catch {
		/* ignore */
	}

	const result = await runCsmScript({ opt: 'ipsec_show_sas_list', args: {} }, paths);
	if (!result.ok) return { error: result.error };

	let innerText = extractCsmOutputData(result.output);
	if (!innerText && isForwardingMock(paths)) {
		innerText = mockSasText();
	}

	const runningSasMap: Record<string, Record<string, unknown>> = {};
	let currentConn: Record<string, unknown> | null = null;
	let currentChild: Record<string, unknown> | null = null;

	const lines = innerText.split('\n');
	for (const line of lines) {
		const stripped = line.trim();
		if (!stripped) continue;
		if (!line.startsWith(' ') && line.includes(': #')) {
			if (currentConn) {
				runningSasMap[String(currentConn.name)] = currentConn;
			}
			const parts = line.split(': #');
			const name = parts[0]!;
			const rest = parts[1] ?? '';
			let status = 'UNKNOWN';
			if (rest.includes('ESTABLISHED') || rest.includes('CONNECTING')) status = 'CONNECTING';
			currentConn = {
				name,
				status,
				local: '-',
				remote: '-',
				uptime: '-',
				children: [] as unknown[],
				raw_lines: [line],
				source: '本地',
			};
			currentChild = null;
		} else if (currentConn) {
			(currentConn.raw_lines as string[]).push(line);
			if (stripped.startsWith('local') && stripped.includes('@')) {
				try {
					currentConn.local = stripped.split('@')[1]!.trim();
				} catch {
					/* ignore */
				}
			} else if (stripped.startsWith('remote') && stripped.includes('@')) {
				try {
					currentConn.remote = stripped.split('@')[1]!.trim();
				} catch {
					/* ignore */
				}
			} else if (stripped.startsWith('established')) {
				currentConn.uptime = stripped.replace('established', '').replace('ago', '').trim();
			}
			if (isChildSaEstablishedLine(line)) {
				const childName = line.split(':')[0]!.trim();
				currentChild = {
					name: childName,
					status: line.includes('REKEYING') ? 'REKEYING' : 'INSTALLED',
					in_bytes: 0,
					in_packets: 0,
					out_bytes: 0,
					out_packets: 0,
				};
				(currentConn.children as unknown[]).push(currentChild);
				currentConn.status = 'ESTABLISHED';
			}
			if (currentChild) {
				if (stripped.startsWith('in ') && stripped.includes('bytes') && stripped.includes('packets')) {
					try {
						const parts = stripped.split(',');
						if (parts.length >= 3) {
							(currentChild as Record<string, number>).in_bytes = Number.parseInt(
								parts[1]!.replace(/bytes/gi, '').trim(),
								10,
							);
							(currentChild as Record<string, number>).in_packets = Number.parseInt(
								parts[2]!.replace(/packets/gi, '').trim(),
								10,
							);
						}
					} catch {
						/* ignore */
					}
				} else if (stripped.startsWith('out ') && stripped.includes('bytes') && stripped.includes('packets')) {
					try {
						const parts = stripped.split(',');
						if (parts.length >= 3) {
							(currentChild as Record<string, number>).out_bytes = Number.parseInt(
								parts[1]!.replace(/bytes/gi, '').trim(),
								10,
							);
							(currentChild as Record<string, number>).out_packets = Number.parseInt(
								parts[2]!.replace(/packets/gi, '').trim(),
								10,
							);
						}
					} catch {
						/* ignore */
					}
				}
			}
		}
	}
	if (currentConn) {
		runningSasMap[String(currentConn.name)] = currentConn;
	}

	const finalConnections: Record<string, unknown>[] = [];
	const uniqueCloudIds = Array.from(new Set(cloudIds)).sort();

	for (const cid of uniqueCloudIds) {
		const targetP2 = `net${cid}`;
		const targetP1 = `conn${cid}`;
		let matched: Record<string, unknown> | null = null;
		let matchType: 'p2' | 'p1' | null = null;
		let originalIkeName: string | null = null;

		for (const [ikeName, ikeSa] of Object.entries(runningSasMap)) {
			const children = (ikeSa.children as Array<Record<string, unknown>>) ?? [];
			for (const child of children) {
				const st = String(child.status ?? '');
				const up = String(child.name) === targetP2 && (st === 'INSTALLED' || st === 'REKEYING');
				if (up) {
					matched = ikeSa;
					originalIkeName = ikeName;
					matchType = 'p2';
					break;
				}
			}
			if (matched) break;
		}
		if (!matched && runningSasMap[targetP1]) {
			matched = runningSasMap[targetP1]!;
			originalIkeName = targetP1;
			matchType = 'p1';
		}

		if (matched && originalIkeName) {
			const conn = { ...matched };
			conn.source = '云平台';
			if (matchType === 'p2') conn.status = 'ESTABLISHED';
			if (matchType === 'p1') conn.status = 'CONNECTING';
			conn.name = cid;
			delete runningSasMap[originalIkeName];
			finalConnections.push(conn);
		} else {
			finalConnections.push({
				name: cid,
				status: 'Disconnected',
				source: '云平台',
				local: '-',
				remote: '-',
				uptime: '-',
				children: [],
				raw_lines: ['云侧已配置该隧道，当前设备上未建立对应 SA'],
			});
		}
	}

	for (const conn of Object.values(runningSasMap)) {
		finalConnections.push(conn);
	}

	return { sas: finalConnections, raw: innerText };
}

export async function connectIpsec(paths: Paths, ipsec_id: string) {
	return runCsmScript({ opt: 'ipsec_sa_initiate_config', args: { ipsec_id } }, paths).then((r) =>
		r.ok ? { ok: true, output: r.output } : { error: r.error },
	);
}

export async function disconnectIpsec(paths: Paths, ipsec_id: string) {
	return runCsmScript({ opt: 'ipsec_sa_terminate_config', args: { ipsec_id } }, paths).then((r) =>
		r.ok ? { ok: true, output: r.output } : { error: r.error },
	);
}
