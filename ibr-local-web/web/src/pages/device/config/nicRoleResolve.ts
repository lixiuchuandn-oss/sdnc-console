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
	vbras?: { name?: string; ip?: string; ipv6?: string; speed_grade?: string; speed_mbps?: number | null };
};

/** 按 PCI 查找 nic_roles 行（勿用数组下标，顺序可能与 sysfs 枚举不一致） */
export function findNicRoleByPci(roles: NicRoleRowLike[] | null | undefined, pci: string): NicRoleRowLike | undefined {
	const p = pci.trim();
	if (!p) return undefined;
	return (roles ?? []).find((r) => String(r?.pci ?? '').trim() === p);
}

/**
 * 与 VPP `show interface` / vbras CLI 一致：GigabitEthernet2/2/0（无空格）。
 * 槽位为十六进制无前导零：`0000:00:0a.0` → `GigabitEthernet0/a/0`（不是 `0/10/0`）。
 */
export function pciToVbrasIfname(pci: string): string {
	const m = /^([0-9a-fA-F]{4}):([0-9a-fA-F]{2}):([0-9a-fA-F]{2})\.([0-7])$/.exec(pci.trim());
	if (!m) return '';
	const bus = Number.parseInt(m[2], 16).toString(16);
	const dev = Number.parseInt(m[3], 16).toString(16);
	const fn = Number.parseInt(m[4], 10).toString(16);
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
 * 初始化/扩容下拉标签：有内核网卡名用 ens*；已被 VPP 接管（无 ens*）用 CLISH/VPP 口名，
 * 不要回落到历史 OS 名（否则 WAN/LAN 会仍显示 ens7 而辅助口显示 GigabitEthernet…）。
 */
export function formatPciNicSelectLabel(nic: PciNicBrief | null | undefined, role?: NicRoleRowLike | null): string {
	const pci = String(nic?.pci ?? '').trim();
	const liveIf = firstNonEmptyToken(nic?.ifnames);
	const lastOs = String(role?.os?.name ?? '').trim();
	const vbrasName = String(role?.vbras?.name ?? '').trim();
	const vpp =
		String(nic?.vpp_ifname ?? '').trim() ||
		vbrasName ||
		(pci ? pciToVbrasIfname(pci) : '');
	const mac = firstNonEmptyToken(nic?.macs) || String(role?.mac ?? '').trim();
	const macClean = mac && mac !== '-' ? mac : '';
	const name = liveIf || vpp || lastOs;
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

function isIpv6LinkLocalToken(p: string): boolean {
	const addr = p.split('/')[0]?.toLowerCase() ?? '';
	return addr === 'fe80' || addr.startsWith('fe80:');
}

export function splitIpFamilies(field: unknown): { v4: string; v6: string } {
	const raw = normalizeIp(field);
	if (!raw) return { v4: '', v6: '' };
	const parts = raw
		.split(/[,\s]+/)
		.map((s) => s.trim())
		.filter(Boolean);
	const v4 = parts.filter((p) => p.includes('.') && !p.includes(':')).join(', ');
	const v6 = parts.filter((p) => p.includes(':') && !isIpv6LinkLocalToken(p)).join(', ');
	return { v4, v6 };
}

export function resolveNicDisplayIpByFamily(family: 'v4' | 'v6', ...sources: unknown[]): string {
	for (const s of sources) {
		const split = splitIpFamilies(s);
		const v = family === 'v4' ? split.v4 : split.v6;
		if (v) return v.split(',')[0]!.trim();
	}
	return '';
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
