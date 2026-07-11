import fs from 'node:fs';
import path from 'node:path';
import type { Paths } from '../../vrwizard.js';
import { isForwardingMock, runClishArgv, runClishStdin, runCsmScript } from './clishCsm.js';

/** 常见：Name Idx up/down/dn；部分设备为 administratively down */
const tableIfRe =
	/^([A-Za-z0-9_.:/-]+)\s+\d+\s+(?:up|down|dn|admin(?:istratively)?\s+down)\b/i;
const addrIfRe = /^([A-Za-z0-9_.:/-]+)\s*\((?:up|down|dn)\):/i;

export async function getForwardingRoutes(paths: Paths) {
	const mockOut = `
Codes: K - kernel, C - connected, S - static, R - RIP, B - BGP
C       127.0.0.0/8 is directly connected, lo
S*      0.0.0.0/0 [1/0] via 192.168.1.1, eth0
`.trim();
	if (isForwardingMock(paths)) {
		return parseRouteOutput(mockOut);
	}
	const res = await runClishArgv(['-c', 'do show ip route'], paths, { timeoutMs: 5000 });
	if (!res.ok) return { error: res.error };
	return parseRouteOutput(res.output);
}

const routeCodes = new Set(['K', 'C', 'S', 'R', 'B', 'O', 'i', '*']);

function parseRouteOutput(output: string) {
	const lines = output.split('\n');
	const routes: Array<{
		raw: string;
		protocol: string;
		prefix: string;
		next_hop: string;
		interface: string;
	}> = [];
	for (const line of lines) {
		const trimmed = line.trim();
		if (!trimmed) continue;
		const parts = trimmed.split(/\s+/);
		if (parts.length === 0) continue;
		const codePart = parts[0]!;
		const firstChar = codePart[0]!;
		if (!routeCodes.has(firstChar)) continue;
		const entry = {
			raw: trimmed,
			protocol: codePart,
			prefix: parts.length > 1 ? parts[1]! : '',
			next_hop: '',
			interface: '',
		};
		if (parts.includes('via')) {
			const viaIdx = parts.indexOf('via');
			if (viaIdx + 1 < parts.length) {
				entry.next_hop = parts[viaIdx + 1]!.replace(/,$/, '');
				if (viaIdx + 2 < parts.length) {
					const candidate = parts[viaIdx + 2]!.replace(/,$/, '');
					if (!candidate.includes(':')) entry.interface = candidate;
				}
			}
		} else if (parts.some((p) => p.includes('connected'))) {
			entry.next_hop = 'Connected';
			let connIdx = -1;
			for (let i = 0; i < parts.length; i++) {
				if (parts[i]!.includes('connected')) {
					connIdx = i;
					break;
				}
			}
			if (connIdx !== -1 && connIdx + 1 < parts.length) {
				entry.interface = parts[connIdx + 1]!.replace(/,$/, '');
			}
		}
		if (!entry.interface && parts.length > 0) {
			const last = parts[parts.length - 1]!.replace(/,$/, '');
			if (!last.includes(':')) entry.interface = last;
		}
		routes.push(entry);
	}
	return { routes, raw_output: output };
}

export async function addRoute(paths: Paths, body: { dst: string; gw: string; vrf_id?: string }): Promise<Record<string, unknown>> {
	const payload = {
		opt: 'route_add',
		args: { vrf_id: body.vrf_id ?? '', dst: body.dst, gw: body.gw },
	};
	const r = await runCsmScript(payload, paths);
	return r.ok ? { ok: true, output: r.output } : { error: r.error };
}

export async function deleteRoute(
	paths: Paths,
	body: { dst: string; gw: string; vrf_id?: string },
): Promise<Record<string, unknown>> {
	const payload = {
		opt: 'route_del',
		args: { vrf_id: body.vrf_id ?? '', dst: body.dst, gw: body.gw },
	};
	const r = await runCsmScript(payload, paths);
	return r.ok ? { ok: true, output: r.output } : { error: r.error };
}

export async function listInterfaces(paths: Paths): Promise<{ interfaces: string[] }> {
	if (isForwardingMock(paths)) {
		return { interfaces: ['GigabitEthernet2/1/0', 'GigabitEthernet2/2/0', 'loop0', 'vbras0'] };
	}
	const interfaces = new Set<string>();

	const res1 = await runClishStdin('do show interface', paths);
	if (res1.ok) {
		for (const line of res1.output.split('\n')) {
			const t = line.trim();
			if (!t) continue;
			const m = tableIfRe.exec(t);
			if (m) {
				const ifName = m[1]!;
				if (ifName.toLowerCase() !== 'name') interfaces.add(ifName);
			}
		}
	}

	const res2 = await runClishStdin('do show interface address', paths);
	if (res2.ok) {
		for (const line of res2.output.split('\n')) {
			const t = line.trim();
			const m = addrIfRe.exec(t);
			if (m) interfaces.add(m[1]!);
		}
	}

	// Strategy 3：running-config 中的 interface 块名（与 show interface 表格版式无关，避免下拉为空）
	const resCfg = await runClishStdin('do show running-config', paths);
	if (resCfg.ok) {
		for (const line of resCfg.output.split('\n')) {
			const t = line.trim();
			if (!t.toLowerCase().startsWith('interface ')) continue;
			const rest = t.slice('interface '.length).trim();
			if (!rest) continue;
			if (rest.toLowerCase().startsWith('range ')) continue;
			interfaces.add(rest);
		}
	}

	return { interfaces: Array.from(interfaces).sort() };
}

export function agentConfigFiles(paths: Paths): string[] {
	const dir = paths.base ? path.join(paths.base, 'rhos', 'etc', 'agent', 'download') : '/rhos/etc/agent/download';
	if (!fs.existsSync(dir)) return [];
	return fs
		.readdirSync(dir)
		.filter((f) => f.endsWith('.bak'))
		.map((f) => path.join(dir, f));
}

export function getForwardingAgentConfig(paths: Paths): Record<string, unknown> {
	const files = agentConfigFiles(paths);
	const result: Array<{ filename: string; content: unknown; raw?: string; error?: string }> = [];
	if (files.length === 0) {
		if (isForwardingMock(paths)) {
			return {
				config: [
					{
						filename: 'mock_config.bak',
						content: { ipsec: [{ ID: 'mock_tunnel' }], report_config_status: 'applied' },
						raw: '{"ipsec": [{"ID": "mock_tunnel"}], "report_config_status": "applied"}',
					},
				],
			};
		}
		return { config: [], message: 'No config files found' };
	}
	for (const fpath of files) {
		try {
			const content = fs.readFileSync(fpath, 'utf-8');
			try {
				const jsonContent = JSON.parse(content) as unknown;
				result.push({ filename: path.basename(fpath), content: jsonContent, raw: content });
			} catch {
				result.push({ filename: path.basename(fpath), content: null, raw: content });
			}
		} catch (e) {
			result.push({
				filename: path.basename(fpath),
				content: null,
				error: e instanceof Error ? e.message : String(e),
			});
		}
	}
	return { config: result };
}
