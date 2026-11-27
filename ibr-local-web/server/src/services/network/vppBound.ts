/**
 * vpp_bound 判定（P1）：正交于 paas_attach（os_nic_attach_pci）。
 * 免重启（P0）：仅当目标口已在 VPP dataplane（hardware）且不在 OS；vfio 但 hardware 暂空仍重启。
 * 见 docs/nic-role-and-vpp-bind.md §3.5 / §3.6
 */
import { fetchVbrasHardwareTelemetry, normalizePciBdfForMatch } from '../../nicRolesSnapshot.js';
import type { Paths, PciNic } from '../../vrwizard.js';
import { normalizePciId, readPciDriver } from './nicIdentity.js';

export type VppBoundReason = 'vfio-pci' | 'hardware' | 'unbound';

export type VppBoundProbe = {
	pci: string;
	/** 展示：vfio 或 hardware（不是免重启条件） */
	bound: boolean;
	/** show hardware-interfaces 能解析到该 PCI */
	in_dataplane: boolean;
	/** 仍有内核 netdev 且 driver ≠ vfio-pci */
	os_resident: boolean;
	driver: string;
	reason: VppBoundReason;
};

/** 禁止仅凭 nic_roles.vbras.name 判定（假阳性）。 */
export function isVppBoundByDriver(pci: string): boolean {
	return readPciDriver(pci).toLowerCase() === 'vfio-pci';
}

export function isVppBoundByHardware(pci: string, hwPciSet: Set<string> | null | undefined): boolean {
	const p = normalizePciBdfForMatch(normalizePciId(pci));
	if (!p || !hwPciSet || hwPciSet.size === 0) return false;
	return hwPciSet.has(p);
}

export function isVppBound(pci: string, hwPciSet?: Set<string> | null): boolean {
	if (isVppBoundByDriver(pci)) return true;
	return isVppBoundByHardware(pci, hwPciSet);
}

export function classifyVppBound(params: {
	pci: string;
	driver: string;
	ifnames?: string[] | null;
	hwPciSet: Set<string> | null | undefined;
}): VppBoundProbe {
	const pci = normalizePciId(params.pci);
	const driver = typeof params.driver === 'string' ? params.driver : '';
	const drv = driver.toLowerCase();
	const ifnames = Array.isArray(params.ifnames) ? params.ifnames.filter(Boolean) : [];
	const os_resident = drv !== 'vfio-pci' && ifnames.length > 0;
	const in_dataplane = isVppBoundByHardware(pci, params.hwPciSet);
	const vfio = drv === 'vfio-pci';
	const bound = vfio || in_dataplane;
	let reason: VppBoundReason = 'unbound';
	if (vfio) reason = 'vfio-pci';
	else if (in_dataplane) reason = 'hardware';
	return { pci, bound, in_dataplane, os_resident, driver, reason };
}

export async function loadHardwarePciSet(paths: Paths): Promise<Set<string>> {
	try {
		const hw = await fetchVbrasHardwareTelemetry(paths);
		return new Set(Array.from(hw.byPci.keys()).map((k) => normalizePciBdfForMatch(k)));
	} catch {
		return new Set();
	}
}

export async function probeVppBound(
	paths: Paths,
	pcis: string[],
	pciNics?: PciNic[] | null,
): Promise<{
	probes: VppBoundProbe[];
	hwPciSet: Set<string>;
	allBound: boolean;
	unbound: string[];
}> {
	const uniq = Array.from(new Set(pcis.map(normalizePciId).filter(Boolean)));
	const hwPciSet = await loadHardwarePciSet(paths);
	const ifnamesByPci = new Map<string, string[]>();
	for (const d of pciNics ?? []) {
		const pci = normalizePciId(d?.pci);
		if (!pci) continue;
		ifnamesByPci.set(pci, Array.isArray(d.ifnames) ? d.ifnames.filter(Boolean) : []);
	}
	const probes: VppBoundProbe[] = uniq.map((pci) =>
		classifyVppBound({
			pci,
			driver: readPciDriver(pci),
			ifnames: ifnamesByPci.get(pci) ?? [],
			hwPciSet,
		}),
	);
	const unbound = probes.filter((p) => !p.bound).map((p) => p.pci);
	return { probes, hwPciSet, allBound: unbound.length === 0 && probes.length > 0, unbound };
}

/**
 * 进入 VPP / 登记：免重启仅当目标口已在 dataplane 且不在 OS。
 * vfio 但 hardware 暂空 → 重启（假阴性可接受）。仍有 netdev → 必须重启。
 */
export function requiresRestartToEnterVpp(probes: VppBoundProbe[]): boolean {
	if (probes.length === 0) return false;
	return probes.some((p) => p.os_resident || !p.in_dataplane);
}

export function formatVppBoundProbeLine(p: VppBoundProbe): string {
	const drv = p.driver || '-';
	if (p.os_resident) return `${p.pci}: 仍在 OS（driver=${drv}），需重启才能进入 VPP`;
	if (!p.in_dataplane) return `${p.pci}: driver=${drv}，未出现在 VPP hardware，需重启`;
	return `${p.pci}: 已在 VPP 数据面且不在 OS，免重启`;
}

export function appendVppBoundRestartNote(note: string, probes: VppBoundProbe[]): string {
	if (probes.length === 0) return note;
	return `${note}\n${probes.map(formatVppBoundProbeLine).join('\n')}`;
}

/** 管理口若已 vpp_bound：告警文案（不自动纠偏身份）。 */
export function mgmtVppBoundWarning(mgmtPci: string | null | undefined, probes: VppBoundProbe[]): string | null {
	const m = normalizePciId(mgmtPci);
	if (!m) return null;
	const hit = probes.find((p) => p.pci === m && p.bound);
	if (!hit) return null;
	return `警告: 管理口 ${m} 当前为 vpp_bound（${hit.reason}），本期约束要求管理口留在 OS`;
}
