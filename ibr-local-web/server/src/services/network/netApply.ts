/**
 * 网卡快照同步与 WAN/LAN/辅助 LAN 配置应用（clish，与 agent Lua 一致）。
 * 业务域：网络 / 网卡配置应用（与 `services/forwarding` 转发域分离）。
 */
import { isCidr, isIpv4, pciToVbrasIfname } from '../../routes/api/helpers.js';
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
import { applyDefaultRouteVia, applyPhysicalInterfaceIpv4 } from './interfaceClishApply.js';

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

		const attachPci = resolveOsNicAttachPci(state, rolesConf ?? rolesFromDisk);
		const existingForBuild =
			rolesConf && typeof rolesConf === 'object' && !Array.isArray(rolesConf) ? rolesConf : ({ roles: [] } as JsonObject);

		const snapshot = await buildNicRolesSnapshot({
			mode: initMode,
			pcis,
			attachPci,
			existing: existingForBuild,
			pciDetails: pciNicsDetailed.length > 0 ? pciNicsDetailed : null,
			paths,
		});
		writeNicRolesConf(paths, snapshot as JsonObject);
		logs.push('已同步网卡快照（nic_roles.conf，含 vbras 实时接口地址）');
	} catch (e) {
		logs.push(`网卡快照同步失败：${e instanceof Error ? e.message : String(e)}`);
	}
}

export async function applyNetConfig(params: {
	scope: 'all' | 'wan' | 'lan';
	public_ip?: string;
	public_gw?: string | null;
	private_ip?: string;
}): Promise<{ ok: boolean; logs: string[] }> {
	const { scope } = params;
	const public_ip = typeof params.public_ip === 'string' ? params.public_ip.trim() : '';
	const private_ip = typeof params.private_ip === 'string' ? params.private_ip.trim() : '';
	const public_gw = typeof params.public_gw === 'string' ? params.public_gw.trim() : '';
	const logs: string[] = [];

	if ((scope === 'all' || scope === 'wan') && public_ip && !isCidr(public_ip)) {
		throw new Error('WAN 口 IP 格式错误，请使用 CIDR（例如 10.0.0.2/24）');
	}
	if ((scope === 'all' || scope === 'lan') && private_ip && !isCidr(private_ip)) {
		throw new Error('LAN 口 IP 格式错误，请使用 CIDR（例如 192.168.1.1/24）');
	}
	if ((scope === 'all' || scope === 'wan') && public_gw && !isIpv4(public_gw)) {
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
	const pcis = pciNicsDetailed.length > 0 ? pciNicsDetailed.map((x) => x.pci) : listAvailablePciNics({ rolesConf });
	const idxMap = initMode === 'static' ? { wan: 1, lan: 2 } : { wan: 0, lan: 1 };

	if (idxMap.wan >= pcis.length || idxMap.lan >= pcis.length) {
		throw new Error('未发现 WAN/LAN 网卡，请检查初始化模式与网卡列表');
	}

	const wanPci = pcis[idxMap.wan]!;
	const lanPci = pcis[idxMap.lan]!;
	const wanIf = pciToVbrasIfname(wanPci);
	const lanIf = pciToVbrasIfname(lanPci);

	const roles = Array.isArray((rolesConf as any)?.roles) ? ((rolesConf as any).roles as any[]) : [];
	const roleWan = roles.find((x) => x && typeof x === 'object' && (x as any).role === 'wan');
	const roleLan = roles.find((x) => x && typeof x === 'object' && (x as any).role === 'lan');
	const oldWanIp = typeof roleWan?.vbras?.ip === 'string' ? String(roleWan.vbras.ip).trim() : '';
	const oldLanIp = typeof roleLan?.vbras?.ip === 'string' ? String(roleLan.vbras.ip).trim() : '';
	const oldWanGw = typeof roleWan?.vbras?.gateway === 'string' ? String(roleWan.vbras.gateway).trim() : '';

	if (scope === 'all' || scope === 'wan') {
		logs.push(`WAN 口：${wanIf}（clish）`);
		if (public_ip) {
			const wanRes = await applyPhysicalInterfaceIpv4(paths, {
				ifname: wanIf,
				cidr: public_ip,
				oldCidr: oldWanIp || undefined,
			});
			if (wanRes.output?.trim()) logs.push(wanRes.output.trim());
		}
		if (public_gw || oldWanGw) {
			const routeRes = await applyDefaultRouteVia(paths, { gw: public_gw, oldGw: oldWanGw || undefined });
			if (routeRes.output?.trim()) logs.push(routeRes.output.trim());
		}
	}

	if (scope === 'all' || scope === 'lan') {
		logs.push(`LAN 口：${lanIf}（clish）`);
		if (private_ip) {
			const lanRes = await applyPhysicalInterfaceIpv4(paths, {
				ifname: lanIf,
				cidr: private_ip,
				oldCidr: oldLanIp || undefined,
			});
			if (lanRes.output?.trim()) logs.push(lanRes.output.trim());
		}
	}

	const nextState = loadState(paths);
	const lastApply: Record<string, unknown> = (nextState.last_apply && typeof nextState.last_apply === 'object' ? { ...(nextState.last_apply as any) } : {}) as any;
	if (scope === 'all' || scope === 'wan') {
		if (public_ip) lastApply.public_ip = public_ip;
		lastApply.public_gw = public_gw || null;
	}
	if (scope === 'all' || scope === 'lan') {
		if (private_ip) lastApply.private_ip = private_ip;
	}
	nextState.last_apply = lastApply;
	saveState(paths, nextState);

	let nicRolesAfterApply: Record<string, unknown> | null = null;
	try {
		const rc = readNicRolesConf(paths);
		if (rc && typeof rc === 'object') {
			const arr = Array.isArray((rc as any)?.roles) ? ((rc as any).roles as any[]) : [];
			for (const item of arr) {
				if (!item || typeof item !== 'object') continue;
				const role = (item as any).role;
				if (role !== 'wan' && role !== 'lan') continue;
				if (!(item as any).vbras || typeof (item as any).vbras !== 'object') (item as any).vbras = {};
				if (role === 'wan' && (scope === 'all' || scope === 'wan')) {
					if (public_ip) (item as any).vbras.ip = public_ip;
					(item as any).vbras.gateway = public_gw || null;
					(item as any).vbras.name = wanIf;
				}
				if (role === 'lan' && (scope === 'all' || scope === 'lan')) {
					if (private_ip) (item as any).vbras.ip = private_ip;
					(item as any).vbras.name = lanIf;
				}
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
	const items: Array<{ ifname: string; cidr: string }> = Array.isArray(raw)
		? raw
				.map((x) => {
					if (!x || typeof x !== 'object') return null;
					const ifname = typeof (x as any).ifname === 'string' ? String((x as any).ifname).trim() : '';
					const cidr = typeof (x as any).cidr === 'string' ? String((x as any).cidr).trim() : '';
					if (!ifname || !cidr) return null;
					return { ifname, cidr };
				})
				.filter((x): x is { ifname: string; cidr: string } => !!x)
		: [];

	if (items.length === 0) {
		throw new Error('请至少填写一条辅助 LAN 配置');
	}

	for (const it of items) {
		if (!isCidr(it.cidr)) throw new Error(`辅助 LAN 口 IP 格式错误：${it.ifname}（请使用 CIDR，例如 192.168.10.1/24）`);
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
	const pcis = pciNicsDetailed.length > 0 ? pciNicsDetailed.map((x) => x.pci) : listAvailablePciNics({ rolesConf });
	if (pcis.length < 4) {
		throw new Error('未发现可用的辅助 LAN 网口（至少需要 4 块网卡）');
	}

	const attachPci = Array.isArray((state as any).os_nic_attach_pci)
		? ((state as any).os_nic_attach_pci as unknown[])
				.map((x) => (typeof x === 'string' ? x.trim() : ''))
				.filter(Boolean)
		: [];

	const extraPcis = pcis.slice(3, 8).filter((p) => attachPci.includes(p));
	if (extraPcis.length === 0) {
		throw new Error('当前未挂载可用的辅助 LAN 网口（请在网卡初始化中勾选 NIC#4-#8）');
	}

	const allowed = new Map<string, string>();
	for (const pci of extraPcis) {
		const ifname = pciToVbrasIfname(pci);
		if (ifname) allowed.set(ifname, pci);
	}

	const dedup = new Map<string, string>();
	for (const it of items) {
		const n = normalizeVppCliIfname(it.ifname);
		if (!allowed.has(n)) throw new Error(`辅助 LAN 口无效或未挂载：${it.ifname}`);
		dedup.set(n, it.cidr);
	}

	const roles = Array.isArray((rolesConf as any)?.roles) ? ((rolesConf as any).roles as any[]) : [];
	const byPci = new Map<string, any>();
	for (const row of roles) {
		if (!row || typeof row !== 'object') continue;
		const pci = typeof (row as any).pci === 'string' ? String((row as any).pci).trim() : '';
		if (pci) byPci.set(pci, row);
	}

	const logs: string[] = [];
	const appliedItems: Array<{ ifname: string; cidr: string }> = [];
	for (const [ifname, cidr] of dedup.entries()) {
		const pci = allowed.get(ifname)!;
		const roleItem = byPci.get(pci);
		const oldIp = typeof roleItem?.vbras?.ip === 'string' ? String(roleItem.vbras.ip).trim() : '';
		logs.push(`辅助 LAN 口：${ifname}（clish）`);
		const extraRes = await applyPhysicalInterfaceIpv4(paths, {
			ifname,
			cidr,
			oldCidr: oldIp || undefined,
		});
		if (extraRes.output?.trim()) logs.push(extraRes.output.trim());
		appliedItems.push({ ifname, cidr });
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
				(row as any).vbras.ip = it.cidr;
			}
			nicRolesAfterExtra = rc as Record<string, unknown>;
		}
	} catch {
	}

	await syncNicRolesSnapshot(paths, logs, nicRolesAfterExtra);

	return { ok: true, logs };
}
