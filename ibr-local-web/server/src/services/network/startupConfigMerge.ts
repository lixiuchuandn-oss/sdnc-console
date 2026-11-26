/**
 * startup-config 按 interface 段合并：只替换/追加指定口，保留全局业务配置。
 * 不依赖 vrwizard，避免与写启动配置路径循环引用。
 */
import fs from 'node:fs';
import path from 'node:path';
import {
	pciToClishInterfaceHeader,
	pciToLegacyDecimalSlotKey,
	pciToVppSlotKey,
} from '../../pciVpp.js';

export type StartupIfaceMode = 'static' | 'dhcp';

export function pciToInterfaceHeader(pci: string): string {
	return pciToClishInterfaceHeader(pci);
}

export function pciToClishIfaceName(pci: string): string {
	return pciToInterfaceHeader(pci).replace(/^interface\s+/i, '').trim();
}

export function pciToSlotKey(pci: string): string | null {
	try {
		return pciToVppSlotKey(pci);
	} catch {
		return null;
	}
}

function slotKeyMatchesIface(ifaceLineName: string, slot: string): boolean {
	const n = ifaceLineName.trim().replace(/\s+/g, ' ');
	const esc = slot.replace(/\//g, '\\/');
	const re = new RegExp(`^GigabitEthernet\\s*${esc}(?:\\.\\d+)?$`, 'i');
	const compact = n.replace(/\s+/g, '');
	const re2 = new RegExp(`^GigabitEthernet${esc}(?:\\.\\d+)?$`, 'i');
	return re.test(n) || re2.test(compact);
}

/** 判断 running/startup 中的 interface 行是否属于该 PCI（含子接口；兼容历史十进制误写 0a→10）。 */
export function interfaceLineMatchesPci(ifaceLineName: string, pci: string): boolean {
	const slot = pciToSlotKey(pci);
	if (!slot) return false;
	if (slotKeyMatchesIface(ifaceLineName, slot)) return true;
	const legacy = pciToLegacyDecimalSlotKey(pci);
	return Boolean(legacy && slotKeyMatchesIface(ifaceLineName, legacy));
}

function ifaceNamesMatch(a: string, b: string): boolean {
	return a.trim().replace(/\s+/g, '').toLowerCase() === b.trim().replace(/\s+/g, '').toLowerCase();
}

function unionUnique(dst: string[], add: string[]): void {
	for (const x of add) {
		const v = x.trim();
		if (v && !dst.includes(v)) dst.push(v);
	}
}

/** running-config 空段仍可能在 VPP 留 L3：把 VPP 地址并入同名口，缺口则追加。 */
export function mergeVppAddressTargets<T extends { name: string; ipv4: string[]; ipv6: string[] }>(
	runningTargets: T[],
	vppTargets: T[],
): T[] {
	const out = runningTargets.map((t) => ({ ...t, ipv4: [...t.ipv4], ipv6: [...t.ipv6] }));
	for (const vt of vppTargets) {
		const hit = out.find((t) => ifaceNamesMatch(t.name, vt.name));
		if (hit) {
			unionUnique(hit.ipv4, vt.ipv4);
			unionUnique(hit.ipv6, vt.ipv6);
			continue;
		}
		out.push({ ...vt, ipv4: [...vt.ipv4], ipv6: [...vt.ipv6] });
	}
	return out;
}

export function buildCleanInterfaceStanza(pci: string, mode: StartupIfaceMode): string {
	const hdr = pciToInterfaceHeader(pci);
	const lines = ['!', hdr];
	if (mode === 'dhcp') lines.push(' ip address dhcp');
	lines.push(' no shutdown', '!');
	return lines.join('\n');
}

type Block = { start: number; end: number; name: string; lines: string[] };

/** 顶层（非接口内）命令：不得并入上一个 interface 块。 */
function isGlobalConfigStart(trimmed: string): boolean {
	if (!trimmed) return false;
	if (trimmed === '!') return false;
	if (/^interface\s+/i.test(trimmed)) return true;
	return /^(router|vrf|ip\s+route|ipv6\s+route|ip\s+prefix-list|ipv6\s+prefix-list|route-map|access-list|ip\s+access-list|acl\s+|nat\s+|ipsec\s+|crypto\s+|bgp\s+|segment-routing|srv6|line\s+|hostname\s+|username\s+|enable\s+|banner\s+|snmp|ntp\s+|logging\s+|ip\s+community-list|ipv6\s+access-list)\b/i.test(
		trimmed,
	);
}

function parseConfigBlocks(content: string): { preamble: string[]; blocks: Block[]; trailer: string[] } {
	const rawLines = content.replace(/\r\n/g, '\n').split('\n');
	const blocks: Block[] = [];
	const preamble: string[] = [];
	const trailer: string[] = [];
	let i = 0;
	let seenIface = false;

	while (i < rawLines.length) {
		const line = rawLines[i]!;
		const t = line.trim();
		if (/^interface\s+/i.test(t)) {
			seenIface = true;
			const name = t.replace(/^interface\s+/i, '').trim();
			const start = i;
			const lines = [line];
			i += 1;
			while (i < rawLines.length) {
				const l2 = rawLines[i]!;
				const t2 = l2.trim();
				if (/^interface\s+/i.test(t2) || isGlobalConfigStart(t2)) break;
				lines.push(l2);
				i += 1;
				if (t2 === '!') break;
			}
			blocks.push({ start, end: i, name, lines });
			continue;
		}
		if (!seenIface) preamble.push(line);
		else trailer.push(line);
		i += 1;
	}
	return { preamble, blocks, trailer };
}

function normalizeContent(lines: string[]): string {
	const joined = lines.join('\n').replace(/\n{3,}/g, '\n\n');
	return joined.endsWith('\n') ? joined : `${joined}\n`;
}

export function mergeStartupInterfaceStanzas(params: {
	existingContent: string;
	/** 要写入的干净父接口 stanza（按 PCI） */
	stanzasByPci: Array<{ pci: string; stanza: string }>;
	/** 是否删除这些 PCI 下的子接口块（初始化=true；扩容=false） */
	removeSubinterfaces: boolean;
}): { content: string; replacedNames: string[]; preview: string } {
	const { existingContent, stanzasByPci, removeSubinterfaces } = params;
	const { preamble, blocks, trailer } = parseConfigBlocks(existingContent || '');
	const pciList = stanzasByPci.map((x) => x.pci);
	const replacedNames: string[] = [];

	const kept = blocks.filter((b) => {
		const hit = pciList.some((pci) => interfaceLineMatchesPci(b.name, pci));
		if (!hit) return true;
		const isSub = /\.\d+$/.test(b.name.replace(/\s+/g, '')) || /\.\d+$/.test(b.name);
		if (isSub && !removeSubinterfaces) return true;
		replacedNames.push(b.name);
		return false;
	});

	const newStanzaLines: string[] = [];
	for (const { stanza } of stanzasByPci) {
		for (const l of stanza.replace(/\r\n/g, '\n').split('\n')) newStanzaLines.push(l);
	}

	const outLines: string[] = [...preamble];
	if (outLines.length && outLines[outLines.length - 1]!.trim() !== '') outLines.push('');
	for (const b of kept) outLines.push(...b.lines);
	if (newStanzaLines.length) {
		if (outLines.length && outLines[outLines.length - 1]!.trim() !== '!' && outLines[outLines.length - 1]!.trim() !== '') {
			outLines.push('!');
		}
		outLines.push(...newStanzaLines);
	}
	for (const l of trailer) outLines.push(l);

	const content = normalizeContent(outLines);
	const preview = normalizeContent(newStanzaLines);
	return { content, replacedNames, preview };
}

/** 从 startup 中删除指定 PCI 对应的 interface（含子接口），不写入新段。 */
export function removeStartupInterfaceStanzas(params: {
	existingContent: string;
	pcis: string[];
}): { content: string; removedNames: string[]; preview: string } {
	const { existingContent, pcis } = params;
	const { preamble, blocks, trailer } = parseConfigBlocks(existingContent || '');
	const removedNames: string[] = [];
	const removedPreview: string[] = [];
	const kept = blocks.filter((b) => {
		const hit = pcis.some((pci) => interfaceLineMatchesPci(b.name, pci));
		if (!hit) return true;
		removedNames.push(b.name);
		removedPreview.push(...b.lines, '!');
		return false;
	});
	const outLines: string[] = [...preamble];
	if (outLines.length && outLines[outLines.length - 1]!.trim() !== '') outLines.push('');
	for (const b of kept) outLines.push(...b.lines);
	for (const l of trailer) outLines.push(l);
	return {
		content: normalizeContent(outLines),
		removedNames,
		preview: normalizeContent(removedPreview.length ? removedPreview : ['# (无匹配接口段)']),
	};
}

export function readStartupConfigFile(filePath: string): string {
	try {
		if (!fs.existsSync(filePath)) return '';
		return fs.readFileSync(filePath, 'utf8');
	} catch {
		return '';
	}
}

export function writeStartupConfigFile(filePath: string, content: string): void {
	const dir = path.dirname(filePath);
	fs.mkdirSync(dir, { recursive: true });
	const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
	fs.writeFileSync(tmp, content, 'utf8');
	fs.renameSync(tmp, filePath);
}
