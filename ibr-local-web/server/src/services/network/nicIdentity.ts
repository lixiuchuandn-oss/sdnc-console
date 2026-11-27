/**
 * 网卡身份（mgmt/wan/lan）权威在 state.json；禁止用全量 PCI / roles 下标识别。
 * 见 docs/nic-role-and-vpp-bind.md
 */
import fs from 'node:fs';
import path from 'node:path';
import type { JsonObject, PciNic } from '../../vrwizard.js';

export type NicIdentity = {
	mgmtPci: string | null;
	wanPci: string | null;
	lanPci: string | null;
};

function exists(p: string): boolean {
	try {
		return fs.existsSync(p);
	} catch {
		return false;
	}
}

export function normalizePciId(v: unknown): string {
	return typeof v === 'string' ? v.trim() : '';
}

/** sysfs：PCI 网卡驱动名（如 virtio-pci / vfio-pci）。 */
export function readPciDriver(pci: string): string {
	const p = normalizePciId(pci);
	if (!p || process.platform === 'win32') return '';
	const link = path.posix.join('/sys/bus/pci/devices', p, 'driver');
	try {
		if (!exists(link)) return '';
		return path.basename(fs.realpathSync(link));
	} catch {
		return '';
	}
}

/**
 * 仍在 OS 的物理以太网 PCI：有内核 netdev，且 driver ≠ vfio-pci。
 * 用于 mgmt 空值默认（不是全量 pcis[0]）。
 */
export function listOsPhysicalEthernetPcis(pciNics: PciNic[]): string[] {
	const out: string[] = [];
	for (const d of pciNics) {
		const pci = normalizePciId(d?.pci);
		if (!pci) continue;
		const ifnames = Array.isArray(d.ifnames) ? d.ifnames.filter(Boolean) : [];
		if (ifnames.length === 0) continue;
		const drv = readPciDriver(pci).toLowerCase();
		if (drv === 'vfio-pci') continue;
		out.push(pci);
	}
	out.sort((a, b) => a.localeCompare(b));
	return out;
}

export function defaultMgmtPciFromOs(pciNics: PciNic[]): string | null {
	const osPhys = listOsPhysicalEthernetPcis(pciNics);
	return osPhys[0] ?? null;
}

export function readNicIdentity(state: JsonObject | Record<string, unknown> | null | undefined): NicIdentity {
	const s = (state && typeof state === 'object' ? state : {}) as Record<string, unknown>;
	return {
		mgmtPci: normalizePciId(s.mgmt_pci) || null,
		wanPci: normalizePciId(s.wan_pci) || null,
		lanPci: normalizePciId(s.lan_pci) || null,
	};
}

/** mgmt 空则按 OS 物理口第一块写入 state（调用方负责 saveState）。 */
export function ensureMgmtPciInState(
	state: Record<string, unknown>,
	pciNics: PciNic[],
): { mgmtPci: string | null; filled: boolean } {
	const cur = normalizePciId(state.mgmt_pci);
	if (cur) return { mgmtPci: cur, filled: false };
	const def = defaultMgmtPciFromOs(pciNics);
	if (def) state.mgmt_pci = def;
	return { mgmtPci: def, filled: Boolean(def) };
}

export function writeWanLanAttachToState(
	state: Record<string, unknown>,
	params: { wanPci: string | null; lanPci: string | null; attachPci: string[] },
): void {
	state.wan_pci = params.wanPci || null;
	state.lan_pci = params.lanPci || null;
	state.os_nic_attach_pci = params.attachPci;
}

export function hasStaticWanLanIdentity(id: NicIdentity): boolean {
	return Boolean(id.wanPci && id.lanPci);
}

/** 辅助口操作前：身份未写入则拒绝（禁止用 attach/roles 下标猜保护口）。 */
export function assertAuxOpsIdentity(params: {
	initMode: 'static' | 'dhcp';
	identity: NicIdentity;
}): { ok: true } | { ok: false; error: string } {
	if (!params.identity.wanPci && !params.identity.lanPci) {
		return {
			ok: false,
			error: '请先完成网卡初始化（写入 WAN/LAN 身份）后再管理辅助口',
		};
	}
	if (params.initMode === 'static' && (!params.identity.wanPci || !params.identity.lanPci)) {
		return {
			ok: false,
			error: '请先完成网卡初始化（写入 WAN/LAN 身份）后再管理辅助口',
		};
	}
	return { ok: true };
}

export function roleForPci(pci: string, id: NicIdentity): 'mgmt' | 'wan' | 'lan' | null {
	const p = normalizePciId(pci);
	if (!p) return null;
	if (id.mgmtPci && p === id.mgmtPci) return 'mgmt';
	if (id.wanPci && p === id.wanPci) return 'wan';
	if (id.lanPci && p === id.lanPci) return 'lan';
	return null;
}

export function resolveProtectedFromIdentity(id: NicIdentity): string[] {
	return Array.from(new Set([id.wanPci, id.lanPci].filter((x): x is string => Boolean(x))));
}

/** attach 中非 wan/lan/mgmt 的辅助口（顺序保持 attach）。 */
export function resolveExtraAttachPcis(attachPci: string[], id: NicIdentity): string[] {
	const skip = new Set(
		[id.mgmtPci, id.wanPci, id.lanPci].filter((x): x is string => Boolean(x)),
	);
	return attachPci.map(normalizePciId).filter((p) => p && !skip.has(p));
}

/** 仍绑在 vfio（数据面侧）的 PCI；纯 OS 口（virtio/ixgbe 等）不含。 */
export function listVfioBoundPcis(pciNics: PciNic[]): string[] {
	const out: string[] = [];
	for (const d of pciNics) {
		const pci = normalizePciId(d?.pci);
		if (!pci) continue;
		if (readPciDriver(pci).toLowerCase() === 'vfio-pci') out.push(pci);
	}
	return out;
}

/**
 * 再次初始化时释放集合：
 * - 上次 attach / 上次 WAN·LAN 身份中未再选入的口（降级/换口）
 * - 仍为 vfio 绑定、且本次未选入的口（出厂勾了退回 OS 失败、或未退回 OS 时的数据面残留）
 * 纯 OS 闲置口（如出厂成功后的 03.1）不在上述集合中，不得写成「将释放」。
 */
export function resolveInitReleasePcis(params: {
	prevAttachPci: string[];
	prevIdentityPci?: string[];
	dataplaneCandidatePcis?: string[];
	mgmtPci: string | null;
	newAttachPci: string[];
}): string[] {
	const keep = new Set(params.newAttachPci.map(normalizePciId).filter(Boolean));
	const mgmt = normalizePciId(params.mgmtPci);
	if (mgmt) keep.add(mgmt);
	const seen = new Set<string>();
	const out: string[] = [];
	const candidates = [
		...(params.prevAttachPci ?? []),
		...(params.prevIdentityPci ?? []),
		...(params.dataplaneCandidatePcis ?? []),
	];
	for (const raw of candidates) {
		const p = normalizePciId(raw);
		if (!p || keep.has(p) || seen.has(p)) continue;
		seen.add(p);
		out.push(p);
	}
	return out;
}

export function readWanLanFromSelection(
	selection?: Array<{ pci?: string; role?: string }> | null,
): { wanPci: string | null; lanPci: string | null } {
	let wanPci: string | null = null;
	let lanPci: string | null = null;
	for (const s of selection ?? []) {
		if (!s || typeof s !== 'object') continue;
		const pci = normalizePciId(s.pci);
		if (!pci) continue;
		if (s.role === 'wan' && !wanPci) wanPci = pci;
		if (s.role === 'lan' && !lanPci) lanPci = pci;
	}
	return { wanPci, lanPci };
}

/** static / 显式 selection 取 wan/lan；dhcp 未选口时才按 attach 序回落（文档 §3.4）。 */
export function deriveWanLanForInit(params: {
	mode: 'static' | 'dhcp';
	selection?: Array<{ pci?: string; role?: string }> | null;
	attachPci: string[];
}): { wanPci: string | null; lanPci: string | null } {
	const fromSel = readWanLanFromSelection(params.selection);
	if (params.mode === 'static' || fromSel.wanPci || fromSel.lanPci) return fromSel;
	const biz = params.attachPci.map(normalizePciId).filter(Boolean);
	return { wanPci: biz[0] ?? null, lanPci: biz[1] ?? null };
}
