/**
 * 只读/扩展转发能力：BGP、VRF、IPv6 路由、VRRP、路由策略、SRv6、Agent 状态。
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import type { Paths } from '../../vrwizard.js';
import { getStructuredAgentConfig, normalizeConfigRoot } from './agentConfigParse.js';
import { isForwardingMock, runClishSingleCommand, runClishStdin, runClishArgv } from './clishCsm.js';

export function agentBaseDir(paths: Paths): string {
	return paths.base ? path.join(paths.base, 'rhos', 'etc', 'agent') : '/rhos/etc/agent';
}

/** agent 本机校验和：与 monitoring.agent 的 CONFIGURATION_CHECKSUM / PERSISTENT_CHECKSUM 对齐 */
export function agentChecksumPaths(paths: Paths): { live: string; persistent: string } {
	return {
		live: path.join(agentBaseDir(paths), '.checksum'),
		persistent: paths.base
			? path.join(paths.base, 'usr', 'local', 'src', 'vrconf', 'checksum')
			: '/usr/local/src/vrconf/checksum',
	};
}

export type RequestControllerSyncResult =
	| { ok: true; nics_initialized: true; registration_online: true; cleared: string[] }
	| { ok: false; error: string; nics_initialized?: boolean; registration_online?: boolean };

export type ClearAgentChecksumResult =
	| { ok: true; cleared: string[] }
	| { ok: false; error: string; cleared: string[] };

export type ClearAgentDownloadCacheResult =
	| { ok: true; removed: string[] }
	| { ok: false; error: string; removed: string[] };

/**
 * 清空 agent checksum。
 * 顺序：先把 live 截断为空，再删 persistent。
 * 进行中的 download 成功路径会 `cp live → persistent`；若先删 persistent 再清 live，
 * 可能把旧 live 写回 persistent，agent 重启后又对齐远端、跳过 first。
 * 两处都必须清：只清 live 而留下 persistent，agent 启动会把旧值拷回 live。
 */
export function clearAgentChecksum(paths: Paths): ClearAgentChecksumResult {
	const { live, persistent } = agentChecksumPaths(paths);
	const cleared: string[] = [];
	try {
		fs.mkdirSync(path.dirname(live), { recursive: true });
		fs.writeFileSync(live, '', 'utf8');
		cleared.push(live);
		if (fs.existsSync(persistent)) {
			fs.unlinkSync(persistent);
			cleared.push(persistent);
		}
		return { ok: true, cleared };
	} catch (e) {
		return {
			ok: false,
			error: `清除校验和失败: ${e instanceof Error ? e.message : String(e)}`,
			cleared,
		};
	}
}

export function agentDownloadDir(paths: Paths): string {
	return path.join(agentBaseDir(paths), 'download');
}

/**
 * 清空 agent download 目录下普通文件（保留目录本身）。
 * 出厂用：扫掉旧 uuid 的 bak/临时包，重注册后可走干净 first。
 * 「从控制器同步」不要走这里——只清 checksum 即可，由下一轮 download 覆盖当前 uuid 的 bak。
 */
export function clearAgentDownloadCache(paths: Paths): ClearAgentDownloadCacheResult {
	const dir = agentDownloadDir(paths);
	const removed: string[] = [];
	try {
		if (!fs.existsSync(dir)) {
			fs.mkdirSync(dir, { recursive: true });
			return { ok: true, removed };
		}
		for (const name of fs.readdirSync(dir)) {
			const full = path.join(dir, name);
			let st: fs.Stats;
			try {
				st = fs.statSync(full);
			} catch {
				continue;
			}
			if (!st.isFile()) continue;
			fs.unlinkSync(full);
			removed.push(full);
		}
		return { ok: true, removed };
	} catch (e) {
		return {
			ok: false,
			error: `清除 download 缓存失败: ${e instanceof Error ? e.message : String(e)}`,
			removed,
		};
	}
}

/**
 * 本机请求按 CSMCTL 当前 VR2 落地：清空 checksum，下一轮 download 会拉取。
 * 需网卡已初始化，且本地注册完成（ONLINE）。
 */
export function requestControllerConfigSync(
	paths: Paths,
	state: { os_nic_attach_pci?: unknown },
): RequestControllerSyncResult {
	if (!Array.isArray(state.os_nic_attach_pci) || state.os_nic_attach_pci.length === 0) {
		return { ok: false, error: '请先完成网卡初始化', nics_initialized: false };
	}
	const registrationOnline = fs.existsSync(path.join(agentBaseDir(paths), '.registration_finish'));
	if (!registrationOnline) {
		return {
			ok: false,
			error: '设备未注册（非 ONLINE），无法从控制器同步',
			nics_initialized: true,
			registration_online: false,
		};
	}
	const clearedResult = clearAgentChecksum(paths);
	if (!clearedResult.ok) {
		return {
			ok: false,
			error: clearedResult.error,
			nics_initialized: true,
			registration_online: true,
		};
	}
	return {
		ok: true,
		nics_initialized: true,
		registration_online: true,
		cleared: clearedResult.cleared,
	};
}

export function agentRegistrationFinishPath(paths: Paths): string {
	return path.join(agentBaseDir(paths), '.registration_finish');
}

export function isAgentRegistrationOnline(paths: Paths): boolean {
	return fs.existsSync(agentRegistrationFinishPath(paths));
}

/**
 * 身份载荷变化后清掉 ONLINE 标记，agent 主循环会再 POST /VR1/register。
 * uuid 不变时 CSMCTL 按原记录 update，不会新建实例。
 */
export function clearAgentRegistrationFinish(paths: Paths): boolean {
	const finish = agentRegistrationFinishPath(paths);
	if (!fs.existsSync(finish)) return false;
	fs.unlinkSync(finish);
	return true;
}

function pokeByPattern(pattern: string): boolean {
	try {
		const out = execFileSync('pgrep', ['-f', pattern], {
			encoding: 'utf8',
			timeout: 3000,
		});
		const pids = out
			.split(/\s+/)
			.map((s) => s.trim())
			.filter((s) => /^\d+$/.test(s));
		let poked = false;
		for (const pid of pids) {
			try {
				process.kill(Number(pid), 'SIGUSR1');
				poked = true;
			} catch {
				/* 进程已退出则忽略 */
			}
		}
		return poked;
	} catch {
		return false;
	}
}

/** 向 vrctl.agent 发 SIGUSR1，打断 auth/register/主循环等待，尽快发现身份文件变化。 */
export function pokeVrctlAgent(): boolean {
	return pokeByPattern('^/bin/bash /rhos/etc/agent/vrctl\\.agent');
}

/** send/download 进程在 sleep 上守着 USR1；清 finish 或清空 uuid 后叫醒，避免继续用内存里的旧 uuid 报 VR3。 */
export function pokeMonitoringAgent(): boolean {
	return pokeByPattern('/rhos/etc/agent/monitoring\\.agent');
}

/** monitoring.agent 采集完成后会把 conf/conf.json 移到 conf/monitoring/<timestamp>，需回退读最新快照。 */
function resolveNetjsonConfPath(agentBase: string): string | null {
	const live = path.join(agentBase, 'conf', 'conf.json');
	if (fs.existsSync(live)) return live;

	const monitoringDir = path.join(agentBase, 'conf', 'monitoring');
	if (!fs.existsSync(monitoringDir)) return null;

	let latest: { file: string; mtime: number } | null = null;
	for (const name of fs.readdirSync(monitoringDir)) {
		if (name.startsWith('.') || name === 'response_info') continue;
		const file = path.join(monitoringDir, name);
		let st: fs.Stats;
		try {
			st = fs.statSync(file);
		} catch {
			continue;
		}
		if (!st.isFile()) continue;
		if (!latest || st.mtimeMs > latest.mtime) latest = { file, mtime: st.mtimeMs };
	}
	return latest?.file ?? null;
}

function readNetjsonSnapshot(paths: Paths): Record<string, unknown> | null {
	const confPath = resolveNetjsonConfPath(agentBaseDir(paths));
	if (!confPath) return null;
	try {
		return JSON.parse(fs.readFileSync(confPath, 'utf-8')) as Record<string, unknown>;
	} catch {
		return null;
	}
}

export async function getBgpSummary(paths: Paths): Promise<{ raw: string; neighbors: Array<Record<string, string>> }> {
	if (isForwardingMock(paths)) {
		const raw = `BGP router identifier 192.168.1.1, local AS number 65001
Neighbor        V         AS MsgRcvd MsgSent   TblVer  InQ OutQ Up/Down  State/PfxRcd
10.0.0.2        4      65002      10      12        0    0    0 00:05:00        5`;
		return { raw, neighbors: [{ neighbor: '10.0.0.2', as: '65002', state: 'Established' }] };
	}
	const res = await runClishArgv(['-c', 'do show bgp summary'], paths, { timeoutMs: 10000 });
	if (!res.ok) throw new Error(res.error);
	const neighbors: Array<Record<string, string>> = [];
	for (const line of res.output.split('\n')) {
		const t = line.trim();
		if (!t || t.startsWith('Neighbor') || t.startsWith('BGP')) continue;
		const parts = t.split(/\s+/);
		if (parts.length >= 10 && /^\d+\.\d+\.\d+\.\d+$|^[0-9a-f:]+$/i.test(parts[0]!)) {
			neighbors.push({
				neighbor: parts[0]!,
				v: parts[1] ?? '',
				as: parts[2] ?? '',
				msg_rcvd: parts[3] ?? '',
				msg_sent: parts[4] ?? '',
				up_down: parts[8] ?? '',
				state: (parts.slice(9).join(' ') || parts[8]) ?? '',
			});
		}
	}
	return { raw: res.output, neighbors };
}

export function getBgpCloudConfig(paths: Paths): unknown[] {
	const { modules } = getStructuredAgentConfig(paths);
	return modules.bgp ?? [];
}

export async function getVrfList(paths: Paths): Promise<{ vrfs: Array<{ name: string; source: string }>; raw: string }> {
	const cloud = (getStructuredAgentConfig(paths).modules.vrf ?? []).map((v) => String(v));
	const fromCloud = cloud.map((name) => ({ name, source: 'cloud' }));
	if (isForwardingMock(paths)) {
		return { vrfs: [{ name: '6666', source: 'cloud' }, { name: 'mgmt', source: 'local' }], raw: 'vrf 6666\nvrf mgmt' };
	}
	const res = await runClishStdin('do show running-config', paths);
	const localSet = new Set<string>();
	if (res.ok) {
		for (const line of res.output.split('\n')) {
			const t = line.trim();
			let m = /^vrf\s+(\S+)/i.exec(t);
			if (m) localSet.add(m[1]!);
			m = /^ip vrf forwarding\s+(\S+)/i.exec(t);
			if (m) localSet.add(m[1]!);
		}
	}
	const map = new Map<string, { name: string; source: string }>();
	for (const v of fromCloud) map.set(v.name, v);
	for (const name of localSet) {
		const prev = map.get(name);
		map.set(name, prev ? { name, source: 'both' } : { name, source: 'local' });
	}
	return { vrfs: Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name)), raw: res.ok ? res.output : '' };
}

export async function getIpv6Routes(paths: Paths) {
	const mockOut = `IPv6 Routing Table\nC  2001:db8::/64 [0/0] via ::, loop0\nS  2001:db8:1::/48 [1/0] via 2001:db8::1, eth0`;
	if (isForwardingMock(paths)) {
		return parseIpv6RouteOutput(mockOut);
	}
	const res = await runClishArgv(['-c', 'do show ipv6 route'], paths, { timeoutMs: 8000 });
	if (!res.ok) return { error: res.error, routes: [], raw_output: '' };
	return parseIpv6RouteOutput(res.output);
}

function parseIpv6RouteOutput(output: string) {
	const routes: Array<{ raw: string; protocol: string; prefix: string; next_hop: string; interface: string }> = [];
	for (const line of output.split('\n')) {
		const trimmed = line.trim();
		if (!trimmed) continue;
		if (/^IPv6|^Codes|^Gateway|^Display|^$/.test(trimmed)) continue;
		const parts = trimmed.split(/\s+/);
		if (parts.length < 2) continue;
		const protocol = parts[0]!;
		if (!/^[A-Z*][A-Z0-9*>]?$/i.test(protocol)) continue;
		const entry = {
			raw: trimmed,
			protocol,
			prefix: parts[1] ?? '',
			next_hop: '',
			interface: '',
		};
		if (parts.includes('via')) {
			const viaIdx = parts.indexOf('via');
			if (viaIdx + 1 < parts.length) entry.next_hop = parts[viaIdx + 1]!.replace(/,$/, '');
		} else if (trimmed.includes('connected')) {
			entry.next_hop = 'Connected';
		}
		if (parts.length > 0) {
			const last = parts[parts.length - 1]!.replace(/,$/, '');
			if (last.includes(':') || last.includes('/')) {
				/* prefix already set */
			} else if (!last.includes('[')) entry.interface = last;
		}
		routes.push(entry);
	}
	return { routes, raw_output: output };
}

export async function addIpv6Route(
	paths: Paths,
	body: { dst: string; gw: string; vrf_id?: string },
): Promise<Record<string, unknown>> {
	if (isForwardingMock(paths)) return { ok: true, mock: true };
	const vrf = body.vrf_id?.trim();
	// 设备 CSM route6_add 在无 vrf 时会残留 vrf_id$? 占位符，改走 clish -c（与 route_clish_config 模板一致）。
	let cmd = `ipv6 route ${body.dst} via ${body.gw}`;
	if (vrf) cmd = `ipv6 route ${body.dst} vrf ${vrf} via ${body.gw}`;
	const res = await runClishSingleCommand(cmd, paths);
	return res.ok ? { ok: true, output: res.output } : { error: res.error, output: res.output };
}

export async function deleteIpv6Route(
	paths: Paths,
	body: { dst: string; gw: string; vrf_id?: string },
): Promise<Record<string, unknown>> {
	if (isForwardingMock(paths)) return { ok: true, mock: true };
	const vrf = body.vrf_id?.trim();
	let cmd = `no ipv6 route ${body.dst} via ${body.gw}`;
	if (vrf) cmd = `no ipv6 route ${body.dst} vrf ${vrf} via ${body.gw}`;
	const res = await runClishSingleCommand(cmd, paths);
	return res.ok ? { ok: true, output: res.output } : { error: res.error, output: res.output };
}

export function getVrrpCloudConfig(paths: Paths): unknown[] {
	return getStructuredAgentConfig(paths).modules.vrrp ?? [];
}

export async function getVrrpRunning(paths: Paths): Promise<{
	/** @deprecated 兼容字段：live 巡检不再扫 running-config，恒为空 */
	groups: unknown[];
	/** @deprecated 兼容字段：完整 running-config 请走 /forwarding/running-config */
	raw: string;
	instancesRaw: string;
	groupsRaw: string;
}> {
	if (isForwardingMock(paths)) {
		return {
			groups: [],
			raw: '',
			instancesRaw:
				'VRRP Instance = 1\n  State = MASTER\n  Virtual Router ID = 1\n    12.1.1.254/24 dev GigabitEthernet0/8/0 scope global set\n',
			groupsRaw: 'VRRP Sync Group = 1, MASTER\n  Status = GOOD\n',
		};
	}
	// clish --lock + keepalived dump 不可并行：并行 instances/groups 会偶发只拿到 groups
	//（HA 巡检表现为「组在、角色/VIP 未读到」，设备 CLI 串行却正常）。
	const instancesRaw = await readVrrpShow(paths, 'instances');
	const groupsRaw = await readVrrpShow(paths, 'groups');
	return {
		groups: [],
		raw: '',
		instancesRaw,
		groupsRaw,
	};
}

const VRRP_INST_HDR = /VRRP Instance\s*=/i;
const VRRP_GRP_HDR = /VRRP Sync Group\s*=/i;

function clishText(res: { ok: boolean; output?: string; error?: string }): string {
	return res.ok ? String(res.output || '') : String(res.output || res.error || '');
}

function delay(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

async function readVrrpShow(paths: Paths, kind: 'instances' | 'groups'): Promise<string> {
	const cmd = kind === 'instances' ? 'do show vrrp instances' : 'do show vrrp groups';
	const header = kind === 'instances' ? VRRP_INST_HDR : VRRP_GRP_HDR;
	const once = () => runClishArgv(['-c', cmd], paths, { timeoutMs: 10000 });
	const first = clishText(await once());
	if (header.test(first)) return first;
	await delay(400);
	const retry = clishText(await once());
	return header.test(retry) ? retry : retry || first;
}

export async function getRoutingPolicy(paths: Paths): Promise<{
	prefix_lists: string[];
	route_maps: string[];
	raw: string;
	cloud_prefix_list: unknown[];
	cloud_route_map: unknown[];
}> {
	const { modules } = getStructuredAgentConfig(paths);
	if (isForwardingMock(paths)) {
		return {
			prefix_lists: ['pref1'],
			route_maps: ['map1'],
			raw: 'ip prefix-list pref1\nroute-map map1',
			cloud_prefix_list: modules.ip_prefix_list ?? [],
			cloud_route_map: modules.route_map ?? [],
		};
	}
	const res = await runClishStdin('do show running-config', paths);
	const prefix_lists: string[] = [];
	const route_maps: string[] = [];
	if (res.ok) {
		for (const line of res.output.split('\n')) {
			const t = line.trim();
			let m = /^ip prefix-list\s+(\S+)/i.exec(t);
			if (m) prefix_lists.push(m[1]!);
			m = /^route-map\s+(\S+)/i.exec(t);
			if (m) route_maps.push(m[1]!);
		}
	}
	return {
		prefix_lists: [...new Set(prefix_lists)].sort(),
		route_maps: [...new Set(route_maps)].sort(),
		raw: res.ok ? res.output : '',
		cloud_prefix_list: modules.ip_prefix_list ?? [],
		cloud_route_map: modules.route_map ?? [],
	};
}

export async function getSrv6Status(paths: Paths): Promise<{ raw: string; cloud: unknown[] }> {
	const cloud = getStructuredAgentConfig(paths).modules.segment_routing_srv6 ?? [];
	if (isForwardingMock(paths)) {
		return { raw: 'segment-routing srv6\n locator pe3', cloud };
	}
	const res = await runClishStdin('do show segment-routing srv6', paths);
	if (!res.ok) {
		const res2 = await runClishStdin('do show running-config | section segment-routing', paths);
		return { raw: res2.ok ? res2.output : res.error, cloud };
	}
	return { raw: res.output, cloud };
}

export function getAgentOpsStatus(paths: Paths): Record<string, unknown> {
	const agentBase = agentBaseDir(paths);
	const downloadDir = path.join(agentBase, 'download');
	const vrConfPath = path.join(agentBase, 'vr_conf');
	const registrationFinish = fs.existsSync(path.join(agentBase, '.registration_finish'));
	const out: Record<string, unknown> = {
		agent_base: agentBase,
		download_dir: downloadDir,
		registration_finish: registrationFinish,
		/** 与控制器侧 ONLINE 对齐：本机完成注册落盘后视为 ONLINE */
		registration_status: registrationFinish ? 'ONLINE' : 'OFFLINE',
		download_files: [] as string[],
		vr_conf: null as unknown,
	};
	if (fs.existsSync(downloadDir)) {
		out.download_files = fs.readdirSync(downloadDir).filter((f) => f.endsWith('.bak') || !f.startsWith('.'));
	}
	if (fs.existsSync(vrConfPath)) {
		try {
			out.vr_conf = JSON.parse(fs.readFileSync(vrConfPath, 'utf-8'));
		} catch {
			out.vr_conf = fs.readFileSync(vrConfPath, 'utf-8').slice(0, 2000);
		}
	}
	const snapshot = readNetjsonSnapshot(paths);
	if (snapshot) out.netjson_keys = Object.keys(snapshot);
	return out;
}

export function getNetjsonSnapshot(paths: Paths): Record<string, unknown> | null {
	return readNetjsonSnapshot(paths);
}
