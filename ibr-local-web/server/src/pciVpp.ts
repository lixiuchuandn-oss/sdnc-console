/**
 * PCI BDF ↔ VPP CLI 接口名字符串的纯函数工具（无 I/O）。
 * 供快照、启动配置、`api` 下发 CLI 等共用。
 *
 * VPP/CLISH 槽位为**十六进制、无前导零**（与 `show interface` 一致）：
 * - `0000:00:07.0` → `GigabitEthernet0/7/0`
 * - `0000:00:0a.0` → `GigabitEthernet0/a/0`（不是 `0/10/0`）
 */

function parsePciBdf(pci: string): { bus: number; dev: number; fn: number } | null {
	const m = /^([0-9a-fA-F]{4}):([0-9a-fA-F]{2}):([0-9a-fA-F]{2})\.([0-7])$/.exec(pci.trim());
	if (!m) return null;
	return {
		bus: Number.parseInt(m[2], 16),
		dev: Number.parseInt(m[3], 16),
		fn: Number.parseInt(m[4], 10),
	};
}

/** 与 `show interface` 一致的 slot：`bus/dev/fn`（hex，小写，无 padding）。 */
export function pciToVppSlotKey(pci: string): string {
	const p = parsePciBdf(pci);
	if (!p) throw new Error(`Invalid pci format: ${pci}`);
	return `${p.bus.toString(16)}/${p.dev.toString(16)}/${p.fn.toString(16)}`;
}

/**
 * 历史误把 PCI 槽位写成十进制（`0a`→`10`）时的兼容 key。
 * 与 hex key 相同时返回 null（`07` 等无需兼容）。
 */
export function pciToLegacyDecimalSlotKey(pci: string): string | null {
	const p = parsePciBdf(pci);
	if (!p) return null;
	const hex = `${p.bus.toString(16)}/${p.dev.toString(16)}/${p.fn.toString(16)}`;
	const dec = `${p.bus}/${p.dev}/${p.fn}`;
	return hex === dec ? null : dec;
}

/**
 * `pciToVppCliIfname`：与 `show interface` 一致的单 token，例如 GigabitEthernet2/2/0（类型与槽位之间无空格）。
 */
export function pciToVppCliIfname(pci: string): string {
	return `GigabitEthernet${pciToVppSlotKey(pci)}`;
}

/** startup-config 行头：`interface GigabitEthernet 0/a/0`（类型与槽位之间有空格）。 */
export function pciToClishInterfaceHeader(pci: string): string {
	return `interface GigabitEthernet ${pciToVppSlotKey(pci)}`;
}

/**
 * 将误写的「类型 + 空格 + slot/port」规范为 CLI 单 token（兼容旧 nic_roles / 前端）。
 * 例如 GigabitEthernet 2/2/0 → GigabitEthernet2/2/0；亦接受 hex 槽位 0/a/0。
 */
export function normalizeVppCliIfname(ifname: string): string {
	const t = (ifname || '').trim();
	if (!t) return t;
	const m = /^([A-Za-z]+)\s+([0-9a-fA-F]+\/[0-9a-fA-F]+\/[0-9a-fA-F]+)$/i.exec(t);
	if (m) return `${m[1]}${m[2]}`;
	return t;
}
