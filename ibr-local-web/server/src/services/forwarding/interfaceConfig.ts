/**
 * 子接口 / VLAN 配置：clish 命令与 products/vrctl-agent/tools/lua/interfaces.lua 对齐。
 */
import type { Paths } from '../../vrwizard.js';
import { getStructuredAgentConfig } from './agentConfigParse.js';
import { isForwardingMock, runClishStdin, runCsmSteps } from './clishCsm.js';

export type InterfaceDetail = {
	name: string;
	vlan?: number;
	ipv4: string[];
	ipv6: string[];
	vrf?: string;
	status: 'up' | 'down' | 'unknown';
	is_subinterface: boolean;
	source?: 'local' | 'cloud' | 'both';
};

export type SubInterfaceBody = {
	name: string;
	vlan?: number;
	ipv4_static?: string;
	ipv6_static?: string;
	vrf?: string | number;
	status?: 'up' | 'down';
};

function normalizeIfName(raw: string): string {
	return raw.trim().replace(/\s+/g, ' ');
}

function parseInterfaceBlocks(output: string): InterfaceDetail[] {
	const blocks: InterfaceDetail[] = [];
	let cur: InterfaceDetail | null = null;

	const flush = () => {
		if (cur?.name) {
			cur.is_subinterface = cur.name.includes('.') || cur.vlan != null;
			blocks.push(cur);
		}
		cur = null;
	};

	for (const line of output.split('\n')) {
		const t = line.trim();
		if (!t || t === '!') {
			if (t === '!') flush();
			continue;
		}
		if (t.toLowerCase().startsWith('interface ')) {
			flush();
			const name = normalizeIfName(t.slice('interface '.length));
			cur = { name, ipv4: [], ipv6: [], status: 'unknown', is_subinterface: false };
			continue;
		}
		if (!cur) continue;

		let m = /^dot1q\s+(\d+)/i.exec(t);
		if (m) {
			cur.vlan = Number(m[1]);
			continue;
		}
		m = /^ip address\s+(\S+)/i.exec(t);
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
		if (t === 'shutdown') cur.status = 'down';
		if (t === 'no shutdown') cur.status = 'up';
	}
	flush();
	return blocks;
}

function cloudInterfaceDetails(paths: Paths): InterfaceDetail[] {
	const { modules } = getStructuredAgentConfig(paths);
	const arr = modules.interfaces ?? [];
	const out: InterfaceDetail[] = [];
	for (const item of arr) {
		if (!item || typeof item !== 'object') continue;
		const o = item as Record<string, unknown>;
		const name = normalizeIfName(String(o.name ?? ''));
		if (!name) continue;
		out.push({
			name,
			vlan: o.vlan != null ? Number(o.vlan) : undefined,
			ipv4: o.ipv4_static ? [String(o.ipv4_static)] : [],
			ipv6: o.ipv6_static ? [String(o.ipv6_static)] : [],
			vrf: o.vrf != null ? String(o.vrf) : undefined,
			status: String(o.status ?? 'unknown') === 'up' ? 'up' : String(o.status) === 'down' ? 'down' : 'unknown',
			is_subinterface: name.includes('.') || o.vlan != null,
			source: 'cloud',
		});
	}
	return out;
}

function mergeInterfaces(local: InterfaceDetail[], cloud: InterfaceDetail[]): InterfaceDetail[] {
	const map = new Map<string, InterfaceDetail>();
	for (const c of cloud) map.set(c.name, c);
	for (const l of local) {
		const prev = map.get(l.name);
		if (prev) map.set(l.name, { ...prev, ...l, source: 'both' });
		else map.set(l.name, { ...l, source: 'local' });
	}
	return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
}

export async function listInterfaceDetails(paths: Paths): Promise<{ interfaces: InterfaceDetail[] }> {
	if (isForwardingMock(paths)) {
		return {
			interfaces: [
				{
					name: 'GigabitEthernet 0/3/1.100',
					vlan: 100,
					ipv4: ['8.8.8.8/24'],
					ipv6: [],
					status: 'up',
					is_subinterface: true,
					source: 'local',
				},
			],
		};
	}
	const res = await runClishStdin('do show running-config', paths);
	const local = res.ok ? parseInterfaceBlocks(res.output) : [];
	const cloud = cloudInterfaceDetails(paths);
	return { interfaces: mergeInterfaces(local, cloud) };
}

export function buildSubInterfaceApplyCommands(body: SubInterfaceBody): string {
	const name = normalizeIfName(body.name);
	if (!name) throw new Error('接口名必填');
	const lines: string[] = [`interface ${name}`];
	if (body.vlan != null && Number.isFinite(Number(body.vlan))) {
		lines.push(`dot1q ${Number(body.vlan)}`);
	}
	if (body.vrf != null && String(body.vrf).trim()) {
		lines.push(`vrf ${body.vrf}`);
		lines.push('vrf enable');
	}
	if (body.ipv4_static?.trim()) lines.push(`ip address ${body.ipv4_static.trim()}`);
	if (body.ipv6_static?.trim()) lines.push(`ipv6 address ${body.ipv6_static.trim()}`);
	if (body.status === 'down') lines.push('shutdown');
	else if (body.status === 'up') lines.push('no shutdown');
	lines.push('do save');
	return `${lines.join('\n')}\n`;
}

export function buildSubInterfaceDeleteCommands(name: string): string {
	const n = normalizeIfName(name);
	if (!n) throw new Error('接口名必填');
	return `no interface ${n}\ndo save\n`;
}

function splitIfTypeName(name: string): { interface: string; if_type: string; if_name: string } {
	const n = normalizeIfName(name);
	const m = /^([A-Za-z]+)\s+(.+)$/.exec(n);
	if (!m) throw new Error(`无法解析接口名: ${n}`);
	return { interface: n, if_type: m[1]!, if_name: m[2]! };
}

function buildSubInterfaceCsmSteps(body: SubInterfaceBody): Array<{ opt: string; args: Record<string, unknown> }> {
	const { interface: ifName, if_type, if_name } = splitIfTypeName(body.name);
	const steps: Array<{ opt: string; args: Record<string, unknown> }> = [
		{ opt: 'if_create', args: { if_type, if_name } },
	];
	if (body.vlan != null && Number.isFinite(Number(body.vlan))) {
		steps.push({ opt: 'if_dot1q_add', args: { interface: ifName, vid: String(Number(body.vlan)) } });
	}
	if (body.vrf != null && String(body.vrf).trim()) {
		steps.push(
			{ opt: 'if_move_to_vrf', args: { interface: ifName, vrf_id: String(body.vrf).trim() } },
			{ opt: 'if_vrf_enable', args: { interface: ifName } },
		);
	}
	if (body.ipv4_static?.trim()) {
		steps.push({ opt: 'if_ip_add', args: { interface: ifName, addr: body.ipv4_static.trim() } });
	}
	if (body.ipv6_static?.trim()) {
		steps.push({ opt: 'if_ip6_add', args: { interface: ifName, addr: body.ipv6_static.trim() } });
	}
	if (body.status === 'down') steps.push({ opt: 'if_down', args: { interface: ifName } });
	else if (body.status === 'up') steps.push({ opt: 'if_up', args: { interface: ifName } });
	return steps;
}

export async function applySubInterface(paths: Paths, body: SubInterfaceBody): Promise<Record<string, unknown>> {
	if (isForwardingMock(paths)) {
		return { ok: true, mock: true, commands: buildSubInterfaceApplyCommands(body) };
	}
	try {
		const steps = buildSubInterfaceCsmSteps(body);
		const res = await runCsmSteps(steps, paths);
		return res.ok ? { ok: true, output: res.output } : { error: res.error, output: res.output };
	} catch (e) {
		return { error: e instanceof Error ? e.message : String(e) };
	}
}

export async function deleteSubInterface(paths: Paths, name: string): Promise<Record<string, unknown>> {
	if (isForwardingMock(paths)) return { ok: true, mock: true };
	try {
		const { if_type, if_name } = splitIfTypeName(name);
		const res = await runCsmSteps([{ opt: 'if_delete', args: { if_type, if_name } }], paths);
		return res.ok ? { ok: true, output: res.output } : { error: res.error, output: res.output };
	} catch (e) {
		return { error: e instanceof Error ? e.message : String(e) };
	}
}
