/**
 * 网卡角色快照（nic_roles.conf 的 `roles[]`）。
 * 流程：sysfs 读 OS 口 → vbras CLI 拉地址与 hardware → 合并后落盘 `os` / `vbras`（仅 name/state/ip/speed_* /driver；不写 duplex/mtu/carrier/mac/vpp_hw）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

import { normalizeVppCliIfname, pciToVppCliIfname } from './pciVpp.js';
import { runVbrasCli, type VbrasCliPaths } from './vbrasCli.js';

import type { InitMode, NicRole, PciNic } from './vrwizard.js';

function exists(p: string): boolean {
	try {
		return fs.existsSync(p);
	} catch {
		return false;
	}
}

/** 来自 /sys/class/net/<if>/ 的链路/驱动信息，用于快照与状态 API。 */
export type NetdevLinkSnapshot = {
	speed_mbps: number | null;
	speed_grade: string;
	duplex: string;
	mtu: number | null;
	carrier: boolean | null;
	driver: string;
};

export function speedMbpsToGrade(mbps: number | null): string {
	if (mbps == null || !Number.isFinite(mbps) || mbps <= 0) return 'unknown';
	if (mbps < 1000) return `${Math.round(mbps)}M`;
	const g = mbps / 1000;
	if (Number.isInteger(g)) return `${g}G`;
	const s = g.toFixed(1).replace(/\.0$/, '');
	return `${s}G`;
}

function nicSideSpeedKnown(side: { speed_grade?: unknown; speed_mbps?: unknown } | null | undefined): boolean {
	if (!side || typeof side !== 'object') return false;
	const grade = typeof side.speed_grade === 'string' ? side.speed_grade.trim() : '';
	if (grade && grade !== 'unknown') return true;
	const mbps = side.speed_mbps;
	return typeof mbps === 'number' && Number.isFinite(mbps) && mbps > 0;
}

/** nic_roles 中缺少链路速率（旧快照或未跑 hardware 遥测）时为 true。 */
export function nicRolesSpeedStale(rolesConf: Record<string, unknown> | null | undefined): boolean {
	if (!rolesConf || typeof rolesConf !== 'object') return false;
	const roles = Array.isArray((rolesConf as { roles?: unknown }).roles) ? (rolesConf as { roles: unknown[] }).roles : [];
	for (const row of roles) {
		if (!row || typeof row !== 'object') continue;
		const r = row as { attached?: boolean; os?: Record<string, unknown>; vbras?: Record<string, unknown> };
		const attached = !!r.attached;
		const vbrasName = typeof r.vbras?.name === 'string' ? r.vbras.name.trim() : '';
		const osName = typeof r.os?.name === 'string' ? r.os.name.trim() : '';
		if (attached && vbrasName && !nicSideSpeedKnown(r.vbras)) return true;
		if (!attached && osName && !nicSideSpeedKnown(r.os)) return true;
	}
	return false;
}

function findNicRoleRowByPci(roles: unknown[], pci: string): Record<string, unknown> | null {
	const p = pci.trim();
	for (const row of roles) {
		if (!row || typeof row !== 'object') continue;
		const rp = (row as { pci?: unknown }).pci;
		if (typeof rp === 'string' && rp.trim() === p) return row as Record<string, unknown>;
	}
	return null;
}

/** 从 vbras CLI 遥测 Map 查接口 IPv4。 */
export function lookupVbrasTeleIp(
	tele: Map<string, { state: string; ip: string }> | null | undefined,
	ifname: string,
): string | null {
	if (!tele || !ifname.trim()) return null;
	const keys = [normalizeVppCliIfname(ifname), ifname.trim()].filter((k, i, a) => a.indexOf(k) === i);
	for (const k of keys) {
		const t = tele.get(k);
		if (t?.ip && t.ip !== '-') return t.ip;
	}
	return null;
}

/** nic_roles 中已接管口的 vbras IP 与 CLI 实时地址不一致时为 true。 */
export function nicRolesVbrasIpsStale(
	rolesConf: Record<string, unknown> | null | undefined,
	tele: Map<string, { state: string; ip: string }> | null | undefined,
): boolean {
	if (!rolesConf || !tele?.size) return false;
	const roles = Array.isArray((rolesConf as { roles?: unknown }).roles) ? (rolesConf as { roles: unknown[] }).roles : [];
	for (const row of roles) {
		if (!row || typeof row !== 'object') continue;
		const r = row as { attached?: boolean; vbras?: { name?: string; ip?: string } };
		if (!r.attached) continue;
		const name = typeof r.vbras?.name === 'string' ? r.vbras.name : '';
		const confIp = typeof r.vbras?.ip === 'string' ? r.vbras.ip.trim() : '';
		const liveIp = lookupVbrasTeleIp(tele, name);
		if (liveIp && liveIp !== confIp) return true;
	}
	return false;
}

/** 快照文件缺失、roles 为空或与 sysfs PCI 列表严重不一致时需立即刷新。 */
export function nicRolesSnapshotCriticallyStale(
	rolesConf: Record<string, unknown> | null | undefined,
	pcis: string[],
): boolean {
	if (pcis.length === 0) return false;
	if (!rolesConf || typeof rolesConf !== 'object') return true;
	const roles = Array.isArray((rolesConf as { roles?: unknown }).roles) ? (rolesConf as { roles: unknown[] }).roles : [];
	if (roles.length === 0) return true;
	for (const pci of pcis) {
		if (!findNicRoleRowByPci(roles, pci)) return true;
	}
	return false;
}

/** state 中 os_nic_attach_pci 与 nic_roles 各行 attached 不一致时为 true。 */
export function nicRolesAttachStateStale(
	rolesConf: Record<string, unknown> | null | undefined,
	attachPci: string[],
): boolean {
	if (attachPci.length === 0) return false;
	if (!rolesConf || typeof rolesConf !== 'object') return true;
	const roles = Array.isArray((rolesConf as { roles?: unknown }).roles) ? (rolesConf as { roles: unknown[] }).roles : [];
	const attachSet = new Set(attachPci.map((p) => p.trim()).filter(Boolean));
	for (const pci of attachSet) {
		const row = findNicRoleRowByPci(roles, pci);
		if (!row || row.attached !== true) return true;
	}
	for (const row of roles) {
		if (!row || typeof row !== 'object') continue;
		const pci = typeof (row as { pci?: unknown }).pci === 'string' ? (row as { pci: string }).pci.trim() : '';
		if (!pci) continue;
		const attached = (row as { attached?: boolean }).attached === true;
		const shouldAttach = attachSet.has(pci);
		if (attached !== shouldAttach) return true;
	}
	return false;
}

/** 仪表板 / 配置页读取前：快照是否应重新从 OS + vbras CLI 合并。 */
export function nicRolesSnapshotNeedsRefresh(
	rolesConf: Record<string, unknown> | null | undefined,
	opts?: {
		vbrasIfTele?: Map<string, { state: string; ip: string }> | null;
		pcis?: string[];
		attachPci?: string[];
	},
): boolean {
	const pcis = opts?.pcis ?? [];
	if (nicRolesSnapshotCriticallyStale(rolesConf, pcis)) return true;
	if (!rolesConf || typeof rolesConf !== 'object') return false;
	if (nicRolesSpeedStale(rolesConf)) return true;
	if (opts?.attachPci && nicRolesAttachStateStale(rolesConf, opts.attachPci)) return true;
	if (opts?.vbrasIfTele && nicRolesVbrasIpsStale(rolesConf, opts.vbrasIfTele)) return true;
	return false;
}

/** 读取 Linux sysfs 下某 OS 网口的链路速率、双工、MTU、载波与内核驱动名。 */
export function readNetdevLinkSnapshot(ifname: string): NetdevLinkSnapshot {
	const empty: NetdevLinkSnapshot = {
		speed_mbps: null,
		speed_grade: 'unknown',
		duplex: 'unknown',
		mtu: null,
		carrier: null,
		driver: '',
	};
	const name = (ifname || '').trim();
	if (!name) return empty;

	if (process.platform === 'win32') {
		return { speed_mbps: 1000, speed_grade: '1G', duplex: 'full', mtu: 1500, carrier: true, driver: 'mock' };
	}

	const base = path.posix.join('/sys/class/net', name);
	if (!exists(base)) return empty;

	let speed_mbps: number | null = null;
	try {
		const raw = fs.readFileSync(path.posix.join(base, 'speed'), 'utf8').trim();
		const v = Number.parseInt(raw, 10);
		if (Number.isFinite(v) && v > 0 && v < 1_000_000) speed_mbps = v;
	} catch {
		speed_mbps = null;
	}

	let duplex = 'unknown';
	try {
		const d = fs.readFileSync(path.posix.join(base, 'duplex'), 'utf8').trim().toLowerCase();
		if (d === 'full' || d === 'half') duplex = d;
	} catch {
		duplex = 'unknown';
	}

	let mtu: number | null = null;
	try {
		const raw = fs.readFileSync(path.posix.join(base, 'mtu'), 'utf8').trim();
		const v = Number.parseInt(raw, 10);
		if (Number.isFinite(v) && v > 0) mtu = v;
	} catch {
		mtu = null;
	}

	let carrier: boolean | null = null;
	try {
		const raw = fs.readFileSync(path.posix.join(base, 'carrier'), 'utf8').trim();
		if (raw === '0') carrier = false;
		else if (raw === '1') carrier = true;
	} catch {
		carrier = null;
	}

	let driver = '';
	try {
		const drv = path.posix.join(base, 'device', 'driver');
		if (exists(drv)) {
			const real = fs.realpathSync(drv);
			driver = path.basename(real);
		}
	} catch {
		driver = '';
	}

	return {
		speed_mbps,
		speed_grade: speedMbpsToGrade(speed_mbps),
		duplex,
		mtu,
		carrier,
		driver,
	};
}

function readOsIpv4ByIf(): Record<string, string> {
	if (process.platform === 'win32') return {};
	const out: Record<string, string> = {};
	try {
		const text = execFileSync('ip', ['-4', '-o', 'addr', 'show'], {
			encoding: 'utf8',
			timeout: 2000,
			stdio: ['ignore', 'pipe', 'pipe'],
		});
		for (const line of text.split(/\r?\n/)) {
			const m = /^\s*\d+:\s+(\S+)\s+inet\s+(\d+\.\d+\.\d+\.\d+\/\d+)\b/.exec(line);
			if (m && !out[m[1]!]) out[m[1]!] = m[2]!;
		}
	} catch {
		// ignore
	}
	return out;
}

/** 解析 `show interface address` 文本（与 vrlocalctl `_parse_interface_addresses` 对齐）。 */
export function parseVbrasShowInterfaceAddress(text: string): Map<string, { state: string; ips: string[] }> {
	const result = new Map<string, { state: string; ips: string[] }>();
	let current: string | null = null;
	for (const raw of text.split(/\r?\n/)) {
		const line = raw.trim();
		if (!line) continue;
		const mHdr = /^([A-Za-z0-9_.:/-]+)\s*\(([^)]+)\):\s*$/.exec(line);
		if (mHdr) {
			current = mHdr[1]!;
			let st = mHdr[2]!.trim().toLowerCase();
			if (st === 'dn') st = 'down';
			if (!result.has(current)) result.set(current, { state: st, ips: [] });
			else {
				const x = result.get(current)!;
				x.state = st;
			}
			continue;
		}
		if (current) {
			const mL3 = /\bL3\s+([0-9]+\.[0-9]+\.[0-9]+\.[0-9]+\/\d+)/.exec(line);
			if (mL3) {
				const addr = mL3[1]!;
				const rec = result.get(current)!;
				if (!rec.ips.includes(addr)) rec.ips.push(addr);
			}
		}
	}
	return result;
}

/** 将 VPP `show hardware-interfaces` 中的 PCI 地址规范为与 sysfs / nic_roles 一致的 `dddd:bb:dd.f` 形式。 */
export function normalizePciBdfForMatch(addr: string): string {
	const s = addr.trim().toLowerCase();
	const m = /^([0-9a-f]{4}):([0-9a-f]{2}):([0-9a-f]{2})\.(\d+)$/i.exec(s);
	if (!m) return s;
	const fn = Number.parseInt(m[4]!, 10);
	return `${m[1]}:${m[2]}:${m[3]}.${fn}`;
}

export type VppHwSnapshot = Record<string, unknown>;

function extractVppHardwareBlock(ifName: string, adminLink: string, block: string): VppHwSnapshot {
	const o: VppHwSnapshot = { vpp_if_name: ifName, vpp_admin_link: adminLink };
	const ls = /Link speed:\s*(.+)/i.exec(block);
	if (ls) o.link_speed = ls[1]!.trim();
	const eth = /Ethernet address\s+([0-9a-f:]+)/i.exec(block);
	if (eth) o.ethernet_address = String(eth[1]).trim().toLowerCase();
	const car = /carrier\s+(up|down)\s+(\S+)\s+duplex\s+(\S+)\s+mtu\s+(\d+)/i.exec(block);
	if (car) {
		o.carrier = car[1]!.toLowerCase();
		o.negotiated_duplex = car[3]!.toLowerCase();
		const mtuN = Number.parseInt(car[4]!, 10);
		if (Number.isFinite(mtuN)) o.mtu = mtuN;
	}
	const pciL = /\baddress\s+([0-9a-fA-F:.]+)/i.exec(block);
	if (pciL) o.pci_address = normalizePciBdfForMatch(pciL[1]!);
	const pdev = /pci:\s*device\s+([0-9a-fA-F:]+)\s+subsystem\s+([0-9a-fA-F:]+)/i.exec(block);
	if (pdev) {
		o.pci_device_id = pdev[1]!.toLowerCase();
		o.pci_subsystem_id = pdev[2]!.toLowerCase();
	}
	const rxF = /\brx frames ok\s+(\d+)/i.exec(block);
	const txF = /\btx frames ok\s+(\d+)/i.exec(block);
	const rxB = /\brx bytes ok\s+(\d+)/i.exec(block);
	const txB = /\btx bytes ok\s+(\d+)/i.exec(block);
	const rxM = /\brx missed\s+(\d+)/i.exec(block);
	if (rxF) o.rx_frames_ok = Number.parseInt(rxF[1]!, 10);
	if (txF) o.tx_frames_ok = Number.parseInt(txF[1]!, 10);
	if (rxB) o.rx_bytes_ok = Number.parseInt(rxB[1]!, 10);
	if (txB) o.tx_bytes_ok = Number.parseInt(txB[1]!, 10);
	if (rxM) o.rx_missed = Number.parseInt(rxM[1]!, 10);

	const lines = block.split(/\r?\n/).map((x) => x.trimEnd());
	const ethIdx = lines.findIndex((l) => /Ethernet address\s+/i.test(l));
	if (ethIdx >= 0 && ethIdx + 1 < lines.length) {
		const cand = lines[ethIdx + 1]!.trim();
		if (
			cand &&
			!/^Link speed/i.test(cand) &&
			!/^Ethernet address/i.test(cand) &&
			!/^carrier\b/i.test(cand) &&
			!/^pci:/i.test(cand) &&
			!/^rx\b/i.test(cand) &&
			!/^tx\b/i.test(cand) &&
			!/^flags:/i.test(cand)
		) {
			o.nic_model = cand;
		}
	}
	return o;
}

/** vbras / vctl 不同版本：复数 interfaces 与单数 interface 均尝试。 */
const VBRAS_HW_SHOW_COMMANDS = ['show hardware-interfaces\n', 'show hardware-interface\n'] as const;

function isVbrasCliUnknownInput(text: string): boolean {
	return /unknown input/i.test(text);
}

function parseVbrasHardwareTelemetry(text: string): {
	byPci: Map<string, VppHwSnapshot>;
	byName: Map<string, VppHwSnapshot>;
} | null {
	if (isVbrasCliUnknownInput(text)) return null;
	const parsed = parseVbrasShowHardwareInterfaces(text);
	if (parsed.byName.size === 0 && parsed.byPci.size === 0) return null;
	return parsed;
}

/**
 * 解析 `show hardware-interface(s)` 输出，按 **规范 PCI** 与 **VPP 接口名** 建索引，便于与 nic_roles 中 `pci` / `vbras.name` 对齐。
 */
export function parseVbrasShowHardwareInterfaces(text: string): {
	byPci: Map<string, VppHwSnapshot>;
	byName: Map<string, VppHwSnapshot>;
} {
	const byPci = new Map<string, VppHwSnapshot>();
	const byName = new Map<string, VppHwSnapshot>();
	const lines = text.split(/\r?\n/);

	let buf: string[] = [];
	let curIf: string | null = null;
	let curLink: string | null = null;

	const flush = () => {
		if (!curIf || buf.length === 0) return;
		const block = buf.join('\n');
		const rec = extractVppHardwareBlock(curIf, curLink ?? 'unknown', block);
		const nk = normalizeVppCliIfname(curIf);
		byName.set(nk, rec);
		if (nk !== curIf.trim()) byName.set(curIf.trim(), rec);
		const pAddr = rec.pci_address;
		if (typeof pAddr === 'string' && pAddr) {
			const pk = normalizePciBdfForMatch(pAddr);
			byPci.set(pk, rec);
		}
		buf = [];
		curIf = null;
		curLink = null;
	};

	for (const raw of lines) {
		if (/^\s*Name\s+Idx\s+Link\s+Hardware/i.test(raw)) continue;
		const m = /^(\S+)\s+(\d+)\s+(up|down)\b/i.exec(raw.trim());
		if (m && !/^\d+$/.test(m[1]!)) {
			flush();
			curIf = m[1]!;
			curLink = m[3]!.toLowerCase();
			buf.push(raw);
			continue;
		}
		if (curIf) buf.push(raw);
	}
	flush();
	return { byPci, byName };
}

export async function fetchVbrasHardwareTelemetry(paths: VbrasCliPaths): Promise<{
	byPci: Map<string, VppHwSnapshot>;
	byName: Map<string, VppHwSnapshot>;
}> {
	const empty = { byPci: new Map<string, VppHwSnapshot>(), byName: new Map<string, VppHwSnapshot>() };
	if (process.platform === 'win32' && !paths.base) return empty;

	for (const cmd of VBRAS_HW_SHOW_COMMANDS) {
		try {
			const raw = await runVbrasCli(paths, cmd, 20000);
			const parsed = parseVbrasHardwareTelemetry(raw);
			if (parsed) return parsed;
		} catch {
			// 尝试下一种命令写法
		}
	}
	return empty;
}

export function parseLinkSpeedToMbps(linkSpeed: unknown): number | null {
	if (linkSpeed == null) return null;
	const s = String(linkSpeed).trim().toLowerCase();
	const g = /([\d.]+)\s*gbps?/.exec(s);
	if (g) {
		const n = Number.parseFloat(g[1]!);
		return Number.isFinite(n) ? Math.round(n * 1000) : null;
	}
	const m = /([\d.]+)\s*mbps?/.exec(s);
	if (m) {
		const n = Number.parseFloat(m[1]!);
		return Number.isFinite(n) ? Math.round(n) : null;
	}
	return null;
}

function resolveVppHwRecord(
	hwMaps: { byPci: Map<string, VppHwSnapshot>; byName: Map<string, VppHwSnapshot> } | null,
	pci: string,
	vbrasName: string,
): VppHwSnapshot | null {
	if (!hwMaps) return null;
	const pk = normalizePciBdfForMatch(pci);
	let r: VppHwSnapshot | null = hwMaps.byPci.get(pk) ?? null;
	if (!r) {
		for (const [k, v] of hwMaps.byPci) {
			if (normalizePciBdfForMatch(k) === pk) {
				r = v;
				break;
			}
		}
	}
	if (!r && vbrasName.trim()) {
		const nk = normalizeVppCliIfname(vbrasName);
		r = hwMaps.byName.get(nk) ?? hwMaps.byName.get(vbrasName.trim()) ?? null;
	}
	return r ?? null;
}

/**
 * 通过 vbras CLI `show interface address` 拉取各接口 L3 IPv4 与接口行状态（up/down 等）。
 * Socket 不可用或超时时返回空 Map，不抛错。
 */
export async function fetchVbrasInterfaceTelemetry(paths: VbrasCliPaths): Promise<Map<string, { state: string; ip: string }>> {
	const flat = new Map<string, { state: string; ip: string }>();
	try {
		if (process.platform === 'win32' && !paths.base) return flat;
		const raw = await runVbrasCli(paths, 'show interface address\n', 10000);
		const parsed = parseVbrasShowInterfaceAddress(raw);
		for (const [ifn, rec] of parsed) {
			const ip = rec.ips.length ? rec.ips.join(', ') : '-';
			const nk = normalizeVppCliIfname(ifn);
			flat.set(nk, { state: rec.state, ip });
			if (nk !== ifn.trim()) flat.set(ifn.trim(), { state: rec.state, ip });
		}
	} catch {
		// 忽略：无 cli.sock / 超时等
	}
	return flat;
}

function applyVbrasTelemetryToRow(
	vbras: Record<string, unknown>,
	vbrasName: string,
	tele: Map<string, { state: string; ip: string }> | null,
): Record<string, unknown> {
	if (!tele || !vbrasName.trim()) return vbras;
	const keys = [normalizeVppCliIfname(vbrasName), vbrasName.trim()].filter((k, i, a) => a.indexOf(k) === i);
	let t: { state: string; ip: string } | undefined;
	for (const k of keys) {
		t = tele.get(k);
		if (t) break;
	}
	if (!t) return vbras;
	const next: Record<string, unknown> = { ...vbras };
	if (t.state) next.state = t.state;
	if (typeof t.ip === 'string') {
		const ip = t.ip.trim();
		if (ip && ip !== '-') next.ip = ip;
	}
	return next;
}

type JsonObject = Record<string, unknown>;

/** 行级 mac：PCI 清单 / 旧配置优先，否则用 VPP hardware 的以太地址。 */
function pickRowMac(pciMac: string, hw: VppHwSnapshot | null): string {
	const m = pciMac.trim();
	if (m && m !== '-') return m;
	const eth = hw && typeof hw.ethernet_address === 'string' ? hw.ethernet_address.trim().toLowerCase() : '';
	return eth || '-';
}

/** 落盘 `os` / `vbras`：name/state/ip/speed_* /driver；不写 duplex、mtu、carrier、mac、vpp_hw。 */
function buildWriterOsVbras(
	os: Record<string, unknown>,
	vbras: Record<string, unknown>,
	hw: VppHwSnapshot | null,
): { os: Record<string, unknown>; vbras: Record<string, unknown> } {
	let osSp = typeof os.speed_mbps === 'number' && Number.isFinite(os.speed_mbps) && os.speed_mbps > 0 ? os.speed_mbps : null;
	let osGr = typeof os.speed_grade === 'string' && os.speed_grade.trim() ? os.speed_grade.trim() : 'unknown';
	if (osGr === 'unknown' && osSp != null) osGr = speedMbpsToGrade(osSp);
	// OS 口 down（已接管）时 sysfs 常读不到速率，回退 VPP hardware
	if ((osSp == null || osSp <= 0) && hw) {
		const fromHw = parseLinkSpeedToMbps(hw.link_speed);
		if (fromHw != null && fromHw > 0) {
			osSp = fromHw;
			if (osGr === 'unknown') osGr = speedMbpsToGrade(fromHw);
		}
	}
	const osDrv = typeof os.driver === 'string' ? os.driver : '';

	let vbSp =
		typeof vbras.speed_mbps === 'number' && Number.isFinite(vbras.speed_mbps) && vbras.speed_mbps > 0
			? vbras.speed_mbps
			: null;
	if (vbSp == null && hw) vbSp = parseLinkSpeedToMbps(hw.link_speed);
	let vbGr = typeof vbras.speed_grade === 'string' && vbras.speed_grade.trim() ? String(vbras.speed_grade).trim() : 'unknown';
	if (vbGr === 'unknown' && vbSp != null && vbSp > 0) vbGr = speedMbpsToGrade(vbSp);
	let vbDrv = typeof vbras.driver === 'string' ? vbras.driver : '';
	if (!vbDrv && hw && typeof hw.nic_model === 'string') vbDrv = hw.nic_model.trim();

	return {
		os: {
			name: typeof os.name === 'string' ? os.name : '',
			state: typeof os.state === 'string' && os.state.trim() ? os.state : '-',
			ip: typeof os.ip === 'string' && os.ip.trim() ? os.ip : '-',
			speed_mbps: osSp,
			speed_grade: osGr,
			driver: osDrv,
		},
		vbras: {
			name: typeof vbras.name === 'string' ? vbras.name : '',
			state: typeof vbras.state === 'string' && vbras.state.trim() ? vbras.state : '-',
			ip: typeof vbras.ip === 'string' && vbras.ip.trim() ? vbras.ip : '-',
			speed_mbps: vbSp,
			speed_grade: vbGr,
			driver: vbDrv,
		},
	};
}

export async function buildNicRolesSnapshot(params: {
	mode: InitMode;
	pcis: string[];
	attachPci: string[];
	existing?: JsonObject | null;
	pciDetails?: PciNic[] | null;
	/** 若传入，则在生成快照前拉取 vbras CLI 遥测并合并（`show interface address` + `show hardware-interface(s)`）。 */
	paths?: VbrasCliPaths | null;
}): Promise<{ roles: Record<string, unknown>[]; ts: number }> {
	let tele: Map<string, { state: string; ip: string }> | null = null;
	let hwMaps: { byPci: Map<string, VppHwSnapshot>; byName: Map<string, VppHwSnapshot> } | null = null;
	if (params.paths) {
		const r = await Promise.allSettled([fetchVbrasInterfaceTelemetry(params.paths), fetchVbrasHardwareTelemetry(params.paths)]);
		if (r[0].status === 'fulfilled') tele = r[0].value;
		if (r[1].status === 'fulfilled') hwMaps = r[1].value;
	}
	const { mode, pcis, attachPci, existing, pciDetails } = params;
	const osIpv4ByIf = readOsIpv4ByIf();
	const existingRoles = existing?.roles;
	const existingByPci = new Map<string, Record<string, unknown>>();
	if (Array.isArray(existingRoles)) {
		for (const r of existingRoles) {
			if (!r || typeof r !== 'object') continue;
			const pci = (r as Record<string, unknown>).pci;
			if (typeof pci === 'string' && pci.trim()) existingByPci.set(pci.trim(), r as Record<string, unknown>);
		}
	}

	const byPciDetail = new Map<string, PciNic>();
	for (const d of pciDetails ?? []) {
		if (!d?.pci) continue;
		byPciDetail.set(d.pci, d);
	}

	const roleForIndex = (idx: number): NicRole | null => {
		if (mode === 'static') {
			if (idx === 0) return 'mgmt';
			if (idx === 1) return 'wan';
			if (idx === 2) return 'lan';
			return null;
		}
		if (idx === 0) return 'wan';
		if (idx === 1) return 'lan';
		return null;
	};

	const roles: Record<string, unknown>[] = [];
	for (let i = 0; i < pcis.length; i++) {
		const pci = pcis[i];
		const role = roleForIndex(i);
		const old = existingByPci.get(pci);
		const attached = attachPci.includes(pci);
		const detail = byPciDetail.get(pci);
		const mac = (detail?.macs?.find((m) => m && m.trim()) ?? (typeof old?.mac === 'string' ? old.mac : '-') ?? '-').toString();
		const osName = (detail?.ifnames?.[0] ?? '').toString();
		let vbrasIfname = '';
		try {
			vbrasIfname = pciToVppCliIfname(pci);
		} catch {
			vbrasIfname = '';
		}
		const oldVbras = (old?.vbras && typeof old.vbras === 'object' ? (old.vbras as Record<string, unknown>) : null) as Record<string, unknown> | null;
		const oldOs = (old?.os && typeof old.os === 'object' ? (old.os as Record<string, unknown>) : null) as Record<string, unknown> | null;
		const existingVbrasName = typeof oldVbras?.name === 'string' ? normalizeVppCliIfname(String(oldVbras.name)) : '';
		const vbrasName = existingVbrasName || vbrasIfname;
		const resolvedOsName = (osName || (typeof oldOs?.name === 'string' ? String(oldOs.name) : '') || '').trim();
		const osMerged: Record<string, unknown> = { state: '-', ip: '-', ...(oldOs ?? {}), name: resolvedOsName };
		if (resolvedOsName) Object.assign(osMerged, readNetdevLinkSnapshot(resolvedOsName));
		if (resolvedOsName && osIpv4ByIf[resolvedOsName]) osMerged.ip = osIpv4ByIf[resolvedOsName];
		const hwRec = resolveVppHwRecord(hwMaps, pci, vbrasName);
		const hwUseful =
			hwRec &&
			(hwRec.pci_address ||
				hwRec.link_speed ||
				hwRec.ethernet_address ||
				typeof hwRec.rx_frames_ok === 'number' ||
				typeof hwRec.tx_frames_ok === 'number');
		const hwSnap: VppHwSnapshot | null = hwUseful && hwRec ? ({ ...hwRec } as VppHwSnapshot) : null;
		const vbrasCore: Record<string, unknown> = { ...(oldVbras ?? { state: '-', ip: '-' }), ...(vbrasName ? { name: vbrasName } : {}) };
		const vbrasMerged = applyVbrasTelemetryToRow(vbrasCore, vbrasName, tele);

		const rowMacOut = pickRowMac((mac || '-').toString(), hwSnap);
		const { os: osOut, vbras: vbrasOut } = buildWriterOsVbras(osMerged, vbrasMerged, hwSnap);

		const item: Record<string, unknown> = {
			name: `interface_${i + 1}`,
			pci,
			mac: rowMacOut || '-',
			attached,
			os: osOut,
			vbras: vbrasOut,
		};
		if (role) item.role = role;
		roles.push({
			...item,
		});
	}

	return { roles, ts: Math.floor(Date.now() / 1000) };
}
