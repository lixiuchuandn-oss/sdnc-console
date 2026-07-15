/**
 * 只读/扩展转发能力：BGP、VRF、IPv6 路由、VRRP、路由策略、SRv6、Agent 状态。
 */
import fs from 'node:fs';
import path from 'node:path';
import type { Paths } from '../../vrwizard.js';
import { getStructuredAgentConfig } from './agentConfigParse.js';
import { isForwardingMock, runClishSingleCommand, runClishStdin, runClishArgv } from './clishCsm.js';

function agentBaseDir(paths: Paths): string {
	return paths.base ? path.join(paths.base, 'rhos', 'etc', 'agent') : '/rhos/etc/agent';
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

/** 单条 BGP summary 邻居行（含所属 VRF / 地址族段） */
export type BgpNeighborRow = {
	id: string;
	neighbor: string;
	v: string;
	as: string;
	msg_rcvd: string;
	msg_sent: string;
	tbl_ver: string;
	in_q: string;
	out_q: string;
	up_down: string;
	/** 非 Established 时为 Idle/Active 等；已建立时常为 Established */
	state: string;
	pfx_rcd: string;
	pfx_snt: string;
	desc: string;
	vrf: string;
	afi: string;
	section: string;
};

const NEIGHBOR_ADDR_RE = /^(?:\d{1,3}(?:\.\d{1,3}){3}|[0-9a-f:]+)$/i;
const SECTION_RE =
	/^(IPv[46]\s+(?:Unicast|VPN|Multicast|Labeled-Unicast)\s+Summary)\s+\(VRF\s+([^)]+)\):\s*$/i;

/**
 * 解析 FRR/clish `show bgp summary` 多段输出。
 * 段标题例：`IPv4 Unicast Summary (VRF vrf7777):` / `IPv4 VPN Summary (VRF default):`
 */
export function parseBgpSummaryNeighbors(raw: string): BgpNeighborRow[] {
	const neighbors: BgpNeighborRow[] = [];
	let vrf = 'default';
	let afi = 'ipv4-unicast';
	let section = 'IPv4 Unicast Summary (VRF default)';

	for (const line of raw.split(/\r?\n/)) {
		const t = line.trim();
		if (!t) continue;

		const sec = SECTION_RE.exec(t);
		if (sec) {
			const title = sec[1]!.replace(/\s+/g, ' ');
			vrf = (sec[2] || 'default').trim();
			const lower = title.toLowerCase();
			if (lower.includes('vpn')) afi = lower.startsWith('ipv6') ? 'ipv6-vpn' : 'ipv4-vpn';
			else if (lower.includes('multicast')) afi = lower.startsWith('ipv6') ? 'ipv6-multicast' : 'ipv4-multicast';
			else if (lower.includes('labeled')) afi = lower.startsWith('ipv6') ? 'ipv6-labeled' : 'ipv4-labeled';
			else afi = lower.startsWith('ipv6') ? 'ipv6-unicast' : 'ipv4-unicast';
			section = `${title} (VRF ${vrf})`;
			continue;
		}

		if (/^Neighbor\b/i.test(t) || /^BGP\b/i.test(t) || /^Total number of neighbors/i.test(t)) continue;
		if (/^RIB entries\b/i.test(t) || /^Peers\b/i.test(t) || /^BGP table version\b/i.test(t)) continue;

		const parts = t.split(/\s+/);
		if (parts.length < 10 || !NEIGHBOR_ADDR_RE.test(parts[0]!)) continue;

		const neighbor = parts[0]!;
		const col9 = parts[9] ?? '';
		const numericPfx = /^\d+$/.test(col9);
		const state = numericPfx ? 'Established' : col9;
		const pfx_rcd = numericPfx ? col9 : '';
		const pfx_snt = numericPfx ? (parts[10] ?? '') : (parts[10] ?? '');
		const desc = numericPfx ? (parts[11] ?? '') : (parts.slice(11).join(' ') || parts[11] || '');

		neighbors.push({
			id: `${vrf}|${afi}|${neighbor}`,
			neighbor,
			v: parts[1] ?? '',
			as: parts[2] ?? '',
			msg_rcvd: parts[3] ?? '',
			msg_sent: parts[4] ?? '',
			tbl_ver: parts[5] ?? '',
			in_q: parts[6] ?? '',
			out_q: parts[7] ?? '',
			up_down: parts[8] ?? '',
			state,
			pfx_rcd,
			pfx_snt,
			desc,
			vrf,
			afi,
			section,
		});
	}
	return neighbors;
}

const BGP_SUMMARY_MOCK_RAW = `IPv4 Unicast Summary (VRF vrf7777):
BGP router identifier 102.1.1.33, local AS number 106 vrf-id 25
BGP table version 40
RIB entries 7, using 672 bytes of memory
Peers 1, using 20 KiB of memory

Neighbor        V         AS   MsgRcvd   MsgSent   TblVer  InQ OutQ  Up/Down State/PfxRcd   PfxSnt Desc
102.1.1.22      4        103      4370      4370       40    0    0 3d00h27m            2        4 N/A

Total number of neighbors 1

IPv4 Unicast Summary (VRF default):
BGP router identifier 203.100.100.33, local AS number 430 vrf-id 0
BGP table version 0
RIB entries 0, using 0 bytes of memory
Peers 1, using 20 KiB of memory

Neighbor        V         AS   MsgRcvd   MsgSent   TblVer  InQ OutQ  Up/Down State/PfxRcd   PfxSnt Desc
203::22         4        429      3653      3672        0    0    0 04:33:21            0        0 N/A

Total number of neighbors 1

IPv4 VPN Summary (VRF default):
BGP router identifier 203.100.100.33, local AS number 430 vrf-id 0
BGP table version 0
RIB entries 7, using 672 bytes of memory
Peers 1, using 20 KiB of memory

Neighbor        V         AS   MsgRcvd   MsgSent   TblVer  InQ OutQ  Up/Down State/PfxRcd   PfxSnt Desc
203::22         4        429      3653      3672       38    0    0 04:33:21            6        8 N/A

Total number of neighbors 1
`;

export async function getBgpSummary(paths: Paths): Promise<{ raw: string; neighbors: BgpNeighborRow[] }> {
	if (isForwardingMock(paths)) {
		return { raw: BGP_SUMMARY_MOCK_RAW, neighbors: parseBgpSummaryNeighbors(BGP_SUMMARY_MOCK_RAW) };
	}
	const res = await runClishArgv(['-c', 'do show bgp summary'], paths, { timeoutMs: 10000 });
	if (!res.ok) throw new Error(res.error);
	return { raw: res.output, neighbors: parseBgpSummaryNeighbors(res.output) };
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

export async function getVrrpRunning(paths: Paths): Promise<{ groups: unknown[]; raw: string }> {
	if (isForwardingMock(paths)) {
		return { groups: [{ group_id: 1, track_gateway: ['2.2.2.2'], vrrp_instance: [2] }], raw: 'vrrp 1' };
	}
	const res = await runClishStdin('do show running-config', paths);
	const groups: Array<{ line: string }> = [];
	if (res.ok) {
		for (const line of res.output.split('\n')) {
			const t = line.trim();
			if (/^vrrp\s+/i.test(t) || /^track\s+gateway/i.test(t)) groups.push({ line: t });
		}
	}
	return { groups, raw: res.ok ? res.output : '' };
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
	const out: Record<string, unknown> = {
		agent_base: agentBase,
		download_dir: downloadDir,
		registration_finish: fs.existsSync(path.join(agentBase, '.registration_finish')),
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
