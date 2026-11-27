/**
 * 回归：hardware PCI 不得误解析为 MAC；interface address 含 IPv6；空 L3 覆盖快照。
 * npx tsx src/nicRolesSnapshot.hwPci.selftest.ts
 */
import {
	lookupVbrasTeleIp,
	nicRolesVbrasIpsStale,
	parseVbrasShowHardwareInterfaces,
	parseVbrasShowInterfaceAddress,
} from './nicRolesSnapshot.js';
import { mergeVppAddressTargets } from './services/network/startupConfigMerge.js';

function assert(cond: unknown, msg: string): asserts cond {
	if (!cond) throw new Error(msg);
}

const sample = [
	'              Name                Idx   Link  Hardware',
	'GigabitEthernet0/7/0               2     up   GigabitEthernet0/7/0',
	'  Link speed: 10 Gbps',
	'  Ethernet address 52:54:00:99:57:31',
	'  Red Hat Virtio',
	'    carrier up half duplex mtu 1500',
	'    pci: device 1af4:1000 subsystem 1af4:0001 address 0000:00:07.00 numa 0',
	'    rx frames ok                                           8',
	'GigabitEthernet0/8/0               3     up   GigabitEthernet0/8/0',
	'  Link speed: 10 Gbps',
	'  Ethernet address 52:54:00:3b:4f:42',
	'  Red Hat Virtio',
	'    pci: device 1af4:1000 subsystem 1af4:0001 address 0000:00:08.00 numa 0',
].join('\n');

const parsed = parseVbrasShowHardwareInterfaces(sample);
assert(parsed.byPci.has('0000:00:07.0'), '07.0 应进入 hwPciSet');
assert(parsed.byPci.has('0000:00:08.0'), '08.0 应进入 hwPciSet');
assert(![...parsed.byPci.keys()].some((k) => k.includes('52:54')), '不得把 MAC 当 PCI key');
assert(parsed.byPci.get('0000:00:07.0')?.ethernet_address === '52:54:00:99:57:31', 'MAC 仍应解析到 ethernet_address');

const addrText = [
	'GigabitEthernet0/3/1 (up):',
	'  L3 10.1.1.100/24',
	'  L3 2100::100/64',
	'GigabitEthernet0/7/0 (up):',
	'  L3 11.1.1.1/24',
	'GigabitEthernet0/8/0 (up):',
	'host-vbras1 (up):',
	'  L3 5.4.3.2/24',
].join('\n');
const addrs = parseVbrasShowInterfaceAddress(addrText);
assert(addrs.get('GigabitEthernet0/3/1')?.ips.includes('10.1.1.100/24') === true, '03.1 IPv4');
assert(addrs.get('GigabitEthernet0/3/1')?.ips.includes('2100::100/64') === true, '03.1 IPv6');
assert(addrs.get('GigabitEthernet0/8/0')?.ips.length === 0, '08.0 无 L3');
assert(addrs.get('GigabitEthernet0/7/0')?.ips.includes('11.1.1.1/24') === true, '07.0 IPv4');

const mergedIps = mergeVppAddressTargets(
	[
		{ name: 'GigabitEthernet 0/7/0', ipv4: [], ipv6: [] },
		{ name: 'GigabitEthernet 0/8/0', ipv4: [], ipv6: [] },
	],
	[
		{ name: 'GigabitEthernet 0/7/0', ipv4: ['11.1.1.1/24'], ipv6: [] },
		{ name: 'GigabitEthernet 0/3/1', ipv4: ['10.1.1.100/24'], ipv6: ['2100::100/64'] },
	],
);
const wanMerged = mergedIps.find((t) => t.name.includes('0/7/0'));
const auxMerged = mergedIps.find((t) => t.name.includes('0/3/1'));
assert(wanMerged?.ipv4.includes('11.1.1.1/24') === true, 'running 空段仍须并入 VPP 残留 WAN IP');
assert(auxMerged?.ipv4.includes('10.1.1.100/24') === true && auxMerged?.ipv6.includes('2100::100/64') === true, '孤儿口 VPP 地址须追加');

const tele = new Map([
	['GigabitEthernet0/7/0', { state: 'up', ip: '11.1.1.1/24' }],
	['GigabitEthernet0/8/0', { state: 'up', ip: '-' }],
]);
assert(lookupVbrasTeleIp(tele, 'GigabitEthernet0/8/0') === '-', '空 L3 返回权威空而非 null');
assert(lookupVbrasTeleIp(tele, 'GigabitEthernet0/9/0') === null, '未覆盖口返回 null');
assert(
	nicRolesVbrasIpsStale(
		{ roles: [{ attached: true, vbras: { name: 'GigabitEthernet0/8/0', ip: '11.1.1.1/24' } }] },
		tele,
	) === true,
	'快照残留重复 IP 应对空遥测判定为 stale',
);

console.log('nicRolesSnapshot.hwPci.selftest: ok');
