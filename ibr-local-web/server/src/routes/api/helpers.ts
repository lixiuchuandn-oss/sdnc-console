/**
 * API 层共用：trace、校验、子进程、OS 展示名等。
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import os from 'node:os';
import type { Response } from 'express';
import { pciToVppCliIfname, type SystemStats } from '../../vrwizard.js';

export const EMPTY_SYSTEM_STATS: SystemStats = {
	cpu: 0.0,
	cpu_count: 0,
	mem: 0.0,
	uptime: '',
	disk: 0.0,
	load_1: 0.0,
	load_5: 0.0,
	load_15: 0.0,
};

export function tracePayload(res: Response): { trace_id?: string } {
	const id = res.locals.traceId;
	if (typeof id === 'string' && id.length > 0) return { trace_id: id };
	return {};
}

export function readOsPrettyName(): string {
	if (process.platform !== 'linux') {
		const p = os.platform();
		const rel = os.release();
		return `${p} ${rel}`.trim();
	}
	try {
		const raw = readFileSync('/etc/os-release', 'utf8');
		const kv = new Map<string, string>();
		for (const line of raw.split(/\r?\n/)) {
			const s = line.trim();
			if (!s || s.startsWith('#')) continue;
			const eq = s.indexOf('=');
			if (eq <= 0) continue;
			const k = s.slice(0, eq).trim();
			let v = s.slice(eq + 1).trim();
			if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
			if (k) kv.set(k, v);
		}
		const pretty = kv.get('PRETTY_NAME') || '';
		if (pretty.trim()) return pretty.trim();
		const name = kv.get('NAME') || '';
		const ver = kv.get('VERSION') || kv.get('VERSION_ID') || '';
		return `${name} ${ver}`.trim() || `${os.platform()} ${os.release()}`.trim();
	} catch {
		return `${os.platform()} ${os.release()}`.trim();
	}
}

export function isIpv4(s: string) {
	const m = /^\s*(\d+)\.(\d+)\.(\d+)\.(\d+)\s*$/.exec(s);
	if (!m) return false;
	for (let i = 1; i <= 4; i++) {
		const n = Number(m[i]);
		if (!Number.isInteger(n) || n < 0 || n > 255) return false;
	}
	return true;
}

export function isCidr(s: string) {
	const t = s.trim();
	const m = /^(\d+\.\d+\.\d+\.\d+)\/(\d{1,2})$/.exec(t);
	if (!m) return false;
	if (!isIpv4(m[1]!)) return false;
	const mask = Number(m[2]);
	return Number.isInteger(mask) && mask >= 0 && mask <= 32;
}

/** vbras：`set interface ip address del <ifname> <cidr>`；`oldIpField` 可为逗号分隔的多个 CIDR。 */
export function vbrasDelIpLines(ifname: string, oldIpField: string): string[] {
	const seen = new Set<string>();
	const out: string[] = [];
	for (const seg of oldIpField.split(',')) {
		const c = seg.trim();
		if (!c || !isCidr(c)) continue;
		if (seen.has(c)) continue;
		seen.add(c);
		out.push(`set interface ip address del ${ifname} ${c}`);
	}
	return out;
}

export function pciToVbrasIfname(pci: string): string {
	return pciToVppCliIfname(pci);
}

export function vbrasRunningFromDetails(d: Record<string, unknown> | null): boolean {
	const s = String(d?.active_state ?? '').toLowerCase();
	return s.includes('active (running)');
}

export function runHostCmd(args: string[], timeoutMs: number): string {
	if (process.platform === 'win32') {
		throw new Error('Windows 环境不支持该操作');
	}
	try {
		return execFileSync(args[0]!, args.slice(1), { encoding: 'utf8', timeout: timeoutMs, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
	} catch (e) {
		const err = e as Error & { stdout?: Buffer | string; stderr?: Buffer | string };
		const stdout = typeof err.stdout === 'string' ? err.stdout : err.stdout?.toString('utf8') ?? '';
		const stderr = typeof err.stderr === 'string' ? err.stderr : err.stderr?.toString('utf8') ?? '';
		const msg = (stderr || stdout || err.message || '').trim();
		throw new Error(msg || 'command failed');
	}
}
