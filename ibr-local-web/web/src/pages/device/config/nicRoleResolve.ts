/** 与 status 身份字段一致：WAN/LAN 只认 state 投影的 wan_pci/lan_pci，禁止 PCI 下标。 */

export type PciNicBrief = {
	pci?: string;
	ifnames?: string[];
	macs?: string[];
	driver?: string;
	vpp_ifname?: string;
};

export function resolveWanLanPci(params: {
	wanPci?: string | null;
	lanPci?: string | null;
}): { wanPci: string; lanPci: string } {
	return {
		wanPci: String(params.wanPci ?? '').trim(),
		lanPci: String(params.lanPci ?? '').trim(),
	};
}

export type NicRoleRowLike = {
	pci?: string;
	role?: string;
	attached?: boolean;
	mac?: string;
	os?: { name?: string; speed_grade?: string; speed_mbps?: number | null };
	vbras?: { name?: string; ip?: string; speed_grade?: string; speed_mbps?: number | null };
};

/** 按 PCI 查找 nic_roles 行（勿用数组下标，顺序可能与 sysfs 枚举不一致） */
export function findNicRoleByPci(roles: NicRoleRowLike[] | null | undefined, pci: string): NicRoleRowLike | undefined {
	const p = pci.trim();
	if (!p) return undefined;
	return (roles ?? []).find((r) => String(r?.pci ?? '').trim() === p);
}

/** 与 VPP `show interface` / vbras CLI 一致：GigabitEthernet2/2/0（无空格）。 */
export function pciToVbrasIfname(pci: string): string {
	const m = /^([0-9a-fA-F]{4}):([0-9a-fA-F]{2}):([0-9a-fA-F]{2})\.([0-7])$/.exec(pci.trim());
	if (!m) return '';
	const bus = Number.parseInt(m[2], 16);
	const dev = Number.parseInt(m[3], 16);
	const fn = Number.parseInt(m[4], 10);
	return `GigabitEthernet${bus}/${dev}/${fn}`;
}

function firstNonEmptyToken(xs: unknown[] | undefined): string {
	if (!Array.isArray(xs)) return '';
	for (const x of xs) {
		const s = String(x ?? '').trim();
		if (s && s !== '-') return s;
	}
	return '';
}

/**
 * 初始化/扩容下拉标签：优先内核网卡名，其次上次 OS 名，再次 VPP 口名，并拼接 PCI、MAC。
 * 已被 VPP 接管的口没有 ens*，用 GigabitEthernetB/D/F 识别。
 */
export function formatPciNicSelectLabel(nic: PciNicBrief | null | undefined, role?: NicRoleRowLike | null): string {
	const pci = String(nic?.pci ?? '').trim();
	const liveIf = firstNonEmptyToken(nic?.ifnames);
	const lastOs = String(role?.os?.name ?? '').trim();
	const vpp = String(nic?.vpp_ifname ?? '').trim() || (pci ? pciToVbrasIfname(pci) : '');
	const mac = firstNonEmptyToken(nic?.macs) || String(role?.mac ?? '').trim();
	const macClean = mac && mac !== '-' ? mac : '';
	const name = liveIf || lastOs || vpp;
	const parts: string[] = [];
	if (name) parts.push(name);
	if (pci) parts.push(pci);
	if (macClean) parts.push(macClean);
	return parts.join(' · ') || pci;
}

/** 初始化/扩容候选：排除管理口与已纳入业务清单的 PCI。 */
export function buildUnattachedPciSelectOptions(params: {
	pciNics: PciNicBrief[] | null | undefined;
	mgmtPci: string | null | undefined;
	attachedPcis: string[] | null | undefined;
	roles?: NicRoleRowLike[] | null;
}): { label: string; value: string }[] {
	const attached = new Set((params.attachedPcis ?? []).map((x) => String(x).trim()).filter(Boolean));
	const mgmt = String(params.mgmtPci ?? '').trim();
	const out: { label: string; value: string }[] = [];
	for (const n of params.pciNics ?? []) {
		const pci = String(n?.pci ?? '').trim();
		if (!pci || pci === mgmt || attached.has(pci)) continue;
		out.push({
			value: pci,
			label: formatPciNicSelectLabel(n, findNicRoleByPci(params.roles, pci)),
		});
	}
	return out;
}

export function normalizeIp(s: unknown) {
	const t = typeof s === 'string' ? s.trim() : '';
	if (!t || t === '-') return '';
	return t;
}

/** 与仪表板 net_overview 对齐：优先展示 IP，再 nic_roles，再 last_apply */
export function resolveNicDisplayIp(
	netOverviewIp: unknown,
	vbrasConfIp: unknown,
	lastApplyIp?: unknown,
): string {
	return normalizeIp(netOverviewIp) || normalizeIp(vbrasConfIp) || normalizeIp(lastApplyIp);
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
