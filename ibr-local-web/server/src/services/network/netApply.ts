/**
 * 网卡快照同步与 WAN/LAN/辅助 LAN 配置应用（clish，与 agent Lua 一致）。
 * 业务域：网络 / 网卡配置应用（与 `services/forwarding` 转发域分离）。
 */
import { isCidr, isIpv4, isIpv6Cidr, pciToVbrasIfname, splitIpFamilyFields } from '../../routes/api/helpers.js';
import type { Paths } from '../../vrwizard.js';
import {
	buildNicRolesSnapshot,
	computeNicsInitialized,
	getPaths,
	listAvailablePciNics,
	listPciNicsDetailed,
	loadState,
	nicRolesSnapshotNeedsRefresh,
	normalizeInitMode,
	normalizeVppCliIfname,
	readNicRolesConf,
	saveState,
	writeNicRolesConf,
	type JsonObject,
} from '../../vrwizard.js';
import {
	applyDefaultRouteVia,
	applyPhysicalInterfaceIpv4,
	applyPhysicalInterfaceIpv6,
	clearPhysicalInterfaceAddresses,
} from './interfaceClishApply.js';
import { ensureMgmtPciInState, readNicIdentity, resolveExtraAttachPcis } from './nicIdentity.js';

export type { Paths };

/** 与 apply / 快照同步一致：优先 state.os_nic_attach_pci，否则 nic_roles 中 attached 行。 */
export function resolveOsNicAttachPci(state: JsonObject, rolesConf: JsonObject | null): string[] {
	let attachPci = Array.isArray(state.os_nic_attach_pci)
		? (state.os_nic_attach_pci as unknown[])
				.map((x) => (typeof x === 'string' ? x.trim() : ''))
				.filter(Boolean)
		: [];
	if (attachPci.length === 0 && rolesConf && typeof rolesConf === 'object') {
		const arr = Array.isArray((rolesConf as { roles?: unknown }).roles) ? ((rolesConf as { roles?: unknown[] }).roles ?? []) : [];
		const fromRows = arr
			.filter((row) => row && typeof row === 'object' && (row as { attached?: boolean }).attached === true && typeof (row as { pci?: unknown }).pci === 'string')
			.map((row) => String((row as { pci: string }).pci).trim())
			.filter(Boolean);
		attachPci = Array.from(new Set(fromRows));
	}
	return attachPci;
}

let syncNicRolesSnapshotInFlight: Promise<void> | null = null;

/** 并发请求共用同一次快照同步，避免重复打 vbras CLI。 */
export async function syncNicRolesSnapshotDeduped(paths: Paths, logs: string[], existingOverride?: Record<string, unknown> | null): Promise<void> {
	if (syncNicRolesSnapshotInFlight) {
		await syncNicRolesSnapshotInFlight;
		return;
	}
	syncNicRolesSnapshotInFlight = syncNicRolesSnapshot(paths, logs, existingOverride).finally(() => {
		syncNicRolesSnapshotInFlight = null;
	});
	await syncNicRolesSnapshotInFlight;
}

/**
 * `/status`、配置页读取前：若快照过期则同步并返回最新 nic_roles。
 * @returns synced 表示本次是否执行了落盘同步
 */
export async function ensureNicRolesSnapshotFresh(
	paths: Paths,
	opts: {
		pcis: string[];
		attachPci: string[];
		vbrasIfTele?: Map<string, { state: string; ip: string }> | null;
		force?: boolean;
	},
): Promise<{ synced: boolean; rolesConf: JsonObject | null }> {
	let rolesConf = readNicRolesConf(paths);
	const needs =
		Boolean(opts.force) ||
		nicRolesSnapshotNeedsRefresh(rolesConf, {
			pcis: opts.pcis,
			attachPci: opts.attachPci,
			vbrasIfTele: opts.vbrasIfTele,
		});
	if (!needs) return { synced: false, rolesConf };

	const logs: string[] = [];
	await syncNicRolesSnapshotDeduped(paths, logs);
	rolesConf = readNicRolesConf(paths);
	return { synced: true, rolesConf };
}

/**
 * 用 `buildNicRolesSnapshot` 重写 nic_roles.conf（含 OS sysfs + vbras CLI 合并后的完整 os/vbras 维度）。
 * @param existingOverride 若刚在内存里改过 roles（如 apply IP），传入同一对象可避免先写「残缺 JSON」再读盘导致丢字段。
 */
export async function syncNicRolesSnapshot(paths: Paths, logs: string[], existingOverride?: Record<string, unknown> | null): Promise<void> {
	try {
		const state = loadState(paths);
		const initMode = normalizeInitMode(state.init_mode);
		const rolesFromDisk = readNicRolesConf(paths);
		const rolesConf =
			existingOverride != null && typeof existingOverride === 'object' && !Array.isArray(existingOverride)
				? existingOverride
				: rolesFromDisk;

		const pciNicsDetailed = listPciNicsDetailed({ rolesConf: rolesConf ?? rolesFromDisk });
		const pcis = pciNicsDetailed.length > 0 ? pciNicsDetailed.map((x) => x.pci) : listAvailablePciNics({ rolesConf: rolesConf ?? rolesFromDisk });
		if (pcis.length === 0) {
			logs.push('网卡快照未执行：未发现 PCI 网卡');
			return;
		}

		const stateRec = state as Record<string, unknown>;
		const { filled: mgmtFilled } = ensureMgmtPciInState(stateRec, pciNicsDetailed);
		if (mgmtFilled) saveState(paths, stateRec);

		const attachPci = resolveOsNicAttachPci(stateRec as JsonObject, rolesConf ?? rolesFromDisk);
		const identity = readNicIdentity(stateRec);
		const existingForBuild =
			rolesConf && typeof rolesConf === 'object' && !Array.isArray(rolesConf) ? rolesConf : ({ roles: [] } as JsonObject);

		const snapshot = await buildNicRolesSnapshot({
			mode: initMode,
			pcis,
			attachPci,
			identity,
			existing: existingForBuild,
			pciDetails: pciNicsDetailed.length > 0 ? pciNicsDetailed : null,
			paths,
		});
		writeNicRolesConf(paths, snapshot as JsonObject);
		logs.push('已同步网卡快照（nic_roles.conf，含 vbras 实时接口地址；role 按 state 身份投影）');
	} catch (e) {
		logs.push(`网卡快照同步失败：${e instanceof Error ? e.message : String(e)}`);
	}
}

function vbrasFamilyCidrs(vbras: Record<string, unknown> | null | undefined, family: 'v4' | 'v6'): string {
	const ip = typeof vbras?.ip === 'string' ? vbras.ip : '';
	const ipv6 = typeof vbras?.ipv6 === 'string' ? vbras.ipv6 : '';
	const a = splitIpFamilyFields(ip);
	const b = splitIpFamilyFields(ipv6);
	const list = family === 'v4' ? [...a.v4, ...b.v4] : [...a.v6, ...b.v6];
	return Array.from(new Set(list)).join(', ');
}

export async function applyNetConfig(params: {
	scope: 'all' | 'wan' | 'lan';
	public_ip?: string;
	public_ipv6?: string;
	/** 仅当调用方显式传入时才改默认路由；省略则保留现网网关。 */
	public_gw?: string | null;
	private_ip?: string;
	private_ipv6?: string;
}): Promise<{ ok: boolean; logs: string[] }> {
	const { scope } = params;
	const public_ip = typeof params.public_ip === 'string' ? params.public_ip.trim() : '';
	const public_ipv6 = typeof params.public_ipv6 === 'string' ? params.public_ipv6.trim() : '';
	const private_ip = typeof params.private_ip === 'string' ? params.private_ip.trim() : '';
	const private_ipv6 = typeof params.private_ipv6 === 'string' ? params.private_ipv6.trim() : '';
	const gatewayProvided = Object.prototype.hasOwnProperty.call(params, 'public_gw');
	const public_gw = gatewayProvided
		? typeof params.public_gw === 'string'
			? params.public_gw.trim()
			: ''
		: '';
	const logs: string[] = [];

	const hasAnyIp =
		((scope === 'all' || scope === 'wan') && (public_ip || public_ipv6)) ||
		((scope === 'all' || scope === 'lan') && (private_ip || private_ipv6)) ||
		((scope === 'all' || scope === 'wan') && gatewayProvided);
	if (!hasAnyIp) {
		throw new Error('请至少填写一项 IPv4 / IPv6（或显式指定网关）');
	}

	if ((scope === 'all' || scope === 'wan') && public_ip && !isCidr(public_ip)) {
		throw new Error('WAN 口 IPv4 格式错误，请使用 CIDR（例如 10.0.0.2/24）');
	}
	if ((scope === 'all' || scope === 'wan') && public_ipv6 && !isIpv6Cidr(public_ipv6)) {
		throw new Error('WAN 口 IPv6 格式错误，请使用 CIDR（例如 2100::100/64）');
	}
	if ((scope === 'all' || scope === 'lan') && private_ip && !isCidr(private_ip)) {
		throw new Error('LAN 口 IPv4 格式错误，请使用 CIDR（例如 192.168.1.1/24）');
	}
	if ((scope === 'all' || scope === 'lan') && private_ipv6 && !isIpv6Cidr(private_ipv6)) {
		throw new Error('LAN 口 IPv6 格式错误，请使用 CIDR（例如 2100::1/64）');
	}
	if ((scope === 'all' || scope === 'wan') && gatewayProvided && public_gw && !isIpv4(public_gw)) {
		throw new Error('WAN 口网关格式错误（例如 10.0.0.1）');
	}

	const paths = getPaths();
	const state = loadState(paths);
	const initMode = normalizeInitMode(state.init_mode);
	if (!computeNicsInitialized(state)) {
		throw new Error('请先完成网卡初始化向导');
	}

	const rolesConf = readNicRolesConf(paths);
	const pciNicsDetailed = listPciNicsDetailed({ rolesConf });
	const stateRec = state as Record<string, unknown>;
	const { filled: mgmtFilled } = ensureMgmtPciInState(stateRec, pciNicsDetailed);
	if (mgmtFilled) saveState(paths, stateRec);
	const identity = readNicIdentity(stateRec);
	const wanPci = identity.wanPci;
	const lanPci = identity.lanPci;
	if ((scope === 'wan' && !wanPci) || (scope === 'lan' && !lanPci) || (scope === 'all' && !wanPci && !lanPci)) {
		throw new Error('请先完成网卡初始化（写入 WAN/LAN 身份）后再设置网口IP');
	}
	const wanIf = wanPci ? pciToVbrasIfname(wanPci) : '';
	const lanIf = lanPci ? pciToVbrasIfname(lanPci) : '';

	const roles = Array.isArray((rolesConf as any)?.roles) ? ((rolesConf as any).roles as any[]) : [];
	const findByPci = (pci: string) => roles.find((x) => x && typeof x === 'object' && String((x as any).pci ?? '').trim() === pci);
	const roleWan = wanPci ? findByPci(wanPci) : undefined;
	const roleLan = lanPci ? findByPci(lanPci) : undefined;
	const oldWanIp = vbrasFamilyCidrs(roleWan?.vbras, 'v4');
	const oldWanIpv6 = vbrasFamilyCidrs(roleWan?.vbras, 'v6');
	const oldLanIp = vbrasFamilyCidrs(roleLan?.vbras, 'v4');
	const oldLanIpv6 = vbrasFamilyCidrs(roleLan?.vbras, 'v6');
	const oldWanGw = typeof roleWan?.vbras?.gateway === 'string' ? String(roleWan.vbras.gateway).trim() : '';

	if ((scope === 'all' || scope === 'wan') && wanPci && wanIf) {
		logs.push(`WAN 口：${wanIf}（clish）`);
		if (public_ip) {
			const wanRes = await applyPhysicalInterfaceIpv4(paths, {
				ifname: wanIf,
				cidr: public_ip,
				oldCidr: oldWanIp || undefined,
			});
			if (wanRes.output?.trim()) logs.push(wanRes.output.trim());
		} else if (oldWanIp) {
			const cleared = await clearPhysicalInterfaceAddresses(paths, {
				ifname: wanIf,
				family: 'v4',
				oldCidr: oldWanIp,
			});
			if (cleared.output?.trim()) logs.push(cleared.output.trim());
			logs.push(`已清除 WAN IPv4：${oldWanIp}`);
		}
		if (public_ipv6) {
			const wan6 = await applyPhysicalInterfaceIpv6(paths, {
				ifname: wanIf,
				cidr: public_ipv6,
				oldCidr: oldWanIpv6 || undefined,
			});
			if (wan6.output?.trim()) logs.push(wan6.output.trim());
		} else if (oldWanIpv6) {
			const cleared = await clearPhysicalInterfaceAddresses(paths, {
				ifname: wanIf,
				family: 'v6',
				oldCidr: oldWanIpv6,
			});
			if (cleared.output?.trim()) logs.push(cleared.output.trim());
			logs.push(`已清除 WAN IPv6：${oldWanIpv6}`);
		}
		if (gatewayProvided && (public_gw || oldWanGw)) {
			const routeRes = await applyDefaultRouteVia(paths, { gw: public_gw, oldGw: oldWanGw || undefined });
			if (routeRes.output?.trim()) logs.push(routeRes.output.trim());
		}
	}

	if ((scope === 'all' || scope === 'lan') && lanPci && lanIf) {
		logs.push(`LAN 口：${lanIf}（clish）`);
		if (private_ip) {
			const lanRes = await applyPhysicalInterfaceIpv4(paths, {
				ifname: lanIf,
				cidr: private_ip,
				oldCidr: oldLanIp || undefined,
			});
			if (lanRes.output?.trim()) logs.push(lanRes.output.trim());
		} else if (oldLanIp) {
			const cleared = await clearPhysicalInterfaceAddresses(paths, {
				ifname: lanIf,
				family: 'v4',
				oldCidr: oldLanIp,
			});
			if (cleared.output?.trim()) logs.push(cleared.output.trim());
			logs.push(`已清除 LAN IPv4：${oldLanIp}`);
		}
		if (private_ipv6) {
			const lan6 = await applyPhysicalInterfaceIpv6(paths, {
				ifname: lanIf,
				cidr: private_ipv6,
				oldCidr: oldLanIpv6 || undefined,
			});
			if (lan6.output?.trim()) logs.push(lan6.output.trim());
		} else if (oldLanIpv6) {
			const cleared = await clearPhysicalInterfaceAddresses(paths, {
				ifname: lanIf,
				family: 'v6',
				oldCidr: oldLanIpv6,
			});
			if (cleared.output?.trim()) logs.push(cleared.output.trim());
			logs.push(`已清除 LAN IPv6：${oldLanIpv6}`);
		}
	}

	const nextState = loadState(paths);
	const lastApply: Record<string, unknown> = (nextState.last_apply && typeof nextState.last_apply === 'object' ? { ...(nextState.last_apply as any) } : {}) as any;
	if ((scope === 'all' || scope === 'wan') && wanPci) {
		if (public_ip) lastApply.public_ip = public_ip;
		else delete lastApply.public_ip;
		if (public_ipv6) lastApply.public_ipv6 = public_ipv6;
		else delete lastApply.public_ipv6;
		if (gatewayProvided) lastApply.public_gw = public_gw || null;
	}
	if ((scope === 'all' || scope === 'lan') && lanPci) {
		if (private_ip) lastApply.private_ip = private_ip;
		else delete lastApply.private_ip;
		if (private_ipv6) lastApply.private_ipv6 = private_ipv6;
		else delete lastApply.private_ipv6;
	}
	nextState.last_apply = lastApply;
	saveState(paths, nextState);

	let nicRolesAfterApply: Record<string, unknown> | null = null;
	try {
		const rc = readNicRolesConf(paths);
		if (rc && typeof rc === 'object') {
			const arr = Array.isArray((rc as any)?.roles) ? ((rc as any).roles as any[]) : [];
			const patchByPci = (pci: string, fn: (vbras: Record<string, unknown>) => void) => {
				const item = arr.find((x) => x && typeof x === 'object' && String((x as any).pci ?? '').trim() === pci);
				if (!item || typeof item !== 'object') return;
				if (!(item as any).vbras || typeof (item as any).vbras !== 'object') (item as any).vbras = {};
				fn((item as any).vbras as Record<string, unknown>);
			};
			if ((scope === 'all' || scope === 'wan') && wanPci) {
				patchByPci(wanPci, (vbras) => {
					vbras.ip = public_ip || '';
					vbras.ipv6 = public_ipv6 || '';
					if (gatewayProvided) vbras.gateway = public_gw || null;
					vbras.name = wanIf;
				});
			}
			if ((scope === 'all' || scope === 'lan') && lanPci) {
				patchByPci(lanPci, (vbras) => {
					vbras.ip = private_ip || '';
					vbras.ipv6 = private_ipv6 || '';
					vbras.name = lanIf;
				});
			}
			nicRolesAfterApply = rc as Record<string, unknown>;
		}
	} catch {
	}

	await syncNicRolesSnapshot(paths, logs, nicRolesAfterApply);

	return { ok: true, logs };
}

export async function applyExtraLans(params: { items: unknown }): Promise<{ ok: boolean; logs: string[] }> {
	const raw = params.items;
	const items: Array<{ ifname: string; cidr: string; ipv6: string }> = Array.isArray(raw)
		? raw
				.map((x) => {
					if (!x || typeof x !== 'object') return null;
					const ifname = typeof (x as any).ifname === 'string' ? String((x as any).ifname).trim() : '';
					const cidr = typeof (x as any).cidr === 'string' ? String((x as any).cidr).trim() : '';
					const ipv6 = typeof (x as any).ipv6 === 'string' ? String((x as any).ipv6).trim() : '';
					// 允许 cidr/ipv6 为空：表示清除该口对应族地址
					if (!ifname) return null;
					return { ifname, cidr, ipv6 };
				})
				.filter((x): x is { ifname: string; cidr: string; ipv6: string } => !!x)
		: [];

	if (items.length === 0) {
		throw new Error('请至少提交一条辅助 LAN 口（地址可留空以清除）');
	}

	for (const it of items) {
		if (it.cidr && !isCidr(it.cidr)) throw new Error(`辅助 LAN 口 IPv4 格式错误：${it.ifname}（请使用 CIDR，例如 192.168.10.1/24）`);
		if (it.ipv6 && !isIpv6Cidr(it.ipv6)) throw new Error(`辅助 LAN 口 IPv6 格式错误：${it.ifname}（请使用 CIDR，例如 2100::10/64）`);
	}

	const paths = getPaths();
	const state = loadState(paths);
	const initMode = normalizeInitMode(state.init_mode);
	if (initMode !== 'static') {
		throw new Error('当前为 DHCP 模式，辅助 LAN 口仅在静态模式（三网卡基线）时可用');
	}
	if (!computeNicsInitialized(state)) {
		throw new Error('请先完成网卡初始化向导');
	}

	const rolesConf = readNicRolesConf(paths);
	const pciNicsDetailed = listPciNicsDetailed({ rolesConf });
	const stateRec = state as Record<string, unknown>;
	ensureMgmtPciInState(stateRec, pciNicsDetailed);
	const identity = readNicIdentity(stateRec);
	if (!identity.wanPci || !identity.lanPci) {
		throw new Error('请先完成网卡初始化（写入 WAN/LAN 身份）后再设定辅助 LAN IP');
	}

	const attachPci = resolveOsNicAttachPci(stateRec as JsonObject, rolesConf);
	const extraPcis = resolveExtraAttachPcis(attachPci, identity).slice(0, 5);
	if (extraPcis.length === 0) {
		throw new Error('当前未挂载可用的辅助 LAN 网口（请先扩容辅助口）');
	}

	const allowed = new Map<string, string>();
	for (const pci of extraPcis) {
		const ifname = pciToVbrasIfname(pci);
		if (ifname) allowed.set(ifname, pci);
	}

	const dedup = new Map<string, { cidr: string; ipv6: string }>();
	for (const it of items) {
		const n = normalizeVppCliIfname(it.ifname);
		if (!allowed.has(n)) throw new Error(`辅助 LAN 口无效或未挂载：${it.ifname}`);
		// 后写覆盖：显式空串表示清除，不得被「只填一侧」的旧合并逻辑吞掉
		dedup.set(n, { cidr: it.cidr, ipv6: it.ipv6 });
	}

	const roles = Array.isArray((rolesConf as any)?.roles) ? ((rolesConf as any).roles as any[]) : [];
	const byPci = new Map<string, any>();
	for (const row of roles) {
		if (!row || typeof row !== 'object') continue;
		const pci = typeof (row as any).pci === 'string' ? String((row as any).pci).trim() : '';
		if (pci) byPci.set(pci, row);
	}

	const logs: string[] = [];
	const appliedItems: Array<{ ifname: string; cidr?: string; ipv6?: string }> = [];
	for (const [ifname, addrs] of dedup.entries()) {
		const pci = allowed.get(ifname)!;
		const roleItem = byPci.get(pci);
		const oldIp = vbrasFamilyCidrs(roleItem?.vbras, 'v4');
		const oldIpv6 = vbrasFamilyCidrs(roleItem?.vbras, 'v6');
		logs.push(`辅助 LAN 口：${ifname}（clish）`);
		if (addrs.cidr) {
			const extraRes = await applyPhysicalInterfaceIpv4(paths, {
				ifname,
				cidr: addrs.cidr,
				oldCidr: oldIp || undefined,
			});
			if (extraRes.output?.trim()) logs.push(extraRes.output.trim());
		} else if (oldIp) {
			const cleared = await clearPhysicalInterfaceAddresses(paths, {
				ifname,
				family: 'v4',
				oldCidr: oldIp,
			});
			if (cleared.output?.trim()) logs.push(cleared.output.trim());
			logs.push(`已清除辅助口 IPv4：${oldIp}`);
		}
		if (addrs.ipv6) {
			const extra6 = await applyPhysicalInterfaceIpv6(paths, {
				ifname,
				cidr: addrs.ipv6,
				oldCidr: oldIpv6 || undefined,
			});
			if (extra6.output?.trim()) logs.push(extra6.output.trim());
		} else if (oldIpv6) {
			const cleared = await clearPhysicalInterfaceAddresses(paths, {
				ifname,
				family: 'v6',
				oldCidr: oldIpv6,
			});
			if (cleared.output?.trim()) logs.push(cleared.output.trim());
			logs.push(`已清除辅助口 IPv6：${oldIpv6}`);
		}
		appliedItems.push({
			ifname,
			...(addrs.cidr ? { cidr: addrs.cidr } : {}),
			...(addrs.ipv6 ? { ipv6: addrs.ipv6 } : {}),
		});
	}

	const nextState = loadState(paths);
	(nextState as any).extra_lans = appliedItems;
	saveState(paths, nextState);

	let nicRolesAfterExtra: Record<string, unknown> | null = null;
	try {
		const rc = readNicRolesConf(paths);
		if (rc && typeof rc === 'object') {
			const arr = Array.isArray((rc as any)?.roles) ? ((rc as any).roles as any[]) : [];
			for (const it of appliedItems) {
				const pci = allowed.get(it.ifname);
				if (!pci) continue;
				const row = arr.find((x) => x && typeof x === 'object' && String((x as any).pci ?? '').trim() === pci);
				if (!row || typeof row !== 'object') continue;
				if (!(row as any).vbras || typeof (row as any).vbras !== 'object') (row as any).vbras = {};
				(row as any).vbras.name = it.ifname;
				(row as any).vbras.ip = it.cidr || '';
				(row as any).vbras.ipv6 = it.ipv6 || '';
			}
			nicRolesAfterExtra = rc as Record<string, unknown>;
		}
	} catch {
	}

	await syncNicRolesSnapshot(paths, logs, nicRolesAfterExtra);

	return { ok: true, logs };
}
