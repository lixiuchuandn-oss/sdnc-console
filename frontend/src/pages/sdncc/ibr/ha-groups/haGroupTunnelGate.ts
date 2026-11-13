/**
 * HA 组成员 vs SRv6 隧道端点：与后端 haGroupTunnelGate 语义对齐（前端预检/提示）。
 */

export type Srv6TunnelEndpointLite = {
	id: string;
	name: string;
	peA?: string | null;
	peB?: string | null;
	ceA?: string | null;
	ceB?: string | null;
};

const norm = (v: unknown) => String(v ?? '').trim();

export function findOppositeCePairTunnelNames(
	tunnels: Srv6TunnelEndpointLite[],
	uuidA: string,
	uuidB: string,
): string[] {
	const a = norm(uuidA);
	const b = norm(uuidB);
	if (!a || !b || a === b) return [];
	const names: string[] = [];
	for (const t of tunnels) {
		const ceA = norm(t.ceA);
		const ceB = norm(t.ceB);
		if ((ceA === a && ceB === b) || (ceA === b && ceB === a)) {
			names.push(String(t.name || t.id));
		}
	}
	return [...new Set(names)];
}

function slotsOf(t: Srv6TunnelEndpointLite, uuid: string): string[] {
	const id = norm(uuid);
	if (!id) return [];
	const slots: string[] = [];
	if (norm(t.peA) === id) slots.push('PE-A');
	if (norm(t.peB) === id) slots.push('PE-B');
	if (norm(t.ceA) === id) slots.push('CE-A');
	if (norm(t.ceB) === id) slots.push('CE-B');
	return slots;
}

export function buildHaMemberTunnelEndpointWarnings(
	tunnels: Srv6TunnelEndpointLite[],
	primaryUuid: string,
	backupUuid: string,
): string[] {
	const warnings: string[] = [];
	for (const role of [
		{ label: '主节点', uuid: primaryUuid },
		{ label: '备节点', uuid: backupUuid },
	]) {
		const hits: string[] = [];
		for (const t of tunnels) {
			const slots = slotsOf(t, role.uuid);
			if (!slots.length) continue;
			hits.push(`「${t.name || t.id}」${slots.join('/')}`);
		}
		if (!hits.length) continue;
		warnings.push(
			`${role.label}已被 SRv6 隧道引用（${hits.join('、')}）。建组不会改隧道端点。`,
		);
	}
	return warnings;
}

export function evaluateHaMembersAgainstTunnels(
	tunnels: Srv6TunnelEndpointLite[],
	primaryUuid: string,
	backupUuid: string,
): { hardError: string | null; warnings: string[] } {
	const opposite = findOppositeCePairTunnelNames(tunnels, primaryUuid, backupUuid);
	if (opposite.length) {
		return {
			hardError: `主备不能是同一条 SRv6 隧道的两端 CE（${opposite.join('、')}）。对端两台请分别建组，或先调整隧道端点。`,
			warnings: [],
		};
	}
	return {
		hardError: null,
		warnings: buildHaMemberTunnelEndpointWarnings(tunnels, primaryUuid, backupUuid),
	};
}
