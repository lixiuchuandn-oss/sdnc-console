/**
 * 手工回归：npx tsx src/services/network/startupConfigMerge.selftest.ts
 * 断言 startup 按口合并不会吞掉接口后的全局段。
 */
import {
	interfaceLineMatchesPci,
	mergeStartupInterfaceStanzas,
	mergeVppAddressTargets,
	buildCleanInterfaceStanza,
	removeStartupInterfaceStanzas,
} from './startupConfigMerge.js';

function assert(cond: unknown, msg: string): asserts cond {
	if (!cond) throw new Error(msg);
}

const pciWan = '0000:00:07.0';
const existing = [
	'hostname pe1',
	'!',
	'interface GigabitEthernet 0/7/0',
	' ip address 11.1.1.1/24',
	' no shutdown',
	'!',
	'interface GigabitEthernet 0/8/0',
	' ip address 10.1.1.100/24',
	' no shutdown',
	'router bgp 65001',
	' neighbor 11.1.1.11 remote-as 65000',
	'ip route 0.0.0.0/0 10.23.0.1',
	'ipsec enable',
	'',
].join('\n');

const merged = mergeStartupInterfaceStanzas({
	existingContent: existing,
	stanzasByPci: [{ pci: pciWan, stanza: buildCleanInterfaceStanza(pciWan, 'static') }],
	removeSubinterfaces: true,
});

assert(merged.content.includes('router bgp 65001'), 'P0: 合并后必须保留 router bgp');
assert(merged.content.includes('neighbor 11.1.1.11 remote-as 65000'), 'P0: 必须保留 bgp neighbor');
assert(merged.content.includes('ip route 0.0.0.0/0 10.23.0.1'), 'P0: 必须保留全局 ip route');
assert(merged.content.includes('ipsec enable'), 'P0: 必须保留全局 ipsec enable');
assert(!/interface GigabitEthernet 0\/7\/0[\s\S]*ip address 11\.1\.1\.1/.test(merged.content), 'P0: WAN 旧 IP 必须被替换');
assert(merged.content.includes('interface GigabitEthernet 0/8/0'), 'P0: 未选中口必须保留');
assert(merged.content.includes('ip address 10.1.1.100/24'), 'P0: 未选中口地址必须保留');
assert(interfaceLineMatchesPci('GigabitEthernet 0/7/0.100', pciWan), '子接口应匹配 PCI');
assert(!interfaceLineMatchesPci('GigabitEthernet 0/8/0', pciWan), '其它 PCI 不得误匹配');

const pciHex = '0000:00:0a.0';
assert(buildCleanInterfaceStanza(pciHex, 'static').includes('interface GigabitEthernet 0/a/0'), 'P0: 0a 口名须为 hex 0/a/0');
assert(!buildCleanInterfaceStanza(pciHex, 'static').includes('0/10/0'), 'P0: 不得写成十进制 0/10/0');
assert(interfaceLineMatchesPci('GigabitEthernet 0/a/0', pciHex), 'hex 槽位应匹配');
assert(interfaceLineMatchesPci('GigabitEthernet0/a/0', pciHex), 'compact hex 应匹配');
assert(interfaceLineMatchesPci('GigabitEthernet 0/10/0', pciHex), '历史十进制误写 0/10 应仍匹配以便清理');
assert(!interfaceLineMatchesPci('GigabitEthernet 0/b/0', pciHex), '其它 hex 口不得误匹配');

const legacyHexExisting = [
	'!',
	'interface GigabitEthernet 0/10/0',
	' no shutdown',
	'!',
	'router bgp 1',
	'',
].join('\n');
const fixedHex = mergeStartupInterfaceStanzas({
	existingContent: legacyHexExisting,
	stanzasByPci: [{ pci: pciHex, stanza: buildCleanInterfaceStanza(pciHex, 'static') }],
	removeSubinterfaces: true,
});
assert(fixedHex.content.includes('interface GigabitEthernet 0/a/0'), '合并应写成正确 hex 口');
assert(!fixedHex.content.includes('0/10/0'), '合并应清掉历史十进制误写');
assert(fixedHex.content.includes('router bgp 1'), '清误写时不得吞全局段');

const noBang = [
	'interface GigabitEthernet 0/7/0',
	' ip address 1.1.1.1/24',
	'router bgp 1',
	' neighbor 1.1.1.2 remote-as 2',
].join('\n');
const merged2 = mergeStartupInterfaceStanzas({
	existingContent: noBang,
	stanzasByPci: [{ pci: pciWan, stanza: buildCleanInterfaceStanza(pciWan, 'static') }],
	removeSubinterfaces: true,
});
assert(merged2.content.includes('router bgp 1'), 'P0: 无 ! 分隔时全局段也不得并入 interface');
assert(!merged2.content.includes('ip address 1.1.1.1/24'), 'P0: 无 ! 时旧口 IP 仍应被替换');

const removed = removeStartupInterfaceStanzas({
	existingContent: existing,
	pcis: [pciWan],
});
assert(!removed.content.includes('interface GigabitEthernet 0/7/0'), '删除后不应残留目标口');
assert(removed.content.includes('interface GigabitEthernet 0/8/0'), '删除不得误删其它口');
assert(removed.content.includes('router bgp 65001'), '删除不得吞掉全局 bgp');
assert(removed.content.includes('ip route 0.0.0.0/0 10.23.0.1'), '删除不得吞掉全局 route');
assert(removed.removedNames.some((n) => /0\/7\/0/.test(n)), 'removedNames 应含目标口');

const mergedVpp = mergeVppAddressTargets(
	[{ name: 'GigabitEthernet 0/7/0', ipv4: [], ipv6: [] }],
	[{ name: 'GigabitEthernet 0/7/0', ipv4: ['11.1.1.1/24'], ipv6: [] }],
);
assert(mergedVpp[0]?.ipv4.includes('11.1.1.1/24') === true, 'P0: running 空段必须并入 VPP WAN IP');

console.log('startupConfigMerge.selftest: ok');
