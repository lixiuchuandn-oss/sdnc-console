/**
 * 解析 FRR/clish `show bgp summary` 多段输出（与 ibr-local-web parseBgpSummaryNeighbors 对齐）。
 * 设备侧旧版 local-web 若只返回扁平 neighbors，Console 可用 raw 本地重解析。
 */
import type { IbrBgpNeighborRow } from '../../../../../../services/ibrDeviceOpsApi';

const NEIGHBOR_ADDR_RE = /^(?:\d{1,3}(?:\.\d{1,3}){3}|[0-9a-f:]+)$/i;
const SECTION_RE =
	/^(IPv[46]\s+(?:Unicast|VPN|Multicast|Labeled-Unicast)\s+Summary)\s+\(VRF\s+([^)]+)\):\s*$/i;

function parseBgpSummaryNeighbors(raw: string): IbrBgpNeighborRow[] {
	const neighbors: IbrBgpNeighborRow[] = [];
	let vrf = 'default';
	let afi = 'ipv4-unicast';
	let section = 'IPv4 Unicast Summary (VRF default)';

	for (const line of raw.split(/\r?\n/)) {
		const t = line.trim();
		if (!t) continue;

		const sec = SECTION_RE.exec(t);
		if (sec) {
			const title = (sec[1] || '').replace(/\s+/g, ' ');
			vrf = (sec[2] || 'default').trim();
			const lower = title.toLowerCase();
			if (lower.includes('vpn')) afi = lower.startsWith('ipv6') ? 'ipv6-vpn' : 'ipv4-vpn';
			else if (lower.includes('multicast')) afi = lower.startsWith('ipv6') ? 'ipv6-multicast' : 'ipv4-multicast';
			else if (lower.includes('labeled')) afi = lower.startsWith('ipv6') ? 'ipv6-labeled' : 'ipv4-labeled';
			else afi = lower.startsWith('ipv6') ? 'ipv6-unicast' : 'ipv4-unicast';
			section = `${title} (VRF ${vrf})`;
			continue;
		}

		if (/^Neighbor\b/i.test(t) || /^BGP\b/i.test(t) || /^Total number of neighbors/i.test(t)) continue;
		if (/^RIB entries\b/i.test(t) || /^Peers\b/i.test(t) || /^BGP table version\b/i.test(t)) continue;

		const parts = t.split(/\s+/);
		if (parts.length < 10 || !NEIGHBOR_ADDR_RE.test(parts[0]!)) continue;

		const neighbor = parts[0]!;
		const col9 = parts[9] ?? '';
		const numericPfx = /^\d+$/.test(col9);

		neighbors.push({
			id: `${vrf}|${afi}|${neighbor}`,
			neighbor,
			v: parts[1] ?? '',
			as: parts[2] ?? '',
			msg_rcvd: parts[3] ?? '',
			msg_sent: parts[4] ?? '',
			up_down: parts[8] ?? '',
			state: numericPfx ? 'Established' : col9,
			pfx_rcd: numericPfx ? col9 : '',
			pfx_snt: numericPfx ? (parts[10] ?? '') : (parts[10] ?? ''),
			desc: numericPfx ? (parts[11] ?? '') : (parts.slice(11).join(' ') || parts[11] || ''),
			vrf,
			afi,
			section,
		});
	}
	return neighbors;
}

/** 旧版 API 无 vrf/afi 时，优先用 raw 重解析 */
export function normalizeBgpSummaryNeighbors(
	raw: string | undefined,
	neighbors: IbrBgpNeighborRow[] | undefined,
): IbrBgpNeighborRow[] {
	const rawText = typeof raw === 'string' ? raw : '';
	const fromApi = Array.isArray(neighbors) ? neighbors : [];
	const needsReparsee =
		rawText.includes('Summary (VRF') &&
		(fromApi.length === 0 || fromApi.some((n) => !n.vrf || !n.afi || /\d+\s+\d+\s+N\/A/i.test(String(n.state || ''))));

	if (needsReparsee) {
		const parsed = parseBgpSummaryNeighbors(rawText);
		if (parsed.length) return parsed;
	}
	return fromApi;
}
