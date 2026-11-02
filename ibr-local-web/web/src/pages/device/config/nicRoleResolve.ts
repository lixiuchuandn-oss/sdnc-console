/** 与 status 身份字段一致：WAN/LAN 只认 state 投影的 wan_pci/lan_pci，禁止 PCI 下标。 */

export type PciNicBrief = { pci?: string; ifnames?: string[]; macs?: string[] };

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
	os?: { speed_grade?: string; speed_mbps?: number | null };
	vbras?: { ip?: string; speed_grade?: string; speed_mbps?: number | null };
};

/** 按 PCI 查找 nic_roles 行（勿用数组下标，顺序可能与 sysfs 枚举不一致） */
export function findNicRoleByPci(roles: NicRoleRowLike[] | null | undefined, pci: string): NicRoleRowLike | undefined {
	const p = pci.trim();
	if (!p) return undefined;
	return (roles ?? []).find((r) => String(r?.pci ?? '').trim() === p);
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
