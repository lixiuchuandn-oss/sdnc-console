import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { loadState, saveState, type JsonObject, type Paths } from '../../vrwizard.js';

export type AssetRecord = Record<string, unknown>;

const assetScanProcs = new Map<string, ChildProcess>();

export function parseNmapAssets(text: string, ts: string, subnets: string): AssetRecord[] {
	const assets: AssetRecord[] = [];
	let current: AssetRecord | null = null;
	for (const raw of text.split(/\r?\n/)) {
		const line = raw.trim();
		if (!line) continue;
		if (line.startsWith('Nmap scan report for ')) {
			if (current) assets.push(current);
			const parts = line.split(/\s+/);
			const ip = parts[parts.length - 1] ?? '';
			current = {
				id: ip,
				ip,
				name: ip,
				type: '未知设备',
				os: '',
				source: '主动扫描',
				lastSeen: ts,
				lastScan: ts,
				lastActive: ts,
				firstSeen: ts,
				sources: ['资产发现'],
				subnets,
				ports: [],
			};
			continue;
		}
		if (current && line.includes('/')) {
			const parts = line.split(/\s+/);
			const first = parts[0] ?? '';
			if (!first.includes('/')) continue;
			const slash = first.split('/');
			const portStr = slash[0];
			const proto = slash[1] ?? '';
			const port = Number.parseInt(portStr ?? '', 10);
			if (Number.isNaN(port)) continue;
			const state = parts[1] ?? '';
			const service = parts[2] ?? '';
			let risk = 'medium';
			if (state !== 'open') risk = 'low';
			else if ([22, 53].includes(port)) risk = 'low';
			else if ([80, 443, 8080, 8443, 179].includes(port)) risk = 'medium';
			else if ([3389, 5900, 3306, 1433, 1521, 6379, 27017].includes(port)) risk = 'high';
			const portEntry = {
				port,
				proto: proto.toUpperCase(),
				service,
				state,
				risk,
				from: '资产发现',
				lastScan: ts,
			};
			const ports = current.ports;
			if (Array.isArray(ports)) ports.push(portEntry);
			continue;
		}
	}
	if (current) assets.push(current);
	for (const a of assets) {
		const ports = Array.isArray(a.ports) ? (a.ports as AssetRecord[]) : [];
		let score = 0;
		for (const p of ports) {
			if (p.risk === 'high') {
				score = 3;
				break;
			}
			if (p.risk === 'medium' && score < 2) score = 2;
			if (p.risk === 'low' && score < 1) score = 1;
		}
		let risk = 'low';
		if (score === 3) risk = 'high';
		else if (score === 2) risk = 'medium';
		a.risk = risk;
	}
	return assets;
}

export function mergeAssets(prev: AssetRecord[], next: AssetRecord[]): AssetRecord[] {
	const merged = new Map<string, AssetRecord>();
	for (const a of prev) {
		const ip = String(a.ip ?? a.id ?? '');
		if (!ip) continue;
		merged.set(ip, a);
	}
	for (const a of next) {
		const ip = String(a.ip ?? a.id ?? '');
		if (!ip) continue;
		if (merged.has(ip)) {
			const old = merged.get(ip)!;
			const firstSeen = old.firstSeen ?? a.firstSeen;
			const combined: AssetRecord = { ...old, ...a };
			if (firstSeen) combined.firstSeen = firstSeen;
			merged.set(ip, combined);
		} else {
			merged.set(ip, a);
		}
	}
	return [...merged.values()];
}

function writeScanLast(paths: Paths, last: JsonObject) {
	const state = loadState(paths);
	state.asset_scan_last = last;
	saveState(paths, state);
}

export function runNmapAsync(paths: Paths, subnets: string, ts: string): void {
	const nmapBin = process.env.VRWIZARD_NMAP_BIN?.trim() || 'nmap';
	const env: NodeJS.ProcessEnv = { ...process.env, LANG: 'C', LC_ALL: 'C' };
	if (process.platform !== 'win32' && !env.NMAPDIR && existsSync('/usr/local/share/nmap')) {
		env.NMAPDIR = '/usr/local/share/nmap';
	}
	const targets = subnets
		.split(',')
		.map((s) => s.trim())
		.filter(Boolean);
	const args = [nmapBin, '--stats-every', '3s', ...targets];
	let proc: ChildProcess;
	try {
		proc = spawn(args[0]!, args.slice(1), {
			env,
			windowsHide: true,
			stdio: ['ignore', 'pipe', 'pipe'],
		});
	} catch (e) {
		writeScanLast(paths, {
			ok: false,
			status: 'error',
			error: e instanceof Error ? e.message : String(e),
			subnets,
			ts,
		});
		return;
	}
	assetScanProcs.set(ts, proc);
	if (!proc.stdout) {
		proc.on('close', (code) => {
			writeScanLast(paths, {
				ok: code === 0,
				status: code === 0 ? 'done' : 'error',
				output: '',
				subnets,
				ts,
			});
			assetScanProcs.delete(ts);
		});
		return;
	}
	const outputLines: string[] = [];
	let snippet = '';
	const onChunk = (chunk: string) => {
		outputLines.push(chunk);
		snippet += chunk;
		if (snippet.length > 4000) snippet = snippet.slice(-4000);
		const state = loadState(paths);
		const last = (state.asset_scan_last && typeof state.asset_scan_last === 'object'
			? { ...(state.asset_scan_last as JsonObject) }
			: {}) as JsonObject;
		Object.assign(last, {
			ok: true,
			status: 'running',
			output: snippet,
			subnets,
			ts,
		});
		state.asset_scan_last = last;
		saveState(paths, state);
	};
	proc.stdout.setEncoding('utf8');
	proc.stdout.on('data', onChunk);
	if (proc.stderr) {
		proc.stderr.setEncoding('utf8');
		proc.stderr.on('data', onChunk);
	}
	proc.on('close', (code) => {
		const joined = outputLines.join('');
		const outSnippet = joined.length > 4000 ? joined.slice(-4000) : joined;
		const state = loadState(paths);
		const last = (state.asset_scan_last && typeof state.asset_scan_last === 'object'
			? { ...(state.asset_scan_last as JsonObject) }
			: {}) as JsonObject;
		Object.assign(last, {
			ok: code === 0,
			status: code === 0 ? 'done' : 'error',
			output: outSnippet,
			subnets,
			ts,
		});
		const assetsPrev = Array.isArray(state.assets) ? (state.assets as AssetRecord[]) : [];
		const assetsNew = parseNmapAssets(joined, ts, subnets);
		state.assets = mergeAssets(assetsPrev, assetsNew);
		state.asset_scan_last = last;
		saveState(paths, state);
		assetScanProcs.delete(ts);
	});
	proc.on('error', (err) => {
		writeScanLast(paths, {
			ok: false,
			status: 'error',
			error: err.message,
			subnets,
			ts,
		});
		assetScanProcs.delete(ts);
	});
}

export function cancelAssetScan(paths: Paths): JsonObject {
	const state = loadState(paths);
	const last =
		state.asset_scan_last && typeof state.asset_scan_last === 'object'
			? ({ ...(state.asset_scan_last as JsonObject) } as JsonObject)
			: ({} as JsonObject);
	const status = last.status;
	if (status !== 'running') {
		return {
			ok: true,
			status: status || 'idle',
			subnets: last.subnets,
			ts: last.ts || new Date().toISOString(),
			message: '当前没有运行中的资产扫描任务',
		};
	}
	const tsLast = last.ts;
	if (typeof tsLast === 'string') {
		const proc = assetScanProcs.get(tsLast);
		if (proc && !proc.killed) {
			try {
				proc.kill('SIGTERM');
			} catch {
				/* ignore */
			}
		}
		assetScanProcs.delete(tsLast);
	}
	last.ok = false;
	last.status = 'error';
	last.error = '扫描任务已被手动终止';
	state.asset_scan_last = last;
	saveState(paths, state);
	return last;
}

export function getAssetScanProc(ts: string): ChildProcess | undefined {
	return assetScanProcs.get(ts);
}
