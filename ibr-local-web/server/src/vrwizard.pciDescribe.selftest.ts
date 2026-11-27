/**
 * 手工回归：npx tsx src/vrwizard.pciDescribe.selftest.ts
 */
import { describePciNicForStatus, type PciNic } from './vrwizard.js';

function assert(cond: unknown, msg: string): asserts cond {
	if (!cond) throw new Error(msg);
}

const osNic: PciNic = {
	pci: '0000:00:03.1',
	ifnames: ['ens3f1'],
	macs: ['aa:bb:cc:dd:ee:01'],
	driver: 'virtio-pci',
};
const osRow = describePciNicForStatus(osNic);
assert(osRow.pci === '0000:00:03.1', 'pci 透传');
assert(osRow.ifnames[0] === 'ens3f1', 'ifnames 透传');
assert(osRow.macs[0] === 'aa:bb:cc:dd:ee:01', 'macs 透传');
assert(osRow.driver === 'virtio-pci', 'driver 透传');
assert(osRow.vpp_ifname === 'GigabitEthernet0/3/1', 'VPP 口名由 PCI 推导');

const vfioNic: PciNic = {
	pci: '0000:00:07.0',
	ifnames: [],
	macs: [],
	driver: 'vfio-pci',
};
const vfioRow = describePciNicForStatus(vfioNic);
assert(vfioRow.ifnames.length === 0, 'vfio 无内核名');
assert(vfioRow.driver === 'vfio-pci', 'vfio driver');
assert(vfioRow.vpp_ifname === 'GigabitEthernet0/7/0', 'vfio 仍可推导 VPP 口名');

console.log('vrwizard.pciDescribe.selftest: ok');
