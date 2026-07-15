import type { Paths } from '../../vrwizard.js';
import { detectWanVppIfname } from './wanDetect.js';
import { csmIfnameForScript, isForwardingMock, runClishStdin, runCsmScript, type ClishResult } from './clishCsm.js';

const DEFAULT_GROUP_ID = 6;

async function runShowRunning(paths: Paths): Promise<ClishResult> {
	return runClishStdin('do show running-config', paths);
}

function natGroupExistsFromRc(output: string, groupId: number): boolean {
	const needle = `nat address group ${groupId}`;
	for (const raw of output.split('\n')) {
		const line = raw.trim().toLowerCase();
		const norm = line.replace(/^ip\s+/, '');
		if (norm.includes(needle)) return true;
	}
	return false;
}

function natOutsideOnIfFromRc(output: string, groupId: number): boolean {
	const needleGroup = `address-group ${groupId}`;
	for (const raw of output.split('\n')) {
		const line = raw.trim().toLowerCase();
		if (line.includes('outside') && line.includes(needleGroup)) return true;
	}
	return false;
}

export async function natGlobalFromDevice(paths: Paths): Promise<{
	group_id: number;
	wan_if: string;
	group_exists: boolean;
	enabled: boolean;
	use_wan_ip_as_pool: boolean;
}> {
	if (isForwardingMock(paths)) {
		return {
			group_id: DEFAULT_GROUP_ID,
			wan_if: '',
			group_exists: false,
			enabled: false,
			use_wan_ip_as_pool: true,
		};
	}
	const res = await runShowRunning(paths);
	if (!res.ok) {
		return {
			group_id: DEFAULT_GROUP_ID,
			wan_if: detectWanVppIfname(paths),
			group_exists: false,
			enabled: false,
			use_wan_ip_as_pool: true,
		};
	}
	const output = res.output;
	let currentIf = '';
	let groupId = DEFAULT_GROUP_ID;
	let wanIf = '';
	for (const raw of output.split('\n')) {
		const line = raw.trim();
		const lower = line.toLowerCase();
		if (lower.startsWith('interface ')) {
			const parts = line.split(/\s+/);
			currentIf = parts.length >= 2 ? parts.slice(1).join(' ') : '';
		}
		if (lower.includes('nat address group ')) {
			const parts = lower.split(/\s+/);
			for (let i = 0; i < parts.length; i++) {
				if (parts[i] === 'group' && i + 1 < parts.length && /^\d+$/.test(parts[i + 1]!)) {
					groupId = Number.parseInt(parts[i + 1]!, 10);
					break;
				}
			}
		}
		if (lower.includes('outside') && lower.includes('address-group')) {
			wanIf = currentIf;
			const parts = lower.split(/\s+/);
			for (let i = 0; i < parts.length; i++) {
				if (parts[i] === 'address-group' && i + 1 < parts.length && /^\d+$/.test(parts[i + 1]!)) {
					groupId = Number.parseInt(parts[i + 1]!, 10);
					break;
				}
			}
		}
	}
	if (!wanIf) wanIf = detectWanVppIfname(paths);
	const groupExists = natGroupExistsFromRc(output, groupId);
	const outsideOnIf = natOutsideOnIfFromRc(output, groupId);
	const enabled = groupExists && outsideOnIf;
	return {
		group_id: groupId,
		wan_if: wanIf,
		group_exists: groupExists,
		enabled,
		use_wan_ip_as_pool: true,
	};
}

export async function getNatStatus(paths: Paths) {
	const g = await natGlobalFromDevice(paths);
	return {
		global: {
			enabled: g.enabled,
			wan_if: g.wan_if,
			group_id: g.group_id,
			use_wan_ip_as_pool: g.use_wan_ip_as_pool,
			group_exists: g.group_exists,
		},
	};
}

export async function enableNat(
	paths: Paths,
	body: { wan_if?: string; use_wan_ip_as_pool?: boolean },
): Promise<Record<string, unknown>> {
	const groupId = DEFAULT_GROUP_ID;
	let wanIf = (body.wan_if ?? '').trim();
	if (!wanIf || /未绑定|检测中/.test(wanIf) || wanIf.includes('(') || wanIf.includes(')')) {
		wanIf = detectWanVppIfname(paths);
	}
	if (!wanIf) {
		return {
			error: '未检测到有效的 WAN 口，请先在「网络配置/重置网卡」中完成 WAN/LAN 识别后再启用 NAT。',
		};
	}
	const useWanIp = body.use_wan_ip_as_pool !== false;

	if (isForwardingMock(paths)) {
		return { ok: true, mock: true, global: await natGlobalFromDevice(paths) };
	}

	const resCreate = await runCsmScript({ opt: 'nat_create_group', args: { group_id: String(groupId) } }, paths);
	if (!resCreate.ok) return { error: resCreate.error };

	const csmIf = csmIfnameForScript(wanIf);
	let resIf: Awaited<ReturnType<typeof runCsmScript>> | null = null;
	if (useWanIp) {
		resIf = await runCsmScript(
			{ opt: 'nat_group_address_config_by_if', args: { interface: csmIf, group_id: String(groupId) } },
			paths,
		);
		if (!resIf.ok) return { error: resIf.error };
	}

	const resEnable = await runCsmScript(
		{ opt: 'nat_interface_enable', args: { interface: csmIf, group_id: String(groupId) } },
		paths,
	);
	if (!resEnable.ok) return { error: resEnable.error };

	return {
		ok: true,
		global: await natGlobalFromDevice(paths),
		details: {
			create_group: resCreate,
			config_if_pool: useWanIp ? resIf : null,
			enable_interface: resEnable,
		},
	};
}

export async function disableNat(paths: Paths): Promise<Record<string, unknown>> {
	const g = await natGlobalFromDevice(paths);
	const wanIf = (g.wan_if ?? '').trim();
	const groupId = g.group_id;

	if (isForwardingMock(paths)) {
		return { ok: true, mock: true, global: g };
	}

	if (!wanIf) {
		return { ok: true, message: '设备上未发现已启用 NAT 的接口', global: g };
	}

	const csmIf = csmIfnameForScript(wanIf);
	const resDisable = await runCsmScript(
		{ opt: 'nat_no_interface_enable', args: { interface: csmIf, group_id: String(groupId) } },
		paths,
	);
	if (!resDisable.ok) return { error: resDisable.error };

	const resUnconfig = await runCsmScript(
		{ opt: 'nat_no_group_address_config_by_if', args: { interface: csmIf, group_id: String(groupId) } },
		paths,
	);

	return {
		ok: true,
		global: await natGlobalFromDevice(paths),
		details: { disable_interface: resDisable, unconfig_if_pool: resUnconfig },
	};
}

export async function toggleNatUseWanIp(paths: Paths, enabled: boolean): Promise<Record<string, unknown>> {
	const g = await natGlobalFromDevice(paths);
	const groupId = g.group_id;
	const wanIf = (g.wan_if ?? '').trim() || detectWanVppIfname(paths);

	if (isForwardingMock(paths)) {
		return { ok: true, mock: true, global: g };
	}
	if (!g.enabled) {
		return { error: '请先启用 NAT，再配置是否使用 WAN 口 IP 作为 SNAT 地址。' };
	}
	if (!g.group_exists) {
		return { error: `地址池 group ${groupId} 在设备配置中不存在，请先启用 NAT。` };
	}
	if (!wanIf) {
		return { error: '未检测到有效的 WAN 口，请先在「网络配置/重置网卡」中完成 WAN/LAN 识别后再重试。' };
	}

	const opt = enabled ? 'nat_group_address_config_by_if' : 'nat_no_group_address_config_by_if';
	const res = await runCsmScript({ opt, args: { interface: csmIfnameForScript(wanIf), group_id: String(groupId) } }, paths);
	if (!res.ok) return { error: res.error };
	return { ok: true, global: await natGlobalFromDevice(paths), output: res.output };
}

export type NatEntry = {
	id: string;
	type: string;
	proto: string;
	inside_ip: string;
	inside_port: number | null;
	outside_ip: string;
	outside_port: number | null;
	vrf_id: string;
	range_start: string;
	range_end: string;
};

export async function getNatEntries(paths: Paths): Promise<{ entries?: NatEntry[]; error?: string }> {
	const groupId = (await natGlobalFromDevice(paths)).group_id;
	if (isForwardingMock(paths)) {
		return { entries: [] };
	}
	const res = await runShowRunning(paths);
	if (!res.ok) return { error: res.error, entries: [] };
	const output = res.output;
	const entries: NatEntry[] = [];
	let nextId = 1;

	let inGroup = false;
	for (const raw of output.split('\n')) {
		const line = raw.trim();
		if (!line) continue;
		const lower = line.toLowerCase();
		if (lower.startsWith('nat address group ')) {
			const parts = lower.split(/\s+/);
			const gid = Number.parseInt(parts[parts.length - 1] ?? '-1', 10);
			inGroup = gid === groupId;
			continue;
		}
		if (inGroup) {
			if (lower.startsWith('range ')) {
				const parts = line.split(/\s+/);
				if (parts.length >= 3) {
					const start = parts[1]!;
					const end = parts[2]!;
					entries.push({
						id: String(nextId++),
						type: 'SNAT',
						proto: 'ip',
						inside_ip: '',
						inside_port: null,
						outside_ip: '',
						outside_port: null,
						vrf_id: '',
						range_start: start,
						range_end: end,
					});
				}
				continue;
			}
			if (lower.startsWith('!') || lower.startsWith('interface ')) inGroup = false;
		}
	}

	for (const raw of output.split('\n')) {
		const line = raw.trim();
		if (!line) continue;
		const lower = line.toLowerCase();
		if (!lower.startsWith('nat address static')) continue;
		const parts = line.split(/\s+/);
		if (parts.length < 5) continue;
		let proto = '';
		let idx = 3;
		if (parts[3]!.toLowerCase() === 'proto') {
			proto = (parts[4] ?? '').toLowerCase();
			idx = 5;
		}
		if (idx >= parts.length || parts[idx]!.toLowerCase() !== 'inside') continue;
		let i = idx + 1;
		if (i >= parts.length) continue;
		const insideIp = parts[i]!;
		i += 1;
		let insidePort: number | null = null;
		if (i < parts.length && /^\d+$/.test(parts[i]!)) {
			insidePort = Number.parseInt(parts[i]!, 10);
			i += 1;
		}
		let vrfId = '';
		if (i < parts.length && parts[i]!.toLowerCase() === 'vrf') {
			if (i + 1 < parts.length) vrfId = parts[i + 1]!;
			i += 2;
		}
		if (i >= parts.length || parts[i]!.toLowerCase() !== 'outside') continue;
		i += 1;
		if (i >= parts.length) continue;
		const outsideIp = parts[i]!;
		i += 1;
		let outsidePort: number | null = null;
		if (i < parts.length && /^\d+$/.test(parts[i]!)) {
			outsidePort = Number.parseInt(parts[i]!, 10);
		}
		const etype = insidePort === null && outsidePort === null ? 'STATIC' : 'DNAT';
		entries.push({
			id: String(nextId++),
			type: etype,
			proto: proto || (etype === 'STATIC' ? 'ip' : 'tcp'),
			inside_ip: insideIp,
			inside_port: insidePort,
			outside_ip: outsideIp,
			outside_port: outsidePort,
			vrf_id: vrfId,
			range_start: '',
			range_end: '',
		});
	}

	const ipToSnatIdx = new Map<string, number>();
	for (let idx = 0; idx < entries.length; idx++) {
		const e = entries[idx]!;
		if ((e.type || '').toUpperCase() === 'SNAT') {
			const rs = e.range_start ?? '';
			const re = e.range_end ?? '';
			if (rs && rs === re) ipToSnatIdx.set(rs, idx);
		}
	}
	const merged = new Set<number>();
	for (const e of entries) {
		if ((e.type || '').toUpperCase() === 'DNAT') {
			const outIp = e.outside_ip ?? '';
			const snIdx = ipToSnatIdx.get(outIp);
			if (snIdx !== undefined && !merged.has(snIdx)) {
				const sn = entries[snIdx]!;
				e.range_start = sn.range_start ?? '';
				e.range_end = sn.range_end ?? '';
				merged.add(snIdx);
			}
		}
	}
	const filtered = entries.filter((_, idx) => !merged.has(idx));
	return { entries: filtered };
}

async function natApplySingleEntry(paths: Paths, entry: NatEntry, isDelete: boolean): Promise<{ ok?: boolean; error?: string; output?: string }> {
	const g = await natGlobalFromDevice(paths);
	const groupId = Number(g.group_id || DEFAULT_GROUP_ID);

	if (isForwardingMock(paths)) {
		return { ok: true };
	}

	const etype = (entry.type || '').toUpperCase();

	if (etype === 'SNAT') {
		const start = entry.range_start ?? '';
		const end = entry.range_end ?? '';
		if (!start || !end) return { error: 'SNAT 条目缺少地址范围' };
		if (isDelete) {
			const r = await runCsmScript(
				{
					opt: 'nat_no_group_address_config',
					args: { group_id: String(groupId), 'ip4-range-start': start, 'ip4-range-end': end },
				},
				paths,
			);
			return r.ok ? { ok: true, output: r.output } : { error: r.error, output: r.output };
		}
		const r2 = await runCsmScript(
			{
				opt: 'nat_group_address_config',
				args: {
					group_id: String(groupId),
					'ip4-range-start': start,
					'ip4-range-end': end,
					'tenant-vrf': '',
					'twice-nat': '',
				},
			},
			paths,
		);
		return r2.ok ? { ok: true, output: r2.output } : { error: r2.error, output: r2.output };
	}

	const insideIp = entry.inside_ip ?? '';
	const outsideIp = entry.outside_ip ?? '';
	if (!insideIp || !outsideIp) return { error: '静态 NAT 条目缺少 inside/outside 地址' };

	const vrfId = (entry.vrf_id ?? '').trim();
	let proto = (entry.proto || 'ip').toLowerCase();
	let inPort = entry.inside_port != null ? String(entry.inside_port) : '';
	let outPort = entry.outside_port != null ? String(entry.outside_port) : '';

	if (etype === 'DNAT' && !isDelete && outsideIp) {
		const pre = await runCsmScript(
			{
				opt: 'nat_group_address_config',
				args: {
					group_id: String(groupId),
					'ip4-range-start': outsideIp,
					'ip4-range-end': outsideIp,
					'tenant-vrf': '',
					'twice-nat': '',
				},
			},
			paths,
		);
		if (!pre.ok) return { error: pre.error, output: pre.output };
	}

	if (etype === 'STATIC') {
		proto = '';
		inPort = '';
		outPort = '';
	}

	const optName = isDelete ? 'nat_no_static_mapping_config' : 'nat_static_mapping_config';
	const r3 = await runCsmScript(
		{
			opt: optName,
			args: {
				group_id: String(groupId),
				proto,
				inside: { in_ip: insideIp, in_port: inPort },
				outside: { out_ip: outsideIp, out_port: outPort },
				vrf: vrfId,
				'twice-nat': '',
			},
		},
		paths,
	);
	return r3.ok ? { ok: true, output: r3.output } : { error: r3.error, output: r3.output };
}

export type NatEntryCreateBody = {
	type: string;
	proto?: string;
	inside_ip?: string;
	inside_port?: number;
	outside_ip?: string;
	outside_port?: number;
	vrf_id?: string;
	range_start?: string;
	range_end?: string;
};

export async function createNatEntry(paths: Paths, body: NatEntryCreateBody): Promise<Record<string, unknown>> {
	const etype = (body.type || '').toUpperCase();
	if (!['SNAT', 'STATIC', 'DNAT'].includes(etype)) {
		return { error: 'type 必须为 SNAT / STATIC / DNAT' };
	}
	const view = await getNatEntries(paths);
	if (view.error) return { error: view.error };
	const list = view.entries ?? [];
	let nextId = 1;
	for (const e of list) {
		const n = Number.parseInt(String(e.id), 10);
		if (!Number.isNaN(n)) nextId = Math.max(nextId, n + 1);
	}
	const entry: NatEntry = {
		id: String(nextId),
		type: etype,
		proto: (body.proto || 'ip').toLowerCase(),
		inside_ip: body.inside_ip ?? '',
		inside_port: body.inside_port ?? null,
		outside_ip: body.outside_ip ?? '',
		outside_port: body.outside_port ?? null,
		vrf_id: body.vrf_id ?? '',
		range_start: body.range_start ?? '',
		range_end: body.range_end ?? '',
	};
	if (etype === 'SNAT') {
		if (!entry.range_start || !entry.range_end) return { error: 'SNAT 类型必须提供 range_start / range_end' };
	} else if (etype === 'STATIC') {
		if (!entry.inside_ip || !entry.outside_ip) return { error: 'STATIC 类型必须提供 inside_ip / outside_ip' };
	} else if (etype === 'DNAT') {
		if (!entry.inside_ip || !entry.outside_ip) return { error: 'DNAT 类型必须提供 inside_ip / outside_ip' };
		if (!entry.inside_port || !entry.outside_port) return { error: 'DNAT 类型必须提供 inside_port / outside_port' };
	}
	const res = await natApplySingleEntry(paths, entry, false);
	if (res.error) return { error: res.error, entry, output: res.output };
	return { ok: true, entry, output: res.output };
}

export async function deleteNatEntry(paths: Paths, entryId: string): Promise<Record<string, unknown>> {
	const view = await getNatEntries(paths);
	if (view.error) return { error: view.error };
	const target = (view.entries ?? []).find((e) => String(e.id) === String(entryId));
	if (!target) return { error: `未找到 ID=${entryId} 的 NAT 条目` };

	const res = await natApplySingleEntry(paths, target, true);
	if (res.error) return { error: res.error, output: res.output };

	const etype = (target.type || '').toUpperCase();
	if (etype === 'DNAT') {
		const outsideIp = target.outside_ip ?? '';
		if (outsideIp) {
			await natApplySingleEntry(
				paths,
				{ id: '', type: 'SNAT', proto: 'ip', inside_ip: '', inside_port: null, outside_ip: '', outside_port: null, vrf_id: '', range_start: outsideIp, range_end: outsideIp },
				true,
			);
		}
	}
	return { ok: true, deleted_id: entryId, output: res.output };
}
