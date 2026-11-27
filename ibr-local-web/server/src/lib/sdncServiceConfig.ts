import type { Paths } from '../vrwizard.js';
import { clearVrcontrolKey, readVrcontrolString, setVrcontrolString } from '../vrwizard.js';

/** SDN Console 地址。未写 sdnc_console_base 时，沿用旧字段 compute_tower_base / tower_base。 */
export function readSdncConsoleBase(paths: Paths): string | null {
	const canonical = readVrcontrolString(paths, 'sdnc_console_base')?.trim();
	if (canonical) return canonical;
	const legacy =
		readVrcontrolString(paths, 'compute_tower_base')?.trim() ||
		readVrcontrolString(paths, 'tower_base')?.trim();
	return legacy || null;
}

/** SDN CSMCTL（host:port）。优先 sdnc_csmctl_address，兼容旧字段 manageip。 */
export function readSdncCsmctlAddress(paths: Paths): string | null {
	const canonical = readVrcontrolString(paths, 'sdnc_csmctl_address')?.trim();
	if (canonical) return canonical;
	return readVrcontrolString(paths, 'manageip')?.trim() || null;
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

export function clearSdncConsoleConfig(paths: Paths): void {
	clearVrcontrolKey(paths, 'sdnc_console_base');
}

export function clearSdncCsmctlConfig(paths: Paths): void {
	clearVrcontrolKey(paths, 'sdnc_csmctl_address');
	clearVrcontrolKey(paths, 'manageip');
}

/** 写入 CSMCTL 地址：规范键 + agent 仍读的 manageip。 */
export function writeSdncCsmctlAddress(paths: Paths, address: string): void {
	const v = normalizeHostPort(address);
	setVrcontrolString(paths, 'sdnc_csmctl_address', v);
	setVrcontrolString(paths, 'manageip', v);
}
