/**
 * 与 vrlocalctl _detect_wan_vpp_ifname 一致：nic_roles + init_mode 推导 WAN 的 VPP 接口名。
 */
import type { JsonObject, Paths } from '../../vrwizard.js';
import { loadState, readNicRolesConf, normalizeInitMode } from '../../vrwizard.js';

export function detectWanVppIfname(paths: Paths): string {
	try {
		const state = loadState(paths);
		const initMode = normalizeInitMode(state.init_mode);
		const isDhcp = initMode === 'dhcp';

		const nicRoles = readNicRolesConf(paths) as JsonObject | null;
		const roles = extractRolesArray(nicRoles);
		if (roles.length === 0) return '';

		const idx = isDhcp ? 0 : 1;
		if (idx < 0 || idx >= roles.length) return '';

		const r = roles[idx] as Record<string, unknown>;
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
