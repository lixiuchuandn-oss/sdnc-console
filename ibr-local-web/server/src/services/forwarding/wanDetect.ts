/**
 * 与 vrlocalctl _detect_wan_vpp_ifname 一致：按 state.wan_pci 找 nic_roles 同行取 VPP 接口名。
 */
import type { JsonObject, Paths } from '../../vrwizard.js';
import { loadState, readNicRolesConf } from '../../vrwizard.js';
import { readNicIdentity } from '../network/nicIdentity.js';

export function detectWanVppIfname(paths: Paths): string {
	try {
		const state = loadState(paths);
		const identity = readNicIdentity(state);
		const wanPci = identity.wanPci;
		if (!wanPci) return '';

		const nicRoles = readNicRolesConf(paths) as JsonObject | null;
		const roles = extractRolesArray(nicRoles);
		const r = roles.find((row) => {
			if (!row || typeof row !== 'object') return false;
			const pci = typeof (row as Record<string, unknown>).pci === 'string'
				? String((row as Record<string, unknown>).pci).trim()
				: '';
			return pci === wanPci;
		}) as Record<string, unknown> | undefined;
		if (!r) return '';

		const vbras = (r.vbras as Record<string, unknown> | undefined) ?? {};
		const name = typeof vbras.name === 'string' ? vbras.name.trim() : '';
		if (name) return name;

		const os = (r.os as Record<string, unknown> | undefined) ?? {};
		const osName = typeof os.name === 'string' ? os.name.trim() : '';
		return osName;
	} catch {
		return '';
	}
}

function extractRolesArray(nicRoles: JsonObject | null): unknown[] {
	if (!nicRoles) return [];
	const roles = nicRoles.roles;
	if (Array.isArray(roles)) return roles;
	return [];
}
