import type { Paths } from '../vrwizard.js';
import { clearVrcontrolKey, readVrcontrolString } from '../vrwizard.js';
/** SDNC 控制台（IBR 管理面 API 根地址，通常 :5001） */
export function readSdncConsoleBase(paths: Paths): string | null {
	const canonical = readVrcontrolString(paths, 'sdnc_console_base')?.trim();
	if (canonical) return canonical;
	// 兼容：旧版把 SDNC 地址写在 compute_tower_base
	const legacy = readVrcontrolString(paths, 'compute_tower_base')?.trim();
	return legacy || null;
}

/** SDN CSMCTL（IBR VR 控制面，通常 host:8016） */
export function readSdncCsmctlAddress(paths: Paths): string | null {
	const canonical = readVrcontrolString(paths, 'sdnc_csmctl_address')?.trim();
	if (canonical) return canonical;
	return readVrcontrolString(paths, 'manageip')?.trim() || null;
}

/**
 * Compute Tower（上层安全服务业务管理面）；与 SDNC 控制台分离。
 * 若尚未写入 sdnc_console_base，则 compute_tower_base 可能仍被旧配置占用为 SDNC 地址，此时不当作 Tower。
 */
export function readComputeTowerBase(paths: Paths): string | null {
	const tower =
		readVrcontrolString(paths, 'compute_tower_base')?.trim() ||
		readVrcontrolString(paths, 'tower_base')?.trim() ||
		'';
	if (!tower) return null;
	const sdncCanonical = readVrcontrolString(paths, 'sdnc_console_base')?.trim();
	if (!sdncCanonical && tower === readSdncConsoleBase(paths)) return null;
	return tower;
}

export function normalizeServiceBaseUrl(raw: string): string {
	const v = String(raw ?? '').trim();
	if (!v) return '';
	if (/^https?:\/\//i.test(v)) return v;
	return `http://${v}`;
}

export function normalizeHostPort(raw: string): string {
	return String(raw ?? '').trim().replace(/^https?:\/\//i, '').split('/')[0]?.trim() || '';
}

/** 清空 SDN Console 配置（含旧版 compute_tower_base 兜底地址） */
export function clearSdncConsoleConfig(paths: Paths): void {
	clearVrcontrolKey(paths, 'sdnc_console_base');
	if (readVrcontrolString(paths, 'compute_tower_base').trim() && !readComputeTowerBase(paths)) {
		clearVrcontrolKey(paths, 'compute_tower_base');
	}
}

/** 清空 SDN CSMCTL 配置（含 agent 使用的 manageip） */
export function clearSdncCsmctlConfig(paths: Paths): void {
	clearVrcontrolKey(paths, 'sdnc_csmctl_address');
	clearVrcontrolKey(paths, 'manageip');
}

/** 清空 Compute Tower 业务面配置 */
export function clearComputeTowerConfig(paths: Paths): void {
	clearVrcontrolKey(paths, 'compute_tower_base');
	clearVrcontrolKey(paths, 'tower_base');
}
