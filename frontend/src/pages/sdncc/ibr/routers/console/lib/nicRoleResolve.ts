/** 与 ibr-local-web statusRoute / netApply 一致的 WAN/LAN PCI 下标映射 */
export function wanLanPciIndices(initMode: 'static' | 'dhcp') {
	return initMode === 'static' ? { wan: 1, lan: 2 } : { wan: 0, lan: 1 };
}

export type PciNicBrief = { pci?: string; ifnames?: string[]; macs?: string[] };

export function resolveWanLanPci(
	initMode: 'static' | 'dhcp',
	pciNics: PciNicBrief[] | null | undefined,
): { wanPci: string; lanPci: string } {
	const idx = wanLanPciIndices(initMode);
	const list = Array.isArray(pciNics) ? pciNics : [];
	return {
		wanPci: String(list[idx.wan]?.pci ?? '').trim(),
		lanPci: String(list[idx.lan]?.pci ?? '').trim(),
	};
}

export type NicRoleRowLike = {
	pci?: string;
	role?: string;
	attached?: boolean;
	os?: { speed_grade?: string; speed_mbps?: number | null; name?: string; ip?: string; state?: string };
	vbras?: {
		ip?: string;
		speed_grade?: string;
		speed_mbps?: number | null;
		name?: string;
		state?: string;
		gateway?: string | null;
	};
};

export function findNicRoleByPci(
	roles: NicRoleRowLike[] | null | undefined,
	pci: string,
): NicRoleRowLike | undefined {
	const p = pci.trim();
	if (!p) return undefined;
	return (roles ?? []).find((r) => String(r?.pci ?? '').trim() === p);
}

export function normalizeIp(s: unknown) {
	const t = typeof s === 'string' ? s.trim() : '';
	if (!t || t === '-') return '';
	return t;
}

export function resolveNicDisplayIp(
	netOverviewIp: unknown,
	vbrasConfIp: unknown,
	lastApplyIp?: unknown,
): string {
	return normalizeIp(netOverviewIp) || normalizeIp(vbrasConfIp) || normalizeIp(lastApplyIp);
}

/** 与 VPP show interface / vbras CLI 一致：GigabitEthernet2/2/0（无空格）。 */
export function pciToVbrasIfname(pci: string) {
	const m = /^([0-9a-fA-F]{4}):([0-9a-fA-F]{2}):([0-9a-fA-F]{2})\.([0-7])$/.exec(pci.trim());
	if (!m) return '';
	const bus = Number.parseInt(m[2], 16);
	const dev = Number.parseInt(m[3], 16);
	const fn = Number.parseInt(m[4], 10);
	return `GigabitEthernet${bus}/${dev}/${fn}`;
}

type NicSpeedSide = { speed_grade?: string; speed_mbps?: number | null };

function resolveNicSpeedLabel(
	side: NicSpeedSide | null | undefined,
	fallback?: { speed_grade?: string; speed_mbps?: number | null; rate?: string },
): string {
	if (side?.speed_grade && side.speed_grade !== 'unknown') return side.speed_grade;
	if (typeof side?.speed_mbps === 'number' && side.speed_mbps > 0) return `${side.speed_mbps} Mb/s`;
	if (fallback?.speed_grade && fallback.speed_grade !== 'unknown') return fallback.speed_grade;
	if (typeof fallback?.speed_mbps === 'number' && fallback.speed_mbps > 0) return `${fallback.speed_mbps} Mb/s`;
	if (fallback?.rate && fallback.rate !== '-') return fallback.rate;
	return '';
}

/** 仪表板网卡快照一行：PCI + 速率（优先 nic_roles，回退实时 link） */
export function formatNicSnapshotLine(params: {
	pci?: string;
	isVpp: boolean;
	roles?: NicRoleRowLike[] | null;
	link?: NicSpeedSide;
	rate?: string;
}): string {
	const bits: string[] = [];
	if (params.pci) bits.push(`PCI ${params.pci}`);
	const row = findNicRoleByPci(params.roles, params.pci ?? '');
	const side = params.isVpp ? row?.vbras : row?.os;
	const speed = resolveNicSpeedLabel(side, { ...params.link, rate: params.rate });
	if (speed) bits.push(speed);
	return bits.join(' · ');
}
