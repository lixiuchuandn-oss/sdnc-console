/**
 * 网卡初始化：清 OS 内核口地址、清 clish 口级残留（保留全局业务对象）。
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseVbrasShowInterfaceAddress, parseVbrasTapInject } from '../../nicRolesSnapshot.js';
import { normalizeVppCliIfname } from '../../pciVpp.js';
import { runVbrasCli } from '../../vbrasCli.js';
import type { Paths } from '../../vrwizard.js';
import { ipLinkSet } from '../../vrwizard.js';
import { runClishArgv, runClishStdin, type ClishResult } from '../forwarding/clishCsm.js';
import { interfaceLineMatchesPci, mergeVppAddressTargets, pciToClishIfaceName } from './startupConfigMerge.js';

function runHost(args: string[], timeoutMs: number): string {
	if (process.platform === 'win32') return '';
	try {
		return execFileSync(args[0]!, args.slice(1), {
			encoding: 'utf8',
			timeout: timeoutMs,
			stdio: ['ignore', 'pipe', 'pipe'],
		}).trim();
	} catch (e) {
		const err = e as Error & { stderr?: Buffer | string; stdout?: Buffer | string };
		const msg = (typeof err.stderr === 'string' ? err.stderr : err.stderr?.toString('utf8')) || err.message;
		throw new Error(msg || 'host command failed');
	}
}

/** 清空内核侧地址并使口 down（交给 VPP 前）。 */
export function flushOsInterfaceAddresses(ifnames: string[], logs: string[]): void {
	if (process.platform === 'win32') {
		logs.push('Windows 跳过 OS 口地址清理');
		return;
	}
	for (const ifn of ifnames) {
		const name = ifn.trim();
		if (!name) continue;
		try {
			runHost(['ip', 'addr', 'flush', 'dev', name], 3000);
			logs.push(`已 flush OS 地址: ${name}`);
		} catch (e) {
			logs.push(`flush OS 地址失败 ${name}: ${e instanceof Error ? e.message : String(e)}`);
		}
		try {
			ipLinkSet({ ifname: name, state: 'down' });
			logs.push(`已 down OS 口: ${name}`);
		} catch (e) {
			logs.push(`down OS 口失败 ${name}: ${e instanceof Error ? e.message : String(e)}`);
		}
	}
}

type ParsedIface = {
	name: string;
	ipv4: string[];
	ipv6: string[];
	vrf?: string;
	aclLines: string[];
	vrrpLines: string[];
	otherRemovals: string[];
	isSub: boolean;
};

function parseRunningInterfaceBlocks(output: string): ParsedIface[] {
	const out: ParsedIface[] = [];
	let cur: ParsedIface | null = null;
	const flush = () => {
		if (cur?.name) out.push(cur);
		cur = null;
	};
	for (const line of output.split(/\r?\n/)) {
		const t = line.trim();
		if (!t || t === '!') {
			if (t === '!') flush();
			continue;
		}
		if (/^interface\s+/i.test(t)) {
			flush();
			const name = t.replace(/^interface\s+/i, '').trim().replace(/\s+/g, ' ');
			const compact = name.replace(/\s+/g, '');
			cur = {
				name,
				ipv4: [],
				ipv6: [],
				aclLines: [],
				vrrpLines: [],
				otherRemovals: [],
				isSub: /\.\d+$/.test(compact),
			};
			continue;
		}
		if (!cur) continue;
		let m = /^ip address\s+(\S+)/i.exec(t);
		if (m) {
			cur.ipv4.push(m[1]!);
			continue;
		}
		m = /^ipv6 address\s+(\S+)/i.exec(t);
		if (m) {
			cur.ipv6.push(m[1]!);
			continue;
		}
		m = /^vrf\s+(\S+)/i.exec(t);
		if (m && !/^vrf enable/i.test(t)) {
			cur.vrf = m[1];
			continue;
		}
		if (/^vrf enable/i.test(t)) {
			cur.otherRemovals.push('no vrf enable');
			continue;
		}
		if (/^ip access-group\s+/i.test(t) || /^acl\s+\S+\s+(in|out|input|output)\b/i.test(t)) {
			cur.aclLines.push(`no ${t}`);
			continue;
		}
		if (/^vrrp\b/i.test(t)) {
			cur.vrrpLines.push(`no ${t}`);
			continue;
		}
	}
	flush();
	return out;
}

async function runClishChain(paths: Paths, cmds: string[], timeoutMs = 20000): Promise<ClishResult> {
	if (cmds.length === 0) return { ok: true, output: '' };
	const argv = cmds.flatMap((c) => ['-c', c]);
	return runClishArgv(argv, paths, { timeoutMs });
}

function splitVppL3(ips: string[]): { ipv4: string[]; ipv6: string[] } {
	const ipv4: string[] = [];
	const ipv6: string[] = [];
	for (const raw of ips) {
		const ip = raw.trim();
		if (!ip) continue;
		if (ip.includes(':')) ipv6.push(ip);
		else ipv4.push(ip);
	}
	return { ipv4, ipv6 };
}

/** 对 running-config 未命中的 PCI，用 VPP `show interface address` 补口级 IPv4/IPv6 清理目标。 */
async function synthesizeTargetsFromVbrasAddress(
	paths: Paths,
	pcis: string[],
	logs: string[],
): Promise<ParsedIface[]> {
	if (pcis.length === 0) return [];
	try {
		const raw = await runVbrasCli(paths, 'show interface address\n', 10000);
		const parsed = parseVbrasShowInterfaceAddress(raw);
		const out: ParsedIface[] = [];
		for (const pci of pcis) {
			let clishName = '';
			try {
				clishName = pciToClishIfaceName(pci);
			} catch {
				continue;
			}
			const compact = clishName.replace(/\s+/g, '');
			const keys = [compact, normalizeVppCliIfname(compact), clishName];
			let ips: string[] = [];
			for (const k of keys) {
				const hit = parsed.get(k);
				if (hit?.ips?.length) {
					ips = hit.ips;
					break;
				}
			}
			if (ips.length === 0) continue;
			const { ipv4, ipv6 } = splitVppL3(ips);
			out.push({
				name: clishName,
				ipv4,
				ipv6,
				aclLines: [],
				vrrpLines: [],
				otherRemovals: [],
				isSub: false,
			});
		}
		if (out.length) {
			logs.push(`按 show interface address 补清 VPP 残留地址: ${out.map((x) => `${x.name}[${[...x.ipv4, ...x.ipv6].join(',')}]`).join('; ')}`);
		}
		return out;
	} catch (e) {
		logs.push(`读取 show interface address 失败: ${e instanceof Error ? e.message : String(e)}`);
		return [];
	}
}

/**
 * 对指定 PCI 对应接口（含可选子接口）清口级配置；不删 ACL/BGP 等全局对象。
 */
export async function clearClishInterfacesForPcis(
	paths: Paths,
	pcis: string[],
	logs: string[],
	opts?: { removeSubinterfaces?: boolean; clearAllFrrVsw?: boolean; ipsOnly?: boolean },
): Promise<void> {
	const removeSub = opts?.removeSubinterfaces !== false;
	const ipsOnly = opts?.ipsOnly === true;
	let running = '';
	let runningOk = false;
	try {
		const res = await runClishStdin('do show running-config', paths);
		if (!res.ok) {
			logs.push(`读取 running-config 失败: ${'error' in res ? res.error : ''}；将尝试按 VPP 地址表清理`);
		} else {
			running = res.output;
			runningOk = true;
		}
	} catch (e) {
		logs.push(`读取 running-config 异常: ${e instanceof Error ? e.message : String(e)}；将尝试按 VPP 地址表清理`);
	}

	const blocks = runningOk ? parseRunningInterfaceBlocks(running) : [];
	const fromRunning = blocks.filter((b) => pcis.some((pci) => interfaceLineMatchesPci(b.name, pci)));
	// running 有空 interface 段 ≠ VPP L3 已清（pe1 WAN 11.1.1.1 仍在 hardware）。始终按地址表并入。
	const fromVpp = await synthesizeTargetsFromVbrasAddress(paths, pcis, logs);
	const targets = mergeVppAddressTargets(fromRunning, fromVpp);
	if (targets.length === 0) {
		logs.push('running-config / VPP 地址表均无待清接口项（可能已干净）');
	}

	for (const b of targets) {
		if (b.isSub && removeSub) {
			const cmds = [`no interface ${b.name}`, 'do save'];
			const res = await runClishChain(paths, cmds);
			logs.push(res.ok ? `已删除子接口 ${b.name}` : `删除子接口失败 ${b.name}: ${'error' in res ? res.error : ''}`);
			continue;
		}
		if (b.isSub && !removeSub) continue;

		if (ipsOnly) {
			if (b.ipv4.length === 0 && b.ipv6.length === 0) continue;
			const cmds: string[] = [`interface ${b.name}`];
			for (const ip of b.ipv4) cmds.push(`no ip address ${ip}`);
			for (const ip of b.ipv6) cmds.push(`no ipv6 address ${ip}`);
			cmds.push('do save');
			const res = await runClishChain(paths, cmds, 30000);
			logs.push(
				res.ok
					? `已清口地址: ${b.name} (ip=${[...b.ipv4, ...b.ipv6].join(',') || '-'})`
					: `清口地址失败 ${b.name}: ${'error' in res ? res.error : ''}`,
			);
			continue;
		}

		const cmds: string[] = [`interface ${b.name}`];
		for (const ip of b.ipv4) cmds.push(`no ip address ${ip}`);
		for (const ip of b.ipv6) cmds.push(`no ipv6 address ${ip}`);
		if (b.vrf) cmds.push(`no vrf ${b.vrf}`);
		cmds.push(...b.otherRemovals);
		cmds.push(...b.aclLines);
		cmds.push(...b.vrrpLines);
		cmds.push('no shutdown');
		cmds.push('do save');
		const removals = cmds.filter((c) => c !== `interface ${b.name}` && c !== 'no shutdown' && c !== 'do save');
		if (removals.length === 0) {
			logs.push(`接口 ${b.name} 无可清口级项`);
			continue;
		}
		const res = await runClishChain(paths, cmds, 30000);
		logs.push(
			res.ok
				? `已清口级配置: ${b.name} (ip=${[...b.ipv4, ...b.ipv6].join(',') || '-'})`
				: `清口级配置失败 ${b.name}: ${'error' in res ? res.error : ''}`,
		);
	}

	await clearFrrTapIpsForPcis(paths, pcis, logs, { allVsw: opts?.clearAllFrrVsw === true });
}

function lastApplyTrim(o: Record<string, unknown>, key: string): string {
	return typeof o[key] === 'string' ? String(o[key]).trim() : '';
}

export function lastApplyHasInterfaceIps(lastApply: unknown): boolean {
	if (!lastApply || typeof lastApply !== 'object') return false;
	const o = lastApply as Record<string, unknown>;
	return Boolean(
		lastApplyTrim(o, 'public_ip') ||
			lastApplyTrim(o, 'private_ip') ||
			lastApplyTrim(o, 'public_ipv6') ||
			lastApplyTrim(o, 'private_ipv6'),
	);
}

/** 初始化后不得把历史 WAN/LAN IP 再灌回；无 CIDR 时跳过。 */
export function shouldReapplyLastApplyIps(lastApply: unknown): boolean {
	return lastApplyHasInterfaceIps(lastApply);
}

export function selectFrrVswIpTargets(
	blocks: Array<{ name: string; ipv4: string[]; ipv6: string[] }>,
	taps: Set<string> | null,
): Array<{ name: string; ipv4: string[]; ipv6: string[] }> {
	return blocks.filter((b) => {
		if (!/^vsw\d+$/i.test(b.name)) return false;
		if (taps && !taps.has(b.name)) return false;
		return b.ipv4.length > 0 || b.ipv6.length > 0;
	});
}

export function parseVtyshInterfaceBlocks(text: string): Array<{ name: string; ipv4: string[]; ipv6: string[] }> {
	const out: Array<{ name: string; ipv4: string[]; ipv6: string[] }> = [];
	let cur: { name: string; ipv4: string[]; ipv6: string[] } | null = null;
	const flush = () => {
		if (cur?.name) out.push(cur);
		cur = null;
	};
	for (const line of text.split(/\r?\n/)) {
		const t = line.trim();
		if (/^interface\s+\S+/i.test(t)) {
			flush();
			cur = { name: t.replace(/^interface\s+/i, '').trim(), ipv4: [], ipv6: [] };
			continue;
		}
		if (!cur) continue;
		if (/^exit$/i.test(t) || t === '!') {
			flush();
			continue;
		}
		let m = /^ip address\s+(\S+)/i.exec(t);
		if (m) {
			cur.ipv4.push(m[1]!);
			continue;
		}
		m = /^ipv6 address\s+(\S+)/i.exec(t);
		if (m) cur.ipv6.push(m[1]!);
	}
	flush();
	return out;
}

function runVtysh(cmds: string[], timeoutMs = 15000): { ok: boolean; output: string } {
	if (process.platform === 'win32' || cmds.length === 0) return { ok: true, output: '' };
	try {
		let output = '';
		if (cmds.length === 1) {
			output = execFileSync('vtysh', ['-c', cmds[0]!], {
				encoding: 'utf8',
				timeout: timeoutMs,
				stdio: ['ignore', 'pipe', 'pipe'],
			});
		} else {
			const tmp = path.join(os.tmpdir(), `paas-vtysh-${process.pid}-${Date.now()}.conf`);
			fs.writeFileSync(tmp, `${cmds.join('\n')}\n`, 'utf8');
			try {
				output = execFileSync('vtysh', ['-f', tmp], {
					encoding: 'utf8',
					timeout: timeoutMs,
					stdio: ['ignore', 'pipe', 'pipe'],
				});
			} finally {
				try {
					fs.unlinkSync(tmp);
				} catch {
					/* ignore */
				}
			}
		}
		return { ok: true, output };
	} catch (e) {
		const err = e as Error & { stderr?: Buffer | string; stdout?: Buffer | string };
		const msg =
			(typeof err.stderr === 'string' ? err.stderr : err.stderr?.toString('utf8')) ||
			(typeof err.stdout === 'string' ? err.stdout : err.stdout?.toString('utf8')) ||
			err.message;
		return { ok: false, output: msg || 'vtysh failed' };
	}
}

/** 清 FRR 后内核 vsw 仍可能留地址，zebra 重启会再灌进 VPP。 */
export function flushKernelVswAddresses(logs: string[], only?: Set<string> | null): void {
	if (process.platform === 'win32') return;
	let names: string[] = [];
	try {
		names = fs.readdirSync('/sys/class/net').filter((n) => /^vsw\d+$/i.test(n));
	} catch {
		return;
	}
	if (only && only.size > 0) names = names.filter((n) => only.has(n));
	for (const name of names) {
		try {
			runHost(['ip', 'addr', 'flush', 'dev', name], 3000);
			logs.push(`已 flush 内核 tap 地址: ${name}`);
		} catch (e) {
			logs.push(`flush 内核 tap 失败 ${name}: ${e instanceof Error ? e.message : String(e)}`);
		}
	}
}

/**
 * clish 清 VPP 口地址后，FRR `interface vswN` 仍可能持久化同一套 IP。
 * 退回 OS / 扩容重启时 tap-inject 序号会重排，旧 vsw 地址会灌到当前 WAN/LAN。
 * 初始化须 `allVsw: true`：不依赖当时映射，把全部 vsw 口地址清掉并 write。
 */
export async function clearFrrTapIpsForPcis(
	paths: Paths,
	pcis: string[],
	logs: string[],
	opts?: { allVsw?: boolean },
): Promise<void> {
	if (process.platform === 'win32') return;
	const allVsw = opts?.allVsw === true;
	if (!allVsw && pcis.length === 0) return;

	const taps = new Set<string>();
	if (!allVsw) {
		let tapMap = new Map<string, string>();
		try {
			const raw = await runVbrasCli(paths, 'show tap-inject\n', 8000);
			tapMap = parseVbrasTapInject(raw);
		} catch (e) {
			logs.push(`读取 tap-inject 失败: ${e instanceof Error ? e.message : String(e)}`);
			return;
		}
		for (const pci of pcis) {
			let vppName = '';
			try {
				vppName = pciToClishIfaceName(pci).replace(/\s+/g, '');
			} catch {
				continue;
			}
			const tap = tapMap.get(vppName) || tapMap.get(normalizeVppCliIfname(vppName));
			if (tap && /^vsw\d+$/i.test(tap)) taps.add(tap);
		}
		if (taps.size === 0) {
			logs.push('tap-inject 无对应 vsw，跳过 FRR 口地址清理');
			return;
		}
	}

	const shown = runVtysh(['show running-config']);
	if (!shown.ok) {
		logs.push(`读取 FRR running-config 失败: ${shown.output}`);
		flushKernelVswAddresses(logs, allVsw ? null : taps);
		return;
	}
	const blocks = parseVtyshInterfaceBlocks(shown.output);
	const targets = selectFrrVswIpTargets(blocks, allVsw ? null : taps);
	if (targets.length === 0) {
		logs.push(allVsw ? 'FRR 无 vsw 口地址待清' : `FRR ${Array.from(taps).join(',')} 无待清口地址`);
		flushKernelVswAddresses(logs, allVsw ? null : taps);
		return;
	}

	const cmds: string[] = ['configure terminal'];
	for (const b of targets) {
		cmds.push(`interface ${b.name}`);
		for (const ip of b.ipv4) cmds.push(`no ip address ${ip}`);
		for (const ip of b.ipv6) cmds.push(`no ipv6 address ${ip}`);
		cmds.push('exit');
	}
	cmds.push('end', 'write memory');
	const res = runVtysh(cmds, 20000);
	logs.push(
		res.ok
			? `已清 FRR tap 口地址: ${targets.map((t) => `${t.name}[${[...t.ipv4, ...t.ipv6].join(',')}]`).join('; ')}`
			: `清 FRR tap 口地址失败: ${res.output}`,
	);
	flushKernelVswAddresses(logs, allVsw ? null : taps);
}

export async function suppressUnappliedInterfaceIps(params: {
	paths: Paths;
	lastApply: unknown;
	pcis: string[];
	logs: string[];
	phase: 'before-restart' | 'after-restart';
}): Promise<void> {
	if (shouldReapplyLastApplyIps(params.lastApply)) return;
	if (params.phase === 'before-restart') {
		params.logs.push('未设定 WAN/LAN IP：重启前清 FRR/内核 tap，避免灌回初始化已清的地址');
		await clearFrrTapIpsForPcis(params.paths, params.pcis, params.logs, { allVsw: true });
		return;
	}
	params.logs.push('未设定 WAN/LAN IP：重启后再次清 VPP/FRR 口地址');
	if (params.pcis.length === 0) {
		await clearFrrTapIpsForPcis(params.paths, [], params.logs, { allVsw: true });
		return;
	}
	await clearClishInterfacesForPcis(params.paths, params.pcis, params.logs, {
		removeSubinterfaces: false,
		clearAllFrrVsw: true,
		ipsOnly: true,
	});
}

export function clearLastApplyInterfaceIps(state: Record<string, unknown>, logs: string[]): void {
	const last = state.last_apply;
	if (!last || typeof last !== 'object') return;
	const o = { ...(last as Record<string, unknown>) };
	delete o.public_ip;
	delete o.private_ip;
	delete o.public_ipv6;
	delete o.private_ipv6;
	delete o.public_gw;
	state.last_apply = o;
	logs.push('已清除 last_apply 中的 WAN/LAN IP（初始化后不再自动灌回）');
}

export function describeCleanTargets(pcis: string[]): string[] {
	return pcis.map((pci) => {
		try {
			return `${pci} → ${pciToClishIfaceName(pci)}`;
		} catch {
			return pci;
		}
	});
}

/** 与设备集成-vtysh 默认一致；出厂只保留壳，不含 BGP/SRv6/业务静路。 */
export const FRR_CONF_PATH = '/etc/frr/frr.conf';

export function buildFactoryFrrConf(hostname: string): string {
	const host = String(hostname || 'localhost')
		.trim()
		.replace(/[^\w.-]+/g, '')
		.slice(0, 63) || 'localhost';
	return [
		'frr version 9.1.2',
		'frr defaults traditional',
		`hostname ${host}`,
		'log syslog informational',
		'service integrated-vtysh-config',
		'!',
		'',
	].join('\n');
}

/**
 * 出厂必须清 FRR：`/rhos/etc/cli/startup-config` 只服务 clish/VPP；
 * BGP/SRv6 持久在 `/etc/frr/frr.conf`，仅 systemctl 重启 vbras 不会重放空 startup 到 FRR。
 * onekey_restart_ipoe 也只是 stop frr+vbras 再 start vbras，不会改写 frr.conf。
 */
export function resetFrrFactoryBaseline(logs: string[]): { ok: boolean } {
	if (process.platform === 'win32') {
		logs.push('Windows 跳过 FRR 出厂清空');
		return { ok: true };
	}
	const host = (() => {
		try {
			return os.hostname().split('.')[0] || 'localhost';
		} catch {
			return 'localhost';
		}
	})();
	const content = buildFactoryFrrConf(host);
	try {
		try {
			execFileSync('systemctl', ['stop', 'frr'], {
				encoding: 'utf8',
				timeout: 60_000,
				stdio: ['ignore', 'pipe', 'pipe'],
			});
			logs.push('已停止 frr 服务');
		} catch (e) {
			logs.push(`停止 frr 警告: ${e instanceof Error ? e.message : String(e)}`);
		}
		fs.mkdirSync(path.dirname(FRR_CONF_PATH), { recursive: true });
		fs.writeFileSync(FRR_CONF_PATH, content, 'utf8');
		try {
			execFileSync('chown', ['frr:frr', FRR_CONF_PATH], {
				encoding: 'utf8',
				timeout: 5000,
				stdio: ['ignore', 'pipe', 'pipe'],
			});
		} catch {
			/* 非 root / 无 frr 用户时忽略，仍尝试启动 */
		}
		try {
			execFileSync('chmod', ['640', FRR_CONF_PATH], {
				encoding: 'utf8',
				timeout: 5000,
				stdio: ['ignore', 'pipe', 'pipe'],
			});
		} catch {
			/* ignore */
		}
		logs.push(`已写空 FRR 基线配置: ${FRR_CONF_PATH}`);
		flushKernelVswAddresses(logs, null);
		execFileSync('systemctl', ['start', 'frr'], {
			encoding: 'utf8',
			timeout: 60_000,
			stdio: ['ignore', 'pipe', 'pipe'],
		});
		logs.push('已启动 frr 服务（无 BGP/SRv6 业务段）');
		return { ok: true };
	} catch (e) {
		const msg = e instanceof Error ? e.message : String(e);
		logs.push(`FRR 出厂清空失败: ${msg}`);
		return { ok: false };
	}
}
