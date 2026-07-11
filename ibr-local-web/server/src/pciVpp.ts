/**
 * PCI BDF ↔ VPP CLI 接口名字符串的纯函数工具（无 I/O）。
 * 供快照、启动配置、`api` 下发 CLI 等共用。
 *
 * `pciToVppCliIfname`：与 `show interface` 一致的单 token，例如 GigabitEthernet2/2/0（类型与槽位之间无空格）。
 */
export function pciToVppCliIfname(pci: string): string {
	const m = /^([0-9a-fA-F]{4}):([0-9a-fA-F]{2}):([0-9a-fA-F]{2})\.([0-7])$/.exec(pci.trim());
	if (!m) throw new Error(`Invalid pci format: ${pci}`);
	const bus = Number.parseInt(m[2], 16);
	const dev = Number.parseInt(m[3], 16);
	const fn = Number.parseInt(m[4], 10);
	return `GigabitEthernet${bus}/${dev}/${fn}`;
}

/**
 * 将误写的「类型 + 空格 + slot/port」规范为 CLI 单 token（兼容旧 nic_roles / 前端）。
 * 例如 GigabitEthernet 2/2/0 → GigabitEthernet2/2/0。
 */
export function normalizeVppCliIfname(ifname: string): string {
	const t = (ifname || '').trim();
	if (!t) return t;
	const m = /^([A-Za-z]+)\s+(\d+\/\d+\/\d+)$/.exec(t);
	if (m) return `${m[1]}${m[2]}`;
	return t;
}
